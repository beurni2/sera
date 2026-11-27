import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';
import { httpCustodyActs } from '../../../apps/rider-app/src/net/custody-acts';
import type { CommandId } from '../../../apps/rider-app/src/offline/commandId';

/**
 * ═══ A PICKUP THAT GOES WRONG STAYS SAFE — on the REAL Workers ═══
 *
 * Sera-Build-Spec SE-I05: « Custody begins only after rider pickup
 * verification … AND custody-seal registration. Pickup also requires assigned
 * session + `pickupVerificationCode`. » §6.5: « package never unowned ». So:
 *
 *   1. a slow answer from custody never lets an ended course's code reach the
 *      stall of the course that replaced it, and a call custody never answers
 *      does not hold every other order's road behind it;
 *   2. once the goods are checked and before the seal, the founder cannot take
 *      the course back or clear it from the board — the parcel would have no
 *      road out (the check spent the only pickup code) — and when custody
 *      cannot say where the pickup stands, nothing is taken back on a guess;
 *   3. the same rider sending his check or his seal again, because the first
 *      answer never reached his phone, gets what custody already recorded,
 *      and nothing new is written; anyone else gets today's refusal.
 *
 * Both Workers are the real bundles, wired to each other; the rider acts go
 * through the rider app's OWN ports; the outcome is asked of custody's ledger
 * and command log and of the board, never of an answer alone. The only thing
 * between the two Workers is a wire that can HOLD one named call (a real
 * binding allows exactly that: an outbound call never holds the dispatch
 * object's input gate) or answer like a custody that is down (503). It never
 * answers in custody's place with a success.
 *
 * The repeated check and seal (3) are custody's rules, yet they live here, not
 * beside the custody Worker: custody's rider door asks logistics who the rider
 * is, so a repeat from « the same rider » can only be driven with both Workers.
 */

const OPS = 'test-ops-tourne';
const INTAKE = 'test-intake-tourne';
const VERIFY = 'test-verify-tourne';
const CUSTODY_OPS = 'test-custody-ops-tourne';
const PRODUCE_KEY = 'test-produce-key-tourne';
const SHOP_ARM_KEY = 'test-shop-arm-key-tourne';
const LIVREE_KEY = 'test-course-livree-key-tourne';
const SUPPLIER = 'supplier-tourne-1';
const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');
const LONG = 60_000;

type Json = Record<string, unknown>;

interface Wire {
  /** Every call logistics made to custody, in order. */
  appels: { path: string; corps: string }[];
  /** Hold the next call `match` names until `lacher()`; `arrivee()` resolves when it came. */
  retenir: (match: (path: string, corps: string) => boolean) => { arrivee: () => Promise<void>; lacher: () => void };
  /** While set, a call this names is answered as a custody that is down. */
  enPanne?: (path: string) => boolean;
}

interface Hold {
  custody?: Miniflare;
  logistics?: Miniflare;
  wire: Wire;
}

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose().catch(() => undefined)));
  live = [];
});

function spawnCustody(hold: Hold): void {
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'tourne-custody-')),
    serviceBindings: { LOGISTICS: ((request: Request) => hold.logistics!.dispatchFetch(request.url, request as never)) as never },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: CUSTODY_OPS,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
      SERA_COURSE_LIVREE_SECRET: LIVREE_KEY,
    },
  });
  live.push(mf);
  hold.custody = mf;
}

function wire(hold: Hold): { wire: Wire; binding: (request: Request) => Promise<Response> } {
  const w: Wire = { appels: [], retenir: () => ({ arrivee: async () => undefined, lacher: () => undefined }) };
  let quand: ((path: string, corps: string) => boolean) | undefined;
  let arrive = (): void => undefined;
  let lache: Promise<void> = Promise.resolve();
  const binding = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const corps = request.method === 'POST' ? await request.clone().text() : url.search;
    w.appels.push({ path: url.pathname, corps });
    if (w.enPanne?.(url.pathname) === true) return new Response('custody down', { status: 503 });
    if (quand?.(url.pathname, corps) === true) {
      quand = undefined;
      const attente = lache;
      arrive();
      await attente;
    }
    return hold.custody!.dispatchFetch(request.url, request as never) as never;
  };
  w.retenir = (match) => {
    let lacher = (): void => undefined;
    lache = new Promise<void>((r) => (lacher = r));
    const arrivee = new Promise<void>((r) => (arrive = r));
    quand = match;
    return {
      arrivee: () => Promise.race([arrivee, new Promise<never>((_, non) => setTimeout(() => non(new Error('the held custody call never came')), 15_000))]),
      lacher: () => lacher(),
    };
  };
  return { wire: w, binding };
}

/** Both Workers; `sansCustody` leaves logistics with no custody binding at all. */
function both(sansCustody = false): Hold {
  const hold = {} as Hold;
  const { wire: w, binding } = wire(hold);
  hold.wire = w;
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'tourne-logistics-')),
    ...(sansCustody ? {} : { serviceBindings: { CUSTODY: binding as never } }),
    bindings: {
      SERA_OPS_SECRET: OPS,
      SERA_INTAKE_SECRET: INTAKE,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_COURSE_LIVREE_SECRET: LIVREE_KEY,
      ...(sansCustody ? {} : { SERA_PRODUCE_SECRET: PRODUCE_KEY }),
    },
  });
  live.push(mf);
  hold.logistics = mf;
  if (!sansCustody) spawnCustody(hold);
  return hold;
}

async function ops(hold: Hold, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await hold.logistics!.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function produce(hold: Hold, path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await hold.logistics!.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LIVREE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function intake(hold: Hold, path: string, body: unknown): Promise<Json> {
  const res = await hold.logistics!.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, path).toBe(200);
  return (await res.json()) as Json;
}

async function custodyOps(hold: Hold, path: string): Promise<{ status: number; json: Json }> {
  const res = await hold.custody!.dispatchFetch(`http://custody${path}`, { headers: { Authorization: `Bearer ${CUSTODY_OPS}` } });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPorts(hold: Hold) {
  const viaLogistics = ((url: string, init?: RequestInit) => hold.logistics!.dispatchFetch(url, init as never)) as never;
  const viaCustody = ((url: string, init?: RequestInit) => hold.custody!.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return {
    acts: httpShiftActs('http://logistics', net, viaLogistics),
    session: httpRiderSession('http://logistics', net, viaLogistics),
    custody: httpCustodyActs('http://custody', { current: () => 'online' as const }, viaCustody),
  };
}

const id = (s: string) => s as CommandId;
const T = '2026-11-27T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2099-01-01T00:00:00.000Z' };
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

async function vue(hold: Hold, code: string): Promise<Json | null> {
  const signed = await appPorts(hold).session.signIn(code);
  if (!signed.ok) throw new Error(`sign-in refused: ${JSON.stringify(signed)}`);
  return (signed.session.assignment as unknown as Json | null) ?? null;
}

async function rider(hold: Hold, riderId: string): Promise<string> {
  await ops(hold, '/ops/riders', { riderId, displayName: riderId, phoneAlias: riderId });
  await ops(hold, '/ops/riders/certify', { riderId, certified: true });
  const code = (await ops(hold, '/ops/rider-code/mint', { riderId })).json['code'] as string;
  const { acts } = appPorts(hold);
  await acts.ackPrivacy(code);
  expect((await acts.startShift(code)).ok).toBe(true);
  return code;
}

async function commande(hold: Hold, orderId: string, tour = 1): Promise<string> {
  if (tour === 1) {
    await intake(hold, '/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
    await intake(hold, '/intake/readiness', { orderId, ready: true, asOf: T, supplierRef: SUPPLIER });
  }
  const composed = await ops(hold, '/ops/task', { command_id: `t-${orderId}-${tour}`, orderId, location: LOC, window: WIN });
  expect(composed.json['ok'], JSON.stringify(composed.json)).toBe(true);
  return composed.json['taskId'] as string;
}

async function confier(hold: Hold, taskId: string, riderId: string, commandId: string): Promise<string> {
  const granted = await ops(hold, '/ops/assign', { command_id: commandId, taskId, riderId });
  expect(granted.json['ok'], JSON.stringify(granted.json)).toBe(true);
  return (granted.json['assignment'] as Json)['assignmentId'] as string;
}

async function attendre<V>(lire: () => Promise<V>, fini: (v: V) => boolean, pourquoi: string): Promise<V> {
  let v = await lire();
  for (let i = 0; i < 80 && !fini(v); i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    v = await lire();
  }
  if (!fini(v)) throw new Error(`${pourquoi} — last: ${JSON.stringify(v)}`);
  return v;
}

const pickupArme = (hold: Hold, assignmentId: string) =>
  attendre(async () => hold.wire.appels.some((a) => a.path === '/produce/secrets/arm' && a.corps.includes(`"arm-pickup-${assignmentId}"`)), (v) => v, 'the pickup code was never armed');

/** Accept, then the supplier types the code the rider says: the custody codes arrive on his session. */
async function accepteEtConfirme(hold: Hold, code: string, assignmentId: string, orderId: string, tag: string): Promise<Json> {
  expect((await appPorts(hold).acts.accepterCourse(code, assignmentId)).ok).toBe(true);
  const avant = await vue(hold, code);
  expect(await intake(hold, '/intake/ramassage/verify', { command_id: `r-${tag}`, orderId, code: avant?.['codeRamassage'] })).toEqual({ ok: true, verdict: 'confirme' });
  const apres = await vue(hold, code);
  expect(typeof apres?.['codeVerification'], 'the accepted, confirmed course carries its pickup code').toBe('string');
  return apres!;
}

const verifier = (hold: Hold, code: string, orderId: string, pickup: string, tag: string) =>
  appPorts(hold).custody.verifyPickup(
    { commandId: id(`v-${tag}`), orderId, presentedPickupCode: pickup, evidenceBundleId: `ev-${tag}`, dwellSec: 150, checkResults: ALL_PASS },
    code,
  );

const sceller = (hold: Hold, code: string, orderId: string, seal: string, tag: string) =>
  appPorts(hold).custody.beginCustody({ commandId: id(`b-${tag}`), orderId, custodySealId: seal, sealPhotoRefs: [] }, code);

const courant = async (hold: Hold, orderId: string) => (await custodyOps(hold, `/ops/ledger?orderId=${orderId}`)).json['currentCustodian'];

/** A course accepted, confirmed and checked at the stall; not sealed. */
async function verifieeNonScellee(hold: Hold, orderId: string, riderId: string) {
  const taskId = await commande(hold, orderId);
  const code = await rider(hold, riderId);
  const assignmentId = await confier(hold, taskId, riderId, `a-${orderId}`);
  await pickupArme(hold, assignmentId);
  const a = await accepteEtConfirme(hold, code, assignmentId, orderId, orderId);
  const check = await verifier(hold, code, orderId, a['codeVerification'] as string, `${orderId}-1`);
  expect(check.kind === 'recorded' && check.body['kind'], JSON.stringify(check)).toBe('accepted');
  // Before the seal nobody holds the parcel on the ledger yet.
  expect(String(await courant(hold, orderId))).not.toMatch(/^courier:/);
  return { taskId, code, assignmentId, scelle: a['codeScelle'] as string };
}

describe('a slow answer from custody never arms an ended course\'s code', () => {
  it('open held · the offer declined · the same task given to another rider: no arm goes out for the ended course', async () => {
    const hold = both();
    const O = 'ord-lent';
    const taskId = await commande(hold, O);
    const code1 = await rider(hold, 'rider-lent-1');
    const code2 = await rider(hold, 'rider-lent-2');
    const tenue = hold.wire.retenir((path, corps) => path === '/produce/order/open' && corps.includes(O));
    const a1 = await confier(hold, taskId, 'rider-lent-1', 'a-lent-1');
    await tenue.arrivee();
    // Custody has not answered yet: the first rider declines, the same task goes to the second.
    // (The rider app has no decline port of its own; this is the rider door it would call.)
    const refus = await hold.logistics!.dispatchFetch('http://logistics/rider/assignment/decline', {
      method: 'POST',
      headers: { Authorization: `Bearer ${code1}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentId: a1 }),
    });
    expect(refus.status).toBe(200);
    const a2 = await confier(hold, taskId, 'rider-lent-2', 'a-lent-2');
    const c2 = (await accepteEtConfirme(hold, code2, a2, O, 'lent-2'))['codeVerification'] as string;
    // The new course's own arm is held in its turn, so what the stalled flush sends is plain to see.
    const tenue2 = hold.wire.retenir((path, corps) => path === '/produce/secrets/arm' && corps.includes(`"arm-pickup-${a2}"`));
    const debut = hold.wire.appels.length;
    tenue.lacher();
    await tenue2.arrivee();
    expect(
      hold.wire.appels.slice(debut).filter((a) => a.path === '/produce/secrets/arm' && !a.corps.includes(`"arm-pickup-${a2}"`)).map((a) => JSON.parse(a.corps)['command_id']),
      'no arm may go out for the course that ended while custody was slow',
    ).toEqual([]);
    tenue2.lacher();
    const juste = await attendre(
      async () => {
        const r = await verifier(hold, code2, O, c2, `lent-2-${Date.now()}`);
        return r.kind === 'recorded' ? r.body['kind'] : r.kind;
      },
      (k) => k === 'accepted',
      'the new rider\'s own code must verify',
    );
    expect(juste).toBe('accepted');
    const att = (await custodyOps(hold, `/ops/attestations?orderId=${O}`)).json['attestations'] as Json[];
    expect(att.filter((r) => r['outcome'] === 'accepted').map((r) => r['riderId'])).toEqual(['rider-lent-2']);
  }, LONG);

  it('open held · take-back: no arm carrying the ended course\'s code goes out after it ended', async () => {
    const hold = both();
    const O = 'ord-lent-reprise';
    const taskId = await commande(hold, O);
    const code1 = await rider(hold, 'rider-lent-r');
    const tenue = hold.wire.retenir((path, corps) => path === '/produce/order/open' && corps.includes(O));
    const a1 = await confier(hold, taskId, 'rider-lent-r', 'a-lent-r');
    await tenue.arrivee();
    // The rider accepts and is confirmed while custody still has not answered: his phone holds the code.
    const c1 = (await accepteEtConfirme(hold, code1, a1, O, 'lent-r'))['codeVerification'] as string;
    const repris = await ops(hold, '/ops/assignment/take-back', { command_id: 'tb-lent-r', assignmentId: a1, custodyNotBegun: true });
    expect(repris.json['ok'], JSON.stringify(repris.json)).toBe(true);
    const debut = hold.wire.appels.length;
    tenue.lacher();
    // The ending's own re-arm (a fresh code, under its own id) is what must reach custody.
    await attendre(async () => hold.wire.appels.slice(debut).some((a) => a.path === '/produce/secrets/arm' && a.corps.includes(`"arm-pickup-fin-${a1}"`)), (v) => v, 'the ending never re-armed');
    expect(
      hold.wire.appels.slice(debut).filter((a) => a.path === '/produce/secrets/arm' && JSON.parse(a.corps)['secret'] === c1).map((a) => JSON.parse(a.corps)['command_id']),
      'no arm may carry the ended course\'s code after it ended',
    ).toEqual([]);
    // And the code his phone held opens nothing.
    const vole = await verifier(hold, code1, O, c1, 'lent-r-vieux');
    expect(vole).toEqual({ kind: 'refused', reason: 'pickup_code_refused' });
  }, LONG);

  it('an order-open custody never answers gives up at the time limit, and the next order\'s road still opens', async () => {
    const hold = both();
    const [O1, O2] = ['ord-muet-1', 'ord-muet-2'];
    const t1 = await commande(hold, O1);
    const t2 = await commande(hold, O2);
    await rider(hold, 'rider-muet-1');
    await rider(hold, 'rider-muet-2');
    const tenue = hold.wire.retenir((path, corps) => path === '/produce/order/open' && corps.includes(O1));
    await confier(hold, t1, 'rider-muet-1', 'a-muet-1');
    await tenue.arrivee();
    await confier(hold, t2, 'rider-muet-2', 'a-muet-2');
    await attendre(async () => hold.wire.appels.some((a) => a.path === '/produce/order/open' && a.corps.includes(O2)), (v) => v, 'the next order\'s road never opened while one call hung');
    tenue.lacher();
  }, LONG);

  it('a return-key arm custody never answers gives up at the time limit, and the next order\'s road still opens', async () => {
    const hold = both();
    const [O1, O2] = ['ord-cle-1', 'ord-cle-2'];
    const t1 = await commande(hold, O1);
    const t2 = await commande(hold, O2);
    const code = await rider(hold, 'rider-cle');
    const a1 = await confier(hold, t1, 'rider-cle', 'a-cle-1');
    await pickupArme(hold, a1);
    expect((await appPorts(hold).acts.accepterCourse(code, a1)).ok).toBe(true);
    const tenue = hold.wire.retenir((path, corps) => path === '/produce/secrets/arm' && corps.includes(`arm-retour-rider-${a1}`));
    expect((await produce(hold, '/produce/retour-ouvert', { command_id: 'ro-cle', orderId: O1, at: new Date().toISOString() })).json['status']).toBe('retour_ouvert');
    await tenue.arrivee();
    await rider(hold, 'rider-cle-2');
    await confier(hold, t2, 'rider-cle-2', 'a-cle-2');
    await attendre(async () => hold.wire.appels.some((a) => a.path === '/produce/order/open' && a.corps.includes(O2)), (v) => v, 'the next order\'s road never opened while a return arm hung');
    tenue.lacher();
  }, LONG);
});

describe('checked and not sealed: the course cannot be taken back or cleared', () => {
  it('take-back is refused by name; the course stays the rider\'s; he seals and custody begins', async () => {
    const hold = both();
    const O = 'ord-verifiee';
    const { code, assignmentId, scelle } = await verifieeNonScellee(hold, O, 'rider-verifiee');
    const repris = await ops(hold, '/ops/assignment/take-back', { command_id: 'tb-v', assignmentId, custodyNotBegun: true });
    expect(repris).toEqual({ status: 409, json: { ok: false, reason: 'pickup_verified_not_sealed', orderIds: [O] } });
    expect(JSON.stringify((await ops(hold, '/ops/board')).json)).toContain(assignmentId);
    expect((await vue(hold, code))?.['assignmentId']).toBe(assignmentId);
    const sceau = await sceller(hold, code, O, scelle, 'v');
    expect(sceau.kind === 'recorded' && sceau.body['status'], JSON.stringify(sceau)).toBe('custody_with_courier');
    expect(await courant(hold, O)).toBe('courier:rider-verifiee');
  }, LONG);

  it('clearing the order from the board is refused the same way', async () => {
    const hold = both();
    const O = 'ord-verifiee-retrait';
    const { assignmentId } = await verifieeNonScellee(hold, O, 'rider-verifiee-r');
    const retrait = await ops(hold, '/ops/order/retirer', { command_id: 'ret-v', orderId: O });
    expect(retrait).toEqual({ status: 409, json: { ok: false, reason: 'pickup_verified_not_sealed', orderIds: [O] } });
    expect(JSON.stringify((await ops(hold, '/ops/board')).json)).toContain(assignmentId);
  }, LONG);

  it('custody down: take-back and clearing fail closed, nothing changes', async () => {
    const hold = both();
    const O = 'ord-panne';
    const taskId = await commande(hold, O);
    const code = await rider(hold, 'rider-panne');
    const assignmentId = await confier(hold, taskId, 'rider-panne', 'a-panne');
    await pickupArme(hold, assignmentId);
    expect((await appPorts(hold).acts.accepterCourse(code, assignmentId)).ok).toBe(true);
    hold.wire.enPanne = (path) => path === '/produce/custodian';
    expect(await ops(hold, '/ops/assignment/take-back', { command_id: 'tb-p', assignmentId, custodyNotBegun: true })).toEqual({ status: 503, json: { ok: false, reason: 'custody_unverifiable' } });
    expect(await ops(hold, '/ops/order/retirer', { command_id: 'ret-p', orderId: O })).toEqual({ status: 503, json: { ok: false, reason: 'custody_unverifiable' } });
    expect(JSON.stringify((await ops(hold, '/ops/board')).json)).toContain(assignmentId);
  }, LONG);

  it('custody not wired at all: an accepted course is not taken back on a guess', async () => {
    const hold = both(true);
    const O = 'ord-sans-fil';
    const taskId = await commande(hold, O);
    const code = await rider(hold, 'rider-sans-fil');
    const assignmentId = await confier(hold, taskId, 'rider-sans-fil', 'a-sans-fil');
    expect((await appPorts(hold).acts.accepterCourse(code, assignmentId)).ok).toBe(true);
    expect(await ops(hold, '/ops/assignment/take-back', { command_id: 'tb-sf', assignmentId, custodyNotBegun: true })).toEqual({ status: 503, json: { ok: false, reason: 'custody_unverifiable' } });
    expect(await ops(hold, '/ops/order/retirer', { command_id: 'ret-sf', orderId: O })).toEqual({ status: 503, json: { ok: false, reason: 'custody_unverifiable' } });
  }, LONG);

  it('a course not yet accepted, or already sealed, is taken back exactly as today', async () => {
    const hold = both();
    const O1 = 'ord-offre';
    const t1 = await commande(hold, O1);
    await rider(hold, 'rider-offre');
    const a1 = await confier(hold, t1, 'rider-offre', 'a-offre');
    hold.wire.enPanne = (path) => path === '/produce/custodian';
    expect((await ops(hold, '/ops/assignment/take-back', { command_id: 'tb-o', assignmentId: a1, custodyNotBegun: true })).json['ok']).toBe(true);
    hold.wire.enPanne = undefined;
    const O2 = 'ord-scellee';
    const { code, assignmentId, scelle } = await verifieeNonScellee(hold, O2, 'rider-scellee');
    expect((await sceller(hold, code, O2, scelle, 's')).kind).toBe('recorded');
    // After the seal the typed assertion is still the founder's word (a later ruling, not this one).
    expect((await ops(hold, '/ops/assignment/take-back', { command_id: 'tb-s', assignmentId, custodyNotBegun: true })).json['ok']).toBe(true);
  }, LONG);
});

describe('the same rider sending again after a lost answer gets what custody recorded', () => {
  async function compte(hold: Hold, orderId: string) {
    const led = (await custodyOps(hold, `/ops/ledger?orderId=${orderId}`)).json;
    const att = (await custodyOps(hold, `/ops/attestations?orderId=${orderId}`)).json;
    return {
      entries: (led['entries'] as unknown[]).length,
      checks: (att['attestations'] as unknown[]).length,
      seals: (att['custodyTaken'] as unknown[]).length,
      custodian: led['currentCustodian'],
    };
  }

  it('check: a repeat under a new id with his own code answers the recorded acceptance and writes nothing', async () => {
    const hold = both();
    const O = 'ord-repete';
    const taskId = await commande(hold, O);
    const code = await rider(hold, 'rider-repete');
    const autre = await rider(hold, 'rider-autre');
    const assignmentId = await confier(hold, taskId, 'rider-repete', 'a-repete');
    await pickupArme(hold, assignmentId);
    const a = await accepteEtConfirme(hold, code, assignmentId, O, 'repete');
    const pickup = a['codeVerification'] as string;
    const premier = await verifier(hold, code, O, pickup, 'repete-1');
    expect(premier.kind === 'recorded' && premier.body['kind']).toBe('accepted');
    // The phone never saw that answer; after a relaunch it sends again, under a fresh id.
    const avant = await compte(hold, O);
    const encore = await verifier(hold, code, O, pickup, 'repete-2');
    expect(encore.kind === 'recorded' ? { kind: encore.body['kind'], duplicate: encore.duplicate } : encore).toEqual({ kind: 'accepted', duplicate: true });
    expect(await compte(hold, O), 'a repeat writes nothing on the ledger or the log').toEqual(avant);
    // Anyone else, or a wrong code: exactly today's refusal.
    const autreRider = await verifier(hold, autre, O, pickup, 'repete-autre');
    expect(autreRider).toEqual({ kind: 'refused', reason: 'pickup_code_refused' });
    const mauvais = await verifier(hold, code, O, `${pickup}x`, 'repete-faux');
    expect(mauvais).toEqual({ kind: 'refused', reason: 'pickup_code_refused' });
    // And he seals and carries on.
    expect((await sceller(hold, code, O, a['codeScelle'] as string, 'repete')).kind).toBe('recorded');
    expect(await courant(hold, O)).toBe('courier:rider-repete');
  }, LONG);

  it('seal: a repeat from the custodian with the same seal answers custody_with_courier and writes nothing', async () => {
    const hold = both();
    const O = 'ord-sceau';
    const { code, scelle } = await verifieeNonScellee(hold, O, 'rider-sceau');
    const autre = await rider(hold, 'rider-sceau-autre');
    expect((await sceller(hold, code, O, scelle, 'sceau-1')).kind).toBe('recorded');
    const avant = await compte(hold, O);
    const encore = await sceller(hold, code, O, scelle, 'sceau-2');
    expect(encore.kind === 'recorded' ? { status: encore.body['status'], duplicate: encore.duplicate } : encore).toEqual({ status: 'custody_with_courier', duplicate: true });
    expect(await compte(hold, O), 'a repeat writes nothing on the ledger or the log').toEqual(avant);
    expect(avant.custodian).toBe('courier:rider-sceau');
    expect(await sceller(hold, code, O, `${scelle}x`, 'sceau-faux')).toEqual({ kind: 'refused', reason: 'seal_already_used' });
    expect((await sceller(hold, autre, O, scelle, 'sceau-autre')).kind).toBe('refused');
  }, LONG);
});
