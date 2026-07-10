#!/usr/bin/env node
// CI gate (SE3.2/SE-I10 "package never unowned"): a rider holding custody
// cannot end shift without the exception flow — explicit dispatcher ack +
// the package's next owner named. Enforced at the store (RiderRegistry).
// Drives the REAL registry (built dist).
// Exit 0 = lawful end-shift. Exit 1 = violation caught (refused closed).
// Exit 2 = fail-open / harness error.
import { readFileSync } from 'node:fs';
import { PRIVACY_NOTICE_VERSION, RiderRegistry } from '../../services/logistics-service/dist/rider-registry.js';

const path = process.argv[2];
if (!path) { console.error('usage: package-never-unowned.mjs <fixture.json>'); process.exit(2); }
let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }

const T = '2026-07-10T18:00:00.000Z';
const registry = new RiderRegistry();
registry.register({ riderId: 'r-1', displayName: 'Issa', phoneAlias: 'alias-1', certified: true });
registry.acknowledgePrivacyNotice('r-1', PRIVACY_NOTICE_VERSION, T);
registry.startShift('r-1', T, 'server_confirmed');

const outcome = registry.endShift('r-1', T, 'server_confirmed', fixture.custody);
if (outcome.ok) {
  const holding = fixture.custody.heldPackageIds.length > 0;
  const logged = registry.custodyExceptionLog();
  if (holding && (logged.length !== 1 || logged[0].nextOwner.ref.length === 0)) {
    console.error('FAIL-OPEN: custody-holding end-shift succeeded without a logged exception naming the next owner'); process.exit(2);
  }
  console.log(holding
    ? `OK: end-shift with custody allowed ONLY via the exception — dispatcher ack ${logged[0].dispatcherAckId}, next owner ${logged[0].nextOwner.kind}:${logged[0].nextOwner.ref}`
    : 'OK: custody-free end-shift, no exception needed');
  process.exit(0);
}
if (registry.shift('r-1').status !== 'on_shift') {
  console.error('FAIL-OPEN: refused end-shift changed shift state anyway'); process.exit(2);
}
console.error(`VIOLATION (caught, refused closed): ${outcome.reason} — the shift stays on; the package is never unowned`);
process.exit(1);
