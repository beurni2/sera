import type { ConnectivityPort } from '../offline/connectivity';
import { mintCommandId, type CommandId } from '../offline/commandId';
import type { PolicyCheckId } from '../custody-flow';

/**
 * ═══ SE-LIVE-4c-iii · THE RIDER'S TWO CUSTODY ACTS ═══
 *
 * `POST /rider/verification` (SE4.2, bounded pickup verification) and
 * `POST /rider/custody/begin` (SE4.3, seal → custody begins) on the custody
 * Worker, Bearer = the rider's own personal code. These are the only two
 * routes the 4b allowlist opens to a rider, and they are the acts SE-I05
 * names: « Custody begins only after **rider pickup verification** AND
 * **custody-seal registration**. »
 *
 * ═══ ⚠ WHY THESE ACTS ARE NOT QUEUED OFFLINE — SAFEST DEFAULT, FLAGGED ═══
 *
 * The app has a persistent outbox (`offline/outbox.ts`) and delivery EVIDENCE
 * rides it, correctly: a photo on disk is a photo. These two acts do NOT, and
 * that is a deliberate refusal, not an omission.
 *
 * `presentedPickupCode` and `custodySealId` are TWO OF THE FOUR SECRETS. The
 * outbox persists its payload to the document store so it survives an app kill
 * — which is exactly right for evidence and exactly wrong for a live custody
 * secret. Queueing these would leave, on a rider's phone, a working pickup
 * code and a working seal id for a real package. A lost or stolen handset then
 * hands someone the means to take custody. SE-LIVE-3's whole design was
 * digest-at-the-door: « the presented code dies with this request ». A queue
 * on a phone is the opposite of that.
 *
 * THE SPEC IS SILENT HERE. It contemplates offline queueing in general
 * (Building Plan: « queued = pending, never final custody/delivery ») and
 * SE-I06 allows offline EVIDENCE explicitly — but neither says whether a
 * custody SECRET may rest on the device. On a custody path, silence resolves
 * to the closed door:
 *
 *   OFFLINE ⇒ THE ACT IS REFUSED AND NOTHING IS STORED. The rider is told
 *   plainly that there is no network and the seal cannot be recorded yet. The
 *   package stays with the seller, custody has NOT begun, and that is the
 *   correct and safe state — nothing is lost, nothing is at risk, and the only
 *   cost is the rider's time. Compare the alternative: a live seal on a phone
 *   in a market.
 *
 * ⚠ FOUNDER DECISION REQUESTED (recorded in JOURNAL.md): should a rider be
 * able to verify and seal in a dead zone, accepting a custody secret at rest
 * on the device? Until he rules, this is closed.
 *
 * ═══ IDEMPOTENCY WITHOUT DISK ═══
 *
 * Custody dedupes on `command_id` and REPLAYS the recorded answer for a repeat
 * (`replayOutcome` marks it `duplicate: true`). So each act mints its
 * `command_id` ONCE, at the gesture, and every retry within the session reuses
 * it — held in memory by the caller, never written down. That covers the two
 * cases that actually happen: the rider taps twice, and the answer is lost on
 * a bad connection. It does not survive an app kill, and it does not need to:
 * an act that never reached custody left no custody record, so re-doing it
 * from the top is correct.
 *
 * ⚠ `at` IS NEVER SENT. Custody stamps its own clock when the field is absent,
 * so a rider's phone clock — wrong by hours on a cheap handset, and settable
 * by the rider — can never date a custody transition. This answers the open
 * policy question carried from 4b (JOURNAL « B6 »).
 */

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * ⚠ VERIFIER BLOCKER A5 — A STALLED SOCKET USED TO HANG THE ONLY DOOR IN THE
 * APP. React Native's `fetch` carries no default timeout, and `connectivity`
 * can read « online » while nothing completes: a captive-portal Wi-Fi, a 2G
 * cell that associates but never delivers, or simply the seed race in
 * `expoConnectivity` (it reads the real state asynchronously, so a cold start
 * on a dead network reports online until the first read lands). While
 * `working`, the screen disables BOTH the button and the field — so with no
 * timeout the rider's only exit was force-quitting the app.
 *
 * Every request is now bounded. The abort surfaces as `unreachable`, which is
 * already the « try again in a moment » sentence — never « your code is dead ».
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Run `fetch` with a hard deadline. Returns null when the deadline (or the
 *  transport) killed it — the caller turns that into `unreachable`. */
async function fetchWithin(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}


/** What custody answered. `recorded` is the ledger fact; `reason` names a
 *  refusal in custody's own vocabulary so the screen can speak plainly. */
export type CustodyAnswer =
  /** Custody recorded the act. `duplicate` = this command_id was already
   *  applied and the recorded answer was replayed — not a second effect. */
  | { readonly kind: 'recorded'; readonly duplicate: boolean; readonly body: Record<string, unknown> }
  /** Custody answered, and the answer is a REFUSAL it has written down
   *  (wrong pickup code, seal already used, this rider did not verify…).
   *  Final: retrying changes nothing. */
  | { readonly kind: 'refused'; readonly reason: string }
  /** The device knows it has no network. Nothing was sent and nothing stored. */
  | { readonly kind: 'offline' }
  /** The rider's code did not open the door — revoked, or the wire is unarmed. */
  | { readonly kind: 'unauthorized' }
  /** Custody or the rider directory did not answer. NOT an act, NOT a refusal:
   *  the same act may be retried with the same command_id. */
  | { readonly kind: 'unreachable'; readonly reason?: string | undefined };

/** SE4.2 — objective conformity only (SE-I12). The checks mirror
 *  `POLICY_CHECK_IDS`; the SERVICE owns the policy and judges them.
 *
 *  FOUNDER RULING (2026-08-10, #4 as amended): `presentedPickupCode` is now
 *  MACHINE-CARRIED — it arrives on the rider's session read (`codeVerification`
 *  on `/rider/moi`) and the caller passes it from there; the rider never types
 *  it. `null` = the session did not carry one yet (the supplier has not
 *  confirmed the ramassage, or an old Worker) — the act then refuses LOCALLY
 *  with a named outcome; an empty string is never sent. */
export interface VerifyPickupAct {
  readonly commandId: CommandId;
  readonly orderId: string;
  readonly presentedPickupCode: string | null;
  readonly evidenceBundleId: string;
  readonly dwellSec: number;
  readonly checkResults: Partial<Record<PolicyCheckId, boolean>>;
}

/** SE4.3 — the seal, and the photos that witness it. */
export interface BeginCustodyAct {
  readonly commandId: CommandId;
  readonly orderId: string;
  readonly custodySealId: string;
  readonly sealPhotoRefs: readonly string[];
}

/**
 * SE-LIVE-5c — the handoff moment's evidence (SE-I05: delivery requires
 * « evidence »; §63: it SUPPORTS, never releases). The seal id is one of the
 * four secrets and dies at custody's door like every other; the photo refs
 * are identifiers of already-uploaded media, safe at rest.
 */
export interface DeliveryEvidenceAct {
  readonly commandId: CommandId;
  readonly orderId: string;
  readonly custodySealId: string;
  readonly taskId: string;
  readonly packageId: string;
  readonly artifacts: readonly { ref: string; sha256: string; mimeType: string }[];
  readonly capturedAt: string;
}

/**
 * PORTE-CUSTODY part C (founder-approved 2026-08-14) — the §6.3 doorstep
 * inspection, ACCEPT road only: the rider records the OBSERVABLE session
 * (the buyer opened, judged, and accepts). SE-I11 bans only PAYMENT
 * assertion, and this asserts none — the door-payment truth arrives
 * provider-actored on custody's own wire. `refusalColumn` is deliberately
 * NOT here: the accept road omits it (the fixed contract), and the refusal
 * road stays with the refusal ladder. Same laws as every sibling act: never
 * queued offline (a live custody statement — offline is an honest refusal),
 * minted command_id reused on retry, `at` never sent.
 */
export interface DoorInspectionAct {
  readonly commandId: CommandId;
  readonly orderId: string;
  /** The conservative category while no category rides the task (founder
   *  ruling 2026-08-14, decision (b)): `uncategorised_conservative`. */
  readonly inspectionCategory: string;
  readonly packageOpened: boolean;
  readonly manufacturerSealOpened: boolean;
  readonly custodySealIntact: boolean;
  readonly buyerAccepts: boolean;
  /** Frozen with the attempt (custody fingerprints the content — a moving
   *  clock would turn every retry into `command_id_reused_with_other_content`). */
  readonly startedAt: string;
  readonly completedAt: string;
  /** No camera at the door (PORTE-SANS-PHOTO) — the value SAYS SO, derived
   *  deterministically for the order (the `sans-photo` convention), never
   *  shaped like a bundle that was never filled (A7's lesson). */
  readonly evidenceBundleId: string;
}

/**
 * SE-LIVE-5c — the buyer's code, entered LAST, on this device (§63). A
 * custody secret: same no-offline-queue law as the pickup code and the seal
 * — offline, the act refuses and NOTHING rests on the phone.
 */
export interface ConfirmDropAct {
  readonly commandId: CommandId;
  readonly orderId: string;
  readonly dropCode: string;
}

/** Mint the identity of an act ONCE, at the gesture. Every retry reuses it. */
export const mintActId = (): CommandId => mintCommandId();

export interface CustodyActsPort {
  verifyPickup(act: VerifyPickupAct, code: string): Promise<CustodyAnswer>;
  beginCustody(act: BeginCustodyAct, code: string): Promise<CustodyAnswer>;
  /**
   * VRAI-ROUTE — the two TRANSIT FACTS (Spec l.63: « custody begins → transit
   * (one current stop) → arrival »). Same auth, same door, same discipline as
   * the four acts around them: NEVER queued offline (the header's law — these
   * are live custody statements, and offline is an honest refusal), minted
   * command_id reused on retry, `at` never sent. No secret travels in either
   * body — only the order and the command identity.
   */
  depart(code: string, orderId: string, commandId: CommandId): Promise<CustodyAnswer>;
  arrive(code: string, orderId: string, commandId: CommandId): Promise<CustodyAnswer>;
  submitDeliveryEvidence(act: DeliveryEvidenceAct, code: string): Promise<CustodyAnswer>;
  /** PORTE-CUSTODY part C — the §6.3 door inspection, accept road, on the
   *  rider door (`POST /rider/door/inspection`). Same auth, same discipline. */
  recordDoorInspection(act: DoorInspectionAct, code: string): Promise<CustodyAnswer>;
  confirmDrop(act: ConfirmDropAct, code: string): Promise<CustodyAnswer>;
}

/** Custody's structured refusals arrive as `{ok:false, reason}` with a 4xx.
 *  A 409 is the ledger saying no; a 400 is a malformed act (our bug, not the
 *  rider's) — both are final, and both must be shown rather than retried. */
async function readAnswer(res: Response): Promise<CustodyAnswer> {
  if (res.status === 401) return { kind: 'unauthorized' };
  // 503 is the door's own « I could not reach the object / the rider
  // directory » (custody_object_unavailable · rider_directory_unavailable),
  // and 5xx generally is not an answer about custody at all.
  if (res.status >= 500) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const reason = typeof body?.['reason'] === 'string' ? (body['reason'] as string) : undefined;
    return { kind: 'unreachable', reason };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null) {
    // A 2xx we cannot read is not a recorded act — corroborated, not counted.
    return { kind: 'unreachable', reason: 'unreadable_answer' };
  }
  if (res.ok && body['ok'] === true) {
    return { kind: 'recorded', duplicate: body['duplicate'] === true, body };
  }
  const reason = typeof body['reason'] === 'string' ? (body['reason'] as string) : 'refused';
  return { kind: 'refused', reason };
}

export function httpCustodyActs(
  base: string,
  connectivity: ConnectivityPort,
  fetchFn: FetchFn = globalThis.fetch,
  /** Injectable so the deadline itself is testable in milliseconds rather
   *  than by making the suite wait out the real one. */
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): CustodyActsPort {
  const root = base.replace(/\/+$/, '');

  async function post(path: string, code: string, payload: Record<string, unknown>): Promise<CustodyAnswer> {
    // ⚠ THE CLOSED DOOR. Nothing is sent and — crucially — nothing is stored:
    // no outbox entry, no file, so no custody secret rests on this phone.
    if (connectivity.current() === 'offline') return { kind: 'offline' };
    const res = await fetchWithin(fetchFn, `${root}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${code}` },
      body: JSON.stringify(payload),
    }, timeoutMs);
    if (res === null) return { kind: 'unreachable', reason: 'transport' };
    return readAnswer(res);
  }

  return {
    async verifyPickup(act, code) {
      // MACHINE-CARRIED (founder ruling 2026-08-10): the session did not carry
      // the code — refuse HERE, by name, before any byte leaves the phone. The
      // server would refuse an empty string anyway; sending one would burn a
      // request to learn what this phone already knows.
      if (act.presentedPickupCode === null || act.presentedPickupCode === '') {
        return { kind: 'refused', reason: 'verification_code_missing' };
      }
      return post('/rider/verification', code, {
        orderId: act.orderId,
        command_id: act.commandId,
        presentedPickupCode: act.presentedPickupCode,
        evidenceBundleId: act.evidenceBundleId,
        dwellSec: act.dwellSec,
        checkResults: act.checkResults,
        // ⚠ NO `riderId`: on the rider door custody takes the identity from
        // logistics' answer and IGNORES the body. Sending one would be
        // meaningless at best and an attempt to name someone else at worst.
        // ⚠ NO `at`: custody stamps its own clock. See the header block.
      });
    },
    async beginCustody(act, code) {
      return post('/rider/custody/begin', code, {
        orderId: act.orderId,
        command_id: act.commandId,
        custodySealId: act.custodySealId,
        sealPhotoRefs: [...act.sealPhotoRefs],
      });
    },
    async depart(code, orderId, commandId) {
      return post('/rider/transit/depart', code, {
        orderId,
        command_id: commandId,
        // NOTHING ELSE. No riderId (the door supplies the identity), no `at`
        // (custody stamps its own clock), and no secret — a transit fact
        // carries only which order and which command.
      });
    },
    async arrive(code, orderId, commandId) {
      return post('/rider/transit/arrive', code, {
        orderId,
        command_id: commandId,
      });
    },
    async submitDeliveryEvidence(act, code) {
      return post('/rider/delivery/evidence', code, {
        orderId: act.orderId,
        command_id: act.commandId,
        bundle: {
          taskId: act.taskId,
          packageId: act.packageId,
          custodySealId: act.custodySealId,
          artifacts: act.artifacts.map((a) => ({ ...a })),
          capturedAt: act.capturedAt,
        },
      });
    },
    async recordDoorInspection(act, code) {
      return post('/rider/door/inspection', code, {
        orderId: act.orderId,
        command_id: act.commandId,
        inspectionCategory: act.inspectionCategory,
        packageOpened: act.packageOpened,
        manufacturerSealOpened: act.manufacturerSealOpened,
        custodySealIntact: act.custodySealIntact,
        buyerAccepts: act.buyerAccepts,
        // `refusalColumn` DELIBERATELY absent — the accept road omits it
        // (the fixed contract); the refusal road is the ladder's, not this
        // button's. And no `at`: custody stamps its own clock, as always.
        startedAt: act.startedAt,
        completedAt: act.completedAt,
        evidenceBundleId: act.evidenceBundleId,
      });
    },
    async confirmDrop(act, code) {
      return post('/rider/delivery/drop', code, {
        orderId: act.orderId,
        command_id: act.commandId,
        dropCode: act.dropCode,
      });
    },
  };
}

/** Delivered, by the Worker's own word (`status: 'custody_with_customer'`) —
 *  or already delivered (`deja_livree`), which is the same finished truth. */
export function custodyWithCustomer(answer: CustodyAnswer): boolean {
  return (
    answer.kind === 'recorded' &&
    (answer.body['status'] === 'custody_with_customer' || answer.body['status'] === 'deja_livree')
  );
}

/**
 * ═══ SE-I05 · WHAT « RECORDED » DOES AND DOES NOT MEAN ═══
 *
 * ⚠ VERIFIER BLOCKER A4 — `recorded` IS NOT `accepted`. This returned
 * `answer.kind === 'recorded'`, and that was wrong in a way that would have
 * begun custody over goods a rider had just REFUSED.
 *
 * Custody records a refused pickup as a first-class custody fact — « no
 * generic failed terminal » — so `custody-do.ts:1219` answers a REFUSED
 * verification with **`200 {ok:true, kind:'refused'}`**, the same status and
 * the same `ok:true` as an accepted one. Measured against the shipped Worker:
 *
 *     verifyPickup(non-conforming goods)
 *       → {kind:'recorded', body:{ok:true, kind:'refused', …}}
 *       → custodyBegan() === true          ← the goods were REFUSED
 *
 * That is the refusal ladder: conformity failed, the fault signal is emitted,
 * and custody must NOT begin (SE-I05; Law 3 — evidence supports, and never on
 * its own releases anything). The two questions are now separate and each
 * reads the field the Worker actually sets.
 */

/** Did the LEDGER accept this pickup verification? Only `kind:'accepted'`
 *  does — a recorded REFUSAL is a custody fact, not a pass. */
export function verificationAccepted(answer: CustodyAnswer): boolean {
  return answer.kind === 'recorded' && answer.body['kind'] === 'accepted';
}

/**
 * Has custody actually begun? Only when the Worker recorded the seal and said
 * so by name (`status: 'custody_with_courier'`, `custody-do.ts:1302`).
 *
 * Not « the rider tapped », not « we are online », not « it is queued », and
 * not merely « something was recorded » — Law 7: queued = pending, never done;
 * never final custody offline. Every other answer leaves the package with the
 * seller, which is the safe state and the true one.
 */
export function custodyBegan(answer: CustodyAnswer): boolean {
  return answer.kind === 'recorded' && answer.body['status'] === 'custody_with_courier';
}

/**
 * RIDER-DELIVERY-SCREEN — the chain identifiers the BEGIN answer names (the
 * moment the phone starts holding the package, it learns which task and
 * package it holds; no other rider-reachable answer carries them). Parsed
 * DEFENSIVELY: an old Worker, or a replayed pre-upgrade command serving its
 * stored body, answers without them — that is an honest null, and the
 * delivery act must then refuse to compose rather than invent an id.
 */
export function deliveryChainOf(answer: CustodyAnswer): { taskId: string; packageId: string } | null {
  if (answer.kind !== 'recorded') return null;
  const chain = answer.body['chain'];
  if (chain === null || typeof chain !== 'object') return null;
  const c = chain as Record<string, unknown>;
  const taskId = c['task_id'];
  const packageId = c['package_id'];
  if (typeof taskId !== 'string' || taskId === '' || typeof packageId !== 'string' || packageId === '') return null;
  return { taskId, packageId };
}

/** Is the delivery evidence ON the ledger? The Worker's own word
 *  (`status: 'evidence_recorded'`, custody-do `/delivery/evidence`) — and
 *  « already submitted » is the same held truth: one bundle, held once. */
export function evidenceHeld(answer: CustodyAnswer): boolean {
  if (answer.kind === 'recorded' && answer.body['status'] === 'evidence_recorded') return true;
  return answer.kind === 'refused' && answer.reason === 'evidence_already_submitted';
}

/**
 * PORTE-CUSTODY part C — is the buyer's accord ON the ledger? The Worker's
 * own word (`200 {ok:true, kind:'accepted'}` — its replay carries the same
 * body with `duplicate: true` and reads identically), and
 * `inspection_already_recorded` is the SAME held truth (the
 * `evidence_already_submitted` design, kept exactly): one inspection per
 * attempt, held once — a rider who re-records after an app kill is told it
 * is held, never that something failed.
 */
export function inspectionHeld(answer: CustodyAnswer): boolean {
  if (answer.kind === 'recorded' && answer.body['kind'] === 'accepted') return true;
  return answer.kind === 'refused' && answer.reason === 'inspection_already_recorded';
}

/**
 * VRAI-ROUTE — did the LEDGER record the departure? Only its own word does:
 * `status: 'departed'`, or `'deja'` — the replay of a command it already
 * applied, which is the same recorded fact, not a second one. Everything else
 * (offline, unreachable, a refusal, a tap) leaves the rider NOT departed,
 * which is the honest state.
 */
export function transitDeparted(answer: CustodyAnswer): boolean {
  return (
    answer.kind === 'recorded' &&
    (answer.body['status'] === 'departed' || answer.body['status'] === 'deja')
  );
}

/** VRAI-ROUTE — did the LEDGER record the arrival? Same law as the departure:
 *  `status: 'arrived'` or the `'deja'` replay, and nothing else. */
export function transitArrived(answer: CustodyAnswer): boolean {
  return (
    answer.kind === 'recorded' &&
    (answer.body['status'] === 'arrived' || answer.body['status'] === 'deja')
  );
}
