# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.5] - 2026-11-27

### Added

- The 0.7.5 scheduled memory lint: schema **v10** rebuilds `automation_runs`
  inside one transaction so its `job` CHECK also accepts `'lint'` — every v9 row
  is copied, the rest of the table shape is unchanged, and no data is rewritten —
  and adds a nullable `briefs.payload_json` for the weekly digest (every v9
  brief keeps its row with a NULL payload). `src/automation/lint.ts` runs the
  read-only `lintMemoryClaims` check once a week as part of the weekly close,
  before the week's brief is written so its digest lands in that brief. Each
  finding becomes at most one review **proposal** per claim per week (kind
  `improvement`, through the existing review fingerprint and suppression,
  bounded by the existing daily cap); the pass never supersedes or forgets a
  claim and writes nothing to `memory_claims`. It records one `automation_runs`
  row with `job: 'lint'` and `day` = the week's Monday, so re-running the same
  week is a no-op, and a week with no findings says "nothing to report" instead
  of an empty digest. The week's brief gains a short "Memory health: …" line in
  its body and in `payload_json.memory_health`. That is the safe default for
  lint findings — proposals plus a digest, never an automatic repair; a
  digest-only weekly pass was considered and not taken.
- The lint adds no route, no command, and no configuration key: it rides the
  0.7.4 scheduler and `automation.enabled`/`automation.weeklyOn`, the panel stays
  at 18 host Fetch routes with the same close-state line, and a default profile
  stays inert (the scheduler mounts only with the analysis stack, so a
  capture-off profile runs neither a close nor the lint).

## [0.7.4] - 2026-11-27

### Added

- The 0.7.4 text-only automation slice: the day and the week now close
  themselves. Schema v9 adds two tables — `automation_runs` (one idempotent row
  per attempted day/week close: period, status, attempts, error, timestamps) and
  `briefs` for the stored weekly brief bodies (the daily standup keeps its
  `daily_standup_entries` home; `kind = 'day'` is reserved). The change is
  additive, so an existing journal migrates forward with no schema
  compatibility break and the existing tables and panel payloads are unchanged.
- `src/briefs/`: the daily brief writes the day's standup into
  `daily_standup_entries` (compatible with the standup skill), and the weekly
  brief rolls seven days into `briefs`.
- `src/automation/`: the scheduler closes the Dayflow day at
  `automation.dailyAt` (04:00) and the Monday-anchored week at
  `automation.weeklyOn`, through the analysis consent gate and with no image;
  the new `automation.catchUpDays` (1–30, default 2) bounds how many missed days
  the next start (or sleep wake) catches up, anything older is recorded
  `skipped` instead of replayed, a failed close retries up to the two-attempt
  cap, and `automation_runs` keeps re-running the same day a no-op. The post-close
  insights pass writes one day reflection, at most three review proposals
  (distillation/loop/improvement, confidence ≥ 0.6), memory claims only as a
  kept promotion (never silently active), and the matching long-task sessions
  through `scanTaskHistory` + `attachTaskSession` (a low-confidence match becomes
  a review item); the weekly close writes exactly one stored week brief
  (`briefs`, `kind = 'week'`) — the compressed week record — and adds no weekly
  reflection and no weekly review pass (a weekly reflection is not scheduled on
  the 0.7.x line; the stored week brief is the record). The scheduled weekly
  memory lint and its digest landed later, in 0.7.5, and are described in the
  section above.
- `/dayflow-run-close`: one manual close through the same idempotent store, for
  testing and catch-up.
- `GET /api/dayflow/automation/status` and the panel's **close-state line**: the
  Journal insights view gains a compact line under the analysis line — `Day
  closes 04:00`, the last stored day close and its status, `Week close Mon`,
  and the catch-up window — with a green dot for an enabled schedule (or a close
  running now), amber when the last day close failed, and grey when automation is
  off. The route answers `{automation: {enabled, running, dailyAt, weeklyOn,
  catchUpDays, lastDayClose?, lastWeekClose?, nextDayCloseAt?}}`, derives the
  schedule from the profile when the composition does not inject the scheduler,
  and never creates the journal; the panel is now 18 host Fetch routes (9 `GET`,
  9 `POST`). The line has no button, no new view, and no new header entry, and
  its copy is in both languages.
- The automation pass is a native-capture feature in 0.7.4 and inert on a
  default profile: the scheduler mounts only with the analysis stack
  (`capture.enabled` and `analysis.enabled` plus the host model service), so a
  capture-off profile runs no close; once mounted, `analysis.consent: 'none'`,
  an empty `analysis.provider`, or an empty `analysis.model` records the close
  `skipped` and calls no model.

## [0.7.3] - 2026-11-27

### Added

- The 0.7.3 interactive insights panel: open review items are decided and
  long-task sessions attached or detached in the panel, with no agent turn.
  Three host routes back it — `POST /api/dayflow/review`
  (`{id, decision, note?, forever?, confirm: true}` →
  `{review: {item, task?, memory?}}`), `POST /api/dayflow/tasks/attach`
  (`{id, day, minutes, note?, activity_ids?, confirm: true}` → `{task}`), and
  `POST /api/dayflow/tasks/detach` (`{id, day, confirm: true}` → `{task}`) —
  bringing the panel to 17 host Fetch routes (8 `GET`, 9 `POST`). All three
  require `confirm: true`; an unknown id answers 404, and a malformed body or an
  already-decided item answers 400.
- `src/review-actions.ts`: the decision combination the `journal_review` tool had
  inlined is extracted into `applyReviewDecision`, which decides the item and, in
  the same write, creates the long task for an accepted task proposal or the
  dated memory claim for a kept distillation or loop. The tool and the new
  decide route both call it, so a click and a tool call leave identical state.
- Each waiting review item in the **Journal insights** view now carries a
  decision row: **Keep** for a distillation or loop, **Accept** for an
  improvement or task proposal, plus **Discard** (the negative `discard` or
  `reject` decision for that kind) and **Don't suggest again**. The last asks
  one inline question — **Hide this for good?** with **Confirm** / **Cancel**,
  no browser dialog — and only then stores the hard suppression; a plain
  discard stays soft and may return with materially new evidence. In the task
  row, each linked day sits under **Linked** with its own **Unlink**, which
  detaches the session and leaves the day's activities untouched. Buttons
  disable while a write is in flight, a failed write shows an inline error
  without removing the item, and the loading/error/empty copy is in both
  languages.
- No schema change and no model or LLM dependency: the panel still writes
  through the owned journal's existing write path, and it adds no second view,
  tab, or header button — the single entry point is unchanged. Clearing a hard
  suppression remains an agent-only action in 0.7.x.

## [0.7.2] - 2026-11-27

### Added

- The 0.7.2 analysis runtime, text-only and still inert on a default profile:
  when `capture.enabled` and `analysis.enabled` are both on and the host's model
  service is available, an `AnalysisWorker` runs one tick immediately and then
  every `analysis.intervalMinutes` (1–60, default 5), driving the 0.7.1 pipeline
  through a new host adapter (`src/analyse/host.ts`) over `ctx.llm` — aggregated
  text deltas out, the provider-reported input/output tokens recorded on
  `analysis_jobs`. Ticks never overlap, a failing tick is logged and rescheduled
  instead of crashing the host, and the worker starts and stops with the plugin
  lifecycle. No schema change.
- `GET /api/dayflow/analysis/status` and `src/analyse/status.ts`: the
  enablement and consent decision, the worker state, today's queued / running /
  completed / failed / skipped job counts, the call and token ledger read from
  `analysis_jobs` (not a second counter), the last job time, and the daily
  budgets. A status read never creates the journal.
- The Journal insights panel shows a read-only **analysis line** under the
  capture line: off, waiting for consent, a missing provider or model, paused
  with capture, running, idle, or a stopped worker — with today's failed count,
  the call/token budget (for example `3/120 calls · 12k/200k tokens`), and the
  last job's local time. Once a consent is set it also carries one quiet
  sentence on what leaves the machine (the frontmost app, window title, and
  frame hash — never the image; a `cloud` consent says the metadata leaves the
  Mac). No button and no new view: analysis is enabled in the profile, so the
  panel keeps its single entry point. Both languages carry the new copy, and
  the line falls back to "analysis off" when the route is unavailable.
- `/dayflow-analyze`: one manual analysis tick for the current Dayflow day
  through the same consent gate; a blocked or failed tick returns command text
  rather than throwing into the host.
- Still inert on a default profile: `analysis.consent: 'none'` blocks every
  model call, and a `cloud` or `local` consent needs an explicit
  `analysis.provider` and `analysis.model` — there is no implicit default. A
  window the gate blocks is recorded as a terminal `skipped` job, so enabling
  consent later does not replay it (catch-up is future work), and frames still
  reach the model as app / window-title / hash metadata rather than image bytes.

## [0.7.1] - 2026-11-27

### Added

- The 0.7.1 analysis foundation, verified with fake adapters and **no network
  access**: the owned journal moves to schema v8 with an `analysis_jobs` table,
  and new `src/analyse/` modules turn a day's stored native frames into
  `activities` and `observations`. A pure consent gate runs before any adapter
  call — analysis and capture enabled, capture not paused, `analysis.consent`,
  `analysis.localProviders` for a `local` consent, and an explicitly set
  provider/model — and a blocked window is recorded as a `skipped` job with its
  reason. The pipeline groups frames into windows, sends at most
  `analysis.framesPerWindow` representative frames, validates the model's strict
  JSON object, sessionises adjacent windows, writes idempotently under a
  deterministic window key (`analysis:<job key>`), retries a failed job up to its
  attempts cap, and stops at the per-day call budget. With `capture.keepFramesDays: 0` a
  successfully analysed window's frame files are deleted and their
  `screenshots.file_path` cleared while the row, its key, and its hash stay; the
  engine's retention sweep remains the fallback for frames no job took. There is
  no worker, timer, status route, or real provider call yet (0.7.2), so default
  profiles analyse nothing and no frame leaves the machine.

## [0.7.0] - 2026-11-27

### Added

- Four read tools that close the roadmap Phase 3 read gap, on both the Dayflow
  backend and the owned journal: `dayflow_journal` (the user's own journal entry
  for a day), `dayflow_goals` (the day's focus target and its focus/distraction
  category split), `dayflow_observations` (the per-observation evidence behind
  one activity), and `dayflow_review_ratings` (the user's own focused/distracted
  marks). Observations and ratings are matched to activities by time overlap,
  because Dayflow does not store a card foreign key for those rows.
- The panel's day view now shows the user's own records: the day's focus goal
  with its focus and distraction categories, and the review marks they made on
  the timeline. Both are read only by `GET /api/dayflow/day`; the month and week
  payloads are unchanged, so no extra work happens while browsing the calendar.
- A review queue in the owned journal (schema version 3, `review_items`) with the
  `journal_review` tool and a `review-queue` skill. The agent may propose a
  distillation, loop, improvement, or task proposal with its evidence and
  confidence; keep/accept/discard/reject decisions belong to the user and need
  `confirm: true`. A plain discard or reject is soft and the idea may return once
  the evidence is materially new; `forever: true` hard-suppresses it by
  fingerprint, and `unsuppress` clears that. Confidence below 0.5 is dropped, and
  at most five proposals are kept open per source day.
- Long-task tracking in the owned journal (schema version 4, `long_tasks` and
  `long_task_sessions`) with the `journal_task` tool and a `long-task` skill. A
  task keeps a progress trail of per-day sessions (minutes plus the activity
  records behind them) and reports stalled when an active task has had no new
  session for more than seven days. `suggest` matches a day's activities to
  active tasks by category (+2) and app (+1) overlap, states the reason for each
  match, and never writes; `attach` and `detach` record or correct a session.
  Accepting a `task_proposal` in the review queue now creates the task in the
  same transaction, so a proposal becomes tracked work without a second step.
- A dated memory layer in the owned journal (schema version 5, `memory_claims`)
  with the `journal_memory` tool and a `memory` skill. Claims are history, not
  the present: each carries the day it describes, a change appends a new claim
  and marks the old one superseded (the old row stays for audit), and retrieval
  hides superseded claims unless asked. Kept distillations and loops from the
  review queue become memory automatically; `forget` hard-deletes a claim only
  with `confirm: true`. Search uses FTS5 when the runtime has it and falls back
  to `LIKE` when it does not.
- A budgeted memory context injected as dynamic system context: active long
  tasks and recent, non-superseded memory claims are rendered as dated records
  (never as the present) with a hard 1000-byte cap, a 60-second cache, and
  nothing at all when the journal has nothing worth saying. `memoryContext: false`
  switches it off; an unreadable or missing journal degrades to no injection
  rather than a prompt-assembly error.
- Reflections written back into the owned journal (schema version 6,
  `reflections`) with the `journal_reflection` tool and a `reflection` skill. A
  day or a week can be compressed once into what happened, what repeated, and
  what stalled; the next session reads the stored reflection instead of
  re-deriving it. Saving the same period edits the existing row, a week is
  normalized to its Monday from any day inside it, and deleting one needs
  `confirm: true`.
- A read-only memory lint exposed as `journal_memory` `action: "lint"`: it
  reports contradicting claims on the same subject, older claims overtaken by a
  newer dated claim, claims with no source to trace, and active claims aged past
  180 days. Nothing is repaired automatically; acting on a finding stays a
  supersede/forget decision for the user.
- A **Journal insights** view inside the panel (one of its month/week/insights
  views, not a second tab): it lists active long tasks with progress and stalled
  marks, the open review queue, recent date-stamped memory claims, and stored
  day/week reflections, served by a new `GET /api/dayflow/insights` route over
  the owned journal. The plugin still has exactly one UI entry: one
  conversation-header button and one panel tab. The server never creates or
  migrates a journal just to render the view, and a missing journal renders as
  empty lists instead of an error.
- Human slash commands for quick capture: `/dayflow-task`,
  `/dayflow-remember`, `/dayflow-reflect` write directly to the owned journal
  through the host command registry (hosts without it skip them).
- Inline add rows in the Journal insights view for tasks, memory claims, and
  today's reflection, backed by `POST` routes on the panel API; the review queue
  stays agent-proposed and user-decided.
- After adding a long task from the Insights view, the panel offers to scan the
  last 14 days of activity and link the days whose titles, categories, or apps
  match the task. The scan is a read-only preview; linking writes the task
  sessions (a second link for the same day replaces, not doubles).
- Phase 0 of the native capture port, all off by default and with no analysis
  yet: a `screencapture` capture provider with an optional Swift helper for the
  frontmost app and idle time plus a local smoke script; the `capture`,
  `analysis`, and `automation` configuration blocks (validated, capture
  disabled); schema version 7 with a `capture_state` table; and the panel's
  native capture status — `GET /api/dayflow/capture/status` and
  `POST /api/dayflow/capture/pause`, surfaced as one compact capture line
  (off / on / paused / permission needed, with Pause and Resume) above the
  Journal insights sections. Capture is off by default and no activity can be
  recorded or analysed from it yet.
- Phase 1 of the native capture port: the capture engine. With
  `capture.enabled: true` it starts with the plugin (with or without the panel),
  captures one frame every `capture.intervalSeconds`, and skips paused, locked,
  display-asleep, idle, and `capture.pauseApps` ticks without writing anything.
  Near-identical frames are deduped by a 64-bit dHash distance
  (`capture.dedupeDistance`, with a SHA-256 fallback when the helper is
  unavailable); a stored frame lands under `$DSH_HOME/dayflow/frames/<day>/`
  with one `screenshots` row (`source_id = 'native'`) and `capture_state` resume
  data, capped by `capture.maxFramesPerDay`. A retention sweep runs every
  `capture.retentionCheckMinutes` and keeps at least one day of frames while
  analysis does not exist. Capture stays off by default and nothing is analysed
  yet: no activity cards, no timeline, no briefs, and no insights.
  `npm run native:engine-smoke` drives the real engine against a temporary
  journal and never touches the live one.

### Changed

- The Journal insights view has its own visual language: one tinted accent card
  per source (blue tasks, amber review queue, violet memory, green reflections),
  colored kind badges, dated chips, a small minutes bar per task, inline add rows
  that pick up the section accent, and a gradient introduction card when the
  journal is empty. It follows the harness light and dark themes.

### Fixed

- The importer now maps Dayflow's real `day_goals.focus_target_minutes` column
  into the owned `goals.focus_minutes`; previously an owned journal exposed a
  NULL focus target while Dayflow had the value.
- The system-prompt section now says that `dayflow_journal` and `dayflow_goals`
  return the user's own writing and targets rather than screen content, so the
  model does not treat an on-screen-only timeline as the whole day.
- The npm package no longer ships the build sourcemaps, and a CI check now
  asserts that the tarball contains only shipped files (`lib/`, `skills/`, both
  READMEs, LICENSE), trimming the unpacked package from 3.10 MB to 2.83 MB.
- The panel's insights view keeps the month/week switch in its header, so it is
  no longer a one-way trip: any of the three views can be switched to directly.
- When the journal has nothing to show yet, the insights view explains what it
  will contain instead of showing a single bare line.
- The panel's view switch moved to its own row above the content, so Month,
  Week, and Insights stay visible and clickable at any sidebar width instead of
  the third option being clipped out of the header. A host that does not inject
  the insights reader now shows an explanation instead of a blank pane.

## [0.6.0] - 2026-11-11

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

- The next capability increment is intentionally limited to roadmap Phases 1–2:
  review queues, privacy redaction, long tasks, and memory injection remain
  later minor releases.
- Added the documented `npm run smoke` script and updated the package metadata
  to the `0.6.0` minor line.
- `docs/panel.*.png` and `docs/day.*.png` were re-captured from the same
  fixture, and the separate `docs/week.*.png` stills were dropped in favour of
  `docs/demo.*.png`, so the README's stills and its GIF show one consistent week
  instead of three unrelated ones.

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

### Notes

- Tagged as `v0.6.0`. The npm registry release has not happened yet, so the
  checkout install in both READMEs remains the supported path.

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

[Unreleased]: https://github.com/tailong-wu/dsh-plugin-dayflow/compare/v0.7.5...HEAD
[0.7.5]: https://github.com/tailong-wu/dsh-plugin-dayflow/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/tailong-wu/dsh-plugin-dayflow/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/tailong-wu/dsh-plugin-dayflow/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/tailong-wu/dsh-plugin-dayflow/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/tailong-wu/dsh-plugin-dayflow/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.6.0
[0.5.1]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.5.1
[0.5.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.5.0
[0.4.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.4.0
[0.3.1]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.3.1
[0.3.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.3.0
[0.2.1]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.2.1
[0.2.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.2.0
[0.1.0]: https://github.com/tailong-wu/dsh-plugin-dayflow/releases/tag/v0.1.0
