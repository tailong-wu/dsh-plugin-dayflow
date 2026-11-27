/**
 * The analysis status payload: switches, consent reason, worker state, and the
 * current day's job, call, and token ledger.
 *
 * The payload is what the panel's analysis line shows, so it must be read-only
 * in the strongest sense: a missing journal answers zeros without creating the
 * file, the ledger does not change when it is read, and an unreadable journal
 * answers zeros instead of failing the line. The ledger itself is seeded
 * through the analysis-job store; no model is ever called.
 *
 * These tests use disposable journals under a temporary directory; they never
 * touch the default `$DSH_HOME` journal.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  analysisJobKey,
  completeAnalysisJob,
  createAnalysisJob,
  failAnalysisJob,
  skipAnalysisJob,
  startAnalysisJob,
} from '../src/analyse/jobs.js';
import { buildAnalysisStatus } from '../src/analyse/status.js';
import type { AnalysisModelConfig } from '../src/analyse/models.js';
import type { ResolvedConfig } from '../src/config.js';
import { resolveConfig } from '../src/config.js';
import { dayWindowContaining } from '../src/day.js';
import { openJournal } from '../src/journal.js';
import { makeRuntime } from './helpers.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-analysis-status-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let fileCounter = 0;

/** A fresh journal path inside the disposable directory. */
function journalFile(label: string): string {
  fileCounter += 1;
  return join(directory, `${label}-${fileCounter}.sqlite`);
}

/** The options a test varies on the resolved configuration. */
interface StatusConfigOptions {
  captureEnabled?: boolean;
  analysisEnabled?: boolean;
  consent?: 'none' | 'cloud' | 'local';
  intervalMinutes?: number;
  maxCallsPerDay?: number;
  dailyTokenBudget?: number;
}

/**
 * A resolved configuration whose analysis may run, with the capture switch,
 * consent, interval, and call cap varied per test.
 * @param journalPath - the disposable owned journal.
 * @param options - the settings to vary.
 * @returns the resolved configuration.
 */
function statusConfig(journalPath: string, options: StatusConfigOptions = {}): ResolvedConfig {
  const base = makeRuntime('/nonexistent/dayflow/chunks.sqlite', { journalPath }).config;
  return {
    ...base,
    capture: { ...base.capture, enabled: options.captureEnabled ?? true },
    analysis: {
      ...base.analysis,
      enabled: options.analysisEnabled ?? true,
      consent: options.consent ?? 'cloud',
      provider: 'openai',
      model: 'test-model',
      ...(options.intervalMinutes === undefined ? {} : { intervalMinutes: options.intervalMinutes }),
      ...(options.maxCallsPerDay === undefined ? {} : { maxCallsPerDay: options.maxCallsPerDay }),
      ...(options.dailyTokenBudget === undefined ? {} : { dailyTokenBudget: options.dailyTokenBudget }),
    },
  };
}

/** SHA-256 of one file's bytes, used to prove a read changed nothing. */
function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * A configuration resolved from a real named model list, so the status builder
 * reads the same `models`/`modelId` fields a profile would produce.
 * @param journalPath - the disposable owned journal.
 * @param models - the named entries to resolve.
 * @param selector - the optional `analysis.model` entry id.
 * @returns the resolved configuration.
 */
function namedModelConfig(journalPath: string, models: AnalysisModelConfig[], selector?: string): ResolvedConfig {
  return resolveConfig({
    journalPath,
    capture: { enabled: true },
    analysis: { consent: 'cloud', models, ...(selector === undefined ? {} : { model: selector }) },
  });
}

test('a missing journal reports zero usage without creating the file', async () => {
  const journalPath = journalFile('missing');
  assert.equal(existsSync(journalPath), false);

  const payload = await buildAnalysisStatus({ journalPath, config: statusConfig(journalPath), paused: false });

  assert.deepEqual(payload, {
    enabled: true,
    consent: 'cloud',
    intervalMinutes: 5,
    model: { provider: 'openai', model: 'test-model' },
    worker: 'stopped',
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    callsToday: 0,
    maxCallsPerDay: 120,
    tokensToday: { input: 0, output: 0 },
    dailyTokenBudget: 200_000,
    tokenBudgetExhausted: false,
  });
  assert.equal(existsSync(journalPath), false, 'a status read must not create the journal');
  assert.equal(existsSync(`${journalPath}-journal`), false, 'a status read must not leave a rollback journal');
  assert.equal(existsSync(`${journalPath}-wal`), false, 'a status read must not start a WAL');
});

test('capture off disables analysis and names the capture switch as the first block', async () => {
  const journalPath = journalFile('capture-off');
  const payload = await buildAnalysisStatus({
    journalPath,
    config: statusConfig(journalPath, { captureEnabled: false }),
    paused: false,
  });

  assert.equal(payload.enabled, false, 'analysis needs capture to be on');
  assert.equal(payload.consent, 'cloud', 'the configured consent is still reported');
  assert.equal(payload.reason, 'capture-disabled');
  assert.equal(existsSync(journalPath), false);
});

test('the analysis switch off blocks before the capture switch and consent', async () => {
  const journalPath = journalFile('analysis-off');
  const payload = await buildAnalysisStatus({
    journalPath,
    config: statusConfig(journalPath, { analysisEnabled: false }),
    paused: false,
  });

  assert.equal(payload.enabled, false);
  assert.equal(payload.reason, 'analysis-disabled');
});

test('consent none blocks with its own reason while the switches stay on', async () => {
  const journalPath = journalFile('consent-none');
  const payload = await buildAnalysisStatus({
    journalPath,
    config: statusConfig(journalPath, { consent: 'none' }),
    paused: false,
  });

  assert.equal(payload.enabled, true, 'both switches are on; only consent blocks');
  assert.equal(payload.consent, 'none');
  assert.equal(payload.reason, 'consent:none');
});

test('paused capture blocks analysis of old frames too', async () => {
  const journalPath = journalFile('paused');
  const payload = await buildAnalysisStatus({ journalPath, config: statusConfig(journalPath), paused: true });

  assert.equal(payload.enabled, true);
  assert.equal(payload.reason, 'paused');
});

test('a local consent refuses a provider that is not on the local allowlist', async () => {
  const journalPath = journalFile('local-provider');
  const payload = await buildAnalysisStatus({
    journalPath,
    config: statusConfig(journalPath, { consent: 'local' }),
    paused: false,
  });

  assert.equal(payload.consent, 'local');
  assert.equal(payload.reason, 'consent:provider-not-local');
});

test('the configured worker interval and call cap are passed through', async () => {
  const journalPath = journalFile('interval');
  const payload = await buildAnalysisStatus({
    journalPath,
    config: statusConfig(journalPath, { intervalMinutes: 7, maxCallsPerDay: 42 }),
    paused: false,
  });

  assert.equal(payload.intervalMinutes, 7);
  assert.equal(payload.maxCallsPerDay, 42);
  assert.equal('reason' in payload, false, 'an allowed analysis carries no blocked reason');
});

test('the worker state is reported as running only when the worker is running', async () => {
  const journalPath = journalFile('worker');
  const config = statusConfig(journalPath);

  assert.equal((await buildAnalysisStatus({ journalPath, config, paused: false })).worker, 'stopped');
  assert.equal(
    (await buildAnalysisStatus({ journalPath, config, paused: false, worker: { running: false } })).worker,
    'stopped',
  );
  assert.equal(
    (await buildAnalysisStatus({ journalPath, config, paused: false, worker: { running: true } })).worker,
    'running',
  );
});

test('the ledger supplies the day counts, calls, tokens, and the last job time', async () => {
  const journalPath = journalFile('ledger');
  const fixedNow = new Date('2026-05-06T12:00:00');
  const day = dayWindowContaining(fixedNow).dayKey;
  const base = Math.floor(fixedNow.getTime() / 1_000) - 3_600;
  const db = openJournal(journalPath);
  try {
    const makeJob = (offset: number) =>
      createAnalysisJob(db, {
        jobKey: analysisJobKey(day, base + offset),
        day,
        windowStartTs: base + offset,
        windowEndTs: base + offset + 600,
      });
    // One job per ledger state: created, started, completed, failed, skipped.
    makeJob(0);
    startAnalysisJob(db, makeJob(1_000).id);
    const completed = makeJob(2_000);
    startAnalysisJob(db, completed.id);
    completeAnalysisJob(db, completed.id, { model: 'test-model', inputTokens: 1_234, outputTokens: 234 });
    const failed = makeJob(3_000);
    startAnalysisJob(db, failed.id);
    failAnalysisJob(db, failed.id, 'the model said no');
    skipAnalysisJob(db, makeJob(4_000).id, 'consent:none');
    // A started job from an earlier Dayflow day is not part of today's ledger.
    const yesterday = dayWindowContaining(new Date(fixedNow.getTime() - 24 * 3_600_000)).dayKey;
    const earlier = createAnalysisJob(db, {
      jobKey: analysisJobKey(yesterday, base),
      day: yesterday,
      windowStartTs: base,
      windowEndTs: base + 600,
    });
    startAnalysisJob(db, earlier.id);
    // Pin the state-change time into the past so the newest window end wins the
    // "last job" comparison deterministically.
    db.prepare('UPDATE analysis_jobs SET updated_at = ? WHERE day = ?').run('2026-05-05 00:00:00', day);
  } finally {
    db.close();
  }

  const config = statusConfig(journalPath, { intervalMinutes: 7, maxCallsPerDay: 2 });
  const before = fileHash(journalPath);
  const payload = await buildAnalysisStatus({
    journalPath,
    config,
    paused: false,
    now: () => fixedNow,
  });

  assert.equal(payload.queued, 1);
  assert.equal(payload.running, 1);
  assert.equal(payload.completed, 1);
  assert.equal(payload.failed, 1);
  assert.equal(payload.skipped, 1);
  // A call is a started job: running, completed, and failed count; queued and
  // skipped never started. Yesterday's started job stays out of today's total.
  assert.equal(payload.callsToday, 3);
  assert.equal(payload.maxCallsPerDay, 2, 'the exhausted budget is visible as used > cap');
  assert.deepEqual(payload.tokensToday, { input: 1_234, output: 234 });
  assert.equal(payload.dailyTokenBudget, 200_000);
  assert.equal(payload.tokenBudgetExhausted, false, '1468 recorded tokens are below the 200k cap');
  // The newest window belongs to the skipped job at offset 4_000 (end +600).
  assert.equal(payload.lastJobAt, (base + 4_600) * 1_000);
  assert.equal('reason' in payload, false);
  assert.equal(fileHash(journalPath), before, 'building the status must not rewrite the journal');
});

test('tokenBudgetExhausted turns true only once the day\u2019s tokens reach the budget', async () => {
  const journalPath = journalFile('token-budget');
  const fixedNow = new Date('2026-05-06T12:00:00');
  const day = dayWindowContaining(fixedNow).dayKey;
  const base = Math.floor(fixedNow.getTime() / 1_000) - 3_600;
  const db = openJournal(journalPath);
  try {
    const job = createAnalysisJob(db, {
      jobKey: analysisJobKey(day, base),
      day,
      windowStartTs: base,
      windowEndTs: base + 600,
    });
    startAnalysisJob(db, job.id);
    completeAnalysisJob(db, job.id, { model: 'test-model', inputTokens: 700, outputTokens: 300 });
  } finally {
    db.close();
  }

  const atBudget = await buildAnalysisStatus({
    journalPath,
    config: statusConfig(journalPath, { dailyTokenBudget: 1_000 }),
    paused: false,
    now: () => fixedNow,
  });
  assert.deepEqual(atBudget.tokensToday, { input: 700, output: 300 });
  assert.equal(atBudget.dailyTokenBudget, 1_000);
  assert.equal(atBudget.tokenBudgetExhausted, true, '700 + 300 reaches the 1000-token cap');

  const oneTokenLeft = await buildAnalysisStatus({
    journalPath,
    config: statusConfig(journalPath, { dailyTokenBudget: 1_001 }),
    paused: false,
    now: () => fixedNow,
  });
  assert.equal(oneTokenLeft.dailyTokenBudget, 1_001);
  assert.equal(oneTokenLeft.tokenBudgetExhausted, false, 'the cap is reached, not exceeded');

  // The shipped 200k budget answers false for the same 1000-token ledger.
  const shippedBudget = await buildAnalysisStatus({
    journalPath,
    config: statusConfig(journalPath),
    paused: false,
    now: () => fixedNow,
  });
  assert.equal(shippedBudget.dailyTokenBudget, 200_000);
  assert.equal(shippedBudget.tokenBudgetExhausted, false);
});

test('absent usage counts as zero and cannot trip the token budget', async () => {
  const journalPath = journalFile('token-null');
  const fixedNow = new Date('2026-05-06T12:00:00');
  const day = dayWindowContaining(fixedNow).dayKey;
  const base = Math.floor(fixedNow.getTime() / 1_000) - 3_600;
  const db = openJournal(journalPath);
  try {
    const job = createAnalysisJob(db, {
      jobKey: analysisJobKey(day, base),
      day,
      windowStartTs: base,
      windowEndTs: base + 600,
    });
    startAnalysisJob(db, job.id);
    completeAnalysisJob(db, job.id);
  } finally {
    db.close();
  }

  const payload = await buildAnalysisStatus({
    journalPath,
    config: statusConfig(journalPath, { dailyTokenBudget: 1_000 }),
    paused: false,
    now: () => fixedNow,
  });
  assert.deepEqual(payload.tokensToday, { input: 0, output: 0 });
  assert.equal(payload.dailyTokenBudget, 1_000);
  assert.equal(payload.tokenBudgetExhausted, false, 'a row without usage counts as zero');
});

test('an unreadable journal answers zeros instead of failing the status line', async () => {
  const journalPath = journalFile('corrupt');
  writeFileSync(journalPath, 'this file is not a SQLite journal\n'.repeat(4), 'utf8');
  const before = fileHash(journalPath);

  const payload = await buildAnalysisStatus({ journalPath, config: statusConfig(journalPath), paused: false });

  assert.equal(payload.enabled, true);
  assert.equal(payload.queued, 0);
  assert.equal(payload.callsToday, 0);
  assert.deepEqual(payload.tokensToday, { input: 0, output: 0 });
  assert.equal(payload.tokenBudgetExhausted, false);
  assert.equal('lastJobAt' in payload, false);
  assert.equal(fileHash(journalPath), before, 'a failed read must not rewrite the file');
});

test('a legacy provider/model pair is named as the effective model, with no id or label', async () => {
  const journalPath = journalFile('legacy-model');
  const payload = await buildAnalysisStatus({ journalPath, config: statusConfig(journalPath), paused: false });

  assert.deepEqual(payload.model, { provider: 'openai', model: 'test-model' });
  assert.equal('id' in payload.model!, false, 'the legacy shape has no entry id');
  assert.equal('label' in payload.model!, false, 'the legacy shape has no entry label');
});

test('the active named entry is named with its id and label', async () => {
  const journalPath = journalFile('named-model');
  const models: AnalysisModelConfig[] = [
    { id: 'deepseek-flash', provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek Flash' },
    { id: 'deepseek-pro', provider: 'deepseek', model: 'deepseek-reasoner', label: 'DeepSeek Pro' },
  ];

  // An empty selector takes the first entry.
  const first = await buildAnalysisStatus({ journalPath, config: namedModelConfig(journalPath, models), paused: false });
  assert.deepEqual(first.model, {
    id: 'deepseek-flash',
    provider: 'deepseek',
    model: 'deepseek-chat',
    label: 'DeepSeek Flash',
  });

  // A selector resolves the second entry; the ledger fields are untouched.
  const selected = await buildAnalysisStatus({
    journalPath,
    config: namedModelConfig(journalPath, models, 'DEEPSEEK-PRO'),
    paused: false,
  });
  assert.deepEqual(selected.model, {
    id: 'deepseek-pro',
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    label: 'DeepSeek Pro',
  });
  assert.equal(selected.queued, 0);
  assert.equal(selected.callsToday, 0);
  assert.equal(selected.dailyTokenBudget, 200_000);
});

test('a named entry without a label reports no label key', async () => {
  const journalPath = journalFile('named-model-unlabelled');
  const config = namedModelConfig(journalPath, [{ id: 'local-model', provider: 'ollama', model: 'qwen3:8b' }]);
  const payload = await buildAnalysisStatus({ journalPath, config, paused: false });

  assert.deepEqual(payload.model, { id: 'local-model', provider: 'ollama', model: 'qwen3:8b' });
  assert.equal('label' in payload.model!, false);
});

test('no model summary is reported while no complete provider/model pair is configured', async () => {
  const journalPath = journalFile('no-model');
  const cases: ResolvedConfig[] = [
    resolveConfig({ journalPath }),
    resolveConfig({ journalPath, analysis: { provider: 'deepseek' } }),
    resolveConfig({ journalPath, analysis: { model: 'deepseek-chat' } }),
  ];
  for (const config of cases) {
    const payload = await buildAnalysisStatus({ journalPath, config, paused: false });
    assert.equal('model' in payload, false, `incomplete pair ${JSON.stringify([config.analysis.provider, config.analysis.model])}`);
  }
});

test('a configured pair is still named while the consent gate blocks the call', async () => {
  const journalPath = journalFile('blocked-model');
  const config = resolveConfig({
    journalPath,
    capture: { enabled: true },
    analysis: { consent: 'none', models: [{ id: 'deepseek-flash', provider: 'deepseek', model: 'deepseek-chat' }] },
  });
  const payload = await buildAnalysisStatus({ journalPath, config, paused: false });

  // The summary describes the model a call would use, so it survives a block;
  // the reason is the same consent-gate line as before the list existed.
  assert.equal(payload.reason, 'consent:none');
  assert.deepEqual(payload.model, { id: 'deepseek-flash', provider: 'deepseek', model: 'deepseek-chat' });
});
