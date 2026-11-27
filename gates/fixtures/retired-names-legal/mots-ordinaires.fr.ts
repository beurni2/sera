// POSITIVE FIXTURE: what the retired-names gate must NOT break. The board runs
// the gate on this file and requires a pass.
//
// « ma boutique » with a small b is ordinary French, the words « my shop »: a
// reseller customising her own shop says it every day, and the Shop+ screens
// say it back to her, sometimes with the space written as an escape. « faire
// mon shopping » is ordinary French too. The canon name Shop+ may take a
// possessive. Words that only contain the same letters are other words.
export const ordinaryFrench = [
  'Personnaliser ma boutique',
  'Mettre ma boutique en ligne',
  'Ma boutique est en ligne',
  'Voilà ma boutique',
  'Personnaliser ma\u00a0boutique',
  'Je fais mon shopping au marché',
];
export const canonNameWithPossessive = [
  'Ouvrir mon Shop+',
  'Mon Shop+ est prêt',
  'Boutik+ · Shop+ · Séra',
];
export const otherNames = ['Ma Vitrine', 'Mon Cercle'];
export const schemaBoutique = 'legal';
export const formaBoutique = 'legal';
export const commonShop = 'legal';
export const demonShop = 'legal';
export interface CommonShopFields {
  boutiqueId: string;
}
