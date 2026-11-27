# Configuration

[← Back to README](../README.md)

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
    skills: true       # register the eight bundled skills
    panel: true        # the optional Web panel and its header button
    icons: true        # site favicons on the panel cards (its only outbound request)
    memoryContext: true  # inject a budgeted snapshot of active tasks and recent memory
    allowInstall: false  # register dayflow_install_dayflow (it changes this Mac)
    searchLimit: 50    # maximum matches per dayflow_search call (1-200)
```

`DAYFLOW_DB` also overrides the Dayflow path when `databasePath` is empty.
`databasePath` and `agentSocket` exist for tests and unusual installs; leave
them empty in normal use. `journalPath` may point at another owned-store file
when a profile needs to share or back up the imported journal.

## Analysis and automation configuration

Both blocks are validated at load time. Since 0.7.2, `analysis` runs on its
own: when `capture.enabled` and `analysis.enabled` are both on and the host's
model service is available, the plugin starts an analysis worker that ticks
every `analysis.intervalMinutes` and turns stored frames into
`activities`/`observations` rows. It stays inert on a default profile: the
shipped `analysis.consent: 'none'` blocks every model call, and a consent only
works with an explicit `provider` **and** `model` — there is no implicit agent
default route and no implicit image upload. The panel's analysis line and
`GET /api/dayflow/analysis/status` report the worker's state and the day's
call/token ledger; `/dayflow-analyze` runs one manual tick through the same
consent gate.

On the 0.7.4 line `automation` is used: a scheduler closes a Dayflow day at
`automation.dailyAt` and a Monday-anchored week on `automation.weeklyOn`. Both
closes are **text-only LLM passes** — no images — and go through the analysis
consent gate. The scheduler mounts with the analysis stack — `capture.enabled`
and `analysis.enabled` on and the host's model service available, the same gate
as the analysis worker — so a profile without native capture runs no closes;
once mounted, a close needs `analysis.consent` set to `cloud` or `local`, an
explicit `analysis.provider`, and an `analysis.model`, and is recorded
`skipped` without a model call until then. The day close writes the day's
standup entry (`daily_standup_entries`), the day's reflection, at most a few
review proposals, and matching long-task sessions; the weekly close writes
exactly one stored week brief (`briefs`, `kind = 'week'`) — the compressed week
record — and adds no weekly reflection and no weekly review pass. Memory claims
are written only through a **kept** promotion, never silently made active. A
failed close retries up to the run's two-attempt cap, and a missed close older
than the `automation.catchUpDays` window is recorded as `skipped` rather than
replayed.
`/dayflow-run-close` runs one close by hand through the same idempotent store,
and the panel's close-state line plus `GET /api/dayflow/automation/status`
report the schedule and the last stored closes. Defaults are shown.

0.7.5 adds a **weekly memory lint** to the weekly close. Once a week, as part
of the weekly close, a read-only pass (`src/automation/lint.ts`) applies the
memory check behind `journal_memory` `action: "lint"` to the dated claims and
turns each finding into **review proposals only** — at most one proposal per
claim per week (kind `improvement`), deduplicated by the existing review
fingerprint and bounded by the existing suppression and daily cap. It never
supersedes or forgets a claim and writes nothing to `memory_claims`; the pass
makes no model call, so a week whose model call is gated off still gets the
proposals while the close itself is recorded `skipped`. It records one
`automation_runs` row with `job: 'lint'` keyed to the week's Monday, so
re-running the same week is a no-op, and the week's brief gains a short
**Memory health** digest (also mirrored in its `payload_json.memory_health`);
a week with no findings says "nothing to report" rather than showing an empty
section. That is the safe default for lint findings — proposals plus a digest,
never an automatic repair (a digest-only weekly pass was considered and not
taken). There is no new configuration key: the pass rides `automation.enabled`
and `automation.weeklyOn` with the automation scheduler, so a profile with
automation off or not mounted (capture and analysis off, or no host model
service) runs no lint either.

0.8.0 closes the three analysis-ledger gaps without adding a key. The **token
budget is now enforced on the recorded ledger**, not just reported: a completed
window records its provider-reported input/output tokens on its
`analysis_jobs` row, and once the day's recorded total reaches
`analysis.dailyTokenBudget` every remaining window in that run is skipped with
reason `budget-tokens` — the run's outcome is `budget` with
`budgetKind: 'tokens'`. The gate reads before a window starts too, so a run that
begins with the day already at the cap starts no call; the call that crossed the
cap is paid and stays complete (nothing is rolled back), and the budget resets
only because the 04:00 boundary changes the day key. The call cap
(`analysis.maxCallsPerDay`) stays a **pre-call** gate (reason `budget`,
`budgetKind: 'calls'`), so the two limits cannot be confused in the ledger. The
status payload adds `tokenBudgetExhausted`, and the panel's analysis line turns
amber to say the daily token budget is reached (analysis resumes tomorrow, or
immediately if the budget is raised). A skipped window is no longer terminal
when its reason was configuration: after a non-blocked worker tick, skips from
**today and yesterday** whose reason is one of `analysis-disabled`,
`capture-disabled`, `paused`, `consent:none`, `provider-unset`, `model-unset`,
`consent:provider-not-local`, or `analyser-unset` are requeued through
`src/analyse/skips.ts` (`replaySkippedAnalysisWindows`, bounded to one earlier
day by default). Attempts are not reset, the previous reason is kept in the
job's `payload_json` (`replayed_from` / `replayed_at`) as an audit record, and
`budget`, `budget-tokens`, `failed`, and unknown reasons are never replayed.
Then the first worker tick after 04:00 runs one bounded pipeline run for
**yesterday** after the day's own run (and after that replay), so the frames
captured between the last pre-boundary tick and 04:00 are analysed and any
window the replay just requeued is picked up; the checkpoint
`analysis_tail_checked_on` in `capture_state` makes it once per boundary (any
non-blocked outcome writes it), a blocked run leaves the checkpoint unwritten
(so a consent/provider/model fix later the same day still catches up), and a
tail failure is logged and isolated from today's outcome. None of this adds a
schema, route, command, or configuration key, and a default profile still calls
nothing.

| Key | Default | Meaning |
| --- | --- | --- |
| `analysis.enabled` | `true` | Run the frame analyser (also needs capture enabled). |
| `analysis.consent` | `none` | `none`, `cloud` (frames may leave the machine), or `local` (only providers listed in `localProviders`). |
| `analysis.localProviders` | `[]` | Provider ids accepted as local under `consent: local`, matched case-insensitively and exactly; empty accepts no provider. |
| `analysis.provider` | `''` | Model provider id; empty blocks analysis with a "needs provider" status. |
| `analysis.model` | `''` | Model id; empty blocks analysis with a "needs model" status. |
| `analysis.intervalMinutes` | `5` | Minutes between worker ticks (1–60). |
| `analysis.windowMinutes` | `10` | Minutes of frames grouped into one analysis window (1–60). |
| `analysis.framesPerWindow` | `3` | Representative frames sent per window (1–5). |
| `analysis.maxCallsPerDay` | `120` | Hard cap on analysis calls for one day (1–1000). Checked **before** a window starts: when the day has started this many calls, the run's remaining windows are skipped with reason `budget` (the run outcome is `budget` with `budgetKind: 'calls'`). |
| `analysis.dailyTokenBudget` | `200000` | Daily token budget for one Dayflow day (1000–2000000). Enforced since 0.8.0 on the day's recorded ledger: checked before a window starts and again right after each completed call, so once the recorded input+output tokens reach it the run's remaining windows are skipped with reason `budget-tokens` and the status reports `tokenBudgetExhausted`. The crossing call stays complete and nothing is rolled back; the budget resets at the 04:00 day boundary. |

| Key | Default | Meaning |
| --- | --- | --- |
| `automation.enabled` | `true` | Run the scheduled day and week closes and the weekly memory lint (the closes are still gated by the analysis consent/provider/model; the lint makes no model call). |
| `automation.dailyAt` | `04:00` | Local time the day closes, as `HH:MM` (00:00–23:59). |
| `automation.weeklyOn` | `monday` | Weekday of the weekly close, `monday`–`sunday` (lowercase). |
| `automation.catchUpOnStart` | `true` | Run missed closes after the host starts. |
| `automation.catchUpDays` | `2` | Size of the bounded catch-up window in days, including the due day (1–30); a missing day older than the window is recorded as `skipped`. |

## Native capture configuration

Capture is off by default: a profile that says nothing records nothing. The
capture block, with the Phase 1 additions:

```yaml
    capture:
      enabled: true             # off by default
      intervalSeconds: 45       # 5-600
      idleSeconds: 120          # skip after this much input idle; 0 disables
      maxFramesPerDay: 1200     # hard cap on frames per Dayflow day
      keepFramesDays: 0         # 0: delete a frame once its window is analysed; unanalysed frames live a day
      pauseApps: []             # bundle ids or app-name substrings never captured
      displays: main            # 'main' or 'all'
      dedupeDistance: 4         # dHash Hamming distance treated as a duplicate (0-16)
      retentionCheckMinutes: 60 # how often the retention sweep runs (5-1440)
```

What the engine does with these settings, and what it still does not do, is
described in [NATIVE_CAPTURE.md](NATIVE_CAPTURE.md).
