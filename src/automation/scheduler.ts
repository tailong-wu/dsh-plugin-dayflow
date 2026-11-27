/**
 * The scheduled day and week close: the clock half of "the day closes itself".
 *
 * The composition injects what a close *does* (a daily brief plus the day's
 * insight pass, a weekly rollup) and this module owns when it runs and how the
 * ledger remembers it:
 *
 * - **The day close runs at `automation.dailyAt`** (04:00 by default, the
 *   Dayflow boundary). The boundary at 04:00 on a date ends the Dayflow day
 *   labelled with the previous date, so that is the day the close works on: a
 *   day that is still in progress is never closed.
 * - **Catch-up is bounded.** The most recent due day is always a candidate. A
 *   missed day is caught up only while it is inside the window of
 *   `automation.catchUpDays` days counting the due day; the first missed day
 *   just outside the window is recorded as `skipped` with
 *   `older-than-catch-up`, so the ledger says what happened instead of
 *   pretending an older day was closed. With `automation.catchUpOnStart: false`
 *   the window shrinks to the due day itself, so a restart does not replay old
 *   days.
 * - **The week close runs on `automation.weeklyOn`** at the same boundary. A
 *   close at Monday 04:00 summarizes the week that just ended (the week whose
 *   Monday is seven days back), and a missed week is caught up only while it is
 *   the immediately preceding week.
 * - **The ledger decides.** `automation_runs` has one row per `(job, day)`, so
 *   `ensure` is idempotent, a `complete` or `skipped` row is terminal, a
 *   `running` row left by a previous process is skipped as stale, and a `failed`
 *   row is retried while it has attempts left (at most
 *   {@link AUTOMATION_MAX_ATTEMPTS}). A failing close never blocks another job.
 * - **One timer, no overlap.** The next timer is armed only after the current
 *   pass settles, so passes never overlap, a double `start` still arms one
 *   timer, and `stop` plus a generation counter keep a stopped scheduler from
 *   arming another. Consecutive failures move the next pass earlier with a
 *   doubling delay (capped at {@link AUTOMATION_MAX_BACKOFF_DOUBLINGS}); a
 *   success restores the scheduled boundary.
 *
 * The scheduler never calls a model and never cleans the database: it touches
 * `automation_runs` through {@link ./store} and awaits the injected callbacks.
 * @module dsh-plugin-dayflow/automation/scheduler
 */

import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type { ResolvedConfig } from '../config.js';
import { dayWindowContaining, dayWindowForKey, formatDayKey } from '../day.js';
import { withJournal, withJournalWrite } from '../journal.js';
import {
  AUTOMATION_MAX_ATTEMPTS,
  completeAutomationRun,
  ensureAutomationRun,
  failAutomationRun,
  listAutomationRuns,
  skipAutomationRun,
  startAutomationRun,
} from './store.js';
import type { AutomationJob, AutomationRun, AutomationRunStatus } from './store.js';

/** What one close callback reports back to the scheduler. */
export interface AutomationCloseOutcome {
  /** `complete` wrote something or had nothing to do, `skipped` is a gate, `failed` may retry. */
  status: 'complete' | 'failed' | 'skipped';
  /** Why the close failed or was skipped; kept on the run when present. */
  error?: string;
}

/** A timer seam so tests can drive the loop without waiting. */
export interface AutomationSchedulerTimers {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Everything the scheduler needs; every optional field has a production default. */
export interface AutomationSchedulerOptions {
  /** The plugin-owned journal that holds the automation ledger. */
  journalPath: string;
  /** Resolved plugin config; only the `automation` block is read. */
  config: ResolvedConfig;
  /** Runs the day's closes for one Dayflow day; injected by the composition. */
  runDayClose: (day: string) => Promise<AutomationCloseOutcome>;
  /** Runs the week's close for one period Monday; injected by the composition. */
  runWeekClose: (monday: string) => Promise<AutomationCloseOutcome>;
  /** Injectable clock, so a test can fix the boundary without waiting. */
  now?: () => Date;
  /** Injectable timers, so a test can step the loop. */
  timers?: AutomationSchedulerTimers;
  /** Structured event sink; the default is silent. */
  logger?: (event: string, detail?: Record<string, unknown>) => void;
}

/** The scheduler's live status, which the panel injects into its close line. */
export interface AutomationSchedulerStatus {
  /** The profile's `automation.enabled` master switch. */
  enabled: boolean;
  /** Whether a close pass is running right now (the panel shows "closing now"). */
  running: boolean;
  /** The local time the day closes, as `HH:MM`. */
  dailyAt: string;
  /** The weekday the week closes, lowercase English. */
  weeklyOn: string;
  /** Size of the bounded catch-up window, in days, including the due day. */
  catchUpDays: number;
  /** The most recent day close this process recorded or read back. */
  lastDayClose?: { day: string; status: string; at: number };
  /** The most recent week close this process recorded or read back. */
  lastWeekClose?: { monday: string; status: string; at: number };
  /** Epoch milliseconds of the next scheduled day close; absent when disabled. */
  nextDayCloseAt?: number;
}

/** How many times a consecutive-failure delay may double before it stops growing. */
export const AUTOMATION_MAX_BACKOFF_DOUBLINGS = 5;

/** The first retry wait after a failed close; each further failure doubles it. */
export const AUTOMATION_RETRY_BASE_MS = 5 * 60_000;

/** The skip reason written for a missed day outside the catch-up window. */
export const OLDER_THAN_CATCH_UP = 'older-than-catch-up';

/** The skip reason written for a `running` run left behind by an earlier process. */
export const STALE_RUNNING = 'stale-running';

/** How many ledger rows one planning read looks at; well past any live window. */
const LEDGER_SCAN_LIMIT = 200;

/** The production loop: the process timers. */
const DEFAULT_TIMERS: AutomationSchedulerTimers = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

/** The weekday numbers `Date.getDay()` returns, keyed by the configured name. */
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** A failure's message, whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Copy a date and shift it by whole local calendar days, keeping the wall clock. */
function addLocalDays(date: Date, days: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

/** The `YYYY-MM-DD` label after shifting a day key by whole days. */
function addDaysKey(day: string, days: number): string {
  const window = dayWindowForKey(day);
  if (window === undefined) throw new Error(`"${day}" is not a Dayflow day key`);
  return formatDayKey(addLocalDays(window.start, days));
}

/** Compare two `YYYY-MM-DD` labels; lexical order is chronological order. */
function compareDayKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The later of two day keys. */
function laterDayKey(left: string, right: string): string {
  return compareDayKeys(left, right) >= 0 ? left : right;
}

/** Parse the configured `HH:MM` close time into clock parts. */
function parseClock(dailyAt: string): { hour: number; minute: number } {
  const [hourText, minuteText] = dailyAt.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (Number.isInteger(hour) && Number.isInteger(minute)) return { hour, minute };
  // resolveConfig rejects a malformed time; a hand-built config falls back to
  // the documented default rather than scheduling a NaN timeout.
  return { hour: 4, minute: 0 };
}

/** The Monday of the Dayflow week containing a day key. */
function mondayOfDay(day: string): string {
  const window = dayWindowForKey(day);
  if (window === undefined) throw new Error(`"${day}" is not a Dayflow day key`);
  const daysSinceMonday = (window.start.getDay() + 6) % 7;
  return formatDayKey(addLocalDays(window.start, -daysSinceMonday));
}

/** Whether a run is done being retried: terminal, or failed with every attempt used. */
function isSettledRun(run: AutomationRun): boolean {
  if (run.status === 'complete' || run.status === 'skipped') return true;
  return run.status === 'failed' && run.attempts >= AUTOMATION_MAX_ATTEMPTS;
}

/** The newest settled run's day in a ledger slice, if any. */
function latestSettledDay(runs: readonly AutomationRun[]): string | undefined {
  let latest: string | undefined;
  for (const run of runs) {
    if (!isSettledRun(run)) continue;
    if (latest === undefined || compareDayKeys(run.day, latest) > 0) latest = run.day;
  }
  return latest;
}

/** The retry wait for a consecutive-failure count; the first failure already doubles. */
function retryDelayMs(consecutiveFailures: number): number {
  const failures = Math.max(1, consecutiveFailures);
  const doublings = Math.min(failures, AUTOMATION_MAX_BACKOFF_DOUBLINGS);
  return AUTOMATION_RETRY_BASE_MS * 2 ** doublings;
}

/** Parse a SQLite `CURRENT_TIMESTAMP` (UTC, `YYYY-MM-DD HH:MM:SS`) into epoch ms. */
function timestampMs(text: string): number {
  const parsed = Date.parse(`${text.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Per-job retry bookkeeping: an early pass after a failure, and its backoff. */
interface RetryState {
  retryAt?: number;
  failures: number;
}

/** One planning pass's day work: what to close, and what to archive as skipped. */
interface DayPlan {
  runDays: string[];
  skipDays: string[];
}

/** One planning pass's week work: what to close, and what to archive as skipped. */
interface WeekPlan {
  runWeeks: string[];
  skipWeeks: string[];
}

/**
 * The scheduled day and week close.
 *
 * Construction does nothing and reads nothing; {@link start} mounts the loop,
 * runs one catch-up pass immediately, and arms a recursive timer for the next
 * boundary. The class is deliberately small: the ledger owns idempotency and
 * the callbacks own the work.
 */
export class AutomationScheduler {
  private readonly journalPath: string;

  private readonly config: ResolvedConfig;

  private readonly options: AutomationSchedulerOptions;

  private readonly now: () => Date;

  private readonly timers: AutomationSchedulerTimers;

  private readonly logger: (event: string, detail?: Record<string, unknown>) => void;

  /** Whether the loop is mounted; a `start` while true is a no-op. */
  private started = false;

  /** Bumped by start and stop, so a stale async pass never arms another timer. */
  private generation = 0;

  /** The pending boundary (or retry) timer, undefined while a pass runs or when stopped. */
  private timerHandle: unknown;

  /** Whether a close pass is running; the status line shows "closing now". */
  private closing = false;

  /** Serializes passes so a command and a timer tick cannot start one run twice. */
  private queue: Promise<void> = Promise.resolve();

  /** The most recent closes this process recorded or read from the ledger. */
  private lastDayClose: { day: string; status: string; at: number } | undefined;

  private lastWeekClose: { monday: string; status: string; at: number } | undefined;

  /** Retry bookkeeping per job; a failure re-arms only its own job's early pass. */
  private readonly retry: Record<AutomationJob, RetryState> = {
    day_close: { failures: 0 },
    week_close: { failures: 0 },
  };

  constructor(options: AutomationSchedulerOptions) {
    this.options = options;
    this.journalPath = options.journalPath;
    this.config = options.config;
    this.now = options.now ?? (() => new Date());
    this.timers = options.timers ?? DEFAULT_TIMERS;
    this.logger = options.logger ?? (() => {});
  }

  /**
   * Mount the loop.
   *
   * Idempotent: a second call while running changes nothing. The first pass
   * runs immediately (the catch-up), and only after it settles is the next
   * boundary timer armed, so passes never overlap. With automation switched off
   * nothing is armed at all.
   */
  start(): void {
    if (!this.config.automation.enabled) return;
    if (this.started) return;
    this.started = true;
    this.generation += 1;
    this.primeFromLedger();
    void this.runPass(this.generation);
  }

  /**
   * Stop the loop: clear the pending timer and make any in-flight pass finish
   * without arming another. A later {@link start} resumes from the ledger, so a
   * restart can never duplicate a close.
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.generation += 1;
    this.clearTimer();
  }

  /**
   * The live status the panel's close line shows.
   *
   * @returns the switches, the last closes seen, and the next day boundary.
   */
  status(): AutomationSchedulerStatus {
    const automation = this.config.automation;
    const status: AutomationSchedulerStatus = {
      enabled: automation.enabled,
      running: this.closing,
      dailyAt: automation.dailyAt,
      weeklyOn: automation.weeklyOn,
      catchUpDays: automation.catchUpDays,
      ...(this.lastDayClose === undefined ? {} : { lastDayClose: { ...this.lastDayClose } }),
      ...(this.lastWeekClose === undefined ? {} : { lastWeekClose: { ...this.lastWeekClose } }),
      ...(automation.enabled ? { nextDayCloseAt: this.nextDayCloseAt(this.now()) } : {}),
    };
    return status;
  }

  /**
   * Run any due close now: the due day, the bounded catch-up days, the due week,
   * and the one older day/week the window has to archive as skipped.
   *
   * Safe to call at any time and from any source (start, timer tick, slash
   * command): passes are serialized, every run is claimed through the ledger,
   * and the call never throws. Automation switched off makes it a no-op.
   *
   * @returns the newest day and week a close was attempted for, when any.
   */
  async runDue(): Promise<{ day?: string; week?: string }> {
    if (!this.config.automation.enabled) return {};
    let result: { day?: string; week?: string } = {};
    const pass = this.queue.then(async () => {
      result = await this.runDueOnce();
    });
    this.queue = pass.then(
      () => undefined,
      () => undefined,
    );
    await pass;
    return result;
  }

  /**
   * Close one Dayflow day, through the ledger.
   *
   * A day already closed (or archived as skipped) is a no-op; a failed run is
   * retried while attempts remain. The callback may reject: the rejection is
   * recorded as a failed run, not thrown.
   *
   * @param day - the Dayflow day key (`YYYY-MM-DD`).
   */
  async runDay(day: string): Promise<void> {
    if (!this.config.automation.enabled) return;
    await this.runJob('day_close', day, () => this.options.runDayClose(day));
  }

  /**
   * Close one week, through the ledger; the same lifecycle as {@link runDay}.
   *
   * @param monday - the Monday label of the week being closed.
   */
  async runWeek(monday: string): Promise<void> {
    if (!this.config.automation.enabled) return;
    await this.runJob('week_close', monday, () => this.options.runWeekClose(monday));
  }

  /** Read the ledger without creating a journal that does not exist yet. */
  private readLedger(job: AutomationJob): AutomationRun[] {
    if (!existsSync(this.journalPath)) return [];
    try {
      return withJournal(this.journalPath, (db: DatabaseSync) => listAutomationRuns(db, { job, limit: LEDGER_SCAN_LIMIT }));
    } catch (error) {
      this.logger('automation.ledger_unreadable', { job, error: messageOf(error) });
      return [];
    }
  }

  /** Run one write against the ledger. */
  private writeLedger<T>(work: (db: DatabaseSync) => T): T {
    return withJournalWrite(this.journalPath, work);
  }

  /** Read one run from the ledger, if it has ever been ensured. */
  private readRun(job: AutomationJob, day: string): AutomationRun | undefined {
    const runs = this.readLedger(job);
    return runs.find((run) => run.day === day);
  }

  /** The run with the most recent day in a ledger slice, if any. */
  private latestRun(job: AutomationJob): AutomationRun | undefined {
    let latest: AutomationRun | undefined;
    for (const run of this.readLedger(job)) {
      if (latest === undefined || compareDayKeys(run.day, latest.day) > 0) latest = run;
    }
    return latest;
  }

  /**
   * The one-close lifecycle every job shares: claim the run, call the work, then
   * record the outcome. Never throws.
   */
  private async runJob(job: AutomationJob, day: string, work: () => Promise<AutomationCloseOutcome>): Promise<void> {
    try {
      const existing = this.readRun(job, day);
      if (existing !== undefined) {
        if (existing.status === 'complete' || existing.status === 'skipped') return;
        if (existing.status === 'failed' && existing.attempts >= AUTOMATION_MAX_ATTEMPTS) return;
        if (existing.status === 'running') {
          // Nothing in this process is driving it: a crash between start and
          // record left it behind. Skipping it (rather than failing it) keeps
          // the day's other work moving and says exactly what happened.
          const skipped = this.writeLedger((db) => skipAutomationRun(db, existing.id, STALE_RUNNING));
          this.record(job, day, skipped.status, skipped.attempts);
          this.logger('automation.stale_run_skipped', { job, day });
          return;
        }
      }
      const started = this.writeLedger((db) => startAutomationRun(db, ensureAutomationRun(db, job, day).id));
      let outcome: AutomationCloseOutcome;
      try {
        outcome = await work();
      } catch (error) {
        outcome = { status: 'failed', error: messageOf(error) };
      }
      const recorded = this.writeLedger((db) => {
        if (outcome.status === 'complete') return completeAutomationRun(db, started.id, { status: 'complete' });
        if (outcome.status === 'skipped') return skipAutomationRun(db, started.id, outcome.error ?? 'skipped');
        return failAutomationRun(db, started.id, outcome.error ?? 'automation failed');
      });
      this.record(job, day, recorded.status, recorded.attempts);
      this.logger('automation.close_recorded', { job, day, status: recorded.status, attempts: recorded.attempts });
    } catch (error) {
      // A bookkeeping failure is logged, never thrown: a broken journal must not
      // take down the host's timer loop.
      this.logger('automation.close_error', { job, day, error: messageOf(error) });
    }
  }

  /** Record one settled close in memory and adjust the failure backoff. */
  private record(job: AutomationJob, day: string, status: AutomationRunStatus, attempts: number): void {
    const at = this.now().getTime();
    // `lastDayClose` means the most recent day, not the most recently touched
    // one: archiving a day older than the window must not hide today's close.
    if (job === 'day_close') {
      if (this.lastDayClose === undefined || compareDayKeys(day, this.lastDayClose.day) >= 0) {
        this.lastDayClose = { day, status, at };
      }
    } else if (this.lastWeekClose === undefined || compareDayKeys(day, this.lastWeekClose.monday) >= 0) {
      this.lastWeekClose = { monday: day, status, at };
    }
    const state = this.retry[job];
    if (status === 'complete') {
      // One successful close restores that job's normal cadence; the other job's
      // retry, if any, is left alone.
      state.failures = 0;
      state.retryAt = undefined;
      return;
    }
    if (status !== 'failed') return;
    state.failures += 1;
    // A failed run that used every attempt is terminal; do not schedule a pass
    // that would only find the cap again.
    if (attempts >= AUTOMATION_MAX_ATTEMPTS) {
      state.retryAt = undefined;
      return;
    }
    const delay = retryDelayMs(state.failures);
    state.retryAt = at + delay;
    this.logger('automation.close_failed', { job, day, attempts, retryInMs: delay });
  }

  /** Seed the status with the ledger's most recent closes when memory has none. */
  private primeFromLedger(): void {
    try {
      if (this.lastDayClose === undefined) {
        const latest = this.latestRun('day_close');
        if (latest !== undefined) {
          this.lastDayClose = { day: latest.day, status: latest.status, at: timestampMs(latest.updated_at) };
        }
      }
      if (this.lastWeekClose === undefined) {
        const latest = this.latestRun('week_close');
        if (latest !== undefined) {
          this.lastWeekClose = { monday: latest.day, status: latest.status, at: timestampMs(latest.updated_at) };
        }
      }
    } catch {
      // The status is decoration; an unreadable ledger just leaves it empty.
    }
  }

  /** Run the serialized pass behind {@link runDue}. Never throws. */
  private async runDueOnce(): Promise<{ day?: string; week?: string }> {
    const result: { day?: string; week?: string } = {};
    this.closing = true;
    // This pass supersedes the pending retries; a failing close re-arms its own.
    this.retry.day_close.retryAt = undefined;
    this.retry.week_close.retryAt = undefined;
    try {
      const now = this.now();
      const dayPlan = this.planDayCloses(now);
      for (const day of dayPlan.runDays) {
        await this.runJob('day_close', day, () => this.options.runDayClose(day));
        result.day = day;
      }
      for (const day of dayPlan.skipDays) this.archiveSkipped('day_close', day);
      const weekPlan = this.planWeekCloses(now);
      for (const monday of weekPlan.runWeeks) {
        await this.runJob('week_close', monday, () => this.options.runWeekClose(monday));
        result.week = monday;
      }
      for (const monday of weekPlan.skipWeeks) this.archiveSkipped('week_close', monday);
    } catch (error) {
      this.logger('automation.pass_failed', { error: messageOf(error) });
    } finally {
      this.closing = false;
    }
    return result;
  }

  /** Record that a missed period is too old to close, without fabricating it. */
  private archiveSkipped(job: AutomationJob, day: string): void {
    try {
      const existing = this.readRun(job, day);
      if (existing !== undefined && (existing.status === 'complete' || existing.status === 'skipped')) return;
      const recorded = this.writeLedger((db) => {
        const ensured = ensureAutomationRun(db, job, day);
        return skipAutomationRun(db, ensured.id, OLDER_THAN_CATCH_UP);
      });
      this.record(job, day, recorded.status, recorded.attempts);
      this.logger('automation.older_than_window', { job, day });
    } catch (error) {
      this.logger('automation.archive_failed', { job, day, error: messageOf(error) });
    }
  }

  /** Plan the day closes for one pass: what to close and what to archive. */
  private planDayCloses(now: Date): DayPlan {
    const automation = this.config.automation;
    const dueDay = this.dueDay(now);
    // With catch-up switched off a restart closes only the due day; missed days
    // are then archived rather than replayed.
    const windowSize = automation.catchUpOnStart ? automation.catchUpDays : 1;
    const windowStart = addDaysKey(dueDay, -(windowSize - 1));
    const settled = latestSettledDay(this.readLedger('day_close'));
    const firstCandidate = settled === undefined ? windowStart : laterDayKey(addDaysKey(settled, 1), windowStart);
    const runDays: string[] = [];
    for (let day = firstCandidate; compareDayKeys(day, dueDay) <= 0; day = addDaysKey(day, 1)) {
      if (!this.dayHasEnded(day, now)) break;
      runDays.push(day);
    }
    const skipDays: string[] = [];
    if (settled !== undefined) {
      // The one day just before the window is the boundary of what is too old:
      // archiving it says why older days will never run.
      const firstOlder = addDaysKey(windowStart, -1);
      if (compareDayKeys(settled, firstOlder) < 0 && this.dayHasEnded(firstOlder, now)) skipDays.push(firstOlder);
    }
    return { runDays, skipDays };
  }

  /** Plan the week closes for one pass: what to close and what to archive. */
  private planWeekCloses(now: Date): WeekPlan {
    const automation = this.config.automation;
    const dueMonday = this.dueMonday(now);
    // The weekly window is one week: the due week plus the immediately
    // preceding week, so a missed Monday still closes the week it described.
    const windowSize = automation.catchUpOnStart ? 2 : 1;
    const windowStart = addDaysKey(dueMonday, -7 * (windowSize - 1));
    const settled = latestSettledDay(this.readLedger('week_close'));
    const firstCandidate = settled === undefined ? windowStart : laterDayKey(addDaysKey(settled, 7), windowStart);
    const runWeeks: string[] = [];
    for (let monday = firstCandidate; compareDayKeys(monday, dueMonday) <= 0; monday = addDaysKey(monday, 7)) {
      if (!this.weekHasEnded(monday, now)) break;
      runWeeks.push(monday);
    }
    const skipWeeks: string[] = [];
    if (settled !== undefined) {
      const firstOlder = addDaysKey(windowStart, -7);
      if (compareDayKeys(settled, firstOlder) < 0 && this.weekHasEnded(firstOlder, now)) skipWeeks.push(firstOlder);
    }
    return { runWeeks, skipWeeks };
  }

  /** The most recent `automation.dailyAt` boundary at or before now. */
  private latestDayBoundary(now: Date): Date {
    const { hour, minute } = parseClock(this.config.automation.dailyAt);
    const boundary = new Date(now.getTime());
    boundary.setHours(hour, minute, 0, 0);
    return boundary.getTime() > now.getTime() ? addLocalDays(boundary, -1) : boundary;
  }

  /** The next `automation.dailyAt` boundary after now, as epoch milliseconds. */
  private nextDayCloseAt(now: Date): number {
    const { hour, minute } = parseClock(this.config.automation.dailyAt);
    const boundary = new Date(now.getTime());
    boundary.setHours(hour, minute, 0, 0);
    if (boundary.getTime() <= now.getTime()) boundary.setDate(boundary.getDate() + 1);
    return boundary.getTime();
  }

  /** The most recent `automation.weeklyOn` + `dailyAt` boundary at or before now. */
  private latestWeekBoundary(now: Date): Date {
    const { hour, minute } = parseClock(this.config.automation.dailyAt);
    const target = WEEKDAY_INDEX[this.config.automation.weeklyOn] ?? 1;
    const boundary = new Date(now.getTime());
    boundary.setHours(hour, minute, 0, 0);
    const daysBack = (boundary.getDay() - target + 7) % 7;
    boundary.setDate(boundary.getDate() - daysBack);
    return boundary.getTime() > now.getTime() ? addLocalDays(boundary, -7) : boundary;
  }

  /**
   * The Dayflow day the most recent boundary closed.
   *
   * The boundary at 04:00 on a date starts that date's Dayflow day and ends the
   * one before it, so the day being closed is the day containing the instant one
   * second before the boundary.
   */
  private dueDay(now: Date): string {
    const boundary = this.latestDayBoundary(now);
    return dayWindowContaining(new Date(boundary.getTime() - 1000)).dayKey;
  }

  /**
   * The Monday of the week that closed at the most recent weekly boundary.
   *
   * A close at Monday 04:00 summarizes the week that ended there, whose Monday
   * is seven days before the boundary's date.
   */
  private dueMonday(now: Date): string {
    const boundary = this.latestWeekBoundary(now);
    const lastCompletedDay = dayWindowContaining(new Date(boundary.getTime() - 1000)).dayKey;
    return mondayOfDay(lastCompletedDay);
  }

  /** Whether a Dayflow day has ended (its 04:00 window close is behind now). */
  private dayHasEnded(day: string, now: Date): boolean {
    const window = dayWindowForKey(day);
    return window !== undefined && window.end.getTime() <= now.getTime();
  }

  /** Whether a weekly period has ended (the next Monday 04:00 is behind now). */
  private weekHasEnded(monday: string, now: Date): boolean {
    const window = dayWindowForKey(monday);
    if (window === undefined) return false;
    return addLocalDays(window.start, 7).getTime() <= now.getTime();
  }

  /** Run one pass and then arm the next timer, unless the loop was stopped. */
  private async runPass(generation: number): Promise<void> {
    await this.runDue();
    if (!this.isCurrent(generation)) return;
    this.arm(generation);
  }

  /** Arm the single pending timer: the earliest of the next boundary and a retry. */
  private arm(generation: number): void {
    if (!this.isCurrent(generation)) return;
    this.clearTimer();
    const now = this.now();
    let delay = Math.max(0, this.nextDayCloseAt(now) - now.getTime());
    for (const state of [this.retry.day_close, this.retry.week_close]) {
      if (state.retryAt !== undefined) delay = Math.max(0, Math.min(delay, state.retryAt - now.getTime()));
    }
    this.timerHandle = this.timers.setTimeout(() => {
      this.timerHandle = undefined;
      if (!this.isCurrent(generation)) return;
      void this.runPass(generation);
    }, delay);
  }

  /** Cancel the pending timer, if any. */
  private clearTimer(): void {
    if (this.timerHandle === undefined) return;
    this.timers.clearTimeout(this.timerHandle);
    this.timerHandle = undefined;
  }

  /** Whether one loop generation is still the live one. */
  private isCurrent(generation: number): boolean {
    return this.started && generation === this.generation;
  }
}
