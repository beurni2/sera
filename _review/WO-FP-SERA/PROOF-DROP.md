# WO-FP-SERA · FASO PREMIUM — 3-VIEW STYLE PROOF (drop)

Branch `e6/wo-fp-sera` · proof commit `0c989ae` · **DO NOT MERGE**.
RN aesthetic evidence = the expo-preview build on the founder's device (program convention).

## The preview (live on the `preview` channel)

- **Open the Séra preview app** — it auto-updates to group `c01955a7-8651-4046-8356-43e38c8e196e`, message `main@0c989ae`, runtime `exposdk:54.0.0`, android + ios.
- **EAS Dashboard:** https://expo.dev/accounts/beurniboss/projects/sera-rider/updates/c01955a7-8651-4046-8356-43e38c8e196e
- Published by `expo-preview.yml` `workflow_dispatch` on the branch (run #46). The Metro bundle compiled clean — the react-native-svg signatures, the new Faso modules, and the embedded Bricolage/Instrument fonts all bundled with zero errors (the build is itself proof the restyle is device-real).

## The three views — hold each against its « Sera - Ecrans » frame

| Frame | Register | What to look at |
|---|---|---|
| **R2 — Mes courses** | list / home | woven-band strip, Séra paper `#EFE8DA`, white course cards, the honest status-chip register (à ramasser / en route / rendue / expirée) |
| **R10 — Le code** | money / evidence + honesty | gold-cursor code cells + white keypad; « le code vient **après** la confirmation de l'opérateur — jamais avant. C'est sa preuve, pas la vôtre. » verbatim |
| **R14 — SOS** | safety / honesty | dark sheet `#14100B` + 3px red edge, fpUp rise; raised→ack→enroute→clos chain + the dashed « (aperçu) » stand-in intact |

## Judgment calls (prototype → RN)

1. **R2 header** uses the woven band as the header strip (the Faso upgrade of the Grand Teint theme mark). The full « S » monogram header lands with the complete chrome restyle.
2. **Tab dock** has no `backdrop-filter` blur (RN can't) — rendered as paper + top hairline + a soft-accent active pill (the README's active treatment).
3. **Séra paper** `#EFE8DA` is shell-wide; the 10 un-restyled views ride it on the `/legacy` shim (warm, not broken) until their own restyle.
4. **Hero-ledger radius** normalizes to the card token (20) — the README « 22 » is a straggler the hierarchy law resolves to the token. (Séra doesn't use the hero ledger band anyway — 0 prototype hits; it ships as shared vocabulary.)

## Verified, not claimed

- **Contrast gate:** `#241A05` on `#D9A441` = **7.62:1 (AAA)**; every gold-ground / paper pairing clears WCAG AA (deepAlt-on-soft 7.52 · deep-on-white 5.05 · ink-on-paper 14.6 · chips 6.3–7.3). Computed from canon tokens; a failing pair is now a permanent gate (`test/faso-contrast.test.ts`).
- **Honesty contracts intact** through the reskin: `sos-drill` 9/9, `sos-outbox` 3/3, `evidence-finality` 5/5, `wo6-invariants` 11/11 (incl. code-entry-only-on-drop).
- **Token fidelity:** signature.tsx + faso-sos.tsx + faso-kit.tsx are hex-free (colour resolves through the bridge); planted-hex negative.
- Typecheck clean, **rider 99/99**.

## Guards

- **① The preview channel reverts on the next `main` publish** (this is an un-merged-branch preview; the founder is its only consumer).
- **② If the SOS drill fires during the review window, it runs against a `main` build, never this branch.**

## What's in this drop

- `PROOF-DROP.md` — this file.
- `states-law-inventory.md` — the founder-veto-① checklist: 14 framed states + **12 absent-from-prototype states** (each with its Faso-grammar treatment) so the full restyle drops none.
- `build-faso-fonts.py` — the STEP 0 font-build provenance (google/fonts OFL → 6 subset, distinct-name-table static faces).

## Next (on the founder's aesthetic tap)

Views 4–13 straight through per the states-law inventory, then the full packet (galleries where web harnesses exist · warm+cold · fresh verifier · honesty contracts · contrast gate · the preview build + the device review as the RN evidence). No further view restyles until the tap.
