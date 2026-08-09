import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

  it('ensureCsprng installs the OS CSPRNG, and the mint draws FROM IT — not from a lookalike', async () => {
    const FROM_OS = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    vi.doMock('expo-crypto', () => ({ randomUUID: () => FROM_OS }));
    await withoutCsprng(async () => {
      const { ensureCsprng } = await import('../src/offline/ensureCsprng.js');
      const { mintActId } = await import('../src/net/custody-acts.js');
      expect(() => mintActId()).toThrow(/CSPRNG|randomUUID/i); // still bare, one line before the shim
      ensureCsprng();
      /**
       * ⚠ IDENTITY, NOT SHAPE (verifier M1). Asserting only « looks like a
       * UUIDv4 » left the SOURCE of the bytes unpinned: a shim returning one
       * frozen constant — or a UUID assembled from `Math.random()` — passed the
       * whole suite AND the mint-path-entropy gate. A constant idempotency key
       * is the worse of the two: custody dedupes on it, so every act for ever
       * would replay the first answer. The id must be the one expo-crypto gave.
       */
      expect(mintActId()).toBe(FROM_OS);
    });
    vi.doUnmock('expo-crypto');
  });

  it('⚠ THE TWO SHIMS COMPOSE — running both, in App.tsx order, leaves BOTH capabilities installed', async () => {
    /**
     * Verifier M2. On a bare Hermes `ensureSha256()` runs first and CREATES
     * `globalThis.crypto = { subtle: { digest } }`; `ensureCsprng()` then
     * rebuilds that object. The `...(g.crypto ?? {})` spread is load-bearing —
     * drop it and the photo digest disappears silently, taking the delivery
     * evidence hash with it. Each shim was only ever tested alone, so nothing
     * noticed. This runs them together, in the order App.tsx runs them.
     */
    vi.doMock('expo-crypto', () => ({
      randomUUID: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      digest: async () => new ArrayBuffer(32),
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    }));
    await withoutCsprng(async () => {
      const { ensureSha256 } = await import('../src/offline/ensureSha256.js');
      const { ensureCsprng } = await import('../src/offline/ensureCsprng.js');
      ensureSha256();
      ensureCsprng();
      const g = globalThis as unknown as {
        crypto: { randomUUID?: () => string; subtle?: { digest?: unknown } };
      };
      expect(typeof g.crypto.randomUUID, 'the CSPRNG did not survive').toBe('function');
      expect(typeof g.crypto.subtle?.digest, 'the digest was clobbered by the CSPRNG shim').toBe('function');
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
    // its twin stays wired too — one regression must not silently take both
    expect(app).toMatch(/^ensureSha256\(\);$/m);
  });

  /**
   * ⚠ THE GUARD THAT ACTUALLY MATTERS, AND THE ONE I FIRST GOT WRONG (verifier M4).
   *
   * `ensureCsprng()` is written between imports, which LOOKS like it runs before
   * them — it does not. Babel hoists every `require` above interleaved statements,
   * so the shim runs after all of App.tsx's dependencies have been evaluated. That
   * is harmless only while nothing mints at module scope, and the guard I wrote
   * checked one syntactic form (`const x = mint…()`) in one file, missing
   * `export const x = mint…()`, a bare `void mint…()`, and every dependency —
   * which is exactly where the hazard lives.
   *
   * So: scan ALL app source for a mint EXECUTED at module scope. Column 0 is the
   * discriminator for a top-level statement; a line whose mint sits behind `=>`
   * is a definition, not an execution (that is `mintActId` itself).
   */
  it('⚠ NOTHING mints at module scope — a dependency that did would run before the shim', () => {
    const roots = [join(appDir, 'App.tsx'), join(appDir, 'index.ts'), join(appDir, 'src')];
    const files: string[] = [];
    const collect = (p: string): void => {
      if (statSync(p).isDirectory()) {
        for (const e of readdirSync(p)) collect(join(p, e));
      } else if (/\.(ts|tsx)$/.test(p)) files.push(p);
    };
    for (const r of roots) collect(r);
    expect(files.length, 'no source scanned — the guard would pass vacuously').toBeGreaterThan(30);

    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const line of src.split('\n')) {
        if (!/^\S/.test(line)) continue; // indented ⇒ inside a block, runs on call
        if (!/\bmint(?:ActId|CommandId)\s*\(/.test(line)) continue;
        if (/=>/.test(line.slice(0, line.search(/\bmint(?:ActId|CommandId)\s*\(/)))) continue; // a definition
        offenders.push(`${relative(appDir, f)}: ${line.trim()}`);
      }
    }
    expect(offenders, `these mint at import time, before ensureCsprng() runs: ${offenders.join(' · ')}`).toEqual([]);
  });
});
