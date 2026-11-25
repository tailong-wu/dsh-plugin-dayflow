---
name: review-queue
description: After a task or a weekly review, put the lessons worth keeping, the patterns that keep repeating, and the actionable improvements into the review queue and let the user decide. Use when the user asks for a retrospective, lessons learned, a loop that keeps coming back, or an improvement worth making.
---

# Review queue

The review queue is the agent's own memory: it holds what the agent noticed and
wants to keep, and the user is the one who decides what happens to it. The only
tool is `journal_review`.

## Propose only what the evidence supports

Read the day's timeline, the user's notes, and the outcome of the work before
proposing anything. A proposal without evidence is noise, and the queue is one
of the few places where noise costs the user real attention.

- Every proposal carries `source_day`, `evidence`, and `confidence` (0.5 or
  higher; below that the queue drops it instead of storing it).
- At most five proposals per day. When a day already holds five, stop and let
  the user work through them.
- If nothing is worth keeping, say so plainly: "Nothing worth keeping today."
  An empty day is a normal result, not a failure to find something.

## The four kinds

- `distillation` — one lesson, preference, or fact about how this user works
  that is worth carrying forward. Keep it short enough to paste into a brief
  later.
- `loop` — a pattern that keeps repeating (the same bug, the same detour, the
  same kind of interruption). Always give `loop_occurrences`,
  `loop_span_days`, and `loop_trigger` (`event` or `schedule`); a loop without
  its counts is just a complaint.
- `improvement` — a concrete change to the agent's own environment, prompts,
  tools, or workflow that would remove friction the evidence shows.
- `task_proposal` — work that should exist as a task but does not yet. It stays
  a proposal until the user accepts it; never create the task silently.

## Push right

Push right means the agent does the reading, not the asking. Collect the
evidence, write the one-line title and the short brief first, then present the
items together and ask once for the decisions. One item gets one decision.
Never walk the user through the queue one question at a time.

## The user decides

The agent may only propose. `decide` and `unsuppress` change what the user sees,
so they need the user's explicit agreement and `confirm: true`; without it the
call is refused and nothing changes.

- `keep` / `discard` for a distillation or a loop; `accept` / `reject` for an
  improvement or a task proposal.
- `discard` and `reject` are soft by default: the same item may come back if
  substantial new evidence appears. Use `forever: true` only when the user says
  not to bring it up again.
- A hard-suppressed item never comes back on its own. If the user changes their
  mind, clear the suppression with `unsuppress` and `confirm: true`, again only
  after they ask for it.

Record the user's reason in `note` when they give one, so the next review does
not ask the same question twice.
