/**
 * The analysis worker: the timer lifecycle, status, failure backoff, and the
 * manual `runOnce` path.
 *
 * Every case runs against a disposable journal and frames directory under
 * `mkdtemp`, with injected timers and a scripted {@link createFakeLlmAdapter} as
 * the only model. No case opens a network connection or captures the screen, and
 * no case waits on a real interval: the timer seam records the delays the loop
 * asks for, so a double start, a stop, and a backoff are all assertions.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { createHostAnalyser } from '../src/analyse/host.js';
import type { HostLlmChunk, HostLlmLike } from '../src/analyse/host.js';
import { analysisJobKey, createAnalysisJob, listAnalysisJobs, skipAnalysisJob } from '../src/analyse/jobs.js';
import type { AnalysisJob } from '../src/analyse/jobs.js';
import { createFakeLlmAdapter } from '../src/analyse/llm.js';
import type { AnalysisLlmRequest, AnalysisLlmStream } from '../src/analyse/llm.js';
import { ANALYSIS_TAIL_CHECKPOINT_KEY, AnalysisWorker, MAX_BACKOFF_DOUBLINGS } from '../src/analyse/worker.js';
import type { AnalysisWorkerTimers } from '../src/analyse/worker.js';
import { readCaptureStateValue, recordScreenshotRow } from '../src/capture/state.js';
import { resolveConfig } from '../src/config.js';
import type { AnalysisConfig, CaptureConfig, ResolvedConfig } from '../src/config.js';
import { dayWindowForKey } from '../src/day.js';
import { DayflowError } from '../src/errors.js';
import { openJournal, withJournal, withJournalWrite } from '../src/journal.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-analysis-worker-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));

/** The Dayflow day every case works on; the base instant is 09:00 local. */
const DAY = '2026-11-20';

/** The Dayflow day before {@link DAY}: the day the 04:00 tail analyses. */
const TAIL_DAY = '2026-11-19';

/** Noon on {@link DAY}: inside the day, so `runOnce()` with no argument reads its frames. */
const NOON = new Date(2026, 10, 20, 12, 0, 0, 0);

/** {@link NOON}, as epoch milliseconds. */
const NOON_MS = NOON.getTime();

/** A valid model answer for one window. */
const JSON_ANSWER = JSON.stringify({
  title: 'Worked on the analysis worker',
  summary: 'Wired the interval timer and its status.',
  category: 'Work',
  subcategory: 'coding',
  apps: ['Code'],
  distractions: [],
  confidence: 0.9,
});

/** One frame to seed into the journal and the frames directory. */
interface FrameSpec {
  /** Seconds after 09:00 local on the frame's day. */
  offsetSeconds: number;
  /** The Dayflow day the frame belongs to; defaults to {@link DAY}. */
  day?: string;
}

/** One disposable journal + frames directory + the config that reads them. */
interface Fixture {
  journalPath: string;
  framesDirectory: string;
  config: ResolvedConfig;
}

let fixtureCount = 0;

/** Create a fixture with a migrated journal and an empty frames directory. */
function createFixture(
  options: { capture?: Partial<CaptureConfig>; analysis?: Partial<AnalysisConfig> } = {},
): Fixture {
  fixtureCount += 1;
  const root = join(directory, `case-${String(fixtureCount)}`);
  const framesDirectory = join(root, 'frames');
  mkdirSync(framesDirectory, { recursive: true, mode: 0o700 });
  const journalPath = join(root, 'journal.sqlite');
  openJournal(journalPath).close();
  const config = resolveConfig({
    databasePath: join(root, 'chunks.sqlite'),
    journalPath,
    source: 'owned',
    capture: { enabled: true, keepFramesDays: 7, ...options.capture },
    analysis: {
      consent: 'cloud',
      provider: 'fake-provider',
      model: 'fake-model',
      ...options.analysis,
    },
  });
  return { journalPath, framesDirectory, config };
}

/** Seed one native screenshot row per spec and write its frame file. */
function seedFrames(fixture: Fixture, specs: readonly FrameSpec[]): number[] {
  return withJournalWrite(fixture.journalPath, (db) =>
    specs.map((spec, index) => {
      const day = spec.day ?? DAY;
      const window = dayWindowForKey(day);
      if (window === undefined) throw new Error(`${day} is not a real date`);
      const base = new Date(window.start.getTime());
      base.setHours(9, 0, 0, 0);
      const filePath = join(fixture.framesDirectory, `frame-${day}-${String(index)}.jpg`);
      writeFileSync(filePath, 'jpeg');
      return recordScreenshotRow(db, {
        sourceKey: `${day}/frame-${String(index)}`,
        capturedAt: base.getTime() + spec.offsetSeconds * 1000,
        day,
        filePath,
        fileSize: 4,
        payload: {
          hash: '0123456789abcdef',
          app: { bundleId: 'com.microsoft.VSCode', name: 'Code', windowTitle: 'worker.ts' },
        },
      });
    }),
  );
}

/** Read the number of native activity cards the fixture holds. */
function activityCount(fixture: Fixture): number {
  return withJournal(fixture.journalPath, (db) => {
    const rows = db
      .prepare("SELECT count(*) AS rows FROM activities WHERE source_id = 'native'")
      .all() as { rows?: unknown }[];
    return Number(rows[0]?.rows);
  });
}

/** Read the day's analysis jobs, window order. */
function jobsForDay(fixture: Fixture, day: string): AnalysisJob[] {
  return withJournal(fixture.journalPath, (db) => listAnalysisJobs(db, { day, limit: 500 }));
}

/** Read the day's analysis jobs, window order. */
function jobs(fixture: Fixture): AnalysisJob[] {
  return jobsForDay(fixture, DAY);
}

/** Read one raw `capture_state` value from the fixture journal. */
function stateValue(fixture: Fixture, key: string): string | undefined {
  return withJournal(fixture.journalPath, (db) => readCaptureStateValue(db, key));
}

/**
 * Seed one skipped ledger job for the window a frame at 09:00 (+offset) falls
 * into, as an earlier tick or a manual run left it.
 */
function seedSkippedWindowJob(fixture: Fixture, day: string, offsetSeconds: number, reason: string): void {
  const window = dayWindowForKey(day);
  if (window === undefined) throw new Error(`${day} is not a real date`);
  const base = new Date(window.start.getTime());
  base.setHours(9, 0, 0, 0);
  const startTs = Math.floor((base.getTime() + offsetSeconds * 1000) / 1000);
  withJournalWrite(fixture.journalPath, (db) => {
    const job = createAnalysisJob(db, {
      jobKey: analysisJobKey(day, startTs),
      day,
      windowStartTs: startTs,
      windowEndTs: startTs + 600,
    });
    skipAnalysisJob(db, job.id, reason);
  });
}

/** One timer the worker armed through the injected seam. */
interface ScheduledTimer {
  id: number;
  callback: () => void;
  milliseconds: number;
  cleared: boolean;
}

/** The timer seam plus the assertions surface: what is pending and how to fire it. */
interface FakeTimers extends AnalysisWorkerTimers {
  readonly scheduled: ScheduledTimer[];
  pending(): ScheduledTimer[];
  fireNext(): Promise<void>;
}

/**
 * Let an async tick settle.
 *
 * The fake timers replace only the worker's interval; the process's own timer is
 * still available, so a zero-delay timeout flushes the tick's microtasks.
 */
async function settle(rounds = 5): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/** Build the injected timer seam and record every delay the worker asks for. */
function createFakeTimers(): FakeTimers {
  const scheduled: ScheduledTimer[] = [];
  let nextId = 1;
  const timers: FakeTimers = {
    scheduled,
    setTimeout(callback, milliseconds) {
      const timer: ScheduledTimer = { id: nextId, callback, milliseconds, cleared: false };
      nextId += 1;
      scheduled.push(timer);
      return timer.id;
    },
    clearTimeout(handle) {
      const timer = scheduled.find((entry) => entry.id === handle);
      if (timer !== undefined) timer.cleared = true;
    },
    pending() {
      return scheduled.filter((entry) => !entry.cleared);
    },
    async fireNext() {
      const next = timers.pending()[0];
      if (next === undefined) throw new Error('the worker armed no timer to fire');
      next.cleared = true;
      next.callback();
      await settle();
    },
  };
  return timers;
}

/** Build a worker over one fixture with a fixed clock and injected timers. */
function workerFor(
  fixture: Fixture,
  analyser: AnalysisLlmStream,
  timers: FakeTimers,
  options: { now?: () => Date; logger?: (event: string, detail?: Record<string, unknown>) => void } = {},
): AnalysisWorker {
  return new AnalysisWorker({
    journalPath: fixture.journalPath,
    framesDirectory: fixture.framesDirectory,
    config: fixture.config,
    analyser,
    timers,
    now: options.now ?? (() => new Date(NOON_MS)),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}

/** The configured interval in milliseconds, as the worker schedules it. */
function intervalMs(fixture: Fixture): number {
  return fixture.config.analysis.intervalMinutes * 60_000;
}

test('start runs one tick immediately, arms one timer, and stop clears it', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  const adapter = createFakeLlmAdapter([JSON_ANSWER]);
  const timers = createFakeTimers();
  const worker = workerFor(fixture, adapter, timers);

  worker.start();
  await settle();

  assert.equal(adapter.calls.length, 1, 'start runs the first tick immediately');
  assert.equal(activityCount(fixture), 1, 'the first tick turned the frame into a card');
  assert.deepEqual(
    timers.pending().map((timer) => timer.milliseconds),
    [intervalMs(fixture)],
    'exactly one timer waits for the configured interval',
  );
  const started = worker.status();
  assert.equal(started.running, true);
  assert.equal(started.intervalMinutes, 5);
  assert.equal(started.lastRunAt, NOON_MS, 'the tick records when it settled');
  assert.equal(started.lastOutcome, 'analysed');
  assert.equal(started.lastError, undefined);

  // A second start while running is a no-op: no tick, no second timer.
  worker.start();
  await settle();
  assert.equal(adapter.calls.length, 1);
  assert.equal(timers.pending().length, 1, 'a double start still arms one timer');

  // Firing the timer runs one more tick, which is an idempotent replay.
  await timers.fireNext();
  assert.equal(adapter.calls.length, 1, 'the completed window is never re-called');
  assert.equal(activityCount(fixture), 1, 'the replay wrote no second card');
  assert.equal(timers.pending().length, 1, 'the tick re-armed the loop');

  worker.stop();
  assert.equal(timers.pending().length, 0, 'stop clears the pending timer');
  assert.equal(worker.status().running, false);

  // A restart runs immediately again, still without duplicating the card.
  worker.start();
  await settle();
  assert.equal(adapter.calls.length, 1);
  assert.equal(activityCount(fixture), 1, 'a restart resumes without duplicating rows');
  assert.equal(timers.pending().length, 1);
  worker.stop();
});

test('a successful tick reports its outcome and leaves one complete job', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  const adapter = createFakeLlmAdapter([JSON_ANSWER]);
  const timers = createFakeTimers();
  const worker = workerFor(fixture, adapter, timers);

  worker.start();
  await settle();
  worker.stop();

  const status = worker.status();
  assert.equal(status.lastOutcome, 'analysed');
  assert.equal(status.lastRunAt, NOON_MS);
  assert.equal(status.lastError, undefined);

  const dayJobs = jobs(fixture);
  assert.equal(dayJobs.length, 1);
  assert.equal(dayJobs[0]?.status, 'complete');
  assert.equal(dayJobs[0]?.attempts, 1);
});

test('a failed tick records lastError, backs off, and the next tick recovers', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  const adapter = createFakeLlmAdapter([JSON_ANSWER]);
  const timers = createFakeTimers();
  // The pipeline asks the injected clock for the day; throwing here is a
  // run-level failure, the one case that reaches the worker's catch.
  let clockCalls = 0;
  const now = (): Date => {
    clockCalls += 1;
    if (clockCalls === 1) throw new Error('the clock is unavailable');
    return new Date(NOON_MS);
  };
  const worker = workerFor(fixture, adapter, timers, { now });

  worker.start();
  await settle();

  assert.equal(worker.status().running, true, 'a failed tick does not stop the loop');
  assert.equal(worker.status().lastError, 'the clock is unavailable');
  assert.equal(worker.status().lastRunAt, NOON_MS, 'the failed tick still records its settle time');
  assert.equal(adapter.calls.length, 0, 'the failure happened before any model call');
  assert.deepEqual(
    timers.pending().map((timer) => timer.milliseconds),
    [intervalMs(fixture) * 2],
    'the first failure waits twice as long',
  );

  await timers.fireNext();

  assert.equal(adapter.calls.length, 1, 'the next tick ran the pipeline');
  assert.equal(activityCount(fixture), 1);
  assert.equal(worker.status().lastError, undefined, 'success clears the error');
  assert.equal(worker.status().lastOutcome, 'analysed');
  assert.deepEqual(
    timers.pending().map((timer) => timer.milliseconds),
    [intervalMs(fixture)],
    'success restores the configured interval',
  );
  worker.stop();
});

test('repeated failures double the delay until the backoff cap', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  const adapter = createFakeLlmAdapter([JSON_ANSWER]);
  const timers = createFakeTimers();
  // A permanently broken clock keeps every tick a run-level failure.
  const now = (): Date => {
    throw new Error('the clock is broken');
  };
  const worker = workerFor(fixture, adapter, timers, { now });

  worker.start();
  await settle();
  assert.deepEqual(
    timers.pending().map((timer) => timer.milliseconds),
    [intervalMs(fixture) * 2],
    'failure 1 waits 2x',
  );

  for (let failure = 2; failure <= MAX_BACKOFF_DOUBLINGS; failure += 1) {
    await timers.fireNext();
    assert.deepEqual(
      timers.pending().map((timer) => timer.milliseconds),
      [intervalMs(fixture) * 2 ** failure],
      `failure ${String(failure)} waits ${String(2 ** failure)}x`,
    );
  }

  // One more failure must not grow the delay past the cap.
  await timers.fireNext();
  assert.deepEqual(
    timers.pending().map((timer) => timer.milliseconds),
    [intervalMs(fixture) * 2 ** MAX_BACKOFF_DOUBLINGS],
    'the backoff factor stops at the cap',
  );
  assert.equal(adapter.calls.length, 0);
  assert.equal(worker.status().running, true);
  worker.stop();
});

test('runOnce rejects on an invalid day and runs on demand without arming a timer', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  const adapter = createFakeLlmAdapter([JSON_ANSWER]);
  const timers = createFakeTimers();
  const worker = workerFor(fixture, adapter, timers);

  await assert.rejects(
    () => worker.runOnce({ day: '2026-02-30' }),
    (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
    'the worker does not swallow a caller error',
  );
  assert.equal(timers.pending().length, 0, 'a manual run arms no timer');
  assert.equal(worker.status().lastRunAt, undefined, 'a manual run is not a tick');

  const result = await worker.runOnce({ day: DAY });
  assert.equal(result.outcome, 'analysed');
  assert.equal(result.analysed, 1);
  assert.equal(result.day, DAY);
  assert.equal(adapter.calls.length, 1);
  assert.equal(activityCount(fixture), 1);
});

test('a consent-blocked tick is a normal outcome, not an error', async () => {
  const fixture = createFixture({ analysis: { consent: 'none' } });
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  const adapter = createFakeLlmAdapter([JSON_ANSWER]);
  const timers = createFakeTimers();
  const worker = workerFor(fixture, adapter, timers);

  worker.start();
  await settle();
  worker.stop();

  const status = worker.status();
  assert.equal(status.lastOutcome, 'blocked', 'the pipeline gate decides, not the worker');
  assert.equal(status.lastError, undefined, 'a gate is not a failure');
  assert.equal(adapter.calls.length, 0, 'a blocked run never calls the model');
  assert.equal(activityCount(fixture), 0);

  const blockedJobs = jobs(fixture);
  assert.equal(blockedJobs.length, 1);
  assert.equal(blockedJobs[0]?.status, 'skipped');
  assert.equal(blockedJobs[0]?.error, 'consent:none');
});

// ---------------------------------------------------------------------------
// Transient-skip catch-up
// ---------------------------------------------------------------------------

test('catch-up requeues a transient skipped window for the next tick', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  seedSkippedWindowJob(fixture, DAY, 0, 'consent:none');
  const adapter = createFakeLlmAdapter([JSON_ANSWER]);
  const timers = createFakeTimers();
  const catchUpEvents: Record<string, unknown>[] = [];
  const worker = workerFor(fixture, adapter, timers, {
    logger: (event, detail) => {
      if (event === 'analysis.catch_up') catchUpEvents.push(detail ?? {});
    },
  });

  worker.start();
  await settle();

  assert.equal(adapter.calls.length, 0, 'the terminal skip is not analysed in the same tick');
  assert.equal(jobsForDay(fixture, DAY)[0]?.status, 'queued', 'the repaired gate requeued the window');
  assert.equal(catchUpEvents.length, 1);
  assert.equal(catchUpEvents[0]?.replayed, 1);
  assert.deepEqual(catchUpEvents[0]?.byReason, { 'consent:none': 1 });

  await timers.fireNext();

  assert.equal(adapter.calls.length, 1, 'the next tick analyses the requeued window');
  assert.equal(jobsForDay(fixture, DAY)[0]?.status, 'complete');
  assert.equal(activityCount(fixture), 1);
  worker.stop();
});

test('a blocked gate does not run the catch-up replay', async () => {
  const fixture = createFixture({ analysis: { consent: 'none' } });
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  seedSkippedWindowJob(fixture, DAY, 0, 'paused');
  const adapter = createFakeLlmAdapter([JSON_ANSWER]);
  const timers = createFakeTimers();
  const catchUpEvents: Record<string, unknown>[] = [];
  const worker = workerFor(fixture, adapter, timers, {
    logger: (event, detail) => {
      if (event === 'analysis.catch_up') catchUpEvents.push(detail ?? {});
    },
  });

  worker.start();
  await settle();
  worker.stop();

  assert.equal(worker.status().lastOutcome, 'blocked');
  assert.equal(catchUpEvents.length, 0, 'a closed gate never churns the ledger');
  const dayJobs = jobsForDay(fixture, DAY);
  assert.equal(dayJobs.length, 1);
  assert.equal(dayJobs[0]?.status, 'skipped', 'the transient skip stays skipped until the gate opens');
  assert.equal(dayJobs[0]?.error, 'paused');
  assert.equal(adapter.calls.length, 0);
});

// ---------------------------------------------------------------------------
// The 04:00 day tail
// ---------------------------------------------------------------------------

test('the first tick of a day runs yesterday’s tail once and checkpoints today', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  seedFrames(fixture, [{ offsetSeconds: 0, day: TAIL_DAY }]);
  const adapter = createFakeLlmAdapter([JSON_ANSWER, JSON_ANSWER]);
  const timers = createFakeTimers();
  const tailEvents: Record<string, unknown>[] = [];
  const worker = workerFor(fixture, adapter, timers, {
    logger: (event, detail) => {
      if (event === 'analysis.day_tail') tailEvents.push(detail ?? {});
    },
  });

  worker.start();
  await settle();
  worker.stop();

  assert.equal(adapter.calls.length, 2, 'the day and its tail each analysed one window');
  assert.match(adapter.calls[0]?.user ?? '', /Day: 2026-11-20/, 'the day runs before its tail');
  assert.match(adapter.calls[1]?.user ?? '', /Day: 2026-11-19/, 'the tail analyses the previous day');
  assert.equal(activityCount(fixture), 2, 'both days got a card');
  assert.equal(stateValue(fixture, ANALYSIS_TAIL_CHECKPOINT_KEY), DAY, 'the checkpoint names today');
  assert.equal(tailEvents.length, 1);
  assert.equal(tailEvents[0]?.day, TAIL_DAY);
  assert.equal(tailEvents[0]?.outcome, 'analysed');

  const tailJobs = jobsForDay(fixture, TAIL_DAY);
  assert.equal(tailJobs.length, 1);
  assert.equal(tailJobs[0]?.status, 'complete');

  const status = worker.status();
  assert.equal(status.lastOutcome, 'analysed');
  assert.equal(status.lastError, undefined, 'a tail run is not an error');
});

test('a second tick on the same day does not repeat the tail', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  seedFrames(fixture, [{ offsetSeconds: 0, day: TAIL_DAY }]);
  const adapter = createFakeLlmAdapter([JSON_ANSWER, JSON_ANSWER]);
  const timers = createFakeTimers();
  const worker = workerFor(fixture, adapter, timers);

  worker.start();
  await settle();
  assert.equal(adapter.calls.length, 2);

  await timers.fireNext();

  assert.equal(adapter.calls.length, 2, 'the second tick makes no model call at all');
  assert.equal(activityCount(fixture), 2);
  assert.equal(stateValue(fixture, ANALYSIS_TAIL_CHECKPOINT_KEY), DAY, 'the checkpoint is unchanged');
  assert.deepEqual(
    timers.pending().map((timer) => timer.milliseconds),
    [intervalMs(fixture)],
    'the loop still re-arms one timer',
  );
  worker.stop();
});

test('a blocked tail writes no checkpoint so the next tick tries again', async () => {
  const fixture = createFixture({ analysis: { consent: 'none' } });
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  seedFrames(fixture, [{ offsetSeconds: 0, day: TAIL_DAY }]);
  const adapter = createFakeLlmAdapter([JSON_ANSWER]);
  const timers = createFakeTimers();
  const tailEvents: Record<string, unknown>[] = [];
  const worker = workerFor(fixture, adapter, timers, {
    logger: (event, detail) => {
      if (event === 'analysis.day_tail') tailEvents.push(detail ?? {});
    },
  });

  worker.start();
  await settle();

  assert.equal(worker.status().lastOutcome, 'blocked', 'the gate blocks the day, not the worker');
  assert.equal(adapter.calls.length, 0);
  assert.equal(
    stateValue(fixture, ANALYSIS_TAIL_CHECKPOINT_KEY),
    undefined,
    'a blocked tail must not claim the day was handled',
  );
  assert.equal(tailEvents.length, 1);
  assert.equal(tailEvents[0]?.outcome, 'blocked');
  assert.equal(tailEvents[0]?.blockedReason, 'consent:none');
  assert.equal(jobsForDay(fixture, TAIL_DAY)[0]?.status, 'skipped');

  await timers.fireNext();

  assert.equal(tailEvents.length, 2, 'the next tick attempts the tail again');
  assert.equal(adapter.calls.length, 0);
  assert.equal(stateValue(fixture, ANALYSIS_TAIL_CHECKPOINT_KEY), undefined);
  worker.stop();
});

test('a failed tail leaves the day’s outcome alone and is retried', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  seedFrames(fixture, [{ offsetSeconds: 0, day: TAIL_DAY }]);
  const adapter = createFakeLlmAdapter([JSON_ANSWER, JSON_ANSWER]);
  const timers = createFakeTimers();
  // A successful tick reads the clock four times in order: the day's run, the
  // catch-up replay, the tail, then the settle time. The tail's read is the one
  // that fails, so the failure lands inside the tail and nowhere else.
  let clockCalls = 0;
  const now = (): Date => {
    clockCalls += 1;
    if (clockCalls === 3) throw new Error('the tail clock is unavailable');
    return new Date(NOON_MS);
  };
  const failedTails: Record<string, unknown>[] = [];
  const worker = workerFor(fixture, adapter, timers, {
    now,
    logger: (event, detail) => {
      if (event === 'analysis.day_tail' && detail?.failed === true) failedTails.push(detail ?? {});
    },
  });

  worker.start();
  await settle();

  assert.equal(worker.status().lastOutcome, 'analysed', "the day's outcome is untouched");
  assert.equal(worker.status().lastError, 'the tail clock is unavailable', 'the tail failure is recorded');
  assert.equal(adapter.calls.length, 1, 'only the day ran; the tail failed before its pipeline');
  assert.equal(activityCount(fixture), 1);
  assert.equal(stateValue(fixture, ANALYSIS_TAIL_CHECKPOINT_KEY), undefined, 'a failed tail writes no checkpoint');
  assert.equal(failedTails.length, 1);

  // The next tick replays the day (no call) and completes the tail.
  await timers.fireNext();

  assert.equal(adapter.calls.length, 2, 'the retried tail makes its one call');
  assert.equal(activityCount(fixture), 2);
  assert.equal(stateValue(fixture, ANALYSIS_TAIL_CHECKPOINT_KEY), DAY);
  assert.equal(worker.status().lastError, undefined, 'the next successful tick clears the tail error');
  worker.stop();
});

test('a same-day restart does not repeat the tail', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [{ offsetSeconds: 0 }]);
  seedFrames(fixture, [{ offsetSeconds: 0, day: TAIL_DAY }]);
  const firstAdapter = createFakeLlmAdapter([JSON_ANSWER, JSON_ANSWER]);
  const first = workerFor(fixture, firstAdapter, createFakeTimers());

  first.start();
  await settle();
  first.stop();
  assert.equal(firstAdapter.calls.length, 2);
  assert.equal(stateValue(fixture, ANALYSIS_TAIL_CHECKPOINT_KEY), DAY);

  // A new instance the same day sees the persisted checkpoint: the day's windows
  // and its tail are both replays, so nothing is called again.
  const restartAdapter = createFakeLlmAdapter([JSON_ANSWER]);
  const restart = workerFor(fixture, restartAdapter, createFakeTimers());
  restart.start();
  await settle();
  restart.stop();

  assert.equal(restartAdapter.calls.length, 0, 'the restart repeats neither the day nor the tail');
  assert.equal(activityCount(fixture), 2);
  assert.equal(jobsForDay(fixture, TAIL_DAY).length, 1);
  assert.equal(stateValue(fixture, ANALYSIS_TAIL_CHECKPOINT_KEY), DAY);
});

// ---------------------------------------------------------------------------
// The production host adapter
// ---------------------------------------------------------------------------

/** One call the fake host received, exactly as the adapter passed it. */
interface FakeHostCall {
  provider: string;
  model: string;
  system?: string;
  messages: ReadonlyArray<{ role: 'user'; content: ReadonlyArray<{ type: 'text'; text: string }> }>;
  signal?: AbortSignal;
  maxTokens?: number;
}

/** Build a host `llm` stand-in from a chunk script and record every call. */
function fakeHostLlm(script: readonly (readonly HostLlmChunkRecord[])[]): {
  llm: HostLlmLike;
  calls: FakeHostCall[];
} {
  const calls: FakeHostCall[] = [];
  const llm: HostLlmLike = {
    stream(options) {
      calls.push(options);
      const chunks = script[calls.length - 1] ?? [];
      return (async function* generate(): AsyncGenerator<HostLlmChunk> {
        for (const chunk of chunks) yield chunk;
      })();
    },
  };
  return { llm, calls };
}

/** One chunk of the fake host stream; the adapter only reads these two kinds. */
type HostLlmChunkRecord =
  | { type: 'block-start'; index: number; blockType: 'text' }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'usage'; usage: { inputTokens?: number; outputTokens?: number } }
  | { type: 'finish'; reason: { kind: 'stop' } };

/** One analysis request for the adapter tests. */
function adapterRequest(overrides: Partial<AnalysisLlmRequest> = {}): AnalysisLlmRequest {
  return {
    provider: 'deepseek',
    model: 'deepseek-flash',
    system: 'You analyse one window of screen activity.',
    user: 'Day 2026-11-20, 09:00-09:10, one frame in Terminal.',
    signal: new AbortController().signal,
    ...overrides,
  };
}

test('the host adapter aggregates text deltas and usage and builds no image block', async () => {
  const { llm, calls } = fakeHostLlm([
    [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '{"title":"' },
      { type: 'text-delta', index: 0, text: 'Edited worker.ts"}' },
      { type: 'usage', usage: { inputTokens: 120, outputTokens: 18 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  ]);
  const analyser = createHostAnalyser(llm);
  const request = adapterRequest();

  const result = await analyser(request);

  assert.deepEqual(result, {
    text: '{"title":"Edited worker.ts"}',
    model: 'deepseek-flash',
    inputTokens: 120,
    outputTokens: 18,
  });
  const call = calls[0];
  assert.ok(call, 'the adapter made one host call');
  assert.equal(call.provider, 'deepseek');
  assert.equal(call.model, 'deepseek-flash');
  assert.equal(call.system, request.system);
  assert.deepEqual(
    call.messages,
    [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
    'one text-only user message with the host content-block shape',
  );
  assert.equal(call.signal, request.signal, 'the abort signal is forwarded unchanged');
  assert.equal(call.maxTokens, undefined, 'no output cap is imposed by default');
});

test('the host adapter keeps the last usage, defaults absent counts to zero, and forwards maxTokens', async () => {
  const { llm, calls } = fakeHostLlm([
    [
      { type: 'text-delta', index: 0, text: '{}' },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
      // A later usage chunk supersedes the earlier one; a missing count is 0.
      { type: 'usage', usage: { inputTokens: 30 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  ]);
  const analyser = createHostAnalyser(llm, { maxTokens: 512 });
  const result = await analyser(adapterRequest());

  assert.deepEqual(result, { text: '{}', model: 'deepseek-flash', inputTokens: 30, outputTokens: 0 });
  assert.equal(calls[0]?.maxTokens, 512);
});

test('a host stream failure rejects the adapter call so the wrapper can retry', async () => {
  const llm: HostLlmLike = {
    stream() {
      return (async function* generate(): AsyncGenerator<HostLlmChunk> {
        yield { type: 'text-delta', text: 'partial' };
        throw new Error('the provider connection dropped');
      })();
    },
  };
  const analyser = createHostAnalyser(llm);

  await assert.rejects(() => analyser(adapterRequest()), /the provider connection dropped/);
});
