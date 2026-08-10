import React from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { expect, vi } from 'vitest';

/**
 * ═══ RENDU-RÉEL — mount the rider's real screen and USE it ═══
 *
 * FOUNDER RULING (2026-08-10): « Yes go ahead and do it. »
 *
 * ⚠ WHAT THIS IS FOR, IN ONE LINE: everything in this app was proven by
 * reading its source, so a screen that renders and cannot be used was
 * invisible. Three shipped in one day — a throw that blanked the tree, an
 * automatic act with no second chance, and a dep array that would have stopped
 * the seal firing for every rider alive. Each was caught by a person, twice by
 * a verifier, never by the suite.
 *
 * ⚠ AND IT DRIVES THE REAL PORTS. Nothing of the app is stubbed: `App.tsx`,
 * `httpRiderSession`, `httpCustodyActs`, `rider-session`'s bounded parser, the
 * act models and the catalog are all the shipped files. The ONLY thing faked
 * is `globalThis.fetch` — so these tests exercise screen → state → port →
 * wire → parse → screen, which is every layer above the Worker. (The Worker
 * itself is the seam tests' job, in `services/custody-service/test`.)
 *
 * ⚠ WHAT IT MAY NEVER CLAIM: appearance. See the bound stated in
 * `test/doubles/react-native.tsx` — there is no layout and no colour here.
 */

/** One scripted answer. `handler` sees the path and the parsed body. */
export type Route = (path: string, body: Record<string, unknown> | null) =>
  | { status: number; json: Record<string, unknown> }
  | null;

export interface Wire {
  /** Every request the app made, in order — the record a test asks « was this
   *  port actually CALLED », which is the question source scans cannot answer. */
  readonly calls: { path: string; method: string; body: Record<string, unknown> | null }[];
}

/**
 * Install a fake `fetch` built from routes. Anything unrouted answers 404 and
 * is RECORDED — an unexpected call is a finding, never a silent pass.
 */
export function wire(routes: readonly Route[]): Wire {
  const calls: Wire['calls'] = [];
  const fake = async (input: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(input, 'http://sera.test').pathname;
    const raw = init?.body;
    const body = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : null;
    calls.push({ path, method: init?.method ?? 'GET', body });
    for (const r of routes) {
      const answer = r(path, body);
      if (answer !== null) {
        return new Response(JSON.stringify(answer.json), {
          status: answer.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: 'no_route', path }), { status: 404 });
  };
  (globalThis as { fetch: unknown }).fetch = fake;
  return { calls };
}

/** The env a WIRED build reads. Set BEFORE importing App (see `mountRider`). */
export function wiredEnv(): void {
  process.env['EXPO_PUBLIC_SERA_LOGISTICS_BASE'] = 'http://logistics.test';
  process.env['EXPO_PUBLIC_SERA_CUSTODY_BASE'] = 'http://custody.test';
  // The repère row only renders when a media base can turn the ref into a URL.
  process.env['EXPO_PUBLIC_SERA_MEDIA_BASE'] = 'http://media.test';
}

export interface Screen {
  readonly tree: ReactTestRenderer;
  /** Every string the rider can currently read, in render order. */
  texts(): string[];
  /** Does the screen currently show this sentence? */
  shows(fragment: string): boolean;
  /** Press the control whose label is exactly this. Throws — loudly, naming
   *  what IS on screen — when nothing carries it, because « the button is not
   *  there » and « the button did nothing » must never look the same. */
  press(label: string, nth?: number): Promise<void>;
  /** Is a control with this label present AND enabled? */
  canPress(label: string): boolean;
  /**
   * Type into the ONE field on screen. When several are present, `match` picks
   * by placeholder or accessibility label — and an ambiguous call THROWS
   * rather than choosing, because a test that silently types into the wrong
   * field is worse than one that fails.
   */
  type(value: string, match?: string): Promise<void>;
  /** Let queued promises and effects settle. */
  settle(): Promise<void>;
  /**
   * Advance the `/rider/moi` clock. A wired build re-asks logistics every 20 s
   * (`MOI_POLL_MS`), and that poll is how the supplier's confirmation reaches
   * the rider's phone — so « the supplier confirmed while I stood there » is
   * only testable by moving this clock. Requires `vi.useFakeTimers()` before
   * the mount.
   */
  poll(times?: number): Promise<void>;
  unmount(): void;
}

const textOf = (node: ReactTestInstance): string => {
  const out: string[] = [];
  const walk = (children: readonly (ReactTestInstance | string)[]): void => {
    for (const c of children) {
      if (typeof c === 'string') out.push(c);
      else walk(c.children);
    }
  };
  walk(node.children);
  return out.join('');
};

/**
 * Mount the real App. `App.tsx` reads its bases at module scope, so the env
 * must be set before the dynamic import — which is why this is async and why
 * the module registry is reset per mount.
 */
export async function mountRider(): Promise<Screen> {
  // React 19 wants this flag before any act(); without it every mount warns
  // « not configured to support act(...) » and effects can flush unpredictably.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { default: App } = (await import('../App')) as { default: React.FC };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(React.createElement(App));
  });

  const settle = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  /**
   * ⚠ A CONTROL IS ANYTHING WITH AN `onPress`, not just a `Pressable`. The
   * checklist's « Oui »/« Non » are `<Text onPress accessibilityRole="button">`
   * — a real and legitimate RN pattern, and one this harness was blind to on
   * its first cut, which would have made « the rider can answer the checks »
   * unprovable while looking fine.
   */
  const pressables = (): ReactTestInstance[] =>
    tree.root.findAll((n) => typeof n.props['onPress'] === 'function', { deep: true });

  /** Every control carrying this label, in render order. `nth` exists because
   *  the checklist asks three questions and each offers « Oui » — pressing the
   *  first one three times answers one question and silently leaves two
   *  unanswered, which is exactly the kind of false green this file exists to
   *  stop. */
  const allByLabel = (label: string): ReactTestInstance[] => {
    const hits = pressables().filter((p) => textOf(p).includes(label));
    // Innermost wins: a card that WRAPS a button also contains its text, and
    // pressing the wrapper is not what a rider's thumb does. Render order is
    // preserved so `nth` still means « the third one down the screen ».
    return hits.filter((h) => !hits.some((other) => other !== h && h.findAll((n) => n === other).length > 0));
  };
  const findByLabel = (label: string, nth = 0): ReactTestInstance | null =>
    allByLabel(label)[nth] ?? null;

  const screen: Screen = {
    tree,
    texts: () => tree.root.findAllByType('Text' as never).map(textOf).filter((t) => t !== ''),
    shows: (fragment) => screen.texts().some((t) => t.includes(fragment)),
    canPress: (label) => {
      const p = findByLabel(label);
      return p !== null && p.props['disabled'] !== true;
    },
    press: async (label, nth = 0) => {
      const p = findByLabel(label, nth);
      if (p === null) {
        const n = allByLabel(label).length;
        throw new Error(
          n === 0
            ? `no control labelled « ${label} ». On screen: ${JSON.stringify(screen.texts())}`
            : `« ${label} » has ${n} control(s); asked for #${nth}`,
        );
      }
      expect(p.props['disabled'], `« ${label} » is on screen but disabled`).not.toBe(true);
      const onPress = p.props['onPress'] as (() => void) | undefined;
      if (typeof onPress !== 'function') {
        throw new Error(`« ${label} » has NO onPress — a dead control is what this harness exists to catch`);
      }
      await act(async () => {
        onPress();
        await Promise.resolve();
      });
      await settle();
    },
    type: async (value, match) => {
      const all = tree.root.findAllByType('TextInput' as never);
      const describe = (i: (typeof all)[number]): string =>
        `${String(i.props['placeholder'] ?? '')} / ${String(i.props['accessibilityLabel'] ?? '')}`;
      const candidates = match === undefined
        ? all
        : all.filter((i) => describe(i).includes(match));
      if (candidates.length === 0) {
        throw new Error(
          `no field${match === undefined ? '' : ` matching « ${match} »`}. Fields: ${JSON.stringify(all.map(describe))}`,
        );
      }
      if (candidates.length > 1) {
        throw new Error(`« ${match ?? '(any)'} » is ambiguous: ${JSON.stringify(candidates.map(describe))}`);
      }
      const input = candidates[0]!;
      const onChangeText = input.props['onChangeText'] as ((v: string) => void) | undefined;
      if (typeof onChangeText !== 'function') throw new Error(`${describe(input)} does not accept typing`);
      await act(async () => {
        onChangeText(value);
      });
    },
    settle,
    poll: async (times = 1) => {
      for (let i = 0; i < times; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20_000);
        });
        await settle();
      }
    },
    unmount: () => {
      act(() => {
        tree.unmount();
      });
    },
  };
  return screen;
}
