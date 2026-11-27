/**
 * The composed review decision shared by the `journal_review` tool and the
 * panel's decision route: the decision itself, plus the long task it accepts
 * and the memory claim a keep implies.
 *
 * Every test gets its own temporary owned journal; nothing here reads the
 * Dayflow database, the default journal, or the network.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { DayflowErrorCode } from '../src/errors.js';
import { DayflowError } from '../src/errors.js';
import { openJournal } from '../src/journal.js';
import { listMemoryClaims } from '../src/memory.js';
import { applyReviewDecision } from '../src/review-actions.js';
import { listReviewItems, proposeReviewItem } from '../src/review.js';
import { listLongTasks } from '../src/tasks.js';

const tempRoots: string[] = [];

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/** A brand-new owned journal path under a disposable directory. */
function isolatedJournal(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dayflow-review-actions-'));
  tempRoots.push(root);
  return join(root, 'journal.sqlite');
}

/** Run one test body on a fresh write connection, closing it afterwards. */
function withDb<T>(journalPath: string, work: (db: ReturnType<typeof openJournal>) => T): T {
  const db = openJournal(journalPath);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

/** Propose one item and return it, failing loudly when the proposal drops. */
function propose(
  db: ReturnType<typeof openJournal>,
  kind: 'distillation' | 'loop' | 'improvement' | 'task_proposal',
  title: string,
  extra: Record<string, unknown> = {},
): number {
  const result = proposeReviewItem(db, { kind, title, ...extra });
  assert.equal(result.dropped, false);
  assert.ok(result.item);
  return result.item.id;
}

/** Assert one decision call fails with the expected stable code. */
function rejectsDecision(
  db: ReturnType<typeof openJournal>,
  id: number,
  decision: 'keep' | 'accept' | 'discard' | 'reject',
  code: DayflowErrorCode,
  options: { forever?: boolean; note?: string } = {},
): void {
  assert.throws(
    () => applyReviewDecision(db, id, decision, options),
    (error: unknown) => error instanceof DayflowError && error.code === code,
    `applyReviewDecision(${String(id)}, ${decision}) rejects with ${code}`,
  );
}

test('accepting a task proposal records the decision and creates one traceable task', () => {
  const journalPath = isolatedJournal();
  withDb(journalPath, (db) => {
    const id = propose(db, 'task_proposal', 'Port the native recorder', {
      body: 'Replace the old capture path with the native engine.',
      confidence: 0.8,
      source_day: '2026-11-20',
    });

    const outcome = applyReviewDecision(db, id, 'accept');
    assert.equal(outcome.item.id, id);
    assert.equal(outcome.item.kind, 'task_proposal');
    assert.equal(outcome.item.status, 'accepted');
    assert.equal(outcome.item.suppression, 'none');
    assert.equal(typeof outcome.item.decided_at, 'string');
    assert.equal(outcome.memory, undefined, 'an accepted task proposal writes no memory claim');

    const task = outcome.task;
    assert.ok(task, 'an accepted task proposal creates the long task');
    assert.equal(task.title, 'Port the native recorder');
    assert.equal(task.description, 'Replace the old capture path with the native engine.');
    assert.equal(task.origin, 'agent', 'the task came from an accepted proposal');
    assert.equal(task.proposed_by, 'agent');
    assert.equal(task.review_item_id, id, 'the task traces back to the review item');
    assert.equal(task.status, 'active');
    assert.equal(typeof task.accepted_at, 'string', 'an agent task is stamped accepted at creation');
    assert.equal(task.total_minutes, 0);
    assert.equal(task.session_days, 0);
    assert.deepEqual(task.sessions, []);

    // The store holds the same task and no claim: the composer wrote one act.
    assert.deepEqual(
      listLongTasks(db, { status: 'active' }).map((row) => row.id),
      [task.id],
    );
    assert.deepEqual(listMemoryClaims(db), []);
  });
});

test('keeping a distillation or a loop writes the dated memory claim it implies', () => {
  const journalPath = isolatedJournal();
  withDb(journalPath, (db) => {
    const distillationId = propose(db, 'distillation', 'Serialise the flaky test', {
      body: 'The test only fails when run in parallel.',
      confidence: 0.8,
      source_day: '2026-11-19',
    });
    const kept = applyReviewDecision(db, distillationId, 'keep');
    assert.equal(kept.item.status, 'kept');
    assert.equal(kept.task, undefined, 'a kept distillation creates no task');
    const memory = kept.memory;
    assert.ok(memory, 'a kept distillation writes the memory claim it implies');
    assert.equal(memory.kind, 'distillation');
    assert.equal(memory.subject, 'Serialise the flaky test');
    assert.equal(memory.body, 'The test only fails when run in parallel.');
    assert.equal(memory.observed_on, '2026-11-19', 'the claim is dated to the evidence day');
    assert.equal(memory.confidence, 0.8);
    assert.equal(memory.source_review_item, distillationId);
    assert.deepEqual(memory.source_days, ['2026-11-19']);

    // A kept loop is a claim of its own kind; the composer follows the item kind.
    const loopId = propose(db, 'loop', 'Every release week repeats the checks', {
      confidence: 0.9,
      source_day: '2026-11-20',
      loop_occurrences: 4,
      loop_span_days: 28,
      loop_trigger: 'schedule',
    });
    const keptLoop = applyReviewDecision(db, loopId, 'keep');
    assert.equal(keptLoop.memory?.kind, 'loop');

    const claims = listMemoryClaims(db);
    assert.equal(claims.length, 2);
    assert.deepEqual(
      claims.map((claim) => claim.source_review_item).sort(),
      [distillationId, loopId].sort(),
    );
    assert.deepEqual(listLongTasks(db), []);
  });
});

test('a negative decision only decides the item and writes no task or claim', () => {
  const journalPath = isolatedJournal();
  withDb(journalPath, (db) => {
    const discardedId = propose(db, 'distillation', 'Hand-copy the changelog', {
      confidence: 0.8,
      source_day: '2026-11-18',
    });
    const discarded = applyReviewDecision(db, discardedId, 'discard');
    assert.equal(discarded.item.status, 'discarded');
    assert.equal(discarded.item.suppression, 'soft', 'a plain discard is a soft suppression');
    assert.equal(discarded.task, undefined);
    assert.equal(discarded.memory, undefined);

    const rejectedId = propose(db, 'task_proposal', 'Rewrite the release script');
    const rejected = applyReviewDecision(db, rejectedId, 'reject');
    assert.equal(rejected.item.status, 'rejected');
    assert.equal(rejected.item.suppression, 'soft');
    assert.equal(rejected.task, undefined, 'a rejected task proposal creates no task');

    assert.deepEqual(listMemoryClaims(db), []);
    assert.deepEqual(listLongTasks(db), []);
  });
});

test('accepting an improvement decides the item without creating a task', () => {
  const journalPath = isolatedJournal();
  withDb(journalPath, (db) => {
    const id = propose(db, 'improvement', 'Show stalled tasks first', { confidence: 0.7 });
    const outcome = applyReviewDecision(db, id, 'accept');
    assert.equal(outcome.item.status, 'accepted');
    assert.equal(outcome.task, undefined, 'only a task proposal becomes a long task');
    assert.equal(outcome.memory, undefined, 'only a kept distillation or loop becomes a claim');
    assert.deepEqual(listLongTasks(db), []);
  });
});

test('forever only applies to a negative decision and hard-suppresses the fingerprint', () => {
  const journalPath = isolatedJournal();
  withDb(journalPath, (db) => {
    const title = 'Hand-copy the changelog every release';
    const keptId = propose(db, 'distillation', 'Keep the migration lock', { confidence: 0.8 });
    rejectsDecision(db, keptId, 'keep', 'invalid_input', { forever: true });
    // The rejected request changed nothing: the item is still open.
    const stillProposed = listReviewItems(db, { status: 'proposed' });
    assert.deepEqual(
      stillProposed.map((item) => item.id),
      [keptId],
    );

    const id = propose(db, 'distillation', title, { confidence: 0.8, source_day: '2026-11-19' });
    const discarded = applyReviewDecision(db, id, 'discard', { forever: true });
    assert.equal(discarded.item.suppression, 'hard');
    assert.equal(discarded.item.status, 'discarded');

    // A hard suppression outranks new evidence: another day stays dropped.
    const suppressed = proposeReviewItem(db, {
      kind: 'distillation',
      title,
      confidence: 0.95,
      source_day: '2026-11-21',
    });
    assert.equal(suppressed.dropped, true);
    assert.equal(suppressed.reason, 'hard-suppressed');

    // A soft discard may return once the evidence is materially new.
    const softTitle = 'The first hour goes to email';
    const softId = propose(db, 'distillation', softTitle, { confidence: 0.8, source_day: '2026-11-19' });
    const soft = applyReviewDecision(db, softId, 'discard');
    assert.equal(soft.item.suppression, 'soft');
    const sameEvidence = proposeReviewItem(db, {
      kind: 'distillation',
      title: softTitle,
      confidence: 0.8,
      source_day: '2026-11-19',
    });
    assert.equal(sameEvidence.dropped, true);
    assert.equal(sameEvidence.reason, 'soft-discarded');
    const nextDay = proposeReviewItem(db, {
      kind: 'distillation',
      title: softTitle,
      confidence: 0.8,
      source_day: '2026-11-22',
    });
    assert.equal(nextDay.dropped, false);
    assert.equal(nextDay.item?.status, 'proposed');
  });
});

test('unknown ids, already-decided items, and kind mismatches propagate dayflow errors', () => {
  const journalPath = isolatedJournal();
  withDb(journalPath, (db) => {
    rejectsDecision(db, 9_999, 'keep', 'not_found');
    rejectsDecision(db, 0, 'keep', 'not_found');

    const improvementId = propose(db, 'improvement', 'Gate the release script on the tag');
    rejectsDecision(db, improvementId, 'keep', 'invalid_input');
    rejectsDecision(db, improvementId, 'accept', 'invalid_input', { forever: true });

    const accepted = applyReviewDecision(db, improvementId, 'accept');
    assert.equal(accepted.item.status, 'accepted');
    rejectsDecision(db, improvementId, 'reject', 'invalid_input');

    const taskId = propose(db, 'task_proposal', 'Adopt the review queue for release notes');
    rejectsDecision(db, taskId, 'keep', 'invalid_input');
  });
});

test('the decision note is stored on the decided item', () => {
  const journalPath = isolatedJournal();
  withDb(journalPath, (db) => {
    const id = propose(db, 'distillation', 'Write the release notes first', {
      confidence: 0.8,
      source_day: '2026-11-20',
    });
    const outcome = applyReviewDecision(db, id, 'keep', { note: 'Worth keeping for the release ritual.' });
    assert.equal(outcome.item.decision_note, 'Worth keeping for the release ritual.');
    assert.equal(outcome.memory?.source_review_item, id);
  });
});
