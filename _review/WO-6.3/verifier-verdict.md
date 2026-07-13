# WO-6.3 FRESH-CONTEXT VERIFIER VERDICT — verbatim

All 10 probes executed against the clean `e6/wo-6.3` tree. Findings below, most-severe first.

---

## VERIFIER FINDINGS — WO-6.3 (the SOS drill)

### The critical probe (offline SOS can never show an acknowledgment) — HELD
**Store side** (`apps/rider-app/src/demo/store.ts:372-446`): I drove it by hand. `raiseSos({connectivity:'offline'})` → `status:'queued'`, `events:[]`, `acknowledgedAt/By:null`. `acknowledgeSos(world,'dispatcher')` **threw**; `acknowledgeSos(world,'founder')` **threw**; the incident stayed `'queued'` with no ack fields leaked. The guard at `store.ts:434` only admits `'raised'|'escalated'`.
**UI side** (`apps/rider-app/App.tsx` + `src/ui/kit.tsx`): two independent barriers.
1. The ack control `SosSandboxAck` is rendered **only** in the `'raised'` (kit.tsx:903-909) and `'escalated'` (kit.tsx:910-918) branches — the `'queued'` branch (kit.tsx:892-902) renders title + hint + close only. No ack affordance exists on a queued incident.
2. Even if reached, `sosSandboxAck` (App.tsx:324-329) calls `acknowledgeSos(...)` **before** `setSos('acknowledged')`, so the throw prevents the flip. `sos` is only ever set to `'raised'/'escalated'/'queued'` from the store's real status (App.tsx:310-314); no desync path sets `'raised'` while the store is `'queued'`.
**Console side** (`apps/dispatch-console/src/main.ts:397-403`, `sandbox-incident.ts:41-51`): `canAcknowledge(queued)=false` → button `disabled`, and the click listener is only attached `if (!ack.disabled)`. e2e confirms the disabled lever. A queued incident cannot show « On vous a vu » / « Vu. Réponse en cours. » anywhere. **IMPOSSIBLE confirmed.**

### Probe 9 — the faked-ack timer is gone (this was the prior lie)
`git diff main...HEAD` shows the removed code contained exactly `sosTimers.current.push(setTimeout(() => setSos('ack'), 1600))` and a `setSos('enroute')` timer. The new tree's **only** `setTimeout` is `holdTimer.current = setTimeout(fireSos, 650)` (App.tsx:318) — the deliberate hold-to-fire that builds the real incident. No post-fire timer moves or clears safety state; the sheet stays raised/escalated until `acknowledgeSos` flips it and acknowledged until the rider clears it. HELD.

### Probes 2,3,4,5,7,8,10 — all held
- **Loc law (2):** `coarseLocation = onShift ? landmark : null` (store.ts:391); verified null off-shift, non-null on-shift, in **both** connectivity arms. Never a live GPS fix — a fixed « (démo) » landmark.
- **Full drill (3):** online in-hours → raised/dispatcher; out-of-hours → escalated/founder → founder ack; offline → queued(throws) → `deliverQueuedSos` → raised → ack. Double-deliver and double-ack both throw. Tests `sos-drill.test.ts` (a)-(e) assert real values, not nothing.
- **Custody (4/10):** `raiseSos` reads/writes no course; courses byte-identical (`=== seedCourses()`) after raise. Console renders `console.sos_custody` = « Le colis reste avec le livreur. La garde ne bouge pas. » The independent `custody-ledger` gate enforces one custodian (negative fixture rejects a second).
- **Events (5):** only `safety.sos_created.v1`, `safety.sos_acknowledged.v1`, `incident.opened.v1` in the diff; they mirror pinned `@platform/contracts/dist/events.js:90-92` exactly. No invented name (`sos_*` tokens are i18n key suffixes; `incident.status/.events` are property accesses).
- **No franc + no spine change (7):** 0 franc hits across all 8 named files. `git diff main...HEAD -- journey.ts custody-flow.ts` is **empty** — spine byte-unchanged; safety is additive.
- **Transport PENDING (8):** `ESCALATION_TRANSPORT = {status:'pending', channel:null}` (safety.ts:53); escalated UI shows `sos.transport_pending` = « Canal d'alerte au responsable : en cours de branchement (SMS ou appel). » — named pending, no faked send/ack.

### Test + gate runs
- `pnpm --filter @sera/rider-app test` → **65 passed** (incl. 7 `sos-drill`).
- `pnpm --filter @sera/dispatch-console test` → **5 passed**; e2e (chromium-1194) → **16 passed** (incl. the 2 WO-6.3 SOS specs + 3 SOS gallery states).
- `bash scripts/run-gates.sh` → **ALL GATES GREEN** (typecheck, all workspace tests, money-reconciliation, custody-ledger/actor-separation, no-street-address, copy-lint, contracts drift-check — every positive passed and every negative fixture failed as required).

### Minor / NIT (non-blocking)
- **NIT** — `acknowledgeSos(world, by)` (store.ts:432) and console `acknowledgeSos(incident, by)` (sandbox-incident.ts:41) don't enforce `by === incident.responder`; a `'dispatcher'` can be *credited* with acking an `'escalated'` (founder) incident. Not reachable via UI — the sole call sites pass `world.incident.responder` (App.tsx:326) / `inc.responder` (main.ts:400). The ack is still real and only lands on a live incident. Cosmetic/robustness only.
- **NIT** — the escalated (founder-routed) state shows preview label `sos.preview_ack` = « (aperçu) réponse du dispatch » though the responder is the founder; the store still credits `founder`. Copy imprecision on a clearly-marked sandbox stand-in, not a safety lie.
- **NIT** — App.tsx:313 `else if (status === 'acknowledged') setSos('acknowledged')` inside `fireSos` is dead (raiseSos never returns `'acknowledged'`); defensive, harmless.

---

VERDICT: PASS

BLOCKING: none

---

## CTO disposition of the three NITs
- **NIT (responder-match on `acknowledgeSos`):** JOURNALED for the founder — enforcing `by === incident.responder` would harden "the RIGHT person answered," but it touches the dispatch-hours / staffing model, which is an OPEN Decision (⏳ Sera-Build-Spec:185 "Dispatch hours/after-hours/SLA"). I do not unilaterally close a ⏳-adjacent policy (could a dispatcher legitimately cover an out-of-hours escalation on handoff?). Not reachable via the UI today. Founder decision named.
- **NIT (escalated preview label « réponse du dispatch »):** FIXED on-branch — added `sos.preview_ack_escalated` = « (aperçu) réponse du responsable »; the escalated (out-of-hours) state now credits the responsable/founder, not the dispatch. French-Voice accuracy on a safety screen. copy-lint 143/0, typecheck 0, rider 65/65 re-confirmed.
- **NIT (App.tsx:313 dead defensive branch):** left as-is — harmless (raiseSos never returns `'acknowledged'`); noted rather than tidied.
