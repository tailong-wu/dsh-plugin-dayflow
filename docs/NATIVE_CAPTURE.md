# Native capture (Phase 1)

[← Back to README](../README.md)

> **Status:** Phase 0 and Phase 1 are **landed**, and the analysis foundation
> (Phase 2 groundwork) landed in `0.7.1` on the `0.7.x` line: the owned journal is
> at schema version 8 with `capture_state` and `analysis_jobs`, plus the capture
> provider, the capture engine, the analysis pipeline behind its consent gate,
> and the capture status/pause routes with their panel line. Capture is still off
> by default and **no worker runs the analyzer yet** — real model calls are the
> `0.7.2` step. The rest of Phase 2–4 (worker/status, cards and briefs, cutover)
> is planned in [NATIVE_PORT.md](NATIVE_PORT.md).

The plugin can record its own screen activity instead of only reading what the
Dayflow app captured. **Phase 1 is the capture engine**: it records frames into
the owned journal. `0.7.1` adds the analysis foundation (window grouping, the
consent gate, strict JSON validation, and the `activities`/`observations`
writes), which is test-triggered only — no worker or timer calls it yet.
Everything below is off by default.

- **Capture is off by default.** Setting `capture.enabled: true` starts the
  engine with the plugin. The engine does not depend on the panel, so it runs
  with `panel: false` too. The `capture` block carries the knobs below; the
  `analysis` block now configures the 0.7.1 pipeline (still no worker), and the
  `automation` block is validated but unused.
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
- **Status and pause are wired.** `GET /api/dayflow/capture/status` reports the
  capture and analysis switches, the macOS Screen Recording permission, today's
  native frame count, and the persisted pause flag; `POST
  /api/dayflow/capture/pause` writes that flag into `capture_state` (schema
  version 8). The Journal insights view shows it as one compact capture line —
  off, on, paused, or permission needed — with a Pause/Resume button when
  capture is configured on.
- **What does not happen yet:** no worker, timer, status route, or panel
  progress for analysis; no activity cards in the timeline from native frames;
  no briefs and no automation. The 0.7.1 pipeline exists and is tested with a
  fake model adapter, but nothing calls it on a schedule and no real provider is
  contacted until 0.7.2.
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
