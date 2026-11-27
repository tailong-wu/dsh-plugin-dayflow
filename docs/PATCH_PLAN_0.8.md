# Patch plan: the 0.8.x line

> **Frozen history.** The 0.8.x line closed at `v0.8.4` (2026-11-27). This file
> records that plan as it was executed; its in-progress and future-tense lines
> describe the past, not the present. The live state is in
> [`ROADMAP.md`](ROADMAP.md) and [`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md).

> **Status:** **the 0.8.x line is closing at its release-close patch.** 0.8.0 and
> 0.8.1 have landed and been released — `v0.8.1` is an annotated tag on commit
> `af002c3`, which is `main` HEAD and the commit that closed the patch, with a
> GitHub Release marked **Latest**; that tree is **537** green tests, schema
> **v10**, **18** panel routes (9 `GET` + 9 `POST`), **5** slash commands, **23**
> tools, **8** skills, and still **no npm publication** (the registry answers
> 404). **0.8.2 (image admission) and 0.8.3 (Phase 4 cutover) are formally
> deferred to the next line**, not planned: the owner did not answer
> D1/D2/D10/D11, so under O1/O3 the slots never started, do not ship, and are not
> renumbered. **0.8.4 (release close) has landed and is the line's last
> patch**; it flipped nothing, verified the release trail, kept npm unpublished
> by default, reconciled the docs to the final version map, and named the
> deferred slots. When `v0.8.4` is tagged, the line is closed at exactly **three tags —
> `v0.8.0`, `v0.8.1`, `v0.8.4`**. The 0.8 line stays **text-only** and keeps
> `source: dayflow` as its default. This plan was written against `v0.7.6`
> (annotated tag, commit `007c287`, which closed the 0.7.x line — seven tags and
> seven GitHub Releases, 494 green tests at that tag, the native port through
> Phase 3 text-only, Phase 4 rehearsed but not cut over) as the execution order
> for this line; the 0.7.x plan itself is frozen as history. What actually
> shipped in 0.8.0, and where it deviated from the finalised design, is recorded
> in **Landed shape and deviations** at the end of §0.8.0; the same record for
> 0.8.1 is at the end of §0.8.1; the final tag set, the deferred slots, and the
> next line's prerequisites are in §0.8.4.
>
> **Last revised:** 2026-11-27, against the `v0.8.1` tree (`af002c3`).
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
the registry on 2026-11-27, on the `v0.8.1` tree at `af002c3`; `npm test` was
re-run for this revision (**537 pass, 0 fail, 0 skipped, 0 todo** — 521 at
`v0.8.0` and 494 at `v0.7.6`, so 0.8.0 added 27 cases and 0.8.1 added 16), the
rehearsal was re-run (20/20 checks), and the release list was read (`v0.8.1` is
`Latest`, with `v0.8.0` and the seven 0.7.x releases beneath it). They are the
baseline the close and the next line assume; when an operation in this plan
invalidates one, it updates this table.

| Fact | Value | Checked at |
| --- | --- | --- |
| Baseline for this line | `0.8.1`, annotated tag `v0.8.1` (commit `af002c3`); `main` is the same commit. 0.8.0 was the line's first shipped patch and the baseline 0.8.1 was finalised against; 0.8.4 is the only patch this plan still has to execute | `package.json`, `git tag`, `git log` |
| Release trail | **Nine tags and nine GitHub Releases** on the 0.7.x/0.8.x range — `v0.7.0`–`v0.7.6`, `v0.8.0`, `v0.8.1`; the newest (`v0.8.1`) is marked Latest. Across the whole repository the trail is **18 tags / 17 Releases**: `v0.6.0` (`f871806`, 2026-11-11) is the one tag without a Release, predating the release train, and is recorded in §0.8.4 A as a known gap. Cut by `npm run release -- patch`, the tool 0.7.6 proved | `gh release list --limit 20`, `git tag`, `scripts/release.mjs` |
| npm | `npm view dsh-plugin-dayflow version` answers **404** — never published; D7 still unanswered, so the safe default stays "tagged here, not on the registry" | `npm view dsh-plugin-dayflow version` |
| Tests | 537 cases, green on the tag (`npm test`: 537 pass, 0 fail, 0 skipped, 0 todo; 521 at `v0.8.0`, 494 at `v0.7.6`). 0.8.1 added 16 cases in 3 files: `tests/briefs-read.test.ts` (new, 14), `tests/client-format.test.ts` (+1), `tests/panel-insights.test.ts` (+1), while `tests/panel.test.ts` gained no case — its two insights literals grew by `briefs: []`. CI runs macOS 15 with Node 22 (`--experimental-sqlite`) and Node 24 | `tests/*.test.ts`, `.github/workflows/ci.yml` |
| Tools / skills / commands | 23 tools registered by default (17 with `edits: false`) plus `dayflow_install_dayflow` behind `allowInstall: false`; 8 skills; 5 slash commands (`dayflow-task`, `dayflow-remember`, `dayflow-reflect`, `dayflow-analyze`, `dayflow-run-close`) — unchanged by 0.8.1 | `src/index.ts`, `src/tools/`, `src/commands.ts`, `tests/plugin.test.ts` |
| Panel | 18 exact host Fetch routes (9 GET + 9 POST), one UI entry (one header button, one panel tab), one insights payload — 0.8.1 grew the insights payload by the additive `briefs` list; no route changed | `src/panel-contract.ts`, `src/panel.ts`, `tests/panel.test.ts` |
| Owned schema | **v10** (`automation_runs` accepts `'lint'`; `briefs.payload_json`); 0.8.1 changed no migration and no table | `src/journal.ts` → `JOURNAL_SCHEMA_VERSION` |
| Native port | Phase 0 (provider + Swift helper) and Phase 1 (capture engine) landed in 0.7.0; Phase 2 (analysis pipeline + worker/status/panel) in 0.7.1–0.7.2; Phase 3's text-only automation slice in 0.7.4; the Phase 4 lint remainder in 0.7.5; **0.8.0 closed the three analysis-ledger follow-ups**; **0.8.1 made the stored briefs readable**. **Phase 4 itself is rehearsed only** — `source: owned` is not a default, no real week has been recorded, and the whole line is text-only because image admission is deferred with 0.8.2 | `src/capture/`, `src/analyse/`, `src/briefs/`, `src/automation/`, `docs/NATIVE_PORT.md` |
| Phase 4 rehearsal | `docs/CUTOVER_REHEARSAL.md` plus `npm run rehearsal`: a repository-side fixture dry run (fake provider, scripted analyser, throwaway journal) that walks capture → analysis → day close → day insights → weekly lint → weekly brief → reopen; **20/20 checks passed** on 2026-11-27 at `v0.7.6` and was re-run green on the `v0.8.1` tree (0.8.1 changed no input the fixture exercises), restart delta zero. Neither the script nor its test ships in the tarball. The written real-capture step needs the owner and Screen Recording permission and was **not** run | `npm run rehearsal`, `docs/CUTOVER_REHEARSAL.md` §2 |
| 0.8.1's own scope | One theme, one integration point: the reading view. New `src/briefs/read.ts`; `src/panel-contract.ts` gains the type re-export and one additive field; `src/panel.ts` wiring; `src/client/insights.tsx`, `locale.ts`, `styles.ts`; 4 test files touched. No schema, route, command, tool, skill, config key, default, host peer, or dependency change; **no model call**. Tagged `v0.8.1` and released as Latest | `git diff v0.8.0..v0.8.1 --stat` |
| Host cohort | DSH dev dependencies `0.2.1-rc.2`, peers `^0.2.0-rc.2`. `@deepseek-ai/dsh-llm` is declared and used through a structural seam; `@deepseek-ai/dsh-attachment` is **not** a dependency — that is what keeps the line text-only and what deferred 0.8.2 | `package.json`, `src/analyse/host.ts` |
| Owner decisions | D1 (analysis destination) unanswered; D2 (provider/model) settled as explicit configuration; D3 (budget) caps configured and **both** gates enforced since 0.8.0 (calls pre-call, tokens post-call with a pre-call already-spent guard); D7 (npm) unanswered; **D10/D11 unanswered — the reason 0.8.2 and 0.8.3 are deferred to the next line**. D4/D5/D6/D8/D9 remain as [PATCH_PLAN.md](PATCH_PLAN.md) §6 records them | `PATCH_PLAN.md` §6, `docs/CONFIGURATION.md` |

**Landed on the 0.7.x line, therefore not in this plan:** the owned schema and
importer, the read tools, the review queue, long tasks, dated memory, the
budgeted memory context, reflections, the scheduled lint and its digest, the
interactive insights panel, the native capture engine, the analysis pipeline
and worker, the automation scheduler with `automation.catchUpDays`, the panel's
capture / analysis / close lines, the 18 routes, the 5 commands, the 23 tools,
and the 8 skills. All of it is tagged, tested, and released. **Landed on this
line:** 0.8.0 (the ledger follow-ups, +27 cases) and 0.8.1 (the briefs reading
view, +16 cases) are tagged, tested, and released too; §0.8.0 and §0.8.1 record
their shipped shape and deviations.

**The three debts this line was opened to pay — and 0.8.0 paid all three.**
0.7.2 left three ledger holes and 0.7.2–0.7.6 deliberately did not fill them,
because each patch kept one theme:

1. **The token cap was not a gate.** `GET /api/dayflow/analysis/status` showed
   `tokensToday` and `dailyTokenBudget`, and `analysisTokenTotalsForDay` existed
   in `src/analyse/jobs.ts`, but only the call cap (`maxCallsPerDay`) was
   enforced, so a provider whose input tokens were large could spend far past
   the token number the profile showed. 0.8.0 makes the token budget a
   post-call gate with a pre-call already-spent guard.
2. **Skipped windows were terminal.** `skipped` was written when the consent
   gate, the pause flag, or an unset provider/model/analyser refused a window,
   and the pipeline's idempotency rule treated `skipped` like `complete`, so
   fixing a config mistake after a blocked day never analysed that day. 0.8.0
   replays the configuration-caused skips for today and yesterday, and never
   the money ones.
3. **The 04:00 day boundary dropped the tail.** The worker ran the pipeline for
   `dayWindowContaining(now)`, so the last window before the boundary (frames
   captured between the final pre-boundary tick and 04:00) belonged to the old
   day and was never analysed: after 04:00 every tick asked for the new day.
   0.8.0 runs one bounded tail for yesterday per boundary behind a persistent
   checkpoint.

All three landed together in `v0.8.0`, decision-free and with no schema, route,
command, tool, skill, config key, or default change. The exact shipped shape,
and the places where implementation diverged from this plan, are in **Landed
shape and deviations** at the end of §0.8.0.

**What is deliberately not in this plan:** the owned-journal write path (the
editing tools still go through Dayflow), the `dsh dayflow import` CLI, the
month/week panel goal and rating surfaces, the `review.cards` switch (the plugin
has no card stack, so the switch has no surface), task tagging from the
summarization prompt, automatic activity attribution, embeddings, Phase 5, and
any change to the Swift helper's permissions. Image admission and the Phase 4
cutover **were** scoped in this plan as the owner-gated patches 0.8.2 and 0.8.3;
the owner did not answer, so both are **deferred to the next line** (§0.8.2,
§0.8.3), no 0.8 tag carries them, and the 0.8 line stays text-only with
`source: dayflow` as the default.

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
Every patch in this plan is either inert under the safe defaults of §6 (0.8.0,
0.8.1, 0.8.4) or explicitly deferred until the owner answers (0.8.2, 0.8.3). A
patch does not "partially land" a gated theme; an inert stub of a feature is not
a deliverable, because it is surface with no user and no acceptance. **The line
held this rule:** the three decision-free patches shipped or are shipping, and
the two gated patches never started — no stub, no placeholder config key, no
half a host peer.

**O2 — Every default-sensitive patch proves its default.** The config-defaults
diff is reviewed as part of the patch, and there is a test that a profile with
defaults runs nothing new. 0.8.0 shipped that test: the patch both *gates
spending* and *starts spending* (the day tail), and the safe default is shown
inert — capture off and/or `consent: none` still means no call, no tail call,
and no journal creation by the status read. 0.8.1 added no call path, so its
default proof is the empty read-only Briefs section: a fresh install answers
`briefs: []` and the read creates no journal. 0.8.4 adds no code path at all.

**O3 — Version slots are semantic, and a deferred slot does not renumber the
line.** 0.8.2 is the image slot and 0.8.3 is the cutover slot. If the owner has
not answered by the release close, those patches do not ship, the close is
still 0.8.4, and its release notes name the slots deferred. The only
renumbering allowed is a split of 0.8.0 **before its tag** (see §5). This keeps
the plan, the tags, and the docs from disagreeing about what a version means.
**That is what the line did:** with D1/D2/D10/D11 unanswered at the close,
0.8.2 and 0.8.3 did not ship and are not renumbered — the line's tags are
`v0.8.0`, `v0.8.1`, `v0.8.4`, and the two deferred slots move to the next line
with their scope intact.

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
would have been where that changed, deliberately and with a fallback — it is
deferred to the next line, so the 0.8 line adds no host peer and stays text-only
(verified: `@deepseek-ai/dsh-attachment` is not a dependency of the tagged
tree).

**O6 — The release train continues.** One tag and one GitHub Release per
shipped patch, release notes from the CHANGELOG section, no npm publish without
D7. 0.7.6 proved the tool; this line uses it for every tag rather than
backfilling afterwards.

## 3. The patches

### 3.1 Summary

| Patch | Theme | Roadmap item | Depends on | Decisions | Risk | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **0.8.0** | **Analysis ledger follow-ups:** the token budget becomes a post-call gate, transient skips replay for today and yesterday, and the 04:00 boundary gets a one-shot day-tail run | Native port Phase 2 remainder / analysis ledger | — (built on `v0.7.6`) | D3 caps only (safe default) | Medium | **landed** — `v0.8.0` (`f4191b9`; GitHub Release Latest until 0.8.1), 521 tests; shipped shape and deviations in §0.8.0 |
| **0.8.1** | **Briefs reading view:** the stored day/week briefs appear in the insights payload and the existing panel view; no new tab, no new route, no model call; 537 tests (521 at 0.8.0) | Phase 3 standup/brief surface | 0.8.0 tree (`v0.8.0`) | none | Low | **landed** — `v0.8.1` (`af002c3`, GitHub Release Latest), 537 tests; shipped shape and corrections in §0.8.1 |
| **0.8.2** | **Image admission (owner-gated):** an optional host attachment/vision contract, a config-gated image path, the `privacy_apps` redaction list and the Roadmap 3.6 limitation copy; default `includeImages: false` and fully inert | Native port Phase 2 image slice / Roadmap 3.6 | next line (not built on the 0.8 tree) | **D1, D2, D11** | High | **deferred to the next line** — the owner has not answered; never started; scope kept in §0.8.2; no 0.8 tag |
| **0.8.3** | **Phase 4 cutover (owner-gated):** `source: owned` becomes the default for a fresh capture-enabled profile with no Dayflow database, the first-run walkthrough lands, and the real week is recorded | Native port Phase 4 / 1.0.0 prerequisite | next line (real week) | **D1, D2, D10** | High | **deferred to the next line / 1.0.0 prerequisite** — the owner has not answered; never started; scope kept in §0.8.3; no 0.8 tag |
| **0.8.4** | **Release close:** every shipped 0.8.x tag gets its release, the npm state is settled without publishing, docs and counts are reconciled, the deferred slots are named, and the next line's prerequisites are recorded | Release closure | everything shipped | D7 (publish only) | Low | **landed** (`v0.8.4`) — the line's last patch; flips nothing; executable checklist in §0.8.4 |
| *0.8.5* | *Reserved contingency — not used: 0.8.0 was tagged whole, so the pre-tag split window (§5.5) is closed. Not planned work.* | — | — | — | — | *reserved, unused* |

Order rationale: 0.8.0 went first because it was decision-free, closed the three
named debts, and made the money ledger honest **before** anything could flip a
default — it shipped as `v0.8.0`; 0.8.1 came second because it is the
decision-free visible win that made 0.7.4/0.7.5's stored output readable for the
first time — it shipped as `v0.8.1`; the gated 0.8.2/0.8.3 were to follow in the
roadmap's own order (image before cutover) so the default flip would be the last
functional change of the line, but the owner did not answer, so they are deferred
to the next line rather than shipped or renumbered; 0.8.4 closes the line and
flips nothing. Details in §5.

### 0.8.0 — Analysis ledger follow-ups

**Status: landed and released** — annotated tag `v0.8.0` on commit `f4191b9`,
GitHub Release marked Latest at the time (`v0.8.1` is Latest since), 521 green
tests, schema still **v10**. One theme
(R1): *the analysis ledger becomes money-bounded and self-healing instead of a
timer with three holes.* It is decision-free: it added no model, no host peer,
no schema change, no route, no command, no tool, and no configuration key.
Sections A–C below are the finalised design the implementation started from;
where the plan's own text would now mislead, it has been corrected in place, and
every correction is listed in **Landed shape and deviations** at the end of this
section, which is authoritative where the two disagree.

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

*As shipped, one guard is added between steps 1 and 2 — a **pre-call
token-already-spent check** — and the post-call gate is skipped when the
crossing lands on the run's last window. Both are part of the money contract
and are recorded in **Landed shape and deviations**.*

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

**Mechanics (as shipped).** The whitelist and the replay live together in the
new pure module `src/analyse/skips.ts`: `TRANSIENT_SKIP_REASONS` (the eight
configuration reasons in the table above) plus `isTransientSkipReason`, and
`replaySkippedAnalysisWindows({ journalPath, now, daysBack = 1, limit = 200 })`
performs one bounded pass over **today and yesterday** (the 04:00-bounded day
windows; never older days). The pass:

- moves a row `skipped → queued` with a **conditional** `UPDATE` (`WHERE id = ?
  AND status = 'skipped'`), so a race between a worker tick and a manual
  `/dayflow-analyze` cannot replay the same row twice; a lost race counts the
  window as skipped;
- leaves `attempts` untouched and does **not** reset a counter: a skip never
  consumed an attempt, so a replayed window starts at attempt 1 of 2 exactly
  like a fresh window, and a replayed call that fails is handled by the existing
  `ANALYSIS_MAX_ATTEMPTS` logic (a `failed` window is never treated as a skip);
- preserves the previous skip reason in the existing `analysis_jobs.payload_json`
  column as `replayed_from` / `replayed_at` (alongside the row's previous
  payload keys), so the reason does not disappear when `error` is cleared at
  start;
- classifies every candidate first and requeues only the transient ones; the
  pass reports `considered` / `replayed` / `byReason`, so a permanent skip is
  counted but never moved.

`startAnalysisJob` is **not** relaxed, and the pipeline's idempotency branch is
**not** relaxed either: a `skipped` job is still terminal inside a run. The
replay is a worker-level step that runs *after* the day's own pipeline run, and
only when that run was not `blocked`, so the tick after a configuration repair
requeues the rows and the next tick analyses them; yesterday's replayed windows
are picked up by the day tail that runs immediately after in the same tick.

**Bounding.** The pass considers today plus `daysBack` earlier days (yesterday
by default; `daysBack` 0–366 and `limit` 1–1000 are per-pass bounds, not
configuration keys) — there is no sweep over older days, no replay on plugin
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

**What it does.** On the first tick after a day boundary, after today's run —
and after the catch-up pass of part B when that pass runs — the worker runs the
pipeline **once for yesterday**. A checkpoint key
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
  own `try/catch`; a tail failure is logged (`analysis.day_tail`), never turns a
  good tick into a failed one, and never enters the backoff count. As shipped it
  *is* recorded on the worker's `lastError` (a deviation from the plan's
  "today's run keeps `lastError` untouched"); `lastOutcome` and the loop stay
  the day's own.

**What bounds the tail.** One day; yesterday's own remaining call and token
budgets; stored frames only. The existing `maxWindows` option is deliberately
**not** used for the tail: it slices the window list from the first window, so
it would re-walk already-complete windows and never reach the tail. The tail's
cost is bounded by the budget gates and the ledger's idempotency instead, and a
"bounded run" here means one day, not one window count.

**Where the checkpoint lives.** The existing runtime key/value table
(`capture_state`), through two generic helpers added beside the typed capture
state — shipped as `readCaptureStateValue(db, key)` /
`writeCaptureStateValue(db, key, value)` — and `previousDayKey(dayKey)` added to
`src/day.ts` (a pure calendar-day step, so it is DST-safe). No migration.

> Rejected alternative: schema **v11** with a dedicated `analysis_state` table.
> It is a table for one key, it puts a migration in the first patch of the line,
> and it creates a downgrade boundary for no behaviour. The `capture_state`
> table is already described as "a tiny key/value table rather than a
> configuration row"; the analysis checkpoint is the same kind of thing. If a
> second analysis checkpoint appears later, moving to a dedicated table is a
> later patch's decision, not this one's.

#### File-level deliverables (as shipped)

| File | Change |
| --- | --- |
| `src/analyse/skips.ts` | **new.** `TRANSIENT_SKIP_REASONS` (the eight configuration reasons), `isTransientSkipReason`, and `replaySkippedAnalysisWindows` (bounded today+yesterday pass, conditional requeue, `replayed_from`/`replayed_at` audit); pure policy, no model call, no configuration. |
| `src/analyse/pipeline.ts` | Pre-call already-spent token guard, post-call token gate (reason `budget-tokens`), `budgetKind: 'calls' \| 'tokens'`, and the reason parameter on `skipRemainingForBudget`. |
| `src/analyse/worker.ts` | Catch-up call after a non-blocked run; the day tail after it (own `try/catch`, `analysis.day_tail` logging); checkpoint read/write; `previousDayKey` use. |
| `src/analyse/status.ts` | Additive `tokenBudgetExhausted` computed from the ledger (pure read, no journal creation). |
| `src/day.ts` | `previousDayKey(dayKey)`, a pure calendar-day step (tests cover a day step and refusal of non-days). |
| `src/capture/state.ts` | Generic `readCaptureStateValue` / `writeCaptureStateValue` beside the typed helpers (no new table). |
| `src/client/insights.tsx`, `src/client/locale.ts` | One amber analysis state and two locale keys (`analysisTokenBudget`, `analysisTokenBudgetHint`), EN + ZH; no new control. |
| `src/panel-contract.ts` | **Unchanged** as shipped: the status type lives in `src/analyse/status.ts` and the contract re-exports it; no route constant changed. |
| `src/analyse/jobs.ts` | **Unchanged** as shipped: no new helper; `analysisTokenTotalsForDay` stayed the single ledger sum, and `replaySkippedAnalysisJob` was not added (the replay is the pass in `skips.ts`). |
| `tests/analyse-skips.test.ts` (new), `tests/analyse-pipeline.test.ts`, `tests/analyse-status.test.ts`, `tests/analyse-worker.test.ts`, `tests/capture-state.test.ts`, `tests/day.test.ts`, `tests/client-format.test.ts`, `tests/panel-insights.test.ts` | 27 new cases (listed under Landed shape and deviations). |
| `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `docs/NATIVE_CAPTURE.md`, `docs/NATIVE_PORT.md`, `docs/PANEL.md`, `docs/ROADMAP.md`, `CHANGELOG.md`, `README.md`, `README.zh.md` | Docs travelled with the tag (R6); all landed before or in `v0.8.0`. |

#### Acceptance (the patch's own test list)

All items below passed at `v0.8.0`; the deviations are named in the subsection
that follows. The 27 new cases carry them.

- [x] A day whose first completed call records tokens at or above
      `dailyTokenBudget` makes **no second call**; remaining windows are
      `skipped` with reason `budget-tokens`; the completed row keeps its usage;
      `outcome: 'budget'`, `budgetKind: 'tokens'`.
- [x] A token gate that trips on the **last** window does not report
      `outcome: 'budget'` (nothing was stopped); `tokenBudgetExhausted` is still
      true for the day.
- [x] The call gate still wins when it trips first: `budgetKind: 'calls'`,
      reason `budget`, unchanged behaviour.
- [x] A run that starts after an earlier crossing makes no call at all: the
      pre-call already-spent guard refuses the window before it starts, so a
      second run on the same day cannot spend a second crossing call.
- [x] A new day key starts a fresh budget; a later run for the same day sees the
      same spent total.
- [x] NULL/absent usage counts as zero and cannot trip or hide the gate.
- [x] A run blocked by `consent:none` (or `provider-unset`, `model-unset`,
      `paused`, `analyser-unset`) and then repaired has exactly the skipped
      windows requeued on the next non-blocked tick's catch-up pass, analysed
      one call per window by the following run (yesterday's in the day tail of
      the same tick), with no duplicate card — the existing unique
      `(source_id, source_key)` keys stay the second guard.
- [x] `budget`, `budget-tokens`, `failed`, and unknown reasons are **not**
      replayed; attempts are never reset; the audit payload keeps the last skip
      reason as `replayed_from` / `replayed_at`; a transient reason on a
      non-`skipped` row is not requeued.
- [x] At a fixed clock just after 04:00, one tick closes yesterday's tail and
      analyses today as before; a second tick on the same day does not repeat
      the tail; a restart on the same day does not repeat it.
- [x] A **blocked** tail retries on the next tick and replays once the gate
      opens; a tail that throws leaves the checkpoint unwritten, does not fail
      the tick, and is retried.
- [x] Default profile: capture off or `consent: none` means no call, no tail
      call, and no journal creation by the status read; a blocked run does not
      run the catch-up.
- [x] The additive `tokenBudgetExhausted` status field is a pure read, and the
      panel's amber state is drawn before the stopped/idle tones in both
      languages.
- [x] Route set stays exactly **18**; commands stay **5**; tools/skills
      unchanged; schema stays **v10**; no config key added (the defaults diff is
      empty).
- [x] The suite makes no network call and uses the existing fake analyser seam
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
- **Order of implementation inside the patch (kept):** token gate first, then
  catch-up, then tail — and the token gate shipped in the same tag, because the
  tail is the first path that can spend without the owner watching. Shipping
  the tail without the gate would have been exactly the failure mode D3 exists
  to prevent. The pre-call already-spent guard was added during implementation
  and is the one contract addition recorded in Landed shape and deviations.
- **Rollback:** no schema change, so the tag is revertible and an older build
  can still open the journal (R8); at the profile level, `analysis.consent:
  none` (or capture off) stops every call the patch can make, and
  `analysis.enabled: false` unmounts the worker entirely. There is no state the
  rollback has to undo beyond one key/value checkpoint and ledger rows that were
  already append-only.

#### Definition of done

Done at `v0.8.0`: the shared checklist in §4, this section's (now checked)
acceptance list, the docs above (all landed with the tag), and the
`CHANGELOG.md` `[0.8.0]` section naming the three follow-ups in one line each
and stating that the default profile still spends nothing. The suite grew
494 → 521.

#### Landed shape and deviations (0.8.0)

Checked against the `v0.8.0` tree (`f4191b9`), `git diff v0.7.6..v0.8.0`, and
the landed tests. Where this subsection and the plan text above disagree, this
subsection is what shipped.

**The gate order that shipped.** Per run, the consent and analyser gates run
first (they are run-level: no window job is started while they refuse). Per
window, the order is:

1. **idempotency** — `complete` / `skipped` / stale `running` / exhausted
   `failed` windows are never started again; `skipped` stays terminal, because
   the pipeline was **not** given a replay branch;
2. **calls pre-call gate** — `countAnalysisCallsForDay >= maxCallsPerDay` skips
   the rest with reason `budget`, `budgetKind: 'calls'`;
3. **token-already-spent pre-call guard** — the added step. The day's recorded
   tokens are read *before* a call; at or above `dailyTokenBudget` the remaining
   windows are skipped with reason `budget-tokens`, `budgetKind: 'tokens'`.
   This is what stops a *later* run (or the day tail) from spending a second
   crossing call after an earlier run crossed the cap. The plan had no pre-call
   token check; this is the one behavioural addition beyond it;
4. **start → call → complete + write** — a paid call stays complete;
5. **post-call token gate** — re-reads the ledger only when another window
   remains (`index + 1 < limit`). A crossing on the run's last window stops
   nothing and the run keeps `analysed`; the next run is refused by step 3. A
   failed re-read after a paid window is swallowed (the spend is already
   recorded) and never turns a paid window into a failure.

`budgetKind` is exactly `'calls' | 'tokens'` and appears only with
`outcome: 'budget'`; `blockedReason` still appears only with `blocked`, and no
`blockedKind` exists.

**What did not land as planned, and why.**

- **No `jobs.ts` change.** `analysisTokenBudgetExhausted` and
  `replaySkippedAnalysisJob` were not added. The status route computes
  `tokenBudgetExhausted` from the existing `analysisTokenTotalsForDay` +
  `dailyTokenBudget`, and the pipeline has a private `tokenBudgetReached` helper
  over the same sum; keeping `analysisTokenTotalsForDay` the single ledger read
  was simpler than a second helper. `src/analyse/jobs.ts` is untouched by the
  patch.
- **No `panel-contract.ts` change.** The status payload type lives in
  `src/analyse/status.ts`, and the contract re-exports it; adding the field
  needed no contract edit and no route constant changed (routes stay 18).
- **The catch-up is a worker-level bulk pass, not a pipeline replay branch.**
  `src/analyse/skips.ts` exports `TRANSIENT_SKIP_REASONS`,
  `isTransientSkipReason`, and `replaySkippedAnalysisWindows`; the pass requeues
  the rows and the *next* run analyses them (yesterday's are picked up by the
  day tail that follows in the same tick). This keeps the pipeline idempotency
  rule ("a skip is terminal") intact and makes the replay one conditional
  `UPDATE` with a lost-race-safe result. The audit object landed as
  `replayed_from` / `replayed_at`, not `last_skip`; the row's previous payload
  keys are preserved.
- **Catch-up needs the gate open, and runs after the day's run.** The worker
  runs today's pipeline, then — only when that run was not `blocked` — the
  catch-up pass, then the day tail. Requiring a non-blocked run is what avoids
  requeue/re-skip oscillation. A catch-up failure logs `analysis.catch_up` and
  leaves `lastOutcome` / `lastError` untouched.
- **The tail records a throw on `lastError`.** The plan said a tail failure
  would not touch the worker's `lastError`; the shipped code sets it (and logs
  `analysis.day_tail`). `lastOutcome`, the backoff count, and the loop are still
  untouched, so the tail still cannot fail the tick or change today's outcome.
- **The checkpoint helpers are named `readCaptureStateValue` /
  `writeCaptureStateValue`** (not `readStateValue` / `writeStateValue`) and are
  generic over `capture_state` keys. `previousDayKey` is a pure calendar-day
  step in `src/day.ts`, not a millisecond subtraction.
- **Panel copy shipped as two locale keys and one amber tone**
  (`analysisTokenBudget` / `analysisTokenBudgetHint`, EN + ZH), drawn after the
  consent block and before the stopped/idle split. No new style file, no button,
  no route.

**Surface check.** Schema stays **v10**; routes stay exactly **18** (9 GET + 9
POST); commands stay **5**; tools (23, plus `dayflow_install_dayflow` behind its
flag) and skills (8) are unchanged; no config key, default, host peer, or
dependency was added; the suite is **521** (27 new cases) and stays network-free
on the fake analyser seam.

**Verification (the 27 new cases, by file).**

- `tests/analyse-pipeline.test.ts`: the post-call gate skips the rest of the
  run; a crossing on the last window stops nothing; a spend below the budget
  analyses every window.
- `tests/analyse-skips.test.ts` (new): only the eight configuration reasons are
  transient; the pass covers today and yesterday; `daysBack` widens one day at a
  time; `limit` caps one pass; attempts are not reset; a malformed payload is
  replaced by the audit object; the window follows the 04:00 boundary, not the
  calendar instant; a transient reason on a non-`skipped` row is not requeued;
  an empty journal replays nothing and the default clock is used; malformed
  parameters are `invalid_input`.
- `tests/analyse-status.test.ts`: `tokenBudgetExhausted` turns true only once
  the day's tokens reach the budget; absent usage counts as zero.
- `tests/analyse-worker.test.ts`: catch-up requeues a transient skip for the
  next tick; a blocked gate does not run the catch-up; the first tick of a day
  closes yesterday's tail once and checkpoints today; a second tick and a
  same-day restart do not repeat it; a blocked tail writes no checkpoint and
  retries; a failed tail leaves the day's outcome alone and is retried.
- `tests/capture-state.test.ts`: a generic value round-trips under any key; an
  empty key is refused.
- `tests/day.test.ts`: a day key steps back exactly one calendar day;
  `previousDayKey` refuses labels that are not days.
- `tests/client-format.test.ts`: the analysis line names the spent daily token
  budget in both languages.
- `tests/panel-insights.test.ts`: the analysis status payload carries the
  additive `tokenBudgetExhausted: false` without creating the journal.

### 0.8.1 — Briefs reading view

**Status: landed and released** — annotated tag `v0.8.1` on commit `af002c3`,
GitHub Release marked Latest, 2026-11-27, **537** green tests (521 at `v0.8.0`),
schema still **v10**. The implementation shipped in three scopes whose shape this
section fixes: the host read module + payload + tests, the client section + copy
+ styles + tests, and the docs. One theme (R1): *the journal's most condensed
output becomes readable where the rest of the journal is read — one entry, no new
tab, no model call.* The shipped shape, and the places where implementation
diverged from this design, are in **Landed shape and corrections** at the end of
this section.

**Motivation.** 0.7.4's weekly close writes one `briefs` row per week (with
0.7.5's `Memory health: …` digest and `payload_json.memory_health`), and the
daily close writes a standup into `daily_standup_entries`. Both are stored,
both are summarised text a person would actually read, and the panel renders
**neither**: the only way to read them is a tool call. The roadmap has carried
the "briefs reading view" as remaining work since the 0.7 line closed, and the
tools are the only reader today. This patch is that view.

**Shape.**

- **Payload, not a route.** `GET /api/dayflow/insights` gains an additive
  `briefs: PanelBriefSummary[]` field. The route set stays exactly 18; there is
  no second GET for a list an existing call can carry, and no second panel
  request. Additive means an old client is unaffected.
- **One read module.** New `src/briefs/read.ts`, a pure reader that exports
  `PanelBriefSummary` (`kind: 'day' | 'week'`, `period_key`, `title`, `body`,
  optional `model`, `updated_at`, optional `memory_health` as
  `{ findings, proposals, summary }` when the weekly digest is present),
  `PANEL_BRIEF_DEFAULT_LIMIT = 10`, `PANEL_BRIEF_MAX_LIMIT = 20`, and
  `listPanelBriefs(journalPath, { limit?, now? })` (async; `now` is an
  injectable clock for tests). It:
  - reads the live `briefs` rows of both kinds via the existing `listBriefs` in
    `src/automation/store.ts`, carrying `title` / `body` / `model` /
    `updated_at` and the `payload_json.memory_health` value when present;
  - reads the most recent native standups from `daily_standup_entries` with
    `source_id = 'native'` and `is_deleted = 0`, newest `standup_day` first, and
    normalises each into a day entry using the existing decoder shape
    (highlights / tasks / blockers): `kind: 'day'`, `period_key = standup_day`,
    title `Standup · <day>`, body as plain `- ...` lines (the title line when
    the payload has no content), `updated_at` from the row's `updated_at`
    (falling back to `created_at`);
  - de-duplicates per `(kind, period_key)` and prefers the `briefs` row;
  - sorts by `period_key` descending (ties by `updated_at` descending) and caps
    at `limit` (default 10, 1..20; anything else is `invalid_input`).
  A missing or unreadable journal answers `[]` without creating the file, the
  same tolerance the rest of the insights payload has; a malformed brief or
  standup `payload_json` is degraded, never thrown; it calls no model and writes
  nothing.
- **Contract additions.** `src/panel-contract.ts` gains `PanelBriefSummary` and
  one required additive field on `PanelInsights`: `briefs:
  PanelBriefSummary[]`. The client uses the type only, so the client bundle
  gains no runtime dependency on the server module. `buildPanelInsights`
  (`src/panel.ts`) fills the field without a write path and extends its empty
  literal from four lists to five, keeping the "missing journal answers empty
  lists and never creates the file" rule. No route constant changes.
- **One client section.** The existing Journal insights view gains a read-only
  `Briefs` block after reflections (tasks → review → memory → reflections →
  briefs). Each entry is a collapsed row with a day/week badge, the title, and
  its updated date; activating the row expands the body (activating it again
  collapses), with `aria-expanded` and keyboard operation. The weekly
  memory-health paragraph is part of the brief body, so it shows inside the
  entry, not as a second surface. Empty data shows one localized empty line, and
  the `isBlank` / empty-state check grows from four lists to five. No new tab,
  header button, settings page, or control (R9).
- **No new surface.** No config key, schema change, route, command, tool, skill,
  host peer, or dependency; no model call; the default profile sees an empty,
  read-only section.
- **Locale keys** in `src/client/locale.ts`: section title, the two badges, the
  empty line, and the expand/collapse labels — EN and ZH, with the two
  dictionaries kept key-identical (the existing test enforces it).
- **Styles** in `src/client/styles.ts`: badge, row, expanded body, and narrow
  sidebar wrapping, reusing the existing `--dsw-*` tokens and card style.

**File-level deliverables:** `src/briefs/read.ts` (new), `src/panel-contract.ts`
(type + additive field), `src/panel.ts` (`buildPanelInsights`),
`src/client/insights.tsx` (section), `src/client/locale.ts`,
`src/client/styles.ts`, `tests/briefs-read.test.ts` (new),
`tests/panel-insights.test.ts`, `tests/client-format.test.ts`, plus docs
(`docs/PANEL.md`, `docs/NATIVE_PORT.md`, `README.md`, `README.zh.md`,
`CHANGELOG.md`, this file, `docs/ROADMAP.md`). No change outside these files.

**Acceptance:**

- [x] The insights payload contains the week brief with its memory-health digest
      paragraph and the additive `briefs` array; the empty literal has five
      lists, and a fresh install answers `briefs: []` without creating the
      journal.
- [x] A day with only a native standup appears as a day entry with the
      `Standup · <day>` title and a plain-line body; a `briefs` day row and a
      standup for the same day de-duplicate to one entry, with the `briefs` row
      winning.
- [x] Deleted standups (`is_deleted = 1`) are hidden; a malformed
      `payload_json` degrades to an empty/partial entry and never throws the
      route.
- [x] Order (`period_key` descending, ties `updated_at` descending) and the cap
      (10 by default, 20 maximum, invalid `limit` refused) are asserted.
- [x] The route set stays exactly 18, the single-entry test is unchanged, no
      model adapter is involved, and the default profile shows the empty
      section.
- [x] The payload stays read-only: repeated reads leave the journal
      byte-for-byte unchanged (the existing read-only proof extends to briefs).
- [x] Both locales carry every new string and the dictionaries are
      key-identical; the client bundle test passes and the workspace
      typechecks.
- [x] No new config key, schema version, route, command, tool, skill, peer, or
      dependency; no style outside `src/client/styles.ts`.

**Decisions:** none — 0.8.1 shipped under the safe defaults of §6, like 0.8.0.
**Risk:** payload growth (bounded by the cap of 10 and by brief length, which the
prompts already cap) and duplicate-looking day/week entries (mitigated by the
badges and the dedupe rule). **Rollback:** the field is additive and the section
is read-only; reverting removes UI and payload field with no state to migrate
and no schema change.

**Definition of done:** the shared checklist in §4, this section's acceptance
list, the docs and `CHANGELOG.md` `[0.8.1]` entry landed with the tag, and the
counts surfaced there (**18** routes, **5** commands, schema **v10**) stayed
unchanged.

#### Landed shape and corrections (0.8.1)

Checked against the `v0.8.1` tree (`af002c3`), `git diff v0.8.0..v0.8.1`, and the
landed tests. Where this subsection and the plan text above disagree, this
subsection is what shipped.

**The payload that shipped.** `GET /api/dayflow/insights` answers `PanelInsights`
with one new required additive list, `briefs: PanelBriefSummary[]`; an old client
ignores it. `buildPanelInsights`'s empty literal grew from four lists to five, so
a missing journal answers five empty lists and is never created by the read. The
route set stays exactly **18** (9 `GET` + 9 `POST`), there is no second insights
request, and the one-UI-entry test
(`tests/client-bundle.test.ts`: one tab, one header button) is untouched. The
payload is built on the same journal connection the rest of the insights payload
opens — the briefs read is one more query, never a second open.

**The read module (`src/briefs/read.ts`, new, 319 lines).** It exports
`PanelBriefSummary` (`kind: 'day' | 'week'`, `period_key`, `title`, `body`,
optional `model`, `updated_at`, optional `memory_health`), the
`PanelBriefMemoryHealth` block (`findings`, `proposals`, `summary`),
`PANEL_BRIEF_DEFAULT_LIMIT = 10`, `PANEL_BRIEF_MAX_LIMIT = 20`,
`ReadPanelBriefsOptions`, `ListPanelBriefsOptions`, `readPanelBriefs(db, { limit? })`
and `listPanelBriefs(journalPath, { limit?, now? })`. Behaviour, as shipped:

- `briefs` rows of both kinds are read through the existing `listBriefs` store
  function, mapped field for field, and `payload_json.memory_health` is passed
  through only when `findings`, `proposals`, and `summary` are all well formed;
- native standups are read from `daily_standup_entries` with
  `source_id = 'native'` and `COALESCE(is_deleted, 0) = 0`, newest `standup_day`
  first and bounded by the maximum limit; each becomes `kind: 'day'`,
  `period_key = standup_day`, title `Standup · <day>`, body rendered as plain
  `- ` lines from `highlights` and `tasks` (string or `{ text }` entries) and
  from `blockersBody`'s non-empty lines, with `updated_at` falling back from
  `updated_at` to `created_at` to `''`;
- a `(kind, period_key)` pair appears once: the `briefs` row wins over a native
  standup for the same day;
- the merged list sorts by `period_key` descending, ties by `updated_at`
  descending, and is capped at `limit`; an absent limit is 10, and anything
  outside 1–20 is `DayflowError('invalid_input')` even without a journal;
- malformed `payload_json` degrades (title line, no throw); a missing or
  unreadable journal answers `[]` and creates no file; the read calls no model
  and writes nothing.

**Deviations from the plan, and why.**

- **The type lives in the read module, not the contract.** The plan put
  `PanelBriefSummary` in `src/panel-contract.ts`; it shipped in
  `src/briefs/read.ts`, and the contract re-exports it type-only
  (`export type { PanelBriefMemoryHealth, PanelBriefSummary } from
  './briefs/read.js'`) and adds the field. One definition, and the client bundle
  still takes only a type from the contract.
- **There is a second exported reader.** The plan named
  `listPanelBriefs(journalPath, …)` only; the shipped module also exports
  `readPanelBriefs(db, …)` so `buildPanelInsights` reads on the connection it
  already opened. `listPanelBriefs` remains the path-level face and answers `[]`
  for a missing or unreadable journal.
- **`now` is accepted but clock-free.** `listPanelBriefs` takes the same
  injectable-clock option as the write paths for symmetry, but the order comes
  from stored period keys, so a pinned clock cannot change the result; a test
  asserts exactly that.
- **A plain `body` payload field is a standup fallback.** The plan rendered
  standups from highlights/tasks/blockers only; the shipped decoder also reads
  our own daily close's `payload_json.body` when the section shape renders
  nothing, before falling back to the title line — the two writers that produce
  standups do not store the same shape.
- **The client row is a real button.** The plan said a collapsed row with
  `aria-expanded` and keyboard operation; the shipped row is a `<button>` head
  with `aria-expanded` + `aria-controls`, the body kept in the DOM and folded
  with `hidden`, and a per-row open flag so folding one brief does not move
  another. The weekly memory-health paragraph is part of the body, not a second
  surface.
- **Locale keys landed as seven per language** — `briefsSection`, `noBriefs`,
  `briefDayBadge`, `briefWeekBadge`, `briefExpand`, `briefCollapse`,
  `briefUpdated` — EN and ZH key-identical; `briefUpdated` is the extra key the
  row's stored-date label needed, and the dictionaries are asserted identical.

**Surface check.** Schema stays **v10**; routes stay exactly **18** (9 GET + 9
POST); commands stay **5**; tools (23, plus `dayflow_install_dayflow` behind its
flag) and skills (8) are unchanged; no config key, default, host peer, or
dependency was added; no model adapter is involved; the suite is **537** (16 new
cases).

**Verification (the 16 new cases, by file).**

- `tests/briefs-read.test.ts` (new, 14 cases): the list merges a week brief with
  its memory-health digest and a native standup; a standup normalises to plain
  lines with a day kind and badge key; the daily brief payload body is used when
  the standup sections are empty; malformed payloads never throw (corrupt JSON
  degrades to the title line); a briefs day row and a standup for the same day
  de-duplicate to the briefs row; deleted and non-native standups are hidden; the
  list sorts by period descending and breaks ties by `updated_at` descending; the
  default cap is ten and the limit is bounded to 1–20; an invalid limit is a
  caller error even without a journal; a missing journal answers `[]` and never
  creates the file; an unreadable journal answers `[]` instead of throwing; an
  empty journal answers `[]`; repeated reads agree and leave the journal
  unchanged (the read-only proof); the limit and the accepted clock option both
  reach the async read.
- `tests/panel-insights.test.ts` (+1 net; one existing case renamed and extended
  from four lists to five): a missing journal answers five empty lists without
  creating the journal; the insights payload carries the stored briefs, and an
  empty journal answers `[]`.
- `tests/client-format.test.ts` (+1): the read-only briefs copy exists in both
  dictionaries.
- `tests/panel.test.ts` (0 new cases): the two exact-payload insights literals
  grow by `briefs: []`; no new test, and the single-entry assertion is unchanged.

**Acceptance state.** Every acceptance item in the section above is satisfied by
the landed tests, and its checkboxes are ticked there: the payload carries the
week brief with its digest and a fresh install answers `briefs: []` without
creating the journal; the standup normalisation, de-dupe, deletion filter, and
malformed-payload tolerance are asserted; order, cap, and invalid `limit` are
asserted; the route set stays 18, no model adapter is involved, the payload is
read-only byte-for-byte, both locales are key-identical, and no new config key,
schema version, route, command, tool, skill, peer, or dependency landed.

### 0.8.2 — Image admission (deferred to the next line)

**Status: deferred to the next line — not started, not implemented, and no 0.8
tag carries it.** The owner did not answer D1/D2/D11 before the 0.8.x release
close (2026-11-27), so under O1/O3 the slot does not ship and is not renumbered:
it moves to the next line with its scope intact. Do not implement it until every
gate below is met in writing, and treat those gates as the next line's entry
conditions, not a 0.8 promise. One theme (R1): *pixels are admitted through a
config-gated, privacy-limited contract — the first time the plugin sends
anything but text.* The tagged 0.8 tree contains **no** image path: no
`analysis.includeImages` key, no v11 migration, no `privacy_apps` table, no
`@deepseek-ai/dsh-attachment` dependency.

**Why this is gated rather than default-safe.** Three independent decisions
meet here: whether frames may leave the Mac at all (D1), which provider/model
reads them (D2), and whether the owner wants the image path at all (D11). On
top of that, it is the line's only prospective new host compatibility surface:
the vision contract needs the host attachment service, and the 0.7.6
compatibility close explicitly recorded that `@deepseek-ai/dsh-attachment` was
not a dependency because the line was text-only. Adding it must not break
installs that lack it. **It never started:** the entry gates below were never
met, so the 0.8 line is text-only and adds no peer.

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

**Scope kept for the next line (finalised by the design note, not before):**

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

**If the owner answers.** D1 (`local` or `cloud`) + a vision-capable D2 + D11
unblock this patch **on the next line**, not on 0.8: it becomes a candidate for
0.9.x (or for a pre-1.0 release the owner schedules), planned against that
line's tree and under the same gates. The scope above is kept as the shape, not
as a promise: the design note (`docs/IMAGE_ADMISSION.md`) is written by the
patch, and no `IMAGE_ADMISSION.md`, config key, migration, or peer exists in the
tagged 0.8 tree. Nothing in §0.8.4 wants it implemented for the close.

**Acceptance (only if it ships on the next line; none of this is run for
0.8.4):**

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

**Decisions:** D1, D2, D11. **Deferred to the next line:** the decisions were
not answered before the release close; the slot is not renumbered, and the
0.8.4 notes name it deferred. **Risk:** pixels are irreversible once sent — hence
the gate list, the cloud redaction, and the default-off config. **Rollback:**
config first, then revert; the added table is additive and old builds ignore it
(R8).

### 0.8.3 — Phase 4 cutover (deferred to the next line; 1.0.0 prerequisite)

**Status: deferred to the next line — not started, not implemented, and no
default flipped.** The owner did not answer D1/D2/D10 before the 0.8.x release
close (2026-11-27), so under O1/O3 the slot does not ship and is not renumbered:
it moves to the next line as the 1.0.0 prerequisite, with its scope intact. Do
not implement it until the entry criteria below are met in writing and the owner
is present for the flip and the real week. One theme (R1): *the owned journal
becomes the default source of truth for a fresh capture-enabled profile — the
point the whole port exists for.* The tagged 0.8 tree keeps `source: dayflow` as
its default and contains no first-run walkthrough.

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

**Scope kept for the next line (finalised against the week's record):**

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

**Acceptance (only on the next line; none of this is run for 0.8.4):**

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

**1.0.0 relationship:** there is no 0.8.3 to be the prerequisite any more; the
cutover itself is now the next line's first functional patch and the 1.0.0
prerequisite. `1.0.0` follows once the real captured week has completed without
data loss and the first-run walkthrough has been exercised on the new line; it
is a separate release decision, not a patch in 0.8. The evidence this deferred
slot records is what makes that decision possible.

**Decisions:** D10, D1, D2. **Deferred to the next line / 1.0.0 prerequisite:**
the decisions were not answered before the release close; no default was
flipped. **Risk:** the highest of any planned patch — a default flip is visible
to every fresh profile. **Rollback:** config first (`source: dayflow`), then
revert; the patch adds no schema, so an older build can read the same journal.

### 0.8.4 — Release close (landed; the line's last patch)

**Status: landed in `v0.8.4`, 2026-11-27 — the release close of the 0.8.x
line and its final patch.** One theme (R1): *close the line honestly —
every shipped tag is a release, the npm state is explicit, and the docs match
the tagged tree.* Like 0.7.6 it **flips nothing**: no plugin source, schema,
route, command, tool, skill, config key, or default change. Its executable
artefacts are documentation, CHANGELOG, and release operations only.

**The line's final tag set.** `v0.8.0` (analysis ledger follow-ups), `v0.8.1`
(briefs reading view), and this close's `v0.8.4` — **exactly three tags for the
line**, with a GitHub Release for each. There is no `v0.8.2` and no `v0.8.3`:
the owner-gated slots were deferred, not renumbered (O3), and neither carries a
tag, a commit, or a release note of its own. Across the repository, `v0.8.4`
becomes the nineteenth tag and, if the known `v0.6.0` gap stays as history, the
eighteenth GitHub Release (A below). `v0.8.4` is cut by
`npm run release -- 0.8.4` (an explicit version, so the close cannot become a
`v0.8.2`); its body is the CHANGELOG `[0.8.4]` section, it
names the two deferred slots and their blocking decisions, and the tag is **not**
moved or re-cut.

**Status convention at the cut.** Like `v0.7.6` — whose tagged tree said "0.7.6
is in progress as the release and compatibility close", with `main` reconciling
the status after the tag — the close's own tree records **0.8.4 in progress**
while it is the patch being cut. A post-tag reconciliation commit on `main` (or
the next round's first docs edit) flips this section's status and ROADMAP's head
to "landed" once `v0.8.4` exists; nothing claims the tag before it is cut.

**Final version map for the line (the one every doc must agree with).**

| Version | Theme | State at this revision |
| --- | --- | --- |
| `0.8.0` | Analysis ledger follow-ups: the token budget as a post-call gate with a pre-call already-spent guard, transient-skip catch-up bounded to today and yesterday, and the 04:00 day tail behind the `analysis_tail_checked_on` checkpoint | **landed** — `v0.8.0` (`f4191b9`), 521 tests, GitHub Release |
| `0.8.1` | Briefs reading view: the additive `briefs` list on the insights payload, `src/briefs/read.ts`, one read-only expandable section in the existing view | **landed** — `v0.8.1` (`af002c3`), 537 tests, GitHub Release (Latest) |
| `0.8.2` | Image admission | **deferred to the next line** — D1/D2/D11 unanswered; nothing shipped, no config key, no schema v11, no `privacy_apps`, no `@deepseek-ai/dsh-attachment` |
| `0.8.3` | Phase 4 cutover | **deferred to the next line / 1.0.0 prerequisite** — D1/D2/D10 unanswered; no default flipped, `source: dayflow` stays the default |
| `0.8.4` | Release close | **landed** — `v0.8.4`; docs + release artefacts only |
| `1.0.0` / `0.9.x` | The next line | **not started** — prerequisites in **G** below; nothing is committed beyond this file's advice |

**A. Release trail — verify, don't re-cut.** The 0.8.x trail to verify:
`v0.8.0` (`f4191b9`) and `v0.8.1` (`af002c3`) each have a GitHub Release, and
`v0.8.1` is `Latest` before the close. The close checks that each tag resolves
to the commit its release names (`git rev-list -n1 v0.8.0`, `… v0.8.1`), that
no tag was deleted, moved, or re-cut, and that every release body is that
version's CHANGELOG section. Across the whole repository the trail is **18 tags
/ 17 Releases**: `v0.6.0` (`f871806`, 2026-11-11) is the one tag without a
Release, because it predates the 0.7.x release train. The close **records that
gap**; backfilling `v0.6.0` from its CHANGELOG section is a release-only
operation (the tag does not move, 0.7.6 already backfilled 0.7.1–0.7.5) and may
be done in the same operation if the lead wants the repository-level rule
literally true — it is not a 0.8.x acceptance item either way. Then the close
writes the `## [0.8.4]` CHANGELOG section (leaving `[Unreleased]` empty above it)
and the compare-link entries, commits the docs, and runs
`npm run release -- patch`: the tool requires that section, runs the suite,
bumps `package.json` + the lock, commits the changelog with them, tags, pushes,
and creates the GitHub Release from that section. The release body names the two
deferred slots (0.8.2 without D1/D2/D11, 0.8.3 without D1/D2/D10) and states that
the line shipped text-only with no default flipped, and `v0.8.4` becomes
`Latest`.

**B. npm — a decision and a check, not a publication.** D7 is still open, so the
safe default is **do not publish**: `npm view dsh-plugin-dayflow version` must
still answer 404; README/README.zh keep "tagged here, not yet on the npm
registry"; `npm run check:package` is green; the tarball of the close tree is
reviewed; and the `package.json`/`package-lock.json` diff from `v0.8.1` is
exactly the 0.8.4 version bump — no dependency, no peer (in particular
`@deepseek-ai/dsh-attachment` is still absent), no `files`/`exports` change
beyond what shipped. If the owner authorises publication in writing, it is a
separate reviewed step (token + 2FA) and the tag does not change; the close does
not wait for that answer.

**C. Docs reconciliation to the tag's numbers.** At the close tree the facts are
**537 tests** (537 pass, 0 fail, 0 skipped, 0 todo), schema **v10**, **18** panel
routes (9 `GET` + 9 `POST`), **5** slash commands, **23** tools registered by
default (17 with `edits: false`, plus `dayflow_install_dayflow` behind
`allowInstall: false`), **8** skills, **1** panel entry, and **no npm
publication**. Every doc that states a current-tree count equals those numbers —
README/README.zh, `docs/ARCHITECTURE.md`, `docs/CUTOVER_REHEARSAL.md` §2, this
file, `docs/ROADMAP.md`; historical numbers stay historical and dated (494 at
`v0.7.6`, 521 at `v0.8.0`). The version map above is the only forward-looking map
in the tree: `docs/NATIVE_PORT.md`, `docs/CUTOVER_REHEARSAL.md`, `docs/PANEL.md`,
`docs/CONFIGURATION.md`, `docs/NATIVE_CAPTURE.md`, README/README.zh no longer
promise image admission or a cutover in a 0.8 patch, and every status line in
this file, its §1 and §3.1 tables, §5, and §6 reads "landed"/"deferred" — with
0.8.4 the only "in progress" row until its tag exists. The packed
file list is reviewed with `npm pack --dry-run --json` (141 files at this
revision, 19 under `docs/`, no `src/`, `tests/`, `scripts/`, `.github/`, or
`.tsbuildinfo` entry); `check:package` enforces its required entries and the
forbidden-path list — it does not itself assert `docs/`, so the docs presence is
reviewed from the pack JSON, not assumed from the gate.

**D. Deferral, explicit.** The two slots that did not ship are recorded here and
in the release notes with their blocking decisions: **0.8.2 image admission**
needs D1 (`local` or `cloud`), D2 (a vision-capable provider/model), and D11
(explicit image go-ahead with size and retention caps); **0.8.3 Phase 4
cutover** needs D10 (explicit authorisation to flip the default), D1/D2 for an
analysed week, the real-week entry criteria of §0.8.3, and an owner present for
the flip. Both move to the next line (0.9.x for the image slice, and the cutover
as the 1.0.0 prerequisite); nothing is silently dropped and nothing is promised
twice. The 0.8 line stays text-only, `source: dayflow` stays the default, and
npm stays unpublished.

**E. Gates (all must be green before the tag).** On the close tree: `npm test`
(537/537 — the release tool runs it itself before bumping), `npm run typecheck`,
`npm run check:package`, `npm run rehearsal` (20/20 — it must still pass because
the close changes no input it exercises), both CI legs (macOS 15, Node 22 with
`--experimental-sqlite`, and Node 24), and the tag-triggered `release-check` job
(the tag names the `package.json` version). The close's own diff must be docs +
CHANGELOG + version/lock only:
`git diff --stat v0.8.1..HEAD -- src/ tests/ scripts/ .github/` is empty,
`git diff v0.8.1..HEAD -- package.json` shows only the version bump, the docs
commit is pushed first, and the working tree is clean except `CHANGELOG.md` when
`npm run release -- patch` runs (the tool refuses anything else).

**Acceptance (boxed; the tag is not cut until all are true — tick them at the
cut, not before):**

- [ ] `v0.8.0` and `v0.8.1` each have a GitHub Release whose body is that
      version's CHANGELOG section, `v0.8.1` is `Latest` before the close, and no
      tag was deleted, moved, or re-cut; the repository-level `v0.6.0` gap is
      recorded (or backfilled as a release-only operation).
- [ ] `v0.8.4` is cut by `npm run release -- patch` from its CHANGELOG section,
      its body names 0.8.2 and 0.8.3 deferred with their blocking decisions, and
      it becomes `Latest`.
- [ ] The line has exactly the tags `v0.8.0`, `v0.8.1`, `v0.8.4` — no `v0.8.2`,
      no `v0.8.3`, no renumbering.
- [ ] `npm view dsh-plugin-dayflow version` answers 404; README/README.zh say
      tagged, not on npm; `check:package` is green; the package diff is the
      version bump only.
- [ ] No doc claims a version for a theme that did not ship it; the version map
      has one row per version; every deferred slot names its blocking decision;
      no doc still schedules image admission or the cutover in 0.8.
- [ ] Current-tree counts equal the tag's actual numbers: 537 tests, 18 routes
      (9 GET + 9 POST), 5 commands, 23 tools (17 with `edits: false`), 8 skills,
      schema v10, `npm` still 404; historical counts are dated.
- [ ] The close diff is docs + CHANGELOG + version/lock only (`src/`, `tests/`,
      `scripts/`, `.github/` unchanged from `v0.8.1`).
- [ ] §0.8.4 G states the next line's prerequisites, and ROADMAP's 0.8.x section
      and status head agree with this file.

**F. Risk and rollback.** The risk is a cross-document consistency slip, not a
code regression; it is mitigated by mechanical grep checks and an
independent read-only verification, not by prose review. The
close is docs-only plus release metadata, so rollback is a corrected follow-up
release note (never a moved tag) and a normal doc patch; a wrong release body is
corrected by a new note, exactly as 0.7.6's rule says.

**G. After the close — the next line (1.0.0 / 0.9.x).** The line closes without
a functional default change. The next line begins from `v0.8.4` on `main`, and
nothing in it is committed by this plan beyond recording the gates.

**G1 — 1.0.0 prerequisites (all required before a 1.0.0 tag).**

1. **A real captured week on the owned default.** A throwaway profile with
   capture on, `source: owned` as the new default, Dayflow closed, and **zero
   data loss across restarts**, recorded in `docs/CUTOVER_REHEARSAL.md`. This is
   §0.8.3's acceptance, moved to the next line. Any data loss is a blocking
   finding, not a note.
2. **D10 — explicit cutover authorisation.** A default change is the owner's
   decision; no engineering process can authorise it.
3. **D1 and D2 answered** for an analysed week (or the owner chooses the
   capture-only variant with `consent: none`, which narrows acceptance and
   pushes the analysed week later).
4. **D11 image admission decided, not necessarily implemented.** 1.0.0 can ship
   text-only on a "not now" answer; on a "yes" answer, §0.8.2's scope is the
   shape of the image patch, which ships as its own theme on the next line (or
   before 1.0.0 if the owner schedules it) — never as a 0.8 tag.
5. **D7 npm publication decided.** 1.0.0 is the natural first publish, but the
   close does not publish; publication stays a separate reviewed step (tarball,
   token, 2FA) and changes no tag.
6. **The runbook exercised**: first-run walkthrough (permission, consent,
   capture switch, pause), rollback by `source: dayflow` alone, and the
   real-week record table in `docs/CUTOVER_REHEARSAL.md`.

**G2 — 0.9.x, decision-free only.** If the owner does not unblock the cutover,
the next line may still make small patches that need no answer under the same
rules (R1–R9, one theme, one tag), or the project may pause: the journal is
already readable, the briefs are visible, and the remaining product work is
gated. Candidates, in preference order and drawn from the remaining list in
`docs/ROADMAP.md`:

- **Month/week panel goal and rating surfaces** — read-only rendering of stored
  data the day view already shows, no default change, no model call; the last
  stored-data gap the panel still has.
- **Docs and closure hygiene** — README/README.zh parity, the "what remains"
  list, and the compatibility statement; cheap, no behaviour change.
- **The `dsh dayflow import` CLI** — one command over the existing importer; a
  new entry point, so it needs its own small patch and only after a 0.9 line is
  actually opened.

**Not candidates without the owner:** image admission (D1/D2/D11), the cutover
default flip (D10), any npm publish (D7), and the owned-journal write path (a new
write surface the roadmap deliberately leaves with Dayflow for now).

**G3 — Recommendation for the next round.** Do not open a 0.9.x line just to
have one: the 0.8 line's deferred payload *is* the next product step, and it is
blocked on the owner, not on engineering. The next round should (a) put the five
answers in front of the owner as one short list — D10, D1, D2, D11, D7 — each
with the single question it answers and the patch it unblocks; (b) if the answer
is "not now", ship the decision-free month/week goal and rating surfaces as
0.9.0 and stop there; (c) if D10 and the real week are in hand, plan 1.0.0 as a
cutover line — the cutover patch, the real week, then `v1.0.0` — reusing
§0.8.3's scope and entry criteria unchanged. In every branch, the first action
is the same: ask the five questions, because nothing else on the remaining list
is both unblocked and worth a release.

## 4. Definition of Done (every patch)

The 0.7.x Definition of Done ([PATCH_PLAN.md](PATCH_PLAN.md) §4) applies
unchanged: suite green, `check:package` green, one integration point, docs and
CHANGELOG with the tag, no read-path regression, no default change without the
decision that authorises it, new worker/scheduler code tested with
double-start / cleanup / no-throw-into-host cases, new routes and panel
surfaces extending the exact route-set and single-entry tests deliberately,
rollback stated, and the patch's own section corrected if reality diverged.

This line adds:

- [x] The money ledger test: the configured call/token cap cannot be exceeded by
      more than the single crossing call, and budget skips are not replayed
      (0.8.0 — 27 cases, landed).
- [x] The idempotency proof: running the same catch-up twice, or restarting
      across the day boundary twice, produces no second call and no duplicate
      row (0.8.0 — landed; `tests/analyse-skips` and `analyse-worker`).
- [x] The decision-gate proof: a default profile (capture off and/or
      `consent: none`) runs nothing new (0.8.0 — landed); the line's two gated
      patches were never started because their gate lists were never met, so no
      default profile behaviour changed for them either.
- [x] The read-only proof for the briefs view: a fresh install answers an empty
      `briefs` list without creating the journal, repeated reads leave the
      journal byte-for-byte unchanged, and no model adapter is involved
      (0.8.1 — landed).
- [x] No compatibility event on this line: the 0.8.2 attachment/vision peer never
      landed, so the tagged tree adds no host peer and stays text-only (verified:
      `@deepseek-ai/dsh-attachment` is absent from `package.json`).
- [x] No default flipped on this line, so there is no flip to roll back; the
      cutover's rollback test moves with the deferred slot to the next line.
- [x] `docs/ROADMAP.md` remain lines change only for work that actually landed
      (0.8.0 and 0.8.1 updated them; this revision records the 0.8.2/0.8.3
      deferral and claims no unshipped work).
- [ ] The release-close proof (0.8.4): the close diff is docs + CHANGELOG +
      version/lock only, every shipped 0.8.x tag has its Release, and the
      deferred slots are named — ticked by §0.8.4's own acceptance at the cut.

## 5. Sequencing rationale

1. **The ledger patch went first, because it was the only one that needed no
   answer.** 0.8.0 closed the three debts 0.7.2 named, all in modules that
   already existed, with a fake analyser and a temporary journal. It also had to
   land **before** any default flip: the day tail is the first path that can
   spend without the owner watching, so the token gate and the tail are
   deliberately in the same tag. If the line had done the cutover first, a fresh
   profile would get a default that is only bounded by the call cap and a
   reported-only token number. It shipped as `v0.8.0`.
2. **The briefs view second, because it is the cheapest visible win.** It is
   read-only, route-free, model-free, and it makes 0.7.4/0.7.5's stored output
   readable for the first time. It also landed before any gated patch could touch
   the same insights view, so a section addition and a privacy-copy change were
   never interleaved in one review. It shipped as `v0.8.1`.
3. **The gated slots were never opened.** Image admission and the cutover were
   ordered image-before-cutover because both wait on the same owner conversation
   (D1/D2) and the default flip should be the last functional change of a line.
   The owner did not answer, the line did not wait: both slots stayed scoped and
   unstarted, and they move to the next line with that order intact. The
   alternative — shipping an inert image stub or a flipped default without an
   answer — was rejected, because a default change and a privacy surface are not
   patch-line filler.
4. **Release close last, and it flips nothing.** Same rule as 0.7.6: a patch
   line whose last patch changes a default would not be a patch line, and a
   release patch that also changes behaviour cannot be verified as a release.
   That is 0.8.4, in progress now.
5. **0.8.0 did not need to split.** It was tagged whole, so the pre-tag
   renumbering window is closed: after the first tag of the line, O3 applies and
   an unshipped slot is deferred rather than renumbered. The reserved 0.8.5 row
   stays listed only as the unused contingency it was; no future renumbering is
   allowed.
6. **No hotfix patch first.** The `v0.7.6` tree was green and released, the line
   started from a decision-free patch, and 0.8.0 shipped with nothing in the
   repository recording a defect that would justify a hotfix before 0.8.1.
7. **The line closes without the gated patches, and that is the plan working.**
   The two owner-gated slots were the only functional work left; because their
   gates were never met, the line ends at its release close rather than growing
   an unreviewed default flip. That is a smaller line than the 0.8.x outline
   imagined, and a truer one: the shipped surface (ledger plus reading view) is
   exactly what can be justified without an owner answer.

**Line exit criteria.** The 0.8.x line is done when: 0.8.0 has shipped (it has),
0.8.1 has shipped (it has), and 0.8.4 has shipped; 0.8.2 and 0.8.3 are
explicitly deferred in 0.8.4's release notes with their blocking decisions; every
shipped 0.8.x tag has a GitHub Release (and the repository-level `v0.6.0` gap is
recorded); the npm state is explicit (404, no publication); `docs/ROADMAP.md`,
`docs/NATIVE_PORT.md`, `docs/CUTOVER_REHEARSAL.md`, README/README.zh, and this
file agree on the version map and the final counts; and the next step is named —
the owner decisions plus the 1.0.0 prerequisites in §0.8.4 G. At this revision
the first two are done and the remaining items are the 0.8.4 checklist itself.

## 6. Owner decisions and safe defaults

D1–D9 are inherited from [PATCH_PLAN.md](PATCH_PLAN.md) §6; D10 and D11 are new
for this line. Every row has a default that ships without an answer. At the
close, the unanswered D1/D2/D10/D11 rows are exactly why 0.8.2 and 0.8.3 are
deferred to the next line.

| Id | Decision | Why it matters | Status 2026-11-27 | Safe default if unanswered | Gates |
| --- | --- | --- | --- | --- | --- |
| D1 | **Analysis destination**: `none`, `local`, or `cloud` | Whether screen metadata (and later pixels) may leave the machine, and whose model reads them | Unanswered | `none`: capture and analysis code ship, nothing leaves the machine, the panel says why. Also means no real cutover week with analysis | 0.8.0 landed inert (no call without consent); 0.8.2/0.8.3 deferred to the next line on this answer |
| D2 | **Provider and model** for analysis | Cost, latency, and which vendor sees the data | Settled as an explicit rule: `analysis.provider` + `analysis.model` must be set; empty means "not configured" and jobs are skipped | Explicit pair or skip; no implicit host default | next line: image admission needs a **vision-capable** pair; the cutover needs any working pair |
| D3 | **Daily budget**: calls and tokens | A runaway loop is a bill, not a bug | Caps configured (120 calls / 200k tokens); **both are enforced since 0.8.0** — calls as a pre-call gate, tokens as a post-call gate with a pre-call already-spent guard | **0.8.0 landed the configured token cap as a post-call gate.** No retroactive spend, no automatic replay of budget skips, no automatic cloud replay without authorisation. Changing a cap is a config value, not a patch | 0.8.0 (landed) |
| D4 | **Catch-up window** after the machine was off (automation closes) | Closing ten missed days at once is noise and cost | Settled and landed: `automation.catchUpDays` (1–30, default 2), older days `skipped`, never fabricated | Unchanged on this line | — |
| D5 | **Frame retention** after analysis | Debuggability versus screenshots on disk | Settled and landed: `keepFramesDays: 0` deletes a frame after successful analysis; the sweep is the fallback | Unchanged; the deferred image patch respects it when it ships on the next line | next line image slice |
| D6 | **Suppression management surface** | A hard-suppressed idea must be clearable somewhere | Settled for 0.7.x: agent-only (`journal_review` unsuppress); no panel list | Unchanged; not on this line | — |
| D7 | **npm publication** | Publishing is hard to undo | Unanswered | **Do not publish**: "tagged here, not on the registry" stays true; publish only on explicit authorisation with a reviewed `npm pack` | 0.8.4 verifies 404 without publishing; next line for any publish decision |
| D8 | **Lint finding destination** | A finding is only useful if seen, only trustworthy if not auto-"fixed" | Settled and landed (0.7.5): weekly digest plus at most one proposal per claim per week; no automatic supersede or forget | Unchanged | — |
| D9 | **Automatic memory writes** | "The agent may notice, only the user may decide" | Settled and landed: automation proposes into the queue; claims only through kept-item promotion | Unchanged | — |
| **D10** | **Phase 4 cutover authorisation**: flip `source: owned` for a fresh capture-enabled profile | A default change is visible to every fresh profile and hard to walk back socially, even when config-revertible technically | Unanswered — the default was not flipped; 0.8.3 is deferred to the next line as the 1.0.0 prerequisite | **No flip.** The line closes at 0.8.4 with the slot deferred; `source: dayflow` stays the default | next line / 1.0.0 |
| **D11** | **Image admission go-ahead**: admit pixels through the attachment/vision contract | Once a pixel is sent it cannot be recalled; the new host contract is a compatibility event | Unanswered — 0.8.2 is deferred to the next line, and the 0.8 line stayed text-only | **Text-only.** No `dsh-attachment` peer, no `includeImages`, no `privacy_apps` list | next line image slice |

**What is needed from the owner, and when:**

- **Nothing is needed to close 0.8.x.** 0.8.0 and 0.8.1 shipped under the safe
  defaults, and 0.8.4 is docs and release artefacts only; it closes whether or
  not any decision is answered.
- Before the next line can schedule **image admission (deferred 0.8.2)**: D1
  (`local` or `cloud`), D2 (a vision-capable provider/model), D11 (explicit
  go-ahead with size/retention caps). If D1 is `cloud`, the 3.6 limitation copy
  must be approved with it.
- Before the next line can do the **cutover and plan 1.0.0**: D10 (explicit
  authorisation to flip the default), D1 (at least `local` for an analysed week;
  `none` narrows it to capture-only), D2 (a working model pair), plus the
  real-week entry criteria in §0.8.3.
- Before any **npm publish** (including a 1.0.0 publish): D7 (explicit). No
  answer means no publish, and no line waits on it.

**What changes if the owner answers.** The answers now shape the **next** line,
not 0.8. D1=`local` + D2 + D11 unblock image admission; D1=`cloud` adds the 3.6
copy requirement and a higher review bar for it. D10 unblocks the cutover once
the real week is recorded, and that is what 1.0.0 waits on. D7=yes adds a publish
step to whichever release follows (reviewed tarball, token, 2FA), never a patch.
No answer changes 0.8.0/0.8.1/0.8.4 — the line already ships without it, and no
answer is a reason to reorder or reopen the line.

## 7. How to run one patch

1. Work from the previous **shipped** tag: the line's patches branched
   `patch/0.8.N-<theme>` from `v0.8.N-1`, and the close works on **`main`** at
   `v0.8.1` because `npm run release` refuses any other branch. Commit the docs
   first and leave only the `CHANGELOG.md` edit dirty for the release commit —
   the tool accepts that one dirty path and nothing else. A deferred slot, when
   it is opened, branches on the **next** line's baseline, not on a 0.8 tag.
2. Write the failing tests first from the patch's acceptance list, on the
   existing fake-adapter seam; the 0.8.x tests need no network, permission, or
   real clock either. The close (0.8.4) writes no tests and changes no code: it
   runs the gates and the greps below.
3. Implement; keep the integration point single (`src/index.ts`), and for 0.8.0
   keep the gate order exactly as §0.8.0 A and its Landed shape and deviations
   record it.
4. Update the patch's docs and the CHANGELOG `[Unreleased]` entry in the same
   commit; for a gated patch, quote the owner's answer and the §6 gate list in
   the PR description. The close writes the `## [0.8.4]` CHANGELOG section
   (leaving `[Unreleased]` empty above it) and its compare links, commits all
   the docs first, and leaves only that CHANGELOG edit dirty for the release
   commit.
5. Run `npm test`, `npm run typecheck`, `npm run check:package`; review the
   config-defaults diff; for the close also run `npm run rehearsal` (20/20) and
   the §0.8.4 E diff checks. A deferred slot, when it is opened on the next line,
   re-runs the relevant rehearsal or fresh-profile checklist and records it.
6. Cut the release with `npm run release -- patch` (it bumps, runs the suite,
   commits, tags, pushes, and creates the GitHub Release from the CHANGELOG
   section; it does **not** publish to npm).
7. Update the status column here and, only for work that landed, the roadmap's
   remain lines. A gated patch that did not ship stays "deferred" and is
   recorded in §0.8.4 D — that is what 0.8.2/0.8.3 did.

If a patch discovers that its theme cannot ship default-safe, it stops at step 3
and the blocking decision moves into §6. A patch does not ship with a default
that changes behaviour without the owner's answer, and a gated patch does not
start before its gate list is met. **The 0.8 line's close is the last action of
this plan; anything after it belongs to the next line's plan, and §0.8.4 G is
the only part of this file that speaks about it.**
