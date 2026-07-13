# WO-6.9-b review packet — D1 unfunded-UNRENDERABLE + the suggestion STOP (🟠 AMBER)

Branch `e6/wo-6.9-b` off the merged slice-1 head (`e4aaef0`, canon v0.9.4). **Do NOT merge** — founder review. 6.9-c branches from b's head when this packet ships.

## What shipped
**D1 — an unfunded order is UNRENDERABLE in the console, not filtered.** `apps/dispatch-console/test/ready-queue-admission.test.ts`, per SE-I02 / PART 8 §1 (« not at the bottom of the list — it is not in the room »):
- **Behavioural:** the console's real `ReadyQueue` intake refuses an unfunded order (`onTaskReady → {admitted:false, reason:'not_funded_for_mode'}`); it never enters `queuedTasks()`, so only the funded task is in the room.
- **Structural:** `main.ts` (the render) carries **zero** funding/funded/admitted/`.filter(` logic — the only funding refs in the console are mock SETUP in `sandbox-world.ts`. The console *cannot* hide an admitted task; the funded-gate is entirely upstream in `ReadyQueue`. There is nothing for a render filter to do.
- **Non-vacuous:** `confirmFunding('order-B')` makes it admitted → the behavioural assertion FAILS; reverted → 2/2 green.

**ack/decline→requeue (SE2.3) — verified present, not rebuilt:** service `LeasedDispatch.acknowledge`/`.decline` + `expireDue`; the console drives `expireDue` on its sweep and renders the honest requeued state (WO-4.3).

## STOP — D2 deterministic suggestion + coupled override-with-reason
Per "QUOTED from PART 8 §2 or STOP." PART 8 §2 verbatim: « The dispatcher assigns; a rider can never self-assign. The lease is an atomic Durable Object … **Deterministic suggestion offered; human decides.** » — **no tie-break to quote.** Three fatal gaps: (1) SE2.2 names factors « Availability/distance/capacity/stale-location » but no precedence/tie-break; (2) "distance" is undefined and cannot be a proximity calc under « no route-optimization/ETA model »; (3) `RiderRecord` has no zone/location/capacity field to rank on. Building it would mean inventing a ranking (Ten-Laws #5 / the founder's guard). **Deferred** pending a founder one-sentence tie-break ruling + a rider-model extension. Not invented. Override-with-reason is coupled (overrides the suggested candidate) and STOPs with it.

## Cold proof — explicit fresh HOME (the new standard) + a finding
`cold-gates.log` runs with `export HOME=<fresh empty dir>` (the 696 MB pnpm store + all caches isolated) — but **a literally empty HOME breaks sera's cold install**: the `@platform/*` are private **git dependencies**, and a fresh HOME discards the git url-rewrite that authenticates the fetch →
`git fetch … 04af4b5… — fatal: could not read Username for 'https://github.com'`.
Real CI injects that same rewrite (a token/config, **not a cache**) before installing. So the faithful proof isolates the **cache** (fresh HOME → empty store → true cold re-fetch) and re-injects the **auth** exactly as CI does — both steps shown in the artifact. Result: frozen install exit 0 (~33 s, genuinely re-fetched), cold ui-tokens `0.9.4`, 0-cached build, **ALL GATES GREEN**. **Flagged for the founder:** the fresh-HOME standard needs the auth rewrite re-injected for sera's git-dep topology; a literal empty HOME tests an auth-less git fetch that CI never performs.

## Evidence
- `WO-6.9-b.diff` — the diff (exactly one test file + JOURNAL.md).
- `logs/branch-log.txt` — branch commit log (by name).
- `cold-gates.log` — fresh-HOME cold proof (isolation shown, not implied) + auth re-injection + ALL GREEN.
- `verifier-verdict.md` — fresh-context verifier verdict.

## FORBIDDEN respected
No ledger write · no refund/payout lever · no route/ETA/ranking model (the suggestion was STOPPED precisely to avoid inventing one) · no franc in sera · journey/custody untouched. Diff = one test + JOURNAL only.
