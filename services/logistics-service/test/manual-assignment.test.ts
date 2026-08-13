import { describe, expect, it } from 'vitest';
import { EventEnvelopeSchema, PlatformEventSchema } from '@platform/contracts';
const SHA256_FIXTURE = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
import { MockBoutikReadiness } from '../src/mocks/boutik-readiness-mock.js';
import { MockShopPlusFunding } from '../src/mocks/shopplus-funding-mock.js';
import { AssignmentBook, type LeaseRef } from '../src/manual-assignment.js';
import { ReadyQueue } from '../src/ready-queue.js';
import { PRIVACY_NOTICE_VERSION, RiderRegistry } from '../src/rider-registry.js';

/** WO-4.3: assign() now REQUIRES a lease ref and, with a witness wired,
 * refuses refs THE authority never granted. These store-level scenarios
 * pre-grant exactly what they lease through a test-local witness — the real
 * grant path (DO + orchestrator) is covered in leased-dispatch.e2e.test.ts. */
class TestWitness {
  private readonly grants = new Set<string>();
  grant(ref: LeaseRef): LeaseRef {
    this.grants.add(`${ref.taskId}|${ref.riderId}|${ref.version}`);
    return ref;
  }
  isGranted(ref: LeaseRef): boolean {
    return this.grants.has(`${ref.taskId}|${ref.riderId}|${ref.version}`);
  }
}

const T = '2026-07-09T12:00:00.000Z';
const PAST_ACK_DEADLINE = '2026-07-09T12:06:00.000Z';
const ORDER = 'order-e1-42';
const CORR = 'corr-e1-42';

function world() {
  const funding = new MockShopPlusFunding({});
  const readiness = new MockBoutikReadiness({});
  funding.initiateCheckout(ORDER, 'FULL_PREPAY', CORR);
  funding.confirmFunding(ORDER, 'collect-42', T);
  readiness.recordOrderKnown(ORDER, CORR);
  readiness.confirmReadiness(
    {
      orderId: ORDER,
      photoRef: { ref: 'media/pkg-42.jpg', sha256: SHA256_FIXTURE, mimeType: 'image/jpeg' },
      readinessChallenge: 'challenge-42',
      qty: 1,
      variant: 'taille unique',
      availableConfirmed: true,
      at: T,
    },
    T,
  );
  const queue = new ReadyQueue({ funding, readiness });
  queue.onTaskReady(
    {
      name: 'logistics.task_ready.v1',
      envelope: { command_id: 'cmd-ready-1', correlation_id: CORR, aggregateVersion: 1, actor: 'test', serverTime: T, version: '1' },
      payload: {
        task: {
          type: 'delivery', id: 'task-1', orderId: ORDER,
          location: { pin: { lat: 12.37, lng: -1.52 }, zone: 'Gounghin', landmark: 'Face à la pharmacie', directions: 'Porte bleue', maskedRelay: 'relay-abc' },
          window: { start: T, end: '2026-07-09T14:00:00.000Z' }, status: 'ready',
        },
      },
    },
    T,
  );
  const registry = new RiderRegistry();
  registry.register({ riderId: 'r-1', displayName: 'Issa', phoneAlias: 'alias-77', certified: true });
  registry.acknowledgePrivacyNotice('r-1', PRIVACY_NOTICE_VERSION, T);
  registry.startShift('r-1', T, 'server_confirmed');
  const witness = new TestWitness();
  witness.grant({ taskId: 'task-1', riderId: 'r-1', version: 1 });
  const book = new AssignmentBook(registry, queue, witness);
  return { funding, readiness, queue, registry, witness, book };
}

const assignCmd = (over: Partial<Parameters<AssignmentBook['assign']>[0]> = {}) => ({
  command_id: 'cmd-assign-1', taskId: 'task-1', riderId: 'r-1', dispatcherId: 'd-1', at: T, newAssignmentId: 'as-1',
  lease: { taskId: 'task-1', riderId: 'r-1', version: 1 },
  ...over,
});

describe('manual assignment — §2.3 step 10, refuse closed everywhere', () => {
  it('happy path: eligible rider + admitted fresh task → assignment + enveloped pickup.assigned.v1 with the chain ids', () => {
    const { book } = world();
    const outcome = book.assign(assignCmd());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.assignment).toMatchObject({ taskId: 'task-1', riderId: 'r-1', status: 'active_unacknowledged', correlationId: CORR });
    expect(PlatformEventSchema.safeParse(outcome.event).success).toBe(true);
    expect(EventEnvelopeSchema.safeParse(outcome.event.envelope).success).toBe(true);
    expect(outcome.event.name).toBe('pickup.assigned.v1');
    expect(outcome.event.envelope.correlation_id).toBe(CORR);
    expect(outcome.event.payload).toMatchObject({ delivery_task_id: 'task-1', order_id: ORDER, assignment_id: 'as-1', rider_id: 'r-1' });
    // Idempotent replay of the same command.
    expect(book.assign(assignCmd())).toMatchObject({ ok: true, duplicate: true });
  });

  it('UNCERTIFIED rider refuses closed', () => {
    const { registry, queue } = world();
    const uncertified = new RiderRegistry();
    uncertified.register({ riderId: 'r-2', displayName: 'X', phoneAlias: 'a', certified: false });
    const book = new AssignmentBook(uncertified, queue);
    expect(book.assign(assignCmd({ riderId: 'r-2', lease: { taskId: 'task-1', riderId: 'r-2', version: 1 } }))).toEqual({ ok: false, reason: 'rider_not_assignable' });
    void registry;
  });

  it('OFF-SHIFT and PENDING-shift riders refuse closed — a queued offline start confers nothing', () => {
    const { queue } = world();
    const registry = new RiderRegistry();
    registry.register({ riderId: 'r-3', displayName: 'Awa', phoneAlias: 'a', certified: true });
    registry.acknowledgePrivacyNotice('r-3', PRIVACY_NOTICE_VERSION, T);
    const book = new AssignmentBook(registry, queue);
    const lease = { taskId: 'task-1', riderId: 'r-3', version: 1 };
    expect(book.assign(assignCmd({ riderId: 'r-3', lease }))).toEqual({ ok: false, reason: 'rider_not_assignable' }); // off_shift
    registry.startShift('r-3', T, 'queued_offline'); // pending, NOT on shift
    expect(book.assign(assignCmd({ command_id: 'cmd-2', riderId: 'r-3', lease }))).toEqual({ ok: false, reason: 'rider_not_assignable' });
  });

  it('STALE AT ASSIGNMENT TIME refuses closed even though intake admitted the task (SE1.1)', () => {
    const { funding, book } = world();
    funding.goStale(1);
    const outcome = book.assign(assignCmd());
    expect(outcome).toMatchObject({ ok: false, reason: 'task_not_assignable', detail: 'funding_projection_stale' });
  });

  it('CANCELLED after admission refuses closed at assignment time', () => {
    const { funding, book } = world();
    funding.cancelOrder(ORDER);
    expect(book.assign(assignCmd())).toMatchObject({ ok: false, reason: 'task_not_assignable', detail: 'order_cancelled' });
  });

  it('ONE ACTIVE PER RIDER and PER TASK: second assignment on either axis refuses closed; violations scanner stays empty', () => {
    const { book, queue, registry, witness } = world();
    // Second admitted task for the per-rider check.
    queue.onTaskReady(
      {
        name: 'logistics.task_ready.v1',
        envelope: { command_id: 'cmd-ready-2', correlation_id: CORR, aggregateVersion: 2, actor: 'test', serverTime: T, version: '1' },
        payload: {
          task: {
            type: 'delivery', id: 'task-2', orderId: ORDER,
            location: { pin: { lat: 12.37, lng: -1.52 }, zone: 'Gounghin', landmark: 'Face à la pharmacie', directions: 'Porte bleue', maskedRelay: 'relay-abc' },
            window: { start: T, end: '2026-07-09T14:00:00.000Z' }, status: 'ready',
          },
        },
      },
      T,
    );
    // Second eligible rider for the per-task check.
    registry.register({ riderId: 'r-2', displayName: 'Awa', phoneAlias: 'alias-88', certified: true });
    registry.acknowledgePrivacyNotice('r-2', PRIVACY_NOTICE_VERSION, T);
    registry.startShift('r-2', T, 'server_confirmed');

    expect(book.assign(assignCmd()).ok).toBe(true);
    // Same rider, different task → refused.
    expect(book.assign(assignCmd({
      command_id: 'cmd-b', taskId: 'task-2', newAssignmentId: 'as-2',
      lease: witness.grant({ taskId: 'task-2', riderId: 'r-1', version: 1 }),
    }))).toEqual({
      ok: false, reason: 'rider_already_has_active_assignment',
    });
    // Same task, different rider → refused (already marked assigned in queue).
    expect(book.assign(assignCmd({
      command_id: 'cmd-c', riderId: 'r-2', newAssignmentId: 'as-3',
      lease: witness.grant({ taskId: 'task-1', riderId: 'r-2', version: 2 }),
    }))).toMatchObject({
      ok: false, reason: 'task_not_assignable', detail: 'already_assigned',
    });
    expect(book.findOneActiveViolations()).toEqual([]);
  });

  it('rider ack: server-confirmed → acknowledged; OFFLINE ack is PENDING and the deadline still bites', () => {
    const { book } = world();
    const assigned = book.assign(assignCmd());
    if (!assigned.ok) throw new Error('setup');
    const offlineAck = book.acknowledge('as-1', 'queued_offline');
    expect(offlineAck).toEqual({ ok: true, status: 'ack_pending_offline', pending: true }); // queued = pending, never done
    // Deadline passes with only a pending ack → back to the queue.
    const { requeued, events } = book.expireUnacknowledged(PAST_ACK_DEADLINE);
    expect(requeued).toHaveLength(1);
    expect(requeued[0]!.status).toBe('returned_to_queue');
    expect(events[0]!.name).toBe('assignment.expired.v1');
    expect(events[0]!.envelope.correlation_id).toBe(CORR);
    expect(events[0]!.payload).toMatchObject({ delivery_task_id: 'task-1', assignment_id: 'as-1', requeued: true });
  });

  it('server-confirmed ack survives the deadline; unknown/settled assignments refuse closed', () => {
    const { book, queue } = world();
    book.assign(assignCmd());
    expect(book.acknowledge('as-1', 'server_confirmed')).toEqual({ ok: true, status: 'acknowledged', pending: false });
    expect(book.expireUnacknowledged(PAST_ACK_DEADLINE).requeued).toHaveLength(0);
    expect(book.acknowledge('as-ghost', 'server_confirmed')).toEqual({ ok: false, reason: 'unknown_assignment' });
    // The task stayed assigned — never silently requeued under an acknowledged assignment.
    expect(queue.get('task-1')!.status).toBe('assigned');
  });

  it('unacknowledged past the deadline → task is back in the queue and REASSIGNABLE', () => {
    const { book, queue, registry, witness } = world();
    book.assign(assignCmd());
    book.expireUnacknowledged(PAST_ACK_DEADLINE);
    expect(queue.get('task-1')!.status).toBe('queued');
    registry.register({ riderId: 'r-9', displayName: 'Sali', phoneAlias: 'alias-99', certified: true });
    registry.acknowledgePrivacyNotice('r-9', PRIVACY_NOTICE_VERSION, T);
    registry.startShift('r-9', PAST_ACK_DEADLINE, 'server_confirmed');
    const second = book.assign(assignCmd({
      command_id: 'cmd-again', riderId: 'r-9', newAssignmentId: 'as-2', at: PAST_ACK_DEADLINE,
      lease: witness.grant({ taskId: 'task-1', riderId: 'r-9', version: 2 }),
    }));
    expect(second.ok).toBe(true);
  });


  it('RETRY AFTER HEAL: a refused command re-evaluates — the SAME command_id succeeds once the stale projection heals (WO-1.2 follow-up, was script-proven)', () => {
    const { funding, book } = world();
    funding.goStale(1);
    const first = book.assign(assignCmd());
    expect(first).toMatchObject({ ok: false, reason: 'task_not_assignable', detail: 'funding_projection_stale' });
    // The projection heals; the SAME command retried now succeeds (refusals are never cached)…
    const retry = book.assign(assignCmd());
    expect(retry).toMatchObject({ ok: true, duplicate: false });
    // …and the SUCCESS is what replays idempotently, with no double-apply.
    expect(book.assign(assignCmd())).toMatchObject({ ok: true, duplicate: true });
    expect(book.findOneActiveViolations()).toEqual([]);
  });

  it('WO-4.3 DECLINE at the store: OFFLINE decline is PENDING (no state change, no event, the deadline still bites); server-confirmed returns the task; settled/unknown refuse closed', () => {
    const { book, queue } = world();
    book.assign(assignCmd());
    // queued offline = pending, never done — nothing moves, nothing emits
    expect(book.decline('as-1', 'queued_offline', T)).toEqual({ ok: true, pending: true, status: 'active_unacknowledged' });
    expect(queue.get('task-1')!.status).toBe('assigned'); // still assigned
    // …and the ack deadline still bites the pending decline
    const { requeued } = book.expireUnacknowledged(PAST_ACK_DEADLINE);
    expect(requeued).toHaveLength(1);
    // a settled assignment cannot decline
    expect(book.decline('as-1', 'server_confirmed', PAST_ACK_DEADLINE)).toEqual({ ok: false, reason: 'not_active' });
    expect(book.decline('as-ghost', 'server_confirmed', T)).toEqual({ ok: false, reason: 'unknown_assignment' });
  });

  it('WO-4.3 DECLINE server-confirmed: returned_to_queue + requeue + canonical assignment.declined.v1 with actor rider:<id>; an ACKNOWLEDGED assignment cannot decline', () => {
    const { book, queue } = world();
    book.assign(assignCmd());
    const declined = book.decline('as-1', 'server_confirmed', T);
    expect(declined).toMatchObject({ ok: true, pending: false, status: 'returned_to_queue' });
    if (!declined.ok || declined.pending) throw new Error('setup');
    expect(PlatformEventSchema.safeParse(declined.event).success).toBe(true);
    expect(declined.event.name).toBe('assignment.declined.v1');
    expect(declined.event.envelope.actor).toBe('rider:r-1');
    expect(declined.event.envelope.correlation_id).toBe(CORR);
    expect(declined.event.payload).toMatchObject({ delivery_task_id: 'task-1', order_id: ORDER, assignment_id: 'as-1', rider_id: 'r-1', requeued: true });
    expect(queue.get('task-1')!.status).toBe('queued');
    // acknowledged = the course proceeds; decline refuses closed
    const w2 = world();
    w2.book.assign(assignCmd());
    w2.book.acknowledge('as-1', 'server_confirmed');
    expect(w2.book.decline('as-1', 'server_confirmed', T)).toEqual({ ok: false, reason: 'not_active' });
  });
});

describe('COURSE-LIVRÉE — the delivered terminal at the store', () => {
  const DROP_AT = '2026-07-09T13:00:00.000Z';

  it('an ACKNOWLEDGED course delivers: named success terminal, deliveredAt = the drop instant, one-active scanner stays empty', () => {
    const { book } = world();
    book.assign(assignCmd());
    book.acknowledge('as-1', 'server_confirmed');
    const outcome = book.deliver(ORDER, DROP_AT);
    expect(outcome).toMatchObject({ ok: true, duplicate: false });
    if (!outcome.ok) throw new Error('setup');
    expect(outcome.assignment).toMatchObject({
      assignmentId: 'as-1',
      status: 'delivered',
      deliveredAt: DROP_AT,
    });
    expect(book.get('as-1')!.status).toBe('delivered');
    expect(book.findOneActiveViolations()).toEqual([]);
  });

  it('idempotent BY STATE: a redelivered confirmation answers duplicate and moves nothing — including the recorded instant', () => {
    const { book } = world();
    book.assign(assignCmd());
    book.acknowledge('as-1', 'server_confirmed');
    expect(book.deliver(ORDER, DROP_AT)).toMatchObject({ ok: true, duplicate: false });
    const again = book.deliver(ORDER, '2026-07-09T14:30:00.000Z');
    expect(again).toMatchObject({ ok: true, duplicate: true });
    if (!again.ok) throw new Error('setup');
    expect(again.assignment.deliveredAt).toBe(DROP_AT);
  });

  it('no active course — never assigned, or already returned to the queue — answers the NAMED no_active_course, a settled condition', () => {
    const { book } = world();
    // Never assigned at all.
    expect(book.deliver(ORDER, DROP_AT)).toEqual({ ok: false, reason: 'no_active_course' });
    // Assigned, then declined back to the queue: the course ended another way.
    book.assign(assignCmd());
    book.decline('as-1', 'server_confirmed', T);
    expect(book.deliver(ORDER, DROP_AT)).toEqual({ ok: false, reason: 'no_active_course' });
  });

  it('after delivery the rider is FREE at the store: a fresh course for the same rider assigns without a one-active refusal', () => {
    const { book, queue, witness } = world();
    book.assign(assignCmd());
    book.acknowledge('as-1', 'server_confirmed');
    expect(book.deliver(ORDER, DROP_AT)).toMatchObject({ ok: true, duplicate: false });
    // A second ready task (same world, second order is overkill at store
    // level: the one-active law is per rider AND per task, and the delivered
    // record must count against neither).
    queue.onTaskReady(
      {
        name: 'logistics.task_ready.v1',
        envelope: { command_id: 'cmd-ready-2', correlation_id: CORR, aggregateVersion: 2, actor: 'test', serverTime: T, version: '1' },
        payload: {
          task: {
            type: 'delivery', id: 'task-2', orderId: ORDER,
            location: { pin: { lat: 12.37, lng: -1.52 }, zone: 'Gounghin', landmark: 'Face à la pharmacie', directions: '', maskedRelay: '' },
            window: { start: T, end: '2026-07-09T14:00:00.000Z' }, status: 'ready',
          },
        },
      },
      T,
    );
    witness.grant({ taskId: 'task-2', riderId: 'r-1', version: 1 });
    const second = book.assign(
      assignCmd({
        command_id: 'cmd-assign-2',
        taskId: 'task-2',
        newAssignmentId: 'as-2',
        lease: { taskId: 'task-2', riderId: 'r-1', version: 1 },
      }),
    );
    expect(second).toMatchObject({ ok: true, duplicate: false });
    expect(book.findOneActiveViolations()).toEqual([]);
  });
});
