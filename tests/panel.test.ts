/**
 * Host half of the panel: the day, month, week, and insights payload builders
 * and the panel's exact Fetch routes.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { formatDayKey } from '../src/day.js';
import { openJournal } from '../src/journal.js';
import { addMemoryClaim, supersedeMemoryClaim } from '../src/memory.js';
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
  shiftDayKey,
} from '../src/panel-contract.js';
import type { PanelConfig, PanelDay, PanelInsights, PanelMonth, PanelWeek } from '../src/panel-contract.js';
import {
  buildPanelDay,
  buildPanelInsights,
  buildPanelMonth,
  buildPanelWeek,
  registerPanelRoutes,
} from '../src/panel.js';
import { saveReflection } from '../src/reflections.js';
import { decideReviewItem, proposeReviewItem } from '../src/review.js';
import { attachTaskSession, createLongTask, updateLongTaskStatus } from '../src/tasks.js';
import { createFixtureDatabase } from './fixtures/database.js';
import { makeRuntime } from './helpers.js';

const fixture = createFixtureDatabase();
after(() => {
  fixture.cleanup();
});

interface RegisteredRoute {
  path: string;
  methods: readonly string[];
  requestBody: string;
  fetch: (request: Request) => Promise<Response>;
}

function fakeHost(runtime: ReturnType<typeof makeRuntime>): Map<string, RegisteredRoute> {
  const routes = new Map<string, RegisteredRoute>();
  const ctx = {
    effect: (effect: () => (() => void) | void) => effect(),
    inject: (_deps: readonly string[], callback: (connected: unknown) => void) => {
      callback({
        connection: {
          fetch: {
            register: (route: RegisteredRoute) => {
              routes.set(route.path, route);
              return async () => {};
            },
          },
        },
      });
    },
  };
  registerPanelRoutes(ctx as never, runtime);
  return routes;
}

const insightsDirectory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-panel-insights-'));
after(() => {
  rmSync(insightsDirectory, { recursive: true, force: true });
});

let journalCounter = 0;

/** A fresh journal path inside the disposable insights directory. */
function journalFile(label: string): string {
  journalCounter += 1;
  return join(insightsDirectory, `${label}-${journalCounter}.sqlite`);
}

/** A seeded row's id; a missing one would be a store bug, so fail loudly. */
function requiredId(id: number | undefined): number {
  assert.ok(id !== undefined, 'a seeded row must carry an id');
  return id;
}

interface SeededJournal {
  journalPath: string;
  recentDay: string;
  activeTaskId: number;
  agentTaskId: number;
  pausedTaskId: number;
  proposedReviewId: number;
  supersededClaimId: number;
  replacementClaimId: number;
  keptClaimId: number;
}

/**
 * Seed one disposable journal with a row of every kind the Insights tab shows,
 * plus the rows it must hide: a paused task, a decided review item, and a
 * superseded claim.
 * @returns the journal path and the ids the assertions refer to.
 */
function seedInsightsJournal(): SeededJournal {
  const journalPath = journalFile('insights');
  const recentDay = formatDayKey(new Date());
  const db = openJournal(journalPath);
  try {
    const activeTask = createLongTask(db, {
      title: 'Ship the panel',
      description: 'Finish the Insights tab.',
      target_date: '2027-01-31',
      categories: ['Work'],
      apps: ['Code'],
    });
    attachTaskSession(db, activeTask.id, { day: shiftDayKey(recentDay, -1), minutes: 25, note: 'wireframe' });
    attachTaskSession(db, activeTask.id, { day: recentDay, minutes: 35, note: 'build' });

    const pausedTask = createLongTask(db, { title: 'Paused experiment' });
    updateLongTaskStatus(db, pausedTask.id, 'paused');
    const agentTask = createLongTask(db, { title: 'Agent-raised cleanup', origin: 'agent', proposed_by: 'lead' });

    const openReview = proposeReviewItem(db, {
      kind: 'loop',
      title: 'Late starts',
      confidence: 0.8,
      source_day: recentDay,
    });
    const proposedReviewId = requiredId(openReview.item?.id);
    const decidedReview = proposeReviewItem(db, { kind: 'improvement', title: 'Already decided', confidence: 0.6 });
    decideReviewItem(db, requiredId(decidedReview.item?.id), 'reject');

    const supersededClaim = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'release ritual',
      body: 'Tag only after the notes are written.',
      observed_on: shiftDayKey(recentDay, -40),
      confidence: 0.6,
    });
    const replacement = supersedeMemoryClaim(db, supersededClaim.id, {
      body: 'Tag after the notes, then publish the changelog.',
      observed_on: shiftDayKey(recentDay, -35),
    });
    const keptClaim = addMemoryClaim(db, {
      kind: 'correction',
      subject: 'day boundary',
      body: 'Days start at 4 AM.',
      observed_on: shiftDayKey(recentDay, -38),
      confidence: 0.9,
    });

    saveReflection(db, { kind: 'day', period: shiftDayKey(recentDay, -2), body: 'Shipped the day route.' });
    saveReflection(db, { kind: 'day', period: shiftDayKey(recentDay, -3), body: 'Wrote the contract.' });

    return {
      journalPath,
      recentDay,
      activeTaskId: activeTask.id,
      agentTaskId: agentTask.id,
      pausedTaskId: pausedTask.id,
      proposedReviewId,
      supersededClaimId: supersededClaim.id,
      replacementClaimId: replacement.id,
      keptClaimId: keptClaim.id,
    };
  } finally {
    db.close();
  }
}

test('the panel payload matches the tools for a day', () => {
  const runtime = makeRuntime(fixture.path);
  const payload = buildPanelDay(runtime, '2026-10-19');

  assert.equal(payload.date, '2026-10-19');
  assert.equal(payload.day_boundary_hour, 4);
  assert.equal(payload.cards.length, 7);
  assert.equal(payload.tracked_minutes, 138);
  assert.equal(payload.pending_batches, 0);
  assert.equal(payload.edits_enabled, false);
  assert.equal(payload.cards[0]?.title, 'Writing the DSH plugin');
  assert.deepEqual(
    payload.categories.map((category) => category.name),
    ['Work', 'Personal', 'Idle', 'Distraction'],
  );
  assert.equal(payload.categories[0]?.color_hex, '#B984FF');
  assert.equal(typeof payload.today, 'string');
  assert.ok(payload.last_capture_at !== undefined);

  // The day route also carries the user's own goal and review marks.
  assert.ok(payload.goal !== null);
  assert.equal(payload.goal?.focus_minutes, 240);
  assert.equal(payload.goal?.distraction_limit_minutes, 60);
  assert.equal(payload.goal?.is_skipped, false);
  assert.deepEqual(payload.goal?.focus_categories, [
    { name: 'Work', color_hex: '#6A7EFF' },
    { name: 'Communication', color_hex: '#FFAE8C' },
  ]);
  assert.deepEqual(payload.goal?.distraction_categories, [{ name: 'Distraction', color_hex: '#FF6B6B' }]);

  assert.equal(payload.ratings?.length, 3);
  const firstRating = payload.ratings?.[0];
  assert.ok(firstRating);
  assert.equal(firstRating.rating, 'focused');
  assert.equal(firstRating.record_id, 1);
  assert.equal(firstRating.title, 'Writing the DSH plugin');
  assert.match(firstRating.start, /^2026-10-19T09:12:00[+-]\d{2}:\d{2}$/);
  assert.match(firstRating.end, /^2026-10-19T09:40:00[+-]\d{2}:\d{2}$/);
  assert.deepEqual(
    payload.ratings?.map(({ rating, record_id, title }) => ({ rating, record_id, title })),
    [
      { rating: 'focused', record_id: 1, title: 'Writing the DSH plugin' },
      { rating: 'distracted', record_id: 4, title: 'YouTube break' },
      { rating: 'neutral', record_id: 5, title: 'No screen activity' },
    ],
  );
});

test('a day without a goal keeps the goal null and the ratings empty', () => {
  const runtime = makeRuntime(fixture.path);
  const payload = buildPanelDay(runtime, '2026-10-18');
  assert.equal(payload.goal, null);
  assert.deepEqual(payload.ratings, []);
});

test('a category without a stored color falls back to the neutral token color', () => {
  const runtime = makeRuntime(fixture.path, { categories: [] });
  const payload = buildPanelDay(runtime, '2026-10-19');
  assert.equal(payload.categories[0]?.color_hex, '#A0AEC0');
});

test('the day route answers JSON and rejects an impossible date', async () => {
  const routes = fakeHost(makeRuntime(fixture.path));
  assert.deepEqual(
    [...routes.keys()].sort(),
    [
      PANEL_DAY_PATH,
      PANEL_MONTH_PATH,
      PANEL_WEEK_PATH,
      PANEL_ICON_PATH,
      PANEL_INSIGHTS_PATH,
      PANEL_CONFIG_PATH,
      PANEL_CAPTURE_STATUS_PATH,
      PANEL_TASK_ADD_PATH,
      PANEL_MEMORY_ADD_PATH,
      PANEL_REFLECTION_ADD_PATH,
      PANEL_TASK_SCAN_PATH,
      PANEL_TASK_LINK_PATH,
      PANEL_CAPTURE_PAUSE_PATH,
      PANEL_ANALYSIS_STATUS_PATH,
      PANEL_AUTOMATION_STATUS_PATH,
      PANEL_REVIEW_DECIDE_PATH,
      PANEL_TASK_ATTACH_PATH,
      PANEL_TASK_DETACH_PATH,
    ].sort(),
  );

  const day = routes.get(PANEL_DAY_PATH);
  assert.ok(day);
  assert.deepEqual([...day.methods], ['GET']);
  assert.equal(day.requestBody, 'buffered');

  const ok = await day.fetch(new Request(`http://127.0.0.1${PANEL_DAY_PATH}?date=2026-10-19`));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  const payload = (await ok.json()) as PanelDay;
  assert.equal(payload.date, '2026-10-19');
  assert.equal(payload.cards.length, 7);
  assert.equal(payload.goal?.focus_minutes, 240);
  assert.equal(payload.ratings?.length, 3);

  const bad = await day.fetch(new Request(`http://127.0.0.1${PANEL_DAY_PATH}?date=2026-02-30`));
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /YYYY-MM-DD/);

  const today = await day.fetch(new Request(`http://127.0.0.1${PANEL_DAY_PATH}`));
  assert.equal(today.status, 200);
  assert.equal(typeof ((await today.json()) as PanelDay).date, 'string');
});

test('a missing database answers 503 so the panel can explain it', async () => {
  const routes = fakeHost(makeRuntime('/nonexistent/dayflow/chunks.sqlite'));
  const route = routes.get(PANEL_DAY_PATH);
  assert.ok(route);
  const response = await route.fetch(new Request(`http://127.0.0.1${PANEL_DAY_PATH}`));
  assert.equal(response.status, 503);
  assert.match(((await response.json()) as { error: string }).error, /No Dayflow database/);
});

test('the config route reports the panel switch', async () => {
  const enabled = fakeHost(makeRuntime(fixture.path, { panel: true }));
  const enabledRoute = enabled.get(PANEL_CONFIG_PATH);
  assert.ok(enabledRoute);
  assert.deepEqual((await (await enabledRoute.fetch(new Request('http://127.0.0.1'))).json()) as PanelConfig, {
    enabled: true,
  });

  const disabled = fakeHost(makeRuntime(fixture.path, { panel: false }));
  const disabledRoute = disabled.get(PANEL_CONFIG_PATH);
  assert.ok(disabledRoute);
  assert.deepEqual((await (await disabledRoute.fetch(new Request('http://127.0.0.1'))).json()) as PanelConfig, {
    enabled: false,
  });
});

test('a month payload covers every calendar day and keeps the day states apart', () => {
  const runtime = makeRuntime(fixture.path);
  const payload = buildPanelMonth(runtime, '2026-10');

  assert.equal(payload.month, '2026-10');
  assert.equal(payload.days.length, 31);
  assert.deepEqual(payload.days.map((day) => day.date), [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-10',
    '2026-10-11',
    '2026-10-12',
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
    '2026-10-19',
    '2026-10-20',
    '2026-10-21',
    '2026-10-22',
    '2026-10-23',
    '2026-10-24',
    '2026-10-25',
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
    '2026-10-30',
    '2026-10-31',
  ]);

  const day = (key: string): PanelDay => {
    const found = payload.days.find((entry) => entry.date === key);
    assert.ok(found, `missing ${key}`);
    return found;
  };

  // Recorded.
  assert.equal(day('2026-10-19').tracked_minutes, 138);
  assert.equal(day('2026-10-19').cards.length, 7);
  assert.ok(day('2026-10-19').last_capture_at !== undefined);
  assert.equal(day('2026-10-19').categories[0]?.color_hex, '#B984FF');

  // Captured but quiet: no cards, yet not "no data".
  assert.equal(day('2026-10-17').tracked_minutes, 0);
  assert.equal(day('2026-10-17').cards.length, 0);
  assert.ok(day('2026-10-17').last_capture_at !== undefined);

  // No captures at all.
  assert.equal(day('2026-10-18').last_capture_at, undefined);
  assert.equal(day('2026-10-18').tracked_minutes, 0);

  // A day whose batch is still queued.
  assert.equal(day('2026-10-20').pending_batches, 1);
  assert.ok(day('2026-10-20').last_capture_at !== undefined);

  // Goals and review marks are day-route only, so no month day carries them.
  assert.ok(payload.days.every((entry) => entry.goal === undefined));
  assert.ok(payload.days.every((entry) => entry.ratings === undefined));

  assert.equal(payload.today, day('2026-10-19').today);
  assert.equal(typeof payload.time_zone, 'string');
});

test('the month route answers JSON and rejects a malformed month', async () => {
  const routes = fakeHost(makeRuntime(fixture.path));
  const month = routes.get(PANEL_MONTH_PATH);
  assert.ok(month);
  assert.deepEqual([...month.methods], ['GET']);
  assert.equal(month.requestBody, 'buffered');

  const ok = await month.fetch(new Request(`http://127.0.0.1${PANEL_MONTH_PATH}?month=2026-10`));
  assert.equal(ok.status, 200);
  const payload = (await ok.json()) as PanelMonth;
  assert.equal(payload.month, '2026-10');
  assert.equal(payload.days.length, 31);
  // The month wire shape is unchanged: the day-only keys never appear.
  assert.ok(payload.days.every((entry) => !('goal' in entry) && !('ratings' in entry)));

  const bad = await month.fetch(new Request(`http://127.0.0.1${PANEL_MONTH_PATH}?month=2026-13`));
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /YYYY-MM/);

  const fallback = await month.fetch(new Request(`http://127.0.0.1${PANEL_MONTH_PATH}`));
  assert.equal(fallback.status, 200);
  assert.match(((await fallback.json()) as PanelMonth).month, /^\d{4}-\d{2}$/);
});

test('month payloads end on the real last day of the month', () => {
  assert.equal(buildPanelMonth(makeRuntime(fixture.path), '2026-02').days.length, 28);
  assert.equal(buildPanelMonth(makeRuntime(fixture.path), '2024-02').days.length, 29);
});

test('a week payload holds seven Monday-first days with the same shapes as the month', () => {
  const runtime = makeRuntime(fixture.path);
  const payload = buildPanelWeek(runtime, '2026-10-21');

  assert.equal(payload.days.length, 7);
  assert.equal(payload.week_start, '2026-10-19');
  assert.equal(payload.week_end, '2026-10-25');
  assert.deepEqual(payload.days.map((day) => day.date), [
    '2026-10-19',
    '2026-10-20',
    '2026-10-21',
    '2026-10-22',
    '2026-10-23',
    '2026-10-24',
    '2026-10-25',
  ]);

  const monday = payload.days[0];
  assert.ok(monday);
  assert.equal(monday.tracked_minutes, 138);
  assert.equal(monday.cards.length, 7);
  assert.equal(monday.categories[0]?.color_hex, '#B984FF');

  // The quiet-but-captured day stays distinct from the no-capture days.
  const quiet = payload.days.find((day) => day.date === '2026-10-19');
  assert.ok(quiet);
  assert.ok(quiet.last_capture_at !== undefined);
  const empty = payload.days.find((day) => day.date === '2026-10-21');
  assert.ok(empty);
  assert.equal(empty.last_capture_at, undefined);
  assert.equal(empty.tracked_minutes, 0);

  // Goals and review marks are day-route only, so no week day carries them.
  assert.ok(payload.days.every((day) => day.goal === undefined));
  assert.ok(payload.days.every((day) => day.ratings === undefined));
});

test('the week route answers JSON, defaults to this week, and rejects bad dates', async () => {
  const routes = fakeHost(makeRuntime(fixture.path));
  const week = routes.get(PANEL_WEEK_PATH);
  assert.ok(week);
  assert.deepEqual([...week.methods], ['GET']);

  const ok = await week.fetch(new Request(`http://127.0.0.1${PANEL_WEEK_PATH}?date=2026-10-21`));
  assert.equal(ok.status, 200);
  const payload = (await ok.json()) as PanelWeek;
  assert.equal(payload.days.length, 7);
  assert.equal(payload.week_start, '2026-10-19');

  const current = await week.fetch(new Request(`http://127.0.0.1${PANEL_WEEK_PATH}`));
  assert.equal(current.status, 200);
  assert.equal(((await current.json()) as PanelWeek).days.length, 7);

  const bad = await week.fetch(new Request(`http://127.0.0.1${PANEL_WEEK_PATH}?date=not-a-day`));
  assert.equal(bad.status, 400);
});

test('day keys shift across month and year boundaries', () => {
  assert.equal(shiftDayKey('2026-10-19', 1), '2026-10-20');
  assert.equal(shiftDayKey('2026-10-01', -1), '2026-09-30');
  assert.equal(shiftDayKey('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDayKey('not-a-day', 1), 'not-a-day');
});

test('insights are empty for a fresh install and never create the journal', () => {
  const journalPath = journalFile('absent');
  const runtime = makeRuntime(fixture.path, { journalPath });

  const empty: PanelInsights = { tasks: [], review: [], memory: [], reflections: [], briefs: [] };
  assert.deepEqual(buildPanelInsights(runtime), empty);
  assert.equal(existsSync(journalPath), false);
});

test("insights map the journal's active tasks, open review, live claims, and reflections", () => {
  const seeded = seedInsightsJournal();
  const payload = buildPanelInsights(makeRuntime(fixture.path, { journalPath: seeded.journalPath }));

  // Only active tasks, newest first; paused work is already the user's decision.
  assert.deepEqual(payload.tasks.map((task) => task.id), [seeded.agentTaskId, seeded.activeTaskId]);
  assert.ok(!payload.tasks.some((task) => task.id === seeded.pausedTaskId));

  const active = payload.tasks.find((task) => task.id === seeded.activeTaskId);
  assert.ok(active);
  assert.equal(active.title, 'Ship the panel');
  assert.equal(active.status, 'active');
  assert.equal(active.origin, 'user');
  assert.equal(active.total_minutes, 60);
  assert.equal(active.session_days, 2);
  assert.equal(active.last_session_day, seeded.recentDay);
  assert.equal(active.target_date, '2027-01-31');
  assert.equal(active.stalled, false);

  // A task without a session carries neither optional key.
  const agent = payload.tasks.find((task) => task.id === seeded.agentTaskId);
  assert.ok(agent);
  assert.deepEqual(agent, {
    id: seeded.agentTaskId,
    title: 'Agent-raised cleanup',
    status: 'active',
    origin: 'agent',
    total_minutes: 0,
    session_days: 0,
    stalled: false,
  });

  // Only the still-open proposal survives, source day included.
  assert.deepEqual(payload.review, [
    {
      id: seeded.proposedReviewId,
      kind: 'loop',
      status: 'proposed',
      title: 'Late starts',
      confidence: 0.8,
      source_day: seeded.recentDay,
    },
  ]);

  // A superseded claim is history, so only its replacement and the other live claim remain.
  assert.deepEqual(
    payload.memory.map(({ id, kind, subject, observed_on, confidence }) => ({
      id,
      kind,
      subject,
      observed_on,
      confidence,
    })),
    [
      {
        id: seeded.replacementClaimId,
        kind: 'preference',
        subject: 'release ritual',
        observed_on: shiftDayKey(seeded.recentDay, -35),
        confidence: 0.6,
      },
      {
        id: seeded.keptClaimId,
        kind: 'correction',
        subject: 'day boundary',
        observed_on: shiftDayKey(seeded.recentDay, -38),
        confidence: 0.9,
      },
    ],
  );
  assert.ok(!payload.memory.some((claim) => claim.id === seeded.supersededClaimId));

  // Newest period first, body carried whole so the tab can render it.
  assert.deepEqual(
    payload.reflections.map(({ period_key, body }) => ({ period_key, body })),
    [
      { period_key: shiftDayKey(seeded.recentDay, -2), body: 'Shipped the day route.' },
      { period_key: shiftDayKey(seeded.recentDay, -3), body: 'Wrote the contract.' },
    ],
  );
  const newest = payload.reflections[0];
  assert.ok(newest);
  assert.equal(newest.kind, 'day');
  assert.match(newest.updated_at, /^\d{4}-\d{2}-\d{2} /);
});

test('insights cap claims at 20 live rows and reflections at 10', () => {
  const journalPath = journalFile('limits');
  const baseDay = formatDayKey(new Date());
  const claimIds: number[] = [];
  const reflectionPeriods: string[] = [];
  const db = openJournal(journalPath);
  try {
    for (let index = 1; index <= 21; index += 1) {
      const claim = addMemoryClaim(db, {
        kind: 'preference',
        subject: `subject ${String(index)}`,
        body: `claim ${String(index)}`,
        observed_on: shiftDayKey(baseDay, -(index + 5)),
      });
      claimIds.push(claim.id);
    }
    for (let index = 0; index < 11; index += 1) {
      const period = shiftDayKey(baseDay, -(index + 5));
      saveReflection(db, { kind: 'day', period, body: `reflection ${String(index)}` });
      reflectionPeriods.push(period);
    }
    const [newestClaimId] = claimIds;
    assert.ok(newestClaimId !== undefined);
    supersedeMemoryClaim(db, newestClaimId, { body: 'The ritual changed.', observed_on: shiftDayKey(baseDay, -1) });
  } finally {
    db.close();
  }

  const payload = buildPanelInsights(makeRuntime(fixture.path, { journalPath }));

  assert.equal(payload.memory.length, 20);
  // The replacement is the newest live claim; the superseded row and the oldest
  // live row fall outside the 20-row window.
  assert.equal(payload.memory[0]?.subject, 'subject 1');
  assert.equal(payload.memory[0]?.observed_on, shiftDayKey(baseDay, -1));
  assert.ok(!payload.memory.some((claim) => claim.id === claimIds[0]));
  assert.ok(!payload.memory.some((claim) => claim.id === claimIds[20]));

  assert.equal(payload.reflections.length, 10);
  assert.deepEqual(payload.reflections.map((reflection) => reflection.period_key), reflectionPeriods.slice(0, 10));
  assert.ok(!payload.reflections.some((reflection) => reflection.period_key === reflectionPeriods[10]));
});

test('the insights route answers JSON from the owned journal', async () => {
  const seeded = seedInsightsJournal();
  const routes = fakeHost(makeRuntime(fixture.path, { journalPath: seeded.journalPath }));
  const route = routes.get(PANEL_INSIGHTS_PATH);
  assert.ok(route);
  assert.deepEqual([...route.methods], ['GET']);
  assert.equal(route.requestBody, 'buffered');

  const response = await route.fetch(new Request(`http://127.0.0.1${PANEL_INSIGHTS_PATH}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = (await response.json()) as PanelInsights;
  for (const key of ['tasks', 'review', 'memory', 'reflections'] as const) {
    assert.ok(Array.isArray(payload[key]), `${key} is a list`);
  }
  assert.equal(payload.tasks.length, 2);
  assert.equal(payload.tasks[1]?.title, 'Ship the panel');
  assert.equal(payload.review[0]?.title, 'Late starts');
  assert.equal(payload.memory.length, 2);
  assert.equal(payload.reflections.length, 2);

  // A missing journal is a fresh install, not a failure.
  const fresh = fakeHost(makeRuntime(fixture.path, { journalPath: journalFile('route-absent') }));
  const freshRoute = fresh.get(PANEL_INSIGHTS_PATH);
  assert.ok(freshRoute);
  const freshResponse = await freshRoute.fetch(new Request(`http://127.0.0.1${PANEL_INSIGHTS_PATH}`));
  assert.equal(freshResponse.status, 200);
  assert.deepEqual((await freshResponse.json()) as PanelInsights, {
    tasks: [],
    review: [],
    memory: [],
    reflections: [],
    briefs: [],
  });
});
