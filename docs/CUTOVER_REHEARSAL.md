# Cutover rehearsal

[← Back to README](../README.md) · [Native port plan](NATIVE_PORT.md) ·
[Configuration](CONFIGURATION.md)

This is the written checklist for Native port **Phase 4 — Cutover and release**
([NATIVE_PORT.md §8](NATIVE_PORT.md#phase-4--cutover-and-release-about-1-week)),
executed in 0.7.6 and unchanged through the 0.8.x line, which is closed at
`v0.8.4`. It rehearses the moment the owned journal becomes the source of truth
on a fresh profile — **without flipping any default**.

The rehearsal has three steps: a fixture-based dry run that anyone can run
(`npm run rehearsal`), an optional real-capture day that needs the owner at the
machine and Screen Recording permission, and the rollback path. Any data loss
observed in step 1 or step 2 is a **blocking finding for the cutover**, not
something to note and move on.

**What this is not.** `source: owned` does **not** become the default for a
fresh install: the planned 0.8.3 cutover slot is formally deferred to the next
line (owner-gated D10), and 1.0.0 still needs a real week of capture without
data loss. Nothing is on npm: the line is tagged in this repository, the
registry answers 404, and the owner's publish authorization (D7) is not taken.
No image is admitted; every shipped release, 0.7.x through 0.8.4, is text-only.

---

## 1. Safety boundaries

Every rehearsal run — fixture or real — stays inside these limits:

- **A fresh, throwaway profile.** Never the user's daily `web` or `desktop`
  profile. The real `$DSH_HOME/dayflow/journal.sqlite` and `frames/` are not
  touched.
- **Capture is off unless the step says otherwise.** The fixture dry run
  (step 1) drives the real capture engine through a fake provider (no screen)
  and a fake text-only analyser — no real Dayflow database, no network. Only the
  optional step 2 turns `capture.enabled` on, and only for one day on the
  throwaway profile.
- **Consent is `local` or `none`.** The rehearsal never sets `cloud`, so no
  screen metadata leaves the machine. The fixture dry run uses
  `analysis.consent: 'local'` with an explicitly allowlisted fake provider
  (`provider: 'rehearsal'`, model `rehearsal-fake-model` in
  `analysis.localProviders: ['rehearsal']`); `consent: 'none'` would gate the
  pipeline and skip the close, so it is not a fixture setting.
- **No default is flipped and nothing is published.** `source` stays `dayflow`
  for normal use; `npm publish` is not part of the rehearsal.
- **No Docker, no second copy of the app, no edits to the real Dayflow
  database.** The fixture run writes only under one `mkdtemp` directory and
  removes it before exit.

## 2. Prerequisites

Run from the repository root, on the Node version the profile uses (Node ≥ 22.5;
22.5–22.12 and 23.0–23.3 need `--experimental-sqlite`):

```sh
npm install
npm run build            # the rehearsal loads the built lib/
npm test                 # build, type-check (the v0.8.4 tree this checklist was written against had 537 tests; the current suite is larger)
npm run check:package    # the packed file list a profile would install
```

Optional, local-only and permission-dependent:

```sh
npm run native:engine-smoke   # engine against a temp journal/frames dir; needs
                              # Screen Recording permission for the real provider
```

`npm run rehearsal` needs `npm run build` first (or `npm test`, which builds).
If `lib/` is missing or unloadable it prints a `npm run build` hint and exits
with code 2 instead of doing anything else.

The tree this checklist is written against (the `v0.8.4` release close) runs
**537** tests, serves **18** host Fetch routes (nine `GET` and nine `POST`),
registers **5** slash commands and **23** tools (17 with `edits: false`), ships
**8** skills, and keeps owned schema **v10**. The rehearsal and its fixture do
not change any of those numbers, so a run that moves one of them is a finding.

## 3. Step 1 — Fixture-based dry run (`npm run rehearsal`)

`scripts/cutover-rehearsal.mjs` walks the whole native chain on fixture data in
one temporary directory: capture four frames through the real capture engine
with a fake provider → analysis pipeline (fake, text-only analyser) →
`activities`/`observations` → daily brief → day insights (reflection,
proposals, task session) → weekly close (memory lint then weekly brief with its
digest) → close and reopen the journal to prove a restart keeps every row. It
never reads the real Dayflow database, never captures the real screen, and never
opens a network connection.

Exit codes: `0` every check passed, `1` at least one check failed, `2` build
output missing/unloadable. Every check row prints `check | observed | expected |
result`; any `FAIL` cell makes the run end `REHEARSAL FAIL: <failed>/<total>
checks failed` and exit 1, while a clean run ends `REHEARSAL PASS: <n>/<n> checks
passed`. The checks are:

| Check | What a PASS means |
| --- | --- |
| `journal.schema` | the temp journal migrated to the expected schema version |
| `capture.permission` | the fake provider reports `granted` |
| `capture.frames` | the engine stores the four fixture `screenshots` rows |
| `capture.frame_files` | four `.jpg` files land under the temp `frames/` tree |
| `pipeline.windows` | the four frames group into two windows (two frames, a 24-minute gap, two frames) at `windowMinutes: 10` |
| `pipeline.activities` | the fake analyser's windows become the expected `activities` rows |
| `pipeline.observations` | one `observations` row per representative frame |
| `pipeline.jobs_complete` | the `analysis_jobs` rows reach `complete` |
| `pipeline.frames_released` | `keepFramesDays: 0` deletes the analysed frame files |
| `pipeline.paths_cleared` | those `screenshots.file_path` values are cleared |
| `brief.daily_standup` | the day close writes one `daily_standup_entries` row |
| `insights.reflection` | the insights pass writes the day reflection |
| `insights.proposals` | its review proposals land in `review_items` within the cap |
| `insights.sessions` | the matching long-task session is attached |
| `weekly.lint.status` | `runWeeklyLint` returns `complete` and records its `job: 'lint'` run |
| `weekly.lint.findings` | its findings count matches the fixture's claims |
| `weekly.lint.proposals` | 3 proposals, at most one per finding subject and capped at `maxProposals: 3` |
| `weekly.brief` | the week close writes exactly one `briefs` row (`kind = 'week'`) |
| `weekly.memory_health` | that brief carries the "Memory health" digest in body and `payload_json` |
| `restart.tables` | closing and reopening the journal leaves every count unchanged |

The script also prints the fixture's full count block before and after the
reopen, so the record can be copied from one run: `screenshots`, `frame_files`,
`activities`, `observations`, `analysis_jobs` (complete), `standup_entries`,
`briefs`, `reflections`, `review_items`, `automation_runs`,
`long_task_sessions`, `memory_claims`, and `model_calls` (fake-adapter calls;
the lint pass makes none). On the shipped fixture the expected shape is
4 screenshots → 2 windows → 2 activities → 4 observations, 4 frame files on
disk then 0 after release, 2 insight proposals plus 3 lint proposals from 5
findings (capped at 3, so 5 `review_items` in total), 1 task session, and 5 model
calls (2 pipeline windows + daily brief + insights + weekly brief; the lint pass
calls no model). The script's own `expected` column is authoritative; the record
captures what actually ran. `DAYFLOW_REHEARSAL_LIB=/path/to/lib` points the run
at another build directory, for a `tsc --outDir` check without a repository
build.

Record on every run: date, `git rev-parse HEAD`, Node version, the exact command
(`npm run rehearsal`), the counts above, the restart delta (must be all zeros),
and PASS/FAIL per the table. Any FAIL is a release blocker for the cutover story
until fixed or explained in writing.

Two facts the record must state explicitly, because they are the mistakes this
rehearsal exists to catch:

- **`memory_claims` does not move.** The weekly lint files proposals only; its
  pass must leave every claim row byte-identical, so the count before and after
  the reopen is the same (and no claim is superseded or forgotten).
- **No weekly reflection exists.** The close stores one `briefs` row with
  `kind = 'week'`; the day reflection is the only reflection the automation
  writes (a week reflection remains a manual `journal_reflection` action).

Idempotency is covered by the suite rather than by a second scripted pass: the
`automation-insights`, `briefs`, and `automation-lint` tests prove that a second
day or week close skips with `already-written` and makes no model call. A
rehearsal operator who wants it in the record can run the script twice — the
temp directory is fresh each time.

## 4. Step 2 — Optional real-capture day (owner present)

Only with the owner at the machine: this step captures a real screen and needs
**System Settings → Privacy & Security → Screen Recording** for the DSH app. Use
a throwaway profile; never the daily one.

1. Create a fresh profile and install the checkout into it (the README's
   [From a checkout](../README.md#from-a-checkout) steps), so the journal starts
   empty under that profile's `$DSH_HOME/dayflow/`.
2. Configure `capture.enabled: true`, `analysis.enabled: true`,
   `analysis.consent: 'local'` (or `'none'` to skip model calls), an explicit
   `analysis.provider` and `analysis.model` if consent is `local`, and
   `automation.enabled: true`. Leave `source: dayflow` (the default) — the point
   is to watch the owned store fill, not to read it yet.
3. Capture for one Dayflow day (04:00–04:00). Confirm the panel's capture line
   and analysis line report what the profile says.
4. The next morning (after the `automation.dailyAt` boundary), confirm the day
   close ran: a standup entry, the day's reflection, review proposals, and
   matched task sessions. At the next Monday boundary, confirm exactly one week
   brief with its memory-health digest.
5. Restart the host, reopen the panel, and compare the counts to the ones
   recorded before the restart.

| Check | What to record |
| --- | --- |
| Permission | Screen Recording granted; capture line says recording |
| Frames | today's native frame count in the capture line and `screenshots` rows |
| Cards | `activities`/`observations` written for the day, and the panel day view shows them |
| Brief | one `daily_standup_entries` row for the day; one `briefs` row for the week |
| Reflection | one day reflection; **no** weekly reflection is expected |
| Proposals | open `review_items` within the daily cap |
| Restart | every count identical after restart; no rows lost or duplicated |

For a real run also record `analysis_jobs` by status
(`queued`/`running`/`complete`/`failed`/`skipped`) and `automation_runs` rows by
job and status (`day_close`, `week_close`, `lint`) — the fixture prints only the
completed-job label and the lint row, so these are the numbers unique to a real
day.

Any lost or duplicated row across the restart is a **blocking finding for the
cutover**. If the day produced nothing (no frames, or a gated analysis), record
why — a gated run is a valid rehearsal result only when the gate's reason is the
expected one.

Also record the **negative check**: a default profile (capture off,
`analysis.consent: 'none'`, no provider/model) still runs nothing — no frames,
no model calls, no `automation_runs` rows — so the rehearsal does not depend on
having turned anything on.

## 5. Step 3 — Rollback and stop paths

Everything in the rehearsal is reversible by configuration or by deleting the
throwaway profile's owned data; the journal schema is forward-only, so a bad
schema change is fixed forward rather than downgraded.

- **Stop capture:** set `capture.enabled: false` (the engine stops with the
  plugin lifecycle; the panel line reads off).
- **Stop analysis calls:** set `analysis.consent: 'none'` (every window is
  recorded `skipped` with that reason, no model call) or
  `analysis.enabled: false`.
- **Stop the closes and the lint:** set `automation.enabled: false` (the
  scheduler stops; the lint rides the same switch).
- **Remove the rehearsal data:** delete the throwaway profile's
  `$DSH_HOME/dayflow/journal.sqlite` and `$DSH_HOME/dayflow/frames/`, then remove
  the profile. Never delete the daily profile's journal as part of a rehearsal.
- **Uninstall:** remove the bundle entry and the symlink from the throwaway
  profile (README install steps, in reverse).

## 6. Rehearsal record

Copy one row per run. `Restart-loss` is "none" only when every count matches
before and after the reopen; anything else blocks the cutover. `Verdict` is
PASS when every check row is PASS and the restart delta is zero. Record the operator and
the macOS version beside the table, and add a short **deviations** paragraph
(what differed from the expected column, and why) so the next run does not
rediscover it.

| Date | Commit | Node | Permission | Frames | Cards | Brief | Reflection | Proposals | Restart-loss | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-27 | `81af8e3` | v25.8.1 | granted (fake) | 4 screenshots, 4 files → 0 | 2 activities, 4 observations | 1 standup, 1 week brief | 1 day, 0 week | 5 review items (2 insight + 3 lint) | none (13/13 unchanged) | **PASS** (20/20) |
| _(real day, optional)_ | | | | | | | | | | |

Operator: ____________________ · macOS: ____________________ ·
Command: `npm run rehearsal` / real-profile run (circle one) ·
Deviations: ____________________________________________________________

### Recorded fixture run — 2026-11-27

The first dry run on the 0.7.6 worktree (source identical to `81af8e3`; only
docs, the rehearsal script, and its test were uncommitted) printed the
following. The script and its fixture are unchanged since that run, including
on the `v0.8.1` tree (537 tests) that the release close was built from, so the
20/20 checks and the 13/13 restart baseline still apply:

```text
journal.schema 10 · capture permission granted
4 screenshots · 4 frame files → 0 after release
2 windows → 2 activities · 4 observations · 2 complete analysis_jobs
1 daily standup · 1 day reflection · 2 insight proposals · 1 task session
weekly lint complete: 5 findings → 3 proposals · 1 week brief with digest
5 review_items total · 4 memory_claims unchanged · 1 automation_runs row (lint)
5 model calls (2 pipeline windows + daily brief + insights + weekly brief)
restart: 13/13 count labels unchanged
REHEARSAL PASS: 20/20 checks passed
```

This is the baseline a later run is compared against: the counts per stage, the
zero `memory_claims` delta, and the 13/13 restart comparison.

## 7. Config defaults audit (0.7.0 → 0.8.4)

Diff of `git show v0.7.0:src/config.ts` against `src/config.ts` at the `v0.8.4`
release close: **no existing default changed on the line**. Three keys were
added on the 0.7.x line — `analysis.intervalMinutes` (0.7.2),
`analysis.localProviders` (0.7.1), and `automation.catchUpDays` (0.7.4) — and
both blocks moved from "validated but unused" to wired; **the 0.8.x line added
no key and changed no default**, and 0.8.4 only bumps the package version. That
is why every row below is either an explicit owner decision or inert on a
default profile.

| Key | 0.7.0 default | 0.8.4 default | Changed? | Classification |
| --- | --- | --- | --- | --- |
| `capture.enabled` | `false` | `false` | no | **owner decision** — capture is opt-in; default-inert (nothing records) |
| `capture.intervalSeconds` | `45` | `45` | no | default-inert (capture off) |
| `capture.idleSeconds` | `120` | `120` | no | default-inert (capture off) |
| `capture.maxFramesPerDay` | `1200` | `1200` | no | default-inert (capture off) |
| `capture.keepFramesDays` | `0` | `0` | no | **owner decision D5** (delete after success); default-inert (capture off) |
| `capture.dedupeDistance` | `4` | `4` | no | default-inert (capture off) |
| `capture.retentionCheckMinutes` | `60` | `60` | no | default-inert (capture off) |
| `capture.pauseApps` | `[]` | `[]` | no | default-inert (capture off) |
| `capture.displays` | `'main'` | `'main'` | no | default-inert (capture off) |
| `analysis.enabled` | `true` | `true` | no | default-inert — needs `capture.enabled` and a consent |
| `analysis.consent` | `'none'` | `'none'` | no | **owner decision D1** (unanswered → safe default); blocks every model call |
| `analysis.provider` / `analysis.model` | `''` / `''` | `''` / `''` | no | **owner decision D2** (no implicit host default); empty blocks analysis |
| `analysis.windowMinutes` | `10` | `10` | no | default-inert (no consent/capture) |
| `analysis.framesPerWindow` | `3` | `3` | no | default-inert (no consent/capture) |
| `analysis.maxCallsPerDay` | `120` | `120` | no | **owner decision D3** (call cap, enforced); default-inert |
| `analysis.dailyTokenBudget` | `200000` | `200000` | no | **owner decision D3**; default-inert — reported on 0.7.x, a post-call gate since 0.8.0, default unchanged |
| `analysis.intervalMinutes` | _absent_ | `5` | **added (0.7.2)** | default-inert — only read when the worker runs |
| `analysis.localProviders` | _absent_ | `[]` | **added (0.7.1)** | default-inert — empty accepts no provider under `local` |
| `automation.enabled` | `true` | `true` | no | default-inert — mounts only with the analysis stack (`capture.enabled` + `analysis.enabled` + host model service) |
| `automation.dailyAt` | `'04:00'` | `'04:00'` | no | **owner decision 6** (Monday/04:00 boundary); inert without the mount gate |
| `automation.weeklyOn` | `'monday'` | `'monday'` | no | **owner decision 6**; inert without the mount gate |
| `automation.catchUpOnStart` | `true` | `true` | no | default-inert (bounded by `catchUpDays`, no mount by default) |
| `automation.catchUpDays` | _absent_ | `2` | **added (0.7.4)** | **owner decision D4** (finalised); bounds catch-up only when mounted |

Top-level keys (`source`, `databasePath`, `journalPath`, `agentSocket`, `edits`,
`skills`, `panel`, `icons`, `memoryContext`, `allowInstall`, `searchLimit`) kept
the same defaults across the 0.7.x–0.8.x lines; `source` still defaults to
`dayflow` and is **not** flipped by any 0.8.x release.

## 8. What this rehearsal does not cover

- Image admission / pixels: deferred to the next line (owner-gated D1/D2/D11);
  every shipped release is text-only.
- The `source: owned` default flip and first-run walkthrough: deferred to the
  next line (owner-gated D10) and a 1.0.0 prerequisite.
- npm publication: not taken — the package is tagged in the repository, the
  registry answers 404, and publishing is a separate owner decision (D7).
- A multi-day/real-week dogfood run: the 1.0.0 bar, not this checklist.

## 9. 0.8.x line close record (`v0.8.4`)

The cutover checklist above is the Phase 4 rehearsal; it never shipped the
cutover. This is the release record for the line that deferred it:

| Release | Theme | State |
| --- | --- | --- |
| `v0.8.0` | analysis-ledger follow-ups: post-call token gate, transient-skip catch-up within today/yesterday, 04:00 day tail | tagged; GitHub Release note |
| `v0.8.1` | briefs reading view: additive `PanelInsights.briefs`, `listPanelBriefs`, read-only expandable panel block | tagged; GitHub Release note |
| `0.8.2` (planned) | image admission | **deferred to the next line** — owner has not answered D1/D2/D11; not implemented |
| `0.8.3` (planned) | Phase 4 cutover | **deferred to the next line / 1.0.0 prerequisite** — owner has not answered D10; only the rehearsal above exists |
| `v0.8.4` | release close: docs reconciliation, release-trail verification, deferred items made explicit, npm left at 404 | tagged in this repository |

The tagged tree is the rehearsal's baseline: **537** tests, **18** host Fetch
routes (nine `GET`, nine `POST`), **5** slash commands, **23** tools (17 with
`edits: false`), **8** skills, owned schema **v10**, no host peer or dependency
added by the line, and no npm artifact. The next line starts from a real week of
capture without data loss, the owner's image-admission answer, the owned-default
flip decision (D10), and npm publish authorization (D7).
