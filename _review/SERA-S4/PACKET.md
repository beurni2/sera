# SERA-S4 · real connectivity — REVIEW PACKET

🟠 slice · branch `e6/sera-s4-connectivity` off the merged S2 head `722658b` (canon v0.9.8)
feat HEAD `61578df` · **DO NOT MERGE — holds for the founder's ruling.**
**Closes the rider offline-durability arc (S1 → S3 → S2 → S4).**

## The gap this closes

Two disjoint notions of connectivity shipped: the compile-time `custody-flow.CONNECTIVITY = 'online'` constant (consumed by `declineCourse`/`raiseSos` for the queued-vs-sent decision) and a separate runtime `offline` toggle (drove only the banner + seal/evidence UI). The App threaded the **constant** into the store — so an **offline decline/SOS was treated as ONLINE** (sent, not queued). The offline toggle never reached the store's durability logic. RED-proof (`red-proof.log`) captured this against the pre-fix code.

## The change (5 parts, exactly as ordered)

| Part | Where |
|---|---|
| 1 · Real connectivity behind a **port** | `src/offline/connectivity.ts` (`Connectivity` type + `ConnectivityPort` + `createManualConnectivity` for demo/tests); `src/offline/expoConnectivity.ts` (device adapter — `isInternetReachable ?? isConnected`, seed + listen). `expo-network ~8.0.8` registered in the grand-teint dep-allowlist. |
| 2 · The **CONNECTIVITY constant dies** | deleted from `custody-flow.ts`; `declineCourse`/`raiseSos` take the real `Connectivity` type (no constant default); App threads the port signal. |
| 3 · **Truthful backlog banner** | `src/offline/backlog.ts` `pendingCount` = the REAL count of pending durable writes; App renders « Hors ligne : N actions en attente » (singular/plural; N=0 → the reassuring base banner). |
| 4 · **Reconnect flush hook** | `drainOnReconnect` flushes the outbox on offline→online; the banner clears with the backlog; a `collision-refused` write stays counted (surfaced, never dropped). |
| 5 · The **S3-named `.catch`** | both background persists (`appendSosRaise` in `fireSos`, `appendEvidence`) route a rejection to the `persistFailed` banner surface; success refreshes the real count. |

## Evidence

- **Rider-app 92/92** (new: `connectivity` 4/4 · `connectivity-truthful` 2/2 — the red-proof, now green). **Typecheck clean.**
- **`run-gates.sh` ALL GREEN** — every positive passed, every negative fired exit 1. Includes RN-safe shell (App imports clean; expo-network isolated to the adapter), grand-teint dep-allowlist (expo-network ~8.0.8), mint-path-entropy, copy-lint (`OK: 149 entries, 0 violations`), offline-never-final + offline-flush-binding (pos/neg), drift-check 0.9.8, Playwright 22/22. Per-gate logs under `gates/`.
- **COLD PROOF both lines** (`cold-proof.log`, cold HEAD `61578df`): **COLD** — fresh HOME, frozen install 0, cold `@platform/contracts` 0.9.8, **cold `expo-network` 8.0.8 resolves**, cold typecheck 0, cold **92/92**; **AUTH** — 0 ssh-form URLs.
- **Fresh-context verifier: SCOPE MET, no FAIL** (`verifier-verdict.md`, verbatim; A–G, 26 calls; ran its own 92/92 + typecheck + copy-lint). Traced the constant dead + the real signal threaded into both `declineCourse` and `raiseSos`; the backlog N real; the reconnect drain keeping `collision-refused` counted; both persists' `.catch` routing with no swallow. Fixtures proved non-vacuous by mutation.

## Post-verifier fixes (transparent, re-green'd; for CTO ratification)

The verifier's three carry-forwards, none a FAIL — two fixed, one accepted:
1. **[FIXED] `offline.persist_failed` over-promised auto-retry** (safety-adjacent). A *persist failure* means the write never entered the outbox, so `drainOnReconnect` (which flushes only persisted entries) has nothing to resend — « Il repartira à la reconnexion » was a promise the code cannot keep. Reworded to the honest **« Un envoi n'a pas pu être enregistré. À refaire. »** (states what happened + the true next step; no false auto-resend). copy-lint still 149/0.
2. **[FIXED] `refreshBacklog` had no rejection handler** (a swallowed *recount*, not a swallowed persist). Now `pendingCount(...).then(setBacklog, () => setPersistFailed(true))` — a durable-read failure is itself a durability-health signal, surfaced, never an unhandled rejection.
3. **[ACCEPTED] optimistic `'online'` cold-start default** before `getNetworkStateAsync` seeds (sub-second). Matches prior behavior (old `offline` started `false`); async detection has no synchronous seed; the seed race is guarded by the adapter's `active` flag. Documented, not changed.

Post-fix: rider-app **92/92**, typecheck clean, copy-lint **149/0**, `run-gates.sh` re-run **ALL GREEN**.

## Design boundaries (honest)

- The **sandbox reconnect sender** returns `'applied'` (models the server accepting each queued write on reconnect, like `SANDBOX_EVIDENCE_ACK`) so the backlog drains in the walkable demo; the **live sender posts to the service at assembly**. The rider never asserts it.
- The **manual port** backs the demo toggle AND the tests; the **expo-network adapter** feeds the same port on device (real network changes + the demo override both flow through one port). The adapter's native surface is untested under vitest (like `documentStore`/`ensureCsprng`) — the port + backlog + drain are tested with the manual fake.
- S4 keeps the **durable outbox** (backlog/flush) parallel to the **in-memory custody walk** (which advances on its sandbox signals) — integrating the flush outcome with the custody step is an assembly-time concern, out of this slice.

## FORBIDDEN respected

No franc anywhere · custody ledger + `acknowledgeSos` untouched · `services/`+`packages/` unchanged · expo-network isolated to the device adapter (RN-safe shell green) · no new `@platform` barrel imports.

## The arc is complete

S1 (outbox primitive) → S3 (SOS on the outbox) → S2 (evidence finality server-ack-gated) → **S4 (real connectivity + truthful backlog + reconnect flush + `.catch`)**. After this: the SOS drill is pure calendar.
