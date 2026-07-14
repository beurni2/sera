# SERA-S2 · custody evidence on the outbox — REVIEW PACKET

🔴 RED slice · branch `e6/sera-s2-custody-outbox` off the merged S3 head `f4aadfe` (canon v0.9.8)
feat HEAD `9eec59e` · **DO NOT MERGE — holds for the founder's ruling.**

## The invariant

**SE-I06** (`docs/Sera-Build-Spec.md:38`):
> Offline evidence may be queued, but **custody/delivery validation + financial release remain pending until authoritative server ack**.

The bug the slice closes: the retired `nextAfterEvidence(connectivity)` returned `'drop'` when **online** — it unlocked custody finality on *connectivity*, conflating "online" with "acked". Being online is not being acked.

## Red-proof first (`red-proof.log`)

The red-proof asserted that online evidence capture must stay `'evidence_pending'`. Against the pre-fix code it **FAILED** — `expected 'door_inspection' to be 'evidence_pending'` — proving the server-ack gate is load-bearing. That fixture, grown into the full finality suite, is now green.

## The change (6 source/UI files, 4 test files, 3 strings)

| File | What |
|---|---|
| `src/custody-flow.ts` | retire `nextAfterEvidence`; add `stepAfterEvidenceAck(FlushOutcome)` (`applied`/`idempotentReplay`→`drop`→door_inspection; `collision-refused`→stays pending) + `SANDBOX_EVIDENCE_ACK='applied'` (typed sandbox data, like `SANDBOX_DOOR_SIGNAL`) |
| `src/offline/evidence.ts` (NEW) | durable evidence layer mirroring `sos.ts`: `EVIDENCE_KIND='delivery.evidence'`, `appendEvidence(store, commandId, intent)` — pre-minted id, `pending` |
| `src/demo/store.ts` | `captureEvidence(world,id)` drops connectivity → always `evidence_pending` (LOCKS the drop); `applyEvidenceServerAck(world,id,ack)` is the only exit, mirrors `applyProviderDoorSignal`/SE-I11 |
| `src/journey.ts` | `evidence→['evidence_pending']`; `evidence_pending` forward edge **computed** from `stepAfterEvidenceAck` → `['door_inspection','courses']` |
| `App.tsx` | evidence capture mints once, lands pending instantly, `void appendEvidence(outboxStore,…)` background; `sosStore`→one `outboxStore` (single document-dir queue, `kind`-discriminated); `evidence_pending` screen mirrors `payment_wait` |
| `i18n/catalog.json` | `evidence.pending` refined to the SE-I06 truth; `+evidence.confirmed_status`, `+evidence.continue_action` |

## Evidence

- **Rider-app 86/86** (incl. `evidence-finality` 5/5, `evidence-outbox` 3/3). **Typecheck clean.**
- **`run-gates.sh` ALL GREEN** — every positive passed, every negative fixture failed with exit 1. Includes the SE-I06 service gates `offline-never-final` + `offline-flush-binding` (pos/neg), `mint-path-entropy` (pos/neg), `copy-lint` (`OK: 145 entries, 0 violations`), drift-check `0.9.8` (pos/neg), Playwright 22/22. Per-gate logs under `gates/`.
- **COLD PROOF both lines** (`cold-proof.log`, cold HEAD `9eec59e`): **COLD** — fresh HOME (cache-cold), frozen install exit 0, cold `@platform/contracts` 0.9.8, cold typecheck 0, cold **86/86**; **AUTH** — 0 ssh-form URLs (CI-equivalent https rewrite, config not cache).
- **Fresh-context verifier: DoD MET, blocking none** (`verifier-verdict.md`, verbatim). Traced the drop unreachable until the ack; proved both new fixtures non-vacuous under mutation. Two non-blocking awareness notes (below).

## Two non-blocking notes (surfaced honestly, agreed)

1. **`!offline` UI conjunct** on the `evidence_pending` confirm screen (which `payment_wait` lacks): honest — one cannot hold a server ack while offline; the **store** (SE-I06's true home) never sees connectivity and advances only on the ack value. No "online==acked" in any enforced path.
2. **`evidence → evidence_pending` journey edge is a literal**, not rule-derived: acceptable because `captureEvidence` is an unconditional transition with no branch domain to enumerate (there is no `stepAfterCapture`); the SE-I06-critical edge (the ack) *is* rule-computed.

## FORBIDDEN respected

`CONNECTIVITY` constant untouched (S4's — still consumed by the decline + `raiseSos` paths) · no franc anywhere on the evidence surface · no new deps (evidence.ts imports only relative `./outbox`/`./commandId`; RN-safe shell green) · no custody regression.

## What's next (not this slice)

**S4** — real connectivity detection, retires the `CONNECTIVITY` constant, adds the S3-named `.catch` hardening + the backlog-banner surface to route background-persist errors to. Closes the offline-durability arc.
