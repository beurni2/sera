import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toSellerReadinessEvidence } from '../src/readiness-evidence.js';

// CI gate: four-secrets separation — buyerDropCode never in seller/readiness
// evidence (§5.6; Ten Laws #3).

const fixturesDir = join(import.meta.dirname, '../../../gates/fixtures');

describe('four-secrets separation on readiness evidence', () => {
  it('the readiness evidence type carries the readiness challenge and no other secret', () => {
    const fixture = JSON.parse(
      readFileSync(join(fixturesDir, 'readiness-evidence.json'), 'utf8'),
    );
    const evidence = toSellerReadinessEvidence(fixture);
    expect(evidence).toEqual(fixture);
    const keys = JSON.stringify(Object.keys(evidence));
    expect(keys).not.toMatch(/dropCode|pickupVerificationCode|handoff/i);
  });

  it('the checked-in negative fixture (buyerDropCode riding along) is what the gate must catch', () => {
    const leaking = JSON.parse(
      readFileSync(join(fixturesDir, 'negative/readiness-evidence.with-drop-code.json'), 'utf8'),
    );
    expect(leaking).toHaveProperty('buyerDropCode');
  });
});
