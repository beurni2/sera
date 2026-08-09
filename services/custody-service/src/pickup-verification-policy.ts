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

/**
 * ⚠ FOUNDER RULING (2026-08-09) — POLICY v2, THE PHOTO-REFERENCED CHECK-UP.
 * « the check up will be against these photos but only 2-3 questions … to
 * make sure it looks exactly like what the photos show. »
 *
 * WHAT CHANGED: the supplier's readiness photos now ride the course
 * (COURSE-BRIEF), so the rider compares against a PICTURE instead of holding
 * nine abstract fields in their head at a market stall. Three questions carry
 * the same ground v1 covered:
 *   · `produit_conforme`  ← identity · variant · colour · size_label
 *   · `quantite_complete` ← qty · pieces
 *   · `emballage_intact`  ← damage · manufacturer_seal
 * `order_ref` is not asked because it is already PROVEN: the rider presents
 * the single-use `pickupVerificationCode` minted for THIS order, and the door
 * consumes it before any check is judged.
 *
 * ⚠ WHAT DID NOT CHANGE, DELIBERATELY — the founder's own words were
 * « exactly like what the photos show », and Sera-Build-Spec §6.1 excludes
 * exactly that: riders « do NOT determine authenticity, material quality,
 * cosmetic genuineness, hidden defects, performance, ingredients, warranty,
 * or shade-vs-photo match. » A refusal costs the supplier the order and the
 * pickup fee (§6.1, `faultClass = seller`), so « same product » is asked, and
 * « identical appearance » is not. He was shown the quote and chose the
 * bounded wording (AskUserQuestion, 2026-08-09).
 *
 * Dwell bounds are UNCHANGED (§6.1 « target dwell ≈ 2–4 min »): dwell is
 * RECORDED, never enforced. A three-question check-up will often record
 * under-target — journalled as an ops observation for the founder, not
 * silently retuned here.
 */
export const PICKUP_VERIFICATION_POLICY_V2 = Object.freeze({
  version: 'pickup-verification-policy.v2',
  checks: Object.freeze(['produit_conforme', 'quantite_complete', 'emballage_intact'] as const),
  dwellSecMin: 120,
  dwellSecMax: 240,
});

/** What NEW verifications are judged by. Stored ones keep their own version. */
export const ACTIVE_PICKUP_VERIFICATION_POLICY = PICKUP_VERIFICATION_POLICY_V2;

/**
 * ⚠ REPLAY SAFETY — the reason this is a MAP and not a swap. The custody
 * ledger is not stored: it is RECOMPUTED from the command log on every wake,
 * so every stored `verify_pickup` runs through this function again. Judging a
 * v1 verification by v2's list would make nine lawful checks
 * `check_not_in_policy` on replay and rewrite history that already happened.
 * A command is judged by the policy IT was recorded under, for ever.
 */
const POLICIES: Record<string, typeof PICKUP_VERIFICATION_POLICY_V1 | typeof PICKUP_VERIFICATION_POLICY_V2> = {
  [PICKUP_VERIFICATION_POLICY_V1.version]: PICKUP_VERIFICATION_POLICY_V1,
  [PICKUP_VERIFICATION_POLICY_V2.version]: PICKUP_VERIFICATION_POLICY_V2,
};

export type PolicyCheck = (typeof PICKUP_VERIFICATION_POLICY_V1.checks)[number];

export interface VerificationInput {
  orderId: string;
  riderId: string;
  checkResults: Record<string, boolean>;
  dwellSec: number;
  evidenceBundleId: string;
  custodySealId?: string;
  /** The policy this verification was recorded under. ABSENT means a command
   *  stored before v2 existed — those are v1's, and stay v1's on every replay. */
  policyVersion?: string;
}

export type VerificationOutcome =
  | { ok: true; verification: PickupVerification; dwellRecorded: { dwellSec: number; withinTarget: boolean } }
  | {
      ok: false;
      reason: 'check_not_in_policy' | 'policy_checks_missing' | 'policy_version_unknown';
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
  | { kind: 'invalid'; reason: 'check_not_in_policy' | 'policy_checks_missing' | 'policy_version_unknown'; detail: string } {
  // A command with no version is one recorded before v2 existed: v1, for ever.
  const version = input.policyVersion ?? PICKUP_VERIFICATION_POLICY_V1.version;
  const policy = POLICIES[version];
  // An unknown version is REFUSED, never silently judged by the active policy
  // — falling back would let a rolled-back deploy re-judge a verification
  // under a list its rider never answered.
  if (policy === undefined) return { kind: 'invalid', reason: 'policy_version_unknown', detail: version };
  const policyChecks = policy.checks as readonly string[];
  // Objective conformity ONLY: a check outside THIS command's policy is
  // not runnable (SE-I12).
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
      input.dwellSec >= policy.dwellSecMin &&
      input.dwellSec <= policy.dwellSecMax;
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
