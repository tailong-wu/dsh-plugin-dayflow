# Native port plan: capture, analyse, and brief inside the harness

**Status:** proposed, owner-selected direction (option C). Phase 0 (the
feasibility spike) and Phase 1 (the capture engine) landed in the 0.7.0
development line, Phase 2's foundation (analysis modules, schema v8, consent
gate, fake-adapter pipeline) landed in 0.7.1, and Phase 2's runtime (the worker,
the host-LLM adapter, the status route, and the panel analysis line) landed in
0.7.2; all of it stays behind default-off configuration. Phase 3's **text-only
automation slice landed in 0.7.4**: schema v9 (`automation_runs` and `briefs`),
the daily and weekly close, the insights pass, the host scheduler with
`catchUpDays`, `/dayflow-run-close`, and the panel's close-state line and status
route; **0.7.5 adds the scheduled weekly memory lint** — schema v10 (a `'lint'`
job value for `automation_runs`), `automation/lint.ts`, and a memory-health
digest in the weekly brief. **0.8.0 lands the analysis-ledger follow-ups**:
the token budget becomes a post-call gate, configuration-caused skips replay
within today and yesterday, and the 04:00 boundary gets a one-shot day tail —
with no schema, route, command, tool, skill, or configuration-key change and no
change to a cap value; a default profile still makes no call. **0.8.1 lands the
briefs reading view**: the insights payload gains an additive `briefs` list and
the existing Journal insights view gains a read-only, expandable **Briefs**
block — with no new route (the panel stays at 18 host Fetch routes), tab,
button, configuration key, schema change, host peer, or model call. The line is
closed at **0.8.4**, the release close: documentation, test, and release-trail
reconciliation only — no plugin source, schema, route, command, tool, skill,
configuration key, default, or dependency change, and nothing on the npm
registry. **The whole shipped line is text-only**: a window travels as app /
window-title / frame-hash metadata, never as pixels. Image admission — pixels
plus the `@deepseek-ai/dsh-attachment` host service — was planned as 0.8.2, and
the Phase 4 `source: owned` default flip as 0.8.3; both are **formally deferred
to the next line**, owner-gated (image admission on D1/D2/D11, the flip on D10
with 1.0.0 after a real week of capture without data loss). 0.7.6 only
rehearsed the cutover checklist (`docs/CUTOVER_REHEARSAL.md`), and no 0.8.x
release flips it. The 0.9.x line stays text-only too: **0.9.1 lands the
close-history surface** — the insights payload gains an additive `closes` list
and the existing Journal insights view gains a read-only **Close history**
block — with no new route (the panel stays at 18 host Fetch routes), tab,
button, configuration key, schema change, host peer, or model call.
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

- The owned journal (schema v7 in 0.7.0; v8 adds `analysis_jobs` in 0.7.1) with
  `days`, `activities`, `observations`, `analysis_batches`, `screenshots`,
  `categories`, `daily_standup_entries`, `capture_state`, and the
  `timeline_cards` compatibility view. Every `source_id` column already exists,
  so native rows can live beside imported rows.
- An importer with `sources` bookkeeping (idempotent re-runs).
- Both read backends (`source: dayflow | owned`) and the panel, which already
  renders month/week/day from whichever backend is active.
- The insight journal: long tasks, review queue, dated memory, reflections, the
  budgeted memory context, and the Journal insights panel view.
- The close-history surface (0.9.1): the Journal insights view reads the most
  recent closes the automation recorded from `automation_runs` in a read-only
  **Close history** block, inside the existing insights payload.
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
- Phase 2 analysis: the 0.7.1 foundation (window grouping, consent gate, strict
  JSON prompt, idempotent `activities`/`observations` writes) and the 0.7.2
  runtime (host-LLM adapter, injectable-timer worker, `GET
  /api/dayflow/analysis/status`, the panel's read-only analysis line, and
  `/dayflow-analyze`). Still text-only: a window travels as app / window-title /
  hash metadata, not image bytes.
- The host services this plan needs: `llm` (`ctx.llm.stream`, adapters are
  registered per provider), `attachments` (`saveImage` → `ImageAttachmentRef`),
  `systemPrompt`, `tools`, `skills`, `timer`, `connection`, `agentDefaultModel`.

Missing (the rest of the port):

- Image preprocessing (downscale) and image admission for analysis; dedupe and
  retention already run in the capture engine, and the shipped line sends app /
  window title / hash metadata rather than pixels.
- The owned store as the default source for a fresh install (deferred to the
  next line, owner-gated D10), and the first-run walkthrough (Phase 4).

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
│    ├─ post-call token gate: ledger ≥ dailyTokenBudget → skip budget-tokens           │
│    ├─ writes activities + observations (source_id "native")                          │
│    └─ 04:00 day tail: one bounded run for yesterday (checked once a day)             │
│                                                                                    │
│  DailyClose (04:00 boundary, catch-up on start)                                      │
│    ├─ ensures the day is fully analysed                                             │
│    ├─ standup/daily brief via ctx.llm.stream(text)                                   │
│    ├─ reflection, review proposals, memory claims, task session matches               │
│    └─ writes daily_standup_entries, reflections, review_items, memory_claims,         │
│            long_task_sessions                                                        │
│                                                                                    │
│  WeeklyClose (Monday 04:00)                                                          │
│    ├─ weekly brief from the seven days → one briefs row (kind 'week')                 │
│    └─ weekly memory lint (0.7.5): review proposals + "Memory health" digest;          │
│            a stored week brief is the compressed week record — no weekly reflection   │
│                                                                                    │
│  Panel (one entry, unchanged)                                                        │
│    └─ reads owned store; shows capture status + pause; insights as today              │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Design rules:

- **The plugin does not shell out to Dayflow.** Dayflow's SQLite is read in
  `source: dayflow` mode only (existing), and the importer remains.
- **Every write is idempotent.** `source_key` is a content hash, `analysis_jobs`
  carries a unique `job_key`, `automation_runs` carries a unique `(job, day)`,
  and `briefs` a unique `(kind, period_key)`, so a restarted process resumes
  rather than duplicating.
- **Nothing user-visible runs without consent.** Capture is off by default; when
  enabled, cloud image analysis needs its own explicit consent setting.
- **The UI keeps one harness entry.** Capture status lives inside the existing
  Journal insights view; no second button, tab, or settings surface.
- **Text only on the shipped line; pixels are owner-gated.** The image steps in
  the diagram (`saveImage`, an image argument to `ctx.llm.stream`) describe the
  target if image admission is approved. 0.8.0 through 0.8.4 remain text-only:
  the plugin sends app / window-title / frame-hash metadata, so the host
  `attachments` service is still not a peer of the shipped line and image
  admission is deferred to the next line (owner-gated D1/D2/D11).

---

## 3. Modules and files

New host modules (children of `src/`):

| Module | Responsibility |
| --- | --- |
| `capture/engine.ts` | poll loop, idle gate, dedupe, frame write, `screenshots` rows, pause/resume, retention sweep |
| `capture/provider.ts` | `CaptureProvider` interface; `screencapture` CLI provider; optional Swift helper provider (frontmost app, window title, idle seconds); fake provider for tests |
| `capture/permission.ts` | TCC probe (Screen Recording, Accessibility if used), status text for the panel |
| `analyse/jobs.ts` | `analysis_jobs` state machine: idempotent `job_key`, attempts cap, skipped reasons, per-day call/token totals (the single ledger sum the status route and the token gate read) |
| `analyse/skips.ts` | the pure replay policy (`TRANSIENT_SKIP_REASONS`, `isTransientSkipReason(reason)` — configuration-caused skips only, forward-compatible default `false`) plus `replaySkippedAnalysisWindows`, the bounded today/yesterday requeue pass (one day back by default) |
| `analyse/consent.ts` | the pure decision checked **before** any provider call: enabled/capture/paused/consent/provider-model/local-provider gate |
| `analyse/llm.ts` | thin wrapper around `ctx.llm.stream` (+ `agentDefaultModel` default, config override, retries, budget accounting) |
| `analyse/prompt.ts` | system prompt, JSON schema, few-shot examples, category list injection |
| `analyse/pipeline.ts` | window grouping, call execution, JSON validation, card sessionisation, pre-call and post-call budget gates, activity/observation writes |
| `briefs/daily.ts`, `briefs/weekly.ts` | standup/daily and weekly brief generation from activities |
| `briefs/read.ts` | `listPanelBriefs`: the panel's read-only briefs list — stored `briefs` rows plus native standups, de-duplicated per (kind, period), newest first, capped, tolerant of a missing journal or a bad payload, no model call |
| `automation/store.ts` | the `automation_runs` ledger and the `briefs` store; no model, no scheduler |
| `automation/consent.ts` | the pure text-analysis gate: enabled/consent/provider/model before any call |
| `automation/scheduler.ts` | host timers, day-boundary jobs, catch-up, `automation_runs`, failure backoff |
| `automation/insights.ts` | daily reflection + review proposals + kept-claim promotion + task session matching |
| `automation/lint.ts` | the weekly memory-lint pass: read-only `lintMemoryClaims`, findings as review proposals only, idempotent `job: 'lint'` run, digest in the weekly brief |
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
-- v7: capture state (shipped in 0.7.0)
CREATE TABLE IF NOT EXISTS capture_state (
  key TEXT PRIMARY KEY,            -- 'paused', 'last_frame_at', 'last_sweep_at'
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- v8: analysis job bookkeeping (0.7.1)
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id INTEGER PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,    -- `<day>:<window start ts>`, idempotent
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
CREATE INDEX IF NOT EXISTS analysis_jobs_day_idx ON analysis_jobs (day, window_start_ts);
CREATE INDEX IF NOT EXISTS analysis_jobs_status_idx ON analysis_jobs (status);

-- v9: automation bookkeeping, one row per (job, day) (0.7.4)
CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL CHECK (job IN ('day_close','week_close')),
  day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','complete','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job, day)
);
CREATE INDEX IF NOT EXISTS automation_runs_day_idx ON automation_runs (day);

-- v9: the brief store; 0.7.4 writes only kind = 'week' because the daily
-- standup keeps its existing daily_standup_entries home (kind = 'day' reserved).
CREATE TABLE IF NOT EXISTS briefs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('day','week')),
  period_key TEXT NOT NULL,       -- Monday day key for a weekly brief
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  model TEXT,
  source_id TEXT NOT NULL DEFAULT 'native',
  source_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, period_key)
);
```

The 0.7.5 scheduled memory lint needs a third `job` value, and SQLite cannot
alter a CHECK in place, so **v10 rebuilds `automation_runs`** and gives `briefs`
the JSON payload column the digest needs:

```sql
-- v10: rebuild automation_runs so the job CHECK also accepts the weekly lint
-- (0.7.5). One transaction: create the replacement table, copy every v9 row,
-- drop the old one, rename, recreate the day index. No row is rewritten or
-- dropped, and the widened CHECK is the only change to this table.
CREATE TABLE automation_runs_v10 (              -- same shape as v9, one change:
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL CHECK (job IN ('day_close','week_close','lint')),
  day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','complete','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job, day)
);
INSERT INTO automation_runs_v10 (id, job, day, status, attempts, error, payload_json, created_at, updated_at)
  SELECT id, job, day, status, attempts, error, payload_json, created_at, updated_at
    FROM automation_runs;
DROP TABLE automation_runs;
ALTER TABLE automation_runs_v10 RENAME TO automation_runs;
CREATE INDEX IF NOT EXISTS automation_runs_day_idx ON automation_runs (day);

-- v10: the weekly brief's structured digest (`memory_health`). Nullable, so
-- every v9 brief keeps its row with a NULL payload.
ALTER TABLE briefs ADD COLUMN payload_json TEXT;
```

Migration order on the 0.7.x line: **v8** adds `analysis_jobs` (0.7.1),
**v9** adds `automation_runs` and `briefs` (0.7.4), and **v10** rebuilds
`automation_runs` so its `job` CHECK also accepts `'lint'` for the scheduled
memory-lint job and adds the nullable `briefs.payload_json` column (0.7.5) — a
rebuild inside one transaction, every v9 row copied, not a new table.
Migrations are forward-only, one version per patch. The shapes above are the
shipped ones: `src/journal.ts` is the source of truth, with the same columns,
indexes, `CHECK` constraints, and `UNIQUE` keys (`analysis_jobs.job_key`,
`automation_runs (job, day)`, `briefs (kind, period_key)`); the
`briefs.payload_json` `ALTER` runs under a `tableHasColumn` guard inside the
same v10 transaction.

Native screenshot rows keep `source_id = 'native'` and a content-derived
`source_key` (frame hash plus capture second), so the importer and the capture
loop cannot collide; native activities use the deterministic
`analysis:<job key>` key instead. `screenshots.file_path` points at the frame
until retention or a successful analysis deletes it; `observations.payload_json`
keeps the screenshot id, the frame hash, and the model's evidence for one
activity.

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
      intervalMinutes: 5         # worker tick, 1-60 (0.7.2)
      consent: 'none'            # 'none' | 'cloud' | 'local'; the shipped line sends text metadata, not images
      localProviders: []         # provider ids accepted as local under consent 'local'
      provider: ''               # empty blocks analysis as "needs provider"; no implicit agent default
      model: ''
      windowMinutes: 10         # frames grouped into one analysis window
      framesPerWindow: 3
      maxCallsPerDay: 120
      dailyTokenBudget: 200000
    automation:
      enabled: true
      dailyAt: '04:00'           # day-close jobs run at the Dayflow boundary
      weeklyOn: 'monday'         # weekly close at the same boundary; the weekly memory lint runs as part of it
      catchUpOnStart: true
      catchUpDays: 2             # bounded catch-up window, 1-30 (0.7.4)
```

Everything defaults safe: `capture.enabled: false`, `analysis.consent: 'none'`.
The scheduler mounts only with the analysis stack, so a capture-off profile
runs no close and no lint. The panel shows why capture is not running and what
to set; the full key list and defaults are in
[CONFIGURATION.md](CONFIGURATION.md).

---

## 6. Privacy, security, and consent

This is the part that has to be right before anything captures pixels.

- **Consent is explicit and layered.** Enabling capture grants local frame
  storage only. Sending images to a cloud model requires `analysis.consent:
  'cloud'`; `'local'` is accepted only when the selected provider is listed in
  `analysis.localProviders` (a case-insensitive exact match), and the plugin
  refuses any other provider under that setting. The pure gate in
  `src/analyse/consent.ts` runs before every call, and a blocked window is
  recorded as a `skipped` job with its reason.
- **Pause is one click.** A pause switch in the insights view and a config value
  both write `capture_state.paused`; paused means no capture and no analysis of
  old frames.
- **Skip rules run before capture.** `pauseApps` matches the frontmost app; the
  screen lock and the screensaver skip capture entirely.
- **Frames are ephemeral.** Default `keepFramesDays: 0` deletes the JPEG after a
  successful analysis; database rows keep only the hash and the model output.
  Files live under `$DSH_HOME/dayflow/frames/` with 0700 directories and 0600
  files.
- **Nothing leaves the machine except the model call the user configured.** No
  uploads, no telemetry, no remote URLs. On the shipped line an analysis request
  carries the frontmost app, window title, and frame hash as text — never
  pixels — and the 0.7.4–0.8.4 close passes carry activity text only. Image
  admission is deferred to the next line (owner-gated D1/D2/D11); if it lands,
  the request would carry downscaled JPEGs. The config records which provider
  saw the text, and only a `cloud` consent lets it leave the Mac.
- **The prompt states that screen content is data, not instructions**, and the
  analyser rejects output that is not the expected JSON object, so a hostile
  screen cannot steer the pipeline.
- **Redaction limits are documented, not implied.** Skip rules are the only
  reliable protection; pixel-level redaction is out of scope for the first cut,
  and the docs say so plainly (same wording rule as the existing privacy copy).

---

## 7. Cost and performance budget

- Capture cadence 45 s, skip idle > 2 min and duplicate frames (dHash distance
  below a threshold): roughly 300–600 stored frames for an 8-hour day.
- Windows of 10 minutes with 3 representative frames: 40–60 analysis calls for a
  full day. On the shipped line each call sends the metadata of up to
  `analysis.framesPerWindow` representative frames (app, window title, frame
  hash) plus the prompt; image admission — downscaled JPEGs at ≤1024 px, about
  1.5–4k input tokens per call — is deferred to the next line (owner-gated
  D1/D2/D11) and would raise this estimate.
- The 0.8.0 day tail adds at most one extra bounded run per day boundary: it
  re-reads yesterday's stored frames, spends only yesterday's remaining budgets,
  and skips already-complete windows by job key.
- Default caps: 120 calls/day and 200k tokens/day, read from `analysis_jobs`;
  0.8.0 makes both real gates and keeps them in this order. The call cap is
  **pre-call**: when the day has started `analysis.maxCallsPerDay` calls, the
  run's remaining windows are skipped with reason `budget` (`outcome: 'budget'`,
  `budgetKind: 'calls'`). The token cap reads the ledger **twice**: before a
  window starts (a run that begins with the day already at the cap starts no
  call) and right after each completion (which is what discovers the crossing).
  A post-completion day total at or above `analysis.dailyTokenBudget` skips the
  run's remaining windows with reason `budget-tokens` (`outcome: 'budget'`,
  `budgetKind: 'tokens'`). At most the one call that crosses the budget is paid;
  no paid call is rolled back or recomputed, no budget skip is ever replayed, and
  a later run for the same day refuses new windows before starting. That is the
  money contract: spend nothing more after the cap is crossed, and let the status
  line say so.
- Text-only close jobs run only when the scheduler is mounted: up to two calls
  per closed day (the standup brief and the insights pass) and one per closed
  week (the weekly brief). They are not part of the `analysis_jobs` call/token
  ledger, which counts frame-analysis windows only; the weekly memory lint
  calls no model at all, so its only cost is the proposals it files.
- The capture loop is idle-cheap: one `screencapture` per interval, a resize +
  hash, and a write. Frame analysis runs off the capture path in its own timer.

---

## 8. Phases

### Phase 0 — Feasibility spike (2–3 days)

**Status: landed (0.7.0).** The spike's scope below is
complete; capture shipped off by default and analysed nothing (the Phase 2
foundation landed later, in 0.7.1).

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

**Status: landed scope (0.7.0); Phase 2 shipped on the 0.7.x line (0.7.1–0.7.2),
and its ledger follow-ups landed in 0.8.0.** Capture runs only when the profile
sets `capture.enabled: true`; the engine itself analyses nothing — the Phase 2
foundation (0.7.1) reads the rows it writes.

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
  than the retention window and removes empty day directories. The engine's
  sweep is the fallback for frames no analysis window took; a window analysed
  successfully deletes its own frames when `keepFramesDays: 0` (see Phase 2).
- `src/index.ts`: the engine is created inside a host `ctx.effect` and started
  when `capture.enabled` is true — independent of the panel — and stopped on
  unload. The panel's permission probe reuses the same lazily created provider,
  so the Swift helper is compiled at most once.
- `src/config.ts`: `capture.dedupeDistance` (0–16, default 4) and
  `capture.retentionCheckMinutes` (5–1440, default 60).
- `scripts/native-engine-smoke.mjs` with `npm run native:engine-smoke`: a
  local-only run against a temporary journal and frames directory; the live
  `$DSH_HOME/dayflow` is never touched.

**Still not implemented when Phase 1 shipped:** the analyse worker and its
prompt/JSON pipeline, activity-card persistence, daily/weekly briefs, and the
automation scheduler. The pipeline landed in 0.7.1 and the worker, status route,
and panel analysis line in 0.7.2; the briefs, scheduler, and insights close
landed in 0.7.4 (Phase 3). The pause/resume route and the insights capture line
already landed in Phase 0 and are unchanged.

**Acceptance.** With `capture.enabled: true`, a 30-minute session writes frames
and `screenshots` rows, dedupes near-identical frames, pauses instantly, deletes
frames per retention, and survives a plugin restart without losing state.
Fake provider tests cover all of it; the real-capture smoke runs locally.

### Phase 2 — Analysis pipeline into activity cards (1.5–2 weeks)

**Status: the text-only slice is complete (0.7.2), and its ledger follow-ups
landed in 0.8.0.** The 0.7.1 foundation turns stored frames into `activities`
rows under the consent gate, and 0.7.2 runs it on its own: the worker ticks on
`analysis.intervalMinutes`, the host's `llm` service backs the calls, the status
route and the panel analysis line report the ledger, and `/dayflow-analyze`
triggers one tick. 0.8.0 turns the reported token budget into a post-call gate,
replays configuration-caused skips within today and yesterday, and adds the
04:00 day tail. A default profile still analyses nothing —
`analysis.consent: 'none'` blocks every call — and images are still metadata
(app, window title, hash), not pixels, on the whole shipped line; image
admission is deferred to the next line (owner-gated D1/D2/D11).

**Scope.** Frames become `activities` rows through `ctx.llm.stream`.

- `analyse/llm.ts`: provider/model resolved from the analysis config (there is
  no implicit agent default), retry with backoff, token accounting, hard budget
  stop.
- `analyse/prompt.ts`: strict JSON contract — `title`, `summary`, `category`,
  `subcategory`, `apps`, `distractions`, `confidence`; category list injected
  from the owned `categories` table; the untrusted-content rule restated.
- `analyse/pipeline.ts`: window grouping, frame downscale, image admission via
  `ctx.attachments.saveImage`, call execution, JSON validation, sessionisation
  (merge adjacent windows by app/category/gap), `activities` + `observations`
  writes, `analysis_jobs` state machine and idempotent `source_key`.
- Panel day view already reads the owned store; the only new UI is the 0.7.2
  read-only analysis line under the capture line.

**Landed scope (0.7.1):**

- `src/analyse/jobs.ts` and schema **v8** `analysis_jobs`: idempotent `job_key`,
  `queued` → `running` → `complete` / `failed` / `skipped`, an attempts cap,
  failure reasons, per-day call and token totals, and budget exhaustion checks.
- `src/analyse/consent.ts`: one pure decision checked before any adapter call —
  analysis disabled, capture disabled, paused, `consent: 'none'`, a `local`
  consent whose provider is not in `analysis.localProviders`, and an unset
  provider/model each return a typed blocked reason, and a blocked window is
  recorded as a `skipped` job.
- `src/analyse/prompt.ts`: the strict JSON contract, the category list injection,
  and the "screen content is data, not instructions" rule, with a hostile
  window-title fixture used by a test.
- `src/analyse/llm.ts`: a thin wrapper over a caller-supplied stream with bounded
  retries, a call timeout, token accounting, and `createFakeLlmAdapter` as the
  test seam (the production adapter is wired in 0.7.2).
- `src/analyse/pipeline.ts`: pure window grouping
  (`analysis.windowMinutes`/`framesPerWindow`), output validation, sessionisation,
  idempotent `activities` + `observations` writes (`source_id = 'native'`,
  deterministic `analysis:<job key>` window keys) and
  the `keepFramesDays: 0` handoff: after a successful window the frame files are
  deleted and `screenshots.file_path` is cleared while the row and its hash stay.
- `src/capture/state.ts`: `listNativeScreenshotsForDay` and
  `clearScreenshotFilePaths` as the analysis handoff; `src/config.ts`:
  `analysis.localProviders` (trimmed, de-duplicated, order kept).
- Tests: scripted fake-adapter replay, consent/store/prompt/LLM suites, and the
  pipeline suite — zero network, zero screen capture, no host `llm` call.

**Landed scope (0.7.2):**

- `src/analyse/host.ts`: the production adapter over the host's `ctx.llm`
  service — `provider`/`model`/`system`, one user message, and a cancellation
  signal in; aggregated text deltas out; the provider-reported input/output
  tokens handed back for the ledger.
- `src/analyse/worker.ts`: an injectable-timer worker that runs one tick
  immediately on start and then every `analysis.intervalMinutes`, never overlaps
  ticks, backs off while consecutive ticks fail, and stops with the plugin
  lifecycle. A failing tick is logged and scheduled again instead of crashing
  the host.
- `src/analyse/status.ts` and `GET /api/dayflow/analysis/status`: the switches,
  the consent gate's reason, the worker state, today's job counts, the call and
  token ledger (read from `analysis_jobs`, not a second counter), the last job
  time, and the daily budgets. A missing journal answers zeros and is not
  created by the read.
- The Journal insights panel adds a **read-only analysis line** under the
  capture line: off, waiting for consent, a missing provider or model, paused
  with capture, running or idle, or a stopped worker — plus today's failures,
  the call/token budget, and the last job's local time. With a consent set it
  also discloses what leaves the machine (frontmost app, window title, and
  frame hash; no image, and `cloud` says the metadata leaves the Mac). It has
  no button: enabling analysis stays a profile edit, so the panel keeps its one
  entry.
- `/dayflow-analyze`: one manual tick through the same consent gate; failures
  come back as command text, never as a thrown error.
- `analysis.intervalMinutes` (1–60, default 5). No schema change.
- Tests stay zero-network: the host adapter and the worker run on fake streams
  and injected timers.

**Landed scope (0.8.0):** the three analysis-ledger follow-ups, in one patch,
with no schema, route, command, tool, skill, or configuration-key change and no
changed default.

- **Token budget as a post-call gate.** The pipeline wraps the existing day
  ledger: `src/analyse/pipeline.ts` reads
  `analysisTokenTotalsForDay` (the same single sum the status route reads)
  before a window starts and again right after a completed window records its
  tokens, and skips the run's remaining windows with reason `budget-tokens`,
  setting `outcome: 'budget'` and `budgetKind: 'tokens'`. The call gate keeps
  reason `budget` and `budgetKind: 'calls'`, and still runs first. The crossing
  call stays complete and its usage stays on the row: nothing is rolled back or
  recomputed, and a run that starts later the same day refuses new windows
  before calling.
- **Observable status.** `src/analyse/status.ts` adds the additive
  `tokenBudgetExhausted` to its read-only payload (a missing journal still
  answers `false` without creating the file), and the panel's analysis line turns
  amber (`Daily token budget reached`) while it is true. The route set stays 18.
- **Transient-skip catch-up.** New `src/analyse/skips.ts` holds the pure policy
  (`TRANSIENT_SKIP_REASONS`, `isTransientSkipReason`):
  `analysis-disabled`, `capture-disabled`, `paused`, `consent:none`,
  `provider-unset`, `model-unset`, `consent:provider-not-local`, and
  `analyser-unset` are configuration-caused and replayable; `budget`,
  `budget-tokens`, `failed`, and unknown reasons are not, and the
  forward-compatible default is "do not replay". After a non-blocked worker tick
  (a still-closed gate would only re-skip the rows), the bounded pass
  `replaySkippedAnalysisWindows` requeues the rows in **today
  and yesterday** (one day back by default; the pass takes `daysBack` / `limit`
  bounds, not a configuration key) with a conditional
  `WHERE status = 'skipped'` update, leaves `attempts` untouched, and keeps the
  old reason in `analysis_jobs.payload_json` as `replayed_from` /
  `replayed_at`. A failed replay is logged (`analysis.catch_up`) and never
  changes the day's result. No older day is swept, and a replayed window is
  analysed by the normal pipeline under that day's own remaining budgets.
- **04:00 day tail.** After the day's own run (and after that catch-up when it
  ran), the worker runs one bounded pipeline run for **yesterday**, so the frames
  captured between the last pre-boundary tick and 04:00 are analysed and
  yesterday's just-requeued windows are picked up in the same pass. The checkpoint `analysis_tail_checked_on` in
  `capture_state` (read/written through the generic
  `readCaptureStateValue` / `writeCaptureStateValue` helpers) makes it once per
  Dayflow day. It holds today's day key and is written only for a non-`blocked`
  outcome, so a later consent/provider/model fix the same day still catches up;
  the run happens before the checkpoint is written. The tail itself runs in its
  own `try/catch`: a throw is recorded on the worker's `lastError` and logged
  (`analysis.day_tail`), but it never changes today's `lastOutcome`, never
  counts toward the backoff, and never stops the loop. `src/day.ts` gains a
  DST-safe `previousDayKey`. The checkpoint shares `capture_state` with
  `paused`, `last_frame_at`, and `last_sweep_at`; no migration.
- **Verification.** The new tests cover the gate order (idempotency → call gate
  → already-spent token check → call → post-call token gate), the crossing call
  staying complete, NULL usage counting as zero, the whitelist and the
  never-replayed reasons, attempts left alone, the audit payload, the replay
  bounds and idempotency, the replay-before-tail ordering, the once-per-day tail
  with its blocked retry and throw isolation, the inert default profile, and the
  unchanged route/command/schema counts. The suite stays network-free on the
  fake analyser seam. **Rollback:** no schema change, so the tag is revertible
  and an older build still opens the journal; at the profile level
  `analysis.consent: 'none'` (or capture off) stops every call the patch can
  make.

**Still deferred after 0.8.4.** The analysis-ledger debts are closed (0.8.0),
the briefs reading view landed (0.8.1), and 0.8.4 is the release close; what
remains is owner-gated rather than scheduled by default and has moved to the
next line: image admission and downscaling (the model sees app / window-title /
hash metadata, not screen pixels; D1/D2/D11) and the Phase 4 `source: owned`
default flip (D10, with 1.0.0 after a real week of capture without data loss).
They were planned as 0.8.2 and 0.8.3 and are not implemented on the 0.8.x line.
The daily/weekly briefs plus the automation scheduler landed in 0.7.4's Phase 3
slice, the weekly lint in 0.7.5, the ledger follow-ups above in 0.8.0, the
panel's reading view for the stored briefs in 0.8.1, and 0.8.4 only reconciles
the docs and the release trail.

**Acceptance.** A scripted replay (30 stored frames + scripted model adapter,
no network) yields deterministic activities and a rendered day view; replaying
the same frames is a no-op; a failing/timed-out call retries, then records a
failure without corrupting the day; budget caps stop analysis and surface the
reason. The 0.8.0 cases in the landed scope above are part of this acceptance:
the token gate never makes a second call after the budget is reached, a budget
skip is never replayed, a repaired configuration analyses exactly the transient
skips once, and the day tail runs once per boundary and cannot fail the tick.
Real local smoke: 20 minutes of capture → at least one card that matches what
was on screen.

### Phase 3 — Cards, briefs, and insights automation (about 1 week)

**Status: the text-only automation slice is complete (0.7.4); the scheduled
weekly memory lint landed in 0.7.5, the stored briefs became readable in the
panel in 0.8.1, and the close history in 0.9.1.** The day and week close
themselves now, behind the same analysis consent/provider/model gate and without
any image:

- **Schema v9.** Two additive tables — `automation_runs` (one row per attempted
  day/week close: period, status, attempts, error, timestamps, so a re-run is a
  no-op) and `briefs` for the stored weekly brief bodies (the daily standup
  keeps its `daily_standup_entries` home; `kind = 'day'` is reserved). Existing
  tables and payloads are unchanged, so an imported 0.7.3 journal migrates
  forward without a compatibility break.
- **Briefs (`src/briefs/`).** `daily.ts` writes the day's standup into
  `daily_standup_entries` (compatible with the existing standup skill);
  `weekly.ts` rolls seven days into `briefs`.
- **Scheduler (`src/automation/scheduler.ts`).** Host timers close the Dayflow
  day at `automation.dailyAt` (04:00) and the Monday-anchored week at
  `automation.weeklyOn`, with catch-up on start (and on each scheduled tick)
  when `automation.catchUpOnStart` is true, bounded by the new
  `automation.catchUpDays` window (1–30, default 2); a missed close older than
  that window is recorded as `skipped` instead of replayed. A failed close
  retries up to the run's two-attempt cap. `automation_runs` keeps the close
  idempotent.
- **Insights pass (`src/automation/insights.ts`).** After a day closes: one day
  reflection, at most three review proposals (distillation/loop/improvement,
  confidence ≥ 0.6), memory claims only as a **kept** promotion (never silently
  active), and task session matching through the existing `scanTaskHistory`
  logic followed by `attachTaskSession` (a low-confidence match becomes a
  review item instead). The weekly close writes one stored week brief
  (`briefs`, `kind = 'week'`) and adds **no** weekly reflection and **no**
  weekly review pass: the stored week brief is the compressed week record, and a
  weekly reflection is not scheduled on the shipped line. The weekly memory lint
  is the separate 0.7.5 pass below.
- **Observable surface.** `/dayflow-run-close` (a manual trigger for testing and
  catch-up), the panel's compact close-state line,
  `GET /api/dayflow/automation/status` (enabled/running, `dailyAt`, `weeklyOn`,
  `catchUpDays`, the last day/week close, and the next close time), and — since
  0.8.1 — the read-only **Briefs** block in the Journal insights view that
  renders the stored briefs from the additive `briefs` field. Since 0.9.1 the
  same view also ends with a read-only **Close history** block, which renders
  the most recent closes from the additive `closes` field (new
  `src/automation/read.ts`, `readPanelCloses` / `listPanelCloses`).
- **Scheduled memory lint (`src/automation/lint.ts`, 0.7.5).** As part of the
  weekly close, a read-only pass over the dated claims (`lintMemoryClaims`, the
  same check `journal_memory` `action: "lint"` exposes) turns each finding into
  **review proposals only**: kind `improvement`, at most one per claim per week,
  through the existing review fingerprint and suppression, and bounded by the
  existing daily cap. It never supersedes or forgets a claim, writes nothing to
  `memory_claims`, and makes no model call — so it runs even when the week's
  model call is gated off, and the close itself is then recorded `skipped`. One
  `automation_runs` row with `job: 'lint'` and `day` = the week's Monday keeps
  the pass idempotent — re-running the same week is a no-op — and the weekly
  brief gains a short **"Memory health: …"** digest in its body and in
  `payload_json.memory_health` (the lint runs before the brief is written, so
  its result lands in the same brief); a week with no findings says "nothing to
  report" rather than showing nothing.
- **Schema v10 (0.7.5).** SQLite cannot alter a CHECK in place, so v10 rebuilds
  `automation_runs` inside one transaction: every v9 row is copied, and the
  `job` CHECK accepts `'lint'` beside `'day_close'` and `'week_close'` while the
  rest of the shape is unchanged. The same migration adds a nullable
  `briefs.payload_json` for the digest, so every v9 brief keeps its row with a
  NULL payload. Stored closes survive the rebuild, and both the old and the new
  job values are accepted afterwards; the migration asserts the row count before
  and after.
- **Briefs reading view (0.8.1).** The stored briefs are now readable where the
  rest of the journal is: `GET /api/dayflow/insights` gains an additive
  `briefs: PanelBriefSummary[]` field, and the insights view ends with a
  read-only, expandable **Briefs** block. New `src/briefs/read.ts` exports
  `listPanelBriefs`: it reads the live `briefs` rows plus the most recent native
  `daily_standup_entries` (each standup normalised into a day entry), merges them
  per `(kind, period_key)` with the stored brief winning, sorts the newest period
  first, and caps the list at 10. A missing journal answers `[]` and creates no
  file; a malformed payload is tolerated; no model is called. The weekly
  **`Memory health: …`** digest shows inside the expanded brief body. The change
  adds no route (the panel stays at 18 host Fetch routes), tab, button,
  configuration key, schema change, or host peer.
- **Close-history reading view (0.9.1).** The closes the automation records are
  now readable where the rest of the journal is: `GET /api/dayflow/insights`
  gains an additive `closes: PanelCloseSummary[]` field, and the insights view
  ends with **Briefs** and then a read-only **Close history** block. New
  `src/automation/read.ts` exports `readPanelCloses` / `listPanelCloses`: they
  read the existing `automation_runs` rows newest-updated first (ties by row
  id), map each row to `{job, day, status, attempts, error?, updated_at}`,
  clamp a stored error to 500 characters, and cap the list at 10 (the reader
  accepts a 1–20 limit). A missing journal answers `[]` and creates no file; no
  model is called. Each row shows the job badge, the day or the week's range,
  the localized status, the attempt count when a close needed more than one,
  the error summary, and the updated date; failed and skipped entries carry one
  restrained warning tone. The block is read-only — no retry, re-run, add row,
  or decision row — and the change adds no route (the panel stays at 18 host
  Fetch routes), tab, button, configuration key, schema change, host peer, or
  model call.
- **Still deferred after 0.8.4 (moved to the next line):** image admission and
  downscaling (the model sees app / window-title / hash metadata, not screen
  pixels; owner-gated D1/D2/D11) and the Phase 4 default flip (D10). The
  close-state line still shows only the schedule and the last close, but the
  failed/skipped history it summarises now has its own read-only view: 0.9.1
  landed the **Close history** block above. (0.8.0 closed this bullet's other
  item: configuration-caused analysis skips now replay within today and
  yesterday.)

**Acceptance.** Closing a synthetic day with a scripted model produces one
standup entry, one brief, one reflection, ≤3 review items, and attaches
matching task days; re-running the same day is a no-op. A skipped day catches
up on next start inside `catchUpDays` and is recorded `skipped` outside it. The
0.7.5 weekly lint turns a fixture's contradiction into at most one proposal for
that claim in the week, leaves every claim row byte-identical (no supersede, no
forget), writes its digest into the week's brief once, and a second run of the
same week is a no-op. Defaults stay inert: the scheduler mounts only with the
analysis stack (`capture.enabled` and `analysis.enabled` plus the host model
service), so a capture-off profile runs no close and no lint; once mounted,
`analysis.consent: 'none'`, no provider, or no model records a skipped close and
never calls a model.

### Phase 4 — Cutover and release (about 1 week)

**Status: rehearsed only; deferred to the next line.** 0.7.6 wrote the cutover
rehearsal checklist ([CUTOVER_REHEARSAL.md](CUTOVER_REHEARSAL.md)): a
fixture-based dry run plus an optional real-capture day on a fresh profile,
recorded pass/fail, with no default changed and no npm publish. 0.8.0 was the
ledger patch and 0.8.1 the briefs reading view, not the cutover; the planned
0.8.3 Phase 4 slot is **formally deferred to the next line** because the owner
has not answered D10, and 0.8.4 closes the line without flipping the default.
Turning `source: owned` into the default for a fresh install stays owner-gated
(D1/D2/D10), with `1.0.0` after a real week of capture without data loss.

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
  otherwise as the next line's native-preview work, with `1.0.0` once capture
  has run on a real week without data loss.

**Acceptance.** On a fresh profile with Dayflow closed: install → grant
permission → capture runs → a day appears in the panel → next morning the standup,
reflection, and review queue are populated without a single agent turn.

---

## 9. Testing and CI strategy

- **Unit:** hash/dedupe, idle gate, window grouping, sessioniser, JSON validation,
  retry/budget logic, the post-call token gate and the skip-replay policy,
  retention, idempotency keys, and the day-tail checkpoint. All run on
  Linux/macOS CI.
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
| LLM cost runs away | per-day call cap (pre-call) and token cap (post-call, so at most one call crosses the budget), dedupe before analysis, 10-minute windows, day pause when capped, budget skips never replayed, visible in status |
| Wrong attribution in tasks | sessions come from analysis plus explicit scan rules; review items are never accepted for the user; every write is inspectable and detachable |
| Laptop sleep / app quit leaves gaps | capture loop resumes, the worker's day tail catches yesterday's final window, transient skips replay once the gate opens, missing windows are marked `skipped` not fabricated |
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
rows but still no analysis; 0.7.1 then added the analysis foundation behind a
fake adapter, and 0.7.2 ran that pipeline on the host's model service and made
its state visible in the panel. 0.7.4 added the text-only automation slice:
briefs, the scheduler with catch-up, and the insights close, all with fake
adapters in CI; 0.7.5 added the scheduled weekly memory lint and its digest in
the weekly brief; 0.8.0 closed the analysis-ledger follow-ups — the post-call
token gate, transient-skip catch-up within today and yesterday, and the 04:00
day tail — without adding a schema, route, command, tool, skill, or configuration
key; 0.8.1 made the stored day/week briefs readable in the insights view — an
additive `briefs` field on the existing payload plus a read-only expandable
block, and still no new route, tab, button, configuration key, schema change, or
model call. 0.8.4 closed the line with documentation, test, and release-trail
reconciliation only — no source, schema, route, command, tool, skill,
configuration, or dependency change. 0.9.1 then added the close-history reading
view: an additive `closes` field on the existing insights payload plus a
read-only **Close history** block, with no new route (the panel stays at 18 host
Fetch routes), button, configuration key, schema change, or model call. Phase 4
is the cutover, deferred to the next line and owner-gated (D10; `1.0.0` after a
real week of capture without data loss).

Estimated wall clock: **6–7 weeks** single-threaded, **3–4 weeks** with three
parallel workstreams, plus one real week of dogfooding before `1.0.0`.
