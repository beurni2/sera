# Boutik+ — Professional Build Specification (v3)
### Supplier & fulfillment application — **supply only**. Boutik+ × Shop+ × Séra.
**Status:** Implementation baseline · **Version:** 3.1 · **Audience:** product, design, engineering, ops, risk, finance, support · **Repo:** `boutik-plus`

> **v3.1 change:** folds **Shop+ PackLab** — the platform-owned Founding Catalog Engine — into this spec as a **build-gated capability (B+9)** with dedicated invariants (**B+I-16…B+I-20**). PackLab is a second **supply mode** (`PLATFORM_OWNED` composite/BOM SKUs), not a new architecture: it reuses Catalog/Media/Offer/Inventory/Fulfillment with a platform-seller actor, a kitting fulfillment path, and three enforced recede ceilings. Authoritative feature spec: **`Shop-Plus-PackLab-Founding-Catalog-North-Star.md` (v2)**; this spec carries the load-bearing contracts and CI-enforceable rules. **Diaspora (HUB_CONSIGNMENT) is intentionally NOT folded here yet.**

> **v3 change:** the consolidated commercial, payment, and risk model from the ecosystem review cycle is now **normative** — canonical money waterfall, dual payment modes, **zero-deposit sellers + a capitalized Séra Fulfillment Protection Fund**, seller trust tiers, **package-readiness gate**, **rider pickup verification + seal-after-verification custody**, and category settlement finality.
>
> Boutik+ lets verified suppliers publish truthful, reseller-ready products (via **Boutik+ Studio**), hold variant-level stock, offer **explicit locked reseller economics**, prepare funded orders, transfer sealed packages to **Séra** after rider verification, and see exactly when proceeds become payable and paid. **Suppliers never sell directly to buyers; resellers (Shop+) are the only consumer channel. Sellers join free — no deposit, reserve, guarantee, subscription, or onboarding fee.**
>
> Boutik+ supports two supply modes on one inventory truth: **`SELLER_HELD`** (the default above) and — build-gated — **`PLATFORM_OWNED`** (**PackLab**, B+9): platform-owned composite/BOM packs, hub-kitted, that seed the launch catalog and set the visual standard, then **recede** on governed ceilings as seller/consignment supply grows. PackLab is a *supply mode and an internal actor*, never a second consumer channel — resellers (Shop+) remain the only path to buyers.
>
> **Normative language.** MUST/MUST NOT/SHOULD/MAY/OWNER/PRECONDITION/POSTCONDITION/FAILURE STATE/EVIDENCE as standard.

---

## 1. Scope & boundaries
- Boutik+ MUST provide: **zero-cost, product-only** supplier onboarding + verification, **seller trust tiers**, product authoring, **canonical media capture (Boutik+ Studio)**, moderation feedback, offer/commission authoring, variant inventory, **package-readiness confirmation**, fulfillment preparation, **inspectable-package handoff to Séra**, settlement views, support entry.
- Boutik+ MUST provide, **behind the PackLab build gate (§12)**: a **`PLATFORM_OWNED` supply mode (B+9)** — composite/BOM pack products with deterministic component-min availability, a **hub kitting → QC → seal** fulfillment path, three enforced **recede ceilings** (inventory cash exposure, promoted-catalog share, rolling platform-owned GMV share), the **Restock Law**, the **six-question gate**, the **pack covenant**, and the **Supplier Upgrade Path** into the PackLab media standard.
- Boutik+ MUST NOT: expose a consumer storefront, buyer checkout, direct customer acquisition, or supplier-created buyer orders.
- Boutik+ MUST NOT compose customer-price promotional media — **Shop+** owns reseller promotion from approved canonical assets.
- Boutik+ MUST NOT hold funds or compute an independent balance — it reads supplier settlement projections from **Ledger/Settlement**.
- Boutik+ MUST NOT collect any deposit, reserve, bond, or fee from a seller as a condition of joining or listing.

---

## 2. Primary users, permissions & seller trust tiers
**Roles:** supplier owner (create business, authorize staff, publish supply, set offers, view settlements; payout change = step-up + cooling-off) · catalog editor · stock/fulfillment staff · supplier finance viewer (read-only) · verification/moderation operator (Ops only). Standard prohibitions: no direct consumer sales, no ledger edits, no self-moderation, no cross-supplier visibility.

**Seller trust tiers (progression, not payment) — OWNER: Risk/Moderation (`SellerTrustState`):**
- **Provisional** — zero deposit · **one active order at a time** · limited quantity/order value · **approved launch categories only, no high-risk/counterfeit-prone categories** · **FULL_PREPAY orders only** · **every pickup rider-verified** · mandatory readiness confirmation · fast payout after accepted delivery.
- **Verified** (after ≥3–5 clean delivered orders, no seller-fault failures, stock accuracy ≥ threshold, readiness + pickup-verification pass-rate ≥ threshold, no unresolved moderation/authenticity concern — thresholds are pilot parameters): **Option B unlocked** · multiple concurrent orders · higher value limits · better visibility · faster pickup.
- **Trusted** (strong history): more concurrency · **reduced pickup checks where safe** · priority campaigns · wider reseller reach · future supplier tools.

**Access-based consequences (never deposit-based):** 1st seller-fault → warning + retraining + lower visibility + back to one-at-a-time; repeated → Option B disabled, FULL_PREPAY-only, mandatory pickup verification, lower concurrency; serious/fraud → listings suspended, account review, removal. **Re-entry after suspension is blocked** on verified phone + payout-wallet identity + shop location + business identity (device = supporting signal only; device/household alone never auto-bans); human review for suspected duplicates.

---

## 3. Information architecture
**À faire · Produits · Stock · Argent · Profil.** À faire = obligations + blockers (accept order / **confirm package ready** / fix). Produits = drafts, moderation, canonical versions, offers (**Lister un produit** → Studio). Stock = pools, adjustments, reconfirmations. Argent = locked/pending/payable/paid proceeds + payout instrument. Profil = business, staff, **trust tier + progression**, verification, pickup locations, support. Onboarding message: **« Listez vos produits gratuitement. Boutik+ et Shop+ ne gagnent que lorsque votre produit est vendu. »**

---

## 4. Core invariants
- **B+I-01:** Every active product version MUST have approved facts, ≥1 active variant, an approved **price-free** canonical hero, an approved **public-safe actual-item proof**, and an approved moderation decision.
- **B+I-02:** Product images MUST remain **price-free and supplier-contact-free**. Customer pricing is rendered by Shop+/Checkout.
- **B+I-03:** Every active variant MUST map to ≥1 active inventory pool. Available quantity is **service-derived, never client-set**.
- **B+I-04:** A supplier offer change creates a **new version**; it MUST NOT change an accepted quote or confirmed order.
- **B+I-05:** A supplier receivable displayed for an order MUST equal the **locked quote/ledger obligation** (`sellerNet`), never a live recomputation.
- **B+I-06:** A Séra pickup MUST NOT be requested until fulfillment is accepted and the supplier has confirmed **package-ready** (readiness evidence + dynamic readiness challenge).
- **B+I-07:** The supplier MUST NOT mark custody transferred — **Custody Service** begins custody only after **rider pickup verification AND custody-seal registration**.
- **B+I-08:** Original media is **private and immutable**; processing/redaction creates **versioned derivatives**.
- **B+I-09:** Proof-of-access MUST be described honestly and MUST NOT be presented as proof of ownership, authenticity, or current quantity.
- **B+I-10:** No recruitment or reseller-network depth may affect supplier or reseller earnings (single-level only).
- **B+I-11 (imaging):** The canonical pipeline is **deterministic + on-device** — no generative alteration, no model cutout/segmentation/classification, no server-side per-image inference, no AI-derived facts. Voice = audio notes, not STT.
- **B+I-12 (zero-deposit):** No seller deposit, reserve, guarantee, bond, subscription, or onboarding fee may be required. Seller-caused losses are absorbed by the **Séra Fulfillment Protection Fund**; consequences are access-based.
- **B+I-13 (buyer-refund priority):** No seller-caused refund or logistics loss may delay the buyer's refund; the Protection Fund covers the loss while seller privileges are reduced/suspended.
- **B+I-14 (verify-before-custody):** No rider accepts custody from a **provisional** seller until the product is verified against the locked order.
- **B+I-15 (single consumer channel):** `PLATFORM_OWNED` (PackLab) is a supply mode and internal actor only; it MUST NOT create a consumer storefront or sell to buyers — resellers (Shop+) remain the sole path to buyers, identically to `SELLER_HELD`.
- **B+I-16 (BOM truth):** A `PackProduct` is a bill-of-materials over shared `PackComponent`s. Pack availability = **min over components of floor(available / qty)**, computed deterministically and service-derived (never client-set). Reservations occur at **component level**; assembly happens at the **kitting station (kit → QC → seal-at-kitting)**. Every pack MUST pass the **OrderFundingCheck solo at its own price** — packs are never bundle-only.
- **B+I-17 (component allocation — marketplace wins ties):** Each active pack holds a **reserved assembly floor** of its critical components. **Above the floor, solo component sales are NEVER throttled to protect packs**; floor pressure fires `REORDER_NEEDED` (and may surface a supplier/consignment alternative), not a solo-sales brake. Pack availability degrades **honestly** via BOM-min when a component genuinely cannot be replenished.
- **B+I-18 (three recede ceilings):** PackLab is governed by three ceilings — (a) **inventory cash exposure** (blocks the purchase order at creation), (b) **promoted-catalog share** (caps the promoted surface: 60–80% M0–3, then glides), (c) **rolling 90-day platform-owned GMV share** (throttles PackLab promotion when above the glide path → ≤30% M9–12). The glide is **readiness-gated** (recede as fast as seller/consignment supply can carry GMV, no faster); when growth would breach (a) or (b), **PackLab stops buying even if packs are selling**. A **Restock** additionally requires: ≥60-day sell-through, acceptable defect + repost-to-order rates, all ceilings clear, passing funding check, no better supplier/consignment alternative, and size ≤ X× trailing-30-day sales unless approved.
- **B+I-19 (pack covenant + upgrade path):** PackLab MUST NOT replicate a supplier's proven SKU/bundle without first offering that supplier the **component-supply path** (right of first refusal; decline ⇒ 90-day ranking protection); success data is never the instrument of replacement. Conversely, a supplier/diaspora product that is **hub-verified, scored, low-return, photo-standard, funding-passing, and covenant-clean** earns a **PackLab-grade Media Kit** and promotion eligibility (the **Supplier Upgrade Path** — the recede made concrete).
- **B+I-20 (handling class + neutral packaging):** Packs carrying sharp/fragile/sensitive items MUST carry a **`HandlingClass`** (e.g. `SHARP_OBJECT_SAFE_PACKAGING_REQUIRED`) that sets packaging, the Séra handling flag, and safe at-door inspection; the class governs discipline, never a blanket ban. PackLab outer packaging obeys the same **neutral/platform packaging** rule as all supply (checked at pickup).

---

## 5. Platform foundation & shared contracts  *(canonical — identical across all three specs; must match)*

### 5.1 Kernel (`@platform/kernel`)
Phone-alias identity (WhatsApp reverse-handshake; **phone is an alias, never the DB key**); no-street-address **Location** `{pin, zone, landmark, directions, maskedRelay}` + gazetteer; **French-first** i18n (Mooré/Dioula) + **audio notes** — all user-facing strings follow the **French Voice Standard** (Execution Contract §10.5: money-register calm/precise, selling-register Ouaga-warm, 6th-grade reading level, copy-lint enforced); offline-first (**queued = pending, never done**); guided-camera/media pipeline; shared types.

### 5.2 Domain ownership (LOGICAL — authoritative wherever deployed)
Catalog · Media · Offer&Pricing · Inventory · Storefront&Attribution · Checkout&Order · Fulfillment&Package · Logistics&Dispatch · Custody · Evidence&Validation · **Ledger&Settlement (money state + Protection Fund)** · Payments (licensed aggregator) · **Risk/Moderation (seller tiers, buyer eligibility, related-party)** · Consent/Notification · Analytics.
> Ownership boundaries, **not a mandate for a dozen microservices** — co-deployable behind a small commerce core with authority enforced in code. **No app writes another domain's truth.** Boutik+ is the authoring surface for Catalog/Media/Offer/Inventory/Fulfillment; it does not own those DBs.

### 5.3 Tech (near-zero marginal cost)
Expo/React Native, offline-first, low-end Android · Cloudflare **Workers + Durable Objects** (atomic reservation, assignment lease, custody transitions, idempotency) · **Neon** · **R2** (zero egress) · **BCEAO-licensed aggregator** (collect→hold→split→payout; **no app holds funds**) · **no AI/ML, no per-image inference, no GPU**.

### 5.4 Canonical money model (NORMATIVE — reconciles to the franc on every order)
Let **B** = seller base price, **C** = seller-funded reseller commission, **M** = reseller markup, **D** = delivery charge.
```
productSubtotal        = B + M                     // commission is NEVER added to the buyer price
buyerTotal             = B + M + D
sellerPlatformFee      = 0.05 × B
sellerNet              = B − C − sellerPlatformFee
resellerGrossEarnings  = C + M
resellerPlatformFee    = 0.20 × (C + M)
resellerNet            = 0.80 × (C + M)
platformProductFeeRevenue = sellerPlatformFee + resellerPlatformFee     // = 0.05B + 0.20(C+M)
```
**Reconciliation invariant (CI):** `productSubtotal == sellerNet + resellerNet + platformProductFeeRevenue` AND `buyerTotal == productSubtotal + D`. **Delivery is OUTSIDE both fee bases.** Resellers MUST see `resellerNet` (not gross) before promoting. *Worked baseline:* B 10,000 · C 1,000 · M 1,500 · D 1,000 → subtotal 11,500, buyerTotal 12,500, sellerNet 8,500, resellerNet 2,000, platform product-fee revenue 1,000 (8,500 + 2,000 + 1,000 = 11,500 ✓).

### 5.5 Payment modes & the money/custody boundary (NORMATIVE)
`paymentMode ∈ {FULL_PREPAY, DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR}`.
- **FULL_PREPAY:** `amountPaidAtCheckout = buyerTotal`, `amountDueAtDelivery = 0`. Held at aggregator until validation.
- **DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR (Option B):** `amountPaidAtCheckout = D`, `amountDueAtDelivery = productSubtotal`; product paid by Mobile Money **at the door, before custody transfer**. **Not COD.** Restricted to **verified+ sellers**, category/price/zone-eligible, buyer-eligible.

**Boundary:** buyer selects mode → **funds required legs** (full = buyerTotal; B = D) → provider hold → inventory **reserve** → **seller confirms package-ready** → dispatch → **rider pickup verification (before custody)** → **rider applies/witnesses Séra custody seal** → **custody begins** → transit → arrival + **buyer inspection** (category rules) → [Option B: buyer pays product leg → **provider-confirmed** → **HandoffAuthorization**] → **custody → customer** (buyer drop code entered last) → **ValidationDecision** → settlement **eligible** → **same/next-day split** (`sellerNet`, `resellerNet`, delivery to Séra, `platformProductFeeRevenue`, less payment fees). **Evidence supports, never auto-releases; no app marks paid.** **Custody MUST NOT transfer before authoritative provider confirmation of every due leg.** **No payment into any personal account** (rider/reseller/supplier). **"Held/escrow" wording is a legal Decision.**

### 5.6 Canonical objects (shapes identical everywhere)
```
User            { id, phoneAlias(verified,unique), roles{supplier,reseller,buyer}, payoutInstrumentRef, trustState }
Location        { pin{lat,lng}, zone, landmark, directions, maskedRelay }
Product/Version { id, supplierId, version, name, productCode, facts, category, zone, moderationState, status, supplyMode(SELLER_HELD|PLATFORM_OWNED), handlingClass? }
PackProduct    { packId, productVersionId, components[{componentSku, qty}], assemblyCost, customerPrice, resellerCommission(C), returnPolicy, sixQuestionGate{who,moment,priceReason,resellerEarn,seraProfitable,repostable} }   // OWNER: Catalog (PLATFORM_OWNED)
PackComponent  { componentSku, state(AVAILABLE_FOR_PACK|AVAILABLE_FOR_SOLO|RESERVED_FOR_PACK_ASSEMBLY|RESERVED_FOR_CAMPAIGN|QUARANTINED|REORDER_NEEDED), packAssemblyFloor, available, soloSellable }   // OWNER: Inventory
KittingJob     { id, packId, components[], qcResult, kittingSealId, status }   // OWNER: Fulfillment (kitting station)
PackLabCeilings{ month, cashExposureCap, currentCashExposure, promotedCatalogCap, currentPromotedShare, rollingGmvSharePct, glidePathTarget, blockState, throttleState }   // OWNER: Risk/Analytics — recede gate
RestockDecision{ packId, sellThrough60d, defectRate, repostToOrderRate, ceilingsClear, fundingCheckPass, betterAlternativeExists, maxSize, approved }
Variant         { id, productVersionId, attributes, stableSku }
ProductAssets   { masterRef(private,immutable), heroSquare, heroVertical, proof, detail[], hashes[], processingVersion }  // PRICE-FREE, contact-free
SupplierOffer   { id, productVersionId, version, basePrice(B), resellerCommission(C), platformFeeVersion, eligibleVariants[], zones[], effective, expiry, status }
CommissionAgreement { id, resellerId, offerVersion, acceptedAt, status }
ResellerListing { id, resellerId, productVersionId, offerVersion, markup(M,versioned), variants[], status }   // OWNER: Shop+
Storefront      { id, resellerId, slug, discoverable, curatedItems[] }
AttributionToken{ id, resellerId, listing/store/campaign, issued, expiry, signature, version }
Quote           { id, attributionResellerId(LOCKED), paymentMode, sellerBasePrice, sellerFundedCommission, resellerMarkup,
                  productSubtotal, deliveryFee, buyerTotal, amountPaidAtCheckout, amountDueAtDelivery,
                  sellerPlatformFee, sellerNet, resellerGrossEarnings, resellerPlatformFee, resellerNet,
                  platformProductFeeRevenue, paymentProcessingFeeEstimate, taxFields,
                  campaignId?, campaignBenefit?{ type, customerShare, campaignShare },      // Cercle: reconciliation anchor
                  policyVersions{settlementPolicyVersion, inspectionPolicyVersion}, expiry }        // IMMUTABLE, reconciles
Order           { id, quoteId, productVersionId, supplierId, resellerId(LOCKED), buyerPhoneRef, dropoff:Location,
                  reservationRef, escrowRef, paymentMode, status, timestamps }
DeliveryFeeQuote{ zoneFrom, zoneTo, fee, serviceable, version }                                    // OWNER: Logistics → Checkout
Package/Seal    { packageId, sellerReadyPackaging, custodySealId, orderLineSnapshot, status }
PackageReadinessConfirmation { orderId, photoRef, readinessChallenge, qty, variant, availableConfirmed, at }
PickupTask/DeliveryTask { id, orderId, type, location, window, status, assignmentLeaseRef, routeRef }
RouteManifest   { id, riderId, version, orderedStops[], custodyInventory[], status }
PickupVerification { orderId, riderId, checks[], result(accepted|refused), rejectionReason, custodySealId, evidenceBundleId }
InspectionPolicy { version, inspectionCategory, allowedActions[], sealRule, dwellTargetSec }
InspectionSession { orderId, inspectionCategory, packageOpened, manufacturerSealOpened, startedAt, completedAt,
                  inspectionResult, rejectionReason, faultAssignment, evidenceBundleId }
CustodyRecord   { packageId, currentCustodian, transitions[], exception? }                          // exactly one current custodian
EvidenceBundle  { taskId, packageId, custodySealId, artifacts[], capturedAt }
HandoffAuthorization { orderId, riderId, buyerRef, exactAmount, providerTransactionReference,
                  authorizationSource(provider_webhook|break_glass), authorizedBy, authorizationExpiresAt,
                  authorizationConsumedAt, authorizationReason, breakGlassCaseId, signature,
                  state(requested|operator_verifying|provider_confirmed|issued|consumed|expired|voided) }
ValidationDecision { taskId, result(validated|review_hold|rejected), reasons[] }
SettlementObligation { orderId, party, amount(locked), state, payoutRef, holds[] }                  // Locked→Pending→Eligible→Payable→Processing→Paid|Held|Failed
EscrowTxn       { orderId, provider, paymentLegs[{legType(checkout|door), collectRef, amount, fee, status(held|captured|refunded)}],
                  status, splitBreakdown, payoutRefs[] }
ProtectionFund  { openingFundCapital, balance, minimumOperatingBalance, requiredProtectionBalance,
                  availableProtectionBalance, committedClaimsAmount, fundSolvencyState(HEALTHY|WATCH|RESTRICTED|CRITICAL),
                  allocationPolicy{byCategory,byZone,bySellerTier}, inflowsBySource[], outflowsByReason[] }   // OWNER: Ledger&Settlement
ProtectionClaim { orderId, reason, amount, faultClass(seller|sera|payment_provider|buyer|platform_system|unresolved),
                  evidenceBundleId, state }
CustodyLiabilityClaim { orderId, cause(sera_loss|sera_damage), amount, evidenceBundleId, state }    // Séra-caused; separate from fund
SellerTrustState { sellerId, tier(provisional|verified|trusted), faultCount, restrictions[], probationLimits }
PayAtDoorEligibility { buyerRef, state, reason, buyerRefusalCount, buyerRiskState, requiredDeposit, prepayOnlyUntil }
```
**Four distinct, non-interchangeable secrets (CI-enforced separation):** `sellerReadinessChallenge` (short-TTL, in-app, seller↔readiness) · `pickupVerificationCode` (rider↔pickup) · `buyerDropCode` (buyer↔delivery, **private — never shown to the seller or in readiness evidence**) · `HandoffAuthorization` (payment-confirmed handoff).

### 5.7 Events (versioned; carry command_id, correlation_id, aggregate version, actor, server time)
`supplier.verification_submitted/approved/restricted.v1` · `seller.trust_state_changed.v1` · `media.asset_captured/derivative_approved/asset_rejected.v1` · `catalog.product_submitted/version_activated/blocked.v1` · `offer.published/version_created/paused.v1` · `inventory.adjusted/reconfirmation_due/availability.changed.v1` · `checkout.quote_created.v1(paymentMode)` · `payment.checkout_leg_confirmed/door_leg_confirmed.v1` · `fulfillment.accepted/ready/rejected/timed_out.v1` · `seller.readiness_challenge_issued.v1` · `pickup.verification_recorded.v1(result)` · `pickup.custody_seal_registered.v1` · `custody.transferred_to_courier/transferred_to_customer.v1` · `handoff.authorized.v1` · `delivery.refused.v1(reasonCode,fault)` · `delivery.validated/held_for_review.v1` · `settlement.supplier_payable.v1` · `payout.submitted/paid/failed.v1` · `protection.capitalized/solvency_changed.v1(state)` · `protection.claim_opened.v1(faultClass)` · `goodwill.granted.v1` · `packlab.pack_created/gate_passed/gate_failed.v1` · `packlab.kitting_started/qc_passed/sealed.v1` · `packlab.component_reorder_needed.v1` · `packlab.restock_requested/approved/blocked.v1(reason)` · `packlab.ceiling_breached.v1(ceiling)` · `packlab.covenant_offer_made.v1` · `packlab.supplier_upgraded.v1`.

### 5.8 Cross-cutting invariants (all three apps; CI-enforced)
No app holds funds or computes another domain's amounts · **money model reconciles (5.4); commission never in buyer price; delivery outside fee bases; reseller sees net** · **single-level only** · deterministic only (no generative/segmentation/classification/server-inference/learned-ranking/route-ML; voice = audio) · price-free canonical assets · one current custodian; **evidence ≠ release** · **custody begins only after pickup verification + custody-seal registration** · **custody transfers only after provider-confirmed payment of all due legs; no personal-account payments** · **the four secrets are never substituted** · **zero seller deposit; buyer refund never gated on the Protection Fund** · **new dispatch may be throttled by fund solvency; buyer refunds never delayed** · versioned offers/listings; quotes/orders byte-stable · signed attribution tokens · French default; offline = pending; phone is an alias.

---

## 6. Séra Fulfillment Protection Fund (NORMATIVE — Boutik+ reads; Ledger&Settlement owns)
- **Capitalized before launch** with **founder opening capital** (`openingFundCapital`) — *startup working capital, not a seller deposit.* **Pooled, platform-funded fulfillment risk — NOT insurance** (no external underwriter; exposed to correlated failures, fraud, product loss, refund spikes, mispricing).
- **Funded from platform revenue:** a small automatic allocation per **completed** order (from the 5% + 20% fees + a slice of delivery contribution), later sponsored campaigns + budgeted allocation. **Sellers never contribute.**
- **Sizing (exposure-based):** `requiredProtectionBalance = expectedMonthlyClaims + stressBuffer + openOrderExposure`, `expectedMonthlyClaims = orders × sellerFaultProbability × avgClaimCost`, plus a safety multiplier, an absolute floor, dispatched-order exposure, and a **separate product-loss allowance for Séra-custody incidents**. Per-order allocation is **dynamic** by category/zone/seller-tier. Calibrated to **measured** pilot loss.
- **Solvency-gated dispatch:** at **RESTRICTED**, reduce new-seller/high-value/Option-B/concurrent exposure; at **CRITICAL**, stop riskier transactions until capital is restored. **Buyer refunds are NEVER gated on fund state.**
- **Coverage:** payment/refund fees · failed pickup attempts · seller-fault return logistics · approved buyer goodwill · unrecovered operational loss. **Not covered:** compensating a seller for their **own** wrong/damaged product, inventory they still hold, or resale value lost to their own inaccurate listing. **Séra-caused product loss/damage = `CustodyLiabilityClaim`, not a fund payout.** Every claim carries a **`faultClass`**.

---

## 7. Capability specifications (Boutik+ deltas from prior; unchanged capabilities retained)
- **B+1 Onboarding & verification** — **zero-cost, product-only** (phone verify · shop identity · location+landmark · MoMo payout · photos · info · stock · base price · commission · pickup availability). New sellers begin **provisional**. No deposit/bond/subscription. Duplicate/re-entry checks on real identity signals. Acceptance: unapproved cannot publish unrestricted; provisional limits enforced; duplicate submission idempotent.
- **B+2 Boutik+ Studio** — unchanged (deterministic, on-device, three-outcome cleanup, hostile-image corpus, price-free master + derivatives, EXIF strip, seller confirmation). Premium-frame default; safe-cleanup behind processing-version flag.
- **B+3 Product/variant/moderation** — unchanged; **neutral/platform packaging rule** added (no supplier branding/contact on the exterior; checked at pickup).
- **B+4 Offer & commission** — supplier sets **B + C**; sees **`sellerNet` and receivable examples using the 5.4 waterfall**; floor block; versioned; **category floor ≥5,000 FCFA** and **launch/prohibited categories** enforced. Acceptance: absolute amounts; byte-stable snapshots.
- **B+5 Inventory & stock truth** — unchanged (atomic reservation, immutable adjustments, reconfirmation freeze).
- **B+6 Fulfillment & package readiness** — accept/reject; prepare in **inspectable outer packaging**; **confirm package-ready** with `PackageReadinessConfirmation` (photo + `sellerReadinessChallenge` displayed beside the product, short-TTL) → **only then does the task enter the dispatch queue**. **No full seller seal before rider inspection.** Acceptance: **no pickup task before readiness**; readiness challenge distinct from all other secrets.
- **B+7 Séra pickup handoff (seal-after-verification)** — courier verifies **objective conformity** (order ref, identity, variant, colour, size label, quantity, visible damage, included pieces, external mfr seal) against the locked order; mismatch/damage → **rider refuses custody, buyer refunded, no round-trip** (Protection Fund covers the pickup attempt). On pass, **rider applies/witnesses the Séra custody seal**, records `custodySealId` + photos → **Custody begins**. **Invariant B+I-14** for provisional sellers. Acceptance: exactly one custody transfer; wrong package fails closed; custody starts only after verification + seal registration.
- **B+8 Supplier proceeds & statements** — reads `SettlementObligation`; **same/next-day payout after validated acceptance**; provider-confirmed reference before Paid; no withdrawal button; no local balance. **Seller-fault losses do not debit the seller** (fund absorbs); trust-tier/consequence shown.
- **B+9 PackLab — Founding Catalog Engine (build-gated — gate in §12; authoritative spec: Shop-Plus-PackLab-Founding-Catalog-North-Star v2)** — the `PLATFORM_OWNED` supply mode. **BOM packs** over shared components with deterministic min-availability (B+I-16) and a **kitting station** (kit → QC → seal-at-kitting) that parallels seller readiness — a PackLab pack enters the dispatch queue on **kitting seal**, not seller `PackageReadinessConfirmation`. **Six-question gate** (B+I-18) blocks any pack lacking a nameable buyer, clear price reason, specific reseller net, solo-funding, or a complete Media Kit. **Three recede ceilings** (B+I-18) enforced where each number is knowable: cash exposure **blocks the PO**, catalog share **caps the promoted surface**, rolling GMV **throttles promotion**; the **Restock Law** gates every re-buy. **Pack covenant + Supplier Upgrade Path** (B+I-19). **Handling classes** (B+I-20). Launch set of six packs in confidence **waves** (Beauté Outils · Grand Jour · Cuisine Départ → +2–4wk Chambre Étudiant · Maison Organisée → after QC Téléphone Créateur); **electronics gate** (no electrics in packs before the tested-plug/warranty/≥5%-replacement capability gate); **component-level returns** (component defect → replace component; whole-pack return only for severe mismatch/fraud/at-door rejection). Boutik+ owns the platform-seller actor, BOM, kitting, and ceilings; it still does not own the Catalog/Inventory/Fulfillment DBs (authoring surface only).
- **Cercle invariance note (Shop+ Cercle):** reseller campaigns NEVER touch Boutik+ economics or obligations — B, C, `sellerNet`, the 5% fee, readiness duties, and payout timing are invariant under any campaign. Boutik+'s only relationship to Cercle is that its existing `inventory.availability.changed` / `offer.paused` / moderation events **auto-pause** downstream campaigns; no new seller surface or consent is involved.

---

## 8. App-specific data projections
`supplier_action_queue` (incl. **readiness-required**, **pickup exceptions**) · `supplier_product_view` (+ trust tier) · `supplier_fulfillment_view` (order-line snapshot, `sellerNet`, readiness/pickup/custody states, `paymentMode`) · `supplier_money_view` (locked/pending/payable/paid, no reserve) · `supplier_trust_view` (tier, fault count, restrictions, progression thresholds).

---

## 9. Analytics & guardrails
From authoritative events. **Activation:** approved supplier publishes ≥1 active product + offer + variant within 7 days. **Quality:** stock accuracy, acceptance rate, prep time, **readiness-compliance rate**, **pickup-verification pass rate**, **pickup dwell (target 2–4 min)**, variant mismatch, settlement SLA. **Risk:** seller-fault rate + faultClass mix, Protection-Fund inflow/outflow + solvency state, oversell, moderation rejection. Growth MUST NOT be rewarded when guardrails deteriorate.

---

## 10. Build sequence (ordered vertical slices)
1. Kernel + **zero-cost onboarding** + verification + **SellerTrustState (provisional)**.
2. Boutik+ Studio (capture → normalize → three-outcome cleanup vs hostile corpus) — premium-frame default.
3. Media publication + moderation.
4. Product/variant + versioning + neutral-packaging rule.
5. **Offer & commission (5.4 waterfall, `sellerNet` examples, category floor)** → supply projection to Shop+.
6. Inventory (atomic reservation, reconfirmation).
7. **Package-readiness confirmation (`sellerReadinessChallenge`, dispatch gate)** → **Séra pickup verification + seal-after-verification custody** (Séra mocked, contract-honouring).
8. Settlement views (read-only; same/next-day; **Protection-Fund-aware, seller never debited**).
9. **(Build-gated) PackLab (B+9):** `PLATFORM_OWNED` mode + BOM/component model + kitting fulfillment + three recede ceilings + Restock Law + six-question gate + covenant/upgrade path + handling classes — begins only after the §12 PackLab gate is satisfied.
- Each slice: agent states approach → **reads existing code** → builds → writes tests (incl. the relevant CI gate) → human reviews the **code**.

---

## 11. MVP acceptance + CI invariant gates
**Acceptance:** verified supplier creates product/variant offline, gets moderation; offer publishes with **reconciling economics** and a **price change does not mutate** an existing quote; **concurrent reservation cannot oversell**; a confirmed order passes accept→prepare→**readiness**→**rider verification**→**custody-seal** before custody; **Boutik+ cannot fake custody**; settlement reconciles to ledger + provider; **no seller is ever charged a deposit or debited for a fault**; all flows pass low-end Android/offline/French-long-text.
**CI gates (fail the build):** **money model reconciles (5.4)**; no wallet/balance module; no consumer storefront/checkout; imaging gates (no segmentation/generative/classification/inference, no server render, price-free, contact-free, master≠derivative, original retained, EXIF stripped, hostile corpus + device gates); **no seller deposit/reserve field or flow**; **buyer refund never gated on Protection Fund**; **custody starts only after pickup verification + custody-seal registration**; **the four secrets never substituted (esp. buyerDropCode never in readiness evidence)**; single-level; voice = audio; French default (**French Voice Standard copy-lint: register tags + reading-level + banned-register tokens — Contract §10.5**); offline = pending. **PackLab gates (active once B+9 is built):** pack availability = deterministic component-min; every pack passes OrderFundingCheck solo; no electronics before the capability gate; solo component sales never throttled below reorder (marketplace wins ties); PO blocked on cash-exposure/catalog-share breach; promotion throttled on rolling-GMV breach; no restock without sell-through + ceilings-clear + no-better-alternative; PackLab has no consumer channel; covenant offer precedes any replication.

---

## 12. Decision Required register (updated — ✅ resolved by v3 rules; ⏳ open)
✅ Fee model (seller 5% of B; reseller 20% of C+M) · ✅ canonical waterfall + payment modes · ✅ zero-deposit sellers + Protection Fund model · ✅ settlement finality at acceptance for MVP categories · ✅ seal-after-verification custody.
⏳ **Aggregator selection + written BCEAO perimeter confirmation** (Real-Money-Gate binary #1; **two-leg fees, refund fees, auth/capture, split-payout + custody structure**). ⏳ **Protection Fund opening capital amount + allocation %** (seed conservative, calibrate to pilot loss). ⏳ Merchant-of-record & agency model. ⏳ Verification tiers evidence + progression thresholds (pilot parameters). ⏳ Final launch/prohibited category list + floor. ⏳ Tax/invoice/record-retention.
⏳ **PackLab (all pre-conditions to B+9; North Star §2/§16):** the platform-as-owner **merchant/legal structure** for owned inventory (distinct from the agency model for `SELLER_HELD`) · the **three ceiling values** (cash-exposure cap in FCFA/months-of-contribution · promoted-catalog-share % by phase · rolling-GMV glide 60–80%→≤30%) · **Restock max-multiple X** · **six-question-gate scoring + Supplier-Upgrade score threshold** · Media-Kit funding split (platform for owned; supplier studio-fee for graduated) · handling-class packaging standards + Séra flag contract · electronics-gate capability criteria. Until closed, PackLab is direction, not a work order.

> Boutik+ is implementation-ready only when every mandatory acceptance criterion and every applicable shared-service contract has a passing test, an operational owner, and a recovery path.
