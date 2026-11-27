# Publish plan: `0.10.0`, the first npm release

[← Back to README](../README.md)

**Status: not published, and not publishable yet.** D7 is answered `yes`
(2026-11-27) — that authorises publication, it does not perform it. The name
`dsh-plugin-dayflow` still answers **404**, this machine is **not logged in** to
npm (`npm whoami` → `ENEEDAUTH`; pinned to the public registry → `E401`, so the
token line already in `~/.npmrc` is stale), `v0.10.0` is **not tagged**, and
`package.json` is still `0.9.2`. Nothing on this page has run: it is the plan,
the preconditions, the steps, the failure paths, the checklist and the record
sheet for the **one manual step that follows the tag**.

Checked against `main` @ `0d8d3c8` (`git describe --tags` → `v0.9.2-7-g0d8d3c8`),
package **0.9.2**, **583** tests on the current tree (581 at 0d8d3c8), Node v25.8.1, npm 11.11.0, macOS 15.1 (arm64),
on 2026-11-27. The `npm pack` figures quoted below were measured that day with
the commands in §8.

**Recommended first version: `0.10.0`.** The reasoning, and the `0.9.2`-first
alternative, are in [PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md) §4; this page does
not re-argue them, it makes the step checkable.

## 1. Scope: what the publish step is and is not

| | |
| --- | --- |
| **Authorised** | D7 = `yes` for npm publication as a **separate reviewed step** ([OWNER_DECISIONS.md](OWNER_DECISIONS.md#d7--npm-publication)); it changes no tag, no line, no code. |
| **Unmet** | every precondition below: owner's per-release confirmation, npm login/token, and the `v0.10.0` tag itself. |
| **Candidate** | `0.10.0` — the release that carries cloud analysis with the named model list, the additive `model` status field, and [`PROVIDERS.md`](PROVIDERS.md). |
| **Not in CI** | `.github/workflows/ci.yml` has a test matrix (`macos-15`, Node 24 and 22) that also runs `check:package`, and a `release-check` job that fails unless the tag equals `v$(package.json version)`. There is **no publish job**, and `permissions: contents: read`. |
| **Not in the release script** | `scripts/release.mjs` (invoked as `npm run release -- minor`, 0.9.2 → 0.10.0) runs `npm test`, bumps `package.json` + `package-lock.json`, commits `chore(release): v0.10.0`, creates the **annotated** tag, pushes `main` + tag, and runs `gh release create`. It refuses a dirty tree other than `CHANGELOG.md`, a non-`main` branch, or an existing tag. It does **not** publish. |
| **Not part of the tag** | The tag and its GitHub Release stand whether or not the publish happens. The publish adds **no** tag of its own; the post-publish documentary updates are a normal docs commit (no new tag). |
| **This page** | Written before the cut from `main`, not from the future tag. Every count here (tests, files, sizes, hashes) must be **re-measured at the tag**; the numbers below say what was true on 2026-11-27 and what shape to expect. |

The ordered release strategy (tag first, then publish) and the imperative not to
automate the publish are in [PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md) §3.9 and §4.
The operator-facing upgrade/rollback material is in
[RUNBOOK.md](RUNBOOK.md) §5–§6; this page only adds the registry step.

## 2. Preconditions: all of them, each verifiable

Every row must be **green** before `npm publish`. A red row stops the publish; it
does not stop the tag.

| # | Precondition | Verify | State 2026-11-27 |
| --- | --- | --- | --- |
| **P1** | **Owner confirms the exact version and the public name in writing** — a one-line "publish `dsh-plugin-dayflow@0.10.0`, public" is enough (D7's yes is authorisation, not a per-release confirmation). | the owner's message, quoted in the §6 record | **missing** |
| **P2** | **`npm whoami` succeeds** against the public registry, as the account that should own the package. | `npm whoami --registry=https://registry.npmjs.org` → a username | **fails** — `ENEEDAUTH` on the default (mirror) registry, `E401 Unauthorized` on `registry.npmjs.org`: the stored `_authToken` is stale. `npm login --registry=https://registry.npmjs.org` or a fresh granular token is required; both live **outside this repository** |
| **P3** | **The name is still unclaimed.** A 404 today is a snapshot; names can be taken at any time in between. | `curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/dsh-plugin-dayflow` → `404`; `npm view dsh-plugin-dayflow version --registry=https://registry.npmjs.org` → `E404` | **green** (404, re-check immediately before publishing) |
| **P4** | **The publish targets the public registry, not the configured mirror.** The default here is `https://registry.npmmirror.com` (`npm config get registry`), which is a read-only mirror; publish must be pinned with `--registry=https://registry.npmjs.org`. Do not edit `~/.npmrc`'s registry permanently to force it. | `npm config get registry`; every registry command in §3 carries `--registry=https://registry.npmjs.org` | **attention** — mirror is the default |
| **P5** | **The release tag is final and the source tree is clean.** The publish runs from the tagged commit, never from a dirty tree and never from `main` ahead of the tag. The tag is annotated, the version in it is `0.10.0`, and the tag push was CI-green (`test` matrix + `release-check`). | `git checkout v0.10.0`; `git describe --tags --exact-match` → `v0.10.0`; `node -p "require('./package.json').version"` → `0.10.0`; `git status --porcelain` → empty | **not yet** — no `v0.10.0` tag, `git describe` → `v0.9.2-7-g0d8d3c8` |
| **P6** | **The gates at the tag are green** (§3 step 2), including `npm test` at the cut's recorded count, `npm run typecheck`, `npm run build`, and `npm run check:package`. | the commands and outputs in §3 step 2 | **expected green** at the tag: `check:package` was measured green on 2026-11-27 (§8), the whole suite is re-run at the tag |
| **P7** | **The tarball is reviewed and clean**: required entry points present, no `src/`, `tests/`, `scripts/`, `node_modules/`, `.map`, `.tgz`, `.github/`, no secret material. | §3 step 3 audit; measured 2026-11-27 evidence in §8: **150 files / 2.56 MB packed / 4.04 MB unpacked**, 0 forbidden paths, 0 secret patterns | **green for the current tree** (this page + later docs change the count; re-measure at the cut) |
| **P8** | **2FA/OTP is available for the publishing account** (or a granular token created with 2FA-bypass for a single publish), and the operator can answer the prompt. | after login: `npm profile get tfa --registry=https://registry.npmjs.org`; whichever path is used, the record says which | **unknown while logged out** — cannot be checked before P2 |
| **P9** | **The release-semantic gates hold**: tag == `v$(package.json version)`; `0.10.0` is a stable version (no `-suffix`) so it goes to `latest`; the current `latest` is not newer than the version being published (it does not exist yet; `latest` moves forward only). | the checks in §3 step 5 | **trivially green** while the name is unpublished; re-check if a `0.9.2` name-claim publish happened first |
| **P10** | **Provenance is honestly absent.** npm only signs provenance from a supported CI OIDC context (GitHub Actions / GitLab CI); a local manual publish cannot produce it. Do **not** pass `--provenance`, and record "no provenance". | attempt only if a CI publish job is ever added; see §5 | **not available** — local publish |

## 3. The steps, in order

Run from a **checkout of the tag**, with `--registry=https://registry.npmjs.org`
on every command that talks to the registry. Stop at the first failure and go to
§4; never continue past a red step.

### Step 0 — owner confirmation

P1 above. Record the owner's line, the version, the name, and the intended npm
account. The publishing account **becomes the package owner** (an unscoped name
has no org model), so confirm it is the intended one before the first publish.

### Step 1 — checkout the tag and prove identity

```sh
cd dsh-plugin-dayflow
git fetch --tags
git checkout v0.10.0
git describe --tags --exact-match            # v0.10.0
node -p "require('./package.json').version"  # 0.10.0
git status --porcelain                       # empty
```

If the describe line prints anything other than `v0.10.0`, or the tree is not
clean, stop — you would be building an artifact the tag does not name.

### Step 2 — re-run the gates at the tag

```sh
npm ci
npm test          # the cut's recorded count; 583 on the quality-pass tree, 581 at 0d8d3c8, 557 at v0.9.2
npm run typecheck # exit 0, no output
npm run build     # host (tsc) and client bundle
npm run check:package   # ok · N files · X MB packed · Y MB unpacked
```

Plus the two CI legs on the tag push: `test` (Node 24, Node 22 with
`--experimental-sqlite`) and `release-check` (tag == version). The cut itself
already proved the non-reproducible gates in [PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md)
§3.9: default profile inert, no secret in diff/docs/tests, contract proof, and
the **real-cloud smoke** — that one is a tag gate and cannot be re-derived here;
if it was not run, `0.10.0` is not tagged and this page does not apply.

`npm test` builds first (`prepack`/`build`), so `lib/` in the working tree comes
from the tag's `src/`; `lib/` is gitignored and never committed — the published
artifact is built at publish time from the tagged source, which is why the
checkout must be the tag.

### Step 3 — audit the tarball

```sh
# in the v0.10.0 checkout
mkdir -p /tmp/dayflow-publish-0.10.0
npm pack --dry-run --json > /tmp/dayflow-publish-0.10.0/pack.json
node scripts/check-package.mjs /tmp/dayflow-publish-0.10.0/pack.json   # tolerates the build banner
npm pack --pack-destination /tmp/dayflow-publish-0.10.0
cd /tmp/dayflow-publish-0.10.0
```

Then check the artifact, not just the report:

```sh
shasum -a 1 dsh-plugin-dayflow-0.10.0.tgz
openssl dgst -sha512 -binary dsh-plugin-dayflow-0.10.0.tgz | openssl base64 -A   # sha512-<b64> == pack.json .integrity
tar -tzf dsh-plugin-dayflow-0.10.0.tgz | sed 's#^package/##' | grep -v '^$' | sort > tar-files.txt
# required: package.json, lib/index.js, lib/client.js, lib/types/index.d.ts,
#           cordis.patch.yml, README.md, README.zh.md, CHANGELOG.md, LICENSE,
#           skills/{dayflow,long-task,memory,onboarding,reflection,review-queue,standup,weekly-review}/SKILL.md
# forbidden: ^(src|tests|\.test-build|\.github|scripts|node_modules|out)/ · *.tgz · *.map · *.tsbuildinfo · non-declaration .ts
```

Record `file count`, `size`, `unpackedSize`, `shasum`, `integrity` from
`pack.json`, and compare the file list with the accepted `npm pack --dry-run`
list — the published file list must be identical to the audited one. `pack.json`
is not pure JSON: `npm pack --json` prints the build banner on stdout before the
array (`built lib/client.js (188.0 kB)`), which is why `check-package.mjs` starts
at the first line that opens `[`. Any other reader (node, `jq`) must slice from
that line too. Also grep the extracted tree for credential shapes (`sk-…`,
`ghp_…`, `AKIA…`, `-----BEGIN … PRIVATE KEY`, `_authToken`, `Bearer <token>`):
expected hits are only documentation naming a **reference** (`apiKeyEnv`), never
a value.

### Step 4 — review `npm publish --dry-run` (operator, part of the publish step)

```sh
npm publish --dry-run --access public --registry=https://registry.npmjs.org
```

This sends nothing. Confirm the printed contents, that the version is `0.10.0`,
the name is `dsh-plugin-dayflow`, no `src/`/`tests/`/`scripts/`, and that the
`latest` tag is the intended destination. **This page's author did not run it** —
it belongs to the publish step and to the operator holding the credentials.
(The dry run is also where a wrong `package.json` version or a wrong registry
shows up cheaply.)

### Step 5 — publish, once

```sh
# the pre-publish semantic checks (P9)
VERSION="$(node -p "require('./package.json').version")"     # 0.10.0
TAG="$(git describe --tags --exact-match)"                   # v0.10.0
[ "$TAG" = "v$VERSION" ] || { echo "tag/version mismatch"; exit 1; }
LATEST="$(npm view dsh-plugin-dayflow dist-tags.latest --registry=https://registry.npmjs.org 2>/dev/null || true)"
node -e 'const [v,l="0.0.0"]=process.argv.slice(1); const p=s=>s.split("-")[0].split(".").map(Number);
  const a=p(v), b=p(l); const cmp=b[0]-a[0]||b[1]-a[1]||b[2]-a[2];
  if (cmp>0) { console.error(`refusing: latest ${l} is newer than ${v}`); process.exit(1); }
  console.log(`ok: latest ${l} is not newer than ${v}`)' "$VERSION" "${LATEST:-0.0.0}"

# the publish itself — stable version, default dist-tag `latest`, no `--tag`
npm publish --access public --registry=https://registry.npmjs.org
```

`0.10.0` has no prerelease suffix, so it must go to `latest`; do **not** pass
`--tag next`/`--tag alpha`. `--access public` is explicit and harmless for an
unscoped name. If the account uses 2FA, npm prompts for the one-time code:
answer the prompt, do not put the code on a command line where a shell or log
keeps it, and never paste it into chat or a document.

### Step 6 — verify the registry artifact (do not skip)

```sh
R=https://registry.npmjs.org
npm view dsh-plugin-dayflow version --registry=$R              # 0.10.0
npm view dsh-plugin-dayflow dist-tags --registry=$R            # { latest: '0.10.0' }
npm view dsh-plugin-dayflow@0.10.0 dist.integrity dist.shasum --registry=$R
# must equal the audited pack.json .integrity and .shasum

cd /tmp && rm -rf pub-verify && mkdir pub-verify && cd pub-verify
npm pack dsh-plugin-dayflow@0.10.0 --registry=$R
tar -tzf dsh-plugin-dayflow-0.10.0.tgz | sed 's#^package/##' | grep -v '^$' | sort \
  | diff - /tmp/dayflow-publish-0.10.0/tar-files.txt   # identical file list
```

Then the consumer layer, in an **isolated profile root** — never the operator's
real `web` profile: download/install the published package, link it into a copy
of the shipped `web` profile the way [RUNBOOK.md](RUNBOOK.md) §2 does for a
checkout (`~/.dsh/profiles/<name>/node_modules/dsh-plugin-dayflow` + the
`dsh.profile.bundles` row), boot that profile, and confirm the bundle row mounts:
the panel's Journal insights view opens and one read question answers (e.g.
`dayflow_status`). A `--dump-config` row alone proves registration, not a mount;
the heavier Web check (bundle registers, DOM mounts, no page errors) is the same
one [RUNBOOK.md](RUNBOOK.md) §1 describes for a checkout.

If the registry verification disagrees with the audited artifact, stop and go to
§4 — the version is already published, so the repair is deprecate + forward
patch, not republish.

### Step 7 — record the result and update the documents (docs commit, no tag)

Fill the §6 record (date, version, tag, sha, npm user, OTP path, registry URL,
`latest`, file count, packed size, shasum, integrity, verification results,
consumer-smoke result). Then one docs commit — **no new tag, no tag rewrite** —
updating what the publish changes:

- [README.md](../README.md) / [README.zh.md](../README.zh.md): the install line
  stops saying "from a checkout only" and names the published version; the status
  banner records D7 executed.
- [OWNER_DECISIONS.md](OWNER_DECISIONS.md): D7's "Unlocks" gains the publication
  date/version; the "nothing published" line is corrected.
- [RUNBOOK.md](RUNBOOK.md) §1: the health check `npm view dsh-plugin-dayflow
  version` expectation moves from `E404` to `0.10.0`; §5's "nothing is on npm"
  sentence is corrected.
- [ROADMAP.md](ROADMAP.md) and [CHANGELOG.md](../CHANGELOG.md): the published
  fact and this page's status header.
- This file: status line and the filled record.

Do not move, re-create, or annotate `v0.10.0` for the publish; its GitHub Release
was already created by `scripts/release.mjs` from the CHANGELOG section.

## 4. Failure paths and rollback

The safe rule is the documented one in
[PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md) §4: **a bad publish is repaired by
`npm deprecate` plus a forward patch, never by republishing the same version.**
Before any registry write, a failure changes nothing at all.

| Situation | Registry state | Action | Never |
| --- | --- | --- | --- |
| P1 absent / owner does not confirm | nothing written | stop; tag + Release stand; version stays unpublished; record it | publish on the strength of D7 alone |
| P2–P4 red (auth, name, registry target) | nothing written | fix the credentials/registry and re-run Step 4–5; nothing to roll back | publish through the mirror, or commit an `.npmrc` |
| `npm publish` returns 402/403 | nothing written | confirm the account and that the name is free; if the name was taken, **stop** — a rename is an owner decision, not a rescue | invent a scope or rename unilaterally |
| publish fails mid-way (network/registry 5xx) | **unknown** | check `npm view … version` first: absent → one retry; present → treat as published and go to Step 6 | blind retries (a retried publish can only fail as "version exists", and a half-state is worse than a quiet re-check) |
| published, but the artifact/metadata is wrong or vulnerable | version exists permanently | `npm deprecate dsh-plugin-dayflow@0.10.0 "<reason>"`; fix; bump patch (`0.10.1`), tag, publish the patch | republish `0.10.0`; delete the git tag; force-push |
| wrong `latest` (e.g. moved backwards by an older version) | version exists | `npm dist-tag add dsh-plugin-dayflow@0.10.0 latest` (or `npm dist-tag rm` on the bad tag); record it | leave `latest` pointing at the wrong version |
| token or OTP leaked | — | revoke the token at the npm account immediately, issue a new one, publish the version once with it; if already published, no republish — deprecate/patch as above | "rotate later"; paste the new token anywhere |
| artifact needs a real recall | version exists | `npm deprecate` (visible warning) + forward patch; `npm unpublish` only inside the registry's current policy window (currently narrow: recently published, no dependents) and **only with the owner's explicit agreement** | unpublish as the first repair |

Two boundaries that do not change: the **runtime** rollback is config-first —
`analysis.consent: none`, clear `analysis.models`/the pair, remove the provider
row; a default profile is inert with no code change (R8 in
[PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md) §4). The **version** rollback on a
checkout install stays `git checkout <older tag>` + `npm ci` + `npm run build`
([RUNBOOK.md](RUNBOOK.md) §6); the npm artifact is not a rollback path, because a
published version cannot be withdrawn cleanly.

## 5. Security

- **Token.** Only two acceptable sources: `npm login` (writes `~/.npmrc`, outside
  this repository) or a granular publish token referenced from `~/.npmrc` as
  `${NPM_TOKEN}` with the value only in the environment of the publishing shell
  (npm expands `${VAR}` references in `.npmrc`; it does not read a bare
  `NPM_TOKEN`/`NODE_AUTH_TOKEN` variable by itself). It is never committed, never
  put in `package.json`/`publishConfig`, never pasted into docs, chat, an issue,
  a test fixture, or a CI log. Do not run the publish with `set -x`. The stale
  `//registry.npmjs.org/:_authToken` line that is already in `~/.npmrc` answers
  **401**; replace it, and never print it.
- **The publishing account owns the name.** An unscoped package has no org
  permission model — the first account to publish becomes the owner. Confirm the
  account (P1) before Step 5; a wrong account is an npm-support problem, not a
  re-publish.
- **2FA and the OTP.** Check the account's 2FA mode after login
  (`npm profile get tfa`). Answer npm's prompt interactively; do not pass the code
  on a shared command line and do not record it. The §6 record asks for the
  *result* (`accepted`/not used), never the code.
- **Tarball.** Measured clean on 2026-11-27 (§8): no `src/`, `tests/`, `scripts/`,
  `node_modules/`, `.map`, `.tgz`, `.github/`; no credential-shaped string. The
  only key-adjacent text is documentation naming a **reference** (`apiKeyEnv`),
  and the fake fixture name `FIXTURE_LLM_SECRET` appears only in docs — the
  fixture itself lives in `tests/` and does not ship. The plugin stores no
  credential and reads no key (the host resolves `apiKeyEnv`); keep it that way —
  a `publishConfig` token or any key written into the repo would be a disclosure.
- **The key pasted in chat is already a disclosure** ([PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md)
  §6 risk 2). Rotate/revoke it independently of this release; publishing does not
  depend on it and must not use it.
- **Provenance is absent, and recorded as absent.** In the installed npm 11.11.0,
  provenance generation (`libnpmpublish/lib/publish.js`) throws
  `Automatic provenance generation not supported for provider: …` unless it runs
  under GitHub Actions (with `id-token: write`) or GitLab CI. This repository's CI
  has `permissions: contents: read` and no publish job, so a manual local publish
  produces **no attestation**. Do not pass `--provenance`, and do not claim one.
  If provenance is wanted later, that is a separate CI publish workflow with OIDC,
  not a flag on this step.
- **Post-publish audit.** Do not trust the local report alone: re-download the
  published tarball, diff its file list against the audited list, and compare
  `dist.integrity`/`dist.shasum` (Step 6). Keep the pack JSON and hashes with the
  record.
- **Logs.** npm writes debug logs under `~/.npm/_logs`; they are outside the repo
  and must stay there. Do not attach them to a commit, an issue, or a chat.

## 6. Checklist and record

### 6.1 Checklist (tick in the record; a blank box is a stop)

Preconditions
- [ ] P1 owner's written confirmation of `dsh-plugin-dayflow@0.10.0`, public
- [ ] P2 `npm whoami --registry=https://registry.npmjs.org` returns the intended account
- [ ] P3 name still 404 at the public registry (re-checked minutes before the publish)
- [ ] P4 every publish/verify command pins `--registry=https://registry.npmjs.org`
- [ ] P5 `git checkout v0.10.0`; `describe --exact-match` = `v0.10.0`; version `0.10.0`; tree clean
- [ ] P5b tag push CI green: `test` matrix (Node 24/22) and `release-check`
- [ ] P6 `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `npm run check:package` green
- [ ] P7 tarball audited: required files present, no forbidden paths, no secrets, list accepted
- [ ] P8 2FA/OTP path chosen and available to the operator
- [ ] P9 tag==version; stable → `latest`; current `latest` not newer
- [ ] P10 provenance recorded as absent (not passed, not claimed)

Publish
- [ ] Step 3 pack recorded (files/size/shasum/integrity)
- [ ] Step 4 `npm publish --dry-run` reviewed (operator; sends nothing)
- [ ] Step 5 `npm publish --access public` accepted exactly once
- [ ] Step 6 `npm view` version + dist-tags correct; artifact identity matches
- [ ] Step 6 published tarball file list identical to the audited list
- [ ] Step 6 consumer mount smoke passed (isolated profile, not the real one)
- [ ] Step 7 record filled and docs commit made (no tag)

### 6.2 Record (blank — fill once, do not overwrite history)

| Field | Value |
| --- | --- |
| Date / time (local, with zone) | |
| Version | `0.10.0` (expected) |
| Tag | `v0.10.0` |
| Release commit sha | |
| Annotated tag object sha | |
| Package name / registry | `dsh-plugin-dayflow` / `https://registry.npmjs.org` |
| npm user (owner) | |
| 2FA path (prompt / granular token w/ bypass) | |
| OTP result (accepted / not used — never the code) | |
| Publish command + result | |
| `dist-tags` after publish | |
| File count (packed) | |
| Packed size / unpacked size | |
| `shasum` (sha1) | |
| `integrity` (sha512) | |
| `npm publish --dry-run` reviewed by | |
| Artifact identity check (local == registry) | |
| Consumer mount smoke (profile / result) | |
| Failure or anomaly (if any) | |
| Follow-up (deprecate/patch/docs) | |
| Recorded by | |

## 7. What the owner must do

Three things, none of which the repository can do for them:

1. **Log this Mac in to npm** — `npm login --registry=https://registry.npmjs.org`
   (interactive, with the 2FA prompt), or supply a granular **publish** token via
   `~/.npmrc` outside the repository. Until then `npm whoami` fails and every
   publish attempt stops before the registry.
2. **Confirm the release in one line** — "publish `dsh-plugin-dayflow@0.10.0`,
   public". D7's `yes` authorises the act; this line is the per-release
   confirmation the act waits for.
3. **Confirm the account and the public default** — the publishing account becomes
   the package owner (unscoped names have no org model), and the package is
   intended to be **public** (the default). Say so, or say otherwise now.

And one independent item: **rotate the API key that was pasted into chat**
([PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md) §6 risk 2). The GitHub side is already
ready — `gh` is authenticated as `tailong-wu` on this machine — so npm is the only
missing credential.

## 8. Measured evidence (2026-11-27, `main` @ `0d8d3c8`)

Run from the repository root at package `0.9.2` (the pre-release state of the
0.10 line), Node v25.8.1, npm 11.11.0:

```sh
$ npm whoami
npm error code ENEEDAUTH            # not logged in on the default (mirror) registry
$ npm whoami --registry=https://registry.npmjs.org
npm error code E401                 # a token line exists in ~/.npmrc but is stale
$ npm view dsh-plugin-dayflow version --registry=https://registry.npmjs.org
npm error code E404                 # the name is unclaimed
$ curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/dsh-plugin-dayflow
404
$ npm config get registry
https://registry.npmmirror.com      # a mirror — publish must pin the public registry
$ npm pack --dry-run --json > /tmp/dayflow-pack.json
$ node scripts/check-package.mjs /tmp/dayflow-pack.json
check-package: ok · 150 files · 2.56 MB packed · 4.04 MB unpacked
```

`npm pack --json` prints the client-build banner before the JSON array, so the
file holds text before the JSON (the guard reads from the first `[` line). The
tarball itself (`npm pack --pack-destination /tmp/dayflow-tarball-audit`),
unpacked and audited, was byte-identical to what the dry run described:

| | |
| --- | --- |
| Files | **150** (`lib/` 111, `docs/` 24, `skills/` 8 — each with `SKILL.md` — plus `package.json`, `cordis.patch.yml`, `README.md`, `README.zh.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`) |
| Packed / unpacked | **2,688,502 B = 2.56 MB** / 4,237,380 B = 4.04 MB |
| `shasum` (sha1) | `7524e587cba3bdada872e37bef37adaa8b3c443d` |
| `integrity` (sha512) | `sha512-4YC9YnTTrykbbvzFIwhqlnrUQHhSt9vyhxIR0kZyFbLkJHWsCz/pQeAdvWp+PopIoSDWedcV6g2HuKPCJjFDlQ==` |
| Forbidden paths | none (`src/`, `tests/`, `scripts/`, `node_modules/`, `.test-build/`, `.github/`, `out/`, `*.tgz`, `*.map`, `*.tsbuildinfo`, non-declaration `.ts` all zero) |
| Secret scan | none (`sk-…`, `ghp_…`, `AKIA…`, private-key blocks, `_authToken`, `Bearer <token>` all absent; `apiKeyEnv` appears as a reference name only; `FIXTURE_LLM_SECRET` appears only in prose in the docs) |
| Real `npm pack` vs dry run | byte size 2,688,502 identical; the 150-entry file list is identical |

These hashes are for the `0.9.2`-labelled current tree and **will change at the
cut** (version bump, doc updates, this page). Record the `0.10.0` values at the
cut instead of copying these.

**Reconciling the earlier counts.** [PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md) §4
and [OWNER_DECISIONS.md](OWNER_DECISIONS.md) record **146 files at the 0.9.2
cut** (§4 says 2.64 MB packed; [RUNBOOK.md](RUNBOOK.md) §1's `check:package` line
says 2.52 MB — the two pre-date the 0.10 docs and disagree only on size). The
current tree is **+4** files: two added docs that ship (`docs/PATCH_PLAN_0.10.md`,
`docs/PROVIDERS.md`) and two new `lib/` entries from the new module
(`lib/analyse/models.js`, `lib/types/analyse/models.d.ts`) — 146 + 4 = 150.
Because `docs/` is in `files`, **this page ships too**: the 0.10.0 cut should be
**≥ 151 files**, and the exact number is whatever `npm run check:package` prints
at the tag. The two GIFs and six PNGs under `docs/` are ~1.99 MB of the 2.56 MB
packed size — deliberate, they make the README's recordings work off-repository;
not a defect, and not worth changing on this step.

## 9. Related pages

- [PATCH_PLAN_0.10.md](PATCH_PLAN_0.10.md) §3.9 (gate order, publish preconditions) and §4 (release strategy, rollback, `0.9.2`-first alternative)
- [OWNER_DECISIONS.md](OWNER_DECISIONS.md) D7 (authorisation, prerequisites, "if it stalls")
- [RUNBOOK.md](RUNBOOK.md) §1 (health checks), §5 (upgrade between tags), §6 (rollback)
- [ROADMAP.md](ROADMAP.md) (§0.10.x status), [CHANGELOG.md](../CHANGELOG.md) (`[Unreleased]` entry for 0.10.0)
- `scripts/release.mjs` (bump + tag + GitHub Release, no publish), `scripts/check-package.mjs` (tarball guard), `.github/workflows/ci.yml` (test matrix + tag `release-check`)
