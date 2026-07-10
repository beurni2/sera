#!/usr/bin/env node
// WO-1.3 DoD: Contract §2.3 steps 11–13 end-to-end — verification → seal →
// custody → delivery evidence → validation → drop code (LAST) → custody to
// customer → THE settlement-eligibility signal, exactly once. Deterministic;
// chain ids log-copied; exits nonzero on any divergence.
import { CustodySpine } from '../services/custody-service/dist/custody-spine.js';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../services/custody-service/dist/pickup-verification-policy.js';

const T = '2026-07-10T12:00:00.000Z';
const SHA = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
const CHAIN = { order_id: 'order-e1-0001', task_id: 'task-e1-0001', package_id: 'pkg-e1-0001', correlation_id: 'corr-e1-0001' };

const spine = new CustodySpine(CHAIN, 'supplier-e1');
spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-4711');
spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-e1-0001');
spine.secrets.register('buyer_drop_code', CHAIN.order_id, 'drop-9042');
spine.establishSellerCustody(T);

// Step 11 — verification (policy v1, all checks pass, dwell recorded) + seal + custody.
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));
const verified = spine.verifyPickup(
  { orderId: CHAIN.order_id, riderId: 'rider-issa', checkResults: allPass, dwellSec: 165, evidenceBundleId: 'eb-e1-0001', custodySealId: 'seal-e1-0001' },
  'pvc-4711', T,
);
if (verified.kind !== 'accepted') { console.error('verification failed:', JSON.stringify(verified)); process.exit(1); }
const custody = spine.beginCustody({ riderId: 'rider-issa', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e1-0001', sealPhotoRefs: ['media/seal-photo.jpg'], at: T });
if (!custody.ok) { console.error('custody refused:', custody.reason); process.exit(1); }

// Step 12 — delivery evidence (server-confirmed) → ValidationDecision.
const submitted = spine.submitDeliveryEvidence(
  { taskId: CHAIN.task_id, packageId: CHAIN.package_id, custodySealId: 'seal-e1-0001', artifacts: [{ ref: 'media/drop-photo.jpg', sha256: SHA, mimeType: 'image/jpeg' }], capturedAt: T },
  'server_confirmed', T,
);
if (!submitted.ok || submitted.pending) { console.error('evidence refused/pending'); process.exit(1); }
const decided = spine.decideValidation(T);
if (!decided.ok || decided.decision.result !== 'validated') { console.error('validation failed'); process.exit(1); }

// Step 13 — drop code LAST → custody→customer + eligibility signal ONCE.
const confirmed = spine.confirmDropAndEmitEligibility('drop-9042', T);
if (!confirmed.ok || confirmed.duplicate) { console.error('drop/eligibility failed'); process.exit(1); }
const replay = spine.confirmDropAndEmitEligibility('drop-9042', T);

console.log('=== E1 CUSTODY SPINE — steps 11–13 happy path ===');
console.log(`order_id       = ${CHAIN.order_id}`);
console.log(`task_id        = ${CHAIN.task_id}`);
console.log(`package_id     = ${CHAIN.package_id}`);
console.log(`validation_id  = val-${CHAIN.order_id}`);
console.log(`correlation_id = ${CHAIN.correlation_id} (constant across every event)`);
console.log(`current custodian = ${spine.ledger.currentCustodian(CHAIN.package_id)}`);
console.log(`ledger: ${spine.ledger.all().length} entries, chain ${spine.ledger.verifyChain().valid ? 'VERIFIES' : 'BROKEN'}`);
console.log('\n=== events (name @ aggregateVersion) ===');
for (const e of spine.allEvents()) console.log(`${e.envelope.aggregateVersion}. ${e.name} (command ${e.envelope.command_id})`);
const signals = spine.allEvents().filter((e) => e.name === 'delivery.validated.v1');
console.log(`\neligibility signals for the order: ${signals.length} (replay absorbed: duplicate=${replay.ok ? replay.duplicate : 'n/a'})`);

const sane =
  spine.ledger.verifyChain().valid &&
  spine.ledger.currentCustodian(CHAIN.package_id) === 'customer' &&
  signals.length === 1 &&
  replay.ok && replay.duplicate === true &&
  spine.allEvents().every((e) => e.envelope.correlation_id === CHAIN.correlation_id);
process.exit(sane ? 0 : 1);
