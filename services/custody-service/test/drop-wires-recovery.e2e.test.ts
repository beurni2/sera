import { readdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deserialize } from 'node:v8';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { httpCustodyActs } from '../../../apps/rider-app/src/net/custody-acts';

/**
 * ═══ A FINISHED DELIVERY KEEPS ITS TWO OUTGOING MESSAGES ═══
 *
 * A successful drop owes two messages: the settlement-eligibility signal to
 * Shop+ (`delivery.validated.v1`, Execution Contract §2's money boundary) and
 * the course-closed confirmation to logistics. They live as two outbox rows
 * in the custody file. The contract asks for « replay support » (§4): when
 * the delivery is recorded but a row is missing — the state a lost second
 * write leaves — replaying the drop, or the rider re-typing the buyer's code,
 * must bring the row back, with the bytes the original drop would have
 * armed, so each receiver hears it once and can dedupe it.
 *
 * Driven on the REAL bundled custody Worker, persisted storage, through the
 * rider app's OWN custody port. The receivers are stubbed as
 * `code-bloque.e2e.test.ts` certifies them (Shop+'s progress door and
 * logistics' produce door, each behind its key). The missing row is made by
 * deleting it from the object's SQLite file between two runtimes, as
 * `custody-storage.e2e.test.ts` does; the outcome is asked of the storage
 * and of the receivers' inboxes, never of the answer.
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-ops-secret-wires-0000001';
const PRODUCE_KEY = 'test-produce-secret-wires-001';
const SHOP_ARM_KEY = 'test-shop-arm-secret-wires-01';
const SHOP_WIRE_KEY = 'test-progress-secret-wires-01';
const VERIFY_KEY = 'test-rider-verify-secret-wire';
const LIVREE_KEY = 'test-course-livree-secret-wir';
const TIMEOUT = 90_000;

const ELIGIBILITY_KEY = 'custody:eligibility-outbox:v1';
const LIVREE_ROW_KEY = 'custody:course-livree-outbox:v1';

const R1 = 'rider-wires-0001';
const R1_CODE = 'SR-WIRES-PERSONAL-0001';
const SUPPLIER = 'supplier-wires-1';
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const T = '2026-11-26T10:00:00.000Z';

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-wires-${tag}-`));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Json = Record<string, unknown>;
/** What each receiver was sent, as the raw bytes on the wire. */
interface Seen {
  shop: string[];
  logistics: { path: string; raw: string }[];
}

function shopStub(seen: Seen) {
  return async (request: Request): Promise<Response> => {
    if (request.headers.get('Authorization') !== `Bearer ${SHOP_WIRE_KEY}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    seen.shop.push(await request.text());
    return Response.json({ ok: true, status: 'recorded' });
  };
}

function logisticsStub(seen: Seen) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const auth = request.headers.get('Authorization') ?? '';
    if (path === '/verify/rider-code') {
      if (auth !== `Bearer ${VERIFY_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const code = String(((await request.json().catch(() => null)) as Json | null)?.['code'] ?? '');
      if (code === R1_CODE) return Response.json({ ok: true, riderId: R1 });
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (path.startsWith('/produce/')) {
      if (auth !== `Bearer ${LIVREE_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
      seen.logistics.push({ path, raw: await request.text() });
      return Response.json({ ok: true, status: 'recorded' });
    }
    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  };
}

/** `wired: false` leaves both receivers' keys unset: the rows rest
 *  `unsendable_no_config` with their exact content, and nothing is sent. */
function boot(dir: string, seen: Seen, wired: boolean): Miniflare {
  return new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: { LOGISTICS: logisticsStub(seen), SHOP_PROGRESS: shopStub(seen) },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: OPS,
      SERA_RIDER_VERIFY_SECRET: VERIFY_KEY,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
      ...(wired ? { SHOP_PROGRESS_SECRET: SHOP_WIRE_KEY, SERA_COURSE_LIVREE_SECRET: LIVREE_KEY } : {}),
    },
  });
}

async function call(mf: Miniflare, method: string, path: string, auth: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method,
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPort(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as unknown as typeof globalThis.fetch;
  return httpCustodyActs('http://custody', { current: () => 'online' as const }, fetchFn as never);
}
const id = (s: string) => s as never;

/** One order, opened and armed, verified, sealed and evidenced by R1: he
 *  holds the parcel at the buyer's door. */
async function atTheDoor(mf: Miniflare, orderId: string, dropCode: string): Promise<void> {
  expect((await call(mf, 'POST', '/produce/order/open', PRODUCE_KEY, {
    orderId, taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, correlationId: `corr-${orderId}`,
    supplierId: SUPPLIER, paymentMode: 'FULL_PREPAY',
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce/secrets/arm', PRODUCE_KEY, {
    orderId, command_id: `arm-p-${orderId}`, kind: 'pickup_verification_code', secret: `PICKUP-${orderId}`,
  })).status).toBe(200);
  expect((await call(mf, 'POST', '/produce-shop/secrets/arm', SHOP_ARM_KEY, {
    orderId, command_id: `arm-d-${orderId}`, kind: 'buyer_drop_code', secret: dropCode,
  })).status).toBe(200);
  const acts = appPort(mf);
  const seal = `SEAL-${orderId}`;
  expect((await acts.verifyPickup({
    commandId: id(`v-${orderId}`), orderId, presentedPickupCode: `PICKUP-${orderId}`,
    evidenceBundleId: `ev-${orderId}`, dwellSec: 150, checkResults: ALL_PASS,
  }, R1_CODE)).kind).toBe('recorded');
  expect((await acts.beginCustody({ commandId: id(`b-${orderId}`), orderId, custodySealId: seal, sealPhotoRefs: [] }, R1_CODE)).kind).toBe('recorded');
  expect(await acts.submitDeliveryEvidence({
    commandId: id(`e-${orderId}`), orderId, custodySealId: seal,
    taskId: `task-${orderId}`, packageId: `pkg-${orderId}`, artifacts: [], capturedAt: T,
  }, R1_CODE)).toMatchObject({ kind: 'recorded' });
}

const drop = (mf: Miniflare, orderId: string, commandId: string, code: string) =>
  appPort(mf).confirmDrop({ commandId: id(commandId), orderId, dropCode: code }, R1_CODE);

/** Every SQLite file of the object store (layout-independent, as the storage suite reads it). */
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

/** The stored outbox row under `key`, decoded — read while no runtime is up. */
function readRow(dir: string, key: string): Json | undefined {
  for (const file of sqliteFiles(dir)) {
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

/** Remove the row under `key` — the state a lost second write leaves. */
function deleteRow(dir: string, key: string): number {
  let removed = 0;
  for (const file of sqliteFiles(dir)) {
    const db = new DatabaseSync(file);
    try {
      const rows = db.prepare('select key from _cf_KV').all() as unknown as { key: Uint8Array }[];
      for (const row of rows) {
        if (Buffer.from(row.key).toString('latin1') !== key) continue;
        db.prepare('delete from _cf_KV where key = ?').run(row.key);
        removed += 1;
      }
    } finally {
      db.close();
    }
  }
  return removed;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

/**
 * A delivery recorded with its two rows resting unsent (receivers' keys
 * unset); returns the original rows exactly as the drop armed them.
 */
async function deliveredUnsent(tag: string, orderId: string, dropCode: string): Promise<{ dir: string; eligibility: Json; livree: Json }> {
  const dir = freshDir(tag);
  const quiet: Seen = { shop: [], logistics: [] };
  const mf = boot(dir, quiet, false);
  await atTheDoor(mf, orderId, dropCode);
  expect(await drop(mf, orderId, `drop-${orderId}`, dropCode)).toMatchObject({ kind: 'recorded', body: { status: 'custody_with_customer' } });
  await settle();
  await mf.dispose();
  expect(quiet.shop, 'nothing reached Shop+ without its key').toEqual([]);
  expect(quiet.logistics.filter((p) => p.path === '/produce/course-livree'), 'nothing reached logistics without its key').toEqual([]);
  const eligibility = readRow(dir, ELIGIBILITY_KEY);
  const livree = readRow(dir, LIVREE_ROW_KEY);
  expect(eligibility, 'the drop armed the eligibility row').toBeDefined();
  expect(livree, 'the drop armed the course-closed row').toBeDefined();
  expect((eligibility!['event'] as { name: string }).name).toBe('delivery.validated.v1');
  expect((livree!['body'] as Json)['command_id']).toBe(`livree-drop-${orderId}`);
  return { dir, eligibility: eligibility!, livree: livree! };
}

const LOST: { name: string; keys: string[] }[] = [
  { name: 'the eligibility row', keys: [ELIGIBILITY_KEY] },
  { name: 'the course-closed row', keys: [LIVREE_ROW_KEY] },
  { name: 'both rows', keys: [ELIGIBILITY_KEY, LIVREE_ROW_KEY] },
];

describe('a recorded delivery that lost its outgoing messages gets them back', () => {
  for (const lost of LOST) {
    it(`replaying the drop command, after ${lost.name} went missing, rebuilds what is missing with the original bytes, and each receiver hears it once`, async () => {
      const orderId = `ord-wires-replay-${lost.keys.length}-${lost.keys[0]!.includes('eligibility') ? 'e' : 'l'}`;
      const code = `DROP-${orderId}`;
      const original = await deliveredUnsent(`replay-${lost.keys.length}`, orderId, code);
      for (const key of lost.keys) expect(deleteRow(original.dir, key), `${key} was removed`).toBe(1);

      const seen: Seen = { shop: [], logistics: [] };
      const mf = boot(original.dir, seen, true);
      // The SAME command, re-sent through the rider app's port.
      expect(await drop(mf, orderId, `drop-${orderId}`, code)).toMatchObject({ kind: 'recorded', body: { status: 'custody_with_customer' } });
      await vi.waitFor(() => {
        expect(seen.shop).toHaveLength(1);
        expect(seen.logistics.filter((p) => p.path === '/produce/course-livree')).toHaveLength(1);
      }, { timeout: 10_000, interval: 50 });
      await settle();
      await mf.dispose();

      expect(seen.shop, 'Shop+ got the original signal, byte for byte, once').toEqual([JSON.stringify(original.eligibility['event'])]);
      expect(seen.logistics.filter((p) => p.path === '/produce/course-livree').map((p) => p.raw), 'logistics got the original confirmation, once')
        .toEqual([JSON.stringify(original.livree['body'])]);
      const eligibility = readRow(original.dir, ELIGIBILITY_KEY);
      const livree = readRow(original.dir, LIVREE_ROW_KEY);
      expect(eligibility?.['event'], 'the eligibility row exists again, with the original event').toEqual(original.eligibility['event']);
      expect(livree?.['body'], 'the course-closed row exists again, with the original body').toEqual(original.livree['body']);
      expect(eligibility?.['status']).toBe('delivered');
      expect(livree?.['status']).toBe('delivered');
    }, TIMEOUT);
  }

  it('re-typing the code under a fresh command, after both rows went missing, rebuilds them from the LOGGED drop — its id and its instant, not the re-type\'s', async () => {
    const orderId = 'ord-wires-retype';
    const code = `DROP-${orderId}`;
    const original = await deliveredUnsent('retype', orderId, code);
    expect(deleteRow(original.dir, ELIGIBILITY_KEY)).toBe(1);
    expect(deleteRow(original.dir, LIVREE_ROW_KEY)).toBe(1);

    const seen: Seen = { shop: [], logistics: [] };
    const mf = boot(original.dir, seen, true);
    await new Promise((resolve) => setTimeout(resolve, 20)); // the re-type's own instant is later
    expect(await drop(mf, orderId, `retype-${orderId}`, code)).toMatchObject({ kind: 'recorded', body: { status: 'deja_livree' } });
    await vi.waitFor(() => {
      expect(seen.shop).toHaveLength(1);
      expect(seen.logistics.filter((p) => p.path === '/produce/course-livree')).toHaveLength(1);
    }, { timeout: 10_000, interval: 50 });
    await settle();
    await mf.dispose();

    expect(seen.shop).toEqual([JSON.stringify(original.eligibility['event'])]);
    const sent = seen.logistics.filter((p) => p.path === '/produce/course-livree').map((p) => JSON.parse(p.raw) as Json);
    expect(sent, 'the logged drop\'s id and instant, never the re-type\'s').toEqual([original.livree['body']]);
    expect(sent[0]!['command_id']).toBe(`livree-drop-${orderId}`);
    expect(readRow(original.dir, ELIGIBILITY_KEY)?.['event']).toEqual(original.eligibility['event']);
    expect(readRow(original.dir, LIVREE_ROW_KEY)?.['body']).toEqual(original.livree['body']);
  }, TIMEOUT);

  const HALVES: { kept: 'shop' | 'logistics'; keptKey: string; lostKey: string }[] = [
    { kept: 'shop', keptKey: ELIGIBILITY_KEY, lostKey: LIVREE_ROW_KEY },
    { kept: 'logistics', keptKey: LIVREE_ROW_KEY, lostKey: ELIGIBILITY_KEY },
  ];
  for (const half of HALVES) {
    it(`a message already delivered is never sent again: with the ${half.kept} message delivered and the other missing, only the missing one is rebuilt, and the delivered row stays delivered`, async () => {
      const orderId = `ord-wires-half-${half.kept}`;
      const code = `DROP-${orderId}`;
      const dir = freshDir(`half-${half.kept}`);
      const first: Seen = { shop: [], logistics: [] };
      let mf = boot(dir, first, true);
      await atTheDoor(mf, orderId, code);
      expect(await drop(mf, orderId, `drop-${orderId}`, code)).toMatchObject({ kind: 'recorded', body: { status: 'custody_with_customer' } });
      await vi.waitFor(() => {
        expect(first.shop).toHaveLength(1);
        expect(first.logistics.filter((p) => p.path === '/produce/course-livree')).toHaveLength(1);
      }, { timeout: 10_000, interval: 50 });
      await settle();
      await mf.dispose();
      const deliveredRow = readRow(dir, half.keptKey);
      expect(deliveredRow?.['status']).toBe('delivered');
      expect(deleteRow(dir, half.lostKey)).toBe(1);

      const seen: Seen = { shop: [], logistics: [] };
      mf = boot(dir, seen, true);
      expect(await drop(mf, orderId, `drop-${orderId}`, code)).toMatchObject({ kind: 'recorded', body: { status: 'custody_with_customer' } });
      const livreeOf = (x: Seen) => x.logistics.filter((p) => p.path === '/produce/course-livree').map((p) => p.raw);
      await vi.waitFor(() => {
        expect(half.kept === 'shop' ? livreeOf(seen) : seen.shop).toHaveLength(1);
      }, { timeout: 10_000, interval: 50 });
      await settle();
      await mf.dispose();

      if (half.kept === 'shop') {
        expect(seen.shop, 'the delivered signal is not sent again').toEqual([]);
        expect(livreeOf(seen), 'the missing confirmation, with the bytes logistics first heard').toEqual(livreeOf(first));
      } else {
        expect(livreeOf(seen), 'the delivered confirmation is not sent again').toEqual([]);
        expect(seen.shop, 'the missing signal, with the bytes Shop+ first heard').toEqual(first.shop);
      }
      expect(readRow(dir, half.keptKey), 'the delivered row is untouched').toEqual(deliveredRow);
      expect(readRow(dir, half.lostKey)?.['status']).toBe('delivered');
    }, TIMEOUT);
  }

  it('a fresh drop arms both message rows with the content each receiver is owed', async () => {
    const orderId = 'ord-wires-fresh';
    const code = `DROP-${orderId}`;
    const original = await deliveredUnsent('fresh', orderId, code);
    expect(original.eligibility).toMatchObject({ attempts: 0 });
    expect(original.livree).toMatchObject({ attempts: 0, body: { orderId, command_id: `livree-drop-${orderId}` } });
    expect(typeof (original.livree['body'] as Json)['at']).toBe('string');
    // The delivery itself is on disk beside them: its log row is the LAST
    // command, and the head counts it.
    const head = readRow(original.dir, 'custody:ledger-head:v1');
    const logLength = head?.['logLength'] as number;
    const last = readRow(original.dir, `custody:cmd:${String(logLength - 1).padStart(12, '0')}`);
    expect((last?.['cmd'] as Json | undefined)?.['command_id'], 'the drop is the head\'s last command').toBe(`drop-${orderId}`);
    expect((last?.['outcome'] as Json | undefined)?.['body']).toEqual({ ok: true, status: 'custody_with_customer' });
    expect((original.livree['body'] as Json)['at'], 'the row carries the logged drop\'s own instant').toBe((last?.['cmd'] as Json)['at']);
  }, TIMEOUT);
});
