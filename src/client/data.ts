/**
 * Browser-side reads of the host's panel routes.
 *
 * Every route sits behind the same `/api` trust fence and session cookie as the
 * rest of the client, so a same-origin fetch with credentials is enough.
 * @module dsh-plugin-dayflow/client/data
 */

import {
  PANEL_ANALYSIS_STATUS_PATH,
  PANEL_CAPTURE_PAUSE_PATH,
  PANEL_CAPTURE_STATUS_PATH,
  PANEL_CONFIG_PATH,
  PANEL_DAY_PATH,
  PANEL_INSIGHTS_PATH,
  PANEL_MEMORY_ADD_PATH,
  PANEL_MONTH_PATH,
  PANEL_REFLECTION_ADD_PATH,
  PANEL_TASK_ADD_PATH,
  PANEL_TASK_LINK_PATH,
  PANEL_TASK_SCAN_PATH,
  PANEL_WEEK_PATH,
} from '../panel-contract.js';
import type {
  PanelAnalysisStatus,
  PanelCaptureStatusResponse,
  PanelConfig,
  PanelDay,
  PanelError,
  PanelInsights,
  PanelMemoryAddResponse,
  PanelMonth,
  PanelReflectionAddResponse,
  PanelTaskAddResponse,
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
