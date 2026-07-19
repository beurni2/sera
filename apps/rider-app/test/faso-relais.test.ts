import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * R4/R8 « le relais » — the masked-call affordance (planche HANDOFF §4 R4:57 /
 * R8:65). notCalling → a ghost « Appeler — numéro masqué »; calling → the ink bar
 * with « RELAIS — LES DEUX NUMÉROS RESTENT PRIVÉS » + « Raccrocher ».
 *
 * THE LAW THIS FIXTURE PROTECTS — the « masqué » promise, and mock-honesty
 * (failure mode #8: no mock may look healthier than it is). At the walking-
 * skeleton stage there is NO telephony backend, so the affordance is a LOCAL
 * toggle: no number is ever dialed or exposed (no Linking, no `tel:`), which is
 * exactly how « les deux numéros restent privés » is kept by construction — there
 * is no number to leak. The relais rides the three repère screens: affectation
 * (R4) · en_route (R8) · door (R9).
 */

const appDir = join(new URL('.', import.meta.url).pathname, '..');
const read = (p: string): string => readFileSync(join(appDir, p), 'utf8');
const app = read('App.tsx');
const kit = read('src/ui/faso-kit.tsx');

const block = (from: string, to: string): string => app.slice(app.indexOf(from), app.indexOf(to));
const affectation = block("screen === 'affectation'", "screen === 'verify'");
const enroute = block("screen === 'en_route'", "screen === 'door_inspection'");
const door = block("screen === 'door_inspection'", "screen === 'payment_wait'");

interface CatEntry { key: string; fr: string; register: string }
const catalog: CatEntry[] = JSON.parse(read('i18n/catalog.json'));
const byKey = new Map(catalog.map((e) => [e.key, e]));

describe('R4/R8 relais — the affordance rides all three repère screens', () => {
  it('the relais renders on affectation, en_route AND door — and only there (3 sites)', () => {
    expect(affectation).toContain('<FasoRelaisRow');
    expect(enroute).toContain('<FasoRelaisRow');
    expect(door).toContain('<FasoRelaisRow');
    expect(app.match(/<FasoRelaisRow \{\.\.\.relaisFor\(\)\} \/>/g)).toHaveLength(3);
  });
});

describe('R4/R8 relais — masked by construction: a local toggle, NO telephony', () => {
  it('no number is ever dialed or exposed — the app wires no Linking and no tel: URL', () => {
    expect(app).not.toMatch(/\bLinking\b/);
    expect(app).not.toMatch(/tel:/);
    // no bare phone-number literal anywhere in the app surface
    expect(app).not.toMatch(/\+?\d[\d ]{7,}\d/);
  });

  it('the calling state is a local toggle, reset when a course opens or the demo resets', () => {
    expect(app).toMatch(/const \[calling, setCalling\] = useState\(false\)/);
    expect(app).toMatch(/onToggle: \(\) => setCalling\(\(c\) => !c\)/);
    // reset() and openCourse() both clear it (no calling bleeds across courses)
    expect(app.match(/setCalling\(false\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe('R4/R8 relais — the two states, and the privacy promise', () => {
  it('notCalling is the ghost « Appeler »; calling is the ink bar with privacy + Raccrocher', () => {
    const relais = kit.slice(kit.indexOf('export function RelaisRow('), kit.indexOf('export function CheckRow('));
    // notCalling → ghost call button
    expect(relais).toMatch(/if \(!calling\) return <GhostButton label=\{callLabel\}/);
    // calling → the ink bar carries BOTH the privacy line and the hang-up
    expect(relais).toContain('{privacyLabel}');
    expect(relais).toContain('{hangUpLabel}');
    // the ink surface is the DARK relay token (no hex — token-fidelity holds)
    expect(kit).toMatch(/relaisBar:\s*\{[^}]*backgroundColor:\s*DARK\.band/s);
  });

  it('the three strings exist (register neutral) and the privacy line carries the promise', () => {
    for (const k of ['relais.call', 'relais.privacy', 'relais.hang_up']) {
      expect(byKey.get(k), `${k} missing`).toBeDefined();
      expect(byKey.get(k)!.register).toBe('neutral');
    }
    expect(byKey.get('relais.call')!.fr).toContain('masqué');
    expect(byKey.get('relais.privacy')!.fr).toContain('les deux numéros restent privés');
  });
});
