/**
 * The insights view: the journal's long tasks, review queue, memory claims, and
 * reflections on one page, shown inside the single Dayflow panel.
 *
 * The host answers all four lists in one response, so the view has a single
 * load state and a single refresh: no section can be stale while another is
 * fresh. Every section is still optional — an empty journal shows one quiet
 * empty state instead of four.
 *
 * Tasks, memory claims, and today's reflection can also be added from the view
 * itself: a ToDo-style row at the bottom of each of those three sections writes
 * the owned journal directly and refreshes the page on success. Adding a task
 * then offers an optional history scan: the panel previews the recent days whose
 * activity matches the task and links only the days the user confirms, so the
 * create flow stays one step while the evidence stays the user's call. The
 * review queue stays read-only because its items are agent proposals the user
 * decides on.
 * @module dsh-plugin-dayflow/client/insights
 */

import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import type { PanelInsights, PanelTaskScanResponse, PanelTaskSummary } from '../panel-contract.js';
import { addMemory, addReflection, addTask, linkTaskHistory, scanTaskHistory } from './data.js';
import { formatDuration, formatShare, shortDate } from './format.js';
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

  const refresh = (): void => setNonce((value) => value + 1);
  const retry = (): void => setNonce((value) => value + 1);
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
                </li>
              ))}
            </ul>
          </Section>

          <Section tone="review" title={t('reviewSection')} count={data.review.length} empty={t('noReviewItems')}>
            <ul className="dfp-insights-list">
              {data.review.map((item) => (
                <li key={item.id} className="dfp-insights-row">
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
                </li>
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
