/**
 * dsh-plugin-dayflow: the Dayflow work journal as DSH tools and skills.
 *
 * The Dayflow Mac app records the user's screen and turns it into a timeline of
 * activities. This plugin exposes that timeline natively: twenty-three tools
 * (twelve reads, one journal importer, one review queue, one long-task tool, one
 * memory tool, one reflection tool, and six gated edits), plus Dayflow's eight
 * skills. The read backend can be the app's SQLite database or the plugin-owned
 * journal.
 *
 * It also injects one budgeted system context: the active long tasks and the
 * most recent non-superseded memory claims, so the model starts each session
 * knowing what is in flight. Empty data injects nothing.
 *
 * On hosts that expose the command registry, three optional slash commands give
 * the user quick capture that writes the owned journal directly, without a model
 * turn: `/dayflow-task`, `/dayflow-remember`, and `/dayflow-reflect`.
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
import { registerCommands } from './commands.js';
import type { CommandRegistration } from './commands.js';
import { registerMemoryContext } from './context.js';
import { registerPanelRoutes } from './panel.js';
import type { PanelCapturePermission } from './panel-contract.js';
import { CaptureEngine } from './capture/engine.js';
import { createNativeCaptureProvider } from './capture/provider.js';
import type { NativeCaptureProvider } from './capture/provider.js';
import { registerPrompt } from './prompt.js';
import { detectDayflow } from './setup.js';
import { registerSkills } from './skills.js';
import type { ToolRuntime } from './tools/shared.js';
import { readTools } from './tools/read.js';
import { journalImportTools } from './tools/import.js';
import { memoryTools } from './tools/memory.js';
import { reflectionTools } from './tools/reflection.js';
import { reviewTools } from './tools/review.js';
import { setupTools } from './tools/setup.js';
import { taskTools } from './tools/task.js';
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
  for (const tool of reviewTools(runtime)) ctx.tools.register(tool);
  for (const tool of taskTools(runtime)) ctx.tools.register(tool);
  for (const tool of memoryTools(runtime)) ctx.tools.register(tool);
  for (const tool of reflectionTools(runtime)) ctx.tools.register(tool);
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
  // One capture provider shared by the engine and the panel's permission probe.
  // It is created lazily and only when capture is switched on, because the
  // provider compiles a small macOS helper on first use.
  let provider: NativeCaptureProvider | undefined;
  const captureProvider = (): NativeCaptureProvider =>
    (provider ??= createNativeCaptureProvider());

  if (resolved.panel) {
    // Optional: only mounts where a Web connection service exists. The capture
    // permission probe reuses the engine's provider; when the helper cannot
    // answer the panel shows "unknown" rather than failing the route.
    const capturePermission = async (): Promise<PanelCapturePermission> => {
      if (!resolved.capture.enabled) return 'unknown';
      try {
        return await captureProvider().permission();
      } catch {
        return 'unknown';
      }
    };
    registerPanelRoutes(ctx, runtime, { capturePermission });
  }

  if (resolved.capture.enabled) {
    // Native capture is off by default. This effect is the Phase 1 capture
    // engine: it writes JPEG frames under $DSH_HOME/dayflow/frames/ and one
    // `screenshots` row per stored frame, with dedupe, idle/lock/pause gates,
    // and retention cleanup. It does not analyse frames, build activity cards,
    // write a timeline, or generate insights — that is a later phase. The
    // engine is independent of the panel: capture keeps running with `panel:
    // false`, and on a machine without the macOS permission it records an
    // error outcome instead of crashing the plugin.
    ctx.effect(() => {
      const engine = new CaptureEngine({
        journalPath: runtime.config.journalPath,
        provider: captureProvider(),
        config: resolved,
      });
      engine.start();
      return () => engine.stop();
    }, 'dayflow capture: engine');
  }
  registerPrompt(ctx);
  // Budgeted, read-only context: active long tasks and recent memory claims.
  // A profile can switch it off; empty data contributes no context at all.
  registerMemoryContext(ctx, runtime);
  // Optional human commands: hosts without a command registry skip them.
  ctx.inject(['commands'], (scoped) => {
    registerCommands(scoped as unknown as { commands: CommandRegistration }, runtime);
  });
}
