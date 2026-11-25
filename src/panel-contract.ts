/**
 * The wire contract shared by the host routes and the browser panel.
 *
 * This module must stay dependency-free and browser-safe: the client bundle
 * imports it, so nothing here may reach for `node:` builtins or host services.
 * @module dsh-plugin-dayflow/panel-contract
 */

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
  /** The goal the user set for this day; null means no goal. Only the day route fills this. */
  goal?: PanelGoal | null;
  /** The user's own review marks for this day; only the day route fills this. */
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

/** Exact Fetch route for the journal insights (tasks, review, memory, reflections). */
export const PANEL_INSIGHTS_PATH = '/api/dayflow/insights';

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
