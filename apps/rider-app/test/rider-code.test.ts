import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, formatRiderCode, normalizeRiderCode } from '../src/net/rider-code';

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

describe('⚠ the composed runtime path — the loop that broke A1', () => {
  /**
   * VERIFIER B4: `displayRiderCode` and `normalizeRiderCode` were each tested
   * in isolation, and the RUNTIME composition of them — a controlled RN input
   * re-feeding the formatter its own output — was tested nowhere. That is
   * exactly where blocker A1 lived, and why it shipped green.
   *
   * The field no longer masks (it shows what was typed), so the composition
   * that matters now is « whatever the rider typed → what we send », simulated
   * here for every realistic way a code gets entered.
   */
  const entered = (keys: string) => normalizeRiderCode(keys);

  it('every realistic way of typing the printed code reaches the SAME wire form', () => {
    for (const typed of [
      'SR-ABCD-EFGH-JKMN',   // exactly as printed
      'sr-abcd-efgh-jkmn',   // lowercase
      'SRABCDEFGHJKMN',      // no dashes
      'SR ABCD EFGH JKMN',   // spaces
      'ABCD-EFGH-JKMN',      // body with dashes
      'ABCDEFGHJKMN',        // body only
      '  SR-abcd-EFGH-jkmn ',// padded + mixed
    ]) {
      expect(`${typed} -> ${entered(typed)}`).toBe(`${typed} -> ${REAL}`);
    }
  });

  it('⚠ typing the printed code never yields a DIFFERENT well-formed code', () => {
    // A1's real harm: the mask produced SR-SRAB-CDEF-GHJK — well-formed, wrong,
    // and therefore SENT, so the rider was told their good code was dead.
    expect(entered('SR-ABCD-EFGH-JKMN')).not.toBe('SR-SRAB-CDEF-GHJK');
    expect(entered('SRABCDEFGHJKMN')).not.toBe('SR-SRAB-CDEF-GHJK');
  });

  it('a half-typed code is refused locally, never sent as something else', () => {
    for (const partial of ['S', 'SR', 'SR-', 'SR-ABCD', 'SR-ABCD-EFGH', 'ABCDEFGHJK']) {
      expect(`${partial} -> ${entered(partial)}`).toBe(`${partial} -> null`);
    }
  });
});
