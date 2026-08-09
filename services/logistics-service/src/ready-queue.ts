import {
  DeliveryTaskSchema,
  PlatformEventSchema,
  type DeliveryTask,
} from '@platform/contracts';

/**
 * SE1.1 — ready-queue intake. A task_ready event is admitted ONLY when the
 * order is funded per its payment mode AND readiness-confirmed AND
 * non-cancelled — checked against projections that can be STALE, so the
 * check runs TWICE: at intake and again at assignment time ("stale →
 * unassignable"). Idempotent on envelope.command_id; everything not
 * explicitly admitted REFUSES CLOSED. Séra never computes any of these
 * truths — it consumes Shop+ funding and Boutik+ readiness signals (both
 * §3-misbehaving mocks until E1 assembly).
 */

export interface FundingCheck {
  status: 'funded' | 'unfunded' | 'cancelled' | 'unknown';
  paymentMode: string;
  asOf: string;
  /** The projection admits it may be behind the truth. */
  stale: boolean;
}

export interface ReadinessCheck {
  ready: boolean;
  asOf: string;
  stale: boolean;
}

export interface IntakeProjections {
  funding: { check: (orderId: string) => FundingCheck };
  readiness: { check: (orderId: string) => ReadinessCheck };
}

export type IntakeRefusalReason =
  | 'not_a_platform_event'
  | 'unexpected_event_name'
  | 'task_not_canonical'
  | 'task_id_already_claimed'
  | 'not_funded_for_mode'
  | 'funding_projection_stale'
  | 'not_readiness_confirmed'
  | 'readiness_projection_stale'
  | 'order_cancelled'
  | 'payment_mode_not_available_e1';

export type IntakeOutcome =
  | { admitted: true; duplicate: boolean; task: DeliveryTask }
  | { admitted: false; reason: IntakeRefusalReason };

export interface QueuedTask {
  task: DeliveryTask;
  orderId: string;
  correlationId: string;
  admittedAt: string;
  /** SE-LIVE-2c verifier round 2 — WHICH COMMAND PUT THIS TASK HERE. The ops
   * door's « one open task per order » rule must exempt a replay of the SAME
   * compose without exempting any command that merely exists somewhere in the
   * processed set; only per-task provenance can tell those apart. */
  admittedByCommandId: string;
  /** `closed_rescheduled` (WO-2.7): the attempt ended in a reschedule and a
   * follow-up task replaced this one — closed lawfully, never assignable
   * again, custody untouched by the closure.
   * `closed_taken_back` (COURSE-REPRISE): the dispatcher took the course back
   * before custody began — same closure laws (never assignable, never
   * requeued, custody untouched), but the ORDER goes back to the composable
   * pool: unlike a reschedule, nothing replaces this task automatically. */
  status: 'queued' | 'assigned' | 'closed_rescheduled' | 'closed_taken_back';
}

export class ReadyQueue {
  private readonly tasks = new Map<string, QueuedTask>();
  private readonly processedCommandIds = new Set<string>();

  constructor(private readonly projections: IntakeProjections) {}

  /** Intake (first check). The emitter redelivers refused events after fixing upstream state. */
  onTaskReady(raw: unknown, nowIso: string): IntakeOutcome {
    const parsed = PlatformEventSchema.safeParse(raw);
    if (!parsed.success) return { admitted: false, reason: 'not_a_platform_event' };
    const event = parsed.data;
    if (event.name !== 'logistics.task_ready.v1') {
      return { admitted: false, reason: 'unexpected_event_name' };
    }
    if (this.processedCommandIds.has(event.envelope.command_id)) {
      /**
       * ⚠ A DEDUPE RECORD MUST NEVER IMMORTALIZE A DEAD OUTCOME (verifier
       * blocker, COURSE-REPRISE round — the same RELAIS-REPRISE law already
       * applied at the book and the lease authority, which this door alone
       * still lacked). The founder composes by hand and re-runs saved
       * commands; matching the remembered admission by correlation ALONE
       * found the `closed_taken_back` task, answered « ok (duplicate) » over
       * a task nobody can ever be given, and filed the NEW brief (the voice
       * note + photos he re-composed FOR) onto the dead row. A replay answers
       * duplicate only while its task is still ALIVE; a closed one falls
       * through to a fresh admission, as a re-compose always was in the
       * dispatcher's head.
       */
      const existing = [...this.tasks.values()].find(
        (q) =>
          q.correlationId === event.envelope.correlation_id &&
          q.status !== 'closed_rescheduled' &&
          q.status !== 'closed_taken_back',
      );
      if (existing) return { admitted: true, duplicate: true, task: existing.task };
      // Same command replayed but nothing admitted: it was refused before —
      // re-evaluate rather than replay a refusal that may have healed.
    }
    const taskParse = DeliveryTaskSchema.safeParse(event.payload['task']);
    if (!taskParse.success) return { admitted: false, reason: 'task_not_canonical' };
    const task = taskParse.data;

    /**
     * SE-LIVE-2c verifier BLOCKER — A TASK ID IS CLAIMED ONCE. `tasks.set` is
     * an unconditional overwrite, so an event naming an id this queue already
     * holds silently replaced that row: another order's address on a live
     * task, a `closed_rescheduled` task resurrected to `queued`, an assigned
     * task re-queued for a second custodian. A distinct command naming an
     * existing id is a COLLISION, never an update — refuse closed. (A replay
     * of the same command_id is handled above and still answers duplicate.)
     */
    if (this.tasks.has(task.id)) return { admitted: false, reason: 'task_id_already_claimed' };

    const gate = this.admissionGate(task.orderId);
    if (gate !== null) return { admitted: false, reason: gate };

    this.processedCommandIds.add(event.envelope.command_id);
    this.tasks.set(task.id, {
      task,
      orderId: task.orderId,
      correlationId: event.envelope.correlation_id,
      admittedAt: nowIso,
      admittedByCommandId: event.envelope.command_id,
      status: 'queued',
    });
    return { admitted: true, duplicate: false, task };
  }

  /**
   * The SECOND check — at assignment time (SE1.1: "stale → unassignable").
   * A task admitted an hour ago is not trusted on yesterday's projection.
   */
  recheckAssignable(taskId: string): { assignable: true } | { assignable: false; reason: IntakeRefusalReason | 'not_in_queue' | 'already_assigned' | 'task_closed' } {
    const queued = this.tasks.get(taskId);
    if (!queued) return { assignable: false, reason: 'not_in_queue' };
    if (queued.status === 'closed_rescheduled' || queued.status === 'closed_taken_back') {
      return { assignable: false, reason: 'task_closed' };
    }
    if (queued.status !== 'queued') return { assignable: false, reason: 'already_assigned' };
    const gate = this.admissionGate(queued.orderId);
    if (gate !== null) return { assignable: false, reason: gate };
    return { assignable: true };
  }

  /** Shared admission rule: funded-per-mode + readiness-confirmed + non-cancelled + NOT STALE. */
  private admissionGate(orderId: string): IntakeRefusalReason | null {
    const funding = this.projections.funding.check(orderId);
    if (funding.status === 'cancelled') return 'order_cancelled';
    if (funding.stale) return 'funding_projection_stale';
    if (funding.paymentMode !== 'FULL_PREPAY') return 'payment_mode_not_available_e1';
    if (funding.status !== 'funded') return 'not_funded_for_mode';
    const readiness = this.projections.readiness.check(orderId);
    if (readiness.stale) return 'readiness_projection_stale';
    if (!readiness.ready) return 'not_readiness_confirmed';
    return null;
  }

  get(taskId: string): QueuedTask | undefined {
    return this.tasks.get(taskId);
  }

  markAssigned(taskId: string): void {
    const queued = this.tasks.get(taskId);
    if (queued) this.tasks.set(taskId, { ...queued, status: 'assigned' });
  }

  requeue(taskId: string): void {
    const queued = this.tasks.get(taskId);
    // A closed task stays closed — an expiring stale assignment must not
    // resurrect an attempt that a follow-up task already replaced (WO-2.7),
    // and a taken-back course must not ride back into the queue on a sweep.
    if (queued && queued.status !== 'closed_rescheduled' && queued.status !== 'closed_taken_back') {
      this.tasks.set(taskId, { ...queued, status: 'queued' });
    }
  }

  /** WO-2.7 item 4: the rescheduled attempt's task closes — a queue-state
   * change only; no custody surface exists here. A closed task can never be
   * re-checked assignable or requeued back to life by accident. */
  closeRescheduled(taskId: string): void {
    const queued = this.tasks.get(taskId);
    if (queued) this.tasks.set(taskId, { ...queued, status: 'closed_rescheduled' });
  }

  /** COURSE-REPRISE: the dispatcher took the course back — the task closes
   * under the same never-resurrect laws as a reschedule closure. The ORDER's
   * return to the composable pool is the ops door's affair (`/ops/task` and
   * `/ops/a-preparer` exempt this status); the queue only closes honestly. */
  closeTakenBack(taskId: string): void {
    const queued = this.tasks.get(taskId);
    if (queued) this.tasks.set(taskId, { ...queued, status: 'closed_taken_back' });
  }

  queuedTasks(): readonly QueuedTask[] {
    return [...this.tasks.values()].filter((q) => q.status === 'queued');
  }

  /** SE-LIVE-1 — durable composition, ADDITIVE ONLY: the LogisticsDO persists
   * this store as a plain snapshot and rebuilds it on wake. The snapshot is
   * the WHOLE truth of this store; no admission behavior changes. */
  snapshot(): ReadyQueueSnapshot {
    return { tasks: [...this.tasks.entries()], processedCommandIds: [...this.processedCommandIds] };
  }

  restore(snap: ReadyQueueSnapshot): void {
    this.tasks.clear();
    for (const [id, queued] of snap.tasks) this.tasks.set(id, queued);
    this.processedCommandIds.clear();
    for (const id of snap.processedCommandIds) this.processedCommandIds.add(id);
  }
}

export interface ReadyQueueSnapshot {
  tasks: [string, QueuedTask][];
  processedCommandIds: string[];
}
