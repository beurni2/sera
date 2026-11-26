import { describe, expect, it } from 'vitest';
import {
  RETRAIT_IDLE,
  aEchoue,
  annuler,
  avancer,
  boardCourses,
  commencer,
  coursesView,
  demandeKey,
  demandeLigne,
  demandeToutes,
  demander,
  enVol,
  etatKey,
  retirerKey,
  terminer,
  type Appel,
  type CourseRow,
} from '../src/courses';
import { t } from '../src/i18n';
import {
  REMISE_IDLE,
  annulerRemise,
  codesBloquesRows,
  commencerRemise,
  demanderRemise,
  remiseEchouee,
  remiseFaite,
  remiseRelue,
  remiseRefusKey,
  remiseView,
} from '../src/courses';

/**
 * PURGE-ESSAI — the courses desk's decisions. Pure, so every state a
 * DESTRUCTIVE screen can be in is testable without a browser or a server: what
 * it reads off the board, what it asks before removing anything, what it shows
 * while a sweep runs, and what it says about a course that did not leave.
 */

const BOARD = {
  ok: true,
  board: {
    queued: [
      { taskId: 'task-1', orderId: 'ord-b', admittedAt: '2026-08-10T09:00:00.000Z' },
      { taskId: 'task-2', orderId: 'ord-a', admittedAt: '2026-08-10T09:05:00.000Z' },
    ],
    riders: [
      { riderId: 'rider-boss', displayName: 'Boss', certified: true, assignable: false },
      { riderId: 'rider-awa', displayName: 'Awa', certified: true, assignable: true },
    ],
    assignments: [
      { assignmentId: 'as-1', taskId: 'task-9', orderId: 'ord-c', riderId: 'rider-boss', status: 'acknowledged' },
    ],
  },
};

const attente = (orderId: string): CourseRow => ({ orderId, etat: 'attente' });
const seul = (orderId: string): Appel => ({ orderId, colisEntier: false, articles: [orderId] });
/** One article of a package a rider already carries. */
const EN_MAINS: CourseRow = { orderId: 'ord-p1', etat: 'confiee', riderName: 'Boss', colis: ['ord-p1', 'ord-p2'] };

describe('what the board actually says', () => {
  it('reads one row per order, names who carries it, and sorts them stably', () => {
    const rows = boardCourses(BOARD);
    expect(rows.map((r) => r.orderId)).toEqual(['ord-a', 'ord-b', 'ord-c']);
    expect(rows.find((r) => r.orderId === 'ord-a')).toEqual({ orderId: 'ord-a', etat: 'attente' });
    // The rider's NAME, not their id — the founder retires « la course de Boss ».
    expect(rows.find((r) => r.orderId === 'ord-c')).toEqual({
      orderId: 'ord-c',
      etat: 'confiee',
      riderName: 'Boss',
    });
  });

  it('an order that is queued AND assigned is ONE row, in its stronger state', () => {
    // A re-composed order mid-swap must not ask him to confirm the same
    // removal twice — and « confiée » is the fact he needs before retiring.
    const rows = boardCourses({
      board: {
        queued: [{ taskId: 't', orderId: 'ord-x' }],
        assignments: [{ assignmentId: 'as', taskId: 't', orderId: 'ord-x', riderId: 'rider-awa' }],
        riders: [{ riderId: 'rider-awa', displayName: 'Awa' }],
      },
    });
    expect(rows).toEqual([{ orderId: 'ord-x', etat: 'confiee', riderName: 'Awa' }]);
  });

  it('a rider the roster does not name still gets named — by their id, never a blank', () => {
    const rows = boardCourses({
      board: { assignments: [{ orderId: 'ord-x', riderId: 'rider-fantome' }], riders: [] },
    });
    expect(rows).toEqual([{ orderId: 'ord-x', etat: 'confiee', riderName: 'rider-fantome' }]);
  });

  it('garbage on the wire empties the desk instead of throwing over it', () => {
    // A destructive desk that crashes on a malformed row is a desk that hides
    // a course the founder believes he retired.
    expect(boardCourses(null)).toEqual([]);
    expect(boardCourses({})).toEqual([]);
    expect(boardCourses({ board: { queued: 'nope', assignments: 7, riders: null } })).toEqual([]);
    expect(boardCourses({ board: { queued: [null, {}, { orderId: '' }, { orderId: '  ' }] } })).toEqual([]);
  });
});

describe('what the desk shows', () => {
  const row: CourseRow = { orderId: 'ord-a', etat: 'attente' };

  it('has a designed state for every answer, never a blank table', () => {
    expect(coursesView({ kind: 'loading' })?.kind).toBe('loading');
    expect(coursesView({ kind: 'failed' })?.kind).toBe('failed');
    expect(coursesView({ kind: 'ok', courses: [] })?.kind).toBe('empty');
    expect(coursesView({ kind: 'ok', courses: [row] })?.kind).toBe('liste');
  });

  it('a refused key never renders as a section', () => {
    expect(coursesView({ kind: 'bad_key' })).toBeNull();
  });

  it('every message and label it names is a real catalog string', () => {
    for (const read of [{ kind: 'loading' }, { kind: 'failed' }, { kind: 'ok', courses: [] }] as const) {
      const view = coursesView(read);
      const message = view !== null && 'message' in view ? view.message : '';
      expect(t(message), message).not.toBe(message);
    }
    expect(t(etatKey({ orderId: 'o', etat: 'attente' }))).toBeTruthy();
    expect(t(etatKey({ orderId: 'o', etat: 'confiee' }))).toBeTruthy();
    expect(t(demandeKey(demandeLigne(row)))).toBeTruthy();
    expect(t(demandeKey(demandeToutes([row])))).toBeTruthy();
    expect(t(demandeKey(demandeLigne(EN_MAINS)))).toBeTruthy();
    expect(t(retirerKey(row))).toBeTruthy();
    expect(t(retirerKey(EN_MAINS))).toBeTruthy();
  });

  it('an empty board is an ENCOURAGING state, not an apology', () => {
    const view = coursesView({ kind: 'ok', courses: [] });
    expect(view?.kind).toBe('empty');
    expect(t('courses.vide_aide')).toBe('Le tableau est propre.');
  });
});

describe('nothing is retired without being asked for first', () => {
  it('a tap on « Retirer » only ASKS — the removal waits for a confirmation', () => {
    const asked = demander(RETRAIT_IDLE, demandeLigne(attente('ord-a')));
    expect(asked.demande).toEqual({
      kind: 'une',
      orderIds: ['ord-a'],
      appels: [{ orderId: 'ord-a', colisEntier: false, articles: ['ord-a'] }],
      articleSeul: false,
      autresEnAttente: false,
    });
    // Nothing is in flight yet: the screen has not called the door.
    expect(enVol(asked)).toBe(false);
    expect(annuler(asked).demande).toBeNull();
  });

  it('the confirmation hands over EXACTLY the orders that were named', () => {
    const asked = demander(RETRAIT_IDLE, demandeToutes([attente('ord-a'), attente('ord-b')]));
    const started = commencer(asked);
    expect(started?.appels.map((a) => a.orderId)).toEqual(['ord-a', 'ord-b']);
    expect(started?.ui.encours).toEqual({ total: 2, faits: 0 });
    expect(started?.ui.demande).toBeNull();
  });

  it('confirming when nothing was asked does nothing at all', () => {
    expect(commencer(RETRAIT_IDLE)).toBeNull();
  });

  it('an empty sweep is not a question — « tout retirer » over nothing asks nothing', () => {
    expect(demander(RETRAIT_IDLE, demandeToutes([]))).toEqual(RETRAIT_IDLE);
  });

  it('a second ask is refused while a sweep is running', () => {
    const running = commencer(demander(RETRAIT_IDLE, demandeToutes([attente('a'), attente('b')])))!.ui;
    expect(demander(running, demandeLigne(attente('c')))).toEqual(running);
    expect(commencer(running)).toBeNull();
  });
});

describe('the sweep reports honestly, course by course', () => {
  it('counts progress as the door answers, one by one', () => {
    let ui = commencer(demander(RETRAIT_IDLE, demandeToutes([attente('a'), attente('b'), attente('c')])))!.ui;
    ui = avancer(ui, seul('a'), true);
    expect(ui.encours).toEqual({ total: 3, faits: 1 });
    ui = avancer(ui, seul('b'), true);
    ui = avancer(ui, seul('c'), true);
    expect(ui.encours).toEqual({ total: 3, faits: 3 });
    expect(terminer(ui).echecs).toEqual([]);
    expect(enVol(terminer(ui))).toBe(false);
  });

  it('a course that did NOT leave is NAMED, and the sweep carries on', () => {
    // The silent skip is the failure mode this exists to prevent: the founder
    // must be able to see which one survived, on its own row.
    let ui = commencer(demander(RETRAIT_IDLE, demandeToutes([attente('a'), attente('b'), attente('c')])))!.ui;
    ui = avancer(ui, seul('a'), true);
    ui = avancer(ui, seul('b'), false);
    ui = avancer(ui, seul('c'), true);
    ui = terminer(ui);
    expect(ui.echecs).toEqual(['b']);
    expect(aEchoue(ui, 'b')).toBe(true);
    expect(aEchoue(ui, 'a')).toBe(false);
    // …and the failure STAYS on screen after the run — it is the whole report.
    expect(ui.encours).toBeNull();
    expect(t('courses.ligne_echec')).toBe("Cette course n'a pas pu être retirée.");
  });

  it('an answer arriving when nothing is in flight changes nothing', () => {
    expect(avancer(RETRAIT_IDLE, seul('a'), false)).toEqual(RETRAIT_IDLE);
  });

  it('a fresh ask clears the previous run’s failures', () => {
    const after = terminer(avancer(commencer(demander(RETRAIT_IDLE, demandeLigne(attente('a'))))!.ui, seul('a'), false));
    expect(after.echecs).toEqual(['a']);
    expect(demander(after, demandeLigne(attente('b'))).echecs).toEqual([]);
  });
});

/**
 * COLIS-2 — the founder: « « Retirer » on your console removes the whole
 * package ». Each article is its own row; one waiting article leaves alone and
 * the rest of its bag stays; a bag a rider already carries leaves whole, and
 * only when he is asked in those words.
 */
describe('a package on the desk: one row per article, one article leaves alone', () => {
  const COLIS_BOARD = {
    board: {
      queued: [
        { taskId: 'task-p', orderId: 'ord-a1', colis: { orderIds: ['ord-a1', 'ord-a2'] } },
        { taskId: 'task-s', orderId: 'ord-s' },
      ],
      assignments: [{ assignmentId: 'as-p', taskId: 'task-q', orderId: 'ord-p1', riderId: 'rider-boss' }],
      colisEnCourse: { 'as-p': { packageId: 'col-p', orderIds: ['ord-p1', 'ord-p2'], reglement: {} } },
      riders: [{ riderId: 'rider-boss', displayName: 'Boss' }],
    },
  };

  it('a queued package and a package on the road are one row per ARTICLE, each naming its bag', () => {
    expect(boardCourses(COLIS_BOARD)).toEqual([
      { orderId: 'ord-a1', etat: 'attente', colis: ['ord-a1', 'ord-a2'] },
      { orderId: 'ord-a2', etat: 'attente', colis: ['ord-a1', 'ord-a2'] },
      { orderId: 'ord-p1', etat: 'confiee', riderName: 'Boss', colis: ['ord-p1', 'ord-p2'] },
      { orderId: 'ord-p2', etat: 'confiee', riderName: 'Boss', colis: ['ord-p1', 'ord-p2'] },
      { orderId: 'ord-s', etat: 'attente' },
    ]);
  });

  it('a package the board lists wrongly is read as no package — the row stays a plain course', () => {
    for (const orderIds of [['ord-a1'], ['ord-a1', 'ord-a1'], ['ord-x', 'ord-y'], ['ord-a1', ''], 'nope']) {
      const rows = boardCourses({ board: { queued: [{ taskId: 't', orderId: 'ord-a1', colis: { orderIds } }] } });
      expect(rows, JSON.stringify(orderIds)).toEqual([{ orderId: 'ord-a1', etat: 'attente' }]);
    }
  });

  it('« Retirer » on a waiting article asks for THAT article alone, and says the rest of the bag stays', () => {
    const a2 = boardCourses(COLIS_BOARD).find((r) => r.orderId === 'ord-a2')!;
    const demande = demandeLigne(a2);
    expect(demande).toEqual({
      kind: 'une',
      orderIds: ['ord-a2'],
      appels: [{ orderId: 'ord-a2', colisEntier: false, articles: ['ord-a2'] }],
      articleSeul: true,
      autresEnAttente: false,
    });
    expect(retirerKey(a2)).toBe('courses.retirer');
    expect(t('courses.confirmer_article_seul')).toBe('Seul cet article part. Les autres articles du colis restent sur le tableau.');
  });

  it('« Retirer » on the article a waiting package’s course is filed under says the course goes with it — never that the others stay', () => {
    const [a1] = boardCourses(COLIS_BOARD);
    const demande = demandeLigne(a1!);
    expect(demande).toMatchObject({ kind: 'une', orderIds: ['ord-a1'], articleSeul: true, autresEnAttente: true });
    expect(t('courses.confirmer_article_tete')).toBe('La course de ce colis part avec cet article. Les autres articles quittent aussi le tableau : ils attendront une nouvelle course.');
  });

  it('a bag a rider carries leaves WHOLE: its lever says so, and the confirmation names every article in ONE call', () => {
    const p2 = boardCourses(COLIS_BOARD).find((r) => r.orderId === 'ord-p2')!;
    expect(retirerKey(p2)).toBe('courses.retirer_colis');
    expect(t(retirerKey(p2))).toBe('Retirer le colis');
    const demande = demandeLigne(p2);
    expect(demande.kind).toBe('colis');
    expect(demande.orderIds).toEqual(['ord-p1', 'ord-p2']);
    expect(demande.appels).toEqual([{ orderId: 'ord-p2', colisEntier: true, articles: ['ord-p1', 'ord-p2'] }]);
    expect(t(demandeKey(demande))).toBe('Retirer tout ce colis du tableau ?');
  });

  it('« Tout retirer » calls once per waiting article and ONCE for the bag on the road — never one of its articles alone', () => {
    const demande = demandeToutes(boardCourses(COLIS_BOARD));
    expect(demande.orderIds).toEqual(['ord-a1', 'ord-a2', 'ord-p1', 'ord-p2', 'ord-s']);
    expect(demande.appels).toEqual([
      seul('ord-a1'),
      seul('ord-a2'),
      { orderId: 'ord-p1', colisEntier: true, articles: ['ord-p1', 'ord-p2'] },
      seul('ord-s'),
    ]);
  });

  it('a whole-bag call that fails names EVERY article of the bag on its own row', () => {
    const p1 = boardCourses(COLIS_BOARD).find((r) => r.orderId === 'ord-p1')!;
    const started = commencer(demander(RETRAIT_IDLE, demandeLigne(p1)))!;
    const ui = terminer(avancer(started.ui, started.appels[0]!, false));
    expect(aEchoue(ui, 'ord-p1')).toBe(true);
    expect(aEchoue(ui, 'ord-p2')).toBe(true);
  });
});

/**
 * The buyer's code locked after five wrong tries — the founder's unlock desk.
 * Pure: what it reads off the board (never the code), what it asks before
 * sending, and the one command id an attempt rides on a retry.
 */
describe('codes bloqués — the board\'s list, read defensively', () => {
  const board = (extra: Record<string, unknown>) => ({
    ok: true,
    board: {
      riders: [{ riderId: 'rider-boss', displayName: 'Boss' }],
      assignments: [],
      ...extra,
    },
  });

  it('one row per locked course, the rider by name, every article, the instant it locked', () => {
    const read = codesBloquesRows(board({
      codesBloques: [{ assignmentId: 'as-1', riderId: 'rider-boss', orderIds: ['ord-a', 'ord-b'], depuis: '2026-11-26T09:10:00.000Z' }],
      codesBloquesPartiel: false,
    }));
    expect(read).toEqual({
      rows: [{ assignmentId: 'as-1', riderId: 'rider-boss', riderName: 'Boss', orderIds: ['ord-a', 'ord-b'], depuis: '2026-11-26T09:10:00.000Z' }],
      partiel: false,
    });
  });

  it('a malformed row is skipped, never a blank desk; an old board without the list is empty, not partial', () => {
    expect(codesBloquesRows(board({
      codesBloques: [{ assignmentId: '', orderIds: ['x'] }, { assignmentId: 'as-2', orderIds: [] }, 'oui', { assignmentId: 'as-3', riderId: 'r-9', orderIds: ['ord-c'], depuis: 'pas une date' }],
    }))).toEqual({ rows: [{ assignmentId: 'as-3', riderId: 'r-9', riderName: 'r-9', orderIds: ['ord-c'], depuis: '' }], partiel: false });
    expect(codesBloquesRows(board({}))).toEqual({ rows: [], partiel: false });
    expect(codesBloquesRows(null)).toEqual({ rows: [], partiel: false });
  });

  it('a partial read is carried, so the desk can say the list may not be complete', () => {
    expect(codesBloquesRows(board({ codesBloques: [], codesBloquesPartiel: true }))).toEqual({ rows: [], partiel: true });
  });

  it('honest states: loading, failed, empty (and empty-but-partial), list; a refused key escalates', () => {
    expect(remiseView({ kind: 'bad_key' })).toBeNull();
    expect(remiseView({ kind: 'loading' })).toEqual({ kind: 'loading', message: 'reprog.chargement' });
    expect(remiseView({ kind: 'failed' })).toEqual({ kind: 'failed', message: 'reprog.echec', aide: 'reprog.echec_aide' });
    expect(remiseView({ kind: 'ok', value: { rows: [], partiel: false } })).toEqual({ kind: 'empty', message: 'remise.vide', partiel: false });
    expect(remiseView({ kind: 'ok', value: { rows: [], partiel: true } })).toEqual({ kind: 'empty', message: 'remise.vide', partiel: true });
    const row = { assignmentId: 'as-1', riderId: 'r', riderName: 'r', orderIds: ['o'], depuis: '' };
    expect(remiseView({ kind: 'ok', value: { rows: [row], partiel: false } })).toEqual({ kind: 'liste', rows: [row], partiel: false });
  });

  it('every key the desk can show is in the catalog', () => {
    for (const key of ['remise.section', 'remise.intro', 'remise.avant', 'remise.depuis', 'remise.debloquer', 'remise.confirmer_question',
      'remise.confirmer_aide', 'remise.confirmer', 'remise.annuler', 'remise.en_cours', 'remise.fait', 'remise.refus', 'remise.refus_aide',
      'remise.vide', 'remise.partiel', 'remise.partiel_aide']) {
      expect(t(key), key).not.toBe(key);
    }
    expect(t('remise.section')).toBe('Codes de la cliente bloqués');
    expect(t('remise.partiel')).toBe('Cette liste n\'est peut-être pas complète.');
  });
});

describe('codes bloqués — ASK → CONFIRM → ONE SEND → RESULT', () => {
  const mint = (() => { let n = 0; return () => `cmd-${(n += 1)}`; })();

  it('the lever asks and sends nothing; « Annuler » closes; only the confirmation mints an attempt', () => {
    const asked = demanderRemise(REMISE_IDLE, 'as-1');
    expect(asked.demande).toBe('as-1');
    expect(asked.enVol).toBeNull();
    expect(annulerRemise(asked)).toEqual(REMISE_IDLE);
    const sent = commencerRemise(asked, 'as-1', mint);
    expect(sent).not.toBeNull();
    expect(sent!.ui.enVol).toBe('as-1');
    expect(sent!.ui.demande).toBeNull();
    // A second confirm while the first is in flight sends nothing.
    expect(commencerRemise(demanderRemise(sent!.ui, 'as-1'), 'as-1', mint)).toBeNull();
  });

  it('a refusal by name keeps the lever and the SAME command id for the retry; done clears it', () => {
    const first = commencerRemise(demanderRemise(REMISE_IDLE, 'as-1'), 'as-1', mint)!;
    const refused = remiseEchouee(first.ui, 'as-1', remiseRefusKey('custody_refused'));
    expect(refused.enVol).toBeNull();
    expect(refused.echecs['as-1']).toBe('remise.refus');
    const retry = commencerRemise(demanderRemise(refused, 'as-1'), 'as-1', mint)!;
    expect(retry.commandId).toBe(first.commandId);
    expect(retry.ui.echecs['as-1']).toBeUndefined();
    const done = remiseFaite(retry.ui, 'as-1', ['ord-a', 'ord-b']);
    expect(done.faits['as-1']).toEqual(['ord-a', 'ord-b']);
    expect(done.commandes['as-1']).toBeUndefined();
    expect(done.enVol).toBeNull();
  });

  it('the done mark carries the course\'s order ids; a board read listing the course as locked again drops it; one not listing it keeps it', () => {
    const row = (assignmentId: string, orderIds: string[]) => ({ assignmentId, riderId: 'r', riderName: 'r', orderIds, depuis: '' });
    const x = remiseFaite(commencerRemise(demanderRemise(REMISE_IDLE, 'as-x'), 'as-x', mint)!.ui, 'as-x', ['ord-x1', 'ord-x2']);
    const both = remiseFaite(commencerRemise(demanderRemise(x, 'as-z'), 'as-z', mint)!.ui, 'as-z', ['ord-z']);
    expect(both.faits).toEqual({ 'as-x': ['ord-x1', 'ord-x2'], 'as-z': ['ord-z'] });
    // Another course locks: X's and Z's marks stay, each naming its own course.
    expect(remiseRelue(both, [row('as-y', ['ord-y'])]).faits).toEqual({ 'as-x': ['ord-x1', 'ord-x2'], 'as-z': ['ord-z'] });
    // X locks again: only X's mark leaves.
    expect(remiseRelue(both, [row('as-x', ['ord-x1'])]).faits).toEqual({ 'as-z': ['ord-z'] });
    // An empty list keeps every mark.
    expect(remiseRelue(both, []).faits).toEqual(both.faits);
  });
});
