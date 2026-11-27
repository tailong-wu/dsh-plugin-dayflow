/**
 * The analysis consent gate: one pure decision, every blocked reason.
 *
 * Analysis may only touch frames after this function allows it, so the tests
 * enumerate each block in the order the panel reports it, plus the two positives
 * (`cloud` with an explicit provider/model, and `local` with an allowlisted
 * provider). The function is pure: the same input always gives the same output
 * and the input object is never mutated.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideAnalysis } from '../src/analyse/consent.js';
import type {
  AnalysisBlockedReason,
  AnalysisConsentInput,
  ConsentDecision,
} from '../src/analyse/consent.js';

type AnalysisInput = AnalysisConsentInput['analysis'];

/** The exact input shape decideAnalysis reads, plus the two test conveniences. */
interface Overrides {
  analysis?: Partial<AnalysisInput>;
  capture?: { enabled: boolean };
  paused?: boolean;
}

/** A configuration that would be allowed, before one field is overridden. */
function decide(overrides: Overrides = {}): ConsentDecision {
  const analysis: AnalysisInput = {
    enabled: true,
    consent: 'cloud',
    provider: ' anthropic ',
    model: ' claude-sonnet-5 ',
    ...(overrides.analysis ?? {}),
  };
  return decideAnalysis({
    analysis,
    capture: overrides.capture ?? { enabled: true },
    paused: overrides.paused ?? false,
  });
}

/** Assert the decision is blocked for exactly this reason. */
function expectBlocked(decision: ConsentDecision, reason: AnalysisBlockedReason): void {
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.reason, reason);
}

test('an allowed cloud analysis returns the trimmed provider and model', () => {
  const decision = decide();
  assert.equal(decision.allowed, true);
  if (decision.allowed) {
    assert.equal(decision.provider, 'anthropic');
    assert.equal(decision.model, 'claude-sonnet-5');
  }
});

test('the analysis switch blocks first', () => {
  expectBlocked(
    decide({ analysis: { enabled: false, consent: 'none', provider: '', model: '' }, capture: { enabled: false }, paused: true }),
    'analysis-disabled',
  );
});

test('capture must be enabled', () => {
  expectBlocked(decide({ capture: { enabled: false } }), 'capture-disabled');
  // The capture switch wins over a pause and a missing consent.
  expectBlocked(decide({ capture: { enabled: false }, paused: true, analysis: { consent: 'none' } }), 'capture-disabled');
});

test('a paused capture loop blocks analysis', () => {
  expectBlocked(decide({ paused: true }), 'paused');
  expectBlocked(decide({ paused: true, analysis: { consent: 'none', provider: '' } }), 'paused');
});

test('consent none blocks, and an unrecognized consent fails closed', () => {
  expectBlocked(decide({ analysis: { consent: 'none' } }), 'consent:none');
  expectBlocked(decide({ analysis: { consent: 'everything' as never } }), 'consent:none');
  // Consent is checked before the provider: an empty provider also blocks, but
  // the reported reason is the one the user has to fix first.
  expectBlocked(decide({ analysis: { consent: 'none', provider: '' } }), 'consent:none');
});

test('an unset provider or model blocks before the local-allowlist check', () => {
  expectBlocked(decide({ analysis: { provider: '' } }), 'provider-unset');
  expectBlocked(decide({ analysis: { provider: '   ' } }), 'provider-unset');
  expectBlocked(decide({ analysis: { consent: 'local', provider: '   ', model: '' } }), 'provider-unset');
  expectBlocked(decide({ analysis: { model: '' } }), 'model-unset');
  expectBlocked(decide({ analysis: { model: '  ' } }), 'model-unset');
});

test('consent local refuses a provider that is not on the allowlist', () => {
  expectBlocked(decide({ analysis: { consent: 'local' } }), 'consent:provider-not-local');
  expectBlocked(
    decide({ analysis: { consent: 'local', provider: 'anthropic', localProviders: [] } }),
    'consent:provider-not-local',
  );
  expectBlocked(
    decide({ analysis: { consent: 'local', provider: 'anthropic', localProviders: ['ollama', 'lmstudio'] } }),
    'consent:provider-not-local',
  );
  // Exact match: a prefix or a superset is not the same provider.
  expectBlocked(
    decide({ analysis: { consent: 'local', provider: 'ollama-cloud', localProviders: ['ollama'] } }),
    'consent:provider-not-local',
  );
});

test('consent local accepts an allowlisted provider case-insensitively', () => {
  const decision = decide({
    analysis: {
      consent: 'local',
      provider: ' Ollama ',
      model: ' qwen3:8b ',
      localProviders: [' OLLAMA ', ' LMStudio '],
    },
  });
  assert.equal(decision.allowed, true);
  if (decision.allowed) {
    assert.equal(decision.provider, 'Ollama');
    assert.equal(decision.model, 'qwen3:8b');
  }
});

test('the decision is pure: it does not mutate its input', () => {
  const input: AnalysisConsentInput = {
    analysis: {
      enabled: true,
      consent: 'local',
      provider: ' Ollama ',
      model: ' qwen ',
      localProviders: ['OLLAMA'],
    },
    capture: { enabled: true },
    paused: false,
  };
  const snapshot = structuredClone(input);
  const first = decideAnalysis(input);
  const second = decideAnalysis(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, snapshot);
  assert.equal(first.allowed, true);
});
