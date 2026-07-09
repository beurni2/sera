import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { beginCourierCustody } from '../src/custody-transition.js';

// CI gate: custody-after-verification-and-seal (SE-I05, §6.2 step 8).

const fixturesDir = join(import.meta.dirname, '../../../gates/fixtures');

const accepted = JSON.parse(
  readFileSync(join(fixturesDir, 'custody.verified-and-sealed.json'), 'utf8'),
);
const unverified = JSON.parse(
  readFileSync(join(fixturesDir, 'negative/custody.without-verification.json'), 'utf8'),
);

describe('custody-after-verification-and-seal (SE-I05)', () => {
  it('custody begins when verification is accepted AND the seal matches', () => {
    const outcome = beginCourierCustody(accepted);
    expect(outcome.allowed).toBe(true);
    if (outcome.allowed) {
      expect(outcome.transition.to).toBe('courier');
      expect(outcome.transition.custodySealId).toBe(accepted.custodySealId);
    }
  });

  it('a refused verification NEVER yields custody — closed refusal, no transition', () => {
    const outcome = beginCourierCustody(unverified);
    expect(outcome).toEqual({ allowed: false, reason: 'verification_not_accepted' });
    expect(outcome).not.toHaveProperty('transition');
  });

  it('an accepted verification WITHOUT a matching seal never yields custody', () => {
    const outcome = beginCourierCustody({ ...accepted, custodySealId: 'seal_WRONG' });
    expect(outcome).toEqual({ allowed: false, reason: 'seal_missing_or_mismatched' });
  });

  it('evidence/GPS/self-declaration are not expressible custody inputs (type surface)', () => {
    // The input type carries verification + seal ONLY; a "gpsProof" or
    // "riderDeclaration" key is not part of the type — and at runtime the
    // canonical strict parse rejects a verification carrying extras.
    const outcome = beginCourierCustody({
      ...accepted,
      verification: { ...accepted.verification, gpsProof: { lat: 1, lng: 2 } },
    });
    expect(outcome).toEqual({ allowed: false, reason: 'malformed' });
  });
});
