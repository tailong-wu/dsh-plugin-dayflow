# Owner decisions: what the next line waits on — and what is now answered

> Status: **partially answered — the project is moving again.** On 2026-11-27 the
> owner answered **D1 = `cloud`** and **D7 = `yes`**, and partially answered
> **D2** (several custom models wanted, DeepSeek first; the A/B/C form is still
> open). **D10 and D11 are still open.** Measured on the current tree (`main` at
> `844dd02`, after the annotated `v0.9.2` tag on `ccac653`): **558** green tests
> (**557** at `v0.9.2`), schema **v10**, **18** panel routes, **5** slash
> commands, **23** tools, **8** skills, DSH `0.2.2-rc.5` declared and pinned in
> the development dependencies, **22 tags / 22 GitHub Releases**, and npm still
> answers **404** (never published; this machine is not logged in either). The
> 0.9.x line's record is unchanged: functional scope closed at `v0.9.1`, plus the
> 0.9.2 maintenance tag.
>
> **These answers opened the 0.10.x line:** 0.10.0 — cloud analysis +
> multi-model selection (option A baseline) + first-npm-publish preparation —
> planned in [`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md) and recorded in
> [`ROADMAP.md`](ROADMAP.md) §0.10.x. A default profile is still inert
> (`analysis.consent: none`, empty pair, capture off), and the answered cloud
> direction does **not** admit pixels: while **D11** is open every analysis call
> stays **text-only**. The still-unanswered questions keep their safe defaults —
> unanswered is still not the same as "not now".
>
> **No credential appears on this page.** The owner pasted a key in chat while
> answering; no real key is recorded here or anywhere in this repository.
> Provider credentials live in the **host profile**, referenced through
> `apiKeyEnv` (a credential reference the host resolves — against its credential
> store, launch environment, or `.env`) or through the host's credentials
> record; the plugin itself never stores, reads, or echoes a key. A key shared in
> a chat is a disclosure even when nothing is committed: **rotate it**, and use
> only the rotated credential for the cloud verification run. See *Key safety*
> below.

## The one-page list

**D1** and **D7** are answered; **D2** is partially answered; **D10** and
**D11** are open. Answer each remaining question in one line: every decision has
a default that keeps the current behaviour if it is skipped, so a partial answer
is safe; an **unanswered** question is not the same as a **"not now"** answer for
the `1.0.0` checklist, which asks for each decision to be *decided*.

### D1 — analysis destination

- **Question:** may screen metadata (and, only if D11 says yes, pixels) leave
  the Mac for analysis, and whose model reads it?
- **Options:** `none` (nothing leaves the machine), `local` (a model running on
  this Mac), `cloud` (a provider that may proxy out).
- **Answered: `cloud` (2026-11-27).** Screen metadata may be analysed by a cloud
  provider — but only after an explicit `analysis.consent: cloud` in the profile.
  The safe default is unchanged: a default profile is `consent: none`, sends
  nothing, and records no analysed week. `local` remains a valid choice; the
  answer permits cloud, it does not force it. Because the cloud provider can see
  the text, the 3.6 limitation copy is part of the accepted setting and must stay
  visible: the analysis call sends the frontmost app, the window title, and the
  frame hash — **no pixels while D11 is open** — and a window-level rule cannot
  tell what is inside a browser tab or a document. The two locale keys that state
  the text-only fact and the cloud egress have shipped since 0.7.2; 0.10.0 keeps
  them and repeats them in the provider-setup page.
- **Unlocks:** a real analysed day and the analysed week the cutover line wants;
  the 0.10.0 cloud analysis line. It does **not** unlock image analysis: D11 is a
  separate decision and remains open, so the analysis contract stays text-only.
- **Still needed on top of it:** D2 (which provider/model, or which named model
  list) and, only for pixels, D11.

### D2 — provider and model

- **Question:** which provider/model pair should analysis use — and, if D11 is
  ever yes, which **vision-capable** pair reads frames?
- **Options:** an explicit `analysis.provider` + `analysis.model` pair; a named
  list of several custom models with one active entry; for the image path a pair
  that can see images.
- **Partially answered (2026-11-27):** the owner wants **several custom models**
  and wants to **start with DeepSeek**. That is enough direction for the baseline
  shape; the exact **A/B/C form is still the owner's choice**:
  - **A — named model list only.** `analysis.models` holds `{id, provider,
    model, label?}` entries; the first entry is the default and `analysis.model`
    selects an entry id; the legacy single pair still works untouched when the
    list is empty. **This is what 0.10.0 ships, and it is the only form this
    line commits.**
  - **A+B — list plus fallback.** The next entry is used when a call fails. This
    changes cost and retry semantics, so it waits for the owner.
  - **A+B+C — plus a custom `baseURL` per entry.** This waits too, and even if
    chosen the endpoint and its key must stay a **host-profile provider** with
    `apiKeyEnv`; the plugin must never become a credential store.
- **Safe default today:** no implicit host default. A pair must be set
  explicitly; empty means "not configured" and jobs are `skipped` (the rule is
  settled and shipped since 0.7.1). The plugin never chooses a vendor for the
  owner. With `analysis.models` absent/empty, the old pair is used exactly as
  before.
- **Unlocks:** a working configured entry is what turns the analysis code into a
  real analysed week for 1.0.0. The owner's DeepSeek preference names the first
  entry; the provider and model ids remain **host-owned** (the host profile
  exposes them), so the value written in the plugin is a host provider/model id,
  not a new vendor integration.
- **What still needs the owner:** pick **A**, **A+B**, or **A+B+C** (or explicitly
  accept A), and confirm the entry set and the DeepSeek provider/model ids the
  host profile will expose. Until then, 1.0.0's "D2 decided" box stays open even
  though the baseline is buildable.

### D7 — npm publication

- **Question:** should `dsh-plugin-dayflow` be published to the npm registry, and
  if so when?
- **Options:** `no` (keep "tagged here, not on the registry"), `yes` now (a
  separate reviewed step: tarball, token, 2FA), `yes at 1.0.0` (the natural first
  publish).
- **Answered: `yes` (2026-11-27).** Publication is authorised — but **nothing has
  been published**, and this answer does not mean "published". The registry still
  answers **404**, `npm whoami` on this machine answers `ENEEDAUTH`, and the
  release script does not publish: it bumps, tests, commits, tags, pushes, and
  creates the GitHub Release only. The publish is a **separate reviewed step**
  after whichever release is current, and it needs:
  - the **owner's explicit confirmation of the exact version** (a one-line
    "publish 0.10.0" is enough; D7's yes is authorisation, not a per-release
    confirmation),
  - an npm login or granular token with publish permission, plus 2FA, supplied
    outside this repository (environment/`.npmrc` outside the tree; never
    committed, never pasted into docs or chat),
  - the package name still unclaimed (`npm view dsh-plugin-dayflow version` →
    404 today), a green gated tree, and a reviewed tarball
    (`npm run check:package`, `npm pack --dry-run`; 146 files at 0.9.2).
- **Recommended order:** publish **`0.10.0` first** as the package's first npm
  version — it is the first release carrying the cloud/multi-model surface the
  answers were about, and one reviewed publish is better than a maintenance dry
  run followed by the real one. Publishing `0.9.2` first only if the owner wants
  the name claimed sooner; the reasoning and the exact preconditions are in
  [`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md) §4.
- **Unlocks:** distribution only. It is not a feature: it changes no tag, no
  line, and no code, and publication stays a separately reviewed step after
  whichever release is current. A published version is repaired by
  `npm deprecate` plus a forward patch, never by republishing.
- **If it stalls:** the version stays unpublished (safe), and **no release waits
  on it** — 1.0.0 can ship as a GitHub Release only. The "D7 decided" box is
  closed by this answer; execution is tracked, not decided.

### D10 — Phase 4 cutover (`source: owned` default)

- **Question:** after the real captured week, may `source: owned` become the
  default for a fresh capture-enabled profile?
- **Options:** `yes` (flip the default, with the first-run walkthrough and
  rollback by `source: dayflow` alone) or `no` (keep `source: dayflow` as the
  default, mirroring Dayflow while it is installed).
- **Safe default today:** `no` — `source` resolves to `dayflow` when unset, no
  default has been flipped, and Phase 4 is **rehearsed only** (`npm run
  rehearsal`). **Still open**; the explanation has been given, and the answer is
  the owner's to make.
- **Unlocks:** the cutover patch (the former 0.8.3 scope) and, with D1/D2, the
  `1.0.0` line. Without it the owned journal remains opt-in by configuration and
  the plugin keeps its Dayflow dependency for fresh profiles.
- **If unanswered:** no cutover is scheduled, the real-week record is not
  written, and 1.0.0 stays unplanned. This is unchanged by the 0.10.x line: the
  line does not touch the default backend.

### D11 — image admission

- **Question:** may the plugin admit screen pixels at all, through the host
  attachment/vision contract?
- **Options:** `no` (text-only) or `yes` with size and retention caps and a
  `privacy_apps` redaction list (the deferred 0.8.2 scope).
- **Safe default today:** `no` — there is no `dsh-attachment` peer, no
  `includeImages` key, and no `privacy_apps` list; every shipped release is
  text-only, and the 0.10.x cloud line does not change that. **Still open**; the
  explanation has been given.
- **Unlocks:** the image-admission patch (0.8.2's scope as its own theme) on a
  later line. It needs D1 (now answered `cloud`), D2 entries that are
  vision-capable, and the D11 answer itself, and once a pixel is sent it cannot
  be recalled.
- **If unanswered:** nothing changes and releases stay text-only; the recorded
  1.0.0 checklist still lists D11 as "decided", so an explicit `no`/`not now` is
  what closes that box, while an unanswered question leaves it open.

## Key safety (applies to D1/D2/D7)

- **The plugin never holds a key.** Its configuration has no `apiKey`,
  `apiKeyEnv`, `token`, or `credentials` field and it reads no secret from the
  environment; the provider call goes through the host's model service. A
  secret-shaped field accidentally written under the plugin's profile row is not
  used by the plugin, but it must not be written there in the first place.
- **Credentials live in the host profile**, either through a provider entry that
  names an **`apiKeyEnv`** credential reference (the host resolves it against
  its credential store, launch environment, or `.env`), or through the host's
  **credentials record** for sign-in flows. Rotate by replacing the stored
  reference value or the stored credential at the host; the plugin picks the
  host setup up on the next call and contains nothing to rotate.
- **No real key in this repository.** Documentation and plans use
  `apiKeyEnv`/credentials references and `<provider-id>`/`<model-id>`
  placeholders only. The only key-like string in the tree is the deliberately
  fake `FIXTURE_LLM_SECRET` in `tests/fixtures/database.ts`, which never leaves
  the fixture.
- **Rotate what was shared.** The owner pasted a key in chat; a chat paste is a
  disclosure even if nothing is committed. Rotate that key, and use only the
  rotated credential (supplied by the environment) for the cloud verification
  run. Never paste a real key into an issue, a commit, a test, or a log.
- **Cloud analysis sends text, not pixels.** While D11 is open, the request
  carries the frontmost app, window title, and frame hash (and activity text for
  the scheduled closes) — never an image. The daily call/token caps still apply,
  and `analysis.consent` remains the one switch that permits any egress.

## How to answer

One line (or a short list) is enough. D1 and D7 are already answered, so the
remaining list is:

```
D2: A — accept the named model list for now
D10: no, not now
D11: no, not now
```

or with notes:

```
D2: A+B — fall back to the second entry when a call fails
D2 note: entries are DeepSeek <model-id> first, then <model-id>
D10: yes, after the real week
D11: no, not now
```

Each answer is independent; a partial list is fine. `no`/`not now` is an answer
that keeps the safe default and changes nothing structurally — it just closes the
corresponding 1.0.0 checkbox instead of leaving it open. D2's `A` is already
buildable; choosing it explicitly closes that box.

## What each answer unlocks

| Decision | Status | Answer | Unlocks | Line |
| --- | --- | --- | --- | --- |
| D1 | **answered (2026-11-27)** | `cloud` | a real analysed day/week through an explicit cloud consent (text-only while D11 is open); adds the 3.6 disclosure to the provider docs | 0.10.x / 1.0.0 |
| D2 | **partially answered** | multiple custom models, DeepSeek first; A/B/C form open | a configurable named model entry (option A) and model calls; a vision pair would still be required for image admission; B/C await the form | 0.10.x (A baseline) / later |
| D7 | **answered (2026-11-27)** | `yes` | npm publication as a separate reviewed step (owner-confirmed version, login/token, 2FA); it changes no tag | separate step, never a tag |
| D10 | **open** | — | the Phase 4 cutover patch, first-run walkthrough, real-week record | cutover line / 1.0.0 |
| D11 | **open** | — | the image-admission patch (attachment peer, `includeImages`, `privacy_apps`, 3.6 copy) | its own theme, later line |

## How this maps to 1.0.0

- **D1 + D2** are what make 1.0.0's analysis real. D1 is answered (`cloud`) and
  option A makes a named pair configurable, so the "can an analysed week be
  recorded" half is now actionable; **D2 is only partially answered**, so its
  "decided" box stays open until the owner picks A/B/C (or explicitly accepts
  A).
- **D10 + a real captured week** is still the 1.0.0 prerequisite pair: the
  decision authorises the default flip, and the cutover line then produces the
  real-week record in [`CUTOVER_REHEARSAL.md`](CUTOVER_REHEARSAL.md) — capture
  on, `source: owned`, Dayflow closed, zero data loss across restarts.
  Engineering produces the week; only the owner can produce D10. This is
  unchanged by the 0.10.x line.
- **D7** is answered `yes`: the 1.0.0 "decided" box closes, but the publication
  itself is a separate reviewed step that needs npm credentials and the owner's
  version confirmation. 1.0.0 can ship as a tag and a GitHub Release even if the
  publish is still pending.
- **D11** unlocks image admission (the deferred 0.8.2 scope). 1.0.0 can ship
  text-only on an explicit "not now"; an unanswered D11 leaves that checklist box
  open, and 0.10.0 does not admit images either way.
- The remaining 1.0.0 prerequisites — the first-run/rollback runbook walkthrough,
  the no-Dayflow runbook, and the `dsh dayflow import` CLI — are engineering work
  the cutover line produces, not decisions on this page. The operator runbook
  itself is now written ([`RUNBOOK.md`](RUNBOOK.md)); what the cutover line still
  owes is its walkthrough against a real week.

**Not on this list, because no answer gates them:** the `dsh dayflow import` CLI
is decision-free and queued for the cutover line beside the no-Dayflow runbook
([`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §3); the owned-journal write path is a
new write surface the roadmap deliberately leaves with Dayflow for now; and the
older product-shape questions in [`ROADMAP.md`](ROADMAP.md) (mirroring, agent
session logs, injection default, proposal volume) are questions no tag waits on.
The 0.10.0 patch's own B/C and D10/D11 exclusions are recorded in
[`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md) §3.8 and §5.

## What happens now that some answers are in

- **The 0.10.x line is open.** D1 `cloud` and D7 `yes` plus D2's direction are
  enough to open the line; its first patch is **0.10.0 — cloud analysis +
  multi-model selection (option A baseline) + first-npm-publish preparation**
  ([`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md)). The 0.9.x record is unchanged and
  closed at `v0.9.1` for function, plus the 0.9.2 maintenance tag.
- **D10 and D11 still hold their defaults and their patches.** No cutover default
  is flipped, no `source: owned` default exists, and the analysis contract stays
  text-only with no attachment peer. Their absence alone keeps 1.0.0 unplanned.
- **npm publication is authorised but not performed.** The registry still answers
  404 and this machine is not logged in; publishing waits for the npm login/token
  and the owner's explicit version confirmation, and it will not create or move a
  tag.
- **Nothing is deleted or abandoned.** The shipped scope stays as it is — the
  readable journal, briefs, review queue, panel views, native capture, and
  text-only analysis on the safe defaults — and the remaining D10/D11 (plus D2's
  form) are what the later line still waits on.
