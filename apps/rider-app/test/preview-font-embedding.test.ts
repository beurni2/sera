import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WO-6.2 PERMANENT regression guard for the expo-preview publish (the RED that
 * kept the rider's face off the founder's phone). The preview publish fails
 * SILENTLY in three ways — each is a way the typeface silently vanishes from
 * the published bundle:
 *
 *  1. expo-font drops back to a TRANSITIVE dep. This is the exact WO-6.1 → WO-6.2
 *     bug: eas-cli spawns expo's cli RAW (no pnpm env), so @expo/config-plugins
 *     resolves the `expo-font` plugin with plain node resolution from this dir —
 *     a transitive dep is unreachable under pnpm's isolated node_modules →
 *     `PluginError: Failed to resolve plugin for module "expo-font"` → exit 1.
 *  2. The expo-font config plugin is removed from app.json → native embedding is
 *     gone; the app ships with the system fallback forever (RULING ② broken).
 *  3. A referenced .ttf is deleted → the plugin points at a missing asset.
 *
 * This test fails on ALL THREE. Native embedding (RULING ②) is only real when
 * all three hold together.
 */

const appDir = resolve(dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const appJson = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8')) as {
  expo: { plugins?: unknown[] };
};

function fontPlugin(): [string, { fonts?: string[] }] | undefined {
  for (const p of appJson.expo.plugins ?? []) {
    if (Array.isArray(p) && p[0] === 'expo-font') return p as [string, { fonts?: string[] }];
  }
  return undefined;
}

describe('WO-6.2 — the preview publish embeds Archivo natively (no silent typeface loss)', () => {
  it('DROP MODE 1: expo-font is a DIRECT dependency (transitive-only is what broke the publish)', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(
      deps['expo-font'],
      'expo-font must be a DIRECT dep — a config plugin is resolved by plain node resolution from this dir when eas spawns expo raw',
    ).toBeDefined();
    // and it must actually resolve from THIS directory (the exact resolution
    // @expo/config-plugins does), not merely appear in package.json
    expect(() => require.resolve('expo-font', { paths: [appDir] })).not.toThrow();
  });

  it('DROP MODE 2: the expo-font config plugin is present in app.json (native embedding, not async load)', () => {
    const plugin = fontPlugin();
    expect(plugin, 'app.json must list the expo-font config plugin (RULING ②: font in the binary at first frame)').toBeDefined();
  });

  it('DROP MODE 3: every font the plugin references exists on disk; the 6 Faso Premium faces are embedded', () => {
    const plugin = fontPlugin();
    const fonts = plugin?.[1]?.fonts ?? [];
    // WO-FP-SERA STEP 0: the plugin embeds the 6 Faso Premium faces (Bricolage
    // 700/800 + Instrument 400-700). ARCHIVO-SWEEP 2026-08-09: the five Archivo
    // faces that « rode alongside during the transition » are gone — the last
    // rider view migrated off /legacy long ago and nothing requested them, while
    // the native build kept packing 170 808 bytes of them into every APK.
    const FASO = [
      'Bricolage-700.ttf', 'Bricolage-800.ttf',
      'Instrument-400.ttf', 'Instrument-500.ttf', 'Instrument-600.ttf', 'Instrument-700.ttf',
    ];
    for (const face of FASO) {
      expect(fonts.some((f) => f.endsWith(face)), `plugin must embed ${face}`).toBe(true);
    }
    // EXACTLY six: a seventh face means either a new family arrived unreviewed
    // or the retired substrate came back. « At least six » could not say that.
    expect(fonts, `embed list: ${fonts.join(', ')}`).toHaveLength(6);
    for (const rel of fonts) {
      const abs = join(appDir, rel);
      expect(existsSync(abs), `font asset missing: ${rel}`).toBe(true);
      // a non-empty real .ttf, not a placeholder
      expect(readFileSync(abs).length, `font asset empty: ${rel}`).toBeGreaterThan(1000);
    }
  });
});
