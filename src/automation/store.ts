/**
 * The automation ledger and the brief store: the database half of "the day
 * closes itself".
 *
 * The scheduler's work is small and failure-tolerant, so it is recorded in two
 * tables rather than inferred from timestamps:
 *
 * - `automation_runs` holds one row per scheduled job (the two closing jobs and
 *   the weekly memory lint). `(job, day)` is unique, so ensuring a job twice is
 *   idempotent instead of a duplicate; `status` is a lifecycle (`pending` →
 *   `running` → `complete` / `failed` / `skipped`), and `attempts` caps retries
 *   at {@link AUTOMATION_MAX_ATTEMPTS}. A failed run can be started again while
 *   it has attempts left; a run that used them stays failed. The payload of a
 *   successful run is stored as JSON.
 * - `briefs` holds the generated summary of one day or one week. `(kind,
 *   period_key)` is unique, so regenerating a period rewrites its title, body,
 *   model, optional JSON payload, and source while keeping the `id` and
 *   `created_at`.
 *
 * This module only touches the database. It never calls a model, never reads the
 * configuration, and never decides whether automation is allowed — the scheduler
 * owns that policy and calls these functions between its decisions.
 *
 * A malformed row is a database error, not a silent `undefined`: the tables carry
 * CHECK constraints, but a hand-edited journal can still hold a value no reader
 * understands, and pretending the row is missing would quietly re-run the job.
 * @module dsh-plugin-dayflow/automation/store
 */

import type { DatabaseSync } from 'node:sqlite';

import { dayWindowForKey } from '../day.js';
import { DayflowError } from '../errors.js';

/** The scheduled jobs: the two closing jobs and the weekly memory lint. */
export type AutomationJob = 'day_close' | 'week_close' | 'lint';

/** The lifecycle states of one automation run. */
export type AutomationRunStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

/** The two periods a brief can describe. */
export type BriefKind = 'day' | 'week';

/** How many times one run may be started before it stays failed. */
export const AUTOMATION_MAX_ATTEMPTS = 2;

/** Longest failure message or skip reason kept on a run. */
export const AUTOMATION_MAX_ERROR_CHARS = 500;

/** Read limit when the caller states none. */
export const AUTOMATION_DEFAULT_LIST_LIMIT = 50;

/** Upper bound for one run or brief listing. */
export const AUTOMATION_MAX_LIST_LIMIT = 200;

/** One automation run as stored in the ledger. */
export interface AutomationRun {
  id: number;
  job: AutomationJob;
  /** The Dayflow day (or, for `week_close`, the Monday) the run works on. */
  day: string;
  status: AutomationRunStatus;
  attempts: number;
  error?: string;
  /** The JSON payload recorded by the run that completed. */
  payload?: unknown;
  created_at: string;
  updated_at: string;
}

/** One brief as stored, keyed by `(kind, period_key)`. */
export interface BriefRecord {
  id: number;
  kind: BriefKind;
  /** The day key, or the Monday of the week. */
  period_key: string;
  title: string;
  body: string;
  model?: string;
  /** Optional structured data that goes with the body (the weekly memory digest). */
  payload?: unknown;
  /** Where the brief came from; `native` for briefs this plugin wrote. */
  source_id: string;
  /** The importer-facing key of the source record. */
  source_key: string;
  created_at: string;
  updated_at: string;
}

/** Optional filters for {@link listAutomationRuns}. */
export interface ListAutomationRunsOptions {
  job?: AutomationJob;
  day?: string;
  status?: AutomationRunStatus;
  limit?: number;
}

/** What a caller supplies when saving a brief. */
export interface UpsertBriefInput {
  kind: BriefKind;
  periodKey: string;
  title: string;
  body: string;
  model?: string;
  /** Optional structured data stored as JSON; omitted clears an earlier payload. */
  payload?: unknown;
  sourceKey: string;
}

/** Optional filters for {@link listBriefs}. */
export interface ListBriefsOptions {
  kind?: BriefKind;
  limit?: number;
}

const JOBS: ReadonlySet<string> = new Set<AutomationJob>(['day_close', 'week_close', 'lint']);
const STATUSES: ReadonlySet<string> = new Set<AutomationRunStatus>([
  'pending',
  'running',
  'complete',
  'failed',
  'skipped',
]);
const KINDS: ReadonlySet<string> = new Set<BriefKind>(['day', 'week']);

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
function storeCall<T>(operation: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof DayflowError) throw error;
    throw databaseError(`Could not ${operation} in the automation ledger: ${errorMessage(error)}`, error);
  }
}

/** A required `YYYY-MM-DD` day key, normalized through the Dayflow day window. */
function requireDay(value: unknown, field = 'day'): string {
  if (typeof value !== 'string') throw invalid(`An automation ${field} must be a YYYY-MM-DD string.`);
  const window = dayWindowForKey(value);
  if (window === undefined) {
    throw invalid(`"${value}" is not a ${field}. Use YYYY-MM-DD, for example 2026-03-11.`);
  }
  return window.dayKey;
}

/** A required job name. */
function requireJob(value: unknown): AutomationJob {
  if (typeof value !== 'string' || !JOBS.has(value)) {
    throw invalid(`An automation job must be one of ${[...JOBS].join(', ')}.`);
  }
  return value as AutomationJob;
}

/** A required run status. */
function requireStatus(value: unknown): AutomationRunStatus {
  if (typeof value !== 'string' || !STATUSES.has(value)) {
    throw invalid(`An automation run status must be one of ${[...STATUSES].join(', ')}.`);
  }
  return value as AutomationRunStatus;
}

/** A required brief kind. */
function requireKind(value: unknown): BriefKind {
  if (typeof value !== 'string' || !KINDS.has(value)) {
    throw invalid(`A brief kind must be one of ${[...KINDS].join(', ')}.`);
  }
  return value as BriefKind;
}

/** A required period key: a real `YYYY-MM-DD` day key. */
function requirePeriodKey(value: unknown): string {
  if (typeof value !== 'string') throw invalid('A brief period key must be a YYYY-MM-DD string.');
  const window = dayWindowForKey(value);
  if (window === undefined) {
    throw invalid(`"${value}" is not a period. Use YYYY-MM-DD, for example 2026-03-11.`);
  }
  return window.dayKey;
}

/** A required non-empty brief title, trimmed. */
function requireTitle(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid('A brief needs a non-empty title.');
  }
  return value.trim();
}

/** A required brief body; it may be empty, but it must be text. */
function requireBody(value: unknown): string {
  if (typeof value !== 'string') throw invalid('A brief body must be a string.');
  return value;
}

/** A required non-empty source key, trimmed. */
function requireSourceKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid('A brief needs a non-empty source key.');
  }
  return value.trim();
}

/** An optional trimmed model id; an empty string means absent. */
function optionalModel(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid('A brief model must be a string.');
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A required positive row id. */
function requireId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalid(`An automation row id must be a positive whole number (received ${String(value)}).`);
  }
  return value;
}

/** Validate a read limit, applying the store's default and upper bound. */
function resolveLimit(value: unknown): number {
  if (value === undefined || value === null) return AUTOMATION_DEFAULT_LIST_LIMIT;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > AUTOMATION_MAX_LIST_LIMIT) {
    throw invalid(`An automation limit must be an integer between 1 and ${String(AUTOMATION_MAX_LIST_LIMIT)}.`);
  }
  return value;
}

/** Truncate a failure message or skip reason to the stored maximum. */
function clampError(value: string): string {
  return value.length > AUTOMATION_MAX_ERROR_CHARS ? value.slice(0, AUTOMATION_MAX_ERROR_CHARS) : value;
}

/**
 * Serialize a run payload for its JSON column.
 *
 * JSON has no bigint, so one is stored as a number (the same convention the
 * importer uses). `undefined` (and a value JSON cannot represent) stores SQL
 * `NULL`; a circular object is refused as `invalid_input` rather than silently
 * dropped.
 */
function serializePayload(value: unknown): string | null {
  if (value === undefined) return null;
  let text: string | undefined;
  try {
    text = JSON.stringify(value, (_key, entry: unknown) => (typeof entry === 'bigint' ? Number(entry) : entry));
  } catch (error) {
    throw invalid(`The automation run payload must be JSON-serializable: ${errorMessage(error)}`);
  }
  return text === undefined ? null : text;
}

/** Decode one `payload_json` column; absent is absent, corrupt JSON is a database error. */
function parsePayload(value: unknown, rowLabel: string): unknown {
  if (value === null || value === undefined) return undefined;
  const raw = asText(value);
  if (raw === undefined) throw databaseError(`${rowLabel} has a non-text payload.`);
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw databaseError(`${rowLabel} has a corrupt JSON payload.`, error);
  }
}

/**
 * Decode a brief's optional `payload_json` column tolerantly.
 *
 * A run's payload is the ledger's record of what the job produced, so it must be
 * trustworthy and a corrupt one is a database error. A brief's payload is
 * supplementary data — the weekly memory-digest block — so a reader that cannot
 * decode it treats the brief as having no payload instead of failing a brief
 * whose body is still readable.
 */
function parseBriefPayload(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  const raw = asText(value);
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed === null ? undefined : parsed;
  } catch {
    return undefined;
  }
}

/** Decode a required timestamp column. */
function requireTimestamp(value: unknown, rowLabel: string, column: string): string {
  const text = asText(value);
  if (text === undefined || text.trim() === '') {
    throw databaseError(`${rowLabel} has an invalid ${column}.`);
  }
  return text;
}

/** Map one `automation_runs` row to the caller-facing run. */
function automationRunFromRow(row: Row): AutomationRun {
  const id = asInteger(row.id);
  if (id === undefined || id < 1) throw databaseError('An automation run row has no usable id.');
  const label = `Automation run #${String(id)}`;
  const job = asText(row.job);
  if (job === undefined || !JOBS.has(job)) throw databaseError(`${label} has an unknown job.`);
  const dayText = asText(row.day);
  const window = dayText === undefined ? undefined : dayWindowForKey(dayText);
  if (window === undefined) throw databaseError(`${label} has an invalid day.`);
  const status = asText(row.status);
  if (status === undefined || !STATUSES.has(status)) throw databaseError(`${label} has an unknown status.`);
  const attempts = asInteger(row.attempts);
  if (attempts === undefined || attempts < 0) throw databaseError(`${label} has an invalid attempt count.`);
  const rawError = row.error;
  let error: string | undefined;
  if (rawError !== null && rawError !== undefined) {
    const text = asText(rawError);
    if (text === undefined) throw databaseError(`${label} has a non-text error.`);
    error = text.trim() === '' ? undefined : text;
  }
  const payload = parsePayload(row.payload_json, label);
  return {
    id,
    job: job as AutomationJob,
    day: window.dayKey,
    status: status as AutomationRunStatus,
    attempts,
    ...(error === undefined ? {} : { error }),
    ...(payload === undefined ? {} : { payload }),
    created_at: requireTimestamp(row.created_at, label, 'created_at'),
    updated_at: requireTimestamp(row.updated_at, label, 'updated_at'),
  };
}

/** Map one `briefs` row to the caller-facing brief. */
function briefFromRow(row: Row): BriefRecord {
  const id = asInteger(row.id);
  if (id === undefined || id < 1) throw databaseError('A brief row has no usable id.');
  const label = `Brief #${String(id)}`;
  const kind = asText(row.kind);
  if (kind === undefined || !KINDS.has(kind)) throw databaseError(`${label} has an unknown kind.`);
  const rawPeriod = asText(row.period_key);
  const window = rawPeriod === undefined ? undefined : dayWindowForKey(rawPeriod);
  if (window === undefined) throw databaseError(`${label} has an invalid period key.`);
  const title = asText(row.title);
  if (title === undefined || title.trim() === '') throw databaseError(`${label} has no title.`);
  const body = asText(row.body);
  if (body === undefined) throw databaseError(`${label} has a non-text body.`);
  const rawModel = row.model;
  let model: string | undefined;
  if (rawModel !== null && rawModel !== undefined) {
    const text = asText(rawModel);
    if (text === undefined) throw databaseError(`${label} has a non-text model.`);
    model = text.trim() === '' ? undefined : text;
  }
  const sourceId = asText(row.source_id);
  if (sourceId === undefined || sourceId.trim() === '') throw databaseError(`${label} has no source id.`);
  const sourceKey = asText(row.source_key);
  if (sourceKey === undefined || sourceKey.trim() === '') throw databaseError(`${label} has no source key.`);
  const payload = parseBriefPayload(row.payload_json);
  return {
    id,
    kind: kind as BriefKind,
    period_key: window.dayKey,
    title,
    body,
    ...(model === undefined ? {} : { model }),
    ...(payload === undefined ? {} : { payload }),
    source_id: sourceId,
    source_key: sourceKey,
    created_at: requireTimestamp(row.created_at, label, 'created_at'),
    updated_at: requireTimestamp(row.updated_at, label, 'updated_at'),
  };
}

/** Read one automation run by its unique job and day, or `undefined` when absent. */
function readRun(db: DatabaseSync, job: AutomationJob, day: string): AutomationRun | undefined {
  const row = db.prepare('SELECT * FROM automation_runs WHERE job = ? AND day = ?').get(job, day) as Row | undefined;
  return row === undefined ? undefined : automationRunFromRow(row);
}

/** Read one automation run by id, or `undefined` when absent. */
function readRunById(db: DatabaseSync, id: number): AutomationRun | undefined {
  const row = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as Row | undefined;
  return row === undefined ? undefined : automationRunFromRow(row);
}

/** Read one brief by its unique kind and period, or `undefined` when absent. */
function readBrief(db: DatabaseSync, kind: BriefKind, periodKey: string): BriefRecord | undefined {
  const row = db.prepare('SELECT * FROM briefs WHERE kind = ? AND period_key = ?').get(kind, periodKey) as Row | undefined;
  return row === undefined ? undefined : briefFromRow(row);
}

/**
 * Read the run for one job and day.
 *
 * @returns the run, or `undefined` when the job has never been ensured.
 * @throws `invalid_input` for a malformed job or day; `database_error` for a
 * row no reader understands.
 */
export function getAutomationRun(db: DatabaseSync, job: AutomationJob, day: string): AutomationRun | undefined {
  const jobName = requireJob(job);
  const dayKey = requireDay(day);
  return storeCall('read a run', () => readRun(db, jobName, dayKey));
}

/**
 * Ensure the run for one job and day exists and return it.
 *
 * `(job, day)` is unique, so a second call returns the existing row untouched,
 * whatever state it has reached: the scheduler can call this on every tick
 * without resetting a completed or failed run.
 *
 * @throws `invalid_input` for a malformed job or day.
 */
export function ensureAutomationRun(db: DatabaseSync, job: AutomationJob, day: string): AutomationRun {
  const jobName = requireJob(job);
  const dayKey = requireDay(day);
  return storeCall('ensure a run', () => {
    db.prepare('INSERT OR IGNORE INTO automation_runs (job, day) VALUES (?, ?)').run(jobName, dayKey);
    const run = readRun(db, jobName, dayKey);
    if (run === undefined) {
      throw databaseError(`Automation run ${jobName} for ${dayKey} disappeared after it was created.`);
    }
    return run;
  });
}

/**
 * Move a pending or failed run to running and count the attempt.
 *
 * A run can be started again after a failure while it has attempts left (at
 * most {@link AUTOMATION_MAX_ATTEMPTS}); a running, complete, or skipped run is
 * refused, and so is a failed run that already used its attempts.
 *
 * @throws `not_found` when no run has the id; `invalid_input` for a state that
 * cannot start or a malformed id.
 */
export function startAutomationRun(db: DatabaseSync, id: number): AutomationRun {
  const runId = requireId(id);
  return storeCall('start a run', () => {
    const run = readRunById(db, runId);
    if (run === undefined) throw new DayflowError(`Automation run #${String(runId)} does not exist.`, 'not_found');
    if (run.status !== 'pending' && run.status !== 'failed') {
      throw invalid(`Automation run #${String(runId)} is ${run.status}; only a pending or failed run can start.`);
    }
    if (run.attempts >= AUTOMATION_MAX_ATTEMPTS) {
      throw invalid(`Automation run #${String(runId)} already used its ${String(AUTOMATION_MAX_ATTEMPTS)} attempts.`);
    }
    db.prepare(
      `UPDATE automation_runs
          SET status = 'running', attempts = attempts + 1, error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).run(runId);
    const updated = readRunById(db, runId);
    if (updated === undefined) throw databaseError(`Automation run #${String(runId)} disappeared after it was started.`);
    return updated;
  });
}

/**
 * Mark a run complete, recording the payload of the work that produced it.
 *
 * Completing a row again is harmless: it rewrites the status and the payload, so
 * a retried bookkeeping step cannot corrupt the ledger. A payload left out is
 * cleared, which keeps the row equal to the latest successful result.
 *
 * @throws `not_found` when no run has the id; `invalid_input` for a payload that
 * is not JSON-serializable.
 */
export function completeAutomationRun(db: DatabaseSync, id: number, payload?: unknown): AutomationRun {
  const runId = requireId(id);
  const payloadText = serializePayload(payload);
  return storeCall('complete a run', () => {
    if (readRunById(db, runId) === undefined) {
      throw new DayflowError(`Automation run #${String(runId)} does not exist.`, 'not_found');
    }
    db.prepare(
      `UPDATE automation_runs
          SET status = 'complete', error = NULL, payload_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).run(payloadText, runId);
    const updated = readRunById(db, runId);
    if (updated === undefined) throw databaseError(`Automation run #${String(runId)} disappeared after it completed.`);
    return updated;
  });
}

/**
 * Mark a run failed, keeping a bounded failure message for the next attempt.
 *
 * @throws `not_found` when no run has the id; `invalid_input` for a non-text error.
 */
export function failAutomationRun(db: DatabaseSync, id: number, error: string): AutomationRun {
  const runId = requireId(id);
  if (typeof error !== 'string') throw invalid('An automation run error must be a string.');
  const message = error.trim() === '' ? 'automation failed' : clampError(error.trim());
  return storeCall('fail a run', () => {
    if (readRunById(db, runId) === undefined) {
      throw new DayflowError(`Automation run #${String(runId)} does not exist.`, 'not_found');
    }
    db.prepare(
      `UPDATE automation_runs
          SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).run(message, runId);
    const updated = readRunById(db, runId);
    if (updated === undefined) throw databaseError(`Automation run #${String(runId)} disappeared after it failed.`);
    return updated;
  });
}

/**
 * Mark a run skipped without doing the work (automation disabled, no timeline,
 * or the day still in progress).
 *
 * The reason is what the panel shows, so it is required; `error` carries it
 * because a run has no separate reason column.
 *
 * @throws `not_found` when no run has the id; `invalid_input` for a blank reason.
 */
export function skipAutomationRun(db: DatabaseSync, id: number, reason: string): AutomationRun {
  const runId = requireId(id);
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw invalid('An automation run skip needs a non-empty reason.');
  }
  const message = clampError(reason.trim());
  return storeCall('skip a run', () => {
    if (readRunById(db, runId) === undefined) {
      throw new DayflowError(`Automation run #${String(runId)} does not exist.`, 'not_found');
    }
    db.prepare(
      `UPDATE automation_runs
          SET status = 'skipped', error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).run(message, runId);
    const updated = readRunById(db, runId);
    if (updated === undefined) throw databaseError(`Automation run #${String(runId)} disappeared after it was skipped.`);
    return updated;
  });
}

/**
 * List runs, most recently touched first (ties by descending id).
 *
 * `job`, `day`, and `status` narrow the list; `limit` defaults to
 * {@link AUTOMATION_DEFAULT_LIST_LIMIT} and must be between 1 and
 * {@link AUTOMATION_MAX_LIST_LIMIT}.
 *
 * @throws `invalid_input` for a malformed filter or limit.
 */
export function listAutomationRuns(
  db: DatabaseSync,
  options: ListAutomationRunsOptions = {},
): AutomationRun[] {
  const settings = options ?? {};
  const job = settings.job === undefined || settings.job === null ? undefined : requireJob(settings.job);
  const day = settings.day === undefined || settings.day === null ? undefined : requireDay(settings.day);
  const status = settings.status === undefined || settings.status === null ? undefined : requireStatus(settings.status);
  const limit = resolveLimit(settings.limit);
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];
  if (job !== undefined) {
    conditions.push('job = ?');
    parameters.push(job);
  }
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
  return storeCall('list runs', () => {
    const rows = db
      .prepare(`SELECT * FROM automation_runs${where} ORDER BY updated_at DESC, id DESC LIMIT ?`)
      .all(...(parameters as never[])) as Row[];
    return rows.map(automationRunFromRow);
  });
}

/**
 * Save (insert or rewrite) one brief.
 *
 * `(kind, period_key)` is unique: saving the same period again rewrites the
 * title, body, model, payload, and source key in place while keeping the `id`
 * and `created_at`, so regenerating a brief never piles up copies. The source id
 * is `native` until an importer writes briefs from another store. The payload is
 * JSON-serialized; a payload left out clears an earlier one, so the row always
 * holds the latest result.
 *
 * @throws `invalid_input` for a malformed kind, period, title, or source key, or
 *   for a payload that is not JSON-serializable.
 */
export function upsertBrief(db: DatabaseSync, input: UpsertBriefInput): BriefRecord {
  if (input === undefined || input === null) throw invalid('A brief input is required.');
  const kind = requireKind(input.kind);
  const periodKey = requirePeriodKey(input.periodKey);
  const title = requireTitle(input.title);
  const body = requireBody(input.body);
  const model = optionalModel(input.model);
  const payloadText = serializePayload(input.payload);
  const sourceKey = requireSourceKey(input.sourceKey);
  return storeCall('save a brief', () => {
    db.prepare(
      `INSERT INTO briefs (kind, period_key, title, body, model, payload_json, source_id, source_key)
       VALUES (?, ?, ?, ?, ?, ?, 'native', ?)
       ON CONFLICT (kind, period_key) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         model = excluded.model,
         payload_json = excluded.payload_json,
         source_key = excluded.source_key,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(kind, periodKey, title, body, model ?? null, payloadText, sourceKey);
    const brief = readBrief(db, kind, periodKey);
    if (brief === undefined) throw databaseError(`Brief ${kind} ${periodKey} disappeared after it was saved.`);
    return brief;
  });
}

/**
 * Read one brief by its kind and period.
 *
 * @returns the brief, or `undefined` when that period has no brief yet.
 * @throws `invalid_input` for a malformed kind or period.
 */
export function getBrief(db: DatabaseSync, kind: BriefKind, periodKey: string): BriefRecord | undefined {
  const briefKind = requireKind(kind);
  const period = requirePeriodKey(periodKey);
  return storeCall('read a brief', () => readBrief(db, briefKind, period));
}

/**
 * List briefs, most recently touched first (ties by descending id).
 *
 * `kind` narrows the list; `limit` defaults to
 * {@link AUTOMATION_DEFAULT_LIST_LIMIT} and must be between 1 and
 * {@link AUTOMATION_MAX_LIST_LIMIT}.
 *
 * @throws `invalid_input` for a malformed kind or limit.
 */
export function listBriefs(db: DatabaseSync, options: ListBriefsOptions = {}): BriefRecord[] {
  const settings = options ?? {};
  const kind = settings.kind === undefined || settings.kind === null ? undefined : requireKind(settings.kind);
  const limit = resolveLimit(settings.limit);
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];
  if (kind !== undefined) {
    conditions.push('kind = ?');
    parameters.push(kind);
  }
  const where = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
  parameters.push(limit);
  return storeCall('list briefs', () => {
    const rows = db
      .prepare(`SELECT * FROM briefs${where} ORDER BY updated_at DESC, id DESC LIMIT ?`)
      .all(...(parameters as never[])) as Row[];
    return rows.map(briefFromRow);
  });
}
