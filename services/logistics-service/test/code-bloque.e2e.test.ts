import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';
import { custodyWithCustomer, httpCustodyActs } from '../../../apps/rider-app/src/net/custody-acts';
import { surChaqueArticle } from '../../../apps/rider-app/src/net/colis-acts';
import { httpCourses } from '../../../apps/dispatch-console/src/courses-port';

/**
 * ═══ THE BUYER'S CODE LOCKS AFTER FIVE WRONG TRIES — REAL AGAINST REAL ═══
 *
 * Founder ruling (2026-11-26): « drop code locks after 5 tries (console
 * unlock) », counted in each article's own file (SE3). Two Miniflares run
 * the shipped bundles; the RIDER app's own ports make the gestures, and the
 * dispatch CONSOLE's own port reads the board and sends the unlock:
 *
 *   rider    ──/rider/delivery/drop (each article)──▶ custody   (strikes, lock)
 *   console  ──GET /ops/board─────────────────────▶ logistics ──/produce/drop-code/lock──▶ custody
 *   console  ──POST /ops/remise/debloquer─────────▶ logistics ──/produce/drop-code/unlock─▶ custody (every article)
 *   rider    ──/rider/delivery/drop (each article)──▶ custody ──/produce/course-livree──▶ logistics
 *
 * Asked of the ledgers, the board and the rider's session — never of an
 * answer alone.
 */

const OPS = 'test-ops-lock';
const INTAKE = 'test-intake-lock';
const VERIFY = 'test-verify-lock';
const CUSTODY_OPS = 'test-custody-ops-lock';
const PRODUCE_KEY = 'test-produce-key-lock';
const SHOP_ARM_KEY = 'test-shop-arm-key-lock';
const LIVREE_KEY = 'test-course-livree-key-lock';
const SUPPLIER = 'supplier-lock-1';

const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

type Json = Record<string, unknown>;
type CustodyHandler = (request: Request) => Promise<Response>;
interface Hold {
  custody?: Miniflare;
  logistics?: Miniflare;
  /** When set, logistics' CUSTODY binding reaches this stand-in instead. */
  stub?: CustodyHandler;
  /** When set, custody is silent ONCE on this article's unlock relay. */
  silentUnlockFor?: string;
}

function spawnCustody(hold: Hold): Miniflare {
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'lock-custody-')),
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
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'lock-logistics-')),
    serviceBindings: {
      CUSTODY: (async (request: Request) => {
        if (hold.stub !== undefined) return hold.stub(request);
        if (hold.silentUnlockFor !== undefined && new URL(request.url).pathname === '/produce/drop-code/unlock') {
          const body = (await request.clone().json().catch(() => null)) as Json | null;
          if (body?.['orderId'] === hold.silentUnlockFor) {
            hold.silentUnlockFor = undefined;
            return Response.json({ ok: false, reason: 'unavailable' }, { status: 503 });
          }
        }
        return hold.custody!.dispatchFetch(request.url, request as never);
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

async function ops(mf: Miniflare, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function intake(mf: Miniflare, path: string, body: unknown): Promise<void> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
  await res.text();
}

async function riderCustody(mf: Miniflare, path: string, code: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return { acts: httpShiftActs('http://logistics', net, fetchFn), session: httpRiderSession('http://logistics', net, fetchFn) };
}

/** The rider app's OWN custody port, pointed at the real custody Worker. */
function riderCustodyPort(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  return httpCustodyActs('http://custody', { current: () => 'online' as const }, fetchFn);
}

/** The dispatch console's OWN port. */
function desk(mf: Miniflare, key: string = OPS) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  return httpCourses('http://logistics', key, fetchFn);
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

async function custodian(custody: Miniflare, orderId: string): Promise<unknown> {
  const res = await custody.dispatchFetch(`http://custody/ops/ledger?orderId=${orderId}`, { headers: { Authorization: `Bearer ${CUSTODY_OPS}` } });
  return ((await res.json()) as Json)['currentCustodian'];
}

async function moi(mf: Miniflare, code: string): Promise<Json | null> {
  const res = await mf.dispatchFetch('http://logistics/rider/moi', { headers: { Authorization: `Bearer ${code}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { rider: Json }).rider['assignment'] as Json | null;
}

const T = '2026-11-26T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-11-26T16:00:00.000Z' };
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

/** One package course of the given articles, accepted by its rider. */
async function colisConfie(logistics: Miniflare, orderIds: string[], riderId: string, prefix: string) {
  const COLIS = { packageId: `col-${prefix}`, orderIds };
  for (const o of orderIds) {
    await intake(logistics, '/intake/funding', { orderId: o, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T, package: COLIS });
    await intake(logistics, '/intake/readiness', { orderId: o, ready: true, asOf: T, supplierRef: SUPPLIER });
  }
  const composed = await ops(logistics, '/ops/task', {
    command_id: `${prefix}-t`, orderId: orderIds[0], location: LOC, window: WIN,
    articles: orderIds.map((o, i) => ({ orderId: o, libelle: `Article ${i + 1}` })),
  });
  expect(composed.status, JSON.stringify(composed.json)).toBe(200);
  await ops(logistics, '/ops/riders', { riderId, displayName: `Boss ${prefix}`, phoneAlias: prefix });
  await ops(logistics, '/ops/riders/certify', { riderId, certified: true });
  const code = (await ops(logistics, '/ops/rider-code/mint', { riderId })).json['code'] as string;
  const { acts } = appPorts(logistics);
  await acts.ackPrivacy(code);
  expect((await acts.startShift(code)).ok).toBe(true);
  const granted = await ops(logistics, '/ops/assign', { command_id: `${prefix}-a`, taskId: composed.json['taskId'], riderId });
  expect(granted.json['ok'], JSON.stringify(granted.json)).toBe(true);
  const assignmentId = (granted.json['assignment'] as Json)['assignmentId'] as string;
  expect((await acts.accepterCourse(code, assignmentId)).ok).toBe(true);
  return { code, assignmentId };
}

describe('the buyer\'s code locks after five wrong tries, and the founder unlocks it from the console — both real Workers', () => {
  it('five wrong gestures lock both articles → the board lists the course with both orders → the console unlocks both → the right code delivers both → the course closes delivered and the list empties', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const custody = hold.custody!;
    const A = 'ord-lock-seam-a';
    const B = 'ord-lock-seam-b';
    const RIDER = 'rider-lock-seam';
    const DROP = 'DROP-LOCK-SEAM';
    const { code, assignmentId } = await colisConfie(logistics, [A, B], RIDER, 'ls');

    for (const o of [A, B]) {
      await attendre(async () => (await custody.dispatchFetch(`http://custody/ops/ledger?orderId=${o}`, { headers: { Authorization: `Bearer ${CUSTODY_OPS}` } })).status, (s) => s === 200, `chain ${o}`);
    }
    const signed = await appPorts(logistics).session.signIn(code);
    if (!signed.ok) throw new Error('sign-in refused');
    const a = signed.session.assignment!;
    for (const o of [A, B]) {
      expect((await riderCustody(custody, '/rider/verification', code, { orderId: o, command_id: `v-${o}`, presentedPickupCode: a.codeVerification, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${o}` })).json).toMatchObject({ ok: true, kind: 'accepted' });
      const b = await riderCustody(custody, '/rider/custody/begin', code, { orderId: o, command_id: `b-${o}`, custodySealId: a.codeScelle, sealPhotoRefs: [] });
      const chain = b.json['chain'] as Json;
      const armed = await custody.dispatchFetch('http://custody/produce-shop/secrets/arm', {
        method: 'POST', headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: o, command_id: `arm-${o}`, kind: 'buyer_drop_code', secret: DROP }),
      });
      expect(armed.status).toBe(200);
      await armed.text();
      expect((await riderCustody(custody, '/rider/delivery/evidence', code, {
        orderId: o, command_id: `e-${o}`,
        bundle: { taskId: chain['task_id'], packageId: chain['package_id'], custodySealId: a.codeScelle, artifacts: [], capturedAt: T },
      })).json).toMatchObject({ ok: true, status: 'evidence_recorded' });
      await riderCustody(custody, '/rider/door/inspection', code, {
        orderId: o, command_id: `i-${o}`, inspectionCategory: 'uncategorised_conservative', packageOpened: false, manufacturerSealOpened: false,
        custodySealIntact: true, buyerAccepts: true, startedAt: T, completedAt: T, evidenceBundleId: `sans-photo-porte-${o}`,
      });
    }

    // The board before: nothing locked, nothing partial.
    expect(await desk(logistics).codesBloques()).toEqual({ kind: 'ok', value: { rows: [], partiel: false } });

    // ── FIVE WRONG GESTURES, each carried to every article by the app's own carrier ──
    const port = riderCustodyPort(custody);
    const geste = (n: string, dropCode: string) => surChaqueArticle(
      [A, B],
      (orderId) => `geste-${n}-${orderId}` as never,
      (orderId, commandId) => port.confirmDrop({ commandId, orderId, dropCode }, code),
      custodyWithCustomer,
      { jusquauBout: true },
    );
    for (let i = 1; i <= 4; i += 1) expect(await geste(`w${i}`, `FAUX-${i}`), `gesture ${i}`).toEqual({ kind: 'refused', reason: 'drop_code_refused' });
    expect(await geste('w5', 'FAUX-5')).toEqual({ kind: 'refused', reason: 'drop_code_locked' });
    expect(await geste('locked-right', DROP), 'the right code while locked').toEqual({ kind: 'refused', reason: 'drop_code_locked' });
    for (const o of [A, B]) expect(await custodian(custody, o), o).toBe(`courier:${RIDER}`);

    // ── THE BOARD SAYS SO, through the console's own port ──
    const listed = await desk(logistics).codesBloques();
    expect(listed.kind).toBe('ok');
    if (listed.kind !== 'ok') return;
    expect(listed.value.partiel).toBe(false);
    expect(listed.value.rows).toEqual([expect.objectContaining({ assignmentId, riderId: RIDER, orderIds: [A, B] })]);
    expect(Number.isFinite(Date.parse(listed.value.rows[0]!.depuis))).toBe(true);
    const boardRaw = JSON.stringify((await ops(logistics, '/ops/board')).json);
    expect(boardRaw.includes(DROP), 'the board never carries the code').toBe(false);

    // ── WRONG KEY, AND AN ORDER WITH NO LIVE COURSE, SAID BY NAME ──
    expect(await desk(logistics, 'pas-la-cle').debloquer(A, 'cmd-x')).toEqual({ kind: 'bad_key' });
    expect(await desk(logistics).debloquer('ord-inconnue', 'cmd-y')).toEqual({ kind: 'refused', reason: 'no_active_course' });
    expect((await desk(logistics).codesBloques()).kind === 'ok' && (await desk(logistics).codesBloques() as { value: { rows: unknown[] } }).value.rows.length).toBe(1);

    // ── THE FOUNDER UNLOCKS FROM THE CONSOLE — B's custody is silent once:
    //    the whole answer is that failure, never « débloqué » ──
    hold.silentUnlockFor = B;
    expect(await desk(logistics).debloquer(B, 'cmd-console-debloque-1')).toEqual({ kind: 'refused', reason: 'custody_unreachable' });
    const half = await desk(logistics).codesBloques();
    expect(half, 'A heard it, B is still locked').toMatchObject({ kind: 'ok', value: { rows: [{ assignmentId, orderIds: [B] }], partiel: false } });
    // The retry under the SAME command id re-sends to every article: A
    // replays its recorded answer, B unlocks.
    expect(await desk(logistics).debloquer(B, 'cmd-console-debloque-1')).toEqual({ kind: 'ok', value: { status: 'debloque' } });
    for (const o of [A, B]) {
      const lock = await custody.dispatchFetch(`http://custody/ops/drop-code/lock?orderId=${o}`, { headers: { Authorization: `Bearer ${CUSTODY_OPS}` } });
      expect(await lock.json(), o).toMatchObject({ locked: false });
    }
    expect(await desk(logistics).codesBloques()).toEqual({ kind: 'ok', value: { rows: [], partiel: false } });

    // ── THE RIGHT CODE DELIVERS BOTH; logistics closes the course ──
    expect(await geste('right', DROP)).toMatchObject({ kind: 'recorded', body: { status: 'custody_with_customer' } });
    for (const o of [A, B]) expect(await custodian(custody, o), o).toBe('customer');
    await attendre(() => moi(logistics, code), (x) => x === null, 'the course never closed delivered');
    expect(await desk(logistics).codesBloques()).toEqual({ kind: 'ok', value: { rows: [], partiel: false } });
  }, 120_000);

  it('the board reads at most 32 article locks, in board order, and says the list may be partial when the cap is hit or a read fails', async () => {
    const hold: Hold = {};
    const lockReads: string[] = [];
    let failOne: string | null = null;
    // A stand-in for custody's produce door, answering exactly the shapes the
    // real Worker answers (`{ok:true, status}` on acts, `{ok, locked, since}`
    // on the lock read). It records every lock read so the cap is asked of
    // the wire, not of the board.
    hold.stub = async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/produce/drop-code/lock') {
        const orderId = url.searchParams.get('orderId') ?? '';
        lockReads.push(orderId);
        if (orderId === failOne) return Response.json({ ok: false, reason: 'unavailable' }, { status: 503 });
        return Response.json({ ok: true, locked: true, since: T });
      }
      if (url.pathname === '/produce/custodian') return Response.json({ ok: true, custodian: null });
      return Response.json({ ok: true, status: 'recorded' });
    };
    spawnLogistics(hold);
    const logistics = hold.logistics!;
    // Four packages of ten articles: forty articles on live courses.
    for (let p = 0; p < 4; p += 1) {
      const ids = Array.from({ length: 10 }, (_, i) => `ord-cap-${p}-${i}`);
      await colisConfie(logistics, ids, `rider-cap-${p}`, `cap${p}`);
    }
    lockReads.length = 0;
    const capped = await desk(logistics).codesBloques();
    expect(lockReads.length, 'never more than 32 reads per board read').toBe(32);
    expect(capped.kind === 'ok' && capped.value.partiel, 'the cap is said').toBe(true);
    if (capped.kind !== 'ok') return;
    const listedIds = capped.value.rows.flatMap((r) => r.orderIds);
    expect(listedIds.every((o) => lockReads.includes(o)), 'only what was read is listed').toBe(true);
    expect(listedIds.length).toBe(32);

    // One read failing, under the cap: the list is partial too.
    await ops(logistics, '/ops/order/retirer', { command_id: 'cap-r3', orderId: 'ord-cap-3-0', colisEntier: true });
    await ops(logistics, '/ops/order/retirer', { command_id: 'cap-r2', orderId: 'ord-cap-2-0', colisEntier: true });
    failOne = 'ord-cap-1-4';
    lockReads.length = 0;
    const failed = await desk(logistics).codesBloques();
    expect(lockReads.length).toBe(20);
    expect(failed.kind === 'ok' && failed.value.partiel, 'a failed read is said').toBe(true);
    if (failed.kind !== 'ok') return;
    expect(failed.value.rows.flatMap((r) => r.orderIds)).not.toContain('ord-cap-1-4');
  }, 180_000);
});
