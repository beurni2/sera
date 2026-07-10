import { describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE_VERSION, RiderRegistry } from '../src/rider-registry.js';

const T = '2026-07-09T12:00:00.000Z';

function registryWith(certified: boolean, acked = true): RiderRegistry {
  const registry = new RiderRegistry();
  registry.register({ riderId: 'r-1', displayName: 'Issa', phoneAlias: 'alias-77', certified });
  if (acked) registry.acknowledgePrivacyNotice('r-1', PRIVACY_NOTICE_VERSION, T);
  return registry;
}

describe('rider registry — SE0.2, assignability fails closed', () => {
  it('server-confirmed shift start → on_shift → assignable', () => {
    const registry = registryWith(true);
    const outcome = registry.startShift('r-1', T, 'server_confirmed');
    expect(outcome).toMatchObject({ ok: true, pending: false, state: { status: 'on_shift', confirmedBy: 'server' } });
    expect(registry.isAssignable('r-1')).toBe(true);
  });

  it('OFFLINE shift start is queued = PENDING: not on shift, NOT assignable, until the server confirms', () => {
    const registry = registryWith(true);
    const outcome = registry.startShift('r-1', T, 'queued_offline');
    expect(outcome).toMatchObject({ ok: true, pending: true, state: { status: 'shift_start_pending' } });
    expect(registry.isAssignable('r-1')).toBe(false); // queued confers NOTHING
    const confirmed = registry.confirmQueuedShiftStart('r-1', T);
    expect(confirmed).toMatchObject({ ok: true, pending: false, state: { status: 'on_shift' } });
    expect(registry.isAssignable('r-1')).toBe(true); // only now
  });

  it('an UNCERTIFIED rider cannot start a shift and is never assignable', () => {
    const registry = registryWith(false);
    expect(registry.startShift('r-1', T, 'server_confirmed')).toEqual({ ok: false, reason: 'not_certified' });
    expect(registry.isAssignable('r-1')).toBe(false);
  });

  it('pre-shift check: no CURRENT-version privacy ack → shift start refuses closed', () => {
    const registry = registryWith(true, false);
    expect(registry.startShift('r-1', T, 'server_confirmed')).toEqual({
      ok: false,
      reason: 'privacy_notice_not_acknowledged',
    });
    // A stale notice version is equally refused — the ack is VERSIONED.
    registry.acknowledgePrivacyNotice('r-1', 'privacy-notice.v0-obsolete', T);
    expect(registry.startShift('r-1', T, 'server_confirmed')).toEqual({
      ok: false,
      reason: 'privacy_notice_not_acknowledged',
    });
  });

  it('off-shift and unknown riders are not assignable; ending a shift removes assignability', () => {
    const registry = registryWith(true);
    expect(registry.isAssignable('r-1')).toBe(false); // off_shift
    expect(registry.isAssignable('r-ghost')).toBe(false); // unknown
    registry.startShift('r-1', T, 'server_confirmed');
    registry.endShift('r-1', T, 'server_confirmed', { heldPackageIds: [] });
    expect(registry.isAssignable('r-1')).toBe(false);
  });

  it('an OFFLINE shift end is pending: assignability is gone (fail-safe) but the shift is not closed', () => {
    const registry = registryWith(true);
    registry.startShift('r-1', T, 'server_confirmed');
    const outcome = registry.endShift('r-1', T, 'queued_offline', { heldPackageIds: [] });
    expect(outcome).toMatchObject({ ok: true, pending: true, state: { status: 'shift_end_pending' } });
    expect(registry.isAssignable('r-1')).toBe(false);
    expect(registry.shift('r-1').status).not.toBe('off_shift'); // pending ≠ done
  });
});

describe('WO-2.2 — SE3.2 end-shift-with-custody exception: package never unowned, enforced at the store', () => {
  const T = '2026-07-10T18:00:00.000Z';
  function onShiftRegistry(): RiderRegistry {
    const registry = new RiderRegistry();
    registry.register({ riderId: 'r-1', displayName: 'Issa', phoneAlias: 'alias-1', certified: true });
    registry.acknowledgePrivacyNotice('r-1', PRIVACY_NOTICE_VERSION, T);
    registry.startShift('r-1', T, 'server_confirmed');
    return registry;
  }

  it('ORPHANED CUSTODY REFUSES CLOSED: end-shift holding a package with no exception → custody_would_be_orphaned, shift stays on', () => {
    const registry = onShiftRegistry();
    expect(registry.endShift('r-1', T, 'server_confirmed', { heldPackageIds: ['pkg-1'] }))
      .toEqual({ ok: false, reason: 'custody_would_be_orphaned' });
    // An exception with an EMPTY ack or next-owner ref is no exception:
    expect(registry.endShift('r-1', T, 'server_confirmed', {
      heldPackageIds: ['pkg-1'],
      exception: { dispatcherAckId: '', nextOwner: { kind: 'return_to_hub_task', ref: 'hub-task-9' } },
    })).toEqual({ ok: false, reason: 'custody_would_be_orphaned' });
    expect(registry.shift('r-1').status).toBe('on_shift'); // nothing moved
  });

  it('THE EXCEPTION FLOW: dispatcher ack + named next owner → shift ends and the exception is logged with the package ids', () => {
    const registry = onShiftRegistry();
    const outcome = registry.endShift('r-1', T, 'server_confirmed', {
      heldPackageIds: ['pkg-1'],
      exception: { dispatcherAckId: 'dispatch-ack-77', nextOwner: { kind: 'return_to_hub_task', ref: 'hub-task-9' } },
    });
    expect(outcome).toMatchObject({ ok: true, pending: false, state: { status: 'off_shift' } });
    expect(registry.custodyExceptionLog()).toEqual([
      {
        riderId: 'r-1', at: T, packageIds: ['pkg-1'],
        dispatcherAckId: 'dispatch-ack-77',
        nextOwner: { kind: 'return_to_hub_task', ref: 'hub-task-9' },
      },
    ]);
  });

  it('custody-free end-shift needs no exception and logs nothing', () => {
    const registry = onShiftRegistry();
    expect(registry.endShift('r-1', T, 'server_confirmed', { heldPackageIds: [] }))
      .toMatchObject({ ok: true, state: { status: 'off_shift' } });
    expect(registry.custodyExceptionLog()).toEqual([]);
  });
});
