import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { alpha, C, GEO, rad, ty } from './faso';
import { displayFace, textFace } from './faso-fonts';
import { WovenBand } from './signature';
import type { IconProps } from './icons';

/**
 * WO-FP-SERA · the Faso Premium chrome + list components (README § shared system;
 * HANDOFF §1). Built on the token bridge + the signature module; zero hardcode
 * (colour via C/alpha, type via ty, radii via rad). The header carries the woven
 * band (signature 1) under it; the status chip register mirrors the honest tones.
 * SKIN ONLY — no state, no custody, no franc logic.
 */

/** The permanent header: « S » monogram + « Séra » wordmark + context sub + a
 * right state chip, over the woven band (HANDOFF: monogram 38 or · « Séra » 18/800). */
export function FasoHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View>
      <View style={styles.header}>
        <View style={styles.monogram}>
          <Text style={styles.monogramText}>S</Text>
        </View>
        <View style={styles.headerTitles}>
          <Text style={styles.wordmark} numberOfLines={1}>{title}</Text>
          {subtitle !== undefined && <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text>}
        </View>
        {right}
      </View>
      <WovenBand />
    </View>
  );
}

export type ChipTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'accent';
const TONE: Record<ChipTone, { bg: string; fg: string }> = {
  ok: { bg: C.okBg, fg: C.okFg },
  warn: { bg: C.warnBg, fg: C.warnFg },
  bad: { bg: C.dangerBg, fg: C.dangerFg },
  info: { bg: C.accentSoft, fg: C.accentDeepAlt },
  muted: { bg: C.mutedBg, fg: C.mutedFg },
  // the FILLED-gold pill (planche R2 « PROPOSÉE » : bg #D9A441 / fg #241A05) —
  // the offer-window accent moment, one filled pill, never two.
  accent: { bg: C.accent, fg: C.onAccent },
};
/** A solid state chip — caps label on a calm wash; state always visible. */
export function StatusChip({ tone, label }: { tone: ChipTone; label: string }) {
  const c = TONE[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/** A course row (R2): white card, kind glyph tile, code + title + meta, chips,
 * chevron. `muted` is the closed-course treatment (never pressable). */
export function ListRow({
  Icon, code, title, meta, chip, muted, onPress,
}: {
  Icon: (p: IconProps) => React.JSX.Element;
  code?: string | undefined; title: string; meta?: string | undefined;
  chip?: React.ReactNode | undefined; muted?: boolean | undefined; onPress?: (() => void) | undefined;
}) {
  const inner = (
    <>
      <View style={[styles.glyphTile, muted === true && styles.glyphTileMuted]}>
        <Icon size={ty('view').fontSize} color={muted === true ? C.sub : C.onAccent} />
      </View>
      <View style={styles.rowBody}>
        {code !== undefined && <Text style={styles.rowCode}>{code}</Text>}
        <Text style={[styles.rowTitle, muted === true && { color: C.sub }]} numberOfLines={1}>{title}</Text>
        {meta !== undefined && <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>}
        {chip !== undefined && <View style={styles.rowChips}>{chip}</View>}
      </View>
      {onPress !== undefined && <Text style={styles.chevron} accessibilityElementsHidden>›</Text>}
    </>
  );
  if (onPress === undefined) return <View style={[styles.row, muted === true && styles.rowMutedCard]}>{inner}</View>;
  return <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}>{inner}</Pressable>;
}

/** The screen poster title (planche: « Mes courses » — Bricolage 800, 24px,
 * -.02em). The AppHeader carries the app identity; the body leads with the screen
 * name, as the planche does (two-title structure). */
export function ScreenTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.screenTitle}>{children}</Text>;
}

/** A planche status pill (9.5px caps, .08em) — filled by tone. Instrument at the
 * pixel-source size; the planche's weight-800 falls to Instrument's 700 (no 800
 * face), so the faithful RN weight is 700. */
function Pill({ tone, label }: { tone: ChipTone; label: string }) {
  const c = TONE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/** The 2ᵉ-passage lineage pill (planche: OUTLINED — border #8F6812, text #5F4403,
 * transparent). The lineage « suit le colis », never a filled state. */
function LineagePill({ label }: { label: string }) {
  return (
    <View style={styles.lineagePill}>
      <Text style={styles.lineagePillText}>{label}</Text>
    </View>
  );
}

/**
 * R2 course card — the TRUE planche anatomy (« Sera - Redesign » R2, lines 107–138):
 * an editorial card, NOT a glyph-tile list row. No icon tile, no chevron.
 *  · proposed : gold border 1.5 + gold-glow + a left gold bar + press-scale; the
 *    row is CRS-ref eyebrow · filled-gold PROPOSÉE pill · « avant HH:MM » deadline.
 *  · active   : hairline card; the row is the eyebrow · the REAL honest status pill
 *    (its own tone, never a fake gold) · optional 2ᵉ-passage outline pill.
 *  · done     : the receded warm-tint card at .7 — the closed course, at rest.
 * Title = Instrument 700 (the repère); subtitle = zone · who. The real status
 * vocabulary and tone (states law) are passed in; the card only draws them.
 */
export function CourseCard({
  variant, code, status, deadline, lineage, title, subtitle, onPress,
}: {
  variant: 'proposed' | 'active' | 'done';
  code: string;
  status: { label: string; tone: ChipTone };
  deadline?: string | undefined;
  lineage?: string | undefined;
  title: string;
  subtitle: string;
  onPress?: (() => void) | undefined;
}) {
  const cardStyle: StyleProp<ViewStyle> = [
    styles.courseCard,
    variant === 'proposed' && styles.courseProposed,
    variant === 'active' && styles.courseActive,
    variant === 'done' && styles.courseDone,
  ];
  const inner = (
    <>
      {variant === 'proposed' && <View style={styles.courseBar} accessibilityElementsHidden />}
      <View style={styles.courseTop}>
        <Text style={styles.courseCode}>{code}</Text>
        <Pill tone={status.tone} label={status.label} />
        {lineage !== undefined && <LineagePill label={lineage} />}
        {deadline !== undefined && <Text style={styles.courseDeadline}>{deadline}</Text>}
      </View>
      <Text style={[styles.courseTitle, variant === 'done' && styles.courseTitleDone]} numberOfLines={1}>{title}</Text>
      <Text style={styles.courseSub} numberOfLines={1}>{subtitle}</Text>
    </>
  );
  if (onPress === undefined) return <View style={cardStyle}>{inner}</View>;
  return <Pressable style={({ pressed }) => [cardStyle, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button">{inner}</Pressable>;
}

/** The bottom tab dock (README § Geometry: blur dock, active = soft-accent pill).
 * RN has no backdrop-filter, so the dock is the paper with a top hairline; the
 * active item is a soft-accent pill with deep text (the README's active treatment). */
export interface TabItem { key: string; Icon: (p: IconProps) => React.JSX.Element; label: string; active: boolean; onPress: () => void; }
export function TabBar({ items }: { items: readonly TabItem[] }) {
  return (
    <View style={styles.tabBar}>
      {items.map((it) => (
        <Pressable key={it.key} style={[styles.tab, it.active && styles.tabActive]} onPress={it.onPress} accessibilityRole="tab" accessibilityState={{ selected: it.active }}>
          <it.Icon size={ty('view').fontSize} color={it.active ? C.accentDeepAlt : C.sub} />
          <Text style={[styles.tabLabel, it.active && styles.tabLabelActive]}>{it.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Overline({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <Text style={[styles.overline, center === true && styles.centerText]}>{children}</Text>;
}
export function EmptyState({ Icon, title, hint }: { Icon: (p: IconProps) => React.JSX.Element; title: string; hint?: string | undefined }) {
  return (
    <View style={styles.empty}>
      <Icon size={40} color={C.sub} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint !== undefined && <Text style={styles.emptyHint}>{hint}</Text>}
    </View>
  );
}

export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

/** Primary CTA — amber ground, dark on-primary ink, Bricolage 800 (HANDOFF: CTA
 * primaire = or, texte sombre). One per screen; the shadow is the README's CTA glow. */
export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.primary, disabled === true && styles.primaryDisabled, pressed && styles.pressed]}
      onPress={onPress} disabled={disabled} accessibilityRole="button"
    >
      <Text style={[styles.primaryText, disabled === true && { color: C.disabledCtaFg }]}>{label}</Text>
    </Pressable>
  );
}
/** Ghost — the quiet secondary/refusal-entry arm; a hairline whisper. */
export function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.ghost, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button">
      <Text style={styles.ghostText}>{label}</Text>
    </Pressable>
  );
}

/** R10 drop-code cells — 6 cells, gold cursor on the active one, tnum Bricolage
 * digits (HANDOFF R10: cellules 44×54 r13, curseur = bordure or 2px). */
export function CodeCells({ value, length }: { value: string; length: number }) {
  return (
    <View style={styles.cells}>
      {Array.from({ length }, (_, i) => (
        <View key={i} style={[styles.cell, value.length === i && styles.cellActive]}>
          <Text style={styles.cellText}>{value[i] ?? ''}</Text>
        </View>
      ))}
    </View>
  );
}
/** R10 keypad — 3×4, white keys (HANDOFF: touches 54 r14 blanches, press scale .92). */
export function Keypad({ onKey, onBack }: { onKey: (d: string) => void; onBack: () => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'blank'];
  return (
    <View style={styles.keypad}>
      {keys.map((k, i) => {
        if (k === 'blank') return <View key={i} style={styles.keyBlank} />;
        const isBack = k === 'back';
        return (
          <Pressable key={i} style={({ pressed }) => [styles.key, pressed && styles.keyPressed]} onPress={() => (isBack ? onBack() : onKey(k))} accessibilityRole="button" accessibilityLabel={isBack ? 'Effacer' : k}>
            {/* planche R10: « ⌫ ». U+232B is not in the Bricolage subset (nor in
                Google's Bricolage), so it renders via the platform symbol fallback —
                identical to the planche's browser fallback. */}
            <Text style={styles.keyText}>{isBack ? '⌫' : k}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The FONT-PROOF STRIP (WO-FP-SERA STEP 0 · the type question, standing
 * independently of the layout). A specimen the founder eyeballs ON DEVICE in the
 * preview: the two built faces at their real weights, so « is this the type? » is
 * answerable from the phone, not from a name-table test. Preview-only (mounted
 * behind IS_PREVIEW); zero custody/money surface. */
const FONT_SPECIMEN: ReadonlyArray<readonly [string, string, number]> = [
  ['Bricolage 800 — titres', displayFace(800), 22],
  ['Bricolage 700 — chiffres 734921', displayFace(700), 20],
  ['Instrument 700 — statuts', textFace(700), 15],
  ['Instrument 600 — accents', textFace(600), 15],
  ['Instrument 500 — libellés', textFace(500), 15],
  ['Instrument 400 — le corps du texte', textFace(400), 14],
];
export function FontProofStrip() {
  return (
    <View style={styles.fontProof}>
      <Text style={styles.fontProofCaption}>ÉPREUVE TYPO — BRICOLAGE · INSTRUMENT</Text>
      {FONT_SPECIMEN.map(([label, face, size]) => (
        <Text key={label} style={{ fontFamily: face, fontSize: size, color: C.ink }} numberOfLines={1}>{label}</Text>
      ))}
    </View>
  );
}

const CARD_HAIR = 1;
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: GEO.paddingPx, paddingTop: 10, paddingBottom: 12, backgroundColor: C.paper },
  monogram: { width: 38, height: 38, borderRadius: 13, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontFamily: displayFace(800), fontSize: 22, fontWeight: '800', color: C.onAccent },
  headerTitles: { flex: 1 },
  wordmark: { ...ty('view'), color: C.ink },
  headerSub: { ...ty('caps'), color: C.sub },

  chip: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 9, borderRadius: rad('pill') },
  chipText: { ...ty('pill'), textTransform: 'uppercase' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: rad('card'), borderWidth: CARD_HAIR, borderColor: C.hairline, padding: 14, minHeight: 64 },
  rowMutedCard: { backgroundColor: C.dim, borderColor: C.hairlineStrong },

  // ── R2 course card (planche R2 lines 107–138): editorial card, no glyph tile ──
  screenTitle: { fontFamily: displayFace(800), fontSize: 24, fontWeight: '800', letterSpacing: 24 * -0.02, color: C.ink },
  courseCard: { borderRadius: rad('tile'), backgroundColor: C.card, paddingVertical: 15, paddingHorizontal: 16 },
  courseProposed: {
    borderWidth: 1.5, borderColor: C.accent, paddingLeft: 20,
    // the gold glow (planche box-shadow 0 16 36 -18 accent@.35); RN has no negative
    // spread, so an accent-tinted drop shadow approximates it.
    shadowColor: C.accent, shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 12 }, elevation: 6,
  },
  courseActive: { borderWidth: CARD_HAIR, borderColor: C.hairline },
  courseDone: { borderWidth: CARD_HAIR, borderColor: C.hairline, backgroundColor: C.tintCard, opacity: 0.7 },
  courseBar: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: C.accent },
  courseTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  courseCode: { fontFamily: textFace(700), fontSize: 11, fontWeight: '700', color: C.sub, fontVariant: ['tabular-nums'] },
  courseDeadline: { marginLeft: 'auto', fontFamily: textFace(700), fontSize: 12, fontWeight: '700', color: C.accentDeepAlt, fontVariant: ['tabular-nums'] },
  courseTitle: { marginTop: 8, fontFamily: textFace(700), fontSize: 15.5, fontWeight: '700', color: C.ink },
  courseTitleDone: { fontFamily: textFace(600), fontSize: 14, fontWeight: '600', color: C.sub },
  courseSub: { marginTop: 2, fontFamily: textFace(400), fontSize: 12, fontWeight: '400', color: C.sub },
  pill: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 8, borderRadius: rad('pill') },
  pillText: { fontFamily: textFace(700), fontSize: 9.5, fontWeight: '700', letterSpacing: 9.5 * 0.08, textTransform: 'uppercase' },
  lineagePill: { alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 7, borderRadius: rad('pill'), borderWidth: CARD_HAIR, borderColor: C.accentDeep },
  lineagePillText: { fontFamily: textFace(700), fontSize: 9, fontWeight: '700', letterSpacing: 9 * 0.08, textTransform: 'uppercase', color: C.accentDeepAlt },

  fontProof: { backgroundColor: C.card, borderRadius: rad('tile'), borderWidth: CARD_HAIR, borderColor: C.hairline, padding: 14, gap: 7, marginBottom: 12 },
  fontProofCaption: { ...ty('caps'), color: C.sub },
  glyphTile: { width: 44, height: 44, borderRadius: rad('tile'), backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  glyphTileMuted: { backgroundColor: C.hairlineStrong },
  rowBody: { flex: 1, gap: 2 },
  rowCode: { ...ty('caps'), color: C.sub },
  rowTitle: { ...ty('row'), color: C.ink },
  rowMeta: { ...ty('body', 'min'), color: C.sub },
  rowChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chevron: { fontFamily: displayFace(700), fontSize: 24, color: C.hairlineStrong },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },

  tabBar: { flexDirection: 'row', backgroundColor: alpha(C.card, 0.92), borderTopWidth: CARD_HAIR, borderTopColor: C.hairline, paddingTop: 8, paddingHorizontal: 6, paddingBottom: 28 },
  tab: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 8, borderRadius: rad('pill'), minHeight: 44, justifyContent: 'center' },
  tabActive: { backgroundColor: C.accentSoft },
  tabLabel: { ...ty('caps'), color: C.sub },
  tabLabelActive: { color: C.accentDeepAlt },

  overline: { ...ty('caps'), color: C.sub },
  centerText: { textAlign: 'center' },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { ...ty('view'), color: C.ink, textAlign: 'center' },
  emptyHint: { ...ty('body', 'max'), color: C.sub, textAlign: 'center' },

  body: { ...ty('body', 'max'), color: C.body },

  primary: {
    minHeight: 54, borderRadius: rad('button'), backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: GEO.paddingPx,
    shadowColor: C.accent, shadowOpacity: 0.4, shadowRadius: 15, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  primaryDisabled: { backgroundColor: C.disabledCta, shadowOpacity: 0, elevation: 0 },
  primaryText: { fontFamily: displayFace(800), fontSize: 15, fontWeight: '800', color: C.onAccent },
  ghost: { minHeight: 48, borderRadius: rad('buttonSecondary'), borderWidth: 1.5, borderColor: C.hairlineStrong, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: GEO.paddingPx },
  ghostText: { ...ty('row'), color: C.sub },

  cells: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  cell: { width: 44, height: 54, borderRadius: 13, borderWidth: 1.5, borderColor: C.hairlineInput, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  cellActive: { borderWidth: 2, borderColor: C.accent },
  cellText: { fontFamily: displayFace(800), fontSize: 24, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 3 * 54 + 2 * 8 + 40, alignSelf: 'center' },
  key: { width: 54, height: 54, borderRadius: 14, borderWidth: CARD_HAIR, borderColor: C.hairline, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  keyBlank: { width: 54, height: 54 },
  keyPressed: { transform: [{ scale: 0.92 }], backgroundColor: C.dim },
  keyText: { fontFamily: displayFace(700), fontSize: 22, fontWeight: '700', color: C.ink },
});
