# COMPONENTS — the Grand Teint kit
### Every component: anatomy · states · sizes @ 360 dp · motion · a11y · RN feasibility · v1.0.0

Conventions used below — **tokens** are from `docs/tokens.json`; "hairline box" = border `hairline.medium` (1.5) `hairlineStrong`, radius 0; "ink box" = border 2 `ink`; every interactive part: press = `pressScale` + `pressedOpacity` < 90 ms; disabled = `disabledOpacity` + explicit label; every component ships a skeleton with **identical dimensions**; reduced-motion = state change with no transform. RN = `View/Text/Pressable/FlatList/Image` only. All type sizes reference `type.scale`; all money is `tnum`.

---

## Core kit (replaces the shipping components)

### AppHeader
- **Anatomy:** app wordmark caps `labelLG` ls 1.8 + context (right, `caption` muted) · bottom `hairline` · **ThemeBand** 4 px `themeStrip` below.
- **States:** default · sandbox (ribbon above) · offline (OfflineBanner below).
- **Size:** h 44 + 4 band; pad x 16.
- **Motion:** none (anchor of stability).
- **A11y:** role header; wordmark is text, not image.
- **RN:** View + Text + border. ✓

### ThemeBand (was « woven tri-colour band »)
4 px full-width `themeStrip` fill. One per screen, under the header. The tri-colour weave is reserved for celebrations — chrome stays quiet. RN: View. ✓

### Card → **HairlineBox**
- **Anatomy:** hairline box; rows inside divided by `hairline.thin`; optional 2 px ink variant for money/summary.
- **States:** default · selected (see OptionCard) · pending (warningTint header strip) · skeleton (sand blocks, exact row heights).
- **Size:** margin x 16; row pad 11–12.
- **RN:** View borders. ✓ No shadow, elevation 0.

### ListRow
- **Anatomy:** icon 17 (`ink`) + label `row` + optional right value (`tnum`) or chevron; bottom `hairline.thin`.
- **States:** default · pressed · disabled · destructive (`danger` text + icon) · skeleton.
- **Size:** **fixed h 44** (list virtualization law); pad x 16.
- **RN:** Pressable, `getItemLayout` friendly. ✓

### PrimaryButton
- **Anatomy:** full-width block `radius.button`; label `label` caps ls 2.2 `onInk`/`onPrimary`; fill `ink` (structure) or theme `primary` (money commitment).
- **States:** default · pressed · **disabled with explanatory label** (« CHOISISSEZ POUR CONTINUER ») · loading (label persists + 3 px `gtBar` scaleX pulse underneath — no spinner) · offline (action queues; PendingNotice appears).
- **Size:** h 56; margin x 16. Hit ≥ 48.
- **Motion:** press ≤ 90 ms.
- **RN:** Pressable + Animated scale (native driver). ✓

### SecondaryButton
Hairline 1.5 `hairlineStrong` box, ink label; danger variant: `danger` border/text (equal-prominence problem paths). h 50–56. RN ✓.

### GhostButton → **UnderlineLink**
Caps `labelXS` `primaryStrong` + 1.5 px underline gap 2. For tertiary verbs (MODIFIER, REFAIRE, REVENIR…). Hit area padded to 44. RN: Text in Pressable. ✓

### AmountHero
- **Anatomy:** caps label `labelXS` muted above; amount `money.amountScale.hero|page` `tnum`; optional honesty note `caption` below.
- **States:** static · **count-up** (≤ 560 ms outCubic, digits tabular) · pending (amount muted + « en attente » chip — never green).
- **Size:** hero 52, page 40.
- **RN:** Text + Animated value → setNativeProps/text. ✓

### PriceBand ⭐ (new — the signature)
Full-width theme `primary` block: `labelXS` in `primarySoft` + amount 38–40/900 `onPrimary` `tnum` + right-column honesty note (`caption` `primarySoft`, w 118). States: default · muted (out-of-stock: fill `soft`). h ≈ 88. RN: View+Text. ✓

### StatusChip
Square chip `radius.chip`, caps `labelXS`: filled ink (fact) · hairline (neutral) · warningTint/warning (pending) · dangerTint/danger (problem) · `primary` filled (celebratory fact, e.g. PREMIÈRE VENTE !). Never a green lie: success fill only after server truth. h 22–26. RN ✓.

### Skeleton
Sand blocks (`skeleton.bg`), opacity pulse 1↔0.4 @ 1.1 s. **Must clone the exact box of its content.** Screen-level: status bar + header render real; content skeletonizes. RN: Animated opacity. ✓

### EmptyState
Icon 28 `soft` + one sentence `body` + one action (Primary or Underline). Never sad copy; states the next act. RN ✓.

### PendingNotice
WarningTint band, `warning` text + clock icon: « C'est noté. En attente du réseau. » Appears wherever an action queued; dismisses itself on sync (fade 150 ms). RN ✓.

### Banner (sandbox)
`ribbon.sandbox` tokens: 24 px striped band, caps label. Survives every screen incl. sheets (z above scrim). RN: View. ✓

### OfflineBanner
Ink band h 30, `onInk` caption + wifi-off icon. Global, under header. RN ✓.

### TabBar
4 items max; icon 20 + word `labelXS` (icon+word law); active = ink + 2 px top indicator; inactive `soft`. h 56 + safe-area. Pressed <90 ms. RN: SafeAreaView+Pressable. ✓

---

## Commerce & capture

### SearchField
Hairline 1.5 box h 50: search icon 17 + placeholder `body` `soft` + (typing) clear ×. States: idle · typing · results-count line · no-results (dignified: « Rien pour “sac cuir” — essayez un mot plus simple. »). RN: TextInput in View. ✓

### FilterChips
Wrap row gap 7; chip = zone-chip style (hairline; selected = ink fill `onInk`). Single or multi. Fixed h 36. RN: Pressable row, horizontal FlatList if > 8. ✓

### ProductCard (premium frame — Boutik+/Shop+ signature)
- **Anatomy:** photo slot (sand bg, **corner ticks ×4**, exact aspect 4:5) + caption bar « Photo réelle — ce que vous recevrez. » + name `title` + PriceBand-mini or row amount + StatusChip.
- **Shop+ variant law:** leads with « Vous gagnez 2 000 F net » (net first, always).
- **States:** default · loading (photo skeleton, ticks persist) · paused/out-of-stock (ÉPUISÉ overlay chip, band muted) · pressed.
- **Size:** grid 164×246 or list row h 96 (fixed heights for virtualization).
- **RN:** Image sized exactly to slot; ticks are 4 absolute Views. ✓

### CategoryPicker
9 capture-guidance categories as icon+word tiles 104×88, hairline; selected = ink fill. Grid 3×3, gap 8. RN ✓.

### CameraOverlay (B4 — the camera IS the screen)
- **Anatomy:** live viewfinder full-bleed · **frame guides** = corner ticks scaled to category aspect · guidance line in ink-on-paper strip (« Posez le sac debout, fermeture visible. ») · shot indicator « 1/2 HÉRO → 2/2 PREUVE » caps · shutter 72 px ring bottom-center (thumb reach), h-area 96.
- **States:** permission-asking (plain-French ask) · **permission-refused** (honest fallback: import from gallery + « ça marche aussi ») · framing · capturing (ring contracts 90 ms) · **failure** (« La photo n'a pas pu être prise — réessayez. » + one retry).
- **Motion:** shutter press scale .94; capture blink ≤ 120 ms opacity.
- **A11y:** all guidance text ≥ 16; shutter ≥ 72.
- **RN:** expo-camera (already shipped) + absolute Views. ✓

### PhotoPreview (B5 — « Ce que l'acheteur verra »)
Exact bytes that will ship, rendered inside ProductCard's premium frame at final size. Two equal buttons: REPRENDRE (hairline) / GARDER (ink) — same gesture cost. States: preview · retake · confirm-pending (offline queue). RN ✓.

### ReceiptCard / PriceBreakdown (staged as proof)
Ink box table: product line · « Livraison Séra — jamais cachée » · TOTAL row (1.5 px top border, 900) · **reconcile line** under the box (`money.reconcileLine`): « 12 500 = 11 500 + 1 000 — chaque franc a sa place. » Seller variant heroes « Vous recevrez 8 500 F ». States: default · pending amounts (muted + chip) · settled. RN ✓.

### AmountInput (franc entry)
Hairline 1.5 box h 56; amount `page` scale `tnum` right-aligned; « F » suffix fixed; opens **numeric keypad** (`keyboardType="number-pad"`); keyboard never covers the CTA (screen scrolls, CTA pinned above keyboard). States: empty (0 muted) · typing · **below-floor refusal** (kind: « Le prix plancher de cette catégorie est 4 000 F. » — warningTint, never red-scold) · live-net recompute (count-up on the linked « Vous recevrez » hero). RN: TextInput. ✓

### VoiceNoteRecorder
Idle: hairline btn mic + « ENREGISTRER LE REPÈRE ». Recording: ink block, pulsing red dot 10 px + mm:ss `tnum` + ARRÊTER chip. Recorded: play btn 38 ink + static waveform SVG + duration + REFAIRE link. Queued-offline: PendingNotice inline. Mic-refused: sand box, honest text fallback. Max 30 s. RN: expo-av (shipped) + Views. ✓

### AudioNotePlayer (the § listen affordance)
Inline chip: filled play triangle 11 + caps « ÉCOUTER LA NOTE » underline `primaryStrong`; playing = pause glyph + thin progress underline (scaleX). House standard wherever money is explained. RN ✓.

---

## Trust, custody & delivery

### LandmarkCard ⭐ (the FIERTÉ ceiling — illustrated version commissioned separately)
Structure now, art later: sand box 2 px ink border · zone caps `landmark.zone` · **repère** `landmark.repere` · indications `landmark.indications` · voice row (AudioNotePlayer) · MODIFIER link. Rider variant (R4): repère at 24/900, quartier icon slot 56×56 (SVG, from icon debt), masked-relay call row. States: default · playing · relay-calling. RN ✓.

### Timeline (C7 / order tracking)
Fixed-rhythm rows: dot column (done: ink-filled + white check · current: 2 px `primary` ring + dot + MAINTENANT chip · future: hairline ring, 45 % title) + 2 px connectors (ink where passed). **Never a map, never GPS.** Row h ≈ 64 fixed. RN: Views; no measurement. ✓

### ChecklistItem (R5 bounded verification)
Check square 17 + objective label `row` (ref, product, model, colour, size, count, damage, seal — **never authenticity/quality**). States: unchecked · checked (ink fill 150 ms) · **mismatch** (danger border + « ne correspond pas » → feeds Le refus). h 48. RN ✓.

### SealCard (R7)
Ink box: seal icon + seal ref `tnum` + « La garde commence au scellé. Pas une seconde avant. » States: pre-seal (hairline, CTA SCELLER) · sealing (pending) · sealed (ink fill header + timestamp). RN ✓.

### DropCodeDisplay (C9/R10)
2 px ink frame + **terracotta corner ticks ×4** + code `hero` 52/900 `tnum` ls 6, grouped 3+3. States: **hidden** (lock icon + « ••• ••• » + « jamais avant » line) · revealed · (rider R10: entry variant = 6 AmountInput-style cells + VALIDER). Provider-confirmation is the only unlock. RN ✓.

### CelebrationLayer
See `motion.md` (storyboards + tokens `celebration.*`). Absolute overlay, tap-to-skip, self-removes ≤ 860 ms, zIndex above content, **never blocks input** (underlying state already true). RN: Animated transform/opacity, native driver. ✓

### OptionCard (payment A/B, delivery windows)
- **Anatomy:** box; selected = 2 px ink border + **5 px accent edge** + 26 px ink corner check; unselected = hairline 1.5. Icon (cadenas/moto) + caps title + description with **both amounts bold `tnum`** + AudioNotePlayer chip.
- **States:** unselected · selected · **ineligible** (surfaceMuted bg, content 45 %, one dignified sentence full-opacity) · pressed.
- **Size:** pad 14 (21 left when edged); min h 96.
- **Motion:** border swap 150 ms; no bounce (trust veto).
- **RN:** Views + absolute edge/corner. ✓

### RightsSheet (C2 « Vos protections »)
Bottom sheet: paper, 2 px ink top border, handle 44×4; 4 icon+title+line rows; COMPRIS h 52. Enter translateY 240 ms springSoft; scrim `scrim` 200 ms. Reachable from C1 + C7. RN: Modal+Animated. ✓

---

## Console & ops (web, vanilla TS — same tokens)

### AlertRow
Hairline row h 44: severity square 10 (ink/warning/danger) + message `row` + age `tnum` right. Quiet by default; dwell > 2–4 min auto-escalates to warning. States: quiet · signal · SOS (danger fill row — the only filled row in the console).

### ExceptionCard (D4 — the most important screen in the building)
Ink box: structured reason caps + evidence list (photo refs, voice, checklist diff) + order lineage line + **exactly one outcome row**: RETRY · REPROGRAMMER · RETOUR · INCIDENT (SecondaryButton set; no free-text resolution, no generic « failed »). States: queued · open (expanded) · resolved (ink header + who/when).

### MakerCheckerBar (ops money/custody actions)
Two halves, visibly separate: « ÉMIS PAR — payment operator » / « VÉRIFIÉ PAR — dispatcher », each with its human + timestamp; the bar physically cannot render both halves for one identity (UI enforces the law: **nobody holds both halves**). States: pending (half-filled) · issued · verified. The commit control stays disabled until both halves carry different names.

### AuditRow (append-only log)
Monospace ref + who/what/why/when/order + evidence link. No edit affordance exists — **there is no editable state to design**. Filter chips above; rows h 40 fixed.

### KillSwitchToggle
Row: capability name + scope + ink switch; flipping requires typed confirmation of the capability name (no one-tap catastrophe); every flip writes an AuditRow. States: on · off · pending-confirm.

### EmptyQueue
The console's EmptyState: « File vide. Tout est à sa place. » — calm is a designed outcome, not an absence.

---

## Icon set (the drawn debt — spec)
26 glyphs (list in `tokens.json → landmark.iconNames` + camera/retake/eye/key/chevron/phone): 24 viewBox, stroke 1.8–1.9 round caps, single colour `currentColor`, geometric-warm (the prototype's cadenas/moto/bouclier/micro/paquet/horloge/œil/clé are the reference drawings). Budget ≤ 0.35 KB each inline. Emoji are banned from chrome.

## Share kit (§7.2.1 — next commission; reserved names)
`ShareHub` · `ShareCardPreview` · `ShareCardComposer` · `BioLinkRow` · `ShortCodeChip` · `SaVitrine` — designed after the founder rules on proposals.md §4 (bio attribution). The share card templates will be built from PriceBand + premium frame + ShortCodeChip, deterministic, no commission ever rendered.
