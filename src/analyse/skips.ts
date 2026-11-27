/**
 * Transient-skip catch-up: give a skipped analysis window a second chance.
 *
 * A skipped job is the ledger's record that **no model call was made** — the
 * consent gate, the pause flag, or the unset-provider gate refused the window
 * before anything was spent. That makes a skip safe to replay when the reason
 * was configuration, and unsafe when it was money: raising a call or token cap
 * must not silently re-analyse a past day, and a failed call is not a skip.
 * This module is the one place that draws that line:
 *
 * - {@link TRANSIENT_SKIP_REASONS} is the whitelist of configuration reasons
 *   that may be replayed; every other reason (including `budget`,
 *   `budget-tokens`, an unknown future one, or a `failed` job) is permanent.
 *   The default is "do not replay", so a new reason added elsewhere stays
 *   un-replayed until it is deliberately listed here.
 * - {@link replaySkippedAnalysisWindows} moves today's and yesterday's
 *   transient skips back to `queued`, inside the day window the worker actually
 *   runs. Older days are never touched: the cost of a catch-up is bounded by
 *   the day's own remaining call and token budgets, and by `limit`.
 *
 * The requeue is a **conditional** `UPDATE ... WHERE id = ? AND status =
 * 'skipped'`, so a worker tick and a manual `/dayflow-analyze` racing for the
 * same row cannot replay it twice; the loser simply counts it as still
 * skipped. `attempts` is deliberately **not** reset: a skip never consumed an
 * attempt, so a replayed window starts at attempt 1 of 2 exactly like a fresh
 * one, and a replayed call that fails is handled by the existing
 * `ANALYSIS_MAX_ATTEMPTS` logic. The old skip reason is copied into the row's
 * `payload_json` (`replayed_from` / `replayed_at`) before `error` is cleared,
 * so the reason does not disappear from the ledger when the job is started
 * again.
 *
 * This module touches only the journal. It reads no configuration, calls no
 * model, and makes no network request; the caller decides whether a catch-up
 * is allowed and on which days.
 * @module dsh-plugin-dayflow/analyse/skips
 */

import type { DatabaseSync } from 'node:sqlite';

import { dayWindowContaining, previousDayKey } from '../day.js';
import { DayflowError } from '../errors.js';
import { withJournalWrite } from '../journal.js';

/**
 * The skip reasons a configuration or a temporary user action can repair.
 *
 * Every reason here means "the gate refused this window before a call"; none of
 * them spent money or said anything about the day's content. Reasons that are
 * absent from the list are never replayed automatically.
 */
export const TRANSIENT_SKIP_REASONS = [
  'analysis-disabled',
  'capture-disabled',
  'paused',
  'consent:none',
  'provider-unset',
  'model-unset',
  'consent:provider-not-local',
  'analyser-unset',
] as const;

/** One skip reason that may be replayed. */
export type TransientSkipReason = (typeof TRANSIENT_SKIP_REASONS)[number];

const TRANSIENT_REASON_SET: ReadonlySet<string> = new Set<string>(TRANSIENT_SKIP_REASONS);

/** Days considered before today when the caller states none: yesterday. */
export const ANALYSIS_SKIP_REPLAY_DEFAULT_DAYS_BACK = 1;

/** Upper bound for `daysBack`, so one pass can never sweep an unbounded history. */
export const ANALYSIS_SKIP_REPLAY_MAX_DAYS_BACK = 366;

/** Rows requeued per pass when the caller states no limit. */
export const ANALYSIS_SKIP_REPLAY_DEFAULT_LIMIT = 200;

/** Upper bound for `limit`. */
export const ANALYSIS_SKIP_REPLAY_MAX_LIMIT = 1000;

/** One raw SQLite row, keyed by column name. */
type Row = Record<string, unknown>;

/** What {@link replaySkippedAnalysisWindows} needs. */
export interface ReplaySkippedOptions {
  /** Path to the plugin-owned journal (created/migrated if absent). */
  journalPath: string;
  /** Injectable clock, so tests are not time-dependent. */
  now?: () => Date;
  /** How many earlier days besides today to consider; default 1 (today + yesterday). */
  daysBack?: number;
  /** Max rows to requeue in one pass; default 200, 1..1000. */
  limit?: number;
}

/** What one replay pass did. */
export interface ReplaySkippedResult {
  /**
   * The `skipped` rows the day window held when the pass looked. This is the
   * candidate set: it includes permanent skips (`budget` and friends), which
   * are counted here because the pass had to classify them, but never requeued.
   */
  considered: number;
  /** Rows actually moved `skipped → queued` by this pass (bounded by `limit`). */
  replayed: number;
  /** The replayed rows broken down by the skip reason they were replayed from. */
  byReason: Record<string, number>;
}

/** A skip reason a replay may repair. */
export function isTransientSkipReason(reason: string | undefined): reason is TransientSkipReason {
  return reason !== undefined && TRANSIENT_REASON_SET.has(reason);
}

function invalid(message: string): DayflowError {
  return new DayflowError(message, 'invalid_input');
}

function databaseError(message: string, cause: unknown): DayflowError {
  return new DayflowError(message, 'database_error', { cause });
}

/** A required non-empty journal path. */
function requireJournalPath(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid('A non-empty journalPath is required to replay skipped analysis windows.');
  }
  return value;
}

/** Resolve `daysBack`, the number of earlier days besides today. */
function resolveDaysBack(value: unknown): number {
  if (value === undefined || value === null) return ANALYSIS_SKIP_REPLAY_DEFAULT_DAYS_BACK;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > ANALYSIS_SKIP_REPLAY_MAX_DAYS_BACK
  ) {
    throw invalid(
      `daysBack must be a whole number between 0 and ${String(ANALYSIS_SKIP_REPLAY_MAX_DAYS_BACK)} ` +
        `(received ${String(value)}).`,
    );
  }
  return value;
}

/** Resolve `limit`, the maximum number of rows one pass may requeue. */
function resolveLimit(value: unknown): number {
  if (value === undefined || value === null) return ANALYSIS_SKIP_REPLAY_DEFAULT_LIMIT;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > ANALYSIS_SKIP_REPLAY_MAX_LIMIT
  ) {
    throw invalid(
      `limit must be a whole number between 1 and ${String(ANALYSIS_SKIP_REPLAY_MAX_LIMIT)} ` +
        `(received ${String(value)}).`,
    );
  }
  return value;
}

/** Resolve the `now` clock to one validated instant. */
function resolveNowInstant(value: unknown): Date {
  if (value === undefined || value === null) return new Date();
  if (typeof value !== 'function') {
    throw invalid('now must be a function returning a Date.');
  }
  let instant: unknown;
  try {
    instant = (value as () => unknown)();
  } catch (cause) {
    throw invalid(`now threw instead of returning a Date: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw invalid('now must return a valid Date.');
  }
  return instant;
}

/** The day keys a pass considers: today, then `daysBack` days before it. */
function dayWindowKeys(today: string, daysBack: number): string[] {
  const keys = [today];
  let key = today;
  for (let index = 0; index < daysBack; index += 1) {
    key = previousDayKey(key);
    keys.push(key);
  }
  return keys;
}

/**
 * Parse a stored payload tolerantly.
 *
 * `payload_json` is written by earlier versions and by hand-edited journals, so
 * a missing, unparsable, or non-object payload is treated as "no payload"
 * rather than failing the replay.
 */
function payloadObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // A malformed payload is simply absent; the audit below still gets written.
  }
  return {};
}

/**
 * The `payload_json` a replayed row is given: its old payload keys, plus the
 * audit of the skip this pass repaired.
 */
function auditPayload(raw: unknown, reason: string, replayedAt: Date): string {
  return JSON.stringify({
    ...payloadObject(raw),
    replayed_from: reason,
    replayed_at: replayedAt.toISOString(),
  });
}

/** SQLite reports changes as a number or a BigInt, depending on the binding. */
function affectedRows(changes: number | bigint): number {
  return typeof changes === 'bigint' ? Number(changes) : changes;
}

/** A positive row id from a query row. */
function requireRowId(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'bigint' && value > BigInt(0) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  throw databaseError(`An analysis-job row has no usable id (received ${String(value)}).`, undefined);
}

/** One validated replay pass. */
interface ReplayPass {
  readonly days: readonly string[];
  readonly limit: number;
  readonly now: Date;
}

/** Count `byReason` with a plain object, so a reason is a data key and never a prototype. */
function countReason(byReason: Record<string, number>, reason: string): void {
  byReason[reason] = (byReason[reason] ?? 0) + 1;
}

/**
 * Replay every transient skip the considered day window holds.
 *
 * The whole pass runs inside one short-lived, writable journal connection (no
 * connection is held across an `await`), and every requeue is a conditional
 * update so a concurrent worker or manual analysis cannot double-replay a row.
 */
function replayPass(db: DatabaseSync, pass: ReplayPass): ReplaySkippedResult {
  // Bound the window by its actual day keys, so a row can never be replayed
  // from a day the worker will not run for.
  const placeholders = pass.days.map(() => '?').join(', ');
  const byReason: Record<string, number> = {};
  let replayed = 0;
  try {
    const candidates = db
      .prepare(
        `SELECT id, error, payload_json
           FROM analysis_jobs
          WHERE status = 'skipped' AND day IN (${placeholders})
          ORDER BY id ASC`,
      )
      .all(...pass.days) as Row[];

    if (candidates.length > 0) {
      const requeue = db.prepare(
        `UPDATE analysis_jobs
            SET status = 'queued', error = NULL, updated_at = CURRENT_TIMESTAMP, payload_json = ?
          WHERE id = ? AND status = 'skipped'`,
      );
      for (const row of candidates) {
        if (replayed >= pass.limit) break;
        const reason = typeof row.error === 'string' ? row.error : undefined;
        if (!isTransientSkipReason(reason)) continue;
        // A row that lost the race is no longer `skipped`, so this matches
        // nothing and the window stays with whoever won.
        const result = requeue.run(auditPayload(row.payload_json, reason, pass.now), requireRowId(row.id));
        if (affectedRows(result.changes) === 1) {
          replayed += 1;
          countReason(byReason, reason);
        }
      }
    }
    return { considered: candidates.length, replayed, byReason };
  } catch (error) {
    if (error instanceof DayflowError) throw error;
    throw databaseError(
      `Could not replay skipped analysis windows: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}

/**
 * Requeue the transiently-skipped analysis windows of today and the recent days.
 *
 * Only `skipped` rows whose `error` is on {@link TRANSIENT_SKIP_REASONS} move
 * back to `queued`; `budget`, `budget-tokens`, `failed`, and unknown reasons are
 * never replayed. The day window is today (the 04:00-bounded Dayflow day
 * containing `now`) plus `daysBack` earlier days — by default yesterday, so a
 * config fix later in the same day still catches the tail of the previous one.
 *
 * The pass is idempotent: the second call on the same rows finds them `queued`
 * and replays nothing. It spent nothing: a requeued window is analysed by the
 * normal pipeline later, under that day's own remaining budget.
 *
 * @param options - the journal to read, the clock, and the window bounds.
 * @returns what the pass considered, replayed, and the reasons it repaired.
 * @throws `invalid_input` for a malformed journal path, clock, `daysBack`, or
 * `limit`; `database_error` when the journal cannot be read or written.
 */
export async function replaySkippedAnalysisWindows(
  options: ReplaySkippedOptions,
): Promise<ReplaySkippedResult> {
  if (options === null || typeof options !== 'object') {
    throw invalid('replaySkippedAnalysisWindows needs an options object.');
  }
  const journalPath = requireJournalPath(options.journalPath);
  const daysBack = resolveDaysBack(options.daysBack);
  const limit = resolveLimit(options.limit);
  const now = resolveNowInstant(options.now);
  const days = dayWindowKeys(dayWindowContaining(now).dayKey, daysBack);
  return withJournalWrite(journalPath, (db) => replayPass(db, { days, limit, now }));
}
