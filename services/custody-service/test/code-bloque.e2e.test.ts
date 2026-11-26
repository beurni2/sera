import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';
import { httpCustodyActs } from '../../../apps/rider-app/src/net/custody-acts';

/**
 * ═══ THE BUYER'S CODE LOCKS AFTER FIVE WRONG TRIES; ONLY THE FOUNDER
 * UNLOCKS IT ═══
 *
 * Founder ruling (2026-11-26): « drop code locks after 5 tries (console
 * unlock) ». SE-I05: delivery requires the buyer's drop code; SE3: each
 * order keeps its own drop, so the count lives in each article's own file.
 * The lock is not an end: the rider keeps the parcel (SE-I04, one current
 * custodian), nothing is released or refunded (§5.5, §6.5), and the founder's
 * unlock gives five fresh tries.
 *
 * Driven on the REAL bundled custody Worker through the rider app's OWN
 * custody port. The logistics stub is certified as `porte-holder.e2e.test.ts`
 * certifies it (two codes, two riders; its produce door takes custody's
 * course-livrée key). Outcomes are asked of the LEDGER, the events and the
 * receivers, never believed from the answer alone.
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-ops-secret-lock-00000001';
const PRODUCE_KEY = 'test-produce-secret-lock-0001';
const SHOP_ARM_KEY = 'test-shop-arm-secret-lock-001';
const SHOP_WIRE_KEY = 'test-progress-secret-lock-001';
const VERIFY_KEY = 'test-rider-verify-secret-lock';
const LIVREE_KEY = 'test-course-livree-secret-lck';
const TIMEOUT = 90_000;

const R1 = 'rider-lock-0001';
const R1_CODE = 'SR-LOCK-PERSONAL-0001';
const R2 = 'rider-lock-0002';
const R2_CODE = 'SR-LOCK-PERSONAL-0002';
const SUPPLIER = 'supplier-lock-1';
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const T = '2026-11-26T10:00:00.000Z';

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-lock-${tag}-`));
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
    seen.shop.push({ path: new URL(request.url).pathname, body: (await request.json().catch(() => ({}))) as Json });
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

function appPort(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as unknown as typeof globalThis.fetch;
  return httpCustodyActs('http://custody', { current: () => 'online' as const }, fetchFn as never);
}
const id = (s: string) => s as never;

async function opened(mf: Miniflare, orderId: string, drop: string | null): Promise<void> {
  expect((await call(mf, 'POST', '/produce/order/open', PRODUCE_KEY, {
    orderId, taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, correlationId: `corr-${orderId}`,
    supplierId: SUPPLIER, paymentMode: 'FULL_PREPAY',
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, {
    orderId, command_id: `arm-p-${orderId}`, kind: 'pickup_verification_code', secret: `PICKUP-${orderId}`,
  })).status).toBe(200);
  if (drop !== null) await armDrop(mf, orderId, `arm-d-${orderId}`, drop);
}

async function armDrop(mf: Miniflare, orderId: string, commandId: string, drop: string): Promise<void> {
  const r = await call(mf, 'POST', '/produce-shop/secrets/arm', SHOP_ARM_KEY, {
    orderId, command_id: commandId, kind: 'buyer_drop_code', secret: drop,
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}

/** R1 verifies, seals and photographs the handoff — he holds the parcel at the door. */
async function r1AtTheDoor(mf: Miniflare, orderId: string): Promise<void> {
  const acts = appPort(mf);
  const seal = `SEAL-${orderId}`;
  expect((await acts.verifyPickup({
    commandId: id(`v-${orderId}`), orderId, presentedPickupCode: `PICKUP-${orderId}`,
    evidenceBundleId: `ev-${orderId}`, dwellSec: 150, checkResults: ALL_PASS,
  }, R1_CODE)).kind).toBe('recorded');
  expect((await acts.beginCustody({ commandId: id(`b-${orderId}`), orderId, custodySealId: seal, sealPhotoRefs: [] }, R1_CODE)).kind).toBe('recorded');
  expect(await acts.submitDeliveryEvidence({
    commandId: id(`e-${orderId}`), orderId, custodySealId: seal,
    taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, artifacts: [], capturedAt: T,
  }, R1_CODE)).toMatchObject({ kind: 'recorded' });
  expect(await custodian(mf, orderId)).toBe(`courier:${R1}`);
}

const drop = (mf: Miniflare, orderId: string, commandId: string, code: string, riderCode = R1_CODE) =>
  appPort(mf).confirmDrop({ commandId: id(commandId), orderId, dropCode: code }, riderCode);

async function custodian(mf: Miniflare, orderId: string): Promise<unknown> {
  return (await call(mf, 'GET', `/ops/ledger?orderId=${orderId}`, OPS)).json['currentCustodian'];
}
async function events(mf: Miniflare, orderId: string): Promise<{ name: string; payload: Json }[]> {
  return (await call(mf, 'GET', `/ops/events?orderId=${orderId}`, OPS)).json['events'] as { name: string; payload: Json }[];
}
async function lockAlerts(mf: Miniflare, orderId: string): Promise<{ name: string; payload: Json }[]> {
  return (await events(mf, orderId)).filter((e) => e.name === 'reconciliation.alert.v1' && e.payload['scenario'] === 'drop_code_locked');
}
async function doorActCount(mf: Miniflare, orderId: string): Promise<number> {
  return ((await call(mf, 'GET', `/ops/attestations?orderId=${orderId}`, OPS)).json['doorActs'] as unknown[]).length;
}
async function headMatches(mf: Miniflare, orderId: string): Promise<void> {
  expect((await call(mf, 'GET', `/ops/ledger/verify?orderId=${orderId}`, OPS)).json).toMatchObject({ valid: true, headMatches: true });
}
const refused = (reason: string) => ({ kind: 'refused', reason });
const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

async function fiveWrong(mf: Miniflare, orderId: string, tag: string, riderCode = R1_CODE): Promise<void> {
  for (let i = 1; i <= 4; i += 1) {
    expect(await drop(mf, orderId, `${tag}-${i}`, `WRONG-${tag}-${i}`, riderCode), `wrong try ${i}`).toEqual(refused('drop_code_refused'));
  }
  expect(await drop(mf, orderId, `${tag}-5`, `WRONG-${tag}-5`, riderCode), 'the fifth wrong try').toEqual(refused('drop_code_locked'));
}

describe('the buyer\'s code locks after five wrong tries, unlocked by the founder', () => {
  it('five wrong codes lock it; the right code is then refused; nothing moves; it stays locked after eviction; only the founder\'s door unlocks; then the right code delivers', async () => {
    const seen: Seen = { shop: [], logistics: [] };
    const dir = freshDir('main');
    let mf = boot(dir, seen);
    const A = 'ord-lock-main';
    const RIGHT = 'DROP-LOCK-MAIN-1';
    await opened(mf, A, RIGHT);
    await r1AtTheDoor(mf, A);

    await fiveWrong(mf, A, 'w');
    expect(await drop(mf, A, 'right-while-locked', RIGHT), 'the right code while locked').toEqual(refused('drop_code_locked'));
    // Another rider learns nothing, not even that it is locked: « not you » first.
    expect(await drop(mf, A, 'r2-while-locked', RIGHT, R2_CODE)).toEqual(refused('not_the_custodian'));

    expect(await custodian(mf, A)).toBe(`courier:${R1}`);
    const names = (await events(mf, A)).map((e) => e.name);
    expect(names).not.toContain('custody.transferred_to_customer.v1');
    expect(names).not.toContain('delivery.validated.v1');
    const alerts = await lockAlerts(mf, A);
    expect(alerts.map((a) => a.payload)).toEqual([{ scenario: 'drop_code_locked', order_id: A, refusals: 5 }]);
    await headMatches(mf, A);
    expect(seen.logistics.filter((p) => p.path.includes('course-livree')), 'logistics heard no delivery').toEqual([]);

    const lock = await call(mf, 'GET', `/ops/drop-code/lock?orderId=${A}`, OPS);
    expect(lock.status).toBe(200);
    expect(lock.json).toMatchObject({ ok: true, locked: true });
    expect(typeof lock.json['since']).toBe('string');
    const raw = JSON.stringify({ lock: lock.json, alerts });
    for (const s of [RIGHT, digest(RIGHT)]) expect(raw.includes(s), 'the code or its digest leaked').toBe(false);

    // ── eviction: a new runtime on the same storage still says locked ──
    await mf.dispose();
    mf = boot(dir, seen);
    await headMatches(mf, A);
    expect((await call(mf, 'GET', `/ops/drop-code/lock?orderId=${A}`, OPS)).json).toMatchObject({ locked: true });
    const rowsBefore = await doorActCount(mf, A);
    expect(await drop(mf, A, 'locked-1', 'WRONG-L-1')).toEqual(refused('drop_code_locked'));
    expect(await drop(mf, A, 'locked-2', 'WRONG-L-2')).toEqual(refused('drop_code_locked'));
    expect(await drop(mf, A, 'locked-3', RIGHT)).toEqual(refused('drop_code_locked'));
    expect(await doorActCount(mf, A), 'locked tries wrote no rows').toBe(rowsBefore);
    expect(await lockAlerts(mf, A)).toHaveLength(1);
    await headMatches(mf, A);

    // ── only the founder's door unlocks ──
    expect((await call(mf, 'POST', '/rider/drop-code/unlock', R1_CODE, { orderId: A, command_id: 'u-rider' })).status).toBe(404);
    expect((await call(mf, 'POST', '/produce-shop/drop-code/unlock', SHOP_ARM_KEY, { orderId: A, command_id: 'u-shop' })).status).toBe(404);
    expect((await call(mf, 'GET', `/ops/drop-code/lock?orderId=${A}`, OPS)).json).toMatchObject({ locked: true });

    const unlock = await call(mf, 'POST', '/ops/drop-code/unlock', OPS, { orderId: A, command_id: 'u-1', at: T });
    expect(unlock).toEqual({ status: 200, json: { ok: true, status: 'debloque' } });
    const again = await call(mf, 'POST', '/ops/drop-code/unlock', OPS, { orderId: A, command_id: 'u-1', at: T });
    expect(again).toEqual({ status: 200, json: { ok: true, status: 'debloque', duplicate: true } });
    expect((await call(mf, 'GET', `/ops/drop-code/lock?orderId=${A}`, OPS)).json).toMatchObject({ ok: true, locked: false });

    const att = await call(mf, 'GET', `/ops/attestations?orderId=${A}`, OPS);
    const unlockRows = (att.json['doorActs'] as { kind: string; command_id: string; attribution: string; recorded: boolean }[])
      .filter((r) => r.kind === 'unlock_drop_code');
    expect(unlockRows.map((r) => [r.command_id, r.attribution, r.recorded])).toEqual([['u-1', 'founder_attested', true]]);
    for (const s of [RIGHT, digest(RIGHT)]) expect(JSON.stringify(att.json).includes(s)).toBe(false);

    const done = await drop(mf, A, 'right-after-unlock', RIGHT);
    expect(done, JSON.stringify(done)).toMatchObject({ kind: 'recorded', body: { status: 'custody_with_customer' } });
    expect(await custodian(mf, A)).toBe('customer');
    await headMatches(mf, A);
    // A delivered file is never « locked », whatever its history.
    expect((await call(mf, 'GET', `/ops/drop-code/lock?orderId=${A}`, OPS)).json).toMatchObject({ locked: false });
    await mf.dispose();
  }, TIMEOUT);

  it('a code that has not arrived never counts; a resent command id counts once; a re-arm does not reset; an unlock with nothing locked writes nothing', async () => {
    const seen: Seen = { shop: [], logistics: [] };
    const mf = boot(freshDir('rules'), seen);

    // ── six presentations before the buyer's code is armed lock nothing ──
    const U = 'ord-lock-unarmed';
    const RIGHT_U = 'DROP-LOCK-UNARMED';
    await opened(mf, U, null);
    await r1AtTheDoor(mf, U);
    for (let i = 1; i <= 6; i += 1) {
      const a = await drop(mf, U, `early-${i}`, RIGHT_U);
      expect(a.kind === 'refused' && a.reason === 'drop_code_locked', `early try ${i}: ${JSON.stringify(a)}`).toBe(false);
    }
    expect((await call(mf, 'GET', `/ops/drop-code/lock?orderId=${U}`, OPS)).json).toMatchObject({ locked: false });
    await armDrop(mf, U, 'arm-d-late', RIGHT_U);
    expect(await drop(mf, U, 'armed-right', RIGHT_U)).toMatchObject({ kind: 'recorded', body: { status: 'custody_with_customer' } });

    // ── one wrong code re-sent five times under one command id does not lock ──
    const S = 'ord-lock-resent';
    const RIGHT_S = 'DROP-LOCK-RESENT';
    await opened(mf, S, RIGHT_S);
    await r1AtTheDoor(mf, S);
    for (let i = 1; i <= 5; i += 1) {
      expect(await drop(mf, S, 'same-id', 'WRONG-SAME'), `resend ${i}`).toEqual(refused('drop_code_refused'));
    }
    expect((await call(mf, 'GET', `/ops/drop-code/lock?orderId=${S}`, OPS)).json).toMatchObject({ locked: false });

    // ── an unlock with nothing locked answers so and writes no row ──
    const rows = await doorActCount(mf, S);
    expect(await call(mf, 'POST', '/ops/drop-code/unlock', OPS, { orderId: S, command_id: 'u-none', at: T }))
      .toEqual({ status: 200, json: { ok: true, status: 'pas_bloque' } });
    expect(await doorActCount(mf, S)).toBe(rows);
    expect(await drop(mf, S, 'resent-right', RIGHT_S)).toMatchObject({ kind: 'recorded', body: { status: 'custody_with_customer' } });

    // ── four strikes, a re-arm of the same code, then the fifth still locks ──
    const R = 'ord-lock-rearm';
    const RIGHT_R = 'DROP-LOCK-REARM';
    await opened(mf, R, RIGHT_R);
    await r1AtTheDoor(mf, R);
    for (let i = 1; i <= 4; i += 1) expect(await drop(mf, R, `ra-${i}`, `WRONG-RA-${i}`)).toEqual(refused('drop_code_refused'));
    await armDrop(mf, R, 'arm-d-again', RIGHT_R);
    expect(await drop(mf, R, 'ra-5', 'WRONG-RA-5')).toEqual(refused('drop_code_locked'));
    expect(await drop(mf, R, 'ra-right', RIGHT_R)).toEqual(refused('drop_code_locked'));

    // ── logistics' produce door unlocks too (the console's relay) ──
    expect(await call(mf, 'POST', '/produce/drop-code/unlock', PRODUCE_KEY, { orderId: R, command_id: 'debloque-c1', at: T }))
      .toEqual({ status: 200, json: { ok: true, status: 'debloque' } });
    expect((await call(mf, 'GET', `/produce/drop-code/lock?orderId=${R}`, PRODUCE_KEY)).json).toMatchObject({ locked: false });
    // Five fresh tries after an unlock: the next wrong code is refused, not locked.
    expect(await drop(mf, R, 'ra-6', 'WRONG-RA-6')).toEqual(refused('drop_code_refused'));
    expect(await drop(mf, R, 'ra-right-2', RIGHT_R)).toMatchObject({ kind: 'recorded', body: { status: 'custody_with_customer' } });
    await headMatches(mf, R);
    await mf.dispose();
  }, TIMEOUT);

  it('the founder\'s own ops-door drop counts on the same rule; a second lock cycle raises its own alert', async () => {
    const seen: Seen = { shop: [], logistics: [] };
    const mf = boot(freshDir('ops'), seen);
    const O = 'ord-lock-ops';
    const RIGHT = 'DROP-LOCK-OPS';
    await opened(mf, O, RIGHT);
    await r1AtTheDoor(mf, O);
    const opsDrop = (cid: string, code: string) => call(mf, 'POST', '/ops/delivery/drop', OPS, { orderId: O, command_id: cid, dropCode: code, at: T });
    for (let i = 1; i <= 4; i += 1) expect((await opsDrop(`o-${i}`, `WRONG-O-${i}`)).json).toMatchObject({ reason: 'drop_code_refused' });
    expect(await opsDrop('o-5', 'WRONG-O-5')).toEqual({ status: 409, json: { ok: false, reason: 'drop_code_locked' } });
    expect(await opsDrop('o-right', RIGHT)).toEqual({ status: 409, json: { ok: false, reason: 'drop_code_locked' } });
    expect((await call(mf, 'POST', '/ops/drop-code/unlock', OPS, { orderId: O, command_id: 'u-o1', at: T })).json).toMatchObject({ status: 'debloque' });
    await fiveWrong(mf, O, 'c2');
    const alerts = await lockAlerts(mf, O);
    expect(alerts).toHaveLength(2);
    expect(new Set(alerts.map((a) => JSON.stringify(a))).size, 'each cycle its own alert').toBe(2);
    expect(await custodian(mf, O)).toBe(`courier:${R1}`);
    await headMatches(mf, O);
    await mf.dispose();
  }, TIMEOUT);

  it('a rider who does not hold the parcel cannot strike it: five foreign tries are refused by name and the holder still delivers', async () => {
    const seen: Seen = { shop: [], logistics: [] };
    const mf = boot(freshDir('foreign'), seen);
    const F = 'ord-lock-foreign';
    const RIGHT = 'DROP-LOCK-FOREIGN';
    await opened(mf, F, RIGHT);
    await r1AtTheDoor(mf, F);
    for (let i = 1; i <= 5; i += 1) {
      expect(await drop(mf, F, `r2-${i}`, `WRONG-F-${i}`, R2_CODE), `foreign try ${i}`).toEqual(refused('not_the_custodian'));
    }
    expect((await call(mf, 'GET', `/ops/drop-code/lock?orderId=${F}`, OPS)).json).toMatchObject({ locked: false });
    expect(await drop(mf, F, 'r1-right', RIGHT)).toMatchObject({ kind: 'recorded', body: { status: 'custody_with_customer' } });
    await mf.dispose();
  }, TIMEOUT);
});
