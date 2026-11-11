/**
 * Owned journal migration, import idempotency, and adapter parity.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { linkSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DatabaseSync } from 'node:sqlite';

import { DEFAULT_CATEGORIES } from '../src/categories.js';
import { DayflowError } from '../src/errors.js';
import { importDayflowDatabase, JOURNAL_SCHEMA_VERSION, migrateJournal, openJournal } from '../src/journal.js';
import { buildPanelDay, buildPanelMonth, buildPanelWeek } from '../src/panel.js';
import type { ActivityPayload, BreakdownPayload, DailyPayload, SearchPayload, TimelinePayload, WeeklyPayload } from '../src/queries.js';
import { journalImportTools } from '../src/tools/import.js';
import { readTools } from '../src/tools/read.js';
import { createFixtureDatabase } from './fixtures/database.js';
import { makeRuntime, runAndRender, toolMap } from './helpers.js';

const fixture = createFixtureDatabase();
const targetDirectory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-owned-test-'));
const journalPath = join(targetDirectory, 'journal.sqlite');
const migrationPath = join(targetDirectory, 'migration.sqlite');
const legacyPath = join(targetDirectory, 'legacy-v1.sqlite');

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

  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL);
    INSERT INTO schema_version (version, applied_at) VALUES (1, CURRENT_TIMESTAMP);
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY, batch_id INTEGER, start TEXT, end TEXT, start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL, day TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
      category TEXT NOT NULL, subcategory TEXT, detailed_summary TEXT, metadata TEXT,
      video_summary_url TEXT, is_deleted INTEGER NOT NULL DEFAULT 0
    );
  `);
  legacy.close();
  const upgraded = openJournal(legacyPath);
  assert.equal((upgraded.prepare('SELECT version FROM schema_version').get() as { version: number }).version, JOURNAL_SCHEMA_VERSION);
  assert.equal(upgraded.prepare("SELECT name FROM pragma_table_info('activities') WHERE name = 'payload_json'").get()?.name, 'payload_json');
  upgraded.close();

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

test('Dayflow import is additive, idempotent, and preserves the read payloads', async () => {
  const report = importDayflowDatabase({
    sourcePath: fixture.path,
    journalPath,
    categories: DEFAULT_CATEGORIES,
  });
  assert.equal(report.source_path, fixture.path);
  assert.equal(report.journal_path, journalPath);
  assert.equal(report.imported.timeline_cards, 9);
  assert.equal(report.imported.analysis_batches, 3);
  assert.equal(report.imported.screenshots, 7);
  assert.equal(report.imported.daily_standup_entries, 1);
  assert.equal(report.imported.categories, DEFAULT_CATEGORIES.length);
  assert.equal(report.skipped.length, 0);

  const again = importDayflowDatabase({
    sourcePath: fixture.path,
    journalPath,
    categories: DEFAULT_CATEGORIES,
  });
  assert.equal(again.imported.timeline_cards ?? 0, 0);
  assert.equal(again.unchanged.timeline_cards, 9);
  assert.equal(again.unchanged.categories, DEFAULT_CATEGORIES.length);

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

test('journal_import exposes the report through the registered tool', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-import-tool-'));
  const target = join(directory, 'journal.sqlite');
  try {
    const runtime = makeRuntime(fixture.path, { journalPath: target });
    const tools = toolMap(journalImportTools(runtime));
    const { value, text } = await runAndRender(tools, 'journal_import', { source_path: fixture.path });
    const report = value as { imported: Record<string, number>; source_path: string };
    assert.equal(report.source_path, fixture.path);
    assert.equal(report.imported.timeline_cards, 9);
    assert.match(text, /Imported Dayflow data/);
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
