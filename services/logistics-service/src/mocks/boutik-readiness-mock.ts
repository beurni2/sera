import {
  PackageReadinessConfirmationSchema,
  PlatformEventSchema,
  type PlatformEvent,
} from '@platform/contracts';
import type { ReadinessCheck } from '../ready-queue.js';

/**
 * BOUTIK+ READINESS MOCK — Contract §3, eight behaviors, deterministic:
 *   ① duplicates (eventCopies) · ② out-of-order (reverseOrder; tests also
 *   deliver before preconditions) · ③ delayed (deliveryDelayMs) · ④ STALE
 *   projection (staleFirstNReads on check()) · ⑤ timeouts
 *   (timeoutFirstNConfirms, recoverable) · ⑥ partial failure
 *   (emitForFirstNOrders then dark) · ⑦ rejects invalid transitions
 *   (readiness for an unknown order; re-confirmation with a NEW challenge;
 *   NON-CANONICAL readiness payloads strict-refused) · ⑧ schema-generated
 *   (readiness input parsed with the pinned PackageReadinessConfirmation
 *   strict schema; events built THROUGH PlatformEventSchema).
 * Formal certification against the shared conformance suite at E1 assembly.
 */

export interface ReadinessMockConfig {
  eventCopies?: number;
  reverseOrder?: boolean;
  deliveryDelayMs?: number;
  staleFirstNReads?: number;
  timeoutFirstNConfirms?: number;
  emitForFirstNOrders?: number;
}

interface ReadinessRecord {
  orderId: string;
  correlationId: string;
  readinessChallenge: string;
  confirmedAt: string;
}

export type ReadinessResponse =
  | { outcome: 'accepted' }
  | { outcome: 'timeout' }
  | {
      outcome: 'rejected_invalid';
      reason: 'not_canonical_confirmation' | 'order_unknown_to_boutik' | 'challenge_conflict';
    };

export interface PlannedReadinessEvent {
  event: PlatformEvent;
  deliverAtMs: number;
}

export class MockBoutikReadiness {
  private readonly knownOrders = new Map<string, string>(); // orderId → correlationId
  private readonly confirmed = new Map<string, ReadinessRecord>();
  private staleReadsRemaining: number;
  private timeoutsRemaining: number;

  constructor(private readonly config: ReadinessMockConfig = {}) {
    this.staleReadsRemaining = config.staleFirstNReads ?? 0;
    this.timeoutsRemaining = config.timeoutFirstNConfirms ?? 0;
  }

  /** Boutik+ knows the order exists (supplier accepted fulfillment). */
  recordOrderKnown(orderId: string, correlationId: string): void {
    this.knownOrders.set(orderId, correlationId);
  }

  /** A real projection can fall behind at ANY moment — arm N stale reads mid-test. */
  goStale(reads: number): void {
    this.staleReadsRemaining = reads;
  }

  /**
   * Seller readiness arrives as a canonical PackageReadinessConfirmation —
   * anything else is strict-refused (schema-generated, reject-invalid).
   */
  confirmReadiness(rawConfirmation: unknown, at: string): ReadinessResponse {
    if (this.timeoutsRemaining > 0) {
      this.timeoutsRemaining -= 1;
      return { outcome: 'timeout' };
    }
    const parsed = PackageReadinessConfirmationSchema.safeParse(rawConfirmation);
    if (!parsed.success) return { outcome: 'rejected_invalid', reason: 'not_canonical_confirmation' };
    const confirmation = parsed.data;
    const correlationId = this.knownOrders.get(confirmation.orderId);
    if (correlationId === undefined) {
      return { outcome: 'rejected_invalid', reason: 'order_unknown_to_boutik' };
    }
    const existing = this.confirmed.get(confirmation.orderId);
    if (existing) {
      if (existing.readinessChallenge === confirmation.readinessChallenge) return { outcome: 'accepted' };
      return { outcome: 'rejected_invalid', reason: 'challenge_conflict' };
    }
    const cap = this.config.emitForFirstNOrders;
    if (cap !== undefined && this.confirmed.size >= cap) {
      return { outcome: 'timeout' }; // partial failure: accepted earlier work, now dark
    }
    this.confirmed.set(confirmation.orderId, {
      orderId: confirmation.orderId,
      correlationId,
      readinessChallenge: confirmation.readinessChallenge,
      confirmedAt: at,
    });
    return { outcome: 'accepted' };
  }

  /** Readiness projection — STALE per config: first N reads deny a done confirmation. */
  check(orderId: string): ReadinessCheck {
    const record = this.confirmed.get(orderId);
    if (!record) return { ready: false, asOf: 'never', stale: false };
    if (this.staleReadsRemaining > 0) {
      this.staleReadsRemaining -= 1;
      return { ready: false, asOf: 'stale', stale: true };
    }
    return { ready: true, asOf: record.confirmedAt, stale: false };
  }

  /** Event delivery plan — duplicates, reorder, delay per config. */
  readinessEventPlan(): PlannedReadinessEvent[] {
    const plan: PlannedReadinessEvent[] = [];
    const copies = Math.max(1, this.config.eventCopies ?? 1);
    const delay = this.config.deliveryDelayMs ?? 0;
    for (const record of this.confirmed.values()) {
      for (let copy = 0; copy < copies; copy += 1) {
        plan.push({
          event: PlatformEventSchema.parse({
            name: 'fulfillment.ready.v1',
            envelope: {
              command_id: `ready-${record.orderId}`,
              correlation_id: record.correlationId,
              aggregateVersion: 1,
              actor: 'boutik-plus:fulfillment-sandbox',
              serverTime: record.confirmedAt,
              version: '1',
            },
            payload: { order_id: record.orderId, ready: true },
          }),
          deliverAtMs: delay + copy,
        });
      }
    }
    if (this.config.reverseOrder) plan.reverse();
    return plan;
  }
}
