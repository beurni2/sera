import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformEventSchema } from '@platform/contracts';
import { MockBoutikReadiness } from '../src/mocks/boutik-readiness-mock.js';
import { MockShopPlusFunding } from '../src/mocks/shopplus-funding-mock.js';
import { AssignmentBook, type AckOutcome } from '../src/manual-assignment.js';
import {
  GrantedLeaseWitness,
  InMemoryLeaseAuthority,
  LeasedDispatch,
  type LeaseAuthority,
} from '../src/leased-assignment.js';
import type { LeaseCommand, LeaseDecision } from '../src/assignment-lease.js';
import { ReadyQueue } from '../src/ready-queue.js';
import { RescheduleBook } from '../src/reschedule.js';
import { PRIVACY_NOTICE_VERSION, RiderRegistry } from '../src/rider-registry.js';

/**
 * WO-4.3 — the FULL leased grant path against THE authority on the REAL
 * runtime: LeasedDispatch (node side) speaks to the AssignmentLeaseDO
 * through Miniflare's dispatchFetch, exactly the production shape. Proves:
 * grant path, defense-in-depth bypass refusal, grant rollback with the
 * honest cause, decline (offline pending vs server-confirmed), the ONE
 * expiry sweep driving BOTH stores with lineage intact and a fresh-version
 * re-grant, the reschedule release + full-path re-acquire, and completion
 * release.
 */

const T = '2026-07-12T12:00:00.000Z';
const PAST_TTL = '2026-07-12T12:06:00.000Z';
const SHA = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
const ORDER = 'order-e4-43';
const CORR = 'corr-e4-43';

let mf: Miniflare;

beforeAll(() => {
  mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/assignment-worker.mjs',
    durableObjects: { ASSIGNMENT_LEASE: 'AssignmentLeaseDO' },
  });
});
afterAll(() => mf.dispose());

/** The production client shape: one POST to THE authority's single route.
 * Each world salts its command ids instead of assuming a fresh DO. */
function miniflareAuthority(): LeaseAuthority {
  return {
    async send(cmd: LeaseCommand): Promise<LeaseDecision> {
      const res = await mf.dispatchFetch('http://logistics/authority/dispatch', {
        method: 'POST',
        body: JSON.stringify(cmd),
      });
      return (await res.json()) as LeaseDecision;
    },
  };
}

const taskShape = (id: string) => ({
  type: 'delivery' as const,
  id,
  orderId: ORDER,
  location: {
    pin: { lat: 12.3714, lng: -1.5197 },
    zone: 'Gounghin',
    landmark: 'Face à la pharmacie du marché',
    directions: 'Deuxième porte bleue après le kiosque',
    maskedRelay: 'relay-43',
  },
  window: { start: T, end: '2026-07-12T14:00:00.000Z' },
  status: 'ready',
});

let worldCount = 0;

/** A fresh funded/ready world per test; `salt` isolates ids inside the ONE
 * shared authority object (SE-I01: there is only one dispatch authority —
 * the tests share it the way production surfaces would). An explicit
 * `authority` override lets the interleave test drive the SAME pure core
 * in-memory with a deterministic race hook. */
function world(taskId: string, authority?: LeaseAuthority) {
  worldCount += 1;
  const salt = `w${worldCount}`;
  const funding = new MockShopPlusFunding({});
  const readiness = new MockBoutikReadiness({});
  funding.initiateCheckout(ORDER, 'FULL_PREPAY', CORR);
  funding.confirmFunding(ORDER, 'collect-43', T);
  readiness.recordOrderKnown(ORDER, CORR);
  readiness.confirmReadiness(
    {
      orderId: ORDER,
      photoRef: { ref: 'media/pkg-43.jpg', sha256: SHA, mimeType: 'image/jpeg' },
      readinessChallenge: 'challenge-43',
      qty: 1,
      variant: 'taille unique',
      availableConfirmed: true,
      at: T,
    },
    T,
  );
  const queue = new ReadyQueue({ funding, readiness });
  const admit = (id: string, command_id: string) =>
    queue.onTaskReady(
      {
        name: 'logistics.task_ready.v1',
        envelope: { command_id, correlation_id: CORR, aggregateVersion: 1, actor: 'logistics-service:test', serverTime: T, version: '1' },
        payload: { task: taskShape(id) },
      },
      T,
    );
  expect(admit(taskId, `${salt}-cmd-ready-1`).admitted).toBe(true);
  const registry = new RiderRegistry();
  const addRider = (riderId: string) => {
    registry.register({ riderId, displayName: riderId, phoneAlias: `alias-${riderId}`, certified: true });
    registry.acknowledgePrivacyNotice(riderId, PRIVACY_NOTICE_VERSION, T);
    registry.startShift(riderId, T, 'server_confirmed');
  };
  addRider(`${salt}-r-1`);
  const witness = new GrantedLeaseWitness();
  const book = new AssignmentBook(registry, queue, witness);
  const reschedules = new RescheduleBook(queue);
  const dispatch = new LeasedDispatch({ authority: authority ?? miniflareAuthority(), witness, registry, queue, book, reschedules });
  return { salt, funding, readiness, queue, registry, witness, book, reschedules, dispatch, admit, addRider };
}

const assignCmd = (salt: string, taskId: string, n = 1) => ({
  command_id: `${salt}-cmd-assign-${n}`,
  taskId,
  riderId: `${salt}-r-1`,
  dispatcherId: 'd-1',
  at: T,
  newAssignmentId: `${salt}-as-${n}`,
});

describe('LeasedDispatch — the full grant path on the real authority', () => {
  it('GRANT PATH: recheck + assignability + atomic acquire + witnessed book entry; pickup.assigned.v1 carries the chain; replay is idempotent end-to-end', async () => {
    const t = 'task-grant';
    const { salt, dispatch, queue, book } = world(t);
    const outcome = await dispatch.assign(assignCmd(salt, t));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lease).toMatchObject({ taskId: t, riderId: `${salt}-r-1`, version: 1, status: 'active', correlationId: CORR });
    expect(outcome.assignment).toMatchObject({
      taskId: t,
      riderId: `${salt}-r-1`,
      status: 'active_unacknowledged',
      lease: { taskId: t, riderId: `${salt}-r-1`, version: 1 },
    });
    expect(outcome.event.name).toBe('pickup.assigned.v1');
    expect(PlatformEventSchema.safeParse(outcome.event).success).toBe(true);
    expect(queue.get(t)?.status).toBe('assigned');
    expect(book.findOneActiveViolations()).toEqual([]);
    // end-to-end idempotent replay: same command → same assignment, duplicate
    const replay = await dispatch.assign(assignCmd(salt, t));
    expect(replay).toMatchObject({ ok: true, duplicate: true });
  });

  it('DEFENSE IN DEPTH (the bypass test): book.assign called DIRECTLY with a fabricated leaseRef → { ok: false, reason: no_valid_lease }', async () => {
    const t = 'task-bypass';
    const { salt, book } = world(t);
    const fabricated = book.assign({
      command_id: `${salt}-cmd-forged`,
      taskId: t,
      riderId: `${salt}-r-1`,
      dispatcherId: 'd-evil',
      at: T,
      newAssignmentId: `${salt}-as-forged`,
      lease: { taskId: t, riderId: `${salt}-r-1`, version: 7 }, // never granted
    });
    expect(fabricated).toEqual({ ok: false, reason: 'no_valid_lease' });
    // a ref whose identity doesn't even match the command refuses too
    expect(
      book.assign({
        command_id: `${salt}-cmd-forged-2`,
        taskId: t,
        riderId: `${salt}-r-1`,
        dispatcherId: 'd-evil',
        at: T,
        newAssignmentId: `${salt}-as-forged-2`,
        lease: { taskId: 'task-other', riderId: `${salt}-r-1`, version: 1 },
      }),
    ).toEqual({ ok: false, reason: 'no_valid_lease' });
    // and a legacy-shaped call with NO ref at all refuses closed, never crashes
    expect(
      book.assign({
        command_id: `${salt}-cmd-forged-3`,
        taskId: t,
        riderId: `${salt}-r-1`,
        dispatcherId: 'd-evil',
        at: T,
        newAssignmentId: `${salt}-as-forged-3`,
        lease: undefined as never,
      }),
    ).toEqual({ ok: false, reason: 'no_valid_lease' });
  });

  it('OFF-SHIFT TAMPER refuses AT THE AUTHORITY: an off-shift rider yields a false attestation → eligibility_not_attested, no lease, no assignment', async () => {
    const t = 'task-offshift';
    const { salt, dispatch, registry, book } = world(t);
    registry.register({ riderId: `${salt}-r-off`, displayName: 'X', phoneAlias: 'a', certified: true });
    const refused = await dispatch.assign({ ...assignCmd(salt, t), riderId: `${salt}-r-off` });
    expect(refused).toEqual({ ok: false, stage: 'lease', reason: 'eligibility_not_attested' });
    expect(book.get(`${salt}-as-1`)).toBeUndefined();
  });

  it('GRANT ROLLBACK: a book refusal after the grant releases with cause grant_rolled_back; the burned command REFUSES CLOSED, a fresh command re-grants', async () => {
    const t = 'task-rollback';
    const { salt, dispatch, queue, book, witness, admit } = world(t);
    admit('task-rollback-b', `${salt}-cmd-ready-2`);
    // Mixed state: the rider already holds an ACTIVE BOOK assignment created
    // outside the leased path (test-local witnessed ref) — the registry
    // still says assignable, the DO sees no lease, the BOOK refuses.
    witness.register({ taskId: 'task-rollback-b', riderId: `${salt}-r-1`, version: 99 });
    const direct = book.assign({
      command_id: `${salt}-cmd-direct`,
      taskId: 'task-rollback-b',
      riderId: `${salt}-r-1`,
      dispatcherId: 'd-1',
      at: T,
      newAssignmentId: `${salt}-as-direct`,
      lease: { taskId: 'task-rollback-b', riderId: `${salt}-r-1`, version: 99 },
    });
    expect(direct.ok).toBe(true);
    const rolled = await dispatch.assign(assignCmd(salt, t));
    expect(rolled).toMatchObject({ ok: false, stage: 'book', reason: 'rider_already_has_active_assignment', leaseRolledBack: true });
    // the rolled-back grant confers NOTHING: the same command replays its
    // dead snapshot and refuses closed at the book (witness revoked); the
    // compensation release replays idempotently alongside it
    const burned = await dispatch.assign(assignCmd(salt, t));
    expect(burned).toMatchObject({ ok: false, stage: 'book', reason: 'no_valid_lease', leaseRolledBack: true });
    // …while a FRESH command, once the rider frees up, re-grants a FRESH lease.
    book.decline(`${salt}-as-direct`, 'server_confirmed', T);
    const fresh = await dispatch.assign({ ...assignCmd(salt, t, 2) });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.lease.version).toBe(2); // v1 was granted then rolled back
    expect(queue.get(t)?.status).toBe('assigned');
  });

  it('DECLINE: offline-queued = PENDING and releases NOTHING; server-confirmed returns the task, emits canonical assignment.declined.v1 (actor rider:<id>), frees the lease — the NEXT grant is a FRESH version', async () => {
    const t = 'task-decline';
    const { salt, dispatch, queue, addRider } = world(t);
    const granted = await dispatch.assign(assignCmd(salt, t));
    expect(granted.ok).toBe(true);
    // OFFLINE decline: queued = pending, never done — nothing releases.
    const offline = await dispatch.decline(`${salt}-as-1`, 'queued_offline', T);
    expect(offline).toMatchObject({ ok: true, pending: true, leaseReleased: false });
    expect(queue.get(t)?.status).toBe('assigned'); // still his
    // Server-confirmed decline: returned to queue + event + lease released.
    const confirmed = await dispatch.decline(`${salt}-as-1`, 'server_confirmed', T);
    expect(confirmed).toMatchObject({ ok: true, pending: false, status: 'returned_to_queue', leaseReleased: true });
    if (!confirmed.ok || confirmed.pending) return;
    expect(PlatformEventSchema.safeParse(confirmed.event).success).toBe(true);
    expect(confirmed.event.name).toBe('assignment.declined.v1');
    expect(confirmed.event.envelope.actor).toBe(`rider:${salt}-r-1`);
    expect(confirmed.event.envelope.correlation_id).toBe(CORR);
    expect(confirmed.event.payload).toMatchObject({ delivery_task_id: t, order_id: ORDER, assignment_id: `${salt}-as-1`, requeued: true });
    expect(queue.get(t)?.status).toBe('queued');
    // the freed task re-grants through the FULL path with a FRESH version
    addRider(`${salt}-r-2`);
    const again = await dispatch.assign({ ...assignCmd(salt, t, 2), riderId: `${salt}-r-2` });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.lease.version).toBe(2);
    // declining a settled assignment refuses closed
    expect(await dispatch.decline(`${salt}-as-1`, 'server_confirmed', T)).toMatchObject({ ok: false, reason: 'not_active' });
  });

  it('EXPIRY: ONE sweep drives BOTH stores — lease expired + assignment.expired.v1 + requeue with correlation lineage intact; the requeued task’s NEXT acquire is a FRESH lease with a NEW version', async () => {
    const t = 'task-sweep';
    const { salt, dispatch, queue, book, addRider } = world(t);
    const granted = await dispatch.assign(assignCmd(salt, t));
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    // both ends carry the SAME 5-minute policy datum
    expect(granted.lease.expiresAt).toBe(granted.assignment.ackDeadline);
    // a pending OFFLINE ack does not save it (queued = pending, never done —
    // CTO ruling: an offline-queued ack ANCHORS NOTHING, the deadline runs)
    expect(await dispatch.acknowledge(`${salt}-as-1`, 'queued_offline', T)).toMatchObject({
      ok: true,
      pending: true,
      anchored: false,
    });
    const swept = await dispatch.expireDue(PAST_TTL);
    expect(swept.expiredLeases.some((l) => l.taskId === t && l.status === 'expired')).toBe(true);
    expect(swept.requeued).toHaveLength(1);
    expect(swept.requeued[0]).toMatchObject({ taskId: t, status: 'returned_to_queue' });
    expect(swept.events[0]?.name).toBe('assignment.expired.v1');
    expect(swept.events[0]?.envelope.correlation_id).toBe(CORR);
    // lineage intact: the queue record survives requeue with its correlation
    expect(queue.get(t)).toMatchObject({ status: 'queued', correlationId: CORR, orderId: ORDER });
    // the expired ref confers nothing at the book (witness revoked)…
    const stale = book.assign({
      command_id: `${salt}-cmd-stale-ref`,
      taskId: t,
      riderId: `${salt}-r-1`,
      dispatcherId: 'd-evil',
      at: PAST_TTL,
      newAssignmentId: `${salt}-as-stale`,
      lease: { taskId: t, riderId: `${salt}-r-1`, version: granted.lease.version },
    });
    expect(stale).toEqual({ ok: false, reason: 'no_valid_lease' });
    // …and the honest re-grant is a FRESH lease with a NEW version
    addRider(`${salt}-r-2`);
    const again = await dispatch.assign({ ...assignCmd(salt, t, 2), riderId: `${salt}-r-2`, at: PAST_TTL });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.lease.version).toBe(granted.lease.version + 1);
  });

  it('RESCHEDULE (WO-2.7 wiring): closing the prior task releases its lease with cause reschedule_closed; the follow-up acquires a FRESH lease through the FULL path and SE1.1 re-runs', async () => {
    const t = 'task-resched-1';
    const t2 = 'task-resched-2';
    const { salt, dispatch, queue, funding, reschedules, addRider } = world(t);
    const granted = await dispatch.assign(assignCmd(salt, t));
    expect(granted.ok).toBe(true);
    // the attempt ends in a canonical reschedule outcome
    expect(
      reschedules.recordRescheduleOutcome({
        taskId: t,
        orderId: ORDER,
        family: 'reschedule',
        reasonCode: 'honest_absence',
        humanReasonRef: 'reason.honest_absence',
        faultClass: 'buyer',
        attempt: { number: 2, at: T },
      }),
    ).toEqual({ ok: true, orderId: ORDER });
    const opened = await dispatch.openFollowUpTask({
      command_id: `${salt}-cmd-follow-up`,
      dispatcherId: 'd-1',
      priorTaskId: t,
      newTask: taskShape(t2),
      at: T,
    });
    expect(opened).toMatchObject({ ok: true, priorTaskIds: [t], intake: { admitted: true }, priorLeaseReleased: true });
    expect(queue.recheckAssignable(t)).toEqual({ assignable: false, reason: 'task_closed' });
    // SE1.1 re-runs on the follow-up: stale at grant → the attestation goes
    // false and THE AUTHORITY refuses (one stale read is consumed by the
    // pre-acquire recheck; the book is never reached)
    funding.goStale(1);
    const stale = await dispatch.assign({ ...assignCmd(salt, t2, 2) });
    expect(stale).toEqual({ ok: false, stage: 'lease', reason: 'eligibility_not_attested' });
    // fresh again → the follow-up's lease is a FRESH grant of its own
    addRider(`${salt}-r-2`);
    const fresh = await dispatch.assign({ ...assignCmd(salt, t2, 3), riderId: `${salt}-r-2` });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.lease).toMatchObject({ taskId: t2, version: 1, status: 'active' });
  });

  it('COMPLETION: releaseOnCompletion frees even an ANCHORED lease with cause completed; a later sweep expires nothing for that task', async () => {
    const t = 'task-complete';
    const { salt, dispatch, book } = world(t);
    const granted = await dispatch.assign(assignCmd(salt, t));
    expect(granted.ok).toBe(true);
    // the rider acknowledges in time — the ack ANCHORS the lease (ruling)
    expect(await dispatch.acknowledge(`${salt}-as-1`, 'server_confirmed', T)).toMatchObject({
      ok: true,
      status: 'acknowledged',
      anchored: true,
    });
    // ruling test ⑤: release still ends an anchored lease
    const done = await dispatch.releaseOnCompletion(t);
    expect(done).toEqual({ released: true });
    // already released: a second completion release replays idempotently
    expect(await dispatch.releaseOnCompletion(t)).toEqual({ released: true });
    // a later sweep (its own instant — the shared authority replays per
    // command_id) expires nothing for the completed task
    const sweep = await dispatch.expireDue('2026-07-12T12:07:00.000Z');
    expect(sweep.expiredLeases.some((l) => l.taskId === t)).toBe(false);
    expect(book.get(`${salt}-as-1`)?.status).toBe('acknowledged');
  });

  it('ANCHOR ①: server-confirmed ack → sweep far past TTL → lease still active+anchored, assignment still acknowledged, task NOT requeued', async () => {
    const t = 'task-anchored';
    const { salt, dispatch, queue, book } = world(t);
    const granted = await dispatch.assign(assignCmd(salt, t));
    expect(granted.ok).toBe(true);
    const acked = await dispatch.acknowledge(`${salt}-as-1`, 'server_confirmed', T);
    expect(acked).toMatchObject({ ok: true, status: 'acknowledged', pending: false, anchored: true });
    // a FRESH sweep instant (no replay at the shared authority), far past TTL
    const swept = await dispatch.expireDue('2026-07-12T12:08:00.000Z');
    expect(swept.expiredLeases.some((l) => l.taskId === t)).toBe(false); // the anchored lease survives
    expect(swept.requeued).toHaveLength(0); // this world's book untouched
    expect(swept.events).toHaveLength(0);
    expect(book.get(`${salt}-as-1`)?.status).toBe('acknowledged');
    expect(queue.get(t)?.status).toBe('assigned'); // never requeued
  });

  it('ANCHOR ③ — THE INVERSION HAZARD, closed AT THE AUTHORITY: an acked (anchored) rider is refused a second task rider_already_leased even far past TTL', async () => {
    const t = 'task-inversion-a';
    const t2 = 'task-inversion-b';
    const LATE = '2026-07-12T12:09:00.000Z';
    const { salt, dispatch, admit } = world(t);
    admit(t2, `${salt}-cmd-ready-2`);
    expect((await dispatch.assign(assignCmd(salt, t))).ok).toBe(true);
    expect(await dispatch.acknowledge(`${salt}-as-1`, 'server_confirmed', T)).toMatchObject({ ok: true, anchored: true });
    // even after a sweep far past the TTL…
    await dispatch.expireDue(LATE);
    // …THE authority still holds the rider's one live lease: a second task
    // for the SAME rider refuses AT THE AUTHORITY, not merely at the book.
    const second = await dispatch.assign({ ...assignCmd(salt, t2, 2), at: LATE });
    expect(second).toEqual({ ok: false, stage: 'lease', reason: 'rider_already_leased' });
  });

  it('ANCHOR ④ — THE TOO-LATE-ACK OVERRIDE (manual interleave on the in-memory core): the lease dies first, the ack lands mid-sweep, the book FOLLOWS the lease back to returned_to_queue', async () => {
    const t = 'task-late-ack';
    // The same pure decideLease core, in memory, wrapped so the rider's
    // server-confirmed ack lands EXACTLY in the gap between THE authority's
    // expire_due and the book arm of the SAME sweep (the documented race).
    const inner = new InMemoryLeaseAuthority();
    let ackDuringSweep: (AckOutcome & { anchored: boolean }) | null = null;
    const interleaved: LeaseAuthority = {
      async send(cmd) {
        const decision = await inner.send(cmd);
        if (cmd.kind === 'expire_due' && ackDuringSweep === null) {
          // INTERLEAVE: the lease just expired at the authority; the ack
          // arrives before expireByTasks runs. (anchor commands pass through
          // this hook untouched — no recursion.)
          ackDuringSweep = await w.dispatch.acknowledge(`${w.salt}-as-1`, 'server_confirmed', cmd.nowIso);
        }
        return decision;
      },
    };
    const w = world(t, interleaved);
    const granted = await w.dispatch.assign(assignCmd(w.salt, t));
    expect(granted.ok).toBe(true);
    const swept = await w.dispatch.expireDue(PAST_TTL);
    // the ack landed at the book but could NOT anchor — the lease was dead
    expect(ackDuringSweep).toMatchObject({ ok: true, status: 'acknowledged', anchored: false });
    // THE LEASE IS THE TRUTH; THE BOOK FOLLOWS IT: the too-late-acknowledged
    // assignment is OVERRIDDEN back to the queue with the canonical event.
    expect(swept.expiredLeases.some((l) => l.taskId === t && l.status === 'expired')).toBe(true);
    expect(swept.requeued).toHaveLength(1);
    expect(swept.requeued[0]).toMatchObject({ taskId: t, status: 'returned_to_queue' });
    expect(swept.events[0]?.name).toBe('assignment.expired.v1');
    expect(PlatformEventSchema.safeParse(swept.events[0]).success).toBe(true);
    expect(w.book.get(`${w.salt}-as-1`)?.status).toBe('returned_to_queue');
    expect(w.queue.get(t)).toMatchObject({ status: 'queued', correlationId: CORR }); // lineage intact
  });
});
