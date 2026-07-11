import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { seraTheme as theme, landmark, money, motion } from '@platform/ui-tokens';

/**
 * WO-4.2R — LE VISAGE. The per-app component kit, built ONCE on ui-tokens
 * v2 (pin 539dbc8a) against the founder's prototype patterns
 * (boutik-plus design-reference/faso-commerce-prototype.jsx — feel/flow
 * reference ONLY; its Séra is dark-themed and canon seraTheme is LIGHT —
 * the TOKENS win and own every color, size and duration; the scan test
 * proves zero hardcoded style values). RN primitives only — zero new
 * dependencies. Navigation and custody semantics live in App.tsx and
 * src/demo/store.ts and are untouched by this layer. No animated moment
 * component exists here — the rider's named moment is NOT in this order.
 */

/* The woven band — the ecosystem signature (prototype `.band`): a slim
 * tri-color strip on the theme's own palette, at the very top of the app. */
const BAND_SEQUENCE = [
  theme.colors.primary,
  theme.colors.surfaceSunken,
  theme.colors.warning,
  theme.colors.surfaceSunken,
] as const;
export function WaxBand() {
  return (
    <View style={styles.band} accessibilityElementsHidden>
      {Array.from({ length: 24 }, (_, i) => (
        <View key={i} style={[styles.bandSegment, { backgroundColor: BAND_SEQUENCE[i % BAND_SEQUENCE.length] }]} />
      ))}
    </View>
  );
}

/* Header (prototype `Top`): back chip · title + one-line context · right slot. */
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

/* Bottom hub bar (prototype `.tabbar`): icon + label, active = soft pill.
 * Tabs are waypoint RESETS under the ratified two-level-ladder law —
 * they never add journey edges; App.tsx owns the semantics. */
export interface TabItem {
  key: string;
  icon: string;
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
          <Text style={styles.tabIcon}>{item.icon}</Text>
          <Text style={[styles.tabLabel, item.active && styles.tabLabelActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* Card (prototype `.card`): raised surface, hairline, disciplined radius. */
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/* Section overline (prototype `.cap`). */
export function Overline({ children }: { children: React.ReactNode }) {
  return <Text style={styles.overline}>{children}</Text>;
}

/* List row (prototype tile rows): leading glyph box · title/meta/net · chip ·
 * chevron. `muted` is the closed-course treatment: the row stays on the list
 * with its honest status, visibly at rest (never pressable — App passes no
 * onPress for closed courses). */
export function ListRow({
  glyph,
  title,
  meta,
  net,
  chip,
  muted,
  onPress,
}: {
  glyph: string;
  title: string;
  meta?: string | undefined;
  net?: string | undefined;
  chip?: React.ReactNode | undefined;
  muted?: boolean | undefined;
  onPress?: (() => void) | undefined;
}) {
  const body = (
    <>
      <View style={[styles.rowGlyphBox, muted === true && styles.rowGlyphBoxMuted]}>
        <Text style={[styles.rowGlyph, muted === true && styles.rowGlyphMuted]}>{glyph}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, muted === true && styles.rowTitleMuted]} numberOfLines={1}>
          {title}
        </Text>
        {meta !== undefined && (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        )}
        {net !== undefined && <Text style={styles.rowNet}>{net}</Text>}
        {chip !== undefined && <View style={styles.rowChipLine}>{chip}</View>}
      </View>
      {onPress !== undefined && <Text style={styles.rowChevron}>›</Text>}
    </>
  );
  if (onPress === undefined) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}>
      {body}
    </Pressable>
  );
}

/* Button hierarchy (prototype `.btn .pri/.sec/.ghost/.danger`): one primary
 * per screen; press feedback within the touch budget (D17 < 100 ms — a style
 * swap on press, no animation to wait for). */
function buttonStyle(base: StyleProp<ViewStyle>) {
  return ({ pressed }: { pressed: boolean }) => [base, pressed && styles.pressed];
}
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
/* The refusal arm's own dignified style — refusal is as polished as
 * acceptance: the danger tone with full button presence, never a gray
 * whisper of shame (charter: the refusal path as dignified as the
 * purchase path). */
export function DangerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={buttonStyle([styles.buttonBase, styles.buttonDanger])} onPress={onPress} accessibilityRole="button">
      <Text style={styles.buttonDangerText}>{label}</Text>
    </Pressable>
  );
}

/* « L'argent en majesté » (DESIGN-LANGUAGE §2): the FCFA amount as the
 * hero of its screen — money.amountScale.hero, tabular numerals. The
 * rider demo world carries no door amount yet; the component stands ready
 * for the live door-payment figure at assembly. */
export function AmountHero({ label, amount }: { label?: string | undefined; amount: string }) {
  return (
    <View style={styles.amountHeroBlock}>
      {label !== undefined && <Text style={styles.amountHeroLabel}>{label}</Text>}
      <Text style={styles.amountHero}>{amount}</Text>
    </View>
  );
}

/* Status chip (prototype pills): a dot + label on a calm wash — state is
 * always visible, never a sentence. */
export type ChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';
const CHIP_COLOR: Record<ChipTone, string> = {
  ok: theme.colors.success,
  warn: theme.colors.warning,
  bad: theme.colors.danger,
  info: theme.colors.info,
  muted: theme.colors.inkMuted,
};
export function StatusChip({ tone, label }: { tone: ChipTone; label: string }) {
  return (
    <View style={styles.chip}>
      <View style={[styles.chipDot, { backgroundColor: CHIP_COLOR[tone] }]} />
      <Text style={[styles.chipText, { color: CHIP_COLOR[tone] }]}>{label}</Text>
    </View>
  );
}

/* « Le repère, pas l'adresse » (DESIGN-LANGUAGE §4) — Séra's SIGNATURE
 * element, a visual PRIDE: the landmark-first location block on the
 * landmark.hierarchy ladder (repère → indications → zone), with icon
 * slots from landmark.iconNames rendered as CTO-default text glyphs —
 * the ⏳ illustrated assets are future app-side work; the slots are wired
 * so the assets drop in without touching callers. */
const LANDMARK_GLYPHS = {
  [landmark.iconNames.repere]: '📍',
  [landmark.iconNames.zone]: '🏘️',
} as const;
export function LandmarkCard({ label, lines }: { label: string; lines: readonly [string, string, string] }) {
  return (
    <View style={styles.landmarkCard}>
      <Text style={styles.landmarkLabel}>{label}</Text>
      <View style={styles.landmarkRepereRow}>
        <Text style={styles.landmarkGlyph} accessibilityElementsHidden>
          {LANDMARK_GLYPHS[landmark.iconNames.repere]}
        </Text>
        <Text style={styles.landmarkRepere}>{lines[0]}</Text>
      </View>
      <Text style={styles.landmarkIndications}>{lines[1]}</Text>
      <View style={styles.landmarkZoneBadge}>
        <Text style={styles.landmarkZoneGlyph} accessibilityElementsHidden>
          {LANDMARK_GLYPHS[landmark.iconNames.zone]}
        </Text>
        <Text style={styles.landmarkZone}>{lines[2]}</Text>
      </View>
    </View>
  );
}

/* Check row (prototype `.check` density): a box + label per policy check,
 * the whole row a ≥44px target via the touch token. Display only — the
 * checklist gate itself lives in the demo store / custody flow. */
export function CheckRow({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
        {checked && <Text style={styles.checkMark}>✓</Text>}
      </View>
      <Text style={[styles.checkLabel, checked && styles.checkLabelOn]}>{label}</Text>
    </Pressable>
  );
}

/* Reduced-motion hook — the doctrine's flag, honored everywhere motion runs. */
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

/* Skeleton (doctrine §1: « jamais un spinner nu ») — a calm pulse; static
 * under reduced motion. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: motion.standard.durationMs, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: motion.standard.durationMs, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return <Animated.View style={[styles.skeleton, { opacity: pulse }, style]} />;
}

/* Honest empty state — designed, never apologetic. */
export function EmptyState({ glyph, title, hint }: { glyph: string; title: string; hint?: string }) {
  return (
    <Card style={styles.emptyState}>
      <Text style={styles.emptyGlyph}>{glyph}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint !== undefined && <Text style={styles.emptyHint}>{hint}</Text>}
    </Card>
  );
}

/* The offline/pending notice — queued = pending, never done. */
export function PendingNotice({ lines }: { lines: readonly string[] }) {
  return (
    <View style={styles.pendingNotice}>
      <View style={[styles.chipDot, { backgroundColor: theme.colors.warning }]} />
      <View style={styles.pendingBody}>
        {lines.map((line) => (
          <Text key={line} style={styles.pendingText}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

/* « La loi du mouvement » (DESIGN-LANGUAGE) — the screen change eases in
 * on the ONE soft spring; it explains, never decorates, and NEVER blocks
 * input (content is interactive from the first frame; static under
 * reduced motion). */
export function ScreenTransition({ screenKey, children }: { screenKey: string; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.spring(progress, {
      toValue: 1,
      damping: motion.springSoft.damping,
      stiffness: motion.springSoft.stiffness,
      mass: motion.springSoft.mass,
      useNativeDriver: true,
    }).start();
  }, [screenKey, reduced, progress]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [theme.spacing.md, 0] });
  return (
    <Animated.View style={[styles.transitionFill, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  band: { flexDirection: 'row', height: theme.spacing.sm },
  bandSegment: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    minHeight: theme.touch.minTargetPx,
  },
  backChip: {
    minHeight: theme.touch.minTargetPx,
    minWidth: theme.touch.minTargetPx,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  backChipText: { color: theme.colors.ink, fontSize: theme.typeScale.body.size, fontWeight: theme.typeScale.label.weight },
  headerTitleBlock: { flex: 1 },
  headerTitle: {
    color: theme.colors.ink,
    fontSize: theme.typeScale.heading.size,
    lineHeight: theme.typeScale.heading.lineHeight,
    fontWeight: theme.typeScale.title.weight,
  },
  headerSub: { color: theme.colors.inkMuted, fontSize: theme.typeScale.caption.size, lineHeight: theme.typeScale.caption.lineHeight },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surfaceRaised,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.line,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    minHeight: theme.touch.minTargetPx,
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: theme.colors.primarySoft },
  tabIcon: { fontSize: theme.typeScale.heading.size, lineHeight: theme.typeScale.heading.lineHeight },
  tabLabel: { color: theme.colors.inkMuted, fontSize: theme.typeScale.caption.size, fontWeight: theme.typeScale.label.weight },
  tabLabelActive: { color: theme.colors.primaryStrong },
  card: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.line,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    shadowColor: theme.colors.ink,
    shadowOpacity: theme.elevation.raised.shadowOpacity,
    shadowRadius: theme.elevation.raised.shadowRadius,
    shadowOffset: { width: 0, height: theme.elevation.raised.shadowOffsetY },
    elevation: theme.elevation.raised.shadowOffsetY,
  },
  overline: {
    color: theme.colors.inkMuted,
    fontSize: theme.typeScale.caption.size,
    lineHeight: theme.typeScale.caption.lineHeight,
    fontWeight: theme.typeScale.label.weight,
    textTransform: 'uppercase',
    letterSpacing: theme.spacing.xs / 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.line,
    padding: theme.spacing.md,
    minHeight: theme.touch.minTargetPx,
  },
  rowGlyphBox: {
    width: theme.touch.minTargetPx,
    height: theme.touch.minTargetPx,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowGlyphBoxMuted: { backgroundColor: theme.colors.surfaceSunken },
  rowGlyph: { fontSize: theme.typeScale.heading.size, color: theme.colors.primaryStrong, fontWeight: theme.typeScale.title.weight },
  rowGlyphMuted: { color: theme.colors.inkFaint },
  rowBody: { flex: 1, gap: theme.spacing.xs },
  rowTitle: { color: theme.colors.ink, fontSize: theme.typeScale.body.size, lineHeight: theme.typeScale.body.lineHeight, fontWeight: theme.typeScale.heading.weight },
  rowTitleMuted: { color: theme.colors.inkMuted },
  rowMeta: { color: theme.colors.inkMuted, fontSize: theme.typeScale.caption.size, lineHeight: theme.typeScale.caption.lineHeight },
  rowNet: {
    color: theme.colors.primaryStrong,
    fontSize: theme.typeScale.body.size,
    lineHeight: theme.typeScale.body.lineHeight,
    fontWeight: theme.typeScale.title.weight,
    fontVariant: ['tabular-nums'],
  },
  rowChipLine: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  rowChevron: { color: theme.colors.inkFaint, fontSize: theme.typeScale.title.size },
  pressed: { opacity: theme.elevation.overlay.shadowOpacity * 5, transform: [{ scale: 0.98 }] },
  buttonBase: {
    minHeight: theme.touch.minTargetPx + theme.spacing.sm,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  buttonPrimary: { backgroundColor: theme.colors.primary },
  buttonPrimaryText: { color: theme.colors.onPrimary, fontSize: theme.typeScale.bodyLarge.size, fontWeight: theme.typeScale.heading.weight },
  buttonSecondary: { backgroundColor: theme.colors.primarySoft },
  buttonSecondaryText: { color: theme.colors.primaryStrong, fontSize: theme.typeScale.bodyLarge.size, fontWeight: theme.typeScale.heading.weight },
  buttonGhost: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.line, backgroundColor: theme.colors.surfaceRaised },
  buttonGhostText: { color: theme.colors.ink, fontSize: theme.typeScale.bodyLarge.size, fontWeight: theme.typeScale.label.weight },
  buttonDanger: { backgroundColor: theme.colors.danger },
  buttonDangerText: { color: theme.colors.onPrimary, fontSize: theme.typeScale.bodyLarge.size, fontWeight: theme.typeScale.heading.weight },
  buttonDisabled: { opacity: theme.elevation.overlay.shadowOpacity * 3 },
  amountHeroBlock: { alignItems: 'center', gap: theme.spacing.xs },
  amountHeroLabel: { color: theme.colors.inkMuted, fontSize: theme.typeScale.body.size, lineHeight: theme.typeScale.body.lineHeight },
  amountHero: {
    color: theme.colors.primaryStrong,
    fontSize: money.amountScale.hero.size,
    lineHeight: money.amountScale.hero.lineHeight,
    fontWeight: money.amountScale.hero.weight,
    fontVariant: ['tabular-nums'],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    backgroundColor: theme.colors.surfaceSunken,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    alignSelf: 'flex-start',
  },
  chipDot: { width: theme.spacing.sm, height: theme.spacing.sm, borderRadius: theme.radius.pill },
  chipText: { fontSize: theme.typeScale.caption.size, fontWeight: theme.typeScale.label.weight },
  landmarkCard: {
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.lg,
    borderLeftWidth: theme.spacing.xs,
    borderLeftColor: theme.colors.primary,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  landmarkLabel: {
    color: theme.colors.primaryStrong,
    fontSize: theme.typeScale.caption.size,
    lineHeight: theme.typeScale.caption.lineHeight,
    fontWeight: theme.typeScale.label.weight,
    textTransform: 'uppercase',
    letterSpacing: theme.spacing.xs / 4,
  },
  landmarkRepereRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  landmarkGlyph: { fontSize: landmark.hierarchy.repere.size, lineHeight: landmark.hierarchy.repere.lineHeight },
  landmarkRepere: {
    flex: 1,
    color: theme.colors.primaryStrong,
    fontSize: landmark.hierarchy.repere.size,
    lineHeight: landmark.hierarchy.repere.lineHeight,
    fontWeight: landmark.hierarchy.repere.weight,
  },
  landmarkIndications: {
    color: theme.colors.ink,
    fontSize: landmark.hierarchy.indications.size,
    lineHeight: landmark.hierarchy.indications.lineHeight,
  },
  landmarkZoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
  },
  landmarkZoneGlyph: { fontSize: landmark.hierarchy.zone.size, lineHeight: landmark.hierarchy.zone.lineHeight },
  landmarkZone: {
    color: theme.colors.primaryStrong,
    fontSize: landmark.hierarchy.zone.size,
    lineHeight: landmark.hierarchy.zone.lineHeight,
    fontWeight: landmark.hierarchy.zone.weight,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    minHeight: theme.touch.minTargetPx,
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.line,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  checkBox: {
    width: theme.spacing.xl,
    height: theme.spacing.xl,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.inkFaint,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  checkMark: { color: theme.colors.onPrimary, fontSize: theme.typeScale.label.size, fontWeight: theme.typeScale.label.weight },
  checkLabel: { flex: 1, color: theme.colors.ink, fontSize: theme.typeScale.bodyLarge.size, lineHeight: theme.typeScale.bodyLarge.lineHeight },
  checkLabelOn: { color: theme.colors.primaryStrong, fontWeight: theme.typeScale.label.weight },
  skeleton: { backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.md, minHeight: theme.spacing.xl },
  emptyState: { alignItems: 'center', paddingVertical: theme.spacing.xxl },
  emptyGlyph: { fontSize: money.amountScale.hero.size, lineHeight: money.amountScale.hero.lineHeight },
  emptyTitle: { color: theme.colors.ink, fontSize: theme.typeScale.bodyLarge.size, fontWeight: theme.typeScale.heading.weight, textAlign: 'center' },
  emptyHint: { color: theme.colors.inkMuted, fontSize: theme.typeScale.body.size, lineHeight: theme.typeScale.body.lineHeight, textAlign: 'center' },
  pendingNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSunken,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  pendingBody: { flex: 1, gap: theme.spacing.xs },
  pendingText: { color: theme.colors.inkMuted, fontSize: theme.typeScale.caption.size, lineHeight: theme.typeScale.caption.lineHeight },
  transitionFill: { flex: 1 },
});
