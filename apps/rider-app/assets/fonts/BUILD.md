# Archivo — Latin subset, static instances (WO-5.1)

**Reproducible build.** These five static TTFs are produced from the Archivo
variable font (SIL Open Font License 1.1, © The Archivo Project Authors),
subset to Latin + French typographic characters and pinned to the five
weights the Grand Teint design uses.

## Source
- Family: **Archivo** variable, latin subset, from Google Fonts (`fonts.gstatic.com`, v25 — the css2 API's `latin` unicode-range block).
- License: OFL 1.1 (redistribution + embedding permitted).

## Pipeline (deterministic)
1. Fetch the latin-subset variable woff2 (axes `wght 100..900`).
2. `fontTools.varLib.instancer.instantiateVariableFont` → pin `wght` to 400 / 500 / 700 / 800 / 900.
3. `fontTools.subset.Subsetter` → keep U+0020–007E · U+00A0–00FF · œŒ ı · curly quotes · «» · – — … € (French + typographic). `layout_features=['*']` keeps `tnum`/`kern`.
4. Save as plain TTF (no woff flavor) for React Native's asset loader.
- Toolchain: **fontTools 4.63.0 + brotli** (pip). The generator lives in the WO-5.1 packet.

## Weights + sha256
- **Archivo-Regular.ttf** — 33852 bytes · sha256 `82d7f9dc5053b4825c0d3050b76320232c0a7931600f6c01e96539f1e4f9e356`
- **Archivo-Medium.ttf** — 34240 bytes · sha256 `a9c84f6d5e030fef28fc93427818fd84888f5f26447fc4ae9a3ec66aea4b984b`
- **Archivo-Bold.ttf** — 34200 bytes · sha256 `9f889cca1edadec4204f7e23bfdb4a60a4adb6bc894ce97335070e8b5ad55134`
- **Archivo-ExtraBold.ttf** — 34224 bytes · sha256 `434fe67d1166e5c70d0f04bab7ad116d77f57b97a3328d540620e1eccfee99cd`
- **Archivo-Black.ttf** — 34188 bytes · sha256 `d2438d55ebb9365850d8abcdeb7dc4d56c73bddaae1d297efcba87f14cebe7cb`

**RN static set total: 170704 bytes (166.7 KB) per app** — within the design's 180–240 KB estimate (budget.md).

## ⚠ One honest gap — the narrow no-break space (U+202F)
Archivo does not include U+202F (the character `Intl.NumberFormat('fr-FR')`
emits between franc thousands, e.g. « 12 500 »). It renders from the system
fallback — invisible ink, so no visible defect — and it does **not** affect
tabular digit alignment (`tnum` fixes each DIGIT's width; the group space is
not a digit). Named for the design's decision at the next type slice
(options: accept fallback · use U+00A0 · use U+2009).
