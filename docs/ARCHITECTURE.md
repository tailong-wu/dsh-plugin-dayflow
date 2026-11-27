# Architecture

[← Back to README](../README.md)

The plugin reads one of two backends — the Dayflow app's `chunks.sqlite`
(`source: dayflow`, the default) or the plugin-owned journal (`source: owned`,
owned schema version 10, filled by `journal_import`) — and writes through two
channels: Dayflow's Unix socket for app edits, and `withJournalWrite` for the
owned journal. This file covers those paths, the source layout, and the
development scripts.

## How it works

```text
dsh  ──tools──▶  dsh-plugin-dayflow  ──read──▶  chunks.sqlite (read-only, WAL)
                              │                         ▲
                              │                         │ journal_import (read-only)
                              └──owned backend ──▶  $DSH_HOME/dayflow/journal.sqlite
                              │
                              └──write──▶  Dayflow.app over agent.sock
```

- **Dayflow reads** open `chunks.sqlite` with `readOnly: true` and
  `PRAGMA query_only`, so a bug in this plugin cannot damage the app's journal.
  A short busy timeout rides out the app's WAL checkpoints.
- **Owned reads** migrate the plugin journal through a short writable connection,
  then reopen it read-only. Its compatibility views preserve the current query
  and panel contracts.
- **Dayflow writes** are one JSON line over Dayflow's Unix socket
  (`agent.sock`), because the app owns the category store and must refresh its
  UI. The protocol and the edit switch are Dayflow's, not this plugin's.
- **Owned-journal writes** go straight to the plugin's own SQLite file and never
  through Dayflow: `journal_import`, `journal_review`, `journal_task`,
  `journal_memory`, and `journal_reflection` write through `withJournalWrite`
  (`src/journal.ts`), so they are not gated by Dayflow's edit switch. The
  quick-capture slash commands, the panel's three inline add routes, and its
  review/task-session decision routes write the same way. A panel review
  decision calls `applyReviewDecision` (`src/review-actions.ts`) — the same
  module the `journal_review` tool uses — so both paths combine the item with
  its task or memory claim identically. The 0.7.4 automation adds a third writer
  path through the same module: the scheduler and its insights pass write the
  day's `daily_standup_entries`, the weekly `briefs` row (`kind = 'week'`), the
  day reflection, review proposals, kept memory claims, matched task sessions,
  and one `automation_runs` row per attempted close. The weekly close writes
  exactly that one stored week brief: it adds no weekly reflection and no weekly
  review pass, so a stored week brief is the compressed week record. That path
  is gated by the analysis consent/provider/model, not by Dayflow's edit switch.
  The 0.7.5 weekly memory lint reuses that path but only as a **proposal
  writer**: inside the weekly close it calls `lintMemoryClaims` and files review
  proposals — it never writes, supersedes, or forgets a `memory_claims` row — and
  the digest it returns is rendered into that week's `briefs` body and
  `payload_json`.
- **Native analysis (0.7.1 pipeline, 0.7.2 worker, 0.8.0 ledger gates, 0.8.1 briefs reading view).**
  `analyse/pipeline.ts` reads one Dayflow day's native `screenshots` rows
  (04:00–04:00), groups them into windows (`analysis.windowMinutes`, at most
  `framesPerWindow` representative frames), runs the pure consent gate, builds
  the strict-JSON prompt, calls the analyser (the host `ctx.llm` adapter in
  production, a scripted fake in tests), validates the single JSON object, and
  writes `activities` + `observations` with `source_id = 'native'` and a
  deterministic window key (`analysis:<job key>`, per-frame keys for
  observations) in one journal transaction. `analysis_jobs` (schema v8) records
  each window so replaying the same frames is a no-op. `analyse/worker.ts` ticks
  on `analysis.intervalMinutes` only when `capture.enabled` and
  `analysis.enabled` are on and the host model service is available;
  `analyse/status.ts` backs `GET /api/dayflow/analysis/status` and the panel's
  analysis line, and `/dayflow-analyze` runs one manual tick. With
  `capture.keepFramesDays: 0` a successful window's frame files are deleted and
  its `screenshots.file_path` is cleared, while the row, its key, and its hash
  stay; the engine's retention sweep is the fallback for frames no job took. It
  stays inert on a default profile (`analysis.consent: 'none'` blocks every
  call), and the whole shipped line is text-only: the model receives the
  frontmost app, window title, and frame hash as metadata, never pixels; image
  admission is deferred to the next line (owner-gated D1/D2/D11). Since 0.8.0 the same
  ledger is money-bounded and self-healing, with no schema change: the day's
  recorded `input_tokens + output_tokens` (summed from `analysis_jobs`) is
  compared with `analysis.dailyTokenBudget` before a window starts and again
  right after each completed call. A run that begins with the day already at the
  cap starts no call, and once a completion puts the day at or above the budget
  every remaining window in that run is recorded `skipped` with reason
  `budget-tokens`; the call that crossed it stays complete (nothing is clawed
  back), and the run result carries `outcome: 'budget'` with
  `budgetKind: 'tokens'`. The call cap stays a pre-call gate (reason `budget`,
  `budgetKind: 'calls'`) and wins when it trips first. `analyse/skips.ts` holds
  the pure whitelist of configuration-caused skip reasons
  (`TRANSIENT_SKIP_REASONS`: disabled/paused/consent/provider/model/analyser,
  plus a non-local provider) and the bounded replay pass
  `replaySkippedAnalysisWindows`, which requeues today's and yesterday's
  transient skips `skipped → queued` with a conditional update after a
  non-blocked tick — attempts are not reset, the previous reason is kept in
  `payload_json` as `replayed_from` / `replayed_at`, a failed pass is logged
  (`analysis.catch_up`) without changing the day's result, and `budget`,
  `budget-tokens`, `failed`, and unknown reasons are never replayed. The worker
  also runs the **04:00 day tail**: one bounded pipeline run for yesterday, so
  yesterday's just-requeued windows are picked up in the same pass; the run is
  guarded by the checkpoint
  `analysis_tail_checked_on` in `capture_state` (the checkpoint holds today's
  day key and is written for every non-blocked outcome; a blocked run leaves it
  unwritten so a later consent fix that day still catches up). The tail runs in
  its own `try/catch`: a throw is recorded on the worker's `lastError` and
  logged as `analysis.day_tail`, but it never changes today's `lastOutcome`,
  never counts toward the backoff, and never stops the loop. The checkpoint
  lives beside the existing `capture_state` keys `paused`, `last_frame_at`, and
  `last_sweep_at`. The status payload gains the additive
  `tokenBudgetExhausted`, and the panel's analysis line turns amber (state
  "Daily token budget reached") while the day's token budget is spent.
- **Categories** live in the app's preferences
  (`teleportlabs.com.Dayflow`, key `colorCategories`), not in SQLite. They are
  read with `defaults export` and parsed from the plist.
- **Day boundaries** mirror the app: a day is 4 AM to 4 AM local time, and a
  week is Monday 4 AM to Monday 4 AM, so late-night work lands on the day it
  belongs to.
- **Totals** leave out the `System` category; `focus_minutes` additionally
  leaves out `Idle`. Every total is a total of recorded screen time, not of the
  user's day.

## Differences from Dayflow's own CLI and MCP server

- No MCP transport and no Swift binary: the plugin is plain Node and reads the
  database itself.
- `source: owned` (or `dayflow: false`) removes the runtime dependency on the
  Dayflow app after `journal_import`; the source database is never modified.
- Editing tools are always registered (with `edits: true`) and rejected at call
  time, instead of disappearing from `tools/list` when the user disables edits.
  Users who want them gone can set `edits: false`.
- Search escapes `%` and `_`, so a query is literal text rather than a SQL
  pattern.
- Impossible dates such as `2026-02-30` are rejected instead of being rolled
  over.
- Failures carry a stable code: `no_data`, `edits_disabled`, `app_not_running`,
  `not_found`, `invalid_input`, `database_error`, or `bridge_error`.

## Owned journal

The `0.6.0` roadmap cut lets the plugin own a second, portable SQLite journal.
Dayflow remains the default source, so existing profiles do not change. Import a
Dayflow database once, then point the profile at the owned backend:

```text
journal_import({})
```

```yaml
- id: dayflow
  config:
    source: owned
    journalPath: ''  # default: $DSH_HOME/dayflow/journal.sqlite
```

`journal_import` opens the Dayflow source read-only, writes a forward-migrated
owned schema, keeps stable source IDs, and can be run again without duplicating
rows. The owned store exposes the same query views, so the existing tools and
panel routes keep their payloads. Dayflow's 4 AM buckets use the machine's local
timezone; read an imported journal in the same timezone for exact cross-midnight
totals. The importer also reports data it deliberately skips (for example
provider call logs and chat history). Editing tools remain Dayflow-only in this
increment; use `source: dayflow` when you need app edits.

## Layout

```text
src/
  index.ts        plugin entry: name, inject, Config, apply()
  config.ts       schema + validation
  analyse/        text-only frame analysis (0.7.1 foundation, 0.7.2 worker, 0.8.0 ledger gates)
    jobs.ts       analysis_jobs state machine, attempts cap, per-day call/token totals the gates read
    skips.ts      the pure skip-replay policy (TRANSIENT_SKIP_REASONS) and the bounded today/yesterday requeue pass
    consent.ts    the pure consent/allow gate checked before any provider call
    prompt.ts     strict JSON contract, category list injection, untrusted-content rule
    llm.ts        caller-supplied stream wrapper: retries, timeout, token accounting, fake adapter
    host.ts       adapts the host llm service (text blocks only, no images)
    worker.ts     interval worker, single-flight ticks, backoff, 04:00 day tail, manual runOnce
    status.ts     read-only analysis status/ledger payload (incl. tokenBudgetExhausted) for the panel route
    pipeline.ts   window grouping, output validation, sessionisation, pre/post-call budget gates, activities/observations writes
  briefs/         text-only day and week briefs written by the close (0.7.4)
    daily.ts      standup/daily brief from the day's activities → daily_standup_entries
    weekly.ts     seven-day rollup → briefs
    read.ts       listPanelBriefs: the additive insights payload behind the panel's read-only Briefs block (0.8.1)
  automation/     the scheduled day/week close (0.7.4), plus the weekly lint (0.7.5)
    store.ts      automation_runs state machine: idempotent closes, bounded retries, skipped rows
    consent.ts    the automation pass reuses the analysis consent/provider/model gate
    scheduler.ts  host timers, 04:00/Monday boundaries, catchUpOnStart + catchUpDays catch-up
    insights.ts   post-close reflection, review proposals, kept memory claims, task sessions
    lint.ts       weekly memory lint inside the weekly close: proposals only, never a claim edit; digest in the weekly brief
  day.ts          4 AM days, Monday 4 AM weeks, formatting
  db.ts           lazy node:sqlite, read-only open, query helper
  journal.ts      owned schema, migrations, importer, withJournalWrite
  queries.ts      SQL reads and the stable JSON payloads
  categories.ts   preferences → categories and the edit switch
  bridge.ts       Unix-socket write client
  format.ts       model-facing text renderers
  skills.ts       SKILL.md loading and runtime registration
  prompt.ts       the guidance section
  review.ts       review queue: proposals, decisions, suppression
  review-actions.ts  one decision path: item + task/memory via applyReviewDecision
  tasks.ts        long tasks, their daily sessions, derived progress
  memory.ts       dated memory claims: supersede, search, lint
  reflections.ts  day/week reflections stored in the owned journal
  context.ts      the budgeted long-task/memory system context
  icons.ts        favicon fetch, cache, and the icon route's data
  setup.ts        read-only detection of the Dayflow install
  errors.ts       the stable failure codes
  paths.ts        Dayflow's database/socket and the plugin's own paths
  panel.ts        the host Fetch routes behind the Web panel (reads, adds, decisions, status lines)
  panel-contract.ts  the wire payloads shared by host and browser
  tools/read.ts   the twelve read tools
  tools/import.ts the journal_import tool
  tools/setup.ts  the conditional dayflow_install_dayflow tool
  tools/review.ts the journal_review tool
  tools/task.ts   the journal_task tool
  tools/memory.ts the journal_memory tool
  tools/reflection.ts the journal_reflection tool
  tools/write.ts  the six editing tools
  client/         the browser half: month calendar, week swim lanes, day
                  detail, insights tab, rings, styles
skills/           SKILL.md per skill, shipped in the npm package
tests/            node:test suite with a fixture database and a fake socket
scripts/smoke.mjs real-data smoke test
```

`lib/client.js` is not compiled by `tsc`: `scripts/build-client.mjs` bundles
`src/client/` with esbuild and wraps the CommonJS body in the harness's
`window.__ModuleLoader__.load({ id, factory })` registration, resolving `react`,
`react/jsx-runtime`, and `@deepseek-ai/dsh-client-ui-primitives` against the
browser shell's frozen platform table. `tests/client-bundle.test.ts` runs that
bundle in a VM with stubbed platform modules, so the registration contract is
tested without a browser.

The fixture database in `tests/fixtures/database.ts` reproduces the app's
schema and the cases that are easy to get wrong: a card after midnight, a
soft-deleted card, `System` time, and metadata with apps and distractions. The
bridge tests run a real Unix socket server, so the protocol is exercised end to
end.

## Release line

The 0.8.x line is closed at `v0.8.4` and the 0.9.x line at `v0.9.2`; their shape
is what the modules and tests above describe:

- `v0.8.0` — analysis-ledger follow-ups: the token budget is a post-call gate,
  configuration-caused skips replay within today and yesterday, and the 04:00
  boundary gets one bounded day tail. No schema, route, command, tool, skill,
  configuration key, or default change.
- `v0.8.1` — briefs reading view: the insights payload gains the additive
  `briefs` list, and the panel renders it as a read-only, expandable block.
- `0.8.2` (planned, **deferred to the next line**) — image admission. The owner
  has not answered D1/D2/D11, so every shipped release stays text-only.
- `0.8.3` (planned, **deferred to the next line / 1.0.0 prerequisite**) — the
  Phase 4 cutover; only the rehearsal exists ([CUTOVER_REHEARSAL.md](CUTOVER_REHEARSAL.md)),
  and the owner has not answered D10.
- `v0.8.4` — release close: documentation, release-trail verification, and the
  explicit deferral above. No plugin source, schema, route, command, tool,
  skill, configuration key, default, or dependency change; the package version
  is the only `package.json` change.
- `v0.9.0` and `v0.9.1` — additive panel payloads: the month/week goal marks and
  review rating dots, then the read-only close-history block. No route, schema,
  command, configuration key, or default change.
- `v0.9.2` — compatibility patch: `dsh.compatibility.dshReleases` declares DSH
  `0.2.2-rc.5`, the development dependencies move to `0.2.2-rc.5` (the SDK packages plus the three client host peers added as devDependencies; `cordis` to
  `4.1.0`), and `Config` gains an explicit type-only `Schema` annotation so its
  emitted declaration stays portable. No behaviour, default, schema, route,
  command, tool, skill, peer-range, or runtime-dependency change; the package
  version is the only other `package.json` change.

Every 0.8.x and 0.9.x release is text-only and adds no host peer or runtime
dependency.

The tagged tree runs **557** tests, serves **18** host Fetch routes (nine `GET`
and nine `POST`), registers **5** slash commands and **23** tools (17 with
`edits: false`), ships **8** skills, and keeps owned schema **v10**. Nothing is
on the npm registry: the line is tagged in the repository and the registry
answers 404 (no publish authorization, owner decision D7).

## Development

```sh
npm install
npm run build       # TypeScript → lib/, with .d.ts files
npm test            # 581 tests (557 at the v0.9.2 tag): boundaries, SQL, adapters, import, review queue, long tasks, memory, reflections, context injection, panel, history scan, native capture, cutover rehearsal, bundle
npm run typecheck   # type-check sources and tests together
npm run smoke       # read this Mac's real Dayflow database (needs real data)
npm run check:package  # assert the tarball ships lib/ and skills/ and no src/, tests/, or sourcemaps
```

`npm run smoke` prints status, today's timeline, a seven-day breakdown, the
week, and the categories from the live database; pass a date to inspect another
day.

Two other groups of scripts are documented where their subject is:

- `npm run demo` regenerates the panel's stills and GIFs (both languages) — see
  [Demo recordings](#demo-recordings).
- `npm run native:smoke` and `npm run native:engine-smoke` are the native
  capture smoke scripts — see [NATIVE_CAPTURE.md](NATIVE_CAPTURE.md).

## Environment and runtime

- macOS: Dayflow is a Mac app, and its data lives in
  `~/Library/Application Support/Dayflow`.
- Node.js ≥ 22.5. Node 22.5–22.12 and 23.0–23.3 need `--experimental-sqlite`;
  Node 22.13+ and 23.4+ (24 included) do not.
- `dsh` ≥ 0.2.0-rc.2: the plugin peers on the 0.2 line of the harness. Supported
  DSH releases are `0.2.0-rc.2`, `0.2.1-rc.2`, and `0.2.2-rc.5` (declared in
  `dsh.compatibility.dshReleases`); as of 0.9.2 the development dependencies and
  the verification run are on `0.2.2-rc.5` (`cordis` `4.1.0`). The 0.7.x and
  0.8.x lines added **no** host peer beyond that declared cohort and no runtime
  dependency: `@deepseek-ai/dsh-llm` was already declared and is the only host
  service the analysis path calls, and `@deepseek-ai/dsh-attachment` is not a
  dependency because every shipped release is text-only, and no 0.8.x release
  adds a runtime dependency: across 0.8.0–0.8.4 `package.json` differs only in the
  package version. The 0.9.2 compatibility patch adds no peer or runtime
  dependency either: it only widens the declared cohort and moves the
  development-dependency pins, and its one source change is a type-only `Config`
  annotation (validation and defaults untouched). Image admission, which would
  need that attachment service, is deferred to the next line (owner-gated
  D1/D2/D11).
- `pnpm` on `PATH` is only needed for `dsh plugin add`; a linked development
  install does not need it.

## Demo recordings

The recordings and stills above all come from one real week of this project's own
Dayflow data: the timings, durations, categories, and capture times are what the
app recorded. Every activity title and summary is fictional, because that text
names documents, colleagues, and projects; project-specific sites are mapped to
neutral hosts for the same reason. `scripts/demo/` holds the whole pipeline:
`fixture-text.mjs` is the fictional copy pool, `capture.mjs` freezes a week with
that copy applied, and `record.mjs` drives the real client half through the
`tour.mjs` script and encodes the GIF. Regenerate with:

```sh
npm run demo          # both languages: build, capture stills, encode GIFs
npm run demo -- zh    # or just one
```

## Setting Dayflow up

`dayflow_status` works even before Dayflow exists: `setup.ready`,
`setup.missing`, `setup.install_command`, and `database_present` describe what is
left to do, and the `onboarding` skill walks the user through those steps in
order.

Installing is opt-in twice over. The tool `dayflow_install_dayflow` only exists
when the profile sets `allowInstall: true` **and** still reads Dayflow
(`source: dayflow`, the backend whose app it installs); a profile on
`source: owned` does not register it. Even then it still requires an explicit
`confirm: true` from a call the user agreed to. It runs exactly
`brew install --cask dayflow` (no shell, no free-form arguments), never opens the
app, and leaves screen recording, the provider choice, and the first recordings
to the user. Without Homebrew it returns the download page instead of installing
Homebrew.
