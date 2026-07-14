import type { FlushOutcome } from './offline/outbox';

/**
 * Rider-shell custody flow model (WO-1.3). The check ids MIRROR
 * pickup-verification-policy.v1 — the SERVICE owns the policy; the shell
 * renders its checklist from these ids via catalog keys `check.<id>`.
 * Offline law: evidence sent without the network is queued = PENDING and
 * the drop step stays LOCKED — finality never happens offline. Connectivity
 * is now REAL (SERA-S4: the `offline/connectivity` port, expo-network on
 * device) — the retired `CONNECTIVITY` constant that lied is gone.
 */

export const POLICY_CHECK_IDS = [
  'order_ref',
  'identity',
  'variant',
  'colour',
  'size_label',
  'qty',
  'damage',
  'pieces',
  'manufacturer_seal',
] as const;
export type PolicyCheckId = (typeof POLICY_CHECK_IDS)[number];

export type CustodyStep =
  | 'verify'
  | 'refused'
  | 'seal'
  | 'evidence'
  | 'evidence_pending'
  | 'drop'
  | 'delivered'
  | 'refusal_reason'
  | 'retry_window'
  | 'refused_final'
  | 'reschedule_planned'
  | 'door_inspection'
  | 'payment_wait';

/**
 * WO-2.2 — the refusal ladder's reason ids MIRROR the canonical
 * DELIVERY_FAILURE_REASONS (the SERVICE owns the ladder policy;
 * REFUSAL_LADDER_POLICY_V1 owns the escalation split). The shell renders
 * the picker from these ids via catalog keys `reason.<id>` and walks the
 * arm the policy dictates.
 */
export const FAILURE_REASON_IDS = [
  'honest_absence',
  'unusable_location',
  'insufficient_balance',
  'change_of_mind',
  'repeated_abuse',
  'fraud',
  'provider_failure',
] as const;
export type FailureReasonId = (typeof FAILURE_REASON_IDS)[number];

/** Mirror of the policy's escalation split (Shop §6.4: honest absence /
 * provider failure do NOT escalate like change-of-mind/abuse). */
export const ESCALATING_REASON_IDS: readonly FailureReasonId[] = [
  'insufficient_balance',
  'change_of_mind',
  'repeated_abuse',
  'fraud',
];

export function stepAfterWindowExpiry(reason: FailureReasonId): CustodyStep {
  return ESCALATING_REASON_IDS.includes(reason) ? 'refused_final' : 'reschedule_planned';
}

/**
 * SE-I06 · evidence finality waits for the AUTHORITATIVE SERVER ACK, never for
 * mere connectivity. Capturing evidence queues it (the outbox) = PENDING and the
 * drop stays LOCKED; the ONLY thing that advances it is the server ack — the
 * outbox flush outcome (`assignment-lease.ts` vocabulary): `applied` |
 * `idempotentReplay` settle the evidence and the drop unlocks (through the door
 * inspection, WO-2.4 mapping), while `collision-refused` keeps it PENDING
 * (surfaced, never a silent unlock). This mirrors stepAfterDoorSignal: an
 * EXTERNAL confirmation — not the rider, not being online — moves the locked step.
 */
export function stepAfterEvidenceAck(ack: FlushOutcome): CustodyStep {
  return ack === 'collision-refused' ? 'evidence_pending' : 'drop';
}

/** Sandbox evidence ack (typed data, like SANDBOX_DOOR_SIGNAL): 'applied' so the
 * flow is walkable end-to-end; the live outbox flush drives this at assembly.
 * The rider has NO control over it — capturing evidence never confers finality. */
export const SANDBOX_EVIDENCE_ACK: FlushOutcome = 'applied';

/** WO-2.4 sandbox payment mode + door signal (typed data, like SANDBOX_EVIDENCE_ACK):
 * Option-B so the door flow is walkable; the PROVIDER signal — never the
 * rider — advances payment_wait. 'confirmed' simulates the received signal;
 * the 'pending' branch is the honest waiting screen the live feed drives at
 * assembly. The rider has NO control over this value. */
export const SANDBOX_PAYMENT_MODE: 'FULL_PREPAY' | 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR' = 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR';
export const SANDBOX_DOOR_SIGNAL: 'confirmed' | 'pending' = 'confirmed';

export function stepAfterInspection(mode: typeof SANDBOX_PAYMENT_MODE): CustodyStep {
  // Option-B (SE-I11): inspect → PAY (provider-confirmed) → drop code LAST.
  return mode === 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR' ? 'payment_wait' : 'drop';
}

export function stepAfterDoorSignal(signal: typeof SANDBOX_DOOR_SIGNAL): CustodyStep {
  return signal === 'confirmed' ? 'drop' : 'payment_wait';
}
