import {
  InspectionPolicySchema,
  InspectionSessionSchema,
  type FaultClass,
  type InspectionPolicy,
  type InspectionSession,
} from '@platform/contracts';

/**
 * WO-2.4 — doorstep inspection on versioned policy data (Shop+ §6.2 matrix;
 * policy OWNED by Séra/Evidence per the matrix header). The fault mapping is
 * DERIVED, never invented — see derivations/door-inspection-fault-mapping.md
 * for the quoted grounding. Valid rejections carry NO canonical reasonCode
 * (canon gap, flagged) — they route to the protection claim + return flow,
 * never the buyer ladder.
 */

export const INSPECTION_POLICIES_V1: readonly InspectionPolicy[] = [
  InspectionPolicySchema.parse({
    version: 'inspection-policy.v1',
    inspectionCategory: 'fashion_bags_fabrics',
    allowedActions: ['visual_item', 'colour', 'size_label', 'quantity', 'condition', 'missing_parts'],
    sealRule: 'outer_open_allowed_no_try_on',
    dwellTargetSec: 240,
  }),
  InspectionPolicySchema.parse({
    version: 'inspection-policy.v1',
    inspectionCategory: 'shoes',
    allowedActions: ['box_open', 'model', 'size_label', 'pair', 'condition'],
    sealRule: 'box_open_allowed_no_wearing',
    dwellTargetSec: 240,
  }),
  InspectionPolicySchema.parse({
    version: 'inspection-policy.v1',
    inspectionCategory: 'sealed_beauty',
    allowedActions: ['outer_only', 'mfr_seal_intact', 'name', 'variant', 'quantity', 'expiry', 'damage'],
    sealRule: 'inner_seal_must_stay_closed',
    dwellTargetSec: 240,
  }),
  /**
   * PORTE-CUSTODY — FOUNDER RULING (2026-08-14, decision (b)): the
   * CONSERVATIVE FALLBACK for category-less products. A product that rides
   * the wire with no inspection category inspects OUTER PACKAGING ONLY —
   * this row claims nothing category-specific (no box-open, no try-on, no
   * inner-seal judgement), mirroring the buyer PWA's own conservative
   * inspection row. Real categories take over per-product whenever they
   * ride the wire; this row exists so a category-less order refuses
   * nothing it should not and permits nothing the §6.2 matrix has not
   * granted.
   */
  InspectionPolicySchema.parse({
    version: 'inspection-policy.v1',
    inspectionCategory: 'uncategorised_conservative',
    allowedActions: ['outer_only', 'visual_item', 'quantity', 'damage'],
    sealRule: 'outer_only_conservative_no_opening',
    dwellTargetSec: 240,
  }),
];

/** The derived fault mapping (see the derivation note — quotes 1–5). */
export const DOOR_FAULT_DERIVATION_V1 = {
  version: 'door-fault-derivation.v1',
  /** Buyer-risk refusal (invalid rejection) → the §6.4 ordinary-buyer-fault
   * ladder class. */
  invalidRejectionReasonCode: 'change_of_mind',
  /** Valid rejection under an INTACT custody seal: the defect predates
   * Séra custody (the seal witnesses transit integrity). */
  validRejectionSealIntactFault: 'seller',
  /** Valid rejection under a BROKEN custody seal: compromised IN custody —
   * "Séra-caused product loss/damage" (§6.5). */
  validRejectionSealBrokenFault: 'sera',
} as const satisfies {
  version: string;
  invalidRejectionReasonCode: 'change_of_mind';
  validRejectionSealIntactFault: FaultClass;
  validRejectionSealBrokenFault: FaultClass;
};

export interface DoorInspectionInput {
  orderId: string;
  inspectionCategory: string;
  packageOpened: boolean;
  manufacturerSealOpened: boolean;
  custodySealIntact: boolean;
  buyerAccepts: boolean;
  /** Present ONLY when the buyer refuses: which §6.2 column the refusal
   * sits in. `valid` = the category's valid-rejection list; `buyer_risk` =
   * the not-valid column (fit, try-on, inner seal, opened-then-refused). */
  refusalColumn?: 'valid' | 'buyer_risk';
  startedAt: string;
  completedAt: string;
  evidenceBundleId: string;
}

export type DoorInspectionOutcome =
  | { kind: 'accepted'; session: InspectionSession }
  | { kind: 'invalid_rejection'; session: InspectionSession; ladderReasonCode: 'change_of_mind' }
  | { kind: 'valid_rejection'; session: InspectionSession; faultClass: FaultClass }
  | { kind: 'invalid'; reason: 'category_not_in_policy' | 'refusal_column_missing' };

export function runDoorInspection(input: DoorInspectionInput): DoorInspectionOutcome {
  const policy = INSPECTION_POLICIES_V1.find((p) => p.inspectionCategory === input.inspectionCategory);
  if (policy === undefined) return { kind: 'invalid', reason: 'category_not_in_policy' };
  const base = {
    orderId: input.orderId,
    inspectionCategory: input.inspectionCategory,
    packageOpened: input.packageOpened,
    manufacturerSealOpened: input.manufacturerSealOpened,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    evidenceBundleId: input.evidenceBundleId,
  };
  if (input.buyerAccepts) {
    return { kind: 'accepted', session: InspectionSessionSchema.parse({ ...base, inspectionResult: 'accepted' }) };
  }
  if (input.refusalColumn === undefined) return { kind: 'invalid', reason: 'refusal_column_missing' };
  if (input.refusalColumn === 'buyer_risk') {
    return {
      kind: 'invalid_rejection',
      session: InspectionSessionSchema.parse({
        ...base,
        inspectionResult: 'refused_invalid',
        rejectionReason: 'buyer_risk_refusal',
        faultAssignment: 'buyer',
      }),
      ladderReasonCode: DOOR_FAULT_DERIVATION_V1.invalidRejectionReasonCode,
    };
  }
  const faultClass = input.custodySealIntact
    ? DOOR_FAULT_DERIVATION_V1.validRejectionSealIntactFault
    : DOOR_FAULT_DERIVATION_V1.validRejectionSealBrokenFault;
  return {
    kind: 'valid_rejection',
    session: InspectionSessionSchema.parse({
      ...base,
      inspectionResult: 'refused_valid',
      rejectionReason: input.custodySealIntact ? 'conformity_mismatch_seal_intact' : 'custody_seal_broken',
      faultAssignment: faultClass,
    }),
    faultClass,
  };
}
