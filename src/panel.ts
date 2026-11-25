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
import { journalCategories, withJournal, withJournalWrite } from './journal.js';
import { IconStore } from './icons.js';
import { addMemoryClaim, listMemoryClaims } from './memory.js';
import type { MemoryClaimPayload } from './memory.js';
import { getReflection, listReflections, saveReflection } from './reflections.js';
import type { ReflectionPayload } from './reflections.js';
import { listReviewItems } from './review.js';
import { createLongTask, listLongTasks } from './tasks.js';
import type { LongTaskPayload } from './tasks.js';
import { dayWindowContaining, dayWindowForKey, formatDayKey, timeZoneName, weekWindowContaining } from './day.js';
import { DayflowError, isDayflowError } from './errors.js';
import {
  PANEL_CONFIG_PATH,
  PANEL_DAY_PATH,
  PANEL_ICON_PATH,
  PANEL_INSIGHTS_PATH,
  PANEL_MEMORY_ADD_PATH,
  PANEL_MONTH_PATH,
  PANEL_REFLECTION_ADD_PATH,
  PANEL_TASK_ADD_PATH,
  PANEL_WEEK_PATH,
  isMonthKey,
  monthDayKeys,
  shiftDayKey,
} from './panel-contract.js';
import type {
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
  PanelReviewItem,
  PanelTaskAddRequest,
  PanelTaskAddResponse,
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
 * answer is four empty lists and the file is never created by a read.
 * @param runtime - the plugin runtime.
 * @returns the journal's tasks, review queue, memory claims, and reflections.
 */
export function buildPanelInsights(runtime: ToolRuntime): PanelInsights {
  const empty: PanelInsights = { tasks: [], review: [], memory: [], reflections: [] };
  if (!existsSync(runtime.config.journalPath)) return empty;
  return withJournal(runtime.config.journalPath, (db) => ({
    tasks: listLongTasks(db, { status: 'active', limit: 20 }).map(taskSummary),
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
  }));
}

/**
 * Register the panel's routes when a web connection exists.
 * @param ctx - the plugin context.
 * @param runtime - the plugin runtime.
 */
export function registerPanelRoutes(ctx: Context, runtime: ToolRuntime): void {
  const icons = new IconStore(runtime.config.iconDirectory, runtime.config.icons);
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
  });
}
