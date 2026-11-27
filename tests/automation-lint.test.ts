/**
 * The weekly memory lint pass: a read-only checkup whose only output is review
 * proposals plus one `automation_runs` row for the week.
 *
 * The pass is not a repair job. A contradiction, a superseded-by-newer pair, an
 * unsourced claim, and an aged claim all become suggestions in the review queue;
 * the claims themselves must stay byte-for-byte unchanged, with no
 * `superseded_by` ever written. The pass is idempotent per Monday: a second run
 * for the same week is a no-op, and only `force` recomputes the recorded payload.
 *
 * Every case runs against a disposable journal under `mkdtemp` — never the
 * default `$DSH_HOME` journal — and none of them opens a network connection.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  DEFAULT_WEEKLY_LINT_MAX_PROPOSALS,
  MAX_WEEKLY_LINT_MAX_PROPOSALS,
  WEEKLY_LINT_NOTHING_TO_REPORT,
  runWeeklyLint,
} from '../src/automation/lint.js';
import type { WeeklyLintOptions, WeeklyLintResult } from '../src/automation/lint.js';
import {
  ensureAutomationRun,
  getAutomationRun,
  listAutomationRuns,
} from '../src/automation/store.js';
import { resolveConfig } from '../src/config.js';
import type { ResolvedConfig } from '../src/config.js';
import { DayflowError } from '../src/errors.js';
import { openJournal, withJournal, withJournalWrite } from '../src/journal.js';
import { addMemoryClaim, lintMemoryClaims } from '../src/memory.js';
import type { AddMemoryClaimInput, MemoryLintReport } from '../src/memory.js';
import { decideReviewItem, listReviewItems, proposeReviewItem } from '../src/review.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-weekly-lint-'));
after(() => rmSync(directory, { recursive: true, force: true }));

/** The clock every aging assertion is relative to: 2026-11-25 noon local. */
const NOW = new Date(2026, 10, 25, 12, 0, 0);
/** The Monday of the week under test (2026-11-16); its aging horizon is 2026-05-29. */
const WEEK = '2026-11-16';
/** The following Monday, for "next week can propose again" cases. */
const NEXT_WEEK = '2026-11-23';

let fixtureCounter = 0;

/** One disposable journal plus the config that reads it. */
interface Fixture {
  journalPath: string;
  config: ResolvedConfig;
}

/** Create a migrated, empty journal and its resolved config. */
function createFixture(): Fixture {
  fixtureCounter += 1;
  const root = join(directory, `case-${String(fixtureCounter)}`);
  const journalPath = join(root, 'journal.sqlite');
  const config = resolveConfig({
    databasePath: join(root, 'chunks.sqlite'),
    journalPath,
    source: 'owned',
  });
  openJournal(journalPath).close();
  return { journalPath, config };
}

/** The options every case passes, with per-case overrides. */
function lintOptions(fixture: Fixture, overrides: Partial<WeeklyLintOptions> = {}): WeeklyLintOptions {
  return {
    journalPath: fixture.journalPath,
    config: fixture.config,
    weekMonday: WEEK,
    now: () => NOW,
    ...overrides,
  };
}

/** Seed memory claims into a journal. */
function seedClaims(journalPath: string, specs: readonly AddMemoryClaimInput[]): void {
  withJournalWrite(journalPath, (db) => {
    for (const spec of specs) addMemoryClaim(db, spec);
  });
}

/**
 * The claims that make the report show all four finding kinds.
 *
 * Contradiction: "Planning" has two active claims that disagree (which is also
 * the shape of one superseded-by-newer pair). Superseded pair without a
 * contradiction: "Review cadence" holds the same body with different spacing
 * and dates. Unsourced: "Deep work" has neither a review item nor evidence days.
 * Aged: "Tooling" was observed before the 180-day horizon.
 */
function seedDirtyClaims(journalPath: string): void {
  seedClaims(journalPath, [
    {
      kind: 'preference',
      subject: 'Planning',
      body: 'The user plans the week on paper.',
      observed_on: '2026-11-02',
      source_days: ['2026-11-02'],
    },
    {
      kind: 'preference',
      subject: 'Planning',
      body: 'The user plans the week in the panel.',
      observed_on: '2026-11-03',
      source_days: ['2026-11-03'],
    },
    {
      kind: 'loop',
      subject: 'Review cadence',
      body: 'The standup draft repeats yesterday.',
      observed_on: '2026-11-04',
      source_days: ['2026-11-04'],
    },
    {
      kind: 'loop',
      subject: 'Review cadence',
      body: '  the standup draft repeats   yesterday. ',
      observed_on: '2026-11-05',
      source_days: ['2026-11-05'],
    },
    {
      kind: 'distillation',
      subject: 'Deep work',
      body: 'The user does deep work before noon.',
      observed_on: '2026-11-06',
    },
    {
      kind: 'correction',
      subject: 'Tooling',
      body: 'The user prefers the CLI.',
      observed_on: '2026-01-05',
      source_days: ['2026-01-05'],
    },
  ]);
}

/** Every `memory_claims` row as one stable string, for byte-for-byte comparison. */
function claimRows(journalPath: string): string {
  const db = new DatabaseSync(journalPath, { readOnly: true });
  try {
    return JSON.stringify(db.prepare('SELECT * FROM memory_claims ORDER BY id').all());
  } finally {
    db.close();
  }
}

/** How many claims carry a `superseded_by`, which lint must never set. */
function supersededCount(journalPath: string): number {
  const db = new DatabaseSync(journalPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM memory_claims WHERE superseded_by IS NOT NULL').get() as {
      count: number;
    };
    return Number(row.count);
  } finally {
    db.close();
  }
}

/** The lint report a fixture produces, read through a fresh read connection. */
function reportFor(path: string): MemoryLintReport {
  return withJournal(path, (db) => lintMemoryClaims(db, { now: NOW }));
}

/** The review items the queue currently holds, newest first. */
function reviewItems(path: string, status?: 'proposed' | 'discarded' | 'rejected') {
  return withJournal(path, (db) => listReviewItems(db, status === undefined ? {} : { status }));
}

/** The ledger row of the weekly lint for one Monday. */
function lintRun(path: string, monday = WEEK) {
  return withJournal(path, (db) => getAutomationRun(db, 'lint', monday));
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

test('the first run scans read-only and proposes at most one improvement per subject', async () => {
  const fixture = createFixture();
  seedDirtyClaims(fixture.journalPath);
  const before = claimRows(fixture.journalPath);

  const report = reportFor(fixture.journalPath);
  assert.equal(report.scanned, 6);
  assert.equal(report.contradictions.length, 1);
  assert.equal(report.supersededByNewer.length, 2);
  assert.equal(report.unsourced.length, 1);
  assert.equal(report.aged.length, 1);
  const expectedFindings =
    report.contradictions.length + report.supersededByNewer.length + report.unsourced.length + report.aged.length;
  assert.equal(expectedFindings, 5);

  const result = await runWeeklyLint(lintOptions(fixture));
  assert.equal(result.status, 'complete');
  assert.equal(result.scanned, 6);
  assert.equal(result.findings, 5);
  assert.equal(result.proposals, DEFAULT_WEEKLY_LINT_MAX_PROPOSALS);
  assert.equal(result.reason, undefined);
  assert.equal(result.summary, '5 findings across 6 active claims; 3 proposals queued.');

  // The month is one ledger row, complete, with the digest as its payload.
  const run = lintRun(fixture.journalPath);
  assert.equal(run?.status, 'complete');
  assert.equal(run?.attempts, 1);
  assert.deepEqual(run?.payload, {
    scanned: 6,
    findings: 5,
    proposals: 3,
    summary: result.summary,
  });
  assert.equal(withJournal(fixture.journalPath, (db) => listAutomationRuns(db, { job: 'lint' })).length, 1);

  // Exactly the three strongest subjects become improvement proposals, once each.
  const items = reviewItems(fixture.journalPath);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => item.title).sort(), [
    'Memory check: Deep work',
    'Memory check: Planning',
    'Memory check: Review cadence',
  ]);
  for (const item of items) {
    assert.equal(item.kind, 'improvement');
    assert.equal(item.status, 'proposed');
    assert.equal(item.source_day, WEEK);
    assert.equal(item.confidence, 0.7);
    assert.match(item.body, /changed nothing/);
    assert.match(item.evidence ?? '', new RegExp(WEEK));
  }
  assert.equal(new Set(items.map((item) => item.title)).size, items.length, 'one proposal per subject');

  // The scan changed nothing: same rows, byte for byte, and no superseded_by.
  assert.equal(claimRows(fixture.journalPath), before);
  assert.equal(supersededCount(fixture.journalPath), 0);

  // The same week is a no-op: skipped with the recorded digest, no new items.
  const second = await runWeeklyLint(lintOptions(fixture));
  assert.equal(second.status, 'skipped');
  assert.equal(second.reason, 'already-complete');
  assert.equal(second.scanned, 6);
  assert.equal(second.findings, 5);
  assert.equal(second.proposals, 3);
  assert.equal(second.summary, result.summary);
  assert.equal(reviewItems(fixture.journalPath).length, 3);
  assert.equal(withJournal(fixture.journalPath, (db) => listAutomationRuns(db, { job: 'lint' })).length, 1);
  assert.equal(claimRows(fixture.journalPath), before);
});

test('a clean or empty week completes with nothing to report', async () => {
  const empty = createFixture();
  const emptyResult = await runWeeklyLint(lintOptions(empty));
  assert.equal(emptyResult.status, 'complete');
  assert.equal(emptyResult.scanned, 0);
  assert.equal(emptyResult.findings, 0);
  assert.equal(emptyResult.proposals, 0);
  assert.equal(emptyResult.summary, WEEKLY_LINT_NOTHING_TO_REPORT);
  assert.equal(WEEKLY_LINT_NOTHING_TO_REPORT, 'nothing to report');
  assert.equal((lintRun(empty.journalPath)?.payload as { summary?: string })?.summary, 'nothing to report');
  assert.equal(reviewItems(empty.journalPath).length, 0);
  const emptyAgain = await runWeeklyLint(lintOptions(empty));
  assert.equal(emptyAgain.status, 'skipped');
  assert.equal(emptyAgain.reason, 'already-complete');
  assert.equal(emptyAgain.summary, 'nothing to report');

  // A well-sourced, recent, unique claim is scanned but yields no finding.
  const clean = createFixture();
  seedClaims(clean.journalPath, [
    {
      kind: 'preference',
      subject: 'Planning',
      body: 'The user plans the week on paper.',
      observed_on: '2026-11-02',
      source_days: ['2026-11-02'],
    },
  ]);
  const cleanResult = await runWeeklyLint(lintOptions(clean));
  assert.equal(cleanResult.status, 'complete');
  assert.equal(cleanResult.scanned, 1);
  assert.equal(cleanResult.findings, 0);
  assert.equal(cleanResult.proposals, 0);
  assert.equal(cleanResult.summary, 'nothing to report');
  assert.equal(reviewItems(clean.journalPath).length, 0);
});

test('one subject never gets two proposals, even when two kinds find it', async () => {
  const fixture = createFixture();
  seedClaims(fixture.journalPath, [
    {
      kind: 'distillation',
      subject: 'Cross kind',
      body: 'One body.',
      observed_on: '2026-11-02',
    },
    {
      kind: 'correction',
      subject: 'Cross kind',
      body: 'Another body.',
      observed_on: '2026-11-03',
    },
  ]);
  const report = reportFor(fixture.journalPath);
  assert.equal(report.unsourced.length, 2);
  const result = await runWeeklyLint(lintOptions(fixture));
  assert.equal(result.status, 'complete');
  assert.equal(result.scanned, 2);
  assert.equal(result.findings, 2);
  assert.equal(result.proposals, 1);
  const items = reviewItems(fixture.journalPath);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, 'Memory check: Cross kind');
});

test('the proposal cap is honored', async () => {
  const fixture = createFixture();
  seedDirtyClaims(fixture.journalPath);
  const result = await runWeeklyLint(lintOptions(fixture, { maxProposals: 1 }));
  assert.equal(result.status, 'complete');
  assert.equal(result.findings, 5);
  assert.equal(result.proposals, 1);
  assert.match(result.summary, /1 proposal queued\.$/);
  assert.equal(reviewItems(fixture.journalPath).length, 1);
  assert.equal(reviewItems(fixture.journalPath)[0]?.title, 'Memory check: Planning');
});

test('a hard-suppressed proposal is never raised again, even in a later week', async () => {
  const fixture = createFixture();
  seedClaims(fixture.journalPath, [
    {
      kind: 'distillation',
      subject: 'Tooling',
      body: 'The user prefers the CLI.',
      observed_on: '2026-11-02',
    },
  ]);
  // Pre-suppress the exact fingerprint the lint would raise, the way a user who
  // hit "never propose this again" would have.
  withJournalWrite(fixture.journalPath, (db) => {
    const proposed = proposeReviewItem(db, {
      kind: 'improvement',
      title: 'Memory check: Tooling',
      confidence: 0.7,
      source_day: WEEK,
    });
    assert.equal(proposed.dropped, false);
    assert.ok(proposed.item !== undefined);
    const decided = decideReviewItem(db, proposed.item.id, 'reject', { forever: true });
    assert.equal(decided.suppression, 'hard');
  });

  const first = await runWeeklyLint(lintOptions(fixture));
  assert.equal(first.status, 'complete');
  assert.equal(first.findings, 1);
  assert.equal(first.proposals, 0);
  assert.match(first.summary, /1 finding across 1 active claim; 0 proposals queued\./);
  assert.match(first.summary, /1 proposal already queued or suppressed\./);
  assert.equal(reviewItems(fixture.journalPath, 'proposed').length, 0);

  const nextWeek = await runWeeklyLint(lintOptions(fixture, { weekMonday: NEXT_WEEK }));
  assert.equal(nextWeek.status, 'complete');
  assert.equal(nextWeek.findings, 1);
  assert.equal(nextWeek.proposals, 0);
  assert.equal(reviewItems(fixture.journalPath, 'proposed').length, 0);
});

test('a soft-discarded proposal may return for a different week, not the same one', async () => {
  const fixture = createFixture();
  seedClaims(fixture.journalPath, [
    {
      kind: 'distillation',
      subject: 'Tooling',
      body: 'The user prefers the CLI.',
      observed_on: '2026-11-02',
    },
  ]);
  withJournalWrite(fixture.journalPath, (db) => {
    const proposed = proposeReviewItem(db, {
      kind: 'improvement',
      title: 'Memory check: Tooling',
      confidence: 0.7,
      source_day: WEEK,
    });
    assert.ok(proposed.item !== undefined);
    const decided = decideReviewItem(db, proposed.item.id, 'reject');
    assert.equal(decided.suppression, 'soft');
  });

  // Same week's evidence: still soft-suppressed, so no new proposal.
  const first = await runWeeklyLint(lintOptions(fixture));
  assert.equal(first.status, 'complete');
  assert.equal(first.findings, 1);
  assert.equal(first.proposals, 0);

  // A different source day is materially new evidence, so the next week may raise it again.
  const nextWeek = await runWeeklyLint(lintOptions(fixture, { weekMonday: NEXT_WEEK }));
  assert.equal(nextWeek.status, 'complete');
  assert.equal(nextWeek.findings, 1);
  assert.equal(nextWeek.proposals, 1);
  const proposed = reviewItems(fixture.journalPath, 'proposed');
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0]?.title, 'Memory check: Tooling');
  assert.equal(proposed[0]?.source_day, NEXT_WEEK);
});

test('force recomputes a completed week without duplicating proposals', async () => {
  const fixture = createFixture();
  seedDirtyClaims(fixture.journalPath);
  const first = await runWeeklyLint(lintOptions(fixture));
  assert.equal(first.status, 'complete');
  const before = lintRun(fixture.journalPath);
  assert.equal(before?.attempts, 1);

  const forced = await runWeeklyLint(lintOptions(fixture, { force: true }));
  assert.equal(forced.status, 'complete');
  assert.equal(forced.reason, undefined);
  assert.equal(forced.scanned, 6);
  assert.equal(forced.findings, 5);
  assert.equal(forced.proposals, 0, 'every proposal is already queued');
  assert.equal(forced.summary, '5 findings across 6 active claims; 0 proposals queued. 3 proposals already queued or suppressed.');

  const after = lintRun(fixture.journalPath);
  assert.equal(after?.id, before?.id);
  assert.equal(after?.status, 'complete');
  assert.equal(after?.attempts, 1, 'a forced rerun does not claim a new attempt');
  assert.deepEqual(after?.payload, {
    scanned: 6,
    findings: 5,
    proposals: 0,
    summary: forced.summary,
  });
  assert.equal(reviewItems(fixture.journalPath).length, 3, 'no duplicate proposals');
});

test('a scan failure records the run failed and propagates', async () => {
  const fixture = createFixture();
  seedDirtyClaims(fixture.journalPath);
  const invalidClock = () => new Date('not-a-date');
  await assert.rejects(
    runWeeklyLint(lintOptions(fixture, { now: invalidClock })),
    (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
  );
  const failed = lintRun(fixture.journalPath);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.attempts, 1);
  assert.match(failed?.error ?? '', /valid Date/);
  assert.equal(reviewItems(fixture.journalPath).length, 0);
});

test('a forced rerun that fails leaves the earlier completed week intact', async () => {
  const fixture = createFixture();
  seedDirtyClaims(fixture.journalPath);
  const first = await runWeeklyLint(lintOptions(fixture));
  assert.equal(first.status, 'complete');
  const completed = lintRun(fixture.journalPath);
  assert.equal(completed?.status, 'complete');

  await assert.rejects(
    runWeeklyLint(lintOptions(fixture, { force: true, now: () => new Date('not-a-date') })),
    (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
  );
  const after = lintRun(fixture.journalPath);
  assert.equal(after?.status, 'complete');
  assert.deepEqual(after?.payload, completed?.payload);
  assert.equal(after?.error, undefined);
});

test('arguments are validated before anything is written', async () => {
  const fixture = createFixture();
  seedDirtyClaims(fixture.journalPath);

  await assert.rejects(runWeeklyLint(lintOptions(fixture, { weekMonday: '2026-11-17' })), isInvalidInput);
  await assert.rejects(runWeeklyLint(lintOptions(fixture, { weekMonday: '2026-11-16T00:00:00' })), isInvalidInput);
  await assert.rejects(runWeeklyLint(lintOptions(fixture, { weekMonday: '2026-02-30' })), isInvalidInput);
  await assert.rejects(runWeeklyLint(lintOptions(fixture, { weekMonday: '' })), isInvalidInput);
  await assert.rejects(runWeeklyLint(lintOptions(fixture, { weekMonday: 42 as never })), isInvalidInput);
  await assert.rejects(runWeeklyLint(lintOptions(fixture, { journalPath: '' })), isInvalidInput);
  await assert.rejects(runWeeklyLint(lintOptions(fixture, { now: 42 as never })), isInvalidInput);
  await assert.rejects(runWeeklyLint(lintOptions(fixture, { maxProposals: 0 })), isInvalidInput);
  await assert.rejects(runWeeklyLint(lintOptions(fixture, { maxProposals: MAX_WEEKLY_LINT_MAX_PROPOSALS + 1 })), isInvalidInput);
  await assert.rejects(runWeeklyLint(lintOptions(fixture, { maxProposals: 1.5 })), isInvalidInput);
  await assert.rejects(runWeeklyLint(undefined as never), isInvalidInput);
  await assert.rejects(runWeeklyLint(null as never), isInvalidInput);

  // None of the refusals wrote a ledger row or a review item.
  assert.equal(withJournal(fixture.journalPath, (db) => listAutomationRuns(db, { job: 'lint' })).length, 0);
  assert.equal(reviewItems(fixture.journalPath).length, 0);
  assert.equal(MAX_WEEKLY_LINT_MAX_PROPOSALS, 10);
});

test('the ledger row is ensured through the store for the Monday', async () => {
  const fixture = createFixture();
  // Pre-ensure a pending run: the pass adopts it instead of creating a second row.
  const pending = withJournalWrite(fixture.journalPath, (db) => ensureAutomationRun(db, 'lint', WEEK));
  const result: WeeklyLintResult = await runWeeklyLint(lintOptions(fixture));
  assert.equal(result.status, 'complete');
  const runs = withJournal(fixture.journalPath, (db) => listAutomationRuns(db, { job: 'lint' }));
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.id, pending.id);
  assert.equal(runs[0]?.status, 'complete');
});
