import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import { refusalKeys, submit } from '../src/net/signin-model';
import type { RiderSessionPort, SignInResult } from '../src/net/rider-session';

/**
 * SE-LIVE-4c-ii · what the rider is told, and why it has to be four sentences.
 *
 * A rider whose income depends on this code needs « ask Séra for a new one »
 * and « Séra is down, your code is fine » to be DIFFERENT. Telling them the
 * wrong one costs a morning: they ride across Ouaga to see the founder about a
 * code that was never broken, or they stand at a stall retrying a code that is
 * genuinely dead.
 */

const SESSION = {
  riderId: 'rider-0001',
  displayName: 'Issa',
  certified: true,
  privacyAckOk: true,
  noticeVersion: 'v1',
  shift: null,
  assignment: null,
};

const portThat = (result: SignInResult, spy?: { calls: string[] }): RiderSessionPort => ({
  async signIn(code: string) {
    spy?.calls.push(code);
    return result;
  },
});

const GOOD = 'SR-ABCD-EFGH-JKMN';

describe('the four outcomes are four different answers', () => {
  it('a good code signs in and keeps the normalised code for the acts that follow', async () => {
    const spy = { calls: [] as string[] };
    // Typed sloppily — lowercase, no dashes — as it will be in the sun.
    const state = await submit(portThat({ ok: true, session: SESSION }, spy), 'srabcdefghjkmn');
    expect(state.kind).toBe('signed_in');
    if (state.kind !== 'signed_in') throw new Error('unreachable');
    expect(state.session.riderId).toBe('rider-0001');
    // The CANONICAL form went to the port — logistics hashes that exact string.
    expect(spy.calls).toEqual([GOOD]);
    // …and is kept, because the custody acts reuse it as their Bearer.
    expect(state.code).toBe(GOOD);
  });

  it('an unreadable code is refused LOCALLY — nothing is sent', async () => {
    const spy = { calls: [] as string[] };
    const state = await submit(portThat({ ok: true, session: SESSION }, spy), 'SR-OOO');
    expect(state).toEqual({ kind: 'refused', why: 'unreadable' });
    // The whole point: a fat-fingered character does not cost a network
    // round-trip, and Séra is never asked to resolve garbage.
    expect(spy.calls).toEqual([]);
  });

  it('only `unauthorized` becomes « your code is dead »', async () => {
    expect(await submit(portThat({ ok: false, reason: 'unauthorized' }), GOOD)).toEqual({
      kind: 'refused',
      why: 'bad_code',
    });
  });

  it('a dead network and a dead directory are NOT « your code is dead »', async () => {
    expect(await submit(portThat({ ok: false, reason: 'offline' }), GOOD)).toEqual({
      kind: 'refused',
      why: 'offline',
    });
    expect(await submit(portThat({ ok: false, reason: 'unreachable' }), GOOD)).toEqual({
      kind: 'refused',
      why: 'unreachable',
    });
  });
});

describe('every refusal has real words behind it', () => {
  it('maps each refusal to two catalog keys that exist and differ', () => {
    const seen = new Set<string>();
    for (const why of ['unreadable', 'bad_code', 'offline', 'unreachable'] as const) {
      const { title, hint } = refusalKeys(why);
      // `t` THROWS on a missing key, so this is a real coverage assertion:
      // no refusal can ship pointing at a string nobody wrote.
      const titleText = t(title);
      const hintText = t(hint);
      expect(titleText.length).toBeGreaterThan(0);
      expect(hintText.length).toBeGreaterThan(0);
      // Four distinct headlines — if two refusals shared a sentence, the
      // rider could not tell which situation they are in.
      expect(seen.has(titleText)).toBe(false);
      seen.add(titleText);
    }
    expect(seen.size).toBe(4);
  });

  it('the unreachable hint says out loud that the code is fine', () => {
    // The fear at this moment is « I have been cut off ». The words must
    // answer it, not merely avoid blaming the rider.
    expect(t('signin.unreachable_hint')).toContain("Ce n'est pas votre code");
  });

  it('the dead-code hint sends the rider to the one person who can fix it', () => {
    expect(t('signin.bad_code_hint')).toContain('Séra');
  });

  it('the screen strings the sign-in needs all exist', () => {
    for (const key of ['signin.title', 'signin.hint', 'signin.action', 'signin.working', 'signin.greeting', 'signin.not_wired', 'signin.not_wired_hint']) {
      expect(t(key).length).toBeGreaterThan(0);
    }
  });
});
