# BUDGET — the honest performance accounting
### Grand Teint against the D17 budgets · v1.0.0

**Reference rig (canon):** Android Go, 2 GB RAM, 1.5 Mbps / 300 ms RTT, 360×800 dp, sunlight.

## Buyer PWA (hard CI gate: < 300 KB compressed; currently 12 KB before redesign)

| Item | Cost (compressed, est.) | Notes |
|---|---|---|
| Archivo variable, **Latin subset**, wght 400–900 + wdth 75–125, woff2 | **~65–80 KB** | The single biggest spend, and the highest-leverage one. `font-display: optional` — first paint never waits; system-ui fallback metrics are close (Archivo is metrics-friendly). If measured subset exceeds 85 KB: drop the wdth axis (poster stretch becomes 900-weight only) → ~45–55 KB. |
| Icon set (26 glyphs, inline SVG, currentColor) | ~5–7 KB total | 0.15–0.35 KB each; inlined in markup, no icon font, no requests |
| CSS (custom properties from tokens.json + layout) | ~8–10 KB | Flat colour, zero images, zero gradients in chrome |
| JS (vanilla TS, zero framework, zero deps) | ~15–25 KB | State machine + fetch + USSD prompts; no animation library |
| Celebration layer (keyframes + SVG motifs) | ~2 KB | Shared with confirmation states |
| HTML shell | ~4 KB | |
| **Total journey** | **≈ 100–130 KB** | **< half the 300 KB gate**, with headroom for the share/vitrine surface |

Product photos are user content, not payload: served resized to slot (list thumb ≤ 24 KB, C1 hero ≤ 90 KB target), lazy, with the `skeleton.bg` placeholder at exact dimensions (layout shift = 0).

## RN apps (Boutik+, Shop+, Séra)

- Archivo bundled as **static instances** (400/500/700/800/900, Latin) ≈ 180–240 KB binary per app — declared once, no runtime fetch. If the founder wants thinner APKs: 500/700/900 only (≈ 120 KB).
- No new dependencies for the design system itself. Optional `expo-haptics` is a proposal (see proposals.md §2), not an assumption.
- All components render in primitives: `View / Text / Pressable / FlatList / Image` + `StyleSheet`. Hairline tables are borders; bands are `View` fills; no blur, no gradient libs, no shadow strings (Android `elevation` 0–8 only).

## Frame budget (16.6 ms)

- Animations: `transform` + `opacity` only (GPU/native driver). The celebration is 10 composited layers for < 1 s — measured safe on Go-class GPUs; `particleCount` is a token, drop to 6 on low-RAM detect if profiling ever flinches.
- Zero animated layout anywhere in the system. Accordion-type reveals are cross-fade + translate.
- Lists: fixed-height rows by design (ListRow = 64, ProductCard = 96 list / fixed grid), so `FlatList` gets `getItemLayout` and never measures.
- Skeletons have the exact dimensions of their content — cumulative layout shift is 0 by construction.
- Count-up mutates one text node at ~60 fps for 560 ms with tabular digits — no reflow of neighbours.

## What this design refuses to spend

Raster imagery in chrome (0 bytes) · illustration libraries (0) · animation libraries (0) · webfonts beyond one family (0) · gradients/blur/shadow theatre (0 GPU overdraw beyond flat paint).

**Verdict:** the entire signature — ink, hairlines, giant tabular numerals, corner ticks, one variable font — costs roughly a third of the PWA gate and nothing per frame. Beauty that is *made of* the constraint.
