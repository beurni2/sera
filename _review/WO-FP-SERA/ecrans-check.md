# WO-FP-SERA · THE ECRANS CROSS-CHECK (CTO addendum, 2026-07-15)

**Fidelity gate:** each rebuilt view held against its frame in the « Sera - Ecrans » board —
the flat review sheet that lays all 13 frames (R1→R13) side by side. The board renders the
same screens as `Sera - Redesign.dc.html`; the per-frame **composition spec** is
`Sera - HANDOFF.md` §4 (read in full). This is the composition gate BEFORE the CTO's byte-
verification and the founder's device pass. The anatomy derivation still greps the Redesign
bytes (component source, line-cited); this sheet is the side-by-side.

Note: the Ecrans board's PNG renders (`screens/sera/NN.png`) are not in the handoff, so the
composition check is held against the HANDOFF §4 anatomy (the board's own spec source),
element-by-element.

Legend: **✓ MATCH** (composition holds) · **✂ RE-CUT** (gap found + fixed this pass) ·
**⚑ STRUCTURAL** (a lawful divergence from the app's journey spine / data model — flagged
below, not silently accepted).

| Frame (HANDOFF §4) | Rendered view | Ecrans-check |
|---|---|---|
| **R1 Service** | `service` | ✓ off/pending/on all present, white cert card, fpBar pending, accent live card. Absent: the « NOTICE · V3 » link + the « depuis 13:45 » since-time (⚑ data — the app has no notice target nor a shift-start clock). |
| **R2 Mes courses** | `courses` | ✓ (founder-accepted) — gold-bar proposed card · CRS eyebrow · PROPOSÉE · deadline · repère · pickup; en-cours/terminée/lineage; footer law. |
| **R3 Course proposée** | `affectation` | ⚑ the app's affectation is **R4-shaped** (repère + ack), with the deadline as an overline — it does NOT render the R3 **live 52 s countdown clock**, the destination card, or the « bail ancré » quote. The app's spine has ONE affectation screen (no separate proposal-countdown node). |
| **R4 Le repère** | `affectation` | ✓ accent repère card · SPÉCIMEN badge · LE REPÈRE / LES INDICATIONS · gold voice row. Absent: the masked-call « Appeler — numéro masqué » / relais bar (⚑ feature — not wired on affectation) and the live audio progress bar (⚑ data). |
| **R5 Vérifier** | `verify` | ✂ **RE-CUT** — added the card header (order-ref chip + colis identity) before the 7 checks (was missing). ⚑ the checks are a single GREEN « conforme » toggle, not the planche ✓/✕ tri-state; the mismatch arm is the screen's one DangerButton (the app has no per-row bad-state; a ✕ does not pre-fill R6). |
| **R6 Le refus digne** | `refused` | ⚑ the app refuses at verify WITHOUT a reason picker, so `refused` renders the planche's `r6Done` (« refus enregistré » + what-happens-next). The `r6Picking` motif list + photo is not in the app's verify-refusal flow. |
| **R7 Le scellé** | `seal` | ✓ seal card (SC-77 412, tracked) + seal action; offline = queued PENDING (« la garde ne commence pas hors ligne » verbatim). ⚑ no seal-photo toggle on R7 — the app's proof photo is its own step (R8/`evidence`). |
| **R8 En route** | `evidence` | ⚑ the app's R8-slot is the **SE-I06 proof-photo capture** (documentary CornerTicks frame), not the planche's en-route navigation card. The repère navigation appears on affectation (R4) + the door (R9); the app models proof as its own node. |
| **R9 À la porte** | `door_inspection` + `payment_wait` | ✓ door: repère + « Elle accepte »/« Un problème »/cantpay; payment_wait: SE-I11 unskippable, only the provider signal advances. ⚑ no live **dwell-chrono** card on inspecting (the app tracks no dwell timer). |
| **R10 Le code** | `drop` | ✓ (founder-accepted) — gold-cursor 6 cells · white keypad « ⌫ » · validate CTA · centered honesty. `codeWrong`/fpShake is a planche demo state absent from the app (not invented). |
| **R11 Validée** | `delivered` | ✓ gold ProofSeal · 3 green proof lines · no-money quote · celebration (dark scrim + fpPop seal + dashed rules). ⚑ the proof lines omit the « — CMD-2417 / — SC-77 412 / — 14:31 » suffixes (data). |
| **R12 L'échelle** | `refusal_reason`/`retry_window`/`refused_final`/`reschedule_planned` | ✓ family picker → the 4 dignified paths; honest countdown; buyer-fault money-register; 2ᵉ passage lineage. The app splits the families across screens (same custody logic). |
| **R13 Deux clés** | `retour_colis` | ✓ custodian note · two key rows · a single key REFUSES (`attemptReturnHandover` gate) · both → closed. ⚑ « CLÉ 1/CLÉ 2 » text badges → the app's key icon (both signal the key). |
| **R14 SOS** | overlay | ✓ (founder-accepted) — dark disc + red ring; sheet #14100B + 3px red top; confirm→raised→ack→enroute→clos + the offline `queued`/« (aperçu) » honesty; legible glyph (contrast law). |

## ⚑ STRUCTURAL divergences — flagged for the founder (NOT a reskin decision)

Three of these are not skin — they are the app's **journey spine / data model** differing from
the planche demo. Closing them means adding screens/timers/state to the custody flow, which is a
spine change (§7 territory), not a WO-FP-SERA reskin. Surfacing them, not silently accepting:

1. **R3 — the live response countdown.** The planche R3 is a dedicated node with a 52 s countdown
   clock (red ≤ 10 s) + « bail ancré » quote. The app merges R3 into affectation and shows a static
   « Réponds avant : HH:MM ». Adding the live countdown node is a spine + timer change.
2. **R8 — en-route navigation vs proof capture.** The app's R8-slot is the SE-I06 proof photo; the
   planche R8 is an en-route navigation card. Different nodes.
3. **R9 — the inspection dwell-chrono.** The planche shows a live mm:ss inspection timer; the app
   tracks no dwell.

**My recommendation:** ship the reskin as-is (all 13 views Faso, composition faithful within the
app's existing spine); treat R3-countdown / R8-navigation / R9-chrono as **separate spine work
orders** if you want the app's flow to gain those nodes — they are behavior/journey, not paint.
The smaller data gaps (R1 notice link + since-time, R4 call affordance + audio progress, R11 proof
suffixes) are one-line adds once the app models that data; none blocks the visual pass.
