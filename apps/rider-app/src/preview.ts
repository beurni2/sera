/**
 * WO-4.0 — the PREVIEW PROFILE signal. `EXPO_PUBLIC_PROFILE` is inlined at
 * bundle time by Expo. UNSET means 'preview': a local Expo Go run, the
 * sandbox that wears « Aperçu — bac à sable » on every screen. The published
 * channel sets it explicitly to 'production' (expo-preview.yml — PROFIL-PUBLIÉ,
 * founder ruling 2026-09-30: no live page shows a test banner): that channel
 * is the road to real riders, and the explicit value is the only way out of
 * the banner — so a local build can never be mistaken for it.
 */
export const PREVIEW_PROFILE = 'preview';

export function isPreviewProfile(profile: string | undefined): boolean {
  return (profile ?? PREVIEW_PROFILE) === PREVIEW_PROFILE;
}

// Dot access, deliberately: babel-preset-expo inlines EXPO_PUBLIC_* only on
// the member-expression form — bracket access would survive to runtime unset.
export const IS_PREVIEW = isPreviewProfile(process.env.EXPO_PUBLIC_PROFILE);
