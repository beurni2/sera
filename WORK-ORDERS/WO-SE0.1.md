> Part of the E0 work-order set (master: E0-Work-Orders.md). Sequence: WO-0 first; the three app WOs pin its v0.1.0 tag. Canon: /docs in this repo (Annex A already applied). Nothing gated; sandbox only.

## WORK ORDER — WO-SE0.1 · Séra app workspace + pinned canon + CI harness

### SPEC AUTHORITY (quoted)
- **Séra Building Plan v3.0, slice SE0.1 (DoD, verbatim):** *"Per-app pnpm/Turborepo workspace in the `sera` repo; consumes `platform-contracts` as a pinned versioned package + local `commerce-core`; CI enforces one-assignment-authority, custody-after-verification-and-seal, evidence ≠ release, no-route-ML, off-shift-location, no-funds, and the contracts drift-check from the first PR."*
- **Séra Building Plan standing guardrails (CI on every slice):** *"exactly one assignment authority · one current custodian; evidence ≠ release; custody only after pickup verification + custody-seal · custody transfers only after provider-confirmed door payment / signed authorization; rider never accepts screenshot/SMS/verbal/pending; no personal-account payments · the four secrets never substituted; buyerDropCode never in seller/readiness evidence · GPS never sole proof; off-shift location not collected · no platform funds · no route-optimization/ETA ML · single-level · French default + French Voice Standard copy-lint · phone is an alias · canonical shapes from `contracts/`."*
- **Séra Spec v3.0 (corrected), §5.6 L69:** *"Quote{ …, campaignId?, campaignBenefit?{customerShare,campaignShare}, sellerNet, resellerNet, platformProductFeeRevenue, policyVersions, expiry } // IMMUTABLE — canonical shape, identical across all three specs; PackLab fields ride the DeliveryTask/package context, never the Quote (B+9 version bump only)"* — the corrected canon this repo consumes.
- **Execution Contract E0 repo-topology block** + **founder slug ruling** (kebab-case `sera`).
- **Séra Spec §12 CI gates** — the merge-blocking list this harness must register.

### READ FIRST
1. Current `sera` repo state — report the exact slug.
2. `platform-contracts` `v0.1.0` exports + `/docs` manifest — **confirm the pinned Quote type carries no `supplyMode`/`handlingClass`/`kittingSealId`** and report that check's result explicitly.
3. Séra Spec §1, §4 (SE-I01…SE-I12), §12; Building Plan Phase 0.
Agent states back: the gate list, the drift-check mechanics, the local-`commerce-core` scope — before writing code.

### BUILD
- Per-app workspace in `sera`: Expo/RN rider-app shell + web dispatch-console shell + logistics/custody/evidence service stubs.
- Pin `platform-contracts@v0.1.0` + local `commerce-core` scaffold (read-side only here — Séra never computes proceeds; ADR-001 notes SE-I09).
- `/docs` drift-checked copy + drift-check in CI.
- CI harness: DoD-named gates, at this slice, as **executable architectural + type-contract checks with negative fixtures** — one-assignment-authority (the assignment types admit exactly one lease holder; a fixture with two active leases fails) · custody-after-verification-and-seal (the custody transition type requires `PickupVerification.result=accepted` + `custodySealId` as preconditions; a fixture transitioning without them fails) · evidence ≠ release (no type/path from `EvidenceBundle` to any settlement mutation; fixture fails) · no-route-ML (banned-libs check) · off-shift-location (location capture types exist only behind shift-scope; fixture capturing off-shift fails) · no-funds (no wallet/balance/payment-funds module anywhere) · four-secrets separation on this repo's surfaces (`buyerDropCode` type unusable in seller/readiness evidence types) · copy-lint. These are the seeds the M2/M4/M5 Durable-Object slices will harden into runtime invariants.
- Correlation-ID plumbing through one hello-world request; flag/kill-switch client stub.

### OUT OF SCOPE
SE0.2+ (rider auth/KYC, navigation primitive) · any Durable Object implementation (assignment lease, custody ledger are M2/M4 ⚠ slices) · any evidence/media capture · dispatch logic.

### DoD (binary)
The SE0.1 DoD quoted above, plus: every named gate demonstrably fails on its negative fixture · both drift-check runs attached · the pinned-Quote-shape check reported · slug verified kebab-case · rider shell + console shell boot with `ui-tokens` theme `sera`.

### CI GATES THAT MUST STAY GREEN
one-assignment-authority · custody-after-verification-and-seal · evidence ≠ release · no-route-ML · off-shift-location · no-funds · four-secrets separation · French Voice copy-lint · contracts drift-check.

### EVIDENCE REQUIRED
PR #1 CI run with every gate executed · per-gate negative-fixture failure outputs · both drift-check runs · the Quote-shape confirmation · workspace `tree` · lockfile pin line · ADR-001 text.

### FORBIDDEN
- Starting SE0.2 features or any Durable Object "to get ahead" — the assignment lease and custody ledger are ⚠ slices with their own adversarial tests first.
- Any custody transition type that treats evidence, GPS, or self-declaration as sufficient.
- Locally redefining any canonical shape.
- Gates without failing fixtures.
- A repo slug containing "+".

---
---
