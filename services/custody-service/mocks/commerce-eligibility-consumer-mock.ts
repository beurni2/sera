import { setTimeout as sleep } from 'node:timers/promises';
import { PlatformEventSchema, type PlatformEvent } from '@platform/contracts';
import {
  DOMAIN_PAYLOAD_SCHEMAS,
  MockTimeoutError,
  type DeliveredEvent,
  type EmissionControls,
  type EmissionResult,
  type MockAdapter,
  type ProjectionRead,
  type TransitionAttempt,
} from '@platform/certification';

/**
 * COMMERCE-CORE ELIGIBILITY-CONSUMER MOCK (WO-1.3 §6) — the downstream
 * counterparty that consumes Séra's settlement-eligibility signal and (on
 * its own side, by copying the Quote) creates obligations. Implements the
 * pinned MockAdapter for the 'eligibility' domain, certified 8/8 by the
 * shared §3 suite. Its consumer side accepts ONLY a `validated` signal,
 * refuses amount-bearing payloads (SE-I09: Séra never sends proceeds),
 * and absorbs duplicates — the spine's exactly-once claim is tested
 * against THIS consumer under all eight behaviors. NODE TOOLING ONLY.
 */

const AT = '2026-07-10T12:00:00.000Z';

function eligibilitySequence(seed: string) {
  const payload = (state: string) => ({
    orderId: `order_${seed}`,
    validation: { taskId: `task_${seed}`, result: 'validated' as const, reasons: [] },
    obligation: { orderId: `order_${seed}`, party: 'supplier', amount: 8_500, state, holds: [] },
  });
  return [
    { name: 'delivery.evidence_submitted.v1' as const, payload: payload('Pending') },
    { name: 'delivery.validated.v1' as const, payload: payload('Pending') },
    { name: 'settlement.supplier_payable.v1' as const, payload: payload('Eligible') },
  ];
}

export class CommerceEligibilityConsumerMock implements MockAdapter {
  readonly domain = 'eligibility' as const;
  readonly producerSchema = DOMAIN_PAYLOAD_SCHEMAS.eligibility;

  private readonly consumedCommandIds = new Set<string>();
  private readonly eligibleOrders = new Set<string>();

  async emit(seed: string, controls: EmissionControls): Promise<EmissionResult> {
    if (controls.timeout) {
      await sleep(1);
      throw new MockTimeoutError(`commerce-eligibility-consumer: simulated timeout for seed ${seed}`);
    }
    let events: PlatformEvent[] = eligibilitySequence(seed).map((entry, index) =>
      PlatformEventSchema.parse({
        name: entry.name,
        envelope: {
          command_id: `cmd_eligibility_${seed}_${index + 1}`,
          correlation_id: `corr_${seed}`,
          aggregateVersion: index + 1,
          actor: 'mock:commerce-eligibility-consumer',
          serverTime: new Date().toISOString(),
          version: 'v1',
        },
        payload: entry.payload,
      }),
    );
    if (controls.duplicate) {
      events = [...events.slice(0, 2), events[1]!, ...events.slice(2)];
    }
    if (controls.outOfOrder) {
      events = [...events.slice(0, -2), events.at(-1)!, events.at(-2)!];
    }
    if (controls.delayMs !== undefined && controls.delayMs > 0) {
      await sleep(controls.delayMs);
    }
    if (controls.partialFailure) {
      const delivered: DeliveredEvent[] = [{ event: events[0]!, deliveredAt: Date.now() }];
      return { delivered, failure: { afterCount: 1, reason: 'commerce-eligibility-consumer: mid-sequence failure' } };
    }
    return { delivered: events.map((event) => ({ event, deliveredAt: Date.now() })) };
  }

  async readProjection(seed: string, options: { stale: boolean }): Promise<ProjectionRead> {
    if (options.stale) {
      return { version: 1, asOf: '2026-07-09T00:00:00.000Z', value: { orderId: `order_${seed}`, obligationState: 'Pending', stale: true } };
    }
    return { version: 2, asOf: new Date().toISOString(), value: { orderId: `order_${seed}`, obligationState: 'Eligible' } };
  }

  attemptInvalidTransition(): TransitionAttempt {
    return {
      from: 'Paid',
      to: 'Eligible',
      accepted: false,
      reason: 'a paid settlement obligation can never regress to eligible',
    };
  }

  /**
   * Consumer side: accepts ONLY Séra's `validated` eligibility signal —
   * held/rejected release nothing; a payload carrying any amount is refused
   * (Séra never sends proceeds); duplicates absorb on command_id.
   */
  consumeEligibilitySignal(raw: unknown): { accepted: boolean; duplicate?: boolean; reason?: string } {
    const parsed = PlatformEventSchema.safeParse(raw);
    if (!parsed.success) return { accepted: false, reason: 'not_a_platform_event' };
    const event = parsed.data;
    if (event.name !== 'delivery.validated.v1') return { accepted: false, reason: 'not_an_eligibility_signal' };
    const p = event.payload as Record<string, unknown>;
    if (p['result'] !== 'validated' || p['settlement_eligibility'] !== true) {
      return { accepted: false, reason: 'not_validated' };
    }
    for (const key of Object.keys(p)) {
      if (/amount|fcfa|net|fee|payout/i.test(key)) return { accepted: false, reason: 'amount_bearing_signal_refused' };
    }
    if (this.consumedCommandIds.has(event.envelope.command_id)) {
      return { accepted: true, duplicate: true };
    }
    this.consumedCommandIds.add(event.envelope.command_id);
    this.eligibleOrders.add(String(p['order_id']));
    return { accepted: true, duplicate: false };
  }

  eligibleCount(orderId: string): number {
    return this.eligibleOrders.has(orderId) ? 1 : 0;
  }
}
