import { describe, expect, it } from 'vitest';
import { decideLease, emptyLeaseState, type LeaseAuthorityState } from '../src/assignment-lease.js';

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
