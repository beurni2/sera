#!/usr/bin/env node
// CI gate (kernel offline law × SE5.3): offline evidence is queued =
// PENDING — it can NEVER produce a validation, a custody change, or an
// eligibility signal. Drives the REAL CustodySpine (built dist).
// Exit 1 = violation caught (refused closed). Exit 2 = fail-open.
import { readFileSync } from 'node:fs';
import { CustodySpine } from '../../services/custody-service/dist/custody-spine.js';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../../services/custody-service/dist/pickup-verification-policy.js';

const path = process.argv[2];
if (!path) { console.error('usage: offline-never-final.mjs <fixture.json>'); process.exit(2); }
let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }

const T = '2026-07-10T12:00:00.000Z';
const SHA = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
const CHAIN = { order_id: 'order-1', task_id: 'task-1', package_id: 'pkg-1', correlation_id: 'corr-1' };
const spine = new CustodySpine(CHAIN, 'sup-1');
const arm = (kind, orderId, secret) => {
  const armed = spine.secrets.register(kind, orderId, secret);
  if (!armed.ok) { console.error(`harness: arming ${kind} refused`); process.exit(2); }
};
arm('pickup_verification_code', CHAIN.order_id, 'pvc-1');
arm('custody_seal', CHAIN.order_id, 'seal-1');
arm('buyer_drop_code', CHAIN.order_id, 'drop-1');
spine.establishSellerCustody(T);
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));
spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-1' }, 'pvc-1', T);
spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-1', sealPhotoRefs: ['media/seal.jpg'], at: T });

const bundle = { taskId: CHAIN.task_id, packageId: CHAIN.package_id, custodySealId: 'seal-1', artifacts: [{ ref: 'media/drop.jpg', sha256: SHA, mimeType: 'image/jpeg' }], capturedAt: T };
const submitted = spine.submitDeliveryEvidence(bundle, fixture.confirmation, T);

if (fixture.confirmation === 'queued_offline') {
  const validate = spine.decideValidation(T);
  const drop = spine.confirmDropAndEmitEligibility('drop-1', T);
  const custodian = spine.ledger.currentCustodian(CHAIN.package_id);
  const signals = spine.allEvents().filter((e) => e.name === 'delivery.validated.v1').length;
  if (validate.ok || (drop.ok && !drop.duplicate) || custodian !== 'courier:r-1' || signals > 0) {
    console.error('OFFLINE EVIDENCE PRODUCED FINALITY — kernel offline law broken'); process.exit(2);
  }
  console.error(`VIOLATION (caught, refused closed): offline evidence stayed PENDING — validation ${JSON.stringify(validate)}, drop ${JSON.stringify(drop)}, custodian ${custodian}, eligibility signals ${signals}`);
  process.exit(1);
}
if (!submitted.ok || submitted.pending) { console.error('server-confirmed evidence unexpectedly pending/refused'); process.exit(2); }
const decided = spine.decideValidation(T);
// ⚠ ASSERT WHAT IT SAYS, NOT THAT IT SPOKE. This read `process.exit(decided.ok ? 0 : 2)`
// — a decision merely EXISTING passed the gate, whatever its result. Harmless while
// the artifact count forced the outcome; blind the moment that test was removed
// (PORTE-SANS-PHOTO, 2026-08-10), which is exactly when a silent inversion would hide.
if (!decided.ok) {
  console.error(`offline-never-final REFUSED — server-confirmed evidence produced no decision: ${decided.reason}`);
  process.exit(2);
}
if (decided.decision.result !== 'validated') {
  console.error(`offline-never-final REFUSED — server-confirmed evidence decided '${decided.decision.result}', expected 'validated'`);
  process.exit(2);
}
console.log(`OK: server-confirmed evidence validated (${decided.decision.result}); offline finality is unrepresentable here`);
process.exit(0);
