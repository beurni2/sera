#!/usr/bin/env node
// CI gate (WO-2.7 item 1; WO-2.4 NB③): ACTOR PROVENANCE — a consumed signal
// whose envelope.actor is outside its event's registered producer class is
// REFUSED CLOSED and raises reconciliation.alert.v1. In-process layer BENEATH
// E3's transport-level webhook authenticity. Drives the REAL CustodySpine
// (built dist) with a door-paid signal whose actor comes from the fixture.
// Exit 0 = lawful actor consumed. Exit 1 = wrong actor caught (refused +
// alert, state untouched). Exit 2 = fail-open/error.
import { readFileSync } from 'node:fs';
import { PlatformEventSchema } from '@platform/contracts';
import { CustodySpine } from '../../services/custody-service/dist/custody-spine.js';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../../services/custody-service/dist/pickup-verification-policy.js';

const path = process.argv[2];
if (!path) { console.error('usage: actor-provenance.mjs <fixture.json>'); process.exit(2); }
let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }
if (typeof fixture.actor !== 'string' || fixture.actor.length === 0) { console.error('fixture must name an actor'); process.exit(2); }

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
spine.recordDoorInspection({ orderId: CHAIN.order_id, inspectionCategory: 'fashion_bags_fabrics', packageOpened: false, manufacturerSealOpened: false, custodySealIntact: true, buyerAccepts: true, startedAt: T, completedAt: T, evidenceBundleId: 'eb-door' }, T);

const signal = PlatformEventSchema.parse({
  name: 'payment.door_leg_confirmed.v1',
  envelope: { command_id: 'cmd-provenance-gate', correlation_id: 'corr-shop', aggregateVersion: 1, actor: fixture.actor, serverTime: T, version: '1' },
  payload: { provider: 'sandbox-provider', payment_attempt_id: 'pa-1', collectRef: 'c-1', amount: 11500, fee: 0, status: 'captured', order_id: CHAIN.order_id, redelivery: 0 },
});
const consumed = spine.consumeDoorPaidSignal(signal, T);

if (consumed.ok) {
  if (fixture.expectRefusal) { console.error(`FAIL-OPEN: wrong-actor signal (${fixture.actor}) was consumed`); process.exit(2); }
  console.log(`OK: door-paid signal from '${fixture.actor}' (payment-provider class) consumed lawfully`);
  process.exit(0);
}
// Refused: state must be untouched and the alert must exist — anything else
// is fail-open or a silent refusal.
if (spine.isDoorPaymentConfirmed()) { console.error('FAIL-OPEN: refused signal still advanced door state'); process.exit(2); }
if (consumed.reason !== 'producer_actor_mismatch') { console.error(`unexpected refusal: ${consumed.reason}`); process.exit(2); }
const alert = spine.allEvents().find((e) => e.name === 'reconciliation.alert.v1' && e.payload['scenario'] === 'producer_actor_mismatch');
if (!alert) { console.error('SILENT REFUSAL: wrong actor refused but no reconciliation.alert.v1 raised'); process.exit(2); }
if (!fixture.expectRefusal) { console.error(`lawful actor '${fixture.actor}' was refused`); process.exit(2); }
console.error(`VIOLATION (caught, refused closed + alert): actor '${fixture.actor}' is not in the payment-provider class`);
process.exit(1);
