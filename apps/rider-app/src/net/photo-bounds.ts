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
/** Mirrors media-service `IMAGE_MIN_DIM`: it refuses a photo with either side under it. */
export const BUCKET_MIN_DIM = 200;

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

/*
 * PHOTOS LÉGÈRES — the proof photo that leaves the stall fits its canon row,
 * and a byte budget never blocks the rider's act.
 */

/** PERF-BUDGETS « Evidence-upload time »: 3 photos ≤ 300 KB each (KB = 1024). */
export const EVIDENCE_BUDGET_BYTES = 300 * 1024;
/** 0.6 first, so a photo that fits today leaves byte-identical; below 0.4 the
 *  measured code began to misread at small edges. */
export const EVIDENCE_QUALITY_STEPS = [0.6, 0.5, 0.4] as const;
/** The legibility floor: about 7 px tall for 4 mm print on a carton framed at
 *  70 cm — a rule of thumb, not a reading test. */
export const EVIDENCE_LEGIBLE_FLOOR = 1280;
/** After `EVIDENCE_MAX_EDGE`, the long edges a photo steps down through once
 *  every quality is over budget; the last one is the floor. */
export const EVIDENCE_EDGE_STEPS = [1440, EVIDENCE_LEGIBLE_FLOOR] as const;

/**
 * The next step down from an image of this size — the largest listed edge
 * below its long edge — or null at the floor. A step that would leave the
 * short side under the media minimum is the floor too; it is judged rounded
 * DOWN, as the resize truncates it, so never kinder than the resize itself.
 */
export function nextEvidenceEdge(width: number, height: number): Resize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const longest = Math.max(width, height);
  const edge = EVIDENCE_EDGE_STEPS.find((e) => e < longest);
  if (edge === undefined) return null;
  if (Math.floor((Math.min(width, height) * edge) / longest) < BUCKET_MIN_DIM) return null;
  return width >= height ? { width: edge } : { height: edge };
}

/**
 * Save a rendered image until it fits the budget: every quality at this edge,
 * highest first; only when all are over does it step the edge down, resizing
 * the image ALREADY rendered (never a second decode of the camera's original).
 * The first save that fits is returned — the bytes that leave are the bytes
 * that were measured.
 *
 * AT THE FLOOR THE LAST SAVE IS RETURNED ANYWAY. A save the caller cannot read
 * (`null`) ends the ladder there: no photo, as before.
 */
export async function saveWithinEvidenceBudget<I extends { readonly width: number; readonly height: number }>(
  first: I,
  save: (image: I, compress: number) => Promise<Uint8Array | null>,
  resize: (image: I, step: Resize) => Promise<I>,
): Promise<Uint8Array | null> {
  let image = first;
  for (;;) {
    let last: Uint8Array | null = null;
    for (const compress of EVIDENCE_QUALITY_STEPS) {
      const bytes = await save(image, compress);
      if (bytes === null) return null;
      if (bytes.byteLength <= EVIDENCE_BUDGET_BYTES) return bytes;
      last = bytes;
    }
    const step = nextEvidenceEdge(image.width, image.height);
    if (step === null) return last;
    image = await resize(image, step);
  }
}
