import type { AssignmentLease } from '@platform/contracts';

/**
 * SE2.1 ⚠ — the atomic assignment lease, pure decision core (WO-4.3). This
 * is the law the AssignmentLeaseDO enforces on workerd: exactly ONE
 * assignment authority (SE-I01 — "a courier MUST NOT self-assign"; the
 * dispatcher assigns through THE lease), at most one active lease per task
 * AND per rider, granted only under a live eligibility attestation (SE-I02 /
 * SE1.1 re-verified at grant time), versioned per task, expiring on a
 * deterministic clock. Same pattern as boutik's stock-reservation core: all
 * law in this pure function (unit-testable without workerd), the Durable
 * Object a thin wrapper. Acquire/release/anchor/expire are idempotent on
 * command_id — ONLY successes are cached; refusals re-evaluate on retry
 * (the WO-1.2 retry-after-heal law). DETERMINISTIC ONLY: never the wall
 * clock, never randomness — every instant arrives inside a command (the
 * source-scan test enforces it).
 */

/**
 * ⚠ CTO safest default — versioned policy data; reuses WO-1.2's
 * founder-reviewed ACK_DEADLINE_MS (5 min); tune at E4 telemetry, never
 * silently.
 */
export const ASSIGNMENT_LEASE_TTL = { name: 'assignment-lease-ttl.v1', ms: 5 * 60 * 1000 } as const;

/** SE-I01's authority is singular — the one holder every canonical lease names. */
export const DISPATCH_AUTHORITY_HOLDER = 'logistics-service:dispatch';

export type LeaseStatus = 'active' | 'released' | 'expired';

/** The compensation arm 'grant_rolled_back' is LOCAL vocabulary (a release
 * cause on a LOCAL record, NOT an event name — canon names constrain events
 * and shared shapes only): when the book refuses an assignment after the
 * grant, the orchestrator releases with the honest cause, never a borrowed
 * one. */
export type ReleaseCause =
  | 'declined'
  | 'completed'
  | 'reschedule_closed'
  | 'grant_rolled_back'
  | 'taken_back'
  | 'retire';

const RELEASE_CAUSES: readonly ReleaseCause[] = [
  'declined',
  'completed',
  'reschedule_closed',
  'grant_rolled_back',
  // COURSE-REPRISE: the dispatcher took the course back. An ANCHORED lease is
  // exempt from expire_due and "ends only by release" (the anchor ruling
  // above) — this is that release, with its own honest cause on the LOCAL
  // record, never a borrowed one and never a canon event name.
  'taken_back',
  // PURGE-ESSAI (founder ruling 2026-08-10): the founder RETIRED a test course
  // from the board — the dispatch row is forgotten, so the lease it held must
  // end, or SE-I01's authority keeps a rider and a task leased to a course
  // that no longer exists. Its own honest cause: it is not a take-back (no
  // course is being taken off the road for someone else to run), and borrowing
  // 'taken_back' would put a false sentence on the audit record.
  'retire',
];

/**
 * The LOCAL lease record — the richer audit fields live HERE; the canon
 * AssignmentLease (§5.6, STRICT — never add fields to it) is a projection
 * via toCanonicalLease().
 */
export interface LeaseRecord {
  taskId: string;
  riderId: string;
  grantedAt: string;
  expiresAt: string;
  correlationId: string;
  eligibilityCheckedAt: string;
  version: number;
  status: LeaseStatus;
  releaseCause?: ReleaseCause;
  /** CTO ruling (WO-4.3 review): a SERVER-CONFIRMED rider ack ANCHORS the
   * lease. Grounds: WO-1.2's founder-reviewed seed expires ONLY
   * unacknowledged assignments ("unacknowledged assignments go back to the
   * queue"); plan:45 "lease expiry + requeue" is the unanswered-proposal
   * rule; the TTL is the ANSWER deadline (« répondez avant HH:MM »). An
   * anchored lease is exempt from expire_due and ends only by release. An
   * offline-queued ack anchors NOTHING — the deadline still runs. */
  anchoredAt?: string;
}

/** §5.6 projection — STRICT canon shape for the one-assignment-authority
 * gate machinery. Exactly the five canon fields, nothing else. */
export function toCanonicalLease(record: LeaseRecord): AssignmentLease {
  return {
    taskId: record.taskId,
    holder: DISPATCH_AUTHORITY_HOLDER,
    riderId: record.riderId,
    version: record.version,
    status: record.status,
  };
}

export interface AcquireCommand {
  kind: 'acquire';
  command_id: string;
  taskId: string;
  riderId: string;
  grantedAt: string;
  /** SE1.1 at grant time: the orchestrator attests BOTH checks, with their
   * instant; anything not literally true refuses closed at THE authority. */
  eligibility: { riderAssignable: boolean; taskAssignable: boolean; checkedAt: string };
  correlationId: string;
}

export interface ReleaseCommand {
  kind: 'release';
  command_id: string;
  taskId: string;
  cause: ReleaseCause;
}

/** The server-confirmed ack's arm at THE authority (CTO ruling): anchor the
 * active lease — the proposal was answered in time; it no longer expires. */
export interface AnchorCommand {
  kind: 'anchor';
  command_id: string;
  taskId: string;
  at: string;
}

export interface ExpireDueCommand {
  kind: 'expire_due';
  command_id: string;
  nowIso: string;
}

export type LeaseCommand = AcquireCommand | ReleaseCommand | AnchorCommand | ExpireDueCommand;

export type LeaseRefusalReason =
  | 'eligibility_not_attested'
  | 'rider_already_leased'
  | 'task_already_leased'
  | 'no_active_lease'
  | 'malformed_command';

/** Only SUCCESSES are remembered (the stock pattern): the cached snapshot
 * replays byte-stable; refusals re-evaluate and may then succeed. */
export type AppliedOutcome =
  | { kind: 'acquire'; lease: LeaseRecord }
  | { kind: 'release'; lease: LeaseRecord }
  | { kind: 'anchor'; lease: LeaseRecord }
  | { kind: 'expire_due'; expired: LeaseRecord[] };

export interface LeaseAuthorityState {
  /** Append-only lease history; the current lease per task is the sole
   * 'active' entry (enforced by decideLease before every grant). */
  leases: LeaseRecord[];
  /** Per-task version counter — a requeued task's NEXT lease is a FRESH
   * version, never a reused one. */
  versions: Record<string, number>;
  appliedCommands: Record<string, AppliedOutcome>;
}

export type LeaseDecision =
  | { ok: true; state: LeaseAuthorityState; lease?: LeaseRecord; expired?: LeaseRecord[]; idempotentReplay: boolean }
  | { ok: false; state: LeaseAuthorityState; reason: LeaseRefusalReason };

export function emptyLeaseState(): LeaseAuthorityState {
  return { leases: [], versions: {}, appliedCommands: {} };
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isIso = (v: unknown): v is string => isNonEmptyString(v) && Number.isFinite(Date.parse(v));

/** Boundary validation — an unparseable instant or empty id refuses closed
 * (never a thrown Date crash inside the authority). */
function malformed(state: LeaseAuthorityState): LeaseDecision {
  return { ok: false, state, reason: 'malformed_command' };
}

export function decideLease(state: LeaseAuthorityState, cmd: LeaseCommand): LeaseDecision {
  if (!isNonEmptyString(cmd.command_id)) return malformed(state);

  const replay = state.appliedCommands[cmd.command_id];
  if (replay !== undefined) {
    if (replay.kind === 'expire_due') return { ok: true, state, expired: replay.expired, idempotentReplay: true };
    /**
     * ⚠ RELAIS-REPRISE (founder report 2026-08-09): a dedupe record absorbs
     * RETRIES of a live command — it must never immortalize a dead outcome.
     * The dispatch fold's deterministic command id (`cmd-boutik-confier-
     * {task}-{rider}`) meant that after a grant EXPIRED back to the queue,
     * re-confiding the same course to the same rider replayed the dead
     * lease: « ok (duplicate) », nothing granted, the rider never heard,
     * and the button honestly returned. An ACQUIRE replay now answers only
     * while its remembered lease is STILL ACTIVE; a dead one falls through
     * to a fresh evaluation — the same double-tap stays one grant, and a
     * re-relay after expiry is a new dispatch decision, as it always was
     * in the dispatcher's head.
     */
    if (replay.kind === 'acquire' && cmd.kind === 'acquire') {
      const remembered = state.leases.find(
        (l) => l.taskId === replay.lease.taskId && l.version === replay.lease.version,
      );
      if (remembered?.status !== 'active') {
        // fall through to the acquire evaluation below
      } else {
        return { ok: true, state, lease: replay.lease, idempotentReplay: true };
      }
    } else {
      return { ok: true, state, lease: replay.lease, idempotentReplay: true };
    }
  }

  switch (cmd.kind) {
    case 'acquire': {
      if (
        !isNonEmptyString(cmd.taskId) ||
        !isNonEmptyString(cmd.riderId) ||
        !isIso(cmd.grantedAt) ||
        cmd.eligibility == null ||
        !isIso(cmd.eligibility.checkedAt) ||
        !isNonEmptyString(cmd.correlationId)
      ) {
        return malformed(state);
      }
      // REFUSED unless BOTH attestations are literally true — the off-shift
      // tamper surface refuses closed at THE authority, not merely upstream.
      if (cmd.eligibility.riderAssignable !== true || cmd.eligibility.taskAssignable !== true) {
        return { ok: false, state, reason: 'eligibility_not_attested' };
      }
      // One active lease per rider, then per task — atomically, in one place:
      // workerd's input gate serializes every acquire through this function.
      for (const lease of state.leases) {
        if (lease.status !== 'active') continue;
        if (lease.riderId === cmd.riderId) return { ok: false, state, reason: 'rider_already_leased' };
      }
      for (const lease of state.leases) {
        if (lease.status !== 'active') continue;
        if (lease.taskId === cmd.taskId) return { ok: false, state, reason: 'task_already_leased' };
      }
      const version = (state.versions[cmd.taskId] ?? 0) + 1;
      const granted: LeaseRecord = {
        taskId: cmd.taskId,
        riderId: cmd.riderId,
        grantedAt: cmd.grantedAt,
        expiresAt: new Date(Date.parse(cmd.grantedAt) + ASSIGNMENT_LEASE_TTL.ms).toISOString(),
        correlationId: cmd.correlationId,
        eligibilityCheckedAt: cmd.eligibility.checkedAt,
        version,
        status: 'active',
      };
      const next: LeaseAuthorityState = {
        leases: [...state.leases, granted],
        versions: { ...state.versions, [cmd.taskId]: version },
        appliedCommands: { ...state.appliedCommands, [cmd.command_id]: { kind: 'acquire', lease: granted } },
      };
      return { ok: true, state: next, lease: granted, idempotentReplay: false };
    }
    case 'release': {
      if (!isNonEmptyString(cmd.taskId) || !RELEASE_CAUSES.includes(cmd.cause)) return malformed(state);
      const index = state.leases.findIndex((l) => l.status === 'active' && l.taskId === cmd.taskId);
      if (index === -1) return { ok: false, state, reason: 'no_active_lease' };
      const released: LeaseRecord = { ...state.leases[index]!, status: 'released', releaseCause: cmd.cause };
      const next: LeaseAuthorityState = {
        leases: state.leases.map((l, i) => (i === index ? released : l)),
        versions: state.versions,
        appliedCommands: { ...state.appliedCommands, [cmd.command_id]: { kind: 'release', lease: released } },
      };
      return { ok: true, state: next, lease: released, idempotentReplay: false };
    }
    case 'anchor': {
      if (!isNonEmptyString(cmd.taskId) || !isIso(cmd.at)) return malformed(state);
      const index = state.leases.findIndex((l) => l.status === 'active' && l.taskId === cmd.taskId);
      if (index === -1) return { ok: false, state, reason: 'no_active_lease' };
      const anchored: LeaseRecord = { ...state.leases[index]!, anchoredAt: cmd.at };
      const next: LeaseAuthorityState = {
        leases: state.leases.map((l, i) => (i === index ? anchored : l)),
        versions: state.versions,
        appliedCommands: { ...state.appliedCommands, [cmd.command_id]: { kind: 'anchor', lease: anchored } },
      };
      return { ok: true, state: next, lease: anchored, idempotentReplay: false };
    }
    case 'expire_due': {
      if (!isIso(cmd.nowIso)) return malformed(state);
      const nowMs = Date.parse(cmd.nowIso);
      const expired: LeaseRecord[] = [];
      const leases = state.leases.map((lease) => {
        // CTO ruling: an ANCHORED lease (answered in time) never expires —
        // it ends only by release (completed / reschedule_closed / rollback).
        if (lease.status !== 'active' || lease.anchoredAt !== undefined || Date.parse(lease.expiresAt) >= nowMs) {
          return lease;
        }
        const gone: LeaseRecord = { ...lease, status: 'expired' };
        expired.push(gone);
        return gone;
      });
      const next: LeaseAuthorityState = {
        leases,
        versions: state.versions,
        appliedCommands: { ...state.appliedCommands, [cmd.command_id]: { kind: 'expire_due', expired } },
      };
      return { ok: true, state: next, expired, idempotentReplay: false };
    }
    default:
      return malformed(state);
  }
}
