# WO-6.3 REVIEW PACKET — THE SOS DRILL (R14 becomes a safety system)

Branch `e6/wo-6.3` · off sera main (`4e62f5f`). Do NOT merge — awaiting founder verdict.
Build `1dc9ca6`. Spine untouched (journey.ts, custody-flow.ts: 0 diff lines).

## Contents
- `WO-6.3.diff` — the full diff.
- `verifier-brief.md` / `verifier-verdict.md` — the fresh-context verifier's charge + verdict.
- `cold-gates.log` — the cold-clone gate run (EXIT 0).
- `../../docs/runbooks/SOS-DRILL.md` — the runnable drill (both answering paths).

## CTO self-verification (my own hands, all grounded)
- **STOP resolved (founder ruling):** in-hours DISPATCHER acks; out-of-hours escalates to the FOUNDER'S phone. Transport (SMS/push/call) named PENDING — never faked.
- **Canonical events, no invention:** `safety.sos_created.v1`, `safety.sos_acknowledged.v1`, `incident.opened.v1` — all in the pinned EVENT_NAMES.
- **THE FAKE KILLED:** the `setTimeout(()=>setSos('ack'))` timers are gone; the ack routes only through `acknowledgeSos`.
- **HONESTY LAW, STRUCTURAL (verified in code + test):** `acknowledgeSos` throws unless status ∈ {raised, escalated} — a queued (offline) incident is unacknowledgeable; the UI queued state has NO ack affordance. Test (c) asserts the throw + "still queued, no fake ack".
- **CUSTODY PRESERVED:** `raiseSos` reads/mutates no course; test (d) asserts the course step byte-unchanged + course-count preserved; console shows the custodian; `package-never-unowned` gate green.
- **LOCATION LAW:** `coarseLocation` null off-shift (test (e)); off-shift-location gate green.
- **PERSISTENT SIGNAL:** no auto-dismiss — the SOS holds until acknowledged, then until the rider clears.
- **SLA safest-default flagged:** `SOS_ACK_SLA_POLICY` 60s in-hours target, versioned, tunable at pilot (open ⏳).
- **Evidence (my runs):** rider 65/65 (sos-drill 7) · console 5/5 + e2e 16/16 (3 SOS states) · typecheck 0 both · run-gates EXIT 0 (warm + cold) · cold proof @ 1dc9ca6.

## Open/named for the founder (not defects)
- The out-of-hours escalation **transport channel** (SMS/push/call) — pending your choice; the path/state exist and never fake a send.
- The **ack SLA value** (60s) — a flagged safest-default awaiting your confirm-or-name.
