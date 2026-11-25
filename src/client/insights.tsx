/**
 * The Insights tab: the journal's long tasks, review queue, memory claims, and
 * reflections on one page.
 *
 * The host answers all four lists in one response, so the page has a single
 * load state and a single refresh: no section can be stale while another is
 * fresh. Every section is still optional — an empty journal shows one quiet
 * empty state instead of four.
 * @module dsh-plugin-dayflow/client/insights
 */

import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import type { PanelInsights } from '../panel-contract.js';
import { formatDuration, formatShare } from './format.js';
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

/** Props the slot runtime injects into the insights body. */
export interface InsightsPanelProps {
  /** Reads the journal's insights from the host. */
  loadInsights: (signal?: AbortSignal) => Promise<PanelInsights>;
  /** Namespace-bound translation. */
  t: Translate;
}

/** Props the slot runtime injects into the header action. */
export interface InsightsToggleProps {
  /** Opens (and focuses) the insights tab. */
  openPanel: () => void;
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
 * One titled block with its count and its own empty message.
 * @param props - the block's title, item count, empty copy, and rows.
 * @returns the section.
 */
function Section(props: { title: string; count: number; empty: string; children: ReactNode }): ReactNode {
  const { title, count, empty, children } = props;
  return (
    <section className="dfp-insights-section">
      <div className="dfp-insights-section-head">
        <span className="dfp-insights-section-title">{title}</span>
        <span className="dfp-insights-count">{count}</span>
      </div>
      {count === 0 ? <p className="dfp-insights-empty">{empty}</p> : children}
    </section>
  );
}

/**
 * Render the Insights tab.
 * @param props - the injected reader and translator.
 * @returns the four journal sections, or one of the page states.
 */
export function InsightsPanel({ loadInsights, t }: InsightsPanelProps): ReactNode {
  const [data, setData] = useState<PanelInsights | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
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

  return (
    <div className="dfp-root">
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

            {isBlank(data) ? (
              <div className="dfp-state">{t('insightsEmpty')}</div>
            ) : (
              <>
                <Section title={t('tasksSection')} count={data.tasks.length} empty={t('noTasks')}>
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
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section title={t('reviewSection')} count={data.review.length} empty={t('noReviewItems')}>
                  <ul className="dfp-insights-list">
                    {data.review.map((item) => (
                      <li key={item.id} className="dfp-insights-row">
                        <div className="dfp-insights-row-head">
                          <span className="dfp-insights-badge">{item.kind}</span>
                          <span className="dfp-insights-row-title">{item.title}</span>
                        </div>
                        <div className="dfp-insights-meta">
                          <span>
                            {t('confidenceLabel')} {formatShare(item.confidence)}
                          </span>
                          {item.source_day !== undefined && item.source_day !== '' && (
                            <>
                              <Sep />
                              <span className="dfp-insights-num">{item.source_day}</span>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section title={t('memorySection')} count={data.memory.length} empty={t('noMemoryClaims')}>
                  <ul className="dfp-insights-list">
                    {data.memory.map((claim) => (
                      <li key={claim.id} className="dfp-insights-row">
                        <div className="dfp-insights-row-head">
                          <span className="dfp-insights-badge">{claim.kind}</span>
                          <span className="dfp-insights-row-title">{claim.subject}</span>
                        </div>
                        <div className="dfp-insights-meta">
                          <span>
                            {t('observedLabel')} <span className="dfp-insights-num">{claim.observed_on}</span>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section title={t('reflectionsSection')} count={data.reflections.length} empty={t('noReflections')}>
                  <ul className="dfp-insights-list">
                    {data.reflections.map((reflection) => {
                      const preview = firstLine(reflection.body);
                      return (
                        <li key={reflection.id} className="dfp-insights-row">
                          <div className="dfp-insights-row-head">
                            <span className="dfp-insights-badge">{reflection.kind}</span>
                            <span className="dfp-insights-row-title dfp-insights-period">{reflection.period_key}</span>
                          </div>
                          <p className="dfp-insights-body">{preview === '' ? t('untitled') : preview}</p>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function InsightsGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.5h6M2.5 8h6M2.5 11.5h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12.2 2.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Render the conversation-header action that opens the Insights tab.
 * @param props - the injected opener and translator.
 * @returns the button anchored in the conversation header.
 */
export function InsightsToggle({ openPanel, t }: InsightsToggleProps): ReactNode {
  return (
    <Tooltip label={t('insightsTitle')} side="bottom">
      <Button
        variant="ghost"
        size="sm"
        className="dfp-header-button"
        icon={<InsightsGlyph />}
        aria-label={t('insightsTitle')}
        onClick={openPanel}
      >
        <span className="dfp-toggle-label">{t('insightsTabTitle')}</span>
      </Button>
    </Tooltip>
  );
}
