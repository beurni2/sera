#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { AssignmentLeaseSchema } from '@platform/contracts';

/**
 * CI gate: one-assignment-authority (SE-I01: "Exactly one assignment
 * authority per task"; §5.6 AssignmentLease "exactly one active"). Validates
 * a lease-set fixture with the PINNED canonical schema, then enforces the
 * rule: at most ONE lease with status 'active' per task. Seed of the SE2.1
 * atomic-lease Durable Object.
 */
const file = process.argv[2];
if (!file) {
  console.error('usage: one-assignment-authority.mjs <leases.json>');
  process.exit(2);
}
let leases;
try {
  leases = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`one-assignment-authority: cannot read fixture ${file}: ${String(err)}`);
  process.exit(2);
}
if (!Array.isArray(leases)) {
  console.error(`one-assignment-authority: ${file} is not a lease array`);
  process.exit(2);
}
for (const [i, lease] of leases.entries()) {
  const parsed = AssignmentLeaseSchema.safeParse(lease);
  if (!parsed.success) {
    console.error(`one-assignment-authority: leases[${i}] is not a canonical AssignmentLease`);
    process.exit(2);
  }
}
const activeByTask = new Map();
for (const lease of leases) {
  if (lease.status !== 'active') continue;
  activeByTask.set(lease.taskId, [...(activeByTask.get(lease.taskId) ?? []), lease.holder]);
}
const violations = [...activeByTask.entries()].filter(([, holders]) => holders.length > 1);
if (violations.length === 0) {
  console.log(`one-assignment-authority OK — ${leases.length} lease(s), at most one active per task (SE-I01)`);
  process.exit(0);
}
console.error('one-assignment-authority FAILED (SE-I01 — exactly one assignment authority):');
for (const [taskId, holders] of violations) {
  console.error(`  - task ${taskId}: ${holders.length} ACTIVE leases held by [${holders.join(', ')}]`);
}
process.exit(1);
