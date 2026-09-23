import { describe, expect, it } from 'vitest';
import { PlatformEventSchema } from '@platform/contracts';
import { CERTIFICATION_BEHAVIORS, certifyAdapter, formatScorecard } from '@platform/certification';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../src/pickup-verification-policy.js';
import { CustodySpine } from '../src/custody-spine.js';
import { DOOR_FAULT_DERIVATION_V1, INSPECTION_POLICIES_V1, runDoorInspection } from '../src/door-flow.js';
import { ShopDoorPaymentEmitterMock } from '../mocks/shop-door-payment-emitter-mock.js';

const T = '2026-07-10T12:00:00.000Z';
const T2 = '2026-07-10T12:20:00.000Z';
const SHA = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
const CHAIN = { order_id: 'order-b-0001', task_id: 'task-b-0001', package_id: 'pkg-b-0001', correlation_id: 'corr-b-0001' };
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));

const inspectionInput = (over: Record<string, unknown> = {}) => ({
  orderId: CHAIN.order_id,
  inspectionCategory: 'fashion_bags_fabrics',
  packageOpened: false,
  manufacturerSealOpened: false,
  custodySealIntact: true,
  buyerAccepts: true,
  startedAt: T,
  completedAt: T,
  evidenceBundleId: 'eb-door-1',
  ...over,
});

function doorSignal(commandId = 'cmd-door-1', orderId = CHAIN.order_id) {
  return PlatformEventSchema.parse({
    name: 'payment.door_leg_confirmed.v1',
    envelope: {
      command_id: commandId, correlation_id: 'corr-shop', aggregateVersion: 1,
      actor: 'shop:commerce-core', serverTime: T, version: '1',
    },
    payload: {
      provider: 'sandbox-provider', payment_attempt_id: 'payatt-1', collectRef: 'collect-door-1',
      amount: 11_500, fee: 0, status: 'captured', order_id: orderId, redelivery: 0,
    },
  });
}

/** A prepaid article of a package, validated at the door like `optionBSpine`. */
function prepaidColisSpine(): CustodySpine {
  const spine = new CustodySpine({ ...CHAIN, order_id: CHAIN.order_id }, 'sup-1', 'FULL_PREPAY', true);
  spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-1');
  spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-b-1');
  spine.secrets.register('buyer_drop_code', CHAIN.order_id, 'drop-1');
  spine.establishSellerCustody(T);
  const v = spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-b-1' }, 'pvc-1', T);
  if (v.kind !== 'accepted') throw new Error('setup verify');
  if (!spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-b-1', sealPhotoRefs: ['media/seal.jpg'], at: T }).ok) throw new Error('setup custody');
  if (!spine.submitDeliveryEvidence({ taskId: CHAIN.task_id, packageId: CHAIN.package_id, custodySealId: 'seal-b-1', artifacts: [{ ref: 'media/drop.jpg', sha256: SHA, mimeType: 'image/jpeg' }], capturedAt: T }, 'server_confirmed', T).ok) throw new Error('setup evidence');
  const d = spine.decideValidation(T);
  if (!d.ok || d.decision.result !== 'validated') throw new Error('setup decision');
  return spine;
}

function optionBSpine(enColis = false): CustodySpine {
  const spine = new CustodySpine(CHAIN, 'sup-1', 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR', enColis);
  expect(spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-1')).toEqual({ ok: true });
  expect(spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-b-1')).toEqual({ ok: true });
  expect(spine.secrets.register('buyer_drop_code', CHAIN.order_id, 'drop-1')).toEqual({ ok: true });
  spine.establishSellerCustody(T);
  const v = spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-b-1' }, 'pvc-1', T);
  if (v.kind !== 'accepted') throw new Error('setup verify');
  const c = spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-b-1', sealPhotoRefs: ['media/seal.jpg'], at: T });
  if (!c.ok) throw new Error('setup custody');
  const e = spine.submitDeliveryEvidence({ taskId: CHAIN.task_id, packageId: CHAIN.package_id, custodySealId: 'seal-b-1', artifacts: [{ ref: 'media/drop.jpg', sha256: SHA, mimeType: 'image/jpeg' }], capturedAt: T }, 'server_confirmed', T);
  if (!e.ok) throw new Error('setup evidence');
  const d = spine.decideValidation(T);
  // Same blindness as the offline gate carried: `if (!d.ok)` asserts a decision
  // exists, never what it says. The Option-B door tests below all assume this
  // spine is VALIDATED; say so, or a silent inversion passes here too.
  if (!d.ok) throw new Error('setup decision');
  if (d.decision.result !== 'validated') throw new Error(`setup decision expected validated, got ${d.decision.result}`);
  return spine;
}

describe('WO-2.4 item 1 — inspection at the door (policy data, derived fault mapping)', () => {
  it('policies are canonical InspectionPolicy records for the §6.2 categories + the conservative fallback', () => {
    // PORTE-CUSTODY — founder ruling 2026-08-14 (decision b): the fourth row
    // is the conservative fallback for CATEGORY-LESS products — outer
    // packaging only, nothing category-specific claimed.
    expect(INSPECTION_POLICIES_V1.map((p) => p.inspectionCategory))
      .toEqual(['fashion_bags_fabrics', 'shoes', 'sealed_beauty', 'uncategorised_conservative']);
    expect(new Set(INSPECTION_POLICIES_V1.map((p) => p.version))).toEqual(new Set(['inspection-policy.v1']));
  });

  it('the conservative fallback (founder 2026-08-14, decision b) is OUTER-ONLY: no opening action, no category-specific claim', () => {
    const fallback = INSPECTION_POLICIES_V1.find((p) => p.inspectionCategory === 'uncategorised_conservative');
    expect(fallback).toBeDefined();
    expect(fallback?.sealRule).toBe('outer_only_conservative_no_opening');
    expect(fallback?.allowedActions).toEqual(['outer_only', 'visual_item', 'quantity', 'damage']);
    // Nothing that opens a box, tries anything on, or judges an inner seal.
    for (const opening of ['box_open', 'mfr_seal_intact', 'size_label', 'pair', 'condition']) {
      expect(fallback?.allowedActions).not.toContain(opening);
    }
    // …and it inspects: an accepted session parses canonically through it.
    expect(runDoorInspection(inspectionInput({ inspectionCategory: 'uncategorised_conservative' })).kind).toBe('accepted');
  });

  it('acceptance yields a canonical InspectionSession; unknown category and missing refusal column refuse closed', () => {
    expect(runDoorInspection(inspectionInput()).kind).toBe('accepted');
    expect(runDoorInspection(inspectionInput({ inspectionCategory: 'electronics' }))).toMatchObject({ kind: 'invalid', reason: 'category_not_in_policy' });
    expect(runDoorInspection(inspectionInput({ buyerAccepts: false }))).toMatchObject({ kind: 'invalid', reason: 'refusal_column_missing' });
  });

  it('DERIVED FAULT MAPPING: buyer-risk refusal → ladder change_of_mind; valid rejection → seller under an INTACT seal, sera under a BROKEN one', () => {
    expect(DOOR_FAULT_DERIVATION_V1.version).toBe('door-fault-derivation.v1');
    const invalid = runDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'buyer_risk' }));
    expect(invalid).toMatchObject({ kind: 'invalid_rejection', ladderReasonCode: 'change_of_mind' });
    const sellerFault = runDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'valid', custodySealIntact: true }));
    expect(sellerFault).toMatchObject({ kind: 'valid_rejection', faultClass: 'seller' });
    const seraFault = runDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'valid', custodySealIntact: false }));
    expect(seraFault).toMatchObject({ kind: 'valid_rejection', faultClass: 'sera' });
  });

  it('through the spine: a valid rejection emits the fault-attributed protection claim, opens the return (re-seal, chain verifies), NO fee, NO buyer ladder', () => {
    const spine = optionBSpine();
    const rejected = spine.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'valid', custodySealIntact: false }), T);
    expect(rejected).toMatchObject({ ok: true, kind: 'valid_rejection', faultClass: 'sera' });
    const claim = spine.allEvents().find((e) => e.name === 'protection.claim_opened.v1' && (e.payload as Record<string, unknown>)['source'] === 'door_inspection');
    expect(claim?.payload).toMatchObject({ faultClass: 'sera', rejection_reason: 'custody_seal_broken' });
    const opened = spine.openValidRejectionReturn({ returnSealId: 'rs-door-1', at: T2 });
    expect(opened.ok).toBe(true);
    expect(spine.returnFlowState()).toBe('opened');
    expect(spine.isFeeRetainedRecorded(CHAIN.order_id)).toBe(false); // never the buyer's fault
    expect(spine.ledger.verifyChain()).toEqual({ valid: true });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
  });

  it('through the spine: a buyer-risk refusal routes to the REAL WO-2.2 ladder as change_of_mind', () => {
    const spine = optionBSpine();
    const refused = spine.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'buyer_risk' }), T);
    expect(refused).toMatchObject({ ok: true, kind: 'invalid_rejection' });
    if (!refused.ok || refused.kind !== 'invalid_rejection') return;
    expect(refused.ladder).toMatchObject({ ok: true, outcome: { family: 'retry', reasonCode: 'change_of_mind', faultClass: 'buyer' } });
  });
});

describe('WO-2.4 items 2+3 — the door-payment custody gate (SE-I11), no rider assertion', () => {
  it('CUSTODY WITHOUT DOOR PAYMENT REFUSES CLOSED: drop code with accepted inspection but no provider signal → door_payment_not_confirmed', () => {
    const spine = optionBSpine();
    expect(spine.recordDoorInspection(inspectionInput(), T)).toMatchObject({ ok: true, kind: 'accepted' });
    expect(spine.confirmDropAndEmitEligibility('drop-1', T)).toEqual({ ok: false, reason: 'door_payment_not_confirmed' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
    expect(spine.allEvents().filter((e) => e.name === 'delivery.validated.v1')).toHaveLength(0);
  });

  it('INSPECT BEFORE PAY, PAY BEFORE CUSTODY (enforced): drop without inspection → inspection_not_accepted; signal before inspection → not awaited + alert', () => {
    const spine = optionBSpine();
    expect(spine.confirmDropAndEmitEligibility('drop-1', T)).toEqual({ ok: false, reason: 'inspection_not_accepted' });
    const early = spine.consumeDoorPaidSignal(doorSignal('cmd-early'), T);
    expect(early).toMatchObject({ ok: false, reason: 'door_signal_not_awaited' });
    if (early.ok) return;
    expect(early.alert?.name).toBe('reconciliation.alert.v1');
  });

  it('THE LAWFUL PATH, drop code LAST: inspect → provider signal → drop → custody customer + ONE eligibility signal; FULL_PREPAY untouched by the gate', () => {
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput(), T);
    expect(spine.consumeDoorPaidSignal(doorSignal(), T)).toEqual({ ok: true, duplicate: false });
    // wrong drop code still refuses AFTER payment (drop code is LAST, its own secret):
    expect(spine.confirmDropAndEmitEligibility('drop-WRONG', T)).toEqual({ ok: false, reason: 'drop_code_refused' });
    const confirmed = spine.confirmDropAndEmitEligibility('drop-1', T);
    expect(confirmed).toMatchObject({ ok: true, duplicate: false });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('customer');
    expect(spine.allEvents().filter((e) => e.name === 'delivery.validated.v1')).toHaveLength(1);
  });

  it('DUPLICATE door-paid signal ABSORBS — same command_id advances nothing twice (ledger count stable)', () => {
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput(), T);
    expect(spine.consumeDoorPaidSignal(doorSignal('cmd-dup'), T)).toEqual({ ok: true, duplicate: false });
    const before = spine.ledger.all().length;
    expect(spine.consumeDoorPaidSignal(doorSignal('cmd-dup'), T)).toEqual({ ok: true, duplicate: true });
    expect(spine.ledger.all().length).toBe(before);
    expect(spine.isDoorPaymentConfirmed()).toBe(true);
  });

  it('MISMATCH ALERT (item 5): a door signal on a FULL_PREPAY spine or a foreign order → reconciliation.alert.v1, state unmoved', () => {
    const prepay = new CustodySpine({ ...CHAIN, order_id: 'order-pp-1' }, 'sup-1'); // default FULL_PREPAY
    const onPrepay = prepay.consumeDoorPaidSignal(doorSignal('cmd-pp', 'order-pp-1'), T);
    expect(onPrepay).toMatchObject({ ok: false, reason: 'door_signal_not_awaited' });
    if (!onPrepay.ok) expect(onPrepay.alert?.payload).toMatchObject({ scenario: 'door_signal_mismatch', payment_mode: 'FULL_PREPAY' });
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput(), T);
    const foreign = spine.consumeDoorPaidSignal(doorSignal('cmd-f', 'order-OTHER'), T);
    expect(foreign).toMatchObject({ ok: false, reason: 'door_signal_not_awaited' });
    expect(spine.isDoorPaymentConfirmed()).toBe(false);
  });

  it('COLIS-FOURNISSEUR-1: a package collection pays this order only under a reference declared to it before — never on a prepaid file', () => {
    const collecte = (commandId: string, reference: string) => doorSignal(commandId, reference);
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput(), T);
    // Undeclared: the collection's reference is not this order's.
    expect(spine.consumeDoorPaidSignal(collecte('cmd-c1', 'grp-colis-porte-1'), T)).toMatchObject({ ok: false, reason: 'door_signal_not_awaited' });
    expect(spine.isDoorPaymentConfirmed()).toBe(false);
    // Another reference declared: still not this one.
    expect(spine.armDoorReference('grp-colis-porte-2')).toEqual({ ok: true, duplicate: false });
    expect(spine.consumeDoorPaidSignal(collecte('cmd-c2', 'grp-colis-porte-1'), T)).toMatchObject({ ok: false, reason: 'door_signal_not_awaited' });
    // Declared, and the provider names it: the door leg is paid.
    expect(spine.armDoorReference('grp-colis-porte-1')).toEqual({ ok: true, duplicate: false });
    expect(spine.armDoorReference('grp-colis-porte-1')).toEqual({ ok: true, duplicate: true });
    expect(spine.consumeDoorPaidSignal(collecte('cmd-c3', 'grp-colis-porte-1'), T)).toEqual({ ok: true, duplicate: false });
    expect(spine.isDoorPaymentConfirmed()).toBe(true);
    // A prepaid file owes nothing at the door: no reference is declared on it.
    const prepay = new CustodySpine({ ...CHAIN, order_id: 'order-pp-2' }, 'sup-1');
    expect(prepay.armDoorReference('grp-colis-porte-1')).toEqual({ ok: false, reason: 'door_leg_not_expected' });
  });

  it('NO RIDER ASSERTION: a malformed/renamed signal refuses; nothing but the canonical provider event advances the door state', () => {
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput(), T);
    expect(spine.consumeDoorPaidSignal({ riderSays: 'paid cash' }, T)).toEqual({ ok: false, reason: 'door_signal_invalid' });
    const renamed = { ...doorSignal('cmd-x'), name: 'delivery.validated.v1' };
    expect(spine.consumeDoorPaidSignal(renamed, T)).toEqual({ ok: false, reason: 'door_signal_invalid' });
    expect(spine.isDoorPaymentConfirmed()).toBe(false);
  });
});

describe('WO-2.4 item 4 — insufficient_balance END-TO-END through the door (the WO-2.2 machinery consumed)', () => {
  it('buyer cannot pay → ladder retry → expiry escalates → buyer-fault refusal (fee-retained record, re-seal, return) → two-key return home', () => {
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput(), T); // inspected fine — the money is the problem
    const refused = spine.recordDoorRefusal('insufficient_balance', T);
    expect(refused).toMatchObject({ ok: true, outcome: { family: 'retry', faultClass: 'buyer' } });
    expect(spine.escalateExpiredWindow(T2)).toMatchObject({ ok: true, outcome: { family: 'return' } });
    const applied = spine.applyBuyerFaultRefusal({ returnSealId: 'rs-ib-1', at: T2 });
    expect(applied).toMatchObject({ ok: true });
    expect(spine.isFeeRetainedRecorded(CHAIN.order_id)).toBe(true);
    expect(spine.armReturnKeys('sk-1', 'rk-1')).toEqual({ ok: true });
    expect(spine.completeReturnHandover('sk-1', 'rk-1', T2)).toMatchObject({ ok: true });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('seller:sup-1');
    expect(spine.ledger.verifyChain()).toEqual({ valid: true });
    // custody NEVER reached the customer; no eligibility signal exists:
    expect(spine.allEvents().filter((e) => e.name === 'delivery.validated.v1')).toHaveLength(0);
  });
});

describe('WO-2.4 item 6 — the shop door-paid emitter as a §3-misbehaving mock', () => {
  it('scores 8/8 — CERTIFIED', async () => {
    const card = await certifyAdapter(new ShopDoorPaymentEmitterMock(), { seed: 'wo24' });
    console.log(formatScorecard(card));
    expect(card.certified).toBe(true);
    expect(card.score).toBe(`${CERTIFICATION_BEHAVIORS.length}/${CERTIFICATION_BEHAVIORS.length}`);
  });

  it('the spine stays consistent when the emitter misbehaves: duplicated emission stream advances the door exactly once', async () => {
    const mock = new ShopDoorPaymentEmitterMock();
    const emission = await mock.emit('order-b-0001'.replace('order-', ''), { duplicate: true, outOfOrder: false, delayMs: 0, timeout: false, partialFailure: false });
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput(), T);
    let advances = 0;
    for (const { event } of emission.delivered) {
      if (event.name !== 'payment.door_leg_confirmed.v1') continue;
      const fixed = { ...event, payload: { ...(event.payload as Record<string, unknown>), order_id: CHAIN.order_id } };
      const outcome = spine.consumeDoorPaidSignal(fixed, T);
      if (outcome.ok && !outcome.duplicate) advances += 1;
    }
    expect(advances).toBe(1); // the duplicate absorbed — nothing double-advanced
    expect(spine.isDoorPaymentConfirmed()).toBe(true);
  });
});

describe("WO-2.4 verifier findings — the exact attacks, replayed as regression tests", () => {
  it('BLOCKING: a recorded valid rejection is FINAL — re-inspection, the signal, and the drop all refuse; no contradictory stream can exist', () => {
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'valid', custodySealIntact: true }), T);
    expect(spine.openValidRejectionReturn({ returnSealId: 'rs-b5', at: T })).toMatchObject({ ok: true });
    expect(spine.recordDoorInspection(inspectionInput(), T)).toEqual({ ok: false, reason: 'inspection_already_recorded' });
    // E2 gap closed: the refusal is still closed, but a SETTLED course now
    // answers by name so the at-least-once sender can stop carrying.
    expect(spine.consumeDoorPaidSignal(doorSignal('cmd-b5'), T)).toMatchObject({ ok: false, reason: 'door_signal_course_settled' });
    expect(spine.confirmDropAndEmitEligibility('drop-1', T)).toEqual({ ok: false, reason: 'return_in_progress' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
    expect(spine.allEvents().filter((e) => e.name === 'delivery.validated.v1')).toHaveLength(0);
  });

  it('NB②: a FOREIGN-order inspection cannot unlock this door — evidence_chain_mismatch', () => {
    const spine = optionBSpine();
    expect(spine.recordDoorInspection(inspectionInput({ orderId: 'order-FOREIGN' }), T))
      .toEqual({ ok: false, reason: 'evidence_chain_mismatch' });
    expect(spine.confirmDropAndEmitEligibility('drop-1', T)).toEqual({ ok: false, reason: 'inspection_not_accepted' });
  });

  it('NB⑥ (the WO-2.2 analog, closed by the same guard): after applyBuyerFaultRefusal the drop refuses on ANY payment mode', () => {
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput(), T);
    spine.recordDoorRefusal('insufficient_balance', T);
    spine.escalateExpiredWindow(T2);
    expect(spine.applyBuyerFaultRefusal({ returnSealId: 'rs-nb6', at: T2 })).toMatchObject({ ok: true });
    expect(spine.confirmDropAndEmitEligibility('drop-1', T2)).toEqual({ ok: false, reason: 'return_in_progress' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
  });

  it('NB④: a replayed not-awaited signal is alert-idempotent — one reconciliation.alert.v1 per command_id', () => {
    const spine = optionBSpine();
    const first = spine.consumeDoorPaidSignal(doorSignal('cmd-b7'), T);
    expect(first).toMatchObject({ ok: false, reason: 'door_signal_not_awaited' });
    const alerts = () => spine.allEvents().filter((e) => e.name === 'reconciliation.alert.v1').length;
    const after1 = alerts();
    expect(spine.consumeDoorPaidSignal(doorSignal('cmd-b7'), T)).toMatchObject({ ok: false, reason: 'door_signal_not_awaited' });
    expect(alerts()).toBe(after1);
  });
});

describe('E2 gap — a SETTLED course answers the door signal BY NAME, so the at-least-once sender can stop', () => {
  const settledAlerts = (spine: CustodySpine) =>
    spine.allEvents().filter((e) =>
      e.name === 'reconciliation.alert.v1' &&
      (e.payload as Record<string, unknown>)['scenario'] === 'door_paid_but_course_refused');

  it('VALID REJECTION recorded, then the provider truth arrives: door_signal_course_settled + the E3 refund-feedstock alert (fault named, fee NOT retained)', () => {
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'valid', custodySealIntact: true }), T);
    const settled = spine.consumeDoorPaidSignal(doorSignal('cmd-settle-1'), T);
    expect(settled).toMatchObject({ ok: false, reason: 'door_signal_course_settled' });
    if (settled.ok) return;
    expect(settled.alert?.name).toBe('reconciliation.alert.v1');
    expect(settled.alert?.payload).toMatchObject({
      scenario: 'door_paid_but_course_refused',
      order_id: CHAIN.order_id,
      fault_class: 'seller',
      fee_retained: false,
    });
    expect(spine.isDoorPaymentConfirmed()).toBe(false); // nothing advanced
  });

  it('the settled answer is ALERT-IDEMPOTENT per signal — a retried signal re-hears the name, never a second alert', () => {
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'valid', custodySealIntact: false }), T);
    expect(spine.consumeDoorPaidSignal(doorSignal('cmd-settle-2'), T)).toMatchObject({ ok: false, reason: 'door_signal_course_settled' });
    expect(settledAlerts(spine)).toHaveLength(1);
    expect(spine.consumeDoorPaidSignal(doorSignal('cmd-settle-2'), T)).toMatchObject({ ok: false, reason: 'door_signal_course_settled' });
    expect(settledAlerts(spine)).toHaveLength(1);
  });

  it('THE RACE, END TO END: paid before the accord was noted (not_awaited, carry on) → valid rejection recorded → the SAME signal now hears the terminal, one mismatch alert + one settled alert', () => {
    const spine = optionBSpine();
    const early = spine.consumeDoorPaidSignal(doorSignal('cmd-race-1'), T);
    expect(early).toMatchObject({ ok: false, reason: 'door_signal_not_awaited' });
    spine.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'valid', custodySealIntact: true }), T);
    const retry = spine.consumeDoorPaidSignal(doorSignal('cmd-race-1'), T2);
    expect(retry).toMatchObject({ ok: false, reason: 'door_signal_course_settled' });
    const alerts = spine.allEvents().filter((e) => e.name === 'reconciliation.alert.v1');
    expect(alerts.map((e) => (e.payload as Record<string, unknown>)['scenario']))
      .toEqual(['door_signal_mismatch', 'door_paid_but_course_refused']);
  });

  it('BUYER-FAULT RETURN (ladder expired, refusal applied) is settled too — fee_retained true rides the alert', () => {
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput(), T);
    spine.recordDoorRefusal('insufficient_balance', T);
    spine.escalateExpiredWindow(T2);
    expect(spine.applyBuyerFaultRefusal({ returnSealId: 'rs-settle-1', at: T2 })).toMatchObject({ ok: true });
    const settled = spine.consumeDoorPaidSignal(doorSignal('cmd-settle-3'), T2);
    expect(settled).toMatchObject({ ok: false, reason: 'door_signal_course_settled' });
    if (settled.ok) return;
    expect(settled.alert?.payload).toMatchObject({
      scenario: 'door_paid_but_course_refused',
      fault_class: 'buyer',
      fee_retained: true,
    });
  });

  it('the terminal never leaks where the course is NOT settled: a FOREIGN order and a FULL_PREPAY spine stay door_signal_not_awaited even with a rejection recorded', () => {
    const spine = optionBSpine();
    spine.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'valid', custodySealIntact: true }), T);
    const foreign = spine.consumeDoorPaidSignal(doorSignal('cmd-nf-1', 'order-OTHER'), T);
    expect(foreign).toMatchObject({ ok: false, reason: 'door_signal_not_awaited' });
    const prepay = new CustodySpine({ ...CHAIN, order_id: 'order-pp-2' }, 'sup-1'); // FULL_PREPAY — no door leg exists
    const onPrepay = prepay.consumeDoorPaidSignal(doorSignal('cmd-nf-2', 'order-pp-2'), T);
    expect(onPrepay).toMatchObject({ ok: false, reason: 'door_signal_not_awaited' });
  });
});

/**
 * RETOUR-CHANGEMENT-AVIS (founder ruling 2026-09-23, « 1 »; canon 3.21.0
 * Séra §6.4) — a change of mind on ONE article of a package, at its door, is
 * final at once: the buyer-fault return, no window, the fee retained when the
 * return opens. Only on an article custody was told travels in a package.
 */
describe('RETOUR-CHANGEMENT-AVIS — a change of mind on a package\'s article is final at once', () => {
  const avis = inspectionInput({ buyerAccepts: false, refusalColumn: 'buyer_risk', definitive: true });

  it('an article of a package: the buyer-fault return straight away (attempt 1, no window), then home with the fee retained', () => {
    const spine = optionBSpine(true);
    const r = spine.recordDoorInspection(avis, T);
    expect(r).toMatchObject({ ok: true, kind: 'invalid_rejection', ladder: { ok: true, outcome: { family: 'return', reasonCode: 'change_of_mind', faultClass: 'buyer', attempt: { number: 1, at: T } } } });
    const outcome = (r as { ladder: { outcome: { attempt: Record<string, unknown> } } }).ladder.outcome;
    expect(outcome.attempt['windowExpiresAt']).toBeUndefined();
    expect(spine.currentLadderOutcome()?.family).toBe('return');
    const opened = spine.openReturn({ returnSealId: 'rs-avis-1', at: T2 });
    expect(opened.ok).toBe(true);
    expect(spine.isFeeRetainedRecorded(CHAIN.order_id)).toBe(true);
    const refused = spine.allEvents().filter((e) => e.name === 'delivery.refused.v1');
    expect(refused.map((e) => e.payload)).toEqual([
      expect.objectContaining({ order_id: CHAIN.order_id, family: 'return', reason_code: 'change_of_mind', fault_class: 'buyer', fee_retained: true }),
    ]);
    expect(spine.returnFlowState()).toBe('opened');
  });

  it('a single order is refused by name, nothing recorded — its refusal keeps the one window', () => {
    const spine = optionBSpine(false);
    expect(spine.recordDoorInspection(avis, T)).toEqual({ ok: false, reason: 'change_of_mind_not_in_package' });
    expect(spine.currentLadderOutcome()).toBeNull();
    const fenetre = spine.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'buyer_risk' }), T);
    expect(fenetre).toMatchObject({ ok: true, kind: 'invalid_rejection', ladder: { ok: true, outcome: { family: 'retry' } } });
  });

  it('never over a window already open, and without `definitive` a package\'s article keeps the window', () => {
    const ouvert = optionBSpine(true);
    expect(ouvert.recordDoorRefusal('insufficient_balance', T)).toMatchObject({ ok: true });
    expect(ouvert.recordDoorInspection(avis, T)).toEqual({ ok: false, reason: 'ladder_already_open' });
    expect(ouvert.currentLadderOutcome()?.family).toBe('retry');
    const sansDefinitif = optionBSpine(true);
    expect(sansDefinitif.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'buyer_risk' }), T)).toMatchObject({
      ok: true, kind: 'invalid_rejection', ladder: { ok: true, outcome: { family: 'retry' } },
    });
  });

  it('verifier BLOCKER — her final choice is the one inspection: « kept » and « a problem » are refused by name, the same choice again is already recorded, nothing is handed over — never a seller\'s fault, never a fee given back', () => {
    for (const mode of ['DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR', 'FULL_PREPAY'] as const) {
      const spine = mode === 'FULL_PREPAY' ? prepaidColisSpine() : optionBSpine(true);
      expect(spine.recordDoorInspection(avis, T)).toMatchObject({ ok: true, kind: 'invalid_rejection' });
      expect(spine.recordDoorInspection(inspectionInput(), T), mode).toEqual({ ok: false, reason: 'change_of_mind_recorded' });
      expect(spine.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'valid' }), T), mode).toEqual({ ok: false, reason: 'change_of_mind_recorded' });
      expect(spine.recordDoorInspection(avis, T2), mode).toEqual({ ok: false, reason: 'inspection_already_recorded' });
      expect(spine.confirmDropAndEmitEligibility('drop-1', T2), mode).toEqual({ ok: false, reason: 'return_in_progress' });
      expect(spine.openReturn({ returnSealId: 'rs-avis-2', at: T2 }).ok, mode).toBe(true);
      const names = spine.allEvents().map((e) => e.name);
      expect(names, mode).not.toContain('protection.claim_opened.v1');
      expect(spine.allEvents().filter((e) => e.name === 'delivery.refused.v1').map((e) => e.payload), mode).toEqual([
        expect.objectContaining({ fault_class: 'buyer', fee_retained: true, reason_code: 'change_of_mind' }),
      ]);
    }
  });

  it('`definitive` on an accept or a valid refusal changes nothing', () => {
    const accepte = optionBSpine(true);
    expect(accepte.recordDoorInspection(inspectionInput({ definitive: true }), T)).toEqual({ ok: true, kind: 'accepted' });
    const valide = optionBSpine(true);
    expect(valide.recordDoorInspection(inspectionInput({ buyerAccepts: false, refusalColumn: 'valid', definitive: true }), T)).toMatchObject({ ok: true, kind: 'valid_rejection' });
    expect(valide.currentLadderOutcome()).toBeNull();
  });
});
