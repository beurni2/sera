import type { SellerReadinessChallenge } from '@platform/contracts';

/**
 * Seller/readiness evidence SEED (four-secrets separation, §5.6: the
 * buyerDropCode is "private — never shown to the seller or in readiness
 * evidence"). The seller-facing readiness evidence type carries the
 * sellerReadinessChallenge and ONLY that secret — buyerDropCode is
 * structurally absent, and the four-secrets CI gate scans emitted payloads
 * as the second line of defense.
 */
export interface SellerReadinessEvidence {
  orderId: string;
  packageId: string;
  photoRef: string;
  readinessChallenge: SellerReadinessChallenge;
  qty: number;
  variant: string;
  availableConfirmed: boolean;
  capturedAt: string;
}

export interface ReadinessEvidenceInput {
  orderId: string;
  packageId: string;
  photoRef: string;
  readinessChallenge: SellerReadinessChallenge;
  qty: number;
  variant: string;
  availableConfirmed: boolean;
  capturedAt: string;
}

export function toSellerReadinessEvidence(input: ReadinessEvidenceInput): SellerReadinessEvidence {
  return {
    orderId: input.orderId,
    packageId: input.packageId,
    photoRef: input.photoRef,
    readinessChallenge: input.readinessChallenge,
    qty: input.qty,
    variant: input.variant,
    availableConfirmed: input.availableConfirmed,
    capturedAt: input.capturedAt,
  };
}
