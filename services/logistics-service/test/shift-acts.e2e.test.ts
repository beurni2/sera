import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';
import { onShiftFromSession } from '../../../apps/rider-app/src/net/rider-session';

/**
 * ═══ COURSIER-EN-SERVICE — the road to an ASSIGNABLE rider, end to end ═══
 *
 * ⚠ WHY THIS EXISTS (founder report, 2026-08-08). He registered a real rider,
 * gave them a code, opened « Confier à un coursier » and hit « Aucun coursier
 * libre » — for ever. SE1's ladder (certified → privacy ack → shift start,
 * server-confirmed) was fully built on this Worker and CLIMBABLE BY NOBODY:
 * `/ops/riders/certify` had no client anywhere, and the rider app carried no
 * call site for `/rider/ack-privacy` or `/rider/shift/start`. Every green test
 * on both sides proved every part while the whole was dead — the exact
 * « a port that exists is not a port that is called » failure.
 *
 * So this drives the RIDER APP'S OWN PORTS (`httpShiftActs`,
 * `httpRiderSession`) against the REAL Worker, climbs the whole ladder, and
 * asks the BOARD — the same `assignable` field the founder's confier screen
 * filters on — for the outcome. The console's certify act is exercised against
 * its real route contract (`POST /ops/riders/certify`); its client lives in
 * the Boutik+ repo with its own tests.
 */

const OPS = 'test-ops-shift-acts';
const INTAKE = 'test-intake-shift-acts';
const VERIFY = 'test-verify-shift-acts';

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
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'shift-acts-')),
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY },
  });
  live.push(mf);
  return mf;
}

async function ops(mf: Miniflare, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

/** The board as the founder's dispatch screen reads it. */
async function boardRider(mf: Miniflare, riderId: string): Promise<Record<string, unknown>> {
  const res = await mf.dispatchFetch('http://logistics/ops/board', {
    headers: { Authorization: `Bearer ${OPS}` },
  });
  const json = (await res.json()) as { board: { riders: Record<string, unknown>[] } };
  const rider = json.board.riders.find((r) => r['riderId'] === riderId);
  expect(rider, `rider ${riderId} missing from the board`).toBeDefined();
  return rider as Record<string, unknown>;
}

/** The app's ports, pointed at the Worker exactly as the app points them. */
function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return {
    acts: httpShiftActs('http://logistics', net, fetchFn),
    session: httpRiderSession('http://logistics', net, fetchFn),
    net,
  };
}

describe('⚠ the whole ladder, through the app’s own ports, judged by the BOARD', () => {
  it('register → certify (console contract) → ack → start → the board says assignable: true', async () => {
    const mf = spawn();
    await ops(mf, '/ops/riders', { riderId: 'rider-boss', displayName: 'boss', phoneAlias: 'bossy' });
    const code = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-boss' }))['code'] as string;
    const { acts, session } = appPorts(mf);

    // The founder's exact starting point: registered, coded — and the board
    // already says why nothing can be confided to them.
    expect(await boardRider(mf, 'rider-boss')).toMatchObject({ certified: false, assignable: false });

    // Rung 0 — the app SEES the missing certification (the screen's honest card).
    const before = await session.signIn(code);
    if (!before.ok) throw new Error('sign-in refused');
    expect(before.session.certified).toBe(false);

    // Rung 1 — certification, the founder's console act, on its real route.
    const certified = await ops(mf, '/ops/riders/certify', { riderId: 'rider-boss', certified: true });
    expect(certified['ok']).toBe(true);

    // Rung 2 — the privacy ack, from the rider's own hand.
    expect(await acts.ackPrivacy(code)).toEqual({ ok: true });

    // Rung 3 — « Prendre la route ». The 200 carries the REGISTRY'S state and
    // the app's own reader calls it on-shift.
    const started = await acts.startShift(code);
    if (!started.ok) throw new Error(`start refused: ${JSON.stringify(started)}`);
    expect(onShiftFromSession(started.shift)).toBe(true);

    // THE VERDICT belongs to the board — the very field confier filters on.
    expect(await boardRider(mf, 'rider-boss')).toMatchObject({ certified: true, assignable: true });

    // And /rider/moi tells the app the same truth on its next refresh.
    const after = await session.signIn(code);
    if (!after.ok) throw new Error('refresh refused');
    expect(onShiftFromSession(after.session.shift)).toBe(true);

    // « Finir la route » undoes exactly the shift — never the certification.
    const ended = await acts.endShift(code);
    if (!ended.ok) throw new Error('end refused');
    expect(onShiftFromSession(ended.shift)).toBe(false);
    expect(await boardRider(mf, 'rider-boss')).toMatchObject({ certified: true, assignable: false });
  });

  it('every rung refuses BY NAME below its prerequisite — the ladder cannot be skipped', async () => {
    const mf = spawn();
    await ops(mf, '/ops/riders', { riderId: 'rider-awa', displayName: 'Awa', phoneAlias: 'a-1' });
    const code = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-awa' }))['code'] as string;
    const { acts } = appPorts(mf);

    // Uncertified: the start refuses with the certification's own name.
    expect(await acts.startShift(code)).toEqual({ ok: false, reason: 'refused', refus: 'not_certified' });

    // Certified but no privacy ack: refused by ITS name — never a generic no.
    await ops(mf, '/ops/riders/certify', { riderId: 'rider-awa', certified: true });
    expect(await acts.startShift(code)).toEqual({
      ok: false, reason: 'refused', refus: 'privacy_notice_not_acknowledged',
    });

    // Ended without being on shift: the stale-screen refusal, named.
    await ops(mf, '/ops/riders/certify', { riderId: 'rider-awa', certified: true });
    expect(await acts.endShift(code)).toEqual({ ok: false, reason: 'refused', refus: 'not_on_shift' });

    // A dead code is the ONE « unauthorized » — never confused with a refusal.
    expect(await acts.startShift('SR-AAAA-BBBB-CCCC')).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('⚠ COURSE-BRIEF: the repère voice note and the supplier’s proof photos reach the RIDER’S OWN session read', async () => {
    // FOUNDER REPORT (2026-08-09): « on rider's app sera when order arrives on
    // the screen there is nowhere to listen the repère audio … and when I
    // relay the order to the rider it has to carry as well the proof photos
    // that the supplier sent ». Neither ever crossed: the compose door took an
    // address and a window, and `/rider/moi` sent back exactly that.
    //
    // This drives the FOUNDER'S OWN compose route and asks the RIDER APP'S OWN
    // session port for the answer — the only two ends that matter.
    const mf = spawn();
    const T = '2026-08-09T10:00:00.000Z';
    const intake = async (path: string, body: unknown) => {
      const res = await mf.dispatchFetch(`http://logistics${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status, path).toBe(200);
    };
    await intake('/intake/funding', { orderId: 'ord-brief-1', status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
    await intake('/intake/readiness', { orderId: 'ord-brief-1', ready: true, asOf: T });

    const AUDIO = 'media/11111111-2222-3333-4444-555555555555';
    const PHOTO = 'media/readiness/ord-brief-1';
    const composed = await ops(mf, '/ops/task', {
      command_id: 'cmd-brief-1',
      orderId: 'ord-brief-1',
      location: { zone: 'Gounghin', landmark: 'Face à la pharmacie', directions: '', maskedRelay: '' },
      window: { start: T, end: '2026-08-09T16:00:00.000Z' },
      repereAudioRef: AUDIO,
      preuvePhotoRefs: [PHOTO],
    });
    expect(composed['ok'], JSON.stringify(composed)).toBe(true);
    const taskId = composed['taskId'] as string;

    await ops(mf, '/ops/riders', { riderId: 'rider-boss', displayName: 'boss', phoneAlias: 'bossy' });
    await ops(mf, '/ops/riders/certify', { riderId: 'rider-boss', certified: true });
    const code = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-boss' }))['code'] as string;
    const { acts, session } = appPorts(mf);
    await acts.ackPrivacy(code);
    if (!(await acts.startShift(code)).ok) throw new Error('start refused');
    const granted = await ops(mf, '/ops/assign', { command_id: 'cmd-brief-a1', taskId, riderId: 'rider-boss' });
    expect(granted['ok'], JSON.stringify(granted)).toBe(true);

    // ⚠ THE WHOLE POINT: the app's OWN parser hands the screen both pointers.
    const arrived = await session.signIn(code);
    if (!arrived.ok) throw new Error('sign-in refused');
    expect(arrived.session.assignment?.repereAudioRef, 'the voice note must reach the rider').toBe(AUDIO);
    expect(arrived.session.assignment?.preuvePhotoRefs, 'the proof photos must reach the rider').toEqual([PHOTO]);
  });

  it('⚠ COURSE-BRIEF: a course composed WITHOUT media answers an honest empty brief, and a bad ref is refused BY NAME', async () => {
    const mf = spawn();
    const T = '2026-08-09T10:00:00.000Z';
    const intake = async (path: string, body: unknown) => {
      const res = await mf.dispatchFetch(`http://logistics${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status, path).toBe(200);
    };
    await intake('/intake/funding', { orderId: 'ord-brief-2', status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
    await intake('/intake/readiness', { orderId: 'ord-brief-2', ready: true, asOf: T });
    const loc = { zone: 'Gounghin', landmark: 'Face à la pharmacie', directions: '', maskedRelay: '' };
    const win = { start: T, end: '2026-08-09T16:00:00.000Z' };

    // A ref that could escape the media bucket ends the compose — refused, not
    // quietly dropped, so a founder never believes a photo travelled.
    for (const bad of ['https://elsewhere.example/x.jpg', 'media/../secrets', '', 'notmedia/x']) {
      const res = await mf.dispatchFetch('http://logistics/ops/task', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command_id: `cmd-bad-${bad}`, orderId: 'ord-brief-2', location: loc, window: win, repereAudioRef: bad }),
      });
      expect(res.status, bad).toBe(400);
      expect((await res.json() as Record<string, unknown>)['reason'], bad).toBe('repere_audio_ref_malformed');
    }
    // More photos than a rider can read at a market stall is also refused.
    const tooMany = await mf.dispatchFetch('http://logistics/ops/task', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command_id: 'cmd-many', orderId: 'ord-brief-2', location: loc, window: win,
        preuvePhotoRefs: ['media/a', 'media/b', 'media/c', 'media/d', 'media/e'],
      }),
    });
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json() as Record<string, unknown>)['reason']).toBe('preuve_photo_refs_malformed');

    // And the lawful absence: composed with no media at all, the rider's read
    // is an honest empty brief — never a fabricated one.
    const composed = await ops(mf, '/ops/task', { command_id: 'cmd-brief-2', orderId: 'ord-brief-2', location: loc, window: win });
    expect(composed['ok'], JSON.stringify(composed)).toBe(true);
    await ops(mf, '/ops/riders', { riderId: 'rider-awa', displayName: 'Awa', phoneAlias: 'awa' });
    await ops(mf, '/ops/riders/certify', { riderId: 'rider-awa', certified: true });
    const code = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-awa' }))['code'] as string;
    const { acts, session } = appPorts(mf);
    await acts.ackPrivacy(code);
    await acts.startShift(code);
    await ops(mf, '/ops/assign', { command_id: 'cmd-brief-a2', taskId: composed['taskId'], riderId: 'rider-awa' });
    const arrived = await session.signIn(code);
    if (!arrived.ok) throw new Error('sign-in refused');
    expect(arrived.session.assignment?.repereAudioRef).toBeNull();
    expect(arrived.session.assignment?.preuvePhotoRefs).toEqual([]);
  });

  it('SERA-FLOW: the confided course REACHES the rider, is ACCEPTED by their own hand, and the carrier leaves the free list', async () => {
    const mf = spawn();
    // The order's facts arrive as they do in production — funding + readiness
    // through the intake door, then the task itself.
    const intake = async (path: string, body: unknown) => {
      const res = await mf.dispatchFetch(`http://logistics${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status, path).toBe(200);
      return (await res.json()) as Record<string, unknown>;
    };
    const T = '2026-08-09T10:00:00.000Z';
    await intake('/intake/funding', { orderId: 'ord-flow-1', status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
    await intake('/intake/readiness', { orderId: 'ord-flow-1', ready: true, asOf: T });
    await intake('/intake/task-ready', {
      name: 'logistics.task_ready.v1',
      envelope: {
        command_id: 'cmd-flow-t1', correlation_id: 'corr-ord-flow-1', aggregateVersion: 1,
        actor: 'shop-plus:commerce-core', serverTime: T, version: '1',
      },
      payload: {
        task: {
          type: 'delivery', id: 'task-flow-1', orderId: 'ord-flow-1',
          location: { zone: 'Gounghin', landmark: 'Face à la pharmacie du marché', directions: '', maskedRelay: '' },
          window: { start: T, end: '2026-08-09T16:00:00.000Z' }, status: 'ready',
        },
      },
    });

    // Boss climbs the whole ladder through the APP'S OWN ports.
    await ops(mf, '/ops/riders', { riderId: 'rider-boss', displayName: 'boss', phoneAlias: 'bossy' });
    await ops(mf, '/ops/riders/certify', { riderId: 'rider-boss', certified: true });
    const code = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-boss' }))['code'] as string;
    const { acts, session } = appPorts(mf);
    await acts.ackPrivacy(code);
    const started = await acts.startShift(code);
    if (!started.ok) throw new Error('start refused');
    expect(await boardRider(mf, 'rider-boss')).toMatchObject({ assignable: true });

    // The founder confides — the same /ops/assign contract confier calls.
    const granted = await ops(mf, '/ops/assign', { command_id: 'cmd-flow-a1', taskId: 'task-flow-1', riderId: 'rider-boss' });
    expect(granted['ok']).toBe(true);
    const assignmentId = (granted['assignment'] as Record<string, unknown>)['assignmentId'] as string;

    // ⚠ THE FOUNDER'S REPORT, CLOSED TWICE OVER:
    // (1) « nothing shows on the sera app » — the app's own session read now
    //     carries the course, as a PROPOSAL awaiting his yes;
    const proposed = await session.signIn(code);
    if (!proposed.ok) throw new Error('sign-in refused');
    expect(proposed.session.assignment).toMatchObject({ assignmentId, orderId: 'ord-flow-1', status: 'active_unacknowledged' });
    expect(proposed.session.assignment?.ackDeadline).not.toBeNull();
    // (2) « it's still showing confier à boss on other products » — a carrier
    //     is no longer on the free list, by the board's own word.
    expect(await boardRider(mf, 'rider-boss')).toMatchObject({ certified: true, assignable: false });

    // The ACCEPT, from the rider's own hand — then the session says acknowledged.
    expect(await acts.accepterCourse(code, assignmentId)).toEqual({ ok: true });
    const accepted = await session.signIn(code);
    if (!accepted.ok) throw new Error('refresh refused');
    expect(accepted.session.assignment?.status).toBe('acknowledged');

    // Accepting twice, or a course that is not yours: refused BY NAME.
    expect(await acts.accepterCourse(code, assignmentId)).toEqual({ ok: false, reason: 'refused', refus: 'not_active' });
    expect(await acts.accepterCourse(code, 'as-nowhere')).toEqual({ ok: false, reason: 'refused', refus: 'unknown_assignment' });
  });

  it('RELAIS-REPRISE: after an expiry, the SAME confier command grants a NEW course that reaches the rider', async () => {
    const mf = spawn();
    const intake = async (path: string, body: unknown) => {
      const res = await mf.dispatchFetch(`http://logistics${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status, path).toBe(200);
    };
    const T = '2026-08-09T10:00:00.000Z';
    await intake('/intake/funding', { orderId: 'ord-rr-1', status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
    await intake('/intake/readiness', { orderId: 'ord-rr-1', ready: true, asOf: T });
    await intake('/intake/task-ready', {
      name: 'logistics.task_ready.v1',
      envelope: {
        command_id: 'cmd-rr-t1', correlation_id: 'corr-ord-rr-1', aggregateVersion: 1,
        actor: 'shop-plus:commerce-core', serverTime: T, version: '1',
      },
      payload: {
        task: {
          type: 'delivery', id: 'task-rr-1', orderId: 'ord-rr-1',
          location: { zone: 'Gounghin', landmark: 'Face à la mosquée', directions: '', maskedRelay: '' },
          window: { start: T, end: '2026-08-09T16:00:00.000Z' }, status: 'ready',
        },
      },
    });
    await ops(mf, '/ops/riders', { riderId: 'rider-boss', displayName: 'boss', phoneAlias: 'bossy', certified: true });
    const code = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-boss' }))['code'] as string;
    const { acts, session } = appPorts(mf);
    await acts.ackPrivacy(code);
    await acts.startShift(code);

    // ⚠ THE FOUNDER'S EXACT TAPS. The confier fold's command id is
    // deterministic per (task, rider) — this is that byte-for-byte shape.
    const CONFIER_CMD = 'cmd-boutik-confier-task-rr-1-rider-boss';
    const first = await ops(mf, '/ops/assign', { command_id: CONFIER_CMD, taskId: 'task-rr-1', riderId: 'rider-boss' });
    expect(first['ok']).toBe(true);
    const firstId = (first['assignment'] as Record<string, unknown>)['assignmentId'] as string;

    // The rider never answers; the ack window dies; the sweep returns the
    // course to the queue (the founder watching an old app build).
    const swept = await ops(mf, '/ops/expire-due', { nowIso: new Date(Date.now() + 6 * 60_000).toISOString() });
    expect((swept['requeued'] as Record<string, unknown>[]).some((a) => a['assignmentId'] === firstId)).toBe(true);

    // He taps « Confier à boss » AGAIN — same task, same rider, SAME command
    // id. Before this fix, both dedupe layers replayed the DEAD outcome:
    // « ok (duplicate) », no new lease, no new assignment, nothing on the
    // rider's phone, and the button honestly came back. Now: a NEW course.
    const second = await ops(mf, '/ops/assign', { command_id: CONFIER_CMD, taskId: 'task-rr-1', riderId: 'rider-boss' });
    expect(second['ok'], JSON.stringify(second)).toBe(true);
    expect(second['duplicate']).toBe(false);
    const secondId = (second['assignment'] as Record<string, unknown>)['assignmentId'] as string;
    expect(secondId).not.toBe(firstId);

    // …and it REACHES the rider's own session read, acceptable by his hand.
    const seen = await session.signIn(code);
    if (!seen.ok) throw new Error('sign-in refused');
    expect(seen.session.assignment).toMatchObject({ assignmentId: secondId, status: 'active_unacknowledged' });
    expect(await acts.accepterCourse(code, secondId)).toEqual({ ok: true });

    // The double-tap law is UNTOUCHED: the same command id over the now-LIVE
    // course replays as duplicate — one grant, however many taps.
    const retap = await ops(mf, '/ops/assign', { command_id: CONFIER_CMD, taskId: 'task-rr-1', riderId: 'rider-boss' });
    expect(retap['ok']).toBe(true);
    expect(retap['duplicate']).toBe(true);
    expect((retap['assignment'] as Record<string, unknown>)['assignmentId']).toBe(secondId);
  });

  it('offline sends NOTHING and changes nothing — queued = pending, never done', async () => {
    const mf = spawn();
    await ops(mf, '/ops/riders', { riderId: 'rider-off', displayName: 'Off', phoneAlias: 'o-1' });
    await ops(mf, '/ops/riders/certify', { riderId: 'rider-off', certified: true });
    const code = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-off' }))['code'] as string;
    const { acts, net } = appPorts(mf);
    await acts.ackPrivacy(code);

    net.set('offline');
    expect(await acts.startShift(code)).toEqual({ ok: false, reason: 'offline' });
    net.set('online');
    // The registry never saw the offline tap: still off shift, still unassignable.
    expect(await boardRider(mf, 'rider-off')).toMatchObject({ assignable: false });
  });
});
