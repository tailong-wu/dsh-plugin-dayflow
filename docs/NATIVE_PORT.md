# Native port plan: capture, analyse, and brief inside the harness

**Status:** proposed, owner-selected direction (option C). Phase 0 (the
feasibility spike) and Phase 1 (the capture engine) have landed in the 0.7.0
development line, both behind default-off configuration; everything from the
analysis pipeline onward is not implemented yet.
**Decision:** port Dayflow's own pipeline into `dsh-plugin-dayflow` so the plugin
records the screen, analyses it, builds activity cards, writes daily/weekly
briefs and refreshes the insight journal by itself. After this line the Dayflow
Mac app is optional: the owned journal is the source of truth, and the importer
stays as a one-time migration path.

This document is the plan, not a commitment of dates. Estimates assume one
focused engineer and are wall-clock ranges; the work parallelises across the
phases below.

---

## 1. What exists today and what is missing

Already reusable:

- The owned journal (schema v7) with `days`, `activities`, `observations`,
  `analysis_batches`, `screenshots`, `categories`, `daily_standup_entries`,
  `capture_state`, and the `timeline_cards` compatibility view. Every
  `source_id` column already exists, so native rows can live beside imported
  rows.
- An importer with `sources` bookkeeping (idempotent re-runs).
- Both read backends (`source: dayflow | owned`) and the panel, which already
  renders month/week/day from whichever backend is active.
- The insight journal: long tasks, review queue, dated memory, reflections, the
  budgeted memory context, and the Journal insights panel view.
- Phase 0 capture groundwork: a `screencapture` provider with a lazily compiled
  Swift metadata helper (frontmost app, window title, idle seconds) and a local
  smoke script; the `capture` / `analysis` / `automation` config skeleton with
  capture off by default; `capture_state` plus the `screenshots`-row helper; and
  the panel's capture status line with pause/resume (`GET
  /api/dayflow/capture/status`, `POST /api/dayflow/capture/pause`).
- Phase 1 capture engine: `capture/engine.ts` starts on the plugin lifecycle
  only when `capture.enabled` is true, with an interval timer, idle / screen-lock
  / display-sleep / `pauseApps` gates, dHash dedupe (SHA-256 fallback), a frame
  store under `$DSH_HOME/dayflow/frames/`, `screenshots` rows with
  `source_id = 'native'`, `maxFramesPerDay`, persistent resume state in
  `capture_state`, and a retention sweep.
- The host services this plan needs: `llm` (`ctx.llm.stream`, adapters are
  registered per provider), `attachments` (`saveImage` → `ImageAttachmentRef`),
  `systemPrompt`, `tools`, `skills`, `timer`, `connection`, `agentDefaultModel`.

Missing (the whole port):

- Frame preprocessing (downscale) for analysis; dedupe and retention already run
  in the capture engine.
- An analysis pipeline that turns frames into activity cards through `ctx.llm`.
- Sessionisation, category assignment, and card persistence.
- Daily standup / weekly brief generation written back into the store.
- A scheduler that runs capture analysis and the day/week close jobs inside the
  host process, with catch-up after sleep or restart.
- The consent, budget, and privacy controls that gate the above (the analysis
  settings exist, but no capture or analysis path consumes them yet).

---

## 2. Target architecture

```text
┌──────────────────────────── dsh host process (plugin) ────────────────────────────┐
│                                                                                    │
│  CaptureEngine (timer, every poll interval)                                          │
│    ├─ permission probe ──► status route / panel badge                                │
│    ├─ idle + dedupe gate (dHash, frontmost app)                                      │
│    ├─ frame writer ──► $DSH_HOME/dayflow/frames/<day>/<ts>.jpg  (0600)               │
│    └─ screenshots row ──► owned journal                                             │
│                                                                                    │
│  AnalyseWorker (timer, every N minutes)                                              │
│    ├─ pulls unanalysed frames per day window                                         │
│    ├─ groups frames into windows (app + similarity + gap)                            │
│    ├─ ctx.attachments.saveImage → ImageAttachmentRef                                 │
│    ├─ ctx.llm.stream(prompt, image) → strict JSON card                               │
│    ├─ validates, maps category, sessionises into activities                          │
│    └─ writes activities + observations (source_id 'native')                          │
│                                                                                    │
│  DailyClose (04:00 boundary, catch-up on start)                                      │
│    ├─ ensures the day is fully analysed                                             │
│    ├─ standup/daily brief via ctx.llm.stream(text)                                   │
│    ├─ reflection, review proposals, memory claims, task session matches               │
│    └─ writes daily_standup_entries, reflections, review_items, memory_claims,         │
│            long_task_sessions                                                        │
│                                                                                    │
│  WeeklyClose (Monday 04:00)                                                          │
│    ├─ weekly summary from the seven days                                              │
│    └─ weekly reflection + review items + memory promotion rules                       │
│                                                                                    │
│  Panel (one entry, unchanged)                                                        │
│    └─ reads owned store; shows capture status + pause; insights as today              │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Design rules:

- **The plugin does not shell out to Dayflow.** Dayflow's SQLite is read in
  `source: dayflow` mode only (existing), and the importer remains.
- **Every write is idempotent.** `source_key` is a content hash, `analysis_runs`
  and `automation_runs` carry a `(job, day)` uniqueness constraint, and a
  restarted process resumes rather than duplicating.
- **Nothing user-visible runs without consent.** Capture is off by default; when
  enabled, cloud image analysis needs its own explicit consent setting.
- **The UI keeps one harness entry.** Capture status lives inside the existing
  Journal insights view; no second button, tab, or settings surface.

---

## 3. Modules and files

New host modules (children of `src/`):

| Module | Responsibility |
| --- | --- |
| `capture/engine.ts` | poll loop, idle gate, dedupe, frame write, `screenshots` rows, pause/resume, retention sweep |
| `capture/provider.ts` | `CaptureProvider` interface; `screencapture` CLI provider; optional Swift helper provider (frontmost app, window title, idle seconds); fake provider for tests |
| `capture/permission.ts` | TCC probe (Screen Recording, Accessibility if used), status text for the panel |
| `analyse/llm.ts` | thin wrapper around `ctx.llm.stream` (+ `agentDefaultModel` default, config override, retries, budget accounting) |
| `analyse/prompt.ts` | system prompt, JSON schema, few-shot examples, category list injection |
| `analyse/pipeline.ts` | window grouping, call execution, JSON validation, card sessionisation, activity/observation writes |
| `briefs/daily.ts`, `briefs/weekly.ts` | standup/daily and weekly brief generation from activities |
| `automation/scheduler.ts` | host timers, day-boundary jobs, catch-up, `automation_runs`, failure backoff |
| `automation/insights.ts` | daily reflection + review proposals + memory claims + task session matching |
| `client/` additions | capture status/pause line inside the insights view; localised copy |

Existing modules touched: `journal.ts` (migrations v7+), `config.ts` (new keys),
`index.ts` (mount engine/scheduler), `panel.ts`/`panel-contract.ts` (status and
pause routes, capture payloads), `format.ts`, `panel-insights` view, docs.

New scripts: `scripts/native-smoke.mjs` (real capture smoke test, local only),
`scripts/prompt-eval.mjs` (replay saved frames through a prompt variant).

---

## 4. Data model (migrations v7+)

Reuse the imported-compatible tables. Add only what the native loop needs:

```sql
-- v7: capture state and analysis job bookkeeping
CREATE TABLE IF NOT EXISTS capture_state (
  key TEXT PRIMARY KEY,            -- 'paused', 'last_frame_at', 'last_sweep_at'
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id INTEGER PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,    -- day + window start hash, idempotent
  day TEXT NOT NULL,
  window_start_ts INTEGER NOT NULL,
  window_end_ts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','complete','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- v8: automation bookkeeping, one row per (job, day)
CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL CHECK (job IN ('analyse','daily-close','weekly-close')),
  day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','complete','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (job, day)
);

-- v8: weekly briefs (daily briefs use daily_standup_entries, already present)
CREATE TABLE IF NOT EXISTS briefs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('week')),
  period_key TEXT NOT NULL,       -- Monday day key
  body TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, period_key)
);
```

Native rows keep `source_id = 'native'`, `source_key = <content hash>`, so the
importer and the capture loop cannot collide. `screenshots.file_path` points at
the frame until retention deletes it; `observations.payload_json` keeps the
screenshot id, the frame hash, and the model's evidence for one activity.

---

## 5. Configuration

```yaml
- id: dayflow
  config:
    capture:
      enabled: false             # master switch; permission still has to be granted
      intervalSeconds: 45        # capture cadence while active
      idleSeconds: 120           # skip capture after this much input idleness
      maxFramesPerDay: 1200
      keepFramesDays: 0          # 0 deletes a frame after its analysis completes
      pauseApps: []              # bundle ids / name patterns to skip (e.g. 1Password)
      displays: 'main'           # main | all
    analysis:
      enabled: true              # requires capture.enabled
      consent: 'none'            # 'none' | 'cloud' | 'local' — cloud sends images to the provider
      provider: ''               # empty uses agentDefaultModel.currentSelection()
      model: ''
      windowMinutes: 10         # frames grouped into one analysis window
      framesPerWindow: 3
      maxCallsPerDay: 120
      dailyTokenBudget: 200000
    automation:
      enabled: true
      dailyAt: '04:00'           # day-close jobs run at the Dayflow boundary
      weeklyOn: 'monday'         # weekly close at the same boundary
      catchUpOnStart: true
```

Everything defaults safe: `capture.enabled: false`, `analysis.consent: 'none'`.
The panel shows why capture is not running and what to set.

---

## 6. Privacy, security, and consent

This is the part that has to be right before anything captures pixels.

- **Consent is explicit and layered.** Enabling capture grants local frame
  storage only. Sending images to a cloud model requires `analysis.consent:
  'cloud'`; `'local'` is accepted only when the selected provider is a local
  endpoint, and the plugin refuses a cloud provider under that setting.
- **Pause is one click.** A pause switch in the insights view and a config value
  both write `capture_state.paused`; paused means no capture and no analysis of
  old frames.
- **Skip rules run before capture.** `pauseApps` matches the frontmost app; the
  screen lock and the screensaver skip capture entirely.
- **Frames are ephemeral.** Default `keepFramesDays: 0` deletes the JPEG after a
  successful analysis; database rows keep only the hash and the model output.
  Files live under `$DSH_HOME/dayflow/frames/` with 0700 directories and 0600
  files.
- **Nothing leaves the machine except the analysis call.** No uploads, no
  telemetry, no remote URLs. The LLM request carries downscaled JPEGs only, and
  the config records which provider saw them.
- **The prompt states the frame is data, not instructions**, and the analyser
  rejects output that is not the expected JSON object, so a hostile screen cannot
  steer the pipeline.
- **Redaction limits are documented, not implied.** Skip rules are the only
  reliable protection; pixel-level redaction is out of scope for the first cut,
  and the docs say so plainly (same wording rule as the existing privacy copy).

---

## 7. Cost and performance budget

- Capture cadence 45 s, skip idle > 2 min and duplicate frames (dHash distance
  below a threshold): roughly 300–600 stored frames for an 8-hour day.
- Windows of 10 minutes with 3 representative frames: 40–60 analysis calls for a
  full day. Each call sends 1–3 downscaled images (≤1024 px, JPEG q60) plus the
  prompt; expect ~1.5–4k input tokens per call.
- Default caps: 120 calls/day and 200k tokens/day, enforced per (day) in
  `analysis_jobs`; when a cap is hit the pipeline pauses analysis for the day and
  the panel says why.
- Text-only jobs (daily brief, reflection, review proposals) run once per day and
  once per week; they are cheap and capped by the same token ledger.
- The capture loop is idle-cheap: one `screencapture` per interval, a resize +
  hash, and a write. Frame analysis runs off the capture path in its own timer.

---

## 8. Phases

### Phase 0 — Feasibility spike (2–3 days)

**Status: landed (0.7.0 development line).** The spike's scope below is
complete; capture is still off by default and nothing is analysed yet.

**Scope.** Prove capture and metadata on this Mac from inside a host plugin.

- `capture/provider.ts` with a `screencapture -x -t jpg` provider and a Swift
  helper candidate (`CGWindowListCopyWindowInfo` + `CGEventSource` idle +
  frontmost app) built by `swiftc` when available. Fallback: screen-only frames,
  frontmost app inferred later by the vision model.
- `scripts/native-smoke.mjs`: capture three frames 5 s apart, print permission
  state, frontmost app, dimensions, hash, and byte size.
- Permission status route (`GET /api/dayflow/capture/status`).
- Document which metadata path works without Accessibility permission.

**Landed scope:**

- `src/capture/provider.ts`: the `screencapture` provider with the optional
  Swift helper (permission preflight, frontmost app, window title, idle
  seconds), injectable command runner and clock for tests, and JPEG SOF size
  parsing.
- `scripts/native-smoke.mjs`: the local-only real-capture smoke script (prints
  the permission state and three captured frames; writes nothing).
- `src/capture/state.ts` and schema v7: the `capture_state` key/value table
  (pause, last frame, last sweep) and the idempotent `screenshots`-row helper
  (`source_id = 'native'`, `countScreenshotsForDay`).
- `src/config.ts`: the `capture` (off by default), `analysis` (conservative,
  consent `none`), and `automation` blocks, validated at load time.
- `src/panel.ts` / `src/panel-contract.ts`: `GET
  /api/dayflow/capture/status` (switches, permission, today's native frame
  count, pause flag; a missing journal answers zeros without creating the file)
  and `POST /api/dayflow/capture/pause` (writes `capture_state`). The permission
  probe is injected by the composition, and a broken probe degrades to
  `unknown` instead of failing the route.
- The Journal insights view's compact capture line (off / on / paused /
  permission needed, with Pause/Resume and today's frame count) and its
  EN/ZH copy.

**What Phase 0 did not include:** the capture engine (timer, idle gate, dedupe,
retention sweep, `maxFramesPerDay`, `pauseApps`) — landed as Phase 1 below —
plus the analyse worker and its prompt/JSON pipeline, activity-card persistence,
daily/weekly briefs, and the automation scheduler. `capture_state` started with
only the pause flag the panel writes; Phase 1 made the engine consume it.

**Acceptance.** From the plugin process: permission state reported, three frames
captured with frontmost app for at least one path, no Dayflow app running
required. No screenshots or activities may be written yet; the only journal
write in Phase 0 is the user's pause flag in `capture_state`.

### Phase 1 — Capture engine (about 1 week)

**Status: in progress / landed scope (0.7.0 development line).** Capture runs
only when the profile sets `capture.enabled: true`; nothing is analysed yet.

**Scope.** Continuous capture into the owned store with pause, dedupe, retention,
and status.

- `capture/engine.ts` timer, `capture_state`, `screenshots` rows, frame store.
- dHash duplicate gate, idle gate, `pauseApps`, screen-lock skip.
- Retention sweep and `maxFramesPerDay`.
- `POST /api/dayflow/capture/pause`, `POST /api/dayflow/capture/resume`.
- Insights view gains a compact capture line (idle / recording / paused /
  permission needed) and a pause button.

**Landed scope:**

- `src/capture/provider.ts`: the helper now captures the frame itself and
  returns the JPEG plus a 64-bit dHash; a new `state()` probe reports screen
  lock, display sleep, idle seconds, and the frontmost app. `screencapture`
  stays as the fallback, and a frame captured without the helper simply has no
  hash or lock state.
- `src/capture/engine.ts`: `CaptureEngine` with `start`, `stop`, `status`, and
  `captureOnce()`. Each tick reads the persisted pause flag, the provider's
  state (locked or display asleep → skip), and the day's stored-frame count
  (`maxFramesPerDay` → skip), then captures. An idle frame (`idleSeconds` gate)
  or a `pauseApps` match is skipped without touching disk or the journal. A
  capture failure records an `error` outcome and the timer keeps going; nothing
  escapes the plugin.
- Dedupe: a frame within `capture.dedupeDistance` (Hamming distance of the
  dHash) of the last stored frame is dropped. The last hash and SHA-256 live in
  the engine and in `capture_state`, so a restart resumes dedupe; frames
  without a hash fall back to SHA-256 equality.
- Frame store: `$DSH_HOME/dayflow/frames/<day>/<capturedAt>-….jpg` (directory
  `0700`, file `0600`), one `screenshots` row per stored frame
  (`source_id = 'native'`, idempotent `source_key`), and `capture_state`
  timestamps (`last_frame_at`, `last_sweep_at`) plus the pause flag.
- Retention: a sweep every `capture.retentionCheckMinutes` deletes files older
  than the retention window and removes empty day directories. Because no
  analysis path exists yet, `keepFramesDays: 0` (the default) still keeps at
  least one day of frames.
- `src/index.ts`: the engine is created inside a host `ctx.effect` and started
  when `capture.enabled` is true — independent of the panel — and stopped on
  unload. The panel's permission probe reuses the same lazily created provider,
  so the Swift helper is compiled at most once.
- `src/config.ts`: `capture.dedupeDistance` (0–16, default 4) and
  `capture.retentionCheckMinutes` (5–1440, default 60).
- `scripts/native-engine-smoke.mjs` with `npm run native:engine-smoke`: a
  local-only run against a temporary journal and frames directory; the live
  `$DSH_HOME/dayflow` is never touched.

**Still not implemented:** the analyse worker and its prompt/JSON pipeline,
activity-card persistence, daily/weekly briefs, and the automation scheduler.
The pause/resume route and the insights capture line already landed in Phase 0
and are unchanged.

**Acceptance.** With `capture.enabled: true`, a 30-minute session writes frames
and `screenshots` rows, dedupes near-identical frames, pauses instantly, deletes
frames per retention, and survives a plugin restart without losing state.
Fake provider tests cover all of it; the real-capture smoke runs locally.

### Phase 2 — Analysis pipeline into activity cards (1.5–2 weeks)

**Scope.** Frames become `activities` rows through `ctx.llm.stream`.

- `analyse/llm.ts`: provider/model resolution (config, else
  `agentDefaultModel`), retry with backoff, token accounting, hard budget stop.
- `analyse/prompt.ts`: strict JSON contract — `title`, `summary`, `category`,
  `subcategory`, `apps`, `distractions`, `confidence`; category list injected
  from the owned `categories` table; the untrusted-content rule restated.
- `analyse/pipeline.ts`: window grouping, frame downscale, image admission via
  `ctx.attachments.saveImage`, call execution, JSON validation, sessionisation
  (merge adjacent windows by app/category/gap), `activities` + `observations`
  writes, `analysis_jobs` state machine and idempotent `source_key`.
- Panel day view already reads the owned store; no new UI needed beyond the
  capture line.

**Acceptance.** A scripted replay (30 stored frames + scripted model adapter,
no network) yields deterministic activities and a rendered day view; replaying
the same frames is a no-op; a failing/timed-out call retries, then records a
failure without corrupting the day; budget caps stop analysis and surface the
reason. Real local smoke: 20 minutes of capture → at least one card that matches
what was on screen.

### Phase 3 — Cards, briefs, and insights automation (about 1 week)

**Scope.** The day and week close themselves.

- `briefs/daily.ts`: standup/daily brief from the day's activities, written to
  `daily_standup_entries` (compatible with the existing standup skill).
- `briefs/weekly.ts`: seven-day rollup into `briefs`.
- `automation/scheduler.ts`: host timers, 04:00 boundary handling, catch-up on
  start and after sleep, `automation_runs` idempotency, bounded retries, status
  in the panel.
- `automation/insights.ts`: after the day closes — one day reflection, at most
  three review proposals (distillation/loop/improvement, confidence ≥ 0.6),
  memory claims only when evidence is durable, and task session matching using
  the existing `scanTaskHistory` logic followed by `attachTaskSession` (or a
  review item when confidence is low).
- Weekly close: weekly reflection, weekly review pass, memory lint summary.
- `/dayflow-run-close` slash command (manual trigger for testing/catch-up).

**Acceptance.** Closing a synthetic day with a scripted model produces one
standup entry, one reflection, ≤3 review items, and attaches matching task days;
re-running the same day is a no-op. A skipped day catches up on next start.

### Phase 4 — Cutover and release (about 1 week)

**Scope.** Dayflow becomes optional, the native path is the default for new
installs.

- `source: owned` becomes the default when capture is enabled and no Dayflow
  database exists; the panel and tools already read the owned store.
- First-run flow: permission walkthrough, consent choices (local/cloud/none),
  capture switch, pause.
- Docs: README (architecture, privacy, limits), README.zh, CHANGELOG, ROADMAP
  status; a "native vs imported" section; the importer documented as migration.
- CI: fake-provider tests on the existing macOS runner; real capture only in
  `scripts/native-smoke.mjs` locally.
- Release: fold into the unreleased development line if this lands soon,
  otherwise `0.8.0` as the native-preview line and `1.0.0` once capture has run on
  a real week without data loss.

**Acceptance.** On a fresh profile with Dayflow closed: install → grant
permission → capture runs → a day appears in the panel → next morning the standup,
reflection, and review queue are populated without a single agent turn.

---

## 9. Testing and CI strategy

- **Unit:** hash/dedupe, idle gate, window grouping, sessioniser, JSON validation,
  retry/budget logic, retention, idempotency keys. All run on Linux/macOS CI.
- **Integration (fake adapters):** a `FakeCaptureProvider` writes deterministic
  frames; a scripted `llm` adapter returns canned JSON. This gives an end-to-end
  pipeline test without screen permission or network, and it is what CI runs.
- **Panel tests:** capture status payload, pause/resume route, day view reading a
  natively-populated owned journal.
- **Local smoke (not in CI):** `npm run native:smoke` captures from the real
  screen, prints permission state, and asserts one analysis call succeeds.
- **Prompt regression:** `scripts/prompt-eval.mjs` replays a frozen frame set
  against a prompt variant and diffs the cards, so prompt edits are reviewable.
- **CI constraint:** GitHub's macOS runners cannot grant Screen Recording, so the
  real provider is skipped there; the capture abstraction is the test seam.

---

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| macOS permission denied or revoked | status route + panel copy with the exact System Settings path; capture simply does not start; everything else keeps working |
| Screenshots contain secrets | default ephemeral frames, pause rules, cloud consent separate, documented redaction limits, no uploads other than the analysis call |
| Cloud model sees sensitive screens | `consent: 'local'` refuses cloud providers; default is `'none'` |
| LLM cost runs away | per-day call and token caps, dedupe before analysis, 10-minute windows, day pause when capped, visible in status |
| Wrong attribution in tasks | sessions come from analysis plus explicit scan rules; review items are never accepted for the user; every write is inspectable and detachable |
| Laptop sleep / app quit leaves gaps | capture loop resumes, analysis catch-up runs on start, missing windows are marked `skipped` not fabricated |
| Duplicate or overlapping cards | content-hash `source_key`, window job keys, sessioniser merges by app/category/gap, replay is a no-op |
| Schema drift with the importer | native rows use `source_id 'native'`; migrations v7+ are forward-only; importer tests keep passing |
| Prompt injection from screen content | JSON-only contract, rejection of non-object output, untrusted-content rule in both prompt and tool descriptions |
| Privacy copy overpromises | the limitations live in the settings copy in both languages, checked in review (existing rule) |

---

## 11. Decisions needed from the owner before Phase 0 starts

1. **Screen Recording consent** for the DeepSeek Harness app (done once in macOS
   System Settings; the plugin only detects it).
2. **Analysis destination:** `cloud` (frames go to the configured vision model),
   `local` (only a local endpoint), or `none` (capture only, no analysis). Default
   is `none`.
3. **Which provider/model** the pipeline should use by default, if not the
   current agent model.
4. **Retention:** delete frames after analysis (default), or keep 1–7 days for
   debugging.
5. **Budget cap** per day (suggested: 120 analysis calls / 200k tokens).
6. **Weekly close timing** (suggested: Monday 04:00, same boundary as days).

---

## 12. First slice once approved

Phase 0 landed as a self-contained PR: capture provider + permission/status route
+ smoke script + docs, with `capture.enabled` still `false` by default. It proved
the only unknown (can the host process capture the screen and read the frontmost
app?) without touching the analysis pipeline. Phase 1 then added the capture
engine behind the same default-off switch, writing frames and `screenshots`
rows but still no analysis. Phases 2–3 parallelise across analysis and
briefs/automation with fake adapters in CI; Phase 4 is the cutover.

Estimated wall clock: **6–7 weeks** single-threaded, **3–4 weeks** with three
parallel workstreams, plus one real week of dogfooding before `1.0.0`.
