# WO-FP-SERA · FASO PREMIUM — 3-VIEW STYLE PROOF (drop v2 · TRUE ANATOMY)

Branch `e6/wo-fp-sera` · **DO NOT MERGE**.
RN aesthetic evidence = the expo-preview build on the founder's device (program convention).

## What changed since drop v1 (the CTO correction, 2026-07-15)

The prior drop reskinned the **paper** but kept the **old anatomy** — R2 still rendered the
glyph-tile + chevron list row under new colour. **The planche (`Sera - Redesign.dc.html`) is
the only bar.** This drop rebuilds the three proof views to the planche's **true frame
anatomy**, with a new mandatory artifact: **`anatomy-derivation.md`** — per view, the planche
elements grepped + quoted → the implementation → each divergence with its lawful reason.

- **R2 « Mes courses »** — rebuilt from a glyph-tile list to the editorial **CourseCard**: a
  Bricolage-800 « Mes courses » title over cards whose proposed variant is the gold-glow card
  (left gold bar · `CRS-0891` eyebrow · **filled** PROPOSÉE pill · « avant HH:MM » deadline) —
  no icon tile, no chevron. Active = hairline card + honest status pill; done = receded tint.
- **R10 « Le code »** — the codeEntry overline + honesty centered over the gold-cursor cells;
  keypad backspace is the planche « ⌫ ».
- **R14 « SOS »** — verified against the planche (already faithful); the one lawful divergence
  is the legible SOS glyph (the planche prints it `#1C1710`-on-`#1C1710`, invisible).
- **Font-proof strip** ships (preview-only `FontProofStrip`) — the type question, on device.

## The preview

- **Open the Séra preview app** — it auto-updates on the `preview` channel (android + iOS).
- Published green by `expo-preview.yml` `workflow_dispatch` on the branch — **run #47**
  (id 29381084535), head `79d2c26`, conclusion **success** (~2 min; Metro bundle + `eas update`
  clean, so the CourseCard, the react-native-svg signatures and the six embedded faces all
  bundled with zero errors). Run: <https://github.com/beurni2/sera/actions/runs/29381084535>.

## The three views — hold each against its planche frame

| Frame | planche lines | What to look at |
|---|---|---|
| **R2 — Mes courses** | 96–141 | the gold-glow proposed card: left bar · CRS eyebrow · filled PROPOSÉE pill · « avant 14:32 » · title · pickup subtitle. NO glyph tile, NO chevron. |
| **R10 — Le code** | 412–440 | gold-cursor cells + white keypad (« ⌫ »); centered « Code du client » honesty verbatim |
| **R14 — SOS** | 545–579 | dark disc + red ring; sheet `#14100B` + 3px red top, fpUp; confirm→raised→ack→enroute→clos + the offline `queued`/« (aperçu) » honesty |

## Verified, not claimed

- **Anatomy guard:** `test/faso-anatomy.test.ts` (7) — R2 is the CourseCard (bar/eyebrow/pill/
  deadline), NO glyphTile/chevron; PROPOSÉE filled, lineage outlined; keypad « ⌫ »; R10 centered.
- **States law:** `test/faso-states-law.test.ts` — every absent-from-prototype honest state survives.
- **Honesty contracts intact:** `sos-drill` 9/9, `evidence-finality` 5/5, `wo6-invariants` 11/11, `ui-kit` updated.
- **Contrast gate:** `#241A05` on `#D9A441` = 7.62:1 (AAA); every pairing ≥ AA (permanent gate).
- **Token fidelity:** signature.tsx + faso-sos.tsx + faso-kit.tsx hex-free (colour via the bridge).
- **French copy-lint:** OK, 151 entries, 0 violations (incl. new `courses.statut_proposee`, `courses.before`).
- Typecheck clean · **rider 107/107**.

## Guards

- **① The preview channel reverts on the next `main` publish** (un-merged-branch preview; the founder is its only consumer).
- **② If the SOS drill fires during the review window, it runs against a `main` build, never this branch.**

## What's in this drop

- `PROOF-DROP.md` — this file.
- `anatomy-derivation.md` — **the mandatory artifact**: planche → implementation → lawful divergence, per view.
- `states-law-inventory.md` — the founder-veto-① checklist (14 framed + 12 absent-from-prototype states).
- `build-faso-fonts.py` — the STEP 0 font-build provenance.

## Next (on the founder's aesthetic tap)

Views 4–13 straight through per the states inventory + the anatomy method (grep the planche →
implement → derive divergences), then the full packet. No further view restyles until the tap.
DO NOT MERGE.
