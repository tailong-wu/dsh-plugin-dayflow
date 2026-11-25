/**
 * Insights host end-to-end: the payload builder reads the owned journal, and the
 * exact Fetch routes `/api/dayflow/insights` and the write routes behind the
 * view serve and grow that journal.
 *
 * The builder must be read-only in the strongest sense: a fresh install (no
 * journal file) yields four empty lists without creating the file, and repeated
 * reads leave the journal byte-for-byte unchanged.
 *
 * These tests use disposable journals under a temporary directory; they never
 * touch the default `$DSH_HOME` journal.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PANEL_CONFIG_PATH,
  PANEL_DAY_PATH,
  PANEL_ICON_PATH,
  PANEL_INSIGHTS_PATH,
  PANEL_MEMORY_ADD_PATH,
  PANEL_MONTH_PATH,
  PANEL_REFLECTION_ADD_PATH,
  PANEL_TASK_ADD_PATH,
  PANEL_TASK_LINK_PATH,
  PANEL_TASK_SCAN_PATH,
  PANEL_WEEK_PATH,
} from '../src/panel-contract.js';
import type {
  PanelInsights,
  PanelMemoryAddResponse,
  PanelReflectionAddResponse,
  PanelTaskAddResponse,
  PanelTaskLinkResponse,
  PanelTaskScanResponse,
} from '../src/panel-contract.js';
import { buildPanelInsights, registerPanelRoutes } from '../src/panel.js';
import { dayWindowContaining } from '../src/day.js';
import { openJournal } from '../src/journal.js';
import { addMemoryClaim, supersedeMemoryClaim } from '../src/memory.js';
import { decideReviewItem, proposeReviewItem } from '../src/review.js';
import { saveReflection } from '../src/reflections.js';
import { attachTaskSession, createLongTask, updateLongTaskStatus } from '../src/tasks.js';
import { makeRuntime } from './helpers.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-panel-insights-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let fileCounter = 0;

/** A fresh journal path inside the disposable directory. */
function journalFile(label: string): string {
  fileCounter += 1;
  return join(directory, `${label}-${fileCounter}.sqlite`);
}

interface RegisteredRoute {
  path: string;
  methods: readonly string[];
  requestBody: string;
  fetch: (request: Request) => Promise<Response>;
}

/** A cordis-shaped host whose only connection member is the Fetch registry. */
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

/** Look up the registered insights route, failing loudly when it is missing. */
function insightsRoute(routes: Map<string, RegisteredRoute>): RegisteredRoute {
  const route = routes.get(PANEL_INSIGHTS_PATH);
  assert.ok(route, `route ${PANEL_INSIGHTS_PATH} is not registered`);
  return route;
}

/** GET the insights route the way the browser would. */
async function fetchInsights(routes: Map<string, RegisteredRoute>): Promise<Response> {
  return insightsRoute(routes).fetch(new Request(`http://127.0.0.1${PANEL_INSIGHTS_PATH}`));
}

/**
 * POST one body to a registered write route the way the browser would.
 * @param routes - the registered routes.
 * @param path - the exact route to call.
 * @param body - a JSON-able value, or a raw string sent verbatim.
 * @returns the route's answer.
 */
async function postRoute(
  routes: Map<string, RegisteredRoute>,
  path: string,
  body: unknown,
): Promise<Response> {
  const route = routes.get(path);
  assert.ok(route, `route ${path} is not registered`);
  return route.fetch(
    new Request(`http://127.0.0.1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

/** The Dayflow day containing now, which the write routes date their rows to. */
function todayKey(): string {
  return dayWindowContaining(new Date()).dayKey;
}

/**
 * A runtime whose activity reads and task reads both come from the owned
 * journal: the scan route reads activity from the active backend and the task
 * from the owned store, so this shape exercises the owned branch end to end.
 * @param journalPath - the disposable owned journal.
 * @returns the runtime.
 */
function ownedRuntime(journalPath: string): ReturnType<typeof makeRuntime> {
  return makeRuntime('/nonexistent/dayflow/chunks.sqlite', { source: 'owned', dayflow: false, journalPath });
}

/** SHA-256 of one file's bytes, used to prove a read changed nothing. */
function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('a missing journal answers four empty lists without creating the journal', async () => {
  const journalPath = journalFile('missing');
  assert.equal(existsSync(journalPath), false);
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });

  const insights = buildPanelInsights(runtime);
  assert.deepEqual(insights, { tasks: [], review: [], memory: [], reflections: [] });
  assert.equal(existsSync(journalPath), false, 'a read must not create the journal');

  const response = await fetchInsights(fakeHost(runtime));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()) as PanelInsights, {
    tasks: [],
    review: [],
    memory: [],
    reflections: [],
  });
  assert.equal(existsSync(journalPath), false, 'serving the route must not create the journal');
});

test('the insights payload maps active tasks, open review items, active claims, and reflections', () => {
  const journalPath = journalFile('populated');
  const db = openJournal(journalPath);
  let activeTaskId = 0;
  let activeTaskStalled = false;
  let pausedTaskId = 0;
  let proposedItemId = 0;
  let keptItemId = 0;
  let activeClaimId = 0;
  let supersededClaimId = 0;
  let replacementClaimId = 0;
  let dayReflectionId = 0;
  let weekReflectionId = 0;
  let dayReflectionUpdatedAt = '';
  try {
    const activeTask = createLongTask(db, {
      title: 'Ship the insights tab',
      description: 'Expose tasks, review, memory, and reflections in the right sidebar.',
      categories: ['Work'],
      apps: ['Xcode'],
      target_date: '2026-12-01',
    });
    activeTaskId = activeTask.id;
    attachTaskSession(db, activeTask.id, { day: '2026-11-23', minutes: 30, note: 'drafted the contract' });
    const progressed = attachTaskSession(db, activeTask.id, {
      day: '2026-11-24',
      minutes: 45,
      note: 'wired the route',
    });
    assert.equal(progressed.total_minutes, 75);
    assert.equal(progressed.session_days, 2);
    assert.equal(progressed.last_session_day, '2026-11-24');
    // Stalling depends on the wall clock, so compare against the store's own
    // answer for the same instant instead of hard-coding a date-sensitive value.
    activeTaskStalled = progressed.stalled;

    // A task that is not active must never reach the insights list.
    const paused = createLongTask(db, { title: 'Port the lint report', description: 'On hold.' });
    pausedTaskId = paused.id;
    updateLongTaskStatus(db, paused.id, 'paused');

    const proposed = proposeReviewItem(db, {
      kind: 'improvement',
      title: 'Show stalled tasks first',
      body: 'Put the tasks that have not moved ahead of the active ones.',
      confidence: 0.8,
      source_day: '2026-11-24',
    });
    assert.equal(proposed.dropped, false);
    assert.ok(proposed.item);
    proposedItemId = proposed.item.id;

    // Once decided the item is no longer open, so the payload must hide it.
    const kept = proposeReviewItem(db, {
      kind: 'distillation',
      title: 'Insights are read-only',
      body: 'The insights payload never writes to the journal.',
      confidence: 0.75,
      source_day: '2026-11-23',
    });
    assert.ok(kept.item);
    keptItemId = kept.item.id;
    assert.equal(decideReviewItem(db, kept.item.id, 'keep').status, 'kept');

    const activeClaim = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'panel insights',
      body: 'the insights tab should not need a refresh button',
      observed_on: '2026-11-20',
      confidence: 0.9,
    });
    activeClaimId = activeClaim.id;

    // Superseding keeps the history row but hides it from the active list; the
    // replacement is itself active, so the payload must carry both live claims.
    const supersededClaim = addMemoryClaim(db, {
      kind: 'distillation',
      subject: 'lint pass',
      body: 'the lint pass writes its findings',
      observed_on: '2026-11-10',
      confidence: 0.6,
    });
    supersededClaimId = supersededClaim.id;
    const replacement = supersedeMemoryClaim(db, supersededClaim.id, {
      body: 'the lint pass is read-only',
      observed_on: '2026-11-21',
      confidence: 0.8,
    });
    replacementClaimId = replacement.id;

    const dayReflection = saveReflection(db, {
      kind: 'day',
      period: '2026-11-24',
      body: 'Focused day on the insights host.',
      highlights: ['route landed'],
    });
    dayReflectionId = dayReflection.id;
    dayReflectionUpdatedAt = dayReflection.updated_at;

    const weekReflection = saveReflection(db, {
      kind: 'week',
      period: '2026-11-24',
      body: 'A week of journal read paths.',
      highlights: ['four surfaces'],
    });
    weekReflectionId = weekReflection.id;
    assert.equal(weekReflection.period_key, '2026-11-23', 'a week lands on its Monday');
  } finally {
    db.close();
  }

  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const insights = buildPanelInsights(runtime);

  // Tasks: active only, with the derived summary mapped field for field.
  assert.equal(insights.tasks.length, 1);
  assert.deepEqual(insights.tasks[0], {
    id: activeTaskId,
    title: 'Ship the insights tab',
    status: 'active',
    origin: 'user',
    total_minutes: 75,
    session_days: 2,
    last_session_day: '2026-11-24',
    target_date: '2026-12-01',
    stalled: activeTaskStalled,
  });
  assert.ok(!insights.tasks.some((task) => task.id === pausedTaskId), 'paused tasks are not active');

  // Review: proposed only; the summary carries no body or evidence.
  assert.equal(insights.review.length, 1);
  assert.deepEqual(insights.review[0], {
    id: proposedItemId,
    kind: 'improvement',
    status: 'proposed',
    title: 'Show stalled tasks first',
    confidence: 0.8,
    source_day: '2026-11-24',
  });
  assert.ok(!insights.review.some((item) => item.id === keptItemId), 'decided items are not proposed');

  // Memory: active claims only (the replacement counts as active), summaries
  // carry no body.
  assert.equal(insights.memory.length, 2);
  assert.deepEqual(
    insights.memory.map((claim) => claim.id).sort((left, right) => left - right),
    [activeClaimId, replacementClaimId].sort((left, right) => left - right),
  );
  assert.deepEqual(
    insights.memory.find((claim) => claim.id === activeClaimId),
    {
      id: activeClaimId,
      kind: 'preference',
      subject: 'panel insights',
      observed_on: '2026-11-20',
      confidence: 0.9,
    },
  );
  assert.ok(
    !insights.memory.some((claim) => claim.id === supersededClaimId),
    'superseded claims are history, not insights',
  );
  assert.ok(insights.memory.every((claim) => !('body' in claim)), 'claim bodies stay out of the summary');

  // Reflections: day and week, with the normalized period key.
  assert.equal(insights.reflections.length, 2);
  assert.deepEqual(
    insights.reflections.map((reflection) => reflection.id).sort((left, right) => left - right),
    [dayReflectionId, weekReflectionId].sort((left, right) => left - right),
  );
  assert.deepEqual(insights.reflections.find((reflection) => reflection.kind === 'day'), {
    id: dayReflectionId,
    kind: 'day',
    period_key: '2026-11-24',
    body: 'Focused day on the insights host.',
    updated_at: dayReflectionUpdatedAt,
  });
  const weekSummary = insights.reflections.find((reflection) => reflection.kind === 'week');
  assert.ok(weekSummary);
  assert.equal(weekSummary.period_key, '2026-11-23');
});

test('the insights route coexists with the other panel routes and answers JSON', async () => {
  const journalPath = journalFile('route');
  const db = openJournal(journalPath);
  let taskId = 0;
  try {
    taskId = createLongTask(db, { title: 'Serve the insights payload', description: '' }).id;
    saveReflection(db, { kind: 'day', period: '2026-11-24', body: 'The route answer is stable.' });
  } finally {
    db.close();
  }

  assert.equal(PANEL_INSIGHTS_PATH, '/api/dayflow/insights');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const routes = fakeHost(runtime);

  // The eleven exact Fetch routes share the registry without replacing each
  // other: six reads plus the five writes that back the inline add rows and the
  // post-add history scan/link pair.
  const readPaths = [
    PANEL_DAY_PATH,
    PANEL_MONTH_PATH,
    PANEL_WEEK_PATH,
    PANEL_ICON_PATH,
    PANEL_CONFIG_PATH,
    PANEL_INSIGHTS_PATH,
  ];
  const writePaths = [
    PANEL_TASK_ADD_PATH,
    PANEL_MEMORY_ADD_PATH,
    PANEL_REFLECTION_ADD_PATH,
    PANEL_TASK_SCAN_PATH,
    PANEL_TASK_LINK_PATH,
  ];
  assert.deepEqual([...routes.keys()].sort(), [...readPaths, ...writePaths].sort());
  for (const path of readPaths) {
    const route = routes.get(path);
    assert.ok(route);
    assert.deepEqual([...(route.methods ?? [])], ['GET'], `${path} only answers GET`);
    assert.equal(route.requestBody, 'buffered', `${path} buffers its request body`);
  }
  for (const path of writePaths) {
    const route = routes.get(path);
    assert.ok(route);
    assert.deepEqual([...(route.methods ?? [])], ['POST'], `${path} only answers POST`);
    assert.equal(route.requestBody, 'buffered', `${path} buffers its request body`);
  }

  const response = await fetchInsights(routes);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = (await response.json()) as PanelInsights;
  assert.deepEqual(payload, buildPanelInsights(runtime));
  assert.equal(payload.tasks[0]?.id, taskId);
  assert.equal(payload.reflections.length, 1);
});

test('a corrupt journal answers a JSON error instead of a payload', async () => {
  const journalPath = journalFile('corrupt');
  // A real file that exists but is not SQLite: the journal probe's first schema
  // query fails as a raw SQLite error, which failureResponse reports as a 500
  // JSON body (a DayflowError with `database_error` would map to 503 instead).
  writeFileSync(journalPath, 'this file is not a SQLite journal\n'.repeat(4), 'utf8');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });

  const response = await fetchInsights(fakeHost(runtime));
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = (await response.json()) as { error: string };
  assert.equal(typeof body.error, 'string');
  assert.match(body.error, /not a database/i);
});

test('reading insights twice is deterministic and leaves the journal unchanged', () => {
  const journalPath = journalFile('readonly');
  const db = openJournal(journalPath);
  try {
    const task = createLongTask(db, { title: 'Read the journal without writing it', description: '' });
    attachTaskSession(db, task.id, { day: '2026-11-24', minutes: 20 });
    proposeReviewItem(db, {
      kind: 'task_proposal',
      title: 'Add a compact insights empty state',
      confidence: 0.7,
      source_day: '2026-11-24',
    });
    addMemoryClaim(db, {
      kind: 'correction',
      subject: 'insights route',
      body: 'the insights route reads the owned journal',
      observed_on: '2026-11-19',
    });
    saveReflection(db, { kind: 'week', period: '2026-11-24', body: 'Read-only all the way down.' });
  } finally {
    db.close();
  }

  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const hashBefore = fileHash(journalPath);
  const mtimeBefore = statSync(journalPath).mtimeMs;

  const first = buildPanelInsights(runtime);
  const second = buildPanelInsights(runtime);

  assert.deepEqual(second, first);
  assert.equal(fileHash(journalPath), hashBefore, 'a read must not rewrite the journal');
  assert.equal(statSync(journalPath).mtimeMs, mtimeBefore, 'a read must not touch the journal mtime');
  assert.equal(existsSync(`${journalPath}-journal`), false, 'a read must not leave a rollback journal');
  assert.equal(existsSync(`${journalPath}-wal`), false, 'a read must not start a WAL');
});

test('the task add route creates a user task that the insights payload then lists', async () => {
  const journalPath = journalFile('add-task');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const routes = fakeHost(runtime);
  assert.equal(existsSync(journalPath), false, 'the add route creates the journal on first write');

  const response = await postRoute(routes, PANEL_TASK_ADD_PATH, { title: 'Ship the release' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = (await response.json()) as PanelTaskAddResponse;
  assert.equal(typeof payload.task.id, 'number');
  assert.equal(payload.task.title, 'Ship the release');
  assert.equal(payload.task.status, 'active');
  assert.equal(payload.task.origin, 'user', 'a panel add is the user own task, not an agent proposal');
  assert.equal(payload.task.total_minutes, 0);
  assert.equal(payload.task.session_days, 0);
  assert.equal(payload.task.stalled, false);
  assert.equal('last_session_day' in payload.task, false, 'a task with no session has no last session day');
  assert.equal('target_date' in payload.task, false, 'a quick add sets no target date');

  const insights = buildPanelInsights(runtime);
  assert.deepEqual(insights.tasks, [payload.task]);
});

test('the memory add route stores a today-dated preference claim the insights list shows', async () => {
  const journalPath = journalFile('add-memory');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const routes = fakeHost(runtime);

  const text = 'On 2026-10-22 I used a checklist.';
  const response = await postRoute(routes, PANEL_MEMORY_ADD_PATH, { text });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  const payload = (await response.json()) as PanelMemoryAddResponse;
  assert.equal(typeof payload.claim.id, 'number');
  assert.equal(payload.claim.kind, 'preference');
  assert.equal(payload.claim.subject, text, 'a short claim is its own subject');
  assert.equal(payload.claim.observed_on, todayKey(), 'a claim added today is observed today');
  assert.equal(payload.claim.confidence, 0.7);

  const insights = buildPanelInsights(runtime);
  assert.deepEqual(insights.memory, [payload.claim]);

  // An overlong claim keeps a readable subject instead of spilling the body.
  const longText = 'x'.repeat(80);
  const longResponse = await postRoute(routes, PANEL_MEMORY_ADD_PATH, { text: longText });
  assert.equal(longResponse.status, 200);
  const longClaim = ((await longResponse.json()) as PanelMemoryAddResponse).claim;
  assert.equal(longClaim.subject, `${'x'.repeat(60)}…`);
  assert.equal(typeof longClaim.id, 'number');
});

test('the reflection add route creates today reflection and later appends to it', async () => {
  const journalPath = journalFile('add-reflection');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const routes = fakeHost(runtime);
  const today = todayKey();

  const first = await postRoute(routes, PANEL_REFLECTION_ADD_PATH, { text: 'First line of the day.' });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'application/json; charset=utf-8');
  const created = (await first.json()) as PanelReflectionAddResponse;
  assert.equal(typeof created.reflection.id, 'number');
  assert.equal(created.reflection.kind, 'day');
  assert.equal(created.reflection.period_key, today, 'adding is dated to the current Dayflow day');
  assert.equal(created.reflection.body, 'First line of the day.');
  assert.equal(typeof created.reflection.updated_at, 'string');

  const second = await postRoute(routes, PANEL_REFLECTION_ADD_PATH, { text: 'Second line of the day.' });
  assert.equal(second.status, 200);
  const appended = (await second.json()) as PanelReflectionAddResponse;
  assert.equal(appended.reflection.id, created.reflection.id, 'a second add rewrites the same day row');
  assert.equal(appended.reflection.body, 'First line of the day.\nSecond line of the day.');

  // The store keeps one row per period, so the insights list holds one entry.
  const insights = buildPanelInsights(runtime);
  assert.equal(insights.reflections.length, 1);
  assert.equal(insights.reflections[0]?.period_key, today);
  assert.equal(insights.reflections[0]?.body, 'First line of the day.\nSecond line of the day.');
});

test('the add routes reject blank, missing, overlong, and malformed input with a 400 JSON error', async () => {
  const journalPath = journalFile('add-invalid');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const routes = fakeHost(runtime);

  const invalid: { path: string; body: unknown; label: string }[] = [
    { path: PANEL_TASK_ADD_PATH, body: { title: '   ' }, label: 'a blank task title' },
    { path: PANEL_TASK_ADD_PATH, body: {}, label: 'a missing task title' },
    { path: PANEL_TASK_ADD_PATH, body: { title: 'x'.repeat(201) }, label: 'an overlong task title' },
    { path: PANEL_MEMORY_ADD_PATH, body: { text: '' }, label: 'empty memory text' },
    { path: PANEL_MEMORY_ADD_PATH, body: { text: 'x'.repeat(4001) }, label: 'overlong memory text' },
    { path: PANEL_REFLECTION_ADD_PATH, body: {}, label: 'a missing reflection text' },
    { path: PANEL_REFLECTION_ADD_PATH, body: { text: 'x'.repeat(4001) }, label: 'overlong reflection text' },
  ];
  for (const entry of invalid) {
    const response = await postRoute(routes, entry.path, entry.body);
    assert.equal(response.status, 400, `${entry.label} is rejected as invalid input`);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    const error = (await response.json()) as { error: string };
    assert.equal(typeof error.error, 'string');
    assert.ok(error.error.length > 0, `${entry.label} carries an explanation`);
  }

  // A body that is not JSON at all is the same caller mistake, not a 500.
  for (const path of [PANEL_TASK_ADD_PATH, PANEL_MEMORY_ADD_PATH, PANEL_REFLECTION_ADD_PATH]) {
    const response = await postRoute(routes, path, 'this is not json');
    assert.equal(response.status, 400, `${path} rejects a malformed JSON body`);
    const error = (await response.json()) as { error: string };
    assert.match(error.error, /JSON/i);
  }

  assert.equal(existsSync(journalPath), false, 'a rejected add never creates nor writes the journal');
});

test('the task scan route previews matching owned-journal activity for a new task', async () => {
  const journalPath = journalFile('scan');
  const window = dayWindowContaining(new Date());
  const start = new Date(window.start.getTime() + 9 * 3_600_000);
  const end = new Date(start.getTime() + 45 * 60_000);
  const db = openJournal(journalPath);
  let taskId = 0;
  let unrelatedTaskId = 0;
  let activityId = 0;
  try {
    taskId = createLongTask(db, { title: 'Ship the release checklist' }).id;
    unrelatedTaskId = createLongTask(db, { title: 'Water the plants' }).id;
    const inserted = db
      .prepare(
        `INSERT INTO activities
           (source_id, source_key, start_ts, end_ts, day, title, summary, category, metadata, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        'manual',
        'scan-hit',
        Math.floor(start.getTime() / 1000),
        Math.floor(end.getTime() / 1000),
        window.dayKey,
        'Release checklist review',
        'Went over the release checklist before shipping.',
        'Work',
        JSON.stringify({ appSites: { primary: 'github.com' } }),
      );
    activityId = Number(inserted.lastInsertRowid);
  } finally {
    db.close();
  }

  const runtime = ownedRuntime(journalPath);
  const routes = fakeHost(runtime);
  const response = await postRoute(routes, PANEL_TASK_SCAN_PATH, { task_id: taskId, days: 7 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = (await response.json()) as PanelTaskScanResponse;
  assert.equal(payload.scan.task_id, taskId);
  assert.equal(payload.scan.title, 'Ship the release checklist');
  assert.equal(payload.scan.total_days, 1);
  assert.equal(payload.scan.total_minutes, 45);
  assert.equal(payload.scan.days.length, 1);
  const hit = payload.scan.days[0];
  assert.ok(hit);
  assert.equal(hit.day, window.dayKey);
  assert.equal(hit.minutes, 45);
  assert.deepEqual(hit.activity_ids, [activityId]);
  assert.ok(hit.score >= 2, 'a title keyword match reaches the minimum score');
  assert.ok(
    hit.reasons.some((reason) => reason.startsWith('keyword:')),
    'the match carries an explainable reason',
  );
  assert.deepEqual(hit.titles, ['Release checklist review']);

  // A task whose title matches nothing still answers, with an empty preview: a
  // scan never fails just because the history holds no evidence.
  const emptyResponse = await postRoute(routes, PANEL_TASK_SCAN_PATH, { task_id: unrelatedTaskId, days: 7 });
  assert.equal(emptyResponse.status, 200);
  const empty = (await emptyResponse.json()) as PanelTaskScanResponse;
  assert.deepEqual(empty.scan.days, []);
  assert.equal(empty.scan.total_days, 0);
  assert.equal(empty.scan.total_minutes, 0);

  // The scan is a preview: it must not attach anything to the task.
  const insights = buildPanelInsights(runtime);
  assert.equal(insights.tasks.find((task) => task.id === taskId)?.session_days, 0);
  assert.equal(insights.tasks.find((task) => task.id === taskId)?.total_minutes, 0);

  // An unknown task is a 404, not a silent empty scan.
  const missing = await postRoute(routes, PANEL_TASK_SCAN_PATH, { task_id: 999_999, days: 7 });
  assert.equal(missing.status, 404);

  const invalid: { body: unknown; label: string }[] = [
    { body: {}, label: 'a missing task id' },
    { body: { task_id: 0 }, label: 'a non-positive task id' },
    { body: { task_id: taskId, days: 0 }, label: 'a zero-day scan' },
    { body: { task_id: taskId, days: 91 }, label: 'an over-long scan' },
  ];
  for (const entry of invalid) {
    const bad = await postRoute(routes, PANEL_TASK_SCAN_PATH, entry.body);
    assert.equal(bad.status, 400, `${entry.label} is rejected as invalid input`);
    const error = (await bad.json()) as { error: string };
    assert.equal(typeof error.error, 'string');
  }
});

test('the task link route attaches confirmed days and replaces a repeated day', async () => {
  const journalPath = journalFile('link');
  const db = openJournal(journalPath);
  let taskId = 0;
  try {
    taskId = createLongTask(db, { title: 'Ship the release' }).id;
  } finally {
    db.close();
  }
  const runtime = ownedRuntime(journalPath);
  const routes = fakeHost(runtime);
  const day = todayKey();

  const first = await postRoute(routes, PANEL_TASK_LINK_PATH, {
    task_id: taskId,
    days: [{ day, minutes: 45, activity_ids: [1, 2] }],
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const created = (await first.json()) as PanelTaskLinkResponse;
  assert.equal(created.task.id, taskId);
  assert.equal(created.task.title, 'Ship the release');
  assert.equal(created.task.total_minutes, 45);
  assert.equal(created.task.session_days, 1);
  assert.equal(created.task.last_session_day, day);
  assert.deepEqual(created.linked_days, [day]);

  // Linking the same day again replaces that day's session instead of adding a
  // second one, so a retried or re-confirmed link cannot inflate the task.
  const second = await postRoute(routes, PANEL_TASK_LINK_PATH, {
    task_id: taskId,
    days: [{ day, minutes: 30, activity_ids: [3] }],
  });
  assert.equal(second.status, 200);
  const replaced = (await second.json()) as PanelTaskLinkResponse;
  assert.equal(replaced.task.total_minutes, 30);
  assert.equal(replaced.task.session_days, 1);
  assert.deepEqual(replaced.linked_days, [day]);
  const insights = buildPanelInsights(runtime);
  assert.equal(insights.tasks[0]?.total_minutes, 30);

  // The store keeps exactly one row for the day, with the replaced evidence.
  const stored = openJournal(journalPath);
  try {
    const row = stored
      .prepare('SELECT minutes, activity_ids_json FROM long_task_sessions WHERE task_id = ? AND day = ?')
      .get(taskId, day) as { minutes: number; activity_ids_json: string };
    assert.equal(row.minutes, 30);
    assert.deepEqual(JSON.parse(row.activity_ids_json) as number[], [3]);
  } finally {
    stored.close();
  }

  const missing = await postRoute(routes, PANEL_TASK_LINK_PATH, {
    task_id: 999_999,
    days: [{ day, minutes: 5, activity_ids: [] }],
  });
  assert.equal(missing.status, 404);

  const invalid: { body: unknown; label: string }[] = [
    { body: {}, label: 'a missing task id' },
    { body: { task_id: taskId, days: [] }, label: 'an empty day list' },
    { body: { task_id: taskId, days: [{ day, minutes: -5, activity_ids: [] }] }, label: 'negative minutes' },
    { body: { task_id: taskId, days: [{ day: '2026-02-30', minutes: 5, activity_ids: [] }] }, label: 'an impossible day' },
    { body: { task_id: taskId, days: [{ day, minutes: 5, activity_ids: [-1] }] }, label: 'a negative activity id' },
    { body: { task_id: taskId, days: [{ day, minutes: 5 }] }, label: 'missing activity ids' },
  ];
  for (const entry of invalid) {
    const bad = await postRoute(routes, PANEL_TASK_LINK_PATH, entry.body);
    assert.equal(bad.status, 400, `${entry.label} is rejected as invalid input`);
    const error = (await bad.json()) as { error: string };
    assert.equal(typeof error.error, 'string');
  }
});
