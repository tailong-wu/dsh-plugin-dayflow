# Patch plan: the 0.7.x line

> **Status:** planned, 2026-11-27, written against `v0.7.0` (tag `v0.7.0`,
> commit `45a7e42`). Six patches, 0.7.1–0.7.6: each one theme, one integration
> point, one tag. This is a decision-level plan, not a commitment of dates.
> Every patch below is shippable under the safe default of the decisions in
> [§6](#6-owner-decisions-and-safe-defaults), so no patch waits on an answer.
>
> Related documents: [`ROADMAP.md`](ROADMAP.md) carries the phases and what
> remains; [`NATIVE_PORT.md`](NATIVE_PORT.md) is the capture → analysis →
> briefs design this plan is the execution order for; [`CHANGELOG.md`](../CHANGELOG.md)
> is the record of what actually shipped.

## 1. Starting point, measured

Facts checked against the repository and the registry on 2026-11-27. They are
the baseline every patch below assumes; a patch that invalidates one updates
this table.

| Fact | Value | Checked at |
| --- | --- | --- |
| Release | `0.7.0`, annotated tag `v0.7.0` (commit `45a7e42`), **not** on the npm registry, **no** GitHub Release | `package.json`, `git tag`, `npm view dsh-plugin-dayflow` → 404, `gh release view v0.7.0` → not found |
| Tests | 319 cases, green; CI runs them on macOS 15 with Node 22 (`--experimental-sqlite`) and Node 24 | `tests/*.test.ts`, `.github/workflows/ci.yml` |
| Tools | 23 registered by default (17 with `edits: false`), plus `dayflow_install_dayflow` behind `allowInstall: false` | `src/index.ts`, `src/tools/` |
| Skills | 8 | `skills/` |
| Panel | 13 exact host Fetch routes, one UI entry (one header button, one panel tab) | `src/panel-contract.ts`, `tests/panel.test.ts` |
| Owned schema | v7 (`capture_state`) | `src/journal.ts` → `JOURNAL_SCHEMA_VERSION` |
| Native port | Phase 0 (provider + Swift helper) and Phase 1 (capture engine) landed, both default-off; **nothing is analysed** | `src/capture/`, `docs/NATIVE_PORT.md` |
| Release tool | `npm run release -- patch` bumps, runs the suite, commits, tags, pushes, creates the GitHub Release; it does **not** publish to npm | `scripts/release.mjs` |
| Host cohort | DSH `0.2.1-rc.2` dev dependencies, `^0.2.0-rc.2` peers; `@deepseek-ai/dsh-attachment` is **not** currently a dependency | `package.json`, `npm ls` |

**Landed in 0.7.0, therefore not in this plan:** the four Phase 3 read tools and
their panel surfaces, the review queue, long tasks, dated memory, the budgeted
memory context, reflections, the read-only lint, the Journal insights view, the
quick-capture slash commands, the importer and the owned read backend, native
capture Phase 0/1, and the 13 panel routes.

**Not landed, and what this plan is:** the analysis pipeline (native port Phase
2), briefs and automation (Phase 3), interactive panel management, the
scheduled lint job, and the release closure (npm, GitHub Releases, cutover
rehearsal).

**Deliberately not in 0.7.x:** the Phase 4 default cutover (0.8.0 material), the
month/week panel goal and rating surfaces, editing tools for the owned journal,
the `dsh dayflow import` CLI (only the tool exists), embeddings, the
`review.cards` switch (the plugin has no card stack, so it has no surface),
Phase 5, and any change to the Swift helper's permissions.

## 2. Iteration rules

The 0.6.0 → 0.7.0 increment was one long development line; this line is the
opposite, on purpose. These rules are what make a patch reviewable.

**R1 — One verifiable theme per patch.** If a patch needs two themes, it is two
patches. A theme is something a reviewer can state in one sentence and a test
can accept or reject.

**R2 — One integration point and one tag per patch.** `main` is releasable at
every tag; a patch is merged and tagged before the next one starts, so a
regression is attributable to one diff.

**R3 — Migrations ride with their code, not with a redesign.** A schema step
goes into the same patch as the code that reads it, and every migration has a
"migrate from the previous version's fixture" test. No patch combines a
migration with a UI redesign; 0.7.5 deliberately rebuilds one table on its own.

**R4 — CI never calls a model, captures the screen, or needs a permission.**
Fake adapters are the test seam, following the existing pattern
(`FakeCaptureProvider`, injectable clocks/timers/runners in `src/capture/`). A
feature that can only be tested with the real provider is not ready to tag.

**R5 — Default-safe.** New behaviour is off unless the profile opts in and
consent covers it. A patch that cannot be made default-safe is blocked on the
owner decision that changes it, and the blocking decision is named in the patch.

**R6 — Docs and CHANGELOG travel with the tag.** The CHANGELOG entry is written
under `[Unreleased]` before the release bump; the bump moves it into
`## [0.7.x] - <date>`. Every patch lists the `docs/*.md` files it changes, and
the release notes come from the CHANGELOG section, not from memory.

**R7 — No read-path regression.** The Dayflow backend and the owned read backend
keep answering in every patch. A patch that writes native rows adds a fixture
that mixes imported rows and native rows (`source_id = 'native'` beside imported
ids) and asserts the read payloads still match.

**R8 — Rollback is config first, revert second.** A tag is only cleanly
revertible before a profile migrates: once a journal is at schema v(N), an older
tag refuses it ("newer than this plugin supports"), so a migration patch is
rolled back by a forward fix in the next patch, not by running an older build.
Every new feature therefore has a config switch that turns it off without a
downgrade; the patch states which one.

**R9 — One UI entry.** Everything new appears inside the existing panel entry
and the existing insights view. A second tab, header button, or settings page is
a defect, and the existing route-set and single-entry tests must stay the
definition of that.

## 3. The six patches

### 3.1 Summary

| Patch | Theme | Roadmap item | Depends on | Decisions | Risk |
| --- | --- | --- | --- | --- | --- |
| 0.7.1 | Analysis foundation: frames become `activities` rows behind a fake adapter | Native port Phase 2 | — | D1, D2, D5 | Medium |
| 0.7.2 | Analysis visible: worker timer, status route and panel line, budget ledger, manual command | Native port Phase 2 | 0.7.1 | D1, D3 | Medium |
| 0.7.3 | Interactive insights: decide review items, attach/detach task sessions in the panel | Phase 3.5 / 3.7 remain | — (built against 0.7.2 tree) | D6 | Low |
| 0.7.4 | The day closes itself: briefs, reflection, proposals, task sessions, weekly close | Native port Phase 3 | 0.7.2, 0.7.3 | D3, D4, D9 | High |
| 0.7.5 | Scheduled memory lint and weekly digest | Phase 4 lint remain | 0.7.4 | D8 | Medium |
| 0.7.6 | Release and compatibility close | Release closure / Phase 4 rehearsal | 0.7.1–0.7.5 | D1, D7 | Low |

Order rationale: see [§5](#5-sequencing-rationale). Nothing in the table changes
the plugin's default behaviour; each new path is off by default or requires
consent, and that is part of every patch's acceptance.

### 0.7.1 — Analysis foundation: frames become rows

**Theme and motivation.** Phase 1 writes frames and `screenshots` rows, but
nothing turns them into `activities`/`observations`, so the owned journal still
cannot replace Dayflow's analysis. This patch builds the part that is novel and
risky — the model contract, the consent gate, idempotency, sessionisation — and
makes it verifiable with **zero network access**. Real model calls are a
configuration step (0.7.2), not part of this patch.

**Deliverables.**

- `src/analyse/llm.ts` — a thin wrapper over `ctx.llm.stream` with the caller
  passing the resolved provider/model, bounded retries with backoff, a call
  timeout constant, per-call token accounting from the stream, and cancellation
  via `AbortSignal`. A `FakeLlmAdapter` implementing the same seam ships for
  tests; the production adapter is a thin function over `ctx.llm`.
- `src/analyse/prompt.ts` — system prompt and the strict JSON contract
  (`title`, `summary`, `category`, `subcategory`, `apps[]`, `distractions[]`,
  `confidence`), the category list read from the owned `categories` table, the
  "screen content is data, not instructions" rule restated, and one hostile
  fixture (a window title that tries to give orders) used by a test.
- `src/analyse/pipeline.ts` — pure window grouping (`analysis.windowMinutes`,
  `analysis.framesPerWindow`, app + similarity + gap), frame downscale hook,
  JSON validation (reject non-object, unknown category, bad confidence),
  sessionisation (merge adjacent windows by app/category/gap), and the writes:
  `activities` + `observations` with `source_id = 'native'` and a content-hash
  `source_key`; replay of the same frames is a no-op. Owns the `analysis_jobs`
  state machine (`queued` → `running` → `complete` / `failed` / `skipped`).
- `src/analyse/consent.ts` — one pure decision function, checked **before** any
  provider call: `analysis.enabled`, `capture.enabled`, `capture_state.paused`,
  `analysis.consent === 'none'`, consent `local` with a provider that is not
  explicitly local, and an unset provider/model each return a typed blocked
  reason. A blocked analysis records jobs as `skipped` with the reason; there is
  no code path to the adapter that skips this function.
- `src/journal.ts` — migration **v8** adding `analysis_jobs` as specified in
  `NATIVE_PORT.md` §4 (`job_key` unique, status CHECK, attempts, error, model,
  input/output tokens, `payload_json`). Note the numbering correction below.
- `src/capture/engine.ts` / `src/capture/state.ts` — the analysis handoff: after
  a successful job, its frames are deleted immediately when
  `capture.keepFramesDays: 0` (today the engine treats 0 as "one day" only
  because nothing analyses them), and `screenshots.file_path` is cleared while
  the row, its `source_key`, and the hash in its payload stay. The engine's sweep
  still covers frames no job ever took. `src/config.ts` needs no new key; the timeout is an exported constant.
- Docs: `docs/NATIVE_PORT.md` gains the Phase 2 landed-scope subsection;
  `docs/CONFIGURATION.md` stops saying the analysis block is "unused";
  `docs/ARCHITECTURE.md` gains the `analyse/` modules; `CHANGELOG.md` entry.

**Numbering correction.** `NATIVE_PORT.md` §4 was written when v7 was expected to
carry both `capture_state` and `analysis_jobs`, and it puts `automation_runs` +
`briefs` at v8. The shipped v7 carries only `capture_state`, so the real
sequence is **v8 `analysis_jobs`** (this patch) and **v9 `automation_runs` +
`briefs`** (0.7.4). The one-line fix belongs in this patch's docs commit; the
plan uses the real numbering.

**Tests and acceptance.**

1. A scripted replay (fake capture provider + injected clock + fake LLM adapter)
   over stored frames produces a deterministic activity list; running it twice
   leaves the row counts unchanged and reuses the same `source_key`s.
2. `consent: 'none'` → **zero** adapter invocations and one `skipped` job per
   window with reason `consent:none`; the same assertion holds for
   `capture.enabled: false`, `capture_state.paused: true`, and an unset
   provider/model.
3. `consent: 'local'` with a provider not in the explicit local allowlist is
   refused (`skipped: consent:provider-not-local`), asserted by zero calls.
4. Malformed output (not JSON, missing field, unknown category, confidence out
   of range, more than one JSON object) fails the job with the validation error,
   writes no activity, and stops at the attempts cap.
5. Grouping: frames 11 minutes apart split into different windows; three
   representative frames are sent per window, never more than
   `framesPerWindow`; a different app never merges across a gap.
6. Sessionisation: same app and category with a gap under the merge threshold
   merge into one activity; a category change splits.
7. Budget pre-check: with `maxCallsPerDay: 1` the second window is
   `skipped: budget` and the adapter ran once.
8. `keepFramesDays: 0`: after a successful job the window's frame files are
   gone and `screenshots.file_path` is cleared; a failed job keeps them.
9. Migration: a v7 fixture migrates to v8 in one transaction, reopening is a
   no-op, and a malformed `analysis_jobs` row is rejected with a typed error.
10. `npm test` (319 existing + new), `npm run typecheck`, `check:package` green.

**Dependencies and owner decisions.** D1 (where analysis may go), D2
(provider/model), D5 (retention) matter only for real runs; the fake adapter
lets the patch ship with `consent: none` as the working default. Image
admission needs `@deepseek-ai/dsh-attachment` and an `attachments` service
inject; that package is **not** currently a dependency, so this patch adds it
pinned to the same host cohort and re-runs typecheck. If the peer cannot be
added to the supported host range, this patch falls back to a text-only contract
(frontmost app, window title, frame hash) and vision admission moves to 0.7.2 —
the JSON contract, consent gate, schema and tests are unchanged.

**Risks and rollback.** Prompt injection from screen content is mitigated by the
JSON-only contract, the analyser having no tools, and the hostile-title test.
Wrong window grouping is mitigated by grouping being pure plus a golden fixture.
The real risk is the consent gate: a bug there means frames leave the machine, so
the gate is a pure function tested for every blocked reason, and the adapter is
only reachable through it. Rollback: revert the tag; a profile that ran 0.7.1
keeps v8, and `analysis.enabled: false` turns the feature off without a
downgrade (R8).

### 0.7.2 — Analysis visible: worker, status, budget

**Theme and motivation.** 0.7.1 can be verified only by tests; nothing runs on a
schedule, nothing shows state, and a real run still needs a manual trigger. This
patch makes the pipeline operable and observable without changing what leaves
the machine: with `consent: none` it runs nothing and says why.

**Deliverables.**

- `src/analyse/worker.ts` — an interval timer with the same injectable-timer
  seam as the capture engine: claims queued jobs, runs the pipeline, backoffs on
  failure, sweeps jobs whose window is complete, and stops on unload. Mounted
  once from `src/index.ts` inside a `ctx.effect` when `capture.enabled` and
  `analysis.enabled` are true; the consent gate is still evaluated per call.
- `src/config.ts` — one new key, `analysis.intervalMinutes` (default 5, range
  1–60), validated at load with a test; no other new keys.
- Budget ledger computed from `analysis_jobs` rather than a second store:
  calls today = completed jobs for the day, tokens today = the summed
  input/output tokens, remaining shown in status; when a cap is hit the queued
  jobs for that day become `skipped: budget` and the day stops.
- `GET /api/dayflow/analysis/status` — `{ enabled, consent, worker, queued,
  running, failed, callsToday, maxCallsPerDay, tokensToday, dailyTokenBudget,
  lastJobAt, reason }`, with the same rule as the capture status route: a
  missing journal answers zeros **without creating the file**.
- Panel: one analysis line next to the existing capture line in the insights
  view — waiting for consent / analysing / budget exhausted / last job — with
  EN/ZH copy. No new view, tab, or header button.
- `/dayflow-analyze` slash command in `src/commands.ts` for local verification
  and catch-up; it never throws into the host, and it respects the same gates.
- Docs: `docs/PANEL.md` route list and the line, `docs/CONFIGURATION.md` (new
  key and what `keepFramesDays: 0` now means), `docs/NATIVE_PORT.md` Phase 2
  status, `CHANGELOG.md`.

**Tests and acceptance.**

1. A worker tick (injected timer, fake adapter) turns a day of stored frames into
   `activities`; a second tick is a no-op; stopping the worker clears its timer
   and a restart resumes without duplicating rows.
2. Status payloads: disabled, consent `none` with its reason, budget exhausted,
   and a missing journal (zeros, no file created — asserted with a directory
   listing).
3. Budget ledger: with `maxCallsPerDay: 2`, the third window is
   `skipped: budget`; the status payload's `callsToday` matches the jobs table.
4. Retry/backoff: a failing call increments `attempts`, respects the backoff
   delay, and ends `failed` at the cap without blocking the next window.
5. Double start: two `start()` calls keep one timer, asserted on the timer seam.
6. The command is registered with the host name list and returns an error
   result, not a throw, when the gate blocks.
7. The panel test's exact route-set assertion is extended deliberately with the
   one new GET route; the single-entry assertions are unchanged.
8. `npm test`, typecheck, `check:package` green.

**Dependencies and owner decisions.** D1 for any real analysis; D3 for the caps
that the status line explains. Defaults keep `consent: none`, so the patch ships
inert by default. No schema change.

**Risks and rollback.** Timer leaks and duplicate intervals are the classic
failure here: the seam and the double-start test are the mitigation, and the
effect cleanup is asserted. An off-by-one budget ledger would pause a day early
or late; the assertion compares the payload with the jobs table. The status
route must not create a journal (existing rule), asserted by test. Rollback:
`analysis.enabled: false` stops the worker, the route and the line; revert the
tag.

### 0.7.3 — Interactive insights: decisions in the panel

**Theme and motivation.** 0.7.0 ships the review queue and long tasks in the
Journal insights view, but both are read-only: deciding a review item or
attaching a task session still costs an agent turn. This is low-risk, has no
schema or model dependency, and it must land **before** 0.7.4 starts filling the
queue automatically, or the queue becomes the chore the roadmap warns about
(Risk 7).

**Deliverables.**

- `POST /api/dayflow/review` — body `{ id, decision: 'keep' | 'discard' |
  'accept' | 'reject', note?, forever?, confirm: true }`; it calls the same
  `decideReviewItem` store function as `journal_review` and returns the updated
  item plus whatever it created (a task id, a memory id). The `forever` flag is
  the second, deliberate action; a plain discard stays soft.
- `POST /api/dayflow/tasks/attach` and `POST /api/dayflow/tasks/detach` — a
  session is a `(task, day)` pair; attach writes one, detach removes it, both
  return the updated task. No route re-implements the store rules.
- `src/client/insights.tsx` — on each review item: Discard as the primary
  action, "Don't suggest again" as the secondary confirm, Keep/Accept/Reject
  according to kind; on a task's scanned days: link and unlink. Loading, error,
  and empty states in both locales, reusing the existing inline-add pattern.
- `src/panel-contract.ts` — route constants and request/response payload types;
  `src/panel.ts` — handlers over the store functions.
- Docs: `docs/PANEL.md` (new routes and interactions, one entry preserved),
  `CHANGELOG.md`.

**Tests and acceptance.**

1. Route tests: a valid decision changes the item's status; a missing
   `confirm: true` is rejected; `forever: true` hard-suppresses and the
   fingerprint is not re-proposed; a soft discard leaves the item re-proposable;
   an unknown id is 404; an already-decided item is refused rather than
   silently overwritten.
2. Parity: deciding through the route produces the same store state as the
   `journal_review` tool path (asserted against the same fixture).
3. Attach/detach round-trips and survives a reload of the insights payload;
   detaching does not delete the day's activities.
4. Client: new labels render in EN and ZH, the disabled/loading state is
   covered by the existing format/client tests, and the panel still registers
   one entry with one button and one tab (existing assertions).
5. The exact route-set assertion grows by exactly the three new POST paths.
6. `npm test`, typecheck, `check:package`, and the client bundle test green.

**Dependencies and owner decisions.** D6: whether the panel also gets a
suppression-management surface (clearing a hard suppression) or stays agent-only
for now. Safe default: agent-only in 0.7.x; the panel only decides items.

**Risks and rollback.** The danger is a destructive UI without a confirm step;
hard suppression is the secondary action with an explicit confirm, and no panel
path deletes rows. Duplicated decision logic would drift from the tool, so the
route is a thin wrapper and a parity test holds it. Rollback: revert the tag;
the routes are additive and no schema changes, so a downgrade only loses the
buttons.

### 0.7.4 — The day closes itself

**Theme and motivation.** Native port Phase 3. Once analysis exists, the 04:00
boundary should produce the standup, the reflection, the day's review
proposals, and the task sessions without an agent turn. This is the first patch
that writes the journal's opinionated layer (briefs, reflections, proposals) on
a timer, which is why it comes after the panel can decide (0.7.3) and after the
pipeline is observable (0.7.2).

**Deliverables.**

- `src/briefs/daily.ts` — the standup/daily brief from the day's `activities`
  through `ctx.llm.stream` (text only), written to `daily_standup_entries`
  (`source_id = 'native'`, idempotent per day) so the existing `standup` skill
  and the panel read it unchanged.
- `src/briefs/weekly.ts` — the seven-day rollup into the new `briefs` table
  (`kind = 'week'`, `period_key` = the Monday, unique).
- `src/automation/scheduler.ts` — host timers over an injectable clock: day
  close at `automation.dailyAt` (default `04:00`), weekly close on
  `automation.weeklyOn` (default Monday), catch-up on start when
  `automation.catchUpOnStart` is true, bounded to the catch-up window (D4),
  `automation_runs` idempotency (`UNIQUE (job, day)`), bounded retries and a
  status the panel can show.
- `src/automation/insights.ts` — the day's insight pass: one reflection via
  `saveReflection`, up to three review proposals via `proposeReviewItem`
  (confidence ≥ 0.6, existing per-day cap and suppression honoured), task
  sessions from `scanTaskHistory` + `attachTaskSession` when confidence is high
  (otherwise a review item), and memory claims **only** through the existing
  kept-item promotion path unless D9 says otherwise. Every step is idempotent
  per day; a re-run is a no-op.
- `src/journal.ts` — migration **v9**: `automation_runs` and `briefs` (the
  `NATIVE_PORT.md` §4 shapes, at the corrected version numbers).
- `/dayflow-run-close` slash command for manual testing and catch-up.
- Panel: the existing status line grows a close-state segment ("day closes at
  04:00; last close day/status") — still one line in the insights view.
- Docs: `docs/NATIVE_PORT.md` Phase 3 landed scope, `docs/ARCHITECTURE.md`
  module table, `docs/CONFIGURATION.md` (the automation block is now used),
  `docs/PANEL.md`, `CHANGELOG.md`.

**Tests and acceptance.**

1. Closing a synthetic day with a scripted adapter produces exactly one standup
   entry, one day reflection, at most three review items (confidence and cap
   respected), and task sessions for the days the matcher explains; re-running
   the same day changes nothing.
2. A missed day catches up on the next start **within** the catch-up window;
   older days are marked `skipped` with a reason and never fabricated.
3. The weekly close on a Monday writes one `briefs` row for that period; running
   it twice is a no-op.
4. A failing text call records `automation_runs.status = 'failed'` with
   `attempts` and does not block the other jobs; `automation.enabled: false`
   runs nothing at all.
5. Suppression is honoured: a hard-suppressed item is not re-proposed by the
   automation pass; a low-confidence match becomes a review item instead of a
   session.
6. A mixed journal (imported rows + native rows) closes without touching the
   imported rows' ids or payloads.
7. Migration from a populated v8 fixture to v9 keeps every existing row and
   re-opening is a no-op.
8. `npm test`, typecheck, `check:package`, client bundle test green.

**Dependencies and owner decisions.** D3 (caps), D4 (catch-up window), D9
(whether automation may write memory claims directly). Safe defaults: last two
days catch-up, 3 proposals/day at ≥ 0.6, the master `automation.enabled` switch
(no per-job decision is needed for this patch), proposals-only memory.

**Risks and rollback.** The queue becoming noise is mitigated by the existing
cap, the confidence floor, soft/hard suppression, and a "nothing worth keeping
today is a success" outcome. A catch-up storm after a long shutdown is bounded
by D4 and by marking older days skipped rather than fabricating them. Cost is
bounded by the 0.7.2 ledger plus text-only jobs once a day. Rollback:
`automation.enabled: false` stops every job; v9 is additive; revert the tag.

### 0.7.5 — Lint on a schedule, digest in the week

**Theme and motivation.** The memory lint exists (read-only, four findings) but
only runs when an agent calls it, so the roadmap risk "the store only grows"
still stands. A weekly scheduled pass closes it, reusing the 0.7.4 scheduler
instead of building a second timer.

**Deliverables.**

- `src/journal.ts` — migration **v10** rebuilding `automation_runs` so its
  `job` CHECK accepts `'lint'`. SQLite cannot alter a CHECK in place, so the
  migration recreates the table inside one transaction, copies rows, and the
  test asserts row counts and that both the old and the new job values are
  accepted afterwards.
- `src/automation/lint.ts` — a scheduled wrapper over `lintMemoryClaims` that
  records an `automation_runs` row and turns findings into **proposals only**:
  deduplicated by the existing `reviewFingerprint`, at most one per claim per
  week, never an automatic supersede or forget.
- Scheduler wiring: the weekly pass runs after the weekly close on
  `automation.weeklyOn`; the weekly brief gains a short "memory health" line in
  its `payload_json` and body.
- Docs: `docs/CONFIGURATION.md` (what the weekly pass does and does not repair),
  `docs/NATIVE_PORT.md` §4 numbering sync, `docs/ROADMAP.md` remain line,
  `CHANGELOG.md`.

**Tests and acceptance.**

1. A fixture with a contradiction and an aged claim produces at most one review
   item per claim for the week; the second run of the same week is a no-op.
2. Findings never mutate claims: the claim rows are byte-identical before and
   after the pass, and no claim gains `superseded_by`.
3. An unsuppressed finding can be proposed again on a later week.
4. The digest appears once in the weekly brief, and a week with no findings says
   "nothing to report" rather than nothing.
5. Migration v9 → v10 keeps every automation row and accepts `'lint'`.
6. `npm test`, typecheck, `check:package` green.

**Dependencies and owner decisions.** D8: proposals plus digest (safe default)
or digest only. Digest-only drops the proposal path but still needs the same
`'lint'` job value and so the same v10 rebuild.

**Risks and rollback.** A table rebuild is the one genuinely delicate step in
the line: one transaction, a populated v9 fixture, row-count and CHECK
assertions, and no data rewriting. Findings as noise is bounded by the weekly
cadence, dedupe and suppression. Rollback: `automation.enabled: false` stops the
pass; v10 is forward-only (R8).

### 0.7.6 — Release and compatibility close

**Theme and motivation.** Close the line honestly: every 0.7.x change documented
and released, the publication decision taken by the owner, and the Phase 4
cutover rehearsed without flipping any default.

**Deliverables.**

- GitHub Releases: `npm run release -- patch` already creates them; verify
  `v0.7.1`–`v0.7.6` each have a release whose notes are the matching CHANGELOG
  section, and create by hand any that were cut with `--no-release`.
- npm: a publication checklist, not a publication. `npm pack --dry-run` and
  `check-package.mjs` already gate the file list; confirm the registry name is
  still free, that `docs/` (including this plan) ships in the tarball, and that
  the tag/version guard in `ci.yml` protects the tag. `npm publish` happens only
  under D7 authorization; otherwise the README stays "tagged here, not yet on
  the npm registry".
- Docs reconciliation: README/README.zh status line, `docs/ROADMAP.md` status
  and phase remain lines, `docs/NATIVE_PORT.md` phase statuses and the v8/v9/v10
  numbering, `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `docs/PANEL.md`,
  `docs/TOOLS.md` if the surface changed, and this file's status column updated
  to what actually shipped.
- Phase 4 cutover **rehearsal**: a fresh-profile dry run (capture on, consent
  `local` or `none`, analysis on, one real day, next-morning close) with a
  written pass/fail checklist covering permission, frames, cards, brief,
  reflection, queue, and no data loss across a restart. The default `source:
  owned` flip is **not** part of this patch; it is 0.8.0 (native preview), with
  1.0.0 after a real week of capture per `NATIVE_PORT.md` §8 Phase 4.
- CI: both Node legs green, `check:package` still covering the new modules, and
  the new test files in the same run (no second job unless the runtime needs
  one).
- Compatibility statement: README/ARCHITECTURE state the DSH peer cohort and
  any host peer added for image admission (0.7.1's `dsh-attachment`, if taken).

**Acceptance.**

1. Six tags exist, each with notes matching its CHANGELOG section; the tag
   version guard passes on each.
2. `npm view dsh-plugin-dayflow version` either shows the authorized version or
   the README explicitly says the line is tagged and unpublished — no
   ambiguity.
3. The cutover rehearsal checklist is complete with dates and observed frame,
   card, and queue counts; any data loss is a blocking finding for 0.8.0.
4. A config-defaults audit diff against 0.7.0 shows every change was either an
   explicit owner decision or is inert by default.
5. CI green on both Node legs and `check:package` green.

**Dependencies and owner decisions.** D7 (publish or stay tagged), D1 (whether
cloud consent is exercised in the rehearsal). Safe default: no publish, local
consent only in the rehearsal.

**Risks and rollback.** Publishing is hard to undo, so it is gated on an
explicit owner decision, a dry-run tarball review, and a token; everything else
in the line is reversible by config or a revert. Docs drift is the second risk,
mitigated by the per-patch docs rule (R6) and this reconciliation pass.

## 4. Definition of Done (every patch)

Before a patch is tagged, all of these hold. They are the same for all six
patches; a patch's section adds only its own assertions.

- [ ] `npm test` is green: the 319 existing cases still pass and the patch's new
      cases are in the suite; the build and typecheck are part of `npm test`
      (`npm run typecheck` separately if a build step skipped it).
- [ ] `npm run check:package` is green: the packed file list is what a profile
      installs, and `docs/` includes the updated docs.
- [ ] One integration point: the feature is mounted once from `src/index.ts`;
      every new config key is validated at load time and has a config test.
- [ ] The `docs/*.md` files named in the patch are updated in the same commit;
      README/README.zh only when the user-visible status line changes.
- [ ] `CHANGELOG.md` has the entry under `[Unreleased]` before the release, and
      the bump moves it into the patch's own section.
- [ ] `npm run release -- patch` produced the `v0.7.x` commit, tag, push, and
      GitHub Release; CI is green on the tag (macOS 15, Node 22
      `--experimental-sqlite` + Node 24).
- [ ] No read-path regression: the read suite passes against both the Dayflow
      fixture and the owned fixture; a patch that writes native rows has a
      mixed imported/native fixture test.
- [ ] No default behaviour change without an owner decision; the config-defaults
      diff is reviewed as part of the patch.
- [ ] Rollback is stated: the config switch that disables the feature, and
      whether the schema moved (R8).
- [ ] `docs/ROADMAP.md` remain lines change only for work that actually landed.
- [ ] The patch's own section here is updated if reality diverged (the plan is
      the record; silently diverging is how a plan becomes fiction).

## 5. Sequencing rationale

The draft order this plan was asked to evaluate was 0.7.1 analysis foundation,
0.7.2 analysis observability, 0.7.3 Phase 3 automation, 0.7.4 interactive panel,
0.7.5 lint schedule, 0.7.6 release close. This plan keeps 0.7.1–0.7.2, **swaps
0.7.3 and 0.7.4**, and keeps 0.7.5–0.7.6.

1. **The panel decides before automation proposes.** Phase 3 starts writing
   review items every day at 04:00. The roadmap's own Risk 7 is that the queue
   becomes a chore and the user stops reading it; if the only way to clear an
   item is an agent turn, the first week of automation makes the backlog. The
   panel interaction has no schema or model dependency, so it is a cheap patch
   that protects the expensive one.
2. **Phase 2 stays two adjacent patches.** 0.7.1 is verifiable entirely with a
   fake adapter (no network, no consent), and 0.7.2 is the first patch that can
   run against a real provider. Keeping them adjacent and ordered means the
   risky, novel diff is separately tagged and separately revertable, without
   interleaving a second workstream into the same modules.
3. **Lint after automation.** The lint pass reuses the 0.7.4 scheduler and
   `automation_runs`; building it earlier would mean a second timer and a second
   bookkeeping path, which this line exists to avoid.
4. **Release close last, and it flips nothing.** A patch line whose last patch
   changed the default `source` would not be a patch line. The default flip is
   the Phase 4 cutover, planned as 0.8.0 (native preview), with 1.0.0 after a
   real week on a real machine.
5. **No hotfix patch first.** 0.7.0's suite and CI are green, and nothing in the
   repository records a defect to fix before the line starts; a 0.7.0.x tag would
   spend a release without moving the roadmap.

## 6. Owner decisions and safe defaults

Every row has a default that ships without an answer. The wiring patch is named
because a decision can be taken at that point instead of before it.

| Id | Decision | Why it matters | Safe default if unanswered | Gates |
| --- | --- | --- | --- | --- |
| D1 | **Analysis destination**: `none`, `local`, or `cloud` | Whether screen frames may leave the machine, and whose model reads them | `none`: capture and the analysis code ship, no frame leaves the machine, the panel says why. Dogfooding a real day waits for the answer | 0.7.1 (code), 0.7.2 (real runs) |
| D2 | **Provider and model** for analysis | Cost, latency, and which vendor sees the frames | No implicit host default: `analysis.provider` + `analysis.model` must be set explicitly; empty means "not configured" and jobs are `skipped`. Rationale: `ctx.llm.stream` requires both fields, and the host's default-model service is not part of the pinned peer set — confirm or deny at 0.7.1 | 0.7.1 |
| D3 | **Daily budget**: calls and tokens | A runaway loop is a bill, not a bug | 120 calls / 200k tokens per day, shown in status, enforced from the jobs ledger; caps stop analysis for the day | 0.7.2 |
| D4 | **Catch-up window** after the machine was off | Closing ten missed days at once is noise and cost | At most the last two days; older days are marked `skipped`, never fabricated | 0.7.4 |
| D5 | **Frame retention** after analysis | Debuggability versus leaving screenshots on disk | `keepFramesDays: 0` deletes a frame after its successful analysis; 1–7 days is the debugging alternative | 0.7.1 |
| D6 | **Suppression management surface** | A hard-suppressed idea must be clearable somewhere | Agent-only in 0.7.x (`journal_review` unsuppress); a panel list is a later patch | 0.7.3 |
| D7 | **npm publication** | Publishing is hard to undo | Stay "tagged, not on the npm registry" (the README already says so); publish only on explicit authorization with a reviewed `npm pack` | 0.7.6 |
| D8 | **Lint finding destination** | A finding is only useful if it is seen, and only trustworthy if it is not auto-"fixed" | Weekly digest plus at most one proposal per claim per week; no automatic supersede or forget | 0.7.5 |
| D9 | **Automatic memory writes** | The product rule is "the agent may notice, only the user may decide" | Automation proposes into the queue; claims are written only through the existing kept-item promotion path | 0.7.4 |

Two constraints that are not decisions: the privacy limitation copy from
Roadmap 3.6 (marking an app hides its window, not the content of a tab) must
exist before cloud consent (D1 = `cloud`) is ever enabled; and `capture.pauseApps`
already skips capture of those apps entirely, which is stronger than redaction.
Phase 3.6's `privacy_apps` redaction list is therefore **not** scheduled in this
line — if D1 chooses cloud, it becomes a candidate for 0.7.2, not a silent
omission.

## 7. How to run one patch

1. Branch `patch/0.7.N-<theme>` from the tag of the previous patch.
2. Write the failing tests first, on the fake-adapter seam; they are the
   acceptance list from that patch's section.
3. Implement; keep the integration point single (`src/index.ts`) and the config
   keys minimal.
4. Update the patch's docs and the CHANGELOG `[Unreleased]` entry.
5. Run `npm test`, `npm run typecheck`, `npm run check:package`; review the
   config-defaults diff.
6. Cut the release with `npm run release -- patch`, which runs the suite again,
   moves the CHANGELOG entry, commits, tags, pushes, and creates the GitHub
   Release.
7. Update the status column here and, only for work that landed, the roadmap's
   remain lines.

If a patch discovers its theme cannot ship default-safe, it stops at step 3 and
the blocking decision moves into §6 — the patch does not ship with a default
that changes behaviour without the owner's answer.
