/**
 * ═══ PURGE-ESSAI · THE COURSES ON THE REAL BOARD — pure decisions ═══
 *
 * FOUNDER RULING (2026-08-10): « products … that i used for the testing,
 * remove all of them … cause i want to use new products again », and for Séra:
 * « BOARD YES, CUSTODY NO ». So this desk shows the courses Séra actually has
 * on its dispatch board and lets him retire them one by one. The custody
 * ledger is append-only proof and appears on no console — nothing here can
 * reach it.
 *
 * It also answers the journalled debt « the Séra dispatch board does not clear
 * on course completion »: until now a finished or abandoned course sat on the
 * board for ever, with no surface anywhere that could remove it.
 *
 * RETIRING IS DESTRUCTIVE, SO IT IS NEVER A ONE-TAP ACT. Every path through
 * this model goes ASK → CONFIRM → IN FLIGHT → RESULT, and a failure is named
 * per course (« cette course n'a pas pu être retirée ») rather than silently
 * skipped. « Tout retirer » is a CLIENT-SIDE LOOP over the rows on screen —
 * there is no server route that empties a board, deliberately.
 *
 * Pure: no DOM, no fetch, no timer. Every string is a CATALOG KEY, never a
 * word (Contract §10.5).
 */

export interface CourseRow {
  readonly orderId: string;
  /** `attente` — a task is queued and nobody carries it yet.
   *  `confiee` — a rider holds a live assignment for this order. */
  readonly etat: 'attente' | 'confiee';
  /** Who carries it, for `confiee`. The rider's display name when the board
   *  gives one, else their id — never a blank where a person should be. */
  readonly riderName?: string | undefined;
  /** COLIS-2 — every article of the package this order travels in, in the
   *  package's own order, when it travels with others. */
  readonly colis?: readonly string[] | undefined;
}

/**
 * The board's own JSON, read defensively: this crosses the network into the
 * founder's only real view of Séra, and one malformed row must not blank the
 * desk or, worse, hide a course he thinks he retired.
 *
 * ONE ROW PER ORDER, because the retire door is per ORDER: a course that is
 * both queued and assigned (a re-composed order mid-swap) is still one thing
 * to remove, and showing it twice would ask him to confirm the same removal
 * twice.
 *
 * COLIS-2 — a package is one row PER ARTICLE (the founder: « « Retirer » on
 * your console removes the whole package »). The board names a queued
 * package's travelling articles on its row, and a live one's in
 * `colisEnCourse`; each article's row carries the whole list, so the screen
 * can say which articles go together and what a removal will take.
 */
export function boardCourses(body: unknown): readonly CourseRow[] {
  const board = pick(pick(body, 'board'), null);
  const riders = new Map<string, string>();
  for (const entry of array(pick(board, 'riders'))) {
    const riderId = str(pick(entry, 'riderId'));
    if (riderId === '') continue;
    const name = str(pick(entry, 'displayName'));
    riders.set(riderId, name === '' ? riderId : name);
  }

  const rows = new Map<string, CourseRow>();
  for (const entry of array(pick(board, 'queued'))) {
    const orderId = str(pick(entry, 'orderId'));
    if (orderId === '') continue;
    const colis = articles(pick(pick(entry, 'colis'), 'orderIds'), orderId);
    for (const id of colis ?? [orderId]) {
      if (!rows.has(id)) rows.set(id, { orderId: id, etat: 'attente', ...(colis === undefined ? {} : { colis }) });
    }
  }
  const enCourse = pick(board, 'colisEnCourse');
  // Assignments win the state: « confiée à Boss » is what he needs to read
  // before retiring, and it is the stronger fact about the same order.
  for (const entry of array(pick(board, 'assignments'))) {
    const orderId = str(pick(entry, 'orderId'));
    if (orderId === '') continue;
    const riderId = str(pick(entry, 'riderId'));
    const colis = articles(pick(pick(enCourse, str(pick(entry, 'assignmentId'))), 'orderIds'), orderId);
    for (const id of colis ?? [orderId]) {
      rows.set(id, {
        orderId: id,
        etat: 'confiee',
        ...(riderId === '' ? {} : { riderName: riders.get(riderId) ?? riderId }),
        ...(colis === undefined ? {} : { colis }),
      });
    }
  }
  return [...rows.values()].sort((a, b) => (a.orderId < b.orderId ? -1 : 1));
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

/** A package's articles as the board lists them — only a real package: two
 *  or more distinct ids, the row's own among them. Anything else is read as
 *  no package, so the row stays a plain course. */
function articles(value: unknown, orderId: string): readonly string[] | undefined {
  const ids = array(value).map(str);
  if (ids.length < 2 || ids.includes('') || new Set(ids).size !== ids.length || !ids.includes(orderId)) return undefined;
  return ids;
}

export type CoursesRead =
  | { readonly kind: 'loading' }
  /** The ops key was refused — the caller escalates the WHOLE desk to the one
   *  key door, exactly as the rider-code desk does. */
  | { readonly kind: 'bad_key' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ok'; readonly courses: readonly CourseRow[] };

export type CoursesView =
  | { readonly kind: 'loading'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'empty'; readonly message: string }
  | { readonly kind: 'liste'; readonly courses: readonly CourseRow[] };

export function coursesView(read: CoursesRead): CoursesView | null {
  if (read.kind === 'bad_key') return null;
  if (read.kind === 'loading') return { kind: 'loading', message: 'courses.chargement' };
  if (read.kind === 'failed') return { kind: 'failed', message: 'courses.echec' };
  // An empty board is a GOOD state here, and it says so — never an apologetic
  // blank where « rien à retirer » is the honest, encouraging truth.
  if (read.courses.length === 0) return { kind: 'empty', message: 'courses.vide' };
  return { kind: 'liste', courses: read.courses };
}

/** The catalog key for a row's state line. */
export function etatKey(row: CourseRow): string {
  return row.etat === 'confiee' ? 'courses.etat_confiee' : 'courses.etat_attente';
}

/** COLIS-2 — one call to the retire door. */
export interface Appel {
  readonly orderId: string;
  /** True only for a package a rider already carries: the door takes the
   *  whole bag, and says no to one article of it (`colis_en_course`). */
  readonly colisEntier: boolean;
  /** Every row this call removes — named on screen if it fails. */
  readonly articles: readonly string[];
}

/** What is being asked for — one article, a package a rider carries (whole),
 *  or every row currently on screen. `orderIds` is what the confirmation
 *  NAMES; `appels` is what the door is called for, one after the other. */
export interface RetraitDemande {
  readonly kind: 'une' | 'colis' | 'toutes';
  readonly orderIds: readonly string[];
  readonly appels: readonly Appel[];
  /** One article of a package no rider carries yet: the others stay. */
  readonly articleSeul: boolean;
  /** …and it is the article its package's course is filed under: the course
   *  goes with it, and the others leave the board to wait for a new one. */
  readonly autresEnAttente: boolean;
}

function colisEnMains(row: CourseRow): row is CourseRow & { colis: readonly string[] } {
  return row.colis !== undefined && row.etat === 'confiee';
}

/** The row's own lever. A package in a rider's hands leaves whole — every
 *  article named; anything else leaves alone. */
export function demandeLigne(row: CourseRow): RetraitDemande {
  if (colisEnMains(row)) {
    return { kind: 'colis', orderIds: row.colis, appels: [{ orderId: row.orderId, colisEntier: true, articles: row.colis }], articleSeul: false, autresEnAttente: false };
  }
  return {
    kind: 'une',
    orderIds: [row.orderId],
    appels: [{ orderId: row.orderId, colisEntier: false, articles: [row.orderId] }],
    articleSeul: row.colis !== undefined,
    // The board lists a waiting package under the article its course is filed under, first.
    autresEnAttente: row.colis !== undefined && row.colis[0] === row.orderId,
  };
}

/** « Tout retirer »: every row on screen, one call each — except a package in
 *  a rider's hands, which is ONE whole-bag call for all its rows. */
export function demandeToutes(rows: readonly CourseRow[]): RetraitDemande {
  const appels: Appel[] = [];
  const couverts = new Set<string>();
  for (const row of rows) {
    if (couverts.has(row.orderId)) continue;
    if (colisEnMains(row)) {
      for (const id of row.colis) couverts.add(id);
      appels.push({ orderId: row.orderId, colisEntier: true, articles: row.colis });
    } else {
      couverts.add(row.orderId);
      appels.push({ orderId: row.orderId, colisEntier: false, articles: [row.orderId] });
    }
  }
  return { kind: 'toutes', orderIds: rows.map((row) => row.orderId), appels, articleSeul: false, autresEnAttente: false };
}

export interface RetraitUi {
  /** The confirmation currently on screen. Null = nothing is being asked. */
  readonly demande: RetraitDemande | null;
  /** The sweep in flight — `faits` of `total` done. Null = nothing in flight. */
  readonly encours: { readonly total: number; readonly faits: number } | null;
  /** Orders whose retire did NOT happen, named. Never a silent skip. */
  readonly echecs: readonly string[];
}

export const RETRAIT_IDLE: RetraitUi = { demande: null, encours: null, echecs: [] };

/** Ask. Refused while anything is in flight — a second sweep over rows the
 *  first is still removing would double-count its own progress. */
export function demander(ui: RetraitUi, demande: RetraitDemande): RetraitUi {
  if (ui.encours !== null) return ui;
  if (demande.appels.length === 0) return ui;
  return { demande, encours: null, echecs: [] };
}

export function annuler(ui: RetraitUi): RetraitUi {
  return { ...ui, demande: null };
}

/** Confirm. Returns the door calls to make, and the in-flight state — or
 *  null when there is nothing being asked (a stray tap changes nothing). */
export function commencer(ui: RetraitUi): { ui: RetraitUi; appels: readonly Appel[] } | null {
  if (ui.demande === null || ui.encours !== null) return null;
  const appels = ui.demande.appels;
  return {
    ui: { demande: null, encours: { total: appels.length, faits: 0 }, echecs: [] },
    appels,
  };
}

/** One call answered. A refusal is RECORDED against every row it was for, and
 *  the sweep carries on: the founder must see which ones survived, not lose
 *  the whole run to one. */
export function avancer(ui: RetraitUi, appel: Appel, ok: boolean): RetraitUi {
  if (ui.encours === null) return ui;
  return {
    demande: null,
    encours: { total: ui.encours.total, faits: ui.encours.faits + 1 },
    echecs: ok ? ui.echecs : [...ui.echecs, ...appel.articles],
  };
}

/** The run is over. The failures STAY on screen — that is the whole report. */
export function terminer(ui: RetraitUi): RetraitUi {
  return { demande: null, encours: null, echecs: ui.echecs };
}

export function aEchoue(ui: RetraitUi, orderId: string): boolean {
  return ui.echecs.includes(orderId);
}

/** True while any retire is in flight — every lever on the desk is disabled. */
export function enVol(ui: RetraitUi): boolean {
  return ui.encours !== null;
}

/** The catalog key of the confirmation question. The count and the order id
 *  are composed by the screen; the sentence itself never lives in code. */
export function demandeKey(demande: RetraitDemande): string {
  if (demande.kind === 'colis') return 'courses.confirmer_colis';
  return demande.kind === 'toutes' ? 'courses.confirmer_toutes' : 'courses.confirmer_une';
}

/** The row's lever label: a package in a rider's hands says it goes whole. */
export function retirerKey(row: CourseRow): string {
  return colisEnMains(row) ? 'courses.retirer_colis' : 'courses.retirer';
}
