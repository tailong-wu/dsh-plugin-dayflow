# Tools

[← Back to README](../README.md)

Every tool returns structured JSON and renders the same data as compact text.
Dates are `YYYY-MM-DD` and mean a Dayflow day, which starts at **4 AM**.

## Read tools

| Tool | Arguments | Answers |
| --- | --- | --- |
| `dayflow_timeline` | `date?` | What happened on one day, with record IDs. |
| `dayflow_activity` | `record_id` | One activity in full, including its long write-up. |
| `dayflow_breakdown` | `from`, `to` | Time per category over a range, with shares. |
| `dayflow_search` | `query`, `limit?` | Activities whose title or summary matches. |
| `dayflow_daily` | `date?` | The Daily standup Dayflow generated. |
| `dayflow_weekly` | `date?` | Tracked and focus minutes plus category totals for a week. |
| `dayflow_categories` | — | The user's categories, colors, and flags. |
| `dayflow_status` | — | Capture freshness, analysis backlog, edit switch, edit-bridge state. |
| `dayflow_journal` | `date?` | The user's own journal entry for a day: intentions, notes, reflections, summary, status. |
| `dayflow_goals` | `date?` | The day's focus goal and its focus/distraction category split. |
| `dayflow_observations` | `record_id` | The per-observation evidence behind one activity. |
| `dayflow_review_ratings` | `date?` | The user's own focused/distracted marks for a day. |

## Editing tools

These are registered by default and can be switched off with `edits: false`.
Every call is checked against Dayflow's live **Settings → AI Tools → Allow
edits** switch, so a disabled switch produces an actionable error instead of a
stale tool list.

| Tool | Arguments | Effect |
| --- | --- | --- |
| `dayflow_update_activity` | `record_id`, `title?`, `category?` | Retitle or recategorize one activity. |
| `dayflow_delete_activity` | `record_id` | Delete an activity and its observations. Destructive. |
| `dayflow_create_category` | `name`, `color?`, `description?` | Add a category. |
| `dayflow_update_category` | `name`, `new_name?`, `color?`, `description?` | Rename, recolor, or describe. |
| `dayflow_delete_category` | `name` | Delete a category. Destructive. |
| `dayflow_set_goal` | `date?`, `focus_minutes`, … | Set a day's focus target and limits. |

## Journal tool

| Tool | Arguments | Effect |
| --- | --- | --- |
| `journal_import` | `source_path?`, `source_id?` | Import a Dayflow `chunks.sqlite` into the owned journal, idempotently and with a skip report. |

## Review queue tool

The review queue is where the agent keeps what it noticed and wants to carry
forward: a **distillation** (a lesson worth keeping), a **loop** (a pattern that
keeps repeating), an **improvement** (a concrete change to the setup), or a
**task proposal** (work that should become a task). The agent may only propose;
the user decides. It lives in the plugin-owned journal (schema version 7), not
in Dayflow, and is not gated by Dayflow's edits switch.

| Tool | Arguments | Effect |
| --- | --- | --- |
| `journal_review` | `action`, `kind?`, `title?`, … | `list` reads the queue; `propose` adds an item with evidence and confidence; `decide` records the user's keep/accept/discard/reject; `unsuppress` clears a permanent suppression. |

A plain discard or reject is **soft**: the same idea may come back once the
evidence is materially new (a different day, a higher confidence, more
occurrences). Only `forever: true`, with the user's agreement, hard-suppresses
an item by its fingerprint. `decide` and `unsuppress` refuse to run without
`confirm: true`.

## Long tasks

A **long task** is a goal that outlives a day. Accepting a `task_proposal` in the
review queue creates one automatically; the user can also create one directly.
Every task keeps a progress trail of **sessions** — the minutes and activity
records a day contributed — and an active task with no session for more than
seven days is reported as stalled.

| Tool | Arguments | Effect |
| --- | --- | --- |
| `journal_task` | `action`, `title?`, `id?`, `day?`, … | `create`/`list`/`get`/`update` manage tasks, progress, and status; `attach`/`detach` record or correct one day's session; `suggest` explains which of a day's activities match which task (category +2, app +1, threshold 2) without writing anything. |

The panel's history scan is the user-facing half of the same evidence idea as
`journal_task` `action: "suggest"`: both read a day's activities, score the
match, and show the reason rather than writing silently. The difference is
scope: `suggest` stays day by day and explainable, while the scan runs once over
the last 14 days when a task is created and writes only the days the user
confirms.

Agent-noticed work must go through the review queue first (`task_proposal`);
only an accepted proposal, or an explicit user request, creates a task.

## Memory

Memory is the plugin's long-term, **dated** history of what it learned about the
user: preferences, lessons, recurring loops, and corrections. Every claim carries
the day it describes (`observed_on`), never just "the present", so an old claim
can be read as what was true then. Changing something appends a new claim and
marks the old one superseded; the old row is kept, not rewritten. Kept
distillations and loops from the review queue become memory automatically.

| Tool | Arguments | Effect |
| --- | --- | --- |
| `journal_memory` | `action`, `query?`, `kind?`, `id?`, … | `add` writes a dated claim; `search` and `list` read claims (superseded ones hidden by default); `supersede` appends the new version and marks the old one; `forget` deletes a claim and needs `confirm: true`; `lint` reports contradictions, claims overtaken by newer evidence, unsourced claims, and aged claims without changing anything. |

Search uses SQLite FTS5 when the runtime has it and falls back to `LIKE` when it
does not, so the tool works on the older Node builds the plugin still supports.

`journal_memory` with `action: "lint"` is a read-only health check for the
store: it reports claims that contradict each other, older claims that a newer
claim has overtaken, claims with no source to trace, and claims older than 180
days. Nothing is repaired automatically — a finding is a decision for the user.

## Reflections

A reflection is a compact summary of a day or a week written back into the owned
journal: what happened, what repeated, what stalled. The next session reads it
instead of replaying the raw timeline. Saving the same period again edits the
existing reflection; a week may be addressed by any day inside it and is
normalized to its Monday.

| Tool | Arguments | Effect |
| --- | --- | --- |
| `journal_reflection` | `action`, `kind?`, `period?`, `body?`, … | `save` writes or edits a day/week reflection; `get`/`list` read stored reflections; `delete` removes one and needs `confirm: true`. |

## Mapping from Dayflow's own MCP server

If you used Dayflow's `dayflow mcp` server, the tools are the same operations
under a `dayflow_` prefix:

| This plugin | Dayflow MCP |
| --- | --- |
| `dayflow_timeline` | `get_timeline` |
| `dayflow_activity` | `get_activity_detail` |
| `dayflow_breakdown` | `get_time_breakdown` |
| `dayflow_search` | `search_activities` |
| `dayflow_daily` | `get_daily` |
| `dayflow_weekly` | `get_weekly` |
| `dayflow_categories` | `list_categories` |
| `dayflow_status` | `get_status` |
| `dayflow_update_activity` | `update_activity` |
| `dayflow_delete_activity` | `delete_activity` |
| `dayflow_create_category` | `create_category` |
| `dayflow_update_category` | `update_category` |
| `dayflow_delete_category` | `delete_category` |
| `dayflow_set_goal` | `set_day_goal` |

The rest have no counterpart there: `dayflow_journal`, `dayflow_goals`,
`dayflow_observations`, and `dayflow_review_ratings` read the app tables the MCP
server never exposed, while the five `journal_*` tools (`journal_import`,
`journal_review`, `journal_task`, `journal_memory`, `journal_reflection`) only
read and write the plugin-owned journal.
