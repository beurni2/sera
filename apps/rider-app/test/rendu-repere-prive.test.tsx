import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';
import { __modeChargement, __resetSources, __sources } from './doubles/expo-audio';
import { freshCourse, logistiqueCourse, type CourseState } from './doubles/logistique-course';

/**
 * ═══ RENDU-RÉEL — the buyer's place and voice reach the rider once he accepts ═══
 *
 * Séra Build Spec §1: « Courier access to customer phone/location MUST be
 * just-in-time, task-scoped, expiring. » On the proposal the rider sees the
 * area, the deadline and « Accepter »; her landmark, « Itinéraire » and her
 * voice come with the acceptance. Her voice is played through Séra's own
 * door, on his code, in a header — never an open link, never a code in a URL.
 *
 * The logistics stand-in is certified to the real Worker by
 * `services/logistics-service/test/prise-en-charge.e2e.test.ts`. Like every
 * walk, this one claims nothing about appearance.
 */

const CODE = 'SR-ABCD-EFGH-JKMN';
const ORDER = 'ord-rendu-prive';
const PORTE = { uri: 'http://logistics.test/rider/repere-audio', headers: { Authorization: `Bearer ${CODE}` } };

/** Her pin rides her location, so it too arrives only once he accepts. */
function avecPin(state: CourseState, base: Route = logistiqueCourse(state, ORDER)): Route {
  return (path, body) => {
    const answer = base(path, body);
    if (path === '/rider/moi' && answer !== null && state.status === 'acknowledged') {
      const assignment = ((answer.json as Record<string, unknown>)['rider'] as Record<string, unknown>)['assignment'] as Record<string, unknown>;
      assignment['location'] = { ...(assignment['location'] as Record<string, unknown>), pin: { lat: 12.371532, lng: -1.519931 } };
    }
    return answer;
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  __resetFiles();
  __modeChargement(null);
  __resetSources();
  wiredEnv();
});
afterEach(() => {
  vi.useRealTimers();
});

async function signedIn(routes: readonly Route[]) {
  wire(routes);
  const s = await mountRider();
  await s.type(CODE);
  await s.press('Entrer');
  return s;
}

describe('the proposal shows the area; her place and voice come with « Accepter »', () => {
  it('offered: the area, the sentence and « Accepter » — no landmark card, no voice, no Itinéraire', async () => {
    const s = await signedIn([avecPin(freshCourse())]);
    expect(s.shows('Une course pour vous'), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows('Gounghin, Ouagadougou'), 'the area is on the proposal').toBe(true);
    expect(s.shows('Vous voyez le quartier. Le lieu exact arrive quand vous acceptez.')).toBe(true);
    expect(s.shows('La pharmacie du marché')).toBe(false);
    expect(s.shows('Écouter le repère')).toBe(false);
    expect(s.shows('Itinéraire — ouvrir le GPS')).toBe(false);
    expect(s.canPress('Accepter la course')).toBe(true);
    s.unmount();
  });

  it('accepted: the landmark card, Itinéraire and « Écouter » appear — and the player is given Séra’s door with his code in a header', async () => {
    const s = await signedIn([avecPin(freshCourse())]);
    await s.press('Accepter la course');
    expect(s.shows('La pharmacie du marché'), JSON.stringify(s.texts())).toBe(true);
    expect(s.canPress('Itinéraire — ouvrir le GPS')).toBe(true);
    expect(s.shows('Vous voyez le quartier. Le lieu exact arrive quand vous acceptez.')).toBe(false);

    await s.press('Écouter le repère');
    expect(s.shows('Pause'), 'the note plays').toBe(true);
    expect(__sources()).toEqual([PORTE]);
    s.unmount();
  });

  it('the note never loads (a refused door, silent on the phone): the honest « can’t play » line, the retry, and the course goes on', async () => {
    // A refused note never loads: on iOS, nothing ever arrives.
    __modeChargement('silence');
    const s = await signedIn([avecPin(freshCourse())]);
    await s.press('Accepter la course');
    await s.press('Écouter le repère');
    await s.poll();
    expect(s.texts().length, 'the tree survived the watchdog').toBeGreaterThan(0);
    expect(s.shows('La note ne se lit pas. Vérifiez le réseau et réessayez.'), JSON.stringify(s.texts())).toBe(true);
    expect(s.canPress('Écouter le repère'), 'the retry is offered').toBe(true);
    expect(s.canPress('Oui'), 'the pickup check-up is still his next step').toBe(true);
    s.unmount();
  });

  it('a note playing on course A stops when the next poll brings course B offered — no voice over a proposal', async () => {
    const state = freshCourse();
    let course = 'as-A';
    const base = avecPin(state);
    const deuxCourses: Route = (path, body) => {
      const answer = base(path, body);
      if (path === '/rider/moi' && answer !== null) {
        const assignment = ((answer.json as Record<string, unknown>)['rider'] as Record<string, unknown>)['assignment'] as Record<string, unknown>;
        assignment['assignmentId'] = course;
      }
      return answer;
    };
    const s = await signedIn([deuxCourses]);
    await s.press('Accepter la course');
    await s.press('Écouter le repère');
    expect(s.shows('Pause'), 'the note plays').toBe(true);

    // The desk takes A back and offers him B inside one poll.
    course = 'as-B';
    state.status = 'active_unacknowledged';
    await s.poll();
    expect(s.shows('Une course pour vous'), JSON.stringify(s.texts())).toBe(true);

    // Accepting B: the row is back at rest (A's player was stopped, never
    // left running), and listening makes a new player.
    await s.press('Accepter la course');
    expect(s.canPress('Écouter le repère'), 'the row is at rest — A’s note was stopped').toBe(true);
    expect(s.shows('Pause')).toBe(false);
    await s.press('Écouter le repère');
    expect(__sources(), 'a new player for B').toEqual([PORTE, PORTE]);
    s.unmount();
  });

  it('a second course never resumes the first buyer’s note — the same door, a new player', async () => {
    const state = freshCourse();
    let course = 'as-1';
    const base = avecPin(state);
    const deuxCourses: Route = (path, body) => {
      const answer = base(path, body);
      if (path === '/rider/moi' && answer !== null) {
        const assignment = ((answer.json as Record<string, unknown>)['rider'] as Record<string, unknown>)['assignment'] as Record<string, unknown>;
        assignment['assignmentId'] = course;
      }
      return answer;
    };
    const s = await signedIn([deuxCourses]);
    await s.press('Accepter la course');
    await s.press('Écouter le repère');
    await s.press('Pause');
    expect(__sources()).toHaveLength(1);

    // The first course closes and the desk gives him another, already accepted.
    course = 'as-2';
    await s.poll();
    await s.press('Écouter le repère');
    expect(__sources(), 'a new player for the new course, never a resume of the old note').toEqual([PORTE, PORTE]);
    s.unmount();
  });
});
