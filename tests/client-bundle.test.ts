/**
 * The built browser bundle, exercised without a browser: the harness's
 * registration contract, the services it asks for, and what `apply` registers.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const BUNDLE = new URL('../../lib/client.js', import.meta.url);

interface SlotRegistration {
  spec: Record<string, unknown>;
  component: unknown;
}

interface ClientCalls {
  readonly locales: { namespace: string; locale: string; dictionary: Record<string, string> }[];
  readonly tabs: Record<string, unknown>[];
  readonly slots: SlotRegistration[];
  readonly injectedSlots: string[];
  readonly opened: string[];
  readonly effects: string[];
}

interface BundleModule {
  apply(ctx: unknown): void;
  inject: string[];
  name: string;
  registerPanelUi(ctx: unknown): void;
}

function loadBundle(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>): {
  module: BundleModule;
  requests: string[];
} {
  const requests: string[] = [];
  let captured: { id: string; factory: (require: (id: string) => unknown) => BundleModule } | undefined;

  const document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', remove: () => {} }),
    head: { append: () => {} },
  };

  const sandbox: Record<string, unknown> = {
    window: { __ModuleLoader__: { load: (entry: { id: string; factory: never }) => (captured = entry) } },
    document,
    fetch: (input: string, init?: RequestInit) => {
      requests.push(String(input));
      return fetchImpl(String(input), init);
    },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
  };

  runInContext(readFileSync(BUNDLE, 'utf8'), createContext(sandbox as never));

  assert.ok(captured !== undefined, 'the bundle registers a module factory');
  assert.equal(captured.id, 'dsh-plugin-dayflow');

  const requireStub = (id: string): unknown => {
    switch (id) {
      case 'react':
        return {
          useState: () => [undefined, () => {}],
          useEffect: () => {},
          useMemo: (factory: () => unknown) => factory(),
          useRef: () => ({ current: null }),
          useCallback: (callback: unknown) => callback,
        };
      case 'react/jsx-runtime':
        return {
          Fragment: 'Fragment',
          jsx: (type: unknown, props: unknown) => ({ type, props }),
          jsxs: (type: unknown, props: unknown) => ({ type, props }),
        };
      case 'react-dom':
        return { createPortal: (children: unknown) => children };
      case '@deepseek-ai/dsh-client-ui-primitives':
        return { Button: () => null, Tooltip: () => null, StateDot: () => null, SegmentedControl: () => null };
      default:
        throw new Error(`unexpected platform module: ${id}`);
    }
  };

  return { module: captured.factory(requireStub), requests };
}

function fakeClientContext(): { ctx: unknown; calls: ClientCalls; disposed: () => boolean } {
  const calls: ClientCalls = {
    locales: [],
    tabs: [],
    slots: [],
    injectedSlots: [],
    opened: [],
    effects: [],
  };
  let isDisposed = false;
  const ctx = {
    effect: (effect: () => (() => void) | void, label?: string) => {
      calls.effects.push(label ?? '');
      const disposer = effect();
      return () => {
        isDisposed = true;
        if (typeof disposer === 'function') disposer();
      };
    },
    locale: {
      register: (namespace: string, locale: string, dictionary: Record<string, string>) => {
        calls.locales.push({ namespace, locale, dictionary });
        return () => {};
      },
      resolveText: (text: Record<string, string>) => text.en ?? Object.values(text)[0] ?? '',
    },
    slots: {
      inject: (slot: string, callback: () => (() => void) | void) => {
        calls.injectedSlots.push(slot);
        callback();
      },
      register: (spec: Record<string, unknown>, component: unknown) => {
        calls.slots.push({ spec, component });
        return () => {};
      },
    },
    sidebarRightTabs: {
      register: (definition: Record<string, unknown>) => {
        calls.tabs.push(definition);
        return () => {};
      },
    },
    sidebarRight: {
      openTab: (kind: string) => {
        calls.opened.push(kind);
      },
    },
  };
  return { ctx, calls, disposed: () => isDisposed };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** One payload per section, so the stubbed host exercises every insights list. */
const INSIGHTS = {
  tasks: [
    {
      id: 1,
      title: 'Ship the insights tab',
      status: 'active',
      origin: 'user',
      total_minutes: 150,
      session_days: 3,
      last_session_day: '2026-10-19',
      target_date: '2026-11-01',
      stalled: false,
    },
  ],
  review: [{ id: 2, kind: 'loop', status: 'proposed', title: 'Late-night analysis', confidence: 0.8, source_day: '2026-10-19' }],
  memory: [{ id: 3, kind: 'preference', subject: 'standups', observed_on: '2026-10-19', confidence: 0.7 }],
  reflections: [{ id: 4, kind: 'day', period_key: '2026-10-19', body: 'Shipped the panel.', updated_at: '2026-10-20 01:00:00' }],
};

test('the bundle declares the client plugin contract', () => {
  const { module } = loadBundle(async () => jsonResponse({ enabled: true }));
  assert.equal(module.name, 'dayflow-panel');
  assert.deepEqual([...module.inject], ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']);
  assert.equal(typeof module.apply, 'function');
});

test('an enabled panel registers one tab, one body, and one header toggle', async () => {
  const { module, requests } = loadBundle(async (input) => {
    if (input === '/api/dayflow/insights') return jsonResponse(INSIGHTS);
    return jsonResponse({ enabled: true });
  });
  const { ctx, calls } = fakeClientContext();
  module.apply(ctx);
  await settle();

  assert.deepEqual(
    calls.locales.map((entry) => entry.locale).sort(),
    ['en', 'zh'],
    'both dictionaries are registered',
  );
  assert.ok(requests.includes('/api/dayflow/panel'), 'the panel asks the host whether it is enabled');

  // ── tab types ────────────────────────────────────────────────────────
  // The plugin keeps exactly one harness entry: one tab, one header button.
  assert.equal(calls.tabs.length, 1);

  const timelineTab = calls.tabs[0];
  assert.ok(timelineTab);
  assert.equal(timelineTab.id, 'dsh-plugin-dayflow');
  assert.equal(timelineTab.kind, 'dayflow.timeline');
  assert.equal(timelineTab.priority, 'extension');
  assert.equal(typeof timelineTab.title, 'function');
  assert.equal((timelineTab.title as () => string)(), 'Dayflow');
  assert.equal((timelineTab.guide as unknown[]).length, 1);
  assert.ok(calls.tabs.every((entry) => entry.kind !== 'dayflow.insights'), 'no second tab is registered');

  // ── body slots ───────────────────────────────────────────────────────
  assert.deepEqual([...calls.injectedSlots].sort(), [
    'conversation.session.header.actions',
    'sidebar.right.pane.tab',
  ]);
  assert.equal(calls.slots.length, 2);

  const bodies = calls.slots.filter((entry) => entry.spec.name === 'sidebar.right.pane.tab');
  assert.equal(bodies.length, 1);
  const timelineBody = bodies[0];
  assert.ok(timelineBody);
  assert.equal(timelineBody.spec.key, 'dsh-plugin-dayflow');
  assert.equal(timelineBody.spec.locale, 'dayflowPanel');
  const bodyInject = (timelineBody.spec.inject as () => {
    loadDay: (date?: string) => Promise<unknown>;
    loadMonth: (month?: string) => Promise<unknown>;
    loadWeek: (date?: string) => Promise<unknown>;
    loadInsights: (signal?: AbortSignal) => Promise<unknown>;
  })();
  assert.equal(typeof bodyInject.loadMonth, 'function');
  assert.equal(typeof bodyInject.loadWeek, 'function');
  assert.equal(typeof bodyInject.loadInsights, 'function');
  await bodyInject.loadDay('2026-10-19');
  await bodyInject.loadMonth('2026-10');
  await bodyInject.loadWeek('2026-10-19');
  assert.deepEqual(await bodyInject.loadInsights(), INSIGHTS);
  assert.ok(requests.some((url) => url === '/api/dayflow/day?date=2026-10-19'));
  assert.ok(requests.some((url) => url === '/api/dayflow/month?month=2026-10'));
  assert.ok(requests.some((url) => url === '/api/dayflow/week?date=2026-10-19'));
  assert.ok(requests.some((url) => url === '/api/dayflow/insights'));

  // ── header actions ───────────────────────────────────────────────────
  const actions = calls.slots.filter((entry) => entry.spec.name === 'conversation.session.header.actions');
  assert.equal(actions.length, 1);

  const timelineToggle = actions[0];
  assert.ok(timelineToggle);
  assert.equal(timelineToggle.spec.id, 'dayflow-toggle');
  assert.equal(timelineToggle.spec.order, 15);
  (timelineToggle.spec.inject as () => { openPanel: () => void })().openPanel();

  assert.deepEqual(calls.opened, ['dayflow.timeline']);
});

test('a disabled panel registers nothing but still loads its styles', async () => {
  const { module } = loadBundle(async () => jsonResponse({ enabled: false }));
  const { ctx, calls } = fakeClientContext();
  module.apply(ctx);
  await settle();

  assert.equal(calls.tabs.length, 0);
  assert.equal(calls.slots.length, 0);
  assert.equal(calls.locales.length, 2);
  assert.ok(calls.effects.some((label) => label.includes('styles')));
});

test('a failed enablement probe fails open', async () => {
  const { module } = loadBundle(async () => {
    throw new Error('offline');
  });
  const { ctx, calls } = fakeClientContext();
  module.apply(ctx);
  await settle();

  assert.equal(calls.tabs.length, 1, 'a broken probe must not hide a working panel');
});

test('disposing before the probe settles blocks registration', async () => {
  const { module } = loadBundle(async () => jsonResponse({ enabled: true }));
  const { ctx, calls, disposed } = fakeClientContext();
  // Unmount immediately: the enablement request is still in flight.
  const disposers: (() => void)[] = [];
  const wrapped = {
    ...(ctx as Record<string, unknown>),
    effect: (effect: () => (() => void) | void, label?: string) => {
      const dispose = (ctx as { effect: (e: () => (() => void) | void, l?: string) => () => void }).effect(effect, label);
      disposers.push(dispose);
      return dispose;
    },
  };
  module.apply(wrapped);
  for (const dispose of disposers) dispose();
  await settle();

  assert.equal(disposed(), true);
  assert.equal(calls.tabs.length, 0);
});
