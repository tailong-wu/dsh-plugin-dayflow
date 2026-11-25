# Contributing

Thanks for taking a look. This plugin is a small, dependency-free bridge between
DeepSeek Harness and Dayflow, so contributions stay easiest when they keep that
shape.

## Development setup

```sh
git clone https://github.com/tailong-wu/dsh-plugin-dayflow.git
cd dsh-plugin-dayflow
npm install
npm test
```

`npm test` builds the plugin, compiles the tests, and runs them with
`node:test`. No network access is required: the tests use a fixture database and
a local Unix socket.

`npm run smoke` reads this Mac's real Dayflow database and prints what the tools
answer. It needs a real Dayflow install with at least a few minutes of recorded
activity, so it is not part of CI.

## Ground rules

- **Dayflow reads stay read-only.** `chunks.sqlite` is opened with
  `readOnly: true` and `PRAGMA query_only`; do not add a write path that
  bypasses that.
- **Dayflow writes go through Dayflow.** Editing calls must go over
  `agent.sock` and must respect the app's `agentEditsEnabled` switch. Do not
  write to Dayflow's SQLite or to the preferences plist.
- **The owned journal is written by the plugin.** The journal at `journalPath`
  (`$DSH_HOME/dayflow/journal.sqlite` by default) is the plugin's own store:
  migrations, `journal_import`, and the `journal_*` tools write it through
  `withJournalWrite`, so those writes are not gated by Dayflow's edit switch.
  Every other path stays read-only.
- **Dates are Dayflow dates.** A day is 04:00–04:00 local time and a week is
  Monday 04:00 to Monday 04:00. Use `src/day.ts` rather than ad-hoc date math.
- **Model-facing text is data.** Any activity text rendered back to a model must
  keep the untrusted-content framing.
- **No runtime dependencies.** Node's standard library only (`node:sqlite`,
  `node:net`, `node:child_process`, …). `@deepseek-ai/*` packages are peers
  provided by the harness.
- **The browser half stays browser-safe.** Nothing under `src/client/` may import
  a `node:` builtin, and `src/panel-contract.ts` must stay pure so both halves
  can share it. The client bundle may require only the harness's platform table:
  `react`, `react/jsx-runtime`, `@deepseek-ai/cordis`, and the UI packages.

## Adding a tool

1. Add the definition with `defineTool` in the module that owns the surface:
   `src/tools/read.ts` for reads, `src/tools/write.ts` for Dayflow edits, or a
   journal-tool module (`src/tools/import.ts`, `setup.ts`, `review.ts`,
   `task.ts`, `memory.ts`, `reflection.ts`). Keep the description short, state
   the day convention, and add the untrusted-content notice when the tool
   returns screen-derived text.
2. Return a stable JSON payload; add a renderer in `src/format.ts`.
3. Add the payload type in `src/queries.ts` when the shape is new.
4. Add tests: one for the happy path, one for the failure code.
5. Update the tool table in `README.md` and `README.zh.md`.

## Adding or editing a skill

Skills live in `skills/<name>/SKILL.md` with `name` and `description`
frontmatter. Tests enforce that every `dayflow_*` name a skill mentions is a
registered tool, so rename tools and skills together.

## Working on the Web panel

The panel is one page-type tab in the right Sidebar, opened by one
conversation-header button. Inside it, the month calendar, week swim lanes, and
**Journal insights** share one segmented switch, so the plugin never registers a
second tab or button. The calendar reads `GET /api/dayflow/month`, the swim
lanes read `GET /api/dayflow/week`, a day reads `GET /api/dayflow/day`, the
insights view reads `GET /api/dayflow/insights`, enablement comes from
`GET /api/dayflow/panel`, and icons come from `GET /api/dayflow/icon`; all six
routes are registered through the connection service and inherit the `/api`
trust fence and session cookie.

- `src/client/` is bundled by `scripts/build-client.mjs` into `lib/client.js` in
  the harness's lazy-CJS `window.__ModuleLoader__.load({ id, factory })` format.
  The wrapper is the contract; the CommonJS body is just `apply` and
  `exportPanelUi`.
- The slot runtime calls a registration's `inject` as a **function** returning
  props, not as an object. The VM test in `tests/client-bundle.test.ts` catches
  that class of mistake; keep it passing.
- Keep the four day states distinct: `recorded`, `empty` (captured, nothing to
  show), `pending` (analysis queued), and `no-data` (no captures). `dayState()`
  in `src/client/state.ts` is the single place that decides, from
  `tracked_minutes`, `pending_batches`, and `last_capture_at`.
- Week-lane geometry lives in pure helpers in `src/client/format.ts`
  (`layoutDayCards`, `formatHour`, `weekRangeLabel`), not in the component, so
  overlap packing and axis labels stay unit-tested.
- Style only with the harness tokens (`--dsw-alias-*`, `--dsw-radius-*`,
  `--dsh-scrollbar-*`) so the panel follows the theme, and prefer the primitives
  (`Button`, `Tooltip`, `StateDot`) over hand-rolled controls.
- A plugin's client half is served from the module manifest read at host start;
  after changing `dsh.client` or rebuilding the bundle, restart `dsh web` and
  reload the page.

### README media

The demo GIF and the section stills in both READMEs come from `scripts/demo/`,
which drives the real client half in headless Chromium instead of photographing
the app. A layout change should be followed by `npm run demo`; the script is not
part of the test suite, because it needs a real Dayflow database, a downloaded
Chromium, and `ffmpeg`.

- `capture.mjs` is the only step that reads Dayflow. It freezes one week into
  `fixtures/week.json` with every title and summary already replaced from
  `fixture-text.mjs`, so the committed fixture holds timings and categories but
  no real copy. Re-run it only when you want a different week.
- `build.mjs` bundles `src/client/` with a replay data source and a stand-in for
  the three `dsh-client-ui-primitives` components the panel imports; the
  primitives' own stylesheets live in `assets/`, so the pixels match the harness.
- `tour.mjs` is the scripted tour both the GIF and the stills follow, so they
  never drift apart.
- The recorder takes a still at each settled state and crossfades between them,
  rather than recording video: a screen capture picks up mid-transition frames
  and a leading blank frame, and its noise makes the GIF roughly four times
  larger for the same content.

Playwright is a local tool, not a dependency: install it (`npm i -D playwright`
or `npm i -g @playwright/cli`) plus `npx playwright install chromium` before
recording.

## Compatibility

The plugin declares the DSH releases it supports in
`dsh.compatibility.dshReleases`, and its requirements through
`@deepseek-ai/dsh-*` peer ranges (prereleases participate in those ranges, so
`^0.2.0-rc.2` covers the whole `0.2` release line). Adding support for a new
release means widening the peer floors, adding the release to that map, and
pinning the dev cohort to it, then re-running
`node scripts/verify-runtime` from the upgrade skill to cold-boot the plugin on
the target cohort.

The Cordis peer stays on the cohort's own floor (`^4.0.4` for `0.2.x`, matching
the community-standard plugins shipped for this line); the older `^4.0.1`
precision-checklist floor belongs to the `0.1.2-alpha` corridor and is not
applied here.

## Releasing

Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). While the project is
`0.x`, a minor release may change behavior; the changelog entry says so
explicitly.

| Bump | Use it for | Example |
| --- | --- | --- |
| `patch` (`X.Y.Z+1`) | fixes only: bugs, copy, docs, tests, internal cleanup; no contract change | `0.2.0 → 0.2.1` |
| `minor` (`X.Y+1.0`) | a new capability, or any change to the panel payloads, routes, tools, or skills — including a `0.x` breaking change | `0.1.0 → 0.2.0` |
| `major` (`X+1.0.0`) | reserved for breaking changes after `1.0.0` | — |

The release script does the mechanical part:

```sh
# 1. Write the changelog section and leave it uncommitted.
$EDITOR CHANGELOG.md

# 2. Cut the release: tests, bump, tag, push, and GitHub release notes.
npm run release -- patch        # or minor / major / 1.2.3
```

It refuses to run unless the working tree is clean apart from `CHANGELOG.md`,
the branch is `main`, the tag is free, and the changelog has a matching
`## [x.y.z]` section. Useful flags: `--dry-run` (validate and print the plan
without changing anything), `--no-push`, `--no-release` (the release step needs
`gh auth login`), and `--title "…"`.

Tag pushes run an extra CI job that fails when the tag and `package.json`
version disagree, so a mistyped release cannot pass unnoticed.

`npm publish` is not part of the script yet: run it after the release when the
package is being published, and keep the same version.

## Checks before a pull request

```sh
npm test
npm run typecheck
npm pack --dry-run      # confirms lib/, skills/, both READMEs, and LICENSE ship
npm run check:package   # asserts the tarball ships only those files
```

`npm run check:package` inspects the `npm pack --dry-run` output and fails when
the tarball would carry `src/`, `tests/`, `.github/`, `scripts/`, or build
sourcemaps; CI runs it with the rest of the checks, so the shipped package
contents are verified rather than assumed.

## Commit messages

Conventional Commits are appreciated (`feat:`, `fix:`, `docs:`, `test:`,
`chore:`), because they make the changelog mechanical.
