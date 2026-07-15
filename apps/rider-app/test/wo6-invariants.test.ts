import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stepAfterDoorSignal } from '../src/custody-flow.js';
import { JOURNEY } from '../src/journey.js';
import { attemptReturnHandover } from '../src/two-key-return.js';
import * as store from '../src/demo/store.js';
import { acceptInspection, applyProviderDoorSignal, createDemoWorld } from '../src/demo/store.js';

/**
 * WO-6.1 hard gates (the DoD, as assertions):
 *  R14 — SOS reachable from EVERY screen (structural: mounted outside every
 *        screen branch, one gesture, hold-to-fire so it is neither accidental
 *        nor missable).
 *  R9  — NO code path lets the rider assert payment (unrepresentable — attempted).
 *  R10 — the drop code cannot render before provider confirmation.
 *  R13 — a single-key return REFUSES.
 *  Money — NO franc amount anywhere in Séra (it emits signals, never money).
 *  CLS — the visual layer animates transform/opacity only (native driver only).
 */

const appDir = join(import.meta.dirname, '..');
const repoRoot = join(appDir, '../..');
const read = (p: string) => readFileSync(p, 'utf8');
const app = read(join(appDir, 'App.tsx'));
const kit = read(join(appDir, 'src/ui/kit.tsx'));

describe('R14 — SOS is reachable in one gesture from every screen', () => {
  it('the SOS button + sheet are mounted UNCONDITIONALLY, outside every screen branch', () => {
    // exactly one SOS button, rendered after the whole screen stack closes
    expect(app.match(/<SosButton /g)).toHaveLength(1);
    expect(app.indexOf('<SosButton')).toBeGreaterThan(app.indexOf('</ScreenTransition>'));
    expect(app.indexOf('<SosButton')).toBeGreaterThan(app.lastIndexOf('{HUBS.includes(screen)'));
    // from the SOS render to the end of the tree there is NO per-screen gate:
    // the SOS is a top-level child of the app, not inside any `screen === …`.
    const tail = app.slice(app.indexOf('<SosButton'), app.indexOf('</SafeAreaView>'));
    expect(tail).toContain('<SosSheet');
    expect(tail).not.toMatch(/screen === '/);
  });

  it('opening the SOS only reveals the sheet; FIRING requires a deliberate hold (not accidental, not missable)', () => {
    // the button opens (reveals) — it does not fire
    expect(app).toMatch(/<SosButton label=\{t\('sos\.label'\)\} onOpen=\{openSos\}/);
    expect(app).toMatch(/const openSos = useCallback\(\(\) => setSos\('confirm'\)/);
    // firing is a HOLD: onPressIn arms a timer, onPressOut cancels it
    expect(kit).toMatch(/onPressIn=\{onHoldStart\}/);
    expect(kit).toMatch(/onPressOut=\{onHoldEnd\}/);
    expect(app).toMatch(/holdTimer\.current = setTimeout\(/);
    expect(app).toMatch(/setSos\('raised'\)/);
  });
});

describe('R9 — the rider CANNOT assert payment (SE-I11, unrepresentable)', () => {
  it('the payment wait screen has no rider-actionable payment field/button — only the provider signal advances', () => {
    const wait = app.slice(app.indexOf("screen === 'payment_wait'"), app.indexOf("screen === 'drop'"));
    // no free-text entry anywhere in the app (the rider cannot type « payé »)
    expect(app).not.toMatch(/<TextInput/);
    // the ONLY forward move is the provider signal, gated on the provider
    // constant — never a rider-chosen value
    expect(wait).toMatch(/applyProviderDoorSignal\(w, active\.id, SANDBOX_DOOR_SIGNAL\)/);
    expect(wait).toMatch(/SANDBOX_DOOR_SIGNAL === 'confirmed'/);
    // the pending arm offers a PendingNotice, never an action (Faso fpBar notice)
    expect(wait).toMatch(/<FasoPendingNotice/);
    // and App never calls applyProviderDoorSignal with a literal rider value
    expect(app).not.toMatch(/applyProviderDoorSignal\([^)]*,\s*'(?!.*SANDBOX)/);
  });

  it('the store exposes exactly ONE door-advance surface, and a rider-asserted value is unrepresentable at runtime', () => {
    const world = createDemoWorld();
    const id = 'course-salif'; // seeded 2e passage, at the door
    expect(acceptInspection(world, id)).toBe('payment_wait');
    // a value the rider asserts is not a provider signal — it throws
    expect(() =>
      // @ts-expect-error — outside the provider signal type (SE-I11)
      applyProviderDoorSignal(world, id, 'moi_le_livreur'),
    ).toThrow();
    // pending does not advance; only the provider-confirmed signal does
    expect(applyProviderDoorSignal(world, id, 'pending')).toBe('payment_wait');
    expect(applyProviderDoorSignal(world, id, 'confirmed')).toBe('drop');
    const doorSurfaces = Object.keys(store).filter((k) => /door|signal|pay/i.test(k));
    expect(doorSurfaces).toEqual(['applyProviderDoorSignal']);
  });
});

describe('R10 — the drop code cannot render before provider confirmation', () => {
  it('the code entry (cells + keypad) exists ONLY on the drop screen', () => {
    const drop = app.slice(app.indexOf("screen === 'drop'"), app.indexOf("screen === 'refusal_reason'"));
    // WO-FP-SERA proof view 3/3: the R10 code entry restyled to the Faso components;
    // the invariant is unchanged — the code surface exists ONLY on the drop screen.
    expect(drop).toMatch(/<FasoCodeCells value=\{codeStr\}/);
    expect(drop).toMatch(/<FasoKeypad/);
    // no code surface anywhere else in the app
    expect(app.match(/<FasoCodeCells\b/g)).toHaveLength(1);
    expect(app.match(/<FasoKeypad\b/g)).toHaveLength(1);
  });

  it('the spine makes the drop screen reachable ONLY after the provider-confirmed signal', () => {
    // the pending signal never reaches the drop; only the confirmed one does
    expect(stepAfterDoorSignal('pending')).toBe('payment_wait');
    expect(stepAfterDoorSignal('confirmed')).toBe('drop');
    // and the payment wait has EXACTLY one edge — the confirmed step
    expect([...JOURNEY.payment_wait]).toEqual([stepAfterDoorSignal('confirmed')]);
  });
});

describe('R13 — a single-key return REFUSES (SE6.2, both-or-neither)', () => {
  it('any single key — or none — refuses; only both keys release', () => {
    expect(attemptReturnHandover({ seller: false, rider: false })).toBe('refused');
    expect(attemptReturnHandover({ seller: true, rider: false })).toBe('refused');
    expect(attemptReturnHandover({ seller: false, rider: true })).toBe('refused');
    expect(attemptReturnHandover({ seller: true, rider: true })).toBe('released');
  });

  it('the return screen gates the handover behind BOTH keys and refuses a lone rider key', () => {
    const retour = app.slice(app.indexOf("screen === 'retour_colis'"), app.indexOf("screen === 'delivered' && ("));
    // the rider-key action refuses when the seller key is not yet turned
    expect(retour).toMatch(/attemptReturnHandover\(\{ seller: key1, rider: true \}\) === 'refused'/);
    // the final confirm is disabled until both keys are present
    expect(retour).toMatch(/disabled=\{attemptReturnHandover\(\{ seller: key1, rider: key2 \}\) === 'refused'\}/);
  });
});

describe('Money — Séra emits signals, never money: NO franc amount anywhere', () => {
  const surfaces = [
    join(appDir, 'App.tsx'),
    join(appDir, 'src/ui/kit.tsx'),
    join(appDir, 'i18n/catalog.json'),
    // WO-6.3 — the safety surfaces join the no-franc scan (Séra emits signals).
    join(appDir, 'src/safety.ts'),
    join(repoRoot, 'apps/dispatch-console/src/main.ts'),
    join(repoRoot, 'apps/dispatch-console/i18n/catalog.json'),
    join(repoRoot, 'apps/dispatch-console/src/sandbox-incident.ts'),
  ];
  // A rendered franc amount: a number, then a REAL separator (space/nbsp/nnbsp),
  // then the currency unit \u2014 \u00ab 12 500 F \u00bb, \u00ab 5 000 FCFA \u00bb \u2014 or the word franc.
  // The separator requirement excludes token names like \u00ab U+202F \u00bb.
  const FRANC = /\d[\d.,\u00a0\u202f ]*[\u00a0\u202f ](?:FCFA|CFA|F)\b|\bfrancs?\b/i;
  // strip TS/JS comments so a note may mention money without tripping the scan
  const stripComments = (p: string, src: string) =>
    p.endsWith('.json') ? src : src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('no user-facing surface renders a franc amount', () => {
    for (const p of surfaces) {
      const src = stripComments(p, read(p));
      const m = FRANC.exec(src);
      expect(m, `${p} carries a franc amount: ${m?.[0]}`).toBeNull();
    }
  });

  it('the visual layer references no money-amount token (no amount hero, no currency suffix)', () => {
    for (const src of [app, kit]) {
      expect(src).not.toMatch(/money\.amountScale/);
      expect(src).not.toMatch(/money\.currencySuffix/);
    }
  });
});

describe('CLS — the visual layer animates transform/opacity only (native driver)', () => {
  it('every animation uses the native driver (which cannot animate layout) — no animated layout, no shift', () => {
    expect(kit).toMatch(/useNativeDriver: true/);
    expect(kit).not.toMatch(/useNativeDriver: false/);
    expect(kit).not.toMatch(/LayoutAnimation/);
  });
});
