import { PickupVerificationSchema, type PickupVerification } from '@platform/contracts';

/**
 * Custody-transition SEED (SE-I05: "Custody begins only after rider pickup
 * verification (objective conformity) AND custody-seal registration"; §6.2
 * step 8). The transition input type REQUIRES a PickupVerification and a
 * custody seal id — evidence photos, GPS, or a rider's self-declaration are
 * not even expressible inputs (FORBIDDEN: "any custody transition type that
 * treats evidence, GPS, or self-declaration as sufficient"). The SE4.x
 * custody-ledger Durable Object hardens this into the runtime invariant.
 */

export interface CustodyBeginInput {
  packageId: string;
  riderId: string;
  verification: PickupVerification;
  custodySealId: string;
}

export type CustodyBeginOutcome =
  | {
      allowed: true;
      transition: {
        packageId: string;
        from: 'seller';
        to: 'courier';
        custodySealId: string;
        verificationOrderId: string;
      };
    }
  | { allowed: false; reason: 'verification_not_accepted' | 'seal_missing_or_mismatched' | 'malformed' };
// The refusal branch carries NO transition — custody fails closed.

export function beginCourierCustody(input: CustodyBeginInput): CustodyBeginOutcome {
  const parsed = PickupVerificationSchema.safeParse(input.verification);
  if (!parsed.success) {
    return { allowed: false, reason: 'malformed' };
  }
  if (parsed.data.result !== 'accepted') {
    return { allowed: false, reason: 'verification_not_accepted' };
  }
  if (
    typeof input.custodySealId !== 'string' ||
    input.custodySealId.length === 0 ||
    parsed.data.custodySealId !== input.custodySealId
  ) {
    return { allowed: false, reason: 'seal_missing_or_mismatched' };
  }
  return {
    allowed: true,
    transition: {
      packageId: input.packageId,
      from: 'seller',
      to: 'courier',
      custodySealId: input.custodySealId,
      verificationOrderId: parsed.data.orderId,
    },
  };
}
