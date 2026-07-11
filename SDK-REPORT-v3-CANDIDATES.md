# SDK-REPORT-v3-CANDIDATES (sera — apps/rider-app) — WO-4.0d-PREP (re-target reconnaissance, NO changes executed)
2026-07-11 · registry probes live at 06:00:52Z (`registry-dist-tags.txt` in the packet) · every number below is log-copied from `npm view` / npm-packed tarballs — zero memory, zero guesses.

## Founder evidence (verbatim, the decision input)
> the founder's iPhone Expo Go reports Supported SDK 54 with NO store update available — SDK 57 apps cannot open there. The Android reference device (Itel A-series, D17) arrives tomorrow; its Expo Go SDK number completes the target decision. RULE: the apps target the founder's clients, not the registry's latest; if the two devices diverge, THE ANDROID NUMBER WINS (D17 doctrine — iOS falls back to the gallery).

## Current set (SDK 57, on main since WO-4.0b)
expo ~57.0.4 · react-native 0.86.0 · react 19.2.3 · expo-status-bar ~57.0.0 · expo-updates ~57.0.6 · babel-preset-expo ~57.0.2 · @types/react ~19.2.2 · typescript 5.9.3 (workspace)

## Candidate 54 (the likely target — matches the founder's iPhone)
| package | SDK-57 (current) | SDK-54 target | source |
|---|---|---|---|
| expo | ~57.0.4 | **54.0.35** | dist-tag `sdk-54` |
| react-native | 0.86.0 | **0.81.5** | expo@54.0.35 bundledNativeModules.json |
| react | 19.2.3 | **19.1.0** | same |
| expo-status-bar | ~57.0.0 | **~3.0.9** | same |
| expo-updates | ~57.0.6 | **~29.0.18** | same |
| babel-preset-expo | ~57.0.2 | **~54.0.11** | expo@54.0.35 own dependencies |
| @types/react | ~19.2.2 | **~19.1.0** | expo-template-blank-typescript@sdk-54 devDependencies |
| typescript | 5.9.3 | **~5.9.2 (unchanged)** | same template |

**API surfaces our code touches, forcing evidence quoted:**
- `StatusBar` (App.tsx ×3): expo-status-bar@3.0.9 shipped `types.d.ts` → `StatusBarProps` = `{ style?, animated?, hidden?, hideTransitionAnimation?, networkActivityIndicatorVisible?, backgroundColor?: string, translucent? }`. **`backgroundColor` is present but OPTIONAL — the SDK-54 re-target FORCES NOTHING** (our current `<StatusBar style="dark" />` typechecks). Restoring `backgroundColor={theme.colors.surface}` is a visual-parity CHOICE (pre-edge-to-edge Android draws a default status-bar background) to be flagged at re-target, not a forced change. (The prop's removal happened at SDK 56 — see candidate 56.)
- `EXPO_PUBLIC_PROFILE` inlining (src/preview.ts, the banner gate): babel-preset-expo@54.0.11 build references `EXPO_PUBLIC_` (1 file) — the inlining mechanism exists; the banner design holds.
- `runtimeVersion: {policy: "sdkVersion"}` (app.json ×3): expo@54.0.35 depends on @expo/config-plugins ~54.0.4; its shipped `build/utils/Updates.js:151` = `} else if (policy === 'sdkVersion') {` — the policy is a live branch. Updates would carry `exposdk:54.0.0`, matching the founder's iPhone Expo Go.
- RN core surfaces (View/Text/StyleSheet/Pressable/SafeAreaView, registerRootComponent): present across RN 0.81–0.86 / expo 54–57; no type-level trail of removal in either direction for what the shells use.

**Candidate-54 verdict: downgrade = manifest set only; zero forced code changes; one flagged visual-parity choice (StatusBar backgroundColor restore). No STOP.**

## Candidate 55
expo **55.0.27** · react-native **0.83.6** · react **19.2.0** · expo-status-bar **~55.0.6** · expo-updates **~55.0.25** · babel-preset-expo **~55.0.23** · @types/react **~19.2.2** · typescript **~5.9.2**.
- expo-status-bar@55.0.6 `StatusBarProps` is IDENTICAL in shape to 3.0.9 (backgroundColor?/translucent? present, optional) — nothing forced.
- babel-preset-expo@55.0.23: EXPO_PUBLIC_ inlining present (1 file). @expo/config-plugins@55.0.10 `Updates.js:152` carries the sdkVersion policy branch.
**Verdict: same class as 54 — manifest set only, zero forced changes. No STOP.**

## Candidate 56
expo **56.0.15** · react-native **0.85.3** · react **19.2.3** · expo-status-bar **~56.0.4** · expo-updates **~56.0.21** · babel-preset-expo **~56.0.17** · @types/react **~19.2.2** · typescript **~6.0.3 (template — same TS-6 question as 57; ours stays 5.9 unless typecheck forces)**.
- expo-status-bar@56.0.4 `StatusBarProps` = `{ style?, animated?, hidden?, hideTransitionAnimation? }` — **backgroundColor already REMOVED at 56** (same shape as 57): our current code is already correct for 56; nothing forced either direction.
- babel-preset-expo@56.0.17: EXPO_PUBLIC_ inlining present (2 files). @expo/config-plugins@56.0.12 `Updates.js:156` carries the sdkVersion policy branch.
**Verdict: manifest set only, zero forced changes. No STOP.**

## Standing conclusions (no candidate stopped)
1. Every candidate re-target is the WO-4.0b mechanics in reverse: manifest seven-tuple + lockfile regeneration + the standing evidence chain. No surface beyond the manifest set + mechanically-typed surfaces was found for ANY candidate.
2. The only code-line question across all candidates is StatusBar `backgroundColor` — optional at 54/55 (restore = flagged visual-parity choice), absent at 56/57 (current code correct).
3. The banner mechanism (EXPO_PUBLIC_ inlining) and `runtimeVersion: sdkVersion` policy hold at every candidate, evidence quoted above.
4. HOLD stands: no version changes on this branch. The target number arrives from the founder's devices; **the Android number wins** on divergence (D17; iOS falls back to the gallery).
