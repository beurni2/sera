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
  /**
   * COURSE-BRIEF (founder order 2026-08-09) — media POINTERS, never URLs: the
   * app appends them to its own media base, so nothing the Worker says can
   * point this screen at another host. `repereAudioRef` is the buyer's
   * recorded landmark; `preuvePhotoRefs` is what the supplier photographed at
   * readiness, and what the pickup check-up is answered against.
   * Parsed defensively: a malformed ref is DROPPED, so a bad byte costs the
   * rider a photo, never the course.
   */
  readonly repereAudioRef: string | null;
  readonly preuvePhotoRefs: readonly string[];
  /**
   * RAMASSAGE (founder order 2026-08-09) — the handover code THIS rider says
   * to the supplier at the stall; the supplier's console confirms it before
   * handing the package over (SE5's two-party pickup, the supplier's half).
   * Logistics-owned, per assignment — NOT one of the four custody secrets;
   * the typed `pickupVerificationCode` flow is untouched by it. Bounded to
   * the minted shape so nothing else can wear it on this screen.
   */
  readonly codeRamassage: string | null;
}

/** A media pointer and nothing else — mirrors the Worker's own bound, because
 *  this value becomes a URL on the phone. */
const MEDIA_REF = /^media\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function mediaRefOrNull(v: unknown): string | null {
  return typeof v === 'string' && MEDIA_REF.test(v) && !v.includes('..') ? v : null;
}

/** The minted ramassage shape (`XXX-XXX`, the unambiguous alphabet) and
 *  nothing else — a stray byte is dropped, never displayed. */
const CODE_RAMASSAGE = /^[ABCDEFGHJKMNPQRSTVWXYZ2-9]{3}-[ABCDEFGHJKMNPQRSTVWXYZ2-9]{3}$/;
function codeRamassageOrNull(v: unknown): string | null {
  return typeof v === 'string' && CODE_RAMASSAGE.test(v) ? v : null;
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
        repereAudioRef: mediaRefOrNull(a['repereAudioRef']),
        preuvePhotoRefs: Array.isArray(a['preuvePhotoRefs'])
          ? (a['preuvePhotoRefs'] as unknown[]).map(mediaRefOrNull).filter((r): r is string => r !== null)
          : [],
        codeRamassage: codeRamassageOrNull(a['codeRamassage']),
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

/**
 * ═══ SE-LIVE-4c-x · WHAT A RIDER READS, AND WHAT THEY NEVER SHOULD ═══
 *
 * ⚠ VERIFIER BLOCKER A10. The wired screen rendered the server's own vocabulary
 * straight at the rider: « État · active_unacknowledged », « Course ·
 * task-3f2a… », « Commande · ord-91b7… ». Three faults in one line each — they
 * are English enums and UUIDs; they are inline template strings the copy-lint
 * cannot see (Law 6: strings live in the catalog with register tags); and they
 * are useless, because nobody navigates by a UUID or reads one aloud to a
 * dispatcher.
 *
 * WHAT REPLACES THEM IS WHAT SE0.3 ALREADY DECIDED. `landmarkFirstLines`
 * (logistics `delivery-location.ts`) fixes the display order for BOTH shells:
 * **landmark, then directions, then zone — the GPS pin never leads**, because
 * the words a rider navigates by are the landmark and the turn after it. The
 * identifiers stay server-side, where they are useful, and off the screen of
 * someone standing in the sun trying to find a stall.
 *
 * Parsed DEFENSIVELY — this arrives over the network, and a malformed location
 * must degrade to an honest « no landmark yet », never crash a rider's only
 * screen.
 */

/** The three lines in the canonical SE0.3 order, or null when the server sent
 *  no usable location — an honest absence, never an invented address. */
export function landmarkLines(location: unknown): readonly [string, string, string] | null {
  if (location === null || typeof location !== 'object') return null;
  const l = location as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const landmark = text(l['landmark']);
  // The landmark is the one line that must exist — it is what leads.
  if (landmark === '') return null;
  return [landmark, text(l['directions']), text(l['zone'])];
}

/** The catalog key for an assignment status — the rider reads words, and the
 *  enum never reaches a screen. Anything the server adds later degrades to the
 *  neutral « pending » rather than surfacing a raw token. */
export function assignmentStateKey(status: string): string {
  switch (status) {
    case 'active_unacknowledged':
      return 'assignment.state_active';
    case 'acknowledged':
      return 'assignment.state_acked';
    default:
      return 'assignment.state_pending';
  }
}

/**
 * ⚠ IS THIS RIDER ON SHIFT, ACCORDING TO THE SERVER? (blocker A4, round four.)
 *
 * Every SOS from a wired build filed `onShift: false` — because `shift` in
 * `App.tsx` is DEMO state whose only setters live in the `!WIRED` tree, so on a
 * real build it is `'off'` for the process lifetime. The alert therefore named
 * the rider's live course and denied they were working, in one object: the
 * dispatcher's board showed an off-shift rider mid-delivery. The truthful value
 * was already fetched and read by nothing.
 *
 * `shift` is deliberately opaque on `RiderSession`, so this parses only what
 * logistics actually sends — `ShiftState.status` — and returns null for
 * anything it does not recognise. **Null is not false.** « We do not know » and
 * « they are off shift » are different claims, and only one of them is safe to
 * put in a safety record.
 */
export function onShiftFromSession(shift: unknown): boolean | null {
  if (shift === null || typeof shift !== 'object') return null;
  const status = (shift as Record<string, unknown>)['status'];
  if (status === 'on_shift') return true;
  if (status === 'off_shift') return false;
  return null;
}
