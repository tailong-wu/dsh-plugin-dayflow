/**
 * Browser-side reads of the host's panel routes.
 *
 * Both routes sit behind the same `/api` trust fence and session cookie as the
 * rest of the client, so a same-origin fetch with credentials is enough.
 * @module dsh-plugin-dayflow/client/data
 */

import {
  PANEL_CONFIG_PATH,
  PANEL_DAY_PATH,
  PANEL_INSIGHTS_PATH,
  PANEL_MONTH_PATH,
  PANEL_WEEK_PATH,
} from '../panel-contract.js';
import type {
  PanelConfig,
  PanelDay,
  PanelError,
  PanelInsights,
  PanelMonth,
  PanelWeek,
} from '../panel-contract.js';

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
