import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * R9 « à la porte » — the inspection chrono (HANDOFF §4 R9 `inspecting` :
 * « carte chrono · Inspection en cours · mm:ss live »). The buyer inspects; the
 * rider waits with dignity, seeing the elapsed time.
 *
 * THE LAW THIS FIXTURE PROTECTS — D20 (founder ruling 2026-07-10, JOURNAL): dwell
 * is RECORDED and console-surfaced only; NO enforcement field exists anywhere in
 * canon. So the rider-facing chrono must be EPHEMERAL + DISPLAY ONLY — a local
 * count-up that records NOTHING (no store write, no event, no custody field) and
 * enforces NOTHING (no threshold, no gate). It is a comfort clock, not a dwell
 * field. It must also be DETERMINISTIC (Law #5): count-up from now, never an ETA.
 * And custody/journey must stay byte-frozen — the chrono is a display add on the
 * EXISTING door_inspection screen, not a new node.
 */

const appDir = join(new URL('.', import.meta.url).pathname, '..');
const read = (p: string): string => readFileSync(join(appDir, p), 'utf8');
const app = read('App.tsx');
const kit = read('src/ui/faso-kit.tsx');

/** The DoorChrono function body (App owns the tick) — sliced for the safety scan. */
const doorChrono = app.slice(app.indexOf('function DoorChrono()'), app.indexOf('/** Course-list badges'));
/** The InspectionChrono function body (faso-kit skin — must hold no state). */
const inspChrono = kit.slice(kit.indexOf('export function InspectionChrono('), kit.indexOf('export function OfflineBanner('));

interface CatEntry { key: string; fr: string; register: string }
const catalog: CatEntry[] = JSON.parse(read('i18n/catalog.json'));
const byKey = new Map(catalog.map((e) => [e.key, e]));

describe('R9 chrono — the chrono renders on the door, above the repère', () => {
  it('the door_inspection screen mounts DoorChrono, which renders the FasoInspectionChrono card', () => {
    const door = app.slice(app.indexOf("screen === 'door_inspection'"), app.indexOf("screen === 'payment_wait'"));
    expect(door).toContain('<DoorChrono />');
    expect(doorChrono).toContain('<FasoInspectionChrono');
    // the chrono sits above the door repère (the inspecting hero, HANDOFF §4 R9)
    expect(door.indexOf('<DoorChrono />')).toBeLessThan(door.indexOf('<FasoLandmarkCard'));
    // exactly one chrono in the app — only at the door
    expect(app.match(/<DoorChrono \/>/g)).toHaveLength(1);
  });
});

describe('R9 chrono — D20: EPHEMERAL + DISPLAY ONLY (records nothing, enforces nothing)', () => {
  it('the tick is a local count-up torn down on unmount — setInterval + Date.now, cleared on cleanup', () => {
    expect(doorChrono).toMatch(/setInterval\(/);
    expect(doorChrono).toMatch(/Date\.now\(\)/);
    expect(doorChrono).toMatch(/clearInterval\(/); // cleanup — no leaked timer, no cross-course carry
  });

  it('the chrono WRITES nothing — no store move, no event, no persist, no custody/dwell field', () => {
    // it never advances the demo world (no custody move) …
    expect(doorChrono).not.toMatch(/\bwalk\(/);
    expect(doorChrono).not.toMatch(/setWorld|world\./);
    // … never persists or emits …
    expect(doorChrono).not.toMatch(/persist|append|outbox|emit|\.record\(/i);
    // … and mints no dwell field (D20 — dwell is console-only in canon).
    expect(doorChrono).not.toMatch(/dwell/i);
  });

  it('the chrono ENFORCES nothing — no threshold, no gate, no disable tied to the elapsed time', () => {
    // no comparison of the elapsed count against any limit (2..4 min etc.)
    expect(doorChrono).not.toMatch(/elapsed\s*[<>]=?/);
    expect(doorChrono).not.toMatch(/disabled|threshold|limit|expire|deadline/i);
  });

  it('it is DETERMINISTIC (Law #5): a count-UP from now, never an ETA/estimate/model', () => {
    expect(doorChrono).toMatch(/now\(\) - start|Date\.now\(\) - start/);
    expect(doorChrono).not.toMatch(/eta|estimate|predict|remaining|countdown/i);
  });

  it('the faso-kit InspectionChrono is SKIN ONLY — a stateless presentational card (no timer, no state)', () => {
    expect(inspChrono).not.toMatch(/useState|useEffect|setInterval|Date\.now/);
    // it renders only what the caller passes: label, time, note
    expect(inspChrono).toMatch(/label,\s*time,\s*note/);
  });
});

describe('R9 chrono — copy is present, French-Voice register, and carries NO franc', () => {
  it('both chrono strings exist, register neutral', () => {
    for (const k of ['inspect.chrono_label', 'inspect.chrono_note']) {
      const e = byKey.get(k);
      expect(e, `${k} missing`).toBeDefined();
      expect(e!.register).toBe('neutral');
    }
  });

  it('the dignity note is the planche R9 line, and neither string is a money amount', () => {
    expect(byKey.get('inspect.chrono_note')!.fr).toBe('Le temps est noté, jamais imposé.');
    // Séra emits signals, never money: no franc figure in the chrono copy
    const FRANC = /\d[\d.,   ]*[   ](?:FCFA|CFA|F)\b|\bfrancs?\b/i;
    expect(FRANC.test(byKey.get('inspect.chrono_label')!.fr)).toBe(false);
    expect(FRANC.test(byKey.get('inspect.chrono_note')!.fr)).toBe(false);
  });
});
