import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * ═══ SE-LIVE-4d · THE SOS WIRE, on the real runtime ═══
 *
 * FOUNDER ORDER (2026-08-07): « Build the SOS wire. »
 *
 * The rider app has carried the SOS gesture since WO-6.3 and **no server ever
 * received it** — the raise went to the app's demo store while the screen said
 * « Alerte envoyée ». These tests pin the wire that makes that sentence true,
 * and the honesty laws around it:
 *
 *   · the alert is filed under the RIDER'S OWN identity, from their code;
 *   · one press is one incident, however many times the outbox retries;
 *   · a rider can never acknowledge their own alert;
 *   · an ack is never invented for an alert nobody raised;
 *   · an open incident is never aged out (SE7.1, « persistent until ack »);
 *   · it SURVIVES A RESTART — an emergency that evaporates is worse than none.
 */

const OPS = 'test-ops-sos';
const INTAKE = 'test-intake-sos';
const VERIFY = 'test-verify-sos';
const opsAuth = { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' };
const codeAuth = (code: string) => ({ Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' });

const boot = (persist: string) =>
  new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: persist,
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY },
  });

type Json = Record<string, unknown>;
let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});
const spawn = (dir: string): Miniflare => {
  const mf = boot(dir);
  live.push(mf);
  return mf;
};

async function call(mf: Miniflare, method: string, path: string, headers: Json, body?: unknown) {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method,
    headers: headers as Record<string, string>,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { json = { __raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

/** A registered rider holding their own personal code. */
async function riderWithCode(mf: Miniflare, riderId: string): Promise<string> {
  // `phoneAlias` is required — the phone is ALWAYS an alias in this system.
  await call(mf, 'POST', '/ops/riders', opsAuth, { riderId, displayName: riderId, phoneAlias: `alias-${riderId}` });
  const minted = await call(mf, 'POST', '/ops/rider-code/mint', opsAuth, { riderId });
  expect(minted.status).toBe(200);
  return minted.json['code'] as string;
}

const raise = (mf: Miniflare, code: string, body: Json) =>
  call(mf, 'POST', '/rider/sos', codeAuth(code), body);

describe('a rider in trouble reaches the server', () => {
  it('records the alert under the identity the CODE proves, not the body', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sos-identity-'));
    const mf = spawn(dir);
    const code = await riderWithCode(mf, 'rider-issa');

    // The body names someone else entirely — it must be ignored.
    const res = await raise(mf, code, {
      command_id: 'cmd-1',
      riderId: 'rider-SOMEONE-ELSE',
      hours: 'in_hours',
      onShift: true,
      activeCourseId: 'course-1',
      raisedAt: '2026-08-07T10:00:00.000Z',
    });
    expect(res.status).toBe(200);
    const incident = res.json['incident'] as Json;
    // An alert filed under the wrong name sends help to the wrong person.
    expect(incident['riderId']).toBe('rider-issa');
    expect(incident['state']).toBe('open');
    expect(incident['activeCourseId']).toBe('course-1');
    expect(res.json['event']).toBe('safety.sos_created.v1');
  });

  it('⚠ one press is ONE incident, however many times the outbox retries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sos-once-'));
    const mf = spawn(dir);
    const code = await riderWithCode(mf, 'rider-issa');
    const body = { command_id: 'cmd-same', riderId: 'rider-issa', hours: 'in_hours', onShift: true, raisedAt: 'T' };

    const first = await raise(mf, code, body);
    expect(first.json['duplicate']).toBe(false);
    // The app persists the command_id once at the gesture and replays it.
    for (let i = 0; i < 4; i += 1) {
      const again = await raise(mf, code, body);
      expect(again.status).toBe(200);
      expect(again.json['duplicate']).toBe(true);
      // The FIRST incident is returned, untouched — not a rewrite.
      expect((again.json['incident'] as Json)['receivedAt'])
        .toBe((first.json['incident'] as Json)['receivedAt']);
    }
    // A rider pressing again in fear must not flood the dispatcher's board.
    const board = (await call(mf, 'GET', '/ops/sos', opsAuth)).json['incidents'] as Json[];
    expect(board).toHaveLength(1);
  });

  it('an off-shift rider in danger is still heard', async () => {
    // No shift check, deliberately: danger does not wait for a shift.
    const dir = mkdtempSync(join(tmpdir(), 'sos-offshift-'));
    const mf = spawn(dir);
    const code = await riderWithCode(mf, 'rider-issa');
    const res = await raise(mf, code, { command_id: 'c', riderId: 'rider-issa', hours: 'out_of_hours', onShift: false });
    expect(res.status).toBe(200);
    const incident = res.json['incident'] as Json;
    expect(incident['state']).toBe('open');
    expect(incident['onShift']).toBe(false);
    expect(incident['hours']).toBe('out_of_hours');
  });

  it('a phone with no clock still gets recorded — the server stamps its own', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sos-clock-'));
    const mf = spawn(dir);
    const code = await riderWithCode(mf, 'rider-issa');
    const res = await raise(mf, code, { command_id: 'c', riderId: 'rider-issa' });
    expect(res.status).toBe(200);
    const incident = res.json['incident'] as Json;
    // `receivedAt` is the server's, always — the board must not sort an
    // emergency to the bottom because a handset's date is wrong.
    expect(typeof incident['receivedAt']).toBe('string');
    expect(String(incident['receivedAt']).length).toBeGreaterThan(0);
  });

  it('a stranger with no code reaches nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sos-stranger-'));
    const mf = spawn(dir);
    await riderWithCode(mf, 'rider-issa');
    const res = await raise(mf, 'NOT-A-REAL-CODE', { command_id: 'c', riderId: 'rider-issa' });
    expect(res.status).toBe(401);
    expect((await call(mf, 'GET', '/ops/sos', opsAuth)).json['incidents']).toHaveLength(0);
  });
});

describe('the ack is a human act, and only the founder’s', () => {
  it('⚠ a rider cannot acknowledge their own alert', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sos-selfack-'));
    const mf = spawn(dir);
    const code = await riderWithCode(mf, 'rider-issa');
    await raise(mf, code, { command_id: 'cmd-1', riderId: 'rider-issa' });

    // The rider's own code on the ops door: refused, like any other key.
    const selfAck = await call(mf, 'POST', '/ops/sos/ack', codeAuth(code), { command_id: 'cmd-1', by: 'rider-issa' });
    expect(selfAck.status).toBe(401);
    // …and there is no rider-door route that acks either.
    const viaRiderDoor = await call(mf, 'POST', '/rider/sos/ack', codeAuth(code), { command_id: 'cmd-1' });
    expect(viaRiderDoor.status).toBe(404);

    // The incident is still OPEN — nobody has answered it.
    const board = (await call(mf, 'GET', '/ops/sos', opsAuth)).json['incidents'] as Json[];
    expect(board[0]?.['state']).toBe('open');
  });

  it('the founder answers, and the record says who and how long it took', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sos-ack-'));
    const mf = spawn(dir);
    const code = await riderWithCode(mf, 'rider-issa');
    await raise(mf, code, { command_id: 'cmd-1', riderId: 'rider-issa' });

    const ack = await call(mf, 'POST', '/ops/sos/ack', opsAuth, { command_id: 'cmd-1', by: 'founder' });
    expect(ack.status).toBe(200);
    const incident = ack.json['incident'] as Json;
    expect(incident['state']).toBe('acknowledged');
    expect(incident['acknowledgedBy']).toBe('founder');
    expect(ack.json['event']).toBe('safety.sos_acknowledged.v1');
    // The drill measures against this; it is a number only once answered.
    expect(typeof ack.json['ackSeconds']).toBe('number');
  });

  it('⚠ an ack for an alert nobody raised is REFUSED, never invented', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sos-phantom-'));
    const mf = spawn(dir);
    const res = await call(mf, 'POST', '/ops/sos/ack', opsAuth, { command_id: 'never-happened', by: 'founder' });
    expect(res.status).toBe(404);
    expect(res.json['reason']).toBe('unknown_incident');
    // An ack must not conjure the emergency it claims to answer.
    expect((await call(mf, 'GET', '/ops/sos', opsAuth)).json['incidents']).toHaveLength(0);
  });

  it('the first responder keeps the record — a second ack does not rewrite it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sos-reack-'));
    const mf = spawn(dir);
    const code = await riderWithCode(mf, 'rider-issa');
    await raise(mf, code, { command_id: 'cmd-1', riderId: 'rider-issa' });
    const first = await call(mf, 'POST', '/ops/sos/ack', opsAuth, { command_id: 'cmd-1', by: 'dispatcher-A' });
    const second = await call(mf, 'POST', '/ops/sos/ack', opsAuth, { command_id: 'cmd-1', by: 'dispatcher-B' });
    expect(second.json['duplicate']).toBe(true);
    expect((second.json['incident'] as Json)['acknowledgedBy']).toBe('dispatcher-A');
    expect((second.json['incident'] as Json)['acknowledgedAt'])
      .toBe((first.json['incident'] as Json)['acknowledgedAt']);
  });

  it('an open alert is never aged out, and stays above the answered ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sos-order-'));
    const mf = spawn(dir);
    const code = await riderWithCode(mf, 'rider-issa');
    await raise(mf, code, { command_id: 'cmd-old', riderId: 'rider-issa' });
    await call(mf, 'POST', '/ops/sos/ack', opsAuth, { command_id: 'cmd-old', by: 'founder' });
    await raise(mf, code, { command_id: 'cmd-new', riderId: 'rider-issa' });

    const board = (await call(mf, 'GET', '/ops/sos', opsAuth)).json['incidents'] as Json[];
    expect(board).toHaveLength(2);
    // SE7.1 — persistent signal until ack: the unanswered one is first.
    expect(board[0]?.['commandId']).toBe('cmd-new');
    expect(board[0]?.['state']).toBe('open');
    expect(board[0]?.['ackSeconds']).toBeNull();
    // The answered one stays readable so the drill can measure it.
    expect(board[1]?.['commandId']).toBe('cmd-old');
    expect(typeof board[1]?.['ackSeconds']).toBe('number');
  });
});

describe('an emergency survives the machine', () => {
  it('⚠ an unanswered alert is still there after a restart', async () => {
    // An SOS that evaporates on a redeploy is worse than no SOS: the rider
    // believes it was received, and it is gone.
    const dir = mkdtempSync(join(tmpdir(), 'sos-restart-'));
    const first = spawn(dir);
    const code = await riderWithCode(first, 'rider-issa');
    await raise(first, code, { command_id: 'cmd-durable', riderId: 'rider-issa', activeCourseId: 'course-9' });
    await first.dispose();
    live = live.filter((m) => m !== first);

    const second = spawn(dir);
    const board = (await call(second, 'GET', '/ops/sos', opsAuth)).json['incidents'] as Json[];
    expect(board).toHaveLength(1);
    expect(board[0]?.['commandId']).toBe('cmd-durable');
    expect(board[0]?.['state']).toBe('open');
    expect(board[0]?.['activeCourseId']).toBe('course-9');
  });
});
