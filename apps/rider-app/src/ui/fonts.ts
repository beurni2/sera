/**
 * WO-5.1 — the Grand Teint TYPEFACE substrate for RN (Archivo, Latin subset).
 * This is DATA ONLY: the family name, the five static weights, their asset
 * files, and the metrics-matched system fallback. It loads no font itself and
 * consumes no token — the weights below name the bundled assets.
 *
 * THE COLD-START LAW (design budget · the CTO's flagged risk): WO-6.1 embeds
 * these five faces NATIVELY via the expo-font config plugin (app.json), so
 * Archivo is in the binary and paints from the FIRST frame — no async load,
 * no swap. `FONT_FALLBACK` stays as metrics-matched defence-in-depth: the app
 * still never gates a first render on a font resolving, so if the embedded
 * face were ever unavailable the design paints in the system face with no
 * reflow. See design-reference/grand-teint/docs/budget.md and
 * assets/fonts/COLD-START.md.
 */

/** The family the design locks (docs/tokens.json → type.family). */
export const FONT_FAMILY = 'Archivo';

/** The fallback that paints before Archivo resolves (type.familyFallback).
 * On RN this is the platform system face; metrics are close to Archivo
 * (budget.md: "Archivo is metrics-friendly"), so the swap causes no reflow. */
export const FONT_FALLBACK = 'System';

/** The five static instances the design uses, and their bundled asset files.
 * (Latin subset, produced from Archivo variable — see COLD-START.md.) */
export const FONT_WEIGHTS = {
  400: 'Archivo-Regular.ttf',
  500: 'Archivo-Medium.ttf',
  700: 'Archivo-Bold.ttf',
  800: 'Archivo-ExtraBold.ttf',
  900: 'Archivo-Black.ttf',
} as const;

export type FontWeight = keyof typeof FONT_WEIGHTS;
