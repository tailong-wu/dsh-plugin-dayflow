# Quick capture

[← Back to README](../README.md)

There is more than one way to put something into the owned journal. Two
shortcuts skip the conversation entirely; the third gives the agent the structure
only a conversation can. None of them adds a second UI entry.

## Slash commands

When the host exposes a command registry, the plugin registers three commands
that write straight to the owned journal: no model turn, no tool call, and not
gated by Dayflow's edit switch.

| Command | What it writes |
| --- | --- |
| `/dayflow-task <title>` | A long task with that title. |
| `/dayflow-remember <text>` | A `preference` claim dated today (a Dayflow day, which starts at 04:00). |
| `/dayflow-reflect <text>` | The text appended to the current day's saved reflection, created when none is saved yet. |

The journal is created on the first write. A host without a command registry
skips the commands; the same writes are still available through the tools.

## Panel inline add

The **Journal insights** view is a read-only view of the owned journal with one
exception: it can add. The task, memory, and reflection blocks each end with a
ToDo-style input row. Type into it and press Enter (or click **Add**); the row
submits a small `POST` request to the panel API and the list refreshes.

The rows only add: a task title, a `preference` claim dated today (the current
Dayflow day), or a line appended to today's reflection. Nothing in the panel
edits or deletes an existing entry, and the review queue has no add row at all —
it is fed by the agent's proposals, and the keep/accept/discard/reject decision
belongs to the user.

Adding a task this way raises one follow-up question. After the task appears,
the panel offers a history **scan** of the last **14 days** of recorded activity,
and then a **link** of the days that match the task. The scan is a read-only
**preview** — it matches a day's activities by the task's title keywords,
together with the task's own category and app signals, and lists one line per
candidate day with the date, the minutes, and the matched titles. Nothing is
written until the user confirms; linking then records those days as the task's
**sessions**. A second link for the same day replaces that day's session instead
of adding a second one. The scan reads activity from whichever backend is active
(the Dayflow app database, or an imported owned journal), so a profile with no
import and no activity simply gets an empty result.

## Conversation

Anything richer than a title goes through the conversation: the agent uses
`journal_task`, `journal_memory`, and `journal_reflection` with the arguments the
situation needs (evidence, dates, minutes). When several days of patterns are
what should be captured, the `memory` skill's **Backfilling memory** workflow
reads the last 3–7 days of `dayflow_timeline`, proposes a small set of dated
claims (three to five at most) for the user to confirm, writes only the accepted
ones, and finishes with `journal_memory lint`.

The plugin keeps exactly one Harness UI entry: one conversation-header button
and one panel tab. Slash commands are commands, not UI entries, and
**Journal insights** is a view inside that tab rather than a second one.
