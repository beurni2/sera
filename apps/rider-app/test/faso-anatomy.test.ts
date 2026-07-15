import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WO-FP-SERA · the ANATOMY GUARD (CTO correction, 2026-07-15). The reference bar
 * is the PLANCHE (« Sera - Redesign.dc.html »), not a paper-only reskin. The
 * device once showed the OLD anatomy — glyph-tile chips + chevrons + outlined
 * uppercase — on new paper. This guard is the programmatic teeth so a restyle
 * cannot regress to that: R2 MUST be the editorial CourseCard (left gold bar ·
 * CRS eyebrow · filled PROPOSÉE pill · « avant HH:MM » deadline), never a row with
 * an icon tile + a chevron. See `_review/WO-FP-SERA/anatomy-derivation.md`.
 */

const appDir = join(new URL('.', import.meta.url).pathname, '..');
const read = (p: string): string => readFileSync(join(appDir, p), 'utf8');

describe('WO-FP-SERA — R2 course card carries the planche anatomy', () => {
  const kit = read('src/ui/faso-kit.tsx');

  it('the CourseCard exists with the planche elements (bar · eyebrow · pill · deadline)', () => {
    expect(kit).toMatch(/export function CourseCard\(/);
    expect(kit).toMatch(/courseBar:/); // the left gold bar (planche R2 line 109)
    expect(kit).toMatch(/courseCode:/); // the CRS-ref eyebrow
    expect(kit).toMatch(/courseDeadline:/); // the « avant HH:MM » deadline
    expect(kit).toMatch(/courseTitle:/); // the repère title (Instrument 700)
    expect(kit).toMatch(/courseSub:/); // zone · who subtitle
  });

  it('the proposed card is the gold-glow card; the done card is the receded tint at .7', () => {
    // proposed: 1.5 accent border + the gold-glow shadow (planche box-shadow)
    expect(kit).toMatch(/courseProposed:\s*\{[^}]*borderColor:\s*C\.accent/s);
    expect(kit).toMatch(/courseProposed:\s*\{[^}]*shadowColor:\s*C\.accent/s);
    // done: the receded warm tint at opacity .7 (planche r2HasDone)
    expect(kit).toMatch(/courseDone:\s*\{[^}]*backgroundColor:\s*C\.tintCard[^}]*opacity:\s*0\.7/s);
  });

  it('the PROPOSÉE pill is the FILLED gold (accent tone), the lineage pill is OUTLINED', () => {
    expect(kit).toMatch(/accent:\s*\{\s*bg:\s*C\.accent,\s*fg:\s*C\.onAccent\s*\}/);
    // the 2e passage is an outlined pill (planche: border #8F6812 / text #5F4403)
    expect(kit).toMatch(/lineagePill:\s*\{[^}]*borderColor:\s*C\.accentDeep/s);
    expect(kit).toMatch(/lineagePillText:\s*\{[^}]*color:\s*C\.accentDeepAlt/s);
  });

  it('the CourseCard has NO glyph tile and NO chevron (the retired list-row anatomy)', () => {
    // The card body is the eyebrow/pill/title/subtitle stack — never a glyph tile
    // or a « › » chevron. (The legacy ListRow keeps those for non-R2 uses; the
    // card must not.)
    const cardStart = kit.indexOf('export function CourseCard(');
    const cardEnd = kit.indexOf('\nexport ', cardStart + 'export function CourseCard('.length);
    const cardSrc = kit.slice(cardStart, cardEnd);
    expect(cardSrc).not.toContain('glyphTile');
    expect(cardSrc).not.toContain('chevron');
    expect(cardSrc).not.toContain('Icon');
  });

  it('R2 in App composes the CourseCard, not the glyph-tile list row', () => {
    const app = read('App.tsx');
    expect(app).toContain('<FasoCourseCard');
    expect(app).not.toContain('<FasoListRow');
    // the offer window renders the filled PROPOSÉE pill + the response deadline
    expect(app).toMatch(/tone: 'accent'/);
    expect(app).toMatch(/t\('courses\.before'\)/);
  });
});

describe('WO-FP-SERA — R10 code entry matches the planche', () => {
  it('the keypad backspace is the planche ⌫ (not an ambiguous chevron)', () => {
    const kit = read('src/ui/faso-kit.tsx');
    expect(kit).toContain("isBack ? '⌫' : k");
  });

  it('the R10 overline + honesty are centered over the cells (planche codeEntry)', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/<FasoOverline center>\{t\('drop\.title'\)\}/);
    expect(app).toMatch(/<FasoBody style=\{styles\.dropHint\}>\{t\('drop\.hint'\)\}/);
  });
});
