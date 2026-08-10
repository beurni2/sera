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
  demander,
  enVol,
  etatKey,
  terminer,
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
    expect(t(demandeKey({ kind: 'une', orderIds: ['o'] }))).toBeTruthy();
    expect(t(demandeKey({ kind: 'toutes', orderIds: ['o'] }))).toBeTruthy();
  });

  it('an empty board is an ENCOURAGING state, not an apology', () => {
    const view = coursesView({ kind: 'ok', courses: [] });
    expect(view?.kind).toBe('empty');
    expect(t('courses.vide_aide')).toBe('Le tableau est propre.');
  });
});

describe('nothing is retired without being asked for first', () => {
  it('a tap on « Retirer » only ASKS — the removal waits for a confirmation', () => {
    const asked = demander(RETRAIT_IDLE, { kind: 'une', orderIds: ['ord-a'] });
    expect(asked.demande).toEqual({ kind: 'une', orderIds: ['ord-a'] });
    // Nothing is in flight yet: the screen has not called the door.
    expect(enVol(asked)).toBe(false);
    expect(annuler(asked).demande).toBeNull();
  });

  it('the confirmation hands over EXACTLY the orders that were named', () => {
    const asked = demander(RETRAIT_IDLE, { kind: 'toutes', orderIds: ['ord-a', 'ord-b'] });
    const started = commencer(asked);
    expect(started?.orderIds).toEqual(['ord-a', 'ord-b']);
    expect(started?.ui.encours).toEqual({ total: 2, faits: 0 });
    expect(started?.ui.demande).toBeNull();
  });

  it('confirming when nothing was asked does nothing at all', () => {
    expect(commencer(RETRAIT_IDLE)).toBeNull();
  });

  it('an empty sweep is not a question — « tout retirer » over nothing asks nothing', () => {
    expect(demander(RETRAIT_IDLE, { kind: 'toutes', orderIds: [] })).toEqual(RETRAIT_IDLE);
  });

  it('a second ask is refused while a sweep is running', () => {
    const running = commencer(demander(RETRAIT_IDLE, { kind: 'toutes', orderIds: ['a', 'b'] }))!.ui;
    expect(demander(running, { kind: 'une', orderIds: ['c'] })).toEqual(running);
    expect(commencer(running)).toBeNull();
  });
});

describe('the sweep reports honestly, course by course', () => {
  it('counts progress as the door answers, one by one', () => {
    let ui = commencer(demander(RETRAIT_IDLE, { kind: 'toutes', orderIds: ['a', 'b', 'c'] }))!.ui;
    ui = avancer(ui, 'a', true);
    expect(ui.encours).toEqual({ total: 3, faits: 1 });
    ui = avancer(ui, 'b', true);
    ui = avancer(ui, 'c', true);
    expect(ui.encours).toEqual({ total: 3, faits: 3 });
    expect(terminer(ui).echecs).toEqual([]);
    expect(enVol(terminer(ui))).toBe(false);
  });

  it('a course that did NOT leave is NAMED, and the sweep carries on', () => {
    // The silent skip is the failure mode this exists to prevent: the founder
    // must be able to see which one survived, on its own row.
    let ui = commencer(demander(RETRAIT_IDLE, { kind: 'toutes', orderIds: ['a', 'b', 'c'] }))!.ui;
    ui = avancer(ui, 'a', true);
    ui = avancer(ui, 'b', false);
    ui = avancer(ui, 'c', true);
    ui = terminer(ui);
    expect(ui.echecs).toEqual(['b']);
    expect(aEchoue(ui, 'b')).toBe(true);
    expect(aEchoue(ui, 'a')).toBe(false);
    // …and the failure STAYS on screen after the run — it is the whole report.
    expect(ui.encours).toBeNull();
    expect(t('courses.ligne_echec')).toBe("Cette course n'a pas pu être retirée.");
  });

  it('an answer arriving when nothing is in flight changes nothing', () => {
    expect(avancer(RETRAIT_IDLE, 'a', false)).toEqual(RETRAIT_IDLE);
  });

  it('a fresh ask clears the previous run’s failures', () => {
    const after = terminer(avancer(commencer(demander(RETRAIT_IDLE, { kind: 'une', orderIds: ['a'] }))!.ui, 'a', false));
    expect(after.echecs).toEqual(['a']);
    expect(demander(after, { kind: 'une', orderIds: ['b'] }).echecs).toEqual([]);
  });
});
