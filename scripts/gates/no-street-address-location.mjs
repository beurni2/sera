#!/usr/bin/env node
// CI gate (SE0.3, acceptance SE4): "no street address" — delivery locations
// are EXCLUSIVELY the pinned kernel Location {pin, zone, landmark,
// directions, maskedRelay}, strict: any street-address-bearing fixture is a
// parse FAILURE (exit 1). Belt-and-braces: a key sweep also catches
// street/address keys nested anywhere. Exit 2 = unusable input.
import { readFileSync } from 'node:fs';
import { LocationSchema } from '@platform/kernel-types';

const path = process.argv[2];
if (!path) { console.error('usage: no-street-address-location.mjs <location-fixture.json>'); process.exit(2); }

let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }

const BANNED_KEY = /street|address|adresse|\brue\b/i;
function sweep(value, trail) {
  if (Array.isArray(value)) { value.forEach((v, i) => sweep(v, `${trail}[${i}]`)); return []; }
  if (value === null || typeof value !== 'object') return [];
  const hits = [];
  for (const [key, child] of Object.entries(value)) {
    if (BANNED_KEY.test(key)) hits.push(`${trail}.${key}`);
    hits.push(...sweep(child, `${trail}.${key}`));
  }
  return hits;
}

const parsed = LocationSchema.safeParse(fixture);
const keyHits = sweep(fixture, 'location');
if (!parsed.success || keyHits.length > 0) {
  if (keyHits.length > 0) console.error(`VIOLATION: street-address material in a delivery location: ${keyHits.join(', ')}`);
  else console.error('VIOLATION: not the canonical kernel Location (strict) — undeclared or missing fields');
  process.exit(1);
}
console.log('OK: canonical kernel Location — landmark-first fields only, no street address anywhere');
