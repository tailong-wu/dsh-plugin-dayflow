# Patch plan: the 0.7.x line

> **Status:** revised 2026-11-27 against `v0.7.5` (annotated tag `v0.7.5`,
> commit `f117cdc`); `main` is at `81af8e3`, the commit that reconciled this
> plan and the roadmap with the tagged tree. **0.7.1–0.7.5 have landed**, so
> their sections record what actually shipped, and 0.7.5's tagged tree is
> measured at the end of its section; **0.7.6 is in progress** and is the
> remaining patch (release and compatibility close), finalised below as an
> executable checklist (§A–§F) with a boxed acceptance list. Six patches,
> 0.7.1–0.7.6: each one theme, one integration point, one tag. This is a
> decision-level plan, not a commitment of dates. Every patch below is
> shippable under the safe default of the decisions in
> [§6](#6-owner-decisions-and-safe-defaults), so no patch waits on an answer.
> The revision before this one was written against `v0.7.5` and reconciled the
> line with its tagged tree; the one before that against `v0.7.4` (tag
> `v0.7.4`, commit `1375717`). This revision changes no landed fact: it adds
> the verified 0.7.5 implementation anchors and turns 0.7.6 into a checklist an
> implementer can run top to bottom.
>
> Related documents: [`ROADMAP.md`](ROADMAP.md) carries the phases and what
> remains; [`NATIVE_PORT.md`](NATIVE_PORT.md) is the capture → analysis →
> briefs design this plan is the execution order for; [`CHANGELOG.md`](../CHANGELOG.md)
> is the record of what actually shipped.

## 1. Starting point, measured

Facts checked against the repository and the registry on 2026-11-27, on the
`v0.7.5` tree at `81af8e3`; `npm test` was re-run for this revision (493 pass,
0 fail, 0 skipped, 0 todo), and `npm run typecheck` / `npm run check:package`
are green. They are the baseline every patch below assumes; a patch that
invalidates one updates this table.

| Fact | Value | Checked at |
| --- | --- | --- |
| Baseline | `0.7.0`, annotated tag `v0.7.0` (commit `45a7e42`), the phase baseline this plan was first written against | `package.json`, `git tag` |
| Current head | `0.7.5`, annotated tag `v0.7.5` (commit `f117cdc`); `main` is `81af8e3`, the 0.7.5 docs reconciliation. **Not** on the npm registry; **no** GitHub Release for any 0.7.x tag (the latest release is `v0.5.1`). **0.7.6, the release close, is in progress** | `package.json`, `git tag`, `npm view dsh-plugin-dayflow version` → 404, `gh release list` → latest release is `v0.5.1` |
| Tests | 494 cases, green on the `v0.7.6` tree (`npm test`: 494 pass, 0 fail, 0 skipped, 0 todo; 493 at `v0.7.5`, 477 at `v0.7.4`, 425 at `v0.7.3`, 408 at `v0.7.2`, 384 at `v0.7.1`); CI runs them on macOS 15 with Node 22 (`--experimental-sqlite`) and Node 24 | `tests/*.test.ts`, `.github/workflows/ci.yml` |
| Tools | 23 registered by default (17 with `edits: false`), plus `dayflow_install_dayflow` behind `allowInstall: false`; 0.7.3–0.7.5 added no tool | `src/index.ts`, `src/tools/`, `tests/plugin.test.ts` |
| Skills | 8; 0.7.3–0.7.5 added none | `skills/`, `tests/plugin.test.ts` |
| Panel | 18 exact host Fetch routes (9 GET + 9 POST), one UI entry (one header button, one panel tab); 0.7.4 added exactly the automation GET (17 → 18) and 0.7.5 added no route, so it stays 18 | `src/panel-contract.ts`, `tests/panel.test.ts` |
| Owned schema | **v10**, landed in 0.7.5 — rebuild `automation_runs` so `job` also accepts `'lint'`, plus an additive `briefs.payload_json` column for the weekly digest; v9 (`automation_runs` + `briefs`) was 0.7.4's, v8 (`analysis_jobs`) 0.7.1's, v7 the 0.7.0 baseline, and 0.7.2/0.7.3 made **no** schema change | `src/journal.ts` → `JOURNAL_SCHEMA_VERSION` |
| Native port | Phase 0 (provider + Swift helper) and Phase 1 (capture engine) landed in 0.7.0, both default-off; Phase 2's foundation landed in 0.7.1 and its **visibility** in 0.7.2 (worker/timer, text-only host `ctx.llm` adapter, status route, panel analysis line, `/dayflow-analyze`, budget ledger), so Phase 2 is complete as of `v0.7.2`; 0.7.3 added no native-port work (interactive panel only); **Phase 3 landed in 0.7.4** (briefs, insight pass, scheduler, schema v9), so the text-only automation slice is complete; **the Phase 4 lint remainder landed in 0.7.5** (scheduled weekly memory lint + digest, schema v10), closing the ingest/query/lint loop on this line; 0.7.6 is the release close and cutover rehearsal and flips no default, still with no image; the Phase 4 `source: owned` default flip is 0.8.0 | `src/capture/`, `src/analyse/`, `src/briefs/`, `src/automation/`, `docs/NATIVE_PORT.md` |
| Release tool | `npm run release -- patch` bumps, runs the suite, commits (`chore(release): v<version>`), tags, pushes, and creates the GitHub Release from the CHANGELOG section; it does **not** publish to npm. The 0.7.x release commits read `chore(release): 0.7.N`, not this script's `chore(release): v<version>` form — so the five tags were not cut by the current release tool and have no GitHub Release; 0.7.6 must backfill all five by hand before cutting its own tag with the script | `scripts/release.mjs`, `git log --grep='chore(release)'`, `gh release list` |
| Host cohort | DSH `0.2.1-rc.2` dev dependencies, `^0.2.0-rc.2` peers; `@deepseek-ai/dsh-llm` is declared and is now actually called in 0.7.2 through `ctx.llm` (a structural `HostLlmLike` seam, so CI still never reaches a model); `@deepseek-ai/dsh-attachment` is **not** a dependency (the line stays text-only) | `package.json`, `npm ls`, `src/analyse/` |

**Landed in 0.7.0, therefore not in this plan:** the four Phase 3 read tools and
their panel surfaces, the review queue, long tasks, dated memory, the budgeted
memory context, reflections, the read-only lint, the Journal insights view, the
quick-capture slash commands, the importer and the owned read backend, native
capture Phase 0/1, and the 13 panel routes.

**Landed in 0.7.1:** the native port Phase 2 foundation — five `src/analyse/`
modules (`jobs`, `consent`, `prompt`, `llm`, `pipeline`), owned schema v8
`analysis_jobs`, the pure consent gate (including `analysis.localProviders`),
and the idempotent pipeline: window grouping, strict JSON validation,
sessionisation, retries, the per-day call cap, and frame release at
`keepFramesDays: 0`. It is verified entirely with a fake adapter; the model
contract is **text-only** (frontmost app, window title, frame hash) and there is
no worker, timer, status route, panel line, command, or real provider call, so a
default profile analyses nothing and no frame leaves the machine. Its `skipped`
jobs are terminal — enabling consent later does not replay them; the decision on
that is in the 0.7.2 section below, and it was re-triaged in the 0.7.3 window
below.

**Landed in 0.7.2:** the analysis runtime made visible and operable — the
`src/analyse/worker.ts` timer (one run in flight, injectable timer seam,
backoff, idempotent `start()`/`stop()`), `src/analyse/host.ts` (the text-only
adapter over `ctx.llm.stream`, sending a content-block array and recording the
provider's usage), `src/analyse/status.ts` and
`GET /api/dayflow/analysis/status`, one read-only analysis line under the
capture line in the insights view (with the privacy disclosure),
`/dayflow-analyze` (the fourth slash command), and `analysis.intervalMinutes`
(1–60, default 5). It
makes **no schema change** (v8 stays), adds **no host peer** (the already
declared `llm` peer is now used through the worker), and keeps the 0.7.1
text-only contract. The worker mounts only when `capture.enabled` and
`analysis.enabled` are both true and the host `llm` service is present; a
default profile still captures and analyses nothing. `skipped` analysis jobs
stay terminal — no window skipped before consent is replayed, and no catch-up
policy landed in this patch.

**Landed in 0.7.3:** the interactive insights panel — three POST routes
(`/api/dayflow/review`, `/api/dayflow/tasks/attach`, `/api/dayflow/tasks/detach`)
and `src/review-actions.ts`, the decision composer the `journal_review` tool now
calls instead of inlining the same rule, so a panel click and a tool call write
identical state. `PanelTaskSummary` gained one additive optional `sessions`
field; each waiting review item carries its kind's decision row, with "Don't
suggest again" as a deliberate inline confirm for the hard suppression, and each
linked task day has an Unlink. It makes **no** schema change (v8), calls **no**
model, adds no host peer and no dependency, and the single UI entry is unchanged.
The tagged tree measures 425 green tests (408 at 0.7.2 — seventeen new cases)
and 17 panel routes (8 GET + 9 POST; 14 at 0.7.2).

**Landed in 0.7.4:** the text-only automation slice — schema v9
(`automation_runs` + `briefs`), the daily close (standup into
`daily_standup_entries`), the daily insight pass (one reflection, at most three
model proposals at confidence ≥ 0.6, weak task-session guesses proposed,
high-confidence sessions attached), the weekly brief (one `briefs` row for the
just-ended week), and the scheduler at `automation.dailyAt`/`weeklyOn` with
`automation.catchUpDays` (1–30, default 2). It adds one GET
(`/api/dayflow/automation/status`, 17 → 18 routes: 9 GET + 9 POST), one close
line under the analysis line, and the fifth slash command
(`/dayflow-run-close`); no tool, no skill, no host peer, no image, and no token
gate. The scheduler mounts only inside the existing
capture + analysis + host-`llm` block (and `automation.enabled`), so a default
profile runs no close. The tagged tree measures **477** green tests and **18**
routes. 0.7.4's section records the exact landed shape and every deviation from
the finalised plan text.

**Landed in 0.7.5:** the scheduled weekly memory lint and its digest — schema
**v10** (rebuild `automation_runs` so `job` also accepts `'lint'`, plus an
additive `briefs.payload_json`), the read-only lint run once per week for the
just-ended Monday as part of the weekly close, findings turned into at most one
`improvement` proposal per subject (never more than three per pass) through the
existing review queue rules, and the weekly brief's single `Memory health: …`
paragraph with its `payload_json.memory_health`. It adds **no** route, command,
tool, skill, configuration key, host peer, dependency, or UI entry, and it never
writes a claim. The tagged tree measures **493** green tests (477 at 0.7.4) and
stays at **18** routes and **5** commands. Its section below records the landed
shape and the corrections against the draft.

**Not landed, and what this plan is:** the release closure only (0.7.6, in
progress: GitHub Releases for `v0.7.1`–`v0.7.5` backfilled plus `v0.7.6` cut by
the release tool, the npm decision with no publication by default, docs
reconciliation, the Phase 4 cutover rehearsal, the config-defaults audit, and
the release gates). Native port Phase 2 is complete as of 0.7.2, 0.7.3 landed
the interactive panel, 0.7.4 landed the automation, and 0.7.5 completed the
memory maintenance loop with the lint. The three analysis-ledger follow-ups
0.7.2 deliberately left behind stay out of 0.7.4 and 0.7.5 and are **0.8.0
candidates by default** — the owner has not answered the decision, and 0.7.5
kept a single theme. 0.7.6 changes no plugin behaviour and no default: it
closes the line, it does not open the next one.

**Deliberately not in 0.7.x:** the Phase 4 default cutover (0.8.0 material;
0.7.6 only rehearses it, flips nothing), the month/week panel goal and rating
surfaces, editing tools for the owned journal, the `dsh dayflow import` CLI
(only the tool exists), embeddings, the `review.cards` switch (the plugin has no
card stack, so it has no surface),
image admission (pixels need a host attachment peer and a vision contract;
0.8.0 candidate), automatic catch-up for skipped analysis windows, the token cap
as a gate, and the 04:00 day tail (all three re-triaged in the 0.7.3 and 0.7.4
windows and **not** in 0.7.4; by default they are 0.8.0 candidates, because
0.7.5 kept a single theme — see [§0.7.5](#075--lint-on-a-schedule-digest-in-the-week)),
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
migration with a UI redesign; 0.7.5 deliberately rebuilds one table (and adds one
additive column) on its own.

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
| 0.7.1 | **landed** — Analysis foundation: frames become `activities` rows behind a fake adapter | Native port Phase 2 | — | D1, D2, D5 | Medium |
| 0.7.2 | **landed** — Analysis visible: worker timer, text-only host adapter, status route and panel line, budget ledger, manual command; no schema change | Native port Phase 2 | 0.7.1 | D1, D3 | Medium |
| 0.7.3 | **landed** — Interactive insights: decide review items, attach/detach task sessions in the panel; three POST routes, one shared decision module, no schema or model dependency | Phase 3.5 / 3.7 remain | — (built against 0.7.2 tree) | D6 | Low |
| 0.7.4 | **landed** — The day closes itself: schema v9 (`automation_runs` + `briefs`), daily/weekly briefs, the insight pass, a scheduler with `automation.catchUpDays` (1–30, default 2), one GET route (18 total) and the fifth slash command; text-only, no image and no token gate | Native port Phase 3 | 0.7.2, 0.7.3 | D3, D4, D9 | High |
| 0.7.5 | **landed** — Scheduled memory lint with the weekly digest: schema v10 (`automation_runs` accepts `lint`, plus `briefs.payload_json`), a weekly lint pass that proposes at most one item per claim per week and never writes a claim, and a memory-health paragraph in the weekly brief; no route, no command, no new surface. The deferred analysis-ledger follow-ups stay 0.8.0 candidates (owner unanswered; single-theme patch) | Phase 4 lint remainder | 0.7.4 | D8 | Low–Medium |
| 0.7.6 | **landed** — Release and compatibility close: six 0.7.x tags each with a GitHub Release (`v0.7.1`–`v0.7.5` backfilled by hand from the corrected CHANGELOG, `v0.7.6` cut by the release tool), the npm state settled without publishing by default (D7 unanswered), docs reconciliation including the two "weekly reflection" overstatements and the v8/v9/v10 numbering, `docs/CUTOVER_REHEARSAL.md` plus `npm run rehearsal` (a repo-side fixture dry run with its test, neither shipped), the 0.7.0→0.7.5 config-defaults audit, and both CI legs + `check:package` green; no plugin-source, schema, route, command, config, or default change | Release closure / Phase 4 rehearsal | 0.7.1–0.7.5 | D1, D7 | Low |

Order rationale: see [§5](#5-sequencing-rationale). Nothing in the table changes
the plugin's default behaviour; each new path is off by default or requires
consent, and that is part of every patch's acceptance. This revision records
**0.7.5 as landed** and measures the `v0.7.5` tree: schema v10, the weekly
memory lint and its digest, 493 tests, 18 routes, 5 commands — with **no** image,
**no** token gate, and **no** replay of analysis-ledger skips. 0.7.5 kept one
theme (R1): the read-only lint became a weekly advisory pass whose findings are
proposals (at most one per claim per week, never an automatic supersede or
forget) and whose digest is written into the weekly brief. **0.7.6 is in progress and is
the only patch left**: release and compatibility close, finalised as an
executable checklist in its section below. The three analysis-ledger
follow-ups 0.7.2 left behind remain outside 0.7.4 and, by default, outside the
0.7.x line: they are 0.8.0 candidates until the owner answers.

### 0.7.1 — Analysis foundation: frames become rows

**Status: landed in 0.7.1 (development line).** The schema, analyse modules,
consent gate, idempotent pipeline, and fake-adapter tests are in the tree; the
0.7.1 docs commit records the numbering fix and the landed scope.

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
10. `npm test` (the whole suite, 384 cases after this patch), `npm run typecheck`, `check:package` green.

**Dependencies and owner decisions.** D1 (where analysis may go), D2
(provider/model), D5 (retention) matter only for real runs; the fake adapter
lets the patch ship with `consent: none` as the working default. Image
admission needs `@deepseek-ai/dsh-attachment` and an `attachments` service
inject; that package is **not** currently a dependency, so this patch adds it
pinned to the same host cohort and re-runs typecheck. That fallback is what
shipped: the patch uses a text-only contract (frontmost app, window title, frame
hash), no peer was added, and vision admission moved out of 0.7.1 — it is **not**
on the 0.7.x line (0.8.0 candidate, see below) — with the JSON contract, consent
gate, schema and tests unchanged.

**Risks and rollback.** Prompt injection from screen content is mitigated by the
JSON-only contract, the analyser having no tools, and the hostile-title test.
Wrong window grouping is mitigated by grouping being pure plus a golden fixture.
The real risk is the consent gate: a bug there means frames leave the machine, so
the gate is a pure function tested for every blocked reason, and the adapter is
only reachable through it. Rollback: revert the tag; a profile that ran 0.7.1
keeps v8, and `analysis.enabled: false` turns the feature off without a
downgrade (R8).

**Implementation deviation (landed).** Five details differ from, or were not
named in, the plan text above. The shipped behaviour is the specification 0.7.2
builds on.

- **No image admission.** The patch did **not** add
  `@deepseek-ai/dsh-attachment`: it ships the text-only contract (frontmost app,
  window title, frame hash) with no `attachments` inject, so no host peer changed
  and the JSON contract, consent gate, schema, and tests are exactly as above.
  Image admission is **not** in 0.7.2 either: the text-only contract holds for
  the whole 0.7.x line, and pixels are a 0.8.0 candidate.
- **`analysis.localProviders`.** The plan text did not name this key (default
  `[]`): it is the explicit allowlist the `local` consent checks, so a provider
  is never trusted as local by name alone.
- **Deterministic window keys.** Activities are keyed by the window key
  (`analysis:<job key>`, per-frame keys for observations) rather than a content
  hash; replaying the same frames still produces the same keys and is a no-op.
- **`skipped` is terminal.** The pipeline never restarts a `skipped` row:
  consent, budget, and `analyser-unset` skips all end that window permanently,
  and a `running` row left by a crash is skipped as stale, with recovery
  explicitly handed to 0.7.2's worker. Consequently, enabling consent later does
  not re-analyse earlier windows and raising the call cap does not revive the
  day's budget skips. 0.7.2's decision on this is stated in its own section
  below, and it was re-triaged in the 0.7.3 window below.
- **The token budget is recorded, not yet enforced.** `analysis_jobs` carries
  `input_tokens`/`output_tokens` and `analysisTokenTotalsForDay` reads them, but
  only `maxCallsPerDay` is a gate in 0.7.1; 0.7.2 makes the ledger visible and
  leaves the token cap reported-only (re-triaged in the 0.7.3 window: still
  reported-only there; a post-call gate stays a 0.8.0 candidate and 0.7.5 kept
  a single theme). The
  `@deepseek-ai/dsh-llm` peer is already declared but no code
  calls `ctx.llm` yet; 0.7.2 adds the adapter.

The suite is 384 tests green on the `v0.7.1` tree (growing to 408 on the `v0.7.2`
tree with the 24 analysis-visibility tests), and `npm run typecheck` /
`npm run check:package` are green; the 0.7.1 CHANGELOG section is the record of
what shipped.

### 0.7.2 — Analysis visible: worker, status, budget

**Status: landed in `v0.7.2`, 2026-11-27 (commit `7a84ccd`; revised after
0.7.1).** The scope is the one below: **text-only, no schema change, no new
host peer**, one new config key, one new GET route, and — decided — **no re-run
of 0.7.1's skipped jobs** (see the decision near the end of this section). The
tagged tree measures 408 green tests (384 at 0.7.1), 14 panel routes (8 GET + 6
POST), owned schema v8 unchanged, and it is on neither npm nor a GitHub Release
(`npm view dsh-plugin-dayflow version` → 404, `gh release view v0.7.2` → not
found). The implementation's deviations from the plan text are listed at the end
of the deliverables, before the skipped-jobs decision.

**Theme and motivation.** 0.7.1 can be verified only by tests: nothing runs on a
schedule, nothing shows state, and a real run still needs a hand-written caller.
This patch makes the pipeline operable and observable without changing what
leaves the machine: with the shipped defaults (`consent: none`, capture off) it
runs nothing and says why.

**Deliverables.**

- `src/analyse/worker.ts` — the scheduled runner, mirroring the capture engine's
  lifecycle instead of inventing a second one: an injectable
  `{ setTimeout, clearTimeout }` timer seam, one run in flight at a time (the
  next wait is scheduled only after the previous run settles), `start()`
  idempotent (a second `start()` adds no timer), and `stop()` invalidating an
  in-flight schedule with a generation counter so a stopped worker cannot fire.
  `start()` runs one tick immediately and then waits
  `analysis.intervalMinutes`; a run calls
  `AnalysisPipeline.run({ day: <current day>, maxWindows })` with a small
  `maxWindows` constant so one run cannot occupy the plugin for a whole day. A
  failed run is recorded on the worker status (`lastError`) and the next wait
  doubles up to a cap (5); a success restores the interval. `worker.status()`
  reports `{ running, intervalMinutes, lastRunAt?, lastOutcome?, lastError? }`.
  A timer tick never throws; `runOnce()` (used by the command) still surfaces
  its error to its caller.
- `src/analyse/host.ts` — the production analyser: `createHostAnalyser(llm,
  { maxTokens? })` returns the existing `AnalysisLlmStream` seam over the host
  `llm` service. One call maps `{ provider, model, system, user, signal }` to
  `ctx.llm.stream({ provider, model, system, messages: [{ role: 'user',
  content: [{ type: 'text', text: user }] }], signal })`, concatenates
  `text-delta` chunks, ignores the other chunk types, and takes
  `inputTokens`/`outputTokens` from the last `usage` chunk (0 when absent). The
  host requires a **content block array** (`UserMessage.content` is
  `readonly ContentBlock[]`), so the adapter must send a text block, not a bare
  string; the module types the host as a structural `HostLlmLike`, so tests pass
  a scripted async iterable and CI still never calls a model (R4). **No image
  content part is built**, no `attachments` service is injected, and
  `@deepseek-ai/dsh-attachment` is **not** added: 0.7.2 keeps the 0.7.1
  text-only contract (frontmost app, window title, frame hash). Pixels are a
  0.8.0 candidate, not a 0.7.x deliverable.
- `src/index.ts` — one mount point. When `capture.enabled` and
  `analysis.enabled` are both true, the worker is created inside
  `ctx.inject(['llm'], (scoped) => …)` with the analyser built from
  `scoped.llm`, and started inside `scoped.effect(() => { worker.start(); return
  () => worker.stop(); }, 'dayflow analysis: worker')`. On a host without the
  `llm` service the worker is **not** started (the route reports
  `worker: 'stopped'`) rather than running without an analyser and writing
  terminal `analyser-unset` skips. The consent gate is still evaluated per run
  inside the pipeline; the worker never decides whether analysis is allowed.
- `src/config.ts` — one new key, `analysis.intervalMinutes` (integer, 1–60,
  default 5), validated in `AnalysisSchema`, resolved into
  `ResolvedAnalysisConfig`, and covered by the config test and the
  `tests/capture-state.test.ts` resolved-defaults assertion; no other new keys
  and no default change. (`capture.intervalSeconds` is a different loop and is
  untouched.)
- `src/analyse/status.ts` — the read-only status builder
  `buildAnalysisStatus({ journalPath, config, paused, worker?, now? })`. The
  ledger is `analysis_jobs`, not a second counter: `queued`/`running`/
  `completed`/`failed`/`skipped` are today's row counts (`complete` is
  `completed` on the wire), `callsToday` = today's rows with `attempts > 0` (a
  skipped row never started, so it is not a call), `tokensToday` = the summed
  `input_tokens`/`output_tokens`, `lastJobAt` = the most recent job activity
  today as epoch milliseconds (the later of the newest `updated_at` and the
  newest `window_end_ts`, since the two describe different kinds of activity). A missing journal answers zeros **without
  creating the file**, and an unreadable journal degrades to zeros rather than
  failing the panel line. The switches come from the resolved config and
  `reason` from the consent gate, so the line and the worker cannot disagree
  about why analysis is idle.
- `GET /api/dayflow/analysis/status` — read-only, exactly this route, returning
  `{ analysis: { enabled, consent, intervalMinutes, worker: 'running' |
  'stopped', queued, running, completed, failed, skipped, callsToday,
  maxCallsPerDay, tokensToday: { input, output }, dailyTokenBudget, lastJobAt?,
  reason? } }`. `enabled` is `analysis.enabled && capture.enabled` (nothing can
  run unless both are on) and `reason` is the single typed consent-gate reason
  the line should show (`analysis-disabled`, `capture-disabled`, `paused`,
  `consent:none`, `consent:provider-not-local`, `provider-unset`,
  `model-unset`), absent when analysis is allowed. Like the capture status
  route, a missing journal answers zeros and **does not create the file**
  (asserted with a directory listing). There is no POST route: no new button.
- Panel — one analysis line directly under the existing capture line in the
  insights view: analysis off (or the status read failed), waiting for consent
  with the specific reason (including needs-provider, needs-model and
  provider-not-local), analysing (green, with today's job counts), idle, worker
  stopped, the failed count when any, and the budget as a right-side summary
  (`calls/max calls · tokens/max tokens`) plus the last job time. The one-entry
  rule holds: no new tab, header button, settings page, or view; the exact
  route-set test grows by the one GET and the single-entry assertions stay
  unchanged. When `consent` is not `none`, the line adds one short EN/ZH
  disclosure of what actually leaves the machine (frontmost app, window title,
  and frame hash; no image) and, for `cloud`, the Roadmap 3.6 limitation in the
  plugin's own terms: `capture.pauseApps` stops that app's own capture, but a
  window title is still text, and the setting cannot tell what is inside a
  browser tab. Both locales get the keys; the client test's locale-parity rule
  covers them.
- `/dayflow-analyze` — one command in `src/commands.ts`, added to
  `DAYFLOW_COMMAND_NAMES` and registered through the existing
  `ctx.inject(['commands'])`. The commands module has no journal or model
  access, so `registerCommands` takes an optional
  `runAnalysis?: () => Promise<{ ok: boolean; text: string }>` supplied by
  `src/index.ts` (a mutable runner assigned once the worker exists); without it
  the handler returns an error result. The command runs one manual tick for the
  current Dayflow day through the worker's `runOnce()` and returns a short
  success summary (day, analysed/skipped/failed/activity counts) or
  `{ kind: 'error', text }` with the gate's reason. It never throws into the
  host, and when the day's windows were already skipped it says so and does
  **not** requeue them.
- Docs: `docs/PANEL.md` (the route and the line), `docs/CONFIGURATION.md` (the
  new key, what the ledger shows and what is not a hard gate yet, text-only),
  `docs/NATIVE_PORT.md` (Phase 2 status, and correct the "images stay text-only
  until 0.7.2" sentence: the contract is text-only for the whole 0.7.x line),
  `docs/ARCHITECTURE.md` (the worker, host-adapter and status modules),
  `docs/ROADMAP.md` remain lines, `CHANGELOG.md`.

**Implementation deviations (landed).** What the `v0.7.2` tree actually does,
where it differs from, or was not named in, the plan text above. The shipped
behaviour is the specification 0.7.3 builds on.

- **The host content type is a block array, not a string.** The host's user
  message content is `readonly ContentBlock[]`, so `host.ts` sends exactly one
  `{ type: 'text', text }` block and never an image block. The module types the
  host structurally (`HostLlmLike`), so tests drive a scripted async iterable
  and CI never reaches a model; no `attachments` service is injected and
  `@deepseek-ai/dsh-attachment` is still not a dependency.
- **The privacy disclosure is two locale keys, not one sentence.**
  `analysisPrivacy` states the text-only contract (frontmost app, window title,
  frame hash; never the image) and `analysisPrivacyCloud` adds the cloud-only
  sentence that the metadata leaves the Mac. The line shows them only when
  `consent` is not `none` (`cloud` shows both, `local` shows the first), in both
  EN and ZH, and the client locale-parity test covers them.
- **The budget status shape is a flat wire string.** The route reports
  `worker: 'running' | 'stopped'` plus the day's counts and the ledger; it does
  **not** expose the worker's `{ running, intervalMinutes, lastRunAt,
  lastOutcome, lastError }` object. `buildAnalysisStatus` takes the worker's
  `{ running }` as input, and `worker.status()` stays internal, so the wire
  contract is small and stable.
- **The token ledger is shown, not enforced.** `tokensToday` and
  `dailyTokenBudget` are honest numbers on the line and in the payload, but the
  only gate is still 0.7.1's `maxCallsPerDay`. A post-call token check did not
  land: it was re-triaged in the 0.7.3 window and is a 0.8.0 candidate (0.7.5
  kept a single theme).
- **The panel line is read-only and the single entry is unchanged.** The line
  sits directly under the capture line in the insights view and carries no
  button: enabling analysis or changing its consent stays a profile edit. The
  route-set test grew by exactly the one GET (13 → 14) and the one-tab /
  one-header-button assertions were not touched.
- **`capturePending` was reworded.** The 0.7.0 placeholder ("Not recording yet —
  capture lands in the next phase.") became "Waiting for the first frame." /
  "等待第一帧。": capture can now be on while the first frame has not arrived, so
  the old copy promised a phase instead of describing the state. Both locales
  changed together.
- **Four commands, one new.** `/dayflow-analyze` joined `dayflow-task`,
  `dayflow-remember`, and `dayflow-reflect`. It runs one manual tick through the
  worker and maps a blocked or failed run to an error result instead of throwing
  into the host.
- **The worker mounts only with a model service.** It is created inside
  `ctx.inject(['llm'], …)` and started in an effect only when `capture.enabled`
  and `analysis.enabled` are both true. Without the host `llm` service the route
  reports `worker: 'stopped'` and no `analyser-unset` skip is written, so a host
  that cannot analyse does not burn the day's windows.

**Skipped jobs stay terminal in this patch — decided.** 0.7.1 never restarts a
`skipped` row. The reasons split into "the user has not fixed the cause yet"
(`consent:*`, `provider-unset`, `model-unset`, `analyser-unset`, `paused`) and
"the day's cap is spent" (`budget`) and "the call failed too often" (the
`failed` attempts cap). This patch does **not** requeue any of them,
automatically or from the command.

- **Consequence, stated in the docs and the panel copy:** enabling consent later
  applies to windows analysed from then on, not to already-skipped windows;
  raising a cap does not revive the same day's budget skips. The current day can
  have a gap from the moment consent is enabled, and the next day is clean.
- **Why not here.** Re-running is a new state transition (`skipped` → `queued`
  or a replay attempt) plus a per-reason policy: is a consent skip re-runnable
  when the consent changes? Is a budget skip re-runnable when the cap is raised
  (it costs money — a D3 decision)? Is the attempts-cap `failed` row ever
  re-runnable (0.7.1 says no)? The patch also needs a bound (today only? last two
  days?), a trigger (worker start, config change, command), status fields, and
  tests. That is a state-machine and cost decision, not an observability
  deliverable: folding it into the first visible patch would make 0.7.2 a
  "worker plus replay policy" patch and break R1. The idempotency that makes the
  pipeline safe is worth more than the convenience here.
- **Cost of the deferral:** one mechanical gap for at most one day after the
  consent flips on a profile that already had capture on; the panel line, the
  docs, and the command's result text all say so. The manual workaround for local
  verification is a fresh day or a fresh journal, not SQL surgery.
- **Alternative considered (and rejected for this patch):** a manual-only
  `/dayflow-analyze --force` that requeues only the day's transient-reason skips.
  It costs about half a day (a store `requeueSkippedJobs` helper, the pipeline
  flag, the command branch, tests), but it creates a second semantics that the
  automatic path (worker start after a config change) would then have to match,
  and it would ship a money-spending replay behind a slash command before D3's
  cap policy is settled. If dogfooding shows the one-day gap is painful, it is
  the smallest follow-up to add — as its own change, not as hidden scope.
- **Where it went:** re-triaged in the 0.7.3 window (see that section's
  "Deferred from 0.7.2 — triaged, not included." subsection). 0.7.3 and 0.7.4
  deliberately stay single-theme, so catch-up is **not** in either; it is a
  **0.8.0 candidate by default** — the owner has not answered, and 0.7.5 kept
  a single theme (taking it earlier would have needed an explicit R1
  relaxation).

**Other ledger gaps kept out of 0.7.2.** Two analysis-loop items are knowingly
not in this patch, so no deliverable above silently promises them:

- **The token cap is reported, not enforced.** `dailyTokenBudget` and
  `tokensToday` are honest ledger numbers, but only `maxCallsPerDay` stops a run
  (0.7.1's gate). Enforcing tokens needs a post-call check because usage arrives
  with the answer, and it is a cost-policy decision rather than a visibility
  one: it was re-triaged in the 0.7.3 window and is a 0.8.0 candidate, not in
  0.7.3 and not in 0.7.5.
- **The 04:00 day tail.** A worker tick runs the current Dayflow day, so a frame
  captured just before the boundary after the previous day's last tick is not
  analysed (its windows belong to the previous day). The fix costs one bounded
  extra `run()` on the first tick after the boundary or on start; it was
  re-triaged in the 0.7.3 window and stays deferred with catch-up so one owner
  decision settles "what may be run late or re-run" once. It is the smallest of
  the three if the owner wants one early.

**Tests and acceptance.**

1. Worker: with an injected timer and a fake analyser over a temporary
   journal/frames, `start()` runs once immediately and schedules the next wait;
   a second `start()` keeps one timer; `stop()` clears it and prevents the next
   schedule; a restart does not duplicate rows. A failed run records
   `lastError`, does not crash, and the next delay grows (backoff), then returns
   to the interval after a success.
2. Status payloads: disabled, consent `none` with its reason, needs
   provider/model, the call cap reached (counts at `maxCallsPerDay`), worker
   running vs stopped, `intervalMinutes` reflected, `lastJobAt` present after a
   job; a missing journal answers zeros and no file is created (asserted with a
   directory listing); an unreadable journal degrades to zeros.
3. Ledger: `callsToday` counts `attempts > 0` rows and matches the jobs table;
   `queued`/`running`/`completed`/`failed`/`skipped` match the rows;
   `tokensToday` equals the summed ledger tokens; with `maxCallsPerDay: 2` the
   third window is `skipped: budget`.
4. Host adapter: a scripted `AsyncIterable` of `StreamChunk`-shaped chunks —
   `text-delta` text concatenated, the last `usage` chunk's token counts
   returned, unknown chunk types ignored, the request signal forwarded, an
   iteration error propagated to `llm.ts`'s retry; the emitted message content is
   a text block, and no image content part is built.
5. Worker mount: the effect starts the worker only when capture and analysis are
   both enabled and the `llm` service is present; stopping the effect stops the
   worker; a host without `llm` leaves the worker stopped and writes no
   `analyser-unset` skips.
6. `/dayflow-analyze`: registered in the host name list (four commands); no
   injected runner → an error result, not a throw; a runner that returns
   ok/failed maps to the result; a runner that throws becomes an error result;
   a day whose windows were already skipped reports that and does not requeue.
7. Panel and contract: the exact route-set assertion grows deliberately with the
   one new GET (13 → 14); the single-entry assertions are unchanged; the
   response is `{ analysis: … }`; the line's labels exist in both locales.
8. `npm test`, typecheck, `check:package` green; no new dependency and no schema
   migration in the diff; the tagged tree passes 408 tests (384 at 0.7.1 plus
   the 24 worker, status, host-adapter, command, and panel-line cases).
9. Config: `analysis.intervalMinutes` is validated at 1 and 60, defaults to 5,
   and a bad value is refused at load; the resolved-defaults fixture in
   `tests/capture-state.test.ts` carries the new field.

**Dependencies and owner decisions.** D1 for any real analysis; D3 for the caps
the status line explains and the fact that only the call cap is enforced in this
patch; D2 is settled by 0.7.1 and the adapter sends exactly the configured
provider/model. Defaults keep `consent: none` and capture off, so the patch ships
inert by default — the worker does not even mount on a default profile. No
schema change and no new host peer.

**Risks and rollback.** Timer leaks and duplicate intervals are the classic
failure here: the seam and the double-start/cleanup tests are the mitigation. An
off-by-one ledger would pause a day early or late; the assertions compare the
payload with the jobs table. The host adapter is the first code path that can
spend money on a real provider, so it stays behind the consent gate, the explicit
provider/model requirement, and the call cap; CI never reaches it. A host stream
that yields no `usage` leaves tokens at 0 — the line under-reports and the ledger
never invents usage, which is accepted. The one user-facing surprise — a consent
flip leaving the current day's earlier windows skipped — is accepted and stated
in the docs and the line, with catch-up deferred. Rollback:
`analysis.enabled: false` (or `capture.enabled: false`) stops the worker, the
route and the line; revert the tag; no schema to undo.


### 0.7.3 — Interactive insights: decisions in the panel

**Status: landed in `v0.7.3`, 2026-11-27 (annotated tag `v0.7.3`, commit
`bebfd7a`; built from the `v0.7.2` tree).** The tagged tree measures **425 green
tests** (408 at `v0.7.2` — seventeen new cases), **17 panel routes** (8 GET + 9
POST), owned schema **v8**, no model call, no new host peer, no new dependency,
and the single UI entry unchanged. The scope was finalised from the `v0.7.2`
tree; the deviations reality added are recorded at the end of this section, and
the acceptance list below is the definition of done for the tag.

**Theme and motivation.** 0.7.0 ships the review queue and long tasks in the
Journal insights view, but a decision or a session edit still costs an agent
turn: the queue is read-only there. This is low-risk, has no schema or model
dependency, and it must land **before** 0.7.4 starts filling the queue
automatically, or the queue becomes the chore the roadmap warns about (Risk 7).
0.7.2's analysis line stays read-only too: the panel decides review items and
edits task sessions, not analysis settings.

**Deliverables.**

- `src/review-actions.ts` — one shared composer,
  `applyReviewDecision(db, id, decision, { forever?, note? })`, returning
  `{ item, task?, memory? }`: an accepted `task_proposal` creates the long task
  and a kept `distillation`/`loop` writes the dated memory claim, in one write
  connection. `src/tools/review.ts` now calls it instead of inlining the
  composition, and the new panel route calls the same function, so the tool and
  the panel cannot drift. The decision rules themselves stay in
  `decideReviewItem`; this module composes, it does not re-implement.
- `POST /api/dayflow/review` — body `{ id: number, decision: 'keep' | 'accept' |
  'discard' | 'reject', note?: string, forever?: boolean, confirm: true }` →
  `{ review: { item, task?, memory? } }`. `confirm: true` is required (the click
  is the user's explicit agreement); `forever` is only valid with
  `discard`/`reject` and turns the decision into a hard suppression, while a
  plain discard/reject stays soft. An unknown id is **404** (`not_found`); an
  already-decided item, a kind-incompatible decision, or a missing confirm is
  **400** (`invalid_input`), and the item is never silently overwritten.
- `POST /api/dayflow/tasks/attach` — body `{ id: number, day: 'YYYY-MM-DD',
  minutes: number, note?: string, activity_ids?: number[], confirm: true }` →
  `{ task }`. The route writes one `(task, day)` session through
  `attachTaskSession`; attaching the same day again replaces that day (never
  doubles it), and the return is the task with its sessions.
- `POST /api/dayflow/tasks/detach` — body `{ id: number, day: 'YYYY-MM-DD',
  confirm: true }` → `{ task }`. It removes that day from the task's progress
  through `detachTaskSession` and **never** deletes the day's activities; the
  return is the task with its remaining sessions.
- **Attach vs. the existing link route.** `POST /api/dayflow/tasks/link` has
  shipped since 0.7.0 as the bulk post-add scan submit
  (`{ task_id, days: [{ day, minutes?, activity_ids? }] }`) and is **unchanged**
  in 0.7.3. The new attach route is the single-session, confirm-gated form the
  interactive list uses; both call `attachTaskSession`, so the store rule lives
  in one place. Two write shapes is duplication only at the wire level, and it is
  deliberate: the bulk route keeps the shipped add-task card working, while the
  panel's per-day actions are one confirmed write each. A later patch may retire
  `link` once nothing depends on it.
- `src/panel-contract.ts` — the three route constants, the request/response
  types, and one additive insights-payload field: `PanelTaskSummary` gains
  `sessions?: Array<{ day, minutes }>` so the client can draw one Unlink per
  already-attached day. `src/panel.ts` registers the three handlers inside the
  existing `ctx.inject(['connection'])` block, validates the untrusted body (id,
  decision set, day key, minutes, note/forever types, confirm), and runs each
  write through `withJournalWrite`; errors map through the existing
  `failureResponse` (400/404/503/500). No new entry point.
- `src/client/insights.tsx` (with `data.ts`, `locale.ts`, `styles.ts`) — each
  review item gets an action row by kind: **Accept** (primary) for
  `task_proposal` and `improvement`, **Keep** (primary) for `distillation` and
  `loop`, with **Discard** and the secondary **Don't suggest again** beside it.
  "Don't suggest again" is a deliberate second step: the row turns into an
  inline Confirm / Cancel line (no browser `confirm`), and only Confirm sends
  `forever: true`. Every button disables and shows working text while its request
  is in flight; success refreshes the insights payload, failure keeps the item
  and shows the existing error line. For tasks, every day in `sessions` gets an
  Unlink action that calls detach and refreshes; the existing scan → link flow
  from the add-task card stays as it is (no new attach form). Loading, error, and
  empty states exist in EN and ZH; the panel still registers one tab, one body,
  and one header toggle.
- Docs (the 0.7.3 docs track): `docs/PANEL.md` (routes 14 → 17, 8 GET + 9 POST,
  and the decisions/Unlink interaction), `docs/QUICK_CAPTURE.md` (deciding from
  the panel), `docs/ARCHITECTURE.md` (`review-actions` in the write path),
  README/README.zh (one line), `CHANGELOG.md` `[Unreleased]`.

**Tests and acceptance.**

1. Shared composer (`tests/review-actions.test.ts`): accepting a
   `task_proposal` writes the task, keeping a `distillation`/`loop` writes the
   memory claim, a discard/reject only updates the item, a `forever` on a
   positive decision is refused, and the item + task + claim land atomically or
   not at all.
2. Review route: a valid decision changes the item's status and returns what it
   wrote; a missing or false `confirm` is 400 and changes nothing; `forever:
   true` hard-suppresses and the same fingerprint is not re-proposed; a soft
   discard stays re-proposable with materially new evidence; an unknown id is
   404; an already-decided item is 400, not overwritten; a kind-incompatible
   decision is 400.
3. Parity: deciding through the route and through the `journal_review` tool
   handler on the same fixture leaves the same store state for item, task, and
   memory — or, where a full tool context is impractical, the route is asserted
   equal to `applyReviewDecision` and the tool handler is asserted to call the
   same composer, so no second copy of the rule can appear.
4. Attach/detach: attach writes one session and survives a reload of the
   insights payload; attaching the same day again replaces it; detach removes
   it; detaching does not delete the day's activities; a bad day key, a missing
   minutes, or a missing confirm is 400.
5. Route set: the exact assertion grows from 14 to **17** (8 GET + 9 POST,
   adding `PANEL_REVIEW_DECIDE_PATH`, `PANEL_TASK_ATTACH_PATH`, and
   `PANEL_TASK_DETACH_PATH`); the single-entry assertions (one tab, one header
   button, one body) are unchanged.
6. Client: every new label renders in EN and ZH with the locale-parity test,
   the working/disabled and confirm steps are covered by the format/client
   tests, and the client bundle builds with no new dependency.
7. `npm test` (425 cases after this patch: 408 at 0.7.2 plus the seventeen new
   cases), typecheck, `check:package` green; no schema migration, no model call,
   no new host peer.

**Dependencies and owner decisions.** D6: whether the panel also gets a
suppression-management surface (clearing a hard suppression). Safe default and
the decision for 0.7.x: **agent-only** — the panel only decides items, and
clearing a hard suppression stays the `journal_review` `unsuppress` action, so no
suppression list is added to the panel. Nothing here needs D1/D2/D3: no model is
called and no analysis setting is exposed. No schema change, so rollback is a
revert plus config (R8).

**Risks and rollback.** The danger is a destructive UI without a confirm step:
hard suppression is a secondary action with its own inline confirm, every panel
write carries `confirm: true`, and no panel path deletes a row (detach removes a
session, never activities). Duplicated decision logic would drift from the tool,
which is why the composer is shared and a parity test holds it. Double-submit is
mitigated by disabling the buttons while a request is in flight and by the store
replacing, not accumulating, a day's session. Rollback: revert the tag; the
routes are additive and no schema changes, so a downgrade only loses the
buttons.

**Implementation deviations (landed).** What the `v0.7.3` tree actually does,
where it differs from, or was not named in, the plan text above. The shipped
behaviour is the specification 0.7.4 builds on.

- **The exact route set is 17.** The three POST constants
  (`PANEL_REVIEW_DECIDE_PATH`, `PANEL_TASK_ATTACH_PATH`,
  `PANEL_TASK_DETACH_PATH`) are registered inside the existing
  `ctx.inject(['connection'])` block, and the sorted route-set assertion in
  `tests/panel.test.ts` grew from 14 to 17 without touching the one-tab /
  one-header-button / one-body assertions. Every body is validated from
  untrusted input; a missing or false `confirm` is 400, an unknown id is 404
  (`not_found`), and an already-decided or kind-incompatible item is 400 — all
  through the existing `failureResponse` mapping. No panel path deletes a row:
  detach removes a session and leaves the day's activities.
- **The composer is shared, not duplicated.** `applyReviewDecision` lives in
  `src/review-actions.ts`; `src/tools/review.ts` imports it instead of inlining
  the combination, and the route calls the same function inside
  `withJournalWrite`, so the item, the created task, and the memory claim land
  in one write connection. `tests/panel-insights.test.ts` holds a route-vs-tool
  parity test — the same fixture decided both ways leaves the same item, claim,
  and task state, with matching ids — so the first branch of acceptance item 3
  landed (there is no spying test on the import itself, which the item allowed
  as its looser alternative).
- **`PanelTaskSummary.sessions` is additive and optional.** Each entry is
  `{day, minutes}`; the field is omitted when the task has no session, and the
  insights builder re-reads each active task (bounded to 20) to carry it. The
  month and week payloads are untouched, and the field is what lets the client
  draw one Unlink per linked day.
- **The client's second step is its own inline question.** "Don't suggest
  again" replaces the action row with "Hide this for good?" and Confirm /
  Cancel (no browser dialog); only the confirmed write sends `forever: true`,
  and a plain Discard stays soft. Accept is primary for a `task_proposal` or
  `improvement`, Keep for a `distillation` or `loop`. Every write disables its
  buttons and shows the working label while in flight, a failed write keeps the
  item and shows an inline error, and a success refreshes the insights payload.
- **Copy and locale parity.** The new labels (decision row, the confirm
  question, working state, Unlink and its per-day and failure text) exist in
  both EN and ZH; the client locale-parity test covers them. The client bundle
  builds with no new dependency.
- **Docs travelled with the feature commit.** `docs/PANEL.md` (17 routes and
  the decision/Unlink interaction), `docs/QUICK_CAPTURE.md`,
  `docs/ARCHITECTURE.md` (`review-actions` in the write path), the README pair
  (one line) and `CHANGELOG.md` were updated in the 0.7.3 feature commit; this
  revision records the tag, the measured tree and the deviations here.
- **What did not change.** No owned-schema migration, no model call, no new
  host peer or dependency, and no new UI entry. The existing bulk
  `POST /api/dayflow/tasks/link` route is unchanged; the new attach route is the
  single-session confirmed form the panel uses.
- **Tests.** The suite moved 408 → 425: the shared composer, the three routes
  and their validation, the insights payload's `sessions`, the client's
  confirm/copy rules, and the deliberate route-set growth account for the
  seventeen new cases.

**Deferred from 0.7.2 — triaged, not included.** 0.7.3 stays **single-theme**:
the three analysis-ledger follow-ups 0.7.2 left behind are deliberately **not**
in this patch. The recommendation for where they go:

- **Skipped-window catch-up** — when consent, an unset provider/model, or a cap
  is fixed, requeue the affected `skipped` windows for a bounded range (today
  plus the previous day is enough for dogfooding), with a per-reason policy
  (transient configuration reasons yes; budget skips are a money decision under
  D3; the attempts-cap `failed` rows stay non-runnable). Not in 0.7.3: it needs
  a new state transition, a trigger policy, status fields, and tests — a state
  machine, not a panel deliverable.
- **The token cap as a gate** — a post-call check that stops a run when the day's
  token budget is spent (usage arrives with the answer, so it cannot be a
  pre-check like the call cap).
- **The 04:00 day tail** — one bounded extra `run()` for the previous day on the
  first tick after the boundary (or on start), so frames captured just before the
  boundary are still analysed.

Where they go next: they are **0.8.0 candidates by default.** The owner has
not answered the decision 0.7.2–0.7.4 deferred, and 0.7.5 kept one theme (R1);
0.7.4 deliberately did not take them either (its own catch-up is about missed
*close* jobs, not a replay of analysis-ledger skips). Taking one in 0.8.0 is an
explicit R1 relaxation and its own change; the per-item shape below plus its
added acceptance assertions apply. Rationale: each is a
cost/state-machine decision (D3/D4 territory), and folding them into the first
panel patch would make the diff a UI change plus a replay policy — unreviewable
under R1 and unshippable under R5 without the cap answers. If the owner wants one
early, the cheapest is the 04:00 tail (one bounded run, no new state, about half
a day), then the token gate (about one day), then catch-up (about 1.5–2 days plus
the D3/D4 decisions). Image admission is **not** a candidate here: pixels need a
host peer and a vision contract and stay a 0.8.0 item.

### 0.7.4 — The day closes itself

**Status: landed in `v0.7.4`, 2026-11-27 (commit `1375717`).** The scope was
finalised against the `v0.7.3` tree and shipped as the four disjoint tracks —
schema/store, briefs/insights, scheduler/wiring, panel/docs — with the
acceptance list below as the definition of done. This revision adds the
**landed shape and deviations** block at the end of the deliverables: the
tagged tree is the specification 0.7.5 builds on, and three details (the mount
gate, the proposal-count semantics, and the weekly/catch-up shapes) read
differently from the plan prose. It is the first patch that writes the journal's
opinionated layer (briefs, reflections, proposals, task sessions) on a timer, so
it lands after the panel can decide (0.7.3) and after the pipeline is observable
(0.7.2). It is **text-only** (no image, no host attachment peer) and adds no new
decision point beyond D4 and D9, both resolved by their safe defaults: D4 is
`automation.catchUpDays` (1–30, default 2), D9 is proposals-only memory, and the
existing cost caps apply.

**Theme and motivation.** Native port Phase 3. Once analysis exists, the 04:00
boundary should produce the standup, the reflection, the day's review
proposals, and the task sessions without an agent turn. The review queue only
earns that cadence because 0.7.3 made deciding it a click instead of an agent
turn.

**Deliverables.**

- `src/journal.ts` — migration **v9** in one transaction. `automation_runs`:
  `id`, `job` (`CHECK IN ('day_close','week_close')`), `day`, `status`
  (`CHECK IN ('pending','running','complete','failed','skipped')`, default
  `pending`), `attempts`, `error`, `payload_json`, `created_at`, `updated_at`,
  `UNIQUE (job, day)` plus a `day` index. `briefs`: `id`, `kind` (`CHECK IN
  ('day','week')`), `period_key`, `title`, `body`, `model`, `source_id`,
  `source_key`, timestamps, `UNIQUE (kind, period_key)`. `journalReady` gains
  both tables; both start empty (automation is opt-in); the migration is
  forward-only (R3/R8) and ships with a populated-v8 → v9 fixture test.
  0.7.4 writes only `kind = 'week'` into `briefs` — the daily brief continues to
  live in `daily_standup_entries`, which the `standup` skill and the panel
  already read — so `kind = 'day'` is an accepted value reserved for a later
  patch.
- `src/automation/store.ts` — the pure DB ledger over those tables, with no
  model and no scheduler: idempotent `ensureAutomationRun(job, day)`,
  `start`/`complete`/`fail`/`skip` (with `AUTOMATION_MAX_ATTEMPTS = 2`),
  filtered `listAutomationRuns`, and `upsertBrief`/`getBrief`/`listBriefs`
  where the upsert is `ON CONFLICT (kind, period_key)` — regenerating a period
  rewrites its row instead of piling up copies. A malformed row is a
  `database_error`; `job`, `kind`, `status`, day keys and period keys are
  validated at the boundary.
- `src/automation/consent.ts` — one pure **text** gate, `decideTextAnalysis`,
  checked **before** any model call: `analysis.enabled`, `analysis.consent ===
  'none'`, an unset provider, an unset model. It is deliberately not 0.7.1's
  frame gate (no `capture.enabled` and no `capture_state.paused`): a close job
  sends activity text — never frames, window titles or images — so a profile
  that pauses capture can still close its day, and there is no code path to the
  adapter that skips this function. A blocked job records a `skipped` run with
  the reason.
- `src/briefs/daily.ts` — the day's `activities` (imported and native alike,
  read-only) → one text-only model call → the `daily_standup_entries` row
  (`source_id = 'native'`, `source_key = 'automation:day:<day>'`, payload
  `{day, title, body, model, generated_at}`), so the existing `standup` skill
  and the panel read it unchanged. Idempotent per day: an existing row is
  `already-written` unless the caller passes `force` (which rewrites it instead
  of adding a second row); a day with no activity is `empty` and makes no model
  call.
- `src/briefs/weekly.ts` — the seven-day rollup (Monday to Sunday; the period
  key is validated to that Monday) → one text-only call →
  `briefs(kind = 'week', period_key = <monday>, source_key =
  'automation:week:<monday>')`, idempotent per period (a second run is
  `already-written` unless forced); an empty week is `empty` and makes no call.
- `src/automation/insights.ts` — one insight pass per Dayflow day, one strict
  JSON contract (`reflection`, `proposals`, `task_sessions`). It writes one
  reflection via `saveReflection` (kind `day`); at most **3** proposals at
  confidence **≥ 0.6** through `proposeReviewItem`, whose dedupe, per-day cap,
  confidence floor and hard/soft suppression remain the store's rules; and task
  sessions from the model's `task_sessions` — a match at confidence **≥ 0.8**
  against an existing **active** task is attached through `attachTaskSession`;
  a lower-confidence match on an existing active task becomes a `task_proposal`
  review item instead, and a task id that is unknown or no longer active is
  skipped with a reason — never a silent session. Memory claims are
  **never** written here (D9): automation proposes into the queue, and only the
  existing kept-item promotion path writes a claim. A pass for a day that already
  has its reflection is a whole-pass no-op unless forced; a malformed answer is
  `skipped: bad-output` and writes nothing.
- `src/automation/scheduler.ts` — host timers over an injectable
  `{ setTimeout, clearTimeout }` seam and clock. Day close at
  `automation.dailyAt` (default `04:00`); weekly close on `automation.weeklyOn`
  (default Monday) at the same time; catch-up on start/tick when
  `automation.catchUpOnStart` is true; and the **D4** window
  `automation.catchUpDays` (integer 1–30, default 2): catch-up tries at most
  that many days ending at the due day, and a missing day older than the window
  gets an `automation_runs` row with `status = 'skipped'` and reason
  `older-than-catch-up` rather than a fabricated close. `UNIQUE (job, day)`
  makes the same job for the same day at most one run; a failure is recorded with
  `attempts` and retried up to two attempts without blocking the other job; a
  stale `running` row is skipped (`stale-running`), not stuck. `start()`/`stop()`
  are idempotent (a double start keeps one timer; stop cancels the next
  schedule), a tick never throws into the host, and `status()` answers
  `{enabled, running, dailyAt, weeklyOn, catchUpDays, lastDayClose?,
  lastWeekClose?, nextDayCloseAt?}` for the panel and the command.
- `src/config.ts` — one new key, `automation.catchUpDays` (integer 1–30, default
  2), validated at load and resolved into `ResolvedAutomationConfig`; the
  existing `automation` keys and defaults do not change.
- `src/index.ts` — one mount point. The close composition is
  `writeDailyBrief` + `runDayInsights` for a day and `writeWeeklyBrief` for a
  week, over the text analyser built from `scoped.llm`; the scheduler is created
  and started inside the existing `ctx.inject(['llm'], …)` block (the same gate
  as the analysis worker: `capture.enabled` and `analysis.enabled` both on and
  the host model service present) and stopped through `scoped.effect`. The
  scheduler's `status()` is passed to the panel route and its `runDue()` to the
  new command. Consequence, stated honestly: automation is a **native-capture**
  feature in 0.7.4 — with capture off (the default) nothing mounts, so a default
  profile runs no close jobs and imported journals are left exactly as they
  were. `automation.enabled` already defaults true in the 0.7.0 skeleton; it
  becomes meaningful only once the analysis stack is on, and
  `automation.enabled: false` remains the config switch that stops every job.
- `GET /api/dayflow/automation/status` — read-only, exactly this route,
  returning `{automation: {enabled, running, dailyAt, weeklyOn, catchUpDays,
  lastDayClose?, lastWeekClose?, nextDayCloseAt?}}`. When the scheduler is
  absent (automation off, or capture/analysis off) it answers the
  config-derived defaults with `running: false`; a missing journal answers
  without creating the file. The route set grows 17 → **18** exactly (9 GET + 9
  POST), and the single-entry tests stay untouched.
- `/dayflow-run-close` — the fifth slash command: no argument, runs the
  scheduler's due close (`runDue()`) through a runner injected by
  `src/index.ts` (the commands module keeps no journal or model access), and
  maps blocked, skipped and failed runs to command text instead of throwing
  into the host.
- Panel — one compact close-state line directly under the 0.7.2 analysis line
  in the insights view: the day-close time, the last day close's day and status,
  the weekly day, and the catch-up window ("last 2 days"), with a status dot
  (enabled+running, last close failed, disabled). It carries no button:
  enabling or rescheduling automation stays a profile edit, and the one-entry
  rule holds (no new tab, header button, settings page, or view).
- Docs: `docs/NATIVE_PORT.md` (Phase 3 landed scope, and **correct §4's v9
  draft**: it lists `job` values `analyse`/`daily-close`/`weekly-close`, four
  statuses and only `kind = 'week'`, while the finalised v9 has two job values,
  five statuses and both brief kinds), `docs/ARCHITECTURE.md` (`briefs/` and
  `automation/` in the layout and the write path), `docs/CONFIGURATION.md` (the
  automation block is now used, including `catchUpDays`), `docs/PANEL.md` (18
  routes and the close line), README/README.zh (one line), `CHANGELOG.md`.

**Landed shape and deviations (measured on the `v0.7.4` tree).** The shipped
behaviour is the specification 0.7.5 builds on. The plan prose above is kept as
the intent; these are the points where the tagged tree measures differently or
where the finalised text named something more loosely.

- **The mount gate is the whole analysis block, not just the scheduler.** The
  scheduler is created and started only inside the existing
  `ctx.inject(['llm'], …)` block, itself under
  `capture.enabled && analysis.enabled`, and only when `automation.enabled` —
  so 0.7.4's close pass is a **native-capture feature**: a default profile
  (capture off) mounts nothing and imported journals are untouched. Once
  mounted, the `decideTextAnalysis` gate is deliberately narrower than the frame
  gate (no `capture.enabled`, no `capture_state.paused`, no
  `localProviders` check): it reads already-stored rows and sends activity
  text only, never frames, window titles, or images.
- **The daily brief's home is `daily_standup_entries`, with the planned
  payload.** The row is `source_id = 'native'`,
  `source_key = 'automation:day:<day>'`, payload
  `{day, title: 'Standup <day>', body, model, generated_at}` — the existing
  `standup` skill and panel read it unchanged. The weekly close writes only
  `briefs(kind = 'week', period_key = <Monday>, source_key =
  'automation:week:<Monday>')`; `kind = 'day'` stays reserved. The weekly close
  in **this** tree is exactly one text call plus that one row: there is **no**
  weekly reflection and **no** memory-lint summary yet. The lint summary is
  0.7.5's job; a weekly reflection is not scheduled on the 0.7.x line at all
  (the stored week brief is the compressed record). The `[0.7.4]` CHANGELOG
  sentence and one NATIVE_PORT Phase 3 sentence that suggest otherwise are
  loose prose, not behaviour — see 0.7.6's docs reconciliation.
- **Proposal counting is not capped at three.** `proposals` in the insight
  result is the number of review items written: the model's proposals (filtered
  to confidence ≥ 0.6, sorted, then at most `DEFAULT_MAX_PROPOSALS = 3`) **plus**
  weak task-session guesses proposed as `kind = 'task_proposal'` (a session on
  an existing active task at confidence below `DEFAULT_SESSION_MIN_SCORE = 0.8`
  becomes a queue item instead of an attachment; up to `INSIGHTS_MAX_TASK_SESSIONS
  = 10` guesses are considered). So one day can produce more than three queue
  items, bounded by the store's own `MAX_PROPOSALS_PER_DAY = 5` and by dedupe,
  suppression, and the 0.8 attach floor; unknown or inactive task ids are skipped
  with a reason, and no memory claim is ever written (D9).
- **Weekly Monday semantics: the close summarises the week that just ended.**
  A close at `automation.weeklyOn` 04:00 (Monday by default) has just ended the
  previous week, so the period key is the **Monday seven days before the
  boundary date** (e.g. Monday 2026-11-23 04:00 closes the week of
  2026-11-16). The current, still-running week is never closed early; with
  catch-up on, the only week the window may replay is the immediately preceding
  one. The same rule shapes the day close: the 04:00 boundary ends the Dayflow
  day labelled with the previous date, and a day still in progress is never
  closed.
- **`automation.catchUpOnStart: false` shrinks the windows to the due period,
  and the ledger archives one boundary row.** Every pass plans from the due
  day/week; with catch-up off the day window is 1 (the due day only) and the
  week window is 1 (the due week only), so a restart does not replay old days.
  The first missed day (or week) just outside the window is recorded as
  `skipped` with `older-than-catch-up` and no brief is fabricated; days older
  than that first boundary day are **not** given individual rows (the landed
  shape is one honest boundary marker, not a row per missed day). A `running`
  row left by a crash is skipped as `stale-running`, a failed close is retried
  to `AUTOMATION_MAX_ATTEMPTS = 2`, and consecutive failures re-arm an early pass
  with a 5-minute delay that doubles up to five doublings; a success restores
  the normal boundary. Passes are serialized, the timer is armed only after a
  pass settles, and a tick never throws into the host.
- **The status payload and close line are exactly the planned ones.** The wire
  is `{automation: {enabled, running, dailyAt, weeklyOn, catchUpDays,
  lastDayClose?, lastWeekClose?, nextDayCloseAt?}}`; when the scheduler is not
  mounted the route answers the profile-derived schedule with `running: false`
  and never creates the journal. `lastDayClose` is the most recent **day**, not
  the most recently touched one, so archiving an old day cannot hide today's
  close. The panel line shows the day-close time, the last day close's
  day/status, the weekly day, "catch-up N days", "closing now" while a pass
  runs, and a green/amber/grey dot; it has no button, no second entry, and its
  copy is in EN and ZH.
- **Measured surface.** 477 tests (425 at 0.7.3 — 52 new cases across
  automation store/scheduler/insights, briefs, commands, panel, and client
  format), 18 panel routes (9 GET + 9 POST), 5 slash commands, 23 tools, 8
  skills, schema v9, no new host peer or dependency, no image. The tagged tree
  is green under the same `npm test` / typecheck / `check:package` gates as the
  rest of the line.
- **Two ledgers 0.7.5 built on.** `automation_runs.payload_json` existed and the
  store records/parses it, but the 0.7.4 close composition never passed a payload
  (`completeAutomationRun` got `{status: 'complete'}`), and the scheduler's close
  outcome carries only `{status, error}`, so the 0.7.5 lint owns its row and its
  payload rather than riding the scheduler's outcome. And `briefs` had **no**
  `payload_json` column, so the digest needed one additive column — both landed
  in v10.

**Tests and acceptance.**

1. Closing a synthetic day with a scripted adapter produces exactly one standup
   entry, one day reflection, at most three **model** proposals (confidence ≥ 0.6
   respected) plus any weak task-session `task_proposal` items — the landed
   counting rule, so the queue total is bounded by the store's five-a-day cap
   rather than by three — and sessions only for the high-confidence (≥ 0.8) matches; a
   lower-confidence match on an existing active task becomes a `task_proposal`
   review item; a task id that is unknown or no longer active is skipped with a
   reason; `memory_claims` is unchanged.
2. Re-running the same day is a no-op: zero adapter calls, no new rows and the
   existing row bodies unchanged; `force` rewrites the brief/reflection instead
   of duplicating a period.
3. Catch-up is bounded: a day missed inside the `catchUpDays` window is closed
   on the next start/tick; the first missed day just outside the window gets an
   `automation_runs` row with `status = 'skipped'` and reason
   `older-than-catch-up`, older days are not given individual rows, and no brief
   is fabricated; a long shutdown does not produce a storm.
4. The weekly close on the configured weekday writes exactly one `briefs` row
   for the **just-ended** week's Monday (the Monday seven days before the
   boundary date, not the current week); a second run is a no-op; a non-Monday
   period key is refused.
5. A failing text call records `automation_runs.status = 'failed'` with
   `attempts`; it is retried to the attempts cap (2) and then left failed; the
   failure does not block the other job; a stale `running` row is skipped, not
   stuck.
6. `automation.enabled: false` runs nothing at all: no timer is scheduled, no
   run row is written, the status route reports `enabled: false`, and the
   command answers that automation is off.
7. Suppression is honoured: a hard-suppressed fingerprint is not re-proposed; a
   soft-discarded item returns only when `proposeReviewItem` judges the evidence
   materially new; the pass never writes a memory claim (D9).
8. A mixed journal (imported rows + native rows) closes without touching the
   imported rows' ids or payloads, and every row the pass writes carries
   `source_id = 'native'`.
9. Migration from a populated v8 fixture to v9 keeps every existing row,
   reopening is a no-op, and the new CHECKs reject a bad `job`, `kind`, or
   `status`.
10. Panel and contract: the exact route-set assertion grows deliberately with
    the one new GET (17 → 18, 9 GET + 9 POST) and the single-entry assertions are
    unchanged; the close line's copy exists in EN and ZH; the client bundle
    builds with no new dependency.
11. `npm test` (477 cases on the tagged tree: 425 at 0.7.3 plus this patch's 52
    new cases), typecheck, `check:package` green; CI never calls a model or
    captures the screen (fake or scripted adapters only, R4).

**Dependencies and owner decisions.** D3 (cost), D4 (catch-up window), D9
(memory). Safe defaults, all shipping without an answer:
`automation.catchUpDays: 2` (1–30; the first day outside the window is
`skipped`, never fabricated), at most three model proposals per day at
confidence ≥ 0.6 inside the store's own five a day (weak task-session guesses
add queue items under that same cap — the landed counting rule above), task
sessions only at ≥ 0.8 against an existing active task, and proposals-only
memory. Each close makes one text-only call and is bounded by the
scheduler's idempotency and two attempts; the `analysis_jobs` token/call ledger
is not modified by this patch. D1 still governs whether a model may be called at
all (the text gate blocks `consent: none`), and D2's explicit provider/model
rule is reused. **Explicitly not in 0.7.4:** the token budget as a hard gate, the
catch-up/replay of analysis-ledger `skipped` windows, and the 04:00 day tail —
the owner has not answered, so by default they are **0.8.0 candidates** rather
than 0.7.5 scope (see the 0.7.5 section); also not here: image admission, no
`attachments` peer, no per-job automation switch, and no panel
suppression-management surface. The D4 catch-up in this patch is about missed
**close jobs** (`automation_runs`), not a replay of analysis-ledger skips
(0.7.2's decision, re-triaged in the 0.7.3 window and carried to 0.8.0 by
default).

**Risks and rollback.** The queue becoming noise is mitigated by the
three-proposal cap on the model's own proposals, the 0.6 confidence floor, the
store's five-a-day cap, soft/hard suppression, and a "nothing worth keeping
today is a success" outcome — the measured 0.7.4 shape (model proposals plus
weak session guesses) is the honest limit, not a promise of three items.

Wrong task attribution is
mitigated by the 0.8 floor, the existing-active-task requirement, the
proposal-instead-of-attach rule below it, and the 0.7.3 Unlink that removes a
session without deleting a day's activities. A catch-up storm after a long
shutdown is bounded by `catchUpDays` and by the single `skipped` boundary row
(older days get no rows). Cost is bounded by one text-only job per day/week and
two attempts. Timer leaks,
duplicate periods and double closes are the classic failure here: the injectable
seam, the `(job, day)` / `(kind, period_key)` uniqueness and the
double-start/stop tests are the mitigation. Nothing user-visible runs on a
default profile (capture off, consent `none`), so the patch is inert until the
profile opts into capture and analysis. Rollback: `automation.enabled: false`
stops every job without a downgrade; v9 is additive; an older tag refuses a v9
journal (R8), so a bad close is fixed forward or switched off by config, not by
running 0.7.3 on the journal.

### 0.7.5 — Lint on a schedule, digest in the week

**Status: landed in `v0.7.5`, 2026-11-27 (commit `f117cdc`, annotated tag
`v0.7.5`).** The scope was finalised against the `v0.7.4` tree while the
implementation was written; the tagged tree measures 493 green tests, 18 routes,
5 commands, and schema v10, and the shape and corrections are recorded at the
end of the deliverables. One theme (R1): the read-only memory lint became a
weekly scheduled pass whose findings become review proposals and whose digest is
written into the weekly brief. It depends on 0.7.4 only and shipped under D8's
safe default (proposals plus the digest; never an automatic repair). It adds
**no** route, command, tool, skill, configuration key, host peer, dependency, or
UI entry — 18 routes and 5 commands are unchanged — and it moved the owned
schema one step, **v9 → v10**, on its own (R3).

**Theme and motivation.** The memory lint exists (`journal_memory` `action:
"lint"`: contradictions, superseded-by-newer pairs, unsourced claims, aged
claims) but only runs when an agent calls it, so Roadmap Risk 2 — memory written
as the present is stale the moment it is stored — is mitigated only on demand:
the store ages and contradicts in silence until someone asks. A weekly pass
closes that gap on the cadence the journal already has, reusing the 0.7.4
scheduler and its ledger instead of inventing a second timer. It is deliberately
advisory: findings become proposals in the queue 0.7.3 made decidable, and an
automatic supersede or forget is out of scope (D8/D9). With it, Phase 4's
maintenance loop — ingest, query, lint — is complete on the 0.7.x line; the
remaining Phase 4 gap is the editing path, not the lint.

**Deliverables.**

- `src/journal.ts` — migration **v10** (`JOURNAL_SCHEMA_VERSION = 10`),
  forward-only (R3/R8), inside `migrateJournal`'s existing single transaction:
  - **rebuild `automation_runs`** so its `job` CHECK accepts
    `'day_close' | 'week_close' | 'lint'`. SQLite cannot alter a CHECK in place,
    so `MIGRATION_10` creates the replacement table (`automation_runs_v10`),
    copies every v9 row with its id, lifecycle, payload, and timestamps, drops
    the old table, renames, and recreates `automation_runs_day_idx`; the widened
    CHECK is the only change to the table shape and no row is rewritten or
    dropped;
  - **add nullable `briefs.payload_json TEXT`** for the digest, under a
    `tableHasColumn` guard inside the same transaction (a journal rewound from a
    newer fixture could already carry the column; an unconditional `ALTER` would
    abort the upgrade). Existing briefs keep their body/model with a NULL
    payload.
  Migration tests: a fresh journal is v10 with both tables; a v8 journal
  migrates to v10 in one step keeping its data; a populated v9 fixture rebuilds
  `automation_runs` (row count and ids preserved) so both the old and the new
  `job` values are accepted and an unknown one is still rejected, keeps every
  `briefs` row with a NULL payload, and reopening is a no-op.
- `src/automation/store.ts` — `AutomationJob` gains `'lint'` (and the `JOBS`
  validator set), so the ledger is "first-class" for the third job; the brief
  record gains an optional `payload`, `upsertBrief` serializes it and clears an
  earlier one when omitted, and a brief's corrupt payload decodes to "no
  payload" instead of a `database_error` (a run's payload stays strict — the
  ledger must be trustworthy). The scheduler's `Record<AutomationJob,
  RetryState>` gains an unused `lint` entry to satisfy the widened union; the
  lint row's lifecycle is owned by the wrapper below, and the scheduler's close
  outcome keeps its `{status, error}` shape.
- `src/automation/lint.ts` — **the scheduled wrapper** over the read-only
  `lintMemoryClaims`, exported as `runWeeklyLint({journalPath, config,
  weekMonday, now?, force?, maxProposals?})` and returning
  `WeeklyLintResult {status: 'complete' | 'skipped', scanned, findings,
  proposals, summary, reason?}`:
  - it records its **own** ledger row `automation_runs(job = 'lint', day =
    <monday>)`, keyed by the Monday of the closed week and validated to be a
    real Monday. A completed week returns `skipped` with `reason:
    'already-complete'` and the recorded counts — no scan, no proposals, no row
    change; `force: true` recomputes the week and rewrites the payload on the
    same row, keeping its id and attempts;
  - `lintMemoryClaims({now})` is read-only. Its four lists are flattened in the
    report's own priority order (contradiction, superseded-by-newer, unsourced,
    aged) and reduced to **one finding per subject**, strongest kind first (a
    claim belongs to exactly one subject, so this is at most one proposal per
    claim per week, while a contradiction's pair stays one item). The kept
    findings are capped at `DEFAULT_WEEKLY_LINT_MAX_PROPOSALS = 3` (option
    1–10), so one pass cannot flood the queue;
  - each kept finding becomes a `kind = 'improvement'` proposal — title
    `Memory check: <subject>`, body stating the finding and the claims involved
    plus the reminder that nothing was repaired, confidence 0.7 (clears
    `MIN_PROPOSAL_CONFIDENCE = 0.5`), `source_day = <monday>`, and an evidence
    line naming the finding type and claim ids. Proposals go through
    `proposeReviewItem`, so `reviewFingerprint` (sha256 of kind + normalised
    title) makes a same-week re-proposal `already-proposed` instead of a
    duplicate, and the queue's hard/soft suppression and five-a-day cap apply
    (all of a week's proposals share the Monday as `source_day`);
  - it **never writes a claim**: no add, supersede, or forget call is made and
    no row gains `superseded_by` (the tests compare every claim row
    byte-for-byte before and after);
  - a clean week is still a result: the run completes with
    `summary: 'nothing to report'`; otherwise the summary reads like
    "5 findings across 6 active claims; 3 proposals queued." plus
    "1 proposal already queued or suppressed." when items were dropped. The
    completed row's `payload_json` is `{scanned, findings, proposals, summary}`
    — `findings` is the total across the four lists before per-subject
    reduction — the machine-readable digest a later briefs view can use;
  - bookkeeping is all-or-nothing: proposals and the completed run are written
    in one transaction. A scan failure records the run `failed` when this pass
    started it and rethrows; a forced rerun that fails leaves the earlier
    completed week's payload intact rather than downgrading it;
  - it makes **no model call and has no consent gate of its own** — it reads
    claims already in the journal — so it still proposes on a week whose model
    call is gated off; the close itself is recorded `skipped` by the brief's
    gate.
- `src/briefs/weekly.ts` — `writeWeeklyBrief` accepts an optional
  `memoryHealth: WeeklyMemoryHealth {findings, proposals, summary}`. When
  present, the brief body ends with exactly one paragraph,
  `Memory health: <summary>`, appended **after** the model's answer — never sent
  to the model, never a second paragraph — and the row's
  `payload_json.memory_health` stores the same object; the result echoes
  `memoryHealth`. A rerun without `force` skips an existing brief and keeps its
  stored digest; `force` refreshes body and payload. Without `memoryHealth` the
  brief is exactly the 0.7.4 one.
- `src/index.ts` — the week-close composition runs `runWeeklyLint` for the same
  Monday **first** and hands its digest to `writeWeeklyBrief`, inside the
  existing `ctx.inject(['llm'], …)` / `capture.enabled && analysis.enabled &&
  automation.enabled` mount, so the pass stays inert on a default profile
  exactly as in 0.7.4. **Ordering, finalised here:** the digest must be part of
  the brief write, so the lint runs before the brief within one week-close pass;
  the earlier draft wording "after the weekly close" is read as "under the same
  weekly-close trigger", not "after the brief row exists". `describeWeekClose`
  now takes both results: a blocked gate from either pass records `skipped` with
  that reason, both passes skipping (an already-written brief beside an
  already-complete lint) records `skipped` with the first reason, and any other
  combination is `complete`. A lint throw propagates, so the week close is
  recorded `failed` and the scheduler's two-attempt retry re-runs it while the
  lint row has attempts left; the brief is written only after a successful
  lint.
- Docs: `docs/CONFIGURATION.md` (the weekly lint and digest; the closes are
  gated by analysis consent, the lint makes no model call, and there is no new
  key), `docs/NATIVE_PORT.md` §4 (v10 shipped: the third job value, the
  `briefs.payload_json` column, and `automation/lint.ts`), `docs/ARCHITECTURE.md`
  (`automation/lint.ts` in the write path), `docs/PANEL.md` (the digest stays in
  the `briefs` store; the panel stays at 18 routes and the same close line),
  `docs/ROADMAP.md` remain line, `CHANGELOG.md` (the `[Unreleased]` entry moves
  into the release section at the bump).

**Landed shape and corrections (measured on the `v0.7.5` tree at `81af8e3`).**
The tagged tree implements the shape above; these are the points where reality
is more specific than the draft, and they are the record 0.7.6 reconciles other
docs against. Verified again for this revision: `npm test` 493 pass / 0 fail /
0 skipped / 0 todo, `npm run typecheck` and `npm run check:package` green;
`JOURNAL_SCHEMA_VERSION = 10`; `src/panel-contract.ts` registers 18 paths; and
`DAYFLOW_COMMAND_NAMES` has exactly five entries.

- **One proposal per subject, capped at three.** The draft said "one proposal
  per claim"; the implementation reduces the flattened finding lists to one
  finding per **subject** (strongest kind first) and caps a pass at
  `DEFAULT_WEEKLY_LINT_MAX_PROPOSALS = 3` (option 1–10). Since a claim belongs to
  exactly one subject, this still means at most one proposal per claim per week,
  and a contradictory pair stays one item; the proposal title is
  `Memory check: <subject>` and the body names the claim ids.
- **The run payload is counts plus summary, not the finding arrays:** the
  completed row stores `{scanned, findings, proposals, summary}`; the detailed
  finding (type, claims, "nothing was repaired") lives in the proposal body and
  its evidence line.
- **A completed week reports `skipped: already-complete`** with the recorded
  counts, and `force: true` recomputes it and rewrites the payload on the same
  row (keeping its id and attempts). A scan failure records the run `failed` and
  rethrows; a forced rerun that fails leaves the earlier completed payload
  intact.
- **The lint runs before the brief inside one week-close pass**, and a lint
  throw fails that week's close and is retried under the scheduler's two-attempt
  bound — it is not isolated from the close. The brief is written only after a
  successful lint, so a failed lint cannot leave a brief that silently omits the
  digest.
- **No consent gate of its own.** The lint makes no model call, so it runs even
  when the week's model call is gated off; the close is then recorded `skipped`
  by the brief's gate, and `describeWeekClose` now takes both results (a blocked
  reason from either pass wins; both-skipped is `skipped`; otherwise complete).
- **Migration details:** the `briefs.payload_json` `ALTER` sits under a
  `tableHasColumn` guard inside the same transaction (a rewound newer journal
  could already carry the column); the scheduler's `Record<AutomationJob,
  RetryState>` gained an unused `lint` entry to satisfy the widened union. A
  brief's corrupt payload decodes to "no payload" rather than a database error;
  a run's payload stays strict.
- **The digest is one line:** the brief body ends with exactly one
  `Memory health: <summary>` paragraph appended after the model's answer (never
  in the prompt) and `payload_json.memory_health` holds
  `{findings, proposals, summary}`; an `already-written` rerun keeps the stored
  digest and `force` refreshes it to exactly one paragraph.
- **Measured surface:** 493 tests (477 at 0.7.4 — sixteen new cases: twelve in
  `tests/automation-lint.test.ts`, two brief-digest cases, the brief-payload and
  v10 migration store cases, and the adjusted fixtures), 18 panel routes (9 GET
  + 9 POST), 5 commands, 23 tools, 8 skills, schema v10, no new peer or
  dependency, no image. `npm test`, `npm run typecheck`, and
  `npm run check:package` are green on the tagged tree.
- **Implementation anchors the 0.7.6 docs pass checks against (measured on the
  tagged tree):** `src/journal.ts` — `JOURNAL_SCHEMA_VERSION = 10` and
  `MIGRATION_10` rebuilds `automation_runs` (replacement table, id-preserving
  copy, drop/rename, `automation_runs_day_idx` recreated) and adds the nullable
  `briefs.payload_json` under a `tableHasColumn` guard;
  `src/automation/store.ts` — `AutomationJob` includes `'lint'` (and the `JOBS`
  validator), a brief's corrupt payload decodes to "no payload" while a run's
  payload stays strict; `src/automation/lint.ts` — `runWeeklyLint(...)` returns
  `WeeklyLintResult {status, scanned, findings, proposals, summary, reason?}`,
  `DEFAULT_WEEKLY_LINT_MAX_PROPOSALS = 3` (option 1–10), records
  `automation_runs(job = 'lint', day = <Monday>)`, reports a completed week as
  `skipped: already-complete`, recomputes that row with `force`, and proposes
  one `kind = 'improvement'` item per subject ("Memory check: <subject>",
  confidence 0.7) through the existing queue rules;
  `src/briefs/weekly.ts` — the optional `memoryHealth` input renders exactly one
  `Memory health: <summary>` paragraph after the model answer and stores
  `payload_json.memory_health`; `src/index.ts` — `closeWeek` runs
  `runWeeklyLint` **then** `writeWeeklyBrief` and maps both through
  `describeWeekClose(weekly, lint)`. The pass makes no model call and has no
  consent gate of its own.

**Tests and acceptance.**

1. The first run scans read-only and proposes at most one `improvement` per
   subject (which is at most one per claim); a fixture with five findings across
   the four lists yields at most `DEFAULT_WEEKLY_LINT_MAX_PROPOSALS = 3`
   proposals, and every `memory_claims` row is byte-identical before and after
   (no `superseded_by`).
2. A clean or empty week completes with `summary: 'nothing to report'` and
   records the run, so the weekly brief can say the check ran.
3. One subject never gets two proposals, even when two finding kinds find it;
   the proposal cap is honoured and configurable only within 1–10.
4. A hard-suppressed proposal is never raised again, including in a later week;
   a soft-discarded one may return for a different week (the new `source_day` is
   materially new evidence) but not for the same one.
5. A second run of the same week is `skipped: already-complete` with the
   recorded counts and writes nothing; `force` recomputes the week and rewrites
   the payload without duplicating proposals.
6. A scan failure records the lint run `failed` and propagates, so the week
   close is recorded `failed` and remains retryable; a forced rerun that fails
   leaves the earlier completed week's payload intact. Arguments (missing
   journal path, a non-Monday, an out-of-range cap) are validated before
   anything is written.
7. Migration v9 → v10 keeps every `automation_runs` id/row and every `briefs`
   row, accepts `'lint'` and the old job values while still rejecting an unknown
   one, and reopening is a no-op; a v8 journal migrates to v10 in one step.
8. The weekly brief carries the digest exactly once: the body ends with one
   `Memory health: <summary>` paragraph, the prompt never contains it, the row's
   `payload_json.memory_health` matches the lint payload, an `already-written`
   rerun keeps the stored digest, and `force` rewrites it to exactly one
   paragraph.
9. The surface does not grow: 18 routes (9 GET + 9 POST), 5 commands, 23 tools,
   8 skills, one UI entry, no new configuration key; the close line and its copy
   are untouched; no host peer or dependency is added; CI never calls a model
   (scripted lint fixtures and fake adapters only, R4).
10. `npm test` (493 on the tagged tree — 477 at 0.7.4 plus this patch's
    sixteen new cases), `npm run typecheck`, `npm run check:package` green; the
    v10 migration test runs in the same suite.

**Dependencies and owner decisions.** D8 only, shipped by its safe default:
proposals plus the digest. D9 is reused unchanged — the pass writes no claim.
**Not in 0.7.5:** the three analysis-ledger follow-ups — skipped-window catch-up,
the token cap as a post-call gate, and the 04:00 day tail. The owner has not
answered the decision 0.7.2/0.7.3/0.7.4 deferred, so the default is to keep 0.7.5
single-theme (R1) and carry all three as **0.8.0 candidates**, with the decision
taken when 0.8.0 is scoped. 0.7.5 shipped single-theme; taking one there would
have been an explicit R1 relaxation and its own change, and nothing in the
landed tree forecloses it in 0.8.0. Image admission, the briefs reading view, a per-job
automation switch, and a digest-only variant are not in 0.7.5 either.

**Risks and rollback.** A table rebuild is the one genuinely delicate step in the
line: one transaction, a populated v9 fixture (and a v8 one), row-count and CHECK
assertions, no data rewriting, the index recreated — the same discipline as v9,
and the last migration before 0.8.0's cutover rehearsal. "The lint becomes
noise" is bounded by the weekly cadence, one proposal per subject (at most one
per claim), the three-proposal cap, the queue's five-a-day cap, the confidence
floor, and soft/hard suppression. "The lint silently repairs memory" is
impossible by construction and enforced by the byte-identical test. A lint
failure is not swallowed: it fails that week's close, records the lint row
`failed`, and the scheduler's bounded retry gives it one more attempt — a broken
lint cannot silently drop the brief and pretend the week closed. Rollback:
`automation.enabled: false` stops the pass without a downgrade; v10 is
forward-only (R8), so a bad migration is fixed forward.

### 0.7.6 — Release and compatibility close

**Status: in progress, finalised 2026-11-27 against the `v0.7.5` tree at
`81af8e3` (tag `v0.7.5`, commit `f117cdc`).** One theme (R1): close the line
honestly — make every 0.7.x tag readable as a release, settle the npm question
without publishing by default, reconcile the docs with the tagged behaviour,
and rehearse the Phase 4 cutover without flipping a default. It is a
**docs-and-release patch**: no plugin source (`src/`), schema, route, command,
tool, skill, config key, default, host peer, or dependency changes. The one
executable artifact is the Phase 4 rehearsal — `scripts/cutover-rehearsal.mjs`,
its test, the `rehearsal` npm script, and `docs/CUTOVER_REHEARSAL.md` — whose
fixture dry run is CI-safe (fake provider, scripted analyser, temporary journal)
and whose real-capture step is owner-present and opt-in; neither the script nor
the test ships in the tarball (`files` excludes `scripts/` and `tests/`). The
work is ordered A → F so one implementer can run it top to bottom; the boxed
acceptance list at the end is the definition of done for the tag.

**Measured backlog at `81af8e3` (re-verified for this revision).**

- npm: `npm view dsh-plugin-dayflow version` answers **404** — the package has
  never been published.
- GitHub: `gh release list` ends at **`v0.5.1`**. `v0.7.1`–`v0.7.5` are
  annotated tags pushed to `origin`, each with its own CHANGELOG section, and
  each with **no release**. Their release commits read `chore(release): 0.7.N`,
  while `scripts/release.mjs` writes `chore(release): v<version>` and creates
  the release itself — so the 0.7.x tags were not cut by the current tool,
  which is why the releases are missing.
- `gh auth status` reports the repository owner account with `repo` scope, so
  the backfill is one `gh release create` per tag, not a new authorisation.
- The tagged tree is green under the same gates as the rest of the line: 493
  tests, typecheck, `check:package`; 18 routes, 5 commands, schema v10.

**A. Release trail — six releases, five of them backfilled.** The target state
is one GitHub Release per 0.7.x tag whose body is that version's corrected
CHANGELOG section, plus a `v0.7.6` release created by the release tool rather
than by hand.

1. Preconditions: the docs passes from C–E are on `main` (the backfilled notes
   are extracted from the corrected CHANGELOG), the tree is clean, and
   `git fetch --tags origin` has run. Record `git tag -l 'v0.7.*'` and
   `gh release list --limit 20` in a scratch release checklist
   (`/tmp/dayflow-0.7.6-release.md`, not committed; its summary goes into the
   post-release docs commit).
2. Version guard, per tag: `git show v0.7.N:package.json` must name version
   `0.7.N` — the same rule `.github/workflows/ci.yml`'s `release-check` job
   enforces for a new tag. CI does not re-run for an old tag, so check it here.
3. Notes come from the CHANGELOG, never from memory (R6). `scripts/release.mjs`
   exports its parser, so extract the body with it rather than by hand:
   `node --input-type=module -e "import {changelogSection} from
   './scripts/release.mjs'; import {readFileSync,writeFileSync} from
   'node:fs'; const t=readFileSync('CHANGELOG.md','utf8'); for (const v of
   ['0.7.1','0.7.2','0.7.3','0.7.4','0.7.5']) writeFileSync('/tmp/v'+v+'.md',
   changelogSection(t,v)+'\n');"` — one notes file per version.
4. Create, one tag at a time: `gh release create v0.7.N --verify-tag --title
   "v0.7.N — <theme>" --notes-file /tmp/v0.7.N.md`. `--verify-tag` refuses if
   the tag is not on the remote. Themes match the tag subjects (the `v0.5.1`
   release uses the same `v<version> — <theme>` title shape):
   `v0.7.1 — analysis foundation (schema v8, consent gate, fake-adapter
   pipeline)`; `v0.7.2 — analysis worker, text-only host adapter, status route
   and panel line`; `v0.7.3 — interactive insights (review decisions, task
   session unlink)`; `v0.7.4 — text-only automation (daily/weekly briefs,
   insight pass, scheduler, schema v9)`; `v0.7.5 — scheduled memory lint,
   weekly digest, schema v10`.
5. Verify each: `gh release view v0.7.N --json tagName,name,body` — the body
   equals the CHANGELOG section, the tag is the expected one, and the newest
   release is marked `Latest`. A wrong title or body is fixed by
   `gh release delete v0.7.N --yes` and re-creating the release; the **tag is
   never deleted, moved, or re-cut**.
6. `v0.7.6` is cut by the tool: with the docs committed and only `CHANGELOG.md`
   dirty (its `## [0.7.6] - <date>` section written), run
   `npm run release -- patch` (from 0.7.5 that yields 0.7.6; `-- 0.7.6` is the
   explicit form). Do **not** pass `--no-release`. The script runs the suite,
   bumps `package.json` + the lock, commits `chore(release): v0.7.6`, creates
   the annotated tag, pushes `main` and the tag, and creates the GitHub Release
   from the CHANGELOG section. If the push or `gh release create` fails it exits
   having printed the exact manual commands; finish those instead of re-running
   the bump.
7. The six notes bodies are the record: no hand-written release summary, and no
   release is published before its CHANGELOG section is final — C runs first
   for exactly this reason.

**B. npm — a decision and a check, not a publication.** D7 (npm publication)
has **no owner answer**, so the safe default is **do not publish**: the README
stays "tagged here, not yet on the npm registry", and the line is legible as a
tag-only line only because §A gives every tag a release.

1. `npm view dsh-plugin-dayflow version` → `E404` (record the output). If it
   ever shows a version, stop: someone published, and the owner decides whether
   that was intended before anything else touches the registry.
2. `npm pack --dry-run --json > /tmp/dayflow-pack.json`, then
   `node scripts/check-package.mjs /tmp/dayflow-pack.json` (`npm run
   check:package` is the same pair). Confirm that `docs/` — including this
   file, `docs/CUTOVER_REHEARSAL.md`, `docs/ROADMAP.md` and
   `docs/NATIVE_PORT.md` — plus both READMEs, `CHANGELOG.md`, `skills/`, `lib/`,
   and `cordis.patch.yml` are in the list, and that `tests/`, `scripts/`, and
   `.github/` are not (the `files` field does not change in this patch).
3. Record the tarball file count and size next to the same numbers for
   `v0.7.5`, and confirm no dependency or peer drift:
   `git diff v0.7.5..HEAD -- package.json package-lock.json` is the version
   bump plus the `rehearsal` script line, with no dependency or peer change.
4. README/README.zh status line: version `v0.7.6`, the same "not yet on the npm
   registry" sentence. The README's deep-documentation list gains
   `docs/CUTOVER_REHEARSAL.md`. PATCH_PLAN §6 D7 and ROADMAP say the same.
5. Publishing is **out of the safe default** and never happens in an unattended
   run. If the owner authorises it in writing: review the dry-run tarball,
   confirm `repository`/`homepage`/`license`, check the token and 2FA, run
   `npm publish --access public`, and record the publish in `CHANGELOG.md` and
   the READMEs — the tag and the GitHub Release do not change.

**C. Docs reconciliation — file and sentence list.** Measured against the
committed tree at `81af8e3`. A separate docs pass was already in flight when
this revision was written (it corrects the `[0.7.4]` CHANGELOG sentence and
parts of `NATIVE_PORT.md`/`CONFIGURATION.md`/`README.md`), so every row is
**verify-or-correct**: the acceptance is the grep at the end, not who made the
edit.

1. `CHANGELOG.md`, `[0.7.4]` — at `81af8e3` the sentence read "the weekly close
   adds the weekly reflection, the weekly review pass, and the memory lint
   summary." The tagged tree closes a week with exactly one brief
   (`briefs(kind='week')`) and no weekly reflection, and the lint and its digest
   landed in 0.7.5. Keep the corrected text: one stored week brief, no weekly
   reflection, no weekly review pass, with the lint described in `[0.7.5]`.
2. `docs/NATIVE_PORT.md`, Phase 3 ("Insights pass", committed line ~609) —
   "The weekly close adds the weekly reflection and the weekly review pass."
   Replace with: the weekly close writes one text-only brief and adds no weekly
   reflection; the memory lint is the separate 0.7.5 pass below.
3. `docs/NATIVE_PORT.md`, the architecture diagram's `WeeklyClose` block —
   verify it names the weekly brief and the 0.7.5 digest and **no** weekly
   reflection (at `81af8e3` it read "weekly reflection + review items + memory
   promotion rules"; the in-flight pass rewrites it).
4. `docs/NATIVE_PORT.md`, §4 migration shapes and the "Migration order on the
   0.7.x line" paragraph — verify v8 `analysis_jobs` (0.7.1), v9
   `automation_runs` + `briefs` (0.7.4: two `job` values, five statuses, both
   brief kinds), v10 rebuild (0.7.5: three `job` values,
   `briefs.payload_json`, `tableHasColumn`, "not a new table"). Already correct
   at `81af8e3`; keep the shipped shape, not the draft, and do not renumber.
5. `docs/CONFIGURATION.md` — two stale sentences: "both write day or week
   reflections" (only the day close writes a reflection; the weekly close
   writes one brief) and the `analysis.dailyTokenBudget` row's "hard
   enforcement lands in 0.7.3" (it never landed; the token cap is reported-only
   and a 0.8.0 candidate). Verify the key table against `src/config.ts` while
   there.
6. `docs/TOOLS.md` — the review-queue section says the queue lives in the
   journal "(schema version 7)"; the review-items table is owned schema **v3**
   (the journal is v10 now). Say "the review-items table (owned schema v3,
   journal v10)" or drop the number, and confirm the 23-tools / 8-skills lists
   still match `src/tools/` and `skills/`.
7. `docs/ARCHITECTURE.md` — verify owned schema version 10, the
   `automation/lint.ts` write-path paragraph, the `briefs/` + `automation/`
   layout row, and the 493-test line. Already correct at `81af8e3`.
8. `docs/PANEL.md` — verify the exact route set (18 host Fetch routes: 9 GET +
   9 POST), the one-entry rule, the three 0.7.3 POSTs, the automation GET, and
   the close line; the digest stays in `briefs` and adds no panel surface.
9. `README.md` / `README.zh.md` — "Quick capture: three slash commands" reads as
   if the plugin had three commands, but `DAYFLOW_COMMAND_NAMES` has five (the
   three quick-capture ones plus `/dayflow-analyze` in 0.7.2 and
   `/dayflow-run-close` in 0.7.4). Say five and keep the three as the
   quick-capture subset; scope the same sentence in `docs/QUICK_CAPTURE.md`
   ("the plugin registers three commands") to the journal-writing commands.
10. `README.md` / `README.zh.md`, native-capture section — "day/week
    reflections" from the automation close: the insight pass writes one **day**
    reflection and the weekly close writes the brief; a week reflection can only
    be written by the agent or the user through `journal_reflection`. Reword the
    automation sentence to "the day's reflection" — a later README bullet may
    still say "day/week **reflections**" for the store, because the tool really
    does support both kinds; the claim that has to be exact is the one about
    what the close writes.
11. `README.md` / `README.zh.md` status line and `docs/ROADMAP.md` — version
    `v0.7.6`, "not yet on the npm registry", and the 0.7.6 row/paragraphs as
    landed after §A's tag; `docs/CUTOVER_REHEARSAL.md` linked from the README's
    deep-documentation list, and the test-count lines in README,
    `docs/ARCHITECTURE.md`, `docs/CUTOVER_REHEARSAL.md` §2, and §1 here updated
    to the tag's actual `npm test` total (493 at `81af8e3` plus the rehearsal
    case).
12. Deferred items — skipped-window catch-up, the token cap as a post-call
    gate, and the 04:00 day tail stay **0.8.0 candidates by default** in every
    doc (PATCH_PLAN §6, ROADMAP, NATIVE_PORT); confirm no doc promises them on
    the 0.7.x line, and that image admission (pixels + the attachment peer) is
    also stated as 0.8.0 material.
13. Compatibility statement — README (and README.zh) and
    `docs/ARCHITECTURE.md` state the DSH peer cohort (dev `0.2.1-rc.2`, peers
    `^0.2.0-rc.2`, supported releases `0.2.0-rc.2`/`0.2.1-rc.2`) and that the
    0.7.x line added **no** host peer: `@deepseek-ai/dsh-llm` was declared before
    the line and is used through the structural seam, and
    `@deepseek-ai/dsh-attachment` was never added because pixels are 0.8.0
    material. Verify the statement is present and true after the docs pass; it
    is the compatibility close the patch's name promises.
14. This file after the tag: §1's head/tests rows, §3.1's 0.7.6 row, §0.7.6's
    status line, §6's D7/standing paragraph, and ROADMAP's status head,
    Patch-iterations row, and Phase 4 sentence — set to "released" with the
    tag, the six release URLs, and the final counts, in the post-release docs
    commit the acceptance names.

Acceptance greps (all must be empty or exactly the stated value before the
tag; each has to allow the *negated* forms, so they target the positive claim):

```sh
grep -rn "adds the weekly reflection\|the weekly reflection and the weekly review" \
  CHANGELOG.md docs/NATIVE_PORT.md README.md README.zh.md                                      # empty
grep -rn "both write day or week reflections" docs/CONFIGURATION.md                            # empty
grep -rn --exclude=PATCH_PLAN.md "lands in 0.7.3" docs/                                        # empty
grep -rn "schema version 7" docs/TOOLS.md                                                      # empty
grep -c "PATH" src/panel-contract.ts                                                           # 18
sed -n '/DAYFLOW_COMMAND_NAMES = \[/,/\] as const/p' src/commands.ts                           # five entries
```

The reflection rows are checked by reading, not only by grep: the 0.7.x close
writes exactly one day reflection and no week reflection, so each "weekly
reflection" hit left in the tree must be a negation ("no weekly reflection") or
the manual `journal_reflection` action, never a claim about the close.

**D. Phase 4 cutover rehearsal — one written checklist, no flipped default.**
The deliverable is `docs/CUTOVER_REHEARSAL.md` plus its executable partner
`npm run rehearsal` (`scripts/cutover-rehearsal.mjs`, spawned by
`tests/cutover-rehearsal.test.ts`, so the suite exercises it; neither ships in
the tarball). It is a rehearsal, not the cutover: the default `source: owned`
flip is **not** part of 0.7.6. It is 0.8.0 (native preview), with 1.0.0 after a
real week of capture without data loss (`NATIVE_PORT.md` §8 Phase 4). 0.7.6
flips no default, and the file must say so in its first paragraph.

Required contents (the acceptance checks each one exists):

1. **Scope and consent.** Which steps are fixture-only (CI-safe: no screen
   permission, no network, no model) and which need the owner present. Defaults:
   `analysis.consent: 'local'` or `'none'`; `cloud` is **not** exercised without
   D1 and the owner, and no screenshot, window title, or image leaves the
   machine in the fixture run.
2. **Fixture dry run (the executable part).** `npm run rehearsal` (after
   `npm run build`; exit code 2 with a build hint when `lib/` is missing) works
   inside one throwaway `mkdtemp` directory with a fresh journal,
   `FakeCaptureProvider`, and a scripted analyser, then walks the native chain
   (capture engine → analysis pipeline → day close → day insights → weekly lint
   → weekly brief) and reopens the journal to prove nothing was lost. It prints
   one PASS/FAIL row per check with `observed | expected`, then a count block:
   screenshots, frame files (4 before analysis, 0 after `keepFramesDays: 0`),
   activities, observations, `analysis_jobs`, standup entries, `briefs` with
   `payload_json.memory_health`, reflections (day only, **no** week reflection),
   review items inside the caps, `automation_runs` (including the `lint` row),
   long-task sessions, and `memory_claims` — whose count must not move (the lint
   never writes a claim) — plus the fake-adapter call count. The file records the
   exact command, the date, and that run's counts. Idempotency is proven by the
   existing suite (`automation-insights`, `briefs`, and `automation-lint` assert
   a second close is `already-written` with no model call) rather than by a
   second scripted pass.
3. **Fresh-profile real rehearsal (owner present, opt-in).** A fresh profile
   from a checkout with `capture.enabled: true` and `consent: 'local'` (or
   `'none'` for capture-only); grant Screen Recording in System Settings when
   macOS asks (the one step CI cannot do); one real day of capture; the
   next-morning close at `automation.dailyAt` or `/dayflow-run-close`; then open
   the panel. Record the permission state, frames captured, cards rendered, and
   whether the close's model call happened. **Do not run real capture without
   the owner at the machine and their explicit go-ahead for that motion**; if
   they are unavailable, record "real-capture step: not run (owner
   unavailable)" — the fixture part still makes the rehearsal useful for 0.8.0
   planning, but it does not authorise a cutover.
4. **Pass/fail checklist**, one row each with its pass criteria: permission
   (route/panel reports granted; denied or revoked skips, never fails); frames
   (first frame arrives, dedupe and retention behave, `keepFramesDays: 0`
   deletes only after a successful analysis); cards (activities/observations
   written for the day, replay a no-op, skipped windows terminal and visible);
   standup and brief (one standup entry, one `briefs(kind='week')` with the
   digest, no weekly reflection); day reflection (exactly one, written by the
   insight pass); queue (proposals bounded by the caps, suppression honoured, no
   memory claim written by automation — D9); lint (one
   `automation_runs(job='lint', day=<Monday>)` row, proposals only, digest in
   the brief, `memory_claims` untouched); restart (stop/start the host: same
   close rows, no duplicate briefs, completed jobs not replayed); data loss (any
   row count lower after the rehearsal than before is a **blocking finding for
   0.8.0**, written down rather than explained away); default (a default profile
   with capture off and consent `none` still runs nothing: no frames, no calls,
   no close rows).
5. **Recording format.** The file's record table carries one row per run:
   date, commit, Node version, permission, frames, cards, brief, reflection,
   proposals, restart-loss, verdict, plus operator, macOS version, the command
   used, and a "deviations" paragraph. `Restart-loss` is "none" only when every
   count matches before and after the reopen; anything else blocks 0.8.0. The
   file ships in the tarball (`docs/` is already in `files`) and is linked from
   the README's deep-documentation list.

**E. Config-defaults audit — 0.7.0 → 0.7.5.** Measured with
`git diff v0.7.0..v0.7.5 -- src/config.ts`: 47 insertions, 4 deletions — three
new keys plus the `resolvePauseApps` → `resolveStringList` extraction. **No
existing default changed**, and `cordis.patch.yml` is byte-identical between the
two tags, so a fresh profile's bundle block is unchanged. The full audit is
`docs/CUTOVER_REHEARSAL.md` §7's per-key table; this summary is the invariant to
verify against it:

| Key | Default | Range | Landed | Why it is safe / decision | Inert on a default profile? |
| --- | --- | --- | --- | --- | --- |
| `analysis.intervalMinutes` | 5 | 1–60 | 0.7.2 | cadence, no egress decision; the worker mounts only with capture + analysis + host `llm` | yes — capture is off |
| `analysis.localProviders` | `[]` | provider ids | 0.7.1 | D1 safety: empty means no provider is trusted as `local` | yes — consent is `none` |
| `automation.catchUpDays` | 2 | 1–30 | 0.7.4 | D4 bounded catch-up; a day older than the window is `skipped`, never fabricated | yes — automation does not mount |
| every other key | unchanged from 0.7.0 | unchanged | 0.7.0 | — | `source: dayflow`, capture off, consent `none`, memory context budgeted |

Acceptance for the audit: each new key is either an explicit owner decision
(D1/D4) or a pure cadence/limit knob; no default changed; the resolved-defaults
fixture (`tests/capture-state.test.ts`) agrees with the table; and the table
(with the diff command and date) is recorded in `docs/CUTOVER_REHEARSAL.md` or
the release checklist (it is already written into `docs/CUTOVER_REHEARSAL.md`
§7; verify it against the diff and extend it only if a key is missing). A
default change that is not explained is a **blocking finding for the release**,
not for 0.8.0. The same pass confirms
`git diff v0.7.5..HEAD -- package.json package-lock.json` is the version bump
plus the `rehearsal` script line, and that the whole line added no dependency or
peer: the `llm` peer was declared before 0.7.0 and
`@deepseek-ai/dsh-attachment` was never added.

**F. CI, package, and release gates.** No new job, dependency, or peer: the
patch is docs and the version bump, and the existing suite runs it.

- Local, before the release commit: `npm test` (493 at `81af8e3` plus the
  rehearsal case, so the tag's own total is what the docs record),
  `npm run typecheck`, `npm run check:package`, and `npm run rehearsal` exiting
  0 with every check PASS — the same gates every patch uses, with the rehearsal
  added because this patch owns its record.
- On `main` and on the tag: `.github/workflows/ci.yml` runs macOS 15 with Node
  22 (`NODE_OPTIONS=--experimental-sqlite`) and Node 24, each running
  `npm test` and the `Check the package contents` step (`npm pack --dry-run
  --json` + `scripts/check-package.mjs`). Both legs must be green.
- The `release-check` job (tags only) refuses a tag that is not `v<package.json
  version>`; `v0.7.6` must pass it. The five backfilled tags never ran it (CI
  does not re-run for an old tag), which is why A.2 checks the same rule
  locally.
- Post-release record: the six release URLs, the `npm view` 404 output, the
  `check:package` tarball file count next to 0.7.5's, and the two CI run URLs
  (main commit and tag) go into the release checklist, whose summary rides the
  post-release docs commit.

**Acceptance.** The patch is done when every box holds and the evidence is in
the release checklist; the post-release docs commit is the last step.

- [ ] Six tags exist (`v0.7.1`–`v0.7.6`) and each has a GitHub Release whose
      body is that version's CHANGELOG section, created with `--verify-tag`;
      the five backfills are recorded with their URLs and dates in the release
      checklist and summarised in the post-release docs commit.
- [ ] `v0.7.6` was cut by `npm run release -- patch` (not by hand): the
      `chore(release): v0.7.6` commit and annotated tag exist, and the
      `release-check` job is green on the tag.
- [ ] The version guard passes for all six tags: `git show v0.7.N:package.json`
      names `0.7.N`.
- [ ] npm state is unambiguous: `npm view dsh-plugin-dayflow version` is 404
      **and** README/README.zh, ROADMAP and §6 D7 all say "tagged, not on the
      npm registry" with `v0.7.6`; no publish happened without the owner's
      written authorisation.
- [ ] `npm run check:package` is green and the tarball contains `docs/`
      (including `PATCH_PLAN.md`, `ROADMAP.md`, `CUTOVER_REHEARSAL.md`,
      `NATIVE_PORT.md`), both READMEs, `CHANGELOG.md`, `skills/`, `lib/`, and
      `cordis.patch.yml`; `tests/`, `scripts/`, and `.github/` are absent; file
      count and size are recorded next to 0.7.5's.
- [ ] The C greps are clean: no positive "weekly reflection"/"weekly review
      pass" claim (only negations or the manual action), no "both write day or
      week reflections", no "lands in 0.7.3", no "schema version 7" in
      `TOOLS.md`, 18 panel paths, five command names; and the README/
      ARCHITECTURE peer-cohort statement (no host peer added on the line) is
      present and true.
- [ ] `docs/CUTOVER_REHEARSAL.md` exists with the fixture run's date and the
      counts per stage, the pass/fail checklist, the record table, and the "no
      default flip" statement; `npm run rehearsal` exits 0 with every check PASS
      on the release commit; any data-loss finding is recorded as blocking for
      0.8.0.
- [ ] The config-defaults audit is recorded with its diff command; no default
      changed 0.7.0→0.7.5 beyond the three explained keys; no dependency or
      peer changed on the line.
- [ ] CI is green on both Node legs for the release commit and the tag; the
      post-release docs status commit updates §1, §3.1, §0.7.6, §6, ROADMAP's
      status head / Patch iterations / Phase 4 line, and the README status line
      to "released".

**Dependencies and owner decisions.** D7 (publish or stay tagged): **no
answer**, so the safe default and the plan are "stay tagged, do not publish" —
the release trail does not wait for it. D1 (whether cloud consent is exercised
in the rehearsal): default **no**; the rehearsal uses `local` or `none`, and a
`cloud` step would need the owner and the 3.6 copy in place. Everything else is
mechanical: the release tool's version guard, the CHANGELOG parser, and
`check:package` already exist.

**Risks and rollback.** Publishing is the one irreversible action, so it is
gated on a written owner decision and never runs unattended; the default path
publishes nothing. A backfilled release with wrong notes is fixed by deleting
and re-creating the **release** (`gh release delete`, then `gh release
create`), never by moving the tag — a pushed tag is immutable, and the version
guard plus the CHANGELOG parser make a wrong body unlikely. A release script
that fails after the tag push prints its manual completion commands; finishing
them is safer than re-running the bump, which would find the tag taken. Docs
drift is the second risk, mitigated by the C greps and the post-release status
commit. The rehearsal writes only temporary/fixture data by default; a real
capture is owner-present, opt-in, and a data-loss finding blocks 0.8.0 rather
than being explained away. Rollback for the docs themselves is a revert; a tag
is forward-only (the spirit of R8 applied to releases).

## 4. Definition of Done (every patch)

Before a patch is tagged, all of these hold. They are the same for all six
patches; a patch's section adds only its own assertions.

- [ ] `npm test` is green: the existing cases still pass and the patch's new
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
- [ ] A new host-service seam (the 0.7.2 `llm` adapter) has a structural seam, a
      fake or scripted implementation, and a zero-network test; CI still never
      calls a model (R4).
- [ ] A new scheduled loop (worker, scheduler) has a double-start test, a
      cleanup test on its timer seam, and a tick that never throws into the
      host.
- [ ] A new route or panel surface extends the existing exact route-set and
      single-entry tests deliberately; it does not add a second entry (R9).
- [ ] Rollback is stated: the config switch that disables the feature, and
      whether the schema moved (R8).
- [ ] `docs/ROADMAP.md` remain lines change only for work that actually landed.
- [ ] The patch's own section here is updated if reality diverged (the plan is
      the record; silently diverging is how a plan becomes fiction).
- [ ] Release closure (0.7.6 only): the six 0.7.x tags each have a GitHub
      Release whose body is the CHANGELOG section; the npm state is either a 404
      or an owner-authorised publish, and the READMEs say which; the cutover
      rehearsal checklist and the config-defaults audit are on file; and the
      release changed no plugin source (`src/`), schema, route, config key, or
      default — its only executable additions are the repo-side rehearsal script
      and test, which do not ship.

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
   interleaving a second workstream into the same modules. It is also why the
   skipped-window catch-up policy is not in 0.7.2: that would add a second
   state-machine workstream (with a money decision behind it) to the first patch
   that can spend real money. It was re-triaged in the 0.7.3 window, stays out
   of 0.7.4 and 0.7.5, and is a 0.8.0 candidate by default (see
   0.7.3), not hidden scope in the panel patch.
3. **Lint after automation.** The lint pass reuses the 0.7.4 scheduler and
   `automation_runs`; building it earlier would have meant a second timer and a
   second bookkeeping path, which this line exists to avoid. 0.7.5 is therefore
   one theme (the scheduled lint and its digest), not two.
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
| D2 | **Provider and model** for analysis | Cost, latency, and which vendor sees the frames | No implicit host default: `analysis.provider` + `analysis.model` must be set explicitly; empty means "not configured" and jobs are `skipped`. 0.7.1 shipped exactly this and 0.7.2's adapter sends the configured pair, so the decision is settled unless the owner wants host defaults | 0.7.1 (settled) |
| D3 | **Daily budget**: calls and tokens | A runaway loop is a bill, not a bug | 120 calls / 200k tokens per day, shown in status and read from the jobs ledger; the call cap has been a gate since 0.7.1, 0.7.2 surfaces both numbers, and the token cap is still reported-only through 0.7.5 (a post-call gate stays a 0.8.0 candidate; 0.7.5 kept a single theme) | 0.7.2 |
| D4 | **Catch-up window** after the machine was off | Closing ten missed days at once is noise and cost | Finalised as the new `automation.catchUpDays` key: an integer 1–30, default **2**, counting back from the due day; older days are marked `skipped`, never fabricated | 0.7.4 |
| D5 | **Frame retention** after analysis | Debuggability versus leaving screenshots on disk | `keepFramesDays: 0` deletes a frame after its successful analysis; 1–7 days is the debugging alternative | 0.7.1 |
| D6 | **Suppression management surface** | A hard-suppressed idea must be clearable somewhere | Agent-only in 0.7.x (`journal_review` unsuppress); a panel list is a later patch | 0.7.3 |
| D7 | **npm publication** | Publishing is hard to undo | **Unanswered as of this revision, so 0.7.6 does not publish.** Stay "tagged, not on the npm registry" (the README already says so); publish only on explicit authorization with a reviewed `npm pack`, and the 0.7.6 checklist keeps a publish as an optional step after the release trail | 0.7.6 |
| D8 | **Lint finding destination** | A finding is only useful if it is seen, and only trustworthy if it is not auto-"fixed" | Weekly digest plus at most one proposal per claim per week; no automatic supersede or forget | 0.7.5 (landed) |
| D9 | **Automatic memory writes** | The product rule is "the agent may notice, only the user may decide" | Automation proposes into the queue; claims are written only through the existing kept-item promotion path. 0.7.4 ships exactly this: its insight pass never writes a claim | 0.7.4 |

**Where the decisions stand after 0.7.5, with 0.7.6 in progress as the only
patch left.** D2 is settled as the explicit provider/model rule above; D5's
landed behaviour is delete-after-success at `keepFramesDays: 0`, with the engine
sweep as the fallback; D1 remains unanswered, which keeps the line inert by
default
(`consent: none`, capture off). D3's caps are configured and the call cap is
enforced; 0.7.2 made the ledger visible (both call and token numbers) and left
the token number reported-only, and 0.7.4 does not change that — a post-call
token gate stays a 0.8.0 candidate. D6's safe default is what 0.7.3
shipped: the panel decides items, and a hard suppression is cleared only through
the agent's `journal_review` `unsuppress` action — there is no panel suppression
list in 0.7.x. **D4 and D9 are finalised by the 0.7.4 section:** catch-up is
bounded by `automation.catchUpDays` (1–30, default 2) with older days `skipped`,
and automation writes no memory claim — proposals only, through the existing
kept promotion path. D8 (lint destination) was taken by 0.7.5's safe default and
landed (proposals plus the weekly digest); D7 (publish) has no answer, so
0.7.6's safe default is **no publish** — the release trail is backfilled and the
tarball checked without it, and a written authorisation would add a publish step
(reviewed tarball, token), not change the plan. The three analysis-ledger
follow-ups (skipped-window catch-up, the token gate, the 04:00 day tail) are
**0.8.0 candidates by default** — the owner has not answered, and 0.7.5
intentionally kept one theme.

Two constraints that are not decisions: the privacy limitation copy from
Roadmap 3.6 (a paused app's window is skipped, but nothing can tell what is
inside a browser tab) must exist before cloud consent (D1 = `cloud`) is ever
enabled; and `capture.pauseApps` already skips capture of those apps entirely,
which is stronger than redaction. 0.7.2 is the first patch that can exercise a
`local` or `cloud` consent for real, so it ships that limitation in both locales
next to the analysis line, adapted to the text-only contract (app name, window
title, and frame hash leave the machine; no image is sent). 0.7.4's close jobs
reuse the same analysis consent through a pure text gate and add no new egress:
activity text only — never frames, window titles or images — so the 3.6
pixel-redaction status does not change. Phase 3.6's `privacy_apps` redaction list is
**not** scheduled on the 0.7.x line: it is only meaningful once pixels are
admitted, which is a 0.8.0 candidate — and if image admission is taken, the
`privacy_apps` list and the full limitation copy ship with it, not silently.

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
   Release. For 0.7.6, backfill the five older releases from the corrected
   CHANGELOG **before** cutting the tag (§0.7.6 A); a tag is never re-cut, so a
   missing release is added, not re-tagged.
7. Update the status column here and, only for work that landed, the roadmap's
   remain lines.

If a patch discovers its theme cannot ship default-safe, it stops at step 3 and
the blocking decision moves into §6 — the patch does not ship with a default
that changes behaviour without the owner's answer.
