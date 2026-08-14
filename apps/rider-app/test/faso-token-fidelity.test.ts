import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WO-FP-SERA · TOKEN-FIDELITY — zero hand-copied hex on the Faso component surface.
 * Every colour a Faso component draws must resolve through the `faso.ts` bridge
 * (C / alpha / DARK), never a literal `#hex` in a component. The bridge is the ONE
 * sanctioned seam: v2 tokens for everything the canon names, plus the documented
 * app-local pixel-source `DARK` block (the dark surfaces the v2 palette does not
 * name — HANDOFF §1, hierarchy law "prototype-only detail derives locally").
 *
 * Extends the token gate to the new groups with a PLANTED-HEX NEGATIVE: a hex
 * literal planted in a component surface is caught.
 */

const appDir = join(new URL('.', import.meta.url).pathname, '..');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const hexesIn = (rel: string): string[] => stripComments(readFileSync(join(appDir, rel), 'utf8')).match(HEX) ?? [];

/** The Faso component surface built so far — style/render code that must be hex-free. */
const COMPONENT_SURFACE = ['src/ui/signature.tsx', 'src/ui/faso-sos.tsx', 'src/ui/faso-kit.tsx'];

describe('WO-FP-SERA — token fidelity: zero hand-copied hex on the Faso component surface', () => {
  it('every Faso component resolves colour through the bridge — no #hex literal in component code', () => {
    for (const rel of COMPONENT_SURFACE) {
      const hex = hexesIn(rel);
      expect(hex, `${rel} hand-copies hex ${hex.join(', ')} — resolve it through faso.ts (C / alpha / DARK)`).toEqual([]);
    }
  });

  it('the bridge holds app-local pixel-source hex ONLY inside the documented DARK block', () => {
    const src = stripComments(readFileSync(join(appDir, 'src/ui/faso.ts'), 'utf8'));
    const darkBlock = /export const DARK = \{([\s\S]*?)\} as const;/.exec(src)?.[1] ?? '';
    const outsideDark = (src.replace(darkBlock, '').match(HEX) ?? []);
    // faso.ts imports token VALUES by name (seraColour.primary …) — the only raw
    // hex it may carry is the pixel-source DARK block; nothing else.
    expect(outsideDark, `faso.ts carries hex outside DARK: ${outsideDark.join(', ')}`).toEqual([]);
  });

  it('PLANTED-HEX NEGATIVE: a hex literal planted in a component surface is caught', () => {
    const planted = stripComments("const bg = '#D9A441'; // planted accent, not a token");
    expect(planted.match(HEX)).not.toEqual([]); // the detector fires — the gate would fail
    expect(planted.match(HEX)).toContain('#D9A441');
  });
});


describe('GARDE-LISIBLE — the proof line never draws dark-band text on a light card (founder, 2026-08-14)', () => {
  /**
   * His iPhone showed « Colis sous votre garde. » as a white card with a green
   * check beside INVISIBLE text: `proofText` coloured `C.onInk` — the token for
   * text ON the dark ink band (#FFF8F1) — over `sharedColour.card` (#FFFFFF).
   * Contrast 1.05:1. A valid token on the wrong ground, so token-fidelity's
   * hex scan could not see it and the contrast gate's hand-curated pairings
   * did not carry it. The pin is a source law: App.tsx composes NO style with
   * `onInk` — the dark band lives in the kit components, which own that
   * pairing; the app's own stylesheet has no dark ground to put it on. (If a
   * future App.tsx dark band legitimately needs it, this pin is updated
   * DELIBERATELY, with the ground named beside it.)
   *
   * This pin lives HERE and not in a walk on purpose: the standing order bans
   * walks from claiming anything about appearance, and a colour is appearance.
   */
  const appSrc = () => stripComments(readFileSync(join(appDir, 'App.tsx'), 'utf8'));

  it('App.tsx references no onInk — dark-band text belongs to the kit, never the app stylesheet', () => {
    const hits = appSrc().match(/\bonInk\b/g) ?? [];
    expect(hits, `App.tsx composes onInk ${hits.length}× — cream text with no dark band under it`).toEqual([]);
  });

  it('proofText reads in card ink, and the pairing clears AA in the contrast gate beside this one', () => {
    const style = /proofText:\s*\{([^}]*)\}/.exec(appSrc())?.[1] ?? 'STYLE NOT FOUND';
    expect(style).not.toBe('STYLE NOT FOUND');
    expect(style.includes('C.ink'), 'proofText must read in C.ink — the card body ink').toBe(true);
  });
});

describe('FIN-DE-COURSE — the delivered supporting line owns NO type of its own', () => {
  /**
   * The verifier caught `deliveredRetour` shipping with colour and spacing
   * tokens but NO type token — so the sentence fell to RN's 14 dp default while
   * `proofText` beside it read at 16, under a comment claiming the opposite.
   * The fix was not to hand-roll fontSize (the snowflake rule 5 forbids) but to
   * render the line through `FasoBody`, the kit component that owns the scale.
   *
   * This pin lives HERE and not in a walk on purpose: the standing order bans
   * walks from claiming anything about appearance, and type size is appearance.
   * Token-fidelity is the named home for that class of check.
   */
  const app = () => stripComments(readFileSync(join(appDir, 'App.tsx'), 'utf8'));

  it('the retour_service line renders through FasoBody — the scale comes from the kit, never the style', () => {
    const demoLine = /<FasoBody style=\{styles\.deliveredRetour\}>\{t\('delivered\.retour_service'\)\}<\/FasoBody>/.test(app());
    expect(demoLine, 'the demo delivered line left FasoBody — RN default type is back').toBe(true);
    // and no bare-Text rendering of that string survives anywhere
    expect(/<Text[^>]*>\{t\('delivered\.retour_service'\)\}/.test(app())).toBe(false);
  });

  it('deliveredRetour carries only its deltas — no hand-rolled type, which would be the snowflake', () => {
    const style = /deliveredRetour:\s*\{([^}]*)\}/.exec(app())?.[1] ?? 'STYLE NOT FOUND';
    expect(style).not.toBe('STYLE NOT FOUND');
    for (const interdit of ['fontSize', 'lineHeight', 'fontFamily', 'fontWeight']) {
      expect(style.includes(interdit), `deliveredRetour hand-rolls ${interdit} — FasoBody owns the type`).toBe(false);
    }
  });

  it('the WIRED ending goes through the celebration action, whose note takes the body scale in the kit', () => {
    // The wired arm hands its sentence to <FasoCelebration actionNote=...>; the
    // kit's celNote must resolve type through ty('body', ...) — same scale, one owner.
    expect(/actionNote=\{t\('delivered\.retour_service'\)\}/.test(app())).toBe(true);
    const kit = stripComments(readFileSync(join(appDir, 'src/ui/faso-kit.tsx'), 'utf8'));
    const celNote = /celNote:\s*\{([^}]*)\}/.exec(kit)?.[1] ?? 'STYLE NOT FOUND';
    expect(celNote.includes("ty('body'"), 'celNote no longer takes the body scale from the bridge').toBe(true);
  });
});
