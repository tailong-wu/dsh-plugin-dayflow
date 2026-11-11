/**
 * The eight read tools: timeline, activity detail, range totals, search, the
 * Daily standup, the weekly rollup, categories, and capture status.
 *
 * Reads always go straight to SQLite, so they keep working while the Dayflow
 * app is closed.
 * @module dsh-plugin-dayflow/tools/read
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { existsSync } from 'node:fs';

import { categoryPayloads } from '../categories.js';
import { formatDayKey, timeZoneName, weekWindowContaining } from '../day.js';
import {
  renderActivity,
  renderBreakdown,
  renderCategories,
  renderDaily,
  renderSearch,
  renderStatus,
  renderTimeline,
  renderWeekly,
} from '../format.js';
import { defaultAgentSocketPath } from '../paths.js';
import type {
  ActivityPayload,
  BreakdownPayload,
  DailyPayload,
  SearchPayload,
  StatusPayload,
  TimelinePayload,
  WeeklyPayload,
} from '../queries.js';
import {
  activitiesForDay,
  activitiesInRange,
  activityById,
  activityPayload,
  breakdownPayload,
  captureStatus,
  searchActivities,
  standupForDay,
  timelinePayload,
  weeklyPayload,
} from '../queries.js';
import { DayflowError } from '../errors.js';
import { journalCategories } from '../journal.js';
import { setupStatus } from '../setup.js';
import { dayArgument } from './shared.js';
import type { ToolRuntime } from './shared.js';
import { DATE_DESCRIPTION, UNTRUSTED_NOTICE, jsonValue, readDatabase } from './shared.js';

/**
 * Build the read tool set for one plugin instance.
 * @param runtime - the plugin runtime.
 * @returns the tool definitions, ready to register.
 */
export function readTools(runtime: ToolRuntime): ToolDefinition[] {
  return [
    defineTool({
      name: 'dayflow_timeline',
      description:
        'The activities Dayflow recorded on one Dayflow day: time range, title, one-line summary, category, apps, ' +
        'and record ID for each. Use it for "what did I work on" and to find record IDs for dayflow_activity. ' +
        'These are screen activities: what was on this Mac, not where the user was or what happened away from it. ' +
        `Days run 04:00 to 04:00 local time. ${UNTRUSTED_NOTICE}`,
      parameters: {
        date: { type: 'string', description: DATE_DESCRIPTION },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          { type: 'text', text: renderTimeline(value as unknown as TimelinePayload) },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const window = dayArgument(args.date);
        const activities = readDatabase(runtime, (db) => activitiesForDay(db, window));
        return jsonValue(timelinePayload(activities, window));
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: `Dayflow timeline · ${args.date ?? 'today'}`,
      }),
    }),

    defineTool({
      name: 'dayflow_activity',
      description:
        'One activity in full, including the longer write-up dayflow_timeline leaves out. Pass a record_id from ' +
        'dayflow_timeline. Use it for the few activities that matter to the question. The write-up describes what ' +
        `was on screen, not what the user did away from the Mac. ${UNTRUSTED_NOTICE}`,
      parameters: {
        record_id: { type: 'integer', required: true, description: 'Activity ID from dayflow_timeline.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          { type: 'text', text: renderActivity(value as unknown as ActivityPayload, timeZoneName()) },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const activity = readDatabase(runtime, (db) => activityById(db, args.record_id));
        if (activity === undefined) {
          throw new DayflowError(`No activity with record ID ${args.record_id}.`, 'not_found');
        }
        return jsonValue(activityPayload(activity, true));
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: `Dayflow activity #${args.record_id}`,
      }),
    }),

    defineTool({
      name: 'dayflow_breakdown',
      description:
        'Time totals per category between two Dayflow days, with each category share. Cheap and usually the right ' +
        'first call for "where did my time go". These are totals of recorded screen time per category, not of the ' +
        'user\'s whole day. Excludes the System category, as Dayflow does.',
      parameters: {
        from: { type: 'string', required: true, description: 'Start day, YYYY-MM-DD.' },
        to: { type: 'string', required: true, description: 'End day, YYYY-MM-DD (inclusive).' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          { type: 'text', text: renderBreakdown(value as unknown as BreakdownPayload) },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const from = dayArgument(args.from);
        const to = dayArgument(args.to);
        if (from.start > to.start) {
          throw new DayflowError('from must be the earlier day.', 'invalid_input');
        }
        const activities = readDatabase(runtime, (db) => activitiesInRange(db, from.start, to.end));
        return jsonValue(breakdownPayload(activities, from.dayKey, to.dayKey));
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: `Dayflow totals · ${args.from} → ${args.to}`,
      }),
    }),

    defineTool({
      name: 'dayflow_search',
      description:
        'Find activities whose title or summary contains text, newest first. Use it for "when did I work on the ' +
        `pricing page". ${UNTRUSTED_NOTICE}`,
      parameters: {
        query: { type: 'string', required: true, description: 'Text to look for in titles and summaries.' },
        limit: { type: 'integer', description: 'Maximum matches to return (defaults to the plugin setting).' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderSearch(value as unknown as SearchPayload) }],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const query = args.query.trim();
        if (query === '') throw new DayflowError('query must not be empty.', 'invalid_input');
        const requested = args.limit ?? runtime.config.searchLimit;
        const limit = Math.min(Math.max(1, Math.trunc(requested)), runtime.config.searchLimit);
        const matches = readDatabase(runtime, (db) => searchActivities(db, query, limit));
        return jsonValue({
          query,
          matches: matches.map((activity) => activityPayload(activity, false)),
        });
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'search',
        title: `Dayflow search · ${args.query}`,
      }),
    }),

    defineTool({
      name: 'dayflow_daily',
      description:
        'The Daily standup document Dayflow generated for a calendar day: highlights, tasks, and blockers. Use it ' +
        'for standups and status updates. Dayflow only writes one after a day with enough activity.',
      parameters: {
        date: { type: 'string', description: 'Day as YYYY-MM-DD. Omit for today.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderDaily(value as unknown as DailyPayload) }],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const key = args.date === undefined || args.date.trim() === '' ? formatDayKey(new Date()) : args.date;
        const window = dayArgument(key);
        const standup = readDatabase(runtime, (db) => standupForDay(db, window.dayKey));
        if (standup === undefined) {
          throw new DayflowError(
            `No Daily for ${window.dayKey}. Dayflow generates one after a day with enough activity.`,
            'not_found',
          );
        }
        return jsonValue({
          date: standup.day,
          highlights: [...standup.highlights],
          tasks: [...standup.tasks],
          blockers: standup.blockers,
        });
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: `Dayflow Daily · ${args.date ?? 'today'}`,
      }),
    }),

    defineTool({
      name: 'dayflow_weekly',
      description:
        'Weekly rollup for the week containing a date: tracked and focus minutes plus category totals. Weeks run ' +
        'Monday 04:00 to Monday 04:00.',
      parameters: {
        date: { type: 'string', description: 'Any day inside the week, YYYY-MM-DD. Omit for the current week.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderWeekly(value as unknown as WeeklyPayload) }],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const anchor = args.date === undefined || args.date.trim() === '' ? new Date() : dayArgument(args.date).start;
        const week = weekWindowContaining(anchor);
        const activities = readDatabase(runtime, (db) => activitiesInRange(db, week.start, week.end));
        return jsonValue(weeklyPayload(activities, week.start, week.end));
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'read',
        title: `Dayflow weekly · ${args.date ?? 'this week'}`,
      }),
    }),

    defineTool({
      name: 'dayflow_categories',
      description:
        "The user's timeline categories with their colors, system and idle flags. Use it before filtering or " +
        'assigning by category name.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          { type: 'text', text: renderCategories((value as unknown as { categories: never[] }).categories) },
        ],
      },
      isConcurrencySafe: () => true,
      async execute() {
        const preferences = runtime.preferences();
        const categories = runtime.config.dayflow ? preferences.categories : journalCategories(runtime.config.journalPath, runtime.config.databasePath);
        return jsonValue({ categories: categoryPayloads(categories.length > 0 ? categories : preferences.categories) });
      },
      presentCall: () => ({ card: 'generic', kind: 'read', title: 'Dayflow categories' }),
    }),

    defineTool({
      name: 'dayflow_status',
      description:
        "Dayflow's state: current day, capture freshness, analysis backlog, whether edits are enabled, whether the " +
        'edit bridge is listening, and — when Dayflow is absent — what still has to be installed. Use it when data ' +
        'looks missing or stale.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderStatus(value as unknown as StatusPayload) }],
      },
      isConcurrencySafe: () => true,
      async execute() {
        const preferences = runtime.preferences();
        const presence = runtime.config.dayflow ? runtime.presence() : undefined;
        const databasePath = runtime.config.dayflow ? runtime.config.databasePath : runtime.config.journalPath;
        const databasePresent = runtime.config.dayflow ? presence?.databasePresent === true : existsSync(databasePath);
        const setup = runtime.config.dayflow && presence !== undefined
          ? setupStatus(presence, runtime.config.databasePath)
          : undefined;

        // A missing Dayflow database is a setup state. A missing owned journal is
        // simply an empty backend that can be populated with journal_import.
        const payload: StatusPayload = {
          today: formatDayKey(new Date()),
          time_zone: timeZoneName(),
          day_boundary_hour: 4,
          pending_batches: 0,
          failed_batches: 0,
          source: runtime.config.source,
          edits_enabled: runtime.config.dayflow && preferences.editsEnabled,
          edit_bridge_listening:
            runtime.config.dayflow && existsSync(runtime.config.agentSocket || defaultAgentSocketPath()),
          database_path: databasePath,
          database_present: databasePresent,
          ...(setup === undefined ? {} : { setup }),
        };

        if (databasePresent) {
          const status = readDatabase(runtime, (db) => captureStatus(db));
          payload.pending_batches = status.pendingBatches;
          payload.failed_batches = status.failedBatches;
          if (status.lastCaptureAt !== undefined) {
            payload.last_capture_at = status.lastCaptureAt.toISOString();
          }
        }
        return jsonValue(payload);
      },
      presentCall: () => ({ card: 'generic', kind: 'read', title: 'Dayflow status' }),
    }),
  ];
}
