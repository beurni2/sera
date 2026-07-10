import {
  EvidenceBundleSchema,
  PlatformEventSchema,
  ValidationDecisionSchema,
  type EvidenceBundle,
  type PlatformEvent,
  type ValidationDecision,
} from '@platform/contracts';
import { CustodyLedger } from './custody-ledger.js';
import { SecretRegistry } from './secret-registry.js';
import { runPickupVerification, type VerificationInput } from './pickup-verification-policy.js';

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
  | 'offline_never_final'
  | 'not_validated'
  | 'drop_code_refused'
  | 'validation_before_evidence'
  | 'unknown_transition';

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
  private evidenceSubmitted: EvidenceBundle | null = null;
  private decision: ValidationDecision | null = null;
  private eligibilityEmittedForOrder = new Set<string>();
  private pendingOfflineEvidence: unknown[] = [];

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
    if (confirmation === 'queued_offline') {
      // Kernel offline law: queued = pending, never done — NEVER final
      // custody/delivery offline. Nothing downstream can see this bundle.
      this.pendingOfflineEvidence.push(raw);
      return { ok: true, pending: true };
    }
    const parsed = EvidenceBundleSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'evidence_not_canonical' };
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
}
