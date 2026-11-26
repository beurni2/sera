import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';
import { __modeChargement } from './doubles/expo-audio';
import { freshCourse, logistiqueCourse } from './doubles/logistique-course';

/**
 * ═══ RENDU-RÉEL — the rider's two new refusals, driven ═══
 *
 * 1. The custody codes reach the phone only once he accepted AND the supplier
 *    confirmed (the stand-in is certified to the Worker on exactly that rule):
 *    until then the stall says « Séra attend encore l'accord du fournisseur »
 *    and NOTHING about custody leaves the phone.
 * 2. A shift does not end on a course still in hand. The idle screen offers
 *    « Passer hors ligne »; a course offered since the last poll makes the
 *    door refuse by name, and the rider reads what to do — never « Pas de
 *    réponse » — and the next poll puts the course in front of him.
 */

const CODE = 'SR-ABCD-EFGH-JKMN';
const ORDER = 'ord-rendu-prise';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  __resetFiles();
  __modeChargement(null);
  wiredEnv();
});
afterEach(() => {
  vi.useRealTimers();
});

async function signedIn(routes: readonly Route[]) {
  const w = wire(routes);
  const s = await mountRider();
  await s.type(CODE);
  await s.press('Entrer');
  return { s, w };
}

/** The custody door answers as the real Worker does — and is never reached here. */
const custody: Route = (path) => {
  if (path === '/rider/verification') return { status: 200, json: { ok: true, kind: 'accepted', ledgerSeq: 1, chainValid: true } };
  if (path === '/rider/custody/begin') return { status: 200, json: { ok: true, status: 'custody_with_courier', chain: { task_id: 'task-1', package_id: 'pkg-1' } } };
  return null;
};

describe('the stall waits for the supplier, and nothing about custody leaves the phone', () => {
  it('accepted, checks answered, « Envoyer » pressed and polled: the waiting sentence, no verification, no seal, no road', async () => {
    const state = freshCourse();
    // A server that would hand the codes out early is exactly what the
    // certified stand-in refuses to be: they stay withheld until confirmed.
    state.codeVerification = 'K7M-9PQ';
    state.codeScelle = 'SC-4K7M-9PQR';
    const { s, w } = await signedIn([logistiqueCourse(state, ORDER), custody]);
    await s.press('Accepter la course');
    expect(s.shows('ABC-DEF'), `the ramassage code is his once he accepted: ${JSON.stringify(s.texts())}`).toBe(true);
    await s.press('Oui', 2);
    await s.press('Oui', 1);
    await s.press('Oui', 0);
    await s.press('Envoyer la vérification');
    await s.poll();
    await s.press('Envoyer la vérification');
    expect(s.texts().length, 'the tree unmounted').toBeGreaterThan(0);
    expect(s.shows("Séra attend encore l'accord du fournisseur."), JSON.stringify(s.texts())).toBe(true);
    expect(w.calls.filter((c) => c.path === '/rider/verification' || c.path === '/rider/custody/begin'), 'no custody act before the supplier confirms').toEqual([]);
    expect(s.canPress('En route')).toBe(false);

    state.ramassageConfirmeAt = '2026-11-26T10:00:00.000Z';
    await s.poll();
    await s.press('Envoyer la vérification');
    expect(w.calls.some((c) => c.path === '/rider/verification'), 'after the confirmation the act goes out').toBe(true);
    expect(s.canPress('En route'), JSON.stringify(s.texts())).toBe(true);
  });
});

describe('a shift does not end on a course still in hand', () => {
  interface Etat { course: boolean; shift: 'on_shift' | 'off_shift' }
  /** Idle until `course` turns true; the end door answers as the Worker does. */
  function logistics(etat: Etat): Route {
    const course = freshCourse();
    const avecCourse = logistiqueCourse(course, ORDER);
    return (path, body) => {
      if (path === '/rider/shift/end') {
        if (etat.course) return { status: 409, json: { ok: false, reason: 'course_en_cours' } };
        etat.shift = 'off_shift';
        return { status: 200, json: { ok: true, state: { status: 'off_shift' }, pending: false } };
      }
      if (path === '/rider/moi' && !etat.course) {
        return {
          status: 200,
          json: { ok: true, rider: { riderId: 'rider-rendu', displayName: 'Boss', certified: true, privacyAckOk: true, shift: { status: etat.shift }, assignment: null } },
        };
      }
      return avecCourse(path, body);
    };
  }

  it('a course offered since the last poll: the door refuses, the rider reads what to do, and the next poll shows him the course', async () => {
    const etat: Etat = { course: false, shift: 'on_shift' };
    const { s, w } = await signedIn([logistics(etat)]);
    expect(s.canPress('Passer hors ligne'), JSON.stringify(s.texts())).toBe(true);

    etat.course = true;
    await s.press('Passer hors ligne');
    await s.settle();
    expect(w.calls.some((c) => c.path === '/rider/shift/end' && c.method === 'POST'), 'the act never reached the door').toBe(true);
    expect(s.texts().length, 'the tree unmounted').toBeGreaterThan(0);
    expect(
      s.shows("Vous avez encore une course. Répondez-y d'abord. Si vous l'avez acceptée, appelez Séra pour la rendre."),
      JSON.stringify(s.texts()),
    ).toBe(true);
    expect(s.shows('Pas de réponse. Réessayez dans un moment.'), 'the cause is named, never « no answer »').toBe(false);

    await s.poll();
    expect(s.shows('Une course pour vous'), JSON.stringify(s.texts())).toBe(true);
    expect(s.canPress('Accepter la course')).toBe(true);
  });
});
