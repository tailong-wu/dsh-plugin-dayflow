/**
 * Client half of the Dayflow plugin.
 *
 * Registers one optional, closed-by-default timeline panel in the right
 * Sidebar plus the single conversation-header button that opens it. The panel
 * is a page-type tab, so it never appears until the user asks for it, and
 * closing the tab restores the layout they had. The journal insights are a
 * view inside that panel, not a second entry.
 * @module dsh-plugin-dayflow/client
 */

import { fetchDay, fetchInsights, fetchMonth, fetchPanelConfig, fetchWeek } from './data.js';
import { EN, NAMESPACE, ZH } from './locale.js';
import { DayflowPanel } from './app.js';
import { installStyles } from './styles.js';
import { DayflowToggle } from './toggle.js';

/** Stable Cordis plugin name for the client half. */
export const name = 'dayflow-panel';

/** Client services this half needs before it can register anything. */
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'];

/** This implementation's identity in the tab system, and the body's slot key. */
export const TAB_ID = 'dsh-plugin-dayflow';

/** The page kind `openTab` names. */
export const TAB_KIND = 'dayflow.timeline';

/** The narrow slice of the client context this half uses. */
export interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void;
  locale: {
    register(namespace: string, locale: string, dictionary: Record<string, string>): () => void;
    resolveText(text: Record<string, string>): string;
  };
  slots: {
    inject(slot: string, callback: () => (() => void) | void): void;
    register(spec: Record<string, unknown>, component: unknown): () => void;
  };
  sidebarRightTabs: { register(definition: Record<string, unknown>): () => void };
  sidebarRight: { openTab(kind: string): void };
}

/**
 * Register the panel's two stages and its single entry point, once.
 * @param ctx - the client context.
 */
export function registerPanelUi(ctx: ClientContext): void {
  const text = (key: string): string => ctx.locale.resolveText({ zh: ZH[key] ?? key, en: EN[key] ?? key });

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'extension',
        title: () => 'Dayflow',
        guide: [
          {
            id: 'dayflow.timeline',
            order: 42,
            title: () => text('guideTitle'),
            description: () => text('guideDescription'),
          },
        ],
      }),
    'dayflow panel: tab type',
  );

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            locale: NAMESPACE,
            inject: () => ({
              loadDay: (date?: string, signal?: AbortSignal) => fetchDay(date, signal),
              loadMonth: (month?: string, signal?: AbortSignal) => fetchMonth(month, signal),
              loadWeek: (date?: string, signal?: AbortSignal) => fetchWeek(date, signal),
              loadInsights: (signal?: AbortSignal) => fetchInsights(signal),
            }),
          },
          DayflowPanel,
        ),
      ),
    'dayflow panel: body',
  );

  ctx.effect(
    () =>
      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'dayflow-toggle',
            order: 15,
            locale: NAMESPACE,
            inject: () => ({
              openPanel: () => ctx.sidebarRight.openTab(TAB_KIND),
            }),
          },
          DayflowToggle,
        ),
      ),
    'dayflow panel: toggle',
  );
}

/**
 * Client plugin body: styles and dictionaries always, the panel itself only
 * when the host says it is enabled.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), 'dayflow panel: styles');
  ctx.effect(() => ctx.locale.register(NAMESPACE, 'zh', ZH), 'dayflow panel: zh');
  ctx.effect(() => ctx.locale.register(NAMESPACE, 'en', EN), 'dayflow panel: en');

  let settled = false;
  ctx.effect(
    () => () => {
      settled = true;
    },
    'dayflow panel: lifecycle',
  );

  const register = (): void => {
    if (settled) return;
    settled = true;
    registerPanelUi(ctx);
  };

  fetchPanelConfig().then(
    (config) => {
      if (config.enabled) register();
    },
    () => {
      // A failed probe must not hide a working panel; register and let the
      // panel's own request report the problem.
      register();
    },
  );
}
