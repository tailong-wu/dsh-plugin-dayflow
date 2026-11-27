/**
 * `readPanelCloses` / `listPanelCloses`: the reading view over the automation
 * ledger's recent closes.
 *
 * The scheduler records one `automation_runs` row per scheduled job — the day
 * close, the week close, and the weekly memory lint — and the panel needs their
 * recent history (status, attempts, failure text, when) to answer "did the close
 * run?". The read projects at most ten rows, newest `updated_at` first, and puts
 * no id, payload, or `created_at` on the wire.
 *
 * The case list mirrors the module's rules:
 * - the projection drops the payload and the row id, keeps the error only when
 *   non-empty, and clamps a hand-edited long error to 500 characters;
 * - the cap defaults to ten, the limit is 1-20 and anything else is a caller
 *   error, even before a journal is probed;
 * - a missing, blank, empty, or unreadable journal answers `[]` and is never
 *   created, while a malformed ledger row is a `database_error` passed up (the
 *   store's own strictness) instead of a silently shorter history;
 * - repeated reads agree and leave the journal byte-for-byte unchanged.
 *
 * Every case runs against a disposable journal under `mkdtemp`; no case opens a
 * network connection, calls a model, or reaches the default `$DSH_HOME` journal.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { DatabaseSync } from 'node:sqlite';

import {
  PANEL_CLOSE_DEFAULT_LIMIT,
  PANEL_CLOSE_MAX_LIMIT,
  listPanelCloses,
  readPanelCloses,
} from '../src/automation/read.js';
import type { PanelCloseSummary } from '../src/automation/read.js';
import { AUTOMATION_MAX_ERROR_CHARS } from '../src/automation/store.js';
import { DayflowError } from '../src/errors.js';
import type { DayflowErrorCode } from '../src/errors.js';
import { openJournal, withJournal, withJournalWrite } from '../src/journal.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-automation-read-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let fileCounter = 0;

/** A fresh journal path inside the disposable directory. */
function journalFile(label: string): string {
  fileCounter += 1;
  return join(directory, `${label}-${fileCounter}.sqlite`);
}

/** Create a migrated, empty journal and return its path. */
function createJournal(label = 'journal'): string {
  const path = journalFile(label);
  openJournal(path).close();
  return path;
}

/** One `automation_runs` row to seed; timestamps are explicit so ordering is deterministic. */
interface CloseSeed {
  job: 'day_close' | 'week_close' | 'lint';
  day: string;
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
  attempts?: number;
  /** The stored failure message or skip reason; `null` stores none. */
  error?: string | null;
  /** The object stored as `payload_json`; omitted stores NULL. */
  payload?: unknown;
  /** `created_at` and `updated_at`; defaults to the seeded day at 06:00. */
  updatedAt?: string;
}

/** Seed one `automation_runs` row and return its id. */
function seedClose(path: string, seed: CloseSeed): number {
  const updatedAt = seed.updatedAt ?? `${seed.day} 06:00:00`;
  let id = 0;
  withJournalWrite(path, (db) => {
    const inserted = db
      .prepare(
        `INSERT INTO automation_runs (job, day, status, attempts, error, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seed.job,
        seed.day,
        seed.status,
        seed.attempts ?? 0,
        seed.error ?? null,
        seed.payload === undefined ? null : JSON.stringify(seed.payload),
        updatedAt,
        updatedAt,
      );
    id = Number(inserted.lastInsertRowid);
  });
  return id;
}

type Row = Record<string, unknown>;

/** Read rows with one short-lived raw connection. */
function readAll(path: string, sql: string): Row[] {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).all() as Row[];
  } finally {
    db.close();
  }
}

/** SHA-256 of one file's bytes, used to prove a read changed nothing. */
function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

function isDatabaseError(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'database_error';
}

/** Run one assertion with a Dayflow failure code. */
function expectCode(run: () => unknown, code: DayflowErrorCode): void {
  assert.throws(run, (error: unknown) => error instanceof DayflowError && error.code === code);
}

/**
 * Seed twelve runs with increasing `updated_at`, so the default cap of ten has
 * one row in and two rows out. The job mix covers every status and the three
 * scheduled jobs; the blank error on the 11th row is stored blank and must read
 * back as no error at all.
 */
const MANY_CLOSES: CloseSeed[] = [
  { job: 'day_close', day: '2026-11-01', status: 'complete', attempts: 1 },
  { job: 'lint', day: '2026-11-02', status: 'complete', attempts: 1 },
  { job: 'lint', day: '2026-11-03', status: 'complete', attempts: 1 },
  { job: 'day_close', day: '2026-11-04', status: 'skipped', error: 'automation disabled' },
  { job: 'day_close', day: '2026-11-05', status: 'failed', attempts: 1, error: 'the model timed out' },
  { job: 'week_close', day: '2026-11-09', status: 'failed', attempts: 2, error: 'provider unavailable' },
  { job: 'lint', day: '2026-11-10', status: 'skipped', error: 'no memory claims' },
  { job: 'day_close', day: '2026-11-11', status: 'complete', attempts: 1, error: '   ' },
  { job: 'lint', day: '2026-11-12', status: 'complete', attempts: 1 },
  { job: 'day_close', day: '2026-11-13', status: 'running', attempts: 1 },
  {
    job: 'week_close',
    day: '2026-11-16',
    status: 'complete',
    attempts: 1,
    payload: { memory_health: { findings: 2, proposals: 1, summary: 'nothing to report.' } },
  },
  { job: 'day_close', day: '2026-11-17', status: 'pending' },
];

/** Seed the twelve-run fixture. */
function seedManyCloses(path: string): void {
  for (const seed of MANY_CLOSES) seedClose(path, seed);
}

test('the recent closes map to the panel summary, newest updated_at first', () => {
  const journalPath = createJournal('mapping');
  seedManyCloses(journalPath);

  const closes = withJournal(journalPath, (db) => readPanelCloses(db));

  assert.equal(closes.length, PANEL_CLOSE_DEFAULT_LIMIT, 'the default cap is ten');
  // updated_at descending: the two oldest rows fall outside the list.
  assert.deepEqual(
    closes.map((close) => close.day),
    [
      '2026-11-17',
      '2026-11-16',
      '2026-11-13',
      '2026-11-12',
      '2026-11-11',
      '2026-11-10',
      '2026-11-09',
      '2026-11-05',
      '2026-11-04',
      '2026-11-03',
    ],
  );

  // The complete/absent-error row maps field for field, with no `error` key.
  const complete: PanelCloseSummary = {
    job: 'day_close',
    day: '2026-11-11',
    status: 'complete',
    attempts: 1,
    updated_at: '2026-11-11 06:00:00',
  };
  assert.deepEqual(closes.find((close) => close.day === '2026-11-11'), complete);
  assert.ok(!('error' in complete), 'a complete row keeps no error key');

  // A failure keeps its attempts count and its bounded message.
  assert.deepEqual(closes.find((close) => close.day === '2026-11-09'), {
    job: 'week_close',
    day: '2026-11-09',
    status: 'failed',
    attempts: 2,
    error: 'provider unavailable',
    updated_at: '2026-11-09 06:00:00',
  });

  // A skip carries its reason in `error`, exactly like the store records it.
  assert.deepEqual(closes.find((close) => close.day === '2026-11-10'), {
    job: 'lint',
    day: '2026-11-10',
    status: 'skipped',
    attempts: 0,
    error: 'no memory claims',
    updated_at: '2026-11-10 06:00:00',
  });

  // The wire shape is exactly these six keys: no id, no payload, no created_at.
  const failed = closes.find((close) => close.day === '2026-11-09');
  assert.ok(failed);
  assert.deepEqual(Object.keys(failed).sort(), ['attempts', 'day', 'error', 'job', 'status', 'updated_at']);
  for (const close of closes) {
    assert.ok(!('id' in close), 'a summary carries no row id');
    assert.ok(!('payload' in close), 'a summary carries no run payload');
    assert.ok(!('created_at' in close), 'a summary carries no created_at');
  }

  // A row seeded with a JSON payload still projects without it.
  const weekClose = closes.find((close) => close.day === '2026-11-16');
  assert.ok(weekClose);
  assert.equal(weekClose.job, 'week_close');
  assert.ok(!('payload' in weekClose));
});

test('the store order is kept: updated_at descending, ties by descending id', async () => {
  const journalPath = createJournal('order');
  // Three rows with the same updated_at keep their insertion order reversed.
  seedClose(journalPath, { job: 'day_close', day: '2026-11-20', status: 'complete', updatedAt: '2026-11-24 06:00:00' });
  seedClose(journalPath, { job: 'lint', day: '2026-11-21', status: 'complete', updatedAt: '2026-11-24 06:00:00' });
  seedClose(journalPath, {
    job: 'week_close',
    day: '2026-11-22',
    status: 'complete',
    updatedAt: '2026-11-24 06:00:00',
  });
  // A later update outranks them even though its day is earlier.
  seedClose(journalPath, { job: 'day_close', day: '2026-11-01', status: 'complete', updatedAt: '2026-11-25 06:00:00' });

  const closes = await listPanelCloses(journalPath);
  assert.deepEqual(
    closes.map((close) => close.day),
    ['2026-11-01', '2026-11-22', '2026-11-21', '2026-11-20'],
  );
});

test('the limit truncates, and the cap bounds both the default and the maximum', async () => {
  assert.equal(PANEL_CLOSE_DEFAULT_LIMIT, 10);
  assert.equal(PANEL_CLOSE_MAX_LIMIT, 20);

  const journalPath = createJournal('limits');
  seedManyCloses(journalPath);

  const defaults = await listPanelCloses(journalPath);
  assert.equal(defaults.length, 10, 'the default cap is ten');

  const one = await listPanelCloses(journalPath, { limit: 1 });
  assert.equal(one.length, 1);
  assert.equal(one[0]?.day, '2026-11-17', 'the limit takes the newest closes');

  const twenty = await listPanelCloses(journalPath, { limit: PANEL_CLOSE_MAX_LIMIT });
  assert.equal(twenty.length, 12, 'a limit above the stored count returns everything');

  const db = openJournal(journalPath);
  try {
    assert.equal(readPanelCloses(db, { limit: 5 }).length, 5);
    assert.equal(readPanelCloses(db).length, 10);
  } finally {
    db.close();
  }
});

test('an invalid limit is a caller error, even without a journal', async () => {
  const journalPath = createJournal('bad-limit');
  const db = openJournal(journalPath);
  try {
    for (const limit of [0, -1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10' as unknown as number]) {
      expectCode(() => readPanelCloses(db, { limit }), 'invalid_input');
    }
    // An empty journal still answers an empty list at the default limit.
    assert.deepEqual(readPanelCloses(db), []);
  } finally {
    db.close();
  }

  for (const limit of [0, 21, 1.5]) {
    await assert.rejects(listPanelCloses(journalPath, { limit }), isInvalidInput);
  }
  // The limit is validated before the journal is probed: a caller error is not
  // hidden by a missing file.
  await assert.rejects(listPanelCloses(journalFile('no-journal'), { limit: 21 }), isInvalidInput);
});

test('an overlong stored error is clamped to the store maximum', async () => {
  assert.equal(AUTOMATION_MAX_ERROR_CHARS, 500);
  const journalPath = createJournal('long-error');
  const long = 'x'.repeat(AUTOMATION_MAX_ERROR_CHARS + 100);
  seedClose(journalPath, {
    job: 'day_close',
    day: '2026-11-20',
    status: 'failed',
    attempts: 1,
    error: long,
    updatedAt: '2026-11-20 06:00:00',
  });

  const [close] = await listPanelCloses(journalPath);
  assert.ok(close);
  assert.equal(close.error?.length, AUTOMATION_MAX_ERROR_CHARS);
  assert.equal(close.error, 'x'.repeat(AUTOMATION_MAX_ERROR_CHARS));
});

test('a missing journal answers [] and never creates the file', async () => {
  const journalPath = journalFile('absent');
  assert.equal(existsSync(journalPath), false);

  assert.deepEqual(await listPanelCloses(journalPath), []);
  assert.equal(existsSync(journalPath), false, 'a read must not create the journal');
  assert.equal(existsSync(`${journalPath}-wal`), false, 'a read must not start a WAL');
  assert.equal(existsSync(`${journalPath}-journal`), false, 'a read must not leave a rollback journal');

  // A blank path is no journal at all.
  assert.deepEqual(await listPanelCloses(''), []);
  assert.deepEqual(await listPanelCloses('   '), []);
});

test('an empty journal answers []', async () => {
  const journalPath = createJournal('empty');
  assert.deepEqual(await listPanelCloses(journalPath), []);
  assert.deepEqual(await listPanelCloses(journalPath, { limit: 1 }), []);
});

test('an unreadable journal answers [] instead of throwing', async () => {
  // A real file that is not SQLite: the Insights payload's empty-list tolerance
  // covers a fresh install, and this read covers a file it cannot open.
  const corruptPath = journalFile('corrupt');
  writeFileSync(corruptPath, 'this file is not a SQLite journal\n'.repeat(4), 'utf8');
  assert.deepEqual(await listPanelCloses(corruptPath), []);

  // A directory where the journal should be is also unopenable, not fatal.
  const directoryPath = journalFile('directory');
  mkdirSync(directoryPath);
  assert.deepEqual(await listPanelCloses(directoryPath), []);
});

test('a malformed ledger row is a database error, not a hidden close', async () => {
  const journalPath = createJournal('malformed');
  seedClose(journalPath, {
    job: 'day_close',
    day: '2026-11-20',
    status: 'complete',
    attempts: 1,
    updatedAt: '2026-11-20 06:00:00',
  });
  const badId = seedClose(journalPath, {
    job: 'lint',
    day: '2026-11-21',
    status: 'failed',
    attempts: 1,
    error: 'boom',
    updatedAt: '2026-11-21 06:00:00',
  });

  // The table carries CHECK constraints, so a hand-edited journal has to bypass
  // them to reproduce a row no reader understands.
  withJournalWrite(journalPath, (db) => {
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare("UPDATE automation_runs SET status = 'bogus' WHERE id = ?").run(badId);
  });
  withJournal(journalPath, (db) => expectCode(() => readPanelCloses(db), 'database_error'));
  await assert.rejects(listPanelCloses(journalPath), isDatabaseError);

  // An unknown job is refused the same strict way.
  withJournalWrite(journalPath, (db) => {
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare("UPDATE automation_runs SET status = 'failed', job = 'bogus' WHERE id = ?").run(badId);
  });
  await assert.rejects(listPanelCloses(journalPath), isDatabaseError);

  // Repairing the row restores the read: the healthy row was never lost, and
  // the bad one is not silently skipped while it is malformed.
  withJournalWrite(journalPath, (db) => {
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare("UPDATE automation_runs SET job = 'lint' WHERE id = ?").run(badId);
  });
  const repaired = await listPanelCloses(journalPath);
  assert.deepEqual(
    repaired.map((close) => close.day),
    ['2026-11-21', '2026-11-20'],
  );
});

test('the payload stays in the ledger and never reaches the summary', async () => {
  const journalPath = createJournal('payload');
  seedClose(journalPath, {
    job: 'week_close',
    day: '2026-11-16',
    status: 'complete',
    attempts: 1,
    payload: { memory_health: { findings: 2, proposals: 1, summary: 'nothing to report.' } },
    updatedAt: '2026-11-23 06:00:00',
  });

  assert.deepEqual(await listPanelCloses(journalPath), [
    {
      job: 'week_close',
      day: '2026-11-16',
      status: 'complete',
      attempts: 1,
      updated_at: '2026-11-23 06:00:00',
    },
  ]);

  // The projection only leaves the payload out; the row still holds it.
  const rows = readAll(journalPath, 'SELECT payload_json FROM automation_runs');
  assert.equal(rows.length, 1);
  assert.match(String(rows[0]?.payload_json), /memory_health/);
});

test('reading closes is pure: repeated reads agree and leave the ledger unchanged', async () => {
  const journalPath = createJournal('readonly');
  seedClose(journalPath, {
    job: 'day_close',
    day: '2026-11-20',
    status: 'complete',
    attempts: 1,
    payload: { reflection: 'the day in one page' },
  });
  seedClose(journalPath, { job: 'lint', day: '2026-11-21', status: 'skipped', error: 'memory disabled' });
  seedClose(journalPath, { job: 'week_close', day: '2026-11-16', status: 'failed', attempts: 2, error: 'timeout' });

  const hashBefore = fileHash(journalPath);
  const mtimeBefore = statSync(journalPath).mtimeMs;
  const rowsBefore = readAll(journalPath, 'SELECT * FROM automation_runs ORDER BY id');

  const first = await listPanelCloses(journalPath);
  const second = await listPanelCloses(journalPath, { limit: PANEL_CLOSE_MAX_LIMIT });
  const viaConnection = withJournal(journalPath, (db) => readPanelCloses(db));

  assert.deepEqual(second, first, 'the same journal reads the same list');
  assert.deepEqual(viaConnection, first, 'the open-connection read agrees with the path read');
  assert.equal(fileHash(journalPath), hashBefore, 'a read must not rewrite the journal');
  assert.equal(statSync(journalPath).mtimeMs, mtimeBefore, 'a read must not touch the journal mtime');
  assert.deepEqual(
    readAll(journalPath, 'SELECT * FROM automation_runs ORDER BY id'),
    rowsBefore,
    'no run row is written or changed',
  );
  assert.equal(existsSync(`${journalPath}-wal`), false, 'a read must not start a WAL');
  assert.equal(existsSync(`${journalPath}-journal`), false, 'a read must not leave a rollback journal');
});
