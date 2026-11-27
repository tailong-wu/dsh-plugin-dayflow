/**
 * The weekly memory lint pass: a read-only scan of the claims the journal holds,
 * turned into review proposals — never into repairs.
 *
 * Memory claims are the journal's dated beliefs about how the user works. They
 * can go stale, disagree with each other, lose their evidence, or simply age.
 * `lintMemoryClaims` already reports those shapes without changing anything;
 * this pass is the scheduled wrapper around it:
 *
 * - **One pass per week.** The `automation_runs` ledger keys the pass by
 *   `job = 'lint'` and `day = the Monday of the closed week`, so the same week is
 *   scanned once. A completed week returns `skipped` with the recorded summary;
 *   `force: true` recomputes the week and rewrites its payload.
 * - **Proposals only.** Each finding subject becomes one `improvement` proposal
 *   in the review queue — at most {@link DEFAULT_WEEKLY_LINT_MAX_PROPOSALS} per
 *   pass, one per subject — and goes through the queue's own fingerprint,
 *   suppression, and per-day rules. Nothing is superseded, forgotten, or written
 *   to `memory_claims`: fixing a claim stays the user's decision.
 * - **Nothing to say is a result.** A week with clean claims records `complete`
 *   with summary `nothing to report`, so the weekly brief can say the check ran.
 * - **All-or-nothing bookkeeping.** The proposals and the completed run are
 *   written in one transaction; a failure records the run as failed (when this
 *   pass started it) and propagates to the caller, which maps it to `failed`.
 *
 * Reads and writes use separate short-lived connections ({@link withJournal},
 * {@link withJournalWrite}); no connection is held across an await.
 * @module dsh-plugin-dayflow/automation/lint
 */

import type { DatabaseSync } from 'node:sqlite';

import type { ResolvedConfig } from '../config.js';
import { dayWindowForKey } from '../day.js';
import { DayflowError } from '../errors.js';
import { withJournal, withJournalWrite } from '../journal.js';
import { lintMemoryClaims } from '../memory.js';
import type { MemoryLintReport } from '../memory.js';
import { proposeReviewItem } from '../review.js';
import {
  completeAutomationRun,
  ensureAutomationRun,
  failAutomationRun,
  getAutomationRun,
  startAutomationRun,
} from './store.js';
import type { AutomationRun } from './store.js';

/** Everything one weekly lint pass needs; every optional field has a default. */
export interface WeeklyLintOptions {
  /** The plugin-owned journal whose memory claims are scanned. */
  journalPath: string;
  /** Resolved plugin config; reserved for future lint tuning, currently unread. */
  config: ResolvedConfig;
  /** The Monday of the week being linted, `YYYY-MM-DD`. */
  weekMonday: string;
  /** Injectable clock for the aging horizon; defaults to `new Date()`. */
  now?: () => Date;
  /** Recompute a week that is already complete, rewriting its payload. */
  force?: boolean;
  /** Most proposals one pass may create; defaults to 3, within 1..10. */
  maxProposals?: number;
}

/** What one weekly lint pass did. */
export interface WeeklyLintResult {
  /** `complete` ran (even with nothing to report); `skipped` already ran (or was refused). */
  status: 'complete' | 'skipped' | 'empty';
  /** How many active claims the scan covered. */
  scanned: number;
  /** Contradictions + superseded-by-newer pairs + unsourced + aged findings. */
  findings: number;
  /** How many review proposals this pass actually created. */
  proposals: number;
  /** A one-sentence digest for the weekly brief. */
  summary: string;
  /** Machine-readable reason when the status is `skipped`. */
  reason?: string;
}

/** The ledger job name of the weekly lint pass. */
const WEEKLY_LINT_JOB = 'lint';

/** Proposals one pass may create when the caller states no cap. */
export const DEFAULT_WEEKLY_LINT_MAX_PROPOSALS = 3;

/** Hard ceiling for one pass's proposals. */
export const MAX_WEEKLY_LINT_MAX_PROPOSALS = 10;

/** The stable title prefix; the review queue's fingerprint follows the title. */
const LINT_TITLE_PREFIX = 'Memory check: ';

/** Confidence of a lint proposal: an observation worth deciding on, not a verdict. */
const LINT_PROPOSAL_CONFIDENCE = 0.7;

/** The summary a clean week records, so "the check ran" is visible in the brief. */
export const WEEKLY_LINT_NOTHING_TO_REPORT = 'nothing to report';

/** The summary returned when a completed week has no readable payload. */
const WEEKLY_LINT_ALREADY_COMPLETE = 'The weekly memory lint already ran for this week.';

/** The finding kinds, in the priority order the report already uses. */
type LintFindingType = 'contradiction' | 'superseded-by-newer' | 'unsourced' | 'aged';

/** One finding reduced to the facts a proposal states. */
interface LintFinding {
  subject: string;
  /** The claim kind ('preference', 'loop', ...), for the proposal body. */
  kind: string;
  type: LintFindingType;
  /** One sentence describing the finding. */
  detail: string;
  /** The active claims the finding is about. */
  claimIds: number[];
}

/** The payload recorded on a completed lint run. */
interface WeeklyLintPayload {
  scanned: number;
  findings: number;
  proposals: number;
  summary: string;
}

/** A required non-empty journal path. */
function requireJournalPath(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DayflowError('A weekly memory lint needs the journal path to scan.', 'invalid_input');
  }
  return value;
}

/** A required `YYYY-MM-DD` label that is actually a Monday. */
function requireWeekMonday(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DayflowError('A weekly memory lint week must be a YYYY-MM-DD string.', 'invalid_input');
  }
  const window = dayWindowForKey(value);
  if (window === undefined) {
    throw new DayflowError(`"${value}" is not a week Monday. Use YYYY-MM-DD, for example 2026-03-09.`, 'invalid_input');
  }
  if (window.start.getDay() !== 1) {
    throw new DayflowError(
      `"${window.dayKey}" is not a Monday; a weekly memory lint is keyed by the Monday of the week.`,
      'invalid_input',
    );
  }
  return window.dayKey;
}

/** The pass's proposal cap: the default, within 1..{@link MAX_WEEKLY_LINT_MAX_PROPOSALS}. */
function resolveMaxProposals(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_WEEKLY_LINT_MAX_PROPOSALS;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_WEEKLY_LINT_MAX_PROPOSALS
  ) {
    throw new DayflowError(
      `A weekly memory lint maxProposals must be an integer between 1 and ${String(MAX_WEEKLY_LINT_MAX_PROPOSALS)}.`,
      'invalid_input',
    );
  }
  return value;
}

/** The injectable clock, or the real one; a bad clock is a caller bug, not a scan result. */
function resolveClock(value: unknown): () => Date {
  if (value === undefined || value === null) return () => new Date();
  if (typeof value !== 'function') {
    throw new DayflowError('A weekly memory lint now must be a function returning a Date.', 'invalid_input');
  }
  return value as () => Date;
}

/** Reduce a lint report to one finding per subject, strongest kind first. */
function findingsFromReport(report: MemoryLintReport): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const group of report.contradictions) {
    const claimIds = group.claims.map((claim) => claim.id);
    findings.push({
      subject: group.subject,
      kind: group.kind,
      type: 'contradiction',
      detail:
        `${String(claimIds.length)} active ${group.kind} claims about "${group.subject}" ` +
        'disagree with each other.',
      claimIds,
    });
  }
  for (const pair of report.supersededByNewer) {
    findings.push({
      subject: pair.older.subject,
      kind: pair.older.kind,
      type: 'superseded-by-newer',
      detail:
        `active ${pair.older.kind} claim #${String(pair.older.id)} about "${pair.older.subject}" ` +
        `was observed before active claim #${String(pair.newer.id)}, so two live versions of one claim are held.`,
      claimIds: [pair.older.id, pair.newer.id],
    });
  }
  for (const claim of report.unsourced) {
    findings.push({
      subject: claim.subject,
      kind: claim.kind,
      type: 'unsourced',
      detail:
        `active ${claim.kind} claim #${String(claim.id)} about "${claim.subject}" ` +
        'has no review item and no evidence days, so nothing traces it back.',
      claimIds: [claim.id],
    });
  }
  for (const claim of report.aged) {
    findings.push({
      subject: claim.subject,
      kind: claim.kind,
      type: 'aged',
      detail:
        `active ${claim.kind} claim #${String(claim.id)} about "${claim.subject}" ` +
        `was observed on ${claim.observed_on}, before the aging horizon.`,
      claimIds: [claim.id],
    });
  }
  return findings;
}

/** Keep the first (strongest) finding per subject; the same subject is proposed once. */
function firstFindingPerSubject(findings: readonly LintFinding[]): LintFinding[] {
  const seen = new Set<string>();
  const unique: LintFinding[] = [];
  for (const finding of findings) {
    if (seen.has(finding.subject)) continue;
    seen.add(finding.subject);
    unique.push(finding);
  }
  return unique;
}

/** The proposal body: the finding plus the reminder that the pass changed nothing. */
function findingBody(finding: LintFinding): string {
  const ids = finding.claimIds.map((id) => `#${String(id)}`).join(', ');
  return (
    `${finding.detail} Claims involved: ${ids}. ` +
    'The weekly memory lint changed nothing: fixing this means superseding or forgetting a claim only ' +
    'when the user decides.'
  );
}

/** The proposal evidence line: which pass saw this, for which claims. */
function findingEvidence(finding: LintFinding, weekMonday: string): string {
  return (
    `${finding.type} finding from the ${weekMonday} weekly memory lint ` +
    `(${String(finding.claimIds.length)} claim(s): ${finding.claimIds.map((id) => `#${String(id)}`).join(', ')})`
  );
}

/** Pluralize one count for the summary sentence. */
function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/** The digest sentence recorded for the week and shown in the weekly brief. */
function lintSummary(findings: number, scanned: number, proposals: number, dropped: number): string {
  if (findings === 0) return WEEKLY_LINT_NOTHING_TO_REPORT;
  const base =
    `${countLabel(findings, 'finding')} across ${countLabel(scanned, 'active claim')}; ` +
    `${countLabel(proposals, 'proposal')} queued.`;
  if (dropped === 0) return base;
  return `${base} ${countLabel(dropped, 'proposal')} already queued or suppressed.`;
}

/** Parse a completed run's payload; a hand-edited or older row yields `undefined`. */
function readLintPayload(payload: unknown): WeeklyLintPayload | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  const scanned = countField(record.scanned);
  const findings = countField(record.findings);
  const proposals = countField(record.proposals);
  const summary = typeof record.summary === 'string' && record.summary.trim() !== '' ? record.summary : undefined;
  if (scanned === undefined || findings === undefined || proposals === undefined || summary === undefined) {
    return undefined;
  }
  return { scanned, findings, proposals, summary };
}

/** One non-negative whole-number payload field. */
function countField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** The message a failed run records. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the weekly memory lint for one Monday.
 *
 * The pass validates its arguments, checks the ledger for that `(lint, Monday)`
 * run, scans the active claims read-only, and then — in one transaction —
 * proposes at most `maxProposals` improvements and completes the run with
 * `{ findings, proposals, scanned, summary }`.
 *
 * @param options - the journal, config, Monday, clock, force, and proposal cap.
 * @returns the completed or already-complete status with the recorded counts.
 * @throws {@link DayflowError} `invalid_input` for unusable arguments; any
 *   database error propagates after the run is recorded failed (when this pass
 *   started it).
 */
export async function runWeeklyLint(options: WeeklyLintOptions): Promise<WeeklyLintResult> {
  if (options === undefined || options === null) {
    throw new DayflowError('A weekly memory lint needs options.', 'invalid_input');
  }
  const journalPath = requireJournalPath(options.journalPath);
  const weekMonday = requireWeekMonday(options.weekMonday);
  const maxProposals = resolveMaxProposals(options.maxProposals);
  const force = options.force === true;
  const clock = resolveClock(options.now);

  const existing = withJournal(journalPath, (db) => getAutomationRun(db, WEEKLY_LINT_JOB, weekMonday));
  if (existing !== undefined && existing.status === 'complete' && !force) {
    const stored = readLintPayload(existing.payload);
    return {
      status: 'skipped',
      scanned: stored?.scanned ?? 0,
      findings: stored?.findings ?? 0,
      proposals: stored?.proposals ?? 0,
      summary: stored?.summary ?? WEEKLY_LINT_ALREADY_COMPLETE,
      reason: 'already-complete',
    };
  }

  // Claim the run. A forced rerun of an already-complete week keeps its row and
  // attempts, and only rewrites the payload below.
  let run: AutomationRun;
  let startedHere = false;
  if (existing !== undefined && existing.status === 'complete') {
    run = existing;
  } else {
    run = withJournalWrite(journalPath, (db) =>
      startAutomationRun(db, ensureAutomationRun(db, WEEKLY_LINT_JOB, weekMonday).id),
    );
    startedHere = true;
  }

  try {
    const report = withJournal(journalPath, (db) => lintMemoryClaims(db, { now: clock() }));
    const findings = firstFindingPerSubject(findingsFromReport(report));
    const totalFindings =
      report.contradictions.length +
      report.supersededByNewer.length +
      report.unsourced.length +
      report.aged.length;
    const keeps = findings.slice(0, maxProposals);

    const payload = withJournalWrite(journalPath, (db) => {
      let proposals = 0;
      let dropped = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const finding of keeps) {
          const outcome = proposeReviewItem(db, {
            kind: 'improvement',
            title: `${LINT_TITLE_PREFIX}${finding.subject}`,
            body: findingBody(finding),
            confidence: LINT_PROPOSAL_CONFIDENCE,
            source_day: weekMonday,
            evidence: findingEvidence(finding, weekMonday),
          });
          if (outcome.dropped) dropped += 1;
          else proposals += 1;
        }
        const result: WeeklyLintPayload = {
          scanned: report.scanned,
          findings: totalFindings,
          proposals,
          summary: lintSummary(totalFindings, report.scanned, proposals, dropped),
        };
        completeAutomationRun(db, run.id, result);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Preserve the original failure when rollback itself cannot run.
        }
        throw error;
      }
    });

    return { status: 'complete', ...payload };
  } catch (error) {
    // A failed pass is recorded on the run it claimed; a forced rerun leaves the
    // earlier completed week's payload in place instead of downgrading it.
    if (startedHere) {
      try {
        withJournalWrite(journalPath, (db) => failAutomationRun(db, run.id, messageOf(error)));
      } catch {
        // Best effort: the original error is what the caller must see.
      }
    }
    throw error;
  }
}
