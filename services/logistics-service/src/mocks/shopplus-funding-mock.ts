import { PlatformEventSchema, type PlatformEvent } from '@platform/contracts';
import type { FundingCheck } from '../ready-queue.js';

/**
 * SHOP+ FUNDING-STATUS MOCK — Contract §3: "A mock is not trustworthy until
 * it misbehaves like the real service." Eight behaviors, all deterministic
 * (config only, no randomness):
 *   ① duplicates (eventCopies) · ② out-of-order (reverseOrder across
 *   orders; tests also deliver before preconditions) · ③ delayed
 *   (deliveryDelayMs) · ④ STALE projection (staleFirstNReads on check()) ·
 *   ⑤ timeouts (timeoutFirstNConfirms, recoverable on retry) · ⑥ partial
 *   failure (loseEvent: funded provider-side, event lost) · ⑦ rejects
 *   invalid transitions (funding an uninitiated order; re-confirm with a
 *   different collectRef) · ⑧ schema-generated (every event built THROUGH
 *   the pinned PlatformEventSchema).
 * Formal certification against the shared conformance suite happens at E1
 * assembly (JOURNAL'd).
 */

export interface FundingMockConfig {
  eventCopies?: number;
  reverseOrder?: boolean;
  deliveryDelayMs?: number;
  staleFirstNReads?: number;
  timeoutFirstNConfirms?: number;
  loseEvent?: boolean;
}

interface FundingRecord {
  orderId: string;
  paymentMode: string;
  correlationId: string;
  collectRef?: string;
  status: 'initiated' | 'funded' | 'cancelled';
  fundedAt?: string;
}

export type ConfirmFundingResponse =
  | { outcome: 'accepted'; collectRef: string }
  | { outcome: 'timeout' }
  | { outcome: 'rejected_invalid'; reason: 'order_never_initiated' | 'collect_ref_conflict' | 'order_cancelled' };

export interface PlannedFundingEvent {
  event: PlatformEvent;
  deliverAtMs: number;
}

export class MockShopPlusFunding {
  private readonly orders = new Map<string, FundingRecord>();
  private staleReadsRemaining: number;
  private timeoutsRemaining: number;

  constructor(private readonly config: FundingMockConfig = {}) {
    this.staleReadsRemaining = config.staleFirstNReads ?? 0;
    this.timeoutsRemaining = config.timeoutFirstNConfirms ?? 0;
  }

  initiateCheckout(orderId: string, paymentMode: string, correlationId: string): void {
    if (!this.orders.has(orderId)) {
      this.orders.set(orderId, { orderId, paymentMode, correlationId, status: 'initiated' });
    }
  }

  cancelOrder(orderId: string): void {
    const record = this.orders.get(orderId);
    if (record) this.orders.set(orderId, { ...record, status: 'cancelled' });
  }

  /** A real projection can fall behind at ANY moment — arm N stale reads mid-test. */
  goStale(reads: number): void {
    this.staleReadsRemaining = reads;
  }

  /** Idempotent on collectRef; rejects invalid transitions like the real service. */
  confirmFunding(orderId: string, collectRef: string, at: string): ConfirmFundingResponse {
    if (this.timeoutsRemaining > 0) {
      this.timeoutsRemaining -= 1;
      return { outcome: 'timeout' };
    }
    const record = this.orders.get(orderId);
    if (!record) return { outcome: 'rejected_invalid', reason: 'order_never_initiated' };
    if (record.status === 'cancelled') return { outcome: 'rejected_invalid', reason: 'order_cancelled' };
    if (record.status === 'funded') {
      if (record.collectRef === collectRef) return { outcome: 'accepted', collectRef };
      return { outcome: 'rejected_invalid', reason: 'collect_ref_conflict' };
    }
    this.orders.set(orderId, { ...record, status: 'funded', collectRef, fundedAt: at });
    return { outcome: 'accepted', collectRef };
  }

  /** Funding-status projection — STALE per config: the first N reads answer with yesterday's truth. */
  check(orderId: string): FundingCheck {
    const record = this.orders.get(orderId);
    if (!record) return { status: 'unknown', paymentMode: 'FULL_PREPAY', asOf: 'never', stale: false };
    if (this.staleReadsRemaining > 0) {
      this.staleReadsRemaining -= 1;
      // The stale read denies whatever happened most recently.
      const staleStatus = record.status === 'funded' || record.status === 'cancelled' ? 'unfunded' : 'unknown';
      return { status: staleStatus, paymentMode: record.paymentMode, asOf: 'stale', stale: true };
    }
    const status = record.status === 'initiated' ? 'unfunded' : record.status;
    return { status, paymentMode: record.paymentMode, asOf: record.fundedAt ?? 'live', stale: false };
  }

  /** Event delivery plan — duplicates, reorder, delay, and loss per config. */
  fundingEventPlan(): PlannedFundingEvent[] {
    const plan: PlannedFundingEvent[] = [];
    const copies = Math.max(1, this.config.eventCopies ?? 1);
    const delay = this.config.deliveryDelayMs ?? 0;
    for (const record of this.orders.values()) {
      if (record.status !== 'funded' || this.config.loseEvent) continue;
      for (let copy = 0; copy < copies; copy += 1) {
        plan.push({
          event: PlatformEventSchema.parse({
            name: 'payment.checkout_leg_confirmed.v1',
            envelope: {
              command_id: `fund-${record.collectRef}`,
              correlation_id: record.correlationId,
              aggregateVersion: 1,
              actor: 'shop-plus:commerce-core-sandbox',
              serverTime: record.fundedAt ?? 'live',
              version: '1',
            },
            payload: {
              order_id: record.orderId,
              collectRef: record.collectRef,
              paymentMode: record.paymentMode,
              status: 'held',
            },
          }),
          deliverAtMs: delay + copy,
        });
      }
    }
    if (this.config.reverseOrder) plan.reverse();
    return plan;
  }
}
