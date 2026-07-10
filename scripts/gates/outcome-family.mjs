#!/usr/bin/env node
// CI gate (SE6.1/SE-I10): every non-happy delivery resolution is a canonical
// DeliveryOutcome with a family from the v0.5.0 taxonomy — a bare 'failed'
// (or family-less) outcome is UNREPRESENTABLE: the strict schema refuses it
// and the ladder refuses reasons outside the taxonomy. Drives the REAL
// refusal ladder (built dist) + the pinned schema.
// Exit 0 = canonical outcome accepted. Exit 1 = violation caught (refused).
// Exit 2 = fail-open / harness error.
import { readFileSync } from 'node:fs';
import { DeliveryOutcomeSchema } from '@platform/contracts';
import { openRetryWindow } from '../../services/custody-service/dist/refusal-ladder.js';

const path = process.argv[2];
if (!path) { console.error('usage: outcome-family.mjs <fixture.json>'); process.exit(2); }
let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }

if (fixture.mode === 'ladder') {
  // The service layer: a door refusal must yield a canonical outcome; a
  // reason outside the taxonomy must refuse closed.
  const step = openRetryWindow({ taskId: 'task-1', orderId: 'order-1', reasonCode: fixture.reasonCode, at: '2026-07-10T12:00:00.000Z' });
  if (step.ok) {
    const parsed = DeliveryOutcomeSchema.safeParse(step.outcome);
    if (!parsed.success) { console.error('FAIL-OPEN: ladder produced a non-canonical outcome'); process.exit(2); }
    console.log(`OK: reason '${fixture.reasonCode}' → canonical DeliveryOutcome (family ${step.outcome.family}, fault ${step.outcome.faultClass}, window ${step.outcome.attempt.windowExpiresAt})`);
    process.exit(0);
  }
  console.error(`VIOLATION (caught, refused closed): ${step.reason} — '${fixture.reasonCode}' is not in the canonical taxonomy; no outcome exists`);
  process.exit(1);
}

// mode === 'shape': the raw outcome fixture must strict-parse — a 'failed'
// family or a missing family is a parse refusal.
const parsed = DeliveryOutcomeSchema.safeParse(fixture.outcome);
if (parsed.success) {
  console.log(`OK: canonical DeliveryOutcome (family ${parsed.data.family})`);
  process.exit(0);
}
console.error(`VIOLATION (caught, refused at parse): ${parsed.error.issues[0]?.path.join('.')} — ${parsed.error.issues[0]?.message}`);
process.exit(1);
