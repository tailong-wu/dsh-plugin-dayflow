/**
 * Typed reads over Dayflow's schema, plus the stable JSON payloads the tools
 * return.
 *
 * SQL semantics mirror the app: a day query selects cards *starting* inside the
 * 4 AM window, a range query selects cards *overlapping* it, both skip
 * soft-deleted rows, both order by `start_ts`.
 * @module dsh-plugin-dayflow/queries
 */

import type { DatabaseSync } from 'node:sqlite';

import type { SetupStatus } from './setup.js';

import type { DayWindow } from './day.js';
import { epochSeconds, formatIso, timeZoneName } from './day.js';
import { queryRows } from './db.js';
import { DayflowError } from './errors.js';
import type { SqlRow } from './db.js';

/** One timeline card, as the app stores it. */
export interface Activity {
  readonly recordId: number;
  readonly start: Date;
  readonly end: Date;
  readonly title: string;
  readonly summary: string;
  readonly detailedSummary: string;
  readonly category: string;
  readonly subcategory: string;
  readonly apps: readonly string[];
  readonly distractionCount: number;
}

/** A card in the model-facing JSON shape, mirroring Dayflow's own CLI. */
export interface ActivityPayload {
  record_id: number;
  start: string;
  end: string;
  duration_minutes: number;
  title: string;
  summary: string;
  category: string;
  subcategory?: string;
  apps?: string[];
  distraction_count?: number;
  detailed_summary?: string;
}

/** The `dayflow_timeline` payload: one day's cards. */
export interface TimelinePayload {
  date: string;
  time_zone: string;
  day_boundary_hour: number;
  cards: ActivityPayload[];
  detail_available: boolean;
  hint: string;
}

/** One category's share of a range. */
export interface CategoryTotal {
  name: string;
  minutes: number;
  share: number;
}

/** The `dayflow_breakdown` payload: totals per category over a range. */
export interface BreakdownPayload {
  range: { from: string; to: string };
  tracked_minutes: number;
  categories: CategoryTotal[];
  hint: string;
}

/** The `dayflow_weekly` payload: one week's rollup. */
export interface WeeklyPayload {
  week_start: string;
  week_end: string;
  tracked_minutes: number;
  focus_minutes: number;
  categories: CategoryTotal[];
}

/** The `dayflow_daily` payload: the standup document Dayflow generated. */
export interface DailyPayload {
  date: string;
  highlights: string[];
  tasks: string[];
  blockers: string;
}

/** The `dayflow_search` payload. */
export interface SearchPayload {
  query: string;
  matches: ActivityPayload[];
}

/** The `dayflow_status` payload. */
export interface StatusPayload {
  today: string;
  time_zone: string;
  day_boundary_hour: number;
  pending_batches: number;
  failed_batches: number;
  last_capture_at?: string;
  edits_enabled: boolean;
  /** Whether Dayflow's edit bridge is listening; writes need it. */
  edit_bridge_listening: boolean;
  database_path: string;
  /** Whether the database exists; when false the counters above are zeros. */
  database_present: boolean;
  /** Which backend supplied the data. */
  source?: 'dayflow' | 'owned';
  /** What still has to happen before the plugin can read a timeline. */
  setup?: SetupStatus;
}

/** The subset of `timeline_cards.metadata` these reads understand. */
interface CardMetadata {
  appSites?: { primary?: string | null; secondary?: string | null };
  distractions?: { title?: string | null }[];
}

const CARD_COLUMNS = 'id, start_ts, end_ts, title, summary, detailed_summary, category, subcategory, metadata';

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = queryRows(db, `PRAGMA table_info(${table})`);
  return rows.some((row) => asText(row.name) === column);
}

function deletedPredicate(db: DatabaseSync, table: string): string {
  return hasColumn(db, table, 'is_deleted') ? ' AND COALESCE(is_deleted, 0) = 0' : '';
}

function mapActivity(row: SqlRow): Activity | undefined {
  const recordId = asNumber(row.id);
  const start = asNumber(row.start_ts);
  const end = asNumber(row.end_ts);
  if (recordId === undefined || start === undefined || end === undefined) return undefined;

  const apps: string[] = [];
  let distractionCount = 0;
  const rawMetadata = asText(row.metadata);
  if (rawMetadata !== undefined && rawMetadata !== '') {
    try {
      const metadata = JSON.parse(rawMetadata) as CardMetadata;
      const primary = metadata.appSites?.primary;
      const secondary = metadata.appSites?.secondary;
      if (typeof primary === 'string' && primary !== '') apps.push(primary);
      if (typeof secondary === 'string' && secondary !== '' && secondary !== primary) apps.push(secondary);
      distractionCount = Array.isArray(metadata.distractions) ? metadata.distractions.length : 0;
    } catch {
      // Metadata is best-effort context; an unreadable blob must not fail the read.
    }
  }

  return {
    recordId,
    start: new Date(start * 1000),
    end: new Date(end * 1000),
    title: asText(row.title) ?? '',
    summary: asText(row.summary) ?? '',
    detailedSummary: asText(row.detailed_summary) ?? '',
    category: asText(row.category) ?? '',
    subcategory: asText(row.subcategory) ?? '',
    apps,
    distractionCount,
  };
}

/** Project one card into the stable JSON shape. */
export function activityPayload(activity: Activity, detailed: boolean): ActivityPayload {
  const payload: ActivityPayload = {
    record_id: activity.recordId,
    start: formatIso(activity.start),
    end: formatIso(activity.end),
    duration_minutes: durationMinutes(activity),
    title: activity.title,
    summary: activity.summary,
    category: activity.category,
  };
  if (activity.subcategory !== '') payload.subcategory = activity.subcategory;
  if (activity.apps.length > 0) payload.apps = [...activity.apps];
  if (activity.distractionCount > 0) payload.distraction_count = activity.distractionCount;
  if (detailed && activity.detailedSummary !== '') payload.detailed_summary = activity.detailedSummary;
  return payload;
}

/** Whole minutes between a card's start and end, never negative. */
export function durationMinutes(activity: Activity): number {
  return Math.max(0, Math.floor((activity.end.getTime() - activity.start.getTime()) / 60_000));
}

/**
 * Cards for one Dayflow day.
 * @param db - an open database.
 * @param window - the day to read.
 * @returns cards ordered by start time.
 */
export function activitiesForDay(db: DatabaseSync, window: DayWindow): Activity[] {
  const rows = queryRows(
    db,
    `SELECT ${CARD_COLUMNS} FROM timeline_cards
      WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0
      ORDER BY start_ts ASC`,
    [epochSeconds(window.start), epochSeconds(window.end)],
  );
  return rows.map(mapActivity).filter((activity): activity is Activity => activity !== undefined);
}

/**
 * Cards overlapping an arbitrary instant range.
 * @param db - an open database.
 * @param from - inclusive start.
 * @param to - exclusive end.
 * @returns cards ordered by start time.
 */
export function activitiesInRange(db: DatabaseSync, from: Date, to: Date): Activity[] {
  const rows = queryRows(
    db,
    `SELECT ${CARD_COLUMNS} FROM timeline_cards
      WHERE start_ts < ? AND end_ts > ? AND is_deleted = 0
      ORDER BY start_ts ASC`,
    [epochSeconds(to), epochSeconds(from)],
  );
  return rows.map(mapActivity).filter((activity): activity is Activity => activity !== undefined);
}

/**
 * One card by its record ID.
 * @param db - an open database.
 * @param recordId - the `timeline_cards.id` shown by `dayflow_timeline`.
 * @returns the card, or `undefined` when it is missing or deleted.
 */
export function activityById(db: DatabaseSync, recordId: number): Activity | undefined {
  const rows = queryRows(db, `SELECT ${CARD_COLUMNS} FROM timeline_cards WHERE id = ? AND is_deleted = 0`, [
    recordId,
  ]);
  return rows.map(mapActivity).find((activity): activity is Activity => activity !== undefined);
}

/** Escape SQL LIKE wildcards so a literal `%` or `_` stays literal. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Cards whose title or summary contains the text, newest first.
 * @param db - an open database.
 * @param text - literal text to look for.
 * @param limit - maximum matches to return.
 * @returns matching cards.
 */
export function searchActivities(db: DatabaseSync, text: string, limit: number): Activity[] {
  const pattern = likePattern(text);
  const rows = queryRows(
    db,
    `SELECT ${CARD_COLUMNS} FROM timeline_cards
      WHERE (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\') AND is_deleted = 0
      ORDER BY start_ts DESC
      LIMIT ?`,
    [pattern, pattern, limit],
  );
  return rows.map(mapActivity).filter((activity): activity is Activity => activity !== undefined);
}

/** The standup document Dayflow generated for one calendar day. */
export interface StandupDocument {
  readonly day: string;
  readonly highlightsTitle: string;
  readonly highlights: readonly string[];
  readonly tasksTitle: string;
  readonly tasks: readonly string[];
  readonly blockersTitle: string;
  readonly blockers: string;
}

interface StandupItem {
  text?: unknown;
}

interface StandupPayload {
  highlightsTitle?: unknown;
  highlights?: unknown;
  tasksTitle?: unknown;
  tasks?: unknown;
  blockersTitle?: unknown;
  blockersBody?: unknown;
}

function standupItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value as StandupItem[]) {
    const text = asText(entry?.text);
    if (text !== undefined && text !== '') items.push(text);
  }
  return items;
}

/**
 * The Daily standup Dayflow wrote for a calendar day.
 *
 * Standups are keyed by plain calendar date, not the 4 AM boundary, which
 * mirrors the app's `dailyStandupDayKey`.
 * @param db - an open database.
 * @param dayKey - `YYYY-MM-DD`.
 * @returns the document, or `undefined` when Dayflow has not written one.
 */
export function standupForDay(db: DatabaseSync, dayKey: string): StandupDocument | undefined {
  const rows = queryRows(
    db,
    `SELECT payload_json FROM daily_standup_entries WHERE standup_day = ?${deletedPredicate(db, 'daily_standup_entries')}`,
    [dayKey],
  );
  const raw = rows.length > 0 ? asText(rows[0]?.payload_json) : undefined;
  if (raw === undefined) return undefined;

  let payload: StandupPayload;
  try {
    payload = JSON.parse(raw) as StandupPayload;
  } catch (cause) {
    throw new DayflowError(`Dayflow's Daily for ${dayKey} is not readable JSON.`, 'database_error', { cause });
  }

  return {
    day: dayKey,
    highlightsTitle: asText(payload.highlightsTitle) ?? 'Highlights',
    highlights: standupItems(payload.highlights),
    tasksTitle: asText(payload.tasksTitle) ?? 'Tasks',
    tasks: standupItems(payload.tasks),
    blockersTitle: asText(payload.blockersTitle) ?? 'Blockers',
    blockers: asText(payload.blockersBody) ?? '',
  };
}

/**
 * Cards that *start* inside a range.
 *
 * Month views need each card assigned to exactly one day, so this groups by
 * start time rather than overlap; it matches the per-day query above.
 * @param db - an open database.
 * @param from - inclusive start.
 * @param to - exclusive end.
 * @returns cards ordered by start time.
 */
export function activitiesStartingBetween(db: DatabaseSync, from: Date, to: Date): Activity[] {
  const rows = queryRows(
    db,
    `SELECT ${CARD_COLUMNS} FROM timeline_cards
      WHERE start_ts >= ? AND start_ts < ? AND is_deleted = 0
      ORDER BY start_ts ASC`,
    [epochSeconds(from), epochSeconds(to)],
  );
  return rows.map(mapActivity).filter((activity): activity is Activity => activity !== undefined);
}

/** Capture presence for one Dayflow day. */
export interface DayCapture {
  /** Screenshots recorded inside the day. */
  readonly frames: number;
  /** The last capture inside the day. */
  readonly lastCaptureAt: Date;
}

/** SQL expression mapping a Unix timestamp to its Dayflow day (04:00 boundary). */
const DAY_KEY_SQL = `strftime('%Y-%m-%d', %COLUMN%, 'unixepoch', 'localtime', '-4 hours')`;

/**
 * Which days inside a range hold screen captures, and when each last captured.
 *
 * A day with no captures has no data at all; a day with captures but no
 * activities was simply quiet. The two must not read the same in the calendar.
 * @param db - an open database.
 * @param from - inclusive start.
 * @param to - exclusive end.
 * @returns captures keyed by `YYYY-MM-DD`.
 */
export function dayCaptures(db: DatabaseSync, from: Date, to: Date): Map<string, DayCapture> {
  const rows = queryRows(
    db,
    `SELECT ${DAY_KEY_SQL.replace('%COLUMN%', 'captured_at')} AS day,
            count(*) AS frames,
            max(captured_at) AS last_captured_at
       FROM screenshots
      WHERE COALESCE(is_deleted, 0) = 0 AND captured_at >= ? AND captured_at < ?
      GROUP BY day`,
    [epochSeconds(from), epochSeconds(to)],
  );
  const captures = new Map<string, DayCapture>();
  for (const row of rows) {
    const day = asText(row.day);
    const lastCaptureAt = asNumber(row.last_captured_at);
    if (day === undefined || lastCaptureAt === undefined) continue;
    captures.set(day, { frames: asNumber(row.frames) ?? 0, lastCaptureAt: new Date(lastCaptureAt * 1000) });
  }
  return captures;
}

/**
 * Pending analysis batches per Dayflow day inside a range.
 * @param db - an open database.
 * @param from - inclusive start.
 * @param to - exclusive end.
 * @returns pending counts keyed by `YYYY-MM-DD`.
 */
export function dayPendingBatches(db: DatabaseSync, from: Date, to: Date): Map<string, number> {
  const rows = queryRows(
    db,
    `SELECT ${DAY_KEY_SQL.replace('%COLUMN%', 'batch_start_ts')} AS day, count(*) AS pending
       FROM analysis_batches
      WHERE status IN ('pending', 'processing') AND batch_start_ts >= ? AND batch_start_ts < ?${deletedPredicate(db, 'analysis_batches')}
      GROUP BY day`,
    [epochSeconds(from), epochSeconds(to)],
  );
  const pending = new Map<string, number>();
  for (const row of rows) {
    const day = asText(row.day);
    const count = asNumber(row.pending);
    if (day !== undefined && count !== undefined) pending.set(day, count);
  }
  return pending;
}

/**
 * Pending analysis batches covering one day.
 * @param db - an open database.
 * @param window - the day.
 * @returns the count of batches still waiting.
 */
export function pendingBatchesInWindow(db: DatabaseSync, window: DayWindow): number {
  const rows = queryRows(
    db,
    `SELECT count(*) AS pending FROM analysis_batches
      WHERE status IN ('pending', 'processing') AND batch_start_ts >= ? AND batch_start_ts < ?${deletedPredicate(db, 'analysis_batches')}`,
    [epochSeconds(window.start), epochSeconds(window.end)],
  );
  return asNumber(rows[0]?.pending) ?? 0;
}

/**
 * The last capture inside one day.
 * @param db - an open database.
 * @param window - the day.
 * @returns the instant, or `undefined` when the day has no captures.
 */
export function lastCaptureInWindow(db: DatabaseSync, window: DayWindow): Date | undefined {
  const rows = queryRows(
    db,
    `SELECT max(captured_at) AS captured_at FROM screenshots
      WHERE COALESCE(is_deleted, 0) = 0 AND captured_at >= ? AND captured_at < ?`,
    [epochSeconds(window.start), epochSeconds(window.end)],
  );
  const seconds = asNumber(rows[0]?.captured_at);
  return seconds === undefined ? undefined : new Date(seconds * 1000);
}

/** Recording freshness and analysis backlog. */
export interface CaptureStatus {
  readonly lastCaptureAt: Date | undefined;
  readonly pendingBatches: number;
  readonly failedBatches: number;
}

/**
 * Capture freshness and analysis backlog.
 * @param db - an open database.
 * @returns the observed status.
 */
export function captureStatus(db: DatabaseSync): CaptureStatus {
  const captureRows = queryRows(
    db,
    'SELECT max(captured_at) AS captured_at FROM screenshots WHERE COALESCE(is_deleted, 0) = 0',
  );
  const lastCaptureSeconds = asNumber(captureRows[0]?.captured_at);
  const countRows = queryRows(
    db,
    `SELECT
       sum(CASE WHEN status IN ('pending', 'processing')${deletedPredicate(db, 'analysis_batches')} THEN 1 ELSE 0 END) AS pending,
       sum(CASE WHEN status LIKE 'failed%'${deletedPredicate(db, 'analysis_batches')} THEN 1 ELSE 0 END) AS failed
     FROM analysis_batches`,
  );
  return {
    lastCaptureAt: lastCaptureSeconds === undefined ? undefined : new Date(lastCaptureSeconds * 1000),
    pendingBatches: asNumber(countRows[0]?.pending) ?? 0,
    failedBatches: asNumber(countRows[0]?.failed) ?? 0,
  };
}

/**
 * Aggregate a card list into per-category totals, most time first.
 * @param activities - cards to total.
 * @returns totals and the tracked sum; `System` is excluded, as in the app.
 */
export function categoryTotals(activities: readonly Activity[]): { totals: CategoryTotal[]; tracked: number } {
  const minutesByCategory = new Map<string, number>();
  for (const activity of activities) {
    if (activity.category === 'System') continue;
    minutesByCategory.set(activity.category, (minutesByCategory.get(activity.category) ?? 0) + durationMinutes(activity));
  }
  const tracked = [...minutesByCategory.values()].reduce((sum, minutes) => sum + minutes, 0);
  const totals = [...minutesByCategory.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, minutes]) => ({
      name,
      minutes,
      share: tracked > 0 ? minutes / tracked : 0,
    }));
  return { totals, tracked };
}

/**
 * Build the `dayflow_timeline` payload for one day.
 * @param activities - the day's cards.
 * @param window - the day they came from.
 * @returns the stable payload.
 */
export function timelinePayload(activities: readonly Activity[], window: DayWindow): TimelinePayload {
  return {
    date: window.dayKey,
    time_zone: timeZoneName(),
    day_boundary_hour: 4,
    cards: activities.map((activity) => activityPayload(activity, false)),
    detail_available: true,
    hint: 'Summaries are abbreviated. Call dayflow_activity with a record_id for the full write-up.',
  };
}

/**
 * Build the `dayflow_breakdown` payload for a range.
 * @param activities - cards overlapping the range.
 * @param from - range start label.
 * @param to - range end label.
 * @returns the stable payload.
 */
export function breakdownPayload(activities: readonly Activity[], from: string, to: string): BreakdownPayload {
  const { totals, tracked } = categoryTotals(activities);
  return {
    range: { from, to },
    tracked_minutes: tracked,
    categories: totals,
    hint: 'For individual activities, call dayflow_timeline for one day.',
  };
}

/**
 * Build the `dayflow_weekly` payload.
 * @param activities - cards overlapping the week.
 * @param start - Monday 04:00.
 * @param end - the next Monday 04:00.
 * @returns the stable payload.
 */
export function weeklyPayload(activities: readonly Activity[], start: Date, end: Date): WeeklyPayload {
  const { totals, tracked } = categoryTotals(activities);
  const focusMinutes = totals
    .filter((total) => total.name !== 'Idle')
    .reduce((sum, total) => sum + total.minutes, 0);
  return {
    week_start: formatIso(start),
    week_end: formatIso(end),
    tracked_minutes: tracked,
    focus_minutes: focusMinutes,
    categories: totals,
  };
}

/** One category attached to a day's goal, with its Dayflow palette color. */
export interface GoalCategoryPayload {
  name: string;
  color_hex?: string;
}

/** The `dayflow_goals` payload: the targets the user set for one day. */
export interface DayGoalPayload {
  date: string;
  found: boolean;
  focus_minutes?: number;
  distraction_limit_minutes?: number;
  focus_categories: GoalCategoryPayload[];
  distraction_categories: GoalCategoryPayload[];
  is_skipped?: boolean;
  hint: string;
}

/** The `dayflow_journal` payload: the user's own entry for one day. */
export interface JournalEntryPayload {
  date: string;
  found: boolean;
  status?: string;
  intentions?: string;
  notes?: string;
  goals?: string;
  reflections?: string;
  summary?: string;
  hint: string;
}

/** One screen observation behind an activity, as Dayflow's model wrote it. */
export interface ObservationPayload {
  start: string;
  end: string;
  duration_minutes: number;
  text: string;
  model?: string;
}

/** One of the user's own focused/distracted marks over a time range. */
export interface ReviewRatingPayload {
  start: string;
  end: string;
  rating: string;
  record_id?: number;
  title?: string;
}

/** Text field names shared by Dayflow's and the owned store's journal entries. */
const JOURNAL_TEXT_FIELDS = ['intentions', 'notes', 'goals', 'reflections', 'summary'] as const;

// Goals and journal entries are the user's own records, not screen activity, and
// both backends must read the same. The hints are therefore backend-independent.
const GOAL_FOUND_HINT = 'Goals are the targets the user set for this day, not measured screen time.';
const GOAL_MISSING_HINT = 'No goal is set for this day; goals are optional, so the user may not have set one.';
const JOURNAL_FOUND_HINT = "A journal entry is the user's own writing about the day, not screen activity.";
const JOURNAL_MISSING_HINT =
  'No journal entry exists for this day; journal entries are optional, so the user may not have written one.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decode one stored JSON object, treating an unreadable blob as empty. */
function storedObject(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const number = asNumber(value);
  return number === undefined ? undefined : number !== 0;
}

interface OverlapCandidate {
  readonly id: number;
  readonly title: string;
  readonly start: number;
  readonly end: number;
}

function overlapCandidates(rows: readonly SqlRow[]): OverlapCandidate[] {
  const candidates: OverlapCandidate[] = [];
  for (const row of rows) {
    const id = asNumber(row.id);
    const start = asNumber(row.start_ts);
    const end = asNumber(row.end_ts);
    if (id === undefined || start === undefined || end === undefined) continue;
    candidates.push({ id, title: asText(row.title) ?? '', start, end });
  }
  return candidates;
}

/** The candidate whose range overlaps the target the longest, earliest on a tie. */
function bestOverlap(
  candidates: readonly OverlapCandidate[],
  start: number,
  end: number,
): OverlapCandidate | undefined {
  let best: OverlapCandidate | undefined;
  let bestOverlap = 0;
  for (const candidate of candidates) {
    const overlap = Math.min(candidate.end, end) - Math.max(candidate.start, start);
    if (overlap <= 0) continue;
    const earlier = best !== undefined && (candidate.start < best.start || (candidate.start === best.start && candidate.id < best.id));
    if (best === undefined || overlap > bestOverlap || (overlap === bestOverlap && earlier)) {
      best = candidate;
      bestOverlap = overlap;
    }
  }
  return best;
}

/**
 * The goal the user set for one Dayflow day.
 * @param db - an open Dayflow database, or the owned journal when `owned`.
 * @param dayKey - `YYYY-MM-DD`.
 * @param owned - read the plugin's journal instead of Dayflow.
 * @returns the goal payload; `found: false` when no goal is stored.
 */
export function dayGoalPayload(db: DatabaseSync, dayKey: string, owned: boolean): DayGoalPayload {
  return owned ? ownedDayGoalPayload(db, dayKey) : dayflowDayGoalPayload(db, dayKey);
}

function dayflowDayGoalPayload(db: DatabaseSync, dayKey: string): DayGoalPayload {
  const goalRows = queryRows(
    db,
    'SELECT focus_target_minutes, distraction_limit_minutes, is_skipped FROM day_goals WHERE day = ?',
    [dayKey],
  );
  const goalRow = goalRows[0];
  if (goalRow === undefined) {
    return { date: dayKey, found: false, focus_categories: [], distraction_categories: [], hint: GOAL_MISSING_HINT };
  }

  const categoryRows = queryRows(
    db,
    `SELECT kind, category_name, category_color_hex FROM day_goal_categories
      WHERE day = ?
      ORDER BY sort_order ASC, category_name ASC`,
    [dayKey],
  );
  const focusCategories: GoalCategoryPayload[] = [];
  const distractionCategories: GoalCategoryPayload[] = [];
  for (const row of categoryRows) {
    const kind = asText(row.kind);
    const name = asText(row.category_name);
    if (name === undefined || name === '') continue;
    const category: GoalCategoryPayload = { name };
    const color = asText(row.category_color_hex);
    if (color !== undefined && color !== '') category.color_hex = color;
    if (kind === 'focus') focusCategories.push(category);
    else if (kind === 'distraction') distractionCategories.push(category);
  }

  const payload: DayGoalPayload = {
    date: dayKey,
    found: true,
    focus_categories: focusCategories,
    distraction_categories: distractionCategories,
    hint: GOAL_FOUND_HINT,
  };
  const focusMinutes = asNumber(goalRow.focus_target_minutes);
  if (focusMinutes !== undefined) payload.focus_minutes = focusMinutes;
  const distractionLimit = asNumber(goalRow.distraction_limit_minutes);
  if (distractionLimit !== undefined) payload.distraction_limit_minutes = distractionLimit;
  const skipped = asBoolean(goalRow.is_skipped);
  if (skipped !== undefined) payload.is_skipped = skipped;
  return payload;
}

function ownedDayGoalPayload(db: DatabaseSync, dayKey: string): DayGoalPayload {
  const goalRows = queryRows(
    db,
    `SELECT id, focus_minutes, distraction_limit_minutes, payload_json FROM goals
      WHERE day = ? AND COALESCE(is_deleted, 0) = 0
      ORDER BY id DESC
      LIMIT 1`,
    [dayKey],
  );
  const goalRow = goalRows[0];
  if (goalRow === undefined) {
    return { date: dayKey, found: false, focus_categories: [], distraction_categories: [], hint: GOAL_MISSING_HINT };
  }

  const goalJson = storedObject(asText(goalRow.payload_json));
  const payload: DayGoalPayload = {
    date: dayKey,
    found: true,
    focus_categories: [],
    distraction_categories: [],
    hint: GOAL_FOUND_HINT,
  };
  const focusMinutes = asNumber(goalRow.focus_minutes);
  if (focusMinutes !== undefined) payload.focus_minutes = focusMinutes;
  const distractionLimit = asNumber(goalRow.distraction_limit_minutes);
  if (distractionLimit !== undefined) payload.distraction_limit_minutes = distractionLimit;
  const skipped = asBoolean(goalJson.is_skipped);
  if (skipped !== undefined) payload.is_skipped = skipped;

  const goalId = asNumber(goalRow.id);
  if (goalId === undefined) return payload;
  const categoryRows = queryRows(
    db,
    'SELECT category_name, role, payload_json FROM goal_categories WHERE goal_id = ? ORDER BY id ASC',
    [goalId],
  );
  for (const row of categoryRows) {
    const categoryJson = storedObject(asText(row.payload_json));
    const name = asText(row.category_name) ?? asText(categoryJson.category_name);
    if (name === undefined || name === '') continue;
    const category: GoalCategoryPayload = { name };
    const color = asText(categoryJson.category_color_hex);
    if (color !== undefined && color !== '') category.color_hex = color;
    const role = asText(row.role) ?? asText(categoryJson.role) ?? asText(categoryJson.kind);
    if (role === 'focus') payload.focus_categories.push(category);
    else if (role === 'distraction') payload.distraction_categories.push(category);
  }
  return payload;
}

/**
 * The journal entry the user wrote for one Dayflow day.
 * @param db - an open Dayflow database, or the owned journal when `owned`.
 * @param dayKey - `YYYY-MM-DD`.
 * @param owned - read the plugin's journal instead of Dayflow.
 * @returns the entry payload; `found: false` when the user wrote none.
 */
export function journalEntryPayload(db: DatabaseSync, dayKey: string, owned: boolean): JournalEntryPayload {
  const row = owned ? ownedJournalRow(db, dayKey) : dayflowJournalRow(db, dayKey);
  if (row === undefined) return { date: dayKey, found: false, hint: JOURNAL_MISSING_HINT };

  const stored = owned ? storedObject(asText(row.payload_json)) : {};
  const payload: JournalEntryPayload = { date: dayKey, found: true, hint: JOURNAL_FOUND_HINT };
  for (const field of JOURNAL_TEXT_FIELDS) {
    const value = journalTextField(stored, row, field);
    if (value !== undefined) payload[field] = value;
  }
  const status = asText(row.status) ?? asText(stored.status);
  if (status !== undefined && status !== '') payload.status = status;
  return payload;
}

function dayflowJournalRow(db: DatabaseSync, dayKey: string): SqlRow | undefined {
  return queryRows(
    db,
    `SELECT intentions, notes, goals, reflections, summary, status FROM journal_entries
      WHERE day = ?
      LIMIT 1`,
    [dayKey],
  )[0];
}

function ownedJournalRow(db: DatabaseSync, dayKey: string): SqlRow | undefined {
  return queryRows(
    db,
    `SELECT * FROM journal_entries
      WHERE day = ? AND COALESCE(is_deleted, 0) = 0
      ORDER BY id DESC
      LIMIT 1`,
    [dayKey],
  )[0];
}

/** Payload JSON wins over a column of the same name, per the owned journal contract. */
function journalTextField(stored: Record<string, unknown>, row: SqlRow, field: string): string | undefined {
  const fromPayload = asText(stored[field]);
  if (fromPayload !== undefined && fromPayload !== '') return fromPayload;
  const fromColumn = asText(row[field]);
  if (fromColumn !== undefined && fromColumn !== '') return fromColumn;
  return undefined;
}

/**
 * The observations Dayflow recorded behind one activity.
 * @param db - an open Dayflow database, or the owned journal when `owned`.
 * @param activity - the card to read evidence for.
 * @param owned - read the plugin's journal instead of Dayflow.
 * @returns observations overlapping the card, in start order.
 */
export function activityObservations(db: DatabaseSync, activity: Activity, owned: boolean): ObservationPayload[] {
  const from = epochSeconds(activity.start);
  const to = epochSeconds(activity.end);
  const rows = owned
    ? queryRows(
        db,
        `SELECT start_ts, end_ts, payload_json FROM observations
          WHERE start_ts < ? AND end_ts > ? AND COALESCE(is_deleted, 0) = 0
          ORDER BY start_ts ASC, id ASC`,
        [to, from],
      )
    : queryRows(
        db,
        `SELECT start_ts, end_ts, observation, llm_model FROM observations
          WHERE start_ts < ? AND end_ts > ?
          ORDER BY start_ts ASC, id ASC`,
        [to, from],
      );

  const observations: ObservationPayload[] = [];
  for (const row of rows) {
    const stored = owned ? storedObject(asText(row.payload_json)) : undefined;
    const text = owned ? asText(stored?.observation) : asText(row.observation);
    const model = owned ? asText(stored?.llm_model) : asText(row.llm_model);
    const start = asNumber(row.start_ts);
    const end = asNumber(row.end_ts);
    if (start === undefined || end === undefined) continue;
    const payload: ObservationPayload = {
      start: formatIso(new Date(start * 1000)),
      end: formatIso(new Date(end * 1000)),
      duration_minutes: Math.max(0, Math.floor((end - start) / 60)),
      text: text ?? '',
    };
    if (model !== undefined && model !== '') payload.model = model;
    observations.push(payload);
  }
  return observations;
}

/**
 * The user's own review ratings overlapping one Dayflow day.
 * @param db - an open Dayflow database, or the owned journal when `owned`.
 * @param window - the day to read.
 * @param owned - read the plugin's journal instead of Dayflow.
 * @returns ratings in start order, each resolved to the card it covers.
 */
export function reviewRatingsForDay(db: DatabaseSync, window: DayWindow, owned: boolean): ReviewRatingPayload[] {
  const from = epochSeconds(window.start);
  const to = epochSeconds(window.end);
  const rows = owned
    ? queryRows(
        db,
        `SELECT id, start_ts, end_ts, rating, activity_id FROM reviews
          WHERE start_ts < ? AND end_ts > ? AND COALESCE(is_deleted, 0) = 0
          ORDER BY start_ts ASC, id ASC`,
        [to, from],
      )
    : queryRows(
        db,
        `SELECT id, start_ts, end_ts, rating FROM timeline_review_ratings
          WHERE start_ts < ? AND end_ts > ?
          ORDER BY start_ts ASC, id ASC`,
        [to, from],
      );

  const ratings: ReviewRatingPayload[] = [];
  for (const row of rows) {
    const start = asNumber(row.start_ts);
    const end = asNumber(row.end_ts);
    const rating = asText(row.rating);
    if (start === undefined || end === undefined || rating === undefined || rating === '') continue;
    const payload: ReviewRatingPayload = {
      start: formatIso(new Date(start * 1000)),
      end: formatIso(new Date(end * 1000)),
      rating,
    };
    const record = owned ? ownedRecordForRating(db, row, start, end) : dayflowRecordForRating(db, start, end);
    if (record !== undefined) {
      payload.record_id = record.id;
      payload.title = record.title;
    }
    ratings.push(payload);
  }
  return ratings;
}

/** Prefer the explicitly linked activity, then the activity the range covers most. */
function ownedRecordForRating(
  db: DatabaseSync,
  row: SqlRow,
  start: number,
  end: number,
): OverlapCandidate | undefined {
  const activityId = asNumber(row.activity_id);
  if (activityId !== undefined) {
    const linked = queryRows(
      db,
      `SELECT id, title, start_ts, end_ts FROM activities
        WHERE id = ? AND COALESCE(is_deleted, 0) = 0
        LIMIT 1`,
      [activityId],
    );
    const direct = overlapCandidates(linked)[0];
    if (direct !== undefined) return direct;
  }
  const overlapping = queryRows(
    db,
    `SELECT id, title, start_ts, end_ts FROM activities
      WHERE start_ts < ? AND end_ts > ? AND COALESCE(is_deleted, 0) = 0
      ORDER BY start_ts ASC`,
    [end, start],
  );
  return bestOverlap(overlapCandidates(overlapping), start, end);
}

/** Dayflow's ratings carry no card reference, so resolve the overlapping card. */
function dayflowRecordForRating(db: DatabaseSync, start: number, end: number): OverlapCandidate | undefined {
  const overlapping = queryRows(
    db,
    `SELECT id, title, start_ts, end_ts FROM timeline_cards
      WHERE start_ts < ? AND end_ts > ? AND is_deleted = 0
      ORDER BY start_ts ASC`,
    [end, start],
  );
  return bestOverlap(overlapCandidates(overlapping), start, end);
}
