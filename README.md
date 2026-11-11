# dsh-plugin-dayflow

[![CI](https://github.com/tailong-wu/dsh-plugin-dayflow/actions/workflows/ci.yml/badge.svg)](https://github.com/tailong-wu/dsh-plugin-dayflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-brightgreen.svg)](https://nodejs.org)

English | [中文](README.zh.md)

Ask your own work journal. This plugin gives [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) native tools and skills over [Dayflow](https://github.com/JerryZLiu/Dayflow),
the open-source Mac app that turns screen activity into a private timeline of
what was on your screen and for how long.

> "What did I work on today?" · "Where did my screen time go this week?" · "Write my standup."

![The Dayflow panel in the dsh Web GUI: a month calendar of segmented rings, the week's swim lanes with a hover card, and one day in full](docs/demo.en.gif)

The plugin reads Dayflow's local SQLite database directly, so it works while
the Dayflow app is closed and nothing leaves the Mac. Edits are optional and go
through Dayflow's own permission switch and write socket.

### What the journal can and cannot tell you

Dayflow watches the screen: the app or site in front, what was on it, and how
long it stayed. That is the whole dataset.

It does not know where you were, whether you were at the desk, who you were
with, or what happened while the Mac was idle or closed. There is no location,
calendar, or presence data here, and the agent is told to say so rather than
guess. A quiet stretch is recorded as `Idle`, which means *no screen activity
was captured* — not necessarily a break, a meeting, or time off. A day with no
cards can equally be a day of meetings, a day away, or a day whose recordings
are still being analyzed.

> **Status:** next minor (`0.6.0`, in development). Existing profiles keep using
> Dayflow by default; the owned journal and importer are the first roadmap cut.

## What you get

- **15 tools**: 8 Dayflow-compatible read tools, 1 `journal_import` tool, and 6 editing tools.
- **4 skills**: `dayflow`, `onboarding`, `standup`, and `weekly-review`.
- **An optional Web panel**: a month calendar of segmented rings, with hover
  cards and a per-day timeline, opened from a conversation-header button and
  drawn with the harness's own tokens.
- **A system-prompt section** stating the rules that make the data readable:
  the 4 AM day boundary, `Idle` and `System` handling, analysis lag, and the
  untrusted-content boundary.
- **Zero runtime dependencies** beyond `dsh` itself: SQLite comes from
  `node:sqlite`, and the write channel is a Unix socket.

## Requirements

| Requirement | Notes |
| --- | --- |
| macOS | Dayflow is a Mac app; its data lives in `~/Library/Application Support/Dayflow`. |
| [Dayflow](https://dayflow.so) installed and recording | The plugin detects a missing install and walks you through it; with `allowInstall`, the agent can run `brew install --cask dayflow` for you after you agree. |
| Node.js ≥ 22.5 | Node 22.5–23.3 need `--experimental-sqlite`; Node 24 has it built in. |
| `dsh` ≥ 0.2.0-rc.2 | The plugin peers on the 0.2 line of the harness. |
| `pnpm` on `PATH` | Only for `dsh plugin add`; a linked development install does not need it. |

## Install

```sh
# Once the package is published to a registry:
dsh plugin --profile web add dsh-plugin-dayflow
```

Until then, use the checkout install below. The plugin ships a bundle patch, so installing it selects the bundle. With HMR
enabled (the default for base-backed profiles) the running app reloads and the
tools appear in the next session. Then ask:

```text
What did I get done today?
Where did my screen time go this week?
Turn yesterday into a standup.
```

### Desktop App

The Desktop App runs its own `desktop` profile, so an install aimed at the
CLI's `web` profile does not reach it. Install into the app's profile instead
and restart the app:

```sh
mkdir -p ~/.dsh/profiles/desktop/node_modules
ln -sfn "$PWD" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-dayflow
```

Then add `"dsh-plugin-dayflow": "link:<path>"` to `dependencies` and
`"dsh-plugin-dayflow"` to `dsh.profile.bundles` in
`~/.dsh/profiles/desktop/package.json`, and quit and reopen the app. Once the
package is on a registry, the app's own Plugins page can install it instead.

Supported DSH releases: `0.2.0-rc.2` and `0.2.1-rc.2` (declared in
`dsh.compatibility.dshReleases`).

### Install from a checkout

```sh
git clone https://github.com/tailong-wu/dsh-plugin-dayflow.git
cd dsh-plugin-dayflow
npm install && npm run build

# Link it into the profile and record the bundle selection.
mkdir -p ~/.dsh/profiles/web/node_modules
ln -sfn "$PWD" ~/.dsh/profiles/web/node_modules/dsh-plugin-dayflow
```

Add `"dsh-plugin-dayflow"` to `dsh.profile.bundles` in
`~/.dsh/profiles/web/package.json` (and, optionally, a
`"dsh-plugin-dayflow": "link:<path>"` dependency entry). Rebuild with
`npm run build` after source changes; HMR reloads the profile.

To remove it, delete the symlink and the bundle entry.

## Web panel

The plugin can also draw the month and the week inside the DSH Web GUI. The panel
is optional in both senses: nothing appears until you open it, and a profile can
switch its entry point off entirely.

![The Dayflow month calendar in the dsh right Sidebar](docs/panel.en.png)

- Open it from the **Dayflow** button in the conversation header. It collapses to
  an icon when the header runs out of room.
- Every day is one segmented ring: each arc is a category, sized by its share of
  the day and drawn in the user's own colours. The centre shows the date and the
  tracked time.
- **A day's state is never faked.** A day with no captures draws only a faint
  dotted track; a captured day with nothing to show draws a plain track; a day
  whose analysis is still queued pulses amber; a recorded day draws its arcs.
  Missing data is not zero activity.
- Hovering a day shows its total, category split, and the two longest activities;
  hovering one arc shows that category's name, duration, and share. The card
  clamps to the viewport and flips above the anchor near the bottom edge.
- Clicking a day opens it: totals, filter chips, and the timed activity list.
  Clicking a chip filters the list; **Clear filter** restores it.

### Week swim lanes

A **Month / Week** switch in the header swaps the calendar for Dayflow's own
weekly timeline: seven day columns over one hour axis, each activity drawn as a
card placed at its time and tinted with its category colour.

![The Dayflow week swim lanes](docs/demo.en.png)

- The axis follows the data: it starts an hour before the week's first activity
  and ends an hour after its last, so a workday fills the pane instead of a
  4 AM-to-midnight strip. `−`/`+` zoom the axis.
- Overlapping cards share the column in packed lanes instead of covering each
  other, and a card keeps a minimum height so a five-minute block stays legible.
- Today's column is tinted, its date sits in a filled badge, and the header row
  stays pinned while the week scrolls.
- Hovering a card shows its day, time range, duration, apps, and summary;
  clicking it opens that day's detail. `‹`/`›` step weeks and **This week**
  returns to the current one.
- The week header totals the tracked time, and the category legend above the
  grid names every colour in use.
- Every card carries the icon of the site or app it was recorded from, and falls
  back to a lettered tile in the category colour when a site has no favicon.

![One day open in the panel](docs/day.en.png)

- In the day view, `‹`/`›` step days, `⟳` refreshes, and the back arrow (or
  Escape) returns to the calendar with that day still marked as selected.
- On touch devices hover is replaced by tap: a tap opens the day, and the back
  control sits in the day header.
- The panel reads `GET /api/dayflow/month`, `GET /api/dayflow/week`, and
  `GET /api/dayflow/day` through the harness's authenticated `/api` bridge. It
  never touches the database itself.
- Icons come from `GET /api/dayflow/icon?domain=…`, which fetches one
  `favicon.ico` per domain on first use and caches it under
  `$DSH_HOME/dayflow-icons`. That is the plugin's only outbound request: it
  sends no cookies and no referrer, refuses loopback and bare-IP names, and
  stops entirely with `icons: false`.
- Switching views keeps the selected day, so a day picked in the calendar stays
  marked when you move to the week and back.

Set `panel: false` to remove both the header button and the tab type.

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

### Setting Dayflow up

`dayflow_status` works even before Dayflow exists: `setup.ready`,
`setup.missing`, `setup.install_command`, and `database_present` describe what is
left to do, and the `onboarding` skill walks the user through those steps in
order.

Installing is opt-in twice over. The tool `dayflow_install_dayflow` only exists
when the profile sets `allowInstall: true`, and it still requires an explicit
`confirm: true` from a call the user agreed to. It runs exactly
`brew install --cask dayflow` (no shell, no free-form arguments), never opens the
app, and leaves screen recording, the provider choice, and the first recordings
to the user. Without Homebrew it returns the download page instead of installing
Homebrew.

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

## Tools

Every tool returns structured JSON and renders the same data as compact text.
Dates are `YYYY-MM-DD` and mean a Dayflow day, which starts at **4 AM**.

### Read tools

| Tool | Arguments | Answers |
| --- | --- | --- |
| `dayflow_timeline` | `date?` | What happened on one day, with record IDs. |
| `dayflow_activity` | `record_id` | One activity in full, including its long write-up. |
| `dayflow_breakdown` | `from`, `to` | Time per category over a range, with shares. |
| `dayflow_search` | `query`, `limit?` | Activities whose title or summary matches. |
| `dayflow_daily` | `date?` | The Daily standup Dayflow generated. |
| `dayflow_weekly` | `date?` | Tracked and focus minutes plus category totals for a week. |
| `dayflow_categories` | — | The user's categories, colors, and flags. |
| `dayflow_status` | — | Capture freshness, analysis backlog, edit switch, edit-bridge state. |

### Editing tools

These are registered by default and can be switched off with `edits: false`.
Every call is checked against Dayflow's live **Settings → AI Tools → Allow
edits** switch, so a disabled switch produces an actionable error instead of a
stale tool list.

| Tool | Arguments | Effect |
| --- | --- | --- |
| `dayflow_update_activity` | `record_id`, `title?`, `category?` | Retitle or recategorize one activity. |
| `dayflow_delete_activity` | `record_id` | Delete an activity and its observations. Destructive. |
| `dayflow_create_category` | `name`, `color?`, `description?` | Add a category. |
| `dayflow_update_category` | `name`, `new_name?`, `color?`, `description?` | Rename, recolor, or describe. |
| `dayflow_delete_category` | `name` | Delete a category. Destructive. |
| `dayflow_set_goal` | `date?`, `focus_minutes`, … | Set a day's focus target and limits. |

### Journal tool

| Tool | Arguments | Effect |
| --- | --- | --- |
| `journal_import` | `source_path?`, `source_id?` | Import a Dayflow `chunks.sqlite` into the owned journal, idempotently and with a skip report. |

### Mapping from Dayflow's own MCP server

If you used Dayflow's `dayflow mcp` server, the tools are the same operations
under a `dayflow_` prefix:

| This plugin | Dayflow MCP |
| --- | --- |
| `dayflow_timeline` | `get_timeline` |
| `dayflow_activity` | `get_activity_detail` |
| `dayflow_breakdown` | `get_time_breakdown` |
| `dayflow_search` | `search_activities` |
| `dayflow_daily` | `get_daily` |
| `dayflow_weekly` | `get_weekly` |
| `dayflow_categories` | `list_categories` |
| `dayflow_status` | `get_status` |
| `dayflow_update_activity` | `update_activity` |
| `dayflow_delete_activity` | `delete_activity` |
| `dayflow_create_category` | `create_category` |
| `dayflow_update_category` | `update_category` |
| `dayflow_delete_category` | `delete_category` |
| `dayflow_set_goal` | `set_day_goal` |

## Skills

| Skill | Use it for |
| --- | --- |
| `dayflow` | Routing: which tool answers which question, and the data conventions. |
| `onboarding` | Checking that Dayflow is installed, recording, and producing data. |
| `standup` | Drafting a standup or daily update from the timeline. |
| `weekly-review` | Reviewing a week and comparing it with the one before. |

Skills are registered at runtime from `skills/`, so installing the plugin is
enough; no skills root needs configuring.

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
- **Writes** are one JSON line over Dayflow's Unix socket
  (`agent.sock`), because the app owns the category store and must refresh its
  UI. The protocol and the edit switch are Dayflow's, not this plugin's.
- **Categories** live in the app's preferences
  (`teleportlabs.com.Dayflow`, key `colorCategories`), not in SQLite. They are
  read with `defaults export` and parsed from the plist.
- **Day boundaries** mirror the app: a day is 4 AM to 4 AM local time, and a
  week is Monday 4 AM to Monday 4 AM, so late-night work lands on the day it
  belongs to.
- **Totals** leave out the `System` category; `focus_minutes` additionally
  leaves out `Idle`. Every total is a total of recorded screen time, not of the
  user's day.

### Differences from Dayflow's own CLI and MCP server

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

## Configuration

Set these under the plugin's row in a profile patch, or through the shipped
defaults in `cordis.patch.yml`:

```yaml
- id: dayflow
  config:
    databasePath: ''   # default: ~/Library/Application Support/Dayflow/chunks.sqlite
    source: dayflow    # choose dayflow or owned after journal_import
    # dayflow: false   # compatibility alias; use instead of source, not with it
    journalPath: ''    # default: $DSH_HOME/dayflow/journal.sqlite
    agentSocket: ''    # default: agent.sock beside the database
    edits: true        # register the six editing tools
    skills: true       # register the four bundled skills
    panel: true        # the optional Web panel and its header button
    icons: true        # site favicons on the panel cards (its only outbound request)
    allowInstall: false  # register dayflow_install_dayflow (it changes this Mac)
    searchLimit: 50    # maximum matches per dayflow_search call (1-200)
```

`DAYFLOW_DB` also overrides the Dayflow path when `databasePath` is empty.
`databasePath` and `agentSocket` exist for tests and unusual installs; leave
them empty in normal use. `journalPath` may point at another owned-store file
when a profile needs to share or back up the imported journal.

## Privacy and safety

- Dayflow's data never leaves the Mac through this plugin. It opens one local
  SQLite file read-only and one local Unix socket.
- Screen-derived text (titles, summaries, write-ups) is data. The tool
  descriptions and the system-prompt section say so, so a model cannot be
  talked into following instructions that appear inside an activity title.
- Deletions also remove the underlying observations and cannot be fully undone.
  The tool descriptions require confirmation first.
- The plugin cannot enable Dayflow's edit switch; only the user can, in the app.

## Development

```sh
npm install
npm run build       # TypeScript → lib/, with .d.ts files
npm test            # 110 tests: boundaries, SQL, adapters, import, panel, bundle
npm run typecheck   # type-check sources and tests together
npm run smoke       # read this Mac's real Dayflow database (needs real data)
```

`npm run smoke` prints status, today's timeline, a seven-day breakdown, the
week, and the categories from the live database; pass a date to inspect another
day.

### Layout

```text
src/
  index.ts        plugin entry: name, inject, Config, apply()
  config.ts       schema + validation
  day.ts          4 AM days, Monday 4 AM weeks, formatting
  db.ts           lazy node:sqlite, read-only open, query helper
  journal.ts      owned schema, migrations, and Dayflow importer
  queries.ts      SQL reads and the stable JSON payloads
  categories.ts   preferences → categories and the edit switch
  bridge.ts       Unix-socket write client
  format.ts       model-facing text renderers
  skills.ts       SKILL.md loading and runtime registration
  prompt.ts       the guidance section
  panel.ts        the three host Fetch routes behind the Web panel
  panel-contract.ts  the wire payloads shared by host and browser
  tools/read.ts   the eight read tools
  tools/import.ts the journal_import tool
  tools/write.ts  the six editing tools
  client/         the browser half: month calendar, day detail, rings, styles
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

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No Dayflow database at …` | Open Dayflow, finish onboarding, record for a few minutes. |
| `Editing is off…` | Dayflow → Settings → AI Tools → Allow edits. |
| `Dayflow isn't running…` | Edits need the app open; reads do not. |
| `This Node.js (…) has no built-in SQLite` | Use Node 24+, or run Node 22.5–23.3 with `--experimental-sqlite`. |
| Time looks missing | Dayflow analyzes recordings in batches; `dayflow_status` shows the backlog. |
| Times are off by hours | The plugin uses the Mac's local timezone; check `dayflow_status`'s `time_zone`. |
| No Dayflow button in the header | Open a session first; the header is session-scoped. After installing or rebuilding, restart `dsh web` so the client bundle is served. |
| The panel says it cannot reach the server | The dsh process restarted or the session expired; reload the page. |

## License

MIT. This project ports Dayflow's agent surface and is not affiliated with the
Dayflow project. Dayflow is MIT-licensed, © 2025 Jerry Liu; see
[LICENSE](LICENSE) for the attribution covering the adapted skills and tool
contracts.
