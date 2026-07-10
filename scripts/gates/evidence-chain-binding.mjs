#!/usr/bin/env node
// CI gate (WO-2.1 finding ① × SE-I11 "evidence supports, never
// auto-releases"): before any ValidationDecision, the EvidenceBundle must
// bind BY EQUALITY to the task's chain ids AND to the REGISTERED custody
// seal. A bundle carrying a foreign packageId, a foreign seal, or missing
// its binding fields is REFUSED CLOSED — no ledger entry, no event, no
// decision. Drives the REAL CustodySpine (built dist).
// Exit 0 = bound evidence accepted (positive fixture).
// Exit 1 = violation caught, refused closed (negative fixtures).
// Exit 2 = fail-open / harness error.
import { readFileSync } from 'node:fs';
import { CustodySpine } from '../../services/custody-service/dist/custody-spine.js';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../../services/custody-service/dist/pickup-verification-policy.js';

const path = process.argv[2];
if (!path) { console.error('usage: evidence-chain-binding.mjs <fixture.json>'); process.exit(2); }
let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }

const T = '2026-07-10T12:00:00.000Z';
const CHAIN = { order_id: 'order-1', task_id: 'task-1', package_id: 'pkg-1', correlation_id: 'corr-1' };
const spine = new CustodySpine(CHAIN, 'sup-1');
spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-1');
spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-1');
spine.establishSellerCustody(T);
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));
spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-1' }, 'pvc-1', T);
const custody = spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-1', sealPhotoRefs: ['media/seal.jpg'], at: T });
if (!custody.ok) { console.error('harness: custody did not begin'); process.exit(2); }

const eventsBefore = spine.allEvents().length;
const ledgerBefore = spine.ledger.all().length;
const submitted = spine.submitDeliveryEvidence(fixture.bundle, 'server_confirmed', T);

if (submitted.ok) {
  // Positive path: the fixture must be the bound bundle — assert equality
  // explicitly so this gate cannot green-light a foreign bundle by accident.
  const b = fixture.bundle;
  if (b.taskId !== CHAIN.task_id || b.packageId !== CHAIN.package_id || b.custodySealId !== 'seal-1') {
    console.error('FAIL-OPEN: a bundle NOT bound to the chain/seal was accepted'); process.exit(2);
  }
  const decided = spine.decideValidation(T);
  if (!decided.ok || decided.decision.result !== 'validated') { console.error('bound evidence did not validate'); process.exit(2); }
  console.log('OK: evidence bound by equality to chain ids (task, package) + the registered seal → validated');
  process.exit(0);
}

// Refused: this must be a CLOSED refusal — structured reason, nothing
// emitted, nothing appended, and no decision possible afterwards.
const decided = spine.decideValidation(T);
const leaked =
  spine.allEvents().length !== eventsBefore ||
  spine.ledger.all().length !== ledgerBefore ||
  decided.ok;
if (leaked) {
  console.error(`FAIL-OPEN: refused evidence still produced effects (events ${spine.allEvents().length - eventsBefore}, ledger +${spine.ledger.all().length - ledgerBefore}, decision ${JSON.stringify(decided)})`);
  process.exit(2);
}
console.error(`VIOLATION (caught, refused closed): ${submitted.reason} — no event, no ledger entry, decision refused (${decided.ok ? 'LEAKED' : decided.reason})`);
process.exit(1);
