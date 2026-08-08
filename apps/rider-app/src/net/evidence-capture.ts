import type { ConnectivityPort } from '../offline/connectivity';

/**
 * ═══ SE-LIVE-4c-vii · THE PROOF PHOTO — REAL BYTES, REAL REFS ═══
 *
 * FOUNDER ORDER (2026-08-07): « build the photo capture ».
 *
 * ⚠ WHAT THIS REPLACES — VERIFIER BLOCKER A7. The seal was sending
 * `sealPhotoRefs: ['ev-<uuid>']`: a reference to a bundle that did not exist
 * and never would. `CustodySpine` refuses a seal with no evidence
 * (`no_evidence_refs`) precisely because « a seal with no photo proves
 * nothing » — and a fabricated ref defeats that guard while writing a dangling
 * pointer PERMANENTLY into the hash-chained ledger. I shipped that with a
 * comment admitting it, which is not the same as it being acceptable.
 *
 * THE REF IS NOW WHAT THE BUCKET GAVE BACK. Bytes are POSTed to the
 * media-service (`POST /media`, boutik-plus), which sniffs the real format
 * from magic bytes, validates dimensions, mints an opaque `media/{token}` that
 * no caller input can shape, and returns it. That token is the evidence ref
 * the ledger records. If the upload does not happen, there is NO ref — and the
 * act does not go.
 *
 * ⚠ NO PHOTO, NO SEAL. `captureAndUpload` returning null is a refusal, not a
 * placeholder: the caller must not fall back to a synthetic ref. That is the
 * whole point of A7, and `custody-acts` will be handed an empty list rather
 * than a fiction, which the SERVER then refuses by name.
 *
 * ═══ THE UPLOAD KEY, AND WHY IT MAY BE BUNDLED ═══
 *
 * `EXPO_PUBLIC_SERA_MEDIA_WRITE_KEY` is an `EXPO_PUBLIC_*`, so it ships inside
 * the app. That is deliberate and already ruled on: MEDIA-KEY-SPLIT separated
 * the WRITE key (which the media-service's own comments say « ships in app
 * bundles ») from the founder-only `MEDIA_REVOKE_SECRET`. A write key can add
 * bytes; it cannot read, list, revoke or delete. The founder's keys and every
 * ops secret remain absent from this bundle, and a test asserts it.
 *
 * PURE + PORT-BASED, like every other seam here: the device binding (the
 * camera) is injected, so this file is testable without a phone and carries no
 * native import.
 */

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Bytes from the device camera. The port that produces them is injected so
 *  the native picker never has to run under vitest. */
export interface PhotoSource {
  /** Open the camera and return the captured bytes, or null if the rider
   *  cancelled or refused permission — both of which are ordinary answers. */
  capture(): Promise<Uint8Array | null>;
}

export type CaptureOutcome =
  /** The bucket accepted the bytes and named them. This ref is ledger-grade.
   *  RIDER-DELIVERY-SCREEN adds the artifact's other two canon facts: the
   *  content hash MEASURED HERE over the very bytes that were uploaded
   *  (null when this device has no SHA-256 road — an honest absence the
   *  delivery act must refuse on, never a fabricated hex), and the mimeType
   *  the BUCKET derived by sniffing (never claimed by this side). */
  | { readonly ok: true; readonly ref: string; readonly sha256: string | null; readonly mimeType: string }
  /** The rider backed out. Not an error — nothing is said, nothing is sent. */
  | { readonly ok: false; readonly reason: 'cancelled' }
  /** The device knows it has no network. Nothing was attempted. */
  | { readonly ok: false; readonly reason: 'offline' }
  /** The bucket refused the bytes and said why (empty · unsupported_type ·
   *  too_large · bad_dimensions) — the rider can act on that. */
  | { readonly ok: false; readonly reason: 'rejected'; readonly detail: string }
  /** The upload did not complete. The photo is not stored, so there is no ref. */
  | { readonly ok: false; readonly reason: 'unreachable' }
  /** This BUILD has no media bucket configured, so no photo can ever be stored
   *  here. Distinct from 'unreachable' because « réessayez » is false advice:
   *  retrying cannot work, and the camera never even opened. */
  | { readonly ok: false; readonly reason: 'unconfigured' };

export interface EvidenceCapturePort {
  captureAndUpload(): Promise<CaptureOutcome>;
}

/**
 * Base64 → bytes, written out rather than leaning on a global `atob`.
 *
 * The camera hands back base64 (asking the picker for it avoids a file read on
 * a phone that may be low on space), and the media-service sniffs the real
 * format from MAGIC BYTES — so a decoder that is wrong in the first few bytes
 * turns every upload into `unsupported_type` on the device only. Keeping it
 * here, in the file with no native import, is what makes it testable at all;
 * `expoPhotoSource` cannot be loaded under vitest.
 *
 * Returns null on anything malformed — a photo we cannot decode is no photo,
 * which stops the act rather than uploading rubbish that becomes ledger proof.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesFromBase64(input: string): Uint8Array | null {
  const s = input.replace(/[\r\n\s]/g, '');
  if (s === '' || /[^A-Za-z0-9+/=]/.test(s) || s.length % 4 !== 0) return null;
  // '=' is padding and may only sit at the very end. An interior one is a
  // malformed encoding, and decoding it anyway would silently produce bytes
  // that are not the photo the rider took.
  if (/=[^=]/.test(s)) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = B64.indexOf(s[i] as string);
    const b = B64.indexOf(s[i + 1] as string);
    const c = s[i + 2] === '=' ? 0 : B64.indexOf(s[i + 2] as string);
    const d = s[i + 3] === '=' ? 0 : B64.indexOf(s[i + 3] as string);
    // '=' is only legal in the last group; anything else unmapped is malformed.
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

const UPLOAD_PATH = '/media';
const UPLOAD_TIMEOUT_MS = 30_000;

/** SHA-256 as lowercase hex, or null. The device digest port: injectable for
 *  tests, defaulting to the ambient WebCrypto (Node and browsers carry it;
 *  a bare Hermes may not — `ensureSha256` installs the expo-crypto shim on
 *  device, and where nothing provides one the answer is an honest null). */
export type DigestFn = (bytes: Uint8Array) => Promise<string | null>;

export async function subtleSha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = (globalThis as { crypto?: { subtle?: { digest(alg: string, data: ArrayBuffer): Promise<ArrayBuffer> } } })
    .crypto?.subtle;
  if (subtle === undefined || typeof subtle.digest !== 'function') return null;
  try {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const hash = new Uint8Array(await subtle.digest('SHA-256', buf));
    let hex = '';
    for (const b of hash) hex += b.toString(16).padStart(2, '0');
    return hex;
  } catch {
    return null;
  }
}

export function httpEvidenceCapture(
  base: string,
  writeKey: string,
  photos: PhotoSource,
  connectivity: ConnectivityPort,
  fetchFn: FetchFn = globalThis.fetch,
  timeoutMs: number = UPLOAD_TIMEOUT_MS,
  digest: DigestFn = subtleSha256Hex,
): EvidenceCapturePort {
  const root = base.replace(/\/+$/, '');
  return {
    async captureAndUpload(): Promise<CaptureOutcome> {
      const bytes = await photos.capture();
      // Cancelled or permission-refused: the rider decides, and neither is a
      // failure to report at them.
      if (bytes === null) return { ok: false, reason: 'cancelled' };
      // ⚠ THE PHOTO IS NOT QUEUED OFFLINE. It is taken at the moment of the
      // seal, and a ref that does not exist server-side cannot go into the
      // ledger — so an offline capture has nowhere to live. The rider is told
      // plainly rather than handed a ref that resolves to nothing.
      if (connectivity.current() === 'offline') return { ok: false, reason: 'offline' };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${root}${UPLOAD_PATH}`, {
          method: 'POST',
          // The BODY IS THE IMAGE — raw bytes, no multipart, no JSON wrapper.
          // The service ignores any declared content type and sniffs the real
          // one from the bytes, so we do not claim one.
          headers: { 'X-Write-Key': writeKey },
          signal: controller.signal,
          // RN's fetch takes a typed array directly as the body.
          body: bytes as unknown as string,
        });
        if (res.status === 201) {
          const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
          const ref = body?.['ref'];
          const contentType = body?.['contentType'];
          // Corroborated, not counted: a 201 that does not name a ref AND the
          // type the bucket itself derived is not a stored photo, and must
          // never become a ledger entry.
          if (typeof ref !== 'string' || ref.trim() === '' || typeof contentType !== 'string' || contentType === '') {
            return { ok: false, reason: 'unreachable' };
          }
          // The hash is measured over the VERY bytes that were uploaded —
          // null where this device has no SHA-256 road, never an invention.
          return { ok: true, ref: ref.trim(), sha256: await digest(bytes), mimeType: contentType };
        }
        if (res.status === 400) {
          const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
          const detail = typeof body?.['reason'] === 'string' ? (body['reason'] as string) : 'rejected';
          return { ok: false, reason: 'rejected', detail };
        }
        return { ok: false, reason: 'unreachable' };
      } catch {
        return { ok: false, reason: 'unreachable' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** A build with no media base or no write key cannot store a photo, so it
 *  cannot produce a ledger-grade ref — and must not pretend to. Every capture
 *  refuses, which stops the seal rather than faking its proof. */
export function unwiredEvidenceCapture(): EvidenceCapturePort {
  // ⚠ NOT 'unreachable'. That reads « La photo n'est pas partie. Réessayez. »,
  // which sends a rider tapping a button that cannot ever work — and the camera
  // did not even open, so nothing about the screen matched what happened.
  return { async captureAndUpload(): Promise<CaptureOutcome> { return { ok: false, reason: 'unconfigured' }; } };
}

export function resolveEvidenceCapture(
  photos: PhotoSource,
  connectivity: ConnectivityPort,
  base: string | undefined = process.env.EXPO_PUBLIC_SERA_MEDIA_BASE,
  writeKey: string | undefined = process.env.EXPO_PUBLIC_SERA_MEDIA_WRITE_KEY,
): EvidenceCapturePort {
  const wired = typeof base === 'string' && base.trim() !== '' && typeof writeKey === 'string' && writeKey.trim() !== '';
  return wired
    ? httpEvidenceCapture((base as string).trim(), (writeKey as string).trim(), photos, connectivity)
    : unwiredEvidenceCapture();
}
