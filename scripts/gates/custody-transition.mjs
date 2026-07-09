#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { PickupVerificationSchema } from '@platform/contracts';

/**
 * CI gate: custody-after-verification-and-seal (SE-I05: "Custody begins only
 * after rider pickup verification AND custody-seal registration"; §6.2).
 * Takes a custody-begin fixture {packageId, riderId, verification,
 * custodySealId}; exit 0 = custody may begin, exit 1 = REFUSED CLOSED.
 * Evidence photos, GPS, and self-declaration are not inputs at all — a
 * verification carrying such extras is a strict-parse refusal.
 */
const file = process.argv[2];
if (!file) {
  console.error('usage: custody-transition.mjs <custody-begin.json>');
  process.exit(2);
}
let input;
try {
  input = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`custody-transition: cannot read fixture ${file}: ${String(err)}`);
  process.exit(2);
}
if (!input || typeof input !== 'object' || !('verification' in input)) {
  console.error(`custody-transition: ${file} is not a custody-begin fixture`);
  process.exit(2);
}
const parsed = PickupVerificationSchema.safeParse(input.verification);
if (!parsed.success) {
  console.error('custody-transition REFUSED CLOSED — verification is not a canonical PickupVerification (extras like GPS/self-declaration are parse failures)');
  process.exit(1);
}
if (parsed.data.result !== 'accepted') {
  console.error(`custody-transition REFUSED CLOSED — verification result is '${parsed.data.result}', custody requires 'accepted' (SE-I05)`);
  process.exit(1);
}
if (typeof input.custodySealId !== 'string' || input.custodySealId.length === 0 || parsed.data.custodySealId !== input.custodySealId) {
  console.error('custody-transition REFUSED CLOSED — custody seal missing or mismatched (SE-I05: seal registration precedes custody)');
  process.exit(1);
}
console.log(`custody-transition OK — verification accepted + seal ${input.custodySealId} registered; custody may begin (SE-I05)`);
process.exit(0);
