import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT, isEnabled, isKilled, parseSnapshot } from '../src/index.js';

// Contract §7.2: flags/kill-switches consumed read-only; fail-safe defaults.

describe('flags-client (read-only stub)', () => {
  it('a flag is OFF unless the snapshot explicitly enables it (fail-safe)', () => {
    expect(isEnabled(EMPTY_SNAPSHOT, 'anything')).toBe(false);
    const snap = parseSnapshot({
      version: 'v1',
      flags: { demo_capability: true, dark_capability: false },
      kills: [],
      killedCategories: [],
    });
    expect(isEnabled(snap, 'demo_capability')).toBe(true);
    expect(isEnabled(snap, 'dark_capability')).toBe(false);
    expect(isEnabled(snap, 'unknown')).toBe(false);
  });

  it('kill switches cover checkout · dispatch · payout · single category (§7.2)', () => {
    const snap = parseSnapshot({
      version: 'v2',
      flags: {},
      kills: ['dispatch'],
      killedCategories: ['cat-electronics'],
    });
    expect(isKilled(snap, 'dispatch')).toBe(true);
    expect(isKilled(snap, 'checkout')).toBe(false);
    expect(isKilled(snap, 'payout')).toBe(false);
    expect(isKilled(snap, 'category', 'cat-electronics')).toBe(true);
    expect(isKilled(snap, 'category', 'cat-textiles')).toBe(false);
  });

  it('rejects malformed snapshots instead of half-applying them', () => {
    expect(() => parseSnapshot({ version: 'v1', flags: { a: 'yes' }, kills: [], killedCategories: [] })).toThrow();
    expect(() => parseSnapshot({ version: 'v1', flags: {}, kills: ['everything'], killedCategories: [] })).toThrow();
    expect(() => parseSnapshot(null)).toThrow();
  });
});
