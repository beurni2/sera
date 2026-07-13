# FRESH-CONTEXT VERIFIER BRIEF — WO-6.3 (the SOS drill: making R14 a safety system)

You are a fresh-context verifier. No memory of the build. Judge only the code on
branch `e6/wo-6.3`. This is a SAFETY + CUSTODY path — a lie is the worst bug.
Report findings most-severe first; end with `VERDICT: PASS`/`FAIL` + `BLOCKING:`.

## The canon this must satisfy (verbatim)
- SE8 (Sera-Build-Spec:149): "SOS visible from every rider flow; ack within SLA; secure/quarantine custody; live drill before pilot."
- Location law (:178): "location only on shift/task."
- Custody (:121/:178): "package never unowned … preserve exactly one current custodian."
- Offline (Ten Laws #7): "Queued = pending, never done." A safety feature that lies is worse than none.
- Canonical events (pinned EVENT_NAMES): `safety.sos_created.v1`, `safety.sos_acknowledged.v1`, `incident.opened.v1` — the ONLY three allowed; inventing one is a FAIL.
- Founder ruling: in-hours → dispatcher acks; out-of-hours → escalate to founder's phone (transport PENDING, never faked).

## PROBES — try hard to break each, then report
1. **Make an offline SOS display an acknowledgment (must be IMPOSSIBLE).** Read `apps/rider-app/src/demo/store.ts` `raiseSos`/`acknowledgeSos`/`deliverQueuedSos`. Call `raiseSos` with `connectivity:'offline'` → status must be `'queued'`. Then `acknowledgeSos(world,'dispatcher')` MUST throw. Search App.tsx + kit.tsx for ANY path that sets the sheet to the acknowledged state without the store's `acknowledgeSos` (a timer, a direct setState, an optimistic flip). If a queued incident can ever show « On vous a vu », that is a BLOCKING FAIL.
2. **Raise SOS OFF-SHIFT and verify NO location is attached.** `raiseSos({onShift:false,...})` → `coarseLocation` MUST be null. `raiseSos({onShift:true,...})` → non-null. Any location captured off-shift is a FAIL (location law).
3. **Run the drill end to end by your own hands.** `raiseSos` online in-hours → status 'raised', events include `safety.sos_created.v1` + `incident.opened.v1` → `acknowledgeSos('dispatcher')` → 'acknowledged' + `safety.sos_acknowledged.v1`. Then out-of-hours → 'escalated', responder 'founder' → ack by 'founder'. Then offline → queued → deliverQueuedSos → raised → ack. Confirm the tests assert these, not nothing.
4. **Custody survives the incident.** Raising SOS must not change any course's custody `step` or remove it. Verify `raiseSos` never reads/writes a course; verify the custody-preserved test seeds a mid-custody course and asserts its step byte-unchanged.
5. **No invented event name.** grep the diff for event strings; every one must be among the 3 canonical names. No new event name, anywhere.
6. **The rider cannot self-ack.** The acknowledged state must be reachable only via `acknowledgeSos` (the dispatcher/founder's function), driven by a clearly-labelled sandbox stand-in — never presented as the rider's own action, and absent when offline.
7. **No franc anywhere** in safety.ts, store.ts, App.tsx, kit.tsx, both catalogs, console main.ts. **No spine change:** `git diff main...HEAD -- journey.ts custody-flow.ts` — custody SEMANTICS unchanged (safety is additive).
8. **The transport is named PENDING, not faked.** The out-of-hours escalation must state the transport is a pending founder decision and NEVER show an ack that didn't happen.
9. **Persistent signal until ack (Building-Plan SE7.1).** The SOS must NOT auto-dismiss or auto-advance. grep App.tsx/kit.tsx for any `setTimeout`/`setInterval` that advances or clears the incident/sheet state — the OLD code faked the ack with `setTimeout(()=>setSos('ack'),1600)`; that pattern must be GONE. The sheet must stay raised/escalated until `acknowledgeSos` flips it, and stay acknowledged until the rider clears it. Any auto-timeout that moves the safety state is a FAIL.
10. **Secure/quarantine custody (SE8 / SE-I04).** During the incident exactly one custodian is preserved and the package is not orphaned; the console shows who holds it. "task status is never custody truth" — the SOS must not mutate custody. Confirm `raiseSos` touches no course and the console renders the current custodian.

Run `pnpm --filter @sera/rider-app test`, `pnpm --filter @sera/dispatch-console test`, `bash scripts/run-gates.sh`, read any file. Do NOT fix anything. Ground every finding in file:line + a concrete scenario.
