import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssignmentLeaseSchema } from '@platform/contracts';
import { findAssignmentAuthorityViolations } from '../src/assignment-authority.js';
import {
  ASSIGNMENT_LEASE_TTL,
  DISPATCH_AUTHORITY_HOLDER,
  decideLease,
  emptyLeaseState,
  toCanonicalLease,
  type LeaseAuthorityState,
  type LeaseRecord,
} from '../src/assignment-lease.js';
import { ACK_DEADLINE_MS } from '../src/manual-assignment.js';

/**
 * SE2.1 pure decision core — every refusal reason, idempotent replay on
 * every command kind, per-task versioning, deterministic expiry, and the
 * STRICT canon projection. No Miniflare here: the law is unit-testable
 * because it lives in one pure function (the DO e2e suite proves the same
 * law atomic on workerd).
 */

const T = '2026-07-12T12:00:00.000Z';
const PAST_TTL = '2026-07-12T12:06:00.000Z';
const AT_TTL = '2026-07-12T12:05:00.000Z';

const acquireCmd = (over: Record<string, unknown> = {}) => ({
  kind: 'acquire' as const,
  command_id: 'cmd-a1',
  taskId: 'task-1',
  riderId: 'r-1',
  grantedAt: T,
  eligibility: { riderAssignable: true as boolean, taskAssignable: true as boolean, checkedAt: T },
  correlationId: 'corr-1',
  ...over,
});

function granted(over: Record<string, unknown> = {}): { state: LeaseAuthorityState; lease: LeaseRecord } {
  const decision = decideLease(emptyLeaseState(), acquireCmd(over));
  if (!decision.ok || decision.lease === undefined) throw new Error('setup grant failed');
  return { state: decision.state, lease: decision.lease };
}

describe('decideLease — acquire', () => {
  it('grants under a true double attestation: active lease, version 1, expiresAt = grantedAt + the flagged 5-min TTL', () => {
    const { lease } = granted();
    expect(lease).toMatchObject({
      taskId: 'task-1',
      riderId: 'r-1',
      grantedAt: T,
      correlationId: 'corr-1',
      eligibilityCheckedAt: T,
      version: 1,
      status: 'active',
    });
    expect(lease.expiresAt).toBe(AT_TTL);
    expect(ASSIGNMENT_LEASE_TTL).toEqual({ name: 'assignment-lease-ttl.v1', ms: 5 * 60 * 1000 });
    // ONE policy datum on both ends of the sweep: lease TTL === ack deadline.
    expect(ASSIGNMENT_LEASE_TTL.ms).toBe(ACK_DEADLINE_MS);
  });

  it('ELIGIBILITY: anything not literally true refuses closed — the off-shift tamper surface', () => {
    for (const eligibility of [
      { riderAssignable: false, taskAssignable: true, checkedAt: T },
      { riderAssignable: true, taskAssignable: false, checkedAt: T },
      { riderAssignable: false, taskAssignable: false, checkedAt: T },
      // truthy-but-not-true forgeries refuse too
      { riderAssignable: 1 as unknown as boolean, taskAssignable: true, checkedAt: T },
    ]) {
      const refused = decideLease(emptyLeaseState(), acquireCmd({ eligibility }));
      expect(refused).toMatchObject({ ok: false, reason: 'eligibility_not_attested' });
      expect(refused.state.leases).toHaveLength(0); // a refusal mutates nothing
    }
  });

  it('ONE ACTIVE PER RIDER: a rider holding a live lease is refused a second task', () => {
    const { state } = granted();
    const second = decideLease(state, acquireCmd({ command_id: 'cmd-a2', taskId: 'task-2' }));
    expect(second).toMatchObject({ ok: false, reason: 'rider_already_leased' });
  });

  it('ONE ACTIVE PER TASK: a leased task is refused a second rider', () => {
    const { state } = granted();
    const second = decideLease(state, acquireCmd({ command_id: 'cmd-a2', riderId: 'r-2' }));
    expect(second).toMatchObject({ ok: false, reason: 'task_already_leased' });
  });

  it('IDEMPOTENT REPLAY: the winning command_id returns the SAME lease, no second grant; a REFUSAL is never cached (retry-after-heal)', () => {
    const { state, lease } = granted();
    const replay = decideLease(state, acquireCmd({ riderId: 'r-ignored', taskId: 'task-1' }));
    expect(replay).toMatchObject({ ok: true, idempotentReplay: true });
    expect(replay.ok && replay.lease).toEqual(lease);
    expect(replay.state.leases).toHaveLength(1);
    // refusal → heal → the SAME command then succeeds
    const refused = decideLease(emptyLeaseState(), acquireCmd({ eligibility: { riderAssignable: false, taskAssignable: true, checkedAt: T } }));
    expect(refused.ok).toBe(false);
    const healed = decideLease(refused.state, acquireCmd());
    expect(healed).toMatchObject({ ok: true, idempotentReplay: false });
  });

  it('MALFORMED refuses closed: empty ids, unparseable instants, missing attestation', () => {
    for (const over of [
      { taskId: '' },
      { riderId: '' },
      { command_id: '' },
      { grantedAt: 'pas-une-date' },
      { correlationId: '' },
      { eligibility: { riderAssignable: true, taskAssignable: true, checkedAt: 'nope' } },
    ]) {
      expect(decideLease(emptyLeaseState(), acquireCmd(over))).toMatchObject({ ok: false, reason: 'malformed_command' });
    }
  });
});

describe('decideLease — release & expire_due', () => {
  it('release records the honest cause; every cause of the LOCAL union is honored; releasing nothing refuses no_active_lease', () => {
    for (const cause of ['declined', 'completed', 'reschedule_closed', 'grant_rolled_back'] as const) {
      const { state } = granted();
      const released = decideLease(state, { kind: 'release', command_id: `cmd-r-${cause}`, taskId: 'task-1', cause });
      expect(released.ok).toBe(true);
      if (!released.ok) continue;
      expect(released.lease).toMatchObject({ status: 'released', releaseCause: cause });
    }
    expect(decideLease(emptyLeaseState(), { kind: 'release', command_id: 'cmd-r0', taskId: 'task-1', cause: 'declined' }))
      .toMatchObject({ ok: false, reason: 'no_active_lease' });
    // an invented cause is not in the union → refused at the boundary
    expect(
      decideLease(granted().state, {
        kind: 'release',
        command_id: 'cmd-rx',
        taskId: 'task-1',
        cause: 'because' as never,
      }),
    ).toMatchObject({ ok: false, reason: 'malformed_command' });
  });

  it('release replays idempotently and a released task is acquirable again with a FRESH version', () => {
    const { state } = granted();
    const rel = decideLease(state, { kind: 'release', command_id: 'cmd-rel', taskId: 'task-1', cause: 'declined' });
    if (!rel.ok) throw new Error('setup');
    const replay = decideLease(rel.state, { kind: 'release', command_id: 'cmd-rel', taskId: 'task-1', cause: 'declined' });
    expect(replay).toMatchObject({ ok: true, idempotentReplay: true });
    const again = decideLease(rel.state, acquireCmd({ command_id: 'cmd-a2', riderId: 'r-2' }));
    expect(again.ok && again.lease?.version).toBe(2); // never a reused version
  });

  it('expire_due past TTL expires every due lease; BEFORE expiry it expires NOTHING; the boundary is strict (expiresAt < now)', () => {
    const { state } = granted();
    const early = decideLease(state, { kind: 'expire_due', command_id: 'cmd-e0', nowIso: '2026-07-12T12:04:59.000Z' });
    expect(early.ok && early.expired).toEqual([]);
    // exactly AT expiresAt: not yet past — expires nothing
    const at = decideLease(state, { kind: 'expire_due', command_id: 'cmd-e-at', nowIso: AT_TTL });
    expect(at.ok && at.expired).toEqual([]);
    const due = decideLease(state, { kind: 'expire_due', command_id: 'cmd-e1', nowIso: PAST_TTL });
    expect(due.ok).toBe(true);
    if (!due.ok) return;
    expect(due.expired).toHaveLength(1);
    expect(due.expired?.[0]).toMatchObject({ taskId: 'task-1', status: 'expired', version: 1 });
    // the expired task's NEXT acquire is a FRESH lease with a NEW version
    const fresh = decideLease(due.state, acquireCmd({ command_id: 'cmd-a2', grantedAt: PAST_TTL }));
    expect(fresh.ok && fresh.lease).toMatchObject({ version: 2, status: 'active' });
    // and the sweep replays idempotently with the SAME expired set
    const replay = decideLease(due.state, { kind: 'expire_due', command_id: 'cmd-e1', nowIso: PAST_TTL });
    expect(replay).toMatchObject({ ok: true, idempotentReplay: true });
    expect(replay.ok && replay.expired).toHaveLength(1);
  });
});

describe('decideLease — anchor (CTO ruling: a server-confirmed ack means the proposal was ANSWERED; it never expires)', () => {
  it('anchor marks the active lease and EXEMPTS it from expire_due — it ends only by release', () => {
    const { state } = granted();
    const anchored = decideLease(state, { kind: 'anchor', command_id: 'cmd-anchor', taskId: 'task-1', at: T });
    expect(anchored.ok).toBe(true);
    if (!anchored.ok) return;
    expect(anchored.lease).toMatchObject({ taskId: 'task-1', status: 'active', anchoredAt: T, version: 1 });
    // far past the TTL: the anchored lease does NOT expire…
    const sweep = decideLease(anchored.state, { kind: 'expire_due', command_id: 'cmd-e1', nowIso: PAST_TTL });
    expect(sweep.ok && sweep.expired).toEqual([]);
    expect(sweep.state.leases[0]).toMatchObject({ status: 'active', anchoredAt: T });
    // …the one-per-rider/per-task walls still hold around it…
    expect(decideLease(sweep.state, acquireCmd({ command_id: 'cmd-a9', taskId: 'task-9', grantedAt: PAST_TTL })))
      .toMatchObject({ ok: false, reason: 'rider_already_leased' });
    // …and release still ends it (completion path)
    const done = decideLease(sweep.state, { kind: 'release', command_id: 'cmd-done', taskId: 'task-1', cause: 'completed' });
    expect(done.ok && done.lease).toMatchObject({ status: 'released', releaseCause: 'completed', anchoredAt: T });
  });

  it('anchor on a RELEASED, EXPIRED, or ABSENT lease refuses no_active_lease — a dead proposal cannot be answered', () => {
    // absent
    expect(decideLease(emptyLeaseState(), { kind: 'anchor', command_id: 'cmd-x0', taskId: 'task-1', at: T }))
      .toMatchObject({ ok: false, reason: 'no_active_lease' });
    // released
    const rel = decideLease(granted().state, { kind: 'release', command_id: 'cmd-rel', taskId: 'task-1', cause: 'declined' });
    if (!rel.ok) throw new Error('setup');
    expect(decideLease(rel.state, { kind: 'anchor', command_id: 'cmd-x1', taskId: 'task-1', at: T }))
      .toMatchObject({ ok: false, reason: 'no_active_lease' });
    // expired (the too-late-ack race, at the pure core)
    const due = decideLease(granted().state, { kind: 'expire_due', command_id: 'cmd-e1', nowIso: PAST_TTL });
    if (!due.ok) throw new Error('setup');
    expect(decideLease(due.state, { kind: 'anchor', command_id: 'cmd-x2', taskId: 'task-1', at: PAST_TTL }))
      .toMatchObject({ ok: false, reason: 'no_active_lease' });
  });

  it('anchor replays idempotently on command_id — the SAME anchored lease, no re-evaluation', () => {
    const { state } = granted();
    const first = decideLease(state, { kind: 'anchor', command_id: 'cmd-anchor', taskId: 'task-1', at: T });
    if (!first.ok) throw new Error('setup');
    const replay = decideLease(first.state, { kind: 'anchor', command_id: 'cmd-anchor', taskId: 'task-1', at: PAST_TTL });
    expect(replay).toMatchObject({ ok: true, idempotentReplay: true });
    expect(replay.ok && replay.lease).toEqual(first.lease); // the ORIGINAL anchor instant, byte-same
  });

  it('MALFORMED anchor refuses closed: empty taskId, empty command_id, unparseable instant', () => {
    const { state } = granted();
    for (const cmd of [
      { kind: 'anchor' as const, command_id: 'cmd-m1', taskId: '', at: T },
      { kind: 'anchor' as const, command_id: '', taskId: 'task-1', at: T },
      { kind: 'anchor' as const, command_id: 'cmd-m2', taskId: 'task-1', at: 'pas-une-date' },
    ]) {
      expect(decideLease(state, cmd)).toMatchObject({ ok: false, reason: 'malformed_command' });
    }
  });
});

describe('toCanonicalLease — the STRICT §5.6 projection', () => {
  it('projects active/released/expired records to canon AssignmentLease — parses STRICT, holder is THE singular authority, gate-clean', () => {
    const { state } = granted();
    const rel = decideLease(state, { kind: 'release', command_id: 'cmd-rel', taskId: 'task-1', cause: 'completed' });
    if (!rel.ok) throw new Error('setup');
    const exp = decideLease(granted({ command_id: 'cmd-b1', taskId: 'task-9', riderId: 'r-9' }).state, {
      kind: 'expire_due',
      command_id: 'cmd-e9',
      nowIso: PAST_TTL,
    });
    if (!exp.ok) throw new Error('setup');
    const records = [...rel.state.leases, ...exp.state.leases];
    expect(records.map((r) => r.status).sort()).toEqual(['expired', 'released']);
    for (const record of records) {
      const canonical = toCanonicalLease(record);
      const parsed = AssignmentLeaseSchema.safeParse(canonical);
      expect(parsed.success, `projection not canon-clean for status ${record.status}`).toBe(true);
      expect(canonical.holder).toBe(DISPATCH_AUTHORITY_HOLDER);
      expect(Object.keys(canonical).sort()).toEqual(['holder', 'riderId', 'status', 'taskId', 'version']);
    }
    // the projection feeds the existing one-assignment-authority machinery
    expect(findAssignmentAuthorityViolations(records.map(toCanonicalLease))).toEqual([]);
  });
});

describe('determinism (Ten Laws #5 — deterministic only)', () => {
  it('neither the pure core nor the DO wrapper reads a wall clock: no Date.now, no Math.random', () => {
    for (const rel of ['../src/assignment-lease.ts', '../worker/assignment-lease-do.ts']) {
      const source = readFileSync(join(import.meta.dirname, rel), 'utf8');
      expect(source, `${rel} reads the wall clock`).not.toMatch(/Date\.now\(/);
      expect(source, `${rel} uses randomness`).not.toMatch(/Math\.random/);
      expect(source, `${rel} constructs an argument-less Date`).not.toMatch(/new Date\(\)/);
    }
  });
});
