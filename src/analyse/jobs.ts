/**
 * The analysis-job ledger: one row per window of captured frames.
 *
 * An analysis job is the unit of work that turns a window of frames into one
 * `activities` row. The ledger is what makes that work resumable and bounded:
 *
 * - `job_key` (`<day>:<window start>`) is unique, so replaying the same window
 *   is idempotent rather than a duplicate;
 * - `status` is a small state machine (`queued` → `running` → `complete` /
 *   `failed` / `skipped`) and `attempts` caps how often a failing window is
 *   retried;
 * - the one successful call records `model` and its token counts, which is what
 *   the per-day budget and status read instead of a second ledger.
 *
 * This module only touches the database. It never calls a model, reads no
 * configuration, and does not decide whether analysis is allowed — that is
 * {@link module:dsh-plugin-dayflow/analyse/consent}'s job. The caller creates
 * the row, starts it, and then completes, fails, or skips it from the pipeline.
 *
 * A malformed row is a database error, not a silent `undefined`: the table has
 * a status CHECK, but a hand-edited journal can still hold a value no reader
 * understands, and pretending the row does not exist would quietly re-run work.
 * @module dsh-plugin-dayflow/analyse/jobs
 */

import type { DatabaseSync } from 'node:sqlite';

import { dayWindowForKey } from '../day.js';
import { DayflowError } from '../errors.js';

/** The lifecycle states of one analysis window. */
export type AnalysisJobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'skipped';

/** How many times one window may be started before it stays failed. */
export const ANALYSIS_MAX_ATTEMPTS = 2;

/** Read limit when the caller states none. */
export const ANALYSIS_DEFAULT_LIST_LIMIT = 100;

/** Upper bound for one job listing. */
export const ANALYSIS_MAX_LIST_LIMIT = 500;

/** Longest failure message or skip reason kept on a row. */
export const ANALYSIS_MAX_ERROR_CHARS = 500;

/** One analysis job as stored in the ledger. */
export interface AnalysisJob {
  id: number;
  job_key: string;
  day: string;
  window_start_ts: number;
  window_end_ts: number;
  status: AnalysisJobStatus;
  attempts: number;
  error?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
}

/** Input accepted when a caller creates a job for one window. */
export interface CreateAnalysisJobInput {
  jobKey: string;
  day: string;
  windowStartTs: number;
  windowEndTs: number;
}

/** Optional filters for {@link listAnalysisJobs}. */
export interface ListAnalysisJobsOptions {
  day?: string;
  status?: AnalysisJobStatus;
  limit?: number;
}

/** Token usage recorded when a job completes. */
export interface AnalysisJobUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

const STATUSES: ReadonlySet<string> = new Set<AnalysisJobStatus>(['queued', 'running', 'complete', 'failed', 'skipped']);

/** One raw SQLite row, keyed by column name. */
type Row = Record<string, unknown>;

function asInteger(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  return undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalid(message: string): DayflowError {
  return new DayflowError(message, 'invalid_input');
}

function databaseError(message: string, cause?: unknown): DayflowError {
  return new DayflowError(message, 'database_error', cause === undefined ? undefined : { cause });
}

/** Run one ledger operation, turning an unexpected SQLite failure into `database_error`. */
function ledgerCall<T>(operation: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof DayflowError) throw error;
    throw databaseError(`Could not ${operation} in the analysis-job ledger: ${errorMessage(error)}`, error);
  }
}

/** A required `YYYY-MM-DD` day key, normalized through the Dayflow day window. */
function requireDay(value: unknown): string {
  if (typeof value !== 'string') throw invalid('An analysis job needs a day as a YYYY-MM-DD string.');
  const window = dayWindowForKey(value);
  if (window === undefined) {
    throw invalid(`"${value}" is not a day. Use YYYY-MM-DD, for example 2026-03-11.`);
  }
  return window.dayKey;
}

/** A required non-empty job key. */
function requireJobKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid('An analysis job needs a non-empty job key.');
  }
  return value.trim();
}

/** A required non-negative whole number. */
function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(`${field} must be a non-negative whole number (received ${String(value)}).`);
  }
  return value;
}

/** A required positive row id. */
function requireId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalid(`An analysis job id must be a positive whole number (received ${String(value)}).`);
  }
  return value;
}

/** An optional non-negative whole number; `null`/`undefined` mean absent. */
function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireNonNegativeInteger(value, field);
}

/** An optional trimmed model id. */
function optionalModel(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid('An analysis job model must be a string.');
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** One validated status filter. */
function requireStatus(value: unknown): AnalysisJobStatus {
  if (typeof value !== 'string' || !STATUSES.has(value)) {
    throw invalid(`An analysis job status must be one of ${[...STATUSES].join(', ')}.`);
  }
  return value as AnalysisJobStatus;
}

/** Validate a read limit, applying the store's default and upper bound. */
function resolveLimit(value: unknown): number {
  if (value === undefined || value === null) return ANALYSIS_DEFAULT_LIST_LIMIT;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > ANALYSIS_MAX_LIST_LIMIT) {
    throw invalid(
      `An analysis job limit must be an integer between 1 and ${String(ANALYSIS_MAX_LIST_LIMIT)}.`,
    );
  }
  return value;
}

/** Truncate a failure message or skip reason to the stored maximum. */
function clampError(value: string): string {
  return value.length > ANALYSIS_MAX_ERROR_CHARS ? value.slice(0, ANALYSIS_MAX_ERROR_CHARS) : value;
}

/** A required non-negative token count. */
function requireTokenCount(value: unknown, field: string): number {
  return requireNonNegativeInteger(value, field);
}

/** Map one `analysis_jobs` row to the caller-facing job. */
function analysisJobFromRow(row: Row): AnalysisJob {
  const id = asInteger(row.id);
  if (id === undefined || id < 1) throw databaseError('An analysis job row has no usable id.');
  const jobKey = asText(row.job_key);
  if (jobKey === undefined || jobKey.trim() === '') {
    throw databaseError(`Analysis job #${String(id)} has no job key.`);
  }
  const dayText = asText(row.day);
  if (dayText === undefined || dayWindowForKey(dayText) === undefined) {
    throw databaseError(`Analysis job #${String(id)} has an invalid day.`);
  }
  const start = asInteger(row.window_start_ts);
  const end = asInteger(row.window_end_ts);
  if (start === undefined || start < 0 || end === undefined || end < 0 || start > end) {
    throw databaseError(`Analysis job #${String(id)} has an invalid window.`);
  }
  const status = asText(row.status);
  if (status === undefined || !STATUSES.has(status)) {
    throw databaseError(`Analysis job #${String(id)} has an unknown status.`);
  }
  const attempts = asInteger(row.attempts);
  if (attempts === undefined || attempts < 0) {
    throw databaseError(`Analysis job #${String(id)} has an invalid attempt count.`);
  }
  const error = row.error === null || row.error === undefined ? undefined : asText(row.error);
  if (row.error !== null && row.error !== undefined && error === undefined) {
    throw databaseError(`Analysis job #${String(id)} has a non-text error.`);
  }
  const model = row.model === null || row.model === undefined ? undefined : asText(row.model);
  if (row.model !== null && row.model !== undefined && model === undefined) {
    throw databaseError(`Analysis job #${String(id)} has a non-text model.`);
  }
  const inputTokens = row.input_tokens === null || row.input_tokens === undefined ? undefined : asInteger(row.input_tokens);
  const outputTokens = row.output_tokens === null || row.output_tokens === undefined ? undefined : asInteger(row.output_tokens);
  if (inputTokens !== undefined && inputTokens < 0) {
    throw databaseError(`Analysis job #${String(id)} has an invalid input token count.`);
  }
  if (outputTokens !== undefined && outputTokens < 0) {
    throw databaseError(`Analysis job #${String(id)} has an invalid output token count.`);
  }
  return {
    id,
    job_key: jobKey,
    day: dayText,
    window_start_ts: start,
    window_end_ts: end,
    status: status as AnalysisJobStatus,
    attempts,
    ...(error === undefined ? {} : { error }),
    ...(model === undefined ? {} : { model }),
    ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
    ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
  };
}

/** Read one ledger row by id, or `undefined` when there is none. */
function readJobById(db: DatabaseSync, id: number): AnalysisJob | undefined {
  const row = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(id) as Row | undefined;
  return row === undefined ? undefined : analysisJobFromRow(row);
}

/** Read one ledger row by job key, or `undefined` when there is none. */
function readJobByKey(db: DatabaseSync, jobKey: string): AnalysisJob | undefined {
  const row = db.prepare('SELECT * FROM analysis_jobs WHERE job_key = ?').get(jobKey) as Row | undefined;
  return row === undefined ? undefined : analysisJobFromRow(row);
}

/** Read back the row a write just touched, failing when it disappeared. */
function readWrittenJob(db: DatabaseSync, id: number): AnalysisJob {
  const job = readJobById(db, id);
  if (job === undefined) throw databaseError(`Analysis job #${String(id)} disappeared after it was written.`);
  return job;
}

/**
 * The stable key of the job for one analysis window.
 *
 * @param day - the Dayflow day the window belongs to.
 * @param windowStartTs - the window's start, in epoch seconds.
 * @returns `<normalized day>:<window start>`.
 */
export function analysisJobKey(day: string, windowStartTs: number): string {
  const dayKey = requireDay(day);
  const start = requireNonNegativeInteger(windowStartTs, 'windowStartTs');
  return `${dayKey}:${String(start)}`;
}

/**
 * Create the job for one window, or return the row that already exists.
 *
 * `job_key` is unique, so replaying the same frames is idempotent: a second
 * create with the same key returns the first row untouched, whatever state the
 * first job has reached.
 *
 * @throws `invalid_input` for a malformed key, day, or window.
 */
export function createAnalysisJob(db: DatabaseSync, input: CreateAnalysisJobInput): AnalysisJob {
  if (input === undefined || input === null) throw invalid('An analysis job input is required.');
  const jobKey = requireJobKey(input.jobKey);
  const day = requireDay(input.day);
  const start = requireNonNegativeInteger(input.windowStartTs, 'windowStartTs');
  const end = requireNonNegativeInteger(input.windowEndTs, 'windowEndTs');
  if (end < start) throw invalid('An analysis window must end at or after it starts.');
  return ledgerCall('create a job', () => {
    db.prepare(
      `INSERT OR IGNORE INTO analysis_jobs (job_key, day, window_start_ts, window_end_ts)
       VALUES (?, ?, ?, ?)`,
    ).run(jobKey, day, start, end);
    const job = readJobByKey(db, jobKey);
    if (job === undefined) throw databaseError(`Analysis job ${jobKey} disappeared after it was created.`);
    return job;
  });
}

/**
 * Read one job by its key.
 *
 * @returns the job, or `undefined` when no row has that key.
 */
export function getAnalysisJob(db: DatabaseSync, jobKey: string): AnalysisJob | undefined {
  const key = requireJobKey(jobKey);
  return ledgerCall('read a job', () => readJobByKey(db, key));
}

/**
 * List jobs in window order (oldest window first, ties by id).
 *
 * `day` and `status` narrow the list; `limit` defaults to
 * {@link ANALYSIS_DEFAULT_LIST_LIMIT} and must be between 1 and
 * {@link ANALYSIS_MAX_LIST_LIMIT}.
 */
export function listAnalysisJobs(db: DatabaseSync, options: ListAnalysisJobsOptions = {}): AnalysisJob[] {
  const settings = options ?? {};
  const day = settings.day === undefined || settings.day === null ? undefined : requireDay(settings.day);
  const status = settings.status === undefined || settings.status === null ? undefined : requireStatus(settings.status);
  const limit = resolveLimit(settings.limit);
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];
  if (day !== undefined) {
    conditions.push('day = ?');
    parameters.push(day);
  }
  if (status !== undefined) {
    conditions.push('status = ?');
    parameters.push(status);
  }
  const where = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
  parameters.push(limit);
  return ledgerCall('list jobs', () => {
    const rows = db
      .prepare(`SELECT * FROM analysis_jobs${where} ORDER BY window_start_ts ASC, id ASC LIMIT ?`)
      .all(...(parameters as never[])) as Row[];
    return rows.map(analysisJobFromRow);
  });
}

/**
 * Move a queued or failed job to running and count the attempt.
 *
 * A job can be started again while it has attempts left (at most
 * {@link ANALYSIS_MAX_ATTEMPTS}); a running, complete, skipped, or exhausted job
 * is refused with `invalid_input`.
 *
 * @throws `not_found` when no job has the id.
 */
export function startAnalysisJob(db: DatabaseSync, id: number): AnalysisJob {
  const jobId = requireId(id);
  return ledgerCall('start a job', () => {
    const job = readJobById(db, jobId);
    if (job === undefined) throw new DayflowError(`Analysis job #${String(jobId)} does not exist.`, 'not_found');
    if (job.status !== 'queued' && job.status !== 'failed') {
      throw invalid(
        `Analysis job #${String(jobId)} is ${job.status}; only a queued or failed job can start.`,
      );
    }
    if (job.attempts >= ANALYSIS_MAX_ATTEMPTS) {
      throw invalid(
        `Analysis job #${String(jobId)} already used its ${String(ANALYSIS_MAX_ATTEMPTS)} attempts.`,
      );
    }
    db.prepare(
      `UPDATE analysis_jobs
          SET status = 'running', attempts = attempts + 1, error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).run(jobId);
    return readWrittenJob(db, jobId);
  });
}

/**
 * Mark a job complete and record the usage of the call that produced it.
 *
 * A second complete on the same row is harmless: it rewrites the usage and the
 * status, so a retried bookkeeping step cannot corrupt the ledger.
 *
 * @throws `invalid_input` for a malformed usage; `not_found` for an unknown id.
 */
export function completeAnalysisJob(
  db: DatabaseSync,
  id: number,
  usage: AnalysisJobUsage = {},
): AnalysisJob {
  const jobId = requireId(id);
  const settings = usage ?? {};
  const model = optionalModel(settings.model);
  const inputTokens = optionalNonNegativeInteger(settings.inputTokens, 'inputTokens');
  const outputTokens = optionalNonNegativeInteger(settings.outputTokens, 'outputTokens');
  return ledgerCall('complete a job', () => {
    if (readJobById(db, jobId) === undefined) {
      throw new DayflowError(`Analysis job #${String(jobId)} does not exist.`, 'not_found');
    }
    db.prepare(
      `UPDATE analysis_jobs
          SET status = 'complete', error = NULL, model = ?, input_tokens = ?, output_tokens = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).run(model ?? null, inputTokens ?? null, outputTokens ?? null, jobId);
    return readWrittenJob(db, jobId);
  });
}

/**
 * Mark a job failed, keeping a bounded failure message for the next attempt.
 *
 * @throws `not_found` when no job has the id.
 */
export function failAnalysisJob(db: DatabaseSync, id: number, error: string): AnalysisJob {
  const jobId = requireId(id);
  if (typeof error !== 'string') throw invalid('An analysis job error must be a string.');
  const message = error.trim() === '' ? 'analysis failed' : clampError(error.trim());
  return ledgerCall('fail a job', () => {
    if (readJobById(db, jobId) === undefined) {
      throw new DayflowError(`Analysis job #${String(jobId)} does not exist.`, 'not_found');
    }
    db.prepare(
      `UPDATE analysis_jobs
          SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).run(message, jobId);
    return readWrittenJob(db, jobId);
  });
}

/**
 * Mark a job skipped without calling a model (consent, budget, or no frames).
 *
 * The reason is what the panel and the status route show, so it is required;
 * `error` carries it because the row has no separate reason column.
 *
 * @throws `not_found` when no job has the id.
 */
export function skipAnalysisJob(db: DatabaseSync, id: number, reason: string): AnalysisJob {
  const jobId = requireId(id);
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw invalid('An analysis job skip needs a non-empty reason.');
  }
  const message = clampError(reason.trim());
  return ledgerCall('skip a job', () => {
    if (readJobById(db, jobId) === undefined) {
      throw new DayflowError(`Analysis job #${String(jobId)} does not exist.`, 'not_found');
    }
    db.prepare(
      `UPDATE analysis_jobs
          SET status = 'skipped', error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).run(message, jobId);
    return readWrittenJob(db, jobId);
  });
}

/**
 * Count the day's model calls: jobs that were actually started at least once.
 *
 * A skipped job (consent, budget) never started, so its `attempts` is 0 and it
 * is not a call. A failed or running job did start, so it counts.
 */
export function countAnalysisCallsForDay(db: DatabaseSync, day: string): number {
  const dayKey = requireDay(day);
  return ledgerCall('count the day\'s calls', () => {
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM analysis_jobs WHERE day = ? AND attempts > 0')
      .get(dayKey) as Row | undefined;
    const count = asInteger(row?.count);
    if (count === undefined || count < 0) throw databaseError('The analysis call count is not a number.');
    return count;
  });
}

/**
 * Whether the day has spent its call budget.
 *
 * @param maxCallsPerDay - the configured cap; must be a positive whole number.
 */
export function analysisBudgetExhausted(db: DatabaseSync, day: string, maxCallsPerDay: number): boolean {
  const dayKey = requireDay(day);
  if (typeof maxCallsPerDay !== 'number' || !Number.isSafeInteger(maxCallsPerDay) || maxCallsPerDay < 1) {
    throw invalid(`maxCallsPerDay must be a positive whole number (received ${String(maxCallsPerDay)}).`);
  }
  return countAnalysisCallsForDay(db, dayKey) >= maxCallsPerDay;
}

/** Sum the token usage recorded on the day's completed jobs. */
export function analysisTokenTotalsForDay(db: DatabaseSync, day: string): { input: number; output: number } {
  const dayKey = requireDay(day);
  return ledgerCall('sum the day\'s tokens', () => {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output
           FROM analysis_jobs WHERE day = ?`,
      )
      .get(dayKey) as Row | undefined;
    const input = asInteger(row?.input);
    const output = asInteger(row?.output);
    if (input === undefined || output === undefined || input < 0 || output < 0) {
      throw databaseError('The analysis token totals are not numbers.');
    }
    return { input, output };
  });
}
