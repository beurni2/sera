import {
  CustodyLiabilityClaimSchema,
  type PaymentMode,
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
import { runDoorInspection, type DoorInspectionInput } from './door-flow.js';
import { checkProducerActor } from './actor-provenance.js';

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
  | 'order_already_delivered'
  | 'ladder_already_open'
  | 'no_buyer_fault_refusal'
  | 'return_seal_refused'
  | 'return_not_open'
  | 'return_two_key_refused'
  | 'door_payment_not_confirmed'
  | 'inspection_not_accepted'
  | 'door_signal_not_awaited'
  | 'door_signal_invalid'
  | 'no_valid_rejection'
  | 'inspection_already_recorded'
  | 'return_in_progress'
  | 'producer_actor_mismatch';

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
  /** WO-2.7 item 3 — the readiness/verification CYCLE. One pickup code per
   * cycle; a refused verification may open the NEXT cycle (the corrective
   * round-trip) with a NEW code. Attempt-keyed emissions ride this number. */
  private verificationCycle = 1;
  private lastVerificationRefused = false;
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
  /** WO-2.4 door state. Option-B (SE-I11): inspect BEFORE pay, pay BEFORE
   * custody — enforced in code, not documented. */
  private doorInspection: import('@platform/contracts').InspectionSession | null = null;
  private doorPaymentConfirmed = false;
  private readonly doorSignalCommandIds = new Set<string>();
  private readonly alertedSignalCommandIds = new Set<string>();
  private validRejection: { faultClass: string } | null = null;

  constructor(
    private readonly chain: ChainIds,
    private readonly supplierId: string,
    /** FULL_PREPAY by default — the E1 paths are untouched; the Option-B
     * door gate binds only when the task's mode says so. */
    private readonly paymentMode: PaymentMode = 'FULL_PREPAY',
  ) {}

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
   * the fault signal; custody never begins. WO-2.7 item 3: emissions are
   * keyed per ATTEMPT (order + verification cycle) so a genuine second
   * refusal after the corrective round-trip is a NEW event downstream can
   * count — while a replay of the SAME attempt still carries the same
   * command_id and dedupes. */
  verifyPickup(input: VerificationInput, presentedPickupCode: string, at: string) {
    /**
     * ⚠ THE SHAPE IS JUDGED BEFORE THE CODE IS SPENT (2026-08-09).
     *
     * The single-use `pickupVerificationCode` used to be consumed FIRST, and
     * an unjudgeable check list then returned `invalid` — after the code was
     * already burned. `SecretRegistry.register` refuses to re-arm a spent
     * secret, and `openNewVerificationCycle` only re-arms after a *refused*
     * verification, never an *invalid* one. So the order became permanently
     * unverifiable, with no route to recover it.
     *
     * That was survivable while one build talked to one policy. Policy v2
     * (founder ruling, three photo-referenced questions) makes it REACHABLE
     * IN PRODUCTION: this service stamps the ACTIVE policy while the rider's
     * app owns the question list, and the founder must install a NEW native
     * build for the audio — so a phone still asking v1's nine questions will
     * exist. Every one of its pickups would have burned a code and stranded
     * an order.
     *
     * `runPickupVerification` is PURE and reads only the submitted list, so
     * running it first leaks nothing an attacker could not already read: the
     * app ships the same list. What it buys is that a mismatched build costs
     * a refusal the rider can retry, not a package nobody can ever take.
     */
    const outcome = runPickupVerification(input);
    if (outcome.kind === 'invalid') return outcome;
    const code = this.secrets.consume('pickup_verification_code', input.orderId, presentedPickupCode, at, this.verificationCycle);
    if (!code.ok) {
      return { kind: 'invalid' as const, reason: 'pickup_code_refused' as const, detail: code.reason };
    }
    const attempt = this.verificationCycle;
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'pickup_verification',
      payload: { result: outcome.verification.result, orderId: input.orderId, attempt },
      at,
    });
    this.emit('pickup.verification_recorded.v1', `verify-${input.orderId}-a${attempt}`, {
      order_id: input.orderId,
      task_id: this.chain.task_id,
      result: outcome.verification.result,
      attempt,
    }, at);
    if (outcome.kind === 'refused') {
      this.lastVerificationRefused = true;
      this.emit('protection.claim_opened.v1', `fault-${input.orderId}-a${attempt}`, {
        order_id: input.orderId,
        faultClass: outcome.faultSignal.faultClass,
        failed_checks: [...outcome.failedChecks],
        attempt,
      }, at);
      return outcome; // custody never begins; NO refund, NO settlement mutation exists here
    }
    this.verificationAccepted = true;
    return outcome;
  }

  /**
   * WO-2.7 item 3 — the corrective round-trip re-arms verification: ONLY
   * after a REFUSED verification (custody never began) may the next cycle
   * open, with a NEW pickup code. The spent code stays spent (four-secrets
   * law untouched); the new cycle's emissions carry the next attempt number.
   */
  openNewVerificationCycle(newPickupCode: string, _at: string):
    | { ok: true; cycle: number }
    | { ok: false; reason: 'no_refused_verification' | 'verification_already_accepted' | 'secret_already_used' } {
    if (this.verificationAccepted) return { ok: false, reason: 'verification_already_accepted' };
    if (!this.lastVerificationRefused) return { ok: false, reason: 'no_refused_verification' };
    const nextCycle = this.verificationCycle + 1;
    const armed = this.secrets.register('pickup_verification_code', this.chain.order_id, newPickupCode, nextCycle);
    if (!armed.ok) return { ok: false, reason: 'secret_already_used' };
    this.verificationCycle = nextCycle;
    this.lastVerificationRefused = false;
    return { ok: true, cycle: nextCycle };
  }

  currentVerificationCycle(): number {
    return this.verificationCycle;
  }

  /** VRAI-ROUTE (founder, 2026-08-10) — does the courier hold custody RIGHT
   *  NOW, as this spine's own replayed state says? The transit routes gate on
   *  it: « en route » before the seal would be a journey claim about a package
   *  Séra does not hold. Read-only; no route may write through this. */
  courierHoldsCustody(): boolean {
    return this.custodyWithCourier;
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
    /**
     * ═══ ⚠ FOUNDER OVERRIDE (2026-08-10) — THE SEAL PHOTO IS NO LONGER
     * REQUIRED, AND THE SEAL IS NO LONGER A SCREEN ═══
     *
     * « I told you terminate that sealing code and the sealing photo proof
     * requirement. I told you after the code is confirmed from supplier the
     * next screen is prendre la route then the je suis arrivé screen then the
     * asking code from buyer screen. » Reaffirmed after I quoted the governing
     * text back to him; recorded in JOURNAL.md as HIS decision, not mine.
     *
     * WHAT THIS DEPARTS FROM, NAMED EXACTLY. Sera Build Spec §6.2 step 6
     * (« `custodySealId` + package photos recorded ») and the guard that stood
     * here, whose reason was « a seal with no photo proves nothing ». SE-I05
     * itself is UNTOUCHED — « Custody begins only after rider pickup
     * verification AND custody-seal registration » still holds in full: the
     * verification must still be `accepted` (line above), the seal id is still
     * registered, still single-use, still equality-checked against the
     * delivery evidence at the door. What is gone is the PHOTO half of §6.2
     * step 6, and only that.
     *
     * WHAT STILL PROVES THE PICKUP. The rider's checklist (§6.1 objective
     * conformity) is unchanged and still gated on `accepted`; the supplier's
     * readiness photos ride the course; the optional difference-photo on the
     * verification screen is still offered; and the DELIVERY photo at the door
     * is untouched and still mandatory. The custody record keeps its
     * `photoRefs` field — now often empty, never fabricated. A7's real lesson
     * survives intact: an EMPTY list is honest, a made-up `ev-<uuid>` is not,
     * and nothing anywhere invents a ref.
     *
     * The CI gate `custody-after-verification-and-seal`
     * (`scripts/gates/custody-transition.mjs`) asserts verification-accepted +
     * seal-registered and has never asserted photos — it stays green, and it
     * stays the thing that fails if anyone tries to begin custody without a
     * verification or without a seal.
     */

    let seal = this.secrets.consume('custody_seal', this.chain.order_id, args.custodySealId, args.at);
    if (!seal.ok && seal.reason === 'secret_unknown') {
      /**
       * FIRST-USE BINDING (founder program 2026-08-10 — the real end-to-end
       * loop). The seal is a PHYSICAL sticker: nobody can pre-arm the number
       * of the one this rider will peel off the roll, so a per-order pre-arm
       * made every real delivery wait on a founder curl. SE-I05 demands seal
       * REGISTRATION — and the seal is not one of §5.6's four secrets — so
       * registration IS this: the digest the rider's authenticated hand
       * presented is bound here, photographed beside it, logged below, and
       * equality-checked AGAIN at delivery evidence. A pre-armed seal (the
       * founder's hand) still wins when present: this branch runs only when
       * nothing was armed, and a mismatch against an armed seal refuses
       * exactly as before.
       */
      const bound = this.secrets.register('custody_seal', this.chain.order_id, args.custodySealId);
      if (!bound.ok) return { ok: false, reason: 'seal_already_used' };
      seal = this.secrets.consume('custody_seal', this.chain.order_id, args.custodySealId, args.at);
    }
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

  /**
   * Step 12b — ValidationDecision (SE5.3).
   *
   * ═══ ⚠ PORTE-SANS-PHOTO (founder ruling 2026-08-10) — « for the door photo I
   * want it gone » ═══
   *
   * WHAT THIS USED TO DO, AND WHY IT WAS AN INTERPRETATION, NOT THE SPEC.
   * It read `const gpsOnly = bundle.artifacts.length === 0` and held any
   * photo-less bundle for review with the reason `gps_never_sole_proof`. But
   * the governing text is SE-I07 (Spec l.39): « **Location is supporting
   * evidence, not proof. No verdict rests solely on GPS.** » It forbids a
   * verdict resting SOLELY ON GPS. It nowhere requires an artifact — the
   * equation « no photo ⇒ GPS only » was this line's own reading.
   *
   * WHAT CARRIES THE VERDICT NOW, and why SE-I07 is intact rather than waived:
   * the `buyerDropCode`, consumed at `confirmDropAndEmitEligibility` below. It
   * is a secret only the BUYER holds, presented by the buyer at the door, and
   * a carrier can never present it for them (the rider door has no
   * `/delivery/decide`, and the code is single-use at the registry). A verdict
   * standing on that does not rest on GPS at all — it rests on the one party
   * whose word the whole delivery is for. That is a STRONGER non-GPS leg than
   * a photograph, which proves only that a camera was pointed at something.
   *
   * SO THE SPEC TEXT IS UNCHANGED and needs no amendment: no canon document is
   * edited by this ruling, and the four byte-identical copies of
   * `Sera-Build-Spec.md` do not move.
   *
   * WHAT IS GENUINELY LOST, named rather than buried: the door no longer
   * produces an IMAGE of the handover. Nothing here fabricates one to fill the
   * gap — `artifactCount` simply records 0.
   *
   * ⚠ AND WHAT MUST NOT BE READ INTO THIS: the bundle is still REQUIRED
   * (`validation_before_evidence`, one line down), still chain-bound and
   * seal-bound at `submitDeliveryEvidence`, and the drop still refuses without
   * the buyer's code. « No photo » never becomes « no evidence ».
   */
  decideValidation(at: string):
    | { ok: true; decision: ValidationDecision; event: PlatformEvent | null }
    | { ok: false; reason: SpineRefusal } {
    if (this.evidenceSubmitted === null) return { ok: false, reason: 'validation_before_evidence' };
    const bundle = this.evidenceSubmitted;
    const result = 'validated';
    const reasons: readonly string[] = [];
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
    // Verifier blocking finding + NB⑥ (both WOs' analog closed with one
    // guard): a recorded rejection or an in-flight return means the package
    // goes HOME — the drop can never complete against it, any payment mode.
    if (this.validRejection !== null || this.returnFlow !== null) {
      return { ok: false, reason: 'return_in_progress' };
    }
    // SE-I11 (payment-before-handoff), enforced: on Option-B, custody MUST
    // NOT transfer before the provider-confirmed door payment — and the
    // payment stage itself required an accepted inspection first.
    if (this.paymentMode === 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR') {
      if (this.doorInspection?.inspectionResult !== 'accepted') {
        return { ok: false, reason: 'inspection_not_accepted' };
      }
      if (!this.doorPaymentConfirmed) return { ok: false, reason: 'door_payment_not_confirmed' };
    }
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
      // SE-LIVE-5 — THE SIGNAL CARRIES THE SUPPLIER (SE-I09 kept intact: an
      // IDENTITY, never an amount — Séra still computes no proceeds). Shop+'s
      // OrderOrigin left its supplierRef deliberately empty with the words
      // « it must carry the supplier with it rather than find a guess here »;
      // this chain is the one place that provably knows who held the goods.
      supplier_ref: this.supplierId,
    }, at);
    this.eligibilityEmittedForOrder.add(this.chain.order_id);
    // Verifier blocking finding (WO-2.2): delivery CLOSES courier custody —
    // the stale flag once let the refusal ladder and the two-key return run
    // on a DELIVERED order, yanking custody off the customer and recording
    // fee-retained against a settlement-eligible order.
    this.custodyWithCourier = false;
    return { ok: true, duplicate: false, events: [e1, e2] };
  }

  // ── WO-2.4 — Option-B door flow (SE5.1/§6.3; SE-I11) ─────────────────────

  /**
   * Doorstep inspection against versioned policy data (Shop+ §6.2 matrix).
   * accepted → (Option-B) unlocks the payment stage; invalid rejection →
   * the WO-2.2 ladder (change_of_mind, derived); valid rejection → fault
   * DERIVED from the custody seal (seller if intact, sera if broken),
   * protection claim emitted — NEVER the buyer ladder, NEVER a fee.
   */
  recordDoorInspection(input: DoorInspectionInput, at: string):
    | { ok: true; kind: 'accepted' }
    | { ok: true; kind: 'invalid_rejection'; ladder: ReturnType<CustodySpine['recordDoorRefusal']> }
    | { ok: true; kind: 'valid_rejection'; faultClass: string }
    | { ok: false; reason: SpineRefusal | 'category_not_in_policy' | 'refusal_column_missing' } {
    if (this.eligibilityEmittedForOrder.has(this.chain.order_id)) {
      return { ok: false, reason: 'order_already_delivered' };
    }
    if (!this.custodyWithCourier) return { ok: false, reason: 'custody_not_with_courier' };
    // Verifier blocking finding (WO-2.4): ONE inspection per delivery
    // attempt — a recorded outcome (accepted OR rejected) can never be
    // overwritten, and an open return closes the door for good.
    if (this.doorInspection !== null || this.validRejection !== null) {
      return { ok: false, reason: 'inspection_already_recorded' };
    }
    if (this.returnFlow !== null) return { ok: false, reason: 'return_in_progress' };
    // Verifier NB②: the inspection binds to THIS order, like every other
    // piece of evidence in the spine.
    if (input.orderId !== this.chain.order_id) return { ok: false, reason: 'evidence_chain_mismatch' };
    const outcome = runDoorInspection(input);
    if (outcome.kind === 'invalid') return { ok: false, reason: outcome.reason };
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'validation_decision',
      payload: { result: 'door_inspection_recorded', inspectionResult: outcome.session.inspectionResult, category: outcome.session.inspectionCategory },
      at,
    });
    if (outcome.kind === 'accepted') {
      this.doorInspection = outcome.session;
      return { ok: true, kind: 'accepted' };
    }
    if (outcome.kind === 'invalid_rejection') {
      // Buyer-risk refusal → the ordinary-buyer-fault ladder class (derived).
      const ladder = this.recordDoorRefusal(outcome.ladderReasonCode, at);
      return { ok: true, kind: 'invalid_rejection', ladder };
    }
    // Valid rejection: fault-attributed protection claim (§6.5), no ladder,
    // no fee. The canonical reasonCode for this arm does NOT exist at canon
    // v0.5.0 — gap flagged in derivations/door-inspection-fault-mapping.md.
    this.validRejection = { faultClass: outcome.faultClass };
    this.emit('protection.claim_opened.v1', `door-claim-${this.chain.order_id}`, {
      order_id: this.chain.order_id,
      faultClass: outcome.faultClass,
      source: 'door_inspection',
      rejection_reason: outcome.session.rejectionReason ?? 'refused_valid',
    }, at);
    return { ok: true, kind: 'valid_rejection', faultClass: outcome.faultClass };
  }

  /** A valid rejection sends the package home: re-seal + return flow, NO
   * fee retention (the fault is the seller's or Séra's, never the buyer's). */
  openValidRejectionReturn(args: { returnSealId: string; at: string }):
    | { ok: true; events: readonly PlatformEvent[] }
    | { ok: false; reason: SpineRefusal } {
    if (this.validRejection === null) return { ok: false, reason: 'no_valid_rejection' };
    if (!this.custodyWithCourier) return { ok: false, reason: 'custody_not_with_courier' };
    const sealArmed = this.secrets.register('return_seal', this.chain.order_id, args.returnSealId);
    if (!sealArmed.ok) return { ok: false, reason: 'return_seal_refused' };
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'custody_seal_registered',
      payload: { sealKind: 'return_seal' },
      at: args.at,
    });
    const refused = this.emit('delivery.refused.v1', `door-valid-rejection-${this.chain.order_id}`, {
      order_id: this.chain.order_id,
      task_id: this.chain.task_id,
      rejection: 'valid_rejection',
      fault_class: this.validRejection.faultClass,
    }, args.at);
    this.returnFlow = { state: 'opened', returnSealId: args.returnSealId };
    const returnRequested = this.emit('return.logistics_requested.v1', `return-open-${this.chain.order_id}`, {
      order_id: this.chain.order_id, task_id: this.chain.task_id, package_id: this.chain.package_id,
    }, args.at);
    return { ok: true, events: [refused, returnRequested] };
  }

  /**
   * THE door-payment signal (SE-I11): only the provider-confirmed
   * `payment.door_leg_confirmed.v1` advances the door state — no rider
   * assertion exists anywhere. Duplicates absorb on command_id (no
   * double-advance). A signal for a task NOT awaiting door payment →
   * reconciliation.alert.v1 (provider truth vs local state) and a closed
   * refusal. Séra stores NO amount from the payload (SE-I09).
   */
  consumeDoorPaidSignal(raw: unknown, at: string):
    | { ok: true; duplicate: boolean }
    | { ok: false; reason: SpineRefusal; alert?: PlatformEvent } {
    const parsed = PlatformEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.name !== 'payment.door_leg_confirmed.v1') {
      return { ok: false, reason: 'door_signal_invalid' };
    }
    const event = parsed.data;
    // WO-2.7 item 1 (WO-2.4 NB③): actor provenance — the door-paid signal
    // may only arrive from the payment-provider class. Wrong actor →
    // REFUSED CLOSED + reconciliation.alert.v1 (idempotent per command_id).
    // In-process layer; E3 adds transport-level webhook authenticity on top.
    const provenance = checkProducerActor(event.name, event.envelope.actor);
    if (!provenance.ok) {
      if (this.alertedSignalCommandIds.has(event.envelope.command_id)) {
        return { ok: false, reason: 'producer_actor_mismatch' };
      }
      this.alertedSignalCommandIds.add(event.envelope.command_id);
      const alert = this.emit('reconciliation.alert.v1', `actor-mismatch-${event.envelope.command_id}`, {
        scenario: 'producer_actor_mismatch',
        event_name: event.name,
        order_id: this.chain.order_id,
        actor: event.envelope.actor,
        expected_class: provenance.expectedClass,
        actor_class: provenance.actorClass ?? 'unclassified',
      }, at);
      return { ok: false, reason: 'producer_actor_mismatch', alert };
    }
    if (this.doorSignalCommandIds.has(event.envelope.command_id)) {
      return { ok: true, duplicate: true }; // absorbed — nothing advances twice
    }
    const payloadOrder = (event.payload as Record<string, unknown>)['order_id'];
    const awaiting =
      this.paymentMode === 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR' &&
      payloadOrder === this.chain.order_id &&
      this.doorInspection?.inspectionResult === 'accepted' &&
      this.validRejection === null &&
      this.returnFlow === null &&
      !this.doorPaymentConfirmed &&
      !this.eligibilityEmittedForOrder.has(this.chain.order_id);
    if (!awaiting) {
      // Verifier NB④: the alert path is idempotent per signal — a replayed
      // not-awaited signal does not mint a second identical alert.
      if (this.alertedSignalCommandIds.has(event.envelope.command_id)) {
        return { ok: false, reason: 'door_signal_not_awaited' };
      }
      this.alertedSignalCommandIds.add(event.envelope.command_id);
      const alert = this.emit('reconciliation.alert.v1', `door-mismatch-${event.envelope.command_id}`, {
        scenario: 'door_signal_mismatch',
        order_id: this.chain.order_id,
        signal_order_id: typeof payloadOrder === 'string' ? payloadOrder : 'unknown',
        payment_mode: this.paymentMode,
        inspection_accepted: this.doorInspection?.inspectionResult === 'accepted',
      }, at);
      return { ok: false, reason: 'door_signal_not_awaited', alert };
    }
    this.doorSignalCommandIds.add(event.envelope.command_id);
    this.doorPaymentConfirmed = true;
    this.ledger.append({
      packageId: this.chain.package_id,
      kind: 'validation_decision',
      payload: { result: 'door_payment_confirmed', command_id: event.envelope.command_id },
      at,
    });
    return { ok: true, duplicate: false };
  }

  isDoorPaymentConfirmed(): boolean {
    return this.doorPaymentConfirmed;
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
    // A delivered order is TERMINAL for the ladder — refuse by name, not by
    // side effect (verifier blocking finding).
    if (this.eligibilityEmittedForOrder.has(this.chain.order_id)) {
      return { ok: false, reason: 'order_already_delivered' };
    }
    if (!this.custodyWithCourier) return { ok: false, reason: 'refusal_before_custody' };
    // ONE retry window, ever (Sera §6.4; verifier NB①/②): re-recording a
    // refusal — to mint a fresh window, slide expiry, or swap the reason
    // before fault applies — refuses closed.
    if (this.ladderOutcome !== null) return { ok: false, reason: 'ladder_already_open' };
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
    // The buyer settled inside the window and the drop completed → the
    // order is terminal; the expired window escalates NOTHING.
    if (this.eligibilityEmittedForOrder.has(this.chain.order_id)) {
      return { ok: false, reason: 'order_already_delivered' };
    }
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
