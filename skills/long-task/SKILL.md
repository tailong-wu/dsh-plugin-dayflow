---
name: long-task
description: Track the user's goals that outlive a day: read progress and stalled tasks, match a day's activities to the task they advanced, and record the sessions that build the evidence trail. Use when the user is working on a multi-day goal, asks how a long-running project is going, or when an accepted task_proposal needs to be tracked.
---

# Long tasks

A long task is a goal that outlives a day: "port the recorder", "finish the
paper", "get the plugin published". The user defines it once; from then on the
task holds the evidence of the days spent on it. The only tool is
`journal_task`; the review queue is `journal_review`.

## The task belongs to the user

A task exists because the user said so. When you notice work forming a goal —
"four sessions this week, all on the same migration" — do not create the task
yourself. Propose it with `journal_review` as a `task_proposal`, with the
evidence, and let the user accept or reject it. Accepting creates the task
automatically, with `origin: "agent"`; the tool reports which task was created.
Creating a task directly is for the case where the user explicitly asks for one.

## Read the trail before claiming progress

`journal_task list` shows the tasks and their totals; `journal_task get` shows
one task with its sessions, one line per day. A task counts as **stalled** when
it is active and has had no session for more than seven days. Raise stalled
tasks in the weekly review: ask whether to continue, pause, or drop one instead
of assuming.

## Sessions are the evidence

A session is one day's minutes plus the activity record IDs that back them.
After a working session or a review:

1. `journal_task suggest` for the day, to see which tasks that day's activities
   actually advanced. The match is explainable: category overlap scores 2, each
   shared app scores 1, and only a score of 2 or more is a candidate.
2. Attach only the candidates the evidence supports, with `minutes`, the
   `activity_ids` from `dayflow_timeline`, and a short `note` on what advanced.
   Never guess: an unattached day is better than an invented one.
3. Attaching the same day again replaces that day's session, so a correction
   never doubles the minutes. Use `detach` to remove a day that was attached by
   mistake.

The suggestion pass writes nothing; it is a reading aid, and the attachment is
your claim about the data, not the user's.

## Keep the status honest

Change a task's status with `journal_task update` only when the decision is
real: `done` when the goal is reached, `dropped` when the user abandons it,
`paused` when it is set aside for now. Do not mark a task done on your own read
of the activity trail — the completion is the user's call.

## In the review

When proposing a `task_proposal`, give it `source_day`, `evidence`, and a
confidence of 0.5 or higher. The accepted task keeps a link back to the review
item, so "why does this task exist" stays answerable. If you later look at a
stalled task, the review queue is also the place for the next concrete step:
propose it as an `improvement` rather than editing the task yourself.
