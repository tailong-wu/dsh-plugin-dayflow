# Roadmap: from a Dayflow reader to a personal agent memory

> Status: **`v0.9.2` is the latest tag and GitHub Release and the 0.9.x line's
> record is closed; the maintenance pause is over, and the 0.10.x line is open.**
> On 2026-11-27 the owner answered **D1 = `cloud`** (screen metadata may be
> analysed by a cloud provider) and **D7 = `yes`** (npm publication is
> authorised), and partially answered **D2** (several custom models wanted,
> DeepSeek first; the A/B/C form is still to be chosen), so the line that was
> waiting on those answers starts at **0.10.0 — cloud analysis + multi-model
> selection (option A baseline) + first-npm-publish preparation**. **0.10.0's
> implementation round is complete (2026-11-27, `main` `0d8d3c8`) and the patch
> remains in progress, still untagged**: the approved `analysis.models` shape
> is implemented in the config/resolution helper, the additive optional `model`
> status summary, the client analysis line, the provider page, and the docs; the
> suite measures **583/583** green — 581 on the implementation head `0d8d3c8`
> plus the two pipeline list-mode cases the quality pass added — and typecheck,
> build, and `check:package` are green. **Nothing is tagged and no npm publish
> has run** — the tag waits on the plan's hard gate, one real-cloud
> smoke recorded without a key ([`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md)
> §3.7/§3.9), and the publish waits on an npm login this machine has not made;
> the release preparation is written in [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md).
> After the `v0.9.2` tag an engineering-only package-metadata regression guard
> joined the tree (no tag, no new patch) for 558 tests, and 0.10.0's
> implementation plus the quality pass added the other 25. **D10 and D11 are
> still unanswered and stay gated**,
> no `1.0.0` is planned, and **no npm publish has happened**: the registry still
> answers **404** and this machine is not logged in to npm.
> `v0.9.1` is an annotated tag whose tree is **557** green tests, schema **v10**, **18** panel
> routes (9 `GET` + 9 `POST`), **5** slash commands, 23 tools, 8 skills, and no new
> host peer; the previous line closed at `v0.8.4` (537 tests) and its two
> owner-gated slots stay deferred. The 0.8 line's tags
> are exactly **`v0.8.0` (`f4191b9`), `v0.8.1` (`af002c3`), `v0.8.4`** and each
> has a GitHub Release; the owner-gated **0.8.2 (image admission)** and **0.8.3
> (Phase 4 cutover)** are **deferred to the next line**, were never started, and
> are not renumbered. The 0.7.x line is closed too: its last tag is `v0.7.6`
> (commit `007c287`) and all seven tags `v0.7.0`–`v0.7.6` have GitHub Releases;
> 0.7.0 (`v0.7.0`, `45a7e42`) remains the **phase baseline**. Across the whole
> repository the trail is now **22 tags / 22 GitHub Releases** and `v0.9.2` is
> **Latest**: the `v0.6.0` gap the 0.8.4 docs record as history was backfilled as
> a release-only operation after that close, so no tag lacks a Release. Phase 4
> is still **rehearsed
> only** — `docs/CUTOVER_REHEARSAL.md` and `npm run rehearsal` walk the fixture
> chain (20/20 checks at `v0.7.6`, re-run green on the `v0.8.1` tree) and no
> `source: owned` default has been flipped. The package is still **not on the
> npm registry** — D7 is now answered `yes`, but no publish has run and this
> machine is not logged in — so every release here is still a tag and a GitHub
> Release only.
>
> **Measured on the `v0.9.1` tree:** **557** tests green (544 on `v0.9.0`, 537 on
> `v0.8.4`, 521 on `v0.8.0`, 494 on the closed `v0.7.6` tree — 0.8.1 added 16 in
> 3 files, 0.8.4 added none because it changed no code, 0.9.0 added 7 in 2 files:
> two panel route tests and five `client-format` cases, and 0.9.1 added 13 in 3
> files: eleven reader cases in a new `tests/automation-read.test.ts`, one
> `panel-insights` payload case, and one `client-format` copy case), schema
> **v10**, **18** panel routes, **5** slash commands, 23 tools, 8 skills, no new
> host peer. **The current tree is 583 green tests, against 557 at the `v0.9.2`
> tag**: 0.9.2 itself added no test, the post-tag engineering-only
> package-metadata regression guard described in §0.9.x added one (558, no tag),
> 0.10.0's implementation added 23, and the quality pass added the last two
> pipeline list-mode cases (581 → 583); the exact count is recorded at the cut.
> The 0.7
> line's own record is [`PATCH_PLAN.md`](PATCH_PLAN.md) (frozen history), the 0.8
> line's is [`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) (frozen history too, now
> that the line is closed), and the 0.9 line's is
> [`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md).
>
> **0.9.x is closed at `v0.9.1` for function, and it was decision-free only.**
> It shipped two functional patches and reopens once, for the 0.9.2 maintenance
> fix below. **0.9.0 — month/week goal and rating surfaces**, **landed** (`v0.9.0`
> on `d0f9b5a`, GitHub Release Latest at the time, 544 tests): the stored goal
> and the user's own review marks, which the day view already rendered, are
> visible in the month cells and the week columns, read-only, with no schema,
> configuration key, route, command, tool, skill, default, host peer, or model
> call — the line stays at 18 routes, 5 commands, and schema v10. **0.9.1 — the
> close-history surface — has landed** (`v0.9.1` on `ce0827e`, GitHub Release
> **Latest until 0.9.2**, 557 tests): the automation ledger's recorded day, week,
> and lint closes become one additive `closes` list on the insights payload and one
> read-only **Close history** block in the existing Journal insights view — the
> last stored history the native port recorded as missing — with no new route,
> schema, config key, command, or model call. The earlier docs-parity 0.9.1
> candidate was withdrawn because the 0.9.0 docs pass left no drift. The `dsh
> dayflow import` CLI is **not on 0.9**; it is recommended for the cutover line,
> beside the no-Dayflow runbook. **Owner-gated work does not enter 0.9:** image
> admission (D1/D2/D11), the cutover (D10 plus a real week), any npm publish
> (D7), and the owned-journal write path stay deferred — the owner has since
> answered D1 and D7 and partially D2, which shapes the 0.10.x line below, not
> this closed one.
>
> **After 0.9.1 the host moved, and that opens exactly one more patch: 0.9.2 —
> DSH `0.2.2-rc.5` compatibility (landed).** The DSH app installed on this
> machine is **`0.2.2-rc.5`** (`CFBundleShortVersionString`), while this tree
> still lists only `0.2.0-rc.2` and `0.2.1-rc.2` in
> `dsh.compatibility.dshReleases` and pins its seven DSH development
> dependencies at `0.2.1-rc.2`, so the plugin has never been built or tested
> against the harness it actually runs on. 0.9.2 is a **decision-free,
> patch-level maintenance fix, not a product feature**: it adds `0.2.2-rc.5` to
> the declared compatibility map, moves those seven dev dependencies and the
> lock to `0.2.2-rc.5`, applies a minimal source/typing adaptation only if the
> new cohort requires one, and re-runs the suite, typecheck, build, and package
> gates. It changes **no behaviour, default, schema, route, command, tool,
> skill, configuration key, runtime dependency, or host peer**. The host's own
> admission check is peer-range based and the existing `^0.2.0-rc.2` peers
> already admit `0.2.2-rc.5`, so no installed user is blocked — what is stale is
> the declaration and the verification, which is exactly why this is
> maintenance and not an emergency. 0.9.2 got its own tag and GitHub Release,
> and the line returned to maintenance. **That pause ended on 2026-11-27:** the
> owner answered D1 (`cloud`) and D7 (`yes`) and partially D2 (several custom
> models, DeepSeek first; form open), which opens the **0.10.x** line in
> §0.10.x below. The five-question page now records three statuses rather than
> five open questions ([`OWNER_DECISIONS.md`](OWNER_DECISIONS.md)).
>
> **After 0.9.1 the project went into maintenance — paused pending owner
> decisions, not abandoned; that pause ended on 2026-11-27.** No further
> decision-free *feature* patch was worth a tag at
> this revision (the compatibility fix above is maintenance, not a theme): the
> six remaining candidates (the `dsh dayflow import` CLI,
> month/week query batching, a11y/i18n/UX, docs/README parity, test dedup, and
> release tooling) were each evaluated against a user-visible change, a real
> risk, and a tag, and none clears all three — the CLI is a new entry surface
> deliberately saved for the cutover line, and the rest are refactors, cosmetic,
> already green, or already shipped. The next action is the owner's, not
> engineering's: **the five-question list in
> [`OWNER_DECISIONS.md`](OWNER_DECISIONS.md)** (D1, D2, D7, D10, D11). No new
> feature patch opens and no 1.0.0 is planned without those answers; maintenance
> means verification and necessary fixes only — which is precisely the class the
> 0.9.2 host-compatibility fix belongs to — and the evaluation is recorded below
> in §0.9.x *After 0.9.1 — maintenance, paused pending owner decisions*. One
> piece of 1.0.0 engineering prep needs no answer and was completed this round:
> [`RUNBOOK.md`](RUNBOOK.md), the single-file operator manual (first run, safe
> switches, data and backup, upgrade, rollback, maintenance checks,
> troubleshooting). It is docs only — it opens no route, command, tool, skill,
> schema step, or default, and cuts no tag — so it did not change that pause.
> The pause ended on 2026-11-27: the owner answered D1 (`cloud`) and D7 (`yes`)
> and partially D2, and the 0.10.x line opens below.
>
> **What remains after this line:** the owned-journal write path (the editing
> tools still go through Dayflow), the `dsh dayflow import` CLI (cutover line),
> the `review.cards` switch (the plugin never had a card stack, so the switch
> has no surface), task tagging from the summarization prompt, automatic
> activity attribution, goal analytics beyond stored-data rendering, embeddings,
> and Phase 5. The native port's stored-data read gaps are all closed now: its
> last *Missing* read, the close history, landed in 0.9.1, leaving image
> admission (D11) and the cutover (D10) there — both still owner-gated. **D1 is
> now answered (`cloud`) and D7 (`yes`), with D2 partially answered, so the
> 0.10.x line carries the cloud analysis and multi-model work; 1.0.0 still
> follows D10 and a real captured week.** The owner decisions it needs are in
> [`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.4 G, unchanged by 0.9, and
> consolidated — with the new answers — in
> [`OWNER_DECISIONS.md`](OWNER_DECISIONS.md).
>
> Last revised: 2026-11-27, after the `v0.9.2` tag (`ccac653`), the owner's
> answers that opened 0.10.x, and the 0.10.0 implementation round
> (`0d8d3c8`; implemented, untagged): **22 tags and 22 GitHub Releases** (`v0.9.2`
> **Latest**; the `v0.6.0` gap backfilled after the 0.8.4 close); 0.8.0's three
> ledger follow-ups, 0.8.1's briefs reading view, and 0.8.4's release close
> landed; 0.8.2 image admission and 0.8.3 cutover are deferred to the next line;
> 0.9.0 (month/week goal and rating surfaces) and 0.9.1 (close-history surface)
> landed with GitHub Releases, closing the 0.9.x line's functional scope at
> `v0.9.1`; 0.9.2 (DSH `0.2.2-rc.5` compatibility) landed too as the line's one
> maintenance tag, and the line returned to maintenance. The six remaining
> decision-free candidates evaluated after that close still are not worth a tag.
> The one decision-free fix found after that evaluation was the **DSH
> `0.2.2-rc.5` compatibility gap** — the running host is newer than the declared
> cohort and the pinned dev toolchain — which opened the maintenance patch
> **0.9.2 (landed; `v0.9.2`, the 22nd tag and Release)** and changed none of the
> decisions. **The pause that followed ended on 2026-11-27:** the owner answered
> **D1 = `cloud`** and **D7 = `yes`** and partially answered **D2** (several
> custom models, DeepSeek first; the A/B/C form is open), so the **0.10.x line
> is open** — 0.10.0 cloud analysis + multi-model selection (option A baseline)
> + first-npm-publish preparation, planned in
> [`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md) and summarised in §0.10.x below.
> **0.10.0's implementation round is complete** (2026-11-27, `main` `0d8d3c8`),
> and the patch is still **untagged**: the approved `analysis.models` shape is
> implemented in the config/resolution helper, the additive optional `model`
> status summary, the client line, and the docs; **nothing is tagged and no
> publish has run** — the tag waits on the plan's hard gate, the recorded
> real-cloud smoke, while the publish waits separately on an npm login this
> machine has not made (release preparation: [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md)).
> **D10 and D11
> remain unanswered and gated**, the analysis
> contract stays **text-only** until D11 is answered, and no npm publish has run
> (the registry still answers **404** and this machine is not logged in). After
> the `v0.9.2` tag the decision-free operator runbook
> ([`RUNBOOK.md`](RUNBOOK.md)) was written as the first 1.0.0 engineering prep —
> docs only, no tag. An engineering-only package-metadata regression guard
> (`tests/compatibility.test.ts`) joined the suite after that tag too — no tag
> and no new patch — taking the tree from 557 to **558**; 0.10.0's
> implementation added 23 cases and the quality pass added two pipeline
> list-mode cases, so the current tree is **583** green against **557** at
> `v0.9.2` (581 at the `0d8d3c8` implementation head; the exact count is
> recorded at the cut).

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

- `journal_import` (shipped in 0.6.0) / `dsh dayflow import` (deferred): read a
  Dayflow database and write it into the owned store, losslessly for
  `timeline_cards`, `observations`, `daily_standup_entries`, `day_goals`,
  `day_goal_categories`, `timeline_review_ratings`, `journal_entries`, and the
  category colors.
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

**Shipped in 0.7.0 (tagged `v0.7.0`):**
`journal_entry` → `dayflow_journal`, `observations` → `dayflow_observations`,
`review_ratings` → `dayflow_review_ratings`, `goal_categories` →
`dayflow_goals`. All four are read-only and answer on both the Dayflow backend
and the owned journal. The panel's day view shows the goal and the review marks;
the month and week payloads stayed unchanged on the 0.7.x line so browsing them
does not pay for those reads. **0.9.0 reverses that for these two fields only**
(landed in `v0.9.0`: the month and week days carry the same `goal`/`ratings` the
day payload does; see *0.9.x iterations*).

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

**Schema for the review queue** (shipped as owned schema v3, since migrated
through v6):

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

**Shipped in 0.7.0 (tagged `v0.7.0`):** the owned schema (version 3) stores
`review_items` with kind/status/confidence/evidence, `journal_review` exposes
list/propose/decide/unsuppress, and the `review-queue` skill teaches the
push-right proposal discipline. The hard/soft suppression rules, the confidence
floor, and the per-day cap are enforced and tested. The panel renders that queue
in the Journal insights view; it was read-only in 0.7.0–0.7.2. **0.7.3** made
it interactive in the panel: one decision route (keep/accept/discard/reject,
with "Don't suggest again" as the deliberate hard-suppressing second action), the
same decision composer the `journal_review` tool uses, and no
suppression-management surface (D6 stays agent-only). The `review.cards` switch
remains open.

**The marks at browse scale (0.9.0, landed).** The day view has rendered
the stored marks since 0.7.0; **0.9.0** extends the same records, read-only, to
the month cell and the week column — a compact rating strip and a goal marker,
with the day hover card carrying the goal target summary and the mark counts. It
adds no rating surface: the plugin still does not rate (there is no card stack,
so `review.cards` still has no surface), it only shows the marks Dayflow stored,
and it changes no schema, route, or default.

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

**Status at 0.7.3:** not implemented for pixels — no image is admitted yet, so
there is nothing to redact. `capture.pauseApps` already skips capture of a
matching app entirely (stronger than redaction), and cloud analysis stays off by
default until its own consent. 0.7.2 made a `local` or `cloud` consent
exercisable for the first time, but its contract is **text-only** (frontmost app,
window title, frame hash; no pixels), so it ships the 3.6 limitation copy next to
the analysis line instead of a redaction list — two locale keys: the text-only
disclosure, plus the cloud-only "the metadata leaves the Mac" sentence. 0.7.4's
close jobs send activity text only (never frames or window titles) behind that
same consent, so this status does not change. The `privacy_apps` list is **not**
on the 0.7.x line and is **not** on the 0.8.x line either: it was scoped for
image admission as **0.8.2**, but the owner did not answer D1/D2/D11, so the slot
is **deferred to the next line**
([`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.2). The analysis contract stays
**text-only**, and no `privacy_apps` list, `includeImages` key, or attachment
peer exists in the tagged tree.

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

**Shipped in 0.7.0 (tagged `v0.7.0`):** the `long_tasks`/`long_task_sessions`
schema (version 4), `journal_task` (create/list/get/update/attach/detach/suggest),
stalled detection after seven days, explainable category/app matching as a
`suggest` step, and review-queue `task_proposal` acceptance creating the task in
the same transaction. Sessions are attached by the agent from an inspectable
`suggest` result rather than tagged silently; the Journal insights view already
adds a task and offers a post-add history scan → link flow over the owned
journal. **0.7.3** completed the panel half: an attached day can be detached
(without deleting activities) and the review queue can be decided in place.
Summarization-prompt tagging and automatic matching remain open.

**Not extended by 0.9.0:** the month/week read-only layer above renders the
day's goal and review marks, not tasks or sessions. A month/week task trail
(sessions per task over time) would be a new product surface, needs its own
patch, and is not scheduled; long tasks stay in the day view and the Journal
insights view.

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

**Shipped in 0.7.0 (tagged `v0.7.0`):** the `memory_claims` schema (version 5),
`journal_memory` (add/search/list/supersede/forget), append-only dated claims
with `superseded_by`/`superseded_on`, FTS5 retrieval with a `LIKE` fallback, and
review-kept distillation/loop promotion into memory, the budgeted dynamic
context (4b: 1000-byte cap, 60-second cache, nothing injected when empty), and
reflections (4c) stored in the owned journal so later sessions read a compiled
summary instead of replaying raw days. The read-only lint is implemented as
`journal_memory` `action: "lint"`; the panel's in-panel insights view renders
review items, tasks, claims, and reflections. The scheduled lint job **landed
in 0.7.5** (`v0.7.5`, `f117cdc`) and is recorded in
[PATCH_PLAN.md](PATCH_PLAN.md): it turns the read-only lint into a weekly
advisory pass whose findings become review proposals (at most one per claim per
week, never more than three per pass) and whose digest is written into the
weekly brief — schema v10, and no claim is ever written by it (D8/D9). With it,
phase 4's ingest/query/lint maintenance loop is complete on the 0.7.x line; the
remaining phase-4 work is the cutover, not the lint.

**The cutover, and where it now sits.** The Phase 4 default (`source: owned`
when capture is enabled and no Dayflow database exists) is **not** on the
0.7.x line. 0.7.6 rehearsed it — `npm run rehearsal` walks the fixture chain
(capture → analysis → day close → day insights → weekly lint → weekly brief →
reopen), passed **20/20**, and `docs/CUTOVER_REHEARSAL.md` carries the pass/fail
checklist and the record table (permission, frames, cards, standup, brief,
reflection, queue, restart with no data loss); the fixture run needs no screen
permission, network, or model. It flipped nothing. The real cutover was scoped as
**0.8.3**, **owner-gated** on D10 plus a real captured week on a fresh profile
with no data loss; the owner did not answer D1/D2/D10, so the slot is **deferred
to the next line** and is now the **1.0.0 prerequisite**
([`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.3 and §0.8.4 G). **1.0.0**
follows that week, per `NATIVE_PORT.md` §8 Phase 4. A capture-only cutover
(`consent: none`) is a narrower variant the owner may choose instead.

### Native port — capture and analysis inside the harness

The owner selected the full port (option C): move Dayflow's own capture →
analysis → cards → briefs pipeline into `dsh-plugin-dayflow`, so the owned journal
can be the source of truth and the Dayflow app becomes optional. The plan,
including the privacy/consent design, schema migrations, phases, acceptance
criteria, and cost caps, lives in [`NATIVE_PORT.md`](NATIVE_PORT.md). Phase 0
(the feasibility spike) and Phase 1 (the capture engine) landed in 0.7.0
(tagged `v0.7.0`): the capture provider (now including a lazily compiled Swift
helper that captures frames with a 64-bit dHash and screen-lock/display-sleep
state) and its local smoke script, schema v7 `capture_state`, the
`capture`/`analysis`/`automation` config skeleton (capture off by default), the
insights capture status/pause line, and the engine itself — an interval timer
wired into the plugin lifecycle only when `capture.enabled` is true, which skips
paused, locked, idle, and `pauseApps` ticks, dedupes with dHash, writes frames
under `$DSH_HOME/dayflow/frames/` plus `screenshots` rows, caps the day, and
sweeps retention. Phase 2's foundation landed in 0.7.1 (tagged `v0.7.1`) behind
the consent gate: owned schema v8 `analysis_jobs`, the five `analyse/` modules
(window grouping, strict JSON contract, sessionisation, idempotent writes,
retries, the per-day call cap, and frame release at `keepFramesDays: 0`), and the
pure consent gate; the contract is **text-only** (frontmost app, window title,
frame hash) and nothing runs on its own. **0.7.2** made it visible and operable:
the analysis worker/timer, the text-only host `llm` adapter over
`ctx.llm.stream`, `GET /api/dayflow/analysis/status`, one analysis line under
the capture line in the insights view (with the privacy disclosure),
`/dayflow-analyze`, the budget ledger read from `analysis_jobs`, and
`analysis.intervalMinutes`; no schema change (v8), and skipped jobs stayed
terminal on the 0.7.x line (the skipped-window catch-up, the token-cap gate, and
the 04:00 day tail **landed in 0.8.0**, closing the 0.7.2 debt). **0.7.3** added
no native-port work: it is the panel's interactive layer (review decisions and
task-session attach/detach) and touches neither capture nor
analysis. **0.7.4 has landed and is native port Phase 3** (text-only
automation): a daily close writes the standup into `daily_standup_entries`, a
daily insight pass writes one reflection, at most three review proposals and
high-confidence task sessions, and the weekly close writes one `briefs` row;
schema **v9** adds `automation_runs` + `briefs`; the scheduler runs at
`automation.dailyAt` (04:00) and `automation.weeklyOn`, with the catch-up window
`automation.catchUpDays` (1–30, default 2) and missed days older than it marked
`skipped`, never fabricated; a pure text-analysis gate reuses
`analysis.enabled`/`analysis.consent`/provider/model and the close jobs send
activity text only — never frames or window titles — while the scheduler mounts
inside the existing capture+analysis+`llm` block, so a default profile still
runs nothing. That patch also adds `GET /api/dayflow/automation/status` (route
set 18) and `/dayflow-run-close`. **0.7.5** added the scheduled weekly memory
lint and its digest (schema v10, proposals only, no claim writes) as part of the
weekly close, so the text-only automation slice now covers the whole maintenance
loop; **0.7.6** closed the line — seven GitHub Releases, reconciled docs, and the
Phase 4 cutover rehearsed in `docs/CUTOVER_REHEARSAL.md` — without flipping a
default. **0.8.0** is the first patch of the current line and it closed the three
analysis-ledger follow-ups, still text-only and with no schema, route, command,
tool, skill, config key, or default change (521 tests): the token budget is a
post-call gate with a pre-call already-spent guard and `budget-tokens` skips, a
repaired consent or provider replays today's and yesterday's transient skips,
and the 04:00 boundary runs one bounded yesterday tail behind the
`analysis_tail_checked_on` checkpoint. The remaining native work is recorded in
[`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md): **0.8.1** is the briefs reading view
(**landed**, `v0.8.1`, 537 tests), **0.8.2** would have admitted images and
**0.8.3** would have been the cutover itself (both are now **deferred to the next
line** — the line stays text-only and no default flips), and **0.8.4** closed the
line; the **0.9.x line's functional scope is closed at `v0.9.1`** (0.9.0's
month/week goal and rating surfaces, and 0.9.1's close-history surface — the last
item this section's *Missing* list recorded as a stored-data read gap; see
*0.9.x iterations*, where the post-close 0.9.2 host-compatibility maintenance
patch is recorded), and `1.0.0` follows the deferred cutover and a real captured
week.
The phasing above (Phase 5 and later) is untouched by these lines until the
native path lands.

### Phase 5 — Personalization that acts

Only after 4 is trustworthy. **Not on the 0.7.x or 0.8.x line:** no patch
above starts it; it remains a proposal.

- **Planning**: turn open intentions and observed patterns into proposed tasks
  (the agent already has `dsh-tool-schedule` and a jobs system available).
- **Recaps**: daily/weekly briefs generated from the owned store, replacing
  Dayflow's `DailyBrief`/`Weekly` logic with the plugin's own. (0.7.4 ships the
  generation itself — standup into `daily_standup_entries`, weekly brief into
  `briefs`; Phase 5 is what would act on top of those stored briefs.)
- **Progressive memory**: promote repeated reflections into durable "how I work"
  notes, deduplicated, with a decay/review policy so the prompt does not fill
  with stale self-description.

## Patch iterations (0.7.x, line closed)

0.7.0 closed the long development line; `main` then moved to small tagged
patches so every change is reviewable, testable, and revertible on its own.
**0.7.1–0.7.6 landed and the line is closed**: `v0.7.6` (`007c287`) is the last
tag, all seven tags have GitHub Releases, and the package is still not on npm
(D7 unanswered). The per-patch execution record — deliverables at file level,
acceptance assertions, decisions and safe defaults, risks and rollback — is
[`PATCH_PLAN.md`](PATCH_PLAN.md) (frozen history). One line each:

| Patch | Theme | Roadmap item | Status |
| --- | --- | --- | --- |
| 0.7.1 | Analysis foundation: the `analyse/` modules, consent gate, schema v8 `analysis_jobs`, fake-adapter tests; text-only, skipped jobs terminal — nothing leaves the machine | Native port Phase 2 | landed |
| 0.7.2 | Analysis visible: worker timer, text-only host `llm` adapter, analysis status route and panel line, budget ledger, `/dayflow-analyze`; no schema change | Native port Phase 2 | landed |
| 0.7.3 | Interactive insights: decide review items and attach/detach task sessions in the panel — three POST routes, one shared decision module, no schema change or model call; panel routes 14 → 17, 425 tests | Phase 3.5 / 3.7 remain | landed |
| 0.7.4 | The day closes itself: schema v9 `automation_runs` + `briefs`, daily standup and weekly brief, a daily insight pass (reflection, ≤3 proposals at ≥0.6 confidence, high-confidence task sessions), and the scheduler with `automation.catchUpDays` (1–30, default 2); panel routes 17 → 18, `/dayflow-run-close`, 477 tests | Native port Phase 3 | landed |
| 0.7.5 | Scheduled memory lint and the weekly digest: schema v10 (`automation_runs` accepts `lint`, plus `briefs.payload_json`), a weekly advisory pass that proposes at most one item per claim per week through the existing queue rules and never writes a claim, and a Memory-health paragraph in the weekly brief; no route, command, tool, or entry change (18 routes, 5 commands), 493 tests | Phase 4 lint remainder | landed |
| 0.7.6 | **landed** (`v0.7.6`, `007c287`) — Release and compatibility close: seven GitHub Releases (`v0.7.1`–`v0.7.5` backfilled from the corrected CHANGELOG, `v0.7.6` cut by the release tool), npm settled without publishing by default (D7 unanswered), docs reconciliation, the Phase 4 cutover rehearsed in `docs/CUTOVER_REHEARSAL.md` plus the repo-side `npm run rehearsal` (20/20 checks, not shipped), the config-defaults audit, and both CI legs + `check:package` green; no plugin-source, schema, route, config, or default change (494 tests, 18 routes, 5 commands, schema v10) | Release closure / Phase 4 rehearsal | landed |

The line's landed record, kept from the status history this roadmap carried while
the line was open (the intent, not a second changelog): 0.6.0 shipped the read
path of Phases 1+2 — the owned schema, its forward migration, the Dayflow
importer, and the owned read backend. 0.7.0 is the phase baseline: it closed the
Phase 3 read gap (`dayflow_journal`, `dayflow_goals`, `dayflow_observations`,
`dayflow_review_ratings`), landed the Phase 3.5/3.7/4 **storage and tool** slices
(the review queue, long tasks, dated append-and-supersede memory, reflections,
the budgeted memory context, and the read-only lint), added the Journal insights
view, and landed native capture Phase 0/1 (provider + engine, default off,
schema v7). 0.7.1 added the native port Phase 2 foundation (schema v8, the
`analyse/` modules, the consent gate; text-only, skipped jobs terminal); 0.7.2
made it visible (worker, text-only host `llm` adapter, status route, panel line,
budget ledger, `/dayflow-analyze`; 408 tests, 14 routes); 0.7.3 made the insights
view interactive (review decisions, task-session attach/detach; 425 tests, 17
routes); 0.7.4 made the day close itself (schema v9, text-only automation, the
scheduler with `automation.catchUpDays`, the fifth command; 477 tests, 18
routes); 0.7.5 added the scheduled weekly memory lint and its digest (schema
v10, proposals only, no claim writes; 493 tests); 0.7.6 closed the line as this
table's last row records (494 tests). Every tag on the line was default-safe,
none changed a default, and none is on npm.

Ordering note: the interactive panel (0.7.3) landed **before** the automation
that fills the review queue (0.7.4), because a queue whose only decision path is
an agent turn becomes the chore Risk 7 warns about. The Phase 4 default cutover
was never part of this line — it belongs to the next minor release after a real
week of capture. The three analysis-ledger items (skipped-window catch-up, the
token cap as a gate, the 04:00 day tail) were deliberately not in 0.7.2–0.7.5,
kept as single-theme patches, and **landed in 0.8.0** because they needed no
owner answer. 0.7.4's own catch-up is about missed **close jobs**
(`automation_runs`) and is bounded by `automation.catchUpDays`; it is not a
replay of analysis-ledger skips. Image admission (pixels need a host attachment
peer plus a vision contract) and the Phase 4 `source: owned` default flip were
scoped as **0.8.2** and **0.8.3**, both owner-gated; the owner did not answer
D1/D2/D10/D11, so both are **deferred to the next line**, and the 0.8 analysis
contract stays text-only. The cutover, not the lint, is the remaining Phase 4
work.

**Deferred from the 0.7.x line, now landed or deferred again:** the three
analysis-ledger follow-ups **landed in 0.8.0**; the briefs reading view
**landed in 0.8.1**; image admission (**0.8.2**) and the Phase 4 `source: owned`
default flip (**0.8.3**, owner-gated on D10 plus a real week) are **deferred to
the next line** — the owner did not answer D1/D2/D10/D11, so neither carries a
0.8 tag. None was in a 0.7.x patch; 0.7.6 only rehearsed the cutover. The 0.8.x
plan is [`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md).

## 0.8.x iterations

The 0.7.x line is closed and the 0.8.x line is closed at `v0.8.4`. **0.8.0 and
0.8.1 landed; 0.8.2 and 0.8.3 are deferred to the next line; 0.8.4 landed as
the line's release close** (docs and release artefacts only, no code). Its
execution plan is
[`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md): patch-level deliverables, acceptance
at the assertion level, the gates and owner decisions, the version-slot rule (an
unanswered owner-gated slot is deferred in 0.8.4, not renumbered), and the next
line's prerequisites (§0.8.4 G). One line each:

| Patch | Theme | Roadmap item | Status |
| --- | --- | --- | --- |
| 0.8.0 | Analysis ledger follow-ups: the token budget becomes a post-call gate (with a pre-call already-spent guard), transient skips replay inside today and yesterday, and the 04:00 boundary gets a one-shot day tail behind the `analysis_tail_checked_on` checkpoint; no schema, route, command, config key, or model change | Native port Phase 2 remainder / analysis ledger | **landed** — `v0.8.0` (`f4191b9`), GitHub Release (Latest until 0.8.1), 521 tests (494 → +27) |
| 0.8.1 | Briefs reading view: the stored day/week briefs join the existing insights payload (an additive `briefs` array on `/api/dayflow/insights`), one read module (`src/briefs/read.ts`), one read-only expandable section in the existing view; no new route, tab, or model call; 537 tests (521 → +16) | Phase 3 standup/brief surface | **landed** — `v0.8.1` (`af002c3`), GitHub Release (Latest until `v0.8.4`), 537 tests |
| 0.8.2 | Image admission: an optional host attachment/vision contract, the `privacy_apps` redaction list, the 3.6 limitation copy, `includeImages: false` by default; scope kept, no config key/schema/peer shipped | Native port Phase 2 image slice / 3.6 | **deferred to the next line** — D1/D2/D11 unanswered; never started; no 0.8 tag |
| 0.8.3 | Phase 4 cutover: `source: owned` default for a fresh capture-enabled profile, the first-run walkthrough, the real week | Native port Phase 4 / 1.0.0 prerequisite | **deferred to the next line / 1.0.0 prerequisite** — D1/D2/D10 unanswered; no default flipped; no 0.8 tag |
| 0.8.4 | Release close: a release for every shipped tag, the npm decision with no publish by default, docs reconciliation, the deferred slots named, and the next line's prerequisites recorded; flips nothing | Release closure | **landed** (`v0.8.4`) — the line's last patch |

Order rationale: 0.8.0 went first and shipped — decision-free, it paid the three
debts 0.7.2 left and made the money ledger honest before anything could flip a
default; 0.8.1 came second and shipped — the decision-free visible win that makes
0.7.4/0.7.5's stored output readable; the owner-gated 0.8.2/0.8.3 were to follow
in the roadmap's order, with the default flip last among the functional patches,
but the owner did not answer and both are deferred rather than renumbered; 0.8.4
closed the line and flipped nothing. The line's tags are exactly `v0.8.0`,
`v0.8.1`, and `v0.8.4`. 0.8.0 was tagged whole, so the pre-tag renumbering
window is closed; from the first tag of the line, slots are deferred rather than
renumbered.

**The 0.8.0 record (kept as landed history).** Tag `v0.8.0` (`f4191b9`), GitHub
Release Latest at the time, 521 green tests, schema v10, 18 routes, 5 commands.
It shipped the three ledger follow-ups in the plan's implementation order —
token gate, then catch-up, then day tail — with one addition the plan did not
have: a pre-call token-already-spent guard between the call gate and the call,
so a later run or the day tail cannot spend a second crossing call. The catch-up
landed as a bounded worker-level pass in the new `src/analyse/skips.ts`
(`TRANSIENT_SKIP_REASONS`, `isTransientSkipReason`,
`replaySkippedAnalysisWindows`) covering today and yesterday, not as a relaxed
pipeline idempotency branch; the 04:00 tail keeps its
`capture_state.analysis_tail_checked_on` checkpoint, written only for a
non-blocked run, and the worker's order is today's run → catch-up (only when
that run was not blocked) → day tail. No `jobs.ts` or `panel-contract.ts` change
was needed; the analysis status payload gained the additive `tokenBudgetExhausted`
field and the panel one amber state. No schema, route, command, tool, skill,
config key, peer, or default changed, and the line stays text-only. The full
deviation list is in [`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.0.

**The 0.8.1 record (kept as landed history).** Tag `v0.8.1` (`af002c3`), GitHub
Release Latest until `v0.8.4`, 537 green tests (521 at 0.8.0), schema v10, 18
routes (9 GET + 9 POST), 5 commands, 23 tools, 8 skills, npm still 404. The
briefs reading view landed as one additive payload field plus one read module
plus one read-only section: `PanelInsights.briefs: PanelBriefSummary[]`;
`src/briefs/read.ts`'s
`listPanelBriefs` (and the `readPanelBriefs` reader the payload path uses) merge
`briefs` rows with native `daily_standup_entries`, normalise standups to day
entries, de-duplicate per `(kind, period_key)` with the stored brief winning,
sort newest-period-first, cap at 10, answer `[]` for a missing or unreadable
journal without creating it, and degrade a malformed payload instead of throwing;
the panel's insights view gains one expandable Briefs block after reflections,
with no tab, button, route, config key, schema version, host peer, or model call.
The six deviations from the plan's sketch (the type's home, the extra
`readPanelBriefs` export, the clock-free `now`, the plain-`body` standup
fallback, the button/`aria-controls` row, and the seven locale keys) and the 16
new test cases are recorded in
[`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.1.

## 0.9.x iterations

The 0.8.x line is closed, and the 0.9.x line's **functional scope** is closed at
`v0.9.1`; the line is reopened once, for the decision-free maintenance patch
**0.9.2 — DSH `0.2.2-rc.5` compatibility — which has landed**. **0.9.0 —
month/week goal and rating surfaces — landed** (`v0.9.0`, 544 tests); **0.9.1 —
the close-history surface — landed too** (`v0.9.1`, 557 tests), making the stored
day/week/lint close history readable in the existing insights view. The earlier
docs-parity candidate for 0.9.1 was withdrawn; the functional line closed at its
second tag. Its execution plan is
[`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md): patch-level deliverables, acceptance at
the assertion level, the frozen-contract rule with its two declared exceptions
(values in `PanelDay`'s already-declared optional fields; one additive `closes`
list on the insights payload), the three-route agreement test, and the rule that
owner-gated work does not enter 0.9. One line each:

| Patch | Theme | Roadmap item | Status |
| --- | --- | --- | --- |
| 0.9.0 | Month/week goal and rating surfaces: the month and week payloads fill `PanelDay.goal`/`ratings` from the same readers the day route uses, and the client renders them read-only — a goal marker and rating dots in the month cell and the week column, the goal summary and review marks in the day hover card; no schema, config key, route, command, tool, skill, default, host peer, or model call; 18 routes and 5 commands unchanged | Phase 3 goal/rating read surfaces (the last stored-data panel gap) | **landed** — `v0.9.0` (`d0f9b5a`), GitHub Release (Latest until 0.9.1), 544 tests (537 → +7); shipped shape and deviations in [`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §0.9.0 |
| 0.9.1 | Close-history surface: the recent scheduled closes the automation already records (day close, week close, weekly memory lint) join the existing insights payload as one additive `closes` list, and the existing view gains one read-only Close history block; no new route, schema, config key, command, tool, skill, peer, write path, or model call | Native port Phase 3 remainder / §1 Missing (close-history surface) | **landed** — `v0.9.1`, 557 tests (544 → +13); shipped shape in [`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §0.9.1 |
| 0.9.2 | DSH `0.2.2-rc.5` compatibility (maintenance): declare `0.2.2-rc.5` in `dsh.compatibility.dshReleases`, move the seven DSH SDK dev dependencies and the lock from `0.2.1-rc.2` to `0.2.2-rc.5`, add the three client host peers as devDependencies for clean `npm ci` resolution, apply a minimal adaptation only if the new typings require one, and re-run suite/typecheck/build/package; no behaviour, default, schema, config key, route, command, tool, skill, runtime dependency, or host peer change | Maintenance — host-compatibility fix (decision-free) | **landed** (`v0.9.2`) — after the tag/Release the line returns to maintenance |

Order rationale: 0.9.0 went first and landed because it was the only remaining
decision-free item with a real user-visible payoff — the data and the wire types
already exist, so it is a renderer plus an equality test, not new behaviour — and
it closed the last stored-data gap the panel had. 0.9.1 closed the last stored
history the native port recorded as missing, still with no route or decision.
The `dsh dayflow import` CLI is deliberately **not** on this line: it is a new
entry point (5 → 6 commands) whose acceptance belongs beside the cutover's
no-Dayflow runbook. The functional line stops at 0.9.1 because everything further
needs the owner or is a new write/entry surface; the 0.8.4 close's own
advice was "ship the decision-free month/week goal and rating surfaces as 0.9.0
and stop there." **0.9.2 is the one post-close exception, and it is not a theme:**
the harness itself moved to `0.2.2-rc.5` after the tag, so the declared cohort,
the dev dependency pins, and the verification record are no longer true statements
about this tree. Fixing that is maintenance in the narrow sense the pause allows
— verification and necessary fixes only — and it ships nothing a user can see,
configure, or decide.

**The line's tags at this revision:** **`v0.9.0`** (2026-11-27, commit
`d0f9b5a`), **`v0.9.1`** (2026-11-27, annotated tag on commit `ce0827e`, the
functional close; GitHub Release Latest until 0.9.2), and **`v0.9.2`**
(2026-11-27, annotated tag on commit `ccac653`, the maintenance fix; GitHub
Release **Latest**). Each has a GitHub Release, so the repository trail is
**22 tags / 22 Releases** and the line returned to maintenance after the
`v0.9.2` cut. The functional line stays closed at `v0.9.1`.

**The 0.9.0 record (kept as landed history).** Tag `v0.9.0` on `d0f9b5a`, GitHub
Release (Latest until 0.9.1), 544 green tests (537 at 0.8.4, so +7 in 2 files:
two panel route tests and five `client-format` cases), schema v10, 18 routes
(9 GET + 9 POST),
5 commands, 23 tools, 8 skills, no new host peer, npm still 404. The patch shipped
one feature commit (`38178c5`, *feat(panel): show the stored goal and review
marks on month and week*) plus the release commit: the month and week payloads
now attach the day route's own `goal`/`ratings` on the connection they already
open (`goal: null` / `ratings: []` when the user recorded nothing), and the
client renders them read-only — a goal marker plus up to three rating dots (full
count in the marker's accessible label) and a goal summary plus the marks in the
month hover card, and a compact goal chip plus dot row in the week column's meta
line. No route, command, tool, skill, schema step, configuration key, default,
dependency, or host peer changed, and no model is called; the panel keeps one
entry and 18 routes. The docs travelled with the tag (README/README.zh,
`docs/PANEL.md`, `docs/ARCHITECTURE.md`, CHANGELOG, this roadmap, and
[`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md)). The presentation deviations from the
design sketch — the three-dot cap, no extracted hover body, and `ratingColor`
kept as a duplicate of the day view's local map — are recorded in
[`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §0.9.0 *Landed shape and deviations*.

**The 0.9.1 record (kept as landed history).** Annotated tag `v0.9.1` on commit
`ce0827e` (`chore(release): 0.9.1`), whose feature commit is `be7a10c`
(*feat(panel): read the stored close history in the insights view*); GitHub
Release **Latest until 0.9.2**, 557 green tests (544 at 0.9.0, so +13 in 3
files: eleven cases in a new `tests/automation-read.test.ts`, one payload case in
`tests/panel-insights.test.ts`, and one copy case in
`tests/client-format.test.ts`), schema v10, 18 routes (9 GET + 9 POST),
5 commands, 23 tools, 8 skills, no new host peer, npm still 404. The patch made
the automation ledger readable: `PanelInsights.closes: PanelCloseSummary[]` is
one additive list (the 0.8.1 `briefs` precedent), produced by the new
`src/automation/read.ts` (`readPanelCloses`/`listPanelCloses`) from the store's
existing `listAutomationRuns` — no new SQL and no `src/automation/store.ts`
change. Each entry is `{job, day, status, attempts, error?, updated_at}`: newest
`updated_at` first with ties by descending row id, capped at 10 by default (the
reader accepts a 1–20 limit), a stored error clamped to 500 characters, and no
row id, `created_at`, or stored `payload` on the wire. A missing, blank, or
unopenable journal answers `[]` and creates no file; a corrupt ledger row is not
silently dropped — the store's strict mapping surfaces `database_error` and the
route answers a JSON error (503) rather than a shorter history that would read as
complete. The client renders one read-only **Close history** block after
**Briefs**: a job badge (Day close / Week close / Lint), the day or the week's
date range, the localized status, the attempt count when a close needed more
than one, the truncated error summary with the full message in its
`title`/`aria-label`, and the updated date; failed and skipped rows carry one
restrained amber tone, and nothing becomes a button — no retry, no re-run, no add
row, no decision row. Both dictionaries carry the copy, and the block adds no
route, tab, header button, schema step, configuration key, default, dependency,
or model call. The docs travelled with the tag (README/README.zh,
`docs/PANEL.md`, `docs/ARCHITECTURE.md`, `docs/NATIVE_PORT.md`, CHANGELOG, this
roadmap, and [`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md)). The deviations recorded
against the section's sketch — the strict bad-row semantics instead of a
tolerance, the row-local client helpers kept in `insights.tsx`, and the two
`closes: []` literals in `tests/panel.test.ts` — are in
[`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §0.9.1.

**Not on 0.9.x (owner-gated or a new surface):** image admission (D1/D2/D11; the
former 0.8.2 scope), the Phase 4 `source: owned` cutover (D10 plus a real
captured week; the former 0.8.3 scope), any npm publish (D7), the `dsh dayflow
import` CLI, and the owned-journal write path. The 1.0.0 prerequisites — a real
captured week, **D10**, **D1/D2**, **D11**, **D7**, and the first-run/rollback
runbook — were unchanged and untouched by this line; they remain in
[`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.4 G and are restated in
[`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §4 (the owner has since answered D1
`cloud` and D7 `yes` and partially D2, and §0.10.x and §Next line above record
the updated status).

### After 0.9.1 — maintenance, paused pending owner decisions

**`v0.9.1` was the last planned *functional* tag, and the project went into
maintenance; the one post-close exception is the 0.9.2 host-compatibility patch
described below.** It was **paused pending the owner's answers, not abandoned**:
the plugin works at its current scope (readable journal, briefs, review queue,
panel views, native capture and text-only analysis on the safe defaults), every
tag has a Release, and the suite is green (re-run at this revision, after the
post-tag guard: **558 pass, 0 fail** — **557** at the `v0.9.2` tag) — but
everything left is owner-gated, a new product surface, or not
worth a release, so no `0.10.0` or `1.0.0` was opened then. The `0.9.2`
compatibility patch is not a counter-example: it was opened by the harness's own
version move *after* the evaluation below, changes no default, ships nothing a
user can see or configure, and needs no owner answer. The next action at that
revision was the single five-question list in
[`OWNER_DECISIONS.md`](OWNER_DECISIONS.md). This section records the evaluation
that reached that conclusion, so a later round does not re-litigate it. **The
pause ended on 2026-11-27** — D1 (`cloud`) and D7 (`yes`) answered, D2 partially
answered — and the 0.10.x line opened (see *After 0.9.2 — the pause ends: 0.10.x
opens*).

**Decision-free candidates evaluated at this revision — none worth a tag.** Each
was judged against three tests: is the change user-visible? is there a real risk
or defect? is it worth a tag? The verdicts:

| Candidate | What it is | Verdict |
| --- | --- | --- |
| `dsh dayflow import` CLI | One command over the existing `journal_import` importer; a new entry point (5 → 6 commands) | **Deferred, not patch material here.** Decision-free, but it is a new entry surface whose acceptance — import a real Dayflow database losslessly, re-run without duplicating, make `dayflow: false` usable on a machine with no Dayflow — belongs beside the cutover line's no-Dayflow runbook, exactly where the 0.9 plan already puts it ([`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §3). Shipping it alone would front-run a line that is itself gated and add release noise |
| Month/week goal and rating query batching | The month view reads up to three indexed point queries per calendar day (a goal row plus its categories, and the day's review marks) — ~93 queries for a 31-day month, 21 for a week, all on one read-only local connection | **Refactor with no user-visible change and no measured risk.** Batching them would touch the read path for a micro-optimisation on local SQLite; the line's rule (P5) is that a patch needs a user-visible payoff, and this has none |
| a11y / i18n / UX small fixes | No tracked defect: no open issue names one; the view switch, icon buttons, refresh, error summaries, and the close-history error line already carry `aria-label`/`title`; and `tests/client-format.test.ts` asserts `EN`/`ZH` key parity plus the copy rules | **Nothing to fix.** Inventing a polish patch would be release noise |
| docs/README parity | The 0.9.1 docs pass shipped with the tag; the counts agree across `README`/`README.zh`, [`ARCHITECTURE.md`](ARCHITECTURE.md), this roadmap, and the plans (557 tests, 18 routes, 5 commands, 23 tools, 8 skills), and no stale version label remains | **No drift, so no patch.** A docs-only tag would be release noise by definition (R6 attaches docs to a tag; it does not create one) |
| Test dedup (`ratingColor` in `day.tsx` and `format.ts`) | One small pure colour function duplicated between the day view and the shared formatter | **Known, accepted deviation** recorded in [`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §0.9.0 *Landed shape and deviations*; removing it is a client refactor with zero behaviour change and no coverage gain |
| Release tooling | Explicit-version releases are already supported (`nextVersion` accepts `X.Y.Z`), CI gates the tag against `package.json`, the suite and package contents run on every push, and the one historical gap (the `v0.6.0` Release) was a missed Release on an existing tag that was added manually — not a tag whose tooling was missing | **No defect to patch.** A `--backfill` mode for an existing tag would be ops convenience only, with no product change; the operation was exercised once and is in the runbook |

**Verdict: “No further decision-free *feature* patch is worth a tag at this
revision.”** The one fix the evaluation did not and could not cover is the host's
own version move — DSH `0.2.2-rc.5` arrived after `v0.9.1` and after this review
— and that is the single maintenance patch opened below, 0.9.2. **The owner has
since answered:** D1 (`cloud`) and D7 (`yes`) are answered and D2 is partially
answered, which opened the 0.10.x line; a `yes` on D10 plus the real week still
resumes the cutover line (with the CLI import beside the no-Dayflow runbook),
while D11 and D2's remaining form shape the later line. Until those come, the
project holds at 0.10.x — 0.10.0's implementation is complete (2026-11-27;
untagged, waiting on the real-cloud smoke and the publish preconditions) and
the line then holds until D10/D11 and D2's form return — on
[`OWNER_DECISIONS.md`](OWNER_DECISIONS.md).

**Engineering-only guard added after the `v0.9.2` tag — no tag, no new patch,
pause unchanged.** The metadata 0.9.2 realigned — the
`dsh.compatibility.dshReleases` map, the bumped DSH devDependencies, and the peer
ranges — is invisible at runtime, so one more host move could drift it again
exactly as it drifted before 0.9.2, and the behavioural suite would stay green
because no request exercises those declarations. The new
`tests/compatibility.test.ts` closes that gap with one metadata-contract case: it
pins the compat map (`0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.2-rc.5`), the seven SDK and
three client host devDependency pins, the two deliberate deviations (`cordis`
`4.1.0` against the `^4.0.4` peer floor; `schemastery` dev `3.18.5` against the
conservative `~3.18.4` peer), the DSH peer ranges, the empty `dependencies`, and
the absence of an attachment package — with each assertion message naming the
drifted field, so the next upgrade fails at the declaration instead of drifting
silently. It is engineering-only: it adds no behaviour, default, route, schema,
command, tool, skill, or dependency, produces no tag and no release, and left
the pause and the five owner questions exactly as they were at the time (the
owner has since answered D1/D7 and partially D2, opening 0.10.x). It was the
first case the tree gained after the tag (557 → **558**); that count was a
maintenance measurement, not a patch. 0.10.0's implementation has since added
23 cases and the quality pass two more, putting the current tree at **583**
against **557** at `v0.9.2` (581 at the `0d8d3c8` implementation head; the
exact count is recorded at the cut).

### 0.9.2 — DSH 0.2.2-rc.5 compatibility (landed)

**The gap.** The harness moved under the closed line. The DSH app installed on
this machine reports **`0.2.2-rc.5`** (`CFBundleShortVersionString` from
`/Applications/DeepSeek Harness.app/Contents/Info.plist`), while `package.json` at
`v0.9.1` declares `dsh.compatibility.dshReleases` for `0.2.0-rc.2` and
`0.2.1-rc.2` only and pins all seven DSH development dependencies at
`0.2.1-rc.2`; the npm registry carries the full `0.2.2-rc.5` cohort (checked
2026-11-27). The plugin has therefore never been built or tested against the host
it runs on, and its declared compatibility record is one release stale.

**What the gap is and is not.** It is not an admission failure: the host checks
`engines.dsh` if a plugin declares one, else its `@deepseek-ai/dsh`/`dsh-*` peer
ranges, with prereleases included (`plugin-compatibility.ts` in the 0.2.2-rc.5
app bundle); this plugin declares no `engines.dsh`, and its `^0.2.0-rc.2` peers
already admit `0.2.2-rc.5`. The `dshReleases` map is the declared-compatibility
record rather than an admission input, so no installed user is blocked and no
runtime defect is claimed. What is real is the stale declaration plus the missing
verification — maintenance-class work under the pause.

**Scope (decision-free, patch-level).**

- `package.json`: add `"0.2.2-rc.5": "compatible"` to
  `dsh.compatibility.dshReleases` beside the two existing entries, and move the
  seven DSH development dependencies (`dsh-llm`, `dsh-skill`,
  `dsh-system-prompt`, `dsh-tools`, `dsh-util-values`, `dsh-client-connection`,
  `dsh-client-ui-primitives`) from `0.2.1-rc.2` to `0.2.2-rc.5`; refresh
  `package-lock.json`. No dependency is added and no peer entry or host peer range
  changes.
- `src/**`: a minimal source/typing adaptation **only if** the `0.2.2-rc.5`
  declarations require one; behaviour, defaults, and the wire contract stay
  identical.
- `tests/**`: the suite runs on the new cohort; any assertion about the
  compatibility map stays true, and no test case is dropped or weakened.
- Verification: `npm test` (**557+** at the cut), `npm run typecheck`,
  `npm run build` (host and client bundle), and `npm run check:package`.
- Docs travel with the tag (R6): README/README.zh, `docs/ARCHITECTURE.md`,
  `docs/RUNBOOK.md`, `CHANGELOG.md`, this roadmap section, and
  [`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §0.9.2.

**Acceptance.**

- The suite is green on the `0.2.2-rc.5` dev dependencies at **557+ cases** —
  v0.9.1's 557 are the floor and the count is recorded at the cut — with no
  assertion removed or weakened; `typecheck`, `build` (host and client bundle),
  and `check:package` are green.
- `dsh.compatibility.dshReleases` lists exactly `0.2.0-rc.2`, `0.2.1-rc.2`, and
  `0.2.2-rc.5`, each `"compatible"`; no `engines.dsh` is added.
- The diff changes no behaviour, default, schema (**v10**), route (**18**: 9
  `GET` + 9 `POST`), command (**5**), tool (**23**), skill (**8**), configuration
  key, runtime dependency, or host peer entry, and no model call or egress
  changes.
- `package.json` differs only in the dev-dependency pins and the compatibility
  map (plus the release commit's version bump), and the lock follows; if the new
  cohort's own peer declarations force the `cordis`/`schemastery` pins or those
  two non-DSH peer ranges to move, that is the one recorded deviation (risk 2
  above), not a new dependency or peer.
- Release: `v0.9.2` is tagged with a GitHub Release from the CHANGELOG section
  (`v0.9.2` becomes the 22nd tag and Release); npm still answers **404** (D7) and
  no publish happens; the line returned to maintenance, and the five owner
  questions were untouched by the patch at the time. The owner has since
  answered D1/D7 and partially D2, which opened 0.10.x (§0.10.x).

**Why 0.9.2 and not 0.10.0.** It is a patch by every test in this roadmap: no new
surface, no new default, no schema/route/config change, no new dependency, and no
user-visible behaviour — the only things that change are the declared
compatibility metadata and the dev-only toolchain, and the package version moves
only because a released tag is immutable and the fix needs its own record. A minor
would advertise a functional increment the release does not have; 1.0.0 is the
cutover line and stays owner-gated. It cannot "reopen 0.9.1" either: `v0.9.1` is
an annotated tag whose tree is released and described, so a new patch tag is the
honest record, exactly as 0.9.0 and 0.9.1 were separate slots.

**Risk and rollback.** Low, with three named risks: (1) **typing/API drift** in
`0.2.2-rc.5` — if a declaration the plugin imports changed, the adaptation stays
minimal and behaviour-identical, and the suite is the gate; (2) **the toolchain
chain** — the `0.2.2-rc.5` packages declare their own peers on cordis `~4.1.0`
and schemastery `~3.19.0` (the host app ships cordis 4.1.0 and schemastery
3.19.0), while the `v0.9.1` tree pins `@deepseek-ai/cordis` `4.0.5` and
`@deepseek-ai/schemastery` `3.18.5` and declares the non-DSH peer ranges
`^4.0.4` / `~3.18.4`; if the cohort's own declarations force a pin or a non-DSH
peer range to move, that is a declared deviation recorded in
[`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §0.9.2 *Landed shape and deviations*,
never a new peer or dependency; (3) **verification gap** — a green suite proves
the plugin against its dev dependencies, not inside the host, so the host's
admission rule is recorded as evidence and a real load check is attempted where
possible. Rollback is a normal revert of the patch commits: a declaration plus
dependency pins and a lockfile, with no migration, no profile state, and no
configuration key to switch (R8's config-first rule has nothing to act on); a
defective tag is corrected by a forward patch, never by moving it.

### After 0.9.2 — the pause ends: 0.10.x opens (2026-11-27)

**The maintenance pause is over.** On 2026-11-27 the owner answered **D1 =
`cloud`**, **D7 = `yes`**, and partially **D2** (several custom models wanted,
DeepSeek first; the A/B/C form is still open). The three answers are recorded
with their safe-default and unlock effects in
[`OWNER_DECISIONS.md`](OWNER_DECISIONS.md); this section records the line they
open. What changes is narrow and deliberate:

- **D1 `cloud`** permits screen metadata to be analysed by a cloud provider
  after an explicit `analysis.consent: cloud`; the default profile still makes no
  call, and because **D11 is still open** the contract stays **text-only** (no
  pixels, no attachment peer, no `privacy_apps`).
- **D7 `yes`** authorises npm publication, but **nothing has been published**:
  the registry still answers **404** and this machine is not logged in. The
  publish is a separate reviewed step that needs an npm login/token, 2FA, and the
  owner's explicit version confirmation; it creates no tag and moves no Release.
- **D2's partial answer** is the direction, not the form: 0.10.0 implements
  option **A** (a named model list with one active entry per call; implemented,
  untagged), and **B** (fallback)/**C** (custom `baseURL`) wait for the owner's form
  choice.

What does not change: the 0.9.x record above (closed at `v0.9.1` for function plus
the 0.9.2 maintenance tag), **D10 and D11's safe defaults**, the absence of any
cutover default, the text-only analysis contract, and the fact that no `1.0.0`
is planned — D10 plus a real captured week still gate it. The line's plan is
[`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md); **its 0.10.0 implementation is
complete as of 2026-11-27** (`main` `0d8d3c8`), it is not tagged, and the tag
waits on the plan's §3.7/§3.9 hard gate — the recorded real-cloud smoke; the
separate npm publish waits on an npm login and the owner's version
confirmation (§4 and [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md)).

## 0.10.x iterations

The 0.10.x line is the first line opened after the 0.9.x close, and it is
**not** a renumbering of the deferred 0.8.2/0.8.3 slots: image admission (D11)
and the cutover (D10) stay out. It carries the analysis work the owner's answers
authorised — **cloud analysis plus multi-model selection (option A baseline)** —
and it prepares, without performing, the first npm publish. Its execution plan is
[`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md): the configuration shape and
validation, the file-level deliverables, the acceptance at the assertion level,
the deferred forms, the release/publish strategy, and the real-cloud
verification that CI cannot provide.

**Round status (2026-11-27): 0.10.0 remains in progress — its implementation is
complete, and the patch is untagged and gated.** The approved A-baseline shape
is in the tree at `main` `0d8d3c8` (feature commit `7de9aec`, docs commit
`0d8d3c8`) in parallel lanes — host configuration (`analysis.models`, the
resolved pair and `modelId`, the additive optional `model` status summary), the
client display, the provider page, and the docs — while the plan maintains the
measured gates, the file-level scope, and the post-tag publish preconditions in
[`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md) §3.9. The suite measures **583/583**
green — 581 at the implementation head plus the two pipeline list-mode cases
from the quality pass (558 at the planning baseline, 557 at `v0.9.2`); `npm run
typecheck`, `npm run build`, and `npm run check:package` are green, and CI on
`main` is green. **Nothing is tagged and no npm publish has run**, and **this
roadmap is not written as landed until then**: the tag waits on the plan's hard
gate — one real-cloud smoke recorded without a key — and the publish on
[`PUBLISH_PLAN.md`](PUBLISH_PLAN.md)'s preconditions (npm login/2FA, the owner's
version confirmation, plan §4). D2's **B**/**C** forms, **D10**, and **D11** are
unchanged and still deferred.

| Patch | Theme | Roadmap item | Status |
| --- | --- | --- | --- |
| 0.10.0 | Cloud analysis + multi-model selection (option A baseline), provider setup, first-npm-publish preparation: a named `analysis.models` list (`{id, provider, model, label?}`) with exactly one active entry per call (first entry by default, `analysis.model` selects an entry id), the legacy `analysis.provider`/`analysis.model` pair unchanged when the list is empty, both consent gates and the scheduled closes/briefs using the active pair, and the analysis status line naming the active model through the additive optional `model` field on the analysis status payload (its label when present, otherwise `provider`/`model`); the provider page [`docs/PROVIDERS.md`](PROVIDERS.md) (written in the planning round) updated for the named list, host-provider/`apiKeyEnv`-or-credentials setup, rotation, and the text-only cloud disclosure; one recorded real-cloud smoke. No schema, route, command, tool, skill, host peer, runtime dependency, image, cutover, or write-path change; the npm publish itself is a separate owner-confirmed step, not part of this patch | Phase 3.6 (cloud analysis and its honest privacy copy) and the Native port analysis line; owner answers **D1 = `cloud`**, **D2 partially answered (multi-model direction, option A)**, **D7 = `yes` (publication authorised, not executed)** | **in progress — implementation complete, untagged (2026-11-27) on `main` `0d8d3c8`; 583 tests, typecheck/build/`check:package` green; not tagged and no publish — the tag waits on [`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md) §3.7/§3.9's hard gate, the recorded real-cloud smoke; release preparation in [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md)** |

Order rationale: 0.10.0 goes first because it is the only patch the two full
answers point at — D1 makes a real analysed day/week possible, D2's direction
asks for several custom models with DeepSeek first, and the tree can call one
hand-written pair but cannot name a set of models or tell the user which one is
active. Option A is the minimum shape that serves that answer without inventing
the fallback/`baseURL` semantics the owner has not chosen. The provider-page
update and one real-cloud smoke are part of the patch, not follow-ups: without
them "cloud analysis works" is a claim this tree has never evidenced, and CI
deliberately never calls a model. The legacy pair is frozen, so no existing
profile changes behaviour. **B/C wait for D2's form**, image admission waits for
D11, the cutover waits for D10 and the real week, and the `dsh dayflow import`
CLI and the owned-journal write path stay off this line. The npm publish is
authorised by D7 but is **not** part of the patch: it is a separate reviewed step
after the tag, with an npm-login/token precondition this machine does not yet
meet and the owner's explicit version confirmation; the recommended first-publish
version is 0.10.0, with the 0.9.2-first alternative and its cost in
[`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md) §4.

**The line's tags at this revision: none yet; 0.10.0 is implemented and
untagged.** `v0.9.2` (`ccac653`) remains the repository's latest tag and GitHub
Release, the trail is **22 tags / 22 Releases**, and npm still answers **404**
(D7 answered, publish not executed). The implementation is complete (583 tests;
typecheck/build/`check:package`/CI green), so the only remaining gate before the
tag is the recorded real-cloud smoke. A `v0.10.0` cut would be the **23rd** tag
and Release; it is not cut until the plan's gates — including one recorded
real-cloud smoke and no committed secret — are green, and **the cut is the
lead's decision after that smoke, not a pre-written status**.

**Not on 0.10.x (deferred, gated, or a separate act):** image admission (D1
answered, but **D2 vision-capable entries and D11** are not), the Phase 4
`source: owned` cutover (**D10** plus a real captured week), D2's **B**
(fallback) and **C** (custom `baseURL`) forms, the `dsh dayflow import` CLI, the
owned-journal write path, and the **npm publish execution** itself (a separate
owner-confirmed step, see the plan §4). The 1.0.0 prerequisites are otherwise
unchanged: D1/D7 are now decided but D2's form, D11, D10, and the real captured
week still stand.

## Next line (1.0.0)

The 0.9.x line's two functional patches landed without a functional default
change, and its one maintenance patch 0.9.2 changed none of the 1.0.0
prerequisites. The 0.10.x line now carries the analysis work the owner's answers
authorised — D1 = `cloud` and D2's multi-model direction, with 0.10.0
implemented (option A; untagged, waiting on the real-cloud smoke) — and
prepares the first npm publication D7 authorised, but it still changes no
capture, import, or cutover default, so **1.0.0 remains gated on the
owner, not on engineering:**

1. **1.0.0 prerequisites (all required):** a real captured week on the owned
   default (capture on, `source: owned`, Dayflow closed, zero data loss across
   restarts, recorded in `docs/CUTOVER_REHEARSAL.md`); **D10** explicit
   authorisation to flip the default (**still open**); **D1/D2** satisfied for an
   analysed week — D1 is answered (`cloud`) and option A makes a named pair
   configurable, but **D2's form is only partially answered**, so its "decided"
   box stays open until the owner picks A/B/C or explicitly accepts A; **D11**
   image admission decided (**still open**; 1.0.0 can ship text-only on an
   explicit "not now"); **D7** npm publication decided (**answered `yes`** — the
   publish itself is a separate reviewed step that needs credentials and the
   owner's version confirmation and changes no tag, so 1.0.0 can ship as a GitHub
   Release even if the publish is still pending); and the first-run/rollback
   runbook exercised — the manual is written ([`RUNBOOK.md`](RUNBOOK.md)); what
   the prerequisite still needs is the walkthrough on a real cutover, so D10 and
   the week are unchanged as gates.
2. **Not without the owner:** image admission (D11, with vision-capable D2
   entries), the cutover default flip (D10), the publish execution itself (D7's
   reviewed step), and the owned-journal write path.
3. **The next action on the decision list:** D10 and D11 (explanations already
   given), plus the D2 A/B/C form. D1 and D7 are answered; the consolidated list,
   with each question's options, safe default, unlocked patch, and the cost of
   not answering, is [`OWNER_DECISIONS.md`](OWNER_DECISIONS.md). Engineering's
   line in the meantime is the 0.10.0 plan
   ([`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md)).
4. **No 1.0.0 line without the remaining answers.** 0.10.x does not open 1.0.0
   and does not flip a default: while D10 is unanswered there is no cutover, and
   while D11 is unanswered releases stay text-only. A "not now" is an answer that
   keeps the safe default and changes nothing structurally; a missing answer
   keeps the gate.

**Engineering prep that needs no owner answer.** Three items on or beside the
1.0.0 checklist need no decision from the owner: the operator runbook, the
cutover rehearsal, and the CLI import that stays queued behind the cutover. They
can proceed without an answer — and doing so changes no default, cuts no tag,
and does not start the line:

- **The operator runbook was written this round.** [`RUNBOOK.md`](RUNBOOK.md)
  is the single-file manual for the machine as it is today at `v0.9.1` (tagged,
  package still not on npm): what is installed and the health commands, first
  run from a checkout, the safe switches and why the defaults are safe, data
  locations and backup, upgrade between tags, rollback, the maintenance
  checklist, and troubleshooting, closing with the commit and tag it was checked
  against. It is written, not exercised: the prerequisite above is a
  first-run/rollback walkthrough on a real cutover, which still needs D10 and the
  real week.
- **The rehearsal already exists.** [`CUTOVER_REHEARSAL.md`](CUTOVER_REHEARSAL.md)
  is the checklist and `npm run rehearsal` is its executable form — a fixture dry
  run through capture, analysis, the briefs, day insights, the weekly close, and
  a restart (re-run at this revision: **20/20 checks**). What is missing is not
  the rehearsal but the real-week record it would leave under `source: owned`,
  which is owner-gated.
- **The CLI import stays on the cutover line.** `dsh dayflow import` is
  decision-free, but it is a new entry surface (5 → 6 commands) whose
  acceptance — a lossless import, a re-run that does not duplicate, and
  `dayflow: false` usable on a machine with no Dayflow — belongs beside the
  no-Dayflow runbook it makes usable. It is deliberately not built here, so this
  round does not front-run a line that is itself gated.

The 0.9.2 compatibility patch was the paused round's other decision-free work:
maintenance rather than 1.0.0 prep, it changed no default or decision and is
recorded above rather than here.

These are not a 1.0.0 and not a release: no route, schema step, tool, skill,
command, or default changes, and no tag follows from the three prep items. They
are recorded so a later round can see what is already done; the 0.10.x line is
separate from them and contains no cutover or import work.

## What this deliberately does not do

- **No screen recording by default.** The owner-selected native port is the one
  deliberate exception (see Native port above): its Phase 1 capture engine is
  merged but inert unless the profile sets `capture.enabled: true`, and cloud
  analysis needs its own consent. Nothing records the screen on a default
  profile, which is also why privacy has to work at the summarization boundary
  (3.6) rather than only at the capture boundary the way Dayflow does it.
- **No reimplementation of Dayflow's AI pipeline outside the native port.** The
  plugin does not need to turn screenshots into cards if the cards arrive by
  import or by the agent writing what it did. The native port's analysis phase
  (0.7.1–0.8.0, text-only through the line so far) is the deliberate exception,
  and it goes through `ctx.llm.stream()` with one strict JSON contract, not a
  rebuilt provider zoo. 0.10.x turns on **cloud analysis** behind the explicit
  consent the owner authorised and adds a named model list, but the contract
  stays **text-only**; pixels would arrive only after **D11** (the deferred 0.8.2
  scope, owner-gated and not on this line), so no attachment peer exists.
- **No card-stack review as the centre.** It stays available and defaults to off
  (3.5). The review that matters is the distillation, loop, and improvement
  queue.
- **No Swift in the plugin's logic.** Everything written by hand stays Node +
  TypeScript. The single exception, agreed with the native port, is the embedded
  helper source in `src/capture/provider.ts`, compiled locally only when the
  capture engine needs frontmost-app, idle, and screen-lock metadata; Dayflow's
  Swift is still read for semantics, never copied.
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

*Historical: this was the advice before any of it shipped. Phases 1+2 landed in
0.6.0 and 3.5 in 0.7.0, the 0.8 line closed at 0.8.4, and the 0.9 line closed at
`v0.9.1` for function (0.9.0's month/week goal and rating surfaces and 0.9.1's
close-history surface, plus the post-close 0.9.2 compatibility maintenance
patch), so the current order of work is the 0.10.x line and then the 1.0.0
prerequisites with the remaining owner questions (D10, D11, D2's form), not this
list; it stays because the reasoning still explains why the early work was
sequenced that way.*

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

Question 3 now has a shipped default (the context is on, capped at 1000 bytes,
and `memoryContext: false` switches it off), so what remains open is whether
that default should stay on; question 4 is made concrete by 0.7.4's automation
cap (at most three proposals a day at confidence ≥ 0.6, inside the store's own
five-a-day cap) and the decisions listed in [PATCH_PLAN.md](PATCH_PLAN.md) §6
and [`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §6. D10 and D11 were the two new
owner decisions the 0.8 line needed; **D10 and D11 are still open**, while **D1
is answered `cloud`**, **D7 is answered `yes`** (publication authorised, not
executed), and **D2 is partially answered** (multi-model direction; A/B/C form
open). Those three answers opened the 0.10.x line above; the remaining two sit
on the 1.0.0 line, and
[`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.4 G lists them with the release
each unblocks (1.0.0 for the cutover, a later line for image admission). The
five release-gating decisions are consolidated, with options, safe defaults, and
what each unlocks, in
[`OWNER_DECISIONS.md`](OWNER_DECISIONS.md); the questions above are product-shape
questions that no tag waits on.

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
