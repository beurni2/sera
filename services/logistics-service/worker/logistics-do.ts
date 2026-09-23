import { DeliveryTaskSchema, PlatformEventSchema } from '@platform/contracts';
import {
  decideLease,
  emptyLeaseState,
  type LeaseAuthorityState,
  type LeaseCommand,
} from '../src/assignment-lease.js';
import {
  GrantedLeaseWitness,
  LeasedDispatch,
  type LeaseAuthority,
} from '../src/leased-assignment.js';
import {
  AssignmentBook,
  type AssignmentBookSnapshot,
  type AssignmentRecord,
} from '../src/manual-assignment.js';
import {
  ADMITTED_PAYMENT_MODES,
  ReadyQueue,
  type FundingCheck,
  type IntakeProjections,
  type ReadinessCheck,
  type ReadyQueueSnapshot,
} from '../src/ready-queue.js';
import { RescheduleBook, type RescheduleBookSnapshot } from '../src/reschedule.js';
import { colisRegle, lireColis, memeColis, voyageurs, type ColisMembership, type Reglement } from '../src/colis.js';
import {
  PRIVACY_NOTICE_VERSION,
  RiderRegistry,
  type RiderRecord,
  type RiderRegistrySnapshot,
  type ShiftOutcome,
} from '../src/rider-registry.js';
import {
  courierActor,
  deriveManifest,
  type CustodianFact,
  type ManifestCourse,
  type RiderManifestView,
} from '../src/route-manifest.js';
import { deliveryCostRange, parseHypotheses } from '../src/delivery-cost.js';
import {
  FLOTTE_VIDE,
  addEntry,
  closeShift,
  confierMoto,
  declareMoto,
  documentsDus,
  logCourse,
  openShift,
  utilisation,
  type EntryKind,
  type FlotteSnapshot,
  type MotoStatus,
} from '../src/flotte.js';
import {
  acknowledge as sosAcknowledge,
  SOS_EVENT_ACKNOWLEDGED,
  SOS_EVENT_CREATED,
  ackSeconds,
  board as sosBoard,
  raise as sosRaise,
  raiseFromBody,
  sosKey,
  SOS_PREFIX,
  type SosIncident,
  type SosStore,
} from './sos-book.js';

/**
 * LogisticsDO — SE-LIVE-1: THE one durable logistics authority.
 *
 * SE-I01 ("exactly one assignment authority per task; a courier MUST NOT
 * self-assign") is enforced by CONSTRUCTION: one object, idFromName
 * ('logistique'), composing the four tested cores — ReadyQueue (SE1.1 double
 * check), RiderRegistry (SE0.2 assignability), the pure decideLease law
 * (SE2.1), and the AssignmentBook — so the whole grant decision (task still
 * valid + rider assignable + atomic acquire + witnessed book entry) runs in
 * ONE workerd-serialized place. This class adds NO law of its own: it loads
 * snapshots, routes commands into the cores, persists snapshots. All law
 * stays in src/ where its unit suites pin it.
 *
 * Supersedes worker/assignment-lease-do.ts: the /authority/dispatch route is
 * preserved byte-compatibly (200/409/400 + only-successes-persisted) but now
 * decides against the SAME lease state the orchestrated /ops/assign path
 * uses — one lease truth, never two.
 *
 * PROJECTIONS (SE1.1): Séra never computes funding or readiness — it
 * consumes signals. The intake door stores the latest posted fact per order;
 * an order NO fact was ever posted for reads as unknown+stale, so the
 * admission gate REFUSES CLOSED ('funding_projection_stale') until the real
 * producers (SE-LIVE-2: Shop+ funding, Boutik+ readiness) start posting.
 * Fail-closed by construction — nothing is admitted on a guess.
 *
 * RIDER DOOR: personal rider codes mirror boutik's supplier-code pattern —
 * only the SHA-256 hash is stored (the hash IS the lookup key, no
 * secret-dependent comparison exists); a miss, a non-string, and a revoked
 * code are all the SAME uniform 401, never an oracle. Minting refuses for an
 * unregistered rider (the CONSOLE-3 phantom-code lesson).
 */

export const LOGISTICS_BOOK_NAME = 'logistique';

/** SE-LIVE-2c — the founder composing a task acts as himself, on the record. */
const OPS_ACTOR = 'ops:sera:fondateur';

const SNAP_QUEUE = 'snap:queue:v1';
const SNAP_REGISTRY = 'snap:registry:v1';
const SNAP_BOOK = 'snap:book:v1';
const SNAP_LEASE = 'snap:lease:v1';
const SNAP_WITNESS = 'snap:witness:v1';
const SNAP_PROJECTIONS = 'snap:projections:v1';
/**
 * COURSE-BRIEF (founder order 2026-08-09) — what the rider needs to SEE and
 * HEAR on arrival: the buyer's own repère voice note, and the supplier's
 * readiness proof photos the pickup check-up is read against.
 *
 * ⚠ WHY IT IS NOT ON THE TASK. `DeliveryTaskSchema` is canon and `.strict()`
 * — an extra key does not ride along, it makes the parse THROW, and widening
 * it is a `contracts/` version bump (a §7 founder trigger). These are media
 * pointers for one Séra surface, not a cross-repo shape, so they live beside
 * the task in Séra's own book, keyed by the task they brief.
 */
const SNAP_BRIEFS = 'snap:briefs:v1';
/**
 * RAMASSAGE (founder order 2026-08-09) — the handover code the RIDER'S APP
 * SHOWS and the SUPPLIER checks before handing the package over. A NEW,
 * logistics-owned secret: SE5 names the pickup TWO-PARTY, and this is the
 * supplier's half of the handshake — it authenticates the RIDER standing at
 * the stall, human to human. It is NOT one of the four custody secrets and
 * touches none of them: `pickupVerificationCode` (SE-I05) flows exactly as
 * before. Keyed by assignmentId: a re-assigned course mints a FRESH code and
 * a taken-back one leaves its code answering only « non confirmé ».
 */
const SNAP_RAMASSAGE = 'snap:ramassage:v1';
/**
 * VRAI-ROUTE (founder ruling 4, 2026-08-10, one-way amendment) — the
 * MACHINE-CARRIED `pickupVerificationCode`. The reverse reveal is RETIRED:
 * the supplier confirms the RIDER's ramassage code on his card, and that is
 * the whole human handshake. SE-I05's pickup code still exists and still
 * gates custody — but no human ever reads or types it again: this book mints
 * it at assign, arms custody with it over `/produce/*`, and hands it to the
 * rider's APP on `/rider/moi`, which presents it inside the verification act.
 * Keyed by assignmentId: a re-assigned course mints and re-arms a fresh one.
 * Plaintext at rest behind the founder's door — the CODE-REVU precedent.
 */
const SNAP_CODE_VERIFICATION = 'snap:code-verification:v1';
/**
 * VRAI-ROUTE (founder ruling 3) — « the chain opens itself at dispatch. »
 * The at-least-once outbox that carries TWO producer calls to the custody
 * Worker for each assigned order: `/produce/order/open` (the chain, with the
 * supplier Boutik+ named on its readiness fact) then `/produce/secrets/arm`
 * (the machine pickup code). Its OWN key inside the snapshot batch, so the
 * row commits atomically with the assignment that armed it.
 */
const SNAP_CUSTODY_OUTBOX = 'snap:custody-outbox:v1';
/**
 * RETOUR-VIVANT-1 (SE6.2 live) — the return handshake's own snapshot, the
 * ramassage's mirror image: when custody says a return OPENED, this object
 * mints the two handover keys — `codeRetour`, the RIDER's, shown on his
 * session at once and SAID to the supplier at the counter; `codeFournisseur`,
 * the SELLER's acceptance, released onto the rider's session ONLY once the
 * supplier typed the rider's code on his own console (`/intake/retour/verify`)
 * — and arms both on custody through the produce door, at-least-once, so the
 * spine consumes them together or not at all. Plaintext lives here, behind
 * this object's own storage, exactly as the pickup code's does.
 */
const SNAP_RETOURS = 'snap:retours:v1';
/**
 * REPROGRAMMATION-1 (SE6.1 live — the reschedule wire). Custody's
 * `reschedule` outcome (honest absence, unusable place, a provider failure:
 * the §6.4 window expired on a NON-escalating reason) reaches this object
 * over the produce door and rests in the RescheduleBook until the founder
 * fixes the next passage; the book was rebuilt EMPTY on every wake until this
 * key existed. `SNAP_REPROGRAMMATIONS` is the reprogram door's own replay
 * ledger (command_id → what it opened), so a retried tap answers the SAME
 * follow-up task rather than opening a third attempt.
 */
const SNAP_RESCHEDULES = 'snap:reschedules:v1';
const SNAP_REPROGRAMMATIONS = 'snap:reprogrammations:v1';
/**
 * REPROGRAMMATION-2 — the DISPATCHER's return decision on a rescheduled
 * course, keyed by assignmentId: recorded here only AFTER custody accepted
 * it (`/produce/return/apply`, relayed on the founder's console act), and
 * carried to the rider's session as `retourDecideAt` so his phone turns to
 * the return road. Custody still moves only on the two-key handover.
 */
const SNAP_RETOUR_DECIDE = 'snap:retour-decide:v1';
/**
 * MANIFESTE-1 (SE3.1 / SE3.2 live) — custody's OWN answers on who holds each
 * order's package, as last heard over the produce door (`GET /custodian`),
 * dated. The rider's manifest and the end-shift declaration are derived from
 * these, never from a task status (SE-I04). A fact is refreshed on every
 * rider read and every end-shift; an unreachable custody keeps the last
 * dated answer and says so.
 */
const SNAP_CUSTODY_FACTS = 'snap:custody-facts:v1';
/**
 * SE3.2 — the dispatcher's end-shift-with-custody exception, ONE pending per
 * rider: his acknowledgment and the package's named next owner, consumed by
 * the rider's next lawful end-shift and logged on the registry (the audit).
 */
const SNAP_FIN_DE_SERVICE = 'snap:fin-de-service:v1';
/** How long a custody answer is trusted for the end-shift check without a
 *  fresh read: the check re-asks; this bounds the fallback only. */
const CUSTODY_READ_TIMEOUT_MS = 4_000;
/**
 * FLOTTE-1 (SE7.2) — the fleet book: motos, their papers and readings, the
 * shifts the registry opened and closed, the courses custody's wires closed
 * (on the moto the rider had), and the founder's cost hypotheses (⏳ his
 * numbers, null until typed). See `src/flotte.ts` and `src/delivery-cost.ts`.
 */
const SNAP_FLOTTE = 'snap:flotte:v1';
/**
 * COLIS-FOURNISSEUR-1 — the courses that carry a package of several orders,
 * keyed by assignmentId: the orders frozen at the moment the rider was given
 * the course (the first names the task), and how each one ended on custody's
 * own wires. The course closes when every order in it is delivered or home.
 */
const SNAP_COLIS_COURSES = 'snap:colis-courses:v1';
/** A package names at most ten orders (canon `PACKAGE_ORDERS_MAX`); an
 *  article's label is a product name, bounded like one. */
const MAX_LIBELLE = 80;

interface FinDeServiceRow {
  dispatcherAckId: string;
  dispatcherId: string;
  nextOwner: { kind: 'return_to_hub_task' | 'reassignment'; ref: string };
  /** The packages the ledger placed with the rider when he acknowledged —
   *  the exception covers these and nothing picked up after. */
  packageIds: string[];
  at: string;
}
const CODEHASH_PREFIX = 'codehash:';
const RIDERCODE_PREFIX = 'ridercode:';

/** The honest "no fact was ever posted" instant — visibly ancient, never now. */
const ABSENT_AS_OF = '1970-01-01T00:00:00.000Z';

interface FundingFact {
  status: 'funded' | 'unfunded' | 'cancelled';
  paymentMode: string;
  asOf: string;
  stale: boolean;
}

interface ReadinessFact {
  ready: boolean;
  asOf: string;
  stale: boolean;
  /** VRAI-ROUTE — WHO the package comes from, said by Boutik+ itself on the
   *  readiness fact (server to server). Custody's chain-open requires it;
   *  Séra never guesses a supplier. Optional: facts posted before the
   *  producer learned to say it are still lawful facts. */
  supplierRef?: string;
}

/**
 * One row per assigned order on its way into custody. `phase` is the road
 * position; `rest` is an HONEST parking reason (missing config or missing
 * supplier), re-checked on every flush — reviving is only ever an alarm.
 */
interface CustodyProduceRow {
  phase: 'open' | 'arm' | 'done';
  rest: 'none' | 'no_config' | 'no_supplier';
  attempts: number;
  taskId: string;
  assignmentId: string;
  paymentMode: string;
  /** The machine pickup code PLAINTEXT — custody hashes at its door and
   *  never stores it; this row lives behind this object's own storage. */
  code: string;
  supplierRef?: string;
}

interface RetourRow {
  orderId: string;
  /**
   * COLIS-FOURNISSEUR-1 — every order going home in this return bag, in the
   * order custody opened them (the first is `orderId`). Absent on a row
   * written before packages existed: that return carries `orderId` alone.
   */
  orderIds?: string[];
  /** The orders whose two keys custody has accepted (the arm is per order). */
  armes?: string[];
  codeRetour: string;
  codeFournisseur: string;
  ouvertAt: string;
  /** When the supplier confirmed the rider's code on his console. First-wins. */
  confirmeAt?: string;
  /** The two arms on custody: 'pending' until both answered ok. */
  armPhase: 'pending' | 'done';
  armAttempts: number;
  armRest: 'none' | 'no_config';
}

interface ProjectionsSnapshot {
  funding: Record<string, FundingFact>;
  readiness: Record<string, ReadinessFact>;
  /** COLIS-FOURNISSEUR-1 — orderId → the package its funding fact named. Write-once. */
  colis?: Record<string, ColisMembership>;
  /** COLIS-2 — the package articles the founder retired one by one. */
  retires?: Record<string, true>;
}

/** COLIS-FOURNISSEUR-1 — one course carrying a package (see SNAP_COLIS_COURSES). */
interface ColisCourse {
  packageId: string;
  orderIds: string[];
  reglement: Record<string, Reglement>;
}

interface RiderCodeRecord {
  readonly riderId: string;
  readonly mintedAt: string;
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isIso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** CSPRNG code over an unambiguous alphabet, grouped for voice handover —
 * the boutik supplier-code pattern. Never the seedable Math generator
 * (the mint-path entropy gate bans it repo-wide). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
/** Six characters, grouped for the voice — the rider SAYS this across a
 * market stall; the supplier types it. Same unambiguous alphabet as the
 * personal codes, same CSPRNG law (the entropy gate binds repo-wide). */
function mintCodeRamassage(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let raw = '';
  for (let i = 0; i < bytes.length; i += 1) raw += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}`;
}

/** What the supplier TYPES vs what was minted: case and separators forgiven,
 * the characters themselves never. */
function normaliseCodeRamassage(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function mintRiderCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let raw = '';
  for (let i = 0; i < bytes.length; i += 1) raw += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  return `SR-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** VRAI-ROUTE — the machine-carried pickup code: the SAME `XXX-XXX` shape as
 *  the ramassage code (the wire contract the rider app parses), minted
 *  independently. Single-use at custody's registry; presented only by the
 *  app, inside an authenticated verification act. */
function mintCodeVerification(): string {
  return mintCodeRamassage();
}

/**
 * ⚠ ROUTE-DIRECTE (founder ruling 2026-08-10) — THE SEAL STOPPED BEING A
 * SCREEN. « terminate that sealing code and the sealing photo proof
 * requirement … after the code is confirmed from supplier the next screen is
 * prendre la route ».
 *
 * So the seal id is MACHINE-CARRIED, exactly as he already ruled the pickup
 * code to be: minted here at dispatch, delivered on `/rider/moi`, presented by
 * the app inside an authenticated `beginCustody`. The rider never reads it,
 * never types it, and no screen displays it.
 *
 * ⚠ A DELIBERATELY DIFFERENT SHAPE from `XXX-XXX`. The pickup code and the
 * seal ride the same read, and « the four secrets are never substituted » —
 * so they must not be confusable for a parser, a log, or a human reading a
 * bug report. `SC-XXXX-XXXX` cannot be mistaken for a pickup code, and the
 * app's parser refuses each against its own shape.
 *
 * It is NOT one of §5.6's four secrets (custody-spine says so where it binds
 * the seal on first use), and its job is identity, not secrecy: single-use at
 * the registry, and equality-checked against the delivery evidence at the door.
 * Minting it server-side is what makes it survive an app restart — the value
 * arrives fresh on every `/rider/moi`, so a killed phone can still finish the
 * remise instead of hitting « il manque des repères ».
 */
function mintCodeScelle(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let raw = '';
  for (let i = 0; i < bytes.length; i += 1) raw += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  return `SC-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

/**
 * RETOUR-VIVANT-1 — the RETURN seal (Séra §6.4: a refused item is « re-sealed
 * in a return bag with a new return-seal »). Minted beside the outbound seal,
 * carried on the same read from the first poll, presented by the rider's
 * return-open act and registered by custody as `return_seal`. Its OWN shape
 * (`RS-XXXX-XXXX`), so neither the outbound seal nor a pickup code can ever
 * stand in for it — the parser refuses each against its own bound.
 */
function mintCodeScelleRetour(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let raw = '';
  for (let i = 0; i < bytes.length; i += 1) raw += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  return `RS-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

/** Single-package pilot (founder ruling 3): the package id custody's chain
 *  was opened with IS the order's own. Minted in one place so the rider's
 *  session and the produce wire can never disagree about it. */
function packageIdOf(orderId: string): string {
  return `pkg-${orderId}`;
}

/** The one 401 — IDENTICAL to the router's, for every rider-door rejection. */
function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

function malformed(): Response {
  return Response.json({ ok: false, reason: 'malformed' }, { status: 400 });
}

const ACTIVE_ASSIGNMENT_STATUSES = ['active_unacknowledged', 'ack_pending_offline', 'acknowledged'];

/**
 * COURSE-BRIEF — the media the rider is briefed with, per task.
 * `preuvePhotoRefs` is what the supplier photographed at readiness; the
 * pickup check-up is answered against it. `repereAudioRef` is the buyer's
 * recorded landmark (Law 5: recorded audio, never synthesized).
 */
interface CourseBrief {
  readonly repereAudioRef?: string;
  readonly preuvePhotoRefs: readonly string[];
  /**
   * COLIS-FOURNISSEUR-1 — what each article of a package IS, in words the
   * rider can say at the door (« le pagne », « les sandales »): the only way
   * to refuse ONE article and keep the rest is to know which is which. A
   * product name, never a price (riders never see money).
   */
  readonly articles?: readonly { orderId: string; libelle: string }[];
}

/** A media pointer, and nothing else: no scheme, no host, no traversal. The
 *  app appends it to its OWN media base, so a ref that could escape the
 *  bucket would be a ref that could point the rider at anything. */
// CONTRACT-CERTIFIED to the media service's real key shape
// (`media-service/src/media-key.ts`): `media/<uuid-v4>` and nothing else.
// A wider bound let a ref through that the bucket can only 404 — a broken
// image on a rider's phone instead of a refusal the founder can see.
const MEDIA_REF = /^media\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_BRIEF_PHOTOS = 4;
function isMediaRef(v: unknown): v is string {
  return typeof v === 'string' && MEDIA_REF.test(v) && !v.includes('..');
}

/** A short printable line: a product name, never a paragraph or a control byte. */
function isLibelle(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (t === '' || t.length > MAX_LIBELLE) return false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  return true;
}

/** COLIS-FOURNISSEUR-1 — the article names of a package's brief, each naming
 *  one of its orders once. `undefined` when none were sent. */
function lireArticles(raw: unknown, duColis: readonly string[]): { orderId: string; libelle: string }[] | 'malformed' | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > duColis.length) return 'malformed';
  const vus = new Set<string>();
  const out: { orderId: string; libelle: string }[] = [];
  for (const a of raw) {
    if (a === null || typeof a !== 'object') return 'malformed';
    const orderId = (a as Record<string, unknown>)['orderId'];
    const libelle = (a as Record<string, unknown>)['libelle'];
    if (typeof orderId !== 'string' || !duColis.includes(orderId) || vus.has(orderId) || !isLibelle(libelle)) return 'malformed';
    vus.add(orderId);
    out.push({ orderId, libelle: libelle.trim() });
  }
  return out;
}

/** What this object reaches outward for — the custody Worker's producer door.
 *  TRANSPORT over a service binding; the door still gates on the secret. */
export interface LogisticsObjectEnv {
  readonly CUSTODY?: { fetch(request: Request): Promise<Response> };
  /** The key to custody's `/produce/*` door; `wrangler secret put`, the
   *  founder's alone. Unset ⇒ the outbox rests honestly, nothing is lost. */
  readonly SERA_PRODUCE_SECRET?: string;
}

export class LogisticsDO {
  private loaded = false;
  private leaseState: LeaseAuthorityState = emptyLeaseState();
  private fundingFacts: Record<string, FundingFact> = {};
  private readinessFacts: Record<string, ReadinessFact> = {};
  /** COURSE-BRIEF, keyed by taskId — beside the canon task, never on it. */
  private briefs: Record<string, CourseBrief> = {};
  /** RAMASSAGE — assignmentId → the handover code its rider's app shows, and
   *  (VRAI-ROUTE) the instant the supplier CONFIRMED it, first-wins. */
  private ramassage: Record<string, { code: string; confirmeAt?: string }> = {};
  /** VRAI-ROUTE — assignmentId → the machine-carried pickup code, and
   *  (ROUTE-DIRECTE) the machine-carried seal id minted with it. `scelle` is
   *  OPTIONAL on the type so a snapshot written before this field restores
   *  without inventing one — a course composed then answers `null` and says so
   *  rather than sealing with a value nobody minted. */
  private codesVerification: Record<string, { code: string; scelle?: string; scelleRetour?: string }> = {};
  /** VRAI-ROUTE — orderId → its producer row on the road into custody. */
  private custodyOutbox: Record<string, CustodyProduceRow> = {};
  /** RETOUR-VIVANT-1 — keyed by assignmentId, like the ramassage handshake. */
  private retours: Record<string, RetourRow> = {};
  /** REPROGRAMMATION-1 — the reprogram door's replay ledger, by command_id. */
  private reprogrammations: Record<string, { orderId: string; taskId: string }> = {};
  /** REPROGRAMMATION-2 — the dispatcher's return decisions, by assignmentId. */
  private retourDecide: Record<string, { orderId: string; decideAt: string }> = {};
  /** MANIFESTE-1 — orderId → custody's last dated answer on its custodian. */
  private custodyFacts: Record<string, CustodianFact> = {};
  /** SE3.2 — riderId → the dispatcher's pending end-shift exception. */
  private finDeService: Record<string, FinDeServiceRow> = {};
  /** FLOTTE-1 — the fleet book. */
  private flotte: FlotteSnapshot = FLOTTE_VIDE;
  /** COLIS-FOURNISSEUR-1 — orderId → its package, as its funding fact said. */
  private colisDe: Record<string, ColisMembership> = {};
  /** COLIS-FOURNISSEUR-1 — assignmentId → the package that course carries. */
  private colisCourses: Record<string, ColisCourse> = {};
  /** COLIS-2 — package articles retired alone: they stay behind like a
   *  cancelled one, and their package-mates still travel. */
  private retires: Record<string, true> = {};
  /** REPROGRAMMATION-2 — when each live course's custody wires were last
   *  asked to revive (in memory: a throttle, never a fact). */
  private wiresRevivedAt: Record<string, number> = {};
  private queue!: ReadyQueue;
  private reschedules!: RescheduleBook;
  private registry!: RiderRegistry;
  private witness!: GrantedLeaseWitness;
  private book!: AssignmentBook;
  private dispatch!: LeasedDispatch;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: LogisticsObjectEnv = {},
  ) {}

  /** The async boundary of leased-assignment.ts, satisfied in-object: the
   * SAME pure decideLease, against THIS object's one lease state. The DO's
   * input gate is the serialization; persistence happens once per request. */
  private readonly authority: LeaseAuthority = {
    send: (cmd: LeaseCommand) => {
      const decision = decideLease(this.leaseState, cmd);
      if (decision.ok && !decision.idempotentReplay) this.leaseState = decision.state;
      return Promise.resolve(decision);
    },
  };

  private projections(): IntakeProjections {
    return {
      funding: {
        check: (orderId: string): FundingCheck =>
          this.fundingFacts[orderId] ?? { status: 'unknown', paymentMode: 'NONE', asOf: ABSENT_AS_OF, stale: true },
      },
      readiness: {
        check: (orderId: string): ReadinessCheck =>
          this.readinessFacts[orderId] ?? { ready: false, asOf: ABSENT_AS_OF, stale: true },
      },
      colis: {
        voyageurs: (orderId: string) => this.voyageursDe(orderId),
      },
    };
  }

  /** COLIS-FOURNISSEUR-1 — the orders this order's package still carries. */
  private voyageursDe(orderId: string): string[] | 'incomplet' {
    // COLIS-2 — an article the founder retired alone reads as cancelled: its
    // funding fact is gone, and « unheard » would hold the rest of the bag.
    return voyageurs(orderId, this.colisDe, (id) => (this.retires[id] === true ? 'cancelled' : this.fundingFacts[id]?.status));
  }

  /** COLIS-FOURNISSEUR-1 — every order a course carries (the first names it). */
  private ordresDeCourse(assignment: { assignmentId: string; orderId: string }): string[] {
    return this.colisCourses[assignment.assignmentId]?.orderIds ?? [assignment.orderId];
  }

  /** The LIVE course carrying this order — its own, or the package it rides in. */
  private courseDe(orderId: string): AssignmentRecord | undefined {
    return this.book
      .snapshot()
      .assignments.map(([, r]) => r)
      .find((r) => ACTIVE_ASSIGNMENT_STATUSES.includes(r.status) && this.ordresDeCourse(r).includes(orderId));
  }

  /**
   * ═══ COLIS-FOURNISSEUR-1 — A PACKAGE'S COURSE ENDS WHEN EVERY ARTICLE HAS ═══
   *
   * Custody's two closing wires (`course-livree` on each article's drop,
   * `course-retournee` on each article's two-key handover) arrive once PER
   * ORDER. For an order carried alone this answers `null` and the wire
   * closes the course exactly as before. For an article of a package it
   * records how that article ended, counts it on the fleet book (a delivery
   * or a return is per order, as it always was), and closes the ONE course
   * only when the last article is settled — `returned` if any article went
   * home, `delivered` otherwise. Until then the rider keeps his course: the
   * refused article is still in his bag.
   *
   * Every settled condition answers 200 by name, the at-least-once sender's
   * law: a replay of an article already settled answers `deja_…`.
   */
  private async reglerColis(orderId: string, kind: Reglement, at: string): Promise<Response | null> {
    const entree = Object.entries(this.colisCourses)
      .filter(([, c]) => c.orderIds.includes(orderId))
      .sort(([a], [b]) => {
        // The LIVE course first, if one carries this order.
        const vivant = (id: string): number => (ACTIVE_ASSIGNMENT_STATUSES.includes(this.book.get(id)?.status ?? '') ? 0 : 1);
        return vivant(a) - vivant(b);
      })[0];
    if (entree === undefined) return null;
    const [assignmentId, colis] = entree;
    const deja = colis.reglement[orderId];
    if (deja !== undefined) {
      return Response.json({ ok: true, status: deja === 'livree' ? 'deja_livree' : 'deja_retournee' });
    }
    const record = this.book.get(assignmentId);
    if (record === undefined || !ACTIVE_ASSIGNMENT_STATUSES.includes(record.status)) {
      return Response.json({ ok: true, status: 'aucune_course' });
    }
    colis.reglement[orderId] = kind;
    this.flotte = logCourse(this.flotte, { orderId, riderId: record.riderId, kind, at });
    if (!colisRegle(colis.orderIds, colis.reglement)) {
      await this.persist();
      return Response.json({
        ok: true,
        status: 'colis_en_cours',
        reste: colis.orderIds.filter((id) => colis.reglement[id] === undefined).length,
      });
    }
    const renvoye = colis.orderIds.some((id) => colis.reglement[id] === 'retournee');
    const outcome = renvoye
      ? await this.dispatch.returnToSupplier(record.orderId, at)
      : await this.dispatch.deliver(record.orderId, at);
    await this.persist();
    if (!outcome.ok) return Response.json({ ok: true, status: 'aucune_course' });
    return Response.json({
      ok: true,
      status: renvoye ? 'retournee' : 'livree',
      leaseReleased: outcome.leaseReleased,
      assignment: {
        assignmentId: outcome.assignment.assignmentId,
        taskId: outcome.assignment.taskId,
        orderId: outcome.assignment.orderId,
        riderId: outcome.assignment.riderId,
        status: outcome.assignment.status,
      },
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const keys = [SNAP_QUEUE, SNAP_REGISTRY, SNAP_BOOK, SNAP_LEASE, SNAP_WITNESS, SNAP_PROJECTIONS, SNAP_BRIEFS, SNAP_RAMASSAGE, SNAP_CODE_VERIFICATION, SNAP_CUSTODY_OUTBOX, SNAP_RETOURS, SNAP_RESCHEDULES, SNAP_REPROGRAMMATIONS, SNAP_RETOUR_DECIDE, SNAP_CUSTODY_FACTS, SNAP_FIN_DE_SERVICE, SNAP_FLOTTE, SNAP_COLIS_COURSES];
    const stored = await this.state.storage.get<unknown>(keys);
    const lease = stored.get(SNAP_LEASE) as LeaseAuthorityState | undefined;
    this.leaseState = lease ?? emptyLeaseState();
    const projections = stored.get(SNAP_PROJECTIONS) as ProjectionsSnapshot | undefined;
    this.fundingFacts = projections?.funding ?? {};
    this.readinessFacts = projections?.readiness ?? {};
    this.colisDe = projections?.colis ?? {};
    this.retires = projections?.retires ?? {};
    this.colisCourses = (stored.get(SNAP_COLIS_COURSES) as Record<string, ColisCourse> | undefined) ?? {};
    this.briefs = (stored.get(SNAP_BRIEFS) as Record<string, CourseBrief> | undefined) ?? {};
    this.ramassage = (stored.get(SNAP_RAMASSAGE) as Record<string, { code: string; confirmeAt?: string }> | undefined) ?? {};
    this.codesVerification = (stored.get(SNAP_CODE_VERIFICATION) as Record<string, { code: string; scelle?: string; scelleRetour?: string }> | undefined) ?? {};
    this.custodyOutbox = (stored.get(SNAP_CUSTODY_OUTBOX) as Record<string, CustodyProduceRow> | undefined) ?? {};
    this.retours = (stored.get(SNAP_RETOURS) as Record<string, RetourRow> | undefined) ?? {};
    this.reprogrammations = (stored.get(SNAP_REPROGRAMMATIONS) as Record<string, { orderId: string; taskId: string }> | undefined) ?? {};
    this.retourDecide = (stored.get(SNAP_RETOUR_DECIDE) as Record<string, { orderId: string; decideAt: string }> | undefined) ?? {};
    this.custodyFacts = (stored.get(SNAP_CUSTODY_FACTS) as Record<string, CustodianFact> | undefined) ?? {};
    this.finDeService = (stored.get(SNAP_FIN_DE_SERVICE) as Record<string, FinDeServiceRow> | undefined) ?? {};
    this.flotte = (stored.get(SNAP_FLOTTE) as FlotteSnapshot | undefined) ?? FLOTTE_VIDE;
    this.queue = new ReadyQueue(this.projections());
    const queueSnap = stored.get(SNAP_QUEUE) as ReadyQueueSnapshot | undefined;
    if (queueSnap !== undefined) this.queue.restore(queueSnap);
    this.reschedules = new RescheduleBook(this.queue);
    const reschedSnap = stored.get(SNAP_RESCHEDULES) as RescheduleBookSnapshot | undefined;
    if (reschedSnap !== undefined) this.reschedules.restore(reschedSnap);
    this.registry = new RiderRegistry();
    const registrySnap = stored.get(SNAP_REGISTRY) as RiderRegistrySnapshot | undefined;
    if (registrySnap !== undefined) this.registry.restore(registrySnap);
    this.witness = new GrantedLeaseWitness();
    const witnessSnap = stored.get(SNAP_WITNESS) as string[] | undefined;
    if (witnessSnap !== undefined) this.witness.restore(witnessSnap);
    this.book = new AssignmentBook(this.registry, this.queue, this.witness);
    const bookSnap = stored.get(SNAP_BOOK) as AssignmentBookSnapshot | undefined;
    if (bookSnap !== undefined) this.book.restore(bookSnap);
    this.dispatch = new LeasedDispatch({
      authority: this.authority,
      witness: this.witness,
      registry: this.registry,
      queue: this.queue,
      book: this.book,
      reschedules: this.reschedules,
    });
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.state.storage.put({
      [SNAP_QUEUE]: this.queue.snapshot(),
      [SNAP_REGISTRY]: this.registry.snapshot(),
      [SNAP_BOOK]: this.book.snapshot(),
      [SNAP_LEASE]: this.leaseState,
      [SNAP_WITNESS]: this.witness.snapshot(),
      [SNAP_PROJECTIONS]: { funding: this.fundingFacts, readiness: this.readinessFacts, colis: this.colisDe, retires: this.retires },
      [SNAP_BRIEFS]: this.briefs,
      [SNAP_RAMASSAGE]: this.ramassage,
      [SNAP_CODE_VERIFICATION]: this.codesVerification,
      [SNAP_CUSTODY_OUTBOX]: this.custodyOutbox,
      [SNAP_RETOURS]: this.retours,
      [SNAP_RESCHEDULES]: this.reschedules.snapshot(),
      [SNAP_REPROGRAMMATIONS]: this.reprogrammations,
      [SNAP_RETOUR_DECIDE]: this.retourDecide,
      [SNAP_CUSTODY_FACTS]: this.custodyFacts,
      [SNAP_FIN_DE_SERVICE]: this.finDeService,
      [SNAP_FLOTTE]: this.flotte,
      [SNAP_COLIS_COURSES]: this.colisCourses,
    });
  }

  /**
   * ═══ MANIFESTE-1 — ASK THE LEDGER WHO HOLDS THE PACKAGE (SE-I04) ═══
   *
   * Custody's `GET /produce/custodian` over the service binding, bounded. A
   * known answer replaces the dated fact for the order; silence (unbound,
   * timeout, non-2xx, unreadable) changes nothing and is reported as such —
   * the caller decides what silence means (the end-shift fails CLOSED, the
   * manifest keeps the last dated answer).
   */
  private async readCustodian(orderId: string, now: string): Promise<'known' | 'unknown'> {
    const custody = this.env.CUSTODY;
    const key = this.env.SERA_PRODUCE_SECRET ?? '';
    if (custody === undefined || key === '') return 'unknown';
    try {
      const res = await custody.fetch(
        new Request(`https://custody/produce/custodian?orderId=${encodeURIComponent(orderId)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(CUSTODY_READ_TIMEOUT_MS),
        }),
      );
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || body === null || body['ok'] !== true) return 'unknown';
      const custodian = body['currentCustodian'];
      const packageId = body['packageId'];
      this.custodyFacts[orderId] = {
        custodian: typeof custodian === 'string' ? custodian : null,
        packageId: typeof packageId === 'string' ? packageId : null,
        asOf: now,
      };
      return 'known';
    } catch {
      return 'unknown';
    }
  }

  /** The courses the manifest reads for one rider: every LIVE course, plus
   *  any closed-by-the-desk course whose package the ledger still places with
   *  him (« cancelled task can't leave custody inventory »). */
  private manifestCourses(riderId: string): ManifestCourse[] {
    const mine = courierActor(riderId);
    const rows: ManifestCourse[] = this.book
      .snapshot()
      .assignments.map(([, r]) => r)
      .filter((r) => r.riderId === riderId)
      .filter((r) => ACTIVE_ASSIGNMENT_STATUSES.includes(r.status) || this.ordresDeCourse(r).some((id) => this.custodyFacts[id]?.custodian === mine))
      .map((r) => {
        const autres = this.ordresDeCourse(r).slice(1);
        const retour = this.retours[r.assignmentId];
        return {
          assignmentId: r.assignmentId,
          taskId: r.taskId,
          orderId: r.orderId,
          active: ACTIVE_ASSIGNMENT_STATUSES.includes(r.status),
          retourOuvert: retour !== undefined,
          retourDecide: this.retourDecide[r.assignmentId] !== undefined,
          // COLIS-FOURNISSEUR-1 — each article of a package on its own word.
          ...(autres.length > 0 ? { autres, ...(retour?.orderIds !== undefined ? { enRetour: retour.orderIds } : {}) } : {}),
        };
      });
    // A course the desk RETIRED has no book row left (the orchestrator sweeps
    // book, queue, lease and witness together), yet the ledger may still place
    // its package with this rider: the fact read after the sweep is the only
    // trace, and it rides the inventory with no stop until a real road moves
    // it. « Cancelled task can't leave custody inventory » is the LEDGER's
    // word — the book's silence is a task-status fact and decides nothing.
    const listed = new Set(rows.flatMap((r) => [r.orderId, ...(r.autres ?? [])]));
    for (const [orderId, fact] of Object.entries(this.custodyFacts)) {
      if (fact.custodian !== mine || listed.has(orderId)) continue;
      rows.push({ assignmentId: `sans-course-${orderId}`, taskId: '', orderId, active: false, retourOuvert: false, retourDecide: false });
    }
    return rows;
  }

  /** Refresh custody's word for every course the rider's manifest reads.
   *  Answers whether EVERY course got a fresh answer — the end-shift's
   *  fail-closed condition. */
  private async refreshCustody(riderId: string, now: string): Promise<boolean> {
    const results = await Promise.all(
      this.manifestCourses(riderId)
        .flatMap((c) => [c.orderId, ...(c.autres ?? [])])
        .map((orderId) => this.readCustodian(orderId, now)),
    );
    return results.every((r) => r === 'known');
  }

  private manifestFor(riderId: string): RiderManifestView {
    return deriveManifest(riderId, this.manifestCourses(riderId), (orderId) => this.custodyFacts[orderId]);
  }

  /** Whether the pending exception (if any) covers every package the ledger
   *  places with the rider right now. A package picked up AFTER the
   *  acknowledgment is not covered — the desk must look again. */
  private finDeServiceCouvre(riderId: string, held: readonly string[]): FinDeServiceRow | undefined {
    const row = this.finDeService[riderId];
    // Nothing carried ⇒ nothing to cover: an exception « for nothing » would
    // be a standing permission, never given.
    if (row === undefined || held.length === 0) return undefined;
    return held.every((id) => row.packageIds.includes(id)) ? row : undefined;
  }

  /** A pending exception that no longer covers what the ledger places with
   *  the rider — the package left by a real road, or another was picked up
   *  after the ack — is STALE: dropped, so it can neither lie to the rider's
   *  screen nor hide the desk's lever behind « en attente ». Answers whether
   *  a row was dropped (the caller persists). */
  private pruneFinDeService(riderId: string): boolean {
    if (this.finDeService[riderId] === undefined) return false;
    if (this.finDeServiceCouvre(riderId, this.manifestFor(riderId).custodyInventory) !== undefined) return false;
    delete this.finDeService[riderId];
    return true;
  }

  /** The pending exceptions the desk may act on: only those still covering
   *  what the ledger places with their rider (as last heard). */
  private finDeServiceEnAttente(): Record<string, FinDeServiceRow> {
    return Object.fromEntries(
      Object.entries(this.finDeService).filter(([riderId]) => this.finDeServiceCouvre(riderId, this.manifestFor(riderId).custodyInventory) !== undefined),
    );
  }

  /**
   * REPROGRAMMATION-2 — the founder's board read doubles as the recovery
   * hook for CUSTODY's wires too (the house law: a redelivered act or a
   * daily read revives a stranded wire, never a hand). For every live course
   * whose chain this object opened, custody's `/wires/reviver` re-arms a
   * reschedule row its spine says is due and wakes any rested return row —
   * so an order that was already in `reschedule` when the wire shipped tells
   * logistics on the founder's first read, not on its next act. Throttled to
   * once a minute per course, bounded, and never in the request's way: a
   * custody that does not answer costs the board nothing.
   */
  private async reviveCustodyWires(): Promise<void> {
    const custody = this.env.CUSTODY;
    const key = this.env.SERA_PRODUCE_SECRET ?? '';
    if (custody === undefined || key === '') return;
    const nowMs = Date.now();
    const due = this.book
      .snapshot()
      .assignments.map(([, r]) => r)
      .filter((r) => ACTIVE_ASSIGNMENT_STATUSES.includes(r.status))
      .flatMap((r) => this.ordresDeCourse(r))
      .filter((orderId) => this.custodyOutbox[orderId]?.phase === 'done' && (this.wiresRevivedAt[orderId] ?? 0) + 60_000 < nowMs)
      .slice(0, 20);
    for (const orderId of due) this.wiresRevivedAt[orderId] = nowMs;
    await Promise.all(due.map(async (orderId) => {
      try {
        const res = await custody.fetch(new Request('https://custody/produce/wires/reviver', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ orderId }),
        }));
        await res.text();
      } catch {
        // Not this read's affair: the next read asks again.
      }
    }));
  }

  /**
   * RETOUR-VIVANT-1 — arm the two handover keys on custody, at-least-once,
   * on `flushCustodyProduce`'s exact terms (same binding, same key, `res.ok`
   * alone decides — custody's arm replays its recorded answer on a
   * redelivery, so a retry can never double anything; missing config is the
   * honest `no_config` rest, re-checked every flush).
   */
  private async flushRetourArm(): Promise<number> {
    const custody = this.env.CUSTODY;
    const key = this.env.SERA_PRODUCE_SECRET ?? '';
    let worst = 0;
    let changed = false;
    for (const [assignmentId, row] of Object.entries(this.retours)) {
      if (row.armPhase === 'done') continue;
      if (custody === undefined || key === '') {
        if (row.armRest !== 'no_config') {
          this.retours[assignmentId] = { ...row, armRest: 'no_config' };
          changed = true;
        }
        continue;
      }
      const arm = async (orderId: string, kind: string, secret: string, suffix: string): Promise<boolean> => {
        try {
          const res = await custody.fetch(new Request('https://custody/produce/secrets/arm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ orderId, command_id: `arm-retour-${suffix}-${assignmentId}`, kind, secret }),
          }));
          return res.ok;
        } catch {
          return false;
        }
      };
      // COLIS-FOURNISSEUR-1 — the two keys go on EVERY article's own file in
      // the bag (each ledger consumes them for itself at the handover); an
      // article already armed is not asked again.
      const armes = new Set(row.armes ?? []);
      for (const orderId of row.orderIds ?? [row.orderId]) {
        if (armes.has(orderId)) continue;
        const rider = await arm(orderId, 'rider_return_confirmation', row.codeRetour, 'rider');
        const seller = rider && (await arm(orderId, 'seller_return_acceptance', row.codeFournisseur, 'seller'));
        if (!seller) break;
        armes.add(orderId);
      }
      // ⚠ MERGE ONTO THE CURRENT ROW, NOT THE ONE CAPTURED BEFORE THE AWAITS.
      // The supplier's `/intake/retour/verify` can land while this flush is
      // waiting on custody (outbound fetches do not hold the input gate), and
      // writing `...row` back would silently ERASE his `confirmeAt` — seen once
      // as a null confirmation in the cross-Worker seam under parallel load.
      // (And an article joining the bag meanwhile keeps the row pending.)
      const current = this.retours[assignmentId] ?? row;
      const tousArmes = (current.orderIds ?? [current.orderId]).every((id) => armes.has(id));
      const next: RetourRow = { ...current, armes: [...armes], armRest: 'none', armAttempts: current.armAttempts + 1, armPhase: tousArmes ? 'done' : 'pending' };
      this.retours[assignmentId] = next;
      changed = true;
      if (next.armPhase !== 'done') worst = Math.max(worst, next.armAttempts);
    }
    if (changed) await this.state.storage.put(SNAP_RETOURS, this.retours);
    return worst;
  }

  /**
   * VRAI-ROUTE — the producer wire into custody, at-least-once. Two calls per
   * order, strictly ordered (custody refuses an arm before its chain is
   * open): `/produce/order/open`, then `/produce/secrets/arm` with the
   * machine pickup code. `res.ok` alone decides — custody's open answers
   * `already_open` 200 on a redelivery and its arm replays its recorded
   * answer, so a retry can never double anything. A 4xx is a producer bug
   * and stays a repeating refusal in both Workers' logs (the eligibility
   * wire's own taxonomy). Missing config or a readiness fact that never
   * named its supplier are HONEST rests, re-checked every flush.
   */
  private async flushCustodyProduce(): Promise<number> {
    const custody = this.env.CUSTODY;
    const key = this.env.SERA_PRODUCE_SECRET ?? '';
    let worst = 0;
    let changed = false;
    for (const [orderId, row] of Object.entries(this.custodyOutbox)) {
      if (row.phase === 'done') continue;
      if (custody === undefined || key === '') {
        if (row.rest !== 'no_config') {
          this.custodyOutbox[orderId] = { ...row, rest: 'no_config' };
          changed = true;
        }
        continue;
      }
      if (row.supplierRef === undefined) {
        if (row.rest !== 'no_supplier') {
          this.custodyOutbox[orderId] = { ...row, rest: 'no_supplier' };
          changed = true;
        }
        continue;
      }
      const next: CustodyProduceRow = { ...row, rest: 'none' };
      const post = async (path: string, body: unknown): Promise<boolean> => {
        try {
          const res = await custody.fetch(new Request(`https://custody${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(body),
          }));
          return res.ok;
        } catch {
          return false;
        }
      };
      if (next.phase === 'open') {
        const opened = await post('/produce/order/open', {
          orderId,
          taskId: next.taskId,
          // Single-package pilot (founder ruling 3): the package id is the
          // order's own, and the correlation is the order's own — the same
          // shapes the founder's hand used to type at the ops door.
          packageId: packageIdOf(orderId),
          correlationId: `corr-${orderId}`,
          supplierId: next.supplierRef,
          paymentMode: next.paymentMode,
          // RETOUR-CHANGEMENT-AVIS — custody may take her change of mind on this
          // article as final only if it travels in a package of several.
          ...((this.colisDe[orderId]?.orderIds.length ?? 1) > 1 ? { colis: true } : {}),
        });
        if (opened) next.phase = 'arm';
      }
      if (next.phase === 'arm') {
        const armed = await post('/produce/secrets/arm', {
          orderId,
          command_id: `arm-pickup-${next.assignmentId}`,
          kind: 'pickup_verification_code',
          secret: next.code,
        });
        if (armed) next.phase = 'done';
      }
      next.attempts = row.attempts + 1;
      this.custodyOutbox[orderId] = next;
      changed = true;
      if (next.phase !== 'done') worst = Math.max(worst, next.attempts);
    }
    if (changed) await this.state.storage.put(SNAP_CUSTODY_OUTBOX, this.custodyOutbox);
    return worst;
  }

  /** Reviving is only ever an alarm: the flush re-judges every rest itself.
   *  Called from the founder's board read and from a replayed assign — the
   *  house recovery law (a redelivered act revives a stranded wire). */
  private async reviveCustodyProduce(): Promise<void> {
    if (!Object.values(this.custodyOutbox).some((r) => r.phase !== 'done')) return;
    if ((await this.state.storage.getAlarm()) !== null) return;
    await this.state.storage.setAlarm(Date.now()).catch(() => undefined);
  }

  async alarm(): Promise<void> {
    await this.ensureLoaded();
    const producePending = await this.flushCustodyProduce();
    // RETOUR-VIVANT-1 — the return keys' arm, same alarm, own state.
    const retourPending = await this.flushRetourArm();
    const pending = Math.max(producePending, retourPending);
    if (pending > 0) {
      const backoffMs = Math.min(30_000 * 2 ** Math.min(pending, 7), 3_600_000);
      await this.state.storage.setAlarm(Date.now() + backoffMs).catch(() => undefined);
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    let response: Response;
    try {
      response = await this.route(request);
    } catch {
      // In-memory state may hold a half-applied mutation that was never
      // persisted — drop it and reload from the last durable truth.
      this.loaded = false;
      return Response.json({ ok: false, reason: 'internal_error' }, { status: 500 });
    }
    if (request.method !== 'GET') await this.persist();
    return response;
  }

  private async route(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const now = new Date().toISOString();

    // ── THE authority's raw command door (preserved from AssignmentLeaseDO,
    //    ops-gated by the router since SE-LIVE-1) ──────────────────────────
    if (pathname === '/authority/dispatch') {
      if (request.method !== 'POST') {
        return Response.json({ ok: false, reason: 'method_not_allowed' }, { status: 405 });
      }
      let cmd: LeaseCommand;
      try {
        cmd = (await request.json()) as LeaseCommand;
      } catch {
        return malformed();
      }
      if (cmd == null || typeof cmd !== 'object' || typeof cmd.command_id !== 'string') {
        return malformed();
      }
      const decision = await this.authority.send(cmd);
      return Response.json(decision, { status: decision.ok ? 200 : 409 });
    }

    // ── Intake door (router-gated: SERA_INTAKE_SECRET) ────────────────────
    if (request.method === 'POST' && pathname === '/intake/task-ready') {
      const body = await request.json().catch(() => null);
      if (body === null) return malformed();
      const outcome = this.queue.onTaskReady(body, now);
      if (!outcome.admitted) {
        return Response.json({ ok: false, admitted: false, reason: outcome.reason }, { status: 422 });
      }
      return Response.json({ ok: true, admitted: true, duplicate: outcome.duplicate, taskId: outcome.task.id });
    }
    if (request.method === 'POST' && pathname === '/intake/funding') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const status = body?.['status'];
      if (
        body === null ||
        !isStr(body['orderId']) ||
        (status !== 'funded' && status !== 'unfunded' && status !== 'cancelled') ||
        !isStr(body['paymentMode']) ||
        !isIso(body['asOf']) ||
        (body['stale'] !== undefined && typeof body['stale'] !== 'boolean')
      ) {
        return malformed();
      }
      const orderId = body['orderId'] as string;
      /**
       * COLIS-FOURNISSEUR-1 — the package this order travels in, as Shop+
       * says it (canon `OrderPackageSchema`). REFUSED, NOT IGNORED when it is
       * not a package this order is in. WRITE-ONCE: an order's package is
       * decided when she pays and never moves, so a later fact that names
       * another one is a producer bug said by name (409) — never a silent
       * regroup of a bag a rider may already carry. A later fact that names
       * none keeps the one already heard.
       */
      const colis = lireColis(body['package'], orderId);
      if (colis === 'malformed') return Response.json({ ok: false, reason: 'package_malformed' }, { status: 400 });
      const colisConnu = this.colisDe[orderId];
      if (colis !== undefined && colisConnu !== undefined && !memeColis(colis, colisConnu)) {
        return Response.json({ ok: false, reason: 'package_contradicts_stored' }, { status: 409 });
      }
      if (colis !== undefined && colisConnu === undefined) this.colisDe[orderId] = colis;
      const incoming: FundingFact = {
        status,
        paymentMode: body['paymentMode'] as string,
        asOf: body['asOf'] as string,
        stale: (body['stale'] as boolean | undefined) ?? false,
      };
      // At-least-once producers REDELIVER. A fact older than the stored one
      // is acknowledged but never applied — a replayed 'funded' from before
      // a 'cancelled' must not re-open admission (SE-I02; verifier finding).
      const stored = this.fundingFacts[orderId];
      if (stored !== undefined && Date.parse(incoming.asOf) < Date.parse(stored.asOf)) {
        return Response.json({ ok: true, orderId, applied: false, reason: 'older_fact_ignored' });
      }
      this.fundingFacts[orderId] = incoming;
      return Response.json({ ok: true, orderId, applied: true });
    }
    if (request.method === 'POST' && pathname === '/intake/readiness') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (
        body === null ||
        !isStr(body['orderId']) ||
        typeof body['ready'] !== 'boolean' ||
        !isIso(body['asOf']) ||
        (body['stale'] !== undefined && typeof body['stale'] !== 'boolean') ||
        // VRAI-ROUTE — refused, not ignored: a supplierRef that is present
        // but not a usable string is a malformed fact, never a silent drop.
        (body['supplierRef'] !== undefined && !isStr(body['supplierRef']))
      ) {
        return malformed();
      }
      const orderId = body['orderId'] as string;
      const incoming: ReadinessFact = {
        ready: body['ready'] as boolean,
        asOf: body['asOf'] as string,
        stale: (body['stale'] as boolean | undefined) ?? false,
        ...(body['supplierRef'] !== undefined ? { supplierRef: (body['supplierRef'] as string).trim() } : {}),
      };
      // Same ordering law as funding: an older redelivered fact never wins.
      const stored = this.readinessFacts[orderId];
      if (stored !== undefined && Date.parse(incoming.asOf) < Date.parse(stored.asOf)) {
        return Response.json({ ok: true, orderId, applied: false, reason: 'older_fact_ignored' });
      }
      this.readinessFacts[orderId] = incoming;
      // VRAI-ROUTE — a producer row parked on « no_supplier » learns its
      // supplier from the redelivered fact and gets back on the road.
      const parked = this.custodyOutbox[orderId];
      if (parked !== undefined && parked.phase !== 'done' && parked.supplierRef === undefined && incoming.supplierRef !== undefined) {
        this.custodyOutbox[orderId] = { ...parked, supplierRef: incoming.supplierRef };
        await this.reviveCustodyProduce();
      }
      return Response.json({ ok: true, orderId, applied: true });
    }

    // ── Ops door (router-gated: SERA_OPS_SECRET — the founder) ────────────
    if (request.method === 'GET' && pathname === '/ops/board') {
      /**
       * ⚠ THE SWEEP RUNS LAZILY, HERE AND ON `/rider/moi` — nothing else ever
       * ran it. `/ops/expire-due` existed with NO caller, so an assignment a
       * rider never acknowledged (the founder's course to a rider whose app
       * predates the accept screen) stayed `active_unacknowledged` for ever:
       * the task never requeued, the rider never freed. Every live read now
       * settles overdue leases first, so what the founder and the rider see
       * is always the post-deadline truth. Same proven `expireDue` the ops
       * route calls; its events ride the response there — a lazy sweep's
       * outcome is fully visible in the very board it returns.
       */
      await this.dispatch.expireDue(now);
      // VRAI-ROUTE — the founder's daily read doubles as the recovery hook
      // for a producer row parked before its config or supplier existed.
      await this.reviveCustodyProduce();
      // REPROGRAMMATION-2 — and for custody's own wires back to this book.
      await this.reviveCustodyWires();
      return Response.json({ ok: true, board: this.board() });
    }
    if (request.method === 'POST' && pathname === '/ops/riders') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (
        body === null ||
        !isStr(body['riderId']) ||
        !isStr(body['displayName']) ||
        !isStr(body['phoneAlias']) ||
        (body['certified'] !== undefined && typeof body['certified'] !== 'boolean')
      ) {
        return malformed();
      }
      const riderId = (body['riderId'] as string).trim();
      if (this.registry.rider(riderId) !== undefined) {
        // Re-registering would silently wipe the privacy ack — refuse.
        return Response.json({ ok: false, reason: 'already_registered' }, { status: 409 });
      }
      const record: RiderRecord = {
        riderId,
        displayName: (body['displayName'] as string).trim(),
        phoneAlias: (body['phoneAlias'] as string).trim(),
        certified: (body['certified'] as boolean | undefined) ?? false,
      };
      this.registry.register(record);
      return Response.json({ ok: true, rider: record });
    }
    if (request.method === 'POST' && pathname === '/ops/riders/certify') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['riderId']) || typeof body['certified'] !== 'boolean') {
        return malformed();
      }
      const existing = this.registry.rider((body['riderId'] as string).trim());
      if (existing === undefined) return Response.json({ ok: false, reason: 'unknown_rider' }, { status: 404 });
      // register() preserves the existing shift state; the spread preserves
      // the privacy ack — only the certification flag moves.
      this.registry.register({ ...existing, certified: body['certified'] as boolean });
      return Response.json({ ok: true, rider: this.registry.rider(existing.riderId) });
    }
    /**
     * ═══ RETIRER UN COURSIER — the roster removal (founder, 2026-08-12) ═══
     *
     * « add a way to remove riders as well on coursiers. » The desk could
     * revoke a CODE — lock them out, keep the row — and had no way to erase the
     * row itself. This is the second act, and it is the destructive one.
     *
     * ⚠ IT REFUSES A RIDER WHO IS CARRYING, BY NAME. Law 3: one current
     * custodian. Removing a rider mid-course would leave a parcel whose
     * custodian does not exist — unowned, and unassignable to anyone else,
     * because `ridersCarrying()` is exactly the set the assign path consults.
     * That is the stranding the rider app paid for this week, and it is not
     * being rebuilt on the ops side. `rider_carrying` is a NAMED refusal, never
     * a generic failure, so the desk can say WHY and he can act on it: end the
     * course, or hand the custody over, THEN remove. And because the book is
     * not custody truth (SE-I04), the door ALSO refuses `428
     * custody_bound_not_asserted` unless the dispatcher asserts the bound —
     * see the long note at the guard for the hole that makes that necessary.
     *
     * THE CODE DIES WITH THE ROSTER ROW. A one-time code that outlived its
     * rider would be a live credential belonging to nobody — it authenticates
     * by hash, so it would keep working. Both keys go in the same act; the
     * revoke route's own two-key delete is mirrored here rather than called, so
     * a removal is ONE storage write and cannot half-happen.
     */
    if (request.method === 'POST' && pathname === '/ops/riders/remove') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['riderId'])) return malformed();
      const riderId = (body['riderId'] as string).trim();
      if (this.registry.rider(riderId) === undefined) {
        return Response.json({ ok: false, reason: 'unknown_rider' }, { status: 404 });
      }
      if (this.ridersCarrying().has(riderId)) {
        return Response.json({ ok: false, reason: 'rider_carrying' }, { status: 409 });
      }
      /**
       * ⚠ THE BOUND OF THE GUARD ABOVE, STATED TRUTHFULLY (verifier blocker).
       * `ridersCarrying()` reads the ASSIGNMENT BOOK, and SE-I04 says in the
       * spec's own words: « task status alone MUST NOT be custody truth ». So
       * that guard is real but it is NOT the whole answer, and an earlier
       * version of this comment claimed it was. It is not, for one concrete
       * reason on this very screen:
       *
       *   `/ops/order/retirer` — « Vider le tableau » on the Coursiers desk —
       *   DELETES the assignment row (`forgetOrder`, « every assignment …
       *   whatever its status ») while deliberately leaving custody open
       *   (« board yes, custody no »). One tap later the book no longer names
       *   the rider, `ridersCarrying()` is blind, and a rider on the road with
       *   a sealed parcel would sail through this door: row erased, code dead,
       *   custody ledger naming a custodian who no longer exists.
       *
       * Logistics genuinely CANNOT see package custody — it is the custody
       * Worker's ledger. (I first wrote a second check against
       * `shift().heldPackageIds` and the typecheck refused it: that field is on
       * the SE3.2 end-shift DECLARATION, not on `ShiftState`. Guessing a field
       * into existence to look thorough is worse than one guard that is real.)
       *
       * So this door does what the take-back door already does for the exact
       * same bound: it REFUSES unless the dispatcher ASSERTS it — a sentence
       * agreed to on purpose, never an accident of a generic button. The
       * console puts the assertion on screen, in words, above the destructive
       * tap. Ordering is deliberate: `rider_carrying` answers FIRST when the
       * book can see the truth, because that refusal is the actionable one.
       *
       * Whether this door should one day ASK the custody ledger over a service
       * binding — and stop asking a human to vouch — is the same open founder
       * decision flagged at `/ops/assignment/take-back`. Flagged, not closed.
       */
      if (body['custodyNotBegun'] !== true) {
        return Response.json({ ok: false, reason: 'custody_bound_not_asserted' }, { status: 428 });
      }
      const code = await this.state.storage.get<{ hash: string }>(`${RIDERCODE_PREFIX}${riderId}`);
      const keys = [`${RIDERCODE_PREFIX}${riderId}`];
      if (code !== undefined) keys.push(`${CODEHASH_PREFIX}${code.hash}`);
      await this.state.storage.delete(keys);
      this.registry.remove(riderId);
      // No explicit persist: `fetch` persists after EVERY non-GET (see the
      // wrapper), which is why `/ops/riders` and `/ops/riders/certify` do not
      // call it either. A second write here would be a second durable put for
      // one act.
      return Response.json({ ok: true, status: 'removed', codeRevoked: code !== undefined });
    }
    /**
     * ═══ SE3.2 — THE DISPATCHER'S END-SHIFT-WITH-CUSTODY EXCEPTION ═══
     *
     * Building-Plan SE3.2: « Mandatory transfer/hub exception. » The founder
     * acknowledges, BY NAME, that a rider still carrying a package may end
     * her shift, and names the package's next owner (the registry's two
     * kinds: back to the hub, or another courier). Recorded against the
     * packages the LEDGER places with her at this instant — asked fresh, and
     * refused `rider_not_carrying` when she holds nothing (an exception for
     * nothing would be a standing permission). Replayed by command id.
     * The ledger itself does not move here: custody stays hers until the
     * real road (a return, a re-assignment) closes it — stated, never hidden.
     */
    if (request.method === 'POST' && pathname === '/ops/shift/exception') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const owner = body?.['nextOwner'] as Record<string, unknown> | undefined;
      if (
        body === null ||
        !isStr(body['command_id']) ||
        !isStr(body['riderId']) ||
        owner == null ||
        (owner['kind'] !== 'return_to_hub_task' && owner['kind'] !== 'reassignment') ||
        !isStr(owner['ref']) ||
        (body['dispatcherId'] !== undefined && !isStr(body['dispatcherId']))
      ) {
        return malformed();
      }
      const riderId = (body['riderId'] as string).trim();
      const commandId = (body['command_id'] as string).trim();
      if (this.registry.rider(riderId) === undefined) {
        return Response.json({ ok: false, reason: 'unknown_rider' }, { status: 404 });
      }
      const existing = this.finDeService[riderId];
      if (existing !== undefined && existing.dispatcherAckId === commandId) {
        return Response.json({ ok: true, status: 'deja_autorisee', packageIds: existing.packageIds, nextOwner: existing.nextOwner, at: existing.at });
      }
      const allKnown = await this.refreshCustody(riderId, now);
      const held = this.manifestFor(riderId).custodyInventory;
      if (!allKnown) {
        await this.state.storage.put(SNAP_CUSTODY_FACTS, this.custodyFacts);
        return Response.json({ ok: false, reason: 'custody_unverifiable' }, { status: 503 });
      }
      if (held.length === 0) {
        await this.state.storage.put(SNAP_CUSTODY_FACTS, this.custodyFacts);
        return Response.json({ ok: false, reason: 'rider_not_carrying' }, { status: 409 });
      }
      this.finDeService[riderId] = {
        dispatcherAckId: commandId,
        dispatcherId: ((body['dispatcherId'] as string | undefined) ?? 'fondateur').trim(),
        nextOwner: { kind: owner['kind'] as 'return_to_hub_task' | 'reassignment', ref: (owner['ref'] as string).trim() },
        packageIds: held.slice(),
        at: now,
      };
      await this.persist();
      return Response.json({ ok: true, status: 'autorisee', packageIds: held, nextOwner: this.finDeService[riderId]!.nextOwner, at: now });
    }
    /**
     * ═══ FLOTTE-1 (SE7.2) — the fleet desk's doors, on the founder's key ═══
     *
     * Records he types (a moto, a paper, a reading, a charge, a repair, who
     * holds which moto, his cost hypotheses) and the derived figures the desk
     * shows (utilization over a window, papers due, the §7.1 decomposition
     * for one order under his three scenarios). Nothing here is a fee, a
     * payroll line or a release gate — those are SE-I09's bound and SE7.3.
     */
    if (request.method === 'GET' && pathname === '/ops/flotte') {
      const f = this.flotte;
      return Response.json({
        ok: true,
        motos: Object.values(f.motos).sort((a, b) => (a.label < b.label ? -1 : 1)),
        entries: f.entries.slice(-200).reverse(),
        shifts: f.shifts.slice(-50).reverse(),
        coursesCount: f.courses.length,
        hypotheses: f.hypotheses,
        utilisation: utilisation(f, now),
        documentsDus: documentsDus(f, now),
      });
    }
    if (request.method === 'POST' && pathname === '/ops/flotte/moto') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (
        body === null || !isStr(body['command_id']) ||
        (body['vehicleId'] !== undefined && !isStr(body['vehicleId'])) ||
        typeof body['label'] !== 'string' || typeof body['fleetTranche'] !== 'number' ||
        (body['status'] !== undefined && typeof body['status'] !== 'string') ||
        (body['odometerKm'] !== undefined && typeof body['odometerKm'] !== 'number')
      ) {
        return malformed();
      }
      const r = declareMoto(
        this.flotte,
        {
          commandId: (body['command_id'] as string).trim(),
          ...(body['vehicleId'] !== undefined ? { vehicleId: (body['vehicleId'] as string).trim() } : {}),
          label: body['label'] as string,
          fleetTranche: body['fleetTranche'] as number,
          ...(body['status'] !== undefined ? { status: body['status'] as MotoStatus } : {}),
          ...(body['odometerKm'] !== undefined ? { odometerKm: body['odometerKm'] as number } : {}),
        },
        now,
        () => `moto-${crypto.randomUUID()}`,
      );
      if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.reason === 'unknown_vehicle' ? 404 : 400 });
      this.flotte = r.snap;
      await this.state.storage.put(SNAP_FLOTTE, this.flotte);
      return Response.json({ ok: true, status: r.replayed ? 'deja_declaree' : 'declaree', moto: r.moto });
    }
    if (request.method === 'POST' && pathname === '/ops/flotte/moto/entree') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['vehicleId']) || !isStr(body['kind'])) return malformed();
      const doc = body['doc'] as Record<string, unknown> | undefined;
      const r = addEntry(
        this.flotte,
        {
          commandId: (body['command_id'] as string).trim(),
          vehicleId: (body['vehicleId'] as string).trim(),
          kind: body['kind'] as EntryKind,
          ...(body['at'] !== undefined ? { at: body['at'] as string } : {}),
          ...(body['note'] !== undefined ? { note: body['note'] as string } : {}),
          ...(body['odometerKm'] !== undefined ? { odometerKm: body['odometerKm'] as number } : {}),
          ...(body['costFcfa'] !== undefined ? { costFcfa: body['costFcfa'] as number } : {}),
          ...(body['kwh'] !== undefined ? { kwh: body['kwh'] as number } : {}),
          ...(doc !== undefined && doc !== null && typeof doc === 'object' ? { doc: { kind: doc['kind'] as string, expiresAt: doc['expiresAt'] as string } } : {}),
        },
        now,
        () => `entree-${crypto.randomUUID()}`,
      );
      if (!r.ok) {
        const status = r.reason === 'unknown_vehicle' ? 404 : r.reason === 'odometer_goes_backwards' ? 409 : 400;
        return Response.json({ ok: false, reason: r.reason }, { status });
      }
      this.flotte = r.snap;
      await this.state.storage.put(SNAP_FLOTTE, this.flotte);
      return Response.json({ ok: true, status: r.replayed ? 'deja_notee' : 'notee', entry: r.entry, moto: this.flotte.motos[r.entry.vehicleId] });
    }
    if (request.method === 'POST' && pathname === '/ops/flotte/moto/confier') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['vehicleId']) || (body['riderId'] !== null && !isStr(body['riderId']))) return malformed();
      const riderId = body['riderId'] === null ? null : (body['riderId'] as string).trim();
      if (riderId !== null && this.registry.rider(riderId) === undefined) return Response.json({ ok: false, reason: 'unknown_rider' }, { status: 404 });
      const r = confierMoto(this.flotte, (body['vehicleId'] as string).trim(), riderId);
      if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: 404 });
      this.flotte = r.snap;
      await this.state.storage.put(SNAP_FLOTTE, this.flotte);
      return Response.json({ ok: true, status: riderId === null ? 'reprise' : 'confiee', moto: this.flotte.motos[(body['vehicleId'] as string).trim()] });
    }
    if (request.method === 'POST' && pathname === '/ops/flotte/hypotheses') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id'])) return malformed();
      const parsed = parseHypotheses(body['hypotheses']);
      if (parsed === null) return Response.json({ ok: false, reason: 'hypotheses_malformees' }, { status: 400 });
      this.flotte = { ...this.flotte, hypotheses: parsed };
      await this.state.storage.put(SNAP_FLOTTE, this.flotte);
      return Response.json({ ok: true, status: 'enregistrees', hypotheses: parsed });
    }
    if (request.method === 'GET' && pathname === '/ops/flotte/cout') {
      const q = new URL(request.url).searchParams;
      const orderId = (q.get('orderId') ?? '').trim();
      const funding = Number(q.get('deliveryFunding'));
      if (orderId === '' || !Number.isInteger(funding) || funding < 0) return malformed();
      if (this.flotte.hypotheses === null) return Response.json({ ok: false, reason: 'hypotheses_absentes' }, { status: 409 });
      return Response.json({ ok: true, orderId, deliveryFunding: funding, couts: deliveryCostRange(orderId, funding, this.flotte.hypotheses) });
    }
    /** The registry's exception log — every custody-holding end-shift that
     *  actually happened, with the dispatcher's ack and the next owner. */
    if (request.method === 'GET' && pathname === '/ops/shift/exceptions') {
      return Response.json({ ok: true, exceptions: this.registry.custodyExceptionLog(), enAttente: this.finDeServiceEnAttente() });
    }
    if (request.method === 'GET' && pathname === '/ops/riders') {
      // Same `assignable` semantics as the board — one meaning, both doors.
      const carrying = this.ridersCarrying();
      const riders = this.registry
        .snapshot()
        .riders.map(([, record]) => ({
          ...record,
          shift: this.registry.shift(record.riderId),
          assignable: this.registry.isAssignable(record.riderId) && !carrying.has(record.riderId),
        }))
        .sort((a, b) => (a.riderId < b.riderId ? -1 : 1));
      return Response.json({ ok: true, riders });
    }
    if (request.method === 'POST' && pathname === '/ops/rider-code/mint') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['riderId'])) return malformed();
      const riderId = (body['riderId'] as string).trim();
      if (this.registry.rider(riderId) === undefined) {
        // The CONSOLE-3 lesson: a typo'd id must never mint a phantom door.
        return Response.json({ ok: false, reason: 'unknown_rider' }, { status: 404 });
      }
      const code = mintRiderCode();
      const hash = await sha256Hex(code);
      const mintedAt = now;
      const previous = await this.state.storage.get<{ hash: string }>(`${RIDERCODE_PREFIX}${riderId}`);
      if (previous !== undefined) await this.state.storage.delete(`${CODEHASH_PREFIX}${previous.hash}`);
      await this.state.storage.put({
        // CODE-REVU (founder ruling 2026-08-09, all code desks): the plaintext
        // is KEPT on the founder-side pointer so /ops/rider-code/reveal can
        // show it back — behind SERA_OPS_SECRET only; the rider door still
        // verifies on the hash, and no rider-facing read carries it.
        [`${CODEHASH_PREFIX}${hash}`]: { riderId, mintedAt } satisfies RiderCodeRecord,
        [`${RIDERCODE_PREFIX}${riderId}`]: { hash, mintedAt, code },
      });
      return Response.json({ ok: true, code, riderId, mintedAt });
    }
    /** CODE-REVU — the founder REREADS a code he already gave. Pre-ruling
     *  codes exist only as hashes and answer `code_anterieur`, honestly. */
    if (request.method === 'POST' && pathname === '/ops/rider-code/reveal') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['riderId'])) return malformed();
      const riderId = (body['riderId'] as string).trim();
      const pointer = await this.state.storage.get<{ mintedAt: string; code?: string }>(`${RIDERCODE_PREFIX}${riderId}`);
      if (pointer === undefined) return Response.json({ ok: false, reason: 'no_code' }, { status: 404 });
      if (pointer.code === undefined) return Response.json({ ok: false, reason: 'code_anterieur' }, { status: 409 });
      return Response.json({ ok: true, code: pointer.code, riderId, mintedAt: pointer.mintedAt });
    }
    if (request.method === 'POST' && pathname === '/ops/rider-code/revoke') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['riderId'])) return malformed();
      const riderId = (body['riderId'] as string).trim();
      const existing = await this.state.storage.get<{ hash: string }>(`${RIDERCODE_PREFIX}${riderId}`);
      if (existing === undefined) return Response.json({ ok: true, status: 'no_code' });
      await this.state.storage.delete([`${CODEHASH_PREFIX}${existing.hash}`, `${RIDERCODE_PREFIX}${riderId}`]);
      return Response.json({ ok: true, status: 'revoked' });
    }
    if (request.method === 'GET' && pathname === '/ops/rider-codes') {
      // Allowlist projection: riderId + mintedAt (+ whether the reveal can
      // answer); the hash and the code NEVER leave on this list.
      const entries = await this.state.storage.list<{ mintedAt: string; code?: string }>({ prefix: RIDERCODE_PREFIX });
      const codes = [...entries.entries()]
        .map(([key, value]) => ({
          riderId: key.slice(RIDERCODE_PREFIX.length),
          mintedAt: value.mintedAt,
          revelable: value.code !== undefined,
        }))
        .sort((a, b) => (a.riderId < b.riderId ? -1 : 1));
      return Response.json({ ok: true, codes });
    }
    /**
     * ⚠ THE ACK IS THE FOUNDER'S ACT, AND ONLY HIS. It lives behind the ops
     * key so a rider can never acknowledge their own alert — the same
     * two-door separation custody draws between attesting and acting. Nothing
     * on this service acknowledges an incident on a timer: SE7.1's « ack
     * within SLA » is a target to MEASURE (`ackSeconds`), never a countdown
     * that answers for a human who has not looked.
     */
    if (request.method === 'GET' && pathname === '/ops/sos') {
      const incidents = await sosBoard(this.sosStore);
      return Response.json({
        ok: true,
        // Open first and never aged out — SE7.1, « persistent signal until ack ».
        incidents: incidents.map((i) => ({ ...i, ackSeconds: ackSeconds(i) })),
      });
    }
    if (request.method === 'POST' && pathname === '/ops/sos/ack') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['by'])) return malformed();
      const outcome = await sosAcknowledge(
        this.sosStore,
        (body['command_id'] as string).trim(),
        (body['by'] as string).trim(),
        now,
      );
      // An ack for an incident nobody raised is refused, never invented: the
      // ack asserts that a human is responding to a REAL alert.
      if (!outcome.ok) return Response.json(outcome, { status: 404 });
      return Response.json({
        ok: true,
        duplicate: outcome.duplicate,
        incident: outcome.incident,
        ackSeconds: ackSeconds(outcome.incident),
        event: SOS_EVENT_ACKNOWLEDGED,
      });
    }
    if (request.method === 'POST' && pathname === '/ops/assign') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (
        body === null ||
        !isStr(body['command_id']) ||
        !isStr(body['taskId']) ||
        !isStr(body['riderId']) ||
        (body['dispatcherId'] !== undefined && !isStr(body['dispatcherId']))
      ) {
        return malformed();
      }
      /**
       * PORTE-DISPATCH (verifier MINOR, 2026-08-13) — the payment mode is
       * SNAPSHOTTED BEFORE the lease-authority hop. The DO's input gate
       * reopens across that await, so a purge landing in the window could
       * empty `fundingFacts` between the gate's recheck and the custody-arm
       * write below — and the old `?? 'FULL_PREPAY'` default would then open
       * a DOOR order's custody file under the wrong mode, silently unarming
       * the SE-I11 door-payment gate at the drop. The snapshot predates any
       * such race; the live read stays as second chance, the default as the
       * final (unreachable on the admitted road) guard.
       */
      const teteAvantHop = this.queue.get((body['taskId'] as string).trim())?.orderId ?? '';
      /**
       * COLIS-FOURNISSEUR-1 — the orders this course will carry, and each
       * one's mode, snapshotted on the same side of the hop as the mode
       * above (the same purge race, the same answer).
       */
      const voyageAvantHop = this.voyageursDe(teteAvantHop);
      const ordresAvantHop =
        Array.isArray(voyageAvantHop) && voyageAvantHop.length > 1 && voyageAvantHop[0] === teteAvantHop
          ? voyageAvantHop
          : [teteAvantHop];
      const modesAvantHop: Record<string, string | undefined> = Object.fromEntries(
        ordresAvantHop.map((id) => [id, this.fundingFacts[id]?.paymentMode]),
      );
      const outcome = await this.dispatch.assign({
        command_id: (body['command_id'] as string).trim(),
        taskId: (body['taskId'] as string).trim(),
        riderId: (body['riderId'] as string).trim(),
        dispatcherId: ((body['dispatcherId'] as string | undefined) ?? 'fondateur').trim(),
        at: now,
        newAssignmentId: `as-${crypto.randomUUID()}`,
      });
      if (!outcome.ok) return Response.json(outcome, { status: 409 });
      // RAMASSAGE — a FRESH course mints a fresh handover code; a duplicate
      // replay keeps the one its rider is already showing. The code never
      // rides THIS response: the supplier's console must ask the RIDER, and a
      // console that could read it here would make the check theatre.
      if (!outcome.duplicate && this.ramassage[outcome.assignment.assignmentId] === undefined) {
        this.ramassage[outcome.assignment.assignmentId] = { code: mintCodeRamassage() };
      }
      /**
       * VRAI-ROUTE — dispatch is the moment the custody chain opens itself.
       * A fresh course mints the machine pickup code and arms the producer
       * row; the row rides the SAME persist batch as the book, so the
       * assignment and its road into custody commit together. A duplicate
       * replay mints nothing — but it DOES revive a resting row, the house
       * recovery law. Re-assign after a take-back overwrites the order's row
       * with the fresh assignment's code: custody's registry replaces an
       * unconsumed pickup code on re-arm, so the dead course's code dies.
       */
      if (!outcome.duplicate) {
        if (this.codesVerification[outcome.assignment.assignmentId] === undefined) {
          // ROUTE-DIRECTE — the pickup code and the seal are minted together,
          // in the same batch as the assignment, so a course can never exist
          // with a road into custody but no seal to travel it on.
          this.codesVerification[outcome.assignment.assignmentId] = {
            code: mintCodeVerification(),
            scelle: mintCodeScelle(),
            // RETOUR-VIVANT-1 — the NEW return seal (§6.4), minted with the
            // outbound one so it exists before any return can open.
            scelleRetour: mintCodeScelleRetour(),
          };
        }
        /**
         * COLIS-FOURNISSEUR-1 — every order of the package gets ITS OWN road
         * into custody (its own chain, its own `pkg-<orderId>`), all under
         * this one course: the same task, the same assignment, the same
         * machine pickup code armed on each file — one code at the stall,
         * checked by every article's own ledger. The package's orders are
         * frozen HERE, with the assignment, in the same persist batch.
         */
        const ordres = ordresAvantHop[0] === outcome.assignment.orderId ? ordresAvantHop : [outcome.assignment.orderId];
        if (ordres.length > 1) {
          this.colisCourses[outcome.assignment.assignmentId] = {
            packageId: this.colisDe[outcome.assignment.orderId]?.packageId ?? outcome.assignment.orderId,
            orderIds: ordres,
            reglement: {},
          };
        }
        for (const id of ordres) {
          this.custodyOutbox[id] = {
            phase: 'open',
            rest: 'none',
            attempts: 0,
            taskId: outcome.assignment.taskId,
            assignmentId: outcome.assignment.assignmentId,
            paymentMode: modesAvantHop[id] ?? this.fundingFacts[id]?.paymentMode ?? 'FULL_PREPAY',
            code: this.codesVerification[outcome.assignment.assignmentId]!.code,
            ...(this.readinessFacts[id]?.supplierRef !== undefined
              ? { supplierRef: this.readinessFacts[id]!.supplierRef as string }
              : {}),
          };
        }
        await this.state.storage.setAlarm(Date.now()).catch(() => undefined);
      } else {
        await this.reviveCustodyProduce();
      }
      return Response.json({ ok: true, assignment: outcome.assignment, lease: outcome.lease, duplicate: outcome.duplicate });
    }
    /**
     * ═══ COURSE-REPRISE — THE DISPATCHER TAKES A COURSE BACK ═══
     *
     * Founder report (2026-08-09): a rider carrying an ACKNOWLEDGED course had
     * no exit — decline and expiry only touch pre-ack statuses, and an in-time
     * ack ANCHORS the lease so no sweep ever ends it. The rider stayed
     * unassignable and the order uncomposable, for ever.
     *
     * By assignmentId ONLY, never riderId: a retried take-back must never land
     * on a LATER course the same rider was given (the RELAIS-REPRISE class of
     * bug, refused at the parameter). The board (`GET /ops/board`) names every
     * active assignment's id. The task closes `closed_taken_back`, the order
     * returns to the composable pool (`/ops/task` + `/ops/a-preparer` exempt
     * that status), and custody is untouched — this door reprises courses
     * whose custody never began; a sealed package is the custody ledger's
     * affair, not this route's.
     */
    if (request.method === 'POST' && pathname === '/ops/assignment/take-back') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (
        body === null ||
        !isStr(body['command_id']) ||
        !isStr(body['assignmentId']) ||
        // Same guard as /ops/assign: a non-string dispatcherId is malformed,
        // never a 500 (a 500 drops the DO's in-memory state — verifier minor).
        (body['dispatcherId'] !== undefined && !isStr(body['dispatcherId']))
      ) {
        return malformed();
      }
      /**
       * ⚠ THE CUSTODY BOUND, STATED AT THE DOOR (verifier blocker B2).
       * Logistics cannot SEE custody — it is the custody Worker's ledger. A
       * take-back after the seal would strip the carrying rider's every
       * custody screen (`/rider/moi` → null, and the app's seal/evidence/drop
       * paths all key off the live assignment) while the ledger still names
       * them custodian: the package would have NO discharge path until the
       * same rider is re-assigned the same order. This door therefore refuses
       * unless the dispatcher ASSERTS the bound — a sentence typed on
       * purpose, never an accident of a generic button. (Whether this door
       * should one day ask the custody ledger itself, over a service binding,
       * is an open founder decision — flagged, not closed, here.)
       *
       * `command_id` is REQUIRED for shape-consistency with every ops door
       * and is deliberately UNUSED: idempotency here is by state (a repeat
       * answers duplicate), which is strictly stronger for a one-way act.
       */
      if (body['custodyNotBegun'] !== true) {
        return Response.json(
          { ok: false, reason: 'custody_bound_not_asserted' },
          { status: 428 },
        );
      }
      const outcome = await this.dispatch.takeBack(
        (body['assignmentId'] as string).trim(),
        ((body['dispatcherId'] as string | undefined) ?? 'fondateur').trim(),
        now,
      );
      if (!outcome.ok) {
        // The refusal carries its reason and nothing else — no orchestrator
        // internals riding along (verifier minor).
        return Response.json(
          { ok: false, reason: outcome.reason },
          { status: outcome.reason === 'unknown_assignment' ? 404 : 409 },
        );
      }
      // MANIFESTE-1 — « cancelled task can't leave custody inventory »: the
      // course is off the book, so the LEDGER is asked now, and its fresh
      // word is what keeps a sealed package on the rider's manifest (and
      // blocking his end of service) if the assertion above was false.
      // COLIS-FOURNISSEUR-1 — every article of a package has its own word.
      for (const id of this.ordresDeCourse(outcome.assignment)) await this.readCustodian(id, now);
      await this.state.storage.put(SNAP_CUSTODY_FACTS, this.custodyFacts);
      return Response.json({
        ok: true,
        duplicate: outcome.duplicate,
        leaseReleased: outcome.leaseReleased,
        assignment: {
          assignmentId: outcome.assignment.assignmentId,
          taskId: outcome.assignment.taskId,
          orderId: outcome.assignment.orderId,
          riderId: outcome.assignment.riderId,
          status: outcome.assignment.status,
          // The audit IS the record (no platform event exists for this) — so
          // the record's audit answers to the hand that acted.
          takenBackAt: outcome.assignment.takenBackAt ?? null,
          takenBackBy: outcome.assignment.takenBackBy ?? null,
        },
      });
    }
    /**
     * ═══ PURGE-ESSAI — THE FOUNDER RETIRES ONE TEST COURSE FROM THE BOARD ═══
     *
     * FOUNDER RULING (2026-08-10): « products on my ops console and suppliers
     * console that i used for the testing, remove all of them … cause i want
     * to use new products again », and, asked what Séra should clear:
     * « BOARD YES, CUSTODY NO ». So this door clears the DISPATCH board for
     * ONE order and touches no custody record — the custody ledger is
     * append-only proof on no console (Ten Laws #3), and nothing here can
     * reach it.
     *
     * It also finally answers the journalled debt « the Séra dispatch board
     * does not clear on course completion »: a delivered or abandoned test
     * course had no exit at all, so it sat on the board for ever.
     *
     * ⚠ ONE ORDER PER CALL, ON PURPOSE. There is no « retirer tout » on this
     * server, and there must not be: a single command that could empty the
     * whole board is one fat finger away from erasing a live one. The console
     * loops its own visible rows and calls this door once per order, so every
     * removal is a named, individually refusable act.
     *
     * WHAT LEAVES (for this orderId and nothing else): every queue task row
     * whatever its status · every assignment, with its witness ref revoked and
     * its lease released at THE authority (cause 'retire' — a stranded lease
     * would leave the rider unassignable for ever, SE-I01) · the ramassage and
     * machine-pickup-code entries of those assignments · the course brief ·
     * the custody-produce outbox row · AND BOTH PROJECTION FACTS. Without the
     * last two the order walks straight back onto `/ops/a-preparer` as
     * composable and the purge means nothing.
     *
     * WHAT STAYS: rider registry rows, rider codes, SOS incidents, the lease
     * HISTORY (append-only, and only ACTIVE leases are ever consulted), the
     * dedupe ledgers, and every other order's everything.
     *
     * ⚠ TWO HONEST BOUNDS, STATED RATHER THAN HIDDEN. (1) If the producers
     * (Shop+ funding, Boutik+ readiness) re-post their at-least-once facts for
     * a retired order, the order reappears on `/ops/a-preparer` — this door
     * clears Séra's copy, it cannot un-say what an upstream service keeps
     * saying. (2) If the custody chain already opened for this order, it stays
     * open on the custody Worker: that is exactly what « board yes, custody
     * no » means, and the console's confirmation says so before the tap.
     *
     * `command_id` is REQUIRED for shape-consistency with every ops door and
     * is deliberately UNUSED — idempotency here is by STATE: a re-run finds
     * nothing left and answers `inconnu` 200, which is strictly stronger for a
     * one-way act. An order the book never knew answers the SAME `inconnu`, so
     * a re-run of the console's sweep converges instead of erroring.
     */
    if (request.method === 'POST' && pathname === '/ops/order/retirer') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['orderId'])) return malformed();
      if (body['colisEntier'] !== undefined && typeof body['colisEntier'] !== 'boolean') return malformed();
      /**
       * COLIS-2 — ONE ARTICLE LEAVES, ITS PACKAGE-MATES STAY (founder,
       * 2026-09-23: « « Retirer » on your console removes the whole
       * package »). An article of a package no rider carries yet is retired
       * alone and then reads as cancelled — so the rest of the bag stays
       * composable, and a queued course keeps going with one article fewer
       * (its first article retired → the task goes, and the rest come back
       * to « à préparer » under their new first article).
       *
       * A package a rider ALREADY CARRIES is one bag in one pair of hands:
       * taking one article off the board would leave a course that can never
       * close (it closes when every article it carries is settled). So one
       * article of a live package is refused by name, `colis_en_course`, and
       * the whole bag leaves only on `colisEntier: true` — the console asks
       * for that in its own words, naming every article.
       */
      const demande = (body['orderId'] as string).trim();
      const colisEntier = body['colisEntier'] === true;
      const membre = this.colisDe[demande];
      let aRetirer: readonly string[] = colisEntier ? membre?.orderIds ?? [demande] : [demande];
      const articleSeul = membre !== undefined && !colisEntier;
      if (articleSeul) {
        const course = this.courseDe(demande);
        if (course !== undefined && this.ordresDeCourse(course).length > 1) {
          return Response.json(
            { ok: false, reason: 'colis_en_course', orderIds: this.ordresDeCourse(course) },
            { status: 409 },
          );
        }
        aRetirer = [demande];
      }
      const removed = { tasks: 0, assignments: 0, leases: 0, briefs: 0, ramassage: 0, codesVerification: 0, custodyOutbox: 0, funding: 0, readiness: 0 };
      let quelqueChose = false;
      for (const orderId of aRetirer) {
        const hasTask = this.queue.snapshot().tasks.some(([, queued]) => queued.orderId === orderId);
        const hasAssignment = this.book.snapshot().assignments.some(([, record]) => record.orderId === orderId);
        const hasFunding = this.fundingFacts[orderId] !== undefined;
        const hasReadiness = this.readinessFacts[orderId] !== undefined;
        const hasOutbox = this.custodyOutbox[orderId] !== undefined;
        if (!hasTask && !hasAssignment && !hasFunding && !hasReadiness && !hasOutbox) continue;
        quelqueChose = true;
        // Book + queue + lease + witness move together — the orchestrator owns
        // that trio, never this route reaching behind a core's back.
        const swept = await this.dispatch.forgetOrder(orderId);
        // MANIFESTE-1 — the same law as the take-back: the ledger's fresh word
        // keeps a carried package on its rider's manifest after the board forgot
        // the course (« BOARD YES, CUSTODY NO »).
        await this.readCustodian(orderId, now);
        for (const taskId of swept.taskIds) {
          if (this.briefs[taskId] === undefined) continue;
          delete this.briefs[taskId];
          removed.briefs += 1;
        }
        for (const assignment of swept.assignments) {
          if (this.ramassage[assignment.assignmentId] !== undefined) {
            delete this.ramassage[assignment.assignmentId];
            removed.ramassage += 1;
          }
          if (this.codesVerification[assignment.assignmentId] !== undefined) {
            delete this.codesVerification[assignment.assignmentId];
            removed.codesVerification += 1;
          }
          delete this.colisCourses[assignment.assignmentId];
        }
        if (hasOutbox) delete this.custodyOutbox[orderId];
        if (hasFunding) delete this.fundingFacts[orderId];
        if (hasReadiness) delete this.readinessFacts[orderId];
        removed.tasks += swept.taskIds.length;
        removed.assignments += swept.assignments.length;
        removed.leases += swept.leasesReleased;
        removed.custodyOutbox += hasOutbox ? 1 : 0;
        removed.funding += hasFunding ? 1 : 0;
        removed.readiness += hasReadiness ? 1 : 0;
      }
      if (articleSeul) {
        // Its package-mates still name it: the membership stays, and the
        // marker says it no longer travels.
        if (quelqueChose) this.retires[demande] = true;
      } else {
        for (const orderId of aRetirer) {
          delete this.colisDe[orderId];
          delete this.retires[orderId];
        }
      }
      if (!quelqueChose) return Response.json({ ok: true, status: 'inconnu' });
      return Response.json({ ok: true, status: 'retire', removed });
    }
    /**
     * ═══ SE-LIVE-2c — THE FOUNDER COMPOSES THE DELIVERY TASK ═══
     *
     * FOUNDER RULING (2026-08-06, option 1): the buyer gives Shop+ only
     * phone + quartier + repère (BC-1a), so no producer can compose a task
     * without inventing an address it never had — the founder composes it,
     * here, from what he can actually see. Nothing is fabricated.
     * Canon v3.11.0 (founder ruling 2026-08-08) made the PIN optional too:
     * absence is representable, so even the founder no longer types a
     * coordinate he does not have.
     *
     * FOUNDER REPORT (2026-08-08): « it asks more useless additional
     * information. » What canon actually demands (kernel LocationSchema) is
     * pin + zone + landmark; `directions` and `maskedRelay` are plain
     * `z.string()` — EMPTY IS CANON-LEGAL. This door's first cut demanded all
     * five non-empty, which forced the founder to type a fake relay id
     * (« relais-1 ») to satisfy a field no relay service backs yet. A fake
     * value invented to pass a gate is worse than an honest absence: the two
     * optional fields now accept '' and the required trio stays required.
     *
     * WHAT HE SUPPLIES: the address only. WHAT HE CANNOT DO: skip the gate.
     * The composed task goes through the SAME `onTaskReady` admission the
     * producers' events go through, so SE-I02 (funded per mode + readiness
     * confirmed + non-cancelled + not stale) holds against the founder's own
     * hand exactly as it holds against a wire. A refusal answers 422 with the
     * gate's own reason, so he sees WHY rather than a silent nothing.
     */
    if (request.method === 'POST' && pathname === '/ops/task') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['orderId'])) return malformed();
      /**
       * COLIS-FOURNISSEUR-1 — a package is ONE course, named by its first
       * travelling order. The founder may compose from any article of the
       * package; the task is filed under the package's own head, so two
       * composes from two articles of one bag can never make two courses
       * (the open-task check below covers every order of the package).
       */
      const demande = (body['orderId'] as string).trim();
      const voyage = this.voyageursDe(demande);
      // The gate's own refusal, said before anything else is judged: a bag
      // whose members are not all heard yet is not composable at all.
      if (voyage === 'incomplet') {
        return Response.json({ ok: false, admitted: false, reason: 'colis_incomplet' }, { status: 422 });
      }
      const orderId = voyage.length > 0 ? voyage[0]! : demande;
      const duColis = voyage.length > 0 ? voyage : [demande];
      const loc = body['location'] as Record<string, unknown> | undefined;
      const win = body['window'] as Record<string, unknown> | undefined;
      const pin = loc?.['pin'] as Record<string, unknown> | undefined;
      if (
        loc == null ||
        // Canon v3.11.0 (founder ruling 2026-08-08): the pin is OPTIONAL —
        // absence is representable, a fabricated coordinate is not required.
        // When PRESENT it must still be a real, on-the-globe pair: a pin
        // outside the globe is a slip of the thumb, and it would reach a
        // rider unchallenged (verifier NOTE 10). Bounds, not geography: Séra
        // does not decide where Ouagadougou is.
        (pin !== undefined &&
          (typeof pin['lat'] !== 'number' ||
            typeof pin['lng'] !== 'number' ||
            !Number.isFinite(pin['lat']) ||
            !Number.isFinite(pin['lng']) ||
            (pin['lat'] as number) < -90 ||
            (pin['lat'] as number) > 90 ||
            (pin['lng'] as number) < -180 ||
            (pin['lng'] as number) > 180)) ||
        !isStr(loc['zone']) ||
        !isStr(loc['landmark']) ||
        // Canon's own line (kernel LocationSchema): directions and maskedRelay
        // are `z.string()`, not TrimmedNonEmptyString — empty is a lawful
        // absence, a non-string is still malformed.
        typeof loc['directions'] !== 'string' ||
        typeof loc['maskedRelay'] !== 'string' ||
        win == null ||
        !isIso(win['start']) ||
        !isIso(win['end']) ||
        // A window that ends before it starts is not a window.
        Date.parse(win['start'] as string) >= Date.parse(win['end'] as string)
      ) {
        return malformed();
      }
      /**
       * ⚠ VERIFIER BLOCKER (SE-LIVE-2c round 1) — THE ID IS NEVER THE
       * CALLER'S. The first cut accepted `body.taskId`, and the verifier drove
       * it on the real runtime: pasting the id of a LIVE, ASSIGNED task
       * overwrote that queue row with another order's address, re-queued the
       * same task for a second custodian, and left the assigned rider's screen
       * pointing at a stranger's door — Ten Laws #3 ("exactly one current
       * custodian") defeated through the very route this slice adds. The id is
       * now minted here and ONLY here; a body that carries one is refused
       * outright rather than ignored, so a founder who pastes an id learns it
       * did nothing instead of assuming it did something.
       */
      if (body['taskId'] !== undefined) {
        return Response.json({ ok: false, reason: 'task_id_is_not_yours_to_choose' }, { status: 400 });
      }
      /**
       * COURSE-BRIEF (founder order 2026-08-09) — the two media pointers the
       * rider is briefed with. Both OPTIONAL: a buyer who typed their repère
       * instead of recording it, or a supplier whose proof predates the photo
       * step, must still be dispatchable. Absent is absent — never an empty
       * string standing in for a recording nobody made.
       *
       * REFUSED, NOT IGNORED (the refuse-don't-ignore law): a malformed ref
       * ends the compose. Silently dropping it would hand the rider a course
       * with no photos to check against and no way to know one was meant.
       */
      const audioRaw = body['repereAudioRef'];
      const photosRaw = body['preuvePhotoRefs'];
      if (audioRaw !== undefined && !isMediaRef(audioRaw)) {
        return Response.json({ ok: false, reason: 'repere_audio_ref_malformed' }, { status: 400 });
      }
      if (
        photosRaw !== undefined &&
        (!Array.isArray(photosRaw) || photosRaw.length > MAX_BRIEF_PHOTOS || !photosRaw.every(isMediaRef))
      ) {
        return Response.json({ ok: false, reason: 'preuve_photo_refs_malformed' }, { status: 400 });
      }
      /**
       * COLIS-FOURNISSEUR-1 — the articles' names, for the rider's door
       * (decision c: refuse ONE article, keep the rest). Optional — a package
       * composed without them still travels, its articles then numbered on
       * the rider's screen. REFUSED, NOT IGNORED when malformed: an order not
       * in this package, a name twice, or a name that is not a short line.
       *
       * COLIS-2 — a package-mate that no longer travels (retired alone on
       * this console, or cancelled) is still IN the package: Boutik+'s
       * console, which never heard of the retire, may still name it. Its name
       * is checked against the whole package and then left out of the brief —
       * the rider is never briefed with an article he will not carry.
       */
      const articlesRaw = body['articles'];
      const articlesLus = lireArticles(articlesRaw, this.colisDe[orderId]?.orderIds ?? duColis);
      if (articlesLus === 'malformed') {
        return Response.json({ ok: false, reason: 'articles_malformed' }, { status: 400 });
      }
      const articles = articlesLus?.filter((a) => duColis.includes(a.orderId));
      /**
       * VERIFIER MAJOR 3 — ONE OPEN TASK PER ORDER, at this door. A second
       * compose for an order that already has a live task is an accident (the
       * order has already left `/ops/a-preparer`, so nothing shows it to him);
       * it would put two riders on one delivery. A `closed_rescheduled` task
       * does NOT block — that is the lawful replacement path (WO-2.7), and it
       * runs through `openFollowUpTask`, never through this route.
       */
      const commandId = (body['command_id'] as string).trim();
      /**
       * ⚠ VERIFIER ROUND 2 — THE EXEMPTION IS PER TASK, NEVER GLOBAL. Round 1
       * exempted any command_id already in `processedCommandIds`, and the
       * verifier smuggled past it: a command admitted through the INTAKE door
       * with a foreign correlation_id made this route skip the check
       * entirely, while `onTaskReady`'s replay lookup (which matches on
       * correlation) found nothing and admitted a fresh task — two open tasks
       * for one order, the exact accident the rule exists to stop. The
       * exemption now asks the only question that is safe: was the open task
       * for THIS order put there by THIS command?
       */
      const openForOrder = this.queue
        .snapshot()
        .tasks.find(
          ([, queued]) =>
            (queued.orderId === orderId || duColis.includes(queued.orderId)) &&
            queued.status !== 'closed_rescheduled' &&
            // COURSE-REPRISE: a taken-back course's task blocks nothing — the
            // whole point of taking it back is composing a fresh one.
            queued.status !== 'closed_taken_back',
        );
      if (openForOrder !== undefined) {
        // AN OPEN TASK FOR THIS ORDER ENDS THE ROUTE, both ways. Either this
        // very command composed it — answer duplicate from the task itself,
        // never by falling through to a fresh admission — or it did not, and
        // a second task is exactly the accident this refuses. Round 2's cut
        // exempted the command and fell through; `onTaskReady`'s replay
        // lookup matches on CORRELATION, so a task admitted under a foreign
        // correlation was not recognised and a second one was created.
        if (openForOrder[1].admittedByCommandId === commandId) {
          return Response.json({ ok: true, admitted: true, duplicate: true, taskId: openForOrder[0] });
        }
        return Response.json(
          { ok: false, reason: 'order_already_has_task', taskId: openForOrder[0], status: openForOrder[1].status },
          { status: 409 },
        );
      }
      // Composed THROUGH the pinned canon: a task this platform cannot parse
      // never reaches the queue (the strict schema owns the shape, not this
      // route). The id is CSPRNG-minted HERE, and the refusal above is what
      // makes that sentence true rather than aspirational.
      const task = {
        type: 'delivery' as const,
        id: `task-${crypto.randomUUID()}`,
        orderId,
        location: {
          // An absent pin stays ABSENT — never a zeroed coordinate.
          ...(pin !== undefined ? { pin: { lat: pin['lat'] as number, lng: pin['lng'] as number } } : {}),
          zone: (loc['zone'] as string).trim(),
          landmark: (loc['landmark'] as string).trim(),
          directions: (loc['directions'] as string).trim(),
          maskedRelay: (loc['maskedRelay'] as string).trim(),
        },
        window: { start: win['start'] as string, end: win['end'] as string },
        status: 'ready',
      };
      let event: unknown;
      try {
        event = PlatformEventSchema.parse({
          name: 'logistics.task_ready.v1',
          envelope: {
            command_id: (body['command_id'] as string).trim(),
            correlation_id: `corr-${orderId}`,
            aggregateVersion: 1,
            actor: OPS_ACTOR,
            serverTime: now,
            version: '1',
          },
          payload: { task: DeliveryTaskSchema.parse(task) },
        });
      } catch {
        return malformed();
      }
      const outcome = this.queue.onTaskReady(event, now);
      if (!outcome.admitted) {
        // The gate refused the FOUNDER, and says why — an unfunded or
        // unprepared order cannot be dispatched by hand any more than by wire.
        return Response.json({ ok: false, admitted: false, reason: outcome.reason }, { status: 422 });
      }
      // COURSE-BRIEF filed against the ADMITTED task's own id — never the one
      // this route hoped for. A refused compose leaves no brief behind.
      this.briefs[outcome.task.id] = {
        ...(isMediaRef(audioRaw) ? { repereAudioRef: audioRaw } : {}),
        preuvePhotoRefs: Array.isArray(photosRaw) ? (photosRaw as string[]) : [],
        ...(articles !== undefined ? { articles } : {}),
      };
      return Response.json({
        ok: true,
        admitted: true,
        duplicate: outcome.duplicate,
        taskId: outcome.task.id,
        // COLIS-FOURNISSEUR-1 — which orders this course carries, said back.
        ...(duColis.length > 1 ? { colis: { orderIds: duColis } } : {}),
      });
    }

    /**
     * SE-LIVE-2c — WHAT IS WAITING FOR HIM. Orders both producers have
     * vouched for (funded per mode + ready) that carry no task yet. Derived
     * from the stored facts and the queue — never a guess, never a count that
     * outlives its evidence.
     */
    /**
     * RAMASSAGE — the supplier's half of the two-party pickup (SE5). The
     * SUPPLIER's console sends what the RIDER SAID; this door answers a
     * VERDICT and nothing else — never the expected code, never which
     * character missed, never whether an assignment exists (an absent course
     * and a wrong code are the same « non confirmé »: no oracle at a market
     * stall). Custody is untouched: confirming here authorises the HUMAN
     * handover; the custody chain still begins only at verification + seal
     * (SE-I05).
     *
     * ⚠ AN INTAKE DOOR, NOT AN OPS DOOR (founder, 2026-08-09: « that screen
     * should be on the supplier's console not mine »). The check stands where
     * the supplier stands, so the request arrives through Boutik+'s
     * offer-service — which already holds `SERA_INTAKE_SECRET` for readiness
     * — after IT has proven the order belongs to the asking supplier. The
     * founder's ops key opens every /ops/* door and deliberately NOT this
     * one: no secret that lives in one browser should be the handover's key.
     */
    if (request.method === 'POST' && pathname === '/intake/ramassage/verify') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['orderId']) || !isStr(body['code'])) {
        return malformed();
      }
      const orderId = (body['orderId'] as string).trim();
      // COLIS-FOURNISSEUR-1 — any article of a package names its one course:
      // one code at the stall for the whole bag.
      const active = this.courseDe(orderId);
      const attendu = active === undefined ? undefined : this.ramassage[active.assignmentId]?.code;
      const donne = normaliseCodeRamassage(body['code'] as string);
      const verdict =
        attendu !== undefined && donne !== '' && donne === normaliseCodeRamassage(attendu)
          ? 'confirme'
          : 'non_confirme';
      /**
       * VRAI-ROUTE — the CONFIRMED handshake is a fact the rider's own screen
       * turns on (« En route » appears only after the supplier confirmed the
       * code — the founder's sequence). First-wins: a supplier re-typing the
       * same code re-hears « confirmé » but the instant never moves.
       */
      if (verdict === 'confirme' && active !== undefined) {
        const rec = this.ramassage[active.assignmentId];
        if (rec !== undefined && rec.confirmeAt === undefined) {
          this.ramassage[active.assignmentId] = { ...rec, confirmeAt: now };
        }
      }
      return Response.json({ ok: true, verdict });
    }

    /**
     * RETOUR-VIVANT-1 — the supplier, package in hand, types the RIDER's
     * return code on his Boutik+ console (the ramassage handshake's mirror,
     * the same intake door). A confirmed code is his acceptance of the
     * package: it releases HIS key onto the rider's session so the rider's
     * handover act can present both keys to custody. First-wins, like the
     * ramassage: retyping re-hears « confirmé », the instant never moves.
     */
    if (request.method === 'POST' && pathname === '/intake/retour/verify') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['orderId']) || !isStr(body['code'])) {
        return malformed();
      }
      const orderId = (body['orderId'] as string).trim();
      const active = this.courseDe(orderId);
      const retour = active === undefined ? undefined : this.retours[active.assignmentId];
      const donne = normaliseCodeRamassage(body['code'] as string);
      const verdict =
        retour !== undefined && donne !== '' && donne === normaliseCodeRamassage(retour.codeRetour)
          ? 'confirme'
          : 'non_confirme';
      if (verdict === 'confirme' && active !== undefined && retour !== undefined && retour.confirmeAt === undefined) {
        this.retours[active.assignmentId] = { ...retour, confirmeAt: now };
        await this.state.storage.put(SNAP_RETOURS, this.retours);
      }
      return Response.json({ ok: true, verdict });
    }

    if (request.method === 'GET' && pathname === '/ops/a-preparer') {
      const withTask = new Set(
        this.queue
          .snapshot()
          // COURSE-REPRISE: a taken-back course leaves its order TASK-LESS in
          // every sense that matters — it must reappear here or the founder
          // can never re-compose it. ONLY that status is exempt: a
          // closed_rescheduled order is replaced by its follow-up task
          // automatically and must not surface twice.
          .tasks.filter(([, queued]) => queued.status !== 'closed_taken_back')
          .map(([, queued]) => queued.orderId),
      );
      // COLIS-FOURNISSEUR-1 — a package's course covers every order in it.
      for (const id of [...withTask]) {
        const v = this.voyageursDe(id);
        if (Array.isArray(v)) for (const membre of v) withTask.add(membre);
      }
      const pret = (orderId: string): boolean => {
        const fact = this.fundingFacts[orderId];
        // PORTE-DISPATCH (2026-08-13): the SAME two-mode admission as the
        // compose gate (ADMITTED_PAYMENT_MODES) — a funded+ready door order
        // must appear on the founder's list; an unknown mode stays off it.
        if (fact === undefined || fact.status !== 'funded' || fact.stale || !ADMITTED_PAYMENT_MODES.includes(fact.paymentMode)) return false;
        const readiness = this.readinessFacts[orderId];
        return readiness !== undefined && readiness.ready && !readiness.stale;
      };
      const attente = Object.entries(this.fundingFacts)
        .flatMap(([orderId, fact]) => {
          if (withTask.has(orderId) || !pret(orderId)) return [];
          /**
           * COLIS-FOURNISSEUR-1 — a package is ONE line, under its first
           * travelling order, and only once EVERY order in it is paid and
           * ready: the founder composes one course for the whole bag, never
           * half of it.
           */
          const voyage = this.voyageursDe(orderId);
          if (voyage === 'incomplet' || voyage[0] !== orderId || !voyage.every(pret)) return [];
          const colis = this.colisDe[orderId];
          return [{
            orderId,
            paymentMode: fact.paymentMode,
            fundedAsOf: fact.asOf,
            readyAsOf: this.readinessFacts[orderId]?.asOf ?? null,
            ...(colis !== undefined && voyage.length > 1 ? { colis: { packageId: colis.packageId, orderIds: voyage } } : {}),
          }];
        })
        .sort((a, b) => (a.orderId < b.orderId ? -1 : 1));
      return Response.json({ ok: true, attente });
    }

    if (request.method === 'POST' && pathname === '/ops/expire-due') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body !== null && body['nowIso'] !== undefined && !isIso(body['nowIso'])) return malformed();
      // The sweep instant may be supplied (ops door only — deterministic
      // tests and honest re-runs); default is the server's now.
      const sweepAt = (body?.['nowIso'] as string | undefined) ?? now;
      const swept = await this.dispatch.expireDue(sweepAt);
      return Response.json({
        ok: true,
        expiredLeases: swept.expiredLeases,
        requeued: swept.requeued,
        events: swept.events,
      });
    }

    /**
     * ═══ SE-LIVE-4b-ii — THE ONE BOOK ANSWERS, IT DOES NOT LEND ═══
     *
     * FOUNDER RULING (2026-08-07): rider identity stays in logistics; custody
     * asks. « One place mints and revokes a rider code; custody only ever asks
     * *is this code this rider's, right now* and gets a riderId or a refusal. »
     *
     * This is that question and nothing else. It resolves a presented code to a
     * riderId — the same `resolveCode` the rider door itself uses, so a revoked
     * code stops answering HERE the instant it stops answering THERE, because
     * revoke deletes the hash both of them read. There is no second credential
     * store to fall out of step with this one, which is the whole point of the
     * ruling.
     *
     * It returns a riderId and NOTHING ELSE — no shift, no assignment, no
     * roster row. Custody needs to know who is holding the phone; it has no
     * business knowing what else this rider is doing today.
     */
    if (request.method === 'POST' && pathname === '/verify/rider-code') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const presented = body?.['code'];
      const record = await this.resolveCode(presented);
      // The SAME uniform refusal the rider door gives, for the same reason: a
      // caller must not be able to tell « no such code » from « revoked ».
      if (record === null) return unauthorized();
      return Response.json({ ok: true, riderId: record.riderId });
    }

    /**
     * ═══ COURSE-LIVRÉE — CUSTODY'S DROP CONFIRMATION FREES THE RIDER ═══
     *
     * Founder (2026-08-13): « once delivery and everything is confirmé … on
     * rider's sera app make it close nicely and return to the initial state
     * waiting for another order ». The app half already holds (it resets when
     * `/rider/moi` answers `assignment: null`); THIS is the service half: the
     * custody Worker's at-least-once outbox posts here from its
     * provider-truth `/delivery/drop` commit — the moment the custody domain
     * knows `custody.transferred_to_customer.v1` — and the course ends as the
     * NAMED SUCCESS `delivered` (SE-I10 bans generic FAILED terminals; a
     * named success is lawful).
     *
     * NEVER FROM A RIDER'S HAND: a carrier must never validate their own
     * delivery. The router opens `/produce/*` only under
     * `SERA_COURSE_LIVREE_SECRET` (custody's own key, its own door — the
     * `/verify/` discipline), and the rider road cannot reach it: a
     * `/rider/produce/...` path falls through the rider block's allowlist to
     * its 404.
     *
     * EVERY SETTLED CONDITION ANSWERS 200, BY NAME. The sender retries on
     * `!res.ok` for ever (bounded backoff, never gives up), so a permanent
     * condition returned as 4xx/5xx would be hammered until the end of time:
     * `livree` (the transition happened, lease released, rider free),
     * `deja_livree` (idempotent replay — the book's state answers), and
     * `aucune_course` (no active course for this order: never assigned,
     * returned to the queue, or taken back — nothing to close, and saying so
     * settles the wire honestly). Only a malformed body is a 400: that is a
     * producer bug, and a repeating refusal in both Workers' logs is the
     * eligibility wire's own taxonomy for it.
     */
    if (request.method === 'POST' && pathname === '/produce/course-livree') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['orderId']) || !isIso(body['at'])) {
        return malformed();
      }
      const reglement = await this.reglerColis((body['orderId'] as string).trim(), 'livree', body['at'] as string);
      if (reglement !== null) return reglement;
      const outcome = await this.dispatch.deliver((body['orderId'] as string).trim(), body['at'] as string);
      if (!outcome.ok) {
        return Response.json({ ok: true, status: 'aucune_course' });
      }
      // FLOTTE-1 — the delivery is counted the instant custody's wire closes
      // the course, on the moto the rider had; the redelivery counts nothing.
      if (!outcome.duplicate) {
        this.flotte = logCourse(this.flotte, { orderId: outcome.assignment.orderId, riderId: outcome.assignment.riderId, kind: 'livree', at: body['at'] as string });
        await this.state.storage.put(SNAP_FLOTTE, this.flotte);
      }
      return Response.json({
        ok: true,
        status: outcome.duplicate ? 'deja_livree' : 'livree',
        leaseReleased: outcome.leaseReleased,
        assignment: {
          assignmentId: outcome.assignment.assignmentId,
          taskId: outcome.assignment.taskId,
          orderId: outcome.assignment.orderId,
          riderId: outcome.assignment.riderId,
          status: outcome.assignment.status,
          deliveredAt: outcome.assignment.deliveredAt ?? null,
        },
      });
    }

    /**
     * RETOUR-VIVANT-1 — custody says the return OPENED (its own ledger's
     * word, over the same produce wire as course-livrée): mint the two
     * handover keys ONCE for the active course, show the rider's on his
     * session, and arm both on custody from the alarm. Every settled
     * condition answers 200 by name so the at-least-once sender can stop.
     */
    if (request.method === 'POST' && pathname === '/produce/retour-ouvert') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['orderId']) || !isIso(body['at'])) {
        return malformed();
      }
      const orderId = (body['orderId'] as string).trim();
      const active = this.courseDe(orderId);
      if (active === undefined) return Response.json({ ok: true, status: 'aucune_course' });
      const ouvert = this.retours[active.assignmentId];
      if (ouvert !== undefined) {
        /**
         * COLIS-FOURNISSEUR-1 — ONE return bag per course. A second article
         * of the package refused at the same door joins the bag already
         * open: the same two keys, armed on its own custody file too (the
         * alarm arms every order not yet armed), handed over together.
         */
        const membres = ouvert.orderIds ?? [ouvert.orderId];
        if (membres.includes(orderId)) return Response.json({ ok: true, status: 'deja_ouvert' });
        this.retours[active.assignmentId] = { ...ouvert, orderIds: [...membres, orderId], armPhase: 'pending' };
        this.reschedules.forgetOrder(orderId);
        await this.state.storage.put(SNAP_RETOURS, this.retours);
        if ((await this.state.storage.getAlarm()) === null) {
          await this.state.storage.setAlarm(Date.now()).catch(() => undefined);
        }
        return Response.json({ ok: true, status: 'retour_complete' });
      }
      this.retours[active.assignmentId] = {
        orderId,
        orderIds: [orderId],
        codeRetour: mintCodeRamassage(),
        codeFournisseur: mintCodeRamassage(),
        ouvertAt: body['at'] as string,
        armPhase: 'pending',
        armAttempts: 0,
        armRest: 'none',
      };
      // REPROGRAMMATION-2 (verifier MINOR, closed): the package is going home
      // — a passage the founder might still fix over it leaves the desk.
      this.reschedules.forgetOrder(orderId);
      await this.state.storage.put(SNAP_RETOURS, this.retours);
      if ((await this.state.storage.getAlarm()) === null) {
        await this.state.storage.setAlarm(Date.now()).catch(() => undefined);
      }
      return Response.json({ ok: true, status: 'retour_ouvert' });
    }

    /**
     * RETOUR-VIVANT-1 — custody says the two keys were CONSUMED and the
     * package is with its supplier: the course closes `returned`, the lease
     * releases, the rider walks free. `deliver`'s twin, same settled answers.
     */
    if (request.method === 'POST' && pathname === '/produce/course-retournee') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['orderId']) || !isIso(body['at'])) {
        return malformed();
      }
      const reglement = await this.reglerColis((body['orderId'] as string).trim(), 'retournee', body['at'] as string);
      if (reglement !== null) return reglement;
      const outcome = await this.dispatch.returnToSupplier((body['orderId'] as string).trim(), body['at'] as string);
      if (!outcome.ok) {
        return Response.json({ ok: true, status: 'aucune_course' });
      }
      // FLOTTE-1 — a return is a closed course too, counted once against the
      // failed-delivery rate the §7.2 gate will read (SE7.3).
      if (!outcome.duplicate) {
        this.flotte = logCourse(this.flotte, { orderId: outcome.assignment.orderId, riderId: outcome.assignment.riderId, kind: 'retournee', at: body['at'] as string });
      }
      await this.persist();
      return Response.json({
        ok: true,
        status: outcome.duplicate ? 'deja_retournee' : 'retournee',
        leaseReleased: outcome.leaseReleased,
        assignment: {
          assignmentId: outcome.assignment.assignmentId,
          taskId: outcome.assignment.taskId,
          orderId: outcome.assignment.orderId,
          riderId: outcome.assignment.riderId,
          status: outcome.assignment.status,
        },
      });
    }

    /**
     * REPROGRAMMATION-1 — the SEVENTH wire from custody: the §6.4 window
     * expired on a NON-escalating reason, the ladder proceeded to a canonical
     * `reschedule` DeliveryOutcome (attempt 2), the rider keeps the package
     * (§6.5). The outcome rests in the RescheduleBook until the founder fixes
     * the next passage on his console. Every settled condition answers 200 by
     * name so the at-least-once sender can stop; only a malformed or
     * non-canonical body is a 400 — a producer bug, and a repeating refusal
     * in both Workers' logs is the eligibility wire's own taxonomy for it.
     */
    if (request.method === 'POST' && pathname === '/produce/reprogrammation') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['orderId']) || !isIso(body['at'])) {
        return malformed();
      }
      const orderId = (body['orderId'] as string).trim();
      const outcome = body['outcome'];
      if (outcome === null || typeof outcome !== 'object' || (outcome as Record<string, unknown>)['orderId'] !== orderId) {
        return malformed();
      }
      const active = this.courseDe(orderId);
      if (active === undefined) return Response.json({ ok: true, status: 'aucune_course' });
      /**
       * COLIS-FOURNISSEUR-1 — a package is rescheduled as ONE course, on its
       * first order's word: the rider names the absence for every article,
       * every article's ledger records it, and the desk fixes ONE next
       * passage. The other articles' wires are settled by name, never
       * recorded as passages of their own to fix.
       */
      if (active.orderId !== orderId) return Response.json({ ok: true, status: 'colis_suit_la_tete' });
      /**
       * VERIFIER MAJOR (closed) — THE OUTCOME MUST NAME THE LIVE COURSE'S
       * TASK. Custody's outcome names the chain's task (the first attempt);
       * once a follow-up consumed the reschedule the course names ITS task,
       * and a redelivery (custody is at-least-once: a lost 200 re-sends) or
       * a stale outcome against a recomposed course would re-record a row no
       * fix could ever clear — `prior_task_mismatch` for ever, the only
       * clearing door a retire of a LIVE course. Settled by name instead:
       * the sender stops, nothing is recorded.
       */
      if ((outcome as Record<string, unknown>)['taskId'] !== active.taskId) {
        return Response.json({ ok: true, status: 'tache_differente' });
      }
      if (this.reschedules.openFor(orderId) !== undefined) return Response.json({ ok: true, status: 'deja_enregistre' });
      const recorded = this.reschedules.recordRescheduleOutcome(outcome);
      if (!recorded.ok) return Response.json({ ok: false, reason: recorded.reason }, { status: 400 });
      return Response.json({ ok: true, status: 'enregistre' });
    }

    /**
     * ═══ REPROGRAMMATION-1 — THE FOUNDER FIXES THE NEXT PASSAGE ═══
     *
     * Custody said « reschedule » and the rider still holds the package. This
     * door opens the WO-2.7 follow-up task — a NEW task id on the SAME order,
     * the buyer's next window as its window, the first attempt's location —
     * through the FULL intake gate again (funded per mode + ready + not
     * cancelled + not stale: a reschedule buys a new attempt, never a
     * bypass), closes the prior task lawfully, and moves the SAME live course
     * onto it (`LeasedDispatch.reprogrammer`: same assignment, same rider,
     * same anchored lease — never a second course for a package the rider
     * already carries, never an instant where he reads as free). The rider's
     * next `/rider/moi` carries the follow-up's window and `passage: 2`.
     *
     * Custody is untouched: the chain, the seal and the buyer's code are
     * exactly what they were, and the drop at the 2e passage is the ordinary
     * drop. The brief (voice note + proof photos) follows the course onto the
     * new task id so nothing the rider was shown disappears.
     *
     * Idempotent by COMMAND (a retried tap answers the follow-up it already
     * opened) and refuse-closed by STATE: no open reschedule → nothing to fix;
     * an unacknowledged course → not yet; a window already past → said so.
     */
    if (request.method === 'POST' && pathname === '/ops/reprogrammer') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const fenetre = body?.['fenetre'] as Record<string, unknown> | undefined;
      if (
        body === null ||
        !isStr(body['command_id']) ||
        !isStr(body['orderId']) ||
        fenetre === null || typeof fenetre !== 'object' ||
        !isIso(fenetre['start']) || !isIso(fenetre['end'])
      ) {
        return malformed();
      }
      const commandId = (body['command_id'] as string).trim();
      const orderId = (body['orderId'] as string).trim();
      const start = fenetre['start'] as string;
      const end = fenetre['end'] as string;
      // THE REPLAY IS JUDGED FIRST (verifier MINOR, closed): a retried tap
      // whose window has meanwhile passed is still the fix it already made,
      // never a fresh refusal over a passage the rider is already reading.
      const replay = this.reprogrammations[commandId];
      if (replay !== undefined) {
        return Response.json({
          ok: true,
          duplicate: true,
          taskId: replay.taskId,
          priorTaskIds: this.reschedules.priorTaskIdsOf(replay.taskId),
          passage: this.reschedules.priorTaskIdsOf(replay.taskId).length + 1,
        });
      }
      if (Date.parse(start) >= Date.parse(end)) {
        return Response.json({ ok: false, reason: 'fenetre_invalide' }, { status: 400 });
      }
      if (Date.parse(end) <= Date.parse(now)) {
        return Response.json({ ok: false, reason: 'fenetre_passee' }, { status: 400 });
      }
      const active = this.courseDe(orderId);
      if (active === undefined) return Response.json({ ok: false, reason: 'no_active_course' }, { status: 409 });
      if (active.status !== 'acknowledged') return Response.json({ ok: false, reason: 'course_non_acceptee' }, { status: 409 });
      // COLIS-FOURNISSEUR-1 — the passage is the package's, kept on its first order.
      const open = this.reschedules.openFor(active.orderId);
      if (open === undefined) return Response.json({ ok: false, reason: 'order_not_rescheduled' }, { status: 409 });
      const prior = this.queue.get(active.taskId);
      if (prior === undefined) return Response.json({ ok: false, reason: 'prior_task_missing' }, { status: 409 });
      // The follow-up: the prior attempt's canonical task, re-identified and
      // re-windowed — through the pinned canon, exactly as `/ops/task` composes.
      let newTask: unknown;
      try {
        newTask = DeliveryTaskSchema.parse({ ...prior.task, id: `task-${crypto.randomUUID()}`, window: { start, end }, status: 'ready' });
      } catch {
        return malformed();
      }
      const outcome = this.dispatch.reprogrammer({
        command_id: commandId,
        dispatcherId: OPS_ACTOR,
        assignmentId: active.assignmentId,
        priorTaskId: active.taskId,
        newTask,
        at: now,
      });
      if (!outcome.ok) {
        return Response.json({ ok: false, reason: outcome.reason, ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}) }, { status: 409 });
      }
      const brief = this.briefs[active.taskId];
      if (brief !== undefined) this.briefs[outcome.taskId] = brief;
      this.reprogrammations[commandId] = { orderId: active.orderId, taskId: outcome.taskId };
      return Response.json({
        ok: true,
        duplicate: false,
        taskId: outcome.taskId,
        priorTaskIds: outcome.priorTaskIds,
        passage: outcome.priorTaskIds.length + 1,
        fenetre: { start, end },
      });
    }

    /**
     * ═══ REPROGRAMMATION-2 — THE DISPATCHER SENDS A RESCHEDULED COURSE HOME ═══
     *
     * §6.5: « dispatcher applies retry / reschedule / return ». The buyer was
     * absent again at the 2e passage, or the founder will not plan another
     * trip: his console act arrives here on his ops key and is RELAYED to
     * custody's produce door (`/return/apply`) on this object's own key —
     * custody records the decision on the ladder (fee NOT retained: an
     * absence is not a refusal), and ONLY then does this book remember it.
     * The rider's next `/rider/moi` carries `retourDecideAt`, his phone turns
     * to the return road, and everything from there is RETOUR-VIVANT-1's:
     * the seal, the two keys, custody courier → seller on the ledger's word.
     *
     * Refuse-closed by state: no live acknowledged course; a course custody
     * never rescheduled (no open reschedule, first passage) — custody would
     * refuse `no_reschedule_to_return` anyway, said here first in the
     * founder's words; custody unreachable is a 503 said as such, never a
     * silent « done ». Idempotent by state (`deja_decide`), and custody
     * replays the relayed command by id if this book's write was lost.
     */
    if (request.method === 'POST' && pathname === '/ops/retour/decider') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isStr(body['command_id']) || !isStr(body['orderId'])) return malformed();
      const commandId = (body['command_id'] as string).trim();
      const active = this.courseDe((body['orderId'] as string).trim());
      if (active === undefined) return Response.json({ ok: false, reason: 'no_active_course' }, { status: 409 });
      if (active.status !== 'acknowledged') return Response.json({ ok: false, reason: 'course_non_acceptee' }, { status: 409 });
      // COLIS-FOURNISSEUR-1 — the decision is the package's: every article
      // goes home, each on its own ledger (below), the passage kept on the first.
      const orderId = active.orderId;
      const decided = this.retourDecide[active.assignmentId];
      if (decided !== undefined) return Response.json({ ok: true, status: 'deja_decide', decideAt: decided.decideAt });
      // The rider already opened the return (a valid refusal at the door):
      // the package is on its way home without the founder's word — said by
      // name, never relayed to a custody that would refuse `return_in_progress`.
      if (this.retours[active.assignmentId] !== undefined) return Response.json({ ok: false, reason: 'retour_deja_ouvert' }, { status: 409 });
      const passage = this.reschedules.priorTaskIdsOf(active.taskId).length + 1;
      if (passage < 2 && this.reschedules.openFor(orderId) === undefined) {
        return Response.json({ ok: false, reason: 'course_non_reprogrammee' }, { status: 409 });
      }
      const custody = this.env.CUSTODY;
      const key = this.env.SERA_PRODUCE_SECRET ?? '';
      if (custody === undefined || key === '') return Response.json({ ok: false, reason: 'custody_non_relie' }, { status: 503 });
      /**
       * COLIS-FOURNISSEUR-1 — relayed to EVERY article's ledger, one after the
       * other, the first order's last; this book remembers the decision only
       * once all of them accepted. A retry after a partial answer is safe:
       * each ledger replays the same command id's recorded answer.
       */
      let answer: Record<string, unknown> | null = null;
      for (const id of [...this.ordresDeCourse(active).slice(1), orderId]) {
        let res: Response;
        try {
          res = await custody.fetch(new Request('https://custody/produce/return/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ orderId: id, command_id: `retour-decide-${commandId}`, at: now }),
          }));
        } catch {
          return Response.json({ ok: false, reason: 'custody_unreachable' }, { status: 503 });
        }
        answer = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (res.status >= 500) return Response.json({ ok: false, reason: 'custody_unreachable' }, { status: 503 });
        if (!res.ok) {
          return Response.json({ ok: false, reason: 'custody_refused', detail: typeof answer?.['reason'] === 'string' ? answer['reason'] : 'refused' }, { status: 409 });
        }
      }
      this.retourDecide[active.assignmentId] = { orderId, decideAt: now };
      // The passage the founder might still have fixed is off the desk: the
      // package is going home.
      this.reschedules.forgetOrder(orderId);
      return Response.json({ ok: true, status: 'retour_decide', decideAt: now, outcome: answer?.['outcome'] ?? null });
    }

    // ── Rider door (personal code — resolved HERE, hashes live with the book) ──
    if (pathname.startsWith('/rider/')) {
      const header = request.headers.get('Authorization') ?? '';
      const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
      const codeRecord = await this.resolveCode(presented);
      if (codeRecord === null) return unauthorized();
      const riderId = codeRecord.riderId;

      if (request.method === 'GET' && pathname === '/rider/moi') {
        // The lazy sweep (see /ops/board): a rider polling their session must
        // never be shown a course whose lease already died.
        await this.dispatch.expireDue(now);
        // MANIFESTE-1 — custody's word on his package, fresh for this read
        // (one bounded call per live course; the pilot has one).
        await this.refreshCustody(riderId, now);
        await this.state.storage.put(SNAP_CUSTODY_FACTS, this.custodyFacts);
        // …and a pending exception the fresh word no longer covers is dropped
        // here, on his own read — never a standing permission.
        if (this.pruneFinDeService(riderId)) await this.state.storage.put(SNAP_FIN_DE_SERVICE, this.finDeService);
        return Response.json({ ok: true, rider: this.riderView(riderId) });
      }
      /**
       * ⚠ SE-LIVE-4d — THE SOS WIRE (founder order, 2026-08-07). Until this
       * route existed the rider app's SOS reached NOTHING: the raise went to
       * the app's own demo store and the screen said « Alerte envoyée ». This
       * is where it actually arrives.
       *
       * THE RIDER IS THE ONE WHO RAISES, and their own code is what proves it
       * — `riderId` comes from `resolveCode` above, never from the body, so an
       * alert can never be filed under someone else's name. The app's minted
       * `command_id` makes one press one incident however many times the
       * outbox retries it.
       *
       * NO SHIFT CHECK, DELIBERATELY. A rider in danger off-shift is still a
       * rider in danger. `onShift` is recorded as context for the dispatcher,
       * never as a condition of being heard.
       */
      if (request.method === 'POST' && pathname === '/rider/sos') {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const incident = raiseFromBody({ ...(body ?? {}), riderId }, now);
        if (incident === null) return malformed();
        const outcome = await sosRaise(this.sosStore, incident);
        if (!outcome.ok) return malformed();
        // The rider is told it ARRIVED — which is now a true statement — and
        // nothing more. Whether anyone has answered is `state`, not a promise.
        return Response.json({
          ok: true,
          duplicate: outcome.duplicate,
          incident: outcome.incident,
          event: SOS_EVENT_CREATED,
        });
      }
      if (request.method === 'POST' && pathname === '/rider/ack-privacy') {
        this.registry.acknowledgePrivacyNotice(riderId, PRIVACY_NOTICE_VERSION, now);
        return Response.json({ ok: true, noticeVersion: PRIVACY_NOTICE_VERSION });
      }
      if (request.method === 'POST' && pathname === '/rider/shift/start') {
        // A command that REACHED this object is server-confirmed by
        // definition; the offline outbox queues on the phone, never here.
        const outcome = this.registry.startShift(riderId, now, 'server_confirmed');
        if (outcome.ok) {
          // FLOTTE-1 — the shift record opens on the moto he holds.
          this.flotte = openShift(this.flotte, riderId, now, () => `shift-${crypto.randomUUID()}`);
          await this.persist();
        }
        return this.shiftResponse(outcome);
      }
      if (request.method === 'POST' && pathname === '/rider/shift/end') {
        /**
         * ═══ SE3.2 ON THE LIVE ROAD (MANIFESTE-1) — THE SEAM ASKS THE LEDGER ═══
         *
         * Until this build the declaration was honestly empty (« custody is
         * not live yet »); custody has been live since SE-LIVE-4b and the door
         * kept passing `[]`, so a carrying rider could end her shift. Now the
         * held packages are custody's OWN word, read fresh for every course
         * the manifest lists — never a caller's claim, never a task status.
         * Silence FAILS CLOSED: a shift does not end on a guess about a
         * package (« package never unowned »). The registry's law then rules:
         * holding ⇒ refused `custody_would_be_orphaned` unless the dispatcher's
         * exception covers every held package; the exception is consumed by
         * the end it authorized and logged on the registry as audit evidence.
         */
        const allKnown = await this.refreshCustody(riderId, now);
        const held = this.manifestFor(riderId).custodyInventory;
        if (!allKnown) {
          await this.state.storage.put(SNAP_CUSTODY_FACTS, this.custodyFacts);
          return Response.json({ ok: false, reason: 'custody_unverifiable' }, { status: 503 });
        }
        const exception = this.finDeServiceCouvre(riderId, held);
        const outcome = this.registry.endShift(riderId, now, 'server_confirmed', {
          heldPackageIds: held,
          ...(exception === undefined ? {} : { exception: { dispatcherAckId: exception.dispatcherAckId, nextOwner: exception.nextOwner } }),
        });
        // Consumed by ANY end that succeeded — used (logged on the registry),
        // or moot (nothing carried any more): a row never outlives the shift.
        if (outcome.ok) delete this.finDeService[riderId];
        // FLOTTE-1 — the shift record closes with the registry's word.
        if (outcome.ok) this.flotte = closeShift(this.flotte, riderId, now);
        await this.persist();
        return this.shiftResponse(outcome);
      }
      if (request.method === 'POST' && (pathname === '/rider/assignment/ack' || pathname === '/rider/assignment/decline')) {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (body === null || !isStr(body['assignmentId'])) return malformed();
        const assignmentId = (body['assignmentId'] as string).trim();
        const assignment = this.book.get(assignmentId);
        // Ownership: a rider acts only on THEIR assignment. Foreign and
        // unknown ids are the SAME answer — no oracle.
        if (assignment === undefined || assignment.riderId !== riderId) {
          return Response.json({ ok: false, reason: 'unknown_assignment' }, { status: 404 });
        }
        if (pathname === '/rider/assignment/ack') {
          const outcome = await this.dispatch.acknowledge(assignmentId, 'server_confirmed', now);
          if (!outcome.ok) return Response.json(outcome, { status: 409 });
          return Response.json(outcome);
        }
        const outcome = await this.dispatch.decline(assignmentId, 'server_confirmed', now);
        if (!outcome.ok) return Response.json(outcome, { status: 409 });
        return Response.json(outcome);
      }
      return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
    }

    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }

  /**
   * SE-LIVE-4d — the SOS book's storage, bound to this object. One durable
   * row per incident, keyed by the app's minted `command_id`, so a retry finds
   * the incident it already opened instead of opening another.
   */
  private get sosStore(): SosStore {
    return {
      get: (key) => this.state.storage.get<SosIncident>(key),
      put: async (key, value) => {
        await this.state.storage.put(key, value);
      },
      list: async () => {
        const rows = await this.state.storage.list<SosIncident>({ prefix: SOS_PREFIX });
        return [...rows.values()];
      },
    };
  }

  /** Hash the presented code and look it up — a miss, a non-string, and a
   *  revoked code are all the SAME null (one uniform 401), never an oracle. */
  private async resolveCode(presented: unknown): Promise<RiderCodeRecord | null> {
    if (typeof presented !== 'string' || presented === '') return null;
    const record = await this.state.storage.get<RiderCodeRecord>(`${CODEHASH_PREFIX}${await sha256Hex(presented)}`);
    return record ?? null;
  }

  private shiftResponse(outcome: ShiftOutcome): Response {
    if (!outcome.ok) {
      const status = outcome.reason === 'unknown_rider' ? 404 : 409;
      return Response.json(outcome, { status });
    }
    return Response.json(outcome);
  }

  /** Riders holding a LIVE assignment right now — the book's truth, the same
   *  active set the one-active-per-rider invariant guards at assign time. */
  private ridersCarrying(): Set<string> {
    const carrying = new Set<string>();
    for (const [, record] of this.book.snapshot().assignments) {
      if (ACTIVE_ASSIGNMENT_STATUSES.includes(record.status)) carrying.add(record.riderId);
    }
    return carrying;
  }

  /** The dispatch board — queued tasks, the roster, live assignments. Reads
   * from the same snapshots the persistence layer uses; recomputes nothing.
   *
   * ⚠ FOUNDER REPORT (2026-08-09): « after giving an order to boss it's still
   * showing confier à boss on other products ». The ASSIGN door has always
   * refused a busy rider (`rider_already_has_active_assignment`) — but this
   * projection said `assignable: true` for him, so every other order offered
   * a button whose only possible outcome was that refusal. `assignable` now
   * means what the door will actually do: certified + on-shift + NOT carrying. */
  private board(): {
    queued: { taskId: string; orderId: string; admittedAt: string; window: unknown; location: unknown; colis?: { orderIds: string[] } }[];
    riders: (RiderRecord & { shift: unknown; assignable: boolean })[];
    assignments: AssignmentRecord[];
    aReprogrammer: { orderId: string; taskId: string; assignmentId: string; riderId: string; reasonCode: string; recordedAt: string }[];
    enDeuxiemePassage: { orderId: string; taskId: string; assignmentId: string; riderId: string; passage: number; window: unknown }[];
    /** MANIFESTE-1 — one manifest per rider who has a course or a package (SE-I03). */
    manifestes: Record<string, RiderManifestView>;
    /** SE3.2 — the pending end-shift exceptions, by rider. */
    finDeService: Record<string, FinDeServiceRow>;
    /** COLIS-FOURNISSEUR-1 — live courses carrying a package, by assignmentId. */
    colisEnCourse: Record<string, ColisCourse>;
  } {
    const queued = this.queue.queuedTasks().map((q) => {
      // COLIS-FOURNISSEUR-1 — a queued package says what it carries.
      const voyage = this.voyageursDe(q.orderId);
      return {
        taskId: q.task.id,
        orderId: q.orderId,
        admittedAt: q.admittedAt,
        window: q.task.window,
        location: q.task.location,
        ...(Array.isArray(voyage) && voyage.length > 1 ? { colis: { orderIds: voyage } } : {}),
      };
    });
    const carrying = this.ridersCarrying();
    const riders = this.registry
      .snapshot()
      .riders.map(([, record]) => ({
        ...record,
        shift: this.registry.shift(record.riderId),
        assignable: this.registry.isAssignable(record.riderId) && !carrying.has(record.riderId),
      }))
      .sort((a, b) => (a.riderId < b.riderId ? -1 : 1));
    const assignments = this.book
      .snapshot()
      .assignments.map(([, record]) => record)
      .filter((record) => ACTIVE_ASSIGNMENT_STATUSES.includes(record.status));
    // REPROGRAMMATION-1 — the courses custody sent back to the founder for a
    // next passage: each names the LIVE course still carrying the package. An
    // open reschedule whose course is gone (retired between the wire and the
    // read) is not a row — there is nothing left to fix a passage for.
    const aReprogrammer = this.reschedules
      .openAll()
      .flatMap(([orderId, outcome]) => {
        const course = assignments.find((record) => record.orderId === orderId);
        if (course === undefined) return [];
        return [{
          orderId,
          taskId: outcome.taskId,
          assignmentId: course.assignmentId,
          riderId: course.riderId,
          reasonCode: outcome.reasonCode,
          recordedAt: outcome.attempt.at,
        }];
      })
      .sort((a, b) => (a.orderId < b.orderId ? -1 : 1));
    // REPROGRAMMATION-2 — the live courses already on a follow-up task, with
    // the window the founder fixed: the list his « Renvoyer au vendeur » lever
    // also serves. A course whose return he already decided is on neither
    // list — it is going home.
    // Neither list holds a course whose return is already open on this book
    // (the rider's valid refusal): the package is going home, and a passage
    // fixed over it would be a task minted for nothing.
    const enRetour = (assignmentId: string): boolean =>
      this.retourDecide[assignmentId] !== undefined || this.retours[assignmentId] !== undefined;
    const enDeuxiemePassage = assignments
      .filter((record) => !enRetour(record.assignmentId))
      .map((record) => ({ record, passage: this.reschedules.priorTaskIdsOf(record.taskId).length + 1 }))
      .filter(({ passage }) => passage >= 2)
      .map(({ record, passage }) => ({
        orderId: record.orderId,
        taskId: record.taskId,
        assignmentId: record.assignmentId,
        riderId: record.riderId,
        passage,
        window: this.queue.get(record.taskId)?.task.window ?? null,
      }))
      .sort((a, b) => (a.orderId < b.orderId ? -1 : 1));
    // MANIFESTE-1 — every rider with a live course, or a package the ledger
    // still places with him, has ONE manifest on the board (derived; the
    // custody facts are those last heard — the rider's own reads and every
    // end-shift refresh them).
    const manifestes: Record<string, RiderManifestView> = {};
    for (const [, record] of this.registry.snapshot().riders) {
      const m = this.manifestFor(record.riderId);
      if (m.status === 'active') manifestes[record.riderId] = m;
    }
    return {
      queued,
      riders,
      assignments,
      aReprogrammer: aReprogrammer.filter((row) => !enRetour(row.assignmentId)),
      enDeuxiemePassage,
      manifestes,
      finDeService: this.finDeServiceEnAttente(),
      colisEnCourse: Object.fromEntries(
        assignments.flatMap((a) => (this.colisCourses[a.assignmentId] === undefined ? [] : [[a.assignmentId, this.colisCourses[a.assignmentId]!]])),
      ),
    };
  }

  private riderView(riderId: string): Record<string, unknown> {
    const record = this.registry.rider(riderId);
    const assignment = this.book
      .snapshot()
      .assignments.map(([, r]) => r)
      .find((r) => r.riderId === riderId && ACTIVE_ASSIGNMENT_STATUSES.includes(r.status));
    const queued = assignment === undefined ? undefined : this.queue.get(assignment.taskId);
    return {
      riderId,
      displayName: record?.displayName ?? '',
      certified: record?.certified ?? false,
      privacyAckOk: record?.privacyAck?.noticeVersion === PRIVACY_NOTICE_VERSION,
      noticeVersion: PRIVACY_NOTICE_VERSION,
      shift: this.registry.shift(riderId),
      /**
       * MANIFESTE-1 (SE3.1) — the rider's ONE manifest: ordered stops, the
       * one current stop, what the ledger places with him (as last heard),
       * and whether the desk authorized ending his service with it (SE3.2).
       */
      manifest: this.manifestFor(riderId),
      finDeServiceAutorisee: this.finDeServiceCouvre(riderId, this.manifestFor(riderId).custodyInventory) !== undefined,
      assignment:
        assignment === undefined
          ? null
          : {
              assignmentId: assignment.assignmentId,
              taskId: assignment.taskId,
              orderId: assignment.orderId,
              status: assignment.status,
              ackDeadline: assignment.ackDeadline,
              window: queued?.task.window ?? null,
              location: queued?.task.location ?? null,
              /**
               * COURSE-BRIEF — the founder's order: « nowhere to listen the
               * repère audio … it has to carry as well the proof photos ».
               * Pointers only; the app fetches them from its own media base,
               * so this read stays small on a 2G connection. A course
               * composed before this existed answers an honest empty brief,
               * never a fabricated one.
               */
              repereAudioRef: this.briefs[assignment.taskId]?.repereAudioRef ?? null,
              preuvePhotoRefs: this.briefs[assignment.taskId]?.preuvePhotoRefs ?? [],
              /** RAMASSAGE — shown to its OWN rider, said to the supplier. */
              codeRamassage: this.ramassage[assignment.assignmentId]?.code ?? null,
              /**
               * VRAI-ROUTE — the two facts the rider's JOURNEY screens turn
               * on. `ramassageConfirmeAt` is when the supplier confirmed the
               * handshake (the « En route » button appears then, never
               * before); `codeVerification` is the machine-carried pickup
               * code the app presents INSIDE the custody verification act —
               * the rider never reads or types it, and no other read
               * carries it.
               */
              ramassageConfirmeAt: this.ramassage[assignment.assignmentId]?.confirmeAt ?? null,
              codeVerification: this.codesVerification[assignment.assignmentId]?.code ?? null,
              /**
               * PORTE-CUSTODY part C (founder-approved 2026-08-14) — the
               * course's payment mode, as the FUNDING FACT said it (SE-I02:
               * the per-mode funding truth is the producer's; this only
               * carries it). The rider's road turns on it: a pay-at-door
               * course inserts the §6.3 door-inspection stage before the
               * buyer's code. `null` when the fact is gone (a course purged
               * or composed before facts) — honest, never a guessed mode:
               * the app then walks the plain road and custody, the
               * authority, refuses the drop by name if the door stage was
               * really due.
               */
              paymentMode: this.fundingFacts[assignment.orderId]?.paymentMode ?? null,
              /**
               * ROUTE-DIRECTE — the machine-carried seal id. The app registers
               * custody with it the moment the verification is accepted, with
               * no screen and no photo (founder ruling 2026-08-10), and
               * presents the SAME value again in the delivery evidence at the
               * door. `null` on a course composed before this existed: honest,
               * never a seal nobody minted.
               */
              codeScelle: this.codesVerification[assignment.assignmentId]?.scelle ?? null,
              /**
               * RETOUR-VIVANT-1 — the NEW return seal (§6.4), machine-carried
               * like the outbound one: the app presents it when the refused
               * package is re-sealed for home, custody registers it. `null`
               * on a course composed before it was minted — honest, never a
               * seal nobody minted.
               */
              codeScelleRetour: this.codesVerification[assignment.assignmentId]?.scelleRetour ?? null,
              /**
               * RETOUR-VIVANT-1 — the return handshake, the ramassage's mirror:
               * `codeRetour` is the RIDER's key, shown to him and SAID to the
               * supplier at the counter; `retourConfirmeAt` is when the
               * supplier typed it on his console; `codeRetourFournisseur` is
               * the SELLER's acceptance key, machine-carried onto this read
               * ONLY once he confirmed — the app presents both keys inside one
               * handover act and custody consumes them together or not at
               * all. `null` while no return is open, or before the
               * confirmation: honest, never a key nobody released.
               */
              codeRetour: this.retours[assignment.assignmentId]?.codeRetour ?? null,
              retourConfirmeAt: this.retours[assignment.assignmentId]?.confirmeAt ?? null,
              codeRetourFournisseur:
                this.retours[assignment.assignmentId]?.confirmeAt !== undefined
                  ? (this.retours[assignment.assignmentId]?.codeFournisseur ?? null)
                  : null,
              /**
               * REPROGRAMMATION-1 — which attempt this course is on: 1 on the
               * first road, 2 once the founder fixed the next passage (the
               * follow-up task's lineage, never a counter this app keeps).
               * The window above is then the NEXT passage's — the app says
               * « 2e passage » and shows it.
               */
              passage: this.reschedules.priorTaskIdsOf(assignment.taskId).length + 1,
              /**
               * REPROGRAMMATION-2 — the dispatcher decided the package goes
               * home (custody accepted it first). The app turns to the
               * return road; the seal act and the two keys stay the rider's.
               */
              retourDecideAt: this.retourDecide[assignment.assignmentId]?.decideAt ?? null,
              /**
               * The ids CUSTODY's chain was opened with, as this object opened
               * it (the produce row is the record of what was said): the task
               * of the FIRST attempt and the order's own package. The app's
               * delivery evidence must name exactly these — after a relaunch
               * (routine on the 2e passage, another day) the seal answer that
               * used to carry them is gone from the phone. `null` on a course
               * this object never opened a chain for: honest, never guessed.
               */
              chaine:
                this.custodyOutbox[assignment.orderId] === undefined
                  ? null
                  : { taskId: this.custodyOutbox[assignment.orderId]!.taskId, packageId: packageIdOf(assignment.orderId) },
              /**
               * COLIS-FOURNISSEUR-1 — the package this ONE course carries:
               * every article, the first being the course's own, each with
               * the chain custody opened for it (its acts name ITS order and
               * ITS package — one ledger per article), its name for the door
               * (decision c: refuse one, keep the rest), and how it stands on
               * custody's own wires — `livree` once its drop landed,
               * `en_retour` once its return opened, `retournee` once handed
               * back, `en_cours` otherwise. `null` on a course carrying one
               * order: the road is exactly as it was.
               */
              colis: this.colisVue(assignment.assignmentId),
            },
    };
  }

  private colisVue(assignmentId: string): Record<string, unknown> | null {
    const colis = this.colisCourses[assignmentId];
    if (colis === undefined) return null;
    const assignment = this.book.get(assignmentId);
    const brief = assignment === undefined ? undefined : this.briefs[assignment.taskId];
    const retour = this.retours[assignmentId];
    const enRetour = retour?.orderIds ?? (retour !== undefined ? [retour.orderId] : []);
    return {
      packageId: colis.packageId,
      articles: colis.orderIds.map((orderId) => ({
        orderId,
        libelle: brief?.articles?.find((a) => a.orderId === orderId)?.libelle ?? null,
        chaine:
          this.custodyOutbox[orderId] === undefined
            ? null
            : { taskId: this.custodyOutbox[orderId]!.taskId, packageId: packageIdOf(orderId) },
        etat:
          colis.reglement[orderId] === 'livree'
            ? 'livree'
            : colis.reglement[orderId] === 'retournee'
              ? 'retournee'
              : enRetour.includes(orderId)
                ? 'en_retour'
                : 'en_cours',
      })),
    };
  }
}
