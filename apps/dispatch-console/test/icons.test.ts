import { describe, expect, it } from 'vitest';
import { grandTeintIcon, GRAND_TEINT_ICON_NAMES } from '../src/icons';

/**
 * WO-5.1 — the dispatch-console (a web surface) receives the Grand Teint icons
 * as INLINE SVG strings (the PWA idiom, zero deps), NOT the RN font/component
 * substrate. This asserts the generated module is complete (27 glyphs) and
 * stays token-driven: every glyph paints via currentColor (the theme ink),
 * never a hardcoded colour.
 *
 * VOIX-ÉTAT-2 (founder 2026-08-09) — the set grew by one: `pause`, the twin of
 * `ecouter` on the same ring, because every listen affordance in this ecosystem
 * must be able to SHOW that it is playing. The count is a completeness pin, not
 * a ceiling: it moves with the design-reference folder, which is the source the
 * generator reads.
 */

describe('the Grand Teint inline icon module (dispatch-console PWA)', () => {
  it('carries all 27 canonical glyphs', () => {
    expect(GRAND_TEINT_ICON_NAMES).toHaveLength(27);
    expect(Object.keys(grandTeintIcon)).toHaveLength(27);
  });

  it('⚠ the listen glyph has a PAUSE twin — a player that cannot show playback is the bug', () => {
    expect(GRAND_TEINT_ICON_NAMES).toContain('ecouter');
    expect(GRAND_TEINT_ICON_NAMES).toContain('pause');
  });

  it('every glyph paints via currentColor and hardcodes no colour', () => {
    for (const name of GRAND_TEINT_ICON_NAMES) {
      const svg = grandTeintIcon[name]();
      expect(svg, `${name}: must drive stroke from currentColor`).toContain('currentColor');
      expect(svg, `${name}: no hardcoded hex`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(svg, `${name}: no rgb()/hsl()`).not.toMatch(/\brgba?\(|\bhsla?\(/);
    }
  });

  it('every glyph is WELL-FORMED inline SVG — no namespace prefix a DOM would drop', () => {
    for (const name of GRAND_TEINT_ICON_NAMES) {
      const svg = grandTeintIcon[name](20);
      expect(svg, `${name}: <ns0:path xmlns:ns0=…> renders as nothing`).not.toMatch(/<ns\d+:|xmlns:/);
      expect(svg, `${name}: has a real drawing element`).toMatch(/<(path|circle|rect)\b/);
      expect(svg, `${name}: sized + viewBox`).toContain('viewBox="0 0 24 24"');
    }
  });
});
