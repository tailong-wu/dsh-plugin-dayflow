/**
 * Panel formatting helpers, shared by the browser bundle and this suite.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compactDuration,
  dayLabel,
  formatClock,
  formatDuration,
  formatHour,
  formatShare,
  goalSummary,
  layoutDayCards,
  leadingBlanks,
  longDate,
  monthKeyOf,
  monthLabel,
  monthOfDay,
  panelLanguage,
  ratingLabel,
  ratingTimeRange,
  shiftWeekKey,
  shortDate,
  todayKey,
  weekRangeLabel,
  weekdayLabels,
} from '../src/client/format.js';
import type { PanelCard, PanelGoal } from '../src/panel-contract.js';
import { EN, ZH } from '../src/client/locale.js';

const en = (key: string): string => EN[key] ?? key;
const zh = (key: string): string => ZH[key] ?? key;

test('durations match the host rendering', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(125), '2h 05m');
  assert.equal(formatDuration(-5), '0m');
});

test('clock times read as the app shows them', () => {
  const nineTwelve = new Date(2026, 9, 19, 9, 12, 0);
  assert.equal(formatClock(nineTwelve.toISOString()), '9:12 AM');
  assert.equal(formatClock(nineTwelve.toISOString(), 'zh-CN'), '09:12');
  assert.equal(formatClock(new Date(2026, 9, 19, 21, 5).toISOString(), 'zh-CN'), '21:05');
  assert.equal(formatClock('not-a-date'), '');
});

test('the panel formats dates in the language the translator speaks', () => {
  assert.equal(panelLanguage(en), 'en-US');
  assert.equal(panelLanguage(zh), 'zh-CN');
});

test('the day label prefers Today and Yesterday', () => {
  assert.equal(dayLabel('2026-10-19', '2026-10-19', en), 'Today');
  assert.equal(dayLabel('2026-10-18', '2026-10-19', en), 'Yesterday');
  assert.equal(dayLabel('2026-10-19', '2026-10-19', zh), '今天');
  assert.equal(dayLabel('2026-10-18', '2026-10-19', zh), '昨天');

  const older = dayLabel('2026-10-01', '2026-10-19', en);
  assert.match(older, /Oct/);
  assert.match(older, /1/);
});

test('both dictionaries carry the same keys', () => {
  assert.deepEqual(Object.keys(ZH).sort(), Object.keys(EN).sort());
  for (const [key, value] of Object.entries(EN)) {
    assert.ok(value.length > 0, `English copy for ${key} is not empty`);
  }
});

test('compact durations fit a small ring centre', () => {
  assert.equal(compactDuration(0), '0m');
  assert.equal(compactDuration(28), '28m');
  assert.equal(compactDuration(60), '1h');
  assert.equal(compactDuration(402), '6h42');
});

test('shares render as whole percentages', () => {
  assert.equal(formatShare(0.659), '66%');
  assert.equal(formatShare(0), '0%');
  assert.equal(formatShare(1), '100%');
});

test('month and weekday labels follow the panel language', () => {
  assert.equal(monthLabel('2026-10', en), 'October 2026');
  assert.match(monthLabel('2026-10', zh), /2026/);
  const weekdays = weekdayLabels(en);
  assert.equal(weekdays.length, 7);
  assert.match(weekdays[0] ?? '', /^Mon/);
  assert.match(weekdays[6] ?? '', /^Sun/);
});

test('the calendar starts on Monday', () => {
  // 2026-10-01 is a Thursday, so three blanks precede it.
  assert.equal(leadingBlanks('2026-10'), 3);
  assert.equal(leadingBlanks('2026-06'), 0, 'June 2026 starts on a Monday');
  assert.equal(leadingBlanks('2026-11'), 6, 'November 2026 starts on a Sunday');
});

test('full dates carry the weekday', () => {
  assert.equal(shortDate('2026-10-19', en), 'Mon, Oct 19');
  assert.match(longDate('2026-10-19', en), /Monday, October 19, 2026/);
});

test('local day and month keys are stable', () => {
  assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(monthKeyOf(new Date(2026, 9, 19, 12)), /^2026-10$/);
  assert.equal(monthOfDay('2026-10-19'), '2026-10');
});

/**
 * A card on the local 2026-10-19 at the given local hours.
 *
 * Built from local `Date`s rather than a fixed `+08:00` offset: the layout reads
 * local hours, and a CI runner in UTC must see the same clock positions as a
 * developer in Asia/Shanghai.
 */
function card(recordId: number, startHour: number, endHour: number, category = 'Work'): PanelCard {
  const start = new Date(2026, 9, 19, startHour, 0, 0, 0);
  const end = new Date(2026, 9, 19, endHour, 0, 0, 0);
  return {
    record_id: recordId,
    start: start.toISOString(),
    end: end.toISOString(),
    duration_minutes: Math.round((end.getTime() - start.getTime()) / 60_000),
    title: `Card ${recordId}`,
    summary: '',
    category,
  };
}

test('the week axis labels hours per language', () => {
  assert.equal(formatHour(9), '9 AM');
  assert.equal(formatHour(0), '12 AM');
  assert.equal(formatHour(12), '12 PM');
  assert.equal(formatHour(13), '1 PM');
  assert.equal(formatHour(9, 'zh-CN'), '09:00');
  assert.equal(formatHour(25), '1 AM');
});

test('cards pack into the fewest non-overlapping lanes', () => {
  const placed = layoutDayCards([card(1, 9, 10), card(2, 9, 10), card(3, 10, 11), card(4, 12, 13)]);
  assert.deepEqual(placed.map((entry) => entry.card.record_id), [1, 2, 3, 4]);
  assert.deepEqual(placed.map((entry) => entry.lane), [0, 1, 0, 0]);
  assert.equal(placed[0]?.lanes, 2);
  assert.equal(placed[2]?.topMinutes, 600);
  assert.equal(placed[2]?.heightMinutes, 60);
});

test('a card keeps a minimum height and clamps to the day', () => {
  const [short] = layoutDayCards([card(1, 9, 9)]);
  assert.ok(short);
  assert.equal(short.heightMinutes, 18);
  const lateStart = new Date(2026, 9, 19, 23, 0, 0, 0);
  const lateEnd = new Date(2026, 9, 20, 2, 0, 0, 0);
  const [late] = layoutDayCards([
    { ...card(1, 23, 23), start: lateStart.toISOString(), end: lateEnd.toISOString() },
  ]);
  assert.ok(late);
  assert.equal(late.heightMinutes, 60, '23:00 to midnight is one hour, not three');
});

test('week anchors shift by whole weeks', () => {
  assert.equal(shiftWeekKey('2026-10-19', 1), '2026-10-26');
  assert.equal(shiftWeekKey('2026-10-19', -1), '2026-10-12');
});

test('the week range label follows the language', () => {
  assert.equal(weekRangeLabel('2026-10-19', '2026-10-25', en), 'Oct 19 – Oct 25, 2026');
  assert.equal(weekRangeLabel('2026-10-19', '2026-10-25', zh), '2026年10月19日 – 10月25日');
});

/** A translator over one dictionary that fills `{name}` placeholders. */
function translator(
  dictionary: Record<string, string>,
): (key: string, params?: Record<string, string | number>) => string {
  return (key, params) => {
    const template = dictionary[key] ?? key;
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params[name];
      return value === undefined ? placeholder : String(value);
    });
  };
}

const enT = translator(EN);
const zhT = translator(ZH);

/** A goal carrying only the fields the case needs. */
function goal(fields: Partial<PanelGoal>): PanelGoal {
  return { focus_categories: [], distraction_categories: [], ...fields };
}

test('the goal summary joins only the targets the goal carries', () => {
  assert.equal(
    goalSummary(goal({ focus_minutes: 270, distraction_limit_minutes: 120 }), enT),
    'Focus target: 4h 30m · Distraction limit: 2h',
  );
  assert.equal(goalSummary(goal({ focus_minutes: 270 }), enT), 'Focus target: 4h 30m');
  assert.equal(goalSummary(goal({ distraction_limit_minutes: 60 }), enT), 'Distraction limit: 1h');
  assert.equal(goalSummary(goal({ is_skipped: true }), enT), 'Skipped');
  assert.equal(goalSummary(goal({}), enT), '');
  assert.equal(
    goalSummary(goal({ focus_minutes: 270, distraction_limit_minutes: 120 }), zhT),
    '专注目标：4h 30m · 分心上限：2h',
  );
});

test('review ratings localise, and an unknown rating passes through', () => {
  assert.equal(ratingLabel('focused', enT), 'Focused');
  assert.equal(ratingLabel('neutral', enT), 'Neutral');
  assert.equal(ratingLabel('distracted', enT), 'Distracted');
  assert.equal(ratingLabel('focused', zhT), '专注');
  assert.equal(ratingLabel('neutral', zhT), '中性');
  assert.equal(ratingLabel('distracted', zhT), '分心');
  assert.equal(ratingLabel('tired', enT), 'tired');
  assert.equal(ratingLabel('', enT), '');
  assert.equal(ratingLabel('toString', enT), 'toString', 'a stored value cannot resolve to a built-in');
});

test('a review mark shows the stretch of the day it covers', () => {
  const start = new Date(2026, 9, 19, 10, 40, 0).toISOString();
  const end = new Date(2026, 9, 19, 10, 55, 0).toISOString();
  assert.equal(ratingTimeRange(start, end), '10:40 AM–10:55 AM');
  assert.equal(ratingTimeRange(start, end, 'zh-CN'), '10:40–10:55');
  assert.equal(ratingTimeRange('not-a-date', end), '');
});

test('the goal and review copy exists in both dictionaries', () => {
  const keys = [
    'goalTitle',
    'goalFocusTarget',
    'goalDistractionLimit',
    'goalSkipped',
    'goalNoGoal',
    'ratingsTitle',
    'ratingFocused',
    'ratingNeutral',
    'ratingDistracted',
  ];
  for (const key of keys) {
    assert.ok((EN[key] ?? '').length > 0, `English copy for ${key} is not empty`);
    assert.ok((ZH[key] ?? '').length > 0, `Chinese copy for ${key} is not empty`);
  }
});

test('the insights copy exists in both dictionaries', () => {
  const keys = [
    'insightsTitle',
    'insightsTabTitle',
    'insightsRefresh',
    'insightsLoading',
    'insightsError',
    'insightsUnavailable',
    'insightsEmpty',
    'insightsIntroTitle',
    'insightsIntro',
    'insightsIntroTasks',
    'insightsIntroReview',
    'insightsIntroMemory',
    'insightsIntroReflections',
    'tasksSection',
    'reviewSection',
    'memorySection',
    'reflectionsSection',
    'noTasks',
    'noReviewItems',
    'noMemoryClaims',
    'noReflections',
    'stalledLabel',
    'targetLabel',
    'confidenceLabel',
    'observedLabel',
    'activeTasksCount',
  ];
  for (const key of keys) {
    assert.ok((EN[key] ?? '').length > 0, `English copy for ${key} is not empty`);
    assert.ok((ZH[key] ?? '').length > 0, `Chinese copy for ${key} is not empty`);
  }
  // The count label is the only insights key with a placeholder; both
  // dictionaries must carry the same interpolation point.
  assert.match(EN['activeTasksCount'] ?? '', /\{count\}/);
  assert.match(ZH['activeTasksCount'] ?? '', /\{count\}/);
  assert.equal(enT('activeTasksCount', { count: 3 }), '3 active');
  assert.equal(zhT('activeTasksCount', { count: 3 }), '3 个进行中');
});

test('the review decision and session unlink copy exists in both dictionaries', () => {
  // Every label the interactive review queue and the task session row render;
  // the two dictionaries share the key set, so a missing language fails here.
  const fixed = [
    'accept',
    'keep',
    'discard',
    'dontSuggestAgain',
    'foreverConfirm',
    'confirm',
    'cancel',
    'working',
    'actionFailed',
    'unlink',
    'unlinkFailed',
    'sessionsLabel',
  ];
  for (const key of fixed) {
    assert.ok((EN[key] ?? '').length > 0, `English copy for ${key} is not empty`);
    assert.ok((ZH[key] ?? '').length > 0, `Chinese copy for ${key} is not empty`);
    assert.doesNotMatch(EN[key] ?? '', /\{\w+\}/, `English copy for ${key} has no placeholder`);
    assert.doesNotMatch(ZH[key] ?? '', /\{\w+\}/, `Chinese copy for ${key} has no placeholder`);
  }
  // The per-day unlink label names the date, so both dictionaries must carry
  // the same interpolation point and resolve it.
  assert.match(EN['unlinkDay'] ?? '', /\{date\}/);
  assert.match(ZH['unlinkDay'] ?? '', /\{date\}/);
  assert.equal(enT('unlinkDay', { date: 'Oct 19' }), 'Unlink Oct 19');
  assert.equal(zhT('unlinkDay', { date: '10月19日' }), '取消关联 10月19日');
  // The kind's forward decision keeps the store's two vocabularies apart: a
  // distillation is Kept, a task proposal is Accepted, and both label rows.
  assert.equal(enT('keep'), 'Keep');
  assert.equal(zhT('keep'), '保留');
  assert.equal(enT('accept'), 'Accept');
  assert.equal(zhT('accept'), '接受');
  assert.equal(enT('working'), 'Working…');
  assert.equal(zhT('working'), '正在处理…');
});

test('the analysis status copy exists in both dictionaries', () => {
  const keys = [
    'analysisOff',
    'analysisOffHint',
    'analysisWaitingConsent',
    'analysisWaitingConsentHint',
    'analysisNeedsProvider',
    'analysisNeedsModel',
    'analysisNeedsConfig',
    'analysisNeedsConfigHint',
    'analysisProviderNotLocal',
    'analysisProviderNotLocalHint',
    'analysisPaused',
    'analysisPausedHint',
    'analysisRunning',
    'analysisIdle',
    'analysisWorkerStopped',
    'analysisWorkerStoppedHint',
    'analysisFailed',
    'analysisBudget',
    'analysisLastJob',
    'analysisPrivacy',
    'analysisPrivacyCloud',
  ];
  for (const key of keys) {
    assert.ok((EN[key] ?? '').length > 0, `English copy for ${key} is not empty`);
    assert.ok((ZH[key] ?? '').length > 0, `Chinese copy for ${key} is not empty`);
  }
  // The budget, failure, and last-job labels interpolate host numbers; both
  // dictionaries must carry every placeholder so no language leaks a raw `{…}`.
  for (const dictionary of [EN, ZH]) {
    const budget = dictionary['analysisBudget'] ?? '';
    for (const placeholder of ['{calls}', '{maxCalls}', '{tokens}', '{maxTokens}']) {
      assert.ok(budget.includes(placeholder), `analysisBudget carries ${placeholder}`);
    }
    assert.match(dictionary['analysisFailed'] ?? '', /\{count\}/);
    assert.match(dictionary['analysisLastJob'] ?? '', /\{time\}/);
  }
  assert.equal(
    enT('analysisBudget', { calls: 3, maxCalls: 120, tokens: '12k', maxTokens: '200k' }),
    '3/120 calls · 12k/200k tokens',
  );
  assert.equal(zhT('analysisBudget', { calls: 3, maxCalls: 120, tokens: '12k', maxTokens: '200k' }), '调用 3/120 · token 12k/200k');
  assert.equal(enT('analysisFailed', { count: 2 }), '2 failed');
  assert.equal(zhT('analysisFailed', { count: 2 }), '2 个失败');
  assert.equal(enT('analysisLastJob', { time: '9:12 AM' }), 'Last job 9:12 AM');
  assert.equal(zhT('analysisLastJob', { time: '09:12' }), '上次任务 09:12');
});
