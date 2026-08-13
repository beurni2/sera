import type { PlatformEvent } from '@platform/contracts';
import {
  decideLease,
  emptyLeaseState,
  type LeaseCommand,
  type LeaseDecision,
  type LeaseRecord,
  type LeaseRefusalReason,
} from './assignment-lease.js';
import type {
  AckOutcome,
  AssignmentBook,
  AssignmentRecord,
  DeclineOutcome,
  DeliverOutcome,
  LeaseRef,
  TakeBackOutcome,
} from './manual-assignment.js';
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

  /** SE-LIVE-1 — durable composition, ADDITIVE ONLY: the provenance set as a
   * plain snapshot so the LogisticsDO restores it exactly (never rebuilt by
   * inference from lease state — provenance stays explicit). */
  snapshot(): string[] {
    return [...this.granted];
  }

  restore(keys: readonly string[]): void {
    this.granted.clear();
    for (const key of keys) this.granted.add(key);
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
   * ref confers nothing. THE REPLAY LAW (RELAIS-REPRISE, founder 2026-08-09):
   * a dedupe record answers a retry only while its remembered grant/assignment
   * is STILL ALIVE — the double-tap over a live course replays as duplicate;
   * a command whose outcome died (expired, declined, rolled back) RE-EVALUATES
   * and answers with the current truth. The old poison-pill (dead snapshot →
   * no_valid_lease for ever) silently no-op'd every re-relay of a requeued
   * course; asserted in leased-dispatch + shift-acts e2e.
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
    // ⚠ The rollback id names the GRANT VERSION (RELAIS-REPRISE): a retried
    // command that earned a FRESH grant needs a fresh release — deriving the
    // id from the command alone made the second rollback replay the first and
    // leave the new lease alive, deadlocking the task.
    this.deps.witness.revoke(refOf(lease));
    const rollback = await this.deps.authority.send({
      kind: 'release',
      command_id: `${cmd.command_id}:rollback:v${lease.version}`,
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
   * Rider ack (CTO ruling, WO-4.3 commit 3): a SERVER-CONFIRMED ack ANCHORS
   * the lease at THE authority — the proposal was answered in time
   * (WO-1.2's seed expires ONLY unacknowledged assignments; the TTL is the
   * ANSWER deadline), so the anchored lease is exempt from expire_due and
   * ends only by release. An offline-queued ack anchors NOTHING (queued =
   * pending, never done) — the answer deadline still runs.
   */
  async acknowledge(
    assignmentId: string,
    confirmation: 'server_confirmed' | 'queued_offline',
    at: string,
  ): Promise<AckOutcome & { anchored: boolean }> {
    const assignment = this.deps.book.get(assignmentId);
    const outcome = this.deps.book.acknowledge(assignmentId, confirmation);
    if (!outcome.ok || outcome.pending || assignment === undefined) {
      return { ...outcome, anchored: false };
    }
    const anchor = await this.deps.authority.send({
      kind: 'anchor',
      command_id: `ack-${assignmentId}`,
      taskId: assignment.taskId,
      at,
    });
    // THE RACE, documented: 'no_active_lease' here means the ack arrived
    // AFTER the lease died at THE authority (a sweep expired it in the
    // interleave). The authority's truth wins — expireDue's expireByTasks
    // overrides the too-late ack back to returned_to_queue; we report
    // anchored:false and change nothing else here.
    return { ...outcome, anchored: anchor.ok };
  }

  /**
   * Rider decline. Only a SERVER-CONFIRMED decline releases the lease
   * (cause 'declined') — an offline-queued decline is pending and releases
   * nothing (kernel law). A post-ack decline is impossible: the book
   * refuses 'not_active' for an acknowledged assignment.
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
   * ONE sweep, ONE truth (CTO ruling, WO-4.3 commit 3): THE authority
   * expires every UNANCHORED lease past its TTL, and the book FOLLOWS the
   * lease — expireByTasks returns exactly the expired tasks' assignments to
   * the queue (assignment.expired.v1). An in-time server-confirmed ack
   * anchored its lease, so its task is never in the expired set and the
   * assignment is never touched; a too-late interleaved ack is OVERRIDDEN
   * back to returned_to_queue — the lease died first. Requeue preserves the
   * queue record (correlation lineage intact), and the requeued task's NEXT
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
    // SE-LIVE-1 verifier BLOCKER: a REPLAYED sweep drives NOTHING. The
    // authority answers the ORIGINAL expired snapshot without touching lease
    // state — but expireByTasks matches by taskId alone, so re-driving the
    // book with that stale list returned tasks re-granted (and even ACKED)
    // since the first application back to the queue, stranding an anchored
    // rider forever. A retried sweep POST with the same instant is the
    // natural retry the command-id design invites; it must be harmless.
    if (decision.ok && decision.idempotentReplay) {
      return { expiredLeases: decision.expired ?? [], requeued: [], events: [] };
    }
    const expiredLeases = decision.ok ? (decision.expired ?? []) : [];
    for (const lease of expiredLeases) this.deps.witness.revoke(refOf(lease));
    const { requeued, events } = this.deps.book.expireByTasks(
      expiredLeases.map((lease) => lease.taskId),
      nowIso,
    );
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

  /**
   * COURSE-REPRISE — the dispatcher takes the course back. The book records
   * the named terminal (`taken_back_by_dispatch`, task → `closed_taken_back`),
   * then the lease releases at THE authority with cause 'taken_back' — the
   * release the anchor ruling reserves as an anchored lease's only exit. On a
   * duplicate (already taken back) the lease was already released by the first
   * application; re-sending would only replay idempotently, so it is skipped.
   */
  async takeBack(
    assignmentId: string,
    dispatcherId: string,
    at: string,
  ): Promise<TakeBackOutcome & { leaseReleased: boolean }> {
    const assignment = this.deps.book.get(assignmentId);
    const outcome = this.deps.book.takeBack(assignmentId, dispatcherId, at);
    if (!outcome.ok || outcome.duplicate || assignment === undefined) {
      return { ...outcome, leaseReleased: false };
    }
    this.deps.witness.revoke(assignment.lease);
    const release = await this.deps.authority.send({
      kind: 'release',
      command_id: `take-back-${assignmentId}`,
      taskId: assignment.taskId,
      cause: 'taken_back',
    });
    return { ...outcome, leaseReleased: release.ok };
  }

  /**
   * PURGE-ESSAI — the founder RETIRES one order from the dispatch board
   * (founder ruling 2026-08-10: « board yes, custody no »). Book, queue, lease
   * and witness move together, here, because they are the three stores SE-I01
   * keeps in step: forgetting a dispatch row while THE authority still holds
   * its lease would leave the rider reading `assignable` on the board and
   * being refused `rider_already_leased` at the door, for ever.
   *
   * Ordering is deliberate: the book and the queue are forgotten first (so no
   * read can see a half-purged course), then every task the order ever had —
   * the queue's rows AND the tasks the removed assignments name, unioned, so a
   * lease can never be missed by a row that was already gone — is released at
   * THE authority with the honest cause 'retire'. A `no_active_lease` refusal
   * is absorbed: it IS « no lease was active », the ordinary case for a course
   * that already ended.
   *
   * The lease HISTORY stays: leases are append-only at the authority, and a
   * released record naming a retired task is the truthful account of what
   * happened. It blocks nothing — only ACTIVE leases are ever consulted, and a
   * task id is CSPRNG-minted per compose, never reused.
   *
   * CUSTODY IS NOT TOUCHED, anywhere in this path — no custody store is
   * reachable from this orchestrator, and the founder's ruling keeps the
   * custody ledger's append-only proof exactly where it is (Ten Laws #3).
   */
  async forgetOrder(orderId: string): Promise<{
    taskIds: string[];
    assignments: AssignmentRecord[];
    leasesReleased: number;
  }> {
    const assignments = this.deps.book.forgetOrder(orderId);
    const queueTaskIds = this.deps.queue.forgetOrder(orderId);
    const taskIds = [...new Set([...queueTaskIds, ...assignments.map((a) => a.taskId)])];
    for (const assignment of assignments) this.deps.witness.revoke(assignment.lease);
    let leasesReleased = 0;
    for (const taskId of taskIds) {
      const release = await this.deps.authority.send({
        kind: 'release',
        /**
         * ⚠ VERIFIER MAJOR (PURGE-ESSAI round 1) — A FRESH ID EVERY TIME, and
         * the reason is the opposite of the usual one. My first cut used the
         * deterministic `retire-${taskId}`, justified by « a task id is minted
         * once and never reused » — WHICH IS FALSE: `/ops/task` mints ids, but
         * `/intake/task-ready` takes the id off the producer's event, and a
         * purge DELETES the queue row rather than closing it, so the
         * already-claimed guard no longer blocks that id either. The verifier
         * drove the real core: retire → the id re-composes and a NEW lease is
         * acquired (version 2) → the second retire REPLAYS the version-1
         * release, `ok:true` with `idempotentReplay`, so the live lease
         * survived, the wrong witness ref was revoked, the count reported a
         * release that never happened, and the rider was refused
         * `rider_already_leased` for ever with no dispatch row left to take
         * back. Replay protection is exactly wrong for a purge: each purge
         * must release WHATEVER lease is live now.
         */
        command_id: `retire-${taskId}-${crypto.randomUUID()}`,
        taskId,
        cause: 'retire',
      });
      // COUNTED ONLY WHEN IT ACTUALLY HAPPENED — a replay is not a release,
      // and a response that says otherwise is a lie the founder would act on.
      if (!release.ok || release.idempotentReplay === true) continue;
      leasesReleased += 1;
      if (release.lease !== undefined) this.deps.witness.revoke(refOf(release.lease));
    }
    return { taskIds, assignments, leasesReleased };
  }

  /**
   * COURSE-LIVRÉE — custody's provider-truth drop confirmation ends the
   * course as the NAMED SUCCESS. The book records `delivered` (idempotent by
   * state), then — on the FIRST application only — the witness ref is revoked
   * and the lease releases at THE authority with the honest cause 'completed':
   * an ANCHORED lease is exempt from every sweep and « ends only by release »
   * (the anchor ruling), so without this arm the delivered rider would read
   * `assignable` on the board and be refused `rider_already_leased` at the
   * door for ever — the exact stranding PURGE-ESSAI names. A duplicate
   * releases nothing: the first application already did, and the take-back
   * arm's own skip law applies. The deterministic release id is safe here
   * because the book's state gate means this path runs at most once per
   * assignment, and a delivered course's task is never requeued or re-leased.
   *
   * ⚠ BOUND (verifier NOTE): the never-retry on duplicate is safe ONLY while
   * `authority` is the in-process lease decider, whose release can refuse
   * nothing but `no_active_lease` (= already free). A remote or otherwise
   * fallible LeaseAuthority substituted here would make `leaseReleased:false`
   * a stranding, and this arm would need a retry road it deliberately lacks.
   */
  async deliver(orderId: string, at: string): Promise<DeliverOutcome & { leaseReleased: boolean }> {
    const outcome = this.deps.book.deliver(orderId, at);
    if (!outcome.ok || outcome.duplicate) return { ...outcome, leaseReleased: false };
    this.deps.witness.revoke(outcome.assignment.lease);
    const release = await this.deps.authority.send({
      kind: 'release',
      command_id: `complete-${outcome.assignment.taskId}`,
      taskId: outcome.assignment.taskId,
      cause: 'completed',
    });
    return { ...outcome, leaseReleased: release.ok };
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
