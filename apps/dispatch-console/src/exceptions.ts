import type { DeliveryOutcome, DeliveryOutcomeFamily, EvidenceBundle } from '@platform/contracts';

/**
 * WO-6.9-d · D4 — the EXCEPTIONS DESK read-model (PART 8 §4 · Sera-Build-Spec
 * §6.5 · SE-I10). Every failed delivery lands here with a STRUCTURED reason +
 * evidence, and the dispatcher applies EXACTLY ONE outcome from the ratified
 * family **retry · reschedule · return · incident** — and there is NO generic
 * « échec » (SE-I10). Both the family and the reason code are CANONICAL pinned
 * types (`@platform/contracts` v0.9.4: `DeliveryOutcomeFamily` is exactly those
 * four; `DeliveryFailureReason` is the eight structured codes), so a generic
 * "failed" outcome is unrepresentable BY CONSTRUCTION, not by discipline — the
 * type-level proof lives in `test/exceptions.test.ts`.
 *
 * PURE read-model: `import type` only → no value import, nothing to write with;
 * no custody write, no money. The desk RENDERS a resolution — issuing refunds/
 * payouts and mutating custody are NOT the console's (§8.3 MAY-NOT).
 *
 *  - SE-I10: "every failure reason produces an explicit behavior … there is no
 *    generic failed terminal state, and a package is never unowned." → a desk row
 *    whose package has no custodian THROWS « never unowned »; custody stays with
 *    the rider or the hub until the two-key return handoff to the supplier.
 *  - PART 8 §4: "structured reason + evidence" → the row binds the outcome, its
 *    evidence bundle (for the SAME package), and the package's current custodian.
 */

/** Custody legibility for a package at the desk — never unowned (SE-I10). */
export interface DeskCustody {
  readonly packageId: string;
  readonly currentCustodian: string;
}

/** One exception as the desk renders it — structured reason, evidence, one outcome. */
export interface DeskRow {
  readonly taskId: string;
  readonly packageId: string;
  /** SE-I10 / PART 8 §4: exactly one of the four; a generic « échec » is not a value. */
  readonly family: DeliveryOutcomeFamily;
  readonly reasonCode: DeliveryOutcome['reasonCode'];
  /** i18n catalog key for the human reason (register-tagged in the catalog). */
  readonly humanReasonRef: string;
  readonly currentCustodian: string;
  /** Structured evidence is present (SE-I06/SE-I09: evidence supports, never releases). */
  readonly hasEvidence: boolean;
  /** True only for the 'incident' family — rendered loud (the most important case). */
  readonly isIncident: boolean;
}

/**
 * Derive one desk row from a canonical `DeliveryOutcome` + its `EvidenceBundle`
 * + the package's custody truth. The three must describe ONE coherent exception:
 * the evidence is FOR the package in custody, and the package is never unowned.
 * Pure: no write, no clock, no money.
 */
export function deriveDeskRow(
  outcome: DeliveryOutcome,
  evidence: EvidenceBundle,
  custody: DeskCustody,
): DeskRow {
  // SE-I10: a package behind a failed attempt is NEVER unowned — custody stays
  // with the rider or the hub until the two-key return handoff to the supplier.
  if (custody.currentCustodian.trim() === '') {
    throw new Error(`desk: package ${custody.packageId} is unowned (SE-I10: a package is never unowned)`);
  }
  // Structured, not free-floating: the evidence must be FOR this very package.
  if (evidence.packageId !== custody.packageId) {
    throw new Error(
      `desk: evidence packageId ${evidence.packageId} ≠ custody ${custody.packageId} (evidence must bind to its package)`,
    );
  }
  return {
    taskId: outcome.taskId,
    packageId: custody.packageId,
    family: outcome.family,
    reasonCode: outcome.reasonCode,
    humanReasonRef: outcome.humanReasonRef,
    currentCustodian: custody.currentCustodian,
    hasEvidence: evidence.artifacts.length > 0,
    isIncident: outcome.family === 'incident',
  };
}
