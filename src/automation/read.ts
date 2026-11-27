/**
 * The reading view of the automation ledger: the recent closes the Insights
 * view shows.
 *
 * The scheduler records one `automation_runs` row per scheduled job (`day_close`,
 * `week_close`, and the weekly memory `lint`) in {@link ../automation/store.js},
 * so the ledger already holds the history a user needs to answer "did the close
 * run, and why did it fail?". This module projects the most recent rows into the
 * small {@link PanelCloseSummary} the Insights payload carries. It adds no store
 * of its own and no new query: the store's `listAutomationRuns` already answers
 * `updated_at` descending (ties by descending id), which is the order the panel
 * renders, and its row validation is reused unchanged.
 *
 * Two deliberate limits keep the payload bounded and honest:
 *
 * - at most {@link PANEL_CLOSE_DEFAULT_LIMIT} closes by default, never more than
 *   {@link PANEL_CLOSE_MAX_LIMIT}, so a long-lived journal cannot grow the
 *   payload without bound;
 * - a summary carries no `id`, no `created_at`, and no `payload` — the raw SQLite
 *   row and the job's JSON result stay out of the wire shape. A payload that is
 *   present but unusual therefore cannot change the summary; the shared store's
 *   strictness about a *corrupt* payload still applies (a malformed run row is a
 *   `database_error`, see below).
 *
 * The read is pure: it never calls a model, never writes a row, and never
 * creates the journal. A missing or unreadable journal answers `[]`, the same
 * tolerance the rest of the Insights payload has.
 *
 * A hand-edited journal can hold a value no reader understands (`status =
 * 'bogus'`, an unknown `job`, an invalid `day`, a corrupt `payload_json`, ...).
 * Following the store's own rule — a malformed run is a database error, not a
 * silently missing row — this read lets that `database_error` surface instead of
 * skipping the row: the panel route then answers a JSON error rather than
 * pretending the ledger is empty or shorter than it is. Only the "cannot open
 * this file at all" case degrades to `[]`.
 * @module dsh-plugin-dayflow/automation/read
 */

import { existsSync } from 'node:fs';

import type { DatabaseSync } from 'node:sqlite';

import { DayflowError } from '../errors.js';
import { withJournal } from '../journal.js';
import { AUTOMATION_MAX_ERROR_CHARS, listAutomationRuns } from './store.js';
import type { AutomationJob, AutomationRun, AutomationRunStatus } from './store.js';

/** One recent close, as the Insights view renders it. */
export interface PanelCloseSummary {
  /** The scheduled job this run belongs to. */
  job: AutomationJob;
  /** The Dayflow day the run works on; for `week_close`, the Monday of the week. */
  day: string;
  status: AutomationRunStatus;
  /** How many times the run has been started; the ledger's retry gate. */
  attempts: number;
  /** The failure message or skip reason; absent when the row records none. */
  error?: string;
  /** The row's `updated_at`; the list is ordered by this, descending. */
  updated_at: string;
}

/** Read limit when the caller states none. */
export const PANEL_CLOSE_DEFAULT_LIMIT = 10;

/** Upper bound for one panel closes read. */
export const PANEL_CLOSE_MAX_LIMIT = 20;

/** Options for {@link readPanelCloses}: the read limit only. */
export interface ReadPanelClosesOptions {
  /** How many closes to return; defaults to {@link PANEL_CLOSE_DEFAULT_LIMIT} and must be 1-20. */
  limit?: number;
}

/** Options for {@link listPanelCloses}: the read limit only. */
export interface ListPanelClosesOptions {
  /** How many closes to return; defaults to {@link PANEL_CLOSE_DEFAULT_LIMIT} and must be 1-20. */
  limit?: number;
}

/** A required read limit: an absent one is the default, an unusable one is a caller error. */
function resolveLimit(value: unknown): number {
  if (value === undefined || value === null) return PANEL_CLOSE_DEFAULT_LIMIT;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > PANEL_CLOSE_MAX_LIMIT
  ) {
    throw new DayflowError(
      `A closes limit must be an integer between 1 and ${String(PANEL_CLOSE_MAX_LIMIT)}.`,
      'invalid_input',
    );
  }
  return value;
}

/** Truncate one stored failure message or skip reason to the store's maximum. */
function clampError(value: string): string {
  return value.length > AUTOMATION_MAX_ERROR_CHARS ? value.slice(0, AUTOMATION_MAX_ERROR_CHARS) : value;
}

/**
 * Project one ledger row into the summary the Insights view reads.
 *
 * The store trims a blank error to absent and clamps it on write, but a
 * hand-edited journal can hold a longer message, so it is clamped again here:
 * the panel renders one bounded line, never a whole stored log.
 */
function closeSummary(run: AutomationRun): PanelCloseSummary {
  const summary: PanelCloseSummary = {
    job: run.job,
    day: run.day,
    status: run.status,
    attempts: run.attempts,
    updated_at: run.updated_at,
  };
  if (run.error !== undefined) summary.error = clampError(run.error);
  return summary;
}

/**
 * Read the panel's recent closes from an open journal connection.
 *
 * @param db - an open owned-journal connection.
 * @param options - the read limit; defaults to {@link PANEL_CLOSE_DEFAULT_LIMIT}.
 * @returns the recent closes, newest (`updated_at` descending, ties by
 *   descending id) first, with no id, payload, or `created_at`.
 * @throws {@link DayflowError} `invalid_input` for a limit outside 1-20;
 *   `database_error` for a ledger row no reader understands.
 */
export function readPanelCloses(
  db: DatabaseSync,
  options: ReadPanelClosesOptions = {},
): PanelCloseSummary[] {
  const limit = resolveLimit(options?.limit);
  return listAutomationRuns(db, { limit }).map(closeSummary);
}

/**
 * Read the panel's recent closes from the owned journal at `journalPath`.
 *
 * A missing or unreadable journal answers `[]` and is left untouched: a read
 * never creates or rewrites the file. The read runs on one short connection and
 * never calls a model.
 *
 * A journal whose ledger holds a malformed row is different from a missing one:
 * the store answers `database_error`, and that error is passed up rather than
 * reported as an empty history (see the module note above).
 *
 * @param journalPath - the owned journal path.
 * @param options - the read limit; defaults to {@link PANEL_CLOSE_DEFAULT_LIMIT}.
 * @returns the recent closes, or `[]` when there is no readable journal.
 * @throws {@link DayflowError} `invalid_input` for a limit outside 1-20;
 *   `database_error` for an existing ledger row no reader understands.
 */
export async function listPanelCloses(
  journalPath: string,
  options: ListPanelClosesOptions = {},
): Promise<PanelCloseSummary[]> {
  const limit = resolveLimit(options?.limit);
  if (typeof journalPath !== 'string' || journalPath.trim() === '' || !existsSync(journalPath)) return [];
  // `withJournal` opens (or migrates) the journal and then hands the callback an
  // open connection. Note whether the callback ever ran: an error before it did
  // means this file cannot be read as the owned journal at all (not SQLite, a
  // directory, a schema this build cannot decrypt), which the Insights payload's
  // no-journal path already treats as an empty section. An error after it ran is
  // real ledger data — a malformed row — and is not hidden: it goes up unchanged.
  let opened = false;
  try {
    return withJournal(journalPath, (db) => {
      opened = true;
      return readPanelCloses(db, { limit });
    });
  } catch (error) {
    if (opened) throw error;
    return [];
  }
}
