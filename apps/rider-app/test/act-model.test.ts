import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import { ACT_IDLE, holdsPackage, maySeal, packageIsHeld, sealScreenIsDue, sealOutcome, verifyOutcome } from '../src/net/act-model';
import { assignmentStateKey, landmarkLines } from '../src/net/rider-session';
import type { CustodyAnswer } from '../src/net/custody-acts';

/**
 * SE-LIVE-4c-vi · what the rider is told after a custody act.
 *
 * The pickup code comes from the dispatcher by phone and the seal id is typed
 * off the seal (founder rulings, 2026-08-07). What these tests protect is the
 * meaning of each answer — above all that **a refused package is not an
 * error**, and that nothing but the ledger may say a rider holds a package.
 */

const recorded = (body: Record<string, unknown>): CustodyAnswer => ({ kind: 'recorded', duplicate: false, body });

describe('a refused package is a custody fact, not a failure', () => {
  it('an ACCEPTED verification lets the rider go on to the seal', () => {
    const answer = recorded({ ok: true, kind: 'accepted' });
    expect(verifyOutcome(answer)).toEqual({ title: 'acts.verify_accepted', tone: 'ok' });
    expect(maySeal({ kind: 'answered', answer })).toBe(true);
  });

  it('⚠ a REFUSED verification says the seller keeps the package — and blocks the seal', () => {
    // The server answers 200 {ok:true, kind:'refused'} — the same shape as an
    // acceptance. Reading "did the request succeed" is how blocker A4 got in.
    const answer = recorded({ ok: true, kind: 'refused' });
    const out = verifyOutcome(answer);
    expect(out.tone).toBe('refused');
    expect(t(out.title)).toBe('Colis refusé. Le vendeur garde le colis.');
    // SE-I05: the seal may not follow a verification the ledger refused.
    expect(maySeal({ kind: 'answered', answer })).toBe(false);
    expect(holdsPackage({ kind: 'answered', answer })).toBe(false);
  });

  it('the refusal never reads as the rider having done something wrong', () => {
    // French Voice + the trust test: the refusal path is as dignified as the
    // purchase path. It states where the package IS, not what went wrong.
    const words = t(verifyOutcome(recorded({ ok: true, kind: 'refused' })).title);
    expect(words).toContain('vendeur garde');
    for (const blame of ['erreur', 'échec', 'invalide', 'impossible']) {
      expect(`${blame} in refusal: ${words.toLowerCase().includes(blame)}`).toBe(`${blame} in refusal: false`);
    }
  });
});

describe('only the ledger says a rider holds a package', () => {
  it('a sealed custody transition is the one thing that says so', () => {
    const answer = recorded({ ok: true, status: 'custody_with_courier' });
    expect(sealOutcome(answer)).toEqual({ title: 'acts.custody_taken', tone: 'ok' });
    expect(holdsPackage({ kind: 'answered', answer })).toBe(true);
  });

  it('⚠ NOTHING else does — not offline, not a refusal, not a dead server', () => {
    const answers: CustodyAnswer[] = [
      { kind: 'offline' },
      { kind: 'unauthorized' },
      { kind: 'unreachable', reason: 'custody_object_unavailable' },
      { kind: 'refused', reason: 'seal_already_used' },
      { kind: 'refused', reason: 'rider_did_not_verify_this_pickup' },
      recorded({ ok: true, kind: 'accepted' }), // a verification is not custody
      recorded({ ok: true }), // recorded, but nothing named
    ];
    for (const answer of answers) {
      const label = `${answer.kind}/${'reason' in answer ? answer.reason : ''}`;
      expect(`${label} -> ${holdsPackage({ kind: 'answered', answer })}`).toBe(`${label} -> false`);
    }
    expect(holdsPackage(ACT_IDLE)).toBe(false);
    expect(holdsPackage({ kind: 'working' })).toBe(false);
  });
});

describe('the three non-ledger answers stay apart, for both acts', () => {
  it('offline says nothing was stored, and promises the network will finish it', () => {
    for (const out of [verifyOutcome({ kind: 'offline' }), sealOutcome({ kind: 'offline' })]) {
      expect(out.tone).toBe('waiting');
      expect(t(out.title)).toBe('Pas de réseau.');
    }
  });

  it('⚠ unreachable reassures that nothing is lost — the same act may be retried', () => {
    const out = sealOutcome({ kind: 'unreachable', reason: 'custody_object_unavailable' });
    expect(out.tone).toBe('waiting');
    expect(t(out.hint ?? '')).toContain("Rien n'est perdu");
  });

  it('a dead code is about the CODE, never about the package', () => {
    const out = sealOutcome({ kind: 'unauthorized' });
    expect(t(out.title)).toBe('Ce code ne marche pas.');
    expect(t(out.hint ?? '')).toContain('Séra');
  });

  it("custody's own named refusals are shown, not retried", () => {
    for (const reason of ['seal_already_used', 'package_claim_not_held', 'rider_did_not_verify_this_pickup']) {
      const out = sealOutcome({ kind: 'refused', reason });
      expect(`${reason} -> ${out.tone}`).toBe(`${reason} -> refused`);
    }
  });
});

describe('every outcome has real words behind it', () => {
  it('resolves for every answer shape, and never throws on a missing key', () => {
    const answers: CustodyAnswer[] = [
      recorded({ ok: true, kind: 'accepted' }),
      recorded({ ok: true, kind: 'refused' }),
      recorded({ ok: true, status: 'custody_with_courier' }),
      { kind: 'offline' },
      { kind: 'unauthorized' },
      { kind: 'unreachable' },
      { kind: 'refused', reason: 'x' },
    ];
    for (const answer of answers) {
      for (const out of [verifyOutcome(answer), sealOutcome(answer)]) {
        // `t` throws on an unknown key — this is real coverage.
        expect(t(out.title).length).toBeGreaterThan(0);
        if (out.hint !== undefined) expect(t(out.hint).length).toBeGreaterThan(0);
      }
    }
  });

  it('the screen strings for both acts exist', () => {
    for (const key of [
      'verify.code_title', 'verify.code_hint', 'verify.code_placeholder', 'verify.action_send',
      'seal.id_title', 'seal.id_hint', 'seal.id_placeholder', 'seal.action_send',
      'acts.sending',
    ]) {
      expect(t(key).length).toBeGreaterThan(0);
    }
  });

  it('the pickup-code hint says where the code comes from — the dispatcher', () => {
    // Founder ruling: « the dispatcher will give it to rider ». A rider who
    // does not know where to get the code cannot start.
    expect(t('verify.code_hint')).toContain('Séra');
    expect(t('verify.code_hint')).toContain('téléphone');
  });

  it('the seal hint says to read it off the seal being applied', () => {
    expect(t('seal.id_hint')).toContain('scellé');
  });
});

describe('⚠ the assignment projection (A10)', () => {
  it('puts the landmark first, then the indications, then the zone', () => {
    // SE0.3, the display law both shells follow. The words a rider navigates
    // by lead; the GPS pin never does.
    expect(landmarkLines({ landmark: 'Face à la pharmacie', directions: 'Deuxième porte bleue', zone: 'Gounghin' }))
      .toEqual(['Face à la pharmacie', 'Deuxième porte bleue', 'Gounghin']);
  });

  it('degrades honestly rather than crashing a rider’s only screen', () => {
    // This arrives over the network; malformed must mean "no landmark yet".
    for (const bad of [null, undefined, 'a string', 42, {}, { directions: 'x', zone: 'y' }, { landmark: '   ' }]) {
      expect(`${JSON.stringify(bad)} -> ${landmarkLines(bad)}`).toBe(`${JSON.stringify(bad)} -> null`);
    }
  });

  it('tolerates a partial location — the landmark alone still leads', () => {
    expect(landmarkLines({ landmark: 'Chez Salif' })).toEqual(['Chez Salif', '', '']);
  });

  it('turns every status into a word, and never leaks an unknown enum', () => {
    expect(t(assignmentStateKey('active_unacknowledged'))).toBe('Course à faire');
    expect(t(assignmentStateKey('acknowledged'))).toBe('Course acceptée');
    // Anything the server adds later degrades to the neutral word rather than
    // showing a raw token to a rider.
    for (const unknown of ['ack_pending_offline', 'something_new_v2', '']) {
      expect(t(assignmentStateKey(unknown))).toBe('En attente');
    }
  });
});

describe('⚠ what the screen shows after an OS kill (A2 · founder ruling ③)', () => {
  const accepted: CustodyAnswer = { kind: 'recorded', duplicate: false, body: { ok: true, kind: 'accepted' } };
  const refused: CustodyAnswer = { kind: 'recorded', duplicate: false, body: { ok: true, kind: 'refused' } };
  const custody: CustodyAnswer = { kind: 'recorded', duplicate: false, body: { status: 'custody_with_courier' } };
  const answered = (a: CustodyAnswer) => ({ kind: 'answered', answer: a }) as const;

  it('puts a relaunched rider back on the seal instead of the spent checklist', () => {
    // The harm: an Android kill between an accepted verification and the seal
    // dropped the rider onto the checklist against a pickup code the spine had
    // already consumed — `secret_already_used`, permanently, no way back.
    expect(sealScreenIsDue(ACT_IDLE, 'verification_accepted')).toBe(true);
    expect(packageIsHeld(ACT_IDLE, 'custody_taken')).toBe(true);
    // A rider who had taken custody is past the seal, not back at it.
    expect(sealScreenIsDue(ACT_IDLE, 'custody_taken')).toBe(true);
  });

  it('remembers nothing when nothing was reached', () => {
    expect(sealScreenIsDue(ACT_IDLE, 'none')).toBe(false);
    expect(packageIsHeld(ACT_IDLE, 'none')).toBe(false);
    expect(packageIsHeld(ACT_IDLE, 'verification_accepted')).toBe(false);
  });

  it('⚠ a LIVE ledger answer always outranks the phone’s memory', () => {
    // This is the safety property. If the ledger has spoken in this session,
    // memory must never override it — otherwise a stale « accepted » would
    // walk a rider past a refusal, or a stale « custody » would claim goods
    // the server says are still the seller's.
    expect(sealScreenIsDue(answered(refused), 'verification_accepted')).toBe(false);
    expect(packageIsHeld(answered(refused), 'custody_taken')).toBe(false);
    // …and it does not suppress a live acceptance either.
    expect(sealScreenIsDue(answered(accepted), 'none')).toBe(true);
    expect(packageIsHeld(answered(custody), 'none')).toBe(true);
  });

  it('a request still in flight is not an answer, so memory fills the gap', () => {
    expect(sealScreenIsDue({ kind: 'working' }, 'verification_accepted')).toBe(true);
  });
});
