import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FAILURE_REASON_IDS,
  nextAfterEvidence,
  stepAfterDoorSignal,
  stepAfterInspection,
  stepAfterWindowExpiry,
} from '../src/custody-flow.js';
import { COURSE_OPEN_STEPS, JOURNEY, SEALED_BACK_STEPS, START, type Screen } from '../src/journey.js';

/**
 * WO-4.1 spine coverage: the walkable-world promise as assertions. Every
 * screen must be reachable from START by touch (BFS over the journey map),
 * every edge must point at a real screen, the App must render every screen
 * the map names, and the rule-owned edges must be exactly what
 * custody-flow.ts produces — the map may never re-encode a custody
 * transition.
 */

const screens = Object.keys(JOURNEY) as Screen[];

describe('rider journey spine', () => {
  it('every screen is reachable from START', () => {
    const seen = new Set<Screen>([START]);
    const queue: Screen[] = [START];
    while (queue.length > 0) {
      for (const next of JOURNEY[queue.shift()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const s of screens) expect(seen.has(s), `unreachable screen: ${s}`).toBe(true);
  });

  it('no edge dangles (every target is a declared screen)', () => {
    for (const s of screens) {
      for (const target of JOURNEY[s]) {
        expect(screens.includes(target), `${s} → ${target}`).toBe(true);
      }
    }
  });

  it('the App renders a block for every screen in the map', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');
    for (const s of screens) {
      expect(source).toMatch(new RegExp(`screen === '${s}'`));
    }
  });

  it('the App navigates only along journey edges and always offers retour + reset + a FlatList', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');
    expect(source).toMatch(/JOURNEY\[stack\[stack\.length - 1\] \?\? START\]\.includes\(next\)/);
    expect(source).toMatch(/t\('nav\.retour'\)/);
    expect(source).toMatch(/t\('nav\.recommencer'\)/);
    expect(source).toMatch(/<FlatList/);
  });

  it('rule-owned edges are exactly what custody-flow produces — both branches, never re-encoded', () => {
    // WO-2.4 mapping (as in the shell): the door inspection precedes the drop.
    const afterEvidence = (c: 'online' | 'offline') => {
      const n = nextAfterEvidence(c);
      return n === 'drop' ? 'door_inspection' : n;
    };
    expect([...JOURNEY.evidence].sort()).toEqual(
      [...new Set([afterEvidence('online'), afterEvidence('offline')])].sort(),
    );
    // SE-I11: the ONLY edge out of the payment wait is the provider-confirmed
    // outcome; the pending signal is a state, not an edge.
    expect([...JOURNEY.payment_wait]).toEqual([stepAfterDoorSignal('confirmed')]);
    expect(stepAfterDoorSignal('pending')).toBe('payment_wait');
    for (const mode of ['DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR', 'FULL_PREPAY'] as const) {
      expect(JOURNEY.door_inspection).toContain(stepAfterInspection(mode));
    }
    for (const reason of FAILURE_REASON_IDS) {
      expect(JOURNEY.retry_window).toContain(stepAfterWindowExpiry(reason));
    }
    // The drop code is LAST: nothing reaches 'drop' except the door rules —
    // and the course list, which only resumes a course the rules already
    // walked there (mid-custody « Retour », state kept).
    const dropSources = screens.filter((s) => JOURNEY[s].includes('drop'));
    expect(dropSources.sort()).toEqual(['courses', 'door_inspection', 'payment_wait']);
  });

  it('mid-custody « Retour » returns to the course list with state kept — sealed steps never pop', () => {
    expect([...SEALED_BACK_STEPS].sort()).toEqual([
      'door_inspection',
      'drop',
      'evidence',
      'evidence_pending',
      'payment_wait',
    ]);
    const source = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');
    expect(source).toMatch(/SEALED_BACK_STEPS\.includes\(stack\[stack\.length - 1\] \?\? START\)/);
    expect(source).toMatch(/setStack\(\[START, 'courses'\]\)/);
    // every step a course can be saved at reopens from the list, by edge
    for (const s of SEALED_BACK_STEPS) expect(COURSE_OPEN_STEPS).toContain(s);
    for (const s of COURSE_OPEN_STEPS) expect(JOURNEY.courses).toContain(s);
  });
});
