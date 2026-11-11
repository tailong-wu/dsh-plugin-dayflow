/**
 * dsh-plugin-dayflow: the Dayflow work journal as DSH tools and skills.
 *
 * The Dayflow Mac app records the user's screen and turns it into a timeline of
 * activities. This plugin exposes that timeline natively: eight read tools,
 * one journal importer, six gated editing tools, and Dayflow's four skills. The
 * read backend can be the app's SQLite database or the plugin-owned journal.
 *
 * The timeline covers screen activity only. It has no location, calendar, or
 * presence data, so a quiet stretch means nothing was captured rather than
 * nothing happened; the prompt and the skills tell the model to say so.
 * @module dsh-plugin-dayflow
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Context } from '@deepseek-ai/cordis';

import { Config, resolveConfig } from './config.js';
import type { DayflowConfig } from './config.js';
import { readPreferences } from './categories.js';
import { registerPanelRoutes } from './panel.js';
import { registerPrompt } from './prompt.js';
import { detectDayflow } from './setup.js';
import { registerSkills } from './skills.js';
import type { ToolRuntime } from './tools/shared.js';
import { readTools } from './tools/read.js';
import { journalImportTools } from './tools/import.js';
import { setupTools } from './tools/setup.js';
import { writeTools } from './tools/write.js';

/** Cordis plugin name, used in loader diagnostics and log lines. */
export const name = 'dayflow';

/** Services the plugin needs before it can load. */
export const inject = ['tools', 'skills', 'systemPrompt'];

export { Config };
export type { DayflowConfig };

/**
 * Locate the bundled `skills` directory.
 *
 * The published layout is `lib/index.js` beside `skills/`; the test build is
 * one level deeper, so both are tried before giving up.
 * @returns the absolute path to the skills root.
 */
export function skillsDirectory(): string {
  const candidates = [new URL('../skills/', import.meta.url), new URL('../../skills/', import.meta.url)];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return path;
  }
  return fileURLToPath(candidates[0] as URL);
}

/**
 * Mount the Dayflow plugin.
 * @param ctx - the harness context.
 * @param config - validated profile configuration.
 */
export function apply(ctx: Context, config: DayflowConfig = {}): void {
  const resolved = resolveConfig(config);
  const runtime: ToolRuntime = {
    config: resolved,
    preferences: () => readPreferences(),
    presence: () => detectDayflow(resolved.databasePath),
  };

  for (const tool of readTools(runtime)) ctx.tools.register(tool);
  for (const tool of journalImportTools(runtime)) ctx.tools.register(tool);
  if (resolved.edits) {
    for (const tool of writeTools(runtime)) ctx.tools.register(tool);
  }
  if (resolved.allowInstall && resolved.dayflow) {
    // Off by default: installing changes the machine; an owned-only profile has
    // no reason to install the source app.
    for (const tool of setupTools(runtime)) ctx.tools.register(tool);
  }
  if (resolved.skills) {
    registerSkills(ctx, skillsDirectory());
  }
  if (resolved.panel) {
    // Optional: only mounts where a Web connection service exists.
    registerPanelRoutes(ctx, runtime);
  }
  registerPrompt(ctx);
}
