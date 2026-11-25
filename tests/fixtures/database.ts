/**
 * A throwaway Dayflow database with a known day, week, standup, and backlog.
 *
 * The schema mirrors the app's real tables closely enough for every query the
 * plugin runs, and the cards exercise the rules that are easy to get wrong:
 * the 4 AM boundary, soft deletes, the System category, and metadata with
 * apps and distractions. The newer tables (`observations`, goals, journal
 * entries, ratings, `llm_calls`, `chat_history`) exist so the importer tests
 * cover every table the owned schema claims. Current Dayflow ranges
 * observations and ratings by timestamps only; those two fixture tables keep a
 * nullable `timeline_card_id` for the card foreign key the importer maps when
 * a source carries one, and for the rows that leave it unset.
 * @module tests/fixtures/database
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** The fixture's main day. */
export const FIXTURE_DAY = '2026-10-19';

/** The fixture's follow-up day. */
export const FIXTURE_NEXT_DAY = '2026-10-20';

/** A fixed "now" two minutes after the newest capture. */
export const FIXTURE_NOW = new Date(2026, 9, 20, 10, 0, 0);

/** Fake credential text in `llm_calls`; it must never reach the owned journal. */
export const FIXTURE_LLM_SECRET = 'sk-fixture-dayflow-secret-token';

/** Fake private chat text in `chat_history`; it must never reach the owned journal. */
export const FIXTURE_PRIVATE_CHAT = 'PRIVATE-CHAT-MARKER';

/** A disposable database on disk. */
export interface FixtureDatabase {
  /** Absolute path to the SQLite file. */
  readonly path: string;
  /** Directory holding the file. */
  readonly directory: string;
  /** Remove the directory and everything in it. */
  cleanup(): void;
}

function dateFrom([year, month, day, hour, minute]: readonly [number, number, number, number, number]): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function epoch(parts: readonly [number, number, number, number, number]): number {
  return Math.floor(dateFrom(parts).getTime() / 1000);
}

function dayKeyOf([year, month, day]: readonly [number, number, number, number, number]): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const SCHEMA = `
  CREATE TABLE analysis_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_start_ts INTEGER NOT NULL,
    batch_end_ts INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    llm_metadata TEXT,
    detailed_transcription TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE timeline_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER REFERENCES analysis_batches(id) ON DELETE CASCADE,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    start_ts INTEGER,
    end_ts INTEGER,
    day DATE NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    category TEXT NOT NULL,
    subcategory TEXT,
    detailed_summary TEXT,
    metadata TEXT,
    video_summary_url TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    idle_seconds_at_capture INTEGER,
    frame_index INTEGER,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE daily_standup_entries (
    standup_day TEXT NOT NULL PRIMARY KEY,
    payload_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- The tables below mirror the app's newer storage. The importer claims all of
  -- them except llm_calls and chat_history, which are deliberately skipped.
  CREATE TABLE observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES analysis_batches(id) ON DELETE CASCADE,
    timeline_card_id INTEGER,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    observation TEXT NOT NULL,
    metadata TEXT,
    llm_model TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE day_goals (
    day TEXT NOT NULL PRIMARY KEY,
    focus_target_minutes INTEGER NOT NULL,
    distraction_limit_minutes INTEGER NOT NULL,
    is_skipped INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE day_goal_categories (
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('focus', 'distraction')),
    category_id TEXT NOT NULL,
    category_name TEXT NOT NULL,
    category_color_hex TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (day, kind, category_id)
  );

  CREATE TABLE timeline_review_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timeline_card_id INTEGER,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    rating TEXT NOT NULL
  );

  CREATE TABLE journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL UNIQUE,
    intentions TEXT,
    notes TEXT,
    goals TEXT,
    reflections TEXT,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    batch_id INTEGER NULL,
    call_group_id TEXT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    model TEXT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'failure')),
    latency_ms INTEGER NULL,
    http_status INTEGER NULL,
    request_method TEXT NULL,
    request_url TEXT NULL,
    request_headers TEXT NULL,
    request_body TEXT NULL,
    response_headers TEXT NULL,
    response_body TEXT NULL,
    error_domain TEXT NULL,
    error_code INTEGER NULL,
    error_message TEXT NULL
  );

  CREATE TABLE chat_history (
    id TEXT NOT NULL PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    sort_order INTEGER NOT NULL
  );
`;

interface CardSeed {
  readonly start: [number, number, number, number, number];
  readonly end: [number, number, number, number, number];
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly subcategory?: string;
  readonly detailed?: string;
  readonly metadata?: unknown;
  readonly deleted?: boolean;
}

/** Oct 19 2026 cards, plus the 3:30 AM card that belongs to Oct 19, and Oct 20. */
const CARDS: readonly CardSeed[] = [
  {
    start: [2026, 10, 19, 9, 12],
    end: [2026, 10, 19, 9, 40],
    title: 'Writing the DSH plugin',
    summary: 'Implemented the Dayflow read tools',
    category: 'Work',
    subcategory: 'coding',
    detailed: 'A long write-up of the plugin work.',
    metadata: {
      appSites: { primary: 'Cursor', secondary: 'Google Chrome' },
      distractions: [{ title: 'X' }, { title: 'YouTube' }],
    },
  },
  { start: [2026, 10, 19, 10, 0], end: [2026, 10, 19, 10, 30], title: 'Team standup', summary: 'Daily sync', category: 'Work' },
  // Personal time is still a screen activity: the fixture never claims the user
  // went anywhere, because nothing in this data could support that.
  { start: [2026, 10, 19, 11, 0], end: [2026, 10, 19, 11, 30], title: 'Ordering groceries', summary: 'A shopping tab', category: 'Personal' },
  { start: [2026, 10, 19, 12, 0], end: [2026, 10, 19, 12, 15], title: 'YouTube break', summary: 'Watched a video', category: 'Distraction' },
  { start: [2026, 10, 19, 13, 0], end: [2026, 10, 19, 13, 20], title: 'No screen activity', summary: 'Nothing was captured', category: 'Idle' },
  { start: [2026, 10, 19, 14, 0], end: [2026, 10, 19, 14, 5], title: 'System update', summary: 'Background work', category: 'System' },
  {
    start: [2026, 10, 19, 15, 0],
    end: [2026, 10, 19, 15, 30],
    title: 'Deleted card',
    summary: 'Should never be read',
    category: 'Work',
    deleted: true,
  },
  {
    start: [2026, 10, 20, 3, 30],
    end: [2026, 10, 20, 3, 45],
    title: 'Late night fix',
    summary: 'Fixed the 4 AM boundary',
    category: 'Work',
  },
  { start: [2026, 10, 20, 9, 0], end: [2026, 10, 20, 9, 20], title: 'Another day', summary: 'Next day work', category: 'Work' },
];

const STANDUP = {
  highlightsTitle: 'Highlights',
  highlights: [{ text: 'Shipped the plugin' }, { text: 'Wrote tests' }],
  tasksTitle: 'Tasks',
  tasks: [{ text: 'Publish the package' }],
  blockersTitle: 'Blockers',
  blockersBody: 'None',
};

type TimeParts = readonly [number, number, number, number, number];

interface ObservationSeed {
  readonly batch: number;
  readonly card?: number;
  readonly start: TimeParts;
  readonly end: TimeParts;
  readonly text: string;
  readonly metadata?: unknown;
}

/** Per-observation evidence: two behind the coding card, one on the next day, one range-only. */
const OBSERVATIONS: readonly ObservationSeed[] = [
  {
    batch: 3,
    card: 1,
    start: [2026, 10, 19, 9, 13],
    end: [2026, 10, 19, 9, 20],
    text: 'The user writes src/journal.ts in Cursor.',
    metadata: { app: 'Cursor' },
  },
  {
    batch: 3,
    card: 1,
    start: [2026, 10, 19, 9, 21],
    end: [2026, 10, 19, 9, 38],
    text: 'The user runs the test suite in a terminal.',
    metadata: { app: 'Terminal' },
  },
  {
    batch: 1,
    card: 9,
    start: [2026, 10, 20, 9, 5],
    end: [2026, 10, 20, 9, 15],
    text: 'The user reviews the next day plan in a notes app.',
  },
  {
    batch: 2,
    start: [2026, 10, 20, 3, 31],
    end: [2026, 10, 20, 3, 35],
    text: 'The screen shows a crash log before any card was written.',
  },
];

interface DayGoalSeed {
  readonly day: string;
  readonly focusMinutes: number;
  readonly distractionMinutes: number;
  readonly skipped: boolean;
}

/** Goals for both fixture days; the follow-up day's goal was skipped. */
const DAY_GOALS: readonly DayGoalSeed[] = [
  { day: FIXTURE_DAY, focusMinutes: 240, distractionMinutes: 60, skipped: false },
  { day: FIXTURE_NEXT_DAY, focusMinutes: 180, distractionMinutes: 90, skipped: true },
];

interface GoalCategorySeed {
  readonly day: string;
  readonly kind: 'focus' | 'distraction';
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly order: number;
}

const DAY_GOAL_CATEGORIES: readonly GoalCategorySeed[] = [
  { day: FIXTURE_DAY, kind: 'focus', id: 'A1000000-0000-4000-8000-000000000001', name: 'Work', color: '#6A7EFF', order: 0 },
  { day: FIXTURE_DAY, kind: 'focus', id: 'A1000000-0000-4000-8000-000000000002', name: 'Communication', color: '#FFAE8C', order: 1 },
  { day: FIXTURE_DAY, kind: 'distraction', id: 'A1000000-0000-4000-8000-000000000003', name: 'Distraction', color: '#FF6B6B', order: 0 },
  { day: FIXTURE_NEXT_DAY, kind: 'focus', id: 'A1000000-0000-4000-8000-000000000001', name: 'Work', color: '#6A7EFF', order: 0 },
];

interface RatingSeed {
  readonly card?: number;
  readonly start: TimeParts;
  readonly end: TimeParts;
  readonly rating: string;
}

/** The user's own focused/distracted marks; one is range-only like the app's rows. */
const TIMELINE_REVIEW_RATINGS: readonly RatingSeed[] = [
  { card: 1, start: [2026, 10, 19, 9, 12], end: [2026, 10, 19, 9, 40], rating: 'focused' },
  { card: 4, start: [2026, 10, 19, 12, 0], end: [2026, 10, 19, 12, 15], rating: 'distracted' },
  { start: [2026, 10, 19, 13, 0], end: [2026, 10, 19, 13, 20], rating: 'neutral' },
];

interface JournalEntrySeed {
  readonly day: string;
  readonly intentions: string | null;
  readonly notes: string | null;
  readonly goals: string | null;
  readonly reflections: string | null;
  readonly summary: string | null;
  readonly status: string;
}

const JOURNAL_ENTRIES: readonly JournalEntrySeed[] = [
  {
    day: FIXTURE_DAY,
    intentions: 'Ship the journal importer.',
    notes: 'Reviewed the roadmap before coding.',
    goals: 'Finish Phase 2.',
    reflections: 'The source fixture was the slow part.',
    summary: 'A focused build day.',
    status: 'complete',
  },
  {
    day: FIXTURE_NEXT_DAY,
    intentions: null,
    notes: 'A short day after the late fix.',
    goals: null,
    reflections: null,
    summary: 'Mostly meetings.',
    status: 'draft',
  },
];

/**
 * Create a disposable database seeded with the fixture.
 * @returns the database handle.
 */
export function createFixtureDatabase(): FixtureDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-test-'));
  const path = join(directory, 'chunks.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(SCHEMA);

    const insertCard = db.prepare(
      `INSERT INTO timeline_cards
         (start, end, start_ts, end_ts, day, title, summary, category, subcategory, detailed_summary, metadata, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const card of CARDS) {
      const start = dateFrom(card.start);
      const end = dateFrom(card.end);
      insertCard.run(
        start.toISOString(),
        end.toISOString(),
        epoch(card.start),
        epoch(card.end),
        dayKeyOf(card.start),
        card.title,
        card.summary,
        card.category,
        card.subcategory ?? null,
        card.detailed ?? null,
        card.metadata === undefined ? null : JSON.stringify(card.metadata),
        card.deleted === true ? 1 : 0,
      );
    }

    db.prepare(
      `INSERT INTO analysis_batches (batch_start_ts, batch_end_ts, status)
       VALUES (?, ?, 'pending'), (?, ?, 'failed:llm'), (?, ?, 'complete')`,
    ).run(
      epoch([2026, 10, 20, 9, 0]),
      epoch([2026, 10, 20, 9, 30]),
      epoch([2026, 10, 20, 8, 0]),
      epoch([2026, 10, 20, 8, 30]),
      epoch([2026, 10, 20, 7, 0]),
      epoch([2026, 10, 20, 7, 30]),
    );

    const insertScreenshot = db.prepare(
      'INSERT INTO screenshots (captured_at, file_path, is_deleted) VALUES (?, ?, ?)',
    );
    // Oct 17: captured but no activities — a quiet day, not a missing one.
    insertScreenshot.run(epoch([2026, 10, 17, 10, 0]), '/tmp/frame-17.jpg', 0);
    // Oct 19: the main day.
    insertScreenshot.run(epoch([2026, 10, 19, 9, 0]), '/tmp/frame-19a.jpg', 0);
    insertScreenshot.run(epoch([2026, 10, 19, 12, 0]), '/tmp/frame-19b.jpg', 0);
    insertScreenshot.run(epoch([2026, 10, 19, 15, 0]), '/tmp/frame-19c.jpg', 0);
    // Oct 20: the follow-up day.
    insertScreenshot.run(epoch([2026, 10, 20, 9, 58]), '/tmp/frame-1.jpg', 0);
    insertScreenshot.run(epoch([2026, 10, 20, 9, 59]), '/tmp/frame-2.jpg', 0);
    insertScreenshot.run(epoch([2026, 10, 20, 9, 59]), '/tmp/frame-3.jpg', 1);

    db.prepare('INSERT INTO daily_standup_entries (standup_day, payload_json) VALUES (?, ?)').run(
      FIXTURE_DAY,
      JSON.stringify(STANDUP),
    );

    const insertObservation = db.prepare(
      `INSERT INTO observations (batch_id, timeline_card_id, start_ts, end_ts, observation, metadata, llm_model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const observation of OBSERVATIONS) {
      insertObservation.run(
        observation.batch,
        observation.card ?? null,
        epoch(observation.start),
        epoch(observation.end),
        observation.text,
        observation.metadata === undefined ? null : JSON.stringify(observation.metadata),
        'deepseek-flash',
      );
    }

    const insertGoal = db.prepare(
      `INSERT INTO day_goals (day, focus_target_minutes, distraction_limit_minutes, is_skipped, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const goal of DAY_GOALS) {
      const createdAt = Math.floor(new Date(`${goal.day}T09:00:00`).getTime() / 1000);
      insertGoal.run(goal.day, goal.focusMinutes, goal.distractionMinutes, goal.skipped ? 1 : 0, createdAt, createdAt);
    }

    const insertGoalCategory = db.prepare(
      `INSERT INTO day_goal_categories (day, kind, category_id, category_name, category_color_hex, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const category of DAY_GOAL_CATEGORIES) {
      insertGoalCategory.run(category.day, category.kind, category.id, category.name, category.color, category.order);
    }

    const insertRating = db.prepare(
      'INSERT INTO timeline_review_ratings (timeline_card_id, start_ts, end_ts, rating) VALUES (?, ?, ?, ?)',
    );
    for (const rating of TIMELINE_REVIEW_RATINGS) {
      insertRating.run(rating.card ?? null, epoch(rating.start), epoch(rating.end), rating.rating);
    }

    const insertJournalEntry = db.prepare(
      `INSERT INTO journal_entries (day, intentions, notes, goals, reflections, summary, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const entry of JOURNAL_ENTRIES) {
      insertJournalEntry.run(
        entry.day,
        entry.intentions,
        entry.notes,
        entry.goals,
        entry.reflections,
        entry.summary,
        entry.status,
      );
    }

    // Private provider traffic: the importer must skip these tables wholesale.
    const insertLlmCall = db.prepare(
      `INSERT INTO llm_calls
         (created_at, batch_id, call_group_id, attempt, provider, model, operation, status, latency_ms,
          http_status, request_method, request_url, request_headers, request_body, response_body,
          error_domain, error_code, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertLlmCall.run(
      '2026-10-19 09:13:05', 3, 'B0000000-0000-4000-8000-000000000001', 1, 'custom', 'deepseek-flash',
      'describe_frame', 'success', 2373, 200, 'POST', 'https://api.deepseek.com/v1/chat/completions',
      JSON.stringify({ Authorization: `Bearer ${FIXTURE_LLM_SECRET}` }),
      JSON.stringify({ model: 'deepseek-flash' }),
      JSON.stringify({ choices: [{ message: { content: 'The user writes code.' } }] }),
      null, null, null,
    );
    insertLlmCall.run(
      '2026-10-20 08:15:00', 2, 'B0000000-0000-4000-8000-000000000002', 2, 'custom', 'deepseek-flash',
      'summarize_batch', 'failure', 9000, 429, 'POST', 'https://api.deepseek.com/v1/chat/completions',
      JSON.stringify({ Authorization: `Bearer ${FIXTURE_LLM_SECRET}` }), null, null,
      'rate_limit', 429, 'Provider rate limit reached; retry after 60s.',
    );

    const insertChat = db.prepare(
      'INSERT INTO chat_history (id, conversation_id, role, content, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertChat.run(
      'C0000000-0000-4000-8000-000000000001',
      'CONV-1',
      'user',
      `Remember ${FIXTURE_PRIVATE_CHAT}: my private plan.`,
      epoch([2026, 10, 19, 9, 5]),
      0,
    );
    insertChat.run(
      'C0000000-0000-4000-8000-000000000002',
      'CONV-1',
      'assistant',
      `Noted. ${FIXTURE_PRIVATE_CHAT} stays local.`,
      epoch([2026, 10, 19, 9, 5]),
      1,
    );
  } finally {
    db.close();
  }

  return {
    path,
    directory,
    cleanup(): void {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
