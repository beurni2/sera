import { PickupVerificationSchema, type PickupVerification } from '@platform/contracts';

/**
 * SE4.2 — bounded pickup verification. The policy is versioned DATA, its
 * check list the plan's v1 list VERBATIM: order ref / identity / variant /
 * colour / size-label / qty / damage / pieces / mfr-seal. Checks are
 * OBJECTIVE CONFORMITY ONLY — authenticity, quality, and hidden defects are
 * not checks a rider can run and are refused as out-of-policy. Dwell 2–4
 * minutes is RECORDED at E1, not timer-enforced. A refusal produces a
 * structured reason and a fault-attribution SIGNAL (faultClass=seller) —
 * Séra executes no refund and mutates no settlement, ever.
 */

export const PICKUP_VERIFICATION_POLICY_V1 = Object.freeze({
  version: 'pickup-verification-policy.v1',
  checks: Object.freeze([
    'order_ref',
    'identity',
    'variant',
    'colour',
    'size_label',
    'qty',
    'damage',
    'pieces',
    'manufacturer_seal',
  ] as const),
  dwellSecMin: 120,
  dwellSecMax: 240,
});

export type PolicyCheck = (typeof PICKUP_VERIFICATION_POLICY_V1.checks)[number];

export interface VerificationInput {
  orderId: string;
  riderId: string;
  checkResults: Record<string, boolean>;
  dwellSec: number;
  evidenceBundleId: string;
  custodySealId?: string;
}

export type VerificationOutcome =
  | { ok: true; verification: PickupVerification; dwellRecorded: { dwellSec: number; withinTarget: boolean } }
  | {
      ok: false;
      reason: 'check_not_in_policy' | 'policy_checks_missing';
      detail: string;
    };

export type FaultSignal = {
  name: 'protection.claim_opened.v1';
  faultClass: 'seller';
  orderId: string;
  failedChecks: readonly string[];
};

export function runPickupVerification(input: VerificationInput):
  | { kind: 'accepted'; verification: PickupVerification; dwell: { dwellSec: number; withinTarget: boolean } }
  | { kind: 'refused'; verification: PickupVerification; faultSignal: FaultSignal; failedChecks: readonly string[] }
  | { kind: 'invalid'; reason: 'check_not_in_policy' | 'policy_checks_missing'; detail: string } {
  const policyChecks = PICKUP_VERIFICATION_POLICY_V1.checks as readonly string[];
  // Objective conformity ONLY: a check outside policy v1 is not runnable.
  for (const name of Object.keys(input.checkResults)) {
    if (!policyChecks.includes(name)) {
      return { kind: 'invalid', reason: 'check_not_in_policy', detail: name };
    }
  }
  const missing = policyChecks.filter((c) => !(c in input.checkResults));
  if (missing.length > 0) {
    return { kind: 'invalid', reason: 'policy_checks_missing', detail: missing.join(',') };
  }

  const failedChecks = policyChecks.filter((c) => input.checkResults[c] !== true);
  const accepted = failedChecks.length === 0;
  const verification = PickupVerificationSchema.parse({
    orderId: input.orderId,
    riderId: input.riderId,
    checks: policyChecks.map((check) => ({ check, passed: input.checkResults[check] === true })),
    result: accepted ? 'accepted' : 'refused',
    ...(accepted ? {} : { rejectionReason: `conformity_mismatch:${failedChecks.join(',')}` }),
    ...(input.custodySealId !== undefined ? { custodySealId: input.custodySealId } : {}),
    evidenceBundleId: input.evidenceBundleId,
  });

  if (accepted) {
    const withinTarget =
      input.dwellSec >= PICKUP_VERIFICATION_POLICY_V1.dwellSecMin &&
      input.dwellSec <= PICKUP_VERIFICATION_POLICY_V1.dwellSecMax;
    return { kind: 'accepted', verification, dwell: { dwellSec: input.dwellSec, withinTarget } };
  }
  // Mismatch → refuse custody; fault attribution is a SIGNAL for
  // commerce-core (fund routing is E2 work there). Nothing here refunds.
  return {
    kind: 'refused',
    verification,
    failedChecks,
    faultSignal: { name: 'protection.claim_opened.v1', faultClass: 'seller', orderId: input.orderId, failedChecks },
  };
}
