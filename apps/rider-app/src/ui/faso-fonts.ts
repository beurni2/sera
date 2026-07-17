/**
 * WO-FP-SERA · the Faso Premium TYPEFACE substrate for RN. DATA ONLY: the two
 * families the design locks (README § Type) and their six embedded static faces,
 * built by STEP 0 (google/fonts OFL, subset, distinct name-tables — see
 * `test/faso-fonts.test.ts` + `_review/WO-FP-SERA/build-faso-fonts.py`).
 *
 * Two families, chosen by ROLE — display vs text — never by weight alone
 * (Bricolage 700 and Instrument 700 are different faces): the caller names the
 * role. Money and codes are display (Bricolage); body is text (Instrument).
 * Native embedding addresses each face BY its distinct family name (app.json
 * expo-font plugin), so these strings ARE the RN `fontFamily`.
 */

/** Display — Bricolage Grotesque, the two embedded weights (README § Type). */
const DISPLAY_WEIGHTS = [700, 800] as const;
/** Text — Instrument Sans, the four embedded weights (README § Type: 400–700). */
const TEXT_WEIGHTS = [400, 500, 600, 700] as const;

const nearest = (weights: readonly number[], w: number): number =>
  weights.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));

/** The display face (Bricolage) for a weight — titles, money, CTAs, big codes. */
export const displayFace = (w: number): string => `Bricolage-${nearest(DISPLAY_WEIGHTS, w)}`;
/** The text face (Instrument) for a weight — everything else. */
export const textFace = (w: number): string => `Instrument-${nearest(TEXT_WEIGHTS, w)}`;

/** The fallback that paints before the embedded face resolves — the platform
 * system face (native embedding means it never gates a first render). */
export const FONT_FALLBACK = 'System';

/** The six embedded faces ↔ their weight (mirrors app.json + the STEP 0 guard). */
export const FASO_FACES = {
  'Bricolage-700': 700,
  'Bricolage-800': 800,
  'Instrument-400': 400,
  'Instrument-500': 500,
  'Instrument-600': 600,
  'Instrument-700': 700,
} as const;
