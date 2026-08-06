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

/* Run the gate only when EXECUTED, not when imported. `fr-pattern-coverage`
   imports PATTERNS to prove every one of them is exercised by a fixture; without
   this guard that import would run the gate and exit the coverage process. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

/**
 * CI gate: single-level (Ten Laws #9; Séra guardrail "single-level").
 * No recruitment mechanics, no downlines, no multi-level anything, anywhere.
 * `referral` is banned outright at this slice — referral.* event names are
 * excluded from the pinned event union and nothing gated may appear here.
 */
export const PATTERNS = [
    { name: 'downline', regex: /downline/i },
    { name: 'upline', regex: /upline/i },
    { name: 'recruit', regex: /recruit/i },
    { name: 'mlm', regex: /\bmlm\b/i },
    { name: 'multi-level', regex: /multi[_-]?level/i },
    { name: 'networkDepth', regex: /network[_-]?depth/i },
    { name: 'referral', regex: /referral/i },
    { name: 'sponsorTree', regex: /sponsor[_-]?tree/i },

    /* SECOND LEVEL — unambiguous French. Numeric `niveau2` is deliberately NOT
       banned: that is how a product CATEGORY taxonomy is written. */
    { name: 'grand-parrain / parrain du parrain (fr)', regex: /(grand[_-]?parrain|parrain[_-]?du[_-]?parrain|parrain[_-]?de[_-]?(mon|son|ma|sa)[_-]?parrain)/i },
    { name: 'filleul du filleul (fr)', regex: /filleul[^\n]{0,20}filleul|petite?s?[_-]?filleul/i },
    { name: 'sous-parrain / sous-réseau (fr)', regex: /sous[_-]?(parrain|filleul|r[ée]seau|affili[ée])/i },
    { name: 'deuxième/troisième niveau ou génération (fr)', regex: /(deuxi[eè]me|troisi[eè]me|second)[_-]?(niveau|g[ée]n[ée]ration)|niveau[_-]?(deux|trois)\b/i },
    { name: 'commission/bonus par niveau (fr)', regex: /(commission|bonus|prime|gain)s?[_-]?(de[_-]?|du[_-]?|sur[_-]?)?niveau[_-]?[2-9]/i },
    { name: 'commission indirecte / en cascade (fr)', regex: /(commission|prime|bonus|gain|revenu)s?[_-]?(indirecte?s?|en[_-]?cascade|cascade)/i },
    { name: 'arbre / lignée / descendance (fr)', regex: /(arbre[_-]?(de|des|du)?[_-]?(parrainage|filleul|revendeu|affili|[ée]quipe)|(?<![a-zA-ZÀ-ÿ])lign[ée]e|(?<![a-zA-ZÀ-ÿ])descendance)/i },
    { name: 'profondeur de réseau (fr)', regex: /profondeur[_-]?\w{0,8}(r[ée]seau|parrainage|arbre|[ée]quipe)/i },
    { name: 'équipe de mon équipe / réseau de réseau (fr)', regex: /([ée]quipe|r[ée]seau)[_-]?(de|du)?[_-]?(mon|ma|son|sa)[_-]?([ée]quipe|r[ée]seau)/i },
    { name: 'volume/chiffre d\'équipe (fr)', regex: /(volume|chiffre|ca)[_-]?(de[_-]?l)?[ée]quipe/i },
    { name: 'chaîne de parrainage (fr)', regex: /cha[iî]ne[_-]?(de[_-]?)?parrainage/i },
    { name: 'plan/matrice binaire (fr)', regex: /(plan|matrice)[_-]?binaire/i },
    { name: 'multi-niveau (fr)', regex: /multi[_-]?niveau/i },
    { name: 'pyramide (fr)', regex: /pyramid/i },
];

if (isMainModule) {
    runScanGate({
      gateName: 'single-level',
    invariant: 'single-level only — no recruitment/downline mechanics',
    patterns: PATTERNS,
  });
}

