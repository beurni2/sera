import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { landmark, motion, celebration } from '@platform/ui-tokens/legacy';

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
    expect(affectation).toMatch(/<LandmarkCard[\s\S]*lines=\{active\.locationLines\}[\s\S]*illustrated/);
    const door = app.slice(app.indexOf("screen === 'door_inspection'"), app.indexOf("screen === 'payment_wait'"));
    expect(door).toMatch(/<LandmarkCard[\s\S]*lines=\{active\.locationLines\}/);
  });

  it('the refusal arm is a first-class DangerButton — bordered danger, as polished as acceptance', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function DangerButton/);
    expect(kit).toMatch(/buttonDanger: \{[^}]*borderColor: C\.danger/);
    expect(kit).toMatch(/buttonDangerText: \{[^}]*color: C\.danger/);
    const app = read('App.tsx');
    const verify = app.slice(app.indexOf("screen === 'verify'"), app.indexOf("screen === 'refused'"));
    expect(verify).toMatch(/<DangerButton label=\{t\('verify\.refuse_action'\)\}/);
  });

  it('the checklist renders as CheckRow — ink box + label, ≥48px targets via the touch token', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function CheckRow/);
    expect(kit).toMatch(/checkRow: \{[^}]*minHeight: touch\.minTargetPx/s);
    const app = read('App.tsx');
    expect(app).toMatch(/<CheckRow key=\{id\} label=\{t\(`check\.\$\{id\}`\)\}/);
  });

  it('pending states are PendingNotice rows — queued = pending, honest, never done', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/<PendingNotice lines=\{\[t\('assignment\.ack_pending'\)\]\}/);
    expect(app).toMatch(/<PendingNotice lines=\{\[t\('evidence\.pending'\)\]\}/);
    // the door-payment wait is a PendingNotice, never a rider-actionable field
    expect(app).toMatch(/<PendingNotice lines=\{\[t\('pay_wait\.hint'\)/);
  });

  it('the rider’s ONE named moment is the course_validee celebration — token-driven, ≤ 800 ms', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function CourseValideeCelebration/);
    expect(kit).toMatch(/celebration\.courseValidee/);
    expect(celebration.courseValidee.app).toBe('sera');
    expect(celebration.haloMs).toBeLessThanOrEqual(motion.celebrateMaxMs);
    const app = read('App.tsx');
    expect(app).toMatch(/<CourseValideeCelebration onDone=/);
  });

  it('the screen change eases in on the ONE soft spring — token duration + curve, static under reduced motion', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function ScreenTransition/);
    const transition = kit.slice(
      kit.indexOf('export function ScreenTransition'),
      kit.indexOf('export function CourseValideeCelebration'),
    );
    expect(transition).toMatch(/motion\.standardMs/);
    expect(transition).toMatch(/SPRING_SOFT/);
    expect(transition).toMatch(/useNativeDriver: true/);
    expect(transition).toMatch(/if \(reduced\) \{/);
    const app = read('App.tsx');
    expect(app).toMatch(/<ScreenTransition screenKey=\{screen\}>/);
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
    // views + the frozen console pattern); the App shell now renders the Faso <WovenBand/>.
    expect(kit).toMatch(/export function ThemeStrip/);
    expect(kit).toMatch(/band\.themeStripPx/);
    const app = read('App.tsx');
    expect(app).toMatch(/<WovenBand \/>/);
  });

  it('navigation chrome: header everywhere, hubs = Service·Courses, tabs are waypoint RESETS (never edges, never go())', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/<AppHeader/);
    expect(app).toMatch(/HUBS: readonly Screen\[\] = \['service', 'courses'\]/);
    for (const key of ['nav.tab_service', 'nav.tab_courses']) {
      expect(app).toContain(`t('${key}')`);
    }
    expect(app).toMatch(/\{HUBS\.includes\(screen\) && \(\s*<TabBar/);
    const tabBlock = app.slice(app.indexOf('<TabBar'), app.indexOf('{/* R14'));
    expect(tabBlock).toMatch(/key: 'service'[^\n]*setStack\(\[START\]\)/);
    expect(tabBlock).toMatch(/key: 'courses'[^\n]*toCourses\(\)/);
    expect(tabBlock).not.toMatch(/go\(/);
    // go() is byte-identical to WO-4.1 (the spine test pins it too)
    expect(app).toMatch(/JOURNEY\[stack\[stack\.length - 1\] \?\? START\]\.includes\(next\)/);
  });

  it('closed courses are muted, never pressable; the 2e passage carries its lineage chip', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/muted=\{item\.closed\}/);
    expect(app).toMatch(/onPress=\{item\.closed \? undefined : \(\) => openCourse\(item\)\}/);
    // WO-FP-SERA proof view 2/3: the R2 course list restyled to the Faso chip.
    expect(app).toMatch(/item\.attempt === 2 && <FasoStatusChip tone="info" label=\{t\('courses\.lineage_2e'\)\}/);
  });

  it('the kit imports stay inside the RN + tokens world (banned-import law extended to the kit)', () => {
    const BANNED = /@platform\/certification|@platform\/contracts|@platform\/i18n\/(data-loader|lint-cli)|@sera\/commerce-core|^node:/;
    const kit = read('src/ui/kit.tsx');
    const specs = [...kit.matchAll(/^import [^;]*from '([^']+)';/gm)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(spec, `kit imports ${spec}`).not.toMatch(BANNED);
  });
});
