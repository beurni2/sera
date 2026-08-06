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

const SNAP_QUEUE = 'snap:queue:v1';
const SNAP_REGISTRY = 'snap:registry:v1';
const SNAP_BOOK = 'snap:book:v1';
const SNAP_LEASE = 'snap:lease:v1';
const SNAP_WITNESS = 'snap:witness:v1';
const SNAP_PROJECTIONS = 'snap:projections:v1';
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
function mintRiderCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let raw = '';
  for (let i = 0; i < bytes.length; i += 1) raw += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  return `SR-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** The one 401 — IDENTICAL to the router's, for every rider-door rejection. */
function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

function malformed(): Response {
  return Response.json({ ok: false, reason: 'malformed' }, { status: 400 });
}

const ACTIVE_ASSIGNMENT_STATUSES = ['active_unacknowledged', 'ack_pending_offline', 'acknowledged'];

export class LogisticsDO {
  private loaded = false;
  private leaseState: LeaseAuthorityState = emptyLeaseState();
  private fundingFacts: Record<string, FundingFact> = {};
  private readinessFacts: Record<string, ReadinessFact> = {};
  private queue!: ReadyQueue;
  private registry!: RiderRegistry;
  private witness!: GrantedLeaseWitness;
  private book!: AssignmentBook;
  private dispatch!: LeasedDispatch;

  constructor(private readonly state: DurableObjectState) {}

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
    const keys = [SNAP_QUEUE, SNAP_REGISTRY, SNAP_BOOK, SNAP_LEASE, SNAP_WITNESS, SNAP_PROJECTIONS];
    const stored = await this.state.storage.get<unknown>(keys);
    const lease = stored.get(SNAP_LEASE) as LeaseAuthorityState | undefined;
    this.leaseState = lease ?? emptyLeaseState();
    const projections = stored.get(SNAP_PROJECTIONS) as ProjectionsSnapshot | undefined;
    this.fundingFacts = projections?.funding ?? {};
    this.readinessFacts = projections?.readiness ?? {};
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
    });
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
        (body['stale'] !== undefined && typeof body['stale'] !== 'boolean')
      ) {
        return malformed();
      }
      const orderId = body['orderId'] as string;
      const incoming: ReadinessFact = {
        ready: body['ready'] as boolean,
        asOf: body['asOf'] as string,
        stale: (body['stale'] as boolean | undefined) ?? false,
      };
      // Same ordering law as funding: an older redelivered fact never wins.
      const stored = this.readinessFacts[orderId];
      if (stored !== undefined && Date.parse(incoming.asOf) < Date.parse(stored.asOf)) {
        return Response.json({ ok: true, orderId, applied: false, reason: 'older_fact_ignored' });
      }
      this.readinessFacts[orderId] = incoming;
      return Response.json({ ok: true, orderId, applied: true });
    }

    // ── Ops door (router-gated: SERA_OPS_SECRET — the founder) ────────────
    if (request.method === 'GET' && pathname === '/ops/board') {
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
    if (request.method === 'GET' && pathname === '/ops/riders') {
      const riders = this.registry
        .snapshot()
        .riders.map(([, record]) => ({
          ...record,
          shift: this.registry.shift(record.riderId),
          assignable: this.registry.isAssignable(record.riderId),
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
        [`${CODEHASH_PREFIX}${hash}`]: { riderId, mintedAt } satisfies RiderCodeRecord,
        [`${RIDERCODE_PREFIX}${riderId}`]: { hash, mintedAt },
      });
      // The clear code leaves exactly once — here, to the founder's console.
      return Response.json({ ok: true, code, riderId, mintedAt });
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
      // Allowlist projection: riderId + mintedAt; the hash NEVER leaves.
      const entries = await this.state.storage.list<{ mintedAt: string }>({ prefix: RIDERCODE_PREFIX });
      const codes = [...entries.entries()]
        .map(([key, value]) => ({ riderId: key.slice(RIDERCODE_PREFIX.length), mintedAt: value.mintedAt }))
        .sort((a, b) => (a.riderId < b.riderId ? -1 : 1));
      return Response.json({ ok: true, codes });
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
      return Response.json({ ok: true, assignment: outcome.assignment, lease: outcome.lease, duplicate: outcome.duplicate });
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

    // ── Rider door (personal code — resolved HERE, hashes live with the book) ──
    if (pathname.startsWith('/rider/')) {
      const header = request.headers.get('Authorization') ?? '';
      const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
      const codeRecord = await this.resolveCode(presented);
      if (codeRecord === null) return unauthorized();
      const riderId = codeRecord.riderId;

      if (request.method === 'GET' && pathname === '/rider/moi') {
        return Response.json({ ok: true, rider: this.riderView(riderId) });
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

  /** The dispatch board — queued tasks, the roster, live assignments. Reads
   * from the same snapshots the persistence layer uses; recomputes nothing. */
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
    const riders = this.registry
      .snapshot()
      .riders.map(([, record]) => ({
        ...record,
        shift: this.registry.shift(record.riderId),
        assignable: this.registry.isAssignable(record.riderId),
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
            },
    };
  }
}
