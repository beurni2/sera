import { PlatformEventSchema, type PlatformEvent } from '@platform/contracts';
import type { ReadyQueue } from './ready-queue.js';
import type { RiderRegistry } from './rider-registry.js';

/**
 * MANUAL ASSIGNMENT — E1 form only (Contract §2.3 step 10: "Assign one
 * courier manually"). A dispatcher assigns ONE intake task to ONE eligible
 * rider. Store-level invariant seed: at most ONE active assignment per rider
 * AND per task — checked before every insert and exposed for the CI gate.
 * The atomic AssignmentLease Durable Object is E4/M2 and is explicitly NOT
 * built here. Rider acknowledgment is server-confirmed only: an
 * offline-queued ack is PENDING and confers no finality; unacknowledged
 * assignments go back to the queue (assignment.expired.v1). No candidate
 * ranking, no auto-assign, no ETA — the dispatcher chooses.
 */

export const ACK_DEADLINE_MS = 5 * 60 * 1000;

export type AssignmentStatus = 'active_unacknowledged' | 'ack_pending_offline' | 'acknowledged' | 'returned_to_queue';

export interface AssignmentRecord {
  assignmentId: string;
  taskId: string;
  orderId: string;
  riderId: string;
  dispatcherId: string;
  correlationId: string;
  assignedAt: string;
  ackDeadline: string;
  status: AssignmentStatus;
}

export type AssignOutcome =
  | { ok: true; assignment: AssignmentRecord; event: PlatformEvent; duplicate: boolean }
  | {
      ok: false;
      reason:
        | 'task_not_assignable'
        | 'rider_not_assignable'
        | 'rider_already_has_active_assignment'
        | 'task_already_assigned';
      detail?: string;
    };

export type AckOutcome =
  | { ok: true; status: AssignmentStatus; pending: boolean }
  | { ok: false; reason: 'unknown_assignment' | 'not_active' };

const ACTIVE_STATUSES: readonly AssignmentStatus[] = ['active_unacknowledged', 'ack_pending_offline', 'acknowledged'];

export class AssignmentBook {
  private readonly assignments = new Map<string, AssignmentRecord>();
  /** Only SUCCESSES are remembered (idempotency = never double-apply).
   * Refusals re-evaluate on retry — a stale projection heals, and the same
   * command may then succeed (mirrors ReadyQueue.onTaskReady). */
  private readonly appliedCommandIds = new Map<string, AssignOutcome>();
  private aggregateVersion = 0;

  constructor(
    private readonly registry: RiderRegistry,
    private readonly queue: ReadyQueue,
  ) {}

  assign(cmd: {
    command_id: string;
    taskId: string;
    riderId: string;
    dispatcherId: string;
    at: string;
    newAssignmentId: string;
  }): AssignOutcome {
    const replay = this.appliedCommandIds.get(cmd.command_id);
    if (replay?.ok) return { ...replay, duplicate: true };

    // SE1.1 second check — stale at assignment time = unassignable.
    const taskCheck = this.queue.recheckAssignable(cmd.taskId);
    if (!taskCheck.assignable) {
      return { ok: false, reason: 'task_not_assignable', detail: taskCheck.reason };
    }
    // SE1 acceptance — uncertified/off-shift (incl. any pending state) refuse closed.
    if (!this.registry.isAssignable(cmd.riderId)) {
      return { ok: false, reason: 'rider_not_assignable' };
    }
    // Store-level one-active invariant: per rider AND per task.
    for (const existing of this.assignments.values()) {
      if (!ACTIVE_STATUSES.includes(existing.status)) continue;
      if (existing.riderId === cmd.riderId) {
        return { ok: false, reason: 'rider_already_has_active_assignment' };
      }
      if (existing.taskId === cmd.taskId) {
        return { ok: false, reason: 'task_already_assigned' };
      }
    }

    const queued = this.queue.get(cmd.taskId)!;
    const assignment: AssignmentRecord = {
      assignmentId: cmd.newAssignmentId,
      taskId: cmd.taskId,
      orderId: queued.orderId,
      riderId: cmd.riderId,
      dispatcherId: cmd.dispatcherId,
      correlationId: queued.correlationId,
      assignedAt: cmd.at,
      ackDeadline: new Date(Date.parse(cmd.at) + ACK_DEADLINE_MS).toISOString(),
      status: 'active_unacknowledged',
    };
    this.assignments.set(assignment.assignmentId, assignment);
    this.queue.markAssigned(cmd.taskId);
    this.aggregateVersion += 1;
    const event = PlatformEventSchema.parse({
      name: 'pickup.assigned.v1',
      envelope: {
        command_id: cmd.command_id,
        correlation_id: queued.correlationId,
        aggregateVersion: this.aggregateVersion,
        actor: `dispatcher:${cmd.dispatcherId}`,
        serverTime: cmd.at,
        version: '1',
      },
      payload: {
        delivery_task_id: cmd.taskId,
        order_id: queued.orderId,
        assignment_id: assignment.assignmentId,
        rider_id: cmd.riderId,
      },
    });
    const outcome: AssignOutcome = { ok: true, assignment, event, duplicate: false };
    this.appliedCommandIds.set(cmd.command_id, outcome);
    return outcome;
  }

  /**
   * Rider ack. server_confirmed → acknowledged. queued_offline → PENDING —
   * kernel offline law: queued = pending, never done; the ack deadline still
   * runs, and expiry returns the task to the queue regardless of a pending ack.
   */
  acknowledge(assignmentId: string, confirmation: 'server_confirmed' | 'queued_offline'): AckOutcome {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) return { ok: false, reason: 'unknown_assignment' };
    if (assignment.status !== 'active_unacknowledged' && assignment.status !== 'ack_pending_offline') {
      return { ok: false, reason: 'not_active' };
    }
    const status: AssignmentStatus =
      confirmation === 'server_confirmed' ? 'acknowledged' : 'ack_pending_offline';
    this.assignments.set(assignmentId, { ...assignment, status });
    return { ok: true, status, pending: status === 'ack_pending_offline' };
  }

  /** Unacknowledged past deadline → back to the queue (assignment.expired.v1). */
  expireUnacknowledged(nowIso: string): { requeued: AssignmentRecord[]; events: PlatformEvent[] } {
    const requeued: AssignmentRecord[] = [];
    const events: PlatformEvent[] = [];
    for (const assignment of this.assignments.values()) {
      const awaitingAck =
        assignment.status === 'active_unacknowledged' || assignment.status === 'ack_pending_offline';
      if (!awaitingAck || nowIso <= assignment.ackDeadline) continue;
      const returned: AssignmentRecord = { ...assignment, status: 'returned_to_queue' };
      this.assignments.set(assignment.assignmentId, returned);
      this.queue.requeue(assignment.taskId);
      this.aggregateVersion += 1;
      requeued.push(returned);
      events.push(
        PlatformEventSchema.parse({
          name: 'assignment.expired.v1',
          envelope: {
            command_id: `expire-${assignment.assignmentId}`,
            correlation_id: assignment.correlationId,
            aggregateVersion: this.aggregateVersion,
            actor: 'logistics-service:ack-deadline',
            serverTime: nowIso,
            version: '1',
          },
          payload: {
            delivery_task_id: assignment.taskId,
            order_id: assignment.orderId,
            assignment_id: assignment.assignmentId,
            rider_id: assignment.riderId,
            requeued: true,
          },
        }),
      );
    }
    return { requeued, events };
  }

  get(assignmentId: string): AssignmentRecord | undefined {
    return this.assignments.get(assignmentId);
  }

  /** One-active-per-rider AND per-task — exposed for tests and scripts. */
  findOneActiveViolations(): string[] {
    const violations: string[] = [];
    const byRider = new Map<string, number>();
    const byTask = new Map<string, number>();
    for (const a of this.assignments.values()) {
      if (!ACTIVE_STATUSES.includes(a.status)) continue;
      byRider.set(a.riderId, (byRider.get(a.riderId) ?? 0) + 1);
      byTask.set(a.taskId, (byTask.get(a.taskId) ?? 0) + 1);
    }
    for (const [riderId, n] of byRider) if (n > 1) violations.push(`rider ${riderId} holds ${n} active assignments`);
    for (const [taskId, n] of byTask) if (n > 1) violations.push(`task ${taskId} carried by ${n} active assignments`);
    return violations;
  }
}
