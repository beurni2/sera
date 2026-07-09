# ADR-001 — Local `commerce-core` is READ-SIDE ONLY: Séra never computes proceeds

**Status:** Accepted · **Date:** 2026-07-09 · **Slice:** WO-SE0.1

## Context
The Séra Building Plan (SE0.1) calls for a local `commerce-core` package
alongside the pinned `platform-contracts` consumption. Séra Spec SE-I09 is
absolute: *"Séra never computes proceeds, never holds product funds, never
marks paid."* Spec §5.4 bounds what Séra may even see of the money model:
*"Séra sees `deliveryFee` and (Option B) `amountDueAtDelivery` for the
doorstep flow — never commission or splits."* The Execution Contract §2.2
keeps the immutable Quote / Order / EscrowTxn / SettlementObligation / order
state machine single-owner, hosted elsewhere.

## Decision
At this slice, `@sera/commerce-core` is **read-side only**:

- fixture assertions that the PINNED waterfall reproduces the §5.4 baseline
  (verifying canon, computing nothing of Séra's own);
- a `SeraDeliveryView` projection over the pinned Quote carrying ONLY
  `deliveryFee`, `amountDueAtDelivery`, and `paymentMode` — commission,
  nets, fees, and splits are structurally absent;
- nothing else.

No proceeds computation, no settlement math, no funds handling, no order
state machine, no redefinition of any canonical shape — not in this slice,
and never in this repo without a canon change that itself passes §7.

## Consequences
- Any PR adding settlement math, payout logic, or a wallet/balance concept
  to this package violates SE-I09 and is rejected in review; the no-funds
  and evidence≠release gates scan for the recognizable forms.
- When E1 wiring lands, Séra consumes eligibility signals and order/delivery
  context read-only; the authoritative money truth stays with its owner.
