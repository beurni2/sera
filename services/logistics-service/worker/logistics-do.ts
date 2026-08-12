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
  ReadyQueue,
  type FundingCheck,
  type IntakeProjections,
  type ReadinessCheck,
  type ReadyQueueSnapshot,
} from '../src/ready-queue.js';
import { RescheduleBook } from '../src/reschedule.js';
import {
  PRIVACY_NOTICE_VERSION,
  RiderRegistry,
  type RiderRecord,
  type RiderRegistrySnapshot,
  type ShiftOutcome,
} from '../src/rider-registry.js';
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

interface ProjectionsSnapshot {
  funding: Record<string, FundingFact>;
  readiness: Record<string, ReadinessFact>;
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
  private codesVerification: Record<string, { code: string; scelle?: string }> = {};
  /** VRAI-ROUTE — orderId → its producer row on the road into custody. */
  private custodyOutbox: Record<string, CustodyProduceRow> = {};
  private queue!: ReadyQueue;
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
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const keys = [SNAP_QUEUE, SNAP_REGISTRY, SNAP_BOOK, SNAP_LEASE, SNAP_WITNESS, SNAP_PROJECTIONS, SNAP_BRIEFS, SNAP_RAMASSAGE, SNAP_CODE_VERIFICATION, SNAP_CUSTODY_OUTBOX];
    const stored = await this.state.storage.get<unknown>(keys);
    const lease = stored.get(SNAP_LEASE) as LeaseAuthorityState | undefined;
    this.leaseState = lease ?? emptyLeaseState();
    const projections = stored.get(SNAP_PROJECTIONS) as ProjectionsSnapshot | undefined;
    this.fundingFacts = projections?.funding ?? {};
    this.readinessFacts = projections?.readiness ?? {};
    this.briefs = (stored.get(SNAP_BRIEFS) as Record<string, CourseBrief> | undefined) ?? {};
    this.ramassage = (stored.get(SNAP_RAMASSAGE) as Record<string, { code: string; confirmeAt?: string }> | undefined) ?? {};
    this.codesVerification = (stored.get(SNAP_CODE_VERIFICATION) as Record<string, { code: string; scelle?: string }> | undefined) ?? {};
    this.custodyOutbox = (stored.get(SNAP_CUSTODY_OUTBOX) as Record<string, CustodyProduceRow> | undefined) ?? {};
    this.queue = new ReadyQueue(this.projections());
    const queueSnap = stored.get(SNAP_QUEUE) as ReadyQueueSnapshot | undefined;
    if (queueSnap !== undefined) this.queue.restore(queueSnap);
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
      reschedules: new RescheduleBook(this.queue),
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
      [SNAP_PROJECTIONS]: { funding: this.fundingFacts, readiness: this.readinessFacts },
      [SNAP_BRIEFS]: this.briefs,
      [SNAP_RAMASSAGE]: this.ramassage,
      [SNAP_CODE_VERIFICATION]: this.codesVerification,
      [SNAP_CUSTODY_OUTBOX]: this.custodyOutbox,
    });
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
          packageId: `pkg-${orderId}`,
          correlationId: `corr-${orderId}`,
          supplierId: next.supplierRef,
          paymentMode: next.paymentMode,
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
    const pending = await this.flushCustodyProduce();
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
          };
        }
        this.custodyOutbox[outcome.assignment.orderId] = {
          phase: 'open',
          rest: 'none',
          attempts: 0,
          taskId: outcome.assignment.taskId,
          assignmentId: outcome.assignment.assignmentId,
          paymentMode: this.fundingFacts[outcome.assignment.orderId]?.paymentMode ?? 'FULL_PREPAY',
          code: this.codesVerification[outcome.assignment.assignmentId]!.code,
          ...(this.readinessFacts[outcome.assignment.orderId]?.supplierRef !== undefined
            ? { supplierRef: this.readinessFacts[outcome.assignment.orderId]!.supplierRef as string }
            : {}),
        };
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
      const orderId = (body['orderId'] as string).trim();
      const hasTask = this.queue.snapshot().tasks.some(([, queued]) => queued.orderId === orderId);
      const hasAssignment = this.book.snapshot().assignments.some(([, record]) => record.orderId === orderId);
      const hasFunding = this.fundingFacts[orderId] !== undefined;
      const hasReadiness = this.readinessFacts[orderId] !== undefined;
      const hasOutbox = this.custodyOutbox[orderId] !== undefined;
      if (!hasTask && !hasAssignment && !hasFunding && !hasReadiness && !hasOutbox) {
        return Response.json({ ok: true, status: 'inconnu' });
      }
      // Book + queue + lease + witness move together — the orchestrator owns
      // that trio, never this route reaching behind a core's back.
      const swept = await this.dispatch.forgetOrder(orderId);
      let briefs = 0;
      for (const taskId of swept.taskIds) {
        if (this.briefs[taskId] === undefined) continue;
        delete this.briefs[taskId];
        briefs += 1;
      }
      let ramassage = 0;
      let codesVerification = 0;
      for (const assignment of swept.assignments) {
        if (this.ramassage[assignment.assignmentId] !== undefined) {
          delete this.ramassage[assignment.assignmentId];
          ramassage += 1;
        }
        if (this.codesVerification[assignment.assignmentId] !== undefined) {
          delete this.codesVerification[assignment.assignmentId];
          codesVerification += 1;
        }
      }
      if (hasOutbox) delete this.custodyOutbox[orderId];
      if (hasFunding) delete this.fundingFacts[orderId];
      if (hasReadiness) delete this.readinessFacts[orderId];
      return Response.json({
        ok: true,
        status: 'retire',
        removed: {
          tasks: swept.taskIds.length,
          assignments: swept.assignments.length,
          leases: swept.leasesReleased,
          briefs,
          ramassage,
          codesVerification,
          custodyOutbox: hasOutbox ? 1 : 0,
          funding: hasFunding ? 1 : 0,
          readiness: hasReadiness ? 1 : 0,
        },
      });
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
      const orderId = (body['orderId'] as string).trim();
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
            queued.orderId === orderId &&
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
      };
      return Response.json({ ok: true, admitted: true, duplicate: outcome.duplicate, taskId: outcome.task.id });
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
      const active = this.book
        .snapshot()
        .assignments.map(([, r]) => r)
        .find((r) => r.orderId === orderId && ACTIVE_ASSIGNMENT_STATUSES.includes(r.status));
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
      const attente = Object.entries(this.fundingFacts)
        .filter(([orderId, fact]) => {
          if (withTask.has(orderId)) return false;
          if (fact.status !== 'funded' || fact.stale || fact.paymentMode !== 'FULL_PREPAY') return false;
          const readiness = this.readinessFacts[orderId];
          return readiness !== undefined && readiness.ready && !readiness.stale;
        })
        .map(([orderId, fact]) => ({
          orderId,
          paymentMode: fact.paymentMode,
          fundedAsOf: fact.asOf,
          readyAsOf: this.readinessFacts[orderId]?.asOf ?? null,
        }))
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
        return this.shiftResponse(this.registry.startShift(riderId, now, 'server_confirmed'));
      }
      if (request.method === 'POST' && pathname === '/rider/shift/end') {
        // Custody-service is not live yet (SE-LIVE-3): no custody can exist,
        // so the declaration is honestly empty. When the custody ledger goes
        // live, THIS is the seam that must ask it — never a caller's claim.
        return this.shiftResponse(
          this.registry.endShift(riderId, now, 'server_confirmed', { heldPackageIds: [] }),
        );
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
    queued: { taskId: string; orderId: string; admittedAt: string; window: unknown; location: unknown }[];
    riders: (RiderRecord & { shift: unknown; assignable: boolean })[];
    assignments: AssignmentRecord[];
  } {
    const queued = this.queue.queuedTasks().map((q) => ({
      taskId: q.task.id,
      orderId: q.orderId,
      admittedAt: q.admittedAt,
      window: q.task.window,
      location: q.task.location,
    }));
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
    return { queued, riders, assignments };
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
               * ROUTE-DIRECTE — the machine-carried seal id. The app registers
               * custody with it the moment the verification is accepted, with
               * no screen and no photo (founder ruling 2026-08-10), and
               * presents the SAME value again in the delivery evidence at the
               * door. `null` on a course composed before this existed: honest,
               * never a seal nobody minted.
               */
              codeScelle: this.codesVerification[assignment.assignmentId]?.scelle ?? null,
            },
    };
  }
}
