# WO-6.4 item 1 — REPORT FIRST: expo-preview status on merge `27d2bdb`

**Verdict: GREEN.** The font binaries changed in the WO-6.3 merge; the publish that ships them ran and succeeded. Grounded in the live GitHub Actions **job** detail, not the JOURNAL.

## Workflow run
- Workflow `expo-preview`, run **#26**, id `29222023699`, head_sha `27d2bdbd3503…` (= the WO-6.3 merge `27d2bdb`).
- `status: completed`, `conclusion: success`. Created `2026-07-13T03:35:40Z`.

## Job detail (the decisive evidence — a green workflow can hide a skipped publish)
Job `publish-preview` (id `86728923842`): `status: completed`, `conclusion: success`, 03:35:41→03:37:40Z.
- Step 2 «Check EXPO_TOKEN presence (skip gracefully when absent)» → success (token present → publish NOT skipped).
- Step 8 **«Publish rider-app preview update (EAS, non-interactive)»** → **success**, 03:35:57→03:37:37Z (~100 s). This is the step that packages and publishes the rewritten Archivo TTFs.

## Conclusion
The eas publish step that ships the rewritten font name-tables executed and passed. **The rewritten font name-tables did not break the publish.** No RED, no failing log to diagnose.
