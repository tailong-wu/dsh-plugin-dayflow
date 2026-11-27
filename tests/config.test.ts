/**
 * The named analysis-model list in the resolved configuration.
 *
 * 0.10.0 added `analysis.models`: a profile may name up to eight models and
 * pick one active entry per run. The frozen contract is that an absent or
 * empty list leaves the pre-0.10 single `analysis.provider` + `analysis.model`
 * pair untouched — the resolved legacy block is byte-identical, so the consent
 * gates, the worker, the pipeline, and the automation closes keep reading the
 * pair they always did. A non-empty list resolves the selected entry's pair
 * into the same two fields, so those consumers cannot tell the shapes apart.
 *
 * The selection and its validation live in `src/analyse/models.ts` and are
 * exercised here through both `resolveConfig` and the loader `Config` schema.
 * These are pure configuration tests: no journal, no network, no model call.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AnalysisModelConfig } from '../src/analyse/models.js';
import { resolveAnalysisModels } from '../src/analyse/models.js';
import { Config, resolveConfig } from '../src/config.js';
import type { DayflowConfig } from '../src/config.js';
import { DayflowError } from '../src/errors.js';

/** Force a value past the compiler so the runtime validator is what fails. */
function invalidConfig(value: unknown): never {
  return value as never;
}

/** A rejected `resolveConfig` value. */
function isInvalidInput(error: unknown): boolean {
  return error instanceof DayflowError && error.code === 'invalid_input';
}

/** A rejected `resolveConfig` value whose message also matches `pattern`. */
function invalidInput(pattern: RegExp): (error: unknown) => boolean {
  return (error) => isInvalidInput(error) && pattern.test((error as Error).message);
}

/** One named entry with otherwise-valid defaults. */
function model(overrides: Partial<AnalysisModelConfig> = {}): AnalysisModelConfig {
  return { id: 'deepseek-flash', provider: 'deepseek', model: 'deepseek-flash', ...overrides };
}

/** A two-entry list with distinct providers and models to select between. */
const MODELS: AnalysisModelConfig[] = [
  model({ id: 'deepseek-flash', provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek Flash' }),
  model({ id: 'deepseek-pro', provider: 'deepseek', model: 'deepseek-reasoner', label: 'DeepSeek Pro' }),
];

test('a default profile keeps the legacy block, with no named-model keys', () => {
  const resolved = resolveConfig({});
  assert.equal(resolved.analysis.provider, '');
  assert.equal(resolved.analysis.model, '');
  assert.equal('models' in resolved.analysis, false, 'an absent list adds no key to the legacy shape');
  assert.equal('modelId' in resolved.analysis, false);

  // The loader schema must not inject the key either, or every pre-0.10
  // profile's parsed block would stop matching the resolved one.
  const parsed = Config({}) as DayflowConfig;
  assert.equal('models' in (parsed.analysis ?? {}), false);
  assert.deepEqual(parsed.analysis, resolved.analysis);
});

test('the legacy pair resolves trimmed and byte-identical to the pre-0.10 shape, and [] is the same shape', () => {
  const resolved = resolveConfig({ analysis: { provider: ' deepseek ', model: ' deepseek-flash ' } });
  assert.deepEqual(resolved.analysis, {
    enabled: true,
    intervalMinutes: 5,
    consent: 'none',
    localProviders: [],
    provider: 'deepseek',
    model: 'deepseek-flash',
    windowMinutes: 10,
    framesPerWindow: 3,
    maxCallsPerDay: 120,
    dailyTokenBudget: 200_000,
  });

  const emptyList = resolveConfig({ analysis: { models: [], provider: ' deepseek ', model: ' deepseek-flash ' } });
  assert.deepEqual(emptyList.analysis, resolved.analysis, 'an empty list is the legacy shape, not a list shape');
});

test('the pure selector treats an absent and an empty list as the legacy pair', () => {
  assert.deepEqual(resolveAnalysisModels(undefined, ' deepseek ', ' deepseek-flash '), {
    models: [],
    provider: 'deepseek',
    model: 'deepseek-flash',
    modelId: '',
  });
  assert.deepEqual(resolveAnalysisModels([], 'deepseek', 'deepseek-flash'), {
    models: [],
    provider: 'deepseek',
    model: 'deepseek-flash',
    modelId: '',
  });
});

test('a named list defaults to the first entry and exposes the normalized list', () => {
  const resolved = resolveConfig({
    analysis: {
      models: [
        model({ id: ' deepseek-flash ', provider: ' deepseek ', model: ' deepseek-chat ', label: ' DeepSeek Flash ' }),
        model({ id: 'deepseek-pro', provider: 'deepseek', model: 'deepseek-reasoner' }),
      ],
    },
  });

  assert.equal(resolved.analysis.provider, 'deepseek');
  assert.equal(resolved.analysis.model, 'deepseek-chat');
  assert.equal(resolved.analysis.modelId, 'deepseek-flash');
  assert.deepEqual(resolved.analysis.models, [
    { id: 'deepseek-flash', provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek Flash' },
    { id: 'deepseek-pro', provider: 'deepseek', model: 'deepseek-reasoner' },
  ]);
  assert.equal('label' in resolved.analysis.models![1]!, false, 'a label the profile omitted stays absent');
});

test('analysis.model selects a named entry by id, trimmed and case-insensitively', () => {
  for (const selector of ['deepseek-pro', '  DeepSeek-Pro  ', 'DEEPSEEK-PRO']) {
    const resolved = resolveConfig({ analysis: { models: MODELS, model: selector } });
    assert.equal(resolved.analysis.modelId, 'deepseek-pro', `selector ${JSON.stringify(selector)}`);
    assert.equal(resolved.analysis.provider, 'deepseek');
    assert.equal(resolved.analysis.model, 'deepseek-reasoner');
  }
});

test('an absent or blank selector takes the first entry', () => {
  for (const modelId of [undefined, '', '   ']) {
    const resolved = resolveConfig({ analysis: { models: MODELS, ...(modelId === undefined ? {} : { model: modelId }) } });
    assert.equal(resolved.analysis.modelId, 'deepseek-flash');
    assert.equal(resolved.analysis.model, 'deepseek-chat');
  }
});

test('an unknown selector is a load error naming the id and the known ids', () => {
  const selector = 'deepseek-typo';
  assert.throws(
    () => resolveConfig({ analysis: { models: MODELS, model: selector } }),
    invalidInput(/"deepseek-typo" does not name an entry in analysis\.models \(known ids: deepseek-flash, deepseek-pro\)/),
    'a typo must not silently select a different model',
  );
  // The loader passes the raw list through, so resolveConfig owns the check.
  assert.throws(
    () => resolveConfig(Config(invalidConfig({ analysis: { models: MODELS, model: selector } })) as DayflowConfig),
    isInvalidInput,
  );
});

test('the selector is only an id in list mode; in the legacy shape it is the model id', () => {
  const legacy = resolveConfig({ analysis: { model: 'custom-model' } });
  assert.equal(legacy.analysis.model, 'custom-model');
  assert.equal('models' in legacy.analysis, false);
  assert.equal('modelId' in legacy.analysis, false);
});

test('duplicate entry ids are rejected case-insensitively', () => {
  for (const duplicate of ['deepseek-flash', ' DEEPSEEK-FLASH ', 'DeepSeek-Flash']) {
    assert.throws(
      () => resolveConfig({ analysis: { models: [model(), model({ id: duplicate })] } }),
      invalidInput(/analysis\.models\[1\]\.id duplicates .* \(ids are unique and matched case-insensitively\)/),
      duplicate,
    );
  }
});

test('an incomplete or malformed entry is rejected with the entry path', () => {
  const cases: { label: string; models: unknown[]; pattern: RegExp }[] = [
    { label: 'missing id', models: [{ provider: 'p', model: 'm' }], pattern: /analysis\.models\[0\]\.id must be a non-empty string/ },
    { label: 'blank id', models: [{ id: '   ', provider: 'p', model: 'm' }], pattern: /analysis\.models\[0\]\.id must be a non-empty string/ },
    { label: 'non-string id', models: [{ id: 7, provider: 'p', model: 'm' }], pattern: /analysis\.models\[0\]\.id must be a non-empty string/ },
    {
      label: 'missing provider',
      models: [{ id: 'a', model: 'm' }],
      pattern: /analysis\.models\[0\] \(id "a"\)\.provider must be a non-empty string/,
    },
    {
      label: 'blank provider',
      models: [{ id: 'a', provider: '  ', model: 'm' }],
      pattern: /analysis\.models\[0\] \(id "a"\)\.provider must be a non-empty string/,
    },
    {
      label: 'missing model',
      models: [{ id: 'a', provider: 'p' }],
      pattern: /analysis\.models\[0\] \(id "a"\)\.model must be a non-empty string/,
    },
    {
      label: 'entry is not an object',
      models: ['deepseek-flash'],
      pattern: /analysis\.models\[0\] must be an object with id, provider, and model/,
    },
    { label: 'entry is null', models: [null], pattern: /analysis\.models\[0\] must be an object with id, provider, and model/ },
  ];
  for (const { label, models, pattern } of cases) {
    assert.throws(
      () => resolveConfig({ analysis: { models: models as AnalysisModelConfig[] } }),
      invalidInput(pattern),
      label,
    );
  }
  // A non-array value is rejected instead of being iterated character by character.
  assert.throws(
    () => resolveConfig({ analysis: { models: invalidConfig('deepseek-flash') } }),
    invalidInput(/analysis\.models must be an array of \{ id, provider, model, label\? \} entries/),
  );
});

test('a non-empty list cannot be combined with the legacy analysis.provider', () => {
  assert.throws(
    () => resolveConfig({ analysis: { provider: 'openai', models: [model()] } }),
    invalidInput(/analysis\.models and analysis\.provider cannot both be set: each entry carries its own provider, so remove analysis\.provider \(received "openai"\)/),
  );
  // Padded whitespace is empty, so it does not conflict.
  const resolved = resolveConfig({ analysis: { provider: '   ', models: [model()] } });
  assert.equal(resolved.analysis.provider, 'deepseek', 'the active entry supplies the effective provider');
});

test('the list is bounded to eight entries', () => {
  const eight = Array.from({ length: 8 }, (_, index) =>
    model({ id: `model-${String(index)}`, model: `model-${String(index)}` }),
  );
  const resolved = resolveConfig({ analysis: { models: eight } });
  assert.equal(resolved.analysis.modelId, 'model-0');
  assert.equal(resolved.analysis.models?.length, 8);

  const nine = [...eight, model({ id: 'model-8', model: 'model-8' })];
  assert.throws(
    () => resolveConfig({ analysis: { models: nine } }),
    invalidInput(/analysis\.models may hold at most 8 entries \(received 9\)/),
  );
});

test('entry ids and labels are trimmed and length-bounded', () => {
  assert.throws(
    () => resolveConfig({ analysis: { models: [model({ id: 'x'.repeat(65) })] } }),
    invalidInput(/analysis\.models\[0\]\.id must be at most 64 characters \(received 65\)/),
  );
  assert.throws(
    () => resolveConfig({ analysis: { models: [model({ label: 'y'.repeat(81) })] } }),
    invalidInput(/analysis\.models\[0\] \(id "deepseek-flash"\)\.label must be at most 80 characters \(received 81\)/),
  );
  assert.throws(
    () => resolveConfig({ analysis: { models: [model({ label: invalidConfig(42) })] } }),
    invalidInput(/\.label must be a string of at most 80 characters when set/),
  );

  // A blank label is simply absent; the id is what the selector names.
  const resolved = resolveConfig({ analysis: { models: [model({ id: '  trimmed-id  ', label: '   ' })] } });
  assert.equal(resolved.analysis.modelId, 'trimmed-id');
  assert.equal('label' in resolved.analysis.models![0]!, false);
});

test('an unknown entry key is never read into or echoed by the resolved config', () => {
  const entries = [
    {
      id: 'deepseek-flash',
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'sk-never-echo-this',
      baseURL: 'https://example.test',
    },
  ];
  for (const resolved of [
    resolveConfig({ analysis: { models: entries as AnalysisModelConfig[] } }),
    resolveConfig(Config(invalidConfig({ analysis: { models: entries } })) as DayflowConfig),
  ]) {
    const serialized = JSON.stringify(resolved.analysis);
    assert.equal(serialized.includes('sk-never-echo-this'), false);
    assert.equal(serialized.includes('apiKey'), false);
    assert.equal(serialized.includes('baseURL'), false);
    assert.deepEqual(Object.keys(resolved.analysis.models![0]!).sort(), ['id', 'model', 'provider']);
  }
});
