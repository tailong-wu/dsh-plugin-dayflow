/**
 * Schema v7 capture state, native screenshot rows, and the
 * capture/analysis/automation configuration contract.
 *
 * The journal tests use a disposable directory per file: every case opens its
 * own SQLite file, so a migration case cannot leak state into a state case.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { DatabaseSync } from 'node:sqlite';

import {
  countScreenshotsForDay,
  readCaptureState,
  recordScreenshotRow,
  writeCaptureState,
} from '../src/capture/state.js';
import type { ScreenshotInput } from '../src/capture/state.js';
import { Config, resolveConfig } from '../src/config.js';
import { dayWindowForKey } from '../src/day.js';
import { openDatabase } from '../src/db.js';
import { DayflowError } from '../src/errors.js';
import { JOURNAL_SCHEMA_VERSION, openJournal } from '../src/journal.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-capture-state-test-'));
after(() => {
  rmSync(directory, { recursive: true, force: true });
});

let journalCount = 0;

/** A fresh journal path no other case has used. */
function journalPath(): string {
  journalCount += 1;
  return join(directory, `journal-${journalCount}.sqlite`);
}

/** Open a journal, run one callback, and close it again. */
function withJournalDb<T>(path: string, work: (db: DatabaseSync) => T): T {
  const db = openJournal(path);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

/** The single row of `schema_version`, asserted to be well formed. */
function schemaVersion(db: DatabaseSync): number {
  const rows = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version?: unknown }[];
  assert.equal(rows.length, 1, 'schema_version holds exactly one row');
  return Number(rows[0]?.version);
}

/** Whether a named table exists in this journal. */
function tableExists(db: DatabaseSync, name: string): boolean {
  const rows = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .all(name) as { present?: unknown }[];
  return rows.length > 0;
}

/**
 * Epoch seconds for a local wall-clock time on the calendar day `day`.
 *
 * Built from the day's own 04:00 window so the helper does not depend on the
 * machine's timezone. An hour before 04:00 belongs to the previous Dayflow day.
 */
function instantOn(day: string, hour: number, minute = 0, second = 0): number {
  const window = dayWindowForKey(day);
  assert.ok(window !== undefined, `${day} must be a real date`);
  const instant = new Date(window.start.getTime());
  instant.setHours(hour, minute, second, 0);
  return Math.floor(instant.getTime() / 1000);
}

/** Pass a deliberately invalid value past the compiler so the runtime validator is what fails. */
function invalidConfig(value: unknown): never {
  return value as never;
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

/** A schemastery validation failure, which is a `TypeError` carrying the field path. */
function isSchemaValidationError(error: unknown): boolean {
  return error instanceof TypeError && /expect/i.test(error.message);
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

test('a new journal migrates to schema v8 and creates capture_state', () => {
  assert.equal(JOURNAL_SCHEMA_VERSION, 8);
  const path = journalPath();

  withJournalDb(path, (db) => {
    assert.equal(schemaVersion(db), 8);
    assert.equal(tableExists(db, 'capture_state'), true);
    assert.equal(tableExists(db, 'analysis_jobs'), true);
    // The rest of v7 is still there: v8 is additive.
    for (const table of ['activities', 'screenshots', 'long_tasks', 'memory_claims', 'reflections']) {
      assert.equal(tableExists(db, table), true, `${table} survives v8`);
    }
  });

  // Reopening an already-current journal is a no-op rather than another migration.
  withJournalDb(path, (db) => {
    assert.equal(schemaVersion(db), 8);
  });
});

test('a v7 journal upgrades to v8 and keeps its tasks and memory claims', () => {
  const path = journalPath();

  withJournalDb(path, (db) => {
    db.prepare('INSERT INTO long_tasks (title, description) VALUES (?, ?)').run(
      'Port the native capture loop',
      'phase 0',
    );
    db.prepare(
      "INSERT INTO memory_claims (kind, subject, body, observed_on) VALUES ('preference', 'capture switch', 'on 2026-10-19, capture was off by default', '2026-10-19')",
    ).run();
    // Rewind to a real v7 journal: the table v8 adds is absent, the version says 7.
    db.exec('DROP TABLE analysis_jobs');
    db.prepare('UPDATE schema_version SET version = 7 WHERE version = 8').run();
    assert.equal(schemaVersion(db), 7);
  });

  withJournalDb(path, (db) => {
    assert.equal(schemaVersion(db), 8);
    assert.equal(tableExists(db, 'capture_state'), true);
    assert.equal(tableExists(db, 'analysis_jobs'), true);
    const taskRows = db.prepare('SELECT title FROM long_tasks ORDER BY id').all() as { title?: unknown }[];
    assert.deepEqual(
      taskRows.map((row) => row.title),
      ['Port the native capture loop'],
    );
    const memoryRows = db.prepare('SELECT body FROM memory_claims ORDER BY id').all() as { body?: unknown }[];
    assert.deepEqual(
      memoryRows.map((row) => row.body),
      ['on 2026-10-19, capture was off by default'],
    );
    // The new table starts empty, which reads as "not paused".
    assert.deepEqual(readCaptureState(db), { paused: false });
  });
});

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

test('capture state round-trips and tolerates unreadable values', () => {
  const path = journalPath();

  withJournalDb(path, (db) => {
    assert.deepEqual(readCaptureState(db), { paused: false }, 'an empty table means capture is not paused');

    assert.deepEqual(writeCaptureState(db, { paused: true }), { paused: true });
    assert.deepEqual(readCaptureState(db), { paused: true });

    assert.deepEqual(writeCaptureState(db, { lastFrameAt: 1_760_000_000_000 }), {
      paused: true,
      lastFrameAt: 1_760_000_000_000,
    });
    assert.deepEqual(readCaptureState(db), { paused: true, lastFrameAt: 1_760_000_000_000 });

    // Two calls patch different keys; neither drops the other's value.
    assert.deepEqual(writeCaptureState(db, { lastSweepAt: 1_760_000_100_000 }), {
      paused: true,
      lastFrameAt: 1_760_000_000_000,
      lastSweepAt: 1_760_000_100_000,
    });
    assert.deepEqual(writeCaptureState(db, { lastFrameAt: 1_760_000_050_000 }), {
      paused: true,
      lastFrameAt: 1_760_000_050_000,
      lastSweepAt: 1_760_000_100_000,
    });
    assert.deepEqual(writeCaptureState(db, { paused: false }), {
      paused: false,
      lastFrameAt: 1_760_000_050_000,
      lastSweepAt: 1_760_000_100_000,
    });

    // A corrupt numeric value is ignored, not fatal, and does not hide its neighbours.
    db.prepare(
      "INSERT INTO capture_state (key, value) VALUES ('last_frame_at', 'abc') ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    ).run();
    assert.deepEqual(readCaptureState(db), { paused: false, lastSweepAt: 1_760_000_100_000 });

    // A non-'1' paused value reads as not paused rather than throwing.
    db.prepare("UPDATE capture_state SET value = 'wat' WHERE key = 'paused'").run();
    assert.equal(readCaptureState(db).paused, false);
  });
});

test('an invalid state value is rejected instead of stored', () => {
  const path = journalPath();

  withJournalDb(path, (db) => {
    assert.throws(() => writeCaptureState(db, { lastFrameAt: -1 }), isInvalidInput);
    assert.throws(() => writeCaptureState(db, { lastSweepAt: Number.NaN }), isInvalidInput);
    assert.deepEqual(readCaptureState(db), { paused: false });
  });
});

test('capture state writes fail on a read-only connection', () => {
  const path = journalPath();
  withJournalDb(path, (db) => {
    writeCaptureState(db, { paused: false });
  });

  const readOnly = openDatabase(path);
  try {
    assert.deepEqual(readCaptureState(readOnly), { paused: false });
    assert.throws(() => writeCaptureState(readOnly, { paused: true }), /readonly|read-only/i);
  } finally {
    readOnly.close();
  }
});

// ---------------------------------------------------------------------------
// Screenshot rows
// ---------------------------------------------------------------------------

test('screenshot rows are idempotent per source key', () => {
  const path = journalPath();

  withJournalDb(path, (db) => {
    const first = recordScreenshotRow(db, {
      sourceKey: 'native/2026-10-19/frame-1',
      capturedAt: instantOn('2026-10-19', 9),
      day: '2026-10-19',
      filePath: '/tmp/frames/1.jpg',
      fileSize: 2048,
      idleSeconds: 3,
      frameIndex: 0,
      payload: { hash: 'abc123', app: 'Terminal' },
    });
    assert.ok(first > 0);

    // Replaying the same key is a no-op that returns the existing id.
    const replay = recordScreenshotRow(db, {
      sourceKey: 'native/2026-10-19/frame-1',
      capturedAt: instantOn('2026-10-19', 10),
      day: '2026-10-19',
      filePath: '/tmp/frames/other.jpg',
    });
    assert.equal(replay, first);
    const nativeRows = db
      .prepare("SELECT count(*) AS rows FROM screenshots WHERE source_id = 'native'")
      .all() as { rows?: unknown }[];
    assert.equal(Number(nativeRows[0]?.rows), 1);

    // The first write is the row that stays.
    const stored = db
      .prepare('SELECT captured_at, file_path, payload_json, is_deleted FROM screenshots WHERE id = ?')
      .all(first) as { captured_at?: unknown; file_path?: unknown; payload_json?: unknown; is_deleted?: unknown }[];
    assert.equal(Number(stored[0]?.captured_at), instantOn('2026-10-19', 9));
    assert.equal(stored[0]?.file_path, '/tmp/frames/1.jpg');
    assert.equal(Number(stored[0]?.is_deleted), 0);
    assert.deepEqual(JSON.parse(String(stored[0]?.payload_json)), { hash: 'abc123', app: 'Terminal' });

    // A different key is a new row.
    const second = recordScreenshotRow(db, {
      sourceKey: 'native/2026-10-19/frame-2',
      capturedAt: instantOn('2026-10-19', 10),
      day: '2026-10-19',
    });
    assert.notEqual(second, first);
  });
});

test('a provider-clock capture time is stored in the epoch seconds readers use', () => {
  const path = journalPath();

  withJournalDb(path, (db) => {
    const capturedAt = instantOn('2026-10-19', 9) * 1000 + 123;
    recordScreenshotRow(db, { sourceKey: 'native/ms', capturedAt, day: '2026-10-19' });
    const rows = db.prepare('SELECT captured_at FROM screenshots').all() as { captured_at?: unknown }[];
    assert.equal(Number(rows[0]?.captured_at), Math.floor(capturedAt / 1000));
    assert.equal(countScreenshotsForDay(db, '2026-10-19'), 1);
  });
});

test('screenshots are counted per Dayflow day, never across days', () => {
  const path = journalPath();

  withJournalDb(path, (db) => {
    recordScreenshotRow(db, { sourceKey: 'native/19a', capturedAt: instantOn('2026-10-19', 9), day: '2026-10-19' });
    recordScreenshotRow(db, { sourceKey: 'native/19b', capturedAt: instantOn('2026-10-19', 10), day: '2026-10-19' });
    recordScreenshotRow(db, { sourceKey: 'native/20a', capturedAt: instantOn('2026-10-20', 9), day: '2026-10-20' });
    // 03:00 on the 19th is inside the Dayflow day labelled 2026-10-18.
    recordScreenshotRow(db, { sourceKey: 'native/18a', capturedAt: instantOn('2026-10-19', 3), day: '2026-10-18' });
    // A soft-deleted native row and an imported row must not count.
    recordScreenshotRow(db, { sourceKey: 'native/19c', capturedAt: instantOn('2026-10-19', 12), day: '2026-10-19' });
    db.prepare("UPDATE screenshots SET is_deleted = 1 WHERE source_key = 'native/19c'").run();
    db.prepare(
      "INSERT INTO screenshots (source_id, source_key, captured_at, is_deleted) VALUES ('dayflow', 'imported-19', ?, 0)",
    ).run(instantOn('2026-10-19', 11));

    assert.equal(countScreenshotsForDay(db, '2026-10-19'), 2);
    assert.equal(countScreenshotsForDay(db, '2026-10-20'), 1);
    assert.equal(countScreenshotsForDay(db, '2026-10-18'), 1, 'the 4 AM boundary belongs to the previous day');
    assert.equal(countScreenshotsForDay(db, '2026-10-17'), 0);
  });
});

test('invalid screenshot input is rejected and writes nothing', () => {
  const path = journalPath();

  withJournalDb(path, (db) => {
    const circularPayload: Record<string, unknown> = {};
    circularPayload.self = circularPayload;

    const rejected: { label: string; input: ScreenshotInput }[] = [
      {
        label: 'blank source key',
        input: { sourceKey: '   ', capturedAt: instantOn('2026-10-19', 9), day: '2026-10-19' },
      },
      {
        label: 'impossible day',
        input: { sourceKey: 'native/x', capturedAt: instantOn('2026-10-19', 9), day: '2026-02-30' },
      },
      {
        label: 'malformed day',
        input: { sourceKey: 'native/x', capturedAt: instantOn('2026-10-19', 9), day: '19/10/2026' },
      },
      {
        label: 'negative capturedAt',
        input: { sourceKey: 'native/x', capturedAt: -1, day: '2026-10-19' },
      },
      {
        label: 'fractional capturedAt',
        input: { sourceKey: 'native/x', capturedAt: 1.5, day: '2026-10-19' },
      },
      {
        label: 'negative fileSize',
        input: { sourceKey: 'native/x', capturedAt: instantOn('2026-10-19', 9), day: '2026-10-19', fileSize: -1 },
      },
      {
        label: 'unserializable payload',
        input: {
          sourceKey: 'native/x',
          capturedAt: instantOn('2026-10-19', 9),
          day: '2026-10-19',
          payload: circularPayload,
        },
      },
    ];

    for (const { label, input } of rejected) {
      assert.throws(() => recordScreenshotRow(db, input), isInvalidInput, label);
    }

    const rows = db.prepare('SELECT count(*) AS rows FROM screenshots').all() as { rows?: unknown }[];
    assert.equal(Number(rows[0]?.rows), 0, 'no rejected input wrote a row');
    assert.throws(() => countScreenshotsForDay(db, 'not-a-day'), isInvalidInput);
    assert.throws(() => countScreenshotsForDay(db, '2026-02-30'), isInvalidInput);
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test('capture, analysis, and automation default to safe values', () => {
  const resolved = resolveConfig({});
  assert.deepEqual(resolved.capture, {
    enabled: false,
    intervalSeconds: 45,
    idleSeconds: 120,
    maxFramesPerDay: 1200,
    keepFramesDays: 0,
    dedupeDistance: 4,
    retentionCheckMinutes: 60,
    pauseApps: [],
    displays: 'main',
  });
  assert.deepEqual(resolved.analysis, {
    enabled: true,
    intervalMinutes: 5,
    consent: 'none',
    provider: '',
    model: '',
    windowMinutes: 10,
    framesPerWindow: 3,
    maxCallsPerDay: 120,
    dailyTokenBudget: 200_000,
    localProviders: [],
  });
  assert.deepEqual(resolved.automation, {
    enabled: true,
    dailyAt: '04:00',
    weeklyOn: 'monday',
    catchUpOnStart: true,
  });

  // The loader schema applies the same defaults before resolveConfig sees them.
  const parsed = Config({});
  assert.deepEqual(parsed.capture, resolved.capture);
  assert.deepEqual(parsed.analysis, resolved.analysis);
  assert.deepEqual(parsed.automation, resolved.automation);
});

test('nested blocks can be overridden without disturbing the others', () => {
  const resolved = resolveConfig({
    capture: { enabled: true, intervalSeconds: 10, displays: 'all' },
    analysis: { consent: 'cloud', provider: ' deepseek ', model: ' deepseek-flash ' },
    automation: { dailyAt: '23:59', weeklyOn: 'sunday', catchUpOnStart: false },
  });

  assert.equal(resolved.capture.enabled, true);
  assert.equal(resolved.capture.intervalSeconds, 10);
  assert.equal(resolved.capture.displays, 'all');
  assert.equal(resolved.capture.idleSeconds, 120, 'untouched capture keys keep their defaults');
  assert.equal(resolved.analysis.consent, 'cloud');
  assert.equal(resolved.analysis.provider, 'deepseek');
  assert.equal(resolved.analysis.model, 'deepseek-flash');
  assert.equal(resolved.analysis.enabled, true);
  assert.equal(resolved.automation.dailyAt, '23:59');
  assert.equal(resolved.automation.weeklyOn, 'sunday');
  assert.equal(resolved.automation.catchUpOnStart, false);
  assert.equal(resolved.automation.enabled, true);

  // The existing keys and the source/dayflow alias are unchanged.
  const owned = resolveConfig({ dayflow: false, searchLimit: 10 });
  assert.equal(owned.source, 'owned');
  assert.equal(owned.dayflow, false);
  assert.equal(owned.searchLimit, 10);
  assert.equal(resolveConfig({}).capture.enabled, false);
});

test('pauseApps entries are trimmed, de-duplicated, and emptied', () => {
  const resolved = resolveConfig({
    capture: { pauseApps: [' 1Password ', '', '1Password', 'Slack', '   '] },
  });
  assert.deepEqual(resolved.capture.pauseApps, ['1Password', 'Slack']);
});

test('explicit invalid capture, analysis, and automation values are rejected', () => {
  const rejected: { label: string; value: unknown }[] = [
    { label: 'capture.intervalSeconds too small', value: { capture: { intervalSeconds: 1 } } },
    { label: 'capture.intervalSeconds too large', value: { capture: { intervalSeconds: 601 } } },
    { label: 'capture.idleSeconds too large', value: { capture: { idleSeconds: 3601 } } },
    { label: 'capture.maxFramesPerDay', value: { capture: { maxFramesPerDay: 0 } } },
    { label: 'capture.keepFramesDays', value: { capture: { keepFramesDays: 31 } } },
    { label: 'capture.displays', value: { capture: { displays: 'external' } } },
    { label: 'capture.pauseApps type', value: { capture: { pauseApps: [1] } } },
    { label: 'analysis.consent', value: { analysis: { consent: 'foo' } } },
    { label: 'analysis.windowMinutes', value: { analysis: { windowMinutes: 0 } } },
    { label: 'analysis.framesPerWindow', value: { analysis: { framesPerWindow: 6 } } },
    { label: 'analysis.maxCallsPerDay', value: { analysis: { maxCallsPerDay: 1001 } } },
    { label: 'analysis.dailyTokenBudget', value: { analysis: { dailyTokenBudget: 10 } } },
    { label: 'automation.dailyAt hour', value: { automation: { dailyAt: '25:00' } } },
    { label: 'automation.dailyAt padding', value: { automation: { dailyAt: '4:00' } } },
    { label: 'automation.weeklyOn', value: { automation: { weeklyOn: 'someday' } } },
  ];

  for (const { label, value } of rejected) {
    assert.throws(() => resolveConfig(invalidConfig(value)), isInvalidInput, `resolveConfig rejects ${label}`);
    assert.throws(() => Config(invalidConfig(value)), isSchemaValidationError, `Config rejects ${label}`);
  }
});
