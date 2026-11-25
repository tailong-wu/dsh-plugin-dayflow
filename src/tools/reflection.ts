/**
 * The reflection tool: the compressed summary of a day or a week.
 *
 * A reflection is what the agent writes back after reading the timeline, so the
 * next session retrieves a short paragraph instead of replaying raw days. It
 * lives in the plugin-owned journal, like the review queue, the long tasks, and
 * the memory claims, so it is not gated by Dayflow's edits switch.
 *
 * A reflection is keyed by (kind, period): saving the same day or week again
 * edits that reflection rather than adding a duplicate, which keeps exactly one
 * row per period. A week's period may be any day inside the week; it is
 * normalized to that week's Monday, so "the week of the 21st" and "the week of
 * the 23rd" are the same row.
 * @module dsh-plugin-dayflow/tools/reflection
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

import { DayflowError } from '../errors.js';
import { renderReflection } from '../format.js';
import { withJournal, withJournalWrite } from '../journal.js';
import {
  deleteReflection,
  getReflection,
  listReflections,
  normalizeReflectionPeriod,
  saveReflection,
} from '../reflections.js';
import type { ReflectionKind, ReflectionPayload, SaveReflectionInput } from '../reflections.js';
import type { ToolRuntime } from './shared.js';
import { jsonValue } from './shared.js';

/** The tool-facing value of one `journal_reflection` call. */
export interface ReflectionToolPayload {
  action: 'save' | 'get' | 'list' | 'delete';
  /** The reflection of save, and of a get that found one. */
  reflection?: ReflectionPayload;
  /** get: whether a reflection exists for the requested period. */
  found?: boolean;
  /** list: the matching reflections, newest period first. */
  reflections?: ReflectionPayload[];
  /** delete: the kind of the reflection that was removed. */
  kind?: ReflectionKind;
  /** delete: the normalized period key of the reflection that was removed. */
  period_key?: string;
  /** delete: true once the row was removed. */
  deleted?: boolean;
  /** Guidance for the model, and the whole answer when there is nothing to render. */
  hint: string;
}

/** The kind values, for parameter and error text. */
const KIND_DESCRIPTION = "'day' | 'week'";

/** What a period means for each kind, for the parameter and error text. */
const PERIOD_DESCRIPTION =
  'day: the date as YYYY-MM-DD; week: any day inside the week, normalized to its Monday.';

/** Kind values the store accepts; checked here for a tool-level message. */
const REFLECTION_KINDS: ReadonlySet<string> = new Set<ReflectionKind>(['day', 'week']);

/** Guidance after saving a reflection. */
const SAVE_HINT =
  'Saving the same kind and period again edits this reflection: the row is updated, not duplicated. ' +
  'A week period may be any day inside the week and is stored under its Monday.';

/** Guidance after reading an existing reflection. */
const GET_HINT =
  'Read the reflection as the compressed summary of that period: it was written from the timeline at that ' +
  'time, so cite the period instead of presenting it as the present. Saving it again edits the same row.';

/** Guidance when a get found nothing. */
const GET_MISSING_HINT =
  'No reflection is saved for that period yet: read the timeline and the weekly rollup, then save one. ' +
  'Do not answer from a reflection that does not exist.';

/** Guidance after a list. */
const LIST_HINT =
  'Reflections are the compressed summaries kept in the owned journal: read the matching period before ' +
  're-deriving it from the raw timeline.';

/** Guidance after deleting a reflection. */
const DELETE_HINT = 'The reflection was removed for good; the deletion cannot be undone.';

/** A missing required argument, phrased for the model. */
function invalidInput(message: string): DayflowError {
  return new DayflowError(message, 'invalid_input');
}

/**
 * Read the optional kind of a call, refusing a value outside day and week.
 * @param kind - the caller's kind argument.
 * @param action - the action asking for it, for the error text.
 * @returns the kind, or undefined when the caller left it out.
 */
function reflectionKind(kind: string | undefined, action: string): ReflectionKind | undefined {
  const trimmed = kind?.trim();
  if (trimmed === undefined || trimmed === '') return undefined;
  if (!REFLECTION_KINDS.has(trimmed)) {
    throw invalidInput(`Unknown reflection kind "${trimmed}" for ${action}: use ${KIND_DESCRIPTION}.`);
  }
  return trimmed as ReflectionKind;
}

/** Read a kind the action cannot do without. */
function requiredKind(kind: string | undefined, action: string): ReflectionKind {
  const parsed = reflectionKind(kind, action);
  if (parsed === undefined) throw invalidInput(`${action} needs a kind (${KIND_DESCRIPTION}).`);
  return parsed;
}

/** Read a period the action cannot do without, refusing a blank one. */
function requiredPeriod(period: string | undefined, action: string): string {
  const trimmed = period?.trim();
  if (trimmed === undefined || trimmed === '') {
    throw invalidInput(`${action} needs a period: ${PERIOD_DESCRIPTION}`);
  }
  return trimmed;
}

/** Read a required text argument, refusing a blank one. */
function requiredText(value: string | undefined, field: string, action: string): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') throw invalidInput(`${action} needs ${field}.`);
  return trimmed;
}

/**
 * Build the reflection tool.
 * @param runtime - the plugin runtime.
 * @returns the tool definition, ready to register.
 */
export function reflectionTools(runtime: ToolRuntime): ToolDefinition[] {
  return [
    defineTool({
      name: 'journal_reflection',
      description:
        'A reflection is a compressed summary of one day or one week: what happened, what repeated, and what ' +
        'stalled. It lives in the plugin-owned journal, so a later session retrieves the summary instead of ' +
        'replaying the raw timeline. save writes it back and, because a reflection is keyed by kind and period, ' +
        "saving the same period again edits it rather than adding a duplicate. A week's period may be any day " +
        "inside the week: it is normalized to that week's Monday. get reads one period and reports found: " +
        'false when none is stored yet; list reads recent reflections, optionally filtered by kind. delete ' +
        "removes a reflection for good, so it requires confirm: true after the user has explicitly asked for " +
        "it. Reflections are not gated by Dayflow's edits switch.",
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: "'save' | 'get' | 'list' | 'delete'",
        },
        kind: {
          type: 'string',
          description: `save/get/delete: required ${KIND_DESCRIPTION}. list: filter by kind.`,
        },
        period: {
          type: 'string',
          description: `save/get/delete: required period. ${PERIOD_DESCRIPTION}`,
        },
        body: {
          type: 'string',
          description:
            'save: required. The reflection itself: a few compact dated lines (what happened, what repeated, ' +
            'what stalled), not a replay of every activity.',
        },
        highlights: {
          type: 'array',
          items: { type: 'string' },
          description: 'save: the few lines worth carrying forward, one highlight per entry.',
        },
        source_days: {
          type: 'array',
          items: { type: 'string' },
          description: 'save: the days the reflection was derived from, as YYYY-MM-DD.',
        },
        source_activity_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: 'save: record IDs from dayflow_timeline that back the reflection.',
        },
        limit: { type: 'integer', description: 'list: maximum rows, 1..100. Defaults to 20.' },
        confirm: {
          type: 'boolean',
          description: 'delete: true once the user has explicitly agreed to delete the reflection.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          { type: 'text', text: renderReflection(value as unknown as ReflectionToolPayload) },
        ],
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        switch (args.action) {
          case 'save': {
            const input: SaveReflectionInput = {
              kind: requiredKind(args.kind, 'save'),
              period: requiredPeriod(args.period, 'save'),
              body: requiredText(
                args.body,
                'a body: the reflection itself, as a few compact dated lines',
                'save',
              ),
              ...(args.highlights === undefined ? {} : { highlights: args.highlights }),
              ...(args.source_days === undefined ? {} : { source_days: args.source_days }),
              ...(args.source_activity_ids === undefined
                ? {}
                : { source_activity_ids: args.source_activity_ids }),
            };
            const reflection = withJournalWrite(runtime.config.journalPath, (db) =>
              saveReflection(db, input),
            );
            const payload: ReflectionToolPayload = { action: 'save', reflection, hint: SAVE_HINT };
            return jsonValue(payload);
          }

          case 'get': {
            const kind = requiredKind(args.kind, 'get');
            const period = requiredPeriod(args.period, 'get');
            const reflection = withJournal(runtime.config.journalPath, (db) =>
              getReflection(db, kind, period),
            );
            const payload: ReflectionToolPayload =
              reflection === undefined
                ? { action: 'get', found: false, hint: GET_MISSING_HINT }
                : { action: 'get', found: true, reflection, hint: GET_HINT };
            return jsonValue(payload);
          }

          case 'list': {
            const options: { kind?: ReflectionKind; limit?: number } = {};
            const kind = reflectionKind(args.kind, 'list');
            if (kind !== undefined) options.kind = kind;
            if (args.limit !== undefined) options.limit = args.limit;
            const reflections = withJournal(runtime.config.journalPath, (db) =>
              listReflections(db, options),
            );
            const payload: ReflectionToolPayload = { action: 'list', reflections, hint: LIST_HINT };
            return jsonValue(payload);
          }

          case 'delete': {
            const kind = requiredKind(args.kind, 'delete');
            const period = requiredPeriod(args.period, 'delete');
            if (args.confirm !== true) {
              throw invalidInput(
                "Deleting a reflection is the user's decision: get their explicit agreement first, then pass " +
                  'confirm: true. Nothing was changed.',
              );
            }
            const periodKey = normalizeReflectionPeriod(kind, period);
            const deleted = withJournalWrite(runtime.config.journalPath, (db) =>
              deleteReflection(db, kind, periodKey),
            );
            if (!deleted) {
              throw new DayflowError(`No ${kind} reflection for ${periodKey}.`, 'not_found');
            }
            const payload: ReflectionToolPayload = {
              action: 'delete',
              deleted: true,
              kind,
              period_key: periodKey,
              hint: DELETE_HINT,
            };
            return jsonValue(payload);
          }

          default:
            throw invalidInput(
              `Unknown action "${args.action}": use save, get, list, or delete.`,
            );
        }
      },
      presentCall: (args) => {
        switch (args.action) {
          case 'get':
            return {
              card: 'generic' as const,
              kind: 'read' as const,
              title: `Reflection${args.kind === undefined ? '' : ` · ${args.kind}`}${
                args.period === undefined ? '' : ` ${args.period}`
              }`,
            };
          case 'list':
            return {
              card: 'generic' as const,
              kind: 'read' as const,
              title: `Reflections${args.kind === undefined ? '' : ` · ${args.kind}`}`,
            };
          case 'save':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Save reflection${args.kind === undefined ? '' : ` · ${args.kind}`}${
                args.period === undefined ? '' : ` ${args.period}`
              }`,
            };
          case 'delete':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Delete reflection${args.kind === undefined ? '' : ` · ${args.kind}`}${
                args.period === undefined ? '' : ` ${args.period}`
              }`,
            };
          default:
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Reflection · ${args.action}`,
            };
        }
      },
    }),
  ];
}
