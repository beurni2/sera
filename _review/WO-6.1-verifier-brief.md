# FRESH-CONTEXT VERIFIER BRIEF — WO-6.1 (Séra rider app + dispatch console on Grand Teint)

You are a fresh-context verifier. You have NO memory of how this code was built.
Judge ONLY the code on the current branch against the canon quotes and DoD below.
Your job is to try to BREAK the invariants, not to confirm them. Report findings
most-severe first, each as: file:line · the invariant at risk · the concrete
failing scenario (inputs → wrong output). End with an explicit
`VERDICT: PASS` or `VERDICT: FAIL` and a `BLOCKING:` list (empty if none).

## What changed (the diff to judge)
- Full diff: `/home/user/sera/_review/WO-6.1.diff` (branch `e6/wo-6.1`, 3 commits ahead of `main`).
- It is a RESKIN of the Séra rider app (`apps/rider-app`) + dispatch console
  (`apps/dispatch-console`) onto the Grand Teint design system (ui-tokens
  v0.9.0), PLUS a pin bump of all `@platform/*` to canon SHA fa2ff24, PLUS a
  new `src/two-key-return.ts`, a new `test/wo6-invariants.test.ts`, and a
  1-line-family fault-attribution addition in
  `services/custody-service/src/refusal-ladder.ts`.
- The builder CLAIMS the transaction/custody SPINE is byte-identical:
  `apps/rider-app/src/journey.ts`, `src/custody-flow.ts`, `src/demo/store.ts`
  unchanged. VERIFY that claim yourself (`git diff main...HEAD -- <file>`).

## The canon this must satisfy (quoted verbatim from docs/Sera-Build-Spec.md)
- **SE-I11 (payment-before-handoff):** "For Option B, custody MUST NOT transfer
  to the buyer before an authoritative provider-confirmed door payment (or a
  signed break-glass HandoffAuthorization). A rider MUST NOT accept a
  screenshot/SMS/verbal/pending as proof, and MUST NOT accept payment into any
  personal account."
- **SE-I05 / SE6.3:** "buyer pays product leg → authoritative provider
  confirmation → HandoffAuthorization → custody → customer (`buyerDropCode`
  entered last)". "Evidence supports, never releases; a rider
  code/photo/GPS/self-declaration alone MUST NOT release money."
- **SE-I10:** "Every failed-delivery reason produces an explicit
  retry/return/cancellation/support/incident behavior. No generic failed
  terminal state."
- **Two-key return (§6.5 / SE7):** "custody stays with courier/hub until a
  supplier two-key return handoff + inspection." Both keys, or neither.
- **Four secrets:** "buyerDropCode (private — never shown to the seller)";
  "the four secrets never substituted; buyerDropCode never in seller/readiness
  evidence."
- **No funds:** "Séra emits events + reads order/delivery context only";
  "no platform-fund/wallet module". Séra emits SIGNALS, never money — there
  must be NO franc amount on any Séra surface.
- **SOS:** "SOS drill passes before pilot." R14 requires SOS reachable in ONE
  gesture from ANY screen, and NOT accidentally triggerable.
- **French Voice Standard (Contract §10.5):** copy-lint must be clean; strings
  live in the i18n catalog, register-tagged, never inline.

## The DoD (what "done" means)
Rider R1–R14 + console leased states restyled on Grand Teint v0.9.0; spine
byte-identical; typecheck 0 both apps; all suites green; copy-lint clean both
catalogs; CLS=0 (native-driver animation only); font embedded at first frame;
U+202F renders (only place is the seal ID; NO franc anywhere); gallery
byte-stable; `run-gates.sh` EXIT 0.

## PROBES — try hard to make each FAIL, then report what you found
1. **Rider asserts payment through ANY seam.** Read `apps/rider-app/App.tsx`
   `payment_wait` screen + `src/demo/store.ts` `applyProviderDoorSignal` +
   `src/custody-flow.ts`. Can the rider — via a button, a field, a gesture, a
   default arg, a type hole, an out-of-order store call — advance the door
   state on their own word (screenshot/verbal/pending/self-declared)? The only
   legal mover is the provider signal. Try `applyProviderDoorSignal(world, id,
   'pending')`, `'moi_le_livreur'`, calling it from a wrong step, etc.
2. **Surface the drop code before provider confirmation.** Can `CodeCells` /
   `Keypad` / `validateDropCode` be reached before
   `applyProviderDoorSignal('confirmed')`? Is the drop-code entry present on any
   screen other than `drop`? Can the spine reach `drop` on the `pending` signal?
3. **Single-key return releases custody.** Read `src/two-key-return.ts` +
   the `retour_colis` screen. Does `attemptReturnHandover` ever return
   `'released'` with fewer than both keys? Can the final confirm fire with one
   key? Is there any path that turns the rider key without the seller key first?
4. **SOS from three arbitrary screens.** Is `<SosButton>`/`<SosSheet>` mounted
   inside any `screen === …` branch (i.e., missing on some screens)? Is it
   exactly one instance, outside every branch? Can it fire on a single
   accidental tap (should require a deliberate hold)?
5. **Font at first frame in the built artifact.** Read `apps/rider-app/app.json`
   (expo-font config plugin) + confirm the referenced `.ttf` files exist. Is the
   font actually embedded in the binary, or only lazy-loaded at runtime (which
   would flash system font)? Note honestly what can and cannot be proven without
   a device.
6. **Any franc amount anywhere in Séra.** Scan `App.tsx`, `src/ui/kit.tsx`, both
   `i18n/catalog.json`, and `apps/dispatch-console/src/main.ts` for a rendered
   franc figure (a number followed by FCFA/CFA/F, or the word franc). Séra emits
   signals, never money. The seal ID grouping (U+202F) is NOT a franc — do not
   false-positive on it.
7. **Spine byte-identity.** Confirm `journey.ts`, `custody-flow.ts`,
   `demo/store.ts` are unchanged vs `main` (`git diff main...HEAD -- <file>`
   must be empty). If any changed, that is a finding.
8. **Tests that assert nothing.** Read `test/wo6-invariants.test.ts` — does each
   `it()` actually assert the invariant it names, or is it green-for-nothing?

Run whatever you need (`git diff`, read files, `pnpm --filter … test`,
`bash scripts/run-gates.sh`). Ground every finding in a file:line and a
concrete scenario. Do NOT fix anything — report only.
