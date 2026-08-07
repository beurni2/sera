import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, displayRiderCode, formatRiderCode, normalizeRiderCode } from '../src/net/rider-code';

/**
 * SE-LIVE-4c-ii · reading the code off a paper slip.
 *
 * THE 5-SECOND TEST, applied to a text field: Aïcha's colleague Issa is
 * standing at a supplier's stall, sun on the screen, reading a code the
 * founder wrote on a slip. He will type it lowercase, he will miss the
 * dashes. Every test here is a way a RIGHT code gets typed by a person doing
 * their best — the app must take all of them.
 */

/** A real-shaped code (every character from the alphabet). */
const REAL = 'SR-ABCD-EFGH-JKMN';

describe('a right code typed by a real person is accepted', () => {
  it('takes the canonical form unchanged', () => {
    expect(normalizeRiderCode(REAL)).toBe(REAL);
  });

  it('takes lowercase — the phone keyboard starts there', () => {
    expect(normalizeRiderCode('sr-abcd-efgh-jkmn')).toBe(REAL);
  });

  it('takes it with no dashes at all', () => {
    expect(normalizeRiderCode('SRABCDEFGHJKMN')).toBe(REAL);
  });

  it('takes the body alone, without the SR- prefix', () => {
    expect(normalizeRiderCode('ABCD-EFGH-JKMN')).toBe(REAL);
    expect(normalizeRiderCode('ABCDEFGHJKMN')).toBe(REAL);
  });

  it('takes stray spaces and mixed case together', () => {
    expect(normalizeRiderCode('  sr abcd efgh jkmn  ')).toBe(REAL);
    expect(normalizeRiderCode('Sr-AbCd EfGh-JkMn')).toBe(REAL);
  });

  it('⚠ does not truncate a body that itself begins with SR', () => {
    // `S` and `R` are both in the alphabet, so a BODY may start « SR ». The
    // prefix is dropped at length 14 only — never by pattern — so this
    // 12-character body survives intact.
    const bodyStartingSR = 'SRCDEFGHJKMN';
    expect(normalizeRiderCode(bodyStartingSR)).toBe('SR-SRCD-EFGH-JKMN');
    // …and the same code WITH its prefix resolves to the identical wire form.
    expect(normalizeRiderCode(`SR-${bodyStartingSR}`)).toBe('SR-SRCD-EFGH-JKMN');
    expect(normalizeRiderCode(`SR${bodyStartingSR}`)).toBe('SR-SRCD-EFGH-JKMN');
  });
});

describe('an unreadable code is refused here, not sent', () => {
  it('refuses a code containing a letter the alphabet deliberately excludes', () => {
    // I, L, O, U, 0, 1 are absent from CODE_ALPHABET precisely so a
    // handwritten code cannot be misread. A typed one means a misreading —
    // and we do NOT guess the substitution.
    for (const ch of ['I', 'L', 'O', 'U', '0', '1']) {
      const typed = `SR-${ch}BCD-EFGH-JKMN`;
      expect(`${ch} -> ${normalizeRiderCode(typed)}`).toBe(`${ch} -> null`);
    }
  });

  it('refuses wrong lengths rather than padding or truncating', () => {
    expect(normalizeRiderCode('')).toBeNull();
    expect(normalizeRiderCode('SR-')).toBeNull();
    expect(normalizeRiderCode('ABCD-EFGH')).toBeNull();
    expect(normalizeRiderCode('ABCD-EFGH-JKMN-PQRS')).toBeNull();
    expect(normalizeRiderCode('ABCDEFGHJKM')).toBeNull(); // one short
    expect(normalizeRiderCode('ABCDEFGHJKMNP')).toBeNull(); // one long
  });

  it('the alphabet matches the one logistics mints from, character for character', () => {
    // If logistics-do.ts:117 ever changes, this fails loudly rather than
    // silently refusing every newly-minted code.
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTVWXYZ23456789');
    // The exclusions are the point of the alphabet — assert them by name.
    for (const ch of ['I', 'L', 'O', 'U', '0', '1']) {
      expect(`${ch} in alphabet: ${CODE_ALPHABET.includes(ch)}`).toBe(`${ch} in alphabet: false`);
    }
    // Every character it DOES contain must survive normalisation, so no
    // legitimate minted code is ever refused by this function.
    const body = CODE_ALPHABET.slice(0, 12);
    expect(normalizeRiderCode(body)).toBe(formatRiderCode(body));
    const tail = CODE_ALPHABET.slice(-12);
    expect(normalizeRiderCode(tail)).toBe(formatRiderCode(tail));
  });
});

describe('the field shows the shape while it is being typed', () => {
  it('groups progressively so the rider can see their place', () => {
    expect(displayRiderCode('')).toBe('');
    expect(displayRiderCode('a')).toBe('SR-A');
    expect(displayRiderCode('abcd')).toBe('SR-ABCD');
    expect(displayRiderCode('abcde')).toBe('SR-ABCD-E');
    expect(displayRiderCode('abcdefgh')).toBe('SR-ABCD-EFGH');
    expect(displayRiderCode('abcdefghjkmn')).toBe(REAL);
  });

  it('never rejects mid-typing — refusal belongs at submit', () => {
    // A field that erases a character as you type it is unusable in the sun.
    // Out-of-alphabet input is simply carried until the rider submits.
    expect(displayRiderCode('SR-OOO')).toBe('SR-OOO');
    expect(displayRiderCode('sr-abcd-efgh-jkmn-pqrs')).toBe(REAL);
  });
});
