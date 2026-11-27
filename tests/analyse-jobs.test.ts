/**
 * Owned journal schema v8 (`analysis_jobs`) and the analysis-job ledger.
 *
 * The ledger is what makes frame analysis resumable and bounded: a unique
 * `job_key` makes replay idempotent, `status` is a five-state machine, and
 * `attempts` is the retry cap. The day's budget reads the same rows: a job that
 * was never started is not a call, a started one is.
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
  ANALYSIS_MAX_ATTEMPTS,
  ANALYSIS_MAX_ERROR_CHARS,
  analysisBudgetExhausted,
  analysisJobKey,
  analysisTokenTotalsForDay,
  completeAnalysisJob,
  countAnalysisCallsForDay,
  createAnalysisJob,
  failAnalysisJob,
  getAnalysisJob,
  listAnalysisJobs,
  skipAnalysisJob,
  startAnalysisJob,
} from '../src/analyse/jobs.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-analysis-jobs-'));
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

/** A job for one window of a fixed test day. */
function jobInput(startTs: number, endTs = startTs + 600): {
  jobKey: string;
  day: string;
  windowStartTs: number;
  windowEndTs: number;
} {
  return { jobKey: analysisJobKey('2026-03-11', startTs), day: '2026-03-11', windowStartTs: startTs, windowEndTs: endTs };
}

test('a fresh journal is schema v8 and carries the job ledger with indexes', () => {
  const path = journalFile('fresh');
  const db = openJournal(path);
  try {
    assert.equal(JOURNAL_SCHEMA_VERSION, 8);
    assert.equal(Number(db.prepare('SELECT version FROM schema_version ORDER BY version LIMIT 1').get()?.version), 8);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'analysis_jobs'")
      .all() as Row[];
    assert.equal(tables.length, 1);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'analysis_jobs_%' ORDER BY name")
      .all() as Row[];
    assert.deepEqual(
      indexes.map((row) => row.name),
      ['analysis_jobs_day_idx', 'analysis_jobs_status_idx'],
    );
    const job = createAnalysisJob(db, jobInput(1_772_000_000));
    assert.equal(job.status, 'queued');
    assert.equal(job.attempts, 0);
  } finally {
    db.close();
  }
  // Reopening a v8 journal is a no-op that keeps its rows.
  const reopened = openJournal(path);
  try {
    assert.equal(getAnalysisJob(reopened, analysisJobKey('2026-03-11', 1_772_000_000))?.id, 1);
  } finally {
    reopened.close();
  }
  // The read path (withJournal's journalReady) accepts the migrated file.
  const job = withJournal(path, (inner) => getAnalysisJob(inner, analysisJobKey('2026-03-11', 1_772_000_000)));
  assert.equal(job?.window_end_ts, 1_772_000_600);
});

test('a v7 journal migrates to v8 in one step and keeps its data', () => {
  const path = journalFile('v7-upgrade');
  const legacy = openJournal(path);
  try {
    legacy.prepare(
      `INSERT INTO activities (source_key, start_ts, end_ts, day, title, summary)
       VALUES ('legacy-card', 1_772_000_000, 1_772_000_600, '2026-03-11', 'Legacy activity', 'Kept')`,
    ).run();
    legacy.prepare("INSERT INTO capture_state (key, value) VALUES ('paused', '1')").run();
    // Rewind to exactly what an installed 0.7.0 journal looks like: v7 and no
    // analysis_jobs table (migration 7 only added capture_state).
    legacy.exec('DROP TABLE analysis_jobs');
    legacy.prepare('UPDATE schema_version SET version = 7').run();
  } finally {
    legacy.close();
  }
  assert.equal(Number(queryRow(path, 'SELECT version FROM schema_version ORDER BY version LIMIT 1')?.version), 7);

  const upgraded = openJournal(path);
  try {
    assert.equal(Number(upgraded.prepare('SELECT version FROM schema_version ORDER BY version LIMIT 1').get()?.version), 8);
    const tables = upgraded
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'analysis_jobs'")
      .all() as Row[];
    assert.equal(tables.length, 1);
    assert.equal(Number(upgraded.prepare('SELECT COUNT(*) AS count FROM activities').get()?.count), 1);
    assert.equal(upgraded.prepare("SELECT value FROM capture_state WHERE key = 'paused'").get()?.value, '1');
    // The new ledger works against the upgraded file.
    const job = createAnalysisJob(upgraded, jobInput(1_772_000_000));
    assert.equal(startAnalysisJob(upgraded, job.id).attempts, 1);
  } finally {
    upgraded.close();
  }
});

test('creating the same job key twice is idempotent', () => {
  const db = openTempJournal('idempotent');
  try {
    const input = jobInput(1_000);
    const first = createAnalysisJob(db, input);
    const second = createAnalysisJob(db, { ...input, windowEndTs: input.windowEndTs + 300 });
    assert.equal(second.id, first.id);
    assert.equal(second.window_end_ts, first.window_end_ts);
    assert.equal(second.attempts, 0);
    const listed = listAnalysisJobs(db);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.job_key, '2026-03-11:1000');
    assert.equal(getAnalysisJob(db, '2026-03-11:1000')?.id, first.id);
    assert.equal(getAnalysisJob(db, '2026-03-11:9999'), undefined);
  } finally {
    db.close();
  }
});

test('list filters by day and status, in window order, with a bounded limit', () => {
  const db = openTempJournal('list');
  try {
    const late = createAnalysisJob(db, jobInput(3_000));
    const early = createAnalysisJob(db, jobInput(1_000));
    const otherDay = createAnalysisJob(db, {
      jobKey: analysisJobKey('2026-03-12', 2_000),
      day: '2026-03-12',
      windowStartTs: 2_000,
      windowEndTs: 2_600,
    });
    startAnalysisJob(db, early.id);
    const ordered = listAnalysisJobs(db);
    assert.deepEqual(
      ordered.map((job) => job.id),
      [early.id, otherDay.id, late.id],
    );
    assert.deepEqual(
      listAnalysisJobs(db, { day: '2026-03-12' }).map((job) => job.id),
      [otherDay.id],
    );
    assert.deepEqual(
      listAnalysisJobs(db, { status: 'running' }).map((job) => job.id),
      [early.id],
    );
    assert.equal(listAnalysisJobs(db, { limit: 1 }).length, 1);
    expectCode(() => listAnalysisJobs(db, { limit: 0 }), 'invalid_input');
    expectCode(() => listAnalysisJobs(db, { limit: 501 }), 'invalid_input');
    expectCode(() => listAnalysisJobs(db, { status: 'bogus' as never }), 'invalid_input');
    expectCode(() => listAnalysisJobs(db, { day: '2026-02-30' }), 'invalid_input');
  } finally {
    db.close();
  }
});

test('start counts attempts, clears the error, and stops at the cap', () => {
  const db = openTempJournal('attempts');
  try {
    const job = createAnalysisJob(db, jobInput(1_000));

    const running = startAnalysisJob(db, job.id);
    assert.equal(running.status, 'running');
    assert.equal(running.attempts, 1);
    assert.equal(running.error, undefined);

    const failed = failAnalysisJob(db, job.id, 'first failure');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'first failure');

    const retried = startAnalysisJob(db, job.id);
    assert.equal(retried.status, 'running');
    assert.equal(retried.attempts, 2);
    assert.equal(retried.error, undefined);

    failAnalysisJob(db, job.id, 'second failure');
    expectCode(() => startAnalysisJob(db, job.id), 'invalid_input');
    assert.equal(getAnalysisJob(db, job.job_key)?.attempts, ANALYSIS_MAX_ATTEMPTS);

    // A running or complete job cannot start again either.
    const fresh = createAnalysisJob(db, jobInput(2_000));
    startAnalysisJob(db, fresh.id);
    expectCode(() => startAnalysisJob(db, fresh.id), 'invalid_input');
    const done = createAnalysisJob(db, jobInput(3_000));
    completeAnalysisJob(db, done.id);
    expectCode(() => startAnalysisJob(db, done.id), 'invalid_input');

    expectCode(() => startAnalysisJob(db, 9_999), 'not_found');
    expectCode(() => startAnalysisJob(db, 0), 'invalid_input');
  } finally {
    db.close();
  }
});

test('complete records model and tokens, skip records its reason', () => {
  const db = openTempJournal('complete');
  try {
    const a = createAnalysisJob(db, jobInput(1_000));
    const b = createAnalysisJob(db, jobInput(2_000));
    const c = createAnalysisJob(db, jobInput(3_000));
    startAnalysisJob(db, a.id);
    startAnalysisJob(db, b.id);

    const completedA = completeAnalysisJob(db, a.id, {
      model: 'local/llama',
      inputTokens: 120,
      outputTokens: 30,
    });
    assert.equal(completedA.status, 'complete');
    assert.equal(completedA.error, undefined);
    assert.equal(completedA.model, 'local/llama');
    assert.equal(completedA.input_tokens, 120);
    assert.equal(completedA.output_tokens, 30);

    // Usage is optional; a call with no report leaves the columns empty.
    const completedB = completeAnalysisJob(db, b.id);
    assert.equal(completedB.status, 'complete');
    assert.equal(completedB.model, undefined);
    assert.equal(completedB.input_tokens, undefined);

    const skipped = skipAnalysisJob(db, c.id, 'consent:none');
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.error, 'consent:none');
    assert.equal(skipped.attempts, 0);

    assert.deepEqual(analysisTokenTotalsForDay(db, '2026-03-11'), { input: 120, output: 30 });
    assert.deepEqual(analysisTokenTotalsForDay(db, '2026-03-12'), { input: 0, output: 0 });

    expectCode(() => completeAnalysisJob(db, 9_999), 'not_found');
    expectCode(() => completeAnalysisJob(db, a.id, { inputTokens: -1 }), 'invalid_input');
    expectCode(() => completeAnalysisJob(db, a.id, { outputTokens: 1.5 }), 'invalid_input');
    expectCode(() => failAnalysisJob(db, 9_999, 'boom'), 'not_found');
    expectCode(() => skipAnalysisJob(db, 9_999, 'budget'), 'not_found');
    expectCode(() => skipAnalysisJob(db, a.id, '   '), 'invalid_input');
  } finally {
    db.close();
  }
});

test('fail truncates a long message; skip and fail keep their own state', () => {
  const db = openTempJournal('truncate');
  try {
    const job = createAnalysisJob(db, jobInput(1_000));
    const failed = failAnalysisJob(db, job.id, `prefix ${'x'.repeat(ANALYSIS_MAX_ERROR_CHARS * 2)}`);
    assert.equal(failed.error?.length, ANALYSIS_MAX_ERROR_CHARS);
    assert.ok(failed.error?.startsWith('prefix '));

    const other = createAnalysisJob(db, jobInput(2_000));
    const skipped = skipAnalysisJob(db, other.id, 'consent:provider-not-local');
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.error, 'consent:provider-not-local');
  } finally {
    db.close();
  }
});

test('the day ledger counts started jobs only and enforces the call budget', () => {
  const db = openTempJournal('budget');
  try {
    const first = createAnalysisJob(db, jobInput(1_000));
    const second = createAnalysisJob(db, jobInput(2_000));
    const skipped = createAnalysisJob(db, jobInput(3_000));

    assert.equal(countAnalysisCallsForDay(db, '2026-03-11'), 0);
    assert.equal(analysisBudgetExhausted(db, '2026-03-11', 1), false);

    startAnalysisJob(db, first.id);
    assert.equal(countAnalysisCallsForDay(db, '2026-03-11'), 1);
    assert.equal(analysisBudgetExhausted(db, '2026-03-11', 1), true);

    // A skipped job never called the model, so it is not a call.
    skipAnalysisJob(db, skipped.id, 'consent:none');
    assert.equal(countAnalysisCallsForDay(db, '2026-03-11'), 1);

    startAnalysisJob(db, second.id);
    failAnalysisJob(db, second.id, 'boom');
    assert.equal(countAnalysisCallsForDay(db, '2026-03-11'), 2);
    assert.equal(analysisBudgetExhausted(db, '2026-03-11', 3), false);
    assert.equal(countAnalysisCallsForDay(db, '2026-03-12'), 0);

    expectCode(() => analysisBudgetExhausted(db, '2026-03-11', 0), 'invalid_input');
    expectCode(() => countAnalysisCallsForDay(db, 'not-a-day'), 'invalid_input');
    expectCode(() => analysisTokenTotalsForDay(db, 'not-a-day'), 'invalid_input');
  } finally {
    db.close();
  }
});

test('a malformed row is a database error, not a missing job', () => {
  const db = openTempJournal('malformed');
  try {
    const job = createAnalysisJob(db, jobInput(1_000));
    // The status CHECK exists, so a hand-edited journal has to bypass it to
    // reproduce a row no reader understands.
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare("UPDATE analysis_jobs SET status = 'bogus' WHERE id = ?").run(job.id);
    expectCode(() => getAnalysisJob(db, job.job_key), 'database_error');
    expectCode(() => listAnalysisJobs(db), 'database_error');
    expectCode(() => startAnalysisJob(db, job.id), 'database_error');

    db.prepare("UPDATE analysis_jobs SET status = 'queued', day = '2026-02-30' WHERE id = ?").run(job.id);
    expectCode(() => getAnalysisJob(db, job.job_key), 'database_error');

    db.prepare('UPDATE analysis_jobs SET day = ?, window_start_ts = 5000, window_end_ts = 100 WHERE id = ?').run(
      '2026-03-11',
      job.id,
    );
    expectCode(() => getAnalysisJob(db, job.job_key), 'database_error');
  } finally {
    db.close();
  }
});

test('malformed job inputs are refused before they touch the ledger', () => {
  const db = openTempJournal('invalid-input');
  try {
    const job = createAnalysisJob(db, jobInput(1_000));
    expectCode(() => analysisJobKey('2026-02-30', 1_000), 'invalid_input');
    expectCode(() => analysisJobKey('2026-03-11', -1), 'invalid_input');
    expectCode(() => analysisJobKey('2026-03-11', 1.5), 'invalid_input');
    expectCode(() => createAnalysisJob(db, { ...jobInput(2_000), jobKey: '  ' }), 'invalid_input');
    expectCode(() => createAnalysisJob(db, { ...jobInput(2_000), day: '11-03-2026' }), 'invalid_input');
    expectCode(() => createAnalysisJob(db, { ...jobInput(2_000), windowStartTs: -5 }), 'invalid_input');
    expectCode(
      () => createAnalysisJob(db, { ...jobInput(2_000), windowStartTs: 5_000, windowEndTs: 4_000 }),
      'invalid_input',
    );
    expectCode(() => getAnalysisJob(db, ''), 'invalid_input');
    expectCode(() => failAnalysisJob(db, job.id, 42 as never), 'invalid_input');
    // The invalid attempts above wrote nothing extra.
    assert.equal(listAnalysisJobs(db).length, 1);
  } finally {
    db.close();
  }
});
