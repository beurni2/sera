import {
  DeliveryOutcomeSchema,
  type DeliveryFailureReason,
  type DeliveryOutcome,
  type FaultClass,
} from '@platform/contracts';

/**
 * SE6.1/SE §6.4 — the refusal ladder on the canonical v0.5.0 taxonomy.
 * "Structured reasons; retry/reschedule/return/incident; no generic failed
 * terminal; fault-attributed." Every non-happy resolution here is a
 * canonical DeliveryOutcome — a family-less or 'failed' outcome is
 * UNREPRESENTABLE (strict parse refuses it; gate-proven). The window length
 * and the escalation sets are versioned POLICY DATA (founder-tunable),
 * never hardcoded logic.
 */

export const REFUSAL_LADDER_POLICY_V1 = {
  version: 'refusal-ladder-policy.v1',
  /** SE §6.4: "One retry window (~15 min; …)" — the buyer may settle at an agent inside it. */
  retryWindowMin: 15,
  /**
   * Shop §6.4 verbatim: "Honest absence / provider failure do NOT escalate
   * like change-of-mind/abuse." unusable_location is a location fact, not a
   * buyer choice — it reschedules, never escalates.
   */
  nonEscalatingReasons: ['honest_absence', 'unusable_location', 'provider_failure'],
  /**
   * SE §6.4: the one window expires unresolved → "then buyer-fault refusal"
   * — insufficient_balance (settled-at-agent or not) and the choice/abuse codes.
   */
  escalatingReasons: ['insufficient_balance', 'change_of_mind', 'repeated_abuse', 'fraud'],
  /** Fault attribution per reason (SE §6.5 "Fault attributed on every claim"). */
  faultByReason: {
    honest_absence: 'buyer',
    unusable_location: 'buyer',
    insufficient_balance: 'buyer',
    change_of_mind: 'buyer',
    repeated_abuse: 'buyer',
    fraud: 'buyer',
    provider_failure: 'payment_provider',
  },
} as const satisfies {
  version: string;
  retryWindowMin: number;
  nonEscalatingReasons: readonly DeliveryFailureReason[];
  escalatingReasons: readonly DeliveryFailureReason[];
  faultByReason: Readonly<Record<DeliveryFailureReason, FaultClass>>;
};

export type LadderRefusal =
  | { ok: false; reason: 'reason_not_in_taxonomy'; detail: string }
  | { ok: false; reason: 'window_not_expired' }
  | { ok: false; reason: 'attempt_out_of_sequence' };

export type LadderStep = { ok: true; outcome: DeliveryOutcome };

const isTaxonomyReason = (code: string): code is DeliveryFailureReason =>
  (REFUSAL_LADDER_POLICY_V1.escalatingReasons as readonly string[]).includes(code) ||
  (REFUSAL_LADDER_POLICY_V1.nonEscalatingReasons as readonly string[]).includes(code);

function windowExpiry(at: string): string {
  return new Date(Date.parse(at) + REFUSAL_LADDER_POLICY_V1.retryWindowMin * 60_000).toISOString();
}

/**
 * First refusal at the door: EVERY taxonomy reason gets the ONE retry
 * window (family `retry`, windowExpiresAt honest). Unknown reasons refuse
 * closed — nothing outside the canonical taxonomy is recordable.
 */
export function openRetryWindow(args: {
  taskId: string;
  orderId: string;
  reasonCode: string;
  at: string;
}): LadderStep | LadderRefusal {
  if (!isTaxonomyReason(args.reasonCode)) {
    return { ok: false, reason: 'reason_not_in_taxonomy', detail: args.reasonCode };
  }
  const outcome = DeliveryOutcomeSchema.parse({
    taskId: args.taskId,
    orderId: args.orderId,
    family: 'retry',
    reasonCode: args.reasonCode,
    humanReasonRef: `reason.${args.reasonCode}`,
    faultClass: REFUSAL_LADDER_POLICY_V1.faultByReason[args.reasonCode],
    attempt: { number: 1, at: args.at, windowExpiresAt: windowExpiry(args.at) },
  });
  return { ok: true, outcome };
}

/**
 * The window expired unresolved → the ladder proceeds. Escalating reasons
 * (SE §6.4 "then buyer-fault refusal") become family `return`; honest
 * absence / provider failure / unusable location do NOT escalate — family
 * `reschedule`, same structured record, no buyer-fault consequence.
 */
export function resolveExpiredWindow(args: {
  retryOutcome: DeliveryOutcome;
  now: string;
}): LadderStep | LadderRefusal {
  const { retryOutcome, now } = args;
  if (retryOutcome.family !== 'retry' || retryOutcome.attempt.number !== 1) {
    return { ok: false, reason: 'attempt_out_of_sequence' };
  }
  const expiresAt = retryOutcome.attempt.windowExpiresAt;
  if (expiresAt === undefined || Date.parse(now) < Date.parse(expiresAt)) {
    return { ok: false, reason: 'window_not_expired' };
  }
  const escalates = (REFUSAL_LADDER_POLICY_V1.escalatingReasons as readonly string[]).includes(
    retryOutcome.reasonCode,
  );
  const outcome = DeliveryOutcomeSchema.parse({
    taskId: retryOutcome.taskId,
    orderId: retryOutcome.orderId,
    family: escalates ? 'return' : 'reschedule',
    reasonCode: retryOutcome.reasonCode,
    humanReasonRef: `reason.${retryOutcome.reasonCode}`,
    faultClass: retryOutcome.faultClass,
    attempt: { number: 2, at: now },
  });
  return { ok: true, outcome };
}
