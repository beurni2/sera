#!/usr/bin/env node
import { runScanGate } from './scan.mjs';

/**
 * CI gate: single-level (B+I-10, Ten Laws #9).
 * No recruitment mechanics, no downlines, no multi-level anything, anywhere.
 * `referral` is banned outright at this slice — referral.* event names are
 * excluded from the pinned event union and nothing gated may appear here.
 */
runScanGate({
  gateName: 'single-level',
  invariant: 'B+I-10 single-level only — no recruitment/downline mechanics',
  patterns: [
    { name: 'downline', regex: /downline/i },
    { name: 'upline', regex: /upline/i },
    { name: 'recruit', regex: /recruit/i },
    { name: 'mlm', regex: /\bmlm\b/i },
    { name: 'multi-level', regex: /multi[_-]?level/i },
    { name: 'networkDepth', regex: /network[_-]?depth/i },
    { name: 'referral', regex: /referral/i },
    { name: 'sponsorTree', regex: /sponsor[_-]?tree/i },
  ],
});
