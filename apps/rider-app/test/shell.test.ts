import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogSchema } from '@platform/i18n';
import { FAILURE_REASON_IDS, POLICY_CHECK_IDS } from '../src/custody-flow.js';

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
      expect(keys.has(key ?? ''), `static key ${key} missing from catalog`).toBe(true);
    }
    // WO-2.1 finding ⑦ (widened at WO-2.2 NB① to ALL template-literal
    // forms): every t(`…`) usage is captured whole; its static segments are
    // split on the interpolations and every segment slot is expanded against
    // the shell's one dynamic id source, the policy checklist. Multi-
    // interpolation and suffix forms (t(`check.${id}.label`)) are covered;
    // a template this expander cannot ground fails the test loudly.
    const templateUses = [...appSource.matchAll(/(?<![\w.])t\(`([^`]+)`\)/g)].map((m) => m[1]!);
    expect(templateUses.length).toBeGreaterThan(0); // the widening must bite
    // Every dynamic id source the shell renders keys from — a new template
    // family MUST register its source here or the test fails loudly.
    const ID_SOURCES: readonly (readonly string[])[] = [POLICY_CHECK_IDS, FAILURE_REASON_IDS];
    for (const literal of templateUses) {
      const segments = literal.split(/\$\{[^}]+\}/);
      const slots = segments.length - 1;
      expect(slots, `t(\`${literal}\`) has no interpolation — use t('…')`).toBeGreaterThan(0);
      // The template is grounded if at least ONE source expands it to keys
      // that ALL exist in the catalog (each runtime family has one source).
      const expansions = ID_SOURCES.map((source) => {
        let candidates: string[] = [segments[0]!];
        for (let s = 1; s < segments.length; s += 1) {
          candidates = candidates.flatMap((head) => source.map((id) => `${head}${id}${segments[s]!}`));
        }
        return candidates;
      });
      const grounded = expansions.some((candidates) => candidates.every((key) => keys.has(key)));
      const best = expansions
        .map((candidates) => ({ candidates, missing: candidates.filter((key) => !keys.has(key)) }))
        .sort((x, y) => x.missing.length - y.missing.length)[0]!;
      expect(grounded, `t(\`${literal}\`) not grounded by any id source — closest source missing: ${best.missing.join(', ')}`).toBe(true);
    }
    const codeOnly = appSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/['"«][^'"»]*[àâçéèêëîïôùûüÀÂÇÉÈÊËÎÏÔÙÛÜ]/);
  });

  it('app.json static backgroundColor stays equal to the Grand Teint paper (drift guard)', async () => {
    const { seraTheme } = await import('@platform/ui-tokens');
    const appConfig = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8'));
    expect(appConfig.expo.backgroundColor).toBe(seraTheme.colours.paper);
  });

  it('the shell bundle imports no node-only barrel (runtime imports of contracts/i18n/commerce-core banned)', () => {
    for (const file of ['App.tsx', 'src/i18n.ts']) {
      const source = readFileSync(join(appDir, file), 'utf8');
      const runtimeImports = [...source.matchAll(/^import (?!type )[^;]*from ['"]([^'"]+)['"];/gm)].map(
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
