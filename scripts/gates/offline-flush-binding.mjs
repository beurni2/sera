#!/usr/bin/env node
// CI gate (WO-2.1 NB④, founder HARD REQUIREMENT): the offline evidence
// queue drains EXCLUSIVELY through submitDeliveryEvidence's server_confirmed
// binding path. Two modes:
//   no args  — (a) behavioral proof against the REAL spine: a queued FOREIGN
//              bundle is refused AT FLUSH by the binding check while the
//              bound one validates; (b) repo scan: no direct access to the
//              private queue or the evidence slot outside the owning module.
//   <dir>    — scan a fixture dir (the planted bypass module must be caught).
// Exit 0 = law holds. Exit 1 = violation caught. Exit 2 = fail-open/error.
import { scanForPatterns, countScannedFiles, DEFAULT_ROOTS } from './scan.mjs';
import { CustodySpine } from '../../services/custody-service/dist/custody-spine.js';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../../services/custody-service/dist/pickup-verification-policy.js';

const PATTERNS = [
  // Direct field access to the queue or the accepted-evidence slot — the
  // only lawful path is submitDeliveryEvidence/flushOfflineEvidence inside
  // custody-spine.ts. (Method names like hasPendingOfflineEvidence do not
  // match: the patterns anchor the FIELD identifier.)
  { name: 'queue field access', regex: /(\.|\[')pendingOfflineEvidence('\])?\b/ },
  { name: 'evidence slot assignment', regex: /(\.|\[')evidenceSubmitted('\])?\s*=[^=]/ },
];
const OWNING = /services[\/\\]custody-service[\/\\](src|dist)[\/\\]custody-spine\.(ts|js|d\.ts)$/;

const fixtureDir = process.argv[2];
if (fixtureDir) {
  const hits = scanForPatterns([fixtureDir], PATTERNS);
  if (countScannedFiles([fixtureDir]) === 0) { console.error('no scannable files in fixture dir'); process.exit(2); }
  if (hits.length === 0) { console.error('FAIL-OPEN: the planted bypass module was not caught'); process.exit(2); }
  console.error(`VIOLATION (caught): ${hits.length} bypass access(es) to the offline queue outside the binding path:`);
  for (const hit of hits) console.error(`  ${hit.file}:${hit.lineNo} [${hit.pattern}] ${hit.line}`);
  process.exit(1);
}

// (a) Behavioral: queued foreign bundle refused AT FLUSH by the binding check.
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
spine.establishSellerCustody(T);
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));
spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-1' }, 'pvc-1', T);
spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-1', sealPhotoRefs: ['media/seal.jpg'], at: T });
const bundle = (packageId) => ({ taskId: CHAIN.task_id, packageId, custodySealId: 'seal-1', artifacts: [{ ref: 'media/drop.jpg', sha256: SHA, mimeType: 'image/jpeg' }], capturedAt: T });
spine.submitDeliveryEvidence(bundle('pkg-FOREIGN'), 'queued_offline', T);
spine.submitDeliveryEvidence(bundle(CHAIN.package_id), 'queued_offline', T);
const flushed = spine.flushOfflineEvidence(T);
const decided = spine.decideValidation(T);
if (
  flushed.drained !== 2 || flushed.accepted !== 1 ||
  flushed.refusals.length !== 1 || flushed.refusals[0].reason !== 'evidence_chain_mismatch' ||
  !decided.ok || decided.decision.result !== 'validated' || spine.hasPendingOfflineEvidence()
) {
  console.error(`FAIL-OPEN: flush did not route through the binding path (${JSON.stringify(flushed)})`); process.exit(2);
}

// (b) Repo scan: the field identifiers appear ONLY in the owning module.
const repoHits = scanForPatterns(DEFAULT_ROOTS, PATTERNS).filter((hit) => !OWNING.test(hit.file));
if (repoHits.length > 0) {
  console.error(`offline-flush-binding FAILED — ${repoHits.length} access(es) outside the binding path:`);
  for (const hit of repoHits) console.error(`  ${hit.file}:${hit.lineNo} [${hit.pattern}] ${hit.line}`);
  process.exit(1);
}
console.log('OK: queued foreign evidence refused AT FLUSH (evidence_chain_mismatch), bound evidence validated; no queue access exists outside the binding path');
process.exit(0);
