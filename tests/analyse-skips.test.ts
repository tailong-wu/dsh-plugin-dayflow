/**
 * Transient-skip catch-up: which skipped analysis windows may be replayed, and
 * the bounded, idempotent pass that requeues them.
 *
 * A `skipped` row records that no call was made, so a configuration-caused skip
 * can be repaired by moving it back to `queued`; a `budget`/`budget-tokens`
 * skip is a spending decision and a `failed` job is not a skip, so neither is
 * ever replayed. The pass is bounded to today and yesterday (by default), is
 * conditional so a racing worker cannot replay a row twice, and preserves both
 * `attempts` and the old reason (as `payload_json.replayed_from/replayed_at`).
 *
 * These tests use disposable journals under a temporary directory and a fixed
 * clock; they never touch the default `$DSH_HOME` journal and never call a
 * model or the network.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { dayWindowContaining, formatDayKey, previousDayKey } from '../src/day.js';
import { DayflowError } from '../src/errors.js';
import { openJournal } from '../src/journal.js';
import {
  ANALYSIS_SKIP_REPLAY_MAX_DAYS_BACK,
  ANALYSIS_SKIP_REPLAY_MAX_LIMIT,
  TRANSIENT_SKIP_REASONS,
  isTransientSkipReason,
  replaySkippedAnalysisWindows,
} from '../src/analyse/skips.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-analysis-skips-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let fileCounter = 0;

/** A fresh journal path inside the disposable directory. */
function journalFile(label: string): string {
  fileCounter += 1;
  return join(directory, `${label}-${fileCounter}.sqlite`);
}

/** The fixed clock every window test runs on: a 10 AM instant, not a boundary. */
const NOW = new Date(2026, 2, 11, 10, 0, 0);
const TODAY = formatDayKey(NOW);
const YESTERDAY = previousDayKey(TODAY);
const DAY_BEFORE = previousDayKey(YESTERDAY);

interface Row {
  readonly [key: string]: unknown;
}

/** Read one row with a short-lived raw connection. */
function queryRow(path: string, sql: string, ...parameters: (string | number)[]): Row | undefined {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).get(...(parameters as never[])) as Row | undefined;
  } finally {
    db.close();
  }
}

/** Read one job row by id. */
function readJob(path: string, id: number): Row {
  const row = queryRow(path, 'SELECT * FROM analysis_jobs WHERE id = ?', id);
  assert.ok(row, `analysis job #${String(id)} exists`);
  return row;
}

/** The parsed payload of one job row. */
function readPayload(path: string, id: number): Record<string, unknown> {
  const raw = readJob(path, id).payload_json;
  assert.equal(typeof raw, 'string', `job #${String(id)} has a payload`);
  const parsed: unknown = JSON.parse(raw as string);
  assert.ok(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), 'payload is a JSON object');
  return parsed as Record<string, unknown>;
}

interface SeedJob {
  readonly day: string;
  readonly startTs: number;
  readonly reason?: string | null;
  readonly status?: 'queued' | 'running' | 'complete' | 'failed' | 'skipped';
  readonly attempts?: number;
  readonly payload?: string | null;
}

/** Insert jobs directly into a fresh journal and return their ids, in order. */
function seedJobs(label: string, jobs: readonly SeedJob[]): { path: string; ids: number[] } {
  const path = journalFile(label);
  const db = openJournal(path);
  try {
    const ids = jobs.map((job) => {
      const status = job.status ?? 'skipped';
      const insert = db.prepare(
        `INSERT INTO analysis_jobs
           (job_key, day, window_start_ts, window_end_ts, status, attempts, error, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const result = insert.run(
        `${job.day}:${String(job.startTs)}`,
        job.day,
        job.startTs,
        job.startTs + 600,
        status,
        job.attempts ?? 0,
        job.reason ?? null,
        job.payload ?? null,
      );
      return Number(result.lastInsertRowid);
    });
    return { path, ids };
  } finally {
    db.close();
  }
}

/** Assert an async call rejects with a Dayflow `invalid_input`. */
async function expectInvalid(run: () => Promise<unknown>): Promise<void> {
  await assert.rejects(run, (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input');
}

test('only the eight configuration reasons are transient; money and failures are not', () => {
  assert.equal(TRANSIENT_SKIP_REASONS.length, 8);
  for (const reason of TRANSIENT_SKIP_REASONS) {
    assert.equal(isTransientSkipReason(reason), true, `${reason} replays`);
  }
  // Money, a failure, an unknown future reason, and no reason at all are the
  // forward-compatible "do not replay" default.
  for (const reason of ['budget', 'budget-tokens', 'failed', 'unknown-reason', 'paused ', '', undefined]) {
    assert.equal(isTransientSkipReason(reason), false, `${String(reason)} does not replay`);
  }
});

test('a first pass replays transient skips for today and yesterday only', async () => {
  const seeded = seedJobs('window', [
    { day: TODAY, startTs: 1_000, reason: 'consent:none' },
    { day: YESTERDAY, startTs: 2_000, reason: 'analysis-disabled', payload: '{"frame_count":3}' },
    { day: DAY_BEFORE, startTs: 3_000, reason: 'provider-unset' },
    { day: TODAY, startTs: 4_000, reason: 'budget' },
    { day: TODAY, startTs: 5_000, reason: 'boom', status: 'failed' },
  ]);
  const [todaySkip, yesterdaySkip, olderSkip, budgetSkip, failedJob] = seeded.ids;

  const result = await replaySkippedAnalysisWindows({ journalPath: seeded.path, now: () => NOW });
  // Three skipped rows are inside the window; one of them is the permanent
  // `budget` skip, so only two rows are requeued.
  assert.deepEqual(result, {
    considered: 3,
    replayed: 2,
    byReason: { 'consent:none': 1, 'analysis-disabled': 1 },
  });

  for (const [id, reason] of [
    [todaySkip, 'consent:none'],
    [yesterdaySkip, 'analysis-disabled'],
  ] as const) {
    const row = readJob(seeded.path, id);
    assert.equal(row.status, 'queued', `job #${String(id)} is requeued`);
    assert.equal(row.error, null, `job #${String(id)} cleared its skip reason`);
    // A skip never consumed an attempt, so the replay keeps the counter where
    // it was (0 here); starting the job later is what counts the attempt.
    assert.equal(row.attempts, 0);
    const payload = readPayload(seeded.path, id);
    assert.equal(payload.replayed_from, reason);
    assert.equal(payload.replayed_at, NOW.toISOString());
  }
  // The old payload keys survive the audit merge.
  assert.equal(readPayload(seeded.path, yesterdaySkip).frame_count, 3);

  // Outside the window / permanent skips / failures are untouched.
  assert.deepEqual(
    pick(readJob(seeded.path, olderSkip), ['status', 'error', 'payload_json']),
    { status: 'skipped', error: 'provider-unset', payload_json: null },
    'the day before yesterday is outside the default window',
  );
  assert.deepEqual(
    pick(readJob(seeded.path, budgetSkip), ['status', 'error', 'payload_json']),
    { status: 'skipped', error: 'budget', payload_json: null },
    'a spending decision is never replayed',
  );
  assert.deepEqual(
    pick(readJob(seeded.path, failedJob), ['status', 'error']),
    { status: 'failed', error: 'boom' },
    'a failed job is not a skip and is never replayed',
  );

  // A second pass finds the repaired rows `queued` and replays nothing.
  const second = await replaySkippedAnalysisWindows({ journalPath: seeded.path, now: () => NOW });
  assert.deepEqual(second, { considered: 1, replayed: 0, byReason: {} });
  assert.equal(readJob(seeded.path, todaySkip).status, 'queued');
});

test('a replayed row keeps its attempts counter instead of restarting at zero', async () => {
  const seeded = seedJobs('attempts', [
    { day: TODAY, startTs: 1_000, reason: 'paused', attempts: 1 },
  ]);
  const [id] = seeded.ids;
  assert.equal(readJob(seeded.path, id).attempts, 1);

  const result = await replaySkippedAnalysisWindows({ journalPath: seeded.path, now: () => NOW });
  assert.equal(result.replayed, 1);

  const row = readJob(seeded.path, id);
  assert.equal(row.status, 'queued');
  assert.equal(row.attempts, 1, 'a skip did not consume an attempt and the replay does not reset one');
  // The pipeline's own retry cap then applies when the job is started.
  assert.equal(readPayload(seeded.path, id).replayed_from, 'paused');
});

test('daysBack widens the window one day at a time', async () => {
  const seeded = seedJobs('days-back', [
    { day: DAY_BEFORE, startTs: 1_000, reason: 'model-unset' },
  ]);
  const [id] = seeded.ids;

  const narrow = await replaySkippedAnalysisWindows({ journalPath: seeded.path, now: () => NOW });
  assert.deepEqual(narrow, { considered: 0, replayed: 0, byReason: {} });
  assert.equal(readJob(seeded.path, id).status, 'skipped');

  const wide = await replaySkippedAnalysisWindows({ journalPath: seeded.path, now: () => NOW, daysBack: 2 });
  assert.deepEqual(wide, { considered: 1, replayed: 1, byReason: { 'model-unset': 1 } });
  assert.equal(readJob(seeded.path, id).status, 'queued');
});

test('limit caps how many rows one pass requeues', async () => {
  const seeded = seedJobs('limit', [
    { day: TODAY, startTs: 1_000, reason: 'analysis-disabled' },
    { day: TODAY, startTs: 2_000, reason: 'capture-disabled' },
  ]);
  const [first, second] = seeded.ids;

  const one = await replaySkippedAnalysisWindows({ journalPath: seeded.path, now: () => NOW, limit: 1 });
  assert.equal(one.replayed, 1);
  assert.deepEqual(one.byReason, { 'analysis-disabled': 1 });
  assert.equal(readJob(seeded.path, first).status, 'queued');
  assert.equal(readJob(seeded.path, second).status, 'skipped');

  const two = await replaySkippedAnalysisWindows({ journalPath: seeded.path, now: () => NOW, limit: 1 });
  assert.equal(two.replayed, 1);
  assert.deepEqual(two.byReason, { 'capture-disabled': 1 });
  assert.equal(readJob(seeded.path, second).status, 'queued');
});

test('a malformed payload is treated as absent and replaced by the audit object', async () => {
  const seeded = seedJobs('bad-payload', [
    { day: TODAY, startTs: 1_000, reason: 'paused', payload: 'not json' },
  ]);
  const [id] = seeded.ids;

  const result = await replaySkippedAnalysisWindows({ journalPath: seeded.path, now: () => NOW });
  assert.equal(result.replayed, 1);
  const payload = readPayload(seeded.path, id);
  assert.deepEqual(Object.keys(payload).sort(), ['replayed_at', 'replayed_from']);
  assert.equal(payload.replayed_from, 'paused');
  assert.equal(payload.replayed_at, NOW.toISOString());
});

test('the window follows the 04:00 day boundary, not the calendar instant', async () => {
  // 03:30 on the 11th still belongs to the Dayflow day labelled the 10th, so
  // the replayed window is the 10th and the 9th; the 11th is not yet a day to
  // run for.
  const beforeBoundary = new Date(2026, 2, 11, 3, 30, 0);
  const dayTen = dayWindowContaining(beforeBoundary).dayKey;
  const dayNine = previousDayKey(dayTen);
  const dayEleven = formatDayKey(new Date(2026, 2, 11)); // 2026-03-11: the next labelled day
  assert.equal(dayTen, '2026-03-10');
  assert.equal(dayNine, '2026-03-09');
  assert.equal(dayEleven, '2026-03-11');

  const seeded = seedJobs('boundary', [
    { day: dayNine, startTs: 1_000, reason: 'provider-unset' },
    { day: dayTen, startTs: 2_000, reason: 'capture-disabled' },
    { day: dayEleven, startTs: 3_000, reason: 'consent:none' },
  ]);
  const [nine, ten, eleven] = seeded.ids;

  const result = await replaySkippedAnalysisWindows({ journalPath: seeded.path, now: () => beforeBoundary });
  assert.deepEqual(result, {
    considered: 2,
    replayed: 2,
    byReason: { 'provider-unset': 1, 'capture-disabled': 1 },
  });
  assert.equal(readJob(seeded.path, nine).status, 'queued');
  assert.equal(readJob(seeded.path, ten).status, 'queued');
  assert.equal(readJob(seeded.path, eleven).status, 'skipped', 'the next labelled day is not in yesterday’s window');
});

test('a transient reason on a non-skipped row is not requeued', async () => {
  const seeded = seedJobs('status-gate', [
    { day: TODAY, startTs: 1_000, reason: 'consent:none', status: 'queued' },
    { day: TODAY, startTs: 2_000, reason: 'paused', status: 'running' },
  ]);
  const result = await replaySkippedAnalysisWindows({ journalPath: seeded.path, now: () => NOW });
  assert.deepEqual(result, { considered: 0, replayed: 0, byReason: {} });
});

test('an empty journal replays nothing and the default clock is used', async () => {
  const path = journalFile('empty');
  const result = await replaySkippedAnalysisWindows({ journalPath: path });
  assert.deepEqual(result, { considered: 0, replayed: 0, byReason: {} });
});

test('malformed parameters are refused with invalid_input', async () => {
  const seeded = seedJobs('invalid', [{ day: TODAY, startTs: 1_000, reason: 'paused' }]);
  const path = seeded.path;

  await expectInvalid(() => replaySkippedAnalysisWindows(undefined as never));
  await expectInvalid(() => replaySkippedAnalysisWindows({ journalPath: '' }));
  await expectInvalid(() => replaySkippedAnalysisWindows({ journalPath: '   ' }));
  await expectInvalid(() => replaySkippedAnalysisWindows({ journalPath: path, daysBack: -1 }));
  await expectInvalid(() => replaySkippedAnalysisWindows({ journalPath: path, daysBack: 1.5 }));
  await expectInvalid(() => replaySkippedAnalysisWindows({ journalPath: path, daysBack: '2' as never }));
  await expectInvalid(() =>
    replaySkippedAnalysisWindows({ journalPath: path, daysBack: ANALYSIS_SKIP_REPLAY_MAX_DAYS_BACK + 1 }),
  );
  await expectInvalid(() => replaySkippedAnalysisWindows({ journalPath: path, limit: 0 }));
  await expectInvalid(() => replaySkippedAnalysisWindows({ journalPath: path, limit: 2.5 }));
  await expectInvalid(() =>
    replaySkippedAnalysisWindows({ journalPath: path, limit: ANALYSIS_SKIP_REPLAY_MAX_LIMIT + 1 }),
  );
  await expectInvalid(() => replaySkippedAnalysisWindows({ journalPath: path, now: 'soon' as never }));
  await expectInvalid(() => replaySkippedAnalysisWindows({ journalPath: path, now: () => new Date(Number.NaN) }));
  await expectInvalid(() =>
    replaySkippedAnalysisWindows({
      journalPath: path,
      now: () => {
        throw new Error('clock is broken');
      },
    }),
  );

  // Nothing was replayed by the refused calls.
  assert.equal(readJob(path, seeded.ids[0]).status, 'skipped');
});

/** Pick a subset of a row, for a readable equality assertion. */
function pick(row: Row, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}
