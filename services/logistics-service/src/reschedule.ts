import {
  DeliveryOutcomeSchema,
  DeliveryTaskSchema,
  PlatformEventSchema,
  type DeliveryOutcome,
  type DeliveryTask,
} from '@platform/contracts';
import type { ReadyQueue, IntakeOutcome } from './ready-queue.js';

/**
 * WO-2.7 item 4 — the reschedule → NEW-task path (the WO-2.2 verifier's
 * named gap). From a canonical `reschedule` DeliveryOutcome the DISPATCHER
 * may open ONE follow-up DeliveryTask: a NEW delivery_task_id on the SAME
 * order chain, with attempt lineage (priorTaskIds — a LOCAL record beside
 * the canonical task, never inside it: the pinned DeliveryTask is strict).
 * The old task closes lawfully — closing a task moves NO custody: the
 * package's custodian is whoever the custody ledger says, before and after.
 * The new task then faces the FULL WO-1.2 intake discipline again
 * (funded-per-mode + readiness-confirmed + non-cancelled + NOT STALE, at
 * intake AND at assignment) — a reschedule buys a new attempt, never a
 * bypass. Everything not explicitly allowed refuses closed.
 */

export type FollowUpRefusal =
  | 'order_not_rescheduled'
  | 'prior_task_mismatch'
  | 'task_not_canonical'
  | 'not_a_new_task_id'
  | 'order_mismatch'
  | 'follow_up_already_opened';

export type FollowUpOutcome =
  | { ok: true; task: DeliveryTask; priorTaskIds: readonly string[]; intake: IntakeOutcome }
  | { ok: false; reason: FollowUpRefusal };

export class RescheduleBook {
  /** orderId → the recorded reschedule outcome awaiting its follow-up. */
  private readonly openReschedules = new Map<string, DeliveryOutcome>();
  /** newTaskId → full prior-task lineage (attempt ancestry). */
  private readonly lineage = new Map<string, readonly string[]>();

  constructor(private readonly queue: ReadyQueue) {}

  /**
   * Only a CANONICAL outcome of family `reschedule` opens the path — a
   * retry, return, or incident outcome refuses closed, as does anything
   * that fails the strict parse.
   */
  recordRescheduleOutcome(raw: unknown): { ok: true; orderId: string } | { ok: false; reason: 'outcome_not_canonical' | 'not_a_reschedule_outcome' } {
    const parsed = DeliveryOutcomeSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'outcome_not_canonical' };
    if (parsed.data.family !== 'reschedule') return { ok: false, reason: 'not_a_reschedule_outcome' };
    this.openReschedules.set(parsed.data.orderId, parsed.data);
    return { ok: true, orderId: parsed.data.orderId };
  }

  /**
   * Dispatcher opens the follow-up task. The prior task closes lawfully
   * (custody untouched — no custody API is even reachable from here) and
   * the new task goes through ReadyQueue.onTaskReady: the SAME admission
   * gate that admitted the first attempt re-verifies everything.
   */
  openFollowUpTask(args: {
    command_id: string;
    dispatcherId: string;
    priorTaskId: string;
    newTask: unknown;
    at: string;
  }): FollowUpOutcome {
    const taskParse = DeliveryTaskSchema.safeParse(args.newTask);
    if (!taskParse.success) return { ok: false, reason: 'task_not_canonical' };
    const task = taskParse.data;

    const outcome = this.openReschedules.get(task.orderId);
    if (outcome === undefined) return { ok: false, reason: 'order_not_rescheduled' };
    if (outcome.taskId !== args.priorTaskId) return { ok: false, reason: 'prior_task_mismatch' };
    if (task.id === args.priorTaskId) return { ok: false, reason: 'not_a_new_task_id' };
    if (task.orderId !== outcome.orderId) return { ok: false, reason: 'order_mismatch' };
    if (this.lineage.has(task.id)) return { ok: false, reason: 'follow_up_already_opened' };

    const priorTaskIds: readonly string[] = [...(this.lineage.get(args.priorTaskId) ?? []), args.priorTaskId];
    const intake = this.queue.onTaskReady(
      PlatformEventSchema.parse({
        name: 'logistics.task_ready.v1',
        envelope: {
          command_id: args.command_id,
          correlation_id: `corr-${task.orderId}`,
          aggregateVersion: 1,
          actor: `logistics-service:reschedule:${args.dispatcherId}`,
          serverTime: args.at,
          version: '1',
        },
        payload: { task },
      }),
      args.at,
    );
    if (!intake.admitted) {
      // The WO-1.2 gate refused the new attempt (unfunded/unready/cancelled/
      // stale) — the reschedule stays open and the PRIOR task stays as it
      // was: nothing closes until its replacement actually exists.
      return { ok: true, task, priorTaskIds, intake };
    }
    // Lawful close of the prior attempt's task: a queue-state change ONLY.
    // Custody lives in the custody ledger and is not touched from here —
    // the current custodian before this line is the current custodian after.
    this.queue.closeRescheduled(args.priorTaskId);
    this.lineage.set(task.id, priorTaskIds);
    this.openReschedules.delete(task.orderId);
    return { ok: true, task, priorTaskIds, intake };
  }

  priorTaskIdsOf(taskId: string): readonly string[] {
    return this.lineage.get(taskId) ?? [];
  }
}
