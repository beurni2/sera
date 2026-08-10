import { describe, expect, it } from 'vitest';
import { decideLease, emptyLeaseState, type LeaseAuthorityState } from '../src/assignment-lease.js';
import { AssignmentBook, type LeaseRef } from '../src/manual-assignment.js';
import { ReadyQueue, type IntakeProjections } from '../src/ready-queue.js';
import { PRIVACY_NOTICE_VERSION, RiderRegistry } from '../src/rider-registry.js';

/**
 * PURGE-ESSAI (founder ruling 2026-08-10) — the three cores' own laws for the
 * retire path, unit-level. The end-to-end seam (the ops door, the real Worker,
 * the board and the reads) is `test/retirer.e2e.test.ts`; this file pins what
 * each core promises the orchestrator, so a change to one of them cannot make
 * the seam pass for the wrong reason.
 */

const T = '2026-08-10T09:00:00.000Z';

const ALWAYS_ADMISSIBLE: IntakeProjections = {
  funding: { check: () => ({ status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T, stale: false }) },
  readiness: { check: () => ({ ready: true, asOf: T, stale: false }) },
};

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

function admit(queue: ReadyQueue, taskId: string, orderId: string, commandId: string): void {
  const outcome = queue.onTaskReady(
    {
      name: 'logistics.task_ready.v1',
      envelope: {
        command_id: commandId,
        correlation_id: `corr-${orderId}`,
        aggregateVersion: 1,
        actor: 'test',
        serverTime: T,
        version: '1',
      },
      payload: {
        task: {
          type: 'delivery',
          id: taskId,
          orderId,
          location: { zone: 'Zogona', landmark: "À l'échangeur", directions: '', maskedRelay: '' },
          window: { start: T, end: '2026-08-10T16:00:00.000Z' },
          status: 'ready',
        },
      },
    },
    T,
  );
  expect(outcome.admitted, `${taskId} must be admitted`).toBe(true);
}

describe('ReadyQueue.forgetOrder — the order leaves the queue, and only that order', () => {
  it('removes every row of the order whatever its status, keeps the others, and returns the ids', () => {
    const queue = new ReadyQueue(ALWAYS_ADMISSIBLE);
    admit(queue, 'task-live', 'ord-essai', 'cmd-1');
    admit(queue, 'task-assigned', 'ord-essai', 'cmd-2');
    admit(queue, 'task-closed', 'ord-essai', 'cmd-3');
    admit(queue, 'task-autre', 'ord-vrai', 'cmd-4');
    queue.markAssigned('task-assigned');
    queue.closeTakenBack('task-closed');

    const removed = queue.forgetOrder('ord-essai');

    // Every status goes — a closed row is exactly as much residue as a live one.
    expect([...removed].sort()).toEqual(['task-assigned', 'task-closed', 'task-live']);
    expect(queue.get('task-live')).toBeUndefined();
    expect(queue.get('task-assigned')).toBeUndefined();
    expect(queue.get('task-closed')).toBeUndefined();
    // The other order is untouched, and still assignable.
    expect(queue.get('task-autre')?.orderId).toBe('ord-vrai');
    expect(queue.queuedTasks().map((q) => q.task.id)).toEqual(['task-autre']);
    expect(queue.recheckAssignable('task-autre')).toEqual({ assignable: true });
    // A forgotten task is not « closed » — it is gone: nothing can requeue it.
    queue.requeue('task-live');
    expect(queue.get('task-live')).toBeUndefined();
    expect(queue.recheckAssignable('task-live')).toEqual({ assignable: false, reason: 'not_in_queue' });
  });

  it('an order the queue never held removes nothing and reports nothing', () => {
    const queue = new ReadyQueue(ALWAYS_ADMISSIBLE);
    admit(queue, 'task-autre', 'ord-vrai', 'cmd-1');
    expect(queue.forgetOrder('ord-jamais-vue')).toEqual([]);
    expect(queue.queuedTasks()).toHaveLength(1);
  });

  it('the dedupe ledger SURVIVES the purge — one command id can name two orders', () => {
    // The documented reason `processedCommandIds` is left intact: a saved
    // compose re-run against a SECOND order falls through the correlation
    // replay lookup and admits under the same command id. Purging the first
    // order must not weaken dedupe for the second.
    const queue = new ReadyQueue(ALWAYS_ADMISSIBLE);
    admit(queue, 'task-a', 'ord-essai', 'cmd-partage');
    admit(queue, 'task-b', 'ord-vrai', 'cmd-partage');
    expect(queue.snapshot().processedCommandIds).toEqual(['cmd-partage']);

    queue.forgetOrder('ord-essai');

    expect(queue.snapshot().processedCommandIds).toEqual(['cmd-partage']);
    // …and the surviving order's replay still answers duplicate rather than
    // admitting a second live task for it.
    const replay = queue.onTaskReady(
      {
        name: 'logistics.task_ready.v1',
        envelope: {
          command_id: 'cmd-partage',
          correlation_id: 'corr-ord-vrai',
          aggregateVersion: 1,
          actor: 'test',
          serverTime: T,
          version: '1',
        },
        payload: {
          task: {
            type: 'delivery',
            id: 'task-b-bis',
            orderId: 'ord-vrai',
            location: { zone: 'Zogona', landmark: "À l'échangeur", directions: '', maskedRelay: '' },
            window: { start: T, end: '2026-08-10T16:00:00.000Z' },
            status: 'ready',
          },
        },
      },
      T,
    );
    expect(replay).toMatchObject({ admitted: true, duplicate: true });
    expect(queue.get('task-b-bis')).toBeUndefined();
  });
});

describe('AssignmentBook.forgetOrder — the rows leave, and the caller is handed what they held', () => {
  function world() {
    const queue = new ReadyQueue(ALWAYS_ADMISSIBLE);
    admit(queue, 'task-essai', 'ord-essai', 'cmd-1');
    admit(queue, 'task-autre', 'ord-vrai', 'cmd-2');
    const registry = new RiderRegistry();
    for (const riderId of ['r-boss', 'r-awa']) {
      registry.register({ riderId, displayName: riderId, phoneAlias: `alias-${riderId}`, certified: true });
      registry.acknowledgePrivacyNotice(riderId, PRIVACY_NOTICE_VERSION, T);
      registry.startShift(riderId, T, 'server_confirmed');
    }
    const witness = new TestWitness();
    const book = new AssignmentBook(registry, queue, witness);
    return { queue, registry, witness, book };
  }

  it('removes the order’s assignments, RETURNS them with their lease refs, and leaves other orders alone', () => {
    const { witness, book } = world();
    const essaiLease = witness.grant({ taskId: 'task-essai', riderId: 'r-boss', version: 1 });
    const autreLease = witness.grant({ taskId: 'task-autre', riderId: 'r-awa', version: 1 });
    const essai = book.assign({
      command_id: 'cmd-a1', taskId: 'task-essai', riderId: 'r-boss',
      dispatcherId: 'fondateur', at: T, newAssignmentId: 'as-essai', lease: essaiLease,
    });
    const autre = book.assign({
      command_id: 'cmd-a2', taskId: 'task-autre', riderId: 'r-awa',
      dispatcherId: 'fondateur', at: T, newAssignmentId: 'as-autre', lease: autreLease,
    });
    expect(essai.ok && autre.ok).toBe(true);

    const removed = book.forgetOrder('ord-essai');

    // The record comes BACK — that is what lets the orchestrator release the
    // lease and revoke the witness ref instead of stranding them.
    expect(removed.map((r) => r.assignmentId)).toEqual(['as-essai']);
    expect(removed[0]?.lease).toEqual({ taskId: 'task-essai', riderId: 'r-boss', version: 1 });
    expect(book.get('as-essai')).toBeUndefined();
    // The other order's course is untouched, still active, still one custodian.
    expect(book.get('as-autre')?.status).toBe('active_unacknowledged');
    expect(book.findOneActiveViolations()).toEqual([]);
  });

  it('removes an ENDED assignment too — a taken-back row is residue on the board as well', () => {
    const { witness, book } = world();
    const lease = witness.grant({ taskId: 'task-essai', riderId: 'r-boss', version: 1 });
    book.assign({
      command_id: 'cmd-a1', taskId: 'task-essai', riderId: 'r-boss',
      dispatcherId: 'fondateur', at: T, newAssignmentId: 'as-essai', lease,
    });
    expect(book.takeBack('as-essai', 'fondateur', T).ok).toBe(true);

    const removed = book.forgetOrder('ord-essai');
    expect(removed.map((r) => r.status)).toEqual(['taken_back_by_dispatch']);
    expect(book.get('as-essai')).toBeUndefined();
  });

  it('the rider is free again: a forgotten assignment no longer blocks a fresh one', () => {
    const { witness, book } = world();
    const lease = witness.grant({ taskId: 'task-essai', riderId: 'r-boss', version: 1 });
    book.assign({
      command_id: 'cmd-a1', taskId: 'task-essai', riderId: 'r-boss',
      dispatcherId: 'fondateur', at: T, newAssignmentId: 'as-essai', lease,
    });
    // Before: the one-active-per-rider wall stands.
    const blocked = book.assign({
      command_id: 'cmd-a2', taskId: 'task-autre', riderId: 'r-boss',
      dispatcherId: 'fondateur', at: T, newAssignmentId: 'as-2',
      lease: witness.grant({ taskId: 'task-autre', riderId: 'r-boss', version: 1 }),
    });
    expect(blocked).toEqual({ ok: false, reason: 'rider_already_has_active_assignment' });

    book.forgetOrder('ord-essai');

    const after = book.assign({
      command_id: 'cmd-a3', taskId: 'task-autre', riderId: 'r-boss',
      dispatcherId: 'fondateur', at: T, newAssignmentId: 'as-3',
      lease: witness.grant({ taskId: 'task-autre', riderId: 'r-boss', version: 1 }),
    });
    expect(after.ok, JSON.stringify(after)).toBe(true);
  });
});

describe('the lease authority ends a retired course honestly', () => {
  function granted(): LeaseAuthorityState {
    const decision = decideLease(emptyLeaseState(), {
      kind: 'acquire',
      command_id: 'cmd-acq',
      taskId: 'task-essai',
      riderId: 'r-boss',
      grantedAt: T,
      eligibility: { riderAssignable: true, taskAssignable: true, checkedAt: T },
      correlationId: 'corr-ord-essai',
    });
    expect(decision.ok).toBe(true);
    return decision.ok ? decision.state : emptyLeaseState();
  }

  it("'retire' releases the active lease and frees the rider AND the task", () => {
    const state = granted();
    const released = decideLease(state, {
      kind: 'release',
      command_id: 'retire-task-essai',
      taskId: 'task-essai',
      cause: 'retire',
    });
    expect(released.ok, JSON.stringify(released)).toBe(true);
    if (!released.ok) return;
    expect(released.lease?.status).toBe('released');
    // The cause is on the record — the audit never borrows 'taken_back'.
    expect(released.lease?.releaseCause).toBe('retire');

    // The rider can be granted a NEW course, and so can... nothing else on the
    // dead task, but the rider is the one the board cares about.
    const again = decideLease(released.state, {
      kind: 'acquire',
      command_id: 'cmd-acq-2',
      taskId: 'task-neuf',
      riderId: 'r-boss',
      grantedAt: T,
      eligibility: { riderAssignable: true, taskAssignable: true, checkedAt: T },
      correlationId: 'corr-ord-neuf',
    });
    expect(again.ok, JSON.stringify(again)).toBe(true);
  });

  it('an ANCHORED lease (the rider already accepted) still releases on retire', () => {
    const anchored = decideLease(granted(), { kind: 'anchor', command_id: 'ack-1', taskId: 'task-essai', at: T });
    expect(anchored.ok).toBe(true);
    if (!anchored.ok) return;
    const released = decideLease(anchored.state, {
      kind: 'release',
      command_id: 'retire-task-essai',
      taskId: 'task-essai',
      cause: 'retire',
    });
    expect(released.ok).toBe(true);
  });

  it('the cause union stays closed — an invented cause is still malformed', () => {
    const refused = decideLease(granted(), {
      kind: 'release',
      command_id: 'retire-task-essai',
      taskId: 'task-essai',
      cause: 'purge_tout' as never,
    });
    expect(refused).toMatchObject({ ok: false, reason: 'malformed_command' });
  });
});
