# FRESH-CONTEXT VERIFIER BRIEF — WO-6.2 (the expo-preview publish was RED)

You are a fresh-context verifier. No memory of the build. Judge only the code on
branch `e6/wo-6.2` (2 commits ahead of `origin/main`). Try to break each claim.
Report findings most-severe first; end with `VERDICT: PASS`/`FAIL` + `BLOCKING:`.

## The situation
The `expo-preview` GitHub workflow (`.github/workflows/expo-preview.yml`) publishes
the rider app to Expo's preview channel on push to main. Runs #21 (merge `6644310`)
and #22 (`4e1b278`) FAILED; run #20 (`b705251`, the commit before the WO-6.1 merge)
SUCCEEDED. The rider's Grand Teint face is on main but not on the founder's phone.

## The claimed cause + fix
WO-6.1 added the `expo-font` config plugin to `apps/rider-app/app.json`, but
`expo-font` was only a TRANSITIVE dependency. `eas-cli init` spawns expo's cli RAW
(no pnpm env), so `@expo/config-plugins` resolves the plugin with plain node
resolution from `apps/rider-app` — where a transitive dep is unreachable under
pnpm's isolated node_modules → `PluginError: Failed to resolve plugin for module
"expo-font"` → exit 1. Fix: declare `expo-font` (~14.0.12) as a DIRECT dep.

## VERIFIER MANDATE (do each by your own hands)
1. **Re-read the failing log INDEPENDENTLY.** Use the GitHub MCP tools
   (`mcp__github__get_job_logs` with owner `beurni2`, repo `sera`, run_id
   `29209620504`, failed_only true, return_content true; or job_id `86695010823`).
   Confirm the failing step is `eas init` → `expo config --json` exit 1, and that
   run #20 on `b705251` was green (`actions_list` list_workflow_runs on
   `expo-preview.yml`). Quote what you find.
2. **Confirm the named cause is THE cause, not a coincidence.** In a cold context
   (or the working tree at `origin/main`, i.e. BEFORE the fix — `git stash` is not
   needed; check out the parent), reproduce the RAW invocation:
   `cd apps/rider-app && node <node_modules/.pnpm/expo@54.../expo/bin/cli> config`
   and confirm it throws `PluginError ... "expo-font"`. Then on `e6/wo-6.2` HEAD
   (WITH the fix) confirm the same raw invocation exits 0 and the resolved config
   references the 5 Archivo fonts. Confirm the fix is ONLY a direct-dep addition —
   NOT a switch to async font loading (RULING ②: `app.json` still has the
   expo-font config plugin; `App.tsx` has no `useFonts`/`loadAsync`/render gate).
3. **Plant a font-asset removal and prove the guard catches it.** Delete or empty
   one `apps/rider-app/assets/fonts/Archivo-*.ttf`, run
   `pnpm --filter @sera/rider-app exec vitest run test/preview-font-embedding.test.ts`,
   confirm it FAILS naming the missing asset; restore. Also try removing `expo-font`
   from `apps/rider-app/package.json` and confirm the guard fails ("must be a DIRECT dep").
4. **Confirm no forbidden touch:** no journey/custody/money semantics changed
   (`git diff origin/main...HEAD` should be: app package.json + lockfile + the new
   guard test + the dependency-allowlist test update — nothing else); the fix does
   not merely disable the failing workflow step.

## Commands
GitHub MCP actions tools · `git diff origin/main...HEAD` · `git log` · `cmp` ·
`node <expo cli> config` · `pnpm --filter @sera/rider-app test` · `bash scripts/run-gates.sh`.
Do NOT fix anything; revert any probe you plant.
