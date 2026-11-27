/**
 * The analysis model wrapper: one call, bounded retries, timeout, cancellation.
 *
 * The seam is a plain function, so these tests drive `callAnalysisModel` with a
 * counting fake stream and never touch the network. The timeout test uses a
 * stream that never resolves, which proves the wrapper settles on its own clock
 * instead of waiting for a provider that ignores the abort signal.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ANALYSIS_CALL_TIMEOUT_MS,
  ANALYSIS_MAX_RETRIES,
  AnalysisLlmError,
  callAnalysisModel,
  createFakeLlmAdapter,
} from '../src/analyse/llm.js';
import type { AnalysisLlmRequest, AnalysisLlmResult, AnalysisLlmStream } from '../src/analyse/llm.js';

/** A request carrying only what the wrapper and fakes read. */
function request(overrides: Partial<AnalysisLlmRequest> = {}): AnalysisLlmRequest {
  return {
    provider: 'mock-provider',
    model: 'mock-model',
    system: 'S',
    user: 'U',
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A fake stream that always resolves to the same text. */
function successStream(text: string): AnalysisLlmStream {
  return async (incoming: AnalysisLlmRequest): Promise<AnalysisLlmResult> => ({
    text,
    model: incoming.model,
    inputTokens: 1,
    outputTokens: 1,
  });
}

test('the defaults are the exported constants', () => {
  assert.equal(ANALYSIS_CALL_TIMEOUT_MS, 60_000);
  assert.equal(ANALYSIS_MAX_RETRIES, 2);
});

test('one successful call returns text and token usage', async () => {
  const fake = createFakeLlmAdapter(['{"title":"Writing tests"}']);
  const result = await callAnalysisModel(fake, request(), { sleep: async () => undefined });
  assert.equal(result.text, '{"title":"Writing tests"}');
  assert.equal(result.model, 'mock-model');
  assert.ok(result.inputTokens > 0);
  assert.ok(result.outputTokens > 0);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]?.provider, 'mock-provider');
  assert.equal(fake.calls[0]?.model, 'mock-model');
  assert.equal(fake.calls[0]?.system, 'S');
  assert.equal(fake.calls[0]?.user, 'U');

  const typed: AnalysisLlmStream = successStream('ok');
  const second = await callAnalysisModel(typed, request());
  assert.equal(second.text, 'ok');
});

test('AnalysisLlmError carries its code and stays an Error', () => {
  const constructed = new AnalysisLlmError('too slow', 'timeout');
  assert.equal(constructed.code, 'timeout');
  assert.equal(constructed.name, 'AnalysisLlmError');
  assert.ok(constructed instanceof Error);
  assert.equal(new AnalysisLlmError('nope', 'failed').code, 'failed');
});

test('two failures are retried with exponential backoff, then one success', async () => {
  const delays: number[] = [];
  let calls = 0;
  const stream: AnalysisLlmStream = async (incoming): Promise<AnalysisLlmResult> => {
    calls += 1;
    if (calls <= 2) throw new Error(`attempt ${String(calls)} failed`);
    return { text: 'recovered', model: incoming.model, inputTokens: 3, outputTokens: 2 };
  };
  const result = await callAnalysisModel(stream, request(), {
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
  assert.equal(result.text, 'recovered');
  assert.equal(result.inputTokens, 3);
});

test('every attempt failing throws one AnalysisLlmError with code failed', async () => {
  let calls = 0;
  const stream: AnalysisLlmStream = async (): Promise<AnalysisLlmResult> => {
    calls += 1;
    throw new Error('boom');
  };
  const delays: number[] = [];
  await assert.rejects(
    callAnalysisModel(stream, request(), {
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AnalysisLlmError);
      assert.equal(error.code, 'failed');
      assert.match(error.message, /boom/);
      assert.match(error.message, /after 3 attempt/);
      return true;
    },
  );
  assert.equal(calls, ANALYSIS_MAX_RETRIES + 1);
  assert.deepEqual(delays, [250, 500]);
});

test('a never-resolving stream times out on the wrapper clock', async () => {
  let calls = 0;
  const stream: AnalysisLlmStream = () => {
    calls += 1;
    return new Promise<AnalysisLlmResult>(() => {
      // Deliberately ignores the request signal.
    });
  };
  await assert.rejects(
    callAnalysisModel(stream, request(), { timeoutMs: 10, maxRetries: 0, sleep: async () => undefined }),
    (error: unknown) => {
      assert.ok(error instanceof AnalysisLlmError);
      assert.equal(error.code, 'timeout');
      assert.match(error.message, /timed out after 10 ms/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('every attempt timing out still reports code timeout', async () => {
  let calls = 0;
  const stream: AnalysisLlmStream = () => {
    calls += 1;
    return new Promise<AnalysisLlmResult>(() => undefined);
  };
  await assert.rejects(
    callAnalysisModel(stream, request(), { timeoutMs: 5, maxRetries: 1, sleep: async () => undefined }),
    (error: unknown) => error instanceof AnalysisLlmError && error.code === 'timeout',
  );
  assert.equal(calls, 2);
});

test('an external abort cancels the call without retrying', async () => {
  let calls = 0;
  const stream: AnalysisLlmStream = () => {
    calls += 1;
    return new Promise<AnalysisLlmResult>(() => {
      // Ignore the internal signal; the wrapper must still settle.
    });
  };
  const controller = new AbortController();
  const pending = callAnalysisModel(stream, request({ signal: controller.signal }), {
    timeoutMs: 60_000,
    sleep: async () => undefined,
  });
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof AnalysisLlmError && error.code === 'failed',
  );
  assert.equal(calls, 1);
});

test('an already-aborted signal makes no call at all', async () => {
  let calls = 0;
  const stream: AnalysisLlmStream = async () => {
    calls += 1;
    return { text: 'unused', model: 'unused', inputTokens: 1, outputTokens: 1 };
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    callAnalysisModel(stream, request({ signal: controller.signal }), { sleep: async () => undefined }),
    (error: unknown) => error instanceof AnalysisLlmError && error.code === 'failed',
  );
  assert.equal(calls, 0);
});

test('the fake adapter follows its script, records calls, and rejects when exhausted', async () => {
  const scriptedError = new Error('scripted failure');
  const fake = createFakeLlmAdapter(['first', scriptedError, 'third'], { delayMs: 1 });

  const sleep = async (): Promise<void> => undefined;
  const first = await callAnalysisModel(fake, request(), { sleep });
  assert.equal(first.text, 'first');

  await assert.rejects(
    callAnalysisModel(fake, request(), { maxRetries: 0, sleep }),
    (error: unknown) =>
      error instanceof AnalysisLlmError && error.code === 'failed' && /scripted failure/.test(error.message),
  );

  const third = await callAnalysisModel(fake, request(), { sleep });
  assert.equal(third.text, 'third');

  await assert.rejects(
    callAnalysisModel(fake, request(), { maxRetries: 0, sleep }),
    (error: unknown) => error instanceof Error && /script exhausted/.test(error.message),
  );

  // Every call — including the failures and the exhausted one — is recorded.
  assert.equal(fake.calls.length, 4);
  assert.deepEqual(
    fake.calls.map((call) => call.user),
    ['U', 'U', 'U', 'U'],
  );
});

test('the fake adapter estimates tokens deterministically', async () => {
  const fake = createFakeLlmAdapter(['{"title":"x"}']);
  const result = await callAnalysisModel(fake, request({ system: 'S', user: 'U' }), {
    sleep: async () => undefined,
  });
  // ceil(2 chars / 4) = 1 input token; ceil(13 chars / 4) = 4 output tokens.
  assert.equal(result.inputTokens, 1);
  assert.equal(result.outputTokens, 4);
  assert.equal(result.model, 'mock-model');
});
