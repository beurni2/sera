import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ PORTE-CUSTODY part A — THE §6.3 DOOR STAGE, OVER THE REAL WORKER ═══
 *
 * The spine has held the door laws since WO-2.4 (`recordDoorInspection`,
 * `consumeDoorPaidSignal` — ~250 tests, all spine-direct) and NO route
 * reached them: a pay-at-door order's drop refused `inspection_not_accepted`
 * forever. « A port that exists is not a port that is called. » These tests
 * drive the REAL bundled Worker (miniflare, real DO storage) through the two
 * new wires and ask the LEDGER for the outcome:
 *
 *   · `/rider/door/inspection` — the rider records the OBSERVABLE session
 *     (SE-I11 bans only PAYMENT assertion; an inspection asserts none).
 *   · `/produce-shop/door-signal` — Shop+ forwards the provider-actored
 *     `payment.door_leg_confirmed.v1`; the SPINE judges the actor class
 *     itself, refuse-closed.
 *
 * The conservative fallback category `uncategorised_conservative` (founder
 * ruling 2026-08-14, decision b) is the category under test: a category-less
 * product inspects outer packaging only.
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-ops-secret-porte-0001';
const PRODUCE_KEY = 'test-produce-secret-porte-0001';
const SHOP_ARM_KEY = 'test-shop-arm-secret-porte-0001';
const VERIFY_KEY = 'test-rider-verify-secret-porte';

const RIDER = 'rider-porte-0001';
const RIDER_CODE = 'SR-PORTE-PERSONAL-0001';

const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const T = '2026-08-14T09:00:00.000Z';

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-porte-${tag}-`));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

function logisticsStub() {
  return async (request: Request): Promise<Response> => {
    const auth = request.headers.get('Authorization') ?? '';
    if (auth !== `Bearer ${VERIFY_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (new URL(request.url).pathname !== '/verify/rider-code') {
      return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
    }
    const body = (await request.json().catch(() => null)) as Json | null;
    if (String(body?.['code'] ?? '') === RIDER_CODE) return Response.json({ ok: true, riderId: RIDER });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  };
}

/** The Shop+ wires are deliberately UNWIRED here (no SHOP_PROGRESS binding,
 *  no course-livrée secret): the outbox rows come to their honest
 *  `unsendable_no_config` rest, which the vrai-route suite already pins. This
 *  file is about the DOOR stage, not the wires. */
function boot(dir: string): Miniflare {
  return new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: { LOGISTICS: logisticsStub() },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: OPS,
      SERA_RIDER_VERIFY_SECRET: VERIFY_KEY,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
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

/** A well-formed provider event, the shape Shop+ forwards (door-flow.test.ts
 *  builds the identical one through PlatformEventSchema.parse). */
function doorSignalEvent(orderId: string, commandId: string, actor = 'shop:commerce-core'): Json {
  return {
    name: 'payment.door_leg_confirmed.v1',
    envelope: {
      command_id: commandId, correlation_id: `corr-${orderId}`, aggregateVersion: 1,
      actor, serverTime: T, version: '1',
    },
    payload: {
      provider: 'sandbox-provider', payment_attempt_id: `payatt-${commandId}`, collectRef: `collect-${orderId}`,
      amount: 11_500, fee: 0, status: 'captured', order_id: orderId, redelivery: 0,
    },
  };
}

/** Open the chain in DOOR MODE through the producer doors — the exact roads
 *  logistics and Shop+ drive live — and arm the two machine secrets. */
async function doorModeArmed(mf: Miniflare, orderId: string, pickup: string, drop: string): Promise<void> {
  expect((await call(mf, 'POST', '/produce/order/open', PRODUCE_KEY, {
    orderId,
    taskId: `task-${orderId}`,
    packageId: `pkg-${orderId}`,
    correlationId: `corr-${orderId}`,
    supplierId: 'supplier-porte-1',
    paymentMode: 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR',
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, {
    orderId, command_id: `arm-p-${orderId}`, kind: 'pickup_verification_code', secret: pickup,
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce-shop/secrets/arm', SHOP_ARM_KEY, {
    orderId, command_id: `arm-d-${orderId}`, kind: 'buyer_drop_code', secret: drop,
  })).status).toBe(200);
}

/** Verified, custody begun (register-at-begin seal), evidence landed —
 *  the order standing at the buyer's door. */
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

const inspection = (orderId: string, commandId: string, over: Json = {}): Json => ({
  orderId,
  command_id: commandId,
  inspectionCategory: 'uncategorised_conservative',
  packageOpened: false,
  manufacturerSealOpened: false,
  custodySealIntact: true,
  buyerAccepts: true,
  startedAt: T,
  completedAt: T,
  evidenceBundleId: `eb-door-${orderId}`,
  ...over,
});

describe('PORTE-CUSTODY — the full door sequence over the WORKER, never spine-direct', () => {
  const O = 'ord-porte-route';
  const PICKUP = 'PICKUP-PORTE-0001';
  const SEAL = 'SEAL-PORTE-0001';
  const DROP = 'DROP-PORTE-7391';
  const dir = freshDir('route');

  it('drop refuses until inspected, refuses until provider-paid, then hands custody to the customer — and the two new commands replay across a rebuild', async () => {
    const mf = boot(dir);
    await doorModeArmed(mf, O, PICKUP, DROP);
    await atTheDoor(mf, O, PICKUP, SEAL);

    // ① The gate the wire was missing: without an inspection, the drop
    // refuses BY NAME — this was the permanent state before part A.
    const early1 = await call(mf, 'POST', '/rider/delivery/drop', RIDER_CODE, {
      orderId: O, command_id: 'drop-early-1', dropCode: DROP,
    });
    expect(early1.status).toBe(409);
    expect(early1.json).toMatchObject({ ok: false, reason: 'inspection_not_accepted' });

    // ② The rider records the observable session — conservative fallback
    // category, buyer accepts.
    const inspected = await call(mf, 'POST', '/rider/door/inspection', RIDER_CODE, inspection(O, 'insp-1'));
    expect(inspected.status).toBe(200);
    expect(inspected.json).toEqual({ ok: true, kind: 'accepted' });

    // ②a A SECOND inspection refuses — one inspection per delivery attempt.
    const again = await call(mf, 'POST', '/rider/door/inspection', RIDER_CODE, inspection(O, 'insp-2'));
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ ok: false, reason: 'inspection_already_recorded' });

    // ②b A REPLAYED identical inspection command byte-replays its recorded
    // outcome, marked duplicate — never a second act, never a fresh answer.
    const replayed = await call(mf, 'POST', '/rider/door/inspection', RIDER_CODE, inspection(O, 'insp-1'));
    expect(replayed.status).toBe(200);
    expect(replayed.json).toEqual({ ok: true, kind: 'accepted', duplicate: true });

    // ③ Inspected is not paid: the drop still refuses, by its own name.
    const early2 = await call(mf, 'POST', '/rider/delivery/drop', RIDER_CODE, {
      orderId: O, command_id: 'drop-early-2', dropCode: DROP,
    });
    expect(early2.status).toBe(409);
    expect(early2.json).toMatchObject({ ok: false, reason: 'door_payment_not_confirmed' });

    // ④ Shop+ forwards the provider-actored signal through its own door.
    const paid = await call(mf, 'POST', '/produce-shop/door-signal', SHOP_ARM_KEY, {
      orderId: O, command_id: 'sig-1', event: doorSignalEvent(O, 'evt-sig-1'),
    });
    expect(paid.status).toBe(200);
    expect(paid.json).toEqual({ ok: true, duplicate: false });

    // ④a The signal's replay is absorbed — same command, recorded answer.
    const paidAgain = await call(mf, 'POST', '/produce-shop/door-signal', SHOP_ARM_KEY, {
      orderId: O, command_id: 'sig-1', event: doorSignalEvent(O, 'evt-sig-1'),
    });
    expect(paidAgain.status).toBe(200);
    expect(paidAgain.json).toEqual({ ok: true, duplicate: true });

    // ⑤ Inspect → pay → the buyer's code LAST: custody crosses.
    const drop = await call(mf, 'POST', '/rider/delivery/drop', RIDER_CODE, {
      orderId: O, command_id: 'drop-final', dropCode: DROP,
    });
    expect(drop.status).toBe(200);
    expect(drop.json).toMatchObject({ ok: true, status: 'custody_with_customer' });

    // ASK THE LEDGER, not the response: the customer holds it, the door
    // facts are on the chain, and the head vouches for all of it.
    const ledger = await call(mf, 'GET', `/ops/ledger?orderId=${O}`, OPS);
    expect(ledger.json['currentCustodian']).toBe('customer');
    const results = (ledger.json['entries'] as { kind: string; payload: Json }[])
      .filter((e) => e.kind === 'validation_decision').map((e) => e.payload['result']);
    expect(results).toContain('door_inspection_recorded');
    expect(results).toContain('door_payment_confirmed');
    expect((await call(mf, 'GET', `/ops/ledger/verify?orderId=${O}`, OPS)).json)
      .toMatchObject({ ok: true, valid: true, headMatches: true });

    // ⑥ REBUILD: a fresh object over the same storage replays the whole log —
    // both new command kinds included — and the delivered state answers.
    await mf.dispose();
    const mf2 = boot(dir);
    const deja = await call(mf2, 'POST', '/rider/delivery/drop', RIDER_CODE, {
      orderId: O, command_id: 'drop-after-rebuild', dropCode: DROP,
    });
    expect(deja.status).toBe(200);
    expect(deja.json).toMatchObject({ ok: true, status: 'deja_livree' });
    // The exact-command replay answers verbatim too, marked duplicate.
    const exact = await call(mf2, 'POST', '/rider/delivery/drop', RIDER_CODE, {
      orderId: O, command_id: 'drop-final', dropCode: DROP,
    });
    expect(exact.json).toMatchObject({ ok: true, status: 'custody_with_customer', duplicate: true });
    expect((await call(mf2, 'GET', `/ops/ledger/verify?orderId=${O}`, OPS)).json)
      .toMatchObject({ ok: true, valid: true, headMatches: true });
    expect((await call(mf2, 'GET', `/ops/ledger?orderId=${O}`, OPS)).json['currentCustodian']).toBe('customer');
    await mf2.dispose();
  }, 60_000);
});

describe('PORTE-CUSTODY — the refusal roads, each by its own name', () => {
  it('a wrong-actor signal refuses producer_actor_mismatch, and the alert never rides the HTTP answer', async () => {
    const mf = boot(freshDir('actor'));
    const O = 'ord-porte-actor';
    await doorModeArmed(mf, O, 'PICKUP-ACTOR-1', 'DROP-ACTOR-1');
    await atTheDoor(mf, O, 'PICKUP-ACTOR-1', 'SEAL-ACTOR-1');
    expect((await call(mf, 'POST', '/rider/door/inspection', RIDER_CODE, inspection(O, 'insp-1'))).status).toBe(200);

    // Exact-match law: 'shop:commerce-core-evil' is NOT 'shop:commerce-core'.
    const forged = await call(mf, 'POST', '/produce-shop/door-signal', SHOP_ARM_KEY, {
      orderId: O, command_id: 'sig-evil', event: doorSignalEvent(O, 'evt-evil', 'shop:commerce-core-evil'),
    });
    expect(forged.status).toBe(409);
    expect(forged.json).toEqual({ ok: false, reason: 'producer_actor_mismatch' });
    // The spine RECORDED its reconciliation alert — readable at /events,
    // never in the door's answer.
    const events = (await call(mf, 'GET', `/ops/events?orderId=${O}`, OPS)).json['events'] as { name: string; payload: Json }[];
    const alert = events.find((e) => e.name === 'reconciliation.alert.v1');
    expect(alert?.payload).toMatchObject({ scenario: 'producer_actor_mismatch' });

    // …and the door stays unpaid: the drop still refuses.
    const drop = await call(mf, 'POST', '/rider/delivery/drop', RIDER_CODE, {
      orderId: O, command_id: 'drop-1', dropCode: 'DROP-ACTOR-1',
    });
    expect(drop.status).toBe(409);
    expect(drop.json).toMatchObject({ reason: 'door_payment_not_confirmed' });
    await mf.dispose();
  }, 60_000);

  it('a signal BEFORE any accepted inspection refuses door_signal_not_awaited — inspect-before-pay holds at the wire', async () => {
    const mf = boot(freshDir('unawaited'));
    const O = 'ord-porte-unawaited';
    await doorModeArmed(mf, O, 'PICKUP-UNAW-1', 'DROP-UNAW-1');

    const early = await call(mf, 'POST', '/produce-shop/door-signal', SHOP_ARM_KEY, {
      orderId: O, command_id: 'sig-early', event: doorSignalEvent(O, 'evt-early'),
    });
    expect(early.status).toBe(409);
    expect(early.json).toEqual({ ok: false, reason: 'door_signal_not_awaited' });
    await mf.dispose();
  }, 60_000);

  it('the rider door opens /door/inspection and the shop door opens /door-signal — never each other, never for FULL_PREPAY-breaking acts', async () => {
    const mf = boot(freshDir('doors'));
    const O = 'ord-porte-doors';
    await doorModeArmed(mf, O, 'PICKUP-DOORS-1', 'DROP-DOORS-1');

    // The shop key cannot record an inspection (not in PRODUCE_SHOP_ROUTES)…
    expect((await call(mf, 'POST', '/produce-shop/door/inspection', SHOP_ARM_KEY, inspection(O, 'x'))).status).toBe(404);
    // …the produce (logistics) key cannot send the signal…
    expect((await call(mf, 'POST', '/produce/door-signal', PRODUCE_KEY, {
      orderId: O, command_id: 'x', event: doorSignalEvent(O, 'evt-x'),
    })).status).toBe(404);
    // …and the rider cannot assert the payment (SE-I11: no rider assertion).
    expect((await call(mf, 'POST', '/rider/door-signal', RIDER_CODE, {
      orderId: O, command_id: 'x', event: doorSignalEvent(O, 'evt-x'),
    })).status).toBe(404);
    await mf.dispose();
  }, 60_000);
});
