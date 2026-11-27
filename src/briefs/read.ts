/**
 * The reading view of the briefs a journal stores.
 *
 * Two writers produce readable summaries today: the weekly close stores one row
 * in `briefs` (`kind = 'week'`), and the daily close stores a native standup in
 * `daily_standup_entries` (`source_id = 'native'`). An imported journal can also
 * carry `briefs` day rows, so both kinds are read. The panel's Insights payload
 * exposes them through one list, so this module normalises the two stores into
 * the same {@link PanelBriefSummary} shape:
 *
 * - a `briefs` row maps field for field, and its `payload_json.memory_health`
 *   block (the weekly lint digest) is passed through when it is well formed;
 * - a native standup maps to a `day` entry: title `Standup · <day>`, body
 *   rendered as plain `- ` lines from its highlights, tasks, and blockers, and
 *   `period_key` taken from `standup_day`.
 *
 * A `(kind, period_key)` pair appears once: the `briefs` row wins over a native
 * standup for the same day, because the row is the more complete record. The
 * list sorts by `period_key` descending (ties by `updated_at` descending) and is
 * capped at {@link PANEL_BRIEF_DEFAULT_LIMIT} entries by default, so a long-lived
 * journal cannot grow the payload without bound.
 *
 * This module is pure reading: it never calls a model, never writes a row, and
 * never creates the journal. A missing or unreadable journal answers `[]`, the
 * same tolerance the rest of the Insights payload has, so a fresh install shows
 * an empty briefs section instead of an error.
 * @module dsh-plugin-dayflow/briefs/read
 */

import { existsSync } from 'node:fs';

import type { DatabaseSync } from 'node:sqlite';

import { AUTOMATION_MAX_LIST_LIMIT, listBriefs } from '../automation/store.js';
import type { BriefRecord } from '../automation/store.js';
import { DayflowError } from '../errors.js';
import { withJournal } from '../journal.js';

/** The memory-health digest a weekly lint pass records beside a week brief. */
export interface PanelBriefMemoryHealth {
  /** How many lint findings the week's scan produced across every finding group. */
  findings: number;
  /** How many review proposals the pass recorded for those findings. */
  proposals: number;
  /** The one-line summary rendered after `Memory health:` in the brief body. */
  summary: string;
}

/** One stored brief, as the Insights view renders it. */
export interface PanelBriefSummary {
  /** Whether this entry describes one day or one Monday-anchored week. */
  kind: 'day' | 'week';
  /** The day key, or the Monday of the week. */
  period_key: string;
  title: string;
  body: string;
  /** The model id the provider reported, when the writer recorded one. */
  model?: string;
  /** The row's `updated_at`, or a standup's `created_at` when that is all it has. */
  updated_at: string;
  /** The weekly memory-lint digest, when the brief carries one. */
  memory_health?: PanelBriefMemoryHealth;
}

/** Read limit when the caller states none. */
export const PANEL_BRIEF_DEFAULT_LIMIT = 10;

/** Upper bound for one panel briefs read. */
export const PANEL_BRIEF_MAX_LIMIT = 20;

/**
 * The `source_id` native standup rows carry.
 *
 * It matches `DAILY_BRIEF_SOURCE_ID` in the daily brief writer, kept local so
 * this read module does not depend on the write path.
 */
const NATIVE_STANDUP_SOURCE_ID = 'native';

/** One raw `daily_standup_entries` row, keyed by column name. */
type Row = Record<string, unknown>;

/** Options for {@link readPanelBriefs}: the read limit only. */
export interface ReadPanelBriefsOptions {
  /** How many entries to return; defaults to {@link PANEL_BRIEF_DEFAULT_LIMIT}. */
  limit?: number;
}

/** Options for {@link listPanelBriefs}: the read limit, and an accepted clock. */
export interface ListPanelBriefsOptions {
  /** How many entries to return; defaults to {@link PANEL_BRIEF_DEFAULT_LIMIT} and must be 1-20. */
  limit?: number;
  /**
   * Accepted for symmetry with the write paths. This read is clock-free: the
   * order comes from the stored period keys, so a pinned clock changes nothing.
   */
  now?: () => Date;
}

/** A required read limit: an absent one is the default, an unusable one is a caller error. */
function resolveLimit(value: unknown): number {
  if (value === undefined || value === null) return PANEL_BRIEF_DEFAULT_LIMIT;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > PANEL_BRIEF_MAX_LIMIT
  ) {
    throw new DayflowError(
      `A briefs limit must be an integer between 1 and ${String(PANEL_BRIEF_MAX_LIMIT)}.`,
      'invalid_input',
    );
  }
  return value;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asInteger(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  return undefined;
}

/** Parse one JSON column, degrading to `undefined` on corrupt or non-object JSON. */
function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const raw = asText(value);
  if (raw === undefined || raw.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** The memory-health digest out of a brief's decoded payload, when it is well formed. */
function memoryHealthFromPayload(payload: unknown): PanelBriefMemoryHealth | undefined {
  const record = parseJsonRecord(payload);
  if (record === undefined) return undefined;
  const block = parseJsonRecord(record.memory_health);
  if (block === undefined) return undefined;
  const findings = asInteger(block.findings);
  const proposals = asInteger(block.proposals);
  const summary = asText(block.summary);
  if (findings === undefined || proposals === undefined || summary === undefined) return undefined;
  return { findings, proposals, summary };
}

/** Project one `briefs` row into the summary the Insights view reads. */
function briefSummary(brief: BriefRecord): PanelBriefSummary {
  const summary: PanelBriefSummary = {
    kind: brief.kind,
    period_key: brief.period_key,
    title: brief.title,
    body: brief.body,
    updated_at: brief.updated_at,
  };
  if (brief.model !== undefined) summary.model = brief.model;
  const memoryHealth = memoryHealthFromPayload(brief.payload);
  if (memoryHealth !== undefined) summary.memory_health = memoryHealth;
  return summary;
}

/** One text entry of a standup's highlights/tasks list, in either stored shape. */
function standupItemText(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof entry === 'object' && entry !== null) {
    const text = asText((entry as { text?: unknown }).text);
    const trimmed = text?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
  }
  return undefined;
}

/** Render one standup's highlights, tasks, and blockers as plain `- ` lines. */
function standupBodyLines(payload: Record<string, unknown> | undefined): string[] {
  if (payload === undefined) return [];
  const lines: string[] = [];
  for (const section of ['highlights', 'tasks'] as const) {
    const list = payload[section];
    if (!Array.isArray(list)) continue;
    for (const entry of list as unknown[]) {
      const text = standupItemText(entry);
      if (text !== undefined) lines.push(`- ${text}`);
    }
  }
  const blockers = asText(payload.blockersBody)?.trim();
  if (blockers !== undefined && blockers !== '') {
    for (const line of blockers.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed !== '') lines.push(`- ${trimmed}`);
    }
  }
  return lines;
}

/**
 * Project one native standup row into a day entry.
 *
 * The Dayflow shape (highlights / tasks / blockers) is decoded leniently: a
 * corrupt or empty payload does not fail the read, it just leaves the body as
 * the title line. Our own daily close stores a plain `body` field instead, so
 * that text is used when the section shape has nothing to render.
 */
function standupSummary(row: Row): PanelBriefSummary | undefined {
  const day = asText(row.standup_day)?.trim();
  if (day === undefined || day === '') return undefined;
  const title = `Standup · ${day}`;
  const payload = parseJsonRecord(row.payload_json);
  const lines = standupBodyLines(payload);
  const storedBody = asText(payload?.body)?.trim();
  const body = lines.length > 0 ? lines.join('\n') : storedBody !== undefined && storedBody !== '' ? storedBody : title;
  const updatedAt = asText(row.updated_at) ?? asText(row.created_at) ?? '';
  return { kind: 'day', period_key: day, title, body, updated_at: updatedAt };
}

/** Read at most `limit` live native standups, most recent standup day first. */
function readNativeStandups(db: DatabaseSync, limit: number): PanelBriefSummary[] {
  const rows = db
    .prepare(
      `SELECT standup_day, payload_json, created_at, updated_at
         FROM daily_standup_entries
        WHERE source_id = ? AND COALESCE(is_deleted, 0) = 0
        ORDER BY standup_day DESC, updated_at DESC, id DESC
        LIMIT ?`,
    )
    .all(NATIVE_STANDUP_SOURCE_ID, limit) as Row[];
  const summaries: PanelBriefSummary[] = [];
  for (const row of rows) {
    const summary = standupSummary(row);
    if (summary !== undefined) summaries.push(summary);
  }
  return summaries;
}

/** The dedupe/sort key of one entry: its kind and period. */
function entryKey(entry: PanelBriefSummary): string {
  return `${entry.kind}\u0000${entry.period_key}`;
}

/**
 * Read the panel's briefs list from an open journal connection.
 *
 * Both `briefs` kinds are read through the existing store, then the live native
 * standups; the `(kind, period_key)` pairs the rows already cover win, and the
 * merged list is sorted by `period_key` descending (ties by `updated_at`
 * descending) and capped at `limit`.
 *
 * @param db - an open owned-journal connection.
 * @param options - the read limit; defaults to {@link PANEL_BRIEF_DEFAULT_LIMIT}.
 * @returns the merged, de-duplicated, sorted entries.
 * @throws {@link DayflowError} `invalid_input` for a limit outside 1-20.
 */
export function readPanelBriefs(db: DatabaseSync, options: ReadPanelBriefsOptions = {}): PanelBriefSummary[] {
  const limit = resolveLimit(options?.limit);

  const fromStore = listBriefs(db, { limit: AUTOMATION_MAX_LIST_LIMIT }).map(briefSummary);
  const merged: PanelBriefSummary[] = [];
  const seen = new Set<string>();
  for (const entry of fromStore) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  // A standup is the fallback for a day without a brief row; the store row is
  // the more complete record and is always preferred.
  for (const entry of readNativeStandups(db, PANEL_BRIEF_MAX_LIMIT)) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  merged.sort(
    (left, right) =>
      right.period_key.localeCompare(left.period_key) || right.updated_at.localeCompare(left.updated_at),
  );
  return merged.slice(0, limit);
}

/**
 * Read the panel's briefs list from the owned journal at `journalPath`.
 *
 * A missing or unreadable journal answers `[]` and is left untouched: a read
 * never creates or rewrites the file. The read runs on one short connection and
 * never calls a model.
 *
 * @param journalPath - the owned journal path.
 * @param options - the read limit; defaults to {@link PANEL_BRIEF_DEFAULT_LIMIT}.
 * @returns the merged, de-duplicated, sorted entries, or `[]` for no journal.
 * @throws {@link DayflowError} `invalid_input` for a limit outside 1-20.
 */
export async function listPanelBriefs(
  journalPath: string,
  options: ListPanelBriefsOptions = {},
): Promise<PanelBriefSummary[]> {
  const limit = resolveLimit(options?.limit);
  if (typeof journalPath !== 'string' || journalPath.trim() === '' || !existsSync(journalPath)) return [];
  try {
    return withJournal(journalPath, (db) => readPanelBriefs(db, { limit }));
  } catch {
    // The file exists but this build cannot read it: like the rest of the
    // Insights payload's no-journal path, the answer is an empty list.
    return [];
  }
}
