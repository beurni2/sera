# WO-FP-SERA · STATES-LAW INVENTORY

**Founder veto ①:** every existing rider state survives the restyle. States the prototype
(« Sera - Ecrans », R1–R14) does **not** give a dedicated frame are restyled **within the
system's grammar** and **LISTED here** — none is dropped. This list is the checklist the
full 13-view restyle (views 4–13, after the founder's tap) must satisfy.

Legend: ✅ has an « Ecrans » frame · 🟨 ABSENT-from-prototype (honest edge/offline/pending
state — restyle in the Faso grammar, do not drop) · ⭐ = one of the 3 proof views already done.

## A · The main custody path (screens with « Ecrans » frames)

| Rider state / screen | « Ecrans » frame | Status |
|---|---|---|
| `service` (shift off / on) | R1 — Service | ✅ |
| `courses` (course list) | R2 — Mes courses | ✅ ⭐ done |
| `affectation` (proposal) | R3 — Course proposée | ✅ |
| `affectation` + LandmarkCard illustrated | R4 — Le repère | ✅ |
| `verify` (7/7 checklist) | R5 — Vérification | ✅ |
| `refused` (dignified refusal at verify) | R6 — Le refus digne | ✅ |
| `seal` (le scellé) | R7 — Le scellé | ✅ |
| `evidence` (proof photo / en route) | R8 — En route | ✅ |
| `door_inspection` + `payment_wait` | R9 — À la porte | ✅ |
| `drop` (le code de remise) | R10 — Le code | ✅ ⭐ done |
| `delivered` (celebration) | R11 — Validée | ✅ |
| `refusal_reason` (the 4 failure families) | R12 — L'échelle des échecs | ✅ |
| `retour_colis` (two-key return) | R13 — Deux clés | ✅ |
| SOS overlay (raised→ack→enroute→clos) | R14 — SOS | ✅ ⭐ done |

## B · ABSENT-from-prototype states — MUST survive, restyle in the grammar (none dropped)

These exist in the rider but have **no dedicated « Ecrans » frame**. The prototype shows the
happy path; these are the honesty/offline/pending sub-states the states-law protects. Each
gets a **system-grammar treatment** in the full restyle (the noted Faso component), never dropped:

1. 🟨 **`evidence_pending`** — SE-I06 « en attente »-until-ack (the drop stays LOCKED until the authoritative server ack). **Honesty-critical.** → Faso pending surface (calm bar + « la remise attend la confirmation de Séra »); the ack-arrives branch → continue. NEVER a fake advance.
2. 🟨 **`ack_pending`** (course ack queued offline) — R3-adjacent. → Faso pending notice « queued = pending, confers nothing ».
3. 🟨 **`decline_pending`** (decline queued offline) — R3-adjacent. → Faso pending notice; the course stays proposed, the window still runs.
4. 🟨 **`proposalOutcome: declined` / `expired`** — closed-proposal list badges. → Faso muted status chips (`courses.statut_rendue` / `statut_expiree`).
5. 🟨 **Offline banner + `backlog`** — « Hors ligne : N actions en attente » (N = the REAL outbox count). → Faso offline banner (warn register), the real count; reconnect clears it.
6. 🟨 **`persistFailed`** — background-persist failure (« Un envoi n'a pas pu être enregistré. À refaire. »). → Faso banner-surface notice (the honest, non-overpromising string — the safety-copy doctrine).
7. 🟨 **`collision-refused`** — the outbox surfaces a refused write (kept pending, never silently dropped). Currently outbox-level; a UI surfacing lands with the reconnect flow. → Faso surfaced-refusal notice when wired.
8. 🟨 **SOS `queued`** (offline SOS) — the honest « offline: no ack shown, unacknowledgeable » sub-state (distinct from raised/escalated). → Faso dark sheet, NO ack affordance (done in R14, but listed: the queued branch must stay).
9. 🟨 **`shift: pending`** (offline shift-start) — « queued = pending, never done; never a fake En service ». → Faso pending card on R1.
10. 🟨 **`retry_window`** with the live mm:ss countdown — R12 sub-state (« fenêtre de nouvelle tentative »). → Faso pending/timeline treatment with the honest countdown.
11. 🟨 **`reschedule_planned`** — the 2e-passage lineage state (« la lignée suit le colis », the « 2ᵉ PASSAGE » badge on R2). → Faso tint note + lineage chip.
12. 🟨 **`refused_final`** — the terminal refusal before the return leg (R12→R13 bridge). → Faso danger note « le colis reste à vous jusqu'à instruction ».

## C · Cross-cutting states (survive on every screen)

- 🟨 **reduced-motion** — every fp* motion is static-at-rest under `prefers-reduced-motion` (wired in the signature module; must hold on every restyled view).
- 🟨 **offline toggle** (the demo connectivity override) — drives the banner + the queued sub-states above.
- ✅ **SOS reachable on every screen** — the floating disc is mounted unconditionally (R14).

**Count:** 14 framed states (A) + **12 absent-from-prototype states (B)** + 3 cross-cutting (C). The full restyle DoD = all 26 rendered in the Faso grammar; the 3 proof views (R2, R10, R14) already satisfy their rows incl. the honesty sub-states (evidence-finality, SOS queued, code-only-on-drop verified green).
