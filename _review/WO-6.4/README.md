# WO-6.4 review packet — sera's carried debts, one pass (TIER: AMBER)

Branch `e6/wo-6.4` off sera main (contains `27d2bdb`, the WO-6.3 merge). Build commit `eaea0de`. No re-pin (canon v0.9.0 in flight). **Do NOT merge** — founder review.

## The four items

1. **REPORT FIRST — expo-preview on `27d2bdb`: GREEN.** See `preview-status.md`. Run #26 job `publish-preview` success; the EAS publish step (#8) that ships the rewritten Archivo TTFs ran and passed. The rewritten name-tables did not break the publish.

2. **Responder-match hardening (WO-6.3 ④).** `acknowledgeSos` now enforces `by === incident.responder` on BOTH surfaces (rider store + dispatch console). A mismatched ack is unrepresentable two ways:
   - **type-level:** `SosIncident` / `IncidentView` are discriminated unions on `responder`; `acknowledgedBy` can only ever be that same responder (or null). A wrong-human record is not a representable value — proven by a live `@ts-expect-error` (verified under the `typecheck` gate) with an honest control literal so the error is unambiguously the responder-match.
   - **runtime:** both `acknowledgeSos` throw on mismatch, leave the incident byte-unchanged, and credit the incident's OWN responder. Proven by runtime negatives in both directions on both surfaces (`sos-drill.test.ts` (b2)/(b3); `sandbox-incident.test.ts`).
   Both call sites already pass `incident.responder`, so the SOS happy path + the queued/offline honesty guard are unchanged.

3. **Gallery byte-stability (carried WO-4.1).** See `byte-stability.md`. Two-run byte-diff PROVES it: fixed clock for every state → 7/8 byte-identical by construction; the clock-requeue state carries a harmless ~7-px sub-pixel AA flip (a fixed clock did not change it — rasterisation, not data). Harmless because the PNG is gitignored and NO gate byte-compares it — the WO-4.1 landmine (a *tracked* PNG re-encoding) is structurally gone.

4. **Console «done» lever + gallery refresh (WO-4.3 ⑤).** Already landed by WO-6.1 and non-vacuously tested: `releaseOnCompletion` (`services/logistics-service/src/leased-assignment.ts:309` + test `leased-dispatch.e2e.test.ts:353`), the lever in `main.ts`, the e2e `shell.spec.ts:83`, and the `console-course-livree` gallery state. **Verified present, not rebuilt** (rebuilding landed work would be make-work).

## Evidence in this packet
- `preview-status.md` — item 1, live job-level CI evidence.
- `byte-stability.md` — item 3, two-run + fixed-clock + 3-run characterisation.
- `WO-6.4.diff` — the full diff (main..e6/wo-6.4).
- `warm-gates.log` / `cold-gates.log` — `run-gates.sh` green (exit 0) warm AND from a cache-isolated cold clone of committed bytes `eaea0de` (fresh install, fresh build 0-cached).
- `verifier-brief.md` / `verifier-verdict.md` — the fresh-context verifier's mandate and verbatim verdict.

## Gates
Warm + cold `run-gates.sh`: **ALL GATES GREEN** (exit 0), 0 GATE FAILED. Includes typecheck (both apps), rider suite (69), console suite (9), console e2e (16 — «done» lever, SOS raise→ack, queued-ack-disabled, all 8 gallery captures), and every invariant gate + negative fixture.

## FORBIDDEN respected
No journey/custody semantics touched · no franc in sera · no new dependency · no check disabled (guards + tests ADDED; gallery e2e strengthened, not weakened).

## Open / named for the founder (not defects)
- The `console-course-remise` residual AA flip is a browser-rasterisation fact, not a code defect; it cannot fire any gate. Named, not hidden.
- (Carried from WO-6.3, still open, not in this slice's scope) the out-of-hours escalation **transport channel** (SMS/push/call) and the « Dispatch hours/after-hours/SLA » staffing model remain ⏳.
