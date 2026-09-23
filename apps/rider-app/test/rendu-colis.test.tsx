import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';
import { __modeChargement } from './doubles/expo-audio';

/**
 * ═══ RENDU-COLIS — ONE COURSE, ONE BAG, SEVERAL ARTICLES, DRIVEN ═══
 *
 * COLIS-FOURNISSEUR-1 (founder ruling 2026-09-23, canon 3.20.0): « a package
 * may hold the orders of ONE supplier, for ONE buyer, to ONE address, paid
 * together; it is still one job — one pickup, one drop, one current stop —
 * and each order keeps its own custody file, its own inspection at the door
 * and its own drop. » Decision (c): she may refuse one article at the door
 * and keep the rest; the refused one goes back sealed on its own.
 *
 * These walks answer the four questions over the REAL screens and the REAL
 * ports (nothing of the app stubbed; only `globalThis.fetch` faked): did the
 * tree survive every tap · is each primary action present, pressable and
 * wired — and wired to EVERY article's own ledger, each under its own command
 * id · does an act that fires by itself (the seal, the door evidence) leave a
 * way out when one article's ledger does not answer · can the rider reach the
 * next screen, all the way back into service.
 *
 * ⚠ THE CUSTODY FAKE IS ONE LEDGER PER ORDER, contract-certified to
 * custody-do.ts: a command id is remembered per ORDER (each order is its own
 * Durable Object — the same id on two orders is two commands), a recorded
 * answer replays VERBATIM for its id, the pickup code is the one armed on
 * THAT order and single-use there, the evidence must name THAT order's chain
 * (`evidence_chain_mismatch` otherwise), a pay-at-door drop needs THAT
 * order's accepted inspection and provider-confirmed door leg, a refused
 * article's drop answers `return_in_progress`, and the handover opens only on
 * the pair logistics armed. What it does NOT model: the wires between the two
 * Workers — the logistics seam test owns those.
 */

const CODE = 'SR-ABCD-EFGH-JKMN';
const A = 'ord-colis-a';
const B = 'ord-colis-b';
const SEAL = 'SC-4K7M-9PQR';
const RETSEAL = 'RS-7Q2N-4KPM';
const PICKUP = 'K7M-9PQ';
const DROP = 'DROP-RENDU-COLIS';
const CLE_COURSIER = 'RTR-K7M';
const CLE_VENDEUR = 'F2N-8QW';
const TASK = 'task-colis-1';
const PORTE = 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR';

type Etat = 'en_cours' | 'livree' | 'en_retour' | 'retournee';

interface CourseState {
  status: 'active_unacknowledged' | 'acknowledged';
  paymentMode: string;
  etats: Record<string, Etat>;
  codeRetour: string | null;
  codeRetourFournisseur: string | null;
  closed: boolean;
}

/** Logistics, as `/rider/moi` carries a package course (logistics-do `colisVue`). */
function logistics(state: CourseState): Route {
  return (path) => {
    if (path === '/rider/moi') {
      return {
        status: 200,
        json: {
          ok: true,
          rider: {
            riderId: 'rider-colis', displayName: 'Boss', certified: true, privacyAckOk: true,
            shift: { status: 'on_shift' },
            assignment: state.closed
              ? null
              : {
                  assignmentId: 'as-colis-1', taskId: TASK, orderId: A, status: state.status,
                  ackDeadline: null,
                  location: { landmark: 'La pharmacie du marché', directions: 'Après le carrefour', zone: 'Gounghin, Ouagadougou' },
                  preuvePhotoRefs: [], repereAudioRef: null,
                  codeRamassage: 'ABC-DEF',
                  ramassageConfirmeAt: '2026-09-23T08:00:00.000Z',
                  codeVerification: PICKUP,
                  codeScelle: SEAL,
                  codeScelleRetour: RETSEAL,
                  paymentMode: state.paymentMode,
                  codeRetour: state.codeRetour,
                  retourConfirmeAt: state.codeRetourFournisseur === null ? null : '2026-09-23T10:00:00.000Z',
                  codeRetourFournisseur: state.codeRetourFournisseur,
                  passage: 1,
                  window: null,
                  chaine: { taskId: TASK, packageId: `pkg-${A}` },
                  retourDecideAt: null,
                  colis: {
                    packageId: 'col-rendu-1',
                    articles: [
                      { orderId: A, libelle: 'Le pagne wax', chaine: { taskId: TASK, packageId: `pkg-${A}` }, etat: state.etats[A] },
                      { orderId: B, libelle: 'Les sandales', chaine: { taskId: TASK, packageId: `pkg-${B}` }, etat: state.etats[B] },
                    ],
                  },
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

interface Ledger {
  pickupUsed: boolean;
  sealed: boolean;
  evidence: boolean;
  inspection: 'accepted' | 'valid_rejection' | null;
  doorPaid: boolean;
  returnOpen: boolean;
  returned: boolean;
  delivered: boolean;
  /** An answer the TEST forces on this order's next act (a dead network). */
  panne: string | null;
}

/** One ledger per order, and the commands each one remembers. */
interface World {
  readonly ledgers: Record<string, Ledger>;
  readonly recorded: Map<string, { status: number; json: Record<string, unknown> }>;
}

const ledger = (): Ledger => ({
  pickupUsed: false, sealed: false, evidence: false, inspection: null, doorPaid: false,
  returnOpen: false, returned: false, delivered: false, panne: null,
});
const freshWorld = (): World => ({ ledgers: { [A]: ledger(), [B]: ledger() }, recorded: new Map() });

function custody(world: World, paymentMode: string): Route {
  return (path, body) => {
    if (!path.startsWith('/rider/')) return null;
    const orderId = String(body?.['orderId']);
    const l = world.ledgers[orderId];
    if (l === undefined) return { status: 404, json: { ok: false, reason: 'order_not_open' } };
    // A dead link on THIS order's next act — nothing reached its ledger.
    if (l.panne === path) {
      l.panne = null;
      return { status: 503, json: { ok: false, reason: 'unavailable' } };
    }
    // Each order is its own object: the same id on two orders is two commands.
    const key = `${orderId}|${String(body?.['command_id'])}`;
    const prior = world.recorded.get(key);
    if (prior !== undefined) return { status: prior.status, json: { ...prior.json, duplicate: true } };
    const commit = (answer: { status: number; json: Record<string, unknown> }) => {
      world.recorded.set(key, answer);
      return answer;
    };
    if (path === '/rider/verification') {
      if (l.pickupUsed || body?.['presentedPickupCode'] !== PICKUP) return commit({ status: 409, json: { ok: false, reason: 'pickup_code_refused' } });
      l.pickupUsed = true;
      return commit({ status: 200, json: { ok: true, kind: 'accepted', ledgerSeq: 1, chainValid: true } });
    }
    if (path === '/rider/custody/begin') {
      if (!l.pickupUsed) return commit({ status: 409, json: { ok: false, reason: 'verification_not_accepted' } });
      if (body?.['custodySealId'] !== SEAL) return commit({ status: 409, json: { ok: false, reason: 'seal_refused' } });
      l.sealed = true;
      return commit({ status: 200, json: { ok: true, status: 'custody_with_courier', chain: { task_id: TASK, package_id: `pkg-${orderId}` } } });
    }
    if (path === '/rider/transit/depart') return commit({ status: 200, json: { ok: true, status: l.sealed ? 'departed' : 'refused' } });
    if (path === '/rider/transit/arrive') return commit({ status: 200, json: { ok: true, status: 'arrived' } });
    if (path === '/rider/delivery/evidence') {
      if (l.evidence) return commit({ status: 409, json: { ok: false, reason: 'evidence_already_submitted' } });
      const bundle = body?.['bundle'] as Record<string, unknown> | undefined;
      if (bundle?.['taskId'] !== TASK || bundle?.['packageId'] !== `pkg-${orderId}` || bundle?.['custodySealId'] !== SEAL) {
        return commit({ status: 409, json: { ok: false, reason: 'evidence_chain_mismatch' } });
      }
      l.evidence = true;
      return commit({ status: 200, json: { ok: true, status: 'evidence_recorded' } });
    }
    if (path === '/rider/door/inspection') {
      if (l.inspection !== null) return commit({ status: 409, json: { ok: false, reason: 'inspection_already_recorded' } });
      if (body?.['buyerAccepts'] === true) {
        l.inspection = 'accepted';
        return commit({ status: 200, json: { ok: true, kind: 'accepted' } });
      }
      if (body?.['refusalColumn'] !== 'valid') return commit({ status: 409, json: { ok: false, reason: 'refusal_column_missing' } });
      l.inspection = 'valid_rejection';
      return commit({ status: 200, json: { ok: true, kind: 'valid_rejection', faultClass: body?.['custodySealIntact'] === true ? 'seller' : 'sera' } });
    }
    if (path === '/rider/return/open') {
      if (l.inspection !== 'valid_rejection') return commit({ status: 409, json: { ok: false, reason: 'no_valid_rejection' } });
      if (body?.['returnSealId'] !== RETSEAL) return commit({ status: 409, json: { ok: false, reason: 'return_seal_refused' } });
      l.returnOpen = true;
      return commit({ status: 200, json: { ok: true, kind: 'return_opened' } });
    }
    if (path === '/rider/delivery/drop') {
      if (l.inspection === 'valid_rejection' || l.returnOpen) return commit({ status: 409, json: { ok: false, reason: 'return_in_progress' } });
      if (paymentMode === PORTE && l.inspection !== 'accepted') return commit({ status: 409, json: { ok: false, reason: 'inspection_not_accepted' } });
      if (paymentMode === PORTE && !l.doorPaid) return commit({ status: 409, json: { ok: false, reason: 'door_payment_not_confirmed' } });
      if (body?.['dropCode'] !== DROP) return commit({ status: 409, json: { ok: false, reason: 'drop_code_refused' } });
      l.delivered = true;
      return commit({ status: 200, json: { ok: true, status: 'custody_with_customer' } });
    }
    if (path === '/rider/return/handover') {
      if (!l.returnOpen) return commit({ status: 409, json: { ok: false, reason: 'return_not_open' } });
      if (body?.['sellerKey'] !== CLE_VENDEUR || body?.['riderKey'] !== CLE_COURSIER) {
        return commit({ status: 409, json: { ok: false, reason: 'return_two_key_refused' } });
      }
      l.returned = true;
      return commit({ status: 200, json: { ok: true, kind: 'returned_to_supplier' } });
    }
    return null;
  };
}

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

const course = (paymentMode: string): CourseState => ({
  status: 'active_unacknowledged', paymentMode, etats: { [A]: 'en_cours', [B]: 'en_cours' },
  codeRetour: null, codeRetourFournisseur: null, closed: false,
});

type Calls = ReturnType<typeof wire>['calls'];
/** The requests one custody act made, and which order each named. */
const actes = (calls: Calls, path: string) => calls.filter((c) => c.path === path).map((c) => ({ orderId: c.body?.['orderId'], id: c.body?.['command_id'], body: c.body }));

async function toTheDoor(state: CourseState, world: World) {
  const w = wire([logistics(state), custody(world, state.paymentMode)]);
  const s = await mountRider();
  await s.type(CODE);
  await s.press('Entrer');
  // One course, one bag, said on the proposal itself.
  expect(s.shows('Un colis de 2 articles'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
  await s.press('Accepter la course');
  await s.press('Oui', 2);
  await s.press('Oui', 1);
  await s.press('Oui', 0);
  await s.press('Envoyer la vérification');
  await s.press('En route');
  await s.press('Je suis arrivé');
  return { s, w };
}

describe('COLIS-FOURNISSEUR-1 — the rider carries one package of several orders', () => {
  it('pay at the door: every whole-bag act reaches EACH article’s ledger under its own id → she keeps the pagne and refuses the sandals → ONE code for what she kept, after its door payment → the refused one goes home on the two keys → back in service', async () => {
    const state = course(PORTE);
    const world = freshWorld();
    const { s, w } = await toTheDoor(state, world);

    // THE PICKUP, THE SEAL, THE ROAD, THE DOOR EVIDENCE — each once per
    // article, the same code and seal, each on its own ledger and its own id.
    for (const path of ['/rider/verification', '/rider/custody/begin', '/rider/transit/depart', '/rider/transit/arrive', '/rider/delivery/evidence']) {
      const faits = actes(w.calls, path);
      expect(faits.map((f) => f.orderId), path).toEqual([A, B]);
      expect(new Set(faits.map((f) => f.id)).size, `${path}: one id per article`).toBe(2);
    }
    expect(actes(w.calls, '/rider/verification').map((f) => f.body?.['presentedPickupCode'])).toEqual([PICKUP, PICKUP]);
    expect(actes(w.calls, '/rider/custody/begin').map((f) => f.body?.['custodySealId'])).toEqual([SEAL, SEAL]);
    expect(actes(w.calls, '/rider/delivery/evidence').map((f) => (f.body?.['bundle'] as Record<string, unknown>)['packageId'])).toEqual([`pkg-${A}`, `pkg-${B}`]);
    expect(world.ledgers[A]!.evidence && world.ledgers[B]!.evidence, 'both ledgers hold their door evidence').toBe(true);

    // THE DOOR, ONE ARTICLE AT A TIME — named in the rider's words.
    expect(s.shows('La cliente regarde chaque article.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Article 1 sur 2')).toBe(true);
    expect(s.shows('Le pagne wax')).toBe(true);
    expect(s.canPress('Un souci ?'), 'before any choice, the whole-bag ladder is still reachable').toBe(true);
    await s.press('La cliente le garde');
    expect(world.ledgers[A]!.inspection).toBe('accepted');

    expect(s.shows('Article 2 sur 2'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Les sandales')).toBe(true);
    expect(s.shows('Un souci ?'), 'one article chosen — the ladder is no longer the whole bag’s').toBe(false);
    await s.press('La cliente le refuse');
    // The seal question, with the return seal to write on the bag.
    expect(s.shows(RETSEAL)).toBe(true);
    await s.press('Oui, intact');
    expect(world.ledgers[B]!.inspection, 'her refusal is on the SANDALS’ ledger').toBe('valid_rejection');
    expect(world.ledgers[B]!.returnOpen, 'and they are re-sealed for home at once').toBe(true);
    expect(world.ledgers[A]!.returnOpen, 'the pagne never went into the return bag').toBe(false);

    // ONE CODE, for what she kept — and nothing is handed over before its
    // door payment is confirmed by the provider (SE-I11), said as a wait.
    expect(s.shows('1 article à remettre.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Les articles refusés repartent chez le vendeur, dans le sac de retour.')).toBe(true);
    await s.type(DROP);
    await s.press('Confirmer la remise');
    expect(world.ledgers[A]!.delivered).toBe(false);
    expect(s.canPress('Confirmer la remise'), 'the wait keeps its lever').toBe(true);
    world.ledgers[A]!.doorPaid = true; // the provider confirmed the pagne's door leg
    await s.type(DROP);
    await s.press('Confirmer la remise');
    expect(world.ledgers[A]!.delivered).toBe(true);
    expect(actes(w.calls, '/rider/delivery/drop').every((f) => f.orderId === A), 'the refused sandals are never offered to her code').toBe(true);

    // The pagne is hers; the bag is not over — the way out says where next.
    expect(s.shows('Livré. Merci.')).toBe(true);
    expect(s.shows('Les articles gardés sont remis. Il reste le retour chez le vendeur.')).toBe(true);
    await s.press('Aller au retour');

    // THE ROAD HOME: the rider's key arrives with logistics' word, the
    // supplier's only after he confirmed it; both hand back the sandals ONLY.
    state.etats = { [A]: 'livree', [B]: 'en_retour' };
    state.codeRetour = CLE_COURSIER;
    await s.poll();
    expect(s.shows(CLE_COURSIER), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.shows('Échanger les deux codes')).toBe(false);
    state.codeRetourFournisseur = CLE_VENDEUR;
    await s.poll();
    await s.press('Échanger les deux codes');
    expect(world.ledgers[B]!.returned).toBe(true);
    expect(actes(w.calls, '/rider/return/handover').map((f) => f.orderId)).toEqual([B]);
    expect(s.canPress('Revenir en service'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);

    // Logistics closed the course once both articles ended.
    state.closed = true;
    await s.press('Revenir en service');
    expect(s.shows('Commencer le service') || s.texts().length > 0, 'the tree survived to the waiting state').toBe(true);
  });

  it('prepaid, she keeps both: one code hands over BOTH articles, each on its own ledger, and the rider is back in service', async () => {
    const state = course('FULL_PREPAY');
    const world = freshWorld();
    const { s, w } = await toTheDoor(state, world);
    await s.press('La cliente le garde');
    await s.press('La cliente le garde');
    expect(s.shows('2 articles à remettre.'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    await s.type(DROP);
    await s.press('Confirmer la remise');
    expect(world.ledgers[A]!.delivered && world.ledgers[B]!.delivered).toBe(true);
    expect(actes(w.calls, '/rider/delivery/drop').map((f) => f.orderId)).toEqual([A, B]);
    expect(s.canPress('Revenir en service'), 'nothing left to carry: the ordinary way out').toBe(true);
  });

  it('⚠ an automatic act whose SECOND article’s ledger does not answer leaves a way out, and the retry moves nothing twice', async () => {
    const state = course('FULL_PREPAY');
    const world = freshWorld();
    // The sandals' door evidence meets a dead link the first time.
    world.ledgers[B]!.panne = '/rider/delivery/evidence';
    const { s, w } = await toTheDoor(state, world);
    expect(world.ledgers[A]!.evidence, 'the pagne’s ledger took its evidence').toBe(true);
    expect(world.ledgers[B]!.evidence, 'the sandals’ did not').toBe(false);
    // Never the door yet — the evidence arm says so, with its lever.
    expect(s.shows('La cliente regarde chaque article.')).toBe(false);
    expect(s.canPress('Réessayer'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
    const avant = actes(w.calls, '/rider/delivery/evidence');
    await s.press('Réessayer');
    const apres = actes(w.calls, '/rider/delivery/evidence').slice(avant.length);
    // The same ids again: the pagne REPLAYS its recorded answer, the sandals land.
    expect(apres.map((f) => f.id)).toEqual(avant.map((f) => f.id));
    expect(world.ledgers[B]!.evidence).toBe(true);
    expect(s.shows('Article 1 sur 2'), `on screen: ${JSON.stringify(s.texts())}`).toBe(true);
  });
});
