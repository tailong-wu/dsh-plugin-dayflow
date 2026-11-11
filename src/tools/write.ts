/**
 * The six editing tools.
 *
 * Every edit travels to the running Dayflow app over its Unix-domain socket,
 * because the app owns the category store and must refresh its UI. The tools
 * are registered here; whether a call is allowed is decided per call from the
 * app's own "Allow edits" switch, so the answer is never stale.
 * @module dsh-plugin-dayflow/tools/write
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

import { sendBridgeOperation } from '../bridge.js';
import { DayflowError } from '../errors.js';
import { renderWrite } from '../format.js';
import { compactArgs, jsonValue } from './shared.js';
import type { ToolRuntime } from './shared.js';
import { DATE_DESCRIPTION } from './shared.js';

/**
 * Send one edit, refusing when the user has not enabled edits in Dayflow.
 * @param runtime - the plugin runtime.
 * @param operation - bridge operation name.
 * @param args - operation arguments.
 * @param signal - caller cancellation.
 * @returns the app's response payload as a JSON value.
 */
async function sendEdit(
  runtime: ToolRuntime,
  operation: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ReturnType<typeof jsonValue>> {
  if (!runtime.config.dayflow) {
    throw new DayflowError(
      'Editing the owned journal is not part of this release. Use journal_import to add Dayflow data, or select source: dayflow for app edits.',
      'invalid_input',
    );
  }
  if (!runtime.preferences().editsEnabled) {
    throw new DayflowError(
      'Editing is off. Turn on "Allow edits" in Dayflow → Settings → AI Tools, then try again.',
      'edits_disabled',
    );
  }
  const data = await sendBridgeOperation(operation, compactArgs(args), {
    socketPath: runtime.config.agentSocket,
    signal,
  });
  return jsonValue(data);
}

const EDITS_HINT = 'Requires "Allow edits" in Dayflow → Settings → AI Tools and the Dayflow app running.';

/**
 * Build the editing tool set for one plugin instance.
 * @param runtime - the plugin runtime.
 * @returns the tool definitions, ready to register.
 */
export function writeTools(runtime: ToolRuntime): ToolDefinition[] {
  return [
    defineTool({
      name: 'dayflow_update_activity',
      description:
        `Change one activity's title or category by record ID. ${EDITS_HINT}`,
      parameters: {
        record_id: { type: 'integer', required: true, description: 'Activity ID from dayflow_timeline.' },
        title: { type: 'string', description: 'New title. Omit to keep the current one.' },
        category: { type: 'string', description: 'New category name. Omit to keep the current one.' },
      },
      output: {
        schema: { type: 'json' },
        render: (args, value) =>
          [{ type: 'text', text: renderWrite(`Updated activity #${args.record_id}`, value as Record<string, unknown>) }],
      },
      async execute(args, exec) {
        return sendEdit(
          runtime,
          'activity_update',
          { record_id: args.record_id, title: args.title, category: args.category },
          exec.signal,
        );
      },
      presentCall: (args) => ({ card: 'generic', kind: 'edit', title: `Update Dayflow activity #${args.record_id}` }),
    }),

    defineTool({
      name: 'dayflow_delete_activity',
      description:
        'Delete one activity. This also removes its underlying observations and cannot be fully undone. ' +
        `Destructive: confirm with the user before calling. ${EDITS_HINT}`,
      parameters: {
        record_id: { type: 'integer', required: true, description: 'Activity ID from dayflow_timeline.' },
      },
      output: {
        schema: { type: 'json' },
        render: (args, value) =>
          [{ type: 'text', text: renderWrite(`Deleted activity #${args.record_id}`, value as Record<string, unknown>) }],
      },
      async execute(args, exec) {
        return sendEdit(runtime, 'activity_delete', { record_id: args.record_id }, exec.signal);
      },
      presentCall: (args) => ({ card: 'generic', kind: 'delete', title: `Delete Dayflow activity #${args.record_id}` }),
    }),

    defineTool({
      name: 'dayflow_create_category',
      description: 'Create a timeline category with a name and hex color. ' + EDITS_HINT,
      parameters: {
        name: { type: 'string', required: true, description: 'New category name.' },
        color: { type: 'string', description: 'Hex color such as #F96E00. Optional.' },
        description: { type: 'string', description: 'What belongs in this category; Dayflow uses it when classifying.' },
      },
      output: {
        schema: { type: 'json' },
        render: (args, value) =>
          [{ type: 'text', text: renderWrite(`Created category "${args.name}"`, value as Record<string, unknown>) }],
      },
      async execute(args, exec) {
        return sendEdit(
          runtime,
          'category_add',
          { name: args.name, color: args.color, description: args.description },
          exec.signal,
        );
      },
      presentCall: (args) => ({ card: 'generic', kind: 'edit', title: `Create Dayflow category "${args.name}"` }),
    }),

    defineTool({
      name: 'dayflow_update_category',
      description:
        'Rename a category, change its color, or change its description. Past activities keep their original label ' +
        `on rename. ${EDITS_HINT}`,
      parameters: {
        name: { type: 'string', required: true, description: 'Current category name.' },
        new_name: { type: 'string', description: 'New name. Omit to keep it.' },
        color: { type: 'string', description: 'New hex color. Omit to keep it.' },
        description: { type: 'string', description: 'New classifier description. Omit to keep it.' },
      },
      output: {
        schema: { type: 'json' },
        render: (args, value) =>
          [{ type: 'text', text: renderWrite(`Updated category "${args.name}"`, value as Record<string, unknown>) }],
      },
      async execute(args, exec) {
        return sendEdit(
          runtime,
          'category_update',
          { name: args.name, new_name: args.new_name, color: args.color, description: args.description },
          exec.signal,
        );
      },
      presentCall: (args) => ({ card: 'generic', kind: 'edit', title: `Update Dayflow category "${args.name}"` }),
    }),

    defineTool({
      name: 'dayflow_delete_category',
      description:
        'Delete a category. Past activities keep the label but lose its color and filters. ' +
        `Destructive: confirm with the user before calling. ${EDITS_HINT}`,
      parameters: {
        name: { type: 'string', required: true, description: 'Category name to delete.' },
      },
      output: {
        schema: { type: 'json' },
        render: (args, value) =>
          [{ type: 'text', text: renderWrite(`Deleted category "${args.name}"`, value as Record<string, unknown>) }],
      },
      async execute(args, exec) {
        return sendEdit(runtime, 'category_remove', { name: args.name }, exec.signal);
      },
      presentCall: (args) => ({ card: 'generic', kind: 'delete', title: `Delete Dayflow category "${args.name}"` }),
    }),

    defineTool({
      name: 'dayflow_set_goal',
      description:
        'Set or replace a day\'s focus target and distraction limit, with optional focus and distraction category ' +
        `lists. ${EDITS_HINT}`,
      parameters: {
        date: { type: 'string', description: DATE_DESCRIPTION },
        focus_minutes: { type: 'integer', required: true, description: 'Target focused minutes for the day.' },
        distraction_limit_minutes: { type: 'integer', description: 'Distraction budget in minutes. Optional.' },
        focus_categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Category names that count as focus. Optional.',
        },
        distraction_categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Category names that count as distraction. Optional.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) =>
          [{ type: 'text', text: renderWrite('Saved the day goal', value as Record<string, unknown>) }],
      },
      async execute(args, exec) {
        return sendEdit(
          runtime,
          'goal_set',
          {
            date: args.date,
            focus_minutes: args.focus_minutes,
            distraction_limit_minutes: args.distraction_limit_minutes,
            focus_categories: args.focus_categories,
            distraction_categories: args.distraction_categories,
          },
          exec.signal,
        );
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: `Set Dayflow day goal · ${args.date ?? 'today'}`,
      }),
    }),
  ];
}
