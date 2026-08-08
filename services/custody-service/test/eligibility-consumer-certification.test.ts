import { describe, expect, it } from 'vitest';
import { certifyAdapter, CERTIFICATION_BEHAVIORS, formatScorecard } from '@platform/certification';
import { CommerceEligibilityConsumerMock } from '../mocks/commerce-eligibility-consumer-mock.js';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../src/pickup-verification-policy.js';
import { CustodySpine } from '../src/custody-spine.js';

const T = '2026-07-10T12:00:00.000Z';
const SHA = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
const CHAIN = { order_id: 'order-e1-0001', task_id: 'task-e1-0001', package_id: 'pkg-e1-0001', correlation_id: 'corr-e1-0001' };
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));

function spineThroughEligibility(): CustodySpine {
  const spine = new CustodySpine(CHAIN, 'sup-1');
  expect(spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-4711')).toEqual({ ok: true });
  expect(spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-e1-0001')).toEqual({ ok: true });
  expect(spine.secrets.register('buyer_drop_code', CHAIN.order_id, 'drop-9042')).toEqual({ ok: true });
  spine.establishSellerCustody(T);
  spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-e1-0001' }, 'pvc-4711', T);
  spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e1-0001', sealPhotoRefs: ['media/seal.jpg'], at: T });
  spine.submitDeliveryEvidence({ taskId: CHAIN.task_id, packageId: CHAIN.package_id, custodySealId: 'seal-e1-0001', artifacts: [{ ref: 'media/drop.jpg', sha256: SHA, mimeType: 'image/jpeg' }], capturedAt: T }, 'server_confirmed', T);
  spine.decideValidation(T);
  spine.confirmDropAndEmitEligibility('drop-9042', T);
  return spine;
}

describe('commerce-core eligibility-consumer mock — certified by the pinned §3 suite', () => {
  it('scores 8/8 — CERTIFIED', async () => {
    const card = await certifyAdapter(new CommerceEligibilityConsumerMock());
    console.log(formatScorecard(card)); // the scorecard IS the evidence
    expect(card.certified).toBe(true);
    expect(card.score).toBe(`${CERTIFICATION_BEHAVIORS.length}/${CERTIFICATION_BEHAVIORS.length}`);
    for (const result of card.results) {
      expect(result.passed, `${result.behavior}: ${result.detail}`).toBe(true);
    }
  });

  it('consumer law: ONLY the validated eligibility signal applies, exactly once, under duplicate delivery', () => {
    const spine = spineThroughEligibility();
    const signal = spine.allEvents().find((e) => e.name === 'delivery.validated.v1')!;
    const consumer = new CommerceEligibilityConsumerMock();
    // SE-LIVE-5a — the signal CARRIES THE SUPPLIER (an identity, never an
    // amount): Shop+'s real consumer names the supplier obligation from this
    // very field, because its own domain never learns one.
    expect((signal.payload as Record<string, unknown>)['supplier_ref']).toBe('sup-1');
    expect(consumer.consumeEligibilitySignal(signal)).toEqual({ accepted: true, duplicate: false });
    // At-least-once delivery: the SAME signal redelivered thrice absorbs.
    for (let i = 0; i < 3; i += 1) {
      expect(consumer.consumeEligibilitySignal(signal)).toEqual({ accepted: true, duplicate: true });
    }
    expect(consumer.eligibleCount(CHAIN.order_id)).toBe(1);
  });

  it('consumer refuses: non-validated results, amount-bearing payloads (SE-I09), foreign names, garbage', () => {
    const spine = spineThroughEligibility();
    const signal = spine.allEvents().find((e) => e.name === 'delivery.validated.v1')!;
    const consumer = new CommerceEligibilityConsumerMock();
    expect(consumer.consumeEligibilitySignal({ ...signal, payload: { ...signal.payload, result: 'review_hold', settlement_eligibility: false } }))
      .toEqual({ accepted: false, reason: 'not_validated' });
    expect(consumer.consumeEligibilitySignal({ ...signal, payload: { ...signal.payload, sellerNetAmount: 8_500 } }))
      .toEqual({ accepted: false, reason: 'amount_bearing_signal_refused' });
    expect(consumer.consumeEligibilitySignal({ ...signal, name: 'payout.paid.v1' }))
      .toEqual({ accepted: false, reason: 'not_an_eligibility_signal' });
    expect(consumer.consumeEligibilitySignal({ garbage: true })).toEqual({ accepted: false, reason: 'not_a_platform_event' });
    expect(consumer.eligibleCount(CHAIN.order_id)).toBe(0); // nothing slipped through
  });

  it('the spine stays exactly-once even when the consumer replays and the spine is re-confirmed (both misbehave)', () => {
    const spine = spineThroughEligibility();
    const consumer = new CommerceEligibilityConsumerMock();
    const deliverAll = () => {
      for (const e of spine.allEvents()) {
        if (e.name === 'delivery.validated.v1') consumer.consumeEligibilitySignal(e);
      }
    };
    deliverAll();
    spine.confirmDropAndEmitEligibility('drop-9042', T); // replayed confirmation — absorbed
    deliverAll(); // full redelivery of history — absorbed
    expect(spine.allEvents().filter((e) => e.name === 'delivery.validated.v1')).toHaveLength(1);
    expect(consumer.eligibleCount(CHAIN.order_id)).toBe(1);
  });
});
