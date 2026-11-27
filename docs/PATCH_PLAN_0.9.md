# Patch plan: the 0.9.x line

> **Status:** **the 0.9.x line's functional scope is closed at `v0.9.1`, and it
> was decision-free by construction; the line was reopened for exactly one
> maintenance patch — 0.9.2, DSH `0.2.2-rc.5` compatibility — which has landed
> (`v0.9.2`, the 22nd tag and Release), and the line is back in maintenance.**
> The 0.8.x line closed at its release-close
> patch: `v0.8.4` is an annotated tag on commit `e298813`, the commit that
> closed the line, with a GitHub Release (Latest until `v0.9.0`). That tree is
> **537** green tests, schema **v10**, **18** panel routes (9 `GET` + 9 `POST`),
> **5** slash commands, **23** tools,
> **8** skills, and still **no npm publication** (the registry answers 404). The
> 0.8 line's tags are exactly **`v0.8.0`, `v0.8.1`, `v0.8.4`**, each with a
> GitHub Release; the owner-gated 0.8.2 (image admission) and 0.8.3 (Phase 4
> cutover) were **deferred to the next line**, never started, and are not
> renumbered. Across the repository the trail is now **22 tags / 22 Releases**,
> with **`v0.9.2` Latest**: the `v0.6.0` gap the 0.8.4 close recorded as history
> was backfilled as a release-only operation after that tag, so every tag has a
> Release today.
>
> **This line's first patch is 0.9.0 — month/week panel goal and rating
> surfaces — and it has landed and been released** (`v0.9.0`, annotated tag on
> `d0f9b5a`, GitHub Release (Latest at the time), **544** green tests — 537 at
> `v0.8.4`, so 0.9.0 added 7). It is decision-free and read-only: the stored
> goal and the user's own review marks, which the day view already rendered, are visible in
> the month cells and the week columns. **No schema, configuration key, route,
> command, tool, skill, default, host peer, or model call was added** — the line
> stayed at 18 routes, 5 commands, schema v10, and text-only.
>
> **0.9.1 is the line's second and final functional patch, reopened into the
> close-history surface and landed** (`v0.9.1`, annotated tag on commit `ce0827e`, GitHub
> Release **Latest at the time**, **557** green tests — 544 at `v0.9.0`, so 0.9.1
> added 13).
> The automation ledger has recorded every attempted day close, week
> close, and weekly memory lint in `automation_runs` since schema v9, with the
> status, the attempt count, and the stored error or skip reason — but the panel
> only ever shows the schedule and, at most, the *last* day and week close on the
> close-state line. 0.9.1 made the stored history legible: `PanelInsights` gains
> one additive `closes` list (job, day, status, attempts, optional error,
> updated_at; newest first, capped at 10), read by a new
> `src/automation/read.ts` on the connection the insights payload already opens,
> and the existing Journal insights view gains one read-only **Close history**
> block. It is the last entry in [`NATIVE_PORT.md`](NATIVE_PORT.md) §1 *Missing*
> that is a stored-data read gap rather than an owner-gated default flip or an
> image permission, so it is decision-free: no new route (still 18), no schema,
> configuration key, command, tool, skill, host peer, write path, or model call.
> **The earlier 0.9.1 candidate — docs/README parity — is withdrawn:** the 0.9.0
> docs pass covered README/README.zh, PANEL, ARCHITECTURE, CHANGELOG, ROADMAP,
> and this file, so no drift is known, and a docs-only release with no
> user-visible change would be release noise. **The line is reopened for exactly
> one maintenance patch, 0.9.2 — DSH `0.2.2-rc.5` compatibility — which has
> landed** (see §0.9.2). It is not a product patch and changes no decision: the
> installed DSH app moved to `0.2.2-rc.5` after `v0.9.1` was cut, while this tree
> still declares `0.2.0-rc.2`/`0.2.1-rc.2` and pins its seven DSH dev
> dependencies at `0.2.1-rc.2`, so the release the plugin actually runs on was
> never declared or verified; 0.9.2 closes that declaration-and-verification gap
> with no behaviour, default, schema, route, command, tool, skill, configuration
> key, runtime dependency, or host peer change, and the line returns to
> maintenance after its tag. The `dsh dayflow import` CLI is **not on this line**
> (see *The CLI import is not 0.9 material*).
>
> **Owner-gated work does not enter 0.9.** Image admission (D1/D2/D11, the
> former 0.8.2 scope), the Phase 4 `source: owned` cutover (D10 plus a real
> captured week, the former 0.8.3 scope), any npm publish (D7), and the
> owned-journal write path stay deferred; the 1.0.0 prerequisites in §4 are
> unchanged and untouched by the line, 0.9.1 and 0.9.2 included. This plan
> supersedes the
> *forward-looking* half of [`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.4 G
> (its "0.9 candidate" wording is the 0.8 record; from this revision the
> decision-free items are scheduled here). The 0.8.x plan is frozen as history:
> the line it describes is tagged and released. [`PATCH_PLAN.md`](PATCH_PLAN.md)
> is the 0.7.x record and stays frozen too.
>
> **Last revised:** 2026-11-27, fourth revision of the day: 0.9.0 is measured on
> its released tree (`v0.9.0`, `d0f9b5a`) and 0.9.1 on its released tree
> (`v0.9.1`, `ce0827e`); 0.9.1 was re-scoped from the docs-parity candidate to
> the close-history surface and has landed. The line has since been reopened for
> the 0.9.2 host-compatibility maintenance patch: the installed DSH app moved to
> **`0.2.2-rc.5`**, the declared compatibility map and the dev-dependency cohort
> were left one release behind, and §0.9.2 fixes exactly that with no product
> change. The starting-point table keeps the `v0.8.4` baseline the line was
> designed from, with all measurements dated; its host-cohort row carries the
> `0.2.2-rc.5` measurement.
>
> Related documents: [`ROADMAP.md`](ROADMAP.md) carries the phases, the
> iterations tables, and what remains; [`PANEL.md`](PANEL.md) is the view 0.9.0
> changes and the block 0.9.1 adds; [`NATIVE_PORT.md`](NATIVE_PORT.md) §1 records
> the close history as *Missing* before 0.9.1;
> [`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.4 G is the close that opened
> this line; [`CHANGELOG.md`](../CHANGELOG.md) is the record of what actually
> shipped.

## 1. Starting point, measured

Facts checked against the repository, the tag list, the GitHub release list, and
the npm registry on 2026-11-27. The **design baseline** was measured on the
`v0.8.4` tree (`e298813`); the **landed measurement** is the `v0.9.1` tree
(`ce0827e`), whose suite was re-run for this revision (**557 pass, 0 fail, 0
skipped, 0 todo**) with the release list read (`v0.9.1` was then `Latest`; after
this line's maintenance tag, `v0.9.2` is `Latest`). Both are dated below; when an
operation invalidates one, it updates this table. The `v0.9.0` measurement (544)
is kept where it records what 0.9.0 added.

| Fact | Value | Checked at |
| --- | --- | --- |
| Baseline for this line | **landed through `0.9.1`**, annotated tag `v0.9.1` (commit `ce0827e`), whose `package.json` version is `0.9.1`; the first patch's tag is `v0.9.0` (commit `d0f9b5a`). The line was designed from and branched off `v0.8.4` (`e298813`). **0.9.2 is appended after the close**: it starts from `main` at `2383117` (the 0.9.1 tree plus docs runs) and is the one patch that reopens the line | `package.json`, `git tag`, `git log` |
| Release trail | **22 tags / 22 GitHub Releases** across the repository; **`v0.9.2`** (`ccac653`) is `Latest` and its body is the CHANGELOG `[0.9.2]` section, **`v0.9.1`** (`ce0827e`) was `Latest` before it, and **`v0.9.0`** (`d0f9b5a`) before that, while `v0.8.4`'s body names 0.8.2/0.8.3 deferred with their blocking decisions. The 0.8 line's tags are exactly `v0.8.0` (`f4191b9`), `v0.8.1` (`af002c3`), `v0.8.4` (`e298813`), and the 0.9 line's are exactly `v0.9.0`, `v0.9.1`, and `v0.9.2`. The `v0.6.0` gap the tagged 0.8.4 docs record as history was **backfilled** as a release-only operation after that close (release published 2026-11-27 06:26Z), so no tag lacked a Release before this line | `gh release list --limit 30`, `git tag`, `gh release view v0.9.2` |
| npm | `npm view dsh-plugin-dayflow version` answers **404** — never published; D7 still unanswered, so the safe default stays "tagged here, not on the registry" (checked again on the `v0.9.1` tree) | `npm view`, README/README.zh |
| Tests | **557** cases, green on the tag (`npm test`: 557 pass, 0 fail, 0 skipped, 0 todo; 544 at `v0.9.0`, 537 at `v0.8.4`, 521 at `v0.8.0`, 494 at `v0.7.6`). 0.9.0 added 7 in 2 files (`tests/panel.test.ts`: the three-route agreement and the empty month/week no-journal test; `tests/client-format.test.ts`: 5 cases) and 0.9.1 added 13 in 3 files: 11 reader cases in a new `tests/automation-read.test.ts`, one payload case in `tests/panel-insights.test.ts` (whose two "five empty lists" literals became six), and one copy case in `tests/client-format.test.ts`; `tests/panel.test.ts` gained only two `closes: []` literals. CI runs macOS 15 with Node 22 (`--experimental-sqlite`) and Node 24. **0.9.2 re-runs the whole suite on the `0.2.2-rc.5` dev dependencies**; 557 is the floor, the cut recorded 557, and after the tag `tests/compatibility.test.ts` adds one case, so the current tree is **558**; no case may be dropped or weakened | `npm test`, `.github/workflows/ci.yml` |
| Tools / skills / commands | 23 tools registered by default (17 with `edits: false`) plus `dayflow_install_dayflow` behind `allowInstall: false`; 8 skills; 5 slash commands (`dayflow-task`, `dayflow-remember`, `dayflow-reflect`, `dayflow-analyze`, `dayflow-run-close`) — neither 0.9.0 nor 0.9.1 changes any of these | `src/index.ts`, `src/commands.ts`, `tests/plugin.test.ts` |
| Panel | 18 exact host Fetch routes (9 GET + 9 POST), one UI entry (one header button, one panel tab), one insights payload. The read views are `/api/dayflow/day`, `/api/dayflow/month`, `/api/dayflow/week`, and all three days share one type (`PanelDay`); the insights answer gains 0.8.1's `briefs` and 0.9.1's `closes` — neither 0.9 patch adds a route | `src/panel-contract.ts`, `src/panel.ts`, `tests/panel.test.ts`, `tests/client-bundle.test.ts` |
| Owned schema | **v10** (`automation_runs` accepts `'lint'`; `briefs.payload_json`); 0.8.4, 0.9.0, and 0.9.1 changed no migration and no table — 0.9.1 only reads the existing `automation_runs` | `src/journal.ts` → `JOURNAL_SCHEMA_VERSION` |
| The gap 0.9.0 closed (history) | At the `v0.8.4` baseline `PanelDay` declared `goal?: PanelGoal \| null` and `ratings?: PanelRating[]`, and the **day** route filled them while `buildPanelMonth` and `buildPanelWeek` built their days through `dayPayload()` and never attached either field; `tests/panel.test.ts` asserted that absence and `docs/PANEL.md` described it as intended ("the month and week payloads are unchanged, so only opening a day pays for those reads"). 0.9.0 filled the fields, flipped those tests to the three-route agreement, and corrected the doc prose | `src/panel.ts` (`buildPanelDay`/`buildPanelMonth`/`buildPanelWeek`), `src/panel-contract.ts`, `tests/panel.test.ts`, `docs/PANEL.md` |
| The gap 0.9.1 closes | `automation_runs` has recorded every attempted close since schema v9 — `job` (`day_close`/`week_close`/`lint`), `day`, `status` (`pending`/`running`/`complete`/`failed`/`skipped`), `attempts`, `error`, `updated_at` — but the panel exposes only live state: the scheduler's close-state line carries the schedule, whether a close is running, and at most the *last* day close and the *last* week close as `{day, status, at}` (primed from the ledger when memory has none). The lint job, the attempt counts, the stored error or skip reason, and every older row have no view. [`NATIVE_PORT.md`](NATIVE_PORT.md) §1 *Missing* names this gap ("A close-history surface … there is no view of the history itself"), and its Phase 3 record repeats that a failed/skipped history "has no view of its own". 0.9.1 closes it with one additive payload list and one read-only block | `src/automation/store.ts` (`automation_runs`, `listAutomationRuns`), `src/automation/scheduler.ts` (status line and `primeFromLedger`), `src/panel-contract.ts` (`PanelAutomationStatus`), [`NATIVE_PORT.md`](NATIVE_PORT.md) §1 and Phase 3 |
| Host cohort | **At `v0.9.1`:** DSH dev dependencies `0.2.1-rc.2`, peers `^0.2.0-rc.2`, and `dsh.compatibility.dshReleases` listing `0.2.0-rc.2` and `0.2.1-rc.2`. **Measured on this machine (2026-11-27):** the installed DSH app is **`0.2.2-rc.5`** (`CFBundleShortVersionString` and `CFBundleVersion` from `/Applications/DeepSeek Harness.app/Contents/Info.plist`); the npm registry carries that full cohort (`@deepseek-ai/dsh-tools` etc. all answer `0.2.2-rc.5`); the host bundle itself ships `@deepseek-ai/cordis` 4.1.0 and `@deepseek-ai/schemastery` 3.19.0. **0.9.2 is the row that closes the gap.** `@deepseek-ai/dsh-llm` is declared and used through a structural seam; `@deepseek-ai/dsh-attachment` is **not** a dependency — the line stays text-only, as 0.8.4 left it | `package.json`, `npm view`, the app bundle's `package.json`/`Info.plist`, `src/analyse/host.ts` |
| Owner decisions | D1 (analysis destination) unanswered; D2 settled as explicit configuration; D3 caps enforced; D7 (npm) unanswered; **D10/D11 unanswered**. None of them gates 0.9.0: the patch adds no model call, no egress, no default change, and no privacy surface | `PATCH_PLAN.md` §6, `PATCH_PLAN_0.8.md` §6 |

**Landed on the 0.7.x and 0.8.x lines, therefore not in this plan:** the owned
schema and importer, the read tools, the review queue, long tasks, dated memory,
the budgeted memory context, reflections, the scheduled lint and its digest, the
interactive insights panel, the native capture engine, the analysis pipeline and
worker, the automation scheduler, the panel's capture/analysis/close lines, the
briefs reading view, the 18 routes, the 5 commands, the 23 tools, and the 8
skills. All of it is tagged, tested, and released before this line. **Landed on
this line:** 0.9.0 — the month/week goal and rating surfaces — is tagged as
`v0.9.0` with a GitHub Release and 544 tests, and it is the first change after
the 0.8.4 close; and 0.9.1 — the close-history surface — is tagged as `v0.9.1`
with a GitHub Release and 557 tests (the new `src/automation/read.ts`, the
additive `PanelInsights.closes` field, and the read-only block in the existing
Journal insights view); see §0.9.1. **Appended after the close:** 0.9.2 — DSH
`0.2.2-rc.5` compatibility — has landed and changes no behaviour, default,
wire, or dependency set; it declares and verifies the release the plugin already
runs on. See §0.9.2.

**What the host-compatibility gap is, measured.** The host's admission check does
not read `dsh.compatibility.dshReleases`: it evaluates a plugin's own
`engines.dsh` range when present, otherwise every `@deepseek-ai/dsh`/`dsh-*` peer
range against the running version, with prereleases included
(`plugin-compatibility.ts` in the 0.2.2-rc.5 app bundle; the
`v0.2.1-alpha.3` `plugin-engines-dsh` upgrade guide documents the rule). This
plugin declares no `engines.dsh`, and its `^0.2.0-rc.2` peers **already admit**
`0.2.2-rc.5`, so nothing is refused and no runtime defect is claimed. What is
stale is the declared-compatibility record (`dshReleases` lists two releases
while the host runs a third) and the verification line (the dev dependency pins
and lock are `0.2.1-rc.2`, so the suite has never run against the 0.2.2-rc.5
cohort). 0.9.2 fixes exactly those two things; that is why it is a
maintenance-class patch rather than an emergency fix.

**What this line is, in one sentence:** the last stored-data gap in the panel
and the last stored history the native port records as missing — made visible
without adding a route, a decision, or a dependency: shipped as `v0.9.0` and
`v0.9.1`; and then the one host-compatibility declaration-and-verification patch
the harness's own move made necessary, 0.9.2.

## 2. Iteration rules

The 0.7.x rules ([`PATCH_PLAN.md`](PATCH_PLAN.md) §2) hold unchanged and this
plan does not restate them: **R1** one verifiable theme per patch, **R2** one
integration point and one tag per patch, **R3** migrations ride with their code,
**R4** CI never calls a model, captures the screen, or needs a permission,
**R5** default-safe or blocked on a decision, **R6** docs and CHANGELOG travel
with the tag, **R7** no read-path regression, **R8** rollback is config first,
revert second, **R9** one UI entry. What is specific to a decision-free line:

**P1 — Decision-free only.** A 0.9 patch needs no owner answer and is inert by
default. If a theme turns out to need a decision, the patch stops before it
starts and the decision moves to §4; it does not "partially land".

**P2 — Read-only surfaces only.** The line renders records the journal already
stores. It adds no write path, no generated content, no model call, and no new
egress; the plugin still cannot set a goal or make a review mark in the owned
journal.

**P3 — The contract is frozen except for one declared, additive read.** No
schema migration, no configuration key, no route, no command, no tool, no skill,
and no host peer. Exactly two wire changes are allowed, and no others: *filling*
the two optional fields `PanelDay` already declares for month/week days (0.9.0),
and *adding* one new list to the existing insights payload —
`PanelInsights.closes` (0.9.1) — which is additive and optional to read, so a
client built before the patch ignores it and the patched client treats its
absence as an empty list; that is exactly the precedent 0.8.1 set with
`PanelInsights.briefs`. A new field on any other payload, a new type on the wire
beyond that list's own summary, a new route, or any change to the meaning of an
existing field does not belong on 0.9.

**P4 — One day, one answer, three routes.** A day's goal and ratings are
identical whether read through `/day`, `/month`, or `/week`: same normalisation,
same order, same `null`/`[]` meaning. The acceptance test is a `deepEqual`
across the three payloads, not a visual review.

**P5 — A holding line ends deliberately.** 0.9 is not the next product step; it
is what can be shipped while the product step waits on the owner. It shipped two
functional patches: **0.9.0** (the month/week goal and rating surfaces) and
**0.9.1** (the close-history surface, the one remaining *stored-history* read gap
the native port records as missing), and its functional scope is now closed at
`v0.9.1`. The next action is still the five owner questions (§4), not another
theme. The docs-parity candidate was withdrawn rather than merely deferred:
0.9.0's docs pass covered parity and the docs were released with the tag, so no
drift is known, and a docs-only release with no user-visible change is release
noise — the line's second slot was better spent on a gap a user can see.

**P6 — A compatibility patch is maintenance, not a theme.** 0.9.2 exists because
the harness moved under the line, not because a new theme was invented. It may
change only: the declared compatibility map, the DSH development-dependency pins,
the lockfile, a minimal source adaptation if the new declarations require one,
and the tests/docs/release metadata that travel with the tag. It must not change
behaviour, a default, the schema, a route, a command, a tool, a skill, a
configuration key, a runtime dependency, or the host peer set, and its suite count
cannot fall; if the new cohort's own declarations force a toolchain pin or a
non-DSH peer range to move, that is recorded as a declared deviation, never as a
new dependency or peer. It is decision-free like the rest of the line and does not
extend the product.

## 3. The patches

### 3.1 Summary

| Patch | Theme | Roadmap item | Depends on | Decisions | Risk | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **0.9.0** | **Month/week goal and rating surfaces:** fill `PanelDay.goal`/`ratings` on the month and week payloads from the same readers the day route uses, and render them read-only in the calendar cells, the week columns, and the day hover card; no schema, config, route, command, tool, skill, or peer change; routes stay 18 and commands 5 | Phase 3 goal/rating read surfaces (the last stored-data panel gap) / 0.8.4 §G2's first candidate | — (branched from `v0.8.4`) | none | Low | **landed** — `v0.9.0` (`d0f9b5a`), GitHub Release (Latest at the time), 544 tests; shipped shape and deviations in §0.9.0 *Landed shape and deviations* |
| **0.9.1** | **Close-history surface (reopened, landed):** the recent scheduled closes the automation already records — day close, week close, and the weekly memory lint — join the existing insights payload as one additive `closes` list, and the existing Journal insights view gains one read-only Close history block (job, period, status, attempt count, error summary, updated date); no new route (still 18), no schema, config key, command, tool, skill, peer, write path, or model call | Native port Phase 3 remainder / [`NATIVE_PORT.md`](NATIVE_PORT.md) §1 *Missing* ("A close-history surface") | `v0.9.0` | none | Low | **landed** — `v0.9.1` (`ce0827e`), GitHub Release (Latest until `v0.9.2`), 557 tests (544 → +13); reopened from the withdrawn docs-parity candidate (see §0.9.1) |
| **0.9.2** | **DSH `0.2.2-rc.5` compatibility (maintenance, landed):** declare `0.2.2-rc.5` in `dsh.compatibility.dshReleases`, move the seven DSH SDK dev dependencies (`dsh-llm`, `dsh-skill`, `dsh-system-prompt`, `dsh-tools`, `dsh-util-values`, `dsh-client-connection`, `dsh-client-ui-primitives`) and the lock from `0.2.1-rc.2` to `0.2.2-rc.5`, add the three client host peers as devDependencies so `npm ci` resolves the cohort's cordis peers, apply a minimal source/typing adaptation only if the new declarations require one, and re-run suite/typecheck/build/package; no behaviour, default, schema, config key, route, command, tool, skill, runtime dependency, or host peer change | Maintenance — host-compatibility declaration and verification (decision-free) | `v0.9.1` | none | Low | **landed** (`v0.9.2`) — after the tag/Release the line returns to maintenance (see §0.9.2) |
| *CLI import* | `dsh dayflow import` — one command over the existing importer | Phase 2 completion / 1.0.0 runbook | cutover line | none | Medium | **not on 0.9** — recommended for the cutover line; a new entry point (5 → 6 commands) belongs beside the no-Dayflow runbook (see *The CLI import is not 0.9 material*) |

Order rationale: 0.9.0 went first and landed because it was the only remaining
item that was both decision-free and a real user-visible gap, and it was 0.8.4's
first-ranked 0.9 candidate. 0.9.1 was reopened after the release because the
0.9.0 docs pass closed the docs-parity candidate's only justification, while the
native-port record still names a real one: the close history the automation has
stored since 0.7.4 had no view, so a failed or skipped close was visible once on
the status line and then only in the logs. That was the last such gap that needed
no owner answer, which made it the line's last functional patch rather than a new
theme. It landed as `v0.9.1`. **0.9.2 is appended after the close as maintenance,
not as a third theme:** the host itself moved to `0.2.2-rc.5` after the tag, so
the declaration and the verification line are no longer true statements about the
tree; the patch says the true thing and proves it (P6), and then the line returns
to maintenance. The CLI import is deliberately not on the line. Details in §6.

### 0.9.0 — the stored day at month and week scale (month/week goal and rating surfaces)

**Status: landed in `v0.9.0`, 2026-11-27 — annotated tag `v0.9.0` on commit
`d0f9b5a`, GitHub Release Latest at the time, 544 green tests (537 at
`v0.8.4`).** One theme (R1): *the user's own day records — the focus goal and
the review marks — are legible wherever a day appears, read-only.* It is
decision-free: no owner answer, no default change, no model call, and no schema,
configuration key, route, command, tool, skill, or host peer.

Sections A–G are the finalised design the implementation started from, and they
are what shipped; where the delivered presentation differs in detail from the
sketch (dot counts, the hover body, the duplicated colour map), the difference is
recorded in **Landed shape and deviations** at the end of this section, which is
authoritative where the two disagree. Only the acceptance bullets in **C** were
binding.

**Motivation.** The day view has shown the goal and the marks since 0.7.0, but
the month cell and the week column still show only tracked time and category
arcs. Browsing a month therefore cannot tell a day that had a goal from one that
did not, or a reviewed day from an unreviewed one, without opening every day.
The data is stored, the wire types already declare it, and the day route already
normalises it; the gap is exactly that the month and week builders never attach
the two fields. The 0.8.4 close named this the line's first decision-free
candidate: "read-only rendering of stored data the day view already shows, no
default change, no model call; the last stored-data gap the panel still has."

**A. Server — fill the declared fields.**

| File | Change |
| --- | --- |
| `src/panel.ts` | `buildPanelMonth` and `buildPanelWeek`: inside the single `readDatabase` connection each already opens, read each day's goal and marks for the range and attach them per day — `payload.goal = panelGoal(dayGoalPayload(db, key, owned))` and `payload.ratings = reviewRatingsForDay(db, window, owned)` — with `owned = !runtime.config.dayflow` and the per-day window the view already computes (`dayArgument(key)` in the month, `dayWindowForKey(...)` in the week). The day route's own builder is not touched; the existing activities/captures/pending reads keep their shape. |
| `src/panel-contract.ts` | Doc comments only: `PanelDay.goal`/`PanelDay.ratings` are filled by the day, month, and week routes (not "only the day route"). No field, type, or route change; the wire shape is frozen. |

- **Why the day route's two readers are the right seam:** both answer on the
  Dayflow backend and on the owned journal (`owned` flag), and both are the
  exact normalisation the day payload uses; a month/week copy of that logic is
  how the three routes drift. Order (marks by start) and meaning (`goal: null`
  for a day whose user set no goal, `ratings: []` for a day with no marks) come
  for free.
- **Cost is bounded and local:** at most 31 day pairs for a month and exactly 7
  for a week, on the one connection the builder already opens; no extra
  connection, no network, no journal creation, no model. If review later prefers
  a single batched query that is an optimisation inside `src/queries.ts`, not an
  acceptance item and not required by this plan.
- **The existing cross-backend parity tests must stay green unchanged:**
  `tests/journal.test.ts` compares owned-vs-Dayflow `buildPanelMonth`/
  `buildPanelWeek` wholesale; after this patch they also exercise the filled
  fields, which is the cross-backend proof, not a new test file.

**B. Client — read-only rendering.**

| File | Change |
| --- | --- |
| `src/client/month.tsx` | In each day cell, a small goal marker when the day has a goal — a distinct treatment when `is_skipped` — and a compact row of rating dots (a small cap, with the full count in the marker's `title` and accessible label; the exact number is a rendering decision) in the existing rating colours; no marker for no goal and no dots for no marks, so the segmented ring stays the primary signal. `DayHover` gains the goal detail line (via `goalSummary`/`goalDetail`) and the day's marks (dot, label, and time range from the existing helpers). Nothing becomes a button. |
| `src/client/week.tsx` | The column head gains the same goal chip, with the goal detail in its `title`/`aria-label`, and a compact rating-dots strip under the head (same cap, full count in the title/label), rendered inside the sticky head row and only when the day carries data so empty days keep the column height. The per-card hover is unchanged. |
| `src/client/hover-card.tsx` | Optional, and presentational: if the day summary is shared between month and week, the shared body can live here; a `format.ts` helper used by both is equally acceptable. Either way month and week must render the same day summary from the same data — the acceptance is the shared summary, not a shared component. The portal/positioning component is untouched. |
| `src/client/format.ts` | Reuse `goalSummary`, `ratingLabel`, `ratingTimeRange`; add the compact goal/rating helpers (goal detail, compact goal text, marker label/title, dot list, rating-count summary) and the rating colour map. The dot colours must match the day view's marks: `ratingColor` is shared with `day.tsx` (moved here and imported, or exported in place) rather than forked. |
| `src/client/locale.ts` | The new strings in **both** dictionaries (en and zh): goal marker label/title, compact goal text, rating marker/count copy, and the skipped label reuse. Both dictionaries stay registered (the existing locale test covers that). |
| `src/client/styles.ts` | Classes for the marker, the dots, and the week strip; no global token change. |
| `src/client/day.tsx` | Comment only — the `undefined` branch note is corrected (month/week days now carry the fields, so a day opened from the calendar renders its goal and marks immediately; `app.tsx` already seeds the day from the month/week cache), while `null` still means "no goal" and `[]` "no marks". If `ratingColor` becomes shared from `format.ts`, this file imports it; no behaviour change. |

There is no new client surface: no tab, no button, no settings entry, no route.
The month cell stays a single click target that opens the day; the markers are
decorative and non-interactive, with text alternatives for screen readers.

**C. Acceptance (all ticked at the `v0.9.0` cut; the evidence is in *Landed
shape and deviations* at the end of this section).**

- [x] On the shared fixture, `GET /api/dayflow/month?month=2026-10` and
      `GET /api/dayflow/week?date=2026-10-21` carry, for **2026-10-19**, a
      `goal` `deepEqual` to the same day's `/day` payload (focus 240,
      distraction 60, not skipped, its focus/distraction categories) and
      `ratings` `deepEqual` and in the same order (three marks:
      `focused`, `distracted`, `neutral`); for **2026-10-20**, the skipped goal
      matches the day route and `ratings` is `[]`.
- [x] Every other day in those payloads answers `goal: null` and
      `ratings: []` — the keys are present on every day, never `undefined` and
      never absent (`'goal' in day` and `'ratings' in day` for all 31 month days
      and all 7 week days).
- [x] The existing "day-route only" assertions in `tests/panel.test.ts` are
      replaced by the three-route agreement test; the day payload itself is
      identical to 0.8.4 for the same data (no read-path regression).
- [x] Ratings keep the day route's start-ascending order and the payload has
      **no cap**; only rendering caps the dots (a small fixed number, with the
      full count in the marker's `title` and accessible label).
- [x] `tests/journal.test.ts`'s owned-vs-Dayflow month/week parity tests stay
      green unchanged (both backends now fill the fields).
- [x] The route set is still exactly **18** (9 GET + 9 POST) — the exact-route
      assertion in `tests/panel.test.ts` is unchanged; no new POST; the single
      harness entry (one tab, one header button) is unchanged
      (`tests/client-bundle.test.ts`).
- [x] Read-only proof: no write SQL, no POST handler, no model adapter, no
      journal write; an empty-data day (no goal, no marks) renders no marker and
      answers `null`/`[]` without throwing; a missing database keeps the current
      503 on the day route and the month/week error path is unchanged.
- [x] The diff adds **no** schema migration (`src/journal.ts` untouched), no
      config key (`src/config.ts` untouched), no command (`src/commands.ts`
      untouched), no tool/skill, and no `package.json`/lock dependency or peer
      change (`@deepseek-ai/dsh-attachment` still absent).
- [x] `npm test`, `npm run typecheck`, `npm run check:package`, the client
      bundle check, `npm pack --dry-run` (still no `src/`/`tests/` in the
      tarball), and both CI legs are green.
- [x] Docs travel with the tag (R6): `docs/PANEL.md`'s "month and week payloads
      are unchanged" sentence and its day-view paragraph are corrected,
      README/README.zh each gain the one-sentence description of the month/week
      markers, `CHANGELOG.md` `[Unreleased]` becomes `[0.9.0]`, and this file's
      §0.9.0 status plus `docs/ROADMAP.md`'s 0.9.x row flip to landed when
      `v0.9.0` is cut.
- [x] Release: `npm run release -- patch` cuts `v0.9.0` from the CHANGELOG
      section; the GitHub Release body names the read-only/no-schema/no-route
      shape and states that npm is still 404 (D7); no publish happens.

**D. Out of scope, explicitly.** No goal or rating **write** path (the panel
renders records; it does not create, edit, or delete them); no goal totals or
goal-vs-actual analytics across a month or week; no rating creation and no
`review.cards` card stack (the plugin still has none, so the switch still has no
surface); no model call, no new egress, no default change. A "goals met" summary
would be a new product surface, not stored-data rendering, and is not on 0.9.

**E. Gates and rollback.** The gates are C's last two bullets: suite, typecheck,
package, bundle, both CI legs, and the diff invariants (no schema/config/route/
command/peer). The change is additive read-only rendering with no migration and
no profile state, so rollback is a normal revert of the patch — R8's
config-first rule has nothing to switch here, and adding a kill-switch key would
itself break P3. A defective release is corrected by a forward patch, never by
moving the tag.

**F. Risk.** Low, with three named risks: (1) month/week refresh cost — bounded
to at most 31 local indexed lookups on the connection already open, no network,
no model; (2) visual clutter — the ring stays the primary signal, the marker is
small, the dots are capped, and a day with nothing to show draws nothing
new; (3) route drift — the `deepEqual` three-route acceptance test is the guard,
and the day builder is not touched. Nothing in the patch can change a stored
byte, and nothing in it can spend money.

**G. Test plan by file.** `tests/panel.test.ts`: replace the three negative
assertions (month payload days `undefined`; month wire shape without the keys;
week days `undefined`) with the positive three-route agreement, the `null`/`[]`
coverage for days without records, and the empty-day/no-journal-creation case.
`tests/client-format.test.ts`: the new compact goal/rating helpers and the
rating colours. No fixture change is needed — the
shared fixture already has a goal on 2026-10-19 (240/60 plus its categories), a
skipped goal on 2026-10-20 (180/90), three marks on 2026-10-19, and many days
with neither. `tests/journal.test.ts` needs no edit but is the cross-backend
gate. No new test file.

**Landed shape and deviations.** The shipped patch is the design above in one
feature commit (`38178c5`, *feat(panel): show the stored goal and review marks on
month and week*) plus the release commit (`d0f9b5a`, *chore(release): 0.9.0*),
tagged `v0.9.0`. The binding acceptance in C is green at the tag: **544/544**
tests (537 at `v0.8.4`; +7 in two files), `npm run typecheck`, `npm run
build`/client bundle, `npm run check:package` (142 packed files, no `src/` or
`tests/` entry), the exact 18-route set and the single-entry assertions, the
owned-vs-Dayflow month/week parity tests unchanged, a fresh empty month/week
answering `null`/`[]` without creating the owned journal, and the diff carrying
no schema, config, command, tool, skill, peer, or dependency change (the release
commit touches only `CHANGELOG.md`, `package.json`, and the lock file). npm
answers 404 and no publish happened. One docs-reconciliation commit followed the
tag (`4eb99d1`, *docs: reconcile the 0.9.x plan and roadmap with the v0.9.0
release*) to make this file and `docs/ROADMAP.md` describe the released tree;
the tag's own tree records the patch exactly as it was cut.

What shipped, file by file: `src/panel.ts` attaches the day route's
`goal`/`ratings` to every month and week day on the connection it already opens
(goals keyed by each day argument, marks by each day window; `goal: null` and
`ratings: []` when the user recorded nothing), and the day route is untouched;
`src/panel-contract.ts`'s two doc comments now say all three routes fill the
fields; `src/client/month.tsx` draws a goal marker plus rating dots in each cell
and adds the goal detail and the marks to `DayHover`; `src/client/week.tsx` puts
a goal chip and a dot row in a new `ColumnMeta` under the sticky day head;
`src/client/format.ts` gains `goalDetail`, `compactGoalText`, `goalMarkerText`,
`ratingColor`, `RATING_DOTS_LIMIT`, `ratingDots`, `ratingsSummary`, and
`ratingsMarkerText`; `locale.ts` gains the marker/count strings in both
languages; `styles.ts` gains the marker/dot/week-meta rules; `day.tsx` changes a
comment only.

Deviations from this section's sketch — all presentation-level, none touching the
contract, the route set, the schema, or a default:

1. **The dot cap is 3 for both views.** `RATING_DOTS_LIMIT = 3`, with the full
   count in the marker's `title` and accessible label. The plan left the number
   to implementation, so this is a recorded choice, not a scope change.
2. **No shared hover body was extracted.** `src/client/hover-card.tsx` is
   unchanged; the shared behaviour is the `format.ts` helper set both views call,
   which the plan's optional `hover-card.tsx` row allowed. The month hover card
   lists each mark (dot, label, time range) rather than a count summary.
3. **`ratingColor` is duplicated, not moved.** `src/client/day.tsx` keeps its
   local map and `src/client/format.ts` exports an identical one (same three
   tokens), because the day view was deliberately left untouched beyond the
   comment correction. Harmless today; a later refactor can dedupe it.
4. **`docs/ARCHITECTURE.md` also changed.** Its current-tree counts moved from
   537 to 544; it was not in the plan's docs list, and the change is correct.
5. **The suite grew by 7, not by an estimate.** Two panel tests (the three-route
   agreement; the empty month/week no-journal case) and five `client-format`
   cases; the plan named the shape, not the number.

Presentation decisions the sketch left open are therefore closed here; the
contract, the route set, the schema, and the default behaviour are exactly as
planned.

### 0.9.1 — the closes the automation already stores (close-history surface)

**Status: landed in `v0.9.1`, 2026-11-27 — annotated tag `v0.9.1` on commit
`ce0827e` (feature commit `be7a10c`), GitHub Release (Latest until `v0.9.2`), 557
green tests (544 at `v0.9.0`, so +13).** It was reopened from the withdrawn docs-parity
candidate. One theme (R1): *the closes the scheduler already recorded are
legible in the panel — read-only, newest first.* It needs no owner answer and
changes no default, so it satisfies P1. The docs-parity candidate it replaces is
**withdrawn,
not deferred**: its only justification was drift found *after* 0.9.0's tag, the
0.9.0 docs pass updated README/README.zh, `docs/PANEL.md`,
`docs/ARCHITECTURE.md`, `CHANGELOG.md`, `docs/ROADMAP.md`, and this file in the
same commit, no drift is known, and a docs-only release with no user-visible
change is release noise.

**Motivation — a stored ledger with no view.** The scheduled closes have written
`automation_runs` since schema v9 (0.7.4): one row per `(job, day)`, with the
lifecycle `status`, the `attempts` count, the stored `error` (a failure message
or a skip reason), and `updated_at`; the weekly memory lint joined the same
ledger in 0.7.5 as `job = 'lint'`. The panel shows none of that history. Its
close-state line (`PanelAutomationStatus`) knows the schedule, whether a close is
running, and — at most — the **last** day close and the **last** week close as
`{day, status, at}`, primed from the ledger when the process has not seen a run
yet. That is live state: one row per job, no lint row, no attempt count, no error
text, and no older row. So after a failed or skipped close — the one moment the
history matters — the user can see *that* it failed, never *what* failed, how
many attempts it took, or when the job last worked.
[`NATIVE_PORT.md`](NATIVE_PORT.md) §1 lists exactly this as *Missing*: "A
close-history surface: failed and skipped closes are recorded in
`automation_runs` and summarised on the status line, but there is no view of the
history itself." (Its Phase 3 record repeats that a
failed/skipped close history "has no view of its own".) It is decision-free and
read-only — the plugin renders rows it already wrote, adds no write path, no
retry action, no model call, no egress, and no new route — and unlike image
admission or the cutover it needs nothing from the owner. It is the last entry on
the native port's *Missing* list that is a stored-data read gap, which is why it
is the line's second and final functional patch — the only later patch, 0.9.2, is
maintenance that adds no product surface (see §0.9.2).

**A. Server — one additive list on the existing payload.**

```ts
// src/automation/read.ts (new); re-exported from src/panel-contract.ts
export interface PanelCloseSummary {
  job: 'day_close' | 'week_close' | 'lint';
  day: string;          // the day, or the Monday for a week close / lint
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
  attempts: number;
  error?: string;       // present only when a message or skip reason was stored
  updated_at: string;   // the list's order key
}
```

| File | Change |
| --- | --- |
| `src/automation/read.ts` | **New** (the 0.8.1 `src/briefs/read.ts` pattern). `readPanelCloses(db, { limit })` maps ledger rows on an already-open connection; `listPanelCloses(journalPath, { limit })` is the short-connection entry point the other panel reads expose. `limit` defaults to `PANEL_CLOSE_DEFAULT_LIMIT = 10`, accepts 1–`PANEL_CLOSE_MAX_LIMIT = 20`, and rejects anything else as `invalid_input`. The rows come from the store's existing `listAutomationRuns` — **no new SQL and no store change**; its `ORDER BY updated_at DESC, id DESC` is the panel's order, and its strict row mapping is reused unchanged. A stored error is clamped to `AUTOMATION_MAX_ERROR_CHARS` (500), so a hand-edited row cannot bloat the wire. The summary deliberately drops `id`, `created_at`, and the stored `payload` — the raw row and the job's JSON result never reach the browser. |
| `src/panel-contract.ts` | `PanelInsights` gains `closes: PanelCloseSummary[]`, documented as *additive, newest first, the 0.9.1 field*; the summary type is imported and re-exported from `./automation/read.js` beside `PanelBriefSummary`. No route constant, no other payload, and no existing field changes. |
| `src/panel.ts` | `buildPanelInsights`: the empty payload becomes six lists (`closes: []`), and the populated path reads `readPanelCloses(db)` on the **same** connection the payload already opens, right beside `readPanelBriefs(db)` — one more query, never a second open. `GET /api/dayflow/insights` stays the same route; its answer grows one key. |

- **Bounded by construction.** Ten rows of six small fields; a long-lived
  journal cannot grow the payload, and the reader refuses a caller asking for
  more than 20.
- **Both sides stay compatible.** The field is additive: a client built before
  0.9.1 ignores it, and the 0.9.1 client treats its absence as an empty list, so
  neither side needs the other to ship in lock-step — the 0.8.1 `briefs`
  precedent.
- **Tolerance, decided.** A *missing*, blank, or empty journal answers
  `closes: []` and creates or rewrites no file; a file that cannot be opened as
  this build's journal at all (not SQLite, a directory, a newer schema) also
  answers `[]`. A row no reader understands — an unknown `job` or `status`, an
  invalid `day` or `attempts`, a corrupt `payload_json` — is **not** silently
  dropped: the store's strict row mapping raises `database_error`, the route
  answers a JSON error (503, `{error}`) rather than a shorter history that reads
  as complete, and repairing the row restores the read. That is the same rule
  the briefs and task summaries already follow, and a test pins it. The
  alternative — catch it and degrade only this block to `[]` — was rejected
  because it would hide a corrupt ledger behind a plausible empty state.

**B. Client — one read-only block in the existing view.**

| File | Change |
| --- | --- |
| `src/client/insights.tsx` | After the **Briefs** block, one new **Close history** block: a local `CloseHistoryEntry` restatement of the additive field (so the client still typechecks against an older host), a `panelCloses(data)` guard that treats a missing or non-array field as no rows, and one `CloseHistoryRow` per close — job badge (**Day close** / **Week close** / **Lint**), the period (the day key, or the week's date range for a week close via the existing `weekRangeLabel`), the localized status, the attempt count only when the close was retried (`attempts > 1`), the stored updated date, and, when one was recorded, the error or skip reason folded to one truncated line whose `title` and `aria-label` carry the full message. Failed and skipped rows tint the status word one restrained warning tone; running and pending stay neutral. Nothing becomes a button: no retry, no re-run, no add row, no decision row. The view's "nothing stored" check counts the list, so a default profile shows the block's empty state like the other sections. |
| `src/client/locale.ts` | Both dictionaries gain the same keys: section title, empty state, the three job labels, the five status words, and the attempt/date/error templates (`{count}`, `{date}`, `{message}`). The dictionaries keep identical key sets, so the existing locale test stays green. |
| `src/client/styles.ts` | `dfp-close-*` rules only (row, head, job, day, status, attempts, error, the failed/skipped tone); no global token or palette change. |
| `src/client/data.ts`, `src/client/app.tsx`, `src/client/types.ts` | Unchanged: the list arrives inside the existing `fetchInsights` answer, the view keeps one entry and three views, and no tab, header button, or settings page is added. |

**C. Acceptance (all ticked at the `v0.9.1` cut; the evidence is *Landed shape
and deviations* at the end of this section).**

- [x] On a journal seeded with all three jobs and all five statuses, the payload's
      `closes` list is **newest `updated_at` first**, ties by descending row id,
      capped at **10** by default, and each entry carries exactly
      `{job, day, status, attempts, error?, updated_at}` — no `id`, no
      `created_at`, no stored `payload` — with `error` present only when the row
      recorded a non-blank one and never longer than 500 characters.
- [x] The reader's limit is validated: 1 and 20 are accepted; `0`, `21`, and a
      non-integer are `invalid_input` even for a missing journal, so no caller
      can ask for an unbounded list.
- [x] A missing, blank, or empty journal answers `closes: []` **and creates no
      file**; an unopenable journal answers `[]`; a corrupt ledger row surfaces
      the store's `database_error` as a JSON error response (503) rather than a
      truncated list, and repairing the row restores the read — all three are
      asserted.
- [x] The existing "five empty lists" expectations become **six** — the payload
      is `{tasks: [], review: [], memory: [], reflections: [], briefs: [],
      closes: []}` — and a fresh install still answers 200 without writing to
      disk.
- [x] `GET /api/dayflow/insights` is the only surface that changed: the exact
      route set is still **18** (9 `GET` + 9 `POST`), no `POST` was added, no
      route constant was added, and the single harness entry (one tab, one
      header button) is unchanged (`tests/client-bundle.test.ts`).
- [x] Read-only proof in the diff: no write SQL, no `withJournalWrite`, no POST
      handler, no retry/re-run path, no model adapter, and no new egress.
- [x] The client renders one row per close with the job badge, the localized
      status word, the attempt count only when `attempts > 1`, the one-line error
      summary with the full text in `title`/`aria-label`, and the updated date; a
      week close shows its week range; the block shows its empty state when the
      list is empty and again when an older host omits the field.
- [x] Both dictionaries carry the new keys (the copy test asserts the key sets,
      the interpolation, and that the three job and five status labels stay
      distinct); the block adds no button, tab, or entry point.
- [x] The diff adds **no** schema migration (`src/journal.ts` untouched), no
      config key, no command, no tool/skill, no dependency or host peer change,
      and no `src/automation/store.ts` change (the existing `listAutomationRuns`
      is reused).
- [x] `npm test`, `npm run typecheck`, `npm run check:package`, the client
      bundle check, `npm pack --dry-run`, and both CI legs are green. The suite
      grew by **13** (544 → 557): eleven reader cases, one payload case, and one
      copy case.
- [x] Docs travelled with the tag (R6): `docs/PANEL.md` documents the block,
      [`NATIVE_PORT.md`](NATIVE_PORT.md) §1 dropped the *Missing* bullet and its
      Phase 3 record names the reading view, `CHANGELOG.md` `[Unreleased]`
      became `[0.9.1]`, and this file's §0.9.1 status plus `docs/ROADMAP.md`'s
      0.9.x row flipped to landed at `v0.9.1`.
- [x] Release: `npm run release -- patch` cut `v0.9.1` from the CHANGELOG
      section and published its GitHub Release (`gh release view v0.9.1`:
      **Latest**); the body names the read-only / no new route / no schema shape
      and states that npm is still 404 (D7); no publish happened.

**D. Out of scope, explicitly.** No retry, re-run, or force action (that is a
write path and a new `POST` route, and `/dayflow-run-close` already owns the
manual run); no full history browser, filter, or pagination (the fixed recent 10
is the bound; more is a new view); no lint-findings view (the digest already
renders in the weekly brief and its findings become review items); no
model-written error summary (that would be the line's first model call); no
replacement of the close-state line (live state stays on the line, the block is
history); no schema, config key, command, tool, skill, peer, or default change.

**E. Gates and rollback.** C's last two bullets are the gates: suite, typecheck,
package, bundle, both CI legs, and the diff invariants (no schema/config/route/
command/peer, no store change). The change is one additive read-only list and
one presentational block, with no migration and no profile state, so rollback is
a normal revert of the patch — R8's config-first rule has nothing to switch, and
a kill-switch key would itself break P3. A defective release is corrected by a
forward patch, never by moving the tag.

**F. Risk.** Low, with three named risks: (1) payload size — bounded to ten rows
of six small fields, read on the connection the payload already opens; (2)
tolerance that hides data — a corrupt ledger surfaces as a 503 instead of a
shorter list, which is deliberate (the alternative hides the defect), and the
failure mode is the one briefs and tasks already share; (3) error text on screen
— the block renders the stored provider/skip message, which already lives on the
user's machine and in the logs, one truncated line at a time, with the full text
only in the row's title. Nothing in the patch can change a stored byte, flip a
default, or spend money.

**G. Test plan by file.** A new `tests/automation-read.test.ts` covers the reader
(11 cases): the projection and field set, a blank error omitted and a long error
clamped to 500, `updated_at DESC` with the id tie-break, the default cap and the
1–20 limit validation, empty/missing journal `[]` with no file created, the
unopenable-file `[]`, corrupt `status`/`job` rows raising `database_error` and a
repaired row restoring the read, the stored payload staying in the ledger and
off the wire, and repeated reads leaving the file untouched. The payload cases
extend `tests/panel-insights.test.ts`: the missing-journal assertion becomes six
empty lists, and a seeded journal asserts the exact ordered array and a fresh
journal `[]` without a file. That file's route test also asserts the seeded
close arrives on the one `GET` answer; `tests/panel.test.ts` gains only
`closes: []` in its insights literals (no assertion about the day, month, week,
or route set changes), and `tests/client-format.test.ts` covers the new copy in
both dictionaries, the interpolation, and the distinct job/status labels. No
fixture change is needed: the tests seed `automation_runs` directly.

**Landed shape and deviations.** The shipped patch is the design above in one
feature commit (`be7a10c`, *feat(panel): read the stored close history in the
insights view*) plus the release commit (`ce0827e`, *chore(release): 0.9.1*),
tagged `v0.9.1`. The binding acceptance in C is green at the tag: **557/557**
tests (544 at `v0.9.0`; +13 in three files), `npm run typecheck`, the client
bundle, `npm run check:package`, the exact 18-route set and the single-entry
assertions, the missing-journal "no file created" case, and the diff carrying no
schema, config, command, tool, skill, peer, or dependency change (the release
commit touches only `CHANGELOG.md`, `package.json`, and the lock file). npm
answers 404 and no publish happened.

What shipped, file by file: `src/automation/read.ts` (new) exports
`PanelCloseSummary`, `PANEL_CLOSE_DEFAULT_LIMIT = 10`, `PANEL_CLOSE_MAX_LIMIT =
20`, `readPanelCloses`, and `listPanelCloses`; the rows come from the existing
`listAutomationRuns` (newest `updated_at`, ties by descending id), each maps to
`{job, day, status, attempts, error?, updated_at}` with a 500-character error
clamp and no `id`/`created_at`/`payload`, the `1–20` limit is enforced with
`invalid_input`, a missing or unopenable journal answers `[]`, and a corrupt row
propagates the store's `database_error`; `src/panel-contract.ts` re-exports the
type and adds `PanelInsights.closes`; `src/panel.ts` returns six empty lists from
`buildPanelInsights` and reads `closes` on the open connection;
`src/client/insights.tsx` adds the block after Briefs with `CloseHistoryEntry`,
`panelCloses`, `closeJobLabel`, `closeStatusLabel`, `weekEndOf`, and
`CloseHistoryRow` (and counts `closes` in `isBlank`); `src/client/locale.ts`
adds the copy in both languages; `src/client/styles.ts` adds the `dfp-close-*`
rules; the docs pass updated `docs/PANEL.md`, `docs/NATIVE_PORT.md`,
README/README.zh, `docs/ARCHITECTURE.md`, CHANGELOG, `docs/ROADMAP.md`, and this
file.

Deviations from this section's sketch — all recorded, none touching the route
set, the schema, a default, or the read-only rule:

1. **A bad row is surfaced, not tolerated.** The sketch said a malformed row
   should be tolerated; the delivered read lets the store's `database_error`
   through (503 on the route), as **A. Tolerance, decided** explains, because a
   silently shorter history reads as complete — and it is the same rule the
   briefs and task summaries already follow.
2. **The client helpers are row-local.** `closeJobLabel`, `closeStatusLabel`,
   `weekEndOf`, and `panelCloses` live in `insights.tsx` instead of `format.ts`;
   `format.ts` already exposes the date and range helpers the block reuses, so
   the sketch's helper-file row is satisfied in place.
3. **`tests/panel.test.ts` changed, but only its two insights literals.** The
   sketch named `tests/panel-insights.test.ts` as the payload test file; the
   route-level empty literals also live in `tests/panel.test.ts`, which gained
   `closes: []` in two places and no assertion about the day, month, week, or
   route set.
4. **The suite grew by 13, not by an estimate.** Eleven reader cases (a new
   `tests/automation-read.test.ts`), one payload case, and one copy case; the
   plan named the shape, not the number.

### 0.9.2 — DSH 0.2.2-rc.5 compatibility (maintenance patch, landed)

**Status: landed in `v0.9.2`, 2026-11-27.** The target was
a patch tag `v0.9.2` cut from the green compat tree (`main` at `2383117` plus the
compat changes), with a GitHub Release built from the CHANGELOG section. It is
decision-free (P1) and maintenance-class (P6): no product surface, no default, no
schema, route, command, tool, skill, configuration key, runtime dependency, or
host peer change. When the tag is cut, this section's acceptance is ticked and it
gains its *Landed shape and deviations*, as §0.9.0 and §0.9.1 did.

**Motivation — the host is newer than the declaration.** At `v0.9.1` the tree
declares `dsh.compatibility.dshReleases` for `0.2.0-rc.2` and `0.2.1-rc.2` only,
pins all seven DSH development dependencies at `0.2.1-rc.2`, and carries a lock
built from that cohort. The DSH app installed on this machine is **`0.2.2-rc.5`**
(`CFBundleShortVersionString` and `CFBundleVersion` from
`/Applications/DeepSeek Harness.app/Contents/Info.plist`), and the npm registry
carries the full `0.2.2-rc.5` cohort for every one of those seven packages
(checked 2026-11-27). So the plugin runs on a harness release it never declared,
never built against, and never tested against; its declared compatibility record
is one release stale, and the dev-dependency cohort is the compile/typecheck
surface for the host APIs the plugin imports. The host bundle itself ships
`@deepseek-ai/cordis` 4.1.0 and `@deepseek-ai/schemastery` 3.19.0 — newer than
this tree's pins.

**What the gap is and is not.** It is **not an admission failure**: the host
admits a plugin by its own `engines.dsh` range when present, otherwise by every
`@deepseek-ai/dsh`/`dsh-*` peer range against the running version, with
prereleases included (`plugin-compatibility.ts` in the 0.2.2-rc.5 app bundle; the
`v0.2.1-alpha.3` `plugin-engines-dsh` upgrade guide records the rule). This
plugin declares no `engines.dsh`, and its `^0.2.0-rc.2` peers already admit
`0.2.2-rc.5`, so nothing is refused and no installed profile is blocked. The
`dshReleases` map is the declared-compatibility record that README, RUNBOOK,
ARCHITECTURE, this plan, and the roadmap quote — not an admission input — so a
stale map is a false declaration rather than a lockout. What is genuinely missing
is the verification: the suite, typecheck, build, and package gates have never
run against the `0.2.2-rc.5` declarations the plugin actually meets in the host.
0.9.2 fixes the declaration and runs the verification; that is why it is
maintenance rather than an emergency, and why it is not a product feature.

**A. The change.**

| File | Change |
| --- | --- |
| `package.json` — compatibility | Add `"0.2.2-rc.5": "compatible"` to `dsh.compatibility.dshReleases`, keeping the `0.2.0-rc.2` and `0.2.1-rc.2` entries. No `engines.dsh` is introduced (the peer rule the plugin already satisfies stays the admission basis), and the `peerDependencies` keep their `^0.2.0-rc.2` ranges. |
| `package.json` — development dependencies | Move the seven DSH packages — `@deepseek-ai/dsh-llm`, `dsh-skill`, `dsh-system-prompt`, `dsh-tools`, `dsh-util-values`, `dsh-client-connection`, `dsh-client-ui-primitives` — from `0.2.1-rc.2` to `0.2.2-rc.5`. No dependency is added, removed, or moved to `dependencies`/`peerDependencies`; the `@deepseek-ai/cordis` and `@deepseek-ai/schemastery` pins stay unless the new cohort's own declarations force them (see **E**, risk 2, and the deviations rule). |
| `package-lock.json` | Refreshed by the install; only the seven moved pins and their transitive metadata change. |
| `src/**`, `scripts/**` | A minimal source/typing adaptation **only if** the `0.2.2-rc.5` declarations require one — behaviour, defaults, wire shape, and the packed runtime surface stay identical. The expectation is none, and the gates decide. |
| `tests/**` | The suite runs unchanged on the new cohort. No existing test reads `dsh.compatibility` today (checked); if the patch pins the three declared releases with one small assertion in `tests/plugin.test.ts`, that is an added case, never a replacement, and the count is recorded at the cut. |

**Why this is the right content, and nothing more.** The development
dependencies are the only place the plugin's host API usage is checked at compile
time: the tool registry and schemas, the skill loader, the system-prompt context,
the client connection's Fetch registration, the client slot types, and the
`schemastery` config schema all resolve through those pins. Building against
`0.2.2-rc.5` is therefore the verification that those host surfaces are still
present and still typecheck; it ships nothing, because devDependencies never
enter the tarball. The compatibility entry is one line that makes the declared
support record true. The peer set, the dependency set, the schema, and the
behaviour are untouched by construction.

**B. Acceptance (binding at the cut).**

- [ ] The suite is green on the `0.2.2-rc.5` dev dependencies at **557+ cases** —
      v0.9.1's 557 are the floor, the count is recorded at the cut, and no case
      is removed or weakened — and `npm run typecheck`, `npm run build` (host and
      client bundle), and `npm run check:package` are green.
- [ ] `dsh.compatibility.dshReleases` lists exactly `0.2.0-rc.2`, `0.2.1-rc.2`,
      and `0.2.2-rc.5`, each `"compatible"`; no `engines.dsh` is added; the map is
      checked directly (or by the one optional assertion) at the cut.
- [ ] The diff changes no behaviour, default, schema (**v10**), route (**18**: 9
      `GET` + 9 `POST`), command (**5**), tool (**23**, 17 with `edits: false`),
      skill (**8**), configuration key, runtime dependency, or host peer entry;
      no model call, egress, or write path changes.
- [ ] `package.json` differs only in the seven dev-dependency pins and the
      compatibility map (plus the release commit's version bump), and the lock
      follows; if the cohort's own peer declarations force the
      `cordis`/`schemastery` pins or the two non-DSH peer ranges (`^4.0.4`,
      `~3.18.4`) to move, that is the one recorded deviation — never a new
      dependency or peer.
- [ ] The host evidence is recorded: the installed host version
      (`0.2.2-rc.5`), the admission rule it applies, and the fact that no
      `engines.dsh` exists and no compatibility exemption is needed; a real
      in-host load check is attempted where possible, and what cannot be verified
      end-to-end is named rather than assumed.
- [ ] `npm test`, `npm run typecheck`, `npm run build`, and
      `npm run check:package` all pass, and both CI legs (macOS 15: Node 22 with
      `--experimental-sqlite`, and Node 24) stay green.
- [ ] Docs travel with the tag (R6): README/README.zh supported-release copy and
      install list, `docs/ARCHITECTURE.md` host cohort and release line,
      `docs/RUNBOOK.md` version pin and maintenance check, `CHANGELOG.md`
      `[0.9.2]`, `docs/ROADMAP.md`'s 0.9.x record, and this file's §0.9.2.
- [ ] Release: `v0.9.2` is tagged from the CHANGELOG section with a GitHub
      Release (the **22nd** tag and Release, so no tag lacks one); npm still
      answers **404** (D7) and no publish happens; the line returns to
      maintenance and the five owner decisions are untouched.

**C. Out of scope, explicitly.** No product behaviour, default, configuration
key, schema step, route, command, tool, skill, write path, model call, or egress
change; no new host peer (`@deepseek-ai/dsh-attachment` stays absent as the
text-only rule requires); no dependency added or removed; no `engines.dsh`
introduced; no refactor beyond the minimal adaptation; no npm publish; no owner
decision; no new product surface. The compatibility map may not claim a release
the gates did not actually run on.

**D. Gates and rollback.** The gates are B, with the install/typecheck pair as
the early signal and the full suite plus `check:package` as the final gate before
the tag. The change is a declaration, a set of dev-only pins, and a lockfile,
with no migration, no profile state, and no configuration key, so rollback is a
normal revert of the patch commits (R8's config-first rule has nothing to
switch). A defective release is corrected by a forward patch, never by moving the
tag.

**E. Risk.** Low, with three named risks, each with its mitigation:

1. **Typing/API drift in `0.2.2-rc.5`.** If a declaration the plugin imports
   changed signature, the adaptation is kept minimal and behaviour-identical, and
   the suite plus typecheck are the gate. The expectation is none — the host
   cohort is the same 0.2 line — but the patch must not assume it.
2. **The toolchain chain.** The `0.2.2-rc.5` packages declare their own peers on
   `@deepseek-ai/cordis` `~4.1.0` and `@deepseek-ai/schemastery` `~3.19.0` (the
   host app ships 4.1.0 and 3.19.0), while the `v0.9.1` tree pins `cordis` `4.0.5`
   and `schemastery` `3.18.5` and declares the non-DSH peer ranges `^4.0.4` /
   `~3.18.4`. The install may therefore need the pins (and possibly those two
   non-DSH peer ranges) to move to the host's versions. If it does, it is the
   one recorded deviation in *Landed shape and deviations* — a version-range
   alignment with the host, never a new dependency or peer, and the packed
   runtime surface is still unchanged because the host supplies these packages at
   runtime.
3. **Verification gap.** A green suite proves the plugin against its dev
   dependencies, not inside the host's own process. Mitigation: record the host's
   admission rule as evidence (B), attempt a real in-host load where the machine
   allows it, and name the residual gap instead of claiming an end-to-end test
   that did not happen. The patch is maintenance precisely because nothing
   observed is broken; it must not overclaim.

**F. Test plan by file.** No new test file is needed: the existing suite is the
gate, and it exercises the host surfaces the new pins typecheck —
`tests/plugin.test.ts` (registration, tools/skills counts, apply lifecycle, the
system-prompt context), `tests/panel.test.ts` and `tests/panel-insights.test.ts`
(the 18-route table and payloads), `tests/client-bundle.test.ts` (client slots and
the bundle), and the config/format suites. The compatibility map itself is
checked directly at the cut (no test reads it today); if a one-case assertion is
added to `tests/plugin.test.ts`, it pins the three release entries and the count
rises by one. Any adaptation in `src/**` comes with the test that covers its
behaviour, and no existing case may be deleted or loosened.

**G. Release and the docs travel.** The release is the standard one: the CHANGELOG
`[0.9.2]` section rides the release commit, `npm run release -- 0.9.2` cuts the
tag, pushes, and creates the GitHub Release from that section; it does not
publish to npm (D7 unanswered), and the registry keeps answering 404. The docs
travel with the tag (R6) — README/README.zh, `docs/ARCHITECTURE.md`,
`docs/RUNBOOK.md`, `CHANGELOG.md`, `docs/ROADMAP.md`, and this file — and the
roadmap's 0.9.x record flips 0.9.2 to landed with the tag's commit; a post-tag
reconciliation commit corrects this section in place if reality diverged, exactly
as the 0.9.0 and 0.9.1 runs did.

**Why 0.9.2, not 0.10.0.** Every test in this roadmap makes it a patch: no new
surface, no new default, no schema/route/config change, no new dependency, and no
user-visible behaviour. The only things that move are the declared-compatibility
metadata and a dev-only toolchain, and the package version exists only because a
released tag is immutable and the fix needs its own record. A minor would
advertise a functional increment the release does not have; a 1.0.0 is the
owner-gated cutover line. It cannot reopen `v0.9.1` either: that annotated tag's
tree is released and documented, so a new patch tag is the honest record, exactly
as 0.9.0 and 0.9.1 were separate slots.

*Landed shape and deviations: to be recorded at the `v0.9.2` cut, as §0.9.0's and
§0.9.1's were.*

### The CLI import is not 0.9 material

`dsh dayflow import` is one command over the existing importer (`journal_import`
already covers the capability), but it is a **new entry point** (5 → 6 slash
commands) with its own tests, docs, CHANGELOG section, and its own acceptance:
import a real Dayflow database losslessly, re-run without duplicating, and make
`dayflow: false` usable on a machine with no Dayflow install. Its natural place
is the **cutover line**, beside the no-Dayflow runbook, the first-run
walkthrough, and the real-week record — the 0.8.4 §G1 prerequisites. Shipping it
on 0.9 would give the line a second theme and turn a small decision-free holding
line into a functional line. It needs no owner answer, so nothing stops it being
scheduled later; the recommendation is simply not here.

### 0.9.2 landed record (v0.9.2, 2026-11-27)

- Tag `v0.9.2` on the release commit; 557/557 tests, typecheck, build and
  `check:package` green on the `0.2.2-rc.5` development dependencies; `npm ci`
  verified from a clean tree with the refreshed lock; no npm publish.
- Implementation deviations, all evidence-driven and non-functional:
  `@deepseek-ai/cordis` moved `4.0.5 → 4.1.0` (the new cohort's peer), the three
  client host packages became devDependencies at `0.2.2-rc.5` so local and CI
  peer resolution is clean, `@deepseek-ai/schemastery` stayed `3.18.5` (the host
  bundles `3.19.0`; the declared peer range was not widened), and `src/config.ts`
  gained one type-only `Config: Schema` annotation to keep declaration emit
  portable across the two schemastery copies. Behaviour, defaults, schema v10,
  18 routes, 5 commands, 23 tools, 8 skills, and the peer dependency ranges are
  unchanged.

The declared contract this record describes is now guarded by
`tests/compatibility.test.ts` (engineering-only, added after the tag, so it
carries no tag and changes no release record): one metadata-contract case pins
`dsh.compatibility.dshReleases`, both devDependency pin sets, the deliberate
`cordis`/`schemastery` deviations, the DSH peer ranges, the empty `dependencies`,
and the removed attachment package, so a host upgrade that moves the declared
metadata fails the suite instead of drifting silently; it is that one added case,
so the current tree is **558** tests against **557** at the `v0.9.2` tag.

## 4. What is not on this line, and the unchanged 1.0.0 prerequisites

**Owner-gated work (not on 0.9):** image admission (D1/D2/D11, the former 0.8.2
scope in [`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.2), the Phase 4
`source: owned` cutover (D10 plus a real captured week, the former 0.8.3 scope),
any npm publish (D7), and the owned-journal write path (a new write surface the
roadmap deliberately leaves with Dayflow for now). None of them is started,
stubbed, or promised by this plan.

**1.0.0 prerequisites — unchanged by 0.9.x** (recorded in
[`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.4 G1; restated so this file is
self-contained):

1. A **real captured week** on the owned default: a throwaway profile with
   capture on, `source: owned`, Dayflow closed, zero data loss across restarts,
   recorded in `docs/CUTOVER_REHEARSAL.md`.
2. **D10** — explicit authorisation to flip the default.
3. **D1 and D2** answered for an analysed week (or the capture-only variant with
   `consent: none`).
4. **D11** — image admission decided, not necessarily implemented (1.0.0 can
   ship text-only on a "not now").
5. **D7** — npm publication decided; publication stays a separate reviewed step
   and changes no tag.
6. The **first-run/rollback runbook** exercised.

0.9.0 and 0.9.1 touched none of these: the holding line changed
no default, no capture, no analysis, and no import. **0.9.2 touches none of them
either:** a compatibility declaration, a dev-only toolchain pin set, and a
lockfile change no default, no capture, no analysis, and no import, and the five
decisions are exactly as unanswered as they were. **The next round's first
action is unchanged:** put the five questions to the owner as one short list —
D10, D1, D2, D11, D7 — each with the single question it answers and the patch it
unblocks.

## 5. Definition of Done (every patch)

The 0.7.x Definition of Done ([PATCH_PLAN.md](PATCH_PLAN.md) §4) and the 0.8.x
additions ([PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md) §4) apply unchanged. This line
adds the six boxes below; the two functional patches' boxes were verified at
their own tag, so every one of them is ticked, while 0.9.2's are open until its
cut.

**0.9.0 — verified at `v0.9.0`:**

- [x] **Frozen contract:** no new field, type, route, command, tool, skill,
      schema step, config key, dependency, or host peer; the only wire change is
      values in the two optional fields `PanelDay` already declares.
- [x] **Three-route agreement:** a `deepEqual` test that a day's goal and
      ratings are identical through `/day`, `/month`, and `/week`, on both
      backends, with `null`/`[]` for days that have neither.
- [x] **Read-only proof:** no write SQL, no POST handler, no model adapter, no
      journal creation; an empty-data day renders nothing and answers
      `null`/`[]`.
- [x] **No read-path regression:** the day payload is unchanged for the same
      data; the existing cross-backend parity tests stay green unchanged.
- [x] **Docs with the tag** (R6) in both languages, and this file corrected in
      place where the implementation diverged from the design — the **Landed
      shape and deviations** subsection in §0.9.0, as the 0.8 patches have.
- [x] **Release:** one tag and one GitHub Release from the CHANGELOG section;
      npm stays 404 (D7); the version bump is the only `package.json` change.

**0.9.1 — the same six rules against one additive read (verified at `v0.9.1`):**

- [x] **One declared additive change, nothing else:** `PanelInsights.closes` is
      the only new key on any payload and is absent-tolerant for an old client;
      no route, type on the wire beyond its own summary, command, tool, skill,
      schema step, config key, dependency, or host peer; no existing field
      changes meaning.
- [x] **Bounded and ordered:** ten entries by default, a 1–20 reader limit,
      `updated_at DESC` with the id tie-break, no `id`/`created_at`/stored
      `payload` on the wire, and a 500-character error clamp.
- [x] **Read-only proof:** no write SQL, no `withJournalWrite`, no POST handler,
      no model adapter; a missing journal answers `[]` and creates no file; a
      corrupt ledger row is a JSON error, never a silently shorter list.
- [x] **No read-path regression:** the other five lists and every existing
      insights field are byte-identical for the same data, the payload still
      parses without the new key, and the route set stays exactly 18.
- [x] **Docs with the tag** (R6): `docs/PANEL.md`'s Close history section,
      [`NATIVE_PORT.md`](NATIVE_PORT.md) §1/Phase 3, `CHANGELOG.md` `[0.9.1]`,
      `docs/ROADMAP.md`'s 0.9.x row, and this file's §0.9.1 status.
- [x] **Release:** one tag and one GitHub Release from the CHANGELOG section;
      npm stays 404 (D7); the version bump is the only `package.json` change.

**0.9.2 — a compatibility patch makes a different kind of claim (landed;
boxes open until the `v0.9.2` cut):**

- [ ] **One kind of change, nothing else:** the compatibility map entry, the
      seven DSH dev-dependency pins, and the lockfile — plus a minimal source
      adaptation only if the new declarations require one and, optionally, one
      assertion pinning the map. No behaviour, default, schema step, route,
      command, tool, skill, configuration key, runtime dependency, or host peer;
      no `engines.dsh`; no model call, egress, or write path.
- [ ] **The declared support is true, everywhere it is stated:** the map lists
      `0.2.0-rc.2`, `0.2.1-rc.2`, and `0.2.2-rc.5` as compatible, and
      README/README.zh, [`ARCHITECTURE.md`](ARCHITECTURE.md), and
      [`RUNBOOK.md`](RUNBOOK.md) name the same three.
- [ ] **Verified on the new cohort, not assumed:** the suite is green on the
      `0.2.2-rc.5` dev dependencies at 557+ cases (the count recorded at the
      cut), with `typecheck`, `build`, `check:package`, and both CI legs green;
      no case removed or weakened.
- [ ] **Host evidence recorded:** the installed host is `0.2.2-rc.5`, its
      admission rule is checked against this manifest, no `engines.dsh` exists and
      no compatibility exemption is required; an in-host load check is attempted
      where possible and any residual gap is named.
- [ ] **Docs with the tag** (R6): README/README.zh, `CHANGELOG.md` `[0.9.2]`,
      [`ARCHITECTURE.md`](ARCHITECTURE.md), [`RUNBOOK.md`](RUNBOOK.md),
      `docs/ROADMAP.md`'s 0.9.x record, and this file's §0.9.2.
- [ ] **Release:** one tag and one GitHub Release from the CHANGELOG section
      (the 22nd of each); npm stays 404 (D7); the line returns to maintenance and
      the five owner decisions are untouched.

## 6. Sequencing rationale and line exit criteria

1. **0.9.0 went first, and landed, because it was the only remaining item that
   was both decision-free and a real user-visible gap.** 0.8.4's §G2 ranked it
   first, the roadmap records it as the last stored-data panel gap, and it
   needed no answer from the owner. It was also cheap to verify: the data and
   the wire types already existed, so the assertions are equality tests rather
   than new behaviour.
2. **It went before any cutover work, not instead of it.** It touches the
   month/week renderers, which the cutover's first-run walkthrough also visits;
   landing it on the closed 0.8 baseline keeps any following cutover patch from
   interleaving a renderer change with a default flip.
3. **The close history is the line's second patch because it is the last
   *Missing* stored-data read.** 0.9.0's release left one gap the native port
   still names that needs no owner answer: the automation ledger records every
   close, and the panel shows only the live status line. Reopening 0.9.1 on that
   gap was cheaper to justify than the docs-parity candidate, which the 0.9.0
   docs pass already made unnecessary, and it was more useful: a failed or
   skipped close becomes inspectable instead of one status word. It is still a
   read-only, additive change under P2/P3, so it does not turn the holding line
   into a functional one.
4. **The CLI import waits for the cutover line.** A new entry point plus the
   no-Dayflow runbook is exactly the acceptance the cutover line already needs;
   putting it on 0.9 would grow the holding line past its purpose.
5. **The line stops deliberately.** Everything left on the roadmap is either
   owner-gated (image admission, cutover, npm), a new write/entry surface (the
   CLI, the owned-journal write path, editing tools), or a new product surface
   (goal analytics, task tagging, embeddings, Phase 5). None of it is 0.9
   material, and inventing a theme to keep the line alive would violate P5.
   After 0.9.1 every stored record kind the panel is meant to render — days and
   their goals and marks, the review queue, tasks and sessions, claims,
   reflections, briefs, and now the automation ledger — has a view, so a third
   functional patch would need a new product surface rather than another read.
6. **0.9.2 is maintenance appended after the close, not a third theme.** The
   harness move to `0.2.2-rc.5` made two statements in this tree stale — the
   declared compatibility record and the "verified against" dev cohort — and the
   pause allows necessary fixes. P6 bounds the patch to exactly that record and
   its evidence: the declaration, the dev-only pins, the lockfile, a minimal
   adaptation if required, and the tests/docs/release metadata. It adds no
   product surface, changes no default, and needs no owner answer, so it neither
   extends the line nor turns it into a functional one.

**Line exit criteria.** The 0.9.x line is done when: `v0.9.0` is tagged with a
GitHub Release and its §0.9.0 acceptance is green; `v0.9.1` is tagged with a
GitHub Release and its §0.9.1 C acceptance is green; the one appended
maintenance patch, 0.9.2, is tagged with a GitHub Release and its §0.9.2 B
acceptance is green; `docs/ROADMAP.md`'s 0.9.x
record and this file agree on the final state; no owner-gated work shipped on
the line; every tag in the repository has a Release; and the 1.0.0 prerequisites
in §4 are still listed as unmet with the five questions as the next action. **At
this revision the two functional items are true:** `v0.9.0` and `v0.9.1` are
tagged with GitHub Releases and their acceptance is green, the two documents
agree on the closed functional state, no owner-gated work shipped, the trail is
21/21, and the five questions are the next action; **0.9.2 has landed**, so
its tag and acceptance are the one open item before the whole record is closed.
The functional line is closed at `v0.9.1`; the maintenance patch 0.9.2 closes the
line's record at its tag and then returns it to maintenance.

## 7. How the patch ran (and how a later one would)

1. `0.9.0` branched from `v0.8.4` as `patch/0.9.0-month-week-surfaces`; the tests
   came first from §0.9.0 C — replacing the three "day-route only" negatives in
   `tests/panel.test.ts` with the three-route agreement test and adding the
   format cases — on the existing fake-host/fixture seam, with no network,
   permission, real clock, or model.
2. Server then client were implemented (`src/panel.ts` → contract comment →
   `format.ts` helpers → month/week → locale/styles), keeping the integration
   point single and the route table untouched.
3. The docs were updated in the same patch: `docs/PANEL.md`,
   `docs/ARCHITECTURE.md`, README/README.zh (both), the CHANGELOG
   `[Unreleased]` → `[0.9.0]`, `docs/ROADMAP.md`, and this file.
4. The gates ran green on the tagged tree: `npm test` (**544/544**),
   `npm run typecheck`, `npm run build`/client bundle, `npm run check:package`
   (142 packed files), and the diff invariants in C.
5. The tag was cut with `npm run release -- patch` (`d0f9b5a`); the tool bumped,
   ran the suite, committed, tagged, pushed, and created the GitHub Release from
   the CHANGELOG section. It does not publish to npm, and the registry still
   answers 404.
6. This file was corrected in place where reality diverged — the **Landed shape
   and deviations** subsection — and `docs/ROADMAP.md`'s 0.9.x record was flipped
   to landed. A post-tag docs reconciliation commit carries the final status
   (`4eb99d1`), since the tag's own tree records the patch as it was cut.

**How 0.9.1 ran.** It branched from the `v0.9.0` tag as
`patch/0.9.1-close-history`. The order followed 0.8.1's
reading-view pattern: the reader's tests first (a new
`tests/automation-read.test.ts`, plus the six-empty-lists expectations and the
seeded payload case in `tests/panel-insights.test.ts`), then
`src/automation/read.ts`, the contract field, the payload wiring in
`buildPanelInsights`, the client block and its local helpers, the locale copy
and the styles, then the
docs — `docs/PANEL.md`, [`NATIVE_PORT.md`](NATIVE_PORT.md) §1/§3,
README/README.zh, `docs/ARCHITECTURE.md`, `CHANGELOG.md`, `docs/ROADMAP.md`, and
this file. The gates ran green on the tagged tree (`npm test` **557/557**,
typecheck, bundle, `check:package`, the diff invariants in C), and
`npm run release -- patch` cut the tag (`be7a10c` + `ce0827e`), pushed, and
published the GitHub Release from the CHANGELOG section; npm was not touched and
still answers 404. Nothing in the run needed a network call, a model, a
permission, or an owner answer. As with 0.9.0, this file and the roadmap are
corrected in place to the released state, since the tag's own tree records the
patch as it was cut.

**How 0.9.2 ran (landed).** It starts from `main` at `2383117` (the
`v0.9.1` tree plus the docs runs) rather than from a new branch off the tag,
because there is no product change to isolate. The order is: measure the host
(the app's `Info.plist` version, the host bundle's own dependency versions, and
the npm availability of the seven packages), then edit the compatibility map and
move the seven dev-dependency pins, run the install to refresh the lockfile, and
take the early signal from `npm run typecheck` — the fastest way to discover
whether a `0.2.2-rc.5` declaration moved under the imports. Only if typecheck,
build, or the suite fails does the patch add a minimal source adaptation, and any
adaptation brings the test that covers it. The full gates then run in the order
of §5: suite, typecheck, build (host and client bundle), `check:package`, and
both CI legs. The docs travel in parallel — README/README.zh,
`docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, and `CHANGELOG.md` on the docs side,
`docs/ROADMAP.md` and this file here — and the two in-flight edits never touch
the same file. Nothing is committed by this planning round; the lead cuts
`v0.9.2` from the green tree with the standard release script once §0.9.2 B is
green, and the post-tag reconciliation corrects this section if reality diverged,
exactly as the 0.9.0 and 0.9.1 runs did.

**For any patch after this one:** the same rules apply. If a later patch
discovers that it cannot ship without a contract widening or a decision, it stops
before implementation and the blocker moves to §4. A 0.9 patch does not ship a
default change, a model call, an egress, or a new entry. A compatibility patch
follows P6 and §0.9.2's pattern: declare and verify the release the plugin
actually runs on, add nothing to the product, and record exactly what the gates
did not prove.
