// FIXTURE NÉGATIVE — de l'argent repris à qui vend ou livre, en français.
// Une faute ne déplace jamais l'argent de la personne : la conséquence est
// l'accès, jamais la bourse. La gate DOIT échouer ici. Ne jamais importer ceci.
export function debiterLeVendeur(): void {} // interdit
export const vendeurDebit = 100; // interdit
export const retenueSurVentes = 100; // interdit
export const retenueSurGains = 100; // interdit
export const prelevementSurVentes = 100; // interdit
export const penaliteVendeur = 100; // interdit
export const amendeLivreur = 100; // interdit
export const vendeurPenalite = 100; // interdit
export const penaliteFcfa = 100; // interdit
export const amendeFcfa = 100; // interdit
export function deductFromRevendeuse(): void {} // interdit
