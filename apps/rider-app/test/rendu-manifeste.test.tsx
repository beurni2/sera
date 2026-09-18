import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';
import { __modeChargement } from './doubles/expo-audio';

/**
 * ═══ MANIFESTE-1 — the ONE current stop, and the end of service, DRIVEN ═══
 *
 * SE-I03: « at most one active RouteManifest and one current stop. » SE3.2:
 * « end-shift-with-custody exception ». The rider's screen shows the stop
 * logistics DERIVES (never this phone's guess) and offers « Passer hors
 * ligne » with a package in hand ONLY when the desk authorized it — and the
 * server's refusal, when it comes, leaves the course on screen.
 *
 * The logistics double answers `/rider/moi` from live state — the manifest
 * fields exactly as `riderView` names them (`manifest.currentStop.kind`,
 * `manifest.stops`, `manifest.custodyInventory`, `finDeServiceAutorisee`) and
 * the shift doors as the registry answers (`{ ok, state }` / 409 by name).
 * Only the wire is faked; no app code is stubbed. ⚠ BOUND: nothing here claims
 * anything about appearance.
 */

const CODE = 'SR-ABCD-EFGH-JKMN';
const ORDER = 'ord-manif-rendu';

interface Etat {
  status: 'active_unacknowledged' | 'acknowledged';
  shift: 'on_shift' | 'off_shift';
  etape: 'ramassage' | 'livraison' | 'retour';
  carried: boolean;
  finAutorisee: boolean;
  /** What the end-shift door answers: the registry's word, its refusal, or
   *  the ONE 503 it names (custody could not be read — the shift stays on). */
  finRefus: 'custody_would_be_orphaned' | 'custody_unverifiable' | null;
}

function logistics(state: Etat): Route {
  return (path) => {
    if (path === '/rider/moi') {
      return {
        status: 200,
        json: {
          ok: true,
          rider: {
            riderId: 'rider-rendu', displayName: 'Boss', certified: true, privacyAckOk: true,
            shift: { status: state.shift },
            manifest: {
              id: 'man-rider-rendu', riderId: 'rider-rendu', version: state.carried ? 2 : 1, status: 'active',
              orderedStops: state.carried ? [`${state.etape}-as-1`] : ['ramassage-as-1', 'livraison-as-1'],
              custodyInventory: state.carried ? ['pkg-1'] : [],
              stops: state.carried ? [{ stopId: `${state.etape}-as-1`, kind: state.etape, orderId: ORDER }] : [{ stopId: 'ramassage-as-1', kind: 'ramassage', orderId: ORDER }, { stopId: 'livraison-as-1', kind: 'livraison', orderId: ORDER }],
              currentStop: { stopId: `${state.etape}-as-1`, kind: state.etape, orderId: ORDER, assignmentId: 'as-1', taskId: 'task-1' },
              custodyReadings: [{ orderId: ORDER, reading: state.carried ? 'coursier' : 'ailleurs', asOf: '2026-09-18T09:00:00.000Z' }],
            },
            finDeServiceAutorisee: state.finAutorisee,
            assignment: {
              assignmentId: 'as-1', taskId: 'task-1', orderId: ORDER, status: state.status, ackDeadline: null,
              location: { landmark: 'La pharmacie du marché', directions: 'Après le carrefour', zone: 'Gounghin, Ouagadougou' },
              preuvePhotoRefs: [], repereAudioRef: null, codeRamassage: 'ABC-DEF',
              ramassageConfirmeAt: null, codeVerification: null, codeScelle: null,
            },
          },
        },
      };
    }
    if (path === '/rider/assignment/ack') {
      state.status = 'acknowledged';
      return { status: 200, json: { ok: true } };
    }
    if (path === '/rider/shift/end') {
      if (state.finRefus === 'custody_unverifiable') return { status: 503, json: { ok: false, reason: state.finRefus } };
      if (state.finRefus !== null) return { status: 409, json: { ok: false, reason: state.finRefus } };
      state.shift = 'off_shift';
      return { status: 200, json: { ok: true, state: { status: 'off_shift' }, pending: false } };
    }
    if (path === '/rider/shift/start') {
      state.shift = 'on_shift';
      return { status: 200, json: { ok: true, state: { status: 'on_shift', startedAt: '2026-09-18T09:00:00.000Z', confirmedBy: 'server' }, pending: false } };
    }
    return null;
  };
}

const etat = (): Etat => ({ status: 'active_unacknowledged', shift: 'on_shift', etape: 'ramassage', carried: false, finAutorisee: false, finRefus: null });

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

describe('MANIFESTE-1 — the one current stop on the course screen', () => {
  it('after the accept the stop reads « ramassage chez le vendeur »; when custody is his (the next poll), it reads « livraison chez le client »; a return reads « retour chez le vendeur »', async () => {
    const state = etat();
    const { s } = await signedIn([logistics(state)]);
    await s.press('Accepter la course');
    expect(s.texts().length, 'the tree unmounted').toBeGreaterThan(0);
    expect(s.shows('Étape en cours : ramassage chez le vendeur'), JSON.stringify(s.texts())).toBe(true);

    state.carried = true;
    state.etape = 'livraison';
    await s.poll();
    expect(s.shows('Étape en cours : livraison chez le client'), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows('ramassage chez le vendeur')).toBe(false);

    state.etape = 'retour';
    await s.poll();
    expect(s.shows('Étape en cours : retour chez le vendeur')).toBe(true);
  });

  it('with a package in hand « Passer hors ligne » is NOT offered; once the desk authorized it, the sentence and the act appear, the act reaches the door, and the rider lands on the off-line poster with the way back', async () => {
    const state = etat();
    state.carried = true;
    state.etape = 'livraison';
    const { s, w } = await signedIn([logistics(state)]);
    await s.press('Accepter la course');
    expect(s.canPress('Passer hors ligne'), 'no end of service with a package and no authorization').toBe(false);
    expect(s.shows('Séra vous autorise à passer hors ligne avec ce colis.')).toBe(false);

    state.finAutorisee = true;
    await s.poll();
    expect(s.shows('Séra vous autorise à passer hors ligne avec ce colis.'), JSON.stringify(s.texts())).toBe(true);
    expect(s.canPress('Passer hors ligne')).toBe(true);
    await s.press('Passer hors ligne');
    await s.settle();
    expect(w.calls.some((c) => c.path === '/rider/shift/end' && c.method === 'POST'), 'the act never reached the door').toBe(true);
    expect(s.texts().length, 'the tree unmounted').toBeGreaterThan(0);
    // Off line: the poster, and the way back on line.
    expect(s.canPress('Passer en ligne'), JSON.stringify(s.texts())).toBe(true);
  });

  it('the door’s refusal (a package picked up after the authorization) is said in the rider’s words, and the course stays on screen — never a dead end', async () => {
    const state = etat();
    state.carried = true;
    state.etape = 'livraison';
    state.finAutorisee = true;
    state.finRefus = 'custody_would_be_orphaned';
    const { s } = await signedIn([logistics(state)]);
    await s.press('Accepter la course');
    expect(s.canPress('Passer hors ligne')).toBe(true);
    await s.press('Passer hors ligne');
    await s.settle();
    expect(s.shows("Vous portez encore un colis. Finissez la course d'abord."), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows('Étape en cours : livraison chez le client'), 'the course must still be on screen').toBe(true);
    expect(s.canPress('Passer hors ligne'), 'the act stays reachable').toBe(true);
  });

  it('the door’s 503 (custody could not be read) is said BY NAME — the shift stays on, the course stays on screen, the act stays reachable — never the generic « pas de réponse »', async () => {
    const state = etat();
    state.carried = true;
    state.etape = 'livraison';
    state.finAutorisee = true;
    state.finRefus = 'custody_unverifiable';
    const { s } = await signedIn([logistics(state)]);
    await s.press('Accepter la course');
    expect(s.canPress('Passer hors ligne')).toBe(true);
    await s.press('Passer hors ligne');
    await s.settle();
    expect(s.texts().length, 'the tree unmounted').toBeGreaterThan(0);
    expect(s.shows("Séra n'a pas pu vérifier votre colis. Vous restez en ligne. Réessayez dans un moment."), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows('Pas de réponse. Réessayez dans un moment.'), 'the cause is named, not hidden behind « no answer »').toBe(false);
    expect(s.shows('Étape en cours : livraison chez le client'), 'the course must still be on screen').toBe(true);
    expect(s.canPress('Passer hors ligne'), 'the act stays reachable').toBe(true);
  });
});
