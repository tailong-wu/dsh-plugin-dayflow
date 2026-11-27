/**
 * The production analysis model call: adapt the host's streaming `llm` service
 * to the plain {@link AnalysisLlmStream} function the wrapper calls.
 *
 * The host speaks a token-level stream (`text-delta`, `usage`, `finish`, …)
 * whose failure arrives as a terminal `finish` chunk rather than a throw. The
 * analysis pipeline wants one answer per window and one usage record per call,
 * so this adapter collects the text deltas, keeps the last reported usage, and
 * returns one {@link AnalysisLlmResult}; the per-call timeout, retry, and
 * cancellation policy stay in `analyse/llm.ts`.
 *
 * The types are structural rather than imports from `@deepseek-ai/dsh-llm`:
 * the plugin only needs the one streaming entry point, and a fake host can
 * satisfy the same shape in a zero-network test. No image block is ever built:
 * 0.7.2 sends the frame metadata as text only.
 * @module dsh-plugin-dayflow/analyse/host
 */

import type { AnalysisLlmResult, AnalysisLlmRequest, AnalysisLlmStream } from './llm.js';

/** One chunk of the host stream, narrowed to the fields analysis reads. */
export interface HostLlmChunk {
  /** `text-delta`, `usage`, `finish`, …; only the first two are read. */
  type: string;
  /** The delta text, on a `text-delta` chunk. */
  text?: string;
  /** Provider-reported usage, on a `usage` chunk. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** The host's one-shot model call, narrowed to what analysis needs. */
export interface HostLlmLike {
  stream(options: {
    provider: string;
    model: string;
    system?: string;
    /**
     * The host's user messages carry content blocks, not plain strings; an
     * analysis window is one text block and never an image block.
     */
    messages: ReadonlyArray<{ role: 'user'; content: ReadonlyArray<{ type: 'text'; text: string }> }>;
    signal?: AbortSignal;
    maxTokens?: number;
  }): AsyncIterable<HostLlmChunk>;
}

/** Tuning for {@link createHostAnalyser}; every field has a production default. */
export interface HostAnalyserOptions {
  /** Output token ceiling for one call; omitted leaves the host's own default. */
  maxTokens?: number;
}

/** A finite, non-negative token count, or 0 when the provider reported none. */
function tokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Adapt the host LLM service into the analysis model seam.
 *
 * The returned function makes exactly one streamed call per request: text
 * deltas are concatenated, the last `usage` chunk wins (absent counts are 0),
 * and every other chunk type is ignored. A stream that throws rejects the call,
 * which the wrapper in `analyse/llm.ts` retries; the request's abort signal is
 * forwarded unchanged so an external abort stops the provider call.
 *
 * @param llm - the host `llm` service (or a fake with the same shape).
 * @param options - the optional output-token ceiling.
 * @returns a stream function the pipeline can call.
 */
export function createHostAnalyser(llm: HostLlmLike, options: HostAnalyserOptions = {}): AnalysisLlmStream {
  const maxTokens = options.maxTokens;
  return async (request: AnalysisLlmRequest): Promise<AnalysisLlmResult> => {
    const stream = llm.stream({
      provider: request.provider,
      model: request.model,
      system: request.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
      signal: request.signal,
      ...(maxTokens === undefined ? {} : { maxTokens }),
    });

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') {
        if (typeof chunk.text === 'string') text += chunk.text;
        continue;
      }
      if (chunk.type === 'usage') {
        // The provider reports usage once per call; a later chunk supersedes an
        // earlier one, and an absent count means "not reported", not "zero".
        inputTokens = tokenCount(chunk.usage?.inputTokens);
        outputTokens = tokenCount(chunk.usage?.outputTokens);
      }
    }

    return { text, model: request.model, inputTokens, outputTokens };
  };
}
