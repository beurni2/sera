#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runScanGate } from './scan.mjs';

/**
 * CI gate: no-seller-deposit — Law 4, standing guardrail.
 * Spec §, verbatim: « zero seller deposit; buyer refund never fund-gated ».
 * Nobody who SELLS or DELIVERS is ever asked to put money down. No field, no
 * flow, no exception.
 *
 * WHY THIS FILE IS NOT A COPY OF THE BOUTIK+ ONE (founder ruling 2026-08-06,
 * measured before writing). Boutik+ bans the bare words `deposit` and `dépôt`,
 * which is safe THERE because the supplier surface never says them. Run the
 * same list here and it fails on 32 lines of correct, shipped code:
 *   · `requiredDeposit` — the CANONICAL `PayAtDoorEligibility` field. That is a
 *     BUYER's pay-at-door risk rung, not a seller's deposit; it is canon, it is
 *     currently 0 everywhere, and banning it would ban the contract.
 *   · `RESERVE_FIELDS = ['commandId','holderRef']` — reserved field NAMES.
 *   · Séra: « Au dépôt » is a PLACE — the depot — nothing to do with money.
 * So the deposit terms are bound to the ACTOR who would be asked to pay: a
 * seller, a reseller, a supplier, a rider. That is the violation; the noun
 * alone is not.
 */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

export const PATTERNS = [
  /* UNAMBIGUOUS. « dépôt » is NOT here: it is also a WAREHOUSE, and « garantie »
     alone is a WARRANTY — banning either breaks ordinary commerce code. */
  { name: 'deposit demanded of an earner', regex: /(seller|reseller|supplier|rider|courier|vendor|merchant)[_-]?deposit|deposit[_-]?(from[_-]?)?(seller|reseller|supplier|rider)/i },
  { name: 'sellerReserve', regex: /(seller|reseller|rider)[_-]?reserve/i },
  { name: 'reserveBalance/reserveAmount', regex: /reserve[_-]?(balance|amount|fcfa)/i },
  { name: 'bond demanded of an earner', regex: /(seller|reseller|rider|courier|security)[_-]?bond\b/i },
  { name: 'onboardingFee', regex: /onboarding[_-]?fee/i },
  { name: 'subscriptionFee', regex: /subscription[_-]?fee/i },
  { name: 'joining/signup/registration fee', regex: /(joining|signup|sign[_-]?up|registration)[_-]?fee/i },
  { name: "frais d'inscription/adhésion (fr)", regex: /frais[_-]?d[_'-]?(inscription|adh[ée]sion)/i },
  { name: 'caution/arrhes/nantissement bound to an earner (fr)', regex: /(caution|arrhes|nantissement|gage)s?\w{0,12}(vendeur|vendeuse|revendeur|revendeuse|fournisseur|marchand|commer[cç]ant|grossiste|boutique|g[ée]rant|agent|membre|b[ée]n[ée]ficiaire|livreur|coursier|client|cliente|utilisateur|compte)/i },
  { name: 'earner carrying caution/arrhes (fr)', regex: /(vendeur|vendeuse|revendeur|revendeuse|fournisseur|marchand|commer[cç]ant|grossiste|boutique|g[ée]rant|agent|membre|b[ée]n[ée]ficiaire|livreur|coursier|client|cliente|utilisateur|compte)\w{0,12}(caution|arrhes|nantissement)/i },
  { name: 'caution/arrhes carrying an amount (fr)', regex: /(caution|arrhes|nantissement|gage)[_-]?(fcfa|xof|montant|amount|min|max)/i },
  { name: 'exiger/verser une caution (fr)', regex: /(exiger|demander|verser|bloquer)[_.-]?(une?|la|le)?[_.-]?(caution|arrhes|garantie[_-]?financi[eè]re)/i },
];

if (isMainModule) {
  runScanGate({
    gateName: 'no-seller-deposit',
    invariant: 'Law 4 / standing guardrail — zero seller deposit, ever',
    patterns: PATTERNS,
  });
}
