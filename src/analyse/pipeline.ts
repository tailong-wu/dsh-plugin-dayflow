/**
 * The analysis pipeline: one day of captured frames becomes activity cards.
 *
 * This is the only module that runs the analyser, and the only one that writes
 * native `activities` and `observations` rows. It is deliberately a batch over
 * one Dayflow day, not a timer: {@link AnalysisPipeline.run} reads the day's
 * `screenshots` rows, groups them into windows, asks the model about each
 * window, validates the answer as one strict JSON object, and writes the card.
 * Another module can therefore test every branch with a fake adapter and a
 * temporary journal, and 0.7.2's worker only has to call `run` on a timer.
 *
 * The order of the gates is the contract:
 *
 * 1. the day is resolved (an unparsable day is a caller error and throws);
 * 2. capture state and the day's frames are read, and the frames are grouped
 *    into windows (no window means `empty`, and no job is created);
 * 3. the consent gate ({@link module:dsh-plugin-dayflow/analyse/consent}) is
 *    checked **before** any call, so `consent: 'none'` or a paused capture loop
 *    produces skipped jobs and zero adapter invocations;
 * 4. an unset analyser behaves like a gate: every window is skipped with
 *    `analyser-unset`;
 * 5. each window's job is checked for idempotency, then the daily call budget,
 *    then started and called;
 * 6. the answer is validated before anything is written, and a malformed answer
 *    fails the job without touching the day;
 * 7. a successful window's card, its observations, its job completion, and (at
 *    `keepFramesDays: 0`) its frame-path release are one journal transaction;
 *    the files themselves are deleted after that transaction commits.
 *
 * **Windows.** Adjacent frames belong to the same window while the gap between
 * them is at most `analysis.windowMinutes`; a longer gap starts a new window. A
 * window is the fixed box `[first frame, first frame + windowMinutes)`, so the
 * job key stays stable across runs even when later frames would extend it. One
 * window carries at most `analysis.framesPerWindow` representative frames (the
 * first, middle, and last, spread evenly) into the prompt and into
 * `observations`.
 *
 * **Sessionisation.** Adjacent successful windows merge into one card when the
 * previous window's frontmost app and the card's category are the same and the
 * gap between the windows is at most `mergeGapSeconds`. The merged card keeps
 * the first window's `source_key` (`analysis:<first job key>`), starts at the
 * first window's start, ends at the last merged window's end, and gathers every
 * window's observations. A skipped, failed, or non-adjacent window breaks the
 * run. The merge is deterministic, so replaying the same frames is a no-op.
 *
 * **Idempotency.** The job ledger is the replay guard: a `complete` or
 * `skipped` job is left alone, a `failed` job is retried only while it has
 * attempts left, and a `running` job left behind by a crash is skipped as
 * stale (recovering it is the worker's job in 0.7.2, not this module's). Cards
 * and observations are additionally protected by their own unique
 * `(source_id, source_key)` keys, so a double write cannot duplicate a row.
 *
 * Every failure that belongs to one window — a bad model answer, a call error,
 * a write error, an unreadable frame file — is recorded on that window's job
 * and in the returned statistics; it never escapes `run`. That keeps one bad
 * window from stopping the rest of the day.
 * @module dsh-plugin-dayflow/analyse/pipeline
 */

import { unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { ResolvedConfig } from '../config.js';
import { dayWindowContaining, dayWindowForKey } from '../day.js';
import type { DayWindow } from '../day.js';
import { DayflowError } from '../errors.js';
import { withJournal, withJournalWrite } from '../journal.js';
import {
  clearScreenshotFilePaths,
  listNativeScreenshotsForDay,
  readCaptureState,
} from '../capture/state.js';
import type { NativeScreenshotRow } from '../capture/state.js';
import { decideAnalysis } from './consent.js';
import {
  ANALYSIS_MAX_ATTEMPTS,
  ANALYSIS_MAX_LIST_LIMIT,
  analysisBudgetExhausted,
  analysisJobKey,
  completeAnalysisJob,
  createAnalysisJob,
  failAnalysisJob,
  listAnalysisJobs,
  skipAnalysisJob,
  startAnalysisJob,
} from './jobs.js';
import type { AnalysisJob } from './jobs.js';
import { callAnalysisModel } from './llm.js';
import type { AnalysisLlmStream } from './llm.js';
import { buildAnalysisPrompt } from './prompt.js';
import type { AnalysisFrameMeta, AnalysisWindowInput } from './prompt.js';

/** Everything the pipeline reads; every optional field has a production default. */
export interface AnalysisPipelineOptions {
  /** The plugin-owned journal the frames are read from and the cards written to. */
  journalPath: string;
  /** Where frame files live, used to resolve a relative `screenshots.file_path`. */
  framesDirectory: string;
  /** Resolved plugin config; the `capture` and `analysis` blocks are read. */
  config: ResolvedConfig;
  /** Injectable clock, so a test can fix the day without waiting. */
  now?: () => Date;
  /**
   * The model seam. When absent every window is skipped with reason
   * `analyser-unset` and no call can happen: a real provider is a 0.7.2
   * configuration step, not an implicit default.
   */
  analyser?: AnalysisLlmStream;
  /** Category names the model may choose from; defaults to the owned `categories` table. */
  categories?: readonly string[];
  /** Longest gap between two successful windows that still merges them; defaults to 120. */
  mergeGapSeconds?: number;
  /** Injectable retry delay for the model wrapper, so tests never wait. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** How one run ended, beyond the per-window counters. */
export type AnalysisRunOutcome =
  /** The run reached its end, with no gate stopping it; see `failed` per window. */
  | 'analysed'
  /** The consent gate or an unset analyser refused every window; see `blockedReason`. */
  | 'blocked'
  /** The daily call budget ran out mid-run; the remaining windows are skipped. */
  | 'budget'
  /** There were no frames for the day, so no window and no job existed. */
  | 'empty';

/** What one run did, in the shape the worker and the panel report. */
export interface AnalysisRunResult {
  /** The run's terminal state: it analysed, was gated, was budgeted, or had nothing to do. */
  outcome: AnalysisRunOutcome;
  /** The Dayflow day the run covered (`YYYY-MM-DD`). */
  day: string;
  /** Windows seen in this run's day, before any `maxWindows` cut. */
  windows: number;
  /** Windows whose job completed now. */
  analysed: number;
  /** Windows left alone: replay, stale, attempts cap, blocked, budget, or no analyser. */
  skipped: number;
  /** Windows whose call or answer failed now. */
  failed: number;
  /** New `activities` rows written; a merged window updates a card instead. */
  activitiesWritten: number;
  /** Why the run was blocked, when `outcome` is `blocked`. */
  blockedReason?: string;
}

/** Default merge threshold, matching the plan's 120 seconds. */
const DEFAULT_MERGE_GAP_SECONDS = 120;

/** One strict JSON answer, after validation. */
interface ValidatedAnalysis {
  title: string;
  summary: string;
  category: string;
  subcategory?: string;
  apps: string[];
  distractions: string[];
  confidence: number;
}

/** One frame, with the metadata the prompt and the merge rule need. */
interface FrameMeta {
  row: NativeScreenshotRow;
  /** Capture instant, epoch **seconds** (`screenshots.captured_at`). */
  capturedAt: number;
  appName: string;
  bundleId: string;
  windowTitle: string;
  hash: string;
}

/** One group of adjacent frames, and the fixed job window around it. */
interface FrameWindow {
  frames: FrameMeta[];
  /** Window start, epoch seconds: the first frame's capture instant. */
  startTs: number;
  /** Window end, epoch seconds: `startTs + windowMinutes * 60`, clamped to the day. */
  endTs: number;
  /** The ledger key of this window. */
  jobKey: string;
}

/** A successful card that a later adjacent window may still extend. */
interface PendingSegment {
  /** `activities.id` of the segment's card. */
  activityId: number;
  /** Frontmost-app identity of the last merged window. */
  app: string;
  /** The card's category, which a merge must match. */
  category: string;
  /** The end of the last merged window; where the merge gap is measured from. */
  endTs: number;
}

/** Limits from the response contract; they are the validation, not a preference. */
const MAX_TITLE_CHARS = 200;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_LIST_ENTRIES = 20;

/** The `source_id` every natively written row carries. */
const NATIVE_SOURCE_ID = 'native';

/** A day, as values: only then is a window's clamped end meaningful. */
function clampWindowEnd(startTs: number, windowSeconds: number, day: DayWindow): number {
  const boxEnd = startTs + windowSeconds;
  const dayEnd = Math.floor(day.end.getTime() / 1000);
  return boxEnd > dayEnd ? dayEnd : boxEnd;
}

/** Read a JSON object out of a stored payload, tolerating anything else. */
function payloadRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

/** Read one optional string field from a record. */
function payloadText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Read the frontmost-app metadata a stored frame payload carries. */
function payloadApp(record: Record<string, unknown>): {
  bundleId: string;
  name: string;
  windowTitle: string;
} {
  const raw = record.app;
  const app = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    bundleId: payloadText(app, 'bundleId'),
    name: payloadText(app, 'name'),
    // The capture engine nests the window title inside `app`; the flat key is
    // accepted too so an older or hand-written payload still reads.
    windowTitle: payloadText(app, 'windowTitle') || payloadText(record, 'windowTitle'),
  };
}

/** Turn one stored screenshot row into the metadata the prompt is built from. */
function frameMeta(row: NativeScreenshotRow): FrameMeta {
  const payload = payloadRecord(row.payload);
  const app = payloadApp(payload);
  return {
    row,
    capturedAt: Math.floor(row.capturedAt),
    appName: app.name,
    bundleId: app.bundleId,
    windowTitle: app.windowTitle,
    hash: payloadText(payload, 'hash') || payloadText(payload, 'sha256'),
  };
}

/** The app identity a merge compares: the bundle id when known, else the name. */
function frameAppKey(frame: FrameMeta | undefined): string {
  if (frame === undefined) return '';
  const identity = frame.bundleId !== '' ? frame.bundleId : frame.appName;
  return identity.toLowerCase();
}

/** The last frame's app identity: the app the window ended on. */
function windowAppKey(window: FrameWindow): string {
  return frameAppKey(window.frames[window.frames.length - 1]);
}

/** The merge key of one frame for the prompt: only fields the capture reported. */
function promptFrameMeta(frame: FrameMeta): AnalysisFrameMeta {
  const meta: AnalysisFrameMeta = { capturedAt: frame.capturedAt };
  if (frame.bundleId !== '' || frame.appName !== '') {
    meta.app = {};
    if (frame.bundleId !== '') meta.app.bundleId = frame.bundleId;
    if (frame.appName !== '') meta.app.name = frame.appName;
  }
  if (frame.windowTitle !== '') meta.windowTitle = frame.windowTitle;
  if (frame.hash !== '') meta.hash = frame.hash;
  return meta;
}

/**
 * Group a day's frames into windows.
 *
 * Adjacent frames stay together while the gap between them is at most the
 * configured window length; a longer gap starts a new window. The window's end
 * is its start plus the configured length (the stable box a job key describes),
 * clamped to the Dayflow day, so the same frames always produce the same key.
 */
function groupWindows(
  frames: readonly FrameMeta[],
  windowSeconds: number,
  day: DayWindow,
  dayKey: string,
): FrameWindow[] {
  const windows: FrameWindow[] = [];
  let current: FrameMeta[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const startTs = current[0]?.capturedAt ?? 0;
    windows.push({
      frames: current,
      startTs,
      endTs: clampWindowEnd(startTs, windowSeconds, day),
      jobKey: analysisJobKey(dayKey, startTs),
    });
    current = [];
  };

  for (const frame of frames) {
    const previous = current[current.length - 1];
    if (previous !== undefined && frame.capturedAt - previous.capturedAt > windowSeconds) flush();
    current.push(frame);
  }
  flush();
  return windows;
}

/**
 * Pick at most `limit` representative frames from one window.
 *
 * The first and last frames are always included, with the rest spread evenly
 * between them, so a window's shape is visible in the prompt without sending
 * every frame. With one slot only the first frame is sent.
 */
function representativeFrames(frames: readonly FrameMeta[], limit: number): FrameMeta[] {
  const count = Math.max(0, Math.min(Math.floor(limit), frames.length));
  if (count === 0) return [];
  if (count === frames.length) return [...frames];
  if (count === 1) return [frames[0] as FrameMeta];

  const last = frames.length - 1;
  const picked: FrameMeta[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const index = Math.round((slot * last) / (count - 1));
    const frame = frames[index];
    if (frame !== undefined) picked.push(frame);
  }
  return picked;
}

/** Index a day's jobs by their key. */
function indexJobs(jobs: readonly AnalysisJob[]): Map<string, AnalysisJob> {
  const index = new Map<string, AnalysisJob>();
  for (const job of jobs) index.set(job.job_key, job);
  return index;
}

/** Normalize an optional string array from the model answer, or fail. */
function validateStringList(
  value: unknown,
  field: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: `"${field}" must be an array of strings` };
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return { ok: false, error: `"${field}" must contain only strings` };
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(trimmed);
    if (entries.length >= MAX_LIST_ENTRIES) break;
  }
  return { ok: true, value: entries };
}

/**
 * Validate one model answer against the strict JSON contract.
 *
 * The answer must be exactly one JSON object (surrounding whitespace allowed,
 * nothing else — a second object or prose around it is a failure), with a
 * non-empty bounded `title`, a bounded `summary`, a `category` that is one of
 * the offered names (an empty category means "none fits" and is accepted),
 * optional `subcategory`, `apps[]`, `distractions[]`, and a `confidence` from
 * 0 to 1. Unknown keys are ignored, so the contract can grow without breaking
 * an older prompt.
 */
function validateAnalysisOutput(
  text: string,
  categories: readonly string[],
): { ok: true; value: ValidatedAnalysis } | { ok: false; error: string } {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed === '') return { ok: false, error: 'the model returned no text' };
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { ok: false, error: 'the model output is not exactly one JSON object' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    // A second object, trailing prose, or a truncated object all land here.
    return { ok: false, error: 'the model output is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'the model output is not a JSON object' };
  }
  const record = parsed as Record<string, unknown>;

  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (title === '') return { ok: false, error: 'the model output has no non-empty "title"' };
  if (title.length > MAX_TITLE_CHARS) {
    return { ok: false, error: `the model output "title" is longer than ${String(MAX_TITLE_CHARS)} characters` };
  }

  if (typeof record.summary !== 'string') {
    return { ok: false, error: 'the model output has no string "summary"' };
  }
  const summary = record.summary.trim();
  if (summary.length > MAX_SUMMARY_CHARS) {
    return { ok: false, error: `the model output "summary" is longer than ${String(MAX_SUMMARY_CHARS)} characters` };
  }

  if (typeof record.category !== 'string') {
    return { ok: false, error: 'the model output has no string "category"' };
  }
  const category = record.category.trim();
  if (category !== '' && categories.length > 0 && !categories.includes(category)) {
    return { ok: false, error: `the model output category "${category}" is not one of the offered categories` };
  }

  let subcategory: string | undefined;
  if (record.subcategory !== undefined && record.subcategory !== null) {
    if (typeof record.subcategory !== 'string') {
      return { ok: false, error: 'the model output "subcategory" is not a string' };
    }
    const trimmedSubcategory = record.subcategory.trim();
    if (trimmedSubcategory !== '') subcategory = trimmedSubcategory;
  }

  const apps = validateStringList(record.apps, 'apps');
  if (!apps.ok) return apps;
  const distractions = validateStringList(record.distractions, 'distractions');
  if (!distractions.ok) return distractions;

  const confidence = record.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, error: 'the model output "confidence" is not a number from 0 to 1' };
  }

  const value: ValidatedAnalysis = {
    title,
    summary,
    category,
    apps: apps.value,
    distractions: distractions.value,
    confidence,
  };
  if (subcategory !== undefined) value.subcategory = subcategory;
  return { ok: true, value };
}

/** Read the owned category names, in a deterministic order. */
function readCategoryNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM categories
        WHERE TRIM(COALESCE(name, '')) <> ''
        GROUP BY name
        ORDER BY name ASC`,
    )
    .all() as { name?: unknown }[];
  const names: string[] = [];
  for (const row of rows) {
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name !== '' && !names.includes(name)) names.push(name);
  }
  return names;
}

/** One stored screenshot row as the observation payload keeps it. */
function observationPayload(frame: FrameMeta): string {
  const payload: Record<string, unknown> = { screenshot_id: frame.row.id };
  if (frame.hash !== '') payload.hash = frame.hash;
  if (frame.bundleId !== '' || frame.appName !== '') {
    payload.app = {};
    if (frame.bundleId !== '') (payload.app as Record<string, unknown>).bundleId = frame.bundleId;
    if (frame.appName !== '') (payload.app as Record<string, unknown>).name = frame.appName;
  }
  if (frame.windowTitle !== '') payload.window_title = frame.windowTitle;
  return JSON.stringify(payload);
}

/** Insert one native activity row, returning its id (existing row on replay). */
function insertActivity(
  db: DatabaseSync,
  input: {
    sourceKey: string;
    day: string;
    startTs: number;
    endTs: number;
    output: ValidatedAnalysis;
    payloadJson: string;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO activities (source_id, source_key, batch_id, start, end, start_ts, end_ts, day,
         title, summary, category, subcategory, payload_json)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_id, source_key) DO NOTHING`,
    )
    .run(
      NATIVE_SOURCE_ID,
      input.sourceKey,
      new Date(input.startTs * 1000).toISOString(),
      new Date(input.endTs * 1000).toISOString(),
      input.startTs,
      input.endTs,
      input.day,
      input.output.title,
      input.output.summary,
      input.output.category,
      input.output.subcategory ?? null,
      input.payloadJson,
    );
  if (Number(result.changes) > 0) {
    const inserted = Number(result.lastInsertRowid);
    if (Number.isSafeInteger(inserted) && inserted > 0) return inserted;
  }
  const rows = db
    .prepare('SELECT id FROM activities WHERE source_id = ? AND source_key = ?')
    .get(NATIVE_SOURCE_ID, input.sourceKey) as { id?: unknown } | undefined;
  const existing = typeof rows?.id === 'number' ? rows.id : Number(rows?.id);
  if (!Number.isSafeInteger(existing) || existing <= 0) {
    throw new DayflowError('An analysis activity could not be read back after writing it.', 'database_error');
  }
  return existing;
}

/** Insert one observation per representative frame, idempotently. */
function insertObservations(
  db: DatabaseSync,
  activityId: number,
  jobKey: string,
  frames: readonly FrameMeta[],
): void {
  const statement = db.prepare(
    `INSERT INTO observations (source_id, source_key, activity_id, start_ts, end_ts, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (source_id, source_key) DO NOTHING`,
  );
  for (const frame of frames) {
    statement.run(
      NATIVE_SOURCE_ID,
      `${jobKey}:${String(frame.row.id)}`,
      activityId,
      frame.capturedAt,
      frame.capturedAt,
      observationPayload(frame),
    );
  }
}

/** Extend a segment's card to the new window's end. */
function extendActivityEnd(db: DatabaseSync, activityId: number, endTs: number): void {
  db.prepare('UPDATE activities SET end = ?, end_ts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    new Date(endTs * 1000).toISOString(),
    endTs,
    activityId,
  );
}

/**
 * The analysis pipeline over one Dayflow day.
 *
 * Construct it with the journal path, the frames directory, and the resolved
 * config; call {@link AnalysisPipeline.run} with an optional day, window cap, and
 * abort signal. It keeps no state between runs: the ledger, the frames, and the
 * done-jobs are the memory.
 */
export class AnalysisPipeline {
  private readonly journalPath: string;
  private readonly framesDirectory: string;
  private readonly config: ResolvedConfig;
  private readonly now: () => Date;
  private readonly analyser: AnalysisLlmStream | undefined;
  private readonly configuredCategories: readonly string[] | undefined;
  private readonly mergeGapSeconds: number;
  private readonly sleep: ((milliseconds: number) => Promise<void>) | undefined;

  constructor(options: AnalysisPipelineOptions) {
    this.journalPath = options.journalPath;
    this.framesDirectory = options.framesDirectory;
    this.config = options.config;
    this.now = options.now ?? (() => new Date());
    this.analyser = options.analyser;
    this.configuredCategories = options.categories;
    this.mergeGapSeconds =
      options.mergeGapSeconds !== undefined && Number.isFinite(options.mergeGapSeconds)
        ? Math.max(0, Math.floor(options.mergeGapSeconds))
        : DEFAULT_MERGE_GAP_SECONDS;
    this.sleep = options.sleep;
  }

  /**
   * Analyse one day's frames.
   *
   * Per-window failures never throw: they are recorded on the job and counted
   * in the result. Only an unusable `day` argument throws (`invalid_input`).
   * @param options - the day (default: the one containing `now`), a window cap,
   *   and an abort signal for the model calls.
   * @returns what the run did.
   */
  async run(options: { day?: string; maxWindows?: number; signal?: AbortSignal } = {}): Promise<AnalysisRunResult> {
    const requestedDay = options.day === undefined ? '' : options.day.trim();
    const day = requestedDay === '' ? dayWindowContaining(this.now()) : dayWindowForKey(requestedDay);
    if (day === undefined) {
      throw new DayflowError(
        `"${requestedDay}" is not a date. Use YYYY-MM-DD, for example 2026-03-11.`,
        'invalid_input',
      );
    }
    const dayKey = day.dayKey;

    // Read the runtime state, the day's frames, and the offered categories in
    // one pass. A read failure here means the journal itself is unusable, which
    // is a caller-level failure, not one window's.
    const snapshot = withJournal(this.journalPath, (db) => ({
      paused: readCaptureState(db).paused,
      frames: listNativeScreenshotsForDay(db, dayKey),
      categories: this.configuredCategories === undefined ? readCategoryNames(db) : [...this.configuredCategories],
    }));
    const categories = snapshot.categories;

    const result: AnalysisRunResult = {
      outcome: 'analysed',
      day: dayKey,
      windows: 0,
      analysed: 0,
      skipped: 0,
      failed: 0,
      activitiesWritten: 0,
    };

    const windowSeconds = this.config.analysis.windowMinutes * 60;
    const windows = groupWindows(snapshot.frames.map(frameMeta), windowSeconds, day, dayKey);
    result.windows = windows.length;
    if (windows.length === 0) {
      result.outcome = 'empty';
      return result;
    }

    // Gate 1: consent. Checked before any provider call can exist.
    const decision = decideAnalysis({
      analysis: this.config.analysis,
      capture: this.config.capture,
      paused: snapshot.paused,
    });
    if (!decision.allowed) {
      this.skipEveryWindow(windows, day, decision.reason);
      result.outcome = 'blocked';
      result.skipped = windows.length;
      result.blockedReason = decision.reason;
      return result;
    }

    // Gate 2: no analyser injected. Same shape as a gate — skipped jobs, no call.
    const analyser = this.analyser;
    if (analyser === undefined) {
      this.skipEveryWindow(windows, day, 'analyser-unset');
      result.outcome = 'blocked';
      result.skipped = windows.length;
      result.blockedReason = 'analyser-unset';
      return result;
    }

    const maxWindows = options.maxWindows;
    const limit =
      maxWindows === undefined || !Number.isFinite(maxWindows)
        ? windows.length
        : Math.max(0, Math.min(windows.length, Math.floor(maxWindows)));
    const signal = options.signal ?? new AbortController().signal;
    const keepFrames = this.config.capture.keepFramesDays === 0;
    const jobs = indexJobs(
      withJournal(this.journalPath, (db) => listAnalysisJobs(db, { day: dayKey, limit: ANALYSIS_MAX_LIST_LIMIT })),
    );
    let pending: PendingSegment | undefined;

    for (let index = 0; index < limit; index += 1) {
      const window = windows[index] as FrameWindow;
      const existing = jobs.get(window.jobKey);

      // Idempotent replay: a terminal or exhausted job is never started again.
      if (existing !== undefined) {
        if (existing.status === 'complete' || existing.status === 'skipped') {
          result.skipped += 1;
          pending = undefined;
          continue;
        }
        if (existing.status === 'running') {
          // A crash left this row running. The worker owns recovery in 0.7.2;
          // the pipeline must not reuse an attempt it did not start.
          result.skipped += 1;
          pending = undefined;
          continue;
        }
        if (existing.status === 'failed' && existing.attempts >= ANALYSIS_MAX_ATTEMPTS) {
          result.skipped += 1;
          pending = undefined;
          continue;
        }
      }

      // Gate 3: the day's call budget, checked before each start because an
      // earlier window in this run may have used the last call.
      let budgetExhausted: boolean;
      try {
        budgetExhausted = withJournal(this.journalPath, (db) =>
          analysisBudgetExhausted(db, dayKey, this.config.analysis.maxCallsPerDay),
        );
      } catch (error) {
        this.failWindow(existing, window, dayKey, error);
        result.failed += 1;
        pending = undefined;
        continue;
      }
      if (budgetExhausted) {
        result.outcome = 'budget';
        this.skipRemainingForBudget(windows, index, limit, jobs, dayKey);
        result.skipped += limit - index;
        pending = undefined;
        break;
      }

      // Start the job. Any failure is that window's, not the run's.
      let job: AnalysisJob;
      try {
        job = this.startJob(existing, window, dayKey);
        jobs.set(window.jobKey, job);
      } catch (error) {
        this.failWindow(existing, window, dayKey, error);
        result.failed += 1;
        pending = undefined;
        continue;
      }

      const selected = representativeFrames(window.frames, this.config.analysis.framesPerWindow);
      const promptInput: AnalysisWindowInput = {
        day: dayKey,
        windowStartTs: window.startTs,
        windowEndTs: window.endTs,
        frames: selected.map(promptFrameMeta),
        categories,
      };
      const prompt = buildAnalysisPrompt(promptInput);

      let text: string;
      let usageModel: string;
      let inputTokens: number;
      let outputTokens: number;
      try {
        const call = await callAnalysisModel(
          analyser,
          {
            provider: decision.provider,
            model: decision.model,
            system: prompt.system,
            user: prompt.user,
            signal,
          },
          this.sleep === undefined ? undefined : { sleep: this.sleep },
        );
        text = call.text;
        usageModel = call.model;
        inputTokens = call.inputTokens;
        outputTokens = call.outputTokens;
      } catch (error) {
        this.failJob(job.id, error);
        result.failed += 1;
        pending = undefined;
        continue;
      }

      const validated = validateAnalysisOutput(text, categories);
      if (!validated.ok) {
        this.failJob(job.id, new DayflowError(validated.error, 'invalid_input'));
        result.failed += 1;
        pending = undefined;
        continue;
      }
      const output = validated.value;

      try {
        const outcome = this.writeWindow({
          dayKey,
          window,
          selected,
          job,
          output,
          provider: decision.provider,
          usageModel,
          inputTokens,
          outputTokens,
          pending,
          keepFrames,
        });
        result.analysed += 1;
        if (outcome.written) result.activitiesWritten += 1;
        pending = {
          activityId: outcome.activityId,
          app: windowAppKey(window),
          category: output.category,
          endTs: window.endTs,
        };
        if (keepFrames) await this.deleteFrameFiles(window.frames);
      } catch (error) {
        this.failJob(job.id, error);
        result.failed += 1;
        pending = undefined;
      }
    }

    return result;
  }

  /** Create and start one window's job, inside one journal transaction. */
  private startJob(existing: AnalysisJob | undefined, window: FrameWindow, dayKey: string): AnalysisJob {
    return withJournalWrite(this.journalPath, (db) => {
      const job =
        existing === undefined
          ? createAnalysisJob(db, {
              jobKey: window.jobKey,
              day: dayKey,
              windowStartTs: window.startTs,
              windowEndTs: window.endTs,
            })
          : existing;
      return startAnalysisJob(db, job.id);
    });
  }

  /**
   * Write one successful window: the card (or the merged extension), its
   * observations, the job completion, and the frame-path release, all in one
   * transaction so a crash cannot leave half a card behind.
   */
  private writeWindow(input: {
    dayKey: string;
    window: FrameWindow;
    /** The representative frames the model saw, one observation each. */
    selected: readonly FrameMeta[];
    job: AnalysisJob;
    output: ValidatedAnalysis;
    provider: string;
    usageModel: string;
    inputTokens: number;
    outputTokens: number;
    pending: PendingSegment | undefined;
    keepFrames: boolean;
  }): { activityId: number; written: boolean } {
    const { window, job, output, pending } = input;
    const appKey = windowAppKey(window);
    const mergeable =
      pending !== undefined &&
      pending.category === output.category &&
      pending.app === appKey &&
      window.startTs - pending.endTs <= this.mergeGapSeconds;

    return withJournalWrite(this.journalPath, (db) => {
      let activityId: number;
      let written = false;
      if (mergeable && pending !== undefined) {
        extendActivityEnd(db, pending.activityId, window.endTs);
        activityId = pending.activityId;
      } else {
        const payloadJson = JSON.stringify({
          job_key: window.jobKey,
          model: input.usageModel,
          provider: input.provider,
          input_tokens: input.inputTokens,
          output_tokens: input.outputTokens,
          confidence: output.confidence,
          apps: output.apps,
          distractions: output.distractions,
        });
        activityId = insertActivity(db, {
          sourceKey: `analysis:${window.jobKey}`,
          day: input.dayKey,
          startTs: window.startTs,
          endTs: window.endTs,
          output,
          payloadJson,
        });
        written = true;
      }
      insertObservations(db, activityId, window.jobKey, input.selected);
      completeAnalysisJob(db, job.id, {
        model: input.usageModel,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
      });
      if (input.keepFrames) clearScreenshotFilePaths(db, window.frames.map((frame) => frame.row.id));
      return { activityId, written };
    });
  }

  /** Record one window's failure on its job, swallowing a bookkeeping failure. */
  private failJob(jobId: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    try {
      withJournalWrite(this.journalPath, (db) => {
        failAnalysisJob(db, jobId, message);
      });
    } catch {
      // The run must not throw; a job that cannot be marked is left for the sweep.
    }
  }

  /**
   * Record a failure that happened before a job could be started.
   *
   * A start that throws inside its own transaction rolls the row back, so the
   * only durable outcome left is a freshly created, failed job: the window then
   * has a row the next run and the panel can see, and its attempts cap applies.
   */
  private failWindow(
    existing: AnalysisJob | undefined,
    window: FrameWindow,
    dayKey: string,
    error: unknown,
  ): void {
    if (existing !== undefined) {
      this.failJob(existing.id, error);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    try {
      withJournalWrite(this.journalPath, (db) => {
        const job = createAnalysisJob(db, {
          jobKey: window.jobKey,
          day: dayKey,
          windowStartTs: window.startTs,
          windowEndTs: window.endTs,
        });
        failAnalysisJob(db, job.id, message);
      });
    } catch {
      // The run must not throw; an unrecordable window is still counted.
    }
  }

  /**
   * Create-and-skip a job for every window that has no job yet, in one
   * transaction. Used by the consent gate and the unset-analyser gate, which
   * both refuse every window before any call.
   */
  private skipEveryWindow(windows: readonly FrameWindow[], day: DayWindow, reason: string): void {
    try {
      withJournalWrite(this.journalPath, (db) => {
        const existing = indexJobs(
          listAnalysisJobs(db, { day: day.dayKey, limit: ANALYSIS_MAX_LIST_LIMIT }),
        );
        for (const window of windows) {
          if (existing.has(window.jobKey)) continue;
          const job = createAnalysisJob(db, {
            jobKey: window.jobKey,
            day: day.dayKey,
            windowStartTs: window.startTs,
            windowEndTs: window.endTs,
          });
          skipAnalysisJob(db, job.id, reason);
          existing.set(window.jobKey, job);
        }
      });
    } catch {
      // A blocked day is reported by the caller; a bookkeeping failure here
      // must not turn a gate into a throw.
    }
  }

  /** Skip the windows this run can no longer afford, one job each. */
  private skipRemainingForBudget(
    windows: readonly FrameWindow[],
    from: number,
    limit: number,
    jobs: Map<string, AnalysisJob>,
    dayKey: string,
  ): void {
    for (let index = from; index < limit; index += 1) {
      const window = windows[index] as FrameWindow;
      const existing = jobs.get(window.jobKey);
      if (existing !== undefined) {
        const terminal =
          existing.status === 'complete' ||
          existing.status === 'skipped' ||
          existing.status === 'running' ||
          (existing.status === 'failed' && existing.attempts >= ANALYSIS_MAX_ATTEMPTS);
        if (terminal) continue;
      }
      try {
        withJournalWrite(this.journalPath, (db) => {
          const job =
            existing === undefined
              ? createAnalysisJob(db, {
                  jobKey: window.jobKey,
                  day: dayKey,
                  windowStartTs: window.startTs,
                  windowEndTs: window.endTs,
                })
              : existing;
          skipAnalysisJob(db, job.id, 'budget');
          jobs.set(window.jobKey, job);
        });
      } catch {
        // Counting is the caller's job; a write failure does not stop the run.
      }
    }
  }

  /**
   * Delete a fully analysed window's frame files.
   *
   * Runs after the journal transaction, so a failed write never loses a frame.
   * A file that is already gone is fine; any other unlink failure is ignored
   * too — the row already lost its path, and the retention sweep is the
   * fallback for an orphaned file.
   */
  private async deleteFrameFiles(frames: readonly FrameMeta[]): Promise<void> {
    for (const frame of frames) {
      const filePath = frame.row.filePath;
      if (filePath === undefined || filePath === '') continue;
      const resolved = isAbsolute(filePath) ? filePath : join(this.framesDirectory, filePath);
      try {
        await unlink(resolved);
      } catch {
        // ENOENT is expected after a previous partial sweep; anything else is
        // left to the capture engine's retention pass.
      }
    }
  }
}
