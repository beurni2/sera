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
 * SHOP DOOR-PAYMENT EMITTER MOCK (WO-2.4 §6) — the upstream counterparty
 * whose provider-confirmed `payment.door_leg_confirmed.v1` is the ONLY
 * lawful Option-B door path at E2 (shop's WO-2.5 emission, consumed here
 * until assembly). §3-misbehaving: duplicates, out-of-order, delay, stale
 * reads, timeout, partial failure. Payloads carry the DEPLOYED provider-
 * webhook shape (amounts included — that is the PROVIDER's truth, external
 * to Séra; the consuming spine stores none of it, SE-I09). NODE TOOLING ONLY.
 */

export class ShopDoorPaymentEmitterMock implements MockAdapter {
  readonly domain = 'payment-provider' as const;
  readonly producerSchema = DOMAIN_PAYLOAD_SCHEMAS['payment-provider'];

  async emit(seed: string, controls: EmissionControls): Promise<EmissionResult> {
    if (controls.timeout) {
      await sleep(1);
      throw new MockTimeoutError(`shop-door-payment-emitter: simulated timeout for seed ${seed}`);
    }
    const payload = (status: 'held' | 'captured') => ({
      provider: 'sandbox-provider',
      payment_attempt_id: `payatt_${seed}`,
      collectRef: `collect_door_${seed}`,
      amount: 11_500,
      fee: 0,
      status,
      order_id: `order_${seed}`,
      redelivery: 0,
    });
    let events: PlatformEvent[] = [
      { name: 'payment.checkout_leg_confirmed.v1' as const, payload: payload('held') },
      { name: 'payment.door_leg_confirmed.v1' as const, payload: payload('captured') },
    ].map((entry, index) =>
      PlatformEventSchema.parse({
        name: entry.name,
        envelope: {
          command_id: `cmd_door_${seed}_${index + 1}`,
          correlation_id: `corr_${seed}`,
          aggregateVersion: index + 1,
          actor: 'mock:shop-door-payment-emitter',
          serverTime: new Date().toISOString(),
          version: 'v1',
        },
        payload: entry.payload,
      }),
    );
    if (controls.duplicate) events = [events[0]!, events[1]!, events[1]!];
    if (controls.outOfOrder) events = [events[1]!, events[0]!, ...events.slice(2)];
    if (controls.delayMs !== undefined && controls.delayMs > 0) await sleep(controls.delayMs);
    if (controls.partialFailure) {
      const delivered: DeliveredEvent[] = [{ event: events[0]!, deliveredAt: Date.now() }];
      return { delivered, failure: { afterCount: 1, reason: 'shop-door-payment-emitter: mid-sequence failure' } };
    }
    return { delivered: events.map((event) => ({ event, deliveredAt: Date.now() })) };
  }

  async readProjection(seed: string, options: { stale: boolean }): Promise<ProjectionRead> {
    if (options.stale) {
      return { version: 1, asOf: '2026-07-09T00:00:00.000Z', value: { orderId: `order_${seed}`, doorLeg: 'held', stale: true } };
    }
    return { version: 2, asOf: new Date().toISOString(), value: { orderId: `order_${seed}`, doorLeg: 'captured' } };
  }

  attemptInvalidTransition(): TransitionAttempt {
    return {
      from: 'captured',
      to: 'held',
      accepted: false,
      reason: 'a captured door leg can never regress to held',
    };
  }
}
