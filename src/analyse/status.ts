/**
 * The analysis status the panel reads: the switches, the consent gate's
 * answer, the worker's state, and the current day's budget ledger.
 *
 * The ledger is the analysis-job table, not a second counter: a call is a job
 * that was actually started (`attempts > 0`), and the day's tokens are the
 * usage recorded on the completed jobs. That keeps the status honest even
 * after a restart, because it reads what the pipeline already wrote. The same
 * reading decides `tokenBudgetExhausted`, the line the panel shows when the
 * day's spend has reached the configured token cap.
 *
 * Reading status is a pure read: a missing journal answers all zeros without
 * creating the file, and an unreadable journal answers zeros rather than
 * failing the panel line. The switches always come from the resolved
 * configuration, and the blocked reason is the consent gate's own answer, so
 * the panel and the worker cannot disagree about why analysis is idle.
 * @module dsh-plugin-dayflow/analyse/status
 */

import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type { ResolvedConfig } from '../config.js';
import { dayWindowContaining } from '../day.js';
import { DayflowError } from '../errors.js';
import { withJournal } from '../journal.js';
import { decideAnalysis } from './consent.js';
import { analysisTokenTotalsForDay, countAnalysisCallsForDay } from './jobs.js';

/** What the caller knows about the analysis runtime. */
export interface AnalysisStatusInput {
  /** Absolute path to the owned journal; it may not exist yet. */
  journalPath: string;
  /** The resolved configuration (analysis and capture blocks are read). */
  config: ResolvedConfig;
  /** Whether the user paused capture (`capture_state.paused`). */
  paused: boolean;
  /** The worker's state, when the composition has started one. */
  worker?: { running: boolean };
  /** Injectable clock, so the reported day is deterministic in tests. */
  now?: () => Date;
}

/** One day's ledger, as the panel's status line renders it. */
export interface AnalysisStatusPayload {
  /** `analysis.enabled` and `capture.enabled`: nothing can run unless both are on. */
  enabled: boolean;
  /** Where frames may be analysed, as configured. */
  consent: 'none' | 'cloud' | 'local';
  /** Minutes between worker ticks, as configured. */
  intervalMinutes: number;
  /** Whether the composition's worker is currently scheduled. */
  worker: 'running' | 'stopped';
  /** Jobs created for today but never started. */
  queued: number;
  /** Jobs started and not yet finished. */
  running: number;
  /** Jobs that produced an activity today. */
  completed: number;
  /** Jobs that failed their attempt (a retry may still be pending). */
  failed: number;
  /** Jobs deliberately skipped today, for example by the consent gate. */
  skipped: number;
  /** Model calls started today (`attempts > 0`). */
  callsToday: number;
  /** The configured daily call cap. */
  maxCallsPerDay: number;
  /** Tokens recorded on today's completed jobs. */
  tokensToday: { input: number; output: number };
  /** The configured daily token cap, enforced by the pipeline's post-call gate. */
  dailyTokenBudget: number;
  /**
   * Whether today's recorded tokens have reached `dailyTokenBudget`.
   *
   * True means the pipeline's post-call token gate stops starting new calls for
   * the rest of the Dayflow day; the 04:00 day boundary is what resets it.
   */
  tokenBudgetExhausted: boolean;
  /** Epoch milliseconds of the most recent job activity today, when there is one. */
  lastJobAt?: number;
  /** The consent gate's blocked reason; absent when analysis is allowed. */
  reason?: string;
}

/** Counts by job state; the ledger's `complete` is the payload's `completed`. */
interface JobCounts {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
}

/** One raw SQLite row, keyed by column name. */
interface Row {
  readonly [key: string]: unknown;
}

/** The counts a journal with no jobs today (or no journal at all) reports. */
const EMPTY_COUNTS: JobCounts = { queued: 0, running: 0, completed: 0, failed: 0, skipped: 0 };

/** One day's ledger values, read in one short read-only connection. */
interface DayLedger {
  counts: JobCounts;
  calls: number;
  tokens: { input: number; output: number };
  lastJobAt?: number;
}

/** SQLite may hand back BIGINT on some Node builds; keep the reading numeric. */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
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

/** A `COUNT(*)` result, which cannot be negative. */
function asCount(value: unknown): number {
  const count = asNumber(value);
  if (count === undefined || count < 0) {
    throw new DayflowError('The analysis status count is not a non-negative whole number.', 'database_error');
  }
  return count;
}

/** Count today's jobs by state. A state no reader understands is a database error. */
function readJobCounts(db: DatabaseSync, day: string): JobCounts {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS count FROM analysis_jobs WHERE day = ? GROUP BY status')
    .all(day) as unknown as Row[];
  const counts: JobCounts = { ...EMPTY_COUNTS };
  for (const row of rows) {
    const count = asCount(row.count);
    switch (row.status) {
      case 'queued':
        counts.queued = count;
        break;
      case 'running':
        counts.running = count;
        break;
      case 'complete':
        counts.completed = count;
        break;
      case 'failed':
        counts.failed = count;
        break;
      case 'skipped':
        counts.skipped = count;
        break;
      default:
        throw new DayflowError(
          `The analysis-job ledger holds an unknown status "${String(row.status)}".`,
          'database_error',
        );
    }
  }
  return counts;
}

/**
 * Epoch milliseconds of the day's most recent job activity.
 *
 * Two columns can describe it: `window_end_ts` is the newest analysed instant,
 * and `updated_at` is when a job last changed state (started, completed,
 * failed). The later of the two is what the panel shows, and both are stored in
 * epoch seconds, so the reading converts once at the end.
 */
function readLastJobAt(db: DatabaseSync, day: string): number | undefined {
  const row = db
    .prepare(
      `SELECT MAX(window_end_ts) AS window_end,
              MAX(strftime('%s', updated_at)) AS updated
         FROM analysis_jobs WHERE day = ?`,
    )
    .get(day) as Row | undefined;
  const candidates = [asNumber(row?.window_end), asNumber(row?.updated)].filter(
    (value): value is number => value !== undefined && value >= 0,
  );
  if (candidates.length === 0) return undefined;
  return Math.max(...candidates) * 1000;
}

/** Read one day's job counts, calls, tokens, and newest job time. */
function readDayLedger(db: DatabaseSync, day: string): DayLedger {
  return {
    counts: readJobCounts(db, day),
    calls: countAnalysisCallsForDay(db, day),
    tokens: analysisTokenTotalsForDay(db, day),
    lastJobAt: readLastJobAt(db, day),
  };
}

/**
 * Build the analysis status payload for the panel.
 *
 * A missing journal is not an error: analysis has never recorded anything, so
 * the counts stay zero and the file is not created by a read. The same fallback
 * applies to an unreadable journal, because a status line has to answer even
 * when the journal cannot be opened.
 *
 * @param input - the journal path, resolved config, pause flag, worker state,
 *   and an optional clock.
 * @returns the status payload; never creates a journal file.
 */
export async function buildAnalysisStatus(input: AnalysisStatusInput): Promise<AnalysisStatusPayload> {
  const now = input.now?.() ?? new Date();
  const today = dayWindowContaining(now).dayKey;
  const decision = decideAnalysis({
    analysis: input.config.analysis,
    capture: input.config.capture,
    paused: input.paused,
  });

  const payload: AnalysisStatusPayload = {
    enabled: input.config.analysis.enabled && input.config.capture.enabled,
    consent: input.config.analysis.consent,
    intervalMinutes: input.config.analysis.intervalMinutes,
    worker: input.worker?.running === true ? 'running' : 'stopped',
    ...EMPTY_COUNTS,
    callsToday: 0,
    maxCallsPerDay: input.config.analysis.maxCallsPerDay,
    tokensToday: { input: 0, output: 0 },
    dailyTokenBudget: input.config.analysis.dailyTokenBudget,
    tokenBudgetExhausted: false,
  };
  if (!decision.allowed) payload.reason = decision.reason;

  if (!existsSync(input.journalPath)) return payload;

  let ledger: DayLedger | undefined;
  try {
    ledger = withJournal(input.journalPath, (db) => readDayLedger(db, today));
  } catch {
    // A status read must not fail the panel: an unreadable journal reads as if
    // no analysis has run, and the consent/switch fields above stay accurate.
    return payload;
  }

  payload.queued = ledger.counts.queued;
  payload.running = ledger.counts.running;
  payload.completed = ledger.counts.completed;
  payload.failed = ledger.counts.failed;
  payload.skipped = ledger.counts.skipped;
  payload.callsToday = ledger.calls;
  payload.tokensToday = ledger.tokens;
  payload.tokenBudgetExhausted = ledger.tokens.input + ledger.tokens.output >= payload.dailyTokenBudget;
  if (ledger.lastJobAt !== undefined) payload.lastJobAt = ledger.lastJobAt;
  return payload;
}
