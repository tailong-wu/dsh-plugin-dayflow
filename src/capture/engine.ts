/**
 * The native capture engine: schedule, gate, dedupe, store, and retain frames.
 *
 * Phase 1 writes frames and `screenshots` rows; it does not analyse them. The
 * engine is deliberately small: one {@link CaptureEngine.captureOnce} call is
 * the whole unit of work, so a test drives it without any timer, and
 * {@link CaptureEngine.start} only loops that unit on a recursive timeout. It
 * never starts by itself: the plugin constructs it only when `capture.enabled`.
 *
 * A tick is skipped, without taking a frame, when capture is paused, the screen
 * is locked or asleep, or the day's frame cap is reached. A captured frame is
 * still skipped when the input has been idle, the frontmost app matches a pause
 * pattern, or the frame duplicates the last stored one (dHash Hamming distance,
 * or SHA-256 of the JPEG when the provider reports no hash). Only a frame that
 * survives every gate touches the disk, and then the journal: a database
 * failure deletes the file again, so disk and journal cannot disagree.
 *
 * Retention is a maintenance pass, not a per-frame policy: it runs at most once
 * per `capture.retentionCheckMinutes` and deletes frame files older than
 * `keepFramesDays` days. Zero is treated as one day, not "delete at once",
 * because nothing analyses frames yet; the daily window is the unit that a
 * future analyser will read.
 * @module dsh-plugin-dayflow/capture/engine
 */

import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { ResolvedConfig } from '../config.js';
import { dayWindowContaining } from '../day.js';
import { withJournal, withJournalWrite } from '../journal.js';
import type { CaptureAppInfo, CaptureFrame, CaptureProvider, CaptureProviderState } from './provider.js';
import {
  countScreenshotsForDay,
  readCaptureState,
  recordScreenshotRow,
  writeCaptureState,
} from './state.js';

/** What one tick did. Every value except `stored` means no frame was written. */
export type CaptureOutcome =
  | 'stored'
  | 'deduped'
  | 'idle'
  | 'paused'
  | 'locked'
  | 'paused-app'
  | 'capped'
  | 'error';

/** What the loop and the panel show about the engine right now. */
export interface CaptureEngineStatus {
  /** Whether the recursive timer is armed (or a tick is in flight). */
  running: boolean;
  /** The user's pause switch, read from `capture_state` when the journal is readable. */
  paused: boolean;
  /** Epoch milliseconds of the last frame stored by this engine or an earlier one. */
  lastFrameAt?: number;
  /** Native frames already counted in the current Dayflow day. */
  framesToday: number;
  /** The outcome of the most recent tick, if one has run. */
  lastOutcome?: CaptureOutcome;
  /** The most recent failure message, cleared by a successful store. */
  lastError?: string;
  /** Why the most recent tick skipped, when it skipped. */
  lastSkipReason?: string;
}

/** A timer seam so tests can drive the loop without waiting. */
export interface CaptureEngineTimers {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Everything the engine needs; every optional field has a production default. */
export interface CaptureEngineOptions {
  /** The plugin-owned journal the engine reads state from and writes frames to. */
  journalPath: string;
  /** The screen-capture provider; tests substitute a fake. */
  provider: CaptureProvider;
  /** Resolved plugin config; only the `capture` block is read. */
  config: ResolvedConfig;
  /** Where frame files live; defaults to `frames` beside the journal. */
  framesDirectory?: string;
  /** Injectable clock, so a test can place a tick at a fixed instant. */
  now?: () => Date;
  /** Injectable timers, so a test can step the loop. */
  timers?: CaptureEngineTimers;
  /** Structured event sink; the default is silent. */
  logger?: (event: string, detail?: Record<string, unknown>) => void;
}

/** Runtime capture state plus the engine-private dedupe hints. */
interface EngineRuntimeState {
  paused: boolean;
  lastFrameAt?: number;
  lastSweepAt?: number;
  lastHash?: string;
  lastSha256?: string;
}

/** Defaults for the two capture keys this module reads, matching `config.ts`. */
const FALLBACK_DEDUPE_DISTANCE = 4;
const FALLBACK_RETENTION_CHECK_MINUTES = 60;

/** Frame directories and files stay private to the user. */
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/** A Dayflow day, as milliseconds; retention measures whole days. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Even with `keepFramesDays: 0` a frame lives for a day: nothing analyses it yet. */
const MIN_RETENTION_DAYS = 1;

/** A dHash is 64 bits written as 16 lowercase hex characters. */
const DHASH_PATTERN = /^[0-9a-f]{16}$/;

/** Bit count of each hex nibble, for the Hamming distance. */
const NIBBLE_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * `capture_state` keys owned by the engine rather than by the shared state API.
 *
 * `capture/state.ts` exposes `paused`, `lastFrameAt`, and `lastSweepAt`; the two
 * dedupe hints are internal to this module, so they are read and written with
 * focused SQL here instead of widening the shared {@link CaptureState} type.
 */
const KEY_LAST_FRAME_HASH = 'last_frame_hash';
const KEY_LAST_FRAME_SHA256 = 'last_frame_sha256';

/** The production loop: the process timers. */
const DEFAULT_TIMERS: CaptureEngineTimers = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

/** The message of an unknown thrown value, for logs and `lastError`. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The provider frame's dHash, normalized, or `undefined` when absent/malformed. */
function frameHash(frame: CaptureFrame): string | undefined {
  const hash = frame.hash;
  if (typeof hash !== 'string') return undefined;
  const normalized = hash.trim().toLowerCase();
  return DHASH_PATTERN.test(normalized) ? normalized : undefined;
}

/** SHA-256 of the frame bytes, in lowercase hex. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Hamming distance between two equal-length hex strings.
 * @returns the bit distance, or `undefined` when the inputs cannot be compared.
 */
export function hammingDistance(left: string, right: string): number | undefined {
  if (left.length !== right.length || !DHASH_PATTERN.test(left) || !DHASH_PATTERN.test(right)) {
    return undefined;
  }
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const xor = parseInt(left[index] as string, 16) ^ parseInt(right[index] as string, 16);
    distance += NIBBLE_BITS[xor] as number;
  }
  return distance;
}

/**
 * Which pause pattern the frontmost app matches, if any.
 *
 * A pattern is either an exact bundle id (`com.apple.Safari`) or a
 * case-insensitive substring of the app's display name (`safari`), because the
 * display name is what a profile author actually sees.
 * @returns the matching pattern, or `undefined`.
 */
function matchingPausePattern(app: CaptureAppInfo | undefined, patterns: readonly string[]): string | undefined {
  if (app === undefined) return undefined;
  for (const pattern of patterns) {
    if (pattern !== '' && app.bundleId !== undefined && app.bundleId === pattern) return pattern;
  }
  const name = app.name?.toLowerCase();
  if (name === undefined || name === '') return undefined;
  for (const pattern of patterns) {
    if (pattern !== '' && name.includes(pattern.toLowerCase())) return pattern;
  }
  return undefined;
}

/** Read the engine-private dedupe hints from an open journal. */
function readFrameHints(db: DatabaseSync): { lastHash?: string; lastSha256?: string } {
  const rows = db
    .prepare('SELECT key, value FROM capture_state WHERE key IN (?, ?)')
    .all(KEY_LAST_FRAME_HASH, KEY_LAST_FRAME_SHA256) as { key?: unknown; value?: unknown }[];
  const hints: { lastHash?: string; lastSha256?: string } = {};
  for (const row of rows) {
    if (typeof row.key !== 'string' || typeof row.value !== 'string' || row.value === '') continue;
    if (row.key === KEY_LAST_FRAME_HASH) hints.lastHash = row.value.toLowerCase();
    if (row.key === KEY_LAST_FRAME_SHA256) hints.lastSha256 = row.value.toLowerCase();
  }
  return hints;
}

/** Store one engine-private hint in `capture_state`. */
function writeFrameHint(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO capture_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(key, value);
}

/** Drop the other dedupe hint, so a stale value cannot match a later frame. */
function clearFrameHint(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM capture_state WHERE key = ?').run(key);
}

/**
 * Capture frames on an interval, applying the privacy gates before any disk use.
 *
 * Construction does nothing; {@link start} begins the loop and {@link stop}
 * ends it. The engine never throws out of a tick: a provider, filesystem, or
 * journal failure is reported as `error` and recorded on the status, because
 * one bad tick must not stop the plugin process.
 */
export class CaptureEngine {
  private readonly journalPath: string;
  private readonly provider: CaptureProvider;
  private readonly config: ResolvedConfig;
  private readonly framesDirectory: string;
  private readonly now: () => Date;
  private readonly timers: CaptureEngineTimers;
  private readonly logger: (event: string, detail?: Record<string, unknown>) => void;

  /** Whether the loop is armed; `start`/`stop` are idempotent. */
  private running = false;
  /** Bumped by `stop` so an in-flight loop cannot schedule another tick. */
  private generation = 0;
  /** The pending wait between ticks, and the resolver that ends it early. */
  private timerHandle: unknown;
  private wake: (() => void) | undefined;

  /** In-memory copy of the journaled timestamps and dedupe hints. */
  private lastFrameAt: number | undefined;
  private lastSweepAt: number | undefined;
  private lastHash: string | undefined;
  private lastSha256: string | undefined;
  private pausedFromState = false;
  private framesToday = 0;

  /** The most recent tick's outcome, failure, and skip reason. */
  private lastOutcome: CaptureOutcome | undefined;
  private lastError: string | undefined;
  private lastSkipReason: string | undefined;

  constructor(options: CaptureEngineOptions) {
    this.journalPath = options.journalPath;
    this.provider = options.provider;
    this.config = options.config;
    this.framesDirectory = options.framesDirectory ?? join(dirname(options.journalPath), 'frames');
    this.now = options.now ?? (() => new Date());
    this.timers = options.timers ?? DEFAULT_TIMERS;
    this.logger = options.logger ?? (() => undefined);
  }

  /**
   * Start the capture loop.
   *
   * The first tick runs immediately and the next one is scheduled only after it
   * settles, so a slow capture can never overlap itself. Calling `start` while
   * the loop is already running does nothing.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    void this.runLoop(this.generation);
  }

  /**
   * Stop the capture loop.
   *
   * The pending wait is cleared and a tick already in flight may finish, but the
   * loop cannot schedule another one: `generation` invalidates it. Some hosts
   * allow no asynchronous cleanup, so `stop` never waits for that tick.
   */
  stop(): void {
    if (!this.running) {
      // A stopped engine has no pending wait; clear one anyway to be forgiving.
      this.clearWait();
      return;
    }
    this.running = false;
    this.generation += 1;
    this.clearWait();
  }

  /** Read the loop's public state; never throws, even with an unreadable journal. */
  status(): CaptureEngineStatus {
    const status: CaptureEngineStatus = {
      running: this.running,
      paused: this.pausedFromState,
      framesToday: this.framesToday,
    };

    let journaledFrameAt: number | undefined;
    try {
      const state = withJournal(this.journalPath, (db) => readCaptureState(db));
      this.pausedFromState = state.paused;
      status.paused = state.paused;
      journaledFrameAt = state.lastFrameAt;
      if (state.lastSweepAt !== undefined) this.lastSweepAt = state.lastSweepAt;
    } catch {
      // An unreadable journal is already reported by a tick; a status read is
      // not the place to log it again.
    }

    const lastFrameAt = Math.max(this.lastFrameAt ?? 0, journaledFrameAt ?? 0);
    if (lastFrameAt > 0) status.lastFrameAt = lastFrameAt;
    if (this.lastOutcome !== undefined) status.lastOutcome = this.lastOutcome;
    if (this.lastError !== undefined) status.lastError = this.lastError;
    if (this.lastSkipReason !== undefined) status.lastSkipReason = this.lastSkipReason;
    return status;
  }

  /**
   * Take at most one frame and apply every gate.
   *
   * This is the whole loop body and never rejects: a failure becomes `error`,
   * with its message left on {@link status}. The retention sweep runs after the
   * tick (never while capture is paused) and its own failure cannot change the
   * outcome.
   * @returns what this tick did.
   */
  async captureOnce(): Promise<CaptureOutcome> {
    let outcome: CaptureOutcome;
    try {
      outcome = await this.tickOnce();
    } catch (error) {
      // Defensive: tickOnce catches every expected failure itself.
      outcome = this.recordError('capture.tick_failed', error);
    }

    if (outcome !== 'paused') {
      try {
        await this.maybeSweep();
      } catch (error) {
        this.logger('retention.failed', { error: errorMessage(error) });
      }
    }
    return outcome;
  }

  /** One tick: every gate in order, then store, ending with its outcome. */
  private async tickOnce(): Promise<CaptureOutcome> {
    const now = this.now();
    const day = dayWindowContaining(now).dayKey;

    // 1. The user's pause switch lives in the journal.
    const runtime = this.readRuntimeState();
    this.adoptRuntimeState(runtime);
    if (runtime.paused) return this.skip('paused', 'capture is paused by the user');

    // 2. A locked or sleeping screen has nothing to record.
    const providerState = await this.readProviderState();
    if (providerState?.locked === true) return this.skip('locked', 'the screen is locked');
    if (providerState?.displayAsleep === true) return this.skip('locked', 'the display is asleep');

    // 3. The daily cap is enforced before the (expensive) capture.
    let framesToday = 0;
    try {
      framesToday = withJournal(this.journalPath, (db) => countScreenshotsForDay(db, day));
    } catch (error) {
      // The count is advisory here: an unreadable journal fails the write below.
      this.logger('capture.count_failed', { error: errorMessage(error) });
    }
    this.framesToday = Math.max(0, framesToday);
    const cap = this.config.capture.maxFramesPerDay;
    if (this.framesToday >= cap) {
      return this.skip('capped', `the daily cap of ${cap} frames is already reached`);
    }

    // 4. Capture; a provider failure is one bad tick, not a crash.
    let frame: CaptureFrame;
    try {
      frame = await this.provider.capture();
    } catch (error) {
      return this.recordError('capture.failed', error);
    }
    const hash = frameHash(frame);

    // 5. Idle input is not activity. 0 disables the gate.
    const idleGate = this.config.capture.idleSeconds;
    if (idleGate > 0 && frame.idleSeconds !== undefined && frame.idleSeconds >= idleGate) {
      return this.skip('idle', `input has been idle for ${frame.idleSeconds}s (gate ${idleGate}s)`);
    }

    // 6. A paused app must never reach the disk.
    const pausePattern = matchingPausePattern(frame.app, this.config.capture.pauseApps);
    if (pausePattern !== undefined) {
      return this.skip('paused-app', `the frontmost app matches the pause pattern "${pausePattern}"`);
    }

    // 7. Duplicate detection: dHash first, raw bytes when the provider has no hash.
    const sha256 = hash === undefined ? sha256Hex(frame.jpeg) : undefined;
    const dedupeDistance = this.config.capture.dedupeDistance ?? FALLBACK_DEDUPE_DISTANCE;
    if (hash !== undefined) {
      const lastHash = this.lastHash ?? runtime.lastHash;
      if (lastHash !== undefined) {
        const distance = hammingDistance(hash, lastHash);
        if (distance !== undefined && distance <= dedupeDistance) {
          return this.skip('deduped', `the frame is ${distance} bit(s) from the last stored frame`);
        }
      }
    } else if (sha256 !== undefined && sha256 === (this.lastSha256 ?? runtime.lastSha256)) {
      return this.skip('deduped', 'the frame bytes match the last stored frame');
    }

    // 8. Write the frame privately, one directory per Dayflow day.
    const capturedAt = frame.capturedAt;
    const suffix = hash ?? (sha256 as string).slice(0, 8);
    const dayDirectory = join(this.framesDirectory, day);
    const filePath = join(dayDirectory, `${capturedAt}-${suffix}.jpg`);
    try {
      await mkdir(dayDirectory, { recursive: true, mode: DIRECTORY_MODE });
      await writeFile(filePath, frame.jpeg, { mode: FILE_MODE });
    } catch (error) {
      return this.recordError('capture.file_failed', error);
    }

    let fileSize = frame.jpeg.byteLength;
    try {
      fileSize = (await stat(filePath)).size;
    } catch {
      // Fall back to the byte length we already know.
    }

    // 9. Journal the frame; a failed write must not leave the file behind.
    const capturedAtSeconds = Math.floor(capturedAt / 1000);
    // A dHash repeats when the user returns to an earlier screen, so the content
    // key alone would collide with that earlier row on (source_id, source_key):
    // the frame would be "stored" without a row of its own and the file would be
    // orphaned. The capture instant keeps every stored frame addressable, while
    // the content hash stays at the front of the key and in the payload.
    const sourceKey = `${hash ?? (sha256 as string)}:${capturedAtSeconds}`;
    try {
      withJournalWrite(this.journalPath, (db) => {
        recordScreenshotRow(db, {
          sourceKey,
          capturedAt: capturedAtSeconds,
          day,
          filePath,
          fileSize,
          idleSeconds: frame.idleSeconds,
          frameIndex: this.framesToday,
          payload: storedPayload(frame, hash, sha256),
        });
        writeCaptureState(db, { lastFrameAt: capturedAt });
        if (hash !== undefined) {
          writeFrameHint(db, KEY_LAST_FRAME_HASH, hash);
          clearFrameHint(db, KEY_LAST_FRAME_SHA256);
        } else {
          writeFrameHint(db, KEY_LAST_FRAME_SHA256, sha256 as string);
          clearFrameHint(db, KEY_LAST_FRAME_HASH);
        }
      });
    } catch (error) {
      await rm(filePath, { force: true }).catch(() => undefined);
      return this.recordError('capture.store_failed', error);
    }

    // 10. Only now is the frame stored.
    this.lastFrameAt = capturedAt;
    if (hash !== undefined) {
      this.lastHash = hash;
      this.lastSha256 = undefined;
    } else {
      this.lastSha256 = sha256;
      this.lastHash = undefined;
    }
    this.framesToday += 1;
    this.lastOutcome = 'stored';
    this.lastSkipReason = undefined;
    this.lastError = undefined;
    this.logger('capture.stored', {
      capturedAt,
      day,
      filePath,
      fileSize,
      hash: hash ?? null,
      framesToday: this.framesToday,
    });
    return 'stored';
  }

  /** Run one tick of the recursive loop, then wait before the next. */
  private async runLoop(generation: number): Promise<void> {
    while (this.running && generation === this.generation) {
      try {
        await this.captureOnce();
      } catch (error) {
        // captureOnce guards its own failures; this is the last line of defence.
        this.recordError('capture.loop_failed', error);
      }
      if (!this.running || generation !== this.generation) return;
      await this.wait(this.intervalMilliseconds());
    }
  }

  /** Clear the pending timer handle and release a waiting loop. */
  private clearWait(): void {
    const handle = this.timerHandle;
    this.timerHandle = undefined;
    if (handle !== undefined) this.timers.clearTimeout(handle);
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  /** Wait one interval; `stop` resolves this early so the loop can exit. */
  private wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.wake = () => {
        this.wake = undefined;
        resolve();
      };
      this.timerHandle = this.timers.setTimeout(() => {
        this.timerHandle = undefined;
        const wake = this.wake;
        this.wake = undefined;
        wake?.();
      }, milliseconds);
    });
  }

  /** The configured interval, clamped to a positive number of milliseconds. */
  private intervalMilliseconds(): number {
    return Math.max(1, Math.round(this.config.capture.intervalSeconds * 1000));
  }

  /** Read the runtime state; an unreadable journal reads as unpaused. */
  private readRuntimeState(): EngineRuntimeState {
    try {
      return withJournal(this.journalPath, (db) => {
        const state = readCaptureState(db);
        const hints = readFrameHints(db);
        const runtime: EngineRuntimeState = { paused: state.paused };
        if (state.lastFrameAt !== undefined) runtime.lastFrameAt = state.lastFrameAt;
        if (state.lastSweepAt !== undefined) runtime.lastSweepAt = state.lastSweepAt;
        if (hints.lastHash !== undefined) runtime.lastHash = hints.lastHash;
        if (hints.lastSha256 !== undefined) runtime.lastSha256 = hints.lastSha256;
        return runtime;
      });
    } catch (error) {
      this.logger('capture.state_unavailable', { error: errorMessage(error) });
      return { paused: false };
    }
  }

  /** Adopt journaled values the in-memory copy does not have yet (restart). */
  private adoptRuntimeState(runtime: EngineRuntimeState): void {
    this.pausedFromState = runtime.paused;
    this.lastFrameAt ??= runtime.lastFrameAt;
    this.lastSweepAt ??= runtime.lastSweepAt;
    this.lastHash ??= runtime.lastHash;
    this.lastSha256 ??= runtime.lastSha256;
  }

  /** Ask the provider for lock/idle state; a failure or absence is "unknown". */
  private async readProviderState(): Promise<CaptureProviderState | undefined> {
    if (typeof this.provider.state !== 'function') return undefined;
    try {
      return await this.provider.state();
    } catch (error) {
      this.logger('capture.state_probe_failed', { error: errorMessage(error) });
      return undefined;
    }
  }

  /** Record a skipped tick and return its outcome. */
  private skip(outcome: CaptureOutcome, reason: string): CaptureOutcome {
    this.lastOutcome = outcome;
    this.lastSkipReason = reason;
    this.logger(`capture.${outcome}`, { reason });
    return outcome;
  }

  /** Record a failed tick: the message is public, the throw is not. */
  private recordError(event: string, error: unknown): CaptureOutcome {
    this.lastError = errorMessage(error);
    this.lastOutcome = 'error';
    this.logger(event, { error: this.lastError });
    return 'error';
  }

  /** Run the retention sweep when its interval has elapsed. */
  private async maybeSweep(): Promise<void> {
    const now = this.now().getTime();
    const intervalMinutes =
      this.config.capture.retentionCheckMinutes ?? FALLBACK_RETENTION_CHECK_MINUTES;
    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
    if (this.lastSweepAt !== undefined && now - this.lastSweepAt < intervalMs) return;

    const removed = await this.sweep(now);
    this.lastSweepAt = now;
    try {
      withJournalWrite(this.journalPath, (db) => {
        writeCaptureState(db, { lastSweepAt: now });
      });
    } catch (error) {
      // The files were still swept; only the "when" is unknown next start.
      this.logger('retention.state_failed', { error: errorMessage(error) });
    }
    if (removed > 0) this.logger('retention.swept', { removed, at: now });
  }

  /**
   * Delete frame files older than the retention window and drop their empty day
   * directories. A missing frames directory is not a failure.
   * @returns how many files were removed.
   */
  private async sweep(now: number): Promise<number> {
    const keepDays = Math.max(this.config.capture.keepFramesDays, MIN_RETENTION_DAYS);
    const cutoff = now - keepDays * DAY_MS;
    let entries;
    try {
      entries = await readdir(this.framesDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }

    let removed = 0;
    for (const entry of entries) {
      const path = join(this.framesDirectory, entry.name);
      if (entry.isDirectory()) {
        removed += await this.sweepDirectory(path, cutoff);
      } else if (entry.isFile()) {
        removed += await this.removeIfExpired(path, cutoff);
      }
    }
    return removed;
  }

  /** Sweep one day directory, then remove it when the sweep emptied it. */
  private async sweepDirectory(directory: string, cutoff: number): Promise<number> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return 0;
    }

    let removed = 0;
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        removed += await this.sweepDirectory(path, cutoff);
      } else if (entry.isFile()) {
        removed += await this.removeIfExpired(path, cutoff);
      }
    }
    // Only an empty directory is removed; a concurrent write keeps it.
    await rmdir(directory).catch(() => undefined);
    return removed;
  }

  /** Delete one file when its mtime predates the cutoff. */
  private async removeIfExpired(path: string, cutoff: number): Promise<number> {
    try {
      const info = await stat(path);
      if (info.mtimeMs >= cutoff) return 0;
      await unlink(path);
      return 1;
    } catch {
      return 0;
    }
  }
}

/** The evidence stored beside a screenshot row for one stored frame. */
function storedPayload(
  frame: CaptureFrame,
  hash: string | undefined,
  sha256: string | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    width: frame.width,
    height: frame.height,
    outcome: 'stored',
  };
  if (hash !== undefined) payload.hash = hash;
  if (sha256 !== undefined) payload.sha256 = sha256;
  if (frame.app !== undefined) payload.app = frame.app;
  return payload;
}
