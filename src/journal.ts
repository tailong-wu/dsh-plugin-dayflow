/**
 * The plugin-owned journal store and Dayflow importer.
 *
 * The owned store deliberately exposes compatibility views with the names used
 * by the original Dayflow reader (`timeline_cards`, `analysis_batches`,
 * `screenshots`, and `daily_standup_entries`).  Query and panel code can move to
 * this store without changing their JSON or route contracts.
 * @module dsh-plugin-dayflow/journal
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { DayflowError } from './errors.js';
import { dayWindowForKey, epochSeconds } from './day.js';
import { openDatabase, openJournalDatabase, withDatabase } from './db.js';
import type { ResolvedConfig } from './config.js';
import { defaultJournalPath } from './paths.js';

/** Current owned-store schema version. Migrations are forward-only. */
export const JOURNAL_SCHEMA_VERSION = 2;
/** Default source id used by an import from a Dayflow database. */
export const DAYFLOW_SOURCE_ID = 'dayflow';

/** A JSON-friendly category supplied by a preferences/import adapter. */
export interface JournalCategoryInput {
  readonly name: string;
  readonly colorHex?: string;
  readonly isSystem?: boolean;
  readonly isIdle?: boolean;
  readonly description?: string;
}

/** Options for importing one Dayflow database into the owned store. */
export interface DayflowImportOptions {
  /** Absolute path to Dayflow's `chunks.sqlite`. */
  readonly sourcePath: string;
  /** Owned journal path; defaults to `$DSH_HOME/dayflow/journal.sqlite`. */
  readonly journalPath?: string;
  /** Stable id for this source; defaults to `dayflow`. */
  readonly sourceId?: string;
  /** Optional categories decoded from Dayflow preferences. */
  readonly categories?: readonly JournalCategoryInput[];
}

/** A count of rows imported or left unchanged for one entity. */
export interface JournalImportCounts {
  readonly [entity: string]: number;
}

/** One row or table that could not be represented by the owned schema. */
export interface JournalImportSkip {
  readonly table: string;
  readonly reason: string;
}

/** Result of a lossless, idempotent import attempt. */
export interface DayflowImportReport {
  readonly sourceId: string;
  /** Snake-case aliases are the stable tool-facing report fields. */
  readonly source_path: string;
  readonly journal_path: string;
  /** Camel-case aliases remain convenient for TypeScript callers. */
  readonly sourcePath: string;
  readonly journalPath: string;
  readonly imported: JournalImportCounts;
  readonly updated: JournalImportCounts;
  readonly unchanged: JournalImportCounts;
  readonly skipped: readonly JournalImportSkip[];
  /** Human-readable reasons for skipped rows, retained for logs. */
  readonly warnings: readonly string[];
}

/** Tool-facing name for the importer report. */
export type ImportReport = DayflowImportReport;

interface Row {
  readonly [key: string]: unknown;
}

interface MutableCounts {
  [entity: string]: number;
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORTED_SOURCE_TABLES = new Set([
  'analysis_batches',
  'timeline_cards',
  'screenshots',
  'daily_standup_entries',
  'observations',
  'day_goals',
  'day_goal_categories',
  'journal_entries',
  'timeline_review_ratings',
  'categories',
]);
const SENSITIVE_SOURCE_TABLES = new Set(['llm_calls', 'chat_history', 'chat_messages']);

/** The canonical schema. Compatibility views are recreated by migration 1. */
const MIGRATION_1 = `
  CREATE TABLE IF NOT EXISTS days (
    day TEXT PRIMARY KEY,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    time_zone TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sources (
    source_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    source_key TEXT NOT NULL,
    local_id INTEGER,
    fingerprint TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_id, entity_type, source_key)
  );
  CREATE INDEX IF NOT EXISTS sources_local_id_idx
    ON sources (source_id, entity_type, local_id);

  CREATE TABLE IF NOT EXISTS analysis_batches (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    batch_start_ts INTEGER,
    batch_end_ts INTEGER,
    status TEXT NOT NULL DEFAULT 'complete',
    reason TEXT,
    payload_json TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    batch_id INTEGER,
    start TEXT,
    end TEXT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    day TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    subcategory TEXT,
    detailed_summary TEXT,
    metadata TEXT,
    video_summary_url TEXT,
    payload_json TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );
  CREATE INDEX IF NOT EXISTS activities_day_idx ON activities (day, start_ts);
  CREATE INDEX IF NOT EXISTS activities_range_idx ON activities (start_ts, end_ts);

  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    activity_id INTEGER,
    start_ts INTEGER,
    end_ts INTEGER,
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    file_path TEXT,
    file_size INTEGER,
    idle_seconds_at_capture INTEGER,
    frame_index INTEGER,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );
  CREATE INDEX IF NOT EXISTS screenshots_captured_idx ON screenshots (captured_at);

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    name TEXT NOT NULL,
    color_hex TEXT NOT NULL DEFAULT '#A0AEC0',
    is_system INTEGER NOT NULL DEFAULT 0,
    is_idle INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    payload_json TEXT,
    UNIQUE (source_id, source_key)
  );
  CREATE INDEX IF NOT EXISTS categories_name_idx ON categories (name);

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    day TEXT,
    focus_minutes INTEGER,
    distraction_limit_minutes INTEGER,
    focus_categories_json TEXT,
    distraction_categories_json TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE IF NOT EXISTS goal_categories (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    goal_id INTEGER,
    category_name TEXT,
    role TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    day TEXT,
    kind TEXT,
    title TEXT,
    body TEXT,
    status TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    activity_id INTEGER,
    start_ts INTEGER,
    end_ts INTEGER,
    rating TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );

  CREATE TABLE IF NOT EXISTS daily_standup_entries (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL DEFAULT 'manual',
    source_key TEXT NOT NULL,
    standup_day TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, source_key)
  );
  CREATE INDEX IF NOT EXISTS standup_day_idx ON daily_standup_entries (standup_day);
`;

/**
 * Return one SQLite value as a finite number.
 * SQLite may expose INTEGER values as bigint on some Node builds.
 */
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

function firstText(row: Row, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asText(row[key]);
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function firstNumber(row: Row, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = asNumber(row[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstInteger(row: Row, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = asInteger(row[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstKey(row: Row, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const text = asText(row[key]);
    if (text !== undefined && text !== '') return text;
    const number = asInteger(row[key]);
    if (number !== undefined) return String(number);
  }
  return undefined;
}

function boolValue(value: unknown): number {
  if (value === true) return 1;
  if (value === false || value === undefined || value === null) return 0;
  const number = asNumber(value);
  return number !== undefined && number !== 0 ? 1 : 0;
}

function jsonText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, (_key, entry: unknown) => (typeof entry === 'bigint' ? Number(entry) : entry)) ?? '{}';
  } catch {
    return '{}';
  }
}

function rowJson(row: Row): string {
  return jsonText(row);
}

function stableRowKey(row: Row, occurrences: Map<string, number>, ...keys: string[]): string {
  const direct = firstKey(row, ...keys);
  if (direct !== undefined) return direct;
  const fingerprint = createHash('sha256').update(rowJson(row)).digest('hex');
  const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
  occurrences.set(fingerprint, occurrence);
  return `row:${fingerprint}:${occurrence}`;
}

function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function epochFromValue(value: unknown): number | undefined {
  const number = asNumber(value);
  if (number !== undefined) return number > 100_000_000_000 ? Math.floor(number / 1000) : Math.floor(number);
  const text = asText(value);
  if (text === undefined || text === '') return undefined;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

/** Compute a local Dayflow day key from a Unix timestamp. */
function dayKeyFromSeconds(seconds: number): string {
  const date = new Date(seconds * 1000);
  date.setHours(date.getHours() - 4);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayKeyFromRow(row: Row, startSeconds?: number): string | undefined {
  const explicit = firstText(row, 'day', 'date', 'day_key', 'standup_day');
  if (explicit !== undefined && DAY_KEY_PATTERN.test(explicit)) return explicit;
  return startSeconds === undefined ? undefined : dayKeyFromSeconds(startSeconds);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const rows = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1").all(table) as Row[];
  return rows.length > 0;
}

function tableHasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
  return rows.some((row) => asText(row.name) === column);
}

function readTable(db: DatabaseSync, table: string): Row[] | undefined {
  if (!tableExists(db, table)) return undefined;
  return db.prepare(`SELECT * FROM ${table}`).all() as Row[];
}

function sourceTableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Row[];
  return rows.map((row) => asText(row.name)).filter((name): name is string => name !== undefined);
}

interface ExistingSource {
  readonly localId: number;
  readonly fingerprint: string | undefined;
}

function existingSource(db: DatabaseSync, entityType: string, sourceId: string, sourceKey: string): ExistingSource | undefined {
  const rows = db
    .prepare('SELECT local_id, fingerprint FROM sources WHERE source_id = ? AND entity_type = ? AND source_key = ?')
    .all(sourceId, entityType, sourceKey) as Row[];
  const localId = asInteger(rows[0]?.local_id);
  if (localId === undefined) return undefined;
  return { localId, fingerprint: asText(rows[0]?.fingerprint) };
}

function existingLocalId(db: DatabaseSync, entityType: string, sourceId: string, sourceKey: string): number | undefined {
  return existingSource(db, entityType, sourceId, sourceKey)?.localId;
}

function rememberSource(
  db: DatabaseSync,
  sourceId: string,
  entityType: string,
  sourceKey: string,
  localId: number | undefined,
  fingerprint?: string,
): void {
  db.prepare(
    `INSERT INTO sources (source_id, entity_type, source_key, local_id, fingerprint, imported_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (source_id, entity_type, source_key) DO UPDATE SET
       local_id = excluded.local_id,
       fingerprint = excluded.fingerprint,
       imported_at = excluded.imported_at`,
  ).run(sourceId, entityType, sourceKey, localId ?? null, fingerprint ?? null);
}

function idAvailable(db: DatabaseSync, table: string, id: number): boolean {
  const rows = db.prepare(`SELECT 1 AS present FROM ${table} WHERE id = ? LIMIT 1`).all(id) as Row[];
  return rows.length === 0;
}

function localIdFor(
  db: DatabaseSync,
  table: string,
  entityType: string,
  sourceId: string,
  sourceKey: string,
  requested: number | undefined,
): { id: number; existed: boolean } {
  const previous = existingLocalId(db, entityType, sourceId, sourceKey);
  if (previous !== undefined) return { id: previous, existed: true };
  if (requested !== undefined && requested > 0 && idAvailable(db, table, requested)) {
    return { id: requested, existed: false };
  }
  const rows = db.prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ${table}`).all() as Row[];
  return { id: Math.max(1, asInteger(rows[0]?.next_id) ?? 1), existed: false };
}

function setCount(counts: MutableCounts, entity: string, amount = 1): void {
  counts[entity] = (counts[entity] ?? 0) + amount;
}

function markDay(db: DatabaseSync, day: string | undefined, startTs?: number, endTs?: number): void {
  if (day === undefined) return;
  const window = dayWindowForKey(day);
  const start = startTs ?? (window === undefined ? Math.floor(new Date(`${day}T04:00:00`).getTime() / 1000) : epochSeconds(window.start));
  const end = endTs ?? (window === undefined ? start + 86_400 : epochSeconds(window.end));
  db.prepare(
    `INSERT INTO days (day, start_ts, end_ts, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(day) DO UPDATE SET start_ts = excluded.start_ts, end_ts = excluded.end_ts, updated_at = excluded.updated_at`,
  ).run(day, start, end);
}

function upsertBatch(
  db: DatabaseSync,
  row: Row,
  sourceId: string,
  sourceKey: string,
): { id: number; existed: boolean } | undefined {
  const requested = firstInteger(row, 'id', 'batch_id');
  const ids = localIdFor(db, 'analysis_batches', 'analysis_batches', sourceId, sourceKey, requested);
  const start = epochFromValue(row.batch_start_ts ?? row.start_ts ?? row.start);
  const end = epochFromValue(row.batch_end_ts ?? row.end_ts ?? row.end);
  const status = firstText(row, 'status') ?? 'complete';
  const reason = firstText(row, 'reason');
  const payload = rowJson(row);
  if (ids.existed) {
    db.prepare(
      `UPDATE analysis_batches SET batch_start_ts = ?, batch_end_ts = ?, status = ?, reason = ?, payload_json = ?,
       is_deleted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(start ?? null, end ?? null, status, reason ?? null, payload, boolValue(row.is_deleted), ids.id);
  } else {
    db.prepare(
      `INSERT INTO analysis_batches (id, source_id, source_key, batch_start_ts, batch_end_ts, status, reason, payload_json, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ids.id, sourceId, sourceKey, start ?? null, end ?? null, status, reason ?? null, payload, boolValue(row.is_deleted));
    rememberSource(db, sourceId, 'analysis_batches', sourceKey, ids.id, payload);
  }
  if (start !== undefined && boolValue(row.is_deleted) === 0) markDay(db, dayKeyFromSeconds(start));
  return ids;
}

function upsertScreenshot(
  db: DatabaseSync,
  row: Row,
  sourceId: string,
  sourceKey: string,
): { id: number; existed: boolean } | undefined {
  const captured = firstNumber(row, 'captured_at', 'timestamp', 'start_ts');
  if (captured === undefined) return undefined;
  const ids = localIdFor(db, 'screenshots', 'screenshots', sourceId, sourceKey, firstInteger(row, 'id'));
  const path = firstText(row, 'file_path', 'path');
  const size = firstInteger(row, 'file_size', 'size');
  const idle = firstInteger(row, 'idle_seconds_at_capture', 'idle_seconds');
  const frame = firstInteger(row, 'frame_index', 'index');
  const payload = rowJson(row);
  if (ids.existed) {
    db.prepare(
      `UPDATE screenshots SET captured_at = ?, file_path = ?, file_size = ?, idle_seconds_at_capture = ?, frame_index = ?,
       is_deleted = ?, payload_json = ? WHERE id = ?`,
    ).run(Math.floor(captured), path ?? null, size ?? null, idle ?? null, frame ?? null, boolValue(row.is_deleted), payload, ids.id);
  } else {
    db.prepare(
      `INSERT INTO screenshots (id, source_id, source_key, captured_at, file_path, file_size, idle_seconds_at_capture,
       frame_index, is_deleted, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ids.id, sourceId, sourceKey, Math.floor(captured), path ?? null, size ?? null, idle ?? null, frame ?? null, boolValue(row.is_deleted), payload);
    rememberSource(db, sourceId, 'screenshots', sourceKey, ids.id, payload);
  }
  if (boolValue(row.is_deleted) === 0) markDay(db, dayKeyFromSeconds(Math.floor(captured)));
  return ids;
}

function upsertActivity(
  db: DatabaseSync,
  row: Row,
  sourceId: string,
  sourceKey: string,
  batchIds: ReadonlyMap<string, number>,
): { id: number; existed: boolean } | undefined {
  const start = epochFromValue(row.start_ts ?? row.start);
  const end = epochFromValue(row.end_ts ?? row.end);
  if (start === undefined || end === undefined) return undefined;
  const ids = localIdFor(db, 'activities', 'activities', sourceId, sourceKey, firstInteger(row, 'id'));
  const sourceBatch = firstInteger(row, 'batch_id');
  const batchId = sourceBatch === undefined ? undefined : batchIds.get(String(sourceBatch));
  const day = dayKeyFromRow(row, start) ?? dayKeyFromSeconds(start);
  const startText = firstText(row, 'start') ?? isoFromSeconds(start);
  const endText = firstText(row, 'end') ?? isoFromSeconds(end);
  const title = firstText(row, 'title') ?? '';
  const summary = firstText(row, 'summary') ?? '';
  const category = firstText(row, 'category') ?? '';
  const subcategory = firstText(row, 'subcategory');
  const detailed = firstText(row, 'detailed_summary', 'detailedSummary');
  const metadata = row.metadata === undefined || row.metadata === null ? undefined : jsonText(row.metadata);
  const video = firstText(row, 'video_summary_url');
  const deleted = boolValue(row.is_deleted);
  if (ids.existed) {
    db.prepare(
      `UPDATE activities SET batch_id = ?, start = ?, end = ?, start_ts = ?, end_ts = ?, day = ?, title = ?, summary = ?,
       category = ?, subcategory = ?, detailed_summary = ?, metadata = ?, video_summary_url = ?, payload_json = ?, is_deleted = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(batchId ?? null, startText, endText, Math.floor(start), Math.floor(end), day, title, summary, category, subcategory ?? null, detailed ?? null, metadata ?? null, video ?? null, rowJson(row), deleted, ids.id);
  } else {
    db.prepare(
      `INSERT INTO activities (id, source_id, source_key, batch_id, start, end, start_ts, end_ts, day, title, summary,
       category, subcategory, detailed_summary, metadata, video_summary_url, payload_json, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ids.id, sourceId, sourceKey, batchId ?? null, startText, endText, Math.floor(start), Math.floor(end), day, title, summary, category, subcategory ?? null, detailed ?? null, metadata ?? null, video ?? null, rowJson(row), deleted);
    rememberSource(db, sourceId, 'activities', sourceKey, ids.id, rowJson(row));
  }
  if (deleted === 0) markDay(db, day);
  return ids;
}

function upsertStandup(db: DatabaseSync, row: Row, sourceId: string, sourceKey: string): boolean {
  const day = dayKeyFromRow(row);
  const payload = firstText(row, 'payload_json', 'payload') ?? rowJson(row);
  if (day === undefined) return false;
  const ids = localIdFor(db, 'daily_standup_entries', 'daily_standup_entries', sourceId, sourceKey, firstInteger(row, 'id'));
  if (ids.existed) {
    db.prepare('UPDATE daily_standup_entries SET standup_day = ?, payload_json = ?, is_deleted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(day, payload, boolValue(row.is_deleted), ids.id);
  } else {
    db.prepare('INSERT INTO daily_standup_entries (id, source_id, source_key, standup_day, payload_json, is_deleted) VALUES (?, ?, ?, ?, ?, ?)').run(ids.id, sourceId, sourceKey, day, payload, boolValue(row.is_deleted));
    rememberSource(db, sourceId, 'daily_standup_entries', sourceKey, ids.id, payload);
  }
  if (boolValue(row.is_deleted) === 0) markDay(db, day);
  return true;
}

function upsertCategory(db: DatabaseSync, category: JournalCategoryInput, sourceId: string, sourceKey: string): boolean {
  const name = category.name.trim();
  if (name === '') return false;
  const ids = localIdFor(db, 'categories', 'categories', sourceId, sourceKey, undefined);
  const color = category.colorHex ?? '#A0AEC0';
  if (ids.existed) {
    db.prepare('UPDATE categories SET name = ?, color_hex = ?, is_system = ?, is_idle = ?, description = ? WHERE id = ?').run(name, color, category.isSystem === true ? 1 : 0, category.isIdle === true ? 1 : 0, category.description ?? null, ids.id);
  } else {
    db.prepare('INSERT INTO categories (id, source_id, source_key, name, color_hex, is_system, is_idle, description, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(ids.id, sourceId, sourceKey, name, color, category.isSystem === true ? 1 : 0, category.isIdle === true ? 1 : 0, category.description ?? null, jsonText(category));
    rememberSource(db, sourceId, 'categories', sourceKey, ids.id, jsonText(category));
  }
  return true;
}

function importGenericRows(
  db: DatabaseSync,
  table: 'observations' | 'goals' | 'goal_categories' | 'journal_entries' | 'reviews',
  entityType: string,
  rows: readonly Row[],
  sourceId: string,
  activityIds: ReadonlyMap<string, number>,
  imported: MutableCounts,
  updated: MutableCounts,
  unchanged: MutableCounts,
  skipped: JournalImportSkip[],
): void {
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    const sourceKey =
      table === 'goals'
        ? stableRowKey(row, occurrences, 'id', 'uuid', 'key', 'day', 'date')
        : stableRowKey(row, occurrences, 'id', 'uuid', 'key');
    const payload = rowJson(row);
    const existing = existingSource(db, entityType, sourceId, sourceKey);
    if (existing?.fingerprint === payload) {
      setCount(unchanged, entityType);
      continue;
    }
    const ids = localIdFor(db, table, entityType, sourceId, sourceKey, firstInteger(row, 'id'));
    const deleted = boolValue(row.is_deleted);
    if (table === 'observations') {
      const activityKey = firstKey(row, 'timeline_card_id', 'activity_id', 'card_id');
      const activityId = activityKey === undefined ? undefined : activityIds.get(activityKey);
      const start = firstNumber(row, 'start_ts', 'start');
      const end = firstNumber(row, 'end_ts', 'end');
      if (existing !== undefined) db.prepare('UPDATE observations SET activity_id = ?, start_ts = ?, end_ts = ?, payload_json = ?, is_deleted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(activityId ?? null, start ?? null, end ?? null, payload, deleted, ids.id);
      else {
        db.prepare('INSERT INTO observations (id, source_id, source_key, activity_id, start_ts, end_ts, payload_json, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(ids.id, sourceId, sourceKey, activityId ?? null, start ?? null, end ?? null, payload, deleted);
        rememberSource(db, sourceId, entityType, sourceKey, ids.id, payload);
      }
    } else if (table === 'goals') {
      const day = dayKeyFromRow(row);
      if (day === undefined && firstText(row, 'payload_json') === undefined) {
        skipped.push({ table: entityType, reason: 'missing day or payload' });
        continue;
      }
      if (existing !== undefined) db.prepare('UPDATE goals SET day = ?, focus_minutes = ?, distraction_limit_minutes = ?, focus_categories_json = ?, distraction_categories_json = ?, payload_json = ?, is_deleted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(day ?? null, firstInteger(row, 'focus_minutes', 'focusMinutes') ?? null, firstInteger(row, 'distraction_limit_minutes', 'distractionLimitMinutes') ?? null, firstText(row, 'focus_categories_json', 'focus_categories') ?? null, firstText(row, 'distraction_categories_json', 'distraction_categories') ?? null, payload, deleted, ids.id);
      else {
        db.prepare('INSERT INTO goals (id, source_id, source_key, day, focus_minutes, distraction_limit_minutes, focus_categories_json, distraction_categories_json, payload_json, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(ids.id, sourceId, sourceKey, day ?? null, firstInteger(row, 'focus_minutes', 'focusMinutes') ?? null, firstInteger(row, 'distraction_limit_minutes', 'distractionLimitMinutes') ?? null, firstText(row, 'focus_categories_json', 'focus_categories') ?? null, firstText(row, 'distraction_categories_json', 'distraction_categories') ?? null, payload, deleted);
        rememberSource(db, sourceId, entityType, sourceKey, ids.id, payload);
      }
    } else if (table === 'goal_categories') {
      const goalKey = firstKey(row, 'goal_id', 'day_goal_id', 'day', 'date');
      const goalId = goalKey === undefined ? undefined : existingLocalId(db, 'goals', sourceId, goalKey) ?? existingLocalId(db, 'day_goals', sourceId, goalKey);
      if (existing !== undefined) db.prepare('UPDATE goal_categories SET goal_id = ?, category_name = ?, role = ?, payload_json = ? WHERE id = ?').run(goalId ?? null, firstText(row, 'category_name', 'category') ?? null, firstText(row, 'role', 'kind') ?? null, payload, ids.id);
      else {
        db.prepare('INSERT INTO goal_categories (id, source_id, source_key, goal_id, category_name, role, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ids.id, sourceId, sourceKey, goalId ?? null, firstText(row, 'category_name', 'category') ?? null, firstText(row, 'role', 'kind') ?? null, payload);
        rememberSource(db, sourceId, entityType, sourceKey, ids.id, payload);
      }
    } else if (table === 'journal_entries') {
      const day = dayKeyFromRow(row);
      if (existing !== undefined) db.prepare('UPDATE journal_entries SET day = ?, kind = ?, title = ?, body = ?, status = ?, payload_json = ?, is_deleted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(day ?? null, firstText(row, 'kind', 'type') ?? null, firstText(row, 'title') ?? null, firstText(row, 'body', 'text', 'content') ?? null, firstText(row, 'status') ?? null, payload, deleted, ids.id);
      else {
        db.prepare('INSERT INTO journal_entries (id, source_id, source_key, day, kind, title, body, status, payload_json, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(ids.id, sourceId, sourceKey, day ?? null, firstText(row, 'kind', 'type') ?? null, firstText(row, 'title') ?? null, firstText(row, 'body', 'text', 'content') ?? null, firstText(row, 'status') ?? null, payload, deleted);
        rememberSource(db, sourceId, entityType, sourceKey, ids.id, payload);
      }
    } else {
      const activityKey = firstKey(row, 'timeline_card_id', 'activity_id', 'card_id');
      const activityId = activityKey === undefined ? undefined : activityIds.get(activityKey);
      const start = firstNumber(row, 'start_ts', 'start');
      const end = firstNumber(row, 'end_ts', 'end');
      if (existing !== undefined) db.prepare('UPDATE reviews SET activity_id = ?, start_ts = ?, end_ts = ?, rating = ?, payload_json = ?, is_deleted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(activityId ?? null, start ?? null, end ?? null, firstText(row, 'rating', 'review') ?? null, payload, deleted, ids.id);
      else {
        db.prepare('INSERT INTO reviews (id, source_id, source_key, activity_id, start_ts, end_ts, rating, payload_json, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(ids.id, sourceId, sourceKey, activityId ?? null, start ?? null, end ?? null, firstText(row, 'rating', 'review') ?? null, payload, deleted);
        rememberSource(db, sourceId, entityType, sourceKey, ids.id, payload);
      }
    }
    if (existing === undefined) setCount(imported, entityType);
    else {
      setCount(updated, entityType);
      rememberSource(db, sourceId, entityType, sourceKey, ids.id, payload);
    }
  }
}

function createCompatibilityViews(db: DatabaseSync): void {
  db.exec(`
    DROP VIEW IF EXISTS timeline_cards;
    CREATE VIEW timeline_cards AS
      SELECT id, batch_id, start, end, start_ts, end_ts, day, title, summary, category, subcategory,
             detailed_summary, metadata, video_summary_url, created_at, is_deleted
        FROM activities;
  `);
}

function readSchemaVersion(db: DatabaseSync): number {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").all() as Row[];
  if (rows.length === 0) return 0;
  const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as Row[];
  if (versions.length > 1) {
    throw new DayflowError('Journal schema_version is malformed: expected exactly one version row.', 'database_error');
  }
  if (versions.length === 0) return 0;
  const version = asInteger(versions[0]?.version);
  if (version === undefined || version < 0) {
    throw new DayflowError('Journal schema_version is malformed: expected a non-negative integer.', 'database_error');
  }
  return version;
}

/**
 * Apply all pending migrations to an owned journal database.
 *
 * A database newer than this package is rejected instead of being silently
 * downgraded or overwritten.
 */
export function migrateJournal(db: DatabaseSync): number {
  const current = readSchemaVersion(db);
  if (current > JOURNAL_SCHEMA_VERSION) {
    throw new DayflowError(
      `Journal schema ${current} is newer than this plugin supports (maximum ${JOURNAL_SCHEMA_VERSION}).`,
      'database_error',
    );
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL PRIMARY KEY, applied_at TEXT NOT NULL)');
    const afterCreate = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as Row[];
    if (afterCreate.length > 1) {
      throw new DayflowError('Journal schema_version is malformed: expected exactly one version row.', 'database_error');
    }
    if (afterCreate.length === 0) db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (0, CURRENT_TIMESTAMP)').run();

    let version = afterCreate.length === 0 ? 0 : asInteger(afterCreate[0]?.version) ?? 0;
    if (version > JOURNAL_SCHEMA_VERSION) {
      throw new DayflowError(
        `Journal schema ${version} is newer than this plugin supports (maximum ${JOURNAL_SCHEMA_VERSION}).`,
        'database_error',
      );
    }
    if (version < 1) {
      db.exec(MIGRATION_1);
      createCompatibilityViews(db);
      db.prepare('UPDATE schema_version SET version = ?, applied_at = CURRENT_TIMESTAMP').run(1);
      version = 1;
    } else {
      createCompatibilityViews(db);
    }
    if (version < 2) {
      if (!tableHasColumn(db, 'activities', 'payload_json')) {
        db.exec('ALTER TABLE activities ADD COLUMN payload_json TEXT');
      }
      db.prepare('UPDATE schema_version SET version = ?, applied_at = CURRENT_TIMESTAMP').run(2);
      version = 2;
    }
    db.exec('COMMIT');
    return version;
  } catch (cause) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the migration error when rollback itself cannot run.
    }
    if (cause instanceof DayflowError) throw cause;
    throw new DayflowError(`Could not migrate the journal database: ${cause instanceof Error ? cause.message : String(cause)}`, 'database_error', { cause });
  }
}

/** Open (and migrate) the plugin-owned journal at the default path. */
export function openJournal(path = defaultJournalPath()): DatabaseSync {
  const db = openJournalDatabase(path);
  try {
    migrateJournal(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Whether an existing journal can be opened without a schema write. */
function journalReady(path: string): boolean {
  if (!existsSync(path)) return false;
  const db = openDatabase(path);
  try {
    if (readSchemaVersion(db) !== JOURNAL_SCHEMA_VERSION) return false;
    if (!tableHasColumn(db, 'activities', 'payload_json')) return false;
    const view = db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'view' AND name = 'timeline_cards'")
      .get() as Row | undefined;
    return view?.present === 1;
  } finally {
    db.close();
  }
}

/** Run a callback with an opened, migrated journal and close it afterwards. */
export function withJournal<T>(read: (db: DatabaseSync) => T, path?: string): T;
/** Run a callback with an opened, migrated journal and close it afterwards. */
export function withJournal<T>(path: string, read: (db: DatabaseSync) => T): T;
export function withJournal<T>(pathOrRead: string | ((db: DatabaseSync) => T), maybeRead?: ((db: DatabaseSync) => T) | string): T {
  const path = typeof pathOrRead === 'string' ? pathOrRead : typeof maybeRead === 'string' ? maybeRead : defaultJournalPath();
  const read = typeof pathOrRead === 'function' ? pathOrRead : maybeRead;
  if (typeof read !== 'function') throw new TypeError('withJournal requires a callback');
  // Only the first read (or a pending migration) takes the schema write lock.
  // Stable journals stay read-only, so concurrent tools and panel requests do
  // not rewrite their views or contend on BEGIN IMMEDIATE.
  if (!journalReady(path)) {
    const migrated = openJournal(path);
    migrated.close();
  }
  const db = openDatabase(path);
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** Compatibility name for backend code selecting the owned journal. */
export const withJournalDatabase = withJournal;

/**
 * Select the active backend while preserving the existing query callback shape.
 * Dayflow remains read-only; the owned store is migrated before it is reopened
 * read-only for the query, so callers cannot accidentally mutate either store.
 */
export function withRuntimeDatabase<T>(config: Pick<ResolvedConfig, 'source' | 'databasePath' | 'journalPath'>, read: (db: DatabaseSync) => T): T {
  if (config.source === 'owned') {
    if (sameFile(config.databasePath, config.journalPath)) {
      throw new DayflowError('The owned journal must be a different file from the Dayflow database.', 'invalid_input');
    }
    return withJournal(read, config.journalPath);
  }
  return withDatabase(config.databasePath, read);
}

export function sameFile(left: string, right: string): boolean {
  if (left === right) return true;
  try {
    const leftStat = statSync(left);
    const rightStat = statSync(right);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch {
    return false;
  }
}

function normalizeOptions(sourceOrOptions: string | DayflowImportOptions, journalPath?: string, sourceId?: string): DayflowImportOptions {
  if (typeof sourceOrOptions === 'string') return { sourcePath: sourceOrOptions, journalPath, sourceId };
  return sourceOrOptions;
}

/**
 * Import Dayflow's database into the owned store.
 *
 * The source is opened through the read-only path and is never modified. Every
 * imported row is keyed by `(source_id, entity_type, source_key)` in `sources`,
 * making a second import an update/unchanged pass rather than a duplicate.
 */
export function importDayflow(options: DayflowImportOptions): DayflowImportReport;
/** Convenience overload for callers that already have source and destination paths. */
export function importDayflow(sourcePath: string, journalPath?: string, sourceId?: string): DayflowImportReport;
export function importDayflow(sourceOrOptions: string | DayflowImportOptions, journalPath?: string, sourceId?: string): DayflowImportReport {
  const options = normalizeOptions(sourceOrOptions, journalPath, sourceId);
  const sourcePath = options.sourcePath.trim();
  if (sourcePath === '') throw new DayflowError('A Dayflow database path is required for import.', 'invalid_input');
  const targetPath = options.journalPath?.trim() || defaultJournalPath();
  const absoluteSource = canonicalJournalPath(sourcePath);
  const absoluteTarget = canonicalJournalPath(targetPath);
  if (sameFile(absoluteSource, absoluteTarget)) {
    throw new DayflowError('The Dayflow source and owned journal must be different files.', 'invalid_input');
  }
  // Keep the legacy default so re-importing a 0.5.x journal remains idempotent.
  // Use the tool's source_id option when a journal intentionally contains more
  // than one Dayflow database.
  const sourceIdValue = options.sourceId?.trim() || DAYFLOW_SOURCE_ID;

  const source = openDatabase(sourcePath);
  let target: DatabaseSync | undefined;
  const imported: MutableCounts = {};
  const updated: MutableCounts = {};
  const unchanged: MutableCounts = {};
  const skipped: JournalImportSkip[] = [];
  const warnings: string[] = [];
  const skip = (table: string, reason: string): void => {
    skipped.push({ table, reason });
  };
  try {
    // Pin one consistent read snapshot while the app may still be writing its WAL.
    source.exec('BEGIN');
    const sourceTables = new Set(sourceTableNames(source));
    const requiredTables = ['timeline_cards', 'analysis_batches', 'screenshots', 'daily_standup_entries'];
    if (requiredTables.some((table) => !sourceTables.has(table))) {
      throw new DayflowError(
        `The source at ${sourcePath} is missing a required Dayflow table (${requiredTables.join(', ')}).`,
        'database_error',
      );
    }
    for (const table of sourceTables) {
      if (SUPPORTED_SOURCE_TABLES.has(table)) continue;
      const reason = SENSITIVE_SOURCE_TABLES.has(table)
        ? 'contains provider credentials, model calls, or private chat history; intentionally not imported'
        : 'source table is not represented by the 0.6.0 owned schema';
      skip(table, reason);
      warnings.push(`Skipped source table ${table}: ${reason}.`);
    }
  } catch (error) {
    try {
      source.exec('ROLLBACK');
    } catch {
      // Best effort cleanup before surfacing the source validation error.
    }
    source.close();
    if (error instanceof DayflowError) throw error;
    throw new DayflowError(
      `Could not inspect the Dayflow source: ${error instanceof Error ? error.message : String(error)}`,
      'database_error',
      { cause: error },
    );
  }
  try {
    target = openJournal(targetPath);
    target.exec('BEGIN IMMEDIATE');
    try {
      const batchIds = new Map<string, number>();
      const batchRows = readTable(source, 'analysis_batches') ?? [];
      const batchOccurrences = new Map<string, number>();
      for (const row of batchRows) {
        const sourceKey = stableRowKey(row, batchOccurrences, 'id', 'batch_id');
        const payload = rowJson(row);
        const existing = existingSource(target, 'analysis_batches', sourceIdValue, sourceKey);
        if (existing?.fingerprint === payload) {
          batchIds.set(sourceKey, existing.localId);
          setCount(unchanged, 'analysis_batches');
          continue;
        }
        const result = upsertBatch(target, row, sourceIdValue, sourceKey);
        if (result === undefined) {
          skip('analysis_batches', `row ${sourceKey}: no usable identifier`);
          warnings.push(`Skipped analysis_batches row ${sourceKey}: no usable identifier.`);
        } else {
          batchIds.set(sourceKey, result.id);
          if (existing === undefined) setCount(imported, 'analysis_batches');
          else {
            setCount(updated, 'analysis_batches');
            rememberSource(target, sourceIdValue, 'analysis_batches', sourceKey, result.id, payload);
          }
        }
      }

      const activityIds = new Map<string, number>();
      const activityRows = readTable(source, 'timeline_cards') ?? [];
      const activityOccurrences = new Map<string, number>();
      for (const row of activityRows) {
        const sourceKey = stableRowKey(row, activityOccurrences, 'id', 'record_id');
        const payload = rowJson(row);
        const existing = existingSource(target, 'activities', sourceIdValue, sourceKey);
        if (existing?.fingerprint === payload) {
          activityIds.set(sourceKey, existing.localId);
          setCount(unchanged, 'timeline_cards');
          continue;
        }
        const result = upsertActivity(target, row, sourceIdValue, sourceKey, batchIds);
        if (result === undefined) {
          skip('timeline_cards', `row ${sourceKey}: missing start/end timestamp`);
          warnings.push(`Skipped timeline_cards row ${sourceKey}: missing start/end timestamp.`);
        } else {
          activityIds.set(sourceKey, result.id);
          if (existing === undefined) setCount(imported, 'timeline_cards');
          else {
            setCount(updated, 'timeline_cards');
            rememberSource(target, sourceIdValue, 'activities', sourceKey, result.id, payload);
          }
        }
      }

      const screenshotRows = readTable(source, 'screenshots') ?? [];
      const screenshotOccurrences = new Map<string, number>();
      for (const row of screenshotRows) {
        const sourceKey = stableRowKey(row, screenshotOccurrences, 'id');
        const payload = rowJson(row);
        const existing = existingSource(target, 'screenshots', sourceIdValue, sourceKey);
        if (existing?.fingerprint === payload) {
          setCount(unchanged, 'screenshots');
          continue;
        }
        const result = upsertScreenshot(target, row, sourceIdValue, sourceKey);
        if (result === undefined) {
          skip('screenshots', `row ${sourceKey}: missing capture timestamp`);
          warnings.push(`Skipped screenshots row ${sourceKey}: missing capture timestamp.`);
        } else if (existing === undefined) setCount(imported, 'screenshots');
        else {
          setCount(updated, 'screenshots');
          rememberSource(target, sourceIdValue, 'screenshots', sourceKey, result.id, payload);
        }
      }

      const standupRows = readTable(source, 'daily_standup_entries') ?? [];
      const standupOccurrences = new Map<string, number>();
      for (const row of standupRows) {
        const sourceKey = stableRowKey(row, standupOccurrences, 'id', 'standup_day');
        const payload = firstText(row, 'payload_json', 'payload') ?? rowJson(row);
        const existing = existingSource(target, 'daily_standup_entries', sourceIdValue, sourceKey);
        if (existing?.fingerprint === payload) {
          setCount(unchanged, 'daily_standup_entries');
          continue;
        }
        if (!upsertStandup(target, row, sourceIdValue, sourceKey)) {
          skip('daily_standup_entries', `row ${sourceKey}: missing standup day`);
          warnings.push(`Skipped daily_standup_entries row ${sourceKey}: missing standup day.`);
        } else if (existing === undefined) setCount(imported, 'daily_standup_entries');
        else {
          setCount(updated, 'daily_standup_entries');
          rememberSource(target, sourceIdValue, 'daily_standup_entries', sourceKey, existing.localId, payload);
        }
      }

      const generic = [
        ['observations', 'observations'],
        ['day_goals', 'goals'],
        ['day_goal_categories', 'goal_categories'],
        ['journal_entries', 'journal_entries'],
        ['timeline_review_ratings', 'reviews'],
      ] as const;
      for (const [sourceTable, targetTable] of generic) {
        const rows = readTable(source, sourceTable);
        if (rows === undefined) continue;
        importGenericRows(target, targetTable, sourceTable, rows, sourceIdValue, activityIds, imported, updated, unchanged, skipped);
      }

      const sourceCategories = readTable(source, 'categories');
      let sourceCategoryUsable = 0;
      const categoryOccurrences = new Map<string, number>();
      for (const [index, row] of (sourceCategories ?? []).entries()) {
        const name = firstText(row, 'name', 'category');
        if (name === undefined) {
          skip('categories', `row ${index}: missing category name`);
          continue;
        }
        sourceCategoryUsable += 1;
        const categoryKey = firstKey(row, 'id') ?? stableRowKey(row, categoryOccurrences, 'name', 'category');
        const category = {
          name,
          colorHex: firstText(row, 'color_hex', 'colorHex', 'color') ?? '#A0AEC0',
          isSystem: boolValue(row.is_system ?? row.isSystem) === 1,
          isIdle: boolValue(row.is_idle ?? row.isIdle) === 1,
          description: firstText(row, 'description'),
        } satisfies JournalCategoryInput;
        const payload = jsonText(category);
        const existing = existingSource(target, 'categories', sourceIdValue, categoryKey);
        if (existing?.fingerprint === payload) {
          setCount(unchanged, 'categories');
          continue;
        }
        upsertCategory(target, category, sourceIdValue, categoryKey);
        if (existing === undefined) setCount(imported, 'categories');
        else {
          setCount(updated, 'categories');
          rememberSource(target, sourceIdValue, 'categories', categoryKey, existing.localId, payload);
        }
      }
      if (sourceCategories === undefined || sourceCategoryUsable === 0) {
        for (const [index, category] of (options.categories ?? []).entries()) {
          const key = category.name.trim();
          if (key === '') {
            skip('categories', `option ${index}: missing category name`);
            continue;
          }
          const payload = jsonText(category);
          const existing = existingSource(target, 'categories', sourceIdValue, key);
          if (existing?.fingerprint === payload) {
            setCount(unchanged, 'categories');
            continue;
          }
          upsertCategory(target, category, sourceIdValue, key || String(index));
          if (existing === undefined) setCount(imported, 'categories');
          else {
            setCount(updated, 'categories');
            rememberSource(target, sourceIdValue, 'categories', key, existing.localId, payload);
          }
        }
      }

      target.exec('COMMIT');
    } catch (cause) {
      try {
        target.exec('ROLLBACK');
      } catch {
        // Preserve the import error.
      }
      if (cause instanceof DayflowError) throw cause;
      throw new DayflowError(`Could not import the Dayflow database: ${cause instanceof Error ? cause.message : String(cause)}`, 'database_error', { cause });
    }
  } catch (cause) {
    if (cause instanceof DayflowError) throw cause;
    throw new DayflowError(`Could not import the Dayflow database: ${cause instanceof Error ? cause.message : String(cause)}`, 'database_error', { cause });
  } finally {
    try {
      source.exec('ROLLBACK');
    } catch {
      // The read-only snapshot may already have been closed by SQLite.
    }
    target?.close();
    source.close();
  }

  return {
    sourceId: sourceIdValue,
    source_path: sourcePath,
    journal_path: targetPath,
    sourcePath,
    journalPath: targetPath,
    imported,
    updated,
    unchanged,
    skipped,
    warnings,
  };
}

/** Alias used by callers that prefer an explicit database name. */
export const importDayflowDatabase = importDayflow;
/** Alias used by adapters that describe the destination first. */
export const importDayflowIntoJournal = importDayflow;

/** Categories persisted in the owned journal. */
export interface JournalCategory {
  readonly name: string;
  readonly colorHex: string;
  readonly isSystem: boolean;
  readonly isIdle: boolean;
}

/** Read imported category colors without consulting Dayflow's preferences. */
export function journalCategories(path: string, sourcePath?: string): JournalCategory[] {
  if (sourcePath !== undefined && sameFile(path, sourcePath)) {
    throw new DayflowError('The owned journal must be a different file from the Dayflow database.', 'invalid_input');
  }
  return withJournal(path, (db) => {
    const rows = db.prepare('SELECT name, color_hex, is_system, is_idle FROM categories ORDER BY id').all() as Row[];
    return rows
      .map((row) => {
        const name = firstText(row, 'name');
        if (name === undefined) return undefined;
        return {
          name,
          colorHex: firstText(row, 'color_hex') ?? '#A0AEC0',
          isSystem: boolValue(row.is_system) === 1,
          isIdle: boolValue(row.is_idle) === 1,
        } satisfies JournalCategory;
      })
      .filter((category): category is JournalCategory => category !== undefined);
  });
}

/** Return the default owned-journal path without opening it. */
export function journalPath(): string {
  return defaultJournalPath();
}

// Keep the import-time dependency explicit for older Node builds that otherwise
// tree-shake the realpath helper differently. The path comparison above is
// lexical by design; this helper is exported for callers that need canonical
// comparisons when both files already exist.
export function canonicalJournalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    try {
      return join(realpathSync(dirname(path)), basename(path));
    } catch {
      return resolvePath(path);
    }
  }
}
