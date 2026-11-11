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
   * Register the tool that installs Dayflow itself. Off by default: it changes
   * the user's machine, so it must be an explicit deployment choice.
   */
  allowInstall?: boolean;
  /** Maximum matches a search returns. */
  searchLimit?: number;
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
  readonly allowInstall: boolean;
  readonly iconDirectory: string;
  readonly searchLimit: number;
}

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
  skills: z.boolean().default(true).description('Register the bundled Dayflow, standup, and weekly-review skills.'),
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
  searchLimit: z.number().default(50).description('Maximum number of search matches a single call returns (1-200).'),
});

const MAX_SEARCH_LIMIT = 200;

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
    allowInstall: config.allowInstall ?? false,
    iconDirectory: iconDirectory(dshHome()),
    searchLimit,
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
