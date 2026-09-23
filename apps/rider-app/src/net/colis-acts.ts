import type { CommandId } from '../offline/commandId';
import {
  custodyBegan,
  custodyWithCustomer,
  evidenceHeld,
  returnOpened,
  returnedToSupplier,
  transitArrived,
  transitDeparted,
  verificationAccepted,
  windowExpiredInto,
  windowOpened,
  type CustodyAnswer,
} from './custody-acts';

/**
 * ═══ COLIS-FOURNISSEUR-1 — ONE GESTURE, EVERY ARTICLE'S OWN LEDGER ═══
 *
 * Founder ruling 2026-09-23 (canon 3.20.0, Sera-Build-Spec SE3): a package of
 * several orders is still ONE job — one pickup, one drop, one current stop —
 * and each order keeps its own custody file, its own inspection at the door
 * and its own drop.
 *
 * So the rider makes each gesture ONCE (« Envoyer la vérification », « En
 * route », the buyer's code…) and this carries it to every article's own
 * ledger, one after the other, each under its own command id. The screen then
 * reads ONE answer, by the rule that keeps every existing screen true:
 *
 *   · every article HELD the act (by that act's own ledger word) → the FIRST
 *     article's answer, exactly the answer a single order gives (the seal's
 *     answer still names the chain the delivery evidence will present);
 *   · otherwise → the first answer that did NOT hold, and the articles after
 *     it are not asked. The rider sees that answer's own sentence (offline,
 *     unreachable, a refusal custody named) and retries the SAME gesture:
 *     the ids are the same for the same attempt, so every article that
 *     already held replays its recorded answer and moves nothing twice.
 *
 * An order carried alone is a list of one: its act, its id, its answer —
 * byte-identical to the road before packages existed.
 *
 * `jusquauBout` — the buyer's code is each article's OWN drop (SE3): an
 * article still waiting for its door payment must not keep the ones she has
 * paid for in the rider's bag. So the handover asks EVERY article, tells
 * `quandTenu` each one that crossed, and answers the first that did not.
 *
 * Never queued offline, never in parallel (one request at a time on a 2G
 * phone), and never a success this module invents: every held answer is a
 * ledger's.
 */
export async function surChaqueArticle(
  ordres: readonly string[],
  idPour: (orderId: string, rang: number) => CommandId,
  acte: (orderId: string, commandId: CommandId) => Promise<CustodyAnswer>,
  tenu: (answer: CustodyAnswer) => boolean,
  options: { readonly jusquauBout?: boolean; readonly quandTenu?: (orderId: string) => void } = {},
): Promise<CustodyAnswer> {
  // Nothing left to act on is a refusal said by name, never a quiet success.
  if (ordres.length === 0) return { kind: 'refused', reason: 'aucun_article' };
  let premier: CustodyAnswer | null = null;
  let premierRefus: CustodyAnswer | null = null;
  for (const [rang, orderId] of ordres.entries()) {
    const answer = await acte(orderId, idPour(orderId, rang));
    if (!tenu(answer)) {
      if (options.jusquauBout !== true) return answer;
      premierRefus ??= answer;
      continue;
    }
    options.quandTenu?.(orderId);
    premier ??= answer;
  }
  return (premierRefus ?? premier) as CustodyAnswer;
}

/**
 * The pickup check's « held » — PICKUP-REFUS (founder « 1 », 2026-09-23). One
 * check at the stall covers the whole bag, so a refusal recorded on one
 * article is every article's: each order's own file must hear it, because
 * each buyer is refunded on her own order. So when the rider's answers REFUSE,
 * the ledger's word either way carries the gesture on (custody answers a
 * refused order's every later check with its recorded refusal, so a retry
 * under new ids still reaches the rest). When his answers say « all good »,
 * only an acceptance does: answers that no longer refuse must never be taken,
 * on the next article, over a bag already refused (verifier MAJOR 1). The
 * screen reads the first article's word; a dead link still stops the walk.
 */
export const tenuVerification =
  (refusDemande: boolean) =>
  (a: CustodyAnswer): boolean =>
    verificationAccepted(a) || (refusDemande && a.kind === 'recorded' && a.body['kind'] === 'refused');

/** Each act's « held », by its own ledger word — the same predicates the
 *  single road's screens already read. */
export const TENU = {
  scelle: custodyBegan,
  depart: transitDeparted,
  arrivee: transitArrived,
  preuve: evidenceHeld,
  remise: custodyWithCustomer,
  /** « Un souci ? »: the window opened, or it already was (a replay). */
  souci: (a: CustodyAnswer): boolean =>
    windowOpened(a) || (a.kind === 'refused' && a.reason === 'ladder_already_open'),
  expiration: (a: CustodyAnswer): boolean => windowExpiredInto(a) !== null,
  retour: returnOpened,
  remiseRetour: returnedToSupplier,
} as const;
