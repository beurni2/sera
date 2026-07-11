#!/usr/bin/env node
import { runScanGate } from './scan.mjs';

/**
 * CI gate: no-expo-token-leak (WO-4.0; regex + coverage widened per the
 * WO-4.0 verifier's two blocking findings). The EXPO_TOKEN exists ONLY as a
 * GitHub secret consumed via env in the workflow — a literal assignment of
 * a token value anywhere in committed artifacts is a leak. Coverage notes:
 * - The key may be QUOTED (JSON/yaml: "EXPO_TOKEN": "…") — the regex
 *   tolerates quotes around the key and the value.
 * - Shell scripts, .env files, and markdown ARE committed artifacts (this
 *   slice ships run-preview.sh/.bat and PREVIEW.md) — the scan extension
 *   set is widened FOR THIS GATE ONLY (other gates keep the default set).
 * - `${{ secrets.EXPO_TOKEN }}` and `"$EXPO_TOKEN"` references stay lawful
 *   (values starting with $ are excluded).
 */
runScanGate({
  gateName: 'no-expo-token-leak',
  invariant: 'WO-4.0 credentials never committed',
  patterns: [
    // Quoted or bare key, = or :, then a literal (not a $reference).
    { name: 'EXPO_TOKEN literal assignment', regex: /['"]?EXPO_TOKEN['"]?\s*[:=]\s*['"]?(?!\$)[A-Za-z0-9_-]{8,}/ },
    // Documented Expo token prefixes appearing as literals anywhere.
    { name: 'expo token shape', regex: /\b(expo_pat_|ExponentPushToken\[)[A-Za-z0-9_-]{6,}/ },
  ],
  defaultRoots: ['apps', 'services', 'packages', 'scripts', '.github', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'PREVIEW.md'],
  scanExtensions: /\.(ts|tsx|js|jsx|mjs|cjs|json|sql|ya?ml|sh|bat|env|md)$/,
});
