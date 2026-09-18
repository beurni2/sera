import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryCostSchema } from '@platform/contracts';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { FLEET_OVERHEAD_ITEMS } from '../src/delivery-cost.js';

/**
 * ═══ FLOTTE-1 (SE7.2) — the fleet book on the REAL logistics Worker ═══
 *
 * « Vehicle docs/maintenance/fuel/odometer; DeliveryCost decomposition
 * (direct/return/allocated/fully-loaded, low/base/high); utilization +
 * deliveries/moto/day. » The founder's doors on his key; the shift record
 * opened by the RIDER APP's own start act and closed by its end act; the
 * delivery counted by custody's own wire (`/produce/course-livree`), on the
 * moto the rider held — then the yardstick and the §7.1 decomposition read
 * back off the book, never off a response.
 */

const OPS = 'test-ops-flotte';
const INTAKE = 'test-intake-flotte';
const VERIFY = 'test-verify-flotte';
const LIVREE_KEY = 'test-course-livree-key-flotte';

const mf = new Miniflare({
  modules: true,
  scriptPath: 'dist-worker/worker.mjs',
  durableObjects: { LOGISTICS: 'LogisticsDO' },
  durableObjectsPersist: mkdtempSync(join(tmpdir(), 'flotte-logistics-')),
  bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY, SERA_COURSE_LIVREE_SECRET: LIVREE_KEY },
});
afterAll(async () => {
  await mf.dispose();
});

type Json = Record<string, unknown>;

async function ops(path: string, body?: unknown, key = OPS): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function intake(path: string, body: unknown): Promise<void> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(res.status, path).toBe(200);
  await res.text();
}

async function produce(path: string, body: unknown): Promise<Json> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${LIVREE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return (await res.json()) as Json;
}

const acts = () => {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  return httpShiftActs('http://logistics', createManualConnectivity('online'), fetchFn);
};

const T = '2026-09-18T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: 'Après le rond-point', maskedRelay: '' };
const WIN = { start: T, end: '2026-09-18T16:00:00.000Z' };
const RIDER = 'rider-flotte-1';
const overhead = Object.fromEntries(FLEET_OVERHEAD_ITEMS.map((k) => [k, 10_000]));
const H = { riderCostPerShiftFcfa: 8_000, deliveriesPerShift: 8, electricityPerDeliveryFcfa: 100, failedAttemptRate: 0.2, monthlyFleetOverheadFcfa: overhead, monthlyDispatchOverheadFcfa: 60_000, monthlyDeliveries: 600 };

describe('FLOTTE-1 — the fleet book, the shift record and the delivery count on the real Worker', () => {
  it('the doors are the founder’s: the intake key and no key are the one 401', async () => {
    expect((await ops('/ops/flotte', undefined, INTAKE)).status).toBe(401);
    expect((await ops('/ops/flotte/moto', { command_id: 'x', label: 'M', fleetTranche: 1 }, 'wrong')).status).toBe(401);
  });

  it('an empty book says so: no moto, the yardstick null, no hypotheses, the cost door refuses by name', async () => {
    const f = await ops('/ops/flotte');
    expect(f.status).toBe(200);
    expect(f.json).toMatchObject({ ok: true, motos: [], entries: [], shifts: [], hypotheses: null, documentsDus: [] });
    expect(f.json['utilisation']).toMatchObject({ motosActives: 0, livraisonsParMotoParJour: null, tauxEchec: null });
    expect(await ops('/ops/flotte/cout?orderId=ord-x&deliveryFunding=1500')).toMatchObject({ status: 409, json: { ok: false, reason: 'hypotheses_absentes' } });
  });

  it('declare a moto (replayed by id) → its papers, a repair, a charge, an odometer that only climbs → hand it to a rider', async () => {
    const declared = await ops('/ops/flotte/moto', { command_id: 'fl-m1', label: 'Moto A', fleetTranche: 1, odometerKm: 1_200 });
    expect(declared.status, JSON.stringify(declared.json)).toBe(200);
    const moto = declared.json['moto'] as Json;
    expect(moto).toMatchObject({ label: 'Moto A', fleetTranche: 1, status: 'active', odometerKm: 1_200, checkedOutBy: null });
    const vehicleId = moto['vehicleId'] as string;
    expect((await ops('/ops/flotte/moto', { command_id: 'fl-m1', label: 'ignored', fleetTranche: 3 })).json).toMatchObject({ status: 'deja_declaree', moto: { vehicleId, label: 'Moto A' } });
    expect((await ops('/ops/flotte/moto', { command_id: 'fl-m-bad', label: '', fleetTranche: 1 })).status).toBe(400);
    expect((await ops('/ops/flotte/moto', { command_id: 'fl-m-nope', vehicleId: 'nope', label: 'X', fleetTranche: 1 })).status).toBe(404);

    expect((await ops('/ops/flotte/moto/entree', { command_id: 'fl-e1', vehicleId, kind: 'document', doc: { kind: 'assurance', expiresAt: '2026-10-01T00:00:00.000Z' } })).status).toBe(200);
    expect((await ops('/ops/flotte/moto/entree', { command_id: 'fl-e2', vehicleId, kind: 'maintenance', note: 'plaquettes', costFcfa: 12_000, odometerKm: 1_350 })).status).toBe(200);
    expect((await ops('/ops/flotte/moto/entree', { command_id: 'fl-e3', vehicleId, kind: 'energie', kwh: 2.4, costFcfa: 300 })).status).toBe(200);
    expect(await ops('/ops/flotte/moto/entree', { command_id: 'fl-e4', vehicleId, kind: 'compteur', odometerKm: 1_300 })).toMatchObject({ status: 409, json: { reason: 'odometer_goes_backwards' } });
    expect((await ops('/ops/flotte/moto/entree', { command_id: 'fl-e5', vehicleId: 'nope', kind: 'energie' })).status).toBe(404);
    expect((await ops('/ops/flotte/moto/entree', { command_id: 'fl-e6', vehicleId, kind: 'carburant' })).status).toBe(400);

    await ops('/ops/riders', { riderId: RIDER, displayName: 'Boss', phoneAlias: 'fl' });
    await ops('/ops/riders/certify', { riderId: RIDER, certified: true });
    expect((await ops('/ops/flotte/moto/confier', { command_id: 'fl-c1', vehicleId, riderId: 'rider-inconnu' })).status).toBe(404);
    const confiee = await ops('/ops/flotte/moto/confier', { command_id: 'fl-c2', vehicleId, riderId: RIDER });
    expect(confiee.json).toMatchObject({ ok: true, status: 'confiee', moto: { checkedOutBy: RIDER } });

    const f = (await ops('/ops/flotte')).json;
    expect((f['motos'] as Json[])[0]).toMatchObject({ vehicleId, odometerKm: 1_350, docs: [{ kind: 'assurance', expiresAt: '2026-10-01T00:00:00.000Z' }], checkedOutBy: RIDER });
    expect((f['entries'] as Json[]).map((e) => e['kind'])).toEqual(['energie', 'maintenance', 'document']);
    expect(f['documentsDus']).toEqual([{ vehicleId, label: 'Moto A', kind: 'assurance', expiresAt: '2026-10-01T00:00:00.000Z', expire: false }]);
  });

  it('the rider’s own start act opens the shift record on his moto; custody’s wire counts the delivery on it, once; his end act closes the record; the yardstick reads deliveries/moto/day', async () => {
    const code = (await ops('/ops/rider-code/mint', { riderId: RIDER })).json['code'] as string;
    const a = acts();
    await a.ackPrivacy(code);
    expect((await a.startShift(code)).ok).toBe(true);
    const avant = (await ops('/ops/flotte')).json;
    expect((avant['shifts'] as Json[])[0]).toMatchObject({ riderId: RIDER, endedAt: null });
    const vehicleId = (avant['shifts'] as Json[])[0]!['vehicleId'];
    expect(vehicleId).toEqual(expect.stringMatching(/^moto-/));

    const O = 'ord-flotte-1';
    await intake('/intake/funding', { orderId: O, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
    await intake('/intake/readiness', { orderId: O, ready: true, asOf: T, supplierRef: 'sup-fl' });
    const composed = (await ops('/ops/task', { command_id: 'fl-t1', orderId: O, location: LOC, window: WIN })).json;
    const granted = (await ops('/ops/assign', { command_id: 'fl-a1', taskId: composed['taskId'], riderId: RIDER })).json;
    expect(granted['ok'], JSON.stringify(granted)).toBe(true);
    expect((await a.accepterCourse(code, (granted['assignment'] as Json)['assignmentId'] as string)).ok).toBe(true);

    // The wire, twice — counted once.
    const at = new Date().toISOString();
    expect((await produce('/produce/course-livree', { command_id: 'fl-l1', orderId: O, at }))['status']).toBe('livree');
    expect((await produce('/produce/course-livree', { command_id: 'fl-l1', orderId: O, at }))['status']).toBe('deja_livree');
    expect((await a.endShift(code)).ok).toBe(true);

    const f = (await ops('/ops/flotte')).json;
    expect(f['coursesCount']).toBe(1);
    expect((f['shifts'] as Json[])[0]).toMatchObject({ riderId: RIDER, vehicleId });
    expect((f['shifts'] as Json[])[0]!['endedAt']).toEqual(expect.any(String));
    const u = f['utilisation'] as Json;
    expect(u).toMatchObject({ windowDays: 14, livrees: 1, retournees: 0, motosActives: 1, tauxEchec: 0 });
    expect(u['livraisonsParMotoParJour']).toBe(Math.round((1 / 14) * 100) / 100);
    expect(u['parMoto']).toEqual([{ vehicleId, label: 'Moto A', livrees: 1, retournees: 0 }]);
  });

  it('the founder’s hypotheses (refused whole when one number is wrong) → the §7.1 decomposition for an order, three scenarios, canon-shaped, reconciling line by line', async () => {
    expect(await ops('/ops/flotte/hypotheses', { command_id: 'fl-h0', hypotheses: { low: H, base: { ...H, deliveriesPerShift: 0 }, high: H } })).toMatchObject({ status: 400, json: { reason: 'hypotheses_malformees' } });
    expect((await ops('/ops/flotte')).json['hypotheses']).toBeNull();
    const set = { low: H, base: { ...H, failedAttemptRate: 0.5 }, high: { ...H, riderCostPerShiftFcfa: 16_000 } };
    expect((await ops('/ops/flotte/hypotheses', { command_id: 'fl-h1', hypotheses: set })).json).toMatchObject({ ok: true, status: 'enregistrees' });
    const c = await ops('/ops/flotte/cout?orderId=ord-flotte-1&deliveryFunding=1500');
    expect(c.status).toBe(200);
    const couts = c.json['couts'] as Record<string, Json>;
    for (const s of ['low', 'base', 'high']) expect(DeliveryCostSchema.parse(couts[s])).toEqual(couts[s]);
    expect(couts['low']).toEqual({ orderId: 'ord-flotte-1', directDeliveryCost: 1_375, returnDeliveryCost: 2_200, allocatedFleetOverhead: 200, allocatedDispatchOverhead: 100, fullyLoadedDeliveryCost: 1_675, deliveryFunding: 1_500, deliveryContributionMargin: 125 });
    expect(couts['base']).toMatchObject({ directDeliveryCost: 2_200, deliveryContributionMargin: -700 });
    expect(couts['high']).toMatchObject({ directDeliveryCost: 2_625 });
    expect((await ops('/ops/flotte/cout?orderId=&deliveryFunding=1500')).status).toBe(400);
    expect((await ops('/ops/flotte/cout?orderId=o&deliveryFunding=12.5')).status).toBe(400);
  });
});
