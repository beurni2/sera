import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ REPROGRAMMATION-1 — THE SEVENTH WIRE, OVER THE REAL WORKER ═══
 *
 * RETOUR-VIVANT-1 proved the §6.4 ladder's non-escalating arm ends in a
 * canonical `reschedule` outcome with custody untouched — and that outcome
 * then reached NOBODY: the rider's screen said « Séra vous appelle », and
 * Séra had not been told. These tests drive the REAL bundled Worker
 * (miniflare, real DO storage) and ask the WIRE and the LEDGER:
 *
 *   · the expiry into `reschedule` arms `/produce/reprogrammation` towards
 *     logistics, at-least-once, carrying the CANONICAL outcome logistics'
 *     RescheduleBook strict-parses — on the course-livrée key;
 *   · the escalating arm arms NO such wire (a return is a return);
 *   · the 2e passage is the ORDINARY drop: custody permits it, and the ladder
 *     stays one-deep (a second refusal answers `ladder_already_open` — the
 *     safest default, journalled as open).
 *
 * The logistics stub is CONTRACT-CERTIFIED to logistics-do.ts's new door
 * (200 by name on every settled condition; 400 only on a malformed body).
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-ops-secret-reprog-0001';
const PRODUCE_KEY = 'test-produce-secret-reprog-0001';
const SHOP_ARM_KEY = 'test-shop-arm-secret-reprog-0001';
const VERIFY_KEY = 'test-rider-verify-secret-reprog';
const LIVREE_KEY = 'test-course-livree-secret-reprog';

const RIDER = 'rider-reprog-0001';
const RIDER_CODE = 'SR-REPROG-PERSONAL-0001';
const SUPPLIER = 'supplier-reprog-1';

const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const T = '2026-09-17T09:00:00.000Z';
/** The founder's attested instant, sixteen minutes past the Worker's NOW. */
const plus16 = (): string => new Date(Date.now() + 16 * 60_000).toISOString();

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-reprog-${tag}-`));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

interface LogisticsWorld {
  produce: { path: string; body: Json; auth: string }[];
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
    if (path.startsWith('/produce/')) {
      if (auth !== `Bearer ${LIVREE_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const body = (await request.json().catch(() => ({}))) as Json;
      world.produce.push({ path, body, auth });
      // logistics-do.ts: `/produce/reprogrammation` answers `enregistre` and
      // refuses ONLY a malformed body (no outcome, or one naming another
      // order) with a 400 — certified here so the wire's retry law is real.
      if (path === '/produce/reprogrammation') {
        const outcome = body['outcome'] as Json | undefined;
        if (outcome === undefined || outcome['orderId'] !== body['orderId']) {
          return Response.json({ ok: false, reason: 'malformed' }, { status: 400 });
        }
        return Response.json({ ok: true, status: 'enregistre' });
      }
      return Response.json({ ok: true, status: 'livree' });
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

/** A PREPAID course, armed by the two producers exactly as they arm it live. */
async function prepaidArmed(mf: Miniflare, orderId: string, pickup: string, drop: string): Promise<void> {
  expect((await call(mf, 'POST', '/produce/order/open', PRODUCE_KEY, {
    orderId, taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, correlationId: `corr-${orderId}`,
    supplierId: SUPPLIER, paymentMode: 'FULL_PREPAY',
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

async function ledgerCustodian(mf: Miniflare, orderId: string): Promise<unknown> {
  return (await call(mf, 'GET', `/ops/ledger?orderId=${orderId}`, OPS)).json['currentCustodian'];
}

async function eventsOf(mf: Miniflare, orderId: string): Promise<{ name: string; payload: Json }[]> {
  return (await call(mf, 'GET', `/ops/events?orderId=${orderId}`, OPS)).json['events'] as { name: string; payload: Json }[];
}

describe('REPROGRAMMATION-1 — the reschedule reaches logistics, and the 2e passage is the ordinary drop', () => {
  it('honest_absence → the window expires into RESCHEDULE → `/produce/reprogrammation` carries the CANONICAL outcome on the course-livrée key, once → custody untouched → the ladder stays one-deep → the buyer’s code lands the 2e passage → the course-livrée wire fires', async () => {
    const world: LogisticsWorld = { produce: [] };
    const mf = boot(freshDir('wire'), world);
    const O = 'ord-reprog-wire';
    await prepaidArmed(mf, O, 'PICKUP-W1', 'DROP-W1');
    await atTheDoor(mf, O, 'PICKUP-W1', 'SEAL-W1');

    const refused = await call(mf, 'POST', '/rider/door/refusal', RIDER_CODE, { orderId: O, command_id: 'ref-w', reasonCode: 'honest_absence' });
    expect(refused.status, JSON.stringify(refused.json)).toBe(200);
    expect(refused.json).toMatchObject({ ok: true, kind: 'window_opened', outcome: { family: 'retry', attempt: { number: 1 } } });
    // The window alone arms NOTHING towards logistics: the rider may still land it.
    expect(world.produce.filter((p) => p.path === '/produce/reprogrammation')).toHaveLength(0);

    const expired = await call(mf, 'POST', '/ops/door/expire', OPS, { orderId: O, command_id: 'exp-w', at: plus16() });
    expect(expired.status, JSON.stringify(expired.json)).toBe(200);
    expect(expired.json['outcome']).toMatchObject({ family: 'reschedule', reasonCode: 'honest_absence', faultClass: 'buyer', attempt: { number: 2 } });

    // THE SEVENTH WIRE — at-least-once, from the alarm, on the one key
    // custody presents to logistics, with the canonical outcome itself.
    const wire = await attendreProduce(world, '/produce/reprogrammation', O);
    expect(wire).toMatchObject({ orderId: O, command_id: `reprogrammation-${O}` });
    expect(typeof wire['at']).toBe('string');
    expect(wire['outcome']).toMatchObject({
      taskId: `task-${O}`, orderId: O, family: 'reschedule', reasonCode: 'honest_absence',
      humanReasonRef: 'reason.honest_absence', faultClass: 'buyer', attempt: { number: 2 },
    });
    expect(world.produce.find((p) => p.path === '/produce/reprogrammation')?.auth).toBe(`Bearer ${LIVREE_KEY}`);
    // No franc anywhere on the wire (SE-I09).
    expect(JSON.stringify(wire)).not.toMatch(/amount|fcfa/i);
    // Once per order: a second flush (any later alarm) re-sends nothing.
    await new Promise((r) => setTimeout(r, 600));
    expect(world.produce.filter((p) => p.path === '/produce/reprogrammation')).toHaveLength(1);
    // Nothing went home: no return wire, no refusal event, no fee, custody with the courier.
    expect(world.produce.some((p) => p.path === '/produce/retour-ouvert')).toBe(false);
    expect((await eventsOf(mf, O)).some((e) => e.name === 'delivery.refused.v1')).toBe(false);
    expect(await ledgerCustodian(mf, O)).toBe(`courier:${RIDER}`);

    // THE 2E PASSAGE. The ladder is one-deep (§6.4: one window, ever) — a
    // second absence cannot mint another window; said by name, journalled.
    const again = await call(mf, 'POST', '/rider/door/refusal', RIDER_CODE, { orderId: O, command_id: 'ref-w2', reasonCode: 'honest_absence' });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ ok: false, reason: 'ladder_already_open' });
    // The evidence is HELD from the first passage — a relaunched phone that
    // re-submits is told so (the app reads it as held), whatever ids it names.
    const held = await call(mf, 'POST', '/rider/delivery/evidence', RIDER_CODE, {
      orderId: O, command_id: 'e-w-again',
      bundle: { taskId: 'task-follow-up-w', packageId: `pkg-${O}`, custodySealId: 'SEAL-W1', artifacts: [], capturedAt: T },
    });
    expect(held.status).toBe(409);
    expect(held.json).toMatchObject({ ok: false, reason: 'evidence_already_submitted' });
    // And the buyer's code, this time, lands the ordinary drop.
    const dropped = await call(mf, 'POST', '/rider/delivery/drop', RIDER_CODE, { orderId: O, command_id: 'drop-w', dropCode: 'DROP-W1' });
    expect(dropped.status, JSON.stringify(dropped.json)).toBe(200);
    expect(dropped.json).toMatchObject({ ok: true, status: 'custody_with_customer' });
    expect(await ledgerCustodian(mf, O)).toBe('customer');
    await attendreProduce(world, '/produce/course-livree', O);
    await mf.dispose();
  });

  it('the escalating arm arms NO reprogrammation wire: insufficient_balance expires into RETURN, and only the return wires fire', async () => {
    const world: LogisticsWorld = { produce: [] };
    const mf = boot(freshDir('return'), world);
    const O = 'ord-reprog-return';
    await prepaidArmed(mf, O, 'PICKUP-R1', 'DROP-R1');
    await atTheDoor(mf, O, 'PICKUP-R1', 'SEAL-R1');
    expect((await call(mf, 'POST', '/rider/door/refusal', RIDER_CODE, { orderId: O, command_id: 'ref-r', reasonCode: 'insufficient_balance' })).status).toBe(200);
    const expired = await call(mf, 'POST', '/ops/door/expire', OPS, { orderId: O, command_id: 'exp-r', at: plus16() });
    expect(expired.json['outcome']).toMatchObject({ family: 'return' });
    const opened = await call(mf, 'POST', '/rider/return/open', RIDER_CODE, { orderId: O, command_id: 'ret-r', returnSealId: 'RETSEAL-R1' });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    // The return wire crossed — and the reprogrammation wire never existed for this order.
    await attendreProduce(world, '/produce/retour-ouvert', O);
    expect(world.produce.some((p) => p.path === '/produce/reprogrammation')).toBe(false);
    await mf.dispose();
  });
});
