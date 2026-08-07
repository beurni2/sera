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
 *  `POLICY_CHECK_IDS`; the SERVICE owns the policy and judges them. */
export interface VerifyPickupAct {
  readonly commandId: CommandId;
  readonly orderId: string;
  readonly presentedPickupCode: string;
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

/** Mint the identity of an act ONCE, at the gesture. Every retry reuses it. */
export const mintActId = (): CommandId => mintCommandId();

export interface CustodyActsPort {
  verifyPickup(act: VerifyPickupAct, code: string): Promise<CustodyAnswer>;
  beginCustody(act: BeginCustodyAct, code: string): Promise<CustodyAnswer>;
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
): CustodyActsPort {
  const root = base.replace(/\/+$/, '');

  async function post(path: string, code: string, payload: Record<string, unknown>): Promise<CustodyAnswer> {
    // ⚠ THE CLOSED DOOR. Nothing is sent and — crucially — nothing is stored:
    // no outbox entry, no file, so no custody secret rests on this phone.
    if (connectivity.current() === 'offline') return { kind: 'offline' };
    let res: Response;
    try {
      res = await fetchFn(`${root}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${code}` },
        body: JSON.stringify(payload),
      });
    } catch {
      return { kind: 'unreachable', reason: 'transport' };
    }
    return readAnswer(res);
  }

  return {
    async verifyPickup(act, code) {
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
  };
}

/**
 * SE-I05 · THE ONE QUESTION THE SCREEN MAY ASK ABOUT CUSTODY.
 *
 * Custody has begun if, and only if, the custody Worker recorded the seal.
 * Not « the rider tapped », not « we are online », not « it is queued » —
 * Law 7: queued = pending, never done; never final custody offline.
 *
 * Every other answer leaves the package with the seller, which is the safe
 * state and the true one.
 */
export function custodyBegan(answer: CustodyAnswer): boolean {
  return answer.kind === 'recorded';
}
