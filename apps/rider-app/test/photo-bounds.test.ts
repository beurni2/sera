import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUCKET_MAX_DIM, EVIDENCE_MAX_EDGE, resizeForEvidence, withinBucketBound } from '../src/net/photo-bounds';

/**
 * ⚠ VERIFIER BLOCKER A1 (round three) — EVERY PROOF PHOTO WAS REFUSED.
 *
 * The app added `expo-image-picker` and stopped. `quality` is JPEG compression,
 * not a resize; the picker has no resize option. So the capture went up at the
 * sensor's native resolution and media-service answered `400 bad_dimensions`
 * for anything outside a 2048 box — its own comment says « the stored image
 * must already be within this box (the app resizes on device) ». Every phone in
 * this market shoots wider than 2048, so EVERY photo was rejected, the send
 * stayed disabled, and custody could never begin. Retaking — which is exactly
 * what « Reprenez-la. » instructs — gave the same answer for ever.
 */
describe('⚠ the proof photo fits the bucket, on the device (A1)', () => {
  it('downsizes the real cameras riders actually carry', () => {
    // The market's phone classes: 5 MP, 8 MP, 13 MP, 48 MP, and portrait.
    for (const [w, h] of [[2592, 1944], [3264, 2448], [4160, 3120], [8000, 6000], [2448, 3264]] as const) {
      const resize = resizeForEvidence(w, h);
      expect(resize, `${w}x${h} must be resized`).not.toBeNull();
      // The long edge is the one pinned, so the short edge only ever shrinks.
      const long = w >= h ? resize?.width : resize?.height;
      expect(long).toBe(EVIDENCE_MAX_EDGE);
      // …and the result is inside what the bucket will actually accept.
      const scale = EVIDENCE_MAX_EDGE / Math.max(w, h);
      expect(withinBucketBound(Math.round(w * scale), Math.round(h * scale))).toBe(true);
    }
  });

  it('leaves an already-small photo alone rather than enlarging it', () => {
    // Enlarging would invent detail that is supposed to be PROOF.
    expect(resizeForEvidence(1024, 768)).toBeNull();
    expect(resizeForEvidence(EVIDENCE_MAX_EDGE, EVIDENCE_MAX_EDGE)).toBeNull();
  });

  it('refuses to guess when the dimensions are not real numbers', () => {
    for (const [w, h] of [[0, 100], [100, 0], [-1, 5], [Number.NaN, 10], [Infinity, 10]] as const) {
      expect(resizeForEvidence(w, h), `${w}x${h}`).toBeNull();
    }
  });

  it('⚠ stays under the ceiling the OTHER repo enforces, with headroom', () => {
    // BUCKET_MAX_DIM duplicates media-service's IMAGE_STANDARD_MAX_DIM across a
    // repo boundary. If someone raises the evidence edge past it, every upload
    // starts failing on real handsets again and nothing else would say so.
    expect(EVIDENCE_MAX_EDGE).toBeLessThan(BUCKET_MAX_DIM);
    expect(BUCKET_MAX_DIM).toBe(2048);
  });

  it('⚠ the device binding actually applies the resize before encoding', () => {
    // The decision is pure and tested here; the native call is not testable
    // under vitest, so this asserts the two are connected at all.
    const src = readFileSync(join(import.meta.dirname, '..', 'src/net/expoPhotoSource.ts'), 'utf8');
    expect(src).toMatch(/resizeForEvidence\(asset\.width, asset\.height\)/);
    expect(src).toMatch(/context\.resize\(resize\)/);
    // The resize must happen BEFORE the bytes are produced.
    expect(src.indexOf('context.resize(resize)')).toBeLessThan(src.indexOf('saveAsync'));
    // base64 is asked of the DERIVATIVE, never of the full-size original — a
    // 48 MP original as a JS string is how a 1 GB phone dies.
    expect(src).not.toMatch(/launchCameraAsync\([\s\S]{0,200}base64: true/);
    // And a derivative that somehow came back oversized is refused, not sent.
    expect(src).toMatch(/saved\.width > EVIDENCE_MAX_EDGE \|\| saved\.height > EVIDENCE_MAX_EDGE/);
  });
});
