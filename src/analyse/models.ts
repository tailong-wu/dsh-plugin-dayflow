/**
 * The named analysis-model list: normalization and active-entry selection.
 *
 * A profile may name several analysis models and choose one active entry per
 * run instead of editing a single provider/model pair. This module is the one
 * place that decides what the effective pair is; it is pure, imports only the
 * error class, and is shared by `resolveConfig` (so every existing consumer
 * keeps reading the resolved pair) and the status builder (so the panel can
 * name the model the next call would use).
 *
 * Two shapes resolve to the same pair:
 *
 * - an absent or empty list is the legacy single pair, trimmed, exactly as it
 *   was read before the list existed;
 * - a non-empty list selects one entry: `analysis.model` names an entry id
 *   (trimmed, case-insensitive), and an empty selector takes the first entry.
 *   The legacy `analysis.provider` must then be empty, because each entry
 *   carries its own provider; combining both would be ambiguous.
 *
 * The list is a configuration shape only: the selected entry's provider/model
 * is what the consent gates, the worker, the pipeline, and the automation
 * closes consume, so no call site forks on the shape.
 * @module dsh-plugin-dayflow/analyse/models
 */

import { DayflowError } from '../errors.js';

/** One named analysis model as written in the profile. */
export interface AnalysisModelConfig {
  /** The selector `analysis.model` names; unique across the list. */
  id?: string;
  /** A provider the host profile exposes. */
  provider?: string;
  /** A model id that provider serves. */
  model?: string;
  /** Optional human label, shown by the panel in place of the ids. */
  label?: string;
}

/** One validated named entry: every id trimmed, ids unique. */
export interface ResolvedAnalysisModel {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  /** Present only when the profile wrote a non-blank label. */
  readonly label?: string;
}

/** The effective call pair and, in list mode, the selected entry. */
export interface ResolvedAnalysisModels {
  /** The normalized entries in written order; empty in the legacy shape. */
  readonly models: readonly ResolvedAnalysisModel[];
  /** The effective provider: the active entry's, or the trimmed legacy one. */
  readonly provider: string;
  /** The effective model: the active entry's, or the trimmed legacy one. */
  readonly model: string;
  /** The active entry id; empty string in the legacy shape. */
  readonly modelId: string;
}

/** Most entries one profile may name. */
export const MAX_ANALYSIS_MODELS = 8;

/** Longest accepted entry id, in characters after trimming. */
export const MAX_ANALYSIS_MODEL_ID_LENGTH = 64;

/** Longest accepted entry label, in characters after trimming. */
export const MAX_ANALYSIS_MODEL_LABEL_LENGTH = 80;

/** How a rejected value is described without echoing a whole object. */
function received(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return String(value);
}

/** A trimmed, non-empty, length-bounded string, or an `invalid_input` error. */
function resolveRequiredString(value: unknown, field: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    const bound = maxLength === undefined ? '' : ` of at most ${String(maxLength)} characters`;
    throw new DayflowError(
      `${field} must be a non-empty string${bound} (received ${received(value)}).`,
      'invalid_input',
    );
  }
  const trimmed = value.trim();
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new DayflowError(
      `${field} must be at most ${String(maxLength)} characters (received ${String(trimmed.length)}).`,
      'invalid_input',
    );
  }
  return trimmed;
}

/** The optional label: omitted when blank, trimmed otherwise. */
function resolveOptionalLabel(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new DayflowError(
      `${field} must be a string of at most ${String(MAX_ANALYSIS_MODEL_LABEL_LENGTH)} characters when set (received ${received(value)}).`,
      'invalid_input',
    );
  }
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > MAX_ANALYSIS_MODEL_LABEL_LENGTH) {
    throw new DayflowError(
      `${field} must be at most ${String(MAX_ANALYSIS_MODEL_LABEL_LENGTH)} characters (received ${String(trimmed.length)}).`,
      'invalid_input',
    );
  }
  return trimmed;
}

/**
 * Normalize the named model list and select the active entry, or read the
 * legacy pair when the list is absent or empty.
 *
 * In list mode the selector may be `undefined`/blank (the first entry wins) or
 * an entry id, matched case-insensitively after trimming. An unknown selector
 * is a load error rather than a silent fallback, because a typo must not
 * quietly select a different model.
 *
 * @param models - the profile's `analysis.models`, absent for the legacy shape.
 * @param legacyProvider - the profile's `analysis.provider`.
 * @param legacyModel - the profile's `analysis.model`: an entry selector in
 *   list mode, the model id in the legacy shape.
 * @returns the normalized list (empty in the legacy shape), the effective
 *   provider/model pair, and the selected entry id (empty in the legacy shape).
 * @throws DayflowError `invalid_input` for a malformed or contradictory list.
 */
export function resolveAnalysisModels(
  models: readonly AnalysisModelConfig[] | undefined,
  legacyProvider: string | undefined,
  legacyModel: string | undefined,
): ResolvedAnalysisModels {
  const legacyPair = {
    provider: legacyProvider?.trim() ?? '',
    model: legacyModel?.trim() ?? '',
  };
  if (models === undefined) return { models: [], ...legacyPair, modelId: '' };
  if (!Array.isArray(models)) {
    throw new DayflowError(
      `analysis.models must be an array of { id, provider, model, label? } entries (received ${received(models)}).`,
      'invalid_input',
    );
  }
  if (models.length === 0) return { models: [], ...legacyPair, modelId: '' };
  if (models.length > MAX_ANALYSIS_MODELS) {
    throw new DayflowError(
      `analysis.models may hold at most ${String(MAX_ANALYSIS_MODELS)} entries (received ${String(models.length)}).`,
      'invalid_input',
    );
  }
  if (legacyPair.provider !== '') {
    throw new DayflowError(
      `analysis.models and analysis.provider cannot both be set: each entry carries its own provider, so remove analysis.provider (received ${JSON.stringify(legacyPair.provider)}).`,
      'invalid_input',
    );
  }

  const resolved: ResolvedAnalysisModel[] = [];
  const seenIds = new Set<string>();
  for (const [index, entry] of models.entries()) {
    const path = `analysis.models[${String(index)}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new DayflowError(
        `${path} must be an object with id, provider, and model (received ${received(entry)}).`,
        'invalid_input',
      );
    }
    const id = resolveRequiredString(entry.id, `${path}.id`, MAX_ANALYSIS_MODEL_ID_LENGTH);
    const withId = `${path} (id ${JSON.stringify(id)})`;
    const key = id.toLowerCase();
    if (seenIds.has(key)) {
      throw new DayflowError(
        `${path}.id duplicates ${JSON.stringify(id)} (ids are unique and matched case-insensitively).`,
        'invalid_input',
      );
    }
    seenIds.add(key);
    const provider = resolveRequiredString(entry.provider, `${withId}.provider`);
    const model = resolveRequiredString(entry.model, `${withId}.model`);
    const label = resolveOptionalLabel(entry.label, `${withId}.label`);
    resolved.push({ id, provider, model, ...(label === undefined ? {} : { label }) });
  }

  let selected: ResolvedAnalysisModel;
  if (legacyPair.model === '') {
    selected = resolved[0]!;
  } else {
    const wanted = legacyPair.model.toLowerCase();
    const match = resolved.find((entry) => entry.id.toLowerCase() === wanted);
    if (match === undefined) {
      const known = resolved.map((entry) => entry.id).join(', ');
      throw new DayflowError(
        `analysis.model ${JSON.stringify(legacyPair.model)} does not name an entry in analysis.models (known ids: ${known}).`,
        'invalid_input',
      );
    }
    selected = match;
  }

  return {
    models: resolved,
    provider: selected.provider,
    model: selected.model,
    modelId: selected.id,
  };
}
