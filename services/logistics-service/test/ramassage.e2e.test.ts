import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';

/**
 * ═══ RAMASSAGE — the two-party pickup handshake, end to end ═══
 *
 * Founder order (2026-08-09): « the code of ramassage has to come from the
 * rider's app where the product supplier will check on his screen … once the
 * rider arrives to the pickup location, he will give the code to the supplier
 * who will enter it … if the code matches it shows code confirmé you hand the
 * product over and if code does not match it shows not confirmed do not hand
 * the product. »
 *
 * SE5 names the pickup TWO-PARTY. This is the supplier's half: a
 * logistics-owned code minted at assign, SHOWN to its own rider through the
 * app's real session port, SAID across the stall, and judged at the INTAKE
 * door — the one Boutik+'s offer-service already holds for readiness, so the
 * verdict reaches the SUPPLIER's console (founder, 2026-08-09: « that screen
 * should be on the supplier's console not mine »), never only the founder's.
 * The door answers a VERDICT and never the code. Custody is untouched:
 * `pickupVerificationCode` (SE-I05) flows as before.
 */

const OPS = 'test-ops-ramassage';
const INTAKE = 'test-intake-ramassage';
const VERIFY = 'test-verify-ramassage';

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

function spawn(): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'ramassage-')),
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY },
  });
  live.push(mf);
  return mf;
}

async function ops(mf: Miniflare, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function intake(mf: Miniflare, path: string, body: unknown): Promise<void> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, path).toBe(200);
}

/** The verify door as the offer-service speaks it: the INTAKE bearer, a
 *  verdict back. */
async function verify(mf: Miniflare, body: unknown): Promise<Record<string, unknown>> {
  const res = await mf.dispatchFetch('http://logistics/intake/ramassage/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return { acts: httpShiftActs('http://logistics', net, fetchFn), session: httpRiderSession('http://logistics', net, fetchFn) };
}

const T = '2026-08-09T10:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-08-09T16:00:00.000Z' };
const FORME = /^[ABCDEFGHJKMNPQRSTVWXYZ2-9]{3}-[ABCDEFGHJKMNPQRSTVWXYZ2-9]{3}$/;

async function courseConfiee(mf: Miniflare, orderId: string, riderId: string, prefix: string) {
  await intake(mf, '/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
  await intake(mf, '/intake/readiness', { orderId, ready: true, asOf: T });
  const composed = await ops(mf, '/ops/task', { command_id: `${prefix}-t`, orderId, location: LOC, window: WIN });
  expect(composed['ok'], JSON.stringify(composed)).toBe(true);
  await ops(mf, '/ops/riders', { riderId, displayName: riderId, phoneAlias: prefix });
  await ops(mf, '/ops/riders/certify', { riderId, certified: true });
  const code = (await ops(mf, '/ops/rider-code/mint', { riderId }))['code'] as string;
  const { acts, session } = appPorts(mf);
  await acts.ackPrivacy(code);
  if (!(await acts.startShift(code)).ok) throw new Error('start refused');
  const granted = await ops(mf, '/ops/assign', { command_id: `${prefix}-a`, taskId: composed['taskId'], riderId });
  expect(granted['ok'], JSON.stringify(granted)).toBe(true);
  const assignmentId = (granted['assignment'] as Record<string, unknown>)['assignmentId'] as string;
  const accepted = await acts.accepterCourse(code, assignmentId);
  expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
  return { session, acts, code, assignmentId, taskId: composed['taskId'] as string };
}

describe('the whole handshake: minted at assign, shown to the rider, judged for the supplier', () => {
  it('the rider’s OWN session read carries the code; the supplier’s door answers confirmé for it and non confirmé for anything else', async () => {
    const mf = spawn();
    const { session, code } = await courseConfiee(mf, 'ord-r1', 'rider-boss', 'r1');

    // The rider's app — the only place the plaintext ever travels to.
    const moi = await session.signIn(code);
    if (!moi.ok) throw new Error('sign-in refused');
    const montre = moi.session.assignment?.codeRamassage;
    expect(montre, 'the accepted course must carry its ramassage code').toMatch(FORME);

    // The supplier types what the rider SAID — verdict: confirmé. Case and
    // separators are forgiven; the characters are not.
    const dit = await verify(mf, { command_id: 'r1-v1', orderId: 'ord-r1', code: montre });
    expect(dit).toEqual({ ok: true, verdict: 'confirme' });
    const casse = await verify(mf, {
      command_id: 'r1-v2', orderId: 'ord-r1', code: (montre as string).toLowerCase().replace('-', ' '),
    });
    expect(casse).toEqual({ ok: true, verdict: 'confirme' });

    // A wrong code, a foreign order, an order with no course: all the same
    // « non confirmé » — no oracle at a market stall.
    expect(await verify(mf, { command_id: 'r1-v3', orderId: 'ord-r1', code: 'AAA-AAA' }))
      .toEqual({ ok: true, verdict: 'non_confirme' });
    expect(await verify(mf, { command_id: 'r1-v4', orderId: 'ord-inconnu', code: montre }))
      .toEqual({ ok: true, verdict: 'non_confirme' });
  });

  it('⚠ the code leaks NOWHERE else: the board’s raw bytes never carry it, and the assign response does not either', async () => {
    const mf = spawn();
    const { session, code } = await courseConfiee(mf, 'ord-r2', 'rider-awa', 'r2');
    const moi = await session.signIn(code);
    if (!moi.ok) throw new Error('sign-in refused');
    const montre = moi.session.assignment?.codeRamassage as string;
    expect(montre).toMatch(FORME);

    const boardRes = await mf.dispatchFetch('http://logistics/ops/board', {
      headers: { Authorization: `Bearer ${OPS}` },
    });
    const boardBytes = await boardRes.text();
    expect(boardBytes.includes(montre), 'the board must never carry the handover code').toBe(false);
    // and a replayed assign (duplicate) still answers WITHOUT the code
    const again = await ops(mf, '/ops/assign', { command_id: 'r2-a', taskId: moi.session.assignment?.taskId, riderId: 'rider-awa' });
    expect(JSON.stringify(again).includes(montre)).toBe(false);
  });

  it('a taken-back course answers non confirmé, and the re-assigned course carries a FRESH code', async () => {
    const mf = spawn();
    const { session, code, assignmentId } = await courseConfiee(mf, 'ord-r3', 'rider-boss', 'r3');
    const moi = await session.signIn(code);
    if (!moi.ok) throw new Error('sign-in refused');
    const ancien = moi.session.assignment?.codeRamassage as string;

    const repris = await ops(mf, '/ops/assignment/take-back', { command_id: 'r3-w', assignmentId, custodyNotBegun: true });
    expect(repris['ok'], JSON.stringify(repris)).toBe(true);
    // the dead course's code opens nothing
    expect(await verify(mf, { command_id: 'r3-v1', orderId: 'ord-r3', code: ancien }))
      .toEqual({ ok: true, verdict: 'non_confirme' });

    // re-compose + re-assign: a FRESH code, and the old one still opens nothing
    const recomposed = await ops(mf, '/ops/task', { command_id: 'r3-t2', orderId: 'ord-r3', location: LOC, window: WIN });
    expect(recomposed['ok'], JSON.stringify(recomposed)).toBe(true);
    const regranted = await ops(mf, '/ops/assign', { command_id: 'r3-a2', taskId: recomposed['taskId'], riderId: 'rider-boss' });
    expect(regranted['ok'], JSON.stringify(regranted)).toBe(true);
    const fresh = await session.signIn(code);
    if (!fresh.ok) throw new Error('refresh refused');
    const nouveau = fresh.session.assignment?.codeRamassage as string;
    expect(nouveau).toMatch(FORME);
    expect(nouveau).not.toBe(ancien);
    expect(await verify(mf, { command_id: 'r3-v2', orderId: 'ord-r3', code: nouveau }))
      .toEqual({ ok: true, verdict: 'confirme' });
    expect(await verify(mf, { command_id: 'r3-v3', orderId: 'ord-r3', code: ancien }))
      .toEqual({ ok: true, verdict: 'non_confirme' });
  });

  it('the verify door is the INTAKE key’s alone — no key, a wrong key, and even the founder’s OPS key are the one uniform 401', async () => {
    const mf = spawn();
    await courseConfiee(mf, 'ord-r4', 'rider-awa', 'r4');
    // The ops secret is deliberately in this list: the check moved to the
    // supplier's console (founder, 2026-08-09), and each caller holds exactly
    // the door they need — the router's own discipline.
    for (const headers of [
      { 'Content-Type': 'application/json' },
      { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' },
      { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ]) {
      const res = await mf.dispatchFetch('http://logistics/intake/ramassage/verify', {
        method: 'POST', headers, body: JSON.stringify({ command_id: 'r4-v', orderId: 'ord-r4', code: 'AAA-AAA' }),
      });
      expect(res.status).toBe(401);
    }
  });
});
