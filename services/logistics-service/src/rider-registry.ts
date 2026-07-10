/**
 * SE0.2 thin — rider record + certification + shift lifecycle. "Available
 * only after server confirm": an offline shift-start is queued = PENDING
 * (kernel offline semantics) and confers NO assignability. Acceptance SE1:
 * uncertified or off-shift riders are not assignable — enforced here as the
 * single assignability authority and by a CI gate beside it. The versioned
 * privacy-notice acknowledgment is a pre-shift check: no ack for the current
 * notice version → shift start refuses closed.
 */

export const PRIVACY_NOTICE_VERSION = 'privacy-notice.v1';

export interface PrivacyAck {
  noticeVersion: string;
  ackAt: string;
}

export interface RiderRecord {
  riderId: string;
  displayName: string;
  /** Phone is an ALIAS (§5.8) — an opaque ref, never an identity key. */
  phoneAlias: string;
  certified: boolean;
  privacyAck?: PrivacyAck;
}

export type ShiftState =
  | { status: 'off_shift' }
  /** Offline-queued start: pending, never on-shift, never assignable. */
  | { status: 'shift_start_pending'; queuedAt: string }
  | { status: 'on_shift'; startedAt: string; confirmedBy: 'server' }
  /** Offline-queued end: fail-safe — assignability is already gone, but the
   * shift is NOT closed until the server confirms. */
  | { status: 'shift_end_pending'; queuedAt: string; startedAt: string };

export type ShiftCommandConfirmation = 'server_confirmed' | 'queued_offline';

export type ShiftOutcome =
  | { ok: true; state: ShiftState; pending: boolean }
  | {
      ok: false;
      reason:
        | 'unknown_rider'
        | 'not_certified'
        | 'privacy_notice_not_acknowledged'
        | 'already_on_shift'
        | 'not_on_shift'
        | 'nothing_pending';
    };

export class RiderRegistry {
  private readonly riders = new Map<string, RiderRecord>();
  private readonly shifts = new Map<string, ShiftState>();

  register(record: RiderRecord): void {
    this.riders.set(record.riderId, record);
    if (!this.shifts.has(record.riderId)) this.shifts.set(record.riderId, { status: 'off_shift' });
  }

  acknowledgePrivacyNotice(riderId: string, noticeVersion: string, ackAt: string): boolean {
    const rider = this.riders.get(riderId);
    if (!rider) return false;
    this.riders.set(riderId, { ...rider, privacyAck: { noticeVersion, ackAt } });
    return true;
  }

  rider(riderId: string): RiderRecord | undefined {
    return this.riders.get(riderId);
  }

  shift(riderId: string): ShiftState {
    return this.shifts.get(riderId) ?? { status: 'off_shift' };
  }

  /**
   * Pre-shift checks (SE0.2): certified + current-version privacy ack.
   * server_confirmed → on_shift. queued_offline → PENDING: not on shift,
   * not assignable, no shift.started event exists yet.
   */
  startShift(riderId: string, at: string, confirmation: ShiftCommandConfirmation): ShiftOutcome {
    const rider = this.riders.get(riderId);
    if (!rider) return { ok: false, reason: 'unknown_rider' };
    if (!rider.certified) return { ok: false, reason: 'not_certified' };
    if (rider.privacyAck?.noticeVersion !== PRIVACY_NOTICE_VERSION) {
      return { ok: false, reason: 'privacy_notice_not_acknowledged' };
    }
    const current = this.shift(riderId);
    if (current.status === 'on_shift') return { ok: false, reason: 'already_on_shift' };

    const next: ShiftState =
      confirmation === 'server_confirmed'
        ? { status: 'on_shift', startedAt: at, confirmedBy: 'server' }
        : { status: 'shift_start_pending', queuedAt: at };
    this.shifts.set(riderId, next);
    return { ok: true, state: next, pending: next.status === 'shift_start_pending' };
  }

  /** The queued start's server confirmation arrives — only now on-shift. */
  confirmQueuedShiftStart(riderId: string, at: string): ShiftOutcome {
    const current = this.shift(riderId);
    if (current.status !== 'shift_start_pending') return { ok: false, reason: 'nothing_pending' };
    const next: ShiftState = { status: 'on_shift', startedAt: at, confirmedBy: 'server' };
    this.shifts.set(riderId, next);
    return { ok: true, state: next, pending: false };
  }

  endShift(riderId: string, at: string, confirmation: ShiftCommandConfirmation): ShiftOutcome {
    const current = this.shift(riderId);
    if (current.status === 'shift_start_pending') {
      // Dropping a pending start is clean — nothing was ever live.
      const next: ShiftState = { status: 'off_shift' };
      this.shifts.set(riderId, next);
      return { ok: true, state: next, pending: false };
    }
    if (current.status !== 'on_shift' && current.status !== 'shift_end_pending') {
      return { ok: false, reason: 'not_on_shift' };
    }
    const startedAt = current.startedAt;
    const next: ShiftState =
      confirmation === 'server_confirmed'
        ? { status: 'off_shift' }
        : { status: 'shift_end_pending', queuedAt: at, startedAt };
    this.shifts.set(riderId, next);
    return { ok: true, state: next, pending: next.status === 'shift_end_pending' };
  }

  /**
   * THE assignability rule (SE1 acceptance): certified AND on_shift with
   * server confirmation — pending states (start OR end) confer nothing.
   */
  isAssignable(riderId: string): boolean {
    const rider = this.riders.get(riderId);
    if (!rider || !rider.certified) return false;
    return this.shift(riderId).status === 'on_shift';
  }
}
