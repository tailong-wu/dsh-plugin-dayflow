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

Both blocks are validated at load time but **unused until the analysis and
automation phases land**, so their keys currently change nothing. Defaults are
shown; `provider` and `model` empty mean "use the agent's default route".

| Key | Default | Meaning |
| --- | --- | --- |
| `analysis.enabled` | `true` | Run the frame analyser (also needs capture enabled). |
| `analysis.consent` | `none` | `none`, `cloud` (frames may leave the machine), or `local` (local endpoints only). |
| `analysis.provider` | `''` | Model provider id; empty uses the agent default. |
| `analysis.model` | `''` | Model id; empty uses the provider default. |
| `analysis.windowMinutes` | `10` | Minutes of frames grouped into one analysis window (1–60). |
| `analysis.framesPerWindow` | `3` | Representative frames sent per window (1–5). |
| `analysis.maxCallsPerDay` | `120` | Hard cap on analysis calls for one day (1–1000). |
| `analysis.dailyTokenBudget` | `200000` | Hard cap on analysis tokens for one day (1000–2000000). |

| Key | Default | Meaning |
| --- | --- | --- |
| `automation.enabled` | `true` | Run the scheduled day and week closes. |
| `automation.dailyAt` | `04:00` | Local time the day closes, as `HH:MM` (00:00–23:59). |
| `automation.weeklyOn` | `monday` | Weekday of the weekly close. |
| `automation.catchUpOnStart` | `true` | Run missed closes after the host starts. |

## Native capture configuration

Capture is off by default: a profile that says nothing records nothing. The
capture block, with the Phase 1 additions:

```yaml
    capture:
      enabled: true             # off by default
      intervalSeconds: 45       # 5-600
      idleSeconds: 120          # skip after this much input idle; 0 disables
      maxFramesPerDay: 1200     # hard cap on frames per Dayflow day
      keepFramesDays: 0         # at least one day is kept while analysis does not exist
      pauseApps: []             # bundle ids or app-name substrings never captured
      displays: main            # 'main' or 'all'
      dedupeDistance: 4         # dHash Hamming distance treated as a duplicate (0-16)
      retentionCheckMinutes: 60 # how often the retention sweep runs (5-1440)
```

What the engine does with these settings, and what it still does not do, is
described in [NATIVE_CAPTURE.md](NATIVE_CAPTURE.md).
