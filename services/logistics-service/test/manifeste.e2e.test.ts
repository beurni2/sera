import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';
import { httpCourses } from '../../../apps/dispatch-console/src/courses-port';

/**
 * ═══ MANIFESTE-1 — SE3.1 + SE3.2 ON THE LIVE ROAD, REAL AGAINST REAL ═══
 *
 * SE-I03 « at most one active RouteManifest and one current stop » · SE3.1
 * « ordered manifest; one active route + one current stop; single-job;
 * package accounted at close; cancelled task can't leave custody inventory »
 * · SE3.2 « end-shift-with-custody exception — mandatory transfer/hub
 * exception » · SE-I04 « task status alone MUST NOT be custody truth ».
 *
 * Two Miniflares run the two shipped bundles behind the service binding; the
 * RIDER app's own ports and the CONSOLE's own port drive both halves:
 *
 *   logistics ──GET /produce/custodian──────────────▶ custody   (the ledger's word)
 *   rider     ──GET /rider/moi (manifest)───────────▶ logistics
 *   rider     ──POST /rider/shift/end───────────────▶ logistics (asks the ledger first)
 *   console   ──POST /ops/shift/exception───────────▶ logistics (the founder's ack)
 *   custody   ──/produce/course-livree──────────────▶ logistics (the manifest closes)
 *
 * The proof is asked of the LEDGERS — custody's custodian, the board, the
 * rider's session, the registry's exception log — never of a response alone.
 */

const OPS = 'test-ops-manif';
const INTAKE = 'test-intake-manif';
const VERIFY = 'test-verify-manif';
const CUSTODY_OPS = 'test-custody-ops-manif';
const PRODUCE_KEY = 'test-produce-key-manif';
const SHOP_ARM_KEY = 'test-shop-arm-key-manif';
const LIVREE_KEY = 'test-course-livree-key-manif';
const SUPPLIER = 'supplier-manif-1';

const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

interface Hold {
  custody?: Miniflare;
  logistics?: Miniflare;
  custodyCalls: { path: string; status: number }[];
}

function spawnCustody(hold: Hold): Miniflare {
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'manif-custody-')),
    serviceBindings: {
      LOGISTICS: (request: Request) => hold.logistics!.dispatchFetch(request.url, request as never) as never,
    },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: CUSTODY_OPS,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_COURSE_LIVREE_SECRET: LIVREE_KEY,
    },
  });
  live.push(mf);
  hold.custody = mf;
  return mf;
}

function spawnLogistics(hold: Hold, custodyDown = false): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'manif-logistics-')),
    serviceBindings: {
      CUSTODY: (async (request: Request) => {
        // The SILENT custody: the binding throws (a Worker that is down).
        if (custodyDown) throw new Error('custody is down');
        const res = await hold.custody!.dispatchFetch(request.url, request as never);
        hold.custodyCalls.push({ path: new URL(request.url).pathname, status: res.status });
        return res;
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

type Json = Record<string, unknown>;

async function ops(mf: Miniflare, path: string, body?: unknown): Promise<Json> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await res.json()) as Json;
}

async function opsRaw(mf: Miniflare, path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function intake(mf: Miniflare, path: string, body: unknown): Promise<Json> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, path).toBe(200);
  return (await res.json()) as Json;
}

async function riderCustody(mf: Miniflare, path: string, code: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function riderDoor(mf: Miniflare, path: string, code: string): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return { acts: httpShiftActs('http://logistics', net, fetchFn), session: httpRiderSession('http://logistics', net, fetchFn) };
}

/** The dispatch console's OWN port. */
function desk(mf: Miniflare, key: string = OPS) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  return httpCourses('http://logistics', key, fetchFn);
}

const T = '2026-09-18T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: 'Après le rond-point', maskedRelay: '' };
const WIN = { start: T, end: '2026-09-18T16:00:00.000Z' };
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

async function courseConfiee(mf: Miniflare, orderId: string, riderId: string, prefix: string) {
  await intake(mf, '/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
  await intake(mf, '/intake/readiness', { orderId, ready: true, asOf: T, supplierRef: SUPPLIER });
  const composed = await ops(mf, '/ops/task', { command_id: `${prefix}-t`, orderId, location: LOC, window: WIN });
  expect(composed['ok'], JSON.stringify(composed)).toBe(true);
  const roster = (await ops(mf, '/ops/riders')) as { riders?: { riderId: string }[] };
  if (!(roster.riders ?? []).some((r) => r.riderId === riderId)) {
    await ops(mf, '/ops/riders', { riderId, displayName: 'Boss', phoneAlias: prefix });
    await ops(mf, '/ops/riders/certify', { riderId, certified: true });
  }
  const code = (await ops(mf, '/ops/rider-code/mint', { riderId }))['code'] as string;
  const { acts } = appPorts(mf);
  await acts.ackPrivacy(code);
  const shift = await acts.startShift(code);
  if (!shift.ok && (shift as { refus?: string }).refus !== 'already_on_shift') throw new Error(`start refused: ${JSON.stringify(shift)}`);
  const granted = await ops(mf, '/ops/assign', { command_id: `${prefix}-a`, taskId: composed['taskId'], riderId });
  expect(granted['ok'], JSON.stringify(granted)).toBe(true);
  const assignmentId = (granted['assignment'] as Json)['assignmentId'] as string;
  const accepted = await acts.accepterCourse(code, assignmentId);
  expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
  return { code, assignmentId, taskId: composed['taskId'] as string };
}

async function attendreChaine(custody: Miniflare, orderId: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    const res = await custody.dispatchFetch(`http://custody/ops/ledger?orderId=${orderId}`, { headers: { Authorization: `Bearer ${CUSTODY_OPS}` } });
    await res.text();
    if (res.status === 200) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('custody chain never opened');
}

async function custodian(custody: Miniflare, orderId: string): Promise<unknown> {
  const res = await custody.dispatchFetch(`http://custody/ops/ledger?orderId=${orderId}`, { headers: { Authorization: `Bearer ${CUSTODY_OPS}` } });
  return ((await res.json()) as Json)['currentCustodian'];
}

async function moi(mf: Miniflare, code: string): Promise<Json> {
  const res = await mf.dispatchFetch('http://logistics/rider/moi', { headers: { Authorization: `Bearer ${code}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as Json)['rider'] as Json;
}

async function attendre<T>(read: () => Promise<T>, done: (v: T) => boolean, why: string): Promise<T> {
  let last!: T;
  for (let i = 0; i < 80; i += 1) {
    last = await read();
    if (done(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${why} — last: ${JSON.stringify(last)}`);
}

/** Verified and sealed on the rider's own door: custody is the courier's. */
async function custodyAuCoursier(custody: Miniflare, logistics: Miniflare, orderId: string, code: string, prefix: string): Promise<{ codeScelle: string; chain: Json }> {
  await attendreChaine(custody, orderId);
  const { session } = appPorts(logistics);
  const signed = await session.signIn(code);
  if (!signed.ok) throw new Error('sign-in refused');
  const assignment = signed.session.assignment as unknown as Json;
  const pv = assignment['codeVerification'] as string;
  const sc = assignment['codeScelle'] as string;
  const verified = await riderCustody(custody, '/rider/verification', code, {
    orderId, command_id: `${prefix}-v`, presentedPickupCode: pv, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${prefix}`,
  });
  expect(verified.status, JSON.stringify(verified.json)).toBe(200);
  const began = await riderCustody(custody, '/rider/custody/begin', code, { orderId, command_id: `${prefix}-b`, custodySealId: sc, sealPhotoRefs: [] });
  expect(began.status, JSON.stringify(began.json)).toBe(200);
  return { codeScelle: sc, chain: began.json['chain'] as Json };
}

describe('MANIFESTE-1 — one manifest, one current stop, and the end of service asks the ledger', () => {
  it('pickup → custody → the delivery is the one current stop → the shift CANNOT end (custody would be orphaned) → the founder authorizes, naming the next owner → it ends, logged → the delivery closes the manifest with nothing left on it', async () => {
    const hold: Hold = { custodyCalls: [] };
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const custody = hold.custody!;
    const O = 'ord-manif-1';
    const RIDER = 'rider-manif-1';
    const PKG = `pkg-${O}`;
    const { code, assignmentId } = await courseConfiee(logistics, O, RIDER, 'm1');
    const { acts } = appPorts(logistics);

    // BEFORE CUSTODY: two stops, the pickup first is the ONE current stop, nothing carried.
    const avant = (await moi(logistics, code))['manifest'] as Json;
    expect(avant).toMatchObject({ id: `man-${RIDER}`, riderId: RIDER, status: 'active', custodyInventory: [], version: 1 });
    expect((avant['stops'] as Json[]).map((s) => s['kind'])).toEqual(['ramassage', 'livraison']);
    expect((avant['currentStop'] as Json)['kind']).toBe('ramassage');
    // The read went to custody's own door, not to the task's status.
    expect(hold.custodyCalls.some((c) => c.path === '/produce/custodian')).toBe(true);

    // CUSTODY IS HIS (verified + sealed on his own door): the pickup stop is done.
    await custodyAuCoursier(custody, logistics, O, code, 'm1');
    expect(await custodian(custody, O)).toBe(`courier:${RIDER}`);
    const porte = (await moi(logistics, code))['manifest'] as Json;
    expect(porte).toMatchObject({ status: 'active', custodyInventory: [PKG], version: 2, orderedStops: [`livraison-${assignmentId}`] });
    expect((porte['currentStop'] as Json)['kind']).toBe('livraison');
    expect((porte['custodyReadings'] as Json[])[0]).toMatchObject({ orderId: O, reading: 'coursier' });
    // The same manifest on the founder's board and through the console's own port.
    const board = (await ops(logistics, '/ops/board'))['board'] as Json;
    expect((board['manifestes'] as Record<string, Json>)[RIDER]).toMatchObject({ custodyInventory: [PKG], orderedStops: [`livraison-${assignmentId}`] });
    const rows = await desk(logistics).manifestes();
    expect(rows).toMatchObject({ kind: 'ok', value: [{ riderId: RIDER, riderName: 'Boss', currentStop: { kind: 'livraison', orderId: O }, stopsCount: 1, packageIds: [PKG], lectureInconnue: false, finDeService: null }] });

    // SE3.2 — THE SHIFT CANNOT END WHILE THE LEDGER PLACES A PACKAGE WITH HIM.
    const refused = await acts.endShift(code);
    expect(refused).toEqual({ ok: false, reason: 'refused', refus: 'custody_would_be_orphaned' });
    expect(((await moi(logistics, code))['shift'] as Json)['status']).toBe('on_shift');
    expect((await moi(logistics, code))['finDeServiceAutorisee']).toBe(false);

    // THE FOUNDER AUTHORIZES, through the console's own port, naming the next owner.
    const authorized = await desk(logistics).autoriserFinDeService(RIDER, { kind: 'return_to_hub_task', ref: O }, 'cmd-fs-1');
    expect(authorized).toEqual({ kind: 'ok', value: { status: 'autorisee', packageIds: [PKG] } });
    // The exact replay answers by name and authorizes nothing twice.
    expect(await desk(logistics).autoriserFinDeService(RIDER, { kind: 'return_to_hub_task', ref: O }, 'cmd-fs-1')).toMatchObject({ kind: 'ok', value: { status: 'deja_autorisee' } });
    expect((await moi(logistics, code))['finDeServiceAutorisee']).toBe(true);
    expect(await desk(logistics).manifestes()).toMatchObject({ kind: 'ok', value: [{ riderId: RIDER, finDeService: { nextOwner: 'return_to_hub_task', packageIds: [PKG] } }] });

    // NOW IT ENDS — and the registry logged the exception with his ack and the next owner.
    const ended = await acts.endShift(code);
    expect(ended.ok, JSON.stringify(ended)).toBe(true);
    expect(((await moi(logistics, code))['shift'] as Json)['status']).toBe('off_shift');
    const log = await ops(logistics, '/ops/shift/exceptions');
    expect(log['exceptions']).toEqual([{ riderId: RIDER, at: expect.any(String), packageIds: [PKG], dispatcherAckId: 'cmd-fs-1', nextOwner: { kind: 'return_to_hub_task', ref: O } }]);
    // Consumed: nothing pending, and a second end-shift tomorrow would ask again.
    expect(log['enAttente']).toEqual({});
    expect((await moi(logistics, code))['finDeServiceAutorisee']).toBe(false);
    // THE LEDGER DID NOT MOVE: custody stays his until the real road.
    expect(await custodian(custody, O)).toBe(`courier:${RIDER}`);
    expect(((await moi(logistics, code))['manifest'] as Json)['custodyInventory']).toEqual([PKG]);

    // THE NEXT DAY: back on shift, the delivery — and the manifest closes with NOTHING on it (package accounted at close).
    expect((await acts.startShift(code)).ok).toBe(true);
    const drop = 'DROP-M1';
    const armed = await custody.dispatchFetch('http://custody/produce-shop/secrets/arm', {
      method: 'POST', headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: O, command_id: 'm1-arm-drop', kind: 'buyer_drop_code', secret: drop }),
    });
    expect(armed.status).toBe(200);
    await armed.text();
    const chain = (await moi(logistics, code))['assignment'] as Json;
    const evidence = await riderCustody(custody, '/rider/delivery/evidence', code, {
      orderId: O, command_id: 'm1-e',
      bundle: { taskId: (chain['chaine'] as Json)['taskId'], packageId: PKG, custodySealId: chain['codeScelle'], artifacts: [], capturedAt: T },
    });
    expect(evidence.status, JSON.stringify(evidence.json)).toBe(200);
    const dropped = await riderCustody(custody, '/rider/delivery/drop', code, { orderId: O, command_id: 'm1-drop', dropCode: drop });
    expect(dropped.status, JSON.stringify(dropped.json)).toBe(200);
    expect(await custodian(custody, O)).toBe('customer');
    const closed = await attendre(
      async () => (await moi(logistics, code))['manifest'] as Json,
      (m) => m['status'] === 'closed',
      'the manifest never closed after the delivery',
    );
    expect(closed).toMatchObject({ status: 'closed', custodyInventory: [], orderedStops: [], currentStop: null });
    expect((await ops(logistics, '/ops/board'))['board']).not.toHaveProperty(['manifestes', RIDER]);
    expect(await desk(logistics).manifestes()).toEqual({ kind: 'ok', value: [] });
    // And the shift may end with nothing in hand, no exception needed.
    expect((await acts.endShift(code)).ok).toBe(true);
  }, 60_000);

  it('the doors refuse by name (nothing carried · unknown rider · malformed) — and a course the desk took back over a sealed package CANNOT leave the inventory: the package stays his, with no stop, and still blocks the end of service', async () => {
    const hold: Hold = { custodyCalls: [] };
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const custody = hold.custody!;
    const O = 'ord-manif-2';
    const RIDER = 'rider-manif-2';
    const PKG = `pkg-${O}`;
    const { code, assignmentId } = await courseConfiee(logistics, O, RIDER, 'm2');
    const { acts } = appPorts(logistics);

    // Nothing carried yet: an exception for nothing is refused, by name.
    expect(await desk(logistics).autoriserFinDeService(RIDER, { kind: 'reassignment', ref: 'rider-x' }, 'cmd-fs-2a')).toEqual({ kind: 'refused', reason: 'rider_not_carrying' });
    expect(await desk(logistics).autoriserFinDeService('rider-jamais-vu', { kind: 'reassignment', ref: 'x' }, 'cmd-fs-2b')).toEqual({ kind: 'refused', reason: 'unknown_rider' });
    expect((await opsRaw(logistics, '/ops/shift/exception', { command_id: 'cmd-fs-2c', riderId: RIDER, nextOwner: { kind: 'garage', ref: 'x' } })).status).toBe(400);
    expect((await opsRaw(logistics, '/ops/shift/exception', { command_id: 'cmd-fs-2d', riderId: RIDER, nextOwner: { kind: 'reassignment' } })).status).toBe(400);
    // …and the wrong key is the one 401.
    expect(await desk(logistics, 'wrong').autoriserFinDeService(RIDER, { kind: 'reassignment', ref: 'x' }, 'cmd-fs-2e')).toEqual({ kind: 'bad_key' });

    // Custody is his; the desk takes the course back on a FALSE assertion.
    await custodyAuCoursier(custody, logistics, O, code, 'm2');
    const takenBack = await ops(logistics, '/ops/assignment/take-back', { command_id: 'm2-tb', assignmentId, custodyNotBegun: true });
    expect(takenBack['ok'], JSON.stringify(takenBack)).toBe(true);
    expect((await moi(logistics, code))['assignment']).toBeNull();
    // THE LEDGER WINS: the package is still on his manifest, with no stop, and the manifest is not closed.
    const m = (await moi(logistics, code))['manifest'] as Json;
    expect(m).toMatchObject({ status: 'active', custodyInventory: [PKG], orderedStops: [], currentStop: null });
    expect(await desk(logistics).manifestes()).toMatchObject({ kind: 'ok', value: [{ riderId: RIDER, currentStop: null, stopsCount: 0, packageIds: [PKG] }] });
    // …and it still blocks the end of service until the desk gives it a road.
    expect(await acts.endShift(code)).toEqual({ ok: false, reason: 'refused', refus: 'custody_would_be_orphaned' });
    const authorized = await desk(logistics).autoriserFinDeService(RIDER, { kind: 'reassignment', ref: assignmentId }, 'cmd-fs-2f');
    expect(authorized).toEqual({ kind: 'ok', value: { status: 'autorisee', packageIds: [PKG] } });
    expect((await acts.endShift(code)).ok).toBe(true);
    expect((await ops(logistics, '/ops/shift/exceptions'))['exceptions']).toMatchObject([{ riderId: RIDER, packageIds: [PKG], dispatcherAckId: 'cmd-fs-2f', nextOwner: { kind: 'reassignment', ref: assignmentId } }]);
  }, 60_000);

  it('SILENCE FAILS CLOSED: with custody unreachable, the end of service is refused 503 by name and the shift stays on; the manifest says the reading is unknown and walks the course from the pickup', async () => {
    const hold: Hold = { custodyCalls: [] };
    spawnLogistics(hold, true);
    const logistics = hold.logistics!;
    const O = 'ord-manif-3';
    const RIDER = 'rider-manif-3';
    const { code } = await courseConfiee(logistics, O, RIDER, 'm3');
    const { acts } = appPorts(logistics);
    const raw = await riderDoor(logistics, '/rider/shift/end', code);
    expect(raw.status).toBe(503);
    expect(raw.json).toEqual({ ok: false, reason: 'custody_unverifiable' });
    expect((await acts.endShift(code)).ok).toBe(false);
    const rider = await moi(logistics, code);
    expect((rider['shift'] as Json)['status']).toBe('on_shift');
    const m = rider['manifest'] as Json;
    expect((m['currentStop'] as Json)['kind']).toBe('ramassage');
    expect((m['custodyReadings'] as Json[])[0]).toMatchObject({ orderId: O, reading: 'inconnue', asOf: null });
    // The desk cannot authorize on a silence either — refused BY NAME (the
    // port reads a 503 with a reason as a refusal, so the founder sees why).
    expect(await desk(logistics).autoriserFinDeService(RIDER, { kind: 'return_to_hub_task', ref: O }, 'cmd-fs-3')).toEqual({ kind: 'refused', reason: 'custody_unverifiable' });
  }, 30_000);
});
