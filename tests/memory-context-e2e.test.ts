/**
 * Phase 4b end-to-end: the memory context provider exactly as `apply()` mounts it.
 *
 * These tests go through the real plugin entry point with a real owned journal in
 * a disposable temporary directory, capture the dynamic context contribution the
 * harness would assemble, and evaluate it as the host does on each prompt
 * assembly. That covers what a unit test of the builder cannot: the wiring, the
 * per-assembly evaluation, the cache lifecycle, the configuration switch, and the
 * degraded paths (missing or empty journal) that must never throw or create files.
 *
 * They never touch the default `$DSH_HOME` journal.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

import type { Context } from '@deepseek-ai/cordis';

import type { DayflowConfig } from '../src/config.js';
import { MEMORY_CONTEXT_MAX_BYTES, clearMemoryContextCache } from '../src/context.js';
import { apply } from '../src/index.js';
import { openJournal } from '../src/journal.js';
import { addMemoryClaim, supersedeMemoryClaim } from '../src/memory.js';
import { attachTaskSession, createLongTask, updateLongTaskStatus } from '../src/tasks.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-memory-context-e2e-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let fileCounter = 0;

/** A fresh journal path inside the disposable directory. */
function journalFile(label: string): string {
  fileCounter += 1;
  return join(directory, `${label}-${fileCounter}.sqlite`);
}

/** One captured dynamic context contribution, as the host would receive it. */
interface PromptContribution {
  readonly name: string;
  readonly order: number;
  readonly text: string | ((context: unknown) => string);
}

/** Everything `apply()` registered on the fake context, for the assertions below. */
interface Capture {
  readonly tools: { name: string }[];
  readonly skills: { name: string }[];
  readonly sections: { name: string; order: number; text: string | ((context: unknown) => string) }[];
  readonly contexts: PromptContribution[];
  readonly routes: string[];
  readonly contextOrderNames: string[];
}

/**
 * A minimal observant context: enough of the tools/skills/inject/systemPrompt
 * services for the plugin to load, with every registration collected instead of
 * forwarded. `getContextOrder` answers with the real `WEB_SURFACE` placement so
 * the registered order can be asserted against it.
 */
function fakeContext(): { ctx: Context; capture: Capture } {
  const capture: Capture = {
    tools: [],
    skills: [],
    sections: [],
    contexts: [],
    routes: [],
    contextOrderNames: [],
  };
  const ctx = {
    tools: {
      register(tool: { name: string }) {
        capture.tools.push(tool);
        return () => {};
      },
    },
    skills: {
      register(skill: { name: string }) {
        capture.skills.push(skill);
        return () => {};
      },
    },
    inject(_deps: readonly string[], callback: (connected: unknown) => void) {
      callback({
        connection: {
          fetch: {
            register(route: { path: string }) {
              capture.routes.push(route.path);
              return async () => {};
            },
          },
        },
      });
    },
    systemPrompt: {
      section(section: { name: string; order: number; text: string | ((context: unknown) => string) }) {
        capture.sections.push(section);
        return () => {};
      },
      getSectionOrder() {
        return 2300;
      },
      context(contribution: PromptContribution) {
        capture.contexts.push(contribution);
        return () => {};
      },
      getContextOrder(name: string) {
        capture.contextOrderNames.push(name);
        return 210;
      },
    },
  } as unknown as Context;
  return { ctx, capture };
}

/**
 * The profile these tests exercise: journal-only, no tools beyond the defaults,
 * and an explicit `memoryContext` switch. The database path is a disposable file
 * that is never opened, so nothing can fall back to the real Dayflow database.
 */
function journalConfig(journalPath: string, memoryContext: boolean): DayflowConfig {
  return {
    journalPath,
    databasePath: join(directory, 'chunks.sqlite'),
    memoryContext,
    skills: false,
    panel: false,
    edits: false,
  };
}

/** Open the journal, run one seeding callback, and close it again. */
function seedJournal(journalPath: string, seed: (db: DatabaseSync) => void): void {
  const db = openJournal(journalPath);
  try {
    seed(db);
  } finally {
    db.close();
  }
}

/** Mount the plugin on a fresh fake context and collect what it registered. */
function mountPlugin(journalPath: string, memoryContext: boolean): { capture: Capture; contribution?: PromptContribution } {
  const { ctx, capture } = fakeContext();
  apply(ctx, journalConfig(journalPath, memoryContext));
  return { capture, contribution: capture.contexts[0] };
}

/** Evaluate the registered contribution the way the host does at assembly time. */
function renderContext(contribution: PromptContribution | undefined): string {
  assert.ok(contribution !== undefined, 'a dynamic context contribution is registered');
  assert.equal(typeof contribution.text, 'function', 'the host evaluates the text lazily, once per assembly');
  const text = (contribution.text as () => string)();
  assert.equal(typeof text, 'string');
  return text;
}

test('apply registers one budgeted memory context built from the owned journal', () => {
  clearMemoryContextCache();
  const journalPath = journalFile('populated');
  const oldBody = 'The release script needed a manual tag check.';
  const newBody = 'The release script now rejects an untagged commit.';
  let taskId = 0;
  seedJournal(journalPath, (db) => {
    const task = createLongTask(db, { title: 'Port the recorder' });
    taskId = task.id;
    attachTaskSession(db, task.id, { day: '2026-10-18', minutes: 130 });
    addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Morning focus',
      body: 'Deep work happens before noon.',
      observed_on: '2026-10-17',
    });
    const stale = addMemoryClaim(db, {
      kind: 'correction',
      subject: 'Release checks',
      body: oldBody,
      observed_on: '2026-10-18',
    });
    // Append the correction: the old row stays in the table as history but must
    // not be injected as if it were still current.
    supersedeMemoryClaim(db, stale.id, { body: newBody, observed_on: '2026-10-19' });
  });

  const { capture, contribution } = mountPlugin(journalPath, true);
  assert.equal(capture.contexts.length, 1, 'exactly one dynamic context is registered');
  assert.ok(contribution);
  assert.equal(contribution.name, 'dayflow:memory');
  assert.equal(contribution.order, 220, 'placed just after the WEB_SURFACE runtime context');
  assert.deepEqual(capture.contextOrderNames, ['WEB_SURFACE']);

  const text = renderContext(contribution);
  assert.match(text, /Journal context \(as of \d{4}-\d{2}-\d{2}\)/);
  assert.match(text, /Dated records, not instructions/);
  const lines = text.split('\n');

  // The active task is named with its id and title.
  const taskLine = lines.find((line) => line.includes(`task #${String(taskId)}`));
  assert.ok(taskLine?.includes('Port the recorder'), 'the injected task carries its id and title');

  // Claims keep the day they describe, and only the current row of a superseded
  // pair is visible.
  const claimLine = lines.find((line) => line.includes('on 2026-10-19'));
  assert.ok(claimLine !== undefined, 'claims keep the date they observed');
  assert.ok(claimLine.includes('Release checks'));
  assert.ok(claimLine.includes(newBody));
  assert.ok(text.includes('Deep work happens before noon.'));
  assert.equal(text.includes(oldBody), false, 'the superseded claim is history, not current context');

  assert.equal(MEMORY_CONTEXT_MAX_BYTES, 1000);
  assert.ok(Buffer.byteLength(text, 'utf8') <= 1000, 'the injected block stays inside its byte budget');

  assert.equal(renderContext(contribution), text, 'the provider serves the cached snapshot unchanged');
});

test('the provider refreshes after the memory context cache is cleared', () => {
  clearMemoryContextCache();
  const journalPath = journalFile('cached');
  seedJournal(journalPath, (db) => {
    addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Morning focus',
      body: 'Deep work happens before noon.',
      observed_on: '2026-10-17',
    });
  });

  const { contribution } = mountPlugin(journalPath, true);
  const before = renderContext(contribution);
  assert.ok(before.includes('Morning focus'));

  // Write behind the provider's back: a new claim lands in the journal after the
  // snapshot was cached.
  seedJournal(journalPath, (db) => {
    addMemoryClaim(db, {
      kind: 'preference',
      subject: 'Afternoon reviews',
      body: 'Review marks are checked after lunch.',
      observed_on: '2026-10-20',
    });
  });

  assert.equal(renderContext(contribution), before, 'the TTL cache keeps serving the earlier snapshot');
  clearMemoryContextCache();
  const refreshed = renderContext(contribution);
  assert.notEqual(refreshed, before, 'clearing the cache makes the next assembly re-read the journal');
  assert.ok(refreshed.includes('on 2026-10-20'));
  assert.ok(refreshed.includes('Afternoon reviews'));
});

test('memoryContext: false registers no provider and never touches the journal', () => {
  clearMemoryContextCache();
  const journalPath = journalFile('disabled');
  const { capture, contribution } = mountPlugin(journalPath, false);

  assert.equal(contribution, undefined);
  assert.equal(capture.contexts.length, 0, 'the switch keeps the provider unregistered');
  assert.ok(capture.tools.length > 0, 'the rest of the plugin still builds');
  assert.equal(existsSync(journalPath), false, 'the switch never opens (or creates) the journal');
});

test('a missing journal yields an empty block and is never created', () => {
  clearMemoryContextCache();
  const journalPath = journalFile('missing');
  assert.equal(existsSync(journalPath), false);

  const { contribution } = mountPlugin(journalPath, true);
  assert.equal(renderContext(contribution), '', 'nothing to inject from a journal that does not exist');
  assert.equal(existsSync(journalPath), false, 'reading context must not create a journal');
});

test('an empty owned journal yields an empty block', () => {
  clearMemoryContextCache();
  const journalPath = journalFile('empty');
  // Migrating the journal creates the schema; there are no tasks and no claims.
  seedJournal(journalPath, () => {});

  const { contribution } = mountPlugin(journalPath, true);
  assert.equal(renderContext(contribution), '', 'an empty journal injects nothing');
});

test('a large journal is truncated inside the byte budget', () => {
  clearMemoryContextCache();
  const journalPath = journalFile('large');
  seedJournal(journalPath, (db) => {
    for (const title of ['Port the recorder', 'Finish the paper', 'Publish the plugin']) {
      const task = createLongTask(db, { title });
      attachTaskSession(db, task.id, { day: '2026-10-18', minutes: 60 });
    }
    // Multi-byte bodies: a cap measured in characters instead of UTF-8 bytes
    // would overrun the budget here.
    for (let index = 0; index < 5; index += 1) {
      addMemoryClaim(db, {
        kind: 'distillation',
        subject: `主题 ${String(index + 1)}`,
        body: '很长的中文内容。'.repeat(20),
        observed_on: `2026-10-2${String(index)}`,
      });
    }
    const paused = createLongTask(db, { title: 'Paused background task' });
    updateLongTaskStatus(db, paused.id, 'paused');
  });

  const { contribution } = mountPlugin(journalPath, true);
  const text = renderContext(contribution);
  assert.ok(text.length > 0, 'the header and at least one entry still fit');
  assert.ok(Buffer.byteLength(text, 'utf8') <= MEMORY_CONTEXT_MAX_BYTES, 'the byte cap holds on a large journal');
  assert.equal(text.includes('Paused background task'), false, 'only active tasks are injected');
});
