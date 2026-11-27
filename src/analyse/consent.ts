/**
 * The analysis consent gate: one pure decision, checked before any provider call.
 *
 * Analysing screen frames is the one thing in this plugin that can send pixels
 * or screen text off the machine, so the decision is deliberately not spread
 * across the pipeline. It is a single pure function over the resolved
 * configuration and the capture runtime state:
 *
 * - the analysis switch and the capture switch must both be on;
 * - a paused capture loop blocks analysis of old frames too;
 * - `consent: 'none'` blocks everything, which is the shipped default;
 * - a `cloud` consent needs an explicit provider and model — there is no
 *   implicit host default for something that costs money and sees the screen;
 * - a `local` consent additionally requires the provider to be on the explicit
 *   allowlist of providers that stay on this machine.
 *
 * The order of the checks is part of the contract: the first matching block is
 * the reported reason, so the panel can say the one thing the user has to fix
 * next. The function reads no database, no environment, and no clock, which is
 * what lets every branch be tested without a network or a real journal.
 * @module dsh-plugin-dayflow/analyse/consent
 */

/** Why analysis may not run. The first failing check wins. */
export type AnalysisBlockedReason =
  /** `analysis.enabled` is false. */
  | 'analysis-disabled'
  /** `capture.enabled` is false: nothing is being recorded. */
  | 'capture-disabled'
  /** The user paused capture, which also stops analysing old frames. */
  | 'paused'
  /** `analysis.consent` is `none` (or unrecognized): frames stay local. */
  | 'consent:none'
  /** `consent: local`, but the provider is not on the local allowlist. */
  | 'consent:provider-not-local'
  /** No provider is configured; there is no implicit host default. */
  | 'provider-unset'
  /** No model is configured; there is no implicit host default. */
  | 'model-unset';

/** Analysis may proceed with this provider and model. */
export interface AnalysisAllowed {
  allowed: true;
  /** The configured provider, trimmed. */
  provider: string;
  /** The configured model, trimmed. */
  model: string;
}

/** Analysis may not proceed, and this is the single reason to show. */
export interface AnalysisBlocked {
  allowed: false;
  reason: AnalysisBlockedReason;
}

/** The consent gate's answer. */
export type ConsentDecision = AnalysisAllowed | AnalysisBlocked;

/** The configuration slice the gate reads. */
export interface AnalysisConsentInput {
  analysis: {
    /** The analysis master switch. */
    enabled: boolean;
    /** Where frames may be analysed: nowhere, a cloud provider, or local only. */
    consent: 'none' | 'cloud' | 'local';
    /** Provider id, as configured (may be empty or padded). */
    provider: string;
    /** Model id, as configured (may be empty or padded). */
    model: string;
    /**
     * Provider ids that are allowed under `consent: 'local'`.
     *
     * Optional so a caller holding an older resolved config (or a hand-built
     * literal in an embedder) still type-checks; absent means the allowlist is
     * empty, which refuses every `local` provider rather than silently trusting
     * a name.
     */
    localProviders?: readonly string[];
  };
  capture: {
    /** The native capture master switch. */
    enabled: boolean;
  };
  /** Whether the user paused capture (`capture_state.paused`). */
  paused: boolean;
}

/** Whether `provider` appears on the local allowlist, case-insensitively. */
function isLocalProvider(provider: string, localProviders: readonly string[] | undefined): boolean {
  if (localProviders === undefined) return false;
  const wanted = provider.toLowerCase();
  return localProviders.some((entry) => typeof entry === 'string' && entry.trim().toLowerCase() === wanted);
}

/**
 * Decide whether one analysis call may run.
 *
 * Checks run in this order, and the first block is returned:
 * analysis switch, capture switch, pause, consent, provider, model, local
 * allowlist. An unrecognized `consent` value is treated as `none` (fail closed).
 *
 * @param input - the resolved analysis/capture config plus the pause flag.
 * @returns `{ allowed: true, provider, model }` with trimmed ids, or
 *   `{ allowed: false, reason }`.
 */
export function decideAnalysis(input: AnalysisConsentInput): ConsentDecision {
  const analysis = input.analysis;
  if (!analysis.enabled) return { allowed: false, reason: 'analysis-disabled' };
  if (!input.capture.enabled) return { allowed: false, reason: 'capture-disabled' };
  if (input.paused) return { allowed: false, reason: 'paused' };

  const consent = analysis.consent;
  if (consent !== 'cloud' && consent !== 'local') return { allowed: false, reason: 'consent:none' };

  const provider = analysis.provider.trim();
  if (provider === '') return { allowed: false, reason: 'provider-unset' };
  const model = analysis.model.trim();
  if (model === '') return { allowed: false, reason: 'model-unset' };

  if (consent === 'local' && !isLocalProvider(provider, analysis.localProviders)) {
    return { allowed: false, reason: 'consent:provider-not-local' };
  }

  return { allowed: true, provider, model };
}
