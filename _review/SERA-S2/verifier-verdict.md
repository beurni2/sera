# FRESH-CONTEXT VERIFIER REPORT — SERA-S2 evidence finality vs SE-I06

_Verbatim output of the fresh-context verifier subagent (no memory of the build
conversation). Given only: the SE-I06 quote, the diff (`git diff f4aadfe -- apps/rider-app`),
the archived red-proof, and the DoD. Ran its own `pnpm test` (86/86) + `pnpm typecheck` (clean)._

---

**Governing invariant, quoted** (docs/Sera-Build-Spec.md:38):
> **SE-I06:** Offline evidence may be queued, but **custody/delivery validation + financial release remain pending until authoritative server ack**.

Environment checks I ran myself: `pnpm test` → **86/86 pass** (14 files, incl. the 2 new fixtures); `pnpm typecheck` → **clean**. The archived RED (`_review/SERA-S2/red-proof.log`) shows the pre-fix code returning `'door_inspection'` on `online` — the exact bug this slice closes.

---

### A. Is the drop reachable while merely online, without an `applied`/`idempotentReplay` ack? — **PASS**

Traced the full chain; the drop is unreachable until the ack.
- `captureEvidence` (src/demo/store.ts:263-266) takes **no connectivity argument** and unconditionally lands `evidence_pending`, guarded `expectStep(courseById(...), ['evidence'])`.
- `applyEvidenceServerAck` (src/demo/store.ts:273-281) is the **sole exit**, guarded `expectStep(..., ['evidence_pending'])`; it maps via `stepAfterEvidenceAck(ack)` — `collision-refused`→stays `evidence_pending`, else→`door_inspection`.
- `validateDropCode` (src/demo/store.ts:310-313) is guarded `expectStep(..., ['drop'])`.
- Grep confirms `captureEvidence` is called at exactly one App site (App.tsx:633) and does **not** advance; the only `applyEvidenceServerAck` call (App.tsx:655) passes the external constant. The other two `step: 'door_inspection'` writes (store.ts:332 `retryDelivery`, store.ts:352 the spawned 2e-passage seed) are off the evidence path and independently guarded. There is no store/journey/App path from evidence to drop that skips the ack.

### B. Are the two new fixtures non-vacuous? — **PASS**

`test/evidence-finality.test.ts`:
- Asserts the drop **throws** while pending: `expect(() => validateDropCode(world, id)).toThrow(/custody out of order/)` (line 34), and step is unmoved (line 35).
- Asserts `collision-refused` does **not** unlock: returns `'evidence_pending'` and drop still throws (lines 43-45).
- Asserts `applied` is the authoritative unlock through the full chain to `delivered`/`closed` (lines 49-56), and that the ack **cannot** be applied before a capture (line 74-76 → throws).
- Mental mutation `captureEvidence → 'door_inspection'`: line 32 `expect(...).toBe('evidence_pending')` fails. Mutation "collision-refused unlocks": line 43 fails. Caught.

`test/evidence-outbox.test.ts` proves **exactly once**, not merely "flush returns applied": `expect(applied).toEqual([commandId])` after a lost-ack retry replays the same id as `idempotentReplay`, plus `restore(...).toHaveLength(0)` (replay settles/drops). `id-stable-across-retry` flushes 3× under `collision-refused` and asserts `sent === [commandId, commandId, commandId]` and `new Set(sent).size === 1` — this would fail if the id were re-minted per attempt.

### C. Can the rider self-assert the ack? — **PASS** (one nuance flagged)

The rider cannot choose the ack value. App.tsx:655 passes the **constant** `SANDBOX_EVIDENCE_ACK`, and the confirm button renders only when that constant is `'applied'` — structurally identical to the SE-I11 `payment_wait` screen (App.tsx:694-701, which passes `SANDBOX_DOOR_SIGNAL`). The ack is an external signal (sandbox stand-in for the live flush outcome), not a rider input.
- **Nuance for your eye (not a violation):** the confirm screen is additionally gated on `!offline` (App.tsx:650), which `payment_wait` does not do. This is *honest* — you cannot hold a server ack while offline, so offline correctly shows only the wait — and the store (SE-I06's true home) never sees connectivity. It does not create "online == acked" in any enforced path; the store advances only on the ack value. Worth knowing that in the demo, because `SANDBOX_EVIDENCE_ACK` is a fixed constant, flipping the connectivity toggle to online is what surfaces the Continue button — but the button's action still applies the ack outcome, faithfully modeling "online → flush ran → returned applied."

### D. Durable layer correctness — **PASS**

`command_id` is minted **once** at the gesture (App.tsx:632 `mintCommandId()`), passed to `appendEvidence`, which uses `append` (not `enqueue`, so it never re-mints) with `status: 'pending'` (src/offline/evidence.ts:44). Dedup is on `command_id` at the authority; the outbox drops `applied`/`idempotentReplay` and keeps `collision-refused` (outbox.ts:98-116). This byte-mirrors `sos.ts appendSosRaise` (append with pre-minted id, kind, pending). The reboot fixture proves committed bytes survive via a fresh `fileStore` re-read (`status === 'pending'`, id/kind/payload intact). `mintCommandId` adopts the canon crypto-UUID helper (commandId.ts:16); the UUID-v4 shape is asserted in the outbox test.

### E. Journey graph computed, not hand-re-encoded — **PASS** (one note)

The **finality edge** `evidence_pending → door_inspection` is computed from the rule: journey.ts:79-82 builds it via `afterAck(ack) = stepAfterEvidenceAck(...)`, and the spine test asserts it derives from `stepAfterEvidenceAck` (journey-spine.test.ts:68-74), not a literal. Reachability BFS is still asserted (test:26-38, every screen reachable) with no dangling edges (test:40-46); `evidence_pending` resolves to `['courses','door_inspection']`.
- **Note:** the `evidence → evidence_pending` edge is a literal `['evidence_pending']` (journey.ts:74) rather than rule-derived. This is acceptable: `captureEvidence` is an unconditional transition with no branching rule/domain to enumerate (there is no `stepAfterCapture`), so there is nothing to compute — unlike the old `nextAfterEvidence` which had two branches. No drift risk of consequence, and the SE-I06-critical edge (the ack) is computed.

### F. SE-I06 / custody regression, French Voice on the 3 strings, online==acked anywhere — **PASS**

- No regression: `demo-store` walk and `sos`/`journey`/`grand-teint` suites all green; the door/payment (SE-I11) and refusal-ladder paths are untouched.
- French Voice on the 3 catalog strings (i18n/catalog.json), all `register`-tagged, calm/plain/6th-grade, no administrative French: `evidence.pending` = "La photo est partie. La remise attend la confirmation de Séra." · `evidence.confirmed_status` = "Séra a confirmé la photo." · `evidence.continue_action` = "Continuer." Clean.
- "online == acked" appears nowhere in the store or the tests; the single online-adjacent UI conjunct is the honest `!offline` guard discussed under C.

---

## OVERALL VERDICT: **DoD MET**

All four DoD clauses hold under adversarial tracing: (1) capture locks at `evidence_pending` and only the ack — not connectivity — advances, with `collision-refused` kept pending; (2) the capture is a durable, minted-once, reboot-surviving, exactly-once outbox write mirroring the S3 pattern; (3) the rider cannot self-assert the ack (external constant, SE-I11 discipline); (4) no regression, finality edge rule-computed, spine reachability still asserted. Tests are non-vacuous and would fail under the obvious mutations. Typecheck and full suite are green.

Two items for your awareness, neither blocking: the `!offline` UI conjunct on the confirm screen (item C — honest, store-independent) and the single literal `evidence → evidence_pending` journey edge (item E — no rule domain to enumerate).
