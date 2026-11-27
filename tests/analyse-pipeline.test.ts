/**
 * The analysis pipeline: grouping, the consent gate, validation, idempotency,
 * sessionisation, the call budget, and the frame handoff.
 *
 * Every case runs against a disposable journal and frames directory under
 * `mkdtemp`, with a scripted {@link createFakeLlmAdapter} as the only model. No
 * case opens a network connection, captures the screen, or reaches a real
 * provider; the injected clock and the fake adapter are the seam, the same way
 * the capture engine tests substitute a provider.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { DatabaseSync } from 'node:sqlite';

import { createFakeLlmAdapter } from '../src/analyse/llm.js';
import type { AnalysisLlmStream } from '../src/analyse/llm.js';
import { ANALYSIS_MAX_ATTEMPTS, analysisJobKey, listAnalysisJobs } from '../src/analyse/jobs.js';
import type { AnalysisJob } from '../src/analyse/jobs.js';
import { AnalysisPipeline } from '../src/analyse/pipeline.js';
import { recordScreenshotRow, writeCaptureState } from '../src/capture/state.js';
import type { AnalysisConfig, CaptureConfig, ResolvedConfig } from '../src/config.js';
import { resolveConfig } from '../src/config.js';
import { DayflowError } from '../src/errors.js';
import { openJournal, withJournal, withJournalWrite } from '../src/journal.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-analysis-pipeline-test-'));
after(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** The Dayflow day every case works on; the base instant is 09:00 local. */
const DAY = '2026-11-20';

/** 09:00 local on {@link DAY}, in epoch milliseconds. */
function dayBaseMs(): number {
  return new Date(2026, 10, 20, 9, 0, 0, 0).getTime();
}

/** {@link dayBaseMs} in whole epoch seconds, the unit `screenshots.captured_at` uses. */
function dayBaseSeconds(): number {
  return Math.floor(dayBaseMs() / 1000);
}

/** A frontmost app the fixtures report on a frame. */
interface AppSpec {
  bundleId?: string;
  name?: string;
  windowTitle?: string;
}

const CODE_APP: AppSpec = {
  bundleId: 'com.microsoft.VSCode',
  name: 'Code',
  windowTitle: 'pipeline.ts — dsh-plugin-dayflow',
};

const TERMINAL_APP: AppSpec = {
  bundleId: 'com.apple.Terminal',
  name: 'Terminal',
  windowTitle: 'npm test',
};

const BROWSER_APP: AppSpec = {
  bundleId: 'com.google.Chrome',
  name: 'Chrome',
  windowTitle: 'Inbox',
};

/** One disposable journal + frames directory + the config that reads them. */
interface Fixture {
  journalPath: string;
  framesDirectory: string;
  config: ResolvedConfig;
}

interface FixtureOptions {
  /** `capture` block overrides; `enabled: true` unless the case says otherwise. */
  capture?: Partial<CaptureConfig>;
  /** `analysis` block overrides; a fake cloud provider is the success default. */
  analysis?: Partial<AnalysisConfig>;
}

let fixtureCount = 0;

/** Create a fixture with a migrated journal and an empty frames directory. */
function createFixture(options: FixtureOptions = {}): Fixture {
  fixtureCount += 1;
  const root = join(directory, `case-${String(fixtureCount)}`);
  const framesDirectory = join(root, 'frames');
  mkdirSync(framesDirectory, { recursive: true, mode: 0o700 });
  const journalPath = join(root, 'journal.sqlite');
  // Creating the journal here means every case starts from the migrated schema,
  // and the pipeline itself only ever opens an existing journal.
  openJournal(journalPath).close();
  const config = resolveConfig({
    databasePath: join(root, 'chunks.sqlite'),
    journalPath,
    source: 'owned',
    capture: { enabled: true, ...options.capture },
    analysis: {
      consent: 'cloud',
      provider: 'fake-provider',
      model: 'fake-model',
      ...options.analysis,
    },
  });
  return { journalPath, framesDirectory, config };
}

/** How one seeded frame behaves on disk. */
type FrameFile = 'write' | 'missing' | 'directory';

/** One frame to seed into the journal and the frames directory. */
interface FrameSpec {
  /** Seconds after 09:00 local on {@link DAY}. */
  offsetSeconds: number;
  app?: AppSpec;
  hash?: string;
  /** Frame file behaviour; a real file unless the case says otherwise. */
  file?: FrameFile;
}

/** Seed native screenshot rows and, unless told otherwise, their frame files. */
function seedFrames(fixture: Fixture, specs: readonly FrameSpec[]): number[] {
  const base = dayBaseMs();
  const paths = specs.map((_spec, index) => join(fixture.framesDirectory, `frame-${String(index)}.jpg`));
  const ids = withJournalWrite(fixture.journalPath, (db) =>
    specs.map((spec, index) => {
      const payload: Record<string, unknown> = { width: 1920, height: 1080, outcome: 'stored' };
      if (spec.hash !== undefined) payload.hash = spec.hash;
      if (spec.app !== undefined) payload.app = spec.app;
      return recordScreenshotRow(db, {
        sourceKey: `frame-${String(index)}`,
        capturedAt: base + spec.offsetSeconds * 1000,
        day: DAY,
        filePath: paths[index] as string,
        fileSize: 4,
        payload,
      });
    }),
  );
  for (const [index, spec] of specs.entries()) {
    const path = paths[index] as string;
    const file = spec.file ?? 'write';
    if (file === 'write') writeFileSync(path, 'jpeg');
    else if (file === 'directory') mkdirSync(path, { recursive: true });
  }
  return ids;
}

/** Build the pipeline for one fixture, with the fake adapter and test options. */
function pipelineFor(
  fixture: Fixture,
  options: {
    analyser?: AnalysisLlmStream;
    categories?: readonly string[];
    mergeGapSeconds?: number;
    now?: () => Date;
  } = {},
): AnalysisPipeline {
  const settings: ConstructorParameters<typeof AnalysisPipeline>[0] = {
    journalPath: fixture.journalPath,
    framesDirectory: fixture.framesDirectory,
    config: fixture.config,
  };
  if (options.analyser !== undefined) settings.analyser = options.analyser;
  if (options.categories !== undefined) settings.categories = options.categories;
  if (options.mergeGapSeconds !== undefined) settings.mergeGapSeconds = options.mergeGapSeconds;
  // The clock defaults into the fixture's day, so `run()` without an explicit
  // day still reads the seeded frames.
  settings.now = options.now ?? (() => new Date(2026, 10, 20, 12, 0, 0, 0));
  return new AnalysisPipeline(settings);
}

/** A valid model answer; `overrides` make one field deliberately wrong. */
function jsonAnswer(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: 'Worked on the analysis pipeline',
    summary: 'Edited the pipeline module and ran its tests.',
    category: 'Work',
    subcategory: 'coding',
    apps: ['Code', 'Terminal'],
    distractions: [],
    confidence: 0.9,
    ...overrides,
  });
}

/** The categories every success case offers. */
const WORK_CATEGORIES = ['Work', 'Communication', 'Distraction'] as const;

/** One `activities` row as these tests read it. */
interface ActivityRow {
  id: number;
  source_key: string;
  start_ts: number;
  end_ts: number;
  day: string;
  title: string;
  summary: string;
  category: string;
  subcategory: string | null;
  payload_json: string | null;
}

/** One `observations` row as these tests read it. */
interface ObservationRow {
  id: number;
  source_key: string;
  activity_id: number | null;
  start_ts: number;
  end_ts: number;
  payload_json: string;
}

/** One `screenshots` row's retention-relevant columns. */
interface ScreenshotRow {
  id: number;
  captured_at: number;
  file_path: string | null;
}

/** Read every native activity the fixture wrote, oldest first. */
function activities(fixture: Fixture): ActivityRow[] {
  return withJournal(fixture.journalPath, (db) =>
    db
      .prepare(
        `SELECT id, source_key, start_ts, end_ts, day, title, summary, category, subcategory, payload_json
           FROM activities WHERE source_id = 'native' ORDER BY start_ts ASC, id ASC`,
      )
      .all() as unknown as ActivityRow[],
  );
}

/** Read every native observation the fixture wrote, oldest first. */
function observations(fixture: Fixture): ObservationRow[] {
  return withJournal(fixture.journalPath, (db) =>
    db
      .prepare(
        `SELECT id, source_key, activity_id, start_ts, end_ts, payload_json
           FROM observations WHERE source_id = 'native' ORDER BY start_ts ASC, id ASC`,
      )
      .all() as unknown as ObservationRow[],
  );
}

/** Read the day's analysis jobs, window order. */
function jobs(fixture: Fixture): AnalysisJob[] {
  return withJournal(fixture.journalPath, (db) =>
    listAnalysisJobs(db, { day: DAY, limit: 500 }),
  );
}

/** Read the day's seeded screenshot rows, capture order. */
function screenshots(fixture: Fixture): ScreenshotRow[] {
  return withJournal(fixture.journalPath, (db) =>
    db
      .prepare(
        'SELECT id, captured_at, file_path FROM screenshots WHERE source_id = ? ORDER BY captured_at ASC, id ASC',
      )
      .all('native') as unknown as ScreenshotRow[],
  );
}

/** Whether a path exists (any type). */
function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Assert one fixture wrote no activity and no observation. */
function assertNothingWritten(fixture: Fixture): void {
  assert.equal(activities(fixture).length, 0, 'no activity was written');
  assert.equal(observations(fixture).length, 0, 'no observation was written');
}

/** Parse an activity's stored payload. */
function payloadOf(row: Pick<ActivityRow, 'payload_json'>): Record<string, unknown> {
  assert.equal(typeof row.payload_json, 'string', 'the activity has a payload');
  return JSON.parse(row.payload_json as string) as Record<string, unknown>;
}

/** Pause capture through the journal, the way the panel switch does. */
function pauseCapture(fixture: Fixture): void {
  withJournalWrite(fixture.journalPath, (db) => {
    writeCaptureState(db, { paused: true });
  });
}

test('a scripted replay writes one card and replaying it is a no-op', async () => {
  const fixture = createFixture({ capture: { keepFramesDays: 7 } });
  const ids = seedFrames(fixture, [
    { offsetSeconds: 0, app: CODE_APP, hash: 'aaa111' },
    { offsetSeconds: 120, app: CODE_APP, hash: 'bbb222' },
    { offsetSeconds: 240, app: CODE_APP, hash: 'ccc333' },
  ]);
  const analyser = createFakeLlmAdapter([jsonAnswer()]);
  const pipeline = pipelineFor(fixture, { analyser, categories: WORK_CATEGORIES });

  const first = await pipeline.run();
  assert.equal(first.outcome, 'analysed');
  assert.equal(first.day, DAY);
  assert.equal(first.windows, 1);
  assert.equal(first.analysed, 1);
  assert.equal(first.skipped, 0);
  assert.equal(first.failed, 0);
  assert.equal(first.activitiesWritten, 1);

  // The call carried the resolved provider/model and the window's prompt.
  assert.equal(analyser.calls.length, 1);
  assert.equal(analyser.calls[0]?.provider, 'fake-provider');
  assert.equal(analyser.calls[0]?.model, 'fake-model');
  assert.match(analyser.calls[0]?.system ?? '', /JSON/);
  assert.match(analyser.calls[0]?.user ?? '', new RegExp(`Day: ${DAY}`));
  assert.match(analyser.calls[0]?.user ?? '', /Frames in window: 3 \(rendering 3 representative frame\(s\)\)/);
  assert.match(analyser.calls[0]?.user ?? '', /app="Code"/);

  const jobKey = analysisJobKey(DAY, dayBaseSeconds());
  const activityRows = activities(fixture);
  assert.equal(activityRows.length, 1);
  const activity = activityRows[0] as ActivityRow;
  assert.equal(activity.source_key, `analysis:${jobKey}`);
  assert.equal(activity.day, DAY);
  assert.equal(activity.start_ts, dayBaseSeconds());
  assert.equal(activity.end_ts, dayBaseSeconds() + 600, 'the window is the fixed ten-minute box');
  assert.equal(activity.title, 'Worked on the analysis pipeline');
  assert.equal(activity.summary, 'Edited the pipeline module and ran its tests.');
  assert.equal(activity.category, 'Work');
  assert.equal(activity.subcategory, 'coding');
  const payload = payloadOf(activity);
  assert.equal(payload.job_key, jobKey);
  assert.equal(payload.model, 'fake-model');
  assert.equal(payload.provider, 'fake-provider');
  assert.equal(typeof payload.input_tokens, 'number');
  assert.equal(typeof payload.output_tokens, 'number');
  assert.equal(payload.confidence, 0.9);
  assert.deepEqual(payload.apps, ['Code', 'Terminal']);
  assert.deepEqual(payload.distractions, []);

  const observationRows = observations(fixture);
  assert.equal(observationRows.length, 3, 'one observation per representative frame');
  for (const [index, observation] of observationRows.entries()) {
    assert.equal(observation.source_key, `${jobKey}:${String(ids[index])}`);
    assert.equal(observation.activity_id, activity.id);
    assert.equal(observation.start_ts, dayBaseSeconds() + index * 120);
    assert.equal(observation.end_ts, observation.start_ts);
    const observationPayload = JSON.parse(observation.payload_json) as Record<string, unknown>;
    assert.equal(observationPayload.screenshot_id, ids[index]);
    assert.equal(observationPayload.hash, ['aaa111', 'bbb222', 'ccc333'][index]);
    assert.deepEqual(observationPayload.app, {
      bundleId: 'com.microsoft.VSCode',
      name: 'Code',
    });
    assert.equal(observationPayload.window_title, 'pipeline.ts — dsh-plugin-dayflow');
  }

  const jobRows = jobs(fixture);
  assert.equal(jobRows.length, 1);
  assert.equal(jobRows[0]?.job_key, jobKey);
  assert.equal(jobRows[0]?.status, 'complete');
  assert.equal(jobRows[0]?.attempts, 1);
  assert.equal(jobRows[0]?.model, 'fake-model');
  assert.ok((jobRows[0]?.input_tokens ?? 0) > 0);

  // Replaying the same frames: the ledger refuses the work, the adapter is silent.
  const replay = createFakeLlmAdapter([]);
  const second = await pipelineFor(fixture, { analyser: replay, categories: WORK_CATEGORIES }).run();
  assert.equal(second.outcome, 'analysed');
  assert.equal(second.analysed, 0);
  assert.equal(second.skipped, 1);
  assert.equal(second.failed, 0);
  assert.equal(replay.calls.length, 0, 'a complete job is never called again');
  assert.equal(activities(fixture).length, 1);
  assert.equal(observations(fixture).length, 3);
});

test('the consent gate skips every window with its typed reason and calls nothing', async (t) => {
  const cases: {
    name: string;
    capture?: Partial<CaptureConfig>;
    analysis?: Partial<AnalysisConfig>;
    paused?: boolean;
    reason: string;
  }[] = [
    { name: 'analysis switched off', analysis: { enabled: false }, reason: 'analysis-disabled' },
    { name: 'capture switched off', capture: { enabled: false }, reason: 'capture-disabled' },
    { name: 'capture paused', paused: true, reason: 'paused' },
    { name: 'consent none', analysis: { consent: 'none' }, reason: 'consent:none' },
    { name: 'provider unset', analysis: { provider: '' }, reason: 'provider-unset' },
    { name: 'model unset', analysis: { model: '' }, reason: 'model-unset' },
  ];

  for (const blocked of cases) {
    await t.test(blocked.name, async () => {
      const fixture = createFixture({ capture: blocked.capture, analysis: blocked.analysis });
      // Two windows, so "one skipped job per window" is a real count.
      seedFrames(fixture, [
        { offsetSeconds: 0, app: CODE_APP },
        { offsetSeconds: 60, app: CODE_APP },
        { offsetSeconds: 700, app: CODE_APP },
        { offsetSeconds: 760, app: CODE_APP },
      ]);
      if (blocked.paused === true) pauseCapture(fixture);
      const analyser = createFakeLlmAdapter([]);
      const result = await pipelineFor(fixture, { analyser }).run();

      assert.equal(result.outcome, 'blocked');
      assert.equal(result.blockedReason, blocked.reason);
      assert.equal(result.windows, 2);
      assert.equal(result.analysed, 0);
      assert.equal(result.skipped, 2);
      assert.equal(result.failed, 0);
      assert.equal(analyser.calls.length, 0, 'the gate is checked before the provider');
      assertNothingWritten(fixture);

      const jobRows = jobs(fixture);
      assert.equal(jobRows.length, 2, 'one job per window');
      for (const job of jobRows) {
        assert.equal(job.status, 'skipped');
        assert.equal(job.error, blocked.reason);
        assert.equal(job.attempts, 0, 'a skipped job never started');
      }
    });
  }
});

test('consent local demands the provider on the explicit local allowlist', async () => {
  const refused = createFixture({
    analysis: { consent: 'local', provider: 'openai', model: 'gpt-5' },
  });
  seedFrames(refused, [{ offsetSeconds: 0, app: CODE_APP }]);
  const refusedAnalyser = createFakeLlmAdapter([]);
  const refusedResult = await pipelineFor(refused, { analyser: refusedAnalyser }).run();
  assert.equal(refusedResult.outcome, 'blocked');
  assert.equal(refusedResult.blockedReason, 'consent:provider-not-local');
  assert.equal(refusedAnalyser.calls.length, 0);
  assert.equal(jobs(refused)[0]?.error, 'consent:provider-not-local');

  // A provider that is on the list is accepted, matched case-insensitively.
  const allowed = createFixture({
    analysis: {
      consent: 'local',
      provider: 'Ollama',
      model: 'llama3',
      localProviders: ['ollama'],
    },
  });
  seedFrames(allowed, [{ offsetSeconds: 0, app: CODE_APP }]);
  const allowedAnalyser = createFakeLlmAdapter([jsonAnswer()]);
  const allowedResult = await pipelineFor(allowed, {
    analyser: allowedAnalyser,
    categories: WORK_CATEGORIES,
  }).run();
  assert.equal(allowedResult.outcome, 'analysed');
  assert.equal(allowedResult.analysed, 1);
  assert.equal(allowedAnalyser.calls.length, 1);
  assert.equal(allowedAnalyser.calls[0]?.provider, 'Ollama');
});

test('a malformed model answer fails the window and writes nothing', async (t) => {
  const cases: { name: string; text: string }[] = [
    { name: 'not JSON', text: 'I think you were coding, but I cannot say for sure.' },
    {
      name: 'missing title',
      text: JSON.stringify({ summary: 's', category: 'Work', confidence: 0.5 }),
    },
    {
      name: 'unknown category',
      text: jsonAnswer({ category: 'NotACategory' }),
    },
    {
      name: 'confidence out of range',
      text: jsonAnswer({ confidence: 1.5 }),
    },
    {
      name: 'two JSON objects',
      text: `${jsonAnswer()}${jsonAnswer({ title: 'a second object' })}`,
    },
  ];

  for (const malformed of cases) {
    await t.test(malformed.name, async () => {
      const fixture = createFixture();
      seedFrames(fixture, [
        { offsetSeconds: 0, app: CODE_APP },
        { offsetSeconds: 60, app: CODE_APP },
      ]);
      const analyser = createFakeLlmAdapter([malformed.text]);
      const result = await pipelineFor(fixture, {
        analyser,
        categories: WORK_CATEGORIES,
      }).run();

      assert.equal(result.outcome, 'analysed');
      assert.equal(result.analysed, 0);
      assert.equal(result.failed, 1);
      assert.equal(result.activitiesWritten, 0);
      assert.equal(analyser.calls.length, 1, 'invalid output is not retried inside one run');
      assertNothingWritten(fixture);

      const jobRows = jobs(fixture);
      assert.equal(jobRows.length, 1);
      assert.equal(jobRows[0]?.status, 'failed');
      assert.equal(jobRows[0]?.attempts, 1);
      assert.equal(typeof jobRows[0]?.error, 'string');
    });
  }
});

test('a persistently failing window stops at the attempts cap', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [
    { offsetSeconds: 0, app: CODE_APP },
    { offsetSeconds: 60, app: CODE_APP },
  ]);
  // Two bad answers: one per allowed attempt. A third call would exhaust the
  // script and fail differently, so the call count proves the cap.
  const analyser = createFakeLlmAdapter(['not JSON at all', 'still not JSON']);
  const pipeline = pipelineFor(fixture, { analyser, categories: WORK_CATEGORIES });

  const first = await pipeline.run();
  assert.equal(first.failed, 1);
  assert.equal(jobs(fixture)[0]?.attempts, 1);

  const second = await pipeline.run();
  assert.equal(second.failed, 1);
  assert.equal(jobs(fixture)[0]?.attempts, ANALYSIS_MAX_ATTEMPTS);

  const third = await pipeline.run();
  assert.equal(third.analysed, 0);
  assert.equal(third.failed, 0);
  assert.equal(third.skipped, 1, 'an exhausted job is skipped, not called');
  assert.equal(analyser.calls.length, ANALYSIS_MAX_ATTEMPTS);

  const job = jobs(fixture)[0] as AnalysisJob;
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, ANALYSIS_MAX_ATTEMPTS);
  assertNothingWritten(fixture);
});

test('frames split into windows on a gap longer than windowMinutes', async () => {
  const fixture = createFixture({
    analysis: { windowMinutes: 10, framesPerWindow: 2 },
  });
  // Five frames in the first window, then an eleven-minute gap, then three.
  seedFrames(fixture, [
    { offsetSeconds: 0, app: CODE_APP },
    { offsetSeconds: 120, app: CODE_APP },
    { offsetSeconds: 240, app: CODE_APP },
    { offsetSeconds: 360, app: CODE_APP },
    { offsetSeconds: 480, app: CODE_APP },
    { offsetSeconds: 1140, app: TERMINAL_APP },
    { offsetSeconds: 1260, app: TERMINAL_APP },
    { offsetSeconds: 1380, app: TERMINAL_APP },
  ]);
  const analyser = createFakeLlmAdapter([jsonAnswer(), jsonAnswer()]);
  const result = await pipelineFor(fixture, {
    analyser,
    categories: WORK_CATEGORIES,
  }).run();

  assert.equal(result.windows, 2);
  assert.equal(result.analysed, 2);
  assert.equal(result.activitiesWritten, 2);
  assert.equal(analyser.calls.length, 2);

  // At most framesPerWindow representative frames reach the prompt, and the
  // first and last frame of each window are the ones chosen.
  assert.match(analyser.calls[0]?.user ?? '', /Frames in window: 2 \(rendering 2 representative frame\(s\)\)/);
  assert.match(analyser.calls[0]?.user ?? '', /Frame 1: captured_at=/);
  assert.match(analyser.calls[0]?.user ?? '', /Frame 2: captured_at=/);
  assert.equal((analyser.calls[0]?.user ?? '').includes('Frame 3:'), false, 'never more than framesPerWindow');
  assert.match(analyser.calls[1]?.user ?? '', /Frames in window: 2 \(rendering 2 representative frame\(s\)\)/);
  const observationStarts = observations(fixture).map((row) => row.start_ts);
  assert.deepEqual(observationStarts, [
    dayBaseSeconds(),
    dayBaseSeconds() + 480,
    dayBaseSeconds() + 1140,
    dayBaseSeconds() + 1380,
  ]);

  const jobRows = jobs(fixture);
  assert.deepEqual(
    jobRows.map((job) => job.window_start_ts),
    [dayBaseSeconds(), dayBaseSeconds() + 1140],
  );
  // A different app never merges across the gap, and these windows are far
  // apart anyway, so two distinct cards exist.
  assert.equal(activities(fixture).length, 2);
});

test('adjacent windows with the same app and category merge into one card', async () => {
  const frames: FrameSpec[] = [
    { offsetSeconds: 0, app: CODE_APP },
    { offsetSeconds: 60, app: CODE_APP },
    { offsetSeconds: 700, app: CODE_APP },
    { offsetSeconds: 760, app: CODE_APP },
  ];

  const merged = createFixture({ analysis: { windowMinutes: 10 } });
  seedFrames(merged, frames);
  const mergedAnalyser = createFakeLlmAdapter([jsonAnswer(), jsonAnswer()]);
  const mergedResult = await pipelineFor(merged, {
    analyser: mergedAnalyser,
    categories: WORK_CATEGORIES,
  }).run();
  assert.equal(mergedResult.windows, 2);
  assert.equal(mergedResult.analysed, 2);
  assert.equal(mergedResult.activitiesWritten, 1, 'the second window extends the first card');
  const cards = activities(merged);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.source_key, `analysis:${analysisJobKey(DAY, dayBaseSeconds())}`);
  assert.equal(cards[0]?.start_ts, dayBaseSeconds(), 'the card starts at the first window');
  assert.equal(cards[0]?.end_ts, dayBaseSeconds() + 1300, 'the card ends at the last merged window');
  assert.equal(observations(merged).length, 4, 'every merged window keeps its observations');
  assert.equal(jobs(merged).filter((job) => job.status === 'complete').length, 2);

  // Same app, different category: two cards.
  const split = createFixture({ analysis: { windowMinutes: 10 } });
  seedFrames(split, frames);
  const splitAnalyser = createFakeLlmAdapter([
    jsonAnswer({ category: 'Work' }),
    jsonAnswer({ category: 'Communication' }),
  ]);
  await pipelineFor(split, { analyser: splitAnalyser, categories: WORK_CATEGORIES }).run();
  assert.equal(activities(split).length, 2);
  assert.equal(observations(split).length, 4);

  // Same category, different app: two cards even though the gap is short.
  const appSplit = createFixture({ analysis: { windowMinutes: 10 } });
  seedFrames(appSplit, [
    { offsetSeconds: 0, app: CODE_APP },
    { offsetSeconds: 60, app: CODE_APP },
    { offsetSeconds: 700, app: TERMINAL_APP },
    { offsetSeconds: 760, app: TERMINAL_APP },
  ]);
  const appSplitAnalyser = createFakeLlmAdapter([jsonAnswer(), jsonAnswer()]);
  await pipelineFor(appSplit, { analyser: appSplitAnalyser, categories: WORK_CATEGORIES }).run();
  assert.equal(activities(appSplit).length, 2);
});

test('maxCallsPerDay stops the day after the last affordable call', async () => {
  const fixture = createFixture({ analysis: { maxCallsPerDay: 1 } });
  seedFrames(fixture, [
    { offsetSeconds: 0, app: CODE_APP },
    { offsetSeconds: 60, app: CODE_APP },
    { offsetSeconds: 700, app: TERMINAL_APP },
    { offsetSeconds: 760, app: TERMINAL_APP },
  ]);
  const analyser = createFakeLlmAdapter([jsonAnswer(), jsonAnswer()]);
  const result = await pipelineFor(fixture, {
    analyser,
    categories: WORK_CATEGORIES,
  }).run();

  assert.equal(result.outcome, 'budget');
  assert.equal(result.windows, 2);
  assert.equal(result.analysed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.equal(analyser.calls.length, 1, 'the budget is checked before the second call');
  assert.equal(activities(fixture).length, 1);

  const jobRows = jobs(fixture);
  assert.equal(jobRows.length, 2);
  assert.equal(jobRows[0]?.status, 'complete');
  assert.equal(jobRows[1]?.status, 'skipped');
  assert.equal(jobRows[1]?.error, 'budget');
  assert.equal(jobRows[1]?.attempts, 0, 'a budget skip is not a call');
});

test('keepFramesDays 0 deletes an analysed window and keeps a failed one', async () => {
  // Success: every frame in the window is deleted, not just the representatives.
  const deleted = createFixture({
    capture: { keepFramesDays: 0 },
    analysis: { framesPerWindow: 1 },
  });
  seedFrames(deleted, [
    { offsetSeconds: 0, app: CODE_APP },
    { offsetSeconds: 60, app: CODE_APP },
    { offsetSeconds: 120, app: CODE_APP },
  ]);
  const deletedAnalyser = createFakeLlmAdapter([jsonAnswer()]);
  const deletedResult = await pipelineFor(deleted, {
    analyser: deletedAnalyser,
    categories: WORK_CATEGORIES,
  }).run();
  assert.equal(deletedResult.analysed, 1);
  assert.equal(observations(deleted).length, 1, 'only the representative frame is observed');
  assert.equal(activities(deleted).length, 1);
  const deletedRows = screenshots(deleted);
  assert.equal(deletedRows.length, 3);
  for (const row of deletedRows) {
    assert.equal(row.file_path, null, 'the path is cleared once the frame is gone');
    const index = deletedRows.indexOf(row);
    assert.equal(
      exists(join(deleted.framesDirectory, `frame-${String(index)}.jpg`)),
      false,
      `frame-${String(index)}.jpg is deleted`,
    );
  }

  // Failure: the frames are kept for the retry.
  const kept = createFixture({ capture: { keepFramesDays: 0 } });
  seedFrames(kept, [
    { offsetSeconds: 0, app: CODE_APP },
    { offsetSeconds: 60, app: CODE_APP },
  ]);
  const keptAnalyser = createFakeLlmAdapter(['not JSON']);
  const keptResult = await pipelineFor(kept, { analyser: keptAnalyser }).run();
  assert.equal(keptResult.failed, 1);
  assert.equal(exists(join(kept.framesDirectory, 'frame-0.jpg')), true);
  assert.equal(exists(join(kept.framesDirectory, 'frame-1.jpg')), true);
  for (const row of screenshots(kept)) assert.notEqual(row.file_path, null);
});

test('an unlinkable frame file never fails the window', async () => {
  const fixture = createFixture({ capture: { keepFramesDays: 0 } });
  seedFrames(fixture, [
    { offsetSeconds: 0, app: CODE_APP, file: 'missing' },
    { offsetSeconds: 60, app: CODE_APP, file: 'directory' },
  ]);
  const analyser = createFakeLlmAdapter([jsonAnswer()]);
  const result = await pipelineFor(fixture, {
    analyser,
    categories: WORK_CATEGORIES,
  }).run();

  assert.equal(result.outcome, 'analysed');
  assert.equal(result.analysed, 1);
  assert.equal(result.failed, 0);
  assert.equal(activities(fixture).length, 1);
  for (const row of screenshots(fixture)) assert.equal(row.file_path, null);
});

test('the offered categories default to the owned categories table', async () => {
  const offered = createFixture();
  withJournalWrite(offered.journalPath, (db) => {
    db.prepare(
      `INSERT INTO categories (source_id, source_key, name, color_hex, is_system, is_idle)
       VALUES (?, ?, ?, ?, 0, 0)`,
    ).run('native', 'test:work', 'Work', '#B984FF');
  });
  seedFrames(offered, [{ offsetSeconds: 0, app: CODE_APP }]);
  const analyser = createFakeLlmAdapter([jsonAnswer({ category: 'Work' })]);
  const result = await pipelineFor(offered, { analyser }).run();
  assert.equal(result.analysed, 1, 'a category from the owned table is accepted');
  assert.equal(activities(offered)[0]?.category, 'Work');

  // A category the owned table does not offer is rejected even without an
  // explicit `categories` option.
  const rejected = createFixture();
  withJournalWrite(rejected.journalPath, (db) => {
    db.prepare(
      `INSERT INTO categories (source_id, source_key, name, color_hex, is_system, is_idle)
       VALUES (?, ?, ?, ?, 0, 0)`,
    ).run('native', 'test:work', 'Work', '#B984FF');
  });
  seedFrames(rejected, [{ offsetSeconds: 0, app: CODE_APP }]);
  const badAnalyser = createFakeLlmAdapter([jsonAnswer({ category: 'Personal' })]);
  const rejectedResult = await pipelineFor(rejected, { analyser: badAnalyser }).run();
  assert.equal(rejectedResult.failed, 1);
  assert.equal(activities(rejected).length, 0);
});

test('a day with no frames is empty and creates no job', async () => {
  const fixture = createFixture();
  const analyser = createFakeLlmAdapter([]);
  const result = await pipelineFor(fixture, { analyser }).run({ day: DAY });

  assert.equal(result.outcome, 'empty');
  assert.equal(result.windows, 0);
  assert.equal(result.analysed, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.equal(analyser.calls.length, 0);
  assert.equal(jobs(fixture).length, 0, 'no window means no job');
  assertNothingWritten(fixture);

  // The day defaults to the one containing the injected clock.
  const dated = createFixture();
  seedFrames(dated, [{ offsetSeconds: 0, app: CODE_APP }]);
  const datedAnalyser = createFakeLlmAdapter([jsonAnswer()]);
  const datedResult = await pipelineFor(dated, {
    analyser: datedAnalyser,
    categories: WORK_CATEGORIES,
    now: () => new Date(2026, 10, 20, 12, 0, 0, 0),
  }).run();
  assert.equal(datedResult.day, DAY);
  assert.equal(datedResult.analysed, 1);
});

test('an unusable day argument is rejected as invalid_input', async () => {
  const fixture = createFixture();
  const pipeline = pipelineFor(fixture);

  for (const day of ['2026-02-30', 'not-a-date', '2026-11-20T09:00:00']) {
    await assert.rejects(
      pipeline.run({ day }),
      (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
      `${day} must be rejected`,
    );
  }
});

test('an unset analyser skips every window without touching the provider', async () => {
  const fixture = createFixture();
  seedFrames(fixture, [
    { offsetSeconds: 0, app: CODE_APP },
    { offsetSeconds: 60, app: CODE_APP },
    { offsetSeconds: 700, app: TERMINAL_APP },
    { offsetSeconds: 760, app: TERMINAL_APP },
  ]);
  const result = await pipelineFor(fixture).run();

  assert.equal(result.outcome, 'blocked');
  assert.equal(result.blockedReason, 'analyser-unset');
  assert.equal(result.windows, 2);
  assert.equal(result.analysed, 0);
  assert.equal(result.skipped, 2);
  assertNothingWritten(fixture);
  const jobRows = jobs(fixture);
  assert.equal(jobRows.length, 2);
  for (const job of jobRows) {
    assert.equal(job.status, 'skipped');
    assert.equal(job.error, 'analyser-unset');
    assert.equal(job.attempts, 0);
  }

  // A skipped job is terminal: even with an analyser injected later, the same
  // windows are not called again. That is the ledger's replay guarantee.
  const late = createFakeLlmAdapter([jsonAnswer(), jsonAnswer()]);
  const second = await pipelineFor(fixture, { analyser: late, categories: WORK_CATEGORIES }).run();
  assert.equal(second.analysed, 0);
  assert.equal(second.skipped, 2);
  assert.equal(late.calls.length, 0);
});
