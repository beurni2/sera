# Séra — Professional Building Plan (v3)
### Execution roadmap for the **`sera`** repo. Companion to the **Séra Professional Build Specification (v3)** and the **Ecosystem Engineering Execution Contract**.
**Status:** Execution baseline · **Version:** 3.0

> **v3 alignment:** slices, DoD, and gates now encode **rider pickup verification (bounded) + seal-after-verification custody, the Option-B doorstep payment flow with a signed break-glass HandoffAuthorization, the decomposed delivery-cost model, staged fleet-release gates, and fault-attributed Protection-Fund / custody-liability claims.**

---

## How to use this plan
- **Unit = a vertical slice** (rider/console UI → service → store → event), demonstrable + testable.
- **Agent discipline (mandatory):** state approach → **read existing code before writing** → implement → write tests encoding acceptance + the CI gate → **human reviews the code, not a summary.**
- **Definition of Done (every slice):** spec acceptance green · unit + integration tests · relevant **CI invariant gate** green · **offline through dead zones** verified (queued = pending, **never final custody/delivery**) · low-end Android / interrupted-network · human code review.
- **Standing guardrails (CI on every slice):** **exactly one assignment authority** · **one current custodian; evidence ≠ release; custody only after pickup verification + custody-seal** · **custody transfers only after provider-confirmed door payment / signed authorization; rider never accepts screenshot/SMS/verbal/pending; no personal-account payments** · **the four secrets never substituted; buyerDropCode never in seller/readiness evidence** · **GPS never sole proof; off-shift location not collected** · no platform funds · **no route-optimization/ETA ML** · single-level · **French default + French Voice Standard copy-lint (Contract §10.5)** · phone is an alias · canonical shapes from `contracts/`.
- **Sizing:** S/L/XL. **⚠ = get-the-architecture-right-here** (assignment atomicity, custody, verification, the payment-before-handoff boundary, safety).

## Environment & repo
Per-app pnpm + Turborepo workspace in the **`sera`** repo (its own deployable). Consumes **`platform-contracts`** (contracts shapes + events, kernel types, i18n catalog + French Voice copy-lint, ui tokens) as a **pinned versioned package**, with the **contracts drift-check** in CI; local `commerce-core` is read-side only (Séra never computes proceeds — SE-I09). Expo/RN rider app + web dispatch console + logistics/custody/evidence services on **Workers + Durable Objects** (single atomic assignment lease, custody transitions, **append-only hash-chained custody/evidence ledger**, idempotency). Neon; R2 (evidence + restricted docs). **No platform funds here.** Séra consumes canonical objects from `platform-contracts`; never redefined locally.

## Ecosystem alignment (E0–E6) — prove custody before batching
- **E0:** M0 + shared foundation (CI harness incl. one-assignment-authority, **custody-after-verification-and-seal**, **evidence ≠ release**, no-route-ML, off-shift-location; correlation IDs; mock-certification; device/battery budgets).
- **E1 (walking skeleton):** manual custody/delivery thin slice — manual assign → **rider verification → custody-seal → custody** → one delivery evidence → ValidationDecision → eligibility signal. **One rider, one package, no batching.**
- **E2:** failed-delivery/return + custody exceptions + **Option-B door-payment states**.
- **E3:** eligibility reconciliation + **HandoffAuthorization webhook + break-glass** against the provider sandbox.
- **E4:** SOS/fleet/payroll + **live drills** + hub reconciliation + **Protection-Fund solvency/claims by fault-class**. **Still single-job (no batching).**
- **E5/E6:** real-money gate; then **batching**, staffing SLA, DR drill.
> **Batching deferred:** RouteManifest data model stays batch-capable (M3); operational batching **off until E6**.
Every mock (Boutik+ handoff, Shop-Plus checkout/drop-code, eligibility consumer, provider) passes the **mock-certification suite** before the live sibling replaces it.

---

## Phase 0 — Foundation
| Slice | Size | DoD |
|---|---|---|
| **SE0.1 App workspace + pinned canon packages + CI harness** ⚠ | L/S | Per-app pnpm/Turborepo workspace in the `sera` repo; consumes **`platform-contracts`** as a **pinned versioned package** + local `commerce-core`; **CI enforces one-assignment-authority, custody-after-verification-and-seal, evidence ≠ release, no-route-ML, off-shift-location, no-funds, and the contracts drift-check** from the first PR. |
| **SE0.2 Rider auth/KYC/certification/shift** | M | HR/trainer/fleet; pre-shift checks + versioned privacy notice; available only after server confirm. Acceptance: **SE1** — uncertified/off-shift not assignable. |
| **SE0.3 No-address navigation primitive** ⚠ | M | Location `{pin,zone,landmark,directions,maskedRelay}`; landmark-first; masked relay; access expires. Acceptance: **SE4** — no street address; structured failed-contact reason. |

---

## Phase 1 — Dispatch
### M1 — Ready-queue intake
| **SE1.1 Ready-queue intake contract** ⚠ | M | Consume `task_ready` only when **funded per payment mode + readiness-confirmed + non-cancelled** (campaign-funded delivery shares from Shop+ Cercle count as funding: `customerShare + campaignShare == DeliveryFeeQuote`); stale → unassignable; test orders while siblings mocked. Acceptance: **SE-I02**. |

### M2 — Dispatch console + atomic assignment lease
| **SE2.1 Single atomic assignment lease (DO)** ⚠ | XL | Exactly one authority; atomic/idempotent/versioned; no self-assign; lease expiry + requeue. Acceptance: **SE2** — concurrency never double-books. |
| **SE2.2 Deterministic candidate + override** | M | Availability/distance/capacity/stale-location; override w/ reason; **no auto-assigner; no ETA/route ML**. |
| **SE2.3 Rider ack/decline** | S | Cannot pick another task; unacknowledged → requeue. |

### M3 — Route manifest + one-current-stop
| **SE3.1 Route manifest + one-current-stop** ⚠ | L | Ordered manifest; **one active route + one current stop**; **single-job (no batching)**; package accounted at close; cancelled task can't leave custody inventory. |
| **SE3.2 End-shift-with-custody exception** | M | Mandatory transfer/hub exception. |

---

## Phase 2 — Custody, verification & doorstep payment (highest-stakes)
### M4 — Pickup verification + seal-after-verification + ledger
| Slice | Size | DoD |
|---|---|---|
| **SE4.1 Hash-chained custody/evidence ledger** ⚠ | L | Append-only, tamper-evident; **one-current-custodian invariant at the store**. |
| **SE4.2 Bounded pickup verification** ⚠ | L | Rider verifies **objective conformity only** (`PickupVerificationPolicy` versioned; order ref/identity/variant/colour/size-label/qty/damage/pieces/mfr-seal); **not authenticity/quality/hidden defects**; **dwell 2–4 min**; mismatch → **refuse custody, buyer refunded, no round-trip** (fund, `faultClass=seller`). **PackLab packs arrive kitting-sealed** — the kitting seal is treated as the external seal; broken/absent → refuse custody. **`HandlingClass` flag** (e.g. sharp-object) sets handling + safe at-door inspection; never a delivery ban. |
| **SE4.3 Seal-after-verification custody** ⚠ | L | Rider applies/witnesses **custody seal → registers `custodySealId` + photos → custody begins**; single-use codes hashed; wrong package fails closed. **CI: custody only after verification + seal; buyerDropCode never in readiness evidence.** |

### M5 — Doorstep payment + HandoffAuthorization + validation
| **SE5.1 Delivery inspection + Option-B door payment** ⚠ | L | Buyer inspects (category matrix); **Option B: buyer pays product leg to aggregator merchant collection (never personal account) → authoritative provider confirmation**; insufficient-funds retry window → buyer-fault refusal + return-seal. |
| **SE5.2 HandoffAuthorization (webhook + break-glass)** ⚠ | L | Signed, single-use, bound to {order,rider,buyer,amount,providerRef,expiry}; **only an authorized operator sets `provider_confirmed` from an authoritative provider interface**; `break_glass` → `breakGlassCaseId` + mandatory incident review; **rider handoff requires a validated, unconsumed authorization**; **screenshot/SMS/verbal/pending never suffice**. |
| **SE5.3 ValidationDecision + eligibility signal** ⚠ | L | validated/hold/rejected; custody→customer (drop code last) only after validation; emit settlement-eligibility **signal only**; **failed delivery never releases**; idempotent once per order. Acceptance: **SE-I11**; evidence ≠ release. |

### M6 — Failed delivery & return
| **SE6.1 Structured failed-reason + attempt policy** ⚠ | M | Structured reasons; retry/reschedule/return/incident; **no generic failed terminal**; fault-attributed. |
| **SE6.2 Return-to-supplier (two-key) + custody preserved** ⚠ | L | Custody until two-key return + inspection; **package never unowned**; **no release from a Séra command**; Séra-caused loss → **`CustodyLiabilityClaim`** (not fund). |

---

## Phase 3 — Safety & fleet
### M7 — SOS/incident + fleet/shift/payroll + fleet gates
| **SE7.1 SOS + incident** ⚠ | L | SOS from every rider flow; ack within SLA (named); secure/quarantine custody; persistent signal until ack. *(Live drill in Phase 4.)* |
| **SE7.2 Fleet/shift records + delivery-cost model** | M | Vehicle docs/maintenance/fuel/odometer; **`DeliveryCost` decomposition (direct/return/allocated/fully-loaded, low/base/high)**; utilization + deliveries/moto/day. |
| **SE7.3 Payroll + fleet-release gates** ⚠ | M | Accrual → maker-checker approve → paid → reconcile; **delivery-fee and payroll ledgers separate; no rider-selling incentive**; **`Motorcycle.fleetTranche` gates activation — start 3–5; next 5 only at ≥8 deliveries/moto/day sustained 2 wks, failed <8%, positive contribution**. |

---

## Phase 4 — Hardening & Pilot Readiness (+ live drill)
Device matrix (rider app offline through dead zones; app-kill mid-evidence/mid-door-payment; interrupted upload; French long-text) · swap Boutik+ handoff → live; Shop-Plus checkout/drop-code → live; eligibility consumer → live · **⚠ live SOS + dispatcher-response drill before pilot** · re-run assignment concurrency, one-current-custodian, custody-after-verification+seal, payment-before-handoff, evidence ≠ release, off-shift-location · **Exit = Séra MVP acceptance (v3 §12) green + SOS drill passed.**

---

## Testing & CI strategy
- **Adversarial tests that must exist:** assignment concurrency → never double-books · custody always one current custodian (cancelled/shift-end/return) · **no single actor completes both pickup + delivery** · single-use code reuse rejected · **custody only after verification + seal** · **Option B: custody never transfers before provider-confirmed door payment / signed break-glass authorization** · **screenshot/SMS/verbal/pending never authorizes handoff; no personal-account payments** · evidence/self-declaration alone never releases · failed delivery never releases · release idempotent once per order · GPS-only never decides · off-shift location not collected · SOS visible from every rider screen.
- **CI invariant gates (block merge):** no platform-fund/wallet; no ML/route-optimization/ETA; **exactly one assignment authority; assignment atomic**; **one current custodian; evidence ≠ release; custody only after verification + custody-seal**; **custody transfers only after provider-confirmed door payment / signed authorization**; **rider never accepts screenshot/SMS/verbal/pending; no personal-account payments; four secrets never substituted; buyerDropCode never in seller/readiness evidence**; no generic failed terminal; GPS never sole proof; off-shift location not collected; money model reconciles (delivery outside fee bases); French default; offline = pending.
- **Operational gates (outside the test suite):** SOS runbook drill; payroll-vs-settlement separation audit; **fleet-release-gate sign-off before any motorcycle tranche beyond the first 3–5**.

## Decision gates
| Decision | Blocks | Default |
|---|---|---|
| Aggregator provider interface (operator verification) + two-leg/refund fees + auth-capture | M5 real money | sandbox; *pending* |
| Courier employment + insurance + accident response | M0/M7 · pilot | employee w/ full safety; *pending* |
| Delivery fee table + zones + min-margin (`DeliveryFeeQuote`) | M1/M3 · pilot | high-floor zones; conservative capacity |
| Dispatch hours + after-hours + SLA | M2 · pilot | staffed hours only |
| Evidence bundle + validation owner + dispute hold by risk tier | M4/M5 | strongest bundle; longest safe hold |
| Rider device + background-location + retention | M0 | minimal, on-shift only |
| Motorcycle licensing/registration/permits | pilot (legal to operate) | do not operate until confirmed |

## Exit criteria
Every mandatory MVP-acceptance bullet in spec §12 has a passing test, an operational owner, and a recovery path; every CI invariant gate green; **live SOS drill passed**; Boutik+ handoff + Shop-Plus drop-code/door-payment integrations live (or contract-honouring mocks/sandbox with *pending*); every §13 Decision closed or on safest default. **Because Séra's custody + verification + validation gating is what the escrow release trusts, the M4–M5 gates (verification+seal, payment-before-handoff, evidence ≠ release) must be green before any pilot with live funds; the fleet stays at 3–5 units until the operational-proof thresholds hold.**
