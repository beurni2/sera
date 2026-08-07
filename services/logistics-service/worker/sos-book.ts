/**
 * ═══ SE-LIVE-4d · THE SOS BOOK — the wire the rider app never had ═══
 *
 * FOUNDER ORDER (2026-08-07): « Build the SOS wire. »
 *
 * ⚠ WHAT WAS WRONG. The rider app has had the SOS gesture since WO-6.3 — the
 * disc on every screen, the deliberate hold, the durable outbox entry — and
 * **no server anywhere received it**. A verifier found the consequence: on a
 * build a real rider signs into, the raise went to the app's demo store,
 * drained through a sandbox sender that always answers `applied`, and the
 * sheet said « Alerte envoyée. / On cherche quelqu'un pour vous. » Nothing
 * left the phone. That is the most dangerous kind of false statement this
 * product can make, and this file is the answer to it.
 *
 * IT LIVES IN LOGISTICS because logistics is the dispatch authority: it holds
 * the riders, the codes, the shifts and the assignments. An SOS is a dispatch
 * fact — « this rider, on this course, needs someone now » — and it must be
 * readable beside the board the dispatcher is already watching.
 *
 * ═══ THE HONESTY LAWS THIS BOOK KEEPS ═══
 *
 * 1. **AN ACK IS A HUMAN ACT, NEVER A TIMER.** Nothing in here acknowledges an
 *    incident on its own. `acknowledge` is reachable only through the
 *    founder's ops key, and it records WHO answered. The rider app's
 *    long-standing rule (« a queued SOS is unacknowledgeable ») becomes a
 *    server rule: an ack for an unknown incident is refused, not invented.
 * 2. **A RIDER CANNOT ACKNOWLEDGE THEIR OWN SOS.** The raise comes through the
 *    rider door; the ack comes only through the ops door. Two doors, two keys
 *    — the same separation custody draws between attesting and acting.
 * 3. **ONE PRESS IS ONE INCIDENT.** The app mints the `command_id` once, at
 *    the gesture, and the outbox replays it on every retry (`offline/sos.ts`).
 *    A repeat of that id REPLAYS the recorded answer instead of opening a
 *    second incident — a rider pressing twice in fear, or a phone retrying on
 *    a bad connection, must not fill the board with duplicates of one
 *    emergency.
 * 4. **OPEN UNTIL ANSWERED.** SE7.1: « persistent signal until ack. » An open
 *    incident stays open and readable; nothing ages it out, and there is no
 *    auto-close.
 * 5. **THE SERVER STAMPS THE CLOCK.** `raisedAt` from a phone is recorded as
 *    the rider's own claim (their clock may be hours off), but the ORDER of
 *    the board is the server's `receivedAt`. An emergency must not sort itself
 *    to the bottom because a handset's date is wrong.
 *
 * ⚠ WHAT THIS STILL DOES NOT DO, stated so nobody reads it as more than it is:
 * it RECEIVES and it RECORDS. It does not ring a phone. Out-of-hours
 * escalation to the founder has no transport bound (`safety.ts`
 * ESCALATION_TRANSPORT = pending/null), so an incident raised at 03:00 sits on
 * the board until someone looks. Closing that is a founder decision about a
 * channel (SMS? call? push?), and until it is made the app must not claim
 * anyone was woken.
 */

/** Canonical, from the pinned `@platform/contracts` EVENT_NAMES — never
 *  invented here (`safety.ts` mirrors the same three in the app). */
export const SOS_EVENT_CREATED = 'safety.sos_created.v1';
export const SOS_EVENT_ACKNOWLEDGED = 'safety.sos_acknowledged.v1';

export type SosState = 'open' | 'acknowledged';
/** In dispatch hours a dispatcher answers; out of hours it is the founder.
 *  Recorded as the rider's context, never as a promise that either was
 *  reached. */
export type DispatchHours = 'in_hours' | 'out_of_hours';

export interface SosIncident {
  /** The app's minted `command_id` — the incident's stable identity across
   *  every retry. One press, one id, one incident. */
  readonly commandId: string;
  readonly riderId: string;
  readonly hours: DispatchHours;
  readonly onShift: boolean;
  /** The course the rider was on, when there was one. */
  readonly activeCourseId: string | null;
  /** The rider's own clock, recorded as their claim. */
  readonly raisedAt: string;
  /** The SERVER's clock — what the board sorts and measures by. */
  readonly receivedAt: string;
  readonly state: SosState;
  /** Set only by a human through the ops door. */
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
}

export type RaiseOutcome =
  | { readonly ok: true; readonly incident: SosIncident; readonly duplicate: boolean }
  | { readonly ok: false; readonly reason: 'malformed' };

export type AckOutcome =
  | { readonly ok: true; readonly incident: SosIncident; readonly duplicate: boolean }
  | { readonly ok: false; readonly reason: 'unknown_incident' };

const MAX_ID = 256;
const isId = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.trim().length <= MAX_ID;

/** What the rider's phone sends (mirrors `offline/sos.ts` `SosRaiseIntent`
 *  plus the outbox's `command_id`). Parsed field by field — never spread — so
 *  a field the app adds later cannot silently become a dispatch fact. */
export function raiseFromBody(body: unknown, receivedAt: string): SosIncident | null {
  if (body === null || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!isId(b['command_id']) || !isId(b['riderId'])) return null;
  const hours = b['hours'] === 'out_of_hours' ? 'out_of_hours' : 'in_hours';
  const course = b['activeCourseId'];
  return {
    commandId: (b['command_id'] as string).trim(),
    riderId: (b['riderId'] as string).trim(),
    hours,
    onShift: b['onShift'] === true,
    activeCourseId: isId(course) ? (course as string).trim() : null,
    // A phone clock that is wrong (or absent) must not stop an emergency being
    // recorded — we fall back to the server's own instant rather than refuse.
    raisedAt: isId(b['raisedAt']) ? (b['raisedAt'] as string).trim() : receivedAt,
    receivedAt,
    state: 'open',
    acknowledgedAt: null,
    acknowledgedBy: null,
  };
}

/**
 * The durable book. Storage is injected so the Durable Object owns persistence
 * and this stays a pure, testable rule set — the same shape the rest of this
 * service uses.
 */
export interface SosStore {
  get(key: string): Promise<SosIncident | undefined>;
  put(key: string, value: SosIncident): Promise<void>;
  list(): Promise<SosIncident[]>;
}

export const SOS_PREFIX = 'sos:';
export const sosKey = (commandId: string): string => `${SOS_PREFIX}${commandId}`;

/**
 * Record a raise. FIRST-WINS on `command_id`: a repeat returns the incident
 * already recorded, marked `duplicate`, and changes nothing — a rider pressing
 * again, or the outbox retrying, must never open a second emergency or
 * overwrite the first one's timestamps.
 */
export async function raise(store: SosStore, incident: SosIncident): Promise<RaiseOutcome> {
  const existing = await store.get(sosKey(incident.commandId));
  if (existing !== undefined) return { ok: true, incident: existing, duplicate: true };
  await store.put(sosKey(incident.commandId), incident);
  return { ok: true, incident, duplicate: false };
}

/**
 * A human answered. Refuses an incident it has never seen — an ack is a
 * statement that someone is responding to a REAL alert, so it may not conjure
 * the alert it answers. Re-acking an already-acknowledged incident is absorbed
 * (the first responder keeps the record) rather than rewritten.
 */
export async function acknowledge(
  store: SosStore,
  commandId: string,
  by: string,
  at: string,
): Promise<AckOutcome> {
  const existing = await store.get(sosKey(commandId));
  if (existing === undefined) return { ok: false, reason: 'unknown_incident' };
  if (existing.state === 'acknowledged') return { ok: true, incident: existing, duplicate: true };
  const acked: SosIncident = { ...existing, state: 'acknowledged', acknowledgedAt: at, acknowledgedBy: by };
  await store.put(sosKey(commandId), acked);
  return { ok: true, incident: acked, duplicate: false };
}

/**
 * The board: OPEN incidents first (SE7.1 — persistent until ack), each list
 * ordered by the SERVER's clock, newest first. Acknowledged ones stay readable
 * below rather than vanishing: the drill has to be able to measure how long an
 * ack took.
 */
export async function board(store: SosStore): Promise<SosIncident[]> {
  const all = await store.list();
  const byReceivedDesc = (a: SosIncident, b: SosIncident): number =>
    a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0;
  return [
    ...all.filter((i) => i.state === 'open').sort(byReceivedDesc),
    ...all.filter((i) => i.state === 'acknowledged').sort(byReceivedDesc),
  ];
}

/** Seconds from receipt to ack — what the live drill measures against
 *  `SOS_ACK_SLA_POLICY.inHoursTargetSeconds`. Null while still open: an
 *  unanswered alert has no ack time, and reporting one would be a lie. */
export function ackSeconds(incident: SosIncident): number | null {
  if (incident.state !== 'acknowledged' || incident.acknowledgedAt === null) return null;
  const delta = (Date.parse(incident.acknowledgedAt) - Date.parse(incident.receivedAt)) / 1000;
  return Number.isFinite(delta) ? Math.max(0, Math.round(delta)) : null;
}
