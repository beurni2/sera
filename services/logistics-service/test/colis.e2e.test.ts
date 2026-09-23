import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';

/**
 * ═══ COLIS-FOURNISSEUR-1 — ONE COURSE CARRIES A PACKAGE, REAL AGAINST REAL ═══
 *
 * Founder ruling 2026-09-23 (canon 3.20.0, Sera-Build-Spec SE3): « a package
 * may hold the orders of ONE supplier, for ONE buyer, to ONE address, paid
 * together; it is still one job — one pickup, one drop, one current stop —
 * and each order keeps its own custody file, its own inspection at the door
 * and its own drop. » Decision (c): she refuses one article at the door and
 * keeps the rest; the refused one goes back sealed on its own.
 *
 * Both Workers run their SHIPPED bundles, each behind the other's service
 * binding, so every wire of the package's life crosses for real:
 *
 *   Shop+    ──/intake/funding (+ package)──────▶ logistics (one package, write-once)
 *   founder  ──/ops/task · /ops/assign───────────▶ logistics (ONE task, ONE course)
 *   logistics──/produce/order/open + arm ×2─────▶ custody   (one chain PER order)
 *   rider    ──verify · seal · evidence ×2──────▶ custody   (each article's ledger)
 *   rider    ──inspection A ok · B refused──────▶ custody
 *   custody  ──/produce/retour-ouvert (B)───────▶ logistics (the return bag)
 *   rider    ──drop A───────────────────────────▶ custody
 *   custody  ──/produce/course-livree (A)───────▶ logistics (course stays open)
 *   rider    ──handover B (two keys)────────────▶ custody
 *   custody  ──/produce/course-retournee (B)────▶ logistics (course closes)
 *
 * The proof is asked of the LEDGERS — custody's custodian per article, the
 * logistics book's own `/rider/moi`, board and produce-door answers — never of
 * the response that happened to come back.
 */

const OPS = 'test-ops-colis';
const INTAKE = 'test-intake-colis';
const VERIFY = 'test-verify-colis';
const CUSTODY_OPS = 'test-custody-ops-colis';
const PRODUCE_KEY = 'test-produce-key-colis';
const SHOP_ARM_KEY = 'test-shop-arm-key-colis';
const LIVREE_KEY = 'test-course-livree-key-colis';
const SUPPLIER = 'supplier-colis-1';

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
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'colis-custody-')),
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
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'colis-logistics-')),
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

async function ops(mf: Miniflare, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function intake(mf: Miniflare, path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
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

async function produceDoor(mf: Miniflare, path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LIVREE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return { acts: httpShiftActs('http://logistics', net, fetchFn), session: httpRiderSession('http://logistics', net, fetchFn) };
}

async function attendre<T>(lire: () => Promise<T>, fini: (v: T) => boolean, pourquoi: string): Promise<T> {
  let v: T = await lire();
  for (let i = 0; i < 80 && !fini(v); i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    v = await lire();
  }
  if (!fini(v)) throw new Error(`${pourquoi} — last: ${JSON.stringify(v)}`);
  return v;
}

async function ledger(custody: Miniflare, orderId: string): Promise<{ status: number; json: Json }> {
  const res = await custody.dispatchFetch(`http://custody/ops/ledger?orderId=${orderId}`, {
    headers: { Authorization: `Bearer ${CUSTODY_OPS}` },
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function moi(mf: Miniflare, code: string): Promise<Json | null> {
  const res = await mf.dispatchFetch('http://logistics/rider/moi', { headers: { Authorization: `Bearer ${code}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { rider: Json }).rider['assignment'] as Json | null;
}

const T = '2026-09-23T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-09-23T16:00:00.000Z' };
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

describe('COLIS-FOURNISSEUR-1 — one course, one package, several orders, across BOTH real Workers', () => {
  it('the package is heard whole before it is composable → ONE task and ONE course → a chain per article, one pickup code → she keeps A and refuses B → A delivered, the course stays open → B home on the two keys → the course closes `returned`, each article’s custodian named by its own ledger', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const custody = hold.custody!;
    const A = 'ord-colis-seam-a';
    const B = 'ord-colis-seam-b';
    const COLIS = { packageId: 'col-seam-1', orderIds: [A, B] };
    const RIDER = 'rider-colis-1';

    // ═══ HEARD WHOLE. A alone is not a course: the bag waits for B's word. ═══
    expect((await intake(logistics, '/intake/funding', { orderId: A, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T, package: COLIS })).status).toBe(200);
    expect((await intake(logistics, '/intake/readiness', { orderId: A, ready: true, asOf: T, supplierRef: SUPPLIER })).status).toBe(200);
    const tot = await ops(logistics, '/ops/task', { command_id: 'colis-t0', orderId: A, location: LOC, window: WIN });
    expect(tot.status).toBe(422);
    expect(tot.json).toMatchObject({ ok: false, reason: 'colis_incomplet' });
    expect(((await ops(logistics, '/ops/a-preparer')).json['attente'] as Json[]).length).toBe(0);
    // A package names itself once: a later fact that names another is refused by name.
    const autre = await intake(logistics, '/intake/funding', { orderId: A, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T, package: { packageId: 'col-autre', orderIds: [A, 'ord-x'] } });
    expect(autre).toMatchObject({ status: 409, json: { ok: false, reason: 'package_contradicts_stored' } });
    // A package that does not list the order it rides on is not a package.
    const horsColis = await intake(logistics, '/intake/funding', { orderId: 'ord-seul', status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T, package: { packageId: 'col-z', orderIds: ['ord-y', 'ord-w'] } });
    expect(horsColis).toMatchObject({ status: 400, json: { ok: false, reason: 'package_malformed' } });

    expect((await intake(logistics, '/intake/funding', { orderId: B, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T, package: COLIS })).status).toBe(200);
    expect((await intake(logistics, '/intake/readiness', { orderId: B, ready: true, asOf: T, supplierRef: SUPPLIER })).status).toBe(200);

    // ONE line for the founder, under the package's first order.
    const attente = (await ops(logistics, '/ops/a-preparer')).json['attente'] as Json[];
    expect(attente).toEqual([expect.objectContaining({ orderId: A, colis: { packageId: 'col-seam-1', orderIds: [A, B] } })]);

    // Composed from EITHER article, it is the package's one task.
    const composed = await ops(logistics, '/ops/task', {
      command_id: 'colis-t1', orderId: B, location: LOC, window: WIN,
      articles: [{ orderId: A, libelle: 'Le pagne wax' }, { orderId: B, libelle: 'Les sandales' }],
    });
    expect(composed.status, JSON.stringify(composed.json)).toBe(200);
    expect(composed.json).toMatchObject({ ok: true, admitted: true, colis: { orderIds: [A, B] } });
    const deux = await ops(logistics, '/ops/task', { command_id: 'colis-t2', orderId: A, location: LOC, window: WIN });
    expect(deux, 'a second compose from the other article is the same bag').toMatchObject({ status: 409, json: { reason: 'order_already_has_task' } });
    expect(((await ops(logistics, '/ops/a-preparer')).json['attente'] as Json[]).length).toBe(0);

    // ═══ ONE COURSE. ═══
    await ops(logistics, '/ops/riders', { riderId: RIDER, displayName: RIDER, phoneAlias: 'colis' });
    await ops(logistics, '/ops/riders/certify', { riderId: RIDER, certified: true });
    const code = (await ops(logistics, '/ops/rider-code/mint', { riderId: RIDER })).json['code'] as string;
    const { acts, session } = appPorts(logistics);
    await acts.ackPrivacy(code);
    expect((await acts.startShift(code)).ok).toBe(true);
    const granted = await ops(logistics, '/ops/assign', { command_id: 'colis-a', taskId: composed.json['taskId'], riderId: RIDER });
    expect(granted.json['ok'], JSON.stringify(granted.json)).toBe(true);
    const assignmentId = (granted.json['assignment'] as Json)['assignmentId'] as string;
    expect((await acts.accepterCourse(code, assignmentId)).ok).toBe(true);

    // A chain opens on custody for EACH article, each under its own package id.
    for (const o of [A, B]) await attendre(() => ledger(custody, o), (r) => r.status === 200, `chain ${o} never opened`);

    // The session, through the APP's own parser: one course, both articles.
    const signed = await session.signIn(code);
    if (!signed.ok) throw new Error('sign-in refused');
    const a = signed.session.assignment!;
    expect(a.orderId).toBe(A);
    expect(a.colis).toEqual({
      packageId: 'col-seam-1',
      articles: [
        { orderId: A, libelle: 'Le pagne wax', chaine: { taskId: composed.json['taskId'], packageId: `pkg-${A}` }, etat: 'en_cours' },
        { orderId: B, libelle: 'Les sandales', chaine: { taskId: composed.json['taskId'], packageId: `pkg-${B}` }, etat: 'en_cours' },
      ],
    });
    // ONE pickup code at the stall, confirmed from either article's card.
    const stall = await intake(logistics, '/intake/ramassage/verify', { command_id: 'colis-r', orderId: B, code: a.codeRamassage });
    expect(stall.json).toEqual({ ok: true, verdict: 'confirme' });

    // ═══ EACH ARTICLE'S OWN LEDGER, one code, one seal. ═══
    const pv = a.codeVerification!;
    const sc = a.codeScelle!;
    const chaines: Record<string, Json> = {};
    for (const o of [A, B]) {
      const v = await riderCustody(custody, '/rider/verification', code, { orderId: o, command_id: `v-${o}`, presentedPickupCode: pv, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${o}` });
      expect(v.json, `verification ${o}`).toMatchObject({ ok: true, kind: 'accepted' });
      const b = await riderCustody(custody, '/rider/custody/begin', code, { orderId: o, command_id: `b-${o}`, custodySealId: sc, sealPhotoRefs: [] });
      expect(b.json, `seal ${o}`).toMatchObject({ ok: true, status: 'custody_with_courier' });
      chaines[o] = b.json['chain'] as Json;
      expect(chaines[o]).toMatchObject({ package_id: `pkg-${o}`, task_id: composed.json['taskId'] });
      // Shop+ arms the ONE buyer code on each article's file.
      const armed = await custody.dispatchFetch('http://custody/produce-shop/secrets/arm', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: o, command_id: `arm-remise-${o}`, kind: 'buyer_drop_code', secret: 'DROP-COLIS-1' }),
      });
      expect(armed.status).toBe(200);
      await armed.text();
      const e = await riderCustody(custody, '/rider/delivery/evidence', code, {
        orderId: o, command_id: `e-${o}`,
        bundle: { taskId: chaines[o]!['task_id'], packageId: chaines[o]!['package_id'], custodySealId: sc, artifacts: [], capturedAt: T },
      });
      expect(e.json, `evidence ${o}`).toMatchObject({ ok: true, status: 'evidence_recorded' });
    }
    for (const o of [A, B]) expect((await ledger(custody, o)).json['currentCustodian'], o).toBe(`courier:${RIDER}`);

    // ═══ THE DOOR: A kept, B refused and re-sealed for home. ═══
    const okA = await riderCustody(custody, '/rider/door/inspection', code, {
      orderId: A, command_id: 'i-a', inspectionCategory: 'uncategorised_conservative', packageOpened: false, manufacturerSealOpened: false,
      custodySealIntact: true, buyerAccepts: true, startedAt: T, completedAt: T, evidenceBundleId: `sans-photo-porte-${A}`,
    });
    expect(okA.json).toMatchObject({ ok: true, kind: 'accepted' });
    const refusB = await riderCustody(custody, '/rider/door/inspection', code, {
      orderId: B, command_id: 'i-b', inspectionCategory: 'uncategorised_conservative', packageOpened: false, manufacturerSealOpened: false,
      custodySealIntact: true, buyerAccepts: false, refusalColumn: 'valid', startedAt: T, completedAt: T, evidenceBundleId: `sans-photo-porte-${B}`,
    });
    expect(refusB.json).toMatchObject({ ok: true, kind: 'valid_rejection', faultClass: 'seller' });
    const retourB = await riderCustody(custody, '/rider/return/open', code, { orderId: B, command_id: 'r-b', returnSealId: a.codeScelleRetour });
    expect(retourB.json).toMatchObject({ ok: true, kind: 'return_opened' });

    // The fifth wire crossed: B is in the return bag, the rider's key minted.
    const enRetour = await attendre(() => moi(logistics, code), (x) => typeof x?.['codeRetour'] === 'string', 'retour-ouvert never reached logistics');
    expect((enRetour!['colis'] as { articles: Json[] }).articles.map((x) => x['etat'])).toEqual(['en_cours', 'en_retour']);

    // ═══ A DELIVERED — and the course is NOT over: B still rides with him. ═══
    const dropA = await riderCustody(custody, '/rider/delivery/drop', code, { orderId: A, command_id: 'd-a', dropCode: 'DROP-COLIS-1' });
    expect(dropA.json).toMatchObject({ ok: true, status: 'custody_with_customer' });
    const apresA = await attendre(
      () => moi(logistics, code),
      (x) => (x?.['colis'] as { articles: Json[] } | undefined)?.articles[0]?.['etat'] === 'livree',
      'course-livree(A) never reached the package',
    );
    expect(apresA, 'the course is still his').not.toBeNull();
    expect((apresA!['colis'] as { articles: Json[] }).articles.map((x) => x['etat'])).toEqual(['livree', 'en_retour']);
    // Ask the book by name: A settled, the course open.
    const rejeu = await produceDoor(logistics, '/produce/course-livree', { command_id: 'probe-a', orderId: A, at: T });
    expect(rejeu.json).toEqual({ ok: true, status: 'deja_livree' });
    const board = (await ops(logistics, '/ops/board')).json['board'] as { assignments: Json[]; colisEnCourse: Record<string, Json> };
    expect(board.assignments.map((x) => x['assignmentId'])).toContain(assignmentId);
    expect(board.colisEnCourse[assignmentId]).toMatchObject({ orderIds: [A, B], reglement: { [A]: 'livree' } });

    // ═══ B HOME on the two keys, armed on B's own file. ═══
    const confirme = await intake(logistics, '/intake/retour/verify', { command_id: 'sv-b', orderId: B, code: enRetour!['codeRetour'] });
    expect(confirme.json).toEqual({ ok: true, verdict: 'confirme' });
    const cles = await attendre(() => moi(logistics, code), (x) => typeof x?.['codeRetourFournisseur'] === 'string', 'the seller key never released');
    const handover = await attendre(
      () => riderCustody(custody, '/rider/return/handover', code, { orderId: B, command_id: `h-b-${Date.now()}`, sellerKey: cles!['codeRetourFournisseur'], riderKey: cles!['codeRetour'] }),
      (r) => r.json['kind'] === 'returned_to_supplier',
      'the two keys never opened B',
    );
    expect(handover.json).toMatchObject({ ok: true, kind: 'returned_to_supplier' });

    // The sixth wire crossed: the LAST article settled, so the ONE course closes.
    await attendre(() => moi(logistics, code), (x) => x === null, 'the package course never closed');
    const fin = await produceDoor(logistics, '/produce/course-retournee', { command_id: 'probe-b', orderId: B, at: T });
    expect(fin.json).toEqual({ ok: true, status: 'deja_retournee' });

    // ═══ EACH ARTICLE'S CUSTODIAN, by its OWN ledger (SE-I04 per article). ═══
    expect((await ledger(custody, A)).json['currentCustodian']).toBe('customer');
    expect((await ledger(custody, B)).json['currentCustodian']).toBe(`seller:${SUPPLIER}`);
  }, 120_000);

  it('PAY AT THE DOOR (decision d): she keeps both, ONE door payment for both, charged under its collection — each article crosses only when the provider’s own confirmation lists it', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const custody = hold.custody!;
    const A = 'ord-colis-porte-a';
    const B = 'ord-colis-porte-b';
    const COLIS = { packageId: 'col-porte-1', orderIds: [A, B] };
    const RIDER = 'rider-colis-porte';
    const MODE = 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR';
    for (const o of [A, B]) {
      expect((await intake(logistics, '/intake/funding', { orderId: o, status: 'funded', paymentMode: MODE, asOf: T, package: COLIS })).status).toBe(200);
      expect((await intake(logistics, '/intake/readiness', { orderId: o, ready: true, asOf: T, supplierRef: SUPPLIER })).status).toBe(200);
    }
    const composed = await ops(logistics, '/ops/task', { command_id: 'porte-t1', orderId: A, location: LOC, window: WIN });
    expect(composed.status, JSON.stringify(composed.json)).toBe(200);
    await ops(logistics, '/ops/riders', { riderId: RIDER, displayName: RIDER, phoneAlias: 'porte' });
    await ops(logistics, '/ops/riders/certify', { riderId: RIDER, certified: true });
    const code = (await ops(logistics, '/ops/rider-code/mint', { riderId: RIDER })).json['code'] as string;
    const { acts, session } = appPorts(logistics);
    await acts.ackPrivacy(code);
    expect((await acts.startShift(code)).ok).toBe(true);
    const granted = await ops(logistics, '/ops/assign', { command_id: 'porte-a', taskId: composed.json['taskId'], riderId: RIDER });
    expect(granted.json['ok'], JSON.stringify(granted.json)).toBe(true);
    expect((await acts.accepterCourse(code, (granted.json['assignment'] as Json)['assignmentId'] as string)).ok).toBe(true);
    for (const o of [A, B]) await attendre(() => ledger(custody, o), (r) => r.status === 200, `chain ${o} never opened`);
    const signed = await session.signIn(code);
    if (!signed.ok) throw new Error('sign-in refused');
    const a = signed.session.assignment!;
    for (const o of [A, B]) {
      expect((await riderCustody(custody, '/rider/verification', code, { orderId: o, command_id: `v-${o}`, presentedPickupCode: a.codeVerification, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${o}` })).json).toMatchObject({ ok: true, kind: 'accepted' });
      const b = await riderCustody(custody, '/rider/custody/begin', code, { orderId: o, command_id: `b-${o}`, custodySealId: a.codeScelle, sealPhotoRefs: [] });
      expect(b.json).toMatchObject({ ok: true, status: 'custody_with_courier' });
      const chaine = b.json['chain'] as Json;
      const armed = await custody.dispatchFetch('http://custody/produce-shop/secrets/arm', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: o, command_id: `arm-remise-${o}`, kind: 'buyer_drop_code', secret: 'DROP-PORTE-1' }),
      });
      expect(armed.status).toBe(200);
      await armed.text();
      expect((await riderCustody(custody, '/rider/delivery/evidence', code, {
        orderId: o, command_id: `e-${o}`,
        bundle: { taskId: chaine['task_id'], packageId: chaine['package_id'], custodySealId: a.codeScelle, artifacts: [], capturedAt: T },
      })).json).toMatchObject({ ok: true, status: 'evidence_recorded' });
      expect((await riderCustody(custody, '/rider/door/inspection', code, {
        orderId: o, command_id: `i-${o}`, inspectionCategory: 'uncategorised_conservative', packageOpened: false, manufacturerSealOpened: false,
        custodySealIntact: true, buyerAccepts: true, startedAt: T, completedAt: T, evidenceBundleId: `sans-photo-porte-${o}`,
      })).json).toMatchObject({ ok: true, kind: 'accepted' });
    }

    // The provider's confirmation of the package's ONE collection, as Shop+
    // forwards it verbatim to each article: the collection's reference, and
    // the articles it paid for, echoed from the charge.
    const confirmation = (commandId: string, parts: string[]) => ({
      name: 'payment.door_leg_confirmed.v1',
      envelope: { command_id: commandId, correlation_id: 'corr-grp-porte-1', aggregateVersion: 1, actor: 'payment-provider:sandbox', serverTime: T, version: '1' },
      payload: {
        provider: 'sandbox-provider', payment_attempt_id: 'payatt-porte-1', collectRef: 'collect-porte-1', amount: 10_000, fee: 0,
        status: 'held', order_id: 'grp-porte-1-porte-1', redelivery: 0, parts: parts.map((order_id) => ({ order_id, amount: 5_000 })),
      },
    });
    const signal = (o: string, commandId: string, parts: string[]) =>
      custody.dispatchFetch('http://custody/produce-shop/door-signal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: o, command_id: `door-signal-${commandId}-${o}`, event: confirmation(commandId, parts) }),
      }).then(async (r) => ({ status: r.status, json: (await r.json()) as Json }));

    // A collection that paid for OTHER articles is not B's payment: B waits.
    expect(await signal(B, 'whk-autre', [A, 'ord-ailleurs'])).toMatchObject({ status: 409, json: { ok: false, reason: 'door_signal_not_awaited' } });
    expect((await riderCustody(custody, '/rider/delivery/drop', code, { orderId: B, command_id: 'd-b-tot', dropCode: 'DROP-PORTE-1' })).json)
      .toMatchObject({ ok: false, reason: 'door_payment_not_confirmed' });

    // The collection that paid for both: each article crosses on its own drop.
    for (const o of [A, B]) expect(await signal(o, 'whk-colis', [A, B])).toMatchObject({ status: 200, json: { ok: true } });
    for (const o of [A, B]) {
      expect((await riderCustody(custody, '/rider/delivery/drop', code, { orderId: o, command_id: `d-${o}`, dropCode: 'DROP-PORTE-1' })).json, `drop ${o}`)
        .toMatchObject({ ok: true, status: 'custody_with_customer' });
      expect((await ledger(custody, o)).json['currentCustodian'], o).toBe('customer');
    }
    await attendre(() => moi(logistics, code), (x) => x === null, 'the package course never closed');
  }, 120_000);

  it('ONE supplier, ONE mode: a package whose readiness names two suppliers is refused by name, and nothing is composed', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const C = 'ord-colis-seam-c';
    const D = 'ord-colis-seam-d';
    const COLIS = { packageId: 'col-seam-2', orderIds: [C, D] };
    for (const o of [C, D]) {
      await intake(logistics, '/intake/funding', { orderId: o, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T, package: COLIS });
    }
    await intake(logistics, '/intake/readiness', { orderId: C, ready: true, asOf: T, supplierRef: 'supplier-un' });
    await intake(logistics, '/intake/readiness', { orderId: D, ready: true, asOf: T, supplierRef: 'supplier-deux' });
    const composed = await ops(logistics, '/ops/task', { command_id: 'colis2-t', orderId: C, location: LOC, window: WIN });
    expect(composed).toMatchObject({ status: 422, json: { ok: false, reason: 'colis_fournisseurs_differents' } });
    // A package article cancelled before dispatch stays behind; the rest travels alone.
    await intake(logistics, '/intake/readiness', { orderId: D, ready: true, asOf: '2026-09-23T09:05:00.000Z', supplierRef: 'supplier-un' });
    await intake(logistics, '/intake/funding', { orderId: C, status: 'cancelled', paymentMode: 'FULL_PREPAY', asOf: '2026-09-23T09:06:00.000Z', package: COLIS });
    const seul = await ops(logistics, '/ops/task', { command_id: 'colis2-t2', orderId: C, location: LOC, window: WIN });
    expect(seul.status, JSON.stringify(seul.json)).toBe(200);
    expect(seul.json['colis'], 'one order left travels as an order alone').toBeUndefined();
    const board = (await ops(logistics, '/ops/board')).json['board'] as { queued: Json[] };
    expect(board.queued.map((q) => q['orderId'])).toEqual([D]);
  }, 60_000);
});
