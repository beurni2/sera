#!/usr/bin/env node
// CI gate (SE4.1): append-only hash-chained ledger — a tampered entry breaks
// verification; a second concurrent custodian write is REFUSED at the store.
// Drives the REAL CustodyLedger (built dist) through the fixture's scenario.
// Exit 1 = violation caught (refused closed / chain failed as required).
// Exit 2 = unusable input or an invariant that FAILED to catch.
import { readFileSync } from 'node:fs';
import { CustodyLedger } from '../../services/custody-service/dist/custody-ledger.js';

const path = process.argv[2];
if (!path) { console.error('usage: custody-ledger.mjs <scenario-fixture.json>'); process.exit(2); }
let fixture;
try { fixture = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { console.error(`unreadable fixture: ${e.message}`); process.exit(2); }

const T = '2026-07-10T12:00:00.000Z';
const ledger = new CustodyLedger();
ledger.append({ packageId: 'pkg-1', kind: 'custody_transition', payload: { to: 'seller:sup-1' }, at: T });
ledger.append({ packageId: 'pkg-1', kind: 'pickup_verification', payload: { result: 'accepted' }, at: T });
ledger.append({ packageId: 'pkg-1', kind: 'custody_transition', payload: { from: 'seller:sup-1', to: 'courier:r-1' }, at: T });

if (fixture.scenario === 'honest') {
  const verdict = ledger.verifyChain();
  if (!verdict.valid) { console.error('honest ledger failed verification'); process.exit(2); }
  console.log(`OK: ${ledger.all().length} hash-linked entries verify; current custodian courier:r-1`);
  process.exit(0);
}
if (fixture.scenario === 'tampered_entry') {
  ledger.all()[fixture.tamperSeq].payload.result = 'refused'; // hostile mutation
  const verdict = ledger.verifyChain();
  if (verdict.valid) { console.error('TAMPER NOT DETECTED — the chain lied'); process.exit(2); }
  console.error(`VIOLATION (caught): committed entry ${fixture.tamperSeq} was mutated — chain verification FAILED at seq ${verdict.brokenAtSeq}`);
  process.exit(1);
}
if (fixture.scenario === 'double_custodian') {
  const conflict = ledger.append({ packageId: 'pkg-1', kind: 'custody_transition', payload: { from: 'seller:sup-1', to: `courier:${fixture.impostorRider}` }, at: T });
  if (conflict.ok) { console.error('SECOND CUSTODIAN ACCEPTED — one-current-custodian broken'); process.exit(2); }
  console.error(`VIOLATION (caught, refused closed): concurrent custodian write for ${fixture.impostorRider} → ${conflict.reason}; custodian stays courier:r-1`);
  process.exit(1);
}
console.error(`unknown scenario '${fixture.scenario}'`); process.exit(2);
