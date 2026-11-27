/**
 * Human slash commands: what `registerCommands` registers and how each handler
 * captures into the owned journal.
 *
 * The handlers are called directly, the way the host's command loop would call
 * them, so these tests cover the whole path from raw input to stored row. Every
 * journal is disposable; the default `$DSH_HOME` journal is never touched.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { DAYFLOW_COMMAND_NAMES, registerCommands } from '../src/commands.js';
import type { CommandOptions, CommandRegistration } from '../src/commands.js';
import { dayWindowContaining } from '../src/day.js';
import { withJournal } from '../src/journal.js';
import { listMemoryClaims } from '../src/memory.js';
import { getReflection, listReflections } from '../src/reflections.js';
import { listLongTasks } from '../src/tasks.js';
import { makeRuntime } from './helpers.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-commands-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let fileCounter = 0;

/** A fresh journal path inside the disposable directory. */
function journalFile(label: string): string {
  fileCounter += 1;
  return join(directory, `${label}-${fileCounter}.sqlite`);
}

/** One handler result, as the host would display it. */
type CommandOutcome = { kind: 'success'; text: string } | { kind: 'error'; text: string };

/** One registration, captured exactly as the plugin handed it to the host. */
interface CapturedCommand {
  name: string;
  description: string;
  input?: { hint: string };
  handler: (invocation: { rawInput: string; signal: AbortSignal }) => CommandOutcome | Promise<CommandOutcome>;
}

interface Harness {
  readonly commands: readonly CapturedCommand[];
  readonly disposers: readonly (() => void)[];
  readonly journalPath: string;
  run(name: string, rawInput: string): CommandOutcome;
  runAsync(name: string, rawInput: string): Promise<CommandOutcome>;
}

/**
 * Register the commands against a fake host registry and return a runner.
 * @param journalPath - the owned journal these commands should write.
 * @param options - composition callbacks, such as the analysis runner.
 * @returns the captured registrations and a runner that invokes one handler.
 */
function harness(journalPath: string, options: CommandOptions = {}): Harness {
  const commands: CapturedCommand[] = [];
  const disposers: (() => void)[] = [];
  const registry: CommandRegistration = {
    register(definition) {
      commands.push(definition);
      const dispose = (): void => {};
      disposers.push(dispose);
      return dispose;
    },
  };
  // The source database is never opened by these commands, only the journal.
  const runtime = makeRuntime(join(directory, 'unused-source.sqlite'), { journalPath });
  registerCommands({ commands: registry }, runtime, options);
  const find = (name: string): CapturedCommand => {
    const command = commands.find((entry) => entry.name === name);
    assert.ok(command, `command ${name} is registered`);
    return command;
  };
  return {
    commands,
    disposers,
    journalPath,
    run(name, rawInput) {
      // Every capture command is synchronous; a promise here is a test bug.
      return find(name).handler({ rawInput, signal: new AbortController().signal }) as CommandOutcome;
    },
    async runAsync(name, rawInput) {
      return await find(name).handler({ rawInput, signal: new AbortController().signal });
    },
  };
}

test('registerCommands registers the four human commands', () => {
  const commands = harness(journalFile('register'));
  assert.deepEqual(
    commands.commands.map((command) => command.name),
    [...DAYFLOW_COMMAND_NAMES],
  );
  for (const command of commands.commands) {
    assert.ok(command.description.length > 0, `${command.name} has a description`);
    assert.equal(typeof command.handler, 'function', `${command.name} has a handler`);
  }
  // The three capture commands take input; the analysis trigger takes none.
  for (const name of ['dayflow-task', 'dayflow-remember', 'dayflow-reflect']) {
    const command = commands.commands.find((entry) => entry.name === name);
    assert.ok(command, `${name} is registered`);
    assert.ok(command.input !== undefined, `${name} declares an input hint`);
    assert.ok(command.input.hint.length > 0, `${name} has a usable input hint`);
  }
  const analyse = commands.commands.find((command) => command.name === 'dayflow-analyze');
  assert.ok(analyse, 'dayflow-analyze is registered');
  assert.equal(analyse.input, undefined, 'the analysis trigger has no input hint');
  assert.equal(
    analyse.description,
    'Run one manual analysis tick for the current Dayflow day (same consent gates as the worker).',
  );
  assert.equal(commands.disposers.length, 4, 'each registration returns a disposer');
  for (const dispose of commands.disposers) {
    assert.equal(typeof dispose, 'function');
    assert.doesNotThrow(dispose);
  }
  assert.deepEqual([...DAYFLOW_COMMAND_NAMES], [
    'dayflow-task',
    'dayflow-remember',
    'dayflow-reflect',
    'dayflow-analyze',
  ]);
});

test('dayflow-analyze maps the injected runner and never throws without one', async () => {
  const unavailable = await harness(journalFile('analyze-unavailable')).runAsync('dayflow-analyze', '');
  assert.equal(unavailable.kind, 'error');
  assert.equal(unavailable.text, 'analysis is not enabled or the model service is unavailable');

  const succeeded = await harness(journalFile('analyze-ok'), {
    runAnalysis: async () => ({ ok: true, text: '2026-11-20: 1/1 window(s) analysed · 1 card(s) written' }),
  }).runAsync('dayflow-analyze', '');
  assert.deepEqual(succeeded, {
    kind: 'success',
    text: '2026-11-20: 1/1 window(s) analysed · 1 card(s) written',
  });

  const refused = await harness(journalFile('analyze-gated'), {
    runAnalysis: async () => ({ ok: false, text: '2026-11-20: blocked by consent:none' }),
  }).runAsync('dayflow-analyze', '');
  assert.deepEqual(refused, { kind: 'error', text: '2026-11-20: blocked by consent:none' });

  const rejected = await harness(journalFile('analyze-rejected'), {
    runAnalysis: async () => {
      throw new Error('the analysis journal is unreadable');
    },
  }).runAsync('dayflow-analyze', '');
  assert.deepEqual(rejected, { kind: 'error', text: 'the analysis journal is unreadable' });
});

test('dayflow-task rejects blank input without opening the journal and stores a user task', () => {
  const path = journalFile('task');
  const { run } = harness(path);

  for (const blank of ['', '   ', '\n\t ']) {
    const refused = run('dayflow-task', blank);
    assert.equal(refused.kind, 'error');
    assert.equal(refused.text, 'Usage: /dayflow-task <title>');
  }
  assert.equal(existsSync(path), false, 'a blank capture never creates the journal');

  const added = run('dayflow-task', '  Ship the slash commands  ');
  assert.equal(added.kind, 'success');
  const match = /^Added long task #(\d+): Ship the slash commands$/.exec(added.text);
  assert.ok(match, `unexpected success text: ${added.text}`);
  const id = Number(match[1]);
  assert.ok(Number.isSafeInteger(id), 'the success text carries the new task id');

  const tasks = withJournal(path, (db) => listLongTasks(db));
  assert.equal(tasks.length, 1);
  const task = tasks[0];
  assert.ok(task);
  assert.equal(task.id, id);
  assert.equal(task.title, 'Ship the slash commands', 'the title is trimmed');
  assert.equal(task.origin, 'user', 'a slash command creates a task the user owns');
  assert.equal(task.status, 'active');
});

test('dayflow-remember stamps the current Dayflow day and the preference kind', () => {
  const path = journalFile('remember');
  const { run } = harness(path);

  const refused = run('dayflow-remember', ' \n ');
  assert.equal(refused.kind, 'error');
  assert.equal(refused.text, 'Usage: /dayflow-remember <claim>');
  assert.equal(existsSync(path), false);

  const claimText = 'I usually start Mondays with the weekly review.';
  const remembered = run('dayflow-remember', `  ${claimText}  `);
  assert.equal(remembered.kind, 'success');
  assert.match(remembered.text, /^Remembered #\d+ · /);
  const today = dayWindowContaining(new Date()).dayKey;
  assert.ok(
    remembered.text.includes(`(observed ${today})`),
    `the success text names the current Dayflow day: ${remembered.text}`,
  );

  const claims = withJournal(path, (db) => listMemoryClaims(db));
  assert.equal(claims.length, 1);
  const claim = claims[0];
  assert.ok(claim);
  assert.equal(claim.kind, 'preference');
  assert.equal(claim.subject, claimText, 'a short claim is its own subject');
  assert.equal(claim.body, claimText, 'the body keeps the captured text verbatim');
  // The Dayflow day, not the calendar date: before 4 AM the two differ.
  assert.equal(claim.observed_on, dayWindowContaining(new Date()).dayKey);
  assert.deepEqual(claim.source_days, [claim.observed_on]);
  assert.equal(claim.confidence, 0.7);
});

test('dayflow-remember elides a long subject but keeps the whole body', () => {
  const path = journalFile('remember-long');
  const { run } = harness(path);

  const text = `I want a very long reminder about how the weekly review should start ${'x'.repeat(40)}`;
  assert.ok(text.length > 60);
  const remembered = run('dayflow-remember', text);
  assert.equal(remembered.kind, 'success');

  const claims = withJournal(path, (db) => listMemoryClaims(db));
  const claim = claims[0];
  assert.ok(claim);
  assert.equal(claim.body, text);
  assert.equal(claim.subject, `${text.slice(0, 60)}…`, 'the subject is the first 60 characters plus an ellipsis');
  assert.ok(claim.subject.endsWith('…'));
  assert.ok(claim.subject.length <= 61);
});

test('dayflow-reflect creates today\'s reflection and then appends to it', () => {
  const path = journalFile('reflect');
  const { run } = harness(path);

  for (const blank of ['', '   ']) {
    const refused = run('dayflow-reflect', blank);
    assert.equal(refused.kind, 'error');
    assert.equal(refused.text, 'Usage: /dayflow-reflect <text>');
  }
  assert.equal(existsSync(path), false, 'a blank capture never creates the journal');

  const first = run('dayflow-reflect', '  First line.  ');
  assert.equal(first.kind, 'success');
  assert.equal(first.text, "Saved today's reflection (11 chars)");

  const second = run('dayflow-reflect', 'Second line.');
  assert.equal(second.kind, 'success');
  assert.equal(second.text, "Saved today's reflection (24 chars)");

  const today = dayWindowContaining(new Date()).dayKey;
  const reflections = withJournal(path, (db) => listReflections(db, { kind: 'day' }));
  assert.equal(reflections.length, 1, 'both captures land in one day reflection');
  const reflection = reflections[0];
  assert.ok(reflection);
  assert.equal(reflection.kind, 'day');
  assert.equal(reflection.period_key, today, 'the period is the current Dayflow day');
  assert.equal(reflection.body, 'First line.\nSecond line.', 'the second capture appends a new line');
  assert.deepEqual(reflection.source_days, [today]);

  const stored = withJournal(path, (db) => getReflection(db, 'day', today));
  assert.equal(stored?.id, reflection.id);
});

test('dayflow-reflect reports an over-long reflection as an error instead of throwing', () => {
  const path = journalFile('reflect-overflow');
  const { run } = harness(path);

  // Exactly at the store's bound: accepted. Appending one more line overflows it.
  assert.equal(run('dayflow-reflect', 'a'.repeat(3999)).kind, 'success');
  const refused = run('dayflow-reflect', 'b');
  assert.equal(refused.kind, 'error');
  assert.match(refused.text, /4000/);

  const today = dayWindowContaining(new Date()).dayKey;
  const stored = withJournal(path, (db) => getReflection(db, 'day', today));
  assert.equal(stored?.body.length, 3999, 'the refused append leaves the stored reflection unchanged');
});

test('an unwritable journal becomes an error result, not a thrown exception', () => {
  // A directory named like a database file: opening it as SQLite fails.
  const blocked = join(directory, 'blocked-journal.sqlite');
  mkdirSync(blocked, { recursive: true });
  const { run } = harness(blocked);

  const attempts = [
    run('dayflow-task', 'Note this task'),
    run('dayflow-remember', 'I always check the calendar first.'),
    run('dayflow-reflect', 'A blocked reflection line.'),
  ];
  for (const attempt of attempts) {
    assert.equal(attempt.kind, 'error');
    assert.match(attempt.text, /journal/i);
    assert.ok(attempt.text.length > 0);
  }
});
