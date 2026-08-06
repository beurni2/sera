// FIXTURE NÉGATIVE (AUDIT-B+1 F2) — LE DEUXIÈME NIVEAU, EN FRANÇAIS.
//
// Loi 9 / B+I-10 : un seul niveau, partout. La moitié anglaise de la gate
// attrapait ses propres termes ; un deuxième niveau nommé en français passait
// tout droit.
//
// LA PROSE DE CE FICHIER EST EN FRANÇAIS, ET CE N'EST PAS DU STYLE. Un seul
// terme anglais de la gate dans un commentaire ici, et le fichier échouerait
// pour la mauvaise raison : supprimez les motifs français, il échouerait quand
// même. Testé par mutation.
//
// LIRE AUSSI `gates/fixtures/single-level-legal/` AVANT D'ÉTENDRE CE FICHIER :
// le parrainage à un seul niveau est une capacité LIVRÉE, voulue par le
// fondateur, et doit continuer à passer. Ce qui est interdit ici, c'est le
// DEUXIÈME NIVEAU et les formes qui n'existent que pour le construire.
//
// La gate single-level DOIT échouer sur ce fichier, et uniquement sur ses
// motifs français. Ne jamais importer ceci.
export interface ReseauRevendeuse {
  revendeuseId: string;
  filleulDeFilleul: string[]; // interdit : deuxième niveau
  sousReseau: string[]; // interdit
  sousParrain: string; // interdit
  arbreDeParrainage: unknown; // interdit
  profondeurDuReseau: number; // interdit
  niveau2: string[]; // interdit
  generation3: string[]; // interdit
}
export function commissionIndirecte(): number {
  return 0; // interdit : une commission gagnée sur l'inscription d'autrui
}
export const multiNiveau = true; // interdit
export const pyramide = true; // interdit
