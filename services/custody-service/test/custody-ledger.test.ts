import { describe, expect, it } from 'vitest';
import { CustodyLedger, type LedgerEntry } from '../src/custody-ledger.js';

const T = '2026-07-10T12:00:00.000Z';

function ledgerWithCourier(): CustodyLedger {
  const ledger = new CustodyLedger();
  ledger.append({ packageId: 'pkg-1', kind: 'custody_transition', payload: { to: 'seller:sup-1' }, at: T });
  ledger.append({ packageId: 'pkg-1', kind: 'pickup_verification', payload: { result: 'accepted' }, at: T });
  ledger.append({ packageId: 'pkg-1', kind: 'custody_transition', payload: { from: 'seller:sup-1', to: 'courier:r-1' }, at: T });
  return ledger;
}

describe('custody ledger — SE4.1 append-only, hash-chained, one current custodian', () => {
  it('appends hash-linked entries; the full chain verifies', () => {
    const ledger = ledgerWithCourier();
    expect(ledger.all()).toHaveLength(3);
    expect(ledger.all()[1]!.prevHash).toBe(ledger.all()[0]!.hash);
    expect(ledger.all()[2]!.prevHash).toBe(ledger.all()[1]!.hash);
    expect(ledger.verifyChain()).toEqual({ valid: true });
    expect(ledger.currentCustodian('pkg-1')).toBe('courier:r-1');
  });

  it('TAMPER TEST: mutating ANY committed entry breaks chain verification at that seq', () => {
    // WO-2.1 finding ② sealed the all() alias, so hostile mutation is
    // simulated the only way left: reaching the PRIVATE store directly
    // (white-box — what a memory-level attacker or a bug inside the class
    // could do). verifyChain still catches it.
    const ledger = ledgerWithCourier();
    const internals = (ledger as unknown as { entries: LedgerEntry[] }).entries;
    internals[1]!.payload['result'] = 'refused';
    expect(ledger.verifyChain()).toEqual({ valid: false, brokenAtSeq: 1 });
    // And tampering the FIRST entry breaks at seq 0 — no entry is exempt.
    const ledger2 = ledgerWithCourier();
    (ledger2 as unknown as { entries: LedgerEntry[] }).entries[0]!.at = '1999-01-01T00:00:00.000Z';
    expect(ledger2.verifyChain()).toEqual({ valid: false, brokenAtSeq: 0 });
  });

  it('WO-2.1 finding ② — all() is a DEEPLY frozen defensive copy: mutation attempts at ANY depth cannot touch the ledger', () => {
    const ledger = ledgerWithCourier();
    // An entry whose payload carries a NESTED ARRAY — the depth the
    // verifier's blocking finding attacked (photoRefs aliasing the store):
    ledger.append({
      packageId: 'pkg-1',
      kind: 'custody_seal_registered',
      payload: { photoRefs: ['media/seal.jpg'] },
      at: T,
    });
    const view = ledger.all();
    // Array-level mutations throw (frozen) and change nothing:
    expect(() => (view as LedgerEntry[]).push({} as LedgerEntry)).toThrow();
    expect(() => ((view as LedgerEntry[])[1] = {} as LedgerEntry)).toThrow();
    // Entry-level and payload-level mutations are equally sealed:
    expect(() => ((view[1] as LedgerEntry).payload['result'] = 'refused')).toThrow();
    expect(() => (((view[0] as LedgerEntry) as LedgerEntry & { at: string }).at = 'x')).toThrow();
    // THE DEEP ATTACK (verifier blocking finding): pushing into a nested
    // payload array through the view must throw and must NOT reach the
    // store — no poisoning, chain stays valid.
    const sealView = view[3]!;
    expect(() => (sealView.payload['photoRefs'] as string[]).push('evil-injected.jpg')).toThrow();
    expect(ledger.all()[3]!.payload['photoRefs']).toEqual(['media/seal.jpg']);
    // The ledger itself is untouched — chain still verifies, length intact:
    expect(ledger.all()).toHaveLength(4);
    expect(ledger.all()[1]!.payload['result']).toBe('accepted');
    expect(ledger.verifyChain()).toEqual({ valid: true });
    // Successive calls hand out fresh copies, never a shared alias:
    expect(ledger.all()).not.toBe(view);
  });

  it('ONE CURRENT CUSTODIAN at the store: a second concurrent custodian write is REFUSED, nothing appended', () => {
    const ledger = ledgerWithCourier();
    const before = ledger.all().length;
    // A concurrent writer claims custody FROM the seller — but the courier
    // holds it now. Refused closed at the store, not merged.
    const conflict = ledger.append({
      packageId: 'pkg-1',
      kind: 'custody_transition',
      payload: { from: 'seller:sup-1', to: 'courier:r-IMPOSTOR' },
      at: T,
    });
    expect(conflict).toEqual({ ok: false, reason: 'custodian_conflict' });
    expect(ledger.all()).toHaveLength(before);
    expect(ledger.currentCustodian('pkg-1')).toBe('courier:r-1');
    // A transition with no `to` is malformed — refused.
    expect(ledger.append({ packageId: 'pkg-1', kind: 'custody_transition', payload: { from: 'courier:r-1' }, at: T }))
      .toEqual({ ok: false, reason: 'malformed_transition' });
  });

  it('append-only is structural: the ledger exposes no update or delete API', () => {
    const ledger = ledgerWithCourier();
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(ledger));
    expect(api.filter((m) => /update|delete|remove|set(?!tings)/i.test(m))).toEqual([]);
  });
});
