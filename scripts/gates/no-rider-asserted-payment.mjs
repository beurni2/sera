#!/usr/bin/env node
// CI gate (SE-I11: "A rider MUST NOT accept a screenshot/SMS/verbal/pending
// as proof"): NO code path, type, event, or screen lets the rider record a
// payment — only the provider signal advances the door state. Modes:
//   no args — repo scan: no doorPaymentConfirmed write outside the owning
//             spine module, no rider-asserted-payment identifiers anywhere.
//   <dir>   — scan a fixture dir (the planted rider-asserted module must be caught).
import { scanForPatterns, countScannedFiles, DEFAULT_ROOTS } from './scan.mjs';

const PATTERNS = [
  { name: 'door state write', regex: /(\.|\[')doorPaymentConfirmed('\])?\s*=[^=]/ },
  { name: 'rider-asserted payment', regex: /rider[_A-Z][a-zA-Z_]*(paid|payment)|mark[_A-Z]?door[_A-Z]?paid|cash[_A-Z]?received|buyer[_A-Z]?paid[_A-Z]?cash|confirm[_A-Z]?payment[_A-Z]?manually/i },
];
const OWNING = /services[\/\\]custody-service[\/\\](src|dist)[\/\\]custody-spine\.(ts|js|d\.ts)$/;

const fixtureDir = process.argv[2];
const roots = fixtureDir ? [fixtureDir] : DEFAULT_ROOTS;
if (countScannedFiles(roots) === 0) { console.error('no scannable files'); process.exit(2); }
const hits = scanForPatterns(roots, PATTERNS).filter((hit) => (fixtureDir ? true : !OWNING.test(hit.file)));
if (fixtureDir) {
  if (hits.length === 0) { console.error('FAIL-OPEN: the planted rider-asserted payment was not caught'); process.exit(2); }
  console.error(`VIOLATION (caught): ${hits.length} rider-asserted payment surface(s):`);
  for (const hit of hits) console.error(`  ${hit.file}:${hit.lineNo} [${hit.pattern}] ${hit.line}`);
  process.exit(1);
}
if (hits.length > 0) {
  console.error(`no-rider-asserted-payment FAILED — ${hits.length} hit(s):`);
  for (const hit of hits) console.error(`  ${hit.file}:${hit.lineNo} [${hit.pattern}] ${hit.line}`);
  process.exit(1);
}
console.log('OK: no rider-asserted payment surface exists; only the provider signal writes the door state (SE-I11)');
process.exit(0);
