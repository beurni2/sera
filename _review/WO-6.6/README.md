# WO-6.6 review packet — the font is PROVEN, not staged (TIER 🟠 AMBER)

Branch `e6/wo-6.6` off sera main (`a8c0903`). Closes sera's **NAMED DEBT ①** (the font). **Do NOT merge** — founder review.

## The question the WO forced
"Staged is not proven — only consumption proves an asset." APPS confirmed the WO-5.1 collision from the other side and said sera "MERGED THE SAME WO-5.1 FONT FILES" and must be checked. So: parse the real name-table bytes of sera's five committed Archivo TTFs. Are any two identities colliding?

## The answer — read from the bytes, not the ledger
**NOT LIVE.** All five committed TTFs carry five DISTINCT weight-specific identities (`name-records.txt`):

| file | usWeightClass | ID 1 family | ID 2 subfamily | ID 6 PostScript |
|---|---|---|---|---|
| Archivo-Regular.ttf | 400 | `Archivo-Regular` | Regular | `Archivo-Regular` |
| Archivo-Medium.ttf | 500 | `Archivo-Medium` | Regular | `Archivo-Medium` |
| Archivo-Bold.ttf | 700 | `Archivo-Bold` | Regular | `Archivo-Bold` |
| Archivo-ExtraBold.ttf | 800 | `Archivo-ExtraBold` | Regular | `Archivo-ExtraBold` |
| Archivo-Black.ttf | 900 | `Archivo-Black` | Regular | `Archivo-Black` |

The feared `Archivo SemiBold` / `ArchivoSemiBold-Regular` collision (all five collapsing to one face) is **absent** — WO-6.3's fix (`5004ce0`) landed. An absence **proven**, not assumed.

## The permanent regression guard
sera already carries `apps/rider-app/test/font-embedding.test.ts` (WO-6.3): a pure-TS sfnt reader asserting five distinct families + correct weight classes, run on every CI gate (`run-gates.sh:41` → `pnpm test`). I did NOT port boutik's (weaker: fontTools-or-skip; and a duplicate) — see `guard-equivalence.md`. **Proven non-vacuous** in `nonvacuity-proof.txt`: a planted collision fires both assertions; revert restores green.

## Scope
No source change was required or made — the fonts were already distinct and the guard already exists and runs. This slice PROVES the closure with bytes (what the ledger had only claimed). No journey/custody/money/SOS touched (FORBIDDEN respected). No re-pin (494748f/v0.9.2 stated in the WO header; the font work is entirely within sera's assets and needs no contracts change — flagged, not silently done).

## Evidence in this packet
- `name-records.txt` — the five parsed name tables (ID 1/2/6/16, usWeightClass, per-file sha256).
- `nonvacuity-proof.txt` — plant → fire (exit 1) → revert → green (exit 0).
- `guard-equivalence.md` — why sera's guard stands and boutik's was not ported.
- `warm-gates.log` / `cold-gates.log` — `run-gates.sh` green (exit 0) warm AND from a cache-isolated cold clone of committed branch bytes.
- `logs/branch-log.txt` — the branch commit log (carried BY THAT NAME, per the standing packet rule).

## Closes NAMED DEBT ①
The font no longer waits for the device-matrix pass: the committed bytes native embedding consumes are proven distinct, and a permanent CI guard fails if that ever regresses.
