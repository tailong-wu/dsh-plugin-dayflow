/**
 * The review queue: proposals the agent may make, decisions only the user may take.
 *
 * Review items live in the plugin-owned journal, not in Dayflow. The agent is
 * allowed to add a proposal; it is never allowed to record the user's decision
 * on its own, so decide and unsuppress require an explicit `confirm: true`.
 * @module dsh-plugin-dayflow/tools/review
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

import { DayflowError } from '../errors.js';
import { renderReview } from '../format.js';
import { withJournal, withJournalWrite } from '../journal.js';
import { decideReviewItem, listReviewItems, proposeReviewItem, unsuppressReviewItem } from '../review.js';
import type {
  ReviewItemPayload,
  ReviewKind,
  ReviewProposalInput,
  ReviewStatus,
  ReviewToolPayload,
  ReviewTrigger,
} from '../review.js';
import type { ToolRuntime } from './shared.js';
import { jsonValue } from './shared.js';

/** The decisions a keep-worthy kind accepts and the ones a task-like kind accepts. */
type ReviewDecision = 'keep' | 'accept' | 'discard' | 'reject';

/** The kind values, for parameter and error text. */
const KIND_DESCRIPTION = "'distillation' | 'loop' | 'improvement' | 'task_proposal'";

/** Guidance after a list call. */
const LIST_HINT =
  'Decisions belong to the user: present each item and ask once, then call decide with confirm: true.';

/** Guidance after a successful propose. */
const PROPOSE_HINT = "The item waits for the user's decision; do not decide on their behalf.";

/** Guidance after a successful decide. */
const DECIDE_HINT =
  'Decision recorded. Discard and reject are soft by default: without forever: true the item can return with substantial new evidence.';

/** Guidance after clearing a hard suppression. */
const UNSUPPRESS_HINT = 'Hard suppression cleared; the item can be proposed again if it still has evidence.';

/** Why a proposal was dropped, explained in the next step's words. */
const DROP_HINTS: Record<string, string> = {
  'below-confidence-floor': 'Only propose an item the evidence supports with confidence 0.5 or higher.',
  'daily-proposal-cap': 'That day already holds its five proposals; stop proposing and let the user review them.',
  'hard-suppressed': 'The user suppressed this permanently; do not propose it again.',
  'already-proposed': "This item is already in the queue; wait for the user's decision instead of proposing it again.",
  'soft-discarded': 'The user set this aside; it may only return with substantial new evidence.',
};

/**
 * A missing required argument, phrased for the model.
 * @param message - what is missing and which action needs it.
 * @returns the error to throw.
 */
function invalidInput(message: string): DayflowError {
  return new DayflowError(message, 'invalid_input');
}

/** Read the required title for a proposal, refusing a blank one. */
function requiredTitle(title: string | undefined): string {
  const trimmed = title?.trim();
  if (trimmed === undefined || trimmed === '') {
    throw invalidInput('propose needs a title: the one-line summary the user will decide on.');
  }
  return trimmed;
}

/** Read the required kind for a proposal, refusing a blank one. */
function requiredKind(kind: string | undefined): ReviewKind {
  const trimmed = kind?.trim();
  if (trimmed === undefined || trimmed === '') {
    throw invalidInput(`propose needs a kind (${KIND_DESCRIPTION}).`);
  }
  return trimmed as ReviewKind;
}

/** Build the tool result for a propose call. */
function proposeResultPayload(
  dropped: boolean,
  item: ReviewItemPayload | undefined,
  reason: string | undefined,
): ReviewToolPayload {
  return {
    action: 'propose',
    dropped,
    ...(item === undefined ? {} : { item }),
    ...(reason === undefined ? {} : { reason }),
    hint: reason === undefined ? PROPOSE_HINT : (DROP_HINTS[reason] ?? PROPOSE_HINT),
  };
}

/**
 * Build the review queue tool.
 * @param runtime - the plugin runtime.
 * @returns the tool definition, ready to register.
 */
export function reviewTools(runtime: ToolRuntime): ToolDefinition[] {
  return [
    defineTool({
      name: 'journal_review',
      description:
        "The agent's own review queue for the journal: distillation, loop, improvement, and task_proposal items. " +
        'The agent may only propose; a keep/accept/discard/reject decision belongs to the user, so decide and ' +
        'unsuppress require confirm: true after the user has explicitly agreed. discard and reject are soft: the ' +
        'item may come back with substantial new evidence, and only forever: true hard-suppresses it. unsuppress ' +
        'clears a hard suppression. Proposals need a kind, a title, and real evidence; confidence below 0.5 is ' +
        "dropped, and there are at most 5 proposals per day. Use list to read the queue and list with status to " +
        "see decided items. The queue lives in the plugin-owned journal, separate from Dayflow's own data, and " +
        'is not gated by Dayflow\'s edits switch.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: "'list' | 'propose' | 'decide' | 'unsuppress'",
        },
        kind: {
          type: 'string',
          description: `propose/list: ${KIND_DESCRIPTION}.`,
        },
        title: { type: 'string', description: 'propose: the one-line summary the user decides on.' },
        body: { type: 'string', description: 'propose: the short brief behind the item, if it needs one.' },
        confidence: {
          type: 'number',
          description: 'propose: 0..1; below 0.5 the item is dropped instead of queued. Defaults to 0.7.',
        },
        source_day: {
          type: 'string',
          description: 'propose: the day the evidence comes from, YYYY-MM-DD.',
        },
        source_activity_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: 'propose: record IDs from dayflow_timeline that back the item.',
        },
        evidence: { type: 'string', description: 'propose: what in the recorded data supports the item.' },
        loop_occurrences: { type: 'integer', description: 'loop: how many times the pattern occurred.' },
        loop_span_days: { type: 'integer', description: 'loop: over how many days the pattern repeated.' },
        loop_trigger: { type: 'string', description: "loop: 'event' | 'schedule'" },
        status: {
          type: 'string',
          description: "list: 'proposed' | 'kept' | 'discarded' | 'accepted' | 'rejected'. Defaults to proposed.",
        },
        limit: { type: 'integer', description: 'list: maximum rows, 1..200. Defaults to 50.' },
        id: { type: 'integer', description: 'decide/unsuppress: the review item id from list.' },
        decision: {
          type: 'string',
          description: "decide: 'keep' | 'accept' | 'discard' | 'reject'. Only after the user agrees.",
        },
        forever: {
          type: 'boolean',
          description: 'decide: hard-suppress a discard/reject so the item never returns. Only when the user asks.',
        },
        note: { type: 'string', description: "decide: a short note recording the user's reason." },
        confirm: {
          type: 'boolean',
          description: 'decide/unsuppress: true once the user has explicitly agreed to this decision.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          { type: 'text', text: renderReview(value as unknown as ReviewToolPayload) },
        ],
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        switch (args.action) {
          case 'list': {
            const filter: { kind?: ReviewKind; status?: ReviewStatus; limit?: number } = {};
            if (args.kind !== undefined) filter.kind = args.kind as ReviewKind;
            if (args.status !== undefined) filter.status = args.status as ReviewStatus;
            if (args.limit !== undefined) filter.limit = args.limit;
            const items = withJournal(runtime.config.journalPath, (db) => listReviewItems(db, filter));
            const payload: ReviewToolPayload = { action: 'list', items, hint: LIST_HINT };
            return jsonValue(payload);
          }

          case 'propose': {
            const input: ReviewProposalInput = {
              kind: requiredKind(args.kind),
              title: requiredTitle(args.title),
              ...(args.body === undefined ? {} : { body: args.body }),
              ...(args.confidence === undefined ? {} : { confidence: args.confidence }),
              ...(args.source_day === undefined ? {} : { source_day: args.source_day }),
              ...(args.source_activity_ids === undefined
                ? {}
                : { source_activity_ids: args.source_activity_ids }),
              ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
              ...(args.loop_occurrences === undefined ? {} : { loop_occurrences: args.loop_occurrences }),
              ...(args.loop_span_days === undefined ? {} : { loop_span_days: args.loop_span_days }),
              ...(args.loop_trigger === undefined ? {} : { loop_trigger: args.loop_trigger as ReviewTrigger }),
            };
            const result = withJournalWrite(runtime.config.journalPath, (db) =>
              proposeReviewItem(db, input),
            );
            return jsonValue(proposeResultPayload(result.dropped, result.item, result.reason));
          }

          case 'decide': {
            const id = args.id;
            if (id === undefined) {
              throw invalidInput('decide needs the id of a review item; list returns the ids.');
            }
            const decision = args.decision?.trim();
            if (decision === undefined || decision === '') {
              throw invalidInput("decide needs a decision: 'keep' | 'accept' | 'discard' | 'reject'.");
            }
            if (args.confirm !== true) {
              throw invalidInput(
                'A decision belongs to the user: get their explicit agreement first, then pass confirm: true. Nothing was changed.',
              );
            }
            const item = withJournalWrite(runtime.config.journalPath, (db) =>
              decideReviewItem(db, id, decision as ReviewDecision, {
                ...(args.forever === undefined ? {} : { forever: args.forever }),
                ...(args.note === undefined ? {} : { note: args.note }),
              }),
            );
            const payload: ReviewToolPayload = { action: 'decide', item, hint: DECIDE_HINT };
            return jsonValue(payload);
          }

          case 'unsuppress': {
            const id = args.id;
            if (id === undefined) {
              throw invalidInput('unsuppress needs the id of a review item; list returns the ids.');
            }
            if (args.confirm !== true) {
              throw invalidInput(
                'Clearing a suppression belongs to the user: get their agreement first, then pass confirm: true. Nothing was changed.',
              );
            }
            const item = withJournalWrite(runtime.config.journalPath, (db) =>
              unsuppressReviewItem(db, id),
            );
            const payload: ReviewToolPayload = { action: 'unsuppress', item, hint: UNSUPPRESS_HINT };
            return jsonValue(payload);
          }

          default:
            throw invalidInput(
              `Unknown action "${args.action}": use list, propose, decide, or unsuppress.`,
            );
        }
      },
      presentCall: (args) => {
        switch (args.action) {
          case 'list':
            return {
              card: 'generic' as const,
              kind: 'read' as const,
              title: `Review queue · ${args.kind ?? 'all'}${args.status === undefined ? '' : ` · ${args.status}`}`,
            };
          case 'propose':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Propose review item${args.title === undefined ? '' : ` · ${args.title}`}`,
            };
          case 'decide':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Decide review item #${args.id ?? '?'}${args.decision === undefined ? '' : ` · ${args.decision}`}`,
            };
          case 'unsuppress':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Clear review suppression #${args.id ?? '?'}`,
            };
          default:
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Review queue · ${args.action}`,
            };
        }
      },
    }),
  ];
}
