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
        | 'nothing_pending'
        | 'custody_would_be_orphaned';
    };

/**
 * SE3.2 end-shift-with-custody exception (WO-2.2): a rider holding custody
 * may end shift ONLY with an explicit dispatcher acknowledgment AND the
 * package's next owner named — "package never unowned" is enforced HERE, at
 * the store where shift state changes.
 */
export interface EndShiftCustodyDeclaration {
  /** Package ids this rider is CURRENT custodian of (from the custody store). */
  heldPackageIds: readonly string[];
  exception?: {
    dispatcherAckId: string;
    nextOwner: { kind: 'return_to_hub_task' | 'reassignment'; ref: string };
  };
}

export class RiderRegistry {
  private readonly riders = new Map<string, RiderRecord>();
  private readonly shifts = new Map<string, ShiftState>();
  /** SE3.2 exception log — every custody-holding end-shift names its
   * dispatcher ack and the package's next owner (audit evidence). */
  private readonly custodyExceptions: {
    riderId: string;
    at: string;
    packageIds: string[];
    dispatcherAckId: string;
    nextOwner: { kind: 'return_to_hub_task' | 'reassignment'; ref: string };
  }[] = [];

  register(record: RiderRecord): void {
    this.riders.set(record.riderId, record);
    if (!this.shifts.has(record.riderId)) this.shifts.set(record.riderId, { status: 'off_shift' });
  }

  /**
   * ═══ RETIRER UN COURSIER — remove a rider from the roster ═══
   *
   * Founder, 2026-08-12: « add a way to remove riders as well on coursiers. »
   * The desk could already REVOKE a rider's code — which locks them out while
   * leaving them on the roster, the exact distinction the supplier desk drew
   * between cutting access and erasing. This is the second act.
   *
   * ⚠ THE CALLER MUST REFUSE A RIDER WHO STILL HOLDS CUSTODY. This method is
   * the store's mechanical delete and knows nothing about the assignment book;
   * « one current custodian » (Law 3) is enforced at the ROUTE, where the book
   * is readable. A rider removed mid-course would leave a parcel whose
   * custodian does not exist — the parcel unowned and dispatch unable to
   * reassign it, which is the same stranding the rider app just paid for.
   *
   * THE CUSTODY EXCEPTION LOG IS NOT TOUCHED, deliberately. Those entries are
   * AUDIT EVIDENCE of a custody hand-off that really happened, naming the
   * dispatcher who acknowledged it and the package's next owner. Erasing them
   * with the rider would destroy the proof that the hand-off was lawful — the
   * record outlives the roster row, exactly as a settlement record outlives a
   * quote.
   *
   * Answers whether anything was removed. ⚠ THE CURRENT CALLER DOES NOT READ IT
   * (verifier minor): `/ops/riders/remove` already answers 404 from its own
   * `registry.rider()` pre-check, because the 404 must come BEFORE the custody
   * guards, not after the delete. The boolean is kept because a map delete has
   * no other way to say « there was nobody by that name » — but it is not what
   * makes that route honest, and this comment no longer pretends it is.
   */
  remove(riderId: string): boolean {
    const existed = this.riders.delete(riderId);
    this.shifts.delete(riderId);
    return existed;
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

  endShift(
    riderId: string,
    at: string,
    confirmation: ShiftCommandConfirmation,
    custody: EndShiftCustodyDeclaration,
  ): ShiftOutcome {
    // SE3.2: ending a shift while holding custody REQUIRES the exception —
    // dispatcher ack + a named next owner. Without it: refused closed, the
    // package is never orphaned. (The declaration is a required argument so
    // no caller can forget to ask the custody store.)
    if (custody.heldPackageIds.length > 0) {
      const exception = custody.exception;
      if (
        exception === undefined ||
        exception.dispatcherAckId.length === 0 ||
        exception.nextOwner.ref.length === 0
      ) {
        return { ok: false, reason: 'custody_would_be_orphaned' };
      }
    }
    const current = this.shift(riderId);
    if (current.status === 'shift_start_pending') {
      // Dropping a pending start is clean — nothing was ever live.
      const next: ShiftState = { status: 'off_shift' };
      this.shifts.set(riderId, next);
      this.logCustodyException(riderId, at, custody);
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
    // Verifier NB③: the audit entry is written AFTER the transition is
    // decided lawful — a refused end-shift logs no phantom handoff.
    this.logCustodyException(riderId, at, custody);
    return { ok: true, state: next, pending: next.status === 'shift_end_pending' };
  }

  private logCustodyException(riderId: string, at: string, custody: EndShiftCustodyDeclaration): void {
    if (custody.heldPackageIds.length === 0 || custody.exception === undefined) return;
    this.custodyExceptions.push({
      riderId,
      at,
      packageIds: [...custody.heldPackageIds],
      dispatcherAckId: custody.exception.dispatcherAckId,
      nextOwner: { ...custody.exception.nextOwner },
    });
  }

  custodyExceptionLog(): readonly {
    riderId: string;
    at: string;
    packageIds: string[];
    dispatcherAckId: string;
    nextOwner: { kind: 'return_to_hub_task' | 'reassignment'; ref: string };
  }[] {
    return [...this.custodyExceptions];
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

  /** SE-LIVE-1 — durable composition, ADDITIVE ONLY: full-store snapshot for
   * the LogisticsDO; every rule above is untouched. */
  snapshot(): RiderRegistrySnapshot {
    return {
      riders: [...this.riders.entries()],
      shifts: [...this.shifts.entries()],
      custodyExceptions: this.custodyExceptionLog().map((entry) => ({ ...entry, nextOwner: { ...entry.nextOwner } })),
    };
  }

  restore(snap: RiderRegistrySnapshot): void {
    this.riders.clear();
    for (const [id, record] of snap.riders) this.riders.set(id, record);
    this.shifts.clear();
    for (const [id, state] of snap.shifts) this.shifts.set(id, state);
    this.custodyExceptions.length = 0;
    for (const entry of snap.custodyExceptions) this.custodyExceptions.push(entry);
  }
}

export interface RiderRegistrySnapshot {
  riders: [string, RiderRecord][];
  shifts: [string, ShiftState][];
  custodyExceptions: {
    riderId: string;
    at: string;
    packageIds: string[];
    dispatcherAckId: string;
    nextOwner: { kind: 'return_to_hub_task' | 'reassignment'; ref: string };
  }[];
}
