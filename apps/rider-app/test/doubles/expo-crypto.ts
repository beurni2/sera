/**
 * RENDU-RÉEL — expo-crypto. `ensureCsprng`/`ensureSha256` install these onto
 * globalThis on a real device; under vitest Node already carries WebCrypto, so
 * these delegate to it rather than inventing values. A digest here is a REAL
 * digest — a fake one would let a test pass over the fabricated-hash bug (A7).
 */
/** Node's own WebCrypto — a REAL implementation, never a stub. */
const webcrypto = globalThis.crypto;

export function getRandomValues<T extends ArrayBufferView>(array: T): T {
  return webcrypto.getRandomValues(array as never) as T;
}
export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' } as const;
export async function digestStringAsync(_alg: string, data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const hash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of hash) hex += b.toString(16).padStart(2, '0');
  return hex;
}
/**
 * ⚠ THE REAL `digest`, ADDED BECAUSE THE SWEEP CAUGHT ITS ABSENCE.
 * `ensureSha256` builds the device's `crypto.subtle.digest` shim out of this
 * one call. Node already carries WebCrypto so that branch does not run here —
 * but a double missing a member the app calls is precisely the hole the
 * certification test exists to name, and « it happens not to run today » is
 * not a reason to leave it undefined. It hashes for real.
 */
export async function digest(_alg: string, data: ArrayBuffer): Promise<ArrayBuffer> {
  return webcrypto.subtle.digest('SHA-256', data);
}

export function randomUUID(): string {
  return webcrypto.randomUUID();
}
