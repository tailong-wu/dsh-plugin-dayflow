/**
 * Optional human slash commands: quick capture that writes the owned journal
 * directly, without a model turn, plus two manual background triggers.
 *
 * The host `commands` service is injected dynamically, like the panel's
 * `connection`, so a headless composition (or an older host without a command
 * registry) still loads the tools, the skills, and the context. Each capture
 * command is a plain journal action:
 *
 * - `/dayflow-task <title>` adds a long task the user owns;
 * - `/dayflow-remember <claim>` appends a dated preference claim;
 * - `/dayflow-reflect <text>` appends a line to today's day reflection.
 *
 * `/dayflow-analyze` and `/dayflow-run-close` are different: they run one
 * background pass through the callbacks the composition injects, because the
 * worker, the automation scheduler, and their host `llm` binding live above
 * this module. Both take no input and still go through the same gates as the
 * scheduled run.
 *
 * A handler opens the journal only while it writes, and every failure becomes
 * an `{ kind: 'error' }` result: a slash command must never throw into the host.
 * The journal path is the same one the tools use, so a captured record is
 * immediately visible to the timeline, the panel, and the memory context.
 * @module dsh-plugin-dayflow/commands
 */

import { dayWindowContaining } from './day.js';
import { withJournalWrite } from './journal.js';
import { addMemoryClaim } from './memory.js';
import { getReflection, saveReflection } from './reflections.js';
import { createLongTask } from './tasks.js';
import type { ToolRuntime } from './tools/shared.js';

/** The host-facing names of the quick-capture commands, without a leading slash. */
export const DAYFLOW_COMMAND_NAMES = [
  'dayflow-task',
  'dayflow-remember',
  'dayflow-reflect',
  'dayflow-analyze',
  'dayflow-run-close',
] as const;

/** The result of an injected background-run callback. */
export interface AnalysisRunOutcome {
  /** Whether the run completed without failing and without a gate. */
  ok: boolean;
  /** The user-facing summary; shown as an error result when `ok` is false. */
  text: string;
}

/** The result of the injected automation-close callback. */
export type CloseRunOutcome = AnalysisRunOutcome;

/** Optional callbacks a composition injects; a headless one passes none. */
export interface CommandOptions {
  /**
   * Run one analysis tick for the current Dayflow day. The composition supplies
   * this once its worker exists; without it `/dayflow-analyze` answers with an
   * error result instead of failing.
   */
  runAnalysis?: () => Promise<AnalysisRunOutcome>;
  /**
   * Run any due automation close (day or week) now. The composition supplies
   * this once its scheduler exists; without it `/dayflow-run-close` answers
   * with an error result instead of failing.
   */
  runClose?: () => Promise<CloseRunOutcome>;
}

/**
 * The text `/dayflow-analyze` shows when no analysis runner is available: the
 * switches are off, or the host exposes no `llm` service to run against.
 */
const ANALYSIS_UNAVAILABLE_TEXT = 'analysis is not enabled or the model service is unavailable';

/**
 * The text `/dayflow-run-close` shows when no close runner is available: the
 * automation switch is off, or the host exposes no `llm` service to close with.
 */
const CLOSE_UNAVAILABLE_TEXT = 'automation is not enabled or the model service is unavailable';

/** Evidence strength stamped on a claim captured with `/dayflow-remember`. */
const QUICK_CLAIM_CONFIDENCE = 0.7;

/** Char budget for a quick capture's subject, matching the panel's add route. */
const QUICK_SUBJECT_MAX_CHARS = 60;

/**
 * The host command registry, typed narrowly so this module stays testable.
 *
 * A host invocation carries more than this (a command id, the agent, the
 * attachments); a handler that only reads the raw input accepts that wider
 * invocation structurally, so the plugin does not depend on the full host type.
 */
export interface CommandRegistration {
  register(definition: {
    name: string;
    description: string;
    input?: { hint: string };
    handler: (invocation: { rawInput: string; signal: AbortSignal }) => CommandOutcome | Promise<CommandOutcome>;
  }): () => void;
}

/** One handler result: what to show the user, or why the capture did nothing. */
type CommandOutcome = { kind: 'success'; text: string } | { kind: 'error'; text: string };

/** A failure's message for the user, whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Derive a claim's grouping subject from its free text.
 *
 * The same rule the panel's add route uses, so the same sentence captured by
 * either entry point lands under the same subject.
 * @param text - the claim body, already trimmed.
 * @returns the text itself, or its first 60 characters and an ellipsis.
 */
function summarizeSubject(text: string): string {
  if (text.length <= QUICK_SUBJECT_MAX_CHARS) return text;
  return `${text.slice(0, QUICK_SUBJECT_MAX_CHARS).trimEnd()}…`;
}

/**
 * `/dayflow-task` — add a long task owned by the user.
 * @param runtime - the plugin runtime, for the journal path.
 * @param rawInput - everything typed after the command name.
 * @returns the user-facing result.
 */
function captureTask(runtime: ToolRuntime, rawInput: string): CommandOutcome {
  const title = rawInput.trim();
  if (title === '') return { kind: 'error', text: 'Usage: /dayflow-task <title>' };
  try {
    const task = withJournalWrite(runtime.config.journalPath, (db) =>
      createLongTask(db, { title, origin: 'user' }),
    );
    return { kind: 'success', text: `Added long task #${String(task.id)}: ${task.title}` };
  } catch (error) {
    return { kind: 'error', text: messageOf(error) };
  }
}

/**
 * `/dayflow-remember` — append a dated preference claim.
 *
 * The observation day is the current Dayflow day (04:00–04:00), not the
 * calendar date, so a capture at 1 AM belongs to the evening it continues.
 * @param runtime - the plugin runtime, for the journal path.
 * @param rawInput - everything typed after the command name.
 * @returns the user-facing result.
 */
function captureMemory(runtime: ToolRuntime, rawInput: string): CommandOutcome {
  const text = rawInput.trim();
  if (text === '') return { kind: 'error', text: 'Usage: /dayflow-remember <claim>' };
  try {
    const today = dayWindowContaining(new Date()).dayKey;
    const claim = withJournalWrite(runtime.config.journalPath, (db) =>
      addMemoryClaim(db, {
        kind: 'preference',
        subject: summarizeSubject(text),
        body: text,
        observed_on: today,
        confidence: QUICK_CLAIM_CONFIDENCE,
        source_days: [today],
      }),
    );
    return {
      kind: 'success',
      text: `Remembered #${String(claim.id)} · ${claim.subject} (observed ${today})`,
    };
  } catch (error) {
    return { kind: 'error', text: messageOf(error) };
  }
}

/**
 * `/dayflow-reflect` — append a line to today's saved day reflection.
 *
 * A day without a reflection starts one; a day that has one appends a new line,
 * because a slash command is a capture, not a rewrite. The store's validation
 * (including the 4000-character body bound) becomes an error result rather than
 * an exception.
 * @param runtime - the plugin runtime, for the journal path.
 * @param rawInput - everything typed after the command name.
 * @returns the user-facing result.
 */
function captureReflection(runtime: ToolRuntime, rawInput: string): CommandOutcome {
  const text = rawInput.trim();
  if (text === '') return { kind: 'error', text: 'Usage: /dayflow-reflect <text>' };
  try {
    const today = dayWindowContaining(new Date()).dayKey;
    const reflection = withJournalWrite(runtime.config.journalPath, (db) => {
      const existing = getReflection(db, 'day', today);
      const body = existing !== undefined && existing.body !== '' ? `${existing.body}\n${text}` : text;
      return saveReflection(db, { kind: 'day', period: today, body, source_days: [today] });
    });
    return {
      kind: 'success',
      text: `Saved today's reflection (${String(reflection.body.length)} chars)`,
    };
  } catch (error) {
    return { kind: 'error', text: messageOf(error) };
  }
}

/**
 * `/dayflow-analyze` — run one analysis tick through the injected callback.
 *
 * The handler never throws: a missing callback, a rejected run, and a run that
 * reports failure all become error results. It respects the same gates as the
 * worker because the callback runs the same pipeline.
 * @param options - the composition's analysis runner, when it has one.
 * @param signal - the host's cancellation signal for this invocation.
 * @returns the user-facing result.
 */
async function runAnalysisCommand(options: CommandOptions, signal: AbortSignal): Promise<CommandOutcome> {
  const runAnalysis = options.runAnalysis;
  if (runAnalysis === undefined) return { kind: 'error', text: ANALYSIS_UNAVAILABLE_TEXT };
  try {
    if (signal.aborted) return { kind: 'error', text: 'the analysis command was cancelled' };
    const result = await runAnalysis();
    return { kind: result.ok ? 'success' : 'error', text: result.text };
  } catch (error) {
    return { kind: 'error', text: messageOf(error) };
  }
}

/**
 * `/dayflow-run-close` — run any due automation close through the injected callback.
 *
 * The handler never throws: a missing callback, a rejected run, and a run that
 * reports failure all become error results. The callback is the scheduler's own
 * `runDue`, so the manual trigger uses the same ledger, gates, and catch-up
 * window as the timer.
 * @param options - the composition's automation-close runner, when it has one.
 * @param signal - the host's cancellation signal for this invocation.
 * @returns the user-facing result.
 */
async function runCloseCommand(options: CommandOptions, signal: AbortSignal): Promise<CommandOutcome> {
  const runClose = options.runClose;
  if (runClose === undefined) return { kind: 'error', text: CLOSE_UNAVAILABLE_TEXT };
  try {
    if (signal.aborted) return { kind: 'error', text: 'the close command was cancelled' };
    const result = await runClose();
    return { kind: result.ok ? 'success' : 'error', text: result.text };
  } catch (error) {
    return { kind: 'error', text: messageOf(error) };
  }
}

/** One command's registration data, with its name typed against the exported list. */
interface CommandDefinition {
  name: (typeof DAYFLOW_COMMAND_NAMES)[number];
  description: string;
  /** Placeholder the host shows after the command; absent for a no-input command. */
  hint?: string;
  /** The journal-writing action, for a capture command. */
  capture?: (runtime: ToolRuntime, rawInput: string) => CommandOutcome;
  /** The composition callback, for a command that runs background work. */
  run?: (options: CommandOptions, signal: AbortSignal) => Promise<CommandOutcome>;
}

/** The command surface, in the order it is registered. */
const COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'dayflow-task',
    description: 'Add a long task to the Dayflow journal.',
    hint: 'Task title',
    capture: captureTask,
  },
  {
    name: 'dayflow-remember',
    description: 'Remember a dated claim about how the user works.',
    hint: 'What to remember',
    capture: captureMemory,
  },
  {
    name: 'dayflow-reflect',
    description: "Append a line to today's saved day reflection.",
    hint: 'Reflection text',
    capture: captureReflection,
  },
  {
    name: 'dayflow-analyze',
    description: 'Run one manual analysis tick for the current Dayflow day (same consent gates as the worker).',
    run: runAnalysisCommand,
  },
  {
    name: 'dayflow-run-close',
    description: 'Run any due automation close (day or week) now; same gates as the scheduler.',
    run: runCloseCommand,
  },
];

/**
 * Register the five human commands on the host's command registry.
 *
 * Every handler is self-contained: a capture writes inside its own
 * {@link withJournalWrite} call and a background pass is delegated to the
 * composition's callback, and any failure becomes an error result, so a bad
 * invocation never breaks the host's command loop.
 * @param ctx - the scoped context carrying the host `commands` service.
 * @param runtime - the plugin runtime, for the owned journal path.
 * @param options - optional composition callbacks; omitting them leaves the
 *   commands that need one answering with an error result.
 */
export function registerCommands(
  ctx: { commands?: CommandRegistration } | undefined,
  runtime: ToolRuntime,
  options: CommandOptions = {},
): void {
  // A host without the command registry (or a composition that calls the
  // dynamic injection with a partial context) simply gets no commands.
  if (ctx === undefined || ctx.commands === undefined || typeof ctx.commands.register !== 'function') return;
  for (const command of COMMANDS) {
    ctx.commands.register({
      name: command.name,
      description: command.description,
      ...(command.hint === undefined ? {} : { input: { hint: command.hint } }),
      handler: (invocation) => {
        if (command.capture !== undefined) return command.capture(runtime, invocation.rawInput);
        if (command.run !== undefined) return command.run(options, invocation.signal);
        // Unreachable for the table above, but a handler must always answer.
        return { kind: 'error', text: 'this command has no handler' };
      },
    });
  }
}
