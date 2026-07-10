#!/usr/bin/env node
// CI gate (SE6.2): the return handover back to the seller requires TWO keys
// (seller return-acceptance + rider confirmation), both-or-neither — a
// single-key attempt REFUSES, burns nothing, and custody stays with the
// courier. Drives the REAL CustodySpine (built dist) through door-refusal →
// escalation → buyer-fault refusal → return flow.
// Exit 0 = two-key handover completes. Exit 1 = violation caught (refused).
// Exit 2 = fail-open / harness error.
import { readFileSync } from 'node:fs';
import { CustodySpine } from '../../services/custody-service/dist/custody-spine.js';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../../services/custody-service/dist/pickup-verification-policy.js';

const path = process.argv[2];
if (!path) { console.error('usage: two-key-return.mjs <fixture.json>'); process.exit(2); }
let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }

const T = '2026-07-10T12:00:00.000Z';
const T_LATER = '2026-07-10T12:16:00.000Z';
const CHAIN = { order_id: 'order-1', task_id: 'task-1', package_id: 'pkg-1', correlation_id: 'corr-1' };
const spine = new CustodySpine(CHAIN, 'sup-1');
const arm = (kind, secret) => {
  const armed = spine.secrets.register(kind, CHAIN.order_id, secret);
  if (!armed.ok) { console.error(`harness: arming ${kind} refused`); process.exit(2); }
};
arm('pickup_verification_code', 'pvc-1');
arm('custody_seal', 'seal-1');
spine.establishSellerCustody(T);
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));
spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-1' }, 'pvc-1', T);
spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-1', sealPhotoRefs: ['media/seal.jpg'], at: T });
spine.recordDoorRefusal('fraud', T);
spine.escalateExpiredWindow(T_LATER);
const applied = spine.applyBuyerFaultRefusal({ returnSealId: 'return-seal-1', at: T_LATER });
if (!applied.ok) { console.error('harness: buyer-fault refusal did not apply'); process.exit(2); }
const armed = spine.armReturnKeys('seller-key-abc', 'rider-key-xyz');
if (!armed.ok) { console.error('harness: return keys did not arm'); process.exit(2); }

const handover = spine.completeReturnHandover(fixture.presentedSellerKey, fixture.presentedRiderKey, T_LATER);
if (handover.ok) {
  if (spine.ledger.currentCustodian(CHAIN.package_id) !== 'seller:sup-1' || !spine.ledger.verifyChain().valid) {
    console.error('FAIL-OPEN: handover reported ok but custody/chain is wrong'); process.exit(2);
  }
  console.log('OK: TWO keys consumed both-or-neither → custody courier→seller, chain verifies, return closed');
  process.exit(0);
}
if (spine.ledger.currentCustodian(CHAIN.package_id) !== 'courier:r-1') {
  console.error('FAIL-OPEN: refused handover moved custody anyway'); process.exit(2);
}
// Both-or-neither proof: after the refused attempt, the full two-key retry must still work.
const retry = spine.completeReturnHandover('seller-key-abc', 'rider-key-xyz', T_LATER);
if (!retry.ok) { console.error('FAIL-OPEN: the refused attempt burned a key'); process.exit(2); }
console.error(`VIOLATION (caught, refused closed): ${handover.reason} (${handover.detail ?? ''}) — single/wrong key transferred NOTHING and burned NOTHING`);
process.exit(1);
