# Performance & Device Budgets — Contract §7.3 (named at E0, enforced from E1)
**Status:** D17 CLOSED — founder-signed 2026-07-10 · **Version:** 1.0 · **Owner:** CTO-Supervisor (telemetry recalibration at E4)

> Contract §7.3: *"'Works on a low-end device' is not an acceptance criterion until the device and thresholds are named."* This document names them. Founder-signed values are canon; values marked **CTO-derived — tune at E4 telemetry** are conservative defaults that move only on measured E4 pilot data, never silently.

## The named reference profile (founder-signed)

| Dimension | Reference |
|---|---|
| Device class | **Android Go class, 2GB RAM** — Tecno Spark Go / Itel A-series, Android 12–13 (Go edition) |
| Network | **3G-class**: 1.5 Mbps, 300 ms RTT |
| Viewport | **360×800** |

Every budget below is measured ON this profile. A screen that is beautiful on a flagship and misses these numbers is a failed screen (charter §5).

## Founder-signed budgets (D17, 2026-07-10)

| Budget | Value |
|---|---|
| Cold start → first useful screen | **< 5 s** |
| Touch → feedback | **< 100 ms** |
| Touch → result | **< 250 ms** |
| Frozen scroll stretch | **never > 200 ms** |
| Initial PWA payload (buyer surface) | **< 300 KB compressed** |
| Offline queue durability | **every queued action survives app-kill AND device reboot** |
| French long text | **never truncates meaning** (labels tested with real French strings) |

## Contract §7.3 named list — completed (each: CTO-derived — tune at E4 telemetry)

| §7.3 item | Budget | Provenance |
|---|---|---|
| Product-card payload | ≤ 25 KB compressed per card, thumbnail included | CTO-derived — tune at E4 telemetry |
| Buyer-page JS payload | ≤ 150 KB compressed (inside the 300 KB founder-signed total) | CTO-derived — tune at E4 telemetry |
| Image sizes | thumbnail ≤ 15 KB · hero ≤ 80 KB · full view ≤ 150 KB | CTO-derived — tune at E4 telemetry |
| Offline-queue size | ≥ 200 queued actions without degradation; ≤ 5 MB local storage | CTO-derived — tune at E4 telemetry |
| Checkout response | server ≤ 800 ms p95 · end-to-end ≤ 2 s p95 on the reference network | CTO-derived — tune at E4 telemetry |
| Attribution-validation time | ≤ 150 ms server p95 | CTO-derived — tune at E4 telemetry |
| Assignment-transaction latency | ≤ 500 ms p95 (single atomic lease, Durable Object) | CTO-derived — tune at E4 telemetry |
| Evidence-upload time | 3 photos ≤ 300 KB each, complete ≤ 30 s p95 on the reference network, resumable across drops | CTO-derived — tune at E4 telemetry |
| Memory on reference device | ≤ 250 MB RSS steady-state | CTO-derived — tune at E4 telemetry |
| Battery/location per rider shift | ≤ 8%/hour including on-shift GPS at balanced accuracy; zero location collection off-shift (SE-I08) | CTO-derived — tune at E4 telemetry |

## Enforcement

- Budgets enter app-repo CI as measured gates as each surface lands its E1 slice (device-matrix checks per Building Plan DoD); until a surface exists, its budget binds review, not CI.
- Recalibration happens once, at E4, against pilot telemetry (§6 business-viability signals ride the same pipeline) — with a JOURNAL entry per changed value and founder sign-off for any loosening.
- The reference device pair is purchasable in Ouagadougou; the device drawer holds at least one of each before E4.
