/**
 * Owned journal schema v6 (reflections) and the reflections-store semantics.
 *
 * A reflection is the user's own written summary of one Dayflow day or one
 * Monday-to-Monday week. The store normalizes the period (a week always lands on
 * its Monday), keeps `(kind, period_key)` unique so saving again rewrites the
 * summary instead of duplicating it, and treats the optional JSON evidence
 * columns as best-effort: missing or corrupt JSON reads back as an empty list.
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

import { DayflowError } from '../src/errors.js';
import { JOURNAL_SCHEMA_VERSION, openJournal, withJournal, withJournalWrite } from '../src/journal.js';
import {
  REFLECTION_DEFAULT_LIMIT,
  REFLECTION_MAX_BODY_CHARS,
  REFLECTION_MAX_LIMIT,
  deleteReflection,
  getReflection,
  listReflections,
  normalizeReflectionPeriod,
  saveReflection,
} from '../src/reflections.js';
import type { ReflectionKind } from '../src/reflections.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-reflections-store-'));
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

function reflectionCountIn(db: DatabaseSync): number {
  return Number((db.prepare('SELECT count(*) AS count FROM reflections').get() as Row).count);
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

/**
 * Build a v5-shaped journal: the current file with `reflections` dropped and the
 * version rewound to 5. This is exactly what an installed 0.6.x journal looks
 * like before migration 6.
 */
function createV5Journal(path: string): void {
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
    db.prepare(
      `INSERT INTO memory_claims (kind, subject, body, observed_on)
       VALUES ('preference', 'Legacy subject', 'Legacy claim', '2026-01-04')`,
    ).run();
    db.exec('DROP TABLE IF EXISTS reflections');
    db.prepare('UPDATE schema_version SET version = 5').run();
  } finally {
    db.close();
  }
}

test('a new journal migrates to schema v6 with the reflections table and index', () => {
  const path = journalFile('fresh');
  const db = openJournal(path);
  try {
    const version = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    assert.ok(JOURNAL_SCHEMA_VERSION >= 6, 'the reflections store needs at least schema v6');
    assert.equal(version?.version, JOURNAL_SCHEMA_VERSION);
    assert.equal(tableCountIn(db, 'reflections'), 1);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'reflections%' ORDER BY name")
      .all() as { name: string }[];
    assert.deepEqual(
      indexes.map((row) => row.name),
      ['reflections_period_idx'],
    );
    assert.deepEqual(db.prepare('SELECT * FROM reflections').all(), []);
  } finally {
    db.close();
  }
  assert.deepEqual(withJournal(path, (read) => listReflections(read)), []);
});

test('a v5 journal migrates to v6 and keeps its rows', () => {
  const path = journalFile('v5-read');
  createV5Journal(path);
  assert.equal(schemaVersion(path), 5);
  assert.equal(
    queryRow(path, "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'reflections'")?.count,
    0,
    'reflections must not exist before the migration',
  );

  const migrated = openJournal(path);
  try {
    assert.equal(
      (migrated.prepare('SELECT version FROM schema_version').get() as { version: number }).version,
      JOURNAL_SCHEMA_VERSION,
    );
    assert.equal(tableCountIn(migrated, 'reflections'), 1);
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
    assert.equal(
      (migrated.prepare('SELECT subject FROM memory_claims').get() as { subject: string }).subject,
      'Legacy subject',
    );
    assert.deepEqual(migrated.prepare('SELECT * FROM reflections').all(), []);
  } finally {
    migrated.close();
  }
});

test('the read path and the write path both upgrade a v5 journal', () => {
  const readPath = journalFile('v5-readiness');
  createV5Journal(readPath);
  assert.deepEqual(withJournal(readPath, (db) => listReflections(db)), []);
  assert.equal(schemaVersion(readPath), JOURNAL_SCHEMA_VERSION);
  assert.equal(
    withJournal(readPath, (db) => (db.prepare('SELECT subject FROM memory_claims').get() as Row).subject),
    'Legacy subject',
  );

  const writePath = journalFile('v5-write');
  createV5Journal(writePath);
  const reflection = withJournalWrite(writePath, (db) =>
    saveReflection(db, { kind: 'day', period: '2026-01-06', body: 'Saved after the upgrade.' }),
  );
  assert.equal(reflection.kind, 'day');
  assert.equal(reflection.period_key, '2026-01-06');
  assert.equal(schemaVersion(writePath), JOURNAL_SCHEMA_VERSION);
  assert.equal(queryRow(writePath, 'SELECT subject FROM memory_claims')?.subject, 'Legacy subject');
  assert.equal(queryRow(writePath, 'SELECT title FROM long_tasks')?.title, 'A legacy task');
});

test('save and get round-trip a day reflection, and a re-save updates it in place', () => {
  const path = journalFile('day');
  withJournalWrite(path, (db) => {
    const saved = saveReflection(db, {
      kind: 'day',
      period: '2026-10-21',
      body: '  Deep work before noon, then a long review pass.  ',
      highlights: ['  Focused morning  ', '', '   ', 'Review pass'],
      source_days: ['2026-10-20', '2026-10-21', '2026-10-20'],
      source_activity_ids: [11, 12, 13],
    });
    assert.equal(saved.id, 1);
    assert.equal(saved.kind, 'day');
    assert.equal(saved.period_key, '2026-10-21');
    assert.equal(saved.body, 'Deep work before noon, then a long review pass.');
    assert.deepEqual(saved.highlights, ['Focused morning', 'Review pass'], 'blank highlights are dropped and the rest trimmed');
    assert.deepEqual(saved.source_days, ['2026-10-20', '2026-10-21'], 'duplicate source days are dropped and order is kept');
    assert.deepEqual(saved.source_activity_ids, [11, 12, 13]);
    assert.ok(saved.created_at.length > 0);
    assert.equal(saved.created_at, saved.updated_at, 'a fresh row is created and updated together');

    assert.deepEqual(getReflection(db, 'day', '2026-10-21'), saved);
    assert.deepEqual(getReflection(db, 'day', ' 2026-10-21 '), saved, 'the period is trimmed before lookup');
    assert.equal(getReflection(db, 'day', '2026-10-22'), undefined);

    // Pin the row's clock so "created_at stays, updated_at moves" is deterministic
    // even though SQLite's CURRENT_TIMESTAMP has one-second resolution.
    db.prepare(
      "UPDATE reflections SET created_at = '2026-10-01 00:00:00', updated_at = '2026-10-01 00:00:00' WHERE id = ?",
    ).run(saved.id);
    const updated = saveReflection(db, { kind: 'day', period: '2026-10-21', body: 'Rewritten in the evening.' });
    assert.equal(updated.id, saved.id, 'a re-save reuses the row id');
    assert.equal(reflectionCountIn(db), 1, 'a re-save does not append a duplicate row');
    assert.equal(updated.body, 'Rewritten in the evening.');
    assert.equal(updated.created_at, '2026-10-01 00:00:00', 'created_at is never rewritten');
    assert.notEqual(updated.updated_at, '2026-10-01 00:00:00', 'the update stamps a fresh updated_at');
    assert.deepEqual(updated.highlights, [], 'lists omitted from a re-save are cleared');
    assert.deepEqual(updated.source_days, []);
    assert.deepEqual(updated.source_activity_ids, []);
    assert.deepEqual(getReflection(db, 'day', '2026-10-21'), updated);
  });
});

test('a week reflection is normalized to the Monday of its week', () => {
  assert.equal(normalizeReflectionPeriod('day', '2026-10-21'), '2026-10-21');
  assert.equal(normalizeReflectionPeriod('day', ' 2026-10-21 '), '2026-10-21');
  assert.equal(normalizeReflectionPeriod('week', '2026-10-21'), '2026-10-19', 'a Wednesday lands on that week Monday');
  assert.equal(normalizeReflectionPeriod('week', '2026-10-19'), '2026-10-19', 'a Monday maps to itself');
  assert.equal(normalizeReflectionPeriod('week', '2026-10-25'), '2026-10-19', 'the week Sunday keeps its Monday');
  assert.equal(normalizeReflectionPeriod('week', '2026-11-01'), '2026-10-26', 'a Sunday that starts a new month maps back to its Monday');

  const path = journalFile('week');
  withJournalWrite(path, (db) => {
    const saved = saveReflection(db, { kind: 'week', period: '2026-10-21', body: 'A steady week.' });
    assert.equal(saved.period_key, '2026-10-19');
    assert.deepEqual(getReflection(db, 'week', '2026-10-19'), saved, 'the Monday finds the week');
    assert.deepEqual(getReflection(db, 'week', '2026-10-25'), saved, 'the Sunday finds the same week');

    const resaved = saveReflection(db, { kind: 'week', period: '2026-10-25', body: 'A steady week, restated on Sunday.' });
    assert.equal(resaved.id, saved.id, 'a different day of the same week hits the same row');
    assert.equal(reflectionCountIn(db), 1);
    assert.equal(resaved.body, 'A steady week, restated on Sunday.');

    // A Monday period is the same period_key for a day and a week; the kind keeps
    // the two rows apart.
    const mondayDay = saveReflection(db, { kind: 'day', period: '2026-10-19', body: 'Monday, day by day.' });
    assert.notEqual(mondayDay.id, saved.id, 'a day and a week are different rows');
    assert.equal(reflectionCountIn(db), 2);
    assert.equal(getReflection(db, 'day', '2026-10-19')?.body, 'Monday, day by day.');
    assert.equal(getReflection(db, 'week', '2026-10-21')?.body, 'A steady week, restated on Sunday.');
    assert.deepEqual(listReflections(db, { kind: 'week' }).map((item) => item.id), [saved.id]);
    assert.deepEqual(listReflections(db, { kind: 'day' }).map((item) => item.id), [mondayDay.id]);
  });
});

test('list filters by kind, orders newest period first, and validates the limit', () => {
  const path = journalFile('list');
  withJournalWrite(path, (db) => {
    const older = saveReflection(db, { kind: 'day', period: '2026-10-19', body: 'Monday.' });
    const newest = saveReflection(db, { kind: 'day', period: '2026-10-21', body: 'Wednesday.' });
    const middle = saveReflection(db, { kind: 'day', period: '2026-10-20', body: 'Tuesday.' });
    const week = saveReflection(db, { kind: 'week', period: '2026-10-21', body: 'The week.' });

    assert.deepEqual(
      listReflections(db).map((item) => item.id),
      [newest.id, middle.id, week.id, older.id],
      'period_key DESC, then id DESC for the shared 2026-10-19 key',
    );
    assert.deepEqual(
      listReflections(db, { kind: 'day' }).map((item) => item.id),
      [newest.id, middle.id, older.id],
    );
    assert.deepEqual(listReflections(db, { kind: 'week' }).map((item) => item.id), [week.id]);
    assert.deepEqual(listReflections(db, { limit: 1 }).map((item) => item.id), [newest.id]);
    assert.equal(listReflections(db, { limit: REFLECTION_MAX_LIMIT }).length, 4);

    assert.throws(() => listReflections(db, { limit: 0 }), isInvalidInput);
    assert.throws(() => listReflections(db, { limit: REFLECTION_MAX_LIMIT + 1 }), isInvalidInput);
    assert.throws(() => listReflections(db, { limit: 1.5 }), isInvalidInput);
    assert.throws(() => listReflections(db, { limit: '5' as unknown as number }), isInvalidInput);
    assert.throws(() => listReflections(db, { kind: 'month' as unknown as ReflectionKind }), isInvalidInput);
  });
});

test('list defaults to the bounded read and pages through a larger table', () => {
  const path = journalFile('limit');
  withJournalWrite(path, (db) => {
    for (let day = 1; day <= 23; day += 1) {
      const key = `2026-09-${String(day).padStart(2, '0')}`;
      saveReflection(db, { kind: 'day', period: key, body: `Day ${String(day)}.` });
    }
    const page = listReflections(db);
    assert.equal(page.length, REFLECTION_DEFAULT_LIMIT);
    assert.equal(page[0]?.period_key, '2026-09-23', 'the newest period comes first');
    assert.equal(page.at(-1)?.period_key, '2026-09-04');
    assert.equal(listReflections(db, { limit: REFLECTION_MAX_LIMIT }).length, 23);
  });
});

test('delete removes exactly one reflection and reports whether it existed', () => {
  const path = journalFile('delete');
  withJournalWrite(path, (db) => {
    const day = saveReflection(db, { kind: 'day', period: '2026-10-21', body: 'To delete.' });
    const week = saveReflection(db, { kind: 'week', period: '2026-10-21', body: 'To keep.' });
    assert.equal(getReflection(db, 'week', '2026-10-21')?.id, week.id);

    assert.equal(deleteReflection(db, 'week', '2026-10-25'), true, 'any day of the week deletes that week');
    assert.equal(getReflection(db, 'week', '2026-10-21'), undefined);
    assert.equal(deleteReflection(db, 'week', '2026-10-21'), false, 'deleting a missing reflection reports false');
    assert.equal(getReflection(db, 'day', '2026-10-21')?.id, day.id, 'the day reflection survives deleting the week');

    assert.equal(deleteReflection(db, 'day', '2026-10-21'), true);
    assert.equal(getReflection(db, 'day', '2026-10-21'), undefined);
    assert.deepEqual(listReflections(db), []);
    assert.equal(deleteReflection(db, 'day', '2026-10-21'), false);

    assert.throws(() => deleteReflection(db, 'month' as unknown as ReflectionKind, '2026-10-21'), isInvalidInput);
    assert.throws(() => deleteReflection(db, 'day', '2026-02-30'), isInvalidInput);
  });
});

test('save validates the kind, period, body, lists, and evidence ids', () => {
  const path = journalFile('validation');
  withJournalWrite(path, (db) => {
    const base = { kind: 'day' as const, period: '2026-10-21', body: 'A valid body.' };

    assert.throws(() => saveReflection(db, { ...base, kind: 'month' as unknown as ReflectionKind }), isInvalidInput);
    assert.throws(() => saveReflection(db, { ...base, period: '2026-02-30' }), isInvalidInput, 'impossible dates are rejected');
    assert.throws(() => saveReflection(db, { ...base, period: '10/21/2026' }), isInvalidInput);
    assert.throws(() => saveReflection(db, { ...base, period: '' }), isInvalidInput);
    assert.throws(() => saveReflection(db, { ...base, period: 20261021 as unknown as string }), isInvalidInput);
    assert.throws(() => saveReflection(db, { ...base, kind: 'week' as const, period: '2026-13-01' }), isInvalidInput);

    assert.throws(() => saveReflection(db, { ...base, body: '   ' }), isInvalidInput);
    assert.throws(() => saveReflection(db, { ...base, body: 7 as unknown as string }), isInvalidInput);
    assert.throws(
      () => saveReflection(db, { ...base, body: 'x'.repeat(REFLECTION_MAX_BODY_CHARS + 1) }),
      isInvalidInput,
      'bodies longer than the cap are rejected',
    );

    assert.throws(() => saveReflection(db, { ...base, highlights: 'nope' as unknown as string[] }), isInvalidInput);
    assert.throws(() => saveReflection(db, { ...base, highlights: ['ok', 7] as unknown as string[] }), isInvalidInput);
    assert.throws(
      () => saveReflection(db, { ...base, highlights: Array.from({ length: 21 }, (_, index) => `h${String(index)}`) }),
      isInvalidInput,
      'at most 20 highlights',
    );
    assert.throws(() => saveReflection(db, { ...base, highlights: ['x'.repeat(201)] }), isInvalidInput);

    assert.throws(() => saveReflection(db, { ...base, source_days: ['2026-10-18', '2026-02-30'] }), isInvalidInput);
    assert.throws(() => saveReflection(db, { ...base, source_days: '2026-10-18' as unknown as string[] }), isInvalidInput);
    assert.throws(() => saveReflection(db, { ...base, source_activity_ids: [1, 2.5] }), isInvalidInput);
    assert.throws(
      () => saveReflection(db, { ...base, source_activity_ids: ['1'] as unknown as number[] }),
      isInvalidInput,
    );
    assert.throws(() => saveReflection(db, { ...base, source_activity_ids: 1 as unknown as number[] }), isInvalidInput);

    assert.equal(reflectionCountIn(db), 0, 'failed saves write nothing');

    assert.throws(() => normalizeReflectionPeriod('month' as unknown as ReflectionKind, '2026-10-21'), isInvalidInput);
    assert.throws(() => normalizeReflectionPeriod('day', 'not-a-day'), isInvalidInput);
    assert.throws(() => getReflection(db, 'day', '2026-02-30'), isInvalidInput);

    const longest = saveReflection(db, { ...base, body: ` ${'x'.repeat(REFLECTION_MAX_BODY_CHARS)} ` });
    assert.equal(longest.body.length, REFLECTION_MAX_BODY_CHARS, 'the cap applies to the trimmed body');

    const withEvidence = saveReflection(db, {
      ...base,
      source_days: ['2026-10-19', '2026-10-18', '2026-10-19'],
      source_activity_ids: [3, 4],
    });
    assert.deepEqual(withEvidence.source_days, ['2026-10-19', '2026-10-18']);
    assert.deepEqual(withEvidence.source_activity_ids, [3, 4]);
  });
});

test('the JSON columns round-trip their arrays and degrade to [] when corrupt', () => {
  const path = journalFile('json');
  withJournalWrite(path, (db) => {
    const saved = saveReflection(db, {
      kind: 'day',
      period: '2026-10-21',
      body: 'JSON round-trip.',
      highlights: ['First', 'Second'],
      source_days: ['2026-10-20'],
      source_activity_ids: [41, 42],
    });
    const reread = getReflection(db, 'day', '2026-10-21');
    assert.equal(reread?.id, saved.id);
    assert.deepEqual(reread?.highlights, ['First', 'Second']);
    assert.deepEqual(reread?.source_days, ['2026-10-20']);
    assert.deepEqual(reread?.source_activity_ids, [41, 42]);

    // Corrupt JSON, a non-array JSON value, and JSON null all read back as [].
    db.prepare(
      `UPDATE reflections
          SET highlights_json = '{not json',
              source_days_json = '{"not":"an array"}',
              source_activity_ids_json = 'null'
        WHERE id = ?`,
    ).run(saved.id);
    const corrupt = getReflection(db, 'day', '2026-10-21');
    assert.deepEqual(corrupt?.highlights, []);
    assert.deepEqual(corrupt?.source_days, []);
    assert.deepEqual(corrupt?.source_activity_ids, []);
    assert.equal(corrupt?.body, 'JSON round-trip.', 'a corrupt evidence column does not lose the body');

    // A JSON array with unusable entries keeps only the entries of the right type.
    db.prepare(
      `UPDATE reflections
          SET highlights_json = '["kept", 7, null]',
              source_days_json = '["2026-10-20", 3]',
              source_activity_ids_json = '[1, "2", 3.5, 4]'
        WHERE id = ?`,
    ).run(saved.id);
    const mixed = getReflection(db, 'day', '2026-10-21');
    assert.deepEqual(mixed?.highlights, ['kept']);
    assert.deepEqual(mixed?.source_days, ['2026-10-20']);
    assert.deepEqual(mixed?.source_activity_ids, [1, 4]);

    // NULL columns mean "no evidence", not a failure.
    db.prepare(
      'UPDATE reflections SET highlights_json = NULL, source_days_json = NULL, source_activity_ids_json = NULL WHERE id = ?',
    ).run(saved.id);
    const empty = getReflection(db, 'day', '2026-10-21');
    assert.deepEqual(empty?.highlights, []);
    assert.deepEqual(empty?.source_days, []);
    assert.deepEqual(empty?.source_activity_ids, []);
  });
});

test('a hand-written row is readable and the table enforces the kind check', () => {
  const path = journalFile('raw');
  const db = openJournal(path);
  try {
    db.prepare(
      `INSERT INTO reflections (kind, period_key, body, highlights_json)
       VALUES ('week', '2026-10-19', 'Written by hand.', '["one"]')`,
    ).run();
    const row = getReflection(db, 'week', '2026-10-21');
    assert.equal(row?.body, 'Written by hand.');
    assert.deepEqual(row?.highlights, ['one']);
    assert.deepEqual(row?.source_days, []);
    assert.deepEqual(row?.source_activity_ids, []);
    assert.ok((row?.created_at.length ?? 0) > 0);

    // The store rejects an unknown kind as input...
    assert.throws(
      () => saveReflection(db, { kind: 'year' as unknown as ReflectionKind, period: '2026-10-21', body: 'X' }),
      isInvalidInput,
    );
    // ...and the table itself only admits day and week, even for a writer that
    // bypasses the store.
    assert.throws(
      () => db.prepare("INSERT INTO reflections (kind, period_key, body) VALUES ('year', '2026-10-19', 'X')").run(),
      (error: unknown) => error instanceof Error,
    );
    assert.equal(reflectionCountIn(db), 1, 'the rejected insert wrote nothing');
  } finally {
    db.close();
  }
});
