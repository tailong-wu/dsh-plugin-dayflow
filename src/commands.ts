/**
 * Optional human slash commands: quick capture that writes the owned journal
 * directly, without a model turn.
 *
 * The host `commands` service is injected dynamically, like the panel's
 * `connection`, so a headless composition (or an older host without a command
 * registry) still loads the tools, the skills, and the context. Each command is
 * a plain capture action:
 *
 * - `/dayflow-task <title>` adds a long task the user owns;
 * - `/dayflow-remember <claim>` appends a dated preference claim;
 * - `/dayflow-reflect <text>` appends a line to today's day reflection.
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
export const DAYFLOW_COMMAND_NAMES = ['dayflow-task', 'dayflow-remember', 'dayflow-reflect'] as const;

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
    handler: (invocation: { rawInput: string; signal: AbortSignal }) => CommandOutcome;
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

/** One command's registration data, with its name typed against the exported list. */
interface CommandDefinition {
  name: (typeof DAYFLOW_COMMAND_NAMES)[number];
  description: string;
  hint: string;
  capture: (runtime: ToolRuntime, rawInput: string) => CommandOutcome;
}

/** The quick-capture surface, in the order it is registered. */
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
];

/**
 * Register the three quick-capture commands on the host's command registry.
 *
 * Every handler is self-contained: it writes inside its own
 * {@link withJournalWrite} call and converts any failure into an error result,
 * so a bad capture never breaks the host's command loop.
 * @param ctx - the scoped context carrying the host `commands` service.
 * @param runtime - the plugin runtime, for the owned journal path.
 */
export function registerCommands(ctx: { commands?: CommandRegistration } | undefined, runtime: ToolRuntime): void {
  // A host without the command registry (or a composition that calls the
  // dynamic injection with a partial context) simply gets no commands.
  if (ctx === undefined || ctx.commands === undefined || typeof ctx.commands.register !== 'function') return;
  for (const command of COMMANDS) {
    ctx.commands.register({
      name: command.name,
      description: command.description,
      input: { hint: command.hint },
      handler: (invocation) => command.capture(runtime, invocation.rawInput),
    });
  }
}
