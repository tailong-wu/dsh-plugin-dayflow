/**
 * Insights host end-to-end: the payload builder reads the owned journal, and the
 * exact Fetch routes `/api/dayflow/insights`, `/api/dayflow/analysis/status`,
 * `/api/dayflow/automation/status`, and the write routes behind the view serve
 * and grow that journal.
 *
 * The builder must be read-only in the strongest sense: a fresh install (no
 * journal file) yields five empty lists without creating the file, and repeated
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
import type {
  PanelAnalysisStatus,
  PanelAutomationStatus,
  PanelAutomationStatusResponse,
  PanelCapturePermission,
  PanelCaptureStatusResponse,
  PanelError,
  PanelInsights,
  PanelMemoryAddResponse,
  PanelReflectionAddResponse,
  PanelReviewDecisionResponse,
  PanelTaskAddResponse,
  PanelTaskAttachResponse,
  PanelTaskDetachResponse,
  PanelTaskLinkResponse,
  PanelTaskScanResponse,
} from '../src/panel-contract.js';
import { buildPanelInsights, registerPanelRoutes } from '../src/panel.js';
import {
  analysisJobKey,
  completeAnalysisJob,
  createAnalysisJob,
  failAnalysisJob,
  skipAnalysisJob,
  startAnalysisJob,
} from '../src/analyse/jobs.js';
import type { ResolvedConfig } from '../src/config.js';
import { readCaptureState, recordScreenshotRow, writeCaptureState } from '../src/capture/state.js';
import { dayWindowContaining } from '../src/day.js';
import { DayflowError } from '../src/errors.js';
import { openJournal } from '../src/journal.js';
import { addMemoryClaim, listMemoryClaims, supersedeMemoryClaim } from '../src/memory.js';
import { decideReviewItem, listReviewItems, proposeReviewItem } from '../src/review.js';
import type { ReviewItemPayload, ReviewProposalInput, ReviewStatus, ReviewToolPayload } from '../src/review.js';
import { saveReflection } from '../src/reflections.js';
import { attachTaskSession, createLongTask, getLongTask, listLongTasks, updateLongTaskStatus } from '../src/tasks.js';
import { reviewTools } from '../src/tools/review.js';
import { executionContext, makeRuntime, toolMap, toolNamed } from './helpers.js';

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

/** The options the capture, analysis, and automation status routes accept from the host composition. */
interface PanelRouteOptions {
  capturePermission?: () => Promise<PanelCapturePermission>;
  analysisStatus?: () => PanelAnalysisStatus['analysis'] | Promise<PanelAnalysisStatus['analysis']>;
  analysisWorker?: () => { running: boolean };
  automationStatus?: () => PanelAutomationStatus | Promise<PanelAutomationStatus>;
}

/** A cordis-shaped host whose only connection member is the Fetch registry. */
function fakeHost(
  runtime: ReturnType<typeof makeRuntime>,
  options: PanelRouteOptions = {},
): Map<string, RegisteredRoute> {
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
  registerPanelRoutes(ctx as never, runtime, options);
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

/** GET the native capture status route the way the browser would. */
async function fetchCaptureStatus(routes: Map<string, RegisteredRoute>): Promise<Response> {
  const route = routes.get(PANEL_CAPTURE_STATUS_PATH);
  assert.ok(route, `route ${PANEL_CAPTURE_STATUS_PATH} is not registered`);
  return route.fetch(new Request(`http://127.0.0.1${PANEL_CAPTURE_STATUS_PATH}`));
}

/** GET the analysis status route the way the browser would. */
async function fetchAnalysisStatus(routes: Map<string, RegisteredRoute>): Promise<Response> {
  const route = routes.get(PANEL_ANALYSIS_STATUS_PATH);
  assert.ok(route, `route ${PANEL_ANALYSIS_STATUS_PATH} is not registered`);
  return route.fetch(new Request(`http://127.0.0.1${PANEL_ANALYSIS_STATUS_PATH}`));
}

/** GET the automation status route the way the browser would. */
async function fetchAutomationStatus(routes: Map<string, RegisteredRoute>): Promise<Response> {
  const route = routes.get(PANEL_AUTOMATION_STATUS_PATH);
  assert.ok(route, `route ${PANEL_AUTOMATION_STATUS_PATH} is not registered`);
  return route.fetch(new Request(`http://127.0.0.1${PANEL_AUTOMATION_STATUS_PATH}`));
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

/**
 * The profile's capture block with only the master switch varied, so the
 * status assertions do not depend on the helper's defaults.
 * @param enabled - the master switch.
 * @returns the capture configuration.
 */
function captureConfig(enabled: boolean): ResolvedConfig['capture'] {
  return {
    enabled,
    intervalSeconds: 45,
    idleSeconds: 120,
    maxFramesPerDay: 1200,
    keepFramesDays: 0,
    pauseApps: [],
    displays: 'main',
  };
}

/** SHA-256 of one file's bytes, used to prove a read changed nothing. */
function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * The profile's analysis block with only the fields a test needs varied, so
 * the status assertions do not depend on the helper's defaults.
 * @param overrides - the analysis fields to change.
 * @returns the analysis configuration.
 */
function analysisConfig(overrides: Partial<ResolvedConfig['analysis']> = {}): ResolvedConfig['analysis'] {
  return { ...makeRuntime('/nonexistent/dayflow/chunks.sqlite').config.analysis, ...overrides };
}

test('a missing journal answers five empty lists without creating the journal', async () => {
  const journalPath = journalFile('missing');
  assert.equal(existsSync(journalPath), false);
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });

  const insights = buildPanelInsights(runtime);
  assert.deepEqual(insights, { tasks: [], review: [], memory: [], reflections: [], briefs: [] });
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
    briefs: [],
  });
  assert.equal(existsSync(journalPath), false, 'serving the route must not create the journal');
});

test('the insights payload carries the stored briefs, and an empty journal answers []', () => {
  const journalPath = journalFile('briefs-payload');
  const db = openJournal(journalPath);
  try {
    db.prepare(
      `INSERT INTO briefs (kind, period_key, title, body, model, payload_json, source_id, source_key,
                           created_at, updated_at)
       VALUES ('week', '2026-11-16', 'Week of 2026-11-16', 'The week in one page.', 'model-x', ?,
               'native', 'automation:week:2026-11-16', '2026-11-23 06:00:00', '2026-11-23 06:00:00')`,
    ).run(JSON.stringify({ memory_health: { findings: 1, proposals: 1, summary: 'one finding.' } }));
    db.prepare(
      `INSERT INTO daily_standup_entries
         (source_id, source_key, standup_day, payload_json, is_deleted, created_at, updated_at)
       VALUES ('native', 'automation:day:2026-11-20', '2026-11-20', ?, 0,
               '2026-11-21 04:00:00', '2026-11-21 04:00:00')`,
    ).run(JSON.stringify({ highlights: [{ text: 'Landed the reading view' }] }));
  } finally {
    db.close();
  }

  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const insights = buildPanelInsights(runtime);
  assert.ok(Array.isArray(insights.briefs), 'briefs is always an array');
  assert.deepEqual(
    insights.briefs.map((entry) => [entry.kind, entry.period_key]),
    [
      ['day', '2026-11-20'],
      ['week', '2026-11-16'],
    ],
  );
  assert.deepEqual(insights.briefs[1]?.memory_health, { findings: 1, proposals: 1, summary: 'one finding.' });

  // No journal is a fresh install: an empty array, and no file is created.
  const freshPath = journalFile('briefs-fresh');
  const fresh = buildPanelInsights(makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath: freshPath }));
  assert.deepEqual(fresh.briefs, []);
  assert.equal(existsSync(freshPath), false, 'reading briefs must not create the journal');
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

    // Briefs: the weekly close's row (with the lint digest payload) and a native
    // standup for a day without a brief row. Both must reach the same list.
    db.prepare(
      `INSERT INTO briefs (kind, period_key, title, body, model, payload_json, source_id, source_key, created_at, updated_at)
       VALUES ('week', '2026-11-16', 'Week of 2026-11-16', ?, 'analysis-model-x', ?, 'native',
               'automation:week:2026-11-16', '2026-11-23 06:00:00', '2026-11-23 06:00:00')`,
    ).run(
      'A week of journal read paths.\n\nMemory health: nothing to report.',
      JSON.stringify({ memory_health: { findings: 2, proposals: 1, summary: 'nothing to report.' } }),
    );
    db.prepare(
      `INSERT INTO daily_standup_entries
         (source_id, source_key, standup_day, payload_json, is_deleted, created_at, updated_at)
       VALUES ('native', 'automation:day:2026-11-24', '2026-11-24', ?, 0, '2026-11-25 04:00:00', '2026-11-25 04:00:00')`,
    ).run(JSON.stringify({ highlights: [{ text: 'Shipped the briefs view' }], blockersBody: 'None' }));
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
    // The day-by-day sessions let the panel offer one Unlink per attached day.
    sessions: [
      { day: '2026-11-23', minutes: 30 },
      { day: '2026-11-24', minutes: 45 },
    ],
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

  // Briefs: the week row keeps its digest, the standup normalises to a day
  // entry, and the newest period sorts first.
  assert.equal(insights.briefs.length, 2);
  assert.deepEqual(insights.briefs[0], {
    kind: 'day',
    period_key: '2026-11-24',
    title: 'Standup · 2026-11-24',
    body: '- Shipped the briefs view\n- None',
    updated_at: '2026-11-25 04:00:00',
  });
  assert.deepEqual(insights.briefs[1], {
    kind: 'week',
    period_key: '2026-11-16',
    title: 'Week of 2026-11-16',
    body: 'A week of journal read paths.\n\nMemory health: nothing to report.',
    model: 'analysis-model-x',
    updated_at: '2026-11-23 06:00:00',
    memory_health: { findings: 2, proposals: 1, summary: 'nothing to report.' },
  });
});

test('the insights route coexists with the other panel routes and answers JSON', async () => {
  const journalPath = journalFile('route');
  const db = openJournal(journalPath);
  let taskId = 0;
  try {
    taskId = createLongTask(db, { title: 'Serve the insights payload', description: '' }).id;
    saveReflection(db, { kind: 'day', period: '2026-11-24', body: 'The route answer is stable.' });
    // The same single GET carries the stored briefs: no second route, no second request.
    db.prepare(
      `INSERT INTO briefs (kind, period_key, title, body, source_id, source_key)
       VALUES ('week', '2026-11-16', 'Week of 2026-11-16', 'The route carries the brief.', 'native',
               'automation:week:2026-11-16')`,
    ).run();
  } finally {
    db.close();
  }

  assert.equal(PANEL_INSIGHTS_PATH, '/api/dayflow/insights');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const routes = fakeHost(runtime);

  // The eighteen exact Fetch routes share the registry without replacing each
  // other: nine reads plus the nine writes that back the inline add rows, the
  // post-add history scan/link pair, the native capture pause flag, and the
  // three interactive-insights writes (review decision, attach, detach).
  const readPaths = [
    PANEL_DAY_PATH,
    PANEL_MONTH_PATH,
    PANEL_WEEK_PATH,
    PANEL_ICON_PATH,
    PANEL_CONFIG_PATH,
    PANEL_INSIGHTS_PATH,
    PANEL_CAPTURE_STATUS_PATH,
    PANEL_ANALYSIS_STATUS_PATH,
    PANEL_AUTOMATION_STATUS_PATH,
  ];
  const writePaths = [
    PANEL_TASK_ADD_PATH,
    PANEL_MEMORY_ADD_PATH,
    PANEL_REFLECTION_ADD_PATH,
    PANEL_TASK_SCAN_PATH,
    PANEL_TASK_LINK_PATH,
    PANEL_CAPTURE_PAUSE_PATH,
    PANEL_REVIEW_DECIDE_PATH,
    PANEL_TASK_ATTACH_PATH,
    PANEL_TASK_DETACH_PATH,
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
  assert.equal(payload.briefs.length, 1, 'the one GET carries the stored brief');
  assert.equal(payload.briefs[0]?.kind, 'week');
  assert.equal(payload.briefs[0]?.period_key, '2026-11-16');
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

test('the capture status route reports capture off without creating the journal', async () => {
  const journalPath = journalFile('capture-off');
  assert.equal(existsSync(journalPath), false);
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });

  const response = await fetchCaptureStatus(fakeHost(runtime));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = (await response.json()) as PanelCaptureStatusResponse;
  assert.deepEqual(payload.capture, {
    enabled: false,
    paused: false,
    permission: 'unknown',
    analysis_enabled: true,
    analysis_consent: 'none',
    frames_today: 0,
  });
  assert.equal(existsSync(journalPath), false, 'a status read must not create the journal');
});

test('the capture status route reads the pause flag, today frame count, and injected permission', async () => {
  const journalPath = journalFile('capture-on');
  const today = todayKey();
  // Counts follow the frame timestamps inside the 04:00-to-04:00 window, so the
  // rows must carry instants that really fall in today's window.
  const window = dayWindowContaining(new Date());
  const todayFrameAt = window.start.getTime() + 60_000;
  const yesterdayFrameAt = window.start.getTime() - 60_000;
  const db = openJournal(journalPath);
  try {
    writeCaptureState(db, { paused: true, lastFrameAt: todayFrameAt });
    recordScreenshotRow(db, { sourceKey: `${today}-frame-1`, capturedAt: todayFrameAt, day: today });
    recordScreenshotRow(db, { sourceKey: `${today}-frame-2`, capturedAt: todayFrameAt + 1_000, day: today });
    // A frame from an earlier Dayflow day must not count towards today.
    recordScreenshotRow(db, {
      sourceKey: 'yesterday-frame',
      capturedAt: yesterdayFrameAt,
      day: shiftDayKey(today, -1),
    });
  } finally {
    db.close();
  }

  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', {
    journalPath,
    capture: captureConfig(true),
  });
  const routes = fakeHost(runtime, { capturePermission: async () => 'granted' });
  const response = await fetchCaptureStatus(routes);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()) as PanelCaptureStatusResponse, {
    capture: {
      enabled: true,
      paused: true,
      permission: 'granted',
      analysis_enabled: true,
      analysis_consent: 'none',
      frames_today: 2,
      last_frame_at: todayFrameAt,
    },
  });
});

test('a throwing capture permission probe reads as unknown instead of failing the route', async () => {
  const journalPath = journalFile('capture-probe-fails');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const routes = fakeHost(runtime, {
    capturePermission: async () => {
      throw new Error('the permission probe failed');
    },
  });

  const response = await fetchCaptureStatus(routes);
  assert.equal(response.status, 200, 'a broken probe is not a panel failure');
  const payload = (await response.json()) as PanelCaptureStatusResponse;
  assert.equal(payload.capture.permission, 'unknown');
  assert.equal(payload.capture.enabled, false);
});

test('the capture pause route persists the pause flag and answers with the reread status', async () => {
  const journalPath = journalFile('capture-pause');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', {
    journalPath,
    capture: captureConfig(true),
  });
  const routes = fakeHost(runtime, { capturePermission: async () => 'granted' });
  assert.equal(existsSync(journalPath), false, 'the first pause write creates the journal');

  const paused = await postRoute(routes, PANEL_CAPTURE_PAUSE_PATH, { paused: true });
  assert.equal(paused.status, 200);
  assert.equal(paused.headers.get('content-type'), 'application/json; charset=utf-8');
  const pausedPayload = (await paused.json()) as PanelCaptureStatusResponse;
  assert.equal(pausedPayload.capture.paused, true);
  assert.equal(pausedPayload.capture.permission, 'granted');
  assert.equal(pausedPayload.capture.enabled, true);

  const pausedDb = openJournal(journalPath);
  try {
    assert.equal(readCaptureState(pausedDb).paused, true, 'the pause flag is stored in capture_state');
  } finally {
    pausedDb.close();
  }

  const resumed = await postRoute(routes, PANEL_CAPTURE_PAUSE_PATH, { paused: false });
  assert.equal(resumed.status, 200);
  assert.equal(((await resumed.json()) as PanelCaptureStatusResponse).capture.paused, false);
  const resumedDb = openJournal(journalPath);
  try {
    assert.equal(readCaptureState(resumedDb).paused, false, 'resuming clears the stored pause flag');
  } finally {
    resumedDb.close();
  }

  const invalid: { body: unknown; label: string }[] = [
    { body: {}, label: 'a missing pause flag' },
    { body: { paused: 'yes' }, label: 'a string pause flag' },
    { body: { paused: 1 }, label: 'a numeric pause flag' },
    { body: 'this is not json', label: 'a malformed JSON body' },
  ];
  for (const entry of invalid) {
    const bad = await postRoute(routes, PANEL_CAPTURE_PAUSE_PATH, entry.body);
    assert.equal(bad.status, 400, `${entry.label} is rejected as invalid input`);
    const error = (await bad.json()) as { error: string };
    assert.equal(typeof error.error, 'string');
  }
});

test('the analysis status route reports zeros without creating the journal', async () => {
  const journalPath = journalFile('analysis-off');
  assert.equal(existsSync(journalPath), false);
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });

  const response = await fetchAnalysisStatus(fakeHost(runtime));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()) as PanelAnalysisStatus, {
    analysis: {
      enabled: false,
      consent: 'none',
      intervalMinutes: 5,
      worker: 'stopped',
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      callsToday: 0,
      maxCallsPerDay: 120,
      tokensToday: { input: 0, output: 0 },
      dailyTokenBudget: 200_000,
      tokenBudgetExhausted: false,
      reason: 'capture-disabled',
    },
  });
  assert.equal(existsSync(journalPath), false, 'a status read must not create the journal');
});

test('the analysis status route reports the paused gate, the ledger, and the injected worker', async () => {
  const journalPath = journalFile('analysis-on');
  const day = todayKey();
  const base = Math.floor(Date.now() / 1_000) - 3_600;
  const db = openJournal(journalPath);
  try {
    writeCaptureState(db, { paused: true });
    const makeJob = (offset: number) =>
      createAnalysisJob(db, {
        jobKey: analysisJobKey(day, base + offset),
        day,
        windowStartTs: base + offset,
        windowEndTs: base + offset + 600,
      });
    makeJob(0);
    startAnalysisJob(db, makeJob(1_000).id);
    const completed = makeJob(2_000);
    startAnalysisJob(db, completed.id);
    completeAnalysisJob(db, completed.id, { model: 'test-model', inputTokens: 1_234, outputTokens: 234 });
    const failed = makeJob(3_000);
    startAnalysisJob(db, failed.id);
    failAnalysisJob(db, failed.id, 'the model said no');
    skipAnalysisJob(db, makeJob(4_000).id, 'consent:none');
    // A job from an earlier Dayflow day must not leak into today's ledger.
    const yesterday = shiftDayKey(day, -1);
    const earlier = createAnalysisJob(db, {
      jobKey: analysisJobKey(yesterday, base),
      day: yesterday,
      windowStartTs: base,
      windowEndTs: base + 600,
    });
    startAnalysisJob(db, earlier.id);
  } finally {
    db.close();
  }

  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', {
    journalPath,
    capture: captureConfig(true),
    analysis: analysisConfig({ consent: 'cloud', provider: 'openai', model: 'test-model' }),
  });
  const routes = fakeHost(runtime, { analysisWorker: () => ({ running: true }) });

  const response = await fetchAnalysisStatus(routes);
  assert.equal(response.status, 200);
  const body = (await response.json()) as PanelAnalysisStatus;
  const { lastJobAt, ...rest } = body.analysis;
  assert.equal(typeof lastJobAt, 'number', 'today holds jobs, so the last job time is present');
  assert.deepEqual(rest, {
    enabled: true,
    consent: 'cloud',
    intervalMinutes: 5,
    worker: 'running',
    queued: 1,
    running: 1,
    completed: 1,
    failed: 1,
    skipped: 1,
    // Only a started job is a call: queued and skipped jobs have attempts 0.
    callsToday: 3,
    maxCallsPerDay: 120,
    tokensToday: { input: 1_234, output: 234 },
    dailyTokenBudget: 200_000,
    tokenBudgetExhausted: false,
    reason: 'paused',
  });

  // Resuming capture clears the gate: allowed analysis carries no `reason` at all.
  const resumedDb = openJournal(journalPath);
  try {
    writeCaptureState(resumedDb, { paused: false });
  } finally {
    resumedDb.close();
  }
  const resumed = (await (await fetchAnalysisStatus(routes)).json()) as PanelAnalysisStatus;
  assert.equal('reason' in resumed.analysis, false, 'allowed analysis reports no blocked reason');
});

test('the analysis status route serves an injected builder without touching the journal', async () => {
  const journalPath = journalFile('analysis-injected');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const payload: PanelAnalysisStatus = {
    analysis: {
      enabled: true,
      consent: 'local',
      intervalMinutes: 3,
      worker: 'running',
      queued: 2,
      running: 0,
      completed: 4,
      failed: 1,
      skipped: 0,
      callsToday: 5,
      maxCallsPerDay: 60,
      tokensToday: { input: 100, output: 20 },
      dailyTokenBudget: 50_000,
      tokenBudgetExhausted: false,
      lastJobAt: 1_800_000_000_000,
    },
  };
  const routes = fakeHost(runtime, { analysisStatus: () => payload.analysis });

  const response = await fetchAnalysisStatus(routes);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()) as PanelAnalysisStatus, payload);
  assert.equal(existsSync(journalPath), false, 'an injected builder still must not create the journal');
});

// ---------------------------------------------------------------------------
// 0.7.4 automation status: the scheduled close line's read-only route
// ---------------------------------------------------------------------------

test('the automation status route derives the schedule from the profile without creating the journal', async () => {
  const journalPath = journalFile('automation-default');
  assert.equal(existsSync(journalPath), false);
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const routes = fakeHost(runtime);

  const response = await fetchAutomationStatus(routes);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  // Without an injected scheduler the route reports the profile's schedule and
  // no run: enabled from `automation.enabled`, the 04:00/Monday defaults, and
  // the shipped two-day catch-up window.
  assert.deepEqual((await response.json()) as PanelAutomationStatusResponse, {
    automation: {
      enabled: true,
      running: false,
      dailyAt: '04:00',
      weeklyOn: 'monday',
      catchUpDays: 2,
    },
  });
  assert.equal(existsSync(journalPath), false, 'a status read must not create the journal');
});

test('a disabled automation block answers the same schedule with enabled false', async () => {
  const journalPath = journalFile('automation-disabled');
  // Spread the runtime's own block so the test only varies the fields it means
  // to vary and keeps compiling as `automation` grows keys (e.g. `catchUpDays`).
  const base = makeRuntime('/nonexistent/dayflow/chunks.sqlite');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', {
    journalPath,
    automation: { ...base.config.automation, enabled: false, dailyAt: '05:30', weeklyOn: 'friday' },
  });
  const payload = (await (await fetchAutomationStatus(fakeHost(runtime))).json()) as PanelAutomationStatusResponse;
  const { automation } = payload;
  assert.equal(automation.enabled, false);
  assert.equal(automation.running, false);
  assert.equal(automation.dailyAt, '05:30');
  assert.equal(automation.weeklyOn, 'friday');
  // The catch-up window is read from the block (the shipped default is two
  // days); only its presence and sanity matter here, not the exact default.
  assert.ok(Number.isSafeInteger(automation.catchUpDays));
  assert.ok(automation.catchUpDays >= 1);
  assert.equal(automation.lastDayClose, undefined);
  assert.equal(automation.nextDayCloseAt, undefined);
});

test('the automation status route serves an injected scheduler status', async () => {
  const journalPath = journalFile('automation-injected');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const payload: PanelAutomationStatusResponse = {
    automation: {
      enabled: true,
      running: true,
      dailyAt: '04:00',
      weeklyOn: 'monday',
      catchUpDays: 3,
      lastDayClose: { day: '2026-11-26', status: 'failed', at: 1_800_000_000_000 },
      lastWeekClose: { monday: '2026-11-23', status: 'ok', at: 1_800_000_100_000 },
      nextDayCloseAt: 1_800_100_000_000,
    },
  };
  const routes = fakeHost(runtime, { automationStatus: () => payload.automation });

  const response = await fetchAutomationStatus(routes);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()) as PanelAutomationStatusResponse, payload);
  assert.equal(existsSync(journalPath), false, 'an injected builder still must not create the journal');
});

test('a failing automation status builder answers a JSON error', async () => {
  const journalPath = journalFile('automation-error');
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath });
  const routes = fakeHost(runtime, {
    automationStatus: () => {
      throw new DayflowError('The scheduler is not available.', 'database_error');
    },
  });

  const response = await fetchAutomationStatus(routes);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual((await response.json()) as PanelError, { error: 'The scheduler is not available.' });
  assert.equal(existsSync(journalPath), false, 'a failed read must not create the journal');
});

// ---------------------------------------------------------------------------
// 0.7.3 interactive insights: review decisions and task session attach/detach
// ---------------------------------------------------------------------------

/** Seed one review proposal in the owned journal and return its id. */
function seedReviewItem(journalPath: string, input: ReviewProposalInput): number {
  const db = openJournal(journalPath);
  try {
    const result = proposeReviewItem(db, input);
    assert.equal(result.dropped, false);
    assert.ok(result.item);
    return result.item.id;
  } finally {
    db.close();
  }
}

/** Every stored review item, whatever its status. */
function allReviewItems(journalPath: string): ReviewItemPayload[] {
  const statuses: ReviewStatus[] = ['proposed', 'kept', 'discarded', 'accepted', 'rejected'];
  const db = openJournal(journalPath);
  try {
    return statuses.flatMap((status) => listReviewItems(db, { status }));
  } finally {
    db.close();
  }
}

/** One stored review item by id, read back from the journal. */
function storedReviewItem(journalPath: string, id: number): ReviewItemPayload {
  const item = allReviewItems(journalPath).find((row) => row.id === id);
  assert.ok(item, `review item ${String(id)} is stored`);
  return item;
}

/** Every memory claim in the owned journal. */
function storedClaims(journalPath: string): ReturnType<typeof listMemoryClaims> {
  const db = openJournal(journalPath);
  try {
    return listMemoryClaims(db);
  } finally {
    db.close();
  }
}

/** Seed one long task and return its id. */
function seedTask(journalPath: string, title: string): number {
  const db = openJournal(journalPath);
  try {
    return createLongTask(db, { title }).id;
  } finally {
    db.close();
  }
}

/** One stored long task with its sessions. */
function storedTask(journalPath: string, id: number): ReturnType<typeof getLongTask> {
  const db = openJournal(journalPath);
  try {
    return getLongTask(db, id);
  } finally {
    db.close();
  }
}

/** Seed one owned-journal activity inside a day and return its row id. */
function seedActivity(journalPath: string, day: string): number {
  const window = dayWindowContaining(new Date());
  assert.equal(window.dayKey, day, 'the seeded activity belongs to the requested day');
  const start = new Date(window.start.getTime() + 9 * 3_600_000);
  const end = new Date(start.getTime() + 45 * 60_000);
  const db = openJournal(journalPath);
  try {
    const inserted = db
      .prepare(
        `INSERT INTO activities
           (source_id, source_key, start_ts, end_ts, day, title, summary, category, metadata, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        'manual',
        `interactive-${day}`,
        Math.floor(start.getTime() / 1000),
        Math.floor(end.getTime() / 1000),
        day,
        'Ship the interactive insights',
        'Reviewed the panel decision flow.',
        'Work',
        JSON.stringify({ appSites: { primary: 'github.com' } }),
      );
    return Number(inserted.lastInsertRowid);
  } finally {
    db.close();
  }
}

/** Count one day's activity rows in the owned journal. */
function activityCount(journalPath: string, day: string): number {
  const db = openJournal(journalPath);
  try {
    const row = db.prepare('SELECT count(*) AS count FROM activities WHERE day = ?').get(day) as {
      count: number;
    };
    return row.count;
  } finally {
    db.close();
  }
}

/** The store a decision leaves behind, with write-time timestamps as booleans. */
interface DecisionStoreState {
  item: Record<string, unknown>;
  tasks: Record<string, unknown>[];
  claims: Record<string, unknown>[];
}

/** Project one decided journal into the fields both decision paths must agree on. */
function decisionStoreState(journalPath: string): DecisionStoreState {
  const statuses: ReviewStatus[] = ['proposed', 'kept', 'discarded', 'accepted', 'rejected'];
  const db = openJournal(journalPath);
  try {
    const items = statuses.flatMap((status) => listReviewItems(db, { status }));
    assert.equal(items.length, 1, 'the parity fixture holds exactly one review item');
    const item = items[0];
    assert.ok(item);
    const { decided_at, created_at, ...decidedFields } = item;
    return {
      item: { ...decidedFields, decided: decided_at !== undefined },
      tasks: listLongTasks(db).map((task) => {
        const { created_at, updated_at, accepted_at, ...fields } = task;
        return {
          ...fields,
          accepted: accepted_at !== undefined,
          updated: updated_at !== '',
        };
      }),
      claims: listMemoryClaims(db).map((claim) => {
        const { recorded_at, ...fields } = claim;
        return fields;
      }),
    };
  } finally {
    db.close();
  }
}

/**
 * Decide the same seeded item once through the panel route and once through the
 * `journal_review` tool, then return both stores and both answers.
 */
async function decideBothWays(
  seed: ReviewProposalInput,
  decision: 'keep' | 'accept',
): Promise<{
  routeReview: PanelReviewDecisionResponse['review'];
  toolValue: ReviewToolPayload;
  route: DecisionStoreState;
  tool: DecisionStoreState;
}> {
  const routeJournalPath = journalFile('parity-route');
  const toolJournalPath = journalFile('parity-tool');
  const routeId = seedReviewItem(routeJournalPath, seed);
  const toolId = seedReviewItem(toolJournalPath, seed);
  assert.equal(routeId, toolId, 'both journals hold the same seeded item id');

  const routes = fakeHost(
    makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath: routeJournalPath }),
  );
  const response = await postRoute(routes, PANEL_REVIEW_DECIDE_PATH, {
    id: routeId,
    decision,
    note: 'parity note',
    confirm: true,
  });
  assert.equal(response.status, 200);
  const routeReview = ((await response.json()) as PanelReviewDecisionResponse).review;

  const tools = toolMap(
    reviewTools(makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath: toolJournalPath })),
  );
  const toolValue = (await toolNamed(tools, 'journal_review').execute(
    { action: 'decide', id: toolId, decision, note: 'parity note', confirm: true },
    executionContext(),
  )) as ReviewToolPayload;
  assert.equal(toolValue.action, 'decide');

  return {
    routeReview,
    toolValue,
    route: decisionStoreState(routeJournalPath),
    tool: decisionStoreState(toolJournalPath),
  };
}

test('the review decision route records a keep and returns the memory claim it writes', async () => {
  const journalPath = journalFile('review-decide-keep');
  const id = seedReviewItem(journalPath, {
    kind: 'distillation',
    title: 'The shared composer keeps routes and tools in step',
    body: 'Both paths must write the same decision state.',
    confidence: 0.8,
    source_day: '2026-11-19',
  });
  const routes = fakeHost(makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath }));

  const response = await postRoute(routes, PANEL_REVIEW_DECIDE_PATH, {
    id,
    decision: 'keep',
    note: 'Keep it for the release ritual.',
    confirm: true,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = (await response.json()) as PanelReviewDecisionResponse;
  assert.equal(payload.review.item.id, id);
  assert.equal(payload.review.item.status, 'kept');
  assert.equal(payload.review.item.decision_note, 'Keep it for the release ritual.');
  assert.equal(payload.review.task, undefined, 'a kept distillation creates no task');
  const memory = payload.review.memory;
  assert.ok(memory, 'a kept distillation returns the claim it wrote');
  assert.equal(memory.kind, 'distillation');
  assert.equal(memory.subject, 'The shared composer keeps routes and tools in step');
  assert.equal(memory.observed_on, '2026-11-19');
  assert.equal(memory.source_review_item, id);

  // The write is in the store, not just the answer.
  assert.equal(storedReviewItem(journalPath, id).status, 'kept');
  assert.deepEqual(
    storedClaims(journalPath).map((claim) => claim.id),
    [memory.id],
  );
});

test('the review decision route accepts a task proposal and returns the task it creates', async () => {
  const journalPath = journalFile('review-decide-accept');
  const id = seedReviewItem(journalPath, {
    kind: 'task_proposal',
    title: 'Ship the interactive insights',
    body: 'Decide and unlink without an agent turn.',
    confidence: 0.8,
    source_day: '2026-11-20',
  });
  const routes = fakeHost(makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath }));

  const response = await postRoute(routes, PANEL_REVIEW_DECIDE_PATH, {
    id,
    decision: 'accept',
    confirm: true,
  });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as PanelReviewDecisionResponse;
  assert.equal(payload.review.item.status, 'accepted');
  assert.equal(payload.review.memory, undefined, 'an accepted task proposal writes no claim');
  const task = payload.review.task;
  assert.ok(task, 'an accepted task proposal returns the long task it wrote');
  assert.equal(task.title, 'Ship the interactive insights');
  assert.equal(task.description, 'Decide and unlink without an agent turn.');
  assert.equal(task.origin, 'agent');
  assert.equal(task.review_item_id, id);
  assert.equal(task.status, 'active');

  const stored = storedTask(journalPath, task.id);
  assert.equal(stored.title, task.title);
  assert.equal(stored.review_item_id, id);
});

test('the review decision route demands confirm and validates its body before writing', async () => {
  const journalPath = journalFile('review-decide-invalid');
  const id = seedReviewItem(journalPath, {
    kind: 'distillation',
    title: 'Needs the user decision',
    confidence: 0.8,
  });
  const routes = fakeHost(makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath }));

  const invalid: { body: unknown; label: string }[] = [
    { body: { id, decision: 'keep' }, label: 'a missing confirm' },
    { body: { id, decision: 'keep', confirm: false }, label: 'confirm: false' },
    { body: { id, decision: 'keep', confirm: 'true' }, label: 'a string confirm' },
    { body: { decision: 'keep', confirm: true }, label: 'a missing id' },
    { body: { id: 0, decision: 'keep', confirm: true }, label: 'a non-positive id' },
    { body: { id: 1.5, decision: 'keep', confirm: true }, label: 'a fractional id' },
    { body: { id: 'one', decision: 'keep', confirm: true }, label: 'a string id' },
    { body: { id, decision: 'approve', confirm: true }, label: 'an unknown decision' },
    { body: { id, decision: 'keep', note: 42, confirm: true }, label: 'a non-string note' },
    { body: { id, decision: 'keep', forever: 'yes', confirm: true }, label: 'a non-boolean forever' },
    { body: 'this is not json', label: 'a malformed JSON body' },
  ];
  for (const entry of invalid) {
    const response = await postRoute(routes, PANEL_REVIEW_DECIDE_PATH, entry.body);
    assert.equal(response.status, 400, `${entry.label} is rejected as invalid input`);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    const error = (await response.json()) as { error: string };
    assert.equal(typeof error.error, 'string');
    assert.ok(error.error.length > 0, `${entry.label} carries an explanation`);
  }

  // None of the refused requests changed the open item.
  assert.equal(storedReviewItem(journalPath, id).status, 'proposed');
  assert.deepEqual(storedClaims(journalPath), []);
});

test('the review decision route answers 404 for an unknown item and 400 for a decided one', async () => {
  const journalPath = journalFile('review-decide-errors');
  const id = seedReviewItem(journalPath, {
    kind: 'distillation',
    title: 'Decide me once',
    confidence: 0.8,
  });
  const routes = fakeHost(makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath }));

  const missing = await postRoute(routes, PANEL_REVIEW_DECIDE_PATH, {
    id: 9_999,
    decision: 'keep',
    confirm: true,
  });
  assert.equal(missing.status, 404);
  assert.match(((await missing.json()) as { error: string }).error, /No review item with id 9999/);

  const kept = await postRoute(routes, PANEL_REVIEW_DECIDE_PATH, { id, decision: 'keep', confirm: true });
  assert.equal(kept.status, 200);

  const again = await postRoute(routes, PANEL_REVIEW_DECIDE_PATH, { id, decision: 'keep', confirm: true });
  assert.equal(again.status, 400, 'an item can be decided once');
  assert.match(((await again.json()) as { error: string }).error, /already decided/);
  assert.equal(storedReviewItem(journalPath, id).status, 'kept');

  // A decision that does not fit the kind is the same caller mistake.
  const taskItemId = seedReviewItem(journalPath, {
    kind: 'task_proposal',
    title: 'Accept me instead',
    confidence: 0.8,
  });
  const mismatch = await postRoute(routes, PANEL_REVIEW_DECIDE_PATH, {
    id: taskItemId,
    decision: 'keep',
    confirm: true,
  });
  assert.equal(mismatch.status, 400);
  assert.match(((await mismatch.json()) as { error: string }).error, /can only be accept or reject/);
  assert.equal(storedReviewItem(journalPath, taskItemId).status, 'proposed');
});

test('the review route hard-suppresses with forever and a soft discard may return', async () => {
  const journalPath = journalFile('review-decide-forever');
  const title = 'Hand-copy the changelog every release';
  const id = seedReviewItem(journalPath, {
    kind: 'distillation',
    title,
    confidence: 0.8,
    source_day: '2026-11-19',
  });
  const routes = fakeHost(makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath }));

  const forever = await postRoute(routes, PANEL_REVIEW_DECIDE_PATH, {
    id,
    decision: 'discard',
    forever: true,
    confirm: true,
  });
  assert.equal(forever.status, 200);
  const discarded = (await forever.json()) as PanelReviewDecisionResponse;
  assert.equal(discarded.review.item.status, 'discarded');
  assert.equal(discarded.review.item.suppression, 'hard');

  // Even materially new evidence never re-opens a hard suppression.
  const db = openJournal(journalPath);
  try {
    const suppressed = proposeReviewItem(db, {
      kind: 'distillation',
      title,
      confidence: 0.95,
      source_day: '2026-11-25',
    });
    assert.equal(suppressed.dropped, true);
    assert.equal(suppressed.reason, 'hard-suppressed');
  } finally {
    db.close();
  }
  assert.equal(allReviewItems(journalPath).length, 1, 'a suppressed proposal writes no row');

  // A soft discard may come back once the evidence is materially new.
  const softTitle = 'The first hour goes to email';
  const softId = seedReviewItem(journalPath, {
    kind: 'distillation',
    title: softTitle,
    confidence: 0.8,
    source_day: '2026-11-19',
  });
  const soft = await postRoute(routes, PANEL_REVIEW_DECIDE_PATH, {
    id: softId,
    decision: 'discard',
    confirm: true,
  });
  assert.equal(soft.status, 200);
  assert.equal(((await soft.json()) as PanelReviewDecisionResponse).review.item.suppression, 'soft');

  const softDb = openJournal(journalPath);
  try {
    const same = proposeReviewItem(softDb, {
      kind: 'distillation',
      title: softTitle,
      confidence: 0.8,
      source_day: '2026-11-19',
    });
    assert.equal(same.dropped, true);
    assert.equal(same.reason, 'soft-discarded');
    const next = proposeReviewItem(softDb, {
      kind: 'distillation',
      title: softTitle,
      confidence: 0.8,
      source_day: '2026-11-23',
    });
    assert.equal(next.dropped, false);
    assert.equal(next.item?.status, 'proposed');
  } finally {
    softDb.close();
  }
});

test('the task session routes attach and detach one day without touching activities', async () => {
  const journalPath = journalFile('task-sessions');
  const day = todayKey();
  const taskId = seedTask(journalPath, 'Ship interactive insights');
  const activityId = seedActivity(journalPath, day);
  assert.equal(activityCount(journalPath, day), 1);
  const runtime = ownedRuntime(journalPath);
  const routes = fakeHost(runtime);

  const refused = await postRoute(routes, PANEL_TASK_ATTACH_PATH, { id: taskId, day, minutes: 10 });
  assert.equal(refused.status, 400, 'attach demands confirm: true');

  const attached = await postRoute(routes, PANEL_TASK_ATTACH_PATH, {
    id: taskId,
    day,
    minutes: 30,
    note: 'first pass',
    activity_ids: [activityId],
    confirm: true,
  });
  assert.equal(attached.status, 200);
  assert.equal(attached.headers.get('content-type'), 'application/json; charset=utf-8');
  const attachedTask = ((await attached.json()) as PanelTaskAttachResponse).task;
  assert.equal(attachedTask.id, taskId);
  assert.equal(attachedTask.total_minutes, 30);
  assert.equal(attachedTask.session_days, 1);
  assert.equal(attachedTask.last_session_day, day);
  assert.deepEqual(attachedTask.sessions, [
    { day, minutes: 30, note: 'first pass', activity_ids: [activityId] },
  ]);
  assert.equal(activityCount(journalPath, day), 1, 'attaching a session leaves the activities alone');
  // The insights payload carries the session so the panel can offer Unlink.
  const insights = buildPanelInsights(runtime);
  assert.deepEqual(insights.tasks[0]?.sessions, [{ day, minutes: 30 }]);

  // Attaching the same day again replaces that day instead of doubling it.
  const replaced = await postRoute(routes, PANEL_TASK_ATTACH_PATH, {
    id: taskId,
    day,
    minutes: 45,
    activity_ids: [activityId],
    confirm: true,
  });
  assert.equal(replaced.status, 200);
  const replacedTask = ((await replaced.json()) as PanelTaskAttachResponse).task;
  assert.equal(replacedTask.total_minutes, 45);
  assert.equal(replacedTask.session_days, 1);
  assert.equal(replacedTask.sessions?.length, 1);

  const detached = await postRoute(routes, PANEL_TASK_DETACH_PATH, { id: taskId, day, confirm: true });
  assert.equal(detached.status, 200);
  assert.equal(detached.headers.get('content-type'), 'application/json; charset=utf-8');
  const detachedTask = ((await detached.json()) as PanelTaskDetachResponse).task;
  assert.equal(detachedTask.total_minutes, 0);
  assert.equal(detachedTask.session_days, 0);
  assert.deepEqual(detachedTask.sessions, []);
  assert.equal('last_session_day' in detachedTask, false);
  assert.equal(activityCount(journalPath, day), 1, 'detaching a session must not delete the day activities');

  // Detaching a day that was never attached is a no-op that still answers.
  const again = await postRoute(routes, PANEL_TASK_DETACH_PATH, { id: taskId, day, confirm: true });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as PanelTaskDetachResponse).task.total_minutes, 0);
});

test('the task session routes reject malformed bodies and unknown tasks', async () => {
  const journalPath = journalFile('task-sessions-invalid');
  const day = todayKey();
  const taskId = seedTask(journalPath, 'Ship interactive insights');
  const routes = fakeHost(ownedRuntime(journalPath));

  const invalidAttach: { body: unknown; label: string }[] = [
    { body: { id: taskId, day, confirm: true }, label: 'missing minutes' },
    { body: { id: taskId, day, minutes: -1, confirm: true }, label: 'negative minutes' },
    { body: { id: taskId, day, minutes: 1.5, confirm: true }, label: 'fractional minutes' },
    { body: { id: taskId, minutes: 10, confirm: true }, label: 'a missing day' },
    { body: { id: taskId, day: '2026-02-30', minutes: 10, confirm: true }, label: 'an impossible day' },
    { body: { id: taskId, day, minutes: 10, activity_ids: [-1], confirm: true }, label: 'negative activity ids' },
    { body: { id: taskId, day, minutes: 10, activity_ids: 'x', confirm: true }, label: 'a non-array activity id list' },
    { body: { id: taskId, day, minutes: 10, note: 42, confirm: true }, label: 'a non-string note' },
    { body: { id: taskId, day, minutes: 10, confirm: false }, label: 'confirm: false' },
    { body: 'this is not json', label: 'a malformed JSON body' },
  ];
  for (const entry of invalidAttach) {
    const response = await postRoute(routes, PANEL_TASK_ATTACH_PATH, entry.body);
    assert.equal(response.status, 400, `${entry.label} is rejected as invalid input`);
    assert.equal(typeof ((await response.json()) as { error: string }).error, 'string');
  }

  const invalidDetach: { body: unknown; label: string }[] = [
    { body: { id: taskId, day }, label: 'a missing detach confirm' },
    { body: { id: taskId, confirm: true }, label: 'a missing detach day' },
    { body: { id: taskId, day: '2026-02-30', confirm: true }, label: 'an impossible detach day' },
  ];
  for (const entry of invalidDetach) {
    const response = await postRoute(routes, PANEL_TASK_DETACH_PATH, entry.body);
    assert.equal(response.status, 400, `${entry.label} is rejected as invalid input`);
  }

  // None of the refused writes attached anything.
  assert.equal(storedTask(journalPath, taskId).session_days, 0);

  const unknownAttach = await postRoute(routes, PANEL_TASK_ATTACH_PATH, {
    id: 9_999,
    day,
    minutes: 10,
    confirm: true,
  });
  assert.equal(unknownAttach.status, 404);
  const unknownDetach = await postRoute(routes, PANEL_TASK_DETACH_PATH, {
    id: 9_999,
    day,
    confirm: true,
  });
  assert.equal(unknownDetach.status, 404);
});

test('the interactive write routes refuse a missing confirmation without creating the journal', async () => {
  const journalPath = journalFile('interactive-absent');
  assert.equal(existsSync(journalPath), false);
  const routes = fakeHost(makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath }));

  const refused: { path: string; body: unknown; label: string }[] = [
    { path: PANEL_REVIEW_DECIDE_PATH, body: { id: 1, decision: 'keep' }, label: 'a review decision without confirm' },
    {
      path: PANEL_REVIEW_DECIDE_PATH,
      body: { id: 1, decision: 'keep', confirm: false },
      label: 'a review decision with confirm: false',
    },
    { path: PANEL_TASK_ATTACH_PATH, body: { id: 1, day: '2026-11-24', minutes: 5 }, label: 'an attach without confirm' },
    { path: PANEL_TASK_DETACH_PATH, body: { id: 1, day: '2026-11-24' }, label: 'a detach without confirm' },
  ];
  for (const entry of refused) {
    const response = await postRoute(routes, entry.path, entry.body);
    assert.equal(response.status, 400, `${entry.label} is rejected as invalid input`);
    assert.match(((await response.json()) as { error: string }).error, /confirm: true/);
  }
  assert.equal(existsSync(journalPath), false, 'a refused write must not create the journal');

  // A confirmed write is a real write: the journal is created first, then the
  // store answers that the task does not exist. That is the same convention as
  // the panel's inline add routes, which create the journal on their first write.
  const missing = await postRoute(routes, PANEL_TASK_DETACH_PATH, {
    id: 1,
    day: '2026-11-24',
    confirm: true,
  });
  assert.equal(missing.status, 404);
  assert.equal(existsSync(journalPath), true);
});

test('the review route and the journal_review tool leave the same decision state', async () => {
  const kept = await decideBothWays(
    {
      kind: 'distillation',
      title: 'One shared decision composer',
      body: 'Route and tool must not drift.',
      confidence: 0.8,
      source_day: '2026-11-19',
    },
    'keep',
  );
  assert.deepEqual(kept.route, kept.tool, 'a keep writes the same item and claim both ways');
  assert.equal(kept.route.item.status, 'kept');
  assert.equal(kept.route.claims.length, 1);
  assert.equal(kept.route.tasks.length, 0);
  assert.equal(kept.routeReview.memory?.id, kept.toolValue.memory_id);

  const accepted = await decideBothWays(
    {
      kind: 'task_proposal',
      title: 'Ship the interactive panel',
      body: 'Decide from the panel.',
      confidence: 0.8,
      source_day: '2026-11-20',
    },
    'accept',
  );
  assert.deepEqual(accepted.route, accepted.tool, 'an accept writes the same item and task both ways');
  assert.equal(accepted.route.item.status, 'accepted');
  assert.equal(accepted.route.tasks.length, 1);
  assert.equal(accepted.route.claims.length, 0);
  assert.equal(accepted.routeReview.task?.id, accepted.toolValue.task_id);
});
