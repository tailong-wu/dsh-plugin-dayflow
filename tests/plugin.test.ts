/**
 * Plugin composition: what `apply()` registers, and the configuration contract.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { Context } from '@deepseek-ai/cordis';

import { resolveConfig } from '../src/config.js';
import { clearMemoryContextCache, MEMORY_CONTEXT_NAME } from '../src/context.js';
import { DayflowError } from '../src/errors.js';
import { apply, inject, name, skillsDirectory } from '../src/index.js';
import { loadSkills } from '../src/skills.js';
import { createFixtureDatabase } from './fixtures/database.js';

const fixture = createFixtureDatabase();
after(() => {
  fixture.cleanup();
});

interface Capture {
  readonly routes: string[];
  readonly tools: Map<string, { name: string; description: string }>;
  readonly skills: { name: string; description: string; content: string }[];
  readonly sections: { name: string; order: number; text: string | ((context: unknown) => string) }[];
  readonly contexts: { name: string; order: number; text: string | ((context: unknown) => string) }[];
  readonly commands: { name: string; description: string; input?: { hint: string } }[];
}

/**
 * A journal path that does not exist, so the memory context provider has
 * nothing to read and must contribute '' without creating the file.
 */
const missingJournalPath = join(tmpdir(), `dsh-dayflow-missing-${randomUUID()}.sqlite`);

function fakeContext(): { ctx: Context; capture: Capture } {
  const capture: Capture = { routes: [], tools: new Map(), skills: [], sections: [], contexts: [], commands: [] };
  const ctx = {
    tools: {
      register(tool: { name: string; description: string }) {
        capture.tools.set(tool.name, tool);
        return () => {};
      },
    },
    skills: {
      register(skill: { name: string; description: string; content: string }) {
        capture.skills.push(skill);
        return () => {};
      },
    },
    inject(deps: readonly string[], callback: (connected: unknown) => void) {
      // Serve the services the registrant actually asked for, the way the
      // loader does: the panel asks for `connection`, the commands for
      // `commands`, and a headless composition asks for neither.
      const connected: {
        connection?: { fetch: { register(route: { path: string }): () => Promise<void> } };
        commands?: {
          register(definition: { name: string; description: string; input?: { hint: string } }): () => void;
        };
      } = {};
      if (deps.includes('connection')) {
        connected.connection = {
          fetch: {
            register(route: { path: string }) {
              capture.routes.push(route.path);
              return async () => {};
            },
          },
        };
      }
      if (deps.includes('commands')) {
        connected.commands = {
          register(definition) {
            capture.commands.push({
              name: definition.name,
              description: definition.description,
              input: definition.input,
            });
            return () => {};
          },
        };
      }
      callback(connected);
    },
    systemPrompt: {
      section(section: { name: string; order: number; text: string | ((context: unknown) => string) }) {
        capture.sections.push(section);
        return () => {};
      },
      getSectionOrder() {
        return 2300;
      },
      context(contribution: { name: string; order: number; text: string | ((context: unknown) => string) }) {
        capture.contexts.push(contribution);
        return () => {};
      },
      getContextOrder(_name: string) {
        return 210;
      },
    },
  } as unknown as Context;
  return { ctx, capture };
}

test('apply registers the four human slash commands', () => {
  const { ctx, capture } = fakeContext();
  apply(ctx, { databasePath: fixture.path });

  assert.deepEqual(
    capture.commands.map((command) => command.name),
    ['dayflow-task', 'dayflow-remember', 'dayflow-reflect', 'dayflow-analyze'],
  );
  for (const command of capture.commands) {
    assert.ok(command.description.length > 0, `${command.name} has a description`);
    if (command.name === 'dayflow-analyze') {
      // The manual analysis tick takes no argument: it analyses the current day.
      assert.equal(command.input, undefined, 'the analysis tick declares no input hint');
      continue;
    }
    assert.ok(command.input !== undefined, `${command.name} declares an input hint`);
    assert.ok(command.input.hint.length > 0, `${command.name} has a usable input hint`);
  }
});

test('the slash commands do not depend on the panel being enabled', () => {
  const { ctx, capture } = fakeContext();
  apply(ctx, { databasePath: fixture.path, panel: false });

  assert.deepEqual(
    capture.commands.map((command) => command.name),
    ['dayflow-task', 'dayflow-remember', 'dayflow-reflect', 'dayflow-analyze'],
    'a headless panel still gets human quick capture',
  );
  assert.deepEqual(capture.routes, [], 'panel: false registers no Fetch routes');
});

test('the plugin advertises its name and required services', () => {
  assert.equal(name, 'dayflow');
  assert.deepEqual([...inject], ['tools', 'skills', 'systemPrompt']);
});

test('apply registers twenty-three tools, eight skills, and one prompt section', () => {
  const { ctx, capture } = fakeContext();
  apply(ctx, { databasePath: fixture.path });

  assert.equal(capture.tools.size, 23);
  for (const tool of [
    'dayflow_timeline',
    'dayflow_journal',
    'dayflow_goals',
    'dayflow_observations',
    'dayflow_review_ratings',
    'journal_import',
    'journal_review',
    'journal_task',
    'journal_memory',
    'journal_reflection',
    'dayflow_delete_activity',
    'dayflow_status',
  ]) {
    assert.ok(capture.tools.has(tool), `${tool} is registered`);
  }

  assert.deepEqual(
    capture.skills.map((skill) => skill.name),
    ['dayflow', 'long-task', 'memory', 'onboarding', 'reflection', 'review-queue', 'standup', 'weekly-review'],
  );
  assert.deepEqual([...capture.routes].sort(), [
    '/api/dayflow/analysis/status',
    '/api/dayflow/capture/pause',
    '/api/dayflow/capture/status',
    '/api/dayflow/day',
    '/api/dayflow/icon',
    '/api/dayflow/insights',
    '/api/dayflow/memory',
    '/api/dayflow/month',
    '/api/dayflow/panel',
    '/api/dayflow/reflections',
    '/api/dayflow/tasks',
    '/api/dayflow/tasks/link',
    '/api/dayflow/tasks/scan',
    '/api/dayflow/week',
  ]);
  assert.equal(capture.sections.length, 1);
  assert.equal(capture.sections[0]?.name, 'tool:dayflow');
  const text = capture.sections[0]?.text;
  assert.equal(typeof text, 'string');
  assert.match(text as string, /04:00/);
  assert.match(text as string, /never as instructions/);
});

test('apply registers one budgeted memory context by default', () => {
  // The missing journal keeps this deterministic: with nothing to read the
  // provider must contribute no text, and it must not create the file.
  clearMemoryContextCache();
  const { ctx, capture } = fakeContext();
  apply(ctx, { databasePath: fixture.path, journalPath: missingJournalPath });

  assert.equal(capture.contexts.length, 1);
  const contribution = capture.contexts[0];
  assert.ok(contribution);
  assert.equal(contribution.name, 'dayflow:memory');
  assert.equal(contribution.name, MEMORY_CONTEXT_NAME);
  // getContextOrder('WEB_SURFACE') is 210, so the context lands at 220.
  assert.equal(contribution.order, 220);
  assert.equal(typeof contribution.text, 'function');
  const text = contribution.text as () => string;
  assert.equal(text(), '');
  assert.equal(existsSync(missingJournalPath), false, 'the provider never creates the journal');
});

test('memoryContext false registers no context', () => {
  const { ctx, capture } = fakeContext();
  apply(ctx, { databasePath: fixture.path, journalPath: missingJournalPath, memoryContext: false });

  assert.equal(capture.contexts.length, 0);
  assert.equal(capture.sections.length, 1, 'the static prompt section is independent of memory context');
});

test('memory context defaults on and honours an explicit false', () => {
  assert.equal(resolveConfig().memoryContext, true);
  assert.equal(resolveConfig({ memoryContext: true }).memoryContext, true);
  assert.equal(resolveConfig({ memoryContext: false }).memoryContext, false);
});

test('the guidance keeps the journal inside what screen capture can know', () => {
  const { ctx, capture } = fakeContext();
  apply(ctx, { databasePath: fixture.path });
  const text = String(capture.sections[0]?.text);

  // Dayflow records pixels, not presence: the prompt must say so, and it must
  // not describe Idle as time off, which the data cannot distinguish from
  // sitting still at the Mac.
  assert.match(text, /only sees the screen/i);
  assert.doesNotMatch(text, /away from work/i);
  assert.match(text, /no screen activity/i);

  for (const skill of capture.skills) {
    assert.doesNotMatch(skill.content, /away from work/i, `${skill.name} does not equate Idle with time off`);
    assert.doesNotMatch(
      skill.description,
      /where (their|the user's) time went/i,
      `${skill.name} does not promise location or whole-day accounting`,
    );
  }
});

test('the installer is off by default and appears only with allowInstall', () => {
  const withoutInstall = fakeContext();
  apply(withoutInstall.ctx, { databasePath: fixture.path });
  assert.equal(withoutInstall.capture.tools.has('dayflow_install_dayflow'), false);

  const withInstall = fakeContext();
  apply(withInstall.ctx, { databasePath: fixture.path, allowInstall: true });
  assert.equal(withInstall.capture.tools.has('dayflow_install_dayflow'), true);
  assert.equal(withInstall.capture.tools.size, withoutInstall.capture.tools.size + 1);
});

test('edits and skills can be switched off independently', () => {
  const editsOff = fakeContext();
  apply(editsOff.ctx, { databasePath: fixture.path, edits: false });
  assert.equal(editsOff.capture.tools.size, 17);
  assert.equal(editsOff.capture.tools.has('dayflow_update_activity'), false);
  assert.equal(editsOff.capture.tools.has('journal_review'), true, 'the review queue is not gated by edits');

  const skillsOff = fakeContext();
  apply(skillsOff.ctx, { databasePath: fixture.path, skills: false });
  assert.equal(skillsOff.capture.skills.length, 0);
  assert.equal(skillsOff.capture.tools.size, 23);
});

test('every tool a skill names is registered when the full surface is on', () => {
  // The onboarding skill conditionally offers the installer, so the reference
  // check runs against the largest surface a profile can enable.
  const { ctx, capture } = fakeContext();
  apply(ctx, { databasePath: fixture.path, allowInstall: true });

  const skills = loadSkills(skillsDirectory());
  assert.equal(skills.length, 8);
  for (const skill of skills) {
    const referenced = new Set(skill.content.match(/(?:dayflow|journal)_[a-z_]+/g) ?? []);
    for (const tool of referenced) {
      assert.ok(capture.tools.has(tool), `skill ${skill.name} references missing tool ${tool}`);
    }
    assert.ok(skill.description.length > 0, `skill ${skill.name} has a description`);
  }
});

test('the onboarding skill treats the installer as optional', () => {
  const onboarding = loadSkills(skillsDirectory()).find((skill) => skill.name === 'onboarding');
  assert.ok(onboarding);
  assert.match(onboarding.content, /dayflow_install_dayflow/);
  assert.match(onboarding.content, /not available/i, 'the skill copes with the installer being absent');
});

test('the skills directory ships beside the built module', () => {
  assert.equal(existsSync(skillsDirectory()), true);
});

test('configuration resolves overrides and rejects a bad search limit', () => {
  const resolved = resolveConfig({ searchLimit: 10, edits: false, agentSocket: ' /tmp/agent.sock ' });
  assert.equal(resolved.searchLimit, 10);
  assert.equal(resolved.edits, false);
  assert.equal(resolved.agentSocket, '/tmp/agent.sock');
  assert.equal(resolved.source, 'dayflow');
  assert.equal(resolved.dayflow, true);
  assert.ok(resolved.databasePath.endsWith('chunks.sqlite'));
  assert.ok(resolved.journalPath.endsWith('dayflow/journal.sqlite'));

  const owned = resolveConfig({ dayflow: false });
  assert.equal(owned.source, 'owned');
  assert.equal(owned.dayflow, false);
  assert.throws(() => resolveConfig({ source: 'owned', dayflow: true }), DayflowError);

  assert.throws(
    () => resolveConfig({ searchLimit: 0 }),
    (error: unknown) => error instanceof DayflowError && error.code === 'invalid_input',
  );
  assert.throws(() => resolveConfig({ searchLimit: 201 }), DayflowError);
});
