import { PACKAGE_ORDERS_MAX } from '@platform/contracts';
import { describe, expect, it } from 'vitest';
import { archiveLeaseTasks, decideLease, emptyLeaseState, type LeaseAuthorityState } from '../src/assignment-lease.js';
import { SNAPSHOT_KEYS } from '../worker/logistics-do.js';

/**
 * Dispatch storage stays bounded — the pure lease core's half. The lease
 * state is one stored value; a sweep that expires nothing must leave it
 * exactly as it was, or every board and rider read grows it for ever.
 */

const T0 = '2026-11-26T08:00:00.000Z';

function granted(): LeaseAuthorityState {
  const decision = decideLease(emptyLeaseState(), {
    kind: 'acquire',
    command_id: 'acq-1',
    taskId: 'task-1',
    riderId: 'rider-1',
    grantedAt: T0,
    eligibility: { riderAssignable: true, taskAssignable: true, checkedAt: T0 },
    correlationId: 'corr-1',
  });
  if (!decision.ok) throw new Error(decision.reason);
  return decision.state;
}

describe('a sweep that expires nothing records nothing', () => {
  it('nothing due: the state is returned untouched, with no dedupe entry', () => {
    const state = granted();
    const decision = decideLease(state, { kind: 'expire_due', command_id: 'expire-due-1', nowIso: '2026-11-26T08:01:00.000Z' });
    expect(decision).toMatchObject({ ok: true, expired: [], idempotentReplay: false });
    if (!decision.ok) return;
    expect(decision.state).toBe(state);
    expect(Object.keys(decision.state.appliedCommands)).toEqual(['acq-1']);
  });

  it('a thousand empty sweeps at a thousand instants leave the same state', () => {
    let state = granted();
    for (let i = 0; i < 1_000; i++) {
      const decision = decideLease(state, { kind: 'expire_due', command_id: `expire-due-${i}`, nowIso: new Date(Date.parse(T0) + i).toISOString() });
      if (!decision.ok) throw new Error(decision.reason);
      state = decision.state;
    }
    expect(state).toEqual(granted());
  });

  it('a sweep that DOES expire is still recorded, and its exact retry replays without driving anything', () => {
    const state = granted();
    const due = '2026-11-26T08:06:00.000Z';
    const first = decideLease(state, { kind: 'expire_due', command_id: 'expire-due-x', nowIso: due });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.expired?.map((l) => l.taskId)).toEqual(['task-1']);
    expect(first.state.appliedCommands['expire-due-x']).toMatchObject({ kind: 'expire_due' });
    const retry = decideLease(first.state, { kind: 'expire_due', command_id: 'expire-due-x', nowIso: due });
    expect(retry).toMatchObject({ ok: true, idempotentReplay: true });
  });
});

describe('a closed course leaves the lease value whole, and never an active lease', () => {
  const acquire = (state: LeaseAuthorityState, id: string, taskId: string, riderId: string, at: string) => {
    const d = decideLease(state, { kind: 'acquire', command_id: id, taskId, riderId, grantedAt: at, eligibility: { riderAssignable: true, taskAssignable: true, checkedAt: at }, correlationId: `corr-${taskId}` });
    if (!d.ok) throw new Error(d.reason);
    return d.state;
  };
  const release = (state: LeaseAuthorityState, id: string, taskId: string) => {
    const d = decideLease(state, { kind: 'release', command_id: id, taskId, cause: 'completed' });
    if (!d.ok) throw new Error(d.reason);
    return d.state;
  };

  it('moves the closed task’s ended leases, version and dedupe entries; leaves another task’s active lease and everything naming it', () => {
    let state = acquire(emptyLeaseState(), 'acq-a', 'task-a', 'rider-1', T0);
    state = release(state, 'complete-task-a', 'task-a');
    state = acquire(state, 'acq-b', 'task-b', 'rider-1', T0);
    const moved = archiveLeaseTasks(state, ['task-a']);
    expect(moved.leases.map((l) => [l.taskId, l.status])).toEqual([['task-a', 'released']]);
    expect(moved.versions).toEqual({ 'task-a': 1 });
    expect(moved.commands.map(([id]) => id).sort()).toEqual(['acq-a', 'complete-task-a']);
    expect(moved.state.leases.map((l) => [l.taskId, l.status])).toEqual([['task-b', 'active']]);
    expect(moved.state.versions).toEqual({ 'task-b': 1 });
    expect(Object.keys(moved.state.appliedCommands)).toEqual(['acq-b']);
  });

  it('an active lease is never moved, even when its task is named', () => {
    const state = acquire(emptyLeaseState(), 'acq-a', 'task-a', 'rider-1', T0);
    const moved = archiveLeaseTasks(state, ['task-a']);
    expect(moved.leases).toEqual([]);
    expect(moved.state).toEqual(state);
  });

  it('a sweep’s entry moves only once no lease it expired is left', () => {
    let state = acquire(emptyLeaseState(), 'acq-a', 'task-a', 'rider-1', T0);
    state = acquire(state, 'acq-b', 'task-b', 'rider-2', T0);
    const swept = decideLease(state, { kind: 'expire_due', command_id: 'expire-due-x', nowIso: '2026-11-26T08:06:00.000Z' });
    if (!swept.ok) throw new Error(swept.reason);
    const first = archiveLeaseTasks(swept.state, ['task-a']);
    expect(Object.keys(first.state.appliedCommands)).toContain('expire-due-x');
    const second = archiveLeaseTasks(first.state, ['task-b']);
    expect(second.commands.map(([id]) => id)).toContain('expire-due-x');
    expect(second.state).toEqual(emptyLeaseState());
  });

  it('after the move, a replayed acquire re-evaluates instead of answering the moved grant', () => {
    let state = acquire(emptyLeaseState(), 'acq-a', 'task-a', 'rider-1', T0);
    state = release(state, 'complete-task-a', 'task-a');
    const moved = archiveLeaseTasks(state, ['task-a']).state;
    const replay = decideLease(moved, { kind: 'acquire', command_id: 'acq-a', taskId: 'task-a', riderId: 'rider-1', grantedAt: T0, eligibility: { riderAssignable: true, taskAssignable: false, checkedAt: T0 }, correlationId: 'corr-task-a' });
    expect(replay).toMatchObject({ ok: false, reason: 'eligibility_not_attested' });
  });
});

describe('the largest single write stays inside the storage batch limit', () => {
  it('snapshots + size alert + one record per article of the largest package ≤ 128 keys', () => {
    expect(SNAPSHOT_KEYS.length).toBe(18);
    expect(PACKAGE_ORDERS_MAX).toBe(10);
    expect(SNAPSHOT_KEYS.length + 1 + PACKAGE_ORDERS_MAX).toBe(29);
    expect(SNAPSHOT_KEYS.length + 1 + PACKAGE_ORDERS_MAX).toBeLessThanOrEqual(128);
  });
});
