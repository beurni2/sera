import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';
import { __modeChargement } from './doubles/expo-audio';

/**
 * ═══ RENDU-RETOUR — the §6.4 ladder and the §6.5 road home on the WIRED
 * road, DRIVEN ═══
 *
 * RETOUR-VIVANT-1. Until this slice a wired rider at a door where the buyer
 * could not pay had ONE control: the buyer's code. No refusal, no window, no
 * return — the demo shell's R12/R13 screens existed and the wired arm never
 * rendered them. These walks answer the four questions over the REAL screens
 * and the REAL ports (nothing of the app stubbed; only `globalThis.fetch`
 * faked): is « Un souci ? » present and pressable at the door · does a reason
 * actually CALL the refusal act with the fixed contract · is the window an
 * honest, usable state the rider can leave both ways · does the road home
 * reach « Colis rendu au vendeur » on the ledger's word, with both keys the
 * SESSION carried and none the rider typed.
 *
 * ⚠ THE FAKE IS CONTRACT-CERTIFIED TO custody-do.ts, never kinder:
 * refusals commit and replay VERBATIM for the same command_id (so an app that
 * held its id through `window_not_expired` or `return_two_key_refused` could
 * never get past them, here or live); the ladder's answers are the spine's
 * own (`window_opened` with the outcome's `windowExpiresAt` · `ladder_already_
 * open` · `window_not_expired` · `window_expired` into `return` or
 * `reschedule` by the canon escalation split · `no_valid_rejection` ·
 * `return_not_open` · `return_two_key_refused` burning nothing); the handover
 * opens ONLY on the exact pair the test armed as logistics would. What it does
 * NOT model (the standing rendu-course bound): the wires between the two
 * Workers — the cross-Worker seam test in logistics-service/test owns those.
 */

const CODE = 'SR-ABCD-EFGH-JKMN';
const ORDER = 'ord-rendu-retour-1';
const SEAL = 'SC-4K7M-9PQR';
/** The NEW return seal (§6.4), minted by logistics beside the outbound one. */
const RETSEAL = 'RS-7Q2N-4KPM';
const PICKUP = 'K7M-9PQ';
const DROP = 'DROP-RENDU-RETOUR';
/** The two return keys, in the minted `XXX-XXX` shape the session parser admits. */
const CLE_COURSIER = 'RTR-K7M';
const CLE_VENDEUR = 'F2N-8QW';
const WINDOW_END = '2026-09-17T09:15:00.000Z';
const ESCALATING = ['insufficient_balance', 'change_of_mind', 'repeated_abuse', 'fraud'];
const TAXONOMY = [...ESCALATING, 'honest_absence', 'unusable_location', 'provider_failure'];

interface CourseState {
  status: 'active_unacknowledged' | 'acknowledged';
  paymentMode: string;
  /** Logistics' half of the return handshake, exactly as `/rider/moi` carries it. */
  codeRetour: string | null;
  retourConfirmeAt: string | null;
  codeRetourFournisseur: string | null;
  /** The course-retournée wire closed the course: `/rider/moi` answers no assignment. */
  closed: boolean;
  /** REPROGRAMMATION-1 — logistics' word on the attempt, the window it names,
   *  and the chain ids custody was opened with (null = an older Worker). */
  passage: number;
  window: { start: string; end: string } | null;
  chaine: { taskId: string; packageId: string } | null;
}

function logistics(state: CourseState): Route {
  return (path) => {
    if (path === '/rider/moi') {
      return {
        status: 200,
        json: {
          ok: true,
          rider: {
            riderId: 'rider-retour', displayName: 'Boss', certified: true, privacyAckOk: true,
            shift: { status: 'on_shift' },
            assignment: state.closed
              ? null
              : {
                  assignmentId: 'as-retour-1', taskId: 'task-retour-1', orderId: ORDER, status: state.status,
                  ackDeadline: null,
                  location: { landmark: 'La pharmacie du marché', directions: 'Après le carrefour', zone: 'Gounghin, Ouagadougou' },
                  preuvePhotoRefs: [], repereAudioRef: null,
                  codeRamassage: 'ABC-DEF',
                  ramassageConfirmeAt: '2026-09-17T08:00:00.000Z',
                  codeVerification: PICKUP,
                  codeScelle: SEAL,
                  codeScelleRetour: RETSEAL,
                  paymentMode: state.paymentMode,
                  codeRetour: state.codeRetour,
                  retourConfirmeAt: state.retourConfirmeAt,
                  codeRetourFournisseur: state.codeRetourFournisseur,
                  passage: state.passage,
                  window: state.window,
                  chaine: state.chaine,
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

interface RetourWorld {
  inspectionRecorded: boolean;
  validRejection: boolean;
  /** The ONE window, by its reason — null until a refusal was recorded. */
  ladder: { reason: string } | null;
  /** Custody's clock says the window has passed. The TEST moves it, as time would. */
  expired: boolean;
  expiredInto: 'return' | 'reschedule' | null;
  returnOpen: boolean;
  /** The delivery evidence is ON the ledger (one bundle, held once — the
   *  spine refuses a second by name, BEFORE it even reads the ids). */
  preuveTenue: boolean;
  /** Logistics' arm landed on custody: the exact pair the handover must present. */
  armed: { seller: string; rider: string } | null;
  returned: boolean;
  recorded: Map<string, { status: number; json: Record<string, unknown> }>;
}

function custody(world: RetourWorld): Route {
  const commit = (id: string, answer: { status: number; json: Record<string, unknown> }) => {
    world.recorded.set(id, answer);
    return answer;
  };
  const replay = (id: string): { status: number; json: Record<string, unknown> } | null => {
    const prior = world.recorded.get(id);
    return prior === null || prior === undefined ? null : { status: prior.status, json: { ...prior.json, duplicate: true } };
  };
  return (path, body) => {
    if (path === '/rider/verification') return { status: 200, json: { ok: true, kind: 'accepted', ledgerSeq: 1, chainValid: true } };
    if (path === '/rider/custody/begin') {
      return { status: 200, json: { ok: true, status: 'custody_with_courier', chain: { task_id: 'task-retour-1', package_id: 'pkg-retour-1' } } };
    }
    if (path === '/rider/transit/depart') return { status: 200, json: { ok: true, status: 'departed' } };
    if (path === '/rider/transit/arrive') return { status: 200, json: { ok: true, status: 'arrived' } };
    if (path === '/rider/delivery/evidence') {
      // custody-spine.ts: `evidence_already_submitted` is judged FIRST — a
      // held bundle answers so whatever ids the second submission names.
      if (world.preuveTenue) return { status: 409, json: { ok: false, reason: 'evidence_already_submitted' } };
      world.preuveTenue = true;
      return { status: 200, json: { ok: true, status: 'evidence_recorded' } };
    }
    const id = String(body?.['command_id']);
    const prior = replay(id);
    if (path === '/rider/door/inspection') {
      if (prior !== null) return prior;
      if (world.inspectionRecorded) return commit(id, { status: 409, json: { ok: false, reason: 'inspection_already_recorded' } });
      world.inspectionRecorded = true;
      if (body?.['buyerAccepts'] === true) return commit(id, { status: 200, json: { ok: true, kind: 'accepted' } });
      if (body?.['refusalColumn'] !== 'valid') return commit(id, { status: 409, json: { ok: false, reason: 'refusal_column_missing' } });
      world.validRejection = true;
      // door-flow.ts: seal broken → Séra's fault, intact → the seller's.
      return commit(id, { status: 200, json: { ok: true, kind: 'valid_rejection', faultClass: body?.['custodySealIntact'] === true ? 'seller' : 'sera' } });
    }
    if (path === '/rider/door/refusal') {
      if (prior !== null) return prior;
      const reason = String(body?.['reasonCode']);
      if (!TAXONOMY.includes(reason)) return commit(id, { status: 409, json: { ok: false, reason: 'reason_not_in_taxonomy' } });
      if (world.ladder !== null) return commit(id, { status: 409, json: { ok: false, reason: 'ladder_already_open' } });
      world.ladder = { reason };
      return commit(id, {
        status: 200,
        json: { ok: true, kind: 'window_opened', outcome: { family: 'retry', reasonCode: reason, faultClass: 'buyer', attempt: { number: 1, windowExpiresAt: WINDOW_END } } },
      });
    }
    if (path === '/rider/door/expire') {
      if (prior !== null) return prior;
      if (world.ladder === null) return commit(id, { status: 409, json: { ok: false, reason: 'no_buyer_fault_refusal' } });
      if (!world.expired) return commit(id, { status: 409, json: { ok: false, reason: 'window_not_expired' } });
      const family = ESCALATING.includes(world.ladder.reason) ? 'return' : 'reschedule';
      world.expiredInto = family;
      return commit(id, {
        status: 200,
        json: { ok: true, kind: 'window_expired', outcome: { family, reasonCode: world.ladder.reason, faultClass: 'buyer', attempt: { number: 2 } } },
      });
    }
    if (path === '/rider/return/open') {
      if (prior !== null) return prior;
      if (!world.validRejection && world.expiredInto !== 'return') return commit(id, { status: 409, json: { ok: false, reason: 'no_valid_rejection' } });
      world.returnOpen = true;
      return commit(id, { status: 200, json: { ok: true, kind: 'return_opened' } });
    }
    if (path === '/rider/return/handover') {
      if (prior !== null) return prior;
      if (!world.returnOpen) return commit(id, { status: 409, json: { ok: false, reason: 'return_not_open' } });
      // Both-or-neither, and a refused pair burns nothing: the fake keeps the
      // armed pair intact, exactly as the registry checks before consuming.
      if (world.armed === null || body?.['sellerKey'] !== world.armed.seller || body?.['riderKey'] !== world.armed.rider) {
        return commit(id, { status: 409, json: { ok: false, reason: 'return_two_key_refused' } });
      }
      world.returned = true;
      return commit(id, { status: 200, json: { ok: true, kind: 'returned_to_supplier' } });
    }
    if (path === '/rider/delivery/drop') {
      if (prior !== null) return prior;
      if (world.returned) return commit(id, { status: 409, json: { ok: false, reason: 'custody_not_with_courier' } });
      return commit(id, { status: 200, json: { ok: true, status: 'custody_with_customer' } });
    }
    return null;
  };
}

const freshWorld = (): RetourWorld => ({
  inspectionRecorded: false, validRejection: false, ladder: null, expired: false, expiredInto: null,
  returnOpen: false, preuveTenue: false, armed: null, returned: false, recorded: new Map(),
});
const courseInMode = (paymentMode: string): CourseState => ({
  status: 'active_unacknowledged', paymentMode, codeRetour: null, retourConfirmeAt: null, codeRetourFournisseur: null, closed: false,
  passage: 1, window: null, chaine: null,
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

/** The whole road to the door: sign in → accept → checks → verification (the
 *  seal fires itself) → « En route » → « Je suis arrivé ». */
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

describe('⚠ RETOUR-VIVANT — the buyer-fault ladder, whole, then the road home on two machine-carried keys', () => {
  it('« Un souci ? » → a reason → the live window → retry at the door → expiry refused by the clock, then landed → « Préparer le retour » → the keys arrive on the session → both open the handover → « Colis rendu » → back in service', async () => {
    const state = courseInMode('FULL_PREPAY');
    const world = freshWorld();
    const { s, w } = await toTheDoor([logistics(state), custody(world)]);

    // The code card is on screen, and the ladder's door WHISPERS beside it.
    expect(s.shows('Le code de la cliente'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.canPress('Un souci ?'), 'the ladder must be reachable from the code card').toBe(true);

    await s.press('Un souci ?');
    expect(s.shows('Dis-nous ce qui bloque.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    for (const label of ['Client absent', 'Lieu introuvable', 'Argent pas prêt', 'Le client ne veut plus', 'Refus répétés', 'Tromperie', 'Panne du paiement']) {
      expect(s.canPress(label), `reason « ${label} » must be present and pressable`).toBe(true);
    }

    await s.press('Argent pas prêt');
    // The port was CALLED with the fixed contract — the canon id, no clock, no identity.
    const refusal = w.calls.find((c) => c.path === '/rider/door/refusal');
    expect(refusal, 'the refusal act was never called — a dead reason button').toBeDefined();
    expect(refusal?.body).toEqual({ orderId: ORDER, command_id: refusal?.body?.['command_id'], reasonCode: 'insufficient_balance' });

    // The window is an honest, usable state: the ledger's hour, two ways out.
    expect(s.shows('On attend un peu.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    const hour = new Date(WINDOW_END).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(s.shows(`Nouvel essai avant : ${hour}`), 'the hour must be the LEDGER’s windowExpiresAt').toBe(true);
    expect(s.canPress('Réessayer')).toBe(true);
    expect(s.canPress('Le temps est passé')).toBe(true);

    // « Réessayer » puts the rider back at the door, INSIDE the window: the
    // same code card, the hour still shown, expiry still reachable — and the
    // reason list is no longer offered (one window, ever).
    await s.press('Réessayer');
    expect(s.shows('Le code de la cliente'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    // The code card is the SAME card (its send wakes when a code is typed, as
    // rendu-porte walks it) — the retry inside the window is a real drop.
    await s.type(DROP);
    expect(s.canPress('Confirmer la remise')).toBe(true);
    expect(s.shows(`Nouvel essai avant : ${hour}`)).toBe(true);
    expect(s.canPress('Le temps est passé')).toBe(true);
    expect(s.shows('Un souci ?')).toBe(false);

    // The rider's tap cannot shorten the window: custody's clock refuses by
    // name, the sentence is the waiting one, and the same control stays usable.
    await s.press('Le temps est passé');
    expect(s.shows('Le délai court encore.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows("Attendez l'heure indiquée")).toBe(true);
    expect(s.canPress('Le temps est passé'), 'the expiry must stay pressable through the wait').toBe(true);

    // Time passes on custody's clock (never the phone's) — the retry lands.
    world.expired = true;
    await s.press('Le temps est passé');
    expect(s.shows("La livraison s'arrête ici."), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Les frais de course restent pris.'), 'the money register: the fee’s fate, stated').toBe(true);
    expect(s.shows('Le colis retourne au vendeur.')).toBe(true);
    expect(s.canPress('Préparer le retour')).toBe(true);
    // ⚠ The retry after `window_not_expired` was a FRESH command — custody
    // replays refusals verbatim for a reused id, so a held id could never land.
    const expiries = w.calls.filter((c) => c.path === '/rider/door/expire');
    expect(expiries).toHaveLength(2);
    expect(expiries[0]?.body?.['command_id']).not.toBe(expiries[1]?.body?.['command_id']);
    expect(Object.keys(expiries[1]?.body ?? {})).toEqual(['orderId', 'command_id']);

    // The NEW return seal is on screen for the rider to write on the bag —
    // and « Préparer le retour » presents THAT seal, never the outbound one.
    expect(s.shows(RETSEAL), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Mettez le colis dans un sac de retour')).toBe(true);
    await s.press('Préparer le retour');
    const opened = w.calls.find((c) => c.path === '/rider/return/open');
    expect(opened, 'the return-open act was never called').toBeDefined();
    expect(opened?.body).toEqual({ orderId: ORDER, command_id: opened?.body?.['command_id'], returnSealId: RETSEAL });
    expect(opened?.body?.['returnSealId']).not.toBe(SEAL);
    expect(s.shows('Rendre le colis au vendeur'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    // Logistics has not minted the keys yet: an honest wait, no key invented.
    expect(s.shows('Séra prépare votre code de retour')).toBe(true);
    expect(s.shows('Échanger les deux codes')).toBe(false);

    // The fifth wire crossed: logistics minted the rider's key — the poll
    // brings it. The seller's is NOT there yet, and the button does not exist.
    state.codeRetour = CLE_COURSIER;
    await s.poll();
    expect(s.shows(CLE_COURSIER), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Dites ce code au vendeur.')).toBe(true);
    expect(s.shows('On attend que le vendeur confirme votre code.')).toBe(true);
    expect(s.shows('Échanger les deux codes'), 'no handover button before the supplier’s word').toBe(false);
    expect(s.shows(CLE_VENDEUR)).toBe(false);

    // The supplier typed the rider's code on his console: logistics releases
    // his key onto the session, and the ONE primary act appears.
    state.retourConfirmeAt = '2026-09-17T09:30:00.000Z';
    state.codeRetourFournisseur = CLE_VENDEUR;
    await s.poll();
    expect(s.shows('Le vendeur a confirmé.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.canPress('Échanger les deux codes')).toBe(true);

    // Logistics' arm has not landed on custody yet: the pair refuses BY NAME,
    // burns nothing, and the same control stays usable.
    await s.press('Échanger les deux codes');
    expect(s.shows("Les deux codes n'ont pas ouvert."), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Le colis reste avec vous.')).toBe(true);
    expect(s.canPress('Échanger les deux codes'), 'the handover must stay usable through the wait').toBe(true);
    expect(s.shows('Colis rendu au vendeur.')).toBe(false);

    // The arm lands — the SAME button finishes the road home.
    world.armed = { seller: CLE_VENDEUR, rider: CLE_COURSIER };
    await s.press('Échanger les deux codes');
    expect(s.shows('Colis rendu au vendeur.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.canPress('Revenir en service')).toBe(true);
    // BOTH keys, from the SESSION, in one act — and the retry was a fresh command.
    const handovers = w.calls.filter((c) => c.path === '/rider/return/handover');
    expect(handovers).toHaveLength(2);
    expect(handovers[1]?.body).toEqual({
      orderId: ORDER, command_id: handovers[1]?.body?.['command_id'], sellerKey: CLE_VENDEUR, riderKey: CLE_COURSIER,
    });
    expect(handovers[0]?.body?.['command_id']).not.toBe(handovers[1]?.body?.['command_id']);
    // The buyer's code was never presented on this road.
    expect(w.calls.some((c) => c.path === '/rider/delivery/drop')).toBe(false);

    // Logistics closed the course off the sixth wire; « Revenir en service »
    // re-asks the session and the rider is back where a new course can land.
    state.closed = true;
    await s.press('Revenir en service');
    expect(s.shows('Colis rendu au vendeur.')).toBe(false);
    expect(s.shows('Rendre le colis au vendeur')).toBe(false);
    expect(w.calls.filter((c) => c.path === '/rider/moi').length).toBeGreaterThan(1);
  });

  it('a second reason inside the window is refused as the window it already has — never a second window', async () => {
    const state = courseInMode('FULL_PREPAY');
    const world = freshWorld();
    const { s, w } = await toTheDoor([logistics(state), custody(world)]);
    await s.press('Un souci ?');
    await s.press('Client absent');
    expect(s.shows('On attend un peu.')).toBe(true);
    // The reason list is gone from the door; the window is the door's state.
    await s.press('Réessayer');
    expect(s.shows('Un souci ?')).toBe(false);
    expect(w.calls.filter((c) => c.path === '/rider/door/refusal')).toHaveLength(1);
  });
});

/**
 * ═══ THE OS KILLS THE APP MID-RETURN (verifier BLOCKER, 2026-09-16) ═══
 *
 * Routine on a 1 GB Android: the rider rides twenty minutes back to the
 * supplier with the app backgrounded, and Android kills it. On relaunch the
 * act memory on disk (the file-system double, which survives the remount
 * exactly as the file survives a kill) and the session re-read from logistics
 * are all the phone has. Before the fix every one of these relaunched onto
 * the BUYER'S CODE CARD: the return key shown nowhere, the supplier unable to
 * confirm it, the package the rider's for ever.
 */
async function relaunch(s: Awaited<ReturnType<typeof mountRider>>, routes: readonly Route[]) {
  s.unmount();
  const w = wire(routes);
  const s2 = await mountRider();
  await s2.type(CODE);
  await s2.press('Entrer');
  return { s: s2, w };
}

describe('⚠ RETOUR-VIVANT — the road home survives a kill (verifier BLOCKER, closed)', () => {
  it('killed AFTER the return opened: relaunch lands on the return screen with the rider’s key — never the code card — and the handover still finishes', async () => {
    const state = courseInMode('FULL_PREPAY');
    const world = freshWorld();
    const first = await toTheDoor([logistics(state), custody(world)]);
    await first.s.press('Un souci ?');
    await first.s.press('Argent pas prêt');
    world.expired = true;
    await first.s.press('Le temps est passé');
    await first.s.press('Préparer le retour');
    expect(first.s.shows('Rendre le colis au vendeur')).toBe(true);
    // The fifth wire landed while the phone was in his pocket.
    state.codeRetour = CLE_COURSIER;

    const { s, w } = await relaunch(first.s, [logistics(state), custody(world)]);
    expect(s.shows('Rendre le colis au vendeur'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows(CLE_COURSIER), 'his return key must be back on screen').toBe(true);
    expect(s.shows('Le code de la cliente'), 'the buyer’s code card must NOT come back over an open return').toBe(false);
    expect(s.shows('Un souci ?')).toBe(false);
    // Nothing was re-opened: the return is already the ledger's.
    expect(w.calls.some((c) => c.path === '/rider/return/open')).toBe(false);

    state.retourConfirmeAt = '2026-09-17T09:30:00.000Z';
    state.codeRetourFournisseur = CLE_VENDEUR;
    world.armed = { seller: CLE_VENDEUR, rider: CLE_COURSIER };
    await s.poll();
    await s.press('Échanger les deux codes');
    expect(s.shows('Colis rendu au vendeur.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
  });

  it('killed BETWEEN the expiry and « Préparer le retour »: relaunch lands on « La livraison s’arrête ici » and the return can still be opened', async () => {
    const state = courseInMode('FULL_PREPAY');
    const world = freshWorld();
    const first = await toTheDoor([logistics(state), custody(world)]);
    await first.s.press('Un souci ?');
    await first.s.press('Le client ne veut plus');
    world.expired = true;
    await first.s.press('Le temps est passé');
    expect(first.s.shows("La livraison s'arrête ici.")).toBe(true);

    const { s, w } = await relaunch(first.s, [logistics(state), custody(world)]);
    expect(s.shows("La livraison s'arrête ici."), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.canPress('Préparer le retour'), 'the way home must survive the kill').toBe(true);
    expect(s.shows('Le code de la cliente')).toBe(false);
    await s.press('Préparer le retour');
    expect(w.calls.find((c) => c.path === '/rider/return/open')?.body).toMatchObject({ orderId: ORDER, returnSealId: RETSEAL });
    expect(s.shows('Rendre le colis au vendeur')).toBe(true);
  });

  it('killed after a VALID refusal at the door: relaunch lands on her refusal, not on « La cliente est d’accord »', async () => {
    const state = courseInMode('DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR');
    const world = freshWorld();
    const first = await toTheDoor([logistics(state), custody(world)]);
    await first.s.press('La cliente refuse le colis');
    await first.s.press('Non, abîmé');
    expect(first.s.shows("La cliente refuse le colis. C'est son droit.")).toBe(true);

    const { s, w } = await relaunch(first.s, [logistics(state), custody(world)]);
    expect(s.shows("La cliente refuse le colis. C'est son droit."), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Aucun frais pour la cliente.')).toBe(true);
    expect(s.shows("La cliente est d'accord"), 'the accept must not be re-offered over a recorded refusal').toBe(false);
    expect(s.shows('Le code de la cliente')).toBe(false);
    expect(s.canPress('Préparer le retour')).toBe(true);
    await s.press('Préparer le retour');
    expect(w.calls.some((c) => c.path === '/rider/return/open')).toBe(true);
  });

  it('killed after the window expired into RESCHEDULE: relaunch says « On repasse un autre jour », not the code card', async () => {
    const state = courseInMode('FULL_PREPAY');
    const world = freshWorld();
    const first = await toTheDoor([logistics(state), custody(world)]);
    await first.s.press('Un souci ?');
    await first.s.press('Client absent');
    world.expired = true;
    await first.s.press('Le temps est passé');
    const { s } = await relaunch(first.s, [logistics(state), custody(world)]);
    expect(s.shows('On repasse un autre jour.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Le code de la cliente')).toBe(false);
  });
});

describe('⚠ RETOUR-VIVANT — the non-escalating arm: honest absence reschedules, nothing is lost, no return opens', () => {
  it('« Client absent » → the window expires into « On repasse un autre jour » — the rider keeps the package, and no return act exists', async () => {
    const state = courseInMode('FULL_PREPAY');
    const world = freshWorld();
    const { s, w } = await toTheDoor([logistics(state), custody(world)]);
    await s.press('Un souci ?');
    await s.press('Client absent');
    world.expired = true;
    await s.press('Le temps est passé');
    expect(s.shows('On repasse un autre jour.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Le client garde sa commande.')).toBe(true);
    expect(s.shows('Gardez le colis avec vous.')).toBe(true);
    expect(s.shows('Préparer le retour'), 'no return on the reschedule arm').toBe(false);
    expect(s.shows('Les frais de course restent pris.'), 'no fee sentence on the reschedule arm').toBe(false);
    expect(w.calls.some((c) => c.path === '/rider/return/open')).toBe(false);
  });
});

describe('⚠ RETOUR-VIVANT — the buyer’s VALID refusal at a pay-at-door inspection', () => {
  it('« La cliente refuse le colis » → the one seal question → the inspection act carries the valid column → her right, the fault named, no fee → « Préparer le retour » opens the return', async () => {
    const state = courseInMode('DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR');
    const world = freshWorld();
    const { s, w } = await toTheDoor([logistics(state), custody(world)]);
    expect(s.shows('La cliente regarde le colis.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.canPress("La cliente est d'accord")).toBe(true);
    expect(s.canPress('La cliente refuse le colis'), 'her refusal must be as reachable as her accord').toBe(true);
    expect(s.canPress('Un souci ?')).toBe(true);

    await s.press('La cliente refuse le colis');
    expect(s.shows('Le scellé Séra est-il intact ?'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.canPress('Oui, intact')).toBe(true);
    expect(s.canPress('Non, abîmé')).toBe(true);

    await s.press('Non, abîmé');
    const act = w.calls.find((c) => c.path === '/rider/door/inspection');
    expect(act, 'the inspection act was never called on the refusal road').toBeDefined();
    expect(act?.body).toMatchObject({
      orderId: ORDER,
      inspectionCategory: 'uncategorised_conservative',
      packageOpened: false,
      manufacturerSealOpened: false,
      custodySealIntact: false,
      buyerAccepts: false,
      refusalColumn: 'valid',
      evidenceBundleId: `sans-photo-porte-${ORDER}`,
    });
    expect(Object.keys(act?.body ?? {})).not.toContain('at');

    // Her right, the fault the SERVICE derived (seal broken → Séra), no fee.
    expect(s.shows("La cliente refuse le colis. C'est son droit."), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('La faute est notée pour Séra')).toBe(true);
    expect(s.shows('Aucun frais pour la cliente.')).toBe(true);
    expect(s.shows('Les frais de course restent pris.'), 'the buyer-fault fee sentence must not appear on a valid refusal').toBe(false);
    expect(s.canPress('Préparer le retour')).toBe(true);

    await s.press('Préparer le retour');
    expect(w.calls.find((c) => c.path === '/rider/return/open')?.body).toMatchObject({ orderId: ORDER, returnSealId: RETSEAL });
    expect(s.shows('Rendre le colis au vendeur'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    // The buyer's code never entered this road.
    expect(w.calls.some((c) => c.path === '/rider/delivery/drop')).toBe(false);
  });

  it('with the seal intact, the fault is the seller’s — and the accept road still sends no refusal column', async () => {
    const state = courseInMode('DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR');
    const world = freshWorld();
    const { s, w } = await toTheDoor([logistics(state), custody(world)]);
    await s.press('La cliente refuse le colis');
    await s.press('Oui, intact');
    expect(w.calls.find((c) => c.path === '/rider/door/inspection')?.body).toMatchObject({ custodySealIntact: true, buyerAccepts: false, refusalColumn: 'valid' });
    expect(s.shows('La faute est notée pour le vendeur'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('La faute est notée pour Séra')).toBe(false);
  });
});

/** REPROGRAMMATION-1 — the founder fixed the next passage: what `/rider/moi`
 *  then carries, exactly as logistics-do's riderView says it. */
const PASSAGE_2 = { start: '2026-09-18T10:00:00.000Z', end: '2026-09-18T12:00:00.000Z' };
const CHAINE = { taskId: 'task-retour-1', packageId: `pkg-${ORDER}` };
const fenetreAttendue = (): string => {
  const jour = new Date(PASSAGE_2.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const h = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Prochain passage : ${jour}, ${h(PASSAGE_2.start)}–${h(PASSAGE_2.end)}`;
};
const passageFixe = (state: CourseState): void => {
  state.passage = 2;
  state.window = PASSAGE_2;
  state.chaine = CHAINE;
};

describe('⚠ REPROGRAMMATION-1 — the 2e passage reaches the rider’s phone, and the door road opens again', () => {
  it('« Client absent » → expiry → the poster says the next passage will show HERE → the founder fixes it (the poll brings it) → « 2e passage » with the window → no second ladder, the phone line instead → the code card is back → the buyer’s code lands the delivery', async () => {
    const state = courseInMode('FULL_PREPAY');
    const world = freshWorld();
    const { s, w } = await toTheDoor([logistics(state), custody(world)]);
    await s.press('Un souci ?');
    await s.press('Client absent');
    world.expired = true;
    await s.press('Le temps est passé');
    expect(s.shows('On repasse un autre jour.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    // Honest about what happens next: the passage arrives on this screen —
    // no longer « Séra vous appelle ».
    expect(s.shows('Vous verrez ici le prochain passage.')).toBe(true);
    expect(s.shows('Le code de la cliente')).toBe(false);

    // THE FOUNDER FIXED THE NEXT PASSAGE — logistics says passage 2 and the
    // window; the poll is how it reaches the phone.
    passageFixe(state);
    await s.poll();
    expect(s.shows('2e passage'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows(fenetreAttendue()), 'the window, in the rider’s own words').toBe(true);
    expect(s.shows('On repasse un autre jour.'), 'the poster yields to the door road').toBe(false);
    expect(s.shows('On attend un peu.'), 'the spent window is not re-offered').toBe(false);
    // The door road is back — and the ladder is NOT: one window per order.
    expect(s.shows('Le code de la cliente')).toBe(true);
    expect(s.canPress('Un souci ?')).toBe(false);
    expect(s.shows('Encore un souci ? Appelez Séra.')).toBe(true);
    // The buyer’s code, this time: the ordinary drop.
    await s.type(DROP);
    expect(s.canPress('Confirmer la remise')).toBe(true);
    await s.press('Confirmer la remise');
    const drop = w.calls.find((c) => c.path === '/rider/delivery/drop');
    expect(drop?.body).toMatchObject({ orderId: ORDER, dropCode: DROP });
    expect(s.shows('Livré. Merci.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
  });

  it('killed between the expiry and the 2e passage (another day, a relaunched app): relaunch lands on the door with « 2e passage » — the evidence composes from the SESSION’s chain ids, is told it is held, and the delivery finishes', async () => {
    const state = courseInMode('FULL_PREPAY');
    const world = freshWorld();
    const first = await toTheDoor([logistics(state), custody(world)]);
    await first.s.press('Un souci ?');
    await first.s.press('Client absent');
    world.expired = true;
    await first.s.press('Le temps est passé');
    expect(first.s.shows('On repasse un autre jour.')).toBe(true);
    expect(world.preuveTenue, 'the first passage held the evidence').toBe(true);

    passageFixe(state);
    const { s, w } = await relaunch(first.s, [logistics(state), custody(world)]);
    expect(s.shows('2e passage'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows(fenetreAttendue())).toBe(true);
    expect(s.shows('On repasse un autre jour.')).toBe(false);
    // The remise composed WITHOUT this session’s seal answer: the ids are the
    // session’s `chaine` (what logistics opened custody with), the seal the
    // session’s — and custody’s « already submitted » reads as held.
    const evidence = w.calls.find((c) => c.path === '/rider/delivery/evidence');
    expect(evidence, 'the evidence never re-composed after the relaunch — « il manque des repères » for good').toBeDefined();
    expect(evidence?.body?.['bundle']).toMatchObject({ taskId: CHAINE.taskId, packageId: CHAINE.packageId, custodySealId: SEAL });
    expect(s.shows('il manque des repères'), 'never the honest-but-dead card when the session carries the ids').toBe(false);
    expect(s.shows('Le code de la cliente'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.canPress('Un souci ?')).toBe(false);
    await s.type(DROP);
    await s.press('Confirmer la remise');
    expect(s.shows('Livré. Merci.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
  });

  it('a session that carries NO chain ids after a relaunch keeps the honest card — nothing is guessed', async () => {
    const state = courseInMode('FULL_PREPAY');
    const world = freshWorld();
    const first = await toTheDoor([logistics(state), custody(world)]);
    await first.s.press('Un souci ?');
    await first.s.press('Client absent');
    world.expired = true;
    await first.s.press('Le temps est passé');
    state.passage = 2;
    state.window = PASSAGE_2;
    // chaine stays null: an older logistics Worker.
    const { s, w } = await relaunch(first.s, [logistics(state), custody(world)]);
    expect(s.shows('2e passage')).toBe(true);
    expect(w.calls.some((c) => c.path === '/rider/delivery/evidence')).toBe(false);
    expect(s.shows('Le code de la cliente')).toBe(false);
    // The honest card, with its way out (a phone call) — never a guessed id.
    expect(s.shows('il manque des repères'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Appelez Séra pour finir la remise.')).toBe(true);
  });
});
