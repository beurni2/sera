import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PickupVerificationSchema } from '@platform/contracts';
import { PICKUP_VERIFICATION_POLICY_V1, runPickupVerification } from '../src/pickup-verification-policy.js';

const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));
const base = { orderId: 'order-1', riderId: 'r-1', dwellSec: 180, evidenceBundleId: 'eb-1', custodySealId: 'seal-1' };

describe('bounded pickup verification — SE4.2, policy v1 as versioned data', () => {
  it('policy v1 carries the plan list VERBATIM and the 2–4 minute dwell window', () => {
    expect(PICKUP_VERIFICATION_POLICY_V1.version).toBe('pickup-verification-policy.v1');
    expect([...PICKUP_VERIFICATION_POLICY_V1.checks]).toEqual([
      'order_ref', 'identity', 'variant', 'colour', 'size_label', 'qty', 'damage', 'pieces', 'manufacturer_seal',
    ]);
    expect(PICKUP_VERIFICATION_POLICY_V1.dwellSecMin).toBe(120);
    expect(PICKUP_VERIFICATION_POLICY_V1.dwellSecMax).toBe(240);
  });

  it('all checks pass → accepted, canonical PickupVerification, dwell RECORDED (not enforced)', () => {
    const outcome = runPickupVerification({ ...base, checkResults: allPass });
    expect(outcome.kind).toBe('accepted');
    if (outcome.kind !== 'accepted') return;
    expect(PickupVerificationSchema.safeParse(outcome.verification).success).toBe(true);
    expect(outcome.verification.checks).toHaveLength(9);
    expect(outcome.dwell).toEqual({ dwellSec: 180, withinTarget: true });
    // Out-of-window dwell is RECORDED as such, never a refusal at E1.
    const fast = runPickupVerification({ ...base, dwellSec: 30, checkResults: allPass });
    expect(fast.kind).toBe('accepted');
    if (fast.kind === 'accepted') expect(fast.dwell).toEqual({ dwellSec: 30, withinTarget: false });
  });

  it('a conformity mismatch → REFUSED with a structured reason + faultClass=seller SIGNAL — and nothing here can refund', () => {
    const outcome = runPickupVerification({ ...base, checkResults: { ...allPass, qty: false, colour: false } });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.verification.result).toBe('refused');
    expect(outcome.verification.rejectionReason).toBe('conformity_mismatch:colour,qty');
    expect(outcome.faultSignal).toEqual({
      name: 'protection.claim_opened.v1', faultClass: 'seller', orderId: 'order-1', failedChecks: ['colour', 'qty'],
    });
  });

  it('OBJECTIVE CONFORMITY ONLY: authenticity/quality/hidden-defect checks are out of policy — refused as invalid', () => {
    for (const foreign of ['authenticity', 'quality', 'hidden_defects']) {
      const outcome = runPickupVerification({ ...base, checkResults: { ...allPass, [foreign]: true } });
      expect(outcome).toMatchObject({ kind: 'invalid', reason: 'check_not_in_policy', detail: foreign });
    }
    const { manufacturer_seal: _dropped, ...partial } = allPass;
    expect(runPickupVerification({ ...base, checkResults: partial })).toMatchObject({
      kind: 'invalid', reason: 'policy_checks_missing', detail: 'manufacturer_seal',
    });
  });

  it('NO settlement/refund mutation exists anywhere in custody-service source (Séra signals, never releases)', () => {
    const srcDir = join(import.meta.dirname, '../src');
    // Split-constructed so the repo-wide evidence-never-releases scanner
    // (which owns these tokens) does not flag its own meta-test.
    const banned = new RegExp(
      ['release[_A-Z]?settle' + 'ment', 'ref' + 'und', 'pay' + 'out', 'mark' + 'Paid', 'credit' + 'Buyer'].join('|'),
      'i',
    );
    for (const file of readdirSync(srcDir)) {
      const source = readFileSync(join(srcDir, file), 'utf8');
      const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(codeOnly, `${file} must contain no settlement/refund mutation`).not.toMatch(banned);
    }
  });
});
