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
  DayGoalPayload,
  GoalCategoryPayload,
  JournalEntryPayload,
  ObservationPayload,
  ReviewRatingPayload,
  SearchPayload,
  StatusPayload,
  TimelinePayload,
  WeeklyPayload,
} from './queries.js';
import type { ImportReport } from './journal.js';
import type { MemoryClaimPayload } from './memory.js';
import type { ReflectionPayload } from './reflections.js';
import type { ReviewItemPayload, ReviewToolPayload } from './review.js';
import type { MemoryToolPayload } from './tools/memory.js';
import type { ReflectionToolPayload } from './tools/reflection.js';
import type { TaskToolPayload } from './tools/task.js';

function categoryPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/** 24-hour wall clock for the evidence rows, e.g. `09:13`. */
function formatTimeOfDay(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** A local start–end pair, e.g. `09:13–09:20`. */
function formatTimeRange(start: string, end: string): string {
  return `${formatTimeOfDay(new Date(start))}–${formatTimeOfDay(new Date(end))}`;
}

/** One goal category as `Name (color)`, or just the name without a color. */
function categoryLabel(category: GoalCategoryPayload): string {
  return category.color_hex === undefined || category.color_hex === ''
    ? category.name
    : `${category.name} (${category.color_hex})`;
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
 * Render a day's own journal entry.
 * @param payload - the `dayflow_journal` value.
 * @returns model-facing text.
 */
export function renderJournal(payload: JournalEntryPayload): string {
  const header = `Journal · ${payload.date}`;
  if (!payload.found) return `${header}\n\n${payload.hint}`;
  const rows: string[] = [];
  const section = (label: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') rows.push(`${label}: ${value}`);
  };
  section('Status', payload.status);
  section('Intentions', payload.intentions);
  section('Notes', payload.notes);
  section('Goals', payload.goals);
  section('Reflections', payload.reflections);
  section('Summary', payload.summary);
  if (rows.length === 0) return `${header}\n\nAn entry exists but has no text yet.`;
  return `${header}\n\n${rows.join('\n')}`;
}

/**
 * Render a day's focus goal and its categories.
 * @param payload - the `dayflow_goals` value.
 * @returns model-facing text.
 */
export function renderGoals(payload: DayGoalPayload): string {
  const header = `Goals · ${payload.date}`;
  if (!payload.found) return `${header}\n\n${payload.hint}`;
  const rows: string[] = [];
  const targets: string[] = [];
  if (payload.focus_minutes !== undefined) targets.push(`Focus target: ${formatDuration(payload.focus_minutes)}`);
  if (payload.distraction_limit_minutes !== undefined) {
    targets.push(`Distraction limit: ${formatDuration(payload.distraction_limit_minutes)}`);
  }
  if (targets.length > 0) rows.push(targets.join(' · '));
  if (payload.is_skipped === true) rows.push('Skipped: yes');
  if (payload.focus_categories.length > 0) {
    rows.push(`Focus categories: ${payload.focus_categories.map(categoryLabel).join(', ')}`);
  }
  if (payload.distraction_categories.length > 0) {
    rows.push(`Distraction categories: ${payload.distraction_categories.map(categoryLabel).join(', ')}`);
  }
  if (rows.length === 0) return `${header}\n\nA goal exists but carries no targets or categories.`;
  return `${header}\n\n${rows.join('\n')}`;
}

/** The `dayflow_observations` payload: one activity's evidence rows. */
export interface ObservationsPayload {
  record_id: number;
  observations: ObservationPayload[];
  hint: string;
}

/**
 * Render the per-observation evidence behind one activity.
 * @param payload - the `dayflow_observations` value.
 * @returns model-facing text.
 */
export function renderObservations(payload: ObservationsPayload): string {
  const count = payload.observations.length;
  const header = `#${payload.record_id} · ${count} ${plural(count, 'observation')}`;
  if (count === 0) return `${header}\n\n${payload.hint}`;
  const rows = payload.observations.map((observation) => {
    const text = observation.text === '' ? '(no observation text)' : observation.text;
    const line = `- ${formatTimeRange(observation.start, observation.end)} · ${formatDuration(observation.duration_minutes)} · ${text}`;
    return observation.model === undefined || observation.model === ''
      ? line
      : `${line} (${observation.model})`;
  });
  return `${header}\n\n${rows.join('\n')}`;
}

/** The `dayflow_review_ratings` payload: one day's own review marks. */
export interface ReviewRatingsPayload {
  date: string;
  ratings: ReviewRatingPayload[];
  hint: string;
}

/**
 * Render the user's focused/neutral/distracted marks for one day.
 * @param payload - the `dayflow_review_ratings` value.
 * @returns model-facing text.
 */
export function renderRatings(payload: ReviewRatingsPayload): string {
  const header = `Ratings · ${payload.date}`;
  if (payload.ratings.length === 0) return `${header}\n\n${payload.hint}`;
  const rows = payload.ratings.map((rating) => {
    const facts = [formatTimeRange(rating.start, rating.end), rating.rating];
    if (rating.title !== undefined && rating.title !== '') facts.push(rating.title);
    let line = `- ${facts.join(' · ')}`;
    if (rating.record_id !== undefined) line += ` (#${rating.record_id})`;
    return line;
  });
  return `${header}\n\n${rows.join('\n')}`;
}

/**
 * Render one review-queue row: `- #3 · distillation · Title · confidence 0.80 · 2026-11-25`.
 * @param item - the review item payload.
 * @returns one line.
 */
function renderReviewItem(item: ReviewItemPayload): string {
  const facts = [`#${item.id}`, item.kind, item.title === '' ? '(untitled item)' : item.title];
  facts.push(`confidence ${item.confidence.toFixed(2)}`);
  if (item.source_day !== undefined && item.source_day !== '') facts.push(item.source_day);
  return `- ${facts.join(' · ')}`;
}

/**
 * Render the agent's review queue and the outcome of a proposal or decision.
 * @param payload - the `journal_review` value.
 * @returns model-facing text.
 */
export function renderReview(payload: ReviewToolPayload): string {
  if (payload.action === 'list') {
    const items = payload.items ?? [];
    if (items.length === 0) return payload.hint;
    const status = items[0]?.status ?? 'proposed';
    const header = `Review queue · ${items.length} ${status} ${plural(items.length, 'item')}`;
    return `${header}\n\n${items.map((item) => renderReviewItem(item)).join('\n')}`;
  }

  if (payload.action === 'propose') {
    if (payload.dropped === true) return `Proposal dropped: ${payload.reason ?? 'no reason given'}`;
    if (payload.item === undefined) return payload.hint;
    return `Proposed #${payload.item.id} · ${payload.item.kind} · ${payload.item.title}`;
  }

  const item = payload.item;
  if (item === undefined) return payload.hint;
  if (payload.action === 'decide') {
    let line = `#${item.id} · ${item.status} · ${item.title}`;
    if (payload.task_id !== undefined) {
      line += ` → created task #${payload.task_id}${payload.task_title === undefined ? '' : ` "${payload.task_title}"`}`;
    }
    if (payload.memory_id !== undefined) line += ` → remembered as claim #${payload.memory_id}`;
    return item.decision_note !== undefined && item.decision_note !== ''
      ? `${line}\nDecision note: ${item.decision_note}`
      : line;
  }
  return `#${item.id} · suppression cleared · ${item.title}`;
}

/**
 * Collapse a claim body onto one line and cap its length, so a memory row stays
 * scannable even when the body is a paragraph.
 * @param text - the claim body.
 * @param maxLength - the longest text kept before a trailing ellipsis.
 * @returns one line of text.
 */
function oneLine(text: string, maxLength = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 1)}…`;
}

/**
 * Render one memory claim as a list row: `- #3 · subject · observed 2026-10-19 · preference`
 * followed by its body on an indented line.
 * @param claim - the memory claim payload.
 * @returns one or two lines.
 */
function renderMemoryClaim(claim: MemoryClaimPayload): string {
  const line = `- #${claim.id} · ${claim.subject} · observed ${claim.observed_on} · ${claim.kind}`;
  const body = oneLine(claim.body);
  return body === '' ? line : `${line}\n  ${body}`;
}

/**
 * Render the journal's dated memory and the outcome of a write.
 *
 * A claim is always shown with its `observed_on` date, because the store keeps
 * what was true on a day rather than what is true now; the empty list falls
 * back to the hint, which explains how to search more broadly.
 * @param payload - the `journal_memory` value.
 * @returns model-facing text.
 */
export function renderMemory(payload: MemoryToolPayload): string {
  if (payload.action === 'add') {
    const claim = payload.claim;
    if (claim === undefined) return payload.hint;
    const facts = [`observed ${claim.observed_on}`, `confidence ${claim.confidence.toFixed(2)}`];
    if (claim.source_review_item !== undefined) facts.push(`review item #${claim.source_review_item}`);
    if (claim.source_days !== undefined && claim.source_days.length > 0) {
      facts.push(`days ${claim.source_days.join(', ')}`);
    }
    return `Remembered #${claim.id} · ${claim.kind} · ${claim.subject}\n${facts.join(' · ')}`;
  }

  if (payload.action === 'search' || payload.action === 'list') {
    const claims = payload.claims ?? [];
    if (claims.length === 0) return payload.hint;
    const count = `${claims.length} ${plural(claims.length, 'claim')}`;
    const header =
      payload.action === 'search'
        ? `Memory · ${count} for "${payload.query ?? ''}"`
        : `Memory · ${count}`;
    return `${header}\n\n${claims.map((claim) => renderMemoryClaim(claim)).join('\n')}`;
  }

  if (payload.action === 'supersede') {
    const claim = payload.claim;
    if (claim === undefined || payload.previous_id === undefined) return payload.hint;
    const lines = [
      `Superseded #${payload.previous_id} → #${claim.id} · ${claim.subject}`,
      `observed ${claim.observed_on} · confidence ${claim.confidence.toFixed(2)} · ${claim.kind}`,
    ];
    const body = oneLine(claim.body);
    if (body !== '') lines.push(body);
    return lines.join('\n');
  }

  if (payload.action === 'forget') {
    return payload.forgotten === undefined ? payload.hint : `Forgot claim #${payload.forgotten}`;
  }

  return payload.hint;
}

/**
 * Render a reflection's body as a few compact lines, so a save reply stays
 * scannable even when the stored body is a paragraph.
 * @param body - the reflection body.
 * @param maxLines - the longest number of lines kept before a trailing ellipsis.
 * @returns one line per kept body line, or '' for a blank body.
 */
function reflectionPreview(body: string, maxLines = 4): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const kept = lines.slice(0, maxLines).map((line) => oneLine(line, 120));
  if (lines.length > maxLines) kept.push('…');
  return kept.join('\n');
}

/**
 * Render a reflection's headline: its first non-blank body line, capped so a
 * list row stays one line.
 * @param body - the reflection body.
 * @returns one line of text, or '' for a blank body.
 */
function reflectionHeadline(body: string): string {
  const line = body.split(/\r?\n/).find((candidate) => candidate.trim() !== '') ?? '';
  return oneLine(line, 80);
}

/**
 * Render a reflection's highlights as an indented list, when it has any.
 * @param reflection - the reflection payload.
 * @returns the highlight lines, or an empty array.
 */
function reflectionHighlights(reflection: ReflectionPayload): string[] {
  if (reflection.highlights.length === 0) return [];
  return ['highlights:', ...reflection.highlights.map((highlight) => `- ${highlight}`)];
}

/**
 * Render a reflection save, read, list, or delete.
 *
 * A reflection is the compressed summary of one period, so the save and get
 * renderers show the body itself (the save one truncated) and the list stays
 * one line per period; a get that found nothing falls back to the hint, which
 * says to write a reflection instead of inventing one.
 * @param payload - the `journal_reflection` value.
 * @returns model-facing text.
 */
export function renderReflection(payload: ReflectionToolPayload): string {
  if (payload.action === 'save') {
    const reflection = payload.reflection;
    if (reflection === undefined) return payload.hint;
    const lines = [`Reflection saved · ${reflection.kind} ${reflection.period_key}`];
    const body = reflectionPreview(reflection.body);
    if (body !== '') lines.push(body);
    lines.push(...reflectionHighlights(reflection));
    return lines.join('\n');
  }

  if (payload.action === 'get') {
    const reflection = payload.reflection;
    if (payload.found !== true || reflection === undefined) return payload.hint;
    const lines = [`Reflection · ${reflection.kind} ${reflection.period_key}`, '', reflection.body];
    lines.push(...reflectionHighlights(reflection));
    if (reflection.source_days.length > 0) {
      lines.push(`source days: ${reflection.source_days.join(', ')}`);
    }
    return lines.join('\n');
  }

  if (payload.action === 'list') {
    const reflections = payload.reflections ?? [];
    if (reflections.length === 0) return payload.hint;
    const rows = reflections.map((reflection) => {
      const headline = reflectionHeadline(reflection.body);
      return `- ${reflection.kind} ${reflection.period_key}${headline === '' ? '' : ` · ${headline}`}`;
    });
    return `Reflections · ${reflections.length}\n\n${rows.join('\n')}`;
  }

  if (payload.action === 'delete') {
    const period = payload.period_key;
    if (period === undefined) return payload.hint;
    const periodLabel = payload.kind === undefined ? period : `${payload.kind} ${period}`;
    return `Reflection deleted · ${periodLabel}`;
  }

  return payload.hint;
}

/**
 * Render one task's number, title, and progress facts, e.g.
 * `active · user · total 2h 30m · 3 days`.
 * @param task - the long-task payload.
 * @returns the facts line.
 */
function taskFacts(task: NonNullable<TaskToolPayload['task']>): string {
  const facts = [
    task.status,
    task.origin,
    `total ${formatDuration(task.total_minutes)}`,
    `${task.session_days} ${plural(task.session_days, 'day')}`,
  ];
  if (task.last_session_day !== undefined && task.last_session_day !== '') {
    facts.push(`last ${task.last_session_day}`);
  }
  if (task.target_date !== undefined && task.target_date !== '') facts.push(`target ${task.target_date}`);
  if (task.stalled) facts.push('STALLED');
  return facts.join(' · ');
}

/**
 * Render one task in full, or list tasks and suggestion matches.
 *
 * A single task keeps its progress on one line and, when present, its sessions
 * one per day; the list and the suggestion pass stay one line per row so a
 * review can scan them.
 * @param payload - the `journal_task` value.
 * @returns model-facing text.
 */
export function renderTask(payload: TaskToolPayload): string {
  if (payload.action === 'list') {
    const tasks = payload.tasks ?? [];
    if (tasks.length === 0) return payload.hint;
    const statuses = new Set(tasks.map((task) => task.status));
    const label = statuses.size === 1 ? [...statuses][0] : 'matching';
    const rows = tasks.map((task) => {
      const facts = [
        `#${task.id}`,
        task.title === '' ? '(untitled task)' : task.title,
        task.status,
        `total ${formatDuration(task.total_minutes)}`,
        `${task.session_days} ${plural(task.session_days, 'day')}`,
      ];
      if (task.stalled) facts.push('stalled');
      return `- ${facts.join(' · ')}`;
    });
    return `Long tasks · ${tasks.length} ${label}\n\n${rows.join('\n')}`;
  }

  if (payload.action === 'suggest') {
    const candidates = payload.candidates ?? [];
    if (candidates.length === 0) return payload.hint;
    const header = `Matches for ${payload.day ?? 'today'} · ${candidates.length} ${plural(candidates.length, 'candidate')}`;
    const rows = candidates.map((candidate) => {
      const facts = [`#${candidate.task_id}`, candidate.title === '' ? '(untitled task)' : candidate.title];
      facts.push(`score ${candidate.score}`);
      if (candidate.activity_ids.length > 0) {
        facts.push(`activity ${candidate.activity_ids.map((id: number) => `#${id}`).join(',')}`);
      }
      if (candidate.reasons.length > 0) facts.push(candidate.reasons.join(', '));
      return `- ${facts.join(' · ')}`;
    });
    return `${header}\n\n${rows.join('\n')}`;
  }

  const task = payload.task;
  if (task === undefined) return payload.hint;
  const lines = [`Task #${task.id} · ${task.title === '' ? '(untitled task)' : task.title}`, taskFacts(task)];
  if (task.sessions !== undefined && task.sessions.length > 0) {
    lines.push('sessions:');
    for (const session of task.sessions) {
      const facts = [session.day, formatDuration(session.minutes)];
      if (session.activity_ids !== undefined && session.activity_ids.length > 0) {
        facts.push(`${session.activity_ids.length} ${plural(session.activity_ids.length, 'activity', 'activities')}`);
      }
      if (session.note !== undefined && session.note !== '') facts.push(session.note);
      lines.push(`- ${facts.join(' · ')}`);
    }
  }
  return lines.join('\n');
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
