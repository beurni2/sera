import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ VRAI-ROUTE (founder, 2026-08-10) — THE REAL DELIVERY LOOP, END TO END ═══
 *
 * Four rulings under test, all on the REAL Worker bundle:
 *
 *   1. PRODUCER DOORS — logistics opens the chain and arms the machine-carried
 *      pickup code through `/produce/*` (SERA_PRODUCE_SECRET); Shop+ arms the
 *      buyer's drop code through `/produce-shop/secrets/arm` (SHOP_ARM_SECRET).
 *      Each key arms EXACTLY ONE kind — the four-secrets law at the door.
 *   2. REGISTER-AT-BEGIN SEAL — the physical seal roll cannot be pre-armed per
 *      order, so the seal the rider TYPES at begin binds on first use; the
 *      evidence bundle must still match it by equality, and it stays
 *      single-use.
 *   3. TRANSIT FACTS — « En route » and « Je suis arrivé » are rider acts now:
 *      first-wins, spine-gated (no depart before custody, no arrive before
 *      depart), and relayed to Shop+'s `/fulfillment/transit` at-least-once.
 *   4. AUTO-DECIDE — the deterministic ValidationDecision runs when evidence
 *      LANDS; a photo validates, an empty bundle holds for review. Money still
 *      moves ONLY on the buyer's code — the review_hold branch proves it.
 *
 * The Shop+ receiver below is CONTRACT-CERTIFIED (Execution Contract §3)
 * against the real storefront doors: Bearer PROGRESS_WRITE_SECRET or a
 * uniform 401, `200 {ok:...}` on a recorded fact. Any drift in the real doors
 * must be mirrored here BY HAND, eyes open.
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-ops-secret-vrai-0001';
const PRODUCE_KEY = 'test-produce-secret-vrai-0001';
const SHOP_ARM_KEY = 'test-shop-arm-secret-vrai-0001';
const SHOP_WIRE_KEY = 'test-progress-write-secret-vrai';
const VERIFY_KEY = 'test-rider-verify-secret-vrai';

const RIDER = 'rider-vrai-0001';
const RIDER_CODE = 'SR-VRAI-PERSONAL-0001';

const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-vrai-${tag}-`));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

/** Everything the two Shop+ doors received, split by door. */
interface ShopInbox {
  progress: Json[];
  transit: Json[];
}

function shopStub(inbox: ShopInbox) {
  return async (request: Request): Promise<Response> => {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${SHOP_WIRE_KEY}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const path = new URL(request.url).pathname;
    const body = (await request.json().catch(() => ({}))) as Json;
    if (path === '/fulfillment/progress') {
      inbox.progress.push(body);
      return Response.json({ ok: true, status: 'recorded' });
    }
    if (path === '/fulfillment/transit') {
      inbox.transit.push(body);
      return Response.json({ ok: true, status: 'recorded' });
    }
    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  };
}

function logisticsStub() {
  return async (request: Request): Promise<Response> => {
    const auth = request.headers.get('Authorization') ?? '';
    if (auth !== `Bearer ${VERIFY_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (new URL(request.url).pathname !== '/verify/rider-code') {
      return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
    }
    const body = (await request.json().catch(() => null)) as Json | null;
    if (String(body?.['code'] ?? '') !== RIDER_CODE) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    return Response.json({ ok: true, riderId: RIDER });
  };
}

function boot(
  dir: string,
  inbox: ShopInbox,
  opts: { shopWired?: boolean; produceWired?: boolean } = {},
): Miniflare {
  return new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: {
      LOGISTICS: logisticsStub(),
      ...(opts.shopWired !== false ? { SHOP_PROGRESS: shopStub(inbox) } : {}),
    },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: OPS,
      SERA_RIDER_VERIFY_SECRET: VERIFY_KEY,
      ...(opts.produceWired !== false ? { SERA_PRODUCE_SECRET: PRODUCE_KEY, SHOP_ARM_SECRET: SHOP_ARM_KEY } : {}),
      ...(opts.shopWired !== false ? { SHOP_PROGRESS_SECRET: SHOP_WIRE_KEY } : {}),
    },
  });
}

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

function chainFor(orderId: string): Json {
  return {
    orderId,
    taskId: `task-${orderId}`,
    packageId: `pkg-${orderId}`,
    correlationId: `corr-${orderId}`,
    supplierId: 'supplier-vrai-1',
  };
}

/** Open + arm the two machine secrets through the PRODUCER doors — the exact
 *  roads logistics and Shop+ will drive live. */
async function machineArmed(mf: Miniflare, orderId: string, pickup: string, drop: string): Promise<void> {
  expect((await call(mf, 'POST', '/produce/order/open', PRODUCE_KEY, chainFor(orderId))).status).toBe(200);
  expect((await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, {
    orderId, command_id: `arm-p-${orderId}`, kind: 'pickup_verification_code', secret: pickup,
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce-shop/secrets/arm', SHOP_ARM_KEY, {
    orderId, command_id: `arm-d-${orderId}`, kind: 'buyer_drop_code', secret: drop,
  })).status).toBe(200);
}

describe('the producer doors — each key opens almost nothing', () => {
  const inbox: ShopInbox = { progress: [], transit: [] };

  it('logistics opens the chain and arms the pickup code; Shop+ arms the drop code; every cross-use refuses', async () => {
    const mf = boot(freshDir('doors'), inbox);
    const O = 'ord-vrai-doors';
    await machineArmed(mf, O, 'PICKUP-DOORS-1', 'DROP-DOORS-1');

    // The four-secrets law AT THE DOOR: logistics' key can never arm the
    // buyer's code, Shop+'s can never arm the carrier's — and nobody
    // pre-arms the seal any more (register-at-begin).
    for (const [door, key, kind] of [
      ['/produce/secrets/arm', PRODUCE_KEY, 'buyer_drop_code'],
      ['/produce/secrets/arm', PRODUCE_KEY, 'custody_seal'],
      ['/produce-shop/secrets/arm', SHOP_ARM_KEY, 'pickup_verification_code'],
      ['/produce-shop/secrets/arm', SHOP_ARM_KEY, 'custody_seal'],
    ] as const) {
      const refused = await call(mf, 'POST', door, key, {
        orderId: O, command_id: `smuggle-${kind}`, kind, secret: 'SMUGGLED',
      });
      expect(refused.status, `${door} ${kind}`).toBe(403);
      expect(refused.json).toMatchObject({ ok: false, reason: 'kind_not_armable_at_this_door' });
    }

    // One door's key does not open the other door.
    expect((await call(mf, 'POST', '/produce-shop/secrets/arm', PRODUCE_KEY, {
      orderId: O, command_id: 'x', kind: 'buyer_drop_code', secret: 'X',
    })).status).toBe(401);
    expect((await call(mf, 'POST', '/produce/secrets/arm', SHOP_ARM_KEY, {
      orderId: O, command_id: 'x', kind: 'pickup_verification_code', secret: 'X',
    })).status).toBe(401);

    // The allowlist: NOTHING else exists behind a producer key — not a read,
    // not a delivery act, not chain-open on the Shop+ door.
    expect((await call(mf, 'GET', `/produce/ledger?orderId=${O}`, PRODUCE_KEY)).status).toBe(404);
    expect((await call(mf, 'POST', '/produce/delivery/decide', PRODUCE_KEY, { orderId: O, command_id: 'x' })).status).toBe(404);
    expect((await call(mf, 'POST', '/produce-shop/order/open', SHOP_ARM_KEY, chainFor(O))).status).toBe(404);
    await mf.dispose();
  });

  it('an unwired producer door fails CLOSED, with the one identical 401', async () => {
    const mf = boot(freshDir('unwired'), inbox, { produceWired: false });
    const naked = await call(mf, 'POST', '/produce/order/open', PRODUCE_KEY, chainFor('ord-vrai-closed'));
    const shop = await call(mf, 'POST', '/produce-shop/secrets/arm', SHOP_ARM_KEY, {
      orderId: 'ord-vrai-closed', command_id: 'x', kind: 'buyer_drop_code', secret: 'X',
    });
    expect(naked.status).toBe(401);
    expect(shop.status).toBe(401);
    expect(naked.json).toEqual(shop.json);
    await mf.dispose();
  });
});

describe('VRAI-ROUTE — the whole road, machine-armed, in the rider her own hand', () => {
  const O = 'ord-vrai-route';
  const PICKUP = 'PICKUP-VRAI-0001';
  const SEAL = 'SEAL-VRAI-0001';
  const DROP = 'DROP-VRAI-7391';
  const inbox: ShopInbox = { progress: [], transit: [] };
  const dir = freshDir('route');

  it('produce-open, machine codes, register-at-begin seal, transit gates, auto-decide, drop — and BOTH wires deliver', async () => {
    const mf = boot(dir, inbox);
    await machineArmed(mf, O, PICKUP, DROP);

    // The rider cannot narrate a road she is not on: depart BEFORE custody.
    const early = await call(mf, 'POST', '/rider/transit/depart', RIDER_CODE, { orderId: O, command_id: 'dep-early' });
    expect(early.status).toBe(409);
    expect(early.json).toMatchObject({ ok: false, reason: 'custody_not_with_courier' });

    // Machine-carried pickup code, presented through her own door.
    expect((await call(mf, 'POST', '/rider/verification', RIDER_CODE, {
      orderId: O, command_id: 'verify-1', presentedPickupCode: PICKUP,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-vrai-1',
    })).status).toBe(200);

    // REGISTER-AT-BEGIN: no `/secrets/arm` ever ran for the seal — the value
    // she types from the physical roll binds on first use.
    const began = await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: O, command_id: 'begin-1', custodySealId: SEAL, sealPhotoRefs: ['photo-seal-vrai-1'],
    });
    expect(began.status).toBe(200);
    expect(began.json).toMatchObject({ ok: true, status: 'custody_with_courier', riderId: RIDER });

    // ...and it BOUND: a different seal on a fresh command cannot re-begin.
    const otherSeal = await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: O, command_id: 'begin-other-seal', custodySealId: 'SEAL-SOMEONE-ELSE', sealPhotoRefs: ['p'],
    });
    expect(otherSeal.status).toBe(409);

    // Arrive before depart is a story out of order.
    const tooSoon = await call(mf, 'POST', '/rider/transit/arrive', RIDER_CODE, { orderId: O, command_id: 'arr-early' });
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.json).toMatchObject({ reason: 'not_departed' });

    // « En route » — first-wins, and the replay answers the ORIGINAL instant.
    const dep = await call(mf, 'POST', '/rider/transit/depart', RIDER_CODE, { orderId: O, command_id: 'dep-1' });
    expect(dep.status).toBe(200);
    expect(dep.json).toMatchObject({ ok: true, status: 'departed' });
    const depAgain = await call(mf, 'POST', '/rider/transit/depart', RIDER_CODE, { orderId: O, command_id: 'dep-2' });
    expect(depAgain.json).toMatchObject({ ok: true, status: 'deja', at: dep.json['at'] });

    // « Je suis arrivé »
    const arr = await call(mf, 'POST', '/rider/transit/arrive', RIDER_CODE, { orderId: O, command_id: 'arr-1' });
    expect(arr.status).toBe(200);
    expect(arr.json).toMatchObject({ ok: true, status: 'arrived' });

    // Evidence carries the SAME seal she typed — and NOBODY calls decide:
    // the decision is the object's own, the moment the evidence lands.
    expect((await call(mf, 'POST', '/rider/delivery/evidence', RIDER_CODE, {
      orderId: O, command_id: 'ev-1',
      bundle: {
        taskId: `task-${O}`, packageId: `pkg-${O}`, custodySealId: SEAL,
        artifacts: [{ ref: 'photo-remise-1', sha256: 'a'.repeat(64), mimeType: 'image/jpeg' }],
        capturedAt: '2026-08-10T10:00:00.000Z',
      },
    })).status).toBe(200);

    // The buyer's code moves the money-moment — with NO ops decide in between.
    const drop = await call(mf, 'POST', '/rider/delivery/drop', RIDER_CODE, {
      orderId: O, command_id: 'drop-1', dropCode: DROP,
    });
    expect(drop.status).toBe(200);
    expect(drop.json).toMatchObject({ ok: true, status: 'custody_with_customer' });

    // ASK THE LEDGER: the decision the object took is on the record, and the
    // journey facts name the rider WHO said them (attribution via the door).
    const ledger = await call(mf, 'GET', `/ops/ledger?orderId=${O}`, OPS);
    const kinds = (ledger.json['entries'] as { kind: string; payload: Json }[]).map((e) => e.kind);
    expect(kinds).toContain('validation_decision');
    expect((await call(mf, 'GET', `/ops/ledger/verify?orderId=${O}`, OPS)).json).toMatchObject({ headMatches: true });
    const att = await call(mf, 'GET', `/ops/attestations?orderId=${O}`, OPS);
    expect(att.json['transit']).toMatchObject({
      departedAt: dep.json['at'], departedBy: RIDER, arrivedAt: arr.json['at'], arrivedBy: RIDER,
    });

    // BOTH WIRES: the two transit facts and the one eligibility event cross.
    for (let i = 0; i < 80 && (inbox.transit.length < 2 || inbox.progress.length < 1); i += 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const stages = inbox.transit.map((b) => b['stage']).sort();
    expect(stages, 'both transit facts must reach /fulfillment/transit').toEqual(['arrivee', 'en_route']);
    for (const fact of inbox.transit) {
      expect(fact['orderId']).toBe(O);
      expect(typeof fact['asOf']).toBe('string');
    }
    expect(inbox.progress[0]?.['name']).toBe('delivery.validated.v1');

    // The road survives a real process death: the facts answer déjà, with
    // their ORIGINAL instants, on a rebuilt object.
    await mf.dispose();
    const mf2 = boot(dir, inbox);
    const depAfter = await call(mf2, 'POST', '/rider/transit/depart', RIDER_CODE, { orderId: O, command_id: 'dep-3' });
    expect(depAfter.json).toMatchObject({ status: 'deja', at: dep.json['at'] });
    await mf2.dispose();
  }, 60_000);
});

describe('auto-decide holds the line — a hold still parks the money', () => {
  const inbox: ShopInbox = { progress: [], transit: [] };

  it('an evidence bundle with NO artifact auto-decides review_hold, and the drop refuses not_validated', async () => {
    const mf = boot(freshDir('hold'), inbox);
    const O = 'ord-vrai-hold';
    const SEAL = 'SEAL-HOLD-1';
    await machineArmed(mf, O, 'PICKUP-HOLD-1', 'DROP-HOLD-1');
    expect((await call(mf, 'POST', '/rider/verification', RIDER_CODE, {
      orderId: O, command_id: 'v1', presentedPickupCode: 'PICKUP-HOLD-1',
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-hold',
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: O, command_id: 'b1', custodySealId: SEAL, sealPhotoRefs: ['p1'],
    })).status).toBe(200);

    // GPS-only: artifacts empty. The object decides review_hold ON ITS OWN...
    expect((await call(mf, 'POST', '/rider/delivery/evidence', RIDER_CODE, {
      orderId: O, command_id: 'e1',
      bundle: { taskId: `task-${O}`, packageId: `pkg-${O}`, custodySealId: SEAL, artifacts: [], capturedAt: '2026-08-10T10:00:00.000Z' },
    })).status).toBe(200);

    // ...and a hold RELEASES NOTHING: the right code cannot move custody.
    const drop = await call(mf, 'POST', '/rider/delivery/drop', RIDER_CODE, {
      orderId: O, command_id: 'd1', dropCode: 'DROP-HOLD-1',
    });
    expect(drop.status).toBe(409);
    expect(drop.json).toMatchObject({ ok: false, reason: 'not_validated' });

    // The hold is ON THE RECORD, not just implied by a refusal.
    const ledger = await call(mf, 'GET', `/ops/ledger?orderId=${O}`, OPS);
    const decision = (ledger.json['entries'] as { kind: string; payload: Json }[])
      .filter((e) => e.kind === 'validation_decision').at(-1)!;
    expect(decision.payload).toMatchObject({ result: 'review_hold', reasons: ['gps_never_sole_proof'] });
    await mf.dispose();
  }, 60_000);

  it('evidence naming a seal OTHER than the one that bound at begin is refused — first-use binding is still a binding', async () => {
    const mf = boot(freshDir('sealbind'), inbox);
    const O = 'ord-vrai-sealbind';
    await machineArmed(mf, O, 'PICKUP-SB-1', 'DROP-SB-1');
    expect((await call(mf, 'POST', '/rider/verification', RIDER_CODE, {
      orderId: O, command_id: 'v1', presentedPickupCode: 'PICKUP-SB-1',
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-sb',
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: O, command_id: 'b1', custodySealId: 'SEAL-SB-TYPED', sealPhotoRefs: ['p1'],
    })).status).toBe(200);
    const foreign = await call(mf, 'POST', '/rider/delivery/evidence', RIDER_CODE, {
      orderId: O, command_id: 'e1',
      bundle: {
        taskId: `task-${O}`, packageId: `pkg-${O}`, custodySealId: 'SEAL-SB-FORGED',
        artifacts: [{ ref: 'ph', sha256: 'b'.repeat(64), mimeType: 'image/jpeg' }],
        capturedAt: '2026-08-10T10:00:00.000Z',
      },
    });
    expect(foreign.status).toBe(409);
    expect(foreign.json).toMatchObject({ reason: 'evidence_seal_mismatch' });
    await mf.dispose();
  }, 60_000);
});

describe('the transit wire rests honestly and is revived by a replayed act', () => {
  it('unwired at depart time, the fact still crosses once the config exists and the rider re-taps', async () => {
    const dir = freshDir('rest');
    const inbox: ShopInbox = { progress: [], transit: [] };
    const O = 'ord-vrai-rest';

    // No SHOP_PROGRESS binding, no wire secret: the row must come to REST
    // (unsendable_no_config), never be dropped, never crash the act.
    let mf = boot(dir, inbox, { shopWired: false });
    await machineArmed(mf, O, 'PICKUP-REST-1', 'DROP-REST-1');
    expect((await call(mf, 'POST', '/rider/verification', RIDER_CODE, {
      orderId: O, command_id: 'v1', presentedPickupCode: 'PICKUP-REST-1',
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-rest',
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: O, command_id: 'b1', custodySealId: 'SEAL-REST-1', sealPhotoRefs: ['p1'],
    })).status).toBe(200);
    const dep = await call(mf, 'POST', '/rider/transit/depart', RIDER_CODE, { orderId: O, command_id: 'd1' });
    expect(dep.status).toBe(200);
    // Give the alarm a moment to run and park the row.
    await new Promise((r) => setTimeout(r, 1_500));
    expect(inbox.transit.length).toBe(0);

    // The founder wires the secret; the rider's REPLAYED tap is the recovery
    // hook — same law as the drop route's stranded-outbox revival.
    await mf.dispose();
    mf = boot(dir, inbox);
    const again = await call(mf, 'POST', '/rider/transit/depart', RIDER_CODE, { orderId: O, command_id: 'd2' });
    expect(again.json).toMatchObject({ status: 'deja', at: dep.json['at'] });
    for (let i = 0; i < 80 && inbox.transit.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(inbox.transit.length, 'the resting fact must cross once config exists').toBeGreaterThanOrEqual(1);
    expect(inbox.transit[0]).toMatchObject({ orderId: O, stage: 'en_route', asOf: dep.json['at'] });
    await mf.dispose();
  }, 60_000);
});
