/**
 * Owned journal schema v4 (long tasks) and the long-task store semantics.
 *
 * The store is the checkpoint the roadmap asks for: a task carries the signals
 * of its work (categories and apps), sessions carry the day-by-day evidence, and
 * progress / stall state are derived from those sessions instead of being
 * maintained by hand. These tests use disposable journals under a temporary
 * directory; they never touch the default `$DSH_HOME` journal.
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
  STALL_DAYS,
  attachTaskSession,
  createLongTask,
  createTaskFromReviewItem,
  detachTaskSession,
  getLongTask,
  listLongTasks,
  suggestTaskMatches,
  updateLongTaskStatus,
} from '../src/tasks.js';
import type { LongTaskStatus } from '../src/tasks.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-task-store-'));
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

function sessionCountIn(db: DatabaseSync): number {
  return Number((db.prepare('SELECT count(*) AS count FROM long_task_sessions').get() as Row).count);
}

function taskCountIn(db: DatabaseSync): number {
  return Number((db.prepare('SELECT count(*) AS count FROM long_tasks').get() as Row).count);
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

function isNotFound(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'not_found';
}

/**
 * Build a v3-shaped journal: a fully migrated file whose long-task tables have
 * been dropped and whose version is rewound to 3. This is exactly what an
 * installed 0.6.x journal looks like before migration 4.
 */
function createV3Journal(path: string): void {
  const db = openJournal(path);
  try {
    db.prepare("INSERT INTO days (day, start_ts, end_ts) VALUES ('2026-01-05', 100, 200)").run();
    db.prepare(
      `INSERT INTO activities (source_key, start_ts, end_ts, day, title, summary)
       VALUES ('legacy-card', 100, 200, '2026-01-05', 'Legacy activity', 'Kept through the upgrade')`,
    ).run();
    db.prepare(
      `INSERT INTO review_items (fingerprint, kind, status, title, body, confidence)
       VALUES ('legacy-fingerprint', 'task_proposal', 'proposed', 'A legacy proposal', 'Kept too', 0.8)`,
    ).run();
    db.exec('DROP TABLE long_task_sessions');
    db.exec('DROP TABLE long_tasks');
    db.prepare('UPDATE schema_version SET version = 3').run();
  } finally {
    db.close();
  }
}

test('a new journal migrates to schema v4 with the long-task tables and indexes', () => {
  const path = journalFile('fresh');
  const db = openJournal(path);
  try {
    const version = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'long_task%' ORDER BY name")
      .all() as { name: string }[];
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'long_task%' ORDER BY name")
      .all() as { name: string }[];
    assert.ok(JOURNAL_SCHEMA_VERSION >= 4, 'the long-task store needs at least schema v4');
    assert.equal(version?.version, JOURNAL_SCHEMA_VERSION);
    assert.deepEqual(
      tables.map((row) => row.name),
      ['long_task_sessions', 'long_tasks'],
    );
    assert.deepEqual(
      indexes.map((row) => row.name),
      ['long_task_sessions_task_idx', 'long_tasks_status_idx'],
    );
  } finally {
    db.close();
  }
  assert.deepEqual(withJournal(path, (read) => listLongTasks(read)), []);
});

test('a v3 journal migrates to v4 and keeps its rows', () => {
  const path = journalFile('v3-read');
  createV3Journal(path);
  assert.equal(schemaVersion(path), 3);
  assert.equal(queryRow(path, "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'long_tasks'")?.count, 0);
  assert.equal(
    queryRow(path, "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'long_task_sessions'")?.count,
    0,
  );

  const migrated = openJournal(path);
  try {
    assert.equal(
      (migrated.prepare('SELECT version FROM schema_version').get() as { version: number }).version,
      JOURNAL_SCHEMA_VERSION,
    );
    assert.equal(tableCountIn(migrated, 'long_tasks'), 1);
    assert.equal(tableCountIn(migrated, 'long_task_sessions'), 1);
    assert.equal(
      (migrated.prepare("SELECT title FROM activities WHERE source_key = 'legacy-card'").get() as { title: string }).title,
      'Legacy activity',
    );
    assert.equal((migrated.prepare('SELECT count(*) AS count FROM review_items').get() as { count: number }).count, 1);
    assert.equal(
      (migrated.prepare('SELECT title FROM review_items').get() as { title: string }).title,
      'A legacy proposal',
    );
    assert.deepEqual(migrated.prepare('SELECT * FROM long_tasks').all(), []);
  } finally {
    migrated.close();
  }
});

test('the read path and the write path both upgrade a v3 journal', () => {
  const readPath = journalFile('v3-readiness');
  createV3Journal(readPath);
  assert.deepEqual(withJournal(readPath, (db) => listLongTasks(db)), []);
  assert.equal(schemaVersion(readPath), JOURNAL_SCHEMA_VERSION);
  assert.equal(
    withJournal(readPath, (db) => (db.prepare("SELECT title FROM activities WHERE source_key = 'legacy-card'").get() as Row).title),
    'Legacy activity',
  );

  const writePath = journalFile('v3-write');
  createV3Journal(writePath);
  const task = withJournalWrite(writePath, (db) => createLongTask(db, { title: 'Created after the upgrade' }));
  assert.equal(task.id, 1);
  assert.equal(task.status, 'active');
  assert.equal(schemaVersion(writePath), JOURNAL_SCHEMA_VERSION);
  assert.equal(queryRow(writePath, "SELECT title FROM activities WHERE source_key = 'legacy-card'")?.title, 'Legacy activity');
  assert.equal(queryRow(writePath, 'SELECT title FROM review_items')?.title, 'A legacy proposal');
});

test('create stores a user task and list/get/update round-trip', () => {
  const path = journalFile('create-list-get');
  withJournalWrite(path, (db) => {
    const first = createLongTask(db, {
      title: '  Ship the long-task store  ',
      description: 'Schema v4 plus the task semantics.',
      categories: ['Development', ' Development ', 'Writing'],
      apps: ['VS Code', 'Xcode', 'VS Code'],
      target_date: '2026-12-01',
    });
    assert.equal(first.title, 'Ship the long-task store');
    assert.equal(first.description, 'Schema v4 plus the task semantics.');
    assert.equal(first.status, 'active');
    assert.equal(first.origin, 'user');
    assert.deepEqual(first.categories, ['Development', 'Writing']);
    assert.deepEqual(first.apps, ['VS Code', 'Xcode']);
    assert.equal(first.target_date, '2026-12-01');
    assert.equal(first.proposed_by, undefined);
    assert.equal(first.review_item_id, undefined);
    assert.equal(first.accepted_at, undefined);
    assert.equal(first.total_minutes, 0);
    assert.equal(first.session_days, 0);
    assert.equal(first.last_session_day, undefined);
    assert.equal(first.stalled, false);
    assert.deepEqual(first.sessions, []);
    assert.ok(first.created_at.length > 0);
    assert.ok(first.updated_at !== undefined && first.updated_at.length > 0);

    const second = createLongTask(db, { title: 'Second task' });
    assert.equal(second.description, '');
    assert.deepEqual(second.categories, []);
    assert.deepEqual(second.apps, []);
    assert.equal(second.target_date, undefined);

    const blankDate = createLongTask(db, { title: 'No deadline', target_date: '   ' });
    assert.equal(blankDate.target_date, undefined);

    const listed = listLongTasks(db);
    assert.deepEqual(
      listed.map((task) => task.id),
      [blankDate.id, second.id, first.id],
      'newest first',
    );
    assert.equal(listed[2]?.sessions, undefined, 'the list carries summaries, not sessions');
    assert.deepEqual(
      listLongTasks(db, { status: 'active' }).map((task) => task.id),
      [blankDate.id, second.id, first.id],
    );
    assert.deepEqual(listLongTasks(db, { status: 'paused' }), []);
    assert.equal(listLongTasks(db, { limit: 1 }).length, 1);
    assert.equal(listLongTasks(db, { limit: 200 }).length, 3);

    const read = getLongTask(db, first.id);
    assert.deepEqual(read, first);

    const paused = updateLongTaskStatus(db, first.id, 'paused');
    assert.equal(paused.status, 'paused');
    assert.equal(getLongTask(db, first.id).status, 'paused');
    assert.deepEqual(
      listLongTasks(db, { status: 'paused' }).map((task) => task.id),
      [first.id],
    );
    assert.equal(updateLongTaskStatus(db, first.id, 'done').status, 'done');
    assert.equal(listLongTasks(db, { status: 'done' }).length, 1);
  });
});

test('create/list/get validate their inputs and write nothing on failure', () => {
  const path = journalFile('validation');
  withJournalWrite(path, (db) => {
    assert.throws(() => createLongTask(db, { title: '   ' }), isInvalidInput);
    assert.throws(() => createLongTask(db, { title: 7 as unknown as string }), isInvalidInput);
    assert.throws(() => createLongTask(db, { title: 'x', description: 5 as unknown as string }), isInvalidInput);
    assert.throws(() => createLongTask(db, { title: 'x', target_date: '12/01/2026' }), isInvalidInput);
    assert.throws(() => createLongTask(db, { title: 'x', target_date: '2026-02-30' }), isInvalidInput);
    assert.throws(
      () => createLongTask(db, { title: 'x', categories: 'Development' as unknown as string[] }),
      isInvalidInput,
    );
    assert.throws(
      () => createLongTask(db, { title: 'x', apps: ['VS Code', 42 as unknown as string] }),
      isInvalidInput,
    );
    assert.throws(
      () => createLongTask(db, { title: 'x', origin: 'robot' as unknown as 'user' | 'agent' }),
      isInvalidInput,
    );
    assert.throws(() => createLongTask(db, { title: 'x', review_item_id: 0 }), isInvalidInput);
    assert.throws(() => createLongTask(db, { title: 'x', review_item_id: 1.5 }), isInvalidInput);
    assert.throws(() => listLongTasks(db, { status: 'nope' as unknown as LongTaskStatus }), isInvalidInput);
    assert.throws(() => listLongTasks(db, { limit: 0 }), isInvalidInput);
    assert.throws(() => listLongTasks(db, { limit: 201 }), isInvalidInput);
    assert.throws(() => listLongTasks(db, { limit: 1.5 }), isInvalidInput);
    assert.throws(() => getLongTask(db, 999), isNotFound);
    assert.throws(() => updateLongTaskStatus(db, 999, 'done'), isNotFound);
    assert.equal(listLongTasks(db).length, 0, 'failed creates must not be written');

    const task = createLongTask(db, { title: 'Only real task' });
    assert.throws(() => updateLongTaskStatus(db, task.id, 'nope' as unknown as LongTaskStatus), isInvalidInput);
    assert.throws(() => getLongTask(db, 0), isNotFound);
    assert.equal(listLongTasks(db).length, 1);
  });
});

test('attach replaces a day instead of accumulating and detach rolls progress back', () => {
  const path = journalFile('attach');
  withJournalWrite(path, (db) => {
    const task = createLongTask(db, { title: 'Long-running task' });

    const oneDay = attachTaskSession(db, task.id, {
      day: '2026-06-01',
      minutes: 30,
      note: 'morning block',
      activity_ids: [11, 12],
    });
    assert.equal(oneDay.total_minutes, 30);
    assert.equal(oneDay.session_days, 1);
    assert.equal(oneDay.last_session_day, '2026-06-01');
    assert.deepEqual(oneDay.sessions, [
      { day: '2026-06-01', minutes: 30, note: 'morning block', activity_ids: [11, 12] },
    ]);
    assert.equal(sessionCountIn(db), 1);

    const replaced = attachTaskSession(db, task.id, {
      day: '2026-06-01',
      minutes: 45,
      note: 'afternoon block',
      activity_ids: [13],
    });
    assert.equal(replaced.total_minutes, 45, 'the same day replaces its minutes, never adds them');
    assert.equal(replaced.session_days, 1);
    assert.equal(sessionCountIn(db), 1);
    assert.deepEqual(replaced.sessions, [
      { day: '2026-06-01', minutes: 45, note: 'afternoon block', activity_ids: [13] },
    ]);

    attachTaskSession(db, task.id, { day: '2026-06-03', minutes: 15 });
    const multi = attachTaskSession(db, task.id, { day: '2026-06-02', minutes: 10, activity_ids: [21] });
    assert.equal(multi.total_minutes, 70);
    assert.equal(multi.session_days, 3);
    assert.equal(multi.last_session_day, '2026-06-03');
    assert.deepEqual(
      multi.sessions?.map((session) => session.day),
      ['2026-06-01', '2026-06-02', '2026-06-03'],
      'sessions are ordered by day',
    );
    assert.equal(multi.sessions?.[1]?.note, undefined);
    assert.deepEqual(multi.sessions?.[1]?.activity_ids, [21]);

    const detached = detachTaskSession(db, task.id, '2026-06-02');
    assert.equal(detached.total_minutes, 60);
    assert.equal(detached.session_days, 2);
    assert.equal(detached.last_session_day, '2026-06-03');
    assert.deepEqual(
      detached.sessions?.map((session) => session.day),
      ['2026-06-01', '2026-06-03'],
    );

    const again = detachTaskSession(db, task.id, '2026-06-02');
    assert.deepEqual(again, detached, 'detaching a missing day is a no-op');
    assert.equal(sessionCountIn(db), 2);

    const listed = listLongTasks(db)[0];
    assert.equal(listed?.total_minutes, 60);
    assert.equal(listed?.sessions, undefined);

    assert.throws(() => attachTaskSession(db, task.id, { day: '06/01/2026', minutes: 5 }), isInvalidInput);
    assert.throws(() => attachTaskSession(db, task.id, { day: '2026-02-30', minutes: 5 }), isInvalidInput);
    assert.throws(() => attachTaskSession(db, task.id, { day: '2026-06-04', minutes: -1 }), isInvalidInput);
    assert.throws(() => attachTaskSession(db, task.id, { day: '2026-06-04', minutes: 1.5 }), isInvalidInput);
    assert.throws(
      () =>
        attachTaskSession(db, task.id, {
          day: '2026-06-04',
          minutes: 5,
          activity_ids: ['1' as unknown as number],
        }),
      isInvalidInput,
    );
    assert.throws(() => attachTaskSession(db, 999, { day: '2026-06-04', minutes: 5 }), isNotFound);
    assert.throws(() => detachTaskSession(db, 999, '2026-06-04'), isNotFound);
    assert.equal(sessionCountIn(db), 2, 'failed attaches must not be written');
  });
});

test('stalled is derived from an injectable clock', () => {
  assert.equal(STALL_DAYS, 7);
  const path = journalFile('stalled');
  withJournalWrite(path, (db) => {
    const task = createLongTask(db, { title: 'Quiet task' });
    db.prepare("UPDATE long_tasks SET created_at = '2026-01-01 00:00:00' WHERE id = ?").run(task.id);

    assert.equal(getLongTask(db, task.id, new Date('2026-01-09T00:00:00Z')).stalled, true);
    assert.equal(
      getLongTask(db, task.id, new Date('2026-01-08T00:00:00Z')).stalled,
      false,
      'exactly STALL_DAYS old is not stalled yet',
    );
    assert.equal(listLongTasks(db, {}, new Date('2026-01-09T00:00:00Z'))[0]?.stalled, true);
    assert.equal(listLongTasks(db, {}, new Date('2026-01-05T00:00:00Z'))[0]?.stalled, false);

    const attached = attachTaskSession(db, task.id, { day: '2026-01-07', minutes: 20 });
    assert.equal(attached.last_session_day, '2026-01-07');
    assert.equal(
      getLongTask(db, task.id, new Date('2026-01-09T00:00:00Z')).stalled,
      false,
      'a recent session clears the stall',
    );
    assert.equal(
      getLongTask(db, task.id, new Date('2026-01-15T00:00:00Z')).stalled,
      true,
      'the last session becomes the baseline once one exists',
    );

    const done = updateLongTaskStatus(db, task.id, 'done');
    assert.equal(done.stalled, false, 'a finished task is not stalled');
    assert.equal(listLongTasks(db, { status: 'done' })[0]?.stalled, false);

    const paused = createLongTask(db, { title: 'Paused quiet task' });
    db.prepare("UPDATE long_tasks SET created_at = '2026-01-01 00:00:00' WHERE id = ?").run(paused.id);
    assert.equal(updateLongTaskStatus(db, paused.id, 'paused').stalled, false);
  });
});

test('suggestions explain category and app hits and never write', () => {
  const path = journalFile('suggest');
  withJournalWrite(path, (db) => {
    const dev = createLongTask(db, { title: 'Ship the storage layer', categories: ['Development'], apps: ['VS Code'] });
    const docs = createLongTask(db, { title: 'Write the docs', categories: ['Writing'], apps: ['Obsidian'] });
    const editorOnly = createLongTask(db, { title: 'Editor chores', apps: ['VS Code'] });
    const bare = createLongTask(db, { title: 'No signals' });
    const doneDev = createLongTask(db, { title: 'Finished dev task', categories: ['Development'] });
    updateLongTaskStatus(db, doneDev.id, 'done');
    const corrupted = createLongTask(db, { title: 'Corrupted signals', categories: ['Development'] });
    db.prepare("UPDATE long_tasks SET categories_json = '{not json', apps_json = 'nope' WHERE id = ?").run(corrupted.id);

    const activities = [
      { recordId: 1, category: 'Development', apps: ['VS Code', 'Safari'] },
      { recordId: 2, category: 'Writing', apps: ['Obsidian'] },
      { recordId: 3, category: 'System', apps: ['Finder'] },
      { recordId: 4, category: 'Development', apps: ['Safari'] },
    ];
    const before = { sessions: sessionCountIn(db), tasks: taskCountIn(db) };

    const suggestions = suggestTaskMatches(db, '2026-06-01', activities);
    assert.deepEqual(suggestions, [
      {
        task_id: dev.id,
        title: 'Ship the storage layer',
        score: 5,
        activity_ids: [1, 4],
        reasons: ['category:Development', 'app:VS Code'],
      },
      {
        task_id: docs.id,
        title: 'Write the docs',
        score: 3,
        activity_ids: [2],
        reasons: ['category:Writing', 'app:Obsidian'],
      },
    ]);
    assert.ok(!suggestions.some((candidate) => candidate.task_id === bare.id), 'a task without signals never matches');
    assert.ok(!suggestions.some((candidate) => candidate.task_id === doneDev.id), 'only active tasks are suggested');
    assert.ok(!suggestions.some((candidate) => candidate.task_id === corrupted.id), 'bad JSON counts as no signals');
    assert.equal(sessionCountIn(db), before.sessions, 'suggesting must not write sessions');
    assert.equal(taskCountIn(db), before.tasks, 'suggesting must not write tasks');

    assert.deepEqual(
      suggestTaskMatches(db, '2026-06-01', activities, { minScore: 1 }).map((candidate) => [candidate.task_id, candidate.score]),
      [
        [dev.id, 5],
        [docs.id, 3],
        [editorOnly.id, 1],
      ],
    );
    assert.deepEqual(suggestTaskMatches(db, '2026-06-01', activities, { minScore: 6 }), []);
    assert.deepEqual(
      suggestTaskMatches(db, '2026-06-01', activities, { limit: 1 }).map((candidate) => candidate.task_id),
      [dev.id],
    );

    // One app hit is +1, below the default floor of 2.
    const appOnly = [{ recordId: 9, category: 'System', apps: ['VS Code'] }];
    assert.deepEqual(suggestTaskMatches(db, '2026-06-02', appOnly), []);
    assert.deepEqual(suggestTaskMatches(db, '2026-06-02', appOnly, { minScore: 1 }), [
      { task_id: dev.id, title: 'Ship the storage layer', score: 1, activity_ids: [9], reasons: ['app:VS Code'] },
      { task_id: editorOnly.id, title: 'Editor chores', score: 1, activity_ids: [9], reasons: ['app:VS Code'] },
    ]);

    // App hits in one activity accumulate; the activity id is listed once.
    const doubleApp = createLongTask(db, { title: 'Two editors', apps: ['VS Code', 'Xcode'] });
    assert.deepEqual(
      suggestTaskMatches(db, '2026-06-03', [{ recordId: 7, category: 'System', apps: ['VS Code', 'Xcode'] }]),
      [
        {
          task_id: doubleApp.id,
          title: 'Two editors',
          score: 2,
          activity_ids: [7],
          reasons: ['app:VS Code', 'app:Xcode'],
        },
      ],
    );

    assert.deepEqual(suggestTaskMatches(db, '2026-06-01', []), [], 'no activities means no suggestions');
    assert.throws(() => suggestTaskMatches(db, '2026-06-01', activities, { limit: 0 }), isInvalidInput);
    assert.throws(() => suggestTaskMatches(db, '2026-06-01', activities, { limit: 21 }), isInvalidInput);
    assert.throws(() => suggestTaskMatches(db, '2026-06-01', activities, { limit: 1.5 }), isInvalidInput);
    assert.throws(
      () => suggestTaskMatches(db, '2026-06-01', activities, { minScore: 'two' as unknown as number }),
      isInvalidInput,
    );
    assert.deepEqual(queryAll(path, 'SELECT id FROM long_task_sessions'), [], 'nothing was attached by suggesting');
  });
});

test('a review-queue proposal becomes an accepted agent task', () => {
  const path = journalFile('from-review');
  withJournalWrite(path, (db) => {
    const task = createTaskFromReviewItem(db, {
      id: 42,
      title: 'Adopt the review queue',
      body: 'Turn accepted task proposals into long tasks.',
    });
    assert.equal(task.origin, 'agent');
    assert.equal(task.proposed_by, 'agent');
    assert.equal(task.review_item_id, 42);
    assert.equal(task.title, 'Adopt the review queue');
    assert.equal(task.description, 'Turn accepted task proposals into long tasks.');
    assert.equal(task.status, 'active');
    assert.equal(task.total_minutes, 0);
    assert.match(task.accepted_at ?? '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const userTask = createLongTask(db, { title: 'A user plan' });
    assert.equal(userTask.accepted_at, undefined, 'a user task was never a proposal');
    assert.equal(userTask.proposed_by, undefined);
    assert.equal(userTask.review_item_id, undefined);

    assert.throws(() => createTaskFromReviewItem(db, { id: 0, title: 'Bad id', body: '' }), isInvalidInput);
    assert.throws(() => createTaskFromReviewItem(db, { id: 1, title: '   ', body: '' }), isInvalidInput);
    assert.equal(taskCountIn(db), 2);
  });
});
