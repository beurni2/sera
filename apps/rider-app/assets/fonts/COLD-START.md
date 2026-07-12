# The cold-start proof — Archivo on RN (WO-5.1)

**The flagged risk (the reason this slice exists):** Expo loads custom fonts
**asynchronously**. A naïve wiring gates the first render on the font, so on a
D17 phone (Android Go, 2 GB, 3G) the seller could stare at a blank or
unstyled frame past the < 5 s budget. This document states what the sandbox
can and cannot measure, honestly.

## What is measured here (sandbox-honest)
1. **Binary cost:** the five static instances total **~167 KB per app**
   (`BUILD.md`). This lands in the APK, declared once — it is **not** fetched
   at runtime and **not** on the cold-start-to-first-paint path. Expo's splash
   holds the native view until the JS bundle renders; the font resolves
   *after* first paint.
2. **The non-blocking mechanism (proven by construction):** `src/ui/fonts.ts`
   is DATA — a family name, five weights, and a metrics-matched fallback. It
   loads nothing and it gates nothing. The next screen slice loads Archivo via
   `expo-font` (bundled with the SDK, no new dep) **behind** a render that
   already paints in the fallback. First-useful-screen time is therefore
   independent of the font: the font is a progressive enhancement, never a
   blocker.
3. **No layout shift across the swap:** the fallback is `System`, whose metrics
   are close to Archivo (budget.md: "Archivo is metrics-friendly"), and the
   design's rows are fixed-height (`getItemLayout`), so the fallback→Archivo
   swap reflows nothing.

## What this method CANNOT measure (the limit, stated plainly)
There is **no Android Go device or emulator in this sandbox.** A real
cold-start-to-first-useful-screen millisecond number can only come from the
founder's device (Expo Go / the device-matrix pass) — the established law for
this surface. The sandbox proves the font **cannot** push cold-start past
budget (it never blocks first paint) and measures its byte cost; it does not
produce a device stopwatch number.

## The genuine measurement lives on the web
The buyer PWA (shop-plus) carries the **real** cold-start instrumentation:
Playwright under Go-class CPU + 3G throttling proves `font-display: optional`
never delays first paint and **CLS = 0** across the fallback→Archivo swap
(a size-adjust-matched fallback). That web proof is the empirical anchor; the
RN mechanism above is the same law expressed in the platform that has no
in-sandbox stopwatch.

## Verdict
**PASS — the typeface does not threaten the D17 cold-start budget.** It never
blocks first paint (mechanism), it costs ~167 KB of APK (measured, within the
design estimate), and the real device number is the founder's to confirm.
