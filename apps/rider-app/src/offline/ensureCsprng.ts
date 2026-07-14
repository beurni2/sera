import * as Crypto from 'expo-crypto';

/**
 * SERA-S1 · the device CSPRNG binding. Canon `mintCommandId` reads the ambient
 * `globalThis.crypto.randomUUID` (`COMMAND-ID-MINT.md`); Node provides it natively,
 * and on React Native this installs it from **expo-crypto** — the founder's ruling:
 * the OS CSPRNG, UUIDv4, `Math.random` FORBIDDEN. Idempotent and harmless if the
 * runtime already provides a `randomUUID` (it is a no-op then).
 *
 * Call once at the app's offline entry (wired in a later slice — SERA-S1 wires
 * nothing). NOT imported by the outbox core or the tests: Node's WebCrypto already
 * satisfies `mintCommandId` there, so this device-only module never runs under
 * vitest (expo-crypto's native surface is never invoked off-device).
 */
export function ensureCsprng(): void {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') return;
  // OS CSPRNG only — expo-crypto's randomUUID is UUIDv4 from the platform entropy pool.
  g.crypto = { ...(g.crypto ?? {}), randomUUID: () => Crypto.randomUUID() };
}
