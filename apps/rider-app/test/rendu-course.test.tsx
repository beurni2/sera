import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';

/**
 * ═══ RENDU-RÉEL — the rider's course, DRIVEN, not read ═══
 *
 * Every test here is a bug that actually shipped on 2026-08-10, or the exact
 * mechanism that let one ship. They are written as a rider's day: sign in,
 * accept, verify, take the road, arrive, hand over.
 *
 * ⚠ THESE ARE THE QUESTIONS SOURCE SCANS CANNOT ANSWER. « Is the string in the
 * file » was green through all three failures. « Can the rider get to the next
 * screen » was answered by nobody until this file.
 */

const CODE = 'SR-ABCD-EFGH-JKMN';
const ORDER = 'ord-rendu-1';
const SEAL = 'SC-4K7M-9PQR';
const PICKUP = 'K7M-9PQ';
const DROP = 'DROP-RENDU-1';

interface CourseState {
  status: 'active_unacknowledged' | 'acknowledged';
  ramassageConfirmeAt: string | null;
  codeVerification: string | null;
  codeScelle: string | null;
}

/** The logistics side: `/rider/moi` + the ack door, answering from live state
 *  so the screen sees what a real poll would show. */
function logistics(state: CourseState): Route {
  return (path) => {
    if (path === '/rider/moi') {
      return {
        status: 200,
        json: {
          ok: true,
          rider: {
            riderId: 'rider-rendu', displayName: 'Boss', certified: true, privacyAckOk: true,
            shift: { status: 'on_shift' },
            assignment: {
              assignmentId: 'as-1', taskId: 'task-1', orderId: ORDER, status: state.status,
              ackDeadline: null,
              location: { landmark: 'La pharmacie du marché', directions: 'Après le carrefour', zone: 'Gounghin, Ouagadougou' },
              preuvePhotoRefs: [], repereAudioRef: 'media/11111111-2222-4333-8444-555555555555',
              codeRamassage: 'ABC-DEF',
              ramassageConfirmeAt: state.ramassageConfirmeAt,
              codeVerification: state.codeVerification,
              codeScelle: state.codeScelle,
            },
          },
        },
      };
    }
    if (path === '/rider/assignment/ack') {
      state.status = 'acknowledged';
      return { status: 200, json: { ok: true } };
    }
    return null;
  };
}

/**
 * The custody side. ⚠ CONTRACT-CERTIFIED TO THE REAL WORKER'S ANSWERS
 * (Execution Contract §3): every status string below is the one
 * `custody-do.ts` actually sets, and each is the exact field the app's own
 * reader tests — `verificationAccepted` reads `kind === 'accepted'`,
 * `custodyBegan` reads `status === 'custody_with_courier'`, `evidenceHeld`
 * reads `evidence_recorded`, `custodyWithCustomer` reads
 * `custody_with_customer`, transit reads `departed` / `arrived`. A fake that
 * invented friendlier shapes would make every screen below look reachable
 * while the real build sat on « Séra a refusé » — §9.8, and it is exactly what
 * the first draft of this file did.
 */
function custody(opts: {
  onVerify?: () => { status: number; json: Record<string, unknown> };
  onBegin?: () => { status: number; json: Record<string, unknown> };
  onEvidence?: () => { status: number; json: Record<string, unknown> };
} = {}): Route {
  return (path) => {
    if (path === '/rider/verification') {
      // `custody-do.ts` sends `{ ok, kind, ledgerSeq, chainValid }` here — no
      // `status` key. An invented one is exactly what this file forbids itself.
      return opts.onVerify?.() ?? { status: 200, json: { ok: true, kind: 'accepted', ledgerSeq: 1, chainValid: true } };
    }
    if (path === '/rider/custody/begin') {
      return opts.onBegin?.() ?? {
        status: 200,
        json: { ok: true, status: 'custody_with_courier', chain: { task_id: 'task-1', package_id: 'pkg-1' } },
      };
    }
    if (path === '/rider/transit/depart') return { status: 200, json: { ok: true, status: 'departed' } };
    if (path === '/rider/transit/arrive') return { status: 200, json: { ok: true, status: 'arrived' } };
    if (path === '/rider/delivery/evidence') {
      return opts.onEvidence?.() ?? { status: 200, json: { ok: true, status: 'evidence_recorded' } };
    }
    if (path === '/rider/delivery/drop') return { status: 200, json: { ok: true, status: 'custody_with_customer' } };
    return null;
  };
}

const freshCourse = (): CourseState => ({
  status: 'active_unacknowledged',
  ramassageConfirmeAt: null,
  codeVerification: null,
  codeScelle: null,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  __resetFiles();
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

describe('⚠ ÉCRAN BLANC — the accept tap, driven', () => {
  it('accepting a course does NOT blank the screen — the bug the founder hit', async () => {
    const state = freshCourse();
    const { s } = await signedIn([logistics(state), custody()]);
    expect(s.shows('Une course pour vous'), JSON.stringify(s.texts())).toBe(true);

    /**
     * ⚠ THE PRECONDITION THE FOUNDER MET WITHOUT THINKING ABOUT IT: he
     * listened to the buyer's repère before accepting. No player, no crash —
     * which is why relaunching the app appeared to « fix » it, and why the
     * bug looked intermittent.
     */
    await s.press('Écouter le repère');

    await s.press('Accepter la course');

    /**
     * THE ASSERTION THAT WAS MISSING ALL DAY. The crash was a throw inside a
     * passive effect (`repereAudio.stop()` on the repère row disappearing),
     * which React answers by unmounting the entire tree. A blank screen is not
     * an error anywhere — it is simply NO TEXT, which is precisely why nothing
     * in a source scan could ever have seen it.
     */
    expect(s.texts().length, 'the tree unmounted — this is the white screen').toBeGreaterThan(0);
    expect(s.shows('Vérifier le colis')).toBe(true);
  });
});

describe('⚠ ROUTE-DIRECTE — the seal fires itself, and the road opens', () => {
  it('the supplier confirms → the checks are answered → « Prendre la route » appears, with no seal screen', async () => {
    const state = freshCourse();
    const { s, w } = await signedIn([logistics(state), custody()]);
    await s.press('Accepter la course');

    // The three checks — all conforming, so by the founder's ruling NO camera.
    for (const q of ["C'est bien ce produit", 'La quantité est complète', "L'emballage est intact"]) {
      expect(s.shows(q), `the checklist must ask « ${q} » — on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    }
    expect(s.shows('Prendre la photo'), 'no camera when nothing is wrong').toBe(false);

    await s.press('Oui', 2);
    await s.press('Oui', 1);
    await s.press('Oui', 0);

    /**
     * ⚠ THE FOUNDER'S ACTUAL SEQUENCE, INCLUDING THE WAIT. The rider taps
     * « Envoyer » at the stall BEFORE the supplier has confirmed — the port
     * refuses locally, by name, because the session carries no pickup code
     * yet. That honest waiting state is half the ruling and is asserted here.
     */
    await s.press('Envoyer la vérification');
    expect(s.shows("Séra attend encore l'accord du fournisseur.")).toBe(true);
    expect(s.canPress('En route'), 'the road must NOT open before the supplier confirms').toBe(false);

    // The supplier confirms at his console; the 20 s poll carries the codes.
    state.ramassageConfirmeAt = '2026-08-10T10:00:00.000Z';
    state.codeVerification = PICKUP;
    state.codeScelle = SEAL;
    await s.poll();
    await s.press('Envoyer la vérification');

    /**
     * ⚠ THE FOUNDER'S FLOW, ASSERTED AS A REACHABLE SCREEN — not as a string in
     * a file. « after the code is confirmed from supplier the next screen is
     * prendre la route ». No seal number, no seal photo, in between.
     */
    expect(s.shows('Numéro du scellé'), 'the seal screen must be gone').toBe(false);
    expect(s.canPress('En route'), `« En route » unreachable. On screen: ${JSON.stringify(s.texts())}`).toBe(true);

    // …and the seal really was registered, with no photo and no tap.
    const seal = w.calls.find((c) => c.path === '/rider/custody/begin');
    expect(seal, 'the seal act was never called — a dead automatic act').toBeDefined();
    expect(seal?.body?.['custodySealId']).toBe(SEAL);
    expect(seal?.body?.['sealPhotoRefs']).toEqual([]);
  });

  it('⚠ the seal fires ONCE — a second poll must not re-register it', async () => {
    const state = freshCourse();
    state.ramassageConfirmeAt = '2026-08-10T10:00:00.000Z';
    state.codeVerification = PICKUP;
    state.codeScelle = SEAL;
    const { s, w } = await signedIn([logistics(state), custody()]);
    await s.press('Accepter la course');
    await s.press('Oui', 2);
    await s.press('Oui', 1);
    await s.press('Oui', 0);
    await s.press('Envoyer la vérification');
    /**
     * ⚠ IT MUST POLL, NOT SETTLE — and the first cut of this test did not.
     * `settle()` only flushes microtasks; the auto-seal effect is keyed on
     * `liveAssignment`, which only changes when `/rider/moi` answers again. So
     * the scenario in this test's own title was never executed: a verifier
     * removed BOTH once-only guards from `scelleAuto`, making the app
     * re-register custody on every 20 s poll, and all six tests stayed green.
     * §9.7, in the middle of the custody path.
     */
    await s.poll();
    await s.poll();
    expect(w.calls.filter((c) => c.path === '/rider/custody/begin')).toHaveLength(1);
  });

  it('⚠ a seal that could not be sent leaves a REAL retry — « Réessayez » with something to tap', async () => {
    const state = freshCourse();
    state.ramassageConfirmeAt = '2026-08-10T10:00:00.000Z';
    state.codeVerification = PICKUP;
    state.codeScelle = SEAL;
    let begins = 0;
    const { s, w } = await signedIn([
      logistics(state),
      custody({
        onBegin: () => {
          begins += 1;
          // The first attempt dies on the road; the second lands.
          return begins === 1
            ? { status: 503, json: { ok: false } }
            : { status: 200, json: { ok: true, status: 'custody_with_courier', chain: { task_id: 'task-1', package_id: 'pkg-1' } } };
        },
      }),
    ]);
    await s.press('Accepter la course');
    await s.press('Oui', 2);
    await s.press('Oui', 1);
    await s.press('Oui', 0);
    await s.press('Envoyer la vérification');

    /**
     * ⚠ THE BLOCKER, DRIVEN. The auto-effect fires once and can never fire
     * again (it needs `idle`). Before the fix this screen carried a sentence
     * and NO control, and the only exit was killing the app.
     */
    expect(s.shows('Séra ne répond pas.')).toBe(true);
    await s.press('Réessayer');

    expect(w.calls.filter((c) => c.path === '/rider/custody/begin')).toHaveLength(2);
    expect(s.canPress('En route'), 'the retry must actually open the road').toBe(true);
  });
});

describe('⚠ PORTE-SANS-PHOTO — arrival goes straight to the buyer’s code', () => {
  async function toTheDoor(routes: readonly Route[], state: CourseState) {
    state.ramassageConfirmeAt = '2026-08-10T10:00:00.000Z';
    state.codeVerification = PICKUP;
    state.codeScelle = SEAL;
    const { s, w } = await signedIn(routes);
    await s.press('Accepter la course');
    await s.press('Oui', 2);
    await s.press('Oui', 1);
    await s.press('Oui', 0);
    await s.press('Envoyer la vérification');
    await s.press('En route');
    await s.press('Je suis arrivé');
    return { s, w };
  }

  it('« Je suis arrivé » → the code screen, with no camera anywhere between', async () => {
    const state = freshCourse();
    const { s, w } = await toTheDoor([logistics(state), custody()], state);

    expect(s.shows('Prendre la photo'), 'there is no camera at the door').toBe(false);
    expect(s.shows('Le code de la cliente'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);

    // The bundle went by itself, carrying no artifact.
    const ev = w.calls.find((c) => c.path === '/rider/delivery/evidence');
    expect(ev, 'the delivery evidence was never sent').toBeDefined();
    expect((ev?.body?.['bundle'] as Record<string, unknown>)['artifacts']).toEqual([]);

    // …and the buyer's code finishes it.
    await s.type(DROP);
    await s.press('Confirmer la remise');
    expect(s.shows('Livré. Merci.')).toBe(true);
  });


  it('⚠ a ROTATED rider code at the door is not a dead end — the verifier’s blocker, driven', async () => {
    const state = freshCourse();
    let evidences = 0;
    const { s, w } = await toTheDoor(
      [
        logistics(state),
        custody({
          onEvidence: () => {
            evidences += 1;
            // The console rotated their code between the road and the door.
            return evidences === 1
              ? { status: 401, json: { error: 'unauthorized' } }
              : { status: 200, json: { ok: true, status: 'evidence_recorded' } };
          },
        }),
      ],
      state,
    );

    /**
     * Before the fix the retry rendered on `tone === 'waiting'` only, so a 401
     * — tone `refused` — left the rider with a sentence and no control, and
     * the effect could never re-fire. Signing back in changed nothing. The
     * delivery could not be completed on that phone.
     */
    expect(s.shows('Ce code ne marche pas.')).toBe(true);
    await s.press('Réessayer');

    expect(w.calls.filter((c) => c.path === '/rider/delivery/evidence')).toHaveLength(2);
    expect(s.shows('Le code de la cliente'), 'the retry must open the code screen').toBe(true);
  });
});
