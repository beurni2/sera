import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';
import { __modeChargement } from './doubles/expo-audio';

/**
 * ═══ RENDU-PORTE — the §6.3 door stage on the WIRED road, DRIVEN ═══
 *
 * PORTE-CUSTODY part C (founder-approved 2026-08-14). A pay-at-door course
 * inserts ONE screen between the arrival's evidence and the buyer's code:
 * the rider records that the buyer ACCEPTS the package. These walks answer
 * the four questions over the REAL screens and the REAL ports (nothing of
 * the app stubbed; only `globalThis.fetch` faked): does the inspection
 * screen show with its accept control pressable · does the accept actually
 * CALL the port with the fixed contract · is the code entry reachable after
 * the held accord · and is the `door_payment_not_confirmed` wait an honest,
 * usable state that a retry actually leaves once the buyer has paid.
 *
 * ⚠ THE FAKE IS CONTRACT-CERTIFIED TO custody-do.ts, never kinder:
 * `priorFor`/`commit` record REFUSALS too and replay them VERBATIM for the
 * same command_id (`replayOutcome`, duplicate:true) — so a retry that
 * reused its command id after a 409 could never reach « Livré », here or
 * live. The 409 reasons are the spine's own (`custody-spine.ts`:
 * `inspection_not_accepted` · `door_payment_not_confirmed` ·
 * `inspection_already_recorded`), and the drop's door gates run only for
 * the door mode, exactly as the spine guards them. What this fake does NOT
 * model (the standing rendu-course bound): the founder-validation leg
 * (`not_validated`) — the cross-service seam test owns the whole ladder.
 */

const CODE = 'SR-ABCD-EFGH-JKMN';
const ORDER = 'ord-rendu-porte-1';
const SEAL = 'SC-4K7M-9PQR';
const PICKUP = 'K7M-9PQ';
const DROP = 'DROP-RENDU-PORTE';

interface CourseState {
  status: 'active_unacknowledged' | 'acknowledged';
  ramassageConfirmeAt: string | null;
  codeVerification: string | null;
  codeScelle: string | null;
  paymentMode: string | null;
}

function logistics(state: CourseState): Route {
  return (path) => {
    if (path === '/rider/moi') {
      return {
        status: 200,
        json: {
          ok: true,
          rider: {
            riderId: 'rider-porte', displayName: 'Boss', certified: true, privacyAckOk: true,
            shift: { status: 'on_shift' },
            assignment: {
              assignmentId: 'as-porte-1', taskId: 'task-porte-1', orderId: ORDER, status: state.status,
              ackDeadline: null,
              location: { landmark: 'La pharmacie du marché', directions: 'Après le carrefour', zone: 'Gounghin, Ouagadougou' },
              // A §6.3 course carries the buyer's repère note like any other —
              // it was `null` here only because no walk had asked for it, and
              // « the voice reaches her door » cannot be proven over an absence.
              preuvePhotoRefs: [], repereAudioRef: 'media/11111111-2222-4333-8444-555555555555',
              codeRamassage: 'ABC-DEF',
              ramassageConfirmeAt: state.ramassageConfirmeAt,
              codeVerification: state.codeVerification,
              codeScelle: state.codeScelle,
              paymentMode: state.paymentMode,
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

interface DoorWorld {
  /** Has the provider-actored door signal landed at custody? The RIDER can
   *  never set this (SE-I11) — the test flips it as the provider. */
  paid: boolean;
  /** One inspection per attempt — the spine's own guard. */
  inspectionRecorded: boolean;
  /** custody-do's dedupe log: refusals commit too, and a same-command_id
   *  redelivery replays the recorded answer VERBATIM (+duplicate). */
  recorded: Map<string, { status: number; json: Record<string, unknown> }>;
}

function custody(state: CourseState, world: DoorWorld): Route {
  const commit = (id: string, answer: { status: number; json: Record<string, unknown> }) => {
    world.recorded.set(id, answer);
    return answer;
  };
  const replay = (id: string): { status: number; json: Record<string, unknown> } | null => {
    const prior = world.recorded.get(id);
    return prior === null || prior === undefined
      ? null
      : { status: prior.status, json: { ...prior.json, duplicate: true } };
  };
  return (path, body) => {
    if (path === '/rider/verification') {
      return { status: 200, json: { ok: true, kind: 'accepted', ledgerSeq: 1, chainValid: true } };
    }
    if (path === '/rider/custody/begin') {
      return {
        status: 200,
        json: { ok: true, status: 'custody_with_courier', chain: { task_id: 'task-porte-1', package_id: 'pkg-porte-1' } },
      };
    }
    if (path === '/rider/transit/depart') return { status: 200, json: { ok: true, status: 'departed' } };
    if (path === '/rider/transit/arrive') return { status: 200, json: { ok: true, status: 'arrived' } };
    if (path === '/rider/delivery/evidence') return { status: 200, json: { ok: true, status: 'evidence_recorded' } };
    if (path === '/rider/door/inspection') {
      const id = String(body?.['command_id']);
      const prior = replay(id);
      if (prior !== null) return prior;
      if (world.inspectionRecorded) {
        return commit(id, { status: 409, json: { ok: false, reason: 'inspection_already_recorded' } });
      }
      world.inspectionRecorded = true;
      return commit(id, { status: 200, json: { ok: true, kind: 'accepted' } });
    }
    if (path === '/rider/delivery/drop') {
      const id = String(body?.['command_id']);
      const prior = replay(id);
      if (prior !== null) return prior;
      // The spine's door gates, mode-guarded exactly as shipped
      // (custody-spine.ts: only DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR awaits
      // the inspection and the provider's door signal).
      if (state.paymentMode === 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR') {
        if (!world.inspectionRecorded) {
          return commit(id, { status: 409, json: { ok: false, reason: 'inspection_not_accepted' } });
        }
        if (!world.paid) {
          return commit(id, { status: 409, json: { ok: false, reason: 'door_payment_not_confirmed' } });
        }
      }
      return commit(id, { status: 200, json: { ok: true, status: 'custody_with_customer' } });
    }
    return null;
  };
}

const freshWorld = (): DoorWorld => ({ paid: false, inspectionRecorded: false, recorded: new Map() });
const courseInMode = (paymentMode: string): CourseState => ({
  status: 'active_unacknowledged',
  ramassageConfirmeAt: '2026-08-14T10:00:00.000Z',
  codeVerification: PICKUP,
  codeScelle: SEAL,
  paymentMode,
});

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

/** The whole road to the door: sign in → accept → checks → verification
 *  (the seal fires itself) → « En route » → « Je suis arrivé ». */
async function toTheDoor(routes: readonly Route[]) {
  const w = wire(routes);
  const s = await mountRider();
  await s.type(CODE);
  await s.press('Entrer');
  await s.press('Accepter la course');
  await s.press('Oui', 2);
  await s.press('Oui', 1);
  await s.press('Oui', 0);
  await s.press('Envoyer la vérification');
  await s.press('En route');
  await s.press('Je suis arrivé');
  return { s, w };
}

describe('⚠ PORTE-CUSTODY — the door course walks: accord → wait for the payment → code → livré', () => {
  it('the inspection screen precedes the code, the accept fires the fixed contract, and the held accord opens the code entry', async () => {
    const state = courseInMode('DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR');
    const world = freshWorld();
    const { s, w } = await toTheDoor([logistics(state), custody(state, world)]);

    // The door stage is ON screen, its primary act pressable — and the
    // buyer's code is NOT reachable around it.
    expect(s.shows('La cliente regarde le colis.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.canPress("La cliente est d'accord"), 'the accept must be present AND pressable').toBe(true);
    expect(s.shows('Le code de la cliente'), 'the code entry must wait for the accord').toBe(false);

    /**
     * ⚠ AND THE PAY-AT-DOOR ARM CARRIES THE REPÈRE EXACTLY ONCE, WITH ITS VOICE
     * (founder, 2026-08-15). The FULL_PREPAY road proved both in
     * `rendu-course`; this arm is only reachable on a §6.3 course and had no
     * walk of its own, so a second card or a lost voice could have come back
     * here alone.
     */
    const { LandmarkCard } = await import('../src/ui/faso-kit');
    expect(s.tree.root.findAllByType(LandmarkCard), 'the written repère, once').toHaveLength(1);
    expect(s.canPress('Écouter le repère'), 'the buyer’s voice, at her own door').toBe(true);

    await s.press("La cliente est d'accord");

    // The port was CALLED (the question source scans cannot answer), with
    // the FIXED contract byte for byte — conservative category (founder
    // decision (b)), the accept road's facts, refusalColumn absent.
    const act = w.calls.find((c) => c.path === '/rider/door/inspection');
    expect(act, 'the inspection act was never called — a dead primary action').toBeDefined();
    expect(act?.body).toMatchObject({
      orderId: ORDER,
      inspectionCategory: 'uncategorised_conservative',
      packageOpened: false,
      manufacturerSealOpened: false,
      custodySealIntact: true,
      buyerAccepts: true,
      evidenceBundleId: `sans-photo-porte-${ORDER}`,
    });
    expect(act?.body?.['startedAt']).toBe(act?.body?.['completedAt']);
    expect(Object.keys(act?.body ?? {})).not.toContain('refusalColumn');

    // The held accord opens the code entry — the next step is REACHED.
    expect(s.shows('Le code de la cliente'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
  });

  it('⚠ the unpaid drop is an honest WAIT, and the retry after the provider’s signal really delivers', async () => {
    const state = courseInMode('DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR');
    const world = freshWorld();
    const { s, w } = await toTheDoor([logistics(state), custody(state, world)]);
    await s.press("La cliente est d'accord");

    // The buyer has not paid yet — the code refuses BY NAME, in the money
    // register's calm: who pays, where, and that the code will then work.
    await s.type(DROP);
    await s.press('Confirmer la remise');
    expect(s.shows("Le paiement n'est pas encore confirmé"), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('La cliente paie sur sa page de commande.'), 'the wait must say who pays and where').toBe(true);
    // The tree survived, and the way out is the SAME control, still usable.
    expect(s.canPress('Confirmer la remise'), 'the send must stay usable through the wait').toBe(true);
    expect(s.shows('Livré. Merci.'), 'nothing may deliver while the provider is silent').toBe(false);

    // The provider confirms the door leg (never the rider — SE-I11)…
    world.paid = true;
    await s.press('Confirmer la remise');

    // …and the SAME button now finishes the course.
    expect(s.shows('Livré. Merci.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);

    // ⚠ THE RETRY WAS A FRESH COMMAND. custody-do commits refusals and
    // replays them verbatim for a reused command_id — an app that held its
    // id through the 409 could NEVER deliver (this fake enforces exactly
    // that), so « réessayez — le code marchera » is proven, not promised.
    const drops = w.calls.filter((c) => c.path === '/rider/delivery/drop');
    expect(drops).toHaveLength(2);
    expect(drops[0]?.body?.['command_id']).not.toBe(drops[1]?.body?.['command_id']);
  });

  it('⚠ a FULL_PREPAY course NEVER meets the inspection screen — the mode gate’s negative, driven', async () => {
    const state = courseInMode('FULL_PREPAY');
    const world = freshWorld();
    const { s, w } = await toTheDoor([logistics(state), custody(state, world)]);

    // Straight to the buyer's code: no accord screen, no accord act, ever.
    expect(s.shows('Le code de la cliente'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('La cliente regarde le colis.'), 'the inspection screen must not exist off the door mode').toBe(false);
    expect(s.shows("La cliente est d'accord")).toBe(false);
    expect(w.calls.some((c) => c.path === '/rider/door/inspection'), 'no inspection act may fire off the door mode').toBe(false);

    // And the course still finishes exactly as before this slice.
    await s.type(DROP);
    await s.press('Confirmer la remise');
    expect(s.shows('Livré. Merci.')).toBe(true);
  });
});
