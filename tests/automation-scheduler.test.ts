/**
 * The automation scheduler: the day/week boundary clock, the bounded catch-up,
 * the automation ledger lifecycle, and the timer seam.
 *
 * Every case runs against a disposable journal under `mkdtemp` with an injected
 * clock and injected timers; the close callbacks are spies, so no case calls a
 * model, opens a network connection, or captures the screen. A case advances the
 * clock by setting the injected `now` and drives the loop by awaiting
 * {@link AutomationScheduler.runDue} or by firing the recorded timer.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  AUTOMATION_MAX_BACKOFF_DOUBLINGS,
  AUTOMATION_RETRY_BASE_MS,
  AutomationScheduler,
} from '../src/automation/scheduler.js';
import type { AutomationCloseOutcome, AutomationSchedulerTimers } from '../src/automation/scheduler.js';
import {
  AUTOMATION_MAX_ATTEMPTS,
  completeAutomationRun,
  ensureAutomationRun,
  getAutomationRun,
  listAutomationRuns,
  startAutomationRun,
} from '../src/automation/store.js';
import type { AutomationJob, AutomationRun } from '../src/automation/store.js';
import { resolveConfig } from '../src/config.js';
import type { AutomationConfig, ResolvedConfig } from '../src/config.js';
import { openJournal, withJournal, withJournalWrite } from '../src/journal.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-automation-scheduler-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));

/** The fixed local clock every case starts from: Friday 2026-11-27, 13:00. */
const FRIDAY_13 = new Date(2026, 10, 27, 13, 0, 0, 0);

/** The day the 2026-11-27 04:00 boundary closed. */
const DUE_DAY = '2026-11-26';

/** The previous day, the other day inside the default two-day catch-up window. */
const CATCH_UP_DAY = '2026-11-25';

/** The day just outside the default window; it is archived, never fabricated. */
const OLDER_DAY = '2026-11-24';

/** Seeded "last close" days used by most cases. */
const SETTLED_DAY = '2026-11-23';
const SETTLED_WEEK = '2026-11-16';

let fixtureCount = 0;

/** One disposable journal plus the config that points at it. */
interface Fixture {
  journalPath: string;
  config: ResolvedConfig;
}

/** Create a migrated journal and the resolved config over it. */
function createFixture(automation: Partial<AutomationConfig> = {}): Fixture {
  fixtureCount += 1;
  const root = join(directory, `case-${String(fixtureCount)}`);
  const journalPath = join(root, 'journal.sqlite');
  openJournal(journalPath).close();
  const config = resolveConfig({
    databasePath: join(root, 'chunks.sqlite'),
    journalPath,
    source: 'owned',
    automation: { ...automation },
  });
  return { journalPath, config };
}

/** One timer the scheduler armed through the injected seam. */
interface ScheduledTimer {
  id: number;
  callback: () => void;
  milliseconds: number;
  cleared: boolean;
}

/** The timer seam plus the assertions surface: what is pending and how to fire it. */
interface FakeTimers extends AutomationSchedulerTimers {
  readonly scheduled: ScheduledTimer[];
  pending(): ScheduledTimer[];
  fireNext(): Promise<void>;
}

/** Build the injected timer seam and record every delay the scheduler asks for. */
function createFakeTimers(): FakeTimers {
  const scheduled: ScheduledTimer[] = [];
  let nextId = 1;
  const timers: FakeTimers = {
    scheduled,
    setTimeout(callback, milliseconds) {
      const timer: ScheduledTimer = { id: nextId, callback, milliseconds, cleared: false };
      nextId += 1;
      scheduled.push(timer);
      return timer.id;
    },
    clearTimeout(handle) {
      const timer = scheduled.find((entry) => entry.id === handle);
      if (timer !== undefined) timer.cleared = true;
    },
    pending() {
      return scheduled.filter((entry) => !entry.cleared);
    },
    async fireNext() {
      const next = timers.pending()[0];
      if (next === undefined) throw new Error('the scheduler armed no timer to fire');
      next.cleared = true;
      next.callback();
      await settle();
    },
  };
  return timers;
}

/**
 * Let an async pass settle.
 *
 * The fake timers replace only the scheduler's timer; the process timer is still
 * available, so a zero-delay timeout flushes the pass's microtasks.
 */
async function settle(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/** One scheduler plus its spies, clock, and timer seam. */
interface Harness {
  scheduler: AutomationScheduler;
  timers: FakeTimers;
  dayCalls: string[];
  weekCalls: string[];
  now: () => Date;
  setNow(next: Date): void;
  status(): ReturnType<AutomationScheduler['status']>;
}

/** Build a scheduler over one fixture with a fixed clock and scripted callbacks. */
function createHarness(
  fixture: Fixture,
  options: {
    now?: Date;
    dayClose?: (day: string) => AutomationCloseOutcome | Promise<AutomationCloseOutcome>;
    weekClose?: (monday: string) => AutomationCloseOutcome | Promise<AutomationCloseOutcome>;
  } = {},
): Harness {
  const timers = createFakeTimers();
  let current = options.now ?? FRIDAY_13;
  const now = (): Date => new Date(current.getTime());
  const dayCalls: string[] = [];
  const weekCalls: string[] = [];
  const scheduler = new AutomationScheduler({
    journalPath: fixture.journalPath,
    config: fixture.config,
    runDayClose: async (day) => {
      dayCalls.push(day);
      const outcome = options.dayClose?.(day);
      return outcome === undefined ? { status: 'complete' } : await outcome;
    },
    runWeekClose: async (monday) => {
      weekCalls.push(monday);
      const outcome = options.weekClose?.(monday);
      return outcome === undefined ? { status: 'complete' } : await outcome;
    },
    now,
    timers,
  });
  return {
    scheduler,
    timers,
    dayCalls,
    weekCalls,
    now,
    setNow(next: Date): void {
      current = next;
    },
    status: () => scheduler.status(),
  };
}

/** Seed one terminal run in the ledger, as an earlier process would have left it. */
function seedRun(fixture: Fixture, job: AutomationJob, day: string): void {
  withJournalWrite(fixture.journalPath, (db) => {
    const ensured = ensureAutomationRun(db, job, day);
    const started = startAutomationRun(db, ensured.id);
    completeAutomationRun(db, started.id, { status: 'complete' });
  });
}

/** Read one run from the ledger, if it exists. */
function runOf(fixture: Fixture, job: AutomationJob, day: string): AutomationRun | undefined {
  return withJournal(fixture.journalPath, (db) => getAutomationRun(db, job, day));
}

/** Read every run of one job. */
function runsOf(fixture: Fixture, job: AutomationJob): AutomationRun[] {
  return withJournal(fixture.journalPath, (db) => listAutomationRuns(db, { job, limit: 200 }));
}

/** The local epoch milliseconds of a wall-clock time on a calendar date. */
function instant(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

/** The next boundary as a delay from a clock instant. */
function delayTo(next: Date, from: Date): number {
  return next.getTime() - from.getTime();
}

// ---------------------------------------------------------------------------
// Start, catch-up, and idempotency
// ---------------------------------------------------------------------------

test('start closes the due day and its catch-up window, then a second pass is a no-op', async () => {
  const fixture = createFixture();
  seedRun(fixture, 'week_close', SETTLED_WEEK);
  const owned = createHarness(fixture);

  owned.scheduler.start();
  await settle();

  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY, DUE_DAY], 'the window is closed oldest first');
  assert.deepEqual(owned.weekCalls, [], 'a settled week is not closed again');

  for (const day of [CATCH_UP_DAY, DUE_DAY]) {
    const run = runOf(fixture, 'day_close', day);
    assert.ok(run, `${day} has a ledger row`);
    assert.equal(run.status, 'complete');
    assert.equal(run.attempts, 1);
    assert.deepEqual(run.payload, { status: 'complete' });
  }

  const status = owned.status();
  assert.equal(status.enabled, true);
  assert.equal(status.running, false, 'a settled pass is not running');
  assert.equal(status.dailyAt, '04:00');
  assert.equal(status.weeklyOn, 'monday');
  assert.equal(status.catchUpDays, 2);
  assert.deepEqual(status.lastDayClose, { day: DUE_DAY, status: 'complete', at: FRIDAY_13.getTime() });
  assert.equal(status.lastWeekClose?.monday, SETTLED_WEEK, 'the ledger is read back as the last week close');
  const nextBoundary = instant(2026, 11, 28, 4);
  assert.equal(status.nextDayCloseAt, nextBoundary.getTime(), 'the next day boundary is 04:00 tomorrow');

  // One timer, waiting for the next boundary rather than a retry.
  assert.deepEqual(
    owned.timers.pending().map((timer) => timer.milliseconds),
    [delayTo(nextBoundary, FRIDAY_13)],
  );

  assert.deepEqual(await owned.scheduler.runDue(), {}, 'everything is settled: nothing is due');
  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY, DUE_DAY], 'a second pass never re-closes a day');
});

test('a three-day gap closes the window and archives the day just outside it', async () => {
  const fixture = createFixture();
  seedRun(fixture, 'week_close', SETTLED_WEEK);
  seedRun(fixture, 'day_close', SETTLED_DAY);
  const owned = createHarness(fixture);

  const due = await owned.scheduler.runDue();

  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY, DUE_DAY], 'only the two days inside the window run');
  assert.deepEqual(due, { day: DUE_DAY }, 'the newest attempted day is reported');

  const archived = runOf(fixture, 'day_close', OLDER_DAY);
  assert.ok(archived, 'the first day older than the window is recorded');
  assert.equal(archived.status, 'skipped');
  assert.equal(archived.attempts, 0, 'an archived day never called a model');
  assert.equal(archived.error, 'older-than-catch-up');

  // Nothing before the archived boundary is invented: no row, no callback.
  assert.equal(runOf(fixture, 'day_close', '2026-11-22'), undefined);
  assert.equal(owned.dayCalls.includes('2026-11-22'), false);
  assert.equal(runOf(fixture, 'day_close', SETTLED_DAY)?.status, 'complete', 'the seeded run is untouched');
  assert.deepEqual(
    owned.status().lastDayClose,
    { day: DUE_DAY, status: 'complete', at: FRIDAY_13.getTime() },
    'archiving an older day does not hide the newest close',
  );

  // A second pass finds every day settled and adds nothing.
  await owned.scheduler.runDue();
  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY, DUE_DAY]);
});

test('a first start records the scheduled pass in the ledger only once', async () => {
  const fixture = createFixture();
  seedRun(fixture, 'week_close', SETTLED_WEEK);
  const owned = createHarness(fixture);

  owned.scheduler.start();
  await settle();
  owned.scheduler.stop();
  owned.scheduler.start();
  await settle();
  owned.scheduler.stop();

  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY, DUE_DAY], 'a restart resumes without replaying a close');
  assert.equal(runsOf(fixture, 'day_close').length, 2, 'one row per day, not one per pass');
});

// ---------------------------------------------------------------------------
// Weekly close
// ---------------------------------------------------------------------------

test('the week close runs once on the configured weekday and its period is the week that ended', async () => {
  const fixture = createFixture();
  seedRun(fixture, 'day_close', '2026-11-28');
  seedRun(fixture, 'week_close', SETTLED_WEEK);
  const owned = createHarness(fixture, { now: instant(2026, 11, 29, 13) });

  // Sunday, before the Monday boundary: nothing new to close.
  await owned.scheduler.runDue();
  assert.deepEqual(owned.weekCalls, [], 'no week close before the weekly boundary');

  // Monday after the boundary: the week that ended at 04:00 closes.
  owned.setNow(instant(2026, 11, 30, 12));
  const due = await owned.scheduler.runDue();
  assert.deepEqual(owned.weekCalls, ['2026-11-23'], 'the period is the Monday of the week that ended');
  assert.deepEqual(due, { day: '2026-11-29', week: '2026-11-23' });
  const weekRun = runOf(fixture, 'week_close', '2026-11-23');
  assert.equal(weekRun?.status, 'complete');
  assert.deepEqual(owned.status().lastWeekClose, {
    monday: '2026-11-23',
    status: 'complete',
    at: instant(2026, 11, 30, 12).getTime(),
  });
  assert.equal(
    owned.status().nextDayCloseAt,
    instant(2026, 12, 1, 4).getTime(),
    'after the boundary the next close is the following day',
  );

  // Running the same period again is a no-op.
  await owned.scheduler.runDue();
  assert.deepEqual(owned.weekCalls, ['2026-11-23']);
});

test('a missed week catches up the previous period and archives the one outside the window', async () => {
  const fixture = createFixture();
  seedRun(fixture, 'week_close', '2026-11-02');
  const owned = createHarness(fixture, { now: instant(2026, 12, 7, 12) });

  const due = await owned.scheduler.runDue();

  assert.deepEqual(owned.weekCalls, ['2026-11-23', '2026-11-30'], 'the weekly window is two periods, oldest first');
  assert.equal(due.week, '2026-11-30');
  const archived = runOf(fixture, 'week_close', '2026-11-16');
  assert.equal(archived?.status, 'skipped');
  assert.equal(archived?.error, 'older-than-catch-up');
  assert.equal(runOf(fixture, 'week_close', '2026-11-09'), undefined, 'an older period is never fabricated');
});

// ---------------------------------------------------------------------------
// Failure, retry, and the other jobs
// ---------------------------------------------------------------------------

test('a failed close retries to the attempts cap, records the failure, and never blocks the week', async () => {
  const fixture = createFixture();
  seedRun(fixture, 'week_close', '2026-11-09');
  const owned = createHarness(fixture, {
    dayClose: () => ({ status: 'failed', error: 'model unavailable' }),
  });

  owned.scheduler.start();
  await settle();
  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY, DUE_DAY]);
  assert.deepEqual(owned.weekCalls, [SETTLED_WEEK], 'a failing day does not block the week close');
  for (const day of [CATCH_UP_DAY, DUE_DAY]) {
    const run = runOf(fixture, 'day_close', day);
    assert.equal(run?.status, 'failed');
    assert.equal(run?.attempts, 1);
    assert.equal(run?.error, 'model unavailable');
  }
  assert.equal(owned.status().lastDayClose?.status, 'failed');
  assert.equal(owned.status().lastWeekClose?.status, 'complete', 'the successful week close is recorded too');

  // The failure moved the next day pass earlier with a doubled delay.
  const retryDelay = AUTOMATION_RETRY_BASE_MS * 2 ** Math.min(2, AUTOMATION_MAX_BACKOFF_DOUBLINGS);
  assert.deepEqual(
    owned.timers.pending().map((timer) => timer.milliseconds),
    [retryDelay],
    'two consecutive failures double the retry delay',
  );

  const second = await owned.scheduler.runDue();
  assert.equal(owned.dayCalls.length, 4, 'the second pass retried both days');
  assert.deepEqual(second, { day: DUE_DAY });
  assert.deepEqual(
    owned.weekCalls,
    [SETTLED_WEEK],
    'the settled week is not called a second time',
  );
  for (const day of [CATCH_UP_DAY, DUE_DAY]) {
    const run = runOf(fixture, 'day_close', day);
    assert.equal(run?.attempts, AUTOMATION_MAX_ATTEMPTS);
    assert.equal(run?.status, 'failed');
  }

  // The attempts cap is terminal: another pass does not call the callback again.
  await owned.scheduler.runDue();
  assert.equal(owned.dayCalls.length, 4, 'a failed-cap run is never retried again');
  owned.scheduler.stop();
});

test('a rejecting close callback becomes a failed run instead of a thrown pass', async () => {
  const fixture = createFixture();
  seedRun(fixture, 'week_close', SETTLED_WEEK);
  const owned = createHarness(fixture, {
    dayClose: () => {
      throw new Error('the model stream dropped');
    },
  });

  await assert.doesNotReject(() => owned.scheduler.runDue());

  const run = runOf(fixture, 'day_close', CATCH_UP_DAY);
  assert.equal(run?.status, 'failed');
  assert.equal(run?.attempts, 1);
  assert.equal(run?.error, 'the model stream dropped');
});

test('a stale running row is skipped instead of rerun', async () => {
  const fixture = createFixture();
  seedRun(fixture, 'week_close', SETTLED_WEEK);
  withJournalWrite(fixture.journalPath, (db) => {
    const ensured = ensureAutomationRun(db, 'day_close', DUE_DAY);
    startAutomationRun(db, ensured.id);
    // Left running: a crash between "started" and "recorded".
  });
  const owned = createHarness(fixture);

  await owned.scheduler.runDue();

  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY], 'only the day without a run is closed');
  const stale = runOf(fixture, 'day_close', DUE_DAY);
  assert.equal(stale?.status, 'skipped');
  assert.equal(stale?.error, 'stale-running');

  await owned.scheduler.runDue();
  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY]);
});

// ---------------------------------------------------------------------------
// Disabled, timers, and the boundary clock
// ---------------------------------------------------------------------------

test('automation disabled arms no timer and runs nothing', async () => {
  const fixture = createFixture({ enabled: false });
  const owned = createHarness(fixture);

  owned.scheduler.start();
  await settle();
  assert.deepEqual(owned.timers.pending(), [], 'a disabled scheduler arms no timer');
  assert.deepEqual(owned.dayCalls, []);
  assert.deepEqual(owned.weekCalls, []);
  assert.deepEqual(await owned.scheduler.runDue(), {});
  assert.equal(owned.status().enabled, false);
  assert.equal(owned.status().nextDayCloseAt, undefined, 'nothing is scheduled while disabled');

  await owned.scheduler.runDay(DUE_DAY);
  assert.deepEqual(owned.dayCalls, []);
  assert.deepEqual(runsOf(fixture, 'day_close'), [], 'a disabled scheduler writes no ledger row');
  owned.scheduler.stop();
});

test('double start arms one timer, stop clears it, and firing the timer re-arms the loop', async () => {
  const fixture = createFixture();
  seedRun(fixture, 'week_close', SETTLED_WEEK);
  const owned = createHarness(fixture);

  owned.scheduler.start();
  await settle();
  owned.scheduler.start();
  await settle();
  assert.equal(owned.timers.pending().length, 1, 'a double start keeps one timer');
  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY, DUE_DAY], 'the double start did not run a second pass');

  await owned.timers.fireNext();
  assert.equal(owned.timers.pending().length, 1, 'the timer tick re-arms the loop');
  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY, DUE_DAY], 'the tick found nothing due');

  owned.scheduler.stop();
  assert.deepEqual(owned.timers.pending(), [], 'stop clears the pending timer');
  assert.equal(owned.status().running, false);

  // A restart after the boundary closes only the new due day.
  owned.setNow(instant(2026, 11, 28, 12));
  owned.scheduler.start();
  await settle();
  assert.deepEqual(owned.dayCalls, [CATCH_UP_DAY, DUE_DAY, '2026-11-27']);
  owned.scheduler.stop();
});

test('the boundary clock picks the day that just ended and the next 04:00', async () => {
  const fixture = createFixture();
  seedRun(fixture, 'week_close', SETTLED_WEEK);
  const owned = createHarness(fixture, { now: instant(2026, 11, 27, 3) });

  // Before 04:00 the most recent boundary is yesterday's, so it closed 11-25.
  assert.equal(
    owned.status().nextDayCloseAt,
    instant(2026, 11, 27, 4).getTime(),
    'before the boundary the next close is later today',
  );
  assert.deepEqual(await owned.scheduler.runDue(), { day: CATCH_UP_DAY });
  assert.deepEqual(owned.dayCalls, ['2026-11-24', CATCH_UP_DAY], 'the window ends at the day just closed');

  // After 04:00 the boundary closed 11-26, and the catch-up window moves with it.
  owned.setNow(instant(2026, 11, 27, 5));
  assert.equal(owned.status().nextDayCloseAt, instant(2026, 11, 28, 4).getTime());
  assert.deepEqual(await owned.scheduler.runDue(), { day: DUE_DAY });
  assert.deepEqual(owned.dayCalls, ['2026-11-24', CATCH_UP_DAY, DUE_DAY]);
});

test('catchUpOnStart false closes only the due day and archives the missed ones', async () => {
  const fixture = createFixture({ catchUpOnStart: false });
  seedRun(fixture, 'week_close', SETTLED_WEEK);
  seedRun(fixture, 'day_close', SETTLED_DAY);
  const owned = createHarness(fixture);

  await owned.scheduler.runDue();

  assert.deepEqual(owned.dayCalls, [DUE_DAY], 'no replay of missed days on start');
  const archived = runOf(fixture, 'day_close', CATCH_UP_DAY);
  assert.equal(archived?.status, 'skipped');
  assert.equal(archived?.error, 'older-than-catch-up');
  assert.equal(runOf(fixture, 'day_close', OLDER_DAY), undefined);
});
