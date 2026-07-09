import {
  PackageReadinessConfirmationSchema,
  type PackageReadinessConfirmation,
} from '@platform/contracts';

/**
 * Seller/readiness evidence SEED (four-secrets separation, §5.6: the
 * buyerDropCode is "private — never shown to the seller or in readiness
 * evidence"). The seller/readiness evidence type IS the canonical
 * PackageReadinessConfirmation from the pin — no local shape. The canonical
 * schema is STRICT: a payload carrying buyerDropCode (or any foreign secret,
 * or any undeclared key) is a parse refusal by canon, and the four-secrets
 * CI gate strict-parses payloads with exactly this schema.
 */

export type ReadinessEvidenceVerdict =
  | { ok: true; confirmation: PackageReadinessConfirmation }
  | { ok: false; reason: 'not_canonical_or_foreign_secret' };
// The refusal branch carries NO confirmation — nothing is repaired or dropped.

export function acceptSellerReadinessEvidence(payload: unknown): ReadinessEvidenceVerdict {
  const parsed = PackageReadinessConfirmationSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: 'not_canonical_or_foreign_secret' };
  }
  return { ok: true, confirmation: parsed.data };
}
