# Patch plan: the 0.9.x line

> **Status:** **the 0.9.x line is open, and it is decision-free by construction.**
> The 0.8.x line closed at its release-close patch: `v0.8.4` is an annotated tag
> on commit `e298813`, the commit that closed the line, with a GitHub Release
> (Latest until `v0.9.0`). That tree is **537** green tests, schema **v10**,
> **18** panel routes (9 `GET` + 9 `POST`), **5** slash commands, **23** tools,
> **8** skills, and still **no npm publication** (the registry answers 404). The
> 0.8 line's tags are exactly **`v0.8.0`, `v0.8.1`, `v0.8.4`**, each with a
> GitHub Release; the owner-gated 0.8.2 (image admission) and 0.8.3 (Phase 4
> cutover) were **deferred to the next line**, never started, and are not
> renumbered. Across the repository the trail is now **20 tags / 20 Releases**,
> with **`v0.9.0` Latest**: the `v0.6.0` gap the 0.8.4 close recorded as history
> was backfilled as a release-only operation after that tag, so every tag has a
> Release today.
>
> **This line's one committed patch is 0.9.0 — month/week panel goal and rating
> surfaces — and it has landed and been released** (`v0.9.0`, annotated tag on
> `d0f9b5a`, GitHub Release **Latest**, **544** green tests — 537 at `v0.8.4`,
> so 0.9.0 added 7). It is decision-free and read-only: the stored goal and the
> user's own review marks, which the day view already rendered, are visible in
> the month cells and the week columns. **No schema, configuration key, route,
> command, tool, skill, default, host peer, or model call was added** — the line
> stayed at 18 routes, 5 commands, schema v10, and text-only. **0.9.1 is a
> candidate, not a promise:** docs/README parity, and only if 0.9.0's own docs
> pass had left a real gap; the 0.9.0 docs pass covered README/README.zh, PANEL,
> ARCHITECTURE, CHANGELOG, ROADMAP, and this file, so the recommendation is to
> end the line at `v0.9.0` (see §0.9.1). The `dsh dayflow import` CLI is **not on
> this line** (see *The CLI import is not 0.9 material*).
>
> **Owner-gated work does not enter 0.9.** Image admission (D1/D2/D11, the
> former 0.8.2 scope), the Phase 4 `source: owned` cutover (D10 plus a real
> captured week, the former 0.8.3 scope), any npm publish (D7), and the
> owned-journal write path stay deferred; the 1.0.0 prerequisites in §4 are
> unchanged and untouched by this line. This plan supersedes the
> *forward-looking* half of [`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.4 G
> (its "0.9 candidate" wording is the 0.8 record; from this revision the
> decision-free items are scheduled here). The 0.8.x plan is frozen as history:
> the line it describes is tagged and released. [`PATCH_PLAN.md`](PATCH_PLAN.md)
> is the 0.7.x record and stays frozen too.
>
> **Last revised:** 2026-11-27, against the `v0.9.0` tree (`d0f9b5a`), the
> line's released tree; the starting-point table keeps the `v0.8.4` baseline the
> line was designed from, with both measurements dated.
>
> Related documents: [`ROADMAP.md`](ROADMAP.md) carries the phases, the
> iterations tables, and what remains; [`PANEL.md`](PANEL.md) is the view 0.9.0
> changes; [`PATCH_PLAN_0.8.md`](PATCH_PLAN_0.8.md) §0.8.4 G is the close that
> opened this line; [`CHANGELOG.md`](../CHANGELOG.md) is the record of what
> actually shipped.

## 1. Starting point, measured

Facts checked against the repository, the tag list, the GitHub release list, and
the npm registry on 2026-11-27. The **design baseline** was measured on the
`v0.8.4` tree (`e298813`); the **landed measurement** is the `v0.9.0` tree
(`d0f9b5a`), whose suite was re-run for this revision (**544 pass, 0 fail, 0
skipped, 0 todo**) with the release list read (`v0.9.0` is `Latest`). Both are
dated below; when an operation invalidates one, it updates this table.

| Fact | Value | Checked at |
| --- | --- | --- |
| Baseline for this line | **landed at `0.9.0`**, annotated tag `v0.9.0` (commit `d0f9b5a`); `package.json` version `0.9.0`. The line was designed from and branched off `v0.8.4` (`e298813`) | `package.json`, `git tag`, `git log` |
| Release trail | **20 tags / 20 GitHub Releases** across the repository; **`v0.9.0`** (`d0f9b5a`) is `Latest` and its body is the CHANGELOG `[0.9.0]` section, while `v0.8.4`'s body names 0.8.2/0.8.3 deferred with their blocking decisions. The 0.8 line's tags are exactly `v0.8.0` (`f4191b9`), `v0.8.1` (`af002c3`), `v0.8.4` (`e298813`). The `v0.6.0` gap the tagged 0.8.4 docs record as history was **backfilled** as a release-only operation after that close (release published 2026-11-27 06:26Z), so no tag lacked a Release before this line | `gh release list --limit 30`, `git tag`, `gh release view v0.9.0` |
| npm | `npm view dsh-plugin-dayflow version` answers **404** — never published; D7 still unanswered, so the safe default stays "tagged here, not on the registry" (checked again on the `v0.9.0` tree) | `npm view`, README/README.zh |
| Tests | **544** cases, green on the tag (`npm test`: 544 pass, 0 fail, 0 skipped, 0 todo; 537 at `v0.8.4`, 521 at `v0.8.0`, 494 at `v0.7.6`). 0.9.0 added 7 in 2 files: `tests/panel.test.ts` (the three-route agreement and the empty month/week no-journal test) and `tests/client-format.test.ts` (5 cases). CI runs macOS 15 with Node 22 (`--experimental-sqlite`) and Node 24 | `npm test`, `.github/workflows/ci.yml` |
| Tools / skills / commands | 23 tools registered by default (17 with `edits: false`) plus `dayflow_install_dayflow` behind `allowInstall: false`; 8 skills; 5 slash commands (`dayflow-task`, `dayflow-remember`, `dayflow-reflect`, `dayflow-analyze`, `dayflow-run-close`) — 0.9.0 changes none of these | `src/index.ts`, `src/commands.ts`, `tests/plugin.test.ts` |
| Panel | 18 exact host Fetch routes (9 GET + 9 POST), one UI entry (one header button, one panel tab), one insights payload. The read views are `/api/dayflow/day`, `/api/dayflow/month`, `/api/dayflow/week`, and all three days share one type (`PanelDay`) — 0.9.0 adds no route | `src/panel-contract.ts`, `src/panel.ts`, `tests/panel.test.ts`, `tests/client-bundle.test.ts` |
| Owned schema | **v10** (`automation_runs` accepts `'lint'`; `briefs.payload_json`); 0.8.4 and 0.9.0 changed no migration and no table | `src/journal.ts` → `JOURNAL_SCHEMA_VERSION` |
| The gap 0.9.0 closed (history) | At the `v0.8.4` baseline `PanelDay` declared `goal?: PanelGoal \| null` and `ratings?: PanelRating[]`, and the **day** route filled them while `buildPanelMonth` and `buildPanelWeek` built their days through `dayPayload()` and never attached either field; `tests/panel.test.ts` asserted that absence and `docs/PANEL.md` described it as intended ("the month and week payloads are unchanged, so only opening a day pays for those reads"). 0.9.0 filled the fields, flipped those tests to the three-route agreement, and corrected the doc prose | `src/panel.ts` (`buildPanelDay`/`buildPanelMonth`/`buildPanelWeek`), `src/panel-contract.ts`, `tests/panel.test.ts`, `docs/PANEL.md` |
| Host cohort | DSH dev dependencies `0.2.1-rc.2`, peers `^0.2.0-rc.2`. `@deepseek-ai/dsh-llm` is declared and used through a structural seam; `@deepseek-ai/dsh-attachment` is **not** a dependency — the line stays text-only, as 0.8.4 left it | `package.json`, `src/analyse/host.ts` |
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
the 0.8.4 close.

**What this line is, in one sentence:** the last stored-data gap in the panel,
made visible without adding a surface, a decision, or a dependency — shipped as
`v0.9.0`.

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

**P3 — The contract is frozen; only declared fields are filled.** No schema
migration, no configuration key, no route, no command, no tool, no skill, and no
host peer. The one wire change allowed is *filling* the two optional fields
`PanelDay` already declares for month/week days — no new field, no new type, no
new route. A patch that needs to widen the contract does not belong on 0.9.

**P4 — One day, one answer, three routes.** A day's goal and ratings are
identical whether read through `/day`, `/month`, or `/week`: same normalisation,
same order, same `null`/`[]` meaning. The acceptance test is a `deepEqual`
across the three payloads, not a visual review.

**P5 — A holding line ends deliberately.** 0.9 is not the next product step; it
is what can be shipped while the product step waits on the owner. After 0.9.0
(and at most one docs-parity patch) the line stops, and the next action is still
the five owner questions (§4), not another theme.

## 3. The patches

### 3.1 Summary

| Patch | Theme | Roadmap item | Depends on | Decisions | Risk | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **0.9.0** | **Month/week goal and rating surfaces:** fill `PanelDay.goal`/`ratings` on the month and week payloads from the same readers the day route uses, and render them read-only in the calendar cells, the week columns, and the day hover card; no schema, config, route, command, tool, skill, or peer change; routes stay 18 and commands 5 | Phase 3 goal/rating read surfaces (the last stored-data panel gap) / 0.8.4 §G2's first candidate | — (branched from `v0.8.4`) | none | Low | **landed** — `v0.9.0` (`d0f9b5a`), GitHub Release Latest, 544 tests; shipped shape and deviations in §0.9.0 *Landed shape and deviations* |
| **0.9.1** | **Docs/README parity (candidate):** reconcile README/README.zh, `docs/PANEL.md`, the "what remains" list, and the compatibility statement with the tagged tree; docs and release artefacts only, no behaviour change | Release/closure hygiene | `v0.9.0` | none | Low | **candidate, not scheduled** — 0.9.0's docs pass covered both languages and every current-tree count, so no drift is known; the line is recommended to close at `v0.9.0` (see §0.9.1) |
| *CLI import* | `dsh dayflow import` — one command over the existing importer | Phase 2 completion / 1.0.0 runbook | cutover line | none | Medium | **not on 0.9** — recommended for the cutover line; a new entry point (5 → 6 commands) belongs beside the no-Dayflow runbook (see *The CLI import is not 0.9 material*) |

Order rationale: 0.9.0 went first and landed because it was the only remaining
item that was both decision-free and a real user-visible gap, and it was 0.8.4's
first-ranked 0.9 candidate; 0.9.1 is second-or-never because the docs already
travelled with 0.9.0 under R6; the CLI import is deliberately not on the line.
Details in §6.

### 0.9.0 — the stored day at month and week scale (month/week goal and rating surfaces)

**Status: landed in `v0.9.0`, 2026-11-27 — annotated tag `v0.9.0` on commit
`d0f9b5a`, GitHub Release Latest, 544 green tests (537 at `v0.8.4`).** One theme
(R1): *the user's own day records — the focus goal
and the review marks — are legible wherever a day appears, read-only.* It is
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
answers 404 and no publish happened.

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

### 0.9.1 — docs/README parity (candidate, not scheduled)

**Status: candidate, not scheduled — the line is recommended to close at
`v0.9.0`.** One theme (R1): *the docs match the tagged tree.* Docs and release
artefacts only (the 0.8.4 precedent): README/README.zh parity, the "what remains"
list, the compatibility statement, and any drift 0.9.0's docs pass uncovers. No
code, no schema, no route, no default. Dependency met: `v0.9.0`.

**Recommendation: do not open 0.9.1.** R6 already made the 0.9.0 docs part of its
tag, and that docs pass updated README/README.zh, `docs/PANEL.md`,
`docs/ARCHITECTURE.md`, `CHANGELOG.md`, `docs/ROADMAP.md`, and this file in the
same commit, so no drift is known at the tag. A separate parity patch is
justified only by drift found *after* the tag — a zh/en page disagreeing, a count
that changed, or a "what remains" list that still names the month/week surfaces
as future work — and none of those exists. The line should close at `v0.9.0`; a
docs-only release with no user-visible change is release noise. If drift is ever
found: about half a day, no risk beyond prose, `v0.9.1` tagged with a CHANGELOG
section and docs + release artefacts only.

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

0.9.x touched none of these: the holding line changed no default, no capture, no
analysis, and no import. **The next round's first action is unchanged:** put the
five questions to the owner as one short list — D10, D1, D2, D11, D7 — each with
the single question it answers and the patch it unblocks.

## 5. Definition of Done (every patch)

The 0.7.x Definition of Done ([PATCH_PLAN.md](PATCH_PLAN.md) §4) and the 0.8.x
additions ([PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md) §4) apply unchanged. This line
adds — all six verified for `0.9.0` at its tag, and the boxes are therefore
ticked:

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
3. **Docs parity is a candidate, not a schedule.** The docs travelled with
   0.9.0 (R6); a separate 0.9.1 exists only for drift found afterwards, and no
   drift is known, so the line ends at one tag.
4. **The CLI import waits for the cutover line.** A new entry point plus the
   no-Dayflow runbook is exactly the acceptance the cutover line already needs;
   putting it on 0.9 would grow the holding line past its purpose.
5. **The line stops deliberately.** Everything left on the roadmap is either
   owner-gated (image admission, cutover, npm), a new write/entry surface (the
   CLI, the owned-journal write path, editing tools), or a new product surface
   (goal analytics, task tagging, embeddings, Phase 5). None of it is 0.9
   material, and inventing a theme to keep the line alive would violate P5.

**Line exit criteria.** The 0.9.x line is done when: `v0.9.0` is tagged with a
GitHub Release and its §0.9.0 acceptance is green; `v0.9.1` is either done or
explicitly dropped as unnecessary; `docs/ROADMAP.md`'s 0.9.x record and this file
agree on the final state; no owner-gated work shipped on the line; every tag in
the repository has a Release; and the 1.0.0 prerequisites in §4 are still listed
as unmet with the five questions as the next action. **At this revision every
item but the formal closure is true:** `v0.9.0` is tagged and green, 0.9.1 is
recommended to be dropped, the two documents agree, the trail is 20/20, and the
five questions are the next action — so the line is ready to be declared closed
at `v0.9.0`, with no `v0.9.1`.

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
   to landed. A post-tag docs reconciliation commit carries the final status,
   since the tag's own tree records the patch as it was cut.

**For any patch after this one:** the same rules apply. If a later patch
discovers that it cannot ship without a contract widening or a decision, it stops
before implementation and the blocker moves to §4. A 0.9 patch does not ship a
default change, a model call, an egress, or a new entry.
