/**
 * Memory: the durable, dated claims the assistant keeps about the user's work.
 *
 * A claim is a short statement plus the day it describes (`observed_on`, not
 * "today") and the evidence strength (`confidence`). The store is append-only in
 * the way that matters: a claim is never rewritten in place. When what we know
 * changes, {@link supersedeMemoryClaim} inserts a new row and marks the old one
 * with `superseded_by` / `superseded_on`, so a later reader can still see what
 * was believed before and when that changed. Reads ({@link searchMemoryClaims},
 * {@link listMemoryClaims}) hide superseded rows unless the caller asks for the
 * history.
 *
 * Searching prefers the FTS5 index created by schema migration 5 and falls back
 * to `LIKE` when the running Node build has no FTS5 module. Both paths return
 * claims that contain every query token, so behavior does not change with the
 * SQLite build.
 *
 * The table lives in the owned journal and is created by migration 5 in
 * {@link module:dsh-plugin-dayflow/journal}.
 * @module dsh-plugin-dayflow/memory
 */

import type { DatabaseSync } from 'node:sqlite';

import { dayWindowForKey, formatDayKey } from './day.js';
import { DayflowError } from './errors.js';

/** The four kinds of claim the memory store keeps. */
export type MemoryClaimKind = 'distillation' | 'loop' | 'preference' | 'correction';

/** One dated claim, as stored and as returned to a caller. */
export interface MemoryClaimPayload {
  id: number;
  kind: MemoryClaimKind;
  /** What the claim is about; also the exact key used to group a claim's history. */
  subject: string;
  /** The claim itself, a short statement in the user's own terms. */
  body: string;
  /** The day the claim describes, `YYYY-MM-DD` — never in the future. */
  observed_on: string;
  /** When the row was written (SQLite `CURRENT_TIMESTAMP`, in UTC). */
  recorded_at: string;
  /** The review-queue item this claim came from, when it came from one. */
  source_review_item?: number;
  /** The days the evidence came from. */
  source_days?: string[];
  /** 0..1 evidence strength. */
  confidence: number;
  /** The id of the claim that replaced this one, when it was superseded. */
  superseded_by?: number;
  /** The `observed_on` of the claim that replaced this one. */
  superseded_on?: string;
}

/** What a caller supplies when appending a claim. */
export interface AddMemoryClaimInput {
  kind: MemoryClaimKind;
  subject: string;
  body: string;
  observed_on: string;
  confidence?: number;
  source_review_item?: number;
  source_days?: string[];
}

/** What a caller supplies when a claim changes: only the new observation is required. */
export interface SupersedeMemoryClaimInput {
  body: string;
  observed_on: string;
  subject?: string;
  kind?: MemoryClaimKind;
  confidence?: number;
  source_days?: string[];
}

/** Filters shared by {@link searchMemoryClaims}. */
export interface MemoryQueryOptions {
  include_superseded?: boolean;
  limit?: number;
  kind?: MemoryClaimKind;
}

/** Read limit when the caller states none. */
export const MEMORY_DEFAULT_LIMIT = 20;
/** Upper bound for one memory read. */
export const MEMORY_MAX_LIMIT = 100;
/** Evidence strength for a claim that does not state one. */
const DEFAULT_CONFIDENCE = 0.7;

const KINDS: ReadonlySet<string> = new Set<MemoryClaimKind>(['distillation', 'loop', 'preference', 'correction']);
/** A query token: a run of letters, digits, or underscores, in any script. */
const TOKEN_PATTERN = /[\p{L}\p{N}_]+/gu;

/** One raw SQLite row, keyed by column name. */
type Row = Record<string, unknown>;

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

function invalid(message: string): DayflowError {
  return new DayflowError(message, 'invalid_input');
}

function notFound(id: unknown): DayflowError {
  return new DayflowError(`No memory claim with id ${String(id)}.`, 'not_found');
}

function asKind(value: unknown): MemoryClaimKind | undefined {
  return typeof value === 'string' && KINDS.has(value) ? (value as MemoryClaimKind) : undefined;
}

function requireKind(value: unknown): MemoryClaimKind {
  const kind = asKind(value);
  if (kind === undefined) {
    throw invalid('Memory claim kind must be one of distillation, loop, preference, or correction.');
  }
  return kind;
}

/** A required, trimmed, non-empty text field. */
function requireText(value: unknown, label: 'subject' | 'body'): string {
  if (typeof value !== 'string') throw invalid(`A memory claim ${label} must be a string.`);
  const trimmed = value.trim();
  if (trimmed === '') throw invalid(`A memory claim needs a non-empty ${label}.`);
  return trimmed;
}

/** Evidence strength: a finite number in 0..1, or the fallback when unstated. */
function requireConfidence(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalid('Memory claim confidence must be a number between 0 and 1.');
  }
  return value;
}

/** A real `YYYY-MM-DD` day key, rejecting impossible dates such as 2026-02-30. */
function requireDayKey(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalid(`Memory claim ${label} must be a YYYY-MM-DD string.`);
  const window = dayWindowForKey(value);
  if (window === undefined) {
    throw invalid(`"${value}" is not a day. Use YYYY-MM-DD, for example 2026-03-11.`);
  }
  return window.dayKey;
}

/**
 * The day a claim describes: a real day key that is today or earlier.
 *
 * A claim is a statement about something that already happened, so accepting a
 * future `observed_on` would let the assistant record a prediction as history.
 * "Today" is the local calendar day.
 */
function requireObservedOn(value: unknown): string {
  const dayKey = requireDayKey(value, 'observed_on');
  const today = formatDayKey(new Date());
  if (dayKey > today) {
    throw invalid(`Memory claim observed_on ${dayKey} is in the future; observed_on must be ${today} or earlier.`);
  }
  return dayKey;
}

/** An optional integer such as a review-item id. */
function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value)) throw invalid(`Memory claim ${label} must be an integer.`);
  return value as number;
}

/** Optional evidence days: each entry must be a real day key; order kept, duplicates dropped. */
function optionalSourceDays(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalid('Memory claim source_days must be an array of YYYY-MM-DD strings.');
  const seen = new Set<string>();
  const days: string[] = [];
  for (const entry of value as unknown[]) {
    const dayKey = requireDayKey(entry, 'source_days entry');
    if (seen.has(dayKey)) continue;
    seen.add(dayKey);
    days.push(dayKey);
  }
  return days.length === 0 ? undefined : days;
}

/** Validate a read limit, applying the store's default and upper bound. */
function resolveLimit(value: unknown): number {
  if (value === undefined || value === null) return MEMORY_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MEMORY_MAX_LIMIT) {
    throw invalid(`Memory limit must be an integer between 1 and ${String(MEMORY_MAX_LIMIT)}.`);
  }
  return value as number;
}

/** An optional exact subject filter; a blank value counts as "not stated". */
function optionalSubject(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid('Memory subject filter must be a string.');
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Parse the stored `source_days_json`; corrupt JSON degrades to "no evidence days". */
function parseSourceDays(value: unknown): string[] | undefined {
  const raw = asText(value);
  if (raw === undefined || raw === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

/** Map one `memory_claims` row to the tool-facing payload. */
function memoryClaimPayload(row: Row): MemoryClaimPayload {
  const id = asInteger(row.id);
  if (id === undefined) throw new DayflowError('A memory claim row has no usable id.', 'database_error');
  const kind = asKind(row.kind);
  if (kind === undefined) throw new DayflowError(`Memory claim #${String(id)} has an unknown kind.`, 'database_error');
  const payload: MemoryClaimPayload = {
    id,
    kind,
    subject: asText(row.subject) ?? '',
    body: asText(row.body) ?? '',
    observed_on: asText(row.observed_on) ?? '',
    recorded_at: asText(row.recorded_at) ?? '',
    confidence: asNumber(row.confidence) ?? DEFAULT_CONFIDENCE,
  };
  const sourceReviewItem = asInteger(row.source_review_item);
  if (sourceReviewItem !== undefined) payload.source_review_item = sourceReviewItem;
  const sourceDays = parseSourceDays(row.source_days_json);
  if (sourceDays !== undefined) payload.source_days = sourceDays;
  const supersededBy = asInteger(row.superseded_by);
  if (supersededBy !== undefined) payload.superseded_by = supersededBy;
  const supersededOn = asText(row.superseded_on);
  if (supersededOn !== undefined && supersededOn !== '') payload.superseded_on = supersededOn;
  return payload;
}

function readClaim(db: DatabaseSync, id: number): MemoryClaimPayload | undefined {
  const row = db.prepare('SELECT * FROM memory_claims WHERE id = ?').get(id) as Row | undefined;
  return row === undefined ? undefined : memoryClaimPayload(row);
}

function requireClaim(db: DatabaseSync, id: number): MemoryClaimPayload {
  const claim = readClaim(db, id);
  if (claim === undefined) throw new DayflowError(`Could not read memory claim #${String(id)}.`, 'database_error');
  return claim;
}

/** Whether migration 5 managed to build the optional FTS5 index. */
function hasMemoryFtsTable(db: DatabaseSync): boolean {
  try {
    const row = db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'memory_claims_fts'")
      .get() as Row | undefined;
    return asInteger(row?.present) === 1;
  } catch {
    return false;
  }
}

/** Split a query into the tokens both search paths match, e.g. `["dsh","plugin"]`. */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  for (const match of query.matchAll(TOKEN_PATTERN)) {
    if (match[0] !== '') tokens.push(match[0]);
  }
  return tokens;
}

/** A safe FTS5 MATCH expression: every token quoted, all required (`AND`). */
function ftsMatchExpression(tokens: string[]): string {
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' AND ');
}

/** Escape the `LIKE` wildcards so a query matches literal text only. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * FTS5 path: bm25 ranking over subject and body, all tokens required.
 * Throws when the index is unusable; the caller then falls back to `LIKE`.
 */
function ftsSearch(
  db: DatabaseSync,
  tokens: string[],
  options: { includeSuperseded: boolean; kind?: MemoryClaimKind; limit: number },
): MemoryClaimPayload[] {
  const conditions: string[] = [];
  const parameters: (string | number)[] = [ftsMatchExpression(tokens)];
  if (!options.includeSuperseded) conditions.push('m.superseded_by IS NULL');
  if (options.kind !== undefined) {
    conditions.push('m.kind = ?');
    parameters.push(options.kind);
  }
  const filter = conditions.length === 0 ? '' : ` AND ${conditions.join(' AND ')}`;
  const sql =
    'SELECT m.* FROM memory_claims_fts JOIN memory_claims m ON m.id = memory_claims_fts.rowid' +
    ` WHERE memory_claims_fts MATCH ?${filter} ORDER BY bm25(memory_claims_fts) LIMIT ?`;
  parameters.push(options.limit);
  const rows = db.prepare(sql).all(...(parameters as never[])) as Row[];
  return rows.map(memoryClaimPayload);
}

/**
 * `LIKE` path: every token must appear in the subject or the body.
 * Newest observations first; used when FTS5 is unavailable.
 */
function likeSearch(
  db: DatabaseSync,
  needles: string[],
  options: { includeSuperseded: boolean; kind?: MemoryClaimKind; limit: number },
): MemoryClaimPayload[] {
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];
  for (const needle of needles) {
    conditions.push("(subject LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(needle)}%`;
    parameters.push(pattern, pattern);
  }
  if (!options.includeSuperseded) conditions.push('superseded_by IS NULL');
  if (options.kind !== undefined) {
    conditions.push('kind = ?');
    parameters.push(options.kind);
  }
  const sql = `SELECT * FROM memory_claims WHERE ${conditions.join(' AND ')} ORDER BY observed_on DESC, id DESC LIMIT ?`;
  parameters.push(options.limit);
  const rows = db.prepare(sql).all(...(parameters as never[])) as Row[];
  return rows.map(memoryClaimPayload);
}

/**
 * Append one claim.
 *
 * The subject and body are trimmed; `observed_on` must be a real day that is
 * today or earlier; `confidence` defaults to 0.7 and must be in 0..1. Nothing is
 * updated: a changed claim goes through {@link supersedeMemoryClaim}.
 */
export function addMemoryClaim(db: DatabaseSync, input: AddMemoryClaimInput): MemoryClaimPayload {
  if (input === undefined || input === null) throw invalid('A memory claim input is required.');
  const kind = requireKind(input.kind);
  const subject = requireText(input.subject, 'subject');
  const body = requireText(input.body, 'body');
  const observedOn = requireObservedOn(input.observed_on);
  const confidence = requireConfidence(input.confidence, DEFAULT_CONFIDENCE);
  const sourceReviewItem = optionalInteger(input.source_review_item, 'source_review_item');
  const sourceDays = optionalSourceDays(input.source_days);
  const inserted = db
    .prepare(
      `INSERT INTO memory_claims (kind, subject, body, observed_on, confidence, source_review_item, source_days_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      kind,
      subject,
      body,
      observedOn,
      confidence,
      sourceReviewItem ?? null,
      sourceDays === undefined ? null : JSON.stringify(sourceDays),
    );
  const id = asInteger(inserted.lastInsertRowid);
  if (id === undefined) throw new DayflowError('Could not read the id of the new memory claim.', 'database_error');
  return requireClaim(db, id);
}

/**
 * Search claims by text.
 *
 * A query is split into letter/digit tokens and a claim matches when it contains
 * every token (case-insensitively) in its subject or body. Superseded claims are
 * hidden unless `include_superseded` is set. FTS5 ranks by bm25 when the index is
 * available; otherwise the `LIKE` fallback returns the newest `observed_on` first.
 */
export function searchMemoryClaims(
  db: DatabaseSync,
  query: string,
  options: MemoryQueryOptions = {},
): MemoryClaimPayload[] {
  if (typeof query !== 'string' || query.trim() === '') throw invalid('Memory search needs a non-empty query.');
  const settings = options ?? {};
  const includeSuperseded = settings.include_superseded === true;
  const kind = settings.kind === undefined || settings.kind === null ? undefined : requireKind(settings.kind);
  const limit = resolveLimit(settings.limit);
  const tokens = tokenize(query);
  if (tokens.length > 0 && hasMemoryFtsTable(db)) {
    try {
      return ftsSearch(db, tokens, { includeSuperseded, kind, limit });
    } catch {
      // An FTS5 index that cannot be queried (or a corrupted one) must not break
      // search: fall through to the plain LIKE scan below.
    }
  }
  // A query with no tokens (only punctuation) is still a literal substring search.
  const needles = tokens.length === 0 ? [query.trim()] : tokens;
  return likeSearch(db, needles, { includeSuperseded, kind, limit });
}

/**
 * List claims, newest observation first.
 *
 * `subject` is an exact match (the grouping key of a claim's history); `kind`
 * narrows to one kind; `include_superseded` opens the history. A blank subject
 * and a missing subject mean the same thing: no filter.
 */
export function listMemoryClaims(
  db: DatabaseSync,
  options: { subject?: string; kind?: MemoryClaimKind; include_superseded?: boolean; limit?: number } = {},
): MemoryClaimPayload[] {
  const settings = options ?? {};
  const subject = optionalSubject(settings.subject);
  const kind = settings.kind === undefined || settings.kind === null ? undefined : requireKind(settings.kind);
  const includeSuperseded = settings.include_superseded === true;
  const limit = resolveLimit(settings.limit);
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];
  if (subject !== undefined) {
    conditions.push('subject = ?');
    parameters.push(subject);
  }
  if (kind !== undefined) {
    conditions.push('kind = ?');
    parameters.push(kind);
  }
  if (!includeSuperseded) conditions.push('superseded_by IS NULL');
  const where = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
  const sql = `SELECT * FROM memory_claims${where} ORDER BY observed_on DESC, id DESC LIMIT ?`;
  parameters.push(limit);
  const rows = db.prepare(sql).all(...(parameters as never[])) as Row[];
  return rows.map(memoryClaimPayload);
}

/**
 * Append the corrected version of a claim and mark the old row superseded.
 *
 * The old row stays in the table (it is the history), but it is stamped with
 * `superseded_by` = the new claim's id and `superseded_on` = the new claim's
 * `observed_on`. `kind` and `subject` default to the old row's values so a
 * caller only states what actually changed; `confidence` and `source_review_item`
 * are carried over for the same reason, and can be overridden with `confidence`.
 * The insert and the stamp happen in one transaction, so a failure never leaves
 * the old claim marked as replaced by a claim that does not exist.
 */
export function supersedeMemoryClaim(
  db: DatabaseSync,
  oldId: number,
  input: SupersedeMemoryClaimInput,
): MemoryClaimPayload {
  if (input === undefined || input === null) throw invalid('A memory claim input is required to supersede a claim.');
  if (!Number.isSafeInteger(oldId) || oldId < 1) throw notFound(oldId);
  const oldRow = db.prepare('SELECT * FROM memory_claims WHERE id = ?').get(oldId) as Row | undefined;
  if (oldRow === undefined) throw notFound(oldId);
  const current = memoryClaimPayload(oldRow);
  if (current.superseded_by !== undefined) {
    throw invalid(
      `Memory claim #${String(oldId)} was already superseded by #${String(current.superseded_by)}; ` +
        'append a new claim instead of superseding the same one twice.',
    );
  }
  const kind = input.kind === undefined || input.kind === null ? current.kind : requireKind(input.kind);
  const subject = input.subject === undefined || input.subject === null ? current.subject : requireText(input.subject, 'subject');
  const confidence = requireConfidence(input.confidence, current.confidence);
  const sourceDays = input.source_days === undefined ? current.source_days : optionalSourceDays(input.source_days);
  db.exec('BEGIN IMMEDIATE');
  try {
    const created = addMemoryClaim(db, {
      kind,
      subject,
      body: input.body,
      observed_on: input.observed_on,
      confidence,
      source_review_item: current.source_review_item,
      source_days: sourceDays,
    });
    db.prepare('UPDATE memory_claims SET superseded_by = ?, superseded_on = ? WHERE id = ?').run(
      created.id,
      created.observed_on,
      oldId,
    );
    db.exec('COMMIT');
    return created;
  } catch (cause) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the original failure when rollback itself cannot run.
    }
    throw cause;
  }
}

/**
 * Delete one claim permanently.
 *
 * Forgetting is the user's decision, so it is a hard delete rather than another
 * appendix. A claim that other rows point at as their successor cannot be
 * removed: those rows exist precisely to keep the replacement chain auditable, so
 * the claim it replaced has to be forgotten first. The FTS trigger (when the
 * index exists) removes the text from the index in the same statement.
 */
export function forgetMemoryClaim(db: DatabaseSync, id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) throw notFound(id);
  const row = db.prepare('SELECT id FROM memory_claims WHERE id = ?').get(id) as Row | undefined;
  if (row === undefined) throw notFound(id);
  const referencing = db
    .prepare('SELECT id FROM memory_claims WHERE superseded_by = ? ORDER BY id LIMIT 1')
    .get(id) as Row | undefined;
  if (referencing !== undefined) {
    throw invalid(
      `Memory claim #${String(id)} is still referenced as the successor of claim #${String(asInteger(referencing.id))}; ` +
        'forget the claim it superseded first.',
    );
  }
  db.prepare('DELETE FROM memory_claims WHERE id = ?').run(id);
}

/**
 * Turn a kept review-queue proposal into a claim.
 *
 * `subject` is the proposal's title and `body` falls back to the title when the
 * proposal has no body. `observed_on` is the day the proposal came from —
 * `source_day` — or today when the proposal named no day; `source_days` records
 * that same day as the evidence. The review item id is kept so the claim can be
 * traced back to the proposal the user kept.
 */
export function createMemoryFromReviewItem(
  db: DatabaseSync,
  item: { id: number; kind: 'distillation' | 'loop'; title: string; body: string; source_day?: string; confidence: number },
): MemoryClaimPayload {
  if (item === undefined || item === null) throw invalid('A review item is required to create a memory claim.');
  const sourceDay =
    item.source_day === undefined || item.source_day === null || item.source_day.trim() === ''
      ? undefined
      : requireDayKey(item.source_day, 'source_day');
  const body = typeof item.body === 'string' && item.body.trim() !== '' ? item.body : item.title;
  return addMemoryClaim(db, {
    kind: item.kind,
    subject: item.title,
    body,
    observed_on: sourceDay ?? formatDayKey(new Date()),
    confidence: item.confidence,
    source_review_item: item.id,
    source_days: sourceDay === undefined ? undefined : [sourceDay],
  });
}
