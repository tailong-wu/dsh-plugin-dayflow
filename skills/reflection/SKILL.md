---
name: reflection
description: Compress a day or a week into one short dated reflection and save it in the journal, so a later session retrieves the summary instead of replaying the raw timeline. Use at the end of a day or week, or before answering "how did last week go" when a saved reflection may already exist.
---

# Reflection

A reflection is the journal's compressed record of one day or one week: what
happened, what repeated, and what stalled. The only tool is
`journal_reflection`; the timeline tools supply the evidence it is built from.

## Read before writing

Before generating anything, `journal_reflection get` the period (or `list`
recent reflections) and check whether one is already stored.

- Found — read it. It was written from the timeline at that time, so answer from
  it instead of re-deriving the same summary. If the user wants a change, `save`
  the same kind and period to edit it.
- Not found — build it from the data, then save the result.

Never invent a reflection: `found: false` means nothing has been written for
that period yet, and the next session will not find one either.

## Build it from the data

Read the evidence before writing:

- `dayflow_timeline` for a day; `dayflow_weekly` and `dayflow_breakdown` for a
  week.
- `journal_task list` for long tasks still in flight, especially the stalled
  ones (no session for more than seven days).

Then write three short sections:

1. **What happened** — the few things that actually consumed the day or week,
   each with its date, not every activity.
2. **What repeated** — the pattern that showed up more than once.
3. **What stalled** — the work that did not move, plus the next concrete step.

Keep the body compact — about 15 lines at most — and dated, for example
`2026-10-19: shipped the importer, then lost the afternoon to the fixture`. A
reflection is a summary, not a re-listing: do not restate each activity and do
not paste the timeline into it.

## Saving

- `kind: 'day'` with `period` as `YYYY-MM-DD`.
- `kind: 'week'` with `period` as any day inside the week; the store normalizes
  it to that week's Monday, so any day of the same week hits the same row.
- Saving the same kind and period again edits the existing reflection — it is
  updated, not duplicated — so a correction is one save, not a delete and an
  add.
- `highlights` are the few lines worth carrying forward; `source_days` and
  `source_activity_ids` record which days and activities the reflection came
  from, so the summary stays traceable.

## Deleting is the user's decision

A deletion cannot be undone. Only `delete` when the user explicitly asks to
remove that reflection, and then pass `confirm: true` after they agree. Never
delete on your own initiative, and never delete as a way to rewrite: `save` is
the edit path.

Only the tools `journal_reflection`, `dayflow_timeline`, `dayflow_weekly`,
`dayflow_breakdown`, and `journal_task` are used here.
