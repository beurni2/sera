#!/usr/bin/env node
import { runScanGate } from './scan.mjs';

/**
 * CI gate: no-wallet / no-payment-funds architectural check (Ten Laws #2,
 * Séra spec SE-I09: "Séra never computes proceeds, never holds product funds, never marks paid").
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

    /* ── AUDIT-B+1 F2 — THE FRENCH HALF ───────────────────────────────────
       Found by a harness audit of Boutik+: an auditor planted a working seller
       wallet — `soldeVendeur` with `crediter`/`retirer` — in the product
       directory and the FULL gate board printed ALL GATES GREEN. The English
       control (`Wallet { balance }`) was caught correctly: the gate worked, its
       vocabulary was monolingual in a product whose entire domain language is
       French. This repo shipped the identical blindness.

       WHY IDENTIFIER-POSITION AND NOT BARE WORDS. The words that name this
       violation also name its PROHIBITION: `solde` and `portefeuille` appear
       today only in comments and copy asserting that we hold nothing. Banning
       the bare nouns would fail the build on the very code and copy that
       enforce the law, and would push someone to delete the sentence that tells
       a seller we hold nothing. So the money forms are banned where a FIELD
       lives — camelCase, snake_case or SCREAMING_SNAKE — and prose is left able
       to say what we refuse to build. */
    { name: 'solde… (fr, identifier)', regex: /(solde|SOLDE)[_A-Z]/ },
    { name: '…Solde (fr, identifier)', regex: /[a-z0-9]Solde\b/ },
    { name: 'portefeuille… (fr, identifier)', regex: /(portefeuille|PORTEFEUILLE)[_A-Z]/ },
    { name: 'créditer/débiter un compte (fr)', regex: /(cr[ée]diter|d[ée]biter)[_-]?(le[_-]?)?(compte|solde|vendeur|client)/i },
    { name: 'cagnotte (fr)', regex: /cagnotte/i },
    { name: 'porte-monnaie (fr)', regex: /porte[_-]?monnaie/i },
    { name: 'approvisionner le compte (fr)', regex: /approvisionn\w*[_-]?(le[_-]?)?compte/i },
  ],
});
