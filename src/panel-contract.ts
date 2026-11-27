/**
 * The wire contract shared by the host routes and the browser panel.
 *
 * This module must stay dependency-free and browser-safe: the client bundle
 * imports it, so nothing here may reach for `node:` builtins or host services.
 * The one import below is type-only, so it is erased from the client bundle;
 * it keeps the analysis status wire shape defined once, beside its builder.
 * @module dsh-plugin-dayflow/panel-contract
 */

import type { AnalysisStatusPayload } from './analyse/status.js';
import type { PanelBriefSummary } from './briefs/read.js';
import type { MemoryClaimPayload } from './memory.js';
import type { ReviewItemPayload } from './review.js';
import type { LongTaskPayload } from './tasks.js';

export type { PanelBriefMemoryHealth, PanelBriefSummary } from './briefs/read.js';

/** One timeline card, as the panel renders it. */
export interface PanelCard {
  record_id: number;
  start: string;
  end: string;
  duration_minutes: number;
  title: string;
  summary: string;
  category: string;
  subcategory?: string;
  apps?: string[];
  distraction_count?: number;
}

/** One category's share of the day, with the user's own color. */
export interface PanelCategory {
  name: string;
  minutes: number;
  share: number;
  color_hex: string;
}

/** One category the user chose for a day's goal, with the user's own color. */
export interface PanelGoalCategory {
  name: string;
  color_hex?: string;
}

/** The goal the user set for one day, as the panel renders it. */
export interface PanelGoal {
  focus_minutes?: number;
  distraction_limit_minutes?: number;
  is_skipped?: boolean;
  focus_categories: PanelGoalCategory[];
  distraction_categories: PanelGoalCategory[];
}

/** One of the user's own review marks for a stretch of the day. */
export interface PanelRating {
  start: string;
  end: string;
  rating: string;
  record_id?: number;
  title?: string;
}

/** Everything the panel needs for one day, in one response. */
export interface PanelDay {
  /** The Dayflow day these cards belong to. */
  date: string;
  /** The Dayflow day containing now, so the panel can label "Today". */
  today: string;
  time_zone: string;
  day_boundary_hour: number;
  cards: PanelCard[];
  tracked_minutes: number;
  categories: PanelCategory[];
  pending_batches: number;
  last_capture_at?: string;
  edits_enabled: boolean;
  /**
   * The goal the user set for this day; null means no goal. The day, month, and
   * week routes all fill it, so a calendar day carries the same goal its day
   * route reports.
   */
  goal?: PanelGoal | null;
  /**
   * The user's own review marks for this day; an empty array means none. The
   * day, month, and week routes all fill it.
   */
  ratings?: PanelRating[];
}

/** One month of days, for the calendar view. */
export interface PanelMonth {
  /** The month these days belong to, as `YYYY-MM`. */
  month: string;
  /** The Dayflow day containing now. */
  today: string;
  time_zone: string;
  day_boundary_hour: number;
  /** One entry per calendar day, in date order; each is a full {@link PanelDay}. */
  days: PanelDay[];
}

/** One Monday-to-Monday week of days, for the swim-lane view. */
export interface PanelWeek {
  /** Day-flow day key of the week's Monday. */
  week_start: string;
  /** Day-flow day key of the week's Sunday. */
  week_end: string;
  /** The Dayflow day containing now. */
  today: string;
  time_zone: string;
  day_boundary_hour: number;
  /** Seven consecutive days, Monday first; each is a full {@link PanelDay}. */
  days: PanelDay[];
}

/** One day attached to a long task, as the insights list shows it. */
export interface PanelTaskSessionSummary {
  day: string;
  minutes: number;
}

/** One active long task, as the insights list shows it. */
export interface PanelTaskSummary {
  id: number;
  title: string;
  status: string;
  origin: string;
  total_minutes: number;
  session_days: number;
  last_session_day?: string;
  target_date?: string;
  stalled: boolean;
  /** The day-by-day sessions the task already carries; absent when it has none. */
  sessions?: PanelTaskSessionSummary[];
}

/** One still-open review item. */
export interface PanelReviewItem {
  id: number;
  kind: string;
  status: string;
  title: string;
  confidence: number;
  source_day?: string;
}

/** One active memory claim. */
export interface PanelClaimSummary {
  id: number;
  kind: string;
  subject: string;
  observed_on: string;
  confidence: number;
}

/** One stored reflection. */
export interface PanelReflectionSummary {
  id: number;
  kind: string;
  period_key: string;
  body: string;
  updated_at: string;
}

/** Everything the Insights tab renders, in one response. */
export interface PanelInsights {
  tasks: PanelTaskSummary[];
  review: PanelReviewItem[];
  memory: PanelClaimSummary[];
  reflections: PanelReflectionSummary[];
  /**
   * The stored day/week briefs, newest period first; the additive 0.8.1 field.
   * An old client ignores it, and a fresh install answers an empty list.
   */
  briefs: PanelBriefSummary[];
}

/** Body the panel sends to add one long task. */
export interface PanelTaskAddRequest {
  title: string;
}

/** Body the panel sends to remember one dated claim. */
export interface PanelMemoryAddRequest {
  text: string;
}

/** Body the panel sends to append a line to today's reflection. */
export interface PanelReflectionAddRequest {
  text: string;
}

/** Answer to a successful task add. */
export interface PanelTaskAddResponse {
  task: PanelTaskSummary;
}

/** Answer to a successful memory add. */
export interface PanelMemoryAddResponse {
  claim: PanelClaimSummary;
}

/** Answer to a successful reflection append. */
export interface PanelReflectionAddResponse {
  reflection: PanelReflectionSummary;
}

/** Body the panel sends to scan a task's recent history. */
export interface PanelTaskScanRequest {
  task_id: number;
  /** How many recent Dayflow days to scan; the host defaults to 14 and bounds it to 1-90. */
  days?: number;
}

/** One day whose activity matched the task, as the panel previews it. */
export interface PanelTaskScanDay {
  day: string;
  minutes: number;
  activity_ids: number[];
  score: number;
  reasons: string[];
  /** Up to three matched activity titles, for the preview row. */
  titles: string[];
}

/** Answer to a successful history scan; a read-only suggestion, never a write. */
export interface PanelTaskScanResponse {
  scan: {
    task_id: number;
    title: string;
    days: PanelTaskScanDay[];
    total_minutes: number;
    total_days: number;
  };
}

/** Body the panel sends to link scanned days to a task as its sessions. */
export interface PanelTaskLinkRequest {
  task_id: number;
  days: Array<{ day: string; minutes: number; activity_ids: number[] }>;
}

/** Answer to a successful history link: the updated task and the days attached. */
export interface PanelTaskLinkResponse {
  task: PanelTaskSummary;
  linked_days: string[];
}

/**
 * Body the panel sends to record the user's decision on one review item.
 *
 * The decision belongs to the user, so the panel always sends
 * `confirm: true` — the click is that explicit agreement. `forever` turns a
 * negative decision into a hard suppression.
 */
export interface PanelReviewDecisionRequest {
  id: number;
  decision: 'keep' | 'accept' | 'discard' | 'reject';
  note?: string;
  forever?: boolean;
  confirm: true;
}

/** Answer to a successful review decision: the item and what it wrote. */
export interface PanelReviewDecisionResponse {
  review: {
    item: ReviewItemPayload;
    task?: LongTaskPayload;
    memory?: MemoryClaimPayload;
  };
}

/** Body the panel sends to attach one day of work to an existing long task. */
export interface PanelTaskAttachRequest {
  id: number;
  day: string;
  minutes: number;
  note?: string;
  activity_ids?: number[];
  confirm: true;
}

/** Answer to a successful session attach: the task with its sessions. */
export interface PanelTaskAttachResponse {
  task: LongTaskPayload;
}

/** Body the panel sends to remove one day from a long task's progress. */
export interface PanelTaskDetachRequest {
  id: number;
  day: string;
  confirm: true;
}

/** Answer to a successful session detach: the task with its sessions. */
export interface PanelTaskDetachResponse {
  task: LongTaskPayload;
}

/** Whether the host may read this Mac's screen. */
export type PanelCapturePermission = 'granted' | 'denied' | 'unknown';

/** Where the native analysis step is allowed to send captured frames. */
export type PanelCaptureConsent = 'none' | 'cloud' | 'local';

/**
 * The native capture loop's status, as the Insights view shows it.
 *
 * Capture is off by default and the Phase 0 build has no recorder yet, so the
 * panel shows this line to keep the configured state, the system permission,
 * and the pause state visible in one place instead of a second settings view.
 */
export interface PanelCaptureStatus {
  /** The profile's `capture.enabled` master switch. */
  enabled: boolean;
  /** The user's pause flag from the owned journal (`capture_state`). */
  paused: boolean;
  /** The macOS Screen Recording permission, probed on demand. */
  permission: PanelCapturePermission;
  /** The profile's `analysis.enabled` switch. */
  analysis_enabled: boolean;
  /** Where analysis may send frames; `none` keeps everything local. */
  analysis_consent: PanelCaptureConsent;
  /** Native screenshots recorded so far for the current Dayflow day. */
  frames_today: number;
  /** Epoch milliseconds of the last captured frame; absent when none yet. */
  last_frame_at?: number;
}

/** Answer to a capture status read or a pause write. */
export interface PanelCaptureStatusResponse {
  capture: PanelCaptureStatus;
}

/** Body the panel sends to pause or resume capture. */
export interface PanelCapturePauseRequest {
  paused: boolean;
}

/**
 * The analysis status line's answer: job counts, the day's call and token
 * budgets, the worker's state, and the consent gate's blocked reason.
 */
export interface PanelAnalysisStatus {
  analysis: AnalysisStatusPayload;
}

/**
 * The scheduled day/week close's status, as the Insights view shows it.
 *
 * The automation switches live in the profile, so the line is read-only: it
 * reports when the day and the week close, whether a close is running now, the
 * last stored close of each, and how many missed days a catch-up may close. The
 * scheduler owns the live state, so the composition injects the builder; without
 * one the route derives the scheduled part from `automation` and reports idle.
 */
export interface PanelAutomationStatus {
  /** The profile's `automation.enabled` master switch. */
  enabled: boolean;
  /** Whether a day or week close is running right now. */
  running: boolean;
  /** The local time the day closes, as `HH:MM` (`automation.dailyAt`). */
  dailyAt: string;
  /** The weekday the week closes (`automation.weeklyOn`), lowercase English. */
  weeklyOn: string;
  /** How many missed days a catch-up may close (`automation.catchUpDays`). */
  catchUpDays: number;
  /** The most recent stored day close; absent when none has run yet. */
  lastDayClose?: { day: string; status: string; at: number };
  /** The most recent stored week close; absent when none has run yet. */
  lastWeekClose?: { monday: string; status: string; at: number };
  /** Epoch milliseconds of the next scheduled day close; absent when unknown. */
  nextDayCloseAt?: number;
}

/** Answer to an automation status read. */
export interface PanelAutomationStatusResponse {
  automation: PanelAutomationStatus;
}

/** Whether the panel's entry points are exposed. */
export interface PanelConfig {
  enabled: boolean;
}

/** Failure body the routes return. */
export interface PanelError {
  error: string;
}

/** Exact Fetch route for one day's timeline. */
export const PANEL_DAY_PATH = '/api/dayflow/day';

/** Exact Fetch route for one month of days. */
export const PANEL_MONTH_PATH = '/api/dayflow/month';

/** Exact Fetch route for one Monday-anchored week of days. */
export const PANEL_WEEK_PATH = '/api/dayflow/week';

/** Exact Fetch route for one site's favicon. */
export const PANEL_ICON_PATH = '/api/dayflow/icon';

/** Exact Fetch route for the panel's enablement. */
export const PANEL_CONFIG_PATH = '/api/dayflow/panel';

/** Exact Fetch route for the native capture status line. */
export const PANEL_CAPTURE_STATUS_PATH = '/api/dayflow/capture/status';

/** Exact Fetch route that pauses or resumes native capture. */
export const PANEL_CAPTURE_PAUSE_PATH = '/api/dayflow/capture/pause';

/** Exact Fetch route for the analysis worker's status and the day's budget ledger. */
export const PANEL_ANALYSIS_STATUS_PATH = '/api/dayflow/analysis/status';

/** Exact Fetch route for the scheduled day/week close's status. */
export const PANEL_AUTOMATION_STATUS_PATH = '/api/dayflow/automation/status';

/** Exact Fetch route for the journal insights (tasks, review, memory, reflections). */
export const PANEL_INSIGHTS_PATH = '/api/dayflow/insights';

/** Exact Fetch route that adds one long task to the owned journal. */
export const PANEL_TASK_ADD_PATH = '/api/dayflow/tasks';

/** Exact Fetch route that remembers one dated preference claim. */
export const PANEL_MEMORY_ADD_PATH = '/api/dayflow/memory';

/** Exact Fetch route that appends a line to today's saved day reflection. */
export const PANEL_REFLECTION_ADD_PATH = '/api/dayflow/reflections';

/** Exact Fetch route that scans a task's recent history for matching activity. */
export const PANEL_TASK_SCAN_PATH = '/api/dayflow/tasks/scan';

/** Exact Fetch route that attaches scanned days to a task as its sessions. */
export const PANEL_TASK_LINK_PATH = '/api/dayflow/tasks/link';

/** Exact Fetch route that records the user's decision on one review item. */
export const PANEL_REVIEW_DECIDE_PATH = '/api/dayflow/review';

/** Exact Fetch route that attaches one day of work to a long task. */
export const PANEL_TASK_ATTACH_PATH = '/api/dayflow/tasks/attach';

/** Exact Fetch route that detaches one day of work from a long task. */
export const PANEL_TASK_DETACH_PATH = '/api/dayflow/tasks/detach';

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Whether a string is a `YYYY-MM` month label.
 * @param value - candidate label.
 * @returns whether the month is real (month 01-12).
 */
export function isMonthKey(value: string): boolean {
  const match = MONTH_KEY_PATTERN.exec(value);
  if (match === null) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** The month containing a `YYYY-MM-DD` day. */
export function monthOfDay(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/**
 * Every calendar day in a month, in order.
 * @param month - `YYYY-MM`.
 * @returns `YYYY-MM-DD` labels; empty when the month label is invalid.
 */
export function monthDayKeys(month: string): string[] {
  if (!isMonthKey(month)) return [];
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => `${month}-${pad2(index + 1)}`);
}

/**
 * Shift a month label by whole months.
 * @param month - `YYYY-MM`.
 * @param delta - signed month count.
 * @returns the shifted label, or the input when it is not a month.
 */
export function shiftMonthKey(month: string, delta: number): string {
  if (!isMonthKey(month)) return month;
  const [yearText, monthText] = month.split('-');
  const date = new Date(Number(yearText), Number(monthText) - 1 + delta, 1, 12, 0, 0, 0);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/**
 * Shift a `YYYY-MM-DD` label by whole calendar days.
 * @param dayKey - the label to shift.
 * @param days - signed day count.
 * @returns the shifted label, or the input unchanged when it is not a day key.
 */
export function shiftDayKey(dayKey: string, days: number): string {
  const match = DAY_KEY_PATTERN.exec(dayKey);
  if (match === null) return dayKey;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
