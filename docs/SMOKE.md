# Cloud smoke: the provider-level tag gate

[← Back to README](../README.md)

> **Status: the tool and this page are new in the 0.10.0 line; no real-key PASS
> is recorded yet.** Checked against `main` @ `d722892` on **2026-11-27**,
> package still **0.9.2** (the version bump happens at the cut), Node v25.8.1,
> macOS 15.1 (arm64). The 0.10.0 implementation is complete and **untagged**;
> its hard gate is one recorded **provider-level** real-cloud run
> ([`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md) §3.7 "Real-cloud smoke — the tag
> gate" and §3.9 gate order item 8, with the publish preconditions in
> [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md) §2). `scripts/cloud-smoke.mjs` is that
> gate made **executable one command at a time**: it runs the shipped analysis
> prompt, host adapter, and retry/usage wrapper against a real
> OpenAI-compatible provider and writes a key-free record. Do not call the
> cloud path "verified" until one `PASS` record exists.

## 1. What this smoke is — and what it is not

The script makes **one** provider call, but every layer between the prompt and
the answer is the shipped code (`lib/`, built from `src/`):

| Layer | What the smoke uses | What it proves |
| --- | --- | --- |
| Prompt | `buildAnalysisPrompt` from `lib/analyse/prompt.js`, over a fake 10-minute window with three frame metadata rows and the category list `Work, Communication, Research, Other` | the production prompt text: data-not-instructions boundary, bounded user message, JSON-only contract |
| Host seam | a local `HostLlmLike` that `POST`s to `<baseURL>/chat/completions` (`Authorization: Bearer <key>`, `stream: false`, `max_tokens: 512`) and yields the content as one `text-delta`, the usage as one `usage` chunk | the real provider accepts the request shape the DSH host adapter builds, and reports a chat-completions answer |
| Adapter | `createHostAnalyser` from `lib/analyse/host.js` | the production stream→result adapter |
| Wrapper | `callAnalysisModel` from `lib/analyse/llm.js` | the per-attempt timeout, two retries with backoff, cancellation, and the token accounting that the ledger uses |
| Answer | the pipeline's public JSON contract, re-stated in the script | a `PASS` answer is one the real pipeline validator would accept |

**Boundary.** This is a **provider-level** smoke. It does **not** exercise:

- the DSH host (`dsh web`/Desktop), its `llm` service, or the DSH credential
  seam — the key here comes from **your shell environment**, not
  `$DSH_HOME/.credentials.yaml`;
- Dayflow capture, screen-recording permission, frame files, or any real
  screen data (the window is a fixture);
- the analysis-job ledger (`analysis_jobs`), the activity/observation rows, the
  panel status line, the daily token budget, or the automation closes.

The plan makes that boundary part of the gate: §3.7 and §3.9 define the hard
gate as one **provider-level** `cloud-smoke.mjs` PASS record, and explicitly
make no captured-window, `analysis_jobs`, or activity-row claim. If the
operator also observes the full DSH chain (capture → window → job → activity
row), that is useful context but is not produced or evidenced by this tool —
record it separately and do not attribute it to this script.

The script changes nothing in the repository and reads no journal; with no
`--record` it writes no file at all.

## 2. Prerequisites

- **Node ≥ 22.5** (the package's `engines`; the script uses global `fetch`,
  ESM top-level `await`, and `performance`). Checked on Node v25.8.1.
- **The checkout to be tagged**, with dependencies installed and **built**:
  `npm install && npm run build`. `lib/` is gitignored and this script imports
  the built JS, so a missing build is an immediate exit 2 with
  `run npm run build`. A stale build is not detected — build at the commit you
  are recording.
- **A provider key.** DeepSeek is the default (`https://api.deepseek.com/v1`,
  model `deepseek-chat`); any OpenAI-compatible `/chat/completions` endpoint
  works through `SMOKE_BASE_URL`/`SMOKE_MODEL`. Use a **dedicated, low-budget**
  key for smoke runs, and rotate it if it ever reaches a shell log, a chat, a
  ticket, or a commit.
- **Network egress** to the provider host. No npm registry interaction: this
  gate is registry-independent and makes no publish step.
- **One cloud call's cost.** The call's output is capped at **512 tokens**; a
  failing provider call or timeout retries twice (at most three small calls).
  Token counts are printed and, with `--record`, written to the record.

The key is **not** read from the DSH profile or the DSH credential store. If
yours lives only in **Settings → Models**, export it into this shell from your
password manager for the run — never copy it into chat.

## 3. The command

```sh
npm run build

# DeepSeek defaults; prompt for the key so it is not written to shell history
read -rs SMOKE_API_KEY && export SMOKE_API_KEY
node scripts/cloud-smoke.mjs --record "/tmp/dayflow-cloud-smoke-$(date +%Y-%m-%d).json"
unset SMOKE_API_KEY
```

`read -s` keeps the key out of history. The same run with an already-exported
`DEEPSEEK_API_KEY`, or against another provider:

```sh
# fallback name: DEEPSEEK_API_KEY is used when SMOKE_API_KEY is unset
read -rs DEEPSEEK_API_KEY && export DEEPSEEK_API_KEY
node scripts/cloud-smoke.mjs --record /tmp/dayflow-cloud-smoke.json
unset DEEPSEEK_API_KEY

# any OpenAI-compatible endpoint
read -rs SMOKE_API_KEY && export SMOKE_API_KEY
SMOKE_BASE_URL=https://gateway.example.com/v1 SMOKE_MODEL=provider-model \
  node scripts/cloud-smoke.mjs --record /tmp/dayflow-cloud-smoke.json
unset SMOKE_API_KEY
```

| Input | Flag | Env | Default | Notes |
| --- | --- | --- | --- | --- |
| key | — | `SMOKE_API_KEY`, fallback `DEEPSEEK_API_KEY` | — | missing/blank → exit 2; **never printed**; only the variable name is shown |
| base URL | `--base-url <url>` | `SMOKE_BASE_URL` | `https://api.deepseek.com/v1` | `/chat/completions` is appended; a full endpoint is accepted; a URL embedding `user:pass@` is refused; a query token is allowed but **stripped from display and record** |
| model | `--model <id>` | `SMOKE_MODEL` | `deepseek-chat` | sent as the request's `model` |
| per-attempt timeout | `--timeout-ms <n>` | — | the plugin's `ANALYSIS_CALL_TIMEOUT_MS` (60000) | positive integer; the call is retried twice after a timeout |
| record | `--record <path>` | — | off | JSON, **no key**; recommended under `/tmp`; a relative path resolves from the current directory |
| help | `-h`, `--help` | — | — | prints usage, exit 0 |

Flags win over env; env wins over the defaults. Unknown flags are a usage error
(no silent fallback to a default endpoint). Exit codes:

| Code | Meaning |
| --- | --- |
| **0** | `SMOKE PASS` — provider call, JSON answer, and (if asked) the record all succeeded |
| **1** | `SMOKE FAIL` — HTTP error after the retries, timeout, non-JSON response body, invalid answer, or the record could not be written |
| **2** | usage error, missing key, or `lib/` is not built — no call was made |

## 4. Expected output

A `PASS` against the local mock (a real run prints its own endpoint, provider,
tokens, and latency):

```text
Cloud smoke — provider-level analysis call
  boundary:  lib/analyse/{prompt,host,llm}.js only; not the DSH capture chain
  plugin:    0.9.2 · git d722892 (dirty) · node v25.8.1
  endpoint:  http://127.0.0.1:38080/v1/chat/completions
  provider:  openai-compatible · model mock-model
  key:       SMOKE_API_KEY (hidden)
  prompt:    fake 10-minute window · 3 frame(s) · categories Work, Communication, Research, Other
  timeout:   60000 ms per attempt · up to 3 attempt(s)
  call:      1 attempt(s) [HTTP 200] succeeded in 19 ms
  usage:     input 641 tokens · output 74 tokens
  answer:    valid JSON · title "Reviewing the host adapter" · category "Work" · confidence 0.9
  check:     exactly one JSON object; title/summary/category/confidence present
  record:    /tmp/dayflow-cloud-smoke-SAMPLE.json (no key)
SMOKE PASS — provider call, prompt contract, retry/usage wrapper, and JSON answer verified.
```

- `plugin:` is `package.json`'s version, the short git HEAD, and `(clean)` /
  `(dirty)`. **A cut record must say `(clean)`** and show the tagged commit —
  run it from a clean checkout of the tag.
- `endpoint:` shows scheme/host/path only; a gateway query token never appears.
- `call:` is the real attempt sequence. A wrong key shows
  `3 attempt(s) [HTTP 401, HTTP 401, HTTP 401] failed` — the plugin's retry
  policy at work, not a hang; it takes about a second.
- `usage:` is `not reported by the provider` when the response carries no
  `usage` object. That is still a `PASS`; the record stores `0`/`0`.
- On an invalid answer, the failing reason and the first **500 characters** of
  the raw text are printed under `raw (first 500 chars):`.

## 5. What is validated

The answer must be **exactly one JSON object** (surrounding whitespace allowed,
nothing else — no prose, no markdown fence, no second object) passing the same
public contract the pipeline applies in `src/analyse/pipeline.ts`:

| Field | Rule |
| --- | --- |
| `title` | required, non-empty string, ≤ 200 characters |
| `summary` | required string, ≤ 2000 characters |
| `category` | required string; empty means "none fits"; when non-empty it must be one of the offered categories (`Work`/`Communication`/`Research`/`Other`) |
| `confidence` | required number from 0 to 1 |
| `apps`, `distractions` | optional arrays of strings (trimmed, de-duped, ≤ 20 entries) |
| anything else | ignored — the contract may grow |

The validator is **re-stated** in the script because the pipeline's validator is
private; a `PASS` therefore means the real validator would accept the answer. A
model that wraps the JSON in a code fence, adds a sentence, or invents a
category is a genuine `FAIL`, not a prompt bug to work around: the real pipeline
rejects it.

## 6. Failure troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `no API key found` (exit 2) | the variable is not exported in this shell | `read -rs SMOKE_API_KEY && export SMOKE_API_KEY`, or export `DEEPSEEK_API_KEY`; check `env \| grep -c SMOKE_API_KEY` |
| `the built library is missing (lib/). Run npm run build` (exit 2) | `lib/` absent or the build was cleaned | `npm run build` at the current commit, then re-run |
| `HTTP 401` / `HTTP 403` after 3 attempts | wrong, revoked, or provider-mismatched key, or the key belongs to another endpoint | re-check the key and the base URL belong to the same provider; create a fresh low-budget key; strip quotes/newlines |
| `HTTP 404` | the base URL path is wrong (many providers need `.../v1`) or the gateway route does not exist | pass `--base-url` with the API root; the script appends `/chat/completions` (a full endpoint is also accepted) |
| `HTTP 400` with `Model Not Exist` / `model not found` | `SMOKE_MODEL` is not one of that provider's model ids | check the provider's model list; DeepSeek's default here is `deepseek-chat` |
| `HTTP 402` / `insufficient balance` | the account has no credit | top up, or run this gate against an account that does; do not fake a PASS |
| `HTTP 429` after 3 attempts | rate limit or concurrency | wait a minute and re-run; the call is tiny |
| `timed out after 3 attempt(s)` | no egress, wrong proxy, or an endpoint that never answers | check network/TLS/egress to the provider host; a slow provider can be given `--timeout-ms`; do not disable TLS verification |
| `body is not JSON` after 3 attempts | the URL is not a chat-completions API (HTML login page, health endpoint, proxy error page) | check `--base-url` and the provider's OpenAI-compatibility docs |
| `answer: invalid — the model output is not exactly one JSON object` | the model answered prose or a code fence | retry once; otherwise use a stronger model for the gate; the real pipeline would reject this answer too, so a `PASS` must not be forced |
| `answer: invalid — … category … is not one of the offered categories` | the model invented a category instead of choosing from the list | same as above: this is a real contract violation |
| `usage: not reported by the provider`, record `0/0` | the provider/proxy omits `usage` in the response | nothing to fix; `PASS` stands, the record is honest about 0 |
| `could not write the record …` | the parent directory does not exist or is not writable | write under `/tmp` or an existing directory; `--record` never creates directories |
| `unexpected argument` (exit 2) | a typo in a flag or a stray positional argument | `--help` |
| the record warning "inside the repository checkout" | `--record` points into the repo | write it under `/tmp`; never commit a smoke record |

## 7. Recording the run and the tag gate

**Where.** Recommended: `/tmp/dayflow-cloud-smoke-<YYYY-MM-DD>.json`, **outside
the repository**. The record is a transient artifact: `/tmp` is cleared on
reboot and the file must **never be committed** (it is not covered by a
`.gitignore` entry, and a record is evidence, not source). Copy only the
one-line summary into the annotated tag message / the plan's record block; if
the file itself must be kept, keep it outside the repo in the operator's
notes. Only a `PASS` record is gate evidence; a `FAIL` record (which the script
also writes when `--record` is given) is diagnostic.

**What the record contains** (all key-free):

```json
{
  "tool": "cloud-smoke",
  "formatVersion": 1,
  "result": "PASS",
  "date": "2026-11-27T08:43:01.320Z",
  "pluginVersion": "0.9.2",
  "gitHead": "d722892",
  "gitDirty": true,
  "provider": "openai-compatible",
  "baseUrlHost": "127.0.0.1",
  "model": "mock-model",
  "latencyMs": 19,
  "attempts": 1,
  "inputTokens": 641,
  "outputTokens": 74,
  "valid": true,
  "answerPreview": "<up to 500 characters of the model's answer>",
  "failureReason": null
}
```

(`answerPreview` is at most 500 characters; `baseUrlHost` is the host only — no
path, query, or credentials. `provider` is `deepseek` for a DeepSeek host and
`openai-compatible` otherwise. This sample is the mock run from §9; a **cut**
record must show `gitDirty: false` and the tagged commit's `gitHead`.)

**How it feeds the gate, per
[`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md) §3.7 and §3.9:** §3.7 makes one
**provider-level** `cloud-smoke.mjs` run the tag gate and requires it recorded
**without the key**; §3.9 item 8 orders it after the green
suite/typecheck/build/`check:package` gates and before the `v0.10.0` tag. The
record is the machine-readable evidence the plan lists: result, provider label
and endpoint host, model, latency, input/output tokens, validity, the
≤500-character preview, and `git` HEAD. It makes **no** captured-window,
`analysis_jobs`, or activity-row claim — do not add one to the record or the tag
message. Then, for the publish step, [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md) §2
**P5/P6** require the run from the final clean tag, and its §6.2 record sheet is
where the one-line summary belongs.

A summary line stable enough to paste into the tag message or either record
block:

```text
cloud smoke PASS: provider-level analysis call <provider>/<model> at <gitHead> (clean),
<date>, <input>/<output> tokens, <latency> ms, formatVersion 1, record <path> (no key).
```

After a `PASS`, the tag message can cite it; **do not** rewrite the plan's
"not met" wording until the record exists, and never write "cloud verified"
from a mock run or from faking the answer contract.

## 8. Security

- **The key is never printed.** The banner shows only the source variable name;
  the record stores no key; provider error bodies are redacted before they are
  shown (`[redacted]`), and the record writer refuses to write a file that
  contains the key.
- **The key goes to one place:** `${baseURL}/chat/completions` over the URL's
  TLS. A base URL embedding `user:pass@` is refused so credentials cannot ride
  in the URL; a gateway query token is accepted but the display and the record
  keep only the host.
- **Keep it out of history/chats:** use `read -rs` or a secret manager, never
  paste the key into this page, an issue, a commit, or a chat. If a key was
  exposed, rotate it at the provider first, then re-run.
- **The prompt is a fixture.** No real window title, app, hash, journal row, or
  screen pixel is read or sent; `answerPreview` is the model's answer about
  fake data. The record still stays out of the repo because run metadata is
  operator-internal, not source.
- **The smoke bypasses the DSH credential seam on purpose.** That is what makes
  it runnable without a DSH host; it also means the key must be supplied by the
  operator's shell and is not protected by the DSH local credential store.
- This script makes **no** journal write, **no** capture read, and **no** npm
  registry call; with no `--record` it creates no files.

## 9. Verification without a real key

The script was verified on 2026-11-27 against a local `node:http` mock on
`127.0.0.1` (no real key, no external network) — **87 assertions green** over
the matrix below. The mock was temporary and is not committed; re-create it
with the snippet after the matrix to test a change to `scripts/cloud-smoke.mjs`.

| # | Scenario | Expected | Observed |
| --- | --- | --- | --- |
| 1 | `--help` | exit 0, usage, no network | green |
| 2 | no key (`SMOKE_API_KEY`/`DEEPSEEK_API_KEY` unset) | exit 2, no network | green |
| 3 | mock success (fixed OpenAI completion + usage) | `PASS`, 1 attempt, 641/74 tokens, answer accepted | green |
| 4 | mock success + `--record` (flag overrides env) | `PASS`, key-free JSON with every field, `valid: true` | green |
| 5 | mock invalid JSON answer | exit 1, `not exactly one JSON object`, raw preview | green |
| 6 | mock 401 (body echoes the key) | exit 1, `HTTP 401`, 3 attempts, key `[redacted]` | green |
| 7 | mock 404 | exit 1, `HTTP 404`, 3 attempts, `DEEPSEEK_API_KEY` fallback shown | green |
| 8 | mock 400 `Model Not Exist` | exit 1, detail printed | green |
| 9 | mock hangs + `--timeout-ms 200` | exit 1, `timed out`, 3 attempts, < 5 s | green |
| 10 | mock 200 with a non-JSON body | exit 1, `body is not JSON`, 3 attempts | green |
| 11 | mock success without `usage` | `PASS`, "not reported by the provider", record 0/0 | green |
| 12 | `lib/` absent (script copied outside a build) | exit 2, `npm run build`, no network | green |
| 13 | unknown flag | exit 2 | green |
| 14 | base URL with `user:key@` | exit 2, credentials refused | green |

Minimal mock for a future re-run (start it, then run the smoke with
`SMOKE_API_KEY=test SMOKE_BASE_URL=http://127.0.0.1:38080/v1`; the mock is a
fixture, not a gate):

```js
// /tmp/dayflow-smoke-mock.mjs — node /tmp/dayflow-smoke-mock.mjs
import { createServer } from 'node:http';
const answer = JSON.stringify({
  title: 'Reviewing the host adapter',
  summary: 'Pairing on the analysis host adapter and the release notes.',
  category: 'Work', apps: ['Visual Studio Code'], distractions: [], confidence: 0.9,
});
createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 641, completion_tokens: 74, total_tokens: 715 },
    }));
  });
}).listen(38080, '127.0.0.1', () => console.log('mock on 38080'));
```

## 10. Last checked, related pages

- Last checked: 2026-11-27, `main` @ `d722892`, package **0.9.2**, Node
  v25.8.1, macOS 15.1 (arm64); no real-key PASS yet.
- The gate itself: [`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md) §3.7, §3.9 (gate
  order / item 8) and §4 (tag-then-publish strategy).
- The publish step after the tag: [`PUBLISH_PLAN.md`](PUBLISH_PLAN.md) §2
  (P5/P6), §3, §6.2 (record sheet).
- What a cloud call sends and how the host provider/credential is configured:
  [`PROVIDERS.md`](PROVIDERS.md); the `analysis` keys:
  [`CONFIGURATION.md`](CONFIGURATION.md).
- Operator health checks and release updates: [`RUNBOOK.md`](RUNBOOK.md).
- The script: [`scripts/cloud-smoke.mjs`](../scripts/cloud-smoke.mjs); the
  real-data and native smoke scripts are documented in
  [`ARCHITECTURE.md`](ARCHITECTURE.md#development) and
  [`NATIVE_CAPTURE.md`](NATIVE_CAPTURE.md) and are unrelated to this gate.
