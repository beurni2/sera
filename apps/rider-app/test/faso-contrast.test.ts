import { describe, expect, it } from 'vitest';
import { seraColour, sharedColour } from '@platform/ui-tokens';

/**
 * WO-FP-SERA · the CONTRAST GATE (CTO ruling: the accent-on-dark pairing
 * #241A05-on-#D9A441 and every gold-ground text must pass legibility; a failing
 * pair is a STOP, never a silent local darkening). Every text/ground pairing the
 * Faso rider draws is computed from the CANON v2 tokens (never a hand-typed hex)
 * and must clear WCAG AA (4.5:1 for normal text). If a token change ever drops a
 * pairing below AA, this gate fails loudly.
 */

const lum = (hex: string): number => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** [foreground, background, what it is] — the gold-ground + Séra-paper text pairings
 * the Faso components actually render, drawn from the canon tokens. */
const PAIRINGS: ReadonlyArray<readonly [string, string, string]> = [
  [seraColour.onPrimary, seraColour.primary, 'CTA / hero / monogram text on the amber accent'],
  [seraColour.deepAlt, seraColour.soft, 'info + warn chip text on the soft gold ground'],
  [seraColour.deep, sharedColour.card, 'gold text on a white card'],
  [sharedColour.ink, sharedColour.paperSera, 'body ink on the Séra paper'],
  // GARDE-LISIBLE (founder, 2026-08-14): the proof line « Colis sous votre
  // garde. » shipped as onInk-on-card — 1.05:1, invisible on his iPhone. This
  // row documents the INTENDED pairing (ink on the card); note App.tsx's
  // proofText resolves the LEGACY ink (#1B140D), a hair off this root token —
  // both clear AA by a mile. This row alone cannot go red on a revert (it is
  // token-vs-token); the revert-sensitive recurrence pin is the source law in
  // faso-token-fidelity (App.tsx composes no onInk).
  [sharedColour.ink, sharedColour.card, 'proof line text on the white proof card (App.tsx proofText)'],
  [sharedColour.okFg, sharedColour.okBg, 'ok chip'],
  [sharedColour.warnFg, sharedColour.warnBg, 'warn chip'],
  [sharedColour.dangerFg, sharedColour.dangerBg, 'danger chip'],
  [sharedColour.mutedFg, sharedColour.mutedBg, 'muted chip'],
];

describe('WO-FP-SERA — the contrast gate: every gold-ground / paper text clears WCAG AA', () => {
  it('the CTO pairing #241A05-on-#D9A441 clears AAA (7:1)', () => {
    expect(seraColour.onPrimary).toBe('#241A05');
    expect(seraColour.primary).toBe('#D9A441');
    expect(ratio(seraColour.onPrimary, seraColour.primary)).toBeGreaterThanOrEqual(7);
  });

  it('every Faso text/ground pairing clears AA (4.5:1) — a failing pair is a STOP', () => {
    for (const [fg, bg, what] of PAIRINGS) {
      const r = ratio(fg, bg);
      expect(r, `${what}: ${fg} on ${bg} is ${r.toFixed(2)}:1 — below AA 4.5`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
