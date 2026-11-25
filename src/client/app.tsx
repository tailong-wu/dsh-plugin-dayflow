/**
 * The panel body: a month calendar, a week swim-lane, or the journal insights.
 * The calendar and the week each drill into one day.
 *
 * The views share one selection: picking a day opens the detail from either
 * calendar surface, and returning keeps the day marked in whichever view the
 * user came from. Escape closes the detail. The insights view is a read-only
 * summary inside the same panel, so the plugin keeps one entry point.
 * @module dsh-plugin-dayflow/client/app
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives';

import { shiftDayKey, shiftMonthKey } from '../panel-contract.js';
import type { PanelDay, PanelInsights, PanelMonth, PanelWeek } from '../panel-contract.js';
import { DayView } from './day.js';
import { InsightsPanel } from './insights.js';
import { monthOfDay, monthKeyOf, shiftWeekKey, todayKey } from './format.js';
import type { Translate } from './format.js';
import { MonthView } from './month.js';
import type { Phase } from './types.js';
import { WeekView } from './week.js';

/** The panel's three views; the calendar has two, insights is the journal summary. */
type PanelView = 'month' | 'week' | 'insights';

/** Props the slot runtime injects into the panel body. */
export interface PanelProps {
  /** Reads one day from the host; `undefined` means the current Dayflow day. */
  loadDay: (date?: string, signal?: AbortSignal) => Promise<PanelDay>;
  /** Reads one month of days; `undefined` means the current month. */
  loadMonth: (month?: string, signal?: AbortSignal) => Promise<PanelMonth>;
  /** Reads one week of days; `undefined` means the current week. */
  loadWeek: (date?: string, signal?: AbortSignal) => Promise<PanelWeek>;
  /** Reads the journal's single insights summary. */
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
 * Render the panel.
 * @param props - the injected readers and translator.
 * @returns the calendar, the week, or one day.
 */
export function DayflowPanel({ loadDay, loadMonth, loadWeek, loadInsights, t }: PanelProps): ReactNode {
  const [view, setView] = useState<PanelView>('month');
  const [month, setMonth] = useState(() => monthKeyOf(new Date()));
  const [monthData, setMonthData] = useState<PanelMonth | undefined>(undefined);
  const [monthPhase, setMonthPhase] = useState<Phase>('loading');
  const [monthError, setMonthError] = useState('');
  const [monthNonce, setMonthNonce] = useState(0);

  const [weekAnchor, setWeekAnchor] = useState<string | undefined>(undefined);
  const [weekData, setWeekData] = useState<PanelWeek | undefined>(undefined);
  const [weekPhase, setWeekPhase] = useState<Phase>('loading');
  const [weekError, setWeekError] = useState('');
  const [weekNonce, setWeekNonce] = useState(0);

  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [dayOpen, setDayOpen] = useState(false);
  const [dayData, setDayData] = useState<PanelDay | undefined>(undefined);
  const [dayPhase, setDayPhase] = useState<Phase>('ready');
  const [dayError, setDayError] = useState('');
  const [dayNonce, setDayNonce] = useState(0);

  useEffect(() => {
    if (view !== 'month') return;
    const controller = new AbortController();
    setMonthPhase('loading');
    setMonthError('');
    loadMonth(month, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        setMonthData(data);
        setMonthPhase('ready');
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setMonthError(rawMessage(cause));
        setMonthPhase('error');
      },
    );
    return () => {
      controller.abort();
    };
  }, [view, month, monthNonce, loadMonth]);

  useEffect(() => {
    if (view !== 'week') return;
    const controller = new AbortController();
    setWeekPhase('loading');
    setWeekError('');
    loadWeek(weekAnchor, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        setWeekData(data);
        setWeekPhase('ready');
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setWeekError(rawMessage(cause));
        setWeekPhase('error');
      },
    );
    return () => {
      controller.abort();
    };
  }, [view, weekAnchor, weekNonce, loadWeek]);

  useEffect(() => {
    if (!dayOpen || selected === undefined) return;
    const controller = new AbortController();
    const seed =
      (view === 'month' ? monthData?.days.find((entry) => entry.date === selected) : undefined) ??
      weekData?.days.find((entry) => entry.date === selected) ??
      (dayData?.date === selected ? dayData : undefined);
    setDayData((current) => (current?.date === selected ? current : seed));
    setDayPhase(seed === undefined ? 'loading' : 'ready');
    setDayError('');
    loadDay(selected, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        setDayData(data);
        setDayPhase('ready');
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setDayError(rawMessage(cause));
        setDayPhase(seed === undefined ? 'error' : 'ready');
      },
    );
    return () => {
      controller.abort();
    };
    // dayData is read for its date only; listing it would re-fire on every load.
  }, [dayOpen, selected, dayNonce, loadDay, view, monthData, weekData]);

  useEffect(() => {
    if (!dayOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDayOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dayOpen]);

  const pick = useCallback((date: string) => {
    setSelected(date);
    setDayOpen(true);
    setDayData(undefined);
    setDayPhase('loading');
    if (view === 'month') {
      const target = monthOfDay(date);
      if (target !== month) setMonth(target);
    }
  }, [view, month]);

  const goToday = (): void => {
    setDayOpen(false);
    setSelected(undefined);
    const target = monthKeyOf(new Date());
    if (target === month) setMonthNonce((value) => value + 1);
    else setMonth(target);
  };

  const goThisWeek = (): void => {
    setDayOpen(false);
    setSelected(undefined);
    setWeekAnchor(undefined);
    setWeekNonce((value) => value + 1);
  };

  const refresh = (): void => {
    if (dayOpen && selected !== undefined) setDayNonce((value) => value + 1);
    if (view === 'month') setMonthNonce((value) => value + 1);
    else setWeekNonce((value) => value + 1);
  };

  const switchView = (next: PanelView): void => {
    setView(next);
    setDayOpen(false);
    // Keep the selected day visible in the view being switched to.
    if (selected !== undefined && next === 'month') setMonth(monthOfDay(selected));
    if (selected !== undefined && next === 'week') setWeekAnchor(selected);
  };

  const toolbar = (
    <div className="dfp-view-switch" role="group" aria-label={t('viewLabel')}>
      <SegmentedControl<PanelView>
        id="dayflow-view"
        label={t('viewLabel')}
        value={view}
        options={[
          { value: 'month', label: t('viewMonth') },
          { value: 'week', label: t('viewWeek') },
          { value: 'insights', label: t('insightsTabTitle') },
        ]}
        onChange={switchView}
      />
    </div>
  );

  // The view switch lives on its own row so the panel keeps exactly one
  // entry while the three views stay reachable at any sidebar width.
  const switchBar = <div className="dfp-subhead">{toolbar}</div>;

  if (view === 'insights') {
    return (
      <div className="dfp-root">
        {switchBar}
        <InsightsPanel loadInsights={loadInsights} t={t} />
      </div>
    );
  }

  if (dayOpen && selected !== undefined) {
    return (
      <div className="dfp-root">
        <DayView
          day={dayData}
          phase={dayPhase}
          error={dayError === '' ? '' : humanize(dayError, t)}
          t={t}
          onBack={() => setDayOpen(false)}
          onPrev={() => pick(shiftDayKey(selected, -1))}
          onNext={() => pick(shiftDayKey(selected, 1))}
          onRefresh={refresh}
          onRetry={() => setDayNonce((value) => value + 1)}
        />
      </div>
    );
  }

  // The control's tabs name `<id>-<value>-panel`; give the shown view that id.
  const panelProps = { id: `dayflow-view-${view}-panel`, role: 'tabpanel' as const };

  return (
    <div className="dfp-root">
      {switchBar}
      {view === 'week' ? (
        <WeekView
          {...panelProps}
          data={weekData}
          phase={weekPhase}
          error={humanize(weekError, t)}
          t={t}
          today={weekData?.today ?? todayKey()}
          selected={selected}
          onPrevWeek={() => setWeekAnchor((current) => shiftWeekKey(current ?? weekData?.week_start ?? todayKey(), -1))}
          onNextWeek={() => setWeekAnchor((current) => shiftWeekKey(current ?? weekData?.week_start ?? todayKey(), 1))}
          onThisWeek={goThisWeek}
          onPick={pick}
          onRefresh={refresh}
          onRetry={() => setWeekNonce((value) => value + 1)}
        />
      ) : (
        <MonthView
          {...panelProps}
          data={monthData}
          phase={monthPhase}
          error={humanize(monthError, t)}
          t={t}
          month={monthData?.month ?? month}
          today={monthData?.today ?? todayKey()}
          selected={selected}
          onPrevMonth={() => {
            setDayOpen(false);
            setSelected(undefined);
            setMonth(shiftMonthKey(monthData?.month ?? month, -1));
          }}
          onNextMonth={() => {
            setDayOpen(false);
            setSelected(undefined);
            setMonth(shiftMonthKey(monthData?.month ?? month, 1));
          }}
          onToday={goToday}
          onPick={pick}
          onRefresh={refresh}
          onRetry={() => setMonthNonce((value) => value + 1)}
        />
      )}
    </div>
  );
}
