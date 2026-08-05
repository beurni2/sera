// NEGATIVE FIXTURE (AUDIT-B+1 F2) — THE FRENCH EVASION, VERBATIM.
// An auditor planted a working seller wallet in the product directory using the
// French names this product actually speaks, and the FULL gate board printed
// ALL GATES GREEN. The gate was not broken; its vocabulary was English in a
// codebase whose entire domain language is French.
//
// This file is that evasion, kept as the standing proof the gate now bites.
// The no-wallet-no-funds gate MUST fail on it. Never import this.
export interface CompteVendeur {
  vendeurId: string;
  soldeVendeur: number; // banned: a locally computed balance, in French
  PORTEFEUILLE_TOTAL: number; // banned: SCREAMING_SNAKE escapes a camelCase-only pattern
}
export function crediterLeCompte(compte: CompteVendeur, montant: number): void {
  // banned: this app credits nothing — provider webhooks are the only payment truth
  compte.soldeVendeur += montant;
}
export function approvisionnerCompte(compte: CompteVendeur, montant: number): void {
  compte.soldeVendeur += montant;
}
export const cagnotte = 0; // banned
