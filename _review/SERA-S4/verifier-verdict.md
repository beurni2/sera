# FRESH-CONTEXT VERIFIER — SERA-S4 (rider-app connectivity/offline durability)

_Verbatim output of the fresh-context verifier subagent (no memory of the build
conversation). Given only: the offline-first law + SE-I06, the five-part scope, the
diff, and the archived red-proof. Ran its own `pnpm test` (92/92), `pnpm typecheck`
(clean), `copy-lint` (149 entries, 0 violations)._

**Overall verdict: SCOPE MET.** Two of its three carry-forward notes were then fixed
post-verifier (see the packet); the third is accepted (documented).

---

Evidence run this session: `pnpm test` → 92 passed (16 files), `pnpm typecheck` → clean, `pnpm exec copy-lint apps/rider-app/i18n/catalog.json` → `OK: 149 entries, 0 violations`.

### A. CONNECTIVITY constant dead + real port threaded — **PASS**
- The constant is truly gone from `src/custody-flow.ts` (old `export const CONNECTIVITY = 'online'` deleted; a repo-wide grep finds `CONNECTIVITY` only in comments and test regexes — **zero live-code reads**).
- The App threads the REAL port signal into both store paths: `fireSos` passes `connectivity,` (App.tsx:365), and both decline sites pass it — `declineCourse(world, active.id, connectivity)` (App.tsx:589 and :610). The signal's sole source is the port: `net.subscribe(setConnectivity)` + `bindDeviceConnectivity(net)` (App.tsx:240-241). `declineCourse`/`raiseSos` now take a required `connectivity: Connectivity` (no constant default) — store.ts:207, :408.
- No live path can treat an offline decline/SOS as online. Behaviorally confirmed by demo-store.test.ts:176 (offline → `decline_pending`, `closed:false`, confers nothing) vs :193 (online → `declined, closed`).
- Minor observation (not a FAIL): initial `useState<Connectivity>('online')` (App.tsx:209) is optimistic; on a genuinely-offline device cold-start there is a sub-second window before `getNetworkStateAsync` seeds. Matches prior behavior (old `offline` started `false`); the seed race is guarded by the `active` flag in expoConnectivity.ts.

### B. Backlog N is the REAL pending count — **PASS**
- `pendingCount(store) = (await restore(store)).length` (backlog.ts:16-18); the banner reads it via `refreshBacklog` (App.tsx:235-237). Every persisted entry is `status:'pending'` (append/enqueue only ever write `'pending'`; flush drops applied/replay and keeps refused as pending — nothing ever persists `'settled'`), so `length` == true pending count. Not guessed, not stale.
- N=0 is honest: `backlog === 0 ? t('offline.banner') : …` (App.tsx:~449) — never renders "0 actions".
- Singular/plural handled: `backlog === 1 ? suffix_one : suffix_many` (App.tsx:~452).

### C. Reconnect flush + collision semantics — **PASS**
- offline→online effect runs `drainOnReconnect(outboxStore, sender)` then `setBacklog(remaining)` and clears `persistFailed` only when `remaining === 0` (App.tsx:249-...). offline branch re-counts via `refreshBacklog`.
- A `collision-refused` write **stays counted**: `flush` pushes refused entries to `remaining` and re-persists them (outbox.ts:109-110); `drainOnReconnect` returns `pendingCount` over that (backlog.ts). connectivity.test.ts asserts `remaining === 1` for a refused drain — matches flush() semantics, no silent drop.
- "queued = pending, never done" preserved: only the authority's ack drops a write (applied/idempotentReplay); evidence finality stays separately gated by `stepAfterEvidenceAck` (custody-flow.ts:82-84). Nothing marks a write done on connectivity alone.
- Observation (not a FAIL): the running App's `sandboxReconnectSender` always returns `'applied'` (App.tsx:234), so a real `collision-refused` never surfaces in the online UI (banner is offline-only; `persistFailed` is for persist failures). UI surfacing of collisions is out of S4 scope; the outbox-level truthfulness (the N) is intact.

### D. `.catch` hardening on both background persists — **PASS**
- SOS: `void appendSosRaise(...).then(refreshBacklog, () => setPersistFailed(true))` (App.tsx:372-378).
- Evidence: `void appendEvidence(...).then(refreshBacklog, () => setPersistFailed(true))` (App.tsx:700-703).
- Both rejections route to the `persistFailed` surface (`PendingNotice` at App.tsx:455) — no un-caught `void append…` remains (grep confirms only these two are the persist calls, both handled).
- Instant UX shows first: `raiseSos` + `setWorld` before the append (App.tsx:361-368); `captureEvidence` via `walk()` before `appendEvidence` (App.tsx:~698). Persist is genuinely background.
- Minor CONCERN: `refreshBacklog` does `void pendingCount(outboxStore).then(setBacklog)` (App.tsx:236) with **no rejection handler** — a re-count failure would be an unhandled rejection (a swallowed *recount*, not a swallowed *persist*). Low severity; the persist failure itself is correctly surfaced. _[FIXED post-verifier — now `.then(setBacklog, () => setPersistFailed(true))`.]_

### E. Fixtures are non-vacuous — **PASS**
Mentally mutated each gate:
- connectivity.test.ts: notify-on-no-change → `seen` gains an extra `'offline'` → **fails**; `pendingCount` faked to 0 → `toBe(2)` **fails**; flush stops dropping applied → `remaining` 2 → **fails**; drain-returns-0-always → the collision test's `toBe(1)` **fails**. The two drain tests pin it from both sides.
- connectivity-truthful.test.ts: restoring the constant → `not.toMatch(/export const CONNECTIVITY/)` **fails**; reverting App to thread the constant → `not.toMatch(/\bCONNECTIVITY\b/)` **fails**. Source-text (grep-style) assertions — brittle by nature, but they encode the RED proof and are backed behaviorally by demo-store.test.ts's offline/online decline arms.

### F. expo-network isolated + registered in dep gate — **PASS**
- `expo-network` is imported **only** in `src/offline/expoConnectivity.ts:1`. App.tsx imports `bindDeviceConnectivity` from `./src/offline/expoConnectivity` (App.tsx:22) — never expo-network directly. Under vitest the tests import `connectivity.ts`/`backlog.ts` only, so the native module never loads (clean test run confirms).
- Shell barrel gate holds: shell.test.ts:62-74 bans runtime imports of `@platform/(contracts|i18n)|@sera/commerce-core` in App.tsx/i18n.ts; the diff adds only local `./src/offline/*` imports plus a type-only `FlushOutcome` — **no new barrel import**.
- Dep-allowlist gate updated: grand-teint.test.ts:114 asserts `expo-network` == `~8.0.8` (SDK-54 bundled), and :123 pins the full added set to include it. The gate would fail if the dep weren't registered.

### G. French Voice on the 4 new strings — **PASS, with one copy-honesty CONCERN**
- All four (`offline.backlog_prefix` "Hors ligne :", `backlog_suffix_one` "action en attente", `backlog_suffix_many` "actions en attente", `offline.persist_failed`) are `register:"neutral"`, `screenClass:"status"`, calm, plain, 6th-grade, no administrative French / no « séquestre ». copy-lint passes 0 violations. Assembled banner uses only `t()` pieces + the number — no inline French (shell.test.ts inline-French guard passes).
- **CONCERN (medium):** `offline.persist_failed` promised automatic retry — "Il repartira à la reconnexion." But a *persist failure* means the write never entered the durable outbox, so `drainOnReconnect` (which only flushes what is persisted) has nothing to resend for that write. The failure is honestly *surfaced* (never vanishes — item D holds), but the recovery promise may not actually hold. Touches safety-adjacent copy (an SOS raise that failed to persist). Recommend wording that surfaces "à renvoyer" without promising an automatic reconnect resend, or add a genuine re-attempt of the failed append. Not a scope blocker. _[FIXED post-verifier — reworded to « Un envoi n'a pas pu être enregistré. À refaire. » (honest; no false auto-resend promise).]_

---

## OVERALL: **SCOPE MET**

All five parts land and are green (92 tests, typecheck, copy-lint): the port with an expo-network device adapter registered in the dep gate; the `CONNECTIVITY` constant dead with the real signal threaded into both `declineCourse` and `raiseSos`; a truthful backlog reading the real durable pending count with honest N=0 and singular/plural; a reconnect drain that clears the banner and keeps collision-refused counted; and the `.catch` hardening on both background persists routing to the banner surface with no swallowed persist. No surviving hardcoded `'online'`, no fake/stale backlog number, no swallowed persist failure, no vacuous test.

Carry-forward for the founder/CTO, none a FAIL: (1) the `persist_failed` copy overpromises auto-retry for the append-failure case — the medium concern above **[FIXED]**; (2) `refreshBacklog`'s inner `pendingCount` has no rejection handler — swallowed recount, not persist **[FIXED]**; (3) optimistic `'online'` cold-start default before the device seed resolves **[ACCEPTED — matches prior behavior, seed race guarded by the `active` flag; async detection has no synchronous seed]**.
