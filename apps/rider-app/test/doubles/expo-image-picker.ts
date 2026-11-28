/**
 * ═══ RENDU-RÉEL — expo-image-picker, the system camera sheet as a hand-over ═══
 *
 * `expoPhotoSource` requires this module lazily (an older binary must survive
 * launch), so it reaches a walk only through `test/setup.ts`'s loader table.
 *
 * ═══ BOUNDS (stated per the standing order — this double may NEVER exceed them) ═══
 *
 * · NO CAMERA AND NO PIXELS. It hands back what the system sheet hands back
 *   in expo-image-picker 57.0.16 — `{ canceled: false, assets: [asset] }` or
 *   `{ canceled: true, assets: null }` (`ImagePicker.types.d.ts` l.334-359) —
 *   with an asset carrying a file uri and the shot's own width and height.
 *   The picture behind that uri is the manipulator double's to price.
 * · UNARMED, `launchCameraAsync` THROWS: no walk gets a photo it did not ask
 *   for, and the walks that assert the camera is absent stay honest.
 * · PERMISSION is granted, in the real response's shape. Refusal is not
 *   doubled here: no walk claims anything about it.
 * · EVERY OPTION THE APP PASSED is recorded, so a walk can prove what was asked
 *   of the camera (no EXIF, no base64 of the full-size original).
 * · APPEARANCE: nothing. The sheet is the phone's own camera app.
 */

type Asset = {
  uri: string;
  width: number;
  height: number;
  type: 'image';
  mimeType: string;
  fileName: string;
  assetId: null;
  exif: null;
  base64: null;
};

let arme: { readonly width: number; readonly height: number } | 'annule' | null = null;
let lancements: Record<string, unknown>[] = [];

/** Arm the next shots: the size the camera hands over, `'annule'` for the
 *  rider closing the sheet, or `null` to disarm. Clears the record. */
export function armerAppareil(shot: { readonly width: number; readonly height: number } | 'annule' | null): void {
  arme = shot;
  lancements = [];
}

/** The options of every `launchCameraAsync` call, in order. */
export function lancementsAppareil(): readonly Record<string, unknown>[] {
  return lancements;
}

export async function requestCameraPermissionsAsync(): Promise<{
  status: 'granted';
  granted: true;
  canAskAgain: true;
  expires: 'never';
}> {
  return { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
}

export async function launchCameraAsync(
  options: Record<string, unknown> = {},
): Promise<{ canceled: false; assets: Asset[] } | { canceled: true; assets: null }> {
  lancements.push({ ...options });
  if (arme === null) {
    throw new Error('expo-image-picker double: no camera under vitest. A walk that means to take a photo must arm this double explicitly.');
  }
  if (arme === 'annule') return { canceled: true, assets: null };
  const n = lancements.length;
  return {
    canceled: false,
    assets: [{
      uri: `file:///data/user/0/cache/ImagePicker/shot-${n}.jpg`,
      width: arme.width,
      height: arme.height,
      type: 'image',
      mimeType: 'image/jpeg',
      fileName: `shot-${n}.jpg`,
      assetId: null,
      exif: null,
      base64: null,
    }],
  };
}
