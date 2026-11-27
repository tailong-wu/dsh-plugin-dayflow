/**
 * Host half of the optional Dayflow panel: exact Fetch routes under
 * `/api/dayflow`, served through the connection service so they inherit the
 * browser-trust fence and the session cookie.
 *
 * The routes are registered through a dynamic `connection` injection rather
 * than the plugin's static `inject` list, because a headless composition has no
 * web surface and must still get the tools.
 * @module dsh-plugin-dayflow/panel
 */

import { existsSync } from 'node:fs';

import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';

import { readDatabase } from './tools/shared.js';
import { buildAnalysisStatus } from './analyse/status.js';
import type { AnalysisStatusPayload } from './analyse/status.js';
import { countScreenshotsForDay, readCaptureState, writeCaptureState } from './capture/state.js';
import { readPanelBriefs } from './briefs/read.js';
import { journalCategories, withJournal, withJournalWrite } from './journal.js';
import { IconStore } from './icons.js';
import { addMemoryClaim, listMemoryClaims } from './memory.js';
import type { MemoryClaimPayload } from './memory.js';
import { getReflection, listReflections, saveReflection } from './reflections.js';
import type { ReflectionPayload } from './reflections.js';
import { applyReviewDecision } from './review-actions.js';
import type { ReviewDecision } from './review-actions.js';
import { listReviewItems } from './review.js';
import {
  attachTaskSession,
  createLongTask,
  detachTaskSession,
  getLongTask,
  listLongTasks,
  scanTaskHistory,
} from './tasks.js';
import type { LongTaskPayload, TaskHistoryDayInput } from './tasks.js';
import { dayWindowContaining, dayWindowForKey, formatDayKey, timeZoneName, weekWindowContaining } from './day.js';
import { DayflowError, isDayflowError } from './errors.js';
import {
  PANEL_ANALYSIS_STATUS_PATH,
  PANEL_AUTOMATION_STATUS_PATH,
  PANEL_CAPTURE_PAUSE_PATH,
  PANEL_CAPTURE_STATUS_PATH,
  PANEL_CONFIG_PATH,
  PANEL_DAY_PATH,
  PANEL_ICON_PATH,
  PANEL_INSIGHTS_PATH,
  PANEL_MEMORY_ADD_PATH,
  PANEL_MONTH_PATH,
  PANEL_REFLECTION_ADD_PATH,
  PANEL_REVIEW_DECIDE_PATH,
  PANEL_TASK_ADD_PATH,
  PANEL_TASK_ATTACH_PATH,
  PANEL_TASK_DETACH_PATH,
  PANEL_TASK_LINK_PATH,
  PANEL_TASK_SCAN_PATH,
  PANEL_WEEK_PATH,
  isMonthKey,
  monthDayKeys,
  shiftDayKey,
} from './panel-contract.js';
import type {
  PanelAnalysisStatus,
  PanelAutomationStatus,
  PanelAutomationStatusResponse,
  PanelCapturePermission,
  PanelCaptureStatus,
  PanelCaptureStatusResponse,
  PanelCard,
  PanelCategory,
  PanelClaimSummary,
  PanelConfig,
  PanelDay,
  PanelError,
  PanelGoal,
  PanelInsights,
  PanelMemoryAddRequest,
  PanelMemoryAddResponse,
  PanelMonth,
  PanelReflectionAddRequest,
  PanelReflectionAddResponse,
  PanelReflectionSummary,
  PanelReviewDecisionRequest,
  PanelReviewDecisionResponse,
  PanelReviewItem,
  PanelTaskAddRequest,
  PanelTaskAddResponse,
  PanelTaskAttachRequest,
  PanelTaskAttachResponse,
  PanelTaskDetachRequest,
  PanelTaskDetachResponse,
  PanelTaskLinkRequest,
  PanelTaskLinkResponse,
  PanelTaskScanRequest,
  PanelTaskScanResponse,
  PanelTaskSummary,
  PanelWeek,
} from './panel-contract.js';
import {
  activitiesForDay,
  activitiesStartingBetween,
  activityPayload,
  categoryTotals,
  dayCaptures,
  dayGoalPayload,
  dayPendingBatches,
  durationMinutes,
  lastCaptureInWindow,
  pendingBatchesInWindow,
  reviewRatingsForDay,
} from './queries.js';
import type { DayGoalPayload } from './queries.js';
import type { ToolRuntime } from './tools/shared.js';
import { dayArgument } from './tools/shared.js';

/** Connection members this module uses; typed narrowly so the host stays testable. */
export interface FetchRouteRegistry {
  register(route: {
    path: string;
    methods: readonly string[];
    requestBody: 'buffered' | 'streaming';
    fetch: (request: Request) => Promise<Response>;
  }): () => Promise<void>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** Map a Dayflow failure onto a status the panel can explain. */
function failureResponse(error: unknown): Response {
  if (isDayflowError(error)) {
    const status =
      error.code === 'invalid_input'
        ? 400
        : error.code === 'not_found'
          ? 404
          : error.code === 'no_data' || error.code === 'database_error'
            ? 503
            : 500;
    return jsonResponse({ error: error.message } satisfies PanelError, status);
  }
  return jsonResponse(
    { error: error instanceof Error ? error.message : String(error) } satisfies PanelError,
    500,
  );
}

/** The longest task title the panel's add route accepts, in characters. */
const PANEL_TASK_TITLE_MAX_CHARS = 200;
/** The longest free text the memory and reflection add routes accept. */
const PANEL_ADD_TEXT_MAX_CHARS = 4000;
/** The longest memory subject the panel derives from free text, in characters. */
const PANEL_MEMORY_SUBJECT_MAX_CHARS = 60;
/** How many recent days a history scan covers when the caller states none. */
const PANEL_TASK_SCAN_DEFAULT_DAYS = 14;
/** The most history days one scan may cover. */
const PANEL_TASK_SCAN_MAX_DAYS = 90;
/** The most days one link request may attach. */
const PANEL_TASK_LINK_MAX_DAYS = 90;

/**
 * Read one JSON object request body.
 *
 * A malformed body is the caller's mistake, not a server failure, so it maps
 * onto the same `invalid_input` code the rest of the validation uses (a 400).
 * @param request - the incoming POST request.
 * @returns the parsed object.
 */
async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new DayflowError('Invalid JSON body.', 'invalid_input');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DayflowError('The request body must be a JSON object.', 'invalid_input');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Validate one add route's free text.
 * @param value - the untrusted field of the JSON body.
 * @param required - the message for a missing or blank value.
 * @param limit - the message for a value over the route's bound.
 * @param maxChars - the route's bound, in characters after trimming.
 * @returns the trimmed text.
 */
function panelAddText(value: unknown, required: string, limit: string, maxChars: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new DayflowError(required, 'invalid_input');
  const text = value.trim();
  if (text.length > maxChars) throw new DayflowError(limit, 'invalid_input');
  return text;
}

/**
 * Derive a claim's grouping subject from its free text.
 * @param text - the claim body, already validated.
 * @returns the text itself, or a shortened form ending in an ellipsis.
 */
function memorySubject(text: string): string {
  if (text.length <= PANEL_MEMORY_SUBJECT_MAX_CHARS) return text;
  return `${text.slice(0, PANEL_MEMORY_SUBJECT_MAX_CHARS).trimEnd()}…`;
}

/** Project one long task into the list summary the insights view reads. */
function taskSummary(task: LongTaskPayload): PanelTaskSummary {
  const summary: PanelTaskSummary = {
    id: task.id,
    title: task.title,
    status: task.status,
    origin: task.origin,
    total_minutes: task.total_minutes,
    session_days: task.session_days,
    stalled: task.stalled,
  };
  if (task.last_session_day !== undefined) summary.last_session_day = task.last_session_day;
  if (task.target_date !== undefined) summary.target_date = task.target_date;
  // The panel draws one Unlink action per already-attached day, so the summary
  // carries the day-by-day sessions. A task with no session keeps the field off
  // the wire, exactly like its other absent optional fields.
  if (task.sessions !== undefined && task.sessions.length > 0) {
    summary.sessions = task.sessions.map((session) => ({ day: session.day, minutes: session.minutes }));
  }
  return summary;
}

/** Project one memory claim into the summary the insights view reads. */
function claimSummary(claim: MemoryClaimPayload): PanelClaimSummary {
  return {
    id: claim.id,
    kind: claim.kind,
    subject: claim.subject,
    observed_on: claim.observed_on,
    confidence: claim.confidence,
  };
}

/** Project one reflection into the summary the insights view reads. */
function reflectionSummary(reflection: ReflectionPayload): PanelReflectionSummary {
  return {
    id: reflection.id,
    kind: reflection.kind,
    period_key: reflection.period_key,
    body: reflection.body,
    updated_at: reflection.updated_at,
  };
}

/** Select categories and edit capability from the active backend. */
function panelPreferences(runtime: ToolRuntime): { categories: readonly { name: string; colorHex: string }[]; editsEnabled: boolean } {
  const preferences = runtime.preferences();
  if (runtime.config.dayflow) return preferences;
  const categories = journalCategories(runtime.config.journalPath, runtime.config.databasePath);
  return {
    categories: categories.length > 0 ? categories : preferences.categories,
    editsEnabled: false,
  };
}

/**
 * Project one day's cards, backlog, and capture freshness into a payload.
 * @param dayKey - the Dayflow day.
 * @param activities - that day's cards, already ordered.
 * @param pendingBatches - batches inside the day still being analyzed.
 * @param lastCaptureAt - the day's last screen capture, when it has one.
 * @param colors - category name to the user's color.
 * @param editsEnabled - the app's edit switch.
 * @param today - the Dayflow day containing now.
 * @returns the stable day payload.
 */
function dayPayload(
  dayKey: string,
  activities: ReturnType<typeof activitiesForDay>,
  pendingBatches: number,
  lastCaptureAt: Date | undefined,
  colors: ReadonlyMap<string, string>,
  editsEnabled: boolean,
  today: string,
): PanelDay {
  const { totals, tracked } = categoryTotals(activities);
  const categories: PanelCategory[] = totals.map((total) => ({
    name: total.name,
    minutes: total.minutes,
    share: total.share,
    color_hex: colors.get(total.name) ?? '#A0AEC0',
  }));

  const payload: PanelDay = {
    date: dayKey,
    today,
    time_zone: timeZoneName(),
    day_boundary_hour: 4,
    cards: activities.map((activity) => activityPayload(activity, false) as PanelCard),
    tracked_minutes: tracked,
    categories,
    pending_batches: pendingBatches,
    edits_enabled: editsEnabled,
  };
  if (lastCaptureAt !== undefined) payload.last_capture_at = lastCaptureAt.toISOString();
  return payload;
}

/**
 * Project a day's goal query result into the panel's shape.
 * @param goal - the goal payload read for the day.
 * @returns the goal, or null when the user set none for that day.
 */
function panelGoal(goal: DayGoalPayload): PanelGoal | null {
  if (!goal.found) return null;
  const payload: PanelGoal = {
    focus_categories: goal.focus_categories,
    distraction_categories: goal.distraction_categories,
  };
  if (goal.focus_minutes !== undefined) payload.focus_minutes = goal.focus_minutes;
  if (goal.distraction_limit_minutes !== undefined) payload.distraction_limit_minutes = goal.distraction_limit_minutes;
  if (goal.is_skipped !== undefined) payload.is_skipped = goal.is_skipped;
  return payload;
}

/**
 * Build one day's panel payload.
 * @param runtime - the plugin runtime.
 * @param date - an optional `YYYY-MM-DD`; omitted means the current Dayflow day.
 * @returns the payload the browser renders.
 */
export function buildPanelDay(runtime: ToolRuntime, date?: string): PanelDay {
  const window = dayArgument(date);
  const preferences = panelPreferences(runtime);
  const colors = new Map(preferences.categories.map((category) => [category.name, category.colorHex]));

  // The goal and the review marks are the user's own records, so they are read
  // on the same connection as the day's screen activity.
  const { activities, pending, lastCapture, goal, ratings } = readDatabase(runtime, (db) => ({
    activities: activitiesForDay(db, window),
    pending: pendingBatchesInWindow(db, window),
    lastCapture: lastCaptureInWindow(db, window),
    goal: dayGoalPayload(db, window.dayKey, !runtime.config.dayflow),
    ratings: reviewRatingsForDay(db, window, !runtime.config.dayflow),
  }));

  const payload = dayPayload(
    window.dayKey,
    activities,
    pending,
    lastCapture,
    colors,
    preferences.editsEnabled,
    formatDayKey(new Date()),
  );
  payload.goal = panelGoal(goal);
  payload.ratings = ratings;
  return payload;
}

/**
 * Build one month of panel payloads for the calendar.
 *
 * Every calendar day is present so the grid can tell a quiet, recorded day from
 * a day with no captures at all; each day reuses the single-day payload shape.
 * @param runtime - the plugin runtime.
 * @param month - an optional `YYYY-MM`; omitted means the current month.
 * @returns the month payload.
 */
export function buildPanelMonth(runtime: ToolRuntime, month?: string): PanelMonth {
  const target = month?.trim() === undefined || month?.trim() === '' ? formatDayKey(new Date()).slice(0, 7) : month.trim();
  if (!isMonthKey(target)) {
    throw new DayflowError(`"${target}" is not a month. Use YYYY-MM, for example 2026-03.`, 'invalid_input');
  }

  const dayKeys = monthDayKeys(target);
  const firstWindow = dayArgument(dayKeys[0]);
  const lastWindow = dayArgument(dayKeys[dayKeys.length - 1]);
  const preferences = panelPreferences(runtime);
  const colors = new Map(preferences.categories.map((category) => [category.name, category.colorHex]));

  const { activities, captures, pending } = readDatabase(runtime, (db) => ({
    activities: activitiesStartingBetween(db, firstWindow.start, lastWindow.end),
    captures: dayCaptures(db, firstWindow.start, lastWindow.end),
    pending: dayPendingBatches(db, firstWindow.start, lastWindow.end),
  }));

  const byDay = new Map<string, typeof activities>();
  for (const activity of activities) {
    const key = dayWindowContaining(activity.start).dayKey;
    const bucket = byDay.get(key);
    if (bucket === undefined) byDay.set(key, [activity]);
    else bucket.push(activity);
  }

  const today = formatDayKey(new Date());
  const days = dayKeys.map((key) =>
    dayPayload(
      key,
      byDay.get(key) ?? [],
      pending.get(key) ?? 0,
      captures.get(key)?.lastCaptureAt,
      colors,
      preferences.editsEnabled,
      today,
    ),
  );

  return {
    month: target,
    today,
    time_zone: timeZoneName(),
    day_boundary_hour: 4,
    days,
  };
}

/**
 * Build one Monday-anchored week of panel payloads for the swim-lane view.
 * @param runtime - the plugin runtime.
 * @param date - any day inside the wanted week; omitted means the current week.
 * @returns seven consecutive days, Monday first.
 */
export function buildPanelWeek(runtime: ToolRuntime, date?: string): PanelWeek {
  const anchor = date === undefined || date.trim() === '' ? new Date() : dayArgument(date).start;
  const week = weekWindowContaining(anchor);
  const preferences = panelPreferences(runtime);
  const colors = new Map(preferences.categories.map((category) => [category.name, category.colorHex]));

  const { activities, captures, pending } = readDatabase(runtime, (db) => ({
    activities: activitiesStartingBetween(db, week.start, week.end),
    captures: dayCaptures(db, week.start, week.end),
    pending: dayPendingBatches(db, week.start, week.end),
  }));

  const byDay = new Map<string, typeof activities>();
  for (const activity of activities) {
    const key = dayWindowContaining(activity.start).dayKey;
    const bucket = byDay.get(key);
    if (bucket === undefined) byDay.set(key, [activity]);
    else bucket.push(activity);
  }

  const today = formatDayKey(new Date());
  const mondayKey = formatDayKey(week.start);
  const days: PanelDay[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    // Step by calendar day, not by 86_400_000 ms: a daylight-saving boundary
    // would otherwise land the window on the wrong date (or the wrong 4 AM).
    const window = dayWindowForKey(shiftDayKey(mondayKey, offset));
    if (window === undefined) continue;
    days.push(
      dayPayload(
        window.dayKey,
        byDay.get(window.dayKey) ?? [],
        pending.get(window.dayKey) ?? 0,
        captures.get(window.dayKey)?.lastCaptureAt,
        colors,
        preferences.editsEnabled,
        today,
      ),
    );
  }

  return {
    week_start: days[0]?.date ?? '',
    week_end: days[6]?.date ?? '',
    today,
    time_zone: timeZoneName(),
    day_boundary_hour: 4,
    days,
  };
}

/**
 * Build the Insights payload from the owned journal.
 *
 * A missing journal is not an error: it is the shape of a fresh install, so the
 * answer is five empty lists and the file is never created by a read.
 * @param runtime - the plugin runtime.
 * @returns the journal's tasks, review queue, memory claims, reflections, and
 *   stored day/week briefs.
 */
export function buildPanelInsights(runtime: ToolRuntime): PanelInsights {
  const empty: PanelInsights = { tasks: [], review: [], memory: [], reflections: [], briefs: [] };
  if (!existsSync(runtime.config.journalPath)) return empty;
  return withJournal(runtime.config.journalPath, (db) => ({
    // The list carries the day-by-day sessions too, so the panel can offer one
    // Unlink per attached day; read each task back with its sessions.
    tasks: listLongTasks(db, { status: 'active', limit: 20 })
      .map((task) => getLongTask(db, task.id))
      .map(taskSummary),
    review: listReviewItems(db, { status: 'proposed', limit: 20 }).map((item) => {
      const summary: PanelReviewItem = {
        id: item.id,
        kind: item.kind,
        status: item.status,
        title: item.title,
        confidence: item.confidence,
      };
      if (item.source_day !== undefined) summary.source_day = item.source_day;
      return summary;
    }),
    memory: listMemoryClaims(db, { limit: 20 }).map(claimSummary),
    reflections: listReflections(db, { limit: 10 }).map(reflectionSummary),
    // Same connection as the rest of the payload: the briefs read is one more
    // query on the journal this call already opened, never a second open.
    briefs: readPanelBriefs(db),
  }));
}

/**
 * Read one positive row id from an untrusted JSON body.
 * @param value - the body's id field.
 * @param message - the invalid-input message for a missing or malformed id.
 * @returns the validated id.
 */
function panelPositiveId(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new DayflowError(message, 'invalid_input');
  }
  return value;
}

/**
 * Read one real `YYYY-MM-DD` day key from an untrusted JSON body.
 * @param value - the body's day field.
 * @param message - the invalid-input message for a missing or impossible day.
 * @returns the validated day key.
 */
function panelDayKey(value: unknown, message: string): string {
  const window = typeof value === 'string' ? dayWindowForKey(value) : undefined;
  if (window === undefined || window.dayKey !== value) {
    throw new DayflowError(message, 'invalid_input');
  }
  return window.dayKey;
}

/**
 * Require the user's explicit confirmation in a panel write body.
 *
 * The panel's writes record the user's own decisions and work log, so every
 * route demands `confirm: true`; a missing or false flag changes nothing.
 * @param body - the parsed request body.
 * @param action - what the route would have done, for the error text.
 */
function panelConfirm(body: { confirm?: unknown }, action: string): void {
  if (body.confirm !== true) {
    throw new DayflowError(
      `A ${action} belongs to the user: send confirm: true once they have agreed. Nothing was changed.`,
      'invalid_input',
    );
  }
}

/** The decisions the review route accepts; the store enforces kind compatibility. */
const PANEL_REVIEW_DECISIONS: ReadonlySet<string> = new Set<ReviewDecision>([
  'keep',
  'accept',
  'discard',
  'reject',
]);

/**
 * Read one review decision from an untrusted JSON body.
 * @param value - the body's decision field.
 * @returns the validated decision; kind compatibility is the store's rule.
 */
function panelReviewDecision(value: unknown): ReviewDecision {
  if (typeof value !== 'string' || !PANEL_REVIEW_DECISIONS.has(value)) {
    throw new DayflowError(
      "A review decision must be one of 'keep', 'accept', 'discard', or 'reject'.",
      'invalid_input',
    );
  }
  return value as ReviewDecision;
}

/**
 * Read one review decision's options, refusing a malformed note or forever flag.
 * @param body - the parsed request body.
 * @returns the options to pass to the shared decision composer.
 */
function panelReviewOptions(body: { note?: unknown; forever?: unknown }): { forever?: boolean; note?: string } {
  const note = body.note;
  if (note !== undefined && typeof note !== 'string') {
    throw new DayflowError('A review decision note must be a string.', 'invalid_input');
  }
  const forever = body.forever;
  if (forever !== undefined && typeof forever !== 'boolean') {
    throw new DayflowError('A review decision "forever" flag must be a boolean.', 'invalid_input');
  }
  return {
    ...(forever === undefined ? {} : { forever }),
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * Read a scan request's optional day count.
 * @param value - the untrusted `days` field.
 * @returns the day count, defaulting to the panel's two-week window.
 */
function panelScanDays(value: unknown): number {
  if (value === undefined) return PANEL_TASK_SCAN_DEFAULT_DAYS;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > PANEL_TASK_SCAN_MAX_DAYS
  ) {
    throw new DayflowError(
      `A history scan covers 1-${String(PANEL_TASK_SCAN_MAX_DAYS)} days.`,
      'invalid_input',
    );
  }
  return value;
}

/** One validated day of a link request. */
interface PanelTaskLinkDay {
  day: string;
  minutes: number;
  activity_ids: number[];
}

/**
 * Validate the link request's day list.
 *
 * The panel sends back the days of a scan preview the user confirmed, so this
 * accepts exactly that shape: a non-empty bounded list of real day keys, whole
 * non-negative minutes, and non-negative activity ids.
 * @param value - the untrusted `days` field.
 * @returns the validated days, in the request's order.
 */
function panelLinkDays(value: unknown): PanelTaskLinkDay[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DayflowError('A history link needs at least one day.', 'invalid_input');
  }
  if (value.length > PANEL_TASK_LINK_MAX_DAYS) {
    throw new DayflowError(
      `A history link attaches at most ${String(PANEL_TASK_LINK_MAX_DAYS)} days.`,
      'invalid_input',
    );
  }
  return value.map((entry: unknown, index: number) => {
    const position = String(index + 1);
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new DayflowError(`Day ${position} of the history link is not an object.`, 'invalid_input');
    }
    const record = entry as Record<string, unknown>;
    const window = typeof record.day === 'string' ? dayWindowForKey(record.day) : undefined;
    if (window === undefined || window.dayKey !== record.day) {
      throw new DayflowError(`Day ${position} of the history link needs a real YYYY-MM-DD day.`, 'invalid_input');
    }
    if (typeof record.minutes !== 'number' || !Number.isSafeInteger(record.minutes) || record.minutes < 0) {
      throw new DayflowError(`Day ${position} of the history link needs non-negative whole minutes.`, 'invalid_input');
    }
    const activityIds = record.activity_ids;
    if (
      !Array.isArray(activityIds) ||
      activityIds.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0)
    ) {
      throw new DayflowError(`Day ${position} of the history link needs non-negative activity ids.`, 'invalid_input');
    }
    return { day: window.dayKey, minutes: record.minutes, activity_ids: [...(activityIds as number[])] };
  });
}

/**
 * Collect the last `days` Dayflow days of activity as history-scanner input.
 *
 * The active backend supplies the days (Dayflow's app database, or the owned
 * journal), while the task itself always lives in the owned journal. Days with
 * no captured activity are left out instead of handed over empty.
 * @param runtime - the plugin runtime.
 * @param days - how many recent days to read, newest first.
 * @returns one input per day that has activity.
 */
function taskHistoryDays(runtime: ToolRuntime, days: number): TaskHistoryDayInput[] {
  const today = dayWindowContaining(new Date()).dayKey;
  const inputs: TaskHistoryDayInput[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    // Step by calendar day so a daylight-saving boundary keeps the 4 AM windows.
    const day = shiftDayKey(today, -offset);
    const window = dayWindowForKey(day);
    if (window === undefined) continue;
    const activities = runtime.config.dayflow
      ? readDatabase(runtime, (db) => activitiesForDay(db, window))
      : withJournal(runtime.config.journalPath, (db) => activitiesForDay(db, window));
    if (activities.length === 0) continue;
    inputs.push({
      day,
      activities: activities.map((activity) => ({
        recordId: activity.recordId,
        category: activity.category,
        apps: activity.apps,
        title: activity.title,
        summary: activity.summary,
        minutes: durationMinutes(activity),
      })),
    });
  }
  return inputs;
}

/**
 * Scan a task's recent history for matching activity.
 *
 * A read-only suggestion pass: the days come from the active backend, the
 * scoring reads the owned journal, and nothing is attached. The caller links a
 * preview only when the user confirms it.
 * @param runtime - the plugin runtime.
 * @param taskId - the task to scan for.
 * @param days - how many recent Dayflow days to cover.
 * @returns the scanner's answer in the panel's wire shape.
 */
function panelTaskScan(runtime: ToolRuntime, taskId: number, days: number): PanelTaskScanResponse['scan'] {
  if (!existsSync(runtime.config.journalPath)) {
    // Only a journal task can be scanned, so a missing journal means no task.
    // A read must not create the file just to say that.
    throw new DayflowError(`No long task with id ${String(taskId)}.`, 'not_found');
  }
  const inputs = taskHistoryDays(runtime, days);
  const result = withJournal(runtime.config.journalPath, (db) => scanTaskHistory(db, taskId, inputs));
  return {
    task_id: result.task_id,
    title: result.title,
    days: result.days.map((candidate) => ({
      day: candidate.day,
      minutes: candidate.minutes,
      activity_ids: [...candidate.activity_ids],
      score: candidate.score,
      reasons: [...candidate.reasons],
      titles: [...candidate.titles],
    })),
    total_minutes: result.total_minutes,
    total_days: result.total_days,
  };
}

/** Optional host probes the panel routes can use. */
export interface PanelRouteOptions {
  /**
   * Probes the macOS Screen Recording permission for the capture status line.
   * Only the composition knows whether a provider is mounted, so this stays
   * injected; without a probe the panel reports `unknown` instead of guessing.
   */
  capturePermission?: () => Promise<PanelCapturePermission>;
  /**
   * Builds the analysis status the status route answers with. The composition
   * injects this when it owns the worker; without it the route builds the
   * status from the journal and the configuration itself.
   */
  analysisStatus?: () => Promise<AnalysisStatusPayload> | AnalysisStatusPayload;
  /**
   * The worker's current state. Only read by the route's own status builder,
   * which uses it when no `analysisStatus` builder is injected.
   */
  analysisWorker?: () => { running: boolean };
  /**
   * Builds the automation status the status route answers with. The
   * composition injects this when it owns the scheduler; without it the route
   * builds the scheduled part from the profile's `automation` block and reports
   * an idle, never-run state.
   */
  automationStatus?: () => PanelAutomationStatus | Promise<PanelAutomationStatus>;
}

/** The permission the status line reports when no probe is injected. */
const UNPROBED_CAPTURE_PERMISSION: PanelCapturePermission = 'unknown';

/**
 * Run the injected permission probe, turning a probe failure into `unknown`.
 *
 * A missing or broken permission check is not a panel failure: the capture line
 * still has to render, so the route answers instead of returning a 500.
 * @param probe - the host's probe.
 * @returns the probe's answer, or `unknown` when it throws.
 */
async function probeCapturePermission(probe: () => Promise<PanelCapturePermission>): Promise<PanelCapturePermission> {
  try {
    return await probe();
  } catch {
    return UNPROBED_CAPTURE_PERMISSION;
  }
}

/**
 * Build the capture status the Insights view shows.
 *
 * A missing journal answers all zeros without creating the file: capture has
 * recorded nothing yet, and a status read must stay a read. An existing journal
 * contributes the persisted pause flag, the last frame time, and today's native
 * screenshot count. The switches themselves always come from the profile.
 * @param runtime - the plugin runtime.
 * @param probe - the host's permission probe.
 * @returns the status payload.
 */
async function buildCaptureStatus(
  runtime: ToolRuntime,
  probe: () => Promise<PanelCapturePermission>,
): Promise<PanelCaptureStatus> {
  const permission = await probeCapturePermission(probe);
  const status: PanelCaptureStatus = {
    enabled: runtime.config.capture.enabled,
    paused: false,
    permission,
    analysis_enabled: runtime.config.analysis.enabled,
    analysis_consent: runtime.config.analysis.consent,
    frames_today: 0,
  };
  if (!existsSync(runtime.config.journalPath)) return status;
  const today = dayWindowContaining(new Date()).dayKey;
  return withJournal(runtime.config.journalPath, (db) => {
    // Dayflow days run 04:00 to 04:00, so "today" is the day containing now.
    const state = readCaptureState(db);
    status.paused = state.paused;
    status.frames_today = countScreenshotsForDay(db, today);
    if (state.lastFrameAt !== undefined) status.last_frame_at = state.lastFrameAt;
    return status;
  });
}

/**
 * Read the persisted pause flag from the owned journal.
 *
 * The analysis status needs the same flag the capture line shows. A missing or
 * unreadable journal reads as not paused: a status read must not create the
 * file, and analysis is blocked by the switches and the consent gate anyway.
 * @param runtime - the plugin runtime.
 * @returns whether the user paused capture.
 */
function panelCapturePaused(runtime: ToolRuntime): boolean {
  if (!existsSync(runtime.config.journalPath)) return false;
  try {
    return withJournal(runtime.config.journalPath, (db) => readCaptureState(db).paused);
  } catch {
    return false;
  }
}

/**
 * Build the analysis status the Insights view shows.
 *
 * The composition may inject a ready-made builder because it is the only layer
 * that knows the worker's state; when it does not, the route builds the status
 * itself, so a panel registered without options still answers.
 * @param runtime - the plugin runtime.
 * @param options - the route options holding the injected builders.
 * @returns the status response body.
 */
async function buildPanelAnalysisStatus(
  runtime: ToolRuntime,
  options: PanelRouteOptions,
): Promise<PanelAnalysisStatus> {
  if (options.analysisStatus !== undefined) {
    return { analysis: await options.analysisStatus() };
  }
  const worker = options.analysisWorker?.();
  return {
    analysis: await buildAnalysisStatus({
      journalPath: runtime.config.journalPath,
      config: runtime.config,
      paused: panelCapturePaused(runtime),
      ...(worker === undefined ? {} : { worker }),
    }),
  };
}

/**
 * Build the automation status the Insights view shows when nothing is injected.
 *
 * The live state belongs to the scheduler, so this fallback reports only what
 * the profile itself says: the switches, the day/week time, and the catch-up
 * window. A run in progress and the last closes are left off because only the
 * scheduler knows them; the line still renders from this answer.
 * @param runtime - the plugin runtime.
 * @returns the scheduled status with no run history.
 */
function buildPanelAutomationStatus(runtime: ToolRuntime): PanelAutomationStatus {
  const automation = runtime.config.automation;
  return {
    enabled: automation.enabled,
    running: false,
    dailyAt: automation.dailyAt,
    weeklyOn: automation.weeklyOn,
    catchUpDays: automation.catchUpDays,
  };
}

/**
 * Build the automation status the Insights view shows.
 *
 * The composition may inject a ready-made builder because it is the only layer
 * that knows the scheduler's run state; when it does not, the route answers the
 * scheduled state from the profile. Either way this is a read: it never opens or
 * creates the journal.
 * @param runtime - the plugin runtime.
 * @param options - the route options holding the injected builder.
 * @returns the status response body.
 */
async function buildPanelAutomation(runtime: ToolRuntime, options: PanelRouteOptions): Promise<PanelAutomationStatusResponse> {
  const automation =
    options.automationStatus === undefined
      ? buildPanelAutomationStatus(runtime)
      : await options.automationStatus();
  return { automation };
}

/**
 * Register the panel's routes when a web connection exists.
 * @param ctx - the plugin context.
 * @param runtime - the plugin runtime.
 * @param options - optional host probes, such as the capture permission probe.
 */
export function registerPanelRoutes(ctx: Context, runtime: ToolRuntime, options: PanelRouteOptions = {}): void {
  const icons = new IconStore(runtime.config.iconDirectory, runtime.config.icons);
  const capturePermission =
    options.capturePermission ?? (async (): Promise<PanelCapturePermission> => UNPROBED_CAPTURE_PERMISSION);
  ctx.inject(['connection'], (connected) => {
    const connection = (connected as unknown as { connection: { fetch: FetchRouteRegistry } }).connection;
    connection.fetch.register({
      path: PANEL_ICON_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const domain = new URL(request.url).searchParams.get('domain') ?? '';
        const icon = await icons.get(domain);
        if (icon === undefined) return new Response('not found', { status: 404 });
        return new Response(new Blob([icon.bytes], { type: icon.mediaType }), {
          status: 200,
          headers: {
            'content-type': icon.mediaType,
            'content-length': String(icon.bytes.byteLength),
            // A favicon rarely changes; a week of caching keeps the panel quiet.
            'cache-control': 'public, max-age=604800, immutable',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        });
      },
    });
    connection.fetch.register({
      path: PANEL_DAY_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const date = new URL(request.url).searchParams.get('date') ?? undefined;
          return jsonResponse(buildPanelDay(runtime, date));
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    connection.fetch.register({
      path: PANEL_MONTH_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const month = new URL(request.url).searchParams.get('month') ?? undefined;
          return jsonResponse(buildPanelMonth(runtime, month));
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    connection.fetch.register({
      path: PANEL_WEEK_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const date = new URL(request.url).searchParams.get('date') ?? undefined;
          return jsonResponse(buildPanelWeek(runtime, date));
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    connection.fetch.register({
      path: PANEL_INSIGHTS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return jsonResponse(buildPanelInsights(runtime));
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    connection.fetch.register({
      path: PANEL_CONFIG_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => jsonResponse({ enabled: runtime.config.panel } satisfies PanelConfig),
    });
    // The native capture line: Phase 0 has no recorder yet, so the panel shows
    // the configured state, the system permission, and the persisted pause flag
    // without pretending to have captured anything. The pause write is the one
    // thing the user can change from the line; a later engine honours it.
    connection.fetch.register({
      path: PANEL_CAPTURE_STATUS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return jsonResponse({
            capture: await buildCaptureStatus(runtime, capturePermission),
          } satisfies PanelCaptureStatusResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    connection.fetch.register({
      path: PANEL_CAPTURE_PAUSE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await readJsonBody(request);
          const paused = body.paused;
          if (typeof paused !== 'boolean') {
            throw new DayflowError('A capture pause needs a boolean "paused" field.', 'invalid_input');
          }
          withJournalWrite(runtime.config.journalPath, (db) => writeCaptureState(db, { paused }));
          return jsonResponse({
            capture: await buildCaptureStatus(runtime, capturePermission),
          } satisfies PanelCaptureStatusResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    // The analysis status line: the switches, the consent gate's answer, the
    // worker's state, and today's job ledger. It is a read, so a missing
    // journal answers zeros instead of being created by the request.
    connection.fetch.register({
      path: PANEL_ANALYSIS_STATUS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return jsonResponse((await buildPanelAnalysisStatus(runtime, options)) satisfies PanelAnalysisStatus);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    // The automation status line: when the scheduled day and week close run, the
    // last stored close of each, and the catch-up window. The scheduler owns the
    // live state and injects its builder; the fallback reports the profile's
    // schedule only. It is a read, so a missing journal is never created.
    connection.fetch.register({
      path: PANEL_AUTOMATION_STATUS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return jsonResponse((await buildPanelAutomation(runtime, options)) satisfies PanelAutomationStatusResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    // The three write routes below are the panel's only way to grow the journal:
    // the Insights view stays one page of reads with a small ToDo-style add row
    // per section, and each add writes the owned journal directly.
    connection.fetch.register({
      path: PANEL_TASK_ADD_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await readJsonBody(request)) as Partial<PanelTaskAddRequest>;
          const title = panelAddText(
            body.title,
            'A task needs a non-empty title.',
            `A task title must be at most ${String(PANEL_TASK_TITLE_MAX_CHARS)} characters.`,
            PANEL_TASK_TITLE_MAX_CHARS,
          );
          const task = withJournalWrite(runtime.config.journalPath, (db) =>
            createLongTask(db, { title, origin: 'user' }),
          );
          return jsonResponse({ task: taskSummary(task) } satisfies PanelTaskAddResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    connection.fetch.register({
      path: PANEL_MEMORY_ADD_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await readJsonBody(request)) as Partial<PanelMemoryAddRequest>;
          const text = panelAddText(
            body.text,
            'A memory needs non-empty text.',
            `A memory must be at most ${String(PANEL_ADD_TEXT_MAX_CHARS)} characters.`,
            PANEL_ADD_TEXT_MAX_CHARS,
          );
          // The user's own words are dated today: the claim describes what they
          // just told the panel, which is the current Dayflow day (04:00 boundary).
          const today = dayWindowContaining(new Date()).dayKey;
          const claim = withJournalWrite(runtime.config.journalPath, (db) =>
            addMemoryClaim(db, {
              kind: 'preference',
              subject: memorySubject(text),
              body: text,
              observed_on: today,
              confidence: 0.7,
              source_days: [today],
            }),
          );
          return jsonResponse({ claim: claimSummary(claim) } satisfies PanelMemoryAddResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    connection.fetch.register({
      path: PANEL_REFLECTION_ADD_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await readJsonBody(request)) as Partial<PanelReflectionAddRequest>;
          const text = panelAddText(
            body.text,
            'A reflection needs non-empty text.',
            `A reflection must be at most ${String(PANEL_ADD_TEXT_MAX_CHARS)} characters.`,
            PANEL_ADD_TEXT_MAX_CHARS,
          );
          const today = dayWindowContaining(new Date()).dayKey;
          const reflection = withJournalWrite(runtime.config.journalPath, (db) => {
            // Adding a line appends to today's saved reflection instead of
            // replacing it, so repeated captures build one day summary.
            const existing = getReflection(db, 'day', today);
            const merged = existing !== undefined && existing.body.trim() !== '' ? `${existing.body}\n${text}` : text;
            return saveReflection(db, { kind: 'day', period: today, body: merged, source_days: [today] });
          });
          return jsonResponse({ reflection: reflectionSummary(reflection) } satisfies PanelReflectionAddResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    // A scan reads the active backend's activity and scores it against the task
    // in the owned journal; it writes nothing. Linking is the explicit second
    // step: the user confirms the preview, then each confirmed day becomes a
    // task session (attaching the same day again replaces it, never doubles it).
    connection.fetch.register({
      path: PANEL_TASK_SCAN_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await readJsonBody(request)) as Partial<PanelTaskScanRequest>;
          const taskId = panelPositiveId(body.task_id, 'A history scan needs a positive task id.');
          const days = panelScanDays(body.days);
          return jsonResponse({ scan: panelTaskScan(runtime, taskId, days) } satisfies PanelTaskScanResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    connection.fetch.register({
      path: PANEL_TASK_LINK_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await readJsonBody(request)) as Partial<PanelTaskLinkRequest>;
          const taskId = panelPositiveId(body.task_id, 'A history link needs a positive task id.');
          const days = panelLinkDays(body.days);
          const task = withJournalWrite(runtime.config.journalPath, (db) => {
            for (const item of days) {
              attachTaskSession(db, taskId, {
                day: item.day,
                minutes: item.minutes,
                activity_ids: item.activity_ids,
              });
            }
            return getLongTask(db, taskId);
          });
          return jsonResponse({
            task: taskSummary(task),
            linked_days: days.map((item) => item.day),
          } satisfies PanelTaskLinkResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    // The three routes below are the panel's interactive insights: the user may
    // decide a review item, and attach or detach one day of a long task, without
    // an agent turn. Each is a user-owned write, so each demands confirm: true;
    // the review decision reuses the same composer as the journal_review tool.
    connection.fetch.register({
      path: PANEL_REVIEW_DECIDE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await readJsonBody(request)) as Partial<PanelReviewDecisionRequest>;
          panelConfirm(body, 'review decision');
          const id = panelPositiveId(body.id, 'A review decision needs a positive review item id.');
          const decision = panelReviewDecision(body.decision);
          const review = withJournalWrite(runtime.config.journalPath, (db) =>
            applyReviewDecision(db, id, decision, panelReviewOptions(body)),
          );
          return jsonResponse({ review } satisfies PanelReviewDecisionResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    connection.fetch.register({
      path: PANEL_TASK_ATTACH_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await readJsonBody(request)) as Partial<PanelTaskAttachRequest>;
          panelConfirm(body, 'task session attach');
          const id = panelPositiveId(body.id, 'A task session attach needs a positive task id.');
          const day = panelDayKey(body.day, 'A task session attach needs a real YYYY-MM-DD day.');
          const minutes = body.minutes;
          if (typeof minutes !== 'number' || !Number.isSafeInteger(minutes) || minutes < 0) {
            throw new DayflowError('A task session attach needs non-negative whole minutes.', 'invalid_input');
          }
          const note = body.note;
          if (note !== undefined && typeof note !== 'string') {
            throw new DayflowError('A task session note must be a string.', 'invalid_input');
          }
          const activityIds = body.activity_ids;
          if (
            activityIds !== undefined &&
            (!Array.isArray(activityIds) ||
              activityIds.some((entry) => !Number.isSafeInteger(entry) || entry < 0))
          ) {
            throw new DayflowError(
              'A task session attach needs non-negative whole activity ids.',
              'invalid_input',
            );
          }
          const task = withJournalWrite(runtime.config.journalPath, (db) =>
            attachTaskSession(db, id, {
              day,
              minutes,
              ...(note === undefined ? {} : { note }),
              ...(activityIds === undefined ? {} : { activity_ids: activityIds }),
            }),
          );
          return jsonResponse({ task } satisfies PanelTaskAttachResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
    connection.fetch.register({
      path: PANEL_TASK_DETACH_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await readJsonBody(request)) as Partial<PanelTaskDetachRequest>;
          panelConfirm(body, 'task session detach');
          const id = panelPositiveId(body.id, 'A task session detach needs a positive task id.');
          const day = panelDayKey(body.day, 'A task session detach needs a real YYYY-MM-DD day.');
          const task = withJournalWrite(runtime.config.journalPath, (db) =>
            detachTaskSession(db, id, day),
          );
          return jsonResponse({ task } satisfies PanelTaskDetachResponse);
        } catch (error) {
          return failureResponse(error);
        }
      },
    });
  });
}
