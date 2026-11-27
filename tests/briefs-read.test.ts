/**
 * `listPanelBriefs`: the reading view over the journal's stored briefs.
 *
 * A weekly close writes one `briefs` row (`kind = 'week'`, with the weekly
 * memory-health digest in `payload_json`), and the daily close writes a native
 * standup into `daily_standup_entries`. The list merges both into one shape:
 * day/week kind badge, period key, title, body, optional model and memory
 * health, and `updated_at`, de-duplicated per `(kind, period_key)` with the
 * `briefs` row winning, sorted by period descending and capped at ten.
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
  PANEL_BRIEF_DEFAULT_LIMIT,
  PANEL_BRIEF_MAX_LIMIT,
  listPanelBriefs,
} from '../src/briefs/read.js';
import type { PanelBriefSummary } from '../src/briefs/read.js';
import { DayflowError } from '../src/errors.js';
import { openJournal, withJournalWrite } from '../src/journal.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-briefs-read-test-'));
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

/** The Dayflow standup payload shape the existing decoder reads. */
const STANDUP_PAYLOAD = {
  highlightsTitle: 'Highlights',
  highlights: [{ text: 'Shipped the briefs view' }, { text: 'Wrote the read module' }],
  tasksTitle: 'Tasks',
  tasks: [{ text: 'Review the digest' }],
  blockersTitle: 'Blockers',
  blockersBody: 'None',
};

/** One `briefs` row to seed; timestamps are explicit so ordering is deterministic. */
interface BriefSeed {
  kind: 'day' | 'week';
  periodKey: string;
  title: string;
  body: string;
  model?: string | null;
  /** The object stored as `payload_json`; any JSON value is serialised. */
  payload?: unknown;
  /** Raw `payload_json` text, for the corrupt-payload cases. */
  rawPayload?: string;
  /** `created_at`/`updated_at`; defaults to a fixed 2026-11-24 timestamp. */
  timestamp?: string;
}

/** Seed one `briefs` row. */
function seedBrief(path: string, seed: BriefSeed): void {
  const timestamp = seed.timestamp ?? '2026-11-24 10:00:00';
  const payloadJson =
    seed.rawPayload !== undefined
      ? seed.rawPayload
      : seed.payload === undefined
        ? null
        : JSON.stringify(seed.payload);
  withJournalWrite(path, (db) => {
    db.prepare(
      `INSERT INTO briefs (kind, period_key, title, body, model, payload_json, source_id, source_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'native', ?, ?, ?)`,
    ).run(
      seed.kind,
      seed.periodKey,
      seed.title,
      seed.body,
      seed.model ?? null,
      payloadJson,
      `test:${seed.kind}:${seed.periodKey}`,
      timestamp,
      timestamp,
    );
  });
}

/** One native standup row to seed. */
interface StandupSeed {
  day: string;
  /** The payload object; serialised unless `rawPayload` is given. */
  payload?: unknown;
  rawPayload?: string;
  sourceId?: string;
  sourceKey?: string;
  isDeleted?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Seed one `daily_standup_entries` row. */
function seedStandup(path: string, seed: StandupSeed): void {
  const payloadJson = seed.rawPayload ?? JSON.stringify(seed.payload ?? {});
  const createdAt = seed.createdAt ?? '2026-11-25 04:00:00';
  const updatedAt = seed.updatedAt ?? createdAt;
  withJournalWrite(path, (db) => {
    db.prepare(
      `INSERT INTO daily_standup_entries
         (source_id, source_key, standup_day, payload_json, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      seed.sourceId ?? 'native',
      seed.sourceKey ?? `automation:day:${seed.day}`,
      seed.day,
      payloadJson,
      seed.isDeleted ?? 0,
      createdAt,
      updatedAt,
    );
  });
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

test('the list merges a week brief with its memory health and a native standup', async () => {
  const journalPath = createJournal('merge');
  const weekBody = 'A week of journal read paths.\n\nMemory health: nothing to report.';
  seedBrief(journalPath, {
    kind: 'week',
    periodKey: '2026-11-16',
    title: 'Week of 2026-11-16',
    body: weekBody,
    model: 'analysis-model-x',
    payload: { memory_health: { findings: 2, proposals: 1, summary: 'nothing to report.' } },
    timestamp: '2026-11-23 06:00:00',
  });
  seedStandup(journalPath, {
    day: '2026-11-24',
    payload: STANDUP_PAYLOAD,
    createdAt: '2026-11-25 04:00:00',
  });

  const briefs = await listPanelBriefs(journalPath);

  assert.equal(briefs.length, 2, 'one week brief and one standup');
  // period_key descending: the 24th (standup) before the 16th (week brief).
  assert.deepEqual(
    briefs.map((entry) => [entry.kind, entry.period_key]),
    [
      ['day', '2026-11-24'],
      ['week', '2026-11-16'],
    ],
  );

  assert.deepEqual(briefs[1], {
    kind: 'week',
    period_key: '2026-11-16',
    title: 'Week of 2026-11-16',
    body: weekBody,
    model: 'analysis-model-x',
    updated_at: '2026-11-23 06:00:00',
    memory_health: { findings: 2, proposals: 1, summary: 'nothing to report.' },
  });
  assert.match(briefs[1]?.body ?? '', /Memory health: nothing to report\./, 'the digest stays in the body');

  assert.deepEqual(briefs[0], {
    kind: 'day',
    period_key: '2026-11-24',
    title: 'Standup · 2026-11-24',
    body: '- Shipped the briefs view\n- Wrote the read module\n- Review the digest\n- None',
    updated_at: '2026-11-25 04:00:00',
  });
});

test('a standup is normalised to plain lines with a day kind and badge key', async () => {
  const journalPath = createJournal('standup-shape');
  seedStandup(journalPath, {
    day: '2026-11-20',
    payload: {
      highlights: ['Kept the importer green'],
      tasks: [{ text: 'Publish the release' }, { text: '   ' }],
      blockersBody: 'Waiting on review\nNothing else',
    },
  });

  const [entry] = await listPanelBriefs(journalPath);
  assert.ok(entry);
  assert.equal(entry.kind, 'day');
  assert.equal(entry.period_key, '2026-11-20');
  assert.equal(entry.title, 'Standup · 2026-11-20');
  assert.equal(entry.body, '- Kept the importer green\n- Publish the release\n- Waiting on review\n- Nothing else');
  assert.ok(!('model' in entry), 'a standup carries no model');
});

test('the daily brief payload body is used when the standup sections are empty', async () => {
  const journalPath = createJournal('standup-body');
  // Our own daily close stores a plain body instead of the Dayflow sections.
  seedStandup(journalPath, {
    day: '2026-11-19',
    payload: { day: '2026-11-19', title: 'Standup 2026-11-19', body: '- Wrote the read module\nBlockers: none' },
  });

  const [entry] = await listPanelBriefs(journalPath);
  assert.ok(entry);
  assert.equal(entry.body, '- Wrote the read module\nBlockers: none');
});

test('malformed payloads never throw: corrupt JSON degrades to the title line', async () => {
  const journalPath = createJournal('malformed');
  seedStandup(journalPath, { day: '2026-11-24', rawPayload: '{this is not json' });
  seedStandup(journalPath, { day: '2026-11-23', rawPayload: '[1, 2, 3]' });
  seedStandup(journalPath, { day: '2026-11-22', rawPayload: '' });
  seedBrief(journalPath, {
    kind: 'week',
    periodKey: '2026-11-16',
    title: 'Week of 2026-11-16',
    body: 'Readable body.',
    rawPayload: 'not json at all',
    timestamp: '2026-11-23 06:00:00',
  });
  seedBrief(journalPath, {
    kind: 'week',
    periodKey: '2026-11-09',
    title: 'Week of 2026-11-09',
    body: 'Readable body.',
    payload: { memory_health: { findings: '2', proposals: 1, summary: 'bad types' } },
    timestamp: '2026-11-16 06:00:00',
  });

  const briefs = await listPanelBriefs(journalPath);
  assert.equal(briefs.length, 5, 'a corrupt payload hides content, not the entry');

  assert.equal(briefs.find((entry) => entry.period_key === '2026-11-24')?.body, 'Standup · 2026-11-24');
  assert.equal(briefs.find((entry) => entry.period_key === '2026-11-23')?.body, 'Standup · 2026-11-23');
  assert.equal(briefs.find((entry) => entry.period_key === '2026-11-22')?.body, 'Standup · 2026-11-22');

  const badWeek = briefs.find((entry) => entry.period_key === '2026-11-16');
  assert.ok(badWeek);
  assert.equal(badWeek.body, 'Readable body.');
  assert.ok(!('memory_health' in badWeek), 'a corrupt payload hides only the digest');

  const badTypes = briefs.find((entry) => entry.period_key === '2026-11-09');
  assert.ok(badTypes);
  assert.ok(!('memory_health' in badTypes), 'a digest with unusable types is left off');
});

test('a briefs day row and a standup for the same day de-duplicate to the briefs row', async () => {
  const journalPath = createJournal('dedupe');
  seedBrief(journalPath, {
    kind: 'day',
    periodKey: '2026-11-24',
    title: 'Day brief for 2026-11-24',
    body: 'The imported day brief.',
    model: 'imported-model',
    timestamp: '2026-11-25 09:00:00',
  });
  seedStandup(journalPath, { day: '2026-11-24', payload: STANDUP_PAYLOAD });

  const briefs = await listPanelBriefs(journalPath);
  assert.equal(briefs.length, 1, 'one day appears once');
  assert.deepEqual(briefs[0], {
    kind: 'day',
    period_key: '2026-11-24',
    title: 'Day brief for 2026-11-24',
    body: 'The imported day brief.',
    model: 'imported-model',
    updated_at: '2026-11-25 09:00:00',
  });

  // Two native standups for one day are also one day: the more recent row wins.
  const duplicateStandups = createJournal('dedupe-standups');
  seedStandup(duplicateStandups, {
    day: '2026-11-23',
    sourceKey: 'automation:day:2026-11-23',
    payload: { highlights: [{ text: 'Older row' }] },
    updatedAt: '2026-11-24 05:00:00',
  });
  seedStandup(duplicateStandups, {
    day: '2026-11-23',
    sourceKey: 'importer:standup:2026-11-23',
    payload: { highlights: [{ text: 'Newer row' }] },
    updatedAt: '2026-11-25 05:00:00',
  });
  const standupEntries = await listPanelBriefs(duplicateStandups);
  assert.equal(standupEntries.length, 1);
  assert.equal(standupEntries[0]?.body, '- Newer row');
});

test('deleted and non-native standups are hidden', async () => {
  const journalPath = createJournal('hidden');
  seedStandup(journalPath, { day: '2026-11-24', payload: STANDUP_PAYLOAD, isDeleted: 1 });
  seedStandup(journalPath, {
    day: '2026-11-23',
    payload: STANDUP_PAYLOAD,
    sourceId: 'dayflow-import',
  });
  seedStandup(journalPath, { day: '2026-11-22', payload: STANDUP_PAYLOAD });

  const briefs = await listPanelBriefs(journalPath);
  assert.deepEqual(
    briefs.map((entry) => entry.period_key),
    ['2026-11-22'],
    'only the live native standup is readable',
  );
});

test('the list sorts by period descending and breaks ties by updated_at descending', async () => {
  const journalPath = createJournal('order');
  seedBrief(journalPath, {
    kind: 'week',
    periodKey: '2026-11-16',
    title: 'Week of 2026-11-16',
    body: 'week',
    timestamp: '2026-11-23 06:00:00',
  });
  seedBrief(journalPath, {
    kind: 'day',
    periodKey: '2026-11-20',
    title: 'Day brief for 2026-11-20',
    body: 'day',
    timestamp: '2026-11-21 06:00:00',
  });
  seedStandup(journalPath, { day: '2026-11-22', payload: STANDUP_PAYLOAD, updatedAt: '2026-11-23 04:00:00' });
  seedStandup(journalPath, { day: '2026-11-24', payload: STANDUP_PAYLOAD, updatedAt: '2026-11-25 04:00:00' });
  // The same period key as a different kind is not a duplicate: the newer update wins the tie.
  seedBrief(journalPath, {
    kind: 'day',
    periodKey: '2026-11-23',
    title: 'Day brief for 2026-11-23',
    body: 'same day, newer',
    timestamp: '2026-11-24 09:00:00',
  });
  seedBrief(journalPath, {
    kind: 'week',
    periodKey: '2026-11-23',
    title: 'Week of 2026-11-23',
    body: 'same day, older',
    timestamp: '2026-11-23 05:00:00',
  });

  const briefs = await listPanelBriefs(journalPath);
  assert.deepEqual(
    briefs.map((entry) => [entry.kind, entry.period_key]),
    [
      ['day', '2026-11-24'],
      ['day', '2026-11-23'],
      ['week', '2026-11-23'],
      ['day', '2026-11-22'],
      ['day', '2026-11-20'],
      ['week', '2026-11-16'],
    ],
  );
});

test('the default cap is ten and the limit is bounded to 1-20', async () => {
  assert.equal(PANEL_BRIEF_DEFAULT_LIMIT, 10);
  assert.equal(PANEL_BRIEF_MAX_LIMIT, 20);

  const journalPath = createJournal('cap');
  for (let index = 12; index >= 1; index -= 1) {
    const day = `2026-11-${String(index).padStart(2, '0')}`;
    seedStandup(journalPath, { day, payload: { highlights: [{ text: `day ${String(index)}` }] } });
  }

  const defaults = await listPanelBriefs(journalPath);
  assert.equal(defaults.length, 10, 'the default cap is ten');
  assert.equal(defaults[0]?.period_key, '2026-11-12');
  assert.equal(defaults[9]?.period_key, '2026-11-03');

  const one = await listPanelBriefs(journalPath, { limit: 1 });
  assert.equal(one.length, 1);
  assert.equal(one[0]?.period_key, '2026-11-12');

  const twenty = await listPanelBriefs(journalPath, { limit: PANEL_BRIEF_MAX_LIMIT });
  assert.equal(twenty.length, 12, 'a limit above the stored count returns everything');
});

test('an invalid limit is a caller error, even without a journal', async () => {
  const journalPath = createJournal('bad-limit');
  for (const limit of [0, -1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10' as unknown as number]) {
    await assert.rejects(listPanelBriefs(journalPath, { limit }), (error: unknown) => {
      assert.ok(isInvalidInput(error), `limit ${String(limit)} is invalid_input`);
      return true;
    });
  }
  // The limit is validated before the journal is probed: a caller error is not
  // hidden by a missing file.
  await assert.rejects(listPanelBriefs(journalFile('no-journal'), { limit: 21 }), isInvalidInput);
});

test('a missing journal answers [] and never creates the file', async () => {
  const journalPath = journalFile('absent');
  assert.equal(existsSync(journalPath), false);

  const briefs = await listPanelBriefs(journalPath);
  assert.deepEqual(briefs, []);
  assert.equal(existsSync(journalPath), false, 'a read must not create the journal');
  assert.equal(existsSync(`${journalPath}-wal`), false, 'a read must not start a WAL');
  assert.equal(existsSync(`${journalPath}-journal`), false, 'a read must not leave a rollback journal');
});

test('an unreadable journal answers [] instead of throwing', async () => {
  // A real file that is not SQLite: the insights payload's empty-list tolerance
  // covers a fresh install, and this read covers a file it cannot open.
  const corruptPath = journalFile('corrupt');
  writeFileSync(corruptPath, 'this file is not a SQLite journal\n'.repeat(4), 'utf8');
  assert.deepEqual(await listPanelBriefs(corruptPath), []);

  // A directory where the journal should be is also unopenable, not fatal.
  const directoryPath = journalFile('directory');
  mkdirSync(directoryPath);
  assert.deepEqual(await listPanelBriefs(directoryPath), []);
});

test('an empty journal answers []', async () => {
  const journalPath = createJournal('empty');
  assert.deepEqual(await listPanelBriefs(journalPath), []);
  assert.deepEqual(await listPanelBriefs(journalPath, { limit: 1 }), []);
});

test('reading briefs is pure: repeated reads agree and leave the journal unchanged', async () => {
  const journalPath = createJournal('readonly');
  seedBrief(journalPath, {
    kind: 'week',
    periodKey: '2026-11-16',
    title: 'Week of 2026-11-16',
    body: 'Read me.',
    payload: { memory_health: { findings: 0, proposals: 0, summary: 'nothing to report.' } },
  });
  seedStandup(journalPath, { day: '2026-11-24', payload: STANDUP_PAYLOAD });

  const hashBefore = fileHash(journalPath);
  const mtimeBefore = statSync(journalPath).mtimeMs;
  const briefRowsBefore = readAll(journalPath, 'SELECT * FROM briefs').length;
  const standupRowsBefore = readAll(journalPath, 'SELECT * FROM daily_standup_entries').length;

  const first = await listPanelBriefs(journalPath);
  const second = await listPanelBriefs(journalPath, { limit: 20 });

  assert.deepEqual(second, first, 'the same journal reads the same list');
  assert.equal(fileHash(journalPath), hashBefore, 'a read must not rewrite the journal');
  assert.equal(statSync(journalPath).mtimeMs, mtimeBefore, 'a read must not touch the journal mtime');
  assert.equal(readAll(journalPath, 'SELECT * FROM briefs').length, briefRowsBefore, 'no brief row is written');
  assert.equal(
    readAll(journalPath, 'SELECT * FROM daily_standup_entries').length,
    standupRowsBefore,
    'no standup row is written',
  );
});

test('the limit and the accepted clock option both reach the async read', async () => {
  const journalPath = createJournal('signature');
  seedBrief(journalPath, {
    kind: 'week',
    periodKey: '2026-11-16',
    title: 'Week of 2026-11-16',
    body: 'Read me.',
    model: 'model-x',
  });
  const now = (): Date => new Date('2026-11-25T04:00:00Z');
  const briefs = await listPanelBriefs(journalPath, { limit: 1, now });
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0]?.kind, 'week');
  assert.equal(briefs[0]?.model, 'model-x');
  // The type annotation keeps the exported shape under the test's eye.
  const expected: PanelBriefSummary = {
    kind: 'week',
    period_key: '2026-11-16',
    title: 'Week of 2026-11-16',
    body: 'Read me.',
    model: 'model-x',
    updated_at: '2026-11-24 10:00:00',
  };
  assert.deepEqual(briefs[0], expected);
});
