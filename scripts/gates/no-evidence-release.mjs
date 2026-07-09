#!/usr/bin/env node
import { runScanGate } from './scan.mjs';

/**
 * CI gate: evidence ≠ release (§5.5: "Evidence supports, never releases; a
 * rider code/photo/GPS/self-declaration alone MUST NOT release money";
 * SE-I09). No type or path from EvidenceBundle to any settlement mutation
 * may exist in this repo — the recognizable forms are banned identifiers.
 */
runScanGate({
  gateName: 'no-evidence-release',
  invariant: '§5.5 evidence supports, never releases — no EvidenceBundle→settlement path',
  patterns: [
    { name: 'releaseSettlement', regex: /release[_-]?settlement/i },
    { name: 'settlementRelease', regex: /settlement[_-]?release/i },
    { name: 'releaseOnEvidence', regex: /release[_-]?(on[_-]?)?evidence|evidence[_-]?release/i },
    { name: 'markPaid', regex: /mark[_-]?(as[_-]?)?paid/i },
    { name: 'autoRelease', regex: /auto[_-]?release/i },
    { name: 'releaseFunds/payout', regex: /release[_-]?(funds|payout)/i },
    { name: 'settlement mutation verb', regex: /(set|update|write|mutate)[_-]?settlement/i },
  ],
});
