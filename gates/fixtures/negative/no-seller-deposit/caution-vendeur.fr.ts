// FIXTURE NÉGATIVE — une somme demandée à qui vend ou livre, en français.
// Loi 4 : on ne demande JAMAIS d'argent à quelqu'un pour qu'il vende ou livre.
// La gate DOIT échouer sur ce fichier. Ne jamais importer ceci.
export const cautionVendeur = 5000; // interdit
export const cautionRevendeuse = 5000; // interdit
export const garantieLivreur = 5000; // interdit
export interface Conditions {
  caution_vendeur_fcfa: number; // interdit
  GARANTIE_VENDEUR_FCFA: number; // interdit
}
export const cautionFcfa = 5000; // interdit
export function exigerCaution(): void {} // interdit
export const fraisDInscription = 2000; // interdit
export const fraisDAdhesion = 2000; // interdit
export const nantissementVendeur = true; // interdit
export const vendeurArrhes = 1000; // interdit
