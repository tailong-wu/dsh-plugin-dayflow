/**
 * The review queue tool, driven the way the registry drives it.
 *
 * The tool only ever touches the plugin-owned journal, so every test gets its
 * own temporary journal and no Dayflow fixture database is needed.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { DayflowErrorCode } from '../src/errors.js';
import { DayflowError } from '../src/errors.js';
import type { ReviewItemPayload, ReviewToolPayload } from '../src/review.js';
import { reviewTools } from '../src/tools/review.js';
import { executionContext, makeRuntime, runAndRender, toolMap, toolNamed } from './helpers.js';

type Tools = ReturnType<typeof toolMap>;

const tempRoots: string[] = [];

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/** Build the tool suite against a brand-new owned journal. */
function isolatedTools(): Tools {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dayflow-review-tool-'));
  tempRoots.push(root);
  const runtime = makeRuntime('/nonexistent/dayflow/chunks.sqlite', {
    journalPath: join(root, 'journal.sqlite'),
  });
  return toolMap(reviewTools(runtime));
}

/** Execute the review tool and type its canonical payload. */
async function review(tools: Tools, args: Record<string, unknown>): Promise<ReviewToolPayload> {
  const value = await toolNamed(tools, 'journal_review').execute(args, executionContext());
  return value as ReviewToolPayload;
}

/** Assert one review-tool call fails with the expected stable code. */
async function rejectsReview(tools: Tools, args: Record<string, unknown>, code: DayflowErrorCode): Promise<void> {
  await assert.rejects(
    () => toolNamed(tools, 'journal_review').execute(args, executionContext()),
    (error: unknown) => error instanceof DayflowError && error.code === code,
    `journal_review(${JSON.stringify(args)}) rejects with ${code}`,
  );
}

/** Propose one item and return it, failing loudly when the proposal drops. */
async function propose(
  tools: Tools,
  kind: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<ReviewItemPayload> {
  const payload = await review(tools, { action: 'propose', kind, title, ...extra });
  assert.equal(payload.action, 'propose');
  assert.equal(payload.dropped, false);
  const item = payload.item;
  assert.ok(item !== undefined, `proposal for "${title}" is returned`);
  return item;
}

/** Read a list payload's items. */
function listItems(payload: ReviewToolPayload): ReviewItemPayload[] {
  assert.equal(payload.action, 'list');
  const items = payload.items;
  assert.ok(items !== undefined, 'list payload carries items');
  return items;
}

test('journal_review registers once and lists an empty queue', async () => {
  const tools = isolatedTools();
  assert.deepEqual([...tools.keys()], ['journal_review']);

  const { value, text } = await runAndRender(tools, 'journal_review', { action: 'list' });
  const payload = value as ReviewToolPayload;
  assert.equal(payload.action, 'list');
  assert.deepEqual(payload.items, []);
  assert.equal(typeof payload.hint, 'string');
  assert.ok(payload.hint.length > 0);
  assert.ok(text.length > 0);
});

test('propose, list, and decide keep carry a distillation into the kept list', async () => {
  const tools = isolatedTools();

  const proposed = await review(tools, {
    action: 'propose',
    kind: 'distillation',
    title: 'Serialising the flaky test fixes it',
    body: 'The test fails only when run in parallel.',
    confidence: 0.8,
    source_day: '2026-10-19',
    source_activity_ids: [1, 2],
    evidence: 'Cursor session at 09:13 and the failing CI log.',
  });
  assert.equal(proposed.action, 'propose');
  assert.equal(proposed.dropped, false);
  const item = proposed.item;
  assert.ok(item !== undefined);
  assert.equal(typeof item.id, 'number');
  assert.equal(typeof item.fingerprint, 'string');
  assert.match(item.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(item.kind, 'distillation');
  assert.equal(item.status, 'proposed');
  assert.equal(item.title, 'Serialising the flaky test fixes it');
  assert.equal(item.body, 'The test fails only when run in parallel.');
  assert.equal(item.confidence, 0.8);
  assert.equal(item.source_day, '2026-10-19');
  assert.deepEqual(item.source_activity_ids, [1, 2]);
  assert.equal(item.evidence, 'Cursor session at 09:13 and the failing CI log.');
  assert.equal(item.suppression, 'none');
  assert.equal(typeof item.created_at, 'string');
  assert.ok(item.created_at.length > 0);
  assert.equal(item.decided_at, undefined);

  const listed = listItems(await review(tools, { action: 'list' }));
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, item.id);
  assert.equal(listed[0]?.title, item.title);

  const decided = await review(tools, { action: 'decide', id: item.id, decision: 'keep', confirm: true });
  assert.equal(decided.action, 'decide');
  const decidedItem = decided.item;
  assert.ok(decidedItem !== undefined);
  assert.equal(decidedItem.id, item.id);
  assert.equal(decidedItem.status, 'kept');
  assert.equal(decidedItem.suppression, 'none');
  assert.equal(typeof decidedItem.decided_at, 'string');
  assert.ok((decidedItem.decided_at ?? '').length > 0);

  assert.deepEqual(listItems(await review(tools, { action: 'list' })), []);
  const kept = listItems(await review(tools, { action: 'list', status: 'kept' }));
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.id, item.id);
});

test('propose rejects a missing kind or title without writing an item', async () => {
  const tools = isolatedTools();

  await rejectsReview(tools, { action: 'propose', title: 'No kind here' }, 'invalid_input');
  await rejectsReview(tools, { action: 'propose', kind: 'distillation' }, 'invalid_input');

  assert.deepEqual(listItems(await review(tools, { action: 'list' })), []);
});

test('decide refuses to act without confirm and leaves the item proposed', async () => {
  const tools = isolatedTools();
  const item = await propose(tools, 'distillation', 'Needs the user decision');

  await rejectsReview(tools, { action: 'decide', id: item.id, decision: 'keep' }, 'invalid_input');

  const items = listItems(await review(tools, { action: 'list' }));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, item.id);
  assert.equal(items[0]?.status, 'proposed');
});

test('decide reports an unknown id, a decision that does not fit the kind, and a misplaced forever', async () => {
  const tools = isolatedTools();

  await rejectsReview(tools, { action: 'decide', id: 9999, decision: 'keep', confirm: true }, 'not_found');

  const improvement = await propose(tools, 'improvement', 'Gate the release script on the tag');
  await rejectsReview(tools, { action: 'decide', id: improvement.id, decision: 'keep', confirm: true }, 'invalid_input');
  const afterMismatch = listItems(await review(tools, { action: 'list' }));
  assert.equal(afterMismatch.find((row) => row.id === improvement.id)?.status, 'proposed');

  const distillation = await propose(tools, 'distillation', 'Keep the migration lock');
  await rejectsReview(
    tools,
    { action: 'decide', id: distillation.id, decision: 'keep', forever: true, confirm: true },
    'invalid_input',
  );
});

test('an unknown action is rejected', async () => {
  const tools = isolatedTools();
  await rejectsReview(tools, { action: 'archive' }, 'invalid_input');
});

test('a forever discard hard-suppresses the fingerprint until unsuppress clears it', async () => {
  const tools = isolatedTools();
  const title = 'Hand-copy the changelog every release';

  const first = await propose(tools, 'distillation', title, { confidence: 0.8, source_day: '2026-10-19' });
  const discarded = await review(tools, {
    action: 'decide',
    id: first.id,
    decision: 'discard',
    forever: true,
    confirm: true,
  });
  assert.equal(discarded.item?.status, 'discarded');
  assert.equal(discarded.item?.suppression, 'hard');

  // A hard suppression outranks new evidence: even another day stays dropped.
  const suppressed = await review(tools, {
    action: 'propose',
    kind: 'distillation',
    title,
    confidence: 0.9,
    source_day: '2026-10-20',
  });
  assert.equal(suppressed.action, 'propose');
  assert.equal(suppressed.dropped, true);
  assert.match(suppressed.reason ?? '', /hard-suppressed/);

  await rejectsReview(tools, { action: 'unsuppress', id: first.id }, 'invalid_input');
  const cleared = await review(tools, { action: 'unsuppress', id: first.id, confirm: true });
  assert.equal(cleared.action, 'unsuppress');
  assert.equal(cleared.item?.id, first.id);
  assert.equal(cleared.item?.suppression, 'none');
  assert.equal(cleared.item?.status, 'discarded');

  const again = await propose(tools, 'distillation', title, { confidence: 0.9, source_day: '2026-10-21' });
  assert.equal(again.title, title);
  assert.equal(again.status, 'proposed');
  assert.notEqual(again.id, first.id);
});

test('a soft discard drops the same evidence and accepts a new day', async () => {
  const tools = isolatedTools();
  const title = 'The first hour goes to email';

  const first = await propose(tools, 'distillation', title, {
    confidence: 0.8,
    source_day: '2026-10-19',
    evidence: 'Morning activity trail.',
  });
  const discarded = await review(tools, { action: 'decide', id: first.id, decision: 'discard', confirm: true });
  assert.equal(discarded.item?.status, 'discarded');
  assert.equal(discarded.item?.suppression, 'soft');

  const same = await review(tools, {
    action: 'propose',
    kind: 'distillation',
    title,
    confidence: 0.8,
    source_day: '2026-10-19',
    evidence: 'Morning activity trail.',
  });
  assert.equal(same.dropped, true);
  assert.match(same.reason ?? '', /soft-discarded/);

  const next = await propose(tools, 'distillation', title, {
    confidence: 0.8,
    source_day: '2026-10-20',
    evidence: 'Second morning, same pattern.',
  });
  assert.equal(next.status, 'proposed');
  assert.equal(next.source_day, '2026-10-20');
});

test('propose, list, and decide render their review text', async () => {
  const tools = isolatedTools();
  const title = 'Write the release notes first';

  const proposed = await runAndRender(tools, 'journal_review', {
    action: 'propose',
    kind: 'distillation',
    title,
    confidence: 0.8,
    source_day: '2026-10-19',
  });
  const proposedPayload = proposed.value as ReviewToolPayload;
  const item = proposedPayload.item;
  assert.ok(item !== undefined);
  assert.match(proposed.text, /Proposed/);
  assert.match(proposed.text, new RegExp(`#${item.id}\\b`));
  assert.match(proposed.text, /distillation/);
  assert.match(proposed.text, new RegExp(title));

  const listed = await runAndRender(tools, 'journal_review', { action: 'list' });
  assert.match(listed.text, /Review queue/);
  assert.match(listed.text, new RegExp(`#${item.id}\\b`));
  assert.match(listed.text, /distillation/);
  assert.match(listed.text, new RegExp(title));
  assert.match(listed.text, /0\.80/);
  assert.match(listed.text, /2026-10-19/);

  const dropped = await runAndRender(tools, 'journal_review', {
    action: 'propose',
    kind: 'distillation',
    title,
  });
  assert.match(dropped.text, /Proposal dropped/);
  assert.match(dropped.text, /already-proposed/);

  const decided = await runAndRender(tools, 'journal_review', {
    action: 'decide',
    id: item.id,
    decision: 'keep',
    confirm: true,
    note: 'Worth keeping for the release ritual.',
  });
  assert.match(decided.text, new RegExp(`#${item.id}\\b`));
  assert.match(decided.text, /kept/);
  assert.match(decided.text, new RegExp(title));
  assert.match(decided.text, /Worth keeping for the release ritual\./);
});

test('list filters by kind, by status, and caps the result with limit', async () => {
  const tools = isolatedTools();

  const distillation = await propose(tools, 'distillation', 'Serialise the flaky test', {
    source_day: '2026-10-19',
  });
  const loop = await propose(tools, 'loop', 'Every release week runs the same checks', {
    source_day: '2026-10-19',
    loop_occurrences: 4,
    loop_span_days: 42,
    loop_trigger: 'schedule',
  });
  const improvement = await propose(tools, 'improvement', 'Gate the release script on the tag', {
    source_day: '2026-10-19',
  });

  const loops = listItems(await review(tools, { action: 'list', kind: 'loop' }));
  assert.equal(loops.length, 1);
  assert.equal(loops[0]?.id, loop.id);
  assert.equal(loops[0]?.loop_occurrences, 4);
  assert.equal(loops[0]?.loop_span_days, 42);
  assert.equal(loops[0]?.loop_trigger, 'schedule');

  const all = listItems(await review(tools, { action: 'list' }));
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((row) => row.id), [improvement.id, loop.id, distillation.id]);

  const limited = listItems(await review(tools, { action: 'list', limit: 2 }));
  assert.equal(limited.length, 2);
  assert.deepEqual(limited.map((row) => row.id), [improvement.id, loop.id]);

  await review(tools, { action: 'decide', id: distillation.id, decision: 'keep', confirm: true });
  const proposed = listItems(await review(tools, { action: 'list', status: 'proposed' }));
  assert.deepEqual(proposed.map((row) => row.id), [improvement.id, loop.id]);
  const kept = listItems(await review(tools, { action: 'list', status: 'kept' }));
  assert.deepEqual(kept.map((row) => row.id), [distillation.id]);
});
