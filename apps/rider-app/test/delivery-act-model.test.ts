import { describe, expect, it } from 'vitest';
import { deliveryChainOf, evidenceHeld, type CustodyAnswer } from '../src/net/custody-acts';
import { dropDone, dropOutcome, evidenceIsHeld, evidenceOutcome } from '../src/net/act-model';
import { subtleSha256Hex } from '../src/net/evidence-capture';

/**
 * RIDER-DELIVERY-SCREEN — the pure halves of the delivery act, executed.
 * The full road (verify → seal → evidence → founder decides → drop → the
 * LEDGER names the customer) runs against the REAL Worker in
 * custody-service/test/rider-path.e2e.test.ts, composing the bundle from the
 * begin answer's chain exactly as the screen does. What is pinned HERE is
 * every sentence the rider can be told, and the hash that signs the photo.
 */

const rec = (body: Record<string, unknown>): CustodyAnswer => ({ kind: 'recorded', duplicate: false, body });
const ref = (reason: string): CustodyAnswer => ({ kind: 'refused', reason });

describe('deliveryChainOf — the begin answer names what the phone now holds', () => {
  it('reads the chain, identifiers only', () => {
    expect(deliveryChainOf(rec({ status: 'custody_with_courier', chain: { task_id: 't-1', package_id: 'p-1' } })))
      .toEqual({ taskId: 't-1', packageId: 'p-1' });
  });
  it('an answer without it is an honest null — an old Worker, a replayed pre-upgrade command, garbage', () => {
    for (const bad of [
      rec({ status: 'custody_with_courier' }),
      rec({ chain: { task_id: '', package_id: 'p' } }),
      rec({ chain: { task_id: 't' } }),
      rec({ chain: 'oui' }),
      ref('custody_already_begun'),
      { kind: 'offline' } as CustodyAnswer,
    ]) {
      expect(deliveryChainOf(bad)).toBeNull();
    }
  });
});

describe('evidenceHeld / evidenceOutcome — the ledger holds the bundle, said once', () => {
  it('the Worker’s own word, and the already-submitted replay, are the same held truth', () => {
    expect(evidenceHeld(rec({ status: 'evidence_recorded' }))).toBe(true);
    expect(evidenceHeld(ref('evidence_already_submitted'))).toBe(true);
    expect(evidenceOutcome(rec({ status: 'evidence_recorded' }))).toEqual({ title: 'delivery.evidence_held', tone: 'ok' });
    expect(evidenceOutcome(ref('evidence_already_submitted'))).toEqual({ title: 'delivery.evidence_held', tone: 'ok' });
    expect(evidenceIsHeld({ kind: 'answered', answer: rec({ status: 'evidence_recorded' }) })).toBe(true);
  });
  it('a named custody refusal shows as a refusal; offline and unreachable keep their standing sentences', () => {
    expect(evidenceHeld(ref('evidence_chain_mismatch'))).toBe(false);
    expect(evidenceOutcome(ref('evidence_chain_mismatch')).tone).toBe('refused');
    expect(evidenceOutcome({ kind: 'offline' }).title).toBe('acts.offline');
    expect(evidenceOutcome({ kind: 'unreachable' }).title).toBe('acts.unreachable');
    expect(evidenceIsHeld({ kind: 'working' })).toBe(false);
  });
});

describe('dropOutcome — the buyer’s code, every answer a true sentence', () => {
  it('delivered (and déjà livrée) is the one OK terminal', () => {
    expect(dropOutcome(rec({ status: 'custody_with_customer' }))).toEqual({ title: 'delivery.done', tone: 'ok' });
    expect(dropOutcome(rec({ status: 'deja_livree' }))).toEqual({ title: 'delivery.done', tone: 'ok' });
    expect(dropDone({ kind: 'answered', answer: rec({ status: 'custody_with_customer' }) })).toBe(true);
  });
  it('a wrong code is NOT burned — « redemandez-le » is honest advice', () => {
    expect(dropOutcome(ref('drop_code_refused'))).toEqual({
      title: 'delivery.wrong_code', hint: 'delivery.wrong_code_hint', tone: 'refused',
    });
  });
  it('a too-early code waits with dignity — validation is the founder’s act, not an error wall', () => {
    for (const reason of ['not_validated', 'validation_before_evidence']) {
      expect(dropOutcome(ref(reason))).toEqual({
        title: 'delivery.not_validated', hint: 'delivery.not_validated_hint', tone: 'waiting',
      });
    }
  });
  it('anything else custody names is a plain refusal; transport answers keep their words', () => {
    expect(dropOutcome(ref('return_in_flight')).tone).toBe('refused');
    expect(dropOutcome({ kind: 'offline' }).title).toBe('acts.offline');
    expect(dropOutcome({ kind: 'unauthorized' }).title).toBe('signin.bad_code');
  });
});

describe('subtleSha256Hex — the artifact’s signature, measured, never invented', () => {
  it('hashes bytes to the known SHA-256 hex (Node’s WebCrypto)', async () => {
    // sha256("abc") — the FIPS 180-2 vector, byte for byte.
    expect(await subtleSha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
