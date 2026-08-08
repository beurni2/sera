/**
 * ═══ SE-LIVE-4c-vii · THE BOUNDS THE BUCKET ENFORCES, HELD ON THE DEVICE ═══
 *
 * ⚠ VERIFIER BLOCKER A1 (round three). The rider app added `expo-image-picker`
 * and stopped there — but `quality` is JPEG **compression**, not a resize, and
 * the picker exposes no resize at all. So every capture went up at the sensor's
 * native resolution, and `media-service` refuses anything outside a 2048 box:
 *
 *     if (dims.width > IMAGE_STANDARD_MAX_DIM || dims.height > …) → bad_dimensions
 *     "The stored image must already be within this box (the app resizes on device)."
 *
 * Every phone in this market since about 2012 shoots wider than 2048. So on a
 * real handset the upload answered `400 bad_dimensions`, the screen said
 * « Cette photo n'a pas été acceptée. Reprenez-la. », and retaking — exactly
 * what the copy instructs — produced the same refusal for ever. The send stayed
 * disabled, and custody could still never begin. The port had gone from « called
 * by nothing » to « called and unable to succeed », which is the same outcome
 * for Aïcha and the same failure for me.
 *
 * Boutik+ already honours the contract (`studio/normalization.ts` resizes to
 * `DERIVATIVE_SPEC_V1.maxEdgePx` before upload). This is the rider-side half of
 * the same rule, kept pure so it is testable without a phone: the decision about
 * WHAT size to ask for is here; the native resize is in `expoPhotoSource`.
 */

/** Mirrors media-service `IMAGE_STANDARD_MAX_DIM`. Duplicated deliberately: it
 *  is a wire contract with another repo's service, not a shared type. */
export const BUCKET_MAX_DIM = 2048;

/**
 * Evidence, not photography. 1600 px on the long edge keeps a seal number and a
 * carton label legible while leaving real headroom under the bucket's ceiling,
 * and it is what has to leave a market stall on a bad network.
 */
export const EVIDENCE_MAX_EDGE = 1600;

export interface Resize {
  readonly width?: number;
  readonly height?: number;
}

/**
 * The resize to apply, or null when the image is already inside the bound.
 * Only ever DOWN — enlarging a small photo would invent detail that is supposed
 * to be proof, and would trip the bucket's minimum-dimension floor from the
 * other side.
 */
export function resizeForEvidence(width: number, height: number): Resize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (width <= EVIDENCE_MAX_EDGE && height <= EVIDENCE_MAX_EDGE) return null;
  return width >= height ? { width: EVIDENCE_MAX_EDGE } : { height: EVIDENCE_MAX_EDGE };
}

/** Would the bucket refuse these dimensions outright? Used to keep the two
 *  numbers honest with each other in a test, never as a substitute for the
 *  server's own check — the service is the authority. */
export function withinBucketBound(width: number, height: number): boolean {
  return width <= BUCKET_MAX_DIM && height <= BUCKET_MAX_DIM;
}
