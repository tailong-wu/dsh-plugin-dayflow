/**
 * Owned journal schema v3 (review queue) and the review-item store semantics.
 *
 * The store is the checkpoint the roadmap asks for: proposals are cheap to add,
 * decisions belong to the user, and a discarded item only returns when its
 * evidence is materially new. These tests use disposable journals under a
 * temporary directory; they never touch the default `$DSH_HOME` journal.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DayflowError } from '../src/errors.js';
import { JOURNAL_SCHEMA_VERSION, openJournal, withJournal, withJournalWrite } from '../src/journal.js';
import {
  MAX_PROPOSALS_PER_DAY,
  MIN_PROPOSAL_CONFIDENCE,
  decideReviewItem,
  listReviewItems,
  proposeReviewItem,
  reviewFingerprint,
  unsuppressReviewItem,
} from '../src/review.js';
import type { ProposeResult, ReviewItemPayload, ReviewKind, ReviewProposalInput } from '../src/review.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-review-store-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let fileCounter = 0;

/** A fresh journal path inside the disposable directory. */
function journalFile(label: string): string {
  fileCounter += 1;
  return join(directory, `${label}-${fileCounter}.sqlite`);
}

interface Row {
  readonly [key: string]: unknown;
}

/** Read rows from a journal file with one short-lived raw connection. */
function queryAll(path: string, sql: string, ...parameters: (string | number)[]): Row[] {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).all(...(parameters as never[])) as Row[];
  } finally {
    db.close();
  }
}

/** Read one row from a journal file with one short-lived raw connection. */
function queryRow(path: string, sql: string, ...parameters: (string | number)[]): Row | undefined {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).get(...(parameters as never[])) as Row | undefined;
  } finally {
    db.close();
  }
}

function schemaVersion(path: string): number {
  return Number(queryRow(path, 'SELECT version FROM schema_version ORDER BY version LIMIT 1')?.version);
}

function reviewItemCount(path: string): number {
  return Number(queryRow(path, 'SELECT count(*) AS count FROM review_items')?.count ?? 0);
}

function reviewItemCountIn(db: DatabaseSync): number {
  return Number((db.prepare('SELECT count(*) AS count FROM review_items').get() as Row).count);
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

function isNotFound(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'not_found';
}

function isInvalidInputMatching(pattern: RegExp): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    error instanceof DayflowError && error.code === 'invalid_input' && pattern.test(error.message);
}

/** Assert a proposal was stored and return it. */
function storedProposal(result: ProposeResult): ReviewItemPayload {
  if (result.dropped || result.item === undefined) {
    assert.fail(`expected a stored proposal, dropped with reason ${result.reason ?? '(none)'}`);
  }
  return result.item;
}

/** Propose one item and return the stored row. */
function proposeOne(db: DatabaseSync, input: ReviewProposalInput): ReviewItemPayload {
  return storedProposal(proposeReviewItem(db, input));
}

/**
 * Build a v2-shaped journal: the v3 tables have been used once (so the schema
 * is complete), then `review_items` is dropped and the version is rewound to 2.
 * This is exactly the file an installed 0.6.x journal is before migration 3.
 */
function createV2Journal(path: string): void {
  const db = openJournal(path);
  try {
    db.prepare("INSERT INTO days (day, start_ts, end_ts) VALUES ('2026-01-01', 100, 200)").run();
    db.prepare(
      `INSERT INTO activities (source_key, start_ts, end_ts, day, title, summary)
       VALUES ('legacy-card', 100, 200, '2026-01-01', 'Legacy activity', 'Kept through the upgrade')`,
    ).run();
    db.exec('DROP TABLE review_items');
    db.prepare('UPDATE schema_version SET version = 2').run();
  } finally {
    db.close();
  }
}

test('a new journal migrates to schema v3 with the review queue tables', () => {
  const path = journalFile('fresh');
  const db = openJournal(path);
  const version = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'review_items'")
    .get() as { name: string } | undefined;
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'review_items_%' ORDER BY name")
    .all() as { name: string }[];
  db.close();

  assert.equal(JOURNAL_SCHEMA_VERSION, 3);
  assert.equal(version?.version, 3);
  assert.equal(table?.name, 'review_items');
  assert.deepEqual(indexes.map((row) => row.name), ['review_items_fingerprint_idx', 'review_items_status_idx']);
  assert.deepEqual(withJournal(path, (read) => listReviewItems(read)), []);
});

test('a v2 journal migrates to v3 and keeps its rows', () => {
  const path = journalFile('v2-read');
  createV2Journal(path);
  assert.equal(schemaVersion(path), 2);
  assert.equal(
    queryRow(path, "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'review_items'")?.count,
    0,
    'review_items must not exist before the migration',
  );

  const migrated = openJournal(path);
  try {
    assert.equal(
      (migrated.prepare('SELECT version FROM schema_version').get() as { version: number }).version,
      3,
    );
    assert.equal((migrated.prepare('SELECT count(*) AS count FROM activities').get() as { count: number }).count, 1);
    assert.equal(
      (migrated.prepare("SELECT title FROM activities WHERE source_key = 'legacy-card'").get() as { title: string }).title,
      'Legacy activity',
    );
    assert.equal(
      (migrated.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'review_items'").get() as {
        count: number;
      }).count,
      1,
    );
  } finally {
    migrated.close();
  }
});

test('the read path and the write path both upgrade a v2 journal', () => {
  const readPath = journalFile('v2-readiness');
  createV2Journal(readPath);
  const legacyTitle = withJournal(readPath, (db) => {
    const row = db.prepare("SELECT title, payload_json FROM activities WHERE source_key = 'legacy-card'").get() as {
      title: string;
      payload_json: string | null;
    };
    return row.title;
  });
  assert.equal(legacyTitle, 'Legacy activity');
  assert.equal(schemaVersion(readPath), 3);

  const writePath = journalFile('v2-write');
  createV2Journal(writePath);
  const result = withJournalWrite(writePath, (db) =>
    proposeReviewItem(db, { kind: 'distillation', title: 'Lands after the upgrade', confidence: 0.8 }),
  );
  assert.equal(storedProposal(result).status, 'proposed');
  assert.equal(schemaVersion(writePath), 3);
  assert.equal(reviewItemCount(writePath), 1);
  assert.equal(queryRow(writePath, 'SELECT title FROM activities WHERE source_key = ?', 'legacy-card')?.title, 'Legacy activity');
});

test('withJournalWrite migrates, writes, and propagates callback errors', () => {
  const path = journalFile('write');
  const result = withJournalWrite(path, (db) =>
    proposeReviewItem(db, {
      kind: 'distillation',
      title: 'A lease keeps the replica from lagging',
      body: 'The migration needs a lock or the replica lags.',
      confidence: 0.82,
      source_day: '2026-02-02',
      source_activity_ids: [11, 12],
      evidence: 'Day 2026-02-02, 09:10–09:40',
    }),
  );
  assert.equal(result.dropped, false);
  const item = storedProposal(result);
  assert.equal(item.status, 'proposed');
  assert.equal(item.suppression, 'none');
  assert.equal(item.confidence, 0.82);
  assert.equal(item.body, 'The migration needs a lock or the replica lags.');
  assert.equal(item.source_day, '2026-02-02');
  assert.deepEqual(item.source_activity_ids, [11, 12]);
  assert.equal(item.evidence, 'Day 2026-02-02, 09:10–09:40');
  assert.ok(item.created_at.length > 0);
  assert.equal(item.decided_at, undefined);
  assert.equal(item.decision_note, undefined);

  // The row survives the closed write connection and is visible to the read path.
  assert.deepEqual(withJournal(path, (db) => listReviewItems(db)), [item]);
  assert.equal(schemaVersion(path), 3);

  const failure = new Error('write callback failed');
  assert.throws(
    () =>
      withJournalWrite(path, () => {
        throw failure;
      }),
    (error: unknown) => error === failure,
  );
  // The connection was closed despite the error, so the next write still works.
  assert.equal(withJournalWrite(path, (db) => listReviewItems(db)).length, 1);
});

test('fingerprints normalize kind and title', () => {
  assert.equal(reviewFingerprint('distillation', '  Flaky   TEST '), reviewFingerprint('distillation', 'flaky test'));
  assert.equal(reviewFingerprint('loop', 'Release  checklist'), reviewFingerprint('loop', 'release checklist'));
  assert.notEqual(reviewFingerprint('loop', 'Flaky test'), reviewFingerprint('distillation', 'Flaky test'));
  assert.match(reviewFingerprint('distillation', 'Flaky test'), /^[0-9a-f]{64}$/);
});

test('propose validates input, drops duplicates, and drops low confidence', () => {
  const path = journalFile('propose-guards');
  withJournalWrite(path, (db) => {
    assert.throws(() => proposeReviewItem(db, { kind: 'distillation', title: '   ' }), isInvalidInput);
    assert.throws(
      () => proposeReviewItem(db, { kind: 'nonsense' as unknown as ReviewKind, title: 'Title' }),
      isInvalidInput,
    );
    assert.throws(() => proposeReviewItem(db, { kind: 'distillation', title: 'Title', confidence: 1.4 }), isInvalidInput);
    assert.throws(() => proposeReviewItem(db, { kind: 'distillation', title: 'Title', confidence: -0.1 }), isInvalidInput);
    assert.throws(
      () => proposeReviewItem(db, { kind: 'distillation', title: 'Title', loop_trigger: 'later' as never }),
      isInvalidInput,
    );
    assert.throws(
      () =>
        proposeReviewItem(db, {
          kind: 'distillation',
          title: 'Title',
          source_activity_ids: ['1' as unknown as number],
        }),
      isInvalidInput,
    );

    const below = proposeReviewItem(db, {
      kind: 'distillation',
      title: 'Below the floor',
      confidence: MIN_PROPOSAL_CONFIDENCE - 0.01,
    });
    assert.deepEqual(below, { dropped: true, reason: 'below-confidence-floor' });
    assert.equal(reviewItemCountIn(db), 0, 'a dropped proposal must not be written');

    const atFloor = proposeOne(db, {
      kind: 'distillation',
      title: 'Exactly at the floor',
      confidence: MIN_PROPOSAL_CONFIDENCE,
    });
    assert.equal(atFloor.confidence, MIN_PROPOSAL_CONFIDENCE);

    const first = proposeOne(db, {
      kind: 'distillation',
      title: '  Flaky test when parallel ',
      confidence: 0.8,
      source_day: '2026-02-03',
    });
    assert.equal(first.confidence, 0.8);
    assert.equal(first.title, 'Flaky test when parallel', 'stored title is trimmed');

    const duplicate = proposeReviewItem(db, {
      kind: 'distillation',
      title: 'flaky   TEST when PARALLEL',
      confidence: 0.9,
    });
    assert.deepEqual(duplicate, { dropped: true, reason: 'already-proposed' });
    assert.equal(reviewItemCountIn(db), 2);
  });
});

test('propose caps open proposals per source day', () => {
  const path = journalFile('daily-cap');
  withJournalWrite(path, (db) => {
    for (let index = 0; index < MAX_PROPOSALS_PER_DAY; index += 1) {
      const result = proposeReviewItem(db, {
        kind: 'distillation',
        title: `Daily proposal ${index}`,
        confidence: MIN_PROPOSAL_CONFIDENCE,
        source_day: '2026-02-04',
      });
      assert.equal(result.dropped, false, `proposal ${index} should fit under the cap`);
    }
    const capped = proposeReviewItem(db, {
      kind: 'distillation',
      title: 'Over the daily cap',
      confidence: MIN_PROPOSAL_CONFIDENCE,
      source_day: '2026-02-04',
    });
    assert.deepEqual(capped, { dropped: true, reason: 'daily-proposal-cap' });

    const otherDay = proposeReviewItem(db, {
      kind: 'distillation',
      title: 'Next day proposal',
      confidence: MIN_PROPOSAL_CONFIDENCE,
      source_day: '2026-02-05',
    });
    assert.equal(otherDay.dropped, false, 'the cap is per source day');

    // Deciding an item frees its slot: the cap counts open proposals only.
    const open = listReviewItems(db, { kind: 'distillation' });
    const oldest = open[open.length - 1];
    assert.ok(oldest !== undefined);
    decideReviewItem(db, oldest.id, 'keep');
    const reopened = proposeReviewItem(db, {
      kind: 'distillation',
      title: 'Room after a decision',
      confidence: MIN_PROPOSAL_CONFIDENCE,
      source_day: '2026-02-04',
    });
    assert.equal(reopened.dropped, false);
  });
});

test('decide moves each kind to its kind-appropriate status', () => {
  const path = journalFile('decide');
  withJournalWrite(path, (db) => {
    const distillation = proposeOne(db, { kind: 'distillation', title: 'Distillation candidate', confidence: 0.8 });
    const kept = decideReviewItem(db, distillation.id, 'keep', { note: 'worth remembering' });
    assert.equal(kept.status, 'kept');
    assert.equal(kept.suppression, 'none');
    assert.equal(kept.decision_note, 'worth remembering');
    assert.ok(kept.decided_at !== undefined);

    const loop = proposeOne(db, {
      kind: 'loop',
      title: 'Release-week checklist loop',
      confidence: 0.8,
      loop_occurrences: 4,
      loop_span_days: 42,
      loop_trigger: 'event',
    });
    assert.equal(loop.loop_occurrences, 4);
    assert.equal(loop.loop_span_days, 42);
    assert.equal(loop.loop_trigger, 'event');
    const discarded = decideReviewItem(db, loop.id, 'discard');
    assert.equal(discarded.status, 'discarded');
    assert.equal(discarded.suppression, 'soft');
    assert.equal(discarded.decision_note, undefined);

    const improvement = proposeOne(db, { kind: 'improvement', title: 'Gate the release on the tag' });
    const accepted = decideReviewItem(db, improvement.id, 'accept');
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.suppression, 'none');

    const task = proposeOne(db, { kind: 'task_proposal', title: 'Write the migration guide' });
    const rejected = decideReviewItem(db, task.id, 'reject');
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.suppression, 'soft');

    assert.deepEqual(listReviewItems(db), [], 'decided items leave the proposed queue');
    assert.deepEqual(
      listReviewItems(db, { status: 'kept' }).map((item) => item.title),
      ['Distillation candidate'],
    );
    assert.deepEqual(
      listReviewItems(db, { status: 'accepted' }).map((item) => item.id),
      [improvement.id],
    );
    assert.deepEqual(
      listReviewItems(db, { status: 'rejected' }).map((item) => item.id),
      [task.id],
    );
  });
});

test('decide rejects invalid and mismatched decisions', () => {
  const path = journalFile('decide-guards');
  withJournalWrite(path, (db) => {
    assert.throws(() => decideReviewItem(db, 9999, 'keep'), isNotFound);

    const distillation = proposeOne(db, { kind: 'distillation', title: 'Needs a keep or discard' });
    assert.throws(() => decideReviewItem(db, distillation.id, 'accept'), isInvalidInput);
    assert.throws(() => decideReviewItem(db, distillation.id, 'keep', { forever: true }), isInvalidInput);
    assert.throws(() => decideReviewItem(db, distillation.id, 'approve' as never), isInvalidInput);
    assert.equal(listReviewItems(db).length, 1, 'a rejected decision must not change the item');
    assert.equal(listReviewItems(db)[0]?.status, 'proposed');

    const kept = decideReviewItem(db, distillation.id, 'keep');
    assert.equal(kept.status, 'kept');
    assert.throws(
      () => decideReviewItem(db, distillation.id, 'discard'),
      isInvalidInputMatching(/already decided/),
    );

    const improvement = proposeOne(db, { kind: 'improvement', title: 'Needs an accept or reject' });
    assert.throws(() => decideReviewItem(db, improvement.id, 'keep'), isInvalidInput);
    assert.throws(() => decideReviewItem(db, improvement.id, 'discard'), isInvalidInput);
    assert.equal(listReviewItems(db, { status: 'proposed' }).length, 1);
  });
});

test('hard suppression blocks every later proposal until it is cleared', () => {
  const path = journalFile('hard-suppression');
  withJournalWrite(path, (db) => {
    const first = proposeOne(db, {
      kind: 'distillation',
      title: 'Flaky test fails only in parallel',
      confidence: 0.6,
      source_day: '2026-03-01',
    });
    const suppressed = decideReviewItem(db, first.id, 'discard', { forever: true });
    assert.equal(suppressed.status, 'discarded');
    assert.equal(suppressed.suppression, 'hard');

    // Evidence upgrades do not matter: a hard suppression ignores them.
    const retry = proposeReviewItem(db, {
      kind: 'distillation',
      title: 'flaky test fails ONLY in parallel',
      confidence: 0.99,
      source_day: '2026-03-08',
      loop_occurrences: 9,
    });
    assert.deepEqual(retry, { dropped: true, reason: 'hard-suppressed' });
    assert.equal(listReviewItems(db).length, 0);

    const cleared = unsuppressReviewItem(db, first.id);
    assert.equal(cleared.suppression, 'none');
    assert.equal(cleared.status, 'discarded', 'clearing a suppression keeps the decision');

    const again = proposeReviewItem(db, {
      kind: 'distillation',
      title: 'Flaky test fails only in parallel',
      confidence: 0.6,
      source_day: '2026-03-01',
    });
    assert.equal(again.dropped, false, 'an unsuppressed idea may be proposed again');

    assert.throws(() => unsuppressReviewItem(db, 9999), isNotFound);
    assert.throws(
      () => unsuppressReviewItem(db, storedProposal(again).id),
      isInvalidInputMatching(/not hard-suppressed/),
    );
  });
});

test('a soft discard returns only with materially new evidence', () => {
  const path = journalFile('soft-suppression');
  withJournalWrite(path, (db) => {
    // Same day and (nearly) the same confidence is not new evidence.
    const base: ReviewProposalInput = {
      kind: 'distillation',
      title: 'Serialise the migration test',
      confidence: 0.6,
      source_day: '2026-04-01',
    };
    const first = proposeOne(db, base);
    assert.equal(decideReviewItem(db, first.id, 'discard').suppression, 'soft');
    assert.deepEqual(proposeReviewItem(db, { ...base }), { dropped: true, reason: 'soft-discarded' });
    assert.deepEqual(proposeReviewItem(db, { ...base, confidence: 0.7 }), {
      dropped: true,
      reason: 'soft-discarded',
    });

    // A different source day is material.
    const otherDay = proposeReviewItem(db, { ...base, source_day: '2026-04-02' });
    assert.equal(otherDay.dropped, false);

    // A confidence jump of at least 0.15 is material.
    const confidencePath: ReviewProposalInput = {
      kind: 'distillation',
      title: 'Batch the release notes',
      confidence: 0.6,
      source_day: '2026-04-03',
    };
    const second = proposeOne(db, confidencePath);
    decideReviewItem(db, second.id, 'discard');
    assert.deepEqual(proposeReviewItem(db, { ...confidencePath, confidence: 0.74 }), {
      dropped: true,
      reason: 'soft-discarded',
    });
    assert.equal(proposeReviewItem(db, { ...confidencePath, confidence: 0.75 }).dropped, false);

    // One more loop occurrence is material.
    const loopPath: ReviewProposalInput = {
      kind: 'loop',
      title: 'Monday release checklist',
      confidence: 0.6,
      source_day: '2026-04-04',
      loop_occurrences: 2,
      loop_trigger: 'schedule',
    };
    const third = proposeOne(db, loopPath);
    decideReviewItem(db, third.id, 'discard');
    assert.deepEqual(proposeReviewItem(db, { ...loopPath, loop_occurrences: 2 }), {
      dropped: true,
      reason: 'soft-discarded',
    });
    assert.equal(proposeReviewItem(db, { ...loopPath, loop_occurrences: 3 }).dropped, false);

    // Soft suppression is per fingerprint: a different idea on the same day passes.
    const different = proposeReviewItem(db, {
      kind: 'distillation',
      title: 'Cache the fixture database',
      confidence: 0.6,
      source_day: '2026-04-01',
    });
    assert.equal(different.dropped, false);
  });
});

test('list filters by kind and status, newest first, and bounds the limit', () => {
  const path = journalFile('list');
  withJournalWrite(path, (db) => {
    const day = '2026-05-01';
    const distillationOne = proposeOne(db, { kind: 'distillation', title: 'Distillation one', confidence: 0.8, source_day: day });
    const improvementOne = proposeOne(db, { kind: 'improvement', title: 'Improvement one', confidence: 0.8, source_day: day });
    const distillationTwo = proposeOne(db, { kind: 'distillation', title: 'Distillation two', confidence: 0.8, source_day: day });
    const improvementTwo = proposeOne(db, { kind: 'improvement', title: 'Improvement two', confidence: 0.8, source_day: day });
    const taskProposal = proposeOne(db, { kind: 'task_proposal', title: 'Task proposal one', confidence: 0.8, source_day: day });
    decideReviewItem(db, distillationOne.id, 'keep');

    assert.deepEqual(
      listReviewItems(db).map((item) => item.id),
      [taskProposal.id, improvementTwo.id, distillationTwo.id, improvementOne.id],
    );
    assert.deepEqual(
      listReviewItems(db, { kind: 'distillation' }).map((item) => item.id),
      [distillationTwo.id],
      'the kept distillation is not in the proposed queue',
    );
    assert.deepEqual(
      listReviewItems(db, { kind: 'improvement' }).map((item) => item.id),
      [improvementTwo.id, improvementOne.id],
    );
    assert.deepEqual(
      listReviewItems(db, { status: 'kept' }).map((item) => item.id),
      [distillationOne.id],
    );
    assert.deepEqual(
      listReviewItems(db, { limit: 2 }).map((item) => item.id),
      [taskProposal.id, improvementTwo.id],
    );

    assert.throws(() => listReviewItems(db, { kind: 'nonsense' as unknown as ReviewKind }), isInvalidInput);
    assert.throws(() => listReviewItems(db, { status: 'pending' as never }), isInvalidInput);
    assert.throws(() => listReviewItems(db, { limit: 0 }), isInvalidInput);
    assert.throws(() => listReviewItems(db, { limit: 201 }), isInvalidInput);
    assert.throws(() => listReviewItems(db, { limit: 1.5 }), isInvalidInput);
  });
});

test('list defaults to 50 rows and allows at most 200', () => {
  const path = journalFile('list-limit');
  withJournalWrite(path, (db) => {
    const insert = db.prepare(
      `INSERT INTO review_items (fingerprint, kind, title, confidence, status, suppression)
       VALUES (?, 'distillation', ?, 0.9, 'proposed', 'none')`,
    );
    for (let index = 0; index < 205; index += 1) insert.run(`queued-${index}`, `Queued item ${index}`);

    assert.equal(listReviewItems(db).length, 50, 'the default limit is 50');
    assert.equal(listReviewItems(db, { limit: 200 }).length, 200);
    assert.equal(listReviewItems(db, { limit: 1 }).length, 1);
    assert.deepEqual(
      listReviewItems(db, { limit: 3 }).map((item) => item.title),
      ['Queued item 204', 'Queued item 203', 'Queued item 202'],
      'newest first',
    );
  });
});

test('proposal fields are stored in review_items columns', () => {
  const path = journalFile('columns');
  const result = withJournalWrite(path, (db) =>
    proposeReviewItem(db, {
      kind: 'loop',
      title: 'Email first hour loop',
      body: 'The first hour of every day goes to email.',
      confidence: 0.73,
      source_day: '2026-06-01',
      source_activity_ids: [3, 4, 5],
      evidence: 'Seen on three days',
      loop_occurrences: 4,
      loop_span_days: 21,
      loop_trigger: 'schedule',
    }),
  );
  const item = storedProposal(result);
  const row = queryRow(path, 'SELECT * FROM review_items WHERE id = ?', item.id);
  assert.ok(row !== undefined);
  assert.equal(row.fingerprint, reviewFingerprint('loop', 'Email first hour loop'));
  assert.equal(row.kind, 'loop');
  assert.equal(row.status, 'proposed');
  assert.equal(row.title, 'Email first hour loop');
  assert.equal(row.body, 'The first hour of every day goes to email.');
  assert.equal(row.confidence, 0.73);
  assert.equal(row.source_day, '2026-06-01');
  assert.equal(row.source_activity_ids_json, '[3,4,5]');
  assert.equal(row.evidence, 'Seen on three days');
  assert.equal(row.loop_occurrences, 4);
  assert.equal(row.loop_span_days, 21);
  assert.equal(row.loop_trigger, 'schedule');
  assert.equal(row.suppression, 'none');
  assert.equal(row.decided_at, null);
  assert.equal(row.decision_note, null);
  assert.deepEqual(item.source_activity_ids, [3, 4, 5]);
});
