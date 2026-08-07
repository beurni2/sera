/**
 * SE-LIVE-4c-i · the RIDER SESSION PORT — the app's first real-port seam.
 *
 * The rider signs in with THEIR OWN personal code (minted/revoked by the
 * founder in logistics; SE-LIVE-4b-ii). That code is the Bearer on every
 * rider door — logistics for identity + assignment, custody for the two acts.
 * This port resolves the code into the rider's session and their ONE live
 * assignment, from `GET /rider/moi` on the logistics Worker.
 *
 * ⚠ THE CODE IS A CREDENTIAL, AND THIS PORT NEVER STORES IT. `signIn` CARRIES
 * it (as the Bearer) and returns the session; the caller holds the code for
 * the subsequent custody acts, exactly as `OutboxSender` carries an entry
 * rather than owning it. Nothing here writes it to disk, and — the standing
 * secret law — nothing bundles it: the base URL is public, the code is typed
 * by the rider.
 *
 * ⚠ « DOWN » AND « WRONG » ARE DIFFERENT ANSWERS, the same distinction custody
 * draws at its own rider door (SE-LIVE-4b-ii): `unauthorized` means the code
 * is dead, `offline`/`unreachable` mean try again. Conflating them is cruel to
 * a rider standing in the sun who typed the right code onto a phone with no
 * signal.
 *
 * PURE + PORT-BASED (mirrors ConnectivityPort / OutboxStore): the device
 * binding is `httpRiderSession`, the demo world is `demoRiderSession`, and the
 * resolver picks by `EXPO_PUBLIC_SERA_LOGISTICS_BASE`. No custody write here —
 * this is the READ seam; the acts arrive in 4c-iii/iv through the outbox. No
 * franc. No screen.
 */

/** The rider's ONE live assignment, projected by logistics' `/rider/moi`
 *  (`riderView`): the fields the card renders, nothing the app recomputes.
 *  `window` and `location` are opaque here — the screen owns their shape. */
export interface RiderAssignment {
  readonly assignmentId: string;
  readonly taskId: string;
  readonly orderId: string;
  readonly status: string;
  readonly ackDeadline: string | null;
  readonly window: unknown | null;
  readonly location: unknown | null;
}

/** The rider's session as logistics tells it — identity + certification +
 *  privacy-ack state + shift + the one assignment (or none). Shift is opaque:
 *  its shape is logistics', and the app reads only what the screen needs. */
export interface RiderSession {
  readonly riderId: string;
  readonly displayName: string;
  readonly certified: boolean;
  readonly privacyAckOk: boolean;
  readonly noticeVersion: string;
  readonly shift: unknown;
  readonly assignment: RiderAssignment | null;
}

/**
 * The outcome of a sign-in. Three refusals, kept apart on purpose:
 *  · `unauthorized` — the code is not a live rider code (revoked, wrong, or
 *    never minted). Logistics gives one uniform 401 with no oracle; so do we.
 *  · `offline`      — the device KNOWS it has no network. No request is made.
 *  · `unreachable`  — a request was made and the directory did not answer
 *    (timeout, 5xx, transport error). Distinct from `unauthorized`.
 */
export type SignInResult =
  | { readonly ok: true; readonly session: RiderSession }
  | { readonly ok: false; readonly reason: 'unauthorized' | 'offline' | 'unreachable' };

export interface RiderSessionPort {
  /** Resolve the rider's personal code into their session + live assignment.
   *  The code is the Bearer; it is carried, never stored by this port. */
  signIn(code: string): Promise<SignInResult>;
}

/**
 * Map the raw `/rider/moi` body into a `RiderSession`, field by field — never
 * by spreading, so a field logistics adds later cannot silently land in the
 * app's session shape. Returns null when the body is not the shape we require
 * (a malformed answer is treated as unreachable by the caller, never as a
 * pass — corroborated, not counted, the custody-door lesson).
 */
export function riderSessionFromBody(body: unknown): RiderSession | null {
  if (body === null || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  if (root['ok'] !== true) return null;
  const r = root['rider'];
  if (r === null || typeof r !== 'object') return null;
  const rider = r as Record<string, unknown>;
  if (typeof rider['riderId'] !== 'string' || rider['riderId'].trim() === '') return null;

  const rawAssignment = rider['assignment'];
  let assignment: RiderAssignment | null = null;
  if (rawAssignment !== null && rawAssignment !== undefined && typeof rawAssignment === 'object') {
    const a = rawAssignment as Record<string, unknown>;
    if (
      typeof a['assignmentId'] === 'string' &&
      typeof a['taskId'] === 'string' &&
      typeof a['orderId'] === 'string' &&
      typeof a['status'] === 'string'
    ) {
      assignment = {
        assignmentId: a['assignmentId'],
        taskId: a['taskId'],
        orderId: a['orderId'],
        status: a['status'],
        ackDeadline: typeof a['ackDeadline'] === 'string' ? a['ackDeadline'] : null,
        window: a['window'] ?? null,
        location: a['location'] ?? null,
      };
    }
  }

  return {
    riderId: rider['riderId'],
    displayName: typeof rider['displayName'] === 'string' ? rider['displayName'] : '',
    certified: rider['certified'] === true,
    privacyAckOk: rider['privacyAckOk'] === true,
    noticeVersion: typeof rider['noticeVersion'] === 'string' ? rider['noticeVersion'] : '',
    shift: rider['shift'] ?? null,
    assignment,
  };
}
