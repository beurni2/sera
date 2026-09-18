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

/**
 * The rider's LIVE visual layer — the modules the app actually renders. These
 * scans used to run against src/ui/kit.tsx, the Grand Teint kit, which App.tsx
 * imported for twenty components it rendered ZERO of; the SOS hold gate below
 * was therefore reading a sheet no rider could ever open. The kit is deleted and
 * every scan now points at the surface that ships.
 */
const VISUAL_LAYER = [
  'src/ui/faso-kit.tsx',
  'src/ui/faso-sos.tsx',
  'src/ui/faso-act-code.tsx',
  'src/ui/faso-signin.tsx',
  'src/ui/signature.tsx',
  'src/ui/reduced-motion.ts',
  'src/ui/icons.tsx',
].map((p) => join(appDir, p));
/** The SOS sheet the app mounts (App.tsx imports SosButton/SosSheet from here). */
const sos = read(join(appDir, 'src/ui/faso-sos.tsx'));

describe('R14 — SOS is reachable in one gesture from every screen', () => {
  it('the SOS button + sheet are mounted UNCONDITIONALLY, outside every screen branch', () => {
    // exactly one SOS button, rendered after the whole screen stack closes
    expect(app.match(/<SosButton /g)).toHaveLength(1);
    expect(app.indexOf('<SosButton')).toBeGreaterThan(app.indexOf('</ScrollView>'));
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
    // The INVARIANT is « opening reveals, it never raises » — not the exact
    // shape of the callback. It now also clears the previous alert's delivery
    // fact, so a fresh raise cannot inherit « Séra a reçu l'alerte » from the
    // last one; that must not be allowed to look like a violation, and a real
    // one must still fail. So: it sets 'confirm', and it fires nothing.
    const openBody = app.slice(app.indexOf('const openSos = useCallback('), app.indexOf('const cancelSos'));
    expect(openBody).toMatch(/setSos\('confirm'\)/);
    expect(openBody, 'opening must never raise').not.toMatch(/fireSos|raiseSos|setSos\('raised'\)/);
    // firing is a HOLD: onPressIn arms a timer, onPressOut cancels it — asserted
    // on the sheet the app MOUNTS (faso-sos), not on a kit nothing rendered
    expect(sos).toMatch(/onPressIn=\{onHoldStart\}/);
    expect(sos).toMatch(/onPressOut=\{onHoldEnd\}/);
    // and the mounted sheet is that one: the hold gate cannot drift onto a file
    // the app does not import again
    expect(app).toMatch(/import \{ SosButton, SosSheet[^}]*\} from '\.\/src\/ui\/faso-sos'/);
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
    // the whole live visual layer, not just one kit file (which is now deleted)
    ...VISUAL_LAYER,
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
  //
  // FLOTTE-1 (SE7.2) \u2014 THE ONE NAMED ALLOWANCE. Sera-Build-Spec \u00a77.1 is
  // NORMATIVE: S\u00e9ra OWNS `DeliveryCost` and must report it \u00ab low/base/high \u00bb;
  // the founder's fleet desk on the console is where those francs show. They
  // are S\u00e9ra's own COSTS under the founder's typed hypotheses \u2014 never a
  // price, a fee, a payout or proceeds (SE-I09's letter), and no rider
  // surface ever shows them (the scan below keeps every rider surface
  // franc-free). The formatter lives in `apps/dispatch-console/src/flotte.ts`
  // and the ONLY call on the console shell is the cost table's cell. The scan
  // stays STRICT: on that one file the formatter's identifier is lifted out of
  // its two syntactic positions (the import name, the one call) \u2014 both
  // counted \u2014 and nothing else is let through; the assertion after the scan
  // pins the allowance to exactly one call.
  const FRANC = /\d[\d.,\u00a0\u202f ]*[\u00a0\u202f ](?:FCFA|CFA|F)\b|\bfrancs?\b/i;
  const CONSOLE_SHELL = join(repoRoot, 'apps/dispatch-console/src/main.ts');
  const liftFormatter = (src: string) => {
    expect(src.match(/^\s*francs,$/gm) ?? []).toHaveLength(1);
    expect(src.match(/\bfrancs\(/g) ?? []).toHaveLength(1);
    return src.replace(/^\s*francs,$/m, '').replace(/\bfrancs\(/, 'formatter(');
  };
  // strip TS/JS comments so a note may mention money without tripping the scan
  const stripComments = (p: string, src: string) =>
    p.endsWith('.json') ? src : src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('no user-facing surface renders a franc amount', () => {
    for (const p of surfaces) {
      const stripped = stripComments(p, read(p));
      const src = p === CONSOLE_SHELL ? liftFormatter(stripped) : stripped;
      const m = FRANC.exec(src);
      expect(m, `${p} carries a franc amount: ${m?.[0]}`).toBeNull();
    }
  });

  it('FLOTTE-1 — the franc formatter is called on the console shell EXACTLY once (the §7.1 cost table) and on no rider surface', () => {
    const shell = stripComments('main.ts', read(join(repoRoot, 'apps/dispatch-console/src/main.ts')));
    expect(shell.match(/\bfrancs\(/g) ?? []).toHaveLength(1);
    // The one call sits in the cost table's cell, under the founder's scenarios.
    expect(shell).toMatch(/td\.textContent = francs\(couts\[s\]\[l\]\);/);
    for (const p of surfaces.filter((s) => !s.includes('dispatch-console'))) {
      expect(read(p), `${p} calls the franc formatter`).not.toMatch(/\bfrancs\(/);
    }
    // And the formatter itself is the only place a « F » suffix is composed.
    const formatter = read(join(repoRoot, 'apps/dispatch-console/src/flotte.ts'));
    expect(formatter).toContain("${sign}${digits.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ')} F`");
    expect(formatter.match(/\} F`/g) ?? []).toHaveLength(1);
    expect(shell).not.toMatch(/\} F`/);
  });

  it('the visual layer references no money-amount token (no amount hero, no currency suffix)', () => {
    for (const src of [app, ...VISUAL_LAYER.map(read)]) {
      expect(src).not.toMatch(/money\.amountScale/);
      expect(src).not.toMatch(/money\.currencySuffix/);
    }
  });
});

describe('CLS — the visual layer animates transform/opacity only (native driver)', () => {
  it('every animation uses the native driver (which cannot animate layout) — no animated layout, no shift', () => {
    // Every module in the LIVE layer that animates at all must animate natively.
    // Deriving the set (rather than naming one file) means a new animated module
    // cannot join the app without joining this gate.
    const animated = VISUAL_LAYER.filter((p) =>
      /Animated\.(timing|spring|decay|loop|sequence|parallel|stagger)\(/.test(read(p)),
    );
    expect(animated.length, 'the live layer animates somewhere — else this gate guards nothing').toBeGreaterThan(0);
    for (const p of animated) {
      expect(read(p), `${p} animates without the native driver`).toMatch(/useNativeDriver: true/);
      expect(read(p), `${p} opts OUT of the native driver`).not.toMatch(/useNativeDriver: false/);
    }
    for (const p of VISUAL_LAYER) expect(read(p), `${p} uses LayoutAnimation`).not.toMatch(/LayoutAnimation/);
  });
});
