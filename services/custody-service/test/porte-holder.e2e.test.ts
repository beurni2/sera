import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';
import { httpCustodyActs, type CustodyAnswer } from '../../../apps/rider-app/src/net/custody-acts';

/**
 * ═══ ONLY THE PARCEL'S HOLDER ACTS AT THE DOOR, AND EVERY DOOR ACT NAMES ITS
 * RIDER ═══
 *
 * SE-I05: « Delivery requires assigned session + buyerDropCode + same custody
 * seal + evidence ». The road's own law (custody-do.ts, VRAI-ROUTE): through
 * the rider door, the acting hand must be the ledger's custodian. This file
 * proves it for every door act after the seal, on the REAL bundled custody
 * Worker, driven by the rider app's OWN custody port (`httpCustodyActs`).
 *
 * The logistics stub is certified as `vrai-route.e2e.test.ts` certifies it:
 * the rider code check answers `{ok:true, riderId}` for exactly two codes and
 * 401 otherwise, behind the verify key; its produce door takes custody's
 * course-livrée key, as logistics-do.ts gates it. The Shop+ stub takes the
 * progress key. Both RECORD what they saw, so « nothing crossed » is asked of
 * the receivers, and custody's outcome is asked of the LEDGER.
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-ops-secret-holder-0001';
const PRODUCE_KEY = 'test-produce-secret-holder-0001';
const SHOP_ARM_KEY = 'test-shop-arm-secret-holder-0001';
const SHOP_WIRE_KEY = 'test-progress-secret-holder-01';
const VERIFY_KEY = 'test-rider-verify-secret-holder';
const LIVREE_KEY = 'test-course-livree-secret-holder';
const TIMEOUT = 60_000;

const R1 = 'rider-holder-0001';
const R1_CODE = 'SR-HOLDER-PERSONAL-0001';
/** A second valid rider, never any of these orders' custodian. */
const R2 = 'rider-holder-0002';
const R2_CODE = 'SR-HOLDER-PERSONAL-0002';
const SUPPLIER = 'supplier-holder-1';
const SELLER_KEY = 'HLD-SELLER-KEY-0001';
const RIDER_KEY = 'HLD-RIDER-KEY-0001';
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const T = '2026-11-26T09:00:00.000Z';

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-holder-${tag}-`));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Json = Record<string, unknown>;
interface Seen {
  shop: { path: string; body: Json }[];
  logistics: { path: string; body: Json }[];
}

function shopStub(seen: Seen) {
  return async (request: Request): Promise<Response> => {
    if (request.headers.get('Authorization') !== `Bearer ${SHOP_WIRE_KEY}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const path = new URL(request.url).pathname;
    seen.shop.push({ path, body: (await request.json().catch(() => ({}))) as Json });
    return Response.json({ ok: true, status: 'recorded' });
  };
}

function logisticsStub(seen: Seen) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const auth = request.headers.get('Authorization') ?? '';
    if (path === '/verify/rider-code') {
      if (auth !== `Bearer ${VERIFY_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const code = String(((await request.json().catch(() => null)) as Json | null)?.['code'] ?? '');
      if (code === R1_CODE) return Response.json({ ok: true, riderId: R1 });
      if (code === R2_CODE) return Response.json({ ok: true, riderId: R2 });
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (path.startsWith('/produce/')) {
      if (auth !== `Bearer ${LIVREE_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
      seen.logistics.push({ path, body: (await request.json().catch(() => ({}))) as Json });
      return Response.json({ ok: true, status: 'recorded' });
    }
    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  };
}

function boot(dir: string, seen: Seen): Miniflare {
  return new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: { LOGISTICS: logisticsStub(seen), SHOP_PROGRESS: shopStub(seen) },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: OPS,
      SERA_RIDER_VERIFY_SECRET: VERIFY_KEY,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
      SHOP_PROGRESS_SECRET: SHOP_WIRE_KEY,
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

/** The rider app's own port, pointed at the real Worker. */
function appPort(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as unknown as typeof globalThis.fetch;
  return httpCustodyActs('http://custody', { current: () => 'online' as const }, fetchFn as never);
}
const id = (s: string) => s as never;

async function opened(mf: Miniflare, orderId: string, mode: 'FULL_PREPAY' | 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR', pickup: string, drop: string): Promise<void> {
  expect((await call(mf, 'POST', '/produce/order/open', PRODUCE_KEY, {
    orderId, taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, correlationId: `corr-${orderId}`,
    supplierId: SUPPLIER, paymentMode: mode,
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, {
    orderId, command_id: `arm-p-${orderId}`, kind: 'pickup_verification_code', secret: pickup,
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce-shop/secrets/arm', SHOP_ARM_KEY, {
    orderId, command_id: `arm-d-${orderId}`, kind: 'buyer_drop_code', secret: drop,
  })).status).toBe(200);
}

/** R1 verifies, seals and photographs the handoff moment — through the app's port. */
async function r1HoldsIt(mf: Miniflare, orderId: string, pickup: string, seal: string): Promise<void> {
  const acts = appPort(mf);
  const v = await acts.verifyPickup({
    commandId: id(`v-${orderId}`), orderId, presentedPickupCode: pickup,
    evidenceBundleId: `ev-${orderId}`, dwellSec: 150, checkResults: ALL_PASS,
  }, R1_CODE);
  expect(v.kind, JSON.stringify(v)).toBe('recorded');
  const b = await acts.beginCustody({ commandId: id(`b-${orderId}`), orderId, custodySealId: seal, sealPhotoRefs: [] }, R1_CODE);
  expect(b.kind, JSON.stringify(b)).toBe('recorded');
  expect(await custodian(mf, orderId)).toBe(`courier:${R1}`);
}

const evidenceAct = (orderId: string, commandId: string, seal: string) => ({
  commandId: id(commandId), orderId, custodySealId: seal,
  taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, artifacts: [], capturedAt: T,
});
const inspectionAct = (orderId: string, commandId: string) => ({
  commandId: id(commandId), orderId, inspectionCategory: 'uncategorised_conservative',
  packageOpened: false, manufacturerSealOpened: false, custodySealIntact: true,
  buyerAccepts: false, refusalColumn: 'valid' as const,
  startedAt: T, completedAt: T, evidenceBundleId: `eb-door-${orderId}`,
});

async function custodian(mf: Miniflare, orderId: string): Promise<unknown> {
  return (await call(mf, 'GET', `/ops/ledger?orderId=${orderId}`, OPS)).json['currentCustodian'];
}

/** Everything a refused act could have touched: the ledger, the events, the
 *  head, the attestations, and what each receiver has seen. */
async function snapshot(mf: Miniflare, orderId: string, seen: Seen): Promise<string> {
  const ledger = (await call(mf, 'GET', `/ops/ledger?orderId=${orderId}`, OPS)).json;
  const events = (await call(mf, 'GET', `/ops/events?orderId=${orderId}`, OPS)).json;
  const head = (await call(mf, 'GET', `/ops/ledger/verify?orderId=${orderId}`, OPS)).json;
  const att = (await call(mf, 'GET', `/ops/attestations?orderId=${orderId}`, OPS)).json;
  return JSON.stringify({ ledger, events, head, att, shop: seen.shop, logistics: seen.logistics });
}

/** The wires flush at-least-once on an alarm: wait until both receivers have
 *  been quiet for a full second before taking a « before » picture. */
async function settled(seen: Seen): Promise<void> {
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    const n = seen.shop.length + seen.logistics.length;
    if (n === last) return;
    last = n;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error('the wires never settled');
}

function refusedNotTheCustodian(answer: CustodyAnswer, what: string): void {
  expect(answer, what).toEqual({ kind: 'refused', reason: 'not_the_custodian' });
}

async function attendre(seen: Seen, path: string, orderId: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    if (seen.logistics.some((p) => p.path === path && p.body['orderId'] === orderId)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${path} never reached logistics`);
}

type DoorActRow = { kind: string; command_id: string; riderId: string | null; attribution: string; outcome: unknown; recorded: boolean };
async function doorActs(mf: Miniflare, orderId: string): Promise<{ raw: string; rows: DoorActRow[] }> {
  const res = await call(mf, 'GET', `/ops/attestations?orderId=${orderId}`, OPS);
  return { raw: JSON.stringify(res.json), rows: (res.json['doorActs'] ?? []) as DoorActRow[] };
}

describe('only the parcel\'s holder acts at the door; every door act names its rider', () => {
  it('another rider\'s evidence and drop (right code) are refused by name, nothing is written or sent; the holder delivers, replays, re-types; the drop row names him', async () => {
    const seen: Seen = { shop: [], logistics: [] };
    const mf = boot(freshDir('drop'), seen);
    const acts = appPort(mf);
    const A = 'ord-holder-drop';
    const SEAL = 'SEAL-HOLDER-A';
    const DROP = 'DROP-HOLDER-A1';
    await opened(mf, A, 'FULL_PREPAY', 'PICKUP-HOLDER-A', DROP);
    await r1HoldsIt(mf, A, 'PICKUP-HOLDER-A', SEAL);
    await settled(seen);

    // ── R2, never this order's hand: evidence, then the RIGHT buyer code ──
    let before = await snapshot(mf, A, seen);
    refusedNotTheCustodian(await acts.submitDeliveryEvidence(evidenceAct(A, 'r2-e', SEAL), R2_CODE), 'R2 evidence');
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await snapshot(mf, A, seen), 'R2 evidence changed nothing').toBe(before);

    const r1Evidence = await acts.submitDeliveryEvidence(evidenceAct(A, 'r1-e', SEAL), R1_CODE);
    expect(r1Evidence, JSON.stringify(r1Evidence)).toMatchObject({ kind: 'recorded' });
    await settled(seen);

    before = await snapshot(mf, A, seen);
    refusedNotTheCustodian(await acts.confirmDrop({ commandId: id('r2-d'), orderId: A, dropCode: DROP }, R2_CODE), 'R2 drop with the right code');
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await snapshot(mf, A, seen), 'R2 drop changed nothing').toBe(before);
    expect(await custodian(mf, A)).toBe(`courier:${R1}`);

    // ── R1, the holder: the drop goes through, and the LEDGER says so ──
    const drop = await acts.confirmDrop({ commandId: id('r1-d'), orderId: A, dropCode: DROP }, R1_CODE);
    expect(drop, JSON.stringify(drop)).toMatchObject({ kind: 'recorded', duplicate: false, body: { status: 'custody_with_customer' } });
    expect(await custodian(mf, A)).toBe('customer');
    const replay = await acts.confirmDrop({ commandId: id('r1-d'), orderId: A, dropCode: DROP }, R1_CODE);
    expect(replay).toMatchObject({ kind: 'recorded', duplicate: true, body: { status: 'custody_with_customer' } });
    // The holder's re-typed code under a fresh id still answers by state.
    const retype = await acts.confirmDrop({ commandId: id('r1-d-again'), orderId: A, dropCode: DROP }, R1_CODE);
    expect(retype).toMatchObject({ kind: 'recorded', body: { status: 'deja_livree' } });
    await settled(seen);

    // ── after custody left the road, R2 still learns nothing ──
    before = await snapshot(mf, A, seen);
    refusedNotTheCustodian(await acts.confirmDrop({ commandId: id('r2-d-after'), orderId: A, dropCode: DROP }, R2_CODE), 'R2 fresh drop after delivery');
    refusedNotTheCustodian(await acts.confirmDrop({ commandId: id('r1-d'), orderId: A, dropCode: DROP }, R2_CODE), 'R2 sending R1\'s command id');
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await snapshot(mf, A, seen), 'R2 after delivery changed nothing').toBe(before);

    // ── the record names who stood there, and carries no secret ──
    const { raw, rows } = await doorActs(mf, A);
    expect(rows.map((r) => [r.kind, r.command_id, r.riderId, r.attribution, r.recorded])).toEqual([
      ['delivery_evidence', 'r1-e', R1, 'rider_authenticated', true],
      ['confirm_drop', 'r1-d', R1, 'rider_authenticated', true],
      ['confirm_drop', 'r1-d-again', R1, 'rider_authenticated', true],
    ]);
    expect(rows.every((r) => r.riderId !== R2)).toBe(true);
    for (const secret of [DROP, SEAL]) {
      expect(raw.includes(secret), `attestations carry ${secret}`).toBe(false);
      expect(raw.includes(createHash('sha256').update(secret, 'utf8').digest('hex')), `attestations carry the digest of ${secret}`).toBe(false);
    }
    expect((await call(mf, 'GET', `/ops/ledger/verify?orderId=${A}`, OPS)).json).toMatchObject({ valid: true, headMatches: true });
    await mf.dispose();
  }, TIMEOUT);

  it('another rider\'s inspection, refusal, expiry, return-open and handover are each refused by name with nothing written or sent; the holder\'s refusal road takes the parcel home and names him', async () => {
    const seen: Seen = { shop: [], logistics: [] };
    const mf = boot(freshDir('door'), seen);
    const acts = appPort(mf);
    const B = 'ord-holder-door';
    const SEAL = 'SEAL-HOLDER-B';
    await opened(mf, B, 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR', 'PICKUP-HOLDER-B', 'DROP-HOLDER-B1');
    await r1HoldsIt(mf, B, 'PICKUP-HOLDER-B', SEAL);
    expect(await acts.submitDeliveryEvidence(evidenceAct(B, 'r1-e', SEAL), R1_CODE)).toMatchObject({ kind: 'recorded' });
    await settled(seen);

    const foreign: [string, () => Promise<CustodyAnswer>][] = [
      ['inspection', () => acts.recordDoorInspection(inspectionAct(B, 'r2-i'), R2_CODE)],
      ['refusal', () => acts.refuseAtDoor({ commandId: id('r2-r'), orderId: B, reasonCode: 'insufficient_balance' }, R2_CODE)],
      ['expire', () => acts.expireWindow(R2_CODE, B, id('r2-x'))],
      ['return open', () => acts.openReturn({ commandId: id('r2-o'), orderId: B, returnSealId: 'RETSEAL-R2' }, R2_CODE)],
      ['handover', () => acts.completeReturn({ commandId: id('r2-h'), orderId: B, sellerKey: SELLER_KEY, riderKey: RIDER_KEY }, R2_CODE)],
    ];
    for (const [what, act] of foreign) {
      const before = await snapshot(mf, B, seen);
      refusedNotTheCustodian(await act(), `R2 ${what}`);
      await new Promise((r) => setTimeout(r, 1_500));
      expect(await snapshot(mf, B, seen), `R2 ${what} changed nothing`).toBe(before);
    }
    expect(await custodian(mf, B)).toBe(`courier:${R1}`);

    // ── R1's own refusal road ──
    expect(await acts.recordDoorInspection(inspectionAct(B, 'r1-i'), R1_CODE)).toMatchObject({ kind: 'recorded', body: { kind: 'valid_rejection', faultClass: 'seller' } });
    expect(await acts.openReturn({ commandId: id('r1-o'), orderId: B, returnSealId: 'RETSEAL-R1' }, R1_CODE)).toMatchObject({ kind: 'recorded', body: { kind: 'return_opened' } });
    await attendre(seen, '/produce/retour-ouvert', B);
    for (const [kind, secret] of [['rider_return_confirmation', RIDER_KEY], ['seller_return_acceptance', SELLER_KEY]] as const) {
      expect((await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, { orderId: B, command_id: `arm-${kind}`, kind, secret })).status).toBe(200);
    }
    const home = await acts.completeReturn({ commandId: id('r1-h'), orderId: B, sellerKey: SELLER_KEY, riderKey: RIDER_KEY }, R1_CODE);
    expect(home, JSON.stringify(home)).toMatchObject({ kind: 'recorded', body: { kind: 'returned_to_supplier' } });
    expect(await custodian(mf, B)).toBe(`seller:${SUPPLIER}`);
    await attendre(seen, '/produce/course-retournee', B);
    await settled(seen);

    // ── after the handover: R2 is still not the hand; R1 gets the spine's own answer ──
    const before = await snapshot(mf, B, seen);
    refusedNotTheCustodian(await acts.refuseAtDoor({ commandId: id('r2-r-after'), orderId: B, reasonCode: 'insufficient_balance' }, R2_CODE), 'R2 after the handover');
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await snapshot(mf, B, seen), 'R2 after the handover changed nothing').toBe(before);
    expect(await acts.refuseAtDoor({ commandId: id('r1-r-after'), orderId: B, reasonCode: 'insufficient_balance' }, R1_CODE))
      .toEqual({ kind: 'refused', reason: 'refusal_before_custody' });

    const { raw, rows } = await doorActs(mf, B);
    expect(rows.map((r) => [r.kind, r.command_id, r.riderId, r.recorded])).toEqual([
      ['delivery_evidence', 'r1-e', R1, true],
      ['door_inspection', 'r1-i', R1, true],
      ['open_return', 'r1-o', R1, true],
      ['return_handover', 'r1-h', R1, true],
      ['door_refusal', 'r1-r-after', R1, false],
    ]);
    for (const secret of [SEAL, 'RETSEAL-R1', SELLER_KEY, RIDER_KEY, 'DROP-HOLDER-B1']) {
      expect(raw.includes(secret), `attestations carry ${secret}`).toBe(false);
      expect(raw.includes(createHash('sha256').update(secret, 'utf8').digest('hex')), `attestations carry the digest of ${secret}`).toBe(false);
    }
    await mf.dispose();
  }, TIMEOUT);

  it('the holder\'s ladder rungs (refusal, expiry) each name him', async () => {
    const seen: Seen = { shop: [], logistics: [] };
    const mf = boot(freshDir('ladder'), seen);
    const acts = appPort(mf);
    const C = 'ord-holder-ladder';
    await opened(mf, C, 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR', 'PICKUP-HOLDER-C', 'DROP-HOLDER-C1');
    await r1HoldsIt(mf, C, 'PICKUP-HOLDER-C', 'SEAL-HOLDER-C');
    expect(await acts.refuseAtDoor({ commandId: id('r1-r'), orderId: C, reasonCode: 'insufficient_balance' }, R1_CODE))
      .toMatchObject({ kind: 'recorded', body: { kind: 'window_opened' } });
    // Custody's own clock: the window has not run out, and the spine says so.
    expect(await acts.expireWindow(R1_CODE, C, id('r1-x'))).toEqual({ kind: 'refused', reason: 'window_not_expired' });
    const { rows } = await doorActs(mf, C);
    expect(rows.map((r) => [r.kind, r.command_id, r.riderId, r.attribution, r.recorded])).toEqual([
      ['door_refusal', 'r1-r', R1, 'rider_authenticated', true],
      ['door_expire', 'r1-x', R1, 'rider_authenticated', false],
    ]);
    await mf.dispose();
  }, TIMEOUT);

  it('the founder\'s ops door, with no rider header, still delivers; its rows say founder-attested', async () => {
    const seen: Seen = { shop: [], logistics: [] };
    const mf = boot(freshDir('ops'), seen);
    const D = 'ord-holder-ops';
    await opened(mf, D, 'FULL_PREPAY', 'PICKUP-HOLDER-D', 'DROP-HOLDER-D1');
    expect((await call(mf, 'POST', '/ops/verification', OPS, {
      orderId: D, command_id: 'o-v', riderId: R1, presentedPickupCode: 'PICKUP-HOLDER-D',
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-o', at: T,
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/custody/begin', OPS, {
      orderId: D, command_id: 'o-b', riderId: R1, custodySealId: 'SEAL-HOLDER-D', sealPhotoRefs: [], at: T,
    })).status).toBe(200);
    const ev = await call(mf, 'POST', '/ops/delivery/evidence', OPS, {
      orderId: D, command_id: 'o-e', at: T,
      bundle: { taskId: `task-${D}`, packageId: `pkg-${D}`, custodySealId: 'SEAL-HOLDER-D', artifacts: [], capturedAt: T },
    });
    expect(ev.status, JSON.stringify(ev.json)).toBe(200);
    const drop = await call(mf, 'POST', '/ops/delivery/drop', OPS, { orderId: D, command_id: 'o-d', dropCode: 'DROP-HOLDER-D1', at: T });
    expect(drop.status, JSON.stringify(drop.json)).toBe(200);
    expect(drop.json).toMatchObject({ ok: true, status: 'custody_with_customer' });
    expect(await custodian(mf, D)).toBe('customer');
    const { rows } = await doorActs(mf, D);
    expect(rows.map((r) => [r.kind, r.command_id, r.riderId, r.attribution, r.recorded])).toEqual([
      ['delivery_evidence', 'o-e', null, 'founder_attested', true],
      ['confirm_drop', 'o-d', null, 'founder_attested', true],
    ]);
    await mf.dispose();
  }, TIMEOUT);
});
