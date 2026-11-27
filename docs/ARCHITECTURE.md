# Architecture

[← Back to README](../README.md)

The plugin reads one of two backends — the Dayflow app's `chunks.sqlite`
(`source: dayflow`, the default) or the plugin-owned journal (`source: owned`,
owned schema version 8, filled by `journal_import`) — and writes through two
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
  quick-capture slash commands and the panel's three inline add routes write the
  same way.
- **Native analysis (0.7.1 foundation, no worker yet).** When a caller invokes
  it, `analyse/pipeline.ts` reads one Dayflow day's native `screenshots` rows
  (04:00–04:00), groups them into windows (`analysis.windowMinutes`, at most
  `framesPerWindow` representative frames), runs the pure consent gate, builds
  the strict-JSON prompt, calls the injected analyser (a fake in tests; the host
  `llm` adapter is wired in 0.7.2), validates the single JSON object, and writes
  `activities` + `observations` with `source_id = 'native'` and a deterministic
  window key (`analysis:<job key>`, per-frame keys for observations) in one
  journal transaction. `analysis_jobs` (schema v8) records
  each window so replaying the same frames is a no-op. With
  `capture.keepFramesDays: 0` a successful window's frame files are deleted and
  its `screenshots.file_path` is cleared, while the row, its key, and its hash
  stay; the engine's retention sweep is the fallback for frames no job took.
  Real provider/image calls, the worker timer, and the status route land in
  0.7.2 — today the path is exercised only by fake-adapter tests.
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
  analyse/        frame analysis foundation (0.7.1; no worker or timer yet)
    jobs.ts       analysis_jobs state machine, attempts cap, per-day call/token totals
    consent.ts    the pure consent/allow gate checked before any provider call
    prompt.ts     strict JSON contract, category list injection, untrusted-content rule
    llm.ts        caller-supplied stream wrapper: retries, timeout, token accounting, fake adapter
    pipeline.ts   window grouping, output validation, sessionisation, activities/observations writes
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
  tasks.ts        long tasks, their daily sessions, derived progress
  memory.ts       dated memory claims: supersede, search, lint
  reflections.ts  day/week reflections stored in the owned journal
  context.ts      the budgeted long-task/memory system context
  icons.ts        favicon fetch, cache, and the icon route's data
  setup.ts        read-only detection of the Dayflow install
  errors.ts       the stable failure codes
  paths.ts        Dayflow's database/socket and the plugin's own paths
  panel.ts        the host Fetch routes behind the Web panel (reads and inline-add writes)
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

## Development

```sh
npm install
npm run build       # TypeScript → lib/, with .d.ts files
npm test            # 384 tests: boundaries, SQL, adapters, import, review queue, long tasks, memory, reflections, context injection, panel, history scan, native capture, bundle
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
  DSH releases are `0.2.0-rc.2` and `0.2.1-rc.2` (declared in
  `dsh.compatibility.dshReleases`).
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
