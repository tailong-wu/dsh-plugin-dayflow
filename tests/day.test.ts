/**
 * Day-boundary arithmetic: the 4 AM day, the Monday 4 AM week, and the
 * formatting the tools render.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DayflowError } from '../src/errors.js';
import {
  dayWindowContaining,
  dayWindowForKey,
  formatClock,
  formatDuration,
  formatIso,
  previousDayKey,
  resolveDayWindow,
  weekWindowContaining,
} from '../src/day.js';

test('a labelled day runs 04:00 to 04:00', () => {
  const window = dayWindowForKey('2026-10-19');
  assert.ok(window);
  assert.equal(window.dayKey, '2026-10-19');
  assert.equal(window.start.getFullYear(), 2026);
  assert.equal(window.start.getMonth(), 9);
  assert.equal(window.start.getDate(), 19);
  assert.equal(window.start.getHours(), 4);
  assert.equal(window.end.getDate(), 20);
  assert.equal(window.end.getHours(), 4);
});

test('impossible and malformed day labels are rejected', () => {
  assert.equal(dayWindowForKey('2026-02-30'), undefined);
  assert.equal(dayWindowForKey('2026-13-01'), undefined);
  assert.equal(dayWindowForKey('2026-2-3'), undefined);
  assert.equal(dayWindowForKey('19-10-2026'), undefined);
  assert.equal(dayWindowForKey('tomorrow'), undefined);
  assert.equal(dayWindowForKey(''), undefined);
});

test('an instant before 4 AM belongs to the previous day', () => {
  const before = dayWindowContaining(new Date(2026, 9, 19, 3, 30));
  assert.equal(before.dayKey, '2026-10-18');
  assert.equal(before.start.getDate(), 18);
  assert.equal(before.end.getDate(), 19);
  assert.equal(before.end.getHours(), 4);

  const atBoundary = dayWindowContaining(new Date(2026, 9, 19, 4, 0));
  assert.equal(atBoundary.dayKey, '2026-10-19');

  const evening = dayWindowContaining(new Date(2026, 9, 19, 23, 59));
  assert.equal(evening.dayKey, '2026-10-19');
});

test('a day key steps back exactly one calendar day', () => {
  assert.equal(previousDayKey('2026-10-19'), '2026-10-18');
  // Month boundaries, leap years, and year boundaries are calendar arithmetic,
  // not a fixed 24-hour subtraction.
  assert.equal(previousDayKey('2026-03-01'), '2026-02-28');
  assert.equal(previousDayKey('2024-03-01'), '2024-02-29');
  assert.equal(previousDayKey('2026-01-01'), '2025-12-31');
  // Labels are normalized through the same day-window validation as the rest.
  assert.equal(previousDayKey(' 2026-10-19 '), '2026-10-18');
});

test('previousDayKey refuses labels that are not days', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-2-3', '', 'tomorrow', '19-10-2026']) {
    assert.throws(
      () => previousDayKey(bad),
      (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
      `${bad} is refused`,
    );
  }
});

test('a week runs Monday 04:00 to the next Monday 04:00', () => {
  const monday = new Date(2026, 9, 19, 9, 0);
  assert.equal(monday.getDay(), 1, 'fixture assumes 2026-10-19 is a Monday');

  const week = weekWindowContaining(monday);
  assert.equal(week.start.getDay(), 1);
  assert.equal(week.start.getHours(), 4);
  assert.equal(week.start.getDate(), 19);
  assert.equal(week.end.getDate(), 26);
  assert.equal(week.end.getHours(), 4);

  const sundayNight = weekWindowContaining(new Date(2026, 9, 25, 23, 0));
  assert.equal(sundayNight.start.getDate(), 19);

  const mondayBeforeFour = weekWindowContaining(new Date(2026, 9, 19, 3, 0));
  assert.equal(mondayBeforeFour.start.getDate(), 12);
});

test('the default day is the one containing now', () => {
  const now = new Date(2026, 9, 19, 15, 0);
  assert.equal(resolveDayWindow(undefined, now).dayKey, '2026-10-19');
  assert.equal(resolveDayWindow('2026-10-01', now).dayKey, '2026-10-01');
  assert.throws(() => resolveDayWindow('nope', now), /YYYY-MM-DD/);
});

test('durations and clock times read the way the app shows them', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(125), '2h 05m');
  assert.equal(formatDuration(-10), '0m');

  assert.equal(formatClock(new Date(2026, 9, 19, 9, 12)), '9:12 AM');
  assert.equal(formatClock(new Date(2026, 9, 19, 13, 5)), '1:05 PM');
  assert.equal(formatClock(new Date(2026, 9, 19, 0, 30)), '12:30 AM');
  assert.equal(formatClock(new Date(2026, 9, 19, 12, 0)), '12:00 PM');
});

test('ISO timestamps carry the local offset', () => {
  const iso = formatIso(new Date(2026, 9, 19, 9, 12, 0));
  assert.match(iso, /^2026-10-19T09:12:00[+-]\d{2}:\d{2}$/);
});
