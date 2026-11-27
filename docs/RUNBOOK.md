# Operations runbook

[← Back to README](../README.md)

Operator manual for a **checkout install** of `dsh-plugin-dayflow` at `v0.9.2`: health checks, first run, safe switches, data and backup, upgrades between tags, rollback, the paused-line maintenance checklist, and troubleshooting. Checked against the `v0.9.2` release on 2026-11-27 with DSH host **0.2.2-rc.5**, Node v25.8.1 on macOS 15.1 (arm64); package **0.9.2**, npm **404**. The project is in maintenance, paused pending owner decisions D1/D2/D7/D10/D11 ([OWNER_DECISIONS.md](OWNER_DECISIONS.md)). Re-run §1 before trusting numbers.

## 1. What is installed

A default profile registers **23 tools** (17 with `edits: false`; 12 read tools, `journal_import`, `journal_review`, `journal_task`, `journal_memory`, `journal_reflection`, six editing tools — [TOOLS.md](TOOLS.md)), **8 skills** (`dayflow`, `onboarding`, `standup`, `weekly-review`, `review-queue`, `long-task`, `memory`, `reflection`), **5 slash commands** (`/dayflow-task`, `/dayflow-remember`, `/dayflow-reflect`, `/dayflow-analyze`, `/dayflow-run-close` — [QUICK_CAPTURE.md](QUICK_CAPTURE.md)), and the optional Web panel: one header button, one right-Sidebar tab, month/week/day views plus Journal insights, **18 host Fetch routes** (nine `GET`, nine `POST` — [PANEL.md](PANEL.md)). The default backend is `source: dayflow`, a read-only read of `~/Library/Application Support/Dayflow/chunks.sqlite` plus the app's socket for edits; the optional owned journal (`$DSH_HOME/dayflow/journal.sqlite`, schema **v10**) is not the default ([ARCHITECTURE.md](ARCHITECTURE.md#owned-journal)). Native capture is off by default and every shipped release is text-only (no attachment peer, no image bytes). Zero dependencies beyond the host (`node:sqlite` supplies SQLite). The host is DSH **0.2.2-rc.5**; `package.json` declares DSH `0.2.0-rc.2`, `0.2.1-rc.2`, and `0.2.2-rc.5` compatible (`dsh.compatibility.dshReleases`) and pins the DSH development dependencies to `0.2.2-rc.5` (the seven SDK packages plus three client host peers as devDependencies; `cordis` `4.1.0`). Node ≥ 22.5.

### Health checks

Run from the repository root:

```sh
node -p "require('./package.json').version"   # 0.9.2
node -p "require('./package.json').dsh.compatibility.dshReleases['0.2.2-rc.5']"  # compatible
git describe --tags                           # v0.9.2 (tag) / v0.9.2-N-g<sha> after later docs commits
git tag --list | wc -l                        # 22
npm test                                      # tests 583 · pass 583 · fail 0 (builds first; 557 at v0.9.2)
npm run typecheck                             # exit 0, no output
npm run rehearsal                             # REHEARSAL PASS: 20/20 checks passed
npm run check:package                         # check-package: ok · 146 files · 2.52 MB packed · 3.90 MB unpacked
J="${DSH_HOME:-$HOME/.dsh}/dayflow/journal.sqlite"; test -f "$J" && sqlite3 "$J" 'SELECT version FROM schema_version;'  # 10 once it exists
```

- The host cohort is DSH `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.2-rc.5`; this runbook was checked against **0.2.2-rc.5**, and the DSH development dependencies are pinned to it (SDK packages plus three client host peers as devDependencies; `cordis` `4.1.0`). `0.9.2` is a compatibility patch only: no behaviour, default, schema, route, command, tool, skill, peer-range, or runtime-dependency change (its one source change is a type-only `Config` annotation for the new typings).
- `npm run rehearsal` is the fixture-only Phase 4 dry run (no screen, no network); a clean run also prints the restart table 13/13 unchanged, and exit code 2 means `lib/` is missing — build first.
- `npm view dsh-plugin-dayflow version` answers **E404**, not a version: nothing is published (owner decision D7), so `dsh plugin add` and `npm install` of the package name are not install or upgrade paths here — use a checkout.
- Release trail: **22 tags / 22 GitHub Releases**, `v0.9.2` Latest; the tag is annotated. With an authenticated `gh`: `gh release list -R tailong-wu/dsh-plugin-dayflow --limit 30 | wc -l` → `22`. A tag without a Release is a trail gap only (§7).
- In the app, the second health check is the panel's Journal insights view: its capture, analysis, and close-state lines must agree with the profile, and the header **Dayflow** button must open the tab.

## 2. First run

1. **Prerequisites.** macOS; Dayflow installed and recording (`dayflow_status` names what is missing and the `onboarding` skill walks through it); Node ≥ 22.5 (22.5–22.12 and 23.0–23.3 need `--experimental-sqlite`, which CI sets via `NODE_OPTIONS`; 22.13+ and 23.4+ do not); `dsh` ≥ 0.2.0-rc.2 (declared compatible `0.2.0-rc.2`/`0.2.1-rc.2`/`0.2.2-rc.5`; this guide was checked on `0.2.2-rc.5`). `pnpm` is only needed for `dsh plugin add`, unusable until D7.
2. **Build and link** ([README §Install](../README.md#install), [ARCHITECTURE.md](ARCHITECTURE.md#setting-dayflow-up)):

   ```sh
   git clone https://github.com/tailong-wu/dsh-plugin-dayflow.git && cd dsh-plugin-dayflow
   npm install && npm run build
   mkdir -p ~/.dsh/profiles/web/node_modules
   ln -sfn "$PWD" ~/.dsh/profiles/web/node_modules/dsh-plugin-dayflow
   ```

3. **Record the bundle.** Add `"dsh-plugin-dayflow"` to `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json`. The Desktop App runs its own `desktop` profile: link under `~/.dsh/profiles/desktop/node_modules`, add `"dsh-plugin-dayflow": "link:<path>"` to that file's `dependencies` and the bundle entry, then quit and reopen the app.
4. **Start** `dsh web`. With HMR enabled (the default for base-backed profiles) the running app reloads; otherwise restart `dsh web`. Open the header **Dayflow** button. On the shipped defaults the panel shows capture **Native capture is off**, analysis **Analysis is off** (the line reports enabled only when capture and analysis are both on), and close state **Day closes 04:00 · Week close Mon · catch-up 2 days**; turning capture on with `analysis.consent: none` changes the analysis line to **Analysis waits for consent**.
5. **Verify the backend** with `dayflow_status` in a conversation:

   ```text
   Dayflow · last capture 2m ago
   Today: 2026-11-27 (day starts 04:00, Asia/Shanghai)
   Source: dayflow
   Database: /Users/you/Library/Application Support/Dayflow/chunks.sqlite
   ```

   Excerpt: the real answer also prints the `Edit bridge:` and `Edits:` lines. `Analysis backlog: N batches` and `Failed batches: N` appear only when non-zero; the zone is the Mac's IANA zone and the day starts 04:00 local. If it says **not set up on this Mac yet**, return to step 1. Reads work with Dayflow closed; edits do not.

### Owned journal preview (optional, opt-in)

`source: owned` is an opt-in preview of reading the imported copy without Dayflow; it is **not** the default and flipping the default is owner-gated (D10).

```text
journal_import({})   # no source_path: uses the configured databasePath
```

It opens the Dayflow database read-only, imports additively and idempotently, and prints imported/updated/unchanged counts per table plus the `Skipped` tables (provider call logs and chat history are deliberately not imported). Then set `source: owned` — or `dayflow: false`, never both — under the plugin's row in the profile's `cordis.patch.yml`, and let the host reload. Limits: editing tools stay Dayflow-only, so `dayflow_status` reports `Edits: disabled (reads only)` on owned (use `source: dayflow` to edit); re-run `journal_import` to pick up new rows (it only adds); native capture cards live only in the owned journal; read the imported journal in the same timezone for exact 04:00-boundary totals ([ARCHITECTURE.md](ARCHITECTURE.md#owned-journal)).

## 3. Safe switches

The shipped defaults are already the safe profile: capture is off, `analysis.consent` is `none` (no model call), the provider and model are empty (there is no implicit host default), and the automation scheduler is inert because it mounts only with capture and analysis on and a host model service available. Analysis is text-only: the call sends the frontmost app, window title, and frame hash — never an image; the closes send activity text.

A minimal patch that states the safety-relevant keys explicitly. Put it in the profile's own `cordis.patch.yml` under the plugin's row by id; omitted keys keep their shipped defaults:

```yaml
- id: dayflow
  config:
    panel: true                # optional UI; no write of its own
    capture: { enabled: false }                          # default: nothing is recorded
    analysis: { consent: none, provider: '', model: '' } # default: no model call, no implicit host default
    automation: { enabled: false }                       # default true, but mounts only with the analysis stack
```

| Key | Default | Why it is safe |
| --- | --- | --- |
| `capture.enabled` | `false` | No frames are recorded; Screen Recording permission is not used. |
| `analysis.enabled` | `true` | Inert: also needs capture on, a host `llm` service, a non-`none` consent, and an explicit provider + model. |
| `analysis.consent` | `none` | Blocks every analysis and close call; windows are recorded `skipped`. |
| `analysis.provider` / `model` | `''` / `''` | No implicit agent default; empty means "not configured". Under `local`, the provider id must also be in `analysis.localProviders` (empty accepts none). |
| `automation.enabled` | `true` | Mounts only with capture + analysis + host `llm`; once mounted a close still needs `cloud`/`local` consent and an explicit provider and model, otherwise it is recorded `skipped`. |
| `panel` | `true` | The views are read-only; the panel's own writes are only user-initiated journal edits (inline task/memory/reflection, review decisions, task-session attach/detach, and the capture pause flag). |
| `edits` | `true` | Registers the six editing tools; Dayflow's own **Allow edits** switch still gates every write. |
| `icons` | `true` | The only outbound request: one `favicon.ico` per domain, no cookie or referrer; `false` stops it. |
| `allowInstall` | `false` | The installer tool exists only when true and `source: dayflow`; it runs `brew install --cask dayflow` after an explicit `confirm: true`. |

Full key list, ranges, and blocks — including `memoryContext` (default `true`), `searchLimit` (default `50`) and the native capture block — are in [CONFIGURATION.md](CONFIGURATION.md) and [NATIVE_CAPTURE.md](NATIVE_CAPTURE.md). To stop everything without removing the plugin:

```yaml
- id: dayflow
  config:
    capture: { enabled: false }
    analysis: { enabled: false, consent: none }
    automation: { enabled: false }
    panel: false
    edits: false
    icons: false
```

## 4. Data and backup

| What | Where (defaults) | Notes |
| --- | --- | --- |
| Dayflow app database | `~/Library/Application Support/Dayflow/chunks.sqlite` | Read-only; override with `databasePath`, or `DAYFLOW_DB` when `databasePath` is empty. |
| Dayflow write socket | `~/Library/Application Support/Dayflow/agent.sock` | Edits only; override with `agentSocket`. |
| Owned journal | `$DSH_HOME/dayflow/journal.sqlite` (`DSH_HOME` defaults to `~/.dsh`) | Schema **v10**; review queue, tasks/sessions, memory claims, reflections, `analysis_jobs`, `automation_runs`, `briefs`, `capture_state`, screenshots and native cards. Directory `0700`, file `0600`. Override with `journalPath`. |
| Capture frames | `$DSH_HOME/dayflow/frames/<day>/<ts>-….jpg` | Directory `0700`, file `0600`; `keepFramesDays: 0` deletes each frame once its window is analysed. |
| Icon cache | `$DSH_HOME/dayflow-icons` | Regenerated on demand; delete freely. |

Back up the owned journal with SQLite's online backup, safe while the host runs:

```sh
mkdir -p "$HOME/backups/dayflow"
sqlite3 "${DSH_HOME:-$HOME/.dsh}/dayflow/journal.sqlite" \
  ".backup '$HOME/backups/dayflow/journal-$(date +%F).sqlite'"
```

For a quiet copy, stop `dsh web` first and copy the file. Do **not** copy a running Dayflow app's `chunks.sqlite` blindly — the app uses WAL; quit the app or use `sqlite3 … ".backup …"` for it too. The Dayflow database belongs to the app, so back it up through the app's own lifecycle.

Restore by stopping the host, putting the file back, and restarting:

```sh
# stop dsh web first
cp "$HOME/backups/dayflow/journal-2026-11-27.sqlite" "${DSH_HOME:-$HOME/.dsh}/dayflow/journal.sqlite"
chmod 600 "${DSH_HOME:-$HOME/.dsh}/dayflow/journal.sqlite"
sqlite3 "${DSH_HOME:-$HOME/.dsh}/dayflow/journal.sqlite" 'SELECT version FROM schema_version;'  # 10
```

An older backup migrates forward on first open. A backup **newer** than the installed plugin is refused (`Journal schema N is newer than this plugin supports`), so keep the pre-upgrade backup for a version rollback. Frames are disposable — the journal rows stay — but a frame deleted before analysis means its window cannot be analysed. Journal migrations are **forward-only**: there is no downgrade, only restore from backup. `journal_import` never deletes from either database and re-running it is idempotent; the irreversible operations are listed in §6.

## 5. Upgrade between tags

Nothing is on npm, so an upgrade is a move between tags; a newer tag is not a newer `package.json` on a registry.

```sh
cd dsh-plugin-dayflow
# 1. back up first if the owned journal has data: see §4
git fetch --tags
git checkout v0.9.2            # the target tag
npm ci                         # or npm install; the lockfile is committed
npm run build
npm test                       # 557 pass at v0.9.2; a later line reports its own count
```

Let the host reload (HMR) or restart `dsh web`; quit/reopen the Desktop App if that profile is the linked one. Verify:

```sh
git describe --tags --exact-match            # v0.9.2
node -p "require('./package.json').version"  # 0.9.2
J="${DSH_HOME:-$HOME/.dsh}/dayflow/journal.sqlite"; test -f "$J" && sqlite3 "$J" 'SELECT version FROM schema_version;'
```

- CI enforces the tag/version pairing: on a tag push, `release-check` fails unless the tag equals `v$(package.json version)`. A mismatch on your checkout means you are between commits, not that the tag is wrong.
- The owned journal migrates forward the first time the new plugin opens it (read or write), so back it up before the first start after an upgrade. Read the target version's section in [CHANGELOG.md](../CHANGELOG.md), the line status in [ROADMAP.md](ROADMAP.md), and — for the native chain — the records in [CUTOVER_REHEARSAL.md](CUTOVER_REHEARSAL.md).
- The 0.9.x line is closed at `v0.9.2`; no newer tag exists yet. `v0.9.2` is a compatibility patch: it declares DSH `0.2.2-rc.5` and pins the DSH development dependencies to it (`cordis` `4.1.0`), with no host peer, runtime dependency, schema, route, or default change, so the upgrade is a checkout/rebuild, not a data migration. A step from a `0.8.x` tree adds no host peer and no runtime dependency either (the 0.9 patches are additive panel payloads with no schema step). The peer range stays `^0.2.0-rc.2`, so the declared cohort on an older 0.2 host is unchanged; the 0.9.2 verification itself ran on DSH `0.2.2-rc.5`. Verify with §1 and the panel status lines: the test count changes per tag (544 on `v0.9.0`, 557 on `v0.9.1` and `v0.9.2`), so compare against that tag's record, not this file.

## 6. Rollback

**Configuration rollback** needs no reinstall. On the default backend, undo the owned preview and turn the optional machinery off:

```yaml
- id: dayflow
  config:
    source: dayflow               # back from owned; the default is dayflow
    capture: { enabled: false }
    analysis: { consent: none }   # add enabled: false to stop the worker outright
    automation: { enabled: false }
    panel: false                  # removes the header button and the tab
```

Apply it in the profile's patch and reload; Dayflow's own app data is untouched.

**Version rollback** is `git checkout <older tag>` + `npm ci` + `npm run build` + restart. The journal schema is forward-only: if the newer plugin migrated the journal past the older plugin's maximum, the older plugin refuses to open it. Restore the backup you took before the upgrade (§4) instead of downgrading the file.

**Uninstall** reverses the install: remove `"dsh-plugin-dayflow"` from `dsh.profile.bundles`, `rm` the symlink from `~/.dsh/profiles/web/node_modules/dsh-plugin-dayflow`, and restart. For the Desktop App remove the bundle entry and the `"dsh-plugin-dayflow": "link:…"` dependency from the `desktop` profile's `package.json`, plus its symlink. The plugin's data stays on disk; delete it deliberately if you want it gone: `$DSH_HOME/dayflow/journal.sqlite`, `$DSH_HOME/dayflow/frames/`, and `$DSH_HOME/dayflow-icons`. **Do not** delete `~/Library/Application Support/Dayflow` — that is the Dayflow app's data.

**Irreversible operations.** Do these only with the data backed up:

- **Journal migration** — forward-only; the only rollback is restoring a backup.
- **`dayflow_delete_activity`** — also removes the underlying observations and cannot be fully undone; the tool requires confirmation first.
- **`journal_memory` `forget`** — hard-deletes a claim (needs `confirm: true`).
- **Review decisions** — `discard`/`reject` with `forever: true` hard-suppresses an item; decisions and hard suppression cannot be quietly reversed.
- **Deleting the journal or frames** — the records are gone; frames can only be re-captured by turning capture back on.
- **Edits through Dayflow** — forwarded to the app, outside the plugin's undo surface.

## 7. Maintenance checklist (paused line)

**Status:** as of 2026-11-27 the project is in **maintenance, paused pending owner decisions D1/D2/D7/D10/D11** ([OWNER_DECISIONS.md](OWNER_DECISIONS.md)). Maintenance means verification and necessary fixes only: no roadmap patch, no `1.0.0`, no default change; the only tag taken during the pause is the `0.9.2` compatibility patch. CI already runs `npm test` and `check:package` on macOS 15 with Node 22 (with `--experimental-sqlite`) and 24 on every push, and the release check gates a tag against `package.json`.

| Check | Command (repo root) | Expected while paused |
| --- | --- | --- |
| Suite | `npm test` | `583 pass / 0 fail` (557 at `v0.9.2`) |
| Types | `npm run typecheck` | exit 0, no output |
| Fixture rehearsal | `npm run rehearsal` | `REHEARSAL PASS: 20/20 checks passed` |
| Package shape | `npm run check:package` | `check-package: ok`, exactly one package, no `src/`, `tests/`, `scripts/`, sourcemaps |
| Tag trail | `git tag --list \| wc -l` | `22` |
| Release trail | `gh release list -R tailong-wu/dsh-plugin-dayflow --limit 30 \| wc -l` | `22`, `v0.9.2` Latest |
| npm | `npm view dsh-plugin-dayflow version` | `E404` (expected; D7) |
| Defaults untouched | `git diff v0.9.2 -- src/config.ts cordis.patch.yml package.json` | empty |
| Schema | `J="${DSH_HOME:-$HOME/.dsh}/dayflow/journal.sqlite"; test -f "$J" && sqlite3 "$J" 'SELECT version FROM schema_version;'` | `10` |
| Docs links | open the changed pages; no repository script checks links | every relative link resolves |
| Shipped counts | README/ROADMAP/ARCHITECTURE: 583 tests in the current tree (557 at `v0.9.2`), 18 routes, 5 commands, 23 tools, 8 skills, schema v10 | unchanged |

Record **date, commit (`git rev-parse --short HEAD`), tag, Node version, macOS version, and each result**, including deviations. A green run is the expected state; during the pause any change in a shipped count or default is a finding to explain, not a routine bump. A tag without a GitHub Release is a release-trail gap only — fix it by hand (the `v0.6.0` gap was backfilled that way) and record it; it does not affect the plugin's runtime or this runbook's upgrade path.

## 8. Troubleshooting

Start with `dayflow_status` in a conversation and the panel's three status lines; most failures name their own fix there.

| Symptom | Check | Fix |
| --- | --- | --- |
| `No Dayflow database at …` or `dayflow_status` says **not set up** | `ls ~/Library/Application\ Support/Dayflow/chunks.sqlite` | Open Dayflow, finish onboarding, record for a few minutes. Setup walk-through: [ARCHITECTURE.md](ARCHITECTURE.md#setting-dayflow-up). |
| An edit fails because the bridge is not listening (e.g. `the edit bridge is not listening at …`) | `dayflow_status` → `Edit bridge:` | Open Dayflow. Reads work while the app is closed; writes need the app and its socket. |
| `Editing is off…` | `dayflow_status` → `Edits:` | Dayflow → Settings → AI Tools → **Allow edits**. `edits: true` only registers the tools; the app's switch gates every write. |
| `This Node.js (…) has no built-in SQLite` | `node --version` | Use Node 22.13+/23.4+ (24 included), or pass `--experimental-sqlite` on 22.5–22.12/23.0–23.3. |
| Owned journal cannot be opened or written | `ls -ld "${DSH_HOME:-$HOME/.dsh}/dayflow"` and the schema query | Check `DSH_HOME`, disk space, and ownership/mode (directory `0700`, file `0600`); a newer schema than the installed plugin is refused — see §4. |
| Panel has no header button or tab | profile patch `panel: true`; `ls -l ~/.dsh/profiles/*/node_modules/dsh-plugin-dayflow` | Re-check the bundle entry and symlink, then reload or restart `dsh web`; the Desktop App needs its own `desktop` profile (§2). See [PANEL.md](PANEL.md). |
| Panel is unreachable after a restart | host process still running | Restart `dsh web`; rebuild the client chunk with `npm run build` if the panel bundle is stale. |
| Analysis never runs | panel analysis line; `/api/dayflow/analysis/status` | In order: `capture.enabled: true`; `analysis.enabled: true`; host model service available; `analysis.consent` `cloud` or `local`; explicit `analysis.provider` and `model`; under `local`, the provider id in `analysis.localProviders`. A default profile is inert by design; gates and defaults are in [CONFIGURATION.md](CONFIGURATION.md). |
| Analysis line says **Daily token budget reached** | status payload `tokenBudgetExhausted` | The day's recorded input+output tokens reached `analysis.dailyTokenBudget` (default `200000`). It resumes after the 04:00 boundary; raise the budget (1000–2000000) to continue today. |
| Close did not happen | panel close-state line, Close history, `/api/dayflow/automation/status` | Closes need the analysis stack mounted (`automation.enabled` is not enough: capture + analysis + host `llm`), plus `cloud`/`local` consent and an explicit provider and model; otherwise the run is `skipped`. `/dayflow-run-close` runs one due close by hand. A missed day older than `automation.catchUpDays` (default 2) is recorded `skipped`, not replayed. |
| Screen Recording permission is needed | panel capture line | System Settings → Privacy & Security → Screen Recording → grant it to the DSH host; only native capture needs it. See [CUTOVER_REHEARSAL.md](CUTOVER_REHEARSAL.md) step 2. |
| Time looks missing or off by hours | `dayflow_status` backlog counters | Analysis runs in batches (the backlog shows pending/failed batches); the plugin uses the Mac's local timezone and a 04:00–04:00 day. Idle means no screen activity was captured — not evidence of a break. |
| `npm view` answers 404 | §1 | Expected: not published (D7). Install and upgrade from a checkout, not the registry. |

Deeper routes: [PANEL.md](PANEL.md), [NATIVE_PORT.md](NATIVE_PORT.md) for the capture/analysis plan and privacy boundaries, [CUTOVER_REHEARSAL.md](CUTOVER_REHEARSAL.md) for the fixture and real-day checks.

## 9. Maintenance notes

**Revision checked.** This runbook was revised on **2026-11-27** for the `v0.9.2` release: package version **0.9.2**, DSH host **0.2.2-rc.5** (declared compatible and pinned in the development dependencies, with `cordis` `4.1.0`), Node **v25.8.1**, macOS **15.1** (arm64). The §1 release-gate numbers for this tree: 583/583 tests (557 at `v0.9.2`), typecheck clean, rehearsal 20/20, package shape OK, npm 404, 22 tags and 22 GitHub Releases with `v0.9.2` Latest; re-run §1 before trusting them. The runbook is **written, not exercised**: no first-run or rollback has been walked through on a real cutover profile, because that needs D10 and a real captured week.

**Host cohort.** DSH `0.2.0-rc.2`, `0.2.1-rc.2`, and `0.2.2-rc.5` are declared compatible in `dsh.compatibility.dshReleases`; this Mac runs **0.2.2-rc.5**, and the DSH development dependencies are pinned to it (`cordis` `4.1.0`). `0.9.2` is a compatibility patch only: no behaviour, default, schema, route, command, tool, skill, peer-range, or runtime-dependency change, and no owner decision changed — npm remains **404** (D7) and the pause continues.

**Owner-gated abilities — do not document or advertise these as shipped:**

| Decision | What is gated | Safe state today |
| --- | --- | --- |
| D1 | analysis destination (may screen metadata leave the Mac) | `analysis.consent: none`; no model call, no analysed week |
| D2 | provider/model pair (and a vision pair if image admission ever happens) | `analysis.provider`/`model` empty; no implicit host default |
| D7 | npm publication | package **404**; every release is a tag + GitHub Release |
| D10 | Phase 4 cutover, `source: owned` as default | `source: dayflow` when unset; the owned journal is opt-in preview |
| D11 | image admission (pixels through the host attachment contract) | text-only; no attachment peer, no `includeImages`, no `privacy_apps` |

So there is **no image analysis**, **no `source: owned` default**, **no npm install**, and **no weekly reflection** (the weekly close stores exactly one week *brief*; a week reflection is a manual `journal_reflection` action). No shipped line ever gives the model pixels — analysis sends app / window title / frame hash only.

**Where to read next:** [README](../README.md) for the product overview, [ARCHITECTURE](ARCHITECTURE.md) for the modules and both stores, [CONFIGURATION](CONFIGURATION.md) for every key, [PANEL](PANEL.md) for the views and routes, [NATIVE_CAPTURE](NATIVE_CAPTURE.md) for capture and analysis, [CUTOVER_REHEARSAL](CUTOVER_REHEARSAL.md) for the cutover record, [TOOLS](TOOLS.md) and [QUICK_CAPTURE](QUICK_CAPTURE.md) for the agent surface, [OWNER_DECISIONS](OWNER_DECISIONS.md) for the five questions, [ROADMAP](ROADMAP.md) for the line status, and [CHANGELOG](../CHANGELOG.md) for what each tag shipped.
