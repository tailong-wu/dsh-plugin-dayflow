/**
 * The month calendar: one segmented ring per day, a category legend, and the
 * hover card that describes a day or a single ring segment.
 * @module dsh-plugin-dayflow/client/month
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { PanelDay, PanelMonth } from '../panel-contract.js';
import {
  compactDuration,
  formatClock,
  formatDuration,
  formatShare,
  goalDetail,
  goalMarkerText,
  leadingBlanks,
  monthLabel,
  panelLanguage,
  ratingColor,
  ratingDots,
  ratingLabel,
  ratingTimeRange,
  ratingsMarkerText,
  shortDate,
  weekdayLabels,
} from './format.js';
import type { Translate } from './format.js';
import { HoverCard } from './hover-card.js';
import { SegmentedRing } from './ring.js';
import type { RingState } from './ring.js';
import { dayState } from './state.js';
import type { Phase } from './types.js';

const CHEVRON_LEFT = (
  <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
);
const CHEVRON_RIGHT = (
  <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
);
const REFRESH_GLYPH = (
  <path
    d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

/** A pointer's hover target: one cell, optionally narrowed to one arc. */
interface HoverState {
  readonly date: string;
  readonly rect: DOMRect;
  readonly category?: string;
}

/** Props for the month view. */
export interface MonthViewProps {
  /** The month payload, once loaded. */
  data: PanelMonth | undefined;
  phase: Phase;
  error: string;
  t: Translate;
  /** The month being shown, `YYYY-MM`. */
  month: string;
  /** The Dayflow day containing now. */
  today: string;
  /** The day whose detail is open, when the panel is in day view. */
  selected: string | undefined;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onPick: (date: string) => void;
  onRefresh: () => void;
  onRetry: () => void;
  /** Identity the view-switch tabs point at. */
  id?: string;
  role?: 'tabpanel';
}

function stateText(state: RingState, t: Translate): string {
  switch (state) {
    case 'recorded':
      return t('tracked');
    case 'pending':
      return t('statePending');
    case 'empty':
      return t('stateEmpty');
    default:
      return t('stateNoData');
  }
}

function stateHint(state: RingState, t: Translate): string {
  switch (state) {
    case 'pending':
      return t('analyzingHint');
    case 'empty':
      return t('emptyDayHint');
    case 'no-data':
      return t('noDataHint');
    default:
      return '';
  }
}

function iconButton(path: ReactNode, label: string, onClick: () => void): ReactNode {
  return (
    <button type="button" className="dfp-icon-button" aria-label={label} title={label} onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {path}
      </svg>
    </button>
  );
}

/** The hover card's day summary. */
function DayHover({ day, t }: { day: PanelDay; t: Translate }): ReactNode {
  const state = dayState(day);
  const top = [...day.cards].sort((left, right) => right.duration_minutes - left.duration_minutes).slice(0, 2);
  // The goal and review marks are optional on the wire, so a host that does not
  // send them yet leaves the hover card exactly as it was before.
  const goal = day.goal;
  const goalText = goal !== undefined && goal !== null ? goalDetail(goal, t) : '';
  const ratings = day.ratings ?? [];
  const language = panelLanguage(t);
  return (
    <>
      <div className="dfp-hc-head">
        <span className="dfp-hc-title">{shortDate(day.date, t)}</span>
        <span className="dfp-hc-total">
          {day.tracked_minutes > 0 ? formatDuration(day.tracked_minutes) : stateText(state, t)}
        </span>
      </div>
      {goalText !== '' && (
        <div className="dfp-hc-goal">
          <span className="dfp-hc-label">{t('goalTitle')}</span>
          <span className="dfp-hc-goal-text">{goalText}</span>
        </div>
      )}
      {ratings.length > 0 && (
        <div className="dfp-hc-ratings">
          {ratings.map((rating, index) => {
            const range = ratingTimeRange(rating.start, rating.end, language);
            return (
              <div key={`${rating.start}-${index}`} className="dfp-hc-rating">
                <span className="dfp-dot" style={{ background: ratingColor(rating.rating) }} />
                <span className="dfp-hc-rating-label">{ratingLabel(rating.rating, t)}</span>
                {range !== '' && <span className="dfp-hc-muted">{range}</span>}
              </div>
            );
          })}
        </div>
      )}
      {day.categories.length > 0 && (
        <div className="dfp-hc-cats">
          {day.categories.map((category) => (
            <span key={category.name} className="dfp-hc-cat">
              <span className="dfp-dot" style={{ background: category.color_hex }} />
              <span className="dfp-hc-cat-name">{category.name}</span>
              <span className="dfp-hc-muted">
                {formatDuration(category.minutes)} · {formatShare(category.share)}
              </span>
            </span>
          ))}
        </div>
      )}
      {top.length > 0 && (
        <div className="dfp-hc-events">
          {top.map((card) => (
            <span key={card.record_id} className="dfp-hc-event">
              <span className="dfp-hc-muted">{formatClock(card.start, language)}</span> {card.title}
            </span>
          ))}
        </div>
      )}
      {state !== 'recorded' && <div className="dfp-hc-note">{stateHint(state, t)}</div>}
      <div className="dfp-hc-hint">{t('openDay')}</div>
    </>
  );
}

/** The hover card's single-category summary. */
function CategoryHover({ day, name, t }: { day: PanelDay; name: string; t: Translate }): ReactNode {
  const category = day.categories.find((entry) => entry.name === name);
  if (category === undefined) return <DayHover day={day} t={t} />;
  const cards = day.cards.filter((card) => card.category === name).sort((left, right) => right.duration_minutes - left.duration_minutes);
  return (
    <>
      <div className="dfp-hc-head">
        <span className="dfp-hc-title">
          <span className="dfp-dot" style={{ background: category.color_hex }} />
          {category.name}
        </span>
        <span className="dfp-hc-total">
          {formatDuration(category.minutes)} · {formatShare(category.share)}
        </span>
      </div>
      {cards[0] !== undefined && (
        <div className="dfp-hc-events">
          <span className="dfp-hc-event">
            <span className="dfp-hc-muted">{formatClock(cards[0].start, panelLanguage(t))}</span> {cards[0].title}
          </span>
        </div>
      )}
      <div className="dfp-hc-hint">{t('segmentHint')}</div>
    </>
  );
}

/** The month's shared color key. */
function legendOf(data: PanelMonth | undefined): { name: string; color_hex: string; minutes: number }[] {
  if (data === undefined) return [];
  const totals = new Map<string, { name: string; color_hex: string; minutes: number }>();
  for (const day of data.days) {
    for (const category of day.categories) {
      const current = totals.get(category.name);
      if (current === undefined) totals.set(category.name, { name: category.name, color_hex: category.color_hex, minutes: category.minutes });
      else current.minutes += category.minutes;
    }
  }
  return [...totals.values()].sort((left, right) => right.minutes - left.minutes);
}

/**
 * Render the calendar.
 * @param props - month data, navigation, and the hover-card wiring.
 * @returns the month view.
 */
export function MonthView(props: MonthViewProps): ReactNode {
  const { data, phase, error, t, month, today, selected, onPrevMonth, onNextMonth, onToday, onPick, onRefresh, onRetry } = props;
  const [hover, setHover] = useState<HoverState | undefined>(undefined);
  const canHover = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    [],
  );
  const legend = useMemo(() => legendOf(data), [data]);
  const blanks = leadingBlanks(month);
  const weekdays = weekdayLabels(t);
  const recordedDays = data?.days.filter((day) => day.tracked_minutes > 0).length ?? 0;
  const hoveredDay = hover === undefined ? undefined : data?.days.find((day) => day.date === hover.date);

  return (
    <div className="dfp-view" id={props.id} role={props.role}>
      <div className="dfp-month-head">
        {iconButton(CHEVRON_LEFT, t('prevMonth'), onPrevMonth)}
        <div className="dfp-month-heading">
          <span className="dfp-month-label">{monthLabel(month, t)}</span>
          <span className="dfp-month-sub">
            {t(recordedDays === 1 ? 'daysRecordedOne' : 'daysRecorded', { count: recordedDays })}
          </span>
        </div>
        {iconButton(CHEVRON_RIGHT, t('nextMonth'), onNextMonth)}
        <span className="dfp-spacer" />
        <button type="button" className="dfp-today-button" onClick={onToday}>
          {t('today')}
        </button>
        {iconButton(REFRESH_GLYPH, t('refresh'), onRefresh)}
      </div>

      {phase === 'error' && data === undefined && (
        <div className="dfp-state">
          <span className="dfp-state-title">{t('error')}</span>
          <span>{error}</span>
          <button type="button" className="dfp-today-button" onClick={onRetry}>
            {t('retry')}
          </button>
        </div>
      )}

      {phase === 'loading' && data === undefined && <div className="dfp-state">{t('loading')}</div>}

      {data !== undefined && (
        <>
          <div className="dfp-weekdays" aria-hidden="true">
            {weekdays.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="dfp-grid">
            {Array.from({ length: blanks }, (_, index) => (
              <span key={`blank-${index}`} className="dfp-blank" />
            ))}
            {data.days.map((day) => {
              const state = dayState(day);
              const accessible =
                day.tracked_minutes > 0 ? formatDuration(day.tracked_minutes) : stateText(state, t);
              const goal = day.goal;
              const goalText = goal !== undefined && goal !== null ? goalMarkerText(goal, t) : '';
              const ratings = day.ratings ?? [];
              const dots = ratingDots(ratings);
              const ratingsText = ratings.length > 0 ? ratingsMarkerText(ratings, t) : '';
              const classes = ['dfp-cell', `is-${state}`];
              if (day.date === today) classes.push('is-today');
              if (day.date === selected) classes.push('is-selected');
              const label = [shortDate(day.date, t), accessible, goalText, ratingsText]
                .filter((part) => part !== '')
                .join(' · ');
              return (
                <button
                  key={day.date}
                  type="button"
                  className={classes.join(' ')}
                  aria-label={label}
                  aria-current={day.date === today ? 'date' : undefined}
                  onClick={() => onPick(day.date)}
                  onMouseEnter={
                    canHover
                      ? (event) => setHover({ date: day.date, rect: event.currentTarget.getBoundingClientRect() })
                      : undefined
                  }
                  onMouseLeave={canHover ? () => setHover(undefined) : undefined}
                >
                  <span className="dfp-cell-ring">
                    <SegmentedRing
                      categories={day.categories}
                      state={state}
                      activeCategory={hover?.date === day.date ? hover.category : undefined}
                      onSegmentEnter={
                        canHover
                          ? (name) =>
                              setHover((current) =>
                                current !== undefined && current.date === day.date ? { ...current, category: name } : current,
                              )
                          : undefined
                      }
                      onSegmentLeave={
                        canHover
                          ? () =>
                              setHover((current) =>
                                current === undefined ? current : { date: current.date, rect: current.rect },
                              )
                          : undefined
                      }
                    />
                    <span className="dfp-cell-center">
                      <span className="dfp-cell-date">{Number(day.date.slice(8))}</span>
                      {day.tracked_minutes > 0 && (
                        <span className="dfp-cell-total">{compactDuration(day.tracked_minutes)}</span>
                      )}
                    </span>
                  </span>
                  {(goalText !== '' || dots.length > 0) && (
                    <span className="dfp-cell-meta" aria-hidden="true">
                      {goalText !== '' && <span className="dfp-goal-marker" title={goalText} />}
                      {dots.length > 0 && (
                        <span className="dfp-rating-dots" title={ratingsText}>
                          {dots.map((dot, index) => (
                            <span
                              key={`${dot.rating}-${index}`}
                              className="dfp-rating-dot"
                              style={{ background: dot.color }}
                            />
                          ))}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {legend.length > 0 && (
            <div className="dfp-legend" aria-label={t('legendTitle')}>
              {legend.map((category) => (
                <span key={category.name} className="dfp-legend-item">
                  <span className="dfp-dot" style={{ background: category.color_hex }} />
                  {category.name}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {hover !== undefined && hoveredDay !== undefined && (
        <HoverCard anchor={hover.rect}>
          {hover.category === undefined ? (
            <DayHover day={hoveredDay} t={t} />
          ) : (
            <CategoryHover day={hoveredDay} name={hover.category} t={t} />
          )}
        </HoverCard>
      )}
    </div>
  );
}
