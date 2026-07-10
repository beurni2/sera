import {
  CustodyLiabilityClaimSchema,
  EvidenceBundleSchema,
  PlatformEventSchema,
  ValidationDecisionSchema,
  type CustodyLiabilityClaim,
  type DeliveryOutcome,
  type EvidenceBundle,
  type PlatformEvent,
  type ValidationDecision,
} from '@platform/contracts';
import { CustodyLedger } from './custody-ledger.js';
import { SecretRegistry } from './secret-registry.js';
import { runPickupVerification, type VerificationInput } from './pickup-verification-policy.js';
import { openRetryWindow, resolveExpiredWindow, type LadderRefusal } from './refusal-ladder.js';

/**
 * E1 CUSTODY SPINE (Contract §2.3 steps 11–13; SE4.3 + SE5.3) — single
 * rider, single package. Custody begins ONLY after {verification accepted +
 * custody seal registered (single-use, hashed) + evidence refs}; the buyer
 * drop code comes LAST and only after a `validated` ValidationDecision;
 * ONLY `validated` emits the settlement-eligibility SIGNAL — exactly once
 * per order, idempotent under replays. hold/rejected emit their events and
 * release NOTHING. There are NO failure terminals here (retry/reschedule/
 * return are E2): everything not explicitly allowed REFUSES CLOSED with a
 * structured reason. Séra never computes proceeds and never mutates
 * settlement — the signal is the entire output.
 */

export type SpineRefusal =
  | 'verification_not_accepted'
  | 'seal_missing_or_mismatched'
  | 'seal_already_used'
  | 'order_ref_mismatch'
  | 'actor_separation_supplier_is_rider'
  | 'no_evidence_refs'
  | 'custodian_conflict'
  | 'custody_not_with_courier'
  | 'evidence_not_canonical'
  | 'evidence_chain_mismatch'
  | 'evidence_seal_mismatch'
  | 'offline_never_final'
  | 'not_validated'
  | 'drop_code_refused'
  | 'validation_before_evidence'
  | 'unknown_transition'
  | 'evidence_already_submitted'
  | 'refusal_before_custody'
  | 'no_buyer_fault_refusal'
  | 'return_seal_refused'
  | 'return_not_open'
  | 'return_two_key_refused';

export interface ChainIds {
  order_id: string;
  task_id: string;
  package_id: string;
  correlation_id: string;
}

export class CustodySpine {
  readonly ledger = new CustodyLedger();
  readonly secrets = new SecretRegistry();
  private readonly events: PlatformEvent[] = [];
  private aggregateVersion = 0;
  private verificationAccepted = false;
  private custodyWithCourier = false;
  /** The ONE seal consumed at beginCustody — evidence must bind to it by
   * equality (WO-2.1 finding ①). */
  private registeredSealId: string | null = null;
  private evidenceSubmitted: EvidenceBundle | null = null;
  private decision: ValidationDecision | null = null;
  private eligibilityEmittedForOrder = new Set<string>();
  private pendingOfflineEvidence: unknown[] = [];
  /** WO-2.2: the current ladder outcome (always a canonical DeliveryOutcome). */
  private ladderOutcome: DeliveryOutcome | null = null;
  /** WO-2.2: fee-retained is a RECORD, never a movement (SE §6.4). */
  private feeRetainedForOrder = new Set<string>();
  private returnFlow: { state: 'opened' | 'closed'; returnSealId: string } | null = null;
  private readonly liabilityClaims: CustodyLiabilityClaim[] = [];

  constructor(private readonly chain: ChainIds, private readonly supplierId: string) {}

  private emit(name: PlatformEvent['name'], command_id: string, payload: Record<string, unknown>, at: string): PlatformEvent {
    this.aggregateVersion += 1;
    const event = PlatformEventSchema.parse({
      name,
      envelope: {
        command_id,
        correlation_id: this.chain.correlation_id,
        aggregateVersion: this.aggregateVersion,
        actor: 'custody-service:e1',
        serverTime: at,
        version: '1',
      },
      payload,
    });
    this.events.push(event);
    return event;
  }

  allEvents(): readonly PlatformEvent[] {
    return this.events;
  }

  /** Step 11a — bounded verification (SE4.2). The rider's pickup code is a
   * single-use hashed secret consumed HERE — replay refused. A refusal emits
   * the fault signal; custody never begins. */
  verifyPickup(input: VerificationInput, presentedPickupCode: string, at: string) {
    const code = this.secrets.consume('pickup_verification_code', input.orderId, presentedPickupCode, at);
    if (!code.ok) {
      return { kind: 'invalid' as const, reason: 'pickup_code_refused' as const, detail: code.reason };
    }
    const outcome = runPickupVerification(input);
    if (outcome.kind === 'invalid') return outcome;
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'pickup_verification',
      payload: { result: outcome.verification.result, orderId: input.orderId },
      at,
    });
    this.emit('pickup.verification_recorded.v1', `verify-${input.orderId}`, {
      order_id: input.orderId,
      task_id: this.chain.task_id,
      result: outcome.verification.result,
    }, at);
    if (outcome.kind === 'refused') {
      this.emit('protection.claim_opened.v1', `fault-${input.orderId}`, {
        order_id: input.orderId,
        faultClass: outcome.faultSignal.faultClass,
        failed_checks: [...outcome.failedChecks],
      }, at);
      return outcome; // custody never begins; NO refund, NO settlement mutation exists here
    }
    this.verificationAccepted = true;
    return outcome;
  }

  /** Step 11b — seal-after-verification custody transition (SE4.3). */
  beginCustody(args: {
    riderId: string;
    verificationOrderId: string;
    custodySealId: string;
    sealPhotoRefs: readonly string[];
    at: string;
  }): { ok: true; events: readonly PlatformEvent[] } | { ok: false; reason: SpineRefusal } {
    if (!this.verificationAccepted) return { ok: false, reason: 'verification_not_accepted' };
    if (args.verificationOrderId !== this.chain.order_id) return { ok: false, reason: 'order_ref_mismatch' };
    if (args.riderId === this.supplierId) return { ok: false, reason: 'actor_separation_supplier_is_rider' };
    if (args.sealPhotoRefs.length === 0) return { ok: false, reason: 'no_evidence_refs' };
    const seal = this.secrets.consume('custody_seal', this.chain.order_id, args.custodySealId, args.at);
    if (!seal.ok) {
      return { ok: false, reason: seal.reason === 'secret_already_used' ? 'seal_already_used' : 'seal_missing_or_mismatched' };
    }
    const sealEntry = this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'custody_seal_registered',
      payload: { photoRefs: [...args.sealPhotoRefs] },
      at: args.at,
    });
    if (!sealEntry.ok) return { ok: false, reason: 'custodian_conflict' };
    const transition = this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'custody_transition',
      payload: { from: `seller:${this.supplierId}`, to: `courier:${args.riderId}` },
      at: args.at,
    });
    if (!transition.ok) return { ok: false, reason: 'custodian_conflict' };
    const e1 = this.emit('pickup.custody_seal_registered.v1', `seal-${this.chain.order_id}`, {
      order_id: this.chain.order_id, package_id: this.chain.package_id,
    }, args.at);
    const e2 = this.emit('custody.transferred_to_courier.v1', `custody-courier-${this.chain.order_id}`, {
      order_id: this.chain.order_id, package_id: this.chain.package_id, rider_id: args.riderId,
    }, args.at);
    this.custodyWithCourier = true;
    this.registeredSealId = args.custodySealId;
    return { ok: true, events: [e1, e2] };
  }

  /**
   * The ledger must exist for custody to have begun — the seller must
   * establish first custody before pickup can transfer it.
   */
  establishSellerCustody(at: string): void {
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'custody_transition',
      payload: { to: `seller:${this.supplierId}` },
      at,
    });
  }

  /** Step 12a — delivery evidence. OFFLINE evidence is queued = PENDING: no validation, no custody effect. */
  submitDeliveryEvidence(raw: unknown, confirmation: 'server_confirmed' | 'queued_offline', at: string):
    | { ok: true; pending: false; bundle: EvidenceBundle }
    | { ok: true; pending: true }
    | { ok: false; reason: SpineRefusal } {
    if (!this.custodyWithCourier) return { ok: false, reason: 'custody_not_with_courier' };
    // WO-2.1 NB② closed: a second submission after a SUCCESSFUL one refuses
    // — no double-append, no re-emitted event with the same command_id.
    if (this.evidenceSubmitted !== null) return { ok: false, reason: 'evidence_already_submitted' };
    if (confirmation === 'queued_offline') {
      // Kernel offline law: queued = pending, never done — NEVER final
      // custody/delivery offline. Nothing downstream can see this bundle.
      this.pendingOfflineEvidence.push(raw);
      return { ok: true, pending: true };
    }
    const parsed = EvidenceBundleSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'evidence_not_canonical' };
    // WO-2.1 finding ① — evidence-to-chain binding (SE-I11: evidence only
    // ever SUPPORTS a decision, and it supports THIS delivery alone).
    // Before any ValidationDecision can exist, the bundle must bind BY
    // EQUALITY to the task's chain ids and to the seal registered at
    // beginCustody. A foreign bundle is REFUSED CLOSED: no ledger entry, no
    // event, nothing downstream. (The canonical EvidenceBundle carries
    // task/package/seal ids; order binding is transitive — the ChainIds
    // record is one immutable unit. A bundle MISSING a binding field never
    // reaches here: the strict schema already refused it.)
    if (parsed.data.taskId !== this.chain.task_id || parsed.data.packageId !== this.chain.package_id) {
      return { ok: false, reason: 'evidence_chain_mismatch' };
    }
    if (this.registeredSealId === null || parsed.data.custodySealId !== this.registeredSealId) {
      return { ok: false, reason: 'evidence_seal_mismatch' };
    }
    this.evidenceSubmitted = parsed.data;
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'delivery_evidence',
      payload: { taskId: parsed.data.taskId, artifactCount: parsed.data.artifacts.length },
      at,
    });
    this.emit('delivery.evidence_submitted.v1', `evidence-${this.chain.order_id}`, {
      order_id: this.chain.order_id, task_id: this.chain.task_id,
    }, at);
    return { ok: true, pending: false, bundle: parsed.data };
  }

  hasPendingOfflineEvidence(): boolean {
    return this.pendingOfflineEvidence.length > 0;
  }

  /** Step 12b — ValidationDecision (SE5.3). GPS-only can NEVER validate. */
  decideValidation(at: string):
    | { ok: true; decision: ValidationDecision; event: PlatformEvent | null }
    | { ok: false; reason: SpineRefusal } {
    if (this.evidenceSubmitted === null) return { ok: false, reason: 'validation_before_evidence' };
    const bundle = this.evidenceSubmitted;
    const gpsOnly = bundle.artifacts.length === 0;
    const result = gpsOnly ? 'review_hold' : 'validated';
    const reasons = gpsOnly ? ['gps_never_sole_proof'] : [];
    const decision = ValidationDecisionSchema.parse({ taskId: bundle.taskId, result, reasons });
    this.decision = decision;
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'validation_decision',
      payload: { result, reasons },
      at,
    });
    // `validated` emits NO public event here: the ONE delivery.validated.v1
    // for an order is the settlement-eligibility signal at step 13 (after
    // drop code) — two same-name events with different command_ids would
    // double-apply at any correct consumer. A hold emits its event now and
    // RELEASES NOTHING.
    if (result === 'validated') {
      return { ok: true, decision, event: null };
    }
    const event = this.emit('delivery.held_for_review.v1', `decision-${this.chain.order_id}`, {
      order_id: this.chain.order_id,
      task_id: this.chain.task_id,
      validation_id: `val-${this.chain.order_id}`,
      result,
      reasons,
    }, at);
    return { ok: true, decision, event };
  }

  /**
   * A held bundle resolved by operations to `rejected` (canon enum) — emits
   * its event, releases NOTHING, and is NOT a terminal order state (what
   * follows a rejection is E2's failure-complete work). Resolution to
   * validated-after-review is likewise E2 — unrepresentable here.
   */
  resolveHoldAsRejected(reasons: string[], at: string):
    | { ok: true; decision: ValidationDecision; event: PlatformEvent }
    | { ok: false; reason: SpineRefusal } {
    if (this.decision?.result !== 'review_hold') return { ok: false, reason: 'unknown_transition' };
    const decision = ValidationDecisionSchema.parse({
      taskId: this.evidenceSubmitted?.taskId ?? this.chain.task_id,
      result: 'rejected',
      reasons,
    });
    this.decision = decision;
    this.ledger.append({ packageId: this.chain.package_id, kind: 'validation_decision', payload: { result: 'rejected', reasons }, at });
    const event = this.emit('delivery.refused.v1', `rejected-${this.chain.order_id}`, {
      order_id: this.chain.order_id, task_id: this.chain.task_id, result: 'rejected', reasons,
    }, at);
    return { ok: true, decision, event };
  }

  /**
   * Step 13 — drop code LAST, only after `validated`; custody→customer; the
   * settlement-eligibility SIGNAL emits exactly once per order.
   */
  confirmDropAndEmitEligibility(presentedDropCode: string, at: string):
    | { ok: true; duplicate: false; events: readonly PlatformEvent[] }
    | { ok: true; duplicate: true; events: readonly [] }
    | { ok: false; reason: SpineRefusal } {
    if (this.eligibilityEmittedForOrder.has(this.chain.order_id)) {
      return { ok: true, duplicate: true, events: [] }; // exactly once — replay absorbs
    }
    if (this.decision?.result !== 'validated') return { ok: false, reason: 'not_validated' };
    if (!this.custodyWithCourier) return { ok: false, reason: 'custody_not_with_courier' };
    const code = this.secrets.consume('buyer_drop_code', this.chain.order_id, presentedDropCode, at);
    if (!code.ok) return { ok: false, reason: 'drop_code_refused' };
    const transition = this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'custody_transition',
      payload: { from: this.ledger.currentCustodian(this.chain.package_id), to: 'customer' },
      at,
    });
    if (!transition.ok) return { ok: false, reason: 'custodian_conflict' };
    const e1 = this.emit('custody.transferred_to_customer.v1', `custody-customer-${this.chain.order_id}`, {
      order_id: this.chain.order_id, package_id: this.chain.package_id,
    }, at);
    // THE settlement-eligibility signal — chain ids intact, NO amounts
    // (SE-I09: Séra never computes proceeds; commerce-core copies from the
    // Quote on its side).
    const e2 = this.emit('delivery.validated.v1', `eligibility-${this.chain.order_id}`, {
      order_id: this.chain.order_id,
      task_id: this.chain.task_id,
      validation_id: `val-${this.chain.order_id}`,
      result: 'validated',
      settlement_eligibility: true,
    }, at);
    this.eligibilityEmittedForOrder.add(this.chain.order_id);
    return { ok: true, duplicate: false, events: [e1, e2] };
  }

  // ── WO-2.2 — E2 failure flows (SE6.1/§6.4/§6.5) ──────────────────────────

  /**
   * §6.4 refusal at the door — the FIRST refusal opens the ONE retry window
   * (canonical DeliveryOutcome, family `retry`, windowExpiresAt honest).
   * Only a courier-held package can be refused at a door.
   */
  recordDoorRefusal(reasonCode: string, at: string):
    | { ok: true; outcome: DeliveryOutcome }
    | { ok: false; reason: SpineRefusal }
    | LadderRefusal {
    if (!this.custodyWithCourier) return { ok: false, reason: 'refusal_before_custody' };
    const step = openRetryWindow({ taskId: this.chain.task_id, orderId: this.chain.order_id, reasonCode, at });
    if (!step.ok) return step;
    this.ladderOutcome = step.outcome;
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'validation_decision',
      payload: { result: 'door_refusal_recorded', family: step.outcome.family, reasonCode: step.outcome.reasonCode },
      at,
    });
    return { ok: true, outcome: step.outcome };
  }

  /**
   * The window expired unresolved → the ladder proceeds (§6.4): escalating
   * codes → family `return` (buyer-fault); honest absence / provider
   * failure / unusable location → family `reschedule`. Both arms are
   * canonical DeliveryOutcomes; neither is a terminal.
   */
  escalateExpiredWindow(now: string):
    | { ok: true; outcome: DeliveryOutcome }
    | { ok: false; reason: SpineRefusal }
    | LadderRefusal {
    if (this.ladderOutcome === null) return { ok: false, reason: 'no_buyer_fault_refusal' };
    const step = resolveExpiredWindow({ retryOutcome: this.ladderOutcome, now });
    if (!step.ok) return step;
    this.ladderOutcome = step.outcome;
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'validation_decision',
      payload: { result: 'ladder_escalation', family: step.outcome.family, reasonCode: step.outcome.reasonCode },
      at: now,
    });
    return { ok: true, outcome: step.outcome };
  }

  /**
   * §6.4 buyer-fault refusal, applied: delivery fee RETAINED (a record —
   * Séra emits signals, never amounts), item RE-SEALED in the return bag
   * with a NEW return-seal (old seal was consumed at pickup; ledger
   * continuity, custodian unchanged), structured reason + faultClass=buyer
   * emitted, return flow opened.
   */
  applyBuyerFaultRefusal(args: { returnSealId: string; at: string }):
    | { ok: true; outcome: DeliveryOutcome; events: readonly PlatformEvent[] }
    | { ok: false; reason: SpineRefusal } {
    const outcome = this.ladderOutcome;
    if (outcome === null || outcome.family !== 'return' || outcome.faultClass !== 'buyer') {
      return { ok: false, reason: 'no_buyer_fault_refusal' };
    }
    if (!this.custodyWithCourier) return { ok: false, reason: 'custody_not_with_courier' };
    const sealArmed = this.secrets.register('return_seal', this.chain.order_id, args.returnSealId);
    if (!sealArmed.ok) return { ok: false, reason: 'return_seal_refused' };
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'custody_seal_registered',
      payload: { sealKind: 'return_seal' },
      at: args.at,
    });
    this.feeRetainedForOrder.add(this.chain.order_id);
    const refused = this.emit('delivery.refused.v1', `door-refusal-${this.chain.order_id}`, {
      order_id: this.chain.order_id,
      task_id: this.chain.task_id,
      family: outcome.family,
      reason_code: outcome.reasonCode,
      fault_class: outcome.faultClass,
      fee_retained: true,
    }, args.at);
    this.returnFlow = { state: 'opened', returnSealId: args.returnSealId };
    const returnRequested = this.emit('return.logistics_requested.v1', `return-open-${this.chain.order_id}`, {
      order_id: this.chain.order_id,
      task_id: this.chain.task_id,
      package_id: this.chain.package_id,
    }, args.at);
    return { ok: true, outcome, events: [refused, returnRequested] };
  }

  isFeeRetainedRecorded(orderId: string): boolean {
    return this.feeRetainedForOrder.has(orderId);
  }

  returnFlowState(): 'opened' | 'closed' | null {
    return this.returnFlow?.state ?? null;
  }

  /** Arm the SE6.2 two-key handover secrets (single-use, hashed at rest). */
  armReturnKeys(sellerAcceptanceSecret: string, riderConfirmationSecret: string):
    | { ok: true }
    | { ok: false; reason: 'secret_already_used' } {
    const seller = this.secrets.register('seller_return_acceptance', this.chain.order_id, sellerAcceptanceSecret);
    if (!seller.ok) return seller;
    const rider = this.secrets.register('rider_return_confirmation', this.chain.order_id, riderConfirmationSecret);
    if (!rider.ok) return rider;
    return { ok: true };
  }

  /**
   * SE6.2 two-key return handover — custody preserved the whole way home:
   * the rider stays custodian until BOTH keys (seller return-acceptance +
   * rider confirmation) consume, both-or-neither. Only then does custody
   * transition courier→seller and the return flow close. A single-key
   * attempt refuses and burns nothing.
   */
  completeReturnHandover(presentedSellerKey: string, presentedRiderKey: string, at: string):
    | { ok: true; event: PlatformEvent }
    | { ok: false; reason: SpineRefusal; detail?: string } {
    if (this.returnFlow?.state !== 'opened') return { ok: false, reason: 'return_not_open' };
    if (!this.custodyWithCourier) return { ok: false, reason: 'custody_not_with_courier' };
    const keys = this.secrets.consumeTwoKeys(
      { kind: 'seller_return_acceptance', orderId: this.chain.order_id, presented: presentedSellerKey },
      { kind: 'rider_return_confirmation', orderId: this.chain.order_id, presented: presentedRiderKey },
      at,
    );
    if (!keys.ok) {
      return { ok: false, reason: 'return_two_key_refused', detail: `${keys.failedKey}:${keys.reason}` };
    }
    const transition = this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'custody_transition',
      payload: { from: this.ledger.currentCustodian(this.chain.package_id), to: `seller:${this.supplierId}` },
      at,
    });
    if (!transition.ok) return { ok: false, reason: 'custodian_conflict' };
    this.custodyWithCourier = false;
    this.returnFlow = { ...this.returnFlow, state: 'closed' };
    const event = this.emit('custody.returned_to_supplier.v1', `return-close-${this.chain.order_id}`, {
      order_id: this.chain.order_id, package_id: this.chain.package_id,
    }, at);
    return { ok: true, event };
  }

  /**
   * §6.5: Séra-caused product loss/damage on return → a canonical
   * CustodyLiabilityClaim RECORD (strict-parsed; the amount is
   * dispatcher-DECLARED input — Séra computes nothing) — never any form of
   * fund movement. Claims exist only while a return flow exists.
   */
  fileCustodyLiabilityClaim(raw: unknown, at: string):
    | { ok: true; claim: CustodyLiabilityClaim; event: PlatformEvent }
    | { ok: false; reason: SpineRefusal | 'claim_not_canonical' } {
    if (this.returnFlow === null) return { ok: false, reason: 'return_not_open' };
    const parsed = CustodyLiabilityClaimSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'claim_not_canonical' };
    this.liabilityClaims.push(parsed.data);
    const event = this.emit('custody_liability.claim_opened.v1', `liability-${this.chain.order_id}-${this.liabilityClaims.length}`, {
      order_id: parsed.data.orderId,
      cause: parsed.data.cause,
      evidence_bundle_id: parsed.data.evidenceBundleId,
    }, at);
    return { ok: true, claim: parsed.data, event };
  }

  allLiabilityClaims(): readonly CustodyLiabilityClaim[] {
    return [...this.liabilityClaims];
  }

  /**
   * WO-2.1 NB④ closed under the founder's HARD REQUIREMENT: the offline
   * queue drains EXCLUSIVELY through submitDeliveryEvidence's
   * server_confirmed path — every queued bundle faces the same strict parse
   * and chain/seal binding as a live submission. There is no other exit
   * from the queue.
   */
  flushOfflineEvidence(at: string): {
    drained: number;
    accepted: number;
    refusals: { reason: SpineRefusal }[];
  } {
    const queued = this.pendingOfflineEvidence.splice(0, this.pendingOfflineEvidence.length);
    let accepted = 0;
    const refusals: { reason: SpineRefusal }[] = [];
    for (const raw of queued) {
      const outcome = this.submitDeliveryEvidence(raw, 'server_confirmed', at);
      if (outcome.ok && !outcome.pending) accepted += 1;
      else if (!outcome.ok) refusals.push({ reason: outcome.reason });
    }
    return { drained: queued.length, accepted, refusals };
  }
}
