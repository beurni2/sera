// FIXTURE NÉGATIVE (AUDIT-B+1 F2) — L'ÉVASION EN FRANÇAIS, TELLE QUELLE.
//
// Un auditeur a planté un module de compte vendeur dans le répertoire produit,
// en utilisant les noms français que ce produit parle réellement, et le tableau
// de bord complet des gates a affiché TOUT VERT. La gate n'était pas cassée :
// son vocabulaire était anglais, dans un produit dont tout le domaine est
// français.
//
// LA PROSE DE CE FICHIER EST EN FRANÇAIS, ET CE N'EST PAS DU STYLE. Si un seul
// des termes anglais de la gate apparaissait dans un commentaire ici, ce
// fichier échouerait pour la mauvaise raison et ne prouverait plus rien :
// supprimez les motifs français, il échouerait quand même. Testé par mutation.
//
// La gate de cette fixture (loi 2 — aucune application ne détient de fonds)
// DOIT échouer sur ce fichier, et uniquement sur ses motifs français.
// Ne jamais importer ceci.
export interface CompteVendeur {
  vendeurId: string;
  soldeVendeur: number; // interdit : un montant cumulé localement
  PORTEFEUILLE_TOTAL: number; // interdit : SCREAMING_SNAKE échappe à un motif camelCase
}
export function crediterLeCompte(compte: CompteVendeur, montant: number): void {
  // interdit : cette application ne crédite rien — seuls les webhooks du
  // prestataire font foi en matière de paiement
  compte.soldeVendeur += montant;
}
export function approvisionnerCompte(compte: CompteVendeur, montant: number): void {
  compte.soldeVendeur += montant;
}
export const cagnotte = 0; // interdit
export const porteMonnaie = 0; // interdit

// Formes supplémentaires — une par motif français, pour qu'AUCUN motif ne puisse
// être supprimé sans que la CI le voie (`fr-pattern-coverage`).
export interface Compte2 { vendeurPortefeuille: number; solde: number }
export const lu = compte['solde'] = 0;
export const payloadInterdit = '{"vendeur": {"solde": 125000}}'; // interdit : clé JSON
