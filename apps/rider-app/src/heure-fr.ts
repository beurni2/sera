/**
 * Dates and hours as a rider reads them: in French and in Ouagadougou time,
 * whatever language and zone the phone is set to.
 *
 * Written by hand on purpose. `toLocale…String([])` follows the phone (an
 * English phone printed « Monday, November 23, 02:30 PM » inside French
 * screens), and whether Hermes on a given Android build formats `fr-FR` with
 * `timeZone: 'Africa/Ouagadougou'` depends on the ICU data that build ships —
 * not something the app can rely on. Ouagadougou is UTC+0 all year, with no
 * summer time, so its clock is the UTC clock. The day and month names are
 * words he reads, so they live in the catalog like every other word.
 */
import { t } from './i18n';

const JOURS = ['jour.dimanche', 'jour.lundi', 'jour.mardi', 'jour.mercredi', 'jour.jeudi', 'jour.vendredi', 'jour.samedi'] as const;
const MOIS = [
  'mois.janvier', 'mois.fevrier', 'mois.mars', 'mois.avril', 'mois.mai', 'mois.juin',
  'mois.juillet', 'mois.aout', 'mois.septembre', 'mois.octobre', 'mois.novembre', 'mois.decembre',
] as const;

const deux = (n: number): string => String(n).padStart(2, '0');

/** « 14:30 » — the hour in Ouagadougou. */
export function heureOuaga(d: Date): string {
  return `${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}`;
}

/** « lundi 23 novembre » — the day in Ouagadougou. */
export function jourOuaga(d: Date): string {
  return `${t(JOURS[d.getUTCDay()]!)} ${d.getUTCDate()} ${t(MOIS[d.getUTCMonth()]!)}`;
}
