import { describe, expect, it } from 'vitest';
import { PlatformEventSchema } from '@platform/contracts';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../src/pickup-verification-policy.js';
import { CustodySpine } from '../src/custody-spine.js';
import { ACTOR_PROVENANCE_V1, checkProducerActor } from '../src/actor-provenance.js';
import { CommerceEligibilityConsumerMock } from '../mocks/commerce-eligibility-consumer-mock.js';
import { ShopDoorPaymentEmitterMock } from '../mocks/shop-door-payment-emitter-mock.js';

/**
 * WO-2.7 sera items 1 + 3 — actor provenance (the in-process layer beneath
 * E3 transport auth) and fault-emission per-attempt uniqueness.
 */

const T = '2026-07-10T12:00:00.000Z';
const CHAIN = { order_id: 'order-e2-0001', task_id: 'task-e2-0001', package_id: 'pkg-e2-0001', correlation_id: 'corr-e2-0001' };
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));

function optionBSpineAtDoor(): CustodySpine {
  const spine = new CustodySpine(CHAIN, 'sup-1', 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR');
  expect(spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-1')).toEqual({ ok: true });
  expect(spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-1')).toEqual({ ok: true });
  expect(spine.secrets.register('buyer_drop_code', CHAIN.order_id, 'drop-1')).toEqual({ ok: true });
  spine.establishSellerCustody(T);
  const v = spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-1' }, 'pvc-1', T);
  if (v.kind !== 'accepted') throw new Error('setup verify');
  const c = spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-1', sealPhotoRefs: ['media/seal.jpg'], at: T });
  if (!c.ok) throw new Error('setup custody');
  const insp = spine.recordDoorInspection({ orderId: CHAIN.order_id, inspectionCategory: 'fashion_bags_fabrics', packageOpened: false, manufacturerSealOpened: false, custodySealIntact: true, buyerAccepts: true, startedAt: T, completedAt: T, evidenceBundleId: 'eb-door' }, T);
  if (!insp.ok) throw new Error('setup inspection');
  return spine;
}

const doorSignal = (actor: string, command_id = 'cmd-door-1') =>
  PlatformEventSchema.parse({
    name: 'payment.door_leg_confirmed.v1',
    envelope: { command_id, correlation_id: 'corr-shop', aggregateVersion: 1, actor, serverTime: T, version: '1' },
    payload: { provider: 'sandbox-provider', payment_attempt_id: 'pa-1', collectRef: 'c-1', amount: 11_500, fee: 0, status: 'captured', order_id: CHAIN.order_id, redelivery: 0 },
  });

describe('WO-2.7 item 1 — actor provenance (in-process layer; E3 transport auth sits above)', () => {
  it('registry is versioned data; the check is CLOSED: unknown actor and unregistered event both mismatch', () => {
    expect(ACTOR_PROVENANCE_V1.version).toBe('actor-provenance.v1');
    expect(checkProducerActor('payment.door_leg_confirmed.v1', 'shop:commerce-core')).toEqual({ ok: true, producerClass: 'payment_provider' });
    expect(checkProducerActor('payment.door_leg_confirmed.v1', 'actor-from-nowhere')).toMatchObject({ ok: false, reason: 'producer_actor_mismatch', actorClass: null });
    expect(checkProducerActor('some.unregistered.v1', 'shop:commerce-core')).toMatchObject({ ok: false, expectedClass: 'unregistered_event' });
  });

  it('BOUNDARY LAW (verifier blocking finding 1, attack strings replayed verbatim): prefix tricks on exact-match entries are refused; namespace entries still match their members', () => {
    // The verifier's exact forged actors — every one must classify as NOTHING.
    for (const forged of ['shop:commerce-core-evil', 'shop:commerce-coreX', 'mock:shop-door-payment-emitter-evil']) {
      expect(checkProducerActor('payment.door_leg_confirmed.v1', forged), forged)
        .toMatchObject({ ok: false, reason: 'producer_actor_mismatch', actorClass: null });
    }
    // Namespace entries keep matching their members; exact entries their exact selves.
    expect(checkProducerActor('delivery.validated.v1', 'custody-service:e1')).toEqual({ ok: true, producerClass: 'custody' });
    expect(checkProducerActor('payment.door_leg_confirmed.v1', 'mock:shop-door-payment-emitter')).toEqual({ ok: true, producerClass: 'payment_provider' });
  });

  it('BOUNDARY LAW through the REAL spine: the forged prefix-trick actor is refused closed + alerted, door state untouched', () => {
    const spine = optionBSpineAtDoor();
    const forged = doorSignal('shop:commerce-core-evil', 'cmd-prefix-trick-1');
    expect(spine.consumeDoorPaidSignal(forged, T)).toMatchObject({ ok: false, reason: 'producer_actor_mismatch' });
    expect(spine.isDoorPaymentConfirmed()).toBe(false);
    const alerts = spine.allEvents().filter((e) => e.name === 'reconciliation.alert.v1' && (e.payload as Record<string, unknown>)['scenario'] === 'producer_actor_mismatch');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({ actor: 'shop:commerce-core-evil', actor_class: 'unclassified' });
  });

  it('WRONG-ACTOR door signal: refused closed, ONE reconciliation.alert.v1, door state untouched — and the replay does not re-alert', () => {
    const spine = optionBSpineAtDoor();
    const forged = doorSignal('rider:r-1', 'cmd-forged-1');
    const refused = spine.consumeDoorPaidSignal(forged, T);
    expect(refused).toMatchObject({ ok: false, reason: 'producer_actor_mismatch' });
    expect(spine.isDoorPaymentConfirmed()).toBe(false);
    const alerts = spine.allEvents().filter((e) => e.name === 'reconciliation.alert.v1' && (e.payload as Record<string, unknown>)['scenario'] === 'producer_actor_mismatch');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({ actor: 'rider:r-1', expected_class: 'payment_provider' });
    // Replay of the SAME forged command: still refused, no second alert.
    expect(spine.consumeDoorPaidSignal(forged, T)).toEqual({ ok: false, reason: 'producer_actor_mismatch' });
    expect(spine.allEvents().filter((e) => e.name === 'reconciliation.alert.v1')).toHaveLength(1);
    // A custody-service actor is not a payment provider either — even the
    // house's own name cannot speak for the provider.
    expect(spine.consumeDoorPaidSignal(doorSignal('custody-service:e1', 'cmd-forged-2'), T))
      .toMatchObject({ ok: false, reason: 'producer_actor_mismatch' });
  });

  it('the LAWFUL producer class consumes: the §3 door-payment mock\'s real emission advances the door state', async () => {
    const spine = optionBSpineAtDoor();
    const mock = new ShopDoorPaymentEmitterMock();
    const { delivered } = await mock.emit('e2', {});
    const doorLeg = delivered.map((d) => d.event).find((e) => e.name === 'payment.door_leg_confirmed.v1')!;
    const lawful = { ...doorLeg, payload: { ...(doorLeg.payload as object), order_id: CHAIN.order_id } };
    expect(spine.consumeDoorPaidSignal(lawful, T)).toEqual({ ok: true, duplicate: false });
    expect(spine.isDoorPaymentConfirmed()).toBe(true);
  });

  it('eligibility-relevant provenance: a delivery.validated.v1 with a forged actor is refused by the consumer', () => {
    const consumer = new CommerceEligibilityConsumerMock();
    const forged = PlatformEventSchema.parse({
      name: 'delivery.validated.v1',
      envelope: { command_id: 'cmd-elig-forged', correlation_id: 'corr-x', aggregateVersion: 1, actor: 'rider:r-1', serverTime: T, version: '1' },
      payload: { order_id: CHAIN.order_id, task_id: CHAIN.task_id, validation_id: 'val-x', result: 'validated', settlement_eligibility: true },
    });
    expect(consumer.consumeEligibilitySignal(forged)).toEqual({ accepted: false, reason: 'producer_actor_mismatch' });
    expect(consumer.eligibleCount(CHAIN.order_id)).toBe(0);
  });
});

describe('WO-2.7 item 3 — fault emission keys per ATTEMPT (order + verification cycle)', () => {
  function refusedOnce(): CustodySpine {
    const spine = new CustodySpine(CHAIN, 'sup-1');
    expect(spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-1')).toEqual({ ok: true });
    spine.establishSellerCustody(T);
    const v = spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: { ...allPass, colour: false }, dwellSec: 150, evidenceBundleId: 'eb-1' }, 'pvc-1', T);
    expect(v.kind).toBe('refused');
    return spine;
  }

  it('attempt 1 refusal → fault command keyed -a1 with attempt in the payload; the SAME attempt replays with the SAME command_id', () => {
    const spine = refusedOnce();
    const faults = spine.allEvents().filter((e) => e.name === 'protection.claim_opened.v1');
    expect(faults).toHaveLength(1);
    expect(faults[0]!.envelope.command_id).toBe(`fault-${CHAIN.order_id}-a1`);
    expect(faults[0]!.payload).toMatchObject({ faultClass: 'seller', failed_checks: ['colour'], attempt: 1 });
    // A redelivery of THIS event is byte-identical — consumers dedupe on the
    // stable command_id; nothing here mints a new identity for a replay.
    expect(spine.allEvents().filter((e) => e.envelope.command_id === `fault-${CHAIN.order_id}-a1`)).toHaveLength(1);
  });

  it('the corrective round-trip: new cycle ONLY after a refusal, with a NEW code; a second refusal is a NEW countable event (-a2)', () => {
    const spine = refusedOnce();
    // The spent cycle-1 code stays spent; the fresh spine has no cycle 2 yet.
    expect(spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1' }, 'pvc-1', T))
      .toMatchObject({ kind: 'invalid', reason: 'pickup_code_refused', detail: 'secret_already_used' });

    const cycle = spine.openNewVerificationCycle('pvc-2', T);
    expect(cycle).toEqual({ ok: true, cycle: 2 });
    // Cycle-1 code cannot verify cycle 2 — codes are per attempt.
    expect(spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: { ...allPass, qty: false }, dwellSec: 150, evidenceBundleId: 'eb-2' }, 'pvc-1', T))
      .toMatchObject({ kind: 'invalid', reason: 'pickup_code_refused' });

    const second = spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: { ...allPass, qty: false }, dwellSec: 150, evidenceBundleId: 'eb-2' }, 'pvc-2', T);
    expect(second.kind).toBe('refused');
    const faults = spine.allEvents().filter((e) => e.name === 'protection.claim_opened.v1');
    expect(faults.map((e) => e.envelope.command_id)).toEqual([`fault-${CHAIN.order_id}-a1`, `fault-${CHAIN.order_id}-a2`]);
    expect(faults[1]!.payload).toMatchObject({ failed_checks: ['qty'], attempt: 2 });
    // Verification records are attempt-keyed too — same duplicate class.
    const verifies = spine.allEvents().filter((e) => e.name === 'pickup.verification_recorded.v1');
    expect(verifies.map((e) => e.envelope.command_id)).toEqual([`verify-${CHAIN.order_id}-a1`, `verify-${CHAIN.order_id}-a2`]);
  });

  it('cycle discipline refuses closed: no cycle without a refusal, none after acceptance — and custody still begins normally on the accepted cycle', () => {
    const fresh = new CustodySpine(CHAIN, 'sup-1');
    expect(fresh.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-1')).toEqual({ ok: true });
    fresh.establishSellerCustody(T);
    expect(fresh.openNewVerificationCycle('pvc-x', T)).toEqual({ ok: false, reason: 'no_refused_verification' });

    const spine = refusedOnce();
    expect(spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-1')).toEqual({ ok: true });
    expect(spine.openNewVerificationCycle('pvc-2', T)).toEqual({ ok: true, cycle: 2 });
    // Two cycles may not stack without a fresh refusal in between.
    expect(spine.openNewVerificationCycle('pvc-3', T)).toEqual({ ok: false, reason: 'no_refused_verification' });
    const accepted = spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-2' }, 'pvc-2', T);
    expect(accepted.kind).toBe('accepted');
    expect(spine.openNewVerificationCycle('pvc-3', T)).toEqual({ ok: false, reason: 'verification_already_accepted' });
    expect(spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-1', sealPhotoRefs: ['media/seal.jpg'], at: T }).ok).toBe(true);
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
  });
});
