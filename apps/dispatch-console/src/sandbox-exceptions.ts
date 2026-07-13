import type { DeliveryOutcome, EvidenceBundle } from '@platform/contracts';
import type { DeskCustody } from './exceptions';

/**
 * WO-6.9-d · D4 — SANDBOX exceptions-desk data (runtime DATA; UI strings live in
 * the i18n catalog). Obviously-demo (« (démo) ») so it can never pass for a real
 * queue. Each row is a canonical `DeliveryOutcome` (family from the ratified four)
 * + its `EvidenceBundle` + custody truth (never unowned). The dispatcher DECIDES
 * the outcome — the reason→family pairing below is ILLUSTRATIVE, never a rule
 * (no deterministic mapping, no ML: PART 8 §1). NO custody write, no money.
 */

// A fixed demo clock so the desk is byte-stable in the gallery (WO-6.4 discipline).
const AT = '2026-07-12T09:00:00.000Z';

export interface DeskEntry {
  /** Landmark/name label for the package (SE0.3) — never a raw id. */
  readonly label: string;
  readonly outcome: DeliveryOutcome;
  readonly evidence: EvidenceBundle;
  readonly custody: DeskCustody;
}

const entry = (
  label: string,
  packageId: string,
  currentCustodian: string,
  family: DeliveryOutcome['family'],
  reasonCode: DeliveryOutcome['reasonCode'],
  humanReasonRef: string,
  faultClass: DeliveryOutcome['faultClass'],
): DeskEntry => {
  const taskId = `task-${packageId}`;
  return {
    label,
    outcome: { taskId, orderId: `ord-${packageId}`, family, reasonCode, humanReasonRef, faultClass, attempt: { number: 1, at: AT } },
    evidence: {
      taskId,
      packageId,
      custodySealId: `seal-${packageId}`,
      artifacts: [{ ref: `media/${packageId}-1`, sha256: `sha-${packageId}`, mimeType: 'image/jpeg' }],
      capturedAt: AT,
    },
    custody: { packageId, currentCustodian },
  };
};

/** The routine desk: three explicit outcomes — a new try, another pass, a return. */
export const SANDBOX_DESK_ROUTINE: readonly DeskEntry[] = [
  entry('Colis pour Awa (démo)', 'pkg-awa', 'rider:issa', 'reschedule', 'honest_absence', 'console.reason_honest_absence', 'buyer'),
  entry('Colis pour Bori (démo)', 'pkg-bori', 'rider:issa', 'retry', 'provider_failure', 'console.reason_provider_failure', 'payment_provider'),
  entry('Colis pour Noaga (démo)', 'pkg-noaga', 'hub:ouaga', 'return', 'insufficient_balance', 'console.reason_insufficient_balance', 'buyer'),
];

/** The desk with the loud case: a fraud reason the dispatcher opens as an INCIDENT. */
export const SANDBOX_DESK_WITH_INCIDENT: readonly DeskEntry[] = [
  ...SANDBOX_DESK_ROUTINE,
  entry('Colis pour Fatou (démo)', 'pkg-fatou', 'rider:issa', 'incident', 'fraud', 'console.reason_fraud', 'unresolved'),
];
