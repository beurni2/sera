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
    const [a1] = boardCourses(COLIS_BOARD);
    const demande = demandeLigne(a1!);
    expect(demande).toEqual({
      kind: 'une',
      orderIds: ['ord-a1'],
      appels: [{ orderId: 'ord-a1', colisEntier: false, articles: ['ord-a1'] }],
      articleSeul: true,
    });
    expect(retirerKey(a1!)).toBe('courses.retirer');
    expect(t('courses.confirmer_article_seul')).toBe('Seul cet article part. Les autres articles du colis restent sur le tableau.');
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
