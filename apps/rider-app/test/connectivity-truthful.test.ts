import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SERA-S4 (GP-SERA · closes the durability arc) — connectivity is REAL, behind a
 * port, never a compile-time constant. RED-PROOF of the conflation this slice kills:
 * `custody-flow.ts` shipped `export const CONNECTIVITY = 'online'` and the App
 * threaded THAT constant into the store's queued-vs-sent decisions (`declineCourse`
 * relied on the constant default; `fireSos` passed `connectivity: CONNECTIVITY`) —
 * so an OFFLINE decline/SOS was treated as ONLINE (sent, not queued). Against the
 * pre-fix code these assertions FAIL, proving the constant was load-bearing and
 * wrong. Offline-first law (SE-I06 family): queued = pending, never done.
 */

const rider = (p: string): string => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

describe('SERA-S4 — connectivity is real, not a constant', () => {
  it('the CONNECTIVITY constant is GONE from custody-flow (a real port replaces it)', () => {
    expect(rider('src/custody-flow.ts')).not.toMatch(/export const CONNECTIVITY/);
  });

  it('the App threads the real connectivity signal into the store — never the retired constant', () => {
    const app = rider('App.tsx');
    // the decline must receive the real connectivity signal (not a constant default)
    expect(app).toMatch(/declineCourse\(\s*world,\s*active\.id,\s*connectivity/);
    // no store call is fed the retired compile-time constant
    expect(app).not.toMatch(/connectivity:\s*CONNECTIVITY/);
    expect(app).not.toMatch(/\bCONNECTIVITY\b/);
  });
});
