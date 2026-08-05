#!/usr/bin/env node
import { runScanGate } from './scan.mjs';

/**
 * CI gate: single-level (Ten Laws #9; Séra guardrail "single-level").
 * No recruitment mechanics, no downlines, no multi-level anything, anywhere.
 * `referral` is banned outright at this slice — referral.* event names are
 * excluded from the pinned event union and nothing gated may appear here.
 */
runScanGate({
  gateName: 'single-level',
  invariant: 'single-level only — no recruitment/downline mechanics',
  patterns: [
    { name: 'downline', regex: /downline/i },
    { name: 'upline', regex: /upline/i },
    { name: 'recruit', regex: /recruit/i },
    { name: 'mlm', regex: /\bmlm\b/i },
    { name: 'multi-level', regex: /multi[_-]?level/i },
    { name: 'networkDepth', regex: /network[_-]?depth/i },
    { name: 'referral', regex: /referral/i },
    { name: 'sponsorTree', regex: /sponsor[_-]?tree/i },

    /* ── AUDIT-B+1 F2 — THE FRENCH HALF, AND WHAT IT DELIBERATELY DOES NOT BAN.
       The audit recommended adding `parrain`, `filleul` and `cooptation`.
       Banning `parrain` would have broken a SHIPPED, founder-designed feature:
       Shop+'s Cercle carries a parrainage tile whose own comment reads
       « single-level, forever (loi 1) »
// (shop-plus `apps/reseller-app/src/cercle/screens.tsx:409`) — 12 occurrences
// across 3 files, all under scanned roots. Law 9 forbids
       MULTI-level — downlines, depth, generations, trees — not a single-level
       referral the founder designed. A gate that fails an approved capability
       is not enforcement, it is breakage, and it teaches everyone to disable
       the gate. So what is banned here is the SECOND LEVEL and the shapes that
       exist only to build one. Single-level parrainage stays legal, by design. */
    { name: 'filleul du filleul (fr, 2nd level)', regex: /filleul[_-]?(de[_-]?)?(son[_-]?)?filleul/i },
    { name: 'sous-parrain / sous-réseau (fr)', regex: /sous[_-]?(parrain|filleul|r[ée]seau|affili[ée])/i },
    { name: 'arbre de parrainage (fr)', regex: /arbre[_-]?(de[_-]?)?(parrainage|filleuls?)/i },
    { name: 'niveau 2+ (fr)', regex: /niveaux?[_-]?[2-9]\b/i },
    { name: 'multi-niveau (fr)', regex: /multi[_-]?niveau/i },
    { name: 'génération 2+ (fr)', regex: /g[ée]n[ée]ration[_-]?[2-9]\b/i },
    { name: 'pyramide (fr)', regex: /pyramid/i },
    { name: 'profondeur de réseau (fr)', regex: /profondeur[_-]?(du?[_-]?)?r[ée]seau/i },
    { name: 'commission indirecte (fr)', regex: /commission[_-]?indirecte/i },
  ],
});
