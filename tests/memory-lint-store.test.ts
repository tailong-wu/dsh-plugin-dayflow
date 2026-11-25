/**
 * Memory lint: the read-only checkup of the owned journal's memory claims.
 *
 * Linting is deliberately not a repair pass. It finds claims that share a key but
 * disagree, claims that a newer active claim has moved past, claims with nothing
 * to trace them back to, and claims old enough that they may no longer be true;
 * fixing any of those goes through supersede/forget, which the user decides.
 * These tests also pin the read-only guarantee: the claim table must be
 * byte-for-byte unchanged after a scan.
 *
 * These tests use disposable journals under a temporary directory; they never
 * touch the default `$DSH_HOME` journal.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatDayKey } from '../src/day.js';
import { DayflowError } from '../src/errors.js';
import { openJournal, withJournal } from '../src/journal.js';
import {
  MEMORY_LINT_AGE_DAYS,
  MEMORY_LINT_LIMIT,
  addMemoryClaim,
  lintMemoryClaims,
  supersedeMemoryClaim,
} from '../src/memory.js';
import type { MemoryClaimSummary } from '../src/memory.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-memory-lint-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let fileCounter = 0;

/** A fresh journal path inside the disposable directory. */
function journalFile(label: string): string {
  fileCounter += 1;
  return join(directory, `${label}-${fileCounter}.sqlite`);
}

/** The injected clock every aging assertion is relative to: 2026-11-25 noon local. */
const NOW = new Date(2026, 10, 25, 12, 0, 0);

/** The `YYYY-MM-DD` label of `date` shifted by whole local days. */
function dayKeyOffset(date: Date, days: number): string {
  const shifted = new Date(date.getTime());
  shifted.setDate(shifted.getDate() + days);
  return formatDayKey(shifted);
}

function claimIds(claims: readonly MemoryClaimSummary[]): number[] {
  return claims.map((claim) => claim.id);
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

interface Row {
  readonly [key: string]: unknown;
}

test('an empty journal has nothing to lint', () => {
  const db = openJournal(journalFile('empty'));
  try {
    const report = lintMemoryClaims(db);
    assert.equal(report.scanned, 0);
    assert.deepEqual(report.contradictions, []);
    assert.deepEqual(report.supersededByNewer, []);
    assert.deepEqual(report.unsourced, []);
    assert.deepEqual(report.aged, []);
    assert.ok(report.hint.length > 0, 'the report always explains itself');
    assert.ok(report.hint.includes('read-only'), 'the hint says the scan changes nothing');
    assert.equal(MEMORY_LINT_AGE_DAYS, 180);
    assert.equal(MEMORY_LINT_LIMIT, 20);
  } finally {
    db.close();
  }
});

test('contradictions group active claims by kind and subject, comparing normalized bodies', () => {
  const db = openJournal(journalFile('contradictions'));
  try {
    const first = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Planning',
      body: 'The user plans the week on paper.',
      observed_on: '2026-10-01',
    });
    const second = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Planning',
      body: 'The user plans the week in the panel.',
      observed_on: '2026-10-05',
    });
    // Same body once trimmed, whitespace-collapsed, and lowercased: not a conflict.
    addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Review cadence',
      body: 'The standup draft repeats   yesterday.',
      observed_on: '2026-10-02',
    });
    addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Review cadence',
      body: '  the standup draft repeats yesterday.  ',
      observed_on: '2026-10-06',
    });
    // Same subject but different kinds are different keys, so they never mix.
    addMemoryClaim(db, {
      kind: 'distillation',
      subject: 'Cross kind',
      body: 'One body.',
      observed_on: '2026-10-03',
    });
    addMemoryClaim(db, {
      kind: 'correction',
      subject: 'Cross kind',
      body: 'Another body.',
      observed_on: '2026-10-04',
    });

    const report = lintMemoryClaims(db);
    assert.equal(report.scanned, 6);
    assert.equal(report.contradictions.length, 1);
    const group = report.contradictions[0];
    assert.equal(group.subject, 'Planning');
    assert.equal(group.kind, 'preference');
    assert.deepEqual(claimIds(group.claims), [second.id, first.id], 'newest observation first');
    assert.equal(group.claims[0].body, 'The user plans the week in the panel.');
    assert.equal(group.claims[0].confidence, 0.7);
    assert.deepEqual(
      report.contradictions.map((item) => item.subject),
      ['Planning'],
      'normalized-equal bodies and cross-kind pairs are not contradictions',
    );
  } finally {
    db.close();
  }
});

test('supersededByNewer pairs each active claim with the nearest newer claim and ignores superseded rows', () => {
  const db = openJournal(journalFile('superseded-by-newer'));
  try {
    const earliest = addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Cadence',
      body: 'The cadence was weekly.',
      observed_on: '2026-09-01',
    });
    const middle = addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Cadence',
      body: 'The cadence was twice a week.',
      observed_on: '2026-09-15',
    });
    const latest = addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Cadence',
      body: 'The cadence is daily.',
      observed_on: '2026-10-01',
    });
    // Same day: the higher id is the newer row, so it makes the pair.
    const sameDayFirst = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Same day',
      body: 'One body.',
      observed_on: '2026-10-10',
    });
    const sameDaySecond = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Same day',
      body: 'Two body.',
      observed_on: '2026-10-10',
    });
    // A pair that later becomes history when the older claim is superseded.
    const retiredOld = addMemoryClaim(db, {
      kind: 'correction',
      subject: 'Retired',
      body: 'The old correction.',
      observed_on: '2026-08-01',
    });
    const retiredNew = addMemoryClaim(db, {
      kind: 'correction',
      subject: 'Retired',
      body: 'The newer correction.',
      observed_on: '2026-09-01',
    });
    assert.equal(retiredNew.id > retiredOld.id, true);

    const report = lintMemoryClaims(db);
    assert.equal(report.scanned, 7);
    assert.deepEqual(
      report.supersededByNewer.map((pair) => [pair.older.id, pair.newer.id]),
      [
        [retiredOld.id, retiredNew.id],
        [earliest.id, middle.id],
        [middle.id, latest.id],
        [sameDayFirst.id, sameDaySecond.id],
      ],
      'each older claim pairs with its nearest newer claim (never latest), oldest observation first',
    );
    const cadencePair = report.supersededByNewer.find(
      (pair) => pair.older.id === earliest.id && pair.newer.id === middle.id,
    );
    assert.ok(cadencePair !== undefined, 'the earliest cadence claim pairs with the middle one');
    assert.equal(cadencePair.older.body, 'The cadence was weekly.');
    assert.equal(cadencePair.newer.body, 'The cadence was twice a week.');
    assert.equal(
      report.supersededByNewer.some((pair) => pair.older.id === latest.id),
      false,
      'the newest claim in a group has no newer claim',
    );

    // Superseding the old claim removes it from the active scan.
    const replacement = supersedeMemoryClaim(db, retiredOld.id, {
      body: 'The corrected correction.',
      observed_on: '2026-09-02',
    });
    const after = lintMemoryClaims(db);
    assert.equal(after.scanned, 7, 'a supersede appends one active claim and retires one');
    assert.equal(
      after.supersededByNewer.some((pair) => pair.older.id === retiredOld.id),
      false,
      'a superseded claim is history, not a lint finding',
    );
    assert.equal(
      after.supersededByNewer.some((pair) => pair.older.id === retiredNew.id && pair.newer.id === replacement.id),
      true,
      'the replacement claim takes over the group',
    );
  } finally {
    db.close();
  }
});

test('unsourced claims are the ones with no review item and no evidence days', () => {
  const db = openJournal(journalFile('unsourced'));
  try {
    const fromReview = addMemoryClaim(db, {
      kind: 'distillation',
      subject: 'From a review item',
      body: 'This claim was proposed by the review queue.',
      observed_on: '2026-10-01',
      source_review_item: 9,
    });
    const fromDays = addMemoryClaim(db, {
      kind: 'loop',
      subject: 'From evidence days',
      body: 'This claim names the days it came from.',
      observed_on: '2026-10-02',
      source_days: ['2026-10-01', '2026-10-02'],
    });
    const unsourced = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Nothing to trace',
      body: 'This claim named no source at all.',
      observed_on: '2026-10-03',
    });

    const report = lintMemoryClaims(db);
    assert.equal(report.scanned, 3);
    assert.deepEqual(claimIds(report.unsourced), [unsourced.id]);
    assert.deepEqual(report.unsourced[0], {
      id: unsourced.id,
      subject: 'Nothing to trace',
      body: 'This claim named no source at all.',
      kind: 'preference',
      observed_on: '2026-10-03',
      confidence: 0.7,
    });
    assert.equal(
      report.unsourced.some((claim) => claim.id === fromReview.id || claim.id === fromDays.id),
      false,
      'either kind of provenance is enough to be sourced',
    );
  } finally {
    db.close();
  }
});

test('aged claims are strictly older than the MEMORY_LINT_AGE_DAYS horizon', () => {
  const db = openJournal(journalFile('aged'));
  try {
    const ancient = addMemoryClaim(db, {
      kind: 'distillation',
      subject: 'Ancient',
      body: 'This claim predates everything else.',
      observed_on: '2020-01-01',
    });
    const recent = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Recent',
      body: 'This claim is fresh.',
      observed_on: '2026-11-20',
    });
    // Exactly 180 days old is on the horizon, not past it.
    const onHorizon = addMemoryClaim(db, {
      kind: 'loop',
      subject: 'On the horizon',
      body: 'This claim is exactly 180 days old.',
      observed_on: dayKeyOffset(NOW, -MEMORY_LINT_AGE_DAYS),
    });
    const pastHorizon = addMemoryClaim(db, {
      kind: 'correction',
      subject: 'Past the horizon',
      body: 'This claim is 181 days old.',
      observed_on: dayKeyOffset(NOW, -(MEMORY_LINT_AGE_DAYS + 1)),
    });

    const report = lintMemoryClaims(db, { now: NOW });
    assert.deepEqual(
      claimIds(report.aged),
      [ancient.id, pastHorizon.id],
      'only claims strictly past the horizon, oldest observation first',
    );
    assert.equal(
      report.aged.some((claim) => claim.id === onHorizon.id),
      false,
      'exactly 180 days old is not aged',
    );
    assert.equal(
      report.aged.some((claim) => claim.id === recent.id),
      false,
      'a recent claim is not aged',
    );
    assert.equal(report.scanned, 4);

    // The default clock is today; a 2020 claim is far past any horizon.
    const nowDefault = lintMemoryClaims(db);
    assert.equal(
      nowDefault.aged.some((claim) => claim.id === ancient.id),
      true,
    );
  } finally {
    db.close();
  }
});

test('the subject filter narrows the scan and the limit caps each finding list', () => {
  const db = openJournal(journalFile('filter-limit'));
  try {
    const alphaOld = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Alpha',
      body: 'Alpha was on paper.',
      observed_on: '2026-05-01',
    });
    const alphaNew = addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Alpha',
      body: 'Alpha moved to the panel.',
      observed_on: '2026-06-01',
    });
    const betaOld = addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Beta',
      body: 'Beta happened in the morning.',
      observed_on: '2026-10-01',
    });
    const betaNew = addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Beta',
      body: 'Beta moved to the afternoon.',
      observed_on: '2026-10-02',
    });
    const delta = addMemoryClaim(db, {
      kind: 'distillation',
      subject: 'Delta',
      body: 'Delta is very old.',
      observed_on: '2020-01-01',
    });
    const gamma = addMemoryClaim(db, {
      kind: 'correction',
      subject: 'Gamma',
      body: 'Gamma is a single claim.',
      observed_on: '2026-10-03',
    });

    const all = lintMemoryClaims(db);
    assert.equal(all.scanned, 6);
    assert.deepEqual(
      all.contradictions.map((group) => group.subject),
      ['Alpha', 'Beta'],
      'groups are ordered by subject',
    );
    assert.deepEqual(
      claimIds(all.unsourced),
      [delta.id, alphaOld.id, alphaNew.id, betaOld.id, betaNew.id, gamma.id],
      'unsourced is ordered by observed_on, oldest first',
    );
    assert.deepEqual(claimIds(all.aged), [delta.id, alphaOld.id]);
    assert.equal(all.supersededByNewer.length, 2);

    // The exact subject filter applies to every finding list and to scanned.
    const alpha = lintMemoryClaims(db, { subject: 'Alpha' });
    assert.equal(alpha.scanned, 2);
    assert.deepEqual(
      alpha.contradictions.map((group) => group.subject),
      ['Alpha'],
    );
    assert.deepEqual(claimIds(alpha.unsourced), [alphaOld.id, alphaNew.id]);
    assert.deepEqual(claimIds(alpha.aged), [alphaOld.id]);
    assert.deepEqual(
      alpha.supersededByNewer.map((pair) => [pair.older.id, pair.newer.id]),
      [[alphaOld.id, alphaNew.id]],
    );
    assert.equal(lintMemoryClaims(db, { subject: '  Alpha  ' }).scanned, 2, 'the filter is trimmed');
    assert.equal(lintMemoryClaims(db, { subject: 'Missing' }).scanned, 0);
    assert.equal(lintMemoryClaims(db, { subject: 'Alpha', limit: 1 }).scanned, 2, 'limit never changes scanned');

    // limit=1 keeps at most one finding per list, starting from the earliest.
    const limited = lintMemoryClaims(db, { limit: 1 });
    assert.equal(limited.scanned, 6);
    assert.equal(limited.contradictions.length, 1);
    assert.equal(limited.contradictions[0].subject, 'Alpha');
    assert.equal(limited.supersededByNewer.length, 1);
    assert.deepEqual(claimIds(limited.unsourced), [delta.id]);
    assert.deepEqual(claimIds(limited.aged), [delta.id]);

    const full = lintMemoryClaims(db, { limit: 100 });
    assert.equal(full.contradictions.length, 2);
    assert.equal(full.unsourced.length, 6);
    assert.equal(full.aged.length, 2);

    assert.throws(() => lintMemoryClaims(db, { limit: 0 }), isInvalidInput);
    assert.throws(() => lintMemoryClaims(db, { limit: 101 }), isInvalidInput);
    assert.throws(() => lintMemoryClaims(db, { limit: -1 }), isInvalidInput);
    assert.throws(() => lintMemoryClaims(db, { limit: 1.5 }), isInvalidInput);
    assert.throws(() => lintMemoryClaims(db, { limit: '5' as unknown as number }), isInvalidInput);
    assert.throws(() => lintMemoryClaims(db, { subject: 5 as unknown as string }), isInvalidInput);
    assert.throws(() => lintMemoryClaims(db, { now: new Date(Number.NaN) }), isInvalidInput);
  } finally {
    db.close();
  }
});

test('the default limit caps each finding list at MEMORY_LINT_LIMIT', () => {
  const db = openJournal(journalFile('default-limit'));
  try {
    const created: number[] = [];
    for (let index = 1; index <= MEMORY_LINT_LIMIT + 5; index += 1) {
      const claim = addMemoryClaim(db, {
        kind: 'distillation',
        subject: `Claim ${String(index).padStart(2, '0')}`,
        body: `Distilled claim number ${String(index)}.`,
        observed_on: `2026-01-${String(index).padStart(2, '0')}`,
      });
      created.push(claim.id);
    }
    const report = lintMemoryClaims(db);
    assert.equal(report.scanned, MEMORY_LINT_LIMIT + 5);
    assert.equal(report.unsourced.length, MEMORY_LINT_LIMIT, 'the default limit caps the list');
    assert.deepEqual(
      claimIds(report.unsourced),
      created.slice(0, MEMORY_LINT_LIMIT),
      'the oldest claims are kept',
    );
    assert.deepEqual(report.contradictions, []);
    assert.deepEqual(report.supersededByNewer, []);
    assert.equal(lintMemoryClaims(db, { limit: 100 }).unsourced.length, MEMORY_LINT_LIMIT + 5);
  } finally {
    db.close();
  }
});

test('linting never writes to the journal', () => {
  const path = journalFile('read-only');
  const db = openJournal(path);
  try {
    addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Read only',
      body: 'The user prefers a read-only lint pass.',
      observed_on: '2026-10-01',
    });
    addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Read only',
      body: 'The user prefers an automatic repair pass.',
      observed_on: '2026-10-02',
    });
    const retired = addMemoryClaim(db, {
      kind: 'loop',
      subject: 'Retired',
      body: 'A claim that was superseded.',
      observed_on: '2026-09-01',
    });
    supersedeMemoryClaim(db, retired.id, {
      body: 'A claim that replaced it.',
      observed_on: '2026-09-02',
    });

    // Running the scan must leave every row — including the supersede stamps — exactly as it was.
    const before = db.prepare('SELECT * FROM memory_claims ORDER BY id').all() as Row[];
    const report = lintMemoryClaims(db);
    assert.ok(report.scanned > 0 && report.contradictions.length > 0, 'the scan actually inspected rows');
    lintMemoryClaims(db, { subject: 'Read only', now: NOW, limit: 1 });
    const after = db.prepare('SELECT * FROM memory_claims ORDER BY id').all() as Row[];
    assert.deepEqual(after, before, 'linting writes nothing: no insert, update, or delete');

    // The superseded row is still hidden from the active scan but present in storage.
    const stored = db.prepare('SELECT count(*) AS count FROM memory_claims').get() as Row;
    assert.equal(Number(stored.count), 4);
    assert.equal(
      lintMemoryClaims(db).supersededByNewer.some((pair) => pair.older.id === retired.id),
      false,
    );

    // The tool layer runs lint through the read-only journal connection
    // (PRAGMA query_only = 1); a scan must work there without attempting a write.
    const readOnlyReport = withJournal(path, (read) => lintMemoryClaims(read));
    assert.equal(readOnlyReport.scanned, report.scanned);
    assert.deepEqual(readOnlyReport, report);
  } finally {
    db.close();
  }
});
