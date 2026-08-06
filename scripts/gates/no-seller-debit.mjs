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
 * wallet exists. The gate that carries that weight is
 * `persisted-state-declared` — a wallet must be PERSISTED to be a wallet, and
 * that surface is declared rather than guessed at.
 *
 * The priority when tuning is fixed: NEVER break honest work. A gate that cries
 * wolf on « engagement vendeur » or « la balance du marché » teaches everyone
 * to disable gates, and costs more than the leak it closed.
 */

/**
 * CI gate: no-seller-debit — Law 4's sibling.
 * A fault by someone who sells or delivers NEVER moves their money. Losses are
 * absorbed by the Protection Fund; consequences are access-based. No charge-back,
 * no deduction, no penalty taken out of what they are owed, in any language.
 *
 * WHY THIS FILE IS NOT A COPY OF THE BOUTIK+ ONE (founder ruling 2026-08-06,
 * measured before writing). Boutik+ bans the bare words `débit`, `retenue`,
 * `prélèvement`, `withhold`, `sanction` and `fine`. Run that list here and it
 * fails on 53 lines of correct, shipped code — including the exact sentences
 * that make the product trustworthy:
 *   · « Votre argent n'a pas été débité. » — buyer-facing reassurance. Banning
 *     `débit` would force DELETING the sentence that tells a buyer we took
 *     nothing. The gate would be destroying the thing it exists to protect.
 *   · « WITHHOLDS the code » — custody law: the drop code is withheld until
 *     every due leg is provider-confirmed. That is the invariant, not a breach.
 *   · `expect(text).not.toContain('prélev')` — a test ASSERTING the absence.
 *   · « reads fine », « inspected fine » — ordinary English.
 * So the debit terms are bound to the EARNER whose money would move.
 */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

export const PATTERNS = [
  /* Unambiguous on their own — no honest use in this product. */
  { name: 'clawback', regex: /clawback/i },
  { name: 'garnish', regex: /garnish/i },
  { name: 'sellerCharge/chargeSeller', regex: /(seller|reseller|rider)[_-]?charge|charge[_-]?(seller|reseller|rider)/i },
  { name: 'deduct from an earner', regex: /deduct\w*[_-]?(from[_-]?)?(seller|reseller|supplier|rider|courier|vendeur|revendeuse|livreur)/i },
  { name: 'debit an earner', regex: /debit\w{0,4}[_-]?(seller|reseller|supplier|rider|courier)|((seller|reseller|rider)[_-]?debit)/i },

  /* French — bound to the earner or to what they are owed. */
  { name: 'débiter un gagnant (fr)', regex: /d[ée]bit\w*[_-]?(le[_-]?|la[_-]?|du[_-]?)?(vendeur|vendeuse|revendeur|revendeuse|fournisseur|livreur|coursier|marchand)/i },
  { name: 'earner carrying a débit (fr)', regex: /(vendeur|vendeuse|revendeur|revendeuse|fournisseur|livreur|coursier|marchand)\w{0,10}d[ée]bit/i },
  { name: 'retenue sur ventes/gains (fr)', regex: /retenue[_-]?(sur[_-]?)?(ventes?|gains?|revenus?|commissions?|vendeur|revendeuse|livreur)/i },
  { name: 'prélèvement sur ventes/gains (fr)', regex: /pr[ée]l[èe]v\w*[_-]?(sur[_-]?)?(ventes?|gains?|revenus?|vendeur|revendeuse|livreur)/i },
  { name: 'pénalité bound to an earner (fr)', regex: /(p[ée]nalit|amende)\w{0,4}[_-]?(du?[_-]?|de[_-]?la[_-]?)?(vendeur|vendeuse|revendeur|revendeuse|livreur|coursier|marchand)/i },
  { name: 'earner carrying a pénalité (fr)', regex: /(vendeur|vendeuse|revendeur|revendeuse|livreur|coursier|marchand)\w{0,10}(p[ée]nalit|amende)/i },
  { name: 'pénalité/amende carrying an amount (fr)', regex: /(p[ée]nalit[ée]?|amende)[_-]?(fcfa|xof|montant|amount)/i },
];

if (isMainModule) {
  runScanGate({
    gateName: 'no-seller-debit',
    invariant: 'Law 4 sibling — earner consequences are access-based, never money',
    patterns: PATTERNS,
  });
}
