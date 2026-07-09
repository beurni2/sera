# Boutik+ — Professional Building Plan (v3)
### Execution roadmap for the **`boutik-plus`** repo. Companion to the **Boutik+ Professional Build Specification (v3)** and the **Ecosystem Engineering Execution Contract**. The spec defines *what* must be true; this plan defines *how* and *in what order*, and *how each step is proven done*.
**Status:** Execution baseline · **Version:** 3.0

> **v3 alignment:** slices, DoD, and gates now encode the consolidated model — **canonical waterfall (5% seller fee), zero-deposit seller tiers, package-readiness gate, rider pickup verification + seal-after-verification custody, the capitalized Protection Fund, and settlement finality.**

---

## How to use this plan
- **Unit = a vertical slice** (UI → service → store → event), demonstrable + testable.
- **Agent discipline (mandatory):** state approach → **read the existing code before writing** → implement → write tests encoding the spec's acceptance + the relevant CI gate → **human reviews the code, not a summary.**
- **Definition of Done (every slice):** spec acceptance green · unit + integration tests · relevant **CI invariant gate** green · **offline** verified (queued = pending) · low-end Android / interrupted-network check · human code review.
- **Standing guardrails (CI on every slice):** **money model reconciles (spec 5.4); commission never in buyer price; delivery outside fee bases; reseller sees net** · **zero seller deposit/reserve** · **buyer refund never gated on the Protection Fund** · **custody only after pickup verification + custody-seal** · **the four secrets never substituted** · deterministic imaging (no AI) · single-level · **French default + French Voice Standard copy-lint (register split, 6th-grade reading level — Contract §10.5)** · phone is an alias · canonical shapes from `contracts/`, never redefined.
- **Sizing:** S/L/XL = complexity. **⚠ = get-the-architecture-right-here** (money, custody, verification, atomicity, imaging boundary) — write adversarial tests first.

## Environment & repo
Per-app pnpm + Turborepo workspace in the **`boutik-plus`** repo (its own deployable). Consumes **`platform-contracts`** (contracts shapes + events, kernel types, i18n catalog + French Voice copy-lint, ui tokens) as a **pinned versioned package**, with the **contracts drift-check** in CI; local `commerce-core` package implements against the pinned shapes (authoritative hosting of Checkout&Order / Ledger&Settlement per Contract §2.2). Expo/RN supplier app + supplier/catalog/media/offer/inventory/fulfillment services on Workers + Durable Objects. Stack: Expo/RN · Workers + DO · Neon · R2 · BCEAO-licensed aggregator (no app holds funds). Shell: Git Bash; `winpty claude`.

## Ecosystem alignment (E0–E6)
- **E0:** M0 + shared foundation — CI gate harness (incl. **money-reconciliation** + **no-seller-deposit** gates), correlation IDs, migration + mock-certification standards, device budgets, **Protection Fund schema + founder opening-capital capitalization is an E0/pre-live-money deliverable** (owned in commerce-core; Boutik+ reads it).
- **E1 (walking skeleton, before deep phases):** thin vertical — one supplier (zero-cost, provisional) → one product, **one premium-framed image** (no cleanup) → one offer/commission (**reconciling**) → supply projection → package-readiness → **rider verification + custody-seal** handoff (Séra mock). **B+2 safe-cleanup + hostile corpus deferred to E4.**
- **E2:** fulfillment/readiness/pickup-verification failure paths → recovery + reconciliation alerts.
- **E3:** settlement reconciliation read model against the provider sandbox.
- **E4:** full Studio (M1–M2) + inventory hardening + moderation-queue alerts + operational sections.
- **E5/E6:** real-money gate; hostile-corpus freeze, R2 lifecycle, capacity.
Every mock (Séra handoff, Shop-Plus projection, provider) passes the **mock-certification suite** before the live sibling replaces it.

---

## Phase 0 — Foundation
**Goal:** deployable shell; **zero-cost onboarding**; provisional seller tier; CI gate harness (money-reconciliation + no-deposit + imaging) live from slice one.

| Slice | Size | DoD |
|---|---|---|
| **B0.1 App workspace + pinned canon packages + CI harness** ⚠ | L/S | Per-app pnpm/Turborepo workspace in the `boutik-plus` repo; consumes **`platform-contracts`** (contracts/kernel/i18n-catalog/ui tokens) as a **pinned versioned package** + local `commerce-core`; **CI enforces money-reconciliation, no-seller-deposit, single-level, French + French Voice Standard copy-lint (§10.5), phone-alias, imaging-architecture stubs, and the contracts drift-check** from the first PR. |
| **B0.2 Zero-cost onboarding + phone-alias verify** | M | Product-only fields; **no deposit/bond/subscription**; new sellers = **provisional** (`SellerTrustState`); re-entry checks on real identity signals. Acceptance: **B+1**; unverified cannot publish; duplicate idempotent. |
| **B0.3 Verification + Ops hook + trust tiers** | M | Provisional limits (one order, FULL_PREPAY-only, launch categories); progression thresholds (pilot params); access-based consequences. |

**Gates — CI:** money-reconciliation, no-seller-deposit, single-level, French, phone-alias. **Decision:** verification/progression thresholds (pilot params).

---

## Phase 1 — Catalog & Studio
### M1 — Boutik+ Studio (capture → normalize → cleanup)
| Slice | Size | DoD |
|---|---|---|
| **B1.1 Guided capture** | M | Category-aware Hero+Proof; on-device metrics on downscaled frames; in-app camera; voice notes. |
| **B1.2 Deterministic normalization** ⚠ | L | Conservative WB/exposure (no clip); safe-box crop; derivatives; EXIF strip; pHash; before/after + use-original-colours; faithfulness tests. |
| **B1.3 Three-outcome cleanup + hostile corpus** ⚠ | XL | Eligibility → safe/premium/retake; **hostile-image corpus IS the gate.** *(Deferred past E1; premium-frame default until E4.)* |

**Gates — CI (imaging):** no segmentation/generative/classification/inference; no server render; price-free; contact-free; master≠derivative; original retained; EXIF stripped; device gates.

### M2 — Media publication & moderation
| **B2.1 Canonical publication → R2** | M | Private master (immutable) + price-free derivatives + hashes + seller confirmation. |
| **B2.2 Moderation + neutral-packaging rule** | M | Moderation timeout = pending; **neutral/platform packaging rule** (no supplier branding/contact; checked at pickup). |

### M3 — Product/variant & versioning
| **B3.1 Product + variant + versioning** ⚠ | L | Stable variant IDs; ProductVersion activation; change → new version; byte-stable. |
| **B3.2 Public vs reseller projection separation** | M | Supplier identity/contact omitted. |

---

## Phase 2 — Economics & Stock
### M4 — Offer & commission (canonical waterfall) + supply projection
| Slice | Size | DoD |
|---|---|---|
| **B4.1 Offer + commission (5.4 waterfall)** ⚠ | L | Seller sets **B + C**; sees **`sellerNet`** + receivable examples via the **reconciling waterfall (5% of B)**; floor block; **category floor ≥5,000**; versioned. **CI: reconciliation on every quote/offer preview.** |
| **B4.2 Supply-to-reseller projection** ⚠ | M | Only approved active eligible; never contact/precise pickup/mutable amount; shape matches Shop+'s read. |

**Decision:** platform-fee % is **set (5%)**; launch/prohibited categories + floor.

### M5 — Inventory & stock truth
| **B5.1 Atomic reservation (Durable Object)** ⚠ | L | Reserve/release atomic; no negative; concurrency test. |
| **B5.2 Immutable adjustments + reconfirmation freeze** | M | Journal; overdue → freeze; challenge capture. |
| **B5.3 Availability projections** | S | Out-of-stock hides across stores within SLA. |

---

## Phase 3 — Fulfillment & Money
### M6 — Readiness gate + Séra pickup verification + seal-after-verification
| Slice | Size | DoD |
|---|---|---|
| **B6.1 Fulfillment lifecycle** | M | Accept/reject; prepare in **inspectable outer packaging**; locked variant/qty/`sellerNet`/deadline; timeout → refund saga. |
| **B6.2 Package-readiness gate** ⚠ | M | **« Produit prêt »** with photo + **`sellerReadinessChallenge`** (short-TTL) + qty/variant/availability → **only then enters dispatch queue**. **CI: no pickup task before readiness; readiness challenge distinct from all other secrets.** |
| **B6.3 Séra pickup verification + custody seal** ⚠ | L | Rider verifies **objective conformity** vs locked order → mismatch → **refuse custody, buyer refunded, no round-trip**; pass → **custody seal registered → custody begins**. **Invariant B+I-14** (provisional). *(Séra mocked, contract-honouring.)* **CI: custody only after verification + custody-seal; buyerDropCode never in readiness evidence.** |

### M7 — Settlement (Protection-Fund-aware; seller never debited)
| **B7.1 Settlement projection read model** | M | Locked/Pending/Eligible/Processing/Paid/Held/Failed; **same/next-day after validated acceptance**; provider-confirmed ref before Paid; no withdrawal; no local balance. |
| **B7.2 Statements + trust/consequence view** | S | Server-generated; **seller-fault losses do NOT debit the seller** (Protection Fund absorbs); trust-tier consequences shown. |

**Decision:** aggregator flow + BCEAO perimeter + two-leg/refund fees (Real-Money Gate).

---

## Phase 4 — Hardening & Pilot Readiness
Device matrix (low-end Android, low storage, app-kill, interrupted upload, offline queue, French long-text) · swap Séra mock → live pickup verification/custody-seal once Séra M5 ships · swap provider mock → aggregator sandbox once perimeter closes · re-run hostile corpus + reservation concurrency + custody-after-verification gates · **Exit = Boutik+ MVP acceptance (v3 §11) green** + every §12 Decision closed or on safest default.

---

## Phase 5 — PackLab (build-gated; runs ONLY after the spec §12 PackLab gate is satisfied)
**Goal:** stand up the `PLATFORM_OWNED` supply mode as the Founding Catalog Engine with the same discipline as the money core. Authoritative feature spec: **Shop-Plus-PackLab-Founding-Catalog-North-Star.md (v2)**. Standing guardrails add the **PackLab CI gates** (spec §11) from the first PackLab PR. *(Diaspora / `HUB_CONSIGNMENT` is a separate, later fold — not in scope here.)*

| Slice | Size | DoD |
|---|---|---|
| **B9.1 Platform-owned mode + platform-seller actor** ⚠ | L | `supplyMode=PLATFORM_OWNED` on Product/Version; internal platform-seller actor with **no consumer channel** (B+I-15); reuses Catalog/Media/Offer projections. **CI: PackLab never exposes a storefront/checkout.** |
| **B9.2 BOM model + deterministic min-availability** ⚠ | L | `PackProduct`/`PackComponent`; availability = min over components of floor(available/qty), service-derived; component-level reservation; shared components sell solo. **CI: availability = deterministic component-min; funding-check solo per pack.** |
| **B9.3 Component allocation (marketplace wins ties)** ⚠ | M | Reserved assembly floor per active pack; **solo sales never throttled above floor**; floor pressure → `REORDER_NEEDED` (+ optional supplier/consignment alternative); honest BOM-min degrade. **CI: no solo-sales brake to protect packs.** |
| **B9.4 Kitting station (kit → QC → seal-at-kitting)** ⚠ | L | `KittingJob`; pack enters dispatch queue on **kitting seal**, parallel to seller readiness; **handling class** set (B+I-20) with Séra flag; neutral packaging. **CI: pack dispatch only after kitting seal; handling flag propagates to Séra.** |
| **B9.5 Three recede ceilings** ⚠ | XL | `PackLabCeilings`; cash exposure **blocks PO at creation**; catalog share **caps promoted surface**; rolling 90-day GMV **throttles promotion**; readiness-gated glide 60–80%→≤30%; ties → PackLab stops buying. **CI: PO blocked on cash/catalog breach; promotion throttled on GMV breach.** |
| **B9.6 Restock Law** ⚠ | M | `RestockDecision` gate: ≥60-day sell-through + defect/conversion thresholds + ceilings-clear + funding-pass + no-better-alternative + size ≤ X× trailing-30-day. **CI: no restock without all conditions.** |
| **B9.7 Six-question gate + covenant + Supplier Upgrade Path** | M | Gate blocks launch/restock if any of the six answers is unclear; covenant offer (right of first refusal) precedes any replication; graduated supplier products earn PackLab-grade Media Kit + promotion eligibility. **CI: covenant offer precedes replication.** |
| **B9.8 Launch waves + electronics gate + component returns** | S | Six packs in three waves; no electronics before capability gate; component-level return resolution (whole-pack only for severe mismatch/fraud/at-door rejection). |

## Testing & CI strategy
- **Adversarial tests that must exist:** hostile-image corpus · reservation concurrency/no-oversell · **money-model reconciliation on every quote/offer** · **no-seller-deposit (no reserve field/flow)** · **readiness-before-dispatch** · **custody-only-after-verification+seal** · **buyerDropCode never in readiness evidence** · seal uniqueness · handoff idempotency + no-supplier-self-handoff · no-contact-in-projection · **(PackLab) component-min availability · funding-check-solo · no-solo-throttle · PO-blocked-on-ceiling · no-restock-without-conditions · PackLab-has-no-storefront.**
- **CI invariant gates (block merge):** money reconciles; no wallet/balance; **no seller deposit**; no consumer storefront/checkout; imaging gates (no segmentation/generative/classification/inference, no server render, price-free, contact-free, master≠derivative, original retained, EXIF stripped, hostile corpus + device gates); **custody only after verification + custody-seal**; **four secrets never substituted**; **buyer refund never fund-gated**; single-level; voice = audio; French default; offline = pending.

## Decision gates
| Decision | Blocks | Default |
|---|---|---|
| Aggregator + BCEAO perimeter + two-leg/refund fees | M7 real money | sandbox; *pending* |
| Protection Fund opening capital + allocation % | live money | seed conservative; calibrate to pilot |
| Verification/progression thresholds | M0/M3 | provisional limits |
| Launch/prohibited categories + floor | M2/M4 | block category; floor ≥5,000 |
| Merchant-of-record & agency model | pilot | conservative disclosure |
| Tax/invoice/retention | pilot | retain; no irreversible payout |
| **PackLab build gate + platform-owner legal/merchant structure** | all of Phase 5 | PackLab stays direction, not work order |
| **Three ceiling values** (cash cap · catalog-share % · GMV glide) | B9.5 | strictest safe defaults; recede readiness-gated |
| **PackLab policy set** (restock multiple X · six-question + upgrade score · Media-Kit funding split · handling-class standards · electronics-gate criteria) | B9.x | strictest safe defaults |

## Exit criteria
Every mandatory MVP-acceptance bullet in spec §11 has a passing test, an operational owner, and a recovery path; every CI invariant gate green; Séra pickup-verification/custody-seal + aggregator integrations live (or on contract-honouring mock/sandbox with *pending*); every §12 Decision closed or on safest default. **The reconciliation gate, no-seller-deposit gate, and custody-after-verification gate must be green before any pilot with live funds.** **PackLab (Phase 5) is explicitly outside MVP exit** — it starts only on its own build gate and ships B9.1→B9.8 with the PackLab CI gates green at each step.
