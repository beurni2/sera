import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WO-6.3 (font name-table collision, found by WO-6.0/boutik) — PERMANENT guard.
 *
 * WO-5.1 shipped five Archivo TTFs whose OUTLINES were the correct weights but
 * whose NAME TABLES were identical (family « Archivo SemiBold », PostScript
 * ArchivoSemiBold-Regular). Native font embedding (the expo-font config plugin)
 * addresses a face BY NAME, so five identically-named faces collapse to one and
 * only a single weight ever renders. The fix rewrote each name table to a
 * distinct weight-specific family that matches the app's `fam()` (the filename
 * stem, kit.tsx). This test reads the real TTF bytes and FAILS if the collision
 * ever returns: it asserts five DISTINCT families and the correct OS/2 weight
 * class per file. A font a rider cannot read is a failed screen.
 */

const FONT_DIR = join(new URL('.', import.meta.url).pathname, '..', 'assets', 'fonts');

/** The five embedded weights: file → (family the app requests, OS/2 usWeightClass). */
const EXPECTED: ReadonlyArray<readonly [string, string, number]> = [
  ['Archivo-Regular.ttf', 'Archivo-Regular', 400],
  ['Archivo-Medium.ttf', 'Archivo-Medium', 500],
  ['Archivo-Bold.ttf', 'Archivo-Bold', 700],
  ['Archivo-ExtraBold.ttf', 'Archivo-ExtraBold', 800],
  ['Archivo-Black.ttf', 'Archivo-Black', 900],
];

/** Minimal sfnt reader: the family name (name ID 1) and OS/2 usWeightClass. */
function readFontIdentity(file: string): { family: string; usWeightClass: number } {
  const buf = readFileSync(join(FONT_DIR, file));
  const numTables = buf.readUInt16BE(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables.set(buf.toString('latin1', rec, rec + 4), buf.readUInt32BE(rec + 8));
  }
  const os2 = tables.get('OS/2');
  if (os2 === undefined) throw new Error(`${file}: no OS/2 table`);
  const usWeightClass = buf.readUInt16BE(os2 + 4);

  const nameOff = tables.get('name');
  if (nameOff === undefined) throw new Error(`${file}: no name table`);
  const count = buf.readUInt16BE(nameOff + 2);
  const stringOffset = buf.readUInt16BE(nameOff + 4);
  let family: string | undefined;
  for (let i = 0; i < count; i++) {
    const rec = nameOff + 6 + i * 12;
    const platformID = buf.readUInt16BE(rec);
    const nameID = buf.readUInt16BE(rec + 6);
    const length = buf.readUInt16BE(rec + 8);
    const off = nameOff + stringOffset + buf.readUInt16BE(rec + 10);
    if (nameID !== 1) continue;
    const slice = buf.subarray(off, off + length);
    // platform 0/3 → UTF-16BE; platform 1 (Mac) → latin1
    const value = platformID === 0 || platformID === 3 ? decodeUtf16be(slice) : slice.toString('latin1');
    if (family === undefined) family = value;
  }
  if (family === undefined) throw new Error(`${file}: no family (name ID 1)`);
  return { family, usWeightClass };
}

function decodeUtf16be(buf: Buffer): string {
  let s = '';
  for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode(buf.readUInt16BE(i));
  return s;
}

describe('WO-6.3 — the five Archivo faces embed under DISTINCT names (no name-table collision)', () => {
  it('every file carries the correct OS/2 weight class and its distinct weight-specific family', () => {
    for (const [file, family, weight] of EXPECTED) {
      const id = readFontIdentity(file);
      expect(id.usWeightClass, `${file} usWeightClass`).toBe(weight);
      expect(id.family, `${file} family`).toBe(family);
      // the regression that shipped: all five said « Archivo SemiBold »
      expect(id.family, `${file} still carries the collided family`).not.toBe('Archivo SemiBold');
    }
  });

  it('the five families are DISTINCT — native embedding registers one face per name', () => {
    const families = EXPECTED.map(([file]) => readFontIdentity(file).family);
    expect(new Set(families).size, `families: ${families.join(', ')}`).toBe(5);
  });
});
