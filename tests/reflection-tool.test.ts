/**
 * The reflection tool, driven the way the registry drives it.
 *
 * Reflections live in the plugin-owned journal, so every test gets its own
 * temporary journal and no Dayflow fixture database is needed. Dates are fixed
 * literals and 2026-10-19 is a Monday, which keeps the week-normalization
 * assertions deterministic everywhere.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { DayflowErrorCode } from '../src/errors.js';
import { DayflowError } from '../src/errors.js';
import type { ReflectionPayload } from '../src/reflections.js';
import { reflectionTools } from '../src/tools/reflection.js';
import { executionContext, makeRuntime, runAndRender, toolMap, toolNamed } from './helpers.js';

type Tools = ReturnType<typeof toolMap>;

/** The journal_reflection payload, as the tool-layer contract states it. */
interface ReflectionToolPayload {
  action: 'save' | 'get' | 'list' | 'delete';
  /** save and get (when found) carry the row. */
  reflection?: ReflectionPayload;
  /** get: whether a reflection exists for the normalized period. */
  found?: boolean;
  /** list results, newest period first. */
  reflections?: ReflectionPayload[];
  /** delete: the row was removed. */
  deleted?: true;
  /** delete: the normalized period key the row lived under. */
  period_key?: string;
  hint: string;
}

const tempRoots: string[] = [];

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/** Build a runtime with a brand-new owned journal; Dayflow is deliberately absent. */
function isolatedRuntime(): ReturnType<typeof makeRuntime> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dayflow-reflection-tool-'));
  tempRoots.push(root);
  return makeRuntime('/nonexistent/dayflow/chunks.sqlite', {
    journalPath: join(root, 'journal.sqlite'),
  });
}

/** The reflection suite alone, against its own journal. */
function isolatedTools(): Tools {
  return toolMap(reflectionTools(isolatedRuntime()));
}

/** Execute journal_reflection and type its canonical payload. */
async function callReflection(
  tools: Tools,
  args: Record<string, unknown>,
): Promise<ReflectionToolPayload> {
  const value = await toolNamed(tools, 'journal_reflection').execute(args, executionContext());
  return value as ReflectionToolPayload;
}

/** Assert one journal_reflection call fails with the expected stable code. */
async function rejectsReflection(
  tools: Tools,
  args: Record<string, unknown>,
  code: DayflowErrorCode,
): Promise<void> {
  await assert.rejects(
    () => toolNamed(tools, 'journal_reflection').execute(args, executionContext()),
    (error: unknown) => error instanceof DayflowError && error.code === code,
    `journal_reflection(${JSON.stringify(args)}) rejects with ${code}`,
  );
}

/** Read the required reflection off a payload, failing loudly when it is missing. */
function requiredReflection(payload: ReflectionToolPayload): ReflectionPayload {
  const reflection = payload.reflection;
  assert.ok(reflection !== undefined, `journal_reflection(${payload.action}) returns a reflection`);
  return reflection;
}

/** Read a list payload's reflections, which the contract always sends. */
function listedReflections(payload: ReflectionToolPayload): ReflectionPayload[] {
  assert.equal(payload.action, 'list');
  const reflections = payload.reflections;
  assert.ok(reflections !== undefined, 'list payload carries reflections');
  return reflections;
}

/** One reflection's identity, for order-sensitive comparisons. */
function reflectionIds(payload: ReflectionToolPayload): number[] {
  return (payload.reflections ?? []).map((reflection) => reflection.id);
}

test('journal_reflection registers once and saves, reads, then edits one day reflection', async () => {
  const tools = isolatedTools();
  assert.deepEqual([...tools.keys()], ['journal_reflection']);

  const body = 'Shipped the reflection store and wrote the migration.';
  const saved = await callReflection(tools, {
    action: 'save',
    kind: 'day',
    period: '2026-10-19',
    body,
    highlights: ['Schema v6 migrated cleanly', 'Tool layer still missing'],
    source_days: ['2026-10-19', '2026-10-20'],
    source_activity_ids: [1, 7],
  });
  assert.equal(saved.action, 'save');
  const first = requiredReflection(saved);
  assert.equal(typeof first.id, 'number');
  assert.equal(first.kind, 'day');
  assert.equal(first.period_key, '2026-10-19');
  assert.equal(first.body, body);
  assert.deepEqual(first.highlights, ['Schema v6 migrated cleanly', 'Tool layer still missing']);
  assert.deepEqual(first.source_days, ['2026-10-19', '2026-10-20']);
  assert.deepEqual(first.source_activity_ids, [1, 7]);
  assert.equal(typeof first.created_at, 'string');
  assert.ok(first.created_at.length > 0);
  assert.equal(typeof first.updated_at, 'string');
  assert.ok(saved.hint.length > 0);

  // get returns the row field for field.
  const got = await callReflection(tools, { action: 'get', kind: 'day', period: '2026-10-19' });
  assert.equal(got.action, 'get');
  assert.equal(got.found, true);
  const read = requiredReflection(got);
  assert.equal(read.id, first.id);
  assert.equal(read.kind, first.kind);
  assert.equal(read.period_key, first.period_key);
  assert.equal(read.body, first.body);
  assert.deepEqual(read.highlights, first.highlights);
  assert.deepEqual(read.source_days, first.source_days);
  assert.deepEqual(read.source_activity_ids, first.source_activity_ids);
  assert.equal(read.created_at, first.created_at);
  assert.ok(got.hint.length > 0);

  // Saving the same period again is an edit: the id and created_at stay, the
  // body and the optional fields are replaced, and no second row appears.
  const updatedBody = 'Rewrote it: the migration held, the tool landed late.';
  const savedAgain = await callReflection(tools, {
    action: 'save',
    kind: 'day',
    period: '2026-10-19',
    body: updatedBody,
    highlights: ['Migration held'],
    source_days: ['2026-10-19'],
    source_activity_ids: [2],
  });
  const second = requiredReflection(savedAgain);
  assert.equal(second.id, first.id);
  assert.equal(second.created_at, first.created_at);
  assert.equal(second.body, updatedBody);
  assert.deepEqual(second.highlights, ['Migration held']);
  assert.deepEqual(second.source_days, ['2026-10-19']);
  assert.deepEqual(second.source_activity_ids, [2]);

  const listed = listedReflections(await callReflection(tools, { action: 'list' }));
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, first.id);
  assert.equal(listed[0]?.body, updatedBody);
});

test('week reflections normalize any day of the week onto its Monday', async () => {
  const tools = isolatedTools();

  // 2026-10-21 is a Wednesday; its week starts on Monday 2026-10-19.
  const saved = await callReflection(tools, {
    action: 'save',
    kind: 'week',
    period: '2026-10-21',
    body: 'Week 43: the reflection store landed midweek.',
    highlights: ['Store landed', 'Tool not wired yet'],
    source_days: ['2026-10-19', '2026-10-20', '2026-10-23'],
    source_activity_ids: [3, 4],
  });
  const week = requiredReflection(saved);
  assert.equal(week.kind, 'week');
  assert.equal(week.period_key, '2026-10-19');
  assert.deepEqual(week.highlights, ['Store landed', 'Tool not wired yet']);

  // Another day of the same week reads the row saved under its Monday.
  const got = await callReflection(tools, { action: 'get', kind: 'week', period: '2026-10-23' });
  assert.equal(got.action, 'get');
  assert.equal(got.found, true);
  assert.equal(got.reflection?.id, week.id);
  assert.equal(got.reflection?.period_key, '2026-10-19');
  assert.equal(got.reflection?.body, week.body);

  const listed = listedReflections(await callReflection(tools, { action: 'list', kind: 'week' }));
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.period_key, '2026-10-19');

  // Re-saving via the Sunday of the same week updates instead of appending.
  const resaved = await callReflection(tools, {
    action: 'save',
    kind: 'week',
    period: '2026-10-25',
    body: 'Week 43 revised: both the store and the tool landed.',
  });
  const again = requiredReflection(resaved);
  assert.equal(again.id, week.id);
  assert.equal(again.period_key, '2026-10-19');
  const listedAfter = listedReflections(await callReflection(tools, { action: 'list', kind: 'week' }));
  assert.equal(listedAfter.length, 1);
  assert.equal(listedAfter[0]?.body, 'Week 43 revised: both the store and the tool landed.');

  // delete reports the normalized key too, whichever day of the week is passed.
  const deleted = await callReflection(tools, {
    action: 'delete',
    kind: 'week',
    period: '2026-10-24',
    confirm: true,
  });
  assert.equal(deleted.action, 'delete');
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.period_key, '2026-10-19');
});

test('delete needs confirm, removes the row, and reports not_found afterwards', async () => {
  const tools = isolatedTools();

  const created = requiredReflection(
    await callReflection(tools, {
      action: 'save',
      kind: 'day',
      period: '2026-10-20',
      body: 'A day worth deleting.',
    }),
  );

  // A delete belongs to the user: without confirm nothing changes.
  await rejectsReflection(tools, { action: 'delete', kind: 'day', period: '2026-10-20' }, 'invalid_input');
  const still = await callReflection(tools, { action: 'get', kind: 'day', period: '2026-10-20' });
  assert.equal(still.found, true);
  assert.equal(still.reflection?.id, created.id);
  assert.deepEqual(reflectionIds(await callReflection(tools, { action: 'list' })), [created.id]);

  const deleted = await callReflection(tools, {
    action: 'delete',
    kind: 'day',
    period: '2026-10-20',
    confirm: true,
  });
  assert.equal(deleted.action, 'delete');
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.period_key, '2026-10-20');
  assert.ok(deleted.hint.length > 0);

  const gone = await callReflection(tools, { action: 'get', kind: 'day', period: '2026-10-20' });
  assert.equal(gone.action, 'get');
  assert.equal(gone.found, false);
  assert.equal(gone.reflection, undefined);
  assert.ok(gone.hint.length > 0);
  assert.deepEqual(listedReflections(await callReflection(tools, { action: 'list' })), []);
  assert.deepEqual(
    listedReflections(await callReflection(tools, { action: 'list', kind: 'day' })),
    [],
  );

  // Deleting the same period twice is not_found, not a silent success.
  await rejectsReflection(
    tools,
    { action: 'delete', kind: 'day', period: '2026-10-20', confirm: true },
    'not_found',
  );
});

test('save, get, and delete refuse missing or malformed arguments without writing', async () => {
  const tools = isolatedTools();

  // save requires kind, period, and a non-blank body.
  await rejectsReflection(tools, { action: 'save', period: '2026-10-19', body: 'Body.' }, 'invalid_input');
  await rejectsReflection(tools, { action: 'save', kind: 'day', body: 'Body.' }, 'invalid_input');
  await rejectsReflection(tools, { action: 'save', kind: 'day', period: '2026-10-19' }, 'invalid_input');
  await rejectsReflection(
    tools,
    { action: 'save', kind: 'day', period: '2026-10-19', body: '   ' },
    'invalid_input',
  );

  // Periods must be real dates, and only day and week are reflection kinds.
  await rejectsReflection(
    tools,
    { action: 'save', kind: 'day', period: '2026-02-30', body: 'Body.' },
    'invalid_input',
  );
  await rejectsReflection(
    tools,
    { action: 'save', kind: 'week', period: 'not-a-date', body: 'Body.' },
    'invalid_input',
  );
  await rejectsReflection(
    tools,
    { action: 'save', kind: 'month', period: '2026-10-19', body: 'Body.' },
    'invalid_input',
  );
  await rejectsReflection(tools, { action: 'get', kind: 'day', period: '2026-02-30' }, 'invalid_input');
  await rejectsReflection(tools, { action: 'delete', period: '2026-10-19', confirm: true }, 'invalid_input');
  await rejectsReflection(tools, { action: 'delete', kind: 'day', confirm: true }, 'invalid_input');

  // Reading a valid period that was never saved is an answer, not an error.
  const missing = await callReflection(tools, { action: 'get', kind: 'day', period: '2026-01-02' });
  assert.equal(missing.action, 'get');
  assert.equal(missing.found, false);
  assert.equal(missing.reflection, undefined);
  assert.ok(missing.hint.length > 0);

  // An unknown action is refused rather than guessed.
  await rejectsReflection(tools, { action: 'archive' }, 'invalid_input');

  // list accepts at most 100 rows and at least 1.
  await rejectsReflection(tools, { action: 'list', limit: 0 }, 'invalid_input');
  await rejectsReflection(tools, { action: 'list', limit: 101 }, 'invalid_input');

  // None of the refused calls wrote a row.
  assert.deepEqual(listedReflections(await callReflection(tools, { action: 'list' })), []);
});

test('save, get, list, and delete render their facts, falling back to the hint when empty', async () => {
  const tools = isolatedTools();
  const body = 'Shipped the reflection store and wrote the tool test.';

  const saved = await runAndRender(tools, 'journal_reflection', {
    action: 'save',
    kind: 'day',
    period: '2026-10-19',
    body,
    highlights: ['Store landed', 'Tool registered'],
    source_days: ['2026-10-19'],
    source_activity_ids: [1, 2],
  });
  const savedPayload = saved.value as ReflectionToolPayload;
  const created = savedPayload.reflection;
  assert.ok(created !== undefined);
  assert.ok(savedPayload.hint.length > 0);
  assert.ok(saved.text.length > 0);
  assert.match(saved.text, /Reflection saved/);
  assert.ok(saved.text.includes('day'));
  assert.ok(saved.text.includes('2026-10-19'));
  assert.ok(saved.text.includes('Shipped the reflection store'));
  assert.ok(saved.text.includes('Store landed'));

  const got = await runAndRender(tools, 'journal_reflection', {
    action: 'get',
    kind: 'day',
    period: '2026-10-19',
  });
  assert.ok((got.value as ReflectionToolPayload).hint.length > 0);
  assert.ok(got.text.length > 0);
  assert.match(got.text, /Reflection/);
  assert.ok(got.text.includes('day'));
  assert.ok(got.text.includes('2026-10-19'));
  assert.ok(got.text.includes('Shipped the reflection store'));

  const listed = await runAndRender(tools, 'journal_reflection', { action: 'list', kind: 'day' });
  assert.ok((listed.value as ReflectionToolPayload).hint.length > 0);
  assert.ok(listed.text.length > 0);
  assert.match(listed.text, /Reflections/);
  assert.ok(listed.text.includes('2026-10-19'));
  assert.ok(listed.text.includes('Shipped the reflection store'));

  const deleted = await runAndRender(tools, 'journal_reflection', {
    action: 'delete',
    kind: 'day',
    period: '2026-10-19',
    confirm: true,
  });
  assert.ok((deleted.value as ReflectionToolPayload).hint.length > 0);
  assert.ok(deleted.text.length > 0);
  assert.match(deleted.text, /Reflection deleted/);
  assert.ok(deleted.text.includes('day'));
  assert.ok(deleted.text.includes('2026-10-19'));

  // An empty list and a missing read render the hint instead of an empty string.
  const empty = await runAndRender(tools, 'journal_reflection', { action: 'list' });
  const emptyPayload = empty.value as ReflectionToolPayload;
  assert.ok(empty.text.length > 0);
  assert.ok(empty.text.includes(emptyPayload.hint));

  const missing = await runAndRender(tools, 'journal_reflection', {
    action: 'get',
    kind: 'week',
    period: '2026-01-02',
  });
  const missingPayload = missing.value as ReflectionToolPayload;
  assert.equal(missingPayload.found, false);
  assert.ok(missing.text.length > 0);
  assert.ok(missing.text.includes(missingPayload.hint));
});

test('day and week reflections for the same period are independent rows', async () => {
  const tools = isolatedTools();
  const dayBody = 'The day itself: shipped the schema bump.';
  const weekBody = 'The week: landed the reflection store and its tool.';

  const daySaved = requiredReflection(
    await callReflection(tools, {
      action: 'save',
      kind: 'day',
      period: '2026-10-19',
      body: dayBody,
    }),
  );
  const weekSaved = requiredReflection(
    await callReflection(tools, {
      action: 'save',
      kind: 'week',
      period: '2026-10-19',
      body: weekBody,
    }),
  );
  // Both normalize onto the same period key, yet the kind keeps them apart.
  assert.equal(daySaved.period_key, '2026-10-19');
  assert.equal(weekSaved.period_key, '2026-10-19');
  assert.notEqual(daySaved.id, weekSaved.id);

  // Newest row first within one period: the week row was saved last.
  assert.deepEqual(reflectionIds(await callReflection(tools, { action: 'list' })), [
    weekSaved.id,
    daySaved.id,
  ]);

  const days = listedReflections(await callReflection(tools, { action: 'list', kind: 'day' }));
  assert.deepEqual(
    days.map((reflection) => reflection.id),
    [daySaved.id],
  );
  assert.equal(days[0]?.body, dayBody);

  const weeks = listedReflections(await callReflection(tools, { action: 'list', kind: 'week' }));
  assert.deepEqual(
    weeks.map((reflection) => reflection.id),
    [weekSaved.id],
  );
  assert.equal(weeks[0]?.body, weekBody);

  // Editing the day row leaves the week row untouched.
  const edited = requiredReflection(
    await callReflection(tools, {
      action: 'save',
      kind: 'day',
      period: '2026-10-19',
      body: 'The day revised.',
    }),
  );
  assert.equal(edited.id, daySaved.id);
  const after = listedReflections(await callReflection(tools, { action: 'list', kind: 'week' }));
  assert.equal(after.length, 1);
  assert.equal(after[0]?.id, weekSaved.id);
  assert.equal(after[0]?.body, weekBody);
});
