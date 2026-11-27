#!/usr/bin/env node
/**
 * Cloud smoke: one real HTTPS call through the plugin's own analysis path.
 *
 * This is the executable form of the 0.10.0 tag gate's cloud check
 * ([`docs/PATCH_PLAN_0.10.md`](../docs/PATCH_PLAN_0.10.md) §3.7 C7 and §3.9
 * gate 8; [`docs/SMOKE.md`](../docs/SMOKE.md) is the operator procedure). It
 * makes exactly one provider call, but every layer between the prompt and the
 * answer is the shipped one:
 *
 * - `lib/analyse/prompt.js` — `buildAnalysisPrompt` over a fake 10-minute
 *   window with three frame metadata rows and the Work/Communication/Research
 *   category list. The fake titles are fixtures; no real screen data is read.
 * - a local `HostLlmLike` — the same structural seam `createHostAnalyser`
 *   expects from the DSH host, implemented here as a plain
 *   `POST <baseURL>/chat/completions` with `Authorization: Bearer <key>`,
 *   `stream: false`, and `max_tokens` (the OpenAI-compatible shape providers
 *   such as DeepSeek serve). Its single `choices[0].message.content` becomes
 *   one `text-delta` chunk, its `usage` becomes one `usage` chunk.
 * - `lib/analyse/host.js` — `createHostAnalyser`, the production adapter.
 * - `lib/analyse/llm.js` — `callAnalysisModel`, the production wrapper: one
 *   attempt's timeout, two retries with exponential backoff, cancellation, and
 *   the provider-reported token counts.
 *
 * The answer is then validated against the same public contract the pipeline
 * validates (`title`, `summary`, `category`, `confidence`, optional
 * `apps`/`distractions`, unknown keys ignored), so a PASS means the real
 * pipeline would accept this answer. The validator is re-stated here because
 * the pipeline's own validator is private; this script changes no source.
 *
 * **Boundary.** This is a *provider-level* smoke: it proves the prompt, the
 * host adapter, the retry/timeout/usage wrapper, and the JSON contract against
 * a real OpenAI-compatible endpoint. It does **not** exercise the DSH host,
 * Dayflow capture, the analysis-job ledger, the activity row, or the panel, and
 * the gate makes no such claim; if the operator also observes the full chain,
 * record it separately, never as this tool's evidence. Never paste a real key
 * into a shell history, a chat, or a record file.
 *
 * **Key handling.** The key is read from `SMOKE_API_KEY`, falling back to
 * `DEEPSEEK_API_KEY`, and is sent only to the resolved endpoint. It is never
 * printed, never written to the `--record` JSON, and provider error bodies are
 * redacted before they are shown. `--record` is off by default; the default
 * run writes nothing.
 *
 * ```sh
 * npm run build
 * SMOKE_API_KEY=… node scripts/cloud-smoke.mjs --record /tmp/dayflow-cloud-smoke.json
 * ```
 *
 * Exit codes: 0 PASS, 1 FAIL (call, answer validation, or record write), 2
 * usage error, missing key, or the built `lib/` is missing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, from this file's location (`<repo>/scripts/…`). */
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The default OpenAI-compatible base URL when neither env nor flag sets one. */
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

/** The default model id when neither env nor flag sets one. */
const DEFAULT_MODEL = 'deepseek-chat';

/** The output-token ceiling for the one call; the answer is a small object. */
const SMOKE_MAX_TOKENS = 512;

/** How many answer characters the record and a failure print keep. */
const ANSWER_PREVIEW_CHARS = 500;

/** How many provider error-body characters a failure print keeps. */
const ERROR_PREVIEW_CHARS = 500;

/** The title ceiling the pipeline's validator applies. */
const TITLE_MAX_CHARS = 200;

/** The summary ceiling the pipeline's validator applies. */
const SUMMARY_MAX_CHARS = 2_000;

/** The per-list entry ceiling the pipeline's validator applies. */
const LIST_MAX_ENTRIES = 20;

/** The categories the fake window offers; the answer's category must be one. */
const CATEGORIES = ['Work', 'Communication', 'Research', 'Other'];

const USAGE = `Cloud smoke — one real provider call through the plugin's analysis path.

Usage: node scripts/cloud-smoke.mjs [options]

Environment:
  SMOKE_API_KEY      API key to send; falls back to DEEPSEEK_API_KEY
  SMOKE_BASE_URL     OpenAI-compatible base URL (default ${DEFAULT_BASE_URL})
  SMOKE_MODEL        model id (default ${DEFAULT_MODEL})

Options:
  --base-url <url>   override SMOKE_BASE_URL
  --model <id>       override SMOKE_MODEL
  --timeout-ms <n>   per-attempt timeout in milliseconds (default: the plugin's 60000)
  --record <path>    write a JSON record without the key (recommended: /tmp/…)
  -h, --help         print this help and exit 0

Exit codes: 0 PASS · 1 FAIL · 2 usage error, missing key, or lib/ not built.

The run reads no real screen data and no journal; it writes nothing unless
--record names a path. Run \`npm run build\` first.`;

/** A caller-usage error: missing key, bad flag, unusable base URL, missing lib. */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** A record-write error; the run itself may have PASSed but no evidence exists. */
class RecordError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecordError';
  }
}

/** Read an environment variable, treating empty or whitespace-only as unset. */
function envValue(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Pull one flag's value, accepting `--flag value` and `--flag=value`. */
function takeValue(argv, index, flag) {
  const argument = argv[index];
  const equals = argument.indexOf('=');
  if (equals !== -1) {
    const inline = argument.slice(equals + 1);
    if (inline === '') throw new UsageError(`${flag} needs a value.`);
    return { value: inline, next: index };
  }
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('--')) throw new UsageError(`${flag} needs a value.`);
  return { value: next, next: index + 1 };
}

/**
 * Parse the command line.
 *
 * Unknown arguments are a usage error rather than ignored, so a typo cannot
 * silently fall back to the default endpoint or model in a tag-gate run.
 */
function parseArgs(argv) {
  const options = {
    help: false,
    baseUrl: undefined,
    model: undefined,
    timeoutMs: undefined,
    recordPath: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') {
      options.help = true;
      continue;
    }
    const flag = argument.startsWith('--') ? argument.split('=')[0] : undefined;
    if (flag === '--base-url' || flag === '--model' || flag === '--timeout-ms' || flag === '--record') {
      const taken = takeValue(argv, index, flag);
      index = taken.next;
      if (flag === '--base-url') options.baseUrl = taken.value;
      else if (flag === '--model') options.model = taken.value;
      else if (flag === '--record') options.recordPath = taken.value;
      else {
        const timeoutMs = Number(taken.value);
        if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
          throw new UsageError('--timeout-ms must be a positive integer number of milliseconds.');
        }
        options.timeoutMs = timeoutMs;
      }
      continue;
    }
    throw new UsageError(`unexpected argument: ${argument}`);
  }
  return options;
}

/** A URL safe to print: scheme, host, path only — no query, credentials, or hash. */
function displayUrl(raw) {
  const withoutQuery = String(raw).split('#')[0].split('?')[0];
  try {
    const url = new URL(withoutQuery);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '<unparsable URL>';
  }
}

/** Validate and normalise the base URL; credentials must never ride in it. */
function resolveBaseUrl(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') throw new UsageError('the base URL is empty.');
  const base = trimmed.replace(/\/+$/, '');
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new UsageError(`the base URL is not a valid URL: ${displayUrl(raw)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`the base URL must be http(s), got ${url.protocol}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new UsageError('the base URL must not embed credentials; pass the key in SMOKE_API_KEY or DEEPSEEK_API_KEY instead.');
  }
  return { base, url };
}

/** The chat-completions endpoint for a base URL (a full endpoint is accepted). */
function chatEndpoint(url) {
  const endpoint = new URL(url.toString());
  if (!/\/chat\/completions$/i.test(endpoint.pathname)) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/chat/completions`;
  }
  return endpoint.toString();
}

/** The provider label recorded for the gate: deepseek, or the generic shape. */
function providerLabel(hostname) {
  const host = String(hostname).toLowerCase();
  return host === 'api.deepseek.com' || host.endsWith('.deepseek.com') ? 'deepseek' : 'openai-compatible';
}

/** Replace an exact secret with a marker, so a provider echo cannot leak it. */
function redact(text, secret) {
  const value = typeof text === 'string' ? text : String(text);
  if (typeof secret !== 'string' || secret === '') return value;
  return value.split(secret).join('[redacted]');
}

/** Format one instant as a local `YYYY-MM-DD` day key. */
function localDayKey(milliseconds) {
  const date = new Date(milliseconds);
  const pad = (value) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Load the built analysis modules, or fail with the build instruction. */
async function loadLibrary() {
  try {
    const [promptModule, hostModule, llmModule] = await Promise.all([
      import('../lib/analyse/prompt.js'),
      import('../lib/analyse/host.js'),
      import('../lib/analyse/llm.js'),
    ]);
    return { promptModule, hostModule, llmModule };
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new UsageError('the built library is missing (lib/). Run `npm run build` first, then re-run this smoke.');
    }
    throw error;
  }
}

/** The plugin version from the repository's package.json (or `unknown`). */
function readPluginVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The short git HEAD and dirty flag when git answers; nulls otherwise. */
function readGitState() {
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { head: head === '' ? null : head, dirty: status !== '' };
  } catch {
    return { head: null, dirty: null };
  }
}

/**
 * Build the fake window and its prompt with the production builder.
 *
 * The three frame rows are fixtures — app names, window titles, and hashes are
 * invented and contain no recorded screen content. The window is a 10-minute
 * box ending at the last whole minute, so the prompt looks like one the worker
 * would build while staying deterministic enough to read.
 */
function buildSmokePrompt(promptModule) {
  const windowEndMs = Math.floor(Date.now() / 60_000) * 60_000;
  const windowStartMs = windowEndMs - 10 * 60_000;
  const frames = [
    {
      capturedAt: Math.floor(windowStartMs / 1_000),
      app: { name: 'Visual Studio Code', bundleId: 'com.microsoft.VSCode' },
      windowTitle: 'host.ts — dsh-plugin-dayflow',
      hash: 'dhash:6a1f0c2e9b7d4a13',
    },
    {
      capturedAt: Math.floor((windowStartMs + 5 * 60_000) / 1_000),
      app: { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' },
      windowTitle: '#dsh-plugin-dayflow — release planning',
      hash: 'dhash:2b7e4c9a10f83d55',
    },
    {
      capturedAt: Math.floor((windowEndMs - 1_000) / 1_000),
      app: { name: 'Safari', bundleId: 'com.apple.Safari' },
      windowTitle: 'Cloud analysis provider setup — docs',
      hash: 'dhash:9c4d0e7b31a25f86',
    },
  ];
  const prompt = promptModule.buildAnalysisPrompt({
    day: localDayKey(windowStartMs),
    windowStartTs: Math.floor(windowStartMs / 1_000),
    windowEndTs: Math.floor(windowEndMs / 1_000),
    frames,
    categories: CATEGORIES,
  });
  return { prompt, windowMinutes: 10, frameCount: frames.length };
}

/** A finite, non-negative token count, or 0 when the provider reported none. */
function tokenNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Build the local `HostLlmLike` the adapter consumes.
 *
 * It implements the same structural seam as the DSH host service — one
 * `AsyncIterable<HostLlmChunk>` per call — with a plain fetch to an
 * OpenAI-compatible `/chat/completions`. Every attempt is appended to
 * `attempts`, so a failure report can show the real retry sequence without the
 * wrapper's internals.
 */
function createFetchHostLlm({ endpoint, apiKey, attempts }) {
  return {
    async *stream(request) {
      const userText = request.messages
        .flatMap((message) => message.content)
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n\n');
      const body = {
        model: request.model,
        messages: [
          { role: 'system', content: typeof request.system === 'string' ? request.system : '' },
          { role: 'user', content: userText },
        ],
        stream: false,
        max_tokens: typeof request.maxTokens === 'number' ? request.maxTokens : SMOKE_MAX_TOKENS,
      };
      const attempt = { index: attempts.length + 1, status: null, error: null };
      attempts.push(attempt);

      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempt.error = `network error: ${message}`;
        throw new Error(`the request to ${displayUrl(endpoint)} failed: ${redact(message, apiKey)}`);
      }
      attempt.status = response.status;

      const raw = await response.text().catch(() => '');
      if (!response.ok) {
        const snippet = redact(raw.trim().slice(0, ERROR_PREVIEW_CHARS), apiKey);
        attempt.error = `HTTP ${String(response.status)}`;
        throw new Error(
          `the provider answered HTTP ${String(response.status)} ${response.statusText}` +
            `${snippet === '' ? '' : `: ${snippet}`}`,
        );
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        attempt.error = 'the response body is not JSON';
        throw new Error(
          `the provider answered HTTP ${String(response.status)} but the body is not JSON: ` +
            redact(raw.trim().slice(0, ERROR_PREVIEW_CHARS), apiKey),
        );
      }
      const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : undefined;
      const content = choice?.message?.content;
      if (typeof content !== 'string') {
        attempt.error = 'the response has no choices[0].message.content string';
        throw new Error('the provider response has no string "choices[0].message.content".');
      }
      attempt.error = null;

      yield { type: 'text-delta', text: content };
      const usage = parsed?.usage;
      if (usage !== undefined && usage !== null && typeof usage === 'object') {
        yield {
          type: 'usage',
          usage: {
            inputTokens: tokenNumber(usage.prompt_tokens ?? usage.input_tokens),
            outputTokens: tokenNumber(usage.completion_tokens ?? usage.output_tokens),
          },
        };
      }
      yield {
        type: 'finish',
        ...(typeof choice.finish_reason === 'string' ? { reason: choice.finish_reason } : {}),
      };
    },
  };
}

/** Mirror the pipeline's string-list validation (optional, trimmed, deduped). */
function validateStringList(value, field) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: `the model output "${field}" must be an array of strings` };
  const seen = new Set();
  const entries = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return { ok: false, error: `the model output "${field}" must contain only strings` };
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(trimmed);
    if (entries.length >= LIST_MAX_ENTRIES) break;
  }
  return { ok: true, value: entries };
}

/**
 * Validate one answer against the pipeline's public JSON contract.
 *
 * The same fields, bounds, category membership, and optional-list rules the
 * pipeline applies; unknown keys are ignored. The real validator is private in
 * `src/analyse/pipeline.ts`, so this is a restatement, not an import — a PASS
 * here means the real validator would accept the answer.
 */
function validateAnswer(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed === '') return { ok: false, error: 'the model returned no text' };
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { ok: false, error: 'the model output is not exactly one JSON object' };
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'the model output is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'the model output is not a JSON object' };
  }
  const record = parsed;

  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (title === '') return { ok: false, error: 'the model output has no non-empty "title"' };
  if (title.length > TITLE_MAX_CHARS) {
    return { ok: false, error: `the model output "title" is longer than ${String(TITLE_MAX_CHARS)} characters` };
  }

  if (typeof record.summary !== 'string') return { ok: false, error: 'the model output has no string "summary"' };
  const summary = record.summary.trim();
  if (summary.length > SUMMARY_MAX_CHARS) {
    return { ok: false, error: `the model output "summary" is longer than ${String(SUMMARY_MAX_CHARS)} characters` };
  }

  if (typeof record.category !== 'string') return { ok: false, error: 'the model output has no string "category"' };
  const category = record.category.trim();
  if (category !== '' && !CATEGORIES.includes(category)) {
    return {
      ok: false,
      error: `the model output category ${JSON.stringify(category)} is not one of the offered categories`,
    };
  }

  const apps = validateStringList(record.apps, 'apps');
  if (!apps.ok) return apps;
  const distractions = validateStringList(record.distractions, 'distractions');
  if (!distractions.ok) return distractions;

  const confidence = record.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, error: 'the model output "confidence" is not a number from 0 to 1' };
  }

  return { ok: true, answer: { title, summary, category, confidence } };
}

/** One attempt line: `3 attempt(s) [HTTP 401, HTTP 401, HTTP 401]`. */
function attemptSummary(attempts) {
  if (attempts.length === 0) return 'no attempt was made';
  const statuses = attempts.map((attempt) => (attempt.status === null ? 'no response' : `HTTP ${String(attempt.status)}`));
  return `${String(attempts.length)} attempt(s) [${statuses.join(', ')}]`;
}

/** Print one labelled field, indenting continuation lines of a long value. */
function printField(label, value) {
  const lines = String(value).split('\n');
  console.log(`  ${label.padEnd(10)} ${lines[0]}`);
  for (const line of lines.slice(1)) console.log(`  ${' '.repeat(10)} ${line}`);
}

/**
 * Run the one provider call through the production prompt/adapter/wrapper.
 *
 * Returns a flat outcome: the call result (when it succeeded), the validation
 * verdict, the attempts, and the measured latency. It never throws for an
 * expected provider or answer failure — those are the smoke's FAIL.
 */
async function runSmoke({ library, prompt, model, key, timeoutMs, endpoint, provider }) {
  const attempts = [];
  const llm = createFetchHostLlm({ endpoint, apiKey: key, attempts });
  const analyser = library.hostModule.createHostAnalyser(llm, { maxTokens: SMOKE_MAX_TOKENS });
  const controller = new AbortController();
  const startedAt = performance.now();
  let call;
  let callError;
  try {
    call = await library.llmModule.callAnalysisModel(
      analyser,
      { provider, model, system: prompt.system, user: prompt.user, signal: controller.signal },
      { timeoutMs },
    );
  } catch (error) {
    callError = error;
  }
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

  if (callError !== undefined) {
    const message = callError instanceof Error ? callError.message : String(callError);
    return {
      result: 'FAIL',
      call: undefined,
      latencyMs,
      attempts,
      valid: false,
      failureReason: redact(message, key),
      answerPreview: '',
      answer: undefined,
    };
  }

  const raw = typeof call.text === 'string' ? call.text : '';
  const validated = validateAnswer(raw);
  return {
    result: validated.ok ? 'PASS' : 'FAIL',
    call,
    latencyMs,
    attempts,
    valid: validated.ok,
    failureReason: validated.ok ? null : validated.error,
    answerPreview: raw.slice(0, ANSWER_PREVIEW_CHARS),
    answer: validated.ok ? validated.answer : undefined,
  };
}

/** Print the run banner: what is configured, never the key itself. */
function printBanner({ pluginVersion, git, endpoint, provider, model, keyVar, promptInfo }) {
  console.log('Cloud smoke — provider-level analysis call');
  console.log('  boundary:  lib/analyse/{prompt,host,llm}.js only; not the DSH capture chain');
  const gitLabel =
    git.head === null ? 'git unknown' : `git ${git.head}${git.dirty === true ? ' (dirty)' : git.dirty === false ? ' (clean)' : ''}`;
  console.log(`  plugin:    ${pluginVersion} · ${gitLabel} · node ${process.version}`);
  printField('endpoint:', `${displayUrl(endpoint)}`);
  printField('provider:', `${provider} · model ${model}`);
  printField('key:', `${keyVar} (hidden)`);
  printField(
    'prompt:',
    `fake ${String(promptInfo.windowMinutes)}-minute window · ${String(promptInfo.frameCount)} frame(s) · categories ${CATEGORIES.join(', ')}`,
  );
  console.log(
    `  timeout:   ${String(promptInfo.timeoutMs)} ms per attempt · up to ${String(promptInfo.totalAttempts)} attempt(s)`,
  );
}

/** Print the call/answer result lines for one outcome. */
function printOutcome(outcome) {
  if (outcome.call === undefined) {
    printField('call:', `${attemptSummary(outcome.attempts)} failed in ${String(outcome.latencyMs)} ms`);
    if (outcome.failureReason !== null) printField('error:', outcome.failureReason);
    return;
  }

  printField('call:', `${attemptSummary(outcome.attempts)} succeeded in ${String(outcome.latencyMs)} ms`);
  const inputTokens = outcome.call.inputTokens;
  const outputTokens = outcome.call.outputTokens;
  printField(
    'usage:',
    inputTokens === 0 && outputTokens === 0
      ? 'not reported by the provider'
      : `input ${String(inputTokens)} tokens · output ${String(outputTokens)} tokens`,
  );
  if (outcome.valid) {
    const category = outcome.answer.category === '' ? '"" (none)' : `"${outcome.answer.category}"`;
    const title = outcome.answer.title.length > 80 ? `${outcome.answer.title.slice(0, 80)}…` : outcome.answer.title;
    printField(
      'answer:',
      `valid JSON · title "${title}" · category ${category} · confidence ${String(outcome.answer.confidence)}`,
    );
    console.log('  check:     exactly one JSON object; title/summary/category/confidence present');
    return;
  }

  printField('answer:', `invalid — ${outcome.failureReason}`);
  if (outcome.answerPreview !== '') {
    console.log(`  raw (first ${String(ANSWER_PREVIEW_CHARS)} chars):`);
    for (const line of outcome.answerPreview.split('\n')) console.log(`    ${line}`);
  }
}

/** Write the record JSON, refusing to write one that contains the key. */
function writeRecord(rawPath, record, key) {
  const absolute = resolve(process.cwd(), rawPath);
  const serialised = `${JSON.stringify(record, null, 2)}\n`;
  if (serialised.includes(key)) throw new RecordError('refusing to write a record that contains the API key.');
  try {
    writeFileSync(absolute, serialised, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    throw new RecordError(`could not write the record to ${absolute}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (absolute === REPO_ROOT || absolute.startsWith(`${REPO_ROOT}${sep}`)) {
    console.warn(`cloud-smoke: warning: the record is inside the repository checkout (${absolute}); do not commit it.`);
  }
  return absolute;
}

/** The JSON record for `--record`: no key, only the endpoint host. */
function buildRecord(context, outcome) {
  return {
    tool: 'cloud-smoke',
    formatVersion: 1,
    result: outcome.result,
    date: new Date().toISOString(),
    pluginVersion: context.pluginVersion,
    gitHead: context.git.head,
    gitDirty: context.git.dirty,
    provider: context.provider,
    baseUrlHost: context.baseUrlHost,
    model: context.model,
    latencyMs: outcome.latencyMs,
    attempts: outcome.attempts.length,
    inputTokens: outcome.call === undefined ? 0 : outcome.call.inputTokens,
    outputTokens: outcome.call === undefined ? 0 : outcome.call.outputTokens,
    valid: outcome.valid,
    answerPreview: redact(outcome.answerPreview, context.key),
    failureReason: outcome.failureReason === null ? null : redact(outcome.failureReason, context.key),
  };
}

/** The whole smoke: parse, resolve, call, validate, record, print, exit code. */
async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`cloud-smoke: ${error.message}`);
      console.error('Run `node scripts/cloud-smoke.mjs --help` for usage.');
      return 2;
    }
    throw error;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const keyFromSmoke = envValue('SMOKE_API_KEY');
  const keyFromDeepSeek = envValue('DEEPSEEK_API_KEY');
  const key = keyFromSmoke ?? keyFromDeepSeek;
  const keyVar = keyFromSmoke !== undefined ? 'SMOKE_API_KEY' : 'DEEPSEEK_API_KEY';
  if (key === undefined) {
    console.error('cloud-smoke: no API key found.');
    console.error('Set SMOKE_API_KEY (preferred) or DEEPSEEK_API_KEY in this shell, then re-run.');
    console.error('The key is read only from the environment; it is never printed and never written to the record.');
    return 2;
  }

  let context;
  try {
    const rawBaseUrl = options.baseUrl ?? envValue('SMOKE_BASE_URL') ?? DEFAULT_BASE_URL;
    const { url } = resolveBaseUrl(rawBaseUrl);
    const rawModel = options.model ?? envValue('SMOKE_MODEL') ?? DEFAULT_MODEL;
    const model = rawModel.trim();
    if (model === '') throw new UsageError('the model id is empty.');
    const endpoint = chatEndpoint(url);
    const library = await loadLibrary();
    const { prompt, windowMinutes, frameCount } = buildSmokePrompt(library.promptModule);
    const timeoutMs = options.timeoutMs ?? library.llmModule.ANALYSIS_CALL_TIMEOUT_MS;
    const totalAttempts = library.llmModule.ANALYSIS_MAX_RETRIES + 1;
    context = {
      library,
      prompt,
      promptInfo: { windowMinutes, frameCount, timeoutMs, totalAttempts },
      model,
      key,
      keyVar,
      timeoutMs,
      endpoint,
      provider: providerLabel(url.hostname),
      baseUrlHost: url.hostname,
      pluginVersion: readPluginVersion(),
      git: readGitState(),
    };
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`cloud-smoke: ${error.message}`);
      return 2;
    }
    throw error;
  }

  printBanner(context);
  const outcome = await runSmoke({
    library: context.library,
    prompt: context.prompt,
    model: context.model,
    key: context.key,
    timeoutMs: context.timeoutMs,
    endpoint: context.endpoint,
    provider: context.provider,
  });
  printOutcome(outcome);

  if (options.recordPath !== undefined) {
    try {
      const recordPath = writeRecord(options.recordPath, buildRecord(context, outcome), context.key);
      printField('record:', `${recordPath} (no key)`);
    } catch (error) {
      if (!(error instanceof RecordError)) throw error;
      console.error(`cloud-smoke: ${error.message}`);
      console.log('SMOKE FAIL — the provider check finished, but no record could be written.');
      return 1;
    }
  } else {
    printField('record:', 'none (pass --record <path> to write one)');
  }

  if (outcome.result === 'PASS') {
    console.log('SMOKE PASS — provider call, prompt contract, retry/usage wrapper, and JSON answer verified.');
    return 0;
  }
  console.log('SMOKE FAIL — do not record this run as tag-gate evidence.');
  return 1;
}

const exitCode = await main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`cloud-smoke: unexpected failure: ${message}`);
  return 1;
});
process.exitCode = exitCode;
