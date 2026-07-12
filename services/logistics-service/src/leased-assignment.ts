import type { PlatformEvent } from '@platform/contracts';
import {
  decideLease,
  emptyLeaseState,
  type LeaseCommand,
  type LeaseDecision,
  type LeaseRecord,
  type LeaseRefusalReason,
} from './assignment-lease.js';
import type { AssignmentBook, AssignmentRecord, DeclineOutcome, LeaseRef } from './manual-assignment.js';
import type { ReadyQueue } from './ready-queue.js';
import type { RescheduleBook, FollowUpOutcome } from './reschedule.js';
import type { RiderRegistry } from './rider-registry.js';

/**
 * WO-4.3 — the LEASED grant path (SE2.1). LeasedDispatch owns the full
 * production route from a dispatcher's command to an assignment: SE1.1
 * re-verification at grant time → THE authority's atomic acquire (the
 * AssignmentLeaseDO — one object, workerd-serialized) under an honest
 * eligibility attestation → the AssignmentBook under the granted lease ref,
 * witness-checked. On any book refusal after a grant, the grant is
 * compensated with the honest LOCAL cause 'grant_rolled_back' — never a
 * borrowed one. Manual dispatcher assignment is the ONLY entry: no
 * auto-assign, no ranking, no routing, no suggestion surface exists here.
 */

/** The async boundary to THE authority — production speaks HTTP to the
 * worker's single /authority/dispatch route; tests speak Miniflare. */
export interface LeaseAuthority {
  send(cmd: LeaseCommand): Promise<LeaseDecision>;
}

/**
 * The sandbox/unit adapter: the SAME pure decideLease core (the law lives
 * once), held in memory with the DO's exact persist-on-non-replay rule.
 * It exists because the browser console sandbox cannot host workerd — it is
 * NOT a second implementation of the law, and it is NOT the production
 * authority: the AssignmentLeaseDO on workerd is (its input gate is the
 * atomicity mechanism, proven in the e2e suite).
 */
export class InMemoryLeaseAuthority implements LeaseAuthority {
  private state = emptyLeaseState();

  send(cmd: LeaseCommand): Promise<LeaseDecision> {
    const decision = decideLease(this.state, cmd);
    if (decision.ok && !decision.idempotentReplay) this.state = decision.state;
    return Promise.resolve(decision);
  }
}

/**
 * The concrete witness the production path wires into the AssignmentBook:
 * a provenance set of the refs THE authority actually granted. Grants are
 * registered on grant, revoked the moment their lease leaves 'active'
 * (release, expiry, rollback) — a stale or fabricated ref refuses closed at
 * the book ('no_valid_lease'). Provenance, never a second authority.
 */
export class GrantedLeaseWitness {
  private readonly granted = new Set<string>();

  private key(lease: LeaseRef): string {
    return `${lease.taskId}|${lease.riderId}|${lease.version}`;
  }

  register(lease: LeaseRef): void {
    this.granted.add(this.key(lease));
  }

  revoke(lease: LeaseRef): void {
    this.granted.delete(this.key(lease));
  }

  isGranted(lease: LeaseRef): boolean {
    return this.granted.has(this.key(lease));
  }
}

const refOf = (lease: LeaseRecord): LeaseRef => ({
  taskId: lease.taskId,
  riderId: lease.riderId,
  version: lease.version,
});

export interface LeasedAssignCommand {
  command_id: string;
  taskId: string;
  riderId: string;
  dispatcherId: string;
  at: string;
  newAssignmentId: string;
}

export type LeasedAssignOutcome =
  | { ok: true; assignment: AssignmentRecord; event: PlatformEvent; lease: LeaseRecord; duplicate: boolean }
  | { ok: false; stage: 'lease'; reason: LeaseRefusalReason }
  | {
      ok: false;
      stage: 'book';
      reason:
        | 'no_valid_lease'
        | 'task_not_assignable'
        | 'rider_not_assignable'
        | 'rider_already_has_active_assignment'
        | 'task_already_assigned';
      detail?: string;
      /** The compensating release's fate (absorbed when no lease was live). */
      leaseRolledBack: boolean;
    };

export class LeasedDispatch {
  constructor(
    private readonly deps: {
      authority: LeaseAuthority;
      witness: GrantedLeaseWitness;
      registry: RiderRegistry;
      queue: ReadyQueue;
      book: AssignmentBook;
      reschedules: RescheduleBook;
    },
  ) {}

  /**
   * The FULL grant path: (a) SE1.1 recheck at grant time, (b) rider
   * assignability, (c) atomic acquire at THE authority under the honest
   * attestation — a false attestation refuses THERE (the off-shift tamper
   * surface), (d) the book under the granted ref. Any book refusal after a
   * grant compensates with release cause 'grant_rolled_back' + witness
   * revocation, so the task is immediately re-grantable and the rolled-back
   * ref confers nothing. NOTE the replay law: a command whose grant was
   * rolled back replays its dead snapshot at the authority and — no longer
   * witnessed — REFUSES CLOSED at the book; a retry needs a fresh command_id
   * (refuse-closed over silent re-grant; asserted in tests).
   */
  async assign(cmd: LeasedAssignCommand): Promise<LeasedAssignOutcome> {
    // (a) + (b): the checks whose booleans the attestation carries.
    const taskCheck = this.deps.queue.recheckAssignable(cmd.taskId);
    const riderAssignable = this.deps.registry.isAssignable(cmd.riderId);
    const queued = this.deps.queue.get(cmd.taskId);
    // (c) atomic acquire — refused unless BOTH attestations are literally true.
    const acquire = await this.deps.authority.send({
      kind: 'acquire',
      command_id: cmd.command_id,
      taskId: cmd.taskId,
      riderId: cmd.riderId,
      grantedAt: cmd.at,
      eligibility: { riderAssignable, taskAssignable: taskCheck.assignable, checkedAt: cmd.at },
      // Refused commands persist nothing; the placeholder never outlives one.
      correlationId: queued?.correlationId ?? 'corr-missing',
    });
    if (!acquire.ok) return { ok: false, stage: 'lease', reason: acquire.reason };
    const lease = acquire.lease;
    if (lease === undefined) {
      // Unreachable for a well-formed acquire; refuse closed rather than trust.
      return { ok: false, stage: 'lease', reason: 'malformed_command' };
    }
    // Only a FRESH grant is (re-)witnessed — a replayed snapshot of a
    // rolled-back grant must not resurrect its ref.
    if (!acquire.idempotentReplay) this.deps.witness.register(refOf(lease));
    // (d) the book, under the granted ref.
    const outcome = this.deps.book.assign({
      command_id: cmd.command_id,
      taskId: cmd.taskId,
      riderId: cmd.riderId,
      dispatcherId: cmd.dispatcherId,
      at: cmd.at,
      newAssignmentId: cmd.newAssignmentId,
      lease: refOf(lease),
    });
    if (outcome.ok) {
      return { ok: true, assignment: outcome.assignment, event: outcome.event, lease, duplicate: outcome.duplicate };
    }
    // Compensation arm: the grant must not outlive the refused assignment.
    this.deps.witness.revoke(refOf(lease));
    const rollback = await this.deps.authority.send({
      kind: 'release',
      command_id: `${cmd.command_id}:rollback`,
      taskId: cmd.taskId,
      cause: 'grant_rolled_back',
    });
    return {
      ok: false,
      stage: 'book',
      reason: outcome.reason,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
      leaseRolledBack: rollback.ok,
    };
  }

  /**
   * Rider decline. The ack path stays untouched (an ack does NOT release the
   * lease — the assignment proceeds under it); only a SERVER-CONFIRMED
   * decline releases (cause 'declined') — an offline-queued decline is
   * pending and releases nothing (kernel law).
   */
  async decline(
    assignmentId: string,
    confirmation: 'server_confirmed' | 'queued_offline',
    at: string,
  ): Promise<DeclineOutcome & { leaseReleased: boolean }> {
    const assignment = this.deps.book.get(assignmentId);
    const outcome = this.deps.book.decline(assignmentId, confirmation, at);
    if (!outcome.ok || outcome.pending || assignment === undefined) {
      return { ...outcome, leaseReleased: false };
    }
    this.deps.witness.revoke(assignment.lease);
    const release = await this.deps.authority.send({
      kind: 'release',
      command_id: `decline-${assignmentId}`,
      taskId: assignment.taskId,
      cause: 'declined',
    });
    return { ...outcome, leaseReleased: release.ok };
  }

  /**
   * ONE sweep drives BOTH stores: THE authority expires every lease past its
   * TTL, the book returns every unacknowledged assignment past its deadline
   * to the queue (assignment.expired.v1) — same 5-minute policy datum, same
   * nowIso, so the two ends stay coherent. Requeue preserves the queue
   * record (correlation lineage intact), and the requeued task's NEXT
   * acquire is a FRESH lease with a new version.
   */
  async expireDue(nowIso: string): Promise<{
    expiredLeases: LeaseRecord[];
    requeued: AssignmentRecord[];
    events: PlatformEvent[];
  }> {
    const decision = await this.deps.authority.send({
      kind: 'expire_due',
      command_id: `expire-due-${nowIso}`,
      nowIso,
    });
    const expiredLeases = decision.ok ? (decision.expired ?? []) : [];
    for (const lease of expiredLeases) this.deps.witness.revoke(refOf(lease));
    const { requeued, events } = this.deps.book.expireUnacknowledged(nowIso);
    return { expiredLeases, requeued, events };
  }

  /**
   * WO-2.7 reschedule wiring: when the follow-up task is admitted and the
   * prior task lawfully closes, the prior task's lease (if one is still
   * active) releases with cause 'reschedule_closed'. The follow-up acquires
   * a FRESH lease ONLY through the full assign() path — SE1.1 re-runs, no
   * bypass. A 'no_active_lease' refusal is absorbed: it IS "no lease was
   * active".
   */
  async openFollowUpTask(args: {
    command_id: string;
    dispatcherId: string;
    priorTaskId: string;
    newTask: unknown;
    at: string;
  }): Promise<FollowUpOutcome & { priorLeaseReleased: boolean }> {
    const outcome = this.deps.reschedules.openFollowUpTask(args);
    if (!outcome.ok || !outcome.intake.admitted) {
      return { ...outcome, priorLeaseReleased: false };
    }
    const release = await this.deps.authority.send({
      kind: 'release',
      command_id: `${args.command_id}:release-prior`,
      taskId: args.priorTaskId,
      cause: 'reschedule_closed',
    });
    if (release.ok && release.lease !== undefined) this.deps.witness.revoke(refOf(release.lease));
    return { ...outcome, priorLeaseReleased: release.ok };
  }

  /** Completion: the delivery closed — the lease releases with the honest
   * cause 'completed'. (No timestamp: the release command carries none by
   * design; the ledgered truth of WHEN lives with the custody records.) */
  async releaseOnCompletion(taskId: string): Promise<{ released: boolean }> {
    const release = await this.deps.authority.send({
      kind: 'release',
      command_id: `complete-${taskId}`,
      taskId,
      cause: 'completed',
    });
    if (release.ok && release.lease !== undefined) this.deps.witness.revoke(refOf(release.lease));
    return { released: release.ok };
  }
}
