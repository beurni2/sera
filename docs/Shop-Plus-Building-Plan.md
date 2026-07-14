# Shop+ — Professional Building Plan (v3)
### Execution roadmap for the **`shop-plus`** repo. Companion to the **Shop+ Professional Build Specification (v3)** and the **Ecosystem Engineering Execution Contract**.
**Status:** Execution baseline · **Version:** 3.0

> **v3 alignment:** slices, DoD, and gates now encode the **canonical waterfall (reseller sees net), two-option checkout (FULL_PREPAY + delivery-fee-prepaid product-at-door with paymentLegs), category inspection + acceptance finality, the buyer-refusal ladder, and tiered related-party detection.**

---

## How to use this plan
- **Unit = a vertical slice** (UI → service → store → event), demonstrable + testable.
- **Agent discipline (mandatory):** state approach → **read existing code before writing** → implement → write tests encoding acceptance + the CI gate → **human reviews the code, not a summary.**
- **Definition of Done (every slice):** spec acceptance green · unit + integration tests · relevant **CI invariant gate** green · **offline** verified (queued = pending) · low-end Android / interrupted-network · human code review.
- **Standing guardrails (CI on every slice):** **money model reconciles; reseller sees net (gross-first UI prohibited); commission never in buyer price; delivery outside fee bases** · **discovery returns STORES, not a product pool** · **no supplier identity/contact or commission on customer surfaces** · **no duplicate charge; no confirmed order without funded legs for its mode** · **buyerDropCode never exposed to seller** · deterministic (no learned ranking/generative) · single-level · **French default + French Voice Standard copy-lint (register split — Contract §10.5)** · phone is an alias · canonical shapes from `contracts/`.
- **Sizing:** S/L/XL. **⚠ = get-the-architecture-right-here** (attribution, immutable Quote, payment idempotency, dual-mode payment, deterministic discovery).

## Environment & repo
Per-app pnpm + Turborepo workspace in the **`shop-plus`** repo (its own deployable). Consumes **`platform-contracts`** (contracts shapes + events, kernel types, i18n catalog + French Voice copy-lint, ui tokens) as a **pinned versioned package**, with the **contracts drift-check** in CI; local `commerce-core` package implements against the pinned shapes — the **immutable Quote (reconciling waterfall + paymentLegs)** and the atomic reservation remain single-owner concerns per Contract §2.2. Expo/RN reseller app **+ buyer PWA** + storefront/attribution/discovery services. Buyer surface = web/PWA (Playwright). **BCEAO-licensed aggregator** (no app holds funds). Shop+ consumes canonical objects from `platform-contracts`; never redefined locally.

## Ecosystem alignment (E0–E6) — the first transaction lives here
- **E0:** M0 + shared foundation (CI harness incl. **money-reconciliation** + **net-first-display** + **discovery-returns-stores** gates, correlation IDs, mock-certification, PWA/device budgets).
- **E1 (walking skeleton, concurrent with siblings):** minimal PWA + attribution — one listing (**net preview**) → signed link → **immutable reconciling Quote** → reserve → **one sandbox payment leg** → drop-code confirm. (Test **FULL_PREPAY** first; add Option-B door leg at E2/E3.)
- **E2:** checkout failure paths + attribution collisions + **Option-B door-payment states**.
- **E3:** real provider sandbox + webhook verify/retry/reconcile + **two-leg fees** + refund/earning-reversal saga.
- **E4:** discovery, reputation, Clients, PWA budgets + **buyer-refusal ladder + related-party tiers** + operational sections.
- **E5:** real-money checkout on (Real-Money Gate). **E6:** browser-compat + load.
Every mock (Boutik+ projection, Séra delivery/handoff, provider) passes the **mock-certification suite** before the live sibling replaces it.

---

## Phase 0 — Foundation
| Slice | Size | DoD |
|---|---|---|
| **SP0.1 Import pinned canon packages + CI harness** | S | Per-app workspace in the `shop-plus` repo; consumes **`platform-contracts`** (contracts/kernel/i18n-catalog/ui tokens) as a **pinned versioned package** + local `commerce-core`; enforce **money-reconciliation, net-first-display, discovery-returns-stores, attribution-tamper-fails-closed, no-supplier-contact, single-level, French Voice copy-lint, and the contracts drift-check** from the first PR. |
| **SP0.2 Reseller + buyer auth** | M | Phone-alias; reseller activation (store name/zone/category focus); payout separate + cooling-off; buyer minimal session. Acceptance: **SP1** — browse/list **without capital**; cannot be paid until payout verified; no recruitment comp. |
| **SP0.3 Two-mode shell + switch** | S | Default Acheter; switch to Espace revendeur; reseller tabs gated. |

---

## Phase 1 — Reseller core
### M1 — Opportunités → Listing → Storefront
| Slice | Size | DoD |
|---|---|---|
| **SP1.1 Consume supply projections (net-first)** | M | Quality card shows **`resellerNet` example** + commission + allowed markup + customer-price examples + stock freshness + fulfillment sample (n) + return policy + serviceability; stale → block. **CI: net shown, not gross.** |
| **SP1.2 Commission-agreement acceptance** | S | Bound to offer version. |
| **SP1.3 Listing + markup (net preview) + storefront** ⚠ | L | Markup within cap (**≤~15–20% of B launch**); preview **customer price + `resellerNet`**; price change → new listing version; auto-hide on out-of-stock/blocked/expired; canonical assets enforced. |

### M2 — Marketing studio + attribution tokens
| **SP2.1 Signed attribution tokens** ⚠ | M | Signed; tamper fails closed; rotatable keys. |
| **SP2.2 Deterministic studio** | M | Compose from price-free canonical assets; **customer card renders reseller price + CTA, no commission**; card **price-validity hint**; signed link/QR → one reseller. |
| **SP2.3 Lazy slideshow + fallback** | S | Queued, cancellable, static fallback. |

---

## Phase 2 — Buyer flow (highest-stakes)
### M3 — Two-option checkout + attribution lock
| Slice | Size | DoD |
|---|---|---|
| **SP3.1 Attribution resolution + lock** ⚠ | M | Validate token → name reseller → quote locks `reseller_id` → immutable at confirmation; collision policy; no silent supplier/direct. |
| **SP3.2 Immutable reconciling Quote + reservation** ⚠ | L | Quote carries the **full waterfall + paymentMode + amountPaidAtCheckout/amountDueAtDelivery**; **reconciles (CI)**; short reservation (atomic). No confirmed order without funded legs. |
| **SP3.3 Two-option payment (paymentLegs)** ⚠ | L | **A: full leg; B: delivery leg now, product leg due**; provider sandbox; **idempotent (no duplicate charge)**; **« À payer maintenant / à la livraison »** UI (§6.1 copy, no « escrow »); Option-B eligibility gate (tier/category/price/zone/buyer). |

### M4 — Tracking, inspection, door payment & problem path
| **SP4.1 Buyer-safe tracking** | M | Responsible next party; masked relay; no exact rider tracking. |
| **SP4.2 Inspection + drop-code confirm + equal problem path** ⚠ | M | Category matrix outcome; **Option B: buyer pays product leg → provider-confirmed → handoff → drop code last**; **reseller cannot enter drop code**; problem path equal. |
| **SP4.3 Sales workspace** | M | Buyer-safe timeline; **`resellerNet`**; cannot mutate order; consent-scoped. |

---

## Phase 3 — Discovery, retention, risk
### M5 — Store discovery
| **SP5.1 store_index (deterministic)** ⚠ | L | Découvrir/Rechercher return **STORES**; matching-item preview only; **not a product pool**. |
| **SP5.2 Discoverable toggle + moderation** | S | Off by default; store-name moderation. |

### M6 — Revenus, reputation, Clients + buyer/related-party risk
| **SP6.1 Earnings read model (net)** | M | Projected/Locked/Eligible/Payable/Processing/Paid/Held/Adjusted (**net**, traced); **20% real from launch**; no withdrawal. |
| **SP6.2 Reputation (delivered-sales count)** | M | **Réputation = the exact count of delivered sales** (« N ventes livrées »), sourced from `delivery.validated.v1` attributed via the locked `Order.resellerId` (SP-I01); never a rank/score/comparison; shown from the first delivered sale (floor 1, founder-overridable); deterministic + explainable — the ultimate plain driver, no black-box score. See `docs/derivations/REPUTATION-LAW.md`. |
| **SP6.3 Clients + buyer-refusal ladder + related-party tiers** ⚠ | M | Consent-scoped customers; **progressive refusal ladder (`PayAtDoorEligibility`)**; **tiered related-party** (auto-void on identity/phone/wallet; device/household = review, not auto-void). |

---

## Phase 4 — Hardening & Pilot Readiness
Device matrix (low-end Android reseller app cached; **PWA on low-end browsers**; payment retry; French long-text) · swap Boutik+ projection → live; Séra delivery/handoff → live; provider → aggregator sandbox · re-run reconciliation, net-first, tamper-fails-closed, no-double-charge, funded-legs, problem-path-equal · **Exit = Shop+ MVP acceptance (v3 §11) green.**

---

## Phase C — Cercle (build-gated; runs ONLY after the spec §12 Cercle gate is fully green)
**Goal:** prove `campaign allocation → attributed order → Séra delivery → verified proof → next campaign` with the same discipline as core money flows. Authoritative feature spec: **Shop-Plus-Cercle-North-Star-Spec.md (v2.0)**. Standing guardrails add the **Cercle CI gates** (spec §11) from the first Cercle PR.

### C1 — v1A: prove the core loop
| Slice | Size | DoD |
|---|---|---|
| **C1.1 Cercle shell + naissant + vitrine + consent join** ⚠ | L | One Cercle/reseller; creation flow generates invitation card/message/voice script/QR/code/link; **first-ten ritual** from validated customers (reseller sends every invite); honest empty states (no fake counts; ratings only ≥ min verified reviews); 5-step join with explicit consent + one-tap opt-out + frequency prefs. **CI: consent recorded before membership; opt-out enforced everywhere.** |
| **C1.2 Recipes v1A + three gestures + sacred preview** ⚠ | L | Nouveauté, Quartier, Dernières Pièces as pre-assembled recipes; three-gesture builder; **sacred economic preview** with hard block `K > 0.80(C+M)` + soft warning <50%; recipe stop conditions (expiry/stock/max-rewarded/pause); Quartier progress = momentum language only. **CI: K-gate; one benefit per order.** |
| **C1.3 Funding allocation + subledger + reconciliation pause** ⚠ | XL | Settled-earnings allocation blocked/redirected **at the payment partner** (no MoMo top-up); balances Available/Pending/Allocated/Spent/Returning; benefit lifecycle Reserved→Committed(at dispatch for delivery benefits)→Consumed\|Released with fault routing (seller→fund; **Séra→CustodyLiabilityClaim**; provider→provider); continuous provider reconciliation; **divergence → PAUSED_RECONCILIATION for new reservations, customer promises protected**. **CI: pending never funds; advertised ⇒ secured; reconciliation-pause.** |
| **C1.4 Signed landing pages + asset packs** ⚠ | M | Campaign-signed links (attribution + `campaignId`); landing page authoritative (price/stock/status/remaining benefit/zone/modes) incl. ended-campaign states; WhatsApp/Facebook/TikTok/QR packs with validity wording; `DeliveryFeeQuote`-priced benefits, `customerShare+campaignShare==quote`, **fully-free ⇒ FULL_PREPAY**. **CI: stale asset never binds an unfunded benefit.** |
| **C1.4b PackLab Reseller Media Kit + « Partager ce pack »** ⚠ (SP-I19) | M | Pre-built bundle per promoted product (6 photo types · 5 formats · 3 videos + voiceover · FR/Mooré/Dioula captions + voice script); reseller-personalized card (reseller identity + **price snapshot** + link + QR + Séra + truthful hub badge + **validity window**); variant generation (anti-spam); « Partager ce pack » one-tap multi-channel; markup change **expires** old cards; **licensed/owned reuse rights** required. Media-Kit funding: platform (PackLab) / supplier studio-fee (graduated). **CI: reseller identity never supplier; hierarchy not inverted; badge truthful; old cards expire not edit; validity window on every asset.** |
| **C1.5 Verified review + proof loop** | M | Post-validated-delivery invite on the buyer success screen; rating/text/voice/photo/video + media consent; branded proof card; fraud → verified status revoked. **CI: proof only from validated deliveries.** |
| **C1.6 Attributed results v1** | S | Allocated/consumed/attributed-net/effective-net-per-order; funnel; plain-language interpretation with fixed thresholds; **“attributed,” never causal**. |

### C2 — v1B: retention & merchandising
Merci · De Retour · À Racheter (deterministic reorder windows, consent-gated reminders, frequency caps) · Collection du Moment (visual grouping, per-product truth, no combined cart) · segments (deterministic) · **one** daily explainable suggestion · communication-preference enforcement.

### C3 — v1C: acquisition & engagement
Parrainage (reward reserved at referral, released only on validated delivery; **related-party tiers**: identity/phone/wallet auto-void, device/household review) ⚠ · Première Commande (one reward per verified customer; multi-account controls; fraud thresholds) · Choix du Cercle (honest voting, no reservation/consent creep) · referral accounting · advanced reporting · MoMo top-up **only if the Decision closes as legal**.

## Testing & CI strategy
- **Adversarial tests that must exist:** attribution tamper → fails closed · two-qualified-links collision · `reseller_id` immutable after confirmation · **payment retry → no duplicate charge** · **no order without funded legs for its mode** · **Quote reconciles** · **net shown not gross** · discovery never returns a flat product list · no commission/supplier-contact on any customer surface · problem path equally prominent · **buyerDropCode never exposed to seller** · Option-B eligibility respected.
- **CI invariant gates (block merge):** money reconciles; **reseller sees net (gross-first prohibited)**; commission never in buyer price; no wallet/balance; no learned-ranking/generative; **discovery returns stores**; locked `reseller_id`, none defaults to supplier/platform; no supplier identity/contact/commission on customer surfaces; attribution tamper fails closed; `reseller_id` immutable; **no duplicate charge**; **no confirmed order without funded legs**; **reseller cannot enter drop code**; problem path equal; single-level; voice = audio; French default; offline = pending.

## Decision gates
| Decision | Blocks | Default |
|---|---|---|
| Aggregator + BCEAO perimeter + two-leg/refund fees + auth-capture | M3 real money | sandbox; *pending* |
| Buyer-facing legal disclosure | M3/pilot | conservative disclosure |
| Customer consent/retention/deletion | M6.3 | minimum-data; explicit consent |
| Category markup caps | M1.3 | tight cap; tune on pilot |
| Tax/invoice | pilot | retain |
| **Cercle build gate (spec §12; North Star §33)** | all of Phase C | Cercle stays direction, not work order |
| **Campaign-allocation structure at partner** (per-campaign blocking, refund/release, top-up legality) | C1.3 · C3 top-up | settled-earnings allocation only; top-up *pending* |
| **Cercle policy set** (moderation owner/SLA, min-review count, frequency limits, buyer-fault benefit per recipe, first-order fraud thresholds) | C1.x/C3 | strictest safe defaults |

## Exit criteria
Every mandatory MVP-acceptance bullet in spec §11 has a passing test, an operational owner, and a recovery path; every CI invariant gate green; Boutik+ projection + Séra delivery/handoff + aggregator integrations live (or sandbox with *pending*); every §12 Decision closed or on safest default. **Because this app first moves real money end-to-end, the reconciliation + no-double-charge + funded-legs + attribution gates (M3) must be green before any pilot with live funds.** **Cercle (Phase C) is explicitly outside MVP exit** — it starts only on its own build gate and ships v1A→v1B→v1C with the Cercle CI gates green at each step.
