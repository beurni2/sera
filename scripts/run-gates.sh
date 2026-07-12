#!/usr/bin/env bash
# WO-SE0.1 CI gates, run end-to-end with evidence. Every gate has a negative
# fixture and this script SHOWS each one failing once per run — if a negative
# fixture stops failing (exit != 1 exactly), the run itself fails. Output is
# captured under EVIDENCE_DIR when set.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-}"
FAILED=0

log() { printf '\n=== %s ===\n' "$1"; }
capture() {
  # capture <name> <expected: pass|fail> <command...>
  # expected=fail requires exit code EXACTLY 1: a crashed or misinvoked gate
  # (exit 2+) must never pass for a working negative fixture.
  local name="$1" expected="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [ -n "$EVIDENCE_DIR" ]; then
    mkdir -p "$EVIDENCE_DIR"
    printf '$ %s\n%s\n(exit code: %d)\n' "$*" "$out" "$rc" > "$EVIDENCE_DIR/$name.txt"
  fi
  printf '%s\n(exit code: %d)\n' "$out" "$rc"
  if [ "$expected" = pass ] && [ $rc -ne 0 ]; then echo "GATE FAILED (expected pass): $name"; FAILED=1; fi
  if [ "$expected" = fail ] && [ $rc -ne 1 ]; then echo "GATE FAILED (expected the negative fixture to fail with exit 1, got $rc): $name"; FAILED=1; fi
}

cd "$ROOT"

# Preinstalled-browser fallback for the Playwright harness (sandbox only;
# GitHub CI installs its own browser instead).
if [ -z "${PW_EXECUTABLE:-}" ] && [ -e /opt/pw-browsers/chromium ] && [ -z "${CI:-}" ]; then
  export PW_EXECUTABLE=/opt/pw-browsers/chromium
fi

log "typecheck (all workspace packages, incl. both app shells)"
capture typecheck pass pnpm typecheck

log "tests (custody/assignment/evidence seeds, delivery view, correlation hello-world, flags, health, catalogs)"
capture tests pass pnpm test

log "consumption baseline — pinned computeWaterfall reproduces the §5.4 worked baseline"
capture baseline-check pass node scripts/baseline-check.mjs

log "pinned-Quote shape check — no supplyMode/handlingClass/kittingSealId (§5.6 L69)"
capture quote-shape-check pass node scripts/quote-shape-check.mjs

log "gate: money-reconciliation (standing guardrail) — §5.4 baseline fixture (must pass)"
capture money-reconciliation-positive pass node scripts/gates/money-reconciliation.mjs gates/fixtures/quote.baseline.json

log "gate: money-reconciliation — NEGATIVE FIXTURE (independent-multiplication drift, must fail)"
capture money-reconciliation-negative fail node scripts/gates/money-reconciliation.mjs gates/fixtures/negative/quote.independent-multiplication.json

log "E1 dispatch happy path — manual assignment through the SERVICE path, chain + offline-pending proofs (must pass)"
capture e1-dispatch-happy-path pass node scripts/e1-dispatch-happy-path.mjs

log "gate: rider-assignability — certified, privacy-acked, server-confirmed on-shift rider (must pass)"
capture rider-assignability-positive pass node scripts/gates/rider-assignability.mjs gates/fixtures/assignment.eligible-rider.json

log "gate: rider-assignability — NEGATIVE FIXTURE (uncertified rider, must REFUSE CLOSED)"
capture rider-assignability-uncertified-negative fail node scripts/gates/rider-assignability.mjs gates/fixtures/negative/assignment.uncertified-rider.json

log "gate: rider-assignability — NEGATIVE FIXTURE (offline-pending shift start, must REFUSE CLOSED)"
capture rider-assignability-offshift-negative fail node scripts/gates/rider-assignability.mjs gates/fixtures/negative/assignment.offline-pending-shift.json

log "gate: no-street-address-location — canonical kernel Location (must pass)"
capture no-street-address-positive pass node scripts/gates/no-street-address-location.mjs gates/fixtures/location.kernel-canonical.json

log "gate: no-street-address-location — NEGATIVE FIXTURE (streetAddress-bearing location, must fail)"
capture no-street-address-negative fail node scripts/gates/no-street-address-location.mjs gates/fixtures/negative/location.with-street-address.json

log "E1 custody happy path — §2.3 steps 11–13 through the SERVICE path, ledger + chain ids (must pass)"
capture e1-custody-happy-path pass node scripts/e1-custody-happy-path.mjs

log "gate: custody-ledger — honest hash-chained ledger (must pass)"
capture custody-ledger-positive pass node scripts/gates/custody-ledger.mjs gates/fixtures/ledger.honest.json

log "gate: custody-ledger — NEGATIVE FIXTURE (tampered committed entry, chain must FAIL)"
capture custody-ledger-tamper-negative fail node scripts/gates/custody-ledger.mjs gates/fixtures/negative/ledger.tampered-entry.json

log "gate: custody-ledger — NEGATIVE FIXTURE (second concurrent custodian, must REFUSE CLOSED)"
capture custody-ledger-double-custodian-negative fail node scripts/gates/custody-ledger.mjs gates/fixtures/negative/ledger.double-custodian.json

log "gate: custody-actor-separation — distinct supplier and rider (must pass)"
capture actor-separation-positive pass node scripts/gates/custody-actor-separation.mjs gates/fixtures/custody.distinct-actors.json

log "gate: custody-actor-separation — NEGATIVE FIXTURE (supplier as its own rider, must REFUSE CLOSED)"
capture actor-separation-negative fail node scripts/gates/custody-actor-separation.mjs gates/fixtures/negative/custody.supplier-as-rider.json

log "gate: evidence-chain-binding — bundle bound by equality to chain ids + registered seal (must pass)"
capture evidence-binding-positive pass node scripts/gates/evidence-chain-binding.mjs gates/fixtures/evidence.bound.json

log "gate: evidence-chain-binding — NEGATIVE FIXTURE (foreign packageId, must REFUSE CLOSED)"
capture evidence-binding-foreign-package-negative fail node scripts/gates/evidence-chain-binding.mjs gates/fixtures/negative/evidence.foreign-package.json

log "gate: evidence-chain-binding — NEGATIVE FIXTURE (foreign seal, must REFUSE CLOSED)"
capture evidence-binding-foreign-seal-negative fail node scripts/gates/evidence-chain-binding.mjs gates/fixtures/negative/evidence.foreign-seal.json

log "gate: evidence-chain-binding — NEGATIVE FIXTURE (binding field absent, must REFUSE CLOSED)"
capture evidence-binding-missing-negative fail node scripts/gates/evidence-chain-binding.mjs gates/fixtures/negative/evidence.missing-binding.json

log "gate: offline-never-final — server-confirmed evidence validates (must pass)"
capture offline-never-final-positive pass node scripts/gates/offline-never-final.mjs gates/fixtures/evidence.server-confirmed.json

log "gate: offline-never-final — NEGATIVE FIXTURE (queued-offline evidence seeking finality, must REFUSE CLOSED)"
capture offline-never-final-negative fail node scripts/gates/offline-never-final.mjs gates/fixtures/negative/evidence.queued-offline-finality.json

log "gate: outcome-family — door refusal yields a canonical DeliveryOutcome (must pass)"
capture outcome-family-positive pass node scripts/gates/outcome-family.mjs gates/fixtures/outcome.retry-canonical.json

log "gate: outcome-family — NEGATIVE FIXTURE (reason outside the taxonomy, must REFUSE CLOSED)"
capture outcome-family-taxonomy-negative fail node scripts/gates/outcome-family.mjs gates/fixtures/negative/outcome.reason-outside-taxonomy.json

log "gate: outcome-family — NEGATIVE FIXTURE (generic 'failed' family, must refuse at parse)"
capture outcome-family-failed-negative fail node scripts/gates/outcome-family.mjs gates/fixtures/negative/outcome.generic-failed.json

log "gate: two-key-return — seller + rider keys, both-or-neither (must pass)"
capture two-key-return-positive pass node scripts/gates/two-key-return.mjs gates/fixtures/return.two-keys.json

log "gate: two-key-return — NEGATIVE FIXTURE (single/wrong key, must REFUSE and burn nothing)"
capture two-key-return-negative fail node scripts/gates/two-key-return.mjs gates/fixtures/negative/return.single-key.json

log "gate: package-never-unowned — end-shift-with-custody exception flow (must pass)"
capture package-never-unowned-positive pass node scripts/gates/package-never-unowned.mjs gates/fixtures/shift.end-with-exception.json

log "gate: package-never-unowned — NEGATIVE FIXTURE (orphaned custody end-shift, must REFUSE CLOSED)"
capture package-never-unowned-negative fail node scripts/gates/package-never-unowned.mjs gates/fixtures/negative/shift.orphaned-custody.json

log "gate: offline-flush-binding — queue drains ONLY through the server_confirmed binding path (must pass)"
capture offline-flush-binding-positive pass node scripts/gates/offline-flush-binding.mjs

log "gate: offline-flush-binding — NEGATIVE FIXTURE (planted direct-drain bypass, must be caught)"
capture offline-flush-binding-negative fail node scripts/gates/offline-flush-binding.mjs gates/fixtures/negative/offline-flush-bypass

log "gate: door-custody-gate — Option-B custody requires the provider-confirmed door payment (must pass)"
capture door-custody-positive pass node scripts/gates/door-custody-gate.mjs gates/fixtures/door.lawful-path.json

log "gate: door-custody-gate — NEGATIVE FIXTURE (custody without door payment, must REFUSE CLOSED)"
capture door-custody-negative fail node scripts/gates/door-custody-gate.mjs gates/fixtures/negative/door.custody-without-payment.json

log "gate: actor-provenance — door-paid signal from the payment-provider class (must pass)"
capture actor-provenance-positive pass node scripts/gates/actor-provenance.mjs gates/fixtures/signal.provider-actor.json

log "gate: actor-provenance — NEGATIVE FIXTURE (rider-actor door signal, must REFUSE CLOSED + alert)"
capture actor-provenance-negative fail node scripts/gates/actor-provenance.mjs gates/fixtures/negative/signal.wrong-actor.json

log "gate: actor-provenance — NEGATIVE FIXTURE (prefix-trick actor shop:commerce-core-evil, must REFUSE CLOSED + alert)"
capture actor-provenance-prefix-trick-negative fail node scripts/gates/actor-provenance.mjs gates/fixtures/negative/signal.prefix-trick-actor.json

log "gate: no-rider-asserted-payment — repo source (must pass)"
capture no-rider-asserted-positive pass node scripts/gates/no-rider-asserted-payment.mjs

log "gate: no-rider-asserted-payment — NEGATIVE FIXTURE (planted rider-marks-paid module, must be caught)"
capture no-rider-asserted-negative fail node scripts/gates/no-rider-asserted-payment.mjs gates/fixtures/negative/rider-asserted-payment

log "mock certification — commerce-core eligibility consumer 8/8 via the pinned suite (must pass)"
capture certify-mocks pass node scripts/certify-mocks.mjs

log "gate: one-assignment-authority — single-authority lease set (must pass)"
capture one-assignment-authority-positive pass node scripts/gates/one-assignment-authority.mjs gates/fixtures/leases.single-authority.json

log "gate: one-assignment-authority — NEGATIVE FIXTURE (two ACTIVE leases on one task, must fail)"
capture one-assignment-authority-negative fail node scripts/gates/one-assignment-authority.mjs gates/fixtures/negative/leases.double-assignment.json

log "gate: custody-after-verification-and-seal — accepted verification + matching seal (must pass)"
capture custody-transition-positive pass node scripts/gates/custody-transition.mjs gates/fixtures/custody.verified-and-sealed.json

log "gate: custody-after-verification-and-seal — NEGATIVE FIXTURE (no accepted verification, must REFUSE CLOSED)"
capture custody-transition-negative fail node scripts/gates/custody-transition.mjs gates/fixtures/negative/custody.without-verification.json

log "gate: evidence-never-releases — repo source (must pass)"
capture no-evidence-release-positive pass node scripts/gates/no-evidence-release.mjs

log "gate: evidence-never-releases — NEGATIVE FIXTURE (EvidenceBundle→settlement path, must fail)"
capture no-evidence-release-negative fail node scripts/gates/no-evidence-release.mjs gates/fixtures/negative/evidence-release

log "gate: no-route-ML — repo deps + imports (must pass)"
capture no-route-ml-positive pass node scripts/gates/no-ml-libs.mjs

log "gate: no-route-ML — NEGATIVE FIXTURE (ML dep + inference import, must fail)"
capture no-route-ml-negative fail node scripts/gates/no-ml-libs.mjs gates/fixtures/negative/no-ml-libs

log "gate: off-shift-location — repo source, shift-scoped module only (must pass)"
capture off-shift-location-positive pass node scripts/gates/off-shift-location.mjs

log "gate: off-shift-location — NEGATIVE FIXTURE (ambient tracker outside shift scope, must fail)"
capture off-shift-location-negative fail node scripts/gates/off-shift-location.mjs gates/fixtures/negative/off-shift-location

log "gate: no-funds — repo source (must pass)"
capture no-funds-positive pass node scripts/gates/no-wallet-no-funds.mjs

log "gate: no-funds — NEGATIVE FIXTURE (wallet/balance module, must fail)"
capture no-funds-negative fail node scripts/gates/no-wallet-no-funds.mjs gates/fixtures/negative/no-wallet-no-funds

log "gate: four-secrets separation — readiness evidence payload (must pass)"
capture four-secrets-positive pass node scripts/gates/no-drop-code-in-seller-evidence.mjs gates/fixtures/readiness-evidence.json

log "gate: four-secrets separation — NEGATIVE FIXTURE (buyerDropCode in readiness evidence, must fail)"
capture four-secrets-negative fail node scripts/gates/no-drop-code-in-seller-evidence.mjs gates/fixtures/negative/readiness-evidence.with-drop-code.json

log "gate: no-expo-token-leak — repo source + workflows + lockfile (must pass)"
capture no-expo-token-leak-positive pass node scripts/gates/no-expo-token-leak.mjs

log "gate: no-expo-token-leak — NEGATIVE FIXTURE (committed token literal, must fail)"
capture no-expo-token-leak-negative fail node scripts/gates/no-expo-token-leak.mjs gates/fixtures/negative/no-expo-token-leak

log "gate: single-level — repo source (must pass)"
capture single-level-positive pass node scripts/gates/single-level.mjs

log "gate: single-level — NEGATIVE FIXTURE (downline/recruit, must fail)"
capture single-level-negative fail node scripts/gates/single-level.mjs gates/fixtures/negative/single-level

log "gate: French Voice copy-lint — rider-app catalog (must pass)"
capture copy-lint-rider-positive pass pnpm exec copy-lint apps/rider-app/i18n/catalog.json

log "gate: French Voice copy-lint — dispatch-console catalog (must pass)"
capture copy-lint-console-positive pass pnpm exec copy-lint apps/dispatch-console/i18n/catalog.json

log "gate: French Voice copy-lint — NEGATIVE FIXTURE (veuillez/séquestre + marketing-in-money + Mooré-in-instruction, must fail)"
capture copy-lint-negative fail pnpm exec copy-lint gates/fixtures/negative/catalog.negative.json

log "gate: contracts drift-check — honest /docs copy vs pinned canon manifest (must pass)"
capture drift-check-positive pass pnpm exec drift-check docs --pinned-version 0.9.0

log "gate: contracts drift-check — TAMPERED doc (must fail)"
DRIFT_TMP="$(mktemp -d)"
cp -r docs "$DRIFT_TMP/docs"
printf '\nrogue edit — this consumer copy drifted from canon\n' >> "$DRIFT_TMP/docs/Sera-Build-Spec.md"
capture drift-check-negative fail pnpm exec drift-check "$DRIFT_TMP/docs" --pinned-version 0.9.0
rm -rf "$DRIFT_TMP"

log "dispatch console — Playwright harness (shell boots on the sera theme)"
capture playwright-e2e pass pnpm --filter @sera/dispatch-console test:e2e

if [ $FAILED -ne 0 ]; then
  echo ""
  echo "ONE OR MORE GATES FAILED"
  exit 1
fi
echo ""
echo "ALL GATES GREEN (positives passed; every negative fixture failed as required)"
