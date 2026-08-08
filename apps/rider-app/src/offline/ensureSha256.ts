import * as Crypto from 'expo-crypto';

/**
 * RIDER-DELIVERY-SCREEN · the device SHA-256 binding, `ensureCsprng`'s twin.
 * `evidence-capture` measures the handoff photo's content hash with the
 * ambient `crypto.subtle.digest`; Node and browsers carry it, a bare Hermes
 * may not — this installs a minimal digest backed by **expo-crypto** (the OS
 * primitive). Idempotent and a no-op where the runtime already provides one.
 *
 * Device-only, like `ensureCsprng`: never imported by the pure modules or the
 * tests (Node's WebCrypto satisfies them), so expo-crypto's native surface is
 * never invoked off-device.
 */
export function ensureSha256(): void {
  const g = globalThis as {
    crypto?: { subtle?: { digest?: (alg: string, data: ArrayBuffer) => Promise<ArrayBuffer> } };
  };
  if (g.crypto?.subtle?.digest !== undefined) return;
  const digest = (_alg: string, data: ArrayBuffer): Promise<ArrayBuffer> =>
    Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data);
  g.crypto = { ...(g.crypto ?? {}), subtle: { ...(g.crypto?.subtle ?? {}), digest } };
}
