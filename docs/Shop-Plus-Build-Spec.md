# Shop+ — Professional Build Specification (v3)
### Reseller commerce, storefront & buyer experience. Boutik+ × Shop+ × Séra.
**Status:** Implementation baseline · **Version:** 3.1 · **Audience:** product, design, engineering, ops, risk, finance, support · **Repo:** `shop-plus`

> **v3 change:** the consolidated model is now **normative** — **canonical money waterfall** (subtotal = B + M; reseller sees **net**), **two buyer payment options** (FULL_PREPAY + delivery-fee-prepaid product-at-door), **category at-door inspection + acceptance finality**, the **progressive buyer-refusal ladder**, and **tiered related-party detection**.
>
> Shop+ lets a reseller choose trustworthy opportunities, understand **exact net earnings**, present products from approved canonical assets, sell through their own relationships, and receive locked commission + markup — **without buying stock, handling delivery, or holding funds**. The buyer side is **reseller-fronted** (no merged supplier-product marketplace; no supplier ever appears) and offers **two payment options** at checkout.
>
> **v3.1 change:** folds **Shop+ Cercle** — reseller-owned community commerce — into this spec as a **build-gated capability (SP9)** with dedicated invariants (**SP-I14–SP-I18**). The authoritative feature specification is **`Shop-Plus-Cercle-North-Star-Spec.md` (v2.0)**; this spec carries the load-bearing contracts and CI-enforceable rules.
>
> **v3.1 also folds the PackLab Reseller Media Kit** into **SP4** (invariant **SP-I19**) — the pre-built, reseller-personalized asset bundle + « Partager ce pack » that turns any promoted product (PackLab, or a graduated supplier/diaspora product) into a 10-second professional repost. Authoritative feature spec: **`Shop-Plus-PackLab-Founding-Catalog-North-Star.md` (v2)**.
>
> **Normative language.** MUST/MUST NOT/SHOULD/MAY/OWNER/PRECONDITION/FAILURE STATE/EVIDENCE as standard.

---

## 1. Scope & boundaries
- Shop+ MUST provide: reseller activation, opportunity discovery, commission-agreement acceptance, listing/markup, storefront, **deterministic** promotional composition, **signed** links/QR, **two-option buyer checkout (PWA)**, sales tracking, consented customer tools, **net** earnings views, reputation, support.
- The MVP native app MUST be **reseller-first**; buyer pages/checkout/payment/tracking MUST be **lightweight web/PWA**, no install.
- Shop+ MUST NOT expose a flat merged supplier-product marketplace; search MAY return **reseller stores with matching-item previews only**.
- Shop+ MUST NOT reveal supplier identity/pickup/base economics/contact beyond approved trust projections.
- Shop+ MUST NOT hold funds, compute independent payouts, alter stock, create delivery evidence, or change locked attribution after confirmation.
- Shop+ MUST provide, **behind the Cercle build gate (§12)**: the **Cercle** feature system (SP9) — one reseller-owned, consent-based member community per reseller; recipe campaigns funded from settled earnings allocated at the payment partner; verified-delivery social proof; single-level referrals.

---

## 2. Users & permissions
Reseller (own profile/store/listings/links/customers + order projections; MUST NOT see supplier contact/identity, other resellers' customers, or edit attribution) · reseller assistant (later, scoped) · **buyer (web)** (own order/intents + minimal public data; chooses payment option) · store/reputation moderator (takedown via policy).

---

## 3. Information architecture — two modes, one switch
Default **Acheter**; switch to **Espace revendeur** and back.
**Buyer:** Découvrir (reseller **stores** — deterministic featured/popular, by category/zone) · Rechercher (fuzzy → **stores**, matching-item hint) · Mes commandes (track, **pay at door where applicable**, **confirm with drop code**, rate) · Profil.
**Reseller:** Opportunités (**Ajouter à ma boutique** — shows **net** earning) · Ma vitrine (**Partager**, discoverable toggle) · **Cercle** (membres · campagnes · financement campagne · avis vérifiés — build-gated) · Ventes · Clients · **Revenus** (net; resolve payout).

---

## 4. Core invariants
- **SP-I01:** Every confirmed order MUST carry exactly one `reseller_id` **locked** from a qualified attribution or the storefront used for checkout.
- **SP-I02:** A listing MUST reference an active product version + active commission agreement + eligible offer version; markup is **versioned**, future-only.
- **SP-I03:** Customer-facing pages MUST show the reseller as the commercial relationship and MUST NOT expose supplier identity/contact or **commission**.
- **SP-I04:** Earnings MUST display **Quote/Ledger/Settlement projections only** (net), never a live recomputation.
- **SP-I05:** Discovery MUST return **reseller stores, not a cross-reseller product pool**.
- **SP-I06:** Reseller earnings are **single-level**.
- **SP-I07:** Customer contact tools MUST be relationship- and consent-scoped; other resellers' orders invisible.
- **SP-I08:** **Canonical product assets cannot be replaced** by reseller product images.
- **SP-I09:** A signed share link MUST encode an **attribution-token identity**.
- **SP-I09b:** **Préséance de l'attribution.** 1. Un **code saisi explicitement au paiement** l'emporte — c'est l'acte délibéré de l'acheteuse. 2. Sinon, **l'arrivée non expirée la plus récente** l'emporte (*last-touch*). 3. Une fois la commande **verrouillée**, l'attribution est **immuable** (`first-lock-wins`, inchangé) ; un second jeton valide sur une commande verrouillée est refusé, honnêtement, sans ré-attribution silencieuse. 4. Une référence altérée, expirée ou non résolvable n'attribue **personne** et **ne bascule jamais vers la plateforme**.
- **SP-I10:** The buyer **problem/report** path MUST remain as prominent as the confirmation path at delivery.
- **SP-I11 (deterministic):** Discovery/search/ranking + marketing studio are deterministic; no learned ranking, no generative content; voice = audio.
- **SP-I12 (economics):** Checkout MUST use the canonical waterfall (§5.4); **commission is never added to the buyer price**; the reseller MUST see **`resellerNet`** before promoting.
- **SP-I13 (payment truth):** Checkout MUST show exactly **what is paid now vs due at delivery**; no confirmed order without the **required funded legs** for its mode; **no duplicate charge on retry**.
- **SP-I14 (Cercle funding):** Every financial campaign benefit MUST be funded from the reseller's **settled** earnings allocated at the **licensed payment partner** before it is advertised (maximum liability secured); pending earnings NEVER fund campaigns; Shop+ holds no funds and continuously reconciles its campaign subledger against provider truth — **divergence pauses new reservations, never existing customer promises**. General-purpose MoMo top-up is deferred pending approved payment structure.
- **SP-I15 (Cercle economics):** Campaign contribution K applies **after** the reseller fee: `effectiveResellerNet = 0.80×(C+M) − K`, with **K ≤ 0.80×(C+M)** (hard block; soft warning below 50%). B, C, `sellerNet`, the 5%/20% fees, Séra's required funding, buyer refunds, and other resellers' earnings NEVER move.
- **SP-I16 (one benefit, funded quote):** At most **one** campaign benefit per order; delivery benefits always price from an authoritative `DeliveryFeeQuote` with `customerShare + campaignShare == quote`; **fully-free delivery ⇒ FULL_PREPAY only**; benefit lifecycle = Reserved → Committed (at dispatch for delivery benefits) → Consumed | Released, with fault-based release (seller-fault → Protection Fund; **Séra-fault → CustodyLiabilityClaim**; provider-fault → provider arrangement) so the reseller never loses campaign money to another participant's failure.
- **SP-I17 (earned proof, single level):** Only validated delivered orders produce verified reviews, proof cards, referral or loyalty rewards; confirmed fraud strips verified status; referrals are strictly **single-level** with related-party tiers (identity/phone/wallet auto-void; device/household → manual review); campaign reporting says **“attributed,” never causal**, unless incremental lift is measured.
- **SP-I18 (landing-page truth & consent):** The **signed campaign landing page** is authoritative for price/stock/benefit/status; a static asset can NEVER bind Shop+ to an unfunded benefit; membership is explicit-consent with one-tap opt-out and enforced frequency preferences; segments/suggestions are deterministic and explainable; all outbound campaign content is reseller-approved (MVP — Shop+ does not broadcast).
- **SP-I19 (Media Kit — reseller is the face, assets never mislead):** Every personalized card carries the **reseller's identity and price snapshot — never the supplier's identity** (consignment/diaspora supplier identity never appears on any customer-facing surface). Identity hierarchy is **Product → Reseller → Séra → Shop+**, never inverted. A **"vérifié au hub"/"Stock vérifié" badge appears only where true** (hub-verified stock). The printed price is a **reseller-specific snapshot valid only for the signed link's window**; markup changes **expire old cards (never silent edits) and require regeneration**; the signed page remains the live price/stock truth. Every asset carries a **validity window**; the image may circulate but binds nothing. Shared assets generate **reseller/caption/neighborhood/campaign variants** (anti-spam by construction); captions include **French + Mooré + Dioula + a voice-note script**; deterministic templates only (no synthetic testimonials). Every Media Kit asset has **platform-owned or licensed reuse rights**. **Media Kit funding:** platform-funded for PackLab (owned); **supplier-funded via the Diaspora studio-fee card** for graduated supplier/diaspora products.

### 4.1 Attribution

**Attribution a deux portées.** **`product`** — le lien signé vers une offre précise : `{resellerId, offerId, issuedAt, nonce, signature}`. Inchangé ; il échoue fermé s'il est altéré. **`identity`** — l'identité permanente de la revendeuse : son code court et sa vitrine. Portée **résolue côté serveur, sans signature** — elle doit survivre au copier-coller, à la ressaisie, aux raccourcisseurs de liens et aux plateformes qui suppriment les paramètres (Instagram, TikTok). Une portée `identity` non résolvable n'attribue **personne** et ne bascule **jamais** vers la plateforme.

**Le code court de la revendeuse (`ResellerShortCode`).** Chaque revendeuse reçoit **un** code court, **permanent** et **unique** : `PRENOM-NNNN` (ex. `AICHA-4821`). Il est **public** — imprimé sur chaque carte partageable —, **jamais secret**, **jamais réassigné**. Il est **le même identifiant** que le slug de sa vitrine : `AICHA-4821` ↔ `/v/aicha-4821`.
**Format, structurel :** la partie nom = 2 à 12 lettres ASCII `A–Z` (son prénom, accents dépouillés : Aïcha → AICHA) · un seul trait d'union · exactement 4 chiffres `0–9`, attribués à l'inscription et sans collision par construction. **C'est la structure qui lève l'ambiguïté — lettres avant le trait, chiffres après — et non une restriction de jeu de caractères** : interdire `I` ou `1` empêcherait une revendeuse d'avoir son propre prénom dans son propre code.
**Saisie tolérante :** insensible à la casse · espaces ignorés · séparateur absent ou remplacé par une espace accepté (`aicha4821`, `aicha 4821` → `AICHA-4821`, la frontière lettres/chiffres étant unique). **Stockage canonique en majuscules ; slug d'URL en minuscules.** La résolution est côté serveur et limitée en débit.

**L'arrivée (`AttributionArrival`).** Toute arrivée porteuse d'attribution — lien produit signé, vitrine, ou code saisi — enregistre une arrivée : `{resellerId, scope, offerId?, arrivedAt, correlationId}`. L'arrivée a une durée de validité versionnée (défaut : **30 jours** — donnée de politique, ajustable, jamais silencieusement).

**La vitrine est une surface acheteuse.** Toutes les lois acheteuse s'y appliquent : la commission n'y apparaît jamais (SP-I03) · l'identité du fournisseur n'y apparaît jamais · le prix affiché est celui de la revendeuse · « Livré par Séra » et « Paiement protégé » y figurent.

---

## 5. Platform foundation & shared contracts  *(canonical — identical across all three specs; must match)*

### 5.1 Kernel
Phone-alias identity (phone is an alias, never the key); no-street-address **Location** `{pin,zone,landmark,directions,maskedRelay}` + gazetteer; French-first i18n (Mooré/Dioula) + audio notes — all user-facing strings follow the **French Voice Standard** (Execution Contract §10.5: money-register calm/precise, selling-register Ouaga-warm, 6th-grade reading level, copy-lint enforced); offline-first (queued = pending); media pipeline; shared types.

### 5.2 Domain ownership (LOGICAL)
Catalog · Media · Offer&Pricing · Inventory · **Storefront&Attribution (OWNED here)** · Checkout&Order (immutable Quote, Order) · Fulfillment&Package · Logistics&Dispatch · Custody · Evidence&Validation · Ledger&Settlement (money + Protection Fund) · Payments (licensed aggregator) · **Risk/Moderation (buyer eligibility, related-party, seller tiers)** · Consent/Notification · Analytics. Ownership boundaries, co-deployable; **no app writes another domain's truth.** Shop+ consumes read-only Catalog/Offer/Inventory; owns Storefront & Attribution.

### 5.3 Tech
Expo/RN, offline-first, low-end Android; **buyer = web/PWA**. Cloudflare Workers + Durable Objects (atomic reservation, assignment lease, custody, idempotency); Neon; R2. **BCEAO-licensed aggregator** (collect→hold→split→payout; no app holds funds). No AI/ML/inference/GPU.

### 5.4 Canonical money model (NORMATIVE — reconciles per order)
Let **B**=base, **C**=commission, **M**=markup, **D**=delivery.
```
productSubtotal = B + M            // commission NEVER added to buyer price
buyerTotal      = B + M + D
sellerPlatformFee = 0.05 × B ; sellerNet = B − C − sellerPlatformFee
resellerGrossEarnings = C + M ; resellerPlatformFee = 0.20 × (C + M) ; resellerNet = 0.80 × (C + M)
platformProductFeeRevenue = 0.05B + 0.20(C+M)
```
**Reconciliation (CI):** `productSubtotal == sellerNet + resellerNet + platformProductFeeRevenue`; `buyerTotal == productSubtotal + D`. Delivery is OUTSIDE fee bases. **The reseller MUST see `resellerNet` (not gross) before promoting; gross-first UI is a CI-tested prohibition.** *Baseline:* B 10,000·C 1,000·M 1,500·D 1,000 → subtotal 11,500, buyerTotal 12,500, sellerNet 8,500, resellerNet 2,000, platform 1,000.

### 5.5 Payment modes & money/custody boundary (NORMATIVE)
`paymentMode ∈ {FULL_PREPAY, DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR}`. FULL_PREPAY: `amountPaidAtCheckout = buyerTotal`, `amountDueAtDelivery = 0`. Option B: `amountPaidAtCheckout = D`, `amountDueAtDelivery = productSubtotal`; product paid by MoMo **at the door before custody transfer**; **not COD**; eligible for **verified+ sellers**, category/price/zone-eligible, buyer-eligible.
Boundary: select mode → fund legs → provider hold → reserve → seller readiness → dispatch → **rider verify → custody seal → custody** → transit → **buyer inspection** → [B: pay product leg → provider-confirmed → **HandoffAuthorization**] → **custody→customer (drop code last)** → **ValidationDecision** → settlement eligible → **same/next-day split**. Evidence ≠ release; custody never before provider-confirmed legs; **no personal-account payments**. "Held/escrow" wording is a legal Decision.

### 5.6 Canonical objects (identical everywhere)
```
User · Location · Product/Version · Variant · ProductAssets(PRICE-FREE, contact-free)
SupplierOffer{basePrice(B),resellerCommission(C),...} · CommissionAgreement · ResellerListing{markup(M,versioned)} // OWNED here
Storefront · AttributionToken{signed}
DeliveryFeeQuote{ zoneFrom, zoneTo, fee, serviceable, version }
Quote{ id, attributionResellerId(LOCKED), paymentMode, sellerBasePrice, sellerFundedCommission, resellerMarkup,
       productSubtotal, deliveryFee, buyerTotal, amountPaidAtCheckout, amountDueAtDelivery,
       sellerPlatformFee, sellerNet, resellerGrossEarnings, resellerPlatformFee, resellerNet,
       platformProductFeeRevenue, paymentProcessingFeeEstimate, taxFields,
       campaignId?, campaignBenefit?{ type, customerShare, campaignShare },   // Cercle: reconciliation anchor
       policyVersions{settlementPolicyVersion, inspectionPolicyVersion}, expiry }              // IMMUTABLE
Order{ ..., paymentMode, resellerId(LOCKED), reservationRef, escrowRef, status }
Package/Seal{ custodySealId } · PackageReadinessConfirmation · PickupTask/DeliveryTask · RouteManifest
PickupVerification · InspectionPolicy(version) · InspectionSession · CustodyRecord(one custodian) · EvidenceBundle
HandoffAuthorization{ orderId, riderId, buyerRef, exactAmount, providerTransactionReference,
       authorizationSource(provider_webhook|break_glass), authorizedBy, authorizationExpiresAt,
       authorizationConsumedAt, breakGlassCaseId, signature, state }
ValidationDecision(validated|review_hold|rejected)
SettlementObligation{ state Locked→Pending→Eligible→Payable→Processing→Paid|Held|Failed }
EscrowTxn{ orderId, provider, paymentLegs[{legType(checkout|door), collectRef, amount, fee, status: 'held' | 'captured' | 'refunded'}], status, splitBreakdown, payoutRefs[] }
ProtectionFund{ openingFundCapital, availableProtectionBalance, committedClaimsAmount, fundSolvencyState(HEALTHY|WATCH|RESTRICTED|CRITICAL), ... } // Ledger&Settlement
ProtectionClaim{ faultClass(seller|sera|payment_provider|buyer|platform_system|unresolved) } · CustodyLiabilityClaim
SellerTrustState{ tier(provisional|verified|trusted), ... }
PayAtDoorEligibility{ buyerRef, state, reason, buyerRefusalCount, buyerRiskState, requiredDeposit, prepayOnlyUntil }   // OWNER: Risk
CercleRecords (Shop+-owned; North Star §26): CustomerCircle · CircleMembership · MarketingConsent · CommunicationPreference · CustomerInterest ·
       CustomerSegment · ResellerCampaign/Recipe/Audience/Offer/Benefit/Budget · CampaignFundingAllocation(provider-held) ·
       CampaignReservation/Commitment/Spend/Release/Refund · CampaignOrderAttribution · ScheduledDeliveryCluster{campaignId, zone, window} ·
       CustomerReferral/ReferralReward · VerifiedBuyerReview/ReviewMediaConsent · PromotionalAssetPack · CampaignLandingPage ·
       CampaignPerformance · CampaignVote · ProviderCampaignAllocation/CampaignLedgerEntry/CampaignReconciliationCase/CampaignBalanceSnapshot
```
**Four distinct, non-substitutable secrets:** `sellerReadinessChallenge` · `pickupVerificationCode` · `buyerDropCode` (**private — never shown to the seller**) · `HandoffAuthorization`.

### 5.7 Events
`reseller.activated.v1` · `storefront.created/published.v1` · `commission_agreement.accepted/expired.v1` · `listing.published/version_created/auto_hidden.v1` · `attribution.issued/qualified/locked/expired/revoked.v1` · `marketing_asset.exported.v1` · `checkout.quote_created.v1(paymentMode)` · `payment.checkout_leg_confirmed/door_leg_confirmed.v1` · `order.confirmed/status_projection_updated.v1` · `pickup.verification_recorded.v1` · `handoff.authorized.v1` · `delivery.refused.v1(reasonCode,fault)` · `delivery.validated.v1` · `commission.earned.v1` · `payout.paid.v1` · `reputation.updated.v1` · `buyer.eligibility_changed.v1` · `protection.claim_opened.v1(faultClass)` · `cercle.member_joined/opted_out.v1` · `campaign.funded/activated/paused/exhausted/completed.v1(state)` · `campaign.benefit_reserved/committed/consumed/released.v1` · `campaign.reconciliation_diverged.v1` · `referral.reward_reserved/released.v1` · `review.verified_published/revoked.v1`.

### 5.8 Cross-cutting invariants (all three apps; CI-enforced)
No app holds funds/computes others' amounts · **money model reconciles; commission never in buyer price; delivery outside fee bases; reseller sees net** · single-level · deterministic only · price-free assets · one custodian; evidence ≠ release · custody only after pickup verification + custody-seal · custody transfers only after provider-confirmed legs; **no personal-account payments** · four secrets never substituted · zero seller deposit; buyer refund never fund-gated; solvency-throttled dispatch never delays refunds · versioned offers/listings; byte-stable quotes · signed attribution tokens · French default; offline = pending; phone is an alias.

---

## 6. Buyer payment, inspection, refusal & related-party rules (NORMATIVE — Shop+ surfaces)

### 6.1 Two-option checkout
Both options shown; **Option A labeled « recommandé »**. Before choosing, buyer sees two bold lines: **« À payer maintenant : X F »** / **« À payer à la livraison : Y F »** with total = X+Y once. Copy:
- **A « Tout payer maintenant — recommandé » —** « Votre paiement est protégé auprès de notre partenaire de paiement jusqu'à la confirmation de votre livraison. Le vendeur n'est payé qu'après validation. »
- **B « Payer le produit à la livraison » —** « Payez seulement les frais de livraison ({D} F) maintenant. À l'arrivée du livreur, vérifiez votre article, puis payez le montant du produit de manière sécurisée **avant de le recevoir**. » + warning « Frais de livraison non remboursables si vous annulez ou êtes absent(e). »
**« séquestre »/"escrow" MUST NOT appear** in customer copy. A one-line replay before payment (« Vous payez X F maintenant et Y F à la livraison — d'accord ? »); per-option **audio note**; lock/scooter icons. Comprehension-tested with first-time buyers.
**Option-B gate (evaluated at quote):** seller tier ≥ verified · category inspectable · order ≤ price cap (pilot ~25,000 F) · network-reliable zone · `PayAtDoorEligibility.state = allowed`.

### 6.2 Category inspection matrix (buyer-facing outcome; policy owned by Séra/Evidence, versioned)
| Category | Allowed at door | Valid rejection | Buyer-risk (not valid) |
|---|---|---|---|
| Fashion, bags, fabrics | visual: correct item, colour, size **label**, quantity, condition, missing parts | wrong/mismatch/damage/short | **no try-on**; fit dissatisfaction |
| Shoes (IN pilot) | box-open, model, size **label**, pair, condition | wrong size-label/model/damage | **fit** (wearing = buyer risk) |
| Sealed beauty/cosmetics | outer only; mfr seal intact; name, variant, quantity, expiry, damage | broken seal/wrong variant/expired/damage | opening the inner seal |
| Electronics/complex | **EXCLUDED from MVP** | — | — |
| Counterfeit allegation | rider **records only** | human review adjudicates | — |
**Opened-then-refused:** if outer packaging was opened and buyer refuses **without seller fault** → **buyer-fault**; categories where opening destroys resale **require payment before the inner packaging is opened**. Custody rules and dwell target (2–4 min) per Séra spec.

### 6.3 Settlement finality (by category)
**At-door acceptance = finality** for all MVP categories; the buyer enters the **drop code last, after** any door payment is provider-confirmed; **same/next-day payout**. Change-of-mind after acceptance is **not guaranteed** (goodwill only). Narrow latent defects → **platform-funded goodwill, never supplier clawback**. Post-split returns are structurally prevented in the MVP.

### 6.4 Progressive buyer-refusal ladder (OWNER: Risk; `PayAtDoorEligibility`)
Classify reason: `honest_absence | unusable_location | insufficient_balance | change_of_mind | repeated_abuse | fraud | conformity_mismatch`. **1st ordinary buyer-fault** → next order requires higher delivery commitment **or** small product deposit; **2nd** → `FULL_PREPAY` for next 3 orders (`prepayOnlyUntil`); **repeated abuse** → suspend pay-at-door; **fraud** → immediate restriction/review. **Honest absence / provider failure do NOT escalate** like change-of-mind/abuse.

### 6.5 Related-party detection (tiered; OWNER: Risk)
**Auto-void commission:** same verified identity/phone/wallet, or reseller buying through their own account. **Manual-review flag (not auto-void):** same device/household/landmark/shared phone/network — **often legitimate in Burkina Faso.** During investigation commission is **held**, not returned; appeal path; on violation → returned to seller; on clear → paid.

---

## 7. Capability specifications (Shop+ deltas; unchanged capabilities retained)
- **SP1 Activation & payout readiness** — browse/list **without capital**; payout before first payout (step-up + cooling-off); one account cannot earn recruitment comp.
- **SP2 Opportunity discovery** — deterministic quality card showing **`resellerNet` example** (net-first), commission, allowed markup, customer-price examples, stock freshness, fulfillment sample (with n), return policy, delivery serviceability; stale → block agreement.
- **SP3 Listing & storefront** — markup within cap, preview **customer price + `resellerNet`**; price change → new listing version; auto-hide on out-of-stock/blocked/expired; canonical assets enforced; **markup cap ≤ ~15–20% of B at launch** (category-tunable, pilot).
- **SP4 Marketing studio (+ PackLab Media Kit)** — compose from price-free canonical assets: cards/story/poster + **customer card (reseller price + CTA, no commission)**; lazy on-device slideshow + fallback; card **price-validity hint**; signed link/QR resolving to one reseller. **Media Kit (SP-I19, authoritative spec PackLab v2):** every promoted product carries a pre-built bundle — six photo types · 9:16/4:5/9:16/1:1/catalog formats · 10/15/20s videos + voiceover template · friendly/urgency/gift/ceremony/student captions in **French + Mooré + Dioula + voice-note script** · a **reseller-personalized card** (reseller name + **price snapshot** + Shop+ link + QR + Séra badge + truthful hub-verification badge + **validity window**) · and **variant generation** (« Pour toi-même »/« Idée cadeau »/« Nouveau stock »/« Pour étudiantes »/« Livraison quartier »/« Pack complet ») so 100 resellers never post the same image. **« Partager ce pack »** = one tap → WhatsApp Status/Facebook/TikTok/Instagram/copy caption/**play voice script**/download/generate personalized card, all on the signed-link + landing-page-truth mechanism (SP-I18/I19). Reseller identity leads (Product → Reseller → Séra → Shop+); supplier identity never appears on consignment goods; markup change expires old cards.
- **SP5 Attribution** — signed tokens; tamper fails closed; immutable after confirmation; published collision policy; no silent supplier/direct.
- **SP6 Buyer PWA checkout & tracking** — **two-option checkout (§6.1)**; immutable Quote; short reservation; provider payment (per mode, **paymentLegs**); **no duplicate charge**; buyer-safe tracking (responsible next party, masked relay, no exact rider tracking); at delivery **inspect + accept/report** (problem path equal); Option B: **buyer pays product leg, provider-confirmed, then handoff**; **reseller cannot enter the drop code**.
- **SP7 Sales workspace** — buyer-safe timeline, current actor, **`resellerNet`**, contact relay; reseller cannot mutate order; consent-scoped.
- **SP8 Earnings & reputation** — Projected/Locked/Eligible/Payable/Processing/Paid/Held/Adjusted (**net**, traced to quote/ledger, read-only except payout/appeal); **la réputation d'une revendeuse EST le nombre de ventes livrées — an exact count, never a rank, never a score, never a comparison** (founder ruling 2026-07-15). Source: `delivery.validated.v1` delivered-sale events attributed to her storefront via the **locked `Order.resellerId` (SP-I01)**. Rendered verbatim **« N ventes livrées »**, shown from the **first delivered sale (floor = 1, founder-overridable)**; deterministic and explainable in that one sentence — reinforces Ten-Laws §5 (deterministic only, no ranking/score) and the "no black-box score" guardrail. Derivation + event linkage: `docs/derivations/REPUTATION-LAW.md`. **No recruitment fields**; **20% fee is real from launch** with **net-first display**; early activation via **separately funded incentives** (first-five-sales/campaign/referral-on-completed-sale — modeled as acquisition spend, never a fee cut).
- **SP9 Cercle (build-gated — gate in §12; authoritative spec: Shop-Plus-Cercle-North-Star-Spec v2.0)** — one Cercle per reseller with **Cercle naissant** cold-start (first-ten invitation ritual, honest empty states, non-gating milestones); consent-based membership (interests/zone/frequency/language, one-tap opt-out); **three-gesture campaign creation** (recipe → product → budget) over ten curated recipes phased **v1A** (Nouveauté, Quartier, Dernières Pièces) → **v1B** (Merci, De Retour, À Racheter, Collection du Moment) → **v1C** (Parrainage, Première Commande, Choix du Cercle); the **sacred economic preview** before every paid launch (SP-I15); funding = settled-earnings allocation at the payment partner with subledger reconciliation (SP-I14); benefit lifecycle + fault-based release (SP-I16); **signed campaign landing page** authoritative over static assets (SP-I18); verified review + proof-card loop on the buyer success screen; deterministic segments + **one** daily explainable suggestion; plain-language **attributed** performance. Collection pages group products visually while preserving per-product truth, stock, and economics — no combined cart.

---

## 8. App-specific data projections
`opportunity_card` (with **net** example) · `reseller_store_view` · `reseller_sale_view` (with `paymentMode`, `amountDueAtDelivery`) · `reseller_customer_view` (consent) · `reseller_earnings_view` (**net**) · `store_index` (discoverable stores only) · `buyer_checkout_view` (paymentMode options, amountPaidAtCheckout, amountDueAtDelivery, eligibility).

---

## 9. Analytics & guardrails
From authoritative events. **Activation:** payout-ready + ≥1 agreement + ≥1 listing + ≥1 shared link. **Commercial (by payment mode):** checkout start → payment initiation → completion; paid→delivered; **buyer refusal + no-show**; delivered GMV; avg **`resellerNet`**; repeat-customer; reseller retention. **Guardrails:** attribution failures, hidden-price inconsistencies, out-of-stock exposure, misleading assets, support/delivered order — growth not rewarded when these worsen. **Cercle (post-gate):** North Star = **contribution-positive, validated Cercle orders per active reseller per month** (order qualifies only when seller net protected, effective net positive, fees reconcile, benefit funded, Séra fully funded, delivery validated, no unresolved refund); plus attributed net, opt-out + complaint rate, scheduled-window concentration — never member counts, impressions, clicks, or campaigns created alone.

---

## 10. Build sequence (after Boutik+ + Séra exist; but Shop+'s E1 thin slice runs concurrently)
1. Kernel + auth + **buyer/reseller mode switch**.
2. Opportunités (consume supply projection) + commission agreement + **pick→markup→ResellerListing (net preview)** + storefront.
3. Marketing studio + signed attribution tokens (lazy slideshow + fallback).
4. **Buyer PWA two-option checkout** (immutable Quote, reservation, provider **paymentLegs**) + attribution lock.
5. Mes commandes/Ventes (buyer-safe timeline) + **inspection + drop-code confirm** + **Option-B door payment → handoff** + equal problem path.
6. Store discovery (`store_index`, deterministic) + discoverable toggle.
7. Revenus (**net**) + reputation + Clients (consent) + **buyer-refusal ladder + related-party tiers**.
8. **(Build-gated) Cercle v1A → v1B → v1C** per the North Star spec §31 — begins only after the §12 Cercle build gate is fully satisfied.
- Each slice: state approach → read code → build → write tests → human reviews code.

---

## 11. MVP acceptance + CI invariant gates
**Acceptance:** reseller activates, sees opportunities with **net** earnings, sets markup, publishes, shares a signed link; buyer opens without install, sees **exactly one reseller** and **two clear payment options with what's-paid-now vs due**, gets an **all-in reconciling quote**, reserves, **pays once**, confirms; attribution stays locked; reseller sees **exact net** then provider-confirmed paid; out-of-stock hides future buying; **Option B: buyer pays product at door, provider-confirmed, then custody transfers**; report-issue/payment-uncertainty/supplier-timeout/failed-delivery/refund tested.
**CI gates (fail the build):** **money model reconciles**; **reseller sees net, gross-first UI prohibited**; **commission never in buyer price**; no wallet/balance module; no learned-ranking/generative libs; **discovery returns stores, not a product pool**; every order has a locked `reseller_id`, none defaults to supplier/platform; **no supplier identity/contact or commission on customer surfaces**; attribution tamper fails closed; `reseller_id` immutable after confirmation; **no duplicate charge**; **no confirmed order without funded legs for its mode**; **reseller cannot enter drop code**; **buyerDropCode never exposed to seller**; problem path equally prominent; single-level; voice = audio; French default (**French Voice Standard copy-lint — Contract §10.5**); offline = pending. **Cercle gates (active once SP9 is built):** K ≤ 0.80×(C+M) enforced at creation; no benefit advertised without secured liability; at most one benefit per order; `customerShare + campaignShare == DeliveryFeeQuote`; fully-free ⇒ FULL_PREPAY; pending earnings cannot fund; verified proof only from validated deliveries; single-level referral with related-party tiers; landing page authoritative; reconciliation divergence pauses new reservations. **Media Kit gates (SP-I19):** personalized card carries reseller identity + price snapshot, never supplier identity; identity hierarchy Product→Reseller→Séra→Shop+ never inverted; hub-verified badge only when true; markup change expires old cards (no silent edit); every asset has a validity window; media assets carry licensed/owned reuse rights.

---

## 12. Decision Required register (✅ resolved / ⏳ open)
✅ Seller/merchant model economics · ✅ canonical waterfall + two payment options + copy · ✅ markup cap (launch) + net display · ✅ settlement finality at acceptance · ✅ buyer-refusal ladder · ✅ related-party tiers · ✅ reseller 20% real from launch + funded incentives.
⏳ **Aggregator selection + BCEAO perimeter + two-leg/refund fees + auth/capture** (Real-Money Gate). ⏳ Buyer-facing legal disclosure of reseller/supplier/platform/delivery responsibilities. ⏳ Customer consent/retention/deletion. ⏳ Category-specific markup caps (tune on pilot). ⏳ Tax/invoice treatment.
⏳ **Cercle (all pre-conditions to SP9; North Star §33/§35):** build gate = ≥20 active resellers (≥3 validated deliveries each) · ≥150 cumulative validated deliveries · drop-code→settlement loop stable 4 consecutive weeks · Séra scheduled windows live · attribution stable · **payment-partner campaign-allocation structure confirmed (can settled earnings be blocked per campaign? refund/release mechanics?)** · regulatory treatment documented · review/media-consent flow approved · opt-out + frequency enforcement implemented · Boutik+ stock/pause events reliably received. Open: future MoMo top-up legality · referral-credit treatment · buyer-fault benefit treatment per recipe · moderation owner/SLA · min review count before ratings · frequency limits · first-order fraud thresholds · conditional group-unlock viability.

> Shop+ is implementation-ready only when every mandatory acceptance criterion and every applicable shared-service contract has a passing test, an operational owner, and a recovery path.
