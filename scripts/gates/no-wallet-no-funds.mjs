#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runScanGate } from './scan.mjs';

/* Run the gate only when EXECUTED, not when imported. `fr-pattern-coverage`
   imports PATTERNS to prove every one of them is exercised by a fixture; without
   this guard that import would run the gate and exit the coverage process. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

/**
 * CI gate: no-wallet / no-payment-funds architectural check (Ten Laws #2,
 * Séra spec SE-I09: "Séra never computes proceeds, never holds product funds, never marks paid").
 * No wallet/balance module exists anywhere; provider webhooks are the only
 * payment truth. Settlement views read SettlementObligation — never a
 * locally computed balance.
 */
export const PATTERNS = [
    /* UNAMBIGUOUS — no innocent reading in this product. */
    { name: 'wallet', regex: /wallet/i },
    { name: 'balance', regex: /(?<!text-?wrap:\s{0,2}['"])(?<!text-)\bbalance\b/i },
    { name: 'holdFunds/captureFunds/releaseFunds', regex: /(hold|capture|release)[_-]?funds/i },
    { name: 'escrowAccount', regex: /escrow[_-]?account/i },
    { name: 'topUp', regex: /top[_-]?up\b/i },
    { name: 'withdrawal', regex: /withdraw/i },
    { name: 'cagnotte / porte-monnaie / tirelire (fr)', regex: /(cagnotte|porte[_-]?monnaie|tirelire)/i },
    { name: 'créditer/débiter (fr)', regex: /(?<![a-zA-ZÀ-ÿ])(cr[ée]diter|d[ée]biter)/i },
    { name: 'approvisionner/recharger un compte (fr)', regex: /(approvisionn|recharg)\w*[_-]?(le[_-]?|la[_-]?)?(compte|solde|portefeuille)/i },

    /* ACTOR-BOUND — a money noun attached to a person or an account. The actor
       list is deliberately WIDE; it is still a list, and a synonym outside it
       escapes. That is a known and accepted limit — see the header. */
    { name: 'money noun bound to an actor (fr)', regex: /(solde|portefeuille|cr[ée]dit|fonds|[ée]pargne|tr[ée]sorerie|cr[ée]ance|ardoise|cagnotte|tirelire)s?\w{0,12}(vendeur|vendeuse|revendeur|revendeuse|fournisseur|marchand|commer[cç]ant|grossiste|boutique|g[ée]rant|agent|membre|b[ée]n[ée]ficiaire|livreur|coursier|client|cliente|utilisateur|compte)/i },
    { name: 'actor carrying a money noun (fr)', regex: /(vendeur|vendeuse|revendeur|revendeuse|fournisseur|marchand|commer[cç]ant|grossiste|boutique|g[ée]rant|agent|membre|b[ée]n[ée]ficiaire|livreur|coursier|client|cliente|utilisateur|compte)\w{0,12}(solde|portefeuille|cr[ée]dit|fonds|[ée]pargne|tr[ée]sorerie|cr[ée]ance|ardoise|cagnotte|tirelire)\b/i },
    { name: 'money noun accumulated (fr)', regex: /(?<![a-zA-ZÀ-ÿ])(solde|portefeuille|cr[ée]dit|fonds|[ée]pargne|tr[ée]sorerie|cr[ée]ance|ardoise|cagnotte|tirelire)\w*\s*[+-]=/i },
    { name: 'money noun assigned as a member (fr)', regex: /(?:\.|\[\s*["'])(solde|portefeuille|cr[ée]dit|fonds|[ée]pargne|tr[ée]sorerie|cr[ée]ance|ardoise|cagnotte|tirelire)\b["']?\s*\]?\s*[+-]?=/i },
    { name: 'money noun as a JSON key (fr)', regex: /["'](solde|portefeuille|cr[ée]dit|fonds|[ée]pargne|tr[ée]sorerie|cr[ée]ance|ardoise|cagnotte|tirelire)["']\s*:\s*[0-9-]/i },
];

if (isMainModule) {
    runScanGate({
      gateName: 'no-wallet-no-funds',
    invariant: 'Ten Laws #2 — no app holds funds; no wallet/balance module',
    patterns: PATTERNS,
  });
}

