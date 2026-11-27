/**
 * Browser-side reads of the host's panel routes.
 *
 * Every route sits behind the same `/api` trust fence and session cookie as the
 * rest of the client, so a same-origin fetch with credentials is enough.
 * @module dsh-plugin-dayflow/client/data
 */

import {
  PANEL_ANALYSIS_STATUS_PATH,
  PANEL_AUTOMATION_STATUS_PATH,
  PANEL_CAPTURE_PAUSE_PATH,
  PANEL_CAPTURE_STATUS_PATH,
  PANEL_CONFIG_PATH,
  PANEL_DAY_PATH,
  PANEL_INSIGHTS_PATH,
  PANEL_MEMORY_ADD_PATH,
  PANEL_MONTH_PATH,
  PANEL_REFLECTION_ADD_PATH,
  PANEL_REVIEW_DECIDE_PATH,
  PANEL_TASK_ADD_PATH,
  PANEL_TASK_ATTACH_PATH,
  PANEL_TASK_DETACH_PATH,
  PANEL_TASK_LINK_PATH,
  PANEL_TASK_SCAN_PATH,
  PANEL_WEEK_PATH,
} from '../panel-contract.js';
import type {
  PanelAnalysisStatus,
  PanelAutomationStatusResponse,
  PanelCaptureStatusResponse,
  PanelConfig,
  PanelDay,
  PanelError,
  PanelInsights,
  PanelMemoryAddResponse,
  PanelMonth,
  PanelReflectionAddResponse,
  PanelReviewDecisionRequest,
  PanelReviewDecisionResponse,
  PanelTaskAddResponse,
  PanelTaskAttachRequest,
  PanelTaskAttachResponse,
  PanelTaskDetachRequest,
  PanelTaskDetachResponse,
  PanelTaskLinkRequest,
  PanelTaskLinkResponse,
  PanelTaskScanRequest,
  PanelTaskScanResponse,
  PanelWeek,
} from '../panel-contract.js';

/**
 * The analysis worker's status line's data, as the host reports it.
 *
 * The contract module names the wire shape once, beside its builder; this alias
 * keeps the client's own imports free of the host-side analysis modules, which
 * no browser bundle may pull in.
 */
export type AnalysisStatusSummary = PanelAnalysisStatus['analysis'];

/** Answer to an analysis status read. */
export type AnalysisStatusResponse = PanelAnalysisStatus;

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Partial<PanelError>;
    if (typeof body.error === 'string' && body.error !== '') return body.error;
  } catch {
    // Fall through to the status line.
  }
  return `Dayflow request failed (${response.status}).`;
}

/**
 * Read whether the panel is enabled for this profile.
 * @param signal - caller cancellation.
 * @returns the host's answer.
 */
export async function fetchPanelConfig(signal?: AbortSignal): Promise<PanelConfig> {
  const response = await fetch(PANEL_CONFIG_PATH, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as PanelConfig;
}

/**
 * Read one day of the timeline.
 * @param date - `YYYY-MM-DD`, or `undefined` for the current Dayflow day.
 * @param signal - caller cancellation.
 * @returns the day payload.
 */
export async function fetchDay(date?: string, signal?: AbortSignal): Promise<PanelDay> {
  const query = date === undefined || date === '' ? '' : `?date=${encodeURIComponent(date)}`;
  const response = await fetch(`${PANEL_DAY_PATH}${query}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as PanelDay;
}

/**
 * Read one month of days.
 * @param month - `YYYY-MM`, or `undefined` for the current month.
 * @param signal - caller cancellation.
 * @returns the month payload.
 */
export async function fetchMonth(month?: string, signal?: AbortSignal): Promise<PanelMonth> {
  const query = month === undefined || month === '' ? '' : `?month=${encodeURIComponent(month)}`;
  const response = await fetch(`${PANEL_MONTH_PATH}${query}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as PanelMonth;
}

/**
 * Read one Monday-anchored week of days.
 * @param date - any day inside the week, or `undefined` for the current week.
 * @param signal - caller cancellation.
 * @returns the week payload.
 */
export async function fetchWeek(date?: string, signal?: AbortSignal): Promise<PanelWeek> {
  const query = date === undefined || date === '' ? '' : `?date=${encodeURIComponent(date)}`;
  const response = await fetch(`${PANEL_WEEK_PATH}${query}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as PanelWeek;
}

/**
 * Read the journal's insights: long tasks, the review queue, dated memory
 * claims, and saved reflections.
 *
 * The host answers all four lists in one response, so the Insights tab never
 * flashes four independently-loading sections.
 * @param signal - caller cancellation.
 * @returns the insights payload.
 */
export async function fetchInsights(signal?: AbortSignal): Promise<PanelInsights> {
  const response = await fetch(PANEL_INSIGHTS_PATH, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as PanelInsights;
}

/**
 * Send one JSON body to a panel write route.
 * @param path - the exact route.
 * @param payload - the JSON body.
 * @param signal - caller cancellation.
 * @returns the parsed answer.
 */
async function postJson<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

/**
 * Read the native capture status line's data.
 *
 * The profile switches, the macOS permission, and the persisted pause flag all
 * come back in one answer, so the line renders from one read instead of three.
 * @param signal - caller cancellation.
 * @returns the capture status.
 */
export async function fetchCaptureStatus(signal?: AbortSignal): Promise<PanelCaptureStatusResponse> {
  const response = await fetch(PANEL_CAPTURE_STATUS_PATH, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as PanelCaptureStatusResponse;
}

/**
 * Read the analysis worker's status line's data.
 *
 * The enablement, the consent decision, the worker state, today's job counts,
 * and the call/token budget all come back in one answer, so the line renders
 * from one read instead of several.
 * @param signal - caller cancellation.
 * @returns the analysis status.
 */
export async function fetchAnalysisStatus(signal?: AbortSignal): Promise<AnalysisStatusResponse> {
  const response = await fetch(PANEL_ANALYSIS_STATUS_PATH, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as AnalysisStatusResponse;
}

/**
 * Read the scheduled day/week close's status line's data.
 *
 * The schedule, the catch-up window, whether a close is running now, and the
 * last stored close of each all come back in one answer, so the line renders
 * from one read instead of several.
 * @param signal - caller cancellation.
 * @returns the automation status.
 */
export async function fetchAutomationStatus(signal?: AbortSignal): Promise<PanelAutomationStatusResponse> {
  const response = await fetch(PANEL_AUTOMATION_STATUS_PATH, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as PanelAutomationStatusResponse;
}

/**
 * Pause or resume native capture and read the status that resulted.
 * @param paused - whether capture should be paused.
 * @param signal - caller cancellation.
 * @returns the status after the write.
 */
export async function setCapturePaused(
  paused: boolean,
  signal?: AbortSignal,
): Promise<PanelCaptureStatusResponse> {
  return postJson<PanelCaptureStatusResponse>(PANEL_CAPTURE_PAUSE_PATH, { paused }, signal);
}

/**
 * Add one long task to the owned journal.
 * @param title - the task title; the host trims and bounds it.
 * @param signal - caller cancellation.
 * @returns the new task's summary.
 */
export async function addTask(title: string, signal?: AbortSignal): Promise<PanelTaskAddResponse> {
  return postJson<PanelTaskAddResponse>(PANEL_TASK_ADD_PATH, { title }, signal);
}

/**
 * Remember one dated preference claim about how the user works.
 * @param text - the claim; the host dates it to the current Dayflow day.
 * @param signal - caller cancellation.
 * @returns the new claim's summary.
 */
export async function addMemory(text: string, signal?: AbortSignal): Promise<PanelMemoryAddResponse> {
  return postJson<PanelMemoryAddResponse>(PANEL_MEMORY_ADD_PATH, { text }, signal);
}

/**
 * Append one line to today's saved day reflection.
 * @param text - the line to append.
 * @param signal - caller cancellation.
 * @returns the saved reflection.
 */
export async function addReflection(text: string, signal?: AbortSignal): Promise<PanelReflectionAddResponse> {
  return postJson<PanelReflectionAddResponse>(PANEL_REFLECTION_ADD_PATH, { text }, signal);
}

/**
 * Scan the recent history for activity that looks like a task's work.
 *
 * The answer is a read-only preview: the host reads the active backend's
 * activity but attaches nothing until {@link linkTaskHistory} is called.
 * @param taskId - the task to scan for.
 * @param days - how many recent Dayflow days to cover; omitted means the host's 14.
 * @param signal - caller cancellation.
 * @returns the matching days, newest first.
 */
export async function scanTaskHistory(
  taskId: number,
  days?: number,
  signal?: AbortSignal,
): Promise<PanelTaskScanResponse> {
  const payload: PanelTaskScanRequest = days === undefined ? { task_id: taskId } : { task_id: taskId, days };
  return postJson<PanelTaskScanResponse>(PANEL_TASK_SCAN_PATH, payload, signal);
}

/**
 * Attach confirmed history days to a task as its sessions.
 *
 * Linking the same day again replaces that day's minutes instead of doubling
 * them, so a retried link is safe.
 * @param taskId - the task to attach the days to.
 * @param days - the confirmed days from a scan preview.
 * @param signal - caller cancellation.
 * @returns the updated task and the days now attached.
 */
export async function linkTaskHistory(
  taskId: number,
  days: PanelTaskLinkRequest['days'],
  signal?: AbortSignal,
): Promise<PanelTaskLinkResponse> {
  return postJson<PanelTaskLinkResponse>(PANEL_TASK_LINK_PATH, { task_id: taskId, days }, signal);
}

/** One decision the insights view can send for a still-open review item. */
export type ReviewDecision = 'keep' | 'accept' | 'discard' | 'reject';

/**
 * Apply the user's decision to one review item.
 *
 * The panel is the user's own surface, so every write carries `confirm: true`;
 * the host refuses a decision without it. A negative decision with
 * `forever: true` hard-suppresses the item's fingerprint so the agent never
 * proposes it again, while a plain discard only soft-suppresses it.
 * @param id - the review item's id.
 * @param decision - keep/accept for the forward path, discard/reject to drop it.
 * @param options - the optional decision note and the permanent-suppression flag.
 * @param signal - caller cancellation.
 * @returns the decided item, plus the task or memory the decision produced.
 */
export async function postReviewDecision(
  id: number,
  decision: ReviewDecision,
  options?: { note?: string; forever?: boolean },
  signal?: AbortSignal,
): Promise<PanelReviewDecisionResponse> {
  const payload: PanelReviewDecisionRequest = { id, decision, confirm: true };
  if (options?.note !== undefined) payload.note = options.note;
  if (options?.forever !== undefined) payload.forever = options.forever;
  return postJson<PanelReviewDecisionResponse>(PANEL_REVIEW_DECIDE_PATH, payload, signal);
}

/**
 * Attach one day of work to a long task.
 *
 * Attaching the same `(task, day)` again replaces that day's minutes instead of
 * doubling them, so the write is safe to retry. The panel keeps no attach form
 * of its own: the history scan's Link button is the only attach entry point.
 * @param id - the task's id.
 * @param day - the Dayflow day key (`YYYY-MM-DD`) to attach.
 * @param minutes - the day's minutes from the scan preview.
 * @param options - the optional note and the matched activity ids.
 * @param signal - caller cancellation.
 * @returns the updated task, with its full session list.
 */
export async function postTaskAttach(
  id: number,
  day: string,
  minutes: number,
  options?: { note?: string; activity_ids?: number[] },
  signal?: AbortSignal,
): Promise<PanelTaskAttachResponse> {
  const payload: PanelTaskAttachRequest = { id, day, minutes, confirm: true };
  if (options?.note !== undefined) payload.note = options.note;
  if (options?.activity_ids !== undefined) payload.activity_ids = options.activity_ids;
  return postJson<PanelTaskAttachResponse>(PANEL_TASK_ATTACH_PATH, payload, signal);
}

/**
 * Remove one day from a long task's progress.
 *
 * Detaching a day that was never attached is a no-op that still answers with the
 * current task, so a stale row can always be repaired.
 * @param id - the task's id.
 * @param day - the day to detach.
 * @param signal - caller cancellation.
 * @returns the updated task, with the day gone from its sessions.
 */
export async function postTaskDetach(
  id: number,
  day: string,
  signal?: AbortSignal,
): Promise<PanelTaskDetachResponse> {
  const payload: PanelTaskDetachRequest = { id, day, confirm: true };
  return postJson<PanelTaskDetachResponse>(PANEL_TASK_DETACH_PATH, payload, signal);
}
