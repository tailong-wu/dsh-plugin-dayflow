/**
 * Owned journal migration, import idempotency, and adapter parity.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DatabaseSync } from 'node:sqlite';

import { DEFAULT_CATEGORIES } from '../src/categories.js';
import { openDatabase } from '../src/db.js';
import { DayflowError } from '../src/errors.js';
import { importDayflowDatabase, JOURNAL_SCHEMA_VERSION, migrateJournal, openJournal } from '../src/journal.js';
import { buildPanelDay, buildPanelMonth, buildPanelWeek } from '../src/panel.js';
import type {
  ActivityPayload,
  BreakdownPayload,
  DailyPayload,
  SearchPayload,
  TimelinePayload,
  WeeklyPayload,
} from '../src/queries.js';
import { journalImportTools } from '../src/tools/import.js';
import { readTools } from '../src/tools/read.js';
import {
  FIXTURE_DAY,
  FIXTURE_LLM_SECRET,
  FIXTURE_NEXT_DAY,
  FIXTURE_PRIVATE_CHAT,
  createFixtureDatabase,
} from './fixtures/database.js';
import { makeRuntime, runAndRender, toolMap } from './helpers.js';

const fixture = createFixtureDatabase();
const targetDirectory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-owned-test-'));
const journalPath = join(targetDirectory, 'journal.sqlite');
const migrationPath = join(targetDirectory, 'migration.sqlite');
const legacyPath = join(targetDirectory, 'legacy-v1.sqlite');

/** Every supported source table and the rows the fixture offers it. */
const EXPECTED_IMPORTED: Record<string, number> = {
  analysis_batches: 3,
  timeline_cards: 9,
  screenshots: 7,
  daily_standup_entries: 1,
  observations: 4,
  day_goals: 2,
  day_goal_categories: 4,
  journal_entries: 2,
  timeline_review_ratings: 3,
  categories: DEFAULT_CATEGORIES.length,
};

/** Tables the importer must refuse to copy, with a reason in the report. */
const EXPECTED_SKIPPED = ['chat_history', 'llm_calls'];

/** sha256 of a file's bytes, used to prove the source file is untouched. */
function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * The v1 owned schema as 0.6.0 shipped it before migration 2: every table from
 * migration 1, with `activities` still missing `payload_json`.
 */
const V1_SCHEMA = `
  CREATE TABLE schema_version (
    version INTEGER NOT NULL PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE days (
    day TEXT PRIMARY KEY,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    time_zone TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE sources (
    source_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    source_key TEXT NOT NULL,
    local_id INTEGER,
    fingerprint TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_id, entity_type, source_key)
  );
  CREATE INDEX sources_local_id_idx ON sources (source_id, entity_type, local_id);

  CREATE TABLE analysis_batches (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    batch_start_ts INTEGER,
    batch_end_ts INTEGER,
    status TEXT NOT NULL DEFAULT 'complete',
    reason TEXT,
    payload_json TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE activities (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    batch_id INTEGER,
    start TEXT,
    end TEXT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    day TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    subcategory TEXT,
    detailed_summary TEXT,
    metadata TEXT,
    video_summary_url TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );
  CREATE INDEX activities_day_idx ON activities (day, start_ts);
  CREATE INDEX activities_range_idx ON activities (start_ts, end_ts);

  CREATE TABLE observations (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    activity_id INTEGER,
    start_ts INTEGER,
    end_ts INTEGER,
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE screenshots (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    file_path TEXT,
    file_size INTEGER,
    idle_seconds_at_capture INTEGER,
    frame_index INTEGER,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );
  CREATE INDEX screenshots_captured_idx ON screenshots (captured_at);

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    name TEXT NOT NULL,
    color_hex TEXT NOT NULL DEFAULT '#A0AEC0',
    is_system INTEGER NOT NULL DEFAULT 0,
    is_idle INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    payload_json TEXT,
    UNIQUE (source_id, source_key)
  );
  CREATE INDEX categories_name_idx ON categories (name);

  CREATE TABLE goals (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    day TEXT,
    focus_minutes INTEGER,
    distraction_limit_minutes INTEGER,
    focus_categories_json TEXT,
    distraction_categories_json TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE goal_categories (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    goal_id INTEGER,
    category_name TEXT,
    role TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE journal_entries (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    day TEXT,
    kind TEXT,
    title TEXT,
    body TEXT,
    status TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    activity_id INTEGER,
    start_ts INTEGER,
    end_ts INTEGER,
    rating TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE daily_standup_entries (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    standup_day TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );
  CREATE INDEX standup_day_idx ON daily_standup_entries (standup_day);
`;

after(() => {
  fixture.cleanup();
  rmSync(targetDirectory, { recursive: true, force: true });
});

test('a fresh owned journal migrates once and keeps the schema version forward-only', () => {
  const first = openJournal(migrationPath);
  const version = first.prepare('SELECT version FROM schema_version').get() as { version: number };
  assert.equal(version.version, JOURNAL_SCHEMA_VERSION);
  assert.equal((first.prepare("SELECT type FROM sqlite_master WHERE name = 'timeline_cards'").get() as { type: string }).type, 'view');
  first.close();

  const second = openJournal(migrationPath);
  assert.equal(migrateJournal(second), JOURNAL_SCHEMA_VERSION);
  second.close();

  const future = new DatabaseSync(migrationPath);
  future.prepare('UPDATE schema_version SET version = ?').run(JOURNAL_SCHEMA_VERSION + 1);
  future.close();
  assert.throws(
    () => openJournal(migrationPath),
    (error: unknown) => error instanceof DayflowError && error.code === 'database_error' && /newer/.test(error.message),
  );

  // Restore a usable fixture for the import test below.
  const reset = new DatabaseSync(migrationPath);
  reset.prepare('UPDATE schema_version SET version = ?').run(JOURNAL_SCHEMA_VERSION);
  reset.close();
});

test('a complete v1 journal migrates to v2 and keeps every row', () => {
  const v1 = new DatabaseSync(legacyPath);
  v1.exec(V1_SCHEMA);
  v1.exec(`
    INSERT INTO schema_version (version, applied_at) VALUES (1, CURRENT_TIMESTAMP);
    INSERT INTO days (day, start_ts, end_ts) VALUES ('${FIXTURE_DAY}', 100, 200);
    INSERT INTO sources (source_id, entity_type, source_key, local_id, fingerprint)
      VALUES ('dayflow', 'activities', 'v1-card', 1, 'fingerprint-v1');
    INSERT INTO analysis_batches (id, source_id, source_key, batch_start_ts, batch_end_ts, status)
      VALUES (1, 'dayflow', 'v1-batch', 100, 200, 'complete');
    INSERT INTO activities (id, source_id, source_key, batch_id, start, end, start_ts, end_ts, day, title, summary, category)
      VALUES (1, 'dayflow', 'v1-card', 1, '2026-10-19T09:00:00.000Z', '2026-10-19T09:40:00.000Z', 100, 200,
              '2026-10-19', 'Legacy v1 card', 'Survives the upgrade', 'Work');
    INSERT INTO observations (id, source_id, source_key, activity_id, start_ts, end_ts, payload_json)
      VALUES (1, 'dayflow', 'v1-observation', 1, 100, 200, '{"legacy":true}');
    INSERT INTO screenshots (id, source_id, source_key, captured_at, file_path)
      VALUES (1, 'dayflow', 'v1-screenshot', 150, '/tmp/v1.jpg');
    INSERT INTO categories (id, source_id, source_key, name, color_hex)
      VALUES (1, 'dayflow', 'v1-category', 'Work', '#123456');
    INSERT INTO goals (id, source_id, source_key, day, focus_minutes, payload_json)
      VALUES (1, 'dayflow', 'v1-goal', '${FIXTURE_DAY}', 60, '{"legacy":true}');
    INSERT INTO goal_categories (id, source_id, source_key, goal_id, category_name, role, payload_json)
      VALUES (1, 'dayflow', 'v1-goal-category', 1, 'Work', 'focus', '{"legacy":true}');
    INSERT INTO journal_entries (id, source_id, source_key, day, kind, title, body, status, payload_json)
      VALUES (1, 'dayflow', 'v1-journal', '${FIXTURE_DAY}', 'note', 'Legacy note',
              'Kept through the upgrade', 'draft', '{"legacy":true}');
    INSERT INTO reviews (id, source_id, source_key, activity_id, start_ts, end_ts, rating, payload_json)
      VALUES (1, 'dayflow', 'v1-rating', 1, 100, 200, 'focused', '{"legacy":true}');
    INSERT INTO daily_standup_entries (id, source_id, source_key, standup_day, payload_json)
      VALUES (1, 'dayflow', 'v1-standup', '${FIXTURE_DAY}', '{"legacy":true}');
  `);
  v1.close();

  const upgraded = openJournal(legacyPath);
  assert.equal(migrateJournal(upgraded), JOURNAL_SCHEMA_VERSION);
  assert.equal((upgraded.prepare('SELECT version FROM schema_version').get() as { version: number }).version, JOURNAL_SCHEMA_VERSION);

  // The v1→v2 step must actually run: the old table gains the column, empty.
  const payloadColumn = upgraded.prepare("SELECT name FROM pragma_table_info('activities') WHERE name = 'payload_json'").get();
  assert.equal(payloadColumn?.name, 'payload_json');
  assert.equal((upgraded.prepare('SELECT payload_json FROM activities WHERE id = 1').get() as { payload_json: unknown }).payload_json, null);

  // Every v1 row and the v1 bookmark survive the upgrade.
  const preserved: Record<string, number> = {
    days: 1,
    sources: 1,
    analysis_batches: 1,
    activities: 1,
    observations: 1,
    screenshots: 1,
    categories: 1,
    goals: 1,
    goal_categories: 1,
    journal_entries: 1,
    reviews: 1,
    daily_standup_entries: 1,
  };
  for (const [table, expected] of Object.entries(preserved)) {
    const row = upgraded.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
    assert.equal(row.count, expected, `${table} should keep its v1 rows`);
  }
  assert.deepEqual(
    { ...(upgraded.prepare('SELECT title, summary FROM activities WHERE id = 1').get() as { title: string; summary: string }) },
    { title: 'Legacy v1 card', summary: 'Survives the upgrade' },
  );
  assert.deepEqual(
    { ...(upgraded.prepare('SELECT body, status FROM journal_entries WHERE id = 1').get() as { body: string; status: string }) },
    { body: 'Kept through the upgrade', status: 'draft' },
  );
  assert.equal((upgraded.prepare('SELECT title FROM timeline_cards WHERE id = 1').get() as { title: string }).title, 'Legacy v1 card');
  upgraded.close();

  // Opening again is a no-op; migration 2 does not rewrite or duplicate rows.
  const reopened = openJournal(legacyPath);
  assert.equal((reopened.prepare('SELECT count(*) AS count FROM activities').get() as { count: number }).count, 1);
  assert.equal((reopened.prepare('SELECT version FROM schema_version').get() as { version: number }).version, JOURNAL_SCHEMA_VERSION);
  reopened.close();
});

test('a malformed schema_version fails closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-malformed-'));
  try {
    const multiPath = join(directory, 'multi-row.sqlite');
    const multi = new DatabaseSync(multiPath);
    multi.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version (version, applied_at) VALUES (1, CURRENT_TIMESTAMP), (2, CURRENT_TIMESTAMP);
    `);
    multi.close();
    assert.throws(
      () => openJournal(multiPath),
      (error: unknown) => error instanceof DayflowError && error.code === 'database_error' && /malformed/.test(error.message),
    );
    const multiAfter = new DatabaseSync(multiPath, { readOnly: true });
    assert.equal(
      (multiAfter.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'activities'").get() as { count: number }).count,
      0,
      'a failed migration must not create owned tables',
    );
    multiAfter.close();

    const textPath = join(directory, 'text-version.sqlite');
    const text = new DatabaseSync(textPath);
    text.exec(`
      CREATE TABLE schema_version (version TEXT NOT NULL PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version (version, applied_at) VALUES ('not-a-version', CURRENT_TIMESTAMP);
    `);
    text.close();
    assert.throws(
      () => openJournal(textPath),
      (error: unknown) =>
        error instanceof DayflowError && error.code === 'database_error' && /non-negative integer/.test(error.message),
    );

    const negativePath = join(directory, 'negative-version.sqlite');
    const negative = new DatabaseSync(negativePath);
    negative.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version (version, applied_at) VALUES (-1, CURRENT_TIMESTAMP);
    `);
    negative.close();
    assert.throws(
      () => openJournal(negativePath),
      (error: unknown) =>
        error instanceof DayflowError && error.code === 'database_error' && /non-negative integer/.test(error.message),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Dayflow import is additive, idempotent, and preserves the read payloads', async () => {
  const report = importDayflowDatabase({
    sourcePath: fixture.path,
    journalPath,
    categories: DEFAULT_CATEGORIES,
  });
  assert.equal(report.source_path, fixture.path);
  assert.equal(report.journal_path, journalPath);
  assert.deepEqual(report.imported, EXPECTED_IMPORTED);
  assert.deepEqual(report.updated, {});
  assert.deepEqual(report.skipped.map((entry) => entry.table), EXPECTED_SKIPPED);
  for (const entry of report.skipped) {
    assert.match(entry.reason, /provider credentials/);
    assert.match(entry.reason, /intentionally not imported/);
  }
  assert.equal(report.warnings.length, 2);

  const again = importDayflowDatabase({
    sourcePath: fixture.path,
    journalPath,
    categories: DEFAULT_CATEGORIES,
  });
  assert.deepEqual(again.imported, {});
  assert.deepEqual(again.updated, {});
  assert.deepEqual(again.unchanged, EXPECTED_IMPORTED);
  assert.deepEqual(again.skipped.map((entry) => entry.table), EXPECTED_SKIPPED);

  // Skipping is real: neither the private tables nor their marker text land in
  // the owned file, while the rows the report claims to import are there.
  const journalBytes = readFileSync(journalPath);
  assert.ok(journalBytes.includes(Buffer.from('Writing the DSH plugin')), 'imported cards should be in the owned journal');
  assert.ok(!journalBytes.includes(Buffer.from(FIXTURE_LLM_SECRET)), 'provider credentials must not be copied');
  assert.ok(!journalBytes.includes(Buffer.from(FIXTURE_PRIVATE_CHAT)), 'private chat must not be copied');
  const ownedSchema = new DatabaseSync(journalPath, { readOnly: true });
  const ownedTables = (ownedSchema.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (row) => row.name,
  );
  ownedSchema.close();
  assert.ok(!ownedTables.includes('llm_calls'));
  assert.ok(!ownedTables.includes('chat_history'));

  const dayflowRuntime = makeRuntime(fixture.path, { source: 'dayflow', dayflow: true, journalPath });
  const ownedRuntime = makeRuntime(fixture.path, { source: 'owned', dayflow: false, journalPath });
  const dayflow = toolMap(readTools(dayflowRuntime));
  const owned = toolMap(readTools(ownedRuntime));

  const timeline = (await runAndRender(dayflow, 'dayflow_timeline', { date: '2026-10-19' })).value as TimelinePayload;
  const ownedTimeline = (await runAndRender(owned, 'dayflow_timeline', { date: '2026-10-19' })).value as TimelinePayload;
  assert.deepEqual(ownedTimeline, timeline);

  const activity = (await runAndRender(dayflow, 'dayflow_activity', { record_id: 1 })).value as ActivityPayload;
  const ownedActivity = (await runAndRender(owned, 'dayflow_activity', { record_id: 1 })).value as ActivityPayload;
  assert.deepEqual(ownedActivity, activity);

  const breakdown = (await runAndRender(dayflow, 'dayflow_breakdown', { from: '2026-10-19', to: '2026-10-19' })).value as BreakdownPayload;
  const ownedBreakdown = (await runAndRender(owned, 'dayflow_breakdown', { from: '2026-10-19', to: '2026-10-19' })).value as BreakdownPayload;
  assert.deepEqual(ownedBreakdown, breakdown);

  const search = (await runAndRender(dayflow, 'dayflow_search', { query: 'plugin' })).value as SearchPayload;
  const ownedSearch = (await runAndRender(owned, 'dayflow_search', { query: 'plugin' })).value as SearchPayload;
  assert.deepEqual(ownedSearch, search);

  const daily = (await runAndRender(dayflow, 'dayflow_daily', { date: '2026-10-19' })).value as DailyPayload;
  const ownedDaily = (await runAndRender(owned, 'dayflow_daily', { date: '2026-10-19' })).value as DailyPayload;
  assert.deepEqual(ownedDaily, daily);

  const weekly = (await runAndRender(dayflow, 'dayflow_weekly', { date: '2026-10-19' })).value as WeeklyPayload;
  const ownedWeekly = (await runAndRender(owned, 'dayflow_weekly', { date: '2026-10-19' })).value as WeeklyPayload;
  assert.deepEqual(ownedWeekly, weekly);

  const categories = (await runAndRender(dayflow, 'dayflow_categories')).value;
  const ownedCategories = (await runAndRender(owned, 'dayflow_categories')).value;
  assert.deepEqual(ownedCategories, categories);
  const ownedStatus = (await runAndRender(owned, 'dayflow_status')).value as { source: string; database_present: boolean; setup?: unknown };
  assert.equal(ownedStatus.source, 'owned');
  assert.equal(ownedStatus.database_present, true);
  assert.equal(ownedStatus.setup, undefined);

  assert.deepEqual(buildPanelDay(ownedRuntime, '2026-10-19'), buildPanelDay(dayflowRuntime, '2026-10-19'));
  assert.deepEqual(buildPanelMonth(ownedRuntime, '2026-10'), buildPanelMonth(dayflowRuntime, '2026-10'));
  assert.deepEqual(buildPanelWeek(ownedRuntime, '2026-10-19'), buildPanelWeek(dayflowRuntime, '2026-10-19'));

  const ownedDb = new DatabaseSync(journalPath);
  ownedDb.exec("UPDATE daily_standup_entries SET is_deleted = 1; UPDATE analysis_batches SET is_deleted = 1 WHERE status = 'pending';");
  ownedDb.close();
  await assert.rejects(
    () => runAndRender(owned, 'dayflow_daily', { date: '2026-10-19' }),
    (error: unknown) => error instanceof DayflowError && error.code === 'not_found',
  );
  const statusAfterDelete = (await runAndRender(owned, 'dayflow_status')).value as { pending_batches: number };
  assert.equal(statusAfterDelete.pending_batches, 0);
});

test('the extended source tables keep their activity and goal links', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-links-'));
  const linkedJournal = join(directory, 'journal.sqlite');
  try {
    const report = importDayflowDatabase({ sourcePath: fixture.path, journalPath: linkedJournal, categories: DEFAULT_CATEGORIES });
    assert.equal(report.imported.observations, EXPECTED_IMPORTED.observations);
    assert.equal(report.imported.day_goal_categories, EXPECTED_IMPORTED.day_goal_categories);
    assert.equal(report.imported.timeline_review_ratings, EXPECTED_IMPORTED.timeline_review_ratings);

    const db = openDatabase(linkedJournal);
    try {
      // Observations point at the timeline card that carries them; the
      // range-only observation keeps a null link instead of inventing one.
      const observations = db
        .prepare(
          `SELECT o.id AS id, a.title AS title
             FROM observations o LEFT JOIN activities a ON a.id = o.activity_id
            ORDER BY o.id`,
        )
        .all()
        .map((row) => ({ ...row }));
      assert.deepEqual(observations, [
        { id: 1, title: 'Writing the DSH plugin' },
        { id: 2, title: 'Writing the DSH plugin' },
        { id: 3, title: 'Another day' },
        { id: 4, title: null },
      ]);
      const observationPayload = db.prepare('SELECT payload_json FROM observations WHERE id = 1').get() as { payload_json: string };
      assert.match(observationPayload.payload_json, /The user writes src\/journal\.ts in Cursor\./);

      // Day goals map their real columns; the payload keeps everything the
      // owned columns do not model.
      const goals = db.prepare('SELECT id, day, distraction_limit_minutes, payload_json FROM goals ORDER BY id').all() as {
        id: number;
        day: string;
        distraction_limit_minutes: number;
        payload_json: string;
      }[];
      assert.deepEqual(
        goals.map((goal) => [goal.day, goal.distraction_limit_minutes]),
        [
          [FIXTURE_DAY, 60],
          [FIXTURE_NEXT_DAY, 90],
        ],
      );
      assert.match(goals[0]!.payload_json, /"focus_target_minutes":240/);

      // Goal categories resolve through the goal row for their day.
      const goalCategories = db
        .prepare(
          `SELECT g.day AS day, c.category_name AS name, c.role AS role
             FROM goal_categories c LEFT JOIN goals g ON g.id = c.goal_id
            ORDER BY c.id`,
        )
        .all()
        .map((row) => ({ ...row }));
      assert.deepEqual(goalCategories, [
        { day: FIXTURE_DAY, name: 'Work', role: 'focus' },
        { day: FIXTURE_DAY, name: 'Communication', role: 'focus' },
        { day: FIXTURE_DAY, name: 'Distraction', role: 'distraction' },
        { day: FIXTURE_NEXT_DAY, name: 'Work', role: 'focus' },
      ]);
      assert.equal(
        (db.prepare('SELECT count(*) AS count FROM goal_categories WHERE goal_id IS NULL').get() as { count: number }).count,
        0,
        'every goal category should resolve to its goal',
      );

      // Ratings map onto the card they rate and keep the user's judgement.
      const reviews = db
        .prepare(
          `SELECT r.id AS id, a.title AS title, r.rating AS rating
             FROM reviews r LEFT JOIN activities a ON a.id = r.activity_id
            ORDER BY r.id`,
        )
        .all()
        .map((row) => ({ ...row }));
      assert.deepEqual(reviews, [
        { id: 1, title: 'Writing the DSH plugin', rating: 'focused' },
        { id: 2, title: 'YouTube break', rating: 'distracted' },
        { id: 3, title: null, rating: 'neutral' },
      ]);

      // Journal entries keep their day and status; the prose survives in the
      // payload even though the owned schema has no column for it yet.
      const entries = db.prepare('SELECT day, status, payload_json FROM journal_entries ORDER BY day').all() as {
        day: string;
        status: string;
        payload_json: string;
      }[];
      assert.deepEqual(
        entries.map((entry) => [entry.day, entry.status]),
        [
          [FIXTURE_DAY, 'complete'],
          [FIXTURE_NEXT_DAY, 'draft'],
        ],
      );
      assert.match(entries[0]!.payload_json, /Ship the journal importer\./);
      assert.match(entries[0]!.payload_json, /A focused build day\./);

      // A single import leaves one owned row per source row: no duplication.
      const counts: Record<string, number> = {
        observations: 4,
        goals: 2,
        goal_categories: 4,
        journal_entries: 2,
        reviews: 3,
      };
      for (const [table, expected] of Object.entries(counts)) {
        const row = db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
        assert.equal(row.count, expected, table);
      }
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('re-importing after a source row changes updates that row only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-reimport-'));
  const sourceCopy = join(directory, 'chunks.sqlite');
  const changedJournal = join(directory, 'journal.sqlite');
  try {
    copyFileSync(fixture.path, sourceCopy);
    const first = importDayflowDatabase({ sourcePath: sourceCopy, journalPath: changedJournal, categories: DEFAULT_CATEGORIES });
    assert.equal(first.imported.observations, EXPECTED_IMPORTED.observations);

    const writer = new DatabaseSync(sourceCopy);
    writer
      .prepare('UPDATE observations SET observation = ? WHERE id = 1')
      .run('The user re-reads the mapping table.');
    writer.close();

    const second = importDayflowDatabase({ sourcePath: sourceCopy, journalPath: changedJournal, categories: DEFAULT_CATEGORIES });
    assert.deepEqual(second.imported, {});
    assert.deepEqual(second.updated, { observations: 1 });
    assert.equal(second.unchanged.observations, EXPECTED_IMPORTED.observations - 1);
    assert.equal(second.unchanged.timeline_cards, EXPECTED_IMPORTED.timeline_cards);

    const db = openDatabase(changedJournal);
    try {
      assert.equal((db.prepare('SELECT count(*) AS count FROM observations').get() as { count: number }).count, 4);
      const updated = db.prepare('SELECT activity_id, payload_json FROM observations WHERE id = 1').get() as {
        activity_id: number;
        payload_json: string;
      };
      assert.equal(updated.activity_id, 1, 'an update keeps the foreign key');
      assert.match(updated.payload_json, /re-reads the mapping table/);
    } finally {
      db.close();
    }

    // The refreshed fingerprint sticks: a third run is unchanged, not updated.
    const third = importDayflowDatabase({ sourcePath: sourceCopy, journalPath: changedJournal, categories: DEFAULT_CATEGORIES });
    assert.deepEqual(third.imported, {});
    assert.deepEqual(third.updated, {});
    assert.equal(third.unchanged.observations, EXPECTED_IMPORTED.observations);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('import never writes to the Dayflow source database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-readonly-'));
  const sourceCopy = join(directory, 'chunks.sqlite');
  const readOnlyJournal = join(directory, 'journal.sqlite');
  try {
    copyFileSync(fixture.path, sourceCopy);
    const before = sha256Of(sourceCopy);

    importDayflowDatabase({ sourcePath: sourceCopy, journalPath: readOnlyJournal, categories: DEFAULT_CATEGORIES });
    assert.equal(sha256Of(sourceCopy), before, 'import must leave the source bytes untouched');

    // The Dayflow connection is opened read-only and pinned with query_only, so
    // a write is refused by SQLite instead of reaching the app's file.
    const db = openDatabase(sourceCopy);
    try {
      assert.throws(() => db.exec('CREATE TABLE write_probe (id INTEGER)'), /readonly/i);
      assert.throws(() => db.exec("INSERT INTO timeline_cards (start, end, day, title, category) VALUES ('x', 'y', '2026-10-19', 'nope', 'Work')"), /readonly/i);
      assert.throws(() => db.exec('UPDATE timeline_cards SET title = \'nope\' WHERE id = 1'), /readonly/i);
    } finally {
      db.close();
    }

    assert.equal(sha256Of(sourceCopy), before, 'a refused write must not change the source bytes');
    const readable = openDatabase(sourceCopy);
    try {
      assert.equal((readable.prepare('SELECT count(*) AS count FROM timeline_cards').get() as { count: number }).count, 9);
    } finally {
      readable.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the owned backend keeps every read tool and panel view after Dayflow is gone', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-detached-'));
  const sourcePath = join(directory, 'chunks.sqlite');
  const detachedJournal = join(directory, 'journal.sqlite');
  try {
    copyFileSync(fixture.path, sourcePath);
    importDayflowDatabase({ sourcePath, journalPath: detachedJournal, categories: DEFAULT_CATEGORIES });

    // Capture what the Dayflow backend answers before its file disappears, so
    // the owned answers can be compared with the real source, not with nothing.
    const dayflowRuntime = makeRuntime(sourcePath, { source: 'dayflow', dayflow: true, journalPath: detachedJournal });
    const expectedDay = buildPanelDay(dayflowRuntime, FIXTURE_DAY);
    const expectedMonth = buildPanelMonth(dayflowRuntime, '2026-10');
    const expectedWeek = buildPanelWeek(dayflowRuntime, FIXTURE_DAY);

    rmSync(sourcePath, { force: true });
    assert.equal(existsSync(sourcePath), false, 'the Dayflow database is really gone');

    const ownedRuntime = makeRuntime(sourcePath, { source: 'owned', dayflow: false, journalPath: detachedJournal });
    const owned = toolMap(readTools(ownedRuntime));

    const timelineResult = await runAndRender(owned, 'dayflow_timeline', { date: FIXTURE_DAY });
    const timeline = timelineResult.value as TimelinePayload;
    assert.equal(timeline.date, FIXTURE_DAY);
    assert.equal(timeline.cards.length, 7, 'six cards starting on Oct 19 plus the 3:30 AM Oct 20 card');
    assert.match(timelineResult.text, /Writing the DSH plugin/);

    const activityResult = await runAndRender(owned, 'dayflow_activity', { record_id: timeline.cards[0]!.record_id });
    assert.equal((activityResult.value as ActivityPayload).title, 'Writing the DSH plugin');
    assert.match(activityResult.text, /A long write-up of the plugin work\./);

    const breakdown = (await runAndRender(owned, 'dayflow_breakdown', { from: FIXTURE_DAY, to: FIXTURE_DAY })).value as BreakdownPayload;
    assert.deepEqual(breakdown.range, { from: FIXTURE_DAY, to: FIXTURE_DAY });
    assert.equal(breakdown.tracked_minutes, 138);

    const search = (await runAndRender(owned, 'dayflow_search', { query: 'plugin' })).value as SearchPayload;
    assert.equal(search.query, 'plugin');
    assert.ok(search.matches.length > 0);

    const daily = (await runAndRender(owned, 'dayflow_daily', { date: FIXTURE_DAY })).value as DailyPayload;
    assert.deepEqual(daily.highlights, ['Shipped the plugin', 'Wrote tests']);
    assert.deepEqual(daily.tasks, ['Publish the package']);
    assert.equal(daily.blockers, 'None');

    const weekly = (await runAndRender(owned, 'dayflow_weekly', { date: FIXTURE_DAY })).value as WeeklyPayload;
    assert.equal(weekly.tracked_minutes, 158);

    const categories = (await runAndRender(owned, 'dayflow_categories')).value as { categories: unknown[] };
    assert.equal(categories.categories.length, DEFAULT_CATEGORIES.length);

    const status = (await runAndRender(owned, 'dayflow_status')).value as {
      source: string;
      database_present: boolean;
      database_path: string;
    };
    assert.equal(status.source, 'owned');
    assert.equal(status.database_present, true);
    assert.equal(status.database_path, detachedJournal);

    // The panel builders read through the same owned backend the tools use.
    assert.deepEqual(buildPanelDay(ownedRuntime, FIXTURE_DAY), expectedDay);
    assert.deepEqual(buildPanelMonth(ownedRuntime, '2026-10'), expectedMonth);
    assert.deepEqual(buildPanelWeek(ownedRuntime, FIXTURE_DAY), expectedWeek);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('journal_import exposes the report through the registered tool', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-import-tool-'));
  const target = join(directory, 'journal.sqlite');
  try {
    const runtime = makeRuntime(fixture.path, { journalPath: target });
    const tools = toolMap(journalImportTools(runtime));
    const { value, text } = await runAndRender(tools, 'journal_import', { source_path: fixture.path });
    const report = value as {
      imported: Record<string, number>;
      skipped: { table: string; reason: string }[];
      source_path: string;
    };
    assert.equal(report.source_path, fixture.path);
    assert.equal(report.imported.timeline_cards, 9);
    assert.equal(report.skipped.length, 2);
    assert.match(text, /Imported Dayflow data/);
    assert.match(text, /- llm_calls: .*intentionally not imported/);
    assert.match(text, /- chat_history: .*intentionally not imported/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('import rejects an unrelated SQLite file and owned reads reject source reuse', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-invalid-source-'));
  const invalid = join(directory, 'not-dayflow.sqlite');
  const empty = new DatabaseSync(invalid);
  empty.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
  empty.close();
  try {
    assert.throws(
      () => importDayflowDatabase({ sourcePath: invalid, journalPath: join(directory, 'journal.sqlite') }),
      (error: unknown) => error instanceof DayflowError && error.code === 'database_error',
    );
    const badRuntime = makeRuntime(fixture.path, { source: 'owned', dayflow: false, journalPath: fixture.path });
    await assert.rejects(
      () => toolMap(readTools(badRuntime)).get('dayflow_timeline')!.execute({ date: '2026-10-19' }, undefined as never),
      (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('import refuses a destination that resolves to the source database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-import-link-'));
  const link = join(directory, 'journal.sqlite');
  const hardlink = join(directory, 'journal-hardlink.sqlite');
  try {
    symlinkSync(fixture.path, link);
    assert.throws(
      () => importDayflowDatabase({ sourcePath: fixture.path, journalPath: link }),
      (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
    );
    linkSync(fixture.path, hardlink);
    assert.throws(
      () => importDayflowDatabase({ sourcePath: fixture.path, journalPath: hardlink }),
      (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the source database stays readable after import', () => {
  const source = new DatabaseSync(fixture.path, { readOnly: true });
  const count = source.prepare('SELECT count(*) AS count FROM timeline_cards').get() as { count: number };
  assert.equal(count.count, 9);
  source.close();
});
