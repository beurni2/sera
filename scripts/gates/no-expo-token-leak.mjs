#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { runScanGate } from './scan.mjs';

/**
 * CI gate: no-expo-token-leak (WO-4.0; widened per the WO-4.0 verifier's two
 * blocking findings; WO-4.0d rider: dotenv variants + git-ls-files sweep).
 * The EXPO_TOKEN exists ONLY as a GitHub secret consumed via env in the
 * workflow -- a literal assignment of a token value anywhere in committed
 * artifacts is a leak. Coverage notes:
 * - The key may be QUOTED (JSON/yaml: "EXPO_TOKEN": "...") -- the regex
 *   tolerates quotes around the key and the value.
 * - Shell scripts, .env files AND their dotenv variants (.env.local,
 *   .env.production, ...), and markdown ARE committed artifacts -- the scan
 *   extension set is widened FOR THIS GATE ONLY.
 * - Coverage is git-ls-files-driven: EVERY tracked file passing the
 *   extension filter is scanned (gallery/, turbo.json, JOURNAL.md -- nothing
 *   sits outside fixed roots anymore). Explicit CLI roots (the negative
 *   fixture run) still override.
 * - `${{ secrets.EXPO_TOKEN }}` and `"$EXPO_TOKEN"` references stay lawful
 *   (values starting with $ are excluded).
 */
const SCAN_EXTENSIONS = /(\.(ts|tsx|js|jsx|mjs|cjs|json|sql|ya?ml|sh|bat|md)|\.env(\..+)?)$/;
// gates/fixtures/ holds the PLANTED negative demonstrations (scan.mjs
// design note) -- they are scanned via the explicit fixture run, never in
// the positive sweep, or the gate would fail on its own proof material.
const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.startsWith('gates/fixtures/'))
  .filter((f) => SCAN_EXTENSIONS.test(f));

runScanGate({
  gateName: 'no-expo-token-leak',
  invariant: 'WO-4.0 credentials never committed',
  patterns: [
    // Quoted or bare key, = or :, then a literal (not a $reference).
    { name: 'EXPO_TOKEN literal assignment', regex: /['"]?EXPO_TOKEN['"]?\s*[:=]\s*['"]?(?!\$)[A-Za-z0-9_-]{8,}/ },
    // Documented Expo token prefixes appearing as literals anywhere.
    { name: 'expo token shape', regex: /\b(expo_pat_|ExponentPushToken\[)[A-Za-z0-9_-]{6,}/ },
  ],
  defaultRoots: trackedFiles,
  scanExtensions: SCAN_EXTENSIONS,
});
