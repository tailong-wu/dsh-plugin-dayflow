/**
 * The analysis model call: retries, a per-call timeout, token accounting, and a
 * fake adapter for zero-network tests.
 *
 * The seam is a plain function, `AnalysisLlmStream`, so production wraps the
 * host's streaming LLM and tests substitute {@link createFakeLlmAdapter}; nothing
 * in between reads configuration or the journal. The wrapper owns every
 * reliability concern so the pipeline can treat one call as one attempt:
 *
 * - each attempt gets its own `AbortController` timeout
 *   ({@link ANALYSIS_CALL_TIMEOUT_MS}); an external `request.signal` abort is
 *   forwarded into the call and stops the retry loop;
 * - a failed or timed-out attempt is retried up to
 *   {@link ANALYSIS_MAX_RETRIES} times with exponential backoff
 *   (250 ms, 500 ms, …), and the injected `sleep` seam keeps tests instant;
 * - the final failure is an {@link AnalysisLlmError} whose `code` is `timeout`
 *   when the last cause was a timeout and `failed` otherwise;
 * - the successful result carries the provider-reported token counts, which the
 *   caller writes into `analysis_jobs` for the daily budget.
 *
 * @module dsh-plugin-dayflow/analyse/llm
 */

/** One model call over one analysis prompt. */
export interface AnalysisLlmRequest {
  /** Provider id resolved from the analysis config. */
  provider: string;
  /** Model id resolved from the analysis config. */
  model: string;
  /** The analysis system prompt. */
  system: string;
  /** The bounded user message for this window. */
  user: string;
  /** Cancels the call; the wrapper forwards an abort into the stream. */
  signal: AbortSignal;
}

/** What one successful model call returns. */
export interface AnalysisLlmResult {
  /** The model's raw answer; the pipeline validates it as one JSON object. */
  text: string;
  /** The model id the provider actually used. */
  model: string;
  /** Input tokens the provider reported (0 when it reported none). */
  inputTokens: number;
  /** Output tokens the provider reported (0 when it reported none). */
  outputTokens: number;
}

/** The seam the wrapper calls; tests substitute a fake. */
export type AnalysisLlmStream = (request: AnalysisLlmRequest) => Promise<AnalysisLlmResult>;

/** How long one attempt may take before it is aborted and retried. */
export const ANALYSIS_CALL_TIMEOUT_MS = 60_000;

/** How many times a failed attempt is retried (total attempts: this + 1). */
export const ANALYSIS_MAX_RETRIES = 2;

/** First retry delay; each later retry doubles it. */
const RETRY_BASE_DELAY_MS = 250;

/** An expected analysis-call failure, safe to tell the caller and the panel. */
export class AnalysisLlmError extends Error {
  /** `timeout` when the last cause was the call timeout, `failed` otherwise. */
  readonly code: 'timeout' | 'failed';

  constructor(message: string, code: 'timeout' | 'failed') {
    super(message);
    this.name = 'AnalysisLlmError';
    this.code = code;
  }
}

/** Tuning seams for {@link callAnalysisModel}; every field has a production default. */
export interface AnalysisCallOptions {
  /** Per-attempt timeout; defaults to {@link ANALYSIS_CALL_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Retries after the first attempt; defaults to {@link ANALYSIS_MAX_RETRIES}. */
  maxRetries?: number;
  /** Delay between attempts; the default waits on a real timer. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** Delay `milliseconds` on a real timer. */
function realSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Convert whatever an attempt threw into a typed failure. */
function asLlmError(error: unknown, attempt: number): AnalysisLlmError {
  if (error instanceof AnalysisLlmError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AnalysisLlmError(`The analysis model call failed on attempt ${String(attempt + 1)}: ${message}`, 'failed');
}

/**
 * Run one attempt with a timeout and external cancellation.
 *
 * The promise settles with the stream's result, the attempt's timeout error, the
 * external abort, or the stream's rejection — whichever comes first. The
 * returned promise never waits for a stream that ignores its abort signal.
 */
function attemptOnce(
  stream: AnalysisLlmStream,
  request: AnalysisLlmRequest,
  timeoutMs: number,
): Promise<AnalysisLlmResult> {
  return new Promise<AnalysisLlmResult>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeoutError: AnalysisLlmError | undefined;

    function cleanup(): void {
      if (timer !== undefined) clearTimeout(timer);
      request.signal.removeEventListener('abort', onExternalAbort);
    }

    function finish(run: () => void): void {
      if (settled) return;
      settled = true;
      cleanup();
      run();
    }

    function onExternalAbort(): void {
      controller.abort(request.signal.reason);
      finish(() => reject(new AnalysisLlmError('The analysis call was cancelled.', 'failed')));
    }

    timer = setTimeout(() => {
      timeoutError = new AnalysisLlmError(
        `The analysis model call timed out after ${String(timeoutMs)} ms.`,
        'timeout',
      );
      controller.abort(timeoutError);
      finish(() => reject(timeoutError as AnalysisLlmError));
    }, timeoutMs);

    if (request.signal.aborted) {
      onExternalAbort();
      return;
    }
    request.signal.addEventListener('abort', onExternalAbort, { once: true });

    let streamed: Promise<AnalysisLlmResult>;
    try {
      streamed = Promise.resolve(stream({ ...request, signal: controller.signal }));
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    streamed.then(
      (result) => {
        finish(() => {
          if (result === null || result === undefined || typeof result.text !== 'string') {
            reject(new AnalysisLlmError('The analysis model returned no text.', 'failed'));
            return;
          }
          resolve(result);
        });
      },
      (error: unknown) => {
        finish(() => reject(timeoutError ?? error));
      },
    );
  });
}

/**
 * Call the analysis model with bounded retries and a per-attempt timeout.
 *
 * Total attempts are `maxRetries + 1`; the delay before retry `n` (0-based) is
 * `250 ms * 2**n`. When every attempt fails, the error's `code` is `timeout`
 * when the final cause was a timeout and `failed` otherwise. An external abort
 * is not retried.
 *
 * @param stream - the model seam.
 * @param request - provider, model, prompts, and the external abort signal.
 * @param options - timeout, retry count, and the delay seam.
 * @returns the successful call's text and usage.
 * @throws {@link AnalysisLlmError} when every attempt failed.
 */
export async function callAnalysisModel(
  stream: AnalysisLlmStream,
  request: AnalysisLlmRequest,
  options: AnalysisCallOptions = {},
): Promise<AnalysisLlmResult> {
  const timeoutMs = options.timeoutMs ?? ANALYSIS_CALL_TIMEOUT_MS;
  const configuredRetries = options.maxRetries ?? ANALYSIS_MAX_RETRIES;
  const maxRetries =
    Number.isFinite(configuredRetries) && configuredRetries > 0 ? Math.floor(configuredRetries) : 0;
  const sleep = options.sleep ?? realSleep;
  const totalAttempts = maxRetries + 1;

  let lastError: AnalysisLlmError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (request.signal.aborted) {
      throw new AnalysisLlmError('The analysis call was cancelled before it started.', 'failed');
    }
    try {
      return await attemptOnce(stream, request, timeoutMs);
    } catch (error) {
      lastError = asLlmError(error, attempt);
      if (request.signal.aborted) throw lastError;
      if (attempt < maxRetries) await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  const cause = lastError ?? new AnalysisLlmError('The analysis model call failed.', 'failed');
  if (cause.code === 'timeout') {
    throw new AnalysisLlmError(
      `The analysis model call timed out after ${String(totalAttempts)} attempt(s): ${cause.message}`,
      'timeout',
    );
  }
  throw new AnalysisLlmError(
    `The analysis model call failed after ${String(totalAttempts)} attempt(s): ${cause.message}`,
    'failed',
  );
}

/** Tuning seams for {@link createFakeLlmAdapter}. */
export interface FakeLlmAdapterOptions {
  /** Wait this long inside every call, to let a timeout or abort win. */
  delayMs?: number;
}

/** A fake stream that also records every request it received. */
export type FakeAnalysisLlmStream = AnalysisLlmStream & { readonly calls: AnalysisLlmRequest[] };

/** Estimate tokens from character count, deterministically and cheaply. */
function estimateTokens(characters: number): number {
  return Math.max(1, Math.ceil(characters / 4));
}

/**
 * Build a scripted stand-in for {@link AnalysisLlmStream}.
 *
 * Call `n` returns `script[n]`: a string resolves to a result whose `text` is
 * that string (with estimated token counts), and an `Error` instance rejects
 * with that same error. Once the script is used up every further call rejects,
 * so a test can prove the pipeline stopped at the attempts cap. Every request is
 * recorded in `calls`, including the calls that fail.
 *
 * @param script - the per-call answers, in order.
 * @param options - an optional in-call delay.
 * @returns a stream function carrying its `calls` history.
 */
export function createFakeLlmAdapter(
  script: ReadonlyArray<string | Error>,
  options: FakeLlmAdapterOptions = {},
): FakeAnalysisLlmStream {
  const calls: AnalysisLlmRequest[] = [];
  const delayMs = options.delayMs ?? 0;
  let index = 0;

  const stream: AnalysisLlmStream = async (request: AnalysisLlmRequest): Promise<AnalysisLlmResult> => {
    const callIndex = index;
    index += 1;
    calls.push(request);
    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
    if (request.signal.aborted) {
      throw new AnalysisLlmError('The analysis call was cancelled.', 'failed');
    }
    if (callIndex >= script.length) {
      throw new Error(`FakeLlmAdapter script exhausted after ${String(script.length)} call(s).`);
    }
    const entry = script[callIndex];
    if (entry instanceof Error) throw entry;
    const text = typeof entry === 'string' ? entry : String(entry);
    return {
      text,
      model: request.model,
      inputTokens: estimateTokens(request.system.length + request.user.length),
      outputTokens: estimateTokens(text.length),
    };
  };

  return Object.assign(stream, { calls });
}
