/**
 * The text-analysis gate for scheduled automation: one pure decision, checked
 * before any model call.
 *
 * Automation closes a day by sending a *text* summary of the day's activities to
 * the configured analysis provider. That is less than pixels, but it is still
 * screen-derived data leaving the machine, so the scheduled path reuses the same
 * consent vocabulary as frame analysis rather than inventing a second switch:
 *
 * - the analysis master switch must be on;
 * - `consent: 'none'` (the shipped default) blocks everything;
 * - a provider and a model must both be configured explicitly — there is no
 *   implicit host default for something that costs money and sees the journal.
 *
 * The gate is deliberately narrower than
 * {@link module:dsh-plugin-dayflow/analyse/consent}: automation reads rows that
 * are already on disk, so it does not depend on capture being enabled, on the
 * capture loop being unpaused, or on the local-provider allowlist (a `local`
 * consent still names an explicit provider/model, and refusing a non-allowlisted
 * provider belongs to the pixel path that actually captures frames). The
 * `analysis.consent` value is therefore only checked against `none` here.
 *
 * The order of the checks is part of the contract: the first matching block is
 * the reported reason, so the panel or the run log can say the one thing the
 * user has to fix next. The function reads no database, no environment, and no
 * clock, which is what lets every branch be tested without a network.
 * @module dsh-plugin-dayflow/automation/consent
 */

/** Why an automation text call may not run. The first failing check wins. */
export type TextBlockedReason =
  /** `analysis.enabled` is false. */
  | 'analysis-disabled'
  /** `analysis.consent` is `none` (or unrecognized): nothing leaves the machine. */
  | 'consent:none'
  /** No provider is configured; there is no implicit host default. */
  | 'provider-unset'
  /** No model is configured; there is no implicit host default. */
  | 'model-unset';

/** The configuration slice the gate reads. */
export interface TextAnalysisInput {
  /** The analysis master switch. */
  enabled: boolean;
  /** Where screen-derived text may be processed: nowhere, a cloud provider, or local only. */
  consent: 'none' | 'cloud' | 'local';
  /** Provider id, as configured (may be empty or padded). */
  provider: string;
  /** Model id, as configured (may be empty or padded). */
  model: string;
}

/** The text call may proceed with this provider and model. */
export interface TextAnalysisAllowed {
  allowed: true;
  /** The configured provider, trimmed. */
  provider: string;
  /** The configured model, trimmed. */
  model: string;
}

/** The text call may not proceed, and this is the single reason to report. */
export interface TextAnalysisBlocked {
  allowed: false;
  reason: TextBlockedReason;
}

/** The gate's answer. */
export type TextAnalysisDecision = TextAnalysisAllowed | TextAnalysisBlocked;

/**
 * Decide whether one automation text call may run.
 *
 * Checks run in this order, and the first block is returned: the analysis
 * switch, the consent value, the provider, then the model. An unrecognized
 * consent value is treated as `none` (fail closed).
 *
 * @param analysis - the resolved `analysis` config block, or the four fields
 *   this gate reads.
 * @returns `{ allowed: true, provider, model }` with trimmed ids, or
 *   `{ allowed: false, reason }`.
 */
export function decideTextAnalysis(analysis: TextAnalysisInput): TextAnalysisDecision {
  if (!analysis.enabled) return { allowed: false, reason: 'analysis-disabled' };
  if (analysis.consent !== 'cloud' && analysis.consent !== 'local') {
    return { allowed: false, reason: 'consent:none' };
  }
  const provider = analysis.provider.trim();
  if (provider === '') return { allowed: false, reason: 'provider-unset' };
  const model = analysis.model.trim();
  if (model === '') return { allowed: false, reason: 'model-unset' };
  return { allowed: true, provider, model };
}
