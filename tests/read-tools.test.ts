/**
 * The read tool suite, driven the way the registry drives it.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { DayflowError } from '../src/errors.js';
import type {
  DailyPayload,
  DayGoalPayload,
  JournalEntryPayload,
  ObservationPayload,
  ReviewRatingPayload,
  StatusPayload,
  TimelinePayload,
} from '../src/queries.js';
import { readTools } from '../src/tools/read.js';
import { createFixtureDatabase } from './fixtures/database.js';
import { makeRuntime, runAndRender, toolMap, toolNamed } from './helpers.js';

const fixture = createFixtureDatabase();
const runtime = makeRuntime(fixture.path, { searchLimit: 25 });
const tools = toolMap(readTools(runtime));

after(() => {
  fixture.cleanup();
});

test('the read suite registers twelve tools with stable names', () => {
  assert.deepEqual([...tools.keys()], [
    'dayflow_timeline',
    'dayflow_activity',
    'dayflow_breakdown',
    'dayflow_search',
    'dayflow_daily',
    'dayflow_weekly',
    'dayflow_journal',
    'dayflow_goals',
    'dayflow_observations',
    'dayflow_review_ratings',
    'dayflow_categories',
    'dayflow_status',
  ]);
});

test('dayflow_timeline returns the day and renders activity lines', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_timeline', { date: '2026-10-19' });
  const payload = value as TimelinePayload;
  assert.equal(payload.cards.length, 7);
  assert.match(text, /Dayflow · 2026-10-19/);
  assert.match(text, /7 activities · 2h 23m tracked/);
  assert.match(text, /Writing the DSH plugin/);
  assert.match(text, /#1/);
  assert.match(text, /dayflow_activity/);
});

test('dayflow_timeline defaults to the current day', async () => {
  const { value } = await runAndRender(tools, 'dayflow_timeline');
  const payload = value as TimelinePayload;
  assert.equal(typeof payload.date, 'string');
  assert.equal(payload.day_boundary_hour, 4);
});

test('dayflow_timeline rejects an impossible date', async () => {
  await assert.rejects(
    () => toolNamed(tools, 'dayflow_timeline').execute({ date: '2026-02-30' }, undefined as never),
    (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
  );
});

test('dayflow_activity returns the full write-up', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_activity', { record_id: 1 });
  const card = value as { detailed_summary?: string; title: string };
  assert.equal(card.title, 'Writing the DSH plugin');
  assert.equal(card.detailed_summary, 'A long write-up of the plugin work.');
  assert.match(text, /A long write-up of the plugin work\./);
});

test('dayflow_activity reports an unknown record id', async () => {
  await assert.rejects(
    () => toolNamed(tools, 'dayflow_activity').execute({ record_id: 9999 }, undefined as never),
    (error: unknown) => error instanceof DayflowError && error.code === 'not_found',
  );
});

test('dayflow_breakdown totals a single day without System', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_breakdown', { from: '2026-10-19', to: '2026-10-19' });
  const payload = value as { tracked_minutes: number; categories: { name: string; minutes: number }[] };
  assert.equal(payload.tracked_minutes, 138);
  assert.deepEqual(payload.categories.map((entry) => entry.name), ['Work', 'Personal', 'Idle', 'Distraction']);
  assert.match(text, /138m|2h 18m/);
  assert.match(text, /Work/);
});

test('dayflow_breakdown rejects a reversed range', async () => {
  await assert.rejects(
    () => toolNamed(tools, 'dayflow_breakdown').execute({ from: '2026-10-20', to: '2026-10-19' }, undefined as never),
    (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
  );
});

test('dayflow_search finds matches and refuses an empty query', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_search', { query: 'plugin' });
  const payload = value as { query: string; matches: { record_id: number }[] };
  assert.equal(payload.query, 'plugin');
  assert.deepEqual(payload.matches.map((match) => match.record_id), [1]);
  assert.match(text, /1 match for "plugin"/);

  const wildcard = await runAndRender(tools, 'dayflow_search', { query: '%' });
  assert.deepEqual((wildcard.value as { matches: unknown[] }).matches, []);

  await assert.rejects(
    () => toolNamed(tools, 'dayflow_search').execute({ query: '   ' }, undefined as never),
    (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
  );
});

test('dayflow_search caps its limit at the configured maximum', async () => {
  const { value } = await runAndRender(tools, 'dayflow_search', { query: 'a', limit: 500 });
  assert.ok((value as { matches: unknown[] }).matches.length <= 25);
});

test('dayflow_daily returns the standup and explains a missing one', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_daily', { date: '2026-10-19' });
  const payload = value as DailyPayload;
  assert.deepEqual(payload.highlights, ['Shipped the plugin', 'Wrote tests']);
  assert.equal(payload.blockers, 'None');
  assert.match(text, /Shipped the plugin/);

  await assert.rejects(
    () => toolNamed(tools, 'dayflow_daily').execute({ date: '2026-01-02' }, undefined as never),
    (error: unknown) => error instanceof DayflowError && error.code === 'not_found',
  );
});

test('dayflow_weekly rolls up the week containing a date', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_weekly', { date: '2026-10-19' });
  const payload = value as { tracked_minutes: number; focus_minutes: number; week_start: string };
  assert.equal(payload.tracked_minutes, 158);
  assert.equal(payload.focus_minutes, 138);
  assert.match(payload.week_start, /^2026-10-19T04:00:00/);
  assert.match(text, /focus 2h 18m/);
});

test('dayflow_journal reads the day entry and explains a missing one', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_journal', { date: '2026-10-19' });
  const payload = value as JournalEntryPayload;
  assert.equal(payload.found, true);
  assert.equal(payload.date, '2026-10-19');
  assert.equal(payload.status, 'complete');
  assert.equal(payload.intentions, 'Ship the journal importer.');
  assert.match(text, /Journal · 2026-10-19/);
  assert.match(text, /Status: complete/);
  assert.match(text, /Ship the journal importer\./);

  const missing = await runAndRender(tools, 'dayflow_journal', { date: '2026-01-02' });
  const missingPayload = missing.value as JournalEntryPayload;
  assert.equal(missingPayload.found, false);
  assert.equal(missingPayload.date, '2026-01-02');
  assert.match(missing.text, /Journal · 2026-01-02/);
  assert.doesNotMatch(missing.text, /Status:/);
});

test('dayflow_goals reads the day goal and its categories', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_goals', { date: '2026-10-19' });
  const payload = value as DayGoalPayload;
  assert.equal(payload.found, true);
  assert.equal(payload.focus_minutes, 240);
  assert.equal(payload.distraction_limit_minutes, 60);
  assert.deepEqual(
    payload.focus_categories.map((category) => category.name),
    ['Work', 'Communication'],
  );
  assert.equal(payload.focus_categories[0]?.color_hex, '#6A7EFF');
  assert.deepEqual(
    payload.distraction_categories.map((category) => category.name),
    ['Distraction'],
  );
  assert.match(text, /Goals · 2026-10-19/);
  assert.match(text, /Focus target: 4h/);
  assert.match(text, /Work \(#6A7EFF\)/);

  const skipped = await runAndRender(tools, 'dayflow_goals', { date: '2026-10-20' });
  assert.equal((skipped.value as DayGoalPayload).is_skipped, true);
  assert.match(skipped.text, /Skipped: yes/);

  const missing = await runAndRender(tools, 'dayflow_goals', { date: '2026-01-02' });
  const missingPayload = missing.value as DayGoalPayload;
  assert.equal(missingPayload.found, false);
  assert.deepEqual(missingPayload.focus_categories, []);
  assert.deepEqual(missingPayload.distraction_categories, []);
});

test('dayflow_observations returns the evidence behind an activity', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_observations', { record_id: 1 });
  const payload = value as { record_id: number; observations: ObservationPayload[]; hint: string };
  assert.equal(payload.record_id, 1);
  assert.equal(payload.observations.length, 2);
  assert.deepEqual(
    payload.observations.map((observation) => observation.duration_minutes),
    [7, 17],
  );
  assert.equal(payload.observations[0]?.model, 'deepseek-flash');
  assert.match(text, /#1 · 2 observations/);
  assert.match(text, /09:13–09:20 · 7m · The user writes src\/journal\.ts in Cursor\./);
  assert.match(text, /09:21–09:38 · 17m · The user runs the test suite in a terminal\./);
  assert.match(text, /deepseek-flash/);

  const quiet = await runAndRender(tools, 'dayflow_observations', { record_id: 2 });
  assert.deepEqual((quiet.value as { observations: unknown[] }).observations, []);
  assert.match(quiet.text, /#2 · 0 observations/);

  await assert.rejects(
    () => toolNamed(tools, 'dayflow_observations').execute({ record_id: 9999 }, undefined as never),
    (error: unknown) => error instanceof DayflowError && error.code === 'not_found',
  );
});

test('dayflow_review_ratings returns the day own marks', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_review_ratings', { date: '2026-10-19' });
  const payload = value as { date: string; ratings: ReviewRatingPayload[]; hint: string };
  assert.equal(payload.date, '2026-10-19');
  assert.equal(payload.ratings.length, 3);
  assert.deepEqual(
    payload.ratings.map((rating) => rating.rating),
    ['focused', 'distracted', 'neutral'],
  );
  assert.equal(payload.ratings[0]?.title, 'Writing the DSH plugin');
  assert.equal(payload.ratings[0]?.record_id, 1);
  assert.match(text, /Ratings · 2026-10-19/);
  assert.match(text, /09:12–09:40 · focused · Writing the DSH plugin \(#1\)/);

  const empty = await runAndRender(tools, 'dayflow_review_ratings', { date: '2026-01-02' });
  const emptyPayload = empty.value as { date: string; ratings: ReviewRatingPayload[] };
  assert.equal(emptyPayload.date, '2026-01-02');
  assert.deepEqual(emptyPayload.ratings, []);
  assert.match(empty.text, /Ratings · 2026-01-02/);
});

test('the new day tools reject an impossible date', async () => {
  for (const name of ['dayflow_journal', 'dayflow_goals', 'dayflow_review_ratings']) {
    await assert.rejects(
      () => toolNamed(tools, name).execute({ date: '2026-02-30' }, undefined as never),
      (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
      `${name} rejects 2026-02-30`,
    );
  }
});

test('dayflow_categories reads the injected preferences', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_categories');
  const payload = value as { categories: { name: string; is_idle: boolean }[] };
  assert.deepEqual(payload.categories.map((category) => category.name), ['Work', 'Personal', 'Distraction', 'Idle']);
  assert.equal(payload.categories[3].is_idle, true);
  assert.match(text, /4 categories/);
});

test('dayflow_status reports freshness, backlog, and capability flags', async () => {
  const { value, text } = await runAndRender(tools, 'dayflow_status');
  const payload = value as StatusPayload;
  assert.equal(payload.pending_batches, 1);
  assert.equal(payload.failed_batches, 1);
  assert.equal(payload.edits_enabled, false);
  assert.equal(payload.edit_bridge_listening, false);
  assert.equal(payload.database_path, fixture.path);
  assert.ok(payload.last_capture_at);
  assert.match(text, /last capture/);
  assert.match(text, /Edit bridge: not listening/);
  assert.match(text, /Edits: disabled/);
});

test('dayflow_status guides setup on a machine without Dayflow', async () => {
  const uninstalled = makeRuntime('/nonexistent/dayflow/chunks.sqlite', {
    presence: {
      appInstalled: false,
      running: false,
      cliInstalled: false,
      homebrewInstalled: true,
      caskInstalled: false,
      databasePresent: false,
    },
  });
  const uninstalledTools = toolMap(readTools(uninstalled));
  const { value, text } = await runAndRender(uninstalledTools, 'dayflow_status');
  const payload = value as StatusPayload;

  assert.equal(payload.database_present, false);
  assert.equal(payload.setup?.ready, false);
  assert.deepEqual(
    payload.setup?.missing.map((step) => step.id),
    ['install-app', 'record'],
  );
  assert.match(text, /not set up/);
  assert.match(text, /brew install --cask dayflow/);
});

test('a missing database is reported as no_data', async () => {
  const emptyRuntime = makeRuntime('/nonexistent/dayflow/chunks.sqlite');
  const emptyTools = toolMap(readTools(emptyRuntime));
  await assert.rejects(
    () => toolNamed(emptyTools, 'dayflow_timeline').execute({}, undefined as never),
    (error: unknown) => error instanceof DayflowError && error.code === 'no_data',
  );
});
