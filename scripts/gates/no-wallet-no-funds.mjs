#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runScanGate } from './scan.mjs';

/**
 * ── THIS GATE IS A TRIPWIRE, NOT A PROOF ───────────────────────────────────
 * Read this before trusting it, and before widening it.
 *
 * It matches VOCABULARY. Two fresh-context verifier rounds defeated earlier
 * versions in both directions at once, because French money vocabulary IS
 * ordinary French vocabulary: « solde » is also a clearance sale, « avoir » is
 * also the verb to have, « en cours » is also "in progress", « retrait » is
 * also a pickup, « dépôt » is also a warehouse, « garantie » is also a
 * warranty, « balance » is also the scales a market seller weighs goods on.
 * Cross that with unbounded synonyms for the money noun AND for the actor and
 * no regex over the product is both leak-free and safe.
 *
 * So this gate catches the OBVIOUS and the ACCIDENTAL. A synonym outside its
 * lists escapes it, by design and on the record. It does NOT establish that no
 * wallet exists. Nothing automated does. That claim rests on review of the
 * persistence layer — a wallet must be PERSISTED to be a wallet, so the
 * question to put to every diff is which stored key accumulates a per-actor
 * amount. Checked by hand across all three repos on 2026-08-06: none does.
 *
 * The priority when tuning is fixed: NEVER break honest work. A gate that cries
 * wolf on « engagement vendeur » or « la balance du marché » teaches everyone
 * to disable gates, and costs more than the leak it closed.
 */

/* Run the gate only when EXECUTED, not when imported. `fr-pattern-coverage`
   imports PATTERNS to prove every one of them is exercised by a fixture; without
   this guard that import would run the gate and exit the coverage process. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

/**
 * CI gate: no-wallet / no-payment-funds VOCABULARY TRIPWIRE (Ten Laws #2,
 * Séra spec SE-I09: "Séra never computes proceeds, never holds product funds, never marks paid").
 * The law says no wallet/balance module exists anywhere; this file only
 * payment truth. Settlement views read SettlementObligation — never a
 * locally computed balance.
 */
export const PATTERNS = [
    /* UNAMBIGUOUS — no innocent reading in this product. */
    { name: 'wallet', regex: /wallet/i },
    { name: 'balance (english money sense)', regex: /(?<!insufficient_)(?<![a-zA-ZÀ-ÿ])balances?\s*[:=][^=]|\.\s*balances?\b|(seller|user|account|client|vendeur|compte|wallet|cash|credit|fund|payout|ledger|running)Balances?\b|\b(seller|user|account|client|vendeur|compte)_balances?\b/i },
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

