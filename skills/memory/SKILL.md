---
name: memory
description: The journal's dated record of how this user works. Search it before answering what the user usually does or how something went before, write a dated claim when a preference or correction is worth keeping long-term, backfill memory from the past few days when the user asks what was missed, and forget a claim only when the user asks. Use when the user asks "what did I do last time", "how do I usually…", when a durable lesson or preference should be remembered, when the user asks to backfill recent memory, or when they ask to forget a memory.
---

# Memory

Memory is the journal's record of how this user works: short claims, each
stamped with the day it describes. The only tool is `journal_memory`; the
review queue that feeds it is `journal_review`.

## Memory is history, not the present

The journal is always behind reality, and it cannot know when it has fallen
behind. So every claim carries `observed_on` — the day the claim describes, not
the day you write it down:

- Say "on 2026-10-13, the release script did not gate on the tag", never "the
  release script does not gate on the tag".
- Do not treat an old claim as current. Read it with its date and say when it
  was observed.
- If you do not know the day, do not write the claim. An undated memory is the
  confidently-wrong memory.
- `recorded_at` is for audit; never present it as the observation date.

## Search first, then write

Before adding anything, `journal_memory search` for the subject. The store is
small and a near-duplicate is noise.

- Nothing on the subject → `add` one dated claim, with the `kind` that fits and
  a `confidence` that reflects the evidence (0.5 for a single weak hint, 0.9 for
  something the user said plainly).
- A claim on the subject that is still true → leave it alone.
- A claim on the subject that has changed → `supersede` it: the new claim is
  appended and the old one is marked replaced, and the old row stays for
  traceability. Never edit or rewrite an old claim; the tool does not allow it.
- `search` and `list` hide superseded claims unless `include_superseded: true`;
  ask for history only when the question is about the past.

## The kinds

- `distillation` — one lesson or fact about how this user works, worth carrying
  forward.
- `preference` — how the user likes things done: tools, formats, timing, tone.
- `correction` — something the user corrected the agent on; keep the correction,
  not the mistake.
- `loop` — a pattern that keeps repeating; supersede it as the count or span
  changes.

## Forgetting is the user's decision

`forget` hard-deletes a claim and cannot be undone, so only call it when the
user explicitly asks to forget that memory, and pass `confirm: true` only after
they have agreed. A claim that a newer claim points at through `superseded_by`
cannot be forgotten directly: deal with the newer claim's reference chain
first. Do not forget a claim just because it is old or awkward.

## The review queue feeds memory

A `distillation` or `loop` the user keeps with `journal_review` is written to
memory automatically as a dated claim, linked to the review item. Do not add it
again by hand. When a kept item is later corrected, supersede its claim rather
than adding a second copy.

## Reading memory back

When the user asks "what did I do last time…" or "how do I usually…", search
first and answer with the dates: "on 2026-10-13, …". If memory has nothing, say
so and read the timeline instead of guessing.

## Backfilling memory (回看补充)

The user may ask you to look back and fill in what the journal missed: "backfill
memory", "write down what was missed lately", "how do I usually… go check", or
「回看补充记忆」「把最近漏掉的记下来」. That is a reading pass plus a writing
pass, not a dump of everything you noticed.

1. **Read what memory already says.** `journal_memory list`, and
   `journal_memory search` for the subject, first: a backfill adds what is
   missing, it does not re-add what is already there.
2. **Look back over the last 3–7 days.** `dayflow_timeline` for each day; use
   `dayflow_weekly` for the shape of the week, and `journal_task list` when the
   question is about a long task. A day runs 04:00 to 04:00 local time.
3. **Keep only what is durable.** A preference, a repeated way of working, or a
   correction the user made. Each candidate becomes one claim whose
   `observed_on` is the day it was seen, written "on <date>, …".
4. **Confirm before writing.** List no more than 3–5 candidates for the user,
   each with its date and the evidence behind it, and wait for agreement. Then
   `journal_memory add` each accepted claim with `source_days` set to the days
   that back it.
5. **Supersede, do not rewrite.** When a candidate is a newer version of a claim
   already stored, use `journal_memory supersede`; the old row stays.
6. **Lint the result.** Finish with `journal_memory lint` and report what it
   found — contradictions, unsourced claims, aged claims — to the user.

At most five new claims per backfill. No claim without enough evidence; an
inference is reported to the user, never stored as fact. If the timeline holds
nothing durable, say so and write nothing.

Only the tools `journal_memory` and `journal_review` write here; the backfill
pass also reads `dayflow_timeline`, `dayflow_weekly`, and `journal_task list` for
evidence, and those reads change nothing.
