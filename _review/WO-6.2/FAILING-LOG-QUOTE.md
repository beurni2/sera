# The failing expo-preview run — verbatim

Runs #21 (merge 6644310) and #22 (4e1b278) FAILED; run #20 (b705251, the commit
before the WO-6.1 merge) SUCCEEDED — a clean before/after, WO-6.1 broke the publish.

## What CI surfaced (job 86695010823, run 29209620504), verbatim:
```
.../node_modules/expo/bin/cli config --json exited with non-zero code: 1
    Error: project:init command failed.
##[error]Process completed with exit code 1.
```
eas-cli only reports the exit code; expo config's own stderr is captured, so the
real reason is not in the GitHub log.

## The REAL error, reproduced in a cache-isolated cold clone (raw invocation, as eas does):
`cd apps/rider-app && node <.pnpm/expo@54.../expo/bin/cli> config` →
```
PluginError: Failed to resolve plugin for module "expo-font" relative to
  ".../apps/rider-app". Do you have node modules installed?
    at resolvePluginForModule (@expo/config-plugins/build/utils/plugin-resolver.js:96:9)
    at resolveConfigPluginFunctionWithInfo (.../plugin-resolver.js:145:7)
    at withConfigPlugins (@expo/config/build/plugins/withConfigPlugins.js:35:47)
    at getConfig (@expo/config/build/Config.js:293:10)
```

## Why local gates were green and `pnpm exec expo config` masked it
`pnpm exec` injects resolution paths, so the transitive expo-font resolves.
eas-cli spawns expo's cli RAW (no pnpm env) → @expo/config-plugins does plain
node resolution from apps/rider-app → a transitive dep is unreachable under
pnpm's isolated node_modules → PluginError → exit 1. typecheck/vitest never run
`expo config`, so nothing local exercised the plugin-resolution path.
