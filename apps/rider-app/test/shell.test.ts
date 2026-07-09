import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogSchema } from '@platform/i18n';

const appDir = join(import.meta.dirname, '..');

describe('rider-app catalog discipline', () => {
  const catalog = CatalogSchema.parse(
    JSON.parse(readFileSync(join(appDir, 'i18n/catalog.json'), 'utf8')),
  );

  it('covers every key the shell uses and the shell has no inline French', () => {
    const keys = new Set(catalog.map((e) => e.key));
    const appSource = readFileSync(join(appDir, 'App.tsx'), 'utf8');
    const usedKeys = [...appSource.matchAll(/(?<![\w.])t\('([^']+)'\)/g)].map((m) => m[1]);
    expect(usedKeys.length).toBeGreaterThan(0);
    for (const key of usedKeys) {
      expect(keys.has(key ?? '')).toBe(true);
    }
    const codeOnly = appSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/['"«][^'"»]*[àâçéèêëîïôùûüÀÂÇÉÈÊËÎÏÔÙÛÜ]/);
  });

  it('app.json static backgroundColor stays equal to the ui-tokens surface (drift guard)', async () => {
    const { seraTheme } = await import('@platform/ui-tokens');
    const appConfig = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8'));
    expect(appConfig.expo.backgroundColor).toBe(seraTheme.colors.surface);
  });

  it('the shell bundle imports no node-only barrel (runtime imports of contracts/i18n/commerce-core banned)', () => {
    for (const file of ['App.tsx', 'src/i18n.ts']) {
      const source = readFileSync(join(appDir, file), 'utf8');
      const runtimeImports = [...source.matchAll(/^import (?!type )[^;]*from '([^']+)';/gm)].map(
        (m) => m[1],
      );
      for (const spec of runtimeImports) {
        expect(spec, `${file} runtime-imports ${spec}`).not.toMatch(
          /@platform\/(contracts|i18n)|@sera\/commerce-core/,
        );
      }
    }
  });
});
