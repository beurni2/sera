#!/usr/bin/env node
// CI gate (SE-I11 payment-before-handoff): on Option-B, custody→customer
// REQUIRES the provider-confirmed door-paid signal — a transition without it
// REFUSES CLOSED. Drives the REAL CustodySpine (built dist).
// Exit 0 = lawful path. Exit 1 = violation caught. Exit 2 = fail-open/error.
import { readFileSync } from 'node:fs';
import { PlatformEventSchema } from '@platform/contracts';
import { CustodySpine } from '../../services/custody-service/dist/custody-spine.js';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../../services/custody-service/dist/pickup-verification-policy.js';

const path = process.argv[2];
if (!path) { console.error('usage: door-custody-gate.mjs <fixture.json>'); process.exit(2); }
let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }

const T = '2026-07-10T12:00:00.000Z';
const SHA = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
const CHAIN = { order_id: 'order-1', task_id: 'task-1', package_id: 'pkg-1', correlation_id: 'corr-1' };
const spine = new CustodySpine(CHAIN, 'sup-1', 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR');
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
spine.submitDeliveryEvidence({ taskId: CHAIN.task_id, packageId: CHAIN.package_id, custodySealId: 'seal-1', artifacts: [{ ref: 'media/drop.jpg', sha256: SHA, mimeType: 'image/jpeg' }], capturedAt: T }, 'server_confirmed', T);
spine.decideValidation(T);
spine.recordDoorInspection({ orderId: CHAIN.order_id, inspectionCategory: 'fashion_bags_fabrics', packageOpened: false, manufacturerSealOpened: false, custodySealIntact: true, buyerAccepts: true, startedAt: T, completedAt: T, evidenceBundleId: 'eb-door' }, T);

if (fixture.provideDoorSignal) {
  const signal = PlatformEventSchema.parse({
    name: 'payment.door_leg_confirmed.v1',
    envelope: { command_id: 'cmd-door-gate', correlation_id: 'corr-shop', aggregateVersion: 1, actor: 'shop:commerce-core', serverTime: T, version: '1' },
    payload: { provider: 'sandbox-provider', payment_attempt_id: 'pa-1', collectRef: 'c-1', amount: 11500, fee: 0, status: 'captured', order_id: CHAIN.order_id, redelivery: 0 },
  });
  const consumed = spine.consumeDoorPaidSignal(signal, T);
  if (!consumed.ok) { console.error('harness: lawful signal refused'); process.exit(2); }
}
const drop = spine.confirmDropAndEmitEligibility('drop-1', T);
if (drop.ok) {
  if (!fixture.provideDoorSignal) { console.error('FAIL-OPEN: custody transferred WITHOUT the provider door signal'); process.exit(2); }
  if (spine.ledger.currentCustodian(CHAIN.package_id) !== 'customer') { console.error('FAIL-OPEN: drop ok but custodian wrong'); process.exit(2); }
  console.log('OK: inspect → provider-confirmed door payment → drop code LAST → custody customer (SE-I11 held)');
  process.exit(0);
}
if (spine.ledger.currentCustodian(CHAIN.package_id) !== 'courier:r-1' || spine.allEvents().some((e) => e.name === 'delivery.validated.v1')) {
  console.error('FAIL-OPEN: refused drop still moved custody or emitted eligibility'); process.exit(2);
}
console.error(`VIOLATION (caught, refused closed): ${drop.reason} — custody stays with the courier until the provider speaks`);
process.exit(1);
