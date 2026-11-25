/**
 * The long-task tool: goals that outlive a day, the sessions spent on them,
 * and the explainable matches a review uses to attach a day's work.
 *
 * Tasks live in the plugin-owned journal, like the review queue. A task the
 * user defined may be created here; a task the agent noticed must go through
 * `journal_review` as a `task_proposal` first, because only the user decides
 * that a goal exists.
 * @module dsh-plugin-dayflow/tools/task
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

import { DayflowError } from '../errors.js';
import { renderTask } from '../format.js';
import { withJournal, withJournalWrite } from '../journal.js';
import { activitiesForDay } from '../queries.js';
import {
  attachTaskSession,
  createLongTask,
  detachTaskSession,
  getLongTask,
  listLongTasks,
  suggestTaskMatches,
  updateLongTaskStatus,
} from '../tasks.js';
import type {
  AttachSessionInput,
  CreateLongTaskInput,
  LongTaskPayload,
  LongTaskStatus,
  TaskMatchCandidate,
} from '../tasks.js';
import type { ToolRuntime } from './shared.js';
import { dayArgument, jsonValue, readDatabase } from './shared.js';

/** The tool-facing value of one `journal_task` call. */
export interface TaskToolPayload {
  action: 'create' | 'list' | 'get' | 'update' | 'attach' | 'detach' | 'suggest';
  /** The single task of create, get, update, attach, and detach. */
  task?: LongTaskPayload;
  /** The list action's tasks, newest first, without sessions. */
  tasks?: LongTaskPayload[];
  /** The suggest action's explainable matches, best score first. */
  candidates?: TaskMatchCandidate[];
  /** The day the suggest action matched, as the Dayflow day key. */
  day?: string;
  hint: string;
}

/** Guidance after creating a task. */
const CREATE_HINT =
  'A task is the user\'s goal: attach each working session as it happens so its progress stays evidence-backed.';

/** Guidance after a list. */
const LIST_HINT =
  'Stalled tasks have gone more than seven days without a session; raise them in the weekly review instead of guessing.';

/** Guidance after reading one task. */
const GET_HINT =
  "Sessions are the evidence trail: read them before claiming progress or proposing the task's next step.";

/** Guidance after a status change. */
const UPDATE_HINT =
  'The status records a decision the user made; do not mark a task done or dropped on your own initiative.';

/** Guidance after attaching a session. */
const ATTACH_HINT =
  "Attaching the same day again replaces that day's session, so a correction never doubles the minutes.";

/** Guidance after detaching a session. */
const DETACH_HINT =
  "The day's minutes are removed from the task, but the activities stay in the day's timeline.";

/** Guidance after a suggestion pass, with or without candidates. */
const SUGGEST_HINT =
  'Matches are explainable, not guessed: category overlap scores 2, each shared app scores 1, and only a score of 2 or more is a candidate. Attach only the candidates the evidence supports.';

/** A missing required argument, phrased for the model. */
function invalidInput(message: string): DayflowError {
  return new DayflowError(message, 'invalid_input');
}

/** Read the required task id shared by the id-taking actions. */
function requiredId(id: number | undefined, action: string): number {
  if (id === undefined) {
    throw invalidInput(`${action} needs the id of a task; list returns the ids.`);
  }
  return id;
}

/** Read the required day shared by the session actions, refusing a blank one. */
function requiredDay(day: string | undefined, action: string): string {
  const trimmed = day?.trim();
  if (trimmed === undefined || trimmed === '') {
    throw invalidInput(`${action} needs a day as YYYY-MM-DD, the Dayflow day the work belongs to.`);
  }
  return trimmed;
}

/**
 * Build the long-task tool.
 * @param runtime - the plugin runtime.
 * @returns the tool definition, ready to register.
 */
export function taskTools(runtime: ToolRuntime): ToolDefinition[] {
  return [
    defineTool({
      name: 'journal_task',
      description:
        'Long tasks are goals that outlive a day ("port the recorder", "finish the paper"): the user defines ' +
        "them once, and the journal keeps a trail of the days spent on them. A session is one day's minutes plus " +
        'the activity record IDs that back them; attaching the same day again replaces that day rather than ' +
        'adding to it. An active task counts as stalled when it has had no session for more than seven days. ' +
        "suggest reads a day's activities and returns explainable matches — category overlap +2, each shared app " +
        '+1, threshold 2 — and writes nothing. Tasks the agent notices belong in journal_review as a ' +
        'task_proposal: the user accepts it and the task is created automatically, so do not create one in their ' +
        'place; use create only when the user asks for a task explicitly. Task rows live in the plugin-owned ' +
        "journal, separate from Dayflow's own data, and are not gated by Dayflow's edits switch.",
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: "'create' | 'list' | 'get' | 'update' | 'attach' | 'detach' | 'suggest'",
        },
        title: { type: 'string', description: 'create: the one-line goal the user defined, e.g. "Ship the plugin".' },
        description: { type: 'string', description: 'create: the short brief behind the task, if it needs one.' },
        target_date: { type: 'string', description: 'create: the day the user aims to finish it, YYYY-MM-DD.' },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'create: categories that count as work on the task; suggest matches on them.',
        },
        apps: {
          type: 'array',
          items: { type: 'string' },
          description: 'create: apps that count as work on the task; suggest matches on them.',
        },
        status: {
          type: 'string',
          description: "list: filter by 'active' | 'paused' | 'done' | 'dropped'. update: the new status.",
        },
        id: { type: 'integer', description: 'get/update/attach/detach: the task id from list.' },
        day: {
          type: 'string',
          description: 'attach/detach/suggest: the Dayflow day as YYYY-MM-DD, the day the work belongs to.',
        },
        minutes: { type: 'integer', description: 'attach: minutes spent on the task that day.' },
        note: { type: 'string', description: 'attach: a short note on what advanced that day.' },
        activity_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: 'attach: record IDs from dayflow_timeline that back the session.',
        },
        limit: { type: 'integer', description: 'list: maximum rows, 1..200. Defaults to 50.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          { type: 'text', text: renderTask(value as unknown as TaskToolPayload) },
        ],
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        switch (args.action) {
          case 'create': {
            const title = args.title?.trim();
            if (title === undefined || title === '') {
              throw invalidInput('create needs a title: the one-line goal the user defined.');
            }
            const input: CreateLongTaskInput = {
              title,
              ...(args.description === undefined ? {} : { description: args.description }),
              ...(args.target_date === undefined ? {} : { target_date: args.target_date }),
              ...(args.categories === undefined ? {} : { categories: args.categories }),
              ...(args.apps === undefined ? {} : { apps: args.apps }),
            };
            const task = withJournalWrite(runtime.config.journalPath, (db) => createLongTask(db, input));
            const payload: TaskToolPayload = { action: 'create', task, hint: CREATE_HINT };
            return jsonValue(payload);
          }

          case 'list': {
            const filter: { status?: LongTaskStatus; limit?: number } = {};
            if (args.status !== undefined) filter.status = args.status as LongTaskStatus;
            if (args.limit !== undefined) filter.limit = args.limit;
            const tasks = withJournal(runtime.config.journalPath, (db) => listLongTasks(db, filter));
            const payload: TaskToolPayload = { action: 'list', tasks, hint: LIST_HINT };
            return jsonValue(payload);
          }

          case 'get': {
            const id = requiredId(args.id, 'get');
            const task = withJournal(runtime.config.journalPath, (db) => getLongTask(db, id));
            const payload: TaskToolPayload = { action: 'get', task, hint: GET_HINT };
            return jsonValue(payload);
          }

          case 'update': {
            const id = requiredId(args.id, 'update');
            const status = args.status?.trim();
            if (status === undefined || status === '') {
              throw invalidInput(
                "update needs a status: 'active' | 'paused' | 'done' | 'dropped'.",
              );
            }
            const task = withJournalWrite(runtime.config.journalPath, (db) =>
              updateLongTaskStatus(db, id, status as LongTaskStatus),
            );
            const payload: TaskToolPayload = { action: 'update', task, hint: UPDATE_HINT };
            return jsonValue(payload);
          }

          case 'attach': {
            const id = requiredId(args.id, 'attach');
            const day = requiredDay(args.day, 'attach');
            if (args.minutes === undefined) {
              throw invalidInput('attach needs minutes: how long the user worked on the task that day.');
            }
            const input: AttachSessionInput = {
              day,
              minutes: args.minutes,
              ...(args.note === undefined ? {} : { note: args.note }),
              ...(args.activity_ids === undefined ? {} : { activity_ids: args.activity_ids }),
            };
            const task = withJournalWrite(runtime.config.journalPath, (db) =>
              attachTaskSession(db, id, input),
            );
            const payload: TaskToolPayload = { action: 'attach', task, hint: ATTACH_HINT };
            return jsonValue(payload);
          }

          case 'detach': {
            const id = requiredId(args.id, 'detach');
            const day = requiredDay(args.day, 'detach');
            const task = withJournalWrite(runtime.config.journalPath, (db) =>
              detachTaskSession(db, id, day),
            );
            const payload: TaskToolPayload = { action: 'detach', task, hint: DETACH_HINT };
            return jsonValue(payload);
          }

          case 'suggest': {
            const day = requiredDay(args.day, 'suggest');
            const window = dayArgument(day);
            const activities = readDatabase(runtime, (db) => activitiesForDay(db, window));
            const candidates = withJournal(runtime.config.journalPath, (db) =>
              suggestTaskMatches(
                db,
                window.dayKey,
                activities.map((activity) => ({
                  recordId: activity.recordId,
                  category: activity.category,
                  apps: activity.apps,
                })),
              ),
            );
            const payload: TaskToolPayload = {
              action: 'suggest',
              day: window.dayKey,
              candidates,
              hint: SUGGEST_HINT,
            };
            return jsonValue(payload);
          }

          default:
            throw invalidInput(
              `Unknown action "${args.action}": use create, list, get, update, attach, detach, or suggest.`,
            );
        }
      },
      presentCall: (args) => {
        switch (args.action) {
          case 'list':
            return {
              card: 'generic' as const,
              kind: 'read' as const,
              title: `Long tasks${args.status === undefined ? '' : ` · ${args.status}`}`,
            };
          case 'get':
            return {
              card: 'generic' as const,
              kind: 'read' as const,
              title: `Task #${args.id ?? '?'}`,
            };
          case 'suggest':
            return {
              card: 'generic' as const,
              kind: 'read' as const,
              title: `Task matches · ${args.day ?? '?'}`,
            };
          case 'create':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Create task${args.title === undefined ? '' : ` · ${args.title}`}`,
            };
          case 'update':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Update task #${args.id ?? '?'}${args.status === undefined ? '' : ` · ${args.status}`}`,
            };
          case 'attach':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Attach session to task #${args.id ?? '?'}${args.day === undefined ? '' : ` · ${args.day}`}`,
            };
          case 'detach':
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Detach session from task #${args.id ?? '?'}${args.day === undefined ? '' : ` · ${args.day}`}`,
            };
          default:
            return {
              card: 'generic' as const,
              kind: 'edit' as const,
              title: `Long tasks · ${args.action}`,
            };
        }
      },
    }),
  ];
}
