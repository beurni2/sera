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
 * ═══ REPROGRAMMATION-1 — THE NEXT PASSAGE, REAL AGAINST REAL ═══
 *
 * SE6.1's remaining piece. RETOUR-VIVANT-1 left the non-escalating arm of the
 * §6.4 ladder at « Gardez le colis, Séra vous appelle » — and Séra was never
 * told. The two Miniflares below each run the OTHER Worker's shipped bundle
 * behind the service binding, and the CONSOLE's own port and the RIDER app's
 * own ports drive the founder's and the rider's halves, so the whole passage
 * runs on the bytes wrangler deploys:
 *
 *   rider    ──/rider/door/refusal · /ops/door/expire──▶ custody   (reschedule)
 *   custody  ──/produce/reprogrammation────────────────▶ logistics (the 7th wire)
 *   console  ──GET /ops/board · POST /ops/reprogrammer─▶ logistics (next passage)
 *   rider    ──GET /rider/moi──────────────────────────▶ logistics (« 2e passage »)
 *   rider    ──/rider/delivery/drop────────────────────▶ custody   (the ordinary drop)
 *   custody  ──/produce/course-livree──────────────────▶ logistics (course `delivered`)
 *
 * The proof is asked of the LEDGERS — custody's custodian, the board, the
 * rider's session, and the rider being GIVEN A NEW COURSE at the end (the
 * stranded-lease assertion, SE-I01) — never of a response alone.
 */

const OPS = 'test-ops-reprog';
const INTAKE = 'test-intake-reprog';
const VERIFY = 'test-verify-reprog';
const CUSTODY_OPS = 'test-custody-ops-reprog';
const PRODUCE_KEY = 'test-produce-key-reprog';
const SHOP_ARM_KEY = 'test-shop-arm-key-reprog';
const LIVREE_KEY = 'test-course-livree-key-reprog';
const SUPPLIER = 'supplier-reprog-1';

const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

interface Hold {
  custody?: Miniflare;
  logistics?: Miniflare;
  /** REPROGRAMMATION-2 — what logistics asked custody over the service
   *  binding, and how custody answered: the one place the board-read reviver
   *  is observable from outside. */
  custodyCalls: { path: string; status: number }[];
}

function spawnCustody(hold: Hold): Miniflare {
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'reprog-custody-')),
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
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'reprog-logistics-')),
    serviceBindings: {
      CUSTODY: (async (request: Request) => {
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

async function custodyOps(mf: Miniflare, path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CUSTODY_OPS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function custodyEvents(mf: Miniflare, orderId: string): Promise<{ name: string; payload: Json }[]> {
  const res = await mf.dispatchFetch(`http://custody/ops/events?orderId=${orderId}`, { headers: { Authorization: `Bearer ${CUSTODY_OPS}` } });
  return ((await res.json()) as Json)['events'] as { name: string; payload: Json }[];
}

/** The supplier's word, as Boutik+'s fulfillment-service posts it (RETOUR-VIVANT-1). */
async function supplierTypes(mf: Miniflare, body: unknown): Promise<Json> {
  const res = await mf.dispatchFetch('http://logistics/intake/retour/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Json;
}

async function produceDoor(mf: Miniflare, path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${LIVREE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return { acts: httpShiftActs('http://logistics', net, fetchFn), session: httpRiderSession('http://logistics', net, fetchFn) };
}

/** The dispatch console's OWN port — the desk the founder fixes the passage on. */
function desk(mf: Miniflare, key: string = OPS) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  return httpCourses('http://logistics', key, fetchFn);
}

const T = '2026-09-17T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: 'Après le rond-point', maskedRelay: '' };
const WIN = { start: T, end: '2026-09-17T16:00:00.000Z' };
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const plus16 = (): string => new Date(Date.now() + 16 * 60_000).toISOString();
const AUDIO = 'media/5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

async function courseConfiee(mf: Miniflare, orderId: string, riderId: string, prefix: string) {
  await intake(mf, '/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
  await intake(mf, '/intake/readiness', { orderId, ready: true, asOf: T, supplierRef: SUPPLIER });
  const composed = await ops(mf, '/ops/task', { command_id: `${prefix}-t`, orderId, location: LOC, window: WIN, repereAudioRef: AUDIO });
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

async function moiAssignment(mf: Miniflare, code: string): Promise<Json | null> {
  const res = await mf.dispatchFetch('http://logistics/rider/moi', { headers: { Authorization: `Bearer ${code}` } });
  expect(res.status).toBe(200);
  const json = (await res.json()) as Json;
  return (json['rider'] as Json)['assignment'] as Json | null;
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

/** The rider's road on custody, up to the door: verified, sealed, the
 *  buyer's code armed by Shop+, evidence recorded and auto-decided. */
async function jusquaLaPorte(custody: Miniflare, logistics: Miniflare, orderId: string, code: string, prefix: string): Promise<{ codeScelle: string; drop: string }> {
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
  const drop = `DROP-${prefix}`;
  const armed = await custody.dispatchFetch('http://custody/produce-shop/secrets/arm', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, command_id: `${prefix}-arm-drop`, kind: 'buyer_drop_code', secret: drop }),
  });
  expect(armed.status).toBe(200);
  await armed.text();
  const evidence = await riderCustody(custody, '/rider/delivery/evidence', code, {
    orderId, command_id: `${prefix}-e`,
    bundle: { taskId: chain['task_id'], packageId: chain['package_id'], custodySealId: sc, artifacts: [], capturedAt: T },
  });
  expect(evidence.status, JSON.stringify(evidence.json)).toBe(200);
  return { codeScelle: sc, drop };
}

describe('REPROGRAMMATION-1 — the next passage crosses BOTH real Workers, the console and the rider’s phone', () => {
  it('honest absence → custody reschedules → the 7th wire lists the course « à reprogrammer » on the console → the founder fixes the window → the SAME course carries the follow-up task, the rider reads « 2e passage » with the window and the same codes → the ordinary drop closes it → the lease is released and the rider can be given a new course', async () => {
    const hold: Hold = { custodyCalls: [] };
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const custody = hold.custody!;

    const O = 'ord-reprog-1';
    const RIDER = 'rider-reprog-1';
    const { code, assignmentId, taskId: T1 } = await courseConfiee(logistics, O, RIDER, 'rp1');
    const { codeScelle, drop } = await jusquaLaPorte(custody, logistics, O, code, 'rp1');

    // BEFORE: passage 1, the chain ids logistics opened custody with, no
    // course waiting for a passage on the founder's desk.
    const avant = await moiAssignment(logistics, code);
    expect(avant).toMatchObject({ taskId: T1, passage: 1, chaine: { taskId: T1, packageId: `pkg-${O}` }, codeScelle });
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });

    // The ladder, on the rider's own door; the expiry attested by custody's
    // founder door sixteen minutes on (the one lever a test has on the clock).
    const refused = await riderCustody(custody, '/rider/door/refusal', code, { orderId: O, command_id: 'rp1-ref', reasonCode: 'honest_absence' });
    expect(refused.status, JSON.stringify(refused.json)).toBe(200);
    const expired = await custodyOps(custody, '/ops/door/expire', { orderId: O, command_id: 'rp1-exp', at: plus16() });
    expect(expired.status, JSON.stringify(expired.json)).toBe(200);
    expect(expired.json['outcome']).toMatchObject({ family: 'reschedule', reasonCode: 'honest_absence' });

    // THE 7TH WIRE CROSSED: the founder's desk lists the course, off the
    // real board, through the console's own port — the reason, the rider by
    // name, the first attempt's task.
    const listed = await attendre(
      () => desk(logistics).reprogrammations(),
      (a) => a.kind === 'ok' && a.value.length === 1,
      'the reschedule never reached the console',
    );
    expect(listed).toMatchObject({ kind: 'ok', value: [{ orderId: O, taskId: T1, riderName: 'Boss', reasonCode: 'honest_absence' }] });
    if (listed.kind !== 'ok') return;
    expect(Number.isFinite(Date.parse(listed.value[0]!.recordedAt))).toBe(true);
    // The rider still carries: the ledger says so, and so does the board.
    expect(await custodian(custody, O)).toBe(`courier:${RIDER}`);
    const boardAvant = (await ops(logistics, '/ops/board'))['board'] as Json;
    expect((boardAvant['riders'] as Json[]).find((r) => r['riderId'] === RIDER)?.['assignable']).toBe(false);

    // THE FOUNDER FIXES THE NEXT PASSAGE, through the console's own port.
    const start = new Date(Date.now() + 60 * 60_000).toISOString();
    const end = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    const fixed = await desk(logistics).reprogrammer(O, { start, end }, 'cmd-rp1-fix');
    expect(fixed.kind, JSON.stringify(fixed)).toBe('ok');
    if (fixed.kind !== 'ok') return;
    const T2 = fixed.value.taskId;
    expect(T2).not.toBe(T1);

    // ASK THE LEDGERS. The desk is clear; the SAME assignment now names the
    // follow-up task; no task is queued (the prior closed, the follow-up is
    // assigned); the order is not back on « à préparer »; the rider is busy.
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });
    const board = (await ops(logistics, '/ops/board'))['board'] as Json;
    expect(board['aReprogrammer']).toEqual([]);
    expect(board['queued']).toEqual([]);
    const course = (board['assignments'] as Json[]).find((a) => a['orderId'] === O);
    expect(course).toMatchObject({ assignmentId, taskId: T2, riderId: RIDER, status: 'acknowledged', lease: { taskId: T1 } });
    expect((board['riders'] as Json[]).find((r) => r['riderId'] === RIDER)?.['assignable']).toBe(false);
    expect((await ops(logistics, '/ops/a-preparer'))['attente']).toEqual([]);
    // A fresh compose for the same order refuses: the follow-up IS its task.
    const recompose = await ops(logistics, '/ops/task', { command_id: 'rp1-t-again', orderId: O, location: LOC, window: WIN });
    expect(recompose).toMatchObject({ ok: false, reason: 'order_already_has_task', taskId: T2 });

    // THE RIDER'S PHONE: « 2e passage », the founder's window, the same
    // codes and seal (custody is untouched), the chain ids of the FIRST
    // attempt (what custody's chain holds), the brief carried over.
    const apres = await moiAssignment(logistics, code);
    expect(apres).toMatchObject({
      assignmentId, taskId: T2, status: 'acknowledged', passage: 2,
      window: { start, end }, location: LOC,
      codeScelle, chaine: { taskId: T1, packageId: `pkg-${O}` }, repereAudioRef: AUDIO,
    });
    expect(apres?.['codeVerification']).toBe(avant?.['codeVerification']);
    // …and through the app's own parser, the fields the screen turns on.
    const moi = await appPorts(logistics).session.signIn(code);
    expect(moi.ok).toBe(true);
    if (!moi.ok) return;
    expect(moi.session.assignment).toMatchObject({ passage: 2, fenetre: { start, end }, chaine: { taskId: T1, packageId: `pkg-${O}` } });

    // IDEMPOTENT BY COMMAND: the console retries the SAME command (a lost
    // answer) and is told the fix it already made — the same follow-up task.
    const retried = await desk(logistics).reprogrammer(O, { start, end }, 'cmd-rp1-fix');
    expect(retried).toEqual({ kind: 'ok', value: { taskId: T2 } });
    // REFUSE-CLOSED BY STATE: a NEW command for the same course is refused by
    // name — nothing to fix any more.
    const encore = await desk(logistics).reprogrammer(O, { start, end }, 'cmd-rp1-fix-encore');
    expect(encore).toEqual({ kind: 'refused', reason: 'order_not_rescheduled' });

    // THE RIDER CANNOT BE GIVEN ANOTHER PACKAGE WHILE HE CARRIES THIS ONE:
    // the anchored lease is alive, the book's one-active rule holds.
    const O2 = 'ord-reprog-1-other';
    await intake(logistics, '/intake/funding', { orderId: O2, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
    await intake(logistics, '/intake/readiness', { orderId: O2, ready: true, asOf: T, supplierRef: SUPPLIER });
    const other = await ops(logistics, '/ops/task', { command_id: 'rp1-t2', orderId: O2, location: LOC, window: WIN });
    expect(other['ok']).toBe(true);
    const refusedOther = await ops(logistics, '/ops/assign', { command_id: 'rp1-a-other', taskId: other['taskId'], riderId: RIDER });
    expect(refusedOther['ok']).toBe(false);

    // THE 2E PASSAGE: the ordinary drop, with the SAME buyer's code — custody
    // → customer, the course-livrée wire closes the course `delivered`, the
    // rider is free AND ASSIGNABLE (the lease released by ITS task, T1).
    const dropped = await riderCustody(custody, '/rider/delivery/drop', code, { orderId: O, command_id: 'rp1-drop', dropCode: drop });
    expect(dropped.status, JSON.stringify(dropped.json)).toBe(200);
    expect(dropped.json).toMatchObject({ ok: true, status: 'custody_with_customer' });
    expect(await custodian(custody, O)).toBe('customer');
    await attendre(() => moiAssignment(logistics, code), (a) => a === null, 'the course never closed on the rider’s session');
    const fin = (await ops(logistics, '/ops/board'))['board'] as Json;
    expect((fin['riders'] as Json[]).find((r) => r['riderId'] === RIDER)?.['assignable']).toBe(true);
    const again = await ops(logistics, '/ops/assign', { command_id: 'rp1-a-again', taskId: other['taskId'], riderId: RIDER });
    expect(again['ok'], `the delivered rider must be grantable again — ${JSON.stringify(again)}`).toBe(true);
    expect((again['lease'] as Json)['taskId']).toBe(other['taskId']);
  });

  it('the doors refuse closed by name: no reschedule on record · a window already past · a reversed window · the produce door settles by name, rejects a foreign outcome, and records nothing for a task the live course does not carry · a take-back and a retire leave no reschedule behind · the exact replay', async () => {
    const hold: Hold = { custodyCalls: [] };
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;

    const O = 'ord-reprog-doors';
    const RIDER = 'rider-reprog-doors';
    const { taskId: T1, assignmentId: A1 } = await courseConfiee(logistics, O, RIDER, 'rpd');
    const future = { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() };

    // Nothing custody said yet: nothing to fix.
    expect(await desk(logistics).reprogrammer(O, future, 'cmd-rpd-0')).toEqual({ kind: 'refused', reason: 'order_not_rescheduled' });
    // The window itself is judged before any state: past, then reversed.
    expect(await desk(logistics).reprogrammer(O, { start: '2026-01-01T09:00:00.000Z', end: '2026-01-01T10:00:00.000Z' }, 'cmd-rpd-past'))
      .toEqual({ kind: 'refused', reason: 'fenetre_passee' });
    expect(await desk(logistics).reprogrammer(O, { start: future.end, end: future.start }, 'cmd-rpd-rev')).toEqual({ kind: 'refused', reason: 'fenetre_invalide' });
    // The wrong key is the one door sentence.
    expect(await desk(logistics, 'not-the-key').reprogrammer(O, future, 'cmd-rpd-key')).toEqual({ kind: 'bad_key' });

    // The produce door: custody's key alone; every settled condition a 200 by
    // name; a body whose outcome names another order is a 400 (producer bug).
    const produce = async (body: unknown, key: string = LIVREE_KEY) => {
      const res = await logistics.dispatchFetch('http://logistics/produce/reprogrammation', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as Json };
    };
    const outcome = (orderId: string, taskId: string) => ({
      taskId, orderId, family: 'reschedule', reasonCode: 'honest_absence', humanReasonRef: 'reason.honest_absence',
      faultClass: 'buyer', attempt: { number: 2, at: T },
    });
    expect((await produce({ command_id: 'w-1', orderId: O, at: T, outcome: outcome(O, T1) }, OPS)).status).toBe(401);
    expect(await produce({ command_id: 'w-2', orderId: 'ord-nobody', at: T, outcome: outcome('ord-nobody', 'task-x') }))
      .toEqual({ status: 200, json: { ok: true, status: 'aucune_course' } });
    expect((await produce({ command_id: 'w-3', orderId: O, at: T, outcome: outcome('ord-other', T1) })).status).toBe(400);
    expect((await produce({ command_id: 'w-4', orderId: O, at: T, outcome: { ...outcome(O, T1), family: 'retry' } })).status).toBe(400);
    // VERIFIER MAJOR (closed): an outcome naming a task the LIVE course does
    // not carry (a redelivery after the follow-up, a stale outcome against a
    // recomposed course) settles by name and records NOTHING — never a ghost
    // row no fix could clear.
    expect(await produce({ command_id: 'w-x', orderId: O, at: T, outcome: outcome(O, 'task-x') }))
      .toEqual({ status: 200, json: { ok: true, status: 'tache_differente' } });
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });
    expect(await desk(logistics).reprogrammer(O, future, 'cmd-rpd-ghost')).toEqual({ kind: 'refused', reason: 'order_not_rescheduled' });
    // Custody's word naming the course's task: recorded once, then settled.
    const first = await produce({ command_id: 'w-5', orderId: O, at: T, outcome: outcome(O, T1) });
    expect(first).toEqual({ status: 200, json: { ok: true, status: 'enregistre' } });
    expect(await produce({ command_id: 'w-5', orderId: O, at: T, outcome: outcome(O, T1) }))
      .toEqual({ status: 200, json: { ok: true, status: 'deja_enregistre' } });
    expect(await desk(logistics).reprogrammations()).toMatchObject({ kind: 'ok', value: [{ orderId: O, taskId: T1, reasonCode: 'honest_absence' }] });
    // A TAKE-BACK leaves no reschedule behind (verifier MAJOR, closed): the
    // next course composed for this order must not inherit a row naming a
    // task it never had.
    // The dispatcher's own assertion, truthful here: no pickup was ever verified
    // on this course, so no custody ever began (the door refuses without it).
    const takenBack = await ops(logistics, '/ops/assignment/take-back', { command_id: 'rpd-tb', assignmentId: A1, custodyNotBegun: true });
    expect(takenBack['ok'], JSON.stringify(takenBack)).toBe(true);
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });
    // Recomposed and re-assigned: custody's word for the NEW course lists it;
    // the exact replay THROUGH THE PORT answers the same follow-up; a fresh
    // command is refused by state.
    const { taskId: T1b } = await courseConfiee(logistics, O, RIDER, 'rpd-b');
    expect(T1b).not.toBe(T1);
    expect(await produce({ command_id: 'w-6', orderId: O, at: T, outcome: outcome(O, T1b) }))
      .toEqual({ status: 200, json: { ok: true, status: 'enregistre' } });
    expect(await desk(logistics).reprogrammations()).toMatchObject({ kind: 'ok', value: [{ orderId: O, taskId: T1b }] });
    // A SHORT window — it ends three seconds from now — so the replay below
    // can be asked AFTER it passed (verifier MINOR, closed): a retried tap is
    // still the fix it already made, never `fenetre_passee` over a passage the
    // rider is already reading.
    const court = { start: new Date(Date.now() + 1_000).toISOString(), end: new Date(Date.now() + 3_000).toISOString() };
    const fixed = await desk(logistics).reprogrammer(O, court, 'cmd-rpd-fix');
    expect(fixed.kind, JSON.stringify(fixed)).toBe('ok');
    if (fixed.kind !== 'ok') return;
    await new Promise((r) => setTimeout(r, Date.parse(court.end) - Date.now() + 300));
    expect(Date.parse(court.end)).toBeLessThan(Date.now());
    expect(await desk(logistics).reprogrammer(O, court, 'cmd-rpd-fix')).toEqual({ kind: 'ok', value: { taskId: fixed.value.taskId } });
    const raw = await ops(logistics, '/ops/reprogrammer', { command_id: 'cmd-rpd-fix', orderId: O, fenetre: court });
    expect(raw).toEqual({ ok: true, duplicate: true, taskId: fixed.value.taskId, priorTaskIds: [T1b], passage: 2 });
    // …while a FRESH command with that passed window is refused as such.
    expect(await desk(logistics).reprogrammer(O, court, 'cmd-rpd-fix-passee')).toEqual({ kind: 'refused', reason: 'fenetre_passee' });
    expect(await desk(logistics).reprogrammer(O, future, 'cmd-rpd-fix-again')).toEqual({ kind: 'refused', reason: 'order_not_rescheduled' });
    // A redelivery of custody's outcome AFTER the follow-up: the live course
    // names its follow-up now — settled by name, nothing recorded.
    expect(await produce({ command_id: 'w-7', orderId: O, at: T, outcome: outcome(O, T1b) }))
      .toEqual({ status: 200, json: { ok: true, status: 'tache_differente' } });
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });
    // One live course, on the follow-up task, nothing queued twice.
    const board = (await ops(logistics, '/ops/board'))['board'] as Json;
    expect((board['assignments'] as Json[]).filter((a) => a['orderId'] === O).map((a) => a['taskId'])).toEqual([fixed.value.taskId]);
    expect((board['queued'] as Json[]).filter((q) => q['orderId'] === O)).toEqual([]);

    // RETIRE takes an open reschedule with it (PURGE-ESSAI's law).
    const O2 = 'ord-reprog-doors-2';
    const { taskId: T2a } = await courseConfiee(logistics, O2, 'rider-reprog-doors-2', 'rpd2');
    expect(await produce({ command_id: 'w-8', orderId: O2, at: T, outcome: outcome(O2, T2a) }))
      .toEqual({ status: 200, json: { ok: true, status: 'enregistre' } });
    expect(await desk(logistics).reprogrammations()).toMatchObject({ kind: 'ok', value: [{ orderId: O2, taskId: T2a }] });
    // REPROGRAMMATION-2 (verifier MINOR, closed): the rider's VALID refusal
    // at the door opens the return on custody, and the retour-ouvert wire
    // lands here — the package is going home WITHOUT the founder's word. The
    // course leaves both desk lists, the passage can no longer be fixed over
    // it, and the lever home says so by name (never a relay custody would
    // refuse `return_in_progress`).
    expect((await produceDoor(logistics, '/produce/retour-ouvert', { orderId: O2, command_id: 'ro-rpd2', at: T })).json).toEqual({ ok: true, status: 'retour_ouvert' });
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });
    // (O, above, is legitimately on its 2e passage and stays listed.)
    const deuxiemes = await desk(logistics).deuxiemesPassages();
    expect(deuxiemes.kind).toBe('ok');
    if (deuxiemes.kind === 'ok') expect(deuxiemes.value.map((r) => r.orderId)).toEqual([O]);
    expect(await desk(logistics).reprogrammer(O2, future, 'cmd-rpd2-fix')).toEqual({ kind: 'refused', reason: 'order_not_rescheduled' });
    expect(await desk(logistics).renvoyer(O2, 'cmd-rpd2-rv')).toEqual({ kind: 'refused', reason: 'retour_deja_ouvert' });
    expect(hold.custodyCalls.some((c) => c.path === '/produce/return/apply'), 'no relay over an open return').toBe(false);
    expect(await desk(logistics).retirer(O2)).toEqual({ kind: 'ok', value: 'retire' });
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });
  });
});

/**
 * ═══ REPROGRAMMATION-2 — THE THREE ROADS OUT OF « ON REPASSE UN AUTRE JOUR »,
 * REAL AGAINST REAL ═══
 *
 *   console  ──POST /ops/retour/decider───────────────▶ logistics ──/produce/return/apply──▶ custody
 *   rider    ──GET /rider/moi (retourDecideAt)────────▶ logistics
 *   rider    ──/rider/return/open · /return/handover──▶ custody   (RETOUR-VIVANT-1's road, unchanged)
 *   rider    ──/rider/delivery/drop (« Le client est là »)──▶ custody, the reschedule forgotten on course-livrée
 *   logistics──POST /produce/wires/reviver (the board read)─▶ custody
 */
describe('REPROGRAMMATION-2 — the dispatcher sends a rescheduled course home, the buyer comes back before a passage is fixed, the wires heal on the board read', () => {
  it('« Renvoyer au vendeur » through the console’s own port: refused by name before custody rescheduled → after the wire, custody advances the ladder to `return` with NO fee → the reschedule leaves the desk → the rider’s session carries the decision → the road home on the two keys → custody with the seller → the course closes `returned`; a course already on its 2e passage is listed with its window and goes home the same way', async () => {
    const hold: Hold = { custodyCalls: [] };
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const custody = hold.custody!;

    const O = 'ord-reprog-renvoi';
    const RIDER = 'rider-reprog-renvoi';
    const { code, assignmentId } = await courseConfiee(logistics, O, RIDER, 'rpr');
    await jusquaLaPorte(custody, logistics, O, code, 'rpr');

    // Nothing custody said yet: the founder's words, before any relay.
    expect(await desk(logistics).renvoyer(O, 'cmd-rpr-0')).toEqual({ kind: 'refused', reason: 'course_non_reprogrammee' });
    expect(await desk(logistics, 'not-the-key').renvoyer(O, 'cmd-rpr-k')).toEqual({ kind: 'bad_key' });
    expect(hold.custodyCalls.some((c) => c.path === '/produce/return/apply'), 'no relay before the refusal by state').toBe(false);
    expect(await desk(logistics).deuxiemesPassages()).toEqual({ kind: 'ok', value: [] });

    // The ladder on the rider's door; the expiry by custody's clock; the wire.
    expect((await riderCustody(custody, '/rider/door/refusal', code, { orderId: O, command_id: 'rpr-ref', reasonCode: 'honest_absence' })).status).toBe(200);
    const expired = await custodyOps(custody, '/ops/door/expire', { orderId: O, command_id: 'rpr-exp', at: plus16() });
    expect(expired.json['outcome']).toMatchObject({ family: 'reschedule', attempt: { number: 2 } });
    await attendre(() => desk(logistics).reprogrammations(), (a) => a.kind === 'ok' && a.value.length === 1, 'the reschedule never reached the console');
    expect(await custodian(custody, O)).toBe(`courier:${RIDER}`);
    expect((await custodyEvents(custody, O)).some((e) => e.name === 'delivery.refused.v1'), 'no refusal event before the decision').toBe(false);

    // THE FOUNDER SENDS IT HOME, through the console's own port.
    const decided = await desk(logistics).renvoyer(O, 'cmd-rpr-1');
    expect(decided.kind, JSON.stringify(decided)).toBe('ok');
    if (decided.kind !== 'ok') return;
    const decideAt = decided.value.decideAt;
    expect(Number.isFinite(Date.parse(decideAt))).toBe(true);
    // The relay crossed on the produce key and custody said yes.
    expect(hold.custodyCalls.filter((c) => c.path === '/produce/return/apply')).toEqual([{ path: '/produce/return/apply', status: 200 }]);

    // ASK THE LEDGERS. Custody: the ladder reads `return`, the refusal event
    // carries fee_retained FALSE (an absence is not a refusal — founder,
    // 2026-09-17), the rider still carries. Logistics: both lists clear, the
    // reschedule forgotten (no passage can be fixed over a package going
    // home), the course still live on the board, the rider still busy.
    expect((await custodyOps(custody, '/ops/wires/reviver', { orderId: O })).json).toMatchObject({ ok: true, ladder: 'return' });
    expect(await custodian(custody, O)).toBe(`courier:${RIDER}`);
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });
    expect(await desk(logistics).deuxiemesPassages()).toEqual({ kind: 'ok', value: [] });
    const future = { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() };
    expect(await desk(logistics).reprogrammer(O, future, 'cmd-rpr-fix')).toEqual({ kind: 'refused', reason: 'order_not_rescheduled' });
    const board = (await ops(logistics, '/ops/board'))['board'] as Json;
    expect((board['assignments'] as Json[]).find((a) => a['orderId'] === O)).toMatchObject({ assignmentId, status: 'acknowledged' });
    expect((board['riders'] as Json[]).find((r) => r['riderId'] === RIDER)?.['assignable']).toBe(false);
    // IDEMPOTENT: the same command (a lost answer) and a fresh one both hear
    // the decision already made, with ITS instant — never a second relay.
    expect(await desk(logistics).renvoyer(O, 'cmd-rpr-1')).toEqual({ kind: 'ok', value: { decideAt } });
    expect(await desk(logistics).renvoyer(O, 'cmd-rpr-1-encore')).toEqual({ kind: 'ok', value: { decideAt } });
    expect(hold.custodyCalls.filter((c) => c.path === '/produce/return/apply')).toHaveLength(1);

    // THE RIDER'S PHONE: the decision on the session, raw and through the
    // app's own parser — the field the screen turns on.
    const moi = await moiAssignment(logistics, code);
    expect(moi).toMatchObject({ assignmentId, retourDecideAt: decideAt, passage: 1 });
    const parsed = await appPorts(logistics).session.signIn(code);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.session.assignment?.retourDecideAt).toBe(decideAt);
    const scelleRetour = parsed.session.assignment?.codeScelleRetour as string;
    expect(scelleRetour).toMatch(/^RS-/);

    // THE ROAD HOME — RETOUR-VIVANT-1's, untouched: the return opens on the
    // seal, logistics mints the rider's key, the supplier confirms it, both
    // keys open the handover, custody is the seller's, the course closes.
    const opened = await riderCustody(custody, '/rider/return/open', code, { orderId: O, command_id: 'rpr-ret', returnSealId: scelleRetour });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    // The refusal event custody emits as the return opens carries fee_retained
    // FALSE — an absence is not a refusal (founder, 2026-09-17).
    const refus = (await custodyEvents(custody, O)).find((e) => e.name === 'delivery.refused.v1');
    expect(refus?.payload).toMatchObject({ order_id: O, family: 'return', reason_code: 'honest_absence', fault_class: 'buyer', fee_retained: false });
    const ouvert = await attendre(() => moiAssignment(logistics, code), (a) => a !== null && typeof a['codeRetour'] === 'string', 'the retour-ouvert wire never reached logistics');
    const codeRetour = ouvert!['codeRetour'] as string;
    expect(await supplierTypes(logistics, { command_id: 'rpr-sv', orderId: O, code: codeRetour })).toEqual({ ok: true, verdict: 'confirme' });
    const confirme = await moiAssignment(logistics, code);
    const codeFournisseur = confirme!['codeRetourFournisseur'] as string;
    expect(codeFournisseur).toBeTruthy();
    let home: { status: number; json: Json } = { status: 0, json: {} };
    for (let i = 0; i < 40; i += 1) {
      home = await riderCustody(custody, '/rider/return/handover', code, { orderId: O, command_id: `rpr-ho-${i}`, sellerKey: codeFournisseur, riderKey: codeRetour });
      if (home.status === 200) break;
      expect(home.json).toMatchObject({ ok: false, reason: 'return_two_key_refused' });
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(home.status, JSON.stringify(home.json)).toBe(200);
    expect(await custodian(custody, O)).toBe(`seller:${SUPPLIER}`);
    await attendre(() => moiAssignment(logistics, code), (a) => a === null, 'the course-retournée wire never freed the rider');
    expect((await produceDoor(logistics, '/produce/course-retournee', { orderId: O, command_id: 'probe-rpr', at: T })).json)
      .toMatchObject({ ok: true, status: 'deja_retournee', assignment: { assignmentId, status: 'returned' } });
    // The lever after the fact: nothing live to decide on.
    expect(await desk(logistics).renvoyer(O, 'cmd-rpr-late')).toEqual({ kind: 'refused', reason: 'no_active_course' });
    // The buyer's code moves nothing any more.
    expect((await riderCustody(custody, '/rider/delivery/drop', code, { orderId: O, command_id: 'rpr-d-late', dropCode: 'DROP-rpr' })).status).toBe(409);

    // ═══ A COURSE ALREADY ON ITS 2E PASSAGE: listed with the window the
    // founder fixed, the rider by name — and the same lever home. ═══
    const O2 = 'ord-reprog-renvoi-2e';
    const RIDER2 = 'rider-reprog-renvoi-2e';
    const { code: code2, taskId: T1 } = await courseConfiee(logistics, O2, RIDER2, 'rpr2');
    await jusquaLaPorte(custody, logistics, O2, code2, 'rpr2');
    expect((await riderCustody(custody, '/rider/door/refusal', code2, { orderId: O2, command_id: 'rpr2-ref', reasonCode: 'unusable_location' })).status).toBe(200);
    expect((await custodyOps(custody, '/ops/door/expire', { orderId: O2, command_id: 'rpr2-exp', at: plus16() })).json['outcome']).toMatchObject({ family: 'reschedule' });
    await attendre(() => desk(logistics).reprogrammations(), (a) => a.kind === 'ok' && a.value.some((r) => r.orderId === O2), 'the second reschedule never reached the console');
    const fixed = await desk(logistics).reprogrammer(O2, future, 'cmd-rpr2-fix');
    expect(fixed.kind, JSON.stringify(fixed)).toBe('ok');
    if (fixed.kind !== 'ok') return;
    expect(await desk(logistics).deuxiemesPassages()).toEqual({
      kind: 'ok',
      value: [{ orderId: O2, taskId: fixed.value.taskId, riderName: 'Boss', passage: 2, fenetre: future }],
    });
    expect(fixed.value.taskId).not.toBe(T1);
    const decided2 = await desk(logistics).renvoyer(O2, 'cmd-rpr2-1');
    expect(decided2.kind, JSON.stringify(decided2)).toBe('ok');
    expect(await desk(logistics).deuxiemesPassages()).toEqual({ kind: 'ok', value: [] });
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });
    expect((await moiAssignment(logistics, code2))?.['retourDecideAt']).toBe(decided2.kind === 'ok' ? decided2.value.decideAt : null);
    // The follow-up task the board carried leaves with the course: the rider's
    // return opens on custody all the same (the ladder is custody's, not the task's).
    expect((await riderCustody(custody, '/rider/return/open', code2, { orderId: O2, command_id: 'rpr2-ret', returnSealId: (await moiAssignment(logistics, code2))!['codeScelleRetour'] })).status).toBe(200);
    expect((await custodyEvents(custody, O2)).find((e) => e.name === 'delivery.refused.v1')?.payload).toMatchObject({ family: 'return', reason_code: 'unusable_location', fee_retained: false });
  }, 180_000);

  it('« Le client est là »: the buyer comes back before any passage is fixed → the ordinary drop on the SAME course → the course-livrée wire closes it and the reschedule leaves the desk with it → a late redelivery of custody’s word settles by name · the founder’s board read heals custody’s wires: ONE reviver call per live course per minute, answered by custody', async () => {
    const hold: Hold = { custodyCalls: [] };
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const custody = hold.custody!;

    const O = 'ord-reprog-surplace';
    const RIDER = 'rider-reprog-surplace';
    const { code, assignmentId, taskId: T1 } = await courseConfiee(logistics, O, RIDER, 'rps');
    const { drop } = await jusquaLaPorte(custody, logistics, O, code, 'rps');
    expect((await riderCustody(custody, '/rider/door/refusal', code, { orderId: O, command_id: 'rps-ref', reasonCode: 'honest_absence' })).status).toBe(200);
    expect((await custodyOps(custody, '/ops/door/expire', { orderId: O, command_id: 'rps-exp', at: plus16() })).json['outcome']).toMatchObject({ family: 'reschedule' });
    await attendre(() => desk(logistics).reprogrammations(), (a) => a.kind === 'ok' && a.value.length === 1, 'the reschedule never reached the console');

    // THE REVIVER: the founder's board read (the desk's own reads above)
    // asked custody to heal this live course's wires, and custody answered.
    // Within the minute a second read asks nothing again.
    await attendre(async () => hold.custodyCalls.filter((c) => c.path === '/produce/wires/reviver'), (calls) => calls.length >= 1, 'the board read never revived custody’s wires');
    const revivers = hold.custodyCalls.filter((c) => c.path === '/produce/wires/reviver');
    expect(revivers).toEqual([{ path: '/produce/wires/reviver', status: 200 }]);
    await ops(logistics, '/ops/board');
    await ops(logistics, '/ops/board');
    expect(hold.custodyCalls.filter((c) => c.path === '/produce/wires/reviver')).toHaveLength(1);
    // Custody's own word on what the reviver found: the row was there, delivered.
    expect((await custodyOps(custody, '/ops/wires/reviver', { orderId: O })).json).toEqual({ ok: true, ladder: 'reschedule', reprogrammation: 'delivered' });

    // THE BUYER REAPPEARS. The rider's tap on « Le client est là » (walked in
    // rendu-retour) leads to this act: the ordinary drop, the SAME course.
    const dropped = await riderCustody(custody, '/rider/delivery/drop', code, { orderId: O, command_id: 'rps-drop', dropCode: drop });
    expect(dropped.status, JSON.stringify(dropped.json)).toBe(200);
    expect(await custodian(custody, O)).toBe('customer');
    // The course-livrée wire closes the course — and takes the open reschedule
    // with it: no ghost row on the desk, no passage to fix over a delivered order.
    await attendre(() => moiAssignment(logistics, code), (a) => a === null, 'the course never closed on the rider’s session');
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });
    expect(await desk(logistics).deuxiemesPassages()).toEqual({ kind: 'ok', value: [] });
    const board = (await ops(logistics, '/ops/board'))['board'] as Json;
    expect(board['aReprogrammer']).toEqual([]);
    expect((board['assignments'] as Json[]).some((a) => a['assignmentId'] === assignmentId)).toBe(false);
    expect((board['riders'] as Json[]).find((r) => r['riderId'] === RIDER)?.['assignable']).toBe(true);
    const future = { start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() };
    expect(await desk(logistics).reprogrammer(O, future, 'cmd-rps-fix')).toEqual({ kind: 'refused', reason: 'no_active_course' });
    expect(await desk(logistics).renvoyer(O, 'cmd-rps-rv')).toEqual({ kind: 'refused', reason: 'no_active_course' });
    // A late redelivery of custody's reschedule word: no live course — settled
    // by name, nothing recorded, the desk stays clear.
    const outcome = { taskId: T1, orderId: O, family: 'reschedule', reasonCode: 'honest_absence', humanReasonRef: 'reason.honest_absence', faultClass: 'buyer', attempt: { number: 2, at: T } };
    expect((await produceDoor(logistics, '/produce/reprogrammation', { command_id: 'w-rps-late', orderId: O, at: T, outcome })).json).toEqual({ ok: true, status: 'aucune_course' });
    expect(await desk(logistics).reprogrammations()).toEqual({ kind: 'ok', value: [] });
  }, 120_000);
});
