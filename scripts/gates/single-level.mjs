#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runScanGate } from './scan.mjs';

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

    /* ── AUDIT-B+1 F2 — THE SECOND LEVEL, AND WHAT STAYS LEGAL.
       Law 9 forbids MULTI-level. Single-level parrainage is a SHIPPED,
       founder-designed capability (shop-plus
       `apps/reseller-app/src/cercle/screens.tsx:409`, « single-level, forever
       (loi 1) ») and it PAYS AN AMOUNT (`ce.parrainage_montant`) — so a generic
       « commission on parrainage » ban would break it. Only the SECOND LEVEL
       and cascade rewards are banned. Numeric `niveau2` is deliberately NOT
       banned: it is how a product CATEGORY taxonomy is written.
       `gates/fixtures/single-level-legal/` fails the board if this line moves. */
    { name: 'grand-parrain (fr, 2nd level)', regex: /grand[_-]?parrain/i },
    { name: 'filleul du filleul (fr, 2nd level)', regex: /filleul[^\n]{0,20}filleul/i },
    { name: 'deuxième/troisième niveau ou génération (fr)', regex: /(deuxi[eè]me|troisi[eè]me|second)[_-]?(niveau|g[ée]n[ée]ration)/i },
    { name: 'niveau deux/trois (fr)', regex: /niveau[_-]?(deux|trois)\b/i },
    { name: 'sous-parrain / sous-réseau (fr)', regex: /sous[_-]?(parrain|filleul|r[ée]seau|affili[ée])/i },
    { name: 'arbre de parrainage/revendeuses (fr)', regex: /arbre[_-]?(de|des|du)?[_-]?(parrainage|filleul|revendeu|affili|[ée]quipe|equipe)/i },
    { name: 'profondeur de réseau (fr)', regex: /profondeur[_-]?\w{0,8}(r[ée]seau|parrainage|arbre)/i },
    { name: 'équipe de mon équipe / réseau de réseau (fr)', regex: /(equipe|[ée]quipe|r[ée]seau)[_-]?(de|du)?[_-]?(mon|ma|son|sa)?[_-]?(equipe|[ée]quipe|r[ée]seau)/i },
    { name: 'chaîne de parrainage (fr)', regex: /cha[iî]ne[_-]?(de[_-]?)?parrainage/i },
    { name: 'commission indirecte / en cascade (fr)', regex: /(commission|prime|bonus)[_-]?(indirecte?|en[_-]?cascade|cascade)/i },
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

