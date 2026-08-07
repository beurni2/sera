import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { landmark, motion } from '@platform/ui-tokens/legacy';
import { motion as fpMotion } from '@platform/ui-tokens';

/**
 * WO-6.1 — the visual layer obeys Grand Teint (ui-tokens v0.9.0, sera theme).
 * The scan test IS the DoD's "zero hardcode": every colour is a token, every
 * size/spacing/radius/type value a token expression. The LandmarkCard
 * signature consumes the landmark hierarchy (repère → indications → zone) and
 * the illustrated scene; the refusal arm is a first-class DangerButton; the
 * hubs are waypoint RESETS (never edges); reduced motion is honoured; and the
 * rider's ONE named moment — the course_validee celebration — is present (it
 * was NOT in the WO-4.2R kit; WO-6.1 adds it). Navigation pins stay in
 * journey-spine.test.ts (byte-untouched).
 */

const appDir = join(import.meta.dirname, '..');
const FILES = ['App.tsx', 'src/ui/kit.tsx'];
const read = (f: string) => readFileSync(join(appDir, f), 'utf8');

describe('WO-6.1 Grand Teint visual layer (rider-app)', () => {
  it('SCAN: zero hardcoded colours anywhere in the visual layer', () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, `${f} carries a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, `${f} carries an rgb() colour`).not.toMatch(/\brgba?\(/);
      expect(src, `${f} carries a named CSS colour literal`).not.toMatch(/colou?r:\s*'(?!#)[a-z]+'/);
    }
  });

  it('SCAN: zero hardcoded size/spacing/type values — every number is a token expression', () => {
    const SIZE_PROPS =
      /(?:fontSize|lineHeight|borderRadius|padding(?:Horizontal|Vertical|Top|Bottom|Left|Right)?|margin[A-Za-z]*|minHeight|minWidth|maxWidth|height|width|gap|letterSpacing|top|bottom|left|right):\s*(\d+(?:\.\d+)?)\b/g;
    for (const f of FILES) {
      const src = read(f);
      const offenders: string[] = [];
      for (const m of src.matchAll(SIZE_PROPS)) {
        if (Number(m[1]) !== 0) offenders.push(m[0]);
      }
      expect(offenders, `${f} hardcodes size values: ${offenders.join(' · ')}`).toEqual([]);
    }
  });

  it('LandmarkCard — the signature — consumes the landmark ladder + the illustrated scene, on affectation AND at the door', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function LandmarkCard/);
    expect(kit).toMatch(/export function LandmarkIllustration|function LandmarkIllustration/);
    // the hierarchy ladder: repère → indications → zone, token-typed
    expect(kit).toMatch(/landmark\.repere\.size/);
    expect(kit).toMatch(/landmark\.repere\.wght/);
    expect(kit).toMatch(/landmark\.indications\.size/);
    expect(kit).toMatch(/landmark\.zone\.size/);
    // the illustrated scene paints on the illustration-only palette + card border
    expect(kit).toMatch(/landmark\.illustration/);
    expect(kit).toMatch(/landmark\.cardBorderPx/);
    // the repère/zone icons come from the SVG icon set (never emoji in chrome)
    expect(kit).toMatch(/IconRepere/);
    expect(kit).toMatch(/IconZone/);
    // the ladder really descends (repère heads the block, doctrine §4)
    expect(landmark.repere.size).toBeGreaterThan(landmark.indications.size);
    expect(landmark.indications.size).toBeGreaterThan(landmark.zone.size);
    // the App renders the signature card on the assignment AND at the door
    const app = read('App.tsx');
    const affectation = app.slice(app.indexOf("screen === 'affectation'"), app.indexOf("screen === 'verify'"));
    // WO-FP-SERA: affectation now renders the Faso repère (planche R4); the door
    // signature card is restyled in its own stage.
    expect(affectation).toMatch(/<FasoLandmarkCard[\s\S]*lines=\{active\.locationLines\}[\s\S]*illustrated/);
    const door = app.slice(app.indexOf("screen === 'door_inspection'"), app.indexOf("screen === 'payment_wait'"));
    expect(door).toMatch(/LandmarkCard[\s\S]*lines=\{active\.locationLines\}/);
  });

  it('the refusal arm is a first-class DangerButton — bordered danger, as polished as acceptance', () => {
    // WO-FP-SERA: the Faso refusal arm — a 2px bordered danger button, Bricolage 800,
    // never a grey whisper of shame (charter: refusal as dignified as the purchase).
    const kit = read('src/ui/faso-kit.tsx');
    expect(kit).toMatch(/export function DangerButton/);
    expect(kit).toMatch(/danger: \{[^}]*borderColor: C\.dangerBorder/s);
    expect(kit).toMatch(/dangerText: \{[^}]*color: C\.dangerFg/s);
    const app = read('App.tsx');
    const verify = app.slice(app.indexOf("screen === 'verify'"), app.indexOf("screen === 'refused'"));
    expect(verify).toMatch(/<FasoDangerButton label=\{t\('verify\.refuse_action'\)\}/);
  });

  it('the checklist renders as CheckRow — label + conformity toggle, ≥44px targets', () => {
    // WO-FP-SERA: the Faso check row — a green « conforme » toggle (okBg/okFg), the
    // whole row a ≥44px target. The gate lives in custody-flow, never in the skin.
    const kit = read('src/ui/faso-kit.tsx');
    expect(kit).toMatch(/export function CheckRow/);
    expect(kit).toMatch(/checkRow: \{[^}]*minHeight: 44/s);
    expect(kit).toMatch(/checkBtnOn: \{[^}]*backgroundColor: C\.okBg/s);
    const app = read('App.tsx');
    expect(app).toMatch(/<FasoCheckRow key=\{id\} label=\{t\(`check\.\$\{id\}`\)\}/);
  });

  it('pending states are PendingNotice rows — queued = pending, honest, never done', () => {
    const app = read('App.tsx');
    // WO-FP-SERA: the pending surfaces are the Faso fpBar notice. Queued = pending,
    // honest, never done — the drop stays locked until the authoritative server ack.
    expect(app).toMatch(/<FasoPendingNotice lines=\{\[t\('assignment\.ack_pending'\)\]\}/);
    expect(app).toMatch(/<FasoPendingNotice lines=\{\[t\('evidence\.pending'\)\]\}/);
    // the door-payment wait is a PendingNotice, never a rider-actionable field
    expect(app).toMatch(/<FasoPendingNotice lines=\{\[t\('pay_wait\.hint'\)/);
  });

  it('the rider’s ONE named moment is the « Course validée » celebration — fpPop-bounded, ≤ 800 ms', () => {
    // WO-FP-SERA: the Faso peak (planche l.582–590) — the gold proof seal pops in on
    // fpPop over the dark scrim; token-driven, dignified, no confetti-spam. The Grand
    // Teint CourseValideeCelebration stays in the /legacy kit (unused by the app).
    const faso = read('src/ui/faso-kit.tsx');
    expect(faso).toMatch(/export function Celebration/);
    expect(faso).toMatch(/<FpPop[\s\S]*<ProofSeal \/>/);
    expect(faso).toMatch(/celScrim: \{[\s\S]*DARK\.celebrationScrim/);
    // fpPop is bounded well under the celebration ceiling (≤ 800 ms), reduced-motion safe
    expect(fpMotion.fpPop.durationMs.max).toBeLessThanOrEqual(motion.celebrateMaxMs);
    const app = read('App.tsx');
    expect(app).toMatch(/<FasoCelebration label=/);
  });

  it('the screen change eases in on the ONE soft spring — token duration + curve, static under reduced motion', () => {
    // WO-FP-SERA full-bleed: the redundant cross-screen ScreenTransition (flex:1,
    // which broke the scroll surface) is retired from the app; the per-screen FpIn
    // (the planche fpIn — a soft cubic-bezier(.2,.8,.2,1) entry, reduced-motion safe
    // in useEntry) re-animates on each screen change. ScreenTransition stays defined
    // in the /legacy kit for the frozen console.
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function ScreenTransition/);
    const sig = read('src/ui/signature.tsx');
    const fpin = sig.slice(sig.indexOf('export function FpIn'), sig.indexOf('export function FpPop'));
    expect(fpin).toMatch(/useEntry\('fpIn'\)/);
    expect(fpin).toMatch(/translateY/);
    const app = read('App.tsx');
    expect(app).not.toMatch(/<ScreenTransition/);
    expect(app).toMatch(/<FpIn style=/);
    // the movement law's duration band holds at the token level (150–250 ms)
    expect(motion.quickMs).toBeGreaterThanOrEqual(150);
    expect(motion.standardMs).toBeLessThanOrEqual(250);
  });

  it('no bare spinner anywhere — the skeleton pulses on motion tokens, static under reduced motion', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function Skeleton/);
    expect(kit).toMatch(/motion\.standardMs/);
    expect(kit).toMatch(/if \(reduced\) return;/);
    expect(kit).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(kit).toMatch(/reduceMotionChanged/);
    for (const f of FILES) expect(read(f)).not.toMatch(/ActivityIndicator/);
  });

  it('the permanent brand strip — WO-FP-SERA: the Faso woven band replaces the Grand Teint theme strip in the App shell', () => {
    const kit = read('src/ui/kit.tsx');
    // the Grand Teint ThemeStrip stays defined in the /legacy kit (the un-migrated
    // views + the frozen console pattern); the App shell now renders the Faso monogram
    // header, which carries the woven band at its top (planche l.33).
    expect(kit).toMatch(/export function ThemeStrip/);
    expect(kit).toMatch(/band\.themeStripPx/);
    const app = read('App.tsx');
    expect(app).toMatch(/<FasoHeader/);
    const fasoKit = read('src/ui/faso-kit.tsx');
    expect(fasoKit).toMatch(/export function FasoHeader/);
    expect(fasoKit).toMatch(/<WovenBand \/>/); // the band rides at the top of the header
  });

  it('navigation chrome: header everywhere, hubs = Service·Courses, tabs are waypoint RESETS (never edges, never go())', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/<FasoHeader/);
    expect(app).toMatch(/HUBS: readonly Screen\[\] = \['service', 'courses'\]/);
    for (const key of ['nav.tab_service', 'nav.tab_courses']) {
      expect(app).toContain(`t('${key}')`);
    }
    /**
     * The dock renders on the HUBS and nowhere else. The guard gained a
     * `!WIRED &&` in 4c (verifier A6): the Service/Courses dock belongs to the
     * DEMO world, and on a wired build tapping « Courses » pushed the stack and
     * grew a back arrow while the content never changed. The invariant is
     * unchanged — hubs-only, and the tabs below are still RESETS, never edges.
     */
    expect(app).toMatch(/\{!WIRED && HUBS\.includes\(screen\) && \(\s*<FasoTabBar/);
    const tabBlock = app.slice(app.indexOf('<FasoTabBar'), app.indexOf('{/* R14'));
    expect(tabBlock).toMatch(/key: 'service'[^\n]*setStack\(\[START\]\)/);
    expect(tabBlock).toMatch(/key: 'courses'[^\n]*toCourses\(\)/);
    expect(tabBlock).not.toMatch(/go\(/);
    // go() is byte-identical to WO-4.1 (the spine test pins it too)
    expect(app).toMatch(/JOURNEY\[stack\[stack\.length - 1\] \?\? START\]\.includes\(next\)/);
  });

  it('closed courses are the receded done card, never pressable; the 2e passage carries its lineage', () => {
    const app = read('App.tsx');
    // WO-FP-SERA proof view 2/3, TRUE planche anatomy: R2 is the editorial
    // CourseCard (left bar · eyebrow · pill · deadline), NOT the glyph-tile row.
    expect(app).toContain('<FasoCourseCard');
    expect(app).not.toContain('<FasoListRow');
    // closed → the done (receded) variant, and never pressable (unchanged custody law)
    expect(app).toMatch(/variant=\{variantFor\(item\)\}/);
    expect(app).toMatch(/course\.closed \? 'done'/); // variantFor maps closed → done
    expect(app).toMatch(/onPress=\{item\.closed \? undefined : \(\) => openCourse\(item\)\}/);
    // the 2e passage carries its lineage into the card
    expect(app).toMatch(/lineage=\{item\.attempt === 2 \? t\('courses\.lineage_2e'\) : undefined\}/);
  });

  it('the kit imports stay inside the RN + tokens world (banned-import law extended to the kit)', () => {
    const BANNED = /@platform\/certification|@platform\/contracts|@platform\/i18n\/(data-loader|lint-cli)|@sera\/commerce-core|^node:/;
    const kit = read('src/ui/kit.tsx');
    const specs = [...kit.matchAll(/^import [^;]*from '([^']+)';/gm)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(spec, `kit imports ${spec}`).not.toMatch(BANNED);
  });
});
