import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deserialize } from 'node:v8';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';

/**
 * ═══ DISPATCH STORAGE STAYS BOUNDED BY ACTIVE WORK — on the REAL Worker ═══
 *
 * The dispatch object keeps its hot state in a few snapshot values, each ONE
 * storage value with the platform's per-value cap. This file holds three
 * rules against the real bundle, through the Worker's own doors and the rider
 * app's own accept port, and asks the STORED values (read back from the
 * object's SQLite file) rather than any response:
 *
 *   1. a read that expires nothing stores nothing;
 *   2. a closed course leaves the hot snapshots for its own per-order record,
 *      so their size follows the work in flight, never the history — even
 *      when custody was still answering for that course as it closed — and
 *      every replay of a closed course still answers as it did;
 *   3. a save the storage refuses fails by name, and the object then serves
 *      only what was stored; a value past the engineering bound (1 MiB, half
 *      the per-value cap) leaves an alert the founder can read.
 *
 * Counts: the default run is sized for every push; the full definition-of-
 * done run is `STOCKAGE_COURSES=2000 STOCKAGE_LECTURES=31000`.
 */

const OPS = 'test-ops-stockage';
const INTAKE = 'test-intake-stockage';
const VERIFY = 'test-verify-stockage';
const LIVREE = 'test-livree-stockage';
const PRODUCE = 'test-produce-stockage';
const CUSTODY_OPS = 'test-custody-ops-stockage';
const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');
const BORNE = 1_048_576;

const COURSES = Number(process.env['STOCKAGE_COURSES'] ?? 150);
const LECTURES = Number(process.env['STOCKAGE_LECTURES'] ?? 1_000);

type Json = Record<string, unknown>;

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

function spawn(custody?: (request: Request) => Promise<Response>): { mf: Miniflare; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'stockage-borne-'));
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: dir,
    ...(custody !== undefined ? { serviceBindings: { CUSTODY: custody as never } } : {}),
    bindings: {
      SERA_OPS_SECRET: OPS,
      SERA_INTAKE_SECRET: INTAKE,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_COURSE_LIVREE_SECRET: LIVREE,
      ...(custody !== undefined ? { SERA_PRODUCE_SECRET: PRODUCE } : {}),
    },
  });
  live.push(mf);
  return { mf, dir };
}

/**
 * The REAL custody Worker behind the dispatch object's binding, with one
 * hold: the next call `retenir` names waits until the test lets it go. A
 * real binding allows exactly that — an outbound call never holds the
 * object's input gate, so other requests run while it waits. Every call
 * still reaches custody and gets custody's own answer, except where a test
 * passes `commeCustody`: then the held call gets custody's own recorded
 * success body for that door, for a call this test cannot bring custody's
 * ledger to accept (the founder's return needs a chain custody rescheduled).
 */
function custodyRetenue(logistics: () => Miniflare) {
  const custody = new Miniflare({
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'stockage-custody-')),
    serviceBindings: { LOGISTICS: ((request: Request) => logistics().dispatchFetch(request.url, request as never)) as never },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: CUSTODY_OPS,
      SERA_PRODUCE_SECRET: PRODUCE,
      SHOP_ARM_SECRET: 'test-shop-arm-stockage',
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_COURSE_LIVREE_SECRET: LIVREE,
    },
  });
  live.push(custody);
  const appels: { path: string; corps: string }[] = [];
  let quand: ((path: string, corps: string) => boolean) | undefined;
  let arrive = (): void => undefined;
  let lache: Promise<void> = Promise.resolve();
  let reponse: (() => Response) | undefined;
  const binding = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const corps = request.method === 'POST' ? await request.clone().text() : url.search;
    appels.push({ path: url.pathname, corps });
    if (quand?.(url.pathname, corps) === true) {
      quand = undefined;
      arrive();
      await lache;
      const tenue = reponse;
      reponse = undefined;
      if (tenue !== undefined) return tenue();
    }
    return custody.dispatchFetch(request.url, request as never) as never;
  };
  const retenir = (match: (path: string, corps: string) => boolean, commeCustody?: () => Response) => {
    let lacher = (): void => undefined;
    lache = new Promise<void>((r) => (lacher = r));
    const arrivee = new Promise<void>((r) => (arrive = r));
    quand = match;
    reponse = commeCustody;
    return {
      arrivee: () => Promise.race([arrivee, new Promise<never>((_, non) => setTimeout(() => non(new Error('the held custody call never came')), 10_000))]),
      lacher: () => lacher(),
    };
  };
  return { binding, appels, retenir };
}

async function attendre(pret: () => boolean, pourquoi: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (pret()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(pourquoi);
}

/** Every stored value of the dispatch object, straight off its SQLite file. */
function stored(dir: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (d: string): void => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.sqlite') && f !== 'metadata.sqlite') {
        const db = new DatabaseSync(p, { readOnly: true });
        for (const row of db.prepare('SELECT key, value FROM _cf_KV').all() as { key: string; value: Uint8Array }[]) {
          out.set(row.key, row.value);
        }
        db.close();
      }
    }
  };
  walk(dir);
  return out;
}

function snapSizes(dir: string): Record<string, number> {
  return Object.fromEntries([...stored(dir)].filter(([k]) => k.startsWith('snap:')).map(([k, v]) => [k, v.byteLength]));
}

function lu<T>(dir: string, key: string): T | undefined {
  const v = stored(dir).get(key);
  return v === undefined ? undefined : (deserialize(Buffer.from(v)) as T);
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
    sansCle: (path: string) => call('pas-la-cle', path),
    intake: (path: string, body: unknown) => call(INTAKE, path, body),
    produce: (path: string, body: unknown) => call(LIVREE, path, body),
    rider: (code: string, path: string, body?: unknown) => call(code, path, body),
    acts: httpShiftActs('http://logistics', createManualConnectivity('online'), fetchFn),
  };
}

type Doors = ReturnType<typeof doors>;

const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const fenetre = () => ({ start: new Date().toISOString(), end: new Date(Date.now() + 8 * 3_600_000).toISOString() });

async function riderEnService(d: Doors, riderId: string): Promise<string> {
  expect((await d.ops('/ops/riders', { riderId, displayName: 'Boss', phoneAlias: riderId })).status).toBe(200);
  expect((await d.ops('/ops/riders/certify', { riderId, certified: true })).status).toBe(200);
  const code = (await d.ops('/ops/rider-code/mint', { riderId })).json['code'] as string;
  expect((await d.acts.ackPrivacy(code)).ok).toBe(true);
  expect((await d.acts.startShift(code)).ok).toBe(true);
  return code;
}

async function faits(d: Doors, orderId: string, asOf: string, colis?: unknown): Promise<void> {
  expect((await d.intake('/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf, ...(colis !== undefined ? { package: colis } : {}) })).status).toBe(200);
  expect((await d.intake('/intake/readiness', { orderId, ready: true, asOf, supplierRef: 'sup-stockage' })).status).toBe(200);
}

/** One course through the real doors, up to the rider's own accept. */
async function courseAcceptee(d: Doors, code: string, riderId: string, orderId: string, tag: string): Promise<{ taskId: string; assignmentId: string }> {
  const composed = await d.ops('/ops/task', { command_id: `t-${tag}`, orderId, location: LOC, window: fenetre() });
  expect(composed.status, JSON.stringify(composed.json)).toBe(200);
  const taskId = composed.json['taskId'] as string;
  const granted = await d.ops('/ops/assign', { command_id: `a-${tag}`, taskId, riderId });
  expect(granted.status, JSON.stringify(granted.json)).toBe(200);
  const assignmentId = (granted.json['assignment'] as Json)['assignmentId'] as string;
  expect(await d.acts.accepterCourse(code, assignmentId)).toEqual({ ok: true });
  return { taskId, assignmentId };
}

async function livrer(d: Doors, orderId: string, tag: string): Promise<Json> {
  const res = await d.produce('/produce/course-livree', { command_id: `l-${tag}`, orderId, at: new Date().toISOString() });
  expect(res.status).toBe(200);
  return res.json;
}

describe('dispatch storage stays bounded by active work, on the real Worker', () => {
  it('a board or rider read that expires nothing stores nothing', async () => {
    const { mf, dir } = spawn();
    const d = doors(mf);
    const RIDER = 'rider-lectures';
    const code = await riderEnService(d, RIDER);
    const O = 'ord-lectures-1';
    await faits(d, O, new Date().toISOString());
    await courseAcceptee(d, code, RIDER, O, 'lect');
    await livrer(d, O, 'lect');

    // A write that changes nothing, so every snapshot is on disk before and after.
    const neutre = async () => expect((await d.ops('/ops/riders/certify', { riderId: RIDER, certified: true })).status).toBe(200);
    await neutre();
    const avant = snapSizes(dir);
    for (let i = 0; i < 300; i++) {
      expect((await d.ops('/ops/board')).status).toBe(200);
      expect((await d.rider(code, '/rider/moi')).status).toBe(200);
    }
    await neutre();
    expect(snapSizes(dir)).toEqual(avant);
    // 600 reads through the real Worker: ~1-3 s alone, past vitest's 5 s default under a CI runner's parallel load.
  }, 60_000);

  it(`after ${COURSES} delivered courses and ${LECTURES} reads, every stored snapshot stays under 1 MiB and does not grow with the history; the next « Accepter » succeeds; the history is kept per order`, async () => {
    const { mf, dir } = spawn();
    const d = doors(mf);
    const RIDER = 'rider-volume';
    const code = await riderEnService(d, RIDER);
    const asOf = new Date().toISOString();
    const ms: number[] = [];
    let repere: Record<string, number> = {};
    const REPERE = 10;
    for (let k = 0; k < COURSES; k++) {
      const t0 = performance.now();
      const O = `ord-vol-${k}`;
      await faits(d, O, asOf);
      await courseAcceptee(d, code, RIDER, O, `vol-${k}`);
      expect((await livrer(d, O, `vol-${k}`))['status']).toBe('livree');
      ms.push(performance.now() - t0);
      if (k === REPERE - 1) repere = snapSizes(dir);
    }
    for (let i = 0; i < LECTURES; i++) {
      if (i % 2 === 0) expect((await d.ops('/ops/board')).status).toBe(200);
      else expect((await d.rider(code, '/rider/moi')).status).toBe(200);
    }
    expect((await d.ops('/ops/riders/certify', { riderId: RIDER, certified: true })).status).toBe(200);

    const apres = snapSizes(dir);
    const head = ms.slice(0, 150);
    const tail = ms.slice(-150);
    const moyenne = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    console.log(`STOCKAGE sizes after ${REPERE} courses: ${JSON.stringify(repere)}`);
    console.log(`STOCKAGE sizes after ${COURSES} courses + ${LECTURES} reads: ${JSON.stringify(apres)}`);
    console.log(`STOCKAGE ms per course: first ${head.length} ${moyenne(head)} · last ${tail.length} ${moyenne(tail)}`);

    for (const [key, bytes] of Object.entries(apres)) expect(bytes, key).toBeLessThan(BORNE);
    // Bounded by active work: between course 10 and course N every hot value
    // stays where it was, give or take a counter's digits — except the fleet
    // log, which is the fleet yardstick's own history (one row per course,
    // ~94 bytes) and is pinned at that rate here so it cannot quietly worsen.
    const enPlus = COURSES - REPERE;
    for (const [key, bytes] of Object.entries(apres)) {
      const permis = key === 'snap:flotte:v1' ? 110 * enPlus : 256;
      expect(bytes - (repere[key] ?? 0), key).toBeLessThanOrEqual(permis);
    }

    // The history is KEPT, per order, in storage — never deleted.
    const archives = [...stored(dir).keys()].filter((k) => k.startsWith('course:v1:'));
    expect(archives.length).toBe(COURSES);
    const premier = lu<Json>(dir, 'course:v1:ord-vol-0');
    expect(JSON.stringify(premier)).toContain('"status":"delivered"');

    // The next course is accepted through the rider app's own port.
    const O = 'ord-vol-suivant';
    await faits(d, O, asOf);
    await courseAcceptee(d, code, RIDER, O, 'vol-suivant');
  }, 3_600_000);

  it('a closed course answers every replay as it did', async () => {
    const { mf } = spawn();
    const d = doors(mf);
    const RIDER = 'rider-rejeux';
    const code = await riderEnService(d, RIDER);
    const O = 'ord-rejeux';
    const asOf = new Date().toISOString();
    await faits(d, O, asOf);
    const { taskId, assignmentId } = await courseAcceptee(d, code, RIDER, O, 'rj');
    const vue = (await d.rider(code, '/rider/moi')).json['rider'] as Json;
    const codes = [(vue['assignment'] as Json)['codeVerification'], (vue['assignment'] as Json)['codeRamassage']] as string[];
    expect(codes.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);

    const premier = await livrer(d, O, 'rj');
    expect(premier).toMatchObject({ ok: true, status: 'livree', leaseReleased: true });

    // custody's wire, redelivered: the duplicate answer, byte for byte.
    expect(await livrer(d, O, 'rj')).toEqual({
      ok: true,
      status: 'deja_livree',
      leaseReleased: false,
      assignment: { ...(premier['assignment'] as Json) },
    });
    // the rider's accept and refusal on the closed course: refused by name, not « unknown ».
    expect(await d.rider(code, '/rider/assignment/ack', { assignmentId })).toEqual({ status: 409, json: { ok: false, reason: 'not_active', anchored: false } });
    expect(await d.acts.accepterCourse(code, assignmentId)).toEqual({ ok: false, reason: 'refused', refus: 'not_active' });
    expect(await d.rider(code, '/rider/assignment/decline', { assignmentId })).toEqual({ status: 409, json: { ok: false, reason: 'not_active', leaseReleased: false } });
    // a foreign rider still hears « unknown », never a hint the course exists.
    const autre = await riderEnService(d, 'rider-etranger');
    expect(await d.rider(autre, '/rider/assignment/ack', { assignmentId })).toEqual({ status: 404, json: { ok: false, reason: 'unknown_assignment' } });
    // the dispatcher's doors.
    expect(await d.ops('/ops/assignment/take-back', { command_id: 'tb-rj', assignmentId, custodyNotBegun: true })).toEqual({ status: 409, json: { ok: false, reason: 'not_active' } });
    expect(await d.ops('/ops/task', { command_id: 't-rj', orderId: O, location: LOC, window: fenetre() })).toEqual({ status: 200, json: { ok: true, admitted: true, duplicate: true, taskId } });
    expect(await d.ops('/ops/task', { command_id: 't-rj-encore', orderId: O, location: LOC, window: fenetre() })).toEqual({ status: 409, json: { ok: false, reason: 'order_already_has_task', taskId, status: 'assigned' } });
    expect(await d.ops('/ops/assign', { command_id: 'a-rj', taskId, riderId: RIDER })).toEqual({ status: 409, json: { ok: false, stage: 'lease', reason: 'eligibility_not_attested' } });
    // the producers' facts, redelivered: the same answers, and the order never
    // comes back to « à préparer ».
    expect(await d.intake('/intake/funding', { orderId: O, status: 'funded', paymentMode: 'FULL_PREPAY', asOf })).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });
    expect(await d.intake('/intake/funding', { orderId: O, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: '2026-01-01T00:00:00.000Z' })).toEqual({ status: 200, json: { ok: true, orderId: O, applied: false, reason: 'older_fact_ignored' } });
    expect(await d.intake('/intake/readiness', { orderId: O, ready: true, asOf, supplierRef: 'sup-stockage' })).toEqual({ status: 200, json: { ok: true, orderId: O, applied: true } });
    expect(((await d.ops('/ops/a-preparer')).json['attente'] as Json[]).map((r) => r['orderId'])).not.toContain(O);
    // The pickup and handover codes moved with the record and no door gives
    // them back: not a replay, not the board, not the rider's own read, not
    // the size watch.
    const lus = [
      await livrer(d, O, 'rj'),
      await d.rider(code, '/rider/assignment/ack', { assignmentId }),
      await d.ops('/ops/assignment/take-back', { command_id: 'tb-rj', assignmentId, custodyNotBegun: true }),
      await d.ops('/ops/task', { command_id: 't-rj', orderId: O, location: LOC, window: fenetre() }),
      await d.ops('/ops/board'),
      await d.ops('/ops/a-preparer'),
      await d.ops('/ops/stockage'),
      await d.rider(code, '/rider/moi'),
    ];
    for (const c of codes) expect(JSON.stringify(lus)).not.toContain(c);
    // and the rider is free for the next one.
    const O2 = 'ord-rejeux-2';
    await faits(d, O2, asOf);
    await courseAcceptee(d, code, RIDER, O2, 'rj2');
  });

  it('a closed course leaves the hot book, queue and lease for its own stored record; the founder\'s retire then answers « inconnu »', async () => {
    const { mf, dir } = spawn();
    const d = doors(mf);
    const RIDER = 'rider-archive';
    const code = await riderEnService(d, RIDER);
    const O = 'ord-archive';
    await faits(d, O, new Date().toISOString());
    const { taskId, assignmentId } = await courseAcceptee(d, code, RIDER, O, 'arc');
    expect(JSON.stringify(lu(dir, 'snap:book:v1'))).toContain(assignmentId);
    expect((await livrer(d, O, 'arc'))['status']).toBe('livree');
    for (const key of ['snap:book:v1', 'snap:queue:v1', 'snap:lease:v1', 'snap:projections:v1', 'snap:custody-outbox:v1', 'snap:code-verification:v1', 'snap:ramassage:v1', 'snap:briefs:v1']) {
      const chaud = JSON.stringify(lu(dir, key));
      expect(chaud, key).not.toContain(assignmentId);
      expect(chaud, key).not.toContain(taskId);
      expect(chaud, key).not.toContain(O);
    }
    const archive = JSON.stringify(lu(dir, `course:v1:${O}`));
    expect(archive).toContain(assignmentId);
    expect(archive).toContain(taskId);
    expect(archive).toContain('"deliveredAt"');
    // The board no longer holds that order: the founder's retire says so.
    expect(await d.ops('/ops/order/retirer', { command_id: 'r-arc', orderId: O })).toEqual({ status: 200, json: { ok: true, status: 'inconnu' } });
    expect(stored(dir).has(`course:v1:${O}`)).toBe(true);
  });

  it('a producer-composed task, a returned course and a package answer their replays as they did after they close', async () => {
    const { mf } = spawn();
    const d = doors(mf);
    const RIDER = 'rider-rejeux-b';
    const code = await riderEnService(d, RIDER);
    const asOf = new Date().toISOString();

    // A task the producer's wire put in the queue.
    const P = 'ord-producteur';
    await faits(d, P, asOf);
    const evenement = (commandId: string) => ({
      name: 'logistics.task_ready.v1',
      envelope: { command_id: commandId, correlation_id: `corr-${P}`, aggregateVersion: 1, actor: 'boutik-plus:offer-service', serverTime: asOf, version: '1' },
      payload: { task: { type: 'delivery', id: `task-${P}`, orderId: P, location: { zone: 'Gounghin', landmark: 'Face à la pharmacie', directions: '', maskedRelay: '' }, window: fenetre(), status: 'ready' } },
    });
    expect(await d.intake('/intake/task-ready', evenement('cmd-prod'))).toEqual({ status: 200, json: { ok: true, admitted: true, duplicate: false, taskId: `task-${P}` } });
    const granted = await d.ops('/ops/assign', { command_id: 'a-prod', taskId: `task-${P}`, riderId: RIDER });
    expect(granted.status).toBe(200);
    expect(await d.acts.accepterCourse(code, (granted.json['assignment'] as Json)['assignmentId'] as string)).toEqual({ ok: true });
    expect((await livrer(d, P, 'prod'))['status']).toBe('livree');
    expect(await d.intake('/intake/task-ready', evenement('cmd-prod'))).toEqual({ status: 200, json: { ok: true, admitted: true, duplicate: true, taskId: `task-${P}` } });
    expect(await d.intake('/intake/task-ready', evenement('cmd-prod-autre'))).toEqual({ status: 422, json: { ok: false, admitted: false, reason: 'task_id_already_claimed' } });

    // A course closed by the return road.
    const R = 'ord-retour';
    await faits(d, R, asOf);
    await courseAcceptee(d, code, RIDER, R, 'ret');
    const rendu = await d.produce('/produce/course-retournee', { command_id: 'cr-1', orderId: R, at: new Date().toISOString() });
    expect(rendu.json).toMatchObject({ ok: true, status: 'retournee', leaseReleased: true });
    expect(await d.produce('/produce/course-retournee', { command_id: 'cr-1', orderId: R, at: new Date().toISOString() })).toEqual({
      status: 200,
      json: { ok: true, status: 'deja_retournee', leaseReleased: false, assignment: { ...(rendu.json['assignment'] as Json) } },
    });

    // A package of two articles: one course, closed when the last one settles.
    const A = 'ord-colis-a';
    const B = 'ord-colis-b';
    const COLIS = { packageId: 'col-stockage', orderIds: [A, B] };
    await faits(d, A, asOf, COLIS);
    await faits(d, B, asOf, COLIS);
    await courseAcceptee(d, code, RIDER, A, 'col');
    const articles = async () => (((await d.rider(code, '/rider/moi')).json['rider'] as Json)['assignment'] as Json)['colis'] as Json;
    const avantA = await articles();
    expect(await livrer(d, A, 'col-a')).toMatchObject({ ok: true, status: 'colis_en_cours', reste: 1 });
    // A delivered, B still on the road: nothing of the package leaves yet —
    // the rider's view shows every article's chain exactly as before.
    const apresA = await articles();
    const chaines = (v: Json) => (v['articles'] as Json[]).map((a) => [a['orderId'], a['chaine']]);
    expect(chaines(apresA)).toEqual(chaines(avantA));
    expect((apresA['articles'] as Json[]).map((a) => a['etat'])).toEqual(['livree', 'en_cours']);
    expect(await livrer(d, B, 'col-b')).toMatchObject({ ok: true, status: 'livree' });
    expect(await livrer(d, A, 'col-a')).toEqual({ ok: true, status: 'deja_livree' });
    expect(await livrer(d, B, 'col-b')).toEqual({ ok: true, status: 'deja_livree' });
    expect(await d.intake('/intake/funding', { orderId: B, status: 'funded', paymentMode: 'FULL_PREPAY', asOf, package: { packageId: 'col-autre', orderIds: [B, 'ord-x'] } })).toEqual({ status: 409, json: { ok: false, reason: 'package_contradicts_stored' } });
    expect(await d.ops('/ops/task', { command_id: 't-col-b', orderId: B, location: LOC, window: fenetre() })).toMatchObject({ status: 409, json: { ok: false, reason: 'order_already_has_task' } });
  });

  it('the largest close — a package of ten articles — moves in one write: ten records stored, nothing of it left hot', async () => {
    const { mf, dir } = spawn();
    const d = doors(mf);
    const RIDER = 'rider-dix';
    const code = await riderEnService(d, RIDER);
    const asOf = new Date().toISOString();
    const ids = Array.from({ length: 10 }, (_, i) => `ord-dix-${i}`);
    const COLIS = { packageId: 'col-dix', orderIds: ids };
    for (const id of ids) await faits(d, id, asOf, COLIS);
    const { assignmentId } = await courseAcceptee(d, code, RIDER, ids[0]!, 'dix');
    for (const id of ids.slice(0, -1)) expect((await livrer(d, id, id))['status']).toBe('colis_en_cours');
    expect([...stored(dir).keys()].filter((k) => k.startsWith('course:v1:'))).toEqual([]);
    expect((await livrer(d, ids[9]!, ids[9]!))['status']).toBe('livree');
    const cles = [...stored(dir).keys()];
    expect(cles.filter((k) => k.startsWith('course:v1:')).sort()).toEqual(ids.map((id) => `course:v1:${id}`).sort());
    // The fleet log is the fleet yardstick's own per-course history, kept by
    // design and bounded by its own follow-on, not by this move.
    for (const key of cles.filter((k) => k.startsWith('snap:') && k !== 'snap:flotte:v1')) {
      const chaud = JSON.stringify(lu(dir, key));
      expect(chaud, key).not.toContain(assignmentId);
      for (const id of ids) expect(chaud, key).not.toContain(id);
    }
    for (const id of ids) expect(await livrer(d, id, id)).toEqual({ ok: true, status: 'deja_livree' });
  });

  it('a second passage fixed by the founder answers its replay the same after the course closes', async () => {
    const { mf } = spawn();
    const d = doors(mf);
    const RIDER = 'rider-passage';
    const code = await riderEnService(d, RIDER);
    const O = 'ord-passage';
    await faits(d, O, new Date().toISOString());
    const { taskId } = await courseAcceptee(d, code, RIDER, O, 'pas');
    const issue = { taskId, orderId: O, family: 'reschedule', reasonCode: 'honest_absence', humanReasonRef: 'reason.honest_absence', faultClass: 'buyer', attempt: { number: 2, at: new Date().toISOString() } };
    expect(await d.produce('/produce/reprogrammation', { command_id: 'w-pas', orderId: O, at: new Date().toISOString(), outcome: issue })).toEqual({ status: 200, json: { ok: true, status: 'enregistre' } });
    const fen = fenetre();
    const fixe = await d.ops('/ops/reprogrammer', { command_id: 'rp-pas', orderId: O, fenetre: fen });
    expect(fixe.status, JSON.stringify(fixe.json)).toBe(200);
    const rejeuAvant = await d.ops('/ops/reprogrammer', { command_id: 'rp-pas', orderId: O, fenetre: fen });
    expect(rejeuAvant.json).toMatchObject({ ok: true, duplicate: true, taskId: fixe.json['taskId'] });
    expect((await livrer(d, O, 'pas'))['status']).toBe('livree');
    expect(await d.ops('/ops/reprogrammer', { command_id: 'rp-pas', orderId: O, fenetre: fen })).toEqual(rejeuAvant);
  });

  /*
   * A course can close while the object is waiting on custody for that very
   * course (custody's answer is an outbound call; other requests run
   * meanwhile). Whatever the waiting work then writes back must not bring
   * the closed course into the hot snapshots again. The next alarm is the
   * witness that the first one finished: alarms never overlap.
   */
  it('a custody read still in flight when the course closes does not bring the course back', async () => {
    let mf!: Miniflare;
    const custody = custodyRetenue(() => mf);
    const spawned = spawn(custody.binding);
    mf = spawned.mf;
    const d = doors(mf);
    const RIDER = 'rider-lecture';
    const code = await riderEnService(d, RIDER);
    const O = 'ord-lecture';
    await faits(d, O, new Date().toISOString());
    await courseAcceptee(d, code, RIDER, O, 'lec');
    const tenue = custody.retenir((path) => path === '/produce/custodian');
    const lecture = d.rider(code, '/rider/moi');
    await tenue.arrivee();
    expect((await livrer(d, O, 'lec'))['status']).toBe('livree');
    tenue.lacher();
    expect((await lecture).status).toBe(200);
    expect(lu<Json>(spawned.dir, `course:v1:${O}`)).toMatchObject({ orderId: O });
    expect(JSON.stringify(lu(spawned.dir, 'snap:custody-facts:v1') ?? {})).not.toContain(O);
  });

  it('a producer call still in flight when the course closes does not bring its custody row back', async () => {
    let mf!: Miniflare;
    const custody = custodyRetenue(() => mf);
    const spawned = spawn(custody.binding);
    mf = spawned.mf;
    const d = doors(mf);
    const RIDER = 'rider-fil';
    const code = await riderEnService(d, RIDER);
    const [O1, O2] = ['ord-fil-1', 'ord-fil-2'];
    for (const o of [O1, O2]) await faits(d, o, new Date().toISOString());
    const t1 = (await d.ops('/ops/task', { command_id: 't-fil-1', orderId: O1, location: LOC, window: fenetre() })).json['taskId'] as string;
    const t2 = (await d.ops('/ops/task', { command_id: 't-fil-2', orderId: O2, location: LOC, window: fenetre() })).json['taskId'] as string;
    const tenue = custody.retenir((path, corps) => path === '/produce/order/open' && corps.includes(O1));
    const a1 = await d.ops('/ops/assign', { command_id: 'a-fil-1', taskId: t1, riderId: RIDER });
    expect(a1.status, JSON.stringify(a1.json)).toBe(200);
    await tenue.arrivee();
    expect(await d.acts.accepterCourse(code, (a1.json['assignment'] as Json)['assignmentId'] as string)).toEqual({ ok: true });
    expect((await livrer(d, O1, 'fil'))['status']).toBe('livree');
    expect((await d.ops('/ops/assign', { command_id: 'a-fil-2', taskId: t2, riderId: RIDER })).status).toBe(200);
    tenue.lacher();
    await attendre(() => custody.appels.some((a) => a.path === '/produce/order/open' && a.corps.includes(O2)), 'the next alarm never ran');
    expect(lu<Json>(spawned.dir, `course:v1:${O1}`)).toMatchObject({ orderId: O1, custodyOutbox: { assignmentId: (a1.json['assignment'] as Json)['assignmentId'] } });
    expect(JSON.stringify(lu(spawned.dir, 'snap:custody-outbox:v1'))).not.toContain(O1);
  });

  it('a return-key arm still in flight when the course closes does not bring the return back', async () => {
    let mf!: Miniflare;
    const custody = custodyRetenue(() => mf);
    const spawned = spawn(custody.binding);
    mf = spawned.mf;
    const d = doors(mf);
    const RIDER = 'rider-cles';
    const code = await riderEnService(d, RIDER);
    const [O1, O2] = ['ord-cles-1', 'ord-cles-2'];
    for (const o of [O1, O2]) await faits(d, o, new Date().toISOString());
    const { assignmentId } = await courseAcceptee(d, code, RIDER, O1, 'cles-1');
    await attendre(() => custody.appels.some((a) => a.path === '/produce/secrets/arm' && a.corps.includes(`arm-pickup-${assignmentId}`)), 'the pickup code was never armed');
    const t2 = (await d.ops('/ops/task', { command_id: 't-cles-2', orderId: O2, location: LOC, window: fenetre() })).json['taskId'] as string;
    const tenue = custody.retenir((path, corps) => path === '/produce/secrets/arm' && corps.includes(`arm-retour-rider-${assignmentId}`));
    expect((await d.produce('/produce/retour-ouvert', { command_id: 'ro-cles', orderId: O1, at: new Date().toISOString() })).json['status']).toBe('retour_ouvert');
    await tenue.arrivee();
    expect((await d.produce('/produce/course-retournee', { command_id: 'cr-cles', orderId: O1, at: new Date().toISOString() })).json['status']).toBe('retournee');
    expect((await d.ops('/ops/assign', { command_id: 'a-cles-2', taskId: t2, riderId: RIDER })).status).toBe(200);
    tenue.lacher();
    await attendre(() => custody.appels.some((a) => a.path === '/produce/order/open' && a.corps.includes(O2)), 'the next alarm never ran');
    expect(lu<Json>(spawned.dir, `course:v1:${O1}`)).toMatchObject({ orderId: O1, retours: { [assignmentId]: { orderId: O1 } } });
    expect(JSON.stringify(lu(spawned.dir, 'snap:retours:v1'))).not.toContain(assignmentId);
  });

  it('the founder\'s return decision still in flight when the course closes is not written over it', async () => {
    let mf!: Miniflare;
    const custody = custodyRetenue(() => mf);
    const spawned = spawn(custody.binding);
    mf = spawned.mf;
    const d = doors(mf);
    const RIDER = 'rider-decide';
    const code = await riderEnService(d, RIDER);
    const O = 'ord-decide';
    await faits(d, O, new Date().toISOString());
    const { taskId, assignmentId } = await courseAcceptee(d, code, RIDER, O, 'dec');
    const issue = { taskId, orderId: O, family: 'reschedule', reasonCode: 'honest_absence', humanReasonRef: 'reason.honest_absence', faultClass: 'buyer', attempt: { number: 2, at: new Date().toISOString() } };
    expect(await d.produce('/produce/reprogrammation', { command_id: 'w-dec', orderId: O, at: new Date().toISOString(), outcome: issue })).toEqual({ status: 200, json: { ok: true, status: 'enregistre' } });
    // Custody's recorded answer when the founder's return applies (its /return/apply door).
    const tenue = custody.retenir((path) => path === '/produce/return/apply', () => Response.json({ ok: true, kind: 'return_applied', outcome: null }));
    const decision = d.ops('/ops/retour/decider', { command_id: 'rd-dec', orderId: O });
    await tenue.arrivee();
    expect((await livrer(d, O, 'dec'))['status']).toBe('livree');
    tenue.lacher();
    expect(await decision).toEqual({ status: 409, json: { ok: false, reason: 'no_active_course' } });
    expect(lu<Json>(spawned.dir, `course:v1:${O}`)).toMatchObject({ orderId: O });
    expect(JSON.stringify(lu(spawned.dir, 'snap:retour-decide:v1') ?? {})).not.toContain(assignmentId);
  });

  /*
   * A close whose record is larger than one stored value can hold: here the
   * order's supplier reference (≈ 1.1 MB) sits once in the hot facts and once
   * in the custody row, each under the cap, and both land in the one record.
   */
  const TROP = 'S'.repeat(1_100_000);
  async function courseLourde(d: Doors, code: string, riderId: string, orderId: string, tag: string): Promise<{ assignmentId: string }> {
    const asOf = new Date().toISOString();
    expect((await d.intake('/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf })).status).toBe(200);
    expect((await d.intake('/intake/readiness', { orderId, ready: true, asOf, supplierRef: TROP })).status).toBe(200);
    return courseAcceptee(d, code, riderId, orderId, tag);
  }

  it('a refused save inside a door that saves on its own is named, and the next write is stored', async () => {
    const { mf, dir } = spawn();
    const d = doors(mf);
    const RIDER = 'rider-nom';
    const code = await riderEnService(d, RIDER);
    const O = 'ord-nom';
    const { assignmentId } = await courseLourde(d, code, RIDER, O, 'nom');
    expect(await d.produce('/produce/course-retournee', { command_id: 'cr-nom', orderId: O, at: new Date().toISOString() })).toEqual({ status: 500, json: { ok: false, reason: 'persist_failed' } });
    // Nothing of the refused move was stored, and memory came back from storage…
    expect(lu(dir, `course:v1:${O}`)).toBeUndefined();
    expect(JSON.stringify(lu(dir, 'snap:book:v1'))).toContain(assignmentId);
    expect(JSON.stringify((await d.ops('/ops/board')).json)).toContain(assignmentId);
    // …along with the refused batch's records: the next writes are stored.
    for (const n of [1, 2]) expect((await d.ops('/ops/riders', { riderId: `rider-apres-${n}`, displayName: 'Après', phoneAlias: `ap${n}` })).status).toBe(200);
    expect(JSON.stringify(lu(dir, 'snap:registry:v1'))).toContain('rider-apres-2');
  });

  it('a request that resumes after another\'s refused close never stores the move without its record', async () => {
    let mf!: Miniflare;
    const custody = custodyRetenue(() => mf);
    const spawned = spawn(custody.binding);
    mf = spawned.mf;
    const d = doors(mf);
    const codeX = await riderEnService(d, 'rider-attente');
    const codeB = await riderEnService(d, 'rider-lourd');
    const OX = 'ord-attente';
    await faits(d, OX, new Date().toISOString());
    const x = await courseAcceptee(d, codeX, 'rider-attente', OX, 'att');
    const OB = 'ord-lourd';
    const b = await courseLourde(d, codeB, 'rider-lourd', OB, 'lrd');
    // The founder's take-back waits on custody's word for its course…
    const tenue = custody.retenir((path, corps) => path === '/produce/custodian' && corps.includes(OX));
    const reprise = d.ops('/ops/assignment/take-back', { command_id: 'tb-att', assignmentId: x.assignmentId, custodyNotBegun: true });
    await tenue.arrivee();
    // …while custody's drop closes the other course, whose save is refused.
    expect(await d.produce('/produce/course-livree', { command_id: 'cl-lrd', orderId: OB, at: new Date().toISOString() })).toEqual({ status: 500, json: { ok: false, reason: 'persist_failed' } });
    tenue.lacher();
    await reprise;
    expect((await d.ops('/ops/riders', { riderId: 'rider-temoin', displayName: 'Témoin', phoneAlias: 'tm' })).status).toBe(200);
    // The closed course is either still hot or in its record — never in neither.
    const chaud = JSON.stringify(lu(spawned.dir, 'snap:book:v1')).includes(b.assignmentId);
    const range = lu(spawned.dir, `course:v1:${OB}`) !== undefined;
    expect(chaud || range).toBe(true);
  });

  it('a save the storage refuses fails by name, and the object then serves only what was stored', async () => {
    const { mf, dir } = spawn();
    const d = doors(mf);
    await riderEnService(d, 'rider-avant');
    // The founder's own door, a name far past what one stored value can hold.
    const refuse = await d.ops('/ops/riders', { riderId: 'rider-trop-grand', displayName: 'x'.repeat(2_400_000), phoneAlias: 'tg' });
    expect(refuse).toEqual({ status: 500, json: { ok: false, reason: 'persist_failed' } });
    // Memory was reloaded from storage: the board knows only stored riders…
    const board = JSON.stringify((await d.ops('/ops/board')).json);
    expect(board).toContain('rider-avant');
    expect(board).not.toContain('rider-trop-grand');
    // …and the next write is stored.
    expect((await d.ops('/ops/riders', { riderId: 'rider-apres', displayName: 'Après', phoneAlias: 'ap' })).status).toBe(200);
    const registre = JSON.stringify(lu(dir, 'snap:registry:v1'));
    expect(registre).toContain('rider-apres');
    expect(registre).not.toContain('rider-trop-grand');
  });

  it('a snapshot past 1 MiB leaves an alert the founder can read, on his key only', async () => {
    const { mf, dir } = spawn();
    const d = doors(mf);
    expect((await d.sansCle('/ops/stockage')).status).toBe(401);
    expect(await d.ops('/ops/stockage')).toEqual({ status: 200, json: { ok: true, borne: BORNE, alertes: [] } });
    expect((await d.ops('/ops/riders', { riderId: 'rider-lourd', displayName: 'y'.repeat(1_200_000), phoneAlias: 'lo' })).status).toBe(200);
    const stocke = snapSizes(dir)['snap:registry:v1']!;
    expect(stocke).toBeGreaterThan(BORNE);
    const alerte = await d.ops('/ops/stockage');
    expect(alerte.status).toBe(200);
    const alertes = alerte.json['alertes'] as Json[];
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatchObject({ key: 'snap:registry:v1', at: expect.any(String) });
    // An upper bound of what storage holds: never under it, about twice it for plain letters.
    expect(alertes[0]!['bytes'] as number).toBeGreaterThanOrEqual(stocke);
    expect(alertes[0]!['bytes'] as number).toBeLessThanOrEqual(2 * stocke);
    // A read door: asking twice records nothing.
    const avant = snapSizes(dir);
    expect(await d.ops('/ops/stockage')).toEqual(alerte);
    expect(snapSizes(dir)).toEqual(avant);
  });

  it('a value with one two-byte character is watched by its stored size, not by its UTF-8 length', async () => {
    const { mf, dir } = spawn();
    const d = doors(mf);
    expect((await d.ops('/ops/riders', { riderId: 'rider-apostrophe', displayName: `${'z'.repeat(560_000)}’`, phoneAlias: 'ap' })).status).toBe(200);
    const stocke = snapSizes(dir)['snap:registry:v1']!;
    expect(stocke).toBeGreaterThan(BORNE);
    // The JSON's UTF-8 bytes read about half of it — a measure that would stay silent.
    expect(new TextEncoder().encode(JSON.stringify(lu(dir, 'snap:registry:v1'))).byteLength).toBeLessThan(BORNE);
    const alertes = (await d.ops('/ops/stockage')).json['alertes'] as Json[];
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatchObject({ key: 'snap:registry:v1' });
    expect(alertes[0]!['bytes'] as number).toBeGreaterThanOrEqual(stocke);
  });
});
