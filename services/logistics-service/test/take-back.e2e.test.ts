import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';

/**
 * ═══ COURSE-REPRISE — the dispatcher takes a course back, end to end ═══
 *
 * ⚠ WHY THIS EXISTS (founder report, 2026-08-09): « remove the product order
 * that boss is already carrying on the rider's app sera, cause i can not see
 * the audio and the supplier's proof photos. »
 *
 * The course on boss's phone was composed before COURSE-BRIEF existed, so it
 * carries no voice note and no photos — and an ACKNOWLEDGED course had NO
 * exit: decline and expiry touch only pre-ack statuses, and an in-time ack
 * ANCHORS the lease so no sweep ever ends it. The rider stayed unassignable
 * (`carrying`), and the order uncomposable (`order_already_has_task`), for
 * ever. This is the founder's whole loop, driven through his own ops door and
 * the RIDER APP'S OWN PORTS, judged by `/rider/moi` and the board — never by
 * believing a response:
 *
 *   compose (briefless) → assign → the rider ACCEPTS (the stuck state)
 *   → take-back → the rider's screen clears → the SAME order re-composes,
 *   THIS time with the voice note + photos → re-assign to the SAME rider
 *   → the rider's own session read carries both pointers.
 */

const OPS = 'test-ops-take-back';
const INTAKE = 'test-intake-take-back';
const VERIFY = 'test-verify-take-back';

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
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'take-back-')),
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

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return {
    acts: httpShiftActs('http://logistics', net, fetchFn),
    session: httpRiderSession('http://logistics', net, fetchFn),
  };
}

const T = '2026-08-09T10:00:00.000Z';
const LOC = { zone: 'Zogona', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-08-09T16:00:00.000Z' };
const AUDIO = 'media/11111111-2222-4333-8444-555555555555';
const PHOTO = 'media/9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

/** The founder's starting point on a fresh world: an on-shift rider CARRYING
 * an ACKNOWLEDGED, briefless course. Returns everything the loop needs. */
async function stuckWorld(mf: Miniflare) {
  await intake(mf, '/intake/funding', { orderId: 'ord-stuck', status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
  await intake(mf, '/intake/readiness', { orderId: 'ord-stuck', ready: true, asOf: T });
  const composed = await ops(mf, '/ops/task', { command_id: 'cmd-old', orderId: 'ord-stuck', location: LOC, window: WIN });
  expect(composed['ok'], JSON.stringify(composed)).toBe(true);
  const oldTaskId = composed['taskId'] as string;

  await ops(mf, '/ops/riders', { riderId: 'rider-boss', displayName: 'boss', phoneAlias: 'bossy' });
  await ops(mf, '/ops/riders/certify', { riderId: 'rider-boss', certified: true });
  const code = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-boss' }))['code'] as string;
  const { acts, session } = appPorts(mf);
  await acts.ackPrivacy(code);
  if (!(await acts.startShift(code)).ok) throw new Error('start refused');
  const granted = await ops(mf, '/ops/assign', { command_id: 'cmd-old-a', taskId: oldTaskId, riderId: 'rider-boss' });
  expect(granted['ok'], JSON.stringify(granted)).toBe(true);
  const assignmentId = (granted['assignment'] as Record<string, unknown>)['assignmentId'] as string;

  // The rider ACCEPTS through the app's own port — the exact stuck state:
  // acknowledged, lease anchored, exempt from every sweep.
  const accepted = await acts.accepterCourse(code, assignmentId);
  expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
  return { acts, session, code, oldTaskId, assignmentId };
}

describe('⚠ the founder’s loop: take back the briefless course, re-compose WITH the brief, same rider', () => {
  it('acknowledged course → take-back → the rider’s screen clears → the order re-composes with audio+photos → they reach the rider', async () => {
    const mf = spawn();
    const { session, code, oldTaskId, assignmentId } = await stuckWorld(mf);

    // The stuck state, seen from the rider's own read: carrying, empty brief.
    const stuck = await session.signIn(code);
    if (!stuck.ok) throw new Error('sign-in refused');
    expect(stuck.session.assignment?.status).toBe('acknowledged');
    expect(stuck.session.assignment?.repereAudioRef).toBeNull();
    expect(stuck.session.assignment?.preuvePhotoRefs).toEqual([]);

    // …and the order is UNCOMPOSABLE while the old course lives (the trap).
    const blocked = await ops(mf, '/ops/task', {
      command_id: 'cmd-new', orderId: 'ord-stuck', location: LOC, window: WIN,
      repereAudioRef: AUDIO, preuvePhotoRefs: [PHOTO],
    });
    expect(blocked['ok']).toBe(false);
    expect(blocked['reason']).toBe('order_already_has_task');

    // ═══ THE ACT: the dispatcher takes the course back. ═══
    const takenBack = await ops(mf, '/ops/assignment/take-back', { command_id: 'cmd-w1', assignmentId });
    expect(takenBack['ok'], JSON.stringify(takenBack)).toBe(true);
    expect(takenBack['duplicate']).toBe(false);
    // The ANCHORED lease released — the assertion that makes acknowledged
    // endable at THE authority, not merely in the book.
    expect(takenBack['leaseReleased'], 'the anchored lease must release').toBe(true);
    expect((takenBack['assignment'] as Record<string, unknown>)['status']).toBe('taken_back_by_dispatch');

    // The rider's screen clears on its next read — no course, and free again.
    const cleared = await session.signIn(code);
    if (!cleared.ok) throw new Error('refresh refused');
    expect(cleared.session.assignment, 'the taken-back course must leave the rider’s screen').toBeNull();

    // The board agrees: no active assignment, and boss is assignable again.
    const board = (await ops(mf, '/ops/board')) as { board?: Record<string, unknown> };
    const b = board.board as { assignments: Record<string, unknown>[]; riders: Record<string, unknown>[] };
    expect(b.assignments).toEqual([]);
    expect(b.riders.find((r) => r['riderId'] === 'rider-boss')).toMatchObject({ assignable: true });

    // The order is back on the founder's own « à préparer » list — the list
    // he composes from; a taken-back order that never resurfaced there would
    // be recomposable only by memory.
    const aPreparer = await ops(mf, '/ops/a-preparer');
    expect(JSON.stringify(aPreparer), 'ord-stuck must reappear in /ops/a-preparer').toContain('ord-stuck');

    // The SAME order re-composes — this time WITH the brief (his goal).
    const recomposed = await ops(mf, '/ops/task', {
      command_id: 'cmd-new-2', orderId: 'ord-stuck', location: LOC, window: WIN,
      repereAudioRef: AUDIO, preuvePhotoRefs: [PHOTO],
    });
    expect(recomposed['ok'], JSON.stringify(recomposed)).toBe(true);
    const newTaskId = recomposed['taskId'] as string;
    expect(newTaskId).not.toBe(oldTaskId); // a fresh task, never a resurrection

    // …assigned to the SAME rider, and the rider's own parser hands the
    // screen both pointers. This sentence is the founder's report, answered.
    const regranted = await ops(mf, '/ops/assign', { command_id: 'cmd-new-a', taskId: newTaskId, riderId: 'rider-boss' });
    expect(regranted['ok'], JSON.stringify(regranted)).toBe(true);
    const fresh = await session.signIn(code);
    if (!fresh.ok) throw new Error('fresh sign-in refused');
    expect(fresh.session.assignment?.repereAudioRef, 'the voice note must reach the rider').toBe(AUDIO);
    expect(fresh.session.assignment?.preuvePhotoRefs, 'the proof photos must reach the rider').toEqual([PHOTO]);
  });

  it('the refusal matrix: unknown 404 · re-take-back duplicate · the dead task never assigns or resurrects', async () => {
    const mf = spawn();
    const { assignmentId, oldTaskId } = await stuckWorld(mf);

    // An unknown assignment is a 404 by name — no oracle, no silent ok.
    const unknown = await mf.dispatchFetch('http://logistics/ops/assignment/take-back', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command_id: 'cmd-x', assignmentId: 'as-inconnue' }),
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as Record<string, unknown>)['reason']).toBe('unknown_assignment');

    // Take it back, then again: the second is duplicate, never a new act.
    expect((await ops(mf, '/ops/assignment/take-back', { command_id: 'cmd-w1', assignmentId }))['ok']).toBe(true);
    const again = await ops(mf, '/ops/assignment/take-back', { command_id: 'cmd-w2', assignmentId });
    expect(again['ok']).toBe(true);
    expect(again['duplicate']).toBe(true);

    // The taken-back task is DEAD: it cannot be given to anyone…
    await ops(mf, '/ops/riders', { riderId: 'rider-awa', displayName: 'Awa', phoneAlias: 'awa' });
    await ops(mf, '/ops/riders/certify', { riderId: 'rider-awa', certified: true });
    const codeAwa = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-awa' }))['code'] as string;
    const { acts } = appPorts(mf);
    await acts.ackPrivacy(codeAwa);
    await acts.startShift(codeAwa);
    const reassign = await ops(mf, '/ops/assign', { command_id: 'cmd-dead', taskId: oldTaskId, riderId: 'rider-awa' });
    expect(reassign['ok']).toBe(false);
    // The refusal fires at the LEASE stage: assign attests `taskAssignable`
    // from the queue's recheck (which answers `task_closed` for a taken-back
    // task), and THE authority refuses an unattested acquire — the same door
    // every dead task is refused at, one stage before the book.
    expect(reassign['reason']).toBe('eligibility_not_attested');

    // …and the expiry sweep does not ride it back into the queue.
    await ops(mf, '/ops/expire-due', {});
    const board = (await ops(mf, '/ops/board')) as { board?: Record<string, unknown> };
    const b = board.board as { queued: Record<string, unknown>[] };
    expect(b.queued.map((q) => (q as { task?: { id?: string } }).task?.id ?? q['taskId'])).not.toContain(oldTaskId);
  });

  it('a course that already ended another way refuses `not_active` — a take-back never rewrites history', async () => {
    // A DECLINED course is returned_to_queue: there is nothing to take back,
    // and answering ok would misreport what actually ended it.
    const mf = spawn();
    await intake(mf, '/intake/funding', { orderId: 'ord-declined', status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
    await intake(mf, '/intake/readiness', { orderId: 'ord-declined', ready: true, asOf: T });
    const composed = await ops(mf, '/ops/task', { command_id: 'cmd-d', orderId: 'ord-declined', location: LOC, window: WIN });
    await ops(mf, '/ops/riders', { riderId: 'rider-awa', displayName: 'Awa', phoneAlias: 'awa' });
    await ops(mf, '/ops/riders/certify', { riderId: 'rider-awa', certified: true });
    const code = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-awa' }))['code'] as string;
    const { acts } = appPorts(mf);
    await acts.ackPrivacy(code);
    await acts.startShift(code);
    const granted = await ops(mf, '/ops/assign', { command_id: 'cmd-d-a', taskId: composed['taskId'], riderId: 'rider-awa' });
    const assignmentId = (granted['assignment'] as Record<string, unknown>)['assignmentId'] as string;
    // The wired app carries no decline port yet — drive the rider door's own
    // route exactly as the app would (Bearer <personal code>, same as ack).
    const declineRes = await mf.dispatchFetch('http://logistics/rider/assignment/decline', {
      method: 'POST',
      headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentId }),
    });
    expect(declineRes.status).toBe(200);

    const res = await mf.dispatchFetch('http://logistics/ops/assignment/take-back', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command_id: 'cmd-d-w', assignmentId }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Record<string, unknown>)['reason']).toBe('not_active');
  });

  it('a PRE-ACK course is taken back the same way — the founder need not wait for an answer he may never get', async () => {
    const mf = spawn();
    await intake(mf, '/intake/funding', { orderId: 'ord-preack', status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
    await intake(mf, '/intake/readiness', { orderId: 'ord-preack', ready: true, asOf: T });
    const composed = await ops(mf, '/ops/task', { command_id: 'cmd-p', orderId: 'ord-preack', location: LOC, window: WIN });
    await ops(mf, '/ops/riders', { riderId: 'rider-awa', displayName: 'Awa', phoneAlias: 'awa' });
    await ops(mf, '/ops/riders/certify', { riderId: 'rider-awa', certified: true });
    const code = (await ops(mf, '/ops/rider-code/mint', { riderId: 'rider-awa' }))['code'] as string;
    const { acts, session } = appPorts(mf);
    await acts.ackPrivacy(code);
    await acts.startShift(code);
    const granted = await ops(mf, '/ops/assign', { command_id: 'cmd-p-a', taskId: composed['taskId'], riderId: 'rider-awa' });
    const assignmentId = (granted['assignment'] as Record<string, unknown>)['assignmentId'] as string;

    const takenBack = await ops(mf, '/ops/assignment/take-back', { command_id: 'cmd-p-w', assignmentId });
    expect(takenBack['ok'], JSON.stringify(takenBack)).toBe(true);
    expect(takenBack['leaseReleased']).toBe(true);
    const cleared = await session.signIn(code);
    if (!cleared.ok) throw new Error('refresh refused');
    expect(cleared.session.assignment).toBeNull();
  });
});
