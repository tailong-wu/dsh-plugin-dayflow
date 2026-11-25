/**
 * The memory tool: dated claims the journal keeps about how the user works.
 *
 * Memory is written as history, not as the present. Every claim carries the day
 * it describes (`observed_on`), so a reader can say "on 2026-10-13 the release
 * script did not gate on the tag" instead of the unsupportable "the release
 * script does not gate on the tag". A change appends a new dated claim and
 * marks the old one superseded; the old row is never rewritten, because a
 * memory that mutates cannot be trusted at any earlier date.
 *
 * The claims live in the plugin-owned journal, like the review queue and the
 * long tasks, so they are not gated by Dayflow's edits switch. A kept
 * distillation or loop in the review queue is written here automatically, which
 * is why `add` is mostly for preferences and corrections the user states
 * directly.
 * @module dsh-plugin-dayflow/tools/memory
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

import { DayflowError } from '../errors.js';
import { renderMemory } from '../format.js';
import { withJournal, withJournalWrite } from '../journal.js';
import {
  addMemoryClaim,
  forgetMemoryClaim,
  listMemoryClaims,
  searchMemoryClaims,
  supersedeMemoryClaim,
} from '../memory.js';
import type {
  AddMemoryClaimInput,
  MemoryClaimKind,
  MemoryClaimPayload,
  SupersedeMemoryClaimInput,
} from '../memory.js';
import type { ToolRuntime } from './shared.js';
import { jsonValue } from './shared.js';

/** The tool-facing value of one `journal_memory` call. */
export interface MemoryToolPayload {
  action: 'add' | 'search' | 'list' | 'supersede' | 'forget';
  /** The new claim of add and supersede. */
  claim?: MemoryClaimPayload;
  /** The list and search results, newest observed claim first. */
  claims?: MemoryClaimPayload[];
  /** search: the query the claims were found with. */
  query?: string;
  /** supersede: the id of the claim the new one replaced. */
  previous_id?: number;
  /** forget: the id of the claim that was deleted. */
  forgotten?: number;
  hint: string;
}

/** The kind values, for parameter and error text. */
const KIND_DESCRIPTION = "'distillation' | 'loop' | 'preference' | 'correction'";

/** Kind values the store accepts; checked here for a tool-level message. */
const MEMORY_KINDS: ReadonlySet<string> = new Set<MemoryClaimKind>([
  'distillation',
  'loop',
  'preference',
  'correction',
]);

/** Guidance after adding a claim. */
const ADD_HINT =
  'A claim is history, not the present: observed_on is the day it describes, so keep saying "on <date>, ...". ' +
  'When the fact changes, supersede the claim instead of adding a near-duplicate.';

/** Guidance after a search or a list. */
const READ_HINT =
  'Read each claim with its observed_on date and say "on <date>, ...": the data cannot know whether a claim is ' +
  'still current, only that it was observed then. Claims superseded by a newer one are hidden unless ' +
  'include_superseded is true.';

/** Guidance after superseding a claim. */
const SUPERSEDE_HINT =
  'The old row stays for traceability and now points at the new claim through superseded_by; search and list ' +
  'return only the new claim unless include_superseded is true.';

/** Guidance after deleting a claim. */
const FORGET_HINT = 'The claim was removed for good; the deletion cannot be undone.';

/** A missing required argument, phrased for the model. */
function invalidInput(message: string): DayflowError {
  return new DayflowError(message, 'invalid_input');
}

/**
 * Read the optional kind of a call, refusing a value outside the four kinds.
 * @param kind - the caller's kind argument.
 * @param action - the action asking for it, for the error text.
 * @returns the kind, or undefined when the caller left it out.
 */
function memoryKind(kind: string | undefined, action: string): MemoryClaimKind | undefined {
  const trimmed = kind?.trim();
  if (trimmed === undefined || trimmed === '') return undefined;
  if (!MEMORY_KINDS.has(trimmed)) {
    throw invalidInput(`Unknown memory kind "${trimmed}" for ${action}: use ${KIND_DESCRIPTION}.`);
  }
  return trimmed as MemoryClaimKind;
}

/** Read a kind the action cannot do without. */
function requiredKind(kind: string | undefined, action: string): MemoryClaimKind {
  const parsed = memoryKind(kind, action);
  if (parsed === undefined) throw invalidInput(`${action} needs a kind (${KIND_DESCRIPTION}).`);
  return parsed;
}

/** Read a required text argument, refusing a blank one. */
function requiredText(value: string | undefined, field: string, action: string): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') throw invalidInput(`${action} needs ${field}.`);
  return trimmed;
}

/** Read the required claim id shared by the id-taking actions. */
function requiredId(id: number | undefined, action: string): number {
  if (id === undefined) {
    throw invalidInput(`${action} needs the id of a memory claim; list returns the ids.`);
  }
  return id;
}

/**
 * Build the memory tool.
 * @param runtime - the plugin runtime.
 * @returns the tool definition, ready to register.
 */
export function memoryTools(runtime: ToolRuntime): ToolDefinition[] {
  return [
    defineTool({
      name: 'journal_memory',
      description:
        "The journal's memory of how the user works: short claims that carry the day they describe. A claim is " +
        'history, not the present — observed_on is the date the claim is about, not the day it is written, so ' +
        'always write "on <date>, X" and never "currently X"; the journal is always behind reality and cannot ' +
        'know whether a claim is still true. add appends a dated claim. When a fact changes, supersede it with a ' +
        'new dated claim: the old row stays and is marked superseded, so history stays readable at an older ' +
        'date. search and list return only claims that have not been superseded unless include_superseded is ' +
        'true. forget hard-deletes a claim; because deleting a memory is the user\'s decision, it requires ' +
        'confirm: true after the user has explicitly asked for it. A distillation or loop the user keeps in ' +
        'journal_review is written here automatically, so do not add the same lesson twice. Claims live in the ' +
        "plugin-owned journal, separate from Dayflow's own data, and are not gated by Dayflow's edits switch.",
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: "'add' | 'search' | 'list' | 'supersede' | 'forget'",
        },
        kind: {
          type: 'string',
          description: `add: required ${KIND_DESCRIPTION}. supersede: the new kind, if it changed. search/list: filter by kind.`,
        },
        subject: {
          type: 'string',
          description:
            'add: the few words the claim is about, e.g. "release ritual". supersede: the new subject, if it changed.',
        },
        body: {
          type: 'string',
          description:
            'add/supersede: the claim itself as one dated sentence, e.g. "on 2026-10-13, the release script did not gate on the tag".',
        },
        observed_on: {
          type: 'string',
          description:
            'add/supersede: the day the claim describes, YYYY-MM-DD. Not today unless that is genuinely the day observed.',
        },
        confidence: {
          type: 'number',
          description: 'add/supersede: 0..1, how strongly the evidence supports the claim. Defaults to 0.7.',
        },
        source_review_item: {
          type: 'integer',
          description: 'add: the review item id that backs the claim, when it came from the review queue.',
        },
        source_days: {
          type: 'array',
          items: { type: 'string' },
          description: 'add: the days the evidence comes from, YYYY-MM-DD, when they differ from observed_on.',
        },
        query: { type: 'string', description: 'search: the words to look for in claims.' },
        include_superseded: {
          type: 'boolean',
          description: 'search/list: true also returns claims that a newer claim replaced. Defaults to false.',
        },
        limit: { type: 'integer', description: 'search/list: maximum rows, 1..100. Defaults to 20.' },
        id: {
          type: 'integer',
          description: 'supersede: the id of the claim being replaced. forget: the id of the claim to delete.',
        },
        confirm: {
          type: 'boolean',
          description: 'forget: true once the user has explicitly agreed to delete the claim.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          { type: 'text', text: renderMemory(value as unknown as MemoryToolPayload) },
        ],
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        switch (args.action) {
          case 'add': {
            const input: AddMemoryClaimInput = {
              kind: requiredKind(args.kind, 'add'),
              subject: requiredText(args.subject, 'a subject: the few words the claim is about', 'add'),
              body: requiredText(args.body, 'a body: the claim itself, as a dated sentence', 'add'),
              observed_on: requiredText(
                args.observed_on,
                'observed_on, the day the claim describes as YYYY-MM-DD',
                'add',
              ),
              ...(args.confidence === undefined ? {} : { confidence: args.confidence }),
              ...(args.source_review_item === undefined
                ? {}
                : { source_review_item: args.source_review_item }),
              ...(args.source_days === undefined ? {} : { source_days: args.source_days }),
            };
            const claim = withJournalWrite(runtime.config.journalPath, (db) =>
              addMemoryClaim(db, input),
            );
            const payload: MemoryToolPayload = { action: 'add', claim, hint: ADD_HINT };
            return jsonValue(payload);
          }

          case 'search': {
            const query = requiredText(args.query, 'query: the words to look for', 'search');
            const options: { include_superseded?: boolean; limit?: number; kind?: MemoryClaimKind } = {};
            if (args.include_superseded !== undefined) options.include_superseded = args.include_superseded;
            if (args.limit !== undefined) options.limit = args.limit;
            const kind = memoryKind(args.kind, 'search');
            if (kind !== undefined) options.kind = kind;
            const claims = withJournal(runtime.config.journalPath, (db) =>
              searchMemoryClaims(db, query, options),
            );
            const payload: MemoryToolPayload = {
              action: 'search',
              claims,
              query,
              hint: READ_HINT,
            };
            return jsonValue(payload);
          }

          case 'list': {
            const filter: { kind?: MemoryClaimKind; include_superseded?: boolean; limit?: number } = {};
            if (args.include_superseded !== undefined) filter.include_superseded = args.include_superseded;
            if (args.limit !== undefined) filter.limit = args.limit;
            const kind = memoryKind(args.kind, 'list');
            if (kind !== undefined) filter.kind = kind;
            const claims = withJournal(runtime.config.journalPath, (db) =>
              listMemoryClaims(db, filter),
            );
            const payload: MemoryToolPayload = { action: 'list', claims, hint: READ_HINT };
            return jsonValue(payload);
          }

          case 'supersede': {
            const id = requiredId(args.id, 'supersede');
            const input: SupersedeMemoryClaimInput = {
              body: requiredText(
                args.body,
                'a body: the new claim, as one dated sentence',
                'supersede',
              ),
              observed_on: requiredText(
                args.observed_on,
                'observed_on, the day the new claim describes as YYYY-MM-DD',
                'supersede',
              ),
              ...(args.subject === undefined ? {} : { subject: args.subject }),
              ...(args.confidence === undefined ? {} : { confidence: args.confidence }),
            };
            const kind = memoryKind(args.kind, 'supersede');
            if (kind !== undefined) input.kind = kind;
            // The new claim is inserted and the old row is marked in the same
            // write connection, so the two can never diverge.
            const claim = withJournalWrite(runtime.config.journalPath, (db) =>
              supersedeMemoryClaim(db, id, input),
            );
            const payload: MemoryToolPayload = {
              action: 'supersede',
              claim,
              previous_id: id,
              hint: SUPERSEDE_HINT,
            };
            return jsonValue(payload);
          }

          case 'forget': {
            const id = requiredId(args.id, 'forget');
            if (args.confirm !== true) {
              throw invalidInput(
                'Deleting a memory claim is the user\'s decision: get their explicit agreement first, then pass ' +
                  'confirm: true. Nothing was changed.',
              );
            }
            withJournalWrite(runtime.config.journalPath, (db) => forgetMemoryClaim(db, id));
            const payload: MemoryToolPayload = { action: 'forget', forgotten: id, hint: FORGET_HINT };
            return jsonValue(payload);
          }

          default:
            throw invalidInput(
              `Unknown action "${args.action}": use add, search, list, supersede, or forget.`,
            );
        }
      },
      presentCall: (args) => {
        switch (args.action) {
          case 'search':
            return {
              card: 'generic' as const,
              kind: 'read' as const,
              title: `Memory search${args.query === undefined ? '' : ` · ${args.query}`}`,
            };
          case 'list':
            return {
              card: 'generic' as const,
              kind: 'read' as const,
              title: `Memory claims${args.kind === undefined ? '' : ` · ${args.kind}`}`,
            };
          case 'add':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Remember${args.subject === undefined ? '' : ` · ${args.subject}`}`,
            };
          case 'supersede':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Supersede claim #${args.id ?? '?'}`,
            };
          case 'forget':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Forget claim #${args.id ?? '?'}`,
            };
          default:
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Memory · ${args.action}`,
            };
        }
      },
    }),
  ];
}
