/**
 * Long tasks: work that spans days, the dated sessions it accumulates, and the
 * derived progress summary that keeps the plan honest.
 *
 * A task is intentionally thin — a title, a description, a status, and the
 * *signals* that identify its work (categories and apps). The evidence lives in
 * `long_task_sessions`: one row per (task, day) with the minutes and the
 * activities that day contributed. Progress is always derived from those rows,
 * so attaching the same day twice replaces that day's number instead of
 * double-counting it.
 *
 * Two properties make the surface cheap to use:
 *
 * - **The clock is injectable.** Stall detection compares the last session (or
 *   the creation day) with a `now` the caller passes, so tests are deterministic
 *   and a tool can ask "was this stale *yesterday*".
 * - **Suggestions explain themselves.** A candidate carries the score, the
 *   matched `reasons` (`category:<name>`, `app:<name>`), and the activity ids
 *   that produced it, so the user can accept or reject the match instead of
 *   trusting a black box.
 *
 * The store lives in the owned journal and is created by migration 4 in
 * {@link module:dsh-plugin-dayflow/journal}.
 * @module dsh-plugin-dayflow/tasks
 */

import type { DatabaseSync } from 'node:sqlite';

import { dayWindowForKey } from './day.js';
import { DayflowError } from './errors.js';

/** Where a long task is in its life cycle. */
export type LongTaskStatus = 'active' | 'paused' | 'done' | 'dropped';
/** Who raised the task: the user directly, or an accepted agent proposal. */
export type LongTaskOrigin = 'user' | 'agent';

/** One day's work attached to a task. */
export interface LongTaskSessionPayload {
  day: string;
  minutes: number;
  note?: string;
  activity_ids?: number[];
}

/** A long task with its derived progress summary. */
export interface LongTaskPayload {
  id: number;
  title: string;
  description: string;
  status: LongTaskStatus;
  origin: LongTaskOrigin;
  proposed_by?: string;
  review_item_id?: number;
  target_date?: string;
  categories: string[];
  apps: string[];
  created_at: string;
  accepted_at?: string;
  updated_at?: string;
  total_minutes: number;
  session_days: number;
  last_session_day?: string;
  stalled: boolean;
  sessions?: LongTaskSessionPayload[];
}

/** What a caller supplies when creating a task. */
export interface CreateLongTaskInput {
  title: string;
  description?: string;
  target_date?: string;
  categories?: string[];
  apps?: string[];
  origin?: LongTaskOrigin;
  proposed_by?: string;
  review_item_id?: number;
}

/** What a caller supplies when attaching one day to a task. */
export interface AttachSessionInput {
  day: string;
  minutes: number;
  note?: string;
  activity_ids?: number[];
}

/** One explainable suggestion for a day's activities. */
export interface TaskMatchCandidate {
  task_id: number;
  title: string;
  score: number;
  activity_ids: number[];
  reasons: string[];
}

/** Days without a session after which an active task counts as stalled. */
export const STALL_DAYS = 7;

/** Read limit when the caller states none. */
const DEFAULT_LIST_LIMIT = 50;
/** Upper bound for one task-list read. */
const MAX_LIST_LIMIT = 200;
/** Suggestion count when the caller states none. */
const DEFAULT_MATCH_LIMIT = 5;
/** Upper bound for one suggestion read. */
const MAX_MATCH_LIMIT = 20;
/** A category match is worth more than a single app match. */
const CATEGORY_SCORE = 2;
/** One app match adds this much. */
const APP_SCORE = 1;
/** Candidates below this score are not suggestions. */
const DEFAULT_MIN_SCORE = 2;
/** Milliseconds in one day, for stall arithmetic. */
const MS_PER_DAY = 86_400_000;

const STATUSES: ReadonlySet<string> = new Set<LongTaskStatus>(['active', 'paused', 'done', 'dropped']);
const ORIGINS: ReadonlySet<string> = new Set<LongTaskOrigin>(['user', 'agent']);
const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** One raw SQLite row, keyed by column name. */
type TaskRow = Record<string, unknown>;

function asNumber(value: unknown): number | undefined {
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

function asInteger(value: unknown): number | undefined {
  const number = asNumber(value);
  return number === undefined || !Number.isSafeInteger(number) ? undefined : number;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function invalid(message: string): DayflowError {
  return new DayflowError(message, 'invalid_input');
}

function notFound(id: unknown): DayflowError {
  return new DayflowError(`No long task with id ${String(id)}.`, 'not_found');
}

function asStatus(value: unknown): LongTaskStatus | undefined {
  return typeof value === 'string' && STATUSES.has(value) ? (value as LongTaskStatus) : undefined;
}

function asOrigin(value: unknown): LongTaskOrigin | undefined {
  return typeof value === 'string' && ORIGINS.has(value) ? (value as LongTaskOrigin) : undefined;
}

function requireStatus(value: unknown): LongTaskStatus {
  const status = asStatus(value);
  if (status === undefined) throw invalid('Long task status must be one of active, paused, done, or dropped.');
  return status;
}

function requireOrigin(value: unknown): LongTaskOrigin {
  const origin = asOrigin(value);
  if (origin === undefined) throw invalid('Long task origin must be "user" or "agent".');
  return origin;
}

/** A real `YYYY-MM-DD` day key, rejecting impossible dates such as 2026-02-30. */
function requireDayKey(value: unknown): string {
  if (typeof value !== 'string') throw invalid('A task day must be a YYYY-MM-DD string.');
  const window = dayWindowForKey(value);
  if (window === undefined) {
    throw invalid(`"${value}" is not a day. Use YYYY-MM-DD, for example 2026-03-11.`);
  }
  return window.dayKey;
}

/** An optional date label; a blank value counts as "not stated". */
function optionalTargetDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid('Long task target_date must be a YYYY-MM-DD string.');
  if (value.trim() === '') return undefined;
  return requireDayKey(value);
}

/** An optional string kept verbatim. */
function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(`Long task ${label} must be a string.`);
  return value;
}

/** An optional string trimmed; a blank value counts as absent. */
function optionalTrimmed(value: unknown, label: string): string | undefined {
  const text = optionalString(value, label);
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** An optional positive integer, used for foreign keys such as review items. */
function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalid(`Long task ${label} must be a positive integer.`);
  }
  return value as number;
}

/** Normalize a signal list: strings only, trimmed, de-duplicated, order kept. */
function normalizeSignalList(value: unknown, label: 'categories' | 'apps'): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`Long task ${label} must be an array of strings.`);
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string') throw invalid(`Long task ${label} must be an array of strings.`);
    const trimmed = entry.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

/** Parse a stored JSON string array, tolerating corruption as "no signals". */
function parseStringArray(value: unknown): string[] {
  const raw = asText(value);
  if (raw === undefined || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

/** Parse a stored JSON integer array; `undefined` when the column is absent. */
function parseIntegerArray(value: unknown): number[] | undefined {
  const raw = asText(value);
  if (raw === undefined || raw === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is number => Number.isSafeInteger(entry));
  } catch {
    return [];
  }
}

/** Validate an optional activity-id list for one session. */
function optionalActivityIds(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalid('Long task session activity_ids must be an array of integers.');
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const entry of value as unknown[]) {
    if (!Number.isSafeInteger(entry)) throw invalid('Long task session activity_ids must be an array of integers.');
    const id = entry as number;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** The `YYYY-MM-DD` prefix of a stored timestamp, e.g. SQLite's `CURRENT_TIMESTAMP`. */
const TIMESTAMP_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

/** The `YYYY-MM-DD` prefix of a stored timestamp. */
function datePart(value: string): string | undefined {
  const match = TIMESTAMP_DAY_PATTERN.exec(value);
  return match === null ? undefined : `${match[1]}-${match[2]}-${match[3]}`;
}

/** Whole days from the baseline day's UTC midnight to `now`. */
function elapsedDays(dayKey: string, now: Date): number | undefined {
  if (!DAY_KEY_PATTERN.test(dayKey)) return undefined;
  const midnight = Date.parse(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(midnight)) return undefined;
  return (now.getTime() - midnight) / MS_PER_DAY;
}

/**
 * Whether an active task has gone quiet for longer than {@link STALL_DAYS}.
 *
 * The baseline is the last session day, or the task's creation day when it has
 * no session yet. A task that is paused, done, or dropped never counts as
 * stalled: those statuses say the user already decided what to do with it.
 */
function isStalled(status: LongTaskStatus, lastSessionDay: string | undefined, createdAt: string, now: Date): boolean {
  if (status !== 'active') return false;
  const baseline = lastSessionDay ?? datePart(createdAt);
  if (baseline === undefined) return false;
  const elapsed = elapsedDays(baseline, now);
  return elapsed !== undefined && elapsed > STALL_DAYS;
}

/** Read one task row, failing as `not_found` when it does not exist. */
function requireTaskRow(db: DatabaseSync, id: number): TaskRow {
  if (!Number.isSafeInteger(id) || id < 1) throw notFound(id);
  const row = db.prepare('SELECT * FROM long_tasks WHERE id = ?').get(id) as TaskRow | undefined;
  if (row === undefined) throw notFound(id);
  return row;
}

/** The session rows of one task, oldest day first. */
function sessionPayloads(db: DatabaseSync, taskId: number): LongTaskSessionPayload[] {
  const rows = db
    .prepare('SELECT * FROM long_task_sessions WHERE task_id = ? ORDER BY day ASC, id ASC')
    .all(taskId) as TaskRow[];
  return rows.map((row) => {
    const session: LongTaskSessionPayload = {
      day: asText(row.day) ?? '',
      minutes: asInteger(row.minutes) ?? 0,
    };
    const note = asText(row.note);
    if (note !== undefined) session.note = note;
    const activityIds = parseIntegerArray(row.activity_ids_json);
    if (activityIds !== undefined) session.activity_ids = activityIds;
    return session;
  });
}

/** Map one `long_tasks` row plus its aggregates to the tool-facing payload. */
function taskPayload(db: DatabaseSync, row: TaskRow, now: Date, includeSessions: boolean): LongTaskPayload {
  const id = asInteger(row.id);
  if (id === undefined) throw new DayflowError('A long task row has no usable id.', 'database_error');
  const status: LongTaskStatus = asStatus(row.status) ?? 'active';
  const origin: LongTaskOrigin = asOrigin(row.origin) ?? 'user';
  const createdAt = asText(row.created_at) ?? '';
  const summary = db
    .prepare(
      `SELECT COALESCE(SUM(minutes), 0) AS total_minutes,
              COUNT(DISTINCT day) AS session_days,
              MAX(day) AS last_session_day
         FROM long_task_sessions
        WHERE task_id = ?`,
    )
    .get(id) as TaskRow | undefined;
  const lastSessionDay = asText(summary?.last_session_day);

  const payload: LongTaskPayload = {
    id,
    title: asText(row.title) ?? '',
    description: asText(row.description) ?? '',
    status,
    origin,
    categories: parseStringArray(row.categories_json),
    apps: parseStringArray(row.apps_json),
    created_at: createdAt,
    updated_at: asText(row.updated_at) ?? '',
    total_minutes: asInteger(summary?.total_minutes) ?? 0,
    session_days: asInteger(summary?.session_days) ?? 0,
    stalled: isStalled(status, lastSessionDay, createdAt, now),
  };
  if (lastSessionDay !== undefined) payload.last_session_day = lastSessionDay;
  const proposedBy = asText(row.proposed_by);
  if (proposedBy !== undefined) payload.proposed_by = proposedBy;
  const reviewItemId = asInteger(row.review_item_id);
  if (reviewItemId !== undefined) payload.review_item_id = reviewItemId;
  const targetDate = asText(row.target_date);
  if (targetDate !== undefined) payload.target_date = targetDate;
  const acceptedAt = asText(row.accepted_at);
  if (acceptedAt !== undefined) payload.accepted_at = acceptedAt;
  if (includeSessions) payload.sessions = sessionPayloads(db, id);
  return payload;
}

function readTask(db: DatabaseSync, id: number, now: Date, includeSessions: boolean): LongTaskPayload | undefined {
  const row = db.prepare('SELECT * FROM long_tasks WHERE id = ?').get(id) as TaskRow | undefined;
  return row === undefined ? undefined : taskPayload(db, row, now, includeSessions);
}

function requireTask(db: DatabaseSync, id: number, now: Date, includeSessions: boolean): LongTaskPayload {
  const payload = readTask(db, id, now, includeSessions);
  if (payload === undefined) throw notFound(id);
  return payload;
}

/**
 * Create one long task.
 *
 * The title is required and trimmed; categories and apps are the explanation
 * signals used by {@link suggestTaskMatches} later. A task raised by an agent
 * (`origin: 'agent'`) is stamped `accepted_at` at creation: the proposal is in
 * the store because the user already adopted it. A user task keeps
 * `accepted_at` unset — it is the user's own plan, not an accepted proposal.
 */
export function createLongTask(db: DatabaseSync, input: CreateLongTaskInput): LongTaskPayload {
  if (input === undefined || input === null) throw invalid('A long task input is required.');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title === '') throw invalid('A long task needs a non-empty title.');
  const description = input.description === undefined || input.description === null ? '' : input.description;
  if (typeof description !== 'string') throw invalid('A long task description must be a string.');
  const categories = normalizeSignalList(input.categories, 'categories');
  const apps = normalizeSignalList(input.apps, 'apps');
  const targetDate = optionalTargetDate(input.target_date);
  const origin = input.origin === undefined || input.origin === null ? 'user' : requireOrigin(input.origin);
  const proposedBy = optionalTrimmed(input.proposed_by, 'proposer');
  const reviewItemId = optionalPositiveInteger(input.review_item_id, 'review item id');

  const inserted = db
    .prepare(
      `INSERT INTO long_tasks
         (title, description, origin, proposed_by, review_item_id, target_date, categories_json, apps_json, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'agent' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
    )
    .run(
      title,
      description,
      origin,
      proposedBy ?? null,
      reviewItemId ?? null,
      targetDate ?? null,
      categories.length === 0 ? null : JSON.stringify(categories),
      apps.length === 0 ? null : JSON.stringify(apps),
      origin,
    );
  const id = asInteger(inserted.lastInsertRowid);
  if (id === undefined) throw new DayflowError('Could not read the id of the new long task.', 'database_error');
  return requireTask(db, id, new Date(), true);
}

/**
 * Turn an accepted review-queue proposal into a long task.
 *
 * The task keeps the proposal's text and carries `origin: 'agent'`,
 * `proposed_by: 'agent'`, and the originating `review_item_id`, so the task can
 * always be traced back to the suggestion the user accepted.
 */
export function createTaskFromReviewItem(
  db: DatabaseSync,
  item: { id: number; title: string; body: string },
): LongTaskPayload {
  if (item === undefined || item === null) throw invalid('A review item is required to create a long task.');
  return createLongTask(db, {
    title: item.title,
    description: item.body,
    origin: 'agent',
    proposed_by: 'agent',
    review_item_id: item.id,
  });
}

/**
 * List long tasks, newest first.
 *
 * A task on a list carries its summary (`total_minutes`, `session_days`,
 * `last_session_day`, `stalled`) but not its individual sessions; fetch one
 * task with {@link getLongTask} when the day-by-day evidence is needed.
 */
export function listLongTasks(
  db: DatabaseSync,
  filter: { status?: LongTaskStatus; limit?: number } = {},
  now: Date = new Date(),
): LongTaskPayload[] {
  const options = filter ?? {};
  const status = options.status === undefined || options.status === null ? undefined : requireStatus(options.status);
  const limit = options.limit === undefined || options.limit === null ? DEFAULT_LIST_LIMIT : options.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw invalid(`Long task list limit must be an integer between 1 and ${String(MAX_LIST_LIMIT)}.`);
  }
  const rows = (
    status === undefined
      ? db.prepare('SELECT * FROM long_tasks ORDER BY id DESC LIMIT ?').all(limit)
      : db.prepare('SELECT * FROM long_tasks WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
  ) as TaskRow[];
  return rows.map((row) => taskPayload(db, row, now, false));
}

/** Read one long task with its sessions, failing as `not_found` when absent. */
export function getLongTask(db: DatabaseSync, id: number, now: Date = new Date()): LongTaskPayload {
  return requireTask(db, id, now, true);
}

/** Move a task to another status and stamp `updated_at`. */
export function updateLongTaskStatus(db: DatabaseSync, id: number, status: LongTaskStatus): LongTaskPayload {
  requireTaskRow(db, id);
  const next = requireStatus(status);
  db.prepare('UPDATE long_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next, id);
  return requireTask(db, id, new Date(), true);
}

/**
 * Attach one day of work to a task.
 *
 * Attaching the same `(task, day)` twice *replaces* that day's minutes, note,
 * and activity ids — it never adds a second row, so a retry or a re-analysis of
 * the same day cannot inflate progress.
 */
export function attachTaskSession(
  db: DatabaseSync,
  id: number,
  input: AttachSessionInput,
  now: Date = new Date(),
): LongTaskPayload {
  requireTaskRow(db, id);
  if (input === undefined || input === null) throw invalid('A task session is required.');
  const day = requireDayKey(input.day);
  if (typeof input.minutes !== 'number' || !Number.isSafeInteger(input.minutes) || input.minutes < 0) {
    throw invalid('Task session minutes must be a non-negative integer.');
  }
  const note = optionalString(input.note, 'session note');
  const activityIds = optionalActivityIds(input.activity_ids);
  const activityIdsJson = activityIds === undefined ? null : JSON.stringify(activityIds);
  const existing = db
    .prepare('SELECT id FROM long_task_sessions WHERE task_id = ? AND day = ? ORDER BY id DESC LIMIT 1')
    .get(id, day) as TaskRow | undefined;
  const existingId = asInteger(existing?.id);
  if (existingId === undefined) {
    db.prepare(
      'INSERT INTO long_task_sessions (task_id, day, activity_ids_json, minutes, note) VALUES (?, ?, ?, ?, ?)',
    ).run(id, day, activityIdsJson, input.minutes, note ?? null);
  } else {
    db.prepare('UPDATE long_task_sessions SET activity_ids_json = ?, minutes = ?, note = ? WHERE id = ?').run(
      activityIdsJson,
      input.minutes,
      note ?? null,
      existingId,
    );
    // A store written by an older bug may hold duplicate rows for one day; the
    // updated row is authoritative and the stale duplicates are dropped.
    db.prepare('DELETE FROM long_task_sessions WHERE task_id = ? AND day = ? AND id <> ?').run(id, day, existingId);
  }
  return requireTask(db, id, now, true);
}

/**
 * Remove one day from a task's progress.
 *
 * Detaching a day that was never attached is a no-op that still returns the
 * current state: the operation says "this day should not count", not "it must
 * have counted".
 */
export function detachTaskSession(db: DatabaseSync, id: number, day: string, now: Date = new Date()): LongTaskPayload {
  requireTaskRow(db, id);
  const dayKey = requireDayKey(day);
  db.prepare('DELETE FROM long_task_sessions WHERE task_id = ? AND day = ?').run(id, dayKey);
  return requireTask(db, id, now, true);
}

/** Match one task's signals against a day's activities. */
interface TaskSignals {
  readonly taskId: number;
  readonly title: string;
  readonly categories: readonly string[];
  readonly apps: readonly string[];
}

function signalsFor(row: TaskRow): TaskSignals | undefined {
  const taskId = asInteger(row.id);
  if (taskId === undefined) return undefined;
  const categories = parseStringArray(row.categories_json);
  const apps = parseStringArray(row.apps_json);
  if (categories.length === 0 && apps.length === 0) return undefined;
  return { taskId, title: asText(row.title) ?? '', categories, apps };
}

/**
 * Suggest which active long tasks a day's activities were probably working on.
 *
 * Matching is deliberately simple and explainable: a category the task claims
 * is worth {@link CATEGORY_SCORE} (+2), every app it claims is worth
 * {@link APP_SCORE} (+1), and every matching activity appears once in
 * `activity_ids`. The reasons are de-duplicated (`category:Development`,
 * `app:VS Code`), so the candidate says *why* it matched. Only active tasks
 * with at least one signal are considered, `minScore` (default 2) filters the
 * weak ones, and `limit` (default 5, at most 20) caps the answer.
 *
 * This function never writes: suggesting is a read, attaching is the user's
 * decision. The `day` argument is part of the call contract and identifies the
 * activities' day for the caller; scoring itself is content-based.
 */
export function suggestTaskMatches(
  db: DatabaseSync,
  day: string,
  activities: readonly { recordId: number; category: string; apps: readonly string[] }[],
  options: { limit?: number; minScore?: number } = {},
): TaskMatchCandidate[] {
  void day;
  const settings = options ?? {};
  const limit = settings.limit === undefined || settings.limit === null ? DEFAULT_MATCH_LIMIT : settings.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MATCH_LIMIT) {
    throw invalid(`Task match limit must be an integer between 1 and ${String(MAX_MATCH_LIMIT)}.`);
  }
  const minScore = settings.minScore === undefined || settings.minScore === null ? DEFAULT_MIN_SCORE : settings.minScore;
  if (typeof minScore !== 'number' || !Number.isFinite(minScore)) {
    throw invalid('Task match minScore must be a finite number.');
  }
  const rows = db
    .prepare("SELECT id, title, categories_json, apps_json FROM long_tasks WHERE status = 'active' ORDER BY id ASC")
    .all() as TaskRow[];
  const signals = rows.map((row) => signalsFor(row)).filter((entry): entry is TaskSignals => entry !== undefined);
  const activityList = Array.isArray(activities) ? activities : [];

  const candidates: TaskMatchCandidate[] = [];
  for (const task of signals) {
    let score = 0;
    const activityIds: number[] = [];
    const reasons: string[] = [];
    const seenReasons = new Set<string>();
    for (const activity of activityList) {
      if (activity === undefined || activity === null) continue;
      let matched = false;
      const category = typeof activity.category === 'string' ? activity.category : '';
      if (category !== '' && task.categories.includes(category)) {
        score += CATEGORY_SCORE;
        matched = true;
        const reason = `category:${category}`;
        if (!seenReasons.has(reason)) {
          seenReasons.add(reason);
          reasons.push(reason);
        }
      }
      const apps = Array.isArray(activity.apps) ? activity.apps : [];
      for (const app of apps) {
        if (typeof app !== 'string' || app === '' || !task.apps.includes(app)) continue;
        score += APP_SCORE;
        matched = true;
        const reason = `app:${app}`;
        if (!seenReasons.has(reason)) {
          seenReasons.add(reason);
          reasons.push(reason);
        }
      }
      if (!matched) continue;
      const recordId = asInteger(activity.recordId);
      if (recordId !== undefined && !activityIds.includes(recordId)) activityIds.push(recordId);
    }
    if (score <= 0 || score < minScore) continue;
    candidates.push({ task_id: task.taskId, title: task.title, score, activity_ids: activityIds, reasons });
  }
  candidates.sort((left, right) => right.score - left.score || left.task_id - right.task_id);
  return candidates.slice(0, limit);
}
