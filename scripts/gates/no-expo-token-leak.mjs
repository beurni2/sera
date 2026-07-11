#!/usr/bin/env node
import { runScanGate } from './scan.mjs';

/**
 * CI gate: no-expo-token-leak (WO-4.0). The EXPO_TOKEN exists ONLY as a
 * GitHub secret consumed via env in the workflow — a literal assignment of
 * a token value anywhere in committed product code, config, or lockfile is
 * a leak. Patterns:
 * - EXPO_TOKEN followed by = or : and a QUOTED/BARE literal value (a real
 *   assignment) — while `secrets.EXPO_TOKEN`, `$EXPO_TOKEN`, and yaml
 *   `EXPO_TOKEN: ${{ ... }}` references stay lawful.
 * - Expo personal access token shapes (their documented prefixes).
 */
runScanGate({
  gateName: 'no-expo-token-leak',
  invariant: 'WO-4.0 credentials never committed',
  patterns: [
    // An assignment to a literal (not a ${{ secrets… }} / $ENV reference).
    { name: 'EXPO_TOKEN literal assignment', regex: /EXPO_TOKEN\s*[:=]\s*['"]?(?!\$)[A-Za-z0-9_-]{8,}/ },
    // Documented Expo token prefixes appearing as literals anywhere.
    { name: 'expo token shape', regex: /\b(expo_pat_|ExponentPushToken\[)[A-Za-z0-9_-]{6,}/ },
  ],
  defaultRoots: ['apps', 'services', 'packages', '.github', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
});
