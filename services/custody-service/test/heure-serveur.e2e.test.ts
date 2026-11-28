import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

/**
 * ═══ SÉRA'S OWN CLOCK DATES EVERY RIDER ACT ═══
 *
 * SE-I06: custody and delivery validation stay pending « until authoritative
 * server ack », and the canon event envelope names its instant `serverTime`
 * (§5.7). On the RIDER door the instant a pickup check, a seal, the delivery
 * evidence, the buyer's code and a door inspection are recorded at is THIS
 * Worker's clock — the rule `/door/refusal`, `/door/expire`, `/return/open`
 * and `/return/handover` already follow. A body `at` is still accepted (and
 * still ISO-checked) so nothing an installed phone sends is refused; it is
 * simply never what the record says. The founder's ops door keeps his
 * attested instant.
 *
 * Driven on the REAL bundled Worker (miniflare, real DO storage). Every claim
 * is asked of the LEDGER, the EVENTS, the founder's attestations read and the
 * wire logistics received — never of the response alone. The logistics
 * stand-in answers the two paths custody calls exactly as logistics-do.ts
 * does: the rider-code directory (200 with the rider, else 401) and the
 * course-closed wire (200 by name, on the course-livrée key).
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-ops-secret-heure-0001';
const PRODUCE_KEY = 'test-produce-secret-heure-0001';
const SHOP_ARM_KEY = 'test-shop-arm-secret-heure-0001';
const VERIFY_KEY = 'test-rider-verify-secret-heure';
const LIVREE_KEY = 'test-course-livree-secret-heure';

const RIDER = 'rider-heure-0001';
const RIDER_CODE = 'SR-HEURE-PERSONAL-0001';
const SUPPLIER = 'supplier-heure-1';
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

/** What a request may claim — years away from the Worker's clock. */
const PAST = '2020-01-01T00:00:00.000Z';
const ALSO_PAST = '2021-06-01T00:00:00.000Z';
/** The founder's attested instant on his own door. */
const T = '2026-11-20T09:00:00.000Z';
/** Slack around the test's own window: workerd reads the host clock, coarsely. */
const SLACK_MS = 2_000;

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-heure-${tag}-`));
  dirs.push(d);
  return d;
}
// Disposed after each test, passed or failed: a failed assertion must not leave workerd running.
const live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((m) => m.dispose()));
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

interface LogisticsWorld {
  livree: Json[];
}

function logisticsStub(world: LogisticsWorld) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const auth = request.headers.get('Authorization') ?? '';
    if (path === '/verify/rider-code') {
      if (auth !== `Bearer ${VERIFY_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const body = (await request.json().catch(() => null)) as Json | null;
      if (String(body?.['code'] ?? '') === RIDER_CODE) return Response.json({ ok: true, riderId: RIDER });
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (path === '/produce/course-livree') {
      if (auth !== `Bearer ${LIVREE_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
      world.livree.push((await request.json().catch(() => ({}))) as Json);
      return Response.json({ ok: true, status: 'livree' });
    }
    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  };
}

function boot(dir: string, world: LogisticsWorld): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: { LOGISTICS: logisticsStub(world) },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: OPS,
      SERA_RIDER_VERIFY_SECRET: VERIFY_KEY,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
      SERA_COURSE_LIVREE_SECRET: LIVREE_KEY,
    },
  });
  live.push(mf);
  return mf;
}

async function call(mf: Miniflare, method: string, path: string, auth: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method,
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { json = { __raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

async function opened(mf: Miniflare, orderId: string, pickup: string, drop: string): Promise<void> {
  expect((await call(mf, 'POST', '/produce/order/open', PRODUCE_KEY, {
    orderId, taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, correlationId: `corr-${orderId}`, supplierId: SUPPLIER,
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, {
    orderId, command_id: `arm-p-${orderId}`, kind: 'pickup_verification_code', secret: pickup,
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce-shop/secrets/arm', SHOP_ARM_KEY, {
    orderId, command_id: `arm-d-${orderId}`, kind: 'buyer_drop_code', secret: drop,
  })).status).toBe(200);
}

interface Recorded {
  entries: Json[];
  events: Json[];
}

async function recorded(mf: Miniflare, orderId: string): Promise<Recorded> {
  const ledger = await call(mf, 'GET', `/ops/ledger?orderId=${orderId}`, OPS);
  const events = await call(mf, 'GET', `/ops/events?orderId=${orderId}`, OPS);
  return { entries: ledger.json['entries'] as Json[], events: events.json['events'] as Json[] };
}

function within(iso: unknown, before: number, after: number): boolean {
  if (typeof iso !== 'string') return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= before - SLACK_MS && t <= after + SLACK_MS;
}

/**
 * One rider act through the rider door carrying a 2020 `at`, then the same
 * act again under the same command id carrying a 2021 `at`, then a DIFFERENT
 * act under that id (`autre` changes its content). Returns what the act ADDED
 * to the ledger and the events, and the window it ran in.
 */
async function riderAct(mf: Miniflare, orderId: string, path: string, body: Json, autre: Json) {
  const avant = await recorded(mf, orderId);
  const before = Date.now();
  const res = await call(mf, 'POST', `/rider${path}`, RIDER_CODE, { orderId, ...body, at: PAST });
  const after = Date.now();
  expect(res.status, `${path} ${JSON.stringify(res.json)}`).toBe(200);
  const apres = await recorded(mf, orderId);
  const entries = apres.entries.slice(avant.entries.length);
  const events = apres.events.slice(avant.events.length);
  expect(entries.length, `${path} must write the ledger`).toBeGreaterThan(0);

  // The same act again, under the same id, claiming another time: the same
  // act — answered as recorded, nothing new written, the first instant kept.
  const again = await call(mf, 'POST', `/rider${path}`, RIDER_CODE, { orderId, ...body, at: ALSO_PAST });
  expect(again.status, `${path} resend ${JSON.stringify(again.json)}`).toBe(res.status);
  expect(again.json['duplicate'], `${path} resend is the same act`).toBe(true);
  const rejoue = await recorded(mf, orderId);
  expect(rejoue.entries, `${path} resend writes nothing`).toEqual(apres.entries);
  expect(rejoue.events.length, `${path} resend emits nothing`).toBe(apres.events.length);

  // Another act under the same id: refused by name, nothing written — the time
  // is the only field a resend may change.
  const conflit = await call(mf, 'POST', `/rider${path}`, RIDER_CODE, { orderId, ...body, ...autre, at: PAST });
  expect(conflit.status, `${path} other content ${JSON.stringify(conflit.json)}`).toBe(409);
  expect(conflit.json).toEqual({ ok: false, reason: 'command_id_reused_with_other_content' });
  const apresConflit = await recorded(mf, orderId);
  expect(apresConflit.entries, `${path} other content writes nothing`).toEqual(apres.entries);
  expect(apresConflit.events.length, `${path} other content emits nothing`).toBe(apres.events.length);
  return { res, entries, events, before, after };
}

function expectServerDated(path: string, act: { entries: Json[]; events: Json[]; before: number; after: number }): void {
  for (const e of act.entries) {
    expect(within(e['at'], act.before, act.after), `${path}: ledger ${String(e['kind'])} at=${String(e['at'])} must be Séra's clock`).toBe(true);
  }
  for (const ev of act.events) {
    const serverTime = (ev['envelope'] as Json)['serverTime'];
    expect(within(serverTime, act.before, act.after), `${path}: ${String(ev['name'])} serverTime=${String(serverTime)} must be Séra's clock`).toBe(true);
  }
}

async function attendreLivree(world: LogisticsWorld, orderId: string): Promise<Json> {
  for (let i = 0; i < 80; i += 1) {
    const hit = world.livree.find((b) => b['orderId'] === orderId);
    if (hit !== undefined) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the course-closed wire never reached logistics — seen: ${JSON.stringify(world.livree)}`);
}

describe('a rider act is dated by Séra’s clock, whatever time the request carries', () => {
  it('check, seal, evidence and the buyer’s code: the ledger, the events, the founder’s read and the wire to logistics all carry the Worker’s instant; a resend is still the same act', async () => {
    const world: LogisticsWorld = { livree: [] };
    const mf = boot(freshDir('road'), world);
    const O = 'ord-heure-road';
    await opened(mf, O, 'PICKUP-H1', 'DROP-H1');

    const verify = await riderAct(mf, O, '/verification', {
      command_id: 'v-h1', presentedPickupCode: 'PICKUP-H1', checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-h1',
    }, { evidenceBundleId: 'ev-h1-autre' });
    expect(verify.res.json).toMatchObject({ ok: true, kind: 'accepted' });
    expectServerDated('/verification', verify);
    expect(verify.events.map((e) => e['name'])).toContain('pickup.verification_recorded.v1');

    const seal = await riderAct(mf, O, '/custody/begin', { command_id: 'b-h1', custodySealId: 'SEAL-H1', sealPhotoRefs: [] }, { custodySealId: 'SEAL-H1-AUTRE' });
    expect(seal.res.json).toMatchObject({ ok: true, status: 'custody_with_courier', riderId: RIDER });
    expectServerDated('/custody/begin', seal);
    expect(seal.events.map((e) => e['name'])).toContain('custody.transferred_to_courier.v1');

    const evidence = await riderAct(mf, O, '/delivery/evidence', {
      command_id: 'e-h1',
      bundle: { taskId: `task-${O}`, packageId: `pkg-${O}`, custodySealId: 'SEAL-H1', artifacts: [], capturedAt: T },
    }, { bundle: { taskId: `task-${O}`, packageId: `pkg-${O}`, custodySealId: 'SEAL-H1', artifacts: [], capturedAt: ALSO_PAST } });
    expect(evidence.res.json).toMatchObject({ ok: true, status: 'evidence_recorded' });
    expectServerDated('/delivery/evidence', evidence);
    expect(evidence.events.map((e) => e['name'])).toContain('delivery.evidence_submitted.v1');

    const drop = await riderAct(mf, O, '/delivery/drop', { command_id: 'd-h1', dropCode: 'DROP-H1' }, { dropCode: 'DROP-H1-AUTRE' });
    expect(drop.res.json).toMatchObject({ ok: true, status: 'custody_with_customer' });
    expectServerDated('/delivery/drop', drop);
    expect(drop.events.map((e) => e['name'])).toContain('delivery.validated.v1');

    // The drop's instant is what logistics is told the course closed at.
    const livree = await attendreLivree(world, O);
    expect(livree['command_id']).toBe('livree-d-h1');
    expect(within(livree['at'], drop.before, drop.after), `course-livrée at=${String(livree['at'])} must be Séra's clock`).toBe(true);

    // The founder's read of who did what, and when, says the same.
    const att = (await call(mf, 'GET', `/ops/attestations?orderId=${O}`, OPS)).json;
    const verifs = att['attestations'] as Json[];
    expect(verifs).toHaveLength(1);
    expect(within(verifs[0]!['at'], verify.before, verify.after), `attestation at=${String(verifs[0]!['at'])}`).toBe(true);
    const taken = att['custodyTaken'] as Json[];
    expect(taken).toHaveLength(1);
    expect(within(taken[0]!['at'], seal.before, seal.after), `custodyTaken at=${String(taken[0]!['at'])}`).toBe(true);
    const doorActs = att['doorActs'] as Json[];
    const evidenceRow = doorActs.find((r) => r['command_id'] === 'e-h1');
    const dropRow = doorActs.find((r) => r['command_id'] === 'd-h1');
    expect(within(evidenceRow?.['at'], evidence.before, evidence.after), `evidence row at=${String(evidenceRow?.['at'])}`).toBe(true);
    expect(within(dropRow?.['at'], drop.before, drop.after), `drop row at=${String(dropRow?.['at'])}`).toBe(true);
    expect(JSON.stringify(att)).not.toContain('2020-01-01');
    expect(JSON.stringify(att)).not.toContain('2021-06-01');
  }, 60_000);

  it('a door inspection is dated by Séra’s clock, so the retry window it opens runs from now and a rider’s expiry tap is refused', async () => {
    const world: LogisticsWorld = { livree: [] };
    const mf = boot(freshDir('door'), world);
    const O = 'ord-heure-door';
    await opened(mf, O, 'PICKUP-H2', 'DROP-H2');
    expect((await call(mf, 'POST', '/rider/verification', RIDER_CODE, {
      orderId: O, command_id: 'v-h2', presentedPickupCode: 'PICKUP-H2', checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-h2',
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/rider/custody/begin', RIDER_CODE, {
      orderId: O, command_id: 'b-h2', custodySealId: 'SEAL-H2', sealPhotoRefs: [],
    })).status).toBe(200);

    const inspection = await riderAct(mf, O, '/door/inspection', {
      command_id: 'i-h2', inspectionCategory: 'uncategorised_conservative',
      packageOpened: false, manufacturerSealOpened: false, custodySealIntact: true,
      buyerAccepts: false, refusalColumn: 'buyer_risk',
      startedAt: T, completedAt: T, evidenceBundleId: 'eb-door-h2',
    }, { evidenceBundleId: 'eb-door-h2-autre' });
    expect(inspection.res.json).toMatchObject({ ok: true, kind: 'invalid_rejection' });
    expectServerDated('/door/inspection', inspection);
    const windowExpiresAt = (((inspection.res.json['ladder'] as Json)['outcome'] as Json)['attempt'] as Json)['windowExpiresAt'];
    expect(
      within(windowExpiresAt, inspection.before + 15 * 60_000, inspection.after + 15 * 60_000),
      `windowExpiresAt=${String(windowExpiresAt)} must be Séra's now + 15 min`,
    ).toBe(true);

    // The window is judged against the same clock: not expired yet.
    const early = await call(mf, 'POST', '/rider/door/expire', RIDER_CODE, { orderId: O, command_id: 'x-h2' });
    expect(early.status, JSON.stringify(early.json)).toBe(409);
    expect(early.json).toMatchObject({ ok: false, reason: 'window_not_expired' });

    const att = (await call(mf, 'GET', `/ops/attestations?orderId=${O}`, OPS)).json;
    const row = (att['doorActs'] as Json[]).find((r) => r['command_id'] === 'i-h2');
    expect(within(row?.['at'], inspection.before, inspection.after), `inspection row at=${String(row?.['at'])}`).toBe(true);
  }, 60_000);

  it('the founder’s own door keeps the instant he attests', async () => {
    const world: LogisticsWorld = { livree: [] };
    const mf = boot(freshDir('ops'), world);
    const O = 'ord-heure-ops';
    await opened(mf, O, 'PICKUP-H3', 'DROP-H3');
    const before = (await recorded(mf, O)).entries.length;
    expect((await call(mf, 'POST', '/ops/verification', OPS, {
      orderId: O, command_id: 'v-h3', riderId: RIDER, presentedPickupCode: 'PICKUP-H3',
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-h3', at: T,
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/custody/begin', OPS, {
      orderId: O, command_id: 'b-h3', riderId: RIDER, custodySealId: 'SEAL-H3', sealPhotoRefs: [], at: T,
    })).status).toBe(200);
    const added = (await recorded(mf, O)).entries.slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.map((e) => e['at'])).toEqual(added.map(() => T));
  }, 60_000);
});
