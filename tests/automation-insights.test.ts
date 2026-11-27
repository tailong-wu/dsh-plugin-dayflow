/**
 * The day's insight pass: one model call becomes a reflection, a capped set of
 * review proposals, and long-task sessions — or nothing at all.
 *
 * Every case runs against a disposable journal under `mkdtemp` with a scripted
 * {@link createFakeLlmAdapter} as the only model. No case opens a network
 * connection, captures the screen, or reaches a real provider, and no case
 * writes memory directly: D9 keeps automation away from memory claims.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { DatabaseSync } from 'node:sqlite';

import { createFakeLlmAdapter } from '../src/analyse/llm.js';
import type { AnalysisLlmStream } from '../src/analyse/llm.js';
import { runDayInsights } from '../src/automation/insights.js';
import type { DayInsightsOptions } from '../src/automation/insights.js';
import type { AnalysisConfig, ResolvedConfig } from '../src/config.js';
import { resolveConfig } from '../src/config.js';
import { dayWindowForKey, epochSeconds } from '../src/day.js';
import { DayflowError } from '../src/errors.js';
import { openJournal, withJournal, withJournalWrite } from '../src/journal.js';
import { decideReviewItem, listReviewItems, proposeReviewItem } from '../src/review.js';
import { createLongTask, updateLongTaskStatus } from '../src/tasks.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-day-insights-test-'));
after(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** The Dayflow day every case reviews. */
const DAY = '2026-10-19';
/** A second day, used when two fixtures' state must not mix. */
const OTHER_DAY = '2026-10-20';

let fixtureCount = 0;

/** One disposable journal plus the config that reads it. */
interface Fixture {
  journalPath: string;
  config: ResolvedConfig;
}

/** `analysis` overrides for a fixture; the success default is an explicit cloud call. */
interface FixtureOptions {
  analysis?: Partial<AnalysisConfig>;
}

/** Create a migrated, empty journal and its resolved config. */
function createFixture(options: FixtureOptions = {}): Fixture {
  fixtureCount += 1;
  const root = join(directory, `case-${String(fixtureCount)}`);
  const journalPath = join(root, 'journal.sqlite');
  const config = resolveConfig({
    databasePath: join(root, 'chunks.sqlite'),
    journalPath,
    source: 'owned',
    analysis: {
      consent: 'cloud',
      provider: 'fake-provider',
      model: 'fake-model',
      ...options.analysis,
    },
  });
  openJournal(journalPath).close();
  return { journalPath, config };
}

/** One activity row to seed. */
interface ActivitySpec {
  day?: string;
  sourceId?: string;
  sourceKey: string;
  title: string;
  category?: string;
  apps?: string[];
  hoursFromDayStart?: number;
  minutes?: number;
}

/** Seed activities into the owned journal. */
function seedActivities(journalPath: string, specs: readonly ActivitySpec[]): void {
  withJournalWrite(journalPath, (db) => {
    for (const spec of specs) {
      const day = spec.day ?? DAY;
      const window = dayWindowForKey(day);
      assert.ok(window !== undefined, `test seed day ${day} must be a real day`);
      const start = new Date(window.start.getTime() + (spec.hoursFromDayStart ?? 6) * 3_600_000);
      const end = new Date(start.getTime() + (spec.minutes ?? 30) * 60_000);
      const apps = spec.apps ?? [];
      const metadata =
        apps.length === 0
          ? null
          : JSON.stringify({ appSites: { primary: apps[0] ?? null, secondary: apps[1] ?? null } });
      db.prepare(
        `INSERT INTO activities (source_id, source_key, start_ts, end_ts, day, title, summary, category, metadata)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
      ).run(
        spec.sourceId ?? 'dayflow',
        spec.sourceKey,
        epochSeconds(start),
        epochSeconds(end),
        day,
        spec.title,
        spec.category ?? 'Work',
        metadata,
      );
    }
  });
}

/** Seed one long task and return its id. */
function seedTask(journalPath: string, title: string, status: 'active' | 'paused' = 'active'): number {
  return withJournalWrite(journalPath, (db) => {
    const task = createLongTask(db, { title, description: '', categories: ['Work'], apps: ['Code'] });
    if (status !== 'active') updateLongTaskStatus(db, task.id, status);
    return task.id;
  });
}

type TestRow = Record<string, unknown>;

/** Read rows with one short-lived raw connection. */
function readAll(path: string, sql: string, ...parameters: (string | number)[]): TestRow[] {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).all(...(parameters as never[])) as TestRow[];
  } finally {
    db.close();
  }
}

/** Read one row with one short-lived raw connection. */
function readOne(path: string, sql: string, ...parameters: (string | number)[]): TestRow | undefined {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).get(...(parameters as never[])) as TestRow | undefined;
  } finally {
    db.close();
  }
}

function countRows(path: string, table: string): number {
  return readAll(path, `SELECT id FROM ${table}`).length;
}

function reflectionRows(path: string): TestRow[] {
  return readAll(path, 'SELECT * FROM reflections ORDER BY id ASC');
}

function reviewRows(path: string): TestRow[] {
  return readAll(path, 'SELECT * FROM review_items ORDER BY id ASC');
}

function sessionRows(path: string): TestRow[] {
  return readAll(path, 'SELECT * FROM long_task_sessions ORDER BY id ASC');
}

function parseJson(value: unknown): unknown {
  return JSON.parse(String(value)) as unknown;
}

/** The default valid reflection body the scripted answers use. */
const REFLECTION_BODY = 'Most of the day went into the journal importer and its migration test.';

/** Build one model answer, with optional prose fields overridden or removed. */
function jsonAnswer(overrides: Record<string, unknown> = {}, omit: readonly string[] = []): string {
  const body: Record<string, unknown> = {
    reflection: { body: REFLECTION_BODY, highlights: ['Finished the migration test'] },
    ...overrides,
  };
  for (const key of omit) delete body[key];
  return JSON.stringify(body);
}

/** Run the pass against one fixture, with overridable options. */
async function runInsights(
  fixture: Fixture,
  adapter: AnalysisLlmStream,
  overrides: Partial<DayInsightsOptions> = {},
): Promise<Awaited<ReturnType<typeof runDayInsights>>> {
  return runDayInsights({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    day: DAY,
    ...overrides,
  });
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

test('one pass writes a reflection, the strongest capped proposals, and a confident session', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [
    { sourceKey: 'card-1', title: 'Writing the journal importer', category: 'Work', apps: ['Code'], minutes: 120 },
    { sourceKey: 'card-2', sourceId: 'native', title: 'Reviewing the migration test', category: 'Work', minutes: 45 },
  ]);
  const shipping = seedTask(fixture.journalPath, 'Ship the journal importer');
  const roadmap = seedTask(fixture.journalPath, 'Write the roadmap');
  const adapter = createFakeLlmAdapter([
    jsonAnswer({
      proposals: [
        { kind: 'distillation', title: 'Test migrations against old fixtures', body: 'It caught a real bug.', confidence: 0.9 },
        { kind: 'loop', title: 'Re-planning the same schema', confidence: 0.75 },
        { kind: 'improvement', title: 'Add a v8 fixture', confidence: 0.55 },
        { kind: 'improvement', title: 'Split the importer into steps', confidence: 0.7 },
        { kind: 'improvement', title: 'Write the importer docs', confidence: 0.65 },
      ],
      task_sessions: [
        { task_id: shipping, minutes: 90, confidence: 0.9 },
        { task_id: roadmap, minutes: 45, confidence: 0.5 },
      ],
    }),
  ]);

  const result = await runInsights(fixture, adapter);

  assert.equal(result.status, 'written');
  assert.equal(result.reflection, true);
  assert.equal(adapter.calls.length, 1);
  assert.match(adapter.calls[0].system, /exactly one JSON object/);
  assert.match(adapter.calls[0].user, /Day: 2026-10-19/);
  assert.match(adapter.calls[0].user, /Writing the journal importer/);
  assert.match(adapter.calls[0].user, /Active long tasks/);
  assert.match(adapter.calls[0].user, new RegExp(`id=${String(shipping)}`));
  assert.match(adapter.calls[0].user, /Ship the journal importer/);

  const reflections = reflectionRows(fixture.journalPath);
  assert.equal(reflections.length, 1);
  const reflection = reflections[0] as TestRow;
  assert.equal(reflection.kind, 'day');
  assert.equal(reflection.period_key, DAY);
  assert.equal(reflection.body, REFLECTION_BODY);
  assert.deepEqual(parseJson(reflection.highlights_json), ['Finished the migration test']);
  assert.deepEqual(parseJson(reflection.source_days_json), [DAY]);

  // Three kept proposals (the 0.55 one is below the floor, the 0.65 one is past
  // the cap) plus the one task proposal the weak session became.
  assert.equal(result.proposals, 4);
  const reviews = reviewRows(fixture.journalPath);
  assert.equal(reviews.length, 4);
  const titles = reviews.map((row) => row.title);
  assert.ok(titles.includes('Test migrations against old fixtures'));
  assert.ok(titles.includes('Re-planning the same schema'));
  assert.ok(titles.includes('Split the importer into steps'));
  assert.ok(!titles.includes('Add a v8 fixture'), 'a below-floor proposal must not be stored');
  assert.ok(!titles.includes('Write the importer docs'), 'a proposal past the cap must not be stored');
  for (const review of reviews) {
    assert.equal(review.status, 'proposed');
    assert.equal(review.source_day, DAY);
  }
  const taskProposal = reviews.find((row) => row.kind === 'task_proposal') as TestRow;
  assert.equal(taskProposal.title, 'Log time to "Write the roadmap"');
  assert.equal(taskProposal.confidence, 0.5);
  assert.match(String(taskProposal.body), /45 minutes/);

  const sessions = sessionRows(fixture.journalPath);
  assert.equal(result.sessions, 1);
  assert.equal(sessions.length, 1);
  assert.equal((sessions[0] as TestRow).task_id, shipping);
  assert.equal((sessions[0] as TestRow).day, DAY);
  assert.equal((sessions[0] as TestRow).minutes, 90);

  assert.ok(result.reasons.includes('proposal-below-confidence:improvement'), 'the floor is reported');
  assert.ok(result.reasons.includes('proposal-over-cap'), 'the cap is reported');
  assert.ok(result.reasons.includes(`session-proposal:${String(roadmap)}`), 'the weak session is reported');
});

test('a second pass is a no-op: skipped already-written and no model call', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Writing the journal importer' }]);
  const adapter = createFakeLlmAdapter([jsonAnswer({ proposals: [{ kind: 'loop', title: 'Too much context switching', confidence: 0.8 }] })]);
  const options = { journalPath: fixture.journalPath, config: fixture.config, analyser: adapter, day: DAY };
  const first = await runDayInsights(options);
  assert.equal(first.status, 'written');
  const reviewCount = countRows(fixture.journalPath, 'review_items');
  const sessionCount = countRows(fixture.journalPath, 'long_task_sessions');

  const second = await runDayInsights(options);
  assert.equal(second.status, 'skipped');
  assert.equal(second.reflection, false);
  assert.deepEqual(second.reasons, ['already-written']);
  assert.equal(adapter.calls.length, 1, 'the rerun must not reach the model');
  assert.equal(countRows(fixture.journalPath, 'review_items'), reviewCount);
  assert.equal(countRows(fixture.journalPath, 'long_task_sessions'), sessionCount);
  assert.equal(reflectionRows(fixture.journalPath).length, 1);
});

test('force regenerates the reflection and lets the queue dedupe the proposals', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Writing the journal importer' }]);
  const proposal = { kind: 'distillation', title: 'Test migrations against old fixtures', confidence: 0.9 };
  const replay = createFakeLlmAdapter([
    jsonAnswer({ reflection: { body: REFLECTION_BODY }, proposals: [proposal] }),
    jsonAnswer({ reflection: { body: 'A rewritten reflection for the same day.' }, proposals: [proposal] }),
  ]);
  const options = { journalPath: fixture.journalPath, config: fixture.config, analyser: replay, day: DAY };
  const first = await runDayInsights(options);
  assert.equal(first.status, 'written');
  const second = await runDayInsights({ ...options, force: true });
  assert.equal(second.status, 'written');
  assert.equal(second.proposals, 0, 'the queue dedupes a proposal it already holds');
  assert.ok(second.reasons.includes('proposal-dropped:already-proposed'));
  assert.equal(replay.calls.length, 2, 'force must reach the model again');
  assert.equal(reviewRows(fixture.journalPath).length, 1);
  const reflections = reflectionRows(fixture.journalPath);
  assert.equal(reflections.length, 1, 'the reflection is rewritten, not duplicated');
  assert.equal((reflections[0] as TestRow).body, 'A rewritten reflection for the same day.');
});

test('a malformed answer writes nothing', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Writing the journal importer' }]);
  const adapter = createFakeLlmAdapter([
    'Sure! Here is my analysis of the day: it looks productive.',
    '[]',
    jsonAnswer({}, ['reflection']),
    '{"reflection":{"body":""}}',
  ]);
  const options = { journalPath: fixture.journalPath, config: fixture.config, analyser: adapter, day: DAY };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await runDayInsights(options);
    assert.equal(result.status, 'skipped', `attempt ${String(attempt)}`);
    assert.equal(result.reasons[0], 'bad-output', `attempt ${String(attempt)}`);
    assert.equal(result.reflection, false);
  }
  assert.equal(adapter.calls.length, 4);
  assert.equal(reflectionRows(fixture.journalPath).length, 0);
  assert.equal(reviewRows(fixture.journalPath).length, 0);
  assert.equal(sessionRows(fixture.journalPath).length, 0);
});

test('a hard-suppressed idea is not proposed again by the automation pass', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Writing the journal importer' }]);
  const suppressedTitle = 'Test migrations against old fixtures';
  const suppressedId = withJournalWrite(fixture.journalPath, (db) => {
    const proposed = proposeReviewItem(db, { kind: 'distillation', title: suppressedTitle, confidence: 0.9 });
    assert.ok(proposed.item !== undefined, 'the fixture proposal must be stored');
    const decided = decideReviewItem(db, proposed.item.id, 'discard', { forever: true });
    return decided.id;
  });
  const adapter = createFakeLlmAdapter([
    jsonAnswer({
      proposals: [
        { kind: 'distillation', title: suppressedTitle, confidence: 0.95 },
        { kind: 'improvement', title: 'Keep the migration fixture suite', confidence: 0.7 },
      ],
    }),
  ]);
  const result = await runInsights(fixture, adapter);
  assert.equal(result.status, 'written');
  assert.equal(result.proposals, 1);
  assert.ok(result.reasons.includes('proposal-dropped:hard-suppressed'));
  const reviews = reviewRows(fixture.journalPath);
  assert.equal(reviews.length, 2);
  const suppressed = reviews.find((row) => row.id === suppressedId) as TestRow;
  assert.equal(suppressed.status, 'discarded');
  assert.equal(suppressed.suppression, 'hard');
  assert.equal(reviews.filter((row) => row.status === 'proposed').length, 1);
  assert.equal(reviews.filter((row) => row.title === suppressedTitle).length, 1);
});

test('a session only attaches for an active task; unknown and paused tasks are skipped', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Writing the journal importer' }]);
  const active = seedTask(fixture.journalPath, 'Ship the journal importer');
  const paused = seedTask(fixture.journalPath, 'Write the roadmap', 'paused');
  const adapter = createFakeLlmAdapter([
    jsonAnswer({
      task_sessions: [
        { task_id: 999, minutes: 30, confidence: 0.95 },
        { task_id: paused, minutes: 30, confidence: 0.95 },
        { task_id: active, minutes: 25, confidence: 0.6 },
      ],
    }),
  ]);
  const result = await runInsights(fixture, adapter);
  assert.equal(result.status, 'written');
  assert.equal(result.sessions, 0);
  assert.equal(result.proposals, 1, 'the weak guess becomes one task proposal');
  assert.ok(result.reasons.includes('task-unavailable:999'));
  assert.ok(result.reasons.includes(`task-unavailable:${String(paused)}`));
  assert.equal(sessionRows(fixture.journalPath).length, 0);
  const reviews = reviewRows(fixture.journalPath);
  assert.equal(reviews.length, 1);
  assert.equal((reviews[0] as TestRow).kind, 'task_proposal');
  assert.equal((reviews[0] as TestRow).title, 'Log time to "Ship the journal importer"');
});

test('D9: the pass never writes memory claims directly', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Writing the journal importer' }]);
  const adapter = createFakeLlmAdapter([
    jsonAnswer({
      proposals: [
        { kind: 'distillation', title: 'Test migrations against old fixtures', confidence: 0.9 },
        { kind: 'loop', title: 'Re-planning the same schema', confidence: 0.8 },
      ],
    }),
  ]);
  const result = await runInsights(fixture, adapter);
  assert.equal(result.status, 'written');
  assert.equal(result.proposals, 2);
  assert.equal(countRows(fixture.journalPath, 'memory_claims'), 0);
});

test('a mixed imported/native journal is summarised without touching imported rows', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [
    { sourceKey: 'dayflow-card-1', title: 'Writing the journal importer', minutes: 60 },
    { sourceKey: 'native-card-1', sourceId: 'native', title: 'Reviewing the migration test', minutes: 30 },
  ]);
  const before = readOne(fixture.journalPath, "SELECT * FROM activities WHERE source_key = 'dayflow-card-1'") as TestRow;
  const adapter = createFakeLlmAdapter([jsonAnswer()]);
  const result = await runInsights(fixture, adapter);
  assert.equal(result.status, 'written');
  assert.match(adapter.calls[0].user, /Writing the journal importer/);
  assert.match(adapter.calls[0].user, /Reviewing the migration test/);
  const after = readOne(fixture.journalPath, "SELECT * FROM activities WHERE source_key = 'dayflow-card-1'") as TestRow;
  assert.deepEqual(after, before, 'an imported activity row must not change');
  assert.equal(countRows(fixture.journalPath, 'activities'), 2);
});

test('the gate blocks before reading or calling; an empty day calls nothing', async () => {
  for (const entry of [
    { analysis: { consent: 'none' } as Partial<AnalysisConfig>, reason: 'consent:none' },
    { analysis: { enabled: false } as Partial<AnalysisConfig>, reason: 'analysis-disabled' },
    { analysis: { provider: '' } as Partial<AnalysisConfig>, reason: 'provider-unset' },
  ]) {
    const fixture = createFixture({ analysis: entry.analysis });
    seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Writing the journal importer' }]);
    const adapter = createFakeLlmAdapter([jsonAnswer()]);
    const result = await runInsights(fixture, adapter);
    assert.equal(result.status, 'skipped', `case ${entry.reason}`);
    assert.deepEqual(result.reasons, [entry.reason]);
    assert.equal(adapter.calls.length, 0);
    assert.equal(reflectionRows(fixture.journalPath).length, 0);
  }

  const fixture = createFixture();
  const emptyAdapter = createFakeLlmAdapter([]);
  const empty = await runInsights(fixture, emptyAdapter, { day: OTHER_DAY });
  assert.equal(empty.status, 'empty');
  assert.equal(emptyAdapter.calls.length, 0);
  assert.equal(reflectionRows(fixture.journalPath).length, 0);
});

test('an unusable day or tuning cap is rejected before any call', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Writing the journal importer' }]);
  const adapter = createFakeLlmAdapter([jsonAnswer()]);
  await assert.rejects(runInsights(fixture, adapter, { day: '2026-02-30' }), isInvalidInput);
  await assert.rejects(runInsights(fixture, adapter, { maxProposals: -1 }), isInvalidInput);
  await assert.rejects(runInsights(fixture, adapter, { minConfidence: 1.5 }), isInvalidInput);
  await assert.rejects(runInsights(fixture, adapter, { sessionMinScore: -0.1 }), isInvalidInput);
  assert.equal(adapter.calls.length, 0);
  assert.equal(reflectionRows(fixture.journalPath).length, 0);
});

test('a zero proposal cap keeps the reflection but proposes nothing', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Writing the journal importer' }]);
  const adapter = createFakeLlmAdapter([
    jsonAnswer({ proposals: [{ kind: 'distillation', title: 'A strong lesson worth keeping', confidence: 0.95 }] }),
  ]);
  const result = await runInsights(fixture, adapter, { maxProposals: 0 });
  assert.equal(result.status, 'written');
  assert.equal(result.reflection, true);
  assert.equal(result.proposals, 0);
  assert.ok(result.reasons.includes('proposal-over-cap'));
  assert.equal(reviewRows(fixture.journalPath).length, 0);
  assert.equal(reflectionRows(fixture.journalPath).length, 1);
});

test('the active task list in the prompt is bounded and uses only active tasks', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Writing the journal importer' }]);
  const active = seedTask(fixture.journalPath, 'Ship the journal importer');
  seedTask(fixture.journalPath, 'Write the roadmap', 'paused');
  const adapter = createFakeLlmAdapter([jsonAnswer()]);
  const result = await runInsights(fixture, adapter);
  assert.equal(result.status, 'written');
  assert.match(adapter.calls[0].user, new RegExp(`id=${String(active)}`));
  assert.doesNotMatch(adapter.calls[0].user, /Write the roadmap/);
  // listReviewItems is part of the same store surface the pass writes through.
  const proposed = withJournal(fixture.journalPath, (db) => listReviewItems(db));
  assert.equal(proposed.length, 0);
});
