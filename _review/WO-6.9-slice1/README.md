# WO-6.9 slice 1 — the canon re-pin 0.9.0 → 0.9.4 (pin `04af4b5`)

Branch `e6/wo-6.9` off sera main (`b082c1c`). The foundational first slice of the WO-6.9 split. **Do NOT merge** — founder review. Reviewable standalone; does not wait for 6.9-b.

## What and why
WO-6.9 quotes v0.9.4 canon text (`return` not `return_required`; ops home `platform` not `platform-ops`), so the re-pin is a **derivation prerequisite**, not a side-task — D4/D5 cannot be derived correctly on the 0.9.0 pin. This slice bumps the `platform-contracts` git ref across the workspace and relocks; it touches **no app/console/custody source**.

## Evidence
- `repin.diff` — the full diff (main..e6/wo-6.9): 13 files = workspace overrides + 7 package.json specifiers + lockfile + the drift-check version in run-gates.sh + 2 byte-synced canon docs + JOURNAL.
- `logs/branch-log.txt` — the branch commit log (carried BY THAT NAME).
- `cold-gates.log` — **CLEAN HOME** proof: fresh clone, `pnpm install --frozen-lockfile` succeeds (the regenerated lockfile installs from scratch — the exact operation the URL-form law guards), cold ui-tokens `0.9.4`, 0-cached build, `run-gates.sh` ALL GATES GREEN exit 0.
- `verifier-verdict.md` — fresh-context verifier: **PASS, BLOCKING none** (all five packages 0.9.4; lockfile 0 old-sha / 51 new-sha / 0 ssh; both docs byte-identical to canon@04af4b5 with sha256 quoted; drift-check 0.9.4; cold install clean; scope = 13 dep/doc/version files, no app source).

## Assertions met
- Installed `@platform/ui-tokens` prints **0.9.4** (the WO's explicit check) — all five @platform packages 0.9.4.
- Lockfile re-pinned, **0 ssh-form URLs** (the URL-form law holds through a lockfile regeneration).
- 2 tracked canon docs synced byte-identical; **drift-check green at 0.9.4** (11 docs match).
- Contract api-surface snapshot unchanged 0.9.0→0.9.4 (no shape break); ui-tokens change additive.
- Warm + cold `run-gates.sh` ALL GREEN.

## FORBIDDEN respected
No app/console/custody/journey/money source touched — pure dependency + canon-doc + drift-version slice.
