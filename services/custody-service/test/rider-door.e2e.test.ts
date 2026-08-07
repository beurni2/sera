import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ SE-LIVE-4b-ii — THE RIDER'S OWN HAND, NOT THE FOUNDER'S WORD ═══
 *
 * FOUNDER RULING (2026-08-07): « rider identity stays in logistics; custody
 * asks. One place mints and revokes a rider code; custody only ever asks *is
 * this code this rider's, right now*. » A second credential store would be two
 * truths about who a rider is, and a revoked code must die everywhere at once.
 *
 * Sera-Build-Spec.md:23 — a rider MUST NOT self-assign or self-declare
 * completion. What a rider MAY do is act as himself, and until this slice he
 * could not: `riderId` was whatever the founder typed through his own key.
 *
 * WHAT THESE TESTS PIN, and it is the part that matters most: the identity
 * custody records comes from LOGISTICS' ANSWER, never from the request. A body
 * that names a different rider is ignored, not honoured.
 */

const OPS = 'test-custody-ops-secret-4bii';
const VERIFY_KEY = 'test-rider-verify-secret-4bii';
const RIDER_CODE = 'RIDER-CODE-4BII-0001';
const RIDER = 'rider-real-0001';

const ORDER = 'ord-4bii-0001';
const PKG = 'pkg-4bii-0001';
const SUPPLIER = 'sup-4bii-0001';
const PICKUP_CODE = 'PICKUP-4BII-0001';
const SEAL_CODE = 'SEAL-4BII-0001';
const T = '2026-08-07T09:00:00.000Z';

const ALL_PASS = {
  order_ref: true, identity: true, variant: true, colour: true, size_label: true,
  qty: true, damage: true, pieces: true, manufacturer_seal: true,
};

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-4bii-${tag}-`));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * A stand-in for the logistics Worker's `/verify/` door, wired through
 * miniflare's `serviceBindings` exactly as the real binding is.
 *
 * ⚠ CONTRACT-CERTIFIED, not convenient (Execution Contract §3): it enforces the
 * SAME key the real door does, gives the SAME uniform 401 for an unknown or
 * revoked code, and can be made to fail or go silent. A mock that answered
 * `{ok:true}` to anything would make this wire look healthier than it is.
 */
function logisticsStub(opts: { known: Map<string, string>; mode?: 'ok' | 'throw' | 'ok-but-nameless' }) {
  return async (request: Request): Promise<Response> => {
    if (opts.mode === 'throw') throw new Error('logistics unreachable');
    const auth = request.headers.get('Authorization') ?? '';
    if (auth !== `Bearer ${VERIFY_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (new URL(request.url).pathname !== '/verify/rider-code') {
      return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const riderId = opts.known.get(String(body?.['code'] ?? ''));
    if (riderId === undefined) return Response.json({ error: 'unauthorized' }, { status: 401 });
    // The « ok but nameless » arm: a directory that answers without naming a
    // usable rider. Custody must treat that as a refusal, not a pass.
    if (opts.mode === 'ok-but-nameless') return Response.json({ ok: true });
    return Response.json({ ok: true, riderId });
  };
}

function boot(dir: string, stub: (r: Request) => Promise<Response>, opts: { wired?: boolean } = {}): Miniflare {
  const wired = opts.wired !== false;
  return new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: { LOGISTICS: stub },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: OPS,
      ...(wired ? { SERA_RIDER_VERIFY_SECRET: VERIFY_KEY } : {}),
    },
  });
}

type Json = Record<string, unknown>;
async function call(mf: Miniflare, method: string, path: string, auth: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method,
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { json = { __raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

/** Opened, both secrets armed, pickup verified by the REAL rider. */
async function readyForSeal(mf: Miniflare): Promise<void> {
  expect((await call(mf, 'POST', '/ops/order/open', OPS, {
    orderId: ORDER, taskId: 't', packageId: PKG, correlationId: 'c', supplierId: SUPPLIER,
  })).status).toBe(200);
  for (const [kind, secret] of [
    ['pickup_verification_code', PICKUP_CODE], ['custody_seal', SEAL_CODE],
  ] as const) {
    expect((await call(mf, 'POST', '/ops/secrets/arm', OPS, {
      orderId: ORDER, command_id: `arm-${kind}`, kind, secret,
    })).status).toBe(200);
  }
  expect((await call(mf, 'POST', '/ops/verification', OPS, {
    orderId: ORDER, command_id: 'verify-1', riderId: RIDER,
    presentedPickupCode: PICKUP_CODE, evidenceBundleId: 'ev-1',
    dwellSec: 150, checkResults: ALL_PASS, at: T,
  })).status).toBe(200);
}

const known = () => new Map([[RIDER_CODE, RIDER]]);

describe('the rider takes custody with his own code', () => {
  it('resolves the rider through logistics and records the act as rider-authenticated', async () => {
    const dir = freshDir('happy');
    const mf = boot(dir, logisticsStub({ known: known() }));
    await readyForSeal(mf);

    const began = await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: ORDER, command_id: 'begin-rider', custodySealId: SEAL_CODE,
      sealPhotoRefs: ['seal.jpg'], at: T,
    });
    expect(began.status).toBe(200);
    expect(began.json).toMatchObject({ ok: true, status: 'custody_with_courier', riderId: RIDER });

    // The custodian is the rider logistics named.
    expect((await call(mf, 'GET', `/ops/ledger?orderId=${ORDER}`, OPS)).json)
      .toMatchObject({ currentCustodian: `courier:${RIDER}` });

    // …and the record says HOW he was established, per act.
    const att = await call(mf, 'GET', `/ops/attestations?orderId=${ORDER}`, OPS);
    const taken = att.json['custodyTaken'] as Record<string, unknown>[];
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ riderId: RIDER, attribution: 'rider_authenticated' });
    await mf.dispose();
  });

  it('IGNORES a riderId in the body — the identity is logistics answer, never the caller words', async () => {
    const dir = freshDir('no-smuggle');
    const mf = boot(dir, logisticsStub({ known: known() }));
    await readyForSeal(mf);

    // A rider presenting his own valid code, but naming somebody else in the
    // body. The body must not be able to reach the ledger.
    const began = await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: ORDER, command_id: 'begin-smuggle', riderId: 'rider-SOMEONE-ELSE',
      custodySealId: SEAL_CODE, sealPhotoRefs: ['seal.jpg'], at: T,
    });
    expect(began.status).toBe(200);
    expect(began.json).toMatchObject({ riderId: RIDER });

    const led = await call(mf, 'GET', `/ops/ledger?orderId=${ORDER}`, OPS);
    expect(led.json).toMatchObject({ currentCustodian: `courier:${RIDER}` });
    expect(String(led.json['currentCustodian'])).not.toContain('SOMEONE-ELSE');
    await mf.dispose();
  });

  it('a code logistics does not know is the one uniform 401, and moves nothing', async () => {
    const dir = freshDir('unknown');
    const mf = boot(dir, logisticsStub({ known: known() }));
    await readyForSeal(mf);

    const bodies: string[] = [];
    for (const bad of ['NOT-A-CODE', '', 'RIDER-CODE-4BII-0002']) {
      const res = await mf.dispatchFetch('http://custody/rider/custody/begin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${bad}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: ORDER, command_id: `begin-${bad}`, custodySealId: SEAL_CODE, sealPhotoRefs: ['s.jpg'] }),
      });
      expect(res.status).toBe(401);
      bodies.push(await res.text());
    }
    // IDENTICAL — a difference between any two would be something to probe,
    // and « unknown » must not be distinguishable from « revoked ».
    expect(new Set(bodies).size).toBe(1);

    expect(String((await call(mf, 'GET', `/ops/ledger?orderId=${ORDER}`, OPS)).json['currentCustodian'] ?? ''))
      .not.toContain('courier');
    await mf.dispose();
  });

  it('a revoked code stops working here the moment it stops working there', async () => {
    const dir = freshDir('revoked');
    const live = known();
    const mf = boot(dir, logisticsStub({ known: live }));
    await readyForSeal(mf);

    // The founder revokes it in logistics — the one book.
    live.delete(RIDER_CODE);

    const after = await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: ORDER, command_id: 'begin-revoked', custodySealId: SEAL_CODE, sealPhotoRefs: ['s.jpg'],
    });
    expect(after.status).toBe(401);
    // Custody kept no copy to fall out of step with.
    expect(String((await call(mf, 'GET', `/ops/ledger?orderId=${ORDER}`, OPS)).json['currentCustodian'] ?? ''))
      .not.toContain('courier');
    await mf.dispose();
  });

  it('an unwired custody Worker refuses the rider door, indistinguishably', async () => {
    const dir = freshDir('unwired');
    const mf = boot(dir, logisticsStub({ known: known() }), { wired: false });
    await readyForSeal(mf);
    const res = await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: ORDER, command_id: 'begin-unwired', custodySealId: SEAL_CODE, sealPhotoRefs: ['s.jpg'],
    });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ error: 'unauthorized' });
    await mf.dispose();
  });

  it('logistics unreachable is said plainly, not mistaken for a bad code', async () => {
    const dir = freshDir('down');
    const mf = boot(dir, logisticsStub({ known: known(), mode: 'throw' }));
    await readyForSeal(mf);
    const res = await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: ORDER, command_id: 'begin-down', custodySealId: SEAL_CODE, sealPhotoRefs: ['s.jpg'],
    });
    expect(res.status).toBe(503);
    expect(res.json).toMatchObject({ ok: false, reason: 'rider_directory_unavailable' });
    // No stack trace reaches the rider's phone (the round-3 door lesson).
    expect(JSON.stringify(res.json)).not.toContain('unreachable');
    await mf.dispose();
  });

  it('an ok answer that names no rider is a refusal — corroborated, not counted', async () => {
    const dir = freshDir('nameless');
    const mf = boot(dir, logisticsStub({ known: known(), mode: 'ok-but-nameless' }));
    await readyForSeal(mf);
    const res = await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: ORDER, command_id: 'begin-nameless', custodySealId: SEAL_CODE, sealPhotoRefs: ['s.jpg'],
    });
    expect(res.status).toBe(401);
    expect(String((await call(mf, 'GET', `/ops/ledger?orderId=${ORDER}`, OPS)).json['currentCustodian'] ?? ''))
      .not.toContain('courier');
    await mf.dispose();
  });

  it('the rider door does not open the founder rooms, and his key does not open the rider door', async () => {
    const dir = freshDir('separation');
    const mf = boot(dir, logisticsStub({ known: known() }));
    await readyForSeal(mf);

    // A rider code is not an ops key: the founder's routes stay shut.
    for (const path of ['/ops/ledger?orderId=' + ORDER, '/ops/attestations?orderId=' + ORDER]) {
      expect((await call(mf, 'GET', path, RIDER_CODE)).status).toBe(401);
    }
    // …and the founder's key is not a rider code: logistics does not know it,
    // so the rider door refuses it like any other unknown string.
    const asRider = await call(mf, 'POST', '/rider/custody/begin', OPS, {
      orderId: ORDER, command_id: 'begin-ops-as-rider', custodySealId: SEAL_CODE, sealPhotoRefs: ['s.jpg'],
    });
    expect(asRider.status).toBe(401);
    await mf.dispose();
  });
});

/**
 * ═══ VERIFIER BLOCKER A1 (4b round 1) — WHAT A VALID RIDER CODE OPENS ═══
 *
 * The test above was the ONLY thing guarding the rider door's route surface,
 * and it guarded nothing: it exercised `/ops/*` with a rider code (refused by
 * the pre-existing ops check) and `/rider/*` with the ops secret (refused
 * because logistics does not know that string). Delete the allowlist entirely
 * and it still passes — which is the state this slice shipped in. §9.7.
 *
 * These pin the CONSEQUENCE, not the status code. Every one of them uses a
 * code logistics genuinely resolves, so the only thing standing between the
 * request and the object is `RIDER_ROUTES`.
 */
describe('a valid rider code opens the two rider acts and nothing else', () => {
  /** Opened and both secrets armed by the founder — NOT yet verified, so the
   *  rider acts are still ahead of us. */
  async function armedOnly(mf: Miniflare, order: string, pkg: string): Promise<void> {
    expect((await call(mf, 'POST', '/ops/order/open', OPS, {
      orderId: order, taskId: 't', packageId: pkg, correlationId: 'c', supplierId: SUPPLIER,
    })).status).toBe(200);
    for (const [kind, secret] of [
      ['pickup_verification_code', PICKUP_CODE], ['custody_seal', SEAL_CODE],
    ] as const) {
      expect((await call(mf, 'POST', '/ops/secrets/arm', OPS, {
        orderId: order, command_id: `arm-${kind}`, kind, secret,
      })).status).toBe(200);
    }
  }

  it('refuses every route that is not one of the two rider acts', async () => {
    const dir = freshDir('allowlist');
    const mf = boot(dir, logisticsStub({ known: known() }));
    await armedOnly(mf, ORDER, PKG);

    // Every OTHER route the object exposes, asked for with a code logistics
    // resolves. If the allowlist is removed, each of these reaches the object.
    const shut: ReadonlyArray<readonly [string, string]> = [
      ['POST', '/rider/order/open'],
      ['POST', '/rider/secrets/arm'],
      ['GET', `/rider/ledger?orderId=${ORDER}`],
      ['GET', `/rider/ledger/verify?orderId=${ORDER}`],
      ['GET', `/rider/attestations?orderId=${ORDER}`],
      ['GET', `/rider/events?orderId=${ORDER}`],
      // The two live acts, asked for with the WRONG METHOD — the allowlist
      // pins the verb too, not just the path.
      ['GET', `/rider/verification?orderId=${ORDER}`],
      ['GET', `/rider/custody/begin?orderId=${ORDER}`],
    ];
    for (const [method, path] of shut) {
      const res = await call(mf, method, path, RIDER_CODE, method === 'POST' ? { orderId: ORDER } : undefined);
      expect(`${method} ${path} -> ${res.status}`).toBe(`${method} ${path} -> 404`);
      expect(res.json['reason']).toBe('not_found');
    }
    await mf.dispose();
  });

  it('cannot substitute the four secrets: the founder’s armed code still verifies, the rider’s does not', async () => {
    const dir = freshDir('secrets');
    const mf = boot(dir, logisticsStub({ known: known() }));
    await armedOnly(mf, ORDER, PKG);

    // The attack: re-arm the pickup code with a value the caller chose.
    const arm = await call(mf, 'POST', '/rider/secrets/arm', RIDER_CODE, {
      orderId: ORDER, command_id: 'arm-substituted', kind: 'pickup_verification_code', secret: 'RIDER-CHOSE-THIS',
    });
    expect(arm.status).toBe(404);

    // THE PROOF IT CHANGED NOTHING — the substituted code does not verify…
    const withSubstituted = await call(mf, 'POST', '/rider/verification', RIDER_CODE, {
      orderId: ORDER, command_id: 'verify-substituted', presentedPickupCode: 'RIDER-CHOSE-THIS',
      evidenceBundleId: 'ev-x', dwellSec: 150, checkResults: ALL_PASS, at: T,
    });
    expect(withSubstituted.status).toBe(409);

    // …and the code the FOUNDER armed still does. Law 3: « the four secrets
    // are never substituted ». If the allowlist goes, this call fails instead,
    // because the real rider's code was overwritten out from under her.
    const withReal = await call(mf, 'POST', '/rider/verification', RIDER_CODE, {
      orderId: ORDER, command_id: 'verify-real', presentedPickupCode: PICKUP_CODE,
      evidenceBundleId: 'ev-y', dwellSec: 150, checkResults: ALL_PASS, at: T,
    });
    expect(withReal.status).toBe(200);
    expect(withReal.json['kind']).toBe('accepted');
    await mf.dispose();
  });

  it('cannot squat a package claim and lock the honest order out forever', async () => {
    const dir = freshDir('squat');
    const mf = boot(dir, logisticsStub({ known: known() }));

    // The attack: open a decoy order over a package the founder has not
    // reached yet. The claim is write-once and nothing in this service
    // releases it, so a win here is permanent.
    const squat = await call(mf, 'POST', '/rider/order/open', RIDER_CODE, {
      orderId: 'ord-decoy', taskId: 't', packageId: PKG, correlationId: 'c', supplierId: SUPPLIER,
    });
    expect(squat.status).toBe(404);

    // THE PROOF: the honest order still gets its custody file over that
    // package. Without the allowlist this answers `package_claimed_by_other_order`.
    const honest = await call(mf, 'POST', '/ops/order/open', OPS, {
      orderId: ORDER, taskId: 't', packageId: PKG, correlationId: 'c', supplierId: SUPPLIER,
    });
    expect(honest.status).toBe(200);
    await mf.dispose();
  });

  it('cannot read another order’s custody file', async () => {
    const dir = freshDir('crossread');
    const mf = boot(dir, logisticsStub({ known: known() }));
    await armedOnly(mf, 'ord-someone-else', 'pkg-someone-else');

    for (const path of [
      '/rider/ledger?orderId=ord-someone-else',
      '/rider/attestations?orderId=ord-someone-else',
      '/rider/events?orderId=ord-someone-else',
    ]) {
      const res = await call(mf, 'GET', path, RIDER_CODE);
      expect(res.status).toBe(404);
      // Nothing about the order leaks in the refusal — no custodian, no chain.
      expect(Object.keys(res.json).sort()).toEqual(['ok', 'reason']);
    }
    await mf.dispose();
  });
});

/**
 * ═══ VERIFIER BLOCKER A2 (4b round 1) — WHOSE NAME GOES IN THE RECORD ═══
 *
 * `/verification` read `riderId` from the BODY on both doors and
 * `/attestations` labelled every row `founder_attested`. So an authenticated
 * rider's own act was recorded under whatever name the caller typed, and then
 * attributed to the founder. Both directions of laundering, in one call.
 */
describe('a verification names the hand that actually presented the code', () => {
  it('ignores a riderId in the body and records logistics’ answer, attributed to the rider', async () => {
    const dir = freshDir('a2-rider');
    const mf = boot(dir, logisticsStub({ known: known() }));
    expect((await call(mf, 'POST', '/ops/order/open', OPS, {
      orderId: ORDER, taskId: 't', packageId: PKG, correlationId: 'c', supplierId: SUPPLIER,
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/secrets/arm', OPS, {
      orderId: ORDER, command_id: 'arm-p', kind: 'pickup_verification_code', secret: PICKUP_CODE,
    })).status).toBe(200);

    // Mallory's real code, Aïcha's name in the body.
    const res = await call(mf, 'POST', '/rider/verification', RIDER_CODE, {
      orderId: ORDER, command_id: 'verify-laundered', riderId: 'rider-SOMEONE-ELSE',
      presentedPickupCode: PICKUP_CODE, evidenceBundleId: 'ev-1',
      dwellSec: 150, checkResults: ALL_PASS, at: T,
    });
    expect(res.status).toBe(200);

    const att = (await call(mf, 'GET', `/ops/attestations?orderId=${ORDER}`, OPS)).json;
    const rows = att['attestations'] as ReadonlyArray<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // The code's owner, NOT the body's claim.
    expect(rows[0]?.['riderId']).toBe(RIDER);
    expect(rows[0]?.['riderId']).not.toBe('rider-SOMEONE-ELSE');
    // …and recorded as the rider's own hand, not the founder's word.
    expect(rows[0]?.['attribution']).toBe('rider_authenticated');
    // The blanket response-level label is gone: there is no single true value.
    expect(att['attribution']).toBeUndefined();
    await mf.dispose();
  });

  it('still records the founder’s own door as his attestation', async () => {
    const dir = freshDir('a2-ops');
    const mf = boot(dir, logisticsStub({ known: known() }));
    await readyForSeal(mf);

    const rows = (await call(mf, 'GET', `/ops/attestations?orderId=${ORDER}`, OPS))
      .json['attestations'] as ReadonlyArray<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['riderId']).toBe(RIDER);
    expect(rows[0]?.['attribution']).toBe('founder_attested');
    await mf.dispose();
  });
});
