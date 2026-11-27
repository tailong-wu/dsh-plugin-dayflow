/**
 * Plugin configuration and its resolution into runtime settings.
 * @module dsh-plugin-dayflow/config
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import z from '@deepseek-ai/schemastery';

import { resolveDatabasePath } from './db.js';
import { DayflowError } from './errors.js';
import { iconDirectory } from './icons.js';
import { defaultJournalPath } from './paths.js';
import { sameFile } from './journal.js';

/** Configuration accepted from the profile's YAML (all fields optional). */
export type JournalSource = 'dayflow' | 'owned';

/** Which display the native capture loop records. */
export type CaptureDisplays = 'main' | 'all';

/**
 * Where frames may be analysed.
 *
 * `none` records frames only, `cloud` allows the configured provider to see
 * them, and `local` accepts only a provider that stays on this machine.
 */
export type AnalysisConsent = 'none' | 'cloud' | 'local';

/** A day of the week, lowercase, for the weekly close. */
export type AutomationWeekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/** Native screen capture, off unless the profile opts in. */
export interface CaptureConfig {
  /** Master switch. When false nothing is captured, whatever the other keys say. */
  enabled?: boolean;
  /** Seconds between captures while active. */
  intervalSeconds?: number;
  /** Skip a capture after this many seconds without input; 0 disables the idle gate. */
  idleSeconds?: number;
  /** Hard cap on frames written for one Dayflow day. */
  maxFramesPerDay?: number;
  /** Days a frame file is kept; 0 deletes it once its analysis completes. */
  keepFramesDays?: number;
  /**
   * dHash Hamming distance at or below which a frame is a duplicate of the last
   * stored one, 0-16. 0 only dedupes identical hashes; 16 dedupes everything.
   */
  dedupeDistance?: number;
  /** Minutes between frame-retention sweeps (5-1440). */
  retentionCheckMinutes?: number;
  /** Frontmost-app patterns (bundle id or name) that are never captured. */
  pauseApps?: string[];
  /** `main` records the main display, `all` records every display. */
  displays?: CaptureDisplays;
}

/** Frame analysis: turning captured frames into activity cards. */
export interface AnalysisConfig {
  /** Run the analyser at all. It also needs capture enabled and a consent. */
  enabled?: boolean;
  /** Minutes between analysis worker ticks (1-60). */
  intervalMinutes?: number;
  /** Whether frames may be sent to a provider; `none` keeps analysis local-only/off. */
  consent?: AnalysisConsent;
  /**
   * Provider ids that count as on-machine when `consent` is `local`, matched
   * exactly and case-insensitively; empty accepts no provider under `local`.
   */
  localProviders?: string[];
  /** Provider id; empty uses the agent's default model selection. */
  provider?: string;
  /** Model id; empty uses the provider's default. */
  model?: string;
  /** Minutes of frames grouped into one analysis window. */
  windowMinutes?: number;
  /** Representative frames sent per window. */
  framesPerWindow?: number;
  /** Hard cap on analysis calls for one day. */
  maxCallsPerDay?: number;
  /** Hard cap on analysis tokens for one day. */
  dailyTokenBudget?: number;
}

/** The day-close and week-close jobs. */
export interface AutomationConfig {
  /** Run the scheduled closes at all. */
  enabled?: boolean;
  /** Local `HH:MM` when the day closes, normally the Dayflow 04:00 boundary. */
  dailyAt?: string;
  /** Weekday the weekly close runs at the same boundary. */
  weeklyOn?: AutomationWeekday;
  /** Run a missed close on the next start instead of skipping it. */
  catchUpOnStart?: boolean;
  /**
   * How many missed days (counting the most recent due day) the scheduler may
   * close in one catch-up pass, 1-30. Days older than this window are recorded
   * as skipped rather than fabricated.
   */
  catchUpDays?: number;
}

/** Validated capture settings. */
export interface ResolvedCaptureConfig {
  readonly enabled: boolean;
  readonly intervalSeconds: number;
  readonly idleSeconds: number;
  readonly maxFramesPerDay: number;
  readonly keepFramesDays: number;
  /**
   * Hamming distance at or below which two dHashes are the same picture.
   *
   * `resolveConfig` always fills this from the profile (default 4); it stays
   * optional on the interface so a hand-built config literal in a test or an
   * embedder that predates the field still type-checks. The capture engine
   * falls back to the same default when it is absent.
   */
  readonly dedupeDistance?: number;
  /** Minutes between retention sweeps; see {@link dedupeDistance} for why optional. */
  readonly retentionCheckMinutes?: number;
  readonly pauseApps: readonly string[];
  readonly displays: CaptureDisplays;
}

/** Validated analysis settings. */
export interface ResolvedAnalysisConfig {
  readonly enabled: boolean;
  /** Minutes between analysis worker ticks; the worker backs off when a tick fails. */
  readonly intervalMinutes: number;
  readonly consent: AnalysisConsent;
  /** Provider ids accepted as local under `consent: 'local'`, in written order. */
  readonly localProviders: readonly string[];
  readonly provider: string;
  readonly model: string;
  readonly windowMinutes: number;
  readonly framesPerWindow: number;
  readonly maxCallsPerDay: number;
  readonly dailyTokenBudget: number;
}

/** Validated automation settings. */
export interface ResolvedAutomationConfig {
  readonly enabled: boolean;
  readonly dailyAt: string;
  readonly weeklyOn: AutomationWeekday;
  readonly catchUpOnStart: boolean;
  /** Size of the bounded catch-up window, in days, including the due day. */
  readonly catchUpDays: number;
}

export interface DayflowConfig {
  /** Absolute path to `chunks.sqlite`; defaults to the Dayflow app's location. */
  databasePath?: string;
  /** The read backend. `dayflow` preserves the original behaviour; `owned` reads the imported journal. */
  source?: JournalSource;
  /** Compatibility alias for `source`: false selects the owned journal. */
  dayflow?: boolean;
  /** Absolute path to the plugin-owned journal; defaults to `$DSH_HOME/dayflow/journal.sqlite`. */
  journalPath?: string;
  /** Override the app's write socket; defaults to `agent.sock` beside the database. */
  agentSocket?: string;
  /** Register the editing tools. Their calls still need the app's own edit switch. */
  edits?: boolean;
  /** Register the bundled Dayflow skills. */
  skills?: boolean;
  /** Expose the optional Web panel: a header button and a right-Sidebar tab. */
  panel?: boolean;
  /** Fetch and show site favicons on the panel's activity cards. */
  icons?: boolean;
  /**
   * Inject the active long tasks and the most recent non-superseded memory
   * claims as a budgeted system context. On by default; empty data injects
   * nothing.
   */
  memoryContext?: boolean;
  /**
   * Register the tool that installs Dayflow itself. Off by default: it changes
   * the user's machine, so it must be an explicit deployment choice.
   */
  allowInstall?: boolean;
  /** Maximum matches a search returns. */
  searchLimit?: number;
  /** Native screen capture. Off by default. */
  capture?: CaptureConfig;
  /** Frame analysis; needs capture enabled and an explicit consent. */
  analysis?: AnalysisConfig;
  /** Day-close and week-close automation. */
  automation?: AutomationConfig;
}

/** Validated configuration used by the tools. */
export interface ResolvedConfig {
  readonly databasePath: string;
  readonly source: JournalSource;
  readonly dayflow: boolean;
  readonly journalPath: string;
  readonly agentSocket: string;
  readonly edits: boolean;
  readonly skills: boolean;
  readonly panel: boolean;
  readonly icons: boolean;
  /** Whether the budgeted long-task/memory-claim context is injected. */
  readonly memoryContext: boolean;
  readonly allowInstall: boolean;
  readonly iconDirectory: string;
  readonly searchLimit: number;
  readonly capture: ResolvedCaptureConfig;
  readonly analysis: ResolvedAnalysisConfig;
  readonly automation: ResolvedAutomationConfig;
}

/** The native capture block: everything off or conservative by default. */
const CaptureSchema = z
  .object({
    enabled: z.boolean().default(false).description('Capture the screen natively. Off by default.'),
    intervalSeconds: z
      .natural()
      .min(5)
      .max(600)
      .default(45)
      .description('Seconds between captures while active (5-600).'),
    idleSeconds: z
      .natural()
      .min(0)
      .max(3600)
      .default(120)
      .description('Skip capture after this many seconds without input; 0 disables the idle gate (0-3600).'),
    maxFramesPerDay: z
      .natural()
      .min(1)
      .max(10_000)
      .default(1200)
      .description('Hard cap on frames written for one Dayflow day (1-10000).'),
    keepFramesDays: z
      .natural()
      .min(0)
      .max(30)
      .default(0)
      .description('Days a frame file is kept; 0 deletes it once its analysis completes (0-30).'),
    dedupeDistance: z
      .natural()
      .min(0)
      .max(16)
      .default(4)
      .description('dHash Hamming distance at or below which a frame counts as a duplicate (0-16).'),
    retentionCheckMinutes: z
      .natural()
      .min(5)
      .max(1440)
      .default(60)
      .description('Minutes between frame-retention sweeps (5-1440).'),
    pauseApps: z.array(z.string()).default([]).description('Frontmost-app patterns that are never captured.'),
    displays: z
      .union([z.const('main'), z.const('all')])
      .default('main')
      .description('Record only the main display, or every display.'),
  })
  .default({});

/** The analysis block: safe by default, cloud needs an explicit consent. */
const AnalysisSchema = z
  .object({
    enabled: z.boolean().default(true).description('Run the frame analyser. It also needs capture enabled.'),
    intervalMinutes: z
      .natural()
      .min(1)
      .max(60)
      .default(5)
      .description('Minutes between analysis worker ticks (1-60).'),
    consent: z
      .union([z.const('none'), z.const('cloud'), z.const('local')])
      .default('none')
      .description('Whether frames may be sent to a provider: none, cloud, or local only.'),
    localProviders: z
      .array(z.string())
      .default([])
      .description('Provider ids accepted as local under consent "local", matched case-insensitively.'),
    provider: z.string().default('').description('Model provider id; empty uses the agent default.'),
    model: z.string().default('').description('Model id; empty uses the provider default.'),
    windowMinutes: z
      .natural()
      .min(1)
      .max(60)
      .default(10)
      .description('Minutes of frames grouped into one analysis window (1-60).'),
    framesPerWindow: z
      .natural()
      .min(1)
      .max(5)
      .default(3)
      .description('Representative frames sent per window (1-5).'),
    maxCallsPerDay: z
      .natural()
      .min(1)
      .max(1000)
      .default(120)
      .description('Hard cap on analysis calls for one day (1-1000).'),
    dailyTokenBudget: z
      .natural()
      .min(1000)
      .max(2_000_000)
      .default(200_000)
      .description('Hard cap on analysis tokens for one day (1000-2000000).'),
  })
  .default({});

/** The automation block: closes run at the Dayflow boundary unless turned off. */
const AutomationSchema = z
  .object({
    enabled: z.boolean().default(true).description('Run the scheduled day and week closes.'),
    dailyAt: z
      .string()
      .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('04:00')
      .description('Local time the day closes, as HH:MM (00:00-23:59).'),
    weeklyOn: z
      .union([
        z.const('monday'),
        z.const('tuesday'),
        z.const('wednesday'),
        z.const('thursday'),
        z.const('friday'),
        z.const('saturday'),
        z.const('sunday'),
      ])
      .default('monday')
      .description('Weekday the weekly close runs at the same time.'),
    catchUpOnStart: z.boolean().default(true).description('Run a missed close on the next start instead of skipping it.'),
    catchUpDays: z
      .natural()
      .min(1)
      .max(30)
      .default(2)
      .description('How many missed days one catch-up may close, including the due day (1-30).'),
  })
  .default({});

/** Schema applied by the DSH loader before {@link resolveConfig} runs. */
export const Config = z.object({
  databasePath: z
    .string()
    .default('')
    .description('Absolute path to the Dayflow database. Empty uses ~/Library/Application Support/Dayflow/chunks.sqlite.'),
  source: z
    .string()
    .description('Read backend: dayflow (default) or owned (the plugin journal imported from Dayflow); disagreement with dayflow is rejected.'),
  dayflow: z
    .boolean()
    .description('Compatibility alias: false selects the owned journal; inconsistent source and dayflow values are rejected.'),
  journalPath: z
    .string()
    .default('')
    .description('Absolute path to the plugin-owned journal. Empty uses $DSH_HOME/dayflow/journal.sqlite.'),
  agentSocket: z
    .string()
    .default('')
    .description('Path to the Dayflow write socket. Empty uses agent.sock beside the database.'),
  edits: z
    .boolean()
    .default(true)
    .description('Register the editing tools. Dayflow own "Allow edits" switch still gates every write.'),
  skills: z
    .boolean()
    .default(true)
    .description(
      'Register the eight bundled skills: dayflow, onboarding, standup, weekly-review, review-queue, long-task, memory, and reflection.',
    ),
  panel: z
    .boolean()
    .default(true)
    .description('Expose the optional Web panel: a timeline button in the conversation header and a right-Sidebar tab.'),
  allowInstall: z
    .boolean()
    .default(false)
    .description(
      'Register the Dayflow installer tool. It changes the machine, so it stays off unless the profile opts in.',
    ),
  icons: z
    .boolean()
    .default(true)
    .description(
      'Show each site icon on the panel cards. Turning this off makes no outbound request; it also refuses already cached icons.',
    ),
  memoryContext: z
    .boolean()
    .default(true)
    .description(
      'Inject a budgeted snapshot of active long tasks and recent memory claims as system context. Empty data injects nothing.',
    ),
  searchLimit: z.number().default(50).description('Maximum number of search matches a single call returns (1-200).'),
  capture: CaptureSchema,
  analysis: AnalysisSchema,
  automation: AutomationSchema,
});

const MAX_SEARCH_LIMIT = 200;

/** The accepted values behind the string enums, for explicit validation. */
const CAPTURE_DISPLAYS = ['main', 'all'] as const satisfies readonly CaptureDisplays[];
const ANALYSIS_CONSENTS = ['none', 'cloud', 'local'] as const satisfies readonly AnalysisConsent[];
const AUTOMATION_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const satisfies readonly AutomationWeekday[];
const DAILY_AT_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Resolve one bounded integer setting, rejecting a value the caller wrote
 * explicitly instead of silently falling back to the default.
 */
function resolveInteger(value: number | undefined, fallback: number, min: number, max: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DayflowError(
      `${field} must be a whole number from ${min} to ${max} (received ${String(value)}).`,
      'invalid_input',
    );
  }
  return value;
}

/** Resolve one string enum setting, rejecting an unknown value. */
function resolveChoice<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  field: string,
): T {
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new DayflowError(`${field} must be one of ${allowed.join(', ')} (received ${String(value)}).`, 'invalid_input');
  }
  return value as T;
}

/** Trim, de-duplicate, and drop empty string-list entries, keeping the written order. */
function resolveStringList(values: readonly string[] | undefined, field: string): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== 'string') {
      throw new DayflowError(
        `${field} entries must be strings (received ${String(value)}).`,
        'invalid_input',
      );
    }
    const trimmed = value.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    resolved.push(trimmed);
  }
  return resolved;
}

/** Trim, de-duplicate, and drop empty pause-app patterns, keeping the written order. */
function resolvePauseApps(values: readonly string[] | undefined): string[] {
  return resolveStringList(values, 'capture.pauseApps');
}

/** Resolve and validate the automation close time. */
function resolveDailyAt(value: string | undefined): string {
  const resolved = value ?? '04:00';
  if (!DAILY_AT_PATTERN.test(resolved)) {
    throw new DayflowError(
      `automation.dailyAt must be a local time as HH:MM from 00:00 to 23:59 (received ${String(resolved)}).`,
      'invalid_input',
    );
  }
  return resolved;
}

/**
 * Validate and normalize the loader's configuration.
 * @param config - the validated YAML configuration.
 * @returns resolved runtime settings.
 */
export function resolveConfig(config: DayflowConfig = {}): ResolvedConfig {
  const searchLimit = config.searchLimit ?? 50;
  if (!Number.isInteger(searchLimit) || searchLimit < 1 || searchLimit > MAX_SEARCH_LIMIT) {
    throw new DayflowError(
      `searchLimit must be a whole number from 1 to ${MAX_SEARCH_LIMIT} (received ${String(searchLimit)}).`,
      'invalid_input',
    );
  }

  const source = config.source?.trim() ?? (config.dayflow === undefined ? 'dayflow' : config.dayflow ? 'dayflow' : 'owned');
  if (source !== 'dayflow' && source !== 'owned') {
    throw new DayflowError(`source must be "dayflow" or "owned" (received ${String(source)}).`, 'invalid_input');
  }
  if (config.source !== undefined && config.dayflow !== undefined && config.dayflow !== (source === 'dayflow')) {
    throw new DayflowError('source and dayflow disagree; use one backend selector.', 'invalid_input');
  }

  const databasePath = resolveDatabasePath(config.databasePath);
  const journalPath = config.journalPath?.trim() || defaultJournalPath(dshHome());
  if (source === 'owned' && sameFile(databasePath, journalPath)) {
    throw new DayflowError('The owned journal must be a different file from the Dayflow database.', 'invalid_input');
  }

  // Each block is resolved field by field rather than spread, so an explicitly
  // invalid value fails here even when the caller bypassed the Config schema.
  const captureInput = config.capture ?? {};
  const analysisInput = config.analysis ?? {};
  const automationInput = config.automation ?? {};

  const capture: ResolvedCaptureConfig = {
    enabled: captureInput.enabled ?? false,
    intervalSeconds: resolveInteger(captureInput.intervalSeconds, 45, 5, 600, 'capture.intervalSeconds'),
    idleSeconds: resolveInteger(captureInput.idleSeconds, 120, 0, 3600, 'capture.idleSeconds'),
    maxFramesPerDay: resolveInteger(captureInput.maxFramesPerDay, 1200, 1, 10_000, 'capture.maxFramesPerDay'),
    keepFramesDays: resolveInteger(captureInput.keepFramesDays, 0, 0, 30, 'capture.keepFramesDays'),
    dedupeDistance: resolveInteger(captureInput.dedupeDistance, 4, 0, 16, 'capture.dedupeDistance'),
    retentionCheckMinutes: resolveInteger(
      captureInput.retentionCheckMinutes,
      60,
      5,
      1440,
      'capture.retentionCheckMinutes',
    ),
    pauseApps: resolvePauseApps(captureInput.pauseApps),
    displays: resolveChoice(captureInput.displays, CAPTURE_DISPLAYS, 'main', 'capture.displays'),
  };

  const analysis: ResolvedAnalysisConfig = {
    enabled: analysisInput.enabled ?? true,
    intervalMinutes: resolveInteger(analysisInput.intervalMinutes, 5, 1, 60, 'analysis.intervalMinutes'),
    consent: resolveChoice(analysisInput.consent, ANALYSIS_CONSENTS, 'none', 'analysis.consent'),
    localProviders: resolveStringList(analysisInput.localProviders, 'analysis.localProviders'),
    provider: analysisInput.provider?.trim() ?? '',
    model: analysisInput.model?.trim() ?? '',
    windowMinutes: resolveInteger(analysisInput.windowMinutes, 10, 1, 60, 'analysis.windowMinutes'),
    framesPerWindow: resolveInteger(analysisInput.framesPerWindow, 3, 1, 5, 'analysis.framesPerWindow'),
    maxCallsPerDay: resolveInteger(analysisInput.maxCallsPerDay, 120, 1, 1000, 'analysis.maxCallsPerDay'),
    dailyTokenBudget: resolveInteger(
      analysisInput.dailyTokenBudget,
      200_000,
      1000,
      2_000_000,
      'analysis.dailyTokenBudget',
    ),
  };

  const automation: ResolvedAutomationConfig = {
    enabled: automationInput.enabled ?? true,
    dailyAt: resolveDailyAt(automationInput.dailyAt),
    weeklyOn: resolveChoice(automationInput.weeklyOn, AUTOMATION_WEEKDAYS, 'monday', 'automation.weeklyOn'),
    catchUpOnStart: automationInput.catchUpOnStart ?? true,
    catchUpDays: resolveInteger(automationInput.catchUpDays, 2, 1, 30, 'automation.catchUpDays'),
  };

  return {
    databasePath,
    source,
    dayflow: source === 'dayflow',
    journalPath,
    agentSocket: config.agentSocket?.trim() ?? '',
    edits: config.edits ?? true,
    skills: config.skills ?? true,
    panel: config.panel ?? true,
    icons: config.icons ?? true,
    memoryContext: config.memoryContext ?? true,
    allowInstall: config.allowInstall ?? false,
    iconDirectory: iconDirectory(dshHome()),
    searchLimit,
    capture,
    analysis,
    automation,
  };
}

/**
 * The harness home that owns caches; `DSH_HOME` wins over the default.
 * @returns the home directory.
 */
export function dshHome(): string {
  const configured = process.env.DSH_HOME?.trim();
  if (configured !== undefined && configured !== '') return configured;
  return join(homedir(), '.dsh');
}
