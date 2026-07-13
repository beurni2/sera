# WO-6.6 — the regression guard: sera's is present, and stronger than a verbatim boutik port

The WO said "PORT `font-embedding.test.ts` from boutik-plus." I read boutik's guard before porting, and did NOT port it — because sera already carries an equivalent-and-stronger guard, and porting boutik's would have been a weaker duplicate. The bytes:

## sera — `apps/rider-app/test/font-embedding.test.ts` (added WO-6.3)
- A **pure-TS sfnt reader** (no external tool). Reads the real TTF bytes and asserts, per file:
  - the OS/2 `usWeightClass` (400/500/700/800/900), and
  - the distinct weight-specific family (name ID 1), and
  - the family is not the collided `Archivo SemiBold`.
- Asserts `new Set(families).size === 5` — **fails if any two faces ever share a family**.
- Runs on every CI gate: `run-gates.sh:41` → `pnpm test` → rider `vitest run` picks it up. Permanent.
- **Proven non-vacuous** (see `nonvacuity-proof.txt`): planting Bold's identity onto Medium fires BOTH assertions (weight-class + distinctness); reverting restores green.

## boutik — `apps/supplier-app/test/font-embedding.test.ts` (read-only comparison)
- Its byte-level name check uses `fontTools` and **skips cleanly if python/fontTools is absent** — a guard that can no-op in an environment without the tool.
- Its other assertions (expo-font plugin declares 5 instances · no async font load · kit addresses each weight by family) are the **native-embedding MECHANISM**, which sera guards separately in `apps/rider-app/test/preview-font-embedding.test.ts`.

## Conclusion
For the name-table collision specifically, sera's pure-TS reader is **strictly more robust** than boutik's fontTools-or-skip (it never skips; it always asserts). A verbatim port is impossible anyway (different font module: sera's `fam()` in `kit.tsx` vs boutik's `fontFamilyForWeight` in `src/ui/fonts.ts`), and an adapted port would only re-create sera's existing guard. Keeping sera's guard, proven non-vacuous, satisfies the WO's intent — a permanent regression guard that fails if any two faces share a name-table identity — without a weaker duplicate.
