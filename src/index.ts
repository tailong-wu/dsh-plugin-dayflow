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
 * On hosts that expose the command registry, five optional slash commands give
 * the user quick capture that writes the owned journal directly, without a model
 * turn (`/dayflow-task`, `/dayflow-remember`, `/dayflow-reflect`), plus two
 * manual background triggers (`/dayflow-analyze`, `/dayflow-run-close`).
 *
 * When capture and analysis are both enabled, one {@link AnalysisWorker} runs
 * the analysis pipeline on its own timer and one {@link AutomationScheduler}
 * closes the day at `automation.dailyAt` (04:00 by default) and the week on
 * `automation.weeklyOn`: a daily brief, the day's insight pass, and the weekly
 * rollup, each recorded in the automation ledger so a restart resumes instead of
 * duplicating. Both live behind a dynamic `llm` injection: a composition without
 * the model service still loads everything else, and neither loop starts without
 * an analyser.
 *
 * The timeline covers screen activity only. It has no location, calendar, or
 * presence data, so a quiet stretch means nothing was captured rather than
 * nothing happened; the prompt and the skills tell the model to say so.
 * @module dsh-plugin-dayflow
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Context } from '@deepseek-ai/cordis';

import { Config, resolveConfig } from './config.js';
import type { DayflowConfig, ResolvedConfig } from './config.js';
import { createHostAnalyser } from './analyse/host.js';
import type { HostLlmLike } from './analyse/host.js';
import type { AnalysisRunResult } from './analyse/pipeline.js';
import { AnalysisWorker } from './analyse/worker.js';
import { runDayInsights } from './automation/insights.js';
import { runWeeklyLint } from './automation/lint.js';
import type { WeeklyLintResult } from './automation/lint.js';
import { AutomationScheduler } from './automation/scheduler.js';
import type { AutomationCloseOutcome } from './automation/scheduler.js';
import { writeDailyBrief } from './briefs/daily.js';
import { writeWeeklyBrief } from './briefs/weekly.js';
import { readPreferences } from './categories.js';
import { registerCommands } from './commands.js';
import type { CommandRegistration } from './commands.js';
import { registerMemoryContext } from './context.js';
import { registerPanelRoutes } from './panel.js';
import type { PanelAutomationStatus, PanelCapturePermission } from './panel-contract.js';
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
 * Render one manual analysis run for `/dayflow-analyze`.
 * @param result - what the run did.
 * @returns a one-line, user-facing summary.
 */
function describeAnalysisRun(result: AnalysisRunResult): string {
  if (result.outcome === 'empty') return `${result.day}: no frames to analyse`;
  const parts = [`${result.day}: ${String(result.analysed)}/${String(result.windows)} window(s) analysed`];
  if (result.activitiesWritten > 0) parts.push(`${String(result.activitiesWritten)} card(s) written`);
  if (result.skipped > 0) parts.push(`${String(result.skipped)} skipped`);
  if (result.failed > 0) parts.push(`${String(result.failed)} failed`);
  if (result.outcome === 'blocked') parts.push(`blocked by ${result.blockedReason ?? 'a gate'}`);
  return parts.join(' · ');
}

/** The text the analysis command shows when no worker is mounted. */
const ANALYSIS_UNAVAILABLE_TEXT = 'analysis is not enabled or the model service is unavailable';

/** The text the close command shows when no scheduler is mounted. */
const AUTOMATION_UNAVAILABLE_TEXT = 'automation is not enabled or the model service is unavailable';

/**
 * The gate reasons a brief or insight pass reports instead of doing its work.
 *
 * The automation passes share the profile's consent and provider settings with
 * frame analysis, so a blocked pass is a configuration outcome, not a failure:
 * the run is recorded as skipped with the reason the panel and the status show.
 */
const AUTOMATION_BLOCKED_REASONS: ReadonlySet<string> = new Set([
  'analysis-disabled',
  'consent:none',
  'provider-unset',
  'model-unset',
]);

/** The part of a brief-writing result the close mapping reads. */
interface BriefOutcomeView {
  status: string;
  reason?: string;
}

/** The part of an insight-pass result the close mapping reads. */
interface InsightsOutcomeView {
  status: string;
  reasons: readonly string[];
}

/**
 * Map a daily brief plus a day's insight pass onto one close outcome.
 *
 * Both passes share the same gates, so when both are skipped the reason says
 * whether the close was blocked (consent, provider, or model) — recorded as
 * skipped — or whether it simply had nothing new to write, which is a completed,
 * idempotent close. A thrown failure never reaches this mapping: the close
 * callback records it as failed, which is how a broken model call reaches the
 * scheduler's bounded retry.
 * @param brief - what the daily brief pass reported.
 * @param insights - what the day's insight pass reported.
 * @returns the close outcome the scheduler records.
 */
function describeDayClose(brief: BriefOutcomeView, insights: InsightsOutcomeView): AutomationCloseOutcome {
  if (brief.status === 'skipped' && insights.status === 'skipped') {
    const blocked = [brief.reason, insights.reasons[0]].find(
      (reason) => reason !== undefined && AUTOMATION_BLOCKED_REASONS.has(reason),
    );
    return blocked === undefined ? { status: 'complete' } : { status: 'skipped', error: blocked };
  }
  return { status: 'complete' };
}

/**
 * Map a weekly-brief result plus the week's memory-lint pass onto one close outcome.
 *
 * Both passes are part of the same weekly close: the lint pass runs first, its
 * `findings`/`proposals`/`summary` become the brief's memory-health digest, and
 * the brief is only written after it. A thrown failure never reaches this
 * mapping: the close callback records it as failed, which is how a broken model
 * call or a broken lint scan reaches the scheduler's bounded retry.
 *
 * A gate that blocks both passes (consent, provider, model) is recorded as
 * `skipped` with that reason, exactly as the day close does. When both passes
 * only skip because their week was already recorded, the close is `skipped` too:
 * the work for that Monday is already in the journal and the reason says which
 * half reported it first. Any other combination counts as a completed close.
 * @param weekly - what the weekly brief pass reported.
 * @param lint - what the week's memory-lint pass reported.
 * @returns the close outcome the scheduler records.
 */
function describeWeekClose(weekly: BriefOutcomeView, lint: WeeklyLintResult): AutomationCloseOutcome {
  const blocked = [weekly.reason, lint.reason].find(
    (reason) => reason !== undefined && AUTOMATION_BLOCKED_REASONS.has(reason),
  );
  if (blocked !== undefined) return { status: 'skipped', error: blocked };
  if (weekly.status !== 'skipped' || lint.status !== 'skipped') return { status: 'complete' };
  const reason = weekly.reason ?? lint.reason;
  return reason === undefined ? { status: 'complete' } : { status: 'skipped', error: reason };
}

/**
 * The automation status the panel shows when the scheduler is not mounted.
 *
 * The profile still says when a close would run and how far a catch-up reaches;
 * only the live state (a running pass, the last closes) is missing.
 * @param resolved - the resolved plugin configuration.
 * @returns the scheduled status with no run history.
 */
function scheduledAutomationStatus(resolved: ResolvedConfig): PanelAutomationStatus {
  return {
    enabled: resolved.automation.enabled,
    running: false,
    dailyAt: resolved.automation.dailyAt,
    weeklyOn: resolved.automation.weeklyOn,
    catchUpDays: resolved.automation.catchUpDays,
  };
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

  // The worker and the close scheduler are created only when the host exposes
  // `llm`; the command seam is read lazily because the command registry is
  // injected before either loop exists.
  let analysisWorker: AnalysisWorker | undefined;
  let analysisRunner: (() => Promise<{ ok: boolean; text: string }>) | undefined;
  let automationScheduler: AutomationScheduler | undefined;
  let closeRunner: (() => Promise<{ ok: boolean; text: string }>) | undefined;

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
    registerPanelRoutes(ctx, runtime, {
      capturePermission,
      // The status line reads the worker's state through this hook; it answers
      // "stopped" until the analysis worker has been mounted.
      analysisWorker: () => analysisWorker?.status() ?? { running: false },
      // The close line reads the scheduler's live state through this hook; it
      // answers with the profile's schedule until the scheduler has been mounted.
      automationStatus: () => automationScheduler?.status() ?? scheduledAutomationStatus(resolved),
    });
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
  // Optional human commands: hosts without a command registry skip them. The
  // analysis command reads `analysisRunner` lazily, so it is registered before
  // the worker exists and answers with an error result until one does.
  ctx.inject(['commands'], (scoped) => {
    registerCommands(scoped as unknown as { commands: CommandRegistration }, runtime, {
      runAnalysis: () =>
        analysisRunner === undefined
          ? Promise.resolve({ ok: false, text: ANALYSIS_UNAVAILABLE_TEXT })
          : analysisRunner(),
      // The close command runs the scheduler's own pass, so the timer and the
      // manual trigger share the ledger, the catch-up window, and the gates.
      runClose: () =>
        closeRunner === undefined
          ? Promise.resolve({ ok: false, text: AUTOMATION_UNAVAILABLE_TEXT })
          : closeRunner(),
    });
  });

  if (resolved.capture.enabled && resolved.analysis.enabled) {
    // Frame analysis needs captured frames and a model service. It is mounted
    // inside a dynamic `llm` injection: a composition without the host LLM
    // keeps the rest of the plugin but starts no worker, rather than running a
    // pipeline whose missing analyser would write skipped terminal jobs.
    ctx.inject(['llm'], (scoped) => {
      const llm = (scoped as unknown as { llm: HostLlmLike }).llm;
      const analyser = createHostAnalyser(llm);
      const worker = new AnalysisWorker({
        journalPath: runtime.config.journalPath,
        framesDirectory: join(dirname(runtime.config.journalPath), 'frames'),
        config: resolved,
        analyser,
      });
      analysisWorker = worker;
      analysisRunner = () =>
        worker.runOnce().then((result) => ({
          ok: result.failed === 0 && result.outcome !== 'blocked',
          text: describeAnalysisRun(result),
        }));
      scoped.effect(() => {
        worker.start();
        return () => worker.stop();
      }, 'dayflow analysis: worker');

      if (resolved.automation.enabled) {
        // The close work itself lives above this module: a day close writes the
        // standup brief and then the day's insight pass, a week close runs the
        // scheduled memory lint and then writes the weekly rollup carrying its
        // digest. The scheduler owns the clock and the ledger, and maps each
        // pass's result onto the one outcome it records.
        const closeDay = async (day: string): Promise<AutomationCloseOutcome> => {
          try {
            const brief = await writeDailyBrief({
              journalPath: runtime.config.journalPath,
              config: resolved,
              analyser,
              day,
            });
            const insights = await runDayInsights({
              journalPath: runtime.config.journalPath,
              config: resolved,
              analyser,
              day,
            });
            return describeDayClose(brief, insights);
          } catch (error) {
            return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
          }
        };
        const closeWeek = async (monday: string): Promise<AutomationCloseOutcome> => {
          try {
            // The lint pass is proposals-only and records its own run; it runs
            // first so the brief can carry this week's memory-health digest.
            const lint = await runWeeklyLint({
              journalPath: runtime.config.journalPath,
              config: resolved,
              weekMonday: monday,
            });
            const weekly = await writeWeeklyBrief({
              journalPath: runtime.config.journalPath,
              config: resolved,
              analyser,
              monday,
              memoryHealth: {
                findings: lint.findings,
                proposals: lint.proposals,
                summary: lint.summary,
              },
            });
            return describeWeekClose(weekly, lint);
          } catch (error) {
            return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
          }
        };
        const scheduler = new AutomationScheduler({
          journalPath: runtime.config.journalPath,
          config: resolved,
          runDayClose: closeDay,
          runWeekClose: closeWeek,
        });
        automationScheduler = scheduler;
        closeRunner = async () => {
          const due = await scheduler.runDue();
          const status = scheduler.status();
          const parts: string[] = [];
          let ok = true;
          if (due.day !== undefined) {
            const last = status.lastDayClose;
            const word = last !== undefined && last.day === due.day ? last.status : 'complete';
            if (word === 'failed') ok = false;
            parts.push(`Day close ${due.day}: ${word}`);
          }
          if (due.week !== undefined) {
            const last = status.lastWeekClose;
            const word = last !== undefined && last.monday === due.week ? last.status : 'complete';
            if (word === 'failed') ok = false;
            parts.push(`Week close ${due.week}: ${word}`);
          }
          return parts.length === 0
            ? { ok: true, text: 'No automation close is due.' }
            : { ok, text: parts.join(' · ') };
        };
        scoped.effect(() => {
          scheduler.start();
          return () => scheduler.stop();
        }, 'dayflow automation: scheduler');
      }
    });
  }
}
