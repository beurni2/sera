import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * ⚠ « ENVOYER LA VÉRIFICATION » DID NOTHING ON DEVICE (founder report,
 * 2026-08-09) — and every source scan in this repo was green while it didn't.
 *
 * The chain: `attemptFor` mints an act id on the FIRST line of every custody
 * act; `mintCommandId` reads the ambient `globalThis.crypto.randomUUID` and
 * THROWS when there is none (correct — a custody idempotency key must never
 * come from `Math.random`); Hermes provides no WebCrypto and Expo's winter
 * runtime installs TextDecoder/URL/structuredClone/FormData and NO crypto; and
 * `ensureCsprng()`, the shim written for exactly this, was **called by nobody**.
 * So the tap threw before `runAct` could set a phase — no spinner, no refusal,
 * no outcome, on the custody spine and the SOS mint alike.
 *
 * Node's WebCrypto satisfies the mint natively, which is precisely why no test
 * ever felt this: the device's missing global cannot be observed by accident.
 * So these tests REMOVE it on purpose, and pin the CALL SITE — the thing that
 * was missing was never the guard, it was the call.
 */

const appDir = join(import.meta.dirname, '..');
const read = (f: string): string => readFileSync(join(appDir, f), 'utf8');

const realCrypto = globalThis.crypto;
afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true, writable: true });
  vi.resetModules();
  vi.unstubAllGlobals();
});

/** Run `fn` in a runtime with no `crypto.randomUUID` — a bare Hermes. */
const withoutCsprng = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
  return await fn();
};

describe('the device CSPRNG — the mint every custody act runs first', () => {
  it('⚠ mintActId THROWS on a runtime with no crypto.randomUUID (this is the dead button)', async () => {
    const { mintActId } = await import('../src/net/custody-acts.js');
    await withoutCsprng(() => {
      // Not a soft failure, not a fallback: it throws, synchronously, which is
      // why the tap did nothing at all rather than showing a refusal.
      expect(() => mintActId()).toThrow(/CSPRNG|randomUUID/i);
    });
  });

  it('ensureCsprng installs the OS CSPRNG, and the mint then succeeds with a real UUIDv4', async () => {
    vi.doMock('expo-crypto', () => ({ randomUUID: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301' }));
    await withoutCsprng(async () => {
      const { ensureCsprng } = await import('../src/offline/ensureCsprng.js');
      const { mintActId } = await import('../src/net/custody-acts.js');
      expect(() => mintActId()).toThrow(); // still bare, one line before the shim
      ensureCsprng();
      const id = mintActId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
    vi.doUnmock('expo-crypto');
  });

  it('ensureCsprng is a no-op where the runtime already provides one (Node, and any future RN that ships it)', async () => {
    vi.doMock('expo-crypto', () => ({
      randomUUID: () => {
        throw new Error('expo-crypto must not be consulted when the runtime already has a CSPRNG');
      },
    }));
    const { ensureCsprng } = await import('../src/offline/ensureCsprng.js');
    const before = globalThis.crypto.randomUUID();
    ensureCsprng();
    expect(globalThis.crypto.randomUUID()).not.toBe(before); // still the real one, still random
    vi.doUnmock('expo-crypto');
  });

  /**
   * THE CALL SITE. A shim that exists is not a shim that runs — that was the
   * whole defect, and a behaviour test of `ensureCsprng()` in isolation would
   * have stayed green through it. `test/startup-graph.test.ts` carries the
   * other half: the module must be REACHABLE from index.ts, so this call
   * cannot be satisfied by a line in something the bundler never loads.
   */
  it('⚠ App.tsx CALLS ensureCsprng() at module scope, next to its already-wired twin', () => {
    const app = read('App.tsx');
    expect(app, 'App.tsx never imports the CSPRNG shim').toMatch(
      /import \{ ensureCsprng \} from '\.\/src\/offline\/ensureCsprng'/,
    );
    expect(app, 'the shim is imported but never CALLED — the exact defect this test exists for').toMatch(
      /^ensureCsprng\(\);$/m,
    );
    // at module scope, so it runs on import — before any handler can mint
    const call = app.indexOf('\nensureCsprng();');
    expect(call, 'ensureCsprng() is not called at module scope').toBeGreaterThan(-1);
    expect(app.slice(0, call), 'the mint must not be reachable before the shim installs').not.toMatch(
      /^\s*(?:const|let)\s+\w+\s*=\s*mint(?:ActId|CommandId)\(\)/m,
    );
    // its twin stays wired too — one regression must not silently take both
    expect(app).toMatch(/^ensureSha256\(\);$/m);
  });
});
