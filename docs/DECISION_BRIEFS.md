# Owner decision briefs: D10, D11, and D2's form

> **Status, measured on 2026-11-27 at `main` `5acd9e6`.** 0.10.0 is
> **implemented and untagged**: 583/583 tests, `typecheck`, `build` (host and
> client), `check:package`, and both CI legs are green, but the tag waits on its
> one hard gate — **a recorded provider-level real-cloud smoke PASS, and no PASS
> record exists yet** (`scripts/cloud-smoke.mjs` and [SMOKE.md](SMOKE.md) are
> ready; the tool being ready is not the gate). `package.json` still reads
> `0.9.2`: the version bump belongs to the release commit. The latest tag is
> `v0.9.2` (22 tags / 22 GitHub Releases), npm still answers **404**, and this
> machine is not logged in — **D7 = `yes` authorises a publish; it did not
> perform one.**
>
> **Already answered:** D1 = `cloud` and D7 = `yes` (2026-11-27); **D2 is
> partially answered** (several custom models, DeepSeek first; the A/B/C form is
> open). **Still open:** D10 and D11. This page exists to make those three
> answers cheap: for each one, the measured behaviour, what a `yes` would change,
> the cost, the rollback, the release rhythm, and a one-line answer template.
>
> **This page decides nothing and changes nothing.** It is documentation only —
> no code, config, tag, or publish is affected by reading it. **No credential or
> personal data appears here, and none should be pasted into it.** Provider
> credentials live in the host profile through `apiKeyEnv` or the host's
> credentials record; see *Key safety* in [OWNER_DECISIONS.md](OWNER_DECISIONS.md).

## 0. One-screen summary

| # | Question | Safe default today | Recommendation | What a `yes` unlocks |
| --- | --- | --- | --- | --- |
| **D10** | May `source: owned` become the default for a **fresh capture-enabled profile with no Dayflow database**? | `no` — `source` resolves to `dayflow` when unset; no default has been flipped; Phase 4 is **rehearsed only** | **`yes`, staged**: authorise now, implement only after `v0.10.0` tags, as its own line (`0.11.0`), then a real week, then `1.0.0` | The cutover patch, the first-run walkthrough, the real-week record, and the path to `1.0.0` |
| **D11** | May the plugin admit screen **pixels** at all, through the host attachment/vision contract? | `no` — no attachment peer, no `includeImages` key, no `privacy_apps` list; every shipped release is text-only | **`later` — explicitly `no, not now`**: this keeps 1.0.0 text-only and closes the 1.0.0 checkbox; revisit after the cutover line as its own theme | The image-admission patch (the kept 0.8.2 scope), schema v11 `privacy_apps`, and the first non-text egress |
| **D2** | Which provider/model form: **A** (named list only), **A+B** (list + fallback), or **A+B+C** (plus per-entry custom `baseURL`)? | A is what 0.10.0 ships; the legacy pair is frozen; no implicit host default | **`A`** — accept what already ships and close the 1.0.0 box. Choose `A+B` only if fallback is worth a second cloud call and new budget bookkeeping. **C is not plugin work** (the endpoint already belongs to a host-profile provider) | A closes the “D2 decided” 1.0.0 box; A+B adds a small `0.10.1`; C needs no plugin patch |

**What blocks what** (an answer here does **not** move the 0.10.0 tag):

| Release or work | Blocked by | **Not** blocked by |
| --- | --- | --- |
| `v0.10.0` tag | one recorded real-cloud smoke PASS (and the green gate list) | D10, D11, D2's B/C form, npm login |
| Optional `0.10.1` (fallback, B) | D2 = `A+B` | D10, D11, the smoke |
| Cutover line, `0.11.0` | D10 = `yes`, plus a usable analysis entry for the week | D11, npm |
| `1.0.0` | real captured week + D10 + D2 form decided + D11 decided + first-run/rollback walkthrough | npm publish (it can ship as a tag/Release only) |
| Image admission (later line) | D11 = `yes` + a vision-capable D2 entry + the design note | the cutover line, 1.0.0 |

The consolidated owner record stays [OWNER_DECISIONS.md](OWNER_DECISIONS.md);
the line status is [ROADMAP.md](ROADMAP.md) §0.10.x and §Next line (1.0.0); the
current patch is [PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md).

---

## 1. D10 — Phase 4 cutover (`source: owned` default)

### 1.1 The question and the safe default

- **Question:** after the real captured week, may `source: owned` become the
  default for a fresh capture-enabled profile?
- **Options:** `yes` (flip the default for that profile shape, with the first-run
  walkthrough and rollback by `source: dayflow` alone) or `no` (keep
  `source: dayflow` as the default).
- **Safe default today:** `no`. The source defaults to Dayflow, no default has
  been flipped, and Phase 4 is rehearsed only ([OWNER_DECISIONS.md](OWNER_DECISIONS.md)
  §D10, [ROADMAP.md](ROADMAP.md) §Next line).
- **Why it is owner-gated:** a default change is visible to every fresh profile;
  it is a product decision, not an engineering one ([PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md)
  §0.8.3).

### 1.2 What is true today (measured on this tree)

| Fact | Where |
| --- | --- |
| `source` resolves to **`dayflow`** when unset; `dayflow: false` is the compatibility alias for owned; `source` and `dayflow` disagreeing is a load error | `src/config.ts:550-556` |
| The resolved config carries `dayflow: boolean`, derived from the source | `src/config.ts:624` |
| `resolveConfig` is **pure** — it reads no filesystem, so the flip needs a rule evaluated at composition, not in config | `src/config.ts` imports only `node:os`, `node:path`, schemastery, and local modules |
| A Dayflow **existence probe already exists**: `detectDayflow(path)` returns `databasePresent: existsSync(databasePath)` (plus app/running/CLI/cask flags) | `src/setup.ts:106`; wired as `presence()` at `src/index.ts:227` |
| Reads follow the source: Dayflow by default, the owned journal when `dayflow: false`; a missing Dayflow database is a `no_data` error (“No Dayflow database at …”) | `src/tools/shared.ts:46-49`, `src/db.ts:68-76` |
| **Writes already go to the owned journal regardless of source**: the capture engine stores frames and `screenshots` rows under `journalPath`; the analysis worker and the automation closes use the same journal (the worker also uses its `frames/` directory) | `src/index.ts:294-302`, `334-339`, `351-407` |
| Owned is opt-in today: set `source: owned` (or `dayflow: false`, never both) and populate the journal with the `journal_import` tool (read-only, additive, idempotent). The `dsh dayflow import` CLI does **not** exist yet. | `src/tools/import.ts`; [RUNBOOK.md](RUNBOOK.md) §2 |
| On owned, the editing tools stay Dayflow-only: `dayflow_status` reports `Edits: disabled (reads only)`, and a read-only owned profile cannot use them | [RUNBOOK.md](RUNBOOK.md) §2 |
| Gates: capture is off by default; analysis needs `capture.enabled` + `analysis.enabled` + a non-`none` consent + an explicit pair + the host `llm` service; automation mounts with the analysis stack and additionally needs the consent and pair | [RUNBOOK.md](RUNBOOK.md) §3; `src/config.ts:255-357`; `src/index.ts:285-326` |
| The fixture rehearsal exists and passed **20/20** (13/13 restart labels unchanged); ROADMAP §Next line records a 20/20 re-run at this revision, and the script is unchanged | `npm run rehearsal` (`scripts/cutover-rehearsal.mjs`); [CUTOVER_REHEARSAL.md](CUTOVER_REHEARSAL.md) §6; [ROADMAP.md](ROADMAP.md) §Next line |
| The active source is visible in `dayflow_status` (`Source: dayflow`/`owned`); the panel does **not** show it today — naming it there is part of the cutover acceptance | `src/tools/read.ts:438`; `src/format.ts:695`; [PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md) §0.8.3 |
| **No first-run flow ships.** The only setup guidance is the status checklist (`setupStatus`), used by `dayflow_status` and the optional installer tool | `src/setup.ts:126`; the 0.8 tree “contains no first-run walkthrough” ([PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md) §0.8.3) |
| Schema stays **v10**; native capture rows and cards land in the owned journal | `src/journal.ts:23`; [RUNBOOK.md](RUNBOOK.md) §4 |

**The important consequence.** On a fresh profile with `capture.enabled: true`
and **no Dayflow database**, the plugin already records into the owned journal,
but its read path still points at the Dayflow database. The result today is a
split: the write side has captured cards, the read side answers “No Dayflow
database”. The cutover is exactly making the read default follow the write path
that already exists. A default profile is unaffected either way: capture is off,
so nothing records.

### 1.3 What a `yes` changes

The scope kept for the cutover line is the former 0.8.3 scope
([PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md) §0.8.3):

**Behaviour**

- The default-source rule, evaluated **once at composition**, with the existing
  existence probe: *explicit `source` wins; `dayflow: false` means owned; capture
  enabled and no Dayflow database means owned; otherwise Dayflow.*
- No silent conversion: an existing Dayflow install keeps `source: dayflow`
  unless the user explicitly moves; the importer stays the one-time migration.
- The flip is a **default change, not a schema change**: both read paths are
  green since 0.7.0, and `dayflow: false` already selects the owned store today.

**Code and tests**

- `src/index.ts`: evaluate the rule at composition using `detectDayflow(...)`'s
  `databasePresent`; `resolveConfig` stays pure.
- First-run flow **inside the existing panel entry** (no new tab, no new route):
  permission state, consent choice (`local`/`cloud`/`none`), capture switch,
  pause; EN/ZH copy.
- `dsh dayflow import` CLI over the existing importer (5 → 6 commands), beside
  the no-Dayflow runbook: lossless import, a re-run that does not duplicate,
  usable on a machine with no Dayflow.
- Tests: the default-rule table (explicit / `dayflow: false` / capture on with
  no Dayflow file / Dayflow file present), the first-run state machine, a
  fresh-profile test with the Dayflow path deleted, and a rollback test where
  `source: dayflow` still reads the imported store.

**Docs**

README and README.zh (architecture, privacy, limits, a “native vs imported”
section), [CONFIGURATION.md](CONFIGURATION.md), [ARCHITECTURE.md](ARCHITECTURE.md),
[NATIVE_PORT.md](NATIVE_PORT.md) Phase 4 status, [RUNBOOK.md](RUNBOOK.md)
(first-run/no-Dayflow instructions and rollback),
[CUTOVER_REHEARSAL.md](CUTOVER_REHEARSAL.md) real-week record,
[ROADMAP.md](ROADMAP.md), `CHANGELOG.md`, and the answer recorded in
[OWNER_DECISIONS.md](OWNER_DECISIONS.md).

**Not changed:** no schema migration (v10 stays), no new host peer, no image
path, no owned-journal write path (already exists), no npm publish.

### 1.4 Preconditions and acceptance

All of these are required before, and at, the flip
([PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md) §0.8.3):

1. **D10 = yes** — this decision.
2. **D1 and D2 usable for the real week.** D1 = `cloud` is answered; the real
   week needs one working analysis entry (a host provider/model pair; option A
   already makes a named list configurable). A capture-only variant is possible
   with `consent: none`, but then the acceptance has no analysed day.
3. **The rehearsal passes on the tree being cut over**, not only on the 0.7.6
   record: `npm run rehearsal` 20/20, plus the written real-capture checklist
   re-run with no data loss.
4. **A real captured week on a fresh (throwaway) profile** — capture on, the new
   default in place, Dayflow closed — with **zero data loss across restarts**,
   recorded in [CUTOVER_REHEARSAL.md](CUTOVER_REHEARSAL.md). Any data loss is a
   blocking finding, not a note.
5. **Owner present** for the permission grant, the consent choice, and the
   first-run walkthrough; no unattended real capture.

Acceptance (from [PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md) §0.8.3 and
[NATIVE_PORT.md](NATIVE_PORT.md) Phase 4): on a fresh profile with Dayflow
closed — install → grant permission → capture runs → a day appears in the panel →
next morning the standup, reflection, and review queue are populated without a
single agent turn; existing Dayflow profiles are not silently converted; the
panel says which source is active; `source: dayflow` reverts the flip without a
release; no schema change; no npm publish.

### 1.5 Risks and rollback

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| The flip is visible to **every fresh capture-enabled profile** — the highest-risk change on the roadmap | A wrong default is a product incident, not a bug | Rule is explicit, evaluated once, and covered by a rule table; a default profile is inert (capture off); the flip only touches “capture on **and** no Dayflow DB” |
| Silent conversion of an existing Dayflow user | Losing the familiar backend without consent | The rule requires **no Dayflow database**; explicit `source` wins; the importer is documented as the migration; existing profiles keep Dayflow |
| Read/write split-brain if the rule is applied inconsistently | Two backends in one profile | One composition-time evaluation; `source` still overrides; `dayflow_status` already reports `Source:`, and the cutover acceptance requires the first-run/panel copy to name the active source |
| First-run missteps (permission, consent, capture) | A user can enable capture without understanding egress | Owner-present walkthrough; EN/ZH copy; `consent: none` stays the default; analysis needs a pair |
| An owned-only profile loses inline edits | Edits stay Dayflow-only today | First-run copy must say it; `source: dayflow` immediately restores editing; the write path is unchanged |
| The real week fails late | Seven-plus days of evidence discarded | It is a blocking finding, and **rollback is one config line**; the week runs before `1.0.0`, not after |

**Rollback** ([RUNBOOK.md](RUNBOOK.md) §6; patch rule R8 — config first, revert
second):

- Set `source: dayflow` (or the `dayflow: true` alias — never both). No
  reinstall, no data migration, no schema change.
- The owned journal stays on disk as the opt-in preview it is today;
  `journal_import` remains additive and idempotent.
- Because the cutover adds **no schema**, an older build reads the same v10
  journal; frames and paths are unchanged. Back up first if the journal has data
  ([RUNBOOK.md](RUNBOOK.md) §4).

### 1.6 Release rhythm

- **Not `0.10.1`.** A `0.10.1` on this line, if it exists at all, is the
  analysis-line fallback patch (`D2 = A+B`); a default flip cannot share it.
  0.10.x's one theme is cloud analysis + the named model list (patch rule C1),
  one theme per tag (R1/R2), and 0.10.0's own tag is still waiting on the smoke,
  so folding a second theme in would also re-open a frozen scope (C6).
- **Recommended: the cutover gets its own line and its own tag.** After
  `v0.10.0` is cut (23rd), open the cutover line; its first patch is `0.11.0`
  (default rule + first-run + `dsh dayflow import` + tests + docs). Tag
  **`v0.11.0`** (24th) after (a) `npm run rehearsal` 20/20 on that tree,
  (b) the default-rule/fresh-profile/rollback tests, and (c) the owner-present
  RUNBOOK first-run/rollback walkthrough on a throwaway profile.
- **Then the real week** runs on released `0.11.0`. When its record shows zero
  data loss across restarts, cut **`v1.0.0`** (25th) as a separate release
  decision.
- **Sequencing note — the one circularity in the 0.8.3 list.** Its entry
  criteria ask for the real week “with the new default in place” *before* the
  flip ships. Resolve it explicitly: either run the week on a release candidate
  of the cutover patch and tag `v0.11.0` after the record, or tag `v0.11.0`
  after the walkthrough and make the week the `1.0.0` gate. The second is the
  recommended reading; either way the week comes before `v1.0.0`, and a failed
  week means `source: dayflow` rollback and no `v1.0.0`.
- **Alternative, fewest tags:** hold `v0.11.0` until the week is recorded and
  cut only `v1.0.0`. Cost: the tested artifact is an untagged candidate and a
  failed week delays the flip's only release. Not recommended.
- If D10 = `later`/`no`: `v0.10.0` still tags; no cutover patch is scheduled;
  `1.0.0` stays unplanned (`later`) or must be re-scoped (`no`). **No tag except
  1.0.0 waits on D10.**

### 1.7 Options and recommendation

- **`yes` (recommended, staged):** authorise the flip now; implement after
  `v0.10.0` tags; own line `0.11.0`; real week; `1.0.0`. It is the only path to
  `1.0.0`, the flip is contained to fresh capture-enabled profiles without
  Dayflow, rollback is one config line, and it aligns the read path with the
  write path that already exists.
- **`later`:** the honest answer if the owner cannot commit to being present for
  the permission/consent/first-run walkthrough and to a week of capture in the
  next few weeks. It is not a rejection: the safe default holds, `0.10.0` still
  tags, and `1.0.0` stays unplanned.
- **`no`:** keep `source: dayflow` as the default for fresh profiles. The owned
  journal stays opt-in, the plugin keeps its Dayflow dependency for fresh
  profiles, and `1.0.0` must be re-scoped — the recorded 1.0.0 prerequisite is
  the real week on the owned default.

### 1.8 One-line answer, and what happens next

```
D10: yes — authorise the default flip; implement after v0.10.0 tags
```
or, if the owner cannot commit to the week yet:
```
D10: later
```
or:
```
D10: no — keep source: dayflow as the default
```

**After the answer:**

| | `yes` | `later` | `no` |
| --- | --- | --- | --- |
| Immediate | Record the answer in OWNER_DECISIONS and ROADMAP; finish the 0.10.0 cut first | Record it; no schedule | Record it; re-scope the 1.0.0 list |
| Patch | `0.11.0` — default rule at composition, first-run flow, `dsh dayflow import`, tests, docs | none | none |
| Tag | `v0.11.0` after rehearsal + walkthrough; `v1.0.0` after the real week | none | none |
| Verify | `npm run rehearsal` 20/20; default-rule table; fresh-profile test with the Dayflow path deleted; rollback test; owner-present walkthrough; real-week record with zero loss | — | document the retained Dayflow dependency |

---

## 2. D11 — image admission

### 2.1 The question and the safe default

- **Question:** may the plugin admit screen pixels at all, through the host
  attachment/vision contract?
- **Options:** `yes` with size and retention caps and a `privacy_apps` redaction
  list (the deferred 0.8.2 scope); `later` — an **explicit not-now** that keeps
  text-only, closes the 1.0.0 checkbox and can be revisited after the cutover
  line; or `no` (text-only, permanently for this line).
- **Safe default today:** `no` — no attachment peer, no `includeImages` key, no
  `privacy_apps` list; every shipped release is text-only
  ([OWNER_DECISIONS.md](OWNER_DECISIONS.md) §D11).

### 2.2 What is true today

- **Pixels do not leave the Mac.** The analysis adapter builds **one text
  content block and never an image block** (`src/analyse/host.ts:28-53`). The
  window prompt carries the app name and bundle id, the window title (cut to 200
  characters), the capture instant, the frame hash, and the category names; the
  user message is capped at 2,000 characters ([PROVIDERS.md](PROVIDERS.md) §1).
- **Frames stay local.** They live under `$DSH_HOME/dayflow/frames/<day>/…jpg`
  and, at `capture.keepFramesDays: 0` (the default), each is deleted once its
  window has been analysed (`src/config.ts:276-281`; [RUNBOOK.md](RUNBOOK.md) §4).
- **No image contract exists.** There is no `analysis.includeImages` key in the
  analysis schema (`src/config.ts:303-357`), no `privacy_apps` anywhere in the
  source, and no `@deepseek-ai/dsh-attachment` dependency in any dependency kind
  — a test pins that absence (`tests/compatibility.test.ts:203`).
- **Caps that would bound an image path already exist** in the text path:
  `framesPerWindow` default 3, max 5; `windowMinutes` default 10;
  `maxCallsPerDay` default 120; `dailyTokenBudget` default 200,000
  (`src/config.ts:332-355`).
- **The privacy limitation is already documented for text:** a window-level rule
  cannot tell what is inside a browser tab or a document; the 3.6 copy has
  shipped since 0.7.2 and is part of the accepted `cloud` setting
  ([OWNER_DECISIONS.md](OWNER_DECISIONS.md) §D1).
- **A vision-capable model is not admission.** The installed pi-ai catalog
  already describes `deepseek-flash` as text-and-image input, but that only tells
  DSH the endpoint accepts images; the plugin still sends text only, and while
  D11 is open it must ([PROVIDERS.md](PROVIDERS.md) §5).
- **D1 = cloud and D2 = partial.** D1 permits metadata egress after an explicit
  consent; D2 has not named a vision-capable pair yet; D11 is the missing
  go-ahead.

### 2.3 What a `yes` would change (the kept 0.8.2 scope)

- **Config:** `analysis.includeImages` (default **false**), a per-call image byte
  cap, and a frames-per-window cap; all validated at load time and inert when
  off.
- **Schema:** an additive **v11** migration for `privacy_apps` (bundle id +
  display name, seeded with password managers), with the migrate-from-v10 fixture
  test. Nothing existing is rebuilt.
- **Analysis:** `prompt.ts` appends image content blocks **after** the text
  block; `host.ts` sends them through the host attachment/vision seam;
  `pipeline.ts` picks the representative frames, enforces the byte cap and
  downscaling, and falls back to text for a window whose frame is unreadable or
  oversized. **Cloud requests replace a privacy-app frame with the fixed
  placeholder “private application, content withheld”; local requests keep the
  pixels** (the 3.6 rule: redaction is about what leaves the machine).
- **Privacy surfaces:** `privacy_apps` is readable and editable only through the
  existing entry (no new tab); the 3.6 limitation copy is in both languages; the
  analysis line states that images are included when they are.
- **Docs:** the `NATIVE_PORT.md` image slice, [CONFIGURATION.md](CONFIGURATION.md),
  [ARCHITECTURE.md](ARCHITECTURE.md) (the new seam), [PANEL.md](PANEL.md),
  [ROADMAP.md](ROADMAP.md) Phase 3.6 status, `CHANGELOG.md`, the README privacy
  section, and both READMEs' compatibility statement.
- **Load behaviour:** the plugin must load **text-only when the attachment
  service is absent** — an optional peer (`peerDependenciesMeta`) or a structural
  seam supplied only when the host service exists; CI has no attachment service,
  so all image tests use a fake and no image may leave the machine in CI.

**Entry gates, all required before code starts** ([PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md)
§0.8.2): D1 answered (done — `cloud`); **D2 names a vision-capable provider and
model**; **D11 = yes with the size and retention caps the owner accepts**; the
host contract is verified against the installed DSH release and recorded in a
new `docs/IMAGE_ADMISSION.md` (how bytes become an attachment, the vision
request shape, the token cost per call); and the plugin loads text-only without
the service.

### 2.4 Privacy, security, and cost

| Question | Engineering fact |
| --- | --- |
| What can `privacy_apps` actually redact? | **App-level only** — it is a bundle-id + display-name list. A browser is one app: blocking it blocks **all** its frames, and there is no per-tab or per-pixel filtering. The 3.6 limitation (“a window-level rule cannot tell what is inside a browser tab”) applies with full force to pixels |
| Can a sent pixel be recalled? | No. Once an image leaves the Mac it is out; provider-side retention is not under the plugin's control. That is why the default is `includeImages: false` and why cloud requests replace privacy-app frames with a placeholder |
| What about local frames? | They are local today and deleted after analysis (`keepFramesDays: 0`). Image admission sends them **before** that deletion, which is the moment the data becomes irreversible |
| What does it cost? | Image input tokens are model-dependent and **not measured anywhere in the tree**. The design note must publish input tokens per window before the patch; the existing bounds (`framesPerWindow` ≤ 5, `maxCallsPerDay`, `dailyTokenBudget`) still apply, so the cost ceiling is the daily token budget — but the per-call figure must be measured, not guessed |
| Can logs or records leak pixels? | The job ledger records the model and token counts, not image bytes. The patch's docs must keep it that way; image bytes must not appear in jobs, status, errors, or logs |

### 2.5 Rollback

- **Config first:** `analysis.includeImages: false` (the default) disables the
  path without a downgrade — the config is validated at load, so the path is
  inert even after the migration. `analysis.consent: none` stops every call
  regardless.
- The migration **only adds a table**; old builds ignore it. A *version*
  downgrade of a v11 journal needs a restore from backup, because a journal newer
  than the plugin is refused ([RUNBOOK.md](RUNBOOK.md) §4/§6).
- No release needs to be un-published; image admission can be switched off
  without moving a tag.

### 2.6 Release rhythm, options, and recommendation

- **Not `0.10.x`, and never a maintenance patch:** schema v11 + a prospective
  optional host peer + a new privacy surface is a theme of its own (R1/R3/R6).
  It is also **not a 1.0.0 gate** — 1.0.0 can ship text-only on an explicit
  not-now.
- **If `yes`:** it is its own later line, after the cutover line (or after
  `1.0.0` if the owner prefers): design note → D2 vision pair → patch → own tag
  (`0.12.0` if the cutover line takes `0.11.0`; `0.11.0` if the cutover line
  never opens). The version is assigned when that line opens; the gates above
  come first.
- **Recommendation: `later` — answered explicitly as `no, not now`.** 1.0.0
  ships text-only, and the explicit answer closes the “D11 decided” 1.0.0
  checkbox. Do not spend the line's risk budget on irreversible pixels while
  D2's form is open and no vision pair is confirmed. Revisit after the cutover
  line with the design note; if the owner has a concrete image-analysis need,
  answer `yes` with the caps and schedule it.
- **Why not leave it unanswered:** an unanswered D11 keeps the 1.0.0 box open by
  the checklist's own wording — every decision must be *decided*, and a
  not-now is a decision that changes nothing structurally.

### 2.7 One-line answer, and what happens next

```
D11: no, not now — 1.0.0 ships text-only; revisit after the cutover line
```
or:
```
D11: yes — includeImages default false, cloud redaction via privacy_apps,
     caps to be specified in the design note
```

**After the answer:**

| | `yes` | `no` / `later` |
| --- | --- | --- |
| Immediate | Record the answer; confirm the vision-capable D2 entry; write `docs/IMAGE_ADMISSION.md` and verify the host attachment contract against the installed DSH | Record it; close the 1.0.0 “D11 decided” box; no code change |
| Patch | its own later line (`0.12.0` candidate): config + v11 `privacy_apps` + prompt/host seams + caps + docs | none |
| Tag | that line's tag, after the 0.8.2 acceptance list and the v11 migration fixture | `v0.10.0` / `v1.0.0` proceed text-only |
| Verify | image blocks only when `includeImages` + consent + pair are all on; cloud bodies never contain a privacy-app frame; text-only load with no attachment service; byte-cap fallbacks; default profile unchanged; rollback test | text-only fact stays asserted by the suite |

---

## 3. D2 — A is already built; B and C are the open forms

### 3.1 A — the named model list (shipped in 0.10.0)

What is in the tree ([PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md) §3.3–§3.5; the
selection helper is `src/analyse/models.ts`):

- `analysis.models` is an optional list of 1–8 entries of
  `{ id, provider, model, label? }`; each entry names a **host-registered
  provider** and a model id.
- One active entry per call: empty `analysis.model` takes the first entry;
  otherwise it names an entry **`id`** (trimmed, case-insensitive). An unknown id
  fails at load with `invalid_input` listing the known ids — never a silent
  second choice.
- The legacy pair (`analysis.provider`/`analysis.model`) is **frozen** and
  byte-identical when the list is empty; with a non-empty list the entries carry
  their own providers, so a non-empty legacy provider is a load error
  (`analysis.model` then becomes the active-entry selector).
- The resolved pair feeds **every** call path — frame analysis, the scheduled
  day/week closes, and the briefs pass; the job ledger records the model id of the
  call, and the additive status field `model: { id?, provider, model, label? }`
  names the active entry in the panel and `GET /api/dayflow/analysis/status`.
- No implicit host default: an empty pair means “not configured” and jobs are
  skipped (the rule is settled since 0.7.1).

**Why A is the right stopping point for this line:** it serves D2's direction
(several custom models, DeepSeek first), it answers the “which model is active?”
question, and it does not invent fallback or endpoint semantics the owner has not
chosen.

**What A cannot do:** exactly one entry per call; no fallback; no per-entry
endpoint; no images; switching models is a config edit plus a host reload.

**What the owner still owes D2.** Confirm the entries and the host provider/model
ids the host profile exposes. Nothing else is needed for A. A one-line note is
enough (placeholders only — no key):

```
D2 note: entries = <id> (<host-provider-id>/<model-id>) first, then <id> (<provider-id>/<model-id>)
```

### 3.2 B — fallback to the next entry

**What it adds:** when a call fails, the next entry is tried instead of (or
after) the current retries.

**What the engineering says** — B is a contract change, not a config addition:

- Today the retries are **same-pair**: each attempt gets a 60-second timeout and
  a failed attempt is retried up to `ANALYSIS_MAX_RETRIES = 2` (total 3
  attempts); a window that keeps failing has its own attempts cap of 2
  (`src/analyse/llm.ts:53-62`; `src/analyse/jobs.ts:33`).
- The **ledger records the successful `model`, not the provider**
  (`src/analyse/jobs.ts:12-15`, `52-60`), so proving which entry actually ran
  needs unique model ids across entries or an additive column.
- The per-day **call cap counts jobs that started** (`attempts > 0`), not
  provider attempts, and **token usage is recorded only on completion** — a
  fallback call inside one window adds real provider cost that the call counter
  does not see, and a failed attempt's tokens are never recorded at all, so the
  contract must redefine both or accept an under-count
  (`src/analyse/jobs.ts:470-486`; `completeAnalysisJob` at
  `src/analyse/jobs.ts:395-427`).
- Under `consent: local`, only the **active** entry is checked against
  `analysis.localProviders` on the frame path; a fallback must be checked **per
  entry**, or a local-only profile could silently reach a non-allowlisted
  provider.
- A second cloud call for the same window means **a second provider sees the
  window data**; a fallback contract has to say so in the docs and keep the
  free-text disclosure honest.

**Patch shape if chosen:** no schema change is strictly required if the contract
defines evidence without new columns, but it touches the ordered-pair resolution
(`src/analyse/models.ts`), the retry/call seam, the budget/call accounting, the
status/panel copy, tests, and docs. It must specify: which failures fall back
(timeout/failed; never a consent or budget block), ordering, max attempts, how
fallback interacts with `maxCallsPerDay` and `dailyTokenBudget`, what the ledger
records, and whether fallback is per attempt or per window.

**Work size:** small-to-medium code surface, **medium contract surface**, medium
risk — the code is small, but cost and privacy semantics change.

### 3.3 C — a per-entry custom `baseURL`

**The decisive fact: a custom endpoint is already a host-profile concern, and
the plugin's call seam has no endpoint field.**

- The host profile's provider route already accepts `api`, `baseURL`, `models`,
  `compat`, and the other fields DSH accepts; a gateway is declared there and
  the credential is referenced by `apiKeyEnv` ([PROVIDERS.md](PROVIDERS.md) §2.2).
  The analysis entry then just names that provider id — which A already supports
  today.
- The plugin passes `{ provider, model, system, messages, signal, maxTokens }`
  to the host and nothing else (`src/analyse/host.ts:35-53`). There is no
  endpoint parameter to fill, so **C as a plugin config key has no route through
  the current seam**; it would need a new host-provider surface and a design
  note, not a field on `analysis.models`.
- The risks D2's option text already names are real: a plugin-managed URL is
  also a place to smuggle a credential, and it turns the host process into a
  request source to an arbitrary URL. The owner's decision record is explicit:
  **even if C is chosen, the endpoint and its key stay a host-profile provider
  with `apiKeyEnv`; the plugin never becomes a credential store**
  ([OWNER_DECISIONS.md](OWNER_DECISIONS.md) §D2; [PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md)
  §3.8).

**Recommendation for C:** do not build it as a plugin key. If the owner needs a
custom OpenAI-compatible endpoint, declare it in the host profile per
[PROVIDERS.md](PROVIDERS.md) §2.2 and reference its provider id from the
analysis entry — no plugin change, no SSRF surface, no credential in the plugin.
If a plugin-managed endpoint is ever truly wanted, that is a design note plus a
new host surface, evaluated on its own.

### 3.4 Order and recommendation

1. **A — accept it now.** It ships already, it closes the 1.0.0 “D2 decided”
   box, and it is enough for the real analysed week the cutover needs.
2. **B — only if fallback is worth it.** Choose `A+B` if resilience across
   models is worth a second cloud call, new budget bookkeeping, and the per-entry
   privacy disclosure. The natural slot is a small `0.10.1` on the analysis line
   (no schema, same theme) — ship it before the cutover line so `1.0.0` does not
   carry a requested-but-unbuilt form. If the owner prefers fewer tags, defer B
   to the next line.
3. **C — not plugin work.** Use a host-profile provider route; do not add a
   plugin endpoint/credential surface.

**Recommended answer: `A`** (or `A+B` if the owner explicitly wants fallback).

### 3.5 One-line answer, and what happens next

```
D2: A
```
or:
```
D2: A+B — fall back to the next entry after the same-pair retries fail
D2 note: entries = <id> (<host-provider-id>/<model-id>) first, then <id> (<host-provider-id>/<model-id>)
```
(Do not choose `A+B+C` as plugin work; C is a host-profile configuration, not a
plugin field.)

**After the answer:**

| | `A` | `A+B` | `A+B+C` |
| --- | --- | --- | --- |
| Immediate | Record it; confirm the entries/ids; close the D2 1.0.0 box | Record it; write the fallback contract (retryable vs non-retryable, ordering, attempts, budget/call accounting, per-entry local allowlist, ledger evidence) | Stop: C has no route through the current seam; document the host-profile `baseURL` route instead |
| Patch | none (already shipped) | `0.10.1` (no schema, no default change) | — |
| Tag | `v0.10.0` unchanged | `v0.10.1` | — |
| Verify | suite unchanged; panel/status shows the active entry | contract tests for fallback; call/token accounting; no fallback on consent `none` or an incomplete pair; the ledger identifies the entry that ran (unique model ids across entries or an additive field); docs disclosure | host-profile route documented in PROVIDERS.md; no plugin key, no URL field |

---

## 4. The answer sheet

If the owner agrees with the recommendations, this is the whole decision:

```
D2: A
D2 note: entries = <id> (<host-provider-id>/<model-id>) first, then <id> (<provider-id>/<model-id>)

D10: yes — authorise the default flip; implement after v0.10.0 tags

D11: no, not now — 1.0.0 ships text-only; revisit after the cutover line
```

Each line is independent; a partial answer is safe. `no`/`not now` keeps the
safe default and closes the corresponding 1.0.0 checkbox; `later` keeps the gate
open; a missing answer is not a decision
([OWNER_DECISIONS.md](OWNER_DECISIONS.md) §How to answer).

## 5. Version and tag plan after the answers

| Step | Release | Starts only when | Gate before the tag |
| --- | --- | --- | --- |
| 0 | **`v0.10.0`** (23rd) | no further decisions needed | one recorded provider-level `cloud-smoke.mjs` PASS (clean checkout, no key), 583/583 tests, typecheck, build, `check:package`, both CI legs — **not blocked by D10/D11/D2-B/C** |
| 1 | `v0.10.1` (optional) | D2 = `A+B` | fallback contract tests; no schema, no default change |
| 2 | **`v0.11.0`** (24th) | D10 = `yes` **and** `v0.10.0` is tagged | `npm run rehearsal` 20/20 on that tree; default-rule/fresh-profile/rollback tests; owner-present first-run walkthrough |
| 3 | **`v1.0.0`** (25th) | step 2 plus the real captured week | zero data loss across restarts recorded in CUTOVER_REHEARSAL; D2 form recorded; D11 decided; runbook walkthrough exercised |
| 4 | later image line (`0.12.0` candidate) | D11 = `yes` + vision-capable D2 entry + design note | the 0.8.2 acceptance list; v11 migration fixture; text-only load with no attachment service |

Version numbers are proposals: the line plan assigns the actual version when the
line opens, and a tag is only cut after its gates, never before.

## 6. Sources

- [OWNER_DECISIONS.md](OWNER_DECISIONS.md) — the decision record, safe defaults,
  and key-safety rules (D1/D7 answered; D2 partial; D10/D11 open).
- [ROADMAP.md](ROADMAP.md) — §0.10.x (the current line and its measured status),
  §Next line (1.0.0) (the prerequisite list), and the Phase 4 / image-admission
  history.
- [PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md) — §3.7/§3.9 (the 0.10.0 acceptance and
  tag gate), §3.8 (the deferred B/C/D10/D11 table), §5 (the 1.0.0 prerequisites).
- [PATCH_PLAN_0.8.md](PATCH_PLAN_0.8.md) — §0.8.2 (the kept image-admission
  scope and entry gates) and §0.8.3 (the kept cutover scope, entry criteria, and
  acceptance).
- [CUTOVER_REHEARSAL.md](CUTOVER_REHEARSAL.md) — the rehearsal record (20/20,
  13/13 restart) and what it does not cover.
- [RUNBOOK.md](RUNBOOK.md) — first run, owned-journal preview, safe switches,
  data/backup, rollback, troubleshooting.
- [PROVIDERS.md](PROVIDERS.md) — host-profile provider setup (`apiKeyEnv`,
  `baseURL`), the named model list, and why a vision-capable model is not image
  admission (§5).
- [SMOKE.md](SMOKE.md) — the real-cloud smoke procedure, its provider-level
  boundary, and the tag gate.
- Code read for this page: `src/config.ts`, `src/index.ts`, `src/setup.ts`,
  `src/tools/shared.ts`, `src/tools/import.ts`, `src/db.ts`,
  `src/analyse/{models,host,llm,jobs,pipeline,status}.ts`, `src/journal.ts`,
  `tests/compatibility.test.ts`, `scripts/cutover-rehearsal.mjs`.
