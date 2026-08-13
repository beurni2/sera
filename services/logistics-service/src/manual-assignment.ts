import { PlatformEventSchema, type PlatformEvent } from '@platform/contracts';
import type { ReadyQueue } from './ready-queue.js';
import type { RiderRegistry } from './rider-registry.js';

/**
 * MANUAL ASSIGNMENT — E1 form only (Contract §2.3 step 10: "Assign one
 * courier manually"). A dispatcher assigns ONE intake task to ONE eligible
 * rider. Store-level invariant seed: at most ONE active assignment per rider
 * AND per task — checked before every insert and exposed for the CI gate.
 * WO-4.3 (SE2.1): the atomic AssignmentLease Durable Object now EXISTS
 * (worker/assignment-lease-do.ts, orchestrated by leased-assignment.ts) and
 * this book is its defense-in-depth second wall — assign() REQUIRES a lease
 * ref, and with a LeaseWitness wired (the production path) a ref the witness
 * doesn't recognize as a real grant from THE authority refuses closed
 * ('no_valid_lease', SE-I01). Rider acknowledgment is server-confirmed only:
 * an offline-queued ack is PENDING and confers no finality; unacknowledged
 * assignments go back to the queue (assignment.expired.v1); a decline is
 * final only when server-confirmed (assignment.declined.v1). No candidate
 * ranking, no auto-assign, no ETA — the dispatcher chooses.
 */

export const ACK_DEADLINE_MS = 5 * 60 * 1000;

/** The lease the assignment proceeds under — taskId/riderId/version name one
 * exact grant of the dispatch authority. */
export interface LeaseRef {
  taskId: string;
  riderId: string;
  version: number;
}

/** Defense in depth (never a second authority): answers "did THE authority
 * really grant this exact ref" — provenance, not liveness; liveness is the
 * Durable Object's job. */
export interface LeaseWitness {
  isGranted(lease: LeaseRef): boolean;
}

export type AssignmentStatus =
  | 'active_unacknowledged'
  | 'ack_pending_offline'
  | 'acknowledged'
  | 'returned_to_queue'
  /** COURSE-REPRISE: the dispatcher took the course back — a NAMED terminal
   * (never a generic « failed »), valid from any active status including
   * `acknowledged`, which until this had no exit at all. */
  | 'taken_back_by_dispatch'
  /** COURSE-LIVRÉE (founder, 2026-08-13): « once delivery and everything is
   * confirmé … on rider's sera app make it close nicely and return to the
   * initial state waiting for another order ». The NAMED SUCCESS terminal —
   * SE-I10 bans generic FAILED terminals, and until this the book had no
   * success exit at all: a finished course stayed `acknowledged` for ever,
   * the rider read « carrying » on every door, and `/rider/moi` served a
   * dead course. Entered ONLY on custody's provider-truth drop confirmation
   * (`custody.transferred_to_customer.v1` is the custody-domain moment this
   * mirrors) — never on a rider's claim: a carrier must never validate their
   * own delivery. */
  | 'delivered';

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
  /** LOCAL audit field — the lease this assignment proceeds under (WO-4.3). */
  lease: LeaseRef;
  /** COURSE-REPRISE audit — who took the course back, and when. LOCAL fields
   * on a LOCAL record: the canon event-name union has no take-back event and
   * widening it is a `contracts/` change (§7), so the record itself is the
   * whole account. Absent on every record that was never taken back. */
  takenBackAt?: string;
  takenBackBy?: string;
  /** COURSE-LIVRÉE audit — the drop instant custody's wire carried (the
   * provider-truth moment, not this book's clock). Same LOCAL-field law as
   * `takenBackAt`: the custody domain owns the canon event; this record is
   * the dispatch book's own account. Absent unless status is 'delivered'. */
  deliveredAt?: string;
}

export type AssignOutcome =
  | { ok: true; assignment: AssignmentRecord; event: PlatformEvent; duplicate: boolean }
  | {
      ok: false;
      reason:
        | 'no_valid_lease'
        | 'task_not_assignable'
        | 'rider_not_assignable'
        | 'rider_already_has_active_assignment'
        | 'task_already_assigned';
      detail?: string;
    };

export type AckOutcome =
  | { ok: true; status: AssignmentStatus; pending: boolean }
  | { ok: false; reason: 'unknown_assignment' | 'not_active' };

export type DeclineOutcome =
  | { ok: true; pending: true; status: AssignmentStatus }
  | { ok: true; pending: false; status: 'returned_to_queue'; event: PlatformEvent }
  | { ok: false; reason: 'unknown_assignment' | 'not_active' };

export type TakeBackOutcome =
  | { ok: true; duplicate: boolean; assignment: AssignmentRecord }
  | { ok: false; reason: 'unknown_assignment' | 'not_active' };

export type DeliverOutcome =
  | { ok: true; duplicate: boolean; assignment: AssignmentRecord }
  /** A PERMANENT condition, never an error: the at-least-once sender must
   * hear a settled answer, or it hammers a 4xx/5xx for ever. */
  | { ok: false; reason: 'no_active_course' };

const ACTIVE_STATUSES: readonly AssignmentStatus[] = ['active_unacknowledged', 'ack_pending_offline', 'acknowledged'];

export interface AssignmentBookSnapshot {
  assignments: [string, AssignmentRecord][];
  appliedCommandIds: [string, AssignOutcome][];
  aggregateVersion: number;
}

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
    /** Optional = test harness; the production path (LeasedDispatch) always
     * wires one. Without it, the ref-identity check below still binds. */
    private readonly witness?: LeaseWitness,
  ) {}

  assign(cmd: {
    command_id: string;
    taskId: string;
    riderId: string;
    dispatcherId: string;
    at: string;
    newAssignmentId: string;
    lease: LeaseRef;
  }): AssignOutcome {
    const replay = this.appliedCommandIds.get(cmd.command_id);
    if (replay?.ok) {
      // ⚠ RELAIS-REPRISE (founder report 2026-08-09, same law as the lease
      // authority): a remembered SUCCESS answers a retry only while its
      // assignment is STILL ACTIVE. Once it expired or was declined back to
      // the queue, the same command id is a NEW dispatch decision — replaying
      // the dead outcome made every re-confier a no-op that reported ok.
      const remembered = this.assignments.get(replay.assignment.assignmentId);
      if (remembered !== undefined && ACTIVE_STATUSES.includes(remembered.status)) {
        return { ...replay, duplicate: true };
      }
    }

    // WO-4.3 defense in depth: the assignment proceeds only under a lease
    // ref that (i) names this exact task+rider and (ii) the wired witness
    // recognizes as a real grant from THE authority (SE-I01). A fabricated
    // or foreign ref refuses closed.
    if (cmd.lease == null || cmd.lease.taskId !== cmd.taskId || cmd.lease.riderId !== cmd.riderId) {
      return { ok: false, reason: 'no_valid_lease' };
    }
    if (this.witness !== undefined && !this.witness.isGranted(cmd.lease)) {
      return { ok: false, reason: 'no_valid_lease' };
    }

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
      lease: { ...cmd.lease },
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

  /**
   * WO-4.3 — rider decline. Only a SERVER-CONFIRMED decline is final:
   * returned_to_queue + requeue + assignment.declined.v1 (actor the rider).
   * An OFFLINE-queued decline is PENDING and confers NOTHING (kernel law:
   * queued = pending, never done) — the assignment stays as it was and the
   * ack deadline still runs. Lease release is the orchestrator's arm
   * (LeasedDispatch.decline), never this store's.
   */
  decline(assignmentId: string, confirmation: 'server_confirmed' | 'queued_offline', at: string): DeclineOutcome {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) return { ok: false, reason: 'unknown_assignment' };
    if (assignment.status !== 'active_unacknowledged' && assignment.status !== 'ack_pending_offline') {
      return { ok: false, reason: 'not_active' };
    }
    if (confirmation === 'queued_offline') {
      return { ok: true, pending: true, status: assignment.status };
    }
    const returned: AssignmentRecord = { ...assignment, status: 'returned_to_queue' };
    this.assignments.set(assignmentId, returned);
    this.queue.requeue(assignment.taskId);
    this.aggregateVersion += 1;
    const event = PlatformEventSchema.parse({
      name: 'assignment.declined.v1',
      envelope: {
        command_id: `decline-${assignmentId}`,
        correlation_id: assignment.correlationId,
        aggregateVersion: this.aggregateVersion,
        actor: `rider:${assignment.riderId}`,
        serverTime: at,
        version: '1',
      },
      payload: {
        delivery_task_id: assignment.taskId,
        order_id: assignment.orderId,
        assignment_id: assignment.assignmentId,
        rider_id: assignment.riderId,
        requeued: true,
      },
    });
    return { ok: true, pending: false, status: 'returned_to_queue', event };
  }

  /**
   * COURSE-REPRISE — the dispatcher takes the course back. Valid from ANY
   * active status: unlike a decline, this is the DISPATCHER'S act, and an
   * `acknowledged` course (whose anchored lease exempts it from every sweep)
   * had no exit at all — a rider stuck carrying a course for ever, and an
   * order no new task could ever be composed for.
   *
   * The task CLOSES (`closed_taken_back`) rather than requeueing: the
   * dispatcher is taking the course off the road, not re-offering it — the
   * ORDER returns to the composable pool at the ops door, and a fresh compose
   * mints a fresh task (with, e.g., the brief the old one never had).
   *
   * Custody is UNTOUCHED by construction: this store never held a custody
   * surface, and the route that drives it is the founder's ops door. A course
   * whose custody has already begun is the custody ledger's affair — nothing
   * here releases, transfers, or erases custody (Ten Laws #3).
   *
   * NO platform event: the canon event-name union (§5.7) carries no
   * take-back name, and widening canon is a §7 founder trigger. The record's
   * own `takenBackAt`/`takenBackBy` and the lease's `releaseCause:
   * 'taken_back'` are the audit.
   *
   * Idempotent by STATE, on purpose: taking back an already-taken-back
   * assignment answers `duplicate: true`. The route accepts only an
   * assignmentId (never a riderId), so a retry can never land on a LATER
   * course the same rider was given — the RELAIS-REPRISE lesson, applied
   * before the bug this time.
   */
  takeBack(assignmentId: string, dispatcherId: string, at: string): TakeBackOutcome {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) return { ok: false, reason: 'unknown_assignment' };
    if (assignment.status === 'taken_back_by_dispatch') {
      return { ok: true, duplicate: true, assignment };
    }
    if (!ACTIVE_STATUSES.includes(assignment.status)) {
      // returned_to_queue: the assignment already ended another way — there is
      // nothing to take back, and saying ok would misreport what happened.
      return { ok: false, reason: 'not_active' };
    }
    const takenBack: AssignmentRecord = {
      ...assignment,
      status: 'taken_back_by_dispatch',
      takenBackAt: at,
      takenBackBy: dispatcherId,
    };
    this.assignments.set(assignmentId, takenBack);
    this.queue.closeTakenBack(assignment.taskId);
    this.aggregateVersion += 1;
    return { ok: true, duplicate: false, assignment: takenBack };
  }

  /**
   * COURSE-LIVRÉE — custody's provider-truth drop confirmation closes the
   * course. By ORDER ID, deliberately: the caller is the custody file, which
   * is keyed by order and knows no assignmentId. Idempotent BY STATE (the
   * take-back door's own law, strictly stronger than a command ledger for a
   * one-way act): a redelivered confirmation finds the course already
   * `delivered` and answers duplicate; an order with NO active course — never
   * assigned, returned to the queue, taken back — answers the named
   * `no_active_course`, a PERMANENT condition the door must turn into a 200.
   *
   * ⚠ THE BOUND OF ORDER-KEYED IDEMPOTENCY, stated rather than hidden: if a
   * DELIVERED order is retired from the board (`forgetOrder` erases the
   * delivered record too) and then re-composed and re-assigned, a stale
   * redelivery of the OLD drop confirmation would land on the NEW course.
   * Reaching that window takes the founder retiring an already-delivered
   * order and re-dispatching the same orderId while custody's ledger still
   * reads `customer` — the custody wire marks its row delivered on first
   * success precisely so it stops redelivering long before then.
   *
   * The QUEUE ROW is deliberately untouched: the task stays `assigned`, so a
   * delivered order can never be re-composed by accident (`/ops/task` refuses
   * `order_already_has_task`) and never resurfaces on `/ops/a-preparer`.
   * `/ops/order/retirer` remains the clean-up door. No platform event: the
   * canon delivery moment (`custody.transferred_to_customer.v1`) is the
   * CUSTODY domain's to emit, and it already did — this record's own
   * `deliveredAt` is the dispatch book's account.
   */
  deliver(orderId: string, at: string): DeliverOutcome {
    const already = [...this.assignments.values()].find(
      (a) => a.orderId === orderId && a.status === 'delivered',
    );
    if (already !== undefined) return { ok: true, duplicate: true, assignment: already };
    const active = [...this.assignments.values()].find(
      (a) => a.orderId === orderId && ACTIVE_STATUSES.includes(a.status),
    );
    if (active === undefined) return { ok: false, reason: 'no_active_course' };
    const delivered: AssignmentRecord = { ...active, status: 'delivered', deliveredAt: at };
    this.assignments.set(active.assignmentId, delivered);
    this.aggregateVersion += 1;
    return { ok: true, duplicate: false, assignment: delivered };
  }

  /** Unacknowledged past deadline → back to the queue (assignment.expired.v1).
   * NOTE (CTO ruling, WO-4.3 commit 3): the LEASED path no longer calls this —
   * LeasedDispatch.expireDue expires by LEASE truth via expireByTasks (an
   * anchored lease never expires, so an in-time-acked assignment is never
   * touched). This deadline-clock form stands for store-level use and its
   * existing tests. */
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

  /**
   * CTO ruling (WO-4.3 commit 3) — THE LEASE IS THE TRUTH; THE BOOK FOLLOWS
   * IT. The leased sweep expires by THE authority's expired set: any
   * ACTIVE-status assignment carrying an expired task returns to the queue —
   * INCLUDING a too-late-acknowledged one (the lease died first; an in-time
   * server-confirmed ack anchored the lease and its task is never in this
   * set). Same canonical event, same actor as the deadline-clock form.
   */
  expireByTasks(taskIds: readonly string[], nowIso: string): { requeued: AssignmentRecord[]; events: PlatformEvent[] } {
    const requeued: AssignmentRecord[] = [];
    const events: PlatformEvent[] = [];
    const expiredTasks = new Set(taskIds);
    for (const assignment of this.assignments.values()) {
      if (!ACTIVE_STATUSES.includes(assignment.status) || !expiredTasks.has(assignment.taskId)) continue;
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

  /**
   * PURGE-ESSAI (founder ruling 2026-08-10) — every assignment this order ever
   * carried leaves the book, whatever its status, and the removed records are
   * RETURNED so the orchestrator can release what they hold: the witness ref
   * on each one, and the lease at THE authority. A purge that dropped the row
   * and left the lease active would strand SE-I01's authority — the rider
   * would read `assignable` on the board and be refused `rider_already_leased`
   * at the door for ever. That is why this method hands the records back
   * instead of swallowing them.
   *
   * Custody is untouched, by construction: this store has never held a custody
   * surface (Ten Laws #3). A purge here removes a DISPATCH row; whatever the
   * custody ledger recorded stays recorded, on its own append-only chain.
   *
   * ⚠ `appliedCommandIds` IS DELIBERATELY LEFT INTACT — the same reasoning as
   * the queue's dedupe set. `assign()`'s replay law already re-evaluates when
   * the remembered assignment is no longer active, and a forgotten record
   * reads exactly as « not active »: a replayed command lands on a fresh
   * evaluation, never on a dead outcome.
   */
  forgetOrder(orderId: string): AssignmentRecord[] {
    const removed = [...this.assignments.values()].filter((a) => a.orderId === orderId);
    for (const record of removed) this.assignments.delete(record.assignmentId);
    return removed;
  }

  /** SE-LIVE-1 — durable composition, ADDITIVE ONLY: full-store snapshot for
   * the LogisticsDO (AssignOutcome carries only JSON-plain data, including
   * the canonical event). No assignment rule above changes. */
  snapshot(): AssignmentBookSnapshot {
    return {
      assignments: [...this.assignments.entries()],
      appliedCommandIds: [...this.appliedCommandIds.entries()],
      aggregateVersion: this.aggregateVersion,
    };
  }

  restore(snap: AssignmentBookSnapshot): void {
    this.assignments.clear();
    for (const [id, record] of snap.assignments) this.assignments.set(id, record);
    this.appliedCommandIds.clear();
    for (const [id, outcome] of snap.appliedCommandIds) this.appliedCommandIds.set(id, outcome);
    this.aggregateVersion = snap.aggregateVersion;
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
