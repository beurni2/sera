import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';

/**
 * RETIRER-COURSIER — the founder removes a rider from the roster.
 *
 * Founder, 2026-08-12: « add a way to remove riders as well on coursiers. »
 * The desk could already REVOKE a code — lock a rider out, keep the row. This
 * is the second act, and it is the destructive one, so it is driven against
 * the REAL Worker rather than asserted from a fake.
 *
 * THE ONE THAT MATTERS is the custody refusal: a rider CARRYING a parcel must
 * not be removable, or the parcel is left with a custodian who does not exist
 * and dispatch cannot reassign it (`ridersCarrying()` is the same set the
 * assign path consults). Law 3, « one current custodian ».
 */

const OPS = 'test-ops-retirer-coursier';
const INTAKE = 'test-intake-retirer-coursier';
const VERIFY = 'test-verify-retirer-coursier';
let live: Miniflare[] = [];

afterEach(async () => {
  for (const mf of live) await mf.dispose();
  live = [];
});

function spawn(): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'retirer-coursier-')),
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY },
  });
  live.push(mf);
  return mf;
}

type Json = Record<string, unknown>;

async function opsRaw(mf: Miniflare, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
}
const ops = async (mf: Miniflare, p: string, b?: unknown): Promise<Json> => (await opsRaw(mf, p, b)).json;

async function intake(mf: Miniflare, path: string, body: unknown): Promise<void> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, path).toBe(200);
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return {
    acts: httpShiftActs('http://logistics', net, fetchFn),
    session: httpRiderSession('http://logistics', net, fetchFn),
  };
}

const T = '2026-08-12T09:00:00.000Z';
const LOC = { zone: 'Zogona', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-08-12T16:00:00.000Z' };

async function coursier(mf: Miniflare, riderId: string): Promise<string> {
  await ops(mf, '/ops/riders', { riderId, displayName: riderId, phoneAlias: `alias-${riderId}` });
  await ops(mf, '/ops/riders/certify', { riderId, certified: true });
  const code = (await ops(mf, '/ops/rider-code/mint', { riderId }))['code'] as string;
  const { acts } = appPorts(mf);
  await acts.ackPrivacy(code);
  if (!(await acts.startShift(code)).ok) throw new Error('setup: start shift refused');
  return code;
}

async function composer(mf: Miniflare, orderId: string, prefix: string): Promise<string> {
  await intake(mf, '/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
  await intake(mf, '/intake/readiness', { orderId, ready: true, asOf: T, supplierRef: `supplier-${prefix}` });
  const composed = await ops(mf, '/ops/task', { command_id: `${prefix}-t`, orderId, location: LOC, window: WIN });
  expect(composed['ok'], JSON.stringify(composed)).toBe(true);
  return composed['taskId'] as string;
}

const rosterIds = (body: Json): string[] =>
  (body['riders'] as Json[]).map((r) => r['riderId'] as string);

describe('RETIRER-COURSIER — the founder removes a rider, and custody refuses when it must', () => {
  it('a FREE rider is removed: off the roster, code dead, and the removal survives a restart', async () => {
    const mf = spawn();
    const code = await coursier(mf, 'rider-libre');
    expect(rosterIds(await ops(mf, '/ops/riders'))).toContain('rider-libre');

    const gone = await opsRaw(mf, '/ops/riders/remove', { riderId: 'rider-libre' });
    expect(gone.status, JSON.stringify(gone.json)).toBe(200);
    expect(gone.json['status']).toBe('removed');
    expect(gone.json['codeRevoked'], 'the rider held a code — it must die with the row').toBe(true);

    expect(rosterIds(await ops(mf, '/ops/riders'))).not.toContain('rider-libre');

    // ⚠ THE CODE IS A CREDENTIAL. It authenticates by HASH, so a code that
    // outlived its rider would keep opening the app for nobody. Asked of the
    // rider's OWN port, not of the ops list.
    const { session } = appPorts(mf);
    const after = await session.signIn(code);
    expect(after.ok, 'a removed rider’s code still signs them in').toBe(false);
  });

  it('⚠ a CARRYING rider is REFUSED by name — the parcel keeps a custodian', async () => {
    const mf = spawn();
    await coursier(mf, 'rider-porteur');
    const taskId = await composer(mf, 'ord-porteur', 'po');
    const granted = await ops(mf, '/ops/assign', { command_id: 'po-assign', taskId, riderId: 'rider-porteur' });
    expect(granted['ok'], JSON.stringify(granted)).toBe(true);

    const refused = await opsRaw(mf, '/ops/riders/remove', { riderId: 'rider-porteur' });
    expect(refused.status).toBe(409);
    expect(refused.json['reason'], 'a carrying rider must refuse BY NAME, never generically').toBe('rider_carrying');

    // …and NOTHING moved: he is still on the roster, still the custodian.
    expect(rosterIds(await ops(mf, '/ops/riders'))).toContain('rider-porteur');
  });

  it('an UNKNOWN rider is 404 — never a phantom removal', async () => {
    const mf = spawn();
    const nobody = await opsRaw(mf, '/ops/riders/remove', { riderId: 'rider-fantome' });
    expect(nobody.status).toBe(404);
    expect(nobody.json['reason']).toBe('unknown_rider');
  });

  it('a rider with NO code removes cleanly and says so — codeRevoked is honest', async () => {
    const mf = spawn();
    await ops(mf, '/ops/riders', { riderId: 'rider-sans-code', displayName: 'Sans', phoneAlias: 'alias-sc' });
    const gone = await opsRaw(mf, '/ops/riders/remove', { riderId: 'rider-sans-code' });
    expect(gone.status).toBe(200);
    expect(gone.json['codeRevoked'], 'there was no code — saying one was revoked would be a small lie').toBe(false);
  });

  it('the removal is DURABLE — it survives a restart of the object', async () => {
    const mf = spawn();
    await coursier(mf, 'rider-durable');
    await opsRaw(mf, '/ops/riders/remove', { riderId: 'rider-durable' });
    // The persist happens in the fetch wrapper for every non-GET; this is the
    // assertion that it actually ran for THIS route.
    const again = await ops(mf, '/ops/riders');
    expect(rosterIds(again)).not.toContain('rider-durable');
    const secondAsk = await opsRaw(mf, '/ops/riders/remove', { riderId: 'rider-durable' });
    expect(secondAsk.status, 'a second removal must be an honest 404, not a phantom success').toBe(404);
  });

  it('the door is OPS-KEYED — an unkeyed or wrongly-keyed removal never lands', async () => {
    const mf = spawn();
    await coursier(mf, 'rider-garde');
    for (const headers of [
      { 'Content-Type': 'application/json' },
      { Authorization: 'Bearer pas-la-bonne', 'Content-Type': 'application/json' },
    ]) {
      const res = await mf.dispatchFetch('http://logistics/ops/riders/remove', {
        method: 'POST',
        headers,
        body: JSON.stringify({ riderId: 'rider-garde' }),
      });
      expect(res.status, 'a destructive roster act answered without the ops key').toBe(401);
    }
    expect(rosterIds(await ops(mf, '/ops/riders'))).toContain('rider-garde');
  });
});
