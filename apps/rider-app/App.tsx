import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { seraTheme, spacing, radius, touch, type as typo, interaction, money } from '@platform/ui-tokens/legacy';
import {
  FAILURE_REASON_IDS,
  POLICY_CHECK_IDS,
  SANDBOX_DOOR_SIGNAL,
  SANDBOX_EVIDENCE_ACK,
  type PolicyCheckId,
} from './src/custody-flow';
import { SANDBOX_DISPATCH_HOURS } from './src/safety';
import { IS_PREVIEW } from './src/preview';
import { t } from './src/i18n';
import { COURSE_BACK_STEPS, JOURNEY, START, type Screen } from './src/journey';
import { attemptReturnHandover } from './src/two-key-return';
import { mintCommandId } from './src/offline/commandId';
import { appendSosRaise } from './src/offline/sos';
import { appendEvidence } from './src/offline/evidence';
import { createDocumentActMemoryStore, createDocumentOutboxStore } from './src/offline/documentStore';
import { createManualConnectivity, type Connectivity } from './src/offline/connectivity';
import { bindDeviceConnectivity } from './src/offline/expoConnectivity';
import { pendingCount, drainOnReconnect, stillPending } from './src/offline/backlog';
import type { FlushOutcome } from './src/offline/outbox';
import {
  acceptInspection,
  acknowledgeCourse,
  acknowledgeSos,
  applyEvidenceServerAck,
  applyProviderDoorSignal,
  beginPickup,
  captureEvidence,
  chooseFailureReason,
  clearSos,
  completeReturn,
  createDemoWorld,
  declineCourse,
  expireProposal,
  expireRetryWindow,
  passVerification,
  prepareReturn,
  raiseSos,
  refusePickup,
  registerSeal,
  reportProblem,
  retryDelivery,
  validateDropCode,
  type CourseKind,
  type CourseStep,
  type DemoCourse,
  type DemoWorld,
} from './src/demo/store';
import { SosButton, SosSheet, type SosState } from './src/ui/faso-sos';
import { FasoSignIn } from './src/ui/faso-signin';
import { IDLE, refusalKeys, submit as submitSignIn, type SignInState } from './src/net/signin-model';
import { isWired, resolveRiderSession } from './src/net/resolveRiderSession';
import { assignmentStateKey, landmarkLines, onShiftFromSession } from './src/net/rider-session';
import { refusServiceKey, resolveShiftActs } from './src/net/shift-acts';

/** How often a signed-in wired build re-asks `/rider/moi`. The ack window is
 *  five minutes (logistics `ACK_DEADLINE_MS`) — 20 s keeps a confided course
 *  well inside it. */
/** COURSE-BRIEF — what a verification carries when the package matched and
 *  the rider took no photo. Never shaped like a bundle ref (blocker A7). */
const SANS_PHOTO = 'sans-photo';

/** VRAI-ROUTE — the attempt-key slot while the session has not yet delivered
 *  the machine-carried verification code. Nothing is sent in that state (the
 *  port refuses locally, by name), so this value never reaches the wire; it
 *  only keys the attempt so a code arriving later is a NEW attempt. */
const SANS_CODE = 'sans-code';

const MOI_POLL_MS = 20_000;
import { resolveCustodyActs } from './src/net/resolveCustodyActs';
import { httpSosSender } from './src/net/sos-wire';
import { resolveEvidenceCapture, type CaptureOutcome } from './src/net/evidence-capture';
import { expoPhotoSource } from './src/net/expoPhotoSource';
import { ensureSha256 } from './src/offline/ensureSha256';
import { ensureCsprng } from './src/offline/ensureCsprng';

// RIDER-DELIVERY-SCREEN — the handoff photo's content hash is measured on
// this device; a bare Hermes carries no WebCrypto digest, so the expo-crypto
// shim installs one (no-op wherever the runtime already provides it).
ensureSha256();
/**
 * ⚠ « ENVOYER LA VÉRIFICATION » DID NOTHING ON DEVICE, AND THIS IS WHY
 * (founder report 2026-08-09). `mintCommandId` reads the ambient
 * `globalThis.crypto.randomUUID` and THROWS when there is none rather than
 * fall back to `Math.random` — correct, that is a custody idempotency key.
 * But nothing on a real build ever installed it: Hermes has no WebCrypto,
 * Expo's winter runtime installs TextDecoder/URL/structuredClone/FormData and
 * NO crypto, and this shim — written for exactly this and marked « wired in a
 * later slice » — was called by nobody. So `attemptFor` threw on the first
 * line of every custody act, BEFORE `runAct` could set a phase: no spinner, no
 * refusal, no outcome. A dead primary action on the custody spine, and the
 * same throw on the SOS mint and every outbox enqueue.
 *
 * Its twin above was wired; this one was not. Both must run before any mint.
 */
ensureCsprng();
import { deliveryChainOf, mintActId, type CustodyAnswer } from './src/net/custody-acts';
import {
  ACT_IDLE,
  arriveDone,
  arriveOutcome,
  departDone,
  departOutcome,
  dropDone,
  dropOutcome,
  evidenceIsHeld,
  evidenceOutcome,
  holdsPackage,
  maySeal,
  packageIsHeld,
  roadArrived,
  roadDeparted,
  sealScreenIsDue,
  sealOutcome,
  verifyOutcome,
  type ActPhase,
} from './src/net/act-model';
import { loadActMemory, rememberAct, type ActStage } from './src/net/act-memory';
import { FasoActCode, FasoCheckAnswer } from './src/ui/faso-act-code';
import { FpIn, FpPulseDot, QuoteRule as FasoQuoteRule, CornerTicks as FasoCornerTicks } from './src/ui/signature';
import { C as FASO } from './src/ui/faso';
import {
  FasoHeader,
  CourseCard as FasoCourseCard,
  ScreenTitle as FasoScreenTitle,
  PosterTitle as FasoPosterTitle,
  Card as FasoCard,
  LandmarkCard as FasoLandmarkCard,
  CheckRow as FasoCheckRow,
  SealMark as FasoSealMark,
  ProofSeal as FasoProofSeal,
  Celebration as FasoCelebration,
  TabBar as FasoTabBar,
  StatusChip as FasoStatusChip,
  Overline as FasoOverline,
  EmptyState as FasoEmptyState,
  Body as FasoBody,
  PrimaryButton as FasoPrimaryButton,
  SecondaryButton as FasoSecondaryButton,
  DangerButton as FasoDangerButton,
  GhostButton as FasoGhostButton,
  PendingNotice as FasoPendingNotice,
  OfflineBanner as FasoOfflineBanner,
  InspectionChrono as FasoInspectionChrono,
  RelaisRow as FasoRelaisRow,
  CodeCells as FasoCodeCells,
  Keypad as FasoKeypad,
  VoicePlayRow as FasoVoicePlayRow,
  type ChipTone,
} from './src/ui/faso-kit';
import { dureeVoix, mediaUrl, resolveRepereAudio, type RepereAudioEtat } from './src/net/repere-audio';
import {
  IconColis,
  IconReprendre,
  IconRefus,
  IconMoto,
  IconScelle,
  IconCamera,
  IconCle,
  IconCoche,
  type IconProps,
} from './src/ui/icons';

/**
 * WO-6.1 — LE VISAGE, Grand Teint (sera theme), over WO-4.1/4.3's walkable
 * custody world. The RESKIN law: every screen adopts the Grand Teint kit but
 * the journey spine and custody SEMANTICS stay byte-identical — same 17
 * screens, same edges, same TOTAL back law (course → liste → accueil, no pop
 * arm), same custody moves through the same demo store (which calls
 * custody-flow.ts, the rule source, and throws on any out-of-order move).
 * R1–R14 is the design bundle's vocabulary over these screens; R4 « le repère »
 * is the illustrated LandmarkCard treatment on affectation + the door, R14
 * « SOS » is an overlay mounted UNCONDITIONALLY (one gesture, every screen),
 * never a spine node. Offline law unchanged: queued = pending, never done.
 */

const C = seraTheme.colours;
const T = typo.scale;

type ShiftView = 'off' | 'pending' | 'on';

/**
 * R9 « à la porte » inspection chrono — the buyer's inspection time, shown to the
 * rider with dignity (« Le temps est noté, jamais imposé »). EPHEMERAL + DISPLAY
 * ONLY: a local count-up from door-arrival (this component mounts with the
 * door_inspection screen), ticking each second, torn down on unmount. It records
 * NOTHING and enforces NOTHING — no store write, no event, no custody field
 * (D20, founder ruling 2026-07-10: dwell is console-only in canon). Deterministic:
 * elapsed = now − start, no ETA and no model (Law #5). mm:ss is tabular so the
 * width never jitters as it ticks; the « : » is a clock separator, never a franc.
 */
function DoorChrono() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  return (
    <FasoInspectionChrono
      label={t('inspect.chrono_label')}
      time={`${mm}:${ss}`}
      note={t('inspect.chrono_note')}
    />
  );
}

/** Course-list badges: honest status per step (keys live in the catalog). */
const STATUS_KEY: Record<CourseStep, string> = {
  affectation: 'courses.statut_a_ramasser',
  verify: 'courses.statut_a_ramasser',
  seal: 'courses.statut_a_ramasser',
  refused: 'refuse.status',
  evidence: 'courses.statut_en_route',
  evidence_pending: 'evidence.pending',
  // en_route is a display waypoint, never a stored course.step — this entry is
  // type-completeness only (CourseStep = Exclude<Screen,…>); it is never read.
  en_route: 'courses.statut_en_route',
  door_inspection: 'courses.statut_en_route',
  payment_wait: 'courses.statut_en_route',
  drop: 'courses.statut_en_route',
  delivered: 'delivered.status',
  refusal_reason: 'courses.statut_en_route',
  retry_window: 'courses.statut_en_route',
  refused_final: 'refused_final.status',
  reschedule_planned: 'reschedule.status',
  retour_colis: 'courses.statut_retour_en_cours',
};

const statusKeyFor = (course: DemoCourse): string =>
  course.proposalOutcome === 'declined'
    ? 'courses.statut_rendue'
    : course.proposalOutcome === 'expired'
      ? 'courses.statut_expiree'
      : course.step === 'affectation' && course.ack === 'decline_pending'
        ? 'assignment.decline_pending'
        : course.step === 'retour_colis' && course.closed
          ? 'courses.statut_retour_fait'
          : STATUS_KEY[course.step];

/** Chip tones mirror the honest status — never a fake green, never a shame red. */
const STATUS_TONE: Record<CourseStep, ChipTone> = {
  affectation: 'info',
  verify: 'info',
  seal: 'info',
  refused: 'muted',
  evidence: 'info',
  evidence_pending: 'warn',
  en_route: 'info', // type-completeness only — en_route is never a stored course.step
  door_inspection: 'info',
  payment_wait: 'warn',
  drop: 'info',
  delivered: 'ok',
  refusal_reason: 'warn',
  retry_window: 'warn',
  refused_final: 'bad',
  reschedule_planned: 'info',
  retour_colis: 'info',
};

const toneFor = (course: DemoCourse): ChipTone =>
  course.proposalOutcome !== null
    ? 'muted' // a closed proposal is honest and at rest — never a shame red
    : course.step === 'affectation' && course.ack === 'decline_pending'
      ? 'warn' // queued = pending, never done
      : course.step === 'retour_colis' && course.closed
        ? 'ok'
        : STATUS_TONE[course.step];

/** R2 card register (planche R2): the offer window (affectation, not closed) is the
 * gold proposed card; a closed course is the receded done card; the accepted walk
 * is the hairline active card. The honest status/tone still ride the states law. */
const variantFor = (course: DemoCourse): 'proposed' | 'active' | 'done' =>
  course.closed ? 'done' : course.step === 'affectation' ? 'proposed' : 'active';

/** Course glyphs by kind — icons always paired with text (the chip + title). */
const KIND_ICON: Record<CourseKind, (p: IconProps) => React.JSX.Element> = {
  livraison: IconColis,
  deuxieme_passage: IconReprendre,
  retour: IconRefus,
};

/** The bottom hubs (WO-4.2R): Service · Courses — waypoint resets only. */
const HUBS: readonly Screen[] = ['service', 'courses'];

/** WO-4.3 — the demo's answer window for a proposed course (« Réponds
 * avant : HH:MM »). ⚠ CTO safest default: reuses WO-1.2's founder-reviewed
 * ACK_DEADLINE_MS (5 min — assignment-lease-ttl.v1). */
const proposalDeadlineHhmm = (): string => {
  const until = new Date(Date.now() + 5 * 60_000);
  return `${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`;
};

/** A fixed demo rider identity for the SOS incident (obviously not real). */
const DEMO_RIDER_ID = 'rider-moussa-demo';

/** The buyer's code is six digits (demo). The store's validateDropCode owns
 * finality; this is only the entry surface, and it exists ONLY on the drop
 * screen — which the spine makes reachable only after provider confirmation. */
const DROP_CODE_LEN = 6;

export default function App() {
  const [world, setWorld] = useState<DemoWorld>(() => createDemoWorld());
  // SERA-S3: the device-durable SOS outbox (document dir — survives kill+reboot).
  // ONE durable outbox for every rider write kind (SOS raise, delivery evidence):
  // a single document-dir queue, entries discriminated by `kind`.
  const outboxStore = useMemo(() => createDocumentOutboxStore(), []);
  /**
   * ⚠ ITS OWN FILE, NOT THE OUTBOX'S (blocker A1). Sharing one file meant two
   * incompatible top-level shapes — an array and an object — destroying each
   * other: a raised SOS that was never persisted and never sent while the sheet
   * said « Alerte en cours d'envoi… », or a custody stage silently dropped so a
   * killed app put the rider back on a spent pickup code.
   */
  const actMemoryStore = useMemo(() => createDocumentActMemoryStore(), []);
  // SERA-S4: connectivity is REAL, behind a port (expo-network on device); the
  // manual port also backs the demo toggle. `offline` is DERIVED from it — the
  // retired compile-time connectivity constant is gone. `backlog` is the REAL
  // count of pending durable writes; `persistFailed` is where a background-persist
  // failure surfaces (the offline banner is that surface).
  const net = useMemo(() => createManualConnectivity(), []);
  const [connectivity, setConnectivity] = useState<Connectivity>('online');
  const [backlog, setBacklog] = useState(0);
  const [persistFailed, setPersistFailed] = useState(false);
  const offline = connectivity === 'offline';
  const [stack, setStack] = useState<Screen[]>([START]);
  const [shift, setShift] = useState<ShiftView>('off');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Partial<Record<PolicyCheckId, boolean>>>({});
  const [windowUntil, setWindowUntil] = useState('');
  const [proposalUntil, setProposalUntil] = useState(proposalDeadlineHhmm);
  const [playing, setPlaying] = useState(false);
  // R4/R8 relais masked-call: a local calling toggle (no telephony backend at the
  // walking-skeleton stage — no number is ever dialed, so « masqué » holds).
  const [calling, setCalling] = useState(false);
  const [codeStr, setCodeStr] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const [sos, setSos] = useState<SosState>('closed');
  /**
   * ⚠ DID THIS ALERT ACTUALLY LEAVE THE PHONE? (verifier blockers A4 + A5.)
   * The sheet's own state says what the rider DID; this says what the SERVER
   * has. They are different facts and the screen must not conflate them:
   * `null` = not yet known, 'reached' = the outbox settled it against a real
   * 200, 'owed' = it is still queued and still undelivered.
   */
  const [sosDelivered, setSosDelivered] = useState<'reached' | 'owed' | null>(null);
  const [key1, setKey1] = useState(false);
  const [key2, setKey2] = useState(false);
  const [oneKeyMsg, setOneKeyMsg] = useState(false);
  /**
   * ═══ SE-LIVE-4c-v · THE DOOR, WHEN THERE IS A SÉRA TO OPEN ═══
   *
   * `WIRED` is decided at BUILD time from `EXPO_PUBLIC_SERA_LOGISTICS_BASE`:
   *
   *   WIRED   ⇒ the app asks for the rider's own code first, and shows their
   *             REAL session and REAL assignment from `GET /rider/moi`.
   *   UNWIRED ⇒ the walkable demo world, exactly as before — the founder's
   *             preview, the gallery and every existing test are untouched.
   *
   * That split is deliberate, not a hedge: a build that cannot reach Séra must
   * not present a sign-in it can never satisfy, and a build that CAN reach
   * Séra must never show demo courses beside real ones. One or the other,
   * decided once, visible in `signInState`.
   *
   * ⚠ THE CODE LIVES IN THIS STATE AND NOWHERE ELSE — held for the session so
   * the custody acts can use it as their Bearer, never written to the outbox,
   * the document store, or a log. Signing out drops it.
   */
  const [signInState, setSignInState] = useState<SignInState>(IDLE);
  const sessionPort = useMemo(() => resolveRiderSession(net), [net]);
  const WIRED = isWired();
  /**
   * ═══ SE-LIVE-4c-vi · THE RIDER'S TWO ACTS, ON THE REAL LEDGER ═══
   *
   * Founder rulings (2026-08-07): the SEAL ID IS TYPED off the seal. AMENDED
   * 2026-08-10 (#4 as amended): the pickup code stopped being a phone call —
   * it is MACHINE-CARRIED, arriving on the session read (`codeVerification`)
   * once the supplier confirms the ramassage, and the verification act
   * presents it itself. The rider never types it and no screen displays it.
   *
   * ⚠ THE COMMAND ID IS MINTED ONCE PER ACT, at the moment the rider opens
   * the screen, and every retry in this session reuses it — custody dedupes on
   * it and replays its recorded answer, so a double tap or a lost response can
   * never produce two verifications or two custody transitions. It lives in
   * memory only: an act that never reached custody left no custody record, so
   * re-doing it from the top is correct.
   *
   * ⚠ DWELL IS MEASURED, NEVER INVENTED. `PICKUP_VERIFICATION_POLICY_V1`
   * targets 120–240 s and RECORDS whether the real dwell fell inside it — it
   * does not gate on it. So this is the true elapsed time on the verification
   * screen, and a rider who is quick is recorded as quick rather than padded
   * into looking compliant.
   */
  const custodyActs = useMemo(() => resolveCustodyActs(net), [net]);
  const [verifyPhase, setVerifyPhase] = useState<ActPhase>(ACT_IDLE);
  const [sealPhase, setSealPhase] = useState<ActPhase>(ACT_IDLE);
  /** VRAI-ROUTE — the two transit facts' phases, same shape as every act:
   *  idle → working → answered, and only the LEDGER's answer moves a screen. */
  const [departPhase, setDepartPhase] = useState<ActPhase>(ACT_IDLE);
  const [arrivePhase, setArrivePhase] = useState<ActPhase>(ACT_IDLE);
  /**
   * ═══ RIDER-DELIVERY-SCREEN — what the delivery act needs, kept from the
   * moments that produced it (live-session state, deliberately) ═══
   *
   * The canon EvidenceBundle names the task, the package and the seal. The
   * SEAL is what the rider themself typed at the seal act; the TASK and
   * PACKAGE ids arrive on the BEGIN answer's `chain` — the moment this phone
   * starts holding the package is the moment it learns which one. None of it
   * is persisted (act memory keeps order + stage only, by design — a test
   * scans the persisted bytes), so an app killed mid-course loses the ids and
   * the screen says so honestly instead of inventing them.
   */
  /** The seal this course travels on. Set when the app registered custody —
   *  and, since ROUTE-DIRECTE made it machine-carried, recoverable from the
   *  SESSION after a phone restart, which is what stops a killed app from
   *  losing the remise (« il manque des repères »). */
  const [sealSaisi, setSealSaisi] = useState<string | null>(null);
  const [livraisonIds, setLivraisonIds] = useState<{ taskId: string; packageId: string } | null>(null);
  const [evidencePhase, setEvidencePhase] = useState<ActPhase>(ACT_IDLE);
  const [dropPhase, setDropPhase] = useState<ActPhase>(ACT_IDLE);
  /** `capturedAt` is part of the bundle custody FINGERPRINTS, so it is minted
   *  once per attempt and reused on retry — a moving clock would turn every
   *  retry into `command_id_reused_with_other_content`. */
  const capturedAtFor = useRef(new Map<string, string>());
  /**
   * ⚠ WHAT THIS PHONE REMEMBERS THE LEDGER SAID (verifier blocker A2, founder
   * ruling ③ « persisting act on the phone »). `act-memory.ts` was written,
   * tested and imported by NOBODY, so the harm it was built to prevent was
   * still live: an Android kill between an accepted verification and the seal
   * — routine on the 1 GB target class — put the rider back on the checklist
   * against a pickup code the spine had already spent, with no way back.
   *
   * It carries the ORDER, the STAGE and the attempt ids. Never the pickup
   * code, never the seal id, never the rider's own code.
   */
  const [remembered, setRemembered] = useState<ActStage>('none');
  /**
   * ⚠ VERIFIER BLOCKER A3 — MY RETRY REASONING WAS WRONG, AND IT POISONED THE
   * ACT. I minted the id once per mount and said that made retries safe.
   * Custody's idempotency is CONTENT-KEYED: `fingerprint()` hashes everything
   * except `command_id` and `at`, so the same id with ANY changed field is
   * `409 command_id_reused_with_other_content` — which my `readAnswer` maps to
   * « refused ». Measured on the shipped Worker: a rider mistypes the dictated
   * code, corrects it, and is told the LEDGER refused. Worse, `dwellSec` was
   * recomputed from `Date.now()` on every send, so even a byte-identical retry
   * after the 15 s timeout conflicted — and the ledger had ACCEPTED.
   *
   * THE ID NOW IDENTIFIES THE CONTENT, not the screen. A retry of the SAME
   * value reuses it (custody replays its recorded answer — a true, safe
   * retry); a CORRECTED value is a genuinely different act and gets a fresh
   * id. `attemptFor` keeps that mapping for the session.
   *
   * DWELL IS FROZEN WITH THE ATTEMPT for the same reason: it is part of the
   * fingerprint, so a moving number makes every retry a new conflict.
   */
  /**
   * ⚠ VERIFIER BLOCKER A7 — THE PROOF PHOTO IS REAL NOW, OR THE ACT DOES NOT
   * GO. Both refs used to be `ev-<uuid>`: pointers to a bundle that never
   * existed, defeating the spine's `no_evidence_refs` guard and writing a
   * dangling reference permanently into the hash-chained ledger. The ref is
   * now whatever the media bucket returned for bytes it actually stored — and
   * when there is no photo there is NO REF, so custody refuses the seal by
   * name instead of recording a fiction.
   */
  const evidence = useMemo(() => resolveEvidenceCapture(expoPhotoSource, net), [net]);
  const [verifyBundleId, setVerifyBundleId] = useState<string | null>(null);
  const [captureIssue, setCaptureIssue] = useState<CaptureOutcome | null>(null);
  const captureIssueKey = (issue: CaptureOutcome | null): string | undefined => {
    if (issue === null || issue.ok) return undefined;
    if (issue.reason === 'offline') return 'photo.offline';
    if (issue.reason === 'rejected') return 'photo.refused';
    // « Réessayez » would be false advice: this build has no bucket at all.
    if (issue.reason === 'unconfigured') return 'photo.unconfigured';
    // Nor here — the bucket is there and refused this build's key (401). The
    // rider cannot fix a key from a stall; only Séra can. Founder report
    // 2026-08-10: the seal photo never left the phone and the screen kept
    // saying « Réessayez ».
    if (issue.reason === 'refused_key') return 'photo.cle_refusee';
    return 'photo.lost';
  };
  /** Generous — the rider is framing a parcel, not filling a form — but finite.
   *  Beyond this the screen unlocks and says the photo did not arrive. */
  const CAPTURE_DEADLINE_MS = 120_000;
  const [capturing, setCapturing] = useState(false);
  const takePhoto = useCallback(
    (keep: (art: { ref: string; sha256: string | null; mimeType: string }) => void) => {
      setCaptureIssue(null);
      setCapturing(true);
      /**
       * ⚠ A CAMERA THAT NEVER ANSWERS MUST NOT LOCK THE SCREEN. While
       * `capturing` is true both the photo button and the send are disabled —
       * so a `launchCameraAsync` that never settles (a killed camera app, a
       * permission dialog the OS loses) left the rider with a screen they could
       * not use and no way out. Every other network call in this app is
       * bounded; this one was not.
       */
      let settled = false;
      const giveUp = setTimeout(() => {
        if (settled) return;
        settled = true;
        setCapturing(false);
        setCaptureIssue({ ok: false, reason: 'unreachable' });
      }, CAPTURE_DEADLINE_MS);
      void evidence.captureAndUpload().then((outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(giveUp);
        setCapturing(false);
        if (outcome.ok) keep({ ref: outcome.ref, sha256: outcome.sha256, mimeType: outcome.mimeType });
        // Cancelled is the rider's own decision — say nothing about it.
        else if (outcome.reason !== 'cancelled') setCaptureIssue(outcome);
      }, () => {
        if (settled) return;
        settled = true;
        clearTimeout(giveUp);
        setCapturing(false);
        setCaptureIssue({ ok: false, reason: 'unreachable' });
      });
    },
    [evidence],
  );

  const attempts = useRef(new Map<string, { id: ReturnType<typeof mintActId>; dwellSec: number }>());
  /**
   * ⚠ VERIFIER BLOCKER A6 — THIS CLOCK STARTED AT THE WRONG MOMENT. It was
   * `useRef(Date.now())`, initialised on FIRST RENDER — app launch, which on a
   * wired build is before the rider has even signed in — and never reset. A
   * rider who opened the app at 08:00, rode to the stall and verified at 08:25
   * after a careful three-minute inspection recorded `dwellSec ≈ 1500`, and
   * `PICKUP_VERIFICATION_POLICY_V1` (targets 120–240 s) wrote `withinTarget:
   * false` permanently against them; a relaunch just before verifying recorded
   * ~30 s. The number measured nothing, and it goes into a hash-chained ledger.
   *
   * It now starts when the rider can first SEE the package — the verification
   * screen becoming reachable — which is what a dwell is. Still frozen with the
   * attempt, because it is part of custody's fingerprint and a moving number
   * makes every retry a conflict.
   */
  const dwellStart = useRef<number>(Date.now());
  const attemptFor = useCallback((key: string) => {
    const held = attempts.current.get(key);
    if (held !== undefined) return held;
    const fresh = {
      id: mintActId(),
      // Measured, then FROZEN with this attempt — the policy records whether
      // the real dwell fell in its 120–240 s target, so it must not drift
      // between a send and its retry.
      dwellSec: Math.max(0, Math.round((Date.now() - dwellStart.current) / 1000)),
    };
    attempts.current.set(key, fresh);
    return fresh;
  }, []);

  const riderCode = signInState.kind === 'signed_in' ? signInState.code : null;
  const liveSession = signInState.kind === 'signed_in' ? signInState.session : null;
  const liveAssignment = signInState.kind === 'signed_in' ? signInState.session.assignment : null;
  const assignmentLines = liveAssignment === null ? null : landmarkLines(liveAssignment.location);

  /**
   * ═══ COURSE-BRIEF — what the rider SEES and HEARS about this course ═══
   *
   * FOUNDER ORDER (2026-08-09): the buyer's repère voice note and the
   * supplier's readiness photos now ride the course (Séra's task brief), and
   * this is where they surface. Pointers become URLs only against the app's
   * OWN media base — nothing the server says can point this phone elsewhere.
   */
  const repereAudio = useMemo(() => resolveRepereAudio(), []);
  /**
   * VOIX-ÉTAT-2 (founder 2026-08-09): « the button is not displaying the pause
   * sign and the seconds are not counting ». This state used to be a single
   * boolean the SCREEN set on tap and nothing ever cleared — so the row claimed
   * « en lecture » after the note had finished, and had no seconds to show at
   * all. It now comes from the player itself (`subscribe`), which is the only
   * thing that knows whether sound is actually coming out of the phone.
   */
  const [repereEtat, setRepereEtat] = useState<RepereAudioEtat>({ playing: false, seconds: 0, echec: false });
  useEffect(() => {
    if (repereAudio === null) return undefined;
    return repereAudio.subscribe(setRepereEtat);
  }, [repereAudio]);
  // ⚠ KEYED ON THE REF VALUES, NOT THE SESSION OBJECT. `/rider/moi` replaces
  // that object every 20 s poll, so keying on it rebuilt these on every poll
  // and remounted the <Image> subtree — on a 1 GB Android over 2G.
  const repereRef = liveAssignment?.repereAudioRef ?? null;
  const preuveKey = (liveAssignment?.preuvePhotoRefs ?? []).join('|');
  const repereUrl = useMemo(
    () => mediaUrl(process.env.EXPO_PUBLIC_SERA_MEDIA_BASE ?? null, repereRef),
    [repereRef],
  );
  const preuveUrls = useMemo(
    () =>
      (preuveKey === '' ? [] : preuveKey.split('|'))
        .map((r) => mediaUrl(process.env.EXPO_PUBLIC_SERA_MEDIA_BASE ?? null, r))
        .filter((u): u is string => u !== null),
    [preuveKey],
  );
  /**
   * The note stops when the card that offered it goes away — on ACCEPT, on a
   * course ending, and on unmount. The first cut only cleaned up on unmount,
   * which in an RN app means process death: a rider tapped « Écouter », then
   * « Accepter », and the buyer's voice kept playing with no control left on
   * screen to stop it.
   */
  const repereVisible = liveAssignment !== null && liveAssignment.status !== 'acknowledged';
  useEffect(() => {
    // `stop()` reports its own rest state through the subscription, so the row
    // goes back to « Écouter » without this screen having to assert it.
    if (!repereVisible) repereAudio?.stop();
  }, [repereVisible, repereAudio]);
  useEffect(() => () => repereAudio?.stop(), [repereAudio]);

  /**
   * « Écouter le repère » — rendered ONLY when there is a note AND something
   * that can play it; a control that cannot work is never drawn.
   *
   * ⚠ CALLED AS `{RepereVoix()}`, NEVER `<RepereVoix />` (verifier, 2026-08-09).
   * Its identity changes whenever `repereEtat` does — twice a second while a
   * note plays — and React treats a new component TYPE as a different element:
   * it would unmount and remount the Pressable + SVG subtree on every status
   * tick, on a 1 GB Android. Calling it returns the element tree into the
   * parent's own render, which reconciles by position and remounts nothing.
   */
  const RepereVoix = useCallback((): React.JSX.Element | null => {
    // No note on this course — a lawful absence. The card simply has no voice row.
    if (repereUrl === null) return null;
    /**
     * ⚠ A NOTE EXISTS AND NOTHING CAN PLAY IT — SAY SO (founder, 2026-08-09:
     * « i still do not see the audio on the sera app for the rider »).
     *
     * `resolveRepereAudio()` returns null when `require('expo-audio')` throws,
     * and it throws on any binary built before expo-audio was added: the module
     * runs `requireNativeModule('ExpoAudio')` at module scope, and an OTA
     * update ships JavaScript — it cannot register native code. The old guard
     * folded that FAULT into the same silence as « this course has no note », so
     * the rider saw an empty space with no cause and the founder could not tell
     * the two apart. Neither could I, until I read the module.
     *
     * « A control that cannot work is never drawn » was the right instinct for a
     * BUTTON; applied to a missing capability it hid a broken build. An honest
     * state names what exists, what cannot happen, and what to do instead — and
     * the written repère is right above this line, so the rider is never stuck.
     */
    if (repereAudio === null) return <FasoBody>{t('repere.voix_indisponible')}</FasoBody>;
    return (
      <>
      <FasoVoicePlayRow
        label={t(repereEtat.playing ? 'repere.voix_pause' : 'repere.voix_ecouter')}
        // Blank until the note has actually run: « 0:00 » before the first tap
        // would be a clock claiming a position in a note nobody has started.
        time={repereEtat.playing || repereEtat.seconds > 0 ? dureeVoix(repereEtat.seconds) : ''}
        playing={repereEtat.playing}
        onPress={() => {
          // The pause glyph has to MEAN something when the rider taps it.
          if (repereEtat.playing) {
            repereAudio.pause();
            return;
          }
          void repereAudio.play(repereUrl).catch(() => repereAudio.stop());
        }}
      />
      {/* VOIX-MUETTE — the player NAMED a failure (bad ref, dead network):
          say so under the row instead of an eternal « Écouter » (founder,
          2026-08-09: « I am not hearing anything »). */}
      {repereEtat.echec ? <FasoBody>{t('repere.voix_echec')}</FasoBody> : null}
    </>
    );
  }, [repereUrl, repereAudio, repereEtat]);

  /** The supplier's readiness photos — what the check-up is answered against. */
  const PreuvePhotos = useCallback((): React.JSX.Element | null => {
    if (preuveUrls.length === 0) return null;
    return (
      <FasoCard>
        <FasoBody>{t('preuve.titre')}</FasoBody>
        {preuveUrls.map((u) => (
          <Image
            key={u}
            source={{ uri: u }}
            // Capped like every other proof photo in this ecosystem: the PHOTO
            // is bounded, never the screen (founder report 2026-08-08).
            style={styles.preuvePhoto}
            resizeMode="cover"
          />
        ))}
      </FasoCard>
    );
  }, [preuveUrls]);
  const dwellOrderId = liveAssignment?.orderId ?? null;
  useEffect(() => {
    // Keyed on the ORDER: a second course starts its own clock, and the clock
    // does NOT restart under a rider who is mid-inspection of this one.
    if (dwellOrderId !== null) dwellStart.current = Date.now();
  }, [dwellOrderId]);
  /**
   * ⚠ THE ACT PHASES BELONG TO ONE COURSE. They were never reset when the
   * assignment changed — tolerable while every act was a TAP, and not now that
   * the seal fires from an effect: a rider reassigned while `sealPhase` was
   * still idle would have `beginCustody` fired for order B carrying order A's
   * accepted verification. The spine refuses that closed
   * (`verification_not_accepted`, BEFORE the seal is consumed — nothing is
   * burned), but it writes a spurious refused command into B's log and lands
   * the rider on a screen for an act that never made sense.
   *
   * Resetting on the ORDER also gives the auto-seal a legitimate second life:
   * a new course gets a fresh, idle phase instead of inheriting a spent one.
   *
   * ⚠ ALL SIX PHASES, AND THE THREE VALUES THEY LEAVE BEHIND. This list was
   * four when only the seal fired by itself; the door's bundle fires by itself
   * too now, and the omissions were not cosmetic:
   *
   *   · `evidencePhase` — a rider pulled off course A at the door and given B
   *     kept A's arrival, A's `livraisonIds` and A's seal, so the effect POSTed
   *     **A's chain ids to B's custody object**. The spine refuses that closed
   *     (`evidence_chain_mismatch`) so nothing moves, but it writes a spurious
   *     refused command into B's log and poisons the phase.
   *   · `dropPhase` — worse, and PRE-EXISTING: `dropDone(dropPhase)` stayed
   *     true across courses, so the « Livré. Merci. » celebration rendered for
   *     course B the moment its seal registered. A false delivery claim, on
   *     screen, over a package still in the rider's hands.
   *   · `livraisonIds` / `sealSaisi` / `verifyBundleId` — the values the acts
   *     compose from. Carrying one course's ids into the next is how the two
   *     above became reachable at all.
   */
  useEffect(() => {
    setVerifyPhase(ACT_IDLE);
    setSealPhase(ACT_IDLE);
    setDepartPhase(ACT_IDLE);
    setArrivePhase(ACT_IDLE);
    setEvidencePhase(ACT_IDLE);
    setDropPhase(ACT_IDLE);
    setLivraisonIds(null);
    setSealSaisi(null);
    setVerifyBundleId(null);
  }, [dwellOrderId]);

  /**
   * ⚠ THE THREE HALVES OF RULING ③ — LOAD, REMEMBER, FORGET.
   *
   * LOAD: when this rider's order becomes known, ask the phone what stage the
   * LEDGER had reached for THAT order. `loadActMemory` refuses to hand back
   * another order's stage, so a new course can never inherit a seal screen.
   */
  useEffect(() => {
    if (dwellOrderId === null) {
      setRemembered('none');
      return;
    }
    let live = true;
    void loadActMemory(actMemoryStore, dwellOrderId).then(
      (memory) => {
        if (live) setRemembered(memory?.stage ?? 'none');
      },
      // Unreadable memory is no memory — never a crash on a rider's launch.
      () => {
        if (live) setRemembered('none');
      },
    );
    return () => {
      live = false;
    };
  }, [dwellOrderId, actMemoryStore]);

  /**
   * REMEMBER: only ever what the LEDGER answered, never what was merely sent.
   * `sealScreenIsDue`/`packageIsHeld` read `phase.kind === 'answered'` first,
   * so writing a stage the server did not confirm would put a rider on a seal
   * screen for goods nobody accepted.
   */
  useEffect(() => {
    if (dwellOrderId === null) return;
    // VRAI-ROUTE: the road rungs sit ABOVE the seal on the ladder, so the
    // highest ledger-confirmed rung wins — an app killed between « En route »
    // and the door restores the arrival screen, not a spent checklist.
    const stage: ActStage | null = arriveDone(arrivePhase)
      ? 'arrived'
      : departDone(departPhase)
        ? 'departed'
        : holdsPackage(sealPhase)
          ? 'custody_taken'
          : maySeal(verifyPhase)
            ? 'verification_accepted'
            : null;
    if (stage === null) return;
    setRemembered(stage);
    void rememberAct(actMemoryStore, {
      // ORDER AND STAGE ONLY. The pickup code, the seal id and the rider's own
      // code are deliberately not here — a test scans the persisted bytes.
      orderId: dwellOrderId,
      stage,
    }).catch(() => setPersistFailed(true));
  }, [dwellOrderId, verifyPhase, sealPhase, departPhase, arrivePhase, actMemoryStore]);

  const runAct = useCallback(
    (set: (p: ActPhase) => void, act: () => Promise<CustodyAnswer>) => {
      set({ kind: 'working' });
      void act().then(
        (answer) => set({ kind: 'answered', answer }),
        // A thrown port is still an answer the rider deserves — « Séra ne
        // répond pas », never a button that spins forever.
        () => set({ kind: 'answered', answer: { kind: 'unreachable', reason: 'transport' } }),
      );
    },
    [],
  );

  const sendVerification = useCallback(
    () => {
      if (riderCode === null || liveAssignment === null) return;
      /**
       * VRAI-ROUTE (founder ruling 2026-08-10, #4 as amended) — the pickup
       * code stopped being a phone call. It is MACHINE-CARRIED: `/rider/moi`
       * delivers it (`codeVerification`) once the supplier confirms the
       * ramassage, and the act presents it itself. The rider never types it,
       * and no screen displays it. When the session carries none, the PORT
       * refuses locally by name and the screen says what is missing — never
       * an empty string on the wire, never a silent dead button.
       */
      const codeVerification = liveAssignment.codeVerification;
      /**
       * ⚠ FOUNDER RULING (2026-08-09) — THE PHOTO IS OPTIONAL HERE, AND ONLY
       * HERE. « camera capture is optional, and it's used only in case if
       * product on pick up is different from the photos. »
       *
       * What this replaces was worse than a missing feature: `if
       * (verifyBundleId === null) return;` made « Envoyer » a DEAD BUTTON
       * whenever the rider had not photographed a package that matched
       * perfectly — the tap did nothing, said nothing, and the rider had no
       * way to learn why. Now a conforming pickup sends without a photo.
       *
       * ⚠ WHAT DID NOT CHANGE: the SEAL photo (§6.2 step 6, kept mandatory on
       * his ruling). Custody still cannot begin without a picture — this only
       * stops demanding one before the rider has anything to report.
       */
      /**
       * ⚠ KEYED BY EVERY FIELD CUSTODY FINGERPRINTS — INCLUDING THE PHOTO.
       * `evidenceBundleId` was missing here while the seal key already carried
       * its refs, and custody's `fingerprint()` excludes only `command_id` and
       * `at`. So: send → 15 s deadline → « Séra ne répond pas. Réessayez. » →
       * the rider retakes the photo as part of retrying → new ref, same held
       * command_id → `409 command_id_reused_with_other_content` → the app says
       * « Séra a refusé. » If the first attempt HAD reached the ledger and been
       * accepted, the rider is now told their accepted goods were refused.
       * A new photo is a new attempt, not a retry of the old one.
       */
      const attempt = attemptFor(
        `verify|${liveAssignment.orderId}|${codeVerification ?? SANS_CODE}|${verifyBundleId ?? SANS_PHOTO}|${JSON.stringify(checks)}`,
      );
      runAct(setVerifyPhase, () =>
        custodyActs.verifyPickup(
          {
            commandId: attempt.id,
            orderId: liveAssignment.orderId,
            presentedPickupCode: codeVerification,
            /**
             * The bundle names REAL BYTES when the rider photographed a
             * difference. When the package matched and no photo was taken, the
             * value SAYS SO (`sans-photo-…`) rather than wearing the shape of a
             * bundle that was never filled — blocker A7's lesson kept while its
             * guard is lifted: a dangling `ev-<uuid>` was indistinguishable
             * from real evidence, and this can never be mistaken for it. It is
             * a CONSTANT, so the value sent is a pure function of
             * `verifyBundleId` — which is what lets the attempt key below
             * cover it exactly, instead of deriving it from the very attempt
             * it must key (custody fingerprints this field: a value the key
             * cannot see returns as `409 command_id_reused_with_other_content`).
             *
             * ⚠ AND THE SEAL'S OWN `no_evidence_refs` GUARD IS GONE TOO
             * (ROUTE-DIRECTE, 2026-08-10) — this used to say it was untouched.
             * Custody now begins on zero photos by the founder's ruling; what
             * did NOT change is that nothing here ever invents a ref.
             */
            evidenceBundleId: verifyBundleId ?? SANS_PHOTO,
            dwellSec: attempt.dwellSec,
            checkResults: checks,
          },
          riderCode,
        ),
      );
    },
    [custodyActs, riderCode, liveAssignment, checks, runAct, attemptFor, verifyBundleId],
  );

  /**
   * ═══ ROUTE-DIRECTE (founder ruling 2026-08-10) — THE SEAL IS NO LONGER A
   * SCREEN, AND NO LONGER A PHOTO ═══
   *
   * « I told you terminate that sealing code and the sealing photo proof
   * requirement. I told you after the code is confirmed from supplier the next
   * screen is prendre la route… » He is right that the flow he specified had
   * no seal step in it, and I built one in anyway.
   *
   * So the seal happens WITHOUT the rider: the id is machine-carried on
   * `/rider/moi` (`codeScelle`, minted by logistics beside the pickup code),
   * and custody is registered the instant the LEDGER accepts the verification.
   * The rider taps « Envoyer la vérification » and the next thing they see is
   * « Prendre la route ».
   *
   * ⚠ AN ACT THAT FIRES WITHOUT A TAP MUST NOT FIRE TWICE. Three things hold
   * that: `packageIsHeld` (this session's answer OR the remembered rung, so a
   * relaunch mid-course does not re-seal), the `working` guard, and the
   * command_id — `attemptFor` keys it on order+seal, so even a duplicate send
   * is the SAME command and custody replays its recorded answer instead of
   * moving custody twice.
   *
   * ⚠ NO SEAL ID, NO ACT. `codeScelle` is null on a course composed before
   * logistics minted them; the app then sends NOTHING and the screen says so.
   * It never invents one — A7's lesson, kept exactly.
   */
  const sendSeal = useCallback(
    (sealId: string) => {
      if (riderCode === null || liveAssignment === null) return;
      // The seal id the ledger binds is ALSO the one the delivery-evidence
      // bundle must present at the door. It comes from the SESSION now, so a
      // phone killed mid-course gets it back on the next read instead of
      // losing the remise.
      setSealSaisi(sealId);
      const attempt = attemptFor(`seal|${liveAssignment.orderId}|${sealId}`);
      runAct(setSealPhase, () =>
        custodyActs.beginCustody(
          {
            commandId: attempt.id,
            orderId: liveAssignment.orderId,
            custodySealId: sealId,
            // FOUNDER OVERRIDE 2026-08-10: no photo at the seal. An EMPTY list
            // is honest — the spine's guard was lifted for it, and nothing here
            // fabricates a ref to fill the gap (that was blocker A7).
            sealPhotoRefs: [],
          },
          riderCode,
        ),
      );
    },
    [custodyActs, riderCode, liveAssignment, runAct, attemptFor],
  );

  /**
   * The seal, fired by the LEDGER's acceptance rather than by a tap. Keyed on
   * the accepted verification, guarded on custody not already being held.
   */
  const scelleAuto = sealScreenIsDue(verifyPhase, remembered)
    && !packageIsHeld(sealPhase, remembered)
    && sealPhase.kind === 'idle'
    && (liveAssignment?.codeScelle ?? null) !== null;
  useEffect(() => {
    if (!WIRED || !scelleAuto) return;
    const scelle = liveAssignment?.codeScelle ?? null;
    if (scelle === null) return;
    sendSeal(scelle);
  }, [WIRED, scelleAuto, liveAssignment, sendSeal]);

  /**
   * The seal the DELIVERY evidence must present at the door — the same value
   * custody bound at pickup. This session's own act first; the session read
   * second, because `/rider/moi` carries it on every poll and that is what
   * survives an OS kill mid-course.
   */
  const sealPourRemise = sealSaisi ?? liveAssignment?.codeScelle ?? null;

  /**
   * VRAI-ROUTE — « En route » and « Je suis arrivé » are REAL transit facts
   * (Spec l.63: « custody begins → transit (one current stop) → arrival »).
   * A tap is not the fact: the LEDGER's answer is, and only it advances the
   * screen (`roadDeparted`/`roadArrived` read the answer; the remembered rung
   * fills a relaunch's gap and never outranks a live answer). One command id
   * per order and act for the session, so a double tap or a lost response
   * replays custody's recorded answer instead of writing a second transition.
   * NEVER queued offline — the port refuses honestly and the rider retries
   * here, with signal.
   */
  const sendDepart = useCallback(() => {
    if (riderCode === null || liveAssignment === null) return;
    const attempt = attemptFor(`depart|${liveAssignment.orderId}`);
    runAct(setDepartPhase, () => custodyActs.depart(riderCode, liveAssignment.orderId, attempt.id));
  }, [custodyActs, riderCode, liveAssignment, runAct, attemptFor]);

  const sendArrive = useCallback(() => {
    if (riderCode === null || liveAssignment === null) return;
    const attempt = attemptFor(`arrive|${liveAssignment.orderId}`);
    runAct(setArrivePhase, () => custodyActs.arrive(riderCode, liveAssignment.orderId, attempt.id));
  }, [custodyActs, riderCode, liveAssignment, runAct, attemptFor]);

  /** RIDER-DELIVERY-SCREEN — the BEGIN answer names the chain this phone now
   *  holds (task + package, identifiers only); keep it for the delivery act.
   *  An answer without it (an old Worker, a replayed pre-upgrade command)
   *  keeps null, and the delivery act refuses to compose rather than guess. */
  useEffect(() => {
    if (sealPhase.kind !== 'answered') return;
    const chain = deliveryChainOf(sealPhase.answer);
    if (chain !== null) setLivraisonIds(chain);
  }, [sealPhase]);

  /**
   * ═══ PORTE-SANS-PHOTO (founder ruling 2026-08-10) — « for the door photo I
   * want it gone » ═══
   *
   * The bundle still goes: it is what binds this delivery to its chain and its
   * seal, and `validation_before_evidence` refuses the drop without it. What
   * is gone is the ARTIFACT — an empty list, never a fabricated ref (A7's
   * lesson, kept exactly as it was kept at the seal).
   *
   * ⚠ AND THE KEY IS ORDER-ONLY NOW. It used to carry the photo's ref; with no
   * ref there is nothing else to vary, and a key that varied per attempt over
   * content custody FINGERPRINTS would answer every retry with
   * `409 command_id_reused_with_other_content` — which the screen reads as
   * « Séra a refusé ». Same law as the seal: one attempt, one id, retry safe.
   */
  const sendDeliveryEvidence = useCallback(() => {
    if (riderCode === null || liveAssignment === null) return;
    if (livraisonIds === null || sealPourRemise === null) return;
    const attempt = attemptFor(`delivery-evidence|${liveAssignment.orderId}`);
    const held = capturedAtFor.current.get(attempt.id) ?? new Date().toISOString();
    capturedAtFor.current.set(attempt.id, held);
    runAct(setEvidencePhase, () =>
      custodyActs.submitDeliveryEvidence(
        {
          commandId: attempt.id,
          orderId: liveAssignment.orderId,
          custodySealId: sealPourRemise,
          taskId: livraisonIds.taskId,
          packageId: livraisonIds.packageId,
          artifacts: [],
          capturedAt: held,
        },
        riderCode,
      ),
    );
  }, [custodyActs, riderCode, liveAssignment, livraisonIds, sealPourRemise, runAct, attemptFor]);

  /**
   * The bundle, fired by the ARRIVAL rather than by a tap — the founder's flow
   * is « Je suis arrivé » → the buyer's code, with nothing in between.
   *
   * ⚠ SAME THREE GUARDS AS THE SEAL, FOR THE SAME REASON. `evidenceIsHeld`
   * (this session's answer) stops a second send, `kind === 'idle'` stops a
   * re-fire while one is in flight, and the ids must both exist — so a course
   * missing them lands on the honest `delivery.ids_missing` card instead of on
   * an effect that silently returns and leaves a rider staring at nothing.
   */
  const preuveAuto = roadArrived(arrivePhase, remembered)
    && !evidenceIsHeld(evidencePhase)
    && evidencePhase.kind === 'idle'
    && livraisonIds !== null
    && sealPourRemise !== null;
  useEffect(() => {
    if (!WIRED || !preuveAuto) return;
    sendDeliveryEvidence();
  }, [WIRED, preuveAuto, sendDeliveryEvidence]);

  const sendDrop = useCallback(
    (dropCode: string) => {
      if (riderCode === null || liveAssignment === null) return;
      // The buyer's code is a custody secret: same no-offline-queue law as
      // the pickup code — the port refuses offline, nothing rests here.
      const attempt = attemptFor(`drop|${liveAssignment.orderId}|${dropCode}`);
      runAct(setDropPhase, () =>
        custodyActs.confirmDrop(
          { commandId: attempt.id, orderId: liveAssignment.orderId, dropCode },
          riderCode,
        ),
      );
    },
    [custodyActs, riderCode, liveAssignment, runAct, attemptFor],
  );

  const signIn = useCallback(
    (typed: string) => {
      setSignInState({ kind: 'working' });
      void submitSignIn(sessionPort, typed).then(setSignInState, () =>
        // A thrown port is still an answer the rider deserves: « Séra did not
        // reply », never a silent dead button.
        setSignInState({ kind: 'refused', why: 'unreachable' }),
      );
    },
    [sessionPort],
  );
  /**
   * ═══ COURSIER-EN-SERVICE — the three service acts (founder report
   * 2026-08-08: his rider could NEVER become « libre ») ═══
   *
   * The screen state afterwards is always the SERVER'S word: a shift act's 200
   * carries the registry's own new `state` and THAT is patched into the
   * session; the privacy ack patches only the flag its 200 confirmed; the
   * stale-screen refusals (`already_on_shift` / `not_on_shift`) re-ask
   * `/rider/moi` rather than guessing. Nothing here marks a rider on-shift
   * because a button was tapped (Law 7: queued = pending, never done — an
   * offline act answers `offline` and changes NOTHING).
   */
  const shiftActs = useMemo(() => resolveShiftActs(net), [net]);
  const [serviceBusy, setServiceBusy] = useState(false);
  const [serviceAvis, setServiceAvis] = useState<string | null>(null);
  const refreshSession = useCallback(() => {
    if (riderCode === null) return;
    void submitSignIn(sessionPort, riderCode).then((next) => {
      // Only a full session replaces the session — a transient refusal must
      // not sign the rider out mid-repair; the act's own sentence stands.
      if (next.kind === 'signed_in') setSignInState(next);
    }, () => void 0);
  }, [sessionPort, riderCode]);
  /**
   * ⚠ FOUNDER REPORT (2026-08-09): « I sent the coursier but nothing shows on
   * the sera app. » The session was fetched ONCE, at sign-in, and never again
   * — a course confided a minute later had no road to the screen until the
   * rider signed out and back in, and by then its five-minute ack window was
   * long dead. A signed-in wired build now re-asks `/rider/moi` on a clock;
   * what arrives is always the SERVER'S session, never an invention.
   */
  useEffect(() => {
    if (!WIRED || riderCode === null) return;
    const timer = setInterval(refreshSession, MOI_POLL_MS);
    return () => clearInterval(timer);
  }, [WIRED, riderCode, refreshSession]);
  const accepterPrivacy = useCallback(() => {
    if (riderCode === null || serviceBusy) return;
    setServiceBusy(true);
    setServiceAvis(null);
    void shiftActs.ackPrivacy(riderCode).then((r) => {
      setServiceBusy(false);
      if (r.ok) {
        setSignInState((prev) =>
          prev.kind === 'signed_in'
            ? { ...prev, session: { ...prev.session, privacyAckOk: true } }
            : prev,
        );
        return;
      }
      setServiceAvis(r.reason === 'offline' ? 'signin.offline' : 'service.act_failed');
    });
  }, [shiftActs, riderCode, serviceBusy]);
  const acteService = useCallback(
    (quel: 'start' | 'end') => {
      if (riderCode === null || serviceBusy) return;
      setServiceBusy(true);
      setServiceAvis(null);
      const act = quel === 'start' ? shiftActs.startShift(riderCode) : shiftActs.endShift(riderCode);
      void act.then((r) => {
        setServiceBusy(false);
        if (r.ok) {
          setSignInState((prev) =>
            prev.kind === 'signed_in' ? { ...prev, session: { ...prev.session, shift: r.shift } } : prev,
          );
          return;
        }
        if (r.reason === 'refused') {
          setServiceAvis(refusServiceKey(r.refus));
          // « The screen was stale » — fetch the true state; the sentence
          // above explains the jump.
          if (r.refus === 'already_on_shift' || r.refus === 'not_on_shift') refreshSession();
          return;
        }
        setServiceAvis(r.reason === 'offline' ? 'signin.offline' : 'service.act_failed');
      });
    },
    [shiftActs, riderCode, serviceBusy, refreshSession],
  );
  /**
   * SERA-FLOW — the ACCEPT (founder 2026-08-09: « it will tap and accept it »).
   * The 200 is the BOOK's word (`acknowledged`); the session is then re-asked
   * rather than patched by hope. A refusal means the course is no longer his
   * to accept — expired back to the queue or gone — said in one sentence, and
   * the refresh clears the card.
   */
  const accepterCourse = useCallback(
    (assignmentId: string) => {
      if (riderCode === null || serviceBusy) return;
      setServiceBusy(true);
      setServiceAvis(null);
      void shiftActs.accepterCourse(riderCode, assignmentId).then((r) => {
        setServiceBusy(false);
        if (r.ok) {
          refreshSession();
          return;
        }
        if (r.reason === 'refused') {
          setServiceAvis('course.repartie');
          refreshSession();
          return;
        }
        setServiceAvis(r.reason === 'offline' ? 'signin.offline' : 'service.act_failed');
      });
    },
    [shiftActs, riderCode, serviceBusy, refreshSession],
  );
  const screen = stack[stack.length - 1] ?? START;
  const active = world.courses.find((c) => c.id === activeId) ?? null;
  const allChecked = POLICY_CHECK_IDS.every((id) => checks[id] === true);
  /** ⚠ ANSWERED, not ticked (A4). `allChecked` asks « are they all conforme »;
   *  this asks « has the rider said something about every one » — the gate that
   *  stops an unfinished list ever reaching the single-use pickup code. */
  const allAnswered = POLICY_CHECK_IDS.every((id) => checks[id] !== undefined);
  /**
   * COURSE-BRIEF (founder ruling 2026-08-09) — « camera capture is optional,
   * and it's used only in case if product on pick up is different from the
   * photos. » A difference is exactly a check answered « Non »: that is when
   * the camera is offered and its sentence changes from an invitation to the
   * thing that supports the refusal (§6.1 puts the pickup cost on the seller,
   * so the picture is what makes that claim answerable).
   */
  const ecartConstate = POLICY_CHECK_IDS.some((id) => checks[id] === false);

  // SERA-S4 · the reconnect drain sender. The LIVE sender posts each queued write to
  // its service at assembly; here it models the server accepting on reconnect
  // ('applied', like SANDBOX_EVIDENCE_ACK) so the backlog drains truthfully in the
  // walkable demo. The rider never asserts this.
  /**
   * ═══ ⚠ VERIFIER BLOCKER A1 — THE SOS WAS BEING DELETED, NOT SENT ═══
   *
   * This was `async () => 'applied'` for EVERY entry, and `outbox.flush` drops
   * anything reported `applied`. So a raised SOS persisted to disk, and the
   * next reconnect — which fires on MOUNT, since connectivity initialises
   * `'online'` — marked it delivered and **erased it**. Nothing was sent, the
   * backlog cleared, and the rider believed Séra had it. 4d built
   * `httpSosSender` to fix exactly this and I never wired it; the commit
   * message claiming otherwise was false, and this is where that is undone.
   *
   * WIRED   ⇒ the real sender. An SOS settles ONLY on a server 200; anything
   *            else keeps it pending and visible in the backlog, and the next
   *            reconnect retries it with the same `command_id`.
   * UNWIRED ⇒ the demo world's stand-in, unchanged: there is no server to
   *            reach, the whole app is a walkable demo, and its own footer
   *            says so.
   *
   * ⚠ A KIND THIS SENDER DOES NOT SPEAK IS KEPT PENDING, NEVER « APPLIED ».
   * Today the wired arm creates no `delivery.evidence` entries (that capture
   * lives in the demo tree), so nothing accumulates — but if one ever appears,
   * it stays queued and counted rather than being silently dropped the way the
   * SOS was. Reporting a success we did not perform is the bug, not the
   * backlog.
   */
  const reconnectSender = useMemo(() => {
    const base = process.env.EXPO_PUBLIC_SERA_LOGISTICS_BASE;
    const code = signInState.kind === 'signed_in' ? signInState.code : null;
    if (!WIRED || base === undefined || code === null) {
      return async (): Promise<FlushOutcome> => (WIRED ? 'collision-refused' : 'applied');
    }
    return httpSosSender(base, code);
  }, [WIRED, signInState]);
  const refreshBacklog = useCallback(() => {
    // a durable-read failure is itself a durability-health signal → surface it,
    // never an unhandled rejection.
    void pendingCount(outboxStore).then(setBacklog, () => setPersistFailed(true));
  }, [outboxStore]);
  // The port drives `connectivity`; on device expo-network feeds the same port.
  useEffect(() => {
    const unsubscribe = net.subscribe(setConnectivity);
    const unbind = bindDeviceConnectivity(net);
    return () => {
      unsubscribe();
      unbind();
    };
  }, [net]);
  // Reconnect → flush the durable outbox, the banner clears with the backlog; offline
  // just re-counts what is queued (queued = pending, never done — SE-I06 family).
  useEffect(() => {
    if (connectivity === 'online') {
      void drainOnReconnect(outboxStore, reconnectSender).then((remaining) => {
        setBacklog(remaining);
        if (remaining === 0) setPersistFailed(false);
      });
    } else {
      refreshBacklog();
    }
  }, [connectivity, outboxStore, reconnectSender, refreshBacklog]);

  // SOS hold timer — a deliberate HOLD fires the SOS; released or unmounted, it
  // is cleared. There are NO post-fire timers: the acknowledgment comes from the
  // store (a real dispatch/network response), never a fake countdown.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);
  useEffect(() => clearHold, [clearHold]);

  const go = useCallback((next: Screen) => {
    if (!JOURNEY[stack[stack.length - 1] ?? START].includes(next)) return;
    setStack((s) => [...s, next]);
  }, [stack]);
  // The course list is a fixed waypoint, never a pushed layer: every in-course
  // « Retour aux courses » lands here, so the list can never sit above a stale
  // course screen (the verifier's push-then-pop route).
  const toCourses = useCallback(() => setStack([START, 'courses']), []);
  /**
   * BACK TO WAITING — `service` is the rider's initial, available state, and
   * `setStack([START])` makes it the WHOLE stack: nothing of the finished course
   * is left behind to pop back into. The delivered screen's one action uses it.
   */
  const enService = useCallback(() => setStack([START]), []);
  const back = useCallback(() => {
    // WO-4.1 rule (journaled; a TOTAL rule after two verifier findings — stale
    // in-course screens must be unreachable BY CONSTRUCTION): a course's truth
    // lives in course.step, so no course screen is ever revealed by popping.
    // « Retour » on a course screen goes to the course list; on the list it
    // goes home; on the root it does nothing. No pop arm exists.
    const current = stack[stack.length - 1] ?? START;
    if (current === 'courses') {
      setStack([START]);
      return;
    }
    if (COURSE_BACK_STEPS.includes(current)) {
      setStack([START, 'courses']);
    }
  }, [stack]);
  const reset = useCallback(() => {
    clearHold();
    // createDemoWorld() also clears any incident (incident: null).
    setWorld(createDemoWorld());
    setStack([START]);
    setShift('off');
    net.set('online');
    setBacklog(0);
    setPersistFailed(false);
    setActiveId(null);
    setChecks({});
    setWindowUntil('');
    setProposalUntil(proposalDeadlineHhmm());
    setPlaying(false);
    setCalling(false);
    setCodeStr('');
    setCelebrate(false);
    setSos('closed');
    setKey1(false);
    setKey2(false);
    setOneKeyMsg(false);
  }, [clearHold, net]);

  /** Every custody move: the store calls custody-flow (throws out-of-order),
   * the world re-renders, the stack follows the rule's outcome. */
  const walk = useCallback((move: (w: DemoWorld) => CourseStep) => {
    const next = move(world);
    setWorld({ ...world });
    go(next);
  }, [world, go]);

  const openCourse = useCallback((course: DemoCourse) => {
    setActiveId(course.id);
    setChecks({});
    setCodeStr('');
    setPlaying(false);
    setCalling(false);
    setKey1(false);
    setKey2(false);
    setOneKeyMsg(false);
    go(course.step);
  }, [go]);

  // The arrival celebration fires when the drop code lands the course at
  // 'delivered' — ≤ 800 ms, non-blocking, tap-to-skip, static under reduced
  // motion (the component owns that).
  useEffect(() => {
    if (screen === 'delivered') setCelebrate(true);
  }, [screen]);

  // SOS — one gesture from any screen; opening only reveals the sheet, firing
  // requires a deliberate HOLD (neither accidental nor missable).
  const openSos = useCallback(() => {
    setSosDelivered(null);
    setSos('confirm');
  }, []);
  const cancelSos = useCallback(() => {
    clearHold();
    setSos('closed');
  }, [clearHold]);
  // Firing builds the REAL incident in the store (custody-safe: no course is
  // read or moved) and drives the sheet from its honest status — queued
  // (offline, no ack) / raised (in-hours) / escalated (out-of-hours). SERA-S4:
  // the connectivity is now the REAL port signal (the dispatch-hours stay a typed
  // sandbox value the live roster feed drives at assembly).
  const fireSos = useCallback(() => {
    // SERA-S3: mint the command_id ONCE at the gesture (the incident's stable
    // identity), raise the in-memory incident INSTANTLY (a safety SOS never waits
    // on disk), then persist the raise to the outbox in the background — so it
    // survives a kill+reboot and flushes at-least-once with dedup on this id.
    const commandId = mintCommandId();
    /**
     * ⚠ VERIFIER BLOCKER A9 — EVERY SOS FROM A WIRED BUILD MISREPORTED ITSELF.
     * `DEMO_RIDER_ID` ('rider-moussa-demo') went into the payload; `onShift`
     * was always false (the shift control lives in the demo tree, which a
     * wired build never renders) and `activeCourseId` always null. The
     * dispatcher would have been handed an alert naming a rider who does not
     * exist. On a wired build the identity is the SIGNED-IN rider and the
     * course is their live assignment; the SERVER overrides `riderId` from the
     * code regardless, but sending a fiction was indefensible.
     */
    const sosRiderId = WIRED ? (signInState.kind === 'signed_in' ? signInState.session.riderId : '') : DEMO_RIDER_ID;
    const sosCourseId = WIRED ? (liveAssignment?.orderId ?? null) : activeId;
    /**
     * ⚠ FROM THE SERVER, NOT THE DEMO TOGGLE (blocker A4). `shift` is demo
     * state whose setters all live in the `!WIRED` tree, so a wired build filed
     * every alert as `onShift: false` WHILE NAMING THE RIDER'S LIVE COURSE —
     * one object contradicting itself on the dispatcher's safety board. When
     * the server's answer is unrecognisable we send the live-course fact rather
     * than asserting a shift state nobody confirmed.
     */
    const sosOnShift = WIRED
      ? (onShiftFromSession(signInState.kind === 'signed_in' ? signInState.session.shift : null)
         ?? sosCourseId !== null)
      : shift === 'on';
    const raised = raiseSos(world, commandId, {
      riderId: sosRiderId,
      onShift: sosOnShift,
      activeCourseId: sosCourseId,
      connectivity,
      hours: SANDBOX_DISPATCH_HOURS,
    });
    setWorld({ ...world });
    // SERA-S4: the S3-named `.catch` hardening lands here — a background-persist
    // failure routes to the banner surface (persistFailed); success refreshes the
    // real backlog count. The safety incident already showed instantly regardless.
    void appendSosRaise(outboxStore, commandId, {
      riderId: sosRiderId,
      hours: SANDBOX_DISPATCH_HOURS,
      onShift: sosOnShift,
      activeCourseId: sosCourseId,
      raisedAt: raised.raisedAt,
    })
      .then(async () => {
        /**
         * ⚠ VERIFIER BLOCKER A4 — THE ALERT WAS NOT SENT WHEN IT WAS RAISED.
         * Appending to the outbox was the whole of `fireSos`, and the only
         * caller of the sender is the reconnect effect, whose deps
         * (`connectivity`, `outboxStore`, `reconnectSender`, `refreshBacklog`)
         * this function changes NONE of. So a rider in danger, online, signed
         * in, held the disc — and the raise sat on the handset until the
         * device happened to bounce offline→online. The wire built in 4d was
         * never reached on the one path it exists for.
         *
         * It is sent HERE, now, and the entry keeps its persisted command_id,
         * so the reconnect drain remains the safety net rather than the plan.
         */
        if (connectivity === 'online') await drainOnReconnect(outboxStore, reconnectSender);
        // Delivered = the outbox no longer owes it. Never inferred from « the
        // request did not throw ».
        setSosDelivered((await stillPending(outboxStore, commandId)) ? 'owed' : 'reached');
        await refreshBacklog();
      }, () => setPersistFailed(true));
    const status = raised.status;
    if (status === 'queued') setSos('queued');
    else if (status === 'escalated') setSos('escalated');
    else if (status === 'acknowledged') setSos('acknowledged');
    else setSos('raised');
  }, [world, shift, activeId, connectivity, outboxStore, refreshBacklog, reconnectSender, WIRED, signInState, liveAssignment]);
  const sosHoldStart = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(fireSos, 650);
  }, [fireSos]);
  const sosHoldEnd = useCallback(() => clearHold(), [clearHold]);
  // The rider CANNOT self-acknowledge. This is the dispatch/network response
  // arriving — a SANDBOX stand-in that drives the store's acknowledgeSos (which
  // THROWS on a queued incident), never the rider's own hand.
  const sosSandboxAck = useCallback(() => {
    /**
     * ⚠ VERIFIER BLOCKER A2, THE HALF I MISSED. My first fix changed the
     * `raised` words on a wired build but left this preview button, so ONE TAP
     * still flipped the sheet to « On vous a vu. / Quelqu'un arrive pour
     * vous. » — the same false promise, on a build a real rider signs into.
     * The stand-in exists to make the demo walkable; on a wired build there is
     * a real dispatcher and a real ack, and nothing here may stand in for
     * either.
     */
    if (WIRED) return;
    if (world.incident === null) return;
    acknowledgeSos(world, world.incident.responder);
    setWorld({ ...world });
    setSos('acknowledged');
  }, [world, WIRED]);
  const sosSafe = useCallback(() => setSos('over'), []);
  const sosClose = useCallback(() => {
    clearSos(world);
    setWorld({ ...world });
    clearHold();
    setSos('closed');
  }, [world, clearHold]);

  const arriving = world.courses.find((c) => !c.closed && c.step === 'affectation') ?? null;
  const shiftAction = shift === 'off' ? t('shift.start_action') : t('shift.end_action');

  /**
   * ⚠ THE CHIP MUST NOT ASSERT A SHIFT NOBODY CONFIRMED (blocker A4). `shift`
   * is demo state, so a wired build stamped « Hors service » on EVERY screen —
   * including the one where the rider is holding a sealed package. Same class
   * as the certified-name blocker: a status claim about state this build
   * neither owns nor confirms. On a wired build it names the screen instead,
   * unless the server actually said the rider is on shift.
   */
  const wiredOnShift = WIRED
    ? onShiftFromSession(signInState.kind === 'signed_in' ? signInState.session.shift : null)
    : shift === 'on';
  const headerChip = WIRED
    ? (wiredOnShift === true ? t('shift.on') : t('assignment.title'))
    : screen === 'service'
      ? (shift === 'on' ? t('shift.on') : t('shift.off'))
      : t('assignment.title');

  /**
   * ⚠ THE DEMO ROW STOPPED CLAIMING PLAYBACK IT CANNOT DELIVER (verifier,
   * 2026-08-09). This tree has NO audio element at all — `playing` was a local
   * toggle and `time` a hardcoded string. That was merely inert while the row
   * always drew a triangle; the moment `VoicePlayRow` learned to swap glyphs it
   * became the founder's exact reported symptom, manufactured: a pause sign and
   * a frozen clock over total silence, on the build a bare `expo start` opens.
   *
   * A specimen row may be sparse; it may not lie. `playing` is now false for
   * ever here and the clock is blank — the REAL row (`RepereVoix`, wired arm)
   * is the one that reports, because it is the one with a player behind it.
   */
  const voiceFor = () => ({
    label: t('repere.voice'),
    time: '',
    playing: false,
    onPress: () => setPlaying((p) => !p),
  });
  // R4/R8 relais props — the masked-call affordance, shared across the repère
  // screens (affectation · en_route · door). A local toggle; no number dialed.
  const relaisFor = () => ({
    calling,
    callLabel: t('relais.call'),
    privacyLabel: t('relais.privacy'),
    hangUpLabel: t('relais.hang_up'),
    onToggle: () => setCalling((c) => !c),
  });
  // The seal ID's digit grouping uses the canon narrow-no-break-space (U+202F,
  // money.groupSeparator) — the one place any grouping surfaces in Séra, which
  // carries NO franc amount anywhere. Its glyph is whitespace; the fallback
  // system face carries it, so no tofu.
  const SEAL_ID = `SC-77${money.groupSeparator}412`;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" backgroundColor={C.paper} />
      {/* Full-bleed scroll: the SCREEN is the scroll surface. The chrome (header +
          banners) scrolls WITH the content — NO nested scroll containers, no fixed-
          region-under-fixed-chrome. The tab dock + the SOS disc stay fixed below. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* R1's chrome retired: the Faso monogram header (planche l.32–42) — the woven
            strip, the « S » monogram, the « Séra » identity + the rider certification,
            the right state chip. The screen NAME lives in each view's body title. */}
        <FasoHeader
        title={t('app.title')}
        /**
         * ⚠ VERIFIER BLOCKER A6 — THE DOOR ASSERTED ANOTHER RIDER'S IDENTITY.
         * This was unconditionally `service.certified_name` (« Moussa K. ·
         * Séra 2026 »), rendered directly above « Votre code » — a WIRED
         * build's sign-in screen claimed a certified rider that no server had
         * confirmed and who was not the person holding the phone. On a wired
         * build the subtitle is now the rider logistics actually named, and
         * before sign-in it claims nothing at all.
         */
        subtitle={
          WIRED
            ? (signInState.kind === 'signed_in' ? signInState.session.displayName : undefined)
            : t('service.certified_name')
        }
        backLabel={`‹ ${t('nav.retour')}`}
        onBack={stack.length > 1 ? back : undefined}
        right={<FasoStatusChip tone={wiredOnShift === true ? 'ok' : 'muted'} label={headerChip} />}
      />
      {offline && (
        <FasoOfflineBanner
          label={
            backlog === 0
              ? t('offline.banner')
              : `${t('offline.backlog_prefix')} ${backlog} ${backlog === 1 ? t('offline.backlog_suffix_one') : t('offline.backlog_suffix_many')}`
          }
        />
      )}
      {/* SERA-S4: a background-persist failure surfaces HERE (the CTO's banner
          surface) — honest « à réessayer », never a lost-in-silence write. */}
      {persistFailed && <FasoPendingNotice lines={[t('offline.persist_failed')]} />}
      {IS_PREVIEW && (
        <View style={styles.previewBanner}>
          <Text style={styles.previewBannerText}>{t('preview.banner')}</Text>
        </View>
      )}

        {/* Each screen block is FpIn-wrapped (the planche fpIn entry), which
            re-animates on screen change — the per-screen entry replaces the old
            cross-screen ScreenTransition (redundant + flex:1 broke the scroll). */}
        <View style={styles.content}>
          {/**
            * ═══ SE-LIVE-4c-v · THE DOOR, WHEN THERE IS A SÉRA TO OPEN ═══
            *
            * `WIRED` is decided at BUILD time from
            * `EXPO_PUBLIC_SERA_LOGISTICS_BASE`:
            *   WIRED   ⇒ the rider's own code first, then their REAL session.
            *   UNWIRED ⇒ the walkable demo world, exactly as before — the
            *             founder's preview and the gallery are untouched.
            * One or the other, never both: a build that can reach Séra must
            * never show demo courses beside real ones.
            *
            * ⚠ IT LIVES INSIDE THE ONE SCROLL SURFACE, NOT BESIDE IT. My first
            * cut early-returned a whole second shell — its own safe area and its
            * own scroll container — and two pinned invariants caught it, rightly:
            *   · `faso-scroll`: exactly ONE scroll surface in this app;
            *   · `wo6-invariants` R14: **the SOS is mounted unconditionally,
            *     outside every screen branch.**
            * The second was a genuine design error, not a test to bend. A rider
            * in danger must not have to sign in first — « SOS visible from
            * every rider screen » (Building Plan) means THIS screen too, and my
            * comment justifying its absence reasoned about how useful the data
            * would be to a dispatcher rather than about the person holding the
            * phone. Rendering here gives the sign-in the header, the offline
            * banner and the SOS disc for free, because it is simply another
            * screen in the one tree.
            */}
          {WIRED && signInState.kind !== 'signed_in' ? (
            <FpIn style={styles.stackGap}>
              <FasoSignIn
                strings={{
                  title: t('signin.title'),
                  hint: t('signin.hint'),
                  action: t('signin.action'),
                  working: t('signin.working'),
                  placeholder: t('signin.placeholder'),
                }}
                working={signInState.kind === 'working'}
                refusal={
                  signInState.kind === 'refused'
                    ? { title: t(refusalKeys(signInState.why).title), hint: t(refusalKeys(signInState.why).hint) }
                    : undefined
                }
                onSubmit={signIn}
              />
            </FpIn>
          ) : WIRED ? (
            /**
             * ⚠ VERIFIER BLOCKER A3 — A SIGNED-IN RIDER WAS SHOWN THE DEMO
             * WORLD. The gate only covered the SIGN-IN; the success arm fell
             * straight through to the demo tree, so a rider holding a real,
             * server-verified session walked a full verify → seal → drop →
             * « Course validée » flow that **no ledger anywhere recorded**.
             * That is the exact sentence this slice's own journal claimed was
             * impossible (« a build that can reach Séra must never show demo
             * courses beside real ones ») and it is §9.8 on the custody path.
             *
             * A WIRED BUILD NOW SHOWS ONLY WHAT A SERVER SAID. That is the
             * rider's identity and their one live assignment from
             * `GET /rider/moi` — no demo courses, no demo checklist, no demo
             * seal, no demo drop code.
             *
             * AND IT SAYS WHAT IS MISSING RATHER THAN MIMING IT. The
             * verification and seal acts exist as proven ports but have no
             * input surface yet (the app never collects a `pickupVerificationCode`
             * and has no real `custodySealId`), and how a rider receives those
             * two secrets is a founder question, not mine. So this screen ends
             * honestly at « la vérification et le scellé arrivent bientôt »
             * instead of offering a button that would record nothing.
             */
            <FpIn style={styles.stackGap}>
              <FasoScreenTitle>{t('signin.greeting')}</FasoScreenTitle>
              {/**
                * ═══ COURSIER-EN-SERVICE (founder report 2026-08-08) ═══
                *
                * The wired arm showed identity and assignment and NOTHING of
                * the road that makes assignment possible: SE1's ladder —
                * certified (Séra's act) → privacy ack → « Commencer service »
                * (the spec's own Travail tab) — had no surface, so every
                * wired rider was off-shift for ever and the founder's
                * dispatch screen honestly said « aucun coursier libre » with
                * no way anywhere to change it. The ladder renders here, one
                * rung at a time, one primary action per screen; every state
                * shown is the SERVER'S answer, never a tap's echo.
                */}
              {serviceAvis !== null ? (
                <FasoCard>
                  <FasoBody>{t(serviceAvis)}</FasoBody>
                </FasoCard>
              ) : null}
              {liveSession !== null && !liveSession.certified ? (
                /* Only Séra can certify — honest, with the person to ask. */
                <FasoCard>
                  <FasoBody>{t('service.non_certifie')}</FasoBody>
                </FasoCard>
              ) : liveSession !== null && !liveSession.privacyAckOk ? (
                <>
                  <FasoPosterTitle>{t('privacy.title')}</FasoPosterTitle>
                  <FasoCard>
                    <FasoBody>{t('privacy.body')}</FasoBody>
                  </FasoCard>
                  <FasoPrimaryButton
                    label={t(serviceBusy ? 'acts.sending' : 'privacy.accept')}
                    disabled={serviceBusy}
                    onPress={accepterPrivacy}
                  />
                </>
              ) : liveSession !== null && onShiftFromSession(liveSession.shift) === false ? (
                <>
                  <FasoPosterTitle>{t('service.off_title')}</FasoPosterTitle>
                  <FasoBody>{t('service.off_body')}</FasoBody>
                  <FasoCard>
                    <FasoBody>{t('service.location_note')}</FasoBody>
                  </FasoCard>
                  <FasoPrimaryButton
                    label={t(serviceBusy ? 'acts.sending' : 'shift.start_action')}
                    disabled={serviceBusy}
                    onPress={() => acteService('start')}
                  />
                </>
              ) : liveAssignment !== null && liveAssignment.status !== 'acknowledged' ? (
                /**
                 * ═══ SERA-FLOW — THE PROPOSAL (founder 2026-08-09): the course
                 * arrives, the rider SEES it and ACCEPTS it — before any
                 * custody act. Until now the wired arm dropped a rider
                 * straight onto the verification checklist of a course they
                 * had never said yes to, and the book's five-minute ack
                 * window ran out unanswered. The place leads (landmark
                 * first); the deadline is stated; the one primary action is
                 * the acceptance.
                 */
                <>
                  <FasoPosterTitle>{t('course.proposee_titre')}</FasoPosterTitle>
                  {assignmentLines !== null ? (
                    <FasoLandmarkCard
                      zone={assignmentLines[2]}
                      lines={assignmentLines}
                      repereLabel={t('assignment.landmark_label')}
                      indicationsLabel={t('repere.indications')}
                    />
                  ) : (
                    <FasoCard>
                      <ProofLine label={t('assignment.no_landmark')} />
                    </FasoCard>
                  )}
                  {/* COURSE-BRIEF: the buyer's own voice, where someone is
                      actually looking for the door. */}
                  {RepereVoix()}
                  <PreuvePhotos />
                  {liveAssignment.ackDeadline !== null ? (
                    <FasoBody>
                      {`${t('courses.before')} ${new Date(liveAssignment.ackDeadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </FasoBody>
                  ) : null}
                  <FasoBody>{t('course.proposee_aide')}</FasoBody>
                  <FasoPrimaryButton
                    label={t(serviceBusy ? 'acts.sending' : 'course.accepter')}
                    disabled={serviceBusy}
                    onPress={() => accepterCourse(liveAssignment.assignmentId)}
                  />
                </>
              ) : liveAssignment !== null ? (
                <>
                  {/**
                    * ⚠ LANDMARK-FIRST, NOT IDENTIFIERS (verifier blocker A10).
                    * This card read « État · active_unacknowledged » and
                    * « Course · task-<uuid> »: the server's own English enums
                    * and UUIDs, inline where the copy-lint cannot see them,
                    * and useless to someone navigating by « la pharmacie du
                    * marché ». SE0.3 fixed this display order for BOTH shells
                    * — landmark, then indications, then zone; the GPS pin
                    * never leads — and the demo screen has always rendered it
                    * that way. The wired arm now uses the SAME card and the
                    * SAME catalog labels; the ids stay server-side.
                    */}
                  {assignmentLines !== null ? (
                    <FasoLandmarkCard
                      zone={assignmentLines[2]}
                      lines={assignmentLines}
                      repereLabel={t('assignment.landmark_label')}
                      indicationsLabel={t('repere.indications')}
                    />
                  ) : (
                    /* Honest: the server has sent no usable landmark yet.
                       Never an invented address, never a raw id instead. */
                    <FasoCard>
                      <ProofLine label={t('assignment.no_landmark')} />
                    </FasoCard>
                  )}
                  <FasoStatusChip tone="info" label={t(assignmentStateKey(liveAssignment.status))} />

                  {/* RAMASSAGE (founder order 2026-08-09) — the handover code
                      the rider SAYS to the supplier at the stall; the
                      supplier's console confirms it before handing the
                      package over. SE5's two-party pickup, the supplier's
                      half — logistics-owned, and NOT the custody pickup code,
                      which rides the session and is never typed or shown
                      (VRAI-ROUTE), nor the seal, machine-carried too since
                      ROUTE-DIRECTE. */}
                  {liveAssignment.codeRamassage !== null ? (
                    <>
                      <FasoSealMark code={liveAssignment.codeRamassage} label={t('ramassage.titre')} />
                      <FasoBody>{t('ramassage.dire')}</FasoBody>
                    </>
                  ) : null}

                  {/**
                    * ⚠ SE-I05, IN THE ORDER THE SPEC GIVES IT: « Custody begins
                    * only after rider pickup verification AND custody-seal
                    * registration. » So the seal screen does not exist for the
                    * rider until the LEDGER has accepted the verification —
                    * `maySeal` reads the server's answer, never « the request
                    * worked ». A refused package stops here, with the seller
                    * keeping it, which is the correct and safe end.
                    */}
                  {packageIsHeld(sealPhase, remembered) ? (
                    /**
                     * ═══ RIDER-DELIVERY-SCREEN (founder order 2026-08-08) ═══
                     *
                     * The road §63 fixes, on the proven port: the handoff
                     * PHOTO (evidence — it SUPPORTS, never releases) → the
                     * BUYER'S CODE, entered LAST, on this device → done, by
                     * the LEDGER's word (`custody_with_customer`), never by a
                     * tap. Validation is the FOUNDER'S act on his own door —
                     * a carrier never validates their own delivery, so a
                     * too-early code is answered with the honest waiting
                     * sentence, not an error wall.
                     */
                    dropDone(dropPhase) ? (
                      /**
                       * ═══ THE END OF A COURSE HAD NO WAY OUT (verifier BLOCKER,
                       *     2026-08-12) — AND IT WAS THE SHIPPED BUILD ═══
                       *
                       * Founder: « once delivery … is confirmé … make it close
                       * nicely and return to the initial state waiting for
                       * another order. » The first attempt edited the `delivered`
                       * screen — which lives in the DEMO arm of this tree and is
                       * never rendered by a wired build. THIS is the screen a
                       * real rider reaches, and it was a dead end: the
                       * celebration's only handler was `() => void 0`, there is
                       * no timer, the stack is `[START]` so the header carries no
                       * back, and the footer and tab bar are both `!WIRED`. After
                       * every real delivery the only live control left on screen
                       * was SOS.
                       *
                       * Clearing the act's phase is what closes it: this arm is
                       * chosen by `dropDone(dropPhase)`, so returning the phase to
                       * idle returns him to his live view — in a wired build that
                       * IS the waiting state, since the whole tree is one screen
                       * driven by `/rider/moi`.
                       *
                       * TWO WAYS OUT ON PURPOSE, and neither is a hidden gesture:
                       * the scrim still answers a tap (it always looked like it
                       * should), and a NAMED primary button says what it does. A
                       * screen whose only exit is « tap somewhere » is the same
                       * failure one step quieter.
                       */
                      <FasoCard>
                        <FasoCelebration
                          label={t('delivery.done')}
                          sublabel={t('delivery.done_next')}
                          actionNote={t('delivered.retour_service')}
                          actionLabel={t('delivered.fermer')}
                          onDone={() => setDropPhase(ACT_IDLE)}
                        />
                      </FasoCard>
                    ) : (
                      <>
                        <FasoCard>
                          <ProofLine label={t('acts.custody_taken')} />
                        </FasoCard>
                        {/**
                          * ═══ VRAI-ROUTE (founder ruling 2026-08-10) — THE ROAD
                          * IS REAL ═══
                          *
                          * Spec l.63: « custody begins → transit (one current
                          * stop) → arrival + buyer inspection … buyerDropCode
                          * entered last ». After the seal the screen becomes
                          * the ROAD: one primary action « En route » (a real
                          * transit fact on the ledger), then the destination
                          * with ONE primary action « Je suis arrivé » (a real
                          * arrival fact), and then the buyer's code — the door
                          * photo between them is gone (PORTE-SANS-PHOTO,
                          * founder ruling 2026-08-10). Each screen advances on the
                          * LEDGER's answer, never on the tap; a refusal or an
                          * offline gets its honest sentence in place.
                          */}
                        {!roadDeparted(departPhase, remembered) ? (
                          <>
                            <FasoPosterTitle>{t('route.depart_titre')}</FasoPosterTitle>
                            <FasoBody>{t('route.depart_body')}</FasoBody>
                            <FasoPrimaryButton
                              label={t(departPhase.kind === 'working' ? 'acts.sending' : 'route.en_route_action')}
                              disabled={departPhase.kind === 'working'}
                              onPress={sendDepart}
                            />
                            {departPhase.kind === 'answered' ? (
                              (() => {
                                const o = departOutcome(departPhase.answer);
                                return (
                                  <>
                                    <FasoStatusChip
                                      tone={o.tone === 'ok' ? 'ok' : o.tone === 'waiting' ? 'info' : 'bad'}
                                      label={t(o.title)}
                                    />
                                    {o.hint === undefined ? null : <FasoBody>{t(o.hint)}</FasoBody>}
                                  </>
                                );
                              })()
                            ) : null}
                          </>
                        ) : !roadArrived(arrivePhase, remembered) ? (
                          <>
                            <FasoPosterTitle>{t('route.arrivee_titre')}</FasoPosterTitle>
                            {/* The destination leads — the same landmark-first
                                card as everywhere (SE0.3: repère, indications,
                                zone; the GPS pin never leads). */}
                            {assignmentLines !== null ? (
                              <FasoLandmarkCard
                                zone={assignmentLines[2]}
                                lines={assignmentLines}
                                repereLabel={t('assignment.landmark_label')}
                                indicationsLabel={t('repere.indications')}
                              />
                            ) : (
                              <FasoCard>
                                <ProofLine label={t('assignment.no_landmark')} />
                              </FasoCard>
                            )}
                            <FasoBody>{t('route.arrivee_body')}</FasoBody>
                            <FasoPrimaryButton
                              label={t(arrivePhase.kind === 'working' ? 'acts.sending' : 'route.arrive_action')}
                              disabled={arrivePhase.kind === 'working'}
                              onPress={sendArrive}
                            />
                            {arrivePhase.kind === 'answered' ? (
                              (() => {
                                const o = arriveOutcome(arrivePhase.answer);
                                return (
                                  <>
                                    <FasoStatusChip
                                      tone={o.tone === 'ok' ? 'ok' : o.tone === 'waiting' ? 'info' : 'bad'}
                                      label={t(o.title)}
                                    />
                                    {o.hint === undefined ? null : <FasoBody>{t(o.hint)}</FasoBody>}
                                  </>
                                );
                              })()
                            ) : null}
                          </>
                        ) : !evidenceIsHeld(evidencePhase) ? (
                          /**
                           * ═══ PORTE-SANS-PHOTO — THERE IS NO PHOTO SCREEN AT
                           * THE DOOR ANY MORE (founder ruling 2026-08-10) ═══
                           *
                           * « for the door photo I want it gone. » So this arm
                           * is not a screen the rider works either: it is the
                           * half-second while the bundle the arrival fired
                           * registers itself, and the honest sentence for the
                           * ways it can fail to land. On success
                           * `evidenceIsHeld` flips and the buyer's code screen
                           * takes over.
                           */
                          <>
                            <FasoPosterTitle>{t('delivery.title')}</FasoPosterTitle>
                            <FasoBody>{t('delivery.body')}</FasoBody>
                            {livraisonIds === null || sealPourRemise === null ? (
                              /* The ids the bundle must name are gone (an app
                                 killed mid-course, or a Worker that predates
                                 the chain answer). Honest, and never guessed. */
                              <FasoCard>
                                <FasoBody>{t('delivery.ids_missing')}</FasoBody>
                              </FasoCard>
                            ) : evidencePhase.kind === 'answered' ? (
                              (() => {
                                const o = evidenceOutcome(evidencePhase.answer);
                                return (
                                  <>
                                    <FasoCard>
                                      <FasoStatusChip
                                        tone={o.tone === 'ok' ? 'ok' : o.tone === 'waiting' ? 'info' : 'bad'}
                                        label={t(o.title)}
                                      />
                                      {/* ⚠ THE HINT WAS BEING SWALLOWED HERE,
                                          alone among the five acts. An offline
                                          submit showed « Pas de réseau. » and
                                          dropped « Réessayez ici même » — the
                                          one line that tells the rider the
                                          button below is real. */}
                                      {o.hint === undefined ? null : <FasoBody>{t(o.hint)}</FasoBody>}
                                    </FasoCard>
                                    {/**
                                      * ⚠ THE DOOR'S ACT IS AUTOMATIC, SO THIS
                                      * ARM IS THE ONLY WAY OUT — and « offered
                                      * only on the waiting tones » was too
                                      * narrow for it. It deleted the « Envoyer
                                      * la preuve » button that used to sit
                                      * here for EVERY outcome, and
                                      * `preuveAuto` cannot re-fire (it needs
                                      * `idle`). A rider whose code was rotated
                                      * at the console mid-shift got 401 →
                                      * « Demandez un nouveau code à Séra » →
                                      * they do, they sign back in — and the
                                      * screen is still the refused chip, for
                                      * ever. The delivery could not be
                                      * finished on that phone.
                                      *
                                      * So the retry follows what a rider can
                                      * actually change: the network coming
                                      * back (waiting) OR a fresh code
                                      * (`unauthorized` — which `act-model`
                                      * itself calls « not a statement about
                                      * the package »).
                                      */}
                                    {o.tone === 'waiting' || evidencePhase.answer.kind === 'unauthorized' ? (
                                      <FasoPrimaryButton
                                        label={t('delivery.preuve_reessayer')}
                                        onPress={sendDeliveryEvidence}
                                      />
                                    ) : (
                                      /* A refusal custody NAMED (chain or seal
                                         mismatch, custody elsewhere). Retrying
                                         replays the same answer, so no lever —
                                         but never a dead end either: the way
                                         out is a phone call, said plainly, the
                                         same escape `delivery.ids_missing`
                                         already offers. */
                                      <FasoCard>
                                        <FasoBody>{t('delivery.preuve_bloquee')}</FasoBody>
                                      </FasoCard>
                                    )}
                                  </>
                                );
                              })()
                            ) : (
                              <FasoPendingNotice title={t('delivery.preuve_titre')} lines={[t('delivery.preuve_note')]} />
                            )}
                          </>
                        ) : (
                          <>
                            <FasoPosterTitle>{t('delivery.code_title')}</FasoPosterTitle>
                            <FasoActCode
                              strings={{
                                title: t('delivery.code_overline'),
                                hint: t('delivery.code_hint'),
                                placeholder: t('delivery.code_placeholder'),
                                action: t('delivery.code_send'),
                                working: t('acts.sending'),
                              }}
                              working={dropPhase.kind === 'working'}
                              outcome={
                                dropPhase.kind === 'answered'
                                  ? (() => {
                                      const o = dropOutcome(dropPhase.answer);
                                      return { title: t(o.title), hint: o.hint === undefined ? undefined : t(o.hint), tone: o.tone };
                                    })()
                                  : undefined
                              }
                              onSubmit={sendDrop}
                            />
                          </>
                        )}
                      </>
                    )
                  ) : sealScreenIsDue(verifyPhase, remembered) ? (
                    /**
                     * ═══ ROUTE-DIRECTE — THERE IS NO SEAL SCREEN ANY MORE ═══
                     *
                     * Founder ruling 2026-08-10: « terminate that sealing code
                     * and the sealing photo proof requirement … the next screen
                     * is prendre la route ». So this arm is not a screen the
                     * rider works — it is the half-second while the seal the
                     * app carried registers itself, and the honest sentence for
                     * the two ways that can fail to complete.
                     *
                     * On success the effect above flips `packageIsHeld` and the
                     * road takes over; nothing here is ever tapped.
                     */
                    <>
                      {liveAssignment.codeScelle === null ? (
                        /* Logistics minted no seal for this course (composed
                           before ROUTE-DIRECTE). Never invent one — say it. */
                        <FasoCard>
                          <FasoBody>{t('seal.absent')}</FasoBody>
                        </FasoCard>
                      ) : sealPhase.kind === 'answered' ? (
                        (() => {
                          const o = sealOutcome(sealPhase.answer);
                          const scelle = liveAssignment.codeScelle;
                          return (
                            <>
                              <FasoCard>
                                <FasoStatusChip
                                  tone={o.tone === 'ok' ? 'ok' : o.tone === 'waiting' ? 'info' : 'bad'}
                                  label={t(o.title)}
                                />
                                {o.hint === undefined ? null : <FasoBody>{t(o.hint)}</FasoBody>}
                              </FasoCard>
                              {/**
                                * ⚠ « RÉESSAYEZ » MUST HAVE SOMETHING TO TAP.
                                * The auto-effect fires ONCE (it requires
                                * `sealPhase.kind === 'idle'`, and nothing resets
                                * it mid-course), so a rider whose signal dropped
                                * in the two seconds after the verification was
                                * accepted read « Réessayez ici même » on a card
                                * with no button and no way forward but killing
                                * the app. That is the dead end the founder hit
                                * this morning, one screen earlier.
                                *
                                * Offered ONLY on the waiting tones — offline and
                                * unreachable, the two a retry can actually fix.
                                * A NAMED refusal keeps its sentence and no
                                * button: retrying changes nothing, and a lever
                                * that cannot work is the defect this screen
                                * exists to avoid.
                                *
                                * Safe to press: `attemptFor` keys the command on
                                * order+seal, so the retry is the SAME command_id
                                * and custody replays its recorded answer rather
                                * than moving custody twice.
                                */}
                              {o.tone === 'waiting' && scelle !== null ? (
                                <FasoPrimaryButton
                                  label={t('seal.reessayer')}
                                  onPress={() => sendSeal(scelle)}
                                />
                              ) : null}
                            </>
                          );
                        })()
                      ) : (
                        <FasoPendingNotice title={t('seal.auto_titre')} lines={[t('seal.auto_note')]} />
                      )}
                    </>
                  ) : (
                    <>
                      {/* SE4.2 — objective conformity only (SE-I12). The
                          checklist the app has always had; the SERVICE judges
                          it, this only collects it. */}
                      {/**
                        * ⚠ EVERY CHECK IS ANSWERED — « Oui » or « Non », never
                        * implied by an untouched box (blockers A4+A8). An
                        * unfinished list used to SEND, and `verifyPickup`
                        * consumes the single-use pickup code BEFORE the policy
                        * runs — so a partial submit burned the code and left
                        * the order unverifiable for ever. And an unticked box
                        * became a REFUSAL, which permanently records the
                        * supplier at fault. Neither can happen by omission now.
                        */}
                      {/**
                        * ⚠ VERIFIER BLOCKER A5 — THE WIRED SCREEN HAD NO TITLE
                        * AND NO BOUNDARY. A rider on a real build saw a
                        * landmark, a chip, then NINE unheaded questions. The
                        * demo screen has always carried both lines; the wired
                        * arm dropped them. « Vérifiez ce qui se voit. Pas la
                        * qualité, pas le vrai ou le faux. » is not decoration —
                        * it is SE-I12 in one sentence, and without it a rider
                        * reading « C'est le bon produit » as « is it genuine »
                        * answers Non and records a supplier at fault for ever.
                        */}
                      <FasoPosterTitle>{t('verify.title')}</FasoPosterTitle>
                      <FasoBody>{t('verify.body')}</FasoBody>
                      {/**
                        * ⚠ THE PHOTOS BELONG HERE, ON THE WIRED SCREEN.
                        * The founder's order is « the check up will be against
                        * these photos ». The first cut rendered them on the
                        * PROPOSAL card (before acceptance) and on the DEMO
                        * verify screen — never on the screen a real rider
                        * answers, so the three questions were answered from
                        * memory: exactly the « nine fields in your head at a
                        * market stall » problem policy v2 exists to remove.
                        */}
                      <PreuvePhotos />
                      {POLICY_CHECK_IDS.map((id) => (
                        <FasoCheckAnswer
                          key={id}
                          label={t(`check.${id}`)}
                          answer={checks[id]}
                          labels={{ yes: t('check.yes'), no: t('check.no') }}
                          onAnswer={(value) => setChecks((c) => ({ ...c, [id]: value }))}
                        />
                      ))}
                      {preuveUrls.length > 0 ? <FasoBody>{t('check.aide_photos')}</FasoBody> : null}
                      {!allAnswered ? <FasoBody>{t('verify.answer_all')}</FasoBody> : null}
                      {/**
                        * VRAI-ROUTE (founder ruling 2026-08-10) — THE TYPED
                        * PICKUP-CODE FIELD IS GONE. The code is machine-carried:
                        * it rides the session read and the act presents it
                        * itself. The checklist stays (SE §6.1 — objective
                        * checks); one quiet line names the mechanism; the code
                        * itself is never displayed. The camera stays exactly as
                        * ruled on 2026-08-09: offered only when a check was
                        * answered « Non », never demanded.
                        */}
                      {ecartConstate ? (
                        <FasoCard>
                          {/* A DIFFERENCE WAS REPORTED — the camera appears,
                              and its sentence says what the picture is for. */}
                          <FasoBody>{t('verify.photo_ecart')}</FasoBody>
                          {verifyBundleId !== null ? <FasoBody>{t('photo.taken')}</FasoBody> : null}
                          {(() => {
                            const key = captureIssueKey(captureIssue);
                            return key === undefined ? null : <FasoBody>{t(key)}</FasoBody>;
                          })()}
                          <FasoSecondaryButton
                            label={t(verifyBundleId !== null ? 'photo.retake' : 'photo.take')}
                            onPress={() => takePhoto((art) => setVerifyBundleId(art.ref))}
                          />
                          {/* Offered, never demanded — the send below never
                              waits on this photo. */}
                          <FasoBody>{t('verify.photo_facultative')}</FasoBody>
                        </FasoCard>
                      ) : null}
                      <FasoBody>{t('verify.par_sera')}</FasoBody>
                      <FasoPrimaryButton
                        label={t(verifyPhase.kind === 'working' ? 'acts.sending' : 'verify.action_send')}
                        // Gated on ANSWERED (never on all-conforme), locked
                        // while in flight or while the camera is out — and
                        // NEVER on the photo: it is facultative by ruling.
                        disabled={!allAnswered || verifyPhase.kind === 'working' || capturing}
                        onPress={sendVerification}
                      />
                      {verifyPhase.kind === 'answered' ? (
                        (() => {
                          const o = verifyOutcome(verifyPhase.answer);
                          return (
                            <>
                              <FasoStatusChip
                                tone={o.tone === 'ok' ? 'ok' : o.tone === 'waiting' ? 'info' : 'bad'}
                                label={t(o.title)}
                              />
                              {o.hint === undefined ? null : <FasoBody>{t(o.hint)}</FasoBody>}
                            </>
                          );
                        })()
                      ) : null}
                    </>
                  )}
                </>
              ) : (
                <>
                  {onShiftFromSession(liveSession?.shift ?? null) === true ? (
                    <FasoStatusChip tone="ok" label={t('shift.on')} />
                  ) : null}
                  {/* Honest empty state — encouraging, truthful, never a fake count. */}
                  <FasoEmptyState
                    Icon={IconColis}
                    title={t('assignment.none_title')}
                    hint={t('assignment.none_hint')}
                  />
                  {/* The clock re-asks every 20 s; the button is for the rider
                      who was just TOLD a course is coming and wants it NOW. */}
                  <FasoGhostButton label={t('service.actualiser')} onPress={refreshSession} />
                  {onShiftFromSession(liveSession?.shift ?? null) === true ? (
                    /* Ending the day is offered only with no course in hand —
                       the registry would refuse a custody-holding end anyway
                       (SE3.2); this just keeps the trap off the screen. */
                    <FasoSecondaryButton
                      label={t(serviceBusy ? 'acts.sending' : 'shift.end_action')}
                      onPress={() => acteService('end')}
                    />
                  ) : null}
                </>
              )}
            </FpIn>
          ) : (
          <>
          {/* R1 « Service » — Faso Premium (planche l.55–94): the old skeleton
              retired. shiftOff = a white cert card + « Prendre mon service »;
              shiftPending = the honest fpBar pending (queued confers NOTHING — R1
              law); shiftOn = the warm accent « En service » card w/ a live pulse. */}
          {screen === 'service' && (
            <FpIn style={styles.stackGap}>
              {shift === 'off' && (
                <>
                  <FasoPosterTitle>{t('service.off_title')}</FasoPosterTitle>
                  <FasoBody>{t('service.off_body')}</FasoBody>
                  <FasoCard>
                    <View style={styles.certRow}>
                      <IconScelle size={T.body.size} color={FASO.accent} />
                      <FasoBody style={styles.certText}>{t('service.location_note')}</FasoBody>
                    </View>
                    <View style={styles.certRow}>
                      <FasoStatusChip tone="accent" label={t('service.certified')} />
                      <FasoBody style={styles.certText}>{t('service.certified_name')}</FasoBody>
                    </View>
                  </FasoCard>
                  <FasoPrimaryButton
                    label={shiftAction}
                    onPress={() => {
                      // No server in the sandbox: a start stays queued = PENDING —
                      // an offline shift-start confers NOTHING (R1 law).
                      setShift('pending');
                    }}
                  />
                </>
              )}
              {shift === 'pending' && (
                // Queued = pending, never done — never a fake « En service ».
                <FasoPendingNotice title={t('shift.pending_title')} lines={[t('service.pending_note')]} />
              )}
              {shift === 'on' && (
                <>
                  <FasoCard accent>
                    <View style={styles.onRow}>
                      <FpPulseDot color={FASO.okFg} />
                      <FasoPosterTitle>{t('shift.on')}</FasoPosterTitle>
                    </View>
                    <FasoBody>{t('service.on_note')}</FasoBody>
                  </FasoCard>
                  {arriving !== null && (
                    <FasoCourseCard
                      variant="proposed"
                      code={arriving.id.toUpperCase()}
                      status={{ label: t('courses.statut_proposee'), tone: 'accent' }}
                      deadline={`${t('courses.before')} ${proposalUntil}`}
                      title={arriving.locationLines[0]}
                      subtitle={`${arriving.locationLines[2]} · ${t('assignment.landmark_label')}`}
                      onPress={() => openCourse(arriving)}
                    />
                  )}
                  <FasoPrimaryButton label={t('courses.title')} onPress={() => go('courses')} />
                  <FasoSecondaryButton label={t('shift.end_action')} onPress={() => setShift('off')} />
                </>
              )}
              <FasoSecondaryButton label={t('offline.toggle')} onPress={() => net.set(offline ? 'online' : 'offline')} />
            </FpIn>
          )}

          {/* R2 « Mes courses » — Faso Premium (WO-FP-SERA proof view 2/3), TRUE
              planche anatomy (« Sera - Redesign » R2, lines 96–141): a Bricolage-800
              screen title over editorial CourseCards — the proposed course is the
              gold-glow card (left bar · CRS eyebrow · filled PROPOSÉE pill · « avant
              HH:MM » deadline), NOT a glyph-tile row. The custody semantics + the
              honest status vocabulary (statusKeyFor/toneFor) ride the states law. */}
          {screen === 'courses' && (
            <FpIn style={styles.listWrap}>
              <FasoScreenTitle>{t('courses.overline')}</FasoScreenTitle>
              {/* A MAP, not a FlatList — no nested scroll container; the whole
                  screen is the single scroll surface (full-bleed). */}
              {world.courses.length === 0 ? (
                <FasoEmptyState Icon={IconMoto} title={t('shell.no_task')} hint={t('courses.empty_hint')} />
              ) : (
                world.courses.map((item) => {
                  // The offer window (affectation, not yet acted, not closed) shows
                  // « Proposée » + the response deadline — the REAL ack/decline
                  // window; every other course shows its honest status + tone.
                  const proposed = item.step === 'affectation' && item.ack === 'none' && !item.closed;
                  return (
                    <FasoCourseCard
                      key={item.id}
                      variant={variantFor(item)}
                      code={item.id.toUpperCase()}
                      status={proposed ? { label: t('courses.statut_proposee'), tone: 'accent' } : { label: t(statusKeyFor(item)), tone: toneFor(item) }}
                      deadline={proposed ? `${t('courses.before')} ${proposalUntil}` : undefined}
                      lineage={item.attempt === 2 ? t('courses.lineage_2e') : undefined}
                      title={item.locationLines[0]}
                      subtitle={`${item.locationLines[2]} · ${item.name}`}
                      onPress={item.closed ? undefined : () => openCourse(item)}
                    />
                  );
                })
              )}
              <Text style={styles.listFoot}>{t('courses.one_guardian')}</Text>
            </FpIn>
          )}

          {/* R3 « Course proposée » + R4 « Le repère » (planche l.143–223) — the
              app's affectation screen carries both: the response deadline, the
              illustrated repère card (voice playable), then the ack/decline arms.
              Offline law + SERA-S4 connectivity semantics untouched. */}
          {screen === 'affectation' && (
            active === null ? (
              <FasoCard style={styles.flexCard}><FasoEmptyState Icon={IconMoto} title={t('shell.no_task')} /></FasoCard>
            ) : (
              <FpIn style={styles.stackGap}>
                <FasoOverline>{`${t('assignment.deadline')} ${proposalUntil}`}</FasoOverline>
                <FasoLandmarkCard
                  zone={active.locationLines[2]}
                  lines={active.locationLines}
                  repereLabel={t('assignment.landmark_label')}
                  indicationsLabel={t('repere.indications')}
                  illustrated
                  voice={voiceFor()}
                />
                <FasoRelaisRow {...relaisFor()} />
                <FasoQuoteRule>{t('repere.no_gps')}</FasoQuoteRule>
                {active.ack === 'decline_pending' ? (
                  /* The refusal went out WITHOUT the network: queued = PENDING, it
                     confers nothing — only a server-confirmed decline releases; the
                     window still runs. */
                  <FasoPendingNotice lines={[t('assignment.decline_pending')]} />
                ) : active.ack === 'ack_pending' ? (
                  <>
                    {/* Queued = PENDING; walking to the pickup is navigation. */}
                    <FasoPendingNotice lines={[t('assignment.ack_pending')]} />
                    <FasoPrimaryButton label={t('assignment.pickup_action')} onPress={() => walk((w) => beginPickup(w, active.id))} />
                    <FasoDangerButton
                      label={t('assignment.decline_action')}
                      onPress={() => {
                        // SERA-S4: the REAL connectivity decides queued-vs-sent —
                        // offline = decline_pending (confers nothing), online =
                        // server-confirmed decline. The retired constant lied here.
                        declineCourse(world, active.id, connectivity);
                        setWorld({ ...world });
                        toCourses();
                      }}
                    />
                  </>
                ) : (
                  <>
                    <FasoPrimaryButton
                      label={t('assignment.ack_action')}
                      onPress={() => {
                        acknowledgeCourse(world, active.id);
                        setWorld({ ...world });
                      }}
                    />
                    <FasoDangerButton
                      label={t('assignment.decline_action')}
                      onPress={() => {
                        declineCourse(world, active.id, connectivity);
                        setWorld({ ...world });
                        toCourses();
                      }}
                    />
                  </>
                )}
                <FasoGhostButton
                  label={t('assignment.expired_action')}
                  onPress={() => {
                    expireProposal(world, active.id);
                    setWorld({ ...world });
                    toCourses();
                  }}
                />
              </FpIn>
            )
          )}

          {/* The custody walk — every transition below goes through the demo
              store, which calls custody-flow.ts (the rule source) and throws
              on any out-of-order move. */}
          {/* R5 « Vérification » (planche l.225–253) — objective conformity only,
              never quality/authenticity. The checks fill green; the refusal arm is
              the screen's one DangerButton (the app models a single checkbox, not
              the planche's per-row bad-button). */}
          {screen === 'verify' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('verify.title')}</FasoPosterTitle>
              <FasoBody>{t('verify.body')}</FasoBody>
              {/* ⚠ THE CHECK-UP IS ANSWERED AGAINST THESE (founder ruling
                  2026-08-09): the supplier's readiness photos come FIRST, then
                  the three questions that read them. The rider compares a
                  picture, not nine remembered fields. */}
              <PreuvePhotos />
              {RepereVoix()}
              <FasoCard>
                {/* Ecrans R5: the card leads with the colis identity — the order ref
                    chip + what's being verified — before the 7 checks. */}
                <View style={styles.verifyHead}>
                  <FasoStatusChip tone="muted" label={active.id.toUpperCase()} />
                  <FasoBody style={styles.verifyHeadName}>{active.name}</FasoBody>
                </View>
                {POLICY_CHECK_IDS.map((id) => (
                  <FasoCheckRow key={id} label={t(`check.${id}`)} checked={checks[id] === true} onPress={() => setChecks({ ...checks, [id]: !checks[id] })} />
                ))}
                {preuveUrls.length > 0 ? <FasoBody>{t('check.aide_photos')}</FasoBody> : null}
              </FasoCard>
              <FasoPrimaryButton
                label={t('verify.accept_action')}
                disabled={!allChecked}
                onPress={() => walk((w) => passVerification(w, active.id, checks))}
              />
              {/* The refusal arm is as dignified as acceptance — its own
                  polished danger style, never a shame path. */}
              <FasoDangerButton label={t('verify.refuse_action')} onPress={() => walk((w) => refusePickup(w, active.id))} />
            </FpIn>
          )}

          {/* R6 « Le refus digne » (planche l.256–291, r6Done) — money-register calm:
              what happened, what happens next; the course closes with dignity. */}
          {screen === 'refused' && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('refuse.status')}</FasoPosterTitle>
              <FasoBody>{t('refuse.next')}</FasoBody>
              <FasoSecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
            </FpIn>
          )}

          {/* R7 « Le scellé » (planche l.293–334) — custody begins HERE, not a second
              before. Offline: the seal is queued = PENDING; the garde does not begin
              offline (seal.offline honesty verbatim). */}
          {screen === 'seal' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('seal.title')}</FasoPosterTitle>
              <FasoBody>{t('seal.body')}</FasoBody>
              <FasoSealMark code={SEAL_ID} label={t('seal.single_use')} />
              {offline ? (
                <FasoPendingNotice lines={[t('seal.offline')]} />
              ) : (
                <FasoPrimaryButton label={t('seal.action')} onPress={() => walk((w) => registerSeal(w, active.id))} />
              )}
            </FpIn>
          )}

          {/* R8 « En route » — the proof-photo moment (SE-I06). The documentary
              frame with corner ticks (signature element 5); the capture lands
              evidence_pending INSTANTLY, then persists in the background. */}
          {screen === 'evidence' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('evidence.title')}</FasoPosterTitle>
              <View style={styles.photoFrame}>
                <IconCamera size={T.display.size} color={FASO.accentSoft} />
                <FasoCornerTicks />
              </View>
              <FasoPrimaryButton
                label={t('evidence.action')}
                onPress={() => {
                  // SERA-S2 · SE-I06: mint the command_id ONCE at the gesture (the
                  // capture's identity), land evidence_pending INSTANTLY, then persist
                  // the capture to the outbox in the background — durable across a
                  // kill+reboot, flushed at-least-once with dedup on this id. The drop
                  // stays LOCKED until that flush returns the authoritative server ack;
                  // being online is not being acked.
                  const commandId = mintCommandId();
                  walk((w) => captureEvidence(w, active.id));
                  // SERA-S4 `.catch`: a background-persist failure routes to the
                  // banner surface; success refreshes the real backlog count.
                  void appendEvidence(outboxStore, commandId, {
                    courseId: active.id,
                    capturedAt: new Date().toISOString(),
                  }).then(refreshBacklog, () => setPersistFailed(true));
                }}
              />
            </FpIn>
          )}

          {screen === 'evidence_pending' && active !== null && (
            <FpIn style={styles.stackGap}>
              {/* SE-I06: capturing queued the photo = PENDING and the drop is
                  LOCKED. The rider CANNOT unlock it — ONLY the authoritative
                  server ack (the outbox flush outcome) advances this screen. Being
                  online is not being acked; offline shows only the wait. The
                  sandbox constant stands in for the live flush outcome at assembly. */}
              {!offline && SANDBOX_EVIDENCE_ACK === 'applied' ? (
                <>
                  <FasoPosterTitle>{t('evidence.confirmed_status')}</FasoPosterTitle>
                  <FasoPrimaryButton
                    label={t('evidence.continue_action')}
                    onPress={() => {
                      // R8: the ack is the custody move — the store advances the
                      // course to the door (custody target UNCHANGED). We do NOT
                      // walk() straight there: the rider steps through « En route »
                      // (a display waypoint) first, then taps « Je suis à la porte ».
                      applyEvidenceServerAck(world, active.id, SANDBOX_EVIDENCE_ACK);
                      setWorld({ ...world });
                      go('en_route');
                    }}
                  />
                </>
              ) : (
                <>
                  <FasoPendingNotice lines={[t('evidence.pending')]} />
                  <FasoSecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
                </>
              )}
            </FpIn>
          )}

          {/* R8 « En route » (planche HANDOFF §4 R8) — a DISPLAY waypoint between
              the acked proof and the door: « un seul arrêt », the repère IS the
              navigation (Law #5 — no GPS point, no route model). No custody move
              here — the store already set the door; « Je suis à la porte » walks
              to the door_inspection the rule produced (custody target unchanged).
              RELAIS (masked call) is not wired — same as R4/affectation. */}
          {screen === 'en_route' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('enroute.title')}</FasoPosterTitle>
              <FasoLandmarkCard
                zone={active.locationLines[2]}
                lines={active.locationLines}
                repereLabel={t('assignment.landmark_label')}
                indicationsLabel={t('repere.indications')}
              />
              <FasoRelaisRow {...relaisFor()} />
              <FasoQuoteRule>{t('repere.no_gps')}</FasoQuoteRule>
              <FasoPrimaryButton label={t('enroute.arrived_action')} onPress={() => go('door_inspection')} />
            </FpIn>
          )}

          {/* R9 « À la porte » — door inspection. The buyer opens, verifies; the
              rider waits (2–4 min, noted, never imposed). The rider stands at the
              repère, never a street address. */}
          {screen === 'door_inspection' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('inspect.title')}</FasoPosterTitle>
              <FasoBody>{t('inspect.body')}</FasoBody>
              {active.attempt === 2 && <FasoStatusChip tone="info" label={t('courses.lineage_2e')} />}
              {/* R9 `inspecting` — the live inspection chrono (display only; D20:
                  records nothing, enforces nothing). Sits above the door repère. */}
              <DoorChrono />
              <FasoLandmarkCard
                zone={active.locationLines[2]}
                lines={active.locationLines}
                repereLabel={t('assignment.landmark_label')}
                indicationsLabel={t('repere.indications')}
              />
              <FasoRelaisRow {...relaisFor()} />
              <FasoPrimaryButton label={t('inspect.accept_action')} onPress={() => walk((w) => acceptInspection(w, active.id))} />
              <FasoDangerButton label={t('problem.action')} onPress={() => walk((w) => reportProblem(w, active.id))} />
              <FasoGhostButton label={t('inspect.cantpay')} onPress={() => walk((w) => reportProblem(w, active.id))} />
            </FpIn>
          )}

          {screen === 'payment_wait' && active !== null && (
            <FpIn style={styles.stackGap}>
              {/* R9 « à la porte » — SE-I11: the rider CANNOT assert payment.
                  No button, no field, no gesture advances this screen; ONLY the
                  provider signal does. The waiting screen is UNSKIPPABLE. The
                  sandbox constant stands in for the live signal at assembly. */}
              {SANDBOX_DOOR_SIGNAL === 'confirmed' ? (
                <>
                  <FasoPosterTitle>{t('pay_ok.status')}</FasoPosterTitle>
                  <FasoBody>{t('pay_ok.body')}</FasoBody>
                  <FasoPrimaryButton
                    label={t('pay_ok.continue_action')}
                    onPress={() => walk((w) => applyProviderDoorSignal(w, active.id, SANDBOX_DOOR_SIGNAL))}
                  />
                </>
              ) : (
                <>
                  <FasoPosterTitle>{t('pay_wait.status')}</FasoPosterTitle>
                  <FasoPendingNotice lines={[t('pay_wait.hint'), t('pay_wait.operator')]} />
                </>
              )}
            </FpIn>
          )}

          {/* R10 « le code de remise » — Faso Premium (WO-FP-SERA proof view 3/3):
              the buyer's code is the LAST key. The gold-cursor cells + white keypad
              on the Séra paper; the honesty (drop.title/hint) renders verbatim. This
              entry exists ONLY here; the spine makes 'drop' reachable only after the
              provider-confirmed payment (custody semantics untouched). */}
          {screen === 'drop' && active !== null && (
            <FpIn style={styles.dropWrap}>
              {/* planche R10 codeEntry: the overline + honesty are CENTERED over the
                  gold-cursor cells + white keypad. drop.title/hint render verbatim. */}
              <FasoOverline center>{t('drop.title')}</FasoOverline>
              <FasoBody style={styles.dropHint}>{t('drop.hint')}</FasoBody>
              <FasoCodeCells value={codeStr} length={DROP_CODE_LEN} />
              <FasoKeypad
                onKey={(d) => setCodeStr((c) => (c.length < DROP_CODE_LEN ? c + d : c))}
                onBack={() => setCodeStr((c) => c.slice(0, -1))}
              />
              <FasoPrimaryButton
                label={t('drop.action')}
                disabled={codeStr.length !== DROP_CODE_LEN}
                onPress={() => walk((w) => validateDropCode(w, active.id))}
              />
              {/* WO-2.2 refusal ladder entry — as dignified as the purchase
                  path; it whispers, never shouts. */}
              <FasoGhostButton label={t('problem.action')} onPress={() => walk((w) => reportProblem(w, active.id))} />
            </FpIn>
          )}

          {/* R12 « L'échelle des échecs » (planche l.460–502) — no generic « échec »
              exists; a colis never has zero guardian. The family picker → retry /
              refused_final / reschedule; the drop code stays LAST, behind payment. */}
          {screen === 'refusal_reason' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('reason.title')}</FasoPosterTitle>
              {FAILURE_REASON_IDS.map((id) => (
                <FasoGhostButton
                  key={id}
                  label={t(`reason.${id}`)}
                  onPress={() => {
                    // The ONE retry window (~15 min policy default; the live
                    // windowExpiresAt arrives with the service outcome at
                    // assembly — the display is honest either way).
                    const until = new Date(Date.now() + 15 * 60_000);
                    setWindowUntil(`${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`);
                    walk((w) => chooseFailureReason(w, active.id, id));
                  }}
                />
              ))}
            </FpIn>
          )}

          {screen === 'retry_window' && active !== null && (
            <FpIn style={styles.stackGap}>
              {/* R12 retry arm — the honest countdown window, shown never hidden. */}
              <FasoPosterTitle>{t('retry.status')}</FasoPosterTitle>
              <FasoStatusChip tone="warn" label={`${t('retry.until')} ${windowUntil}`} />
              <FasoPrimaryButton label={t('retry.retry_action')} onPress={() => walk((w) => retryDelivery(w, active.id))} />
              <FasoGhostButton label={t('retry.expired_action')} onPress={() => walk((w) => expireRetryWindow(w, active.id))} />
            </FpIn>
          )}

          {screen === 'refused_final' && active !== null && (
            <FpIn style={styles.stackGap}>
              {/* Buyer-fault refusal, register:money — calm, cause and
                  what-happens-next stated; no shame, no jargon. */}
              <FasoPosterTitle>{t('refused_final.status')}</FasoPosterTitle>
              <FasoBody>{t('refused_final.fee')}</FasoBody>
              <FasoBody>{t('refused_final.next')}</FasoBody>
              <FasoPrimaryButton label={t('refused_final.retour_action')} onPress={() => walk((w) => prepareReturn(w, active.id))} />
            </FpIn>
          )}

          {screen === 'reschedule_planned' && (
            <FpIn style={styles.stackGap}>
              {/* The non-escalating arm: honest absence / provider failure —
                  nothing is lost, the order stays whole; the 2e passage appears
                  on the course list with its lineage. */}
              <FasoPosterTitle>{t('reschedule.status')}</FasoPosterTitle>
              <FasoBody>{t('reschedule.next')}</FasoBody>
              <FasoStatusChip tone="info" label={t('reschedule.lineage')} />
              <FasoSecondaryButton label={t('nav.retour_courses')} onPress={toCourses} />
            </FpIn>
          )}

          {/* R13 « Le retour à deux clés » (planche l.504–541, SE6.2): the seller's
              key and the rider's key, both or neither. A single key REFUSES — the
              garde does not move on one hand (attemptReturnHandover is the pure gate). */}
          {screen === 'retour_colis' && active !== null && (
            <FpIn style={styles.stackGap}>
              <FasoPosterTitle>{t('retour.title')}</FasoPosterTitle>
              <FasoQuoteRule accent>{t('retour.custodian')}</FasoQuoteRule>
              <FasoOverline>{t('retour.two_keys')}</FasoOverline>
              <FasoCard>
                <View style={styles.keyRow}>
                  <View style={styles.keyLabel}>
                    <IconCle size={T.body.size} color={FASO.accentDeepAlt} />
                    <FasoBody style={styles.keyText}>{t('retour.key_seller')}</FasoBody>
                  </View>
                  {key1 ? (
                    <IconCoche size={T.title.size} color={FASO.okFg} />
                  ) : (
                    <FasoGhostButton label={t('retour.key_seller_action')} onPress={() => setKey1(true)} />
                  )}
                </View>
                <View style={styles.keyRow}>
                  <View style={styles.keyLabel}>
                    <IconCle size={T.body.size} color={FASO.accentDeepAlt} />
                    <FasoBody style={styles.keyText}>{t('retour.key_rider')}</FasoBody>
                  </View>
                  {key2 ? (
                    <IconCoche size={T.title.size} color={FASO.okFg} />
                  ) : (
                    <FasoGhostButton
                      label={t('retour.key_rider_action')}
                      onPress={() => {
                        // A single-key attempt REFUSES: both hands, or the custody
                        // does not move (attemptReturnHandover is the pure gate).
                        if (attemptReturnHandover({ seller: key1, rider: true }) === 'refused') {
                          setOneKeyMsg(true);
                          return;
                        }
                        setKey2(true);
                      }}
                    />
                  )}
                </View>
              </FasoCard>
              {oneKeyMsg && !key2 && (
                <View style={styles.refuseNote}>
                  <Text style={styles.refuseNoteText}>{t('retour.one_key_refused')}</Text>
                </View>
              )}
              <FasoPrimaryButton
                label={t('retour.action')}
                disabled={attemptReturnHandover({ seller: key1, rider: key2 }) === 'refused'}
                onPress={() => {
                  completeReturn(world, active.id);
                  setWorld({ ...world });
                  toCourses();
                }}
              />
            </FpIn>
          )}

          {/* R11 « Course validée » (planche l.442–458) — the proof is complete;
              Séra emits a SIGNAL, never money. A gold proof seal, the three-line
              proof, the no-money quote; the celebration overlays it on entry. */}
          {screen === 'delivered' && (
            <FpIn style={styles.stackGap}>
              <View style={styles.validHead}>
                <FasoProofSeal />
                <FasoPosterTitle>{t('delivered.status')}</FasoPosterTitle>
              </View>
              <FasoCard>
                <ProofLine label={t('delivered.proof_package')} />
                <ProofLine label={t('delivered.proof_seal')} />
                <ProofLine label={t('delivered.proof_code')} />
              </FasoCard>
              <FasoQuoteRule>{t('delivered.no_money')}</FasoQuoteRule>
              {/* ═══ THE COURSE CLOSES, AND HE IS BACK IN SERVICE ═══
                  Founder, 2026-08-12: « once delivery and everything is confirmé
                  … make it close nicely and return to the initial state waiting
                  for another order for rider's sera app. »

                  This was « Retour aux courses » — a SECONDARY button onto the
                  LIST, which left the finished course as one row among others
                  and made him navigate himself back to being available. The
                  proof above is unchanged and still his to read; what changed is
                  the way out. It is now the PRIMARY action, it says what it does
                  before he taps it, and it lands on `service` — the waiting
                  screen — because that is the state a rider who has just
                  delivered is actually in. */}
              <FasoBody style={styles.deliveredRetour}>{t('delivered.retour_service')}</FasoBody>
              <FasoPrimaryButton label={t('delivered.fermer')} onPress={enService} />
            </FpIn>
          )}
          </>
          )}
        </View>

        {/* The demo footer belongs to the demo world only — a wired build
            must not offer « Recommencer la démo » to a working rider. */}
        {!WIRED && <View style={styles.footer}>
          <Text style={styles.footerHint}>{t('demo.donnees')}</Text>
          <Pressable style={styles.resetAction} onPress={reset}>
            <Text style={styles.resetActionText}>{t('nav.recommencer')}</Text>
          </Pressable>
        </View>}
      </ScrollView>

      {!WIRED && HUBS.includes(screen) && (
        <FasoTabBar
          items={[
            { key: 'service', Icon: IconMoto, label: t('nav.tab_service'), active: screen === 'service', onPress: () => setStack([START]) },
            { key: 'courses', Icon: IconColis, label: t('nav.tab_courses'), active: screen === 'courses', onPress: () => toCourses() },
          ]}
        />
      )}

      {/* R11 « Course validée » peak — a top-level full-screen overlay (outside the
          ScrollView) so the scrim covers the whole screen, never the scroll content.
          Rendered UNDER the SOS so the safety gesture stays reachable in the moment. */}
      {celebrate && screen === 'delivered' && (
        <FasoCelebration label={t('delivered.next')} sublabel={t('delivered.proof_complete')} onDone={() => setCelebrate(false)} />
      )}

      {/* R14 « SOS » — mounted UNCONDITIONALLY, outside every screen branch: one
          gesture from ANY screen, unmissable, never accidentally triggerable. */}
      <SosButton label={t('sos.label')} onOpen={openSos} />
      <SosSheet
        state={sos}
        strings={{
          title: t('sos.title'),
          confirmHint: t('sos.confirm_hint'),
          hold: t('sos.hold'),
          cancel: t('sos.cancel'),
          holdNote: t('sos.hold_note'),
          queued: t('sos.queued'),
          queuedHint: t('sos.queued_hint'),
          /**
           * ⚠ THREE DIFFERENT TRUTHS, AND THE SCREEN MUST PICK THE RIGHT ONE
           * (verifier blockers A2, then A5).
           *
           * A2 was « Alerte envoyée. / On cherche quelqu'un pour vous. » on a
           * build with no SOS route at all — a false safety promise, the most
           * dangerous string in the app. The fix then was to say the alert was
           * stuck on the phone.
           *
           * A5 is that same sentence AFTER 4d built the route: `POST /rider/sos`
           * exists, `httpSosSender` posts to it, and telling a rider in danger
           * « le téléphone n'a pas encore de lien direct » now sends them off to
           * find a phone number for no reason.
           *
           * So the words follow the DELIVERY FACT, not the build flag:
           *   · 'reached' — the outbox settled it against a real 200. « Séra a
           *     reçu l'alerte. » and NOT « quelqu'un arrive » — the server has
           *     recorded it; nobody has necessarily seen it, and no phone has
           *     rung (the escalation channel is still unbound).
           *   · 'owed'   — it is queued and undelivered. Say so, and say to
           *     call, because that is the rider's real fallback.
           *   · null     — in flight. The honest in-between, never a claim.
           */
          raised: WIRED
            ? sosDelivered === 'reached'
              ? t('sos.reached')
              : sosDelivered === 'owed'
                ? t('sos.not_wired')
                : t('sos.sending')
            : t('sos.raised'),
          raisedHint: WIRED
            ? sosDelivered === 'reached'
              ? t('sos.reached_hint')
              : sosDelivered === 'owed'
                ? t('sos.not_wired_hint')
                : t('sos.sending_hint')
            : t('sos.raised_hint'),
          /**
           * ⚠ GATED FOR THE SAME REASON `raised` IS. « on alerte le
           * responsable / On prévient le responsable pour vous » is true in the
           * demo world and FALSE on a wired build: `ESCALATION_TRANSPORT` has
           * no channel bound, so nothing rings out of hours. It is unreachable
           * today only because `SANDBOX_DISPATCH_HOURS` is `'in_hours'` — one
           * constant away from re-arming blocker A2's false safety promise on
           * the most dangerous screen in the app. A wired build says what the
           * server actually has, exactly as the raised path does.
           */
          escalated: WIRED
            ? sosDelivered === 'reached'
              ? t('sos.reached')
              : sosDelivered === 'owed'
                ? t('sos.not_wired')
                : t('sos.sending')
            : t('sos.escalated'),
          escalatedHint: WIRED
            ? sosDelivered === 'reached'
              ? t('sos.reached_hint')
              : sosDelivered === 'owed'
                ? t('sos.not_wired_hint')
                : t('sos.sending_hint')
            : t('sos.escalated_hint'),
          transportPending: t('sos.transport_pending'),
          acknowledged: t('sos.acknowledged'),
          acknowledgedHint: t('sos.acknowledged_hint'),
          previewAck: t('sos.preview_ack'),
          previewAckEscalated: t('sos.preview_ack_escalated'),
          safe: t('sos.safe'),
          over: t('sos.over'),
          overHint: t('sos.over_hint'),
          close: t('sos.close'),
        }}
        onHoldStart={sosHoldStart}
        onHoldEnd={sosHoldEnd}
        onCancel={cancelSos}
        // A2: no dispatch stand-in exists on a wired build — see sosSandboxAck.
        {...(WIRED ? {} : { onSandboxAck: sosSandboxAck })}
        onSafe={sosSafe}
        onClose={sosClose}
      />
    </SafeAreaView>
  );
}

function ProofLine({ label }: { label: string }) {
  return (
    <View style={styles.proofRow}>
      <IconCoche size={T.body.size} color={FASO.okFg} />
      <Text style={styles.proofText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: FASO.paper },
  // The full-bleed scroll surface (the whole screen). The tab dock + SOS float
  // below, so the content clears them with a generous bottom pad.
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl * 3, flexGrow: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  flexCard: { flex: 0 },
  stackGap: { gap: spacing.md, paddingTop: spacing.sm },
  /** COURSE-BRIEF — the supplier's readiness photo. The PHOTO is capped, never
   *  the screen (founder report 2026-08-08); every value is a token. */
  preuvePhoto: {
    width: '100%',
    maxWidth: touch.minTargetPx * 7,
    height: touch.minTargetPx * 4,
    borderRadius: radius.card,
    marginTop: spacing.sm,
    backgroundColor: FASO.paper,
  },
  listWrap: { gap: spacing.sm },
  dropWrap: { gap: spacing.lg, paddingHorizontal: spacing.md, paddingTop: spacing.xl },
  dropHint: { textAlign: 'center' },
  listContent: { gap: spacing.sm, paddingBottom: spacing.sm },
  listFoot: { color: C.muted, fontSize: T.caption.size, lineHeight: T.caption.size * T.caption.lh, textAlign: 'center', paddingVertical: spacing.md },
  checkList: { gap: spacing.sm },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  certText: { flex: 1 },
  onRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  onDot: { width: spacing.sm, height: spacing.sm, borderRadius: radius.pill, backgroundColor: C.success },
  photoFrame: {
    minHeight: spacing.xxl * 3,
    borderWidth: interaction.hairline.thin,
    borderColor: C.hairlineMid,
    backgroundColor: C.sand,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  cornerTick: { position: 'absolute', width: interaction.cornerTick.sizePx, height: interaction.cornerTick.sizePx, borderColor: C.scrim },
  tickTL: { top: spacing.sm, left: spacing.sm, borderTopWidth: interaction.cornerTick.strokePx, borderLeftWidth: interaction.cornerTick.strokePx },
  tickTR: { top: spacing.sm, right: spacing.sm, borderTopWidth: interaction.cornerTick.strokePx, borderRightWidth: interaction.cornerTick.strokePx },
  tickBL: { bottom: spacing.sm, left: spacing.sm, borderBottomWidth: interaction.cornerTick.strokePx, borderLeftWidth: interaction.cornerTick.strokePx },
  tickBR: { bottom: spacing.sm, right: spacing.sm, borderBottomWidth: interaction.cornerTick.strokePx, borderRightWidth: interaction.cornerTick.strokePx },
  linkRow: { alignItems: 'center', paddingVertical: spacing.sm, minHeight: touch.minTargetPx, justifyContent: 'center' },
  linkText: { color: C.accentStrong, fontSize: T.label.size, lineHeight: T.label.size * T.label.lh, fontWeight: '800', letterSpacing: T.label.ls, textTransform: 'uppercase', textDecorationLine: 'underline' },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touch.minTargetPx },
  keyLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  keyText: { flex: 1 },
  refuseNote: { borderRadius: spacing.lg, backgroundColor: FASO.dangerBg, padding: spacing.md },
  refuseNoteText: { color: FASO.dangerFg, fontSize: T.body.size, lineHeight: T.body.size * T.body.lh, fontWeight: '600' },
  validRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  validHead: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  // The sentence above the closing action, on the demo tree's LIGHT card. It
  // now carries only its deltas — `FasoBody` supplies the type scale and the
  // ink, which is the whole point of the kit component. Written first as a bare
  // `<Text>` with colour and spacing tokens but NO type token, so it fell to
  // RN's 14 dp default while `proofText` beside it read at 16; the comment then
  // claimed it was "on the same tokens as every other supporting line here",
  // which was the part that made it invisible. Named by the verifier.
  deliveredRetour: { textAlign: 'center', paddingHorizontal: spacing.md },
  verifyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: interaction.hairline.thin, borderBottomColor: FASO.hairline },
  verifyHeadName: { flex: 1, fontWeight: '700' },
  proofList: { gap: spacing.sm },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // GARDE-LISIBLE (founder, 2026-08-14): `C.onInk` here was cream-on-white —
  // the dark-band text token with no dark band under it, 1.05:1. Card ink.
  proofText: { color: C.ink, fontSize: T.body.size, lineHeight: T.body.size * T.body.lh, flex: 1 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    minHeight: touch.minTargetPx,
  },
  footerHint: { color: C.soft, fontSize: T.caption.size, lineHeight: T.caption.size * T.caption.lh },
  resetAction: { minHeight: touch.minTargetPx, justifyContent: 'center', paddingHorizontal: spacing.md },
  resetActionText: { color: C.muted, fontSize: T.caption.size, lineHeight: T.caption.size * T.caption.lh, fontWeight: '800', letterSpacing: T.label.ls, textTransform: 'uppercase' },
  previewBanner: {
    backgroundColor: C.warningTint,
    borderBottomWidth: interaction.hairline.thin,
    borderBottomColor: C.warningStripe,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  previewBannerText: {
    color: C.warning,
    fontSize: T.labelXS.size,
    lineHeight: T.labelXS.size * T.labelXS.lh,
    fontWeight: '800',
    letterSpacing: T.labelXS.ls,
    textTransform: 'uppercase',
  },
});
