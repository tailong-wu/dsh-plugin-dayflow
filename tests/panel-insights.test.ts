/**
 * Insights host end-to-end: the payload builder reads the owned journal, and the
 * exact Fetch route `/api/dayflow/insights` serves that payload to the panel.
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
  PANEL_MONTH_PATH,
  PANEL_WEEK_PATH,
} from '../src/panel-contract.js';
import type { PanelInsights } from '../src/panel-contract.js';
import { buildPanelInsights, registerPanelRoutes } from '../src/panel.js';
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

test('the insights route coexists with the five panel routes and answers JSON', async () => {
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

  // The six exact Fetch routes share the registry without replacing each other.
  assert.deepEqual(
    [...routes.keys()].sort(),
    [PANEL_DAY_PATH, PANEL_MONTH_PATH, PANEL_WEEK_PATH, PANEL_ICON_PATH, PANEL_CONFIG_PATH, PANEL_INSIGHTS_PATH].sort(),
  );
  for (const path of routes.keys()) {
    assert.deepEqual([...(routes.get(path)?.methods ?? [])], ['GET'], `${path} only answers GET`);
    assert.equal(routes.get(path)?.requestBody, 'buffered', `${path} buffers its request body`);
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
