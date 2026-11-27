# Native capture (Phases 1–3)

[← Back to README](../README.md)

> **Status:** Phases 0–3 are **landed** on the `0.7.x` line. The owned journal is
> at schema **v10**: `capture_state` (v7), `analysis_jobs` (v8), and the v9
> `automation_runs` + `briefs` tables widened by v10 (`job = 'lint'`,
> `briefs.payload_json`). This page covers the capture provider and engine, the
> text-only analysis pipeline and its worker (`0.7.2`), the scheduled day/week
> closes and insights pass (`0.7.4`), and the weekly memory lint (`0.7.5`); the
> panel has three compact status lines (capture, analysis, close state). Capture
> and analysis are still off/inert by default: with `analysis.consent: 'none'`
> (the default) the worker runs no model call, and with no configured
> `analysis.provider`/`model` it records `provider-unset`/`model-unset` skips.
> Image admission (pixels) is **0.8.0 material**; the cutover default flip is
> also 0.8.0 — see [NATIVE_PORT.md](NATIVE_PORT.md) and
> [CUTOVER_REHEARSAL.md](CUTOVER_REHEARSAL.md).

The plugin can record its own screen activity instead of only reading what the
Dayflow app captured. **Phase 1 is the capture engine**: it records frames into
the owned journal. `0.7.1` added the analysis foundation and `0.7.2` makes it
operable: an interval worker calls the pipeline, a status route and a panel line
show what it is doing, and `/dayflow-analyze` runs one manual tick. `0.7.4`
closes the day and week on a scheduler, and `0.7.5` adds the weekly memory lint.
`0.8.0` makes the ledger self-healing: the token budget is enforced after each
call, transiently blocked windows are re-queued, and a 04:00 tail covers the day
just ended. Every model call is text-only: the analysis call sends the frontmost
app, window title, and frame hash, and the closes send activity text; no image is
ever sent on the 0.7.x/0.8.x lines. Everything below is off by default.

- **Capture is off by default.** Setting `capture.enabled: true` starts the
  engine with the plugin. The engine does not depend on the panel, so it runs
  with `panel: false` too. The `capture` block carries the knobs below; the
  `analysis` block configures the worker and pipeline, and the `automation`
  block configures the scheduled closes and the weekly lint (the scheduler
  mounts only with the analysis stack).
- **The engine records on an interval.** Every `capture.intervalSeconds` it
  checks the persisted pause flag, whether the screen is locked or the display
  asleep, the idle gate (`capture.idleSeconds`), and `capture.pauseApps`, then
  captures one frame. A skipped tick (paused, locked, idle, paused app, or the
  day's cap already reached) writes neither a file nor a row.
- **Near-identical frames are deduped.** The provider reports a 64-bit dHash; a
  frame whose Hamming distance to the previously stored frame is within
  `capture.dedupeDistance` is dropped. When a frame carries no hash (the Swift
  helper is unavailable), the engine compares the JPEG's SHA-256 instead, so an
  identical frame is never stored twice.
- **Frames land on disk and in the journal.** Each stored frame goes to
  `$DSH_HOME/dayflow/frames/<day>/<capturedAt>-….jpg` (directory `0700`, file
  `0600`), and one `screenshots` row with `source_id = 'native'` is written to
  the owned journal. `capture_state` records the pause flag, the last frame
  time, and the last retention sweep, so a restarted process resumes without
  duplicating work. `capture.maxFramesPerDay` caps one Dayflow day.
- **Retention is enforced.** Roughly every `capture.retentionCheckMinutes` the
  engine deletes frame files older than the retention window and removes empty
  day directories. With the 0.7.1 analysis pipeline, a successful window deletes
  its frames immediately when `keepFramesDays: 0`; the engine's sweep still
  covers frames no analysis ever took (at least one day is kept).
- **Analysis runs on an interval when it is allowed to.** With capture and
  analysis both enabled, the host `llm` service available, a configured
  provider/model, and a non-`none` consent, the analysis worker ticks every
  `analysis.intervalMinutes`. Every tick still goes through the same pure consent
  gate, so a profile left at the defaults analyses nothing.
- **Analysis is observable.** `GET /api/dayflow/analysis/status` reports the
  consent, worker state, job counts, and today's call/token ledger; the insights
  view shows it as one compact line under the capture line, and
  `/dayflow-analyze` runs one manual tick. The per-day call cap is enforced
  before a call; the daily token budget is enforced after each call from the
  recorded ledger (`0.8.0`), so a crossing call completes and the remaining
  windows of that day are skipped as `budget-tokens` — no call is rolled back and
  no budget skip is ever replayed.
- **The day and week close themselves (0.7.4, lint 0.7.5).** With the analysis
  stack mounted, a host scheduler closes the day at `automation.dailyAt` and the
  Monday-anchored week at `automation.weeklyOn`, writing a standup entry
  (`daily_standup_entries`), the day reflection, review proposals, matched task
  sessions, and one stored week brief (`briefs`, `kind = 'week'`). The weekly
  close also runs the read-only memory lint first and renders its digest into
  that brief; both are proposals-only — automation never writes, supersedes, or
  forgets a memory claim. `/dayflow-run-close` triggers one close by hand and
  the panel's close-state line reports the schedule and the last closes. There is
  no weekly reflection on the 0.7.x line; the stored day/week briefs became
  readable in the panel in 0.8.1. Keys and
  gates are in [CONFIGURATION.md](CONFIGURATION.md); the route is in
  [PANEL.md](PANEL.md).
- **The ledger heals itself (0.8.0).** On a tick whose gate is open, windows a
  previous tick skipped for a transient reason (consent, provider/model, paused,
  capture/analysis disabled) are re-queued once for today and yesterday;
  permanent skips and failures are never replayed. After the day's run, a 04:00
  tail runs the previous Dayflow day once (checkpointed under
  `capture_state.analysis_tail_checked_on`, skipped when the gate is blocked, and
  isolated from the current day's result).
- **Status and pause are wired.** `GET /api/dayflow/capture/status` reports the
  capture and analysis switches, the macOS Screen Recording permission, today's
  native frame count, and the persisted pause flag; `POST
  /api/dayflow/capture/pause` writes that flag into `capture_state`. The Journal
  insights view shows it as one compact capture line —
  off, on, paused, or permission needed — with a Pause/Resume button when
  capture is configured on.
- **Not yet (owner-gated or later in the 0.8.x line):** image admission and
  downscaling (pixels need a host attachment peer and image decisions, so the
  model keeps receiving app / window-title / hash metadata), the `source: owned`
  default flip (Phase 4, owner-gated).
  Native cards live only in the owned backend's timeline, not in the Dayflow
  backend's; the plan is in [NATIVE_PORT.md](NATIVE_PORT.md) and
  [PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md).
- **Nothing is written by a status read.** With no journal, the status route
  answers zeros and does not create the file; only the pause write and the
  engine open it.

The capture block, shown with the Phase 1 additions:

```yaml
    capture:
      enabled: true             # off by default
      intervalSeconds: 45       # 5-600
      idleSeconds: 120          # skip after this much input idle; 0 disables
      maxFramesPerDay: 1200     # hard cap on frames per Dayflow day
      keepFramesDays: 0         # delete a frame after its analysis succeeds; at least one day otherwise
      pauseApps: []             # bundle ids or app-name substrings never captured
      displays: main            # 'main' or 'all'
      dedupeDistance: 4         # dHash Hamming distance treated as a duplicate (0-16)
      retentionCheckMinutes: 60 # how often the retention sweep runs (5-1440)
```

The engine's local smoke script is `scripts/native-engine-smoke.mjs`; run
`npm run native:engine-smoke` (or `node scripts/native-engine-smoke.mjs` after a
build). It creates a temporary journal and frames directory, drives the engine
against the real screen provider a few times, prints each capture outcome, then
removes everything — it never touches `$DSH_HOME/dayflow`. The provider-only
smoke stays available as `npm run native:smoke` (permission, three frames,
dimensions/app/idle; writes nothing). The full plan — consent model, schema,
phases, and acceptance criteria — is in [`NATIVE_PORT.md`](NATIVE_PORT.md).
