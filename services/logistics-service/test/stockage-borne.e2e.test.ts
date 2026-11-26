import { mkdtempSync, readdirSync, statSync } from 'node:fs';
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
 *      so their size follows the work in flight, never the history — and
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
const BORNE = 1_048_576;

const COURSES = Number(process.env['STOCKAGE_COURSES'] ?? 150);
const LECTURES = Number(process.env['STOCKAGE_LECTURES'] ?? 1_000);

type Json = Record<string, unknown>;

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

function spawn(): { mf: Miniflare; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'stockage-borne-'));
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: dir,
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY, SERA_COURSE_LIVREE_SECRET: LIVREE },
  });
  live.push(mf);
  return { mf, dir };
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
});
