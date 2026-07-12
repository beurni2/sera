# WO-6.1 FRESH-CONTEXT VERIFIER VERDICT — verbatim

All 8 probes executed, both apps typecheck clean (EXIT 0), which also validates the `@ts-expect-error` type hole is genuinely closed.

## Findings

**1. Two-key return is enforced UI-side only — `completeReturn` does not re-check the keys.** · `apps/rider-app/src/demo/store.ts:314-317` · Two-key return (SE6.2). `completeReturn` only calls `expectStep(course, ['retour_colis'])` then closes; it never calls `attemptReturnHandover`. The both-keys gate lives entirely in App.tsx (the `disabled` prop at `App.tsx:766` + the rider-key guard at `App.tsx:750`). In the UI this is airtight — RN `Pressable` honors `disabled` (kit.tsx:309) so `onPress` cannot fire with fewer than two keys, and the rider key cannot be turned before the seller key. But any future non-UI caller of `completeReturn` would bypass the invariant. This is the documented sandbox boundary (both `two-key-return.ts:5-8` and `store.ts:311-313` state the live both-keys-consumed handover "lands with the service at assembly"). Severity: **NIT** (documented, demo-scoped; store is byte-identical spine).

**2. Stale `fonts.ts` comment contradicts the config-plugin embedding.** · `apps/rider-app/src/ui/fonts.ts:7-14` · DoD "font embedded at first frame." The comment describes async fallback-first loading ("Expo loads custom fonts asynchronously … swapping to Archivo when ready"), but this WO's `app.json:19-32` uses the **expo-font config plugin** (build-time native embedding, available at first frame — a different mechanism). No functional impact: App.tsx has **no** `useFonts`/`Font.loadAsync`/`AppLoading` gate (grep-confirmed), so first render is never blocked, and the metrics-matched `System` fallback would paint with no reflow if needed. The stale comment could mislead a future reader. Severity: **NIT**. Honest caveat: first-frame *glyph paint* cannot be proven without building the native binary on a device; the config (plugin + 5 real `.ttf` + no render gate + `fam()` returning filename-stem family names) is correct for it.

## Probe results

1. **Rider asserts payment — NO seam.** `applyProviderDoorSignal` is the only door mover, single call site `App.tsx:630`, and it passes the constant `SANDBOX_DOOR_SIGNAL`, never rider input. Triple-guarded: type (`@ts-expect-error` at test:74 confirmed a real compile error — typecheck EXIT 0), runtime throw (`store.ts:245-247`), and `expectStep(['payment_wait'])`. `applyProviderDoorSignal(world,id,'pending')` → stays `payment_wait` (unit-tested, test:78). No `<TextInput>` exists anywhere in the rider app. The `payment_wait` "Continuer" button is an acknowledgment-to-proceed after the (simulated) provider signal; the pending branch offers only a `PendingNotice`, no action. PASS.

2. **Drop code before confirmation — cannot.** `CodeCells`/`Keypad`/`validateDropCode` appear only inside the `screen === 'drop'` branch (`App.tsx:642-663`), exactly one each (test-asserted). `JOURNEY.payment_wait` resolves to exactly `['drop']` (journey.ts:84-86), reachable only via the `'confirmed'` signal. PASS.

3. **Single-key return — refuses.** `attemptReturnHandover` (two-key-return.ts:24-25) is a pure `seller && rider` gate; all four combinations unit-tested. UI blocks the confirm button unless both keys and refuses turning the rider key without the seller key. PASS (see Finding 1 for the store-side caveat).

4. **SOS — one gesture, every screen, not accidental.** Exactly one `<SosButton>`/`<SosSheet>` at `App.tsx:815-816`, top-level outside every `screen ===` branch (structurally tested). Tap → opens confirm sheet only; firing requires a 650ms hold (`onPressIn` arms timer `App.tsx:293-301`, `onPressOut` cancels). PASS.

5. **Font at first frame.** Config-plugin embedding + all 5 `Archivo-*.ttf` present + no render gate. Correct setup; pixel-level first-frame paint not provable in this sandbox (noted). PASS with caveat. See Finding 2.

6. **Franc anywhere — none.** Zero rendered franc in `App.tsx`, `kit.tsx`, both `catalog.json`, and `dispatch-console/src/main.ts` (only a comment mentions "NO franc"). Copy-lint clean (rider 137 entries / console 32 entries, 0 violations). Only grouping is the seal ID `SC-77⯍412` using U+202F (`App.tsx:336`), correctly not a franc. PASS.

7. **Spine byte-identity — verified true.** `git diff main...HEAD` is **empty** for `journey.ts`, `custody-flow.ts`, and `demo/store.ts`. The builder's claim holds. PASS.

8. **Tests assert nothing? — no, they assert well.** All 11 `wo6-invariants.test.ts` blocks carry real assertions, including a runtime hostile-input store test (`'moi_le_livreur'` throws, `'pending'` stays, `'confirmed'`→`drop`, and `doorSurfaces === ['applyProviderDoorSignal']`) and structural SOS/drop-code/franc scans. 55/55 tests pass. PASS.

**Refusal-ladder change (SE-I10 / fault attribution):** `conformity_mismatch: 'seller'` (refusal-ladder.ts:48) is added only to keep `faultByReason` exhaustive over the v0.9.0 canon enum; `isTaxonomyReason` (line 65-67) excludes it, so `openRetryWindow` refuses it closed — it never enters the retry/escalation arms. Fault `'seller'` is correct per **Sera-Build-Spec.md:109** verbatim: "On mismatch/damage → rider refuses custody … (Protection Fund, `faultClass = seller`)." Correct and well-scoped. No finding.

## Gate evidence
- `pnpm --filter @sera/rider-app test` → 55/55 pass.
- `pnpm exec tsc --noEmit` → rider EXIT 0, console EXIT 0 (DoD "typecheck 0 both apps" holds).
- `bash scripts/run-gates.sh` → **EXIT 0** ("ALL GATES GREEN"): copy-lint clean both catalogs, drift-check clean (11 docs, packageVersion 0.9.0), every negative fixture failed as required. Console Playwright e2e ran here and passed **11/11** (incl. the signal-driven door line: "honest pending BEFORE the signal, « Confirmé par le réseau » only AFTER it").

VERDICT: PASS

BLOCKING: none

---

## CTO disposition of the two NITs
- **Finding 1 (completeReturn store-side re-check):** ACCEPTED as the documented assembly-era boundary. NOT fixed here — the store is the byte-identical E1 spine and the WO FORBIDS spine changes; the live both-keys-consumed handover is assembly-era work (`two-key-return.ts:5-8`, `store.ts:311-313`). Carried to the assembly work order.
- **Finding 2 (stale fonts.ts comment):** FIXED on-branch — the comment now describes the WO-6.1 config-plugin native embedding (Archivo in the binary, paints at first frame; `FONT_FALLBACK` kept as metrics-matched defence-in-depth). Comment-only; rider 55/55 + typecheck 0 re-confirmed.
