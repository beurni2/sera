import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformEventSchema } from '@platform/contracts';
import { MockBoutikReadiness } from '../src/mocks/boutik-readiness-mock.js';
import { MockShopPlusFunding } from '../src/mocks/shopplus-funding-mock.js';
import { AssignmentBook } from '../src/manual-assignment.js';
import {
  GrantedLeaseWitness,
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
 * the tests share it the way production surfaces would). */
function world(taskId: string) {
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
  const dispatch = new LeasedDispatch({ authority: miniflareAuthority(), witness, registry, queue, book, reschedules });
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
    // a pending OFFLINE ack does not save it (queued = pending, never done)
    expect(book.acknowledge(`${salt}-as-1`, 'queued_offline')).toMatchObject({ ok: true, pending: true });
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

  it('COMPLETION: releaseOnCompletion frees the lease with cause completed; a later sweep expires nothing for that task', async () => {
    const t = 'task-complete';
    const { salt, dispatch, book } = world(t);
    const granted = await dispatch.assign(assignCmd(salt, t));
    expect(granted.ok).toBe(true);
    // the rider acknowledges — ack does NOT release the lease
    expect(book.acknowledge(`${salt}-as-1`, 'server_confirmed')).toMatchObject({ ok: true, status: 'acknowledged' });
    const done = await dispatch.releaseOnCompletion(t);
    expect(done).toEqual({ released: true });
    // already released: a second completion release replays idempotently
    expect(await dispatch.releaseOnCompletion(t)).toEqual({ released: true });
    // a later sweep (its own instant — the shared authority replays per
    // command_id) expires nothing for the completed task
    const sweep = await dispatch.expireDue('2026-07-12T12:07:00.000Z');
    expect(sweep.expiredLeases.some((l) => l.taskId === t)).toBe(false);
  });
});
