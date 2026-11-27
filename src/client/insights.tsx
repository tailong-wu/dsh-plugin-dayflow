/**
 * The insights view: the journal's long tasks, review queue, memory claims, and
 * reflections on one page, shown inside the single Dayflow panel.
 *
 * The host answers all four lists in one response, so the view has a single
 * load state and a single refresh: no section can be stale while another is
 * fresh. Every section is still optional — an empty journal shows one quiet
 * empty state instead of four.
 *
 * A compact capture line above the sections shows the native capture switches,
 * the macOS Screen Recording permission, today's frame count, and the persisted
 * pause flag. Phase 0 has no recorder yet, so the line reports the configured
 * state instead of implying that frames are being written.
 *
 * Under it, a second read-only line reports the analysis worker: whether
 * analysis is enabled, what the consent gate is still waiting for, whether the
 * worker runs or idles, today's failures, and the call/token budget it spends.
 * It is deliberately not a control surface — analysis is switched on in the
 * profile, and the panel keeps its one entry point and no new buttons.
 *
 * A third, slimmer line under it reports the scheduled day/week close: the day
 * boundary time, the last stored day close and its status, the weekday the week
 * closes, and how many missed days a catch-up may close. Like the analysis line
 * it is read-only and carries no control; a failed or missing status degrades to
 * the quiet off tone instead of adding an error to a loaded journal.
 *
 * Tasks, memory claims, and today's reflection can also be added from the view
 * itself: a ToDo-style row at the bottom of each of those three sections writes
 * the owned journal directly and refreshes the page on success. Adding a task
 * then offers an optional history scan: the panel previews the recent days whose
 * activity matches the task and links only the days the user confirms, so the
 * create flow stays one step while the evidence stays the user's call.
 *
 * The review queue is the one surface where the user decides: every agent
 * proposal carries its kind's forward decision (Keep for a distillation or a
 * loop, Accept for an improvement or a task proposal), a plain discard, and a
 * restrained "don't suggest again" that asks for one inline confirmation before
 * hard-suppressing the item. A long task's linked days each carry an Unlink,
 * so a mis-scanned day can be detached without opening a second view; attaching
 * still happens only through the history scan's own Link button.
 * @module dsh-plugin-dayflow/client/insights
 */

import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import type {
  PanelAutomationStatus,
  PanelCaptureStatus,
  PanelInsights,
  PanelReviewItem,
  PanelTaskScanResponse,
  PanelTaskSummary,
} from '../panel-contract.js';
import type { AnalysisStatusSummary, ReviewDecision } from './data.js';
import {
  addMemory,
  addReflection,
  addTask,
  fetchAnalysisStatus,
  fetchAutomationStatus,
  fetchCaptureStatus,
  linkTaskHistory,
  postReviewDecision,
  postTaskDetach,
  scanTaskHistory,
  setCapturePaused,
} from './data.js';
import { formatClock, formatDuration, formatShare, panelLanguage, shortDate, weekdayLabels } from './format.js';
import type { Translate } from './format.js';
import type { Phase } from './types.js';

const REFRESH_GLYPH = (
  <path
    d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

/** Longest reflection line the list shows before shortening it. */
const REFLECTION_PREVIEW_CHARS = 140;

/** How many recent days the panel offers to scan after a task is added. */
const SCAN_DAY_COUNT = 14;

/** How many matching days the preview lists before it counts the rest. */
const SCAN_PREVIEW_ROWS = 5;

/** What the capture line shows when the host does not answer: capture off. */
const OFF_CAPTURE_STATUS: PanelCaptureStatus = {
  enabled: false,
  paused: false,
  permission: 'unknown',
  analysis_enabled: false,
  analysis_consent: 'none',
  frames_today: 0,
};

/**
 * What the analysis line shows when the host does not answer: analysis off.
 *
 * The budget fields are the shipped defaults, so a host that predates the
 * status route still renders the same quiet "off" line instead of a blank.
 */
const OFF_ANALYSIS_STATUS: AnalysisStatusSummary = {
  enabled: false,
  consent: 'none',
  intervalMinutes: 5,
  worker: 'stopped',
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  callsToday: 0,
  maxCallsPerDay: 120,
  tokensToday: { input: 0, output: 0 },
  dailyTokenBudget: 200_000,
};

/**
 * What the close line shows when the host does not answer: automation off.
 *
 * A host without the route, or a failed read, still renders the same quiet grey
 * line the rest of the view uses, with no error text; the schedule fields are
 * the shipped defaults so the copy stays coherent.
 */
const OFF_AUTOMATION_STATUS: PanelAutomationStatus = {
  enabled: false,
  running: false,
  dailyAt: '04:00',
  weeklyOn: 'monday',
  catchUpDays: 2,
};

/** Where the optional history scan of a just-added task stands. */
type CaptureStage = 'ask' | 'scanning' | 'result' | 'linking';

/** The just-added task, the scan's preview, and the step the card is on. */
interface CaptureState {
  task: PanelTaskSummary;
  stage: CaptureStage;
  scan?: PanelTaskScanResponse['scan'];
  error?: string;
}

/** Props the panel body passes to the insights view. */
export interface InsightsPanelProps {
  /** Reads the journal's insights from the host. */
  loadInsights: (signal?: AbortSignal) => Promise<PanelInsights>;
  /** Namespace-bound translation. */
  t: Translate;
}

function rawMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Make a transport failure readable without hiding a server message.
 * @param message - the raw failure message.
 * @param t - the bound translator.
 * @returns the message to show.
 */
function humanize(message: string, t: Translate): string {
  return /fetch|network|load failed/i.test(message) ? t('network') : message;
}

/**
 * Make a failed add readable in the row that raised it, without a dialog.
 * @param cause - the rejected write.
 * @param t - the bound translator.
 * @returns the message the row shows.
 */
function addFailureMessage(cause: unknown, t: Translate): string {
  const message = rawMessage(cause).trim();
  if (message === '') return t('addItemFailed');
  return humanize(message, t);
}

/**
 * Make a failed decision or unlink readable in the row that raised it.
 *
 * The row keeps its buttons, so the message names the action and then the
 * transport or server detail; an empty failure falls back to the action copy
 * rather than an empty line.
 * @param cause - the rejected write.
 * @param action - the localized action that failed.
 * @param t - the bound translator.
 * @returns the message the row shows.
 */
function actionFailureMessage(cause: unknown, action: string, t: Translate): string {
  const detail = humanize(rawMessage(cause).trim(), t);
  return detail === '' ? action : `${action} · ${detail}`;
}

/**
 * The two decisions a review item's kind allows.
 *
 * The store decides distillations and loops with keep/discard and improvements
 * and task proposals with accept/reject; the panel's forward button is the
 * positive one, and both the plain discard and the permanent "don't suggest
 * again" use the negative one.
 * @param kind - the review item's kind.
 * @returns the positive and the negative decision for that kind.
 */
function reviewDecisions(kind: string): { forward: ReviewDecision; negative: ReviewDecision; forwardLabel: 'keep' | 'accept' } {
  return kind === 'distillation' || kind === 'loop'
    ? { forward: 'keep', negative: 'discard', forwardLabel: 'keep' }
    : { forward: 'accept', negative: 'reject', forwardLabel: 'accept' };
}

/**
 * Shorten a call or token count for the status line's budget summary.
 *
 * The line sits on one compact row, so 200000 reads as "200k" and 1200000 as
 * "1.2M"; the raw number stays in the tooltip-free budget read, never invented.
 * @param value - the count to shorten.
 * @returns the compact label, or "0" for a missing or negative count.
 */
function compactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) {
    const thousands = value / 1_000;
    return thousands >= 100 ? `${Math.round(thousands)}k` : `${Math.round(thousands * 10) / 10}k`;
  }
  return `${Math.round((value / 1_000_000) * 10) / 10}M`;
}

/** The first non-empty line of a reflection body, shortened for the list. */
function firstLine(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry !== '');
  if (line === undefined) return '';
  return line.length > REFLECTION_PREVIEW_CHARS ? `${line.slice(0, REFLECTION_PREVIEW_CHARS).trimEnd()}…` : line;
}

/** Whether the journal holds nothing to show at all. */
function isBlank(data: PanelInsights): boolean {
  return data.tasks.length === 0 && data.review.length === 0 && data.memory.length === 0 && data.reflections.length === 0;
}

/** The dot that separates two facts on one row. */
function Sep(): ReactNode {
  return (
    <span className="dfp-insights-sep" aria-hidden="true">
      ·
    </span>
  );
}

/**
 * One ToDo-style inline add row: a text input and an Add button.
 *
 * The row owns its draft, its busy flag, and its inline error, so a failed add
 * never disturbs the rest of the view. The parent's `onAdd` performs the write
 * and refreshes the page on success; Enter and the button both submit the form.
 * @param props - the placeholder, the button label, the translator, and the writer.
 * @returns the row, with its error line underneath when a write failed.
 */
function AddRow(props: {
  placeholder: string;
  action: string;
  t: Translate;
  onAdd: (text: string) => Promise<unknown>;
}): ReactNode {
  const { placeholder, action, t, onAdd } = props;
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = text.trim();
    if (value === '' || saving) return;
    setSaving(true);
    setError('');
    void onAdd(value).then(
      () => {
        setSaving(false);
        setText('');
      },
      (cause: unknown) => {
        setSaving(false);
        setError(addFailureMessage(cause, t));
      },
    );
  };

  return (
    <>
      <form className="dfp-insights-add" onSubmit={submit}>
        <input
          type="text"
          className="dfp-insights-add-input"
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={saving}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="dfp-insights-add-button" disabled={saving || text.trim() === ''}>
          {saving ? t('addItemSaving') : action}
        </button>
      </form>
      {error !== '' && <p className="dfp-insights-add-error">{error}</p>}
    </>
  );
}

/**
 * One still-open review item with the decisions its kind allows.
 *
 * The row owns its inline confirmation, its busy flag, and its error line, so a
 * failed decision never disturbs the rest of the queue. "Don't suggest again"
 * swaps the action row for one confirm/cancel question — no browser dialog —
 * and only the confirmed write carries `forever`, which hard-suppresses the
 * item for good.
 * @param props - the item, the translator, and the parent's writer.
 * @returns the item row in its decision state.
 */
function ReviewRow(props: {
  item: PanelReviewItem;
  t: Translate;
  onDecide: (item: PanelReviewItem, decision: ReviewDecision, forever: boolean) => Promise<void>;
}): ReactNode {
  const { item, t, onDecide } = props;
  const { forward, negative, forwardLabel } = reviewDecisions(item.kind);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = (decision: ReviewDecision, forever: boolean): void => {
    if (busy) return;
    setBusy(true);
    setError('');
    void onDecide(item, decision, forever).then(
      () => {
        // The parent removes the item and refreshes, so this row unmounts; the
        // state reset only matters when a slow refresh keeps it mounted.
        setBusy(false);
        setConfirming(false);
      },
      (cause: unknown) => {
        setBusy(false);
        setError(actionFailureMessage(cause, t('actionFailed'), t));
      },
    );
  };

  return (
    <li className="dfp-insights-row">
      <div className="dfp-insights-row-head">
        <span className={`dfp-insights-badge is-${item.kind}`}>{item.kind}</span>
        <span className="dfp-insights-row-title">{item.title}</span>
      </div>
      <div className="dfp-insights-meta">
        <span>
          {t('confidenceLabel')} {formatShare(item.confidence)}
        </span>
        {item.source_day !== undefined && item.source_day !== '' && (
          <>
            <Sep />
            <span className="dfp-insights-date">{shortDate(item.source_day, t)}</span>
          </>
        )}
      </div>
      {confirming ? (
        <div className="dfp-insights-confirm">
          <span className="dfp-insights-confirm-text">{t('foreverConfirm')}</span>
          <button
            type="button"
            className="dfp-insights-action is-confirm"
            disabled={busy}
            onClick={() => run(negative, true)}
          >
            {busy ? t('working') : t('confirm')}
          </button>
          <button
            type="button"
            className="dfp-insights-action"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              setError('');
            }}
          >
            {t('cancel')}
          </button>
        </div>
      ) : (
        <div className="dfp-insights-actions">
          <button
            type="button"
            className="dfp-insights-action is-primary"
            disabled={busy}
            onClick={() => run(forward, false)}
          >
            {t(forwardLabel)}
          </button>
          <button type="button" className="dfp-insights-action" disabled={busy} onClick={() => run(negative, false)}>
            {t('discard')}
          </button>
          <button
            type="button"
            className="dfp-insights-action is-danger"
            disabled={busy}
            onClick={() => {
              setConfirming(true);
              setError('');
            }}
          >
            {t('dontSuggestAgain')}
          </button>
          {busy && <span className="dfp-insights-working">{t('working')}</span>}
        </div>
      )}
      {error !== '' && (
        <p className="dfp-insights-action-error" role="status">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * The days a long task already carries, each with its Unlink.
 *
 * The chips come from the insights payload's per-task session list, so a day
 * that was linked by the history scan (or by an agent) can be detached later
 * from the task itself. Unlinking only says "this day should not count": the
 * activities behind it are untouched.
 * @param props - the task, the in-flight key, the inline error, the translator, and the writer.
 * @returns the session row, or nothing when the task carries no day.
 */
function TaskSessions(props: {
  task: PanelTaskSummary;
  unlinking: string | undefined;
  error: string;
  t: Translate;
  onUnlink: (task: PanelTaskSummary, day: string) => void;
}): ReactNode {
  const { task, unlinking, error, t, onUnlink } = props;
  const sessions = task.sessions ?? [];
  if (sessions.length === 0) return null;
  return (
    <>
      <div className="dfp-insights-sessions">
        <span>{t('sessionsLabel')}</span>
        {sessions.map((session) => {
          const key = `${task.id}:${session.day}`;
          const busy = unlinking === key;
          const date = shortDate(session.day, t);
          return (
            <span key={session.day} className="dfp-insights-session">
              <span className="dfp-insights-date">{date}</span>
              <button
                type="button"
                className="dfp-insights-session-unlink"
                aria-label={t('unlinkDay', { date })}
                title={t('unlinkDay', { date })}
                disabled={unlinking !== undefined}
                onClick={() => onUnlink(task, session.day)}
              >
                {busy ? t('working') : t('unlink')}
              </button>
            </span>
          );
        })}
      </div>
      {error !== '' && (
        <p className="dfp-insights-session-error" role="status">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * One titled block with its count, its own empty message, its rows, and an
 * optional add row that stays reachable even when the block is empty.
 * @param props - the block's title, item count, empty copy, rows, and add row.
 * @returns the section.
 */
function Section(props: {
  tone: 'tasks' | 'review' | 'memory' | 'reflections';
  title: string;
  count: number;
  empty: string;
  add?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const { tone, title, count, empty, add, children } = props;
  return (
    <section className={`dfp-insights-section is-${tone}`}>
      <div className="dfp-insights-section-head">
        <span className="dfp-insights-dot" aria-hidden="true" />
        <span className="dfp-insights-section-title">{title}</span>
        <span className="dfp-insights-count">{count}</span>
      </div>
      {count === 0 ? <p className="dfp-insights-empty">{empty}</p> : children}
      {add}
    </section>
  );
}

/**
 * The compact capture status line above the journal sections.
 *
 * Phase 0 has no recorder yet, so the line is deliberately a status strip, not
 * a control panel: it shows whether capture is configured on, what macOS says
 * about Screen Recording, how many frames today already holds, and the pause
 * flag. Pause/Resume writes that one flag through the host; the line rereads the
 * answer so the dot and the button can never disagree.
 * @param props - the status, the busy flag, an inline error, the translator, and the toggle.
 * @returns the line in its current tone.
 */
function CaptureLine(props: {
  status: PanelCaptureStatus;
  busy: boolean;
  error: string;
  t: Translate;
  onToggle: () => void;
}): ReactNode {
  const { status, busy, error, t, onToggle } = props;
  const denied = status.permission === 'denied';
  const tone = !status.enabled ? 'is-off' : denied || status.paused ? 'is-warn' : 'is-on';
  const headline = !status.enabled
    ? t('captureOff')
    : denied
      ? t('capturePermission')
      : status.paused
        ? t('capturePaused')
        : t('captureRecording');

  return (
    <div className={`dfp-capture-line ${tone}`} role="status">
      <span className="dfp-capture-dot" aria-hidden="true" />
      <span className="dfp-capture-copy">
        <span className="dfp-capture-state">{headline}</span>
        {status.enabled && !denied && !status.paused && (
          <>
            <Sep />
            <span className="dfp-capture-hint">{t('capturePending')}</span>
          </>
        )}
      </span>
      <span className="dfp-capture-side">
        {status.enabled && !denied ? (
          <>
            <span className="dfp-capture-frames">{t('captureToday', { frames: status.frames_today })}</span>
            <button type="button" className="dfp-capture-button" onClick={onToggle} disabled={busy}>
              {status.paused ? t('captureResume') : t('capturePause')}
            </button>
          </>
        ) : (
          <span className="dfp-capture-off-hint">{denied ? t('capturePermissionHint') : t('captureOffHint')}</span>
        )}
      </span>
      {error !== '' && (
        <span className="dfp-capture-error" role="status">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * The one state the analysis line reports, and the tone it draws.
 *
 * The order is the contract: disabled first, then a consent-gate block with its
 * precise reason, then a stopped worker, and only then the running/idle split.
 * A reason wins over "stopped" because it is the one thing the user can unblock
 * in the profile; a failure count never changes the state, it sits beside it.
 */
interface AnalysisView {
  /** The dot and background tone. */
  tone: 'is-on' | 'is-warn' | 'is-off';
  /** The short state copy. */
  state: string;
  /** The quiet next-step hint, when the line has one. */
  hint?: string;
}

/**
 * Choose the line's state from the host's analysis status.
 * @param status - the analysis status, as the route answered it.
 * @param t - the bound translator.
 * @returns the tone, state copy, and optional hint.
 */
function analysisView(status: AnalysisStatusSummary, t: Translate): AnalysisView {
  if (!status.enabled) {
    return { tone: 'is-off', state: t('analysisOff'), hint: t('analysisOffHint') };
  }
  if (status.reason !== undefined && status.reason !== '') {
    switch (status.reason) {
      case 'consent:none':
        return { tone: 'is-warn', state: t('analysisWaitingConsent'), hint: t('analysisWaitingConsentHint') };
      case 'provider-unset':
        return { tone: 'is-warn', state: t('analysisNeedsProvider'), hint: t('analysisNeedsConfigHint') };
      case 'model-unset':
        return { tone: 'is-warn', state: t('analysisNeedsModel'), hint: t('analysisNeedsConfigHint') };
      case 'consent:provider-not-local':
        return {
          tone: 'is-warn',
          state: t('analysisProviderNotLocal'),
          hint: t('analysisProviderNotLocalHint'),
        };
      case 'paused':
        return { tone: 'is-warn', state: t('analysisPaused'), hint: t('analysisPausedHint') };
      default:
        return { tone: 'is-warn', state: t('analysisNeedsConfig'), hint: t('analysisNeedsConfigHint') };
    }
  }
  // A host may report the consent without a reason (e.g. the status was built
  // without a consent decision); consent none is still the same wait for the
  // user, so it reads the same.
  if (status.consent === 'none') {
    return { tone: 'is-warn', state: t('analysisWaitingConsent'), hint: t('analysisWaitingConsentHint') };
  }
  if (status.worker !== 'running') {
    return { tone: 'is-off', state: t('analysisWorkerStopped'), hint: t('analysisWorkerStoppedHint') };
  }
  if (status.queued + status.running > 0) return { tone: 'is-on', state: t('analysisRunning') };
  return { tone: 'is-on', state: t('analysisIdle') };
}

/**
 * The compact, read-only analysis line under the capture line.
 *
 * It reports what the worker is doing and what today has cost — state, failures,
 * the call/token budget, and the last job's local time — and deliberately
 * carries no control: enabling analysis or changing its consent is a profile
 * edit, so the panel keeps its one entry point and no second control surface.
 * @param props - the analysis status and the translator.
 * @returns the line in its current tone.
 */
function AnalysisLine(props: { status: AnalysisStatusSummary; t: Translate }): ReactNode {
  const { status, t } = props;
  const view = analysisView(status, t);
  const budget = t('analysisBudget', {
    calls: compactCount(status.callsToday),
    maxCalls: compactCount(status.maxCallsPerDay),
    tokens: compactCount(status.tokensToday.input + status.tokensToday.output),
    maxTokens: compactCount(status.dailyTokenBudget),
  });
  const lastJob =
    status.lastJobAt === undefined
      ? ''
      : formatClock(new Date(status.lastJobAt).toISOString(), panelLanguage(t));
  // The consent disclosure is the one privacy statement the line carries: as
  // soon as analysis may call a model, say what actually leaves the machine.
  // A cloud consent adds the sentence that says the metadata leaves the Mac.
  const privacy =
    status.consent === 'none'
      ? ''
      : status.consent === 'cloud'
        ? `${t('analysisPrivacy')} ${t('analysisPrivacyCloud')}`
        : t('analysisPrivacy');

  return (
    <div className={`dfp-analysis-line ${view.tone}`} role="status">
      <span className="dfp-analysis-dot" aria-hidden="true" />
      <span className="dfp-analysis-copy">
        <span className="dfp-analysis-state">{view.state}</span>
        {view.hint !== undefined && (
          <>
            <Sep />
            <span className="dfp-analysis-hint">{view.hint}</span>
          </>
        )}
        {lastJob !== '' && (
          <>
            <Sep />
            <span className="dfp-analysis-last">{t('analysisLastJob', { time: lastJob })}</span>
          </>
        )}
        {privacy !== '' && <span className="dfp-analysis-privacy">{privacy}</span>}
      </span>
      {status.enabled && (
        <span className="dfp-analysis-side">
          {status.failed > 0 && (
            <span className="dfp-analysis-failed">{t('analysisFailed', { count: status.failed })}</span>
          )}
          <span className="dfp-analysis-budget">{budget}</span>
        </span>
      )}
    </div>
  );
}

/** The weekday names the scheduler writes, Monday first to match `weekdayLabels`. */
const CLOSE_WEEKDAYS: readonly string[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Name the configured weekly close in the panel's language.
 *
 * The host stores `automation.weeklyOn` as a lowercase English weekday; the
 * calendar's own short labels are Monday-first, so the index maps straight
 * across. An unknown value is shown as stored rather than guessed.
 * @param status - the automation status.
 * @param t - the bound translator.
 * @returns the localised weekday label.
 */
function closeWeekday(status: PanelAutomationStatus, t: Translate): string {
  const index = CLOSE_WEEKDAYS.indexOf(status.weeklyOn.toLowerCase());
  if (index < 0) return status.weeklyOn;
  return weekdayLabels(t)[index] ?? status.weeklyOn;
}

/**
 * Translate a stored close status for the line.
 *
 * The one status the line must make legible is a failure; any other stored word
 * (`complete`, `skipped`, …) is already readable and passes through unchanged.
 * @param status - the stored close status.
 * @param t - the bound translator.
 * @returns the status word the line shows.
 */
function closeStatusWord(status: string, t: Translate): string {
  return status === 'failed' ? t('closeFailed') : status;
}

/**
 * The slim read-only line for the scheduled day/week close.
 *
 * It reports the day boundary time, the last stored day close and its status,
 * the weekday the week closes, and the catch-up window; a failed last close
 * turns the dot amber and a disabled automation turns it grey. It deliberately
 * carries no control and no new entry point: the automation block lives in the
 * profile, and the panel keeps its single button and its three views.
 * @param props - the automation status and the translator.
 * @returns the line in its current tone.
 */
function CloseLine(props: { status: PanelAutomationStatus; t: Translate }): ReactNode {
  const { status, t } = props;
  const failed = status.lastDayClose?.status === 'failed';
  const tone = !status.enabled ? 'is-off' : failed ? 'is-warn' : 'is-on';
  const lastClose = status.lastDayClose;

  return (
    <div className={`dfp-close-line ${tone}`} role="status">
      <span className="dfp-close-dot" aria-hidden="true" />
      <span className="dfp-close-copy">
        {status.enabled ? (
          <>
            <span className="dfp-close-state">{t('closeLine', { time: status.dailyAt })}</span>
            {lastClose !== undefined && (
              <>
                <Sep />
                <span className="dfp-close-last">
                  {t('closeLast', {
                    day: shortDate(lastClose.day, t),
                    status: closeStatusWord(lastClose.status, t),
                  })}
                </span>
              </>
            )}
            <Sep />
            <span className="dfp-close-weekly">{t('closeWeekly', { day: closeWeekday(status, t) })}</span>
            <Sep />
            <span className="dfp-close-catchup">{t('closeCatchUp', { days: status.catchUpDays })}</span>
            {status.running && (
              <>
                <Sep />
                <span className="dfp-close-running">{t('closeRunning')}</span>
              </>
            )}
          </>
        ) : (
          <span className="dfp-close-state">{t('closeOff')}</span>
        )}
      </span>
    </div>
  );
}

/**
 * The capture card under a task add: offer to scan the recent history, preview
 * the days whose activity matches the task, and link the confirmed ones.
 *
 * The card owns no state of its own — the view holds the stage, the preview,
 * and the inline error, so a failed scan or link never disturbs the sections
 * around it and no hooks are needed inside this purely presentational block.
 * @param props - the current state, the translator, and the three actions.
 * @returns the card in its current stage.
 */
function ScanPrompt(props: {
  state: CaptureState;
  t: Translate;
  onScan: () => void;
  onLink: () => void;
  onDismiss: () => void;
}): ReactNode {
  const { state, t, onScan, onLink, onDismiss } = props;
  const { task, stage, scan, error } = state;
  const candidates = scan?.days ?? [];
  const linking = stage === 'linking';

  return (
    <section className="dfp-insights-capture" aria-live="polite">
      <p className="dfp-insights-capture-title">{t('captureTaskAdded', { title: task.title })}</p>

      {stage === 'ask' && (
        <>
          <p className="dfp-insights-capture-body">{t('captureScanAsk')}</p>
          <div className="dfp-insights-capture-actions">
            <button type="button" className="dfp-insights-capture-button is-primary" onClick={onScan}>
              {t('captureScanAction')}
            </button>
            <button type="button" className="dfp-insights-capture-button" onClick={onDismiss}>
              {t('captureScanLater')}
            </button>
          </div>
        </>
      )}

      {stage === 'scanning' && (
        <>
          <p className="dfp-insights-capture-body">{t('captureScanScanning')}</p>
          <div className="dfp-insights-capture-actions">
            <button type="button" className="dfp-insights-capture-button is-primary" disabled>
              {t('captureScanAction')}
            </button>
            <button type="button" className="dfp-insights-capture-button" disabled>
              {t('captureScanLater')}
            </button>
          </div>
        </>
      )}

      {(stage === 'result' || stage === 'linking') && (
        <>
          {candidates.length === 0 ? (
            <p className="dfp-insights-capture-body">{t('captureScanEmpty')}</p>
          ) : (
            <>
              <p className="dfp-insights-capture-summary">
                {t('captureScanFound', {
                  days: scan?.total_days ?? 0,
                  minutes: formatDuration(scan?.total_minutes ?? 0),
                })}
              </p>
              <ul className="dfp-insights-capture-list">
                {candidates.slice(0, SCAN_PREVIEW_ROWS).map((candidate) => (
                  <li key={candidate.day} className="dfp-insights-capture-row">
                    <span className="dfp-insights-capture-date">{shortDate(candidate.day, t)}</span>
                    <Sep />
                    <span className="dfp-insights-capture-minutes">{formatDuration(candidate.minutes)}</span>
                    <Sep />
                    <span className="dfp-insights-capture-text">{candidate.titles[0] ?? t('untitled')}</span>
                  </li>
                ))}
              </ul>
              {candidates.length > SCAN_PREVIEW_ROWS && (
                <p className="dfp-insights-capture-more">
                  {t('captureScanMore', { count: candidates.length - SCAN_PREVIEW_ROWS })}
                </p>
              )}
            </>
          )}
          <div className="dfp-insights-capture-actions">
            {candidates.length === 0 ? (
              <button type="button" className="dfp-insights-capture-button is-primary" onClick={onDismiss}>
                {t('captureScanOk')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="dfp-insights-capture-button is-primary"
                  onClick={onLink}
                  disabled={linking}
                >
                  {linking ? t('captureScanLinking') : t('captureScanLink', { count: candidates.length })}
                </button>
                <button type="button" className="dfp-insights-capture-button" onClick={onDismiss} disabled={linking}>
                  {t('captureScanCancel')}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {error !== undefined && error !== '' && (
        <p className="dfp-insights-capture-error" role="status">
          {t('captureScanError')} · {error}
        </p>
      )}
    </section>
  );
}

/**
 * Render the insights view.
 * @param props - the injected reader and translator.
 * @returns the four journal sections, or one of the page states.
 */
export function InsightsPanel({ loadInsights, t }: InsightsPanelProps): ReactNode {
  const [data, setData] = useState<PanelInsights | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const [capture, setCapture] = useState<CaptureState | undefined>(undefined);
  const [captureStatus, setCaptureStatus] = useState<PanelCaptureStatus | undefined>(undefined);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatusSummary | undefined>(undefined);
  const [automationStatus, setAutomationStatus] = useState<PanelAutomationStatus | undefined>(undefined);
  // One review decision at a time, and one session unlink at a time: the item
  // row disables its own buttons while its write is in flight.
  const [unlinking, setUnlinking] = useState<string | undefined>(undefined);
  const [unlinkError, setUnlinkError] = useState<{ taskId: number; message: string } | undefined>(undefined);

  useEffect(() => {
    if (typeof loadInsights !== 'function') {
      setPhase('error');
      setError(t('insightsUnavailable'));
      return;
    }
    const controller = new AbortController();
    setPhase('loading');
    setError('');
    loadInsights(controller.signal).then(
      (payload) => {
        if (controller.signal.aborted) return;
        setData(payload);
        setPhase('ready');
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(rawMessage(cause));
        setPhase('error');
      },
    );
    return () => {
      controller.abort();
    };
  }, [loadInsights, nonce]);

  // The capture line rides the same refresh: one extra read alongside the
  // insights read. A host without the route (or a failed probe) degrades to the
  // off state silently, because capture being unavailable is not a load error.
  useEffect(() => {
    const controller = new AbortController();
    fetchCaptureStatus(controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        setCaptureStatus(answer.capture);
      },
      () => {
        if (controller.signal.aborted) return;
        setCaptureStatus(OFF_CAPTURE_STATUS);
      },
    );
    return () => {
      controller.abort();
    };
  }, [nonce]);

  // The analysis line rides the same refresh: one more read alongside the
  // insights read. A host without the route (or a failed probe) degrades to the
  // off state silently, because analysis being unavailable is not a load error
  // and must not add noise to a journal that already loaded.
  useEffect(() => {
    const controller = new AbortController();
    fetchAnalysisStatus(controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        setAnalysisStatus(answer.analysis);
      },
      () => {
        if (controller.signal.aborted) return;
        setAnalysisStatus(OFF_ANALYSIS_STATUS);
      },
    );
    return () => {
      controller.abort();
    };
  }, [nonce]);

  // The close line rides the same refresh as the two lines above: one more read
  // beside the insights read. A host without the route (or a failed read)
  // degrades to the quiet off line, because a missing schedule is not a load
  // error and must not add noise to a journal that already loaded.
  useEffect(() => {
    const controller = new AbortController();
    fetchAutomationStatus(controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return;
        setAutomationStatus(answer.automation);
      },
      () => {
        if (controller.signal.aborted) return;
        setAutomationStatus(OFF_AUTOMATION_STATUS);
      },
    );
    return () => {
      controller.abort();
    };
  }, [nonce]);

  const refresh = (): void => setNonce((value) => value + 1);
  const retry = (): void => setNonce((value) => value + 1);
  // Pause/Resume is the line's only write; the host answers with the reread
  // status, so the button never shows a state the journal does not hold.
  const toggleCapture = (): void => {
    if (captureStatus === undefined || captureBusy) return;
    const paused = !captureStatus.paused;
    setCaptureBusy(true);
    setCaptureError('');
    void setCapturePaused(paused).then(
      (answer) => {
        setCaptureBusy(false);
        setCaptureStatus(answer.capture);
      },
      (cause: unknown) => {
        setCaptureBusy(false);
        setCaptureError(addFailureMessage(cause, t));
      },
    );
  };
  // Tasks share one scale so the bars compare within the visible list.
  const maxTaskMinutes = Math.max(1, ...(data?.tasks.map((task) => task.total_minutes) ?? []));

  // Each add writes the owned journal directly, then refreshes the whole view so
  // the new row and its section count arrive together with no local merge.
  const submitTask = async (title: string): Promise<void> => {
    const { task } = await addTask(title);
    // The scan is offered, never forced: the card can be dismissed and the task
    // keeps the zero sessions it was created with.
    setCapture({ task, stage: 'ask' });
    refresh();
  };
  // Scan and link are the card's two writes-in-waiting: the scan is read-only,
  // and only the link attaches the confirmed days as the task's sessions.
  const runScan = (): void => {
    if (capture === undefined || capture.stage === 'scanning') return;
    const task = capture.task;
    setCapture({ task, stage: 'scanning' });
    void scanTaskHistory(task.id, SCAN_DAY_COUNT).then(
      (answer) => setCapture({ task, stage: 'result', scan: answer.scan }),
      (cause: unknown) => setCapture({ task, stage: 'ask', error: addFailureMessage(cause, t) }),
    );
  };
  const runLink = (): void => {
    if (capture === undefined || capture.scan === undefined || capture.stage === 'linking') return;
    const { task, scan } = capture;
    const days = scan.days.map((candidate) => ({
      day: candidate.day,
      minutes: candidate.minutes,
      activity_ids: candidate.activity_ids,
    }));
    setCapture({ task, stage: 'linking', scan });
    void linkTaskHistory(task.id, days).then(
      () => {
        // The linked days are sessions now: drop the card and re-read the page
        // so the task row shows its new total in the same pass.
        setCapture(undefined);
        refresh();
      },
      (cause: unknown) => setCapture({ task, stage: 'result', scan, error: addFailureMessage(cause, t) }),
    );
  };
  const dismissCapture = (): void => setCapture(undefined);
  // A decision is the user's own write: it lands on the host's review route and
  // the row re-reads the page, so an accepted proposal's new task appears in the
  // tasks section in the same pass. The item is dropped from the local list
  // first so the row cannot be decided twice while the re-read is in flight.
  const decideReview = async (item: PanelReviewItem, decision: ReviewDecision, forever: boolean): Promise<void> => {
    await postReviewDecision(item.id, decision, forever ? { forever: true } : undefined);
    setData((current) =>
      current === undefined
        ? current
        : { ...current, review: current.review.filter((entry) => entry.id !== item.id) },
    );
    refresh();
  };
  // Detaching says one day should not count; the activities behind it stay. The
  // write answers with the updated task, but the page still re-reads so the
  // totals, the stall mark, and the section counts move together.
  const unlinkSession = (task: PanelTaskSummary, day: string): void => {
    const key = `${task.id}:${day}`;
    if (unlinking !== undefined) return;
    setUnlinking(key);
    setUnlinkError(undefined);
    void postTaskDetach(task.id, day).then(
      () => {
        setUnlinking(undefined);
        refresh();
      },
      (cause: unknown) => {
        setUnlinking(undefined);
        setUnlinkError({ taskId: task.id, message: actionFailureMessage(cause, t('unlinkFailed'), t) });
      },
    );
  };
  const submitMemory = async (text: string): Promise<void> => {
    await addMemory(text);
    refresh();
  };
  const submitReflection = async (text: string): Promise<void> => {
    await addReflection(text);
    refresh();
  };

  return (
    <div className="dfp-view dfp-insights">
      <div className="dfp-insights-head">
        <div className="dfp-insights-heading">
          <span className="dfp-insights-title">{t('insightsTitle')}</span>
          {phase === 'ready' && data !== undefined && (
            <span className="dfp-insights-sub">{t('activeTasksCount', { count: data.tasks.length })}</span>
          )}
        </div>
        <button
          type="button"
          className="dfp-icon-button"
          aria-label={t('insightsRefresh')}
          title={t('insightsRefresh')}
          onClick={refresh}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {REFRESH_GLYPH}
          </svg>
        </button>
      </div>

      {captureStatus !== undefined && (
        <CaptureLine
          status={captureStatus}
          busy={captureBusy}
          error={captureError}
          t={t}
          onToggle={toggleCapture}
        />
      )}

      {analysisStatus !== undefined && <AnalysisLine status={analysisStatus} t={t} />}

      {automationStatus !== undefined && <CloseLine status={automationStatus} t={t} />}

      {phase === 'loading' && data === undefined && <div className="dfp-state">{t('insightsLoading')}</div>}

      {phase === 'error' && data === undefined && (
        <div className="dfp-state">
          <span className="dfp-state-title">{t('insightsError')}</span>
          <span>{humanize(error, t)}</span>
          <button type="button" className="dfp-today-button" onClick={retry}>
            {t('retry')}
          </button>
        </div>
      )}

      {data !== undefined && (
        <>
          {error !== '' && (
            <div className="dfp-banner">
              <span>{humanize(error, t)}</span>
              <button type="button" className="dfp-today-button" onClick={retry}>
                {t('retry')}
              </button>
            </div>
          )}

          {isBlank(data) && (
            <div className="dfp-insights-intro">
              <p className="dfp-insights-intro-title">{t('insightsIntroTitle')}</p>
              <p className="dfp-insights-intro-body">{t('insightsIntro')}</p>
              <ul className="dfp-insights-intro-list">
                {[
                  { title: t('tasksSection'), body: t('insightsIntroTasks') },
                  { title: t('reviewSection'), body: t('insightsIntroReview') },
                  { title: t('memorySection'), body: t('insightsIntroMemory') },
                  { title: t('reflectionsSection'), body: t('insightsIntroReflections') },
                ].map((row) => (
                  <li key={row.title} className="dfp-insights-intro-item">
                    <span className="dfp-insights-badge">{row.title}</span>
                    <p className="dfp-insights-intro-text">{row.body}</p>
                  </li>
                ))}
              </ul>
              <p className="dfp-insights-intro-hint">{t('insightsEmpty')}</p>
            </div>
          )}

          {capture !== undefined && (
            <ScanPrompt
              state={capture}
              t={t}
              onScan={runScan}
              onLink={runLink}
              onDismiss={dismissCapture}
            />
          )}

          <Section
            tone="tasks"
            title={t('tasksSection')}
            count={data.tasks.length}
            empty={t('noTasks')}
            add={
              <AddRow
                placeholder={t('addTaskPlaceholder')}
                action={t('addTaskAction')}
                t={t}
                onAdd={submitTask}
              />
            }
          >
            <ul className="dfp-insights-list">
              {data.tasks.map((task) => (
                <li key={task.id} className="dfp-insights-row">
                  <div className="dfp-insights-row-head">
                    <span className="dfp-insights-row-title">{task.title}</span>
                    {task.stalled && <span className="dfp-insights-badge is-warn">{t('stalledLabel')}</span>}
                  </div>
                  <div className="dfp-insights-meta">
                    <span className="dfp-insights-kind">{task.status}</span>
                    <Sep />
                    <span className="dfp-insights-num">{formatDuration(task.total_minutes)}</span>
                    <Sep />
                    <span>{t(task.session_days === 1 ? 'daysRecordedOne' : 'daysRecorded', { count: task.session_days })}</span>
                    {task.target_date !== undefined && task.target_date !== '' && (
                      <>
                        <Sep />
                        <span className="dfp-insights-target">
                          {t('targetLabel')} {task.target_date}
                        </span>
                      </>
                    )}
                  </div>
                  <span className="dfp-insights-progress" aria-hidden="true">
                    <span style={{ width: `${Math.max(6, Math.round((task.total_minutes / maxTaskMinutes) * 100))}%` }} />
                  </span>
                  <TaskSessions
                    task={task}
                    unlinking={unlinking}
                    error={unlinkError?.taskId === task.id ? unlinkError.message : ''}
                    t={t}
                    onUnlink={unlinkSession}
                  />
                </li>
              ))}
            </ul>
          </Section>

          <Section tone="review" title={t('reviewSection')} count={data.review.length} empty={t('noReviewItems')}>
            <ul className="dfp-insights-list">
              {data.review.map((item) => (
                <ReviewRow key={item.id} item={item} t={t} onDecide={decideReview} />
              ))}
            </ul>
          </Section>

          <Section
            tone="memory"
            title={t('memorySection')}
            count={data.memory.length}
            empty={t('noMemoryClaims')}
            add={
              <AddRow
                placeholder={t('addMemoryPlaceholder')}
                action={t('addMemoryAction')}
                t={t}
                onAdd={submitMemory}
              />
            }
          >
            <ul className="dfp-insights-list">
              {data.memory.map((claim) => (
                <li key={claim.id} className="dfp-insights-row">
                  <div className="dfp-insights-row-head">
                    <span className={`dfp-insights-badge is-${claim.kind}`}>{claim.kind}</span>
                    <span className="dfp-insights-row-title">{claim.subject}</span>
                  </div>
                  <div className="dfp-insights-meta">
                    <span className="dfp-insights-date">{shortDate(claim.observed_on, t)}</span>
                    <Sep />
                    <span>
                      {t('confidenceLabel')} {formatShare(claim.confidence)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            tone="reflections"
            title={t('reflectionsSection')}
            count={data.reflections.length}
            empty={t('noReflections')}
            add={
              <AddRow
                placeholder={t('addReflectionPlaceholder')}
                action={t('addReflectionAction')}
                t={t}
                onAdd={submitReflection}
              />
            }
          >
            <ul className="dfp-insights-list">
              {data.reflections.map((reflection) => {
                const preview = firstLine(reflection.body);
                return (
                  <li key={reflection.id} className="dfp-insights-row">
                    <div className="dfp-insights-row-head">
                      <span className={`dfp-insights-badge is-${reflection.kind}`}>{reflection.kind}</span>
                      <span className="dfp-insights-row-title dfp-insights-period">{shortDate(reflection.period_key, t)}</span>
                    </div>
                    <p className="dfp-insights-body">{preview === '' ? t('untitled') : preview}</p>
                  </li>
                );
              })}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
