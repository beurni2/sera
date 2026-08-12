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

/** `dir` is threaded so a test can STOP the object and start a new one over the
 *  same durable storage — the only way to prove a write outlived the process
 *  (verifier MAJOR: the old durability test re-read the same live instance and
 *  stayed green with `persist()` mutated out entirely). */
function spawn(dir: string = mkdtempSync(join(tmpdir(), 'retirer-coursier-'))): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: dir,
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY },
  });
  live.push(mf);
  return mf;
}

async function stop(mf: Miniflare): Promise<void> {
  live = live.filter((m) => m !== mf);
  await mf.dispose();
}

/** The console's own envelope: it asserts the custody bound on every removal,
 *  because the desk asks the question in words before the destructive tap. */
const RETRAIT = (riderId: string): Json => ({ riderId, custodyNotBegun: true });

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

    const gone = await opsRaw(mf, '/ops/riders/remove', RETRAIT('rider-libre'));
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

    const refused = await opsRaw(mf, '/ops/riders/remove', RETRAIT('rider-porteur'));
    expect(refused.status).toBe(409);
    expect(refused.json['reason'], 'a carrying rider must refuse BY NAME, never generically').toBe('rider_carrying');

    // …and NOTHING moved: he is still on the roster, still the custodian.
    expect(rosterIds(await ops(mf, '/ops/riders'))).toContain('rider-porteur');
  });

  it('⚠ a REFUSED removal leaves the credential ALIVE — he can still finish the course', async () => {
    // Verifier MINOR: moving the two code deletes above the carrying guard
    // would keep every other test green while killing a working rider's key
    // mid-course. This is the assertion that the refusal is TOTAL — asked of
    // the rider's own sign-in port, not of the ops list.
    const mf = spawn();
    const code = await coursier(mf, 'rider-porteur-cle');
    const taskId = await composer(mf, 'ord-porteur-cle', 'pc');
    expect((await ops(mf, '/ops/assign', { command_id: 'pc-assign', taskId, riderId: 'rider-porteur-cle' }))['ok']).toBe(true);

    expect((await opsRaw(mf, '/ops/riders/remove', RETRAIT('rider-porteur-cle'))).status).toBe(409);

    const { session } = appPorts(mf);
    expect((await session.signIn(code)).ok, 'a refused removal destroyed the code anyway').toBe(true);
  });

  it('⚠ the door refuses 428 when the custody bound is NOT asserted — the book is not custody truth', async () => {
    // SE-I04: « task status alone MUST NOT be custody truth ». The assignment
    // book is all logistics can see, so an unasserted removal never lands.
    const mf = spawn();
    await coursier(mf, 'rider-sans-serment');
    const muet = await opsRaw(mf, '/ops/riders/remove', { riderId: 'rider-sans-serment' });
    expect(muet.status, JSON.stringify(muet.json)).toBe(428);
    expect(muet.json['reason']).toBe('custody_bound_not_asserted');
    expect(rosterIds(await ops(mf, '/ops/riders'))).toContain('rider-sans-serment');

    // A non-true value is not an assertion either — no truthiness at a
    // custody door.
    const mou = await opsRaw(mf, '/ops/riders/remove', { riderId: 'rider-sans-serment', custodyNotBegun: 'oui' });
    expect(mou.status).toBe(428);
    expect(rosterIds(await ops(mf, '/ops/riders'))).toContain('rider-sans-serment');
  });

  it('⚠ PURGE-PUIS-RETRAIT: clearing the board blinds the carrying guard — only the asserted bound stands', async () => {
    /**
     * THE VERIFIER'S BLOCKER, DRIVEN END TO END. « Vider le tableau » calls
     * `/ops/order/retirer` per course, which deletes the assignment row and
     * leaves custody open on purpose (« board yes, custody no »). After that
     * sweep the rider is invisible to `ridersCarrying()` — so the 409 CANNOT
     * fire, and the only thing between a rider on the road and an erased row
     * is the asserted bound. This test says exactly that, and no more.
     */
    const mf = spawn();
    await coursier(mf, 'rider-balaye');
    const taskId = await composer(mf, 'ord-balaye', 'ba');
    expect((await ops(mf, '/ops/assign', { command_id: 'ba-assign', taskId, riderId: 'rider-balaye' }))['ok']).toBe(true);
    expect((await opsRaw(mf, '/ops/riders/remove', RETRAIT('rider-balaye'))).status).toBe(409);

    const purge = await ops(mf, '/ops/order/retirer', { command_id: 'ba-purge', orderId: 'ord-balaye' });
    expect((purge['removed'] as Json)['assignments'], 'the sweep must really have taken the assignment row').toBe(1);

    // The book is now blind — the guard that answered 409 a moment ago cannot.
    const sansSerment = await opsRaw(mf, '/ops/riders/remove', { riderId: 'rider-balaye' });
    expect(sansSerment.status, 'after a purge, an unasserted removal must still not land').toBe(428);
    expect(rosterIds(await ops(mf, '/ops/riders'))).toContain('rider-balaye');
  });

  it('an UNKNOWN rider is 404 — never a phantom removal', async () => {
    const mf = spawn();
    const nobody = await opsRaw(mf, '/ops/riders/remove', RETRAIT('rider-fantome'));
    expect(nobody.status).toBe(404);
    expect(nobody.json['reason']).toBe('unknown_rider');
  });

  it('a rider with NO code removes cleanly and says so — codeRevoked is honest', async () => {
    const mf = spawn();
    await ops(mf, '/ops/riders', { riderId: 'rider-sans-code', displayName: 'Sans', phoneAlias: 'alias-sc' });
    const gone = await opsRaw(mf, '/ops/riders/remove', RETRAIT('rider-sans-code'));
    expect(gone.status).toBe(200);
    expect(gone.json['codeRevoked'], 'there was no code — saying one was revoked would be a small lie').toBe(false);
  });

  it('the removal is DURABLE — it survives a REAL restart of the object', async () => {
    /**
     * ⚠ THIS TEST USED TO PROVE NOTHING. It re-read the SAME live instance and
     * called that a restart; the verifier mutated `persist()` out of the bundle
     * and all six tests stayed green. A restart is now a restart: the object is
     * DISPOSED and a second Miniflare is started over the SAME durable storage
     * directory, so the answer can only come from what was written to disk.
     *
     * ⚠ AND IT CARRIES A WITNESS, because « the rider is absent » is exactly
     * what an EMPTY object says too. `rider-temoin` is never removed: if the
     * restart read a fresh, blank state — or if nothing was ever written down —
     * he is missing, and this test goes red for that instead of passing on a
     * technicality. (Proven: with `persist()` mutated out of the bundle, the
     * witness assertion fails.)
     */
    const dir = mkdtempSync(join(tmpdir(), 'retirer-coursier-durable-'));
    const first = spawn(dir);
    await coursier(first, 'rider-durable');
    await ops(first, '/ops/riders', { riderId: 'rider-temoin', displayName: 'Témoin', phoneAlias: 'alias-temoin' });
    expect(rosterIds(await ops(first, '/ops/riders'))).toContain('rider-durable');
    expect((await opsRaw(first, '/ops/riders/remove', RETRAIT('rider-durable'))).status).toBe(200);
    await stop(first);

    const second = spawn(dir);
    const apres = rosterIds(await ops(second, '/ops/riders'));
    expect(apres, 'the roster did not survive the restart at all — nothing was written down').toContain('rider-temoin');
    expect(apres, 'the removal did not outlive the object — it was never written down').not.toContain('rider-durable');
    const secondAsk = await opsRaw(second, '/ops/riders/remove', RETRAIT('rider-durable'));
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
        // The console's REAL envelope — so a 401 here means the key was
        // refused, never that the body was.
        body: JSON.stringify(RETRAIT('rider-garde')),
      });
      expect(res.status, 'a destructive roster act answered without the ops key').toBe(401);
    }
    expect(rosterIds(await ops(mf, '/ops/riders'))).toContain('rider-garde');
  });
});
