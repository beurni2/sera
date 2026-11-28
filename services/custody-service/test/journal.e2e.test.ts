import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deserialize } from 'node:v8';
import { Miniflare } from 'miniflare';
import { unstable_readConfig } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ═══ JOURNAL-SERVICE — the custody service keeps a log: one line per request
 *     and one per fault, never a person's data ═══
 *
 * Execution Contract §6: « One correlation chain per transaction » and
 * « Standards: structured logs · … · DLQ + stuck-saga detection »; §8 item 8:
 * « A support agent can reconstruct any transaction from the correlation
 * chain. » `packages/observability/src/logger.ts`: every line is ONE JSON
 * object carrying `correlation_id`. The id is cut to 64 characters, the value
 * the Shop+ logger caps at.
 *
 * The real custody Worker under Miniflare. Every message the runtime writes
 * is captured (`structuredWorkerdLogs` + `handleStructuredLogs`), the same
 * lines Workers Logs keeps once the service is deployed. Each request this
 * file sends carries its own correlation id, so « exactly one line for this
 * request » is a count, never a guess.
 *
 * ⚠ LOGISTICS IS A CERTIFIED STAND-IN, answering as the real logistics
 * Worker answers (services/logistics-service):
 *   · `worker/index.ts` `/verify/` (the router's gate on
 *     SERA_RIDER_VERIFY_SECRET) and `unauthorized()`: a missing or wrong
 *     Bearer is the one `{ error: 'unauthorized' }` 401;
 *   · `worker/logistics-do.ts` `POST /verify/rider-code`: a known code is
 *     `{ ok: true, riderId }`, any other the same 401. `/ops/riders` takes
 *     any non-empty trimmed rider id, so the real book can answer one the
 *     router cannot place in a header;
 *   · the object's catch-all: an internal failure is
 *     `500 { ok: false, reason: 'internal_error' }`;
 *   · `worker/index.ts` `/produce/` (the router's gate on
 *     SERA_COURSE_LIVREE_SECRET): the same 401 before any byte of the body.
 * This custody Worker holds a course-livrée key logistics does not hold, so
 * every send on that door is refused 401, exactly as the real door refuses
 * it. Shop+'s progress door is not bound here: those wires rest, by name.
 */

const SCRIPT = 'dist-worker/worker.mjs';
const SERVICE = 'custody-service';

const OPS = 'test-ops-journal-qxs1-0001';
const VERIFY = 'test-verify-journal-qxs2-0002';
const PRODUCE = 'test-produce-journal-qxs3-0003';
const SHOP_ARM = 'test-shop-arm-journal-qxs4-0004';
/** The course-livrée key this custody Worker holds… */
const LIVREE_CUSTODY = 'test-livree-custody-qxs5-0005';
/** …and the one logistics holds. They differ: every send is refused 401. */
const LIVREE_LOGISTICS = 'test-livree-logistics-qxs6-0006';

const CODE = 'QXCODE-coursier-0001';
const RIDER = 'rider-qxcoursier-0001';
/** The directory answers 500 for this one: custody says « unavailable », 503. */
const CODE_PANNE = 'QXCODE-panne-0002';
/** The directory answers a rider id the router cannot place in a header: the router throws. */
const CODE_SAUT = 'QXCODE-saut-0003';
const RIDER_SAUT = 'rider-qxsaut\nQXINJ-0003';

const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const ELIGIBILITY_OUTBOX_KEY = 'custody:eligibility-outbox:v1';
const TRANSIT_OUTBOX_KEY = 'custody:transit-outbox:v1';
const COURSE_LIVREE_OUTBOX_KEY = 'custody:course-livree-outbox:v1';
const ALERTE_PREUVE_KEY = 'custody:alerte-preuve-outbox:v1';

/** Shop+'s minted order shape — the only order id a line may carry. */
const ORDER_SHAPE = /^ord-quote-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const minted = (): string => `ord-quote-${randomUUID()}`;

type Json = Record<string, unknown>;
type Ligne = Record<string, unknown>;

/* ─────────────────────── logistics, as its real doors ─────────────────────── */

interface Appel {
  path: string;
  status: number;
}

function logistique(appels: Appel[]) {
  const codes: Record<string, string> = { [CODE]: RIDER, [CODE_SAUT]: RIDER_SAUT };
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const auth = request.headers.get('Authorization');
    const answer = (status: number, payload: unknown): Response => {
      appels.push({ path, status });
      return Response.json(payload, { status });
    };
    if (path.startsWith('/verify/')) {
      if (auth !== `Bearer ${VERIFY}`) return answer(401, { error: 'unauthorized' });
      if (request.method === 'POST' && path === '/verify/rider-code') {
        const code = ((await request.json().catch(() => null)) as Json | null)?.['code'];
        if (code === CODE_PANNE) return answer(500, { ok: false, reason: 'internal_error' });
        const riderId = typeof code === 'string' ? codes[code] : undefined;
        if (riderId === undefined) return answer(401, { error: 'unauthorized' });
        return answer(200, { ok: true, riderId });
      }
      return answer(404, { ok: false, reason: 'not_found' });
    }
    if (path.startsWith('/produce/')) {
      // The Bearer first, before any byte of the body is read.
      if (auth !== `Bearer ${LIVREE_LOGISTICS}`) return answer(401, { error: 'unauthorized' });
      // Unreachable here — this Worker never holds logistics' key. Loud if it ever is.
      return answer(500, { ok: false, reason: 'stand_in_not_built_for_an_authorized_call' });
    }
    return answer(404, { ok: false, reason: 'not_found' });
  };
}

/* ─────────────────────────────── the capture ─────────────────────────────── */

function safeJson(text: string): Json {
  try {
    const v = JSON.parse(text) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
  } catch {
    return {};
  }
}

const lignesDans = (recus: string[]): Ligne[] => recus.map(safeJson).filter((l) => Object.keys(l).length > 0);
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The lines that match, once at least `attendu` are in — then a short settle, so a second line is seen too. */
async function attendre(recus: string[], filtre: (l: Ligne) => boolean, attendu = 1, ms = 8_000): Promise<Ligne[]> {
  const fin = Date.now() + ms;
  while (lignesDans(recus).filter(filtre).length < attendu && Date.now() < fin) await pause(25);
  await pause(250);
  return lignesDans(recus).filter(filtre);
}

/* ─────────────────────────────── the harness ─────────────────────────────── */

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-journal-${tag}-`));
  dirs.push(d);
  return d;
}
const live: Miniflare[] = [];

function boot(dir: string, recus: string[], appels: Appel[], extra: Record<string, string> = {}): Miniflare {
  const m = new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    // SHOP_PROGRESS deliberately unbound: Shop+'s wires rest, by name.
    serviceBindings: { LOGISTICS: logistique(appels) },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: OPS,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_PRODUCE_SECRET: PRODUCE,
      SHOP_ARM_SECRET: SHOP_ARM,
      SERA_COURSE_LIVREE_SECRET: LIVREE_CUSTODY,
      ...extra,
    },
    structuredWorkerdLogs: true,
    handleStructuredLogs: ({ message }) => {
      recus.push(message);
    },
  });
  live.push(m);
  return m;
}

async function stop(m: Miniflare): Promise<void> {
  live.splice(live.indexOf(m), 1);
  await m.dispose();
}

afterAll(async () => {
  await Promise.all(live.splice(0).map((m) => m.dispose()));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface Reponse {
  status: number;
  text: string;
  json: Json;
  cid: string;
}

let seq = 0;
/** One request, under its own correlation id. The stem shares nothing with any sentinel below. */
async function appelSur(m: Miniflare, path: string, init: RequestInit = {}, cid = `corr-balai-${String((seq += 1)).padStart(4, '0')}`): Promise<Reponse> {
  const headers = new Headers(init.headers);
  headers.set('x-correlation-id', cid);
  const res = await m.dispatchFetch(`http://custody${path}`, { ...init, headers } as never);
  const text = await res.text();
  return { status: res.status, text, json: safeJson(text), cid };
}
const avec = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
const poste = (body: unknown, key: string, h: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { ...avec(key), ...h },
  body: JSON.stringify(body),
});

/** A whole course on the real doors: opened, both codes armed by their producers, checked, sealed, on the road, proven, dropped. */
async function courseEntiere(m: Miniflare, O: string, t: string): Promise<void> {
  const ok = async (path: string, init: RequestInit): Promise<Reponse> => {
    const r = await appelSur(m, path, init);
    expect(r.status, `${path} ${r.text}`).toBe(200);
    return r;
  };
  await ok('/ops/order/open', poste({ orderId: O, taskId: `task-qxtache-${t}`, packageId: `pkg-qxcolis-${t}`, correlationId: `corr-${O}`, supplierId: `supplier-qxfourn-${t}` }, OPS));
  await ok('/produce/secrets/arm', poste({ orderId: O, command_id: `qxcmd-arm-p-${t}`, kind: 'pickup_verification_code', secret: `QXPICK-${t}` }, PRODUCE));
  await ok('/produce-shop/secrets/arm', poste({ orderId: O, command_id: `qxcmd-arm-d-${t}`, kind: 'buyer_drop_code', secret: `QXDROP-${t}` }, SHOP_ARM));
  await ok('/rider/verification', poste({
    orderId: O, command_id: `qxcmd-v-${t}`, presentedPickupCode: `QXPICK-${t}`, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-qxpreuve-${t}`,
  }, CODE));
  await ok('/rider/custody/begin', poste({ orderId: O, command_id: `qxcmd-b-${t}`, custodySealId: `QXSEAL-${t}`, sealPhotoRefs: [] }, CODE));
  await ok('/rider/transit/depart', poste({ orderId: O, command_id: `qxcmd-dep-${t}` }, CODE));
  await ok('/rider/transit/arrive', poste({ orderId: O, command_id: `qxcmd-arr-${t}` }, CODE));
  await ok('/rider/delivery/evidence', poste({
    orderId: O, command_id: `qxcmd-e-${t}`,
    bundle: { taskId: `task-qxtache-${t}`, packageId: `pkg-qxcolis-${t}`, custodySealId: `QXSEAL-${t}`, artifacts: [], capturedAt: new Date().toISOString() },
  }, CODE));
  const drop = await ok('/rider/delivery/drop', poste({ orderId: O, command_id: `qxcmd-d-${t}`, dropCode: `QXDROP-${t}` }, CODE));
  expect(drop.json).toMatchObject({ ok: true, status: 'custody_with_customer' });
}

/* ───────────────── the object store, read while no runtime is up ───────────────── */

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else found.push(p);
    }
  };
  walk(dir);
  return found;
}

function readRow(dir: string, key: string): Json | undefined {
  for (const file of filesUnder(dir).filter((f) => f.endsWith('.sqlite') && !f.includes('metadata'))) {
    const db = new DatabaseSync(file);
    try {
      const rows = db.prepare('select key, value from _cf_KV').all() as unknown as { key: Uint8Array; value: Uint8Array }[];
      for (const row of rows) {
        if (Buffer.from(row.key).toString('latin1') === key) return deserialize(Buffer.from(row.value)) as Json;
      }
    } finally {
      db.close();
    }
  }
  return undefined;
}

/* ═══════════════════════ the main Worker, and its course ═══════════════════════ */

const recus: string[] = [];
const appels: Appel[] = [];
let mf: Miniflare;
const O = minted();
const appel = (path: string, init: RequestInit = {}, cid?: string): Promise<Reponse> => appelSur(mf, path, init, cid);
const lignesDe = (cid: string, attendu = 1): Promise<Ligne[]> => attendre(recus, (l) => l['correlation_id'] === cid, attendu);

beforeAll(async () => {
  mf = boot(freshDir('main'), recus, appels);
  await courseEntiere(mf, O, 'main');
}, 120_000);

/* ═══════════════════════ (i) one line per request ═══════════════════════ */

describe('the custody service writes ONE structured line per request', () => {
  it('a known route on the founder’s door: its template, method, status, duration, correlation id and the order it resolved', async () => {
    expect(O).toMatch(ORDER_SHAPE);
    const r = await appel(`/ops/ledger?orderId=${O}`, { headers: avec(OPS) }, 'corr-jrn-ledger-0001');
    expect(r.status).toBe(200);
    const mine = await lignesDe('corr-jrn-ledger-0001');
    expect(mine).toEqual([
      {
        ts: expect.any(String),
        level: 'info',
        correlation_id: 'corr-jrn-ledger-0001',
        service: SERVICE,
        msg: 'request',
        route: '/ops/ledger',
        method: 'GET',
        status: 200,
        durationMs: expect.any(Number),
        orderId: O,
      },
    ]);
    expect(Number.isInteger(mine[0]!['durationMs']) && (mine[0]!['durationMs'] as number) >= 0).toBe(true);
  }, 60_000);

  it('every door writes its one line under its own template: /health, /rider/*, /produce/*, /produce-shop/*', async () => {
    const cas: [string, RequestInit, string, boolean][] = [
      ['/health', {}, '/health', false],
      // A replayed departure on the rider's own hand: answered `deja`, 200.
      ['/rider/transit/depart', poste({ orderId: O, command_id: 'qxcmd-dep-main' }, CODE), '/rider/transit/depart', true],
      [`/produce/custodian?orderId=${O}`, { headers: avec(PRODUCE) }, '/produce/custodian', true],
      // The same arm, replayed: the recorded answer, 200.
      ['/produce-shop/secrets/arm', poste({ orderId: O, command_id: 'qxcmd-arm-d-main', kind: 'buyer_drop_code', secret: 'QXDROP-main' }, SHOP_ARM), '/produce-shop/secrets/arm', true],
    ];
    const reponses: Reponse[] = [];
    for (const [path, init] of cas) reponses.push(await appel(path, init));
    expect(reponses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    for (const [i, [, init, route, ordre]] of cas.entries()) {
      const r = reponses[i]!;
      expect(await lignesDe(r.cid), route).toEqual([
        {
          ts: expect.any(String),
          level: 'info',
          correlation_id: r.cid,
          service: SERVICE,
          msg: 'request',
          route,
          method: init.body === undefined ? 'GET' : 'POST',
          status: 200,
          durationMs: expect.any(Number),
          ...(ordre ? { orderId: O } : {}),
        },
      ]);
    }
  }, 60_000);

  it('with no inbound correlation id the line is still written, on a freshly minted one', async () => {
    const avant = lignesDans(recus).filter((l) => l['route'] === '/health').length;
    const res = await mf.dispatchFetch('http://custody/health');
    await res.text();
    const sante = await attendre(recus, (l) => l['route'] === '/health', avant + 1);
    expect(sante).toHaveLength(avant + 1);
    expect(sante[avant]!['correlation_id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }, 60_000);

  it('an inbound correlation id longer than 64 characters is written cut to its first 64', async () => {
    const long = `corr-jrn-long-${'c'.repeat(500)}`;
    await appel('/health', {}, long);
    const mine = await lignesDe(long.slice(0, 64));
    expect(mine).toHaveLength(1);
    expect(mine[0]!['route']).toBe('/health');
    expect(recus.some((m) => m.includes('c'.repeat(65)))).toBe(false);
  }, 60_000);

  it('the order is named only once the door has resolved it, and only in its minted shape', async () => {
    // From the body: the open, replayed (`already_open`, 200).
    const rouvert = await appel('/ops/order/open', poste({ orderId: O, taskId: 'task-qxtache-main', packageId: 'pkg-qxcolis-main', correlationId: `corr-${O}`, supplierId: 'supplier-qxfourn-main' }, OPS));
    // Shapes a caller typed: the template stands, the id is left out.
    const tapes: Reponse[] = [];
    for (const typed of ['ord-typed-qxordtape', `ord-quote-${'z'.repeat(36)}`, '22671935284']) {
      tapes.push(await appel(`/ops/ledger?orderId=${encodeURIComponent(typed)}`, { headers: avec(OPS) }));
    }
    // Refused before the order is resolved: no id, however well-shaped.
    const sansCle = await appel(`/ops/ledger?orderId=${O}`);
    expect([rouvert.status, sansCle.status]).toEqual([200, 401]);

    expect((await lignesDe(rouvert.cid))[0]).toMatchObject({ route: '/ops/order/open', orderId: O });
    for (const x of tapes) {
      const [l] = await lignesDe(x.cid);
      expect(l, x.cid).toMatchObject({ route: '/ops/ledger', method: 'GET' });
      expect(l, x.cid).not.toHaveProperty('orderId');
    }
    const [l401] = await lignesDe(sansCle.cid);
    expect(l401).toMatchObject({ route: '/ops/ledger', status: 401 });
    expect(l401).not.toHaveProperty('orderId');
  }, 60_000);

  it('an unknown path is « unmatched » — the rider door’s closed routes too — and a method outside the known set is « OTHER »', async () => {
    const inconnus: Reponse[] = [];
    for (const [path, init] of [
      ['/zz/nowhere', {}],
      ['/rider/ledger', poste({ orderId: O }, CODE)],
      ['/ops/nowhere', { headers: avec(OPS) }],
    ] as const) {
      inconnus.push(await appel(`${path}?orderId=${O}`, init));
    }
    expect(inconnus.map((u) => u.status)).toEqual([404, 404, 404]);
    for (const u of inconnus) expect((await lignesDe(u.cid))[0], u.cid).toMatchObject({ route: 'unmatched', status: 404, level: 'info' });
    const m = await appel('/health', { method: 'PROPFIND' });
    expect((await lignesDe(m.cid))[0]).toMatchObject({ method: 'OTHER', route: '/health' });
  }, 60_000);

  it('levels: a 5xx is error · a 401 or 403 is warn · every other answer is info', async () => {
    const indispo = await appel('/rider/verification', poste({ orderId: O, command_id: 'qxcmd-v-panne' }, CODE_PANNE));
    const sansCle = await appel('/ops/attestations', { headers: { Authorization: 'Bearer QXMAUVAISECLE' } });
    const sceau = await appel('/produce/secrets/arm', poste({ orderId: O, command_id: 'qxcmd-arm-s', kind: 'custody_seal', secret: 'QXSEAUARME' }, PRODUCE));
    const sansOrdre = await appel('/ops/ledger', { headers: avec(OPS) });
    const pasOuvert = await appel(`/ops/ledger?orderId=${minted()}`, { headers: avec(OPS) });
    expect([indispo.status, sansCle.status, sceau.status, sansOrdre.status]).toEqual([503, 401, 403, 400]);
    expect(pasOuvert.status >= 400 && pasOuvert.status < 500, String(pasOuvert.status)).toBe(true);

    expect((await lignesDe(indispo.cid))[0]).toMatchObject({ level: 'error', status: 503, route: '/rider/verification' });
    expect((await lignesDe(sansCle.cid))[0]).toMatchObject({ level: 'warn', status: 401, route: '/ops/attestations' });
    expect((await lignesDe(sceau.cid))[0]).toMatchObject({ level: 'warn', status: 403, route: '/produce/secrets/arm', orderId: O });
    expect((await lignesDe(sansOrdre.cid))[0]).toMatchObject({ level: 'info', status: 400, route: '/ops/ledger' });
    expect((await lignesDe(pasOuvert.cid))[0]).toMatchObject({ level: 'info', route: '/ops/ledger', status: pasOuvert.status });
  }, 60_000);
});

/* ═══════════════════ (i b) a request that throws ═══════════════════ */

describe('a request that throws writes ONE error line — and the caller still gets the runtime’s own failure', () => {
  // Its own Worker, so the runtime's own report of the throw stays out of the
  // main capture. A rider id the router cannot place in a header makes the
  // router throw (a real TypeError, from the app itself), and the line must
  // still be written. Nothing is stubbed.
  it('a rider id the header cannot carry: one error line by error name, with the resolved order, and the exception reaches the caller', async () => {
    const siennes: string[] = [];
    const jette = boot(freshDir('jette'), siennes, []);
    const Oj = minted();
    const cid = 'corr-balai-jette-0001';
    const res = await jette.dispatchFetch('http://custody/rider/verification', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CODE_SAUT}`, 'Content-Type': 'application/json', 'x-correlation-id': cid },
      body: JSON.stringify({ orderId: Oj, command_id: 'qxcmd-v-saut' }),
    });
    const corps = await res.text();
    expect(res.status).toBe(500);
    // The runtime answers with the exception itself; a 500 the service made could never carry this text.
    expect(corps).toMatch(/TypeError/);
    expect(await attendre(siennes, (l) => l['correlation_id'] === cid)).toEqual([
      {
        ts: expect.any(String),
        level: 'error',
        correlation_id: cid,
        service: SERVICE,
        msg: 'request',
        route: '/rider/verification',
        method: 'POST',
        status: 500,
        durationMs: expect.any(Number),
        orderId: Oj,
        error: 'TypeError',
      },
    ]);
    expect(siennes.some((m) => m.includes('QXINJ') || m.includes('qxsaut'))).toBe(false);
    await stop(jette);
  }, 60_000);
});

/* ═══════════════════════ (ii) one line per fault ═══════════════════════ */

describe('a delivery that does not land writes ONE line per try — and nothing about the retry changes', () => {
  const lignesII: string[] = [];
  const appelsII: Appel[] = [];
  let dir = '';
  let mfII: Miniflare;
  const Oa = minted();
  const Ob = minted();
  const panne = (l: Ligne, outbox: string, orderId: string): boolean => l['msg'] === 'outbox_undelivered' && l['outbox'] === outbox && l['orderId'] === orderId;

  beforeAll(async () => {
    dir = freshDir('ii');
    // A short proof window, so the proof watch raises its alert inside the test.
    mfII = boot(dir, lignesII, appelsII, { EVIDENCE_AGING_MS: '1500' });
    await courseEntiere(mfII, Oa, 'ii');
    // Ob: sealed on the founder's door, then proven with the decision pre-empted, so it stays undecided.
    const ok = async (path: string, body: unknown): Promise<Reponse> => {
      const r = await appelSur(mfII, path, poste(body, OPS));
      expect(r.status, `${path} ${r.text}`).toBe(200);
      return r;
    };
    await ok('/ops/order/open', { orderId: Ob, taskId: 'task-qxtache-iib', packageId: 'pkg-qxcolis-iib', correlationId: `corr-${Ob}`, supplierId: 'supplier-qxfourn-iib' });
    await ok('/ops/secrets/arm', { orderId: Ob, command_id: 'qxcmd-arm-p-iib', kind: 'pickup_verification_code', secret: 'QXPICK-iib' });
    await ok('/ops/secrets/arm', { orderId: Ob, command_id: 'qxcmd-arm-d-iib', kind: 'buyer_drop_code', secret: 'QXDROP-iib' });
    await ok('/ops/verification', { orderId: Ob, command_id: 'qxcmd-v-iib', riderId: RIDER, presentedPickupCode: 'QXPICK-iib', checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-qxpreuve-iib' });
    await ok('/ops/custody/begin', { orderId: Ob, command_id: 'qxcmd-b-iib', riderId: RIDER, custodySealId: 'QXSEAL-iib', sealPhotoRefs: [] });
    const pre = await appelSur(mfII, '/ops/delivery/decide', poste({ orderId: Ob, command_id: `auto-decide-qxcmd-e-iib` }, OPS));
    expect(pre.json).toMatchObject({ ok: false, reason: 'validation_before_evidence' });
    await ok('/ops/delivery/evidence', {
      orderId: Ob, command_id: 'qxcmd-e-iib',
      bundle: { taskId: 'task-qxtache-iib', packageId: 'pkg-qxcolis-iib', custodySealId: 'QXSEAL-iib', artifacts: [], capturedAt: new Date().toISOString() },
    });
  }, 120_000);

  it('logistics refuses the drop confirmation 401: one error line names the outbox, the order, the attempt and the status', async () => {
    const mine = await attendre(lignesII, (l) => panne(l, COURSE_LIVREE_OUTBOX_KEY, Oa));
    expect(mine).toEqual([
      {
        ts: expect.any(String),
        level: 'error',
        correlation_id: `corr-${Oa}`,
        service: SERVICE,
        msg: 'outbox_undelivered',
        outbox: COURSE_LIVREE_OUTBOX_KEY,
        orderId: Oa,
        attempts: 1,
        status: 401,
      },
    ]);
    // The far side really said 401 — the line reports what it answered, not a guess.
    expect(appelsII.some((a) => a.path === '/produce/course-livree' && a.status === 401)).toBe(true);
  }, 60_000);

  it('a wire with nothing configured on this side says so once, by name, as it comes to rest (eligibility, both transit stages)', async () => {
    for (const [outbox, stage] of [
      [ELIGIBILITY_OUTBOX_KEY, undefined],
      [TRANSIT_OUTBOX_KEY, 'en_route'],
      [TRANSIT_OUTBOX_KEY, 'arrivee'],
    ] as const) {
      const mine = await attendre(lignesII, (l) => panne(l, outbox, Oa) && l['stage'] === stage);
      expect(mine, `${outbox} ${stage ?? ''}`).toEqual([
        {
          ts: expect.any(String),
          level: 'error',
          correlation_id: `corr-${Oa}`,
          service: SERVICE,
          msg: 'outbox_undelivered',
          outbox,
          ...(stage === undefined ? {} : { stage }),
          orderId: Oa,
          attempts: 0,
          reason: 'not_configured',
        },
      ]);
    }
  }, 60_000);

  it('a proof left undecided past its window: the alert it raises, refused 401, writes its line', async () => {
    const mine = await attendre(lignesII, (l) => panne(l, ALERTE_PREUVE_KEY, Ob), 1, 15_000);
    expect(mine).toEqual([
      {
        ts: expect.any(String),
        level: 'error',
        correlation_id: `corr-${Ob}`,
        service: SERVICE,
        msg: 'outbox_undelivered',
        outbox: ALERTE_PREUVE_KEY,
        orderId: Ob,
        attempts: 1,
        status: 401,
      },
    ]);
  }, 60_000);

  it('the rows still decide: the refused sends stay pending at their one attempt, the unconfigured ones rest', async () => {
    await stop(mfII);
    expect(readRow(dir, COURSE_LIVREE_OUTBOX_KEY)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(readRow(dir, ALERTE_PREUVE_KEY)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(readRow(dir, ELIGIBILITY_OUTBOX_KEY)).toMatchObject({ status: 'unsendable_no_config', attempts: 0 });
    expect(readRow(dir, TRANSIT_OUTBOX_KEY)).toMatchObject({
      en_route: { status: 'unsendable_no_config', attempts: 0 },
      arrivee: { status: 'unsendable_no_config', attempts: 0 },
    });
  }, 60_000);
});

/* ═══════════════════ (iii) nothing a person typed or owns ═══════════════════ */

const QUERY = '?q=QXQUERY&page=QXPAGE';
const ENTETES = {
  'User-Agent': 'QXAGENT/9.1',
  'CF-Connecting-IP': '203.0.113.77',
  'X-Forwarded-For': '198.51.100.23',
  Cookie: 'qx=QXCOOKIE',
  Referer: 'https://qxreferer.example/',
};
/** Five-digit, matched only as a whole number. */
const MONTANT = 48_731;

function porteSentinelle(message: string, s: string | number): boolean {
  if (typeof s === 'number') return new RegExp(`(?<![0-9A-Za-z-])${s}(?![0-9A-Za-z-])`).test(message);
  return message.includes(s);
}

describe('no line ever carries a person’s data, a code, a secret, a body, a query, a typed id or an amount', () => {
  const balayage: string[] = [];

  beforeAll(async () => {
    const envoyer = async (path: string, init: RequestInit = {}): Promise<Reponse> => {
      const r = await appel(path, { ...init, headers: { ...ENTETES, ...(init.headers as Record<string, string> | undefined) } });
      balayage.push(r.cid);
      return r;
    };
    const O3 = minted();
    // Queries, typed ids, unknown paths on every door.
    await envoyer(`/health${QUERY}`);
    await envoyer(`/ops/ledger?orderId=${O}&q=QXQUERY`, { headers: avec(OPS) });
    await envoyer(`/ops/ledger?orderId=QXORDTAPE`, { headers: avec(OPS) });
    await envoyer(`/ops/attestations?orderId=${O}&page=QXPAGE`, { headers: avec(OPS) });
    await envoyer(`/ops/events?orderId=${O}`, { headers: avec(OPS) });
    await envoyer(`/ops/QXINCONNU${QUERY}`, { headers: avec(OPS) });
    await envoyer(`/rider/QXINCONNU${QUERY}`, poste({ orderId: O }, CODE));
    await envoyer(`/produce/QXINCONNU${QUERY}`, { headers: avec(PRODUCE) });
    await envoyer(`/produce-shop/QXINCONNU${QUERY}`, { headers: avec(SHOP_ARM) });
    await envoyer(`/zz/QXINCONNU${QUERY}`);
    await envoyer(`/produce/custodian?orderId=${O}&q=QXQUERY`, { headers: avec(PRODUCE) });
    await envoyer(`/produce/drop-code/lock?orderId=${O}`, { headers: avec(PRODUCE) });
    // Codes, seals and keys a hand typed — wrong ones, refused, and right ones, replayed.
    await envoyer('/rider/verification', poste({ orderId: O, command_id: 'qxcmd-v-faux', presentedPickupCode: 'QXPICKFAUX', checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-qxpreuve-faux' }, CODE));
    await envoyer('/rider/verification', poste({ orderId: O, command_id: 'qxcmd-v-x' }, 'QXCODEINCONNU'));
    await envoyer('/rider/custody/begin', poste({ orderId: O, command_id: 'qxcmd-b-faux', custodySealId: 'QXSEALFAUX', sealPhotoRefs: ['QXPHOTO'] }, CODE));
    await envoyer('/rider/delivery/drop', poste({ orderId: O, command_id: 'qxcmd-d-faux', dropCode: 'QXDROPFAUX' }, CODE));
    await envoyer('/rider/delivery/drop', poste({ orderId: O, command_id: 'qxcmd-d-main', dropCode: 'QXDROP-main' }, CODE));
    await envoyer('/rider/door/inspection', poste({ orderId: O, command_id: 'qxcmd-insp', note: 'QXNOTEPORTE' }, CODE));
    await envoyer('/ops/verification', poste({ orderId: O, command_id: 'qxcmd-v-ops', riderId: 'rider-qxatteste', presentedPickupCode: 'QXPICKOPS' }, OPS));
    await envoyer('/produce/secrets/arm', poste({ orderId: O3, command_id: 'qxcmd-arm-x', kind: 'pickup_verification_code', secret: 'QXSECRETARME' }, PRODUCE));
    await envoyer('/produce-shop/door-reference', poste({ orderId: O3, command_id: 'qxcmd-ref', reference: 'QXREFPORTE' }, SHOP_ARM));
    await envoyer('/produce-shop/door-signal', poste({ orderId: O3, payload: { amount: MONTANT, collectRef: 'QXCOLLECT' } }, SHOP_ARM));
    await envoyer('/produce/colis/perdu', poste({ orderId: O3, command_id: 'qxcmd-perdu', amount: MONTANT, at: new Date().toISOString() }, PRODUCE));
    await envoyer('/ops/order/open', poste({ orderId: 'QXORDREBODY', taskId: 'task-qxtache-x', packageId: 'pkg-qxcolis-x', correlationId: 'corr-x', supplierId: 'supplier-qxfourn-x' }, OPS));
    await envoyer('/ops/order/open', { method: 'POST', headers: avec(OPS), body: '{QXMALFORME' });
    await envoyer('/produce-shop/secrets/arm', poste({ orderId: O, command_id: 'qxcmd-arm-y', kind: 'buyer_drop_code', secret: 'QXSECRETARME' }, 'QXMAUVAISECLE'));
  }, 120_000);

  it('every request of the sweep wrote its one line (so the check below is never a check of an empty log)', async () => {
    for (const cid of balayage) {
      expect(await lignesDe(cid), cid).toHaveLength(1);
    }
  }, 60_000);

  it('no captured line — request or fault — holds any sentinel, any secret, any amount, any rider, task or package id', async () => {
    // The main course's wires have had their first try (their lines are part of what is checked).
    await attendre(recus, (l) => l['msg'] === 'outbox_undelivered' && l['orderId'] === O);
    const sentinelles: (string | number)[] = [
      // the rider, his codes, what he typed and sealed
      CODE, 'QXCODE', RIDER, 'qxcoursier', 'QXPICK', 'QXSEAL', 'QXDROP', 'QXPHOTO', 'QXNOTEPORTE', 'qxpreuve', 'qxatteste',
      // the course's own ids, a supplier, a typed order, every command id
      'qxtache', 'qxcolis', 'qxfourn', 'QXORDTAPE', 'QXORDREBODY', 'qxcmd',
      // producer acts
      'QXSECRETARME', 'QXREFPORTE', 'QXCOLLECT', 'QXSEAUARME', 'QXMALFORME',
      // paths, queries, headers
      'QXQUERY', 'QXPAGE', 'QXINCONNU', 'QXAGENT', '203.0.113.77', '198.51.100.23', 'QXCOOKIE', 'qxreferer', 'QXMAUVAISECLE',
      // every secret this Worker and its neighbour hold
      OPS, VERIFY, PRODUCE, SHOP_ARM, LIVREE_CUSTODY, LIVREE_LOGISTICS,
      // money
      MONTANT,
    ];
    const fautes: string[] = [];
    for (const message of recus) {
      for (const s of sentinelles) if (porteSentinelle(message, s)) fautes.push(`${String(s)} ⟵ ${message}`);
    }
    expect(fautes).toEqual([]);
    expect(recus.length).toBeGreaterThan(balayage.length);
  }, 60_000);

  it('every line is one JSON object with its level, its service, its message and a correlation id', () => {
    expect(recus.length).toBeGreaterThan(0);
    for (const message of recus) {
      const l = safeJson(message);
      expect(typeof l['correlation_id'], message).toBe('string');
      expect(l['service'], message).toBe(SERVICE);
      expect(['info', 'warn', 'error'], message).toContain(l['level']);
      expect(typeof l['msg'], message).toBe('string');
    }
  });
});

/* ═══════════════════ (iv) what Workers Logs keeps ═══════════════════ */

describe('Workers Logs keeps this service’s own lines and nothing else (wrangler.toml, read by wrangler itself)', () => {
  it('every request is sampled, query strings are cut, and the per-request invocation log (raw URL) is off', () => {
    const cfg = unstable_readConfig({ config: 'wrangler.toml' });
    expect(cfg.observability).toEqual({
      enabled: true,
      head_sampling_rate: 1,
      redact_query_string: true,
      logs: { invocation_logs: false },
    });
  });
});
