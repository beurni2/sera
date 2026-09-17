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
   * Logistics-owned, per assignment — NOT one of the four custody secrets.
   * Bounded to the minted shape so nothing else can wear it on this screen.
   */
  readonly codeRamassage: string | null;
  /**
   * VRAI-ROUTE (founder ruling 2026-08-10, #4 as amended) — when the supplier
   * confirmed the rider's ramassage code, as logistics tells it. ISO-or-null,
   * bounded: a byte that does not parse as a date is DROPPED, never shown.
   */
  readonly ramassageConfirmeAt: string | null;
  /**
   * VRAI-ROUTE (same ruling) — the custody pickupVerificationCode, now
   * MACHINE-CARRIED: it arrives on this session read and the verification act
   * presents it itself. The rider never types it and no screen displays it
   * prominently. Same minted XXX-XXX bound as `codeRamassage`, distinct value.
   * It is carried in memory with the session, exactly like the rider's own
   * code — never persisted (the act-memory scan covers the persisted bytes).
   */
  readonly codeVerification: string | null;
  /**
   * ROUTE-DIRECTE (founder ruling 2026-08-10) — « terminate that sealing code
   * and the sealing photo proof requirement ». The custody seal id is
   * MACHINE-CARRIED like the pickup code above: it arrives on this read, the
   * app registers custody with it the moment the verification is accepted, and
   * presents the SAME value in the delivery evidence at the door. No screen
   * shows it, nobody types it. Its own `SC-XXXX-XXXX` shape, deliberately not
   * the pickup code's `XXX-XXX`, so the two can never be confused for each
   * other on the one read that carries both.
   */
  readonly codeScelle: string | null;
  /**
   * RETOUR-VIVANT-1 (Séra §6.4: « re-sealed in a return bag with a new
   * return-seal ») — the RETURN seal, minted by logistics beside the outbound
   * one and machine-carried the same way: the return-open act presents it,
   * custody registers it. Its OWN `RS-XXXX-XXXX` shape — deliberately not
   * the outbound seal's `SC-` nor the pickup code's `XXX-XXX`, so no seal can
   * stand in for another on the one read that carries all three. Never shown
   * prominently, never typed; `null` on a course composed before it existed.
   */
  readonly codeScelleRetour: string | null;
  /**
   * PORTE-CUSTODY part C (founder-approved 2026-08-14) — the course's payment
   * mode, as logistics carries the FUNDING FACT's word (SE-I02: the producer
   * owns the per-mode funding truth). The road turns on it: a pay-at-door
   * course inserts the §6.3 door-inspection stage before the buyer's code.
   * Bounded to the two canon modes (§5.5) and NOTHING else — `null` when
   * absent or unrecognised, never a guess: an unknown mode walks the plain
   * road and custody, the authority, refuses the drop by name if the door
   * stage was really due.
   */
  readonly paymentMode: PaymentMode | null;
  /**
   * RETOUR-VIVANT-1 (SE6.2 live) — the return handshake, the ramassage's
   * mirror. `codeRetour` is THIS rider's return key, minted by logistics the
   * moment custody said the return opened: shown to him, SAID to the supplier
   * at the counter, and presented by the handover act itself. `null` while no
   * return is open — an honest absence, never a key nobody minted. Same
   * minted `XXX-XXX` bound as the ramassage code.
   */
  readonly codeRetour: string | null;
  /** When the supplier typed the rider's return code on his own console —
   *  his acceptance of the package. ISO-or-null, bounded like every date. */
  readonly retourConfirmeAt: string | null;
  /**
   * The SUPPLIER's acceptance key, machine-carried onto this read ONLY once he
   * confirmed (logistics releases it then and not before): the handover act
   * presents it beside the rider's own, and custody consumes both or neither.
   * Never typed, never shown prominently; `null` until the supplier's word.
   */
  readonly codeRetourFournisseur: string | null;
  /**
   * REPROGRAMMATION-1 (SE6.1 live) — which attempt this course is on, as
   * logistics counts it from the follow-up task's lineage: 1 on the first
   * road, 2 once the founder fixed the next passage. Never a counter this
   * phone keeps. Bounded to a whole number ≥ 1; anything else reads as 1.
   */
  readonly passage: number;
  /**
   * The course's window, as two ISO instants — on a 2e passage it is the
   * NEXT passage the founder fixed, and the screen says so. Bounded: both
   * instants must parse, or the window is absent (never half a window).
   */
  readonly fenetre: { readonly start: string; readonly end: string } | null;
  /**
   * The ids custody's chain was opened with, as LOGISTICS opened it (the
   * first attempt's task, the order's own package). The delivery evidence
   * must name exactly these; after a relaunch — routine on a 2e passage,
   * another day — the seal answer that used to carry them is gone from the
   * phone, and this is what lets the remise still compose. Memory never
   * outranks a live answer: the seal answer's chain wins when this session
   * has one. `null` when logistics carries none — honest, never guessed.
   */
  readonly chaine: { readonly taskId: string; readonly packageId: string } | null;
  /**
   * REPROGRAMMATION-2 — when the DISPATCHER decided this rescheduled package
   * goes home (custody accepted the decision first). The screen turns to the
   * return road: the seal act and the two keys stay the rider's own. ISO or
   * null, bounded like every date.
   */
  readonly retourDecideAt: string | null;
}

function passageOrOne(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1;
}

function fenetreOrNull(v: unknown): { readonly start: string; readonly end: string } | null {
  if (v === null || typeof v !== 'object') return null;
  const w = v as Record<string, unknown>;
  const start = isoOrNull(w['start']);
  const end = isoOrNull(w['end']);
  return start === null || end === null ? null : { start, end };
}

function chaineOrNull(v: unknown): { readonly taskId: string; readonly packageId: string } | null {
  if (v === null || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const taskId = c['taskId'];
  const packageId = c['packageId'];
  if (typeof taskId !== 'string' || taskId.trim() === '' || typeof packageId !== 'string' || packageId.trim() === '') return null;
  return { taskId, packageId };
}

/**
 * The window in the rider's own words: the day, then the two hours — read in
 * the phone's locale, never composed by hand. Pure, so the screen stays thin.
 */
export function fenetreLisible(fenetre: { readonly start: string; readonly end: string }): string {
  const start = new Date(fenetre.start);
  const end = new Date(fenetre.end);
  const jour = start.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const heure = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${jour}, ${heure(start)}–${heure(end)}`;
}

/** The two canon payment modes (§5.5) — the closed set this parser admits. */
const PAYMENT_MODES = ['FULL_PREPAY', 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
function paymentModeOrNull(v: unknown): PaymentMode | null {
  return typeof v === 'string' && (PAYMENT_MODES as readonly string[]).includes(v) ? (v as PaymentMode) : null;
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

/** ROUTE-DIRECTE — the minted seal shape (`SC-XXXX-XXXX`, same unambiguous
 *  alphabet) and nothing else. Deliberately NOT `CODE_RAMASSAGE`: the two ride
 *  the same read, and a parser that accepts either would let one stand in for
 *  the other. */
const CODE_SCELLE = /^SC-[ABCDEFGHJKMNPQRSTVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTVWXYZ2-9]{4}$/;
function codeScelleOrNull(v: unknown): string | null {
  return typeof v === 'string' && CODE_SCELLE.test(v) ? v : null;
}

/** RETOUR-VIVANT-1 — the RETURN seal's own shape (`RS-XXXX-XXXX`), refused
 *  against both siblings: an outbound seal or a pickup code in this slot is
 *  dropped, never presented as the return seal. */
const CODE_SCELLE_RETOUR = /^RS-[ABCDEFGHJKMNPQRSTVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTVWXYZ2-9]{4}$/;
function codeScelleRetourOrNull(v: unknown): string | null {
  return typeof v === 'string' && CODE_SCELLE_RETOUR.test(v) ? v : null;
}

/** An ISO timestamp or nothing — a byte that is not a date is dropped, the
 *  same closed-bound law as every other field arriving over the network. */
function isoOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Date.parse(v)) ? v : null;
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
        ramassageConfirmeAt: isoOrNull(a['ramassageConfirmeAt']),
        // The machine-carried pickup code rides the SAME minted bound as the
        // ramassage code — anything else is dropped, never presented.
        codeVerification: codeRamassageOrNull(a['codeVerification']),
        // Its OWN bound — a pickup code arriving in this slot is dropped, not
        // sealed with. « The four secrets are never substituted » is enforced
        // here by shape, not by trust in the sender.
        codeScelle: codeScelleOrNull(a['codeScelle']),
        // RETOUR-VIVANT-1 — the return seal, on its OWN bound (see above).
        codeScelleRetour: codeScelleRetourOrNull(a['codeScelleRetour']),
        // The closed §5.5 set or null — a mode this app does not know walks
        // the plain road rather than inventing a door stage.
        paymentMode: paymentModeOrNull(a['paymentMode']),
        // RETOUR-VIVANT-1 — the two return keys ride the SAME minted bound as
        // the ramassage code; a stray byte in either slot is dropped, never
        // presented to custody. The seller's key is null until logistics
        // released it, and this parser does not fill that silence.
        codeRetour: codeRamassageOrNull(a['codeRetour']),
        retourConfirmeAt: isoOrNull(a['retourConfirmeAt']),
        codeRetourFournisseur: codeRamassageOrNull(a['codeRetourFournisseur']),
        // REPROGRAMMATION-1 — the attempt number, the window it names, and
        // the chain ids custody was opened with, each on its own bound.
        passage: passageOrOne(a['passage']),
        fenetre: fenetreOrNull(a['window']),
        chaine: chaineOrNull(a['chaine']),
        retourDecideAt: isoOrNull(a['retourDecideAt']),
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

/**
 * GEO-SERA-1 (founder, 2026-08-31) — the buyer's confirmed GPS point, as the
 * task's location carries it. It powers ONE act: « Itinéraire », opening the
 * phone's GPS on her exact point. SE0.3 stands untouched: the pin never
 * leads — the landmark and the words stay the navigation; this is the turn-
 * by-turn support under them. Bounded like the service's own admission
 * (finite, on the globe) — a byte outside that is null, never a destination
 * handed to a phone. Null is a lawful absence: no pin, no row.
 */
export function pinItineraire(location: unknown): { lat: number; lng: number } | null {
  if (location === null || typeof location !== 'object') return null;
  const p = (location as Record<string, unknown>)['pin'];
  if (p === null || p === undefined || typeof p !== 'object') return null;
  const lat = (p as Record<string, unknown>)['lat'];
  const lng = (p as Record<string, unknown>)['lng'];
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  return { lat, lng };
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
