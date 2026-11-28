import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deserialize } from 'node:v8';
import { PlatformEventSchema } from '@platform/contracts';
import { Miniflare } from 'miniflare';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { fenetrePreuveMs } from '../worker/custody-do.js';

/**
 * ═══ THE DETECTORS' WIRE KEEPS THE HOUSE RULES, AND NEVER SLOWS ANOTHER WIRE ═══
 *
 * The custody file raises two problems to the founder's read on logistics —
 * a file that cannot vouch for its own history (`impossible_custody`) and
 * evidence left with no decision past its window
 * (`evidence_not_validated_aging`) — on one more outbox row sent over the
 * `/produce/` door. The seam itself (custody and logistics both real) is
 * proven in logistics' `alertes.e2e.test.ts`; this file holds the custody
 * Worker to the wire's terms with logistics stood in, answering exactly
 * what its `/produce/alerte` route answers (200 for a readable alert, a
 * repeat included; 400 for one it cannot read) or, here, an outage:
 *
 *   · a refused send is never marked delivered: the row stays pending, its
 *     attempts count its own sends, and the retry waits the same backoff
 *     every wire has;
 *   · an alert retrying beside an existing wire never pushes that wire's
 *     next attempt later — each row counts only its own sends, and the
 *     alarm is never later than the existing wire's own backoff;
 *   · while the alarm holds only a detector's wake, a recovery act still
 *     arms its wire at once.
 *
 * The time the alarm is set for is read from the object store after the
 * Worker stops (`metadata.sqlite`, `_cf_ALARM.scheduled_time`, nanoseconds).
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-ops-detecteurs-0001';
const LIVREE_KEY = 'test-livree-detecteurs-0001';
const SHOP_KEY = 'test-shop-progress-detecteurs';
const SUPPLIER = 'supplier-detecteurs-1';
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const SLACK_MS = 2_000;
/** Every wire's first retry: `min(30 s · 2^attempts, 1 h)` after one failed send. */
const FIRST_BACKOFF_MS = 60_000;

const ALERTE_GARDE_KEY = 'custody:alerte-garde-outbox:v1';
const ALERTE_PREUVE_KEY = 'custody:alerte-preuve-outbox:v1';
const COURSE_LIVREE_OUTBOX_KEY = 'custody:course-livree-outbox:v1';
const TRANSIT_OUTBOX_KEY = 'custody:transit-outbox:v1';

type Json = Record<string, unknown>;

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-detecteurs-${tag}-`));
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

interface Hit {
  path: string;
  at: number;
  body: Json;
}

/** Logistics' `/produce/` door as the custody Worker meets it: the key, then the route's answer — or an outage. */
interface World {
  hits: Hit[];
  alerte: 'accept' | 'outage';
  livree: 'accept' | 'outage';
  shop: Hit[];
  /** How many departure messages Shop+ refuses (503) before it accepts. */
  shopRefusEnRoute: number;
}

function logisticsStandIn(world: World) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (request.headers.get('Authorization') !== `Bearer ${LIVREE_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const body = (await request.json().catch(() => null)) as Json | null;
    if (path === '/produce/alerte') {
      world.hits.push({ path, at: Date.now(), body: body ?? {} });
      if (world.alerte === 'outage') return new Response('unavailable', { status: 503 });
      if (body === null || !PlatformEventSchema.safeParse(body).success) return Response.json({ ok: false, reason: 'malformed' }, { status: 400 });
      const repeat = world.hits.filter((h) => h.path === path && JSON.stringify(h.body) === JSON.stringify(body)).length > 1;
      return Response.json({ ok: true, duplicate: repeat });
    }
    if (path === '/produce/course-livree') {
      world.hits.push({ path, at: Date.now(), body: body ?? {} });
      if (world.livree === 'outage') return new Response('unavailable', { status: 503 });
      return Response.json({ ok: true, status: 'livree' });
    }
    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  };
}

function shopStandIn(world: World) {
  return async (request: Request): Promise<Response> => {
    const hit: Hit = { path: new URL(request.url).pathname, at: Date.now(), body: (await request.json().catch(() => ({}))) as Json };
    world.shop.push(hit);
    if (hit.body['stage'] === 'en_route' && world.shopRefusEnRoute > 0) {
      world.shopRefusEnRoute -= 1;
      return new Response('unavailable', { status: 503 });
    }
    return Response.json({ ok: true });
  };
}

function boot(dir: string, world: World, extra: { bindings?: Record<string, string>; shop?: boolean } = {}): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: {
      LOGISTICS: logisticsStandIn(world),
      ...(extra.shop === true ? { SHOP_PROGRESS: shopStandIn(world) } : {}),
    },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: OPS,
      SERA_COURSE_LIVREE_SECRET: LIVREE_KEY,
      ...(extra.shop === true ? { SHOP_PROGRESS_SECRET: SHOP_KEY } : {}),
      ...extra.bindings,
    },
  });
  live.push(mf);
  return mf;
}

async function stop(mf: Miniflare): Promise<void> {
  live.splice(live.indexOf(mf), 1);
  await mf.dispose();
}

async function ops(mf: Miniflare, path: string, body?: unknown): Promise<{ status: number; text: string; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { json = {}; }
  return { status: res.status, text, json };
}

/** Opened, both codes armed, checked and sealed on the founder's door. */
async function sealed(mf: Miniflare, O: string, riderId = 'rider-AAAA-0001'): Promise<void> {
  expect((await ops(mf, '/ops/order/open', { orderId: O, taskId: `task-${O}`, packageId: `pkg-${O}`, correlationId: `corr-${O}`, supplierId: SUPPLIER })).status).toBe(200);
  expect((await ops(mf, '/ops/secrets/arm', { orderId: O, command_id: `arm-p-${O}`, kind: 'pickup_verification_code', secret: `PICK-${O}` })).status).toBe(200);
  expect((await ops(mf, '/ops/secrets/arm', { orderId: O, command_id: `arm-d-${O}`, kind: 'buyer_drop_code', secret: `DROP-${O}` })).status).toBe(200);
  const v = await ops(mf, '/ops/verification', {
    orderId: O, command_id: `v-${O}`, riderId, presentedPickupCode: `PICK-${O}`, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${O}`,
  });
  expect(v.status, v.text).toBe(200);
  const b = await ops(mf, '/ops/custody/begin', { orderId: O, command_id: `b-${O}`, riderId, custodySealId: `SEAL-${O}`, sealPhotoRefs: [] });
  expect(b.status, b.text).toBe(200);
}

/** Evidence recorded with no decision: a decision id already on record leaves it undecided. */
async function evidenceUndecided(mf: Miniflare, O: string): Promise<number> {
  expect((await ops(mf, '/ops/delivery/decide', { orderId: O, command_id: `auto-decide-e-${O}` })).json).toMatchObject({ ok: false, reason: 'validation_before_evidence' });
  const at = Date.now();
  const ev = await ops(mf, '/ops/delivery/evidence', {
    orderId: O, command_id: `e-${O}`,
    bundle: { taskId: `task-${O}`, packageId: `pkg-${O}`, custodySealId: `SEAL-${O}`, artifacts: [], capturedAt: new Date().toISOString() },
  });
  expect(ev.json).toMatchObject({ ok: true, status: 'evidence_recorded' });
  const entries = (await ops(mf, `/ops/ledger?orderId=${O}`)).json['entries'] as Json[];
  expect(entries.filter((e) => e['kind'] === 'validation_decision'), 'no decision on record').toEqual([]);
  return at;
}

async function waitFor(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${what} never happened`);
}

const hitsOf = (world: World, path: string): Hit[] => world.hits.filter((h) => h.path === path);

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

/** The stored row under `key`, decoded — read while no runtime is up. */
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

/** When the order's custody object will next wake, in ms — null when nothing is scheduled. */
function alarmOf(dir: string, orderId: string): number | null {
  for (const file of filesUnder(dir).filter((f) => f.endsWith('metadata.sqlite') && f.includes('CustodyDO'))) {
    const db = new DatabaseSync(file);
    try {
      const st = db.prepare('select actor_name, scheduled_time from _cf_ALARM');
      st.setReadBigInts(true);
      for (const row of st.all() as unknown as { actor_name: string; scheduled_time: bigint }[]) {
        if (row.actor_name === orderId) return Number(row.scheduled_time / 1_000_000n);
      }
    } finally {
      db.close();
    }
  }
  return null;
}

/** Rewrite stored command bytes, same length — the damage `custody-storage.e2e` inflicts. */
function forgeInStoredCommands(dir: string, from: string, to: string): number {
  if (from.length !== to.length) throw new Error('a forgery must not change length');
  let forged = 0;
  for (const file of filesUnder(dir).filter((f) => f.endsWith('.sqlite') && !f.includes('metadata'))) {
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

const world = (over: Partial<World> = {}): World => ({ hits: [], alerte: 'accept', livree: 'accept', shop: [], shopRefusEnRoute: 0, ...over });

describe('the detectors’ wire keeps the house rules', () => {
  it('a damaged file answers as before; its one alert is a canonical reconciliation alert; a refused send stays pending, counts its own attempt, and waits the same backoff', async () => {
    const w = world({ alerte: 'outage' });
    const dir = freshDir('garde');
    const O = 'ord-detect-garde';
    let mf = boot(dir, w);
    await sealed(mf, O);
    await stop(mf);
    expect(forgeInStoredCommands(dir, 'rider-AAAA-0001', 'rider-BBBB-0001')).toBeGreaterThan(0);
    mf = boot(dir, w);

    const first = Date.now();
    const answers = async () => [
      (await ops(mf, `/ops/ledger?orderId=${O}`)).text,
      (await ops(mf, `/ops/ledger/verify?orderId=${O}`)).text,
      (await ops(mf, '/ops/transit/depart', { orderId: O, command_id: `dep-${O}` })).text,
    ];
    const expected = [
      '{"ok":false,"reason":"command_log_tampered"}',
      '{"ok":false,"valid":true,"headMatches":false,"reason":"command_log_tampered"}',
      '{"ok":false,"reason":"command_log_tampered"}',
    ];
    expect(await answers(), 'every answer is the one it gives today').toEqual(expected);
    const last = Date.now();

    await waitFor('the alert send', () => hitsOf(w, '/produce/alerte').length === 1);
    const sent = hitsOf(w, '/produce/alerte')[0]!;
    const event = PlatformEventSchema.parse(sent.body);
    expect(event.name).toBe('reconciliation.alert.v1');
    expect(event.envelope.command_id).toBe(`alerte-impossible_custody-${O}`);
    const serverTime = Date.parse(event.envelope.serverTime);
    expect(serverTime >= first - SLACK_MS && serverTime <= last + SLACK_MS, `serverTime=${event.envelope.serverTime} is custody's clock`).toBe(true);
    expect(event.payload).toEqual({ scenario: 'impossible_custody', order_id: O, package_id: `pkg-${O}`, task_id: `task-${O}`, detail: 'command_log_tampered' });

    // The same cause again: the same answers, and no second alert.
    expect(await answers()).toEqual(expected);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(hitsOf(w, '/produce/alerte'), 'one send for one cause while the first waits its retry').toHaveLength(1);
    await stop(mf);

    const row = readRow(dir, ALERTE_GARDE_KEY);
    expect(row, 'the refused alert is kept').toBeDefined();
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row!['body'], 'the row holds exactly what was sent').toEqual(sent.body);
    const alarm = alarmOf(dir, O);
    expect(alarm, 'the retry is scheduled').not.toBeNull();
    expect(Math.abs(alarm! - (sent.at + FIRST_BACKOFF_MS)), `retry at +${alarm! - sent.at} ms, every wire's first backoff`).toBeLessThan(SLACK_MS);
  }, 60_000);
});

describe('an alert beside an existing wire never slows it', () => {
  it('with no detector row, an existing wire retries exactly on its own backoff (today’s schedule)', async () => {
    const w = world({ livree: 'outage' });
    const dir = freshDir('base');
    const O = 'ord-detect-base';
    const mf = boot(dir, w);
    await sealed(mf, O);
    expect((await ops(mf, '/ops/delivery/evidence', {
      orderId: O, command_id: `e-${O}`,
      bundle: { taskId: `task-${O}`, packageId: `pkg-${O}`, custodySealId: `SEAL-${O}`, artifacts: [], capturedAt: new Date().toISOString() },
    })).json).toMatchObject({ ok: true, status: 'evidence_recorded' });
    expect((await ops(mf, '/ops/delivery/drop', { orderId: O, command_id: `drop-${O}`, dropCode: `DROP-${O}` })).json).toMatchObject({ ok: true, status: 'custody_with_customer' });
    await waitFor('the course-closed send', () => hitsOf(w, '/produce/course-livree').length === 1);
    await new Promise((r) => setTimeout(r, 500));
    await stop(mf);

    const sent = hitsOf(w, '/produce/course-livree')[0]!;
    expect(readRow(dir, COURSE_LIVREE_OUTBOX_KEY)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(readRow(dir, ALERTE_PREUVE_KEY), 'decided evidence leaves no alert').toBeUndefined();
    const alarm = alarmOf(dir, O);
    expect(alarm).not.toBeNull();
    expect(Math.abs(alarm! - (sent.at + FIRST_BACKOFF_MS)), `retry at +${alarm! - sent.at} ms`).toBeLessThan(SLACK_MS);
  }, 60_000);

  it('an alert with more failed sends than the course-closed wire: each row counts its own sends, and the alarm is the existing wire’s own backoff', async () => {
    const w = world({ alerte: 'outage', livree: 'outage' });
    const dir = freshDir('cote');
    const O = 'ord-detect-cote';
    const mf = boot(dir, w, { bindings: { EVIDENCE_AGING_MS: '1000' } });
    await sealed(mf, O);
    await evidenceUndecided(mf, O);
    await waitFor('the first alert send', () => hitsOf(w, '/produce/alerte').length === 1);

    // The founder decides, the buyer's code lands: the course-closed wire arms beside the waiting alert.
    expect((await ops(mf, '/ops/delivery/decide', { orderId: O, command_id: `dec-${O}` })).json).toMatchObject({ ok: true, result: 'validated' });
    expect((await ops(mf, '/ops/delivery/drop', { orderId: O, command_id: `drop-${O}`, dropCode: `DROP-${O}` })).json).toMatchObject({ ok: true, status: 'custody_with_customer' });
    await waitFor('the course-closed send and the alert retry', () => hitsOf(w, '/produce/course-livree').length === 1 && hitsOf(w, '/produce/alerte').length === 2);
    await new Promise((r) => setTimeout(r, 500));
    await stop(mf);

    expect(hitsOf(w, '/produce/course-livree')).toHaveLength(1);
    expect(hitsOf(w, '/produce/alerte')).toHaveLength(2);
    expect(readRow(dir, COURSE_LIVREE_OUTBOX_KEY), 'the course-closed row counts its own one send').toMatchObject({ status: 'pending', attempts: 1 });
    expect(readRow(dir, ALERTE_PREUVE_KEY), 'the alert row counts its own two sends').toMatchObject({ status: 'pending', attempts: 2 });
    const wake = hitsOf(w, '/produce/course-livree')[0]!.at;
    const alarm = alarmOf(dir, O);
    expect(alarm).not.toBeNull();
    expect(alarm! - wake, `next wake at +${alarm! - wake} ms: never later than the course-closed wire's own backoff`).toBeLessThanOrEqual(FIRST_BACKOFF_MS + SLACK_MS);
    expect(alarm! - wake).toBeGreaterThanOrEqual(FIRST_BACKOFF_MS - SLACK_MS);
  }, 60_000);

  it('while the alarm holds only a detector’s wake, a recovery act still arms its wire at once', async () => {
    const w = world();
    const dir = freshDir('reveil');
    const O = 'ord-detect-reveil';
    // No Shop+ key yet: the departure's message rests, honestly unsendable.
    let mf = boot(dir, w, { bindings: { EVIDENCE_AGING_MS: '20000' } });
    await sealed(mf, O);
    expect((await ops(mf, '/ops/transit/depart', { orderId: O, command_id: `dep-${O}` })).json).toMatchObject({ ok: true, status: 'departed' });
    await new Promise((r) => setTimeout(r, 800));
    const evidenceAt = await evidenceUndecided(mf, O);
    await stop(mf);

    expect((readRow(dir, TRANSIT_OUTBOX_KEY) as Json)['en_route']).toMatchObject({ status: 'unsendable_no_config' });
    const alarm = alarmOf(dir, O);
    expect(alarm, 'the slot holds the proof’s wake').not.toBeNull();
    expect(Math.abs(alarm! - (evidenceAt + 20_000)), `wake at +${alarm! - evidenceAt} ms after the evidence`).toBeLessThan(SLACK_MS);

    // The founder sets the Shop+ key; the rider's departure is re-tapped: its message goes now, not at the proof's wake.
    mf = boot(dir, w, { bindings: { EVIDENCE_AGING_MS: '20000' }, shop: true });
    const retap = Date.now();
    expect((await ops(mf, '/ops/transit/depart', { orderId: O, command_id: `dep2-${O}` })).json).toMatchObject({ ok: true, status: 'deja' });
    await waitFor('the departure message', () => w.shop.some((h) => h.body['stage'] === 'en_route'), 5_000);
    expect(w.shop.find((h) => h.body['stage'] === 'en_route')!.at - retap).toBeLessThan(5_000);
  }, 60_000);

  it('a decision that closes the proof’s watch leaves a waiting wire its wake', async () => {
    const w = world({ shopRefusEnRoute: 1 });
    const dir = freshDir('fermeture');
    const O = 'ord-detect-fermeture';
    const mf = boot(dir, w, { bindings: { EVIDENCE_AGING_MS: '20000' }, shop: true });
    await sealed(mf, O);
    await new Promise((r) => setTimeout(r, 800));
    const evidenceAt = await evidenceUndecided(mf, O);
    const enRoute = () => w.shop.filter((h) => h.body['stage'] === 'en_route');

    // Shop+ refuses the departure's message once. Its own retry would come a
    // minute later, so the alarm keeps the proof's earlier wake for both.
    expect((await ops(mf, '/ops/transit/depart', { orderId: O, command_id: `dep-${O}` })).json).toMatchObject({ ok: true, status: 'departed' });
    await waitFor('the refused departure message', () => enRoute().length === 1);
    await new Promise((r) => setTimeout(r, 500));

    // The founder validates inside the window: the watch closes, and the
    // message still waiting is sent again.
    expect((await ops(mf, '/ops/delivery/decide', { orderId: O, command_id: `dec-${O}` })).json).toMatchObject({ ok: true, result: 'validated' });
    expect(Date.now() - evidenceAt, 'decided inside the window').toBeLessThan(20_000);
    await waitFor('the refused departure message sent again', () => enRoute().length === 2, 30_000);
    await new Promise((r) => setTimeout(r, 500));
    await stop(mf);
    expect((readRow(dir, TRANSIT_OUTBOX_KEY) as Json)['en_route']).toMatchObject({ status: 'delivered', attempts: 2 });
    expect(readRow(dir, ALERTE_PREUVE_KEY), 'decided evidence leaves no alert').toBeUndefined();
  }, 60_000);
});

describe('the proof window can shrink for a test and never loosen', () => {
  it('above 30 minutes is 30 minutes; below is kept; missing or unreadable is 30 minutes', () => {
    const POLICY = 30 * 60_000;
    expect(fenetrePreuveMs(String(POLICY + 1))).toBe(POLICY);
    expect(fenetrePreuveMs('3600000')).toBe(POLICY);
    expect(fenetrePreuveMs(String(POLICY))).toBe(POLICY);
    expect(fenetrePreuveMs(String(POLICY - 1))).toBe(POLICY - 1);
    expect(fenetrePreuveMs('1500')).toBe(1500);
    expect(fenetrePreuveMs(undefined)).toBe(POLICY);
    expect(fenetrePreuveMs('')).toBe(POLICY);
    expect(fenetrePreuveMs('trente')).toBe(POLICY);
    expect(fenetrePreuveMs('0')).toBe(POLICY);
    expect(fenetrePreuveMs('-1500')).toBe(POLICY);
    expect(fenetrePreuveMs('1500.5')).toBe(POLICY);
  });
});
