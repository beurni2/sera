#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { DEFAULT_ROOTS, countScannedFiles, walkFiles } from './scan.mjs';

/**
 * CI gate: off-shift-location (SE-I08: "Courier location collected only on
 * shift/active task"; §12: "off-shift location not collected"). Geolocation
 * APIs are permitted ONLY inside the one shift-scoped module — whose capture
 * type requires an ActiveShiftScope — and nowhere else in the repo.
 */
const ALLOWED = 'services/logistics-service/src/shift-location.ts';
const PATTERNS = [
  { name: 'navigator.geolocation', regex: /navigator\.geolocation/i },
  { name: 'getCurrentPosition/watchPosition', regex: /getCurrentPosition|watchPosition/i },
  { name: 'expo-location import', regex: /['"`]expo-location['"`]/i },
  { name: 'react-native-geolocation', regex: /react-native-geolocation/i },
  { name: 'background location', regex: /startLocationUpdates|BackgroundLocation/i },
];

const args = process.argv.slice(2);
const roots = args.length > 0 ? args : DEFAULT_ROOTS;
if (countScannedFiles(roots) === 0) {
  console.error(`off-shift-location ERROR — no scannable files under ${roots.join(', ')}; refusing to pass on an empty scan`);
  process.exit(2);
}
const hits = [];
for (const root of roots) {
  try {
    statSync(root);
  } catch {
    continue;
  }
  for (const file of walkFiles(root)) {
    const rel = relative(process.cwd(), file).replaceAll('\\', '/');
    if (rel === ALLOWED) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { name, regex } of PATTERNS) {
        if (regex.test(line)) hits.push(`${rel}:${i + 1} [${name}] ${line.trim()}`);
      }
    });
  }
}
if (hits.length === 0) {
  console.log(`off-shift-location OK — geolocation APIs only in ${ALLOWED} (shift-scoped, SE-I08)`);
  process.exit(0);
}
console.error(`off-shift-location FAILED (SE-I08 — off-shift location not collected) — ${hits.length} hit(s) outside the shift-scoped module:`);
for (const h of hits) console.error(`  ${h}`);
process.exit(1);
