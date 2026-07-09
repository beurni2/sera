#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { PackageReadinessConfirmationSchema } from '@platform/contracts';

/**
 * CI gate: four-secrets separation (§5.6: buyerDropCode is "private — never
 * shown to the seller or in readiness evidence"). Enforcement is CANONICAL:
 * the payload must strict-parse as the pinned PackageReadinessConfirmation —
 * whose strict schema refuses buyerDropCode, any foreign secret, and any
 * undeclared key by construction. A key-regex sweep runs after the parse as
 * belt-and-braces for nested artifact payloads.
 */
const file = process.argv[2];
if (!file) {
  console.error('usage: no-drop-code-in-seller-evidence.mjs <readiness-evidence.json>');
  process.exit(2);
}
let payload;
try {
  payload = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`no-drop-code-in-seller-evidence: cannot read payload ${file}: ${String(err)}`);
  process.exit(2);
}
const parsed = PackageReadinessConfirmationSchema.safeParse(payload);
if (!parsed.success) {
  console.error('no-drop-code-in-seller-evidence FAILED — payload is not a canonical PackageReadinessConfirmation (the strict canon schema refuses foreign secrets and undeclared keys):');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}
const BANNED = [
  { name: 'buyerDropCode', regex: /drop[_-]?code/i },
  { name: 'pickupVerificationCode (rider secret on a seller surface)', regex: /pickup[_-]?verification[_-]?code/i },
  { name: 'HandoffAuthorization secret', regex: /handoff[_-]?authorization/i },
];
const hits = [];
function walk(value, path) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      for (const { name, regex } of BANNED) {
        if (regex.test(k)) hits.push(`${path}.${k} — ${name}`);
      }
      walk(v, `${path}.${k}`);
    }
  }
}
walk(payload, '$');
if (hits.length === 0) {
  console.log(`no-drop-code-in-seller-evidence OK — ${file} is a canonical PackageReadinessConfirmation carrying only the seller readiness secret`);
  process.exit(0);
}
console.error(`no-drop-code-in-seller-evidence FAILED — ${hits.length} foreign secret(s) nested in a seller/readiness payload:`);
for (const h of hits) console.error(`  - ${h}`);
process.exit(1);
