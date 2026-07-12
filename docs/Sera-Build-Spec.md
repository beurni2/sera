# Séra — Professional Build Specification (v3)
### Delivery operations, dispatch, custody & field evidence. Boutik+ × Shop+ × Séra.
**Status:** Implementation baseline · **Version:** 3.0 · **Audience:** product, design, engineering, ops, risk, finance, support · **Repo:** `sera`

> **v3 change:** now normative — **rider pickup verification (bounded scope) + seal-after-verification custody**, the **Option-B doorstep product-payment flow** with a **signed break-glass HandoffAuthorization**, the **decomposed delivery-cost model**, **staged fleet-release gates**, and Séra's role in the **Protection Fund / custody-liability** split.
>
> Séra moves the correct sealed package from the verified supplier to the intended customer through accountable human dispatch, one-current-custodian custody, explicit verification before custody, and evidence strong enough to support — but not force — settlement. **Séra never touches product money and never marks anyone paid.**
>
> **Normative language.** MUST/MUST NOT/SHOULD/MAY/OWNER/PRECONDITION/FAILURE STATE/EVIDENCE as standard.

---

## 1. Scope & boundaries
- Séra MUST provide: courier workforce lifecycle, shifts/vehicles, funded-and-ready task intake, human dispatch, route manifests, no-street-address navigation, **package-readiness-gated pickup**, **rider pickup verification**, **custody-seal registration**, **doorstep product-payment handoff (Option B)**, delivery evidence, custody, failed-attempt/return, safety/SOS, fleet ops, payroll projections.
- Séra MUST NOT own product/catalog, order economics, payment funds, commission, buyer checkout, or settlement calculation.
- Séra delivery evidence MUST NOT directly mark a payout paid.
- Courier compensation MUST be payroll/incentive rules **separate** from buyer delivery fees and participant settlement.
- Courier access to customer phone/location MUST be just-in-time, task-scoped, expiring.

---

## 2. Surfaces, users & permissions
Rider app / courier (own shift, assigned route/tasks, scoped contact, **pickup verification**, evidence, SOS; MUST NOT: prices/payouts, unassigned data, self-assign, **self-declared completion**, **accept a buyer's screenshot/SMS/verbal/pending as payment proof**, **accept payment into a personal account**) · dispatch console / dispatcher (assign/reassign, exceptions, **break-glass handoff verification**; MUST NOT: ledger/refund/payout edits) · **authorized payment operator** (verify provider transactions, issue break-glass authorizations; MUST NOT: fabricate custody or authorize on unverified evidence) · ops/fleet manager · HR/payroll (maker-checker).

---

## 3. Rider information architecture (one current stop)
**Travail · Itinéraire · Sécurité · Profil.** Travail = shift + current stop (**Commencer service / execute next step**, incl. **pickup verification** and **doorstep payment wait**). Itinéraire = landmark-first nav + ordered stops. Sécurité = SOS/incident/vehicle. Profil = certification, documents, device, payroll.

---

## 4. Core invariants
- **SE-I01:** Exactly **one assignment authority** per task; a courier MUST NOT self-assign.
- **SE-I02:** Only **funded (per payment mode: full for FULL_PREPAY, delivery fee for Option B), supplier-ready (readiness confirmed), non-cancelled** tasks may enter the dispatch queue.
- **SE-I03:** A courier has **at most one active RouteManifest and one current stop**.
- **SE-I04:** Every package has **exactly one current custodian**; task status alone MUST NOT be custody truth.
- **SE-I05 (verify-then-seal-then-custody):** Custody begins only after **rider pickup verification** (objective conformity) **AND** **custody-seal registration**. Pickup also requires assigned session + `pickupVerificationCode`. Delivery requires assigned session + `buyerDropCode` + same custody seal + evidence + (Option B) a **provider-confirmed door payment**.
- **SE-I06:** Offline evidence may be queued, but **custody/delivery validation + financial release remain pending until authoritative server ack**.
- **SE-I07:** **Location is supporting evidence, not proof.** No verdict rests solely on GPS.
- **SE-I08:** Courier location collected **only on shift/active task**; buyer sees coarse progress.
- **SE-I09:** Séra **never** computes proceeds, **never** holds product funds, **never** marks paid.
- **SE-I10:** Every failed-delivery reason produces an **explicit** retry/return/cancellation/support/incident behavior. **No generic failed terminal state.**
- **SE-I11 (payment-before-handoff):** For Option B, **custody MUST NOT transfer to the buyer before an authoritative provider-confirmed door payment** (or a signed break-glass `HandoffAuthorization`). A rider MUST NOT accept a screenshot/SMS/verbal/pending as proof, and MUST NOT accept payment into any personal account.
- **SE-I12 (bounded verification):** Riders verify **objective, observable conformity only** — not authenticity, quality, hidden defects, performance, ingredients, warranty, or shade match.

---

## 5. Platform foundation & shared contracts  *(canonical — identical across all three specs; must match)*

### 5.1 Kernel
Phone-alias identity (phone is an alias, never the key); **no-street-address Location** `{pin,zone,landmark,directions,maskedRelay}` + gazetteer (the no-address primitive lives here); French-first i18n (Mooré/Dioula) + audio notes — all user-facing strings follow the **French Voice Standard** (Execution Contract §10.5: money-register calm/precise, selling-register Ouaga-warm, 6th-grade reading level, copy-lint enforced); offline-first (queued = pending, **never final custody/delivery**); media pipeline; shared types.

### 5.2 Domain ownership (LOGICAL)
Catalog · Media · Offer&Pricing · Inventory · Storefront&Attribution · Checkout&Order · Fulfillment&Package · **Logistics&Dispatch (OWNED)** · **Custody (OWNED)** · **Evidence&Validation (OWNED)** · Ledger&Settlement (money + Protection Fund) · **Payments (licensed aggregator + break-glass verification)** · Risk/Moderation · Consent/Notification · Analytics. Ownership boundaries, co-deployable; **no app writes another domain's truth.** Séra is the operational surface for Logistics/Custody/Evidence; others are read-only consumers. Séra MUST NOT create buyer orders, set prices, compute payouts, hold funds, or mark anyone paid.

### 5.3 Tech
Expo/RN rider app (offline-first, low-end Android, **background location only on shift**); web dispatch + ops console. Cloudflare **Workers + Durable Objects** (**single atomic assignment lease**, custody transitions, **append-only hash-chained custody/evidence ledger**, idempotency); Neon; R2 (evidence + restricted docs). **No platform funds here.** No AI/ML, **no route-optimization/ETA model** (dispatch is human; deterministic nearest-available suggestion only).

### 5.4 Canonical money model (NORMATIVE — Séra reads delivery + amountDueAtDelivery only)
Let **B**=base, **C**=commission, **M**=markup, **D**=delivery. `productSubtotal = B + M`; `buyerTotal = B + M + D`; `sellerNet = B − C − 0.05B`; `resellerNet = 0.80(C+M)`; `platformProductFeeRevenue = 0.05B + 0.20(C+M)`. **Reconciliation (CI):** `productSubtotal = sellerNet + resellerNet + platformProductFeeRevenue`; `buyerTotal = productSubtotal + D`. Séra sees **`deliveryFee` and (Option B) `amountDueAtDelivery`** for the doorstep flow — never commission or splits.

### 5.5 Payment modes & the money/custody boundary (Séra drives the middle)
`paymentMode ∈ {FULL_PREPAY, DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR}`. **Dispatch gate (SE-I02):** funded per mode. **Boundary:** fund legs → provider hold → reserve → **seller readiness** → **dispatch (single lease)** → **rider pickup verification (before custody)** → **rider applies/witnesses custody seal → custody begins** → transit (one current stop) → arrival + **buyer inspection (category rules, dwell 2–4 min)** → [**Option B:** buyer pays product leg → **authoritative provider confirmation** → **HandoffAuthorization**] → **custody → customer** (`buyerDropCode` entered last) → **ValidationDecision** → settlement **eligible**. **Evidence supports, never releases; a rider code/photo/GPS/self-declaration alone MUST NOT release money.** Courier wages/fuel are workforce obligations, **not splits of customer money**.

### 5.6 Canonical objects (identical everywhere)
```
User · Location · Order{ ..., paymentMode, resellerId(LOCKED), dropoff:Location, escrowRef, status }
DeliveryFeeQuote{ zoneFrom, zoneTo, fee, serviceable, version }                                   // OWNED here → Checkout
Quote{ ..., paymentMode, deliveryFee, amountDueAtDelivery, campaignId?, campaignBenefit?{customerShare,campaignShare}, sellerNet, resellerNet, platformProductFeeRevenue, policyVersions, expiry } // IMMUTABLE — canonical shape, identical across all three specs; PackLab fields ride the DeliveryTask/package context, never the Quote (B+9 version bump only)
Package/Seal{ packageId, sellerReadyPackaging, custodySealId, orderLineSnapshot, status }
PackageReadinessConfirmation{ orderId, photoRef, readinessChallenge, qty, variant, availableConfirmed, at }
PickupTask/DeliveryTask{ id, orderId, type, location, window, status, assignmentLeaseRef, routeRef }
AssignmentLease{ taskId, holder, riderId, version, status }                                        // exactly one active
RouteManifest{ id, riderId, version, orderedStops[], custodyInventory[], status }
PickupVerification{ orderId, riderId, checks[], result(accepted|refused), rejectionReason, custodySealId, evidenceBundleId }
InspectionPolicy{ version, inspectionCategory, allowedActions[], sealRule, dwellTargetSec }
InspectionSession{ orderId, inspectionCategory, packageOpened, manufacturerSealOpened, startedAt, completedAt,
                   inspectionResult, rejectionReason, faultAssignment, evidenceBundleId }
CustodyRecord{ packageId, currentCustodian, transitions[], exception? }                            // exactly one current custodian
EvidenceBundle{ taskId, packageId, custodySealId, artifacts[], coarseLocation?, capturedAt }
HandoffAuthorization{ orderId, riderId, buyerRef, exactAmount, providerTransactionReference,
                   authorizationSource(provider_webhook|break_glass), authorizedBy, authorizationExpiresAt,
                   authorizationConsumedAt, authorizationReason, breakGlassCaseId, signature,
                   state(requested|operator_verifying|provider_confirmed|issued|consumed|expired|voided) }
ValidationDecision{ taskId, result(validated|review_hold|rejected), reasons[] }
SettlementObligation{ orderId, party, amount(locked), state, payoutRef, holds[] }                  // owned by Ledger&Settlement
EscrowTxn{ orderId, provider, paymentLegs[{legType(checkout|door), collectRef, amount, fee, status}], status, splitBreakdown, payoutRefs[] }
ProtectionFund{ openingFundCapital, availableProtectionBalance, committedClaimsAmount,
                fundSolvencyState(HEALTHY|WATCH|RESTRICTED|CRITICAL), allocationPolicy{byCategory,byZone,bySellerTier}, ... } // Ledger&Settlement
ProtectionClaim{ orderId, reason, amount, faultClass(seller|sera|payment_provider|buyer|platform_system|unresolved), evidenceBundleId, state }
CustodyLiabilityClaim{ orderId, cause(sera_loss|sera_damage), amount, evidenceBundleId, state }     // Séra-caused; separate
DeliveryCost{ orderId, directDeliveryCost, returnDeliveryCost, allocatedFleetOverhead, allocatedDispatchOverhead,
              fullyLoadedDeliveryCost, deliveryFunding, deliveryContributionMargin }               // OWNED here + Analytics
RiderProfile · RiderShift · Motorcycle{ fleetTranche } · DispatchSession · SosEvent · IncidentCase
```
**Four distinct, non-substitutable secrets:** `sellerReadinessChallenge` · `pickupVerificationCode` · `buyerDropCode` (**private — never shown to the seller**) · `HandoffAuthorization`.

### 5.7 Events
`courier.certified/restricted.v1` · `shift.started/closed.v1` · `vehicle.checked_out/maintenance_due.v1` · `logistics.task_ready.v1` · `pickup.assigned.v1` · `assignment.declined/expired.v1` · `route.assigned/accepted/stop_started/stop_completed/reordered.v1` · `pickup.verification_recorded.v1(result)` · `pickup.custody_seal_registered.v1` · `custody.transferred_to_courier/transferred_to_customer/returned_to_supplier.v1` · `payment.door_leg_confirmed.v1` · `handoff.authorized.v1(source)` · `delivery.evidence_submitted/validated/held_for_review/refused.v1(reasonCode,fault)` · `return.logistics_requested.v1` · `package.lost/damaged.v1` · `custody_liability.claim_opened.v1` · `protection.claim_opened.v1(faultClass)` · `safety.sos_created/acknowledged.v1` · `incident.opened.v1`.

### 5.8 Cross-cutting invariants (all three apps; CI-enforced)
No app holds funds/computes others' amounts · money model reconciles; delivery outside fee bases · single-level · deterministic only (**no route-ML**) · price-free assets · **one current custodian; evidence ≠ release; custody only after pickup verification + custody-seal** · **custody transfers only after provider-confirmed legs; no personal-account payments; the four secrets never substituted** · exactly one assignment authority; atomic/idempotent assignment · zero seller deposit; buyer refund never fund-gated; solvency-throttled dispatch never delays refunds · French default; offline = pending, never final custody/delivery · phone is an alias.

---

## 6. Pickup verification, seal & doorstep handoff (NORMATIVE — Séra core)

### 6.1 Bounded pickup verification (`PickupVerificationPolicy`, versioned)
Rider verifies **only objective, quickly observable** facts against the locked order: order reference · basic product identity · listed variant · colour · size **label** · quantity · visible damage · included pieces · external manufacturer seal · custody-seal ID. Riders **do NOT** determine authenticity, material quality, cosmetic genuineness, hidden defects, performance, ingredients, warranty, or shade-vs-photo match. **Policy states (buyer-facing where relevant):** *« La vérification à l'enlèvement réduit les erreurs évidentes ; elle ne certifie pas l'authenticité, la qualité, la performance, ni les défauts cachés. »* **Target dwell ≈ 2–4 min**; over-target is an ops signal. On mismatch/damage → **rider refuses custody, buyer refunded (never fund-gated), order fails pre-round-trip; only the pickup-attempt cost is lost** (Protection Fund, `faultClass = seller`).

### 6.2 Seal-after-verification sequence
1. Seller provides item in **prepared, inspectable outer packaging** + readiness (`sellerReadinessChallenge`). 2. Task dispatched only after readiness approval. 3. Rider verifies (§6.1). 4. Rider places item in **final delivery packaging**. 5. Rider **applies/witnesses the tamper-evident Séra custody seal**. 6. `custodySealId` + package photos recorded. 7. **Custody transfers to Séra.** 8. Sealed package proceeds. Manufacturer-sealed cosmetics: verify **external** seal **without opening**. **Invariant: Séra custody begins only after pickup verification AND custody-seal registration.**

### 6.3 Doorstep handoff — Option B (payment before custody)
At delivery the rider displays identity, presents the sealed package; buyer inspects under the **category matrix** (Shop+ §6.2). For acceptance under Option B: buyer pays `amountDueAtDelivery` via **Mobile Money to the aggregator merchant collection (never a personal account)** → backend receives **authoritative provider confirmation** → **HandoffAuthorization** issued → rider hands over → **buyer enters `buyerDropCode` last** → evidence → **ValidationDecision**. **Break-glass (dead-zone) path:** an **authorized payment operator** verifies the transaction on an **authoritative provider interface**, records `providerTransactionReference`, backend validates order/amount/leg/status and issues a **signed, single-use `HandoffAuthorization`** bound to `{orderId, riderId, buyerRef, exactAmount, providerTransactionReference, expiresAt}`; `authorizationSource = break_glass` opens a **`breakGlassCaseId`** for **mandatory incident review**. **A rider handoff requires a validated, unconsumed authorization.** Screenshot/SMS/verbal/pending/unverified-reference can **never** set `provider_confirmed`.

### 6.4 Insufficient funds / refusal at the door
One retry window (~15 min; agent top-up allowed) → then **buyer-fault refusal**: delivery fee retained, item re-sealed in a **return bag with a new return-seal**, structured reason recorded, return flow. Ladder + eligibility per Shop+ §6.4. Séra never becomes an informal cashier or arbiter.

### 6.5 Failed delivery & return
Structured reasons + evidence; dispatcher applies retry/reschedule/return/incident; **custody stays with courier/hub until a supplier two-key return handoff + inspection**; **no generic failed terminal; package never unowned**; refund/cancellation consume reason + evidence; **no refund/release from a Séra direct command**. Fault attributed on every claim; Séra-caused product loss/damage → **`CustodyLiabilityClaim`**, not a Protection-Fund payout.

### 6.7 Handling classes for PackLab packs (Boutik+ PackLab — safe custody of engineered baskets)
A `PLATFORM_OWNED` PackLab pack may carry a **`HandlingClass`** (e.g. `SHARP_OBJECT_SAFE_PACKAGING_REQUIRED` for Pack Cuisine Départ's knives). Rules: **(1)** the class is set at kitting (Boutik+ B+9) and rides the order to the rider as a **handling flag** — carried on the **DeliveryTask / package context (sourced from Product/Version), never on the immutable Quote**: a kitting seal does not even exist at quote time, and any shared-shape fields enter `contracts/` only by deliberate version bump behind the B+9 gate. The flag governs packaging and handling discipline, **never a delivery ban**. **(2)** At pickup, the pack arrives **kitting-sealed** (kit → QC → seal-at-kitting) rather than seller-prepared; the rider's objective-conformity check treats the kitting seal as the external seal, and a broken/absent kitting seal → **refuse custody** exactly like any pickup-verification failure. **(3)** At the door, the class sets **safe at-door inspection** — the buyer can verify pack contents (category inspection matrix) **without unsafe handling** (e.g. no exposed blade); sharp/fragile items stay secured through inspection. **(4)** Handling classes never change the custody chain, the seal-after-verification rule, or the fault-code protocol — they are a packaging/handling overlay, not a new custody path.

### 6.6 Campaign-funded delivery benefits (Shop+ Cercle — Séra is a price authority, never a risk-taker)
A Shop+ Cercle campaign may fund part or all of a buyer's delivery fee. Rules: **(1)** the authoritative `DeliveryFeeQuote` is the only price — a campaign can fund it, never redefine it; `customerShare + campaignShare == quote`, and the **campaign share counts toward the SE-I02 funded-dispatch gate** exactly like buyer money. **(2)** Campaign funding for a delivery benefit is **committed at dispatch** (the attempt cost is incurred), so Séra is never exposed to campaign solvency mid-mission. **(3) Fully-free delivery ⇒ FULL_PREPAY orders only**; reduced delivery may serve both payment modes when the customer share meets the published commitment floor — the buyer-refusal ladder and `PayAtDoorEligibility` are never overridden by a campaign. **(4)** `ScheduledDeliveryCluster{campaignId, zone, window}` is a **grouping aid for the human dispatcher** (same-zone, same-window single jobs); custody, one-current-stop, and the no-operational-batching-until-E6 rule are unchanged — campaigns are priced from real scheduled-window quotes, never assumed batching savings. **(5)** Riders see only the funded delivery context and any `amountDueAtDelivery` — never campaign math.

---

## 7. Fleet, dispatch & delivery-cost model (NORMATIVE)

### 7.1 Delivery-cost decomposition (no single "fully-loaded" number)
`directDeliveryCost` (successful; rider time-share + electricity + failed-attempt-amortized) · `directDeliveryCost` (attempted) · `returnDeliveryCost` (outbound + return) · `allocatedFleetOverhead` (depreciation, **battery-replacement reserve**, maintenance, tyres/brakes, insurance, registration, theft/accident reserve, rider phone/data, charging infra, downtime, supervision, support/reconciliation — amortized per delivery, **counted once**) · `allocatedDispatchOverhead` · `fullyLoadedDeliveryCost = direct + allocated` · `deliveryContributionMargin = D − directDeliveryCost`. **Report low/base/high ranges**, never a single optimistic figure. Ecosystem contribution subtracts allocated overhead separately to avoid double-counting.

### 7.2 Staged fleet-release gates
**Start with 3–5 electric motorcycles, not 15.** A next tranche of ~5 is released **only** when: **≥8 deliveries/moto/day sustained ~2 weeks**, **failed-delivery rate < 8%**, **positive delivery contribution**, and a charging/battery-spare plan is in place. **The fleet follows validated order density; the business MUST NOT generate unprofitable orders to justify idle motorcycles.** `Motorcycle.fleetTranche` gates activation.

---

## 8. Capabilities (Séra deltas; SE1–SE9 retained)
- **SE1 Onboarding/certification/shift** — unchanged; certified + on-shift + server-confirmed before assignable.
- **SE2 Ready-queue & dispatch** — **funded per payment mode + readiness-confirmed**; single atomic lease; deterministic candidate; override w/ reason; no auto-assigner; no ETA-ML.
- **SE3 Route manifest & one-current-stop** — **single-job in pilot (no operational batching until E6)**; data model batch-capable; one active route/current stop; package accounted at close; end-shift-with-custody exception.
- **SE4 Landmark-first nav & masked relay** — unchanged; no street address; access expires.
- **SE5 Supplier pickup, verification & custody seal** — §6.1–6.2; two-party; single-use codes hashed; wrong package fails closed; **custody only after verification + seal**.
- **SE6 Customer delivery, inspection & doorstep handoff** — §6.3–6.4; **Option-B payment-before-custody**; buyer inspects (category matrix); drop code last; **no self-declaration**; problem path equal.
- **SE7 Failed delivery & return** — §6.5; structured reasons; two-key return; fault-attributed claims.
- **SE8 Safety/SOS/incident** — SOS visible from every rider flow; ack within SLA; secure/quarantine custody; live drill before pilot.
- **SE9 Fleet/shift/payroll** — §7; **payroll separate from settlement**; delivery-fee and payroll ledgers separate; no rider-selling incentive; **fleet-release gates**.

---

## 9. Dispatch & ops information architecture
**Prêt à assigner · Routes · Exceptions · Coursiers · Flotte · Sécurité · Paie**, plus **Vérification enlèvement** (pickup-verification exceptions), **Handoff break-glass** (operator verification + incident queue), **Fonds de protection** (solvency dashboard + claims by fault-class + custody-liability), **Éligibilité acheteur** (refusal ladder review).

---

## 10. Analytics & guardrails
Readiness/dispatch: certified availability, ready-queue age, assignment latency, capacity conflicts. Execution: pickup punctuality, **pickup-verification pass rate + dwell**, first-attempt delivery, **Option-B door-payment completion**, duration, stops/route-hour, failed-reason distribution, return completion, dwell by custodian. Evidence/custody: proof completeness, validation pass/hold/fail, seal mismatch, custody gaps, **% reconstructable from one correlation_id**. Cost: **directDeliveryCost, returnDeliveryCost, deliveryContributionMargin, deliveries/moto/day, utilization** (fleet-gate inputs). Safety/privacy/workforce guardrails. Faster delivery MUST NOT worsen safety/privacy.

---

## 11. Build sequence (before the reseller layer; single-job, no batching)
1. Kernel + rider auth/KYC + **no-address navigation primitive**.
2. Ready-queue intake (**funded per mode + readiness-gated**; test orders while siblings mocked).
3. Dispatch console + **single atomic assignment lease**; deterministic suggestion.
4. Route manifest + **one-current-stop** (offline; **no batching**).
5. **Pickup verification + seal-after-verification custody** + hash-chained custody/evidence ledger.
6. **Delivery inspection + Option-B doorstep payment → HandoffAuthorization (webhook + break-glass)** + **ValidationDecision** (evidence → validation → custody→customer → eligibility signal; failed never releases).
7. Failed/return workflows (structured reasons; two-key return; fault-attributed claims).
8. SOS/incident (live drill) → fleet/shift/payroll (**fleet-release gates**; ledgers separate).
- Each slice: state approach → read code → build → write tests → human reviews code.

---

## 12. MVP acceptance + CI invariant gates
**Acceptance:** only certified/on-shift couriers + **funded + readiness-confirmed** tasks assigned; **atomic tests prevent double assignment**; **one active route/current-stop** offline with clear sync; **pickup verification precedes custody-seal precedes custody**; delivery creates buyer-bound evidence + validation; **no single actor completes both sides**; **Option B: custody transfers only after provider-confirmed door payment or signed break-glass authorization**; failed/refusal/mismatch/loss paths preserve **exactly one current custodian** + create recovery; **SOS drill passes before pilot**; location only on shift/task; **payroll separate from settlement**; **fleet starts at 3–5 units**.
**CI gates (fail the build):** no platform-fund/wallet module (Séra emits events + reads order/delivery context only); no ML/route-optimization/ETA libs; **exactly one assignment authority; assignment atomic**; **one current custodian; evidence ≠ release; custody only after verification + custody-seal**; **custody transfers only after provider-confirmed door payment / signed authorization**; **rider never accepts screenshot/SMS/verbal/pending; no personal-account payments**; **the four secrets never substituted; buyerDropCode never in seller/readiness evidence**; no generic failed terminal; GPS never sole proof; off-shift location not collected; money model reconciles (delivery outside fee bases); French default (**French Voice Standard copy-lint — Contract §10.5**); offline = pending.

---

## 13. Decision Required register (✅ resolved / ⏳ open)
✅ Seal-after-verification custody · ✅ bounded pickup-verification scope + dwell · ✅ Option-B doorstep payment + break-glass handoff · ✅ delivery-cost decomposition (ranges) · ✅ staged fleet-release gates · ✅ Protection-Fund/custody-liability split with fault-class.
⏳ **Aggregator provider interface for operator verification + two-leg/refund fees + auth/capture** (Real-Money Gate). ⏳ Courier employment model + insurance + accident response. ⏳ Delivery fee table + zones + min-margin gate (feeds `DeliveryFeeQuote`) **+ scheduled-window pricing + commitment floor for campaign-funded benefits (Shop+ Cercle)**. ⏳ **PackLab handling-class packaging + at-door inspection standards** (kitting-seal-as-external-seal at pickup; sharp/fragile safe-inspection rules — Boutik+ PackLab B+9). ⏳ Dispatch hours/after-hours/SLA. ⏳ Evidence bundle + validation owner + dispute-hold by risk tier. ⏳ Rider device/background-location/retention. ⏳ Motorcycle licensing/registration/permits.

> Séra is implementation-ready only when every mandatory acceptance criterion and every applicable shared-service contract has a passing test, an operational owner, and a recovery path.
