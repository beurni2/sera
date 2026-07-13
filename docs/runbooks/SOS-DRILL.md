# SOS Drill — Séra rider safety (SE8)

**Purpose.** Prove, before pilot, that a rider's SOS is answered — by the right person, in time, without ever faking an acknowledgment, and without ever putting the package's custody at risk. Run this drill with a real phone and a real second person (dispatcher in-hours, founder out-of-hours).

> **Authority:** Sera-Build-Spec SE8 ("SOS visible from every rider flow; ack within SLA; secure/quarantine custody; **live drill before pilot**"). Location law: Sera-Build-Spec §12 / SE-I08 ("location only on shift/task"). Custody law: package never unowned; exactly one current custodian. Offline law (Ten Laws #7): queued = pending, never done.

---

## Open decisions in force (safest-defaults applied)

| Item | Status | What this drill uses |
| --- | --- | --- |
| **Ack SLA value** | **Founder-confirmed 2026-07-12** (WO-6.3 item 2); the broader Sera-Build-Spec:185 "Dispatch hours/after-hours/SLA" staffing model stays ⏳ | **60 s in-hours ack target** (CTO safest-default, founder-confirmed), stored as versioned policy data `SOS_ACK_SLA_POLICY` (`sos-ack-sla.v1`, `inHoursTargetSeconds: 60`). Tunable at pilot — never silently. This is a **target the drill measures**, not a timer that fabricates an ack. |
| **Out-of-hours escalation transport** | ⏳ open founder item (WO-6.3 §2) | The **path and state are built**; the transport channel (SMS / push / call) is **unbound** — `ESCALATION_TRANSPORT = { status: 'pending', channel: null }`. The rider app names it as pending; it never claims a send that did not happen. **Founder: choose the channel before pilot.** |

---

## Who answers (founder ruling, 2026-07-12)

- **In dispatch hours → the DISPATCHER answers.** The dispatch console is the surface. The raised incident lands at the **top** of the console, loudest, with rider identity, reference, active course, coarse location (on-shift only), and the **custody line** (the rider still holds the package). The dispatcher taps **« J'ai vu — je réponds »** → the incident shows acknowledged.
- **Out of dispatch hours → the SOS escalates to the FOUNDER's phone.** The rider app shows the escalated state and names the transport as **pending** (channel not yet bound). The founder acknowledges by the agreed channel once bound.

Both paths exist in code and both must be exercised in the drill.

---

## Preconditions

- Rider test device with the Séra rider app (Expo Go preview is fine).
- A second person able to act as **dispatcher** (console open) and, separately, as **founder** (phone).
- A stopwatch for the ack-time measurement.
- Agree who plays which role for each pass.

---

## Pass 1 — In-hours, online (dispatcher answers) — target ack ≤ 60 s

1. On the rider device, put the rider **on shift** (Service → « Prendre la route » → confirmed « En service »).
2. Open any course screen (so there is an active course to attach).
3. Tap **SOS** (bottom-right, reachable from every screen). The sheet opens on **« SOS »** (confirm). *Opening does not fire.*
4. **Hold** « MAINTENIR POUR DÉCLENCHER ». The sheet moves to **« Alerte envoyée. »** — **start the stopwatch now.**
5. On the dispatch console: confirm the SOS alert is at the **top**, loudest, and shows: rider, reference, active course, **Localisation : …** (present, because on shift), and **« Le colis reste avec le livreur. La garde ne bouge pas. »**
6. Dispatcher taps **« J'ai vu — je réponds »**. **Stop the stopwatch.**
7. On the rider device the sheet shows **« On vous a vu. »** with **« Je suis en sécurité — clore »**.
8. Rider taps close → **« Clos. »** → « Fermer ».

**Pass 1 passes iff:**
- The ack appeared on the rider device **only after** the dispatcher acted (never on a timer).
- Measured ack time is recorded; **≤ 60 s** meets the current target (⏳ tunable).
- Coarse location was present on the console.
- The active course's custody step did **not** change at any point; the package still shows exactly one custodian (the rider).

## Pass 2 — Out-of-hours, online (founder's phone) — escalation path

1. Repeat steps 1–4 of Pass 1 in the out-of-hours configuration (`SANDBOX_DISPATCH_HOURS = 'out_of_hours'` in the live drill build).
2. The rider sheet shows **« Hors des heures — on alerte le responsable. »** and the honest transport line **« Canal d'alerte au responsable : en cours de branchement (SMS ou appel). »**
3. The incident's responder is **founder**. Founder acknowledges via the agreed channel (once bound). In the sandbox, the founder/dispatcher stand-in drives the acknowledgment.
4. Rider device shows **« On vous a vu. »** → close.

**Pass 2 passes iff:** the escalated state named the transport as **pending** (no fake send), the responder was the founder, and the ack appeared only after a real response.

## Pass 3 — Offline (queued never lies)

1. Put the rider device **offline** (drill build: `CONNECTIVITY = 'offline'`).
2. Trigger SOS as above (hold to fire).
3. The rider sheet shows **« SOS en attente du réseau. »** and **« Rien ne part tant que le réseau ne revient pas. On ne fait pas semblant. »**
4. Confirm there is **no acknowledgment control** and **no acknowledged state** — a queued SOS cannot be acknowledged.
5. Restore the network. On reconnect, the queued SOS is delivered (`deliverQueuedSos`) and only then can it be acknowledged.

**Pass 3 passes iff:** the offline SOS never showed an acknowledgment that had not happened, and an ack became possible **only after** the network delivered it.

---

## Global pass/fail criteria (all passes)

- **No fake ack, ever.** An acknowledgment is shown only after `acknowledgeSos` runs on a live incident. A queued incident throws if an ack is attempted.
- **Location law.** Coarse location is attached **only** when the rider is on shift; off-shift it is absent (« Localisation non disponible (hors service) »).
- **Custody preserved.** Raising an SOS changes no course's custody step and orphans no package; exactly one current custodian throughout.
- **Only canon events.** The incident emits only `safety.sos_created.v1`, `incident.opened.v1`, and (on ack) `safety.sos_acknowledged.v1`.
- **Both answering paths exercised** — dispatcher (in-hours) and founder (out-of-hours).

## Record for each pass

Date · rider · responder · in/out of hours · online/offline · **measured ack time** · location present? (Y/N and matches shift state) · custody step unchanged? (Y/N) · notes.

---

*Automated backing:* `apps/rider-app/test/sos-drill.test.ts` (the full path, out-of-hours, offline-never-lies, custody-preserved, location-law, no-franc) and `apps/dispatch-console/e2e/shell.spec.ts` (incident-at-top + dispatcher ack; queued + disabled ack). Gallery states: `console-sos-raised`, `console-sos-acknowledged`, `console-sos-queued`.
