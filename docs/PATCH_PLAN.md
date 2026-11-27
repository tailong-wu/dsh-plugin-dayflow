# Patch plan: the 0.7.x line

> **Status:** revised 2026-11-27 against `v0.7.1` (tag `v0.7.1`, commit
> `0256a64`). **0.7.1 has landed**, so its section records what actually
> shipped, and **0.7.2 is finalised below** for implementation; 0.7.3–0.7.6
> remain planned. Six patches, 0.7.1–0.7.6: each one theme, one integration
> point, one tag. This is a decision-level plan, not a commitment of dates.
> Every patch below is shippable under the safe default of the decisions in
> [§6](#6-owner-decisions-and-safe-defaults), so no patch waits on an answer.
> The revision before this one was written against `v0.7.0` (tag `v0.7.0`,
> commit `45a7e42`); its scope survives unchanged except where 0.7.1 reality
> corrected it.
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
| Baseline | `0.7.0`, annotated tag `v0.7.0` (commit `45a7e42`), the phase baseline this plan was first written against | `package.json`, `git tag` |
| Current head | `0.7.1`, annotated tag `v0.7.1` (commit `0256a64`), **not** on the npm registry, **no** GitHub Release | `package.json`, `git tag`, `npm view dsh-plugin-dayflow` → 404, `gh release view v0.7.1` → not found |
| Tests | 384 cases, green on the 0.7.1 tree (`node --test` ran them all); CI runs them on macOS 15 with Node 22 (`--experimental-sqlite`) and Node 24 | `tests/*.test.ts`, `.github/workflows/ci.yml` |
| Tools | 23 registered by default (17 with `edits: false`), plus `dayflow_install_dayflow` behind `allowInstall: false`; 0.7.1 added no tool | `src/index.ts`, `src/tools/` |
| Skills | 8 | `skills/` |
| Panel | 13 exact host Fetch routes, one UI entry (one header button, one panel tab); 0.7.2 adds exactly one read-only GET | `src/panel-contract.ts`, `tests/panel.test.ts` |
| Owned schema | v8 (`analysis_jobs`), landed in 0.7.1; v7 was the 0.7.0 baseline; 0.7.2 makes **no** schema change | `src/journal.ts` → `JOURNAL_SCHEMA_VERSION` |
| Native port | Phase 0 (provider + Swift helper) and Phase 1 (capture engine) landed in 0.7.0, both default-off; Phase 2's foundation (five `src/analyse/` modules, schema v8, consent gate, fake-adapter pipeline, text-only contract) landed in 0.7.1, with **no worker, timer, status route, panel line, command, or real provider call** | `src/capture/`, `src/analyse/`, `docs/NATIVE_PORT.md` |
| Release tool | `npm run release -- patch` bumps, runs the suite, commits, tags, pushes, creates the GitHub Release; it does **not** publish to npm. 0.7.1 was tagged without a GitHub Release, so 0.7.6 must create it by hand | `scripts/release.mjs` |
| Host cohort | DSH `0.2.1-rc.2` dev dependencies, `^0.2.0-rc.2` peers; `@deepseek-ai/dsh-llm` is already declared but no code calls `ctx.llm` until 0.7.2; `@deepseek-ai/dsh-attachment` is **not** a dependency (0.7.1 stayed text-only and so does the rest of the line) | `package.json`, `npm ls`, `src/analyse/` |

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
that is in the 0.7.2 section below.

**Not landed, and what this plan is:** the rest of native port Phase 2 and its
visibility (0.7.2: worker/timer, status route, panel line, manual command,
budget surface, real text-only provider adapter), briefs and automation
(Phase 3, 0.7.4), interactive panel management (0.7.3), the scheduled lint job
(0.7.5), and the release closure (0.7.6: npm, GitHub Releases, cutover
rehearsal).

**Deliberately not in 0.7.x:** the Phase 4 default cutover (0.8.0 material), the
month/week panel goal and rating surfaces, editing tools for the owned journal,
the `dsh dayflow import` CLI (only the tool exists), embeddings, the
`review.cards` switch (the plugin has no card stack, so it has no surface),
image admission (pixels need a host attachment peer and a vision contract;
0.8.0 candidate), automatic catch-up for skipped analysis windows (the 0.7.2
section below; 0.7.3 candidate), Phase 5, and any change to the Swift helper's
permissions.

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
| 0.7.1 | **landed** — Analysis foundation: frames become `activities` rows behind a fake adapter | Native port Phase 2 | — | D1, D2, D5 | Medium |
| 0.7.2 | **finalised** — Analysis visible: worker timer, text-only host adapter, status route and panel line, budget ledger, manual command; no schema change | Native port Phase 2 | 0.7.1 | D1, D3 | Medium |
| 0.7.3 | Interactive insights: decide review items, attach/detach task sessions in the panel | Phase 3.5 / 3.7 remain | — (built against 0.7.2 tree) | D6 | Low |
| 0.7.4 | The day closes itself: briefs, reflection, proposals, task sessions, weekly close | Native port Phase 3 | 0.7.2, 0.7.3 | D3, D4, D9 | High |
| 0.7.5 | Scheduled memory lint and weekly digest | Phase 4 lint remain | 0.7.4 | D8 | Medium |
| 0.7.6 | Release and compatibility close | Release closure / Phase 4 rehearsal | 0.7.1–0.7.5 | D1, D7 | Low |

Order rationale: see [§5](#5-sequencing-rationale). Nothing in the table changes
the plugin's default behaviour; each new path is off by default or requires
consent, and that is part of every patch's acceptance. This revision finalises
the **0.7.2** scope below against what 0.7.1 actually shipped: text-only, no
schema change, one new GET route, one new config key, and skipped analysis jobs
stay terminal (catch-up deferred, with its cost stated).

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
  below.
- **The token budget is recorded, not yet enforced.** `analysis_jobs` carries
  `input_tokens`/`output_tokens` and `analysisTokenTotalsForDay` reads them, but
  only `maxCallsPerDay` is a gate in 0.7.1; 0.7.2 makes the ledger visible and
  leaves the token cap reported-only (a post-call check is a 0.7.3-window
  candidate). The `@deepseek-ai/dsh-llm` peer is already declared but no code
  calls `ctx.llm` yet; 0.7.2 adds the adapter.

The suite is 384 tests green on the tagged tree, and `npm run typecheck` /
`npm run check:package` are green; the 0.7.1 CHANGELOG section is the record of
what shipped.

### 0.7.2 — Analysis visible: worker, status, budget

**Status: finalised for implementation, 2026-11-27 (revised after 0.7.1
landed).** The scope is the one below: **text-only, no schema change, no new
host peer**, one new config key, one new GET route, and — decided — **no re-run
of 0.7.1's skipped jobs** (see the decision near the end of this section).

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
- **Where it goes:** a 0.7.3 candidate, to be planned with the same one-theme
  discipline: either an explicit second deliverable of that patch (an owner
  decision that deliberately relaxes R1) or a small patch of its own between
  0.7.3 and 0.7.4; if neither, it becomes 0.8.0 scope. The decision is taken when
  0.7.2 closes, with the dogfooding evidence in hand.

**Other ledger gaps kept out of 0.7.2.** Two analysis-loop items are knowingly
not in this patch, so no deliverable above silently promises them:

- **The token cap is reported, not enforced.** `dailyTokenBudget` and
  `tokensToday` are honest ledger numbers, but only `maxCallsPerDay` stops a run
  (0.7.1's gate). Enforcing tokens needs a post-call check because usage arrives
  with the answer, and it is a cost-policy decision rather than a visibility
  one: it is a 0.7.3-window candidate beside catch-up.
- **The 04:00 day tail.** A worker tick runs the current Dayflow day, so a frame
  captured just before the boundary after the previous day's last tick is not
  analysed (its windows belong to the previous day). The fix costs one bounded
  extra `run()` on the first tick after the boundary or on start; it is deferred
  with catch-up so one patch settles "what may be run late or re-run" once.

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
   migration in the diff.
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

**Deferred from 0.7.2 (candidate here).** A **skipped-window catch-up** policy is
the first candidate to plan in this window: when consent, an unset
provider/model, or a cap is fixed, requeue the affected `skipped` windows for a
bounded range (today and the previous day are enough for dogfooding), with a
per-reason policy — transient configuration reasons yes, the attempts-cap
`failed` rows and `budget` skips (a money decision, D3) only with an explicit
owner choice. 0.7.2 deliberately does not do it (its section explains the cost),
so adopting it here is either an **explicit second deliverable** of this patch
(relaxing R1 on purpose) or a small patch of its own between 0.7.3 and 0.7.4;
if neither is taken, it becomes 0.8.0 scope. The same window is where the two
other analysis-ledger follow-ups fit, so one decision settles all three: the
**token cap as a gate** (post-call check) and the **04:00 day tail** (one bounded
extra run on the first tick after the boundary). The decision is taken when
0.7.2 closes. Image admission is **not** a candidate here: pixels need a host
peer and a vision contract and stay a 0.8.0 item.

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
- Panel: the status block grows a close-state segment next to the 0.7.2
  analysis line ("day closes at 04:00; last close day/status") — still one line
  in the insights view, no new surface.
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
(no per-job decision is needed for this patch), proposals-only memory. The close
line and the cost reporting read 0.7.2's status route and `analysis_jobs`
ledger; the D4 catch-up here is about missed **close jobs**
(`automation_runs`), not a replay of analysis-ledger skips (0.7.2's skipped
decision, deferred to the 0.7.3 window).

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
  section. `v0.7.1` is tagged but had **no** GitHub Release on 2026-11-27, so
  this patch backfills it by hand; the same rule covers any tag cut with
  `--no-release`.
- npm: a publication checklist, not a publication. `npm pack --dry-run` and
  `check-package.mjs` already gate the file list; confirm the registry name is
  still free, that `docs/` (including this plan) ships in the tarball, and that
  the tag/version guard in `ci.yml` protects the tag. `npm publish` happens only
  under D7 authorization; otherwise the README stays "tagged here, not yet on
  the npm registry".
- Docs reconciliation: README/README.zh status line, `docs/ROADMAP.md` status
  and phase remain lines, `docs/NATIVE_PORT.md` phase statuses, the v8/v9/v10
  numbering, and its "images stay text-only until 0.7.2" sentence (the contract
  is text-only for the whole 0.7.x line; image admission is 0.8.0 material),
  `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `docs/PANEL.md`,
  `docs/TOOLS.md` if the surface changed, the deferred analysis-ledger items
  (skipped-window catch-up, the token gate, the 04:00 tail) as shipped or still
  deferred, and this file's status column updated to what actually shipped.
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
  that the 0.7.x line added **no** host peer: analysis stays text-only (the
  `llm` peer was already declared) and image admission, which would need
  `@deepseek-ai/dsh-attachment`, is 0.8.0 material.

**Acceptance.**

1. Six tags exist (`v0.7.1`–`v0.7.6`), each with a GitHub Release whose notes
   match its CHANGELOG section (the `v0.7.1` release is backfilled by hand);
   the tag version guard passes on each.
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
   that can spend real money, so it waits for the 0.7.3 window or 0.8.0.
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
| D2 | **Provider and model** for analysis | Cost, latency, and which vendor sees the frames | No implicit host default: `analysis.provider` + `analysis.model` must be set explicitly; empty means "not configured" and jobs are `skipped`. 0.7.1 shipped exactly this and 0.7.2's adapter sends the configured pair, so the decision is settled unless the owner wants host defaults | 0.7.1 (settled) |
| D3 | **Daily budget**: calls and tokens | A runaway loop is a bill, not a bug | 120 calls / 200k tokens per day, shown in status and read from the jobs ledger; the call cap has been a gate since 0.7.1, 0.7.2 surfaces both numbers, and the token cap becomes a gate in the 0.7.3 window | 0.7.2 |
| D4 | **Catch-up window** after the machine was off | Closing ten missed days at once is noise and cost | At most the last two days; older days are marked `skipped`, never fabricated | 0.7.4 |
| D5 | **Frame retention** after analysis | Debuggability versus leaving screenshots on disk | `keepFramesDays: 0` deletes a frame after its successful analysis; 1–7 days is the debugging alternative | 0.7.1 |
| D6 | **Suppression management surface** | A hard-suppressed idea must be clearable somewhere | Agent-only in 0.7.x (`journal_review` unsuppress); a panel list is a later patch | 0.7.3 |
| D7 | **npm publication** | Publishing is hard to undo | Stay "tagged, not on the npm registry" (the README already says so); publish only on explicit authorization with a reviewed `npm pack` | 0.7.6 |
| D8 | **Lint finding destination** | A finding is only useful if it is seen, and only trustworthy if it is not auto-"fixed" | Weekly digest plus at most one proposal per claim per week; no automatic supersede or forget | 0.7.5 |
| D9 | **Automatic memory writes** | The product rule is "the agent may notice, only the user may decide" | Automation proposes into the queue; claims are written only through the existing kept-item promotion path | 0.7.4 |

**Where the decisions stand after 0.7.1.** D2 is settled as the explicit
provider/model rule above; D5's landed behaviour is delete-after-success at
`keepFramesDays: 0`, with the engine sweep as the fallback; D1 remains
unanswered, which keeps the line inert by default (`consent: none`, capture off).
D3's caps are configured and the call cap is enforced; 0.7.2 makes the ledger
visible (both call and token numbers) without turning the token number into a
gate yet — that needs a post-call check and is a 0.7.3-window candidate.

Two constraints that are not decisions: the privacy limitation copy from
Roadmap 3.6 (a paused app's window is skipped, but nothing can tell what is
inside a browser tab) must exist before cloud consent (D1 = `cloud`) is ever
enabled; and `capture.pauseApps` already skips capture of those apps entirely,
which is stronger than redaction. 0.7.2 is the first patch that can exercise a
`local` or `cloud` consent for real, so it ships that limitation in both locales
next to the analysis line, adapted to the text-only contract (app name, window
title, and frame hash leave the machine; no image is sent). Phase 3.6's `privacy_apps` redaction list is
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
   Release.
7. Update the status column here and, only for work that landed, the roadmap's
   remain lines.

If a patch discovers its theme cannot ship default-safe, it stops at step 3 and
the blocking decision moves into §6 — the patch does not ship with a default
that changes behaviour without the owner's answer.
