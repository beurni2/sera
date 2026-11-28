import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { unstable_readConfig } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaAudioStandIn } from './doubles/media-audio';

/**
 * ═══ JOURNAL-SERVICE — the logistics service keeps a log: one line per
 *     request and one per fault, never a person's data ═══
 *
 * Execution Contract §6: « One correlation chain per transaction » and
 * « Standards: structured logs · … · DLQ + stuck-saga detection »; §8 item 8:
 * « A support agent can reconstruct any transaction from the correlation
 * chain. » Séra Build Spec SE-I08: « Courier location collected only on
 * shift/active task » — and never into a log line. Every line is ONE JSON
 * object carrying `correlation_id` (`packages/observability`), cut to 64
 * characters, the value the Shop+ logger caps at.
 *
 * REAL AGAINST REAL: the logistics Worker and the custody Worker each run
 * their shipped bundle under Miniflare, each behind the other's service
 * binding, and every message both runtimes write is captured
 * (`structuredWorkerdLogs` + `handleStructuredLogs`). A rider's whole course
 * is driven across both — compose, assign, accept, the stall's code, the
 * check, the seal, the road, the proof, the drop, an SOS, the end of shift —
 * with a sentinel in every value a person typed or owns. Shop+'s progress
 * door is not bound: custody's wires to Shop+ rest, by name. The media
 * Worker's audio door is the certified stand-in in `doubles/media-audio.ts`.
 *
 * Custody holds a course-livrée key the logistics Worker does not, so that
 * wire's first try is refused by the REAL logistics door, 401 — the fault
 * line custody writes is about a real answer. A second logistics Worker holds
 * a producer key custody does not, so its producer wire is refused by the
 * REAL custody door, 401. A third holds no producer key at all: its wire
 * rests. Custody answering too late is the one outage stood in (a binding
 * that answers after logistics' own read bound): it says nothing else.
 */

const SCRIPT = 'dist-worker/worker.mjs';
const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');
const SERVICE = 'logistics-service';

const OPS = 'test-ops-journal-qxl1-0001';
const INTAKE = 'test-intake-journal-qxl2-0002';
const VERIFY = 'test-verify-journal-qxl3-0003';
const PRODUCE = 'test-produce-journal-qxl4-0004';
const LIVREE_L = 'test-livree-logistics-qxl5-0005';
/** Custody's course-livrée key: logistics does not hold it, so it refuses it 401. */
const LIVREE_C = 'test-livree-custody-qxl6-0006';
const CUSTODY_OPS = 'test-custody-ops-journal-qxl7-0007';
const SHOP_ARM = 'test-shop-arm-journal-qxl8-0008';
/** The second logistics Worker's producer key: custody does not hold it, so it refuses it 401. */
const PRODUCE_FAUX = 'test-produce-faux-qxl9-0009';

const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const SNAP_CUSTODY_OUTBOX = 'snap:custody-outbox:v1';
const COURSE_LIVREE_OUTBOX_KEY = 'custody:course-livree-outbox:v1';
const minted = (): string => `ord-quote-${randomUUID()}`;
const ilYa = (ms: number): string => new Date(Date.now() - ms).toISOString();

type Json = Record<string, unknown>;
type Ligne = Record<string, unknown>;

/* ─────────────────────────────── sentinels ─────────────────────────────── */

const LOC = {
  pin: { lat: 12.3714277, lng: -1.5196603 },
  zone: 'Qxzone Gounghin',
  landmark: 'Qxrepere pharmacie du marche',
  directions: 'Qxdirections porte bleue',
  maskedRelay: 'qxrelais-cliente-1',
};
const AUDIO_UUID = '7a3c9e21-5b4d-4f8e-9c2a-1d6b8e4f3a70';
const AUDIO = `media/${AUDIO_UUID}`;
const SON = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5, 6, 7]);
/** Where the rider stands — on shift, on his course. Never in a line. */
const POSITION = { latitude: 12.3651234, longitude: -1.5341234 };
const POSITION_SOS = { latitude: 12.3656789, longitude: -1.5356789 };
const RIDER = 'rider-qxcoursier-1';
/** Five-digit, matched only as a whole number. */
const MONTANT = 73_951;
const QUERY = '?q=QXQUERY&page=QXPAGE';
const ENTETES = {
  'User-Agent': 'QXAGENT/9.1',
  'CF-Connecting-IP': '203.0.113.77',
  'X-Forwarded-For': '198.51.100.23',
  Cookie: 'qx=QXCOOKIE',
  Referer: 'https://qxreferer.example/',
};

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

async function attendre(recus: string[], filtre: (l: Ligne) => boolean, attendu = 1, ms = 8_000): Promise<Ligne[]> {
  const fin = Date.now() + ms;
  while (lignesDans(recus).filter(filtre).length < attendu && Date.now() < fin) await pause(25);
  await pause(250);
  return lignesDans(recus).filter(filtre);
}

/* ─────────────────────────────── the harness ─────────────────────────────── */

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `logistics-journal-${tag}-`));
  dirs.push(d);
  return d;
}
const live: Miniflare[] = [];
afterAll(async () => {
  await Promise.all(live.splice(0).map((m) => m.dispose()));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function stop(m: Miniflare): Promise<void> {
  live.splice(live.indexOf(m), 1);
  await m.dispose();
}

const recusL: string[] = [];
const recusC: string[] = [];
let L: Miniflare;
let C: Miniflare;

function spawnCustody(): Miniflare {
  const m = new Miniflare({
    // Handed over as contents: workerd refuses a scriptPath that climbs out of the starting directory.
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: freshDir('custody'),
    serviceBindings: { LOGISTICS: (request: Request) => L.dispatchFetch(request.url, request as never) as never },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: CUSTODY_OPS,
      SERA_PRODUCE_SECRET: PRODUCE,
      SHOP_ARM_SECRET: SHOP_ARM,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_COURSE_LIVREE_SECRET: LIVREE_C,
    },
    structuredWorkerdLogs: true,
    handleStructuredLogs: ({ message }) => {
      recusC.push(message);
    },
  });
  live.push(m);
  return m;
}

function spawnLogistics(recus: string[], custody: ((r: Request) => Promise<Response>) | undefined, bindings: Record<string, string>): Miniflare {
  const media = mediaAudioStandIn({ [AUDIO]: { bytes: SON, contentType: 'audio/mp4' } });
  const m = new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: freshDir('logistics'),
    serviceBindings: { MEDIA_AUDIO: media.fetch as never, ...(custody === undefined ? {} : { CUSTODY: custody as never }) },
    bindings: {
      SERA_OPS_SECRET: OPS,
      SERA_INTAKE_SECRET: INTAKE,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_COURSE_LIVREE_SECRET: LIVREE_L,
      SERA_CONSOLE_ORIGIN: 'https://console.example',
      ...bindings,
    },
    structuredWorkerdLogs: true,
    handleStructuredLogs: ({ message }) => {
      recus.push(message);
    },
  });
  live.push(m);
  return m;
}

interface Reponse {
  status: number;
  text: string;
  json: Json;
  cid: string;
}

let seq = 0;
async function appelSur(m: Miniflare, host: string, path: string, init: RequestInit = {}, cid = `corr-balai-${String((seq += 1)).padStart(4, '0')}`): Promise<Reponse> {
  const headers = new Headers(init.headers);
  headers.set('x-correlation-id', cid);
  const res = await m.dispatchFetch(`http://${host}${path}`, { ...init, headers } as never);
  const text = await res.text();
  return { status: res.status, text, json: safeJson(text), cid };
}
const cle = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
const poste = (body: unknown, key: string): RequestInit => ({ method: 'POST', headers: cle(key), body: JSON.stringify(body) });
const lit = (key: string): RequestInit => ({ headers: cle(key) });

/** Custody's proof alert, as its wire posts it (`reconciliation.alert.v1`, the evidence-aging scenario). */
const alerte = (orderId: string, taskId: string): Json => ({
  name: 'reconciliation.alert.v1',
  envelope: { command_id: `qxcmd-alerte-${orderId}`, correlation_id: `corr-qxalerte-${orderId}`, aggregateVersion: 0, actor: 'custody-service:ops-monitor', serverTime: new Date().toISOString(), version: '1' },
  payload: { scenario: 'evidence_not_validated_aging', order_id: orderId, task_id: taskId, submitted_at: ilYa(31 * 60_000), age_min: 31 },
});

/** One course composed and confied on a logistics Worker: the facts, the task, a certified rider on shift, the assignment. */
async function confier(m: Miniflare, O: string, rider: string, t: string, supplierRef: string | undefined): Promise<{ code: string; assignmentId: string; taskId: string }> {
  const ok = async (path: string, init: RequestInit): Promise<Json> => {
    const r = await appelSur(m, 'logistics', path, init);
    expect(r.status, `${path} ${r.text}`).toBe(200);
    return r.json;
  };
  await ok('/intake/funding', poste({ orderId: O, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: ilYa(60_000) }, INTAKE));
  await ok('/intake/readiness', poste({ orderId: O, ready: true, asOf: ilYa(60_000), ...(supplierRef === undefined ? {} : { supplierRef }) }, INTAKE));
  const taskId = (await ok('/ops/task', poste({ command_id: `qxcmd-t-${t}`, orderId: O, location: LOC, window: { start: ilYa(60_000), end: new Date(Date.now() + 6 * 3_600_000).toISOString() } }, OPS)))['taskId'] as string;
  await ok('/ops/riders', poste({ riderId: rider, displayName: 'Qxnomcoursier', phoneAlias: `qxalias-${t}` }, OPS));
  await ok('/ops/riders/certify', poste({ riderId: rider, certified: true }, OPS));
  const code = (await ok('/ops/rider-code/mint', poste({ riderId: rider }, OPS)))['code'] as string;
  await ok('/rider/ack-privacy', poste({}, code));
  await ok('/rider/shift/start', poste(POSITION, code));
  const granted = await ok('/ops/assign', poste({ command_id: `qxcmd-a-${t}`, taskId, riderId: rider }, OPS));
  return { code, assignmentId: (granted['assignment'] as Json)['assignmentId'] as string, taskId };
}

/* ═══════════════ the pair, and one whole course across it ═══════════════ */

const O = minted();
const balayageL: string[] = [];
const balayageC: string[] = [];
/** Values the course minted for this person — her rider's code and his course's codes and ids. */
const mintes: string[] = [];

beforeAll(async () => {
  C = spawnCustody();
  L = spawnLogistics(recusL, (request) => C.dispatchFetch(request.url, request as never) as never, { SERA_PRODUCE_SECRET: PRODUCE });

  const avec = (init: RequestInit): RequestInit => ({ ...init, headers: { ...ENTETES, ...(init.headers as Record<string, string> | undefined) } });
  const versL = async (path: string, init: RequestInit = {}): Promise<Reponse> => {
    const r = await appelSur(L, 'logistics', path, avec(init));
    balayageL.push(r.cid);
    return r;
  };
  const versC = async (path: string, init: RequestInit = {}): Promise<Reponse> => {
    const r = await appelSur(C, 'custody', path, avec(init));
    balayageC.push(r.cid);
    return r;
  };
  const ok = async (r: Promise<Reponse>): Promise<Json> => {
    const x = await r;
    expect(x.status, x.text).toBe(200);
    return x.json;
  };

  // Compose and confy, every value a sentinel.
  await ok(versL('/intake/funding', poste({ orderId: O, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: ilYa(60_000) }, INTAKE)));
  await ok(versL('/intake/readiness', poste({ orderId: O, ready: true, asOf: ilYa(60_000), supplierRef: 'supplier-qxfourn-1' }, INTAKE)));
  const taskId = (await ok(versL('/ops/task', poste({
    command_id: 'qxcmd-t-main', orderId: O, location: LOC, repereAudioRef: AUDIO,
    window: { start: ilYa(60_000), end: new Date(Date.now() + 6 * 3_600_000).toISOString() },
  }, OPS))))['taskId'] as string;
  await ok(versL('/ops/riders', poste({ riderId: RIDER, displayName: 'Qxnomcoursier', phoneAlias: 'qxalias-main' }, OPS)));
  await ok(versL('/ops/riders/certify', poste({ riderId: RIDER, certified: true }, OPS)));
  const code = (await ok(versL('/ops/rider-code/mint', poste({ riderId: RIDER }, OPS))))['code'] as string;
  await ok(versL('/rider/ack-privacy', poste(POSITION, code)));
  await ok(versL('/rider/shift/start', poste(POSITION, code)));
  const assignmentId = ((await ok(versL('/ops/assign', poste({ command_id: 'qxcmd-a-main', taskId, riderId: RIDER }, OPS))))['assignment'] as Json)['assignmentId'] as string;
  await ok(versL('/rider/assignment/ack', poste({ assignmentId, ...POSITION }, code)));
  const sa = async (): Promise<Json> => ((await ok(versL(`/rider/moi${QUERY}`, lit(code))))['rider'] as Json)['assignment'] as Json;
  const ramassage = (await sa())['codeRamassage'] as string;
  const voix = await versL('/rider/repere-audio', lit(code));
  expect(voix.status).toBe(200);
  expect((await ok(versL('/intake/ramassage/verify', poste({ command_id: 'qxcmd-ram', orderId: O, code: ramassage }, INTAKE))))['verdict']).toBe('confirme');
  // Handed over at the stall: the machine-carried pickup code and seal arrive on his next read.
  const remis = await sa();
  const [verification, scelle] = [remis['codeVerification'], remis['codeScelle']] as string[];
  mintes.push(code, assignmentId, taskId, ramassage, verification!, scelle!);

  // The chain opens on the REAL custody Worker once the producer wire lands.
  for (let i = 0; i < 80; i += 1) {
    if ((await versC(`/ops/ledger?orderId=${O}`, lit(CUSTODY_OPS))).status === 200) break;
    await pause(250);
  }
  await ok(versC('/rider/verification', poste({ orderId: O, command_id: 'qxcmd-v', presentedPickupCode: verification, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-qxpreuve-1', ...POSITION }, code)));
  const chain = (await ok(versC('/rider/custody/begin', poste({ orderId: O, command_id: 'qxcmd-b', custodySealId: scelle, sealPhotoRefs: [], ...POSITION }, code))))['chain'] as Json;
  await ok(versC('/produce-shop/secrets/arm', poste({ orderId: O, command_id: 'qxcmd-arm-d', kind: 'buyer_drop_code', secret: 'QXDROP-main' }, SHOP_ARM)));
  await ok(versC('/rider/transit/depart', poste({ orderId: O, command_id: 'qxcmd-dep', ...POSITION }, code)));
  await ok(versC('/rider/transit/arrive', poste({ orderId: O, command_id: 'qxcmd-arr', ...POSITION }, code)));
  await ok(versC('/rider/delivery/evidence', poste({
    orderId: O, command_id: 'qxcmd-e',
    bundle: { taskId: chain['task_id'], packageId: chain['package_id'], custodySealId: scelle, artifacts: [], capturedAt: new Date().toISOString() },
  }, code)));
  const drop = await ok(versC('/rider/delivery/drop', poste({ orderId: O, command_id: 'qxcmd-d', dropCode: 'QXDROP-main' }, code)));
  expect(drop).toMatchObject({ ok: true, status: 'custody_with_customer' });

  // The rest of his day: an SOS from where he stands, the desk's reads, the cost of the course, the end of shift.
  await ok(versL('/rider/sos', poste({ command_id: 'qxcmd-sos', hours: 'in_hours', onShift: true, activeCourseId: assignmentId, raisedAt: new Date().toISOString(), ...POSITION_SOS }, code)));
  await versL(`/ops/flotte/cout?orderId=${O}&deliveryFunding=${MONTANT}`, lit(OPS));
  for (const path of ['/ops/board', '/ops/sos', '/ops/riders', '/ops/rider-codes', '/ops/a-preparer', '/ops/alertes', '/ops/stockage', '/ops/flotte', '/ops/shift/exceptions']) {
    await versL(`${path}${QUERY}`, lit(OPS));
  }
  await versL('/rider/shift/end', poste(POSITION, code));
  await versL('/verify/rider-code', poste({ code }, VERIFY));
  // Wrong keys, wrong codes, typed paths on every door of both Workers.
  await versL(`/health${QUERY}`);
  await versL(`/ops/board${QUERY}`, lit('QXMAUVAISECLE'));
  await versL(`/rider/moi${QUERY}`, lit('QXCODEINCONNU'));
  await versL('/rider/sos', poste({ command_id: 'qxcmd-sos-x', ...POSITION_SOS }, 'QXCODEINCONNU'));
  await versL('/verify/rider-code', poste({ code: 'QXCODEINCONNU' }, VERIFY));
  await versL('/intake/task-ready', poste({ orderId: 'QXORDTAPE', note: 'QXNOTE' }, INTAKE));
  await versL('/intake/funding', poste({ orderId: 'QXORDTAPE', status: 'QXSTATUT' }, INTAKE));
  await versL('/authority/dispatch', poste({ command: 'QXCOMMANDE' }, OPS));
  await versL('/ops/board', { method: 'OPTIONS', headers: { Origin: 'https://console.example' } });
  for (const [path, key] of [
    ['/ops/QXINCONNU', OPS], ['/intake/QXINCONNU', INTAKE], ['/rider/QXINCONNU', code], ['/produce/QXINCONNU', LIVREE_L],
    ['/verify/QXINCONNU', VERIFY], ['/authority/QXINCONNU', OPS], ['/zz/QXINCONNU', OPS],
  ] as const) {
    await versL(`${path}${QUERY}`, lit(key));
  }
  await versC(`/health${QUERY}`);
  for (const [path, key] of [['/ops/QXINCONNU', CUSTODY_OPS], ['/rider/QXINCONNU', code], ['/produce/QXINCONNU', PRODUCE], ['/produce-shop/QXINCONNU', SHOP_ARM]] as const) {
    await versC(`${path}${QUERY}`, lit(key));
  }
  // An alert reaching the founder's board on custody's door, then his close of it: every field a sentinel.
  await ok(versL('/produce/alerte', poste(alerte('ord-qxalerte-1', 'task-qxalertetache-1'), LIVREE_L)));
  await ok(versL(`/ops/alertes${QUERY}`, lit(OPS)));
  await ok(versL('/ops/alertes/ack', poste({ id: 'evidence_not_validated_aging:ord-qxalerte-1', by: 'Qxfondateur' }, OPS)));
  // Last: the door custody's own wire is refused at, opened with logistics' key — the course ends.
  await versL('/produce/course-livree', poste({ orderId: O, command_id: 'qxcmd-livree', at: new Date().toISOString() }, LIVREE_L));
}, 180_000);

/* ═══════════════════════ (i) one line per request ═══════════════════════ */

const lignesL = (cid: string, attendu = 1): Promise<Ligne[]> => attendre(recusL, (l) => l['correlation_id'] === cid, attendu);
const appel = (path: string, init: RequestInit = {}, cid?: string): Promise<Reponse> => appelSur(L, 'logistics', path, init, cid);

describe('the logistics service writes ONE structured line per request — and never an id', () => {
  it('a known route: exactly its template, method, status, duration and correlation id', async () => {
    const r = await appel('/ops/board', lit(OPS), 'corr-jrn-tableau-0001');
    expect(r.status).toBe(200);
    const mine = await lignesL('corr-jrn-tableau-0001');
    expect(mine).toEqual([
      {
        ts: expect.any(String),
        level: 'info',
        correlation_id: 'corr-jrn-tableau-0001',
        service: SERVICE,
        msg: 'request',
        route: '/ops/board',
        method: 'GET',
        status: 200,
        durationMs: expect.any(Number),
      },
    ]);
    expect(Number.isInteger(mine[0]!['durationMs']) && (mine[0]!['durationMs'] as number) >= 0).toBe(true);
  }, 60_000);

  it('every door writes its one line under its own template, and none names the order its body carries', async () => {
    const O2 = minted();
    const cas: [string, RequestInit, string, number][] = [
      ['/health', {}, '/health', 200],
      ['/intake/funding', poste({ orderId: O2, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: ilYa(60_000) }, INTAKE), '/intake/funding', 200],
      ['/verify/rider-code', poste({ code: 'QXCODEINCONNU' }, VERIFY), '/verify/rider-code', 401],
      ['/produce/course-livree', poste({ orderId: O2, command_id: 'qxcmd-livree-2', at: new Date().toISOString() }, LIVREE_L), '/produce/course-livree', 200],
      ['/authority/dispatch', { headers: cle(OPS) }, '/authority/dispatch', 404],
      ['/ops/board', { method: 'OPTIONS' }, '/ops/board', 204],
      ['/ops/alertes', lit(OPS), '/ops/alertes', 200],
      ['/ops/alertes/ack', poste({ id: `evidence_not_validated_aging:${O2}`, by: 'fondateur' }, OPS), '/ops/alertes/ack', 404],
      ['/produce/alerte', poste(alerte(O2, 'task-gabarit-2'), LIVREE_L), '/produce/alerte', 200],
    ];
    const reponses: Reponse[] = [];
    for (const [path, init] of cas) reponses.push(await appel(path, init));
    expect(reponses.map((r) => r.status)).toEqual(cas.map(([, , , status]) => status));
    for (const [i, [path, init, route, status]] of cas.entries()) {
      const r = reponses[i]!;
      const [l] = await lignesL(r.cid);
      expect(l, path).toEqual({
        ts: expect.any(String),
        level: status === 401 ? 'warn' : 'info',
        correlation_id: r.cid,
        service: SERVICE,
        msg: 'request',
        route,
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        status,
        durationMs: expect.any(Number),
      });
    }
  }, 60_000);

  it('with no inbound correlation id the line is still written, on a freshly minted one', async () => {
    const avant = lignesDans(recusL).filter((l) => l['route'] === '/health').length;
    const res = await L.dispatchFetch('http://logistics/health');
    await res.text();
    const sante = await attendre(recusL, (l) => l['route'] === '/health', avant + 1);
    expect(sante).toHaveLength(avant + 1);
    expect(sante[avant]!['correlation_id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }, 60_000);

  it('an inbound correlation id longer than 64 characters is written cut to its first 64', async () => {
    const long = `corr-jrn-long-${'c'.repeat(500)}`;
    await appel('/health', {}, long);
    const mine = await lignesL(long.slice(0, 64));
    expect(mine).toHaveLength(1);
    expect(mine[0]!['route']).toBe('/health');
    expect(recusL.some((m) => m.includes('c'.repeat(65)))).toBe(false);
  }, 60_000);

  it('an unknown path is « unmatched » on every door, and a method outside the known set is « OTHER »', async () => {
    const inconnus: Reponse[] = [];
    for (const [path, init] of [
      ['/zz/nowhere', {}],
      ['/ops/nowhere', lit(OPS)],
      ['/intake/nowhere', poste({}, INTAKE)],
    ] as const) {
      inconnus.push(await appel(path, init));
    }
    expect(inconnus.map((u) => u.status)).toEqual([404, 404, 404]);
    for (const u of inconnus) expect((await lignesL(u.cid))[0], u.cid).toMatchObject({ route: 'unmatched', status: 404, level: 'info' });
    const m = await appel('/health', { method: 'PROPFIND' });
    expect((await lignesL(m.cid))[0]).toMatchObject({ method: 'OTHER', route: '/health' });
  }, 60_000);

  it('levels: a 401 is warn · every 2xx and other 4xx is info', async () => {
    const sansCle = await appel('/ops/board', lit('QXMAUVAISECLE'));
    const refus = await appel('/ops/riders', poste({ riderId: RIDER, displayName: 'Qxnomcoursier', phoneAlias: 'qxalias-main' }, OPS));
    expect([sansCle.status, refus.status]).toEqual([401, 409]);
    expect((await lignesL(sansCle.cid))[0]).toMatchObject({ level: 'warn', status: 401, route: '/ops/board' });
    expect((await lignesL(refus.cid))[0]).toMatchObject({ level: 'info', status: 409, route: '/ops/riders' });
  }, 60_000);
});

/* ═══════════════════════ (ii) one line per fault ═══════════════════════ */

const panne = (l: Ligne, outbox: string, orderId: string): boolean => l['msg'] === 'outbox_undelivered' && l['outbox'] === outbox && l['orderId'] === orderId;
const suite = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('a delivery that does not land writes ONE line per try — on both sides of the seam', () => {
  it('custody’s drop confirmation, refused 401 by the REAL logistics door: custody’s line names the outbox, the order, the attempt and the status', async () => {
    const mine = await attendre(recusC, (l) => panne(l, COURSE_LIVREE_OUTBOX_KEY, O));
    expect(mine[0]).toEqual({
      ts: expect.any(String),
      level: 'error',
      correlation_id: `corr-${O}`,
      service: 'custody-service',
      msg: 'outbox_undelivered',
      outbox: COURSE_LIVREE_OUTBOX_KEY,
      orderId: O,
      attempts: 1,
      status: 401,
    });
    expect(mine.map((l) => l['attempts'])).toEqual(suite(mine.length));
    // The far side really said 401: its own line for that request.
    expect(lignesDans(recusL).some((l) => l['route'] === '/produce/course-livree' && l['status'] === 401 && l['level'] === 'warn')).toBe(true);
  }, 60_000);

  describe('a logistics Worker whose producer key custody does not hold', () => {
    const recusB: string[] = [];
    const lent = { actif: false };
    let B: Miniflare;
    const Ob = minted();
    const Ob2 = minted();
    let code = '';

    beforeAll(async () => {
      // Custody answering after logistics' own read bound: the one outage stood in.
      const custody = (request: Request): Promise<Response> =>
        lent.actif
          ? new Promise((r) => setTimeout(() => r(Response.json({ ok: false, reason: 'trop_tard' }, { status: 503 })), 6_000))
          : (C.dispatchFetch(request.url, request as never) as never);
      B = spawnLogistics(recusB, custody, { SERA_PRODUCE_SECRET: PRODUCE_FAUX });
      code = (await confier(B, Ob, 'rider-qxcoursier-b1', 'b1', 'supplier-qxfourn-b1')).code;
      // A readiness that never named its supplier: that row rests.
      await confier(B, Ob2, 'rider-qxcoursier-b2', 'b2', undefined);
    }, 120_000);
    afterAll(async () => {
      await stop(B);
    });

    it('the producer wire refused 401 by the REAL custody door: one error line names the outbox, its phase, the order, the attempt and the status', async () => {
      const mine = await attendre(recusB, (l) => panne(l, SNAP_CUSTODY_OUTBOX, Ob));
      expect(mine[0]).toEqual({
        ts: expect.any(String),
        level: 'error',
        correlation_id: `corr-${Ob}`,
        service: SERVICE,
        msg: 'outbox_undelivered',
        outbox: SNAP_CUSTODY_OUTBOX,
        phase: 'open',
        orderId: Ob,
        attempts: 1,
        status: 401,
      });
      expect(mine.map((l) => l['attempts'])).toEqual(suite(mine.length));
      expect(lignesDans(recusC).some((l) => l['route'] === '/produce/order/open' && l['status'] === 401 && l['orderId'] === undefined)).toBe(true);
    }, 60_000);

    it('a row whose supplier was never named says so once, as it comes to rest', async () => {
      expect(await attendre(recusB, (l) => panne(l, SNAP_CUSTODY_OUTBOX, Ob2))).toEqual([
        {
          ts: expect.any(String),
          level: 'error',
          correlation_id: `corr-${Ob2}`,
          service: SERVICE,
          msg: 'outbox_undelivered',
          outbox: SNAP_CUSTODY_OUTBOX,
          phase: 'open',
          orderId: Ob2,
          attempts: 0,
          reason: 'no_supplier',
        },
      ]);
    }, 60_000);

    it('a 5xx is error: the end of shift custody cannot vouch for', async () => {
      const r = await appelSur(B, 'logistics', '/rider/shift/end', poste({}, code));
      expect(r.status).toBe(503);
      expect((await attendre(recusB, (l) => l['correlation_id'] === r.cid))[0]).toMatchObject({ level: 'error', status: 503, route: '/rider/shift/end' });
    }, 60_000);

    it('custody not answering in time: one warn line names the read and the order, by the error’s class — the rider’s read still answers', async () => {
      lent.actif = true;
      const r = await appelSur(B, 'logistics', '/rider/moi', lit(code));
      expect(r.status).toBe(200);
      expect(await attendre(recusB, (l) => l['msg'] === 'custody_read_failed' && l['orderId'] === Ob)).toEqual([
        {
          ts: expect.any(String),
          level: 'warn',
          correlation_id: `corr-${Ob}`,
          service: SERVICE,
          msg: 'custody_read_failed',
          orderId: Ob,
          error: 'TimeoutError',
        },
      ]);
      lent.actif = false;
    }, 60_000);
  });

  it('a logistics Worker with no producer key: its wire says so once, by name, as it comes to rest', async () => {
    const recusN: string[] = [];
    const N = spawnLogistics(recusN, (request) => C.dispatchFetch(request.url, request as never) as never, {});
    const On = minted();
    await confier(N, On, 'rider-qxcoursier-n1', 'n1', 'supplier-qxfourn-n1');
    expect(await attendre(recusN, (l) => panne(l, SNAP_CUSTODY_OUTBOX, On))).toEqual([
      {
        ts: expect.any(String),
        level: 'error',
        correlation_id: `corr-${On}`,
        service: SERVICE,
        msg: 'outbox_undelivered',
        outbox: SNAP_CUSTODY_OUTBOX,
        phase: 'open',
        orderId: On,
        attempts: 0,
        reason: 'not_configured',
      },
    ]);
    await stop(N);
  }, 60_000);
});

/* ═══════════════════ (iii) nothing a person typed or owns ═══════════════════ */

function porteSentinelle(message: string, s: string | number): boolean {
  if (typeof s === 'number') return new RegExp(`(?<![0-9A-Za-z-])${s}(?![0-9A-Za-z-])`).test(message);
  return message.includes(s);
}

describe('across a whole course, no line on either side carries a person’s data, a position, a code, a secret, a body, a query, an id or an amount', () => {
  it('every request of the course wrote its one line on the Worker it reached (so the check below is never a check of an empty log)', async () => {
    for (const cid of balayageL) expect(await attendre(recusL, (l) => l['correlation_id'] === cid), cid).toHaveLength(1);
    for (const cid of balayageC) expect(await attendre(recusC, (l) => l['correlation_id'] === cid), cid).toHaveLength(1);
  }, 120_000);

  it('no captured line — request or fault, logistics or custody — holds any sentinel', () => {
    expect(mintes.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
    const sentinelles: (string | number)[] = [
      // the buyer's place and voice
      'Qxzone', 'Qxrepere', 'Qxdirections', 'qxrelais', '12.3714277', '1.5196603', AUDIO_UUID,
      // the rider: who he is, where he stands, what he was given and typed
      'qxcoursier', 'Qxnomcoursier', 'qxalias', '12.3651234', '1.5341234', '12.3656789', '1.5356789', ...mintes, 'QXDROP', 'qxpreuve',
      // the course's own ids, the supplier, the package, every command id
      `pkg-${O}`, 'qxfourn', 'qxcmd',
      // paths, queries, headers, typed bodies
      'QXQUERY', 'QXPAGE', 'QXINCONNU', 'QXAGENT', '203.0.113.77', '198.51.100.23', 'QXCOOKIE', 'qxreferer', 'QXMAUVAISECLE', 'QXCODEINCONNU',
      'QXORDTAPE', 'QXNOTE', 'QXSTATUT', 'QXCOMMANDE',
      // an alert on the founder's board, and who closed it
      'qxalerte', 'Qxfondateur',
      // every secret both Workers hold
      OPS, INTAKE, VERIFY, PRODUCE, LIVREE_L, LIVREE_C, CUSTODY_OPS, SHOP_ARM, PRODUCE_FAUX,
      // money
      MONTANT,
    ];
    const fautes: string[] = [];
    for (const message of [...recusL, ...recusC]) {
      for (const s of sentinelles) if (porteSentinelle(message, s)) fautes.push(`${String(s)} ⟵ ${message}`);
    }
    expect(fautes).toEqual([]);
    expect(recusL.length).toBeGreaterThan(balayageL.length);
    expect(recusC.length).toBeGreaterThan(balayageC.length);
  });

  it('every line is one JSON object with its level, its own service, its message and a correlation id', () => {
    expect(recusL.length).toBeGreaterThan(0);
    expect(recusC.length).toBeGreaterThan(0);
    for (const [recus, service] of [[recusL, SERVICE], [recusC, 'custody-service']] as const) {
      for (const message of recus) {
        const l = safeJson(message);
        expect(typeof l['correlation_id'], message).toBe('string');
        expect(l['service'], message).toBe(service);
        expect(['info', 'warn', 'error'], message).toContain(l['level']);
        expect(typeof l['msg'], message).toBe('string');
      }
    }
  });

  it('no logistics line ever names an order on a request', () => {
    expect(lignesDans(recusL).filter((l) => l['msg'] === 'request' && 'orderId' in l)).toEqual([]);
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
