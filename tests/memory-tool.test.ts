/**
 * The memory tool and the review→memory hand-off, driven the way the registry
 * drives them.
 *
 * Memory claims live in the plugin-owned journal, so every test gets its own
 * temporary journal and no Dayflow fixture database is needed. Dates are fixed
 * literals: the contract only compares `observed_on` against the local day, so
 * these assertions stay deterministic everywhere except after 2999-01-01.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { DayflowErrorCode } from '../src/errors.js';
import { DayflowError } from '../src/errors.js';
import type { MemoryClaimPayload } from '../src/memory.js';
import type { ReviewToolPayload } from '../src/review.js';
import { memoryTools } from '../src/tools/memory.js';
import { reviewTools } from '../src/tools/review.js';
import { executionContext, makeRuntime, runAndRender, toolMap, toolNamed } from './helpers.js';

type Tools = ReturnType<typeof toolMap>;

/** The journal_memory payload, as the tool-layer contract states it. */
interface MemoryToolPayload {
  action: 'add' | 'search' | 'list' | 'supersede' | 'forget';
  claim?: MemoryClaimPayload;
  claims?: MemoryClaimPayload[];
  query?: string;
  previous_id?: number;
  forgotten?: number;
  hint: string;
}

/** The review payload, extended by the hand-off field a kept distillation carries. */
type ReviewDecidePayload = ReviewToolPayload & { memory_id?: number; memory_subject?: string };

const tempRoots: string[] = [];

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/** Build a runtime with a brand-new owned journal; Dayflow is deliberately absent. */
function isolatedRuntime(): ReturnType<typeof makeRuntime> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dayflow-memory-tool-'));
  tempRoots.push(root);
  return makeRuntime('/nonexistent/dayflow/chunks.sqlite', {
    journalPath: join(root, 'journal.sqlite'),
  });
}

/** The memory suite alone, against its own journal. */
function isolatedTools(): Tools {
  return toolMap(memoryTools(isolatedRuntime()));
}

/** The memory and review suites sharing one journal, for the hand-off tests. */
function linkedTools(): Tools {
  const runtime = isolatedRuntime();
  return toolMap([...memoryTools(runtime), ...reviewTools(runtime)]);
}

/** Execute journal_memory and type its canonical payload. */
async function callMemory(tools: Tools, args: Record<string, unknown>): Promise<MemoryToolPayload> {
  const value = await toolNamed(tools, 'journal_memory').execute(args, executionContext());
  return value as MemoryToolPayload;
}

/** Execute journal_review and type its canonical payload. */
async function callReview(tools: Tools, args: Record<string, unknown>): Promise<ReviewToolPayload> {
  const value = await toolNamed(tools, 'journal_review').execute(args, executionContext());
  return value as ReviewToolPayload;
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

/** Read the required claim off a payload, failing loudly when it is missing. */
function requiredClaim(payload: MemoryToolPayload): MemoryClaimPayload {
  const claim = payload.claim;
  assert.ok(claim !== undefined, `journal_memory(${payload.action}) returns a claim`);
  return claim;
}

/** Read a list payload's claims, which the contract always sends. */
function listedClaims(payload: MemoryToolPayload): MemoryClaimPayload[] {
  assert.equal(payload.action, 'list');
  const claims = payload.claims;
  assert.ok(claims !== undefined, 'list payload carries claims');
  return claims;
}

/** One claim's identity, for order-sensitive comparisons. */
function claimIds(payload: MemoryToolPayload): number[] {
  return (payload.claims ?? []).map((claim) => claim.id);
}

test('journal_memory registers once and starts with an empty memory', async () => {
  const tools = isolatedTools();
  assert.deepEqual([...tools.keys()], ['journal_memory']);

  const { value, text } = await runAndRender(tools, 'journal_memory', { action: 'list' });
  const payload = value as MemoryToolPayload;
  assert.equal(payload.action, 'list');
  assert.deepEqual(payload.claims, []);
  assert.equal(typeof payload.hint, 'string');
  assert.ok(payload.hint.length > 0);
  assert.ok(text.length > 0);
});

test('add, search, and list keep every dated claim: a second add appends instead of overwriting', async () => {
  const tools = isolatedTools();

  const added = await callMemory(tools, {
    action: 'add',
    kind: 'preference',
    subject: 'Morning planning',
    body: 'The user plans the day before opening email.',
    observed_on: '2026-10-19',
    confidence: 0.8,
  });
  assert.equal(added.action, 'add');
  const first = requiredClaim(added);
  assert.equal(typeof first.id, 'number');
  assert.equal(first.kind, 'preference');
  assert.equal(first.subject, 'Morning planning');
  assert.equal(first.body, 'The user plans the day before opening email.');
  assert.equal(first.observed_on, '2026-10-19');
  assert.equal(first.confidence, 0.8);
  assert.equal(typeof first.recorded_at, 'string');
  assert.ok(first.recorded_at.length > 0);
  // A plain add is not a replacement: no supersession fields are set.
  assert.equal(first.superseded_by, undefined);
  assert.equal(first.superseded_on, undefined);
  assert.equal(typeof added.hint, 'string');
  assert.ok(added.hint.length > 0);

  // A word from the subject and a word from the body both hit.
  const bySubject = await callMemory(tools, { action: 'search', query: 'planning' });
  assert.equal(bySubject.action, 'search');
  assert.equal(bySubject.query, 'planning');
  assert.deepEqual(claimIds(bySubject), [first.id]);
  assert.equal(bySubject.claims?.[0]?.body, first.body);

  const byBody = await callMemory(tools, { action: 'search', query: 'email' });
  assert.deepEqual(claimIds(byBody), [first.id]);

  const listed = await callMemory(tools, { action: 'list' });
  assert.deepEqual(claimIds(listed), [first.id]);
  assert.equal(listed.claims?.[0]?.subject, 'Morning planning');

  // The same subject with a newer body is a new row, not an update of the old one.
  const appended = await callMemory(tools, {
    action: 'add',
    kind: 'preference',
    subject: 'Morning planning',
    body: 'The user now plans the afternoon instead.',
    observed_on: '2026-10-20',
    confidence: 0.9,
  });
  const second = requiredClaim(appended);
  assert.notEqual(second.id, first.id);
  assert.equal(second.subject, 'Morning planning');
  assert.equal(second.body, 'The user now plans the afternoon instead.');

  const both = listedClaims(await callMemory(tools, { action: 'list' }));
  assert.equal(both.length, 2);
  // Newest observed_on first, and both versions of the subject are preserved.
  assert.deepEqual(
    both.map((claim) => claim.id),
    [second.id, first.id],
  );
  assert.deepEqual(
    both.map((claim) => claim.subject),
    ['Morning planning', 'Morning planning'],
  );
  assert.deepEqual(
    both.map((claim) => claim.body),
    ['The user now plans the afternoon instead.', 'The user plans the day before opening email.'],
  );
});

test('supersede appends a replacement, hides the old row by default, and refuses a second supersede', async () => {
  const tools = isolatedTools();
  const created = requiredClaim(
    await callMemory(tools, {
      action: 'add',
      kind: 'loop',
      subject: 'Standup cadence',
      body: 'Standalone notes go stale.',
      observed_on: '2026-10-19',
      confidence: 0.7,
    }),
  );

  const superseded = await callMemory(tools, {
    action: 'supersede',
    id: created.id,
    body: 'Notes are reviewed every Monday.',
    observed_on: '2026-10-21',
    confidence: 0.9,
  });
  assert.equal(superseded.action, 'supersede');
  assert.equal(superseded.previous_id, created.id);
  const replacement = requiredClaim(superseded);
  assert.notEqual(replacement.id, created.id);
  // kind and subject are inherited from the claim being replaced.
  assert.equal(replacement.kind, 'loop');
  assert.equal(replacement.subject, 'Standup cadence');
  assert.equal(replacement.body, 'Notes are reviewed every Monday.');
  assert.equal(replacement.observed_on, '2026-10-21');
  assert.equal(replacement.confidence, 0.9);
  assert.equal(replacement.superseded_by, undefined);

  // Default reads expose only the live claim, even when the old text also matches.
  const live = listedClaims(await callMemory(tools, { action: 'list' }));
  assert.deepEqual(
    live.map((claim) => claim.id),
    [replacement.id],
  );
  const liveHits = await callMemory(tools, { action: 'search', query: 'notes' });
  assert.deepEqual(claimIds(liveHits), [replacement.id]);
  // A word that only exists in the superseded body no longer hits.
  const staleHits = await callMemory(tools, { action: 'search', query: 'stale' });
  assert.deepEqual(staleHits.claims, []);

  // include_superseded reads the appended history, with the old row traceable.
  const history = listedClaims(await callMemory(tools, { action: 'list', include_superseded: true }));
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((claim) => claim.id),
    [replacement.id, created.id],
  );
  const oldRow = history.find((claim) => claim.id === created.id);
  assert.ok(oldRow !== undefined, 'history keeps the superseded claim');
  assert.equal(oldRow.body, 'Standalone notes go stale.');
  assert.equal(oldRow.superseded_by, replacement.id);
  assert.equal(oldRow.superseded_on, '2026-10-21');

  const historyHits = await callMemory(tools, {
    action: 'search',
    query: 'notes',
    include_superseded: true,
  });
  assert.equal(historyHits.claims?.length, 2);
  assert.ok(
    historyHits.claims?.some(
      (claim) => claim.id === created.id && claim.superseded_by === replacement.id,
    ),
  );

  // A row that has already been replaced cannot be replaced again.
  await rejectsMemory(
    tools,
    { action: 'supersede', id: created.id, body: 'A third version.', observed_on: '2026-10-22' },
    'invalid_input',
  );
  // An id that never existed is not_found, not invalid_input.
  await rejectsMemory(
    tools,
    { action: 'supersede', id: 9999, body: 'Nothing to replace.', observed_on: '2026-10-22' },
    'not_found',
  );
});

test('forget needs confirm, removes the claim, and refuses to delete a claim other rows point at', async () => {
  const tools = isolatedTools();
  const doomed = requiredClaim(
    await callMemory(tools, {
      action: 'add',
      kind: 'preference',
      subject: 'Shipping ritual',
      body: 'Tags the release before lunch.',
      observed_on: '2026-10-19',
    }),
  );

  // A delete belongs to the user: without confirm nothing changes.
  await rejectsMemory(tools, { action: 'forget', id: doomed.id }, 'invalid_input');
  assert.deepEqual(
    listedClaims(await callMemory(tools, { action: 'list' })).map((claim) => claim.id),
    [doomed.id],
  );

  const forgotten = await callMemory(tools, { action: 'forget', id: doomed.id, confirm: true });
  assert.equal(forgotten.action, 'forget');
  assert.equal(forgotten.forgotten, doomed.id);
  assert.deepEqual(listedClaims(await callMemory(tools, { action: 'list' })), []);
  const goneHits = await callMemory(tools, { action: 'search', query: 'ritual' });
  assert.deepEqual(goneHits.claims, []);

  /*
   * The reference chain runs old → new: supersede writes `superseded_by = <new id>`
   * on the OLD row. So the row other rows point at is the NEW claim, and that is
   * the one forget must refuse while the history exists (store semantics: any
   * row whose superseded_by equals the id blocks the delete).
   */
  const old = requiredClaim(
    await callMemory(tools, {
      action: 'add',
      kind: 'correction',
      subject: 'Test cadence',
      body: 'The suite runs on Fridays.',
      observed_on: '2026-10-19',
    }),
  );
  const replacement = requiredClaim(
    await callMemory(tools, {
      action: 'supersede',
      id: old.id,
      body: 'The suite runs on every merge.',
      observed_on: '2026-10-20',
    }),
  );
  await rejectsMemory(tools, { action: 'forget', id: replacement.id, confirm: true }, 'invalid_input');

  const keptHistory = listedClaims(
    await callMemory(tools, { action: 'list', include_superseded: true }),
  );
  assert.equal(keptHistory.length, 2);
  assert.ok(
    keptHistory.some((claim) => claim.id === old.id && claim.superseded_by === replacement.id),
  );
  assert.ok(keptHistory.some((claim) => claim.id === replacement.id));

  // Deleting the superseded row is allowed: nothing points at it. Once it is
  // gone its replacement is no longer referenced, so it can be forgotten too.
  const droppedOld = await callMemory(tools, { action: 'forget', id: old.id, confirm: true });
  assert.equal(droppedOld.forgotten, old.id);
  const droppedReplacement = await callMemory(tools, {
    action: 'forget',
    id: replacement.id,
    confirm: true,
  });
  assert.equal(droppedReplacement.forgotten, replacement.id);
  assert.deepEqual(listedClaims(await callMemory(tools, { action: 'list' })), []);

  // forget needs an id; an unknown id is not_found.
  await rejectsMemory(tools, { action: 'forget', confirm: true }, 'invalid_input');
  await rejectsMemory(tools, { action: 'forget', id: 9999, confirm: true }, 'not_found');
});

test('add, search, supersede, and forget reject missing or malformed arguments without writing', async () => {
  const tools = isolatedTools();

  // add requires kind, subject, body, and observed_on.
  await rejectsMemory(tools, { action: 'add', body: 'Body.', observed_on: '2026-10-19' }, 'invalid_input');
  await rejectsMemory(tools, { action: 'add', subject: 'Subject', observed_on: '2026-10-19' }, 'invalid_input');
  await rejectsMemory(tools, { action: 'add', subject: 'Subject', body: 'Body.' }, 'invalid_input');
  await rejectsMemory(
    tools,
    { action: 'add', subject: 'Subject', body: 'Body.', observed_on: '2026-10-19' },
    'invalid_input',
  );
  await rejectsMemory(
    tools,
    { action: 'add', kind: 'preference', subject: '   ', body: 'Body.', observed_on: '2026-10-19' },
    'invalid_input',
  );

  // Dates must be real and not in the future.
  await rejectsMemory(
    tools,
    { action: 'add', kind: 'preference', subject: 'Subject', body: 'Body.', observed_on: '2999-01-01' },
    'invalid_input',
  );
  await rejectsMemory(
    tools,
    { action: 'add', kind: 'preference', subject: 'Subject', body: 'Body.', observed_on: '2026-02-30' },
    'invalid_input',
  );

  // search requires a non-blank query.
  await rejectsMemory(tools, { action: 'search' }, 'invalid_input');
  await rejectsMemory(tools, { action: 'search', query: '   ' }, 'invalid_input');

  // supersede requires the target id, a new body, and a new observed_on.
  await rejectsMemory(tools, { action: 'supersede', id: 1, body: 'Body.' }, 'invalid_input');
  await rejectsMemory(tools, { action: 'supersede', id: 1, observed_on: '2026-10-19' }, 'invalid_input');

  // An unknown action is refused rather than guessed.
  await rejectsMemory(tools, { action: 'archive' }, 'invalid_input');

  // None of the refused calls wrote a row.
  assert.deepEqual(listedClaims(await callMemory(tools, { action: 'list' })), []);
});

test('keeping a review distillation writes a dated memory claim through the hand-off', async () => {
  const tools = linkedTools();
  const title = 'Serialising the flaky test fixes it';
  const body = 'The test fails only when the suite runs in parallel.';

  const proposed = await callReview(tools, {
    action: 'propose',
    kind: 'distillation',
    title,
    body,
    confidence: 0.8,
    source_day: '2026-10-19',
  });
  const item = proposed.item;
  assert.ok(item !== undefined, 'propose returns the review item');
  assert.equal(item.status, 'proposed');

  const decided = (await callReview(tools, {
    action: 'decide',
    id: item.id,
    decision: 'keep',
    confirm: true,
  })) as ReviewDecidePayload;
  assert.equal(decided.action, 'decide');
  assert.equal(decided.item?.status, 'kept');
  const memoryId = decided.memory_id;
  assert.ok(memoryId !== undefined, 'a kept distillation reports the memory claim it created');
  assert.equal(decided.memory_subject, title);

  // The memory tool now sees the claim the review hand-off wrote, with the
  // review item as its source and the source day as its observed_on.
  const listed = listedClaims(await callMemory(tools, { action: 'list' }));
  const claim = listed.find((row) => row.id === memoryId);
  assert.ok(claim !== undefined, 'hand-off claim is listed by journal_memory');
  assert.equal(claim.kind, 'distillation');
  assert.equal(claim.subject, title);
  assert.equal(claim.body, body);
  assert.equal(claim.observed_on, '2026-10-19');
  assert.equal(claim.confidence, 0.8);
  assert.equal(claim.source_review_item, item.id);
  assert.deepEqual(claim.source_days, ['2026-10-19']);
  assert.equal(claim.superseded_by, undefined);

  const hits = await callMemory(tools, { action: 'search', query: 'serialising' });
  assert.deepEqual(claimIds(hits), [memoryId]);

  // The item itself stays kept and readable while its claim is live.
  const kept = await callReview(tools, { action: 'list', status: 'kept' });
  assert.deepEqual(
    kept.items?.map((row) => row.id),
    [item.id],
  );
});

test('add, search, list, supersede, forget, and the review hand-off render their facts', async () => {
  const tools = linkedTools();

  const added = await runAndRender(tools, 'journal_memory', {
    action: 'add',
    kind: 'preference',
    subject: 'Morning planning',
    body: 'The user plans the day before opening email.',
    observed_on: '2026-10-19',
    confidence: 0.8,
  });
  const first = (added.value as MemoryToolPayload).claim;
  assert.ok(first !== undefined);
  assert.match(added.text, /Remembered/);
  assert.match(added.text, new RegExp(`#${first.id}\\b`));
  assert.match(added.text, /preference/);
  assert.match(added.text, /Morning planning/);
  assert.match(added.text, /2026-10-19/);
  assert.match(added.text, /0\.80/);

  const searched = await runAndRender(tools, 'journal_memory', { action: 'search', query: 'planning' });
  assert.match(searched.text, /Memory/);
  assert.match(searched.text, /planning/);
  assert.match(searched.text, new RegExp(`#${first.id}\\b`));
  assert.match(searched.text, /Morning planning/);

  const listed = await runAndRender(tools, 'journal_memory', { action: 'list' });
  assert.match(listed.text, /Memory/);
  assert.match(listed.text, new RegExp(`#${first.id}\\b`));
  assert.match(listed.text, /Morning planning/);

  const superseded = await runAndRender(tools, 'journal_memory', {
    action: 'supersede',
    id: first.id,
    body: 'The user plans the day after the inbox.',
    observed_on: '2026-10-20',
  });
  const replacement = (superseded.value as MemoryToolPayload).claim;
  assert.ok(replacement !== undefined);
  assert.match(superseded.text, /Superseded/);
  assert.match(superseded.text, new RegExp(`#${first.id}\\b`));
  assert.match(superseded.text, new RegExp(`#${replacement.id}\\b`));
  assert.match(superseded.text, /Morning planning/);

  // A separate live claim is used for the forget render: the replacement above
  // is still referenced by the superseded row and may not be forgotten yet.
  const disposable = requiredClaim(
    await callMemory(tools, {
      action: 'add',
      kind: 'correction',
      subject: 'Deploy window',
      body: 'Deploys happen on Tuesday.',
      observed_on: '2026-10-19',
    }),
  );
  const forgotten = await runAndRender(tools, 'journal_memory', {
    action: 'forget',
    id: disposable.id,
    confirm: true,
  });
  assert.match(forgotten.text, /Forgot claim/);
  assert.match(forgotten.text, new RegExp(`#${disposable.id}\\b`));

  const title = 'Serialise the flaky test';
  const proposed = await callReview(tools, {
    action: 'propose',
    kind: 'distillation',
    title,
    body: 'It fails only when the suite runs in parallel.',
    confidence: 0.8,
    source_day: '2026-10-19',
  });
  const item = proposed.item;
  assert.ok(item !== undefined);
  const decided = await runAndRender(tools, 'journal_review', {
    action: 'decide',
    id: item.id,
    decision: 'keep',
    confirm: true,
  });
  const decidedPayload = decided.value as ReviewDecidePayload;
  const memoryId = decidedPayload.memory_id;
  assert.ok(memoryId !== undefined);
  assert.match(decided.text, new RegExp(`#${item.id}\\b`));
  assert.match(decided.text, /kept/);
  assert.match(decided.text, new RegExp(title));
  assert.match(decided.text, new RegExp(`remembered as claim #${memoryId}\\b`));
});
