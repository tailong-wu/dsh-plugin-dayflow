/**
 * The review queue: proposals the agent raises and the user decides.
 *
 * A proposal is one of four kinds — a **distillation** (an experience worth
 * keeping), a **loop** (a recurring pattern), an **improvement** (a concrete
 * change to the work), or a **task proposal** (work that should become a long
 * task). Distillations and loops are answered with keep / discard; improvements
 * and task proposals with accept / reject.
 *
 * Two properties keep the queue cheap to read:
 *
 * - **Push right.** An item arrives with its evidence, its source day, and a
 *   stated confidence, so the decision is a single act.
 * - **Discarding is a choice, not an erasure.** A plain discard or reject is
 *   *soft*: the same idea may return once the evidence is materially new (a
 *   different day, a higher confidence, more occurrences). A deliberate
 *   "never propose this again" stores a *hard* suppression keyed by the
 *   proposal's fingerprint, and that fingerprint is dropped on sight until the
 *   user clears it.
 *
 * The store lives in the owned journal and is created by migration 3 in
 * {@link module:dsh-plugin-dayflow/journal}.
 * @module dsh-plugin-dayflow/review
 */

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { DayflowError } from './errors.js';

/** What a review item is about. */
export type ReviewKind = 'distillation' | 'loop' | 'improvement' | 'task_proposal';
/** Where the user's decision left an item. */
export type ReviewStatus = 'proposed' | 'kept' | 'discarded' | 'accepted' | 'rejected';
/** How strongly a negative decision suppresses future proposals. */
export type ReviewSuppression = 'none' | 'soft' | 'hard';
/** What makes a loop happen again. */
export type ReviewTrigger = 'event' | 'schedule';

/** One review item as stored and as returned to tools. */
export interface ReviewItemPayload {
  id: number;
  fingerprint: string;
  kind: ReviewKind;
  status: ReviewStatus;
  title: string;
  body: string;
  confidence: number;
  source_day?: string;
  source_activity_ids?: number[];
  evidence?: string;
  loop_occurrences?: number;
  loop_span_days?: number;
  loop_trigger?: ReviewTrigger;
  suppression: ReviewSuppression;
  created_at: string;
  decided_at?: string;
  decision_note?: string;
}

/** What an agent may pass when proposing an item. */
export interface ReviewProposalInput {
  kind: ReviewKind;
  title: string;
  body?: string;
  confidence?: number;
  source_day?: string;
  source_activity_ids?: number[];
  evidence?: string;
  loop_occurrences?: number;
  loop_span_days?: number;
  loop_trigger?: ReviewTrigger;
}

/** Outcome of one proposal: stored, or dropped with a stable reason. */
export interface ProposeResult {
  item?: ReviewItemPayload;
  dropped: boolean;
  reason?: string;
}

/** Tool-facing envelope for the `journal_review` tool. */
export interface ReviewToolPayload {
  action: 'list' | 'propose' | 'decide' | 'unsuppress';
  items?: ReviewItemPayload[];
  item?: ReviewItemPayload;
  dropped?: boolean;
  reason?: string;
  hint: string;
}

/** Drop proposals the agent itself rates below a coin flip. */
export const MIN_PROPOSAL_CONFIDENCE = 0.5;
/** At most this many still-open proposals per source day. */
export const MAX_PROPOSALS_PER_DAY = 5;

/** Confidence must rise by at least this much to count as new evidence. */
const EVIDENCE_CONFIDENCE_DELTA = 0.15;
/** Default confidence when the agent states none. */
const DEFAULT_CONFIDENCE = 0.7;
/** Read limit when the caller states none. */
const DEFAULT_LIST_LIMIT = 50;
/** Upper bound for one review-queue read. */
const MAX_LIST_LIMIT = 200;

/** One raw SQLite row, keyed by column name. */
type ReviewRow = Record<string, unknown>;

type ReviewDecision = 'keep' | 'accept' | 'discard' | 'reject';

const REVIEW_KINDS: ReadonlySet<string> = new Set<ReviewKind>(['distillation', 'loop', 'improvement', 'task_proposal']);
const REVIEW_STATUSES: ReadonlySet<string> = new Set<ReviewStatus>([
  'proposed',
  'kept',
  'discarded',
  'accepted',
  'rejected',
]);
const DECISIONS: ReadonlySet<string> = new Set<ReviewDecision>(['keep', 'accept', 'discard', 'reject']);
const NEGATIVE_DECISIONS: ReadonlySet<ReviewDecision> = new Set<ReviewDecision>(['discard', 'reject']);

const DECISION_STATUS: Record<ReviewDecision, ReviewStatus> = {
  keep: 'kept',
  accept: 'accepted',
  discard: 'discarded',
  reject: 'rejected',
};

/** Distillations and loops are kept/discarded; work items are accepted/rejected. */
const KIND_DECISIONS: Record<ReviewKind, readonly ReviewDecision[]> = {
  distillation: ['keep', 'discard'],
  loop: ['keep', 'discard'],
  improvement: ['accept', 'reject'],
  task_proposal: ['accept', 'reject'],
};

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

function asInteger(value: unknown): number | undefined {
  const number = asNumber(value);
  return number === undefined || !Number.isSafeInteger(number) ? undefined : number;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Parse the stored JSON array of activity ids, tolerating missing columns. */
function parseActivityIds(value: unknown): number[] | undefined {
  const raw = asText(value);
  if (raw === undefined || raw === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((entry): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry));
  } catch {
    return undefined;
  }
}

/** Map one `review_items` row to its tool-facing payload. */
function reviewRow(row: ReviewRow | undefined): ReviewItemPayload | undefined {
  if (row === undefined) return undefined;
  const id = asInteger(row.id);
  const fingerprint = asText(row.fingerprint);
  if (id === undefined || fingerprint === undefined) return undefined;
  const payload: ReviewItemPayload = {
    id,
    fingerprint,
    kind: row.kind as ReviewKind,
    status: row.status as ReviewStatus,
    title: asText(row.title) ?? '',
    body: asText(row.body) ?? '',
    confidence: asNumber(row.confidence) ?? 0,
    suppression: row.suppression as ReviewSuppression,
    created_at: asText(row.created_at) ?? '',
  };
  const sourceDay = asText(row.source_day);
  if (sourceDay !== undefined) payload.source_day = sourceDay;
  const activityIds = parseActivityIds(row.source_activity_ids_json);
  if (activityIds !== undefined) payload.source_activity_ids = activityIds;
  const evidence = asText(row.evidence);
  if (evidence !== undefined) payload.evidence = evidence;
  const occurrences = asInteger(row.loop_occurrences);
  if (occurrences !== undefined) payload.loop_occurrences = occurrences;
  const spanDays = asInteger(row.loop_span_days);
  if (spanDays !== undefined) payload.loop_span_days = spanDays;
  const trigger = asText(row.loop_trigger);
  if (trigger === 'event' || trigger === 'schedule') payload.loop_trigger = trigger;
  const decidedAt = asText(row.decided_at);
  if (decidedAt !== undefined) payload.decided_at = decidedAt;
  const decisionNote = asText(row.decision_note);
  if (decisionNote !== undefined) payload.decision_note = decisionNote;
  return payload;
}

/** Read one item by id. */
function readReviewItem(db: DatabaseSync, id: number): ReviewItemPayload | undefined {
  const row = db.prepare('SELECT * FROM review_items WHERE id = ?').get(id) as ReviewRow | undefined;
  return reviewRow(row);
}

/** Read one item by id, failing as `not_found` when it does not exist. */
function requireReviewItem(db: DatabaseSync, id: number): ReviewItemPayload {
  const item = readReviewItem(db, id);
  if (item === undefined) {
    throw new DayflowError(`No review item with id ${String(id)}.`, 'not_found');
  }
  return item;
}

function invalid(message: string): DayflowError {
  return new DayflowError(message, 'invalid_input');
}

function requireKind(value: unknown): ReviewKind {
  if (typeof value === 'string' && REVIEW_KINDS.has(value)) return value as ReviewKind;
  throw invalid('Review kind must be one of distillation, loop, improvement, or task_proposal.');
}

function requireStatus(value: unknown): ReviewStatus {
  if (typeof value === 'string' && REVIEW_STATUSES.has(value)) return value as ReviewStatus;
  throw invalid('Review status must be one of proposed, kept, discarded, accepted, or rejected.');
}

/**
 * Normalize a title into the fingerprint input: trimmed, lower-cased, and with
 * runs of whitespace collapsed to one space.
 */
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Compute the stable identity of a proposal: a sha256 over kind and normalized
 * title. The same idea proposed again — whatever its capitalization or spacing
 * — carries the same fingerprint, which is what makes suppression reliable.
 */
export function reviewFingerprint(kind: ReviewKind, title: string): string {
  return createHash('sha256').update(`${kind}:${normalizeTitle(title)}`).digest('hex');
}

/**
 * Decide whether a soft-discarded item may return: only when the evidence is
 * materially new — a different source day, a confidence jump of at least
 * {@link EVIDENCE_CONFIDENCE_DELTA}, or at least one more loop occurrence.
 */
function hasMaterialNewEvidence(
  previous: ReviewItemPayload,
  next: { confidence: number; sourceDay?: string; loopOccurrences?: number },
): boolean {
  if (next.sourceDay !== undefined && next.sourceDay !== previous.source_day) return true;
  if (next.confidence - previous.confidence >= EVIDENCE_CONFIDENCE_DELTA) return true;
  const before = previous.loop_occurrences ?? 0;
  if (next.loopOccurrences !== undefined && next.loopOccurrences - before >= 1) return true;
  return false;
}

/**
 * Insert one proposal into the queue, or drop it with a stable reason.
 *
 * Drops, in order: below the confidence floor, the source day's cap, a hard
 * suppression, an identical open proposal, and a soft-discarded item without
 * materially new evidence. A dropped proposal is never written.
 */
export function proposeReviewItem(db: DatabaseSync, input: ReviewProposalInput): ProposeResult {
  if (input === undefined || input === null) throw invalid('A review proposal is required.');
  const kind = requireKind(input.kind);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title === '') throw invalid('A review proposal needs a non-empty title.');

  const confidence = input.confidence === undefined || input.confidence === null ? DEFAULT_CONFIDENCE : input.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw invalid('Review confidence must be a number between 0 and 1.');
  }

  const body = input.body === undefined || input.body === null ? '' : input.body;
  if (typeof body !== 'string') throw invalid('Review body must be a string.');

  const evidence = input.evidence === undefined || input.evidence === null ? undefined : input.evidence;
  if (evidence !== undefined && typeof evidence !== 'string') throw invalid('Review evidence must be a string.');

  const rawSourceDay = input.source_day === undefined || input.source_day === null ? undefined : input.source_day;
  if (rawSourceDay !== undefined && typeof rawSourceDay !== 'string') throw invalid('Review source_day must be a string.');
  const sourceDay = rawSourceDay === undefined || rawSourceDay.trim() === '' ? undefined : rawSourceDay.trim();

  let activityIds: number[] | undefined;
  if (input.source_activity_ids !== undefined && input.source_activity_ids !== null) {
    if (!Array.isArray(input.source_activity_ids)) throw invalid('Review source_activity_ids must be an array of integers.');
    activityIds = [];
    for (const entry of input.source_activity_ids as unknown[]) {
      if (!Number.isSafeInteger(entry)) throw invalid('Review source_activity_ids must be an array of integers.');
      activityIds.push(entry as number);
    }
  }

  const loopOccurrences = input.loop_occurrences === undefined || input.loop_occurrences === null ? undefined : input.loop_occurrences;
  if (loopOccurrences !== undefined && (!Number.isSafeInteger(loopOccurrences) || loopOccurrences < 0)) {
    throw invalid('Review loop_occurrences must be a non-negative integer.');
  }
  const loopSpanDays = input.loop_span_days === undefined || input.loop_span_days === null ? undefined : input.loop_span_days;
  if (loopSpanDays !== undefined && (!Number.isSafeInteger(loopSpanDays) || loopSpanDays < 0)) {
    throw invalid('Review loop_span_days must be a non-negative integer.');
  }
  const loopTrigger = input.loop_trigger === undefined || input.loop_trigger === null ? undefined : input.loop_trigger;
  if (loopTrigger !== undefined && loopTrigger !== 'event' && loopTrigger !== 'schedule') {
    throw invalid('Review loop_trigger must be "event" or "schedule".');
  }

  if (confidence < MIN_PROPOSAL_CONFIDENCE) {
    return { dropped: true, reason: 'below-confidence-floor' };
  }

  const fingerprint = reviewFingerprint(kind, title);

  if (sourceDay !== undefined) {
    const counted = db
      .prepare("SELECT count(*) AS count FROM review_items WHERE status = 'proposed' AND source_day = ?")
      .get(sourceDay) as ReviewRow | undefined;
    if ((asInteger(counted?.count) ?? 0) >= MAX_PROPOSALS_PER_DAY) {
      return { dropped: true, reason: 'daily-proposal-cap' };
    }
  }

  const hard = db
    .prepare("SELECT 1 AS present FROM review_items WHERE fingerprint = ? AND suppression = 'hard' LIMIT 1")
    .get(fingerprint) as ReviewRow | undefined;
  if (hard?.present !== undefined) {
    return { dropped: true, reason: 'hard-suppressed' };
  }

  const open = db
    .prepare("SELECT 1 AS present FROM review_items WHERE fingerprint = ? AND status = 'proposed' LIMIT 1")
    .get(fingerprint) as ReviewRow | undefined;
  if (open?.present !== undefined) {
    return { dropped: true, reason: 'already-proposed' };
  }

  const latestRow = db
    .prepare('SELECT * FROM review_items WHERE fingerprint = ? ORDER BY id DESC LIMIT 1')
    .get(fingerprint) as ReviewRow | undefined;
  const latest = reviewRow(latestRow);
  if (
    latest !== undefined &&
    (latest.status === 'discarded' || latest.status === 'rejected') &&
    latest.suppression === 'soft' &&
    !hasMaterialNewEvidence(latest, { confidence, sourceDay, loopOccurrences })
  ) {
    return { dropped: true, reason: 'soft-discarded' };
  }

  const inserted = db
    .prepare(
      `INSERT INTO review_items (fingerprint, kind, status, title, body, confidence, source_day,
         source_activity_ids_json, evidence, loop_occurrences, loop_span_days, loop_trigger, suppression)
       VALUES (?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none')`,
    )
    .run(
      fingerprint,
      kind,
      title,
      body,
      confidence,
      sourceDay ?? null,
      activityIds === undefined ? null : JSON.stringify(activityIds),
      evidence ?? null,
      loopOccurrences ?? null,
      loopSpanDays ?? null,
      loopTrigger ?? null,
    );
  const id = asInteger(inserted.lastInsertRowid);
  if (id === undefined) {
    throw new DayflowError('Could not read the id of the new review item.', 'database_error');
  }
  const item = readReviewItem(db, id);
  if (item === undefined) {
    throw new DayflowError('The new review item could not be read back.', 'database_error');
  }
  return { dropped: false, item };
}

/**
 * List review items, newest first.
 *
 * `status` defaults to `proposed` so the queue answers "what needs a decision";
 * kind and a bounded limit (1–200, default 50) narrow it.
 */
export function listReviewItems(
  db: DatabaseSync,
  filter: { kind?: ReviewKind; status?: ReviewStatus; limit?: number } = {},
): ReviewItemPayload[] {
  const options = filter ?? {};
  const status = options.status === undefined || options.status === null ? 'proposed' : requireStatus(options.status);
  const kind = options.kind === undefined || options.kind === null ? undefined : requireKind(options.kind);
  const limit = options.limit === undefined || options.limit === null ? DEFAULT_LIST_LIMIT : options.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw invalid(`Review list limit must be an integer between 1 and ${String(MAX_LIST_LIMIT)}.`);
  }

  const conditions = ['status = ?'];
  const parameters: unknown[] = [status];
  if (kind !== undefined) {
    conditions.push('kind = ?');
    parameters.push(kind);
  }
  parameters.push(limit);
  const rows = db
    .prepare(`SELECT * FROM review_items WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ?`)
    .all(...(parameters as never[])) as ReviewRow[];
  return rows
    .map((row) => reviewRow(row))
    .filter((item): item is ReviewItemPayload => item !== undefined);
}

/**
 * Record the user's decision on one item.
 *
 * The decision must fit the kind: distillations and loops take keep / discard,
 * improvements and task proposals take accept / reject. A negative decision
 * soft-suppresses the fingerprint by default; `forever` makes it a hard
 * suppression. An item can be decided once.
 */
export function decideReviewItem(
  db: DatabaseSync,
  id: number,
  decision: 'keep' | 'accept' | 'discard' | 'reject',
  options: { forever?: boolean; note?: string } = {},
): ReviewItemPayload {
  if (!Number.isSafeInteger(id)) {
    throw new DayflowError(`No review item with id ${String(id)}.`, 'not_found');
  }
  const current = requireReviewItem(db, id);
  if (current.status !== 'proposed') {
    throw invalid(`Review item ${String(id)} is already decided (${current.status}).`);
  }
  if (typeof decision !== 'string' || !DECISIONS.has(decision)) {
    throw invalid('Review decision must be one of keep, accept, discard, or reject.');
  }
  const allowed = KIND_DECISIONS[current.kind];
  if (!allowed.includes(decision)) {
    throw invalid(`A ${current.kind} item can only be ${allowed.join(' or ')}, not ${decision}.`);
  }
  const opts = options ?? {};
  const forever = opts.forever === true;
  if (forever && !NEGATIVE_DECISIONS.has(decision)) {
    throw invalid('A hard suppression ("forever") only applies to discard or reject.');
  }
  const note = opts.note === undefined || opts.note === null ? undefined : opts.note;
  if (note !== undefined && typeof note !== 'string') throw invalid('Review decision note must be a string.');

  const negative = NEGATIVE_DECISIONS.has(decision);
  const status = DECISION_STATUS[decision];
  const suppression: ReviewSuppression = negative ? (forever ? 'hard' : 'soft') : 'none';
  db.prepare(
    `UPDATE review_items
       SET status = ?, decided_at = CURRENT_TIMESTAMP, decision_note = ?, suppression = ?
     WHERE id = ?`,
  ).run(status, note ?? null, suppression, id);
  return requireReviewItem(db, id);
}

/**
 * Clear a hard suppression so the same idea may be proposed again.
 *
 * Only an item suppressed with `forever` can be cleared; the decision itself is
 * kept, so the item stays out of the proposed queue.
 */
export function unsuppressReviewItem(db: DatabaseSync, id: number): ReviewItemPayload {
  if (!Number.isSafeInteger(id)) {
    throw new DayflowError(`No review item with id ${String(id)}.`, 'not_found');
  }
  const current = requireReviewItem(db, id);
  if (current.suppression !== 'hard') {
    throw invalid(`Review item ${String(id)} is not hard-suppressed.`);
  }
  db.prepare("UPDATE review_items SET suppression = 'none' WHERE id = ?").run(id);
  return requireReviewItem(db, id);
}
