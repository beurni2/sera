import { describe, expect, it } from 'vitest';
import { demoShiftActs, refusFromBody, refusServiceKey, shiftFromActBody } from '../src/net/shift-acts';
import { t } from '../src/i18n';

/**
 * COURSIER-EN-SERVICE — the port's pure readers. The full seam (the app's own
 * ports climbing SE1's ladder against the REAL Worker, judged by the board's
 * `assignable`) lives in `services/logistics-service/test/shift-acts.e2e.test.ts`;
 * what is pinned here is the vocabulary: every refusal resolves to a real
 * catalog sentence, and an unwired build mimes nothing.
 */

describe('every refusal the screen can show is a real catalog sentence', () => {
  it('maps each named refusal to a string the catalog actually carries', () => {
    for (const refus of [
      'not_certified', 'privacy_notice_not_acknowledged', 'already_on_shift',
      'not_on_shift', 'custody_would_be_orphaned', 'autre',
    ] as const) {
      const key = refusServiceKey(refus);
      expect(t(key), key).not.toBe(key);
    }
  });

  it('a refusal body is read by NAME, and an unknown name degrades to the generic — never a raw token', () => {
    expect(refusFromBody({ ok: false, reason: 'not_certified' })).toBe('not_certified');
    expect(refusFromBody({ ok: false, reason: 'something_new' })).toBe('autre');
    expect(refusFromBody(null)).toBe('autre');
  });
});

describe('the 200 body’s state is required, never assumed', () => {
  it('a well-formed act answer yields the registry’s own state', () => {
    expect(shiftFromActBody({ ok: true, state: { status: 'on_shift', startedAt: 'x', confirmedBy: 'server' } }))
      .toEqual({ status: 'on_shift', startedAt: 'x', confirmedBy: 'server' });
  });

  it('a 200 whose body cannot be read is NO state — corroborated, not counted', () => {
    for (const bad of [null, 'ok', { ok: true }, { ok: true, state: 'on' }, { ok: true, state: {} }, { ok: false, state: { status: 'on_shift' } }]) {
      expect(shiftFromActBody(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('an unwired build mimes no service state', () => {
  it('every act answers unauthorized, mirroring demoRiderSession', async () => {
    const demo = demoShiftActs();
    expect(await demo.ackPrivacy('SR-AAAA-BBBB-CCCC')).toEqual({ ok: false, reason: 'unauthorized' });
    expect(await demo.startShift('SR-AAAA-BBBB-CCCC')).toEqual({ ok: false, reason: 'unauthorized' });
    expect(await demo.endShift('SR-AAAA-BBBB-CCCC')).toEqual({ ok: false, reason: 'unauthorized' });
  });
});
