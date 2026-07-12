# WO-6.2 REVIEW PACKET — the expo-preview publish was RED (rider's face not on the phone)

Branch `e6/wo-6.2` · 2 commits ahead of `origin/main`. Do NOT merge — awaiting founder verdict.
- `282cf55` fix: expo-font as a direct dep so the config plugin resolves
- `107ac6b` test: the regression guard + dependency-allowlist update

## Contents
- `FAILING-LOG-QUOTE.md` — the CI error verbatim + the reproduced real `PluginError`.
- `WO-6.2.diff` — the full diff (`git diff origin/main...HEAD`), 4 files.
- `cold-gates.log` — the cold-clone gate run (EXIT 0).
- `verifier-brief.md` / `verifier-verdict.md` — the fresh-context verifier's charge + verdict.

## DoD (all log-copied, my own runs)
- **Failing run's error QUOTED** — CI: `expo/bin/cli config --json exited with non-zero
  code: 1` / `project:init command failed`. Real cause (reproduced cold, raw invocation
  as eas does): `PluginError: Failed to resolve plugin for module "expo-font" relative to
  .../apps/rider-app` at `@expo/config-plugins/.../plugin-resolver.js:96`.
- **Cause named + others eliminated:** (a) the expo-font config plugin — CONFIRMED.
  (b) fonts excluded — ELIMINATED (failure is at plugin *resolution*, upstream of asset
  bundling; names the plugin module, not a font; 7 .ttf tracked). (c) lockfile/frozen —
  ELIMINATED (CI frozen install "Done in 57.2s"; my cold frozen install succeeded).
  (d) native rebuild (rn-svg/haptics) — ELIMINATED (stack is @expo/config-plugins; no
  native build; only expo-font has a plugin in app.json).
- **Fix + forcing evidence:** raw `expo config --json` was EXIT 1 (PluginError) before,
  EXIT 0 with 5 Archivo fonts after — proven in a cache-isolated cold clone.
- **RULING ② intact:** the fix is a direct-dep addition only; app.json keeps the
  expo-font config plugin (native embedding), App.tsx has no useFonts/loadAsync/render
  gate. NOT async loading — no founder decision needed.
- **Regression guard, non-vacuous:** `preview-font-embedding.test.ts` fails on all three
  silent drop modes; proven — removing a font → "font asset missing", removing the dep →
  "expo-font must be a DIRECT dep"; restore → green.
- **All prior gates green** — `run-gates.sh` EXIT 0 (warm + cold); rider **58/58**
  (55 + 3 guard); typecheck 0 both apps. **Cold proof** EXIT 0 @ `107ac6b`.

## Why local gates missed this (the honest gap)
`pnpm exec expo config` masks it — pnpm injects resolution paths so the transitive
expo-font resolves. eas-cli spawns expo RAW, so `@expo/config-plugins` does plain node
resolution from the app dir, where a transitive dep is unreachable under pnpm isolation.
typecheck/vitest never invoke `expo config`, so nothing local exercised the path. The
new guard now closes that gap in the gate.
