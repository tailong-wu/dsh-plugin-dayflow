# Patch plan: the 0.10.x line

> **Status: the 0.10.x line is open on the owner's 2026-11-27 answers, and this
> file is the line's plan — 0.10.0 remains in progress: its implementation round
> is complete (2026-11-27, still untagged; the tag waits on one recorded
> real-cloud smoke), and nothing is released from it.** The owner answered
> **D1 = `cloud`** (screen metadata may be analysed by a cloud provider),
> **D7 = `yes`** (npm publication is authorised),
> and **partially answered D2** (several custom models wanted, DeepSeek first;
> the A/B/C form is still the owner's to choose). That is enough to open the
> line, because the first patch needs no further decision:
> **0.10.0 — cloud analysis + multi-model selection (option A baseline), with
> the provider-setup documentation and first-npm-publish preparation that make
> the answer operable.** The line is **not** image admission (**D11** open),
> **not** the Phase 4 `source: owned` cutover (**D10** open), and **not** the
> owned-journal write path; none of those enters this plan. D2's **A baseline**
> is the only form this line commits: a named model list with exactly one active
> model per call. **B** (fallback) and **C** (custom `baseURL`) are deferred
> until the owner picks the form, and even C would keep credentials in the host
> profile, never in the plugin.
>
> **Baseline measured at `main` `844dd02` (post-`v0.9.2` docs tree, 2026-11-27);
> the plan and the §0.10.x roadmap section landed on `e4b143a` (`docs: open the
> 0.10 line for cloud analysis and model selection`), where the implementation
> round started:**
> **558** green tests (**557** at the `v0.9.2` tag, `ccac653`), schema **v10**,
> **18** panel routes (9 `GET` + 9 `POST`), **5** slash commands, **23** tools,
> **8** skills, **22 tags / 22 GitHub Releases**, **`v0.9.2` Latest**, and
> **no npm publication** — the registry answers **404** for
> `dsh-plugin-dayflow` and this machine is **not logged in** to npm
> (`npm whoami` → `ENEEDAUTH`). The line's first tag would be `v0.10.0`, the
> **23rd** tag and Release. D10 and D11 stay gated exactly as
> [`OWNER_DECISIONS.md`](OWNER_DECISIONS.md) records them, and 1.0.0 still waits
> on D10 and a real captured week.
>
> **The implementation round completed on `main` `0d8d3c8`** (feature commit
> `7de9aec`, docs commit `0d8d3c8`), and the tree measures **583/583** green
> (558 planning baseline + 23 implementation cases + the 2 quality-pass pipeline
> list-mode cases; 581 at the implementation head; the exact count at the cut),
> **typecheck, build, and `check:package` green**, **CI on `main` green**,
> package still
> **`0.9.2`**, **no tag and no npm publish**. The release preparation is
> [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md).
>
> **What this line is, in one sentence:** turn the cloud analysis path the owner
> just authorised into something a profile can actually configure — several
> named host models with one active model per call, a documented
> provider/credential setup that never stores a key in this repository, and one
> recorded real-cloud run — and prepare, but do not perform, the first npm
> publish. **Publishing is not part of the 0.10.0 patch:** it is a separate,
> owner-confirmed step after the tag, with the npm login precondition this
> machine does not yet meet.
>
> **Implementation round, 2026-11-27: complete — the patch remains in progress,
> untagged and gated.** The approved A-baseline shape is in the tree at
> `main` `0d8d3c8` (feature commit `7de9aec`, docs commit `0d8d3c8`) in three
> disjoint-file lanes — **host** (`src/config.ts`, `src/analyse/models.ts`,
> `src/analyse/status.ts`,
> `src/panel-contract.ts`), **client** (`src/client/insights.tsx`, `locale.ts`,
> `styles.ts`), and **docs** (`docs/CONFIGURATION.md`, `docs/PROVIDERS.md`,
> README pair, CHANGELOG) — with this file and [`ROADMAP.md`](ROADMAP.md)
> §0.10.x maintained in parallel. **Measured: 583/583 green tests** (558 planning
> baseline + 23 implementation cases + the 2 quality-pass pipeline list-mode
> cases; 581 at the `0d8d3c8` head; the cut records the exact count),
> **typecheck, build, and `check:package` green, and CI on `main` green**.
> **Not met: the real-cloud smoke's PASS record and the npm publish** — the
> smoke is the tag's hard gate; its executable form
> ([`scripts/cloud-smoke.mjs`](../scripts/cloud-smoke.mjs) with
> [`docs/SMOKE.md`](SMOKE.md)) is in the tree, but **no PASS run has been
> recorded**, so the gate is unmet. The publish is a separate post-tag step
> this machine cannot log in to yet. The patch is **not landed**: nothing is
> tagged, no npm publish has run, and the tag is the lead's decision only after
> the §3.9 gate order — including one `cloud-smoke.mjs` PASS recorded without a
> key (§3.7, C7) — is green. §3.9 now records the measured gates, keeps the tag
> gate and the publish preconditions, and points at the release preparation
> document [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md).
>
> **Last revised:** 2026-11-27, fourth revision: the implementation round is
> complete and the smoke gate is now executable. The first revision wrote the
> plan against `844dd02`; the second marked 0.10.0 **in progress** on `e4b143a`
> and aligned §3.3/§3.4 with the approved shape; the third recorded the
> implemented tree on `0d8d3c8`, the measured gates (583 tests, typecheck,
> build, `check:package`, CI), the two unmet gates (real-cloud smoke, npm
> publish), and the release preparation in [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md);
> this revision turns the smoke from a hand-written procedure into the
> provider-level tool [`scripts/cloud-smoke.mjs`](../scripts/cloud-smoke.mjs)
> with [`docs/SMOKE.md`](SMOKE.md). **Its tooling being ready is not the
> gate:** no PASS record exists, so the tag still waits. No tag, no publish, no
> landed record.

## 1. Starting point, measured

Facts checked against the repository, the tag list, the npm registry, and the
installed host on 2026-11-27. When an operation invalidates one, it updates this
table; the measurement is the basis the patch's acceptance assumes.

| Fact | Value | Checked at |
| --- | --- | --- |
| Baseline | `main` at **`0d8d3c8`** (`docs: document analysis model selection for 0.10.0`, the implementation round's docs commit; feature commit `7de9aec`), on top of the planning commit **`e4b143a`** (`docs: open the 0.10 line for cloud analysis and model selection`), which wrote this file and the §0.10.x roadmap section. The baseline measurement below was taken one commit before the planning commit, on **`844dd02`** (`fix(compat): correct the peer-count message in the metadata guard`, the post-`v0.9.2` docs tree). `v0.9.2` is an annotated tag on `ccac653`; the 0.9.x functional line closed at `v0.9.1` (`ce0827e`) | `git log`, `git tag`, `git status` (**clean at this revision**, 2026-11-27) |
| Round | **Implementation round, 2026-11-27: complete, untagged.** Three disjoint-file lanes completed on `main` `0d8d3c8` — host (`src/config.ts`, `src/analyse/models.ts`, `src/analyse/status.ts`, `src/panel-contract.ts`), client (`src/client/insights.tsx`, `locale.ts`, `styles.ts`; `data.ts` follows the type automatically), docs (`docs/CONFIGURATION.md`, `docs/PROVIDERS.md`, README pair, CHANGELOG) — with this plan and `docs/ROADMAP.md` §0.10.x maintained in parallel. The quality pass added two pipeline list-mode end-to-end cases in the working tree (suite at 583); the release preparation is [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md). **No tag, no publish, no landed record**; §3.9 pins the measured gates and the remaining hard gate | task board; `npm test` / `typecheck` / `build` / `check:package` on the implementation tree; `git status` |
| Release trail | **22 tags / 22 GitHub Releases**; **`v0.9.2` is Latest**; the 0.9 line's tags are exactly `v0.9.0` (`d0f9b5a`), `v0.9.1` (`ce0827e`), `v0.9.2` (`ccac653`), each with a Release. A `v0.10.0` cut would be the 23rd of each | `git tag`, `gh release list` |
| Tests | **583/583** green on the current tree (**581** at the `0d8d3c8` implementation head, **558** at the planning baseline, **557** at the `v0.9.2` tag; 0.10.0 adds 23 cases: 22 host/status/consent/config + 1 client copy, and the quality pass adds 2 pipeline list-mode cases; the cut records the exact count). CI runs macOS 15 with Node 24 and Node 22 (`--experimental-sqlite`) | `npm test` on the current tree, `.github/workflows/ci.yml` |
| npm | `npm view dsh-plugin-dayflow version` → **404** (name unclaimed, never published); `npm whoami` → **`ENEEDAUTH` / need auth** on this machine. `npm pack --dry-run` at `0.9.2`: **146 files**, 2.64 MB packed / 4.09 MB unpacked. `npm run release` bumps, tests, commits, tags, pushes, and creates the GitHub Release — it does **not** publish. The implementation tree's tarball audit is recorded in [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md) | `npm view`, `npm whoami`, `/tmp/dayflow-pack.json`, `scripts/release.mjs` |
| Host | The installed DSH app is **`0.2.2-rc.5`** (`CFBundleShortVersionString`); the declared cohort was realigned at 0.9.2 and verified. The host's model providers and credentials are configured **in the host profile** (`~/.dsh/profiles/<profile>/cordis.patch.yml`, e.g. `llm-pi-ai.providers` with `apiKeyEnv`), and the host's model service is what the plugin calls through `ctx.llm.stream()`; the host also stores credentials records. **The plugin stores no key and reads no environment secret.** Provider ids are host-owned: on this machine the agent default model is `deepseek-official`/`deepseek-flash` (measured 2026-11-27) | the app bundle, `~/.dsh/profiles/desktop/cordis.patch.yml`, `src/analyse/host.ts` |
| Analysis contract | **Text-only**: the analysis call sends the frontmost app, window title, and frame hash — **no pixels**; the scheduled closes send activity text only. `analysis.consent` ships **`none`**, and a `cloud`/`local` consent additionally needs an explicit provider **and** model: there is no implicit host default. Frame analysis uses `src/analyse/consent.ts`; the automation/briefs text path uses `src/automation/consent.ts`; both read the same resolved `analysis` block | `src/config.ts`, `src/analyse/consent.ts`, `src/automation/consent.ts`, `docs/CONFIGURATION.md` |
| Analysis configuration at the baseline | **One explicit pair** only: `analysis.provider: string` and `analysis.model: string`, both defaulting to `''`; the resolved config carries the pair, the consent gate returns `{allowed, provider, model}`, the pipeline records `provider`/`model` on the job, and the status payload reports the switches, budgets, worker state, and blocked reason — **not** which model would be called | `src/config.ts` (`AnalysisSchema`, `resolveConfig`), `src/analyse/status.ts` |
| What exists on the cloud path | The host adapter (`src/analyse/host.ts`), the pipeline and worker, the two consent gates, the job ledger with recorded model/token usage, the status route and panel analysis line, and the open/close/brief call sites. The path is exercisable today with a hand-written `consent: cloud` plus one provider/model pair | `src/analyse/**`, `src/automation/**`, `src/briefs/**`, `src/panel.ts` |
| What was missing (the gap 0.10.0 closes — implemented in this round) | (1) **No way to name more than one model** — closed by the named `analysis.models` list (one active entry per call); (2) **the provider page was written but not in list shape** — closed by the provider-page update to the implemented list shape; (3) **no recorded real-cloud run** — **still open**, and it is the tag's hard gate; (4) **no status line naming the model** the next call would use — closed by the additive optional `model` summary | repository grep at `0d8d3c8`, `src/**`, `docs/**` |
| Owner answers | **D1 = `cloud`** (answered 2026-11-27); **D2 = partially answered** — several custom models, DeepSeek first, **A/B/C form undecided** (A = named model list; A+B = list plus fallback; A+B+C = plus custom `baseURL`); **D7 = `yes`** — publish authorised, **not logged in, nothing published**; **D10/D11 = open** (explanations given; unanswered keeps the safe defaults) | [`OWNER_DECISIONS.md`](OWNER_DECISIONS.md), the owner's 2026-11-27 answers |
| Not in this line | Image admission (D11: no attachment peer, no `includeImages`, no `privacy_apps`, text-only), the Phase 4 cutover default (D10), the owned-journal write path, the `dsh dayflow import` CLI, and D2's B/C forms | [`OWNER_DECISIONS.md`](OWNER_DECISIONS.md), [`ROADMAP.md`](ROADMAP.md) §0.10.x |

**What the gap is, measured.** Today a profile can say "analyse with
provider P and model M" once: `resolveConfig` trims the pair, both consent gates
return it, and every analyser run and scheduled close uses that same pair. The
owner asked for **several custom models, DeepSeek first** and left the form open.
The minimum honest way to serve that answer is a **named list** the profile can
grow without rebuilding the single-pair contract: one list, one active entry per
call, the first entry as the default, and the existing pair still working
untouched when no list is configured. That is option A, and it is what this
plan commits. It needs **no new route, tool, command, skill, schema migration,
host peer, or runtime dependency** — it is a configuration shape plus one
additive status summary — but it does need the thing the current tree has never
had: a documented, key-less provider setup and one real run behind it.

**Why this line is a minor (`0.10.0`), not a `0.9.3` patch.** It adds a
configuration key (`analysis.models`) and an additive, optional `model` status
field, and it changes what a profile can
configure — a backwards-compatible addition under SemVer. A patch number would
advertise a maintenance change while the line actually turns on the analysis
path the owner authorised. `0.8.2` (image admission) and `0.8.3` (cutover) were
never started and are **not renumbered** by this line; they stay deferred behind
D11 and D10.

## 2. Iteration rules

The 0.7.x rules ([`PATCH_PLAN.md`](PATCH_PLAN.md) §2) hold unchanged and are not
restated here: **R1** one verifiable theme per patch, **R2** one integration
point and one tag per patch, **R3** migrations ride with their code, **R4** CI
never calls a model, captures the screen, or needs a permission, **R5**
default-safe or blocked on a decision, **R6** docs and CHANGELOG travel with the
tag, **R7** no read-path regression, **R8** rollback is config first, revert
second, **R9** one UI entry. The 0.9 line's P1–P6 were written for a
decision-free holding line; this line is **authorised functional work**, so they
apply only where restated below. What is specific to the 0.10 line:

**C1 — Answer-bounded only.** The line exists because D1 (`cloud`), D7 (`yes`),
and D2's direction (multiple custom models, DeepSeek first) were answered. It
implements the baseline that answers them and stops: **D10/D11 and D2's B/C
forms are out of scope**, and no patch on this line may smuggle an image, a
cutover default, a new write path, or a new entry point in alongside the theme.
If 0.10.0 turns out to need one of those, it stops before implementation and the
question returns to the owner.

**C2 — The multi-model list is additive; the single pair is frozen.** With
`analysis.models` absent or empty, the resolved configuration, the two consent
gates, the job ledger, and every existing status field behave **exactly** as at
`v0.9.2`, including the `provider-unset`/`model-unset` reasons and "no implicit
host default"; the new `model` summary is absent in that mode, not a behaviour
change. The list is a new, opt-in shape that resolves to the same
`{provider, model}` pair the code already consumes, so the call path does not
fork.

**C3 — No secret enters this repository, and the plugin never holds one.** The
owner has pasted a key in chat; **no real key, token, cookie, or credential
appears in any doc, plan, profile example, test, log, or commit on this line.**
Provider credentials are referenced by the **host profile** through `apiKeyEnv`
(a credential reference the host resolves — against its credential store, launch
environment, or `.env`) or through the host's credentials record; the plugin's
own configuration must never grow an `apiKey`, `apiKeyEnv`,
`token`, or `credentials` field, must never read such an environment variable,
and must never echo one into status, errors, jobs, or logs. Docs use env-var
names and `<provider-id>`/`<model-id>` placeholders only, and recommend
rotating any key that was ever shared in a chat, because a chat paste is a
disclosure even when nothing is committed.

**C4 — The default stays inert; cloud is explicit.** The shipped profile is
unchanged: `analysis.consent` remains `none`, the pair remains empty, the list
defaults to `[]`, capture remains off, and a default profile makes no model call
and sends nothing. Only a profile that explicitly sets `consent: cloud` (or
`local`), a complete entry, and capture/analysis on can call out — and because
**D11 is open**, that call is still **text-only** (frontmost app, window title,
frame hash; activity text for the closes), never an image.

**C5 — The status change is one additive, optional field.** The analysis status
payload gains one `model` object — `{id?, provider, model, label?}`, present only
when a complete effective pair is configured; an older client that never reads it
is unaffected and the patched client tolerates its absence. No other payload
field changes meaning, no route is added (**18** stays), and the panel keeps its
one entry point.

**C6 — Contract freeze for everything else.** The diff may change the
configuration schema (the new key), the resolved config, the selection helper,
the status payload (the additive field), its client rendering/copy, tests, and
docs — and nothing else. **No schema migration (stays v10), route (18),
command (5), tool (23), skill (8), host peer, runtime dependency, default, or
model-call contract changes**, and `package.json` changes only its version at
the release commit.

**C7 — Real-cloud verification is executable, provider-level, and its evidence
never contains a key.** CI keeps its fake-host seam and never reaches the
network (R4 stays true). The one real run 0.10.0 needs is one invocation of
[`scripts/cloud-smoke.mjs`](../scripts/cloud-smoke.mjs), whose procedure and
boundary are in [`docs/SMOKE.md`](SMOKE.md): it drives the real, already-built
analysis prompt/analyser/retry/usage path against the owner's real
OpenAI-compatible provider and validates the answer JSON. It is **provider-level
only** — not the DSH host/capture chain — so it proves no captured window, job
row, or activity row, and neither this plan nor the docs claim those. The
evidence recorded for the gate is the provider label, the endpoint host, the
model id, latency, the token counts, the validity result, a **≤500-character**
answer preview, and the `git` HEAD — never the key, the request body's secret,
or a `.env` file.

**C8 — Publishing is a separate, confirm-first act.** D7 authorises the
publication; it does not authorise an unattended or automatic one. Nothing in
0.10.0 publishes: the release script stays tag/Release only, and the npm step is
run after the tag by the lead **only after the owner confirms the exact version**
and the machine is logged in. If that precondition is unmet, the version stays
unpublished and the GitHub tag/Release is still a complete release.

**C9 — Tests first, on the fake seam.** Every behaviour on this line is testable
without a network, a model, a screen, or a permission: the selection helper and
config validation are pure, both consent gates are pure, the status payload is
pure, and the host adapter's fake already exists. The new cases land before the
implementation.

## 3. The patch

### 3.1 Summary

| Patch | Theme | Roadmap item | Status |
| --- | --- | --- | --- |
| 0.10.0 | **Cloud analysis + multi-model selection (option A baseline), provider setup, and first-npm-publish preparation.** A named `analysis.models` list (`{id, provider, model, label?}`) with exactly one active entry per call (first entry by default, `analysis.model` selects an entry id); the legacy pair still works untouched when the list is empty; both the frame-analysis gate and the automation/briefs gate call the active pair; the analysis status line reports the active model through the additive optional `model` field on the analysis status payload (its label when present, otherwise `provider/model`; the entry `id` rides along in list mode); the provider page `docs/PROVIDERS.md` (written in the planning round) is updated for the named list, `apiKeyEnv`-or-credentials setup, rotation, and the text-only cloud disclosure; one recorded provider-level real-cloud smoke (§3.7) evidences the provider path. **No** schema, route, command, tool, skill, peer, runtime dependency, image, or cutover change; npm publish is prepared but not performed | Phase 3.6 (cloud analysis and its honest privacy copy) + Native port analysis line; owner answers **D1 = cloud**, **D2 partially answered (multi-model direction)**, **D7 = yes (publish authorised)** | **in progress — implementation complete, untagged (2026-11-27) on `main` `0d8d3c8`; 583 tests, typecheck/build/`check:package` green; no tag and no publish — the cut waits on §3.9's hard gate; the provider-level smoke tool is ready ([`scripts/cloud-smoke.mjs`](../scripts/cloud-smoke.mjs), [`docs/SMOKE.md`](SMOKE.md)) but no PASS record exists yet; release preparation in [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md)** |

### 3.2 0.10.0 — what it is and what it is not

**Goal.** A profile can list several host models once, name one as the active
entry (or accept the first), and have every analysis call — frame analysis, the
scheduled day/week closes, and the briefs path — use that one entry, with the
panel and `GET /api/dayflow/analysis/status` saying which entry is active. A
profile can still set the old single pair and see no change at all. The setup is
documented end to end, including where the provider and its `apiKeyEnv`/
credential live (the host profile), how to rotate a key, and what actually
leaves the Mac (text metadata only, never pixels).

**Not in 0.10.0, by design:** fallback to the next entry (B) or a custom
`baseURL` (C) — both wait on D2's form; image analysis (D11); any cutover default
(D10); the `dsh dayflow import` CLI; the owned-journal write path; a new route,
command, tool, skill, schema step, or host peer; and **the npm publish itself**
(it is a separate step after the tag, see §4).

### 3.3 Configuration: the named model list (A baseline)

**Shape.** `analysis.models` is an optional array of named entries; each entry
names a **host-registered provider** and a model id, plus an optional
human label:

```yaml
- id: dayflow
  config:
    analysis:
      consent: cloud          # stays explicit; the default is still none
      models:
        - id: deepseek-flash  # the active-entry selector; unique
          provider: <provider-id>   # a provider the host profile exposes
          model: <model-id>
          label: DeepSeek Flash     # optional, shown in the panel
        - id: deepseek-pro
          provider: <provider-id>
          model: <model-id>
      model: deepseek-flash   # optional selector; empty = first entry
```

**Resolution and precedence (the rule the tests pin):**

1. `analysis.models` is absent or `[]` → **the legacy shape**: the effective
   call pair is the trimmed `analysis.provider` + `analysis.model`, exactly as
   at `v0.9.2`; both empty still blocks with `provider-unset`/`model-unset`;
   there is no implicit host default.
2. `analysis.models` is present with 1–8 entries → the effective call pair is the
   **active entry**, resolved as follows:
   - `analysis.model` empty → the **first entry** in written order is active;
   - `analysis.model` non-empty → it must name an entry's **`id`**, trimmed and
     case-insensitive; the matched entry is active;
   - `analysis.model` matches no entry id → a configuration error at load
     (`invalid_input`) that names the unknown id and lists the known ids; it is a
     load error, not a silent skip, because a typo must not quietly select
     another model.
3. When `analysis.models` is present, **`analysis.provider` must be empty**: each
   entry carries its own provider. A non-empty provider is a configuration error
   (`invalid_input`) saying the list carries providers and the legacy field must
   be removed — the alternative (silently ignoring one of the two) is the kind of
   ambiguity this patch exists to avoid.
4. The **resolved** config keeps `provider`/`model` as the **effective call
   pair** (the active entry's trimmed ids), so both consent gates, the pipeline,
   the job ledger, the automation call sites, and their tests continue to
   consume the same fields they do today. It additionally exposes the normalized
   `models` list and the selected `modelId` — the active entry's id; both keys
   are absent in the legacy shape, keeping that resolved configuration
   byte-identical — and the status builder derives the nested `model` summary
   (`{id?, provider, model, label?}`) from them. The input's `analysis.model` is
   a selector only in mode 2; the resolved `analysis.model` is always the
   effective model id.

**Validation.** Each entry requires a non-empty `id` (trimmed, at most 64
characters), a non-empty `provider`, and a non-empty `model` (both trimmed);
`label` is optional, trimmed, at most 80 characters. `id` values are unique
case-insensitively. The list is bounded at 8 entries. Every failure is a
`DayflowError` with the `invalid_input` code and a message naming the offending
field, the entry index (and id when present), and — for an unknown selector —
the known ids, matching the way `resolveConfig` already rejects an explicitly
wrong value. Error messages never echo a credential (there is none to echo).

**Files.** The schema, types, and resolution belong in `src/config.ts`; the pure
selection/normalization helper belongs in a new `src/analyse/models.ts` (it
imports only the error class from `../errors.ts`, so `config.ts` importing it
creates no cycle) and is reused by the status builder. The two consent gates need
**no decision logic change**: they keep reading the resolved effective pair, and
their branch order and reason strings stay frozen (C2). Their tests gain the
named-list cases.

### 3.4 Runtime and status

- **Call path.** `src/analyse/pipeline.ts` and its callers keep using the consent
  decision's `{provider, model}`; with a named list that is the active entry, so
  the frame path needs no call-site change. The status builder
  (`src/analyse/status.ts`) gains the additive optional `model` summary and
  keeps its no-journal pure read. `src/analyse/consent.ts` and
  `src/automation/consent.ts` are unchanged in behaviour: the effective pair is
  the entry's pair, `consent: none` still blocks, and a `local` consent still
  requires the active entry's provider to be on `analysis.localProviders` on the
  **frame path** (the automation text gate deliberately does not read that
  allowlist, exactly as today; a named-list entry is never automatically
  "local"). Only the **active** entry is gate-checked, so a list may mix
  providers, but under `consent: local` switching the frame path to a
  non-allowlisted entry blocks with `consent:provider-not-local` exactly as the
  single pair does today.
- **Automation and briefs.** The scheduled day/week closes and the briefs path
  call `decideTextAnalysis` (`src/automation/consent.ts`) on the same resolved
  block, so they use the selected entry as well; the job ledger already records
  the provider and model per call, so the landed record can evidence which entry
  ran. No call site changes beyond typing.
- **Status payload.** `AnalysisStatusPayload` gains one additive, optional
  field: `model?: { id?: string; provider: string; model: string; label?: string }`,
  present only when a complete effective pair is configured (the active named
  entry, or the legacy pair). `id` rides along only in list mode, and `label`
  only when the entry wrote one; the legacy pair's summary is `provider`/`model`
  alone. It is absent when no complete pair exists, so an unconfigured profile's
  payload is exactly the pre-0.10 payload and an older client that never reads
  the field is unaffected. The existing fields (switches, consent, worker,
  ledger counts, budgets, `reason`) are unchanged; no other payload changes.
- **Panel.** `src/client/insights.tsx` shows the active model quietly on the
  existing analysis line — the entry's label when present, otherwise
  `provider/model`, prefixed by the consent destination word (`cloud · …` or
  `local · …`; a plain `Model …` when consent is unset) — with no button, no
  fetch, and no second control surface (R9/C5). `src/client/locale.ts` gains the
  three copy keys in **both** EN and ZH (the existing parity and copy tests
  cover it); `src/client/data.ts`'s `AnalysisStatusSummary` follows the contract
  type automatically; `src/client/styles.ts` reuses the existing `--dsw-*`
  tokens.
- **Default profile.** The shipped `cordis.patch.yml` is **not** changed: no
  `models`, no provider/model, `consent: none`. Documentation shows the profile
  example, not the shipped default.

### 3.5 Documentation that travels with the tag

- **`docs/PROVIDERS.md` (written in the planning round; updated by this
  patch).** The page the gap was missing already exists from `e4b143a`: how a
  host provider is set up in the **host profile** (the
  `llm-pi-ai.providers`-style entry with `apiKeyEnv`, or the host credentials
  record), how to rotate/revoke a key, and the honest disclosure: cloud analysis
  sends the frontmost app, window title, and frame hash (and activity text for
  the closes) to the provider — **no pixels while D11 stays open** — plus the
  existing 3.6 limitation copy that a window-level rule cannot see inside a
  browser tab or document. This patch updates its status line from "planned" to
  the implemented list shape and adds how to name entries in `analysis.models`,
  how `analysis.model` selects the active entry, and how the legacy pair still
  works. Placeholders and env-var names only; no credential value anywhere.
- **`docs/CONFIGURATION.md`.** The analysis key table gains `analysis.models`
  (and the selector meaning of `analysis.model` in list mode), with a worked
  two-entry example and the precedence rule; the provider/model rows stay for
  the legacy shape.
- **`README.md` / `README.zh.md`.** The status banner and the analysis section
  stop describing the five decisions as wholly unanswered: D1/D7 answered, D2
  partial, 0.10.0 implemented but untagged; the config snippet points at
  `docs/PROVIDERS.md`. The install section keeps "from a checkout" until a
  publish actually happens (see §4) and is updated by the post-publish docs
  commit, not silently in the tag.
- **`CHANGELOG.md`.** `[Unreleased]` → `[0.10.0]` at the cut, honestly listing
  the new config key, the additive `model` status field, the provider docs, the
  verification run, and that npm is still unpublished unless §4 has run.
- **`docs/ROADMAP.md`** §0.10.x and this file's landed record are corrected in
  place after the tag, as the 0.9 patches did. **`docs/OWNER_DECISIONS.md`** is
  already updated for the answers in this planning round; the implementation
  round does not re-answer anything.

### 3.6 Tests (all on the existing fake seams)

| File | What it pins |
| --- | --- |
| `tests/config.test.ts` (new; the round names the new test file this instead of `tests/config-analysis-models.test.ts`) | Default `models: []`; legacy pair resolution byte-identical to `v0.9.2`; first-entry default; `analysis.model` id selection (case-insensitive); empty selector = first; unknown id → `invalid_input` naming the id and known ids; duplicate id; incomplete entry (missing/blank `id`/`provider`/`model`); list + non-empty `analysis.provider` conflict; 1–8 bound; label/id trimming; no key field is read into or echoed by the resolved config |
| `tests/analyse-consent.test.ts` (extend) | The frame gate returns the active entry's pair; `consent: none` still blocks; `local` consent still rejects a non-allowlisted active provider; legacy branch reasons unchanged |
| `tests/analyse-status.test.ts` (extend) | The additive optional `model` summary: `provider`/`model` for the legacy pair, plus the entry's `id` (and `label` when written) in list mode; the whole summary absent when unconfigured; ledger fields unchanged |
| `tests/analyse-pipeline.test.ts` (extend) | The fake host receives the selected provider/model for a window; job records the selected model; no call under `consent: none` |
| `tests/automation-insights.test.ts` / `tests/briefs.test.ts` (extend) | A scheduled close / brief uses the selected entry's pair (the text gate resolves the same effective pair); blocked reasons unchanged |
| `tests/panel.test.ts` / `tests/panel-insights.test.ts` / `tests/client-format.test.ts` (extend) | The status route carries the additive `model` summary; the three panel copy keys exist in EN and ZH with parity; no new route (still 18) and the old payload without the field parses |
| `tests/compatibility.test.ts` | Unchanged in substance: no new peer/dependency; the metadata guard stays green. **No test case is removed or weakened**; the cut records the new count |

**Round split (2026-11-27).** The implementation lanes carried the config,
consent, and status cases (host) and the client copy case (client); the
pre-existing pipeline, automation, briefs, and panel cases already assert that
the resolved pair is exactly what reaches the gates and the fake host, so they
kept passing unchanged and the cut confirms them rather than rewriting them. The
list-mode end-to-end assertion anticipated here became two pipeline cases
(`tests/analyse-pipeline.test.ts`: a selected second entry and the default first
entry) in the quality pass, taking the suite to **583**; no acceptance
item is dropped.

### 3.7 Acceptance

- **Suite and gates, in this order (all green before the tag):** `npm test`
  green at **583** cases (the 558 planning floor; 581 at the implementation
  head; the two quality-pass pipeline list-mode cases take it to 583; the cut
  records the exact count, with no case removed or weakened),
  `npm run typecheck`,
  `npm run build` (host and client bundle), `npm run check:package`, and the
  secret scan of the diff and the packed tarball; both CI legs (Node 24,
  Node 22) green on the pushed branch.
- **Default inert:** a default profile resolves `consent: none`, `models: []`,
  empty pair; no analysis call, no scheduled close call, no model call of any
  kind, and the status reason is the same `consent:none` line as before.
- **Cloud only when configured:** a profile with `consent: cloud` and a named
  entry allows analysis and the closes, and the fake host sees the active
  entry's provider/model; a profile with the legacy pair alone behaves exactly as
  at `v0.9.2`; a profile with an unknown selector or a list/provider conflict
  fails at load with a clear `invalid_input` message.
- **One active model everywhere:** the frame path, the scheduled closes, and the
  briefs path all use the same resolved active entry (asserted on the fake host
  request bodies and the recorded job rows).
- **Status:** `/api/dayflow/analysis/status` answers the additive optional
  `model` summary (`provider`/`model`, plus `id` in list mode and `label` when
  the entry wrote one; absent when no complete pair is configured); an old
  payload without the field still parses; the panel renders it read-only; no new
  route, tab, button, or fetch (**18** routes stay).
- **No secret:** no real key in the diff, docs, examples, tests, or committed
  profile; the only key-like string in the tree remains the deliberately fake
  `FIXTURE_LLM_SECRET` in `tests/fixtures/database.ts`, which never leaves the
  fixture and is clearly not a credential; docs use `apiKeyEnv`/credentials
  references and placeholders; a rotation note is present for any key shared in
  chat.
- **Real-cloud smoke — the tag gate, now executable:** the gate is one run of
  [`scripts/cloud-smoke.mjs`](../scripts/cloud-smoke.mjs), with the procedure in
  [`docs/SMOKE.md`](SMOKE.md). It is a **provider-level** smoke, and that
  boundary is part of the gate: after `npm run build` it builds the real
  analysis prompt from the built `lib/` modules, calls the owner's real
  OpenAI-compatible provider with the configured model through
  `callAnalysisModel`'s real retry/timeout/usage accounting, and validates the
  answer as one JSON object with `title`/`summary`/`category`/`confidence`. It
  does **not** run the DSH host/capture chain, so it proves the provider path —
  not a captured window, an `analysis_jobs` row, or an activity row — and
  [`docs/SMOKE.md`](SMOKE.md) says so; the plan claims no more.
  **Command:** `node scripts/cloud-smoke.mjs` with `SMOKE_API_KEY` (or
  `DEEPSEEK_API_KEY`), `SMOKE_BASE_URL`/`SMOKE_MODEL` or `--base-url`/`--model`,
  and `--record <path>` for the evidence file at a repository-external path.
  **PASS only if** the run exits 0 with a valid answer and the record is
  written, from a **clean** checkout of the commit to be tagged
  (`gitDirty: false`, so the record's `gitHead` names that commit): the
  provider label and endpoint host, model, latency, input/output tokens,
  validity, a **≤500-character** answer preview, and `git` HEAD — **never the
  key**, which the tool does not print. **If the run does not PASS, or no PASS record
  exists, 0.10.0 is not tagged** — the code may be reviewed, but the tag waits,
  because this verification is the point of the line; the tag is the lead's
  decision after the PASS record, not before.
- **Diff proof:** the diff adds only the `analysis.models` key, the selection
  helper, the additive `model` status field, its copy/rendering, tests, and docs;
  schema stays **v10**, routes **18**, commands **5**, tools **23**, skills
  **8**, peers and runtime dependencies unchanged, and no image/cutover/write
  surface appears.
- **Release:** `v0.10.0` is tagged with one GitHub Release from the CHANGELOG
  section (the 23rd of each) **only after the real-cloud smoke's PASS record
  exists and the gates above are green**; npm publish is the separate,
  owner-confirmed step in §4 and is **not** part of the tag. **The tag is not
  pre-written:** this plan and §0.10.x say "implemented, untagged" until the
  lead cuts it.

### 3.8 Deferred explicitly

| Deferred item | Why it waits | Re-entry condition |
| --- | --- | --- |
| **B** — fallback to the next entry on a provider/call failure | It changes cost and privacy semantics (a second cloud call for the same window), and "fallback" needs a retry/abort/budget contract; the owner has not chosen the form | The owner answers D2's form (A only, A+B, or A+B+C) and the retry semantics are specified |
| **C** — per-entry custom `baseURL` | A plugin-managed endpoint would also be a place to smuggle a credential; the safe shape is a **host-profile provider** with `apiKeyEnv`, referenced by the entry, not a plugin-stored URL+key | D2's form includes C; even then the host profile owns the endpoint and the key |
| **D11 — image admission** | Owner decision open; a vision-capable entry is not the same as admitting pixels, and the attachment peer/`includeImages`/`privacy_apps` contract does not exist | An explicit D11 = yes with size/retention caps and `privacy_apps` |
| **D10 — Phase 4 cutover** | Owner decision open; needs the real captured week | An explicit D10 = yes plus the real-week record |
| The `dsh dayflow import` CLI | A new entry surface (5 → 6 commands) belonging beside the cutover's no-Dayflow runbook | The cutover line |
| The owned-journal write path | A new write surface the roadmap deliberately leaves with Dayflow for now | A later line, with the owner |
| The npm publish itself | D7 = yes authorises it; the machine is not logged in and the version needs the owner's explicit confirmation | §4's preconditions met |

### 3.9 This round: in progress (implementation complete, untagged) — measured gates, release preparation, publish preconditions

**Status.** 0.10.0 remains **in progress**: its implementation is **complete**
on `main` `0d8d3c8` (implementation commit `7de9aec`, docs commit `0d8d3c8`),
and the patch is **not landed and not tagged**. The approved A-baseline shape — the named
`analysis.models` list, the legacy pair frozen when the list is empty, the
additive optional `model` status summary, the client line, the provider-page
update, the tests, and the docs — is in the tree. The CHANGELOG entry stays
`[Unreleased]`, [`ROADMAP.md`](ROADMAP.md) §0.10.x says
implemented-but-untagged, and the tag is the lead's decision after the gate
order below. **Two gates are still unmet:** the real-cloud smoke's PASS record
(C7) — the gate's executable form,
[`scripts/cloud-smoke.mjs`](../scripts/cloud-smoke.mjs) with
[`docs/SMOKE.md`](SMOKE.md), is now in the tree, but **tooling ready is not the
gate and no PASS has been recorded**, so the tag's hard gate stays unmet — and
the npm publish, which is a separate post-tag step that additionally needs a
login this machine does not have. The release
preparation — preconditions, steps, failure/repair rules, security notes, and
the fill-in record — is written in [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md).

**Gates measured on the current tree (2026-11-27).**

| # | Gate | Result |
| --- | --- | --- |
| 1 | `npm test` | **green — 583/583** (558 planning baseline + 23 implementation cases + the 2 quality-pass pipeline list-mode cases; 581 at the `0d8d3c8` head), and the cut records the exact count |
| 2 | `npm run typecheck` | **green** |
| 3 | `npm run build` (host + client bundle) | **green** |
| 4 | `npm run check:package` | **green**; the packaged tarball file-list audit is recorded in [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md) |
| 5 | CI on `main` (Node 24 + Node 22) | **green** |
| 6 | Default inert (C4) | asserted by the suite (default `consent: none`, `models: []`, empty pair, no call, text-only unchanged); re-confirmed at the cut |
| 7 | No secret (C3) / contract proof (C6) | the implementation diff is confined to the declared files below; the diff and packed-tarball secret scan are re-run at the cut |
| 8 | Real-cloud smoke (C7) — **the tag gate** | **not met** — the executable provider-level smoke is in the tree ([`scripts/cloud-smoke.mjs`](../scripts/cloud-smoke.mjs), [`docs/SMOKE.md`](SMOKE.md)), but no PASS `--record` exists yet; tooling ready does not satisfy the gate, so 0.10.0 stays untagged |
| 9 | npm publish | **not met** — a separate post-tag step; `npm whoami` fails and the owner's version confirmation is outstanding ([`PUBLISH_PLAN.md`](PUBLISH_PLAN.md)) |

**File-level scope (this round).**

| Area | Files | Change |
| --- | --- | --- |
| Config / resolution | `src/config.ts` | `analysis.models` in `AnalysisSchema`; entry normalization and validation; `ResolvedAnalysisConfig.models` and `modelId`; the legacy pair byte-identical when the list is empty; `invalid_input` on every failure |
| Models helper | `src/analyse/models.ts` (new) | Pure `resolveAnalysisModels(...)`: normalize, bound, dedupe ids, select the active entry; returns the normalized list, the effective pair, and `modelId`; no I/O, no key field |
| Status | `src/analyse/status.ts`, `src/panel-contract.ts` | Additive optional `model?: { id?, provider, model, label? }` summary, present only when a complete pair is configured; pure read unchanged; contract comment updated; no other payload change |
| Client | `src/client/insights.tsx`, `src/client/locale.ts`, `src/client/styles.ts` (`src/client/data.ts` needs no edit: its `AnalysisStatusSummary` alias follows the contract type) | One read-only analysis line: the entry's label when present, otherwise `provider/model`, behind the consent destination word (`cloud · …` / `local · …`), and the existing needs-config copy when no pair is set; three EN+ZH copy keys with parity; no button, route, fetch, or second control surface |
| Docs (travel with the tag) | `docs/CONFIGURATION.md`, `docs/PROVIDERS.md`, `README.md`, `README.zh.md`, `CHANGELOG.md`, `docs/ROADMAP.md`, this file | `models` row and two-entry example; the provider page updated from "planned" to the implemented list shape; README status/config snippet; `[Unreleased]` entry; the roadmap implemented-but-untagged mark; landed wording only after the tag |
| Tests | `tests/config.test.ts` (new), `tests/analyse-consent.test.ts`, `tests/analyse-status.test.ts`, `tests/client-format.test.ts`, `tests/panel-insights.test.ts`, `tests/analyse-pipeline.test.ts` (list-mode end-to-end, quality pass) | Default/legacy/first-entry/id-selection/error/status/copy cases on the fake seams, plus the list-mode pipeline cases; **no case removed or weakened**; 583 measured (558 planning floor) |
| Release preparation (new, outside the tag) | `docs/PUBLISH_PLAN.md` (new) | npm preconditions, the step sequence, failure/repair rules, rollback, security, tarball/secret checks, and a fill-in record; docs only — no code, no publish, no tag |
| Untouched (C6) | `src/analyse/pipeline.ts`, `src/analyse/consent.ts`, `src/automation/consent.ts`, the route table, the journal schema, `package.json` (version only at the cut) | No logic change; both gates keep consuming the resolved pair; schema **v10**, routes **18**, commands **5**, tools **23**, skills **8**, peers and runtime dependencies unchanged; no image, cutover, write path, or npm publish |

**Gate order at the cut (all before the tag; the lead runs the cut).**

1. `npm test` green at **583** (558 planning floor; 581 at the implementation
   head; 583 with the two quality-pass pipeline cases; the exact count
   recorded, no case removed or weakened) and both CI legs
   (Node 24, Node 22) green on the pushed branch — green on `main` today.
2. `npm run typecheck` green — measured green.
3. `npm run build` green (host and client bundle) — measured green.
4. `npm run check:package` green, with the `npm pack --dry-run` file list
   reviewed (no `src/`, `tests/`, `scripts/`, `node_modules/`, `.map`, `.tgz`,
   or secret material) — measured green; the tarball audit is recorded in
   [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md).
5. **Default inert (C4):** a default profile resolves `consent: none`,
   `models: []`, an empty pair, and the same `consent:none` reason; no model
   call and no egress of any kind; the analysis contract stays text-only while
   D11 is open — asserted by the suite and re-confirmed at the cut.
6. **No secret (C3):** the diff, docs, examples, tests, and tarball carry no
   real key; only the deliberate `FIXTURE_LLM_SECRET` fixture remains; the
   rotation note for any key shared in chat is present — **re-run at the cut**.
7. **Contract proof (C6):** every changed file is in the table above; schema
   v10, 18 routes, 5 commands, 23 tools, 8 skills, peers and runtime
   dependencies unchanged; no image, cutover, or write surface appears —
   re-checked at the cut.
8. **Real-cloud smoke (C7) — the tag gate: not met.** The executable
   provider-level smoke is ready
   ([`scripts/cloud-smoke.mjs`](../scripts/cloud-smoke.mjs),
   [`docs/SMOKE.md`](SMOKE.md)): after `npm run build`, from a **clean**
   checkout of the commit to be tagged (`gitDirty: false`), run
   `node scripts/cloud-smoke.mjs --record /tmp/dayflow-cloud-smoke-<date>.json`
   against the owner's real provider and require **exit 0 / PASS** plus the
   record — the provider label and endpoint host, model, latency, token counts,
   validity, and a **≤500-character** answer preview, never the key. **0.10.0 is
   not tagged until that PASS record exists**; the boundary is provider-level
   (no capture chain, no job/activity row claim), and the implementation being
   green on the fake seam is not a substitute.
9. **Tag:** only then `v0.10.0` with one GitHub Release from the CHANGELOG
   section (the 23rd of each); landing wording is written afterwards, never
   before.

**npm publish preconditions (after the tag; a separate step, §4).** D7 is
answered `yes`, but the act is not part of the patch and every precondition must
hold: the owner confirms the exact version (`0.10.0`) and public name in
writing; `npm whoami` succeeds (`npm login` with 2FA, or a granular token
outside the repository) — **currently unmet**; the name is still unclaimed;
the tagged commit re-runs the gates and `npm publish --dry-run` is reviewed;
then the public `npm publish`, verification of the registry and dist-tags, and
the recorded integrity/file count in a docs commit (no new tag). If any
precondition is unmet, the GitHub tag/Release stands and the version stays
unpublished — recorded honestly. The full sequence, the failure/repair rules,
and the fill-in record are collected in [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md);
the recommended first-publish version remains **0.10.0**, and the `0.9.2`-first
alternative and its cost are in §4.

**What is deliberately not written here:** no landed record, no tag, no
publish, and no "cloud verified" claim until the smoke succeeds; D2's B/C
forms, D10, and D11 stay deferred exactly as §3.8 and
[`OWNER_DECISIONS.md`](OWNER_DECISIONS.md) record them.

## 4. Release strategy: 0.9.2 first, or 0.10.0 first?

D7 is answered **yes**, so publication is authorised. It is **not done**: the
registry answers 404, `npm whoami` needs auth, and the release script does not
publish. This section recommends the order; the actual `npm publish` needs the
owner to confirm the exact version (C8) and must not be automated into the tag.
The 2026-11-27 implementation round changes none of this: **0.10.0's
implementation is complete and neither publish precondition is met yet** (no
npm login, no owner version confirmation). The tag gate and the post-tag publish
preconditions are recorded in §3.9, and the release preparation document
[`PUBLISH_PLAN.md`](PUBLISH_PLAN.md) carries the step-by-step form; nothing in
this section is performed by the patch.

**Recommendation: publish `0.10.0` first, as the package's first npm release.**

- **The first npm version should be the one the answers were about.** `0.10.0`
  is the first release that carries cloud analysis with the multi-model
  configuration D1/D2 authorised, and it ships the provider setup/rotation
  documentation. `0.9.2` is a maintenance tag whose tarball is functionally
  almost `0.9.1` (the compatibility declaration and dev toolchain only), so
  publishing it first would make npm's debut a version that cannot do the thing
  the owner just decided to allow — and it would not prove the cloud path either.
- **Fewer irreversible publish operations.** An npm version is effectively
  permanent (unpublish is restricted; the safe repair is `npm deprecate` plus a
  forward patch). One reviewed publish of the line's real release is better than
  a maintenance dry run followed by the real one.
- **One release story.** The tag, the GitHub Release, the CHANGELOG section, and
  the npm version would all name `0.10.0`; there is no second version with its
  own story to maintain.
- **No ordering trap.** If `0.9.2` were published first and `0.10.0` later, the
  two publishes must happen in that order (`npm publish` moves the `latest`
  dist-tag forward by default; publishing an older version after `0.10.0` would
  move `latest` backwards and needs `--tag` surgery). Publishing only `0.10.0`
  avoids that entirely.

**When `0.9.2` first would be the better choice (and how to do it).** If
`0.10.0` is more than a few days away and the owner wants the `dsh-plugin-dayflow`
name claimed on npm sooner (it is unclaimed today, and names can be taken), or
wants a real end-to-end rehearsal of the registry step before the functional
release, then publish `0.9.2` first — **from the existing `v0.9.2` tag**, with no
new tag, no version bump, and no code change: `git checkout v0.9.2`, clean
install, re-run the gates, publish that tarball (it is the same 146-file package
shape recorded at `/tmp/dayflow-pack.json` today), verify `0.9.2` on the
registry, and only then publish `0.10.0` when it is tagged. The cost is one
extra permanent version whose only role is name-claiming and registry rehearsal;
the benefit is that the name is secured now. This plan still recommends
`0.10.0`-first unless the owner wants the name claimed immediately.

**Blocking preconditions for either order (all must be true):**

1. **Owner confirmation of the version and the public name** — a one-line
   "publish 0.10.0" is enough; D7's yes is authorisation, not the per-release
   confirmation, and `npm publish` cannot be undone cleanly.
2. **`npm whoami` succeeds** — met with `npm login` (interactive, 2FA prompt) or
   a granular npm token supplied through the environment (e.g. `NODE_AUTH_TOKEN`)
   or an `.npmrc` **outside the repository**. A token is never committed, never
   put in a profile, never pasted into docs or chat, and never exported into a
   test log. **The machine is currently not logged in**; this is the one unmet
   prerequisite.
3. **The package name is still unclaimed** — today 404; re-check
   `npm view dsh-plugin-dayflow version` immediately before publishing.
4. **The tarball is reviewed and gated** — `npm run build` (prepack),
   `npm pack --dry-run` contents reviewed (no `src/`, `tests/`, `.test-build/`,
   `scripts/`, `node_modules/`, `.map`, `.tgz`, or secret material;
   `npm run check:package`), at 0.9.2: 146 files / 2.64 MB packed. The 0.10.0
   count is recorded at its cut (the docs additions add a few files because
   `docs/` ships); the implementation tree's audit is recorded in
   [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md).
5. **The release commit/tag is final** — for `0.10.0`-first, the tag is already
   cut from the green tree; publishing happens from the tagged commit, not from
   a dirty tree, so the registry artifact matches the GitHub Release.

**Publish sequence (after the above):** from the tagged commit on a clean tree —
`npm ci`, `npm test`, `npm run typecheck`, `npm run build`,
`npm run check:package`, `npm publish --dry-run` (confirm the file list and that
`package.json` version matches the tag), then `npm publish` (public, default
`latest` tag, 2FA prompt). Verify `npm view dsh-plugin-dayflow version` and
`npm view dsh-plugin-dayflow dist-tags` name the just-published version. Record
the date, version, shasum/integrity, and file count from the pack output in the
runbook/decision record (docs commit, no new tag). **`npm publish` does not
replace the GitHub tag/Release and adds no tag of its own.**

**If something goes wrong.** A bad publish is repaired by `npm deprecate` plus
a forward patch, never by republishing the same version; `npm unpublish` is used
only inside the registry's policy window and only with the owner's explicit
agreement. A failed login/publish before any registry write changes nothing —
the tag and Release stand, and the version stays unpublished.

**Rollback (config first, revert second — R8).** The runtime behaviour is
config-reversible: set `analysis.consent: none`, clear `analysis.models` (or the
pair), and remove the provider setup from the profile — a default profile is
inert again with no code change. The code revert is a normal revert of the patch
commits (one config shape, one helper, the status field, client copy, tests,
docs): no migration, no profile state, no data rewrite. A defective tag is
corrected by a forward patch, never by moving it. A published npm version is
deprecated and superseded, not republished; an unpublished one simply stays
unpublished.

## 5. What is not on this line, and the unchanged 1.0.0 prerequisites

**Not on 0.10.x:** image admission (D1/D2/D11 — still no attachment peer, no
`includeImages`, no `privacy_apps`, text-only), the Phase 4 `source: owned`
cutover (D10 plus a real captured week; the former 0.8.3 scope), the
`dsh dayflow import` CLI, the owned-journal write path, D2's B/C forms, and the
actual npm publish (a separate reviewed step, see §4). The owner-gated 0.8.2 and
0.8.3 slots were never started and are **not renumbered** into 0.10.

**The 1.0.0 prerequisites, updated for the answers — the open items are still
unmet:**

1. A **real captured week** on the owned default (capture on, `source: owned`,
   Dayflow closed, zero data loss across restarts, recorded in
   [`CUTOVER_REHEARSAL.md`](CUTOVER_REHEARSAL.md)).
2. **D10** — explicit authorisation to flip the default. **Still open.**
3. **D1/D2** — D1 is now answered (`cloud`), and option A makes a named pair
   configurable, so the "can an analysed week be recorded" half is actionable;
   **D2 is only partially answered**, so its "decided" box stays open until the
   owner picks the A/B/C form (or explicitly accepts A).
4. **D11** — image admission decided. **Still open**; 1.0.0 can ship text-only on
   an explicit "not now", which is not the same as no answer.
5. **D7** — decision answered **yes**; the publication act is a separate reviewed
   step that needs npm credentials and the owner's version confirmation, and it
   changes no tag. 1.0.0 can ship as a GitHub Release even if the publish is still
   pending.
6. The first-run/rollback runbook **exercised** ([`RUNBOOK.md`](RUNBOOK.md) is
   written; the walkthrough against a real cutover still needs D10 and the week).

## 6. Risks and Definition of Done

**Risks, ranked.**

1. **Config ambiguity becomes a silent behaviour change.** A list plus the old
   fields, a typo'd selector, or a duplicate id could quietly analyse with the
   wrong model. Mitigation: the precedence above is explicit and **fails closed**
   at load (`invalid_input`, known ids listed), the resolved pair is the only
   thing the gates read, and the legacy shape is pinned byte-identical by tests.
2. **A credential leaks into the repository or a log.** The owner pasted a key
   in chat; docs, examples, tests, profiles, and CI logs are all places it could
   land. Mitigation: the plugin has no key field and never reads one; the host
   profile owns `apiKeyEnv`/credentials; docs use env names and placeholders;
   tests use the existing fake fixture only; the key that was pasted should be
   **rotated/revoked** by the owner regardless of this line, since a chat paste
   is a disclosure. If a real credential is ever found in a commit, rotate it and
   treat history rewriting as secondary — never rely on removing the file.
3. **Cloud egress without honest copy.** D1 = `cloud` means metadata can leave
   the Mac; the 3.6 limitation (a window rule cannot see inside a browser tab)
   and the text-only fact must stay in the settings copy **and** in the new
   provider page. Mitigation: both locale keys already exist since 0.7.2 and are
   asserted by copy tests; the provider page repeats them; D11 keeps pixels out.
4. **A named list weakens the local-consent allowlist.** A `local` profile must
   still reject an active entry whose provider is not on `localProviders`.
   Mitigation: the gate logic is untouched and gains named-list tests; the docs
   say the allowlist applies to the active provider, not to the list.
5. **The real-cloud proof does not happen and the tag claims it did.**
   Mitigation: the verification is one recorded `scripts/cloud-smoke.mjs` run —
   PASS required, provider-level boundary stated in [`docs/SMOKE.md`](SMOKE.md) —
   recorded without secrets, and the tag waits if no PASS record exists (§3.7);
   the plan does not substitute the fake seam for it.
6. **Publish accidents.** Wrong version, wrong dist-tag, token in the repo, or an
   automatic publish: mitigation is C8/§4 — confirm-first, dry-run, tagged commit,
   manual publish, token outside the repo, no publish step in the release script,
   and deprecate-not-unpublish repair.
7. **Scope creep into D10/D11.** The answers make "while we are here" attractive
   (image entries, cutover flip). Mitigation: C1/C6 and the deferred table; a
   patch that needs those stops before implementation.
8. **Version noise.** 0.10.0 is only worth a minor if it actually ships the
   authorised cloud/multi-model surface; if the real-cloud proof and docs are not
   ready, the honest move is to wait rather than tag a half-answer.

**Definition of Done (every patch; the 0.7 rules apply, with this line's
additions).** Boxes stay unchecked until the cut.

- [ ] **One theme, one tag (R1/R2):** the diff is exactly §3.3–§3.6 — config
      shape + helper, effective-pair wiring, status field + client copy, tests,
      docs — with no D10/D11/B/C surface.
- [ ] **Contract frozen except the two declared changes (C2/C5/C6):** the new
      `analysis.models` key and the additive optional `model` status field,
      nothing else; schema v10, 18 routes, 5 commands,
      23 tools, 8 skills, peers and runtime dependencies unchanged; legacy
      behaviour pinned identical.
- [ ] **Default-safe (C4):** a default profile makes no call and sends nothing;
      cloud only after an explicit consent plus a complete entry; text-only while
      D11 is open.
- [ ] **Tests and gates:** suite ≥ 583 (measured; count recorded, no case
      removed or weakened), typecheck, build (host + client), `check:package`,
      both CI legs.
- [ ] **Real-cloud smoke recorded (C7):** one `scripts/cloud-smoke.mjs` run
      exits 0 / PASS against the owner's real provider and writes the `--record`
      evidence — provider label and endpoint host, model, latency, token counts,
      valid JSON, a **≤500-character** preview, `git` HEAD, `gitDirty: false`,
      no key; the provider-level boundary is stated and no
      capture-chain/job/activity-row claim is made.
- [ ] **Docs with the tag (R6):** `docs/PROVIDERS.md` (written in the planning
      round; updated here), `docs/CONFIGURATION.md`,
      README/README.zh, `CHANGELOG.md` `[0.10.0]`, `docs/ROADMAP.md` §0.10.x, and
      this file's landed record; `docs/OWNER_DECISIONS.md` already records the
      answers and does not need re-answering.
- [ ] **No secret (C3):** no real key anywhere; rotation note present; only the
      fake fixture remains.
- [ ] **Release:** `v0.10.0` tagged with one GitHub Release (23rd of each) from the
      CHANGELOG section; npm publication is the separate owner-confirmed step in
      §4, whose outcome (published or still pending) is recorded honestly.
- [ ] **Line scope holds:** D10/D11 still open, the analysis contract still
      text-only unless D11 is answered, no cutover default flipped, no owned-journal
      write path, no CLI import.

## 7. Sequencing rationale and line exit criteria

1. **0.10.0 comes first because the owner's answers point at exactly one gap.**
   D1 = cloud makes a real analysed week possible; D2's direction asks for
   several custom models with DeepSeek first; the tree can do the call but not
   name a set of models or tell the user which one is active. The A baseline is
   the minimum shape that serves the answer without inventing B/C semantics the
   owner has not chosen.
2. **The provider page and the real run are part of the patch, not after it.**
   The gap is not only code: without a documented `apiKeyEnv`/credentials setup
   and one recorded real run, "cloud analysis works" is a claim the tree has
   never evidenced and a user cannot reproduce. Documentation and verification
   travel with the theme (R6/C7).
3. **The legacy pair is frozen, so the line cannot break existing profiles.**
   Everything the owner already configured — or left on the safe default — reads
   the same before and after; the list is additive and the status field is an
   optional addition.
4. **B/C wait for the owner.** Fallback and custom `baseURL` change cost,
   retry, and secret-handling semantics; building them on a guess would front-run
   D2's form and make the second decision harder, not easier. C in particular
   must never become a plugin-owned credential store; if chosen, the host profile
   keeps the endpoint and the key.
5. **Images and cutover stay gated.** D11/D10 are still open, and 0.10.0 does not
   touch the analysis contract's text-only nature or any default backend. The
   former 0.8.2/0.8.3 slots remain deferred and unrenumbered.
6. **Publishing is deliberately outside the patch.** The tag and Release are
   engineering's normal release record; npm publication is distribution with an
   irreversible step and an unmet credential precondition, so it stays a
   separate, owner-confirmed act (§4). 0.10.0 is the recommended first publish
   candidate, not an automatic one.
7. **The line stops after 0.10.0 unless the owner unlocks more.** If the owner
   picks D2's B/C form, that is the next patch's theme; if D10/D11 are answered,
   those are their own patches; a second 0.10.x patch that merely polishes this
   one would be release noise (R1/R5).

**Line exit criteria.** The 0.10.x line's first patch is done when `v0.10.0` is
tagged with a GitHub Release, its §3.7 acceptance is green (including the
recorded real-cloud run), the docs and this plan agree on the landed shape, the
default profile is still inert, no D10/D11/B/C work shipped, and the npm outcome
(published `0.10.0`, or still unpublished with §4's preconditions named) is
recorded honestly. The repository trail then has **23 tags / 23 Releases**; the
package becomes published only when the separate §4 step runs, and that step
changes no tag. If the owner has not chosen D2's remaining form or answered
D10/D11 by then, the line holds at 0.10.0 and does not invent a second theme.

## 8. How the patch would run

1. **Round basis:** the 2026-11-27 implementation ran from `main` `e4b143a`
   (the planning commit; the baseline measurement above was taken at
   `844dd02`) and completed on `0d8d3c8`, with the host/client/docs lanes writing
   disjoint files in one tree and this plan/roadmap maintained beside them.
   The tag commit is the lead's at the cut; the planned branch name is
   `patch/0.10.0-cloud-models`.
2. **Tests first, on the fake seam:** the config/consent/status cases from §3.6
   (adding `tests/config.test.ts` per the round's file split) plus the client
   copy case — no network, no model, no screen permission, no real clock. The
   quality pass added two list-mode pipeline end-to-end cases (a selected second
   entry and the default first entry), taking the suite to **583**.
3. **Server then client:** `src/analyse/models.ts` → `src/config.ts`
   (schema/types/resolution) → the additive `model` summary in
   `src/analyse/status.ts` → the client copy/render in `src/client/insights.tsx`,
   `src/client/locale.ts`, and `src/client/styles.ts`; `src/client/data.ts`
   needs no edit because its alias follows the contract type. The two
   consent gates are left behaviourally untouched; their tests prove the
   effective pair reaches them. The route table is untouched.
4. **Docs in the same patch:** `docs/PROVIDERS.md` (written in the planning
   round; updated here), `docs/CONFIGURATION.md`,
   README/README.zh, CHANGELOG `[Unreleased]`, `docs/ROADMAP.md` §0.10.x, and this
   file. `docs/OWNER_DECISIONS.md` needs no change beyond already recording the
   answers.
5. **Gates:** `npm test` (**583**), `npm run typecheck`, `npm run build` (host
   and client bundle), `npm run check:package` — all measured green — then
   both CI legs on the pushed branch (green on `main`). A secret scan of the
   diff and the tarball runs here.
6. **Real-cloud smoke, one command, by the operator:** export `SMOKE_API_KEY`
   (or `DEEPSEEK_API_KEY`) from the environment or the host's credential store —
   never in a command line, a profile value, or a log — then after `npm run
   build` run `node scripts/cloud-smoke.mjs --record /tmp/dayflow-cloud-smoke-<date>.json`
   (optionally `--base-url`/`--model`/`--timeout-ms`), from a clean checkout of
   the commit to be tagged (`gitDirty: false`). The run drives the real
   prompt/analyser/retry/usage path against the real OpenAI-compatible provider,
   must **exit 0 / PASS** with a valid answer, and writes the evidence without
   the key as [`docs/SMOKE.md`](SMOKE.md) describes: provider label, endpoint
   host, model, latency, token counts, validity, a **≤500-character** preview,
   and `git` HEAD. It is
   **provider-level only** — no capture chain, no job row, no activity row — and
   that boundary is stated in `docs/SMOKE.md`. No PASS record, no tag
   (§3.7/§3.9).
7. **Tag:** from the green tree and only after the smoke PASS record, the lead runs
   `npm run release -- minor` (or the explicit `0.10.0`), which bumps, tests,
   commits, tags, pushes, and creates the GitHub Release from the CHANGELOG
   section — the **23rd** tag/Release. The release script still does **not**
   publish, and this plan is not updated to "landed" before the tag exists.
8. **Publish, separately:** the lead runs the §4 sequence (collected in
   [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md)) after the owner's
   one-line version confirmation and a successful `npm whoami`; verifies the
   registry, records the outcome, and updates the install section/documentation
   in a docs commit (no new tag). If the login is still unmet, the version stays
   unpublished and that is recorded honestly.
9. **Reconcile:** correct this file and `docs/ROADMAP.md` in place where reality
   diverged from the plan (as the 0.9 patches did), and leave D10/D11 exactly as
   [`OWNER_DECISIONS.md`](OWNER_DECISIONS.md) records them.
