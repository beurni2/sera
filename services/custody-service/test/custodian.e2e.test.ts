import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ MANIFESTE-1 — `GET /produce/custodian`: the ledger's word, for logistics ═══
 *
 * SE-I04: « task status alone MUST NOT be custody truth. » SE3.2 needs the
 * held packages from the CUSTODY STORE before a shift may end; SE3.1's
 * manifest needs the same word for its inventory. This is the read logistics
 * makes, on its producer key: a chain not opened is `open: false` with no
 * custodian (never a 409 the caller must guess at); an opened chain names
 * the current custodian exactly as the ledger does.
 */

const OPS = 'test-custody-ops-custodian';
const PRODUCE = 'test-produce-key-custodian';
const SCRIPT = 'dist-worker/worker.mjs';
const ORDER = 'ord-cust-0001';
const PKG = 'pkg-cust-0001';
const SUPPLIER = 'sup-cust-0001';
const RIDER = 'rider-cust-0001';
const PICKUP_CODE = 'PICKUP-CUST-0001';
const SEAL_CODE = 'SEAL-CUST-0001';
const T = '2026-09-18T09:00:00.000Z';
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

const dir = mkdtempSync(join(tmpdir(), 'custody-custodian-'));
const mf = new Miniflare({
  modules: true,
  scriptPath: SCRIPT,
  compatibilityDate: '2025-07-05',
  compatibilityFlags: ['nodejs_compat'],
  durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
  durableObjectsPersist: dir,
  bindings: { SERA_CUSTODY_OPS_SECRET: OPS, SERA_PRODUCE_SECRET: PRODUCE },
});
afterAll(async () => {
  await mf.dispose();
  rmSync(dir, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

async function ops(path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function custodian(key: string | null, orderId = ORDER): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody/produce/custodian?orderId=${orderId}`, {
    headers: key === null ? {} : { Authorization: `Bearer ${key}` },
  });
  return { status: res.status, json: (await res.json()) as Json };
}

describe('GET /produce/custodian — who holds the package, said by the ledger', () => {
  it('a chain not yet opened: open false, no package, no custodian — honest, never a refusal', async () => {
    const r = await custodian(PRODUCE);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, open: false, packageId: null, currentCustodian: null });
  });

  it('the door is the producer’s: the ops key, a wrong key and no key are the one 401', async () => {
    for (const key of [OPS, 'wrong', null]) expect((await custodian(key)).status, String(key)).toBe(401);
  });

  it('opened, verified and sealed: the custodian is the courier, by the ledger’s own name; before the seal it was the seller', async () => {
    expect((await ops('/ops/order/open', { orderId: ORDER, taskId: `task-${ORDER}`, packageId: PKG, correlationId: `corr-${ORDER}`, supplierId: SUPPLIER })).status).toBe(200);
    for (const [kind, secret] of [['pickup_verification_code', PICKUP_CODE], ['custody_seal', SEAL_CODE]] as const) {
      expect((await ops('/ops/secrets/arm', { orderId: ORDER, command_id: `arm-${kind}`, kind, secret })).status).toBe(200);
    }
    const opened = await custodian(PRODUCE);
    expect(opened.json).toMatchObject({ ok: true, open: true, packageId: PKG });
    expect(opened.json['currentCustodian']).not.toBe(`courier:${RIDER}`);
    expect((await ops('/ops/verification', {
      orderId: ORDER, command_id: 'verify-1', riderId: RIDER, presentedPickupCode: PICKUP_CODE, evidenceBundleId: 'ev-1', dwellSec: 150, checkResults: ALL_PASS, at: T,
    })).status).toBe(200);
    expect((await ops('/ops/custody/begin', { orderId: ORDER, command_id: 'begin-1', riderId: RIDER, custodySealId: SEAL_CODE, sealPhotoRefs: [], at: T })).status).toBe(200);
    const held = await custodian(PRODUCE);
    expect(held.json).toEqual({ ok: true, open: true, packageId: PKG, currentCustodian: `courier:${RIDER}` });
  });
});
