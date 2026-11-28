import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';

/**
 * ═══ THE FOUNDER READS EVERY OPEN PROBLEM IN ONE PLACE, AND ONLY HE CLOSES IT ═══
 *
 * Execution Contract §6 asks for an alert when « a ready package has no task
 * past SLA · a package has an impossible custody sequence · evidence is
 * uploaded but not validated ». Each one is driven here on the REAL logistics
 * Worker — and, for the two custody problems, the REAL custody Worker beside
 * it, the alert crossing the real wire — and then asked of the founder's own
 * read, `GET /ops/alertes`, never of a response alone:
 *
 *   · a ready parcel with no course is one line once it has waited the
 *     window, counted from the latest instant its facts carry (or from the
 *     moment a course was taken back); composing a course ends it;
 *   · a damaged custody record keeps every answer it gives today, and one
 *     `impossible_custody` alert reaches the read, however often it is asked;
 *   · evidence recorded with no decision past its window is one
 *     `evidence_not_validated_aging` alert; the alarm decides nothing;
 *   · the ack is the founder's act on the ops door alone, for an alert that
 *     is really raised, and a closed alert stays closed.
 */

const OPS = 'test-ops-alertes';
const INTAKE = 'test-intake-alertes';
const VERIFY = 'test-verify-alertes';
const LIVREE = 'test-livree-alertes';
const CUSTODY_OPS = 'test-custody-ops-alertes';
const PRODUCE_KEY = 'test-produce-key-alertes';
const SHOP_ARM_KEY = 'test-shop-arm-key-alertes';
const SUPPLIER = 'supplier-alertes-1';
const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

type Json = Record<string, unknown>;

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

interface Hold {
  custody?: Miniflare;
  logistics?: Miniflare;
}

function spawnLogistics(hold: Hold = {}): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'alertes-logistics-')),
    serviceBindings: {
      CUSTODY: (request: Request) => hold.custody!.dispatchFetch(request.url, request as never) as never,
    },
    bindings: {
      SERA_OPS_SECRET: OPS,
      SERA_INTAKE_SECRET: INTAKE,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SERA_COURSE_LIVREE_SECRET: LIVREE,
    },
  });
  live.push(mf);
  hold.logistics = mf;
  return mf;
}

function spawnCustody(hold: Hold, dir: string, extra: Record<string, string> = {}): Miniflare {
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: {
      LOGISTICS: (request: Request) => hold.logistics!.dispatchFetch(request.url, request as never) as never,
    },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: CUSTODY_OPS,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SERA_COURSE_LIVREE_SECRET: LIVREE,
      ...extra,
    },
  });
  live.push(mf);
  hold.custody = mf;
  return mf;
}

async function call(mf: Miniflare, host: string, key: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; text: string; json: Json }> {
  const res = await mf.dispatchFetch(`http://${host}${path}`, {
    method,
    headers: { ...(key === null ? {} : { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { json = {}; }
  return { status: res.status, text, json };
}

const ops = (mf: Miniflare, path: string, body?: unknown) => call(mf, 'logistics', OPS, body === undefined ? 'GET' : 'POST', path, body);
const intake = (mf: Miniflare, path: string, body: unknown) => call(mf, 'logistics', INTAKE, 'POST', path, body);
const custodyOps = (mf: Miniflare, path: string, body?: unknown) => call(mf, 'custody', CUSTODY_OPS, body === undefined ? 'GET' : 'POST', path, body);

const MINUTE = 60_000;
const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const fenetre = () => ({ start: iso(0), end: iso(8 * 60 * MINUTE) });
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const SLACK_MS = 2_000;

const funded = (mf: Miniflare, orderId: string, asOf: string, over: Json = {}) =>
  intake(mf, '/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf, ...over });
const ready = (mf: Miniflare, orderId: string, asOf: string) =>
  intake(mf, '/intake/readiness', { orderId, ready: true, asOf, supplierRef: SUPPLIER });

async function alertes(mf: Miniflare): Promise<Json[]> {
  const res = await ops(mf, '/ops/alertes');
  expect(res.status, `GET /ops/alertes ${res.text.slice(0, 200)}`).toBe(200);
  expect(res.json['ok']).toBe(true);
  return res.json['alertes'] as Json[];
}

async function attendreAlerte(mf: Miniflare, id: string, ms = 15_000): Promise<Json> {
  const until = Date.now() + ms;
  let vu: Json[] = [];
  while (Date.now() < until) {
    const res = await ops(mf, '/ops/alertes');
    if (res.status === 200) {
      vu = res.json['alertes'] as Json[];
      const hit = vu.find((a) => a['id'] === id);
      if (hit !== undefined) return hit;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`alert ${id} never reached the founder's read — seen: ${JSON.stringify(vu)}`);
}

function within(value: unknown, before: number, after: number): boolean {
  if (typeof value !== 'string') return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && t >= before - SLACK_MS && t <= after + SLACK_MS;
}

function sqliteFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.sqlite') && !p.includes('metadata')) found.push(p);
    }
  };
  walk(dir);
  return found;
}

/** Rewrite stored command bytes, same length — the damage the custody storage suite inflicts. */
function forgeInStoredCommands(dir: string, from: string, to: string): number {
  if (from.length !== to.length) throw new Error('a forgery must not change length');
  let forged = 0;
  for (const file of sqliteFiles(dir)) {
    const db = new DatabaseSync(file);
    try {
      const rows = db.prepare('select key, value from _cf_KV').all() as unknown as { key: Uint8Array; value: Uint8Array }[];
      for (const row of rows) {
        const text = Buffer.from(row.value).toString('latin1');
        if (!Buffer.from(row.key).toString('latin1').startsWith('custody:cmd:') || !text.includes(from)) continue;
        db.prepare('update _cf_KV set value = ? where key = ?').run(Buffer.from(text.split(from).join(to), 'latin1'), row.key);
        forged += 1;
      }
    } finally {
      db.close();
    }
  }
  return forged;
}

/** A custody file opened, both codes armed, the pickup verified by the founder's door. */
async function custodyVerified(custody: Miniflare, orderId: string, riderId: string): Promise<void> {
  expect((await custodyOps(custody, '/ops/order/open', {
    orderId, taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, correlationId: `corr-${orderId}`, supplierId: SUPPLIER,
  })).status).toBe(200);
  expect((await custodyOps(custody, '/ops/secrets/arm', { orderId, command_id: `arm-p-${orderId}`, kind: 'pickup_verification_code', secret: `PICK-${orderId}` })).status).toBe(200);
  expect((await custodyOps(custody, '/ops/secrets/arm', { orderId, command_id: `arm-d-${orderId}`, kind: 'buyer_drop_code', secret: `DROP-${orderId}` })).status).toBe(200);
  const v = await custodyOps(custody, '/ops/verification', {
    orderId, command_id: `v-${orderId}`, riderId, presentedPickupCode: `PICK-${orderId}`, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${orderId}`,
  });
  expect(v.status, v.text).toBe(200);
}

describe('a ready parcel with no course becomes one alert once it has waited the window', () => {
  it('one order: counted from the later of its two facts, listed past the hour, gone once a course is composed', async () => {
    const mf = spawnLogistics();
    const O = 'ord-alerte-pret';
    const JEUNE = 'ord-alerte-jeune';
    const readyAt = iso(-61 * MINUTE);
    expect((await funded(mf, O, iso(-90 * MINUTE))).status).toBe(200);
    expect((await ready(mf, O, readyAt)).status).toBe(200);
    // Ready half an hour ago: on « à préparer », not yet a problem.
    expect((await funded(mf, JEUNE, iso(-30 * MINUTE))).status).toBe(200);
    expect((await ready(mf, JEUNE, iso(-30 * MINUTE))).status).toBe(200);

    expect(await alertes(mf)).toEqual([
      { id: `ready_package_no_task:${O}:${readyAt}`, scenario: 'ready_package_no_task', orderId: O, since: readyAt },
    ]);

    const composed = await ops(mf, '/ops/task', { command_id: 't-pret', orderId: O, location: LOC, window: fenetre() });
    expect(composed.status, composed.text).toBe(200);
    expect(await alertes(mf), 'a composed course ends the alert').toEqual([]);
  }, 60_000);

  it('a package is one line under its first order, counted from the latest fact of any of its orders', async () => {
    const mf = spawnLogistics();
    const A = 'ord-alerte-colis-a';
    const B = 'ord-alerte-colis-b';
    const COLIS = { packageId: 'col-alerte-1', orderIds: [A, B] };
    const last = iso(-65 * MINUTE);
    expect((await funded(mf, A, iso(-100 * MINUTE), { package: COLIS })).status).toBe(200);
    expect((await ready(mf, A, iso(-80 * MINUTE))).status).toBe(200);
    expect((await funded(mf, B, iso(-70 * MINUTE), { package: COLIS })).status).toBe(200);
    expect((await ready(mf, B, last)).status).toBe(200);

    expect(await alertes(mf)).toEqual([
      { id: `ready_package_no_task:${A}:${last}`, scenario: 'ready_package_no_task', orderId: A, packageId: 'col-alerte-1', orderIds: [A, B], since: last },
    ]);
  }, 60_000);

  it('a course taken back starts a new episode: the window counts again from the take-back', async () => {
    const mf = spawnLogistics();
    const O = 'ord-alerte-reprise';
    const readyAt = iso(-61 * MINUTE);
    expect((await funded(mf, O, iso(-90 * MINUTE))).status).toBe(200);
    expect((await ready(mf, O, readyAt)).status).toBe(200);
    expect((await alertes(mf)).map((a) => a['id'])).toEqual([`ready_package_no_task:${O}:${readyAt}`]);

    const RIDER = 'rider-alerte-reprise';
    await ops(mf, '/ops/riders', { riderId: RIDER, displayName: RIDER, phoneAlias: 'reprise' });
    await ops(mf, '/ops/riders/certify', { riderId: RIDER, certified: true });
    const code = (await ops(mf, '/ops/rider-code/mint', { riderId: RIDER })).json['code'] as string;
    const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
    const acts = httpShiftActs('http://logistics', createManualConnectivity('online'), fetchFn);
    await acts.ackPrivacy(code);
    expect((await acts.startShift(code)).ok).toBe(true);
    const composed = await ops(mf, '/ops/task', { command_id: 't-reprise', orderId: O, location: LOC, window: fenetre() });
    expect(composed.status, composed.text).toBe(200);
    const granted = await ops(mf, '/ops/assign', { command_id: 'a-reprise', taskId: composed.json['taskId'], riderId: RIDER });
    expect(granted.status, granted.text).toBe(200);
    const assignmentId = (granted.json['assignment'] as Json)['assignmentId'] as string;
    const before = Date.now();
    const back = await ops(mf, '/ops/assignment/take-back', { command_id: 'tb-reprise', assignmentId, custodyNotBegun: true });
    expect(back.status, back.text).toBe(200);

    // Composable again…
    expect(((await ops(mf, '/ops/a-preparer')).json['attente'] as Json[]).map((r) => r['orderId'])).toContain(O);
    // …and its window starts from the take-back, not from facts an hour old.
    expect(await alertes(mf)).toEqual([]);
    const oldEpisode = await ops(mf, '/ops/alertes/ack', { id: `ready_package_no_task:${O}:${readyAt}`, by: 'founder' });
    expect(oldEpisode.status, 'the old episode is no longer raised').toBe(404);
    expect(Date.now() - before).toBeLessThan(60 * MINUTE);
  }, 60_000);
});

describe('the ack is the founder’s act, on the ops door alone, for an alert that is really raised', () => {
  it('no key or a wrong key is refused; an ack for nothing is refused; an ack closes the alert, and a second ack is the same ack', async () => {
    const mf = spawnLogistics();
    const O = 'ord-alerte-ack';
    const JEUNE = 'ord-alerte-ack-jeune';
    const readyAt = iso(-62 * MINUTE);
    expect((await funded(mf, O, iso(-70 * MINUTE))).status).toBe(200);
    expect((await ready(mf, O, readyAt)).status).toBe(200);
    const jeuneAt = iso(-10 * MINUTE);
    expect((await funded(mf, JEUNE, jeuneAt)).status).toBe(200);
    expect((await ready(mf, JEUNE, jeuneAt)).status).toBe(200);
    const id = `ready_package_no_task:${O}:${readyAt}`;
    expect((await alertes(mf)).map((a) => a['id'])).toEqual([id]);

    expect((await call(mf, 'logistics', null, 'POST', '/ops/alertes/ack', { id, by: 'founder' })).status).toBe(401);
    expect((await call(mf, 'logistics', INTAKE, 'POST', '/ops/alertes/ack', { id, by: 'founder' })).status).toBe(401);
    expect((await call(mf, 'logistics', LIVREE, 'POST', '/ops/alertes/ack', { id, by: 'founder' })).status).toBe(401);
    expect(await call(mf, 'logistics', LIVREE, 'POST', '/produce/alertes/ack', { id, by: 'founder' }), "custody's own door has no ack")
      .toMatchObject({ status: 404, json: { ok: false, reason: 'not_found' } });
    expect((await call(mf, 'logistics', null, 'GET', '/ops/alertes')).status).toBe(401);
    expect((await ops(mf, '/ops/alertes/ack', { by: 'founder' })).status).toBe(400);
    expect((await ops(mf, '/ops/alertes/ack', { id })).status).toBe(400);
    expect(await ops(mf, '/ops/alertes/ack', { id: 'impossible_custody:ord-personne', by: 'founder' }))
      .toMatchObject({ status: 404, json: { ok: false, reason: 'alerte_inconnue' } });
    expect(await ops(mf, '/ops/alertes/ack', { id: `ready_package_no_task:${JEUNE}:${jeuneAt}`, by: 'founder' }), 'not waited the window yet: not raised')
      .toMatchObject({ status: 404, json: { ok: false, reason: 'alerte_inconnue' } });
    expect((await alertes(mf)).map((a) => a['id']), 'refused acks close nothing').toEqual([id]);

    const before = Date.now();
    const ack = await ops(mf, '/ops/alertes/ack', { id, by: 'founder' });
    const after = Date.now();
    expect(ack.status, ack.text).toBe(200);
    expect(ack.json).toMatchObject({
      ok: true, duplicate: false,
      alerte: { id, scenario: 'ready_package_no_task', orderId: O, since: readyAt, acknowledgedBy: 'founder' },
    });
    const at = (ack.json['alerte'] as Json)['acknowledgedAt'];
    expect(within(at, before, after), `acknowledgedAt=${String(at)} is Séra's clock`).toBe(true);
    expect(await alertes(mf), 'closed').toEqual([]);

    const again = await ops(mf, '/ops/alertes/ack', { id, by: 'founder' });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, duplicate: true, alerte: { id, acknowledgedAt: at, acknowledgedBy: 'founder' } });
    expect(await alertes(mf)).toEqual([]);
  }, 60_000);
});

describe('custody’s two problems cross the real wire into the founder’s read', () => {
  it('a damaged custody record answers exactly as before, and one impossible_custody alert reaches the read however often it is asked', async () => {
    const hold: Hold = {};
    const logistics = spawnLogistics(hold);
    const dir = mkdtempSync(join(tmpdir(), 'alertes-custody-garde-'));
    let custody = spawnCustody(hold, dir);
    const O = 'ord-alerte-garde';
    await custodyVerified(custody, O, 'rider-AAAA-0001');
    await custody.dispose();
    live = live.filter((m) => m !== custody);
    expect(forgeInStoredCommands(dir, 'rider-AAAA-0001', 'rider-BBBB-0001')).toBeGreaterThan(0);
    custody = spawnCustody(hold, dir);

    // Three hits on the damaged file: every answer is the one it gives today.
    const first = Date.now();
    const ledger = await custodyOps(custody, `/ops/ledger?orderId=${O}`);
    expect(ledger.status).toBe(409);
    expect(ledger.text).toBe('{"ok":false,"reason":"command_log_tampered"}');
    const verify = await custodyOps(custody, `/ops/ledger/verify?orderId=${O}`);
    expect(verify.status).toBe(200);
    expect(verify.text).toBe('{"ok":false,"valid":true,"headMatches":false,"reason":"command_log_tampered"}');
    const act = await custodyOps(custody, '/ops/custody/begin', { orderId: O, command_id: `b-${O}`, riderId: 'rider-AAAA-0001', custodySealId: 'SEAL-G', sealPhotoRefs: [] });
    expect(act.status).toBe(409);
    expect(act.text).toBe('{"ok":false,"reason":"command_log_tampered"}');
    const last = Date.now();

    const id = `impossible_custody:${O}`;
    const alerte = await attendreAlerte(logistics, id);
    expect(alerte).toEqual({
      id, scenario: 'impossible_custody', orderId: O, packageId: `pkg-${O}`, taskId: `task-${O}`,
      since: alerte['since'], detail: 'command_log_tampered',
    });
    expect(within(alerte['since'], first, last), `since=${String(alerte['since'])} is custody's clock at the first hit`).toBe(true);

    // More hits change nothing on either side.
    expect((await custodyOps(custody, `/ops/ledger?orderId=${O}`)).text).toBe('{"ok":false,"reason":"command_log_tampered"}');
    await new Promise((r) => setTimeout(r, 1_500));
    expect((await alertes(logistics)).filter((a) => a['orderId'] === O), 'one alert for one cause').toHaveLength(1);

    // The founder closes it; it stays closed, and the record is still refused.
    const ack = await ops(logistics, '/ops/alertes/ack', { id, by: 'founder' });
    expect(ack.status, ack.text).toBe(200);
    expect(ack.json).toMatchObject({ ok: true, duplicate: false, alerte: { id, scenario: 'impossible_custody', acknowledgedBy: 'founder' } });
    expect((await call(logistics, 'logistics', LIVREE, 'POST', '/ops/alertes/ack', { id, by: 'founder' })).status, "custody's key is not the founder's").toBe(401);
    expect(await alertes(logistics)).toEqual([]);
    expect((await custodyOps(custody, `/ops/ledger?orderId=${O}`)).text).toBe('{"ok":false,"reason":"command_log_tampered"}');
    await new Promise((r) => setTimeout(r, 1_000));
    expect(await alertes(logistics), 'never re-opened').toEqual([]);
  }, 60_000);

  it('evidence recorded with no decision past its window is one evidence_not_validated_aging alert; decided evidence raises none; the alarm decides nothing', async () => {
    const hold: Hold = {};
    const logistics = spawnLogistics(hold);
    const custody = spawnCustody(hold, mkdtempSync(join(tmpdir(), 'alertes-custody-preuve-')), { EVIDENCE_AGING_MS: '1500' });
    const RIDER = 'rider-alerte-preuve';
    const bundle = (O: string) => ({ taskId: `task-${O}`, packageId: `pkg-${O}`, custodySealId: `SEAL-${O}`, artifacts: [], capturedAt: iso(0) });
    const scelle = async (O: string) => {
      await custodyVerified(custody, O, RIDER);
      expect((await custodyOps(custody, '/ops/custody/begin', { orderId: O, command_id: `b-${O}`, riderId: RIDER, custodySealId: `SEAL-${O}`, sealPhotoRefs: [] })).status).toBe(200);
    };

    // U: a decision id already on record means the evidence is left with no decision.
    const U = 'ord-alerte-preuve-u';
    await scelle(U);
    const deja = await custodyOps(custody, '/ops/delivery/decide', { orderId: U, command_id: 'auto-decide-e-u' });
    expect(deja.json).toMatchObject({ ok: false, reason: 'validation_before_evidence' });
    const before = Date.now();
    const ev = await custodyOps(custody, '/ops/delivery/evidence', { orderId: U, command_id: 'e-u', bundle: bundle(U) });
    const after = Date.now();
    expect(ev.json).toMatchObject({ ok: true, status: 'evidence_recorded' });
    const decisions = async (O: string) => ((await custodyOps(custody, `/ops/ledger?orderId=${O}`)).json['entries'] as Json[]).filter((e) => e['kind'] === 'validation_decision');
    expect(await decisions(U), 'the evidence is left with no decision').toEqual([]);

    // N: evidence decided at once, as every delivery is. D: decided by the founder inside the window.
    const N = 'ord-alerte-preuve-n';
    await scelle(N);
    expect((await custodyOps(custody, '/ops/delivery/evidence', { orderId: N, command_id: 'e-n', bundle: bundle(N) })).status).toBe(200);
    const D = 'ord-alerte-preuve-d';
    await scelle(D);
    expect((await custodyOps(custody, '/ops/delivery/decide', { orderId: D, command_id: 'auto-decide-e-d' })).status).toBe(409);
    expect((await custodyOps(custody, '/ops/delivery/evidence', { orderId: D, command_id: 'e-d', bundle: bundle(D) })).status).toBe(200);
    expect((await custodyOps(custody, '/ops/delivery/decide', { orderId: D, command_id: 'dec-d' })).json).toMatchObject({ ok: true, result: 'validated' });

    const id = `evidence_not_validated_aging:${U}`;
    const alerte = await attendreAlerte(logistics, id);
    expect(alerte).toEqual({ id, scenario: 'evidence_not_validated_aging', orderId: U, taskId: `task-${U}`, since: alerte['since'] });
    expect(within(alerte['since'], before, after), `since=${String(alerte['since'])} is when custody recorded the evidence`).toBe(true);

    await new Promise((r) => setTimeout(r, 2_500));
    expect((await alertes(logistics)).map((a) => a['id']), 'decided evidence raises nothing; one alert for one cause').toEqual([id]);

    // The alarm decided and released nothing.
    expect(await decisions(U)).toEqual([]);
    const events = ((await custodyOps(custody, `/ops/events?orderId=${U}`)).json['events'] as Json[]).map((e) => e['name']);
    expect(events).not.toContain('delivery.validated.v1');
    expect(events).not.toContain('custody.transferred_to_customer.v1');
  }, 60_000);
});

describe('custody’s door answers what custody’s stand-in answers', () => {
  it('a readable alert is 200 once and 200 duplicate after, the first copy standing; an unreadable body is the one 400 and stores nothing', async () => {
    const mf = spawnLogistics();
    const O = 'ord-alerte-porte';
    const AUTRE = 'ord-alerte-porte-refus';
    const produce = (body: unknown) => call(mf, 'logistics', LIVREE, 'POST', '/produce/alerte', body);
    const evenement = (orderId: string, scenario: string, serverTime: string, payload: Json): Json => ({
      name: 'reconciliation.alert.v1',
      envelope: { command_id: `alerte-${scenario}-${orderId}`, correlation_id: `corr-${orderId}`, aggregateVersion: 0, actor: 'custody-service:ops-monitor', serverTime, version: '1' },
      payload: { scenario, order_id: orderId, ...payload },
    });
    const garde = (orderId: string, serverTime: string, payload: Json = {}) =>
      evenement(orderId, 'impossible_custody', serverTime, { package_id: `pkg-${orderId}`, task_id: `task-${orderId}`, detail: 'command_log_tampered', ...payload });
    const preuve = (orderId: string, payload: Json = {}) =>
      evenement(orderId, 'evidence_not_validated_aging', iso(0), { task_id: `task-${orderId}`, submitted_at: iso(-31 * MINUTE), age_min: 31, ...payload });

    const firstAt = iso(-5 * MINUTE);
    expect((await call(mf, 'logistics', OPS, 'POST', '/produce/alerte', garde(O, firstAt))).status, "the founder's key is not custody's").toBe(401);
    expect(await produce(garde(O, firstAt))).toMatchObject({ status: 200, json: { ok: true, duplicate: false } });
    expect(await produce(garde(O, firstAt)), 'a resend').toMatchObject({ status: 200, json: { ok: true, duplicate: true } });
    expect(await produce(garde(O, iso(0))), 'a later copy of the same alert').toMatchObject({ status: 200, json: { ok: true, duplicate: true } });
    const id = `impossible_custody:${O}`;
    expect(await alertes(mf), 'one alert, and the first copy stands').toEqual([
      { id, scenario: 'impossible_custody', orderId: O, packageId: `pkg-${O}`, taskId: `task-${O}`, since: firstAt, detail: 'command_log_tampered' },
    ]);

    const raw = await mf.dispatchFetch('http://logistics/produce/alerte', {
      method: 'POST', headers: { Authorization: `Bearer ${LIVREE}`, 'Content-Type': 'application/json' }, body: 'pas du json',
    });
    expect({ status: raw.status, text: await raw.text() }).toEqual({ status: 400, text: '{"ok":false,"reason":"malformed"}' });
    const illisibles: [string, unknown][] = [
      ['not an event', { orderId: AUTRE }],
      ['another event name', { ...garde(AUTRE, firstAt), name: 'saga.stuck.v1' }],
      ['an unknown scenario', evenement(AUTRE, 'ready_package_no_task', firstAt, {})],
      ['a detail outside the six', garde(AUTRE, firstAt, { detail: 'autre_chose' })],
      ['a key custody never writes', garde(AUTRE, firstAt, { montant: 1000 })],
      ['a proof with no instant', preuve(AUTRE, { submitted_at: 'hier' })],
      ['a proof with a negative age', preuve(AUTRE, { age_min: -1 })],
    ];
    for (const [nom, body] of illisibles) {
      expect(await produce(body), nom).toMatchObject({ status: 400, json: { ok: false, reason: 'malformed' } });
    }
    expect((await alertes(mf)).map((a) => a['id']), 'an unreadable body stores nothing').toEqual([id]);

    const recorded = iso(-31 * MINUTE);
    expect(await produce(preuve(O, { submitted_at: recorded }))).toMatchObject({ status: 200, json: { ok: true, duplicate: false } });
    expect(await alertes(mf)).toEqual([
      { id: `evidence_not_validated_aging:${O}`, scenario: 'evidence_not_validated_aging', orderId: O, taskId: `task-${O}`, since: recorded },
      { id, scenario: 'impossible_custody', orderId: O, packageId: `pkg-${O}`, taskId: `task-${O}`, since: firstAt, detail: 'command_log_tampered' },
    ]);

    // Closed by the founder, a resend is still 200 duplicate and re-opens nothing.
    expect((await ops(mf, '/ops/alertes/ack', { id, by: 'founder' })).status).toBe(200);
    expect(await produce(garde(O, firstAt))).toMatchObject({ status: 200, json: { ok: true, duplicate: true } });
    expect((await alertes(mf)).map((a) => a['id']), 'a closed alert stays closed').toEqual([`evidence_not_validated_aging:${O}`]);
  }, 60_000);
});
