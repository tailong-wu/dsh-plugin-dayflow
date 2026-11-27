# Patch plan: the 0.8.x line

> **Status:** planned 2026-11-27 against `v0.7.6` (annotated tag, commit
> `007c287`, which is `main` HEAD and the commit that closed the 0.7.x line).
> The previous line is **closed**: seven tags `v0.7.0`–`v0.7.6`, each with a
> GitHub Release, 494 green tests at that tag, schema **v10**, **18** panel routes, **5**
> slash commands, the native port through Phase 3 text-only, Phase 4 rehearsed
> but not cut over, and **no npm publication** (the registry answers 404). This
> plan is the execution order for the next line. It is a decision-level plan,
> not a commitment of dates, and it is written so every patch below either
> ships under the safe default of [§6](#6-owner-decisions-and-safe-defaults) or
> waits, scoped, for the owner decision that changes it — **0.8.0 and 0.8.1
> ship without any answer; 0.8.2 and 0.8.3 are scoped but do not start until
> D1/D2/D10/D11 are answered; 0.8.4 closes whatever shipped.**
>
> This file supersedes the *forward-looking* half of
> [`PATCH_PLAN.md`](PATCH_PLAN.md) §6 (its "0.8.0 candidate" wording is the
> 0.7.x record; from this revision the follow-ups are scheduled here). The 0.7.x
> plan itself is frozen as history: the line it describes is tagged and
> released.
>
> Related documents: [`ROADMAP.md`](ROADMAP.md) carries the phases and what
> remains; [`NATIVE_PORT.md`](NATIVE_PORT.md) is the capture → analysis → briefs
> design this plan is the execution order for; [`CUTOVER_REHEARSAL.md`](CUTOVER_REHEARSAL.md)
> is the Phase 4 rehearsal 0.7.6 wrote; [`CHANGELOG.md`](../CHANGELOG.md) is the
> record of what actually shipped.

## 1. Starting point, measured

Facts checked against the repository, the tag list, the GitHub release list, and
the registry on 2026-11-27, on the `v0.7.6` tree at `007c287`; `npm test` was
re-run for this revision (494 pass, 0 fail, 0 skipped, 0 todo), `npm run
rehearsal` was re-run (20/20 checks passed), and `npm run typecheck` /
`npm run check:package` are green. They are the baseline every patch below
assumes; a patch that invalidates one updates this table.

| Fact | Value | Checked at |
| --- | --- | --- |
| Baseline for this line | `0.7.6`, annotated tag `v0.7.6` (commit `007c287`); `main` is the same commit. The 0.7.x line is closed — this is its last patch, not a development head | `package.json`, `git tag`, `git log` |
| Release trail | Seven tags `v0.7.0`–`v0.7.6` and **seven GitHub Releases** (`gh release list` ends at `v0.7.6`, marked Latest); the release tool (`npm run release -- patch`) is proven by 0.7.6 | `gh release list --limit 20`, `scripts/release.mjs` |
| npm | `npm view dsh-plugin-dayflow version` answers **404** — never published; D7 still unanswered, so the safe default stays "tagged here, not on the registry" | `npm view dsh-plugin-dayflow version` |
| Tests | 494 cases, green on the tag (`npm test`: 494 pass, 0 fail, 0 skipped, 0 todo; 493 at `v0.7.5`, 477 at `v0.7.4`, 425 at `v0.7.3`, 408 at `v0.7.2`, 384 at `v0.7.1`); CI runs macOS 15 with Node 22 (`--experimental-sqlite`) and Node 24 | `tests/*.test.ts`, `.github/workflows/ci.yml` |
| Tools / skills / commands | 23 tools registered by default (17 with `edits: false`) plus `dayflow_install_dayflow` behind `allowInstall: false`; 8 skills; 5 slash commands (`dayflow-task`, `dayflow-remember`, `dayflow-reflect`, `dayflow-analyze`, `dayflow-run-close`) | `src/index.ts`, `src/tools/`, `src/commands.ts`, `tests/plugin.test.ts` |
| Panel | 18 exact host Fetch routes (9 GET + 9 POST), one UI entry (one header button, one panel tab), one insights payload | `src/panel-contract.ts`, `tests/panel.test.ts` |
| Owned schema | **v10** (`automation_runs` accepts `'lint'`; `briefs.payload_json`); no patch on the 0.7.x line after 0.7.5 moved it | `src/journal.ts` → `JOURNAL_SCHEMA_VERSION` |
| Native port | Phase 0 (provider + Swift helper) and Phase 1 (capture engine) landed in 0.7.0; Phase 2 (analysis pipeline + worker/status/panel) in 0.7.1–0.7.2; Phase 3's text-only automation slice in 0.7.4; the Phase 4 lint remainder in 0.7.5. **Phase 4 itself is rehearsed only** — `source: owned` is not a default, no real week has been recorded, and the whole line is text-only | `src/capture/`, `src/analyse/`, `src/briefs/`, `src/automation/`, `docs/NATIVE_PORT.md` |
| Phase 4 rehearsal | `docs/CUTOVER_REHEARSAL.md` plus `npm run rehearsal`: a repository-side fixture dry run (fake provider, scripted analyser, throwaway journal) that walks capture → analysis → day close → day insights → weekly lint → weekly brief → reopen; **20/20 checks passed** on 2026-11-27, restart delta zero. Neither the script nor its test ships in the tarball. The written real-capture step needs the owner and Screen Recording permission and was **not** run | `npm run rehearsal`, `docs/CUTOVER_REHEARSAL.md` §2 |
| 0.7.6's own scope | Docs-and-release only: no plugin source (`src/`), schema, route, command, tool, skill, config key, default, host peer, or dependency change; the only executable additions are the rehearsal script and its test | `git diff v0.7.5..v0.7.6 --stat` |
| Host cohort | DSH dev dependencies `0.2.1-rc.2`, peers `^0.2.0-rc.2`. `@deepseek-ai/dsh-llm` is declared and used through a structural seam; `@deepseek-ai/dsh-attachment` is **not** a dependency — that is what keeps the line text-only | `package.json`, `src/analyse/host.ts` |
| Owner decisions | D1 (analysis destination) unanswered; D2 (provider/model) settled as explicit configuration; D3 (budget) caps configured and the call cap enforced, the token cap reported only; D7 (npm) unanswered. D4/D5/D6/D8/D9 remain as [PATCH_PLAN.md](PATCH_PLAN.md) §6 records them | `PATCH_PLAN.md` §6, `docs/CONFIGURATION.md` |

**Landed on the 0.7.x line, therefore not in this plan:** the owned schema and
importer, the read tools, the review queue, long tasks, dated memory, the
budgeted memory context, reflections, the scheduled lint and its digest, the
interactive insights panel, the native capture engine, the analysis pipeline
and worker, the automation scheduler with `automation.catchUpDays`, the panel's
capture / analysis / close lines, the 18 routes, the 5 commands, the 23 tools,
and the 8 skills. All of it is tagged, tested, and released.

**The three debts this line exists to pay.** 0.7.2 left three ledger holes and
0.7.2–0.7.6 deliberately did not fill them, because each patch kept one theme:

1. **The token cap is not a gate.** `GET /api/dayflow/analysis/status` shows
   `tokensToday` and `dailyTokenBudget`, and `analysisTokenTotalsForDay` exists
   in `src/analyse/jobs.ts`, but only the call cap (`maxCallsPerDay`) is
   enforced. A provider whose input tokens are large can spend far past the
   token number the profile shows.
2. **Skipped windows are terminal.** `skipped` is written when the consent
   gate, the pause flag, or an unset provider/model/analyser refuses a window,
   and the pipeline's idempotency rule treats `skipped` like `complete`. Fixing
   a config mistake after a blocked day therefore never analyses that day — the
   frames sit there, unread, forever.
3. **The 04:00 day boundary drops the tail.** The worker runs the pipeline for
   `dayWindowContaining(now)`, so the last window before the boundary (frames
   captured between the final pre-boundary tick and 04:00) belongs to the old
   day and is never analysed: after 04:00 every tick asks for the new day.

**What is deliberately not in this plan:** the owned-journal write path (the
editing tools still go through Dayflow), the `dsh dayflow import` CLI, the
month/week panel goal and rating surfaces, the `review.cards` switch (the plugin
has no card stack, so the switch has no surface), task tagging from the
summarization prompt, automatic activity attribution, embeddings, Phase 5, and
any change to the Swift helper's permissions. Image admission and the Phase 4
cutover **are** in this plan — as owner-gated patches 0.8.2 and 0.8.3, not as
silent scope.

## 2. Iteration rules

The rules of the 0.7.x line still hold, and this line does not restate them:
**R1** one verifiable theme per patch, **R2** one integration point and one tag
per patch, **R3** migrations ride with their code, **R4** CI never calls a
model, captures the screen, or needs a permission, **R5** default-safe or
blocked on a decision, **R6** docs and CHANGELOG travel with the tag, **R7** no
read-path regression, **R8** rollback is config first, revert second, **R9** one
UI entry. They are written out in [PATCH_PLAN.md](PATCH_PLAN.md) §2, and a
reviewer should apply them unchanged.

What this line adds is how a decision-gated line stays releasable:

**O1 — The safe default ships the patch; a gated patch is scoped, not started.**
Every patch below is either inert under the safe defaults of §6 (0.8.0, 0.8.1,
0.8.4) or explicitly deferred until the owner answers (0.8.2, 0.8.3). A patch
does not "partially land" a gated theme; an inert stub of a feature is not a
deliverable, because it is surface with no user and no acceptance.

**O2 — Every default-sensitive patch proves its default.** The config-defaults
diff is reviewed as part of the patch, and there is a test that a profile with
defaults runs nothing new. For 0.8.0 that test matters twice: the patch both
*gates spending* and *starts spending* (the day tail), and the safe default has
to be shown inert (capture off and/or `consent: none` still means no call).

**O3 — Version slots are semantic, and a deferred slot does not renumber the
line.** 0.8.2 is the image slot and 0.8.3 is the cutover slot. If the owner has
not answered by the release close, those patches do not ship, the close is
still 0.8.4, and its release notes name the slots deferred. The only
renumbering allowed is a split of 0.8.0 **before its tag** (see §5). This keeps
the plan, the tags, and the docs from disagreeing about what a version means.

**O4 — Money is part of the contract.** A patch that can cause a model call
states, in its own section, what is spent, when the gate trips, what is never
replayed, and which configuration stops it. "The provider reports usage" is not
a budget. This rule exists because the day tail is the first analysis path an
owner can turn on and walk away from.

**O5 — Pixels need a new compatibility event, not just a config key.** Image
admission adds a host attachment/vision contract and possibly a new peer. It
must keep the plugin loadable, text-only, when that service is absent; a new
required peer is a compatibility break and is not acceptable for a patch line.
The 0.7.6 compatibility close promised no new host peer on the 0.7 line; 0.8.2
is where that changes, deliberately and with a fallback.

**O6 — The release train continues.** One tag and one GitHub Release per
shipped patch, release notes from the CHANGELOG section, no npm publish without
D7. 0.7.6 proved the tool; this line uses it for every tag rather than
backfilling afterwards.

## 3. The patches

### 3.1 Summary

| Patch | Theme | Roadmap item | Depends on | Decisions | Risk | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **0.8.0** | **Analysis ledger follow-ups:** the token budget becomes a post-call gate, transient skips replay within yesterday, and the 04:00 boundary gets a one-shot day-tail run | Native port Phase 2 remainder / analysis ledger | — (built on `v0.7.6`) | D3 caps only (safe default) | Medium | **planned — finalised, ready to implement** |
| **0.8.1** | **Briefs reading view:** the stored day/week briefs appear in the insights payload and the existing panel view; no new tab, no new route, no model call | Phase 3 standup/brief surface | 0.8.0 tree | none | Low | **planned** |
| **0.8.2** | **Image admission (owner-gated):** an optional host attachment/vision contract, a config-gated image path, the `privacy_apps` redaction list and the Roadmap 3.6 limitation copy; default `includeImages: false` and fully inert | Native port Phase 2 image slice / Roadmap 3.6 | 0.8.0/0.8.1 tree | **D1, D2, D11** | High | **owner-gated — scope only** |
| **0.8.3** | **Phase 4 cutover (owner-gated):** `source: owned` becomes the default for a fresh capture-enabled profile with no Dayflow database, the first-run walkthrough lands, and the real week is recorded | Native port Phase 4 / 1.0.0 prerequisite | 0.8.0–0.8.2 tree, real week | **D1, D2, D10** | High | **owner-gated — scope only** |
| **0.8.4** | **Release close:** every shipped 0.8.x tag gets its release, the npm state is settled without publishing, docs and counts are reconciled, and deferred slots are named for the next line | Release closure | everything shipped | D7 (publish only) | Low | **planned (after 0.8.3 or its deferral)** |
| *0.8.5* | *Reserved contingency — only if 0.8.0 has to split before its tag (§5). Not planned work.* | — | — | — | — | *reserved* |

Order rationale: 0.8.0 first because it is decision-free, closes the three named
debts, and makes the money ledger honest **before** anything can flip a default;
0.8.1 next because it is the decision-free visible win that makes 0.7.4/0.7.5's
stored output readable; the gated 0.8.2/0.8.3 follow in the roadmap's own order
(image before cutover) so the default flip is the last functional change of the
line; 0.8.4 closes it and flips nothing. Details in §5.

### 0.8.0 — Analysis ledger follow-ups

**Status: planned and finalised for implementation against `v0.7.6`.** One
theme (R1): *the analysis ledger becomes money-bounded and self-healing instead
of a timer with three holes.* It is decision-free: it adds no model, no host
peer, no schema change, no route, no command, no tool, and no configuration
key. It is the first patch of the line and can be handed to an implementer as
written below.

**Motivation, in three sentences.** The token count is displayed but never
stops a call, so a profile can exceed the budget the panel shows. A skipped
window is terminal, so a consent/provider/model mistake after a blocked day is
never repaired and the frames are never analysed. The 04:00 boundary switches
the worker to the new day, so the old day's final window is never analysed at
all. Each of these is a small hole in the same ledger; fixing them apart would
mean three patches touching the same three modules.

#### A. The token budget becomes a post-call gate

**Semantics (the contract, in gate order):**

1. The **call gate** stays first and unchanged: before a window starts, the day's
   `callsToday` (jobs with `attempts > 0`) is compared with
   `analysis.maxCallsPerDay`. When it trips, the remaining windows are skipped
   with reason `budget` and the run's `outcome` is `budget` — exactly today's
   behaviour.
2. The call runs and completes; its usage (`input_tokens`, `output_tokens`) is
   recorded on the job row.
3. The **token gate** is checked *after* the completion: the day's recorded
   tokens (`input_tokens + output_tokens` summed over the day's jobs) are
   compared with `analysis.dailyTokenBudget`. When the sum is at or above the
   budget, every remaining window in the run is skipped with reason
   `budget-tokens`, no further call is started that day, and the run's
   `outcome` is `budget` with `budgetKind: 'tokens'`.
4. The crossing call is **paid and stays complete**. Nothing is clawed back,
   nothing is marked failed, and no number is recomputed: the ledger is the
   source of truth and a second counter does not exist.
5. Budgets are per Dayflow day, so a later run for the same day sees the same
   spent total, and the 04:00 boundary is what resets the budget because the day
   key changes. A day-tail run for yesterday spends yesterday's remaining
   budget, not today's.

**Why a post-call gate, and not a pre-call estimate.** Output tokens are
unknown before the call, so a pre-call token gate would have to estimate — and
a gate that can be wrong is worse than a gate that acts on what was actually
spent. The promise is "spend nothing more after the cap is crossed", not "never
cross the cap". That promise is exactly the one an owner can reason about: at
most one call past the budget, and the status line says so.

**API and data.** No schema change: the tokens are already columns on
`analysis_jobs` (v8). In `src/analyse/jobs.ts`:

- `analysisTokenBudgetExhausted(db, day, dailyTokenBudget)` — additive sibling of
  `analysisBudgetExhausted`; sums the same `input_tokens`/`output_tokens`
  columns the status route already reads, and treats NULL usage as zero.
- The status payload gains one additive field, `tokenBudgetExhausted: boolean`,
  read from the ledger. Reading status stays a pure read: a missing journal
  answers `false` without creating the file.
- `AnalysisRunResult` gains `budgetKind?: 'calls' | 'tokens'`, set only when
  `outcome === 'budget'`. `blockedKind` does not exist and is not added; a
  blocked run keeps `blockedReason`.
- `skipRemainingForBudget` takes the skip reason as a parameter (`budget` for
  the call gate, `budget-tokens` for the token gate) instead of hard-coding it.
- Gate order in the pipeline is fixed and tested: idempotency → call gate →
  start → complete + write → token gate → next window.

**Panel.** The analysis line in the Journal insights view adds one clause when
`tokenBudgetExhausted` is true: the token budget was reached for today and
analysis pauses until the 04:00 boundary. Two locale keys (EN/ZH); no route, no
entry, no settings surface.

#### B. Transient-skip catch-up, bounded to yesterday

**What a skip is.** A skipped job is a record that *no call was made*. It is
the one ledger state that says nothing about the day's content, which is why it
is safe to replay when the reason was configuration and unsafe when it was
money.

**Which skips replay** (new pure module `src/analyse/skips.ts`, so the policy is
one testable function rather than an `if` chain in the pipeline):

| Skip reason written today | Written by | Replay? | Why |
| --- | --- | --- | --- |
| `analysis-disabled` | consent gate | yes | configuration |
| `capture-disabled` | consent gate | yes | configuration |
| `paused` | capture pause flag | yes | user action, temporary by design |
| `consent:none` | consent gate | yes | configuration |
| `provider-unset` | consent gate | yes | configuration |
| `model-unset` | consent gate | yes | configuration |
| `consent:provider-not-local` | consent gate | yes | configuration |
| `analyser-unset` | pipeline gate | yes | composition/configuration |
| `budget` | call cap | **no** | spending decision; raising a cap must not silently replay a past day |
| `budget-tokens` | token cap (part A) | **no** | same |
| anything else | future reasons | **no** | forward-compatible default is "do not replay" |

**Mechanics.** In `src/analyse/jobs.ts`, `replaySkippedAnalysisJob(db, id)`:

- moves a row `skipped → queued` with a **conditional** `UPDATE` (`WHERE id = ?
  AND status = 'skipped'`), so a race between a worker tick and a manual
  `/dayflow-analyze` cannot replay the same row twice; a lost race counts the
  window as skipped;
- leaves `attempts` untouched and does **not** reset a counter: a skip never
  consumed an attempt, so a replayed window starts at attempt 1 of 2 exactly
  like a fresh window, and a replayed call that fails is handled by the existing
  `ANALYSIS_MAX_ATTEMPTS` logic (a `failed` window is never treated as a skip);
- preserves the previous skip reason in the existing `analysis_jobs.payload_json`
  column as a bounded audit object (`{"last_skip": {"reason": …, "at": …}}`), so
  the reason does not disappear when `error` is cleared at start;
- refuses a non-transient reason and a row that is not `skipped` (the caller
  asks first, the function checks again — the function is the enforcement
  point, the classifier is the policy).

`startAnalysisJob` is **not** relaxed: only this explicit replay path can requeue
a skip. The pipeline's idempotency branch becomes: a `skipped` job is terminal
unless the run's gate is currently open **and** `isTransientAnalysisSkip(job.error)`
**and** the row has attempts left — in which case the pipeline replays it and
continues into the normal call path.

**Bounding.** Replay happens only inside a run for the day being run. Runs
happen for today (every tick, as today) and for yesterday (one day-tail run per
boundary, part C). There is no sweep over older days, no replay on plugin
startup, and no new configuration key. The cost of a catch-up is bounded by the
day's own remaining call and token budgets and by the number of transiently
skipped windows; a day that was fully skipped and then repaired can therefore
spend up to that day's remaining budget once, and never more. `budget` and
`budget-tokens` skips are never replayed automatically; a future owner-authorised
operation could, but it does not exist in this patch.

#### C. The 04:00 day tail

**What it fixes.** Frames captured between the last pre-boundary tick and 04:00
belong to the old day. After the boundary, `dayWindowContaining(now)` returns
the new day, so that final window has no job and is never analysed. The same
mechanism is what makes a consent fix after the boundary unable to replay the
old day's skips.

**What it does.** On the first tick after a day boundary, after today's run, the
worker runs the pipeline **once for yesterday**. A checkpoint key
(`analysis_tail_checked_on`, value = today's day key) makes it once per
boundary: a second tick on the same day, or a restart on the same day, does not
repeat it.

**Checkpoint rules (all tested):**

- **Run first, write the checkpoint after.** A crash between the two replays the
  tail, which is idempotent by job key; the opposite order could lose the tail
  permanently.
- **Do not write the checkpoint when the run is `blocked`.** The next tick
  retries, so a consent/provider/model fix later the same day still closes
  yesterday. While blocked no call is possible; the retry only re-reads frames
  and re-checks the gate.
- **Write it for `empty`, `analysed`, and `budget`** — the day was attempted and
  there is nothing more to do at this boundary.
- **A run-level throw leaves it unwritten** and the worker's existing backoff
  applies.
- **The tail cannot change today's outcome.** It runs after today's run, in its
  own `try/catch`; a tail failure is logged (`analysis.day_tail`) and never
  turns a good tick into a failed one. Today's run keeps writing the worker's
  `lastOutcome` / `lastError`.

**What bounds the tail.** One day; yesterday's own remaining call and token
budgets; stored frames only. The existing `maxWindows` option is deliberately
**not** used for the tail: it slices the window list from the first window, so
it would re-walk already-complete windows and never reach the tail. The tail's
cost is bounded by the budget gates and the ledger's idempotency instead, and a
"bounded run" here means one day, not one window count.

**Where the checkpoint lives.** The existing runtime key/value table
(`capture_state`), through two small generic helpers added next to the typed
capture state (`readStateValue(db, key)` / `writeStateValue(db, key, value)`),
and `previousDayKey(dayKey)` added to `src/day.ts` (derived from the day window
start minus one millisecond, so it is DST-safe; a 24-hour subtraction is not).
No migration.

> Rejected alternative: schema **v11** with a dedicated `analysis_state` table.
> It is a table for one key, it puts a migration in the first patch of the line,
> and it creates a downgrade boundary for no behaviour. The `capture_state`
> table is already described as "a tiny key/value table rather than a
> configuration row"; the analysis checkpoint is the same kind of thing. If a
> second analysis checkpoint appears later, moving to a dedicated table is a
> later patch's decision, not this one's.

#### File-level deliverables

| File | Change |
| --- | --- |
| `src/analyse/skips.ts` | **new.** `TRANSIENT_ANALYSIS_SKIP_REASONS` and `isTransientAnalysisSkip(reason)`: pure, no database, forward-compatible default `false`. |
| `src/analyse/jobs.ts` | `analysisTokenBudgetExhausted`; `replaySkippedAnalysisJob` (conditional requeue + bounded audit payload); keep `analysisTokenTotalsForDay` as the single sum. |
| `src/analyse/pipeline.ts` | Post-call token gate; replay branch in the idempotency check; `skipRemainingForBudget` gains a reason parameter; `budgetKind` on the result. |
| `src/analyse/worker.ts` | The day-tail attempt (after today's run, own `try/catch`, log event); checkpoint read/write; `previousDayKey` use. |
| `src/analyse/status.ts` | Additive `tokenBudgetExhausted` on the payload (pure read, no journal creation). |
| `src/day.ts` | `previousDayKey(dayKey)` (DST-safe, tested across a DST date). |
| `src/capture/state.ts` | Generic `readStateValue` / `writeStateValue` beside the typed capture helpers (no new table). |
| `src/panel-contract.ts` | Additive status-payload field only; no route constant changes. |
| `src/client/insights.tsx`, `src/client/locale.ts` | The one-line "token budget reached … paused until 04:00" copy, EN + ZH. |
| `tests/analyse-skips.test.ts` (new), `tests/analyse-jobs.test.ts`, `tests/analyse-pipeline.test.ts`, `tests/analyse-worker.test.ts`, `tests/analyse-status.test.ts`, `tests/panel.test.ts` | The new cases below. |
| `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `docs/NATIVE_PORT.md`, `docs/PANEL.md`, `docs/ROADMAP.md`, `CHANGELOG.md`, README status if visible | Docs travel with the tag (R6). |

#### Acceptance (the patch's own test list)

- [ ] A day whose first completed call records tokens at or above
      `dailyTokenBudget` makes **no second call**; remaining windows are
      `skipped` with reason `budget-tokens`; the completed row keeps its usage;
      `outcome: 'budget'`, `budgetKind: 'tokens'`.
- [ ] A token gate that trips on the **last** window does not report
      `outcome: 'budget'` (nothing was stopped); `tokenBudgetExhausted` is still
      true for the day.
- [ ] The call gate still wins when it trips first: `budgetKind: 'calls'`,
      reason `budget`, unchanged behaviour.
- [ ] A new day key starts a fresh budget; a later run for the same day sees the
      same spent total.
- [ ] NULL/absent usage counts as zero and cannot trip or hide the gate.
- [ ] A run blocked by `consent:none` (or `provider-unset`, `model-unset`,
      `paused`, `analyser-unset`) and then repaired analyses exactly the skipped
      windows on the next run, makes one call per window, and writes no
      duplicate card (the existing unique `(source_id, source_key)` keys stay
      the second guard).
- [ ] `budget`, `budget-tokens`, `failed`, and unknown reasons are **not**
      replayed; attempts are never reset; the audit payload keeps the last skip
      reason; a second replay of a completed row is refused.
- [ ] At a fixed clock just after 04:00, one tick closes yesterday's tail and
      analyses today as before; a second tick on the same day does not repeat
      the tail; a restart on the same day does not repeat it.
- [ ] A **blocked** tail retries on the next tick and replays once the gate
      opens; a tail that throws leaves the checkpoint unwritten and does not
      fail the tick.
- [ ] Default profile: capture off or `consent: none` means no call, no tail
      call, and no journal creation by the status read.
- [ ] Route set stays exactly **18**; commands stay **5**; tools/skills
      unchanged; schema stays **v10**; no config key added (the defaults diff is
      empty).
- [ ] The suite makes no network call and uses the existing fake analyser seam
      (R4).

#### Decisions, risk, rollback

- **D3, and what it now means for money.** The patch enforces the *configured*
  caps; it changes no cap number (`analysis.maxCallsPerDay` 120 and
  `analysis.dailyTokenBudget` 200,000 stay). The money contract is: at most one
  call can cross the token budget, budget skips are never replayed
  automatically, and no automatic cloud replay exists without the owner's
  authorisation. If the owner wants a different cap, it is a config value, not
  this patch. D2 is untouched; D1 is irrelevant to the code path (a default
  profile is inert).
- **Risk: a token-total misread.** NULL usage, a provider that reports nothing,
  or a failed read could under- or over-count. Mitigation: count only recorded
  numbers, treat NULL as zero, and never fail a window because the gate read
  failed (the existing per-window failure path applies, and the worker backs
  off). The gate is a ceiling on behaviour, not a billing system.
- **Risk: the tail doubles one tick's duration.** Mitigation: after today's
  run, one day, budget-gated, logged, and no second timer. A tail run on a day
  whose frames are gone is `empty` and costs one checkpoint write.
- **Risk: a replay resurrects work the user skipped on purpose.** Mitigation:
  replays happen only when the gate is *currently open* — a deliberate
  configuration change is the trigger — never for budget skips, and the old
  reason stays in the audit payload.
- **Order of implementation inside the patch:** token gate first, then catch-up,
  then tail. The token gate must be in the same tag because the tail is the
  first path that can spend without the owner watching; shipping the tail
  without the gate would be exactly the failure mode D3 exists to prevent.
- **Rollback:** no schema change, so the tag is revertible and an older build
  can still open the journal (R8); at the profile level, `analysis.consent:
  none` (or capture off) stops every call the patch can make, and
  `analysis.enabled: false` unmounts the worker entirely. There is no state the
  rollback has to undo beyond one key/value checkpoint and ledger rows that were
  already append-only.

#### Definition of done

The shared checklist in §4, plus this section's acceptance list, plus the
docs above, plus a `CHANGELOG.md` entry under `[Unreleased]` that names the three
follow-ups in one line each and states that the default profile still spends
nothing.

### 0.8.1 — Briefs reading view

**Status: planned.** One theme (R1): *the journal's most condensed output
becomes readable where the rest of the journal is read — one entry, no new tab,
no model call.*

**Motivation.** 0.7.4's weekly close writes one `briefs` row per week (with
0.7.5's `Memory health: …` digest and `payload_json.memory_health`), and the
daily close writes a standup into `daily_standup_entries`. Both are stored,
both are summarised text a person would actually read, and the panel renders
**neither**: the only way to read them is a tool call. The roadmap has carried
the "briefs reading view" as remaining work since the line closed, and the
tools are the only reader today. This patch is that view.

**Shape.**

- **Payload, not a route.** `GET /api/dayflow/insights` gains an additive
  `briefs: PanelBriefSummary[]` field. The route set stays exactly 18; there is
  no second GET for a list an existing call can carry, and no second panel
  request. Additive means an old client is unaffected.
- **One read module.** New `src/briefs/read.ts` exports
  `listPanelBriefs(journalPath, { limit })`:
  - reads the live `briefs` rows (both kinds — a day brief can exist from an
    import even though the native daily close stores a standup instead), via the
    existing `listBriefs` in `src/automation/store.ts`;
  - reads the most recent native standups from `daily_standup_entries`
    (`is_deleted = 0`, existing decoder shape: highlights / tasks / blockers)
    and normalises each into the same shape as a day brief
    (`kind: 'day'`, `period_key = standup_day`, title `Standup · <day>`, body
    rendered as plain lines);
  - de-duplicates per `(kind, period_key)`, preferring the `briefs` row;
  - sorts by `period_key` descending (ties by `updated_at` descending) and caps
    at 10.
  A missing or unreadable journal answers `[]` without creating the file, the
  same tolerance the rest of the insights payload has.
- **One client section.** The existing Journal insights view gains a `Briefs`
  block after the current blocks (tasks → review → memory → reflections →
  briefs). Each entry is a collapsed row with a day/week badge, the title, and
  its updated date; expanding it shows the body. The weekly memory-health
  paragraph is already part of the brief body, so it shows inside the entry, not
  as a second surface.
- **No new tab, header button, or settings page** (R9); no new config key; no
  schema change; no model call; no new host peer.
- **Locale keys** in `src/client/locale.ts`: section title, the two badges, the
  empty line, expand/collapse — EN and ZH, like every other panel string.
- **Contract additions** in `src/panel-contract.ts`: `PanelBriefSummary`
  (`kind`, `period_key`, `title`, `body`, optional `model`, `updated_at`,
  optional `memory_health`) and the additive `briefs` field on `PanelInsights`.
  `buildPanelInsights` (`src/panel.ts`) fills it inside the same single journal
  read and extends its empty literal from four lists to five, keeping the
  "missing journal answers empty lists and never creates the file" rule.

**File-level deliverables:** `src/briefs/read.ts` (new),
`src/panel-contract.ts`, `src/panel.ts` (`buildPanelInsights` fills the field),
`src/client/insights.tsx`, `src/client/locale.ts`,
`tests/panel-insights.test.ts`, `tests/panel.test.ts`, plus docs
(`docs/PANEL.md`, `docs/ROADMAP.md`, `CHANGELOG.md`, README status if visible).

**Acceptance:**

- [ ] The insights payload contains the week brief with its memory-health digest
      paragraph.
- [ ] A day with only a native standup appears as a day entry; a `briefs` day
      row and a standup for the same day de-duplicate to one entry.
- [ ] Deleted standups are hidden; malformed `payload_json` is handled the way
      the existing decoder handles it (never a thrown route).
- [ ] Order and the cap of 10 are asserted; an empty journal answers `[]` and
      does not create the journal file.
- [ ] The route set stays exactly 18 and the single-entry test is unchanged; no
      model adapter is involved; the default profile shows an empty section.
- [ ] Both locales carry every new string; the client bundle test passes.

**Decisions:** none. **Risk:** payload growth (bounded by the cap and by brief
length, which the prompts already cap) and duplicate-looking day/week entries
(mitigated by the badges and the dedupe rule). **Rollback:** the field is
additive and the section is read-only; reverting removes UI and payload field
with no state to migrate.

### 0.8.2 — Image admission (owner-gated)

**Status: scoped, not started. Do not implement this patch until every gate
below is met in writing.** One theme (R1): *pixels are admitted through a
config-gated, privacy-limited contract — the first time the plugin sends
anything but text.*

**Why this is gated rather than default-safe.** Three independent decisions
meet here: whether frames may leave the Mac at all (D1), which provider/model
reads them (D2), and whether the owner wants the image path at all (D11). On
top of that, it is the line's only new host compatibility surface: the vision
contract needs the host attachment service, and the 0.7.6 compatibility close
explicitly recorded that `@deepseek-ai/dsh-attachment` was not a dependency
because the line was text-only. Adding it must not break installs that lack it.

**Entry gates (all required before code starts):**

1. **D1 answered** as `local` or `cloud`. If `cloud`, the Roadmap 3.6 limitation
   copy (a window is hidden, not the content inside a browser tab) is approved
   and ships with the patch.
2. **D2 names a vision-capable provider and model.** A text-only model means
   there is no image admission; the patch stays deferred.
3. **D11 — explicit image-admission go-ahead**, including the size and
   retention caps the owner accepts.
4. **The host contract is verified against the installed DSH release** and
   recorded in a short design note (`docs/IMAGE_ADMISSION.md`, delivered by the
   patch): how bytes become an attachment, what the vision request shape is,
   what the token cost per call is.
5. **The plugin must load text-only when the service is absent.** The peer is
   declared optional (`peerDependenciesMeta`) or reached through a structural
   seam supplied only when the host service exists. CI has no attachment
   service, so all image tests use a fake; no screenshot, window title, or
   image may leave the machine in CI (R4).

**Scope sketch (finalised by the design note, not before):**

- **Config:** `analysis.includeImages` (default **false**), a per-call image byte
  cap, and a frames-per-window cap. All validated at load time; all inert.
- **Schema:** an additive migration (v11) for the `privacy_apps` list
  (bundle id + display name, seeded with password managers), with the
  migrate-from-v10 fixture test. Nothing about today's tables is rebuilt.
- **Analysis:** `src/analyse/prompt.ts` appends image content blocks after the
  text block; `src/analyse/host.ts` sends them through the host
  attachment/vision seam; `src/analyse/pipeline.ts` selects the representative
  frames, enforces the byte cap and downscaling, and skips an unreadable or
  oversized frame by falling back to text for that window rather than failing
  the run. Cloud requests replace a privacy-app frame with the fixed
  "private application, content withheld" placeholder; local requests keep the
  pixels (the Roadmap 3.6 rule: redaction is about leaving the machine, not
  about judging content).
- **Privacy surfaces:** the `privacy_apps` list is readable and editable only
  through the existing entry (no new tab); the limitation copy from 3.6 is in
  both languages; the analysis line states that images are included when they
  are.
- **Docs:** `NATIVE_PORT.md` image slice, `CONFIGURATION.md`, `ARCHITECTURE.md`
  (the new seam), `PANEL.md`, `ROADMAP.md` Phase 3.6 status, `CHANGELOG.md`,
  README privacy section and both READMEs' compatibility statement.

**Acceptance (when it ships):**

- [ ] Request bodies in tests carry image blocks only when
      `analysis.includeImages`, a permitted consent, and the provider/model are
      all on; every other combination sends text only.
- [ ] A cloud request body never contains a frame from a `privacy_apps` app; a
      local request does; durations and totals are unchanged in both cases.
- [ ] The plugin loads and analyses text-only when the attachment service is
      absent; no required peer breaks a default install.
- [ ] Byte caps and fallbacks are asserted; a bad frame cannot fail a window's
      run; the cost note (input tokens per window) is in the docs.
- [ ] Default profile unchanged: no image, no new call, no new surface.
- [ ] Rollback is config first: `analysis.includeImages: false` (the default)
      disables the path without a downgrade; the migration only ever adds a
      table.

**Decisions:** D1, D2, D11. **Risk:** pixels are irreversible once sent — hence
the gate list, the cloud redaction, and the default-off config. **Rollback:**
config first, then revert; the added table is additive and old builds ignore it
(R8).

### 0.8.3 — Phase 4 cutover (owner-gated)

**Status: scoped, not started. Do not implement until the entry criteria
below are met in writing and the owner is present for the flip and the real
week.** One theme (R1): *the owned journal becomes the default source of truth
for a fresh capture-enabled profile — the point the whole port exists for.*

**What "cutover" means here.** `source: owned` becomes the default when capture
is enabled and no Dayflow database exists, so a fresh profile records and reads
the plugin's own journal without the Dayflow app. The Dayflow importer stays as
the one-time migration path; an existing Dayflow install keeps `source:
dayflow` unless the user explicitly moves. The flip is a default change, not a
schema change: `dayflow: false` already selects the owned store, and the read
path for both backends has been green since 0.7.0.

**Entry criteria (all required):**

1. **D10 — explicit authorisation to flip the default.** A default change is an
   owner decision, not an engineering one.
2. **D1 and D2 answered** for the real week. The cutover acceptance needs an
   analysed day (standup, reflection, review queue), so analysis must be able to
   run; a capture-only cutover (`consent: none`) is a narrower variant the owner
   may choose instead, with a narrower acceptance and a later analysis week.
3. **The rehearsal passes on the tree being cut over**, not only on the 0.7.6
   record: `npm run rehearsal` 20/20 and the written real-capture step's
   checklist re-run with no data loss.
4. **A real captured week on a fresh profile** (throwaway profile, capture on,
   the new default in place, Dayflow closed) with **zero data loss** across
   restarts, recorded in `CUTOVER_REHEARSAL.md`. Any data loss is a blocking
   finding, not a note.
5. **Owner present** for the permission grant, the consent choice, and the
   first-run walkthrough; no unattended real capture.

**Scope (finalised against the week's record):**

- Config/composition: the default-source rule, kept pure. `resolveConfig` stays
  a pure function (it cannot stat the filesystem today); the rule is
  "explicit `source` wins; `dayflow: false` means owned; capture enabled and no
  Dayflow database means owned; otherwise Dayflow", evaluated once at
  composition (`src/index.ts`) with a documented, tested existence check. The
  config-defaults diff and a default-profile test are part of the patch.
- First-run flow inside the existing panel entry: permission state, consent
  choice (local/cloud/none), capture switch, pause — copy in both languages, no
  new tab (R9).
- Docs: README + README.zh architecture and privacy sections, the "native vs
  imported" section, `CONFIGURATION.md`, `ARCHITECTURE.md`, `NATIVE_PORT.md`
  Phase 4 status, `CUTOVER_REHEARSAL.md` real-week record, `ROADMAP.md`,
  `CHANGELOG.md`.
- Tests: the default rule table (explicit / `dayflow: false` / capture on with
  no Dayflow file / Dayflow file present), the first-run state machine, a
  fresh-profile test with the Dayflow path deleted, and a rollback test where
  `source: dayflow` still reads the imported store.

**Acceptance:**

- [ ] `NATIVE_PORT.md` §8 Phase 4 acceptance: on a fresh profile with Dayflow
      closed — install → grant permission → capture runs → a day appears in the
      panel → next morning the standup, reflection, and review queue are
      populated without a single agent turn.
- [ ] The real week's record shows zero data loss across restarts and no
      fabricated rows; the restart delta in the rehearsal's own terms is zero.
- [ ] An existing Dayflow profile is not silently converted; the importer is
      documented as the migration, and the panel says which source is active.
- [ ] `source: dayflow` remains a config switch that reverts the flip without a
      release (R8); no schema change is introduced by this patch.
- [ ] No npm publication is part of this patch.

**1.0.0 relationship:** 0.8.3 is the prerequisite. `1.0.0` follows once the real
captured week has completed without data loss and the first-run walkthrough has
been exercised; it is a separate release decision after this line, not a patch
in it. The evidence 0.8.3 records is what makes that decision possible.

**Decisions:** D10, D1, D2. **Risk:** the highest on the line — a default flip
is visible to every fresh profile. **Rollback:** config first (`source:
dayflow`), then revert; the patch adds no schema, so an older build can read the
same journal.

### 0.8.4 — Release close

**Status: planned, after 0.8.3 or after the owner-gated slots are formally
deferred.** One theme (R1): *close the line honestly — every shipped tag is a
release, the npm state is explicit, and the docs match the tagged tree.* Like
0.7.6 it **flips nothing**: no plugin source, schema, route, command, config
key, or default change. Its executable artefacts are documentation and release
operations only.

**A. Release trail.** One GitHub Release per shipped tag (`v0.8.0`, `v0.8.1`,
and `v0.8.2` / `v0.8.3` if they shipped), cut by `npm run release -- patch`
(the tool 0.7.6 proved), with each body taken from that version's CHANGELOG
section, version guards per tag, and no tag ever re-cut or moved. The release
notes state which reserved slots shipped and which were deferred, and why.

**B. npm — a decision and a check, not a publication.** D7 is still open, so the
safe default remains **do not publish**: `npm view` must still answer 404, the
READMEs keep "tagged here, not yet on the npm registry", `npm run check:package`
is green, the tarball is reviewed, and the `package.json` diff against `v0.7.6`
is exactly the version bump plus whatever shipped (no unbudgeted dependency
change; 0.8.2's optional attachment peer appears only if that patch shipped). If
the owner authorises publication in writing, it is a separate reviewed step with
a token and 2FA, and the tag does not change.

**C. Docs reconciliation.** The line has one version map and every doc agrees
with it: `0.8.0` = ledger follow-ups, `0.8.1` = briefs view, `0.8.2` = image
admission (if shipped), `0.8.3` = cutover (if shipped). That means the
forward-looking "0.8.0" references written before this plan (in
`docs/NATIVE_PORT.md`, `docs/CUTOVER_REHEARSAL.md`, `README.md`, `README.zh.md`)
are updated to the final map by the patches that touch them, and verified here;
this file's status lines, table, and §6 are set to "landed"/"deferred" with the
final numbers; `docs/ROADMAP.md`'s status head and 0.8.x rows move to the
post-line state; the test/route/schema/command counts in README,
`docs/ARCHITECTURE.md`, `docs/CUTOVER_REHEARSAL.md` §2, and this file are the
tag's actual numbers. Acceptance greps in the 0.7.6 style (positive-claim
patterns, empty or the stated value).

**D. Deferral, explicit.** Any slot that did not ship (0.8.2 without D1/D2/D11,
0.8.3 without D1/D2/D10, or a split-out part of 0.8.0) is listed in the close's
release notes and this file with its blocking decision, and moves to the next
line (0.9.x, or 1.0.0 in the cutover case). Nothing is silently dropped, and
nothing is promised twice.

**E. Gates.** `npm test` (the tag's suite), `npm run typecheck`,
`npm run check:package`, both CI legs, the `release-check` job, and a
`git diff --stat src/` that is empty for the close patch itself.

**Acceptance (boxed, the tag is not cut until all are true):**

- [ ] Every shipped 0.8.x tag has a GitHub Release whose body is its CHANGELOG
      section; the newest is `Latest`; no tag was deleted, moved, or re-cut.
- [ ] `npm view` answers 404 (or shows only an owner-authorised publish
      recorded in the CHANGELOG); the READMEs say the same.
- [ ] `check:package` lists `docs/` (including this file and
      `docs/CUTOVER_REHEARSAL.md`), both READMEs, CHANGELOG, skills, lib, and
      `cordis.patch.yml`, and excludes `tests/`, `scripts/`, `.github/`.
- [ ] No doc claims a version for a theme that did not ship it; every deferred
      slot names its blocking decision.
- [ ] The counts in README, ARCHITECTURE, CUTOVER_REHEARSAL §2, this file, and
      ROADMAP equal the tagged tree's actual numbers.
- [ ] The line's next step is stated: 1.0.0 after the real week (if 0.8.3
      shipped) or the gated patch's decision (if it did not).

**Decisions:** D7 (publish yes/no; safe default no). **Risk:** a cross-repo docs
pass — mitigated by mechanical grep acceptance, not prose review. **Rollback:**
docs-only; the release artefacts are not rolled back, only corrected by a
follow-up release note if a body was wrong (as 0.7.6's rule says).

## 4. Definition of Done (every patch)

The 0.7.x Definition of Done ([PATCH_PLAN.md](PATCH_PLAN.md) §4) applies
unchanged: suite green, `check:package` green, one integration point, docs and
CHANGELOG with the tag, no read-path regression, no default change without the
decision that authorises it, new worker/scheduler code tested with
double-start / cleanup / no-throw-into-host cases, new routes and panel
surfaces extending the exact route-set and single-entry tests deliberately,
rollback stated, and the patch's own section corrected if reality diverged.

This line adds:

- [ ] The money ledger test: the configured call/token cap cannot be exceeded by
      more than the single crossing call, and budget skips are not replayed
      (0.8.0).
- [ ] The idempotency proof: running the same catch-up twice, or restarting
      across the day boundary twice, produces no second call and no duplicate
      row.
- [ ] The decision-gate proof: a default profile (capture off and/or
      `consent: none`) runs nothing new; for a gated patch, the gate list in §6
      is quoted in the PR description with the owner's answer.
- [ ] The compatibility proof for a new peer or host service: with the service
      absent, the plugin loads and stays text-only (0.8.2 only).
- [ ] A default flip has a rollback test that restores the old source by config
      alone (0.8.3 only).
- [ ] `docs/ROADMAP.md` remain lines change only for work that actually landed.

## 5. Sequencing rationale

1. **The ledger patch first, because it is the only one that needs no answer.**
   0.8.0 closes the three debts 0.7.2 named, all in modules that already exist,
   with a fake analyser and a temporary journal. It also has to land **before**
   any default flip: the day tail is the first path that can spend without the
   owner watching, so the token gate and the tail are deliberately in the same
   tag. If the line did the cutover first, a fresh profile would get a default
   that is only bounded by the call cap and a reported-only token number.
2. **The briefs view second, because it is the cheapest visible win.** It is
   read-only, route-free, model-free, and it makes 0.7.4/0.7.5's stored output
   readable for the first time. It also lands before the gated patches touch the
   same insights view, so a section addition and a privacy-copy change are not
   interleaved in one review.
3. **Image admission before the cutover (the roadmap's order, kept).** Both are
   gated on the same owner conversation (D1/D2), so batching the answers is
   efficient; but the cutover stays last because it flips a default, and a patch
   that changes a default should not be followed by another functional patch in
   the same line. Image admission is default-off, so it does not change what the
   cutover week runs unless the owner explicitly turns it on.
   - The alternative order (cutover before image) was considered and rejected:
     it would put a default flip in the middle of the line, let a feature patch
     land on top of the new default, and make the first real week serve two
     changes at once. The cutover's risk is operational and the image patch's is
     privacy; keeping them in separate tags keeps the attribution clean.
4. **Release close last, and it flips nothing.** Same rule as 0.7.6: a patch
   line whose last patch changes a default would not be a patch line, and a
   release patch that also changes behaviour cannot be verified as a release.
5. **If 0.8.0 must split, split it before its tag.** The preferred scope keeps
   the three follow-ups together because they are one ledger and their tests are
   independent. If implementation shows the catch-up state machine needs more
   than this plan (a new config key, a schema change, or a replay loop that the
   simple requeue cannot express), **stop before tagging 0.8.0** and re-split:
   0.8.0 = token gate + tail, 0.8.1 = catch-up, 0.8.2 = briefs, 0.8.3 = image,
   0.8.4 = cutover, 0.8.5 = release close. Renumbering is only allowed in that
   window, before the first tag of the line; afterwards O3 applies and a slot is
   deferred rather than renumbered. This is why 0.8.5 is listed as reserved.
6. **No hotfix patch first.** The `v0.7.6` tree is green, released, and the line
   starts from a decision-free patch; nothing in the repository records a defect
   to fix before 0.8.0.

**Line exit criteria.** The 0.8.x line is done when: 0.8.0 and 0.8.1 shipped;
0.8.2 and 0.8.3 either shipped or are explicitly deferred in 0.8.4's notes with
their blocking decision; every shipped tag has a GitHub Release; the npm state
is explicit; `docs/ROADMAP.md`, `docs/NATIVE_PORT.md`,
`docs/CUTOVER_REHEARSAL.md`, README/README.zh, and this file agree on the
version map and the final counts; and the next step is named (1.0.0 after a real
week, or the owner decision that unblocks a deferred slot).

## 6. Owner decisions and safe defaults

D1–D9 are inherited from [PATCH_PLAN.md](PATCH_PLAN.md) §6; D10 and D11 are new
for this line. Every row has a default that ships without an answer.

| Id | Decision | Why it matters | Status 2026-11-27 | Safe default if unanswered | Gates |
| --- | --- | --- | --- | --- | --- |
| D1 | **Analysis destination**: `none`, `local`, or `cloud` | Whether screen metadata (and later pixels) may leave the machine, and whose model reads them | Unanswered | `none`: capture and analysis code ship, nothing leaves the machine, the panel says why. Also means no real cutover week with analysis | 0.8.0 code path is inert; 0.8.2, 0.8.3 blocked |
| D2 | **Provider and model** for analysis | Cost, latency, and which vendor sees the data | Settled as an explicit rule: `analysis.provider` + `analysis.model` must be set; empty means "not configured" and jobs are skipped | Explicit pair or skip; no implicit host default | 0.8.2 needs a **vision-capable** pair; 0.8.3 needs any working pair |
| D3 | **Daily budget**: calls and tokens | A runaway loop is a bill, not a bug | Caps configured (120 calls / 200k tokens); the call cap is enforced, the token cap has been reported-only through 0.7.6 | **0.8.0 enforces the configured token cap as a post-call gate.** No retroactive spend, no automatic replay of budget skips, no automatic cloud replay without authorisation. Changing a cap is a config value, not a patch | 0.8.0 |
| D4 | **Catch-up window** after the machine was off (automation closes) | Closing ten missed days at once is noise and cost | Settled and landed: `automation.catchUpDays` (1–30, default 2), older days `skipped`, never fabricated | Unchanged on this line | — |
| D5 | **Frame retention** after analysis | Debuggability versus screenshots on disk | Settled and landed: `keepFramesDays: 0` deletes a frame after successful analysis; the sweep is the fallback | Unchanged; the image patch (if it ships) respects it | 0.8.2 informs |
| D6 | **Suppression management surface** | A hard-suppressed idea must be clearable somewhere | Settled for 0.7.x: agent-only (`journal_review` unsuppress); no panel list | Unchanged; not on this line | — |
| D7 | **npm publication** | Publishing is hard to undo | Unanswered | **Do not publish**: "tagged here, not on the registry" stays true; publish only on explicit authorisation with a reviewed `npm pack` | 0.8.4 (publish step only) |
| D8 | **Lint finding destination** | A finding is only useful if seen, only trustworthy if not auto-"fixed" | Settled and landed (0.7.5): weekly digest plus at most one proposal per claim per week; no automatic supersede or forget | Unchanged | — |
| D9 | **Automatic memory writes** | "The agent may notice, only the user may decide" | Settled and landed: automation proposes into the queue; claims only through kept-item promotion | Unchanged | — |
| **D10** | **Phase 4 cutover authorisation**: flip `source: owned` for a fresh capture-enabled profile | A default change is visible to every fresh profile and hard to walk back socially, even when config-revertible technically | Unanswered | **No flip.** 0.8.3 stays scoped; the line closes at 0.8.4 with the slot deferred | 0.8.3 |
| **D11** | **Image admission go-ahead**: admit pixels through the attachment/vision contract | Once a pixel is sent it cannot be recalled; the new host contract is a compatibility event | Unanswered | **Text-only.** No `dsh-attachment` peer, no `includeImages`, no `privacy_apps` list; the whole line stays text-only | 0.8.2 |

**What is needed from the owner, and when:**

- Before **0.8.2** can be scheduled: D1 (`local` or `cloud`), D2 (a
  vision-capable provider/model), D11 (explicit go-ahead with size/retention
  caps). If D1 is `cloud`, the 3.6 limitation copy must be approved with it.
- Before **0.8.3** can be scheduled: D10 (explicit), D1 (at least `local` for an
  analysed week; `none` narrows the cutover to capture-only), D2 (a working
  model pair), plus the real-week entry criteria in §0.8.3.
- Before **0.8.4** can publish to npm: D7 (explicit). No answer means no
  publish and the line still closes.
- **Nothing is needed for 0.8.0 or 0.8.1.** They ship under the safe defaults
  above; that is the point of ordering them first.

**What changes if the owner answers.** D1=`local` + D2 + D11 unblock 0.8.2;
D1=`cloud` adds the 3.6 copy requirement and a higher review bar for the image
patch. D10 unblocks 0.8.3 once the real week is recorded. D7=yes adds a publish
step to 0.8.4 (reviewed tarball, token, 2FA), not a new patch. No answer changes
0.8.0/0.8.1, and no answer is a reason to reorder the line.

## 7. How to run one patch

1. Branch `patch/0.8.N-<theme>` from the previous **shipped** tag (`v0.7.6` for
   0.8.0; the previous 0.8.x tag after that).
2. Write the failing tests first from the patch's acceptance list, on the
   existing fake-adapter seam; 0.8.0's tests need no network, permission, or
   real clock.
3. Implement; keep the integration point single (`src/index.ts`), and for 0.8.0
   keep the gate order exactly as §0.8.0 A states it.
4. Update the patch's docs and the CHANGELOG `[Unreleased]` entry in the same
   commit; for a gated patch, quote the owner's answer and the §6 gate list in
   the PR description.
5. Run `npm test`, `npm run typecheck`, `npm run check:package`; review the
   config-defaults diff; for 0.8.2/0.8.3 re-run the relevant rehearsal or
   fresh-profile checklist and record it.
6. Cut the release with `npm run release -- patch` (it bumps, runs the suite,
   commits, tags, pushes, and creates the GitHub Release from the CHANGELOG
   section; it does **not** publish to npm).
7. Update the status column here and, only for work that landed, the roadmap's
   remain lines. A gated patch that did not ship stays "scoped" and moves to
   §0.8.4 D as a deferral.

If a patch discovers that its theme cannot ship default-safe, it stops at step 3
and the blocking decision moves into §6. A patch does not ship with a default
that changes behaviour without the owner's answer, and a gated patch does not
start before its gate list is met.
