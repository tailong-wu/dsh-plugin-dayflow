/**
 * The composed review decisions, shared by the `journal_review` tool and the
 * panel's decision route.
 *
 * Recording a decision is never just one row: accepting a task proposal also
 * creates the long task, and keeping a distillation or loop also writes the
 * dated memory claim. The tool and the panel must not grow two copies of that
 * rule, so both call {@link applyReviewDecision} inside one write connection and
 * the item, its task, and its claim are written together or not at all.
 * @module dsh-plugin-dayflow/review-actions
 */

import type { DatabaseSync } from 'node:sqlite';

import { createMemoryFromReviewItem } from './memory.js';
import type { MemoryClaimPayload } from './memory.js';
import { decideReviewItem } from './review.js';
import type { ReviewItemPayload } from './review.js';
import { createTaskFromReviewItem } from './tasks.js';
import type { LongTaskPayload } from './tasks.js';

/** The four decisions a review item can receive. */
export type ReviewDecision = 'keep' | 'accept' | 'discard' | 'reject';

/**
 * What one decision wrote: the decided item, plus the long task an accepted
 * task proposal created and the memory claim a kept distillation or loop wrote.
 * The optional payloads are present only when the decision implied one.
 */
export interface ReviewDecisionOutcome {
  item: ReviewItemPayload;
  task?: LongTaskPayload;
  memory?: MemoryClaimPayload;
}

/**
 * Record the user's decision on one review item and everything it implies.
 *
 * The caller owns the transaction: pass the write connection and expect the
 * item, the task, and the memory claim to land in one atomic act. The decision
 * rules themselves live in {@link decideReviewItem}; this composes them with
 * the two side effects the tool and the panel route both need.
 * @param db - the owned journal's write connection.
 * @param id - the review item's id.
 * @param decision - keep, accept, discard, or reject; the kind must allow it.
 * @param options - `forever` hard-suppresses a negative decision, `note` records why.
 * @returns the decided item and the task and memory claim it created, if any.
 */
export function applyReviewDecision(
  db: DatabaseSync,
  id: number,
  decision: ReviewDecision,
  options: { forever?: boolean; note?: string } = {},
): ReviewDecisionOutcome {
  const item = decideReviewItem(db, id, decision, options ?? {});
  const outcome: ReviewDecisionOutcome = { item };
  // Accepting a task proposal creates the task in the same write connection,
  // so the decision and the task cannot diverge.
  if (item.kind === 'task_proposal' && item.status === 'accepted') {
    outcome.task = createTaskFromReviewItem(db, item);
  }
  // A kept distillation or loop becomes a dated memory claim in the same write
  // connection, so the user's keep and the memory it implies are one atomic act.
  if (item.status === 'kept' && (item.kind === 'distillation' || item.kind === 'loop')) {
    outcome.memory = createMemoryFromReviewItem(db, {
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      source_day: item.source_day,
      confidence: item.confidence,
    });
  }
  return outcome;
}
