/**
 * Panel styles, expressed only in the harness's design tokens so the panel
 * follows the active theme and the client's own typography.
 *
 * The ring sizes respond to the panel's own width through a container query,
 * because the right Sidebar can be docked, split, or fullscreen. Hover styling
 * is limited to fine pointers; touch devices open a day on tap instead.
 * @module dsh-plugin-dayflow/client/styles
 */

const STYLE_ID = 'dsh-plugin-dayflow-panel';

export const PANEL_CSS = `
.dfp-header-button {
  color: var(--dsw-alias-label-secondary);
}

.dfp-header-button:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
}

/* The conversation header runs out of room on narrow viewports; the tooltip
 * still names the action, so the label collapses to the icon there. */
@media (max-width: 720px) {
  .dfp-header-button .dfp-toggle-label {
    display: none;
  }
  .dfp-header-button {
    padding: 0 6px;
  }
}

.dfp-root {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
}

.dfp-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--dsh-scrollbar-thumb, transparent) transparent;
}

.dfp-spacer {
  flex: 1;
}

/* ── Toolbar ─────────────────────────────────────────────────────────── */

.dfp-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.dfp-icon-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.dfp-icon-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}

.dfp-today-button {
  height: 24px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  white-space: nowrap;
}

.dfp-today-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dfp-today-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}

/* ── Month header ────────────────────────────────────────────────────── */

.dfp-month-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 6px 6px 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dfp-month-heading {
  flex: 1;
  min-width: 0;
  padding-left: 2px;
}

.dfp-month-label {
  display: block;
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dfp-month-sub {
  display: block;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Calendar grid ───────────────────────────────────────────────────── */

.dfp-weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  padding: 8px 6px 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}

.dfp-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px 1px;
  padding: 0 6px 8px;
}

.dfp-blank {
  min-height: 40px;
}

.dfp-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 2px 0 3px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.dfp-cell:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: -2px;
}

.dfp-cell.is-selected {
  background: var(--dsw-alias-interactive-bg-hover);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l3);
}

.dfp-cell.is-today .dfp-cell-date {
  font-weight: 600;
}

.dfp-cell.is-today .dfp-cell-ring::after {
  content: '';
  position: absolute;
  inset: -2px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 50%;
  pointer-events: none;
}

.dfp-cell.is-no-data .dfp-cell-date {
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.75;
}

.dfp-cell-ring {
  position: relative;
  width: 34px;
  height: 34px;
  flex: none;
}

.dfp-cell-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.dfp-cell-date {
  font-size: 11px;
  line-height: 13px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.dfp-cell-total {
  font-size: 8px;
  line-height: 10px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

@container (min-width: 380px) {
  .dfp-cell-ring {
    width: 38px;
    height: 38px;
  }
  .dfp-cell-date {
    font-size: 12px;
    line-height: 14px;
  }
  .dfp-cell-total {
    font-size: 9px;
    line-height: 11px;
  }
}

@container (min-width: 470px) {
  .dfp-cell-ring {
    width: 44px;
    height: 44px;
  }
  .dfp-cell-date {
    font-size: 12px;
  }
  .dfp-cell-total {
    font-size: 9.5px;
  }
}

@container (min-width: 560px) {
  .dfp-cell-ring {
    width: 52px;
    height: 52px;
  }
  .dfp-cell-date {
    font-size: 13px;
    line-height: 15px;
  }
  .dfp-cell-total {
    font-size: 10px;
    line-height: 12px;
  }
}

@container (min-width: 640px) {
  .dfp-cell-ring {
    width: 58px;
    height: 58px;
  }
  .dfp-cell-date {
    font-size: 14px;
    line-height: 16px;
  }
  .dfp-cell-total {
    font-size: 10.5px;
    line-height: 12px;
  }
}

@container (min-width: 760px) {
  .dfp-cell-ring {
    width: 64px;
    height: 64px;
  }
  .dfp-cell-date {
    font-size: 15px;
    line-height: 17px;
  }
}

@media (hover: hover) and (pointer: fine) {
  .dfp-cell:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

/* ── The ring ────────────────────────────────────────────────────────── */

.dfp-ring {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.dfp-ring-track {
  stroke: var(--dsw-alias-border-l3);
  opacity: 0.5;
}

.dfp-ring--empty .dfp-ring-track {
  stroke: var(--dsw-alias-border-l2);
  opacity: 0.9;
}

.dfp-ring--pending .dfp-ring-track {
  stroke: var(--dsw-alias-state-warn-primary);
  opacity: 0.55;
  stroke-dasharray: 2.5 2.5;
  animation: dfp-ring-pulse 2.4s ease-in-out infinite;
}

.dfp-ring--no-data .dfp-ring-track {
  opacity: 0.35;
  stroke-dasharray: 1 4;
}

.dfp-ring-seg {
  pointer-events: stroke;
  transition: opacity 120ms ease, filter 120ms ease;
}

.dfp-ring-seg.is-active {
  filter: brightness(1.12);
}

.dfp-ring:has(.dfp-ring-seg.is-active) .dfp-ring-seg:not(.is-active) {
  opacity: 0.5;
}

@keyframes dfp-ring-pulse {
  0%, 100% {
    opacity: 0.35;
  }
  50% {
    opacity: 0.7;
  }
}

/* ── View switch ─────────────────────────────────────────────────────── */

.dfp-view-switch {
  display: inline-flex;
  flex: none;
  margin-right: 4px;
}

/* The switch gets its own row, so the three views stay reachable at any
 * sidebar width; the track can scroll if a language's labels still overflow. */
.dfp-subhead {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  overflow-x: auto;
  scrollbar-width: thin;
}

.dfp-subhead .dfp-view-switch {
  margin-right: 0;
}

.dfp-view-switch .tab {
  padding: 0 10px;
  font-size: 12px;
}

/* ── Week swim lanes ─────────────────────────────────────────────────── */

.dfp-week {
  overflow: hidden;
}

.dfp-week-legend {
  border-top: 0;
  padding-top: 6px;
  padding-bottom: 6px;
}

.dfp-week-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--dsh-scrollbar-thumb, transparent) transparent;
}

.dfp-week-grid,
.dfp-week-headrow {
  display: grid;
  grid-template-columns: 44px repeat(7, minmax(0, 1fr));
  position: relative;
  min-width: 560px;
}

/* The first hour label is centered on the grid's top edge, so the grid needs
 * headroom or the sticky head row paints over it. Margin, not padding: absolute
 * children place against the padding box, so padding would not move them. */
.dfp-week-grid {
  margin-top: 9px;
}

.dfp-week-headrow {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--dsw-alias-bg-layer-1);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dfp-week-corner {
  display: block;
}

.dfp-week-axis {
  position: relative;
  grid-column: 1;
  grid-row: 1;
}

.dfp-week-hour {
  position: absolute;
  right: 8px;
  transform: translateY(-50%);
  font-size: 10px;
  line-height: 12px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dfp-week-col {
  grid-row: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-left: 1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2));
}

.dfp-week-col.is-today {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, transparent);
}

.dfp-week-colhead {
  padding: 5px 2px 6px;
  text-align: center;
  min-width: 0;
  border-left: 1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2));
}

.dfp-week-colhead.is-today {
  background: var(--dsw-alias-bg-layer-3);
}

.dfp-wk-head {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.dfp-wk-weekday {
  font-size: 10px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary);
}

.dfp-wk-date {
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.dfp-wk-date em {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-foreground);
  font-style: normal;
  font-weight: 600;
}


.dfp-week-colhead.is-selected,
.dfp-week-col.is-selected .dfp-week-lanes {
  box-shadow: inset 0 0 0 1.5px var(--dsw-alias-border-l4);
}

.dfp-week-lanes {
  position: relative;
  flex: 1;
  min-height: 0;
}

.dfp-week-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2));
  opacity: 0.6;
  pointer-events: none;
}

.dfp-week-card {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 18px;
  padding: 2px 4px;
  border: 0;
  border-left: 2.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-primary);
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  transition: filter 120ms ease;
}

.dfp-week-card:hover {
  filter: brightness(0.97) saturate(1.15);
}

.dfp-week-card:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: -1px;
}

.dfp-week-card-title {
  font-size: 11px;
  line-height: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.dfp-week-card-summary {
  font-size: 10px;
  line-height: 13px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.dfp-week-empty {
  position: absolute;
  top: 12px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.7;
}

/* ── Site badges ─────────────────────────────────────────────────────── */

.dfp-badge {
  display: inline-block;
  flex: none;
  object-fit: contain;
  background: var(--dsw-alias-bg-layer-3);
  vertical-align: -2px;
}

.dfp-badge-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-primary-foreground);
  font-weight: 600;
  line-height: 1;
  text-transform: uppercase;
}

.dfp-week-card-head {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

/* The title is the only child allowed to shrink, so a badge never squeezes it
 * into an ellipsis of one character. */
.dfp-week-card-head .dfp-week-card-title {
  flex: 1;
  min-width: 0;
}

/* A card tall enough for two lines says more than an ellipsis does. */
.dfp-week-card.is-tall .dfp-week-card-title {
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.dfp-week-card-badge {
  border-radius: 3px;
}

.dfp-event-badge {
  border-radius: 4px;
}

/* ── Legend ──────────────────────────────────────────────────────────── */

.dfp-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.dfp-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.dfp-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex: none;
}

/* ── Hover card ──────────────────────────────────────────────────────── */

.dfp-hovercard {
  position: fixed;
  z-index: 9000;
  max-width: 260px;
  min-width: 170px;
  padding: 9px 11px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, 0.14));
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 17px;
  pointer-events: none;
}

.dfp-hc-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.dfp-hc-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-weight: 600;
}

.dfp-hc-total {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.dfp-hc-cats {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 6px;
}

.dfp-hc-cat {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dfp-hc-cat-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfp-hc-muted {
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dfp-hc-events {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

.dfp-hc-event {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}

.dfp-hc-note {
  margin-top: 8px;
  color: var(--dsw-alias-label-tertiary);
}

.dfp-hc-hint {
  margin-top: 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

/* ── Day header ──────────────────────────────────────────────────────── */

.dfp-day-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 6px 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dfp-day-heading {
  flex: 1;
  min-width: 0;
  padding-left: 2px;
}

.dfp-day-title {
  display: block;
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dfp-day-sub {
  display: block;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Category filters ────────────────────────────────────────────────── */

.dfp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
}

.dfp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: 24px;
  padding: 0 9px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 18px;
  cursor: pointer;
  white-space: nowrap;
}

.dfp-chip:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dfp-chip:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}

.dfp-chip.is-active {
  background: var(--dsw-alias-label-primary);
  border-color: transparent;
  color: var(--dsw-alias-bg-layer-3);
}

.dfp-chip-meta {
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dfp-chip.is-active .dfp-chip-meta {
  color: inherit;
  opacity: 0.75;
}

.dfp-chip-clear {
  border-style: dashed;
}

/* ── Goal and review marks ───────────────────────────────────────────── */

.dfp-goal {
  padding: 9px 12px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dfp-goal-title,
.dfp-ratings-title {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
}

.dfp-goal-meta {
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 17px;
  font-variant-numeric: tabular-nums;
}

.dfp-goal-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 5px;
}

.dfp-cat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dfp-goal-empty {
  margin: 0;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 17px;
}

.dfp-ratings {
  padding: 8px 0 5px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dfp-ratings-title {
  padding: 0 12px;
}

.dfp-rating-list {
  list-style: none;
  margin: 2px 0 0;
  padding: 0;
}

.dfp-rating {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 6px;
  padding: 3px 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dfp-rating-time {
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.dfp-rating-sep {
  opacity: 0.7;
}

.dfp-rating-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-secondary);
}

.dfp-rating-label .dfp-dot {
  width: 6px;
  height: 6px;
}

.dfp-rating-title {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfp-rating-id {
  flex: none;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

/* ── Timeline ────────────────────────────────────────────────────────── */

.dfp-events {
  list-style: none;
  margin: 0;
  padding: 0;
}

.dfp-event {
  display: flex;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2));
}

.dfp-event-time {
  flex: none;
  width: 56px;
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dfp-event-duration {
  display: block;
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.85;
}

.dfp-event-body {
  min-width: 0;
  flex: 1;
}

.dfp-event-title {
  display: block;
  font-size: 13px;
  line-height: 19px;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}

.dfp-event-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 1px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.dfp-event-summary {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── States ──────────────────────────────────────────────────────────── */

.dfp-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 36px 24px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dfp-state-title {
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
}

.dfp-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

.dfp-banner span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfp-note {
  margin: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 17px;
}

/* ── Journal insights ────────────────────────────────────────────────── */

.dfp-insights {
  gap: 10px;
  padding: 10px;
  background:
    radial-gradient(120% 70% at 100% 0%, color-mix(in srgb, var(--dsw-static-blue-500) 7%, transparent), transparent 60%),
    var(--dsw-alias-bg-base);
}

.dfp-insights-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 2px 2px 0;
}

.dfp-insights-heading {
  flex: 1;
  min-width: 0;
}

.dfp-insights-title {
  display: block;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfp-insights-sub {
  display: block;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}

/* One tinted card per source; the accent rides the stripe and the count. */

.dfp-insights-section {
  --dfp-accent: var(--dsw-static-blue-500);
  position: relative;
  overflow: hidden;
  flex: none;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dfp-accent) 3.5%, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--dsw-elevation-soft);
}

.dfp-insights-section::before {
  content: '';
  position: absolute;
  top: 12px;
  bottom: 12px;
  inset-inline-start: 0;
  width: 3px;
  border-radius: 0 999px 999px 0;
  background: var(--dfp-accent);
  opacity: 0.85;
}

.dfp-insights-section.is-tasks {
  --dfp-accent: var(--dsw-static-blue-500);
}

.dfp-insights-section.is-review {
  --dfp-accent: var(--dsw-static-amber-500);
}

.dfp-insights-section.is-memory {
  --dfp-accent: color-mix(in srgb, var(--dsw-static-blue-500) 42%, var(--dsw-static-red-500));
}

.dfp-insights-section.is-reflections {
  --dfp-accent: var(--dsw-static-green-500);
}

.dfp-insights-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px 8px 14px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}

.dfp-insights-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 3px;
  background: var(--dfp-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dfp-accent) 16%, transparent);
}

.dfp-insights-section-title {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfp-insights-count {
  flex: none;
  min-width: 20px;
  height: 18px;
  margin-left: auto;
  padding: 0 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dfp-accent) 14%, transparent);
  color: color-mix(in srgb, var(--dfp-accent) 80%, var(--dsw-alias-label-primary));
  font-size: 11px;
  line-height: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.dfp-insights-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 2px 0 4px;
  list-style: none;
}

.dfp-insights-row {
  padding: 8px 12px 8px 14px;
  transition: background 120ms ease;
}

.dfp-insights-row + .dfp-insights-row {
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}

.dfp-insights-row:hover {
  background: color-mix(in srgb, var(--dfp-accent) 6%, transparent);
}

.dfp-insights-row-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dfp-insights-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 19px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfp-insights-badge {
  display: inline-flex;
  align-items: center;
  flex: none;
  height: 17px;
  padding: 0 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--dfp-accent) 13%, transparent);
  color: color-mix(in srgb, var(--dfp-accent) 78%, var(--dsw-alias-label-primary));
  font-size: 10px;
  line-height: 17px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: lowercase;
}

.dfp-insights-badge.is-warn {
  background: color-mix(in srgb, var(--dsw-static-amber-500) 16%, transparent);
  color: var(--dsw-static-amber-600);
}

/* Kind colours keep the review / memory / reflection badges readable. */

.dfp-insights-badge.is-loop,
.dfp-insights-badge.is-correction {
  background: color-mix(in srgb, var(--dsw-static-amber-500) 15%, transparent);
  color: var(--dsw-static-amber-600);
}

.dfp-insights-badge.is-distillation,
.dfp-insights-badge.is-week {
  background: color-mix(in srgb, var(--dsw-static-blue-500) 14%, transparent);
  color: var(--dsw-static-blue-600);
}

.dfp-insights-badge.is-improvement,
.dfp-insights-badge.is-day,
.dfp-insights-badge.is-preference {
  background: color-mix(in srgb, var(--dsw-static-green-500) 15%, transparent);
  color: color-mix(in srgb, var(--dsw-static-green-500) 70%, var(--dsw-alias-label-primary));
}

.dfp-insights-badge.is-task_proposal {
  background: color-mix(in srgb, var(--dsw-static-blue-500) 42%, var(--dsw-static-red-500) 12%, transparent);
  color: color-mix(in srgb, var(--dsw-static-blue-500) 55%, var(--dsw-static-red-500));
}

.dfp-insights-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 5px;
  margin-top: 3px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dfp-insights-kind {
  color: var(--dsw-alias-label-secondary);
}

.dfp-insights-num,
.dfp-insights-period,
.dfp-insights-target {
  font-variant-numeric: tabular-nums;
}

.dfp-insights-sep {
  opacity: 0.7;
}

.dfp-insights-date {
  display: inline-flex;
  align-items: center;
  height: 17px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  line-height: 17px;
}

.dfp-insights-progress {
  display: block;
  overflow: hidden;
  width: 96px;
  height: 3px;
  margin-top: 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dfp-accent) 16%, transparent);
}

.dfp-insights-progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--dfp-accent), color-mix(in srgb, var(--dfp-accent) 55%, white));
}

.dfp-insights-body {
  display: -webkit-box;
  overflow: hidden;
  margin: 4px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 17px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.dfp-insights-empty {
  margin: 0;
  padding: 9px 12px 9px 14px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 17px;
}

/* The ToDo-style add row under an editable section. */

.dfp-insights-add {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 12px 10px 14px;
}

.dfp-insights-add-input {
  flex: 1;
  min-width: 0;
  height: 27px;
  padding: 0 10px;
  border: 0.5px dashed color-mix(in srgb, var(--dfp-accent) 42%, var(--dsw-alias-border-l2));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
}

.dfp-insights-add-input::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.dfp-insights-add-input:focus-visible {
  border-style: solid;
  border-color: var(--dfp-accent);
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dfp-accent) 16%, transparent);
}

.dfp-insights-add-button {
  flex: none;
  height: 27px;
  padding: 0 12px;
  border: 0.5px solid color-mix(in srgb, var(--dfp-accent) 30%, var(--dsw-alias-border-l2));
  border-radius: 8px;
  background: color-mix(in srgb, var(--dfp-accent) 12%, transparent);
  color: color-mix(in srgb, var(--dfp-accent) 82%, var(--dsw-alias-label-primary));
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.dfp-insights-add-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dfp-accent) 20%, transparent);
}

.dfp-insights-add-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}

.dfp-insights-add-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.dfp-insights-add-error {
  margin: 0;
  padding: 0 12px 8px 14px;
  color: var(--dsw-static-amber-600);
  font-size: 11px;
  line-height: 16px;
}

/* Review decisions and session unlinks.
 *
 * One quiet action row per review item: the kind's forward decision (Keep for
 * a distillation/loop, Accept for an improvement/task proposal) is the tinted
 * primary; Discard stays secondary; "Don't suggest again" is the restrained
 * danger action and opens an inline confirm instead of a browser dialog. The
 * row wraps rather than clips when the right Sidebar is docked narrow. */

.dfp-insights-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
}

.dfp-insights-action {
  height: 23px;
  padding: 0 9px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
  white-space: nowrap;
}

.dfp-insights-action.is-primary {
  border-color: color-mix(in srgb, var(--dfp-accent) 36%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dfp-accent) 13%, transparent);
  color: color-mix(in srgb, var(--dfp-accent) 82%, var(--dsw-alias-label-primary));
  font-weight: 600;
}

.dfp-insights-action.is-danger {
  color: color-mix(in srgb, var(--dsw-static-red-500) 78%, var(--dsw-alias-label-secondary));
}

.dfp-insights-action.is-confirm {
  border-color: color-mix(in srgb, var(--dsw-static-red-500) 42%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-static-red-500) 12%, transparent);
  color: color-mix(in srgb, var(--dsw-static-red-500) 82%, var(--dsw-alias-label-primary));
  font-weight: 600;
}

.dfp-insights-action:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dfp-insights-action.is-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dfp-accent) 22%, transparent);
  color: color-mix(in srgb, var(--dfp-accent) 86%, var(--dsw-alias-label-primary));
}

.dfp-insights-action.is-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-static-red-500) 12%, transparent);
  color: color-mix(in srgb, var(--dsw-static-red-500) 88%, var(--dsw-alias-label-primary));
}

.dfp-insights-action.is-confirm:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-static-red-500) 20%, transparent);
}

.dfp-insights-action:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}

.dfp-insights-action:disabled {
  cursor: default;
  opacity: 0.45;
}

.dfp-insights-working {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dfp-insights-confirm {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
  padding: 5px 8px;
  border: 0.5px solid color-mix(in srgb, var(--dsw-static-red-500) 34%, var(--dsw-alias-border-l1));
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-static-red-500) 7%, transparent);
}

.dfp-insights-confirm-text {
  flex: 1;
  min-width: 116px;
  color: color-mix(in srgb, var(--dsw-static-red-500) 78%, var(--dsw-alias-label-primary));
  font-size: 11px;
  line-height: 16px;
}

.dfp-insights-action-error {
  margin: 0;
  padding: 4px 0 0;
  color: var(--dsw-static-amber-600);
  font-size: 11px;
  line-height: 16px;
}

/* The linked days under a long task: a day chip each with a quiet Unlink. */

.dfp-insights-sessions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dfp-insights-session {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.dfp-insights-session-unlink {
  height: 19px;
  padding: 0 5px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 10.5px;
  line-height: 16px;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  text-underline-offset: 2px;
  white-space: nowrap;
  cursor: pointer;
}

.dfp-insights-session-unlink:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-static-red-500) 10%, transparent);
  color: color-mix(in srgb, var(--dsw-static-red-500) 85%, var(--dsw-alias-label-primary));
}

.dfp-insights-session-unlink:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}

.dfp-insights-session-unlink:disabled {
  cursor: default;
  opacity: 0.45;
}

.dfp-insights-session-error {
  margin: 3px 0 0;
  color: var(--dsw-static-amber-600);
  font-size: 11px;
  line-height: 16px;
}

/* A docked sidebar leaves about 280px; the action row wraps instead of
 * narrowing every button below a readable tap size. */
@container (max-width: 300px) {
  .dfp-insights-actions {
    gap: 4px;
  }

  .dfp-insights-action {
    flex: 1 1 auto;
  }
}

/* The empty journal explains the view instead of showing one bare line. */

.dfp-insights-intro {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--dsw-static-blue-500) 9%, transparent),
      color-mix(in srgb, var(--dsw-static-blue-500) 42%, var(--dsw-static-red-500) 6%, transparent) 52%,
      color-mix(in srgb, var(--dsw-static-green-500) 7%, transparent)
    ),
    var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft);
}

.dfp-insights-intro-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 20px;
}

.dfp-insights-intro-body {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

.dfp-insights-intro-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}

.dfp-insights-intro-item {
  --dfp-accent: var(--dsw-static-blue-500);
  display: flex;
  gap: 9px;
  align-items: flex-start;
}

.dfp-insights-intro-item:nth-child(2) {
  --dfp-accent: var(--dsw-static-amber-500);
}

.dfp-insights-intro-item:nth-child(3) {
  --dfp-accent: color-mix(in srgb, var(--dsw-static-blue-500) 42%, var(--dsw-static-red-500));
}

.dfp-insights-intro-item:nth-child(4) {
  --dfp-accent: var(--dsw-static-green-500);
}

.dfp-insights-intro-item .dfp-insights-badge {
  margin-top: 1px;
}

.dfp-insights-intro-text {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

.dfp-insights-intro-hint {
  margin: 2px 0 0;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  line-height: 17px;
}

/* The capture card offered right after a task add: it asks, previews the
 * matched days, and links them, all in one accent card above the sections. */

.dfp-insights-capture {
  --dfp-accent: var(--dsw-static-blue-500);
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 7px;
  padding: 12px 14px;
  border: 0.5px solid color-mix(in srgb, var(--dfp-accent) 32%, var(--dsw-alias-border-l1));
  border-radius: 12px;
  background:
    linear-gradient(
      155deg,
      color-mix(in srgb, var(--dfp-accent) 10%, transparent),
      color-mix(in srgb, var(--dfp-accent) 3%, transparent) 60%
    ),
    var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft);
}

.dfp-insights-capture-title {
  margin: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfp-insights-capture-body {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

.dfp-insights-capture-summary {
  margin: 0;
  color: color-mix(in srgb, var(--dfp-accent) 78%, var(--dsw-alias-label-primary));
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}

.dfp-insights-capture-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dfp-insights-capture-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 3px 0;
}

.dfp-insights-capture-date {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}

.dfp-insights-capture-minutes {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}

.dfp-insights-capture-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 11.5px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfp-insights-capture-more {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dfp-insights-capture-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 1px;
}

.dfp-insights-capture-button {
  height: 26px;
  padding: 0 12px;
  border: 0.5px solid color-mix(in srgb, var(--dfp-accent) 30%, var(--dsw-alias-border-l2));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.dfp-insights-capture-button.is-primary {
  background: color-mix(in srgb, var(--dfp-accent) 13%, transparent);
  color: color-mix(in srgb, var(--dfp-accent) 82%, var(--dsw-alias-label-primary));
  font-weight: 600;
}

.dfp-insights-capture-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dfp-accent) 20%, transparent);
  color: color-mix(in srgb, var(--dfp-accent) 82%, var(--dsw-alias-label-primary));
}

.dfp-insights-capture-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}

.dfp-insights-capture-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.dfp-insights-capture-error {
  margin: 0;
  padding-top: 6px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-static-amber-600);
  font-size: 11px;
  line-height: 16px;
}

/* The native capture status strip above the journal sections: one quiet line
 * with a tone dot, the state copy, and (when capture is configured) today's
 * frame count plus Pause/Resume. Off is gray, paused or unpermitted is amber,
 * recording is green; the strip never replaces the sections below it. */

.dfp-capture-line {
  --dfp-capture-tone: var(--dsw-alias-label-tertiary);
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 7px 11px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: color-mix(in srgb, var(--dfp-capture-tone) 4%, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--dsw-elevation-soft);
}

.dfp-capture-line.is-on {
  --dfp-capture-tone: var(--dsw-static-green-500);
}

.dfp-capture-line.is-warn {
  --dfp-capture-tone: var(--dsw-static-amber-500);
}

.dfp-capture-line.is-off {
  --dfp-capture-tone: var(--dsw-alias-label-tertiary);
}

.dfp-capture-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--dfp-capture-tone);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dfp-capture-tone) 16%, transparent);
}

.dfp-capture-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.dfp-capture-state {
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 17px;
  font-weight: 600;
  white-space: nowrap;
}

.dfp-capture-hint {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfp-capture-side {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.dfp-capture-frames {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dfp-capture-button {
  height: 24px;
  padding: 0 11px;
  border: 0.5px solid color-mix(in srgb, var(--dfp-capture-tone) 32%, var(--dsw-alias-border-l2));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 17px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.dfp-capture-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dfp-capture-tone) 18%, transparent);
  color: var(--dsw-alias-label-primary);
}

.dfp-capture-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}

.dfp-capture-button:disabled {
  cursor: default;
  opacity: 0.45;
}

.dfp-capture-off-hint {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

.dfp-capture-error {
  flex-basis: 100%;
  color: var(--dsw-static-amber-600);
  font-size: 11px;
  line-height: 16px;
}

/* The analysis status strip sits directly under the capture line: the same
 * quiet shape one step smaller, and deliberately without any control. Grey is
 * off or a stopped worker, amber is a gate the profile has to unblock, green is
 * a live worker; the call/token budget and any failure count sit on the right.
 * Only host tokens are used, so both light and dark themes adapt on their own. */

.dfp-analysis-line {
  --dfp-analysis-tone: var(--dsw-alias-label-tertiary);
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 11px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: color-mix(in srgb, var(--dfp-analysis-tone) 3%, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--dsw-elevation-soft);
}

.dfp-analysis-line.is-on {
  --dfp-analysis-tone: var(--dsw-static-green-500);
}

.dfp-analysis-line.is-warn {
  --dfp-analysis-tone: var(--dsw-static-amber-500);
}

.dfp-analysis-line.is-off {
  --dfp-analysis-tone: var(--dsw-alias-label-tertiary);
}

.dfp-analysis-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--dfp-analysis-tone);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dfp-analysis-tone) 14%, transparent);
}

.dfp-analysis-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.dfp-analysis-state {
  color: var(--dsw-alias-label-primary);
  font-size: 11.5px;
  line-height: 16px;
  font-weight: 600;
  white-space: nowrap;
}

.dfp-analysis-hint {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfp-analysis-last {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* The one-sentence consent disclosure. It takes its own full-width row so a
 * narrow sidebar wraps it instead of clipping the privacy copy; it stays quiet
 * because it is context, not a warning. */
.dfp-analysis-privacy {
  flex: 1 1 100%;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10.5px;
  line-height: 15px;
  white-space: normal;
}

.dfp-analysis-side {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.dfp-analysis-failed {
  color: var(--dsw-static-amber-600);
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  white-space: nowrap;
}

.dfp-analysis-budget {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

`;

/**
 * Add the panel stylesheet to the page once.
 * @returns a disposer that removes it.
 */
export function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector<HTMLStyleElement>(`style[data-dsh-plugin="${STYLE_ID}"]`);
  if (existing !== null) return () => {};

  const style = document.createElement('style');
  style.dataset.dshPlugin = STYLE_ID;
  style.textContent = PANEL_CSS;
  document.head.append(style);
  return () => {
    style.remove();
  };
}
