# Providers and models for cloud analysis

[← Back to README](../README.md)

> **Status:** checked against the installed **DeepSeek Harness Desktop
> 0.2.2-rc.5** on **2026-11-27**, with the plugin at **0.9.2** (`main` @
> `844dd02`). The owner answered **D1 = cloud**, **D7 = yes**, and partially
> answered **D2** (several custom models, DeepSeek first; the A/B/C form is
> still open). The 0.10.0 line's option-A named model list is planned and not
> implemented yet — see [`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md). Image
> admission (**D11**) is still undecided, so every shipped analysis call is
> **text-only**. The owner's answers and the safe defaults are in
> [`OWNER_DECISIONS.md`](OWNER_DECISIONS.md); the plugin's own configuration
> keys are in [`CONFIGURATION.md`](CONFIGURATION.md).

This page is the missing half of the cloud setup: `CONFIGURATION.md` says which
`analysis` keys to set, and this page says how the DSH host gets the provider
and model those keys name, where the credential lives, and what a cloud call
actually sends.

The DSH facts below were read from the installed app bundle
(`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/`), not
from memory. The source files are listed in [§8](#8-last-checked-version-date-and-paths).

## 1. What "cloud analysis" sends, and what it does not

The plugin makes model calls in two places. Both use the same `analysis.consent`
switch and the same explicit `analysis.provider`/`analysis.model` pair, but
through two gates: frame analysis additionally requires capture enabled, the
capture loop unpaused, and — under `consent: local` — a provider on the local
allowlist; the scheduled closes read rows already on disk and need only the
analysis switch, the consent value, and the explicit pair (though the scheduler
itself mounts with the same capture-and-analysis stack).

| Call | When it runs | What the text prompt contains |
| --- | --- | --- |
| **Window analysis** (one call per window) | the analysis worker, every `analysis.intervalMinutes` (default 5), over the frames the plugin's own capture engine recorded | the Dayflow day key, the window's start and end, the frame count, up to `analysis.framesPerWindow` representative frames (default 3, max 5) — each with its capture instant, frontmost app name and bundle id, window title (cut to 200 characters) and content hash — and the owned category names the answer may choose from. The user message is capped at 2000 characters. |
| **Day close** (two calls) | `automation.dailyAt`, default `04:00` local | the daily-brief call: day key, tracked entry count and minutes, then one line per activity (clock range, duration, title, category, app names). The insights call: the same activity lines plus the active long-task list (task id, title, categories, apps) used for session matching. |
| **Week close** (one call) | `automation.weeklyOn`, default `monday` | the Monday-anchored week range, entry/minute totals, category totals in minutes, and the week's activities grouped by day (same fields as the daily lines). The weekly memory lint that runs beside it is **local only** and makes no model call. |

The exact prompt builders are `src/analyse/prompt.ts` (window analysis),
`src/briefs/daily.ts`, `src/automation/insights.ts` and `src/briefs/weekly.ts`
(automation). Every prompt declares the screen-derived text as **data, not
instructions**, answers are validated as one strict JSON object, and the
analysis model gets no tools — a hostile window title can be described but not
obeyed.

**Not sent, by design:**

- no screen pixels, no image bytes, no frame files or their paths — the
  analysis adapter never builds an image content block (`src/analyse/host.ts`),
  and the pipeline's prompt carries metadata only;
- no SQLite database or journal file, and no journal-entry notes, reflections,
  or memory-claim bodies;
- no chat history, session log, tool output, or API key material;
- no local allowlist or other configuration values beyond the category names.

One limit on that disclosure: the metadata is what the capture provider
reported — app identity, window title, hash — not a page's or document's
contents beyond what the window title exposes. A paused capture or a
`capture.pauseApps` match is never captured at all, but no window-level rule
can tell what is inside a browser tab or a document.

What the provider itself does with a request (logging, retention, training) is
the provider's own policy; this plugin and DSH cannot make that promise for it.
The one privacy claim the plugin does make is enforced locally: with
`analysis.consent: none` — the shipped default — no model call is made, and
with `cloud` the metadata above may leave the Mac.

## 2. Add a DeepSeek provider in the host profile

### 2.1 Where the provider is configured

DSH's provider settings — routes, endpoints, model catalogs, and credential
references — come from the **profile's patch layer**; the shipped composition
supplies the adapters only:

- Desktop: `$DSH_HOME/profiles/desktop/cordis.patch.yml`
- `dsh web`: `$DSH_HOME/profiles/web/cordis.patch.yml`
- another profile: `$DSH_HOME/profiles/<profile>/cordis.patch.yml`

`$DSH_HOME` defaults to `~/.dsh`. Do **not** edit the profile's `cordis.yml`
(it is an intentionally empty root; its own comment says to edit the patch
file). The DSH **Settings → Models** page writes the same document, so using
the page and hand-editing the YAML are two ways to say the same thing; the page
covers the common fields, and the YAML covers everything else.

The installed 0.2.2-rc.5 base composition mounts these two provider entries (a
third, the signed-in `deepseek-account` route, is not used by this guide):

| Entry | Adapter | Route(s) it registers | Use it for |
| --- | --- | --- | --- |
| `llm-pi-ai` | `@deepseek-ai/dsh-llm-pi-ai` | one route per key under `config.providers` | several providers, relays, gateways; the DeepSeek route named `deepseek` comes from pi-ai's installed catalog |
| `llm-deepseek` | `@deepseek-ai/dsh-llm-deepseek-api-key` | `deepseek-official` | DeepSeek's official Messages endpoint with the smallest setup (the **DeepSeek** card on the Models page) |

The two adapters coexist because their route names differ. A route name must be
unique across adapters: registering `deepseek-official` elsewhere fails with
`DUPLICATE_ADAPTER`, and registering a route another adapter already owns fails
plugin loading.

### 2.2 Minimal YAML for the `deepseek` pi-ai route

pi-ai's installed catalog already describes DeepSeek: route id `deepseek`,
OpenAI-completions protocol, endpoint `https://api.deepseek.com`, environment
reference `DEEPSEEK_API_KEY`, and two models. The whole minimal addition is a
route that names the credential reference:

```yaml
# $DSH_HOME/profiles/desktop/cordis.patch.yml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      deepseek:
        displayName: DeepSeek
        apiKeyEnv: DEEPSEEK_API_KEY
```

`apiKeyEnv` is a **credential reference name, never a key value**: DSH resolves
it per request through its credential seam (see [§3](#3-credentials)). The
catalog supplies the endpoint, the protocol, the model list, context windows,
output caps and reasoning levels; a route that deviates from the catalog can
add `api`, `baseURL`, `models`, `compat`, and the other fields DSH accepts.

> **Merge, do not replace.** A profile row overrides the entry's **complete**
> config. If your profile already declares `llm-pi-ai.providers` (this Mac's
> Desktop profile does), add the `deepseek` key inside the existing `providers`
> map and keep every other provider — a new row carrying only `deepseek` would
> drop the routes already there. On a profile with no `llm-pi-ai` entry, the
> row above is the whole addition.

### 2.3 An explicit `models` list, including input modalities

The two models the installed pi-ai catalog carries for `deepseek` are
`deepseek-flash` (DeepSeek V4.1 Flash, text and image input, 1,000,000-token
context, 384,000-token output cap) and `deepseek-v4-pro` (DeepSeek V4 Pro,
text-only, the same capacities). Writing a `models` list **replaces the route's
catalog wholesale**, and each unset field defaults from the installed model
with the same id, so this form narrows the route to the same two models while
spelling out their modalities:

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      deepseek:
        displayName: DeepSeek
        apiKeyEnv: DEEPSEEK_API_KEY
        models:
          - id: deepseek-flash
            name: DeepSeek V4.1 Flash
            input: [text, image]
          - id: deepseek-v4-pro
            name: DeepSeek V4 Pro
            input: [text]
```

- `input` is per model and accepts `text` and `image`; an omitted list inherits
  the installed catalog's entry, then the route's `defaultInput` (default
  `[text]`). A route can set `defaultInput: [text, image]` once instead of on
  every model. `input` states a claim about the endpoint — DSH does not verify
  it, and a gateway that does not serve images rejects the request.
- `reasoningEfforts` is optional and inherits the catalog's levels. Each key is
  a level the picker offers and its value is the spelling sent on the wire;
  `off:` is allowed empty.
- Model **ids are the provider's**, not this page's. A relay, a newer endpoint,
  or an older catalog may use different ids (for example `deepseek-chat` /
  `deepseek-reasoner`); confirm them against the provider's model listing or
  the Models page's **Fetch available models**, and adjust the list. An id the
  catalog does not describe needs its capacities (`contextWindow`,
  `maxTokens`) at minimum.
- To correct **one** installed-catalog model without replacing the whole list,
  use `modelOverrides` keyed by model id instead of a `models` list; setting
  both on one catalog route is refused.

### 2.4 A route pi-ai does not ship

For a gateway, relay, company endpoint, or self-hosted server that pi-ai has no
catalog entry for, the route must state the protocol, endpoint, and a non-empty
model list. An unserviceable profile is refused where it is written:

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      acme-deepseek:
        displayName: Acme DeepSeek
        apiKeyEnv: ACME_DEEPSEEK_API_KEY
        api: openai-completions        # or openai-responses / anthropic-messages / google-generative-ai
        baseURL: https://gateway.example/v1
        models:
          - id: <model-id-from-the-gateway>
            name: <display name>
            input: [text]
```

The four protocol values are the ones the Models page's **API protocol** picker
offers; a gateway that speaks two protocols needs two routes. Common gateway
translation needs are two `compat` switches —
`supportsDeveloperRole: false` and `maxTokensField: max_tokens` — and
`compat.thinkingFormat: deepseek` for a DeepSeek model behind an
OpenAI-compatible endpoint that keeps thinking unless told not to.

### 2.5 The DeepSeek card path (no YAML)

For DeepSeek only, the shortest path is **Settings → Models → DeepSeek**: enter
the API key and save. That writes `llm-deepseek` config and stores the key, and
exposes the official route **`deepseek-official`**, which passes model ids
through to the wire and, while uncustomized, follows DeepSeek's published model
listing. Its built-in defaults are `deepseek-flash` (text and image) and
`deepseek-v4-pro` (text-only), and its `apiKeyEnv` defaults to
`DEEPSEEK_API_KEY`.

The two routes also treat unknown model ids differently: `deepseek-official`
passes a model id through to the wire (so a newly published id can be used
before the catalog knows it), while the pi-ai route refuses a model it does not
describe with `UNKNOWN_MODEL` before any network I/O unless the route's
`models` list declares it.

Choose between the two routes deliberately:

| | `deepseek-official` | `deepseek` (pi-ai) |
| --- | --- | --- |
| Adapter | `dsh-llm-deepseek-api-key` | `dsh-llm-pi-ai` |
| Protocol | DeepSeek Messages (`https://api.deepseek.com/anthropic`) | OpenAI Chat Completions (`https://api.deepseek.com`) |
| Setup | Models page card, or `llm-deepseek` config | a `providers` route, as above |
| Model list | built-in two, then DeepSeek's published listing | pi-ai's installed catalog, replaceable with `models` |
| Unknown model id | passed through to the wire | `UNKNOWN_MODEL` unless declared |
| Good for | one provider, least configuration | several providers or gateways in one profile |

### 2.6 Apply and verify the host route

A provider or model change needs **no restart** in the normal case: DSH re-reads
the profile and the adapters resolve the current settings on the next request
(the installed user guide says model changes take effect on the next request
without restarting the server; a profile edit is re-read the same way). If a
newly added route does not appear, restart the Desktop app — that is the
fallback when HMR is disabled or a saved candidate was rejected.

Verify at the host level:

1. **Settings → Models** lists the provider card/the route's models.
2. The composer's model picker offers `deepseek-flash` / `deepseek-v4-pro`
   (selecting one also makes it the default for new sessions).
3. Optionally pin the harness's own default for fresh agents — this is
   **separate from the plugin's analysis selection**:

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek          # a registered route name, not a display name
    model: deepseek-flash       # a model id on that route
    # reasoningEffort: high     # optional; omitted removes the field
```

`agent-default-model` answers "which model does a freshly created agent start
on?". The plugin never reads it: `analysis.provider`/`analysis.model` must be
set explicitly ([§4](#4-multiple-providers-and-models)), so changing this page's
default does **not** turn analysis on.

## 3. Credentials

### 3.1 `apiKeyEnv` is a reference, not a secret

`apiKeyEnv: DEEPSEEK_API_KEY` names a **credential reference**; the value is
resolved per request through the harness credential seam, so no secret enters
the profile file:

- a reference that resolves to nothing fails the request with
  `MISSING_CREDENTIAL`;
- a malformed stored value fails with `INVALID_CREDENTIAL`;
- omitting `apiKeyEnv` leaves a route configured-but-keyless, which for an
  installed catalog route defers to pi-ai's provider-native ambient discovery —
  an OpenAI-compatible local server still needs a placeholder credential or an
  `Authorization` header.

The installed credential store is `@deepseek-ai/dsh-credentials-local`, a
private YAML document at **`$DSH_HOME/.credentials.yaml`**. Lookup order is
fixed, first hit wins:

| Place | How it is set | Notes |
| --- | --- | --- |
| the stored file (`refs:`) | **Settings → Models** saves a key here, or `ctx.credentials.set` | wins over everything; a save takes effect for the next request; the UI shows only a masked descriptor |
| the environment DSH was launched in | e.g. `DEEPSEEK_API_KEY=… dsh` | a **snapshot at launch** — a variable exported after DSH started is not seen |
| the project's `.env` | `<invocation cwd>/.env` | fallback |
| the harness-home `.env` | `$DSH_HOME/.env` | fallback; the practical file-based option for the Desktop app |

On the Desktop app, the launching environment is the Dock/Finder environment,
so a shell export in a separate terminal is not a reliable way to feed the key:
use the Models page, or put `DEEPSEEK_API_KEY=…` in `$DSH_HOME/.env` and restart
the app. `refs:` maps the reference name to its value; adding or removing a key
there changes the next resolution, and removing it reveals the lower layer
again rather than blanking it.

### 3.2 `apiKeyEnv` vs a credentials **record**

The credentials store has two spaces, and providers use them for different
things:

- `refs:` — flat `NAME: value` entries for API keys, addressed by the
  `apiKeyEnv` reference. This is what the Models page and the minimal DeepSeek
  example use.
- `records:` — per-plugin credentials addressed as `<owner>/<id>`. Model
  sign-in flows write `llm-pi-ai/<provider-id>` records (an OAuth grant or an
  interactive key), refreshed under the store's lock and removed on sign-out.
  A **hand-declared** route id must be a lowercase hyphenated identifier to be
  sign-in-able; a catalog route can also be signed in this way, while an
  `apiKeyEnv` route needs no record at all. Plugin code stores a secret it
  owns with `ctx.credentials.modifyRecord()` rather than in configuration;
  the installed credential-store reference owns the record grammar and the
  cross-process lock.

For this plugin the distinction is simple: **the plugin stores no credential at
all**. It passes the configured provider/model strings to the host's
`ctx.llm.stream` and does not read the credential store, `.credentials.yaml`,
or any provider key from the environment (it does read non-secret settings such
as `DSH_HOME` and `DAYFLOW_DB`, documented in [`CONFIGURATION.md`](CONFIGURATION.md));
authentication belongs entirely to the DSH route.

### 3.3 Rotation and exposure

- **Rotate a key you believe was exposed.** A key pasted into a chat, an
  issue, a commit, a log, or a screenshot should be rotated at the provider
  console; do not try to scrub every copy. After rotating, save the new value in
  **Settings → Models** (or update `$DSH_HOME/.env`) so the next request uses it.
- **Never commit** `$DSH_HOME/.credentials.yaml` or a profile patch containing
  a literal key. A profile patch may safely contain only the reference name,
  such as `apiKeyEnv: DEEPSEEK_API_KEY`; this repository contains no key and
  must not gain one.
- The credentials file is created owner-readable only, and on POSIX DSH refuses
  a file other users can read. That is not a boundary against the agent: the
  agent's tool processes run as the same OS user and can read the file, which
  is why `apiKeyEnv` references (not inlined values) are the right way to
  configure a route.
- To stop using a stored key, remove it deliberately: deleting the `refs:`
  entry falls back to the launch environment, and if that has the variable the
  key becomes active again.

## 4. Multiple providers and models

### 4.1 Several providers in one profile

One `llm-pi-ai` entry holds every pi-ai route; add keys under the same
`providers` map (again, preserve the existing ones):

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      deepseek:
        displayName: DeepSeek
        apiKeyEnv: DEEPSEEK_API_KEY
        models:
          - id: deepseek-flash
            input: [text, image]
          - id: deepseek-v4-pro
            input: [text]
      acme-deepseek:
        displayName: Acme DeepSeek
        apiKeyEnv: ACME_DEEPSEEK_API_KEY
        api: openai-completions
        baseURL: https://gateway.example/v1
        models:
          - id: <model-id-from-the-gateway>
            input: [text]
```

Each key is its own route with its own credential reference, endpoint, and
catalog; `deepseek-official` from the other adapter can be mounted at the same
time. Profiles resolve the current provider settings per request, and a route
set change updates registration atomically, keeping the previous routes if
another adapter owns a requested name.

### 4.2 Selecting the pair the plugin uses

The plugin has **one** selection and no fallback: `analysis.provider` and
`analysis.model` are passed verbatim to the host stream, and analysis is
blocked with `provider-unset` / `model-unset` until both are set — there is no
implicit agent default and no provider discovery inside the plugin. The pair is
independent of `agent-default-model` and of the composer's selection.

```yaml
- id: dayflow
  config:
    capture:
      enabled: true                  # off by default: analysis needs frames
    analysis:
      enabled: true                  # default true
      consent: cloud                 # default none; cloud is the owner's D1 answer
      provider: deepseek             # a registered route name
      model: deepseek-flash          # a model id on that route
```

This block goes in the **plugin's own row** (`- id: dayflow`, the id the bundle
inserts), in the same profile patch as the provider route — it is not part of
the `llm-pi-ai` entry. `capture.enabled` is shown because frame analysis needs
frames, and the shipped default is `false`. Merge these keys into the row that
already configures the plugin instead of replacing its other fields: like any
Cordis config override, the row supplies the entry's complete config, and only
the plugin's own defaults fill whatever is left out.

Rules of thumb:

- use the **route name** (`deepseek`, `deepseek-official`, `acme-deepseek`),
  never a display name;
- use a **model id**, never a display name; the composer's picker only offers
  catalog entries, so an id that only the wire endpoint knows has to be named
  in config (and the pi-ai route refuses it unless the route declares it);
- `analysis.model` is not a named-model-list entry id (that is the planned
  0.10.0 shape below);
- changing the strings takes effect when the profile reloads the plugin; the
  worker then re-evaluates the consent gate on its next tick.

The plugin does not check the pair against the host's catalog when it loads:
an unknown route or model passes configuration validation and shows up as a
**failed** window at call time (`UNKNOWN_MODEL`), not as a plugin start error.

### 4.3 What the 0.10.0 line plans (not implemented in 0.9.2)

The owner asked for several custom models with DeepSeek first; the plan is
**option A, a named model list** in [`PATCH_PLAN_0.10.md`](PATCH_PLAN_0.10.md):
`analysis.models` becomes an optional list of 1–8 named entries
`{id, provider, model, label?}` with **exactly one active entry per call**. The
rule the plan pins: with the list absent or empty the legacy single pair works
unchanged; with the list present, `analysis.provider` must be empty, the first
entry is active by default, and a non-empty `analysis.model` selects an entry
**`id`** (trimmed, case-insensitive) — an id matching no entry is a load-time
`invalid_input` naming the known ids, not a silent fallback. That is a plan,
not a schema this release accepts:

```yaml
# PLANNED for 0.10.0 — NOT accepted by 0.9.2; kept here only to show the shape.
    analysis:
      models:
        - id: flash
          provider: deepseek
          model: deepseek-flash
          label: DeepSeek V4.1 Flash
        - id: pro
          provider: deepseek
          model: deepseek-v4-pro
          label: DeepSeek V4 Pro
      model: flash            # the planned default selection
```

Until that ships, switching models is a two-line edit of
`analysis.provider`/`analysis.model`; a per-call failover (**option B**) and
arbitrary base URLs from the plugin config (**option C**) are deferred until
the owner picks the D2 shape.

## 5. Vision models and D11

`input: [text, image]` on a model (or `defaultInput` on the route, or
`modelOverrides` for an installed-catalog model you do not list) is how DSH
learns that an endpoint accepts images. That is the correct declaration for a
vision-capable model, and the installed pi-ai catalog already makes
`deepseek-flash` text-and-image on the `deepseek` route; the direct DeepSeek
adapter states the same capability as `inputModalities` on its catalog entry.

It does **not** make this plugin send pixels. D11 (image admission) is still
open, the safe default is "no", and the shipped plugin has no attachment peer,
no `includeImages` key, and no `privacy_apps` list: the analysis adapter builds
one text content block and never an image block, so a vision model receives the
same metadata as a text model. Declaring image input today is therefore:

- correct for other DSH surfaces that do use attachments;
- the prerequisite the plugin would need if D11 is ever answered "yes", along
  with a vision-capable model for the analysis pair;
- **not** a way to turn image analysis on — nothing in the plugin reads it.

A model that declares images its endpoint does not serve is refused by the
provider at request time; DSH cannot verify the declaration.

## 6. Verify and troubleshoot

### 6.1 The plugin's own status

The plugin exposes these read-only surfaces and two manual triggers:

| Surface | What it shows / does |
| --- | --- |
| Panel **Insights** analysis line | the frame-analysis gate's state, today's failures, calls/tokens against the daily caps, the last job time, and the privacy line once consent is not `none`; the close-state line beside it reports the automation passes |
| `GET /api/dayflow/analysis/status` (with the panel enabled, the default) | the same facts as JSON: `consent`, `worker`, `queued`/`running`/`completed`/`failed`/`skipped`, `callsToday`, `maxCallsPerDay`, `tokensToday`, `dailyTokenBudget`, `tokenBudgetExhausted`, and `reason` when blocked |
| `/dayflow-analyze` | one manual worker tick; answers e.g. `<day>: 3/9 window(s) analysed · 2 card(s) written · 6 skipped` or `blocked by <reason>` |
| `/dayflow-run-close` | runs a due day/week close through the automation gate and ledger |

Today the status payload and the panel line report the switches, the gate
reason, and the ledger, but **not which provider/model a call would use**. The
0.10.0 plan adds one optional status field naming the active entry (its label,
or `provider/model`), so its absence from a 0.9.2 status is expected.

The **frame-analysis** gate checks, in order, and reports the first block:
`analysis-disabled`, `capture-disabled`, `paused`, `consent:none`,
`provider-unset`, `model-unset`, `consent:provider-not-local`. The
**automation** gate is narrower — `analysis-disabled`, `consent:none`,
`provider-unset`, `model-unset` — because it reads rows already on disk. In
addition, a composition without the host LLM service does not mount the worker
at all, and windows it cannot serve are recorded as `analyser-unset` (the
panel's disabled/stopped states cover this). Blocked-by-configuration skips
are requeued for today and yesterday once the gate opens; failures and budget
skips are not replayed.

### 6.2 Common problems

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| analysis line says it needs a provider/model | `analysis.provider` or `analysis.model` empty | set both to the **route name** and a **model id** from that route |
| analysis line waits for consent (`consent:none`) | default consent | set `analysis.consent: cloud` |
| `consent:provider-not-local` | `consent: local` and the provider is not on the allowlist | use `cloud`, or list the provider id in `analysis.localProviders` |
| nothing ever runs | `capture.enabled: false` (default), analysis disabled, no frames yet, or the host LLM service is not mounted | enable capture and analysis, capture a few frames, then `/dayflow-analyze` |
| `failed` count grows with `UNKNOWN_MODEL` in the job error | the model id is not in the route's catalog | pick a catalog model, or declare the id under the route's `models` |
| `failed` count grows with `MISSING_CREDENTIAL` | the `apiKeyEnv` reference resolves to nothing | save the key in Models, or provide the variable in `$DSH_HOME/.env` (then restart the app) |
| `INVALID_CREDENTIAL` | the stored value is malformed | replace the saved key |
| `QUOTA` / `RATE_LIMIT` | provider-side quota or throttling | check the account; the route's `retryPolicy` applies |
| the provider appears but every request is refused | gateway request shape differs from OpenAI's | start with `compat.supportsDeveloperRole: false` and `compat.maxTokensField: max_tokens` |
| **Fetch available models** returns 401 | wrong key or no `/models` endpoint | fix the key, or enter model ids by hand |
| model picker does not offer the new route | profile not reloaded, or the route was rejected | reopen Settings; if it is still absent, restart the Desktop app and check the entry id/name and YAML |

For a failed window, the stored reason is the job's `error` column in the owned
journal (`$DSH_HOME/dayflow/journal.sqlite`, `analysis_jobs`); the panel line
and `/dayflow-analyze` only count failures. A failed window is retried up to
the analysis attempt cap and then makes no further call; the jobs that stay
failed are safe to inspect and are not replayed by the configuration-skip
catch-up. The host-level failures are the pi-ai/DeepSeek codes:
`MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`, `UNKNOWN_MODEL`, `QUOTA`,
`RATE_LIMIT`, plus `DUPLICATE_ADAPTER` at composition time.

### 6.3 Budget and cost checks

Cloud calls bill at the provider, outside this plugin. The plugin's own caps
are `analysis.maxCallsPerDay` (default 120, checked before a window) and
`analysis.dailyTokenBudget` (default 200,000 tokens, checked before a window and
again after each completed call). Reaching either stops new calls for the rest
of the Dayflow day with `budget` / `budget-tokens`; the crossing call stays
complete. The status line and `GET /api/dayflow/analysis/status` show
`callsToday` and `tokensToday`, so a suspicious bill can be compared with what
the plugin recorded before changing provider, model, or caps.

## 7. Security notes

- **No secrets in this repository or in profile YAML.** Provider routes carry
  `apiKeyEnv` reference names only; the key lives in the credential store or an
  environment layer, and this page deliberately shows no real key.
- **Rotate first, then update.** Any key that was pasted into a chat, issue,
  log, screenshot, or commit is treated as exposed; rotate it at the provider
  and save the replacement in Models (or `$DSH_HOME/.env`).
- **Cloud consent is an explicit decision.** `none` is the default and makes no
  call; `cloud` allows the metadata in [§1](#1-what-cloud-analysis-sends-and-what-it-does-not)
  to leave the Mac; `local` accepts only providers on `localProviders`, which
  is an allowlist of names, not a locality proof.
- **Treat screen text as untrusted.** The prompts mark it as data, the answer
  is validated as JSON, and the analysis model has no tools; that bounds prompt
  injection, not the provider's own handling of the request.
- **Keep the budget deliberate.** The daily call and token caps are the
  plugin-side stop; the provider account (and its billing) is the outer one.

## 8. Last checked: version, date, and paths

| Fact | Value |
| --- | --- |
| Checked on | 2026-11-27 |
| DSH Desktop app | **0.2.2-rc.5** (`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/package.json`) |
| DSH CLI package | `@deepseek-ai/dsh` **0.2.2-rc.5** (same bundle) |
| DSH profile used for verification | `desktop` (`DSH_PROFILE=desktop`), `$DSH_HOME=/Users/wtl/.dsh` |
| Provider config file | `$DSH_HOME/profiles/desktop/cordis.patch.yml` (present, mounted) |
| Credential store | `$DSH_HOME/.credentials.yaml` (`@deepseek-ai/dsh-credentials-local`) |
| pi-ai DeepSeek route in the installed catalog | `deepseek` — `openai-completions`, `https://api.deepseek.com`, env `DEEPSEEK_API_KEY`, models `deepseek-flash` (text+image) and `deepseek-v4-pro` (text) |
| Direct DeepSeek route | `deepseek-official` (`@deepseek-ai/dsh-llm-deepseek-api-key`, Messages protocol) |
| Plugin baseline | **0.9.2**, `main` @ `844dd02` |
| Plugin analysis contract | `src/analyse/{consent,prompt,host,pipeline,status}.ts`, `src/config.ts`, `src/briefs/*`, `src/automation/insights.ts` |

Installed DSH sources consulted (inside the app bundle; the file-read tool can
read `app.asar`):

- `.../app.asar/dsh/node_modules/@deepseek-ai/dsh/docs/user/guide/providers.md`
  — the Settings → Models / custom provider guide, model picker, image input,
  compat, and the troubleshooting codes;
- `.../@deepseek-ai/dsh-llm-pi-ai/README.md` — `providers` fields and defaults,
  credential references, catalog replacement, sign-in records, failure codes;
- `.../@deepseek-ai/dsh-llm-deepseek/README.md` and
  `.../@deepseek-ai/dsh-llm-deepseek-api-key/README.md` — the
  `deepseek-official` route, its `DEEPSEEK_API_KEY` default, and the official
  model listing;
- `.../@deepseek-ai/dsh-credentials-local/README.md` — the store, its
  precedence, `refs:`/`records:`, and file permissions;
- `.../@deepseek-ai/dsh-agent-default-model/README.md` — what the default
  model selection is for;
- `.../@deepseek-ai/dsh-base/cordis.patch.yml` — the shipped composition that
  mounts the provider adapters (with the dormant `llm-pi-ai` entry) and the
  default `agent-default-model`;
- `.../@earendil-works/pi-ai/dist/providers/{deepseek.js,data/deepseek.json}` —
  the installed `deepseek` catalog route and model metadata.
