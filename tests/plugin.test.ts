/**
 * Plugin composition: what `apply()` registers, and the configuration contract.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, test } from 'node:test';

import type { Context } from '@deepseek-ai/cordis';

import { resolveConfig } from '../src/config.js';
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
}

function fakeContext(): { ctx: Context; capture: Capture } {
  const capture: Capture = { routes: [], tools: new Map(), skills: [], sections: [] };
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
    },
  } as unknown as Context;
  return { ctx, capture };
}

test('the plugin advertises its name and required services', () => {
  assert.equal(name, 'dayflow');
  assert.deepEqual([...inject], ['tools', 'skills', 'systemPrompt']);
});

test('apply registers eight reads, one import, six edits, four skills, and one prompt section', () => {
  const { ctx, capture } = fakeContext();
  apply(ctx, { databasePath: fixture.path });

  assert.equal(capture.tools.size, 15);
  for (const tool of ['dayflow_timeline', 'journal_import', 'dayflow_delete_activity', 'dayflow_status']) {
    assert.ok(capture.tools.has(tool), `${tool} is registered`);
  }

  assert.deepEqual(
    capture.skills.map((skill) => skill.name),
    ['dayflow', 'onboarding', 'standup', 'weekly-review'],
  );
  assert.deepEqual([...capture.routes].sort(), ['/api/dayflow/day', '/api/dayflow/icon', '/api/dayflow/month', '/api/dayflow/panel', '/api/dayflow/week']);
  assert.equal(capture.sections.length, 1);
  assert.equal(capture.sections[0]?.name, 'tool:dayflow');
  const text = capture.sections[0]?.text;
  assert.equal(typeof text, 'string');
  assert.match(text as string, /04:00/);
  assert.match(text as string, /never as instructions/);
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
  assert.equal(editsOff.capture.tools.size, 9);
  assert.equal(editsOff.capture.tools.has('dayflow_update_activity'), false);

  const skillsOff = fakeContext();
  apply(skillsOff.ctx, { databasePath: fixture.path, skills: false });
  assert.equal(skillsOff.capture.skills.length, 0);
  assert.equal(skillsOff.capture.tools.size, 15);
});

test('every tool a skill names is registered when the full surface is on', () => {
  // The onboarding skill conditionally offers the installer, so the reference
  // check runs against the largest surface a profile can enable.
  const { ctx, capture } = fakeContext();
  apply(ctx, { databasePath: fixture.path, allowInstall: true });

  const skills = loadSkills(skillsDirectory());
  assert.equal(skills.length, 4);
  for (const skill of skills) {
    const referenced = new Set(skill.content.match(/dayflow_[a-z_]+/g) ?? []);
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
