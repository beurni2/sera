/**
 * Dates and hours as a rider reads them: in French and in Ouagadougou time,
 * whatever language and zone the phone is set to.
 *
 * Written by hand on purpose. `toLocale…String([])` follows the phone (an
 * English phone printed « Monday, November 23, 02:30 PM » inside French
 * screens), and whether Hermes on a given Android build formats `fr-FR` with
 * `timeZone: 'Africa/Ouagadougou'` depends on the ICU data that build ships —
 * not something the app can rely on. Ouagadougou is UTC+0 all year, with no
 * summer time, so its clock is the UTC clock.
 */

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
] as const;

const deux = (n: number): string => String(n).padStart(2, '0');

/** « 14:30 » — the hour in Ouagadougou. */
export function heureOuaga(d: Date): string {
  return `${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}`;
}

/** « lundi 23 novembre » — the day in Ouagadougou. */
export function jourOuaga(d: Date): string {
  return `${JOURS[d.getUTCDay()]!} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]!}`;
}
