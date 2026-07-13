# WO-6.4 item 3 — gallery byte-stability, PROVEN (carried WO-4.1)

The debt was proven by actually capturing twice and diffing bytes — not by trusting a comment.

## Run 1 (before fix — clock installed only for clock-driven states, as inherited)
Two independent captures, sha256 per state:

| state | result |
|---|---|
| console-course-donnee | IDENTICAL |
| console-course-livree | IDENTICAL |
| **console-course-remise** | **DIFFERS** |
| console-file-prete | IDENTICAL |
| console-porte-confirmee | IDENTICAL |
| console-sos-acknowledged | IDENTICAL |
| console-sos-queued | IDENTICAL |
| console-sos-raised | IDENTICAL |

7/8 identical; `console-course-remise` (the `["assign","clock-6min"]` requeue state) differed.

## Locating the difference (pure-Python PNG decode, no ImageMagick/PIL available)
- Same dimensions 800×950; differ from byte 7207.
- **Differing pixels: 7**, bounding box `x=[64..64] y=[115..605]` — a single vertical column, 7 isolated pixels. This is a sub-pixel **antialiasing** difference on a card edge, NOT a rendered timestamp (a time-text diff would be a horizontal cluster of many pixels).

## Fix + re-proof (fixed clock for EVERY state)
Pinned `page.clock.install({ time: '2026-07-12T09:00:00Z' })` for every gallery state, removing the wall clock as a variance source. Re-ran the two-capture diff:

- 7/8 still IDENTICAL (now deterministic **by construction**, not by luck of capturing within the same minute).
- `console-course-remise` **still DIFFERS** → a fixed clock did NOT change it, proving the residual is a **browser rasterisation AA flip, not data**.

## Characterisation (3 independent captures of console-course-remise)
```
r1: 93714f89…  r2: 93714f89…  r3: 585cf389…
r1 vs r2: 0 px   r1 vs r3: 7 px   r2 vs r3: 7 px
```
A binary ~7-px AA flip (≈1-in-3), independent of clock/data — browser rasterisation nondeterminism the test cannot control.

## Why this is HARMLESS — the WO-4.1 landmine is structurally gone
The WO offered: byte-stable **OR** remove the PNG from the gate tree. The second arm is already satisfied and I confirmed it:
- `git ls-files '*.png'` → **no PNG is tracked anywhere**; `gallery/img/` is gitignored.
- No gate byte-compares the PNGs: `gallery.spec.ts` asserts a capture **succeeds** (`page.screenshot`), and `build-gallery.mjs` asserts the image **EXISTS** (`existsSync`) — neither diffs bytes against a committed baseline.

So a re-encoded/AA-flipped PNG can never dirty the tree or fail a gate. The original WO-4.1 hazard (a *tracked* PNG re-encoding) no longer exists.

**Decision:** kept the fixed-clock determinism win (7/8 stable by construction), kept all 8 states (no state dropped to make the number look clean — standing line), and corrected the prior overclaiming comments in `gallery.spec.ts` and `.gitignore` to state this proven truth.
