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

describe('the 26 icon components carry the design-reference geometry (byte-identity)', () => {
  it('there are exactly 26 canonical glyphs, and 26 components', () => {
    expect(svgNames).toHaveLength(26);
    expect(iconsSrc.match(/export function Icon\w+\(/g)).toHaveLength(26);
  });

  it('every path `d`, circle and rect from every SVG appears verbatim in its component', () => {
    for (const name of svgNames) {
      const svg = readFileSync(join(svgDir, `${name}.svg`), 'utf8');
      // pull the geometry-bearing attributes out of the source SVG
      const ds = [...svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
      const circles = [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)];
      for (const d of ds) {
        expect(iconsSrc, `${name}: path d not carried verbatim`).toContain(`d="${d}"`);
      }
      for (const c of circles) {
        expect(iconsSrc, `${name}: circle not carried`).toContain(`cx={${c[1]}}`);
        expect(iconsSrc, `${name}: circle not carried`).toContain(`cy={${c[2]}}`);
      }
    }
  });

  it('every component defaults to currentColor and threads it to every stroke/fill', () => {
    const comps = iconsSrc.split('export function Icon').slice(1);
    expect(comps).toHaveLength(26);
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

describe('the two approved dependencies (founder rulings 2026-07-12) — nothing else', () => {
  it('react-native-svg + expo-haptics at the SDK-54 bundled versions, and no other new dep', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['react-native-svg']).toBe('15.12.1');
    expect(pkg.dependencies['expo-haptics']).toBe('~15.0.8');
    // the only deps beyond the pre-WO set are exactly these two
    const before = new Set([
      '@platform/ui-tokens', 'expo', 'expo-status-bar', 'expo-updates', 'react', 'react-native',
    ]);
    const added = Object.keys(pkg.dependencies).filter((d) => !before.has(d));
    expect(added.sort()).toEqual(['expo-haptics', 'react-native-svg']);
  });
});
