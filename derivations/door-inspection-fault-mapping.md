# Derivation — door-inspection refusal mapping (WO-2.4; taxonomy discipline)

Every mapping below is grounded in quoted spec text. One canon gap is flagged
at the end — nothing was invented to paper over it.

## Grounding quotes

1. Shop+ §6.2 (category inspection matrix): "Valid rejection: wrong/mismatch/
   damage/short" (fashion) · "wrong size-label/model/damage" (shoes) ·
   "broken seal/wrong variant/expired/damage" (sealed beauty). "Buyer-risk
   (not valid): no try-on; fit dissatisfaction · fit (wearing = buyer risk) ·
   opening the inner seal."
2. Shop+ §6.2: "**Opened-then-refused:** if outer packaging was opened and
   buyer refuses **without seller fault** → **buyer-fault**."
3. Sera §6.2 (pickup, the symmetric case): "On mismatch/damage → rider
   refuses custody … (Protection Fund, `faultClass = seller`)."
4. Sera §6.5: "Fault attributed on every claim; Séra-caused product
   loss/damage → `CustodyLiabilityClaim`, not a Protection-Fund payout."
5. Sera SE-I05: custody begins only after verification AND custody-seal
   registration — the seal is the integrity witness for everything that
   happens between pickup and the door.
6. Shop+ §6.4: "Classify reason: honest_absence | unusable_location |
   insufficient_balance | change_of_mind | repeated_abuse | fraud" — the
   canonical DELIVERY_FAILURE_REASONS (+ provider_failure).

## Derived mapping (encoded as DOOR_FAULT_DERIVATION_V1 policy data)

| Door inspection outcome | Route | faultClass | Ground |
|---|---|---|---|
| INVALID rejection (buyer-risk column: fit/try-on/inner-seal; opened-then-refused without seller fault) | WO-2.2 ladder, reasonCode `change_of_mind` | buyer | quotes 1–2: buyer-risk refusals are the buyer's choice — the §6.4 ordinary-buyer-fault class |
| VALID rejection, custody seal INTACT (wrong item/variant/size-label/short/expired/mfr-seal broken at pickup…) | protection claim + return flow (NO DeliveryOutcome — see gap) | seller | quotes 3+5: an intact custody seal witnesses transit integrity — the defect predates Séra custody; same attribution as the pickup mismatch case |
| VALID rejection, custody seal BROKEN | protection claim + return flow + CustodyLiabilityClaim eligibility | sera | quotes 4+5: a broken seal means the package was compromised IN Séra custody — "Séra-caused product loss/damage" |

Rules the mapping enforces, not documents: inspection precedes payment
(§6.3 sequence); a valid rejection never enters the buyer ladder (no fee
retention against a seller-fault or Séra-fault refusal); the buyer-risk
refusal always does (quote 2).

## ⚠ CANON GAP — flagged, not papered over

`DELIVERY_FAILURE_REASONS` (canon v0.5.0) carries only buyer-refusal-shaped
codes. A VALID door rejection (seller- or Séra-fault) has **no canonical
reasonCode**, so it cannot be recorded as a canonical `DeliveryOutcome`
without abusing a buyer code. WO-2.4 therefore records valid rejections via
the custody ledger + `protection.claim_opened.v1` (fault-attributed, quote 4)
+ the return flow, and emits NO DeliveryOutcome for them. **Founder ask for
canon v0.6.0:** a valid-rejection reason code (e.g. `valid_rejection` or
`conformity_mismatch`) so the outcome record becomes canonical.
