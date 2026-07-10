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
  status: 'queued' | 'assigned';
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
      const existing = [...this.tasks.values()].find(
        (q) => q.correlationId === event.envelope.correlation_id,
      );
      if (existing) return { admitted: true, duplicate: true, task: existing.task };
      // Same command replayed but nothing admitted: it was refused before —
      // re-evaluate rather than replay a refusal that may have healed.
    }
    const taskParse = DeliveryTaskSchema.safeParse(event.payload['task']);
    if (!taskParse.success) return { admitted: false, reason: 'task_not_canonical' };
    const task = taskParse.data;

    const gate = this.admissionGate(task.orderId);
    if (gate !== null) return { admitted: false, reason: gate };

    this.processedCommandIds.add(event.envelope.command_id);
    this.tasks.set(task.id, {
      task,
      orderId: task.orderId,
      correlationId: event.envelope.correlation_id,
      admittedAt: nowIso,
      status: 'queued',
    });
    return { admitted: true, duplicate: false, task };
  }

  /**
   * The SECOND check — at assignment time (SE1.1: "stale → unassignable").
   * A task admitted an hour ago is not trusted on yesterday's projection.
   */
  recheckAssignable(taskId: string): { assignable: true } | { assignable: false; reason: IntakeRefusalReason | 'not_in_queue' | 'already_assigned' } {
    const queued = this.tasks.get(taskId);
    if (!queued) return { assignable: false, reason: 'not_in_queue' };
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
    if (queued) this.tasks.set(taskId, { ...queued, status: 'queued' });
  }

  queuedTasks(): readonly QueuedTask[] {
    return [...this.tasks.values()].filter((q) => q.status === 'queued');
  }
}
