# Owner decisions: the five answers the next line waits on

> Status: **open — the project is in maintenance, paused pending these five
> answers, not abandoned.** Measured on the `v0.9.2` tree (`ccac653`): **22 tags /
> 22 GitHub Releases**, **557** green tests, schema **v10**, **18** panel routes,
> **5** slash commands, **23** tools, **8** skills, DSH `0.2.2-rc.5` declared and
> pinned in the development dependencies, and npm still **404** (never
> published). Nothing on this page has been answered as of 2026-11-27.
>
> **After the one 0.9.2 compatibility patch, no further patch is opened and no
> `1.0.0` is planned until the owner answers.**
> Maintenance is verification and necessary fixes only. This is a pause, not a
> step toward abandonment: the shipped scope works on the safe defaults, and the
> evaluation that found no further decision-free patch worth a tag is recorded in
> [`ROADMAP.md`](ROADMAP.md) §0.9.x *After 0.9.1 — maintenance*.

## The one-page list

Answer each in one line. Every decision has a default that keeps the current
behaviour if it is skipped, so a partial answer is safe; an **unanswered**
decision is not the same as a **"not now"** answer for the `1.0.0` checklist,
which asks for each decision to be *decided*.

### D1 — analysis destination

- **Question:** may screen metadata (and, only if D11 says yes, pixels) leave
  the Mac for analysis, and whose model reads it?
- **Options:** `none` (nothing leaves the machine), `local` (a model running on
  this Mac), `cloud` (a provider that may proxy out).
- **Safe default today:** `none` — `analysis.consent` defaults to `none`; capture
  and the analysis code ship, but a default profile makes no analysis call, no
  run leaves the machine, and the panel says why; no analysed week is recorded.
- **Unlocks:** `local`/`cloud` unlock a real analysed day and the analysed week
  the cutover line wants. `cloud` additionally requires the Roadmap 3.6
  limitation copy (a paused app's window is skipped, but nothing can tell what is
  inside a browser tab) to be approved with it. `none` narrows the cutover to
  capture-only and pushes the analysed week later.
- **If unanswered:** analysis stays inert, the 1.0.0 prerequisite "D1/D2
  answered for an analysed week" stays unmet, and the project stays in
  maintenance.

### D2 — provider and model

- **Question:** which provider/model pair should analysis use — and, if D11 is
  ever yes, which **vision-capable** pair reads frames?
- **Options:** an explicit `analysis.provider` + `analysis.model` pair; for the
  image path a pair that can see images.
- **Safe default today:** no implicit host default. The pair must be set
  explicitly; empty means "not configured" and jobs are `skipped` (this rule is
  settled and shipped since 0.7.1). The plugin never chooses a vendor for the
  owner.
- **Unlocks:** a working pair is what turns the analysis code into a real
  analysed week for 1.0.0; image admission (D11) needs a vision-capable pair on
  top of D1.
- **If unanswered:** analysis jobs stay `skipped` for want of a configured pair,
  the 1.0.0 analysed-week prerequisite stays unmet, and no model call is made.

### D7 — npm publication

- **Question:** should `dsh-plugin-dayflow` be published to the npm registry, and
  if so when?
- **Options:** `no` (keep "tagged here, not on the registry"), `yes` now (a
  separate reviewed step: tarball, token, 2FA), `yes at 1.0.0` (the natural first
  publish).
- **Safe default today:** `no` — the package is **404** on npm; every release is
  a tag and a GitHub Release only.
- **Unlocks:** publication only. It is distribution, not a feature: it changes no
  tag, no line, and no code, and publication stays a separately reviewed step
  after whichever release is current.
- **If unanswered:** stays unpublished (safe), and **no release waits on it** —
  unlike D10/D1/D2, D7 does not block 1.0.0; 1.0.0 can ship as a GitHub Release
  only.

### D10 — Phase 4 cutover (`source: owned` default)

- **Question:** after the real captured week, may `source: owned` become the
  default for a fresh capture-enabled profile?
- **Options:** `yes` (flip the default, with the first-run walkthrough and
  rollback by `source: dayflow` alone) or `no` (keep `source: dayflow` as the
  default, mirroring Dayflow while it is installed).
- **Safe default today:** `no` — `source` resolves to `dayflow` when unset, no
  default has been flipped, and Phase 4 is **rehearsed only** (`npm run
  rehearsal`).
- **Unlocks:** the cutover patch (the former 0.8.3 scope) and, with D1/D2, the
  `1.0.0` line. Without it the owned journal remains opt-in by configuration and
  the plugin keeps its Dayflow dependency for fresh profiles.
- **If unanswered:** no cutover is scheduled, the real-week record is not
  written, 1.0.0 stays unplanned, and the project stays in maintenance.

### D11 — image admission

- **Question:** may the plugin admit screen pixels at all, through the host
  attachment/vision contract?
- **Options:** `no` (text-only) or `yes` with size and retention caps and a
  `privacy_apps` redaction list (the deferred 0.8.2 scope).
- **Safe default today:** `no` — there is no `dsh-attachment` peer, no
  `includeImages` key, and no `privacy_apps` list; every shipped release is
  text-only.
- **Unlocks:** the image-admission patch (0.8.2's scope as its own theme) on the
  next line, or before 1.0.0 if the owner schedules it. It needs D1 and a
  vision-capable D2 as well, and once a pixel is sent it cannot be recalled.
- **If unanswered:** nothing changes and releases stay text-only; the recorded
  1.0.0 checklist still lists D11 as "decided", so an explicit `no`/`not now` is
  what closes that box, while an unanswered question leaves it open.

## How to answer

One line (or a short list) is enough. The provider and model in the example are
placeholders — write the pair you actually want:

```
D1: local, D2: deepseek/vision-x, D7: no, D10: no, D11: no
```

or with notes:

```
D1: cloud — okay for screen metadata, still no images
D2: <provider>/<model>
D7: no
D10: yes, after the real week
D11: no, not now
```

Each answer is independent; a partial list is fine. `no`/`not now` is an answer
that keeps the safe default and changes nothing structurally — it just closes the
corresponding 1.0.0 checkbox instead of leaving it open.

## What each answer unlocks

| Decision | Answer | Unlocks | Line |
| --- | --- | --- | --- |
| D1 | `local` / `cloud` | a real analysed day, then the analysed week (`cloud` adds the 3.6 copy) | cutover line / 1.0.0 |
| D2 | a provider/model pair | model calls become possible; a vision pair is required for image admission | cutover line / 1.0.0 |
| D7 | `yes` | npm publication (reviewed pack, token, 2FA) | separate step, never a tag |
| D10 | `yes` | the Phase 4 cutover patch, first-run walkthrough, real-week record | cutover line / 1.0.0 |
| D11 | `yes` | the image-admission patch (attachment peer, `includeImages`, `privacy_apps`, 3.6 copy) | its own theme on the next line |

## How this maps to 1.0.0

- **D1 + D2** are what make 1.0.0's analysis real. Without them the analysed week
  cannot be recorded; a cutover under `consent: none` narrows 1.0.0 to
  capture-only and pushes the analysed week later.
- **D10 + a real captured week** is the 1.0.0 prerequisite pair: the decision
  authorises the default flip, and the cutover line then produces the real-week
  record in [`CUTOVER_REHEARSAL.md`](CUTOVER_REHEARSAL.md) — capture on,
  `source: owned`, Dayflow closed, zero data loss across restarts. Engineering
  produces the week; only the owner can produce D10.
- **D7** affects publication only. It is listed in the 1.0.0 checklist as
  "decided", but the safe default ships no publish: an explicit `no` keeps 1.0.0
  a tag and a GitHub Release, and no engineering work waits on it.
- **D11** unlocks image admission (the deferred 0.8.2 scope). 1.0.0 can ship
  text-only on an explicit "not now"; an unanswered D11 leaves that checklist box
  open.
- The remaining 1.0.0 prerequisites — the first-run/rollback runbook, the
  no-Dayflow runbook, and the `dsh dayflow import` CLI — are engineering work the
  cutover line produces, not decisions on this page. The operator runbook itself
  is now written ([`RUNBOOK.md`](RUNBOOK.md)); what the cutover line still owes
  is its walkthrough against a real week.

**Not on this list, because no answer gates them:** the `dsh dayflow import` CLI
is decision-free and queued for the cutover line beside the no-Dayflow runbook
([`PATCH_PLAN_0.9.md`](PATCH_PLAN_0.9.md) §3); the owned-journal write path is a
new write surface the roadmap deliberately leaves with Dayflow for now; and the
older product-shape questions in [`ROADMAP.md`](ROADMAP.md) (mirroring, agent
session logs, injection default, proposal volume) are questions no tag waits on.

## What happens while these are unanswered

- **One maintenance patch, then no new tag.** `0.9.2` (DSH `0.2.2-rc.5`
  declaration and verification) was taken because the installed host had moved;
  no `0.10.0` or `1.0.0` is planned from this revision, and the six
  decision-free candidates evaluated after 0.9.1 remain judged not worth a tag
  ([`ROADMAP.md`](ROADMAP.md) §0.9.x).
- **Maintenance only.** Verification and necessary fixes may happen (a broken
  build, a security fix, a green suite re-run); no functional work is opened, and
  no shipped count, route, command, tool, skill, schema step, default, or peer is
  changed by this page.
- **Nothing is deleted or abandoned.** The shipped scope stays as it is — the
  readable journal, briefs, review queue, panel views, native capture, and
  text-only analysis on the safe defaults — and the five answers above are the
  only thing the next line is waiting on.
