# PROPOSALS — semantic changes for the founder to rule on
### Nothing here is implemented as canon. Each is argued; you decide. · v1.0.0

## 1 · A second delivery window at C4 (« Demain, 9 h – 12 h — 800 F »)
**What the prototype shows:** two Séra quotes — today (1 000 F) and a cheaper grouped next-day window (800 F).
**Why:** a grouped window buys **route density** (the same input la recette Quartier buys) and gives the buyer a real, honest choice; the cheaper number also softens sticker shock on D without hiding it.
**Canon question:** does the Séra quote API express multiple windows? If not, C4 renders one quote and loses nothing.
**Default if refused:** single-quote C4; the design degrades cleanly.

## 2 · `expo-haptics` (one dependency, founder approval required)
Short haptic on: payment confirm, the three celebrations, refusal confirm. Zero frames, zero bytes of UI, makes a 40 000 F phone feel expensive. Deterministic, no data. **Ask:** approve the dependency for the three RN apps.

## 3 · SMS mirror of the drop code
C9 shows « Gardé aussi dans vos SMS — même sans réseau. » — the code survives a dead battery swap to a cousin's phone, app-kill, everything. Requires the payment/SMS provider to send one SMS at provider-confirmation. **Costs money per order; needs a provider contract answer.** If refused: the line is deleted; C9 keeps localStorage persistence only.

## 4 · Bio-link attribution (restating §7.2.1's own flag — blocking for the share hub)
Instagram/TikTok arrivals come through **her vitrine URL or her short code**, not a per-product signed link. If the current signed-token spec cannot express « this reseller, any product, arrived via her identity », the vitrine and share cards cannot pay her. **This must be ruled before the share-hub commission starts** (it is next in the priority order).

## 5 · A named state for « l'opérateur n'a pas confirmé »
The brief specifies submitting → provider-pending → confirmed, but no terminal state for a provider refusal/timeout. Proposed: after ~90 s, « L'opérateur n'a pas confirmé. Rien n'a été débité. Réessayez quand vous voulez. » (register `money`) with a single retry action — never blaming her, never « échec ». **Ask:** confirm the 90 s figure and whether the provider distinguishes refusal from timeout.

## 6 · Drop code format: 6 digits, grouped « 734 921 »
Sayable in French in two breaths, typable on any keypad, hero-scale legible in sun. If canon already fixes another format, the DropCodeDisplay component is format-agnostic (it renders grouped tnum digits at `money.amountScale.hero`).

## 7 · Body-size token vs. the web prototype
Canon says body ≥ 16 dp. The 360 px web mockups rendered some body copy at 15 px. `tokens.json` sets `type.scale.body = 16`; production must follow the token, and the prototype is the only artifact allowed to drift (it is a picture, not a build).

## 10 · `react-native-svg` for the icon set (one dependency)
The 26 drawn glyphs replace the emoji. On the PWA they're inline (free). On the three RN apps the clean path is `react-native-svg` (bundled with Expo SDK 54's ecosystem, deterministic, no network). **Ask:** approve it alongside §2's haptics; the fallback is pre-rasterized PNG icons per density — heavier and uglier.

## 9 · One illustration-only colour: « bleu-portail » (#33608C)
The landmark illustrations must depict real objects — and Ouagadougou gates are blue. The chrome palette stays untouched; `landmark.illustration.bleuPortail` exists only inside landmark SVG art. **Ask:** confirm, or the gates go ink-outline only.

## 8 · The « ÉCOUTER » affordance without recorded audio
Voice notes are **recorded, never synthesized** (law). Payment options C5 each carry a listen chip — those notes must be recorded by a real voice (founder's or a trusted seller's) before C5 ships. Flagged so nobody ships a silent button or, worse, a TTS shortcut.
