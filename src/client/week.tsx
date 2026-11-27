/**
 * The week swim-lane view: seven day columns over a shared hour axis, each
 * activity drawn as a card placed at its own time and coloured by category.
 *
 * This mirrors Dayflow's own weekly timeline rather than inventing a new one.
 * The axis starts at the first activity (or 08:00 on an empty week) so a normal
 * workday fills the pane instead of a 4 AM-to-midnight strip of blank space.
 * @module dsh-plugin-dayflow/client/week
 */

import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { PanelDay, PanelWeek } from '../panel-contract.js';
import {
  compactGoalText,
  dayLabel,
  formatClock,
  formatDuration,
  formatHour,
  goalMarkerText,
  layoutDayCards,
  panelLanguage,
  ratingDots,
  ratingsMarkerText,
  weekRangeLabel,
} from './format.js';
import type { Translate } from './format.js';
import { AppBadge } from './app-badge.js';
import { HoverCard } from './hover-card.js';
import type { Phase } from './types.js';

/** Pixels per minute; a 60-minute card is 60px tall at the default zoom. */
const MINUTES_PER_PIXEL_AT_ONE = 1;
/** Minimum zoom so a whole workday still fits a short pane. */
const MIN_ZOOM = 0.55;
/** Maximum zoom so one hour is comfortably readable. */
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

/** Props for the week view. */
export interface WeekViewProps {
  data: PanelWeek | undefined;
  phase: Phase;
  error: string;
  t: Translate;
  /** The Dayflow day containing now. */
  today: string;
  /** The day whose detail is open, when one is. */
  selected: string | undefined;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  onPick: (date: string) => void;
  onRefresh: () => void;
  onRetry: () => void;
  /** Identity the view-switch tabs point at. */
  id?: string;
  role?: 'tabpanel';
}

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
const MINUS_GLYPH = <path d="M4 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />;
const PLUS_GLYPH = (
  <path d="M8 4v8M4 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
);

function iconButton(path: ReactNode, label: string, onClick: () => void, disabled = false): ReactNode {
  return (
    <button
      type="button"
      className="dfp-icon-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {path}
      </svg>
    </button>
  );
}

/** The hour gridline labels for the visible span. */
function hourMarks(startHour: number, endHour: number): number[] {
  const marks: number[] = [];
  for (let hour = startHour; hour <= endHour; hour += 1) marks.push(hour);
  return marks;
}

/** One day's column header: weekday, date, and today's ring. */
function ColumnHead({ day, today, t }: { day: PanelDay; today: string; t: Translate }): ReactNode {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.date);
  const date = match === null ? new Date() : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  const isToday = day.date === today;
  return (
    <div className={`dfp-wk-head${isToday ? ' is-today' : ''}`}>
      <span className="dfp-wk-weekday">{new Intl.DateTimeFormat(panelLanguage(t), { weekday: 'short' }).format(date)}</span>
      <span className="dfp-wk-date">{isToday ? <em>{date.getDate()}</em> : <span>{date.getDate()}</span>}</span>
    </div>
  );
}

/**
 * A column's compact meta line: the day's goal as a chip and its review marks
 * as a row of dots.
 *
 * It renders inside the sticky head row and only when the day carries data, so
 * an empty day keeps the column exactly as tall as its neighbours and nothing
 * ever paints over a swim-lane card. Both halves wrap in a narrow column.
 */
function ColumnMeta({ day, t }: { day: PanelDay; t: Translate }): ReactNode {
  const goal = day.goal;
  const goalLabel = goal !== undefined && goal !== null ? goalMarkerText(goal, t) : '';
  const goalText = goal !== undefined && goal !== null ? compactGoalText(goal, t) : '';
  const ratings = day.ratings ?? [];
  const dots = ratingDots(ratings);
  if (goalLabel === '' && dots.length === 0) return null;
  const ratingsLabel = dots.length > 0 ? ratingsMarkerText(ratings, t) : '';
  return (
    <div className="dfp-week-meta">
      {goalLabel !== '' && (
        <span className="dfp-week-goal" role="img" aria-label={goalLabel} title={goalLabel}>
          <span className="dfp-goal-marker" aria-hidden="true" />
          {goalText !== '' && <span className="dfp-week-goal-text">{goalText}</span>}
        </span>
      )}
      {dots.length > 0 && (
        <span className="dfp-rating-dots" role="img" aria-label={ratingsLabel} title={ratingsLabel}>
          {dots.map((dot, index) => (
            <span
              key={`${dot.rating}-${index}`}
              className="dfp-rating-dot"
              style={{ background: dot.color }}
            />
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * Render the week.
 * @param props - the week payload, navigation, and selection.
 * @returns the swim-lane view.
 */
export function WeekView(props: WeekViewProps): ReactNode {
  const { data, phase, error, t, today, selected, onPrevWeek, onNextWeek, onThisWeek, onPick, onRefresh, onRetry } =
    props;
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<{ card: PanelDay['cards'][number]; day: PanelDay; rect: DOMRect } | undefined>(
    undefined,
  );
  const canHover = useMemo(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);
  const bodyRef = useRef<HTMLDivElement>(null);

  const { startHour, endHour } = useMemo(() => {
    let earliest = 12;
    let latest = 18;
    for (const day of data?.days ?? []) {
      for (const card of day.cards) {
        const start = new Date(card.start);
        const end = new Date(card.end);
        earliest = Math.min(earliest, start.getHours() + start.getMinutes() / 60);
        latest = Math.max(latest, end.getHours() + end.getMinutes() / 60);
      }
    }
    return { startHour: Math.max(0, Math.floor(earliest) - 1), endHour: Math.min(24, Math.ceil(latest) + 1) };
  }, [data]);

  const colors = useMemo(() => {
    const map = new Map<string, string>();
    for (const day of data?.days ?? []) {
      for (const category of day.categories) if (!map.has(category.name)) map.set(category.name, category.color_hex);
    }
    return map;
  }, [data]);

  const legend = useMemo(() => {
    const totals = new Map<string, { name: string; color_hex: string; minutes: number }>();
    for (const day of data?.days ?? []) {
      for (const category of day.categories) {
        const current = totals.get(category.name);
        if (current === undefined) totals.set(category.name, { ...category });
        else current.minutes += category.minutes;
      }
    }
    return [...totals.values()].sort((left, right) => right.minutes - left.minutes);
  }, [data]);

  const minutesPerPixel = 1 / (zoom * MINUTES_PER_PIXEL_AT_ONE);
  const spanMinutes = (endHour - startHour) * 60;
  const bodyHeight = spanMinutes / minutesPerPixel;
  const marks = hourMarks(startHour, endHour);
  const weekMinutes = (data?.days ?? []).reduce((sum, day) => sum + day.tracked_minutes, 0);

  return (
    <div className="dfp-view dfp-week" id={props.id} role={props.role}>
      <div className="dfp-month-head">
        {iconButton(CHEVRON_LEFT, t('prevWeek'), onPrevWeek)}
        <div className="dfp-month-heading">
          <span className="dfp-month-label">
            {data === undefined ? t('loading') : weekRangeLabel(data.week_start, data.week_end, t)}
          </span>
          <span className="dfp-month-sub">
            {data === undefined ? '' : `${formatDuration(weekMinutes)} ${t('trackedWeek')}`}
          </span>
        </div>
        {iconButton(CHEVRON_RIGHT, t('nextWeek'), onNextWeek)}
        <span className="dfp-spacer" />
        <button type="button" className="dfp-today-button" onClick={onThisWeek}>
          {t('thisWeek')}
        </button>
        {iconButton(MINUS_GLYPH, t('zoomOut'), () => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP)), zoom <= MIN_ZOOM)}
        {iconButton(PLUS_GLYPH, t('zoomIn'), () => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP)), zoom >= MAX_ZOOM)}
        {iconButton(REFRESH_GLYPH, t('refresh'), onRefresh)}
      </div>

      {legend.length > 0 && (
        <div className="dfp-legend dfp-week-legend">
          {legend.map((category) => (
            <span key={category.name} className="dfp-legend-item">
              <span className="dfp-dot" style={{ background: category.color_hex }} />
              {category.name}
            </span>
          ))}
        </div>
      )}

      {phase === 'loading' && data === undefined && <div className="dfp-state">{t('loading')}</div>}
      {phase === 'error' && data === undefined && (
        <div className="dfp-state">
          <span className="dfp-state-title">{t('error')}</span>
          <span>{error}</span>
          <button type="button" className="dfp-today-button" onClick={onRetry}>
            {t('retry')}
          </button>
        </div>
      )}

      {data !== undefined && (
        <div className="dfp-week-scroll" ref={bodyRef}>
          <div className="dfp-week-headrow">
            <span className="dfp-week-corner" aria-hidden="true" />
            {data.days.map((day) => (
              <div key={day.date} className={`dfp-week-colhead${day.date === today ? ' is-today' : ''}${day.date === selected ? ' is-selected' : ''}`}>
                <ColumnHead day={day} today={today} t={t} />
                <ColumnMeta day={day} t={t} />
              </div>
            ))}
          </div>
          <div className="dfp-week-grid" style={{ height: bodyHeight }}>
            <div className="dfp-week-axis" aria-hidden="true">
              {marks.map((hour) => (
                <span key={hour} className="dfp-week-hour" style={{ top: ((hour - startHour) * 60) / minutesPerPixel }}>
                  {formatHour(hour, panelLanguage(t))}
                </span>
              ))}
            </div>
            {data.days.map((day) => {
              const placed = layoutDayCards(day.cards);
              return (
                <section key={day.date} className={`dfp-week-col${day.date === today ? ' is-today' : ''}${day.date === selected ? ' is-selected' : ''}`}>
                  <div className="dfp-week-lanes">
                    {marks.map((hour) => (
                      <span
                        key={hour}
                        className="dfp-week-line"
                        style={{ top: ((hour - startHour) * 60) / minutesPerPixel }}
                      />
                    ))}
                    {placed.map(({ card, topMinutes, heightMinutes, lane, lanes }) => (
                      <button
                        key={card.record_id}
                        type="button"
                        className={`dfp-week-card${heightMinutes / minutesPerPixel > 30 ? ' is-tall' : ''}`}
                        style={{
                          top: (topMinutes - startHour * 60) / minutesPerPixel,
                          height: heightMinutes / minutesPerPixel,
                          left: `calc(${(lane / lanes) * 100}% + 2px)`,
                          width: `calc(${100 / lanes}% - 4px)`,
                          borderLeftColor: colors.get(card.category) ?? 'var(--dsw-alias-border-l3)',
                          background: `${colors.get(card.category) ?? '#A0AEC0'}1f`,
                        }}
                        onClick={() => onPick(day.date)}
                        onMouseEnter={
                          canHover
                            ? (event) => setHover({ card, day, rect: event.currentTarget.getBoundingClientRect() })
                            : undefined
                        }
                        onMouseLeave={canHover ? () => setHover(undefined) : undefined}
                      >
                        <span className="dfp-week-card-head">
                          {card.apps !== undefined && card.apps[0] !== undefined && (
                            <AppBadge
                              domain={card.apps[0]}
                              color={colors.get(card.category) ?? 'var(--dsw-alias-border-l3)'}
                              size={11}
                              className="dfp-week-card-badge"
                            />
                          )}
                          <span className="dfp-week-card-title">{card.title === '' ? t('untitled') : card.title}</span>
                        </span>
                        {heightMinutes / minutesPerPixel > 44 && card.summary !== '' && (
                          <span className="dfp-week-card-summary">{card.summary}</span>
                        )}
                      </button>
                    ))}
                    {placed.length === 0 && day.last_capture_at === undefined && (
                      <span className="dfp-week-empty">{t('stateNoData')}</span>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {hover !== undefined && (
        <HoverCard anchor={hover.rect}>
          <div className="dfp-hc-head">
            <span className="dfp-hc-title">{dayLabel(hover.day.date, today, t)}</span>
            <span className="dfp-hc-total">{formatDuration(hover.card.duration_minutes)}</span>
          </div>
          <div className="dfp-hc-cat">
            <span className="dfp-dot" style={{ background: colors.get(hover.card.category) ?? '#A0AEC0' }} />
            <span className="dfp-hc-cat-name">{hover.card.title}</span>
          </div>
          <div className="dfp-hc-muted">
            {formatClock(hover.card.start, panelLanguage(t))} – {formatClock(hover.card.end, panelLanguage(t))}
            {hover.card.apps !== undefined && hover.card.apps.length > 0 && ` · ${hover.card.apps.join(' · ')}`}
          </div>
          {hover.card.summary !== '' && <div className="dfp-hc-note">{hover.card.summary}</div>}
        </HoverCard>
      )}
    </div>
  );
}
