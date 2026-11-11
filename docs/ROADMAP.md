# Roadmap: from a Dayflow reader to a personal agent memory

> Status: Phase 1+2 foundation is implemented in the 0.6.0 development line;
> later phases remain proposals.
> Last revised: 2026-10-28 (implementation note added 2026-11-10).

## Where this starts

`dsh-plugin-dayflow` started as a **reader**: 14 Dayflow tools, 4 skills, one panel, all
pointed at the Dayflow Mac app's SQLite file and its `agent.sock` write bridge.
That was the right first version, and it proved the data is worth reading. It is
the wrong long-term shape, for two reasons the owner named:

1. **Two dependencies to stay alive for one product.** The plugin cannot record,
   cannot analyze, and cannot run without the app; the app knows nothing about
   the harness. Every Dayflow release can move the schema under us, and every
   harness release can move the plugin surface under us. Two moving floors.
2. **The journal is a means, not the product.** The point of the work log is not
   the calendar. It is that a personal agent should get better at helping *this*
   person — remembering how they work, what they repeat, what they keep putting
   off — and the log is the raw material for that.

So the target is not "Dayflow, but inside dsh". It is: **the plugin owns the
journal, and the journal teaches the agent.**

## What is actually portable, measured

Upstream is MIT-licensed; I cloned it and measured rather than guessed.

| Area | Lines (Swift) | Portable into a Node plugin? |
| --- | ---: | --- |
| Views / SwiftUI UI | 54,650 | **No.** Different UI runtime; the panel is React already. |
| Core/AI (providers, prompts, parsing) | 22,663 | **Partly.** The *prompt design* is reusable knowledge; the code is not. |
| Core/Recording (ScreenCaptureKit) | 7,468 | **No.** Needs screen-recording permission and a resident process. |
| Core/Flow (voice planning) | 3,334 | **No.** Needs the microphone. |
| Core/Weekly + DailyBrief | 5,191 | **Yes, logic.** Pure aggregation over the database. |
| Core/AgentAccess (Codex/Claude session logs) | 1,239 | **Yes.** Plain files on disk. |
| Storage / models / migrations | ~2,000 | **Yes, schema and semantics.** |

Roughly 88% of upstream is capture, native UI, or provider plumbing that cannot
cross the language and permission boundary. What crosses is the **data model**,
the **aggregation logic**, and the **prompt design** — which is exactly the part
that matters for memory. That is good news: the hard, valuable part is the
portable part.

## The decision this roadmap is built on

**Recording stays out of scope, permanently.** A dsh plugin runs inside the
harness process; it has no business asking for screen-recording or microphone
permission, and a background capture daemon is a different product with a
different install story.

The plugin therefore becomes an **owner of the journal, not a capturer of it**.
Entries arrive by one of three doors, and the schema does not care which:

1. **Import** from an existing Dayflow database (one command, lossless).
2. **Agent-written**: the agent records what it just did, from the transcript it
   already has, through `journal_*` tools.
3. **User-written**: the person types an entry, or a future capture tool (of
   theirs or yours) appends observations through the same public interface.

That is the clean break: after phase 2 the plugin never opens Dayflow's file
again, and Dayflow becomes just one of the import sources.

## Phases

Each phase is shippable on its own and leaves the plugin working. Later phases
are not blocked on earlier ones being *finished*, only on their schema landing.

### Phase 1 — Own the schema (foundation)

The point of this phase is that the plugin stops being a guest in someone else's
database.

- Adopt a plugin-owned SQLite file (`$DSH_HOME/dayflow/journal.sqlite` or a
  configurable path), with a schema that generalizes Dayflow's:
  `days`, `activities`, `observations`, `categories`, `goals`, `journal_entries`,
  `reviews`, `sources`. Keep Dayflow's semantics where they are good — the 4 AM
  day boundary, `System` excluded from totals, `Idle` meaning *no capture*.
- Add a `schema_version` table and a forward-only migration runner from day one.
  This is the piece that was missing the first time and is the whole reason the
  plugin is fragile today.
- Keep the current Dayflow reader behind a `source: 'dayflow'` adapter that
  satisfies the same interface the new store does, so both can be live at once
  and the tools do not fork.

**Exit criteria:** the same 14 tools answer from either backend, with a test
that runs the read suite twice — once against the Dayflow fixture, once against
the owned store — and gets identical payloads.

### Phase 2 — Import, then cut the cord

- `journal_import` / `dsh dayflow import`: read a Dayflow database and write it
  into the owned store, losslessly for `timeline_cards`, `observations`,
  `daily_standup_entries`, `day_goals`, `day_goal_categories`,
  `timeline_review_ratings`, `journal_entries`, and the category colors.
- Report what it imported and what it deliberately skipped (credentials in
  `llm_calls`, chat history containing private text) rather than silently
  dropping it.
- Idempotent: re-running must not duplicate. Import is keyed on the source's
  stable ids, recorded in a `sources` map.
- After this phase, a config flag `dayflow: false` makes the plugin run with no
  Dayflow install at all. **This is the "no more double dependency" milestone.**

**Exit criteria:** on a machine with Dayflow uninstalled, the panel and every
read tool work from the imported store; the test for it deletes the Dayflow path
and asserts the tools still answer.

### Phase 3 — Close the read gap (new tools, small increments)

These are the surfaces Dayflow has and the plugin never exposed. Each is a
read-only tool plus a renderer; each is independently shippable.

- `journal_entry` — read and write the daily journal (intentions, notes,
  reflections, summary, status). **Write path needs investigating**: the
  Dayflow bridge exposes `activity_*`, `category_*`, `goal_set` but no journal
  operation, so today this is read-only. In the owned store it becomes writable
  because the plugin owns the file.
- `observations` — the per-observation record (788 rows on this Mac, ~2.2 per
  activity). It is the evidence behind a card; `dayflow_activity` should be able
  to show it.
- `review_ratings` — the user's own focused/distracted marks (29 on this Mac).
  A weekly review that can cite the user's judgement is much better than one
  that only counts minutes.
- `goal_categories` — goals currently write `day_goals` but not
  `day_goal_categories`, so the focus/distraction split is lost.

**Exit criteria:** each tool has a fixture case and a failure case; the panel
gains the goal and review surfaces it already has data for.

### Phase 3.5 — Reviewing: two different things, separated

Dayflow has one review surface — swipe through the day's activity cards and rate
each `focused` / `neutral` / `distracted`. I read the implementation before
planning this, because its shape explains why it should not stay the centre of
the product.

**How Dayflow does it (for reference):**

| Piece | File | What it does |
| --- | --- | --- |
| Rating store | `Core/Recording/StorageManager+TimelineReview.swift` | `timeline_review_ratings(start_ts, end_ts, rating)`; a rating **splits** overlapping segments and re-inserts the leftovers, so ratings tile the timeline without overlapping |
| "Cards to review" count | same file, `fetchUnreviewedTimelineCardCount(forDay:coverageThreshold:)` | A card counts as unreviewed when less than **80%** of its duration is covered by any rating; `System` cards are skipped |
| Prompt gating | `Views/UI/MainView/Layout+Panels.swift`, `cardsToReviewPromptCount` | The badge only appears if there are unreviewed cards **and** the user has rated recently (or never rated at all) |
| Badge | `Views/Components/CardsToReviewBadge.swift` | Orange→lilac pill, stacked-cards icon with the count, label "Review cards" |
| Swipe UI | `Views/UI/TimelineReviewOverlay.swift` + `TimelineReviewCard/Chrome/Scrubber`, 2,704 lines total | Tinder-style card stack, drag to rate, per-card screen-recording playback, day summary pie at the end |

Two properties of that design matter for us:

1. **It is expensive and it front-loads low-value work.** Rating every card is a
   manual pass over raw activity, and its output is a coarse three-way label.
2. **It is the only thing the product asks the user to review**, so it occupies
   the position where the *valuable* review should be.

**What we keep, and what moves:**

- **Keep** the rating data and the review UI. It answers "was this time well
  spent", it is genuinely useful to review now and then, and the tiling
  semantics in the Swift code above are worth reimplementing faithfully
  (coverage threshold and all).
- **Add** a setting: `review.cards: 'always' | 'never'`. The default is
  **`never`**: no badge, no prompt, no card stack. Someone who wants the old
  ritual can turn it on; nobody is nagged into it.
- **Move the centre.** The review surface that matters is not "rate your
  afternoon". It is a queue of things that must survive the day, in three
  shapes:

  - **Distillations** — an experience the agent believes is worth keeping: "this
    flaky test fails when run in parallel, and serialising it fixed it"; "the
    migration needs a lock or the replica lags". Each arrives as a proposal with
    its evidence (which day, which activities) and a decision: **keep** (it
    becomes memory, retrievable later) or **discard**.
  - **Loops** — a *recurring* pattern, which is the thing a journal is uniquely
    placed to notice and the user usually is not: "every release week, the same
    three checks get run by hand", "the first hour of every day goes to email".
    A loop is the compressed form of many distillations; see the vocabulary
    below. Decision: **keep** (it becomes a standing observation the agent can
    act on) or **discard**.
  - **Improvements** — a concrete change to what the user is working on: "the
    release script does not gate on the tag" → a proposed todo. Decision:
    **accept** (it enters the todo list) or **reject**.

  This is the review that earns its place, because its output is state the agent
  will act on later. The card-stack review produces a label; this produces
  memory and work.

**Vocabulary borrowed from `loop-me`** (mattpocock/skills, MIT). These three
words do real work in the queue design, so they are used with their original
meaning rather than reinvented:

| Term | Meaning here |
| --- | --- |
| **Trigger** | What makes a loop happen again: an **event** (a new issue, a deploy) or a **schedule** (every Monday). Event triggers are usually the more useful signal, because the journal can see them as a repeating sequence. |
| **Checkpoint** | The human decision point. The review queue *is* the checkpoint. |
| **Push right** | Defer the checkpoint as far as it will go: the agent does all the reading, correlation, and drafting first, so the user is asked once, late, with everything prepared. A queue that asks the user to interpret raw activity has pushed left, and is a defect. |
| **Brief** | What a checkpoint shows: a decision-ready summary — what is claimed, why now, and a link down to the evidence. The user reads a brief, not a draft. |

**Push right is a requirement, not a style note.** Each review item must arrive
with its evidence assembled and its confidence stated, and the decision must be
a single act (keep / discard). If understanding an item requires opening the
underlying activities, the item is not ready to be shown.

**A loop is not a long task.** A long task (3.7) has a destination — "ship the
plugin" — and ends. A loop has no destination; it recurs, which is what makes it
worth compressing. The same activity trail can produce both, and that is fine:
the task is what you are doing this month, the loop is how you do this every
month.

**Suggested schema for the review queue** (owned store, phase 1 schema):

```
review_items(id, kind, status, title, body, confidence, source_day,
             source_activity_ids, evidence, created_at, decided_at,
             decision_note, suppression,
             loop_occurrences, loop_span_days, loop_trigger)
  kind    = 'distillation' | 'loop' | 'improvement' | 'task_proposal'
  status  = 'proposed' | 'kept' | 'discarded' | 'accepted' | 'rejected'
  suppression = 'none' | 'soft' | 'hard'   -- see below
  loop_trigger = 'event' | 'schedule' | NULL   -- only for kind = 'loop'
```

`loop_occurrences` and `loop_span_days` are what make a loop arguable: "seen 4
times over 6 weeks" is a claim the user can check, where "you seem to do this a
lot" is not.

`kept` distillations and loops become rows in the memory table (phase 4);
`accepted` improvements become todos; `accepted` task proposals become long
tasks (3.7). All keep a link back to `review_items`, so "why does the agent
believe this" is always answerable.

**Discarding is a choice, not an erasure — decided.** A discarded item records
*how* it was discarded, because "not now" and "never again" are different
answers and the agent should learn the difference:

- **Discard once** (`suppression: 'soft'`) — the default on a plain reject. The
  item does not come back today, but the same idea may be proposed again later
  if the evidence is materially new (a different day, more occurrences, higher
  confidence). This is the right behaviour for "too early to judge".
- **Never propose this again** (`suppression: 'hard'`) — an explicit second
  action next to the plain reject. The agent stores the fingerprint (a
  normalized hash of kind + title + subject) and skips any future proposal that
  matches it, until the user clears the suppression list in settings.

The plain button says Discard; the secondary one says "Discard and don't
suggest again". Making the second choice deliberate is what keeps the first one
cheap.

**Exit criteria:** with `review.cards: 'never'`, the panel shows no card-review
badge anywhere; the distillation, loop, and improvement queues are reachable; deciding
an item changes retrievable state; a `hard`-suppressed item is never re-proposed
(a test replays the same evidence and asserts it is dropped); a `soft`-discarded
item *is* re-proposed when the evidence changes.

### Phase 3.6 — Privacy for cloud summarization

If the screen summary runs on a cloud model, a window the user marked private
must not leave the machine. Dayflow already does the capture-time version of
this, and it is worth copying the mechanism even though our capture lives
elsewhere.

**How Dayflow does it:** `Core/Recording/RecordingPrivacyPreferences.swift` keeps
a blocked bundle-identifier list (seeded with password managers: 1Password,
Bitwarden, Keychain Access, …). In `ScreenRecorder.swift` (around line 557) two
things happen per frame:

```swift
// 1. Foreground app is blocked → never capture the real pixels at all;
//    store a placeholder image instead and keep the duration.
if let blocked = RecordingPrivacyPreferences.frontmostBlockedApplication() {
    let placeholder = RecordingPrivacyPlaceholder.image(width:height:applicationName:)
    try appendFrame(placeholder, ...)
    return .succeeded
}

// 2. Otherwise exclude blocked apps' windows from the SCContentFilter,
//    so a visible-but-background blocked window never appears in the frame.
let excluded = RecordingPrivacyPreferences.blockedScreenCaptureApplications(in: cachedContent)
let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
```

Note what it preserves: the time is still recorded, and a placeholder keeps the
frame count honest. Privacy hides *content*, not *duration*.

**What the plugin does instead** — it does not capture, so the exclusion belongs
at the summarization boundary:

- A `privacy_apps` list in the owned store (bundle id + display name), with the
  same password-manager seed and the same rule: **time is recorded, content is
  not summarized**.
- **Cloud models: redact. Local models: no redaction — decided.** The rule is
  about data leaving the machine, not about the plugin judging what is
  sensitive. An observation whose foreground app is on the list is replaced with
  a fixed placeholder ("private application, content withheld") before any
  request that can cross the network, and is left intact for a model the user
  runs locally. There is no third mode: a local model reading the user's own
  private window on the user's own machine is the point of running it locally.
  If a future provider is ambiguous (a "local" gateway that proxies out), it is
  treated as cloud; the default is the safe side.
- The activity card still exists and still has its duration, so totals and the
  calendar stay correct.

**The honest limitation, which the settings UI must state.** Blocking an app is
a rule about windows; it cannot be a rule about *content*. When a browser is not
blocked, nothing stops a page inside it — a webmail tab, an internal dashboard, a
patient record — from being summarized and sent. The same holds for a terminal
showing secrets, or a chat window with a private conversation. So the setting's
description says, in both languages:

> Marking an app private hides that app's own window from summaries sent to a
> cloud model. It cannot tell what is *inside* a browser tab or a document body.
> If you open private material in an app that is not marked, it will be
> summarized like anything else. Mark the app, or pause recording, when that
> matters.

That sentence is the feature. A privacy control whose limits are unstated is
worse than none, because it buys false confidence.

**Exit criteria:** an observation from a private app never reaches a cloud
request (asserted on the request bodies in a test) and does reach a local-model
request intact; its duration still appears in totals; the settings copy contains
the limitation text.

### Phase 3.7 — Long-horizon task tracking

This is the piece that turns the journal from a record into a collaborator. A
**long task** is a goal that outlives a day: "port the recorder", "finish the
paper", "get the plugin published". The user defines it once; the journal then
recognises when the user is working on it and keeps a progress trail.

- `long_tasks(id, title, description, status, created_at, target_date,
   origin, proposed_by, accepted_at)`
  `origin = 'user' | 'agent'` — **the agent may propose tasks too, decided.**
- `long_task_sessions(id, task_id, day, activity_ids, minutes, note, created_at)`
- A **match setting** per task: how aggressively to claim an activity belongs to
  it. Matching is a small, inspectable step — category and app overlap first,
  then a model call only for the ambiguous cases — never "the model decided".

**Agent-proposed tasks.** Beyond the tasks the user writes, the agent watches for
work that is forming one ("four sessions this week, all on the same migration")
and proposes it as a task. The proposal goes to the **review queue** as
`kind = 'task_proposal'` — the same accept/reject gate as everything else, never
silently created. Accepting sets `origin = 'agent'` and `accepted_at`; the task
then behaves exactly like a user-written one. This is the same principle as the
distillation queue: the agent may notice, only the user may decide.

**In the summarization prompt.** The screen-summary step is where the signal is
freshest, so the prompt carries the active long tasks and is asked to tag each
observation with zero or more task ids, plus whether the work advanced, stalled,
or changed direction. This is the "if it is handling that thing, update the
task" behaviour the owner asked for, and it costs one prompt section, not a
second pipeline.

**Next-step suggestions.** From a task's session trail the agent can propose the
next concrete step ("the last three sessions all ended in the same test failure;
the next step is probably fixing the fixture"). Suggestions are proposals in the
review queue — same accept/reject gate as improvements — never silent edits.

**Exit criteria:** creating a task and working on it for a day produces sessions
attached to it without manual tagging; a task with no activity for N days
surfaces as "stalled"; an agent-proposed task appears in the review queue and
does not exist as a task until accepted; every suggestion lands in the review
queue rather than being applied.

### Phase 4 — The memory layer (the actual product)

This is where the plugin stops being a journal viewer. Three mechanisms, in
increasing ambition. dsh supports all three without forking the host:

**(a) Retrieval, on demand.** A `memory_search` tool over the owned journal:
"what did I do last time I touched auth", "how long do migrations usually take
me". Chunked summaries + FTS5 (SQLite built-in, no dependency) is enough to
start; embeddings are an upgrade, not a prerequisite.

**(b) Injected context, per turn.** `systemPrompt.context({ text })` accepts a
function evaluated at **each assembly**, so the plugin can inject a small,
budgeted "what this person is working on right now" block — current day's
activities, open intentions, last week's recurring pattern — without the model
having to call a tool. This is the mechanism that makes the agent feel like it
remembers. It must be strictly budgeted and cached; the host pays for it every
step.

**(c) Reflections, written back.** After a day or a week, generate a compact
reflection (what happened, what repeated, what stalled) and store it as an
entry in the owned store, not only in the prompt. The next session retrieves it
instead of re-deriving it. **This is the compression the owner asked for**:
patterns are distilled once and reused, instead of replaying raw days forever.

**(d) Memory is written as history, not as the present.** This rule comes from
`chief-of-staff` (mattpocock/skills, MIT) and it is the single most effective
defence against the top risk, memory that is confidently wrong:

- Every stored claim carries the date it was observed: "on 2026-10-13, the
  release script did not gate on the tag", never "the release script does not
  gate on the tag".
- When something changes, **append a new dated claim and mark the old one
  superseded**. Never rewrite an old claim. A memory that mutates is a memory
  whose current value cannot be trusted; a memory that accretes can be read at
  any past date.
- The reason is mechanical, not stylistic: the journal is always behind reality,
  and it cannot know when it has fallen behind. "Currently" is a claim the data
  cannot support. A dated claim is one it can.
- Retrieval therefore returns claims *with* their dates and supersede status, and
  the injected context says "as of <date>" rather than presenting a fact as
  still true. A claim past its usefulness is not deleted; it is superseded or
  aged out by the lint pass below.

**Ingest / Query / Lint.** The memory is maintained by three operations, not
just written to:

- **Ingest** — when something durable is learned (a kept distillation, a new
  loop, a user correction), update every claim it touches, not only add a row.
- **Query** — before proposing anything, read the existing claims; if the answer
  produced is worth keeping, store it rather than leaving it in context.
- **Lint** — a periodic pass (a scheduled job, using `dsh-tool-schedule`) that
  looks for contradictions between claims, claims superseded by newer evidence,
  and claims nothing references. Without this the store only grows; with it, the
  store stays arguable.

**Suggested memory schema** (append-only):

```
memory_claims(id, kind, subject, body, observed_on, recorded_at,
              source_review_item, source_days, confidence,
              superseded_by, superseded_on)
  kind = 'distillation' | 'loop' | 'preference' | 'correction'
  observed_on   -- the day the claim describes (what the user can check)
  recorded_at   -- when the agent wrote it down (for audit, not for reading)
  superseded_by -- the id of the claim that replaced this one, or NULL
```

Every read path filters `superseded_by IS NULL` unless it is deliberately asking
for history. The claim is never updated in place; a change is a new row plus a
pointer.

**Exit criteria:** a fresh session, with no prior conversation, answers "what am
I usually doing at this hour" and "what did I keep postponing" from memory
alone; a test asserts the injected block stays under its byte budget; and a test
asserts that superseding a claim leaves the old row intact with
`superseded_by` set, so retrieval at an older date still answers correctly.

### Phase 5 — Personalization that acts

Only after 4 is trustworthy.

- **Planning**: turn open intentions and observed patterns into proposed tasks
  (the agent already has `dsh-tool-schedule` and a jobs system available).
- **Recaps**: daily/weekly briefs generated from the owned store, replacing
  Dayflow's `DailyBrief`/`Weekly` logic with the plugin's own.
- **Progressive memory**: promote repeated reflections into durable "how I work"
  notes, deduplicated, with a decay/review policy so the prompt does not fill
  with stale self-description.

## What this deliberately does not do

- **No screen recording.** Not now, not later. If capture is wanted, it is a
  separate tool that imports into this store — which is also why privacy has to
  work at the summarization boundary (3.6) rather than at the capture boundary
  the way Dayflow does it.
- **No reimplementation of Dayflow's AI pipeline.** The plugin does not need to
  turn screenshots into cards if the cards arrive by import or by the agent
  writing what it did. When/if the plugin does summarize (3.6, 3.7), it does so
  through `ctx.llm.stream()` on the assembled conversation, not by rebuilding a
  provider zoo.
- **No card-stack review as the centre.** It stays available and defaults to off
  (3.5). The review that matters is the distillation, loop, and improvement
  queue.
- **No Swift.** Everything stays Node + TypeScript, per the existing
  contribution rules. Dayflow's code is read for semantics, not copied.
- **No silent coupling to Dayflow's schema.** After phase 2 the only place that
  knows Dayflow's column names is the import adapter.

## Risks, ranked

1. **Memory that is wrong is worse than no memory.** An agent that confidently
   cites a stale or misread pattern is actively harmful. Mitigation: every
   injected fact carries its date and source; reflections are editable and
   deletable; a `memory_forget` operation exists from phase 4 day one.
2. **Memory written as "the present" is stale the moment it is stored.** This is
   the specific mechanism by which risk 1 happens, and the reason 4(d) exists: a
   claim that says "the script does not gate on the tag" becomes a lie the first
   time the tag gate is fixed, and nothing in the data can tell the agent that.
   Mitigation: dated claims, append-and-supersede instead of rewrite, retrieval
   that shows the date, and a lint pass that ages claims out.
3. **False privacy confidence.** 3.6 hides a *window*, not the content inside a
   browser tab or a document. A user who believes otherwise is worse off than
   one with no setting at all. Mitigation: the limitation is part of the
   settings copy in both languages, not a footnote, and the reviewer of any
   privacy change checks that sentence survived.
4. **Automatic task attribution that is wrong.** Filing work under the wrong
   long task silently corrupts every downstream suggestion. Mitigation: the
   matcher is inspectable and low-confidence matches are dropped rather than
   guessed; every session shows why it was attached; the user can detach one.
5. **Prompt budget creep.** Per-turn injection and the long-task section are paid
   on every step. Mitigation: a hard byte cap per contribution, a test that
   asserts it, and a default that injects nothing until there is something worth
   injecting.
6. **Migration is one-way.** Import must be additive and re-runnable; never
   modify the Dayflow file. Mitigation: open it read-only, exactly as now.
7. **The review queue becomes a chore, and then the user stops reading it.** If
   every day proposes five distillations, two loops, and four improvements, the
   panel becomes noise and the good items are lost with the bad. Mitigation: a
   confidence floor, a per-day cap on proposals, a "nothing worth keeping today"
   outcome that counts as success, a soft/hard suppression so the user's "no" is
   remembered, and push-right (3.5) so that reading an item never means reading
   the raw activity behind it.

## Suggested first cut

If only one thing is built next, build **phase 1 + phase 2**: the owned schema
and the importer. They are unglamorous, they do not change a single user-visible
behaviour, and they are the thing that makes every later phase safe. Everything
else is additive on top; this cannot be added later without a rewrite.

The first *visible* increment should be **3.5** (review queue, card stack off by
default). It is small, it changes the product's centre of gravity, and it gives
the later phases a place to send their proposals — which means 4 and 5 do not
each have to invent one.

## Decisions taken

Settled with the owner on 2026-10-29. They are requirements, not options.

1. **Private apps are redacted for cloud models only.** No redaction for a model
   running locally: the user's own machine reading the user's own window is the
   whole point of running it locally. A provider that might proxy out counts as
   cloud. (See 3.6.)
2. **The agent may propose long tasks.** It notices work forming a goal and
   proposes it into the review queue; it never creates a task silently. Accepting
   is the user's act. (See 3.7.)
3. **"Don't suggest this again" is an available choice, not the default.** A
   plain discard is soft — the idea may return with materially new evidence — and
   a separate, deliberate action hard-suppresses it by fingerprint, clearable in
   settings. (See 3.5.)

## Open questions for the owner

1. Is the owned store the single source of truth once imported, or should it
   keep mirroring Dayflow while Dayflow is installed? (Mirroring is more
   convenient, owning is what removes the dependency.)
2. Should the agent be able to see Codex/Claude Code session logs the way
   Dayflow's `AgentAccess` does, or is the work journal enough?
3. For memory: is "what I usually do" useful enough to pay for on every turn, or
   should injection be opt-in per project?
4. For agent-proposed tasks: how many proposals per week before it becomes
   nagging? A hard cap is easy to add now and hard to add after users are
   annoyed.

## References and credits

Ideas in this document were borrowed from work published under the MIT licence.
Crediting them is not just courtesy: it lets a reader check the original
reasoning instead of trusting a summary, and it makes it obvious which parts of
this design are ours and which are inherited.

| Source | What we took |
| --- | --- |
| [JerryZLiu/Dayflow](https://github.com/JerryZLiu/Dayflow) (MIT) | The data model, the 4 AM day boundary, the review-rating tiling semantics (3.5), and the privacy-placeholder mechanism (3.6). Read for semantics; no Swift is copied. |
| [mattpocock/skills](https://github.com/mattpocock/skills) (MIT), `loop-me` | The **loop** concept and the vocabulary *Trigger / Checkpoint / Push right / Brief* (3.5). The "mandate nothing structural" rule shapes phase 4's defaults. |
| [mattpocock/skills](https://github.com/mattpocock/skills) (MIT), `chief-of-staff` | **Write history, not the present**: dated claims, append-and-supersede instead of rewrite, and the *Ingest / Query / Lint* maintenance loop (4d). |
| [mattpocock/skills](https://github.com/mattpocock/skills) (MIT), `retro` | The framing that a review should improve the *environment* the agent works in, which is what the improvement queue is for (3.5). |

What is ours: the owned schema and migration story (phases 1–2), the review
queue as the product's centre with distillation/loop/improvement/task_proposal
kinds, the cloud-only privacy boundary, long-horizon task tracking inside the
summarization prompt, and the memory-layer design in phase 4.
