/**
 * Model-facing text renderers.
 *
 * The tools return structured JSON as their canonical value; these functions
 * render the same data as compact text so a model reads a day, a week, or a
 * standup without parsing JSON. Every renderer tolerates empty data, because a
 * quiet day is normal and must not look like a failure.
 * @module dsh-plugin-dayflow/format
 */

import { formatClock, formatDuration } from './day.js';
import type {
  ActivityPayload,
  BreakdownPayload,
  DailyPayload,
  SearchPayload,
  StatusPayload,
  TimelinePayload,
  WeeklyPayload,
} from './queries.js';
import type { ImportReport } from './journal.js';

function categoryPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * Render one activity row: `09:12–09:40 · 28m · Title · Category (#id)`.
 * @param card - the activity payload.
 * @param withSummary - whether to append the one-line summary.
 * @returns one or two lines.
 */
export function renderActivityLine(card: ActivityPayload, withSummary = true): string {
  const start = new Date(card.start);
  const end = new Date(card.end);
  const facts = [
    `${formatClock(start)}–${formatClock(end)}`,
    formatDuration(card.duration_minutes),
    card.title === '' ? '(untitled activity)' : card.title,
    card.category === '' ? 'uncategorized' : card.category,
  ];
  const details: string[] = [];
  if (card.subcategory !== undefined && card.subcategory !== '') details.push(card.subcategory);
  if (card.apps !== undefined && card.apps.length > 0) details.push(card.apps.join(', '));
  if (card.distraction_count !== undefined) {
    details.push(`${card.distraction_count} ${plural(card.distraction_count, 'distraction')}`);
  }
  let line = `- ${facts.join(' · ')} (#${card.record_id})`;
  if (details.length > 0) line += `\n  ${details.join(' · ')}`;
  if (withSummary && card.summary !== '') line += `\n  ${card.summary}`;
  return line;
}

/**
 * Render a day's timeline.
 * @param payload - the `dayflow_timeline` value.
 * @returns model-facing text.
 */
export function renderTimeline(payload: TimelinePayload): string {
  const header = `Dayflow · ${payload.date} (day runs 04:00–04:00 ${payload.time_zone})`;
  if (payload.cards.length === 0) {
    return `${header}\n\nNo activities recorded for this day. Recent time may still be waiting for analysis.`;
  }
  const tracked = payload.cards.reduce((sum, card) => sum + card.duration_minutes, 0);
  const body = payload.cards.map((card) => renderActivityLine(card)).join('\n');
  return `${header}\n\n${payload.cards.length} ${plural(payload.cards.length, 'activity', 'activities')} · ${formatDuration(tracked)} tracked\n\n${body}\n\n${payload.hint}`;
}

/**
 * Render one activity in full.
 * @param card - the detailed activity payload.
 * @param timeZone - the local timezone label.
 * @returns model-facing text.
 */
export function renderActivity(card: ActivityPayload, timeZone: string): string {
  const start = new Date(card.start);
  const end = new Date(card.end);
  const lines = [
    `#${card.record_id} · ${card.title === '' ? '(untitled activity)' : card.title}`,
    `${formatClock(start)}–${formatClock(end)} · ${formatDuration(card.duration_minutes)} · ${card.category === '' ? 'uncategorized' : card.category}${card.subcategory !== undefined ? ` / ${card.subcategory}` : ''} (${timeZone})`,
  ];
  if (card.apps !== undefined && card.apps.length > 0) lines.push(`Apps: ${card.apps.join(', ')}`);
  if (card.distraction_count !== undefined) {
    lines.push(`Distractions: ${card.distraction_count}`);
  }
  if (card.summary !== '') lines.push('', card.summary);
  if (card.detailed_summary !== undefined && card.detailed_summary !== '') {
    lines.push('', card.detailed_summary);
  }
  return lines.join('\n');
}

/**
 * Render per-category totals for a range.
 * @param payload - the `dayflow_breakdown` value.
 * @returns model-facing text.
 */
export function renderBreakdown(payload: BreakdownPayload): string {
  const header = `${payload.range.from} → ${payload.range.to} · ${formatDuration(payload.tracked_minutes)} tracked`;
  if (payload.categories.length === 0) {
    return `${header}\n\nNo tracked time in this range.`;
  }
  const body = payload.categories
    .map((category) => `- ${category.name}: ${formatDuration(category.minutes)} (${categoryPercent(category.share)})`)
    .join('\n');
  return `${header}\n\n${body}\n\n${payload.hint}`;
}

/**
 * Render a week's rollup.
 * @param payload - the `dayflow_weekly` value.
 * @returns model-facing text.
 */
export function renderWeekly(payload: WeeklyPayload): string {
  const header =
    `${payload.week_start} → ${payload.week_end}\n` +
    `tracked ${formatDuration(payload.tracked_minutes)} · focus ${formatDuration(payload.focus_minutes)} (Idle excluded)`;
  if (payload.categories.length === 0) {
    return `${header}\n\nNo tracked time this week.`;
  }
  const body = payload.categories
    .map((category) => `- ${category.name}: ${formatDuration(category.minutes)} (${categoryPercent(category.share)})`)
    .join('\n');
  return `${header}\n\n${body}`;
}

/**
 * Render the Daily standup document.
 * @param payload - the `dayflow_daily` value.
 * @returns model-facing text.
 */
export function renderDaily(payload: DailyPayload): string {
  const section = (title: string, items: readonly string[]): string =>
    items.length === 0 ? `${title}\n- None` : `${title}\n${items.map((item) => `- ${item}`).join('\n')}`;
  return [
    `Daily · ${payload.date}`,
    '',
    section('Highlights', payload.highlights),
    '',
    section('Tasks', payload.tasks),
    '',
    `Blockers\n- ${payload.blockers === '' ? 'None' : payload.blockers}`,
  ].join('\n');
}

/**
 * Render search matches.
 * @param payload - the `dayflow_search` value.
 * @returns model-facing text.
 */
export function renderSearch(payload: SearchPayload): string {
  if (payload.matches.length === 0) {
    return `No activities matching "${payload.query}".`;
  }
  const body = payload.matches.map((card) => renderActivityLine(card, false)).join('\n');
  return `${payload.matches.length} ${plural(payload.matches.length, 'match', 'matches')} for "${payload.query}"\n\n${body}`;
}

/**
 * Render capture freshness, backlog, and capability flags.
 * @param payload - the `dayflow_status` value.
 * @returns model-facing text.
 */
export function renderStatus(payload: StatusPayload, now: Date = new Date()): string {
  const lines: string[] = [];

  // A machine without Dayflow gets the setup path first; the counters below
  // would all read zero and say nothing useful.
  if (payload.setup !== undefined && !payload.setup.ready) {
    lines.push('Dayflow · not set up on this Mac yet');
    for (const step of payload.setup.missing) {
      lines.push(`- ${step.title}: ${step.detail}`);
    }
    lines.push(
      payload.setup.homebrew_installed
        ? `Install: ${payload.setup.install_command}`
        : `Download: ${payload.setup.download_url}`,
    );
    return lines.join('\n');
  }

  if (payload.last_capture_at === undefined) {
    lines.push('Dayflow · no captures recorded yet');
  } else {
    const minutesAgo = Math.max(0, Math.round((now.getTime() - new Date(payload.last_capture_at).getTime()) / 60_000));
    lines.push(`Dayflow · last capture ${minutesAgo <= 1 ? 'just now' : `${formatDuration(minutesAgo)} ago`}`);
  }
  lines.push(`Today: ${payload.today} (day starts 04:00, ${payload.time_zone})`);
  lines.push(`Source: ${payload.source ?? 'dayflow'}`);
  if (payload.pending_batches > 0) {
    lines.push(`Analysis backlog: ${payload.pending_batches} ${plural(payload.pending_batches, 'batch', 'batches')}`);
  }
  if (payload.failed_batches > 0) {
    lines.push(`Failed batches: ${payload.failed_batches}`);
  }
  lines.push(
    payload.edit_bridge_listening
      ? 'Edit bridge: listening'
      : 'Edit bridge: not listening (Dayflow closed, or agent access off)',
  );
  lines.push(`Edits: ${payload.edits_enabled ? 'enabled' : 'disabled (reads only)'}`);
  lines.push(`Database: ${payload.database_path}`);
  return lines.join('\n');
}

/**
 * Render the category list.
 * @param categories - rows from `categoryPayloads`.
 * @returns model-facing text.
 */
export function renderCategories(
  categories: readonly { name: string; color_hex: string; is_system: boolean; is_idle: boolean }[],
): string {
  if (categories.length === 0) return 'No categories configured.';
  const rows = categories.map((category) => {
    const flags: string[] = [];
    if (category.is_system) flags.push('system');
    if (category.is_idle) flags.push('idle');
    return `- ${category.name} (${category.color_hex})${flags.length > 0 ? ` · ${flags.join(', ')}` : ''}`;
  });
  return `${categories.length} ${plural(categories.length, 'category', 'categories')}\n\n${rows.join('\n')}`;
}

/**
 * Render the outcome of a write operation.
 * @param summary - what changed, in the tool's words.
 * @param data - the app's response payload, when it returned one.
 * @returns model-facing text.
 */
export function renderWrite(summary: string, data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return `${summary} ✓`;
  const details = JSON.stringify(data, null, 2);
  return `${summary} ✓\n\n${details}`;
}

/** Render the import report without hiding the idempotency or skip details. */
export function renderImport(report: ImportReport): string {
  const imported = Object.entries(report.imported)
    .map(([table, count]) => `- ${table}: ${count}`)
    .join('\n');
  const updated = Object.entries(report.updated)
    .map(([table, count]) => `- ${table}: ${count}`)
    .join('\n');
  const unchanged = Object.entries(report.unchanged)
    .map(([table, count]) => `- ${table}: ${count}`)
    .join('\n');
  const skipped = report.skipped.map((entry) => `- ${entry.table}: ${entry.reason}`).join('\n');
  return [
    `Imported Dayflow data from ${report.source_path}`,
    '',
    'Imported rows',
    imported === '' ? '- None' : imported,
    '',
    'Updated rows',
    updated === '' ? '- None' : updated,
    '',
    'Already present',
    unchanged === '' ? '- None' : unchanged,
    '',
    'Skipped',
    skipped === '' ? '- None' : skipped,
    '',
    `Owned journal: ${report.journal_path}`,
  ].join('\n');
}
