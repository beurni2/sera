import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Svg, Path, Rect, Circle, Line, G } from 'react-native-svg';
import {
  sharedColour,
  seraColour,
  type as typo,
  spacing,
  radius,
  touch,
  motion,
  landmark,
  interaction,
  band,
  ribbon,
  celebration,
} from '@platform/ui-tokens';
import { FONT_WEIGHTS, type FontWeight } from './fonts';
import {
  IconRepere,
  IconZone,
  IconEcouter,
  IconScelle,
  IconCadenas,
  IconHorsligne,
  IconCoche,
  IconSos,
  type IconProps,
} from './icons';

/**
 * WO-6.1 — LE VISAGE, Grand Teint (canon ui-tokens v0.9.0). The rider kit
 * rebuilt on the founder's signed design bundle (design_handoff_grand_teint,
 * « Sera - Prototype.dc.html ») — the print-notice grammar: near-black ink on
 * warm paper, hairline tables, radius-0 boxes, one amber accent, 900-weight
 * poster titles, no shadow theatre. Every colour, size, radius and duration
 * resolves to a token (the scan test proves zero hardcode). Navigation and
 * custody SEMANTICS live in App.tsx + src/demo/store.ts (byte-identical to
 * WO-4.1/4.3) and are untouched by this layer. RN primitives + react-native-svg
 * only — zero new dependencies.
 */

// The sera palette, resolved by construction exactly as themes.js builds
// seraTheme.colours — but with precise per-key string types (the Theme's
// `& Record<string, string>` index would otherwise widen accent keys to
// `string | undefined` under noUncheckedIndexedAccess).
const C = { ...sharedColour, ...seraColour };
const T = typo.scale;

/* Type helpers — the token scale carries `lh` as a unitless multiplier and
 * `wght` as a variable-font axis; RN wants an absolute lineHeight and a
 * fontWeight string, and the embedded Archivo weight resolves per file
 * (native config-plugin embedding — see app.json + COLD-START.md). */
const EMBED_WEIGHTS = Object.keys(FONT_WEIGHTS).map(Number);
const fam = (w: number): string => {
  const nearest = EMBED_WEIGHTS.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
  return FONT_WEIGHTS[nearest as FontWeight].replace('.ttf', '');
};
const lh = (t: { size: number; lh: number }): number => t.size * t.lh;
const wt = (w: number): TextStyle['fontWeight'] => String(w) as TextStyle['fontWeight'];
/** A text style straight from a scale token (family + size + lineHeight + weight). */
const textOf = (t: { size: number; lh: number; wght: number }): TextStyle => ({
  fontFamily: fam(t.wght),
  fontSize: t.size,
  lineHeight: lh(t),
  fontWeight: wt(t.wght),
});

/* Parse the motion token's CSS cubic-bezier string into an RN Easing — the
 * ONE soft spring, expressed as the platform's timing curve (transform+opacity
 * only; layout never animates). */
const bezier = (css: string): ((t: number) => number) => {
  const raw = /cubic-bezier\(([^)]+)\)/.exec(css)?.[1];
  if (raw === undefined) return Easing.out(Easing.cubic);
  const n = raw.split(',').map((x) => Number(x.trim()));
  return Easing.bezier(n[0] ?? 0, n[1] ?? 0, n[2] ?? 1, n[3] ?? 1);
};
const SPRING_SOFT = bezier(motion.springSoft);
const POP = bezier(motion.springPop);

/** The illustrated-scene height (the design's 320×150 scene, kept ratio). */
const ILLO_HEIGHT = spacing.xxl * 4;

/* ============================ CHROME ============================ */

/* The theme strip — the ONE permanent brand mark: a 4 px amber band under the
 * header (band.themeStripPx · colour.sera.themeStrip). */
export function ThemeStrip() {
  return <View style={styles.themeStrip} accessibilityElementsHidden />;
}

/* Header (prototype `SÉRA · MOUSSA` row): back chip · title/context · right
 * slot chip. Caps + letterspacing for wayfinding. */
export function AppHeader({
  title,
  subtitle,
  backLabel,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string | undefined;
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
  right?: React.ReactNode | undefined;
}) {
  return (
    <View style={styles.header}>
      {onBack !== undefined && (
        <Pressable
          style={({ pressed }) => [styles.backChip, pressed && styles.pressed]}
          onPress={onBack}
          accessibilityRole="button"
        >
          <Text style={styles.backChipText}>{backLabel}</Text>
        </Pressable>
      )}
      <View style={styles.headerTitleBlock}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text style={styles.headerSub} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
    </View>
  );
}

/* The offline banner — a full-width ink block (state doctrine §6): « vos
 * actions sont en file, jamais perdues ». */
export function OfflineBanner({ label }: { label: string }) {
  return (
    <View style={styles.offlineBanner}>
      <IconHorsligne size={T.body.size} color={C.onInk} />
      <Text style={styles.offlineBannerText}>{label}</Text>
    </View>
  );
}

/* Bottom hub bar (prototype tabbar): icon + label, active = ink underline.
 * Tabs are waypoint RESETS (App owns the semantics; never a journey edge). */
export interface TabItem {
  key: string;
  Icon: (p: IconProps) => React.JSX.Element;
  label: string;
  active: boolean;
  onPress: () => void;
}
export function TabBar({ items }: { items: readonly TabItem[] }) {
  return (
    <View style={styles.tabBar}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          style={[styles.tab, item.active && styles.tabActive]}
          onPress={item.onPress}
          accessibilityRole="tab"
          accessibilityState={{ selected: item.active }}
        >
          <item.Icon size={T.title.size} color={item.active ? C.ink : C.muted} />
          <Text style={[styles.tabLabel, item.active && styles.tabLabelActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* The sandbox preview ribbon (« APERÇU — BAC À SABLE » · ribbon.sandbox). */
export function PreviewRibbon({ label }: { label: string }) {
  return (
    <View style={styles.ribbon}>
      <Text style={styles.ribbonText}>{label}</Text>
    </View>
  );
}

/* ============================ SURFACES ============================ */

/* The hairline table (§5.1): content in a bordered box, radius 0. `ink` gives
 * the 2 px ink frame; default is the hairline frame. */
export function Card({
  children,
  ink,
  accent,
  style,
}: {
  children: React.ReactNode;
  ink?: boolean | undefined;
  accent?: boolean | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.card,
        ink === true && styles.cardInk,
        accent === true && styles.cardAccent,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* Section overline (§5.6 caps label). */
export function Overline({ children }: { children: React.ReactNode }) {
  return <Text style={styles.overline}>{children}</Text>;
}

/* Poster title — the 900-weight uppercase header (§4). */
export function PosterTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.posterTitle}>{children}</Text>;
}

/* The quote rule (§5.7): a 3 px ink left-border paragraph for the one sentence
 * that matters. */
export function QuoteRule({ children, tone }: { children: React.ReactNode; tone?: 'ink' | 'accent' }) {
  return (
    <View style={[styles.quoteRule, tone === 'accent' && styles.quoteRuleAccent]}>
      <Text style={styles.quoteRuleText}>{children}</Text>
    </View>
  );
}

/* Body copy — sentence-case speech, ≥16 dp, weight 500. */
export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

/* List row (prototype course cards): fixed height, ink glyph tile, title +
 * meta, chips, chevron. `muted` is the closed-course treatment (never
 * pressable — App passes no onPress). */
export function ListRow({
  Icon,
  code,
  title,
  meta,
  chip,
  muted,
  onPress,
}: {
  Icon: (p: IconProps) => React.JSX.Element;
  code?: string | undefined;
  title: string;
  meta?: string | undefined;
  chip?: React.ReactNode | undefined;
  muted?: boolean | undefined;
  onPress?: (() => void) | undefined;
}) {
  const body = (
    <>
      <View style={[styles.rowGlyphBox, muted === true && styles.rowGlyphBoxMuted]}>
        <Icon size={T.title.size} color={muted === true ? C.soft : C.onInk} />
      </View>
      <View style={styles.rowBody}>
        {code !== undefined && <Text style={styles.rowCode}>{code}</Text>}
        <Text style={[styles.rowTitle, muted === true && styles.rowTitleMuted]} numberOfLines={1}>
          {title}
        </Text>
        {meta !== undefined && (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        )}
        {chip !== undefined && <View style={styles.rowChipLine}>{chip}</View>}
      </View>
      {onPress !== undefined && (
        <Text style={styles.rowChevron} accessibilityElementsHidden>
          ›
        </Text>
      )}
    </>
  );
  if (onPress === undefined) return <View style={[styles.row, muted === true && styles.rowMuted]}>{body}</View>;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}>
      {body}
    </Pressable>
  );
}

/* ============================ BUTTONS ============================ */
/* One primary per screen, full-width, h≈56 (§5 grid). Press feedback is a
 * transform/opacity swap within the touch budget (motion.instantMs). */

const buttonStyle = (base: StyleProp<ViewStyle>) =>
  ({ pressed }: { pressed: boolean }) => [base, pressed && styles.pressed];

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      style={buttonStyle([styles.buttonBase, styles.buttonPrimary, disabled === true && styles.buttonDisabled])}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={styles.buttonPrimaryText}>{label}</Text>
    </Pressable>
  );
}
export function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={buttonStyle([styles.buttonBase, styles.buttonSecondary])} onPress={onPress} accessibilityRole="button">
      <Text style={styles.buttonSecondaryText}>{label}</Text>
    </Pressable>
  );
}
export function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={buttonStyle([styles.buttonBase, styles.buttonGhost])} onPress={onPress} accessibilityRole="button">
      <Text style={styles.buttonGhostText}>{label}</Text>
    </Pressable>
  );
}
/* The refusal arm's own dignified style — refusal as polished as acceptance
 * (charter: the refusal path as dignified as the purchase path). A bordered
 * danger button, never a grey whisper of shame. */
export function DangerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={buttonStyle([styles.buttonBase, styles.buttonDanger])} onPress={onPress} accessibilityRole="button">
      <Text style={styles.buttonDangerText}>{label}</Text>
    </Pressable>
  );
}

/* ============================ CHIPS ============================ */

export type ChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';
const CHIP: Record<ChipTone, { bg: string; fg: string }> = {
  ok: { bg: C.success, fg: C.onInk },
  warn: { bg: C.warningTint, fg: C.warning },
  bad: { bg: C.danger, fg: C.onInk },
  info: { bg: C.ink, fg: C.onInk },
  muted: { bg: C.sand, fg: C.muted },
};
/* A solid state chip — a caps label on a calm wash; state is always visible,
 * never a sentence buried in prose. */
export function StatusChip({ tone, label }: { tone: ChipTone; label: string }) {
  const c = CHIP[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}
/* The proposed-course amber flag (prototype « PROPOSÉE »). */
export function AccentChip({ label }: { label: string }) {
  return (
    <View style={styles.accentChip}>
      <Text style={styles.accentChipText}>{label}</Text>
    </View>
  );
}

/* ============================ LE REPÈRE (signature) ============================ */

/* « Le repère, pas l'adresse » (§4, DESIGN-LANGUAGE §4) — Séra's SIGNATURE.
 * The illustrated scene is transcribed verbatim from the design bundle
 * (« Icones et Repere.dc.html » — la carte repère illustrée): a market
 * pharmacy (green cross), a striped kiosk, a blue portail — flat 2 px ink,
 * system flats, zero gradient, sun-readable. Every colour is a
 * landmark.illustration token (the bleuPortail depicts real blue gates and
 * enters chrome nowhere). Corner ticks frame it as documentary evidence. */
const IL = landmark.illustration;
function LandmarkIllustration() {
  return (
    <View style={styles.illoWrap}>
      <Svg viewBox="0 0 320 150" width="100%" height={ILLO_HEIGHT} accessibilityElementsHidden>
        {/* ground */}
        <Rect x={0} y={126} width={320} height={24} fill={IL.sand} />
        <Path d="M0 126h320" stroke={IL.ink} strokeWidth={2} />
        {/* sun */}
        <Circle cx={282} cy={26} r={12} fill={IL.amber} />
        <G stroke={IL.amber} strokeWidth={2} strokeLinecap="round">
          <Path d="M282 6v-4" />
          <Path d="M282 46v4" />
          <Path d="M262 26h-4" />
          <Path d="M302 26h4" />
          <Path d="M268 12l-3-3" />
          <Path d="M296 40l3 3" />
          <Path d="M296 12l3-3" />
          <Path d="M268 40l-3 3" />
        </G>
        {/* pharmacy building + wax awning + green cross */}
        <Rect x={10} y={38} width={112} height={12} fill={IL.sand} stroke={IL.ink} strokeWidth={2} />
        <Rect x={14} y={50} width={104} height={76} fill={IL.paper} stroke={IL.ink} strokeWidth={2} />
        <G stroke={IL.ink} strokeWidth={1.6}>
          <Rect x={20} y={64} width={16} height={10} fill={IL.terracotta} />
          <Rect x={36} y={64} width={16} height={10} fill={IL.paper} />
          <Rect x={52} y={64} width={16} height={10} fill={IL.terracotta} />
          <Rect x={68} y={64} width={16} height={10} fill={IL.paper} />
          <Rect x={84} y={64} width={16} height={10} fill={IL.terracotta} />
          <Rect x={100} y={64} width={12} height={10} fill={IL.paper} />
        </G>
        <Rect x={54} y={88} width={24} height={38} fill={IL.sand} stroke={IL.ink} strokeWidth={2} />
        <Rect x={24} y={86} width={18} height={15} fill={IL.sand} stroke={IL.ink} strokeWidth={1.6} />
        <Rect x={90} y={86} width={18} height={15} fill={IL.sand} stroke={IL.ink} strokeWidth={1.6} />
        <Circle cx={66} cy={26} r={11} fill={IL.green} />
        <Path d="M66 20v12" stroke={IL.paper} strokeWidth={3.4} strokeLinecap="round" />
        <Path d="M60 26h12" stroke={IL.paper} strokeWidth={3.4} strokeLinecap="round" />
        <Path d="M66 37v9" stroke={IL.ink} strokeWidth={2} />
        {/* kiosk — striped awning */}
        <Path d="M136 84h72l-7 16h-58z" fill={IL.amber} stroke={IL.ink} strokeWidth={2} />
        <G stroke={IL.ink} strokeWidth={1.4}>
          <Path d="M150 84l-2 16" />
          <Path d="M164 84l-1 16" />
          <Path d="M178 84l1 16" />
          <Path d="M192 84l2 16" />
        </G>
        <Rect x={142} y={100} width={60} height={26} fill={IL.paper} stroke={IL.ink} strokeWidth={2} />
        <Path d="M146 100v26" stroke={IL.ink} strokeWidth={1.4} />
        <Path d="M198 100v26" stroke={IL.ink} strokeWidth={1.4} />
        <Circle cx={160} cy={96} r={4} fill={IL.terracotta} stroke={IL.ink} strokeWidth={1.4} />
        <Circle cx={172} cy={96} r={4} fill={IL.green} stroke={IL.ink} strokeWidth={1.4} />
        <Circle cx={184} cy={96} r={4} fill={IL.terracotta} stroke={IL.ink} strokeWidth={1.4} />
        {/* the blue portail */}
        <Rect x={212} y={62} width={98} height={10} fill={IL.paper} stroke={IL.ink} strokeWidth={2} />
        <Rect x={216} y={72} width={90} height={54} fill={IL.sand} stroke={IL.ink} strokeWidth={2} />
        <Rect x={234} y={80} width={25} height={46} fill={IL.bleuPortail} stroke={IL.ink} strokeWidth={2} />
        <Rect x={263} y={80} width={25} height={46} fill={IL.bleuPortail} stroke={IL.ink} strokeWidth={2} />
        <G stroke={IL.paper} strokeWidth={1.3} opacity={0.75}>
          <Line x1={241} y1={84} x2={241} y2={122} />
          <Line x1={248} y1={84} x2={248} y2={122} />
          <Line x1={270} y1={84} x2={270} y2={122} />
          <Line x1={277} y1={84} x2={277} y2={122} />
        </G>
        <Circle cx={259} cy={104} r={1.8} fill={IL.ink} />
        <Circle cx={264} cy={104} r={1.8} fill={IL.ink} />
      </Svg>
      <View style={[styles.cornerTick, styles.tickTL]} />
      <View style={[styles.cornerTick, styles.tickTR]} />
      <View style={[styles.cornerTick, styles.tickBL]} />
      <View style={[styles.cornerTick, styles.tickBR]} />
    </View>
  );
}

/* The full LandmarkCard: zone header (repère icon + caps zone), the illustrated
 * scene, then the hierarchy ladder repère → indications, then the voice-play
 * row. `illustrated` shows the signature scene (R4/le repère); at the door it
 * can be compact. */
export function LandmarkCard({
  zone,
  lines,
  repereLabel,
  indicationsLabel,
  illustrated,
  voice,
}: {
  zone: string;
  lines: readonly [string, string, string];
  repereLabel: string;
  indicationsLabel: string;
  illustrated?: boolean | undefined;
  voice?: { label: string; time: string; playing: boolean; onPress: () => void } | undefined;
}) {
  return (
    <View style={styles.landmarkCard}>
      <View style={styles.landmarkHead}>
        <IconRepere size={T.body.size} color={C.ink} />
        <Text style={styles.landmarkZone}>{lines[2] || zone}</Text>
      </View>
      {illustrated === true && <LandmarkIllustration />}
      <View style={styles.landmarkBody}>
        <Text style={styles.landmarkRepereLabel}>{repereLabel}</Text>
        <Text style={styles.landmarkRepere}>{lines[0]}</Text>
        <Text style={styles.landmarkIndicationsLabel}>{indicationsLabel}</Text>
        <View style={styles.landmarkIndicationsRow}>
          <IconZone size={T.caption.size} color={C.soft} />
          <Text style={styles.landmarkIndications}>{lines[1]}</Text>
        </View>
        {voice !== undefined && (
          <VoicePlayRow label={voice.label} time={voice.time} playing={voice.playing} onPress={voice.onPress} />
        )}
      </View>
    </View>
  );
}

/* « La voix » (§5.5) — the listen affordance: an ink block with the amber play
 * triangle, an underlined caps label, and a tabular timer. Recorded audio only
 * (Ten Laws #5 — voice = recorded audio, never generative). */
export function VoicePlayRow({
  label,
  time,
  playing,
  onPress,
}: {
  label: string;
  time: string;
  playing: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.voiceRow, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: playing }}
    >
      <View style={styles.voiceGlyph}>
        <IconEcouter size={T.body.size} color={C.accent} />
      </View>
      <Text style={styles.voiceLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.voiceTime}>{time}</Text>
    </Pressable>
  );
}

/* ============================ CHECKLIST ============================ */

/* Check row (prototype R5 density): an ink square + label, the whole row a
 * ≥48 px target via the touch token. The gate itself lives in the demo store /
 * custody flow (bounded objective conformity — never authenticity/quality). */
export function CheckRow({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
        {checked && <IconCoche size={T.body.size} color={C.onInk} />}
      </View>
      <Text style={[styles.checkLabel, checked && styles.checkLabelOn]}>{label}</Text>
    </Pressable>
  );
}

/* ============================ CODE (R10) ============================ */

/* The drop-code frame (prototype R10): documentary cells + a keypad. It exists
 * ONLY here, on the drop screen — and the drop screen is reachable only after
 * the provider-confirmed door payment (SE-I11; the journey spine pins it). */
export function CodeCells({ value, length }: { value: string; length: number }) {
  return (
    <View style={styles.codeCells}>
      {Array.from({ length }, (_, i) => (
        <View key={i} style={[styles.codeCell, value.length === i && styles.codeCellActive]}>
          <Text style={styles.codeCellText}>{value[i] ?? ''}</Text>
        </View>
      ))}
    </View>
  );
}
export function Keypad({ onKey, onBack }: { onKey: (d: string) => void; onBack: () => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'blank'];
  return (
    <View style={styles.keypad}>
      {keys.map((k, i) => {
        if (k === 'blank') return <View key={i} style={styles.keyBlank} />;
        const isBack = k === 'back';
        return (
          <Pressable
            key={i}
            style={({ pressed }) => [styles.key, pressed && styles.pressed]}
            onPress={() => (isBack ? onBack() : onKey(k))}
            accessibilityRole="button"
          >
            <Text style={styles.keyText}>{isBack ? '‹' : k}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ============================ STATES ============================ */

/* Pending / offline-queued (state doctrine §6): ink-bordered, labelled, calm —
 * a pulse bar for waiting texture, never a bare spinner, never a green check
 * before the server says so. Queued = pending, never done. */
export function PendingNotice({ lines }: { lines: readonly string[] }) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(0.12)).current;
  useEffect(() => {
    if (reduced) {
      scale.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.92, duration: motion.standardMs, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.12, duration: motion.standardMs, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale, reduced]);
  return (
    <View style={styles.pending}>
      <View style={styles.pendingBarTrack}>
        <Animated.View style={[styles.pendingBar, { transform: [{ scaleX: scale }] }]} />
      </View>
      {lines.map((line) => (
        <Text key={line} style={styles.pendingText}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/* Honest empty state (§6) — states the next action, never sadness. */
export function EmptyState({
  Icon,
  title,
  hint,
}: {
  Icon: (p: IconProps) => React.JSX.Element;
  title: string;
  hint?: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Icon size={T.display.size} color={C.soft} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint !== undefined && <Text style={styles.emptyHint}>{hint}</Text>}
    </View>
  );
}

/* Reduced-motion hook — the doctrine's flag, honoured everywhere motion runs. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/* Skeleton (§2 « jamais un spinner nu ») — exact-dimension placeholder, calm
 * pulse; static under reduced motion. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: interaction.skeletonPulseFloor, duration: motion.standardMs, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: motion.standardMs, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return <Animated.View style={[styles.skeleton, { opacity: pulse }, style]} />;
}

/* « La loi du mouvement » — the screen change eases in on the ONE soft spring
 * (motion.springSoft), transform+opacity only, never blocking input, static
 * under reduced motion. */
export function ScreenTransition({ screenKey, children }: { screenKey: string; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.standardMs,
      easing: SPRING_SOFT,
      useNativeDriver: true,
    }).start();
  }, [screenKey, reduced, progress]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [spacing.md, 0] });
  return (
    <Animated.View style={[styles.transitionFill, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

/* ============================ CELEBRATION (R11) ============================ */

/* « Course validée » (celebration.courseValidee) — the rider's ONE named joy
 * moment: a road-chevron burst, halo + ring, ink badge. ≤ 800 ms, non-blocking
 * (absolute overlay, tap to skip), transform+opacity only, and a static badge
 * under reduced motion (loses no information). */
const CEL = celebration.courseValidee;
export function CourseValideeCelebration({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion();
  const halo = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const badge = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const chevrons = useRef(Array.from({ length: celebration.particleCount }, () => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduced) {
      badge.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.timing(halo, { toValue: 1, duration: celebration.haloMs, easing: SPRING_SOFT, useNativeDriver: true }),
      Animated.timing(ring, { toValue: 1, duration: celebration.ringMs, easing: SPRING_SOFT, useNativeDriver: true }),
      Animated.stagger(
        celebration.motifStaggerMs,
        chevrons.map((c) => Animated.timing(c, { toValue: 1, duration: celebration.motifMs, easing: bezier(motion.flyOut), useNativeDriver: true })),
      ),
      Animated.timing(badge, { toValue: 1, duration: celebration.badgeMs, delay: celebration.badgeDelayMs, easing: POP, useNativeDriver: true }),
    ]).start();
  }, [reduced, halo, ring, badge, chevrons]);

  return (
    <Pressable style={styles.celOverlay} onPress={onDone} accessibilityRole="button">
      {!reduced && (
        <>
          <Animated.View
            style={[
              styles.celHalo,
              { opacity: halo.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.55, 0] }), transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.18] }) }] },
            ]}
          />
          <Animated.View
            style={[
              styles.celRing,
              { opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.32] }) }] },
            ]}
          />
          {chevrons.map((c, i) => {
            const far = i % 2 === 0;
            const angle = i * (360 / celebration.particleCount) + 18;
            const dist = far ? -118 : -76;
            const col = i % 3 === 2 ? CEL.motifColours[1] : CEL.motifColours[0];
            return (
              <Animated.View
                key={i}
                style={[
                  styles.celChevron,
                  {
                    transform: [
                      { rotate: `${angle}deg` },
                      { translateY: c.interpolate({ inputRange: [0, 1], outputRange: [0, dist] }) },
                      { scale: c.interpolate({ inputRange: [0, 1], outputRange: [0.4, far ? 1 : 0.9] }) },
                    ],
                    opacity: c.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 1, 0] }),
                  },
                ]}
              >
                <Svg width={far ? T.title.size : T.body.size} height={far ? T.title.size : T.body.size} viewBox="0 0 20 20">
                  <Path d="M3.5 13L10 6.5 16.5 13" fill="none" stroke={col} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Animated.View>
            );
          })}
        </>
      )}
      <Animated.View style={[styles.celBadge, { opacity: badge, transform: [{ scale: badge.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }] }]}>
        <Text style={styles.celBadgeText}>{CEL.label}</Text>
      </Animated.View>
    </Pressable>
  );
}

/* ============================ SOS (R14) ============================ */

export type SosState = 'closed' | 'confirm' | 'queued' | 'raised' | 'escalated' | 'acknowledged' | 'over';

/* The SOS button lives on EVERY screen, reachable in ONE gesture. It is
 * unmissable (a red-ringed ink disc, bottom-right) yet NOT accidentally
 * triggerable (opening only reveals the sheet; firing requires a deliberate
 * HOLD). App.tsx mounts it unconditionally — a structural test proves it sits
 * outside every screen branch. */
export function SosButton({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.sosButton, pressed && styles.pressed]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <IconSos size={T.body.size} color={C.onInk} />
      <Text style={styles.sosButtonText}>{label}</Text>
    </Pressable>
  );
}

/* The SOS sheet — « MAINTENIR POUR DÉCLENCHER »: a hold, not a tap, so it can
 * be neither triggered by accident nor missed when it matters. The states are
 * driven from the store's incident status, never a timer:
 *   queued       — offline: honest waiting, NO acknowledgment shown (Ten Laws #7).
 *   raised       — in-hours: the dispatcher is being reached.
 *   escalated    — out-of-hours: the responsable is alerted; transport PENDING.
 *   acknowledged — someone answered (only ever via the store's acknowledgeSos).
 * The rider CANNOT self-acknowledge: raised/escalated show a clearly-marked
 * « (aperçu) » sandbox stand-in for the dispatch/network response arriving —
 * queued shows none, because a queued incident is unacknowledgeable. */
export function SosSheet({
  state,
  strings,
  onHoldStart,
  onHoldEnd,
  onCancel,
  onSandboxAck,
  onSafe,
  onClose,
}: {
  state: SosState;
  strings: {
    title: string;
    confirmHint: string;
    hold: string;
    cancel: string;
    holdNote: string;
    queued: string;
    queuedHint: string;
    raised: string;
    raisedHint: string;
    escalated: string;
    escalatedHint: string;
    transportPending: string;
    acknowledged: string;
    acknowledgedHint: string;
    previewAck: string;
    previewAckEscalated: string;
    safe: string;
    over: string;
    overHint: string;
    close: string;
  };
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onCancel: () => void;
  onSandboxAck: () => void;
  onSafe: () => void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const slide = useRef(new Animated.Value(state === 'closed' ? 1 : 0)).current;
  useEffect(() => {
    if (state === 'closed') return;
    if (reduced) {
      slide.setValue(0);
      return;
    }
    slide.setValue(1);
    Animated.timing(slide, { toValue: 0, duration: motion.standardMs, easing: SPRING_SOFT, useNativeDriver: true }).start();
  }, [state, reduced, slide]);
  if (state === 'closed') return null;
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 400] });
  return (
    <View style={styles.sosScrimWrap} pointerEvents="box-none">
      <Pressable style={styles.sosScrim} onPress={state === 'confirm' ? onCancel : undefined} />
      <Animated.View style={[styles.sosSheet, { transform: [{ translateY }] }]}>
        {state === 'confirm' && (
          <>
            <Text style={styles.sosSheetTitle}>{strings.title}</Text>
            <Text style={styles.sosSheetHint}>{strings.confirmHint}</Text>
            <Pressable
              style={({ pressed }) => [styles.sosHold, pressed && styles.pressed]}
              onPressIn={onHoldStart}
              onPressOut={onHoldEnd}
              accessibilityRole="button"
            >
              <Text style={styles.sosHoldText}>{strings.hold}</Text>
            </Pressable>
            <Pressable style={styles.sosCancel} onPress={onCancel} accessibilityRole="button">
              <Text style={styles.sosCancelText}>{strings.cancel}</Text>
            </Pressable>
            <Text style={styles.sosNote}>{strings.holdNote}</Text>
          </>
        )}
        {state === 'queued' && (
          <>
            {/* Offline law: queued = pending. NO acknowledgment is shown or
                reachable — nothing was sent, so nothing was seen. */}
            <Text style={styles.sosSheetTitle}>{strings.queued}</Text>
            <Text style={styles.sosSheetHint}>{strings.queuedHint}</Text>
            <Pressable style={styles.sosCancel} onPress={onCancel} accessibilityRole="button">
              <Text style={styles.sosCancelText}>{strings.close}</Text>
            </Pressable>
          </>
        )}
        {state === 'raised' && (
          <>
            <Text style={styles.sosSheetTitle}>{strings.raised}</Text>
            <Text style={styles.sosSheetHint}>{strings.raisedHint}</Text>
            <SosSandboxAck label={strings.previewAck} onPress={onSandboxAck} />
          </>
        )}
        {state === 'escalated' && (
          <>
            <Text style={styles.sosSheetTitleAmber}>{strings.escalated}</Text>
            <Text style={styles.sosSheetHint}>{strings.escalatedHint}</Text>
            {/* Transport unbound — named as PENDING, never a faked send. */}
            <Text style={styles.sosNote}>{strings.transportPending}</Text>
            {/* out-of-hours the responder is the FOUNDER, not the dispatch (NIT fix) */}
            <SosSandboxAck label={strings.previewAckEscalated} onPress={onSandboxAck} />
          </>
        )}
        {state === 'acknowledged' && (
          <>
            <Text style={styles.sosSheetTitleAmber}>{strings.acknowledged}</Text>
            <Text style={styles.sosSheetHint}>{strings.acknowledgedHint}</Text>
            <Pressable style={({ pressed }) => [styles.sosSafe, pressed && styles.pressed]} onPress={onSafe} accessibilityRole="button">
              <Text style={styles.sosSafeText}>{strings.safe}</Text>
            </Pressable>
          </>
        )}
        {state === 'over' && (
          <>
            <Text style={styles.sosSheetTitle}>{strings.over}</Text>
            <Text style={styles.sosSheetHint}>{strings.overHint}</Text>
            <Pressable style={styles.sosCancel} onPress={onClose} accessibilityRole="button">
              <Text style={styles.sosCancelText}>{strings.close}</Text>
            </Pressable>
          </>
        )}
      </Animated.View>
    </View>
  );
}

/* The dispatch/network response arriving — a SANDBOX stand-in, NOT the rider's
 * own hand. Clearly marked « (aperçu) » and dashed so it can never read as the
 * rider self-acknowledging; it drives the store's acknowledgeSos, which throws
 * on a queued incident. The live inbound ack replaces this at assembly. */
function SosSandboxAck({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.sosPreviewAck, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={styles.sosPreviewAckText}>{label}</Text>
    </Pressable>
  );
}

/* Sealed / custody badge — the « scellé » proof language, ownable across the
 * ecosystem (vérifié · scellé · livré par Séra). */
export function SealMark({ code, label }: { code: string; label: string }) {
  return (
    <View style={styles.sealMark}>
      <IconScelle size={T.title.size} color={C.ink} />
      <Text style={styles.sealCode}>{code}</Text>
      <Text style={styles.sealLabel}>{label}</Text>
    </View>
  );
}

/* Locked-frame glyph (R10 « L'entrée n'existe pas encore ») — a padlock over a
 * muted field; the entry does not exist before provider confirmation. */
export function LockedField({ title, hint }: { title: string; hint: string }) {
  return (
    <View style={styles.lockedField}>
      <IconCadenas size={T.display.size} color={C.soft} />
      <Text style={styles.lockedTitle}>{title}</Text>
      <Text style={styles.lockedHint}>{hint}</Text>
    </View>
  );
}

/* ============================ STYLES ============================ */

const HAIR = interaction.hairline;
const styles = StyleSheet.create({
  themeStrip: { height: band.themeStripPx, backgroundColor: C.themeStrip },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: touch.minTargetPx,
    borderBottomWidth: HAIR.thin,
    borderBottomColor: C.hairline,
  },
  backChip: {
    minHeight: touch.minTargetPx,
    minWidth: touch.minTargetPx,
    borderWidth: HAIR.medium,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  backChipText: { ...textOf(T.label), color: C.ink, letterSpacing: T.label.ls },
  headerTitleBlock: { flex: 1 },
  headerTitle: { ...textOf(T.title), color: C.ink },
  headerSub: { ...textOf(T.caption), color: C.muted },

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: C.ink,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  offlineBannerText: { ...textOf(T.caption), color: C.onInk, flex: 1, fontWeight: wt(T.bodyStrong.wght) },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.paper,
    borderTopWidth: HAIR.thin,
    borderTopColor: C.hairline,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    minHeight: touch.minTargetPx,
    justifyContent: 'center',
    borderTopWidth: interaction.selectedBorderPx,
    borderTopColor: C.paper,
  },
  tabActive: { borderTopColor: C.ink },
  tabLabel: { ...textOf(T.labelXS), color: C.muted, letterSpacing: T.labelXS.ls },
  tabLabelActive: { color: C.ink },

  ribbon: {
    backgroundColor: ribbon.sandbox.stripeA,
    borderBottomWidth: HAIR.thin,
    borderBottomColor: C.warningStripe,
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  ribbonText: { ...textOf(T.labelXS), color: ribbon.sandbox.text, letterSpacing: T.labelXS.ls },

  card: {
    backgroundColor: C.paper,
    borderWidth: HAIR.thin,
    borderColor: C.hairlineMid,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardInk: { borderWidth: interaction.selectedBorderPx, borderColor: C.ink },
  cardAccent: { backgroundColor: C.accentTint, borderColor: C.ink, borderWidth: interaction.selectedBorderPx },

  overline: { ...textOf(T.label), color: C.muted, letterSpacing: T.label.ls, textTransform: 'uppercase' },
  posterTitle: { ...textOf(T.titleLG), color: C.ink, textTransform: 'uppercase' },
  body: { ...textOf(T.body), color: C.body },

  quoteRule: { borderLeftWidth: interaction.hairline.strong + 1, borderLeftColor: C.ink, paddingLeft: spacing.md, paddingVertical: spacing.xs },
  quoteRuleAccent: { borderLeftColor: C.accentStrong },
  quoteRuleText: { ...textOf(T.caption), color: C.body, fontWeight: wt(T.bodyStrong.wght) },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: C.paper,
    borderWidth: interaction.selectedBorderPx,
    borderColor: C.ink,
    padding: spacing.md,
    minHeight: touch.minTargetPx + spacing.lg,
  },
  rowMuted: { borderWidth: HAIR.thin, borderColor: C.hairlineMid, opacity: interaction.pressedOpacity - 0.22 },
  rowGlyphBox: {
    width: touch.minTargetPx,
    height: touch.minTargetPx,
    backgroundColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowGlyphBoxMuted: { backgroundColor: C.sand },
  rowBody: { flex: 1, gap: spacing.xs / 2 },
  rowCode: { ...textOf(T.labelXS), color: C.muted, letterSpacing: T.labelXS.ls },
  rowTitle: { ...textOf(T.bodyStrong), color: C.ink },
  rowTitleMuted: { color: C.muted },
  rowMeta: { ...textOf(T.caption), color: C.muted },
  rowChipLine: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  rowChevron: { ...textOf(T.titleLG), color: C.soft },

  pressed: { opacity: interaction.pressedOpacity, transform: [{ scale: interaction.pressScale }] },

  buttonBase: {
    minHeight: touch.minTargetPx + spacing.sm,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonPrimary: { backgroundColor: C.ink },
  buttonPrimaryText: { ...textOf(T.title), color: C.onInk, letterSpacing: T.label.ls, textTransform: 'uppercase', fontSize: T.bodyStrong.size },
  buttonSecondary: { backgroundColor: C.paper, borderWidth: interaction.selectedBorderPx, borderColor: C.ink },
  buttonSecondaryText: { ...textOf(T.bodyStrong), color: C.ink, letterSpacing: T.label.ls, textTransform: 'uppercase', fontSize: T.row.size },
  buttonGhost: { borderWidth: HAIR.medium, borderColor: C.hairlineStrong, backgroundColor: C.paper },
  buttonGhostText: { ...textOf(T.bodyStrong), color: C.muted, letterSpacing: T.label.ls, textTransform: 'uppercase', fontSize: T.row.size },
  buttonDanger: { backgroundColor: C.paper, borderWidth: interaction.selectedBorderPx, borderColor: C.danger },
  buttonDangerText: { ...textOf(T.bodyStrong), color: C.danger, letterSpacing: T.label.ls, textTransform: 'uppercase', fontSize: T.row.size },
  buttonDisabled: { opacity: interaction.disabledOpacity },

  chip: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.chip,
  },
  chipText: { ...textOf(T.labelXS), letterSpacing: T.labelXS.ls, textTransform: 'uppercase' },
  accentChip: { alignSelf: 'flex-start', backgroundColor: C.accent, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.chip },
  accentChipText: { ...textOf(T.labelXS), color: C.ink, letterSpacing: T.labelXS.ls, textTransform: 'uppercase' },

  landmarkCard: { borderWidth: landmark.cardBorderPx, borderColor: C.ink, backgroundColor: C.paper },
  landmarkHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: HAIR.thin,
    borderBottomColor: C.hairline,
  },
  landmarkZone: { fontFamily: fam(landmark.zone.wght), fontSize: landmark.zone.size, lineHeight: lh(landmark.zone), fontWeight: wt(landmark.zone.wght), color: C.ink, letterSpacing: landmark.zone.ls, textTransform: 'uppercase' },
  illoWrap: { position: 'relative', borderBottomWidth: HAIR.thin, borderBottomColor: C.hairline },
  cornerTick: { position: 'absolute', width: interaction.cornerTick.sizePx, height: interaction.cornerTick.sizePx, borderColor: C.scrim },
  tickTL: { top: spacing.sm, left: spacing.sm, borderTopWidth: interaction.cornerTick.strokePx, borderLeftWidth: interaction.cornerTick.strokePx },
  tickTR: { top: spacing.sm, right: spacing.sm, borderTopWidth: interaction.cornerTick.strokePx, borderRightWidth: interaction.cornerTick.strokePx },
  tickBL: { bottom: spacing.sm, left: spacing.sm, borderBottomWidth: interaction.cornerTick.strokePx, borderLeftWidth: interaction.cornerTick.strokePx },
  tickBR: { bottom: spacing.sm, right: spacing.sm, borderBottomWidth: interaction.cornerTick.strokePx, borderRightWidth: interaction.cornerTick.strokePx },
  landmarkBody: { padding: spacing.md, gap: spacing.xs },
  landmarkRepereLabel: { ...textOf(T.label), color: C.muted, letterSpacing: T.label.ls, textTransform: 'uppercase' },
  landmarkRepere: { fontFamily: fam(landmark.repere.wght), fontSize: landmark.repere.size, lineHeight: lh(landmark.repere), fontWeight: wt(landmark.repere.wght), color: C.ink },
  landmarkIndicationsLabel: { ...textOf(T.label), color: C.muted, letterSpacing: T.label.ls, textTransform: 'uppercase', marginTop: spacing.xs },
  landmarkIndicationsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  landmarkIndications: { flex: 1, fontFamily: fam(landmark.indications.wght), fontSize: landmark.indications.size, lineHeight: lh(landmark.indications), fontWeight: wt(landmark.indications.wght), color: C.body },

  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: HAIR.medium,
    borderColor: C.hairlineStrong,
    padding: spacing.sm,
    marginTop: spacing.sm,
    minHeight: touch.minTargetPx,
  },
  voiceGlyph: { width: touch.minTargetPx - spacing.md, height: touch.minTargetPx - spacing.md, backgroundColor: C.ink, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  voiceLabel: { ...textOf(T.label), color: C.ink, letterSpacing: T.label.ls, textTransform: 'uppercase', flex: 1, textDecorationLine: 'underline' },
  voiceTime: { ...textOf(T.caption), color: C.ink, fontVariant: ['tabular-nums'], fontWeight: wt(T.bodyStrong.wght) },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.minTargetPx,
    borderWidth: HAIR.thin,
    borderColor: C.hairlineMid,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  checkBox: {
    width: spacing.xl,
    height: spacing.xl,
    borderRadius: radius.chip,
    borderWidth: HAIR.medium,
    borderColor: C.hairlineStrong,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: C.ink, borderColor: C.ink },
  checkLabel: { ...textOf(T.body), color: C.ink, flex: 1 },
  checkLabelOn: { fontWeight: wt(T.bodyStrong.wght) },

  codeCells: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  codeCell: {
    width: spacing.xl + spacing.lg,
    height: spacing.xxl + spacing.lg,
    borderWidth: HAIR.medium,
    borderColor: C.hairlineStrong,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeCellActive: { borderWidth: interaction.selectedBorderPx, borderColor: C.ink },
  codeCellText: { ...textOf(T.display), color: C.ink, fontVariant: ['tabular-nums'] },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', maxWidth: spacing.xxl * 8 + spacing.md, alignSelf: 'center' },
  key: {
    width: spacing.xxl * 2 + spacing.lg,
    height: spacing.xxl + spacing.lg,
    borderWidth: HAIR.medium,
    borderColor: C.hairlineStrong,
    borderRadius: radius.button,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBlank: { width: spacing.xxl * 2 + spacing.lg, height: spacing.xxl + spacing.lg },
  keyText: { ...textOf(T.titleLG), color: C.ink },

  pending: {
    borderWidth: HAIR.medium,
    borderColor: C.hairlineStrong,
    padding: spacing.md,
    gap: spacing.sm,
  },
  pendingBarTrack: { height: interaction.hairline.strong, backgroundColor: C.sand, overflow: 'hidden' },
  pendingBar: { height: interaction.hairline.strong, backgroundColor: C.accentStrong, transform: [{ scaleX: 0.5 }] },
  pendingText: { ...textOf(T.caption), color: C.body, fontWeight: wt(T.bodyStrong.wght) },

  emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...textOf(T.title), color: C.ink, textAlign: 'center' },
  emptyHint: { ...textOf(T.body), color: C.muted, textAlign: 'center' },

  skeleton: { backgroundColor: C.sand, minHeight: spacing.xl },

  transitionFill: { flex: 1 },

  celOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  celHalo: { position: 'absolute', width: spacing.xxl * 6, height: spacing.xxl * 6, borderRadius: radius.pill, backgroundColor: CEL.halo },
  celRing: { position: 'absolute', width: spacing.xxl * 4, height: spacing.xxl * 4, borderRadius: radius.pill, borderWidth: interaction.hairline.strong, borderColor: CEL.ring },
  celChevron: { position: 'absolute' },
  celBadge: { backgroundColor: CEL.badgeBg, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  celBadgeText: { ...textOf(T.title), color: CEL.badgeFg, letterSpacing: T.labelLG.ls, textTransform: 'uppercase' },

  sosButton: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.lg,
    width: touch.minTargetPx + spacing.sm,
    height: touch.minTargetPx + spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: C.ink,
    borderWidth: interaction.hairline.strong,
    borderColor: C.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosButtonText: { ...textOf(T.labelXS), color: C.onInk, letterSpacing: T.labelXS.ls },

  sosScrimWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  sosScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: C.scrim },
  sosSheet: { backgroundColor: C.ink, borderTopWidth: interaction.hairline.strong + 1, borderTopColor: C.danger, padding: spacing.lg, gap: spacing.sm },
  sosSheetTitle: { ...textOf(T.titleLG), color: C.onInk, textTransform: 'uppercase' },
  sosSheetTitleAmber: { ...textOf(T.title), color: C.accent, textTransform: 'uppercase' },
  sosSheetHint: { ...textOf(T.caption), color: C.onInk, opacity: interaction.pressedOpacity - 0.1 },
  sosHold: { backgroundColor: C.danger, minHeight: touch.minTargetPx + spacing.lg, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  sosHoldText: { ...textOf(T.title), color: C.onInk, letterSpacing: T.labelLG.ls, textTransform: 'uppercase', fontSize: T.bodyStrong.size },
  sosCancel: { alignItems: 'center', paddingVertical: spacing.md, minHeight: touch.minTargetPx, justifyContent: 'center' },
  sosCancelText: { ...textOf(T.label), color: C.onInk, opacity: interaction.pressedOpacity - 0.2, letterSpacing: T.label.ls, textTransform: 'uppercase' },
  sosNote: { ...textOf(T.caption), color: C.onInk, opacity: interaction.disabledOpacity + 0.15 },
  sosSafe: { borderWidth: interaction.hairline.strong, borderColor: C.onInk, minHeight: touch.minTargetPx, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  sosSafeText: { ...textOf(T.label), color: C.onInk, letterSpacing: T.label.ls, textTransform: 'uppercase' },
  // The sandbox « (aperçu) » ack stand-in: dashed + dimmed so it can never be
  // mistaken for the rider's own action or a real inbound acknowledgment.
  sosPreviewAck: { borderWidth: interaction.hairline.strong, borderColor: C.onInk, borderStyle: 'dashed', minHeight: touch.minTargetPx, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, opacity: interaction.disabledOpacity + 0.25 },
  sosPreviewAckText: { ...textOf(T.labelXS), color: C.onInk, letterSpacing: T.labelXS.ls, textTransform: 'uppercase' },

  sealMark: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: interaction.selectedBorderPx, borderColor: C.ink, padding: spacing.md, backgroundColor: C.accentTint },
  sealCode: { ...textOf(T.title), color: C.ink, fontVariant: ['tabular-nums'], letterSpacing: T.label.ls, flex: 1 },
  sealLabel: { ...textOf(T.caption), color: C.muted },

  lockedField: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  lockedTitle: { ...textOf(T.title), color: C.ink, textAlign: 'center' },
  lockedHint: { ...textOf(T.body), color: C.body, textAlign: 'center' },
});
