import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';

/**
 * ═══ RETOUR-VIVANT-1 — THE ROAD HOME, REAL AGAINST REAL ═══
 *
 * SE6.2's two-key handover needs two Workers to agree: CUSTODY holds the
 * rule (both keys or neither, custody courier → seller), LOGISTICS holds the
 * keys' plaintext and the course. The custody seam
 * (custody-service/test/retour-vivant.e2e.test.ts) proved the rule over a
 * contract-certified logistics stub; THIS file removes the stub. The two
 * Miniflares below each run the OTHER Worker's shipped bundle behind the
 * service binding, so the whole return — refusal, expiry, return-open, the
 * fifth wire, the two minted keys, the supplier's confirmation at the intake
 * door, the handover, the sixth wire, the rider walking free — runs on the
 * bytes wrangler deploys:
 *
 *   custody  ──/produce/retour-ouvert──────────▶ logistics  (mint two keys)
 *   logistics ──/produce/secrets/arm ×2────────▶ custody    (arm them, alarm)
 *   Boutik+  ──/intake/retour/verify──────────▶ logistics  (the supplier's word)
 *   rider    ──/rider/return/handover──────────▶ custody    (both keys)
 *   custody  ──/produce/course-retournee───────▶ logistics  (course `returned`)
 *
 * The proof is asked of the LEDGERS — custody's custodian, logistics' own
 * state answer on its produce door and its `/rider/moi` — never of the
 * response that happened to come back.
 */

const OPS = 'test-ops-retour-vivant';
const INTAKE = 'test-intake-retour-vivant';
const VERIFY = 'test-verify-retour-vivant';
const CUSTODY_OPS = 'test-custody-ops-retour-vivant';
const PRODUCE_KEY = 'test-produce-key-retour-vivant';
const SHOP_ARM_KEY = 'test-shop-arm-key-retour-vivant';
const LIVREE_KEY = 'test-course-livree-key-retour-vivant';
const SUPPLIER = 'supplier-retour-vivant-1';

const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

interface Hold {
  custody?: Miniflare;
  logistics?: Miniflare;
}

function spawnCustody(hold: Hold): Miniflare {
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'retour-vivant-custody-')),
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

function spawnLogistics(hold: Hold): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'retour-vivant-logistics-')),
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

/** The supplier's word, exactly as Boutik+'s fulfillment-service will post
 *  it: the intake key, the order, the code he was TOLD. Status comes home so
 *  the door's refusals can be pinned. */
async function supplierTypes(mf: Miniflare, key: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch('http://logistics/intake/retour/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function riderCustody(mf: Miniflare, path: string, code: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function produceDoor(mf: Miniflare, path: string, key: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
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

const T = '2026-09-17T09:00:00.000Z';
const T_PLUS_16 = '2026-09-17T09:16:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-09-17T16:00:00.000Z' };
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const DOOR = 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR';

async function courseConfiee(mf: Miniflare, orderId: string, riderId: string, prefix: string) {
  await intake(mf, '/intake/funding', { orderId, status: 'funded', paymentMode: DOOR, asOf: T });
  await intake(mf, '/intake/readiness', { orderId, ready: true, asOf: T, supplierRef: SUPPLIER });
  const composed = await ops(mf, '/ops/task', { command_id: `${prefix}-t`, orderId, location: LOC, window: WIN });
  expect(composed['ok'], JSON.stringify(composed)).toBe(true);
  const roster = (await ops(mf, '/ops/riders')) as { riders?: { riderId: string }[] };
  if (!(roster.riders ?? []).some((r) => r.riderId === riderId)) {
    await ops(mf, '/ops/riders', { riderId, displayName: riderId, phoneAlias: prefix });
    await ops(mf, '/ops/riders/certify', { riderId, certified: true });
  }
  const code = (await ops(mf, '/ops/rider-code/mint', { riderId }))['code'] as string;
  const { acts } = appPorts(mf);
  await acts.ackPrivacy(code);
  const shift = await acts.startShift(code);
  // A rider still on shift from his returned course starts nothing new —
  // the door names it, and it is the state this file wants him in.
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
    const res = await custody.dispatchFetch(`http://custody/ops/ledger?orderId=${orderId}`, {
      headers: { Authorization: `Bearer ${CUSTODY_OPS}` },
    });
    await res.text();
    if (res.status === 200) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('custody chain never opened');
}

async function custodian(custody: Miniflare, orderId: string): Promise<unknown> {
  const res = await custody.dispatchFetch(`http://custody/ops/ledger?orderId=${orderId}`, {
    headers: { Authorization: `Bearer ${CUSTODY_OPS}` },
  });
  return ((await res.json()) as Json)['currentCustodian'];
}

/** `/rider/moi`, raw off the wire — the read the app's return screen turns on. */
async function moiAssignment(mf: Miniflare, code: string): Promise<Json | null> {
  const res = await mf.dispatchFetch('http://logistics/rider/moi', { headers: { Authorization: `Bearer ${code}` } });
  expect(res.status).toBe(200);
  const json = (await res.json()) as Json;
  return (json['rider'] as Json)['assignment'] as Json | null;
}

async function attendreMoi(mf: Miniflare, code: string, done: (a: Json | null) => boolean, why: string): Promise<Json | null> {
  let a: Json | null = null;
  for (let i = 0; i < 80; i += 1) {
    a = await moiAssignment(mf, code);
    if (done(a)) return a;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${why} — last /rider/moi: ${JSON.stringify(a)}`);
}

/** The rider's road on custody, up to the door: verified, sealed, the
 *  buyer's code armed by Shop+, evidence recorded — the state the ladder
 *  and the inspection both start from. */
async function jusquaLaPorte(custody: Miniflare, logistics: Miniflare, orderId: string, code: string, prefix: string): Promise<void> {
  await attendreChaine(custody, orderId);
  const { session } = appPorts(logistics);
  const moi = await session.signIn(code);
  if (!moi.ok) throw new Error('sign-in refused');
  const assignment = moi.session.assignment as unknown as Json;
  const pv = assignment['codeVerification'] as string;
  const sc = assignment['codeScelle'] as string;
  const verified = await riderCustody(custody, '/rider/verification', code, {
    orderId, command_id: `${prefix}-v`, presentedPickupCode: pv, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${prefix}`,
  });
  expect(verified.status, JSON.stringify(verified.json)).toBe(200);
  const began = await riderCustody(custody, '/rider/custody/begin', code, { orderId, command_id: `${prefix}-b`, custodySealId: sc, sealPhotoRefs: [] });
  expect(began.status, JSON.stringify(began.json)).toBe(200);
  const chain = began.json['chain'] as Json;
  const armed = await custody.dispatchFetch('http://custody/produce-shop/secrets/arm', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, command_id: `${prefix}-arm-drop`, kind: 'buyer_drop_code', secret: `DROP-${prefix}` }),
  });
  expect(armed.status).toBe(200);
  await armed.text();
  const evidence = await riderCustody(custody, '/rider/delivery/evidence', code, {
    orderId, command_id: `${prefix}-e`,
    bundle: { taskId: chain['task_id'], packageId: chain['package_id'], custodySealId: sc, artifacts: [], capturedAt: T },
  });
  expect(evidence.status, JSON.stringify(evidence.json)).toBe(200);
}

const CODE_SHAPE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;

describe('RETOUR-VIVANT-1 — the road home crosses BOTH real Workers', () => {
  it('buyer-fault ladder → return opened on custody → logistics mints the keys → the supplier confirms the rider’s code → both keys open the handover → custody with the seller → the course closes `returned` → the rider is free and assignable again', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const custody = hold.custody!;

    const O = 'ord-retour-vivant-1';
    const RIDER = 'rider-retour-vivant-1';
    const { code, assignmentId } = await courseConfiee(logistics, O, RIDER, 'rv1');

    // No return is open: the supplier's door judges nothing, and the session
    // carries no key — honest nulls, never a key nobody minted.
    const avant = await supplierTypes(logistics, INTAKE, { command_id: 'sv-0', orderId: O, code: 'ABC-DEF' });
    expect(avant.status).toBe(200);
    expect(avant.json).toEqual({ ok: true, verdict: 'non_confirme' });
    const moiAvant = await moiAssignment(logistics, code);
    expect(moiAvant).toMatchObject({ codeRetour: null, retourConfirmeAt: null, codeRetourFournisseur: null });

    await jusquaLaPorte(custody, logistics, O, code, 'rv1');

    // ═══ THE LADDER, on the real custody Worker: one window, expired unresolved
    // on an escalating reason → the return arm, buyer fault. ═══
    const refused = await riderCustody(custody, '/rider/door/refusal', code, { orderId: O, command_id: 'rv1-ref', reasonCode: 'insufficient_balance', at: T });
    expect(refused.status, JSON.stringify(refused.json)).toBe(200);
    expect(refused.json).toMatchObject({ ok: true, kind: 'window_opened' });
    const expired = await riderCustody(custody, '/rider/door/expire', code, { orderId: O, command_id: 'rv1-exp', at: T_PLUS_16 });
    expect(expired.status, JSON.stringify(expired.json)).toBe(200);
    expect(expired.json['outcome']).toMatchObject({ family: 'return', faultClass: 'buyer' });
    // The NEW return seal (§6.4) rides the session from the first poll,
    // minted by the REAL logistics beside the outbound seal, its own shape.
    const scelleRetour = (await moiAssignment(logistics, code))!['codeScelleRetour'] as string;
    expect(scelleRetour).toMatch(/^RS-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(scelleRetour).not.toBe(moiAvant!['codeScelle']);
    const opened = await riderCustody(custody, '/rider/return/open', code, { orderId: O, command_id: 'rv1-ret', returnSealId: scelleRetour, at: T_PLUS_16 });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    expect(opened.json).toMatchObject({ ok: true, kind: 'return_opened' });

    // ═══ THE FIFTH WIRE crossed to the REAL logistics: it minted the rider's
    // key onto his session. The seller's key is NOT there yet — the supplier
    // has not spoken. ═══
    const ouvert = await attendreMoi(logistics, code, (a) => a !== null && typeof a['codeRetour'] === 'string', 'the retour-ouvert wire never reached logistics');
    const codeRetour = ouvert!['codeRetour'] as string;
    expect(codeRetour).toMatch(CODE_SHAPE);
    expect(ouvert).toMatchObject({ assignmentId, retourConfirmeAt: null, codeRetourFournisseur: null });

    // A wrong code at the supplier's counter: not confirmed, nothing released.
    const faux = await supplierTypes(logistics, INTAKE, { command_id: 'sv-1', orderId: O, code: 'ZZZ-ZZZ' });
    expect(faux.json).toEqual({ ok: true, verdict: 'non_confirme' });
    expect(await moiAssignment(logistics, code)).toMatchObject({ retourConfirmeAt: null, codeRetourFournisseur: null });
    // The intake door answers a VERDICT and never a key.
    expect(JSON.stringify(faux.json)).not.toContain(codeRetour);

    // The rider SAYS his code; the supplier TYPES it (case and dashes
    // forgiven, characters never): confirmed → his acceptance key is
    // released onto the rider's session.
    const vrai = await supplierTypes(logistics, INTAKE, { command_id: 'sv-2', orderId: O, code: codeRetour.toLowerCase().replace('-', ' ') });
    expect(vrai.json).toEqual({ ok: true, verdict: 'confirme' });
    expect(JSON.stringify(vrai.json)).not.toMatch(/code[A-Z]/);
    const confirme = await moiAssignment(logistics, code);
    expect(typeof confirme!['retourConfirmeAt']).toBe('string');
    const codeFournisseur = confirme!['codeRetourFournisseur'] as string;
    expect(codeFournisseur).toMatch(CODE_SHAPE);
    expect(codeFournisseur).not.toBe(codeRetour);
    // First-wins: retyping re-hears « confirmé », the instant never moves.
    expect((await supplierTypes(logistics, INTAKE, { command_id: 'sv-3', orderId: O, code: codeRetour })).json).toEqual({ ok: true, verdict: 'confirme' });
    expect((await moiAssignment(logistics, code))!['retourConfirmeAt']).toBe(confirme!['retourConfirmeAt']);

    // ═══ THE HANDOVER on custody with the two keys LOGISTICS minted and
    // armed from its alarm. A refused attempt burns nothing, so each retry
    // is a fresh act until the arm has landed — exactly a rider re-tapping. ═══
    expect(await custodian(custody, O)).toBe(`courier:${RIDER}`);
    let home: { status: number; json: Json } = { status: 0, json: {} };
    for (let i = 0; i < 40; i += 1) {
      home = await riderCustody(custody, '/rider/return/handover', code, { orderId: O, command_id: `rv1-ho-${i}`, sellerKey: codeFournisseur, riderKey: codeRetour, at: T_PLUS_16 });
      if (home.status === 200) break;
      expect(home.json).toMatchObject({ ok: false, reason: 'return_two_key_refused' });
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(home.status, JSON.stringify(home.json)).toBe(200);
    expect(home.json).toMatchObject({ ok: true, kind: 'returned_to_supplier' });
    // THE CUSTODY LEDGER'S WORD: the package is with its seller, by the id
    // logistics' readiness fact named.
    expect(await custodian(custody, O)).toBe(`seller:${SUPPLIER}`);

    // ═══ THE SIXTH WIRE: the LOGISTICS ledger closes the course and walks
    // the rider back to waiting. ═══
    await attendreMoi(logistics, code, (a) => a === null, 'the course-retournée wire never freed the rider');
    const board = (await ops(logistics, '/ops/board'))['board'] as { assignments: Json[] };
    expect(board.assignments.some((a) => a['assignmentId'] === assignmentId)).toBe(false);
    // Ask the door by name: its idempotent state answer reads `returned`, and
    // a redelivery moves nothing.
    const probe = await produceDoor(logistics, '/produce/course-retournee', LIVREE_KEY, { orderId: O, command_id: 'probe-rv1', at: T_PLUS_16 });
    expect(probe.status).toBe(200);
    expect(probe.json).toMatchObject({ ok: true, status: 'deja_retournee', assignment: { assignmentId, orderId: O, riderId: RIDER, status: 'returned' } });
    // …and a re-opened return for the same closed course settles by name too.
    const reouvert = await produceDoor(logistics, '/produce/retour-ouvert', LIVREE_KEY, { orderId: O, command_id: 'probe-rv1-o', at: T_PLUS_16 });
    expect(reouvert.json).toEqual({ ok: true, status: 'aucune_course' });

    // The buyer's code can no longer move the package anywhere.
    const drop = await riderCustody(custody, '/rider/delivery/drop', code, { orderId: O, command_id: 'rv1-d-late', dropCode: 'DROP-rv1' });
    expect(drop.status).toBe(409);

    // ═══ THE RIDER IS FREE: the same rider takes a new course — if the
    // returned course's lease had not released, the authority would refuse
    // this acquire whatever the roster says. ═══
    const again = await courseConfiee(logistics, 'ord-retour-vivant-2', RIDER, 'rv2');
    expect(again.assignmentId).toBeTruthy();
    expect(await moiAssignment(logistics, again.code)).toMatchObject({ assignmentId: again.assignmentId, codeRetour: null });
  }, 120_000);

  it('the doors: the supplier’s verdict door is the intake key’s alone; the two produce doors are custody’s key’s alone and settle unknown orders by name; the rider road opens none of them', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;

    // Intake door: the ops key does not open it, nor does no key.
    expect((await supplierTypes(logistics, OPS, { command_id: 'x', orderId: 'o', code: 'AAA-AAA' })).status).toBe(401);
    expect((await supplierTypes(logistics, 'not-the-key', { command_id: 'x', orderId: 'o', code: 'AAA-AAA' })).status).toBe(401);
    // An order it never carried: a verdict, never a throw — and never « confirmé ».
    expect((await supplierTypes(logistics, INTAKE, { command_id: 'x', orderId: 'ord-jamais-vu', code: 'AAA-AAA' })).json).toEqual({ ok: true, verdict: 'non_confirme' });
    expect((await supplierTypes(logistics, INTAKE, { command_id: 'x', orderId: 'o' })).status).toBe(400);

    // Produce doors: custody's key, and only it.
    for (const path of ['/produce/retour-ouvert', '/produce/course-retournee']) {
      expect((await produceDoor(logistics, path, 'not-the-key', { orderId: 'o', command_id: 'c', at: T })).status).toBe(401);
      expect((await produceDoor(logistics, path, INTAKE, { orderId: 'o', command_id: 'c', at: T })).status).toBe(401);
      const unknown = await produceDoor(logistics, path, LIVREE_KEY, { orderId: 'ord-jamais-vu', command_id: 'c', at: T });
      expect(unknown.status).toBe(200);
      expect(unknown.json).toEqual({ ok: true, status: 'aucune_course' });
      expect((await produceDoor(logistics, path, LIVREE_KEY, { orderId: 'o', command_id: 'c' })).status).toBe(400);
    }

    // A rider's personal code — a valid one — opens none of the three.
    await ops(logistics, '/ops/riders', { riderId: 'rider-doors-1', displayName: 'R', phoneAlias: 'a' });
    const code = (await ops(logistics, '/ops/rider-code/mint', { riderId: 'rider-doors-1' }))['code'] as string;
    for (const path of ['/rider/produce/retour-ouvert', '/rider/produce/course-retournee', '/rider/intake/retour/verify']) {
      const res = await logistics.dispatchFetch(`http://logistics${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'o', command_id: 'c', at: T, code: 'AAA-AAA' }),
      });
      expect(res.status, path).toBe(404);
      await res.text();
    }
  }, 60_000);
});
