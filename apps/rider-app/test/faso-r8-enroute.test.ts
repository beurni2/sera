import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stepAfterEvidenceAck } from '../src/custody-flow.js';
import { JOURNEY, START, type Screen } from '../src/journey.js';

/**
 * R8 « En route » (planche HANDOFF §4 R8) — a DISPLAY waypoint between the acked
 * proof and the door: « un seul arrêt », the repère IS the navigation (Law #5 —
 * no GPS point, no route model).
 *
 * THE LAW THIS FIXTURE PROTECTS — journey.ts owns no custody transition
 * (journey.ts:17-21). R8 is inserted on the applied-ack path WITHOUT re-encoding
 * that transition: the custody target is UNCHANGED (the store still advances the
 * course to door_inspection), and en_route is a pure NAV hop whose sole edge is
 * that same rule output. The rider taps « Je suis à la porte » to reach the door
 * the rule already set. No custody move happens on the en_route screen.
 */

const appDir = join(new URL('.', import.meta.url).pathname, '..');
const read = (p: string): string => readFileSync(join(appDir, p), 'utf8');
const app = read('App.tsx');

/** The en_route render block (display waypoint) and the evidence_pending block. */
const enroute = app.slice(app.indexOf("screen === 'en_route'"), app.indexOf("screen === 'door_inspection'"));
const evidencePending = app.slice(app.indexOf("screen === 'evidence_pending'"), app.indexOf("screen === 'en_route'"));

/** The custody-flow output for an applied evidence ack (the rule's target). */
const custodyTarget: Screen = stepAfterEvidenceAck('applied') === 'drop' ? 'door_inspection' : stepAfterEvidenceAck('applied');

interface CatEntry { key: string; fr: string; register: string }
const catalog: CatEntry[] = JSON.parse(read('i18n/catalog.json'));
const byKey = new Map(catalog.map((e) => [e.key, e]));

describe('R8 en_route — a display waypoint whose sole edge is the unchanged custody target', () => {
  it('evidence_pending advances to en_route (the display hop), never to the door directly', () => {
    expect([...JOURNEY.evidence_pending].sort()).toEqual(['courses', 'en_route'].sort());
    expect(JOURNEY.evidence_pending).not.toContain('door_inspection'); // the door is one hop later, via en_route
  });

  it("en_route's SOLE forward edge is EXACTLY the custody-flow output — the target is unchanged", () => {
    expect(custodyTarget).toBe('door_inspection');
    expect([...JOURNEY.en_route]).toEqual([custodyTarget]);
  });

  it('en_route is reachable from START (the walkable-world promise holds with the node inserted)', () => {
    const seen = new Set<Screen>([START]);
    const queue: Screen[] = [START];
    while (queue.length > 0) for (const n of JOURNEY[queue.shift()!]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    expect(seen.has('en_route')).toBe(true);
    expect(seen.has('door_inspection')).toBe(true);
  });
});

describe('R8 en_route — the screen carries NO custody move (pure navigation)', () => {
  it('the en_route block renders the repère nav card + the no-GPS quote + the arrival CTA', () => {
    expect(enroute).toContain('<FasoLandmarkCard');
    expect(enroute).toContain("t('repere.no_gps')"); // « le repère est la route » — no GPS point, no route model
    expect(enroute).toMatch(/label=\{t\('enroute\.arrived_action'\)\} onPress=\{\(\) => go\('door_inspection'\)\}/);
  });

  it('en_route moves NOTHING — no walk(), no store custody call; only go() to the rule target', () => {
    expect(enroute).not.toMatch(/\bwalk\(/);
    expect(enroute).not.toMatch(/ServerAck|acceptInspection|registerSeal|captureEvidence|applyProviderDoorSignal|validateDropCode/);
    // the ONLY navigation out of en_route is to the door the rule produced
    expect(enroute.match(/go\('[^']+'\)/g)).toEqual(["go('door_inspection')"]);
  });

  it('the custody move stays on the ack: evidence_pending runs the store ack, THEN steps to en_route', () => {
    expect(evidencePending).toMatch(/applyEvidenceServerAck\(world, active\.id, SANDBOX_EVIDENCE_ACK\)/);
    // the store advance precedes the display hop — target set first, waypoint second
    expect(evidencePending.indexOf('applyEvidenceServerAck')).toBeLessThan(evidencePending.indexOf("go('en_route')"));
  });
});

describe('R8 en_route — custody-flow stays frozen (en_route is a journey-only screen)', () => {
  it("'en_route' is NOT a custody step — it never appears in custody-flow.ts", () => {
    expect(read('src/custody-flow.ts')).not.toContain('en_route');
  });

  it('both en_route strings exist, register neutral', () => {
    for (const k of ['enroute.title', 'enroute.arrived_action']) {
      expect(byKey.get(k), `${k} missing`).toBeDefined();
      expect(byKey.get(k)!.register).toBe('neutral');
    }
    expect(byKey.get('enroute.arrived_action')!.fr).toBe('Je suis à la porte');
  });
});
