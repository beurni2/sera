import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';

/**
 * ═══ THE INTAKE ORDERS PRODUCER FACTS ON SÉRA'S CLOCK, AND A CANCEL LANDS ═══
 *
 * SE-I02 admits only a « funded … supplier-ready (readiness confirmed),
 * non-cancelled » order. Shop+ and Boutik+ stamp each fact's `asOf` with
 * their own server's clock, and the intake keeps the newest fact per order —
 * so a fact dated ahead of real time would outrank every true fact after it.
 * Two rules, driven here on the REAL logistics Worker and asked of what the
 * object then does (a later fact applied or ignored, the founder's « à
 * préparer » list, the compose gate), never of the response alone:
 *
 *   · a fact dated more than a few minutes ahead of this Worker's clock is
 *     refused by name (422 `as_of_in_future`) and changes nothing — both
 *     senders keep a refused row pending and retry it;
 *   · on the funding wire a cancel is final: it lands over a stored
 *     « funded » of any age, and no later non-cancel fact undoes it.
 *
 * The same rules hold for an order whose course already closed (its facts
 * live in the course's record).
 */

const OPS = 'test-ops-heure';
const INTAKE = 'test-intake-heure';
const VERIFY = 'test-verify-heure';
const LIVREE = 'test-livree-heure';

type Json = Record<string, unknown>;

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

function spawn(): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'heure-serveur-')),
    bindings: {
      SERA_OPS_SECRET: OPS,
      SERA_INTAKE_SECRET: INTAKE,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_COURSE_LIVREE_SECRET: LIVREE,
    },
  });
  live.push(mf);
  return mf;
}

function doors(mf: Miniflare) {
  const call = async (key: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> => {
    const res = await mf.dispatchFetch(`http://logistics${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  };
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  return {
    ops: (path: string, body?: unknown) => call(OPS, path, body),
    intake: (path: string, body: unknown) => call(INTAKE, path, body),
    produce: (path: string, body: unknown) => call(LIVREE, path, body),
    acts: httpShiftActs('http://logistics', createManualConnectivity('online'), fetchFn),
  };
}

type Doors = ReturnType<typeof doors>;

const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();
const MINUTE = 60_000;
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const fenetre = () => ({ start: iso(0), end: iso(8 * 60 * MINUTE) });

const funded = (d: Doors, orderId: string, asOf: string, over: Json = {}) =>
  d.intake('/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf, ...over });
const cancelled = (d: Doors, orderId: string, asOf: string) =>
  d.intake('/intake/funding', { orderId, status: 'cancelled', paymentMode: 'FULL_PREPAY', asOf });
const ready = (d: Doors, orderId: string, asOf: string) =>
  d.intake('/intake/readiness', { orderId, ready: true, asOf, supplierRef: 'sup-heure' });

async function aPreparer(d: Doors): Promise<Json[]> {
  const res = await d.ops('/ops/a-preparer');
  expect(res.status).toBe(200);
  return res.json['attente'] as Json[];
}

const refusedInFuture = { status: 422, json: { ok: false, reason: 'as_of_in_future' } };

describe('a producer fact dated ahead of Séra’s clock is refused by name and stores nothing', () => {
  it('funding: 2030 is refused; the true fact that follows is applied and the order reaches « à préparer » alone', async () => {
    const d = doors(spawn());
    const O = 'ord-heure-futur-f';
    // Dated 2030 and naming a package: neither the date nor the package may stick.
    expect(await funded(d, O, '2030-01-01T00:00:00.000Z', { package: { packageId: 'col-heure', orderIds: [O, 'ord-heure-autre'] } }))
      .toEqual(refusedInFuture);
    expect(await ready(d, O, iso(0))).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });
    expect((await aPreparer(d)).map((r) => r['orderId'])).not.toContain(O);

    // The true fact, at Séra's now: applied (nothing dated later was kept)…
    expect(await funded(d, O, iso(0))).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });
    // …and the order is one line, alone — no package was recorded from the refused fact.
    const ligne = (await aPreparer(d)).find((r) => r['orderId'] === O);
    expect(ligne, 'the order is ready to compose').toBeDefined();
    expect(ligne).not.toHaveProperty('colis');
  }, 60_000);

  it('readiness: 2030 is refused; the true fact that follows is applied', async () => {
    const d = doors(spawn());
    const O = 'ord-heure-futur-r';
    expect(await funded(d, O, iso(0))).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });
    expect(await ready(d, O, '2030-01-01T00:00:00.000Z')).toEqual(refusedInFuture);
    expect((await aPreparer(d)).map((r) => r['orderId'])).not.toContain(O);
    expect(await ready(d, O, iso(0))).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });
    expect((await aPreparer(d)).map((r) => r['orderId'])).toContain(O);
  }, 60_000);

  it('the bound is minutes, not hours: an hour ahead is refused, four minutes ahead is a server clock and is heard', async () => {
    const d = doors(spawn());
    expect(await funded(d, 'ord-heure-1h', iso(60 * MINUTE))).toEqual(refusedInFuture);
    expect(await ready(d, 'ord-heure-1h', iso(60 * MINUTE))).toEqual(refusedInFuture);
    expect(await funded(d, 'ord-heure-4m', iso(4 * MINUTE))).toEqual({ status: 200, json: { ok: true, orderId: 'ord-heure-4m', applied: true } });
    expect(await ready(d, 'ord-heure-4m', iso(4 * MINUTE))).toEqual({ status: 200, json: { ok: true, orderId: 'ord-heure-4m', applied: true } });
  }, 60_000);
});

describe('on the funding wire a cancel is final', () => {
  it('funded(now) then cancelled(now − 1 s): the cancel lands, the order cannot be composed, and no replay undoes it', async () => {
    const d = doors(spawn());
    const O = 'ord-heure-annule';
    const fundedAt = iso(0);
    expect(await funded(d, O, fundedAt)).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });
    expect(await cancelled(d, O, new Date(Date.parse(fundedAt) - 1_000).toISOString()))
      .toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });
    expect(await ready(d, O, iso(0))).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });

    const composer = () => d.ops('/ops/task', { command_id: `t-${O}-${Math.random()}`, orderId: O, location: LOC, window: fenetre() });
    expect(await composer()).toEqual({ status: 422, json: { ok: false, admitted: false, reason: 'order_cancelled' } });
    expect((await aPreparer(d)).map((r) => r['orderId'])).not.toContain(O);

    // The sender's own funded row, redelivered after the cancel: ignored.
    expect(await funded(d, O, fundedAt)).toEqual({ status: 200, json: { ok: true, orderId: O, applied: false, reason: 'order_cancelled' } });
    // A funded dated later still (inside the bound): ignored too.
    expect(await funded(d, O, iso(2_000))).toEqual({ status: 200, json: { ok: true, orderId: O, applied: false, reason: 'order_cancelled' } });
    // A funded older than the cancel keeps today's answer.
    expect(await funded(d, O, new Date(Date.parse(fundedAt) - 5_000).toISOString()))
      .toEqual({ status: 200, json: { ok: true, orderId: O, applied: false, reason: 'older_fact_ignored' } });
    expect(await composer()).toEqual({ status: 422, json: { ok: false, admitted: false, reason: 'order_cancelled' } });
    expect((await aPreparer(d)).map((r) => r['orderId'])).not.toContain(O);
  }, 60_000);
});

describe('an order whose course already closed keeps the same two rules', () => {
  it('a fact dated ahead is refused and the true one after it applies; a cancel of any age lands and no later fact undoes it', async () => {
    const d = doors(spawn());
    const RIDER = 'rider-heure-clos';
    const O = 'ord-heure-clos';
    expect((await d.ops('/ops/riders', { riderId: RIDER, displayName: 'Clos', phoneAlias: RIDER })).status).toBe(200);
    expect((await d.ops('/ops/riders/certify', { riderId: RIDER, certified: true })).status).toBe(200);
    const code = (await d.ops('/ops/rider-code/mint', { riderId: RIDER })).json['code'] as string;
    expect((await d.acts.ackPrivacy(code)).ok).toBe(true);
    expect((await d.acts.startShift(code)).ok).toBe(true);

    const fundedAt = iso(0);
    expect((await funded(d, O, fundedAt)).status).toBe(200);
    expect((await ready(d, O, fundedAt)).status).toBe(200);
    const composed = await d.ops('/ops/task', { command_id: 't-clos', orderId: O, location: LOC, window: fenetre() });
    expect(composed.status, JSON.stringify(composed.json)).toBe(200);
    const granted = await d.ops('/ops/assign', { command_id: 'a-clos', taskId: composed.json['taskId'], riderId: RIDER });
    expect(granted.status, JSON.stringify(granted.json)).toBe(200);
    expect(await d.acts.accepterCourse(code, (granted.json['assignment'] as Json)['assignmentId'] as string)).toEqual({ ok: true });
    const livree = await d.produce('/produce/course-livree', { command_id: 'l-clos', orderId: O, at: iso(0) });
    expect(livree.json).toMatchObject({ ok: true, status: 'livree' });

    // Dated ahead: refused, and nothing kept — the next true facts apply.
    expect(await funded(d, O, '2030-01-01T00:00:00.000Z')).toEqual(refusedInFuture);
    expect(await ready(d, O, '2030-01-01T00:00:00.000Z')).toEqual(refusedInFuture);
    const plusTard = new Date(Date.parse(fundedAt) + 1_000).toISOString();
    expect(await funded(d, O, plusTard)).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });
    expect(await ready(d, O, plusTard)).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });

    // A cancel older than the stored funded still lands…
    expect(await cancelled(d, O, fundedAt)).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });
    // …and nothing after it undoes it.
    expect(await funded(d, O, plusTard)).toEqual({ status: 200, json: { ok: true, orderId: O, applied: false, reason: 'order_cancelled' } });
    expect(await funded(d, O, new Date(Date.parse(fundedAt) - 1_000).toISOString()))
      .toEqual({ status: 200, json: { ok: true, orderId: O, applied: false, reason: 'older_fact_ignored' } });
    // The closed order never comes back to « à préparer ».
    expect((await aPreparer(d)).map((r) => r['orderId'])).not.toContain(O);
  }, 60_000);
});
