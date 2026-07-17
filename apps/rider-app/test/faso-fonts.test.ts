import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { money } from '@platform/ui-tokens/legacy';

/**
 * WO-FP-SERA · STEP 0 — the Faso Premium faces embed under DISTINCT names AND the
 * money render is drawable in EVERY weight. Two permanent guards on the new bytes:
 *
 *  (1) NAME-TABLE DISTINCTNESS (the WO-6.3 law, carried): native font embedding
 *      addresses a face BY NAME, so six identically-named faces would collapse to
 *      one and only a single weight would ever render. Each of the six carries a
 *      distinct weight-specific family and its truthful OS/2 usWeightClass.
 *  (2) MONEY-RENDER / CMAP: the money string the app draws — grouped with the
 *      EXISTING `money` token's separator + suffix (« 11 500 F »), never a
 *      reimplemented formatter — has EVERY codepoint in EVERY face's cmap, and the
 *      tabular-figures feature (`tnum`) survives the subset. A char the formatter
 *      emits that the font lacks would fail here (formatter-emits-what-font-lacks).
 */

const FONT_DIR = join(new URL('.', import.meta.url).pathname, '..', 'assets', 'fonts');

/** The six Faso Premium faces: file → (family the app requests, OS/2 usWeightClass). */
const FACES: ReadonlyArray<readonly [string, string, number]> = [
  ['Bricolage-700.ttf', 'Bricolage-700', 700],
  ['Bricolage-800.ttf', 'Bricolage-800', 800],
  ['Instrument-400.ttf', 'Instrument-400', 400],
  ['Instrument-500.ttf', 'Instrument-500', 500],
  ['Instrument-600.ttf', 'Instrument-600', 600],
  ['Instrument-700.ttf', 'Instrument-700', 700],
];

/** Minimal sfnt reader: table directory → {name ID 1, OS/2 usWeightClass, cmap set, raw}. */
function readFace(file: string) {
  const buf = readFileSync(join(FONT_DIR, file));
  const numTables = buf.readUInt16BE(4);
  const tables = new Map<string, [number, number]>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables.set(buf.toString('latin1', rec, rec + 4), [buf.readUInt32BE(rec + 8), buf.readUInt32BE(rec + 12)]);
  }
  const os2 = tables.get('OS/2')![0];
  const usWeightClass = buf.readUInt16BE(os2 + 4);

  const nameOff = tables.get('name')![0];
  const count = buf.readUInt16BE(nameOff + 2);
  const stringOffset = buf.readUInt16BE(nameOff + 4);
  let family: string | undefined;
  for (let i = 0; i < count; i++) {
    const rec = nameOff + 6 + i * 12;
    const platformID = buf.readUInt16BE(rec);
    const nameID = buf.readUInt16BE(rec + 6);
    const length = buf.readUInt16BE(rec + 8);
    const off = nameOff + stringOffset + buf.readUInt16BE(rec + 10);
    if (nameID !== 1 || family !== undefined) continue;
    const slice = buf.subarray(off, off + length);
    family =
      platformID === 0 || platformID === 3
        ? Array.from({ length: slice.length >> 1 }, (_, i) => String.fromCharCode(slice.readUInt16BE(i * 2))).join('')
        : slice.toString('latin1');
  }

  // cmap: read every format-4 (BMP) subtable — the money chars are all BMP.
  const cmapOff = tables.get('cmap')![0];
  const nSub = buf.readUInt16BE(cmapOff + 2);
  const codepoints = new Set<number>();
  for (let i = 0; i < nSub; i++) {
    const sub = cmapOff + buf.readUInt32BE(cmapOff + 4 + i * 8 + 4);
    if (buf.readUInt16BE(sub) !== 4) continue; // format 4 only
    const segX2 = buf.readUInt16BE(sub + 6);
    const segCount = segX2 >> 1;
    const endO = sub + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    for (let s = 0; s < segCount; s++) {
      const end = buf.readUInt16BE(endO + s * 2);
      const start = buf.readUInt16BE(startO + s * 2);
      const delta = buf.readUInt16BE(deltaO + s * 2);
      const rangeOffset = buf.readUInt16BE(rangeO + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (rangeOffset === 0) g = (c + delta) & 0xffff;
        else {
          const gi = rangeO + s * 2 + rangeOffset + (c - start) * 2;
          if (gi + 1 >= buf.length) continue;
          const raw = buf.readUInt16BE(gi);
          g = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        if (g !== 0) codepoints.add(c);
      }
    }
  }
  return { family, usWeightClass, codepoints, hasTnum: buf.includes(Buffer.from('tnum', 'latin1')) };
}

/** Group an integer with the EXISTING money token's separator, then its suffix —
 * exactly what the app draws (token consumed, not a reimplemented formatter). */
const renderAmount = (n: number): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, money.groupSeparator) + money.currencySuffix;

describe('WO-FP-SERA STEP 0 — the six Faso Premium faces embed distinct + draw the money render', () => {
  it('every file carries its distinct weight-specific family and truthful OS/2 weight class', () => {
    for (const [file, family, weight] of FACES) {
      const f = readFace(file);
      expect(f.usWeightClass, `${file} usWeightClass`).toBe(weight);
      expect(f.family, `${file} family`).toBe(family);
    }
    const families = FACES.map(([file]) => readFace(file).family);
    expect(new Set(families).size, `families: ${families.join(', ')}`).toBe(6); // no name-table collision
  });

  it('the money render (« 11 500 F », earnings, the drop code) is drawable in EVERY weight; tnum survives', () => {
    // proof the render is what the app draws, through the existing token — the
    // separator is the token's U+202F narrow no-break space, never a hand-typed one:
    expect(renderAmount(11500)).toBe(`11${money.groupSeparator}500${money.currencySuffix}`);
    expect(money.groupSeparator.codePointAt(0)).toBe(0x202f); // the real separator, pinned
    const drawn = [renderAmount(11500), renderAmount(3250), renderAmount(128000), '734921'];
    const chars = new Set([...drawn.join('')]);
    for (const [file] of FACES) {
      const f = readFace(file);
      const missing = [...chars].filter((c) => !f.codepoints.has(c.codePointAt(0)!));
      // formatter-emits-what-font-lacks = STOP: a missing glyph fails here, loudly.
      expect(missing, `${file} cannot draw: ${missing.map((c) => JSON.stringify(c)).join(', ')}`).toEqual([]);
      expect(f.hasTnum, `${file} lost the tnum (tabular figures) feature`).toBe(true);
    }
  });
});
