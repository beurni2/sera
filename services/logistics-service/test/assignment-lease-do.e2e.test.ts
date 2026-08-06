import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LeaseRecord } from '../src/assignment-lease.js';

/**
 * ADVERSARIAL assignment-lease tests on the REAL Workers runtime (workerd
 * via Miniflare) — SE2.1 acceptance: "concurrency never double-books". ONE
 * DO instance (idFromName('logistique')) is THE dispatch authority; workerd's
 * per-object input gate serializes every acquire — the atomicity mechanism
 * under test is the runtime's, not a shim (the stock-reservation-do
 * pattern). SE-LIVE-1: the route moved onto the composed LogisticsDO and
 * BEHIND the ops door (Bearer SERA_OPS_SECRET) — every behavioral assertion
 * below is unchanged; the suite now also proves the door itself.
 */

const OPS_SECRET = 'test-ops-secret-lease-e2e';
const AUTH = { Authorization: `Bearer ${OPS_SECRET}`, 'Content-Type': 'application/json' };

let mf: Miniflare;

beforeAll(() => {
  mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    bindings: { SERA_OPS_SECRET: OPS_SECRET },
  });
});
afterAll(() => mf.dispose());

const T = '2026-07-12T12:00:00.000Z';
const PAST_TTL = '2026-07-12T12:06:00.000Z';

type Decision = {
  ok: boolean;
  reason?: string;
  lease?: LeaseRecord;
  expired?: LeaseRecord[];
  idempotentReplay?: boolean;
};

async function send(body: Record<string, unknown>): Promise<Decision> {
  const res = await mf.dispatchFetch('http://logistics/authority/dispatch', {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify(body),
  });
  return (await res.json()) as Decision;
}

const acquire = (command_id: string, taskId: string, riderId: string, over: Record<string, unknown> = {}) => ({
  kind: 'acquire',
  command_id,
  taskId,
  riderId,
  grantedAt: T,
  eligibility: { riderAssignable: true, taskAssignable: true, checkedAt: T },
  correlationId: `corr-${taskId}`,
  ...over,
});

describe('AssignmentLeaseDO on workerd — THE singular dispatch authority', () => {
  it('① 20 CONCURRENT ACQUIRES, one task, 20 distinct riders → EXACTLY 1 winner, 19 task_already_leased (SE-I01: never double-booked)', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, i) => send(acquire(`race-t-${i}`, 'task-race', `rider-${i}`))),
    );
    const winners = attempts.filter((d) => d.ok);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.lease).toMatchObject({ taskId: 'task-race', version: 1, status: 'active' });
    expect(attempts.filter((d) => !d.ok && d.reason === 'task_already_leased')).toHaveLength(19);
  });

  it('② 20 TASKS racing ONE rider → EXACTLY 1 grant, 19 rider_already_leased (one courier, one live lease)', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, i) => send(acquire(`race-r-${i}`, `task-solo-${i}`, 'rider-solo'))),
    );
    const winners = attempts.filter((d) => d.ok);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.lease).toMatchObject({ riderId: 'rider-solo', version: 1, status: 'active' });
    expect(attempts.filter((d) => !d.ok && d.reason === 'rider_already_leased')).toHaveLength(19);
  });

  it('③ replay of the WINNING acquire command_id → idempotentReplay true, the SAME lease, no second grant', async () => {
    const win = await send(acquire('cmd-win', 'task-replay', 'rider-replay'));
    expect(win.ok).toBe(true);
    const replay = await send(acquire('cmd-win', 'task-replay', 'rider-replay'));
    expect(replay).toMatchObject({ ok: true, idempotentReplay: true });
    expect(replay.lease).toEqual(win.lease);
    // no second grant happened: another rider on the task is still refused
    const probe = await send(acquire('cmd-probe', 'task-replay', 'rider-probe'));
    expect(probe).toMatchObject({ ok: false, reason: 'task_already_leased' });
  });

  it('④ the OFF-SHIFT TAMPER SURFACE: acquire with eligibility { riderAssignable: false } → refused eligibility_not_attested (409)', async () => {
    const res = await mf.dispatchFetch('http://logistics/authority/dispatch', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify(
        acquire('cmd-tamper', 'task-tamper', 'rider-tamper', {
          eligibility: { riderAssignable: false, taskAssignable: true, checkedAt: T },
        }),
      ),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'eligibility_not_attested' });
  });

  it('⑤ expire_due past TTL → the lease EXPIRES and the task is acquirable again by a NEW command (fresh version); before expiry it expires NOTHING', async () => {
    const win = await send(acquire('cmd-exp-1', 'task-exp', 'rider-exp'));
    expect(win.ok).toBe(true);
    // BEFORE expiry: nothing expires, the lease still bars the task
    const early = await send({ kind: 'expire_due', command_id: 'cmd-sweep-early', nowIso: '2026-07-12T12:04:00.000Z' });
    expect(early.ok).toBe(true);
    expect(early.expired).toEqual([]);
    expect(await send(acquire('cmd-exp-2', 'task-exp', 'rider-exp-b'))).toMatchObject({
      ok: false,
      reason: 'task_already_leased',
    });
    // PAST TTL: the lease expires…
    const due = await send({ kind: 'expire_due', command_id: 'cmd-sweep-due', nowIso: PAST_TTL });
    expect(due.ok).toBe(true);
    expect(due.expired?.some((l) => l.taskId === 'task-exp' && l.status === 'expired')).toBe(true);
    // …and a NEW command acquires a FRESH lease with a NEW version
    const fresh = await send(acquire('cmd-exp-3', 'task-exp', 'rider-exp-b', { grantedAt: PAST_TTL }));
    expect(fresh.ok).toBe(true);
    expect(fresh.lease).toMatchObject({ taskId: 'task-exp', version: 2, status: 'active' });
  });

  it('router refuses closed: wrong path 404, non-POST 404, malformed body 400 — the authority answers ONLY /authority/dispatch', async () => {
    const lost = await mf.dispatchFetch('http://logistics/authority/other', { method: 'POST', headers: AUTH, body: '{}' });
    expect(lost.status).toBe(404);
    const got = await mf.dispatchFetch('http://logistics/authority/dispatch', { method: 'GET', headers: AUTH });
    expect(got.status).toBe(404); // non-POST never reaches the object
    const malformed = await mf.dispatchFetch('http://logistics/authority/dispatch', { method: 'POST', headers: AUTH, body: 'pas-du-json' });
    expect(malformed.status).toBe(400);
  });

  it('SE-LIVE-1 — THE DOOR ITSELF: no bearer and a wrong bearer are the SAME uniform 401; no lease command is decided', async () => {
    const naked = await mf.dispatchFetch('http://logistics/authority/dispatch', {
      method: 'POST',
      body: JSON.stringify(acquire('cmd-naked', 'task-naked', 'rider-naked')),
    });
    expect(naked.status).toBe(401);
    const nakedBody = await naked.json();
    const wrong = await mf.dispatchFetch('http://logistics/authority/dispatch', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify(acquire('cmd-naked', 'task-naked', 'rider-naked')),
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(nakedBody); // one identical 401, never an oracle
    // the refused command decided NOTHING: the same ids acquire freshly with auth
    const fresh = await send(acquire('cmd-naked', 'task-naked', 'rider-naked'));
    expect(fresh).toMatchObject({ ok: true, idempotentReplay: false });
  });
});
