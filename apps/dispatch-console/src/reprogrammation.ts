/**
 * ═══ REPROGRAMMATION-1 · THE NEXT PASSAGE, FIXED BY THE FOUNDER — pure
 * decisions ═══
 *
 * SE6.1 live (Sera-Build-Spec §6.5: « dispatcher applies retry / reschedule /
 * return / incident; custody stays with courier »). When the §6.4 window
 * expires on a NON-escalating reason — the buyer was absent, the place could
 * not be found, the payment provider was down — custody records a canonical
 * `reschedule` outcome and the rider keeps the package. Logistics hears it
 * over the seventh wire and lists the course here, « à reprogrammer », until
 * the founder fixes the next passage: one date, one start, one end. The rider's
 * phone then shows « 2e passage » with that window.
 *
 * Pure: no DOM, no fetch, no clock of its own (the instant is passed in).
 * Every string is a CATALOG KEY, never a word (Contract §10.5).
 */

export interface ReprogRow {
  readonly orderId: string;
  /** The FIRST attempt's task — what custody's outcome names. */
  readonly taskId: string;
  /** Who carries the package, by display name when the board gives one. */
  readonly riderName?: string | undefined;
  readonly reasonCode: string;
  /** Custody's instant for the outcome (ISO), as the board carried it. */
  readonly recordedAt: string;
}

/**
 * The board's own JSON, read defensively (the courses desk's law): a
 * malformed row must not blank the desk. Rows that name no order are dropped.
 */
export function aReprogrammerRows(body: unknown): readonly ReprogRow[] {
  const board = pick(pick(body, 'board'), null);
  const riders = new Map<string, string>();
  for (const entry of array(pick(board, 'riders'))) {
    const riderId = str(pick(entry, 'riderId'));
    if (riderId === '') continue;
    const name = str(pick(entry, 'displayName'));
    riders.set(riderId, name === '' ? riderId : name);
  }
  const rows: ReprogRow[] = [];
  for (const entry of array(pick(board, 'aReprogrammer'))) {
    const orderId = str(pick(entry, 'orderId'));
    if (orderId === '') continue;
    const riderId = str(pick(entry, 'riderId'));
    rows.push({
      orderId,
      taskId: str(pick(entry, 'taskId')),
      ...(riderId === '' ? {} : { riderName: riders.get(riderId) ?? riderId }),
      reasonCode: str(pick(entry, 'reasonCode')),
      recordedAt: str(pick(entry, 'recordedAt')),
    });
  }
  return rows.sort((a, b) => (a.orderId < b.orderId ? -1 : 1));
}

/**
 * ═══ REPROGRAMMATION-2 — the second list and the lever home ═══
 *
 * A live course already ON its follow-up task (passage ≥ 2), with the window
 * the founder fixed. The founder's other decision — « Renvoyer au vendeur »
 * (Sera-Build-Spec §6.5: « dispatcher applies … return ») — is offered on
 * BOTH lists: a buyer absent again at the 2e passage, or no second trip worth
 * planning. Custody records the return with NO fee retained (an absence is
 * not a refusal — founder, 2026-09-17); the rider's phone turns to the road
 * home.
 */
export interface DeuxiemePassageRow {
  readonly orderId: string;
  /** The follow-up task the live course now carries. */
  readonly taskId: string;
  readonly riderName?: string | undefined;
  readonly passage: number;
  /** The window the founder fixed — null when the board carries none. */
  readonly fenetre: { readonly start: string; readonly end: string } | null;
}

export function enDeuxiemePassageRows(body: unknown): readonly DeuxiemePassageRow[] {
  const board = pick(pick(body, 'board'), null);
  const riders = new Map<string, string>();
  for (const entry of array(pick(board, 'riders'))) {
    const riderId = str(pick(entry, 'riderId'));
    if (riderId === '') continue;
    const name = str(pick(entry, 'displayName'));
    riders.set(riderId, name === '' ? riderId : name);
  }
  const rows: DeuxiemePassageRow[] = [];
  for (const entry of array(pick(board, 'enDeuxiemePassage'))) {
    const orderId = str(pick(entry, 'orderId'));
    if (orderId === '') continue;
    const riderId = str(pick(entry, 'riderId'));
    const passage = pick(entry, 'passage');
    const window = pick(entry, 'window');
    const start = str(pick(window, 'start'));
    const end = str(pick(window, 'end'));
    rows.push({
      orderId,
      taskId: str(pick(entry, 'taskId')),
      ...(riderId === '' ? {} : { riderName: riders.get(riderId) ?? riderId }),
      passage: typeof passage === 'number' && Number.isInteger(passage) && passage >= 2 ? passage : 2,
      fenetre: start === '' || end === '' ? null : { start, end },
    });
  }
  return rows.sort((a, b) => (a.orderId < b.orderId ? -1 : 1));
}

function pick(value: unknown, key: string | null): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return key === null ? value : (value as Record<string, unknown>)[key];
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The three reasons the ladder reschedules on (refusal-ladder policy v1:
 *  `nonEscalatingReasons`); anything else the wire ever says gets the honest
 *  generic sentence rather than a blank. */
const RAISONS: Record<string, string> = {
  honest_absence: 'reprog.raison_honest_absence',
  unusable_location: 'reprog.raison_unusable_location',
  provider_failure: 'reprog.raison_provider_failure',
};

export function raisonKey(reasonCode: string): string {
  return RAISONS[reasonCode] ?? 'reprog.raison_autre';
}

export type ReprogRead =
  | { readonly kind: 'loading' }
  | { readonly kind: 'bad_key' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ok'; readonly rows: readonly ReprogRow[]; readonly deuxiemes: readonly DeuxiemePassageRow[] };

export type ReprogView =
  | { readonly kind: 'loading'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'empty'; readonly message: string }
  | { readonly kind: 'liste'; readonly rows: readonly ReprogRow[]; readonly deuxiemes: readonly DeuxiemePassageRow[] };

export function reprogView(read: ReprogRead): ReprogView | null {
  if (read.kind === 'bad_key') return null;
  if (read.kind === 'loading') return { kind: 'loading', message: 'reprog.chargement' };
  if (read.kind === 'failed') return { kind: 'failed', message: 'reprog.echec' };
  // Nothing to fix is a GOOD state, and it says so.
  if (read.rows.length === 0 && read.deuxiemes.length === 0) return { kind: 'empty', message: 'reprog.vide' };
  return { kind: 'liste', rows: read.rows, deuxiemes: read.deuxiemes };
}

/** What the founder typed: a day and two clock times, in HIS local time. */
export interface FenetreSaisie {
  /** `YYYY-MM-DD` — the date input's own value. */
  readonly jour: string;
  /** `HH:MM` — the time inputs' own values. */
  readonly debut: string;
  readonly fin: string;
}

export type FenetreComposee =
  | { readonly ok: true; readonly start: string; readonly end: string }
  | { readonly ok: false; readonly reason: 'incomplete' | 'fin_avant_debut' | 'passee' };

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const HEURE = /^\d{2}:\d{2}$/;

/**
 * Compose the window the door takes (two ISO instants) from the founder's
 * local day and hours. A date-time literal without an offset parses as LOCAL
 * time in every browser, which is exactly what he means when he types 10:00.
 * Refused by name when incomplete, reversed, or already behind `now` — the
 * door refuses the same three, and saying it here saves him a round trip.
 */
export function composerFenetre(saisie: FenetreSaisie, now: Date): FenetreComposee {
  if (!JOUR.test(saisie.jour) || !HEURE.test(saisie.debut) || !HEURE.test(saisie.fin)) {
    return { ok: false, reason: 'incomplete' };
  }
  const start = new Date(`${saisie.jour}T${saisie.debut}:00`);
  const end = new Date(`${saisie.jour}T${saisie.fin}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, reason: 'incomplete' };
  if (start.getTime() >= end.getTime()) return { ok: false, reason: 'fin_avant_debut' };
  if (end.getTime() <= now.getTime()) return { ok: false, reason: 'passee' };
  return { ok: true, start: start.toISOString(), end: end.toISOString() };
}

export function saisieKey(reason: 'incomplete' | 'fin_avant_debut' | 'passee'): string {
  return `reprog.saisie_${reason}`;
}

/** The desk's own state: one fix in flight at a time, what was fixed (with
 *  its window, so the row can say it), what was refused, by order — and the
 *  ONE command each attempt rides on. */
export interface FixationUi {
  readonly enVol: string | null;
  readonly faits: Readonly<Record<string, { readonly start: string; readonly end: string }>>;
  /** Catalog keys, by order — the refusal sentence the row shows. */
  readonly echecs: Readonly<Record<string, string>>;
  /**
   * VERIFIER MINOR (closed) — the command id of the attempt in progress, per
   * order, WITH the window it carries. The door remembers what a command
   * opened; a fresh id on every tap threw that away: a lost 200 (the 15 s
   * timeout) then a second tap was told « Séra n'a pas encore reçu
   * l'absence » over a passage the rider was already reading. The same
   * window re-sent is the SAME act; a changed window is a new one.
   */
  readonly commandes: Readonly<Record<string, { readonly start: string; readonly end: string; readonly commandId: string }>>;
}

export const FIXATION_IDLE: FixationUi = { enVol: null, faits: {}, echecs: {}, commandes: {} };

/** Start a fix. Refused while another is in flight — two windows sent at once
 *  would race on the board's one read back. The command id is reused while
 *  the window is the one already sent, minted afresh when it changed. */
export function commencerFixation(
  ui: FixationUi,
  orderId: string,
  fenetre: { readonly start: string; readonly end: string },
  mint: () => string,
): { readonly ui: FixationUi; readonly commandId: string } | null {
  if (ui.enVol !== null) return null;
  const echecs = { ...ui.echecs };
  delete echecs[orderId];
  const prior = ui.commandes[orderId];
  const commandId = prior !== undefined && prior.start === fenetre.start && prior.end === fenetre.end ? prior.commandId : mint();
  return {
    ui: { ...ui, enVol: orderId, echecs, commandes: { ...ui.commandes, [orderId]: { start: fenetre.start, end: fenetre.end, commandId } } },
    commandId,
  };
}

export function fixationFaite(ui: FixationUi, orderId: string, fenetre: { start: string; end: string }): FixationUi {
  const commandes = { ...ui.commandes };
  delete commandes[orderId];
  return { enVol: null, faits: { ...ui.faits, [orderId]: fenetre }, echecs: ui.echecs, commandes };
}

export function fixationEchouee(ui: FixationUi, orderId: string, key: string): FixationUi {
  return { ...ui, enVol: null, echecs: { ...ui.echecs, [orderId]: key } };
}

/** The door's refusals, each its own plain sentence; the intake gate's four
 *  refusals collapse into ONE (« the order is no longer ready ») because the
 *  founder's next act is the same for all four: check the payment and the
 *  seller, then relire. */
const REFUS: Record<string, string> = {
  order_not_rescheduled: 'reprog.refus_order_not_rescheduled',
  course_non_acceptee: 'reprog.refus_course_non_acceptee',
  no_active_course: 'reprog.refus_no_active_course',
  prior_task_missing: 'reprog.refus_no_active_course',
  prior_task_mismatch: 'reprog.refus_prior_task_mismatch',
  fenetre_passee: 'reprog.saisie_passee',
  fenetre_invalide: 'reprog.saisie_fin_avant_debut',
  funding_projection_stale: 'reprog.refus_pas_prete',
  not_funded_for_mode: 'reprog.refus_pas_prete',
  order_cancelled: 'reprog.refus_pas_prete',
  readiness_projection_stale: 'reprog.refus_pas_prete',
  not_readiness_confirmed: 'reprog.refus_pas_prete',
  payment_mode_not_available_e1: 'reprog.refus_pas_prete',
};

export function refusKey(reason: string): string {
  return REFUS[reason] ?? 'reprog.refus_autre';
}

/**
 * The « Renvoyer au vendeur » desk state: the ONE confirmation on screen,
 * the one act in flight, what was decided (custody's instant), what was
 * refused (a sentence, by order), and the one command each order's attempt
 * rides on — a retried tap after a lost answer is the same act, and both
 * doors (logistics by state, custody by command id) answer it as already
 * done.
 */
export interface RenvoiUi {
  /** The course whose confirmation card is open. Null = nothing is being asked. */
  readonly demande: string | null;
  readonly enVol: string | null;
  /** Custody's instant for the decision, by order. */
  readonly faits: Readonly<Record<string, string>>;
  readonly echecs: Readonly<Record<string, string>>;
  readonly commandes: Readonly<Record<string, string>>;
}

export const RENVOI_IDLE: RenvoiUi = { demande: null, enVol: null, faits: {}, echecs: {}, commandes: {} };

/** Open the confirmation for ONE course. Refused (unchanged) while an act
 *  flies; opening a second course's card closes the first — one question at
 *  a time on the desk. The order's old refusal is cleared: he is trying again. */
export function demanderRenvoi(ui: RenvoiUi, orderId: string): RenvoiUi {
  if (ui.enVol !== null) return ui;
  const echecs = { ...ui.echecs };
  delete echecs[orderId];
  return { ...ui, demande: orderId, echecs };
}

export function annulerRenvoi(ui: RenvoiUi): RenvoiUi {
  return { ...ui, demande: null };
}

/** Send the decision he confirmed. Only the course whose card is open can be
 *  sent — the confirmation IS the consent. The command id is reused on a
 *  retry of the same order (the door replays what it did), minted once. */
export function commencerRenvoi(ui: RenvoiUi, orderId: string, mint: () => string): { readonly ui: RenvoiUi; readonly commandId: string } | null {
  if (ui.enVol !== null || ui.demande !== orderId) return null;
  const commandId = ui.commandes[orderId] ?? mint();
  return { ui: { ...ui, demande: null, enVol: orderId, commandes: { ...ui.commandes, [orderId]: commandId } }, commandId };
}

export function renvoiFait(ui: RenvoiUi, orderId: string, decideAt: string): RenvoiUi {
  const commandes = { ...ui.commandes };
  delete commandes[orderId];
  return { demande: null, enVol: null, faits: { ...ui.faits, [orderId]: decideAt }, echecs: ui.echecs, commandes };
}

export function renvoiEchoue(ui: RenvoiUi, orderId: string, key: string): RenvoiUi {
  return { ...ui, enVol: null, echecs: { ...ui.echecs, [orderId]: key } };
}

/** The decider door's refusals, each a sentence the founder can act on. The
 *  two ways custody can be out of reach are ONE sentence (his next act is the
 *  same: try again); custody's own refusal is named as such. */
const REFUS_RENVOI: Record<string, string> = {
  course_non_reprogrammee: 'reprog.refus_order_not_rescheduled',
  no_active_course: 'reprog.refus_no_active_course',
  course_non_acceptee: 'reprog.refus_course_non_acceptee',
  custody_non_relie: 'reprog.renvoi_garde_muette',
  custody_unreachable: 'reprog.renvoi_garde_muette',
  custody_refused: 'reprog.renvoi_refuse',
};

export function renvoiRefusKey(reason: string): string {
  return REFUS_RENVOI[reason] ?? 'reprog.refus_autre';
}

/** The window in the founder's words: the day, then the two hours, in his
 *  own locale — the same sentence the rider reads on his phone. */
export function fenetreLisible(fenetre: { readonly start: string; readonly end: string }): string {
  const start = new Date(fenetre.start);
  const end = new Date(fenetre.end);
  const jour = start.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const heure = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${jour}, ${heure(start)}–${heure(end)}`;
}
