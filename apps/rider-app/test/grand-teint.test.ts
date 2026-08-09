import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_FAMILY, FONT_FALLBACK, FONT_WEIGHTS } from '../src/ui/fonts';

/**
 * WO-5.1 — the Grand Teint SUBSTRATE: design reference, typeface, icon
 * components, the two approved deps. NO screen work, NO token consumption.
 * The repo idiom is source-discipline (no RN renderer), so the icon proof is
 * geometry-identity: every component carries the EXACT path/circle/rect
 * geometry of its design-reference SVG, and honors currentColor.
 */

const appDir = join(import.meta.dirname, '..');
const repoRoot = join(appDir, '../..');
const read = (f: string) => readFileSync(join(appDir, f), 'utf8');
const iconsSrc = read('src/ui/icons.tsx');
const svgDir = join(repoRoot, 'design-reference/grand-teint/icons');
const svgNames = readdirSync(svgDir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();

describe('the 27 icon components carry the design-reference geometry (byte-identity)', () => {
  it('there are exactly 27 canonical glyphs, and 27 components', () => {
    expect(svgNames).toHaveLength(27);
    expect(iconsSrc.match(/export function Icon\w+\(/g)).toHaveLength(27);
  });

  it('every path `d`, circle and rect from every SVG appears verbatim in its component', () => {
    for (const name of svgNames) {
      const svg = readFileSync(join(svgDir, `${name}.svg`), 'utf8');
      // pull the geometry-bearing attributes out of the source SVG
      const ds = [...svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
      const circles = [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)];
      // VOIX-ÉTAT-2: `pause` is the first glyph drawn from RECTS, and this loop
      // was checking paths and circles only — so its two bars would have been
      // carried by nobody. The generator emits Rect; the pin now reads Rect.
      const rects = [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)];
      for (const d of ds) {
        expect(iconsSrc, `${name}: path d not carried verbatim`).toContain(`d="${d}"`);
      }
      for (const c of circles) {
        expect(iconsSrc, `${name}: circle not carried`).toContain(`cx={${c[1]}}`);
        expect(iconsSrc, `${name}: circle not carried`).toContain(`cy={${c[2]}}`);
      }
      for (const r of rects) {
        expect(iconsSrc, `${name}: rect not carried`).toContain(`x={${r[1]}} y={${r[2]}} width={${r[3]}} height={${r[4]}}`);
      }
    }
  });

  it('every component defaults to currentColor and threads it to every stroke/fill', () => {
    const comps = iconsSrc.split('export function Icon').slice(1);
    expect(comps).toHaveLength(27);
    for (const c of comps) {
      expect(c).toMatch(/color = 'currentColor'/); // the default
      expect(c).toMatch(/stroke=\{color\}/); // stroke threads it
      expect(c).toMatch(/color=\{color\}/); // Svg color prop → resolves currentColor on children
      expect(c).toMatch(/width=\{size\} height=\{size\}/); // sized by prop, default 20
      expect(c).toMatch(/viewBox="0 0 24 24"/);
    }
    expect(iconsSrc).toMatch(/size = 20/); // legible-at-20dp default
    expect(iconsSrc).toMatch(/from 'react-native-svg'/);
  });

  it('the module carries no hardcoded color — currentColor only (zero-hardcode)', () => {
    expect(iconsSrc).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(iconsSrc).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });
});

describe('the typeface substrate (Archivo, Latin) — data only, loads nothing', () => {
  it('the family + fallback match the design tokens (Archivo over a metrics-matched system fallback)', () => {
    const tokens = JSON.parse(
      readFileSync(join(repoRoot, 'design-reference/grand-teint/docs/tokens.json'), 'utf8'),
    ) as { type: { family: string; familyFallback: string } };
    expect(FONT_FAMILY).toBe(tokens.type.family);
    expect(FONT_FAMILY).toBe('Archivo');
    expect(FONT_FALLBACK).toBe('System'); // RN's metrics-close system face
    expect(tokens.type.familyFallback).toContain('system-ui');
  });

  it('the five static weights the design uses exist on disk (400/500/700/800/900)', () => {
    expect(Object.keys(FONT_WEIGHTS).map(Number).sort((a, b) => a - b)).toEqual([400, 500, 700, 800, 900]);
    let total = 0;
    for (const file of Object.values(FONT_WEIGHTS)) {
      const p = join(appDir, 'assets/fonts', file);
      const size = statSync(p).size;
      expect(size, `${file} present + non-trivial`).toBeGreaterThan(10_000);
      total += size;
    }
    // within the design's 180–240 KB estimate (budget.md), no runaway
    expect(total).toBeLessThan(240 * 1024);
  });

  it('the substrate GATES NOTHING: it is data, with no font loader and no expo-font import (cold-start law)', () => {
    // comments stripped: the docblock EXPLAINS the loader belongs elsewhere.
    const src = read('src/ui/fonts.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/expo-font|loadAsync|useFonts/); // no loader here — first paint never waits
    expect(src).not.toMatch(/\brequire\(/); // no binary asset require in the data module
  });
});

describe('the approved dependencies — nothing else', () => {
  it('react-native-svg + expo-haptics (WO-6.1 rulings) + expo-font (WO-6.2 fix), at SDK-54 versions', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['react-native-svg']).toBe('15.12.1');
    expect(pkg.dependencies['expo-haptics']).toBe('~15.0.8');
    // WO-6.2: expo-font is a DIRECT dep so the config plugin (RULING ②, native
    // embedding) resolves when eas spawns expo raw. Not a new capability — the
    // package that backs the app.json plugin WO-6.1 already declared.
    expect(pkg.dependencies['expo-font']).toBe('~14.0.12');
    // SERA-S1 re-pin (canon v0.9.8): the persistent-outbox primitive's two
    // authorized substrates — expo-crypto (the founder's command_id ruling:
    // UUIDv4 · OS CSPRNG · Math.random forbidden — mandated for RN by the v0.9.5
    // mint rule) and expo-file-system (the durable document-dir store, boutik's
    // expoDocumentStore precedent — survives kill+reboot). SDK-54 bundled versions.
    expect(pkg.dependencies['expo-crypto']).toBe('~15.0.9');
    expect(pkg.dependencies['expo-file-system']).toBe('~19.0.23');
    // SERA-S4 (closes the durability arc): expo-network — REAL connectivity behind
    // a port (the CTO-authorized substrate), retiring the compile-time CONNECTIVITY
    // constant. SDK-54 bundled version.
    expect(pkg.dependencies['expo-network']).toBe('~8.0.8');
    /**
     * ⚠ SE-LIVE-4c-vii · expo-image-picker — the PROOF PHOTO, on the founder's
     * ruling « build the photo capture » (2026-08-07). This allowlist is why a
     * new native capability cannot appear by accident, so it is named here
     * deliberately rather than let through: `launchCameraAsync` is one system
     * sheet (no preview surface of ours to hold at 60 fps on a 1 GB phone),
     * and without it there are no bytes, no ref, and the seal cannot go — which
     * is exactly the dead-button state verifier blocker A1 found. SDK-54
     * bundled version, like every other pin here.
     */
    expect(pkg.dependencies['expo-image-picker']).toBe('~17.0.11');
    /**
     * ⚠ AND expo-image-manipulator, WITHOUT WHICH THE PICKER IS USELESS HERE
     * (verifier blocker A1, round three). `quality` is JPEG compression, not a
     * resize, and the picker offers no resize at all — so every capture went up
     * at the sensor's native size and media-service refused it outright
     * (`bad_dimensions` above a 2048 box; its own comment says « the app
     * resizes on device »). Every phone in this market shoots wider than that,
     * so every proof photo was rejected and the seal could never be sent.
     * Boutik+ has always honoured this — `studio/normalization.ts`. Same pin.
     */
    expect(pkg.dependencies['expo-image-manipulator']).toBe('~14.0.8');
    // the only deps beyond the pre-WO set are exactly these six. @platform/*
    // are baseline canon infra (not third-party capabilities): SERA-S1 adds
    // @platform/contracts as the home of the canon `mintCommandId` helper, consumed
    // RN-safe via the pure-zod /dist/command-id subpath (never the barrel).
    const before = new Set([
      '@platform/contracts', '@platform/ui-tokens', 'expo', 'expo-status-bar', 'expo-updates', 'react', 'react-native',
    ]);
    const added = Object.keys(pkg.dependencies).filter((d) => !before.has(d));
    // COURSE-BRIEF (founder order 2026-08-09): `expo-audio` is the ONE new
    // native capability — playing the buyer's recorded repère on the rider's
    // screen. Version is the SDK-54 bundled pin read from expo's own
    // bundledNativeModules.json, never a guess. ⚠ Native module = the rider
    // installs a NEW BUILD; an OTA update alone cannot carry it.
    expect(pkg.dependencies['expo-audio']).toBe('~1.1.1');
    expect(added.sort()).toEqual(['expo-audio', 'expo-crypto', 'expo-file-system', 'expo-font', 'expo-haptics', 'expo-image-manipulator', 'expo-image-picker', 'expo-network', 'react-native-svg']);
  });
});
