import { bytesFromBase64, type PhotoSource } from './evidence-capture';
import { EVIDENCE_MAX_EDGE, resizeForEvidence } from './photo-bounds';

/**
 * ⚠ LOADED ON FIRST USE, NEVER AT IMPORT — and this is not style, it is what
 * keeps an already-installed build alive.
 *
 * `runtimeVersion.policy` is `sdkVersion`, so adding a NATIVE module does not
 * change the runtime version: an `eas update` publishes this JS to preview
 * clients that were built BEFORE these modules existed and have no native code
 * for them. `App.tsx` imports this file at module scope, so a top-level
 * `import 'expo-image-picker'` would throw while the bundle is loading and
 * **kill the app on launch** for anyone holding the older binary.
 *
 * Required lazily, the miss lands on the « Prendre la photo » tap instead: the
 * port answers `unreachable`, the screen says the photo did not go, and every
 * other screen still works. **The real fix is a new native build** (`eas build`
 * after `expo-image-picker` + `expo-image-manipulator` were added); this is
 * what keeps the app usable until that build is installed.
 *
 * Boutik+ settled this exact question in `studio/pick-native.ts`; this is the
 * same pattern, and departing from it was my mistake.
 */
type PickerModule = typeof import('expo-image-picker');
type ManipulatorModule = typeof import('expo-image-manipulator');
declare const require: (id: string) => unknown;
let pickerModule: PickerModule | null = null;
let manipulatorModule: ManipulatorModule | null = null;
function imagePicker(): PickerModule {
  pickerModule ??= require('expo-image-picker') as PickerModule;
  return pickerModule;
}
function imageManipulator(): ManipulatorModule {
  manipulatorModule ??= require('expo-image-manipulator') as ManipulatorModule;
  return manipulatorModule;
}

/**
 * SE-LIVE-4c-vii · the DEVICE binding for the proof photo — the same thin-I/O
 * shape `expoConnectivity` uses for the network. It is the only file that
 * touches the camera, it holds no rule, and it never runs under vitest (the
 * port is tested with a fake that hands back bytes; the size DECISION lives in
 * `photo-bounds.ts`, which is pure and is tested).
 *
 * FOUNDER RULING (2026-08-07): « build the photo capture ».
 *
 * ⚠ TWO ROUNDS OF THE SAME BUG, AND BOTH ARE WHY THIS FILE READS LIKE THIS.
 *   · Round two: this was a stub returning `null` for ever, called by nothing.
 *     The rider tapped an ENABLED send button and nothing happened, ever.
 *   · Round three: the camera worked and every upload was REFUSED.
 *     `quality` is JPEG compression, not a resize, and `expo-image-picker` has
 *     no resize option — so the capture went up at the sensor's native size,
 *     and media-service refuses anything outside a 2048 box. Every phone in
 *     this market shoots wider than that. « Cette photo n'a pas été acceptée.
 *     Reprenez-la. » — and retaking gave the same answer for ever.
 *
 * So the picture is now resized ON THE DEVICE before it is handed back, which
 * is the contract the bucket's own comment states (« the app resizes on
 * device ») and which Boutik+ has always honoured in `studio/normalization.ts`.
 *
 * ═══ WHY `expo-image-picker`, AND WHY BASE64 ═══
 *
 * The founder named the outcome, not the library, so the choice is mine and
 * reversible: `launchCameraAsync` is ONE system sheet — no screen of our own,
 * no preview surface to keep at 60 fps on a 1 GB phone, and the handset's own
 * camera app, which the rider already knows. `expo-camera` would give a framed,
 * branded proof-photo moment at the cost of its own screen and permission flow;
 * swapping is a one-file change.
 *
 * The picker is asked for a URI, not base64: the full-size original never has
 * to exist as a string in memory on a 1 GB phone. Only the RESIZED derivative
 * is encoded, and that is what becomes bytes.
 *
 * ⚠ CANCELLED AND REFUSED-PERMISSION BOTH RETURN null, which the port reads as
 * « cancelled » — the rider's own decision, reported at nobody.
 */
export const expoPhotoSource: PhotoSource = {
  async capture(): Promise<Uint8Array | null> {
    const permission = await imagePicker().requestCameraPermissionsAsync();
    if (!permission.granted) return null;

    const result = await imagePicker().launchCameraAsync({
      mediaTypes: ['images'],
      // No EXIF: it carries GPS, and the rider's location is not this act's to
      // record. The custody ledger binds the photo by its own chain ids.
      exif: false,
      allowsEditing: false,
    });
    if (result.canceled) return null;

    const asset = result.assets?.[0];
    if (asset === undefined) return null;

    // ⚠ DOWNSCALE FIRST — see the header. `manipulate()` decodes once and the
    // decoded image is handed straight to the encode step (the Boutik+
    // precedent), which matters while a low-end phone is holding the bitmap.
    const { ImageManipulator, SaveFormat } = imageManipulator();
    const context = ImageManipulator.manipulate(asset.uri);
    const resize = resizeForEvidence(asset.width, asset.height);
    if (resize !== null) context.resize(resize);
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      // Evidence, not photography: it has to leave the stall on a bad network.
      compress: 0.6,
      // The manipulator decodes to a platform bitmap and re-encodes, so whatever
      // the camera wrote — HEIC included — the bucket only ever sees JPEG.
      format: SaveFormat.JPEG,
      base64: true,
    });

    // A derivative that came back outside the bound is not proof we may send;
    // the bucket would refuse it and the rider would be told to retake a photo
    // that can never be accepted. Refusing here says something true instead.
    if (saved.width > EVIDENCE_MAX_EDGE || saved.height > EVIDENCE_MAX_EDGE) return null;

    const encoded = saved.base64;
    if (typeof encoded !== 'string' || encoded === '') return null;
    return bytesFromBase64(encoded);
  },
};
