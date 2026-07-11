/**
 * WO-4.0 — the PREVIEW PROFILE signal. `EXPO_PUBLIC_PROFILE` is inlined at
 * bundle time by Expo; the preview channel leaves it unset (default
 * 'preview'), and any FUTURE production profile must set it explicitly —
 * a preview build can therefore never be mistaken for the real thing,
 * and no production profile exists in this repo today (E4-BUILD opening
 * slice: delivery channel only).
 */
export const PREVIEW_PROFILE = 'preview';

export function isPreviewProfile(profile: string | undefined): boolean {
  return (profile ?? PREVIEW_PROFILE) === PREVIEW_PROFILE;
}

// Dot access, deliberately: babel-preset-expo inlines EXPO_PUBLIC_* only on
// the member-expression form — bracket access would survive to runtime unset.
export const IS_PREVIEW = isPreviewProfile(process.env.EXPO_PUBLIC_PROFILE);
