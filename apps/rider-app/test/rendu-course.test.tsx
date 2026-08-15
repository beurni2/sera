import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';
// The SAME instance the app's `require('expo-audio')` shim holds (setup.ts
// captures it before any `vi.resetModules()`), so the mode set here is the
// mode the mounted screen's own player actually meets — the `__resetFiles`
// precedent, on the audio boundary.
import { __modeChargement } from './doubles/expo-audio';

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
  /** The SE1 ladder's last rung. A rider can drop off it mid-course. */
  shift: 'on_shift' | 'off_shift';
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
            shift: { status: state.shift },
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
  shift: 'on_shift',
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  __resetFiles();
  // A failing-load mode left armed by one test must never decide another.
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
     *
     * ⚠ AND SINCE 2026-08-15 THE ACCEPT NO LONGER FIRES THE STOP EFFECT — the
     * row follows the rider onto the road, so `repereVisible` stays true across
     * this tap. This walk therefore still proves what its title says (the tap
     * does not blank the tree) but no longer exercises the passive effect that
     * caused it. « The voice stops when the row leaves the screen », below,
     * is the walk that drives that effect now.
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

  /**
   * ═══ AND IT IS NOT A DEAD END (verifier BLOCKER, 2026-08-12) ═══
   *
   * « Livré. Merci. » was the last thing a real rider could do. The celebration's
   * only handler was `() => void 0`, there is no timer, the stack is `[START]` so
   * the header carries no back, and the footer and tab bar are `!WIRED`. Every
   * delivery ended on an inert screen whose only live control was SOS.
   *
   * The first fix edited the `delivered` screen — which lives in the DEMO arm and
   * a wired build never renders. This walk mounts the WIRED tree, which is the
   * one a rider installs, and presses the way out.
   */
  it('⚠ « Livré. Merci. » is NOT a dead end — the rider closes it and is back in service', async () => {
    const state = freshCourse();
    const { s } = await toTheDoor([logistics(state), custody()], state);
    await s.type(DROP);
    await s.press('Confirmer la remise');
    expect(s.shows('Livré. Merci.'), 'the delivery landed').toBe(true);

    // The screen SAYS where the tap lands, before he taps it.
    expect(s.shows('Vous revenez en service, prêt pour une autre course.')).toBe(true);
    // …and the way out is present AND pressable — not a hidden gesture on a scrim.
    expect(s.canPress('Revenir en service'), 'a named way out must be tappable').toBe(true);

    /**
     * ═══ AND IT IS NOT COVERED. STRUCTURE, NOT APPEARANCE ═══
     *
     * The three assertions above were ALL GREEN while the button was invisible.
     * `Celebration`'s scrim is `absoluteFillObject` over an opaque ground, so the
     * named action — first shipped as a SIBLING of `<FasoCelebration/>` inside the
     * same card — rendered underneath it: present in the tree, pressable to a
     * renderer that has no layout, and unfindable under a real thumb. « Tap
     * anywhere on the scrim » was the only exit a rider could actually see, which
     * is the failure this whole test was written to stop, one step quieter.
     *
     * This does NOT read a style — the walk may never claim a colour, a size or a
     * layout, and a check that asserted the scrim's `position` would be exactly
     * that. It asks a TREE question instead: is the way out INSIDE the
     * celebration? Everything inside the scrim renders on top of it; everything
     * beside it is covered. Component identity, no appearance claimed.
     */
    const { Celebration } = await import('../src/ui/faso-kit');
    const celebration = s.tree.root.findByType(Celebration);
    const wayOutInside = celebration.findAll((n) => n.props['label'] === 'Revenir en service');
    expect(wayOutInside.length, 'the named way out must live INSIDE the celebration, never beside it').toBe(1);

    await s.press('Revenir en service');

    // The celebration is gone: he is back on his live view, available.
    expect(s.shows('Livré. Merci.'), 'the closing screen was left, not repainted').toBe(false);
    s.unmount();
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

/**
 * ═══ ⚠ REPÈRE-ROUTE — one written repère, and the voice for the WHOLE road ═══
 *
 * FOUNDER, 2026-08-15, on the « En route vers la cliente » screen: « the
 * written repère is showing twice and the audio repère is absent ».
 *
 * Both were invisible to every source scan, and for the same reason: each is a
 * question about what is on screen AT ONCE in one arm of the tree, not about
 * what exists in the file. The landmark card is written twice in `App.tsx` —
 * once for the whole accepted course, once again inside the arrival arm — and
 * both are correct in isolation. The voice row was written once, in the
 * PROPOSAL arm only, so it vanished the moment the rider accepted; the file
 * has always contained it.
 *
 * These walks are written RED first, against the shipped tree.
 */
describe('⚠ REPÈRE-ROUTE — the repère is written once and can be heard all the way', () => {
  /** Signed in, course accepted, package verified and sealed: the road is open. */
  async function surLaRoute(state: CourseState) {
    state.ramassageConfirmeAt = '2026-08-10T10:00:00.000Z';
    state.codeVerification = PICKUP;
    state.codeScelle = SEAL;
    const { s } = await signedIn([logistics(state), custody()]);
    await s.press('Accepter la course');
    await s.press('Oui', 2);
    await s.press('Oui', 1);
    await s.press('Oui', 0);
    await s.press('Envoyer la vérification');
    return s;
  }

  it('the road to the door carries ONE landmark card — never two of the same place', async () => {
    /**
     * A TREE question, not an appearance one: how many landmark cards did this
     * arm render? The walk may never claim where they sit or how they look —
     * only that the rider is being told the same place twice.
     */
    const { LandmarkCard } = await import('../src/ui/faso-kit');
    const state = freshCourse();
    const s = await surLaRoute(state);

    expect(s.tree.root.findAllByType(LandmarkCard), 'the departure screen').toHaveLength(1);

    await s.press('En route');
    expect(s.shows('En route vers la cliente'), 'this is the founder’s screen').toBe(true);
    expect(
      s.tree.root.findAllByType(LandmarkCard),
      'the founder’s screen renders the written repère twice',
    ).toHaveLength(1);
    s.unmount();
  });

  /**
   * ⚠ THE OTHER HALF OF THE SAME CHANGE, and the half that can hurt someone.
   * The voice row is governed by `repereVisible`, whose only job is to stop the
   * note when the row leaves the screen. Widening it to « there is a course »
   * would have left three arms — not certified, privacy not acknowledged, OFF
   * SHIFT — that render no row while a course exists: the buyer's voice would
   * keep playing out of the phone with nothing on screen to stop it, which is
   * verbatim the failure the effect was written for. This drives the rung a
   * rider can actually cross mid-course.
   */
  it('the voice STOPS when the row leaves the screen — going off shift mid-course', async () => {
    const state = freshCourse();
    state.status = 'acknowledged';
    const { s } = await signedIn([logistics(state), custody()]);

    await s.press('Écouter le repère');
    expect(s.shows('Pause'), 'the note is playing').toBe(true);

    // He ends his shift at the console; the 20 s poll brings it to the phone.
    state.shift = 'off_shift';
    await s.poll();

    expect(s.texts().length, 'the tree must survive the row leaving').toBeGreaterThan(0);
    expect(s.shows('Hors ligne.'), 'he is on the off-shift screen').toBe(true);
    expect(s.shows('Pause'), 'no control to stop it, and it is still playing').toBe(false);

    /**
     * ⚠ AND IT IS THE PLAYER THAT STOPPED, not merely the row that vanished.
     * The row's face comes from the player's own subscription, so a note still
     * running would come back reading « Pause ». It reads « Écouter ».
     */
    state.shift = 'on_shift';
    await s.poll();
    expect(s.canPress('Écouter le repère'), 'the row is back').toBe(true);
    expect(s.shows('Pause'), 'the note was left running under the off-shift screen').toBe(false);
    s.unmount();
  });

  it('the buyer’s voice stays reachable after accepting — road, arrival, door', async () => {
    const state = freshCourse();
    const s = await surLaRoute(state);

    expect(s.canPress('Écouter le repère'), 'once the package is sealed').toBe(true);
    await s.press('En route');
    expect(s.canPress('Écouter le repère'), 'on the road — the founder’s screen').toBe(true);
    await s.press('Je suis arrivé');
    expect(s.shows('Le code de la cliente'), 'the door was reached').toBe(true);
    expect(s.canPress('Écouter le repère'), 'at the door, where the address matters most').toBe(true);

    // …and it is not a dead row: it actually plays there.
    await s.press('Écouter le repère');
    expect(s.shows('Pause'), 'the row must play, not merely render').toBe(true);
    s.unmount();
  });
});

/**
 * ═══ ⚠ CLAVIER-CODE — the keyboard hid the field it was opened for ═══
 *
 * FOUNDER, 2026-08-15: « while typing the buyer's code in the sera app the
 * keyboard on my phone is hiding that section. »
 *
 * ⚠ WHAT THIS WALK MAY AND MAY NOT SAY. Occlusion is layout, and the bound
 * stated in `test/doubles/react-native.tsx` is absolute: there is no layout
 * here, so no test in this file can assert that the field is visible above a
 * keyboard. What it CAN ask is the tree question underneath it — is the field
 * INSIDE the container that yields to the keyboard, or beside it? That is the
 * same shape as the celebration's way-out check above, and it is the part that
 * a source scan gets wrong: `KeyboardAvoidingView` in the file proves nothing
 * about which subtree it wraps. The occlusion itself is confirmed on his phone.
 */
describe('⚠ CLAVIER-CODE — the buyer’s code field is inside the keyboard-aware container', () => {
  it('the field has a KeyboardAvoidingView ancestor, and a focus that moves the screen', async () => {
    const state = freshCourse();
    state.ramassageConfirmeAt = '2026-08-10T10:00:00.000Z';
    state.codeVerification = PICKUP;
    state.codeScelle = SEAL;
    const { s } = await signedIn([logistics(state), custody()]);
    await s.press('Accepter la course');
    await s.press('Oui', 2);
    await s.press('Oui', 1);
    await s.press('Oui', 0);
    await s.press('Envoyer la vérification');
    await s.press('En route');
    await s.press('Je suis arrivé');
    expect(s.shows('Le code de la cliente')).toBe(true);

    const fields = s.tree.root
      .findAllByType('TextInput' as never)
      .filter((i) => String(i.props['placeholder'] ?? '').includes('Le code reçu par la cliente'));
    expect(fields, 'exactly one code field').toHaveLength(1);
    const field = fields[0]!;

    let node = field.parent;
    let sheltered = false;
    while (node !== null && node !== undefined) {
      // `String` because a host node's type IS the tag name, while a component
      // node's is a function — comparing the two directly is a type error.
      if (String(node.type) === 'KeyboardAvoidingView') {
        sheltered = true;
        break;
      }
      node = node.parent;
    }
    expect(sheltered, 'the code field renders OUTSIDE any keyboard-aware container').toBe(true);

    /**
     * ⚠ WHAT THE NEXT TWO ASSERTIONS DO AND DO NOT PROVE. There is no
     * `createNodeMock` here, so a host ref is always null and the screen's
     * `scrollRef.current?.scrollToEnd(...)` short-circuits every time. So this
     * proves the field is WIRED to the screen and that neither path THROWS on a
     * null ref — it proves nothing about scrolling, which is layout, which is
     * his phone's answer.
     */
    expect(typeof field.props['onFocus'], 'the field must tell the screen it was focused').toBe('function');
    (field.props['onFocus'] as () => void)();

    // The keyboard rises while she reads her code out to him: an effect that
    // threw here would blank the tree the same way the accept tap once did,
    // and the rider would lose the course at the door.
    await s.type(DROP, 'Le code reçu par la cliente');
    // ⚠ Imported HERE, not at the top: `vi.resetModules()` runs before the
    // mount, so a static import would hold a different instance of the double
    // than the mounted app and this emit would reach nobody. The count is
    // asserted for the same reason — see the hook's own note.
    const { __emitKeyboard } = await import('./doubles/react-native');
    let reached = 0;
    await act(async () => {
      reached = __emitKeyboard('keyboardDidShow');
    });
    expect(reached, 'the screen is not listening for the keyboard at all').toBeGreaterThan(0);
    expect(s.texts().length, 'the tree must survive the keyboard rising').toBeGreaterThan(0);
    expect(s.canPress('Confirmer la remise'), 'and the send stays reachable').toBe(true);
    s.unmount();
  });
});

/**
 * ═══ ⚠ VOIX-MUETTE-2 — the repère that cannot load, DRIVEN (founder's iPhone, 2026-08-14) ═══
 *
 * expo-audio 1.1.1 says NOTHING about a failed load on iOS — no status, no
 * error, ever — so the row sat on « Écouter » forever with no message. The
 * port now carries a 10 s load watchdog (ported from the Shop+ reseller
 * app's voice-capture). This walk answers the four questions over the REAL
 * screen and the REAL port, with only the native module doubled in its
 * failing mode: did the tree survive an act that fired by itself · is the
 * primary action still pressable · is there a way out of the failure · can
 * the rider reach the next step (the note actually playing) after it.
 */
describe('⚠ VOIX-MUETTE-2 — a repère that cannot load is not an eternal « Écouter »', () => {
  it('the hung load names its failure, the row stays tappable, and the retry plays', async () => {
    // The founder's iPhone shape: a failed item emits NOTHING, ever.
    __modeChargement('silence');
    const state = freshCourse();
    const { s } = await signedIn([logistics(state), custody()]);

    await s.press('Écouter le repère');
    // Nothing has arrived and nothing ever will — but ten seconds have not
    // passed, so the row must not cry failure over a load that may be 2G-slow.
    expect(s.shows('La note ne se lit pas'), 'no failure line before the watchdog’s bound').toBe(false);

    // The 20 s poll advance crosses the 10 s watchdog: the failure fires BY
    // ITSELF, off a timer — exactly the class of automatic act that shipped
    // dead ends twice on 2026-08-10.
    await s.poll();

    // 1. The tree survived an act that fired outside any tap.
    expect(s.texts().length, 'the tree must survive the watchdog firing').toBeGreaterThan(0);
    // 3. The automatic act left a way out: the failure has a sentence…
    expect(s.shows('La note ne se lit pas. Vérifiez le réseau et réessayez.'),
      `the failure line must be on screen — on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    // 2. …and the primary action is present AND pressable, not a dead face.
    expect(s.canPress('Écouter le repère'), 'the row must offer the retry it asks for').toBe(true);

    // 4. The next step is REACHABLE: the network comes back, the retry plays.
    __modeChargement(null);
    await s.press('Écouter le repère');
    expect(s.shows('Pause'), 'the retry must actually play — « réessayez » must be a true sentence').toBe(true);
    expect(s.shows('La note ne se lit pas'), 'a playing note carries no failure line').toBe(false);
  });
});
