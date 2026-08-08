import { describe, expect, it } from 'vitest';
import {
  CODES_IDLE,
  actSettled,
  actStart,
  codesView,
  dismissCode,
  mintAvis,
  mintAvisKey,
  refuseAct,
  type RiderRow,
} from '../src/rider-codes';
import { t } from '../src/i18n';

/**
 * SE-LIVE-4e — the rider code desk's decisions. Pure, so every state is
 * testable without a browser or a server.
 */

const rider = (riderId: string, hasCode: boolean): RiderRow => ({
  riderId,
  displayName: riderId,
  hasCode,
  certified: true,
});

describe('what the desk shows', () => {
  it('has a designed state for every answer, never a blank table', () => {
    expect(codesView({ kind: 'loading' })?.kind).toBe('loading');
    expect(codesView({ kind: 'failed' })?.kind).toBe('failed');
    expect(codesView({ kind: 'ok', riders: [] })?.kind).toBe('empty');
    expect(codesView({ kind: 'ok', riders: [rider('r1', false)] })?.kind).toBe('liste');
  });

  it('⚠ a refused key never renders as a section', () => {
    // One door, one sentence. Rendering a « failed » table under a bad key
    // would tell the founder the service is broken when his key is simply
    // wrong — and he would go looking in the wrong place.
    expect(codesView({ kind: 'bad_key' })).toBeNull();
  });

  it('every message it names is a real catalog string', () => {
    for (const read of [{ kind: 'loading' }, { kind: 'failed' }, { kind: 'ok', riders: [] }] as const) {
      const view = codesView(read);
      const message = view !== null && 'message' in view ? view.message : '';
      expect(t(message), message).not.toBe(message); // resolved, not echoed back
    }
  });
});

describe('⚠ the mint warning, before the tap', () => {
  const roster = [rider('rider-issa', true), rider('rider-awa', false)];

  it('warns that a new code KILLS the one the rider is using', () => {
    // A rider mid-course whose code is replaced is locked out of their own
    // custody acts — they cannot verify a pickup or register a seal.
    expect(mintAvis(roster, 'rider-issa')).toBe('remplace');
    expect(t(mintAvisKey('remplace'))).toContain('remplace');
  });

  it('says an unregistered id is unregistered, instead of letting the server refuse', () => {
    expect(mintAvis(roster, 'rider-typo')).toBe('inconnu');
  });

  it('and the plain case is plain', () => {
    expect(mintAvis(roster, 'rider-awa')).toBe('pret');
  });

  it('ignores stray whitespace, which is what a paste actually carries', () => {
    expect(mintAvis(roster, '  rider-awa  ')).toBe('pret');
  });
});

describe('⚠ a live one-time code blocks every other act', () => {
  it('refuses the next act while the code is still on screen, and says why', () => {
    // The plaintext exists nowhere else — the server hands it over once. A tap
    // that silently destroyed it mid-handover is the finding the Boutik+ desk
    // already paid for.
    const showing = actSettled(
      actStart(CODES_IDLE, 'mint') as never,
      'mint',
      { ok: true, riderId: 'rider-awa', code: 'SR-AAAA-BBBB-CCCC' },
    );
    expect(showing.nouveau?.code).toBe('SR-AAAA-BBBB-CCCC');
    expect(refuseAct(showing)).toBe('codes.notez_dabord');
    expect(actStart(showing, 'revoke:rider-issa')).toBeNull();
    // …and it clears only when the founder says so.
    expect(refuseAct(dismissCode(showing))).toBeNull();
  });

  it('refuses a second act while one is in flight', () => {
    const busy = actStart(CODES_IDLE, 'mint') as never;
    expect(refuseAct(busy)).toBe('codes.un_acte');
    expect(actStart(busy, 'mint')).toBeNull();
  });

  it('⚠ a late answer cannot resurrect a card the founder dismissed', () => {
    const busy = actStart(CODES_IDLE, 'mint') as never;
    const dismissed = dismissCode(actSettled(busy, 'mint', { ok: true, riderId: 'r', code: 'SR-1' }));
    // The same act settling twice (a retried promise) must not put the code back.
    expect(actSettled(dismissed, 'mint', { ok: true, riderId: 'r', code: 'SR-1' }).nouveau).toBeNull();
  });

  it('a revoke shows no card — there is no plaintext to show', () => {
    const busy = actStart(CODES_IDLE, 'revoke:rider-issa') as never;
    const done = actSettled(busy, 'revoke:rider-issa', { ok: true, riderId: 'rider-issa' });
    expect(done.nouveau).toBeNull();
    expect(done.echec).toBeNull();
  });

  it('⚠ a failure names its own act, so the wrong row cannot light up', () => {
    // Namespaced, so a rider literally named « mint » cannot collide.
    const busy = actStart(CODES_IDLE, 'revoke:mint') as never;
    const failed = actSettled(busy, 'revoke:mint', { ok: false });
    expect(failed.echec).toBe('revoke:mint');
    expect(failed.busy).toBeNull();
  });
});
