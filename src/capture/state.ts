/**
 * The native capture loop's runtime state and its screenshot rows.
 *
 * `capture_state` is a tiny key/value table rather than a configuration row:
 * pause is a runtime switch the user and the panel both write, and the last
 * frame/sweep timestamps let a restarted process resume without duplicating
 * work. Everything the loop records goes into `screenshots` under
 * `source_id = 'native'`, so it lives beside imported Dayflow rows and can
 * never collide with them.
 *
 * The helpers here take an already-open, migrated journal connection. They do
 * not open or close it, so a caller can group several writes in one journal
 * transaction.
 * @module dsh-plugin-dayflow/capture/state
 */

import type { DatabaseSync } from 'node:sqlite';

import { dayWindowForKey, epochSeconds } from '../day.js';
import { DayflowError } from '../errors.js';

/** The runtime state a capture loop resumes from. */
export interface CaptureState {
  /** The user paused capture; while true nothing is recorded or analysed. */
  paused: boolean;
  /** Epoch milliseconds of the last frame written, if one has been written. */
  lastFrameAt?: number;
  /** Epoch milliseconds of the last retention sweep, if one has run. */
  lastSweepAt?: number;
}

/** One frame row to write into `screenshots`. */
export interface ScreenshotInput {
  /** Stable content key; a second write with the same key is a no-op. */
  sourceKey: string;
  /** Capture instant from the provider clock, in epoch milliseconds. */
  capturedAt: number;
  /** The Dayflow day the frame belongs to (`YYYY-MM-DD`, 04:00 boundary). */
  day: string;
  /** Frame file on disk, before retention deletes it. */
  filePath?: string;
  /** Size of the frame file in bytes. */
  fileSize?: number;
  /** Input idleness at capture time, in seconds. */
  idleSeconds?: number;
  /** Index of the frame inside its capture cycle. */
  frameIndex?: number;
  /** Extra JSON-serializable evidence stored beside the row. */
  payload?: unknown;
}

/** The source id every natively captured row carries. */
const NATIVE_SOURCE_ID = 'native';

/** `capture_state` keys and their meaning. */
const KEY_PAUSED = 'paused';
const KEY_LAST_FRAME_AT = 'last_frame_at';
const KEY_LAST_SWEEP_AT = 'last_sweep_at';

/** A timestamp at or above this cannot be seconds; treat it as milliseconds. */
const EPOCH_MILLISECONDS_FLOOR = 100_000_000_000;

interface Row {
  readonly [key: string]: unknown;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

/** Read a stored state timestamp, ignoring a value that is not a number. */
function storedTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = finiteNumber(value);
  if (number === undefined || number < 0) return undefined;
  return Math.floor(number);
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DayflowError(`${field} must be a non-negative whole number (received ${String(value)}).`, 'invalid_input');
  }
  return value;
}

/** Validate an optional metadata value; `null` is stored as SQL NULL. */
function optionalInteger(value: number | undefined, field: string): number | null {
  if (value === undefined) return null;
  return requireNonNegativeInteger(value, field);
}

/** Serialize payload evidence; a value JSON cannot represent is rejected. */
function payloadJson(payload: unknown): string | null {
  if (payload === undefined) return null;
  try {
    return JSON.stringify(payload, (_key, entry: unknown) => (typeof entry === 'bigint' ? Number(entry) : entry)) ?? null;
  } catch (cause) {
    throw new DayflowError('The screenshot payload is not JSON-serializable.', 'invalid_input', { cause });
  }
}

function setStateValue(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO capture_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(key, value);
}

/**
 * Read the capture loop's runtime state.
 *
 * A missing row (or an unparsable value) is not an error: capture starts
 * unpaused with no recorded timestamps.
 * @param db - an open, migrated journal connection.
 * @returns the state, with `paused` always present.
 */
export function readCaptureState(db: DatabaseSync): CaptureState {
  const rows = db.prepare('SELECT key, value FROM capture_state').all() as Row[];
  const values = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.key === 'string' && typeof row.value === 'string') values.set(row.key, row.value);
  }

  const state: CaptureState = { paused: values.get(KEY_PAUSED) === '1' };
  const lastFrameAt = storedTimestamp(values.get(KEY_LAST_FRAME_AT));
  if (lastFrameAt !== undefined) state.lastFrameAt = lastFrameAt;
  const lastSweepAt = storedTimestamp(values.get(KEY_LAST_SWEEP_AT));
  if (lastSweepAt !== undefined) state.lastSweepAt = lastSweepAt;
  return state;
}

/**
 * Merge a patch into the capture loop's runtime state.
 *
 * Only the keys present in the patch are written, so two callers (the panel's
 * pause switch and the capture loop's frame clock) cannot clobber each other.
 * @param db - an open, migrated journal connection.
 * @param patch - the state fields to change.
 * @returns the merged state after the write.
 */
export function writeCaptureState(db: DatabaseSync, patch: Partial<CaptureState>): CaptureState {
  const next = readCaptureState(db);
  if (patch.paused !== undefined) {
    setStateValue(db, KEY_PAUSED, patch.paused ? '1' : '0');
    next.paused = patch.paused;
  }
  if (patch.lastFrameAt !== undefined) {
    const lastFrameAt = requireNonNegativeInteger(Math.floor(patch.lastFrameAt), 'lastFrameAt');
    setStateValue(db, KEY_LAST_FRAME_AT, String(lastFrameAt));
    next.lastFrameAt = lastFrameAt;
  }
  if (patch.lastSweepAt !== undefined) {
    const lastSweepAt = requireNonNegativeInteger(Math.floor(patch.lastSweepAt), 'lastSweepAt');
    setStateValue(db, KEY_LAST_SWEEP_AT, String(lastSweepAt));
    next.lastSweepAt = lastSweepAt;
  }
  return next;
}

/**
 * Write one native screenshot row, idempotently.
 *
 * `(source_id, source_key)` is unique, so replaying the same frame is a no-op
 * and returns the existing row id instead of inserting a duplicate. The row is
 * stored with `captured_at` in epoch seconds, the unit every screenshot reader
 * expects; a provider clock value in milliseconds is converted. The `day` is
 * validated so a caller cannot write a row it cannot later count, but the day a
 * count uses is derived from `captured_at` so the two can never disagree.
 * @param db - an open, migrated journal connection.
 * @param input - the frame to record.
 * @returns the row id, whether it was inserted now or already existed.
 */
export function recordScreenshotRow(db: DatabaseSync, input: ScreenshotInput): number {
  const sourceKey = typeof input.sourceKey === 'string' ? input.sourceKey.trim() : '';
  if (sourceKey === '') {
    throw new DayflowError('A screenshot needs a non-empty sourceKey.', 'invalid_input');
  }
  const day = typeof input.day === 'string' ? input.day : '';
  if (dayWindowForKey(day) === undefined) {
    throw new DayflowError(
      `Screenshot day must be a real YYYY-MM-DD date (received ${String(input.day)}).`,
      'invalid_input',
    );
  }
  const capturedAt = requireNonNegativeInteger(input.capturedAt, 'capturedAt');
  const capturedSeconds = capturedAt >= EPOCH_MILLISECONDS_FLOOR ? Math.floor(capturedAt / 1000) : capturedAt;

  const result = db
    .prepare(
      `INSERT INTO screenshots (source_id, source_key, captured_at, file_path, file_size, idle_seconds_at_capture,
        frame_index, is_deleted, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (source_id, source_key) DO NOTHING`,
    )
    .run(
      NATIVE_SOURCE_ID,
      sourceKey,
      capturedSeconds,
      input.filePath ?? null,
      optionalInteger(input.fileSize, 'fileSize'),
      optionalInteger(input.idleSeconds, 'idleSeconds'),
      optionalInteger(input.frameIndex, 'frameIndex'),
      payloadJson(input.payload),
    );
  if (Number(result.changes) > 0) {
    const inserted = Number(result.lastInsertRowid);
    if (Number.isSafeInteger(inserted) && inserted > 0) return inserted;
  }

  const rows = db
    .prepare('SELECT id FROM screenshots WHERE source_id = ? AND source_key = ?')
    .all(NATIVE_SOURCE_ID, sourceKey) as Row[];
  const existing = finiteNumber(rows[0]?.id);
  if (existing === undefined) {
    throw new DayflowError('The screenshot row could not be read back after writing it.', 'database_error');
  }
  return Math.floor(existing);
}

/**
 * Count the native frames recorded for one Dayflow day.
 *
 * The day is resolved with the same 04:00-to-04:00 rule the rest of the plugin
 * uses, so a frame captured at 3 AM counts toward the previous day. Soft-deleted
 * rows and imported (`dayflow`) rows are never counted.
 * @param db - an open, migrated journal connection.
 * @param day - the Dayflow day key.
 * @returns the number of frames in that day.
 */
export function countScreenshotsForDay(db: DatabaseSync, day: string): number {
  const window = dayWindowForKey(typeof day === 'string' ? day : '');
  if (window === undefined) {
    throw new DayflowError(`Screenshot day must be a real YYYY-MM-DD date (received ${String(day)}).`, 'invalid_input');
  }
  const rows = db
    .prepare(
      `SELECT count(*) AS frames FROM screenshots
        WHERE source_id = ? AND COALESCE(is_deleted, 0) = 0 AND captured_at >= ? AND captured_at < ?`,
    )
    .all(NATIVE_SOURCE_ID, epochSeconds(window.start), epochSeconds(window.end)) as Row[];
  const frames = finiteNumber(rows[0]?.frames);
  return frames === undefined ? 0 : Math.floor(frames);
}

/** One native screenshot row, as the analysis handoff reads it. */
export interface NativeScreenshotRow {
  /** Row id in `screenshots`. */
  id: number;
  /**
   * Capture instant in epoch **seconds**, the unit `screenshots.captured_at`
   * stores; a row written in milliseconds by an older caller is converted.
   */
  capturedAt: number;
  /** Frame file on disk; absent once retention or analysis deleted it. */
  filePath?: string;
  /** Size of the frame file in bytes. */
  fileSize?: number;
  /** Input idleness at capture time, in seconds. */
  idleSeconds?: number;
  /** Parsed `payload_json` evidence; absent when the row has none or it does not parse. */
  payload?: unknown;
}

/** Read an optional non-negative integer column, ignoring values that are not one. */
function optionalStoredInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  if (number === undefined || !Number.isFinite(number) || number < 0) return undefined;
  return Math.floor(number);
}

/** Parse `payload_json` tolerantly: a missing or malformed payload is simply absent. */
function parsedPayload(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** Validate one screenshot row id from a caller. */
function requireScreenshotId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DayflowError(`Screenshot ids must be positive whole numbers (received ${String(value)}).`, 'invalid_input');
  }
  return value;
}

/**
 * List the native frames recorded for one Dayflow day, oldest first.
 *
 * This is the analysis handoff: the pipeline reads a day's frames, groups them
 * into windows, and later clears their `file_path` once it has deleted them.
 * The day uses the same 04:00-to-04:00 window as {@link countScreenshotsForDay},
 * soft-deleted and imported rows are never returned, and `capturedAt` is always
 * epoch seconds even when a row was written in milliseconds.
 * @param db - an open, migrated journal connection.
 * @param day - the Dayflow day key.
 * @returns the day's native frames, ordered by capture instant then id.
 */
export function listNativeScreenshotsForDay(db: DatabaseSync, day: string): NativeScreenshotRow[] {
  const window = dayWindowForKey(typeof day === 'string' ? day : '');
  if (window === undefined) {
    throw new DayflowError(`Screenshot day must be a real YYYY-MM-DD date (received ${String(day)}).`, 'invalid_input');
  }
  const rows = db
    .prepare(
      `SELECT id, captured_at, file_path, file_size, idle_seconds_at_capture, payload_json
         FROM screenshots
        WHERE source_id = ? AND COALESCE(is_deleted, 0) = 0 AND captured_at >= ? AND captured_at < ?
        ORDER BY captured_at ASC, id ASC`,
    )
    .all(NATIVE_SOURCE_ID, epochSeconds(window.start), epochSeconds(window.end)) as Row[];

  const screenshots: NativeScreenshotRow[] = [];
  for (const row of rows) {
    const id = finiteNumber(row.id);
    const capturedAt = finiteNumber(row.captured_at);
    if (id === undefined || capturedAt === undefined) {
      throw new DayflowError('A native screenshot row is missing its id or capture time.', 'database_error');
    }
    const seconds = Math.floor(capturedAt);
    const screenshot: NativeScreenshotRow = {
      id: Math.floor(id),
      capturedAt: seconds >= EPOCH_MILLISECONDS_FLOOR ? Math.floor(seconds / 1000) : seconds,
    };
    if (typeof row.file_path === 'string' && row.file_path !== '') screenshot.filePath = row.file_path;
    const fileSize = optionalStoredInteger(row.file_size);
    if (fileSize !== undefined) screenshot.fileSize = fileSize;
    const idleSeconds = optionalStoredInteger(row.idle_seconds_at_capture);
    if (idleSeconds !== undefined) screenshot.idleSeconds = idleSeconds;
    const payload = parsedPayload(row.payload_json);
    if (payload !== undefined) screenshot.payload = payload;
    screenshots.push(screenshot);
  }
  return screenshots;
}

/** The largest number of row ids one `UPDATE … IN (…)` statement addresses. */
const SCREENSHOT_ID_CHUNK = 500;

/**
 * Clear the `file_path` of native screenshot rows whose frame files are gone.
 *
 * The analysis pipeline calls this after it deletes a fully analysed window's
 * frames: the row, its `source_key`, and the hash in its payload stay, so replay
 * reads identity without the pixels. Imported (`dayflow`) rows are never
 * touched, and an empty id list is a no-op.
 *
 * Note: `screenshots` has no `updated_at` column (unlike `activities` and the
 * other owned tables), so only `file_path` changes here.
 * @param db - an open, migrated journal connection.
 * @param ids - the row ids whose frame files were just deleted.
 */
export function clearScreenshotFilePaths(db: DatabaseSync, ids: readonly number[]): void {
  const valid: number[] = [];
  for (const id of ids) valid.push(requireScreenshotId(id));
  if (valid.length === 0) return;

  for (let start = 0; start < valid.length; start += SCREENSHOT_ID_CHUNK) {
    const chunk = valid.slice(start, start + SCREENSHOT_ID_CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    db.prepare(
      `UPDATE screenshots SET file_path = NULL
        WHERE source_id = ? AND id IN (${placeholders})`,
    ).run(NATIVE_SOURCE_ID, ...chunk);
  }
}
