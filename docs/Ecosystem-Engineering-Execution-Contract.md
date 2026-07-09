# Boutik+ × Shop+ × Séra — Ecosystem Engineering Execution Contract
### The program-level delivery plan **above** the three app building plans. Boutik+, Shop+, and Séra each reference these exact E-milestones; **an app being "green" is necessary but never sufficient — the ecosystem milestone gates.**
**Status:** Program baseline · **Version:** 1.0 · **Audience:** founder + coding agents + reviewer + operations

> **Staging note (read first).** This contract adds the release-engineering, observability, security-ops, migration, DR, and coordination layer the app plans lacked. It is **staged against E0–E6 for a solo founder working with stateless coding agents** — a thin foundation at E0, heavy operational machinery at E3–E4, an independent penetration test at E6. It is **not** twelve SRE programs to stand up before any code. The ordering principle is: **prove the loop end-to-end before deepening any app, then add operational weight exactly where real money and real custody arrive.**

---

## 0. Why this exists — the integration cliff
The three app plans are product-correct: they turn business rules into build-blocking tests. But each can be individually green while the **ecosystem is incompatible**, because the current order (kernel → Boutik+ and Séra in parallel → Shop+ last) puts the **first real buyer payment and the first complete commercial loop too late**, and because **a mock can faithfully implement a contract while hiding the producer's real timing, retry, identity, and failure behaviour.** This contract fixes both: a **walking skeleton before deep app work**, and a program layer (milestones, dependency graph, mock-certification, observability, security, migration, DR, runbooks, the real-money gate).

---

## 1. Ecosystem milestones (E0–E6)
Each milestone has binary **exit criteria**. App plans map their phases onto these (§9).

### E0 — Engineering foundation
**Goal:** the repo topology (below), shared `contracts/`, CI gate harness, environments, the flag/kill-switch harness, the correlation chain, the migration + mock-certification standards, secrets/key-custody design, named device budgets, and ADR/ownership exist **before feature depth**.

> **Repo topology (founder decision, locked):** **three separate app repos** — `boutik-plus`, `shop-plus`, `sera` — each a per-app workspace and its own deployable, **plus a fourth shared repo `platform-contracts`** holding `contracts/` (shapes + events), `kernel` types, the i18n string catalog + French Voice copy-lint, and the `ui` design tokens. The apps consume `platform-contracts` as a **pinned, versioned package**; "§5 identical across all three specs" is thereby enforced **by construction**, with a CI drift-check in every app repo that fails on any divergence from the pinned canon version. Canonical `/docs` live in `platform-contracts`; each app repo carries a CI-drift-checked copy. The three apps are three products — never unified into a single app.
**Exit (binary):** CI runs on every PR with the standing invariant gates enforced · `kernel`+`contracts`+`commerce-core` published internally · local/test/staging environments isolated · the **feature-flag + kill-switch service** is live and a demo capability can be toggled remotely · **correlation IDs flow through a hello-world transaction** · the migration standard (§4), mock-certification standard (§3), and security baseline (dependency + secret scanning in CI, signing-key custody design) are written and enforced · the **reference device + performance budgets (§7) are named**.
**Not needed yet:** any polished feature, real provider, real fleet.

### E1 — Sandbox walking skeleton ⭐ (the single most important milestone)
**Goal:** one extremely narrow transaction traverses the **entire** loop on sandbox rails, proving the contracts, identities, events, retries, custody, and money boundary actually fit together. The fifteen steps (§2.3) execute end-to-end. **No polished Studio, discovery, batching, dashboards, or payroll.**
**Exit (binary):** the 15-step transaction completes with **one correlation chain** linking `quote_id → reservation_id → payment_attempt_id → order_id → package_id → delivery_task_id → validation_id → settlement_obligation_id → provider_payout_id` · the first mocks pass the **mock-certification suite (§3)** · the chain is visible on a basic dashboard.
**Not needed yet:** failure-path completeness, real provider, real fleet, performance tuning.

### E2 — Failure-complete transaction
**Goal:** every **failure path** on the skeleton behaves correctly — not just the happy path.
**Exit (binary):** each adversarial scenario in §6 (reservation-held-after-payment-fail, paid-order-no-supplier-decision, ready-package-no-task, impossible-custody, evidence-not-validated, settlement-eligible-not-submitted, payout-not-reconciled, offline-backlog) produces the **defined recovery state + a reconciliation alert** · the first-tranche **runbooks (§5)** for these exist and are versioned · DLQ + stuck-saga detection live.

### E3 — Provider reconciliation
**Goal:** the **real aggregator sandbox** replaces the payment mock, with full webhook verification, retry, timeout, and **settlement reconciliation**.
**Exit (binary):** webhook signatures validated · duplicate/out-of-order/delayed webhooks handled idempotently · **provider payout submitted → reconciled** end-to-end on sandbox · provider-latency monitoring live · a pre-real-money **security review** is scheduled · the **legal/provider Decisions (D1/D2 in each app)** are closing.

### E4 — Closed operational pilot
**Goal:** the **full real operational stack** — real fleet, real suppliers/resellers, invited buyers — exercised at **tiny volume behind all kill switches**, with the team watching every transaction. This is where **operations** are learned (handoffs, custody, exceptions, dispatch, returns, SOS).
**Money rule:** if any **real** money flows in the pilot, the real-money-gate binaries for that scope (§8) — **BCEAO perimeter confirmation, reconciliation, refunds, payout-failure handling, restore-tested** — MUST already hold; otherwise the pilot runs on the **provider sandbox / capped controlled mode**.
**Exit (binary):** mobile **staged rollout + rollback drill** passed (rollback requires **no** new app build) · first **backup restore drill** passed · the **full runbook registry (§5)** exists with named owners · **on-call** defined (even if founder + escalation) · **physical-ops SOPs versioned + rider training acknowledged** · dispatcher/incident-response **staffing SLA** defined · **unit-economics telemetry (§6) live** (cost/order, batching rate, fee absorption).

### E5 — Real-money launch
**Goal:** open beyond the invited set; real public money.
**Exit = the Real-Money Gate (§8) passes in full** — every binary proof green, **BCEAO license-perimeter written confirmation first**.

### E6 — City production readiness
**Goal:** full scale in city 1.
**Exit (binary):** independent **penetration test** passed with no unresolved severity-1 · SLO/alerting matured with on-call rotation · **DR / regional-and-provider-outage procedures** documented and drilled · capacity validated under projected city load.

---

## 2. The walking skeleton, dependency graph & critical path

### 2.1 Cross-app dependency graph
```
@platform/kernel + @platform/contracts (shared, frozen-enough for E1)
        │
        ├── commerce-core (User, Order, immutable Quote, EscrowTxn, SettlementObligation, order state machine)
        │
   ┌────┴───────────────┬──────────────────────────┐
Boutik+ (supply)     Séra (custody/delivery)     Shop+ (reseller + buyer + checkout)
   │  supply projection ─────────────────────────────▶ Opportunités / listing
   │                       pickup-handoff ◀── package ready
   │                       custody → evidence → ValidationDecision ──▶ settlement-eligibility signal
   └──────────────────────────────────────────────────▶ buyer Quote → reservation → payment → order
```
**Critical path** runs through the **money/custody boundary**, not through any single app's feature depth: `Quote → reservation → payment(hold) → package/seal → pickup custody → delivery evidence → ValidationDecision → settlement-eligibility`. Everything on this path is built **thin first (E1)**, hardened later. Studio cleanup, discovery, batching, dashboards, and payroll are **off** the critical path and are deferred past E1.

### 2.2 Shared-service ownership & contract readiness
"Owner" here = the **single accountable definition in `contracts/`**, hosted by one app; no second definition may exist.
| Domain / contract | Definition lives in | Hosted by | E1 status target |
|---|---|---|---|
| Kernel (identity, Location, i18n, offline, media) | `contracts` + `kernel` | shared | **frozen-enough** |
| User / Order / immutable Quote / EscrowTxn / SettlementObligation / order state machine | `contracts` | commerce-core | **frozen-enough** |
| Product/Version/Variant, ProductAssets, SupplierOffer, CommissionAgreement | `contracts` | Boutik+ | stable (thin) |
| Supply-to-reseller projection | `contracts` | Boutik+ → Shop+ | stable (thin) |
| ResellerListing, Storefront, signed AttributionToken | `contracts` | Shop+ | stable (thin) |
| Package/Seal, PickupTask/DeliveryTask, AssignmentLease, RouteManifest | `contracts` | Séra | stable (thin) |
| CustodyRecord, EvidenceBundle, ValidationDecision | `contracts` | Séra | **stable (thin)** |
| Event taxonomy + envelopes | `contracts` | shared | **stable (versioned)** |
> "frozen-enough" = changes only by deliberate version bump propagated to all consumers; "stable (thin)" = the minimal fields E1 needs are fixed, richer fields may still be added by version bump.

### 2.3 The walking skeleton — the fifteen steps (E1)
1. Create one supplier (manual). 2. Create one basic product, one image (**premium-frame only — no cleanup**), one variant. 3. Publish one supply projection. 4. Create one reseller listing. 5. Open one **signed** buyer link. 6. Create one **immutable sandbox Quote**. 7. **Reserve** one unit (atomic). 8. Complete one **sandbox payment** (hold). 9. Mark the supplier package **ready** (package/seal). 10. Assign one courier **manually**. 11. Transfer one package into **courier custody** (two-party, single-use code + seal). 12. Record one **delivery confirmation** (buyer drop code). 13. Produce one **validated settlement-eligibility** event. 14. Create one **supplier + reseller SettlementObligation**. 15. **Reconcile** the sandbox provider response.
**Deferred to after E1:** Studio safe-cleanup + hostile-image corpus, discovery engine, delivery batching, dashboards, payroll, reputation.

---

## 3. Contract-versioning & mock-certification standard
- **Canonical shapes** live only in `contracts/`; **no app redefines them** (CI-enforced). Events carry **versioned envelopes** (`command_id`, `correlation_id`, aggregate version, actor, server time). Token/contract versions support **overlapping validation windows** + explicit **deprecation/retirement**.
- **A mock is not trustworthy until it misbehaves like the real service.** Every mock MUST: **emit duplicates · deliver events out of order · delay events · return stale projections · simulate timeouts · simulate partial failures · reject invalid state transitions · be generated from the same contract schema as the producer.**
- **Producer/consumer conformance** tests run in CI. **Before replacing a mock with the live sibling, both the live producer and the mock MUST pass the same conformance suite.** A green run against an obedient mock is not evidence the integration works.

---

## 4. Schema & event migration standard
- **Expand → migrate → contract.** No destructive schema change may ship in the **same release** that introduces its replacement.
- **Backfills** are **resumable + idempotent**, with a written plan and a verification step. **Financial and custody records are verified post-migration** against the immutable event log.
- **Events:** versioned envelopes · consumer backward-compatibility · **replay** support · **duplicate-event** handling · **dead-letter** handling · rollback-safe.
- **No assumption of simultaneous upgrade.** Mobile clients on older versions and server contracts coexist; every change is **compatible across the support window**.

---

## 5. Production runbook registry
Each runbook: **trigger · owner · step-by-step recovery · version**. First tranche required at **E2** (skeleton failures), full registry at **E4**.
- **Payments:** provider returned unknown result · duplicate provider webhook · provider outage after authorization · payment completed but reservation commit failed · reservation held but no payment exists.
- **Fulfillment/custody/delivery:** supplier accepted but cannot fulfill · package seal mismatch · courier phone lost **during custody** · courier app offline for hours **holding a package** · customer drop code unavailable · conflicting custody events · evidence upload corrupted.
- **Settlement:** settlement eligibility emitted twice · payout failed · supplier/reseller payout number changed **mid-settlement** · provider payout submitted but not reconciled.
- **Infra/comms/security:** R2 evidence unavailable · WhatsApp/SMS provider unavailable · **signing-key compromise** · large number of orders stuck in one state.

---

## 6. Observability, SLO, alerting & on-call
- **One correlation chain per transaction:** `quote_id → reservation_id → payment_attempt_id → order_id → package_id → delivery_task_id → validation_id → settlement_obligation_id → provider_payout_id`. **Plumbed from E0**, emitted end-to-end by E1.
- **Standards:** structured logs · distributed traces · SLIs/SLOs per service · alert thresholds · dashboards · **DLQ + stuck-saga detection** · **reconciliation alerts** · audit-event monitoring · provider-latency monitoring · **offline-sync backlog monitoring** · named **on-call** ownership.
- **Alert when (minimum):** a reservation stays held after payment failure · a paid order has no supplier decision · a ready package has no task past SLA · a package has an impossible custody sequence · evidence is uploaded but not validated · settlement is eligible but not submitted · a provider payout is submitted but not reconciled · an offline queue exceeds its backlog threshold.
- **Business-viability telemetry (specific to this venture, beyond latency/errors):** **delivery cost per order**, **drops-per-trip / batching rate**, and **fee absorption per order** — emitted as first-class production signals. Correctness is necessary but the venture lives or dies on these; the observability layer MUST surface the **viability** signal, not only health.

---

## 7. Environment, release, flags, performance & DR

### 7.1 Environments & release
Local · test · integration · staging · pilot · production, with **data isolation** + **promotion rules**. **Mobile staged rollout** (canary → ramp) with **rollback that never requires publishing a new mobile app**. Required approvals on money/custody/attribution releases. **Backward compatibility with older mobile versions** across the support window.

### 7.2 Feature flags & kill switches (E0 harness)
**Every high-risk capability ships behind a remotely controlled flag; rollback MUST NOT require a new mobile build.** Flagged: new provider integration · settlement release · category publication · new attribution-token version · automated assignment · new image-processing version · new return policy · new fee formula. **Kill switches:** checkout · dispatch · payout · any single product category.

### 7.3 Performance & device budgets (named at E0)
A **named reference low-end device** + thresholds for: cold-start · product-card payload · buyer-page JS payload · image sizes · offline-queue size · checkout response · attribution-validation time · assignment-transaction latency · evidence-upload time under a defined network profile · memory on the reference device · battery/location impact per rider shift. **"Works on a low-end device" is not an acceptance criterion until the device and thresholds are named.**

### 7.4 Backup, restore & disaster recovery
Backup frequency · **RPO/RTO** · point-in-time recovery · **R2 versioning/retention** · **restore drills** · Durable Object recovery · **reconstruction from the immutable event log** · signing-key-loss procedure · provider-reference recovery · **custody-ledger integrity verification** · evidence retention/deletion · regional/provider-outage procedure. **A backup never restored in a drill does not count.** First restore drill at **E4**; regional-outage drill at **E6**.

---

## 8. The Real-Money Gate (E5 — binary, no exceptions)
Real public money does not flow until **every** item is proven true:
1. **BCEAO license-perimeter written confirmation** that the escrow flow sits inside the aggregator's licence (this is **first** — it can sink the model alone) **and** all provider/legal Decisions (merchant-of-record, "held/escrow" wording) are closed.
2. **Transaction reconciliation works** (provider payout ↔ settlement ↔ ledger).
3. **Refunds work** end-to-end (incl. the earning-reversal saga).
4. **Payout failures** are handled (remain payable, surfaced, recoverable).
5. **Rollback works** without publishing a mobile app.
6. **Restore has been tested** in a drill.
7. **Alerts reach a named operator.**
8. **A support agent can reconstruct any transaction** from the correlation chain.
9. **A package can be located at every state.**
10. **Older supported mobile versions remain compatible.**
11. **No unresolved severity-1 security issue exists** (security review passed; pen test scheduled/passed per E6).

---

## 9. How the app plans map to E0–E6
| App phase | E0 | E1 | E2 | E3 | E4 | E5 | E6 |
|---|---|---|---|---|---|---|---|
| **Boutik+** | M0 foundation | thin: supplier+product(premium-frame)+offer+projection+package/seal+handoff | fulfillment/handoff failure paths | settlement reconciliation read model | full Studio (M1–M2), inventory hardening, moderation alerts | — | hostile-corpus freeze, R2 lifecycle, capacity |
| **Shop+** | M0 foundation | thin: listing + signed link + immutable Quote + reservation + sandbox payment + drop-code confirm | checkout failure paths, attribution collisions | provider sandbox + webhook reconcile + refund saga | discovery, reputation, Clients, PWA budgets | real-money checkout on | browser-compat + load |
| **Séra** | M0 foundation | thin: manual assign + one custody transfer + one delivery evidence + ValidationDecision | failed-delivery/return + custody exceptions | eligibility reconciliation | SOS/fleet/payroll, **live drills**, hub reconciliation, single-job (no batching) | — | batching, staffing SLA, DR drill |
> **Each app's "implementation-ready" exit (its spec §10 + plan exit) is a prerequisite to E4/E5, not a substitute.** An app may be green while the ecosystem sits at E2.

---

## 10. The professionalization patch — twelve shared sections, staged
| # | Shared section | In place by |
|---|---|---|
| 1 | Ecosystem milestone & dependency plan (this document) | **E0** |
| 2 | Environment & release strategy (§7.1) | **E0** (envs) → **E4** (staged rollout/rollback drill) |
| 3 | Feature flags & kill switches (§7.2) | **E0** (harness) |
| 4 | Schema & event migration standard (§4) | **E0** (written + CI) |
| 5 | Contract-versioning & mock-certification (§3) | **E0** (written) → **E1** (applied) |
| 6 | Observability / SLO / alert / on-call (§6) | **E0** (correlation IDs) → **E2** (alerts) → **E4** (on-call) |
| 7 | Security-development lifecycle (§11 below) | **E0** (scanning + key custody) → **E3** (review) → **E6** (pen test) |
| 8 | Backup / restore / RPO / RTO (§7.4) | **E4** (first restore drill) → **E6** (regional drill) |
| 9 | Production runbook registry (§5) | **E2** (first tranche) → **E4** (full) |
| 10 | Performance & device budgets (§7.3) | **E0** (named) |
| 11 | Code ownership, ADR & approval policy | **E0** |
| 12 | Real-money launch gate (§8) | **E5** (hard gate) |

**§11 Security-development lifecycle (staged):** threat model per ⚠ slice · authn/authz matrices · horizontal+vertical privilege-escalation tests · secrets management · **key rotation incl. attribution-token signing key (custody, rotation, overlapping windows, compromise response, version retirement)** · webhook-signature validation · device-session revocation · dependency + secret scanning + SAST + SBOM (E0, in CI) · mobile-build signing · **security review before real money (E3/E5)** · **independent penetration test before city launch (E6)**.

**Code ownership / ADR / approval (solo-founder form):** every architecture decision gets a short **ADR** in-repo; the **ownership map** is the `contracts/` table (§2.2); money/custody/attribution slices require a **second-pass review before merge** — a fresh agent or a written checklist re-reading the diff against the relevant invariant gate, since a single stateless agent should not be the only reader of a ⚠ change.

---

## 10.5 The French Voice Standard (program-wide — every user-facing string in every app)

**Why this is a contract, not a preference:** an agent told only "French default" produces grammatically-correct **administrative Parisian French** — « Veuillez consulter les articles disponibles », « Confirmation de la transaction en cours » — the cold register of the bank and the government office. For this market that copy is *wrong*: it reads as distant and bureaucratic to the very resellers and buyers the product must feel familiar to. This section defines the required voice so every surface, in every app, sounds the same.

**North Star line:** *« Le français de l'écosystème : celui d'une commerçante qui réussit — clair quand il s'agit d'argent, chaleureux quand il s'agit de vendre, jamais celui d'un bureau. »*

### The register split (the core rule)
Every string belongs to one of two registers by **what moment it serves**:

- **MONEY & TRUST moments → calm, precise, reassuring.** Anything about paying, being paid, refusing at the door, what someone earns, custody, or a failure. Zero cleverness, zero ambiguity — doubt here loses the sale or breaks trust. *Ex: « Vous payez X F maintenant, en sécurité — et Y F à la livraison. » · « La cliente est remboursée automatiquement. »*
- **SELLING & COMMUNITY moments → warm, familiar, captivating.** Campaign cards, the Cercle, sharing, discovery, celebrations, onboarding encouragement. The voice of a confident Burkinabè merchant talking to her *clientes*, not a catalog. *Ex: « C'est arrivé — regardez ça. » · « Votre gain net vous revient. »*

### Level & reach (locality dial)
- **Level B — Ouaga-warm French**, all-French, recognizably Burkinabè in phrasing and warmth (« vos clientes », « ces jours-ci », « c'est gratuit »), never Parisian-administrative. Address a reseller's customers as **« clientes »** — the real texture of local commerce.
- **Whisper of Level C** — Mooré/Dioula touches **only** in genuinely universal moments (a greeting, a thank-you), **never in instructions or money copy**, and never in a way that would exclude a Dioula-corridor reseller who doesn't read Mooré (or vice-versa). Default to French; the local-language touch is a garnish, not the dish.

### Hard rules (apply everywhere)
1. **6th-grade reading level.** Many resellers did not finish school. Short words, short sentences, no administrative French, no word a market seller wouldn't say out loud. If a simpler word exists, use it.
2. **« séquestre » / "escrow" MUST NOT appear** in any customer-facing string (already a Decision) — say « gardé en sécurité chez le partenaire ».
3. **Refusals and failures are stated without blame-drama** — « la cliente a changé d'avis », not accusatory framing.
4. **Every money screen states cause and effect plainly** — what is paid, what is kept, when money moves — never financial abstraction.
5. **Voice-note scripts** (Media Kit, onboarding) are written to be *spoken*, in the warm register, in the customer's language where offered.
6. Product/UI **microcopy is comprehension-tested with first-time users** where a money decision depends on it (checkout replay line already required).

### CI-checkable form (so it is enforced, not just described)
A lightweight **copy-lint over the i18n string catalog** (all user-facing strings live in `contracts/`/i18n, never inline) fails the build when:
- a **banned-register token** appears in customer copy: `séquestre`, `escrow`, `veuillez`, `nonobstant`, `ci-après`, `susmentionné`, and the administrative-formal set (list maintained in the lint);
- a **money-moment string** (tagged `register: money`) contains marketing/urgency tokens, or a **selling string** (tagged `register: selling`) contains raw ledger/finance jargon;
- any string exceeds the **reading-level budget** (max sentence length / syllable heuristic) for its screen class;
- a Mooré/Dioula token appears in a string tagged `register: money` or `class: instruction`.

Each i18n entry therefore carries a **`register` tag (`money` | `selling` | `neutral`)** and a **screen class** — the same catalog the Media Kit's multi-language captions (SP-I19) already draw from. The lint is added to the E0 CI harness alongside the existing French-default check, and runs on every slice.

**Ownership:** the string catalog + copy-lint is a shared-service concern (Consent/Notification-adjacent, in `contracts/`); no app redefines the tags. Where a Decision changes wording (e.g. the "held/escrow" legal wording), the catalog is the single place it changes.

---

## 11. Bottom line
Build **E1 before deep app work**. Stage the operational weight onto **E2–E6** exactly where real money and real custody arrive. Treat **mock-certification, the correlation chain, flags/kill-switches, and the BCEAO perimeter** as the four things that most reduce the chance of a green-but-broken ecosystem. The three app plans remain the source of *product* truth; this contract is the source of *delivery* truth, and where they meet is the E0–E6 column in each plan.
