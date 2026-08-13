import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';

/**
 * ═══ COURSE-LIVRÉE — the drop confirmation frees the rider, REAL against REAL ═══
 *
 * Founder (2026-08-13): « once delivery and everything is confirmé … on
 * rider's sera app make it close nicely and return to the initial state
 * waiting for another order ». The app half is proven (it resets when
 * `/rider/moi` answers `assignment: null`); this file proves the SERVICE half
 * across the real seam, in BOTH directions at once:
 *
 *   logistics ──/produce/order/open + /produce/secrets/arm──▶ custody
 *   custody  ──/produce/course-livree (the NEW wire)────────▶ logistics
 *
 * NO STUB CARRIES EITHER SEAM: the two Miniflares below each run the OTHER
 * Worker's shipped bundle behind the service binding, so the rider's whole
 * course — compose, assign, accept, machine-verified pickup, seal, drop —
 * runs on the same bytes wrangler deploys. The proof is asked of the
 * LOGISTICS ledger (the door's own idempotent state answer), never of the
 * response that happened to come back.
 */

const OPS = 'test-ops-course-livree';
const INTAKE = 'test-intake-course-livree';
const VERIFY = 'test-verify-course-livree';
const CUSTODY_OPS = 'test-custody-ops-course-livree';
const PRODUCE_KEY = 'test-produce-key-course-livree';
const SHOP_ARM_KEY = 'test-shop-arm-key-course-livree';
const LIVREE_KEY = 'test-course-livree-key-0001';

const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

/** Mutable holder so the logistics Worker's CUSTODY binding always reaches
 *  the CURRENT custody instance — the no-config rest test reboots custody
 *  with the secret armed, exactly as a founder `wrangler secret put` would. */
interface Hold {
  custody?: Miniflare;
  logistics?: Miniflare;
}

function spawnCustody(hold: Hold, dir: string, opts: { livreeWired?: boolean } = {}): Miniflare {
  const mf = new Miniflare({
    // Handed over as contents, not a path: workerd refuses a scriptPath that
    // climbs out of the starting directory (the vrai-produce precedent).
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: {
      // THE REAL LOGISTICS WORKER answers this binding — the new wire's
      // target, and the rider-code directory both.
      LOGISTICS: (request: Request) => hold.logistics!.dispatchFetch(request.url, request as never) as never,
    },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: CUSTODY_OPS,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      // SHOP_PROGRESS is deliberately UNWIRED: the eligibility wire rests
      // no_config while the course-livrée wire delivers — its own key, so
      // neither wire can mask the other's fate.
      ...(opts.livreeWired !== false ? { SERA_COURSE_LIVREE_SECRET: LIVREE_KEY } : {}),
    },
  });
  live.push(mf);
  hold.custody = mf;
  return mf;
}

function spawnLogistics(hold: Hold): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'course-livree-logistics-')),
    serviceBindings: {
      CUSTODY: (request: Request) => hold.custody!.dispatchFetch(request.url, request as never) as never,
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

async function intake(mf: Miniflare, path: string, body: unknown): Promise<Json> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, path).toBe(200);
  return (await res.json()) as Json;
}

/** The rider's own hand at the CUSTODY Worker — resolved against the REAL
 *  logistics directory over the binding, never a stubbed identity. */
async function riderCustody(mf: Miniflare, path: string, code: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function livreeDoor(mf: Miniflare, key: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch('http://logistics/produce/course-livree', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return { acts: httpShiftActs('http://logistics', net, fetchFn), session: httpRiderSession('http://logistics', net, fetchFn) };
}

const T = '2026-08-13T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-08-13T16:00:00.000Z' };
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

async function courseConfiee(mf: Miniflare, orderId: string, riderId: string, prefix: string) {
  await intake(mf, '/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
  await intake(mf, '/intake/readiness', { orderId, ready: true, asOf: T, supplierRef: 'supplier-livree-1' });
  const composed = await ops(mf, '/ops/task', { command_id: `${prefix}-t`, orderId, location: LOC, window: WIN });
  expect(composed['ok'], JSON.stringify(composed)).toBe(true);
  // Register only when this rider is new to the roster (the seam test
  // re-confies a course to a rider it removed and re-registers).
  const roster = (await ops(mf, '/ops/riders')) as { riders?: { riderId: string }[] };
  if (!(roster.riders ?? []).some((r) => r.riderId === riderId)) {
    await ops(mf, '/ops/riders', { riderId, displayName: riderId, phoneAlias: prefix });
    await ops(mf, '/ops/riders/certify', { riderId, certified: true });
  }
  const code = (await ops(mf, '/ops/rider-code/mint', { riderId }))['code'] as string;
  const { acts, session } = appPorts(mf);
  await acts.ackPrivacy(code);
  const shift = await acts.startShift(code);
  if (!shift.ok && shift.reason !== 'already_on_shift') throw new Error(`start refused: ${JSON.stringify(shift)}`);
  const granted = await ops(mf, '/ops/assign', { command_id: `${prefix}-a`, taskId: composed['taskId'], riderId });
  expect(granted['ok'], JSON.stringify(granted)).toBe(true);
  const assignmentId = (granted['assignment'] as Json)['assignmentId'] as string;
  const accepted = await acts.accepterCourse(code, assignmentId);
  expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
  return { session, acts, code, assignmentId, taskId: composed['taskId'] as string };
}

/** The chain is open on the REAL custody worker once its ledger answers. */
async function attendreChaine(custody: Miniflare, orderId: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    const res = await custody.dispatchFetch(`http://custody/ops/ledger?orderId=${orderId}`, {
      headers: { Authorization: `Bearer ${CUSTODY_OPS}` },
    });
    await res.text();
    if (res.status === 200) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('custody chain never opened');
}

/** `/rider/moi`, raw off the wire — the read the app's reset turns on. */
async function moiAssignment(mf: Miniflare, code: string): Promise<unknown> {
  const res = await mf.dispatchFetch('http://logistics/rider/moi', {
    headers: { Authorization: `Bearer ${code}` },
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as Json;
  return (json['rider'] as Json)['assignment'];
}

/** Drive the rider's real road on custody up to and INCLUDING the drop. */
async function routeJusquAuDrop(
  custody: Miniflare,
  logistics: Miniflare,
  orderId: string,
  code: string,
  prefix: string,
  dropCode: string,
): Promise<void> {
  await attendreChaine(custody, orderId);
  const { session } = appPorts(logistics);
  const moi = await session.signIn(code);
  if (!moi.ok) throw new Error('sign-in refused');
  const assignment = moi.session.assignment as unknown as Json;
  const pv = assignment['codeVerification'] as string;
  const sc = assignment['codeScelle'] as string;
  expect(typeof pv).toBe('string');
  expect(typeof sc).toBe('string');

  const verified = await riderCustody(custody, '/rider/verification', code, {
    orderId, command_id: `${prefix}-v`, presentedPickupCode: pv,
    checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${prefix}`,
  });
  expect(verified.status, JSON.stringify(verified.json)).toBe(200);

  const began = await riderCustody(custody, '/rider/custody/begin', code, {
    orderId, command_id: `${prefix}-b`, custodySealId: sc, sealPhotoRefs: [],
  });
  expect(began.status, JSON.stringify(began.json)).toBe(200);
  const chain = began.json['chain'] as Json;

  // Shop+ arms the buyer's code through ITS producer door — the real road.
  const armed = await custody.dispatchFetch('http://custody/produce-shop/secrets/arm', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, command_id: `${prefix}-arm-drop`, kind: 'buyer_drop_code', secret: dropCode }),
  });
  expect(armed.status).toBe(200);
  await armed.text();

  const evidence = await riderCustody(custody, '/rider/delivery/evidence', code, {
    orderId, command_id: `${prefix}-e`,
    bundle: {
      taskId: chain['task_id'], packageId: chain['package_id'], custodySealId: sc,
      artifacts: [], capturedAt: '2026-08-13T10:00:00.000Z',
    },
  });
  expect(evidence.status, JSON.stringify(evidence.json)).toBe(200);

  const drop = await riderCustody(custody, '/rider/delivery/drop', code, {
    orderId, command_id: `${prefix}-d`, dropCode,
  });
  expect(drop.status, JSON.stringify(drop.json)).toBe(200);
  expect(drop.json).toMatchObject({ ok: true, status: 'custody_with_customer' });
}

describe('COURSE-LIVRÉE — the seam, end to end, and the rider walks free', () => {
  it('drop on the REAL custody worker → the wire crosses → /rider/moi null, board clear, delivered on the ledger, remove unblocked, rider assignable again', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    spawnCustody(hold, mkdtempSync(join(tmpdir(), 'course-livree-custody-')));
    const logistics = hold.logistics!;
    const custody = hold.custody!;

    const O = 'ord-livree-seam-1';
    const RIDER = 'rider-livree-1';
    const { code, assignmentId } = await courseConfiee(logistics, O, RIDER, 's1');

    // Before the drop the course is live: the book still serves it.
    expect(await moiAssignment(logistics, code)).not.toBeNull();

    await routeJusquAuDrop(custody, logistics, O, code, 's1', 'DROP-LIVREE-0001');

    // ═══ THE WIRE: custody's alarm posts the confirmation; the LOGISTICS
    // ledger — not the response — is what must say the course ended. ═══
    let assignment: unknown = 'unread';
    for (let i = 0; i < 80; i += 1) {
      assignment = await moiAssignment(logistics, code);
      if (assignment === null) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(assignment, 'the rider must return to the waiting state').toBeNull();

    // The board's active assignments drop the course.
    const board = (await ops(logistics, '/ops/board'))['board'] as { assignments: Json[] };
    expect(board.assignments.some((a) => a['assignmentId'] === assignmentId)).toBe(false);

    // ASK THE LEDGER by name: the door's state answer reads 'delivered'.
    const probe = await livreeDoor(logistics, LIVREE_KEY, { orderId: O, command_id: 'probe-1', at: T });
    expect(probe.status).toBe(200);
    expect(probe.json).toMatchObject({ ok: true, status: 'deja_livree' });
    const recorded = probe.json['assignment'] as Json;
    expect(recorded).toMatchObject({ assignmentId, orderId: O, riderId: RIDER, status: 'delivered' });
    const deliveredAt = recorded['deliveredAt'];
    expect(typeof deliveredAt).toBe('string');

    // ═══ IDEMPOTENT REPLAY: a redelivered drop moves NOTHING — same instant
    // on the ledger after the replay, and the replayed answer says deja. ═══
    const redrop = await riderCustody(custody, '/rider/delivery/drop', code, {
      orderId: O, command_id: 's1-d', dropCode: 'DROP-LIVREE-0001',
    });
    expect(redrop.status).toBe(200);
    expect(redrop.json['duplicate']).toBe(true);
    await new Promise((r) => setTimeout(r, 1_000));
    const after = await livreeDoor(logistics, LIVREE_KEY, { orderId: O, command_id: 'probe-2', at: T });
    expect(after.json).toMatchObject({ ok: true, status: 'deja_livree' });
    expect((after.json['assignment'] as Json)['deliveredAt']).toBe(deliveredAt);

    // ═══ THE RIDER IS FREE. Remove stops refusing rider_carrying… ═══
    const removed = await ops(logistics, '/ops/riders/remove', { riderId: RIDER, custodyNotBegun: true });
    expect(removed).toMatchObject({ ok: true, status: 'removed' });

    // …and the same riderId is ASSIGNABLE again: if the delivered course's
    // anchored lease had not released (cause 'completed'), THE authority
    // would refuse this acquire 'rider_already_leased' whatever the roster
    // says. The outcome, not the guard.
    const again = await courseConfiee(logistics, 'ord-livree-seam-2', RIDER, 's2');
    expect(again.assignmentId).toBeTruthy();
    expect(await moiAssignment(logistics, again.code)).not.toBeNull();
  }, 120_000);

  it('an order the book never carried settles as aucune_course — 200, never a retrying refusal', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    spawnCustody(hold, mkdtempSync(join(tmpdir(), 'course-livree-custody-inconnu-')));
    const logistics = hold.logistics!;
    const res = await livreeDoor(logistics, LIVREE_KEY, { orderId: 'ord-jamais-vu', command_id: 'x-1', at: T });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, status: 'aucune_course' });
    // Malformed stays a 400 — a producer bug is a repeating refusal, honestly.
    expect((await livreeDoor(logistics, LIVREE_KEY, { orderId: 'ord-x' })).status).toBe(400);
  }, 60_000);
});

describe('the door — custody\'s key and nothing else opens it', () => {
  it('wrong key and no key are the one uniform 401; unwired fails CLOSED; a rider\'s own code opens neither road to it', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    spawnCustody(hold, mkdtempSync(join(tmpdir(), 'course-livree-custody-auth-')));
    const logistics = hold.logistics!;

    const wrong = await livreeDoor(logistics, 'not-the-key', { orderId: 'o', command_id: 'c', at: T });
    expect(wrong.status).toBe(401);
    const naked = await logistics.dispatchFetch('http://logistics/produce/course-livree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'o', command_id: 'c', at: T }),
    });
    expect(naked.status).toBe(401);
    expect(await naked.json()).toEqual(wrong.json);

    // A RIDER'S PERSONAL CODE — a valid one — opens neither road to this
    // door: a carrier must never validate their own delivery.
    await ops(logistics, '/ops/riders', { riderId: 'rider-auth-1', displayName: 'R', phoneAlias: 'a' });
    const code = (await ops(logistics, '/ops/rider-code/mint', { riderId: 'rider-auth-1' }))['code'] as string;
    const viaBearer = await livreeDoor(logistics, code, { orderId: 'o', command_id: 'c', at: T });
    expect(viaBearer.status).toBe(401);
    const viaRiderRoad = await logistics.dispatchFetch('http://logistics/rider/produce/course-livree', {
      method: 'POST',
      headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'o', command_id: 'c', at: T }),
    });
    expect(viaRiderRoad.status).toBe(404);
    await viaRiderRoad.text();

    // Unwired Worker: the right key is still refused — fail closed.
    const bare = new Miniflare({
      modules: true,
      scriptPath: 'dist-worker/worker.mjs',
      durableObjects: { LOGISTICS: 'LogisticsDO' },
      durableObjectsPersist: mkdtempSync(join(tmpdir(), 'course-livree-logistics-unwired-')),
      bindings: { SERA_OPS_SECRET: OPS },
    });
    live.push(bare);
    const closed = await livreeDoor(bare, LIVREE_KEY, { orderId: 'o', command_id: 'c', at: T });
    expect(closed.status).toBe(401);
  }, 60_000);
});

describe('the wire rests honestly without its key, and a replayed drop revives it', () => {
  it('no SERA_COURSE_LIVREE_SECRET on custody → the course stays live; key armed + drop replayed → the confirmation crosses', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    const custodyDir = mkdtempSync(join(tmpdir(), 'course-livree-custody-rest-'));
    spawnCustody(hold, custodyDir, { livreeWired: false });
    const logistics = hold.logistics!;

    const O = 'ord-livree-rest-1';
    const { code } = await courseConfiee(logistics, O, 'rider-livree-rest', 'r1');
    await routeJusquAuDrop(hold.custody!, logistics, O, code, 'r1', 'DROP-LIVREE-REST');

    // The wire has no key: the row must REST, and the course must stay live
    // on logistics — an honest state, never a silent half-delivery.
    await new Promise((r) => setTimeout(r, 2_000));
    expect(await moiAssignment(logistics, code)).not.toBeNull();

    // The founder arms the secret (custody reboots with it, same storage);
    // the redelivered drop is the recovery hook that revives the resting row.
    await hold.custody!.dispose();
    live = live.filter((m) => m !== hold.custody);
    spawnCustody(hold, custodyDir);
    const redrop = await riderCustody(hold.custody!, '/rider/delivery/drop', code, {
      orderId: O, command_id: 'r1-d', dropCode: 'DROP-LIVREE-REST',
    });
    expect(redrop.status).toBe(200);
    expect(redrop.json['duplicate']).toBe(true);

    let assignment: unknown = 'unread';
    for (let i = 0; i < 80; i += 1) {
      assignment = await moiAssignment(logistics, code);
      if (assignment === null) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(assignment, 'the revived wire must free the rider').toBeNull();
    const probe = await livreeDoor(logistics, LIVREE_KEY, { orderId: O, command_id: 'probe-rest', at: T });
    expect(probe.json).toMatchObject({ ok: true, status: 'deja_livree' });
    expect((probe.json['assignment'] as Json)['status']).toBe('delivered');
  }, 120_000);
});
