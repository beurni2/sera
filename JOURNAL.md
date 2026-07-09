# JOURNAL — sera
Continuity ledger per CTO charter §6/§6bis. Every entry is evidence-grounded.

Format per entry:
## <date> · <slice/WO id> · <status: in-progress | in-review | done | blocked-on-founder>
- What was done (with the tool result / test output that proves it)
- Decisions made · safest-defaults applied on open ⏳ (flagged) · founder overrides
- Pending / next

---

## 2026-07-09 · E0 bootstrap (pre-WO-SE0.1) · done
- Pre-flight: repo slug verified `sera` (origin remote `beurni2/sera` — lowercase kebab-case). `platform-contracts` pinned clone verified at `b10f4822b173c9cd4b162f416ad213bf580ab652`; `/CONSUMING.md` read.
- **Pin decision:** `git ls-remote --tags` on platform-contracts origin shows no `v0.1.0` (only the founder-artifact tag `boss`, ignored per instruction — being deleted) — **pin ref is the commit sha `b10f4822…`**; move to `#v0.1.0` in the first version-bump PR.
- Pinned-Quote pre-check (source): `supplyMode`/`handlingClass`/`kittingSealId` appear in `shapes/quote.ts` ONLY in the comment stating they are excluded; the schema is `.strict()` (undeclared keys are a parse failure). Empirical confirmation against the installed package follows in the Step-4 state-back.
- Bootstrapped from the pinned clone: `/docs` (seven canon documents), `/CLAUDE.md` + `/AGENTS.md` (byte-identical), `/WORK-ORDERS/WO-SE0.1.md`, this fresh `/JOURNAL.md`.
- Known-from-siblings (same day): CI needs the `PLATFORM_CONTRACTS_READ_TOKEN` insteadOf auth step before install (founder ruling; secret already added to this repo per founder) · pnpm/action-setup must NOT carry a `version` input (packageManager pin is the source) · RN shells must not runtime-import node-only canon barrels (type-only imports + devDependencies + ban-test; prove with `expo export`) · Playwright-style web servers must bind 127.0.0.1 in CI. All applied from birth.
- Pending / next: WO-SE0.1 on branch `e0/wo-se0.1`.

## 2026-07-09 · WO-SE0.1 · in-progress
- **Step-3 consumption pre-flight (CONSUMING.md, exact): PASSED.** Both `pnpm-workspace.yaml` blocks; four `@platform/*@0.1.0` from the GitHub URL at sha `b10f4822`; baseline printed productSubtotal 11500 · buyerTotal 12500 · sellerNet 8500 · resellerNet 2000 · platformProductFeeRevenue 1000 · `assertQuoteReconciles: no throw` (`_evidence/step3-baseline-check.txt`).
- **Pre-flight-4 Quote-shape check (empirical, against the installed pin — `_evidence/quote-shape-check.txt`): CONFIRMED.** The pinned `QuoteSchema` carries 23 keys; `supplyMode`/`handlingClass`/`kittingSealId` are NOT among them; a clean canonical quote parses; adding any of the three is a **strict-parse failure** — exactly Séra Spec §5.6 L69 ("PackLab fields ride the DeliveryTask/package context, never the Quote").
- **State-back before code (WO-SE0.1 READ FIRST):**
  - *Repo state:* slug `sera` verified on origin; only the bootstrap commit existed. No code.
  - *Gates SE0.1 stands up (type/architecture SEEDS — the M2/M4/M5 Durable-Object slices harden them at runtime; each ships a negative fixture shown failing exit-1):* ① one-assignment-authority (SE-I01) — at most one ACTIVE `AssignmentLease` per task, validated with the pinned schema; negative = two active leases; ② custody-after-verification-and-seal (SE-I05) — the custody-transition type REQUIRES `PickupVerification.result='accepted'` + a matching `custodySealId`; negative = transition without them; evidence/GPS/self-declaration are not even expressible inputs (FORBIDDEN); ③ evidence ≠ release — no type/path from `EvidenceBundle` to a settlement mutation; negative = a `releaseSettlementOnEvidence` module; ④ no-route-ML (SE §5.3) — banned ML + route-optimization/ETA dep+import scan; ⑤ off-shift-location (SE-I08) — geolocation APIs importable ONLY in the one shift-scoped module whose type requires an active shift; negative = capture outside it; ⑥ no-funds (SE-I09) — wallet/balance/funds scanner; ⑦ four-secrets separation — `buyerDropCode` structurally excluded from seller/readiness evidence types + payload scanner; negative = readiness evidence carrying it; ⑧ French Voice copy-lint (both app catalogs, pinned CLI); ⑨ contracts drift-check (pinned CLI; tampered-doc negative).
  - *Drift-check mechanics:* this repo's seven `/docs` `.md` files sha256-compared against `docs.manifest.json` inside the pinned `@platform/contracts` + `--pinned-version 0.1.0`; fails on changed bytes, missing/extra top-level docs, version mismatch.
  - *Local `commerce-core` scope:* **READ-SIDE ONLY (SE-I09: "Séra never computes proceeds, never holds product funds, never marks paid")** — fixture assertions over the pinned waterfall plus a `SeraDeliveryView` projection carrying ONLY `deliveryFee`/`amountDueAtDelivery`/`paymentMode` (§5.4: "Séra sees deliveryFee and (Option B) amountDueAtDelivery — never commission or splits"). No proceeds computation, no settlement math, no shape redefinition (ADR-001).
