/**
 * Dayflow's calendar arithmetic.
 *
 * A Dayflow *day* runs 04:00–04:00 local time, so work at 1 AM belongs to the
 * previous day. A Dayflow *week* runs Monday 04:00 to the next Monday 04:00.
 * These rules mirror the app's own `getDayInfoFor4AMBoundary()` and
 * `WeeklyDateRange`; getting them wrong silently shifts every answer.
 * @module dsh-plugin-dayflow/day
 */

import { DayflowError } from './errors.js';

/** One Dayflow day: its `YYYY-MM-DD` label and the 4 AM window it covers. */
export interface DayWindow {
  /** Label used by the app and its database, e.g. `2026-10-19`. */
  readonly dayKey: string;
  /** 04:00 local time on the labelled day, inclusive. */
  readonly start: Date;
  /** 04:00 local time on the next day, exclusive. */
  readonly end: Date;
}

/** A Monday-to-Monday window, both ends at 04:00 local time. */
export interface WeekWindow {
  /** Monday 04:00, inclusive. */
  readonly start: Date;
  /** The next Monday 04:00, exclusive. */
  readonly end: Date;
}

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Copy a date and shift it by whole local days, keeping the wall-clock hour. */
function addDays(date: Date, days: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

/** The local wall-clock hour `hour` on the same calendar date. */
function atHour(date: Date, hour: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setHours(hour, 0, 0, 0);
  return shifted;
}

/** The `YYYY-MM-DD` label of a local calendar date. */
export function formatDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The Dayflow day containing an instant.
 * @param date - any instant; before 4 AM it resolves to the previous day.
 * @returns the labelled 4 AM window.
 */
export function dayWindowContaining(date: Date): DayWindow {
  const fourAm = atHour(date, 4);
  const start = date < fourAm ? addDays(fourAm, -1) : fourAm;
  return { dayKey: formatDayKey(start), start, end: addDays(start, 1) };
}

/**
 * The Dayflow day for an explicit `YYYY-MM-DD` label.
 * @param key - the label, exactly as the app writes it.
 * @returns the window, or `undefined` when the label is not a real date.
 */
export function dayWindowForKey(key: string): DayWindow | undefined {
  const match = DAY_KEY_PATTERN.exec(key.trim());
  if (match === null) return undefined;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const start = new Date(year, month - 1, day, 4, 0, 0, 0);
  // Reject impossible dates such as 2026-02-30, which Date would roll over.
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
    return undefined;
  }
  return { dayKey: `${yearText}-${monthText}-${dayText}`, start, end: addDays(start, 1) };
}

/**
 * The label of the calendar day before `dayKey`.
 *
 * A day key is a local calendar label, not an instant, so the shift is done on
 * the label in UTC: subtracting 24 hours from a local `Date` would land on the
 * wrong date across a daylight-saving change even though only the label moves.
 *
 * @param dayKey - a `YYYY-MM-DD` day key, as the app writes it.
 * @returns the previous day's label, for example `2026-03-10` for `2026-03-11`.
 * @throws `invalid_input` when `dayKey` is not a real date.
 */
export function previousDayKey(dayKey: string): string {
  // Reuse the day-window validation: it is the one place that knows which
  // labels are real dates (2026-02-30 is not) and it normalizes padding.
  const window = typeof dayKey === 'string' ? dayWindowForKey(dayKey) : undefined;
  if (window === undefined) {
    throw new DayflowError(
      `"${typeof dayKey === 'string' ? dayKey : String(dayKey)}" is not a day. ` +
        'Use YYYY-MM-DD, for example 2026-03-11.',
      'invalid_input',
    );
  }
  const [yearText, monthText, dayText] = window.dayKey.split('-');
  const label = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  label.setUTCDate(label.getUTCDate() - 1);
  // `dayWindowForKey` already refuses years below 0100 (Date treats 0–99 as
  // 1900+), so the year is a real calendar year; keep all four digits.
  return (
    `${String(label.getUTCFullYear()).padStart(4, '0')}-` +
    `${pad(label.getUTCMonth() + 1)}-${pad(label.getUTCDate())}`
  );
}

/**
 * The Dayflow week containing an instant: Monday 04:00 through Monday 04:00.
 * @param date - any instant inside the wanted week.
 * @returns the week's boundaries.
 */
export function weekWindowContaining(date: Date): WeekWindow {
  const local = new Date(date.getTime());
  // getDay(): Sunday 0 … Saturday 6, so Monday is two days after Sunday.
  const daysSinceMonday = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - daysSinceMonday);
  const mondayFourAm = atHour(local, 4);
  const start = date < mondayFourAm ? addDays(mondayFourAm, -7) : mondayFourAm;
  return { start, end: addDays(start, 7) };
}

/**
 * Resolve an optional day argument, defaulting to the day containing `now`.
 * @param key - the caller's `YYYY-MM-DD`, or `undefined` for the current day.
 * @param now - injectable clock, so tests are not time-dependent.
 * @returns the resolved window.
 */
export function resolveDayWindow(key: string | undefined, now: Date = new Date()): DayWindow {
  if (key === undefined || key.trim() === '') return dayWindowContaining(now);
  const window = dayWindowForKey(key);
  if (window === undefined) {
    throw new Error(`"${key}" is not a date. Use YYYY-MM-DD, for example 2026-03-11.`);
  }
  return window;
}

/** Seconds since the Unix epoch, the unit the app stores timestamps in. */
export function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** ISO-8601 in local time with an explicit offset, e.g. `2026-10-19T09:12:00+08:00`. */
export function formatIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

/** Wall-clock time as the app shows it, e.g. `2:30 PM`. */
export function formatClock(date: Date): string {
  const hours = date.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelveHour}:${pad(date.getMinutes())} ${suffix}`;
}

/** Human duration such as `45m`, `2h`, or `2h 05m`. */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${pad(rest)}m`;
}

/** The local timezone's IANA name, falling back to the resolved offset. */
export function timeZoneName(now: Date = new Date()): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? `UTC${now.getTimezoneOffset() > 0 ? '-' : '+'}`;
}
