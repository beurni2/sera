# ADR-003 — Eligibility-consumer trust contract: command_id dedupe is the MOCK's posture, not the binding contract

Status: accepted (WO-2.1 finding ⑥ groundwork) · Date: 2026-07-10

## Context

Séra's custody spine emits exactly ONE `delivery.validated.v1` per order — the
settlement-eligibility signal (Contract §2.3 step 13; SE-I09: no amounts ride
it). The WO-1.3 verifier's non-blocking finding ⑥, title verbatim: "Consumer
mock dedupes on `command_id`." The concern: sera's certified consumer mock
(`commerce-eligibility-consumer-mock.ts`) absorbs duplicate deliveries by
`command_id`, and nothing yet stated whether the REAL consumer may rely on
that field the same way.

## Decision

1. **command_id dedupe is the mock's posture only.** It exists so the mock is
   §3-certifiable (duplicate behavior 8/8) — it is NOT the contract the real
   consumer is entitled to build on.
2. **The binding contract is ledger-side idempotency at the consumer** —
   commerce-core's OrderSpine (shop-plus) must apply the eligibility signal
   idempotently against its own order ledger (at most one
   confirmed-transition per order_id, whatever the envelope carries). That
   contract is **proven at E1 assembly on OrderSpine**, from the consuming
   side — it cannot be proven from sera's repo.
3. **Séra's own guarantee stays producer-side exactly-once**, and it is
   already pinned by tests in this repo (no new code needed for ⑥):
   - `custody-spine.test.ts` › "ELIGIBILITY EXACTLY ONCE: duplicate and
     replayed confirmations absorb — no second signal, ledger chain intact"
   - `custody-spine.test.ts` › "happy validation: exactly ONE
     delivery.validated.v1 exists per order — the eligibility signal, after
     the drop code"
   - `eligibility-consumer-certification.test.ts` › "consumer law: ONLY the
     validated eligibility signal applies, exactly once, under duplicate
     delivery"
   - `eligibility-consumer-certification.test.ts` › "the spine stays
     exactly-once even when the consumer replays and the spine is
     re-confirmed (both misbehave)"

## Consequences

- The real consumer work item (OrderSpine applying `delivery.validated.v1`
  idempotently by order_id) belongs to shop-plus at E1 assembly; this ADR is
  the cross-repo pointer.
- Any future consumer implementation that relies on `command_id` uniqueness
  as its ONLY dedupe fails review against this ADR.
