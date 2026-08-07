import type { PhotoSource } from './evidence-capture';

/**
 * SE-LIVE-4c-vii · the DEVICE binding for the proof photo — the same thin-I/O
 * shape `expoConnectivity` uses for the network. It is the only file that
 * touches the camera, it holds no rule, and it never runs under vitest (the
 * port is tested with a fake that hands back bytes).
 *
 * ⚠ THE DEPENDENCY IS NOT YET IN `package.json`, AND THAT IS DELIBERATE UNTIL
 * THE FOUNDER PICKS ONE. `expo-image-picker` (gallery + camera) and
 * `expo-camera` (in-app capture surface) are different products for a rider:
 * the picker is one system sheet and works on every handset; the camera gives
 * a framed shot but needs its own screen and permission flow. Adding a native
 * dependency also changes the EAS build, so it is his call, not mine.
 *
 * Until then this source returns null — « no photo » — which the port turns
 * into a refusal and which STOPS THE SEAL. That is the correct failure: a seal
 * with no photo proves nothing, and the previous behaviour (a fabricated ref)
 * was the thing the verifier called a blocker.
 */
export const expoPhotoSource: PhotoSource = {
  async capture(): Promise<Uint8Array | null> {
    return null;
  },
};
