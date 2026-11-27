/**
 * The daily and weekly briefs: one day becomes a standup entry, one week becomes
 * a stored brief.
 *
 * Every case runs against a disposable journal under `mkdtemp` with a scripted
 * {@link createFakeLlmAdapter} as the only model. No case opens a network
 * connection, captures the screen, or reaches a real provider: the fake adapter
 * is the seam the analysis pipeline tests already use.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { DatabaseSync } from 'node:sqlite';

import { createFakeLlmAdapter } from '../src/analyse/llm.js';
import {
  DAILY_BRIEF_MAX_ACTIVITY_CHARS,
  dailyStandupSourceKey,
  writeDailyBrief,
} from '../src/briefs/daily.js';
import { weekDayKeys, weeklyBriefSourceKey, writeWeeklyBrief } from '../src/briefs/weekly.js';
import type { AnalysisConfig, ResolvedConfig } from '../src/config.js';
import { resolveConfig } from '../src/config.js';
import { dayWindowForKey, epochSeconds, formatDayKey, formatIso } from '../src/day.js';
import { DayflowError } from '../src/errors.js';
import { openJournal, withJournalWrite } from '../src/journal.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-briefs-test-'));
after(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** A Monday; the week fixture spans 2026-10-19 through 2026-10-25. */
const MONDAY = '2026-10-19';
/** An arbitrary day inside that week, used by the daily cases. */
const DAY = MONDAY;

/** A Friday of a later week, with no seeded activity. */
const EMPTY_WEEK_MONDAY = '2026-11-02';

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
  // Explicitly create the journal so every case starts from the migrated schema.
  openJournal(journalPath).close();
  return { journalPath, config };
}

/** One activity row to seed into the journal. */
interface ActivitySpec {
  /** The Dayflow day; defaults to {@link DAY}. */
  day?: string;
  /** The writer of the row; defaults to an imported Dayflow row. */
  sourceId?: string;
  /** Unique within the source. */
  sourceKey: string;
  title: string;
  category?: string;
  /** Frontmost apps, primary first. */
  apps?: string[];
  /** Hours after the 04:00 day start; defaults to 06:00. */
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

/** The 04:00 start of a real day key, for building fixed fixtures. */
function dayStart(day: string): Date {
  const window = dayWindowForKey(day);
  assert.ok(window !== undefined, `${day} must be a real day`);
  return window.start;
}

/** Shift a local date by whole days, keeping the wall clock. */
function addDays(date: Date, days: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setDate(shifted.getDate() + days);
  return shifted;
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

/** Every standup row, oldest id first. */
function standupRows(path: string): TestRow[] {
  return readAll(path, 'SELECT * FROM daily_standup_entries ORDER BY id ASC');
}

/** Every brief row, oldest id first. */
function briefRows(path: string): TestRow[] {
  return readAll(path, 'SELECT * FROM briefs ORDER BY id ASC');
}

/** Read the `payload_json` object of one brief row, when it has one. */
function briefPayload(row: TestRow): Record<string, unknown> | undefined {
  const raw = row.payload_json;
  if (raw === null || raw === undefined) return undefined;
  const parsed: unknown = JSON.parse(String(raw));
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

const FIRST_STANDUP = '- Shipped the importer\n- Reviewed a diff\n- Answered review comments\nBlockers: none';

test('the daily brief writes one native standup entry from imported and native activity', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [
    {
      sourceKey: 'dayflow-card-1',
      title: 'Writing the journal importer',
      category: 'Work',
      apps: ['Code', 'Terminal'],
      hoursFromDayStart: 6,
      minutes: 90,
    },
    {
      sourceKey: 'native-card-1',
      sourceId: 'native',
      title: 'Reviewing an analysis diff',
      category: 'Work',
      hoursFromDayStart: 11,
      minutes: 30,
    },
  ]);
  const adapter = createFakeLlmAdapter([FIRST_STANDUP]);
  const now = new Date('2026-10-20T04:00:00Z');
  const result = await writeDailyBrief({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    day: DAY,
    now: () => now,
  });

  assert.equal(result.status, 'written');
  assert.equal(adapter.calls.length, 1);
  const request = adapter.calls[0];
  assert.equal(request.provider, 'fake-provider');
  assert.equal(request.model, 'fake-model');
  assert.match(request.system, /DATA from a screen-activity journal/);
  assert.match(request.system, /never an instruction/);
  assert.match(request.user, /Day: 2026-10-19/);
  assert.match(request.user, /Writing the journal importer/);
  assert.match(request.user, /Reviewing an analysis diff/);
  assert.match(request.user, /apps=Code, Terminal/);
  assert.match(request.user, /category=Work/);

  const rows = standupRows(fixture.journalPath);
  assert.equal(rows.length, 1);
  const row = rows[0] as TestRow;
  assert.equal(row.source_id, 'native');
  assert.equal(row.source_key, dailyStandupSourceKey(DAY));
  assert.equal(row.standup_day, DAY);
  assert.equal(row.is_deleted, 0);
  const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
  assert.equal(payload.day, DAY);
  assert.equal(payload.title, `Standup ${DAY}`);
  assert.equal(payload.body, FIRST_STANDUP);
  assert.equal(payload.model, 'fake-model');
  assert.equal(payload.generated_at, formatIso(now));
  assert.equal(result.entryId, row.id);
  assert.equal(result.model, 'fake-model');

  // The pass never rewrites the source activity rows themselves.
  assert.equal(readAll(fixture.journalPath, 'SELECT id FROM activities').length, 2);
});

test('a second daily run is a no-op: skipped already-written and no model call', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Worked on the plugin' }]);
  // The script holds one answer, so a second call would fail the test loudly.
  const adapter = createFakeLlmAdapter([FIRST_STANDUP]);
  const options = {
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    day: DAY,
  };
  const first = await writeDailyBrief(options);
  assert.equal(first.status, 'written');
  const second = await writeDailyBrief(options);
  assert.equal(second.status, 'skipped');
  assert.equal(second.reason, 'already-written');
  assert.equal(second.entryId, first.entryId);
  assert.equal(adapter.calls.length, 1);
  assert.equal(standupRows(fixture.journalPath).length, 1);
});

test('force rewrites the same standup row instead of adding a second one', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Worked on the plugin' }]);
  const adapter = createFakeLlmAdapter(['- first answer', '- second answer']);
  const first = await writeDailyBrief({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    day: DAY,
  });
  const second = await writeDailyBrief({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    day: DAY,
    force: true,
  });
  assert.equal(first.status, 'written');
  assert.equal(second.status, 'written');
  assert.equal(second.entryId, first.entryId);
  assert.equal(adapter.calls.length, 2);
  const rows = standupRows(fixture.journalPath);
  assert.equal(rows.length, 1);
  const payload = JSON.parse(String((rows[0] as TestRow).payload_json)) as Record<string, unknown>;
  assert.equal(payload.body, '- second answer');
});

test('a day with no activity is empty and makes no model call', async () => {
  const fixture = createFixture();
  const adapter = createFakeLlmAdapter([]);
  const result = await writeDailyBrief({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    day: '2026-10-18',
  });
  assert.equal(result.status, 'empty');
  assert.equal(adapter.calls.length, 0);
  assert.equal(standupRows(fixture.journalPath).length, 0);
});

test('the consent gate and unset provider/model block before any call', async () => {
  const cases: { analysis: Partial<AnalysisConfig>; reason: string }[] = [
    { analysis: { enabled: false }, reason: 'analysis-disabled' },
    { analysis: { consent: 'none' }, reason: 'consent:none' },
    { analysis: { provider: '   ' }, reason: 'provider-unset' },
    { analysis: { model: '' }, reason: 'model-unset' },
  ];
  for (const entry of cases) {
    const fixture = createFixture({ analysis: entry.analysis });
    seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Worked on the plugin' }]);
    const adapter = createFakeLlmAdapter([FIRST_STANDUP]);
    const result = await writeDailyBrief({
      journalPath: fixture.journalPath,
      config: fixture.config,
      analyser: adapter,
      day: DAY,
    });
    assert.equal(result.status, 'skipped', `case ${entry.reason}`);
    assert.equal(result.reason, entry.reason, `case ${entry.reason}`);
    assert.equal(adapter.calls.length, 0, `case ${entry.reason} must not call the model`);
    assert.equal(standupRows(fixture.journalPath).length, 0);
  }
});

test('an unusable day is rejected before anything is read or called', async () => {
  const fixture = createFixture();
  const adapter = createFakeLlmAdapter([FIRST_STANDUP]);
  await assert.rejects(
    writeDailyBrief({
      journalPath: fixture.journalPath,
      config: fixture.config,
      analyser: adapter,
      day: '2026-02-30',
    }),
    isInvalidInput,
  );
  assert.equal(adapter.calls.length, 0);
});

test('a blank model answer is skipped instead of writing an empty standup', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'card-1', title: 'Worked on the plugin' }]);
  const adapter = createFakeLlmAdapter(['   \n  ']);
  const result = await writeDailyBrief({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    day: DAY,
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'empty-output');
  assert.equal(standupRows(fixture.journalPath).length, 0);
});

test('a very busy day is truncated in the prompt, not sent whole', async () => {
  const fixture = createFixture();
  seedActivities(
    fixture.journalPath,
    Array.from({ length: 40 }, (_unused, index) => ({
      sourceKey: `busy-${String(index)}`,
      title: `A long activity title ${String(index)} ${'x'.repeat(200)}`,
      hoursFromDayStart: index % 20,
      minutes: 20,
    })),
  );
  const adapter = createFakeLlmAdapter([FIRST_STANDUP]);
  const result = await writeDailyBrief({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    day: DAY,
  });
  assert.equal(result.status, 'written');
  const user = adapter.calls[0].user;
  assert.match(user, /remaining activities omitted/);
  assert.ok(
    user.length < DAILY_BRIEF_MAX_ACTIVITY_CHARS + 400,
    `prompt stays bounded (was ${String(user.length)} characters)`,
  );
});

const WEEKLY_ANSWER = 'A focused week on the journal importer.\n\nMost days went into the importer and its tests.\n\nNext week: finish the migration and write the docs.';

test('the weekly brief writes one week row keyed by its Monday', async () => {
  const fixture = createFixture();
  const specs: ActivitySpec[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    specs.push({
      day: formatDayKey(addDays(dayStart(MONDAY), offset)),
      sourceKey: `week-card-${String(offset)}`,
      title: `Day ${String(offset)} work`,
      category: offset < 5 ? 'Work' : 'Personal',
      hoursFromDayStart: 6,
      minutes: 60,
    });
  }
  seedActivities(fixture.journalPath, specs);
  const adapter = createFakeLlmAdapter([WEEKLY_ANSWER]);
  const result = await writeWeeklyBrief({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    monday: MONDAY,
  });

  assert.equal(result.status, 'written');
  assert.equal(adapter.calls.length, 1);
  const user = adapter.calls[0].user;
  assert.match(user, /Week: 2026-10-19 to 2026-10-25/);
  assert.match(user, /## 2026-10-19/);
  assert.match(user, /## 2026-10-25/);
  assert.match(user, /Category totals/);
  assert.match(user, /Work 300m/);

  const rows = briefRows(fixture.journalPath);
  assert.equal(rows.length, 1);
  const row = rows[0] as TestRow;
  assert.equal(row.kind, 'week');
  assert.equal(row.period_key, MONDAY);
  assert.equal(row.title, `Week of ${MONDAY}`);
  assert.equal(row.body, WEEKLY_ANSWER);
  assert.doesNotMatch(row.body, /Memory health:/);
  assert.equal(briefPayload(row)?.memory_health, undefined);
  assert.equal(row.model, 'fake-model');
  assert.equal(row.source_id, 'native');
  assert.equal(row.source_key, weeklyBriefSourceKey(MONDAY));
  assert.equal(result.briefId, row.id);
  assert.equal(result.model, 'fake-model');
  assert.deepEqual(weekDayKeys(MONDAY), [
    '2026-10-19',
    '2026-10-20',
    '2026-10-21',
    '2026-10-22',
    '2026-10-23',
    '2026-10-24',
    '2026-10-25',
  ]);
});

test('a second weekly run is a no-op, and force rewrites the one row', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [
    { sourceKey: 'monday-card', title: 'Monday work' },
    { day: '2026-10-20', sourceKey: 'tuesday-card', title: 'Tuesday work' },
  ]);
  const adapter = createFakeLlmAdapter([WEEKLY_ANSWER, 'A rewritten week.\n\nNext week: rest.']);
  const options = {
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    monday: MONDAY,
  };
  const first = await writeWeeklyBrief(options);
  const second = await writeWeeklyBrief(options);
  assert.equal(first.status, 'written');
  assert.equal(second.status, 'skipped');
  assert.equal(second.reason, 'already-written');
  assert.equal(second.briefId, first.briefId);
  assert.equal(adapter.calls.length, 1);
  assert.equal(briefRows(fixture.journalPath).length, 1);

  const forced = await writeWeeklyBrief({ ...options, force: true });
  assert.equal(forced.status, 'written');
  assert.equal(forced.briefId, first.briefId);
  const rows = briefRows(fixture.journalPath);
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as TestRow).body, 'A rewritten week.\n\nNext week: rest.');
  assert.equal(adapter.calls.length, 2);
});

/** The digest a weekly lint pass hands the brief. */
const MEMORY_HEALTH = {
  findings: 3,
  proposals: 2,
  summary: '3 findings across 2 claims (2 proposals).',
};

/** The digest a later lint pass reports for the same week. */
const NEXT_MEMORY_HEALTH = {
  findings: 1,
  proposals: 1,
  summary: '1 finding across 1 claim (1 proposal).',
};

test('the weekly brief appends exactly one memory-health paragraph and records its payload', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [
    { sourceKey: 'monday-card', title: 'Monday work' },
    { day: '2026-10-20', sourceKey: 'tuesday-card', title: 'Tuesday work' },
  ]);
  const adapter = createFakeLlmAdapter([WEEKLY_ANSWER]);
  const result = await writeWeeklyBrief({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    monday: MONDAY,
    memoryHealth: MEMORY_HEALTH,
  });

  assert.equal(result.status, 'written');
  assert.equal(adapter.calls.length, 1);
  // The digest belongs to the lint pass, not the prompt: the model never sees it.
  assert.doesNotMatch(adapter.calls[0].user, /Memory health/);
  assert.doesNotMatch(adapter.calls[0].system, /Memory health/);
  assert.deepEqual(result.memoryHealth, MEMORY_HEALTH);

  const rows = briefRows(fixture.journalPath);
  assert.equal(rows.length, 1);
  const row = rows[0] as TestRow;
  assert.equal(row.body, `${WEEKLY_ANSWER}\n\nMemory health: ${MEMORY_HEALTH.summary}`);
  const segments = String(row.body).match(/Memory health:/g) ?? [];
  assert.equal(segments.length, 1, 'the body carries the digest exactly once');
  assert.ok(String(row.body).endsWith(`Memory health: ${MEMORY_HEALTH.summary}`), 'the digest is the last paragraph');
  assert.deepEqual(briefPayload(row)?.memory_health, MEMORY_HEALTH);
});

test('a changed digest never rewrites an existing brief without force, and force refreshes it', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [
    { sourceKey: 'monday-card', title: 'Monday work' },
    { day: '2026-10-20', sourceKey: 'tuesday-card', title: 'Tuesday work' },
  ]);
  const adapter = createFakeLlmAdapter([WEEKLY_ANSWER, 'A rewritten week.\n\nNext week: rest.']);
  const options = {
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    monday: MONDAY,
    memoryHealth: MEMORY_HEALTH,
  };
  const first = await writeWeeklyBrief(options);
  assert.equal(first.status, 'written');

  // Same Monday, different digest, no force: still the same idempotent no-op,
  // and neither the body nor the payload of the stored brief changes.
  const skipped = await writeWeeklyBrief({ ...options, memoryHealth: NEXT_MEMORY_HEALTH });
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.reason, 'already-written');
  assert.equal(skipped.briefId, first.briefId);
  assert.equal(adapter.calls.length, 1);
  const unchanged = briefRows(fixture.journalPath);
  assert.equal(unchanged.length, 1);
  assert.equal((unchanged[0] as TestRow).body, `${WEEKLY_ANSWER}\n\nMemory health: ${MEMORY_HEALTH.summary}`);
  assert.deepEqual(briefPayload(unchanged[0] as TestRow)?.memory_health, MEMORY_HEALTH);

  const forced = await writeWeeklyBrief({ ...options, memoryHealth: NEXT_MEMORY_HEALTH, force: true });
  assert.equal(forced.status, 'written');
  assert.equal(forced.briefId, first.briefId);
  assert.equal(adapter.calls.length, 2);
  assert.deepEqual(forced.memoryHealth, NEXT_MEMORY_HEALTH);
  const rows = briefRows(fixture.journalPath);
  assert.equal(rows.length, 1);
  const row = rows[0] as TestRow;
  assert.equal(
    row.body,
    `A rewritten week.\n\nNext week: rest.\n\nMemory health: ${NEXT_MEMORY_HEALTH.summary}`,
  );
  assert.equal((String(row.body).match(/Memory health:/g) ?? []).length, 1);
  assert.deepEqual(briefPayload(row)?.memory_health, NEXT_MEMORY_HEALTH);
});

test('a non-Monday period is rejected instead of becoming a second week row', async () => {
  const fixture = createFixture();
  seedActivities(fixture.journalPath, [{ sourceKey: 'monday-card', title: 'Monday work' }]);
  const adapter = createFakeLlmAdapter([WEEKLY_ANSWER]);
  await assert.rejects(
    writeWeeklyBrief({
      journalPath: fixture.journalPath,
      config: fixture.config,
      analyser: adapter,
      monday: '2026-10-20',
    }),
    isInvalidInput,
  );
  await assert.rejects(
    writeWeeklyBrief({
      journalPath: fixture.journalPath,
      config: fixture.config,
      analyser: adapter,
      monday: '2026-02-30',
    }),
    isInvalidInput,
  );
  assert.equal(adapter.calls.length, 0);
  assert.equal(briefRows(fixture.journalPath).length, 0);
});

test('a week with no activity is empty, gated weeks never call the model', async () => {
  const fixture = createFixture();
  const adapter = createFakeLlmAdapter([WEEKLY_ANSWER]);
  const empty = await writeWeeklyBrief({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    monday: EMPTY_WEEK_MONDAY,
  });
  assert.equal(empty.status, 'empty');
  assert.equal(adapter.calls.length, 0);
  assert.equal(briefRows(fixture.journalPath).length, 0);

  const blocked = createFixture({ analysis: { consent: 'none' } });
  seedActivities(blocked.journalPath, [{ sourceKey: 'monday-card', title: 'Monday work' }]);
  const blockedResult = await writeWeeklyBrief({
    journalPath: blocked.journalPath,
    config: blocked.config,
    analyser: adapter,
    monday: MONDAY,
  });
  assert.equal(blockedResult.status, 'skipped');
  assert.equal(blockedResult.reason, 'consent:none');
  assert.equal(adapter.calls.length, 0);
  assert.equal(briefRows(blocked.journalPath).length, 0);
});

test('the weekly prompt is bounded even for a very busy week', async () => {
  const fixture = createFixture();
  const specs: ActivitySpec[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const key = formatDayKey(addDays(dayStart(MONDAY), offset));
    for (let index = 0; index < 20; index += 1) {
      specs.push({
        day: key,
        sourceKey: `busy-${String(offset)}-${String(index)}`,
        title: `Busy activity ${String(offset)}-${String(index)} ${'y'.repeat(180)}`,
        hoursFromDayStart: index % 20,
        minutes: 12,
      });
    }
  }
  seedActivities(fixture.journalPath, specs);
  const adapter = createFakeLlmAdapter([WEEKLY_ANSWER]);
  const result = await writeWeeklyBrief({
    journalPath: fixture.journalPath,
    config: fixture.config,
    analyser: adapter,
    monday: MONDAY,
  });
  assert.equal(result.status, 'written');
  assert.match(adapter.calls[0].user, /remaining days omitted/);
  assert.ok(adapter.calls[0].user.length < 11_000, 'weekly prompt stays bounded');
});
