# R8 « En route » — SCOPE FLAG (bigger than a spine-item · founder ruling needed)

**Grounded in:** HANDOFF §4 R8:65 · ecrans-check.md §STRUCTURAL · JOURNAL:660 · journey.ts:17-21,79-82 · journey-spine.test.ts.

## What R8 actually is (planche)
HANDOFF §4 R8 « En route » = a **repère (landmark) navigation card**, shown AFTER
the seal, BEFORE the door: caps « UN SEUL ARRÊT », gold card (zone / repère /
indications / INDICATIONS(play) + RELAIS(call)), quote-rule « Pas de point GPS,
pas de modèle d'itinéraire. Le repère est la navigation », CTA « Je suis à la porte ».
NOT maps/routing (Law #5-safe) — the content already exists in-app as
`LandmarkCard` + `VoicePlayRow` (used on R4/affectation).

## Why it is bigger than a spine-item
The planche places R8 between the proof and the door. In the app's spine that is
the **custody-flow-OWNED edge** `evidence_pending → door_inspection`:
- journey.ts:79-82 computes that edge from `stepAfterEvidenceAck` (the rule source).
- journey.ts:17-21 design law: « this file never re-encodes a [custody] transition ».
- journey-spine.test.ts pins `evidence_pending`'s forward edge to EXACTLY
  custody-flow's output (+ courses).

Inserting a UI node on that edge = **rewriting the rule-law guardrail** that keeps
the journey map from re-encoding custody transitions. That is journey-graph
surgery on a custody-owned edge — §7-adjacent, not paint, not a self-contained
display add. Cost: +1 Screen/JOURNEY node, edge rewire, COURSE_OPEN/BACK_STEPS,
the journey-spine BFS + rule-law assertions, a new App render block, ~5 strings.

## Options for the founder
1. **Ship R9 only now (done, this branch); treat R8 as its own spine WO.**
   Recommended. R8 gets a proper work order that re-expresses the rule-law test
   as « en_route is a display waypoint; the custody target (door_inspection) is
   unchanged » — reviewed on its own, not smuggled into a reskin.
2. **Build R8 as an additive section on an EXISTING screen (no new node)** — e.g.
   fold the « un seul arrêt » repère card onto the tail of `seal`'s « En route »
   CTA or the head of `door_inspection`. Cheaper (no journey change) but it is NOT
   the planche's standalone R8 screen — a compromise, flagged as such.
3. **Full R8 node now** — only with an explicit founder OK on changing the
   `evidence_pending` rule-law guardrail (§7 sign-off on the approach).
