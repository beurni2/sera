import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogSchema } from '@platform/i18n';

const appDir = join(import.meta.dirname, '..');
const catalog = CatalogSchema.parse(
  JSON.parse(readFileSync(join(appDir, 'i18n/catalog.json'), 'utf8')),
);

describe('dispatch-console catalog', () => {
  it('covers every key the shell uses and the shell has no inline French', () => {
    const keys = new Set(catalog.map((e) => e.key));
    const source = readFileSync(join(appDir, 'src/main.ts'), 'utf8');
    const usedKeys = [...source.matchAll(/(?<![\w.])t\('([^']+)'\)/g)].map((m) => m[1]);
    expect(usedKeys.length).toBeGreaterThan(0);
    for (const key of usedKeys) {
      expect(keys.has(key ?? '')).toBe(true);
    }
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/['"«][^'"»]*[àâçéèêëîïôùûüÀÂÇÉÈÊËÎÏÔÙÛÜ]/);
  });

  it('console shell has no runtime import of node-only canon barrels', () => {
    const source = readFileSync(join(appDir, 'src/i18n.ts'), 'utf8');
    const runtimeImports = [...source.matchAll(/^import (?!type )[^;]*from '([^']+)';/gm)].map(
      (m) => m[1],
    );
    for (const spec of runtimeImports) {
      expect(spec, `src/i18n.ts runtime-imports ${spec}`).not.toMatch(/@platform\/(contracts|i18n)/);
    }
  });
});
