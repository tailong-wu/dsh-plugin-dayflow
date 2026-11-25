/**
 * The long-task tool and the review→task hand-off, driven the way the registry
 * drives them.
 *
 * Long tasks live in the plugin-owned journal; only `suggest` reads the Dayflow
 * fixture for the day's activities. Every test gets its own temporary journal
 * on top of the shared read-only fixture database.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { DayflowErrorCode } from '../src/errors.js';
import { DayflowError } from '../src/errors.js';
import type { ReviewToolPayload } from '../src/review.js';
import type { LongTaskPayload, TaskMatchCandidate } from '../src/tasks.js';
import { reviewTools } from '../src/tools/review.js';
import { taskTools } from '../src/tools/task.js';
import { createFixtureDatabase } from './fixtures/database.js';
import { executionContext, makeRuntime, runAndRender, toolMap, toolNamed } from './helpers.js';

type Tools = ReturnType<typeof toolMap>;

/** The journal_task payload, as the tool-layer contract states it. */
interface TaskToolPayload {
  action: 'create' | 'list' | 'get' | 'update' | 'attach' | 'detach' | 'suggest';
  task?: LongTaskPayload;
  tasks?: LongTaskPayload[];
  candidates?: TaskMatchCandidate[];
  day?: string;
  hint: string;
}

/** The review payload, extended by the hand-off fields an accepted task proposal carries. */
type ReviewDecidePayload = ReviewToolPayload & { task_id?: number; task_title?: string };

const fixture = createFixtureDatabase();
const tempRoots: string[] = [];

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  fixture.cleanup();
});

/** Build a runtime over the fixture database with a brand-new owned journal. */
function isolatedRuntime(): ReturnType<typeof makeRuntime> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dayflow-task-tool-'));
  tempRoots.push(root);
  return makeRuntime(fixture.path, { journalPath: join(root, 'journal.sqlite') });
}

/** The task suite alone, against its own journal. */
function isolatedTools(): Tools {
  return toolMap(taskTools(isolatedRuntime()));
}

/** The task and review suites sharing one journal, for the hand-off tests. */
function linkedTools(): Tools {
  const runtime = isolatedRuntime();
  return toolMap([...taskTools(runtime), ...reviewTools(runtime)]);
}

/** Execute journal_task and type its canonical payload. */
async function callTask(tools: Tools, args: Record<string, unknown>): Promise<TaskToolPayload> {
  const value = await toolNamed(tools, 'journal_task').execute(args, executionContext());
  return value as TaskToolPayload;
}

/** Assert one journal_task call fails with the expected stable code. */
async function rejectsTask(
  tools: Tools,
  args: Record<string, unknown>,
  code: DayflowErrorCode,
): Promise<void> {
  await assert.rejects(
    () => toolNamed(tools, 'journal_task').execute(args, executionContext()),
    (error: unknown) => error instanceof DayflowError && error.code === code,
    `journal_task(${JSON.stringify(args)}) rejects with ${code}`,
  );
}

/** Execute journal_review and type its canonical payload. */
async function callReview(tools: Tools, args: Record<string, unknown>): Promise<ReviewDecidePayload> {
  const value = await toolNamed(tools, 'journal_review').execute(args, executionContext());
  return value as ReviewDecidePayload;
}

/** Read the required task off a payload, failing loudly when it is missing. */
function requiredTask(payload: TaskToolPayload): LongTaskPayload {
  const task = payload.task;
  assert.ok(task !== undefined, `journal_task(${payload.action}) returns a task`);
  return task;
}

test('a long task is created, tracked through idempotent sessions, and completed', async () => {
  const tools = isolatedTools();

  const created = await callTask(tools, {
    action: 'create',
    title: 'Port the recorder',
    description: 'Finish the recorder port and publish it.',
    target_date: '2026-12-31',
    categories: ['Work', 'Work', 'Coding'],
    apps: ['Cursor'],
  });
  assert.equal(created.action, 'create');
  const task = requiredTask(created);
  assert.equal(typeof task.id, 'number');
  assert.equal(task.title, 'Port the recorder');
  assert.equal(task.description, 'Finish the recorder port and publish it.');
  assert.equal(task.status, 'active');
  assert.equal(task.origin, 'user');
  assert.equal(task.target_date, '2026-12-31');
  assert.deepEqual(task.categories, ['Work', 'Coding']);
  assert.deepEqual(task.apps, ['Cursor']);
  assert.equal(task.total_minutes, 0);
  assert.equal(task.session_days, 0);
  assert.equal(task.last_session_day, undefined);
  assert.match(task.created_at, /^\d{4}-\d{2}-\d{2}/);

  const listed = await callTask(tools, { action: 'list' });
  assert.equal(listed.action, 'list');
  assert.deepEqual((listed.tasks ?? []).map((row) => row.id), [task.id]);

  const got = await callTask(tools, { action: 'get', id: task.id });
  assert.equal(got.action, 'get');
  const fresh = requiredTask(got);
  assert.deepEqual(fresh.sessions, []);
  assert.equal(fresh.total_minutes, 0);

  const attached = await callTask(tools, {
    action: 'attach',
    id: task.id,
    day: '2026-10-19',
    minutes: 45,
    activity_ids: [1, 2],
    note: 'Wrote the parser.',
  });
  assert.equal(attached.action, 'attach');
  const afterAttach = requiredTask(attached);
  assert.equal(afterAttach.total_minutes, 45);
  assert.equal(afterAttach.session_days, 1);
  assert.equal(afterAttach.last_session_day, '2026-10-19');
  const sessions = afterAttach.sessions ?? [];
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.day, '2026-10-19');
  assert.equal(sessions[0]?.minutes, 45);
  assert.equal(sessions[0]?.note, 'Wrote the parser.');
  assert.deepEqual(sessions[0]?.activity_ids, [1, 2]);

  // Attaching the same day again replaces the day's row instead of adding to it.
  const replaced = await callTask(tools, {
    action: 'attach',
    id: task.id,
    day: '2026-10-19',
    minutes: 20,
    note: 'Revised the estimate.',
  });
  const afterReplace = requiredTask(replaced);
  assert.equal(afterReplace.total_minutes, 20);
  assert.equal(afterReplace.session_days, 1);
  assert.equal((afterReplace.sessions ?? []).length, 1);
  assert.equal(afterReplace.sessions?.[0]?.minutes, 20);
  assert.equal(afterReplace.sessions?.[0]?.note, 'Revised the estimate.');

  const nextDay = await callTask(tools, {
    action: 'attach',
    id: task.id,
    day: '2026-10-20',
    minutes: 30,
  });
  const afterNextDay = requiredTask(nextDay);
  assert.equal(afterNextDay.total_minutes, 50);
  assert.equal(afterNextDay.session_days, 2);
  assert.equal(afterNextDay.last_session_day, '2026-10-20');

  const detached = await callTask(tools, { action: 'detach', id: task.id, day: '2026-10-19' });
  assert.equal(detached.action, 'detach');
  const afterDetach = requiredTask(detached);
  assert.equal(afterDetach.total_minutes, 30);
  assert.equal(afterDetach.session_days, 1);
  assert.equal(afterDetach.last_session_day, '2026-10-20');

  const detachedLast = await callTask(tools, { action: 'detach', id: task.id, day: '2026-10-20' });
  const afterDetachAll = requiredTask(detachedLast);
  assert.equal(afterDetachAll.total_minutes, 0);
  assert.equal(afterDetachAll.session_days, 0);
  assert.equal(afterDetachAll.last_session_day, undefined);
  assert.deepEqual(afterDetachAll.sessions, []);

  const updated = await callTask(tools, { action: 'update', id: task.id, status: 'done' });
  assert.equal(updated.action, 'update');
  assert.equal(requiredTask(updated).status, 'done');

  const done = await callTask(tools, { action: 'list', status: 'done' });
  assert.deepEqual((done.tasks ?? []).map((row) => row.id), [task.id]);
  const active = await callTask(tools, { action: 'list', status: 'active' });
  assert.deepEqual(active.tasks ?? [], []);
});

test('missing ids and malformed fields fail with stable codes', async () => {
  const tools = isolatedTools();

  await rejectsTask(tools, { action: 'create', description: 'No title here' }, 'invalid_input');
  await rejectsTask(tools, { action: 'create', title: '   ' }, 'invalid_input');
  await rejectsTask(tools, { action: 'create', title: 'Bad date', target_date: '2026-02-30' }, 'invalid_input');

  const created = await callTask(tools, { action: 'create', title: 'A real task' });
  const task = requiredTask(created);

  await rejectsTask(tools, { action: 'get', id: 9999 }, 'not_found');
  await rejectsTask(tools, { action: 'update', id: task.id, status: 'archived' }, 'invalid_input');
  await rejectsTask(tools, { action: 'attach', id: task.id, day: '2026-02-30', minutes: 10 }, 'invalid_input');
  await rejectsTask(tools, { action: 'attach', id: task.id, day: '2026-10-19', minutes: -5 }, 'invalid_input');
  await rejectsTask(tools, { action: 'archive' }, 'invalid_input');

  // The rejected calls left no partial write behind.
  const listed = await callTask(tools, { action: 'list' });
  assert.deepEqual((listed.tasks ?? []).map((row) => row.id), [task.id]);
  const got = await callTask(tools, { action: 'get', id: task.id });
  assert.equal(requiredTask(got).status, 'active');
  assert.deepEqual(requiredTask(got).sessions, []);
});

test('suggest explains which of the day activities belongs to which task without writing', async () => {
  const tools = isolatedTools();

  const matching = await callTask(tools, {
    action: 'create',
    title: 'Ship the plugin release',
    categories: ['Work'],
    apps: ['Cursor'],
  });
  const matchingTask = requiredTask(matching);

  const unrelated = await callTask(tools, {
    action: 'create',
    title: 'Plan the team offsite',
    categories: ['Research'],
    apps: ['Figma'],
  });
  const unrelatedTask = requiredTask(unrelated);

  const suggested = await callTask(tools, { action: 'suggest', day: '2026-10-19' });
  assert.equal(suggested.action, 'suggest');
  assert.equal(suggested.day, '2026-10-19');
  const candidates = suggested.candidates ?? [];

  // 2026-10-19 holds three Work activities: the coding card (#1, apps Cursor and
  // Google Chrome) plus the standup (#2) and the 03:30 fix (#8). The matching
  // task earns +2 per Work activity and +1 for the Cursor hit on #1.
  const match = candidates.find((candidate) => candidate.task_id === matchingTask.id);
  assert.ok(match !== undefined, 'the Work+Cursor task is a candidate');
  assert.equal(match.title, 'Ship the plugin release');
  assert.equal(match.score, 7);
  assert.deepEqual(match.activity_ids, [1, 2, 8]);
  assert.equal(match.reasons.length, 2);
  assert.ok(match.reasons.includes('category:Work'), 'reasons state the category hit');
  assert.ok(match.reasons.includes('app:Cursor'), 'reasons state the app hit');

  assert.equal(
    candidates.some((candidate) => candidate.task_id === unrelatedTask.id),
    false,
    'a task with no matching activity is not a candidate',
  );

  // Suggestions are read-only: the task still has no sessions.
  const after = await callTask(tools, { action: 'get', id: matchingTask.id });
  assert.deepEqual(requiredTask(after).sessions, []);
  assert.equal(requiredTask(after).total_minutes, 0);

  const quietDay = await callTask(tools, { action: 'suggest', day: '2026-01-02' });
  assert.deepEqual(quietDay.candidates ?? [], []);
});

test('accepting a task proposal creates an agent-origin long task', async () => {
  const tools = linkedTools();
  const title = 'Ship the plugin release';

  const proposed = await callReview(tools, {
    action: 'propose',
    kind: 'task_proposal',
    title,
    body: 'The release needs the tag gate and the changelog.',
    confidence: 0.9,
    source_day: '2026-10-19',
    source_activity_ids: [1, 2],
    evidence: 'Three sessions on the release script during the week.',
  });
  assert.equal(proposed.action, 'propose');
  assert.equal(proposed.dropped, false);
  const item = proposed.item;
  assert.ok(item !== undefined);
  assert.equal(item.kind, 'task_proposal');
  assert.equal(item.status, 'proposed');

  // The proposal alone creates no task: only the user's accept does.
  const before = await callTask(tools, { action: 'list' });
  assert.deepEqual(before.tasks ?? [], []);

  const decided = await callReview(tools, {
    action: 'decide',
    id: item.id,
    decision: 'accept',
    confirm: true,
  });
  assert.equal(decided.action, 'decide');
  assert.equal(decided.item?.id, item.id);
  assert.equal(decided.item?.status, 'accepted');
  assert.equal(typeof decided.task_id, 'number');
  assert.equal(decided.task_title, title);
  const taskId = decided.task_id;
  assert.ok(taskId !== undefined);

  const listed = await callTask(tools, { action: 'list' });
  const created = (listed.tasks ?? []).find((row) => row.id === taskId);
  assert.ok(created !== undefined, 'the accepted task appears in journal_task list');
  assert.equal(created.title, title);
  assert.equal(created.status, 'active');
  assert.equal(created.origin, 'agent');
  assert.equal(created.proposed_by, 'agent');
  assert.equal(created.review_item_id, item.id);

  const got = await callTask(tools, { action: 'get', id: taskId });
  const readable = requiredTask(got);
  assert.equal(readable.title, title);
  assert.equal(readable.description, 'The release needs the tag gate and the changelog.');
  assert.equal(typeof readable.accepted_at, 'string');
  assert.deepEqual(readable.sessions, []);
});

test('task and review renders carry the id, title, status, score, and created task', async () => {
  const tools = linkedTools();

  const created = await runAndRender(tools, 'journal_task', {
    action: 'create',
    title: 'Port the recorder',
    categories: ['Work'],
    apps: ['Cursor'],
  });
  const createdTask = (created.value as TaskToolPayload).task;
  assert.ok(createdTask !== undefined);
  assert.match(created.text, new RegExp(`#${createdTask.id}\\b`));
  assert.match(created.text, /Port the recorder/);
  assert.match(created.text, /active/);

  const listed = await runAndRender(tools, 'journal_task', { action: 'list' });
  assert.match(listed.text, /Long tasks/);
  assert.match(listed.text, new RegExp(`#${createdTask.id}\\b`));
  assert.match(listed.text, /Port the recorder/);

  const suggested = await runAndRender(tools, 'journal_task', { action: 'suggest', day: '2026-10-19' });
  assert.match(suggested.text, /Matches for 2026-10-19/);
  assert.match(suggested.text, new RegExp(`#${createdTask.id}\\b`));
  assert.match(suggested.text, /Port the recorder/);
  assert.match(suggested.text, /score \d+/);

  const title = 'Ship the plugin release';
  const proposed = await callReview(tools, {
    action: 'propose',
    kind: 'task_proposal',
    title,
    confidence: 0.9,
    source_day: '2026-10-19',
  });
  const item = proposed.item;
  assert.ok(item !== undefined);

  const decided = await runAndRender(tools, 'journal_review', {
    action: 'decide',
    id: item.id,
    decision: 'accept',
    confirm: true,
  });
  const decidedPayload = decided.value as ReviewDecidePayload;
  const taskId = decidedPayload.task_id;
  assert.ok(taskId !== undefined);
  assert.match(decided.text, new RegExp(`#${item.id}\\b`));
  assert.match(decided.text, /accepted/);
  assert.match(decided.text, new RegExp(title));
  assert.match(decided.text, new RegExp(`created task #${taskId}\\b`));
  assert.match(decided.text, new RegExp(title));
});
