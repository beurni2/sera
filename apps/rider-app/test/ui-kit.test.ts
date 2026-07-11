import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { landmark, money, motion, seraTheme } from '@platform/ui-tokens';

/**
 * WO-4.2R — the visual layer obeys the tokens (adapted from boutik's
 * committed ui-kit suite). The scan test IS the DoD's "zero hardcoded
 * colors/sizes — a scan proves it": every color is a theme token, every
 * size/spacing/radius/type value is a token expression; the LandmarkCard
 * signature consumes the landmark hierarchy + icon-name tokens; the hubs
 * are waypoint RESETS (never edges); reduced motion is honored; NO
 * celebration moment exists in this kit — course_validee is NOT in this
 * order (only boutik's produit_pret was ordered). Navigation pins stay in
 * journey-spine.test.ts (byte-untouched).
 */

const appDir = join(import.meta.dirname, '..');
const FILES = ['App.tsx', 'src/ui/kit.tsx'];
const read = (f: string) => readFileSync(join(appDir, f), 'utf8');

describe('WO-4.2R visual layer (rider-app)', () => {
  it('SCAN: zero hardcoded colors anywhere in the visual layer', () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, `${f} carries a hex color`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, `${f} carries an rgb() color`).not.toMatch(/\brgba?\(/);
      expect(src, `${f} carries a named CSS color literal`).not.toMatch(/color:\s*'(?!#)[a-z]+'/);
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

  it('LandmarkCard — the signature — consumes landmark.hierarchy AND landmark.iconNames, on affectation AND at the door', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function LandmarkCard/);
    // the hierarchy ladder: repère → indications → zone, token-typed
    expect(kit).toMatch(/landmark\.hierarchy\.repere\.size/);
    expect(kit).toMatch(/landmark\.hierarchy\.repere\.weight/);
    expect(kit).toMatch(/landmark\.hierarchy\.indications\.size/);
    expect(kit).toMatch(/landmark\.hierarchy\.zone\.size/);
    // the icon SLOTS come from the token names (CTO-default text glyphs;
    // the ⏳ illustrated assets are future app-side work)
    expect(kit).toMatch(/landmark\.iconNames\.repere/);
    expect(kit).toMatch(/landmark\.iconNames\.zone/);
    // the ladder really descends (repère heads the block, doctrine §4)
    expect(landmark.hierarchy.repere.size).toBeGreaterThan(landmark.hierarchy.indications.size);
    expect(landmark.hierarchy.indications.size).toBeGreaterThan(landmark.hierarchy.zone.size);
    // the App renders the signature card on the assignment AND at the door
    const app = read('App.tsx');
    const affectation = app.slice(app.indexOf("screen === 'affectation'"), app.indexOf("screen === 'verify'"));
    expect(affectation).toMatch(/<LandmarkCard label=\{t\('assignment\.landmark_label'\)\} lines=\{active\.locationLines\}/);
    const door = app.slice(app.indexOf("screen === 'door_inspection'"), app.indexOf("screen === 'payment_wait'"));
    expect(door).toMatch(/<LandmarkCard label=\{t\('assignment\.landmark_label'\)\} lines=\{active\.locationLines\}/);
  });

  it('the refusal arm is a first-class DangerButton — danger bg, onPrimary text, as polished as acceptance', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function DangerButton/);
    expect(kit).toMatch(/buttonDanger: \{ backgroundColor: theme\.colors\.danger \}/);
    expect(kit).toMatch(/buttonDangerText: \{ color: theme\.colors\.onPrimary/);
    const app = read('App.tsx');
    const verify = app.slice(app.indexOf("screen === 'verify'"), app.indexOf("screen === 'refused'"));
    expect(verify).toMatch(/<DangerButton label=\{t\('verify\.refuse_action'\)\}/);
  });

  it('the checklist renders as CheckRow — box + label, ≥44px targets via the touch token', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function CheckRow/);
    expect(kit).toMatch(/checkRow: \{[^}]*minHeight: theme\.touch\.minTargetPx/s);
    const app = read('App.tsx');
    expect(app).toMatch(/<CheckRow key=\{id\} label=\{t\(`check\.\$\{id\}`\)\}/);
  });

  it('pending states are PendingNotice rows — queued = pending, honest, never done', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/<PendingNotice lines=\{\[t\('assignment\.ack_pending'\)\]\}/);
    expect(app).toMatch(/<PendingNotice lines=\{\[t\('evidence\.pending'\)\]\}/);
    expect(app).toMatch(/<PendingNotice lines=\{\[t\('pay_wait\.hint'\)\]\}/);
  });

  it('the money hero consumes money.amountScale.hero with tabular numerals (no door amount exists in the demo world — the kit stands ready)', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function AmountHero/);
    expect(kit).toMatch(/money\.amountScale\.hero\.size/);
    expect(kit).toMatch(/money\.amountScale\.hero\.weight/);
    expect(kit).toMatch(/fontVariant: \['tabular-nums'\]/);
    expect(money.amountScale.hero.size).toBeGreaterThan(seraTheme.typeScale.displayFcfa.size);
  });

  it('the screen change eases in on the ONE soft spring — token params, static under reduced motion', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/export function ScreenTransition/);
    const transition = kit.slice(kit.indexOf('export function ScreenTransition'), kit.indexOf('const styles'));
    expect(transition).toMatch(/motion\.springSoft\.damping/);
    expect(transition).toMatch(/useNativeDriver: true/);
    expect(transition).toMatch(/if \(reduced\) \{/);
    const app = read('App.tsx');
    expect(app).toMatch(/<ScreenTransition screenKey=\{screen\}>/);
    // the movement law's duration band holds at the token level
    expect(motion.quick.durationMs).toBeGreaterThanOrEqual(150);
    expect(motion.standard.durationMs).toBeLessThanOrEqual(250);
  });

  it('the skeleton pulses on motion tokens and is static under reduced motion — no bare spinner anywhere', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).toMatch(/motion\.standard\.durationMs/);
    expect(kit).toMatch(/if \(reduced\) return;/);
    expect(kit).toMatch(/AccessibilityInfo\.isReduceMotionEnabled/);
    expect(kit).toMatch(/reduceMotionChanged/);
    for (const f of FILES) expect(read(f)).not.toMatch(/ActivityIndicator/);
  });

  it('navigation chrome: header everywhere, hubs = Service·Courses, tabs are waypoint RESETS (never edges, never go())', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/<AppHeader/);
    expect(app).toMatch(/HUBS: readonly Screen\[\] = \['service', 'courses'\]/);
    for (const key of ['nav.tab_service', 'nav.tab_courses']) {
      expect(app).toContain(`t('${key}')`);
    }
    // the tab bar never renders off-hub (single source: HUBS gate)
    expect(app).toMatch(/\{HUBS\.includes\(screen\) && \(\s*<TabBar/);
    // Service = the root reset, Courses = the toCourses waypoint — and the
    // TabBar block carries NO go( (a tab is never a journey edge)
    const tabBlock = app.slice(app.indexOf('<TabBar'), app.indexOf('</SafeAreaView>'));
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
    expect(app).toMatch(/item\.attempt === 2 && <StatusChip tone="info" label=\{t\('courses\.lineage_2e'\)\}/);
  });

  it('the kit imports stay inside the RN + tokens world (banned-import law extended to the kit)', () => {
    const BANNED = /@platform\/certification|@platform\/contracts|@platform\/i18n\/(data-loader|lint-cli)|@sera\/commerce-core|^node:/;
    const kit = read('src/ui/kit.tsx');
    const specs = [...kit.matchAll(/^import [^;]*from '([^']+)';/gm)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(spec, `kit imports ${spec}`).not.toMatch(BANNED);
  });

  it('the kit references NO celebration moment — the named rider moment is not in this order', () => {
    const kit = read('src/ui/kit.tsx');
    expect(kit).not.toMatch(/[Cc]elebrat|produit_pret|premiere_vente|course_validee/);
  });
});
