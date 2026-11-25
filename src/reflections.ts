/**
 * Reflections: the user's own written summary of a day or of a week.
 *
 * A reflection is authored, not derived: the user (or the assistant drafting for
 * them) writes the body, and the store keeps it until it is rewritten or
 * deleted. Saving the same period twice is therefore an update, not an append —
 * `(kind, period_key)` is unique, and a re-save replaces the body and the
 * evidence lists while keeping the original `created_at`.
 *
 * A period is normalized before it touches the table:
 *
 * - a **day** reflection is keyed by its own `YYYY-MM-DD` day key;
 * - a **week** reflection is keyed by the Monday of the Dayflow week containing
 *   the given day, so any day of the same week addresses the same row.
 *
 * The optional evidence lists (`highlights`, `source_days`,
 * `source_activity_ids`) are stored as JSON columns; a reader treats missing or
 * corrupt JSON as an empty list rather than failing the whole reflection.
 *
 * The table lives in the owned journal and is created by migration 6 in
 * {@link module:dsh-plugin-dayflow/journal}.
 * @module dsh-plugin-dayflow/reflections
 */

import type { DatabaseSync } from 'node:sqlite';

import { dayWindowForKey, formatDayKey, weekWindowContaining } from './day.js';
import { DayflowError } from './errors.js';

/** The two periods a reflection can describe: one Dayflow day, or one week. */
export type ReflectionKind = 'day' | 'week';

/** One stored reflection, as saved and as returned to a caller. */
export interface ReflectionPayload {
  id: number;
  kind: ReflectionKind;
  /** The normalized period: the day key, or the Monday of the week. */
  period_key: string;
  /** The summary itself, trimmed. */
  body: string;
  /** Short call-outs the user marked, in their own order. */
  highlights: string[];
  /** The days the reflection draws on. */
  source_days: string[];
  /** The activity ids the reflection draws on. */
  source_activity_ids: number[];
  /** When the row was first written (SQLite `CURRENT_TIMESTAMP`, in UTC). */
  created_at: string;
  /** When the row was last rewritten. */
  updated_at: string;
}

/** What a caller supplies when saving a reflection. */
export interface SaveReflectionInput {
  kind: ReflectionKind;
  /** A day of the period to save; a week period accepts any day in the week. */
  period: string;
  body: string;
  highlights?: string[];
  source_days?: string[];
  source_activity_ids?: number[];
}

/** Upper bound for one reflection body, in characters after trimming. */
export const REFLECTION_MAX_BODY_CHARS = 4000;
/** Read limit when the caller states none. */
export const REFLECTION_DEFAULT_LIMIT = 20;
/** Upper bound for one reflection list. */
export const REFLECTION_MAX_LIMIT = 100;
/** Upper bound for the highlights of one reflection. */
const MAX_HIGHLIGHTS = 20;
/** Upper bound for one highlight, in characters after trimming. */
const MAX_HIGHLIGHT_CHARS = 200;

const KINDS: ReadonlySet<string> = new Set<ReflectionKind>(['day', 'week']);

/** One raw SQLite row, keyed by column name. */
type Row = Record<string, unknown>;

function asInteger(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  return undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function invalid(message: string): DayflowError {
  return new DayflowError(message, 'invalid_input');
}

function asKind(value: unknown): ReflectionKind | undefined {
  return typeof value === 'string' && KINDS.has(value) ? (value as ReflectionKind) : undefined;
}

function requireKind(value: unknown): ReflectionKind {
  const kind = asKind(value);
  if (kind === undefined) throw invalid('A reflection kind must be day or week.');
  return kind;
}

/**
 * Normalize the period a caller addressed to the key the table stores.
 *
 * @param kind - `day` keeps the day key; `week` moves to that week's Monday.
 * @param period - any real `YYYY-MM-DD` day inside the wanted period.
 * @returns the normalized `period_key`.
 */
export function normalizeReflectionPeriod(kind: ReflectionKind, period: string): string {
  const resolvedKind = requireKind(kind);
  if (typeof period !== 'string') throw invalid('A reflection period must be a YYYY-MM-DD string.');
  const window = dayWindowForKey(period);
  if (window === undefined) {
    throw invalid(`"${String(period)}" is not a day. Use YYYY-MM-DD, for example 2026-03-11.`);
  }
  if (resolvedKind === 'day') return window.dayKey;
  return formatDayKey(weekWindowContaining(window.start).start);
}

/** A required, trimmed, non-empty, size-bounded body. */
function requireBody(value: unknown): string {
  if (typeof value !== 'string') throw invalid('A reflection body must be a string.');
  const trimmed = value.trim();
  if (trimmed === '') throw invalid('A reflection needs a non-empty body.');
  if (trimmed.length > REFLECTION_MAX_BODY_CHARS) {
    throw invalid(`A reflection body must be at most ${String(REFLECTION_MAX_BODY_CHARS)} characters.`);
  }
  return trimmed;
}

/** Optional highlight strings; empty entries are dropped, order is kept. */
function optionalHighlights(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid('Reflection highlights must be an array of strings.');
  const highlights: string[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string') throw invalid('Each reflection highlight must be a string.');
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    if (trimmed.length > MAX_HIGHLIGHT_CHARS) {
      throw invalid(`A reflection highlight must be at most ${String(MAX_HIGHLIGHT_CHARS)} characters.`);
    }
    highlights.push(trimmed);
  }
  if (highlights.length > MAX_HIGHLIGHTS) {
    throw invalid(`A reflection supports at most ${String(MAX_HIGHLIGHTS)} highlights.`);
  }
  return highlights;
}

/** Optional evidence days: each entry must be a real day key; duplicates dropped, order kept. */
function optionalSourceDays(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid('Reflection source_days must be an array of YYYY-MM-DD strings.');
  const seen = new Set<string>();
  const days: string[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string') throw invalid('Each reflection source day must be a YYYY-MM-DD string.');
    const window = dayWindowForKey(entry);
    if (window === undefined) {
      throw invalid(`"${entry}" is not a day. Use YYYY-MM-DD, for example 2026-03-11.`);
    }
    if (seen.has(window.dayKey)) continue;
    seen.add(window.dayKey);
    days.push(window.dayKey);
  }
  return days;
}

/** Optional evidence activity ids: a list of integers. */
function optionalActivityIds(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid('Reflection source_activity_ids must be an array of integers.');
  const ids: number[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry)) {
      throw invalid('Each reflection source activity id must be an integer.');
    }
    ids.push(entry);
  }
  return ids;
}

/** Validate a read limit, applying the store's default and upper bound. */
function resolveLimit(value: unknown): number {
  if (value === undefined || value === null) return REFLECTION_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > REFLECTION_MAX_LIMIT) {
    throw invalid(`Reflection limit must be an integer between 1 and ${String(REFLECTION_MAX_LIMIT)}.`);
  }
  return value as number;
}

/** Decode a JSON array column; missing, non-array, or corrupt JSON degrades to `[]`. */
function parseJsonArray(value: unknown): unknown[] {
  const raw = asText(value);
  if (raw === undefined || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Decode a JSON string-array column, keeping only the string entries. */
function parseStringArray(value: unknown): string[] {
  return parseJsonArray(value).filter((entry): entry is string => typeof entry === 'string');
}

/** Decode a JSON integer-array column, keeping only the safe-integer entries. */
function parseIntegerArray(value: unknown): number[] {
  return parseJsonArray(value).filter((entry): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry));
}

/** Map one `reflections` row to the caller-facing payload. */
function reflectionPayload(row: Row): ReflectionPayload {
  const id = asInteger(row.id);
  if (id === undefined) throw new DayflowError('A reflection row has no usable id.', 'database_error');
  const kind = asKind(row.kind);
  if (kind === undefined) throw new DayflowError(`Reflection #${String(id)} has an unknown kind.`, 'database_error');
  return {
    id,
    kind,
    period_key: asText(row.period_key) ?? '',
    body: asText(row.body) ?? '',
    highlights: parseStringArray(row.highlights_json),
    source_days: parseStringArray(row.source_days_json),
    source_activity_ids: parseIntegerArray(row.source_activity_ids_json),
    created_at: asText(row.created_at) ?? '',
    updated_at: asText(row.updated_at) ?? '',
  };
}

function readReflection(db: DatabaseSync, kind: ReflectionKind, periodKey: string): ReflectionPayload | undefined {
  const row = db
    .prepare('SELECT * FROM reflections WHERE kind = ? AND period_key = ?')
    .get(kind, periodKey) as Row | undefined;
  return row === undefined ? undefined : reflectionPayload(row);
}

/**
 * Save (insert or rewrite) one reflection.
 *
 * The body is trimmed and must be non-empty and at most
 * {@link REFLECTION_MAX_BODY_CHARS} characters; highlights lose their blank
 * entries and are capped at 20 of at most 200 characters each; `source_days`
 * must be real day keys. Saving an existing `(kind, normalized period)` rewrites
 * the row in place: the `id` and `created_at` stay, `updated_at` moves forward,
 * and lists left out of the input are cleared rather than carried over.
 */
export function saveReflection(db: DatabaseSync, input: SaveReflectionInput): ReflectionPayload {
  if (input === undefined || input === null) throw invalid('A reflection input is required.');
  const kind = requireKind(input.kind);
  const periodKey = normalizeReflectionPeriod(kind, input.period);
  const body = requireBody(input.body);
  const highlights = optionalHighlights(input.highlights);
  const sourceDays = optionalSourceDays(input.source_days);
  const activityIds = optionalActivityIds(input.source_activity_ids);
  db.prepare(
    `INSERT INTO reflections (kind, period_key, body, highlights_json, source_days_json, source_activity_ids_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, period_key) DO UPDATE SET
       body = excluded.body,
       highlights_json = excluded.highlights_json,
       source_days_json = excluded.source_days_json,
       source_activity_ids_json = excluded.source_activity_ids_json,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(
    kind,
    periodKey,
    body,
    JSON.stringify(highlights),
    JSON.stringify(sourceDays),
    JSON.stringify(activityIds),
  );
  const saved = readReflection(db, kind, periodKey);
  if (saved === undefined) throw new DayflowError('Could not read back the saved reflection.', 'database_error');
  return saved;
}

/**
 * Read one reflection by the period the caller has in mind.
 *
 * The period is normalized first, so any day of a week finds that week's
 * reflection. A period that was never saved returns `undefined`.
 */
export function getReflection(
  db: DatabaseSync,
  kind: ReflectionKind,
  period: string,
): ReflectionPayload | undefined {
  const resolvedKind = requireKind(kind);
  const periodKey = normalizeReflectionPeriod(resolvedKind, period);
  return readReflection(db, resolvedKind, periodKey);
}

/**
 * List reflections, newest period first (`period_key DESC, id DESC`).
 *
 * `kind` narrows to day or week reflections; `limit` defaults to
 * {@link REFLECTION_DEFAULT_LIMIT} and must be between 1 and
 * {@link REFLECTION_MAX_LIMIT}.
 */
export function listReflections(
  db: DatabaseSync,
  options: { kind?: ReflectionKind; limit?: number } = {},
): ReflectionPayload[] {
  const settings = options ?? {};
  const kind = settings.kind === undefined || settings.kind === null ? undefined : requireKind(settings.kind);
  const limit = resolveLimit(settings.limit);
  const where = kind === undefined ? '' : ' WHERE kind = ?';
  const parameters: (string | number)[] = kind === undefined ? [] : [kind];
  parameters.push(limit);
  const rows = db
    .prepare(`SELECT * FROM reflections${where} ORDER BY period_key DESC, id DESC LIMIT ?`)
    .all(...(parameters as never[])) as Row[];
  return rows.map(reflectionPayload);
}

/**
 * Delete one reflection permanently.
 *
 * The period is normalized like every other operation. Returns whether a row
 * was actually deleted, so a caller can tell "removed it" from "there was
 * nothing there".
 */
export function deleteReflection(db: DatabaseSync, kind: ReflectionKind, period: string): boolean {
  const resolvedKind = requireKind(kind);
  const periodKey = normalizeReflectionPeriod(resolvedKind, period);
  const result = db.prepare('DELETE FROM reflections WHERE kind = ? AND period_key = ?').run(resolvedKind, periodKey);
  const changes = asInteger(result.changes) ?? 0;
  return changes > 0;
}
