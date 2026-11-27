import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { PackageLostEventSchema } from '@platform/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';

/**
 * ═══ A PARCEL LOST ON THE ROAD — REAL AGAINST REAL ═══
 *
 * Founder ruling 2026-11-27 (« Yes, on my Boutik+ console »), Sera-Build-Spec
 * §6.5: only the founder declares it, only while a courier holds the parcel,
 * final, for every order the parcel carries. Two Miniflares run the shipped
 * bundles; the rider app's own ports make the rider's gestures:
 *
 *   founder ──POST /ops/colis/perdu──▶ logistics ──/produce/custodian, /produce/colis/perdu (every article)──▶ custody
 *   custody ──package.lost.v1 (one per order, alarm, at-least-once)──▶ Shop+ stand-in
 *
 * Asked of custody's LEDGER, its claims, logistics' board and the rider's
 * session — never of an answer alone.
 *
 * THE SHOP+ STAND-IN'S BOUNDS (it must never be kinder than Shop+'s real
 * `/fulfillment/progress`, services/storefront-service/worker/index.ts in
 * shop-plus): an unknown key is the one 401 before any parse; a body that is
 * not a canon `package.lost.v1` (PackageLostEventSchema, strict on the whole
 * event) is a 400 `event_not_canonical`; Boutik+'s key on a delivery mark is
 * a 403 `wrong_writer`; an order it does not know is a 404. It can be made to
 * answer 503 for its first N calls. It records EVERY call it receives. It
 * claims nothing about what Shop+ does next (the refund is Shop+'s).
 */

const OPS = 'test-ops-perdu';
const INTAKE = 'test-intake-perdu';
const VERIFY = 'test-verify-perdu';
const CUSTODY_OPS = 'test-custody-ops-perdu';
const PRODUCE_KEY = 'test-produce-key-perdu';
const SHOP_ARM_KEY = 'test-shop-arm-key-perdu';
const LIVREE_KEY = 'test-course-livree-key-perdu';
const SERA_PROGRESS = 'test-sera-progress-perdu';
const BOUTIK_PROGRESS = 'test-boutik-progress-perdu';
const SUPPLIER = 'supplier-perdu-1';

const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

type Json = Record<string, unknown>;

interface ShopDoor {
  known: Set<string>;
  outages: number;
  calls: { status: number; body: unknown }[];
  accepted: Json[];
}

function shopDoor(known: string[]): ShopDoor {
  return { known: new Set(known), outages: 0, calls: [], accepted: [] };
}

async function shopStandIn(door: ShopDoor, request: Request): Promise<Response> {
  const answer = (status: number, body: Json, raw: unknown): Response => {
    door.calls.push({ status, body: raw });
    return Response.json(body, { status });
  };
  const url = new URL(request.url);
  const raw: unknown = await request.clone().json().catch(() => null);
  if (url.pathname !== '/fulfillment/progress' || request.method !== 'POST') return answer(404, { ok: false, reason: 'not_found' }, raw);
  const auth = request.headers.get('Authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (key !== SERA_PROGRESS && key !== BOUTIK_PROGRESS) return answer(401, { error: 'unauthorized' }, raw);
  if (door.outages > 0) {
    door.outages -= 1;
    return answer(503, { ok: false, reason: 'unavailable' }, raw);
  }
  const parsed = PackageLostEventSchema.safeParse(raw);
  if (!parsed.success) return answer(400, { ok: false, reason: 'event_not_canonical' }, raw);
  if (key === BOUTIK_PROGRESS) return answer(403, { ok: false, reason: 'wrong_writer' }, raw);
  if (!door.known.has(parsed.data.payload.orderId)) return answer(404, { ok: false, reason: 'unknown_order' }, raw);
  door.accepted.push(parsed.data as unknown as Json);
  return answer(200, { ok: true }, raw);
}

interface Hold {
  custody?: Miniflare;
  logistics?: Miniflare;
  shop: ShopDoor;
  /** Test-code binding: this article's first lost relay answers 503, once. */
  failRelayOnceFor?: string;
  /** Every lost relay logistics sent, by article. */
  relays: string[];
}

function custodyOptions(hold: Hold, persist: string, withShopKey: boolean) {
  return {
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: persist,
    serviceBindings: {
      LOGISTICS: (request: Request) => hold.logistics!.dispatchFetch(request.url, request as never) as never,
      SHOP_PROGRESS: ((request: Request) => shopStandIn(hold.shop, request)) as never,
    },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: CUSTODY_OPS,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_COURSE_LIVREE_SECRET: LIVREE_KEY,
      ...(withShopKey ? { SHOP_PROGRESS_SECRET: SERA_PROGRESS } : {}),
    },
  };
}

function spawnCustody(hold: Hold, persist = mkdtempSync(join(tmpdir(), 'perdu-custody-')), withShopKey = true): Miniflare {
  const mf = new Miniflare(custodyOptions(hold, persist, withShopKey) as never);
  live.push(mf);
  hold.custody = mf;
  return mf;
}

function spawnLogistics(hold: Hold): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'perdu-logistics-')),
    serviceBindings: {
      CUSTODY: (async (request: Request) => {
        if (new URL(request.url).pathname === '/produce/colis/perdu') {
          const body = (await request.clone().json().catch(() => null)) as Json | null;
          const id = String(body?.['orderId']);
          hold.relays.push(id);
          if (hold.failRelayOnceFor === id) {
            hold.failRelayOnceFor = undefined;
            return Response.json({ ok: false, reason: 'unavailable' }, { status: 503 });
          }
        }
        return hold.custody!.dispatchFetch(request.url, request as never);
      }) as never,
    },
    bindings: {
      SERA_OPS_SECRET: OPS,
      SERA_INTAKE_SECRET: INTAKE,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SERA_COURSE_LIVREE_SECRET: LIVREE_KEY,
    },
  });
  live.push(mf);
  hold.logistics = mf;
  return mf;
}

function both(known: string[], opts: { withShopKey?: boolean } = {}) {
  const hold: Hold = { shop: shopDoor(known), relays: [] };
  const persist = mkdtempSync(join(tmpdir(), 'perdu-custody-'));
  spawnLogistics(hold);
  spawnCustody(hold, persist, opts.withShopKey ?? true);
  return { logistics: hold.logistics!, custody: hold.custody!, shop: hold.shop, hold, persist };
}

async function ops(mf: Miniflare, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function custodyOps(mf: Miniflare, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody/ops${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${CUSTODY_OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function intake(mf: Miniflare, path: string, body: unknown): Promise<void> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
  await res.text();
}

async function riderCustody(mf: Miniflare, path: string, code: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return { acts: httpShiftActs('http://logistics', net, fetchFn), session: httpRiderSession('http://logistics', net, fetchFn) };
}

async function attendre<T>(lire: () => Promise<T>, fini: (v: T) => boolean, pourquoi: string, maxMs = 30_000): Promise<T> {
  let v: T = await lire();
  for (let i = 0; i < maxMs / 250 && !fini(v); i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    v = await lire();
  }
  if (!fini(v)) throw new Error(`${pourquoi} — last: ${JSON.stringify(v)}`);
  return v;
}

async function custodian(custody: Miniflare, orderId: string): Promise<unknown> {
  return (await custodyOps(custody, `/ledger?orderId=${orderId}`)).json['currentCustodian'];
}

async function claims(custody: Miniflare, orderId: string): Promise<unknown> {
  return (await custodyOps(custody, `/liability-claims?orderId=${orderId}`)).json['claims'];
}

async function moi(mf: Miniflare, code: string): Promise<Json | null> {
  const res = await mf.dispatchFetch('http://logistics/rider/moi', { headers: { Authorization: `Bearer ${code}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { rider: Json }).rider['assignment'] as Json | null;
}

const T = '2026-11-27T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-11-27T16:00:00.000Z' };
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

/** One package course of the given articles, accepted by its rider, the supplier's code confirmed. */
async function colisConfie(logistics: Miniflare, orderIds: string[], riderId: string, prefix: string, rider?: { code: string }) {
  const COLIS = { packageId: `col-${prefix}`, orderIds };
  for (const o of orderIds) {
    await intake(logistics, '/intake/funding', { orderId: o, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T, ...(orderIds.length > 1 ? { package: COLIS } : {}) });
    await intake(logistics, '/intake/readiness', { orderId: o, ready: true, asOf: T, supplierRef: SUPPLIER });
  }
  const composed = await ops(logistics, '/ops/task', {
    command_id: `${prefix}-t`, orderId: orderIds[0], location: LOC, window: WIN,
    articles: orderIds.map((o, i) => ({ orderId: o, libelle: `Article ${i + 1}` })),
  });
  expect(composed.status, JSON.stringify(composed.json)).toBe(200);
  let code = rider?.code;
  const { acts } = appPorts(logistics);
  if (code === undefined) {
    await ops(logistics, '/ops/riders', { riderId, displayName: `Boss ${prefix}`, phoneAlias: prefix });
    await ops(logistics, '/ops/riders/certify', { riderId, certified: true });
    code = (await ops(logistics, '/ops/rider-code/mint', { riderId })).json['code'] as string;
    await acts.ackPrivacy(code);
    expect((await acts.startShift(code)).ok).toBe(true);
  }
  const granted = await ops(logistics, '/ops/assign', { command_id: `${prefix}-a`, taskId: composed.json['taskId'], riderId });
  expect(granted.json['ok'], JSON.stringify(granted.json)).toBe(true);
  const assignmentId = (granted.json['assignment'] as Json)['assignmentId'] as string;
  expect((await acts.accepterCourse(code, assignmentId)).ok).toBe(true);
  const lu = await appPorts(logistics).session.signIn(code);
  if (!lu.ok) throw new Error('sign-in refused');
  await intake(logistics, '/intake/ramassage/verify', { command_id: `${prefix}-ram`, orderId: orderIds[0], code: lu.session.assignment?.codeRamassage });
  return { code, assignmentId };
}

/** Verified at the stall, then (unless told otherwise) sealed: the courier holds it. */
async function prisEnCharge(custody: Miniflare, logistics: Miniflare, orderIds: string[], code: string, opts: { seal: boolean } = { seal: true }) {
  for (const o of orderIds) {
    await attendre(async () => (await custodyOps(custody, `/ledger?orderId=${o}`)).status, (s) => s === 200, `chain ${o}`);
  }
  const signed = await appPorts(logistics).session.signIn(code);
  if (!signed.ok) throw new Error('sign-in refused');
  const a = signed.session.assignment!;
  const chains: Record<string, Json> = {};
  for (const o of orderIds) {
    const v = await riderCustody(custody, '/rider/verification', code, { orderId: o, command_id: `v-${o}`, presentedPickupCode: a.codeVerification, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${o}` });
    expect(v.json, JSON.stringify(v.json)).toMatchObject({ ok: true, kind: 'accepted' });
    if (!opts.seal) continue;
    const b = await riderCustody(custody, '/rider/custody/begin', code, { orderId: o, command_id: `b-${o}`, custodySealId: a.codeScelle, sealPhotoRefs: [] });
    expect(b.status, JSON.stringify(b.json)).toBe(200);
    chains[o] = b.json['chain'] as Json;
  }
  return { codeScelle: a.codeScelle as string, chains };
}

const perdu = (logistics: Miniflare, body: unknown) => ops(logistics, '/ops/colis/perdu', body);

describe('the Shop+ stand-in is certified to Shop+\'s real progress door', () => {
  it('a canon package.lost.v1 with Séra\'s key → 200; Boutik+\'s key → 403; one extra field → 400; an unknown order → 404; an unknown key → 401', async () => {
    const door = shopDoor(['ord-known']);
    const good = PackageLostEventSchema.parse({
      name: 'package.lost.v1',
      envelope: { command_id: 'c-1', correlation_id: 'k-1', aggregateVersion: 1, actor: 'custody-service:e1', serverTime: T, version: '1' },
      payload: { orderId: 'ord-known', at: T },
    });
    const send = (key: string, body: unknown) => shopStandIn(door, new Request('https://shop/fulfillment/progress', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    expect((await send(SERA_PROGRESS, good)).status).toBe(200);
    expect((await send(BOUTIK_PROGRESS, good)).status).toBe(403);
    expect((await send(SERA_PROGRESS, { ...good, payload: { ...good.payload, amount: 1 } })).status).toBe(400);
    expect((await send(SERA_PROGRESS, { ...good, extra: true })).status).toBe(400);
    expect((await send(SERA_PROGRESS, { ...good, payload: { orderId: 'ord-nobody', at: T } })).status).toBe(404);
    expect((await send('not-a-key', good)).status).toBe(401);
    expect(door.accepted).toHaveLength(1);
  });
});

describe('the founder declares a parcel lost on the road — both real Workers', () => {
  it('a sealed parcel of two orders: the claim door is fenced, nothing moves without both amounts, then the declaration moves both ledgers to lost:sera, files each claim at its typed amount, closes the course, frees the rider, and package.lost.v1 reaches Shop+ after a first 503', async () => {
    const A = 'ord-perdu-a';
    const B = 'ord-perdu-b';
    const RIDER = 'rider-perdu-1';
    const { logistics, custody, shop } = both([A, B]);
    const { code, assignmentId } = await colisConfie(logistics, [A, B], RIDER, 'pa');
    const sealed = await prisEnCharge(custody, logistics, [A, B], code);
    for (const o of [A, B]) expect(await custodian(custody, o), o).toBe(`courier:${RIDER}`);

    // Today's only claim door is fenced to a return: refused by name.
    const fenced = await custodyOps(custody, '/return/claim', {
      orderId: A, command_id: 'claim-today', claim: { orderId: A, cause: 'sera_loss', amount: 12_000, evidenceBundleId: `ev-${A}`, state: 'opened' },
    });
    expect(fenced).toEqual({ status: 409, json: { ok: false, reason: 'return_not_open' } });
    // The course is on the rider's name and he cannot end his shift.
    expect(await moi(logistics, code)).toMatchObject({ assignmentId });
    expect((await appPorts(logistics).acts.endShift(code)).ok).toBe(false);

    // One amount missing: by name, and nothing moves.
    const incomplet = await perdu(logistics, { command_id: 'perdu-1', orderId: A, montants: [{ orderId: A, amount: 12_000 }] });
    expect(incomplet).toEqual({ status: 400, json: { ok: false, reason: 'montants_incomplets' } });
    for (const o of [A, B]) expect(await custodian(custody, o), o).toBe(`courier:${RIDER}`);
    expect(await claims(custody, A)).toEqual([]);

    // The declaration — Shop+ is down for its first answer.
    shop.outages = 1;
    const declared = await perdu(logistics, { command_id: 'perdu-2', orderId: B, montants: [{ orderId: A, amount: 12_000 }, { orderId: B, amount: 7_500 }] });
    expect(declared).toEqual({ status: 200, json: { ok: true, status: 'declare' } });

    // Asked of the ledgers: one named custodian each, never the rider, never none.
    for (const o of [A, B]) expect(await custodian(custody, o), o).toBe('lost:sera');
    expect(await claims(custody, A)).toEqual([{ orderId: A, cause: 'sera_loss', amount: 12_000, evidenceBundleId: `ev-${A}`, state: 'opened' }]);
    expect(await claims(custody, B)).toEqual([{ orderId: B, cause: 'sera_loss', amount: 7_500, evidenceBundleId: `ev-${B}`, state: 'opened' }]);
    // The claims are the founder's read alone: neither the rider's key nor logistics' produce key opens it.
    for (const [path, key] of [['/rider/liability-claims', code], ['/produce/liability-claims', PRODUCE_KEY]] as const) {
      const res = await custody.dispatchFetch(`http://custody${path}?orderId=${A}`, { headers: { Authorization: `Bearer ${key}` } });
      expect({ path, status: res.status, json: await res.json() }).toEqual({ path, status: 404, json: { ok: false, reason: 'not_found' } });
    }

    // The course is closed and the rider is free: no course on his phone, his shift ends.
    expect(await moi(logistics, code)).toBeNull();
    const board = (await ops(logistics, '/ops/board')).json;
    expect(JSON.stringify(board).includes(assignmentId), 'the lost course is off the live board').toBe(false);
    expect((await appPorts(logistics).acts.endShift(code)).ok).toBe(true);

    // Shop+ hears one strict package.lost.v1 per order, after the 503 was
    // retried on the wire's own backoff (first rung: 60 s).
    await attendre(async () => shop.accepted.length, (n) => n === 2, 'package.lost.v1 never reached Shop+ for both orders', 90_000);
    expect(shop.calls.some((c) => c.status === 503)).toBe(true);
    expect(shop.calls.every((c) => c.status === 200 || c.status === 503), JSON.stringify(shop.calls.map((c) => c.status))).toBe(true);
    expect(shop.accepted.map((e) => (e['payload'] as Json)['orderId']).sort()).toEqual([A, B]);
    for (const e of shop.accepted) expect(Object.keys(e['payload'] as Json).sort()).toEqual(['at', 'orderId']);

    // Final: a retry under the same id, and a second declaration, change nothing.
    expect(await perdu(logistics, { command_id: 'perdu-2', orderId: B, montants: [{ orderId: A, amount: 12_000 }, { orderId: B, amount: 7_500 }] }))
      .toEqual({ status: 200, json: { ok: true, status: 'deja_declare' } });
    expect(await perdu(logistics, { command_id: 'perdu-3', orderId: A, montants: [{ orderId: A, amount: 99_000 }, { orderId: B, amount: 1 }] }))
      .toEqual({ status: 200, json: { ok: true, status: 'deja_declare' } });
    // Custody's own file answers the same to a fresh declaration on its produce door.
    const direct = await custody.dispatchFetch('http://custody/produce/colis/perdu', {
      method: 'POST', headers: { Authorization: `Bearer ${PRODUCE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: A, command_id: 'perdu-direct-again', amount: 50_000 }),
    });
    expect({ status: direct.status, json: await direct.json() }).toEqual({ status: 200, json: { ok: true, status: 'deja_declare' } });
    expect(await claims(custody, A)).toHaveLength(1);
    expect(await claims(custody, B)).toHaveLength(1);

    // A later door act on a lost article is refused by name.
    const { codeScelle, chains } = sealed;
    const evidence = await riderCustody(custody, '/rider/delivery/evidence', code, {
      orderId: A, command_id: 'e-after', bundle: { taskId: chains[A]!['task_id'], packageId: chains[A]!['package_id'], custodySealId: codeScelle, artifacts: [], capturedAt: T },
    });
    expect(evidence).toEqual({ status: 409, json: expect.objectContaining({ ok: false, reason: 'custody_not_with_courier' }) });
    expect(await custodian(custody, A)).toBe('lost:sera');

    // He takes the next course: the lease was released.
    const { acts } = appPorts(logistics);
    expect((await acts.startShift(code)).ok).toBe(true);
    const next = await colisConfie(logistics, ['ord-perdu-next'], RIDER, 'pn', { code });
    expect(await moi(logistics, code)).toMatchObject({ assignmentId: next.assignmentId });
  }, 180_000);

  it('before the seal: answered pas_chez_le_livreur, the seller still holds it, no claim, nothing to Shop+', async () => {
    const O = 'ord-perdu-avant';
    const { logistics, custody, shop } = both([O]);
    const { code } = await colisConfie(logistics, [O], 'rider-perdu-avant', 'pb');
    await prisEnCharge(custody, logistics, [O], code, { seal: false });
    const before = await custodian(custody, O);
    const answer = await perdu(logistics, { command_id: 'perdu-avant', orderId: O, montants: [{ orderId: O, amount: 5_000 }] });
    expect(answer).toEqual({ status: 409, json: { ok: false, reason: 'pas_chez_le_livreur' } });
    expect(await custodian(custody, O)).toBe(before);
    expect(await claims(custody, O)).toEqual([]);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(shop.calls).toEqual([]);
  }, 60_000);

  it('one article already dropped: answered pas_chez_le_livreur, the other article stays with the rider, no claim anywhere', async () => {
    const A = 'ord-perdu-livre-a';
    const B = 'ord-perdu-livre-b';
    const RIDER = 'rider-perdu-livre';
    const { logistics, custody, shop } = both([A, B]);
    const { code } = await colisConfie(logistics, [A, B], RIDER, 'pd');
    const { codeScelle, chains } = await prisEnCharge(custody, logistics, [A, B], code);
    const DROP = 'DROP-PERDU-LIVRE';
    const armed = await custody.dispatchFetch('http://custody/produce-shop/secrets/arm', {
      method: 'POST', headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: B, command_id: `arm-${B}`, kind: 'buyer_drop_code', secret: DROP }),
    });
    expect(armed.status).toBe(200);
    await armed.text();
    const chain = chains[B]!;
    expect((await riderCustody(custody, '/rider/delivery/evidence', code, {
      orderId: B, command_id: `e-${B}`, bundle: { taskId: chain['task_id'], packageId: chain['package_id'], custodySealId: codeScelle, artifacts: [], capturedAt: T },
    })).status).toBe(200);
    await riderCustody(custody, '/rider/door/inspection', code, {
      orderId: B, command_id: `i-${B}`, inspectionCategory: 'uncategorised_conservative', packageOpened: false, manufacturerSealOpened: false,
      custodySealIntact: true, buyerAccepts: true, startedAt: T, completedAt: T, evidenceBundleId: `sans-photo-porte-${B}`,
    });
    expect((await riderCustody(custody, '/rider/delivery/drop', code, { orderId: B, command_id: `d-${B}`, dropCode: DROP })).status).toBe(200);
    expect(await custodian(custody, B)).toBe('customer');
    const callsBefore = shop.calls.length;

    const answer = await perdu(logistics, { command_id: 'perdu-livre', orderId: A, montants: [{ orderId: A, amount: 4_000 }, { orderId: B, amount: 6_000 }] });
    expect(answer).toEqual({ status: 409, json: { ok: false, reason: 'pas_chez_le_livreur' } });
    // The second article is with the buyer: the first, still in the rider's
    // bag, must not have moved either.
    expect(await custodian(custody, A)).toBe(`courier:${RIDER}`);
    expect(await custodian(custody, B)).toBe('customer');
    expect(await claims(custody, A)).toEqual([]);
    expect(await claims(custody, B)).toEqual([]);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(shop.calls.slice(callsBefore).filter((c) => (c.body as Json | null)?.['name'] === 'package.lost.v1')).toEqual([]);
  }, 60_000);

  it('while a return is open (the courier still holds it): lost:sera on the ledger, the two return keys refused by name, package.lost.v1 queued', async () => {
    const O = 'ord-perdu-retour';
    const RIDER = 'rider-perdu-retour';
    const { logistics, custody, shop } = both([O]);
    const { code } = await colisConfie(logistics, [O], RIDER, 'pr');
    const { codeScelle, chains } = await prisEnCharge(custody, logistics, [O], code);
    const chain = chains[O]!;
    expect((await riderCustody(custody, '/rider/delivery/evidence', code, {
      orderId: O, command_id: `e-${O}`, bundle: { taskId: chain['task_id'], packageId: chain['package_id'], custodySealId: codeScelle, artifacts: [], capturedAt: T },
    })).status).toBe(200);
    expect((await riderCustody(custody, '/rider/door/refusal', code, { orderId: O, command_id: 'pr-ref', reasonCode: 'insufficient_balance' })).json).toMatchObject({ ok: true, kind: 'window_opened' });
    const expired = await custodyOps(custody, '/door/expire', { orderId: O, command_id: 'pr-exp', at: new Date(Date.now() + 16 * 60_000).toISOString() });
    expect(expired.json['outcome']).toMatchObject({ family: 'return' });
    const scelleRetour = (await attendre(() => moi(logistics, code), (a) => typeof a?.['codeScelleRetour'] === 'string', 'no return seal'))!['codeScelleRetour'] as string;
    expect((await riderCustody(custody, '/rider/return/open', code, { orderId: O, command_id: 'pr-ret', returnSealId: scelleRetour })).json).toMatchObject({ ok: true, kind: 'return_opened' });
    const ouvert = await attendre(() => moi(logistics, code), (a) => typeof a?.['codeRetour'] === 'string', 'the return keys never reached logistics');
    expect(await custodian(custody, O)).toBe(`courier:${RIDER}`);

    expect(await perdu(logistics, { command_id: 'perdu-retour', orderId: O, montants: [{ orderId: O, amount: 9_000 }] }))
      .toEqual({ status: 200, json: { ok: true, status: 'declare' } });
    expect(await custodian(custody, O)).toBe('lost:sera');
    expect(await claims(custody, O)).toEqual([{ orderId: O, cause: 'sera_loss', amount: 9_000, evidenceBundleId: `ev-${O}`, state: 'opened' }]);
    const handover = await riderCustody(custody, '/rider/return/handover', code, { orderId: O, command_id: 'pr-ho', sellerKey: 'ABC-DEF', riderKey: ouvert!['codeRetour'] });
    expect(handover.json['reason']).toBe('custody_not_with_courier');
    expect(await custodian(custody, O)).toBe('lost:sera');
    await attendre(async () => shop.accepted.filter((e) => (e['payload'] as Json)['orderId'] === O).length, (n) => n === 1, 'package.lost.v1 never reached Shop+');
  }, 120_000);

  it('custody is silent once on the second article: the first is lost, the second still with the rider, the course still his, Shop+ hears only the first — the same-id retry completes it, one claim and one event each', async () => {
    const A = 'ord-perdu-mi-a';
    const B = 'ord-perdu-mi-b';
    const RIDER = 'rider-perdu-mi';
    const { logistics, custody, shop, hold } = both([A, B]);
    const { code, assignmentId } = await colisConfie(logistics, [A, B], RIDER, 'pm');
    await prisEnCharge(custody, logistics, [A, B], code);
    hold.failRelayOnceFor = B;
    const corps = { command_id: 'perdu-mi', orderId: A, montants: [{ orderId: A, amount: 3_000 }, { orderId: B, amount: 4_000 }] };
    expect(await perdu(logistics, corps)).toEqual({ status: 503, json: { ok: false, reason: 'custody_unreachable' } });
    expect(await custodian(custody, A)).toBe('lost:sera');
    expect(await custodian(custody, B)).toBe(`courier:${RIDER}`);
    expect(await moi(logistics, code)).toMatchObject({ assignmentId });
    await attendre(async () => shop.accepted.length, (n) => n === 1, 'package.lost.v1 for the first article never reached Shop+');
    await new Promise((r) => setTimeout(r, 1_000));
    expect(shop.accepted.map((e) => (e['payload'] as Json)['orderId'])).toEqual([A]);

    expect(await perdu(logistics, corps)).toEqual({ status: 200, json: { ok: true, status: 'declare' } });
    for (const o of [A, B]) expect(await custodian(custody, o), o).toBe('lost:sera');
    expect(await claims(custody, A)).toHaveLength(1);
    expect(await claims(custody, B)).toHaveLength(1);
    expect(await moi(logistics, code)).toBeNull();
    await attendre(async () => shop.accepted.length, (n) => n === 2, 'package.lost.v1 for the second article never reached Shop+');
    await new Promise((r) => setTimeout(r, 1_000));
    expect(shop.accepted.map((e) => (e['payload'] as Json)['orderId']).sort()).toEqual([A, B]);
  }, 60_000);

  it('the same declaration sent twice at once: both answered 200, one claim and one event per order', async () => {
    const A = 'ord-perdu-dbl-a';
    const B = 'ord-perdu-dbl-b';
    const { logistics, custody, shop } = both([A, B]);
    const { code } = await colisConfie(logistics, [A, B], 'rider-perdu-dbl', 'pdb');
    await prisEnCharge(custody, logistics, [A, B], code);
    const corps = { command_id: 'perdu-dbl', orderId: A, montants: [{ orderId: A, amount: 3_000 }, { orderId: B, amount: 4_000 }] };
    const [un, deux] = await Promise.all([perdu(logistics, corps), perdu(logistics, corps)]);
    for (const r of [un, deux]) {
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(['declare', 'deja_declare']).toContain(r.json['status']);
    }
    for (const o of [A, B]) {
      expect(await custodian(custody, o), o).toBe('lost:sera');
      expect(await claims(custody, o), o).toHaveLength(1);
    }
    await attendre(async () => shop.accepted.length, (n) => n === 2, 'package.lost.v1 never reached Shop+');
    await new Promise((r) => setTimeout(r, 1_000));
    expect(shop.accepted.map((e) => (e['payload'] as Json)['orderId']).sort()).toEqual([A, B]);
  }, 60_000);

  it('a lost message resting unsent for want of Shop+\'s key wakes on the founder\'s retry: the archive answers deja_declare, the relay reaches custody, custody\'s deja_declare revives the row', async () => {
    const O = 'ord-perdu-repos';
    const { logistics, custody, shop, hold, persist } = both([O], { withShopKey: false });
    const { code } = await colisConfie(logistics, [O], 'rider-perdu-repos', 'prp');
    await prisEnCharge(custody, logistics, [O], code);
    const corps = { command_id: 'perdu-repos', orderId: O, montants: [{ orderId: O, amount: 2_500 }] };
    expect(await perdu(logistics, corps)).toEqual({ status: 200, json: { ok: true, status: 'declare' } });
    await new Promise((r) => setTimeout(r, 1_500));
    expect(shop.calls, 'no key: nothing is sent').toEqual([]);
    // The founder sets the key (the same storage, the Worker restarted with it).
    await custody.setOptions(custodyOptions(hold, persist, true) as never);
    hold.relays.length = 0;
    expect(await perdu(logistics, { ...corps, command_id: 'perdu-repos-2' })).toEqual({ status: 200, json: { ok: true, status: 'deja_declare' } });
    expect(hold.relays, 'the retry reached custody').toEqual([O]);
    await attendre(async () => shop.accepted.length, (n) => n === 1, 'the rested row never woke');
    expect(await claims(custody, O)).toHaveLength(1);
    // Amounts that do not name the archived articles: answered the same, nothing relayed.
    hold.relays.length = 0;
    expect(await perdu(logistics, { command_id: 'perdu-repos-3', orderId: O, montants: [{ orderId: 'ord-autre', amount: 1 }] }))
      .toEqual({ status: 200, json: { ok: true, status: 'deja_declare' } });
    expect(hold.relays).toEqual([]);
  }, 60_000);

  it('the lost declaration is never a rider\'s act nor Shop+\'s: rider door 404, Shop+ arm key 404, a rider code on logistics\' founder door 401', async () => {
    const O = 'ord-perdu-portes';
    const { logistics, custody } = both([O]);
    const { code } = await colisConfie(logistics, [O], 'rider-perdu-portes', 'ppo');
    await prisEnCharge(custody, logistics, [O], code);
    const rider = await riderCustody(custody, '/rider/colis/perdu', code, { orderId: O, command_id: 'r-perdu', amount: 1_000 });
    expect(rider).toEqual({ status: 404, json: { ok: false, reason: 'not_found' } });
    const shopKey = await custody.dispatchFetch('http://custody/produce-shop/colis/perdu', {
      method: 'POST', headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: O, command_id: 's-perdu', amount: 1_000 }),
    });
    expect({ status: shopKey.status, json: await shopKey.json() }).toEqual({ status: 404, json: { ok: false, reason: 'not_found' } });
    const riderOnLogistics = await logistics.dispatchFetch('http://logistics/ops/colis/perdu', {
      method: 'POST', headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command_id: 'l-perdu', orderId: O, montants: [{ orderId: O, amount: 1_000 }] }),
    });
    expect(riderOnLogistics.status).toBe(401);
    await riderOnLogistics.text();
    expect(await custodian(custody, O)).toMatch(/^courier:/);
    expect(await claims(custody, O)).toEqual([]);
  }, 60_000);
});
