#!/usr/bin/env node
// CI gate (SE4.3): actor separation — the task's supplier can never be its
// rider. Drives the REAL CustodySpine (built dist). Exit 1 = violation
// caught (refused closed). Exit 2 = unusable input or a fail-open.
import { readFileSync } from 'node:fs';
import { CustodySpine } from '../../services/custody-service/dist/custody-spine.js';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../../services/custody-service/dist/pickup-verification-policy.js';

const path = process.argv[2];
if (!path) { console.error('usage: custody-actor-separation.mjs <fixture.json>'); process.exit(2); }
let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }

const T = '2026-07-10T12:00:00.000Z';
const CHAIN = { order_id: 'order-1', task_id: 'task-1', package_id: 'pkg-1', correlation_id: 'corr-1' };
const spine = new CustodySpine(CHAIN, fixture.supplierId);
spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-1');
spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-1');
spine.establishSellerCustody(T);
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));
spine.verifyPickup({ orderId: CHAIN.order_id, riderId: fixture.riderId, checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-1' }, 'pvc-1', T);
const outcome = spine.beginCustody({ riderId: fixture.riderId, verificationOrderId: CHAIN.order_id, custodySealId: 'seal-1', sealPhotoRefs: ['media/seal.jpg'], at: T });

if (fixture.supplierId === fixture.riderId) {
  if (outcome.ok) { console.error('SUPPLIER TOOK CUSTODY AS RIDER — actor separation broken'); process.exit(2); }
  console.error(`VIOLATION (caught, refused closed): supplier ${fixture.supplierId} attempted custody as the rider → ${outcome.reason}`);
  process.exit(1);
}
if (!outcome.ok) { console.error(`distinct actors unexpectedly refused: ${outcome.reason}`); process.exit(2); }
console.log(`OK: rider ${fixture.riderId} ≠ supplier ${fixture.supplierId} — custody transferred, chain ${spine.ledger.verifyChain().valid ? 'verifies' : 'BROKEN'}`);
process.exit(spine.ledger.verifyChain().valid ? 0 : 2);
