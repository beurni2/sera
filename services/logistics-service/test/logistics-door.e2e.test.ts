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
const VERIFY = 'test-rider-verify-secret-door-e2e';
const opsAuth = { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' };
const intakeAuth = { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' };
const codeAuth = (code: string) => ({ Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' });

const T = '2026-08-06T12:00:00.000Z';

const boot = (persist?: string) =>
  new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY },
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

/**
 * ═══ SE-LIVE-2c — THE FOUNDER COMPOSES THE TASK (founder ruling, option 1) ═══
 *
 * The canonical DeliveryTask demands a GPS pin, `directions` and a
 * `maskedRelay`; the buyer gives Shop+ only phone + quartier + repère. Rather
 * than let a producer invent coordinates, the FOUNDER supplies the address by
 * hand. What this suite pins is the line between « he supplies the address »
 * and « he overrides the law »: the composed task goes through the SAME SE-I02
 * admission gate as any wire, so an unfunded or unprepared order refuses
 * closed against his own hand, with the gate's own reason.
 */
describe('SE-LIVE-2c — the founder composes the task, and the gate still governs', () => {
  const ORDER = 'order-compose-1';
  const LOCATION = {
    pin: { lat: 12.3714, lng: -1.5197 },
    zone: 'Gounghin',
    landmark: 'Face à la pharmacie du marché',
    directions: 'Deuxième porte bleue après le kiosque',
    maskedRelay: 'relay-compose-1',
  };
  const WINDOW = { start: T, end: '2026-08-06T14:00:00.000Z' };

  it('AN UNFUNDED ORDER REFUSES CLOSED AGAINST THE FOUNDER — SE-I02 is not his to skip', async () => {
    const res = await call(mf, 'POST', '/ops/task', opsAuth, {
      command_id: 'cmd-compose-unfunded',
      orderId: 'order-compose-unfunded',
      location: LOCATION,
      window: WINDOW,
    });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ ok: false, admitted: false, reason: 'funding_projection_stale' });
  });

  it('FUNDED BUT NOT YET PREPARED also refuses — readiness is the supplier’s word, not the dispatcher’s', async () => {
    await fundOrder(mf, ORDER);
    const res = await call(mf, 'POST', '/ops/task', opsAuth, {
      command_id: 'cmd-compose-unready',
      orderId: ORDER,
      location: LOCATION,
      window: WINDOW,
    });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ reason: 'readiness_projection_stale' });
  });

  it('BOTH FACTS IN: the composed task is admitted, canon-shaped, and lands on the board', async () => {
    await readyOrder(mf, ORDER);
    const res = await call(mf, 'POST', '/ops/task', opsAuth, {
      command_id: 'cmd-compose-ok',
      orderId: ORDER,
      location: LOCATION,
      window: WINDOW,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, admitted: true, duplicate: false });
    const taskId = res.json['taskId'] as string;
    expect(taskId.startsWith('task-')).toBe(true);

    const board = await call(mf, 'GET', '/ops/board', opsAuth);
    const queued = ((board.json['board'] as Json)['queued'] as Json[]).find((q) => q['taskId'] === taskId);
    expect(queued).toBeDefined();
    expect(queued?.['orderId']).toBe(ORDER);
    // The founder's own address survives verbatim — this is what the rider reads.
    expect(queued?.['location']).toMatchObject({
      zone: 'Gounghin',
      landmark: 'Face à la pharmacie du marché',
      maskedRelay: 'relay-compose-1',
    });
  });

  it('REPLAY of the same command composes NO second task — one order, one attempt', async () => {
    const again = await call(mf, 'POST', '/ops/task', opsAuth, {
      command_id: 'cmd-compose-ok',
      orderId: ORDER,
      location: LOCATION,
      window: WINDOW,
    });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, duplicate: true });
    const board = await call(mf, 'GET', '/ops/board', opsAuth);
    const forOrder = ((board.json['board'] as Json)['queued'] as Json[]).filter((q) => q['orderId'] === ORDER);
    expect(forOrder).toHaveLength(1);
  });

  it('A HALF-GIVEN ADDRESS IS REFUSED 400 — never a task with a guessed pin or an empty relay', async () => {
    const cases: Json[] = [
      { ...LOCATION, pin: undefined },
      { ...LOCATION, pin: { lat: 'douze', lng: -1.5 } },
      { ...LOCATION, maskedRelay: '' },
      { ...LOCATION, directions: '   ' },
    ];
    for (const location of cases) {
      const res = await call(mf, 'POST', '/ops/task', opsAuth, {
        command_id: `cmd-compose-bad-${JSON.stringify(location).length}`,
        orderId: ORDER,
        location,
        window: WINDOW,
      });
      expect(res.status, JSON.stringify(location)).toBe(400);
    }
    // …and a malformed window is refused the same way.
    expect(
      (await call(mf, 'POST', '/ops/task', opsAuth, {
        command_id: 'cmd-compose-badwin',
        orderId: ORDER,
        location: LOCATION,
        window: { start: 'demain', end: WINDOW.end },
      })).status,
    ).toBe(400);
  });

  it('the ops door gates it: composing without the founder’s key is the uniform 401', async () => {
    const res = await call(mf, 'POST', '/ops/task', intakeAuth, {
      command_id: 'cmd-compose-crossed',
      orderId: ORDER,
      location: LOCATION,
      window: WINDOW,
    });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'unauthorized' });
  });

  it('/ops/a-preparer lists what is waiting for him — funded AND ready AND task-less, nothing else', async () => {
    const waiting = 'order-compose-waiting';
    await fundOrder(mf, waiting);
    await readyOrder(mf, waiting);
    // a funded-but-unprepared order must NOT appear
    await fundOrder(mf, 'order-compose-halfway');

    const res = await call(mf, 'GET', '/ops/a-preparer', opsAuth);
    expect(res.status).toBe(200);
    const rows = res.json['attente'] as Json[];
    const ids = rows.map((r) => r['orderId']);
    expect(ids).toContain(waiting);
    // ORDER already has its task, so it has left the list…
    expect(ids).not.toContain(ORDER);
    // …and the half-vouched order never entered it.
    expect(ids).not.toContain('order-compose-halfway');
    expect(rows.find((r) => r['orderId'] === waiting)).toMatchObject({ paymentMode: 'FULL_PREPAY' });
  });
});

/**
 * ═══ SE-LIVE-2c VERIFIER ROUND — THE ID AND THE ORDER ARE CLAIMED ONCE ═══
 *
 * A fresh-context verifier drove the first cut on this runtime: pasting the
 * id of a LIVE, ASSIGNED task into `/ops/task` overwrote that queue row with
 * another order's address, re-queued the task for a second custodian, and
 * left the assigned rider's own screen pointing at a stranger's door. These
 * pin the two fixes — the id is never the caller's, and one order gets one
 * open task — at BOTH layers (the door, and the shared queue beneath it).
 */
describe('SE-LIVE-2c verifier round — no id hijack, no second task for one order', () => {
  const ORDER = 'order-hijack-victim';
  const OTHER = 'order-hijack-other';
  const LOC = {
    pin: { lat: 12.3714, lng: -1.5197 },
    zone: 'Gounghin',
    landmark: 'Face à la pharmacie',
    directions: 'Porte bleue',
    maskedRelay: 'relay-victim',
  };
  const WIN = { start: T, end: '2026-08-06T14:00:00.000Z' };
  let victimTaskId = '';

  it('sets the stage: a composed, ASSIGNED task with a rider on it', async () => {
    await fundOrder(mf, ORDER);
    await readyOrder(mf, ORDER);
    const composed = await call(mf, 'POST', '/ops/task', opsAuth, {
      command_id: 'cmd-hijack-1', orderId: ORDER, location: LOC, window: WIN,
    });
    expect(composed.status).toBe(200);
    victimTaskId = composed.json['taskId'] as string;
    await prepRider(mf, 'r-hijack');
    const granted = await call(mf, 'POST', '/ops/assign', opsAuth, {
      command_id: 'cmd-hijack-assign', taskId: victimTaskId, riderId: 'r-hijack',
    });
    expect(granted.status).toBe(200);
  });

  it('THE HIJACK IS REFUSED: a body carrying ANY taskId is 400 — the id is minted, never chosen', async () => {
    await fundOrder(mf, OTHER);
    await readyOrder(mf, OTHER);
    const hijack = await call(mf, 'POST', '/ops/task', opsAuth, {
      command_id: 'cmd-hijack-2',
      orderId: OTHER,
      taskId: victimTaskId, // the live task's id
      location: { ...LOC, zone: 'Dassasgho', landmark: 'AUTRE ADRESSE', maskedRelay: 'relay-other' },
      window: WIN,
    });
    expect(hijack.status).toBe(400);
    expect(hijack.json).toMatchObject({ reason: 'task_id_is_not_yours_to_choose' });

    // The victim is untouched: same order, same address, still assigned.
    const board = await call(mf, 'GET', '/ops/board', opsAuth);
    const b = board.json['board'] as Json;
    expect((b['assignments'] as Json[]).some((a) => a['taskId'] === victimTaskId)).toBe(true);
    expect((b['queued'] as Json[]).some((q) => q['taskId'] === victimTaskId)).toBe(false);
  });

  it('AND THE RIDER’S SCREEN STILL SHOWS THEIR OWN COURSE — the redirect the verifier demonstrated is gone', async () => {
    const codes = await call(mf, 'GET', '/ops/rider-codes', opsAuth);
    expect((codes.json['codes'] as Json[]).some((c) => c['riderId'] === 'r-hijack')).toBe(true);
    // Re-mint to read the rider's own view (the first code was consumed by prep).
    const mint = await call(mf, 'POST', '/ops/rider-code/mint', opsAuth, { riderId: 'r-hijack' });
    const moi = await call(mf, 'GET', '/rider/moi', codeAuth(mint.json['code'] as string));
    const assignment = (moi.json['rider'] as Json)['assignment'] as Json;
    expect(assignment['taskId']).toBe(victimTaskId);
    expect(assignment['orderId']).toBe(ORDER);
    expect(assignment['location']).toMatchObject({ zone: 'Gounghin', maskedRelay: 'relay-victim' });
  });

  it('ONE ORDER, ONE OPEN TASK: a second compose for the same order is 409 and names the task it already has', async () => {
    const second = await call(mf, 'POST', '/ops/task', opsAuth, {
      command_id: 'cmd-hijack-3', orderId: ORDER, location: LOC, window: WIN,
    });
    expect(second.status).toBe(409);
    expect(second.json).toMatchObject({ ok: false, reason: 'order_already_has_task', taskId: victimTaskId });
    // and the board still carries exactly one task for that order
    const board = await call(mf, 'GET', '/ops/board', opsAuth);
    const b = board.json['board'] as Json;
    const all = [...(b['queued'] as Json[]), ...(b['assignments'] as Json[])].filter((r) => r['orderId'] === ORDER);
    expect(all).toHaveLength(1);
  });

  it('THE QUEUE ITSELF refuses a colliding id, whatever the source — defense beneath the door', async () => {
    // Straight through the intake door, a DIFFERENT command naming the live id.
    const collide = await call(
      mf, 'POST', '/intake/task-ready', intakeAuth, readyEvent('cmd-collide-1', victimTaskId, OTHER),
    );
    expect(collide.status).toBe(422);
    expect(collide.json).toMatchObject({ reason: 'task_id_already_claimed' });
  });

  it('A PIN OFF THE GLOBE and a BACKWARDS WINDOW are refused 400', async () => {
    const bad = [
      { location: { ...LOC, pin: { lat: 91, lng: 0 } }, window: WIN },
      { location: { ...LOC, pin: { lat: 0, lng: 181 } }, window: WIN },
      { location: LOC, window: { start: WIN.end, end: WIN.start } },
    ];
    for (const [i, body] of bad.entries()) {
      const res = await call(mf, 'POST', '/ops/task', opsAuth, {
        command_id: `cmd-bad-geo-${i}`, orderId: OTHER, ...body,
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

/**
 * ═══ SE-LIVE-2c VERIFIER ROUND 2 — THE SMUGGLED REPLAY ═══
 *
 * Round 1's « one open task per order » rule exempted any command_id already
 * in the processed set. The verifier walked through it: a command admitted at
 * the INTAKE door under a FOREIGN correlation id made the ops route skip the
 * check, while `onTaskReady`'s replay lookup (which matches on correlation)
 * found nothing and admitted a second task — two open tasks for one order,
 * two riders reachable for one delivery. The exemption is now per-task
 * provenance, and this is that exact attack.
 */
describe('SE-LIVE-2c verifier round 2 — a foreign-correlation command cannot smuggle a second task', () => {
  const ORDER = 'order-smuggle';
  const SHARED_CMD = 'cmd-smuggle-shared';
  const LOC = {
    pin: { lat: 12.37, lng: -1.52 },
    zone: 'Gounghin',
    landmark: 'Repère',
    directions: 'Porte',
    maskedRelay: 'relay-smuggle',
  };
  const WIN = { start: T, end: '2026-08-06T14:00:00.000Z' };

  it('the attack: a task admitted at the intake door under a FOREIGN correlation, then that command replayed at /ops/task', async () => {
    await fundOrder(mf, ORDER);
    await readyOrder(mf, ORDER);
    // ① the intake door admits a task for this order, correlation NOT corr-{orderId}
    const smuggled = {
      ...readyEvent(SHARED_CMD, 'task-smuggle-1', ORDER),
      envelope: { ...readyEvent(SHARED_CMD, 'task-smuggle-1', ORDER).envelope, correlation_id: 'corr-SOMETHING-ELSE' },
    };
    expect((await call(mf, 'POST', '/intake/task-ready', intakeAuth, smuggled)).status).toBe(200);

    // ② the SAME command id at the ops door. Round 1 exempted the command and
    //    fell through to a FRESH admission — two open tasks. The invariant
    //    under test is not a status code, it is that NO SECOND TASK EXISTS:
    //    the route answers duplicate and names the task that already exists.
    const second = await call(mf, 'POST', '/ops/task', opsAuth, {
      command_id: SHARED_CMD, orderId: ORDER, location: LOC, window: WIN,
    });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ ok: true, duplicate: true });
    expect(second.json['taskId'], 'it must name the EXISTING task, never a new one').toBe('task-smuggle-1');

    // and the order still has exactly ONE open task
    const board = await call(mf, 'GET', '/ops/board', opsAuth);
    const b = board.json['board'] as Json;
    const open = [...(b['queued'] as Json[]), ...(b['assignments'] as Json[])].filter((r) => r['orderId'] === ORDER);
    expect(open, 'one order, one open task').toHaveLength(1);
  });

  it('AND THE HONEST REPLAY STILL WORKS: the ops route’s own command answers duplicate, never 409', async () => {
    const order = 'order-honest-replay';
    await fundOrder(mf, order);
    await readyOrder(mf, order);
    const cmd = 'cmd-honest-replay';
    const first = await call(mf, 'POST', '/ops/task', opsAuth, {
      command_id: cmd, orderId: order, location: LOC, window: WIN,
    });
    expect(first.status).toBe(200);
    const replay = await call(mf, 'POST', '/ops/task', opsAuth, {
      command_id: cmd, orderId: order, location: LOC, window: WIN,
    });
    expect(replay.status, 'idempotency must survive the per-task exemption').toBe(200);
    expect(replay.json).toMatchObject({ ok: true, duplicate: true });
    expect(replay.json['taskId']).toBe(first.json['taskId']);
  });
});

/**
 * ⚠ SE-LIVE-4b-ii — THE `/verify/` DOOR HAS ITS OWN KEY, AND IT WAS UNPINNED.
 *
 * Caught by mutation, not by review: deleting the authorization check from
 * `/verify/` left all 134 logistics tests green. An unauthenticated route here
 * is a public oracle for « is this string a live rider code » — brute-forceable
 * at whatever rate the internet allows, against the credential that opens the
 * custody seal in SE-LIVE-4b-ii.
 *
 * The key is ALSO neither the ops secret nor the intake secret: each caller
 * holds exactly the door it needs, the discipline `/intake/` set.
 */
describe('the rider-code verification door (SE-LIVE-4b-ii)', () => {
  it('needs its own key, resolves a live code, and refuses a revoked one identically', async () => {
    const rider = 'rider-verify-door-0001';
    const code = await prepRider(mf, rider);
    const verifyAuth = { Authorization: `Bearer ${VERIFY}`, 'Content-Type': 'application/json' };

    // No key, a wrong key, and the OTHER doors' keys all refuse — identically.
    const refusals: string[] = [];
    for (const headers of [
      { 'Content-Type': 'application/json' },
      { Authorization: 'Bearer nope', 'Content-Type': 'application/json' },
      opsAuth,
      intakeAuth,
    ]) {
      const res = await mf.dispatchFetch('http://logistics/verify/rider-code', {
        method: 'POST', headers, body: JSON.stringify({ code }),
      });
      expect(res.status).toBe(401);
      refusals.push(await res.text());
    }
    expect(new Set(refusals).size).toBe(1);

    // With its own key it answers, and answers ONLY the riderId — no shift, no
    // assignment, no roster row. Custody has no business knowing the rest.
    const ok = await call(mf, 'POST', '/verify/rider-code', verifyAuth, { code });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ ok: true, riderId: rider });

    // A code the book does not know gets the SAME uniform 401 — « unknown »
    // must not be distinguishable from « revoked ».
    const unknown = await mf.dispatchFetch('http://logistics/verify/rider-code', {
      method: 'POST', headers: verifyAuth, body: JSON.stringify({ code: 'SR-ZZZZ-ZZZZ-ZZZZ' }),
    });
    expect(unknown.status).toBe(401);
    expect(await unknown.text()).toBe(refusals[0]);

    // …and once revoked, the live code joins them. ONE BOOK: the code dies for
    // custody at the same instant it dies for the rider door.
    expect((await call(mf, 'POST', '/ops/rider-code/revoke', opsAuth, { riderId: rider })).status).toBe(200);
    const after = await mf.dispatchFetch('http://logistics/verify/rider-code', {
      method: 'POST', headers: verifyAuth, body: JSON.stringify({ code }),
    });
    expect(after.status).toBe(401);
    expect(await after.text()).toBe(refusals[0]);
    expect((await call(mf, 'GET', '/rider/moi', codeAuth(code))).status).toBe(401);
  });
});

/**
 * ═══ RB-2 — THE BOUTIK+ COMMANDES TAB'S DISPATCH, wire-for-wire ═══
 *
 * The Boutik+ « Confier à un coursier » fold sends EXACTLY these bodies
 * (apps/supplier-app/src/commandes/sera-service.ts — deterministic command
 * ids `cmd-boutik-tache-{orderId}` / `cmd-boutik-confier-{taskId}-{riderId}`).
 * This suite is that port's contract-certification: the same bytes against
 * the REAL Worker, walked to the one screen that matters at the end — the
 * RIDER'S OWN /rider/moi carrying the founder's address verbatim.
 */
describe('RB-2 — the founder dispatches from Boutik+: compose → assign → the rider SEES it', () => {
  const ORDER = 'order-rb2-boutik-1';
  const BODY = {
    command_id: `cmd-boutik-tache-${ORDER}`,
    orderId: ORDER,
    location: {
      pin: { lat: 12.3714, lng: -1.5197 },
      zone: 'Gounghin',
      landmark: 'Face à la pharmacie du marché',
      directions: 'Deuxième porte bleue après le kiosque',
      maskedRelay: 'relais-1',
    },
    window: { start: T, end: '2026-08-06T14:00:00.000Z' },
  };

  it('the whole road, with the tab’s exact bytes', async () => {
    await fundOrder(mf, ORDER);
    await readyOrder(mf, ORDER);

    // ── compose (the tab’s body) ─────────────────────────────────────────
    const composed = await call(mf, 'POST', '/ops/task', opsAuth, BODY);
    expect(composed.status, JSON.stringify(composed.json)).toBe(200);
    const taskId = composed.json['taskId'] as string;

    // A DOUBLE-TAP REPLAYS, never a second task: same deterministic command.
    const again = await call(mf, 'POST', '/ops/task', opsAuth, BODY);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ duplicate: true, taskId });

    // ── the board offers a FREE rider (the tab’s picker read) ────────────
    const code = await prepRider(mf, 'rider-rb2-boutik');
    const board = await call(mf, 'GET', '/ops/board', opsAuth);
    const riders = (board.json['board'] as Json)['riders'] as Json[];
    const libre = riders.find((r) => r['riderId'] === 'rider-rb2-boutik');
    expect(libre?.['assignable'], 'on shift, unloaded — the picker must offer them').toBe(true);

    // ── assign (the tab’s body) ──────────────────────────────────────────
    const assigned = await call(mf, 'POST', '/ops/assign', opsAuth, {
      command_id: `cmd-boutik-confier-${taskId}-rider-rb2-boutik`,
      taskId,
      riderId: 'rider-rb2-boutik',
    });
    expect(assigned.status, JSON.stringify(assigned.json)).toBe(200);

    // ── ⚠ THE POINT OF THE WHOLE SLICE: the rider’s own app read carries
    //     the mission, with the founder’s address VERBATIM ────────────────
    const moi = await call(mf, 'GET', '/rider/moi', codeAuth(code));
    expect(moi.status).toBe(200);
    const mission = (moi.json['rider'] as Json)['assignment'] as Json;
    expect(mission).not.toBeNull();
    expect(mission['taskId']).toBe(taskId);
    expect(mission['orderId']).toBe(ORDER);
    expect(mission['location']).toMatchObject({
      zone: 'Gounghin',
      landmark: 'Face à la pharmacie du marché',
      directions: 'Deuxième porte bleue après le kiosque',
    });

    // ── the fold's double-tap on « Confier »: the SAME deterministic command
    //     replays as duplicate — one grant, however many taps ─────────────
    const retap = await call(mf, 'POST', '/ops/assign', opsAuth, {
      command_id: `cmd-boutik-confier-${taskId}-rider-rb2-boutik`,
      taskId,
      riderId: 'rider-rb2-boutik',
    });
    expect(retap.status).toBe(200);
    expect(retap.json).toMatchObject({ duplicate: true });
    // NOTE, journaled with the slice: a GRANTED-but-unacked rider still reads
    // `assignable` on the board (the lease law — a grant can expire or be
    // declined, and an invisible granted rider would strand tasks). The
    // picker may therefore offer them; a second GRANT refuses 409 at the
    // authority (proven above under 20-way concurrency), and the fold speaks
    // that refusal by name. Asserted here so the UI claim matches the LAW.
    const after = await call(mf, 'GET', '/ops/board', opsAuth);
    const busy = ((after.json['board'] as Json)['riders'] as Json[]).find(
      (r) => r['riderId'] === 'rider-rb2-boutik',
    );
    expect(busy?.['assignable'], 'granted-not-acked still reads assignable — the lease law').toBe(true);
  }, 60_000);
});
