# Boutik+ Web — North Star
### The founder-ruled transition of the Boutik+ supplier surface to a responsive web application. Direction is settled; the ⏳ decisions below remain founder-ruled. Canon home: `platform-contracts/docs`.

---

## 0. Authority

On 2026-07-26 the founder directed that Boutik+ transition from a mobile-native application to a full-stack, responsive web application, with photo **upload** as the universal default intake and the native camera capture trigger deprecated **as the default action**. The directive tripped a §7 stop (it touches Law 7, the proof-provenance rule, the build sequence, and the review protocol); the stop was executed and journaled, and the founder confirmed the directive verbatim: **« yes i confirm it and its mine »**. This document is that ruling's canon entry. It follows the North Star pattern: **direction, not work orders** — each W-slice below becomes a work order only when it is reached, and merges only on founder approval (the standing gate, unchanged by this ruling).

---

## 1. The ruling, restated precisely

1. **Boutik+ (the supplier surface) becomes a responsive web application** — reachable from a browser on any device, phone included.
2. **Upload is the universal default for photo intake.** On pointer devices this includes a designed drag-and-drop container; on touch devices the same intake is tap-to-select, because drag-and-drop does not exist as a touch primitive. One seam, two entries.
3. **The camera capture trigger is deprecated as the default action.** Read strictly by the founder's own words: camera stops being the *default*; whether it survives anywhere (the proof role) is ⏳ W-D1 below.

**What this ruling does NOT touch:** the money model, the contracts shapes, the event schemas, the offer service, the media service, custody semantics, Séra, Shop+. Any change to those remains its own §7.

---

## 2. Architecture: same codebase, web target — not a rewrite (CTO recommendation, evidence-based)

The existing app is Expo SDK 54 / React Native 0.81, and it divides cleanly:

- **Every decision is already pure TypeScript** with no platform in it: the studio pipeline (`pick.ts`, `review.ts`, `normalization.ts` — the strip is byte-walking TS that runs in any JS engine), the supply views, the v2 machine, the money keypad rules. All vitest-covered; 480 tests at the time of ruling.
- **Screens are React Native components**, renderable in a browser by `react-native-web` under Expo's web target — the same screens the founder device-verified this week, not parallel copies that drift.
- **The native-module edges are thin and known**, and each has a web story to be *verified in W1, not assumed*: `expo-image-picker` on web presents a file dialog (the upload default falls out of the platform); `expo-camera` supports web via `getUserMedia`; `expo-image-manipulator` runs on canvas; `expo-crypto` is supported; `expo-haptics` no-ops; `expo-updates` is native-only and simply unused on web (a web deploy is a redeploy).
- **The seam that must be BUILT, not assumed:** the file-system edge. `expo-file-system` has no meaningful web support — on web, image bytes flow as `Blob`/`ArrayBuffer` end to end. The capture/strip/upload path gets a platform port at exactly that edge, in the `pick.ts` seam pattern already established.
- **The backend already exists.** "Full-stack" is already true: offer service and media service run as deployed Workers; the media service validates by magic bytes (declared Content-Type ignored), enforces size caps, and is transport-indifferent. Nothing server-side changes for this transition.

**Rejected alternative — the from-scratch rewrite:** it discards a device-verified capture pipeline, the green test suite, and the design-token system, for zero user-visible gain, and reopens every solved defect (five live device defects were caught and fixed the same week as this ruling). If W1 falsifies the same-codebase path on real evidence, the decision returns to the founder with that evidence.

---

## 3. What survives untouched — named, so nothing is silently reopened

- **Law 7's soul travels; the platform changes.** Offline-first, low-end Android first: the web app is a PWA measured on the same reference device in the same sunlight. Existing budgets in `PERF-BUDGETS.md` apply in spirit; the web-specific numbers (bundle size, TTI on the reference device) are proposed at W1 exit for founder ruling (⏳ W-D3).
- **Three apps = three repos = three deployables.** A web Boutik+ is still its own deployable — never merged with Shop+ into one app.
- **The i18n catalog + French Voice + copy-lint.** Every new web string enters the catalog with register tags. Drag-and-drop, upload states, and browser-permission moments are user-facing money-adjacent trust moments and get the same French Voice care.
- **The strip pipeline and its honesty rules** (WYSIWYG preview of shipped bytes; DRI preserved; decode-derived dimensions, never picker-declared).
- **The review screen's pure geometry** (`reviewPaneSize`, `reviewGuides`) — platform-free already.
- **The review/approval protocol.** Nothing merges without founder approval, except under the live-defect fast path. This ruling changes *what* is built, not *how it is gated*.

---

## 4. Decisions — all three founder-ruled 2026-07-26 (verbatim, same message)

| ID | Ruling | The founder's words |
|----|--------|---------------------|
| **W-D1** | **(b) — proof accepts uploads on the web surface.** The camera-only provenance control is knowingly dropped there, by explicit ruling over the flagged safest default. | *« allow uploads for proof too, i will only be using photo upload on this webapp and never camera capture »* |
| **W-D2** | **Park the native app.** The binary keeps working; no new native work; shared-code changes keep the native path compiling and its tests green. Park ≠ retire. | *« park it »* |
| **W-D3 / hosting** | **Cloudflare Pages** is the web deploy target (the CTO recommendation, ruled). Deploys are manual-dispatch, per the standing *« a deploy is a deliberate act »* ruling. Budget values still land at measurement, in the `PERF-BUDGETS.md` pattern. | *« yes use your recommendation »* |

**Standing note carried with W-D1, not reopening it:** the burned-in-price control's real bite was always third-party suppliers, and those are already excluded by the harder gate — *no supplier but the founder authors until real per-supplier identity lands*. The day that identity gate opens, W-D1 is the decision to re-read first. On the parked native app the camera-only proof rule stays as built.

---

## 5. The W-slices — small, evidence-gated, in order

- **W1 — Web walking skeleton.** Add the web target (`react-native-web`, `react-dom`, Expo static web output). The existing app boots in a browser and the Produits list reads the deployed offer service. *Evidence: the same list the founder verified on his phone, in a browser tab. Every native-edge claim in §2 verified or corrected here.* Out of scope: photo intake.
- **W2 — Upload intake.** The pick seam gains its web port: file selection, bytes as `ArrayBuffer`, the existing strip + decode + review screen unchanged. **Per W-D1's ruling this seam serves ALL THREE ROLES on web, proof included** — there is no separate proof slice anymore (the former W5 is void). Refusal and cancel states designed, not defaulted. *Evidence: an uploaded JPEG passes the strip and lands on the review screen with the guides on it.*
- **W3 — Drag-and-drop.** The designed drop container, pointer devices only, layered on the same seam as an additional entry — never the only path.
- **W4 — Publish parity.** The five-step wizard end-to-end in a browser: upload → review → publish → appears in Produits and the supply projection. *This closes the founder's de-mock sentence on web.*
- **W5 — Web deploy pipeline.** Cloudflare Pages (W-D3 ruling), manual dispatch only, exporting COLD (Metro caches `EXPO_PUBLIC_*` inlining — a warm export can ship stale values). Replaces the voided proof-capture slice.
- **W6 — PWA hardening.** Offline queued states (queued = pending, never done), installability, the W-D3 budgets enforced in CI.

**Sequencing note (CTO recommendation, founder may resequence with a word):** this ruling makes Boutik+ Web the active front. The Shop+ vitrine — the end of the founder's original de-mock sentence — follows after W4; it reads the same supply projection regardless of which supplier surface wrote it.
