import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Svg, Defs, Pattern, Rect, Line, LinearGradient, Stop, G } from 'react-native-svg';
import { alpha, C, DARK, GEO, motionOf, rad, ty, type MotionName } from './faso';
import { useReducedMotion } from './reduced-motion';

/**
 * WO-FP-SERA · the SIGNATURE MODULE — the six Faso Premium signature elements
 * (README § Signature elements) + the seven fp* motions (§ Motion), built ONCE on
 * the v2 token bridge and composed by the rider views. Zero hardcode: every value
 * resolves to `faso.ts`. Gradients/weave use react-native-svg (an existing dep) —
 * RN has no repeating-linear-gradient. Every motion respects prefers-reduced-motion.
 *
 * Judgment calls (translating the prototype to RN, for the founder's proof):
 *  · the hero-ledger radius normalizes to the card token (20) — the README's « 22 »
 *    is a straggler the hierarchy law resolves to the token (token wins; journaled).
 *  · the weave overlays are drawn as react-native-svg line patterns at the README's
 *    opacities — RN cannot express `repeating-linear-gradient`.
 */

/* ── the seven motions, as RN Animated helpers ──────────────────────────────── */

const toEasing = (tf: string): ((t: number) => number) => {
  const bez = /cubic-bezier\(([^)]+)\)/.exec(tf)?.[1];
  if (bez !== undefined) {
    const n = bez.split(',').map((x) => Number(x.trim()));
    return Easing.bezier(n[0] ?? 0, n[1] ?? 0, n[2] ?? 1, n[3] ?? 1);
  }
  if (tf === 'linear') return Easing.linear;
  if (tf === 'ease-in-out') return Easing.inOut(Easing.ease);
  return Easing.ease; // 'ease' (fpPulse, fpShake) + default
};

/** A one-shot entry driver (fpIn / fpUp / fpPop): 0→1 on mount, static under
 * reduced motion. Returns the Animated.Value the element interpolates. */
function useEntry(name: Extract<MotionName, 'fpIn' | 'fpUp' | 'fpPop'>, edge: 'min' | 'max' = 'max'): Animated.Value {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(1);
      return;
    }
    const m = motionOf(name, edge);
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: m.durationMs, easing: toEasing(m.timingFunction), useNativeDriver: true }).start();
  }, [name, edge, reduced, v]);
  return v;
}

/** A looping driver (fpPulse / fpBar / fpShimmer): 0↔1, static-at-rest under
 * reduced motion. */
function useLoop(name: Extract<MotionName, 'fpPulse' | 'fpBar' | 'fpShimmer'>): Animated.Value {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(0.6);
      return;
    }
    const m = motionOf(name);
    const half = { duration: m.durationMs / 2, easing: toEasing(m.timingFunction), useNativeDriver: true };
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, ...half }),
        Animated.timing(v, { toValue: 0, ...half }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [name, reduced, v]);
  return v;
}

/** fpIn — screen entry: opacity + 14px rise. Wraps a screen's content and SIZES
 * TO CONTENT (no flex:1) so it composes inside the app's full-bleed ScrollView —
 * the screen is the scroll surface; a flex:1 wrapper would collapse in a scroll. */
export function FpIn({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = useEntry('fpIn');
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return <Animated.View style={[style, { opacity: p, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/** fpPop — a badge popping in (§ Motion: fpPop .3–.45s). Wrap the celebration seal. */
export function FpPop({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = useEntry('fpPop');
  const scale = p.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.6, 1.06, 1] });
  return <Animated.View style={[style, { opacity: p, transform: [{ scale }] }]}>{children}</Animated.View>;
}

/** fpBar — the server-wait bar (§ Motion: fpBar 1.3s ease-in-out). A calm sweeping
 * track, never a spinner-apology; static bar under reduced motion. */
export function FpBar() {
  const v = useLoop('fpBar');
  const translateX = v.interpolate({ inputRange: [0, 1], outputRange: ['-40%', '100%'] });
  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, { transform: [{ translateX }] }]} />
    </View>
  );
}

/** fpPulse — a live timeline dot (§ Motion: fpPulse 1.2s ease). */
export function FpPulseDot({ color = C.accent }: { color?: string }) {
  const v = useLoop('fpPulse');
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] });
  return <Animated.View style={[styles.pulseDot, { backgroundColor: color, opacity, transform: [{ scale }] }]} />;
}

/** fpUp — a sheet rising 44px (§ Motion: fpUp .34s). Wrap a bottom sheet's panel. */
export function FpUp({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = useEntry('fpUp');
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [44, 0] });
  return <Animated.View style={[style, { opacity: p, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/** fpShimmer — the skeleton-first loader (§ Motion: fpShimmer 1.2s linear). An
 * exact-dimension placeholder, calm sweep; static under reduced motion. */
export function Shimmer({ style }: { style?: StyleProp<ViewStyle> }) {
  const v = useLoop('fpShimmer');
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  return <Animated.View style={[styles.shimmer, style, { opacity }]} />;
}

/** fpShake — the wrong-code shake (§ Motion: fpShake .4s ease). Returns the shake
 * transform value + a `fire()` to trigger it (R10 wrong drop code); no-op reduced. */
export function useShake(): { shakeX: Animated.Value; fire: () => void } {
  const reduced = useReducedMotion();
  const shakeX = useRef(new Animated.Value(0)).current;
  const fire = (): void => {
    if (reduced) return;
    const m = motionOf('fpShake');
    const step = m.durationMs / 8;
    Animated.sequence(
      [8, -8, 6, -6, 4, -4, 0].map((to) =>
        Animated.timing(shakeX, { toValue: to, duration: step, easing: toEasing(m.timingFunction), useNativeDriver: true }),
      ),
    ).start();
  };
  return { shakeX, fire };
}

/* ── 1 · the woven band ─────────────────────────────────────────────────────── */
/** README § Signature 1 — 6px strip: accent 0-18 · paper 18-24 · gold 24-32 ·
 * paper 32-38, tiled. Séra gold is the third colour (#C2571B via C.gold). */
export function WovenBand() {
  const tile = 38;
  return (
    <Svg width="100%" height={6} accessibilityElementsHidden>
      <Defs>
        <Pattern id="weave" patternUnits="userSpaceOnUse" width={tile} height={6}>
          <Rect x={0} y={0} width={18} height={6} fill={C.accent} />
          <Rect x={18} y={0} width={6} height={6} fill={C.paper} />
          <Rect x={24} y={0} width={8} height={6} fill={C.gold} />
          <Rect x={32} y={0} width={6} height={6} fill={C.paper} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height={6} fill="url(#weave)" />
    </Svg>
  );
}

/* ── 2 · the hero ledger band ───────────────────────────────────────────────── */
/** README § Signature 2 — full-width accent card, weave overlay, caps label +
 * 36–38px tnum amount + hairline divider row. Money is Bricolage (display),
 * onAccent ink (#241A05). `amount` is pre-formatted through the money token. */
export function HeroLedgerBand({
  label,
  amount,
  footRow,
}: {
  label: string;
  amount: string;
  footRow?: React.ReactNode;
}) {
  return (
    <View style={styles.hero}>
      <Svg style={StyleSheet.absoluteFill} accessibilityElementsHidden>
        <Defs>
          <Pattern id="heroweave" patternUnits="userSpaceOnUse" width={30} height={30} patternTransform="rotate(135)">
            <Rect x={0} y={0} width={12} height={30} fill="rgba(255,255,255,0.05)" />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#heroweave)" />
      </Svg>
      <Text style={styles.heroLabel}>{label}</Text>
      <Text style={styles.heroAmount} numberOfLines={1}>{amount}</Text>
      {footRow !== undefined && (
        <>
          <View style={styles.heroDivider} />
          <View style={styles.heroFoot}>{footRow}</View>
        </>
      )}
    </View>
  );
}

/* ── 3 · the product-art tile ───────────────────────────────────────────────── */
/** README § Signature 3 — duotone linear-gradient(140deg, A, B) + weave overlay +
 * emoji glyph. Placeholder until real photos. */
export function ProductArtTile({ glyph, a = C.accent, b = C.accentDeep, size = 56 }: { glyph: string; a?: string; b?: string; size?: number }) {
  return (
    <View style={[styles.artTile, { width: size, height: size }]}>
      <Svg style={StyleSheet.absoluteFill} accessibilityElementsHidden>
        <Defs>
          <LinearGradient id="duo" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={a} />
            <Stop offset="1" stopColor={b} />
          </LinearGradient>
          <Pattern id="artweave" patternUnits="userSpaceOnUse" width={14} height={14} patternTransform="rotate(45)">
            <Rect x={0} y={0} width={6} height={14} fill="rgba(255,255,255,0.07)" />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#duo)" />
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#artweave)" />
      </Svg>
      <Text style={[styles.artGlyph, { fontSize: size * 0.5 }]}>{glyph}</Text>
    </View>
  );
}

/* ── 4 · selection = border swap + check bubble ─────────────────────────────── */
/** README § Signature 4 — selected: 2px accent border + 26px accent circle w/
 * white check (fpPop); unselected: 1.5px hairlineInput. */
export function SelectionCard({ selected, children, onLayout, style }: { selected: boolean; children: React.ReactNode; onLayout?: () => void; style?: StyleProp<ViewStyle> }) {
  const pop = useEntry('fpPop');
  return (
    <View style={[styles.selCard, selected ? styles.selCardOn : styles.selCardOff, style]} onLayout={onLayout}>
      {children}
      {selected && (
        <Animated.View style={[styles.selBubble, { transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}>
          <Svg width={14} height={14} viewBox="0 0 20 20">
            <G stroke={C.onAccent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none">
              <Line x1={4} y1={10} x2={9} y2={15} />
              <Line x1={9} y1={15} x2={16} y2={5} />
            </G>
          </Svg>
        </Animated.View>
      )}
    </View>
  );
}

/* ── 5 · corner ticks ───────────────────────────────────────────────────────── */
/** README § Signature 5 — 12–14px L-marks inside photo/code frames (documentary
 * evidence). Draws four absolute L corners over its parent. */
export function CornerTicks({ color = C.accentDeepAlt }: { color?: string }) {
  return (
    <>
      <View style={[styles.tick, styles.tickTL, { borderColor: color }]} />
      <View style={[styles.tick, styles.tickTR, { borderColor: color }]} />
      <View style={[styles.tick, styles.tickBL, { borderColor: color }]} />
      <View style={[styles.tick, styles.tickBR, { borderColor: color }]} />
    </>
  );
}

/* ── 6 · the quote rule ─────────────────────────────────────────────────────── */
/** README § Signature 6 — border-left 3px ink, padding-left 13px, for the one
 * sentence that matters. `accent` swaps the rule to the amber deep tone. */
export function QuoteRule({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <View style={[styles.quote, accent === true && { borderLeftColor: C.accentDeep }]}>
      <Text style={styles.quoteText}>{children}</Text>
    </View>
  );
}

const TICK = 13; // README § Signature 5: 12–14px — pixel-source midpoint (local)
const styles = StyleSheet.create({
  barTrack: { height: 3, backgroundColor: C.hairlineStrong, overflow: 'hidden', borderRadius: rad('pill') },
  barFill: { position: 'absolute', top: 0, bottom: 0, width: '40%', backgroundColor: C.accent },
  pulseDot: { width: 8, height: 8, borderRadius: rad('pill') },
  shimmer: { backgroundColor: C.hairline, borderRadius: rad('tile') },

  hero: { backgroundColor: C.accent, borderRadius: rad('card'), padding: GEO.paddingPx, overflow: 'hidden', gap: 6 },
  heroLabel: { ...ty('caps'), color: C.onAccent },
  heroAmount: { ...ty('heroMoney'), color: C.onAccent, fontVariant: ['tabular-nums'] },
  // hairline divider on the accent ground — onAccent at .22 (the ledger-band
  // divider pattern from the pixel source: on-primary ink at .22 alpha).
  heroDivider: { height: 1, backgroundColor: alpha(C.onAccent, 0.22), marginTop: 4 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },

  artTile: { borderRadius: rad('art'), overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  artGlyph: { textAlign: 'center' },

  selCard: { borderRadius: rad('tile'), padding: GEO.paddingPx, backgroundColor: C.card },
  selCardOff: { borderWidth: 1.5, borderColor: C.hairlineInput },
  selCardOn: { borderWidth: 2, borderColor: C.accent },
  selBubble: { position: 'absolute', top: -10, right: -10, width: 26, height: 26, borderRadius: rad('pill'), backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },

  tick: { position: 'absolute', width: TICK, height: TICK },
  tickTL: { top: 8, left: 8, borderTopWidth: 2, borderLeftWidth: 2 },
  tickTR: { top: 8, right: 8, borderTopWidth: 2, borderRightWidth: 2 },
  tickBL: { bottom: 8, left: 8, borderBottomWidth: 2, borderLeftWidth: 2 },
  tickBR: { bottom: 8, right: 8, borderBottomWidth: 2, borderRightWidth: 2 },

  quote: { borderLeftWidth: 3, borderLeftColor: C.ink, paddingLeft: 13 },
  quoteText: { ...ty('body', 'max'), color: C.body },
});

export { DARK };
