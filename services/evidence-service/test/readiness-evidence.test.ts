import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PackageReadinessConfirmationSchema } from '@platform/contracts';
import { acceptSellerReadinessEvidence } from '../src/readiness-evidence.js';

// CI gate: four-secrets separation — buyerDropCode never in seller/readiness
// evidence (§5.6; Ten Laws #3). The evidence type IS the canonical
// PackageReadinessConfirmation; the strict canon schema is the enforcement.

const fixturesDir = join(import.meta.dirname, '../../../gates/fixtures');

describe('four-secrets separation on readiness evidence (canonical shape)', () => {
  it('a canonical PackageReadinessConfirmation is accepted as-is', () => {
    const fixture = JSON.parse(
      readFileSync(join(fixturesDir, 'readiness-evidence.json'), 'utf8'),
    );
    expect(PackageReadinessConfirmationSchema.safeParse(fixture).success).toBe(true);
    const verdict = acceptSellerReadinessEvidence(fixture);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(Object.keys(verdict.confirmation).join(',')).not.toMatch(
        /dropCode|pickupVerification|handoff/i,
      );
    }
  });

  it('readiness evidence carrying buyerDropCode is REFUSED by the canonical strict schema — no confirmation', () => {
    const leaking = JSON.parse(
      readFileSync(join(fixturesDir, 'negative/readiness-evidence.with-drop-code.json'), 'utf8'),
    );
    const verdict = acceptSellerReadinessEvidence(leaking);
    expect(verdict).toEqual({ ok: false, reason: 'not_canonical_or_foreign_secret' });
    expect(verdict).not.toHaveProperty('confirmation');
  });

  it('any other foreign secret or undeclared key is equally refused', () => {
    const canonical = JSON.parse(
      readFileSync(join(fixturesDir, 'readiness-evidence.json'), 'utf8'),
    );
    for (const key of ['pickupVerificationCode', 'handoffAuthorization', 'anythingUndeclared']) {
      expect(acceptSellerReadinessEvidence({ ...canonical, [key]: 'x' }).ok).toBe(false);
    }
  });
});
