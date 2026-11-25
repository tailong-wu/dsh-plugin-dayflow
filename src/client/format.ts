/**
 * Panel-side formatting, kept pure so it is testable without a browser.
 * @module dsh-plugin-dayflow/client/format
 */

import { shiftDayKey } from '../panel-contract.js';
import type { PanelCard, PanelGoal } from '../panel-contract.js';

/** Translation function bound to the panel namespace. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `45m`, `2h`, or `2h 05m`, matching the host's rendering. */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${pad(rest)}m`;
}

/** A tighter duration for a small ring centre: `6h42`, `2h`, `45m`. */
export function compactDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${pad(rest)}`;
}

/**
 * Local wall-clock time: `9:12 AM` in English, `09:12` in Chinese.
 * @param iso - an ISO timestamp.
 * @param language - the panel language; Chinese uses a 24-hour clock.
 * @returns the formatted time, or an empty string for an invalid timestamp.
 */
export function formatClock(iso: string, language = 'en-US'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hours = date.getHours();
  if (language.startsWith('zh')) return `${pad(hours)}:${pad(date.getMinutes())}`;
  const suffix = hours < 12 ? 'AM' : 'PM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${pad(date.getMinutes())} ${suffix}`;
}

/**
 * The goal card's target line: `Focus target: 4h 30m · Distraction limit: 2h`.
 *
 * Only the targets the goal actually carries are joined, so a goal with one
 * target reads as one clause and a goal with none reads as an empty string.
 * The goal's focus and distraction categories are deliberately not flattened
 * into this string: the view renders each as a chip beside its own color, and
 * a plain string cannot carry that color.
 * @param goal - the day's goal, as the host serialises it.
 * @param t - the bound translator.
 * @returns the target line, or an empty string when the goal has no target.
 */
export function goalSummary(goal: PanelGoal, t: Translate): string {
  const parts: string[] = [];
  if (goal.focus_minutes !== undefined) {
    parts.push(t('goalFocusTarget', { value: formatDuration(goal.focus_minutes) }));
  }
  if (goal.distraction_limit_minutes !== undefined) {
    parts.push(t('goalDistractionLimit', { value: formatDuration(goal.distraction_limit_minutes) }));
  }
  if (goal.is_skipped === true) parts.push(t('goalSkipped'));
  return parts.join(' · ');
}

/** The locale key for each review rating Dayflow writes. */
const RATING_KEYS: Record<string, string> = {
  focused: 'ratingFocused',
  neutral: 'ratingNeutral',
  distracted: 'ratingDistracted',
};

/**
 * One review mark's rating as copy: `Focused` / `Neutral` / `Distracted`, in
 * the panel's language. An unknown rating is the user's own stored value, so it
 * is passed through rather than hidden.
 * @param rating - the stored rating value.
 * @param t - the bound translator.
 * @returns the localised label, or the stored value when it is not a known rating.
 */
export function ratingLabel(rating: string, t: Translate): string {
  // `hasOwn` keeps a stored value like `toString` from resolving to a built-in.
  if (!Object.hasOwn(RATING_KEYS, rating)) return rating;
  return t(RATING_KEYS[rating] ?? rating);
}

/**
 * One review mark's stretch of the day: `10:40 AM–10:55 AM` in English,
 * `10:40–10:55` in Chinese, matching every other clock in the panel.
 * @param start - the mark's ISO start.
 * @param end - the mark's ISO end.
 * @param language - the panel language; Chinese uses a 24-hour clock.
 * @returns the range, or an empty string when either timestamp is invalid.
 */
export function ratingTimeRange(start: string, end: string, language = 'en-US'): string {
  const from = formatClock(start, language);
  const to = formatClock(end, language);
  if (from === '' || to === '') return '';
  return `${from}–${to}`;
}

/**
 * An hour label for the week axis: `9 AM` in English, `09:00` in Chinese.
 * @param hour - 0-24 local hour.
 * @param language - the panel language.
 * @returns the label.
 */
export function formatHour(hour: number, language = 'en-US'): string {
  const safe = ((hour % 24) + 24) % 24;
  if (language.startsWith('zh')) return `${pad(safe)}:00`;
  if (safe === 0) return '12 AM';
  if (safe === 12) return '12 PM';
  return safe < 12 ? `${safe} AM` : `${safe - 12} PM`;
}

/** `45%`, from a 0-1 share. */
export function formatShare(share: number): string {
  return `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
}

/**
 * The language the panel formats dates in.
 *
 * The slot only injects a translator, so the language is read back from the
 * copy the translator returns — a fixed pair with no guessing in between.
 * @param t - the bound translator.
 * @returns a BCP 47 tag for `Intl`.
 */
export function panelLanguage(t: Translate): string {
  return t('today') === '今天' ? 'zh-CN' : 'en-US';
}

function formatter(t: Translate, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(panelLanguage(t), options);
}

/** The local day key for an instant. */
export function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's local day key; the host settles the 4 AM Dayflow rollover. */
export function todayKey(): string {
  return dayKeyOf(new Date());
}

/** The local month key for an instant. */
export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** The month containing a day key. */
export function monthOfDay(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/**
 * Shift a week anchor by whole weeks.
 * @param dayKey - any day inside the current week.
 * @param weeks - signed week count.
 * @returns the shifted day key.
 */
export function shiftWeekKey(dayKey: string, weeks: number): string {
  return shiftDayKey(dayKey, weeks * 7);
}

/**
 * The toolbar's day label.
 * @param date - the day being shown.
 * @param today - the Dayflow day containing now.
 * @param t - the bound translator.
 * @returns `Today`, `Yesterday`, or a short formatted date.
 */
export function dayLabel(date: string, today: string, t: Translate): string {
  if (date === today) return t('today');
  if (date === shiftDayKey(today, -1)) return t('yesterday');
  return shortDate(date, t);
}

/** `Mon, Oct 19` in the panel's language. */
export function shortDate(date: string, t: Translate): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return formatter(t, { weekday: 'short', month: 'short', day: 'numeric' }).format(value);
}

/** `Monday, October 19, 2026` in the panel's language. */
export function longDate(date: string, t: Translate): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return formatter(t, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(value);
}

/** `October 2026` in the panel's language. */
export function monthLabel(month: string, t: Translate): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (match === null) return month;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, 1, 12);
  return formatter(t, { year: 'numeric', month: 'long' }).format(value);
}

/**
 * Short weekday names, Monday first, matching the calendar's columns.
 * @param t - the bound translator.
 * @returns seven labels.
 */
export function weekdayLabels(t: Translate): string[] {
  const format = formatter(t, { weekday: 'short' });
  // 2024-01-01 was a Monday, so counting from it gives Monday-first names.
  return Array.from({ length: 7 }, (_, index) => format.format(new Date(2024, 0, 1 + index, 12)));
}

/**
 * The calendar's leading blank cells: how many days of the previous month
 * precede the first, with Monday as the first column.
 * @param month - `YYYY-MM`.
 * @returns 0-6 blanks.
 */
export function leadingBlanks(month: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (match === null) return 0;
  const weekday = new Date(Number(match[1]), Number(match[2]) - 1, 1, 12).getDay();
  return (weekday + 6) % 7;
}

/** One card placed inside a day's swim-lane column. */
export interface PositionedCard {
  readonly card: PanelCard;
  /** Minutes from local midnight to the card's start. */
  readonly topMinutes: number;
  /** Visible height in minutes, clamped to the day. */
  readonly heightMinutes: number;
  /** Zero-based lane index inside the column. */
  readonly lane: number;
  /** Total lanes the column needed; cards share the width evenly. */
  readonly lanes: number;
}

/**
 * Place a day's cards into overlapping-free lanes.
 *
 * Cards keep chronological order; a card joins the first lane whose last card
 * already ended, otherwise a new lane starts. The column's width is divided by
 * the lane count, so a busy day shrinks every card evenly.
 * @param cards - the day's cards, any order.
 * @returns positioned cards in start order.
 */
export function layoutDayCards(cards: readonly PanelCard[]): PositionedCard[] {
  const timed = cards
    .map((card) => {
      const start = new Date(card.start);
      const end = new Date(card.end);
      const topMinutes = start.getHours() * 60 + start.getMinutes();
      const rawHeight = (end.getTime() - start.getTime()) / 60_000;
      const heightMinutes = Math.max(18, Math.min(rawHeight, 1440 - topMinutes));
      return { card, start: start.getTime(), end: Math.max(end.getTime(), start.getTime()), topMinutes, heightMinutes };
    })
    .sort((left, right) => left.start - right.start);

  // A lane is free once its last card has ended, so the packed value is the
  // card's end, not its start.
  const laneEnds: number[] = [];
  const placed = timed.map((entry) => {
    let lane = laneEnds.findIndex((endAt) => endAt <= entry.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(entry.end);
    } else {
      laneEnds[lane] = entry.end;
    }
    return { ...entry, lane };
  });

  const lanes = Math.max(1, laneEnds.length);
  return placed.map((entry) => ({
    card: entry.card,
    topMinutes: entry.topMinutes,
    heightMinutes: entry.heightMinutes,
    lane: entry.lane,
    lanes,
  }));
}

/**
 * The week header's range label.
 * @param start - `YYYY-MM-DD` of the Monday.
 * @param end - `YYYY-MM-DD` of the Sunday.
 * @param t - the bound translator.
 * @returns `10月19日 – 10月25日` in Chinese, `Oct 19 – Oct 25` in English.
 */
export function weekRangeLabel(start: string, end: string, t: Translate): string {
  const parse = (key: string): Date | undefined => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    return match === null ? undefined : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  };
  const startDate = parse(start);
  const endDate = parse(end);
  if (startDate === undefined || endDate === undefined) return `${start} – ${end}`;
  const format = formatter(t, { month: 'short', day: 'numeric' });
  const zh = panelLanguage(t) === 'zh-CN';
  const label = zh
    ? `${startDate.getMonth() + 1}月${startDate.getDate()}日 – ${endDate.getMonth() + 1}月${endDate.getDate()}日`
    : `${format.format(startDate)} – ${format.format(endDate)}`;
  return zh ? `${startDate.getFullYear()}年${label}` : `${label}, ${startDate.getFullYear()}`;
}
