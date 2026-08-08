import * as ImagePicker from 'expo-image-picker';
import { bytesFromBase64, type PhotoSource } from './evidence-capture';

/**
 * SE-LIVE-4c-vii · the DEVICE binding for the proof photo — the same thin-I/O
 * shape `expoConnectivity` uses for the network. It is the only file that
 * touches the camera, it holds no rule, and it never runs under vitest (the
 * port is tested with a fake that hands back bytes).
 *
 * FOUNDER RULING (2026-08-07): « build the photo capture ».
 *
 * ⚠ THIS FILE WAS A STUB THAT RETURNED `null` FOREVER, AND THE STUB WAS THE
 * BUG (verifier blocker A1, second round). With no bytes there is no ref, and
 * with no ref both custody acts return on their first line — so on a wired
 * build the rider tapped « Envoyer la vérification » and nothing happened, for
 * ever, with the button still enabled. A port that silently does nothing is
 * worse than one that is absent, because every test and gate stays green over
 * it.
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
 * `base64: true` avoids reading the file back off a phone that may be out of
 * space, and hands the bytes straight to the upload. `quality` is turned down
 * because this is evidence, not photography: it must survive a 2G upload at the
 * stall. The media-service enforces the real bounds (type, size, dimensions) and
 * refuses anything outside them by name.
 *
 * ⚠ CANCELLED AND REFUSED-PERMISSION BOTH RETURN null, which the port reads as
 * « cancelled » — the rider's own decision, reported at nobody.
 */
export const expoPhotoSource: PhotoSource = {
  async capture(): Promise<Uint8Array | null> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      // Evidence, not photography — it has to leave the stall on a bad network.
      quality: 0.6,
      base64: true,
      // No EXIF: it carries GPS, and the rider's location is not this act's to
      // record. The custody ledger binds the photo by its own chain ids.
      exif: false,
      allowsEditing: false,
    });
    if (result.canceled) return null;

    const asset = result.assets?.[0];
    const encoded = asset?.base64;
    if (typeof encoded !== 'string' || encoded === '') return null;
    return bytesFromBase64(encoded);
  },
};
