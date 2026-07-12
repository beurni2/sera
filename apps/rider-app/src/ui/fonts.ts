/**
 * WO-5.1 — the Grand Teint TYPEFACE substrate for RN (Archivo, Latin subset).
 * This is DATA ONLY: the family name, the five static weights, their asset
 * files, and the metrics-matched system fallback. It does NOT load the font
 * (that is expo-font work in a later screen slice) and it consumes no token.
 *
 * THE COLD-START LAW (design budget · the CTO's flagged risk): the family
 * name below is the ENHANCEMENT; `fallback` is what paints FIRST. Nothing in
 * the app may gate a first render on the font resolving — Expo loads custom
 * fonts asynchronously, and the design renders in the metrics-matched
 * fallback immediately, swapping to Archivo when (and only when) it is ready,
 * with no reflow. See design-reference/grand-teint/docs/budget.md and
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
