#!/usr/bin/env node
// CI gate (SE0.2, acceptance SE1): "uncertified/off-shift not assignable" —
// REFUSED CLOSED. Validates an assignment fixture through the REAL
// RiderRegistry (built dist) — the same isAssignable() the AssignmentBook
// consults — not a re-implementation. Exit 1 = the invariant caught a
// violation. Exit 2 = unusable input (a crash must never pass for a working
// negative fixture).
import { readFileSync } from 'node:fs';
import { RiderRegistry, PRIVACY_NOTICE_VERSION } from '../../services/logistics-service/dist/rider-registry.js';

const path = process.argv[2];
if (!path) { console.error('usage: rider-assignability.mjs <assignment-fixture.json>'); process.exit(2); }

let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }

const { rider, shift, assignment } = fixture;
if (!rider || !shift || !assignment) { console.error('fixture must carry rider, shift, assignment'); process.exit(2); }

const registry = new RiderRegistry();
registry.register({
  riderId: rider.riderId,
  displayName: rider.displayName ?? rider.riderId,
  phoneAlias: rider.phoneAlias ?? 'alias',
  certified: rider.certified === true,
});
if (rider.privacyAckVersion) {
  registry.acknowledgePrivacyNotice(rider.riderId, rider.privacyAckVersion, shift.at ?? '2026-07-09T12:00:00.000Z');
}
if (shift.state === 'on_shift_server_confirmed') {
  const started = registry.startShift(rider.riderId, shift.at, 'server_confirmed');
  if (!started.ok) {
    console.error(`VIOLATION: shift start refused closed (${started.reason}) — the fixture claims an active shift it cannot have`);
    process.exit(1);
  }
} else if (shift.state === 'shift_start_pending_offline') {
  registry.startShift(rider.riderId, shift.at, 'queued_offline');
} // 'off_shift' → nothing

if (!registry.isAssignable(rider.riderId)) {
  console.error(
    `VIOLATION: assignment fixture puts task ${assignment.taskId} on rider ${rider.riderId}, ` +
    `who is NOT assignable (certified=${rider.certified === true}, shift=${registry.shift(rider.riderId).status}) — refused closed (SE1)`,
  );
  process.exit(1);
}
console.log(`OK: rider ${rider.riderId} is certified, privacy-acked (${PRIVACY_NOTICE_VERSION}), on shift (server-confirmed) — assignable`);
