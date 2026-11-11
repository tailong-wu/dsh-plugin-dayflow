# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Both READMEs open with an 8-second recording of the panel — month calendar,
  week swim lanes with a hover card, and one day in full — captured from this
  project's own week of Dayflow data.
- `scripts/demo/`: the pipeline that produces that recording. It bundles the real
  client half with a replay data source and the three harness primitives it
  imports, drives it through a scripted tour in headless Chromium, and encodes a
  GIF from settled stills. `npm run demo` regenerates both languages; see
  CONTRIBUTING for the steps.
- The demo's fixture is committed already sanitized: `capture.mjs` replaces every
  title and summary with fictional copy while keeping the recorded timings,
  durations, categories, and apps, so the repository never holds a real activity
  title.

### Changed

- `docs/panel.*.png`, `docs/day.*.png`, and `docs/week.*.png` were re-captured
  from the same fixture, so the README's stills and its GIF show one consistent
  week instead of three unrelated ones.

### Fixed

- The plugin no longer implies the journal knows about the world off-screen.
  Dayflow records screen activity, so it cannot say where the user was, whether
  they were at the desk, who they were with, or what happened while the Mac was
  idle or closed. Several places read as if it could:
  - the system-prompt section said to "treat Idle as time away from work", which
    turns a stretch of no captured pixels into a claim about what the user did;
    it now defines Idle as no screen activity and forbids naming an activity for
    it, and states up front that the timeline covers the screen only
  - the `dayflow` skill promised answers about "where their time went" and now
    says what to do when a question is about the physical world: say the
    timeline cannot answer it and offer what was on screen
  - the `weekly-review` skill now warns that a week of low tracked time can be a
    week of meetings, travel, or leave
  - the READMEs claimed a timeline of "what you actually worked on" and asked
    "where did the week go"; both now say screen time, with a section on what the
    journal can and cannot tell you
  - the panel's "No data" and "Recorded, no activity" states now say what they
    actually mean (no capture, or captured with nothing to show) instead of
    reading as "nothing happened"
- The test fixture and the demo copy pool no longer contain cards that only a
  location sensor could produce ("Grocery run", "Away from the keyboard",
  "Lunch and a walk"); personal time is represented as what it is, screen
  activity such as a shopping tab or a news site.
- The `dayflow_timeline`, `dayflow_activity`, and `dayflow_breakdown`
  descriptions state that they return recorded screen time rather than the
  user's whole day.

## [0.6.0] - 2026-11-10

### Added

- A plugin-owned SQLite journal at `$DSH_HOME/dayflow/journal.sqlite` with a
  forward-only `schema_version` migration and compatibility views that preserve
  the existing tool and panel payloads.
- `journal_import`, a read-only, additive, idempotent Dayflow importer. It keeps
  stable source IDs, imports timeline/capture/standup and future journal tables,
  and reports unchanged rows plus deliberately skipped data.
- An `owned` backend selected with `source: owned` (or `dayflow: false`), so the
  panel and read tools can run after Dayflow is removed; Dayflow remains the
  default backend for existing profiles.

### Changed

- The next capability increment is intentionally limited to roadmap Phases 1–2:
  review queues, privacy redaction, long tasks, and memory injection remain
  later minor releases.
- Added the documented `npm run smoke` script and updated the package metadata
  to the `0.6.0` minor line.

## [0.5.1] - 2026-10-26

### Fixed

- `dayflow_status` read the host's real install state, so its tests depended on
  whether the runner had Dayflow: CI (no app, no Homebrew) rendered the setup
  path and failed an assertion written for a recording machine. The probe is now
  injected through the tool runtime, the tests describe the machine they need,
  and a new case covers the uninstalled path.
- Experiment and demo artifacts (`out/`, `scripts/demo/`, demo GIFs) are ignored,
  so a release commit cannot sweep hundreds of megabytes into the repository.

## [0.5.0] - 2026-10-26

### Added

- Setup detection: `dayflow_status` now answers on a machine where Dayflow is
  not installed, returning `setup.ready`, an ordered `setup.missing` list
  (install → open → screen recording → provider → first recording),
  `setup.install_command`, `setup.download_url`, `homebrew_installed`, and
  `database_present`. A missing database is a setup state, not a tool failure.
- `dayflow_install_dayflow`, registered only with `allowInstall: true`,
  installs Dayflow through `brew install --cask dayflow` after an explicit
  `confirm: true`. It runs one fixed command without a shell, never opens the
  app, and reports the Homebrew output tail on failure.
- The `onboarding` skill now walks the user through those steps and treats the
  installer as optional, so a profile without `allowInstall` gets the command or
  the download page instead.

### Changed

- `dayflow_status` gained `database_present`; the capture counters read zero when
  there is nothing to read instead of failing the call.

## [0.4.0] - 2026-10-23

### Added

- Site icons on the panel: every week card and day-detail row now shows the
  favicon of the app or site it was recorded from, falling back to a lettered
  tile in the category colour.
- `GET /api/dayflow/icon?domain=…`, which fetches one `favicon.ico` per domain on
  first use, caches it under `$DSH_HOME/dayflow-icons`, and serves it with a
  week-long cache header. This is the plugin's only outbound request: no
  cookies, no referrer, loopback and bare-IP names refused, 4 s timeout, and
  256 KB cap.
- An `icons` configuration switch (default `true`); `false` makes no request and
  also ignores already-cached icons.

### Changed

- Week cards keep their title readable next to the badge: the title is the only
  child that may shrink, so a long host name never squeezes it to one character.

## [0.3.1] - 2026-10-23

### Fixed

- The week view stepped through its seven days by adding 86,400,000 ms per day,
  which lands on the wrong date across a daylight-saving boundary (for example
  Berlin's late-October change returned a six-day week). It now steps by
  calendar day and resolves each day with the 4 AM window, so DST weeks keep
  seven days.
- The week-layout tests built cards from fixed `+08:00` offsets, so they failed
  on a UTC runner. They now build local dates, and the suite passes in UTC,
  Berlin, New York, Kolkata, Auckland, and Lord Howe.

## [0.3.0] - 2026-10-23

### Added

- A **Week** view beside the calendar: seven day columns over one hour axis, with
  each activity drawn as a card placed at its time and tinted by its category
  colour, matching Dayflow's own weekly timeline.
- `GET /api/dayflow/week?date=YYYY-MM-DD`, returning seven consecutive
  `PanelDay` payloads anchored on Monday, so the week view needs no client-side
  merging across month boundaries.
- Packed lanes for overlapping cards, a minimum card height so short blocks stay
  readable, a data-driven hour axis with `−`/`+` zoom, a sticky header row, a
  tinted today column with a date badge, an inline category legend, and a weekly
  tracked total.
- Hover cards on week cards (day, time range, duration, apps, summary) and
  click-through to the day detail.
- A **Month / Week** segmented switch in the panel header; switching keeps the
  selected day marked in both views.

### Changed

- The panel body now owns the view state, so the day detail returns to whichever
  view opened it.

## [0.2.1] - 2026-10-22

### Added

- Desktop App compatibility metadata: `dsh.compatibility.dshReleases` declares
  `0.2.0-rc.2` and `0.2.1-rc.2` compatible, and `dsh.client.inject` names the
  client packages whose services the panel's slots come from.
- Peer declarations for `@deepseek-ai/dsh-client-connection`,
  `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-locale`,
  `@deepseek-ai/dsh-client-ui-conversation`,
  `@deepseek-ai/dsh-client-ui-sidebar-right`, `react`, and `react-dom`, so the
  manifest's requirements match what the two halves actually import.

### Changed

- The development cohort moves to DSH `0.2.1-rc.2` (`cordis` 4.0.5,
  `schemastery` 3.18.5), and the panel type-checks against the real
  `@deepseek-ai/dsh-client-ui-primitives` types instead of a local shim.

### Notes

- Verified on both `0.2.0-rc.2` and `0.2.1-rc.2`: the tool-definition surface,
  the skill registry, the system-prompt sections, and the exact Fetch-route
  signature are unchanged across that corridor, and the client platform table
  still exposes React, React DOM, and the UI primitives.

## [0.2.0] - 2026-10-20

### Changed

- The Web panel is now a month calendar. Every day is a segmented ring sized by
  that day's category minutes, with hover cards, click-through day details,
  category filters, day stepping, and a layout that follows the pane width and
  switches from hover to tap on touch devices.
- `PanelDay.pending_batches` and `PanelDay.last_capture_at` now describe the day
  itself rather than the process-wide backlog and the newest capture anywhere.
- The conversation-header toggle collapses to an icon below 720px, where the
  header runs out of room.

### Added

- `GET /api/dayflow/month?month=YYYY-MM`: one `PanelDay` per calendar day, plus
  the month, today, and timezone. Day states are derived from `tracked_minutes`,
  `pending_batches`, and `last_capture_at`, so quiet days, days with no captures,
  and days still being analyzed never render as zero activity.
- Tests for the month payload and route, per-day capture and backlog queries,
  month math, localized formatting, and the Monday-first calendar grid.
- Localized documentation screenshots for the calendar and the day view.

### Fixed

- Chinese timestamps in the panel and hover cards now use a 24-hour clock.

## [0.1.0] - 2026-10-19

### Added

- Eight read tools over Dayflow's local SQLite database: `dayflow_timeline`,
  `dayflow_activity`, `dayflow_breakdown`, `dayflow_search`, `dayflow_daily`,
  `dayflow_weekly`, `dayflow_categories`, and `dayflow_status`.
- Six editing tools over Dayflow's Unix-socket bridge, gated by the app's own
  "Allow edits" switch: `dayflow_update_activity`, `dayflow_delete_activity`,
  `dayflow_create_category`, `dayflow_update_category`,
  `dayflow_delete_category`, and `dayflow_set_goal`.
- Four skills registered at runtime: `dayflow`, `onboarding`, `standup`, and
  `weekly-review`.
- A system-prompt section documenting the 4 AM day boundary, `Idle`/`System`
  handling, analysis lag, and the untrusted-content boundary.
- An optional Web panel: a conversation-header button opens a right-Sidebar tab
  with the day's category bar and activity cards, drawn with the harness's own
  primitives and design tokens. `panel: false` removes its entry points.
- Two host routes behind the panel, `GET /api/dayflow/day` and
  `GET /api/dayflow/panel`, registered through the connection service so they
  inherit the browser-trust fence and session cookie.
- A browser half built as a lazy-CJS `__ModuleLoader__` bundle with esbuild,
  using only the harness's frozen platform modules (React and the UI
  primitives) and no runtime dependencies.
- A bundle patch so `dsh plugin add` mounts the plugin, plus `databasePath`,
  `agentSocket`, `edits`, `skills`, and `searchLimit` configuration.
- Tests covering day and week boundaries, SQL semantics, the stable payloads,
  preference parsing, the socket protocol, error codes, plugin composition, the
  panel payload and routes, panel formatting, and the built client bundle's
  registration contract (67 tests).

[0.6.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.6.0
[0.5.1]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.5.1
[0.5.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.5.0
[0.4.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.4.0
[0.3.1]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.3.1
[0.3.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.3.0
[0.2.1]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.2.1
[0.2.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.2.0
[0.1.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.1.0
