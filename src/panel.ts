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

import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';

import { readDatabase } from './tools/shared.js';
import { journalCategories } from './journal.js';
import { IconStore } from './icons.js';
import { dayWindowContaining, dayWindowForKey, formatDayKey, timeZoneName, weekWindowContaining } from './day.js';
import { DayflowError, isDayflowError } from './errors.js';
import {
  PANEL_CONFIG_PATH,
  PANEL_DAY_PATH,
  PANEL_ICON_PATH,
  PANEL_MONTH_PATH,
  PANEL_WEEK_PATH,
  isMonthKey,
  monthDayKeys,
  shiftDayKey,
} from './panel-contract.js';
import type {
  PanelCard,
  PanelCategory,
  PanelConfig,
  PanelDay,
  PanelError,
  PanelMonth,
  PanelWeek,
} from './panel-contract.js';
import {
  activitiesForDay,
  activitiesStartingBetween,
  activityPayload,
  categoryTotals,
  dayCaptures,
  dayPendingBatches,
  lastCaptureInWindow,
  pendingBatchesInWindow,
} from './queries.js';
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
 * Build one day's panel payload.
 * @param runtime - the plugin runtime.
 * @param date - an optional `YYYY-MM-DD`; omitted means the current Dayflow day.
 * @returns the payload the browser renders.
 */
export function buildPanelDay(runtime: ToolRuntime, date?: string): PanelDay {
  const window = dayArgument(date);
  const preferences = panelPreferences(runtime);
  const colors = new Map(preferences.categories.map((category) => [category.name, category.colorHex]));

  const { activities, pending, lastCapture } = readDatabase(runtime, (db) => ({
    activities: activitiesForDay(db, window),
    pending: pendingBatchesInWindow(db, window),
    lastCapture: lastCaptureInWindow(db, window),
  }));

  return dayPayload(
    window.dayKey,
    activities,
    pending,
    lastCapture,
    colors,
    preferences.editsEnabled,
    formatDayKey(new Date()),
  );
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
      path: PANEL_CONFIG_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => jsonResponse({ enabled: runtime.config.panel } satisfies PanelConfig),
    });
  });
}
