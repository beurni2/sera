# WO-6.1 REVIEW PACKET — Séra rider app + dispatch console on Grand Teint

Branch `e6/wo-6.1` · 3 commits ahead of `main`:
- `0bc2ffd` chore: pin bump to canon v0.9.0 (#fa2ff24), lockfile, /docs → 11-doc manifest
- `3d192ee` feat: LE VISAGE on Grand Teint (rider RN + dispatch console)
- `e73105e` chore: complete pin bump — services/* @platform/* → fa2ff24 (CTO fix)

## Contents
- `WO-6.1.diff` — the full diff (`git diff main...HEAD`), 35 files, +3331/-994.
- `WO-6.1-verifier-brief.md` — the fresh-context verifier's charge (spec quotes + DoD + 8 probes).
- `WO-6.1-verifier-verdict.md` — the verifier's report, verbatim.
- `../gallery/gallery.html` — the dispatch-console visual gallery (web/Playwright; the rider-app RN channel is `apps/rider-app/WALKTHROUGH.md` + Expo Go, honestly gapped in `states.json`).

## CTO self-verification (by my own hands, this session)
All grounded in tool results:

### Hard gates (🔴)
- **R9 rider CANNOT assert payment (SE-I11)** — `payment_wait` (App.tsx:618) has no
  TextInput/field/toggle; the only forward action passes the CONSTANT
  `SANDBOX_DOOR_SIGNAL`; the store's `applyProviderDoorSignal` (store.ts:239)
  `expectStep(['payment_wait'])` and throws on any value outside the signal type.
- **R10 drop code LOCKED until provider-confirmed** — `CodeCells`+`Keypad` exist
  only on `drop` (App.tsx:642, one instance each); spine makes `drop` reachable
  only via `stepAfterDoorSignal('confirmed')`; `validateDropCode` guards
  `expectStep(['drop'])`.
- **R14 SOS one gesture, any screen, not accidental** — `<SosButton>`+`<SosSheet>`
  mounted unconditionally outside every `screen ===` branch (App.tsx:815); one
  tap opens, firing needs a deliberate hold (holdTimer setTimeout).
- **R13 two-key return** — `attemptReturnHandover` returns `'released'` only with
  both keys (two-key-return.ts); final confirm `disabled` until both; rider key
  refuses when seller key absent (App.tsx:750,766).

### Money / custody
- NO franc anywhere in Séra — `wo6-invariants.test.ts` FRANC regex over 5 surfaces = null.
- U+202F only in the seal ID `SC-77⟨U+202F⟩412` via `money.groupSeparator` (App.tsx:336) — not a franc.
- Spine byte-identical (journey.ts / custody-flow.ts / demo/store.ts unchanged vs main).
- `refusal-ladder.ts` `conformity_mismatch:'seller'` — grounded (SE4.2), fault-attribution only, OUT of retry ladder, type-completeness over v0.9.0 enum.

### Craft / DoD
- typecheck rider-app + dispatch-console: 0 errors (both "Done").
- copy-lint: rider 137/0, console 32/0.
- CLS=0: native driver only, no LayoutAnimation, no `useNativeDriver:false`.
- Font at first frame: expo-font config plugin + 5 Archivo .ttf present (~34KB each).
  *Rendered-RN-pixel proof (font visual + U+202F narrow space) needs the founder's
  Expo Go device — RULING ② accepted native embedding as the mechanism.*
- R4 §4 signature: real illustrated `LandmarkIllustration` SVG (pharmacy/kiosk/portail,
  `landmark.illustration` tokens, from the design bundle) — WO-4.1 placeholder debt paid.
- R8 door-arrival: realized on the existing `door_inspection` spine node (compact
  LandmarkCard, "repère never street address") — no state dropped.
- Gallery byte-stability: `gallery/img/` gitignored (deterministic 800×950 +
  reduced-motion regen); descriptors tracked; tree clean.
- `run-gates.sh` EXIT 0 — all positives pass, every negative fixture fails as required;
  custody-service 55 tests + both §3 mocks 8/8 CERTIFIED.

## Open item for the founder (not a defect)
Rendered-RN visual proof (font-at-first-frame + U+202F seal-ID rendering) is the one
thing not dischargeable in CI — it wants a glance on the Expo Go preview on your phone.
