import React from 'react';

/**
 * ═══ RENDU-RÉEL — the react-native double, and EXACTLY what it is for ═══
 *
 * FOUNDER RULING (2026-08-10, after the third verifier round in one day):
 * build the thing that catches these. Three bugs shipped today that every one
 * of 398 tests was blind to, and all three were the same shape — a screen that
 * renders but cannot be used:
 *
 *   · an effect that threw and blanked the whole tree (« écran blanc »);
 *   · an act that fires by itself and can never fire again (the seal, then the
 *     door bundle), leaving « Réessayez » over nothing to tap;
 *   · a dep array trimmed to `[WIRED]`, which would have stopped the seal from
 *     firing for EVERY rider on earth, with the board green.
 *
 * Source scans cannot see any of those, because all three are React SEMANTICS:
 * what mounted, what an effect did, what a press does, what is reachable next.
 *
 * ⚠ THE BOUND OF THIS DOUBLE, STATED SO NOBODY OVER-READS IT (§9.8 — « a mock
 * that makes integration look healthier than it is is a bug you own »):
 *
 *   IT PROVIDES: component identity, prop pass-through, children, and the
 *   press/change handlers. That is enough — and is exactly what is needed —
 *   to answer « did it render », « is this button wired », « did the effect
 *   run », « can the rider get to the next screen ».
 *
 *   IT PROVIDES NOTHING ELSE. No layout, no styling, no measurement, no
 *   gesture system, no native animation. So a test written on it may NEVER
 *   claim anything about appearance — not spacing, not contrast, not
 *   touch-target size, not animation timing. Those stay where they already live: the token-fidelity,
 *   contrast and anatomy source scans, and the founder's own eyes on a phone.
 *
 * A test that asserts a colour here would be asserting a fiction. There is no
 * colour here.
 *
 * ⚠ AND ITS SURFACE IS CERTIFIED, NOT GUESSED. `test/rendu-harness.test.ts`
 * sweeps every `from 'react-native'` import in the app tree and fails if this
 * file does not export it — so a new import cannot silently arrive as
 * `undefined` and render nothing while a test passes over it.
 */

type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

/** A host element of the given name — react-test-renderer keeps the type
 *  string, so `root.findAllByType('Text')` finds real nodes and the props are
 *  the ones the app actually passed. */
function host(name: string): React.FC<AnyProps> {
  const C: React.FC<AnyProps> = (props) => React.createElement(name, props as never);
  C.displayName = name;
  return C;
}

export const View = host('View');
export const Text = host('Text');
export const Image = host('Image');
export const SafeAreaView = host('SafeAreaView');
export const ScrollView = host('ScrollView');
export const TextInput = host('TextInput');
/**
 * ⚠ IDENTITY ONLY, AND THAT IS THE WHOLE POINT. The real one listens for the
 * keyboard and gives it room; there is no keyboard here and no layout to give,
 * so this renders as a plain container. A walk may therefore ask only the TREE
 * question — is the field INSIDE it — and may never claim that anything is
 * visible above a keyboard. That is the founder's phone's answer, not ours.
 */
export const KeyboardAvoidingView = host('KeyboardAvoidingView');

/**
 * The keyboard EVENT boundary, and nothing more. `keyboardDidShow` is a real
 * native event a screen can subscribe to, and an effect that throws on it
 * blanks the tree exactly like any other — so a walk must be able to fire one.
 * What this double does NOT have is a keyboard: no height, no layout, no
 * occlusion. A test may ask « did the tree survive the keyboard rising » and
 * may never ask « is the field above it ».
 */
type KeyboardEventName = string;
const keyboardListeners = new Map<KeyboardEventName, Set<() => void>>();
export const Keyboard = {
  addListener: (event: KeyboardEventName, cb: () => void): { remove: () => void } => {
    const set = keyboardListeners.get(event) ?? new Set<() => void>();
    set.add(cb);
    keyboardListeners.set(event, set);
    return {
      remove: () => {
        set.delete(cb);
      },
    };
  },
};
/**
 * TEST HOOK — fire a keyboard event at whatever is currently subscribed, and
 * RETURN HOW MANY LISTENERS IT REACHED.
 *
 * ⚠ THE COUNT IS NOT A CONVENIENCE. `vi.resetModules()` runs before every
 * mount, so a test holding a STATIC import of this file keeps the pre-reset
 * instance while the mounted app gets a fresh one — the emit would then reach
 * an empty set, nothing could throw, and « the tree survived the keyboard »
 * would be green over a keyboard that was never raised (§9.7 exactly). Import
 * this module dynamically AFTER the mount, and assert the count.
 */
export const __emitKeyboard = (event: KeyboardEventName): number => {
  const subscribed = [...(keyboardListeners.get(event) ?? [])];
  for (const cb of subscribed) cb();
  return subscribed.length;
};

/**
 * Pressable renders a function-child in the real library (`({pressed}) => …`).
 * Both forms are supported because the kit uses both; anything else about
 * pressing — ripple, delay, hit slop — is layout, and layout is not here.
 */
export const Pressable: React.FC<AnyProps> = (props) => {
  const { children, ...rest } = props;
  const resolved = typeof children === 'function'
    ? (children as (s: { pressed: boolean }) => React.ReactNode)({ pressed: false })
    : children;
  return React.createElement('Pressable', rest as never, resolved);
};
Pressable.displayName = 'Pressable';

export const StyleSheet = {
  /** Identity: the app's styles are asserted by the token-fidelity scans, not
   *  here, and flattening them would invite exactly the appearance claims the
   *  header forbids. */
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (style: unknown): Record<string, unknown> =>
    Array.isArray(style)
      ? Object.assign({}, ...style.filter((s) => s !== null && s !== undefined && s !== false))
      : ((style ?? {}) as Record<string, unknown>),
  absoluteFillObject: {},
  hairlineWidth: 1,
};

/** Animation is DRIVEN, not simulated: `start()` invokes its callback at once
 *  so a component that waits on completion is never left hanging in a test.
 *  Nothing here interpolates — a value is whatever it was last set to. */
class AnimatedValue {
  constructor(private value: number) {}
  setValue(v: number): void {
    this.value = v;
  }
  interpolate(): AnimatedValue {
    return this;
  }
  addListener(): string {
    return '0';
  }
  removeAllListeners(): void {}
  stopAnimation(): void {}
}

const timing = (
  value: AnimatedValue,
  config: { toValue: number },
): { start: (cb?: () => void) => void; stop: () => void } => ({
  start: (cb?: () => void) => {
    value.setValue(config.toValue);
    cb?.();
  },
  stop: () => {},
});

export const Animated = {
  View: host('Animated.View'),
  Text: host('Animated.Text'),
  Value: AnimatedValue,
  timing,
  spring: timing,
  loop: (a: { start: (cb?: () => void) => void; stop: () => void }) => a,
  sequence: (list: { start: (cb?: () => void) => void }[]) => ({
    start: (cb?: () => void) => {
      for (const a of list) a.start();
      cb?.();
    },
    stop: () => {},
  }),
  parallel: (list: { start: (cb?: () => void) => void }[]) => ({
    start: (cb?: () => void) => {
      for (const a of list) a.start();
      cb?.();
    },
    stop: () => {},
  }),
};

const easingFn = (t: number): number => t;
export const Easing = {
  ease: easingFn,
  linear: easingFn,
  bezier: (): ((t: number) => number) => easingFn,
  inOut: (): ((t: number) => number) => easingFn,
  in: (): ((t: number) => number) => easingFn,
  out: (): ((t: number) => number) => easingFn,
};

/** The real one asks the OS. Here it answers « motion is fine » and never
 *  changes — the reduced-motion BRANCHES are covered by their own unit tests. */
export const AccessibilityInfo = {
  isReduceMotionEnabled: async (): Promise<boolean> => false,
  addEventListener: (): { remove: () => void } => ({ remove: () => {} }),
};

export const Platform = { OS: 'android' as const, select: <T,>(o: { android?: T; default?: T }): T | undefined => o.android ?? o.default };
export const Dimensions = { get: () => ({ width: 360, height: 640, scale: 2, fontScale: 1 }) };

export type StyleProp<T> = T | T[] | null | undefined;
export type ViewStyle = Record<string, unknown>;
export type TextStyle = Record<string, unknown>;
export type ImageStyle = Record<string, unknown>;
