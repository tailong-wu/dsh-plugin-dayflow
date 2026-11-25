/**
 * The read-only memory lint, driven through `journal_memory` the way the
 * registry drives it.
 *
 * Lint claims live in the plugin-owned journal, so every test gets its own
 * temporary journal and no Dayflow fixture database is needed. The recent
 * observation days are computed relative to the local day, because the lint
 * horizon is `now - MEMORY_LINT_AGE_DAYS`: fixed literals would drift into the
 * aged list as the calendar moves on. Only the deliberately ancient claim uses
 * a fixed 2020 day, which stays aged forever.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { formatDayKey } from '../src/day.js';
import { DayflowError } from '../src/errors.js';
import type { DayflowErrorCode } from '../src/errors.js';
import type { MemoryClaimPayload } from '../src/memory.js';
import type { MemoryToolPayload } from '../src/tools/memory.js';
import { memoryTools } from '../src/tools/memory.js';
import { executionContext, makeRuntime, runAndRender, toolMap, toolNamed } from './helpers.js';

type Tools = ReturnType<typeof toolMap>;

/** The one field of a presentCall result these tests assert. */
interface PresentedCall {
  card?: string;
  kind?: string;
  title?: string;
}

const tempRoots: string[] = [];

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/** Build a runtime with a brand-new owned journal; Dayflow is deliberately absent. */
function isolatedTools(): Tools {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dayflow-memory-lint-'));
  tempRoots.push(root);
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', {
    journalPath: join(root, 'journal.sqlite'),
  });
  return toolMap(memoryTools(runtime));
}

/** A local day key `days` before today. */
function dayKeyAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDayKey(date);
}

/** Execute journal_memory and type its canonical payload. */
async function callMemory(tools: Tools, args: Record<string, unknown>): Promise<MemoryToolPayload> {
  const value = await toolNamed(tools, 'journal_memory').execute(args, executionContext());
  return value as MemoryToolPayload;
}

/** Assert one journal_memory call fails with the expected stable code. */
async function rejectsMemory(
  tools: Tools,
  args: Record<string, unknown>,
  code: DayflowErrorCode,
): Promise<void> {
  await assert.rejects(
    () => toolNamed(tools, 'journal_memory').execute(args, executionContext()),
    (error: unknown) => error instanceof DayflowError && error.code === code,
    `journal_memory(${JSON.stringify(args)}) rejects with ${code}`,
  );
}

/** Read the required claim off add/supersede, failing loudly when it is missing. */
function requiredClaim(payload: MemoryToolPayload): MemoryClaimPayload {
  const claim = payload.claim;
  assert.ok(claim !== undefined, `journal_memory(${payload.action}) returns a claim`);
  return claim;
}

/** The lint report of a payload, failing loudly when the tool sent none. */
function lintReport(payload: MemoryToolPayload) {
  assert.equal(payload.action, 'lint');
  const report = payload.report;
  assert.ok(report !== undefined, 'lint payload carries a report');
  return report;
}

/** Add one claim through the tool and return the stored row. */
async function addClaim(
  tools: Tools,
  claim: {
    kind: string;
    subject: string;
    body: string;
    observed_on: string;
    confidence?: number;
    source_review_item?: number;
    source_days?: string[];
  },
): Promise<MemoryClaimPayload> {
  return requiredClaim(await callMemory(tools, { action: 'add', ...claim }));
}

type Seed = {
  olderRelease: MemoryClaimPayload;
  newerRelease: MemoryClaimPayload;
  standup: MemoryClaimPayload;
  ancient: MemoryClaimPayload;
  replaced: MemoryClaimPayload;
  replacement: MemoryClaimPayload;
};

/**
 * One of each finding, plus a supersede chain, so the four report sections are
 * non-empty for different reasons:
 * - `Release ritual` has two live preference claims whose bodies disagree, which
 *   is both a contradiction and a superseded-by-newer pair.
 * - `Standup format` is sourced through the review item, so it is not unsourced.
 * - `Ancient habit` is sourced but observed in 2020, so it is aged.
 * - `Planning cadence` was superseded: the old row is history and must not show
 *   up in any finding, even though the two bodies disagree.
 */
async function seedFindings(tools: Tools): Promise<Seed> {
  const olderRelease = await addClaim(tools, {
    kind: 'preference',
    subject: 'Release ritual',
    body: `on ${dayKeyAgo(30)}, the release script did not gate on the tag.`,
    observed_on: dayKeyAgo(30),
  });
  const newerRelease = await addClaim(tools, {
    kind: 'preference',
    subject: 'Release ritual',
    body: `on ${dayKeyAgo(2)}, the release script now gates on the tag.`,
    observed_on: dayKeyAgo(2),
  });
  const standup = await addClaim(tools, {
    kind: 'correction',
    subject: 'Standup format',
    body: `on ${dayKeyAgo(5)}, the standup kept expanding past fifteen minutes.`,
    observed_on: dayKeyAgo(5),
    source_review_item: 7,
  });
  const ancient = await addClaim(tools, {
    kind: 'loop',
    subject: 'Ancient habit',
    body: 'on 2020-01-01, the tests were rewritten by hand every morning.',
    observed_on: '2020-01-01',
    source_days: ['2020-01-01'],
  });
  const replaced = await addClaim(tools, {
    kind: 'distillation',
    subject: 'Planning cadence',
    body: `on ${dayKeyAgo(60)}, planning happened inside the calendar app.`,
    observed_on: dayKeyAgo(60),
    source_days: [dayKeyAgo(60)],
  });
  const replacement = requiredClaim(
    await callMemory(tools, {
      action: 'supersede',
      id: replaced.id,
      body: `on ${dayKeyAgo(1)}, planning moved to the notes app.`,
      observed_on: dayKeyAgo(1),
    }),
  );
  return { olderRelease, newerRelease, standup, ancient, replaced, replacement };
}

test('lint on an empty journal reports nothing to clean up', async () => {
  const tools = isolatedTools();

  const { value, text } = await runAndRender(tools, 'journal_memory', { action: 'lint' });
  const payload = value as MemoryToolPayload;
  const report = lintReport(payload);

  assert.equal(report.scanned, 0);
  assert.deepEqual(report.contradictions, []);
  assert.deepEqual(report.supersededByNewer, []);
  assert.deepEqual(report.unsourced, []);
  assert.deepEqual(report.aged, []);
  assert.equal(typeof report.hint, 'string');
  assert.ok(report.hint.length > 0);
  assert.equal(payload.hint, report.hint);

  assert.match(text, /Memory lint · scanned 0 claims/);
  assert.match(text, /No lint findings\./);
  assert.ok(text.includes(report.hint), 'the renderer keeps the read-only hint');
});

test('lint reports contradictions, superseded pairs, unsourced claims, and aged claims', async () => {
  const tools = isolatedTools();
  const seed = await seedFindings(tools);

  const { value, text } = await runAndRender(tools, 'journal_memory', { action: 'lint' });
  const report = lintReport(value as MemoryToolPayload);

  // Five active claims: the superseded old row is history and is not scanned.
  assert.equal(report.scanned, 5);

  assert.equal(report.contradictions.length, 1);
  const group = report.contradictions[0];
  assert.ok(group !== undefined);
  assert.equal(group.subject, 'Release ritual');
  assert.equal(group.kind, 'preference');
  assert.deepEqual(
    group.claims.map((claim) => claim.id),
    [seed.newerRelease.id, seed.olderRelease.id],
    'contradiction claims are newest observation first',
  );
  assert.equal(group.claims[0]?.body, seed.newerRelease.body);
  assert.equal(group.claims[0]?.observed_on, seed.newerRelease.observed_on);
  assert.equal(group.claims[0]?.confidence, seed.newerRelease.confidence);
  assert.equal(group.claims[1]?.body, seed.olderRelease.body);

  assert.equal(report.supersededByNewer.length, 1);
  const pair = report.supersededByNewer[0];
  assert.ok(pair !== undefined);
  assert.equal(pair.older.id, seed.olderRelease.id);
  assert.equal(pair.newer.id, seed.newerRelease.id);
  assert.equal(pair.older.subject, 'Release ritual');
  assert.equal(pair.newer.subject, 'Release ritual');
  assert.ok(pair.older.observed_on < pair.newer.observed_on);

  // Only the two release claims have no traceable source; the review-sourced
  // claim, the evidence-days claim, and the supersede chain do not.
  assert.deepEqual(
    report.unsourced.map((claim) => claim.id),
    [seed.olderRelease.id, seed.newerRelease.id],
    'unsourced lists exactly the claims with no review item and no evidence days',
  );
  assert.ok(!report.unsourced.some((claim) => claim.id === seed.standup.id));
  assert.ok(!report.unsourced.some((claim) => claim.id === seed.ancient.id));

  assert.deepEqual(
    report.aged.map((claim) => claim.id),
    [seed.ancient.id],
    'only the 2020 claim is past the aging horizon',
  );
  assert.equal(report.aged[0]?.observed_on, '2020-01-01');

  // The superseded old row appears nowhere: it is history, not current belief.
  for (const claim of [
    ...report.unsourced,
    ...report.aged,
    ...report.contradictions.flatMap((row) => row.claims),
    ...report.supersededByNewer.flatMap((row) => [row.older, row.newer]),
  ]) {
    assert.notEqual(claim.id, seed.replaced.id, 'a superseded row is never a finding');
  }
  assert.ok(!report.contradictions.some((row) => row.subject === 'Planning cadence'));

  // The rendered text names every non-empty section and the finding ids.
  assert.match(text, /Memory lint · scanned 5 claims/);
  assert.match(text, /Contradictions \(1\):/);
  assert.match(text, /Superseded by newer \(1\):/);
  assert.match(text, /Unsourced \(2\):/);
  assert.match(text, /Aged \(1\):/);
  assert.match(text, /Release ritual · preference/);
  assert.ok(text.includes(`#${seed.newerRelease.id}`));
  assert.ok(text.includes(`#${seed.olderRelease.id}`));
  assert.ok(text.includes(`#${seed.ancient.id}`));
  assert.ok(text.includes(seed.newerRelease.body), 'the contradiction body is rendered');
  assert.ok(text.includes(seed.olderRelease.body), 'the older contradiction body is rendered');
  assert.match(text, /→/);
  assert.ok(text.includes(report.hint));
});

test('lint changes nothing: the claims are identical before and after the scan', async () => {
  const tools = isolatedTools();
  await seedFindings(tools);

  const beforeHistory = await callMemory(tools, {
    action: 'list',
    include_superseded: true,
    limit: 100,
  });
  const beforeActive = await callMemory(tools, { action: 'list', limit: 100 });

  const report = lintReport(await callMemory(tools, { action: 'lint' }));
  assert.equal(report.scanned, beforeActive.claims?.length);

  const afterHistory = await callMemory(tools, {
    action: 'list',
    include_superseded: true,
    limit: 100,
  });
  const afterActive = await callMemory(tools, { action: 'list', limit: 100 });

  assert.deepEqual(afterHistory.claims, beforeHistory.claims, 'lint keeps even superseded rows untouched');
  assert.deepEqual(afterActive.claims, beforeActive.claims, 'lint keeps the active claims untouched');
});

test('lint accepts subject and limit, and refuses an out-of-range limit', async () => {
  const tools = isolatedTools();
  const releaseA = await addClaim(tools, {
    kind: 'preference',
    subject: 'Release ritual',
    body: `on ${dayKeyAgo(30)}, the tag was not gated.`,
    observed_on: dayKeyAgo(30),
  });
  const releaseB = await addClaim(tools, {
    kind: 'preference',
    subject: 'Release ritual',
    body: `on ${dayKeyAgo(2)}, the tag is gated.`,
    observed_on: dayKeyAgo(2),
  });
  const deployA = await addClaim(tools, {
    kind: 'correction',
    subject: 'Deploy window',
    body: `on ${dayKeyAgo(25)}, deploys happened on Tuesday.`,
    observed_on: dayKeyAgo(25),
  });
  await addClaim(tools, {
    kind: 'correction',
    subject: 'Deploy window',
    body: `on ${dayKeyAgo(3)}, deploys happen on Wednesday.`,
    observed_on: dayKeyAgo(3),
  });
  const ancient = await addClaim(tools, {
    kind: 'loop',
    subject: 'Ancient habit',
    body: 'on 2020-01-01, the tests were rewritten by hand every morning.',
    observed_on: '2020-01-01',
    source_days: ['2020-01-01'],
  });

  // limit caps every finding list, never the scanned count.
  const limited = lintReport(await callMemory(tools, { action: 'lint', limit: 1 }));
  assert.equal(limited.scanned, 5);
  assert.equal(limited.contradictions.length, 1);
  assert.equal(limited.supersededByNewer.length, 1);
  assert.equal(limited.unsourced.length, 1);
  assert.equal(limited.aged.length, 1);

  // subject is an exact filter over the scanned claims and every finding list.
  const release = lintReport(
    await callMemory(tools, { action: 'lint', subject: 'Release ritual' }),
  );
  assert.equal(release.scanned, 2);
  assert.equal(release.contradictions.length, 1);
  assert.equal(release.contradictions[0]?.subject, 'Release ritual');
  assert.equal(release.supersededByNewer.length, 1);
  assert.deepEqual(
    release.unsourced.map((claim) => claim.id),
    [releaseA.id, releaseB.id],
  );
  assert.deepEqual(release.aged, []);

  const ancientOnly = lintReport(
    await callMemory(tools, { action: 'lint', subject: 'Ancient habit' }),
  );
  assert.equal(ancientOnly.scanned, 1);
  assert.deepEqual(ancientOnly.contradictions, []);
  assert.deepEqual(ancientOnly.supersededByNewer, []);
  assert.deepEqual(ancientOnly.unsourced, []);
  assert.deepEqual(
    ancientOnly.aged.map((claim) => claim.id),
    [ancient.id],
  );

  const nothing = await runAndRender(tools, 'journal_memory', {
    action: 'lint',
    subject: 'No such subject',
  });
  assert.equal(lintReport(nothing.value as MemoryToolPayload).scanned, 0);
  assert.match(nothing.text, /No lint findings\./);

  await rejectsMemory(tools, { action: 'lint', limit: 0 }, 'invalid_input');
  await rejectsMemory(tools, { action: 'lint', limit: 101 }, 'invalid_input');
});

test('lint does not disturb the other actions: add, list, search, supersede still work', async () => {
  const tools = isolatedTools();

  const first = await addClaim(tools, {
    kind: 'preference',
    subject: 'Morning planning',
    body: 'The user plans the day before opening email.',
    observed_on: '2026-10-19',
  });
  await callMemory(tools, { action: 'lint' });

  const listed = await callMemory(tools, { action: 'list' });
  assert.deepEqual(
    listed.claims?.map((claim) => claim.id),
    [first.id],
    'add and list keep working after a lint pass',
  );

  const superseded = await callMemory(tools, {
    action: 'supersede',
    id: first.id,
    body: 'The user plans the day after the inbox.',
    observed_on: '2026-10-20',
  });
  const replacement = requiredClaim(superseded);
  const searched = await callMemory(tools, { action: 'search', query: 'planning' });
  assert.deepEqual(
    searched.claims?.map((claim) => claim.id),
    [replacement.id],
  );

  await rejectsMemory(tools, { action: 'bogus' }, 'invalid_input');
});

test('lint is presented as a read, with the subject in the title', () => {
  const tools = isolatedTools();
  const tool = toolNamed(tools, 'journal_memory') as unknown as {
    presentCall?: (args: Record<string, unknown>) => PresentedCall;
  };
  assert.equal(typeof tool.presentCall, 'function');

  const presented = tool.presentCall?.({ action: 'lint', subject: 'Release ritual' });
  assert.equal(presented?.kind, 'read');
  assert.match(presented?.title ?? '', /Memory lint/);
  assert.match(presented?.title ?? '', /Release ritual/);
});
