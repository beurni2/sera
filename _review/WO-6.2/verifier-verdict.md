# WO-6.2 FRESH-CONTEXT VERIFIER VERDICT — verbatim

All four mandate items executed by hand. All probes reverted; tracked tree clean (only `_review/WO-6.2/`, the brief itself, remains untracked). Branch `e6/wo-6.2`.

---

## VERIFIER FINDINGS — WO-6.2 (expo-preview publish RED)

Most-severe first. Every claim was tested adversarially; none broke. No defects found.

**① CI log & run history — CONFIRMED (independent read).**
`get_job_logs` (run `29209620504`, job `86695010823`, failed_only) shows the failing step is the `eas init` step (`npx eas-cli@20.5.1 init --non-interactive --force`), which spawns `.../expo@54.0.35.../expo/bin/cli config --json` → "exited with non-zero code: 1" → `Error: project:init command failed.` → `##[error]Process completed with exit code 1`. `list_workflow_runs` on `expo-preview.yml`: #22 `4e1b278` failure, #21 `6644310` (WO-6.1 merge) failure, #20 `b705251` **success**. Matches the brief exactly.
- Transparency note (non-blocking): the CI log surfaces only the exit code — eas-cli swallows the raw `PluginError` text. The PluginError attribution therefore rests on my local reproduction below, not on CI log text. The reproduction is definitive.

**② Causation — CONFIRMED by isolation.** Reverted *only* `apps/rider-app/package.json` + `pnpm-lock.yaml` to `origin/main`, reinstalled (expo-font symlink disappeared from `apps/rider-app/node_modules`; `require.resolve('expo-font')` → MODULE_NOT_FOUND). Raw `node <expo cli> config` then threw:
`PluginError: Failed to resolve plugin for module "expo-font" relative to "/home/user/sera/apps/rider-app"` at `@expo/config-plugins/.../plugin-resolver.js:96` → exit 1.
Restored to HEAD + reinstalled: same raw invocation exits 0 and resolves all 5 Archivo weights. Because the *only* thing that changed between fail and pass was package.json + lockfile, the named cause is THE cause.

**③ Fix is a direct-dep addition, NOT an async-loading switch — CONFIRMED (RULING ②).** `app.json` still carries the `["expo-font", {fonts:[…5 Archivo weights…]}]` config plugin; `App.tsx` has zero async-font symbols (`grep useFonts|loadAsync|Font.|SplashScreen|fontsLoaded|onLayoutRootView` → none). Native embedding intact.

**④ Guard test genuinely bites — CONFIRMED (3 planted probes, each reverted).**
- Probe A — emptied `Archivo-Bold.ttf` (0 bytes): DROP MODE 3 FAILS `font asset empty: ./assets/fonts/Archivo-Bold.ttf: expected 0 to be greater than 1000`.
- Probe B — removed `expo-font` from package.json: DROP MODE 1 FAILS `expo-font must be a DIRECT dep … expected undefined to be defined`.
- Probe C — removed the config plugin from app.json (the async-switch shape): DROP MODE 2 FAILS.
Baseline 3/3 green before probes, 11/11 green (guard + allowlist) after all restores. The guard does NOT stay green with a font, the dep, or the plugin removed.

**⑤ No forbidden touch — CONFIRMED.** `git diff --name-only origin/main...HEAD` = exactly `apps/rider-app/package.json`, `apps/rider-app/test/grand-teint.test.ts` (allowlist bumped 2→3 deps), `apps/rider-app/test/preview-font-embedding.test.ts` (new guard), `pnpm-lock.yaml` (single expo-font importer entry). No journey/custody/money/App source, no contracts, and **no workflow change** — the failing step was not disabled. Lockfile delta is +3 lines (the expo-font resolution only).

VERDICT: PASS
BLOCKING: none
