/**
 * Owned journal schema v5 (memory claims) and the memory-store semantics.
 *
 * The store is the Phase 4 checkpoint: claims are dated history, never rewritten
 * in place. Changing a claim appends a new row and marks the old one superseded;
 * forgetting is a hard delete the user has to ask for. Search prefers the
 * optional FTS5 index and must behave the same without it, because a Node build
 * can ship `node:sqlite` without FTS5 (the CI Node 22 case).
 *
 * These tests use disposable journals under a temporary directory; they never
 * touch the default `$DSH_HOME` journal.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { formatDayKey } from '../src/day.js';
import { DayflowError } from '../src/errors.js';
import { JOURNAL_SCHEMA_VERSION, openJournal, withJournal, withJournalWrite } from '../src/journal.js';
import {
  MEMORY_MAX_LIMIT,
  addMemoryClaim,
  createMemoryFromReviewItem,
  forgetMemoryClaim,
  listMemoryClaims,
  searchMemoryClaims,
  supersedeMemoryClaim,
} from '../src/memory.js';
import type { MemoryClaimKind } from '../src/memory.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-memory-store-'));
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

function tableCountIn(db: DatabaseSync, table: string): number {
  return Number(
    (
      db
        .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as Row
    ).count,
  );
}

function claimCountIn(db: DatabaseSync, includeSuperseded = true): number {
  const sql = includeSuperseded
    ? 'SELECT count(*) AS count FROM memory_claims'
    : 'SELECT count(*) AS count FROM memory_claims WHERE superseded_by IS NULL';
  return Number((db.prepare(sql).get() as Row).count);
}

/** The local calendar day, shifted by whole days — used to build a future day. */
function dayKeyOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDayKey(date);
}

/** Whether migration 5 managed to build the optional FTS5 index. */
function hasFtsIndex(db: DatabaseSync): boolean {
  try {
    return tableCountIn(db, 'memory_claims_fts') === 1;
  } catch {
    return false;
  }
}

/** The keep-in-sync triggers that belong to the optional FTS5 index. */
function ftsTriggersIn(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'memory_claims_%' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

function ftsRowCount(db: DatabaseSync): number {
  return Number((db.prepare('SELECT count(*) AS count FROM memory_claims_fts').get() as Row).count);
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

function isNotFound(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'not_found';
}

/**
 * Build a v4-shaped journal: a fully migrated file whose memory table and FTS
 * index have been dropped and whose version is rewound to 4. This is exactly
 * what an installed 0.6.x journal looks like before migration 5.
 */
function createV4Journal(path: string): void {
  const db = openJournal(path);
  try {
    db.prepare("INSERT INTO days (day, start_ts, end_ts) VALUES ('2026-01-05', 100, 200)").run();
    db.prepare(
      `INSERT INTO activities (source_key, start_ts, end_ts, day, title, summary)
       VALUES ('legacy-card', 100, 200, '2026-01-05', 'Legacy activity', 'Kept through the upgrade')`,
    ).run();
    db.prepare(
      `INSERT INTO review_items (fingerprint, kind, status, title, body, confidence)
       VALUES ('legacy-fingerprint', 'distillation', 'kept', 'A legacy distillation', 'Kept too', 0.9)`,
    ).run();
    db.prepare(
      `INSERT INTO long_tasks (title, description, status)
       VALUES ('A legacy task', 'Still here after the upgrade', 'active')`,
    ).run();
    db.exec('DROP TABLE IF EXISTS memory_claims');
    db.exec('DROP TABLE IF EXISTS memory_claims_fts');
    db.prepare('UPDATE schema_version SET version = 4').run();
  } finally {
    db.close();
  }
}

test('a new journal migrates to schema v5 with the memory table and indexes', () => {
  const path = journalFile('fresh');
  const db = openJournal(path);
  try {
    const version = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    assert.ok(JOURNAL_SCHEMA_VERSION >= 5, 'the memory store needs at least schema v5');
    assert.equal(version?.version, JOURNAL_SCHEMA_VERSION);
    assert.equal(tableCountIn(db, 'memory_claims'), 1);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'memory_claims%' ORDER BY name")
      .all() as { name: string }[];
    assert.deepEqual(
      indexes.map((row) => row.name),
      ['memory_claims_active_idx', 'memory_claims_subject_idx'],
    );

    // FTS5 is optional: only assert on the index when this Node build has it.
    if (hasFtsIndex(db)) {
      assert.deepEqual(ftsTriggersIn(db), ['memory_claims_ad', 'memory_claims_ai', 'memory_claims_au']);
      assert.equal(ftsRowCount(db), 0);
    } else {
      assert.deepEqual(ftsTriggersIn(db), [], 'a build without FTS5 leaves no dangling triggers');
    }
  } finally {
    db.close();
  }
  assert.deepEqual(withJournal(path, (read) => listMemoryClaims(read)), []);
});

test('a v4 journal migrates to v5 and keeps its rows', () => {
  const path = journalFile('v4-read');
  createV4Journal(path);
  assert.equal(schemaVersion(path), 4);
  assert.equal(
    queryRow(path, "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'memory_claims'")?.count,
    0,
  );

  const migrated = openJournal(path);
  try {
    assert.equal(
      (migrated.prepare('SELECT version FROM schema_version').get() as { version: number }).version,
      JOURNAL_SCHEMA_VERSION,
    );
    assert.equal(tableCountIn(migrated, 'memory_claims'), 1);
    assert.equal(
      (migrated.prepare("SELECT title FROM activities WHERE source_key = 'legacy-card'").get() as { title: string }).title,
      'Legacy activity',
    );
    assert.equal(
      (migrated.prepare('SELECT title FROM review_items').get() as { title: string }).title,
      'A legacy distillation',
    );
    assert.equal(
      (migrated.prepare('SELECT title FROM long_tasks').get() as { title: string }).title,
      'A legacy task',
    );
    assert.deepEqual(migrated.prepare('SELECT * FROM memory_claims').all(), []);
    assert.deepEqual(ftsTriggersIn(migrated), hasFtsIndex(migrated) ? ['memory_claims_ad', 'memory_claims_ai', 'memory_claims_au'] : []);
  } finally {
    migrated.close();
  }
});

test('the read path and the write path both upgrade a v4 journal', () => {
  const readPath = journalFile('v4-readiness');
  createV4Journal(readPath);
  assert.deepEqual(withJournal(readPath, (db) => listMemoryClaims(db)), []);
  assert.equal(schemaVersion(readPath), JOURNAL_SCHEMA_VERSION);
  assert.equal(
    withJournal(readPath, (db) => (db.prepare("SELECT title FROM activities WHERE source_key = 'legacy-card'").get() as Row).title),
    'Legacy activity',
  );

  const writePath = journalFile('v4-write');
  createV4Journal(writePath);
  const claim = withJournalWrite(writePath, (db) =>
    addMemoryClaim(db, {
      kind: 'distillation',
      subject: 'Created after the upgrade',
      body: 'The memory table was added by migration 5.',
      observed_on: '2026-01-06',
    }),
  );
  assert.equal(claim.id, 1);
  assert.equal(claim.kind, 'distillation');
  assert.equal(schemaVersion(writePath), JOURNAL_SCHEMA_VERSION);
  assert.equal(queryRow(writePath, 'SELECT title FROM review_items')?.title, 'A legacy distillation');
  assert.equal(queryRow(writePath, 'SELECT title FROM long_tasks')?.title, 'A legacy task');
});

test('add, list, and search round-trip and filter', () => {
  const path = journalFile('search');
  withJournalWrite(path, (db) => {
    const preference = addMemoryClaim(db, {
      kind: 'preference',
      subject: '  Testing workflow  ',
      body: '  On 2026-10-19, the user prefers writing the test before the implementation.  ',
      observed_on: '2026-10-19',
      confidence: 0.8,
    });
    assert.equal(preference.id, 1);
    assert.equal(preference.kind, 'preference');
    assert.equal(preference.subject, 'Testing workflow', 'the subject is trimmed before it is stored');
    assert.equal(preference.body, 'On 2026-10-19, the user prefers writing the test before the implementation.');
    assert.equal(preference.observed_on, '2026-10-19');
    assert.equal(preference.confidence, 0.8);
    assert.ok(preference.recorded_at.length > 0, 'recorded_at is the write timestamp');
    assert.equal(preference.superseded_by, undefined);
    assert.equal(preference.superseded_on, undefined);
    assert.equal(preference.source_review_item, undefined);
    assert.equal(preference.source_days, undefined);

    const loop = addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Standup drift',
      body: 'The standup draft repeats yesterday and slides past noon.',
      observed_on: '2026-10-18',
      source_review_item: 7,
      source_days: ['2026-10-17', '2026-10-18'],
    });
    assert.equal(loop.confidence, 0.7, 'confidence defaults to 0.7');
    assert.equal(loop.source_review_item, 7);
    assert.deepEqual(loop.source_days, ['2026-10-17', '2026-10-18']);

    // Chinese text must be searchable too, both as a subject and inside the body.
    const correction = addMemoryClaim(db, {
      kind: 'correction',
      subject: '用户偏好',
      body: '今天，用户更喜欢先写测试。',
      observed_on: '2026-10-17',
    });

    assert.deepEqual(
      listMemoryClaims(db).map((claim) => claim.id),
      [preference.id, loop.id, correction.id],
      'newest observation first',
    );
    assert.deepEqual(
      listMemoryClaims(db, { subject: 'Testing workflow' }).map((claim) => claim.id),
      [preference.id],
      'the subject filter is an exact match',
    );
    assert.deepEqual(
      listMemoryClaims(db, { subject: '  Testing workflow  ' }).map((claim) => claim.id),
      [preference.id],
      'the subject filter is trimmed',
    );
    assert.deepEqual(listMemoryClaims(db, { subject: 'testing workflow' }), []);
    assert.deepEqual(
      listMemoryClaims(db, { kind: 'loop' }).map((claim) => claim.id),
      [loop.id],
    );
    assert.deepEqual(
      listMemoryClaims(db, { subject: 'Testing workflow', kind: 'loop' }),
      [],
      'filters combine',
    );
    assert.equal(listMemoryClaims(db, { limit: 2 }).length, 2);
    assert.equal(listMemoryClaims(db, { limit: MEMORY_MAX_LIMIT }).length, 3);

    assert.deepEqual(
      searchMemoryClaims(db, 'prefers').map((claim) => claim.id),
      [preference.id],
      'a body token matches',
    );
    assert.deepEqual(
      searchMemoryClaims(db, 'PREFERS').map((claim) => claim.id),
      [preference.id],
      'search is case-insensitive',
    );
    assert.deepEqual(
      searchMemoryClaims(db, 'Testing workflow').map((claim) => claim.id),
      [preference.id],
      'every query token must match (subject tokens included)',
    );
    assert.deepEqual(
      searchMemoryClaims(db, 'standup repeats').map((claim) => claim.id),
      [loop.id],
      'tokens may come from different words of the body',
    );
    assert.deepEqual(
      searchMemoryClaims(db, 'standup prefers').map((claim) => claim.id),
      [],
      'tokens are ANDed, never ORed',
    );
    assert.deepEqual(
      searchMemoryClaims(db, '今天').map((claim) => claim.id),
      [correction.id],
      'a Chinese body token matches',
    );
    assert.deepEqual(
      searchMemoryClaims(db, '用户偏好').map((claim) => claim.id),
      [correction.id],
      'a Chinese subject token matches',
    );
    assert.deepEqual(
      searchMemoryClaims(db, 'user', { kind: 'loop' }),
      [],
      'search kind filter excludes claims of other kinds',
    );
    assert.deepEqual(
      searchMemoryClaims(db, 'nonexistent').map((claim) => claim.id),
      [],
    );
    assert.equal(searchMemoryClaims(db, 'user', { limit: 1 }).length, 1);

    assert.throws(() => searchMemoryClaims(db, ''), isInvalidInput);
    assert.throws(() => searchMemoryClaims(db, '   '), isInvalidInput);
    assert.throws(() => searchMemoryClaims(db, 'user', { limit: 0 }), isInvalidInput);
    assert.throws(() => searchMemoryClaims(db, 'user', { limit: MEMORY_MAX_LIMIT + 1 }), isInvalidInput);
    assert.throws(() => searchMemoryClaims(db, 'user', { limit: 1.5 }), isInvalidInput);
    assert.throws(() => searchMemoryClaims(db, 'user', { kind: 'idea' as unknown as MemoryClaimKind }), isInvalidInput);
    assert.throws(() => listMemoryClaims(db, { limit: 0 }), isInvalidInput);
    assert.throws(() => listMemoryClaims(db, { limit: MEMORY_MAX_LIMIT + 1 }), isInvalidInput);
    assert.throws(() => listMemoryClaims(db, { kind: 'idea' as unknown as MemoryClaimKind }), isInvalidInput);
  });
});

test('search escapes LIKE wildcards instead of treating them as patterns', () => {
  const path = journalFile('wildcards');
  withJournalWrite(path, (db) => {
    const percent = addMemoryClaim(db, {
      kind: 'distillation',
      subject: 'Coverage milestone',
      body: 'The test suite reached 100% coverage on 2026-10-18.',
      observed_on: '2026-10-18',
    });
    addMemoryClaim(db, {
      kind: 'distillation',
      subject: 'Another distillation',
      body: 'Something unrelated happened on 2026-10-19.',
      observed_on: '2026-10-19',
    });
    // A lone wildcard is a literal substring, not "match everything".
    assert.deepEqual(
      searchMemoryClaims(db, '%', { include_superseded: true }).map((claim) => claim.id),
      [percent.id],
    );
    assert.deepEqual(
      searchMemoryClaims(db, '100%').map((claim) => claim.id),
      [percent.id],
    );
  });
});

test('search falls back to LIKE when the FTS5 index is absent', () => {
  const path = journalFile('like-fallback');
  withJournalWrite(path, (db) => {
    const first = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Review cadence',
      body: 'The user prefers a short review on Friday afternoons.',
      observed_on: '2026-10-16',
    });
    addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Standup drift',
      body: 'The standup draft repeats yesterday.',
      observed_on: '2026-10-17',
      source_days: ['2026-10-16', '2026-10-17'],
    });
    // Force the no-FTS case even on a Node build that has FTS5: a Node 22 build
    // without the module never creates these objects in the first place.
    db.exec(`
      DROP TRIGGER IF EXISTS memory_claims_ai;
      DROP TRIGGER IF EXISTS memory_claims_ad;
      DROP TRIGGER IF EXISTS memory_claims_au;
      DROP TABLE IF EXISTS memory_claims_fts;
    `);
    assert.equal(tableCountIn(db, 'memory_claims_fts'), 0);

    assert.deepEqual(searchMemoryClaims(db, 'FRIDAY').map((claim) => claim.id), [first.id]);
    assert.deepEqual(searchMemoryClaims(db, 'standup repeats').map((claim) => claim.id), [2]);
    assert.deepEqual(searchMemoryClaims(db, 'standup friday'), []);
    assert.deepEqual(listMemoryClaims(db, {}).map((claim) => claim.id), [2, first.id]);
  });
});

test('supersede appends a new claim and keeps the old row as history', () => {
  const path = journalFile('supersede');
  withJournalWrite(path, (db) => {
    const original = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Planning',
      body: 'The user plans the week in a paper notebook.',
      observed_on: '2026-10-01',
      confidence: 0.8,
      source_review_item: 3,
      source_days: ['2026-09-30', '2026-10-01'],
    });
    const updated = supersedeMemoryClaim(db, original.id, {
      body: 'The user plans the week in the Dayflow panel.',
      observed_on: '2026-10-19',
    });
    assert.equal(updated.id > original.id, true);
    assert.equal(updated.kind, 'preference', 'kind defaults to the old claim kind');
    assert.equal(updated.subject, 'Planning', 'subject defaults to the old subject');
    assert.equal(updated.confidence, 0.8, 'confidence carries over');
    assert.equal(updated.source_review_item, 3, 'review-item provenance carries over');
    assert.deepEqual(updated.source_days, ['2026-09-30', '2026-10-01']);
    assert.equal(updated.superseded_by, undefined);
    assert.equal(updated.superseded_on, undefined);

    const history = listMemoryClaims(db, { include_superseded: true });
    assert.deepEqual(
      history.map((claim) => claim.id),
      [updated.id, original.id],
      'the old row is still there',
    );
    const old = history[1];
    assert.equal(old?.superseded_by, updated.id);
    assert.equal(old?.superseded_on, '2026-10-19');
    assert.equal(old?.body, 'The user plans the week in a paper notebook.', 'the old body is never rewritten');

    assert.deepEqual(listMemoryClaims(db).map((claim) => claim.id), [updated.id]);
    assert.deepEqual(
      searchMemoryClaims(db, 'notebook').map((claim) => claim.id),
      [],
      'default search hides superseded claims',
    );
    assert.deepEqual(
      searchMemoryClaims(db, 'notebook', { include_superseded: true }).map((claim) => claim.id),
      [original.id],
    );
    assert.deepEqual(
      searchMemoryClaims(db, 'Dayflow panel').map((claim) => claim.id),
      [updated.id],
    );

    // A supersede may restate the grouping key and the evidence strength.
    const renamed = supersedeMemoryClaim(db, updated.id, {
      body: 'The user plans the week in the Dayflow panel and the task list.',
      observed_on: '2026-10-20',
      subject: 'Planning tools',
      confidence: 0.6,
      source_days: ['2026-10-19'],
    });
    assert.equal(renamed.subject, 'Planning tools');
    assert.equal(renamed.kind, 'preference');
    assert.equal(renamed.confidence, 0.6);
    assert.deepEqual(renamed.source_days, ['2026-10-19']);
    assert.deepEqual(listMemoryClaims(db).map((claim) => claim.id), [renamed.id]);
    const chain = listMemoryClaims(db, { include_superseded: true });
    assert.deepEqual(chain.map((claim) => claim.id), [renamed.id, updated.id, original.id]);
    assert.equal(chain[1]?.superseded_by, renamed.id);
    assert.equal(chain[1]?.superseded_on, '2026-10-20');

    assert.throws(
      () => supersedeMemoryClaim(db, original.id, { body: 'Again', observed_on: '2026-10-21' }),
      isInvalidInput,
      'a claim that was already superseded cannot be superseded again',
    );
    assert.throws(() => supersedeMemoryClaim(db, 999, { body: 'Missing', observed_on: '2026-10-21' }), isNotFound);
    assert.throws(
      () => supersedeMemoryClaim(db, renamed.id, { body: '   ', observed_on: '2026-10-21' }),
      isInvalidInput,
    );
    assert.throws(
      () => supersedeMemoryClaim(db, renamed.id, { body: 'Future', observed_on: dayKeyOffset(1) }),
      isInvalidInput,
    );
    assert.throws(
      () => supersedeMemoryClaim(db, renamed.id, { body: 'Bad kind', observed_on: '2026-10-21', kind: 'idea' as unknown as MemoryClaimKind }),
      isInvalidInput,
    );
    assert.equal(claimCountIn(db), 3, 'failed supersedes write nothing');
    assert.deepEqual(listMemoryClaims(db).map((claim) => claim.id), [renamed.id]);
  });
});

test('forget deletes a claim and refuses to break a supersede chain', () => {
  const path = journalFile('forget');
  withJournalWrite(path, (db) => {
    const first = addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Inbox loop',
      body: 'The user clears the inbox every morning.',
      observed_on: '2026-10-10',
    });
    const second = supersedeMemoryClaim(db, first.id, {
      body: 'The user clears the inbox every Friday.',
      observed_on: '2026-10-16',
    });
    assert.throws(
      () => forgetMemoryClaim(db, second.id),
      isInvalidInput,
      'the newer claim is still the successor of the older one',
    );
    assert.equal(claimCountIn(db), 2, 'the refused forget deletes nothing');

    forgetMemoryClaim(db, first.id);
    assert.deepEqual(
      listMemoryClaims(db, { include_superseded: true }).map((claim) => claim.id),
      [second.id],
    );
    forgetMemoryClaim(db, second.id);
    assert.deepEqual(listMemoryClaims(db, { include_superseded: true }), []);
    assert.deepEqual(searchMemoryClaims(db, 'inbox', { include_superseded: true }), []);

    assert.throws(() => forgetMemoryClaim(db, 999), isNotFound);
    assert.throws(() => forgetMemoryClaim(db, 0), isNotFound);

    const standalone = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Lunch',
      body: 'The user prefers a late lunch.',
      observed_on: '2026-10-11',
    });
    forgetMemoryClaim(db, standalone.id);
    assert.deepEqual(searchMemoryClaims(db, 'lunch'), []);

    if (hasFtsIndex(db)) {
      assert.equal(ftsRowCount(db), 0, 'the FTS index drops forgotten text with the row');
    }
  });
});

test('claim validation rejects impossible dates, empty text, and bad confidence', () => {
  const path = journalFile('validation');
  withJournalWrite(path, (db) => {
    const base = {
      kind: 'preference' as const,
      subject: 'Subject',
      body: 'Body',
      observed_on: '2026-10-19',
    };
    assert.throws(() => addMemoryClaim(db, { ...base, observed_on: dayKeyOffset(1) }), isInvalidInput, 'future observations are rejected');
    assert.throws(() => addMemoryClaim(db, { ...base, observed_on: dayKeyOffset(30) }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, observed_on: '2026-02-30' }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, observed_on: '10/19/2026' }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, observed_on: '' }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, observed_on: 20261019 as unknown as string }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, subject: '   ' }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, body: '   ' }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, subject: 7 as unknown as string }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, kind: 'idea' as unknown as MemoryClaimKind }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, confidence: -0.1 }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, confidence: 1.5 }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, confidence: Number.NaN }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, confidence: '0.5' as unknown as number }), isInvalidInput);
    assert.throws(() => addMemoryClaim(db, { ...base, source_review_item: 1.5 }), isInvalidInput);
    assert.throws(
      () => addMemoryClaim(db, { ...base, source_days: ['2026-10-18', '2026-02-30'] }),
      isInvalidInput,
    );
    assert.throws(
      () => addMemoryClaim(db, { ...base, source_days: '2026-10-18' as unknown as string[] }),
      isInvalidInput,
    );
    assert.deepEqual(listMemoryClaims(db, { include_superseded: true }), [], 'failed appends must not be written');

    // Today is accepted; evidence days are real days, de-duplicated, order kept.
    const todayClaim = addMemoryClaim(db, { ...base, observed_on: formatDayKey(new Date()) });
    assert.equal(todayClaim.observed_on, formatDayKey(new Date()));
    const withDays = addMemoryClaim(db, {
      ...base,
      observed_on: '2026-10-18',
      source_days: ['2026-10-18', '2026-10-18', '2026-10-19'],
    });
    assert.deepEqual(withDays.source_days, ['2026-10-18', '2026-10-19']);
  });
});

test('createMemoryFromReviewItem maps a kept proposal onto a claim', () => {
  const path = journalFile('review-item');
  withJournalWrite(path, (db) => {
    const claim = createMemoryFromReviewItem(db, {
      id: 12,
      kind: 'distillation',
      title: 'Deep work happens before noon',
      body: 'On 2026-10-12, the deepest work happened before 11:00.',
      source_day: '2026-10-12',
      confidence: 0.9,
    });
    assert.equal(claim.kind, 'distillation');
    assert.equal(claim.subject, 'Deep work happens before noon');
    assert.equal(claim.body, 'On 2026-10-12, the deepest work happened before 11:00.');
    assert.equal(claim.observed_on, '2026-10-12');
    assert.equal(claim.source_review_item, 12);
    assert.deepEqual(claim.source_days, ['2026-10-12']);
    assert.equal(claim.confidence, 0.9);

    // A proposal without a body keeps its title as the claim; without a source
    // day the claim is observed today.
    const loop = createMemoryFromReviewItem(db, {
      id: 13,
      kind: 'loop',
      title: 'The standup draft repeats yesterday',
      body: '   ',
      confidence: 0.7,
    });
    assert.equal(loop.kind, 'loop');
    assert.equal(loop.body, 'The standup draft repeats yesterday');
    assert.equal(loop.observed_on, formatDayKey(new Date()));
    assert.equal(loop.source_days, undefined);
    assert.equal(loop.source_review_item, 13);

    assert.deepEqual(
      listMemoryClaims(db, { kind: 'distillation' }).map((item) => item.id),
      [claim.id],
    );
    assert.deepEqual(
      searchMemoryClaims(db, 'noon').map((item) => item.id),
      [claim.id],
    );
    assert.throws(
      () =>
        createMemoryFromReviewItem(db, {
          id: 14,
          kind: 'distillation',
          title: 'Future evidence',
          body: 'Not possible yet.',
          source_day: dayKeyOffset(1),
          confidence: 0.8,
        }),
      isInvalidInput,
      'a source day in the future is not a past observation',
    );
  });
});

test('the optional FTS5 index stays in sync with the claim table', () => {
  const path = journalFile('fts-sync');
  const db = openJournal(path);
  try {
    if (!hasFtsIndex(db)) {
      // A Node build without FTS5 never creates the index. Search still works
      // (covered by the LIKE fallback test), so there is nothing to assert here.
      assert.deepEqual(ftsTriggersIn(db), []);
      return;
    }
    assert.deepEqual(ftsTriggersIn(db), ['memory_claims_ad', 'memory_claims_ai', 'memory_claims_au']);
    const original = addMemoryClaim(db, {
      kind: 'distillation',
      subject: 'FTS subject',
      body: 'The index sees this body.',
      observed_on: '2026-10-18',
    });
    assert.equal(ftsRowCount(db), 1, 'the insert trigger indexed the new claim');
    const updated = supersedeMemoryClaim(db, original.id, {
      body: 'The index sees the corrected body.',
      observed_on: '2026-10-19',
    });
    assert.equal(ftsRowCount(db), 2, 'a supersede is a new row, so the index grows');
    forgetMemoryClaim(db, original.id);
    assert.equal(ftsRowCount(db), 1);
    forgetMemoryClaim(db, updated.id);
    assert.equal(ftsRowCount(db), 0);
    assert.deepEqual(searchMemoryClaims(db, 'corrected', { include_superseded: true }), []);
  } finally {
    db.close();
  }
});
