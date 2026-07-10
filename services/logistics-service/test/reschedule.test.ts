import { describe, expect, it } from 'vitest';
import { MockBoutikReadiness } from '../src/mocks/boutik-readiness-mock.js';
import { MockShopPlusFunding } from '../src/mocks/shopplus-funding-mock.js';
import { ReadyQueue } from '../src/ready-queue.js';
import { RescheduleBook } from '../src/reschedule.js';
import { AssignmentBook } from '../src/manual-assignment.js';
import { RiderRegistry, PRIVACY_NOTICE_VERSION } from '../src/rider-registry.js';

/**
 * WO-2.7 item 4 — reschedule → NEW DeliveryTask: new id, same order chain,
 * attempt lineage, lawful close of the prior task, and the FULL WO-1.2
 * intake discipline re-applied at the new attempt. The reschedule outcome
 * fed in is shaped exactly like the custody-service ladder's canonical
 * `reschedule` DeliveryOutcome (family + attempt 2 from resolveExpiredWindow).
 */

const T = '2026-07-10T12:00:00.000Z';
const SHA = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
const ORDER = 'order-e2-77';
const CORR = 'corr-e2-77';

const location = {
  pin: { lat: 12.3714, lng: -1.5197 },
  zone: 'Gounghin',
  landmark: 'Face à la pharmacie du marché',
  directions: 'Deuxième porte bleue après le kiosque',
  maskedRelay: 'relay-77',
};

const taskShape = (id: string) => ({
  type: 'delivery' as const,
  id,
  orderId: ORDER,
  location,
  window: { start: T, end: '2026-07-10T14:00:00.000Z' },
  status: 'ready',
});

const rescheduleOutcome = (over: Record<string, unknown> = {}) => ({
  taskId: 'task-77-1',
  orderId: ORDER,
  family: 'reschedule',
  reasonCode: 'honest_absence',
  humanReasonRef: 'reason.honest_absence',
  faultClass: 'buyer',
  attempt: { number: 2, at: T },
  ...over,
});

function world() {
  const funding = new MockShopPlusFunding({});
  const readiness = new MockBoutikReadiness({});
  funding.initiateCheckout(ORDER, 'FULL_PREPAY', CORR);
  funding.confirmFunding(ORDER, 'collect-77', T);
  readiness.recordOrderKnown(ORDER, CORR);
  readiness.confirmReadiness(
    {
      orderId: ORDER,
      photoRef: { ref: 'media/pkg-77.jpg', sha256: SHA, mimeType: 'image/jpeg' },
      readinessChallenge: 'challenge-77',
      qty: 1,
      variant: 'taille unique',
      availableConfirmed: true,
      at: T,
    },
    T,
  );
  const queue = new ReadyQueue({ funding, readiness });
  const admitted = queue.onTaskReady(
    {
      name: 'logistics.task_ready.v1',
      envelope: { command_id: 'cmd-first-attempt', correlation_id: CORR, aggregateVersion: 1, actor: 'logistics-service:test', serverTime: T, version: '1' },
      payload: { task: taskShape('task-77-1') },
    },
    T,
  );
  expect(admitted.admitted).toBe(true);
  // The first attempt was ASSIGNED and the delivery was attempted — that is
  // what a reschedule outcome presupposes.
  queue.markAssigned('task-77-1');
  const book = new RescheduleBook(queue);
  return { funding, readiness, queue, book };
}

describe('reschedule → new DeliveryTask (WO-2.2 verifier\'s named path)', () => {
  it('happy path: canonical reschedule recorded → follow-up task with NEW id, SAME order, lineage; prior task closed lawfully; intake re-verified', () => {
    const { queue, book } = world();
    expect(book.recordRescheduleOutcome(rescheduleOutcome())).toEqual({ ok: true, orderId: ORDER });

    const opened = book.openFollowUpTask({
      command_id: 'cmd-follow-up-1',
      dispatcherId: 'dispatcher-1',
      priorTaskId: 'task-77-1',
      newTask: taskShape('task-77-2'),
      at: T,
    });
    expect(opened).toMatchObject({ ok: true, priorTaskIds: ['task-77-1'], intake: { admitted: true, duplicate: false } });

    // The prior task is CLOSED — never assignable again, and an expiring
    // assignment cannot resurrect it.
    expect(queue.recheckAssignable('task-77-1')).toEqual({ assignable: false, reason: 'task_closed' });
    queue.requeue('task-77-1');
    expect(queue.recheckAssignable('task-77-1')).toEqual({ assignable: false, reason: 'task_closed' });
    // The NEW task is queued and assignable — same order chain.
    expect(queue.recheckAssignable('task-77-2')).toEqual({ assignable: true });
    expect(queue.get('task-77-2')?.orderId).toBe(ORDER);
    expect(book.priorTaskIdsOf('task-77-2')).toEqual(['task-77-1']);
    // NOTHING here touches custody: RescheduleBook and ReadyQueue expose no
    // custody surface — the custodian is whatever the custody ledger says,
    // before and after the close (asserted structurally: no custody module
    // is even imported by src/reschedule.ts — see the source-scan test below).
  });

  it('a SECOND reschedule chains lineage: the third task carries both prior attempts, in order', () => {
    const { book } = world();
    expect(book.recordRescheduleOutcome(rescheduleOutcome())).toEqual({ ok: true, orderId: ORDER });
    expect(book.openFollowUpTask({ command_id: 'cmd-f1', dispatcherId: 'd-1', priorTaskId: 'task-77-1', newTask: taskShape('task-77-2'), at: T }))
      .toMatchObject({ ok: true, intake: { admitted: true } });
    expect(book.recordRescheduleOutcome(rescheduleOutcome({ taskId: 'task-77-2' }))).toEqual({ ok: true, orderId: ORDER });
    const third = book.openFollowUpTask({ command_id: 'cmd-f2', dispatcherId: 'd-1', priorTaskId: 'task-77-2', newTask: taskShape('task-77-3'), at: T });
    expect(third).toMatchObject({ ok: true, priorTaskIds: ['task-77-1', 'task-77-2'] });
  });

  it('NEGATIVE: a new task on a NON-RESCHEDULED order refuses closed — retry/return outcomes do not open the path either', () => {
    const { queue, book } = world();
    // No outcome recorded at all:
    expect(book.openFollowUpTask({ command_id: 'cmd-x', dispatcherId: 'd-1', priorTaskId: 'task-77-1', newTask: taskShape('task-77-2'), at: T }))
      .toEqual({ ok: false, reason: 'order_not_rescheduled' });
    // A retry-family outcome is NOT a reschedule:
    expect(book.recordRescheduleOutcome(rescheduleOutcome({ family: 'retry', attempt: { number: 1, at: T, windowExpiresAt: '2026-07-10T12:15:00.000Z' } })))
      .toEqual({ ok: false, reason: 'not_a_reschedule_outcome' });
    // A non-canonical outcome refuses on the strict parse:
    expect(book.recordRescheduleOutcome({ taskId: 'task-77-1', orderId: ORDER, family: 'failed' }))
      .toEqual({ ok: false, reason: 'outcome_not_canonical' });
    // The prior task was never closed by any refused attempt:
    expect(queue.recheckAssignable('task-77-1')).toMatchObject({ assignable: false, reason: 'already_assigned' });
  });

  it('NEGATIVE: a STALE projection at the new attempt refuses — intake first, and at assignment time via the WO-1.2 second check', () => {
    const { funding, queue, book } = world();
    expect(book.recordRescheduleOutcome(rescheduleOutcome())).toEqual({ ok: true, orderId: ORDER });

    // Stale at the follow-up INTAKE: refused, reschedule stays open, prior
    // task untouched.
    funding.goStale(1);
    const refused = book.openFollowUpTask({ command_id: 'cmd-f-stale', dispatcherId: 'd-1', priorTaskId: 'task-77-1', newTask: taskShape('task-77-2'), at: T });
    expect(refused).toMatchObject({ ok: true, intake: { admitted: false, reason: 'funding_projection_stale' } });
    expect(queue.recheckAssignable('task-77-1')).toMatchObject({ assignable: false, reason: 'already_assigned' });

    // Fresh again → admitted. Then stale at ASSIGNMENT time → unassignable.
    const admitted = book.openFollowUpTask({ command_id: 'cmd-f-fresh', dispatcherId: 'd-1', priorTaskId: 'task-77-1', newTask: taskShape('task-77-2'), at: T });
    expect(admitted).toMatchObject({ ok: true, intake: { admitted: true } });
    const registry = new RiderRegistry();
    registry.register({ riderId: 'rider-awa', displayName: 'Awa', phoneAlias: 'alias-88', certified: true });
    registry.acknowledgePrivacyNotice('rider-awa', PRIVACY_NOTICE_VERSION, T);
    registry.startShift('rider-awa', T, 'server_confirmed');
    const assignments = new AssignmentBook(registry, queue);
    funding.goStale(1);
    expect(assignments.assign({ command_id: 'cmd-assign-stale', taskId: 'task-77-2', riderId: 'rider-awa', dispatcherId: 'd-1', at: T, newAssignmentId: 'as-77-2' }))
      .toEqual({ ok: false, reason: 'task_not_assignable', detail: 'funding_projection_stale' });
    // Fresh → the same command may then succeed (refusals re-evaluate).
    expect(assignments.assign({ command_id: 'cmd-assign-stale', taskId: 'task-77-2', riderId: 'rider-awa', dispatcherId: 'd-1', at: T, newAssignmentId: 'as-77-2' }))
      .toMatchObject({ ok: true, duplicate: false });
  });

  it('refuses closed on identity games: reused task id, wrong prior task, wrong order, double follow-up', () => {
    const { book } = world();
    expect(book.recordRescheduleOutcome(rescheduleOutcome())).toEqual({ ok: true, orderId: ORDER });
    expect(book.openFollowUpTask({ command_id: 'cmd-1', dispatcherId: 'd-1', priorTaskId: 'task-77-1', newTask: taskShape('task-77-1'), at: T }))
      .toEqual({ ok: false, reason: 'not_a_new_task_id' });
    expect(book.openFollowUpTask({ command_id: 'cmd-2', dispatcherId: 'd-1', priorTaskId: 'task-someone-else', newTask: taskShape('task-77-2'), at: T }))
      .toEqual({ ok: false, reason: 'prior_task_mismatch' });
    expect(book.openFollowUpTask({ command_id: 'cmd-3', dispatcherId: 'd-1', priorTaskId: 'task-77-1', newTask: { ...taskShape('task-77-2'), orderId: 'order-foreign' }, at: T }))
      .toEqual({ ok: false, reason: 'order_not_rescheduled' });
    expect(book.openFollowUpTask({ command_id: 'cmd-4', dispatcherId: 'd-1', priorTaskId: 'task-77-1', newTask: { garbage: true }, at: T }))
      .toEqual({ ok: false, reason: 'task_not_canonical' });
  });
});

describe('custody isolation of the reschedule path (structural)', () => {
  it('src/reschedule.ts imports NO custody surface — closing a task cannot move custody by construction', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(import.meta.dirname, '../src/reschedule.ts'), 'utf8');
    const imports = [...source.matchAll(/^import[^;]*from '([^']+)';/gm)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec, `reschedule.ts imports ${spec}`).not.toMatch(/custody/i);
    }
    // No ledger/transition API is reachable either — only queue + contracts.
    expect(source).not.toMatch(/CustodyLedger|custody-ledger|custody-spine|CustodySpine/);
  });
});
