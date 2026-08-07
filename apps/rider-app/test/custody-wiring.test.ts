import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../src/offline/connectivity';
import { custodyBegan } from '../src/net/custody-acts';
import { isCustodyWired, resolveCustodyActs, unwiredCustodyActs } from '../src/net/resolveCustodyActs';
import { isWired } from '../src/net/resolveRiderSession';

/**
 * SE-LIVE-4c-iv · the build config, and the one thing it must never do.
 *
 * The app is given two PUBLIC Worker URLs at build time and nothing else. The
 * standing secret law: this repo is public, and an `EXPO_PUBLIC_*` is inlined
 * into the shipped bundle — so a key there is a published key.
 */

const ACT = {
  commandId: 'cmd-1' as never,
  orderId: 'ord-1',
  custodySealId: 'SEAL-1',
  sealPhotoRefs: ['p.jpg'],
};

describe('an unwired build never pretends to hold a package', () => {
  it('refuses every custody act instead of reporting custody', async () => {
    const port = unwiredCustodyActs();
    const answer = await port.beginCustody(ACT, 'CODE');
    expect(answer).toEqual({ kind: 'unreachable', reason: 'not_configured' });
    // ⚠ THE LINE THAT MATTERS: an unwired build must never show a rider that
    // a package is in their custody when no ledger anywhere says so.
    expect(custodyBegan(answer)).toBe(false);
    expect(custodyBegan(await port.verifyPickup({ ...ACT, presentedPickupCode: 'x', evidenceBundleId: 'e', dwellSec: 1, checkResults: {} } as never, 'CODE'))).toBe(false);
  });

  it('reports wiring honestly for each service, separately', () => {
    expect(isCustodyWired(undefined)).toBe(false);
    expect(isCustodyWired('')).toBe(false);
    expect(isCustodyWired('   ')).toBe(false);
    expect(isCustodyWired('https://custody-service.example.workers.dev')).toBe(true);
    // The two services are named independently — one being configured says
    // nothing about the other.
    expect(isWired(undefined)).toBe(false);
    expect(isWired('https://logistics-service.example.workers.dev')).toBe(true);
  });

  it('resolves to the refusing port when no custody base is configured', async () => {
    const port = resolveCustodyActs(createManualConnectivity('online'), undefined);
    expect(custodyBegan(await port.beginCustody(ACT, 'CODE'))).toBe(false);
  });
});

describe('the bundle carries URLs, never keys', () => {
  const repoRoot = join(import.meta.dirname, '..', '..', '..');
  const appDir = join(import.meta.dirname, '..');

  it('the app reads only the two public base URLs from the environment', () => {
    const files = [
      'src/net/resolveRiderSession.ts',
      'src/net/resolveCustodyActs.ts',
      'src/net/httpRiderSession.ts',
      'src/net/custody-acts.ts',
      'src/preview.ts',
    ];
    const allowed = new Set([
      'EXPO_PUBLIC_SERA_LOGISTICS_BASE',
      'EXPO_PUBLIC_SERA_CUSTODY_BASE',
      'EXPO_PUBLIC_PROFILE',
    ]);
    for (const f of files) {
      const src = readFileSync(join(appDir, f), 'utf8');
      for (const [, name] of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        expect(`${f} reads ${name}`).toBe(`${f} reads ${name === undefined ? '' : allowed.has(name) ? name : 'A FORBIDDEN VAR'}`);
      }
    }
  });

  it('no secret name is ever prefixed EXPO_PUBLIC anywhere in the app or its build', () => {
    // An EXPO_PUBLIC_* is INLINED INTO THE SHIPPED BUNDLE. These are the
    // founder's keys and the service-to-service keys; a bundled one is a
    // published one, and this repo is public.
    const secrets = [
      'SERA_OPS_SECRET',
      'SERA_INTAKE_SECRET',
      'SERA_CUSTODY_OPS_SECRET',
      'SERA_RIDER_VERIFY_SECRET',
      'FULFILLMENT_OPS_SECRET',
      'CHECKOUT_OPS_SECRET',
      'MEDIA_REVOKE_SECRET',
      'PROGRESS_WRITE_SECRET',
      'PROTECTION_OPS_SECRET',
    ];
    const targets = [
      join(appDir, 'app.json'),
      join(appDir, 'package.json'),
      join(repoRoot, '.github/workflows/expo-preview.yml'),
    ];
    for (const t of targets) {
      const src = readFileSync(t, 'utf8');
      for (const s of secrets) {
        expect(`${t.split('/').pop()} bundles ${s}`).toBe(`${t.split('/').pop()} bundles ${src.includes(`EXPO_PUBLIC_${s}`) ? 'IT' : s}`);
      }
    }
  });

  it('app.json carries no rider code and no bearer token', () => {
    const src = readFileSync(join(appDir, 'app.json'), 'utf8');
    expect(src).not.toMatch(/SR-[A-Z0-9]{4}-/);
    expect(src.toLowerCase()).not.toMatch(/\bbearer\b/);
    expect(src.toLowerCase()).not.toMatch(/"?secret"?\s*:/);
  });
});
