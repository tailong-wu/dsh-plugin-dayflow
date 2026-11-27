# dsh-plugin-dayflow

[![CI](https://github.com/tailong-wu/dsh-plugin-dayflow/actions/workflows/ci.yml/badge.svg)](https://github.com/tailong-wu/dsh-plugin-dayflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-brightgreen.svg)](https://nodejs.org)

English | [中文](README.zh.md)

Ask your own work journal. This plugin gives [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) native tools, skills, and a Web panel over [Dayflow](https://github.com/JerryZLiu/Dayflow),
the open-source Mac app that turns screen activity into a private timeline of what was on
your screen and for how long. It reads either Dayflow's local database or a plugin-owned
journal imported from it once, and nothing leaves the Mac.

> "What did I work on today?" · "Where did my screen time go this week?" · "Write my standup."

![The Dayflow panel in the dsh Web GUI: a month calendar of segmented rings, the week's swim lanes, and one day in full](docs/demo.en.gif)

> **Status:** `v0.7.2` is tagged here but not yet on the npm registry; `main` is the `0.7.x` patch line this
> README describes — install from a checkout; see [CHANGELOG.md](CHANGELOG.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## What it is

Dayflow watches the screen: the app or site in front, what was on it, and how long it
stayed. That is the whole dataset.

- It does **not** know where you were, whether you were at the desk, who you were with, or
  what happened while the Mac was idle or closed. There is no location, calendar, or
  presence data, and the agent is told to say so rather than guess.
- A quiet stretch is recorded as `Idle`, meaning **no screen activity was captured** — not
  necessarily a break, a meeting, or time off. A day with no cards can equally be a day of
  meetings, a day away, or a day whose recordings are still being analyzed.
- Totals leave out the `System` category and count recorded screen time, never the whole
  day. A day is 4 AM to 4 AM in the Mac's local timezone, so late-night work lands on the
  day it belongs to; read an imported journal in the same timezone for exact totals.

## What you get

- **23 tools** (17 when `edits: false`): 12 read tools, `journal_import`, `journal_review`, `journal_task`,
  `journal_memory`, `journal_reflection`, and 6 editing tools. Full reference → [docs/TOOLS.md](docs/TOOLS.md).
- **8 skills**: `dayflow`, `onboarding`, `standup`, `weekly-review`, `review-queue`, `long-task`, `memory`,
  and `reflection`.
- **An optional Web panel**: month segmented rings, week swim lanes, a day view, and a **Journal insights**
  view — one header button, one tab, and 14 host Fetch routes. Details → [docs/PANEL.md](docs/PANEL.md).
- **Quick capture**: three slash commands (`/dayflow-task`, `/dayflow-remember`, `/dayflow-reflect`), inline
  add rows in the insights view, and a post-add history scan → [docs/QUICK_CAPTURE.md](docs/QUICK_CAPTURE.md).
- **A budgeted memory context**: active long tasks and recent dated claims are injected under a hard
  1000-byte cap with a 60-second cache; nothing is injected when there is nothing worth saying.
- **Native capture (preview)**: Phase 1 records frames into the owned journal, off by default; 0.7.1 added the
  analysis pipeline behind a consent gate, and 0.7.2 runs it on the host's model service with a status line in
  the panel — still inert on a default profile → [docs/NATIVE_CAPTURE.md](docs/NATIVE_CAPTURE.md).
- **Zero runtime dependencies** beyond `dsh`: SQLite comes from `node:sqlite`; Dayflow edits use the
  app's local Unix socket, while the owned journal has its own SQLite file.

Deep documentation: [tools](docs/TOOLS.md) · [panel](docs/PANEL.md) · [quick capture](docs/QUICK_CAPTURE.md) ·
[configuration](docs/CONFIGURATION.md) · [architecture](docs/ARCHITECTURE.md) · [native capture](docs/NATIVE_CAPTURE.md) ·
[native port plan](docs/NATIVE_PORT.md) · [roadmap](docs/ROADMAP.md).

## Requirements

| Requirement | Notes |
| --- | --- |
| macOS | Dayflow is a Mac app; its data lives in `~/Library/Application Support/Dayflow`. |
| [Dayflow](https://dayflow.so) installed and recording | The plugin detects a missing install and walks you through it; with `allowInstall`, the agent can run `brew install --cask dayflow` after you agree. |
| Node.js ≥ 22.5 | Node 22.5–22.12 and 23.0–23.3 need `--experimental-sqlite`; Node 22.13+ and 23.4+ (24 included) do not. |
| `dsh` ≥ 0.2.0-rc.2 | Peers on the 0.2 line of the harness; `pnpm` on `PATH` is needed only for `dsh plugin add`. |

## Install

No `0.7.0` release is on the registry yet. Until it is, install from a checkout — that
builds the development line described here; once published, run `dsh plugin --profile web add dsh-plugin-dayflow`.

### Desktop App

The Desktop App runs its own `desktop` profile, so an install aimed at the CLI's `web`
profile does not reach it. Link the checkout into the app's profile, record the bundle,
then quit and reopen the app:

```sh
mkdir -p ~/.dsh/profiles/desktop/node_modules
ln -sfn "$PWD" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-dayflow
```

Add `"dsh-plugin-dayflow": "link:<path>"` to `dependencies` and
`"dsh-plugin-dayflow"` to `dsh.profile.bundles` in
`~/.dsh/profiles/desktop/package.json`.

### From a checkout

```sh
git clone https://github.com/tailong-wu/dsh-plugin-dayflow.git
cd dsh-plugin-dayflow
npm install && npm run build

# Link it into the profile and record the bundle selection.
mkdir -p ~/.dsh/profiles/web/node_modules
ln -sfn "$PWD" ~/.dsh/profiles/web/node_modules/dsh-plugin-dayflow
```

Add `"dsh-plugin-dayflow"` to `dsh.profile.bundles` in
`~/.dsh/profiles/web/package.json`. With HMR enabled (the default for base-backed
profiles) the running app reloads; otherwise restart `dsh web`. Rebuild with
`npm run build` after source changes, and delete the symlink and the bundle entry to
remove it. Supported DSH releases are `0.2.0-rc.2` and `0.2.1-rc.2`; the panel's
views are covered in [docs/PANEL.md](docs/PANEL.md).

Dayflow itself is separate: `dayflow_status` says what is missing and the `onboarding`
skill walks through it. Having the agent install the app is opt-in twice — `allowInstall`
plus `source: dayflow` — and still needs `confirm: true`. The full setup flow is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#setting-dayflow-up).

## Quick start

```text
What did I get done today?
Where did my screen time go this week?
Turn yesterday into a standup.
What do you remember about how I plan my week?
```

## Web panel

The plugin can draw the month, the week, and a day inside the DSH Web GUI. The panel is
optional in both senses: nothing appears until you open it, and a profile can switch its
entry point off entirely.

![The Dayflow month calendar in the dsh right Sidebar](docs/panel.en.png)

- Open it from the **Dayflow** button in the conversation header; it collapses to an icon
  when the header runs out of room. Everything is views inside one panel tab.
- **13 host Fetch routes** back the views: month, week, day, insights, the enablement
  probe, and icons, plus the three inline adds, the history scan and link, and capture
  status and pause. The panel never touches the database itself.
- **A day's state is never faked.** A day with no captures draws a faint dotted track, a
  captured day with nothing to show draws a plain track, queued analysis pulses amber, and
  a recorded day draws its arcs; missing data is not zero activity.
- **Journal insights** is the third view: active long tasks with progress and stalled
  marks, the open review queue, recent dated memory claims, stored reflections, and one
  compact capture line. It is read-only apart from its inline add rows.

![One day open in the panel](docs/day.en.png)

Every still and recording comes from one real week of this project's own Dayflow data with fictional
titles and neutral hosts; the full view reference and route list are in
[docs/PANEL.md](docs/PANEL.md), and the `scripts/demo/` pipeline in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#demo-recordings).

## Owned journal, memory, and insights

The plugin owns a second, portable SQLite journal (schema **v8** on the 0.7.1 line) alongside the Dayflow
default. Import a Dayflow database once with `journal_import`, then point the profile at
`source: owned`: the source is opened read-only, the import is idempotent, and the existing
tools and panel keep their payloads.

- **Review queue**: distillations, recurring loops, improvements, and task proposals — the
  agent proposes, the user decides.
- **Long tasks** with dated sessions, stalled marks, and an explainable `suggest`, plus
  **dated memory** claims, day/week **reflections**, and a budgeted context injected into
  the system prompt.
- The insights view's history **scan** (last 14 days) followed by a **link** is the
  user-facing half of the same evidence trail: it previews, then writes only the days the
  user confirms.

Read the store, backends, and write paths in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md);
the quick-capture shortcuts in [docs/QUICK_CAPTURE.md](docs/QUICK_CAPTURE.md).

## Native capture (preview)

Phase 0 and Phase 1 have landed: config, capture state (schema v7 before 0.7.1), a native macOS provider, and
the capture engine behind a default-off `capture.enabled`. The engine records frames into the owned journal on
an interval, skips paused, locked, idle, and paused-app ticks, dedupes near-identical frames, and enforces
retention. 0.7.1 added the analysis pipeline: a consent gate and an idempotent frames → `activities` /
`observations` pipeline (schema v8 `analysis_jobs`), verified with fake adapters and no network.

0.7.2 makes it run and visible, **text-only**: when `capture.enabled` and `analysis.enabled` are both on and
the host's model service is available, an analysis worker ticks every `analysis.intervalMinutes` (5 by
default), calls the configured `analysis.provider`/`analysis.model` through the host, and records each
window's call and token use in the day's budget ledger. The Journal insights panel shows a read-only
**analysis line** under the capture line — off, waiting for consent, a missing provider or model, paused,
running, idle, or a stopped worker, with today's failures, the call/token budget, and the last job — and
`GET /api/dayflow/analysis/status` answers the same numbers. Once a consent is set the line also states
what leaves the machine: the frontmost app, window title, and frame hash, never the image. `/dayflow-analyze`
runs one manual tick through the same gate; there is no button in the panel, so analysis stays enabled in the
profile and the panel keeps its one entry. It is still inert on a default profile: `analysis.consent: 'none'`
blocks every call, a `cloud` or `local` consent needs an explicit provider and model, and frames reach the
model as app / window title / hash metadata rather than image bytes. Capture itself remains off by default.

Verify it locally without touching real data:

```sh
npm run native:smoke         # provider only: permission, frames, dimensions
npm run native:engine-smoke  # engine against a temporary journal and frames dir
```

Details and the status/pause routes → [docs/NATIVE_CAPTURE.md](docs/NATIVE_CAPTURE.md); the
full consent model, phases, and plans → [docs/NATIVE_PORT.md](docs/NATIVE_PORT.md).

## Configuration

Set these under the plugin's row in a profile patch, or edit the shipped defaults in
`cordis.patch.yml`:

```yaml
- id: dayflow
  config:
    source: dayflow      # or owned after journal_import
    journalPath: ''      # default: $DSH_HOME/dayflow/journal.sqlite
    edits: true          # register the six editing tools
    skills: true         # register the eight bundled skills
    panel: true          # optional Web panel and its header button
    icons: true          # site favicons (the plugin's only outbound request)
    memoryContext: true  # inject the budgeted long-task/memory context
    allowInstall: false  # register dayflow_install_dayflow (changes this Mac)
    searchLimit: 50      # max matches per dayflow_search (1-200)
    capture:
      enabled: false     # native capture engine, off by default
```

`DAYFLOW_DB` overrides the Dayflow path when `databasePath` is empty. Every key, its
default, and the capture/analysis/automation blocks are in
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Privacy and safety

- Dayflow's data never leaves the Mac through this plugin: one local SQLite file opened
  read-only and one local Unix socket.
- Screen-derived text (titles, summaries, write-ups) is **data**: the tool descriptions and system prompt say so, so
  a model cannot be talked into following instructions that appear inside an activity title.
- Deletions also remove the underlying observations and cannot be fully undone; the tools
  require confirmation first, and only the user can enable Dayflow's edit switch.
- Native capture is off by default and writes frames only to `$DSH_HOME/dayflow/frames/`
  (directory `0700`, file `0600`) with retention enforced; analysis only ticks while capture and
  analysis are both enabled, and no frame is sent away without the `cloud` consent plus a configured
  provider and model.
- The panel's favicon fetch is the only outbound request: one `favicon.ico` per domain, no
  cookies or referrer, loopback and bare-IP names refused, and `icons: false` stops it.

## Development

```sh
npm install
npm run build                # TypeScript → lib/, plus the client bundle
npm test                     # build, type-check, and run the test suite
npm run typecheck            # type-check sources and tests together
npm run smoke                # read this Mac's real Dayflow database
npm run native:smoke         # capture provider only; writes nothing
npm run native:engine-smoke  # capture engine against a temporary journal
npm run demo                 # rebuild the panel stills and GIFs
```

Layout, the demo pipeline, and the test fixtures are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the contribution rules are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No Dayflow database at …` | Open Dayflow, finish onboarding, record for a few minutes. |
| `Editing is off…` | Dayflow → Settings → AI Tools → Allow edits. |
| `Dayflow isn't running…` | Edits need the app open; reads do not. |
| `This Node.js (…) has no built-in SQLite` | Use Node 22.13+/23.4+ (24 included), or add `--experimental-sqlite` on Node 22.5–22.12/23.0–23.3. |
| Time looks missing or off by hours | Analysis runs in batches (`dayflow_status` shows the backlog), and the plugin uses the Mac's local timezone. |

Panel problems (missing header button, unreachable server after a restart) are covered in
[docs/PANEL.md](docs/PANEL.md).

## License

MIT. This project ports Dayflow's agent surface and is not affiliated with the Dayflow
project. Dayflow is MIT-licensed, © 2025 Jerry Liu; see [LICENSE](LICENSE) for the
attribution covering the adapted skills and tool contracts.
