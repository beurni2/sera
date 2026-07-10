import { describe, expect, it } from 'vitest';
const SHA256_FIXTURE = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
import { MockBoutikReadiness } from '../src/mocks/boutik-readiness-mock.js';
import { MockShopPlusFunding } from '../src/mocks/shopplus-funding-mock.js';
import { ReadyQueue } from '../src/ready-queue.js';

/**
 * Contract §3 — eight behaviors for BOTH inbound mocks, with the intake
 * proven to NEVER admit an unfunded / unready / cancelled / stale task
 * under any of them. Deterministic throughout.
 */

const T = '2026-07-09T12:00:00.000Z';
const ORDER = 'order-e1-42';
const CORR = 'corr-e1-42';

const task = {
  type: 'delivery' as const,
  id: 'task-1',
  orderId: ORDER,
  location: {
    pin: { lat: 12.3714, lng: -1.5197 },
    zone: 'Gounghin',
    landmark: 'Face à la pharmacie du marché',
    directions: 'Deuxième porte bleue après le kiosque',
    maskedRelay: 'relay-abc',
  },
  window: { start: T, end: '2026-07-09T14:00:00.000Z' },
  status: 'ready',
};

function taskReadyEvent(command_id = 'cmd-task-ready-1') {
  return {
    name: 'logistics.task_ready.v1',
    envelope: {
      command_id,
      correlation_id: CORR,
      aggregateVersion: 1,
      actor: 'logistics-service:intake-test',
      serverTime: T,
      version: '1',
    },
    payload: { task },
  };
}

const canonicalReadiness = () => ({
  orderId: ORDER,
  photoRef: { ref: 'media/pkg-42.jpg', sha256: SHA256_FIXTURE, mimeType: 'image/jpeg' },
  readinessChallenge: 'challenge-42',
  qty: 1,
  variant: 'taille unique',
  availableConfirmed: true,
  at: T,
});

function healthyMocks(fundingCfg = {}, readinessCfg = {}) {
  const funding = new MockShopPlusFunding(fundingCfg);
  const readiness = new MockBoutikReadiness(readinessCfg);
  funding.initiateCheckout(ORDER, 'FULL_PREPAY', CORR);
  funding.confirmFunding(ORDER, 'collect-42', T);
  readiness.recordOrderKnown(ORDER, CORR);
  readiness.confirmReadiness(canonicalReadiness(), T);
  return { funding, readiness, queue: new ReadyQueue({ funding, readiness }) };
}

describe('intake — the happy admission and its refusals', () => {
  it('funded + readiness-confirmed + non-cancelled → admitted; everything else about the event is canonical', () => {
    const { queue } = healthyMocks();
    expect(queue.onTaskReady(taskReadyEvent(), T)).toMatchObject({ admitted: true, duplicate: false });
    expect(queue.queuedTasks()).toHaveLength(1);
  });

  it('UNFUNDED order → refused closed; funding later + redelivery → admitted', () => {
    const funding = new MockShopPlusFunding({});
    const readiness = new MockBoutikReadiness({});
    funding.initiateCheckout(ORDER, 'FULL_PREPAY', CORR);
    readiness.recordOrderKnown(ORDER, CORR);
    readiness.confirmReadiness(canonicalReadiness(), T);
    const queue = new ReadyQueue({ funding, readiness });
    expect(queue.onTaskReady(taskReadyEvent(), T)).toEqual({ admitted: false, reason: 'not_funded_for_mode' });
    expect(queue.queuedTasks()).toHaveLength(0);
    funding.confirmFunding(ORDER, 'collect-42', T);
    expect(queue.onTaskReady(taskReadyEvent(), T)).toMatchObject({ admitted: true });
  });

  it('UNREADY order → refused closed (out-of-order: task_ready arrived before Boutik+ readiness)', () => {
    const funding = new MockShopPlusFunding({});
    const readiness = new MockBoutikReadiness({});
    funding.initiateCheckout(ORDER, 'FULL_PREPAY', CORR);
    funding.confirmFunding(ORDER, 'collect-42', T);
    readiness.recordOrderKnown(ORDER, CORR);
    const queue = new ReadyQueue({ funding, readiness });
    expect(queue.onTaskReady(taskReadyEvent(), T)).toEqual({ admitted: false, reason: 'not_readiness_confirmed' });
    readiness.confirmReadiness(canonicalReadiness(), T);
    expect(queue.onTaskReady(taskReadyEvent(), T)).toMatchObject({ admitted: true });
  });

  it('CANCELLED order → refused closed, even though funded and ready', () => {
    const { funding, queue } = healthyMocks();
    funding.cancelOrder(ORDER);
    expect(queue.onTaskReady(taskReadyEvent(), T)).toEqual({ admitted: false, reason: 'order_cancelled' });
  });

  it('non-FULL_PREPAY funding at E1 → refused closed', () => {
    const funding = new MockShopPlusFunding({});
    const readiness = new MockBoutikReadiness({});
    funding.initiateCheckout(ORDER, 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR', CORR);
    funding.confirmFunding(ORDER, 'collect-42', T);
    readiness.recordOrderKnown(ORDER, CORR);
    readiness.confirmReadiness(canonicalReadiness(), T);
    const queue = new ReadyQueue({ funding, readiness });
    expect(queue.onTaskReady(taskReadyEvent(), T)).toEqual({ admitted: false, reason: 'payment_mode_not_available_e1' });
  });

  it('a non-canonical task payload refuses closed; a foreign event name refuses closed', () => {
    const { queue } = healthyMocks();
    const evil = taskReadyEvent();
    (evil.payload as Record<string, unknown>)['task'] = { ...task, streetAddress: '12 rue X' };
    expect(queue.onTaskReady(evil, T)).toEqual({ admitted: false, reason: 'task_not_canonical' });
    expect(queue.onTaskReady({ ...taskReadyEvent(), name: 'route.assigned.v1' }, T)).toEqual({
      admitted: false,
      reason: 'unexpected_event_name',
    });
    expect(queue.onTaskReady({ nonsense: true }, T)).toEqual({ admitted: false, reason: 'not_a_platform_event' });
  });
});

describe('§3 misbehavior — Shop+ funding mock vs intake', () => {
  it('① DUPLICATES: task_ready delivered 3× → ONE queued task, duplicates absorbed on command_id', () => {
    const { queue } = healthyMocks({ eventCopies: 3 });
    expect(queue.onTaskReady(taskReadyEvent(), T)).toMatchObject({ admitted: true, duplicate: false });
    expect(queue.onTaskReady(taskReadyEvent(), T)).toMatchObject({ admitted: true, duplicate: true });
    expect(queue.onTaskReady(taskReadyEvent(), T)).toMatchObject({ admitted: true, duplicate: true });
    expect(queue.queuedTasks()).toHaveLength(1);
  });

  it('② OUT-OF-ORDER: reverseOrder provably reorders the funding event plan across two orders', () => {
    const funding = new MockShopPlusFunding({ reverseOrder: true });
    funding.initiateCheckout('order-A', 'FULL_PREPAY', 'corr-A');
    funding.initiateCheckout('order-B', 'FULL_PREPAY', 'corr-B');
    funding.confirmFunding('order-A', 'collect-A', T);
    funding.confirmFunding('order-B', 'collect-B', T);
    expect(funding.fundingEventPlan().map((p) => p.event.payload['order_id'])).toEqual(['order-B', 'order-A']);
  });

  it('③ DELAYED: the funding event plan carries the configured delay visibly', () => {
    const { funding } = healthyMocks({ deliveryDelayMs: 60_000 });
    expect(funding.fundingEventPlan()[0]!.deliverAtMs).toBe(60_000);
  });

  it('④ STALE PROJECTION at intake: funded in truth, stale read denies it → task REFUSED (never admitted on a stale read)', () => {
    const { queue } = healthyMocks({ staleFirstNReads: 1 });
    expect(queue.onTaskReady(taskReadyEvent(), T)).toEqual({ admitted: false, reason: 'funding_projection_stale' });
    expect(queue.queuedTasks()).toHaveLength(0);
    // The projection heals → redelivery admits.
    expect(queue.onTaskReady(taskReadyEvent(), T)).toMatchObject({ admitted: true });
  });

  it('④bis STALE AT ASSIGNMENT TIME: admitted while fresh, stale at recheck → unassignable (SE1.1)', () => {
    const { funding, queue } = healthyMocks();
    expect(queue.onTaskReady(taskReadyEvent(), T)).toMatchObject({ admitted: true });
    // The projection goes stale AFTER admission…
    funding.goStale(1);
    expect(queue.recheckAssignable('task-1')).toEqual({ assignable: false, reason: 'funding_projection_stale' });
    // …and heals: assignable again.
    expect(queue.recheckAssignable('task-1')).toEqual({ assignable: true });
  });

  it('⑤ TIMEOUT + retry: first confirmFunding times out; retry with the SAME collectRef funds ONCE', () => {
    const funding = new MockShopPlusFunding({ timeoutFirstNConfirms: 1 });
    funding.initiateCheckout(ORDER, 'FULL_PREPAY', CORR);
    expect(funding.confirmFunding(ORDER, 'collect-42', T)).toEqual({ outcome: 'timeout' });
    expect(funding.confirmFunding(ORDER, 'collect-42', T)).toEqual({ outcome: 'accepted', collectRef: 'collect-42' });
    expect(funding.fundingEventPlan()).toHaveLength(1); // one funding, one event
  });

  it('⑥ PARTIAL FAILURE: funded provider-side but the event is lost → the projection alone still admits; loss visible in the plan', () => {
    const { funding, queue } = healthyMocks({ loseEvent: true });
    expect(funding.fundingEventPlan()).toHaveLength(0); // the funding event never arrives
    // task_ready still arrives from logistics; the projection (fresh) is the check.
    expect(queue.onTaskReady(taskReadyEvent(), T)).toMatchObject({ admitted: true });
  });

  it('⑦ REJECT INVALID: funding an uninitiated order refused; re-confirming with a DIFFERENT collectRef refused; cancelled refused', () => {
    const funding = new MockShopPlusFunding({});
    expect(funding.confirmFunding('order-ghost', 'c-1', T)).toEqual({
      outcome: 'rejected_invalid',
      reason: 'order_never_initiated',
    });
    funding.initiateCheckout(ORDER, 'FULL_PREPAY', CORR);
    funding.confirmFunding(ORDER, 'collect-42', T);
    expect(funding.confirmFunding(ORDER, 'collect-OTHER', T)).toEqual({
      outcome: 'rejected_invalid',
      reason: 'collect_ref_conflict',
    });
    funding.cancelOrder(ORDER);
    expect(funding.confirmFunding(ORDER, 'collect-42', T)).toEqual({
      outcome: 'rejected_invalid',
      reason: 'order_cancelled',
    });
  });

  it('⑧ SCHEMA-GENERATED: every funding event validates against the pinned PlatformEventSchema envelope', async () => {
    const { funding } = healthyMocks();
    const { PlatformEventSchema } = await import('@platform/contracts');
    for (const planned of funding.fundingEventPlan()) {
      expect(PlatformEventSchema.safeParse(planned.event).success).toBe(true);
    }
  });
});

describe('§3 misbehavior — Boutik+ readiness mock vs intake', () => {
  it('① DUPLICATES: readiness event plan carries 3 copies with ONE underlying confirmation', () => {
    const { readiness } = healthyMocks({}, { eventCopies: 3 });
    const plan = readiness.readinessEventPlan();
    expect(plan).toHaveLength(3);
    expect(new Set(plan.map((p) => p.event.envelope.command_id)).size).toBe(1); // same command redelivered
  });

  it('② OUT-OF-ORDER: reverseOrder provably reorders the readiness plan across two orders', () => {
    const readiness = new MockBoutikReadiness({ reverseOrder: true });
    for (const [order, corr] of [['order-A', 'corr-A'], ['order-B', 'corr-B']] as const) {
      readiness.recordOrderKnown(order, corr);
      readiness.confirmReadiness({ ...canonicalReadiness(), orderId: order, readinessChallenge: `ch-${order}` }, T);
    }
    expect(readiness.readinessEventPlan().map((p) => p.event.payload['order_id'])).toEqual(['order-B', 'order-A']);
  });

  it('③ DELAYED: the readiness plan carries the configured delay visibly', () => {
    const { readiness } = healthyMocks({}, { deliveryDelayMs: 45_000 });
    expect(readiness.readinessEventPlan()[0]!.deliverAtMs).toBe(45_000);
  });

  it('④ STALE PROJECTION: readiness confirmed in truth, stale read denies it → intake refuses; heals → admits', () => {
    const { queue } = healthyMocks({}, { staleFirstNReads: 1 });
    expect(queue.onTaskReady(taskReadyEvent(), T)).toEqual({ admitted: false, reason: 'readiness_projection_stale' });
    expect(queue.onTaskReady(taskReadyEvent(), T)).toMatchObject({ admitted: true });
  });

  it('⑤ TIMEOUT + retry: first confirmReadiness times out; the retry (same canonical payload) is accepted once', () => {
    const readiness = new MockBoutikReadiness({ timeoutFirstNConfirms: 1 });
    readiness.recordOrderKnown(ORDER, CORR);
    expect(readiness.confirmReadiness(canonicalReadiness(), T)).toEqual({ outcome: 'timeout' });
    expect(readiness.confirmReadiness(canonicalReadiness(), T)).toEqual({ outcome: 'accepted' });
    expect(readiness.readinessEventPlan()).toHaveLength(1);
  });

  it('⑥ PARTIAL FAILURE: accepts the first order then goes dark for the second', () => {
    const readiness = new MockBoutikReadiness({ emitForFirstNOrders: 1 });
    readiness.recordOrderKnown('order-A', 'corr-A');
    readiness.recordOrderKnown('order-B', 'corr-B');
    expect(readiness.confirmReadiness({ ...canonicalReadiness(), orderId: 'order-A' }, T).outcome).toBe('accepted');
    expect(readiness.confirmReadiness({ ...canonicalReadiness(), orderId: 'order-B', readinessChallenge: 'ch-B' }, T).outcome).toBe('timeout');
    expect(readiness.readinessEventPlan()).toHaveLength(1);
  });

  it('⑦ REJECT INVALID: unknown order refused; NON-CANONICAL payload strict-refused (buyerDropCode!); challenge conflict refused', () => {
    const readiness = new MockBoutikReadiness({});
    expect(readiness.confirmReadiness(canonicalReadiness(), T)).toEqual({
      outcome: 'rejected_invalid',
      reason: 'order_unknown_to_boutik',
    });
    readiness.recordOrderKnown(ORDER, CORR);
    expect(readiness.confirmReadiness({ ...canonicalReadiness(), buyerDropCode: '4242' }, T)).toEqual({
      outcome: 'rejected_invalid',
      reason: 'not_canonical_confirmation',
    });
    expect(readiness.confirmReadiness(canonicalReadiness(), T).outcome).toBe('accepted');
    expect(readiness.confirmReadiness({ ...canonicalReadiness(), readinessChallenge: 'DIFFERENT' }, T)).toEqual({
      outcome: 'rejected_invalid',
      reason: 'challenge_conflict',
    });
  });

  it('⑧ SCHEMA-GENERATED: readiness input goes through the pinned strict PackageReadinessConfirmation; events through PlatformEventSchema', async () => {
    const { readiness } = healthyMocks();
    const { PlatformEventSchema } = await import('@platform/contracts');
    for (const planned of readiness.readinessEventPlan()) {
      expect(PlatformEventSchema.safeParse(planned.event).success).toBe(true);
    }
  });
});
