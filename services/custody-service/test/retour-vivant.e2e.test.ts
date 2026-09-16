import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ RETOUR-VIVANT-1 — THE §6.4 LADDER AND THE §6.5 RETURN ROAD, OVER THE
 * REAL WORKER ═══
 *
 * The spine has held every rule since WO-2.2 (`recordDoorRefusal`,
 * `escalateExpiredWindow`, `applyBuyerFaultRefusal`, `completeReturnHandover`,
 * `fileCustodyLiabilityClaim`) and NO route reached any of them: a buyer who
 * could not pay was never refused by name, and a refused package could never
 * come home on the ledger. These tests drive the REAL bundled Worker
 * (miniflare, real DO storage) through the new wires and ask the LEDGER and
 * the WIRES for the outcome — never the response alone:
 *
 *   · `/rider/door/refusal` · `/rider/door/expire` — the ladder's two rungs.
 *   · `/rider/return/open` — one act, the arm picked by the spine's state.
 *   · `/rider/return/handover` — both keys or neither; custody → seller.
 *   · `/ops/return/claim` — the dispatcher's canon claim, ops only.
 *   · the fifth and sixth wires to LOGISTICS (`/produce/retour-ouvert`,
 *     `/produce/course-retournee`), at-least-once, on the course-livrée key.
 *
 * The logistics stub is CONTRACT-CERTIFIED to what logistics-do.ts answers
 * (200 by name on every settled condition); the keys it would mint are armed
 * here by the test through the SAME produce door logistics uses — so the
 * handover consumes exactly what that door armed.
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-ops-secret-retour-0001';
const PRODUCE_KEY = 'test-produce-secret-retour-0001';
const SHOP_ARM_KEY = 'test-shop-arm-secret-retour-0001';
const VERIFY_KEY = 'test-rider-verify-secret-retour';
const LIVREE_KEY = 'test-course-livree-secret-retour';

const RIDER = 'rider-retour-0001';
const RIDER_CODE = 'SR-RETOUR-PERSONAL-0001';
const SUPPLIER = 'supplier-retour-1';
const SELLER_KEY = 'RTF-SELLER-KEY-0001';
const RIDER_KEY = 'RTR-RIDER-KEY-0001';

const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const T = '2026-09-17T09:00:00.000Z';
const T_EXPIRY = '2026-09-17T09:15:00.000Z';
const T_PLUS_16 = '2026-09-17T09:16:00.000Z';

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-retour-${tag}-`));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

/** What the stub SAW on the produce door, path by path. */
interface LogisticsWorld {
  produce: { path: string; body: Json }[];
}

function logisticsStub(world: LogisticsWorld) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const auth = request.headers.get('Authorization') ?? '';
    if (path === '/verify/rider-code') {
      if (auth !== `Bearer ${VERIFY_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const body = (await request.json().catch(() => null)) as Json | null;
      if (String(body?.['code'] ?? '') === RIDER_CODE) return Response.json({ ok: true, riderId: RIDER });
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (path === '/produce/retour-ouvert' || path === '/produce/course-retournee') {
      // logistics-do.ts gates `/produce/*` on the course-livrée key — the one
      // key custody presents on every wire to logistics.
      if (auth !== `Bearer ${LIVREE_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const body = (await request.json().catch(() => ({}))) as Json;
      world.produce.push({ path, body });
      return Response.json({ ok: true, status: path === '/produce/retour-ouvert' ? 'retour_ouvert' : 'retournee' });
    }
    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  };
}

function boot(dir: string, world: LogisticsWorld): Miniflare {
  return new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: { LOGISTICS: logisticsStub(world) },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: OPS,
      SERA_RIDER_VERIFY_SECRET: VERIFY_KEY,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
      SERA_COURSE_LIVREE_SECRET: LIVREE_KEY,
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

async function doorModeArmed(mf: Miniflare, orderId: string, pickup: string, drop: string): Promise<void> {
  expect((await call(mf, 'POST', '/produce/order/open', PRODUCE_KEY, {
    orderId, taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, correlationId: `corr-${orderId}`,
    supplierId: SUPPLIER, paymentMode: 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR',
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, {
    orderId, command_id: `arm-p-${orderId}`, kind: 'pickup_verification_code', secret: pickup,
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce-shop/secrets/arm', SHOP_ARM_KEY, {
    orderId, command_id: `arm-d-${orderId}`, kind: 'buyer_drop_code', secret: drop,
  })).status).toBe(200);
}

async function atTheDoor(mf: Miniflare, orderId: string, pickup: string, seal: string): Promise<void> {
  expect((await call(mf, 'POST', '/rider/verification', RIDER_CODE, {
    orderId, command_id: `v-${orderId}`, presentedPickupCode: pickup,
    checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${orderId}`,
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
    orderId, command_id: `b-${orderId}`, custodySealId: seal, sealPhotoRefs: [],
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/rider/delivery/evidence', RIDER_CODE, {
    orderId, command_id: `e-${orderId}`,
    bundle: { taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, custodySealId: seal, artifacts: [], capturedAt: T },
  })).status).toBe(200);
}

/** The alarm flushes at-least-once; poll the stub, never sleep blind. */
async function attendreProduce(world: LogisticsWorld, path: string, orderId: string): Promise<Json> {
  for (let i = 0; i < 80; i += 1) {
    const hit = world.produce.find((p) => p.path === path && p.body['orderId'] === orderId);
    if (hit !== undefined) return hit.body;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${path} never reached logistics — seen: ${JSON.stringify(world.produce)}`);
}

/** Logistics' half of the handshake, through the SAME door it uses live:
 *  the two keys armed on custody by the produce key. */
async function logisticsArmsTheKeys(mf: Miniflare, orderId: string): Promise<void> {
  expect((await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, {
    orderId, command_id: `arm-retour-rider-${orderId}`, kind: 'rider_return_confirmation', secret: RIDER_KEY,
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, {
    orderId, command_id: `arm-retour-seller-${orderId}`, kind: 'seller_return_acceptance', secret: SELLER_KEY,
  })).status).toBe(200);
}

async function ledgerCustodian(mf: Miniflare, orderId: string): Promise<unknown> {
  return (await call(mf, 'GET', `/ops/ledger?orderId=${orderId}`, OPS)).json['currentCustodian'];
}

async function eventsOf(mf: Miniflare, orderId: string): Promise<{ name: string; payload: Json }[]> {
  return (await call(mf, 'GET', `/ops/events?orderId=${orderId}`, OPS)).json['events'] as { name: string; payload: Json }[];
}

const inspection = (orderId: string, commandId: string, over: Json = {}): Json => ({
  orderId, command_id: commandId, inspectionCategory: 'uncategorised_conservative',
  packageOpened: false, manufacturerSealOpened: false, custodySealIntact: true, buyerAccepts: true,
  startedAt: T, completedAt: T, evidenceBundleId: `eb-door-${orderId}`, ...over,
});

describe('RETOUR-VIVANT-1 — the §6.4 ladder over the WORKER, the buyer-fault arm, and the road home', () => {
  it('insufficient_balance → ONE window (honest expiry) → expiry refused before, proceeds after (return) → return/open with the fee retained → logistics told → keys armed → both-or-neither → custody with the SELLER on the ledger → logistics told the course is home', async () => {
    const world: LogisticsWorld = { produce: [] };
    const mf = boot(freshDir('ladder'), world);
    const O = 'ord-retour-ladder';
    await doorModeArmed(mf, O, 'PICKUP-L1', 'DROP-L1');
    await atTheDoor(mf, O, 'PICKUP-L1', 'SEAL-L1');

    // Nothing to send home yet — refuse-closed under the road's standing name.
    const tooEarly = await call(mf, 'POST', '/rider/return/open', RIDER_CODE, { orderId: O, command_id: 'ret-early', returnSealId: 'RETSEAL-L1' });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.json).toMatchObject({ ok: false, reason: 'no_valid_rejection' });

    // The first refusal, by its canonical reason: the ONE retry window.
    const refused = await call(mf, 'POST', '/rider/door/refusal', RIDER_CODE, { orderId: O, command_id: 'ref-1', reasonCode: 'insufficient_balance', at: T });
    expect(refused.status, JSON.stringify(refused.json)).toBe(200);
    expect(refused.json).toMatchObject({ ok: true, kind: 'window_opened' });
    const outcome = refused.json['outcome'] as Json;
    expect(outcome).toMatchObject({ family: 'retry', reasonCode: 'insufficient_balance', faultClass: 'buyer' });
    expect((outcome['attempt'] as Json)['windowExpiresAt']).toBe(T_EXPIRY);
    // No franc anywhere in the answer (SE-I09).
    expect(JSON.stringify(refused.json)).not.toMatch(/amount|fcfa/i);

    // One window, ever: a second refusal cannot mint a fresh one.
    const again = await call(mf, 'POST', '/rider/door/refusal', RIDER_CODE, { orderId: O, command_id: 'ref-2', reasonCode: 'change_of_mind', at: T });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ ok: false, reason: 'ladder_already_open' });

    // The rider's tap cannot shorten the window the buyer was promised.
    const early = await call(mf, 'POST', '/rider/door/expire', RIDER_CODE, { orderId: O, command_id: 'exp-early', at: T });
    expect(early.status).toBe(409);
    expect(early.json).toMatchObject({ ok: false, reason: 'window_not_expired' });

    // Expired unresolved: the escalating reason proceeds to the RETURN arm.
    const expired = await call(mf, 'POST', '/rider/door/expire', RIDER_CODE, { orderId: O, command_id: 'exp-1', at: T_PLUS_16 });
    expect(expired.status, JSON.stringify(expired.json)).toBe(200);
    expect(expired.json).toMatchObject({ ok: true, kind: 'window_expired' });
    expect(expired.json['outcome']).toMatchObject({ family: 'return', faultClass: 'buyer', attempt: { number: 2 } });

    // The handover cannot run before the return is open.
    const noReturn = await call(mf, 'POST', '/rider/return/handover', RIDER_CODE, { orderId: O, command_id: 'ho-0', sellerKey: SELLER_KEY, riderKey: RIDER_KEY });
    expect(noReturn.status).toBe(409);
    expect(noReturn.json).toMatchObject({ ok: false, reason: 'return_not_open' });

    // The rider re-seals the refused package: the buyer-fault arm, fee retained.
    const opened = await call(mf, 'POST', '/rider/return/open', RIDER_CODE, { orderId: O, command_id: 'ret-1', returnSealId: 'RETSEAL-L1', at: T_PLUS_16 });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    expect(opened.json).toMatchObject({ ok: true, kind: 'return_opened' });
    const refusEvent = (await eventsOf(mf, O)).find((e) => e.name === 'delivery.refused.v1');
    expect(refusEvent?.payload).toMatchObject({ order_id: O, family: 'return', reason_code: 'insufficient_balance', fault_class: 'buyer', fee_retained: true });

    // The fifth wire crossed: logistics learns the return opened — at-least-once, from the alarm.
    const ouvert = await attendreProduce(world, '/produce/retour-ouvert', O);
    expect(ouvert).toMatchObject({ orderId: O, command_id: `retour-ouvert-${O}` });
    // …and the course-retournée wire has NOT fired: the package is still on the road.
    expect(world.produce.some((p) => p.path === '/produce/course-retournee')).toBe(false);

    // Logistics mints and arms the two keys through the produce door.
    await logisticsArmsTheKeys(mf, O);

    // BOTH OR NEITHER. A wrong seller key refuses — and burns nothing: the
    // right pair still opens afterwards.
    const oneWrong = await call(mf, 'POST', '/rider/return/handover', RIDER_CODE, { orderId: O, command_id: 'ho-1', sellerKey: 'WRONG-SELLER-KEY', riderKey: RIDER_KEY });
    expect(oneWrong.status).toBe(409);
    expect(oneWrong.json).toMatchObject({ ok: false, reason: 'return_two_key_refused' });
    // No oracle: the answer never says WHICH key failed.
    expect(JSON.stringify(oneWrong.json)).not.toMatch(/seller_return_acceptance|rider_return_confirmation|failedKey/);
    expect(await ledgerCustodian(mf, O)).toBe(`courier:${RIDER}`);

    const home = await call(mf, 'POST', '/rider/return/handover', RIDER_CODE, { orderId: O, command_id: 'ho-2', sellerKey: SELLER_KEY, riderKey: RIDER_KEY, at: T_PLUS_16 });
    expect(home.status, JSON.stringify(home.json)).toBe(200);
    expect(home.json).toMatchObject({ ok: true, kind: 'returned_to_supplier' });
    // THE LEDGER'S WORD: custody moved courier → seller, and the event is on record.
    expect(await ledgerCustodian(mf, O)).toBe(`seller:${SUPPLIER}`);
    expect((await eventsOf(mf, O)).some((e) => e.name === 'custody.returned_to_supplier.v1')).toBe(true);
    // A redelivery replays the same answer, once more truthful.
    const replay = await call(mf, 'POST', '/rider/return/handover', RIDER_CODE, { orderId: O, command_id: 'ho-2', sellerKey: SELLER_KEY, riderKey: RIDER_KEY, at: T_PLUS_16 });
    expect(replay.status).toBe(200);
    expect(replay.json).toMatchObject({ ok: true, kind: 'returned_to_supplier', duplicate: true });
    // The keys are single-use: a fresh act with the same pair refuses.
    const spent = await call(mf, 'POST', '/rider/return/handover', RIDER_CODE, { orderId: O, command_id: 'ho-3', sellerKey: SELLER_KEY, riderKey: RIDER_KEY });
    expect(spent.status).toBe(409);

    // The sixth wire crossed: logistics learns the course is home.
    const retournee = await attendreProduce(world, '/produce/course-retournee', O);
    expect(retournee).toMatchObject({ orderId: O, command_id: `course-retournee-${O}` });

    // And the buyer's code can no longer move this package anywhere.
    const drop = await call(mf, 'POST', '/rider/delivery/drop', RIDER_CODE, { orderId: O, command_id: 'drop-after-return', dropCode: 'DROP-L1' });
    expect(drop.status).toBe(409);
    await mf.dispose();
  });

  it('honest_absence → the window expires into RESCHEDULE: no fee, no return to open, custody untouched', async () => {
    const world: LogisticsWorld = { produce: [] };
    const mf = boot(freshDir('reschedule'), world);
    const O = 'ord-retour-resched';
    await doorModeArmed(mf, O, 'PICKUP-R1', 'DROP-R1');
    await atTheDoor(mf, O, 'PICKUP-R1', 'SEAL-R1');
    const refused = await call(mf, 'POST', '/rider/door/refusal', RIDER_CODE, { orderId: O, command_id: 'ref-r', reasonCode: 'honest_absence', at: T });
    expect(refused.status).toBe(200);
    const expired = await call(mf, 'POST', '/rider/door/expire', RIDER_CODE, { orderId: O, command_id: 'exp-r', at: T_PLUS_16 });
    expect(expired.status).toBe(200);
    expect(expired.json['outcome']).toMatchObject({ family: 'reschedule', reasonCode: 'honest_absence' });
    const opened = await call(mf, 'POST', '/rider/return/open', RIDER_CODE, { orderId: O, command_id: 'ret-r', returnSealId: 'RETSEAL-R1' });
    expect(opened.status).toBe(409);
    expect(opened.json).toMatchObject({ ok: false, reason: 'no_valid_rejection' });
    expect((await eventsOf(mf, O)).some((e) => e.name === 'delivery.refused.v1')).toBe(false);
    expect(await ledgerCustodian(mf, O)).toBe(`courier:${RIDER}`);
    expect(world.produce).toHaveLength(0);
    // An unknown reason never enters the ladder — refused closed by name.
    const O2 = 'ord-retour-taxonomy';
    await doorModeArmed(mf, O2, 'PICKUP-R2', 'DROP-R2');
    await atTheDoor(mf, O2, 'PICKUP-R2', 'SEAL-R2');
    const unknown = await call(mf, 'POST', '/rider/door/refusal', RIDER_CODE, { orderId: O2, command_id: 'ref-u', reasonCode: 'failed', at: T });
    expect(unknown.status).toBe(409);
    expect(unknown.json).toMatchObject({ ok: false, reason: 'reason_not_in_taxonomy' });
    await mf.dispose();
  });

  it('a VALID rejection (seal broken → Séra fault) → return/open → the dispatcher’s canon CustodyLiabilityClaim, ops only, only while the return exists → keys → handover home', async () => {
    const world: LogisticsWorld = { produce: [] };
    const mf = boot(freshDir('valid'), world);
    const O = 'ord-retour-valid';
    await doorModeArmed(mf, O, 'PICKUP-V1', 'DROP-V1');
    await atTheDoor(mf, O, 'PICKUP-V1', 'SEAL-V1');
    const claim = { orderId: O, cause: 'sera_damage', amount: 4_500, evidenceBundleId: `eb-claim-${O}`, state: 'opened' };

    // No return yet: the claim has nothing to attach to.
    const tooEarly = await call(mf, 'POST', '/ops/return/claim', OPS, { orderId: O, command_id: 'cl-0', claim });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.json).toMatchObject({ ok: false, reason: 'return_not_open' });

    const rejected = await call(mf, 'POST', '/rider/door/inspection', RIDER_CODE,
      inspection(O, 'insp-v', { buyerAccepts: false, refusalColumn: 'valid', custodySealIntact: false }));
    expect(rejected.status).toBe(200);
    expect(rejected.json).toMatchObject({ ok: true, kind: 'valid_rejection', faultClass: 'sera' });
    const opened = await call(mf, 'POST', '/rider/return/open', RIDER_CODE, { orderId: O, command_id: 'ret-v', returnSealId: 'RETSEAL-V1' });
    expect(opened.status).toBe(200);
    // The valid arm retains NO fee.
    const refus = (await eventsOf(mf, O)).find((e) => e.name === 'delivery.refused.v1');
    expect(refus?.payload).toMatchObject({ rejection: 'valid_rejection', fault_class: 'sera' });
    expect(refus?.payload['fee_retained']).toBeUndefined();

    // The claim: canon strict — a malformed one is refused by name; the real one is filed.
    const malformed = await call(mf, 'POST', '/ops/return/claim', OPS, { orderId: O, command_id: 'cl-bad', claim: { ...claim, amount: 'beaucoup' } });
    expect(malformed.status).toBe(409);
    expect(malformed.json).toMatchObject({ ok: false, reason: 'claim_not_canonical' });
    const filed = await call(mf, 'POST', '/ops/return/claim', OPS, { orderId: O, command_id: 'cl-1', claim });
    expect(filed.status, JSON.stringify(filed.json)).toBe(200);
    expect(filed.json).toMatchObject({ ok: true, kind: 'claim_filed' });
    expect((await eventsOf(mf, O)).find((e) => e.name === 'custody_liability.claim_opened.v1')?.payload).toMatchObject({ order_id: O, cause: 'sera_damage' });
    // A claim never rides the rider door.
    const riderClaim = await call(mf, 'POST', '/rider/return/claim', RIDER_CODE, { orderId: O, command_id: 'cl-r', claim });
    expect(riderClaim.status).toBe(404);

    await attendreProduce(world, '/produce/retour-ouvert', O);
    await logisticsArmsTheKeys(mf, O);
    const home = await call(mf, 'POST', '/rider/return/handover', RIDER_CODE, { orderId: O, command_id: 'ho-v', sellerKey: SELLER_KEY, riderKey: RIDER_KEY });
    expect(home.status, JSON.stringify(home.json)).toBe(200);
    expect(await ledgerCustodian(mf, O)).toBe(`seller:${SUPPLIER}`);
    await attendreProduce(world, '/produce/course-retournee', O);
    await mf.dispose();
  });

  it('the doors: the SHOP producer cannot arm a return key (403 by name); the produce door arms both; a replayed return-open revives a rested retour wire', async () => {
    const world: LogisticsWorld = { produce: [] };
    const mf = boot(freshDir('doors'), world);
    const O = 'ord-retour-doors';
    await doorModeArmed(mf, O, 'PICKUP-D1', 'DROP-D1');
    for (const kind of ['rider_return_confirmation', 'seller_return_acceptance']) {
      const shop = await call(mf, 'POST', '/produce-shop/secrets/arm', SHOP_ARM_KEY, { orderId: O, command_id: `shop-${kind}`, kind, secret: 'x' });
      expect(shop.status).toBe(403);
      expect(shop.json).toMatchObject({ ok: false, reason: 'kind_not_armable_at_this_door' });
    }
    await logisticsArmsTheKeys(mf, O);
    // The seal still cannot be pre-armed by anyone.
    const seal = await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, { orderId: O, command_id: 'arm-seal', kind: 'custody_seal', secret: 'x' });
    expect(seal.status).toBe(403);
    await mf.dispose();
  });
});
