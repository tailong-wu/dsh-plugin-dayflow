/**
 * The analysis worker: one pipeline run per tick, on a recursive timer.
 *
 * The pipeline itself is a batch over one Dayflow day and has no schedule; this
 * module owns the clock. It mirrors the capture engine's lifecycle so the
 * plugin has one shape for background work: construction does nothing,
 * {@link AnalysisWorker.start} runs the first tick immediately and schedules the
 * next one only after the previous tick settles, and {@link AnalysisWorker.stop}
 * clears the pending timer and lets an in-flight tick finish without scheduling
 * another round. A generation counter makes that last guarantee true even when
 * `start` is called again before the old tick finishes: a stale tick can never
 * arm a second timer.
 *
 * The worker never throws out of a timer tick. A failed run (an unreadable
 * journal, a broken clock, a run-level error) is logged, left on the status as
 * `lastError`, and retried on the next tick. Consecutive failures double the
 * delay up to {@link MAX_BACKOFF_DOUBLINGS} doublings (32× the configured
 * interval); the first success restores the configured interval and clears the
 * error. Per-window failures (a model call error, a malformed answer) are not
 * run failures: the pipeline records them on their jobs and returns normally,
 * so one bad window cannot make the worker back off.
 *
 * The worker does not read the consent switch itself and does not poll it: the
 * pipeline evaluates {@link decideAnalysis} on every run, so a consent change
 * takes effect on the next tick without a restart, and a blocked run is a
 * normal outcome rather than an error.
 *
 * **The 04:00 day tail.** A Dayflow day ends at 04:00, so a tick that lands just
 * after the boundary would otherwise leave the previous day's last frames
 * unanalysed forever. After each tick's own run, the worker therefore runs the
 * pipeline once for the previous day, at most once per Dayflow day. The marker
 * is `capture_state.analysis_tail_checked_on`, which holds the day whose tail
 * has been handled: it is persistent, so a same-day restart does not repeat the
 * run, and it is written only when the tail run was not `blocked`, so fixing the
 * consent gate later the same day still gets one more attempt. The tail runs
 * without a window cap: the day's call/token caps and the job ledger bound it,
 * and a replay of already-complete windows makes no model calls. A tail failure
 * is isolated: it is recorded on `lastError` and logged, but it never changes
 * the day's `lastOutcome`, never enters the backoff count, and never stops the
 * loop.
 *
 * **Transient-skip catch-up.** Before the tail, a tick whose own run was not
 * `blocked` replays today's and yesterday's configuration skips back to
 * `queued` (see {@link module:dsh-plugin-dayflow/analyse/skips}), so repairing
 * the consent switch or the provider does not leave a window permanently
 * stranded. The replay is skipped while the gate is blocked: requeueing there
 * would only be re-skipped by the next run, churning the ledger. A catch-up
 * failure is logged as `analysis.catch_up` and leaves the day's status alone.
 * @module dsh-plugin-dayflow/analyse/worker
 */

import { readCaptureStateValue, writeCaptureStateValue } from '../capture/state.js';
import type { ResolvedConfig } from '../config.js';
import { dayWindowContaining, previousDayKey } from '../day.js';
import { withJournal, withJournalWrite } from '../journal.js';
import type { AnalysisLlmStream } from './llm.js';
import { AnalysisPipeline } from './pipeline.js';
import type { AnalysisRunResult } from './pipeline.js';
import { replaySkippedAnalysisWindows } from './skips.js';

/** A timer seam so tests can drive the loop without waiting. */
export interface AnalysisWorkerTimers {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Everything the worker needs; every optional field has a production default. */
export interface AnalysisWorkerOptions {
  /** The plugin-owned journal the pipeline reads frames from and writes cards to. */
  journalPath: string;
  /** Where frame files live, used to resolve a relative `screenshots.file_path`. */
  framesDirectory: string;
  /** Resolved plugin config; the `capture` and `analysis` blocks are read. */
  config: ResolvedConfig;
  /** The model seam; the composition supplies the host adapter in production. */
  analyser: AnalysisLlmStream;
  /** Injectable clock, so a test can fix the day without waiting. */
  now?: () => Date;
  /** Injectable timers, so a test can step the loop. */
  timers?: AnalysisWorkerTimers;
  /** Structured event sink; the default is silent. */
  logger?: (event: string, detail?: Record<string, unknown>) => void;
  /** Longest gap between two successful windows that still merges them; see the pipeline. */
  mergeGapSeconds?: number;
}

/** What the worker and the plugin's status line show about it right now. */
export interface AnalysisWorkerStatus {
  /** Whether the recursive timer is armed (or a tick is in flight). */
  running: boolean;
  /** The configured interval between ticks, in minutes. */
  intervalMinutes: number;
  /** Epoch milliseconds when the most recent tick settled, success or failure. */
  lastRunAt?: number;
  /** The most recent successful run's outcome; absent before the first success. */
  lastOutcome?: string;
  /** The most recent run-level failure, cleared by the next successful tick. */
  lastError?: string;
}

/** How many times a consecutive-failure delay may double before it stops growing. */
export const MAX_BACKOFF_DOUBLINGS = 5;

/**
 * The `capture_state` key marking the day whose 04:00 tail has been analysed.
 *
 * The value is a `YYYY-MM-DD` Dayflow day key. It lives in `capture_state`
 * because that table is the plugin's existing home for runtime bookkeeping and
 * it is persistent, so a process restart the same day does not repeat the tail.
 */
export const ANALYSIS_TAIL_CHECKPOINT_KEY = 'analysis_tail_checked_on';

/** The production loop: the process timers. */
const DEFAULT_TIMERS: AnalysisWorkerTimers = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

/** The message of an unknown thrown value, for logs and `lastError`. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the analysis pipeline on an interval, one day's frames at a time.
 *
 * Construction does nothing; {@link start} begins the loop and {@link stop}
 * ends it. The pipeline is constructed fresh for every tick because it keeps no
 * state: the job ledger, the frames, and the done-jobs are the memory.
 */
export class AnalysisWorker {
  private readonly journalPath: string;
  private readonly framesDirectory: string;
  private readonly config: ResolvedConfig;
  private readonly analyser: AnalysisLlmStream;
  private readonly now: () => Date;
  private readonly timers: AnalysisWorkerTimers;
  private readonly logger: (event: string, detail?: Record<string, unknown>) => void;
  private readonly mergeGapSeconds: number | undefined;

  /** Whether the loop is armed; `start`/`stop` are idempotent. */
  private running = false;
  /** Bumped by `stop` so an in-flight tick cannot schedule another one. */
  private generation = 0;
  /** The pending wait between ticks; undefined while a tick runs or when stopped. */
  private timerHandle: unknown;
  /** How many run-level failures happened in a row, for the backoff delay. */
  private consecutiveFailures = 0;

  /** The public status fields, written only by the tick wrapper. */
  private lastRunAt: number | undefined;
  private lastOutcome: string | undefined;
  private lastError: string | undefined;

  constructor(options: AnalysisWorkerOptions) {
    this.journalPath = options.journalPath;
    this.framesDirectory = options.framesDirectory;
    this.config = options.config;
    this.analyser = options.analyser;
    this.now = options.now ?? (() => new Date());
    this.timers = options.timers ?? DEFAULT_TIMERS;
    this.logger = options.logger ?? (() => undefined);
    this.mergeGapSeconds = options.mergeGapSeconds;
  }

  /**
   * Start the worker.
   *
   * The first run happens immediately; the next one is scheduled only after it
   * settles, so a slow run can never overlap itself. Calling `start` while the
   * loop is already running does nothing, so two starts cannot arm two timers.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    void this.tick(this.generation);
  }

  /**
   * Stop the worker.
   *
   * The pending timer is cleared and a tick already in flight may finish, but
   * the loop cannot schedule another one: the generation counter invalidates
   * it. The host may have no place to await cleanup, so `stop` never waits.
   */
  stop(): void {
    const wasRunning = this.running;
    this.running = false;
    this.generation += 1;
    const handle = this.timerHandle;
    this.timerHandle = undefined;
    if (handle !== undefined) this.timers.clearTimeout(handle);
    if (wasRunning) this.logger('analysis.stopped');
  }

  /** Read the worker's public state; never throws. */
  status(): AnalysisWorkerStatus {
    const status: AnalysisWorkerStatus = {
      running: this.running,
      intervalMinutes: this.config.analysis.intervalMinutes,
    };
    if (this.lastRunAt !== undefined) status.lastRunAt = this.lastRunAt;
    if (this.lastOutcome !== undefined) status.lastOutcome = this.lastOutcome;
    if (this.lastError !== undefined) status.lastError = this.lastError;
    return status;
  }

  /**
   * Run the pipeline once.
   *
   * This is the tick body and the manual `/dayflow-analyze` path. It returns
   * what the run did and rejects only on a caller-level failure (an invalid
   * `day`, an unusable journal); per-window failures are counted in the result.
   * The timer path catches a rejection and keeps the loop alive; a caller that
   * asked directly, such as the command, gets the error.
   * @param options - the day (default: the one containing now), a window cap,
   *   and an abort signal forwarded to the model calls.
   * @returns the run's statistics.
   */
  async runOnce(options: { day?: string; maxWindows?: number; signal?: AbortSignal } = {}): Promise<AnalysisRunResult> {
    const pipeline = new AnalysisPipeline({
      journalPath: this.journalPath,
      framesDirectory: this.framesDirectory,
      config: this.config,
      analyser: this.analyser,
      now: this.now,
      ...(this.mergeGapSeconds === undefined ? {} : { mergeGapSeconds: this.mergeGapSeconds }),
    });
    return pipeline.run(options);
  }

  /** Run one tick, record its outcome, then arm the next timer. */
  private async tick(generation: number): Promise<void> {
    // A timer that fired just before `stop`, or a stale loop from before a
    // restart, must not run a tick at all.
    if (!this.running || generation !== this.generation) return;

    let delayMs = this.intervalMilliseconds();
    try {
      const result = await this.runOnce();
      this.lastOutcome = result.outcome;
      this.lastError = undefined;
      this.consecutiveFailures = 0;
      this.logger('analysis.tick', {
        outcome: result.outcome,
        day: result.day,
        windows: result.windows,
        analysed: result.analysed,
        skipped: result.skipped,
        failed: result.failed,
        activitiesWritten: result.activitiesWritten,
        ...(result.blockedReason === undefined ? {} : { blockedReason: result.blockedReason }),
      });
      // After the day's own run: repair configuration skips, then catch the
      // previous day's boundary tail. Both are isolated from the day's result.
      if (result.outcome !== 'blocked') await this.runCatchUp();
      await this.runDayTail();
    } catch (error) {
      this.lastError = errorMessage(error);
      this.consecutiveFailures += 1;
      // The first failure already waits twice as long; the factor is capped so a
      // long outage cannot push the next attempt hours away.
      const doublings = Math.min(this.consecutiveFailures, MAX_BACKOFF_DOUBLINGS);
      delayMs *= 2 ** doublings;
      this.logger('analysis.tick_failed', {
        error: this.lastError,
        failures: this.consecutiveFailures,
        retryInMs: delayMs,
      });
    }
    // A clock that threw is the failure we recorded, not a second crash; the
    // timestamp is advisory, so a missing one is better than a rejected loop.
    try {
      this.lastRunAt = this.now().getTime();
    } catch {
      // Keep the previous timestamp; `lastError` already explains the tick.
    }

    // `stop` (or a restart) while the run was in flight wins: no new timer.
    if (!this.running || generation !== this.generation) return;
    this.timerHandle = this.timers.setTimeout(() => {
      this.timerHandle = undefined;
      void this.tick(generation);
    }, delayMs);
  }

  /**
   * Requeue today's and yesterday's transient skips, once per unblocked tick.
   *
   * A skip records that a configuration gate refused a window before spending
   * anything, so a repaired gate should not leave it stranded. The caller runs
   * this only when the day's own run was not `blocked`; replaying while the gate
   * is still closed would requeue the row only for the next run to skip it
   * again, oscillating the ledger. The requeue is conditional in the store, so a
   * racing manual run cannot replay the same row twice.
   *
   * The pass is best-effort: a failure is logged as `analysis.catch_up` and
   * leaves the day's `lastOutcome`/`lastError` untouched, and the next tick
   * retries it.
   */
  private async runCatchUp(): Promise<void> {
    try {
      const result = await replaySkippedAnalysisWindows({
        journalPath: this.journalPath,
        now: this.now,
        daysBack: 1,
      });
      if (result.replayed > 0) {
        this.logger('analysis.catch_up', {
          considered: result.considered,
          replayed: result.replayed,
          byReason: result.byReason,
        });
      }
    } catch (error) {
      this.logger('analysis.catch_up', { error: errorMessage(error) });
    }
  }

  /**
   * Run the previous day's boundary tail at most once per Dayflow day.
   *
   * The day is the one containing `now()`; the tail covers the day before it.
   * `capture_state.analysis_tail_checked_on` is the idempotency marker: when it
   * already names today, the tail has been handled and nothing runs. The marker
   * is written only after a tail run whose outcome is not `blocked`, so a
   * consent gate fixed later the same day gets one more attempt at yesterday.
   *
   * The tail deliberately passes no `maxWindows`: the day's call/token caps and
   * the job ledger bound the work, and a replay of completed windows calls no
   * model. Checkpoint reads and writes use their own short connections, so no
   * journal handle is held across the awaited pipeline run.
   *
   * A failure here is isolated from the day's tick: it is kept on `lastError`
   * and logged as `analysis.day_tail`, but it never changes `lastOutcome`,
   * never counts toward the backoff, and never rejects the tick.
   */
  private async runDayTail(): Promise<void> {
    let tailDay = '';
    try {
      const today = dayWindowContaining(this.now()).dayKey;
      const checkedOn = withJournal(this.journalPath, (db) =>
        readCaptureStateValue(db, ANALYSIS_TAIL_CHECKPOINT_KEY),
      );
      if (checkedOn === today) return;

      tailDay = previousDayKey(today);
      const result = await this.runOnce({ day: tailDay });
      this.logger('analysis.day_tail', {
        day: tailDay,
        outcome: result.outcome,
        windows: result.windows,
        analysed: result.analysed,
        skipped: result.skipped,
        failed: result.failed,
        activitiesWritten: result.activitiesWritten,
        ...(result.blockedReason === undefined ? {} : { blockedReason: result.blockedReason }),
      });
      // A blocked tail is retried later today: the gate may be fixed without a
      // restart, and the checkpoint must not claim the day was handled.
      if (result.outcome === 'blocked') return;
      withJournalWrite(this.journalPath, (db) => {
        writeCaptureStateValue(db, ANALYSIS_TAIL_CHECKPOINT_KEY, today);
      });
    } catch (error) {
      this.lastError = errorMessage(error);
      this.logger('analysis.day_tail', {
        ...(tailDay === '' ? {} : { day: tailDay }),
        error: this.lastError,
        failed: true,
      });
    }
  }

  /** The configured interval in milliseconds, clamped to a positive number. */
  private intervalMilliseconds(): number {
    return Math.max(1, Math.round(this.config.analysis.intervalMinutes * 60_000));
  }
}
