/**
 * Import the Dayflow database into the plugin-owned journal.
 *
 * The source is always opened read-only. Importing the same source more than once
 * is safe: the owned store records source table/row IDs and only inserts new
 * rows on a later run.
 * @module dsh-plugin-dayflow/tools/import
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

import { DayflowError } from '../errors.js';
import { importDayflowDatabase } from '../journal.js';
import type { ImportReport } from '../journal.js';
import { renderImport } from '../format.js';
import type { ToolRuntime } from './shared.js';
import { jsonValue } from './shared.js';

/** Build the journal import tool. */
export function journalImportTools(runtime: ToolRuntime): ToolDefinition[] {
  return [
    defineTool({
      name: 'journal_import',
      description:
        'Import a Dayflow database into the plugin-owned journal. The source is opened read-only, the import is ' +
        'additive and idempotent, and the result reports imported, unchanged, and deliberately skipped tables. ' +
        'After importing, set source: owned (or dayflow: false) to read the owned journal without Dayflow installed.',
      parameters: {
        source_path: {
          type: 'string',
          description: 'Absolute path to a Dayflow chunks.sqlite. Omit to use the configured databasePath.',
        },
        source_id: {
          type: 'string',
          description: 'Optional stable source label when importing more than one Dayflow database.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderImport(value as unknown as ImportReport) }],
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        const source = args.source_path?.trim() || runtime.config.databasePath;
        if (source === runtime.config.journalPath) {
          throw new DayflowError('source_path must point to a Dayflow database, not the owned journal.', 'invalid_input');
        }
        return jsonValue(
          importDayflowDatabase({
            sourcePath: source,
            journalPath: runtime.config.journalPath,
            sourceId: args.source_id?.trim() || undefined,
            categories: runtime.preferences().categories,
          }),
        );
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'execute',
        title: `Import Dayflow${args.source_path === undefined ? '' : ` · ${args.source_path}`}`,
      }),
    }),
  ];
}
