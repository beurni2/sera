import { describe, expect, it } from 'vitest';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../src/pickup-verification-policy.js';
import { CustodySpine } from '../src/custody-spine.js';

const T = '2026-07-10T12:00:00.000Z';
const SHA = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
const CHAIN = { order_id: 'order-e1-0001', task_id: 'task-e1-0001', package_id: 'pkg-e1-0001', correlation_id: 'corr-e1-0001' };
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));

const evidenceBundle = (over: Record<string, unknown> = {}) => ({
  taskId: CHAIN.task_id,
  packageId: CHAIN.package_id,
  custodySealId: 'seal-e1-0001',
  artifacts: [{ ref: 'media/drop-photo.jpg', sha256: SHA, mimeType: 'image/jpeg' }],
  capturedAt: T,
  ...over,
});

function freshSpine(): CustodySpine {
  const spine = new CustodySpine(CHAIN, 'sup-1');
  expect(spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-4711')).toEqual({ ok: true });
  expect(spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-e1-0001')).toEqual({ ok: true });
  expect(spine.secrets.register('buyer_drop_code', CHAIN.order_id, 'drop-9042')).toEqual({ ok: true });
  spine.establishSellerCustody(T);
  return spine;
}

function spineWithCourierCustody(): CustodySpine {
  const spine = freshSpine();
  const v = spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-e1-0001' }, 'pvc-4711', T);
  if (v.kind !== 'accepted') throw new Error('setup verify');
  const c = spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e1-0001', sealPhotoRefs: ['media/seal.jpg'], at: T });
  if (!c.ok) throw new Error('setup custody');
  return spine;
}

describe('custody spine — SE4.3 seal-after-verification, refuse closed everywhere', () => {
  it('happy pickup: verify (code consumed) → seal → custody begins; ledger chain verifies; one custodian', () => {
    const spine = spineWithCourierCustody();
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
    expect(spine.ledger.verifyChain()).toEqual({ valid: true });
    const names = spine.allEvents().map((e) => e.name);
    expect(names).toContain('pickup.verification_recorded.v1');
    expect(names).toContain('pickup.custody_seal_registered.v1');
    expect(names).toContain('custody.transferred_to_courier.v1');
  });

  it('CUSTODY WITHOUT VERIFICATION refuses closed — the transition is not even reachable', () => {
    const spine = freshSpine();
    expect(spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e1-0001', sealPhotoRefs: ['media/seal.jpg'], at: T }))
      .toEqual({ ok: false, reason: 'verification_not_accepted' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('seller:sup-1');
  });

  it('a REFUSED verification emits faultClass=seller and custody NEVER begins', () => {
    const spine = freshSpine();
    const v = spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: { ...allPass, damage: false }, dwellSec: 150, evidenceBundleId: 'eb-1' }, 'pvc-4711', T);
    expect(v.kind).toBe('refused');
    const fault = spine.allEvents().find((e) => e.name === 'protection.claim_opened.v1');
    expect(fault?.payload).toMatchObject({ faultClass: 'seller', failed_checks: ['damage'] });
    expect(spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e1-0001', sealPhotoRefs: ['media/seal.jpg'], at: T }))
      .toEqual({ ok: false, reason: 'verification_not_accepted' });
  });

  it('SINGLE-USE SECRETS, all three: pickup-code replay, seal replay, and drop-code replay each REFUSED', () => {
    const spine = spineWithCourierCustody();
    // pickup code was consumed at verification — replay refused:
    expect(spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1' }, 'pvc-4711', T))
      .toMatchObject({ kind: 'invalid', reason: 'pickup_code_refused', detail: 'secret_already_used' });
    // seal replay refused:
    expect(spine.secrets.consume('custody_seal', CHAIN.order_id, 'seal-e1-0001', T)).toEqual({ ok: false, reason: 'secret_already_used' });
    // drop code: consume via the happy path, then replay refused at the registry:
    spine.submitDeliveryEvidence(evidenceBundle(), 'server_confirmed', T);
    spine.decideValidation(T);
    expect(spine.confirmDropAndEmitEligibility('drop-9042', T)).toMatchObject({ ok: true, duplicate: false });
    expect(spine.secrets.consume('buyer_drop_code', CHAIN.order_id, 'drop-9042', T)).toEqual({ ok: false, reason: 'secret_already_used' });
  });

  it('WRONG PACKAGE (order-ref mismatch) and ACTOR SEPARATION (supplier as rider) each fail closed', () => {
    const spine = freshSpine();
    spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1' }, 'pvc-4711', T);
    expect(spine.beginCustody({ riderId: 'r-1', verificationOrderId: 'order-OTHER', custodySealId: 'seal-e1-0001', sealPhotoRefs: ['x'], at: T }))
      .toEqual({ ok: false, reason: 'order_ref_mismatch' });
    expect(spine.beginCustody({ riderId: 'sup-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e1-0001', sealPhotoRefs: ['x'], at: T }))
      .toEqual({ ok: false, reason: 'actor_separation_supplier_is_rider' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('seller:sup-1'); // nothing moved
  });

  it('⚠ FOUNDER OVERRIDE 2026-08-10 — a seal with NO PHOTO now begins custody', () => {
    /**
     * « terminate that sealing code and the sealing photo proof requirement …
     * photo capture is optional and only required when one the 3 answers is
     * non. » The `no_evidence_refs` guard that stood here is lifted for the
     * SEAL, and only for the seal.
     *
     * SE-I05 is untouched, and this test proves it in the same breath: the
     * verification must still be ACCEPTED first, and the seal must still be
     * registered — custody moves only when both are true.
     */
    const spine = freshSpine();
    // No verification yet ⇒ still refused closed, photo or no photo.
    expect(spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e1-0001', sealPhotoRefs: [], at: T }))
      .toEqual({ ok: false, reason: 'verification_not_accepted' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('seller:sup-1');

    spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1' }, 'pvc-4711', T);
    const began = spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e1-0001', sealPhotoRefs: [], at: T });
    expect(began.ok, JSON.stringify(began)).toBe(true);
    // …and the LEDGER, not the answer, says the rider holds it.
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
  });

  it('⚠ …and the seal is still SINGLE-USE and still equality-bound', () => {
    // What the photo never protected, and what still does: the seal cannot be
    // spent twice, so a second course cannot ride the first one's seal.
    const spine = freshSpine();
    spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1' }, 'pvc-4711', T);
    expect(spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e1-0001', sealPhotoRefs: [], at: T }).ok).toBe(true);
    expect(spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e1-0001', sealPhotoRefs: [], at: T }))
      .toEqual({ ok: false, reason: 'seal_already_used' });
  });
});

describe('delivery + SE5.3 — validation gates the drop code; eligibility exactly once', () => {
  it('OFFLINE evidence is queued = PENDING: no validation possible, custody untouched (never final offline)', () => {
    const spine = spineWithCourierCustody();
    const submitted = spine.submitDeliveryEvidence(evidenceBundle(), 'queued_offline', T);
    expect(submitted).toEqual({ ok: true, pending: true });
    expect(spine.hasPendingOfflineEvidence()).toBe(true);
    expect(spine.decideValidation(T)).toEqual({ ok: false, reason: 'validation_before_evidence' });
    expect(spine.confirmDropAndEmitEligibility('drop-9042', T)).toEqual({ ok: false, reason: 'not_validated' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
  });

  it('GPS-ONLY evidence can NEVER validate → review_hold with gps_never_sole_proof; hold releases NOTHING', () => {
    const spine = spineWithCourierCustody();
    spine.submitDeliveryEvidence(evidenceBundle({ artifacts: [], coarseLocation: 'zone:Gounghin' }), 'server_confirmed', T);
    const decided = spine.decideValidation(T);
    expect(decided.ok && decided.decision.result).toBe('review_hold');
    if (!decided.ok) return;
    expect(decided.decision.reasons).toEqual(['gps_never_sole_proof']);
    expect(decided.event?.name).toBe('delivery.held_for_review.v1');
    expect(spine.confirmDropAndEmitEligibility('drop-9042', T)).toEqual({ ok: false, reason: 'not_validated' });
    expect(spine.allEvents().filter((e) => e.name === 'delivery.validated.v1')).toHaveLength(0);
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
  });

  it('a hold resolved to REJECTED emits delivery.refused.v1 and releases NOTHING — and is not a terminal machine state', () => {
    const spine = spineWithCourierCustody();
    spine.submitDeliveryEvidence(evidenceBundle({ artifacts: [], coarseLocation: 'zone:Gounghin' }), 'server_confirmed', T);
    spine.decideValidation(T);
    const rejected = spine.resolveHoldAsRejected(['damaged_on_arrival_claim'], T);
    expect(rejected.ok && rejected.event.name).toBe('delivery.refused.v1');
    expect(spine.confirmDropAndEmitEligibility('drop-9042', T)).toEqual({ ok: false, reason: 'not_validated' });
    expect(spine.allEvents().filter((e) => e.name === 'delivery.validated.v1')).toHaveLength(0);
    // resolveHold on a non-held decision refuses closed — unknown transitions have no home here.
    const spine2 = spineWithCourierCustody();
    expect(spine2.resolveHoldAsRejected(['x'], T)).toEqual({ ok: false, reason: 'unknown_transition' });
  });

  it('happy validation: exactly ONE delivery.validated.v1 exists per order — the eligibility signal, after the drop code', () => {
    const spine = spineWithCourierCustody();
    spine.submitDeliveryEvidence(evidenceBundle(), 'server_confirmed', T);
    const decided = spine.decideValidation(T);
    expect(decided.ok && decided.decision.result).toBe('validated');
    if (!decided.ok) return;
    expect(decided.event).toBeNull(); // no public event at decision time
    // Wrong drop code → refused, custody stays with the courier:
    expect(spine.confirmDropAndEmitEligibility('drop-WRONG', T)).toEqual({ ok: false, reason: 'drop_code_refused' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
    // Right code → custody→customer + the ONE eligibility signal:
    const confirmed = spine.confirmDropAndEmitEligibility('drop-9042', T);
    expect(confirmed).toMatchObject({ ok: true, duplicate: false });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('customer');
    const validatedEvents = spine.allEvents().filter((e) => e.name === 'delivery.validated.v1');
    expect(validatedEvents).toHaveLength(1);
    expect(validatedEvents[0]!.payload).toMatchObject({
      order_id: CHAIN.order_id, task_id: CHAIN.task_id, validation_id: `val-${CHAIN.order_id}`, settlement_eligibility: true,
    });
    // No amount-like field rides the signal (SE-I09):
    expect(Object.keys(validatedEvents[0]!.payload).join(',')).not.toMatch(/amount|fcfa|net|fee/i);
  });

  it('ELIGIBILITY EXACTLY ONCE: duplicate and replayed confirmations absorb — no second signal, ledger chain intact', () => {
    const spine = spineWithCourierCustody();
    spine.submitDeliveryEvidence(evidenceBundle(), 'server_confirmed', T);
    spine.decideValidation(T);
    spine.confirmDropAndEmitEligibility('drop-9042', T);
    for (let i = 0; i < 3; i += 1) {
      expect(spine.confirmDropAndEmitEligibility('drop-9042', T)).toEqual({ ok: true, duplicate: true, events: [] });
    }
    expect(spine.allEvents().filter((e) => e.name === 'delivery.validated.v1')).toHaveLength(1);
    expect(spine.ledger.verifyChain()).toEqual({ valid: true });
  });
});

describe('WO-2.1 finding ① — evidence-to-chain binding (SE-I11: evidence supports THIS delivery only)', () => {
  it('a FOREIGN packageId is refused closed: no ledger entry, no event, no decision', () => {
    const spine = spineWithCourierCustody();
    const eventsBefore = spine.allEvents().length;
    const ledgerBefore = spine.ledger.all().length;
    expect(spine.submitDeliveryEvidence(evidenceBundle({ packageId: 'pkg-FOREIGN' }), 'server_confirmed', T))
      .toEqual({ ok: false, reason: 'evidence_chain_mismatch' });
    expect(spine.allEvents().length).toBe(eventsBefore);
    expect(spine.ledger.all().length).toBe(ledgerBefore);
    expect(spine.decideValidation(T)).toEqual({ ok: false, reason: 'validation_before_evidence' });
  });

  it('a FOREIGN taskId is refused closed with the same chain-mismatch reason', () => {
    const spine = spineWithCourierCustody();
    expect(spine.submitDeliveryEvidence(evidenceBundle({ taskId: 'task-FOREIGN' }), 'server_confirmed', T))
      .toEqual({ ok: false, reason: 'evidence_chain_mismatch' });
    expect(spine.decideValidation(T)).toEqual({ ok: false, reason: 'validation_before_evidence' });
  });

  it('a FOREIGN seal — valid shape, wrong seal — is refused: only the seal REGISTERED at beginCustody binds', () => {
    const spine = spineWithCourierCustody();
    expect(spine.submitDeliveryEvidence(evidenceBundle({ custodySealId: 'seal-FOREIGN' }), 'server_confirmed', T))
      .toEqual({ ok: false, reason: 'evidence_seal_mismatch' });
    expect(spine.confirmDropAndEmitEligibility('drop-9042', T)).toEqual({ ok: false, reason: 'not_validated' });
    expect(spine.allEvents().filter((e) => e.name === 'delivery.validated.v1')).toHaveLength(0);
  });

  it('a bundle MISSING its binding field never reaches the binder — the strict schema refuses it first', () => {
    const spine = spineWithCourierCustody();
    const { custodySealId: _dropped, ...unbound } = evidenceBundle();
    expect(spine.submitDeliveryEvidence(unbound, 'server_confirmed', T))
      .toEqual({ ok: false, reason: 'evidence_not_canonical' });
    expect(spine.decideValidation(T)).toEqual({ ok: false, reason: 'validation_before_evidence' });
  });

  it('the BOUND bundle still validates and completes — binding refuses foreigners, not the delivery', () => {
    const spine = spineWithCourierCustody();
    expect(spine.submitDeliveryEvidence(evidenceBundle(), 'server_confirmed', T)).toMatchObject({ ok: true, pending: false });
    const decided = spine.decideValidation(T);
    expect(decided.ok && decided.decision.result).toBe('validated');
    expect(spine.confirmDropAndEmitEligibility('drop-9042', T)).toMatchObject({ ok: true, duplicate: false });
  });
});

describe('WO-2.1 finding ③ — the registry door refuses re-arming (the WO-1.3 re-arm attack, replayed)', () => {
  it('register → consume → RE-REGISTER is refused at the door with secret_already_used — one layer earlier than WO-1.3', () => {
    const spine = spineWithCourierCustody();
    // At WO-1.3 this register() silently re-armed the consumed seal and the
    // attack died only at the spine (custody already with courier). Now it
    // dies HERE, at the registry door:
    expect(spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-REARMED'))
      .toEqual({ ok: false, reason: 'secret_already_used' });
    // And the presented re-armed value still cannot consume:
    expect(spine.secrets.consume('custody_seal', CHAIN.order_id, 'seal-REARMED', T))
      .toEqual({ ok: false, reason: 'secret_already_used' });
    // Same for the drop code after the happy path spends it:
    spine.submitDeliveryEvidence(evidenceBundle(), 'server_confirmed', T);
    spine.decideValidation(T);
    spine.confirmDropAndEmitEligibility('drop-9042', T);
    expect(spine.secrets.register('buyer_drop_code', CHAIN.order_id, 'drop-REARMED'))
      .toEqual({ ok: false, reason: 'secret_already_used' });
  });

  it('an UNCONSUMED secret may still be (re)registered — the door blocks spent secrets, not arming', () => {
    const spine = freshSpine();
    expect(spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-rotated')).toEqual({ ok: true });
  });
});
