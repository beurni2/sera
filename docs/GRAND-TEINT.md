# GRAND TEINT — the design system
### Boutik+ × Shop+ × Séra · v1.0.0 · direction 1b, locked 2026-07

> **The idea in one line:** the confidence of a hand-painted market poster, printed with the precision of a bank receipt — instant on a 40 000 FCFA phone, legible in full sun.

**Artifacts in this project**
- `Directions visuelles.dc.html` — the exploration that produced this system (1a/1b/1c; 1b chosen)
- `PWA Acheteuse - Prototype.dc.html` — C1–C9, every state, tappable
- `Celebrations.dc.html` — the three celebrations, live
- `docs/tokens.json` · `docs/components.md` · `docs/flows.md` · `docs/motion.md` · `docs/copy.md` · `docs/budget.md` · `docs/proposals.md`

---

## 1 · Why this look wins here

Everything in the market is either beautiful-but-heavy or fast-but-ugly. Grand Teint is **craft under constraint**: its beauty is made of ink, hairlines and huge honest numbers — things that cost zero bytes and zero frames. It reads like a printed notice: in Ouagadougou, print is what official truth looks like. That is the trust register this product needs at money moments, and no app here looks like it.

- **Sun-first.** Near-black ink (`#1B140D`) on warm paper (`#FFFDF7`) — contrast ≈ 15:1, far past AA. No mid-grey text for anything that matters.
- **Byte-first.** One variable typeface, inline SVG, flat colour. No gradients, no photos in chrome, no blur, no elevation theatre.
- **Frame-first.** Nothing animates layout. Selection is a border swap; emphasis is weight and width, not shadow.

## 2 · The five signatures, expressed

1. **La vitesse comme luxe** — skeletons with exact content dimensions (`skeleton.*`), press feedback < 100 ms (`motion.instantMs`), no spinner anywhere (the pulse bar `gtBar` is the only waiting texture).
2. **L'argent en majesté** — money is the biggest ink on every screen (`money.amountScale`), always tabular, grouped with a narrow space, never abbreviated. The **price band** (full-width theme-colour block with 40 px numerals) is the signature money moment. Receipts reconcile visibly: the `reconcileLine` ("12 500 = 11 500 + 1 000 — chaque franc a sa place.") is a component, not a nicety.
3. **La célébration** — three moments only, woven-diamond / road-chevron motifs, ≤ 800 ms, tap-to-skip. See `motion.md`.
4. **Le repère, pas l'adresse** — the landmark block leads with the **repère in bold**, zone as a letterspaced cap label above it, spoken directions as a first-class row. (Illustrated LandmarkCard: commissioned separately, see §11 of the brief.)
5. **La voix** — the listen affordance is a filled play triangle + underlined caps label (« ÉCOUTER LA NOTE »); the recorder is an ink block with a pulsing red dot and a visible timer.

## 3 · Palette

One ink, one paper, one accent per app. Never two accents on one screen.

| Role | Token | Value |
|---|---|---|
| Ink (text, fills, primary buttons) | `colour.shared.ink` | `#1B140D` |
| Paper (background) | `colour.shared.paper` | `#FFFDF7` |
| Body text | `colour.shared.body` | `#4A3F33` |
| Muted / captions | `colour.shared.muted` | `#6E6154` |
| Hairlines | `colour.shared.hairline(-Mid/-Strong)` | `rgba(27,20,13, .14/.22/.35)` |
| Sand (recap surfaces, photo slots) | `colour.shared.sand` | `#F3EBDB` |
| **Shop+ / buyer accent** | `colour.shop.primary` | `#C2571B` (canon) |
| **Boutik+ accent** | `colour.boutik.primary` | `#1F4D36` |
| **Séra accent** | `colour.sera.accent` on ink | `#D9A441` |
| Success / warning / danger | `colour.shared.*` | `#1F4D36` / `#6B4E0C` on `#F7EED7` / `#B3382C` |

Accent is spent on: the 4 px theme strip, the price band, the selected-option edge, « Vos protections », and the celebration. Everything else is ink.

## 4 · Typography

**Archivo variable** (wght 400–900, wdth 75–125). Loaded once; `font-display: optional` on web so first paint never waits. Scale in `type.scale`.

- Titles: 900 weight, wdth 110–112, uppercase for poster headers.
- Labels: 800, letterspaced 2–2.4, uppercase, small.
- Body: ≥ 16, weight 500, line-height 1.5. French never truncates.
- **Every franc: `font-feature-settings: 'tnum'`** — digits never jitter, columns always align.

## 5 · The layout grammar

These seven moves make any screen recognisably Grand Teint:

1. **The hairline table** — content lives in bordered boxes (`1.5px` strong hairline or `2px` ink), rows divided by thin hairlines. No card shadows, radius 0.
2. **The price band** — full-width accent block; tiny caps label; 40 px white tabular amount; the honesty note on the right.
3. **The accent edge** — a 5 px accent bar on the left of the selected option + a 26 px ink corner square with a check. Selection is structural, not tinted.
4. **Corner ticks** — 14 px L-marks inside photo frames and the drop-code frame: "documentary evidence" framing.
5. **The theme strip** — 4 px app-colour band under the app header. The only permanent brand mark.
6. **Caps + letterspacing** for wayfinding; sentence case for speech. The app talks like a person, labels like a form.
7. **The quote rule** — a 3 px ink left-border paragraph for the one sentence that matters (« Vous inspectez le colis avant de payer le reste. »).

**Grid:** 360 dp design width · 16 px gutters · spacing scale `4/8/12/16/24/34` · one primary action per screen, full-width, h 56.

## 6 · State doctrine (designed states, never apologies)

- **Pending** is ink-bordered, labelled, calm: « C'est noté. En attente du réseau. » Never a green check before the server says so.
- **Offline** is a full-width ink banner: « Hors ligne : vos actions sont en attente, jamais perdues. »
- **Refusal / problem** paths get equal visual weight to happy paths (side-by-side equal buttons at C8; danger is bordered, not screaming).
- **Ineligible** is one dignified sentence in a muted box — never an error wall.
- **Empty** states state the next action, never sadness.
- **Skeletons** replace exactly what will arrive, same dimensions, pulse floor 0.4.

## 7 · Accessibility floor

Touch ≥ 48 px (visual elements may be smaller inside a padded hit area) · body ≥ 16 · contrast ≥ 7:1 for text that matters · icon + word, never icon alone · `prefers-reduced-motion` honoured everywhere (static equivalents defined per animation) · voice notes at money moments.

## 8 · What Grand Teint refuses

Gradients as decoration · shadows as hierarchy · rounded-corner softness on money surfaces · emoji in chrome · spinners · toasts that vanish before a slow reader finishes · any animation of width/height/top/left · any colour not in `tokens.json`.
