# Handoff: Grand Teint — Boutik+ × Shop+ × Séra (total redesign)

**For:** the developer implementing this in the real codebase (`platform-contracts`, the three Expo apps, the buyer PWA, the two consoles)
**From:** the design commission of 2026-07 (brief: `uploads/Design-Brief-Claude-Design.md` in the source project)
**Design system:** « Grand Teint » v1.0.0 — locked, founder-approved direction 1b

---

## Overview

A complete visual reset of the six surfaces of the Boutik+ (supplier) / Shop+ (reseller) / buyer-PWA / Séra (rider) / dispatch / ops ecosystem, replacing the shipping "engineer-correct" UI. The signature: **market-poster confidence printed with bank-receipt precision** — near-black ink on warm paper, hairline tables, huge tabular franc amounts, one accent per app, zero effects that cost bytes or frames. Designed for a 2 GB Android Go phone (360×800 dp), 3G, full sun.

## About the design files

Everything in this bundle is a **design reference built in HTML** (interactive prototypes), NOT production code. Your task is to **recreate these designs in the existing environments**:

- **Boutik+, Shop+, Séra** → React Native (Expo SDK 54), primitives only (`View, Text, Pressable, FlatList, Image, ScrollView, SafeAreaView, StyleSheet`). No CSS, no new dependencies without founder approval (two are formally proposed: `expo-haptics`, `react-native-svg` — see `docs/proposals.md` §2/§10).
- **Buyer PWA + dispatch console + ops console** → Vite + vanilla TypeScript, zero framework, zero dependencies, **< 300 KB compressed total** (CI gate). Budget accounting in `docs/budget.md` (~130 KB projected).

Open any `.dc.html` file in a browser **from this folder** (keep `support.js` beside them — it is the prototype runtime, not a product asset).

**⚠ The left rail in every prototype is a design-review harness** (state jumper, offline/reduced-motion toggles, 5-second-test line). It is NOT product UI. The product is only what's inside the 360×800 phone (or the 1080-wide console chrome).

**Simulated in the prototypes, real in the product:** provider confirmations (timers ≈1–2.5 s stand in for Orange/Moov USSD callbacks), text inputs (tap-to-fill placeholders stand in for keyboards — franc entry must open a numeric keypad), camera/mic/audio (placeholder states — voice notes are **recorded, never synthesized**), and all data.

## Fidelity

**High-fidelity.** Colors, type, spacing, radii, motion durations and copy are final and token-locked. Recreate pixel-perfectly through the token layer: **every value must come from `docs/tokens.json`** (the zero-hardcode CI scan applies). If a value seems missing, it belongs in tokens first.

## Where everything is specified

| Topic | File (bundled) |
|---|---|
| Full token spec (1:1 with ui-tokens groups) | `docs/tokens.json` |
| The system, palette, type, the 7-move layout grammar, state doctrine | `docs/design-system.md` |
| Every component: anatomy · states · sizes @360 · motion · a11y · RN feasibility | `docs/components.md` |
| Flows + failure edges (buyer journey) | `docs/flows.md` |
| Motion law + the three celebrations, storyboarded | `docs/motion.md` |
| Every French string, register-tagged (`money`/`selling`/`neutral`) | `docs/copy.md` |
| Performance accounting vs the D17 budgets | `docs/budget.md` |
| 10 semantic questions awaiting founder ruling — **do not implement these unilaterally** | `docs/proposals.md` |

## Screens / views (what each prototype contains)

**`Sommaire.dc.html`** — index of everything; start here.

**`PWA Acheteuse - Prototype.dc.html`** — C1 product page (default/épuisé/offline) · C2 protections sheet · C3 localisation (zones, repère, voice note: idle/recording/recorded/queued/mic-refused) · C4 delivery (Séra quote, own line, always) · C5 payment (A/B, B-ineligible, submitting, provider-pending; **trust veto: calm**) · C6 confirmation (confirmed/pending-network/offline) · C7 tracking (6 named steps, problem path equal prominence, **never GPS**) · C8 at-the-door (inspect 2–4 min, equal accept/report, leg-2 provider wait) · C9 drop code (hidden until provider-confirmed, then hero scale). Golden path is fully tappable.

**`Hub de Partage - Prototype.dc.html`** — S5 hub (WhatsApp largest target; MODE A link vs MODE B image, visually distinct) · OG link-preview sheet · card composer (story 9:16 / feed 1:1, 2 deterministic templates, ≈40 Ko target, on-device render) · BioLinkRow + code `AÏCHA-4821` · Sa vitrine (public storefront; buyer laws apply). **Blocked on proposals.md §4 (bio attribution) before real build.**

**`Boutik Studio - Prototype.dc.html`** — B4 guided capture (permission ask/refused→gallery fallback, 2-shot héro→preuve, failure strip) · B5 WYSIWYG preview (byte honesty, retake=keep gesture cost) · B6 offer (B & C steppers, live net hero ≤600 ms count-up, waterfall receipt + reconcile line, kind floor refusal at 8 000 F, v2 re-offer) · B7 « Produit prêt » (checklist-gated, submitting→confirmed + **celebration #1**, pending/queued states).

**`Shop Plus - Prototype.dc.html`** — S2 opportunities (net-first cards « VOUS GAGNEZ +2 000 F NET », skeleton at exact row dims, filters, dignified empty, épuisé) · S6 gains (hero count-up, réglé vs en attente + reconcile, **celebration #2 première vente**, encouraging zero state, payout banner) · TabBar (4 items, icon+word).

**`Sera - Prototype.dc.html`** — R4 landmark screen (zone→repère→indications hierarchy, illustration slot, playable voice directions, masked-relay call) · R5 bounded verification (7 objective checks, ✓/✗ 40 px targets, all-ok→seal SC-77 412, custody starts at seal) · R6 dignified refusal (promise first, structured reasons, evidence photo, queued-offline).

**`Console Dispatch - Exceptions.dc.html`** — D4 queue (oldest-first, dwell>2–4 min = amber signal) · one exception open (custody-truth band, lineage, ATTENDU/TROUVÉ diff, evidence) · exactly-one-outcome resolution → append-only journal · SOS banner · calm empty state.

**`Console Ops - Prototype.dc.html`** — claims adjudication with fault-class → payout law · **MakerCheckerBar** (issue ≠ verify, same-identity refused in UI, command auto-applies at 2 signatures — deliberately no "apply" button) · kill-switches with typed-name confirm · append-only audit log with filters.

**`Le Cercle - Design-ahead.dc.html`** — **GATED, no work order**: 3-gesture campaign, K stepper capped at 0.80×(C+M), l'aperçu économique sacré (spend/keep, Séra-always-whole, FULL_PREPAY), single-level parrainage, « attribué » reporting.

**`Celebrations.dc.html`** — the three celebrations live (timings below). **`Icones et Repere.dc.html`** — 26-glyph icon set with measured byte costs + the illustrated landmark card (blue gate = illustration-only token). **`Directions visuelles.dc.html`** — the original exploration (context only).

## Design tokens (essentials — full set in `docs/tokens.json`)

- **Ink** `#1B140D` on **paper** `#FFFDF7` · body `#4A3F33` · muted `#6E6154` · sand `#F3EBDB` · hairlines `rgba(27,20,13,.14/.22/.35)`
- Accents: **Shop+/buyer** `#C2571B` (canon) · **Boutik+** `#1F4D36` · **Séra** amber `#D9A441` on ink · success `#1F4D36` · warning `#6B4E0C`/`#F7EED7` · danger `#B3382C`
- **Type:** Archivo variable (wght 400–900, wdth 75–125), `font-display: optional` on web; body ≥16, labels 800 caps ls 2–2.4, titles 900 wdth 110–112; **`tnum` on every franc**
- Spacing 4/8/12/16/24/34 · radius: boxes 0, buttons 6, chips 4 · touch ≥48 px
- Money format: narrow no-break space U+202F grouping + `\u202fF` suffix; abbreviation forbidden

## Interactions & motion (law — details in `docs/motion.md`)

`transform`/`opacity` only, **never layout**. Press <90 ms (scale .98, opacity .92) · screen enter 240 ms `cubic-bezier(0.2,0.8,0.25,1)` translateY 14→0 · sheets same curve · **no spinners** — pulse bar (scaleX) + skeletons with exact content dimensions · count-ups ≤560 ms outCubic with a settle-to-final-value timer (rAF stalls in background tabs — the prototypes carry this fix; keep it) · celebrations ≤800 ms: halo 700 · ring 620 · 10 motifs 640 (stagger 14) · badge 260 pop, tap-to-skip, non-blocking · `prefers-reduced-motion` = same information, zero movement.

## State management (per surface)

The prototypes' logic classes are readable state-machine references: buyer journey (screen + payment leg + offline flags), share composer (dest/format/template/render idle→rendering→ready→queued/cancelled), offer math (`net = B − C − 0.05B`, floor gate), verification (per-row ok/bad → seal | refusal), exceptions (queue → one open → one outcome → journal append), maker-checker (issued-by ≠ verified-by enforced). **Server truth is law:** no success state before provider/server confirmation; offline actions queue visibly (« C'est noté. En attente du réseau. ») and never claim success.

## Assets

- **Icons:** 26 inline SVGs in `Icones et Repere.dc.html` (source of truth: the `icons()` array in its logic block — copy path data verbatim). Stroke 1.9, round caps, currentColor, ~0.1–0.35 KB each. No emoji, no icon fonts.
- **Landmark illustration:** flat SVG scene (pharmacy/kiosk/blue gate) in the same file, ≈2 KB; palette = system inks + `bleuPortail #33608C` (illustration-only).
- **Product photos:** always user content, sized exactly to slot, sand placeholder at exact dimensions.
- Font: Google Fonts Archivo (subset Latin at build; PWA via `font-display: optional`, RN as bundled static instances — see `docs/budget.md`).

## Acceptance tests (from the brief — every screen must pass)

5-second test sentence written and true · money moments make people calmer · tokens only, zero hardcode · RN primitives / payload gate respected · every state exists (empty/offline/pending/error/success) · money display laws (§8 of the brief: net-first for resellers, commission invisible to buyers, D always its own line, both legs bold, drop code last, tabular + full amounts) · French Voice 6th-grade, register-tagged · motion law · D17 budgets proven · beauty in craft, not effects.

## Files in this bundle

`README.md` (this file) · `support.js` (prototype runtime — reference only) · 12 `.dc.html` prototypes listed above · `docs/` (8 specification files) · **`icons/`** (26 standalone SVGs, currentColor, build-consumable) · **`share-cards/`** (story 9:16 affiche/nuit, feed 1:1, 4:5, OG 1200×630 — deterministic templates, ≤40 Ko rendered target).
