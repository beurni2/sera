// NEGATIVE FIXTURE (AUDIT-B+1 F2) — MULTI-LEVEL MECHANICS IN FRENCH.
// Law 9 / B+I-10: no recruitment mechanics, no downlines, no multi-level
// anything. The English half of the gate caught `downline`/`recruit`; a
// French second level walked straight through.
//
// READ THE SIBLING FIXTURE `gates/fixtures/single-level-legal/` BEFORE
// EXTENDING THIS ONE: single-level `parrainage` is a SHIPPED, founder-designed
// Cercle capability and must keep passing. What is banned is the SECOND LEVEL
// and the shapes that exist only to build one.
// The single-level gate MUST fail on this file. Never import this.
export interface ReseauRevendeuse {
  revendeuseId: string;
  filleulDeFilleul: string[]; // banned: second level
  sousReseau: string[]; // banned
  arbreDeParrainage: unknown; // banned
  profondeurDuReseau: number; // banned
  niveau2: string[]; // banned
  generation3: string[]; // banned
}
export function commissionIndirecte(): number {
  return 0; // banned: a commission earned on someone else's recruit
}
export const multiNiveau = true; // banned
export const pyramide = true; // banned
