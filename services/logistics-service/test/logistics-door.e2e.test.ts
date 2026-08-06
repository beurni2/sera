import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * SE-LIVE-1 — the logistics Worker DOOR on the real runtime (workerd via
 * Miniflare): three doors (ops secret / intake secret / rider personal
 * codes), the composed LogisticsDO behind them, and DURABILITY across a
 * restart. Every business rule exercised here is the SAME tested core from
 * src/ — what this suite pins is the seam: auth separation, fail-closed
 * projections until SE-LIVE-2's real producers post facts, the personal-code
 * regime (hash-only storage, uniform 401, phantom-mint refusal), ownership
 * at the rider door, and the one-object serialization of /ops/assign.
 */

const OPS = 'test-ops-secret-door-e2e';
const INTAKE = 'test-intake-secret-door-e2e';
const opsAuth = { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' };
const intakeAuth = { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' };
const codeAuth = (code: string) => ({ Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' });

const T = '2026-08-06T12:00:00.000Z';

const boot = (persist?: string) =>
  new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE },
    // Per-instance dirs ALWAYS (the FONDS SQLITE_BUSY lesson) — the restart
    // suite reuses ONE dir on purpose: that reuse IS the durability claim.
    ...(persist !== undefined ? { durableObjectsPersist: persist } : {}),
  });

let mf: Miniflare;

beforeAll(() => {
  mf = boot(mkdtempSync(join(tmpdir(), 'logistics-door-')));
});
afterAll(() => mf.dispose());

type Json = Record<string, unknown>;

async function call(
  m: Miniflare,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const res = await m.dispatchFetch(`http://logistics${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

const taskShape = (id: string, orderId: string) => ({
  type: 'delivery' as const,
  id,
  orderId,
  location: {
    pin: { lat: 12.3714, lng: -1.5197 },
    zone: 'Gounghin',
    landmark: 'Face à la pharmacie du marché',
    directions: 'Deuxième porte bleue après le kiosque',
    maskedRelay: 'relay-door',
  },
  window: { start: T, end: '2026-08-06T14:00:00.000Z' },
  status: 'ready',
});

const readyEvent = (commandId: string, taskId: string, orderId: string) => ({
  name: 'logistics.task_ready.v1',
  envelope: {
    command_id: commandId,
    correlation_id: `corr-${orderId}`,
    aggregateVersion: 1,
    actor: 'shop-plus:commerce-core',
    serverTime: T,
    version: '1',
  },
  payload: { task: taskShape(taskId, orderId) },
});

const fundOrder = (m: Miniflare, orderId: string, over: Json = {}) =>
  call(m, 'POST', '/intake/funding', intakeAuth, {
    orderId,
    status: 'funded',
    paymentMode: 'FULL_PREPAY',
    asOf: T,
    ...over,
  });

const readyOrder = (m: Miniflare, orderId: string, over: Json = {}) =>
  call(m, 'POST', '/intake/readiness', intakeAuth, { orderId, ready: true, asOf: T, ...over });

/** Full rider prep through the REAL doors: ops registers + mints, the rider
 * acks the privacy notice and starts shift with their own code. */
async function prepRider(m: Miniflare, riderId: string): Promise<string> {
  const reg = await call(m, 'POST', '/ops/riders', opsAuth, {
    riderId,
    displayName: `Rider ${riderId}`,
    phoneAlias: `alias-${riderId}`,
    certified: true,
  });
  expect(reg.status).toBe(200);
  const mint = await call(m, 'POST', '/ops/rider-code/mint', opsAuth, { riderId });
  expect(mint.status).toBe(200);
  const code = mint.json['code'] as string;
  expect(code).toMatch(/^SR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect((await call(m, 'POST', '/rider/ack-privacy', codeAuth(code))).status).toBe(200);
  const shift = await call(m, 'POST', '/rider/shift/start', codeAuth(code));
  expect(shift.status).toBe(200);
  return code;
}

describe('the three doors — separation, uniformity, fail-closed', () => {
  it('GET /health answers unauthenticated with the provenance stamp and NOTHING else', async () => {
    const res = await call(mf, 'GET', '/health', {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, service: 'logistics-service', release: 'dev', canon: 'dev' });
  });

  it('ops routes refuse no-bearer, wrong-bearer AND the intake secret with ONE identical 401', async () => {
    const naked = await call(mf, 'GET', '/ops/board', {});
    expect(naked.status).toBe(401);
    const wrongKey = await call(mf, 'GET', '/ops/board', { Authorization: 'Bearer wrong' });
    expect(wrongKey.status).toBe(401);
    // door separation: the INTAKE key does not open the OPS door…
    const crossed = await call(mf, 'GET', '/ops/board', intakeAuth);
    expect(crossed.status).toBe(401);
    expect(crossed.json).toEqual(naked.json);
    expect(wrongKey.json).toEqual(naked.json);
  });

  it('…and the OPS key does not open the INTAKE door (producers hold exactly the door they need)', async () => {
    const crossed = await call(mf, 'POST', '/intake/funding', opsAuth, {
      orderId: 'order-cross',
      status: 'funded',
      paymentMode: 'FULL_PREPAY',
      asOf: T,
    });
    expect(crossed.status).toBe(401);
    expect(crossed.json).toEqual({ error: 'unauthorized' });
  });

  it('the rider door: no code, garbage code and a WELL-FORMED unknown code are the SAME 401', async () => {
    const naked = await call(mf, 'GET', '/rider/moi', {});
    const garbage = await call(mf, 'GET', '/rider/moi', codeAuth('n-importe-quoi'));
    const shaped = await call(mf, 'GET', '/rider/moi', codeAuth('SR-AAAA-BBBB-CCCC'));
    expect([naked.status, garbage.status, shaped.status]).toEqual([401, 401, 401]);
    expect(garbage.json).toEqual(naked.json);
    expect(shaped.json).toEqual(naked.json);
  });

  it('unknown paths refuse closed at the router', async () => {
    expect((await call(mf, 'GET', '/anything', {})).status).toBe(404);
    expect((await call(mf, 'POST', '/ops/unknown', opsAuth, {})).status).toBe(404);
  });
});

describe('intake — FAIL-CLOSED projections until real facts arrive (SE1.1 through the door)', () => {
  const ORDER = 'order-intake-1';
  const TASK = 'task-intake-1';
  const CMD = 'cmd-intake-ready-1';

  it('an order NO fact was ever posted for refuses closed: funding_projection_stale', async () => {
    const res = await call(mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent(CMD, TASK, ORDER));
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ ok: false, admitted: false, reason: 'funding_projection_stale' });
  });

  it('funding alone is not enough — readiness still refuses closed (and the SAME command re-evaluates: the retry-after-heal law)', async () => {
    expect((await fundOrder(mf, ORDER)).status).toBe(200);
    const res = await call(mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent(CMD, TASK, ORDER));
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ ok: false, reason: 'readiness_projection_stale' });
  });

  it('both facts posted → the SAME command now ADMITS; a replay answers duplicate', async () => {
    expect((await readyOrder(mf, ORDER)).status).toBe(200);
    const admitted = await call(mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent(CMD, TASK, ORDER));
    expect(admitted.status).toBe(200);
    expect(admitted.json).toMatchObject({ ok: true, admitted: true, duplicate: false, taskId: TASK });
    const replay = await call(mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent(CMD, TASK, ORDER));
    expect(replay.status).toBe(200);
    expect(replay.json).toMatchObject({ ok: true, admitted: true, duplicate: true });
  });

  it('E1 admits FULL_PREPAY only; cancelled and producer-marked-stale refuse closed with their own reasons', async () => {
    await fundOrder(mf, 'order-cod', { paymentMode: 'CASH_ON_DOOR' });
    await readyOrder(mf, 'order-cod');
    const cod = await call(mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent('cmd-cod', 'task-cod', 'order-cod'));
    expect(cod.status).toBe(422);
    expect(cod.json).toMatchObject({ reason: 'payment_mode_not_available_e1' });

    await fundOrder(mf, 'order-cancelled', { status: 'cancelled' });
    const cancelled = await call(
      mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent('cmd-cancelled', 'task-cancelled', 'order-cancelled'),
    );
    expect(cancelled.status).toBe(422);
    expect(cancelled.json).toMatchObject({ reason: 'order_cancelled' });

    await fundOrder(mf, 'order-stale', { stale: true });
    const stale = await call(
      mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent('cmd-stale', 'task-stale', 'order-stale'),
    );
    expect(stale.status).toBe(422);
    expect(stale.json).toMatchObject({ reason: 'funding_projection_stale' });
  });

  it('a malformed fact is 400 malformed — never a stored guess', async () => {
    const bad = await call(mf, 'POST', '/intake/funding', intakeAuth, {
      orderId: 'order-bad',
      status: 'peut-être',
      paymentMode: 'FULL_PREPAY',
      asOf: T,
    });
    expect(bad.status).toBe(400);
    const badIso = await call(mf, 'POST', '/intake/readiness', intakeAuth, { orderId: 'order-bad', ready: true, asOf: 'hier' });
    expect(badIso.status).toBe(400);
  });
});

describe('riders, personal codes, and the full dispatch loop through the doors', () => {
  const ORDER = 'order-loop-1';
  const T1 = 'task-loop-1';
  const T2 = 'task-loop-2';
  let codeR1 = '';
  let codeR2 = '';
  let assignmentId1 = '';

  beforeAll(async () => {
    await fundOrder(mf, ORDER);
    await readyOrder(mf, ORDER);
    expect(
      (await call(mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent('cmd-loop-t1', T1, ORDER))).status,
    ).toBe(200);
  });

  it('registration is first-wins (a re-register would wipe the privacy ack — refused); minting for an unknown rider refuses (no phantom doors)', async () => {
    codeR1 = await prepRider(mf, 'r-loop-1');
    const again = await call(mf, 'POST', '/ops/riders', opsAuth, {
      riderId: 'r-loop-1',
      displayName: 'Doublon',
      phoneAlias: 'alias-doublon',
    });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ reason: 'already_registered' });
    const phantom = await call(mf, 'POST', '/ops/rider-code/mint', opsAuth, { riderId: 'r-fantôme' });
    expect(phantom.status).toBe(404);
    expect(phantom.json).toMatchObject({ reason: 'unknown_rider' });
  });

  it('the code inventory lists {riderId, mintedAt} — the hash NEVER leaves the object', async () => {
    const inv = await call(mf, 'GET', '/ops/rider-codes', opsAuth);
    expect(inv.status).toBe(200);
    const codes = inv.json['codes'] as Json[];
    const mine = codes.find((c) => c['riderId'] === 'r-loop-1');
    expect(mine).toBeDefined();
    expect(Object.keys(mine as object).sort()).toEqual(['mintedAt', 'riderId']);
  });

  it('an uncertified or privacy-silent rider cannot start a shift (the registry law, spoken through the door)', async () => {
    await call(mf, 'POST', '/ops/riders', opsAuth, {
      riderId: 'r-muet',
      displayName: 'Sans accord',
      phoneAlias: 'alias-muet',
      certified: true,
    });
    const mint = await call(mf, 'POST', '/ops/rider-code/mint', opsAuth, { riderId: 'r-muet' });
    const muteCode = mint.json['code'] as string;
    const refused = await call(mf, 'POST', '/rider/shift/start', codeAuth(muteCode));
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ ok: false, reason: 'privacy_notice_not_acknowledged' });
  });

  it('/ops/assign grants through the FULL leased path; the board and /rider/moi both show it; replay is duplicate', async () => {
    const granted = await call(mf, 'POST', '/ops/assign', opsAuth, {
      command_id: 'cmd-assign-loop-1',
      taskId: T1,
      riderId: 'r-loop-1',
    });
    expect(granted.status).toBe(200);
    expect(granted.json).toMatchObject({ ok: true, duplicate: false });
    const assignment = granted.json['assignment'] as Json;
    expect(assignment).toMatchObject({ taskId: T1, riderId: 'r-loop-1', status: 'active_unacknowledged', orderId: ORDER });
    expect(granted.json['lease']).toMatchObject({ taskId: T1, riderId: 'r-loop-1', version: 1, status: 'active' });
    assignmentId1 = assignment['assignmentId'] as string;

    const board = await call(mf, 'GET', '/ops/board', opsAuth);
    const b = board.json['board'] as Json;
    expect((b['queued'] as Json[]).some((q) => q['taskId'] === T1)).toBe(false);
    expect((b['assignments'] as Json[]).some((a) => a['assignmentId'] === assignmentId1)).toBe(true);

    const moi = await call(mf, 'GET', '/rider/moi', codeAuth(codeR1));
    expect((moi.json['rider'] as Json)['assignment']).toMatchObject({ assignmentId: assignmentId1, taskId: T1 });

    const replay = await call(mf, 'POST', '/ops/assign', opsAuth, {
      command_id: 'cmd-assign-loop-1',
      taskId: T1,
      riderId: 'r-loop-1',
    });
    expect(replay.status).toBe(200);
    expect(replay.json).toMatchObject({ ok: true, duplicate: true });
    expect((replay.json['assignment'] as Json)['assignmentId']).toBe(assignmentId1);
  });

  it('an assigned task refuses a second grant; OWNERSHIP: another rider’s code cannot ack a foreign assignment (same answer as unknown)', async () => {
    codeR2 = await prepRider(mf, 'r-loop-2');
    const second = await call(mf, 'POST', '/ops/assign', opsAuth, {
      command_id: 'cmd-assign-loop-2',
      taskId: T1,
      riderId: 'r-loop-2',
    });
    expect(second.status).toBe(409);
    expect(second.json).toMatchObject({ ok: false, stage: 'lease', reason: 'eligibility_not_attested' });

    const foreign = await call(mf, 'POST', '/rider/assignment/ack', codeAuth(codeR2), { assignmentId: assignmentId1 });
    expect(foreign.status).toBe(404);
    const unknown = await call(mf, 'POST', '/rider/assignment/ack', codeAuth(codeR2), { assignmentId: 'as-inexistant' });
    expect(unknown.status).toBe(404);
    expect(foreign.json).toEqual(unknown.json); // no oracle
  });

  it('the rider acks with their OWN code → acknowledged + ANCHORED; the anchored rider is refused a second task AT THE AUTHORITY', async () => {
    const ack = await call(mf, 'POST', '/rider/assignment/ack', codeAuth(codeR1), { assignmentId: assignmentId1 });
    expect(ack.status).toBe(200);
    expect(ack.json).toMatchObject({ ok: true, status: 'acknowledged', pending: false, anchored: true });

    expect(
      (await call(mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent('cmd-loop-t2', T2, ORDER))).status,
    ).toBe(200);
    const busy = await call(mf, 'POST', '/ops/assign', opsAuth, {
      command_id: 'cmd-assign-loop-3',
      taskId: T2,
      riderId: 'r-loop-1',
    });
    expect(busy.status).toBe(409);
    expect(busy.json).toMatchObject({ stage: 'lease', reason: 'rider_already_leased' });
  });

  it('DECLINE frees the task with the canonical event; EXPIRE-DUE sweeps an unanswered grant back to the queue', async () => {
    const granted = await call(mf, 'POST', '/ops/assign', opsAuth, {
      command_id: 'cmd-assign-loop-4',
      taskId: T2,
      riderId: 'r-loop-2',
    });
    expect(granted.status).toBe(200);
    const asId = (granted.json['assignment'] as Json)['assignmentId'] as string;
    const declined = await call(mf, 'POST', '/rider/assignment/decline', codeAuth(codeR2), { assignmentId: asId });
    expect(declined.status).toBe(200);
    expect(declined.json).toMatchObject({ ok: true, pending: false, status: 'returned_to_queue', leaseReleased: true });
    expect((declined.json['event'] as Json)['name']).toBe('assignment.declined.v1');

    const regrant = await call(mf, 'POST', '/ops/assign', opsAuth, {
      command_id: 'cmd-assign-loop-5',
      taskId: T2,
      riderId: 'r-loop-2',
    });
    expect(regrant.status).toBe(200);
    expect((regrant.json['lease'] as Json)['version']).toBe(2); // fresh version, never reused
    // nobody answers — the sweep (6 minutes past THIS grant) expires and requeues
    const sweepAt = new Date(Date.now() + 6 * 60 * 1000).toISOString();
    const swept = await call(mf, 'POST', '/ops/expire-due', opsAuth, { nowIso: sweepAt });
    expect(swept.status).toBe(200);
    expect((swept.json['expiredLeases'] as Json[]).some((l) => l['taskId'] === T2)).toBe(true);
    expect((swept.json['events'] as Json[])[0]?.['name']).toBe('assignment.expired.v1');
    const board = await call(mf, 'GET', '/ops/board', opsAuth);
    expect(((board.json['board'] as Json)['queued'] as Json[]).some((q) => q['taskId'] === T2)).toBe(true);
    // a malformed sweep instant refuses closed
    expect((await call(mf, 'POST', '/ops/expire-due', opsAuth, { nowIso: 'demain' })).status).toBe(400);
  });

  it('REVOKE closes the personal door: the exact code that just worked answers the uniform 401', async () => {
    expect((await call(mf, 'GET', '/rider/moi', codeAuth(codeR1))).status).toBe(200);
    const revoked = await call(mf, 'POST', '/ops/rider-code/revoke', opsAuth, { riderId: 'r-loop-1' });
    expect(revoked.json).toMatchObject({ ok: true, status: 'revoked' });
    const refused = await call(mf, 'GET', '/rider/moi', codeAuth(codeR1));
    expect(refused.status).toBe(401);
    expect(refused.json).toEqual({ error: 'unauthorized' });
  });
});

describe('replay safety through the door — the verifier’s reproduced probes, pinned', () => {
  it('a RETRIED /ops/expire-due (same nowIso) is harmless: the rider who acked after the first sweep keeps their course', async () => {
    const ORDER = 'order-sweep-replay';
    const TASK = 'task-sweep-replay-door';
    await fundOrder(mf, ORDER);
    await readyOrder(mf, ORDER);
    expect(
      (await call(mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent('cmd-sweep-replay-ready', TASK, ORDER))).status,
    ).toBe(200);
    await prepRider(mf, 'r-sweep-a');
    const codeB = await prepRider(mf, 'r-sweep-b');
    expect(
      (await call(mf, 'POST', '/ops/assign', opsAuth, { command_id: 'cmd-sweep-replay-1', taskId: TASK, riderId: 'r-sweep-a' })).status,
    ).toBe(200);
    // ONE sweep instant, used twice — the timed-out-POST-retried scenario
    const sweepAt = new Date(Date.now() + 6 * 60 * 1000).toISOString();
    const first = await call(mf, 'POST', '/ops/expire-due', opsAuth, { nowIso: sweepAt });
    expect((first.json['expiredLeases'] as Json[]).some((l) => l['taskId'] === TASK)).toBe(true);
    // re-grant to B, who ANSWERS IN TIME (anchored)
    const regrant = await call(mf, 'POST', '/ops/assign', opsAuth, { command_id: 'cmd-sweep-replay-2', taskId: TASK, riderId: 'r-sweep-b' });
    expect(regrant.status).toBe(200);
    const asId = (regrant.json['assignment'] as Json)['assignmentId'] as string;
    expect((await call(mf, 'POST', '/rider/assignment/ack', codeAuth(codeB), { assignmentId: asId })).json).toMatchObject({
      ok: true,
      anchored: true,
    });
    // THE REPLAY — before the fix this returned B's acked assignment to the
    // queue while the authority kept B's anchored lease: task and rider both
    // stranded forever. Now: no new consequence.
    const replay = await call(mf, 'POST', '/ops/expire-due', opsAuth, { nowIso: sweepAt });
    expect(replay.status).toBe(200);
    expect(replay.json['requeued']).toEqual([]);
    expect(replay.json['events']).toEqual([]);
    const board = await call(mf, 'GET', '/ops/board', opsAuth);
    const b = board.json['board'] as Json;
    expect((b['assignments'] as Json[]).some((a) => a['assignmentId'] === asId)).toBe(true);
    expect((b['queued'] as Json[]).some((q) => q['taskId'] === TASK)).toBe(false);
    const moi = await call(mf, 'GET', '/rider/moi', codeAuth(codeB));
    expect((moi.json['rider'] as Json)['assignment']).toMatchObject({ assignmentId: asId, taskId: TASK });
  });

  it('an OLDER redelivered intake fact never wins: a replayed « funded » from before a « cancelled » does not re-open admission (SE-I02)', async () => {
    const ORDER = 'order-fact-order';
    const T2 = '2026-08-06T12:30:00.000Z'; // later than T
    expect((await fundOrder(mf, ORDER)).json).toMatchObject({ applied: true }); // funded @ T
    expect((await fundOrder(mf, ORDER, { status: 'cancelled', asOf: T2 })).json).toMatchObject({ applied: true });
    // the at-least-once redelivery of the OLD funded fact — acknowledged, ignored
    const redelivered = await fundOrder(mf, ORDER); // asOf T < T2
    expect(redelivered.status).toBe(200);
    expect(redelivered.json).toMatchObject({ ok: true, applied: false, reason: 'older_fact_ignored' });
    await readyOrder(mf, ORDER, { asOf: T2 });
    const refused = await call(
      mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent('cmd-fact-order', 'task-fact-order', ORDER),
    );
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ reason: 'order_cancelled' });
  });
});

describe('serialization through the door — SE-I01 under real concurrency', () => {
  it('20 CONCURRENT /ops/assign on ONE task, 20 assignable riders → EXACTLY 1 grant, 19 refusals', async () => {
    const ORDER = 'order-race-door';
    const TASK = 'task-race-door';
    await fundOrder(mf, ORDER);
    await readyOrder(mf, ORDER);
    expect(
      (await call(mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent('cmd-race-ready', TASK, ORDER))).status,
    ).toBe(200);
    for (let i = 0; i < 20; i += 1) await prepRider(mf, `r-race-${i}`);
    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call(mf, 'POST', '/ops/assign', opsAuth, {
          command_id: `cmd-race-assign-${i}`,
          taskId: TASK,
          riderId: `r-race-${i}`,
        }),
      ),
    );
    const winners = attempts.filter((a) => a.status === 200);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.json).toMatchObject({ ok: true, duplicate: false });
    expect(attempts.filter((a) => a.status === 409)).toHaveLength(19);
  }, 60_000);
});

describe('DURABILITY — the book survives a restart (the whole point of the DO)', () => {
  it('facts, queue, riders, codes, assignments AND the lease state are all still there in a fresh instance on the same storage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logistics-restart-'));
    const first = boot(dir);
    const ORDER = 'order-restart';
    const TASK = 'task-restart';
    await fundOrder(first, ORDER);
    await readyOrder(first, ORDER);
    expect(
      (await call(first, 'POST', '/intake/task-ready', intakeAuth, readyEvent('cmd-restart-ready', TASK, ORDER))).status,
    ).toBe(200);
    const code = await prepRider(first, 'r-restart');
    const granted = await call(first, 'POST', '/ops/assign', opsAuth, {
      command_id: 'cmd-restart-assign',
      taskId: TASK,
      riderId: 'r-restart',
    });
    expect(granted.status).toBe(200);
    const asId = ((granted.json as Json)['assignment'] as Json)['assignmentId'] as string;
    await first.dispose();

    const second = boot(dir);
    try {
      // the personal code still opens the door, with the assignment attached
      const moi = await call(second, 'GET', '/rider/moi', codeAuth(code));
      expect(moi.status).toBe(200);
      expect((moi.json['rider'] as Json)['assignment']).toMatchObject({ assignmentId: asId, taskId: TASK });
      // the board still shows the live assignment
      const board = await call(second, 'GET', '/ops/board', opsAuth);
      expect(((board.json['board'] as Json)['assignments'] as Json[]).some((a) => a['assignmentId'] === asId)).toBe(true);
      // the assign command replays as a DUPLICATE — the applied-command memory survived
      const replay = await call(second, 'POST', '/ops/assign', opsAuth, {
        command_id: 'cmd-restart-assign',
        taskId: TASK,
        riderId: 'r-restart',
      });
      expect(replay.status).toBe(200);
      expect(replay.json).toMatchObject({ ok: true, duplicate: true });
      // and THE lease truth survived: a raw acquire on the same task refuses
      const raw = await call(second, 'POST', '/authority/dispatch', opsAuth, {
        kind: 'acquire',
        command_id: 'cmd-restart-raw',
        taskId: TASK,
        riderId: 'r-restart-b',
        grantedAt: T,
        eligibility: { riderAssignable: true, taskAssignable: true, checkedAt: T },
        correlationId: `corr-${ORDER}`,
      });
      expect(raw.status).toBe(409);
      expect(raw.json).toMatchObject({ ok: false, reason: 'task_already_leased' });
    } finally {
      await second.dispose();
    }
  }, 60_000);
});
