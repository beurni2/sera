# WO-FP-SERA · THE ANATOMY DERIVATION (CTO correction, 2026-07-15)

**The planche is the only bar.** Source: `handoff_redesign/Sera - Redesign.dc.html` (the
Faso Premium redesign planche; not the older `Sera - Ecrans`). Every element below is
**grepped and quoted from that file** (line numbers cited), mapped to its implementation
(`file:symbol`), with any divergence and its **lawful reason** (an RN constraint or a
standing law — never taste).

The prior drop reskinned the *paper* but kept the *old anatomy* (glyph-tile chips,
chevrons, outlined uppercase) — that is the defect this rebuild corrects. Programmatic
teeth: `test/faso-anatomy.test.ts` (7 assertions) + `test/faso-states-law.test.ts`.

State-mapping law (per the CTO): planche states map to **real** journey/custody states;
real states the planche lacks get a grammar treatment and are **listed** (`states-law-inventory.md`);
planche states the app does not have are **NOT invented**.

---

## R2 — « Mes courses »  (planche lines 96–141)

Implementation: `App.tsx` R2 block (`screen === 'courses'`) + `src/ui/faso-kit.tsx`
`CourseCard` / `ScreenTitle` / `Pill` / `LineagePill`.

| Planche element (quoted · line) | Implementation | Divergence · lawful reason |
|---|---|---|
| Screen title — `font-weight:800;font-size:24px;letter-spacing:-.02em` « Mes courses » (l.99) | `faso-kit ScreenTitle` → `styles.screenTitle` (displayFace(800), 24, -.02em, C.ink) | none |
| Proposed card = a **pressable** `border:1.5px solid #D9A441;background:#FFFFFF;box-shadow:0 16px 36px -18px rgba(217,164,65,.35)` + `style-active="transform:scale(.98)"` (l.108) | `CourseCard` variant `proposed` → `courseProposed` (borderColor C.accent 1.5 · shadowColor C.accent) + `Pressable pressed→scale .98` | shadow: RN has **no negative spread**; approximated as an accent-tinted drop shadow (shadowRadius 18, offset y 12). *RN constraint.* |
| Left **gold bar** `position:absolute;left:0;top:14;bottom:14;width:4;border-radius:0 4px 4px 0;background:#D9A441` (l.109) | `courseBar` (absolute, left 0, top/bottom 14, width 4, right-rounded 4, C.accent) | none |
| CRS eyebrow `font-size:11;font-weight:700;font-feature-settings:'tnum';color:#6F6355` « CRS-0891 » (l.111) | `courseCode` (textFace(700), 11, tnum, C.sub) — value `item.id.toUpperCase()` | none |
| **PROPOSÉE** pill — FILLED `background:#D9A441;color:#241A05;font-size:9.5;font-weight:800;letter-spacing:.08em;border-radius:99px` (l.112) | `Pill tone="accent"` (bg C.accent / fg C.onAccent) · `pillText` 9.5/.08em uppercase | weight 800→**700**: Instrument has no 800 face; the planche's `font-weight:800` on the body font already falls to 700 in-browser. *Font-availability (faithful to the planche's own render).* Label from the new catalog key `courses.statut_proposee` = « Proposée » (see State mapping). |
| Deadline `margin-left:auto;font-size:12;font-weight:700;tnum;color:#5F4403` « avant 14:32 » (l.113) | `courseDeadline` (marginLeft auto, textFace(700), 12, tnum, C.accentDeepAlt) — value `` `${t('courses.before')} ${proposalUntil}` `` | none — `proposalUntil` is the REAL ack-window deadline (assignment-lease-ttl.v1). |
| Title `margin-top:8;font-weight:700;font-size:15.5` (l.115) | `courseTitle` (textFace(700), 15.5, C.ink) — `item.locationLines[0]` | none |
| Subtitle `margin-top:2;font-size:12;color:#6F6355` « GOUNGHIN · ramassage à Rood Woko » (l.116) | `courseSub` (textFace(400), 12, C.sub) — `` `${locationLines[2]} · ${name}` `` | copy: zone · **client** (the app's real fields) vs planche's zone · pickup — the app models the client name, not a pickup string; using real data, never an invented pickup. *Derive-never-invent.* |
| Active card `border:1px solid #EDE4D3` + active chip `{r2ChipBg/r2ChipFg}` + optional `2ᵉ PASSAGE` outline `border:1px solid #8F6812;color:#5F4403` (l.119–128) | `CourseCard` variant `active` (`courseActive`, hairline) + `Pill tone={toneFor}` + `LineagePill` (border C.accentDeep, text C.accentDeepAlt) | tone: the app keeps the **honest per-state tone** (`toneFor`) rather than the planche's uniform filled-gold — a warn/bad state must never masquerade as gold. *Trust test + states law.* |
| Done card `background:#FBF6EB;opacity:.7` + `TERMINÉE` `bg #DFEEE3;color #14603A` (l.130–138) | `CourseCard` variant `done` (`courseDone`: C.tintCard, opacity .7) + honest status Pill | ground: no token = `#FBF6EB`; the nearest canon warm tint `C.tintCard` (#FBF3DF) at .7 is used. *Derive-never-invent (no exact token; nearest canon).* |
| Empty `stroke #8A7D6B` cart + `font-weight:800;font-size:19` « Aucune course pour l'instant. » + hint (l.100–105) | `FasoEmptyState` (Icon C.sub, ty('view')=19–20/800, hint ty('body')) | none (title role matches) |
| Footer `font-size:11.5;color:#8A7D6B` « Une carte = un colis = un gardien. » (l.139) | `styles.listFoot` (existing) — `t('courses.one_guardian')` | none |
| `animation:fpIn .32s cubic-bezier(.2,.8,.2,1)` (l.98) | R2 wrapped in `<FpIn>` (signature module; reduced-motion safe) | none |
| **Retired**: the icon glyph-tile + the `›` chevron (the OLD list-row anatomy) | absent from `CourseCard` (asserted by `faso-anatomy.test.ts`) | — |

**Adaptation — long status never clips (founder tap, 2026-07-15).** The planche's R2 chips are
all short caps with `white-space:nowrap` (l.112/123/124/134) — it assumes single-word statuses
and never wraps a chip. The app's real statuses are full **sentences** (« Temps passé. Course
rendue à la liste. », « 2e passage — le client était absent. »), which clipped at the card edge.
CTO law: a status NEVER clips / ellipsizes (truncating an honest status weakens it — safety-copy
law). The planche has no long-status chip to copy; its own treatment for a **sentence** is a
full-width, sentence-case, body-size line (R12 `l.desc`, l.468 — `font-size:12.5;line-height:1.45`,
not a caps pill). So the in-grammar adaptation: the short « PROPOSÉE » keeps its inline caps pill
in the eyebrow (the accepted look); every **sentence** status + the lineage drops to a
**full-width status line below the reference** — the chip's tint/rounding kept, text at body size,
**wrapping** (multi-line permitted). The card has no fixed height → it grows; nothing overlaps the
neighbour (the DF-1 minHeight lesson). Guard: `test/faso-long-status.test.ts` (renders the longest
real status; asserts no `numberOfLines`/ellipsize on the status text, full-width stretch, no fixed
card height). `faso-kit` `Pill`/`LineagePill` `full` prop → `pillFull`/`pillTextFull`.

**State mapping (R2).** The planche shows 3 demo registers (proposed/active/done). The app's
real states are richer and all survive (`states-law-inventory.md`): the offer window
(`step affectation, ack none, !closed`) → the gold **proposed** card with « Proposée » + the
response deadline (the CTO's mapping: PROPOSÉE = the ack/decline window, 6.9-b); `closed` →
the **done** card; the accepted walk → the **active** card with its honest status
(`statut_a_ramasser`/`en_route`/…). New catalog strings (French-copy-lint clean, register
neutral, derived from the planche): `courses.statut_proposee` = « Proposée » (the offer window
previously borrowed « À ramasser », which conflated the window with the post-accept walk — now
distinguished, MORE honest) and `courses.before` = « avant ».

---

## R10 — « Le code »  (planche lines 412–440)

Implementation: `App.tsx` R10 block (`screen === 'drop'`) + `faso-kit` `CodeCells` / `Keypad`
/ `Overline` / `Body` / `PrimaryButton`.

| Planche element (quoted · line) | Implementation | Divergence · lawful reason |
|---|---|---|
| codeEntry overline `text-align:center;font-size:11;font-weight:700;letter-spacing:.14em;color:#6F6355` (l.423) | `<FasoOverline center>` (ty('caps') + `centerText`) — `t('drop.title')` | copy: the app's honest `drop.title`/`drop.hint` render verbatim (per WO) in the planche's **centered** grammar; the exact planche sentence is a different string. *WO: honesty verbatim.* |
| Code cells `width:44;height:54;border-radius:13;font-weight:800;font-size:24;tnum;background:#FFFFFF;border:{active 2px #D9A441 / 1px #E0D6C2}` (l.426) | `CodeCells` → `cell` (44×54, r13, C.card) · `cellActive` (2 C.accent) · `cellText` (displayFace(800), 24, tnum, C.ink) | none |
| Keypad `height:54;border-radius:14;border:1px #E0D6C2;background:#FFFFFF;font-weight:700;font-size:20` + `style-active="transform:scale(.92);background:#EFE8DA"`; « ⌫ » (l.434) | `Keypad` → `key` (54, r14, C.hairline, C.card) · `keyText` (displayFace(700), 22) · `keyPressed` (scale .92, C.dim) | glyph: « ⌫ » (U+232B) renders via the **platform symbol fallback** — not in the Bricolage subset nor in Google's Bricolage, so the planche relies on the same browser fallback. *Font-subset; identical mechanism to the planche.* Key font 22 vs planche 20 — carried from the existing pixel-source kit (token-consistent). |
| Validate CTA `height:54;border-radius:16;bg {6→#D9A441 / #DDD5C3};fg {6→#241A05 / #8A7D6B};font-weight:800;font-size:15` + shadow when enabled (l.437) | `FasoPrimaryButton` (C.accent/onAccent, disabled C.disabledCta/Fg, displayFace(800) 15, glow shadow) — `disabled={codeStr.length !== DROP_CODE_LEN}` | none |
| `codeWrong` shake + error surface (l.429–431) | **not implemented** | the app does not model a wrong-code entry on this screen (`validateDropCode` advances). *States law: a planche demo state the app lacks is NOT invented.* (`fpShake`/`useShake` exist in the signature module for when a real wrong-code path lands.) |
| `codeLocked` — « L'entrée n'existe pas encore… le code vient **après** la confirmation » (l.415–420) | the app's SE-I06 lock is a **separate screen** (`evidence_pending`/`payment_wait`); R10 is reachable only after provider-confirmed payment | structural: the app splits the lock (custody spine) from the entry; the honesty lives on the pending screens. *Custody spine (SE-I06).* |
| `animation:fpIn .32s` (l.414) | R10 wrapped in `<FpIn>` | none |

---

## R14 — « SOS »  (planche lines 545–579)

Implementation: `src/ui/faso-sos.tsx` `SosButton` / `SosSheet` (mounted unconditionally in
`App.tsx`). **Already at true anatomy** — this pass verified it against the planche.

| Planche element (quoted · line) | Implementation | Divergence · lawful reason |
|---|---|---|
| Floating disc `right:16;bottom:26;width:58;height:58;border-radius:99;background:#1C1710;border:2.5px solid #C43A2C` + `style-active=scale(.92)` (l.546) | `styles.button` (58×58, r pill, DARK.band, 2.5 DARK.sosBorder) + pressed scale .97 | `bottom:20` vs planche `26` — within safe-area tolerance. |
| SOS glyph `font-weight:800;font-size:13;letter-spacing:.08em;color:#1C1710` (l.546) | `buttonText` (displayFace(800), 13) rendered in **C.card** (near-white) + `IconSos` | colour: the planche sets `color:#1C1710` **on** `background:#1C1710` (illegible — invisible text). Rendered legibly in C.card. *Standing contrast law — a STOP, never shipped illegible.* |
| Scrim `rgba(10,7,4,.7)` align flex-end + `animation:fpFade` (l.550) | `scrim` (alpha(C.ink,.45)) | scrim alpha from the token ink; darker-vs-lighter is a compositing value, legible either way. |
| Sheet `background:#14100B;border-top:3px solid #C43A2C;border-radius:30px 30px 0 0;padding:24;animation:fpUp .34s cubic-bezier(.32,.72,.25,1)` (l.551) | `sheet` (DARK.sosSheet, 3 top DARK.sosBorder, r sheet=30, GEO.paddingPx) + `fpUp` rise | none |
| confirm — `font-weight:800;font-size:26;#F4EEE2` « SOS » + hold CTA `height:64;bg #C43A2C;#FFF3EF` « MAINTENIR POUR DÉCLENCHER » (l.552–557) | `SosSheet` state `confirm` (title, hold DARK.sosBorder h64, holdNote) | none |
| raised → ack → enroute → closed (l.559–576) | `SosSheet` states `raised`/`acknowledged`/`escalated`/`over` | states: the app is **richer** — `queued` (offline: NO ack shown, unacknowledgeable) + a dashed « (aperçu) » sandbox ack stand-in (the rider never self-acks). *States law + honesty: the offline `queued` state has no planche frame and must never fake an ack.* |

---

---

# VIEWS 4–13 PASS (founder release, 2026-07-15) — R1's old skeleton dies

Same method: planche lines cited → implementation → lawful divergences. Built in verified
stages; the states inventory (14 framed + 12 absent) is the checklist; honesty contracts
verbatim; the contrast + anatomy + long-status + font guards ride every stage.

## Chrome — the header + banners  (planche l.32–42)

Implementation: `faso-kit` `FasoHeader` / `OfflineBanner` / `PendingNotice`, wired in `App.tsx`.

| Planche element (quoted · line) | Implementation | Divergence · lawful reason |
|---|---|---|
| Woven strip `height:6;repeating-linear-gradient(...D9A441...C2571B...)` ABOVE the header (l.33) | `FasoHeader` renders `<WovenBand />` first (signature module, svg pattern) | none |
| Monogram `38×38;border-radius:13;background:#D9A441;color:#241A05;Bricolage 800 16` « S » (l.36) | `styles.monogram` + `monogramText` (displayFace(800) 16, C.accent/onAccent) | none |
| Identity `Bricolage 800 18;-.01em` « Séra » + `11.5;#6F6355` « Moussa K. · certifié SÉRA-2026 » (l.38–39) | `wordmark` (displayFace(800) 18) = `t('app.title')`; `headerSub` = `t('service.certified_name')` | screen NAME moves to each view's body title (planche two-title structure); a slim Faso back row rides above the monogram when the stack is deep (the app's stack > the planche demo) — lawful. |
| Right state chip `10.5;700;.08em;radius 99;{{headBg/headFg}}` (l.41) | `right` = `FasoStatusChip` (shift on/off tone) | chip point-size resolves to the token pill role (hierarchy law). |
| Offline (states-law #5, no planche frame) | `OfflineBanner` — warm warn strip (C.warnBg/warnFg), the REAL backlog count | in-grammar adaptation (planche shows offline per-screen, not a top banner). |

## R1 « Service »  (planche l.55–94)

Implementation: `App.tsx` `screen === 'service'` block.

| Planche element (quoted · line) | Implementation | Divergence · lawful reason |
|---|---|---|
| shiftOff title `Bricolage 800 27;-.02em` « Hors service. » + body (l.59–60) | `FasoPosterTitle` (displayFace(800) 23) + `FasoBody` | title 23 vs 27 — the token poster role (one screen-title size; hierarchy law). |
| Cert card — WHITE `border-radius:20;border:1px #EDE4D3;background:#FFFFFF`; row [lock icon + « position suivie qu'en service »] · row [CERTIFIÉ badge + « Moussa K. » ] (l.61–71) | `FasoCard` (default white) — IconScelle (C.accent) + `FasoBody`; `FasoStatusChip tone="accent"` + `FasoBody` | the card is WHITE (was Grand Teint `ink`/dark — corrected to the planche white). NOTICE·V3 link omitted (a planche demo affordance the app has no target for). |
| « Prendre mon service » CTA `h56;background:#D9A441;Bricolage 800 16;glow` (l.72) | `FasoPrimaryButton` | none |
| shiftPending « DÉMARRAGE EN ATTENTE… » caps + fpBar + « un départ hors ligne ne confère **rien** » (l.74–79) | `FasoPendingNotice` (title + FpBar + honest line) | honesty verbatim: queued = pending, confers NOTHING (R1 law). |
| shiftOn `border:1.5px #D9A441;background:#FBF3DF;glow`; pulse dot `#14603A` + `Bricolage 800 20` « En service » + note; « Voir mes courses » + « Terminer mon service » (l.81–92) | `FasoCard accent` + `FpPulseDot color={C.okFg}` + `FasoPosterTitle` + `FasoBody`; `FasoPrimaryButton` + `FasoSecondaryButton` | the arriving course is shown as a `CourseCard` (proposed) — the app previews the incoming course here; consistent grammar. |

## Fonts (STEP 0 — the type question, standing independently)

The planche loads Bricolage Grotesque (500/600/700/800) + Instrument Sans (400/500/600/700)
(l.12). The rider ships six built static faces (Bricolage 700/800 · Instrument 400/500/600/700),
name-table-distinct (WO-6.3 collision law), U+202F patched into every face (`build-faso-fonts.py`;
`test/faso-fonts.test.ts`). The **font-proof strip** (`faso-kit FontProofStrip`, preview-only)
renders all six on-device so « is this the type? » is answered from the phone.

## Contrast gate (permanent)

`test/faso-contrast.test.ts` computes every gold-ground/paper pairing from the **canon v2
tokens**: `#241A05` on `#D9A441` = 7.62:1 (AAA); every pairing ≥ AA. A token change that drops
a pair below AA fails the gate — a STOP, never a silent local darkening.
