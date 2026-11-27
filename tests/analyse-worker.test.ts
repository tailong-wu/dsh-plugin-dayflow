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
import { listAnalysisJobs } from '../src/analyse/jobs.js';
import type { AnalysisJob } from '../src/analyse/jobs.js';
import { createFakeLlmAdapter } from '../src/analyse/llm.js';
import type { AnalysisLlmRequest, AnalysisLlmStream } from '../src/analyse/llm.js';
import { AnalysisWorker, MAX_BACKOFF_DOUBLINGS } from '../src/analyse/worker.js';
import type { AnalysisWorkerTimers } from '../src/analyse/worker.js';
import { recordScreenshotRow } from '../src/capture/state.js';
import { resolveConfig } from '../src/config.js';
import type { AnalysisConfig, CaptureConfig, ResolvedConfig } from '../src/config.js';
import { DayflowError } from '../src/errors.js';
import { openJournal, withJournal, withJournalWrite } from '../src/journal.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-analysis-worker-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));

/** The Dayflow day every case works on; the base instant is 09:00 local. */
const DAY = '2026-11-20';

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
  /** Seconds after 09:00 local on {@link DAY}. */
  offsetSeconds: number;
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
  const base = new Date(2026, 10, 20, 9, 0, 0, 0).getTime();
  return withJournalWrite(fixture.journalPath, (db) =>
    specs.map((spec, index) => {
      const filePath = join(fixture.framesDirectory, `frame-${String(index)}.jpg`);
      writeFileSync(filePath, 'jpeg');
      return recordScreenshotRow(db, {
        sourceKey: `frame-${String(index)}`,
        capturedAt: base + spec.offsetSeconds * 1000,
        day: DAY,
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
function jobs(fixture: Fixture): AnalysisJob[] {
  return withJournal(fixture.journalPath, (db) => listAnalysisJobs(db, { day: DAY, limit: 500 }));
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
  options: { now?: () => Date } = {},
): AnalysisWorker {
  return new AnalysisWorker({
    journalPath: fixture.journalPath,
    framesDirectory: fixture.framesDirectory,
    config: fixture.config,
    analyser,
    timers,
    now: options.now ?? (() => new Date(NOON_MS)),
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
