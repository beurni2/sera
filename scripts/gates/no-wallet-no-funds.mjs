#!/usr/bin/env node
import { runScanGate } from './scan.mjs';

/**
 * CI gate: no-wallet / no-payment-funds architectural check (Ten Laws #2,
 * spec §1: "Boutik+ MUST NOT hold funds or compute an independent balance").
 * No wallet/balance module exists anywhere; provider webhooks are the only
 * payment truth. Settlement views read SettlementObligation — never a
 * locally computed balance.
 */
runScanGate({
  gateName: 'no-wallet-no-funds',
  invariant: 'Ten Laws #2 — no app holds funds; no wallet/balance module',
  patterns: [
    { name: 'wallet', regex: /wallet/i },
    { name: 'balance', regex: /\bbalance\b/i },
    { name: 'holdFunds/captureFunds/releaseFunds', regex: /(hold|capture|release)[_-]?funds/i },
    { name: 'escrowAccount', regex: /escrow[_-]?account/i },
    { name: 'topUp', regex: /top[_-]?up\b/i },
    { name: 'withdrawal', regex: /withdraw/i },
  ],
});
