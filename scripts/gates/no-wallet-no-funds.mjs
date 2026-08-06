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
    { name: 'wallet', regex: /wallet/i },
    { name: 'balance', regex: /(?<!text-?wrap:\s{0,2}['"])\bbalance\b/i },
    { name: 'holdFunds/captureFunds/releaseFunds', regex: /(hold|capture|release)[_-]?funds/i },
    { name: 'escrowAccount', regex: /escrow[_-]?account/i },
    { name: 'topUp', regex: /top[_-]?up\b/i },
    { name: 'withdrawal', regex: /withdraw/i },

    /* ── AUDIT-B+1 F2 — THE FRENCH HALF, REDESIGNED AFTER A VERIFIER BROKE IT ──
       The first version banned French money NOUNS in identifier position. A
       fresh-context verifier defeated it in one rename — a bare `solde: number`
       with `c.solde += montant` passed the whole board — and broke honest code
       at the same time, because « solde » in French commerce ALSO means a
       clearance sale (`prixSolde`, `enSolde`) and « avoir »/« caisse » are
       ordinary words. Banning the noun was wrong in both directions at once.

       WHAT ACTUALLY MARKS A WALLET is not the noun, it is the noun BOUND TO AN
       ACTOR (a per-seller, per-client amount) or ACCUMULATED (`+=`/`-=`). A
       clearance price is bound to a product and is never accumulated. So the
       patterns below require actor-binding, mutation, or member/key position —
       and `prixSolde`, `enSolde`, « soldes d'hiver » stay legal, by design.
       Proven against 24 evasion shapes and 9 honest-code shapes; see
       gates/fixtures/negative/no-wallet-no-funds/ and the fr-pattern-coverage
       gate, which fails if ANY pattern here stops being exercised. */
    { name: 'money noun bound to an actor (fr)', regex: /(solde|portefeuille|cagnotte|avoir|caisse|encours|reliquat|tirelire|bourse)s?\w{0,15}(vendeur|vendeuse|client|cliente|revendeur|revendeuse|fournisseur|utilisateur|marchand|livreur|coursier|compte)/i },
    { name: 'actor carrying a money noun (fr)', regex: /(vendeur|vendeuse|client|cliente|revendeur|revendeuse|fournisseur|utilisateur|marchand|compte)\w{0,15}(solde|portefeuille|cagnotte|caisse|encours|reliquat|tirelire)/i },
    { name: 'money noun accumulated (fr)', regex: /(solde|portefeuille|cagnotte|avoir|caisse|encours|reliquat|tirelire)\w*\s*[+-]=/i },
    { name: 'money noun assigned as a member/key (fr)', regex: /(?:\.|\[\s*["'])(solde|portefeuille|cagnotte|caisse|encours|reliquat)\b["']?\s*\]?\s*[+-]?=/i },
    { name: 'money noun as a JSON/object key (fr)', regex: /["'](solde|portefeuille|cagnotte|caisse|encours|reliquat)["']\s*:/i },
    { name: 'money noun declared as an amount (fr)', regex: /(?<![a-zA-ZÀ-ÿ])(solde|portefeuille|cagnotte|caisse|encours|reliquat)\s*:\s*(number|bigint)/i },
    { name: 'créditer/débiter (fr)', regex: /(?<![a-zA-ZÀ-ÿ])(cr[ée]diter|d[ée]biter)/i },
    { name: 'retrait/recharge/approvisionnement of an account (fr)', regex: /(retrait|retirer|recharge\w*|approvisionn\w*)[_.-]?(le|la|du|un)?[_.-]?(compte|solde|portefeuille|vendeur|client|revendeur)/i },
    { name: 'cagnotte / porte-monnaie / tirelire (fr)', regex: /(cagnotte|porte[_-]?monnaie|tirelire)/i },
];

if (isMainModule) {
    runScanGate({
      gateName: 'no-wallet-no-funds',
    invariant: 'Ten Laws #2 — no app holds funds; no wallet/balance module',
    patterns: PATTERNS,
  });
}

