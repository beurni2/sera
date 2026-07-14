import { seraColour, sharedColour, type as ftype, radius as fradius, geometry, motion as fmotion } from '@platform/ui-tokens';
import { displayFace, textFace } from './faso-fonts';

/**
 * WO-FP-SERA · the FASO PREMIUM token bridge (v2 → RN). The single seam that
 * turns the canon v2 tokens (`@platform/ui-tokens` root: seraColour, sharedColour,
 * type, radius, geometry, motion) into RN-ready values. The token file's zero-
 * hardcode law binds here: every colour/size/radius/duration a Faso surface uses
 * resolves to a token in THIS bridge — never a literal in a component (the
 * token-fidelity gate scans for planted hex). Pure (no react-native import) so it
 * stays testable; the Easing conversion of a motion's timingFunction lives in the
 * component layer.
 *
 * RANGES: the README encodes some values as { min, max } VERBATIM (view 19–20,
 * art radius 13–14, fpPop .3–.45s). A use PICKS an edge (both are real token
 * values) — this bridge never collapses a range to an invented middle.
 */

type Edge = 'min' | 'max';
const val = (v: number | { min: number; max: number }, edge: Edge = 'max'): number =>
  typeof v === 'number' ? v : v[edge];

/** Compose an rgba from a TOKEN hex + an alpha — so a translucent line on an accent
 * ground still resolves to a token colour, never a hand-copied rgb (token-fidelity).
 * The alpha itself is a compositing value the pixel-source states. */
export const alpha = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** The Séra colour set — README § Color (shared) + § Accent (Séra). Séra's paper
 * is the deeper `paperSera`; the accent is amber with two deep text tones. */
export const C = {
  paper: sharedColour.paperSera,
  card: sharedColour.card,
  tintCard: seraColour.tintCard,
  ink: sharedColour.ink,
  body: sharedColour.body,
  sub: sharedColour.sub,
  hairline: sharedColour.hairline,
  hairlineStrong: sharedColour.hairlineStrong,
  hairlineInput: sharedColour.hairlineInput,
  dim: sharedColour.dim,
  disabledCta: sharedColour.disabledCta,
  disabledCtaFg: sharedColour.disabledCtaFg,
  // the amber accent + its tones (one accent per screen, never two)
  accent: seraColour.primary,
  accentDeep: seraColour.deep,
  accentDeepAlt: seraColour.deepAlt,
  accentSoft: seraColour.soft,
  onAccent: seraColour.onPrimary,
  gold: seraColour.gold,
  // status pairs
  okFg: sharedColour.okFg,
  okBg: sharedColour.okBg,
  warnFg: sharedColour.warnFg,
  warnFgAlt: sharedColour.warnFgAlt,
  warnBg: sharedColour.warnBg,
  dangerFg: sharedColour.dangerFg,
  dangerBg: sharedColour.dangerBg,
  dangerBorder: sharedColour.dangerBorder,
  mutedFg: sharedColour.mutedFg,
  mutedBg: sharedColour.mutedBg,
} as const;

/** The dark surfaces the README keeps (§ Surfaces sombres conservées) — literals
 * transcribed from « Sera - HANDOFF » §1, the pixel source for what the v2 shared
 * palette does not name (relay/scale ink band, SOS sheet, celebration scrim). */
export const DARK = {
  band: '#1C1710',
  bandText: '#F6F0E4',
  sosSheet: '#14100B',
  sosBorder: '#C43A2C',
  celebrationScrim: 'rgba(20,14,6,.95)',
} as const;

type Role = keyof typeof ftype.scale;
/** RN accepts these weight strings; kept as a literal union so `ty()` styles drop
 * straight into a TextStyle without a react-native import in this pure bridge. */
type RnWeight = '400' | '500' | '600' | '700' | '800' | '900';
export interface TextStyleToken {
  fontFamily: string;
  fontSize: number;
  fontWeight: RnWeight;
  letterSpacing?: number;
  textTransform?: 'uppercase';
}
/** Display roles use Bricolage; text roles use Instrument (README § Type). caps'
 * `.1em` letterSpacing is resolved to px against its own size. */
const DISPLAY_ROLES = new Set<Role>(['screen', 'view', 'heroMoney', 'cardMoney']);
export function ty(role: Role, edge: Edge = 'max'): TextStyleToken {
  const t = ftype.scale[role] as { size: number | { min: number; max: number }; wght?: number; letterSpacing?: string; upper?: boolean };
  const size = val(t.size, edge);
  const wght = t.wght ?? 400;
  const face = DISPLAY_ROLES.has(role) ? displayFace(wght) : textFace(wght);
  const style: TextStyleToken = { fontFamily: face, fontSize: size, fontWeight: String(wght) as RnWeight };
  if (t.letterSpacing === '.1em') style.letterSpacing = size * 0.1;
  else if (role === 'screen' || role === 'view' || role === 'heroMoney' || role === 'cardMoney') {
    style.letterSpacing = size * -0.02; // titleLetterSpacing -.02em (README § Type)
  }
  if (t.upper === true) style.textTransform = 'uppercase';
  return style;
}

/** Radii (README § Geometry) — art + secondary-button are ranges. */
export const rad = (key: keyof typeof fradius, edge: Edge = 'max'): number => val(fradius[key], edge);

/** The four named geometry constants (README § Geometry). */
export const GEO = geometry;

/** A motion token resolved to { durationMs, timingFunction } — fpPop's duration
 * range picks an edge. The component turns timingFunction into an RN Easing. */
export type MotionName = keyof typeof fmotion;
export function motionOf(name: MotionName, edge: Edge = 'max'): { durationMs: number; timingFunction: string } {
  const m = fmotion[name];
  return { durationMs: val(m.durationMs, edge), timingFunction: m.timingFunction };
}

/** Money render tokens carried from Grand Teint this wave (the v2 file defers the
 * money group to /legacy): re-exported through the bridge so money-drawing views
 * consume ONE seam. tnum + the U+202F narrow-space separator (STEP 0 cmap guard). */
export { money } from '@platform/ui-tokens/legacy';
