#!/usr/bin/env node
/**
 * Phase 4 cutover rehearsal: a fixture dry run of the native port end to end.
 *
 * This is the executable form of the checklist in
 * [`docs/CUTOVER_REHEARSAL.md`](../docs/CUTOVER_REHEARSAL.md). The document says
 * what a cutover has to verify — permission, frames, cards, daily brief, day
 * insights (reflection, queue, task session), the weekly close (brief plus the
 * memory-health digest and its lint proposals), and that none of it is lost
 * across a restart. This script runs exactly that sequence against a throwaway
 * journal and a fake capture provider, prints one pass/fail row per check, then
 * exits 0 (all pass), 1 (any fail), or 2 (the build is missing).
 *
 * Nothing outside one `mkdtemp` directory is written: the journal, the frame
 * files, and a private `DSH_HOME` all live under that directory, which is
 * removed before exit. The script never reads the real Dayflow database, never
 * captures the real screen (the provider is a fake implementing
 * `permission`/`state`/`capture`), and never opens a network connection — every
 * model call goes through `createFakeLlmAdapter`.
 *
 * The fixture is one Dayflow day (04:00–04:00 local) inside the current week:
 *
 * - 4 fake frames are captured through the real `CaptureEngine`, arranged as two
 *   analysis windows (two frames, a 24-minute gap, two frames);
 * - `AnalysisPipeline` turns each window into one card, and at
 *   `keepFramesDays: 0` releases the four frame files;
 * - `writeDailyBrief` writes one standup row;
 * - `runDayInsights` writes one day reflection, two review proposals, and one
 *   task session on a seeded active long task;
 * - four seeded memory claims (a contradiction and two aged claims among them)
 *   make `runWeeklyLint` produce proposals without a model call, and
 *   `writeWeeklyBrief` records the week plus the `Memory health:` digest;
 * - every table is counted before and after the journal is reopened.
 *
 * Usage:
 *
 *   npm run build          # or `npm test`, which builds first
 *   npm run rehearsal      # == node scripts/cutover-rehearsal.mjs
 *
 * The script reads the compiled `lib/` build (then, on a Node that can strip
 * types, falls back to `src/`), and exits 2 with a build hint when neither can
 * be loaded. `DAYFLOW_REHEARSAL_LIB=/path/to/lib` points it at another build
 * directory, which is how a `tsc --outDir /tmp/...` check can run it without a
 * repository build.
 * @module scripts/cutover-rehearsal
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The published build output; `npm run build` writes it. */
const LIB_DIRECTORY = fileURLToPath(new URL('../lib', import.meta.url));
/**
 * The TypeScript source, tried only after `lib/` fails to load. Plain `node`
 * cannot resolve the source's `.js` import specifiers, so this fallback is best
 * effort; when it fails too the run still ends with the `npm run build` hint.
 */
const SRC_DIRECTORY = fileURLToPath(new URL('../src', import.meta.url));

/**
 * The compiled modules this rehearsal drives, and the source file each one
 * corresponds to. The list is explicit so a missing build fails loudly with the
 * one module it could not load.
 */
const MODULE_LOADERS = {
  day: 'day',
  config: 'config',
  journal: 'journal',
  captureEngine: 'capture/engine',
  pipeline: 'analyse/pipeline',
  llm: 'analyse/llm',
  dailyBrief: 'briefs/daily',
  weeklyBrief: 'briefs/weekly',
  insights: 'automation/insights',
  lint: 'automation/lint',
  memory: 'memory',
  tasks: 'tasks',
};

/** The 13 count labels the restart check compares. */
const COUNT_LABELS = [
  'screenshots',
  'frame_files',
  'activities',
  'observations',
  'analysis_jobs',
  'standup_entries',
  'briefs',
  'reflections',
  'review_items',
  'automation_runs',
  'long_task_sessions',
  'memory_claims',
  'model_calls',
];

/** The four fixture frames, in epoch milliseconds: window 1, a long gap, window 2. */
const FRAME_OFFSETS_MS = [0, 60_000, 25 * 60_000, 26 * 60_000];

/**
 * The frame hashes are pairwise 64 bits apart, so the engine's dHash dedupe
 * (configured at distance 0) stores every one of the four.
 */
const FRAME_HASHES = ['0f0f0f0f0f0f0f0f', 'f0f0f0f0f0f0f0f0', 'ff00ff00ff00ff00', '00ff00ff00ff00ff'];

/** The standup the scripted daily-brief call returns. */
const DAILY_BRIEF_TEXT = [
  '- Read the cutover rehearsal script end to end.',
  '- Seeded two analysis windows with the fake capture provider.',
  '- Verified the standup is written from analysed activity, not from a fixture row.',
  '',
  'Blockers: none',
].join('\n');

/** The weekly review the scripted weekly-brief call returns. */
const WEEKLY_BRIEF_TEXT = [
  'Cutover rehearsal week',
  '',
  'Most of the week went into the fixture dry run: four frames became two cards, one day closed with a standup, and the weekly close ran the memory lint.',
  '',
  'Next week: keep the rehearsal in the release checklist.',
].join('\n');

/**
 * Load the compiled modules from one build directory.
 * @param directory - a `lib`-shaped directory.
 * @param extension - `js` for a build, `ts` for the source fallback.
 * @returns the module namespace, keyed by {@link MODULE_LOADERS}.
 */
async function importModules(directory, extension) {
  const load = (modulePath) => import(pathToFileURL(join(directory, `${modulePath}.${extension}`)).href);
  const loaded = {};
  for (const [key, modulePath] of Object.entries(MODULE_LOADERS)) loaded[key] = await load(modulePath);
  return loaded;
}

/**
 * Load the plugin modules, preferring the build output.
 *
 * `lib/` is what ships and what `npm run build` writes. A TypeScript-source
 * fallback is attempted only when `lib/` cannot be loaded, for Node versions
 * that strip types; a failed fallback (the source's `.js` specifiers do not
 * resolve under plain `node`) still ends in the same actionable error. When
 * `DAYFLOW_REHEARSAL_LIB` is set, that directory is the only candidate.
 * @returns the modules plus the label of what loaded.
 * @throws an error with `exitCode = 2` and a `npm run build` hint.
 */
async function loadModules() {
  const override = process.env.DAYFLOW_REHEARSAL_LIB?.trim();
  const candidates = [];
  if (override !== undefined && override !== '') {
    candidates.push({ label: `DAYFLOW_REHEARSAL_LIB=${override}`, directory: resolve(override), extension: 'js' });
  } else {
    candidates.push({ label: 'lib/', directory: LIB_DIRECTORY, extension: 'js' });
    candidates.push({ label: 'src/ (TypeScript, best effort)', directory: SRC_DIRECTORY, extension: 'ts' });
  }

  const failures = [];
  for (const candidate of candidates) {
    try {
      return { ...(await importModules(candidate.directory, candidate.extension)), origin: candidate.label };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate.label}: ${message}`);
    }
  }

  const error = new Error(
    [
      'The plugin modules are not built, so the rehearsal cannot run.',
      '',
      override === undefined || override === ''
        ? 'Build them first:\n\n  npm run build\n'
        : `DAYFLOW_REHEARSAL_LIB=${override} did not contain a loadable build.\n`,
      'Tried:',
      ...failures.map((failure) => `  ${failure}`),
    ].join('\n'),
  );
  error.exitCode = 2;
  throw error;
}

/** The message of an unknown thrown value. */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Collect the pass/fail rows the table prints.
 *
 * A check is `observed` against `expected` as strings; the caller records every
 * expected outcome rather than throwing, so one wrong count still leaves the
 * rest of the table readable.
 */
class Checks {
  constructor() {
    /** @type {{check: string, observed: string, expected: string, pass: boolean}[]} */
    this.rows = [];
  }

  /**
   * Record one check.
   * @param check - the stable check name.
   * @param observed - what the rehearsal saw.
   * @param expected - what it should have seen.
   * @returns whether the check passed.
   */
  record(check, observed, expected) {
    const observedText = String(observed);
    const expectedText = String(expected);
    const pass = observedText === expectedText;
    this.rows.push({ check, observed: observedText, expected: expectedText, pass });
    return pass;
  }

  /** How many checks passed. */
  get passed() {
    return this.rows.filter((row) => row.pass).length;
  }

  /** How many checks failed. */
  get failed() {
    return this.rows.length - this.passed;
  }
}

/**
 * A fake capture provider: the rehearsal's only capture seam.
 *
 * It implements the same three methods the real provider does — `permission`,
 * `state`, and `capture` — and returns scripted frames, so the real
 * `CaptureEngine` runs every gate and writes the same rows a real capture
 * would, without touching the screen.
 * @param frameTimes - capture instants in epoch milliseconds, one per `capture()`.
 * @returns the provider.
 */
function createFakeCaptureProvider(frameTimes) {
  let index = 0;
  const apps = [
    { bundleId: 'com.rehearsal.editor', name: 'Rehearsal Editor', windowTitle: 'cutover-rehearsal.mjs' },
    { bundleId: 'com.rehearsal.editor', name: 'Rehearsal Editor', windowTitle: 'docs/CUTOVER_REHEARSAL.md' },
    { bundleId: 'com.rehearsal.terminal', name: 'Rehearsal Terminal', windowTitle: 'npm run rehearsal' },
    { bundleId: 'com.rehearsal.terminal', name: 'Rehearsal Terminal', windowTitle: 'node --test' },
  ];
  return {
    name: 'rehearsal-fake',
    async permission() {
      return 'granted';
    },
    async state() {
      return { locked: false, displayAsleep: false, idleSeconds: 0 };
    },
    async capture() {
      const slot = Math.min(index, frameTimes.length - 1);
      const capturedAt = frameTimes[slot];
      const hash = FRAME_HASHES[slot];
      const app = apps[slot];
      index += 1;
      return {
        // A JPEG header and footer around filler: this line is text-only, so no
        // pixel decoder ever reads the bytes, but a frame file still lands on disk.
        jpeg: Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00]),
          Buffer.alloc(16, slot + 1),
          Buffer.from([0xff, 0xd9]),
        ]),
        width: 64,
        height: 64,
        capturedAt,
        app,
        idleSeconds: 0,
        hash,
      };
    },
    dispose() {
      // Nothing to release: the fake provider owns no helper or temp directory.
    },
  };
}

/** Count `.jpg` files under a directory, recursively; a missing tree is 0. */
async function countFrameFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += await countFrameFiles(path);
    else if (entry.name.endsWith('.jpg')) total += 1;
  }
  return total;
}

/** One `SELECT count(*) AS n` result as a number. */
function countRows(db, sql, ...parameters) {
  const row = db.prepare(sql).get(...parameters);
  const value = row?.n;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

/**
 * Read every count the restart check compares, from a fresh connection.
 *
 * The helpers all open and close their own connection, so opening the journal
 * here is the same "close and reopen" a restarted process does.
 * @param options - the modules, paths, and the fake adapters' call count.
 * @returns the 13 labelled counts, in {@link COUNT_LABELS} order.
 */
async function readCounts({ modules, journalPath, framesDirectory, modelCalls }) {
  const db = modules.journal.openJournal(journalPath);
  try {
    return {
      screenshots: countRows(db, 'SELECT count(*) AS n FROM screenshots WHERE COALESCE(is_deleted, 0) = 0'),
      frame_files: await countFrameFiles(framesDirectory),
      activities: countRows(
        db,
        "SELECT count(*) AS n FROM activities WHERE source_id = 'native' AND COALESCE(is_deleted, 0) = 0",
      ),
      observations: countRows(db, 'SELECT count(*) AS n FROM observations WHERE COALESCE(is_deleted, 0) = 0'),
      analysis_jobs: countRows(db, "SELECT count(*) AS n FROM analysis_jobs WHERE status = 'complete'"),
      standup_entries: countRows(
        db,
        'SELECT count(*) AS n FROM daily_standup_entries WHERE COALESCE(is_deleted, 0) = 0',
      ),
      briefs: countRows(db, 'SELECT count(*) AS n FROM briefs'),
      reflections: countRows(db, 'SELECT count(*) AS n FROM reflections'),
      review_items: countRows(db, "SELECT count(*) AS n FROM review_items WHERE status = 'proposed'"),
      automation_runs: countRows(db, 'SELECT count(*) AS n FROM automation_runs'),
      long_task_sessions: countRows(db, 'SELECT count(*) AS n FROM long_task_sessions'),
      memory_claims: countRows(db, 'SELECT count(*) AS n FROM memory_claims WHERE superseded_by IS NULL'),
      model_calls: modelCalls,
    };
  } finally {
    db.close();
  }
}

/** The `YYYY-MM-DD` label of the local calendar day `daysAgo` days before `date`. */
function dayKeyDaysAgo(modules, date, daysAgo) {
  return modules.day.formatDayKey(new Date(date.getTime() - daysAgo * 24 * 60 * 60 * 1000));
}

/**
 * Read the `body` and `payload_json` of the one week brief.
 * @param modules - the loaded modules.
 * @param journalPath - the fixture journal.
 * @param monday - the week's Monday.
 * @returns the stored week's fields, or `undefined` when no row exists.
 */
function readWeekBrief(modules, journalPath, monday) {
  return modules.journal.withJournal(journalPath, (db) => {
    const row = db.prepare("SELECT body, payload_json FROM briefs WHERE kind = 'week' AND period_key = ?").get(monday);
    if (row === undefined) return undefined;
    let payload;
    try {
      payload = row.payload_json === null ? undefined : JSON.parse(String(row.payload_json));
    } catch {
      payload = undefined;
    }
    return { body: String(row.body ?? ''), payload };
  });
}

/**
 * Run the rehearsal: seed, capture, analyse, close the day, close the week,
 * then reopen the journal and compare every count.
 * @param options - the loaded modules, the temp root, the check collector, and
 *   the shared state object the counts block reads.
 * @returns the shared state, with the before/after counts filled in.
 */
async function runRehearsal({ modules, root, checks, state }) {
  const journalPath = join(root, 'journal.sqlite');
  const framesDirectory = join(root, 'frames');
  const now = new Date();

  // The Dayflow day the fixture lives on, and the Monday of its week. Both are
  // derived from the clock so the script is correct on any day of the week.
  const dayWindow = modules.day.dayWindowContaining(now);
  const fixtureDay = dayWindow.dayKey;
  const monday = modules.day.formatDayKey(modules.day.weekWindowContaining(dayWindow.start).start);

  // 09:00 local on the fixture day, then the four frame instants. The third
  // frame is 24 minutes after the second, which is longer than the 10-minute
  // analysis window and the 2-minute merge gap, so it starts a second window.
  const baseMs = dayWindow.start.getTime() + 5 * 60 * 60 * 1000;
  const frameTimes = FRAME_OFFSETS_MS.map((offset) => baseMs + offset);
  Object.assign(state, {
    root,
    fixtureDay,
    monday,
    frameTimes,
  });

  // A private DSH_HOME: every default path resolution stays inside the temp
  // directory, so nothing can reach the real profile's journal or frames.
  process.env.DSH_HOME = join(root, 'home');

  const config = modules.config.resolveConfig({
    source: 'owned',
    databasePath: join(root, 'dayflow-chunks.sqlite'),
    journalPath,
    edits: true,
    skills: false,
    panel: false,
    icons: false,
    memoryContext: true,
    capture: {
      enabled: true,
      intervalSeconds: 5,
      idleSeconds: 0,
      maxFramesPerDay: 100,
      keepFramesDays: 0,
      dedupeDistance: 0,
      retentionCheckMinutes: 60,
    },
    analysis: {
      enabled: true,
      // The fake analyser is the only "provider": consent has to be on for the
      // frame pipeline and the text gate, but `local` (never `cloud`) with an
      // explicitly allowlisted fake provider means no screen text can leave the
      // machine, and no network exists behind the adapter anyway.
      consent: 'local',
      localProviders: ['rehearsal'],
      provider: 'rehearsal',
      model: 'rehearsal-fake-model',
      windowMinutes: 10,
      framesPerWindow: 3,
      maxCallsPerDay: 10,
      dailyTokenBudget: 10_000,
    },
    automation: { enabled: true, dailyAt: '04:00', weeklyOn: 'monday', catchUpOnStart: false, catchUpDays: 1 },
  });

  // 1. The journal opens at the supported schema on a brand-new file.
  const schemaVersion = modules.journal.withJournal(journalPath, (db) =>
    countRows(db, 'SELECT max(version) AS n FROM schema_version'),
  );
  checks.record('journal.schema', schemaVersion, modules.journal.JOURNAL_SCHEMA_VERSION);

  // 2. Capture through the real engine, with a fake provider behind it. The
  //    engine clock and the provider's frame clock are advanced together.
  const provider = createFakeCaptureProvider(frameTimes);
  const permission = await provider.permission();
  checks.record('capture.permission', permission, 'granted');
  state.adapters = [];

  const clock = { value: frameTimes[0] };
  const engine = new modules.captureEngine.CaptureEngine({
    journalPath,
    provider,
    config,
    framesDirectory,
    now: () => new Date(clock.value),
  });
  for (let index = 0; index < frameTimes.length; index += 1) {
    clock.value = frameTimes[index];
    await engine.captureOnce();
  }
  const captureCounts = await countRowsOnJournal(modules, journalPath);
  checks.record('capture.frames', captureCounts.screenshots, 4);
  checks.record('capture.frame_files', await countFrameFiles(framesDirectory), 4);

  // 3. Analysis: two windows, one scripted strict-JSON answer per window. At
  //    keepFramesDays: 0 the pipeline releases each window's frame files and
  //    clears the screenshot row paths in the same transaction as the card.
  const pipelineAdapter = modules.llm.createFakeLlmAdapter([
    JSON.stringify({
      title: 'Cutover rehearsal harness',
      summary: 'Worked on the fixture dry run for the cutover rehearsal.',
      category: 'Development',
      apps: ['Rehearsal Editor'],
      distractions: [],
      confidence: 0.86,
    }),
    JSON.stringify({
      title: 'Rehearsal terminal checks',
      summary: 'Ran the fixture dry run from the terminal.',
      category: 'Development',
      apps: ['Rehearsal Terminal'],
      distractions: [],
      confidence: 0.81,
    }),
  ]);
  state.adapters.push(pipelineAdapter);
  const pipeline = new modules.pipeline.AnalysisPipeline({
    journalPath,
    framesDirectory,
    config,
    now: () => new Date(frameTimes[0]),
    analyser: pipelineAdapter,
    categories: ['Development', 'Communication'],
    mergeGapSeconds: 120,
  });
  const run = await pipeline.run({ day: fixtureDay });
  checks.record('pipeline.windows', run.windows, 2);

  const afterPipeline = await countRowsOnJournal(modules, journalPath);
  checks.record('pipeline.activities', afterPipeline.activities, 2);
  checks.record('pipeline.observations', afterPipeline.observations, 4);
  checks.record('pipeline.jobs_complete', afterPipeline.analysis_jobs, 2);
  checks.record('pipeline.frames_released', await countFrameFiles(framesDirectory), 0);
  checks.record('pipeline.paths_cleared', afterPipeline.released_paths, 4);

  // 4. Daily close: one standup from the day's analysed activities.
  const dailyAdapter = modules.llm.createFakeLlmAdapter([DAILY_BRIEF_TEXT]);
  state.adapters.push(dailyAdapter);
  await modules.dailyBrief.writeDailyBrief({ journalPath, config, analyser: dailyAdapter, day: fixtureDay });
  const afterDaily = await countRowsOnJournal(modules, journalPath);
  checks.record('brief.daily_standup', afterDaily.standup_entries, 1);

  // 5. Day insights: a seeded active long task makes the scripted session
  //    attach instead of being proposed (confidence 0.92 >= 0.8).
  const task = modules.journal.withJournalWrite(journalPath, (db) =>
    modules.tasks.createLongTask(db, {
      title: 'Land the Phase 4 cutover rehearsal',
      description: 'Keep the fixture dry run green until the native preview lands.',
      categories: ['Development'],
      apps: ['Rehearsal Editor'],
    }),
  );
  const insightsAdapter = modules.llm.createFakeLlmAdapter([
    JSON.stringify({
      reflection: {
        body: 'Most of the day went into the cutover rehearsal harness: capturing fixture frames, checking the analysis pipeline, and closing the day with a brief. The work stayed inside the editor and the terminal.',
        highlights: ['fixture frames became two activity cards', 'brief and insights both ran with the fake analyser'],
      },
      proposals: [
        {
          kind: 'distillation',
          title: 'A fixture dry run catches integration gaps before the real profile moves',
          body: 'The rehearsal exercises capture, analysis, briefs, and lint against one throwaway journal.',
          confidence: 0.82,
        },
        {
          kind: 'improvement',
          title: 'Keep the cutover rehearsal in the release checklist',
          body: 'Running it before the tag makes the data-loss check repeatable.',
          confidence: 0.74,
        },
      ],
      task_sessions: [{ task_id: task.id, minutes: 90, confidence: 0.92 }],
    }),
  ]);
  state.adapters.push(insightsAdapter);
  await modules.insights.runDayInsights({
    journalPath,
    config,
    analyser: insightsAdapter,
    day: fixtureDay,
  });
  const afterInsights = await countRowsOnJournal(modules, journalPath);
  checks.record('insights.reflection', afterInsights.reflections, 1);
  checks.record('insights.proposals', afterInsights.review_items, 2);
  checks.record('insights.sessions', afterInsights.long_task_sessions, 1);

  // 6. Weekly close. Seed claims that make the lint find something without a
  //    model call: a contradiction (two live versions of one preference), an
  //    unsourced loop, and two aged claims.
  const agedDay = dayKeyDaysAgo(modules, now, 400);
  modules.journal.withJournalWrite(journalPath, (db) => {
    modules.memory.addMemoryClaim(db, {
      kind: 'preference',
      subject: 'editor of choice',
      body: 'The editor is vim.',
      observed_on: dayKeyDaysAgo(modules, now, 30),
      confidence: 0.8,
      source_days: [dayKeyDaysAgo(modules, now, 30)],
    });
    modules.memory.addMemoryClaim(db, {
      kind: 'preference',
      subject: 'editor of choice',
      body: 'The editor is VS Code now.',
      observed_on: dayKeyDaysAgo(modules, now, 12),
      confidence: 0.8,
      source_days: [dayKeyDaysAgo(modules, now, 12)],
    });
    modules.memory.addMemoryClaim(db, {
      kind: 'loop',
      subject: 'late starts',
      body: 'Work starts after 10:00 on most days.',
      observed_on: agedDay,
      confidence: 0.6,
    });
    modules.memory.addMemoryClaim(db, {
      kind: 'distillation',
      subject: 'release ritual',
      body: 'Tag only after CI is green.',
      observed_on: agedDay,
      confidence: 0.7,
      source_days: [agedDay],
    });
  });

  // The lint first, so the brief can carry its real digest.
  const lint = await modules.lint.runWeeklyLint({
    journalPath,
    config,
    weekMonday: monday,
    maxProposals: 3,
  });
  checks.record('weekly.lint.status', lint.status, 'complete');
  checks.record('weekly.lint.findings', lint.findings, 5);
  checks.record('weekly.lint.proposals', lint.proposals, 3);

  const weeklyAdapter = modules.llm.createFakeLlmAdapter([WEEKLY_BRIEF_TEXT]);
  state.adapters.push(weeklyAdapter);
  await modules.weeklyBrief.writeWeeklyBrief({
    journalPath,
    config,
    analyser: weeklyAdapter,
    monday,
    memoryHealth: { findings: lint.findings, proposals: lint.proposals, summary: lint.summary },
  });
  const afterWeekly = await countRowsOnJournal(modules, journalPath);
  checks.record('weekly.brief', afterWeekly.briefs, 1);
  const weekBrief = readWeekBrief(modules, journalPath, monday);
  const digest = weekBrief?.payload?.memory_health;
  const digestRecorded =
    typeof digest === 'object' &&
    digest !== null &&
    digest.findings === lint.findings &&
    digest.proposals === lint.proposals &&
    weekBrief.body.includes('Memory health: ') &&
    weekBrief.body.trimEnd().endsWith(lint.summary);
  checks.record('weekly.memory_health', digestRecorded ? 'recorded' : 'missing', 'recorded');

  // 7. Restart: count every table from a fresh connection, reopen the file, and
  //    compare. Every write helper has already closed its connection, so this
  //    is the same open/close a restarted process performs.
  const modelCalls = state.adapters.reduce((total, adapter) => total + adapter.calls.length, 0);
  state.countsBefore = await readCounts({ modules, journalPath, framesDirectory, modelCalls });
  state.countsAfter = await readCounts({ modules, journalPath, framesDirectory, modelCalls });
  const unchanged = COUNT_LABELS.filter((label) => state.countsBefore[label] === state.countsAfter[label]);
  checks.record('restart.tables', `${unchanged.length}/${COUNT_LABELS.length} unchanged`, `${COUNT_LABELS.length}/${COUNT_LABELS.length} unchanged`);

  return state;
}

/**
 * One mixed read of the tables the later checks quote, from one fresh connection.
 *
 * Reads are grouped so a step does not open the journal several times just to
 * print three counts; the restart check still opens its own connections.
 * @param modules - the loaded modules.
 * @param journalPath - the fixture journal.
 * @returns the counts the step's checks read.
 */
async function countRowsOnJournal(modules, journalPath) {
  const db = modules.journal.openJournal(journalPath);
  try {
    return {
      screenshots: countRows(db, 'SELECT count(*) AS n FROM screenshots WHERE COALESCE(is_deleted, 0) = 0'),
      activities: countRows(
        db,
        "SELECT count(*) AS n FROM activities WHERE source_id = 'native' AND COALESCE(is_deleted, 0) = 0",
      ),
      observations: countRows(db, 'SELECT count(*) AS n FROM observations WHERE COALESCE(is_deleted, 0) = 0'),
      analysis_jobs: countRows(db, "SELECT count(*) AS n FROM analysis_jobs WHERE status = 'complete'"),
      released_paths: countRows(
        db,
        "SELECT count(*) AS n FROM screenshots WHERE COALESCE(is_deleted, 0) = 0 AND file_path IS NULL",
      ),
      standup_entries: countRows(
        db,
        'SELECT count(*) AS n FROM daily_standup_entries WHERE COALESCE(is_deleted, 0) = 0',
      ),
      briefs: countRows(db, 'SELECT count(*) AS n FROM briefs'),
      reflections: countRows(db, 'SELECT count(*) AS n FROM reflections'),
      review_items: countRows(db, "SELECT count(*) AS n FROM review_items WHERE status = 'proposed'"),
      long_task_sessions: countRows(db, 'SELECT count(*) AS n FROM long_task_sessions'),
    };
  } finally {
    db.close();
  }
}

/** Pad every cell to one column width. */
function padCell(value, width) {
  return String(value).padEnd(width);
}

/**
 * Print the pass/fail table.
 * @param rows - the collected checks.
 */
function printTable(rows) {
  const header = { check: 'check', observed: 'observed', expected: 'expected', result: 'result' };
  const width = (key) => Math.max(String(header[key]).length, ...rows.map((row) => String(row[key]).length));
  const widths = { check: width('check'), observed: width('observed'), expected: width('expected') };
  const line = [
    padCell(header.check, widths.check),
    padCell(header.observed, widths.observed),
    padCell(header.expected, widths.expected),
    header.result,
  ].join('  ');
  console.log(line);
  console.log('-'.repeat(line.length));
  for (const row of rows) {
    console.log(
      [
        padCell(row.check, widths.check),
        padCell(row.observed, widths.observed),
        padCell(row.expected, widths.expected),
        row.pass ? 'PASS' : 'FAIL',
      ].join('  '),
    );
  }
}

/**
 * Print the before/after counts restart compares.
 * @param countsBefore - the first snapshot.
 * @param countsAfter - the reopened snapshot.
 */
function printCounts(countsBefore, countsAfter) {
  const labelWidth = Math.max(...COUNT_LABELS.map((label) => label.length));
  console.log('counts (before restart -> after reopen):');
  for (const label of COUNT_LABELS) {
    const before = countsBefore?.[label] ?? 'n/a';
    const after = countsAfter?.[label] ?? 'n/a';
    const marker = before === after ? '' : '  <-- CHANGED';
    console.log(`  ${padCell(label, labelWidth)}  ${String(before).padStart(5)} -> ${String(after).padStart(5)}${marker}`);
  }
}

/** The banner: what ran, where, and against which fixture. */
function printBanner(state) {
  const firstFrame = new Date(state.frameTimes[0]).toISOString();
  console.log('Phase 4 cutover rehearsal (fixture dry run)');
  console.log(`node: ${process.version} · modules: ${state.origin}`);
  console.log(`fixture: day=${state.fixtureDay} · week=${state.monday} · first frame=${firstFrame}`);
  console.log('safety: fake capture provider, fake analyser, temp journal + frames + DSH_HOME; no screen, no network, no real profile');
  console.log(`temp: ${state.root}`);
  console.log('');
}

/** The whole rehearsal, keeping the table and cleanup order explicit. */
async function main() {
  let modules;
  try {
    modules = await loadModules();
  } catch (error) {
    if (error?.exitCode === 2) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  const root = await mkdtemp(join(tmpdir(), 'dayflow-cutover-rehearsal-'));
  const checks = new Checks();
  const state = { origin: modules.origin };
  try {
    console.log('running the fixture dry run...');
    try {
      await runRehearsal({ modules, root, checks, state });
    } catch (error) {
      // An unexpected failure is a failed check, not a stack trace: the table
      // still prints so the checklist shows how far the run got.
      checks.record('rehearsal.error', errorMessage(error).slice(0, 120), 'no error');
    }

    printBanner(state);
    printTable(checks.rows);
    console.log('');
    if (state.countsBefore !== undefined || state.countsAfter !== undefined) {
      printCounts(state.countsBefore, state.countsAfter);
      console.log('');
    }

    if (checks.rows.length === 0) {
      console.error('REHEARSAL FAIL: no checks ran');
      return 1;
    }
    if (checks.failed > 0) {
      console.error(`REHEARSAL FAIL: ${checks.failed}/${checks.rows.length} checks failed`);
      return 1;
    }
    console.log(`REHEARSAL PASS: ${checks.passed}/${checks.rows.length} checks passed`);
    return 0;
  } finally {
    let cleaned = true;
    await rm(root, { recursive: true, force: true }).catch(() => {
      cleaned = false;
    });
    console.log(cleaned ? `removed ${root}` : `could not remove ${root}`);
  }
}

const exitCode = await main().catch((error) => {
  console.error(`REHEARSAL FAILED: ${errorMessage(error)}`);
  if (process.env.DAYFLOW_REHEARSAL_DEBUG !== undefined) console.error(error);
  return 1;
});
process.exitCode = exitCode;
