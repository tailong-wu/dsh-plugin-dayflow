/**
 * History scanning for long tasks.
 *
 * A new task wants to find the days of work that came before it. The active
 * backend supplies the candidate days; `scanTaskHistory` scores them against the
 * task's signals (categories, apps, and the keywords of its title), returns only
 * days the task has not attached yet, and never writes. These tests use
 * disposable journals under a temporary directory and hand-built activity days,
 * so they do not need a real Dayflow database.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DayflowError } from '../src/errors.js';
import { openJournal, withJournal, withJournalWrite } from '../src/journal.js';
import {
  attachTaskSession,
  createLongTask,
  scanTaskHistory,
  updateLongTaskStatus,
} from '../src/tasks.js';
import type { TaskHistoryActivity, TaskHistoryDayInput } from '../src/tasks.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-task-scan-'));
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

/** Read one row from a journal file with a short-lived raw connection. */
function queryRow(path: string, sql: string, ...parameters: (string | number)[]): Row | undefined {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).get(...(parameters as never[])) as Row | undefined;
  } finally {
    db.close();
  }
}

/** How many sessions one task has in a journal file. */
function sessionCount(path: string, taskId: number): number {
  return Number(queryRow(path, 'SELECT count(*) AS count FROM long_task_sessions WHERE task_id = ?', taskId)?.count);
}

/** One activity with the scanner's defaults, overridden per test. */
function activity(input: Partial<TaskHistoryActivity> & { recordId: number }): TaskHistoryActivity {
  return {
    category: '',
    apps: [],
    title: 'Untitled',
    summary: '',
    minutes: 15,
    ...input,
  };
}

/** One scanner day input. */
function day(dayKey: string, activities: readonly TaskHistoryActivity[]): TaskHistoryDayInput {
  return { day: dayKey, activities };
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

function isNotFound(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'not_found';
}

test('a title keyword match makes that day a candidate, with minutes, ids, titles, and reasons', () => {
  const path = journalFile('keyword');
  withJournalWrite(path, (db) => {
    const task = createLongTask(db, { title: 'Ship the release checklist' });
    const scan = scanTaskHistory(db, task.id, [
      day('2026-06-02', [
        activity({
          recordId: 11,
          title: 'Release checklist review',
          summary: 'Went through the list',
          minutes: 25,
        }),
        activity({ recordId: 12, title: 'Lunch', category: 'Personal', minutes: 45 }),
      ]),
      day('2026-06-01', [activity({ recordId: 13, title: 'Unrelated standup', minutes: 10 })]),
    ]);

    assert.deepEqual(scan, {
      task_id: task.id,
      title: 'Ship the release checklist',
      days: [
        {
          day: '2026-06-02',
          minutes: 25,
          activity_ids: [11],
          score: 4,
          reasons: ['keyword:release', 'keyword:checklist'],
          titles: ['Release checklist review'],
        },
      ],
      total_minutes: 25,
      total_days: 1,
    });
  });
});

test('a CJK title matches through character bigrams and stop words are ignored', () => {
  const path = journalFile('cjk');
  withJournalWrite(path, (db) => {
    const task = createLongTask(db, { title: '发布检查清单' });
    const scan = scanTaskHistory(db, task.id, [
      day('2026-06-05', [
        activity({ recordId: 31, title: '检查清单复核', summary: '逐条核对', minutes: 40 }),
        activity({ recordId: 32, title: '产品设计评审', minutes: 20 }),
      ]),
    ]);
    assert.deepEqual(scan.days, [
      {
        day: '2026-06-05',
        minutes: 40,
        activity_ids: [31],
        // 检查清单 contains 检查, 查清, and 清单 as adjacent bigrams.
        score: 6,
        reasons: ['keyword:检查', 'keyword:查清', 'keyword:清单'],
        titles: ['检查清单复核'],
      },
    ]);
  });
});

test('category and app signals stack with title keywords, and a day without any signal is not a candidate', () => {
  const path = journalFile('signals');
  withJournalWrite(path, (db) => {
    const task = createLongTask(db, {
      title: 'Ship the release checklist',
      categories: ['Work'],
      apps: ['github.com', 'VS Code'],
    });
    const scan = scanTaskHistory(db, task.id, [
      day('2026-06-03', [
        // category (+2) and app github.com (+1), no title keyword: score 3.
        activity({
          recordId: 21,
          category: 'Work',
          apps: ['github.com', 'Safari'],
          title: 'Code review on GitHub',
          minutes: 20,
        }),
      ]),
      day('2026-06-02', [
        // keyword release (+2) plus category (+2) plus app (+1): score 5.
        activity({ recordId: 22, category: 'Work', apps: ['github.com'], title: 'Release notes', minutes: 30 }),
      ]),
      day('2026-06-01', [
        // No claimed category, app, or keyword: the day must not appear.
        activity({ recordId: 23, category: 'Personal', apps: ['Finder'], title: 'Lunch', minutes: 60 }),
      ]),
    ]);

    assert.deepEqual(scan.days, [
      {
        day: '2026-06-03',
        minutes: 20,
        activity_ids: [21],
        score: 3,
        reasons: ['category:Work', 'app:github.com'],
        titles: ['Code review on GitHub'],
      },
      {
        day: '2026-06-02',
        minutes: 30,
        activity_ids: [22],
        score: 5,
        reasons: ['keyword:release', 'category:Work', 'app:github.com'],
        titles: ['Release notes'],
      },
    ]);
    assert.equal(scan.total_minutes, 50);
    assert.equal(scan.total_days, 2);
  });
});

test('minScore filters weak days and is validated', () => {
  const path = journalFile('min-score');
  withJournalWrite(path, (db) => {
    const task = createLongTask(db, { title: 'Ship the release checklist', apps: ['VS Code'] });
    const days = [
      day('2026-06-02', [activity({ recordId: 41, title: 'Release notes', minutes: 30 })]), // score 2
      day('2026-06-01', [activity({ recordId: 42, title: 'Editing', apps: ['VS Code'], minutes: 15 })]), // score 1
    ];

    assert.deepEqual(
      scanTaskHistory(db, task.id, days).days.map((candidate) => candidate.day),
      ['2026-06-02'],
      'a single app hit is below the default minScore of 2',
    );
    assert.deepEqual(
      scanTaskHistory(db, task.id, days, { minScore: 1 }).days.map((candidate) => [candidate.day, candidate.score]),
      [
        ['2026-06-02', 2],
        ['2026-06-01', 1],
      ],
    );
    assert.deepEqual(scanTaskHistory(db, task.id, days, { minScore: 5 }).days, []);
    assert.throws(() => scanTaskHistory(db, task.id, days, { minScore: 'two' as unknown as number }), isInvalidInput);
    assert.throws(() => scanTaskHistory(db, task.id, days, { minScore: Number.NaN }), isInvalidInput);
    assert.throws(() => scanTaskHistory(db, task.id, days, { minScore: Number.POSITIVE_INFINITY }), isInvalidInput);
    assert.throws(() => scanTaskHistory(db, task.id, days, { minScore: 0 }), isInvalidInput);
  });
});

test('a day that already has a session is skipped and other days still match', () => {
  const path = journalFile('attached-skip');
  withJournalWrite(path, (db) => {
    const task = createLongTask(db, { title: 'Ship the release checklist' });
    attachTaskSession(db, task.id, { day: '2026-06-02', minutes: 20, activity_ids: [51] });
    const before = sessionCount(path, task.id);

    const scan = scanTaskHistory(db, task.id, [
      day('2026-06-02', [activity({ recordId: 51, title: 'Release checklist review', minutes: 20 })]),
      day('2026-06-01', [activity({ recordId: 52, title: 'Release checklist draft', minutes: 35 })]),
    ]);
    assert.deepEqual(scan.days, [
      {
        day: '2026-06-01',
        minutes: 35,
        activity_ids: [52],
        score: 4,
        reasons: ['keyword:release', 'keyword:checklist'],
        titles: ['Release checklist draft'],
      },
    ]);
    assert.equal(scan.total_minutes, 35);
    assert.equal(scan.total_days, 1);
    assert.equal(sessionCount(path, task.id), before, 'scanning must not attach or detach anything');
  });
});

test('day keys are validated, days come newest first, and maxCandidateDays caps the answer', () => {
  const path = journalFile('dates');
  withJournalWrite(path, (db) => {
    const task = createLongTask(db, { title: 'Ship the release checklist' });
    const days = [
      day('2026-06-01', [activity({ recordId: 61, title: 'Release checklist', minutes: 10 })]),
      day('2026-06-03', [activity({ recordId: 63, title: 'Release checklist', minutes: 30 })]),
      day('2026-06-02', [activity({ recordId: 62, title: 'Release checklist', minutes: 20 })]),
    ];

    const scan = scanTaskHistory(db, task.id, days);
    assert.deepEqual(
      scan.days.map((candidate) => candidate.day),
      ['2026-06-03', '2026-06-02', '2026-06-01'],
      'newest day first',
    );
    assert.equal(scan.total_minutes, 60);
    assert.equal(scan.total_days, 3);

    const newest = scanTaskHistory(db, task.id, days, { maxCandidateDays: 1 });
    assert.deepEqual(
      newest.days.map((candidate) => candidate.day),
      ['2026-06-03'],
    );
    assert.equal(newest.total_days, 1);
    assert.equal(newest.total_minutes, 30);

    assert.throws(() => scanTaskHistory(db, task.id, [day('06/01/2026', [])]), isInvalidInput);
    assert.throws(() => scanTaskHistory(db, task.id, [day('2026-02-30', [])]), isInvalidInput);
    assert.throws(() => scanTaskHistory(db, task.id, [day('2026-6-1', [])]), isInvalidInput);
    assert.throws(() => scanTaskHistory(db, task.id, days, { maxCandidateDays: 0 }), isInvalidInput);
    assert.throws(() => scanTaskHistory(db, task.id, days, { maxCandidateDays: 91 }), isInvalidInput);
    assert.throws(() => scanTaskHistory(db, task.id, days, { maxCandidateDays: 1.5 }), isInvalidInput);
    assert.throws(
      () => scanTaskHistory(db, task.id, days, { maxCandidateDays: 'many' as unknown as number }),
      isInvalidInput,
    );
    assert.deepEqual(scanTaskHistory(db, task.id, days, { maxCandidateDays: 90 }).total_days, 3);
  });
});

test('only an active task can scan: an unknown id is not_found and another status is invalid_input', () => {
  const path = journalFile('status');
  // A brand-new journal is created by openJournal; the scanner reads it as-is.
  const db = openJournal(path);
  try {
    const active = createLongTask(db, { title: 'Ship the release checklist' });
    assert.deepEqual(scanTaskHistory(db, active.id, []), {
      task_id: active.id,
      title: 'Ship the release checklist',
      days: [],
      total_minutes: 0,
      total_days: 0,
    });

    assert.throws(() => scanTaskHistory(db, 999, []), isNotFound);
    assert.throws(() => scanTaskHistory(db, 0, []), isNotFound);

    const paused = createLongTask(db, { title: 'Release checklist paused' });
    updateLongTaskStatus(db, paused.id, 'paused');
    assert.throws(() => scanTaskHistory(db, paused.id, []), isInvalidInput);

    const done = createLongTask(db, { title: 'Release checklist done' });
    updateLongTaskStatus(db, done.id, 'done');
    assert.throws(() => scanTaskHistory(db, done.id, []), isInvalidInput);
  } finally {
    db.close();
  }
});

test('scanning is read-only: a read-only journal can scan and nothing is written', () => {
  const path = journalFile('read-only');
  let taskId = 0;
  withJournalWrite(path, (db) => {
    const task = createLongTask(db, { title: 'Ship the release checklist' });
    taskId = task.id;
    attachTaskSession(db, task.id, { day: '2026-05-31', minutes: 5, activity_ids: [71] });
  });
  const sessionsBefore = sessionCount(path, taskId);
  const tasksBefore = queryRow(path, 'SELECT count(*) AS count FROM long_tasks')?.count;
  const schemaBefore = queryRow(path, 'SELECT version FROM schema_version ORDER BY version LIMIT 1')?.version;

  // withJournal opens the journal read-only, so a write inside the scanner would throw.
  const scan = withJournal(path, (db) =>
    scanTaskHistory(db, taskId, [
      day('2026-06-02', [activity({ recordId: 72, title: 'Release checklist review', minutes: 25 })]),
      day('2026-05-31', [activity({ recordId: 73, title: 'Release checklist old work', minutes: 40 })]),
    ]),
  );
  assert.deepEqual(
    scan.days.map((candidate) => candidate.day),
    ['2026-06-02'],
    'the already-attached day is skipped on a read-only connection too',
  );
  assert.equal(sessionCount(path, taskId), sessionsBefore, 'scanning wrote no sessions');
  assert.equal(queryRow(path, 'SELECT count(*) AS count FROM long_tasks')?.count, tasksBefore, 'scanning wrote no tasks');
  assert.equal(
    queryRow(path, 'SELECT version FROM schema_version ORDER BY version LIMIT 1')?.version,
    schemaBefore,
    'scanning did not migrate or revise the schema',
  );
});

test('a title made only of stop words never matches any activity', () => {
  const path = journalFile('stop-words');
  withJournalWrite(path, (db) => {
    const task = createLongTask(db, { title: 'The of and to' });
    const scan = scanTaskHistory(db, task.id, [
      day('2026-06-02', [
        activity({ recordId: 81, title: 'The of and to', summary: 'the of and to', minutes: 50 }),
        activity({ recordId: 82, title: 'Work, work, work', summary: 'is are was it', minutes: 90 }),
      ]),
    ]);
    assert.deepEqual(scan, {
      task_id: task.id,
      title: 'The of and to',
      days: [],
      total_minutes: 0,
      total_days: 0,
    });

    const cjkTask = createLongTask(db, { title: '的 了 和' });
    assert.deepEqual(
      scanTaskHistory(db, cjkTask.id, [
        day('2026-06-03', [activity({ recordId: 83, title: '的了对', summary: '和的', minutes: 30 })]),
      ]).days,
      [],
      'CJK stop words are dropped too',
    );
  });
});
