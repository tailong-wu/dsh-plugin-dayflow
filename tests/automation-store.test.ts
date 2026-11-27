/**
 * Owned journal schema v10 (`automation_runs`, `briefs`) and the automation store.
 *
 * Two things are recorded: a run per scheduled job, and the brief the closing
 * job produced. Both are idempotent — `(job, day)` decides which run a tick
 * works on, `(kind, period_key)` decides which brief a regeneration rewrites —
 * and a run's retry cap (`attempts`) is what stops a permanently failing job
 * from calling a model forever. Schema v10 rebuilds `automation_runs` so the
 * weekly memory lint is a third job, and adds the briefs' JSON payload column.
 *
 * These tests use disposable journals under a temporary directory; they never
 * touch the default `$DSH_HOME` journal and never call a model.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DayflowError } from '../src/errors.js';
import type { DayflowErrorCode } from '../src/errors.js';
import { JOURNAL_SCHEMA_VERSION, openJournal, withJournal } from '../src/journal.js';
import {
  AUTOMATION_MAX_ATTEMPTS,
  AUTOMATION_MAX_ERROR_CHARS,
  completeAutomationRun,
  ensureAutomationRun,
  failAutomationRun,
  getAutomationRun,
  getBrief,
  listAutomationRuns,
  listBriefs,
  skipAutomationRun,
  startAutomationRun,
  upsertBrief,
} from '../src/automation/store.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-automation-store-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let fileCounter = 0;

/** A fresh journal path inside the disposable directory. */
function journalFile(label: string): string {
  fileCounter += 1;
  return join(directory, `${label}-${fileCounter}.sqlite`);
}

interface Row {
  readonly [key: string]: unknown;
}

/** Open a fresh, migrated journal for one test. */
function openTempJournal(label: string): DatabaseSync {
  return openJournal(journalFile(label));
}

/** Read one row from a journal file with one short-lived raw connection. */
function queryRow(path: string, sql: string, ...parameters: (string | number)[]): Row | undefined {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).get(...(parameters as never[])) as Row | undefined;
  } finally {
    db.close();
  }
}

/** Run one assertion with a Dayflow failure code. */
function expectCode(run: () => unknown, code: DayflowErrorCode): void {
  assert.throws(run, (error: unknown) => error instanceof DayflowError && error.code === code);
}

/** How many tables of this exact name the journal has. */
function tableCountIn(db: DatabaseSync, table: string): number {
  return Number(
    (
      db
        .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as Row
    ).count,
  );
}

/** The names of the journal's indexes matching a prefix, sorted. */
function indexNamesIn(db: DatabaseSync, prefix: string): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE ? ORDER BY name")
      .all(`${prefix}%`) as Row[]
  ).map((row) => String(row.name));
}

/** A value JSON cannot serialize, for the payload-validation tests. */
function circularValue(): unknown {
  const value: Record<string, unknown> = {};
  value.self = value;
  return value;
}

/**
 * The v9 shapes of the two automation tables, used to rewind a fresh journal to
 * exactly what an installed 0.7.4 leaves behind: `automation_runs.job` only
 * accepts the two closing jobs, and `briefs` has no `payload_json`.
 */
const V9_AUTOMATION_TABLES = `
  CREATE TABLE automation_runs (
    id INTEGER PRIMARY KEY,
    job TEXT NOT NULL CHECK (job IN ('day_close','week_close')),
    day TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','running','complete','failed','skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job, day)
  );
  CREATE INDEX automation_runs_day_idx ON automation_runs (day);
  CREATE TABLE briefs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('day','week')),
    period_key TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    model TEXT,
    source_id TEXT NOT NULL DEFAULT 'native',
    source_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (kind, period_key)
  );
`;

test('a fresh journal is schema v10 and carries the automation tables', () => {
  const path = journalFile('fresh');
  const db = openJournal(path);
  try {
    assert.equal(JOURNAL_SCHEMA_VERSION, 10);
    assert.equal(Number(db.prepare('SELECT version FROM schema_version ORDER BY version LIMIT 1').get()?.version), 10);
    assert.equal(tableCountIn(db, 'automation_runs'), 1);
    assert.equal(tableCountIn(db, 'briefs'), 1);
    assert.deepEqual(indexNamesIn(db, 'automation_runs_'), ['automation_runs_day_idx']);
    // The rebuild in migration 10 left no staging table behind.
    assert.equal(tableCountIn(db, 'automation_runs_v10'), 0);
    // Both tables start empty: automation is opt-in.
    assert.equal(listAutomationRuns(db).length, 0);
    assert.equal(listBriefs(db).length, 0);
    const run = ensureAutomationRun(db, 'day_close', '2026-03-11');
    assert.equal(run.status, 'pending');
    assert.equal(run.attempts, 0);
    assert.equal(run.payload, undefined);
    assert.equal(getBrief(db, 'day', '2026-03-11'), undefined);
    // The v10 job CHECK accepts the weekly lint job.
    const lintRun = ensureAutomationRun(db, 'lint', '2026-03-09');
    assert.equal(lintRun.job, 'lint');
    assert.equal(startAutomationRun(db, lintRun.id).status, 'running');
    // The briefs payload column exists and is absent on a brief that wrote none.
    const payloadColumn = db
      .prepare("SELECT name FROM pragma_table_info('briefs') WHERE name = 'payload_json'")
      .get() as Row | undefined;
    assert.equal(payloadColumn?.name, 'payload_json');
    const brief = upsertBrief(db, {
      kind: 'day',
      periodKey: '2026-03-11',
      title: 'Wednesday, in short',
      body: 'A day.',
      sourceKey: 'timeline:2026-03-11',
    });
    assert.equal(brief.payload, undefined);
  } finally {
    db.close();
  }
  // Reopening a v10 journal is a no-op that keeps its rows.
  const reopened = openJournal(path);
  try {
    assert.equal(getAutomationRun(reopened, 'day_close', '2026-03-11')?.id, 1);
    assert.equal(getAutomationRun(reopened, 'lint', '2026-03-09')?.job, 'lint');
  } finally {
    reopened.close();
  }
  // The read path (withJournal's journalReady) accepts the migrated file.
  const viaRead = withJournal(path, (inner) => getAutomationRun(inner, 'day_close', '2026-03-11'));
  assert.equal(viaRead?.day, '2026-03-11');
});

test('a v8 journal migrates to v10 in one step and keeps its data', () => {
  const path = journalFile('v8-upgrade');
  const legacy = openJournal(path);
  try {
    legacy.prepare(
      `INSERT INTO activities (source_key, start_ts, end_ts, day, title, summary)
       VALUES ('legacy-card', 1_772_000_000, 1_772_000_600, '2026-03-11', 'Legacy activity', 'Kept')`,
    ).run();
    legacy.prepare("INSERT INTO capture_state (key, value) VALUES ('paused', '1')").run();
    legacy
      .prepare(
        `INSERT INTO analysis_jobs (job_key, day, window_start_ts, window_end_ts, status, attempts)
         VALUES ('2026-03-11:1000', '2026-03-11', 1000, 1600, 'complete', 1)`,
      )
      .run();
    // Rewind to exactly what an installed 0.7.3 journal looks like: v8, before
    // the automation tables existed.
    legacy.exec('DROP TABLE automation_runs');
    legacy.exec('DROP TABLE briefs');
    legacy.prepare('UPDATE schema_version SET version = 8').run();
  } finally {
    legacy.close();
  }
  assert.equal(Number(queryRow(path, 'SELECT version FROM schema_version ORDER BY version LIMIT 1')?.version), 8);

  const upgraded = openJournal(path);
  try {
    assert.equal(Number(upgraded.prepare('SELECT version FROM schema_version ORDER BY version LIMIT 1').get()?.version), 10);
    assert.equal(tableCountIn(upgraded, 'automation_runs'), 1);
    assert.equal(tableCountIn(upgraded, 'briefs'), 1);
    // Every earlier row survives the upgrade.
    assert.equal(Number(upgraded.prepare('SELECT COUNT(*) AS count FROM activities').get()?.count), 1);
    assert.equal(upgraded.prepare("SELECT value FROM capture_state WHERE key = 'paused'").get()?.value, '1');
    assert.equal(Number(upgraded.prepare('SELECT COUNT(*) AS count FROM analysis_jobs').get()?.count), 1);
    // The new tables work against the upgraded file.
    const run = ensureAutomationRun(upgraded, 'week_close', '2026-03-09');
    assert.equal(startAutomationRun(upgraded, run.id).attempts, 1);
    const brief = upsertBrief(upgraded, {
      kind: 'day',
      periodKey: '2026-03-11',
      title: 'Wednesday, in short',
      body: 'A day.',
      sourceKey: 'timeline:2026-03-11',
    });
    assert.equal(brief.kind, 'day');
  } finally {
    upgraded.close();
  }
  // Opening again is a no-op that keeps the rows written after the migration.
  const reopened = openJournal(path);
  try {
    assert.equal(Number(reopened.prepare('SELECT version FROM schema_version ORDER BY version LIMIT 1').get()?.version), 10);
    assert.equal(listAutomationRuns(reopened).length, 1);
    assert.equal(listBriefs(reopened).length, 1);
    assert.equal(Number(reopened.prepare('SELECT COUNT(*) AS count FROM activities').get()?.count), 1);
  } finally {
    reopened.close();
  }
});

test('a v9 journal rebuilds automation_runs for lint and adds the briefs payload column', () => {
  const path = journalFile('v9-upgrade');
  const seeded = openJournal(path);
  try {
    // Rewind the two automation tables to their exact 0.7.4 shapes and version.
    seeded.exec('DROP TABLE automation_runs');
    seeded.exec('DROP TABLE briefs');
    seeded.exec(V9_AUTOMATION_TABLES);
    seeded
      .prepare(
        `INSERT INTO automation_runs (id, job, day, status, attempts, error, payload_json, created_at, updated_at)
         VALUES (1, 'day_close', '2026-03-11', 'complete', 1, NULL, '{"title":"Done"}',
                 '2026-03-11 21:00:00', '2026-03-11 21:00:01')`,
      )
      .run();
    seeded
      .prepare(
        `INSERT INTO automation_runs (id, job, day, status, attempts, error)
         VALUES (2, 'week_close', '2026-03-09', 'failed', 2, 'model unavailable')`,
      )
      .run();
    seeded
      .prepare(
        `INSERT INTO briefs (id, kind, period_key, title, body, model, source_key)
         VALUES (1, 'day', '2026-03-11', 'Wednesday, in short', 'A day.', 'gpt-test', 'timeline:2026-03-11')`,
      )
      .run();
    seeded.prepare('UPDATE schema_version SET version = 9').run();
  } finally {
    seeded.close();
  }

  // The v9 file really is v9: its job CHECK refuses lint and briefs has no payload.
  const legacy = new DatabaseSync(path);
  try {
    assert.throws(() => legacy.prepare("INSERT INTO automation_runs (job, day) VALUES ('lint', '2026-11-16')").run());
    assert.equal(legacy.prepare("SELECT name FROM pragma_table_info('briefs') WHERE name = 'payload_json'").get(), undefined);
  } finally {
    legacy.close();
  }

  const upgraded = openJournal(path);
  try {
    assert.equal(Number(upgraded.prepare('SELECT version FROM schema_version ORDER BY version LIMIT 1').get()?.version), 10);
    // The rebuild keeps every row, column, and value in place.
    const completeRow = upgraded.prepare('SELECT * FROM automation_runs WHERE id = 1').get() as Row;
    assert.equal(completeRow.job, 'day_close');
    assert.equal(completeRow.day, '2026-03-11');
    assert.equal(completeRow.status, 'complete');
    assert.equal(completeRow.attempts, 1);
    assert.equal(completeRow.error, null);
    assert.equal(completeRow.payload_json, '{"title":"Done"}');
    assert.equal(completeRow.created_at, '2026-03-11 21:00:00');
    assert.equal(completeRow.updated_at, '2026-03-11 21:00:01');
    const failedRow = upgraded.prepare('SELECT * FROM automation_runs WHERE id = 2').get() as Row;
    assert.equal(failedRow.status, 'failed');
    assert.equal(failedRow.attempts, 2);
    assert.equal(failedRow.error, 'model unavailable');
    assert.equal(Number(upgraded.prepare('SELECT COUNT(*) AS count FROM automation_runs').get()?.count), 2);
    // The rebuilt table has exactly the v9 columns, in the same order.
    assert.deepEqual(
      (upgraded.prepare("SELECT name FROM pragma_table_info('automation_runs') ORDER BY cid").all() as Row[]).map(
        (row) => row.name,
      ),
      ['id', 'job', 'day', 'status', 'attempts', 'error', 'payload_json', 'created_at', 'updated_at'],
    );
    // The rebuilt table is the only one left and its day index is back.
    assert.equal(tableCountIn(upgraded, 'automation_runs_v10'), 0);
    assert.deepEqual(indexNamesIn(upgraded, 'automation_runs_'), ['automation_runs_day_idx']);
    // The old unique key still holds across the rebuild.
    assert.throws(() => upgraded.prepare("INSERT INTO automation_runs (job, day) VALUES ('day_close', '2026-03-11')").run());
    // The new job is accepted by the rebuilt CHECK and works through the store.
    const lintRun = ensureAutomationRun(upgraded, 'lint', '2026-11-16');
    assert.equal(lintRun.job, 'lint');
    assert.equal(startAutomationRun(upgraded, lintRun.id).attempts, 1);
    assert.equal(completeAutomationRun(upgraded, lintRun.id, { findings: 0 }).status, 'complete');
    // The v9 brief keeps its row; the nullable payload column reads as absent.
    const brief = getBrief(upgraded, 'day', '2026-03-11');
    assert.equal(brief?.title, 'Wednesday, in short');
    assert.equal(brief?.model, 'gpt-test');
    assert.equal(brief?.payload, undefined);
    assert.equal((upgraded.prepare('SELECT payload_json FROM briefs WHERE id = 1').get() as Row).payload_json, null);
    assert.equal(Number(upgraded.prepare('SELECT COUNT(*) AS count FROM briefs').get()?.count), 1);
  } finally {
    upgraded.close();
  }

  // Reopening a v10 journal does no migration work and keeps the rows.
  const reopened = openJournal(path);
  try {
    assert.equal(Number(reopened.prepare('SELECT version FROM schema_version ORDER BY version LIMIT 1').get()?.version), 10);
    assert.equal(listAutomationRuns(reopened).length, 3);
    assert.equal(listBriefs(reopened).length, 1);
  } finally {
    reopened.close();
  }
});

test('the lint job is a first-class ledger job', () => {
  const db = openTempJournal('lint-job');
  try {
    const run = ensureAutomationRun(db, 'lint', '2026-11-16');
    assert.equal(run.job, 'lint');
    assert.equal(run.status, 'pending');
    assert.equal(run.attempts, 0);
    // The same (job, week) is one row; the next Monday is another.
    assert.equal(ensureAutomationRun(db, 'lint', '2026-11-16').id, run.id);
    const nextWeek = ensureAutomationRun(db, 'lint', '2026-11-23');
    assert.notEqual(nextWeek.id, run.id);

    const started = startAutomationRun(db, run.id);
    assert.equal(started.status, 'running');
    assert.equal(started.attempts, 1);
    const payload = { scanned: 6, findings: 5, proposals: 3, summary: '5 findings across 6 active claims; 3 proposals queued.' };
    const completed = completeAutomationRun(db, run.id, payload);
    assert.equal(completed.status, 'complete');
    assert.deepEqual(completed.payload, payload);
    assert.equal(getAutomationRun(db, 'lint', '2026-11-16')?.status, 'complete');

    assert.deepEqual(
      listAutomationRuns(db, { job: 'lint' }).map((item) => item.id).sort((left, right) => left - right),
      [run.id, nextWeek.id].sort((left, right) => left - right),
    );
    assert.deepEqual(
      listAutomationRuns(db, { job: 'lint', status: 'pending' }).map((item) => item.id),
      [nextWeek.id],
    );
    assert.equal(listAutomationRuns(db, { job: 'day_close' }).length, 0);

    // The CHECK still refuses a job name the store does not know.
    assert.throws(() => db.prepare("INSERT INTO automation_runs (job, day) VALUES ('month_close', '2026-11-30')").run());
    expectCode(() => ensureAutomationRun(db, 'month_close' as never, '2026-11-16'), 'invalid_input');
  } finally {
    db.close();
  }
});

test('a brief payload round-trips as JSON and is optional', () => {
  const db = openTempJournal('brief-payload');
  try {
    const payload = { memory_health: { findings: 3, proposals: 2, summary: '3 findings across 6 active claims; 2 proposals queued.' } };
    const first = upsertBrief(db, {
      kind: 'week',
      periodKey: '2026-03-09',
      title: 'Week of March 9',
      body: 'The week.',
      payload,
      sourceKey: 'timeline:week:2026-03-09',
    });
    assert.deepEqual(first.payload, payload);
    assert.deepEqual(getBrief(db, 'week', '2026-03-09')?.payload, payload);
    assert.deepEqual(listBriefs(db, { kind: 'week' })[0]?.payload, payload);

    // Rewriting without a payload clears it: the row holds the latest result.
    const cleared = upsertBrief(db, {
      kind: 'week',
      periodKey: '2026-03-09',
      title: 'Week of March 9',
      body: 'The week, revised.',
      sourceKey: 'timeline:week:2026-03-09',
    });
    assert.equal(cleared.id, first.id);
    assert.equal(cleared.payload, undefined);
    assert.equal(getBrief(db, 'week', '2026-03-09')?.payload, undefined);

    // A payload JSON cannot represent is refused before the row changes.
    expectCode(
      () =>
        upsertBrief(db, {
          kind: 'week',
          periodKey: '2026-03-09',
          title: 'Week of March 9',
          body: 'The week, revised.',
          payload: circularValue(),
          sourceKey: 'timeline:week:2026-03-09',
        }),
      'invalid_input',
    );
    assert.equal(getBrief(db, 'week', '2026-03-09')?.body, 'The week, revised.');

    // An unreadable payload does not make the readable brief fail.
    db.prepare("UPDATE briefs SET payload_json = '{not json' WHERE id = ?").run(first.id);
    assert.equal(getBrief(db, 'week', '2026-03-09')?.payload, undefined);
    assert.equal(listBriefs(db).length, 1);
    db.prepare("UPDATE briefs SET payload_json = 'null' WHERE id = ?").run(first.id);
    assert.equal(getBrief(db, 'week', '2026-03-09')?.payload, undefined);
  } finally {
    db.close();
  }
});

test('ensuring a run is idempotent and validates its job and day', () => {
  const db = openTempJournal('ensure');
  try {
    const first = ensureAutomationRun(db, 'day_close', '2026-03-11');
    const second = ensureAutomationRun(db, 'day_close', '2026-03-11');
    assert.equal(second.id, first.id);
    assert.equal(second.status, 'pending');
    assert.equal(second.attempts, 0);

    // A later ensure never resets a run that has moved on.
    startAutomationRun(db, first.id);
    completeAutomationRun(db, first.id, { title: 'Done' });
    const third = ensureAutomationRun(db, 'day_close', '2026-03-11');
    assert.equal(third.id, first.id);
    assert.equal(third.status, 'complete');

    // The other job and the other day are separate rows.
    const week = ensureAutomationRun(db, 'week_close', '2026-03-11');
    const nextDay = ensureAutomationRun(db, 'day_close', '2026-03-12');
    assert.notEqual(week.id, first.id);
    assert.notEqual(nextDay.id, first.id);
    assert.equal(listAutomationRuns(db).length, 3);

    assert.equal(getAutomationRun(db, 'day_close', '2026-03-11')?.id, first.id);
    assert.equal(getAutomationRun(db, 'week_close', '2026-03-11')?.id, week.id);
    assert.equal(getAutomationRun(db, 'day_close', '2026-03-13'), undefined);

    expectCode(() => ensureAutomationRun(db, 'month_close' as never, '2026-03-11'), 'invalid_input');
    expectCode(() => ensureAutomationRun(db, 'day_close', '2026-02-30'), 'invalid_input');
    expectCode(() => ensureAutomationRun(db, 'day_close', '11-03-2026'), 'invalid_input');
    expectCode(() => ensureAutomationRun(db, 'day_close', ''), 'invalid_input');
    expectCode(() => getAutomationRun(db, 'month_close' as never, '2026-03-11'), 'invalid_input');
    expectCode(() => getAutomationRun(db, 'week_close', 'not-a-day'), 'invalid_input');
    // None of the refusals wrote a row.
    assert.equal(listAutomationRuns(db).length, 3);
  } finally {
    db.close();
  }
});

test('start counts attempts, clears the error, and stops at the cap', () => {
  const db = openTempJournal('attempts');
  try {
    const run = ensureAutomationRun(db, 'day_close', '2026-03-11');

    const running = startAutomationRun(db, run.id);
    assert.equal(running.status, 'running');
    assert.equal(running.attempts, 1);
    assert.equal(running.error, undefined);

    const failed = failAutomationRun(db, run.id, 'first failure');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'first failure');
    assert.equal(failed.attempts, 1);

    const retried = startAutomationRun(db, run.id);
    assert.equal(retried.status, 'running');
    assert.equal(retried.attempts, 2);
    assert.equal(retried.error, undefined);

    failAutomationRun(db, run.id, 'second failure');
    expectCode(() => startAutomationRun(db, run.id), 'invalid_input');
    assert.equal(getAutomationRun(db, 'day_close', '2026-03-11')?.attempts, AUTOMATION_MAX_ATTEMPTS);

    // A running, complete, or skipped run cannot start again either.
    const runningRun = ensureAutomationRun(db, 'day_close', '2026-03-12');
    startAutomationRun(db, runningRun.id);
    expectCode(() => startAutomationRun(db, runningRun.id), 'invalid_input');

    const doneRun = ensureAutomationRun(db, 'day_close', '2026-03-13');
    completeAutomationRun(db, doneRun.id);
    expectCode(() => startAutomationRun(db, doneRun.id), 'invalid_input');

    const skippedRun = ensureAutomationRun(db, 'day_close', '2026-03-14');
    skipAutomationRun(db, skippedRun.id, 'automation disabled');
    expectCode(() => startAutomationRun(db, skippedRun.id), 'invalid_input');

    expectCode(() => startAutomationRun(db, 9_999), 'not_found');
    expectCode(() => startAutomationRun(db, 0), 'invalid_input');
    expectCode(() => startAutomationRun(db, 1.5 as never), 'invalid_input');
  } finally {
    db.close();
  }
});

test('complete records a JSON payload, skip records its reason, fail truncates', () => {
  const db = openTempJournal('complete');
  try {
    const run = ensureAutomationRun(db, 'day_close', '2026-03-11');
    startAutomationRun(db, run.id);
    const payload = { activities: 4, captured_at: '2026-03-11T21:00:00Z', nested: { ok: true } };
    const completed = completeAutomationRun(db, run.id, payload);
    assert.equal(completed.status, 'complete');
    assert.equal(completed.error, undefined);
    assert.equal(completed.attempts, 1);
    assert.deepEqual(completed.payload, payload);

    // Completing with no payload clears the earlier one: the row always holds
    // the latest successful result.
    const cleared = completeAutomationRun(db, run.id);
    assert.equal(cleared.status, 'complete');
    assert.equal(cleared.payload, undefined);
    assert.equal(cleared.attempts, 1);

    // A bigint becomes a number, the convention the importer already uses.
    const withBigint = completeAutomationRun(db, run.id, { count: 5n });
    assert.deepEqual(withBigint.payload, { count: 5 });

    const weekRun = ensureAutomationRun(db, 'week_close', '2026-03-09');
    const skipped = skipAutomationRun(db, weekRun.id, '  week still in progress  ');
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.error, 'week still in progress');
    assert.equal(skipped.attempts, 0);

    const failing = ensureAutomationRun(db, 'day_close', '2026-03-12');
    startAutomationRun(db, failing.id);
    const failed = failAutomationRun(db, failing.id, `prefix ${'x'.repeat(AUTOMATION_MAX_ERROR_CHARS * 2)}`);
    assert.equal(failed.error?.length, AUTOMATION_MAX_ERROR_CHARS);
    assert.ok(failed.error?.startsWith('prefix '));
    // A blank failure still leaves a readable message.
    assert.equal(failAutomationRun(db, failing.id, '   ').error, 'automation failed');

    // A payload JSON cannot represent is refused before the row changes.
    expectCode(() => completeAutomationRun(db, failing.id, circularValue()), 'invalid_input');
    assert.equal(getAutomationRun(db, 'day_close', '2026-03-12')?.status, 'failed');

    expectCode(() => completeAutomationRun(db, 9_999, { ok: true }), 'not_found');
    expectCode(() => failAutomationRun(db, 9_999, 'boom'), 'not_found');
    expectCode(() => skipAutomationRun(db, 9_999, 'no work'), 'not_found');
    expectCode(() => skipAutomationRun(db, weekRun.id, '   '), 'invalid_input');
    expectCode(() => failAutomationRun(db, weekRun.id, 42 as never), 'invalid_input');
    expectCode(() => completeAutomationRun(db, 0), 'invalid_input');
  } finally {
    db.close();
  }
});

test('list filters by job, day, and status, newest first, with a bounded limit', () => {
  const db = openTempJournal('list');
  try {
    const first = ensureAutomationRun(db, 'day_close', '2026-03-11');
    const second = ensureAutomationRun(db, 'day_close', '2026-03-12');
    const third = ensureAutomationRun(db, 'week_close', '2026-03-09');
    startAutomationRun(db, second.id);
    // Known timestamps keep the expected order from depending on how long the
    // three calls took (SQLite's CURRENT_TIMESTAMP has one-second resolution).
    db.prepare("UPDATE automation_runs SET updated_at = '2026-03-11 10:00:00' WHERE id = ?").run(first.id);
    db.prepare("UPDATE automation_runs SET updated_at = '2026-03-11 12:00:00' WHERE id = ?").run(second.id);
    db.prepare("UPDATE automation_runs SET updated_at = '2026-03-11 11:00:00' WHERE id = ?").run(third.id);

    assert.deepEqual(
      listAutomationRuns(db).map((run) => run.id),
      [second.id, third.id, first.id],
    );
    assert.deepEqual(
      listAutomationRuns(db, { job: 'day_close' }).map((run) => run.id),
      [second.id, first.id],
    );
    assert.deepEqual(
      listAutomationRuns(db, { job: 'week_close' }).map((run) => run.id),
      [third.id],
    );
    assert.deepEqual(
      listAutomationRuns(db, { day: '2026-03-11' }).map((run) => run.id),
      [first.id],
    );
    assert.deepEqual(
      listAutomationRuns(db, { status: 'running' }).map((run) => run.id),
      [second.id],
    );
    assert.deepEqual(
      listAutomationRuns(db, { status: 'pending' }).map((run) => run.id),
      [third.id, first.id],
    );
    assert.equal(listAutomationRuns(db, { limit: 1 }).length, 1);
    assert.equal(listAutomationRuns(db, { limit: 200 }).length, 3);

    expectCode(() => listAutomationRuns(db, { limit: 0 }), 'invalid_input');
    expectCode(() => listAutomationRuns(db, { limit: 201 }), 'invalid_input');
    expectCode(() => listAutomationRuns(db, { limit: 1.5 }), 'invalid_input');
    expectCode(() => listAutomationRuns(db, { status: 'bogus' as never }), 'invalid_input');
    expectCode(() => listAutomationRuns(db, { job: 'month_close' as never }), 'invalid_input');
    expectCode(() => listAutomationRuns(db, { day: '2026-02-30' }), 'invalid_input');
  } finally {
    db.close();
  }
});

test('brief upsert is idempotent and rewrites the row in place', () => {
  const db = openTempJournal('briefs');
  try {
    const first = upsertBrief(db, {
      kind: 'day',
      periodKey: '2026-03-11',
      title: 'First title',
      body: 'First body',
      sourceKey: 'timeline:2026-03-11',
    });
    assert.equal(first.source_id, 'native');
    assert.equal(first.model, undefined);

    const rewritten = upsertBrief(db, {
      kind: 'day',
      periodKey: '2026-03-11',
      title: '  Revised title  ',
      body: 'Revised body',
      model: ' gpt-test ',
      sourceKey: 'timeline:revised',
    });
    assert.equal(rewritten.id, first.id);
    assert.equal(rewritten.title, 'Revised title');
    assert.equal(rewritten.body, 'Revised body');
    assert.equal(rewritten.model, 'gpt-test');
    assert.equal(rewritten.source_key, 'timeline:revised');
    assert.equal(rewritten.created_at, first.created_at);
    assert.equal(Number((db.prepare('SELECT COUNT(*) AS count FROM briefs').get() as Row).count), 1);

    // A week brief is a different row; the day and week kinds never collide.
    const week = upsertBrief(db, {
      kind: 'week',
      periodKey: '2026-03-09',
      title: 'Week of March 9',
      body: '',
      sourceKey: 'timeline:week:2026-03-09',
    });
    assert.notEqual(week.id, first.id);
    assert.equal(week.body, '');

    assert.equal(getBrief(db, 'day', '2026-03-11')?.title, 'Revised title');
    assert.equal(getBrief(db, 'week', '2026-03-09')?.id, week.id);
    assert.equal(getBrief(db, 'week', '2026-03-11'), undefined);

    db.prepare("UPDATE briefs SET updated_at = '2026-03-11 10:00:00' WHERE id = ?").run(first.id);
    db.prepare("UPDATE briefs SET updated_at = '2026-03-11 12:00:00' WHERE id = ?").run(week.id);
    assert.deepEqual(
      listBriefs(db).map((brief) => brief.id),
      [week.id, first.id],
    );
    assert.deepEqual(
      listBriefs(db, { kind: 'day' }).map((brief) => brief.id),
      [first.id],
    );
    assert.deepEqual(
      listBriefs(db, { kind: 'week' }).map((brief) => brief.id),
      [week.id],
    );
    assert.equal(listBriefs(db, { limit: 1 }).length, 1);

    const valid = {
      kind: 'day' as const,
      periodKey: '2026-03-12',
      title: 'A title',
      body: 'A body',
      sourceKey: 'timeline:2026-03-12',
    };
    expectCode(() => upsertBrief(db, { ...valid, kind: 'month' as never }), 'invalid_input');
    expectCode(() => upsertBrief(db, { ...valid, periodKey: '2026-02-30' }), 'invalid_input');
    expectCode(() => upsertBrief(db, { ...valid, periodKey: '' }), 'invalid_input');
    expectCode(() => upsertBrief(db, { ...valid, title: '   ' }), 'invalid_input');
    expectCode(() => upsertBrief(db, { ...valid, body: 42 as never }), 'invalid_input');
    expectCode(() => upsertBrief(db, { ...valid, sourceKey: '' }), 'invalid_input');
    expectCode(() => upsertBrief(db, { ...valid, model: 42 as never }), 'invalid_input');
    expectCode(() => upsertBrief(db, undefined as never), 'invalid_input');
    expectCode(() => getBrief(db, 'month' as never, '2026-03-11'), 'invalid_input');
    expectCode(() => getBrief(db, 'day', '11-03-2026'), 'invalid_input');
    expectCode(() => listBriefs(db, { kind: 'month' as never }), 'invalid_input');
    expectCode(() => listBriefs(db, { limit: 0 }), 'invalid_input');
    expectCode(() => listBriefs(db, { limit: 201 }), 'invalid_input');
    // None of the refusals wrote a row.
    assert.equal(Number((db.prepare('SELECT COUNT(*) AS count FROM briefs').get() as Row).count), 2);
  } finally {
    db.close();
  }
});

test('a malformed row is a database error, not a missing run or brief', () => {
  const db = openTempJournal('malformed');
  try {
    const run = ensureAutomationRun(db, 'day_close', '2026-03-11');
    const brief = upsertBrief(db, {
      kind: 'day',
      periodKey: '2026-03-11',
      title: 'Healthy',
      body: 'Healthy body',
      sourceKey: 'timeline:2026-03-11',
    });
    // The tables carry CHECK constraints, so a hand-edited journal has to
    // bypass them to reproduce a row no reader understands.
    db.exec('PRAGMA ignore_check_constraints = ON');

    db.prepare("UPDATE automation_runs SET status = 'bogus' WHERE id = ?").run(run.id);
    expectCode(() => getAutomationRun(db, 'day_close', '2026-03-11'), 'database_error');
    expectCode(() => listAutomationRuns(db), 'database_error');
    expectCode(() => startAutomationRun(db, run.id), 'database_error');

    db.prepare("UPDATE automation_runs SET status = 'pending', day = '2026-02-30' WHERE id = ?").run(run.id);
    expectCode(() => listAutomationRuns(db), 'database_error');

    db.prepare("UPDATE automation_runs SET day = '2026-03-11', job = 'bogus' WHERE id = ?").run(run.id);
    expectCode(() => listAutomationRuns(db), 'database_error');

    db.prepare("UPDATE automation_runs SET job = 'day_close', attempts = -1 WHERE id = ?").run(run.id);
    expectCode(() => listAutomationRuns(db), 'database_error');

    // A TEXT column keeps text, so a non-text value has to be a BLOB; a number
    // would be converted to '42' and read back as harmless text.
    const blob = new Uint8Array([0x7b, 0x7d]);
    db.prepare('UPDATE automation_runs SET attempts = 0, error = ? WHERE id = ?').run(blob, run.id);
    expectCode(() => listAutomationRuns(db), 'database_error');

    db.prepare("UPDATE automation_runs SET error = NULL, payload_json = '{not json' WHERE id = ?").run(run.id);
    expectCode(() => listAutomationRuns(db), 'database_error');

    db.prepare("UPDATE automation_runs SET payload_json = 'null' WHERE id = ?").run(run.id);
    assert.equal(listAutomationRuns(db)[0]?.payload, null);

    db.prepare('UPDATE automation_runs SET created_at = ? WHERE id = ?').run(blob, run.id);
    expectCode(() => listAutomationRuns(db), 'database_error');

    db.prepare("UPDATE briefs SET kind = 'bogus' WHERE id = ?").run(brief.id);
    expectCode(() => listBriefs(db), 'database_error');

    db.prepare("UPDATE briefs SET kind = 'day', period_key = '2026-02-30' WHERE id = ?").run(brief.id);
    expectCode(() => listBriefs(db), 'database_error');

    db.prepare("UPDATE briefs SET period_key = '2026-03-11', title = '   ' WHERE id = ?").run(brief.id);
    expectCode(() => listBriefs(db), 'database_error');

    db.prepare("UPDATE briefs SET title = 'Healthy', body = ? WHERE id = ?").run(blob, brief.id);
    expectCode(() => listBriefs(db), 'database_error');

    db.prepare("UPDATE briefs SET body = 'Healthy body', source_id = '' WHERE id = ?").run(brief.id);
    expectCode(() => listBriefs(db), 'database_error');

    db.prepare("UPDATE briefs SET source_id = 'native', source_key = ? WHERE id = ?").run(blob, brief.id);
    expectCode(() => listBriefs(db), 'database_error');
  } finally {
    db.close();
  }
});
