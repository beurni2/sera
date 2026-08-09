import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KIT-SWEEP — the startup module graph, walked from the app's real entry point.
 *
 * Why this test exists: src/ui/kit.tsx was 1288 lines of Grand Teint components
 * that App.tsx imported (twenty names) and rendered ZERO of. Every source scan
 * in this suite was green the whole time, because a scan asks « is this file
 * well-formed? », never « does anything reach it? ». Metro answered the second
 * question the only way that counts — it bundled and evaluated the module at
 * startup on a 1 GB Android (Law 7, offline-first / low-end Android first).
 *
 * So this walks the import graph transitively from index.ts, exactly as the
 * bundler does, and holds two lines no grep can hold:
 *   1. every app-owned import in the graph RESOLVES (a delete cannot orphan one);
 *   2. every app-owned UI module on disk is either IN the graph or NAMED below
 *      as deliberately unshipped — dead weight cannot re-accumulate silently.
 *
 * The authoritative confirmation is the real Metro bundle (expo export), whose
 * own module list is recorded in JOURNAL.md for this slice; this test is the
 * cheap guard that runs on every commit.
 */

const appDir = join(import.meta.dirname, '..');
const ENTRY = join(appDir, 'index.ts');

/** Metro's resolution order for an extensionless relative specifier. */
const CANDIDATES = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

const resolveSpec = (fromFile: string, spec: string): string | null => {
  const base = resolve(dirname(fromFile), spec);
  // an explicit extension (including the bundled .json catalog) resolves as-is
  if (isFile(base)) return base;
  for (const ext of CANDIDATES) {
    if (isFile(base + ext)) return base + ext;
  }
  return null;
};

/**
 * Static specifiers that survive to runtime. A whole-statement `import type {…}`
 * is erased by the TS transform and creates no module, so it is skipped; every
 * value import and re-export counts.
 *
 * Missing an edge here would under-count the graph, and under-counting is the
 * DANGEROUS direction: a module reached only by a missed edge would look absent
 * from the bundle while Metro happily ships it — precisely the illusion this
 * file exists to break. So bare side-effect imports (`import './x';`) and
 * dynamic `import('./x')` are matched too, not just `… from '…'`.
 */
const specifiersOf = (src: string): string[] => {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s*from\s*'([^']+)'/g)) {
    const clause = m[1] ?? '';
    if (/^type\b/.test(clause.trim())) continue; // `import type {…} from` — erased
    out.push(m[2] ?? '');
  }
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+'([^']+)'\s*;/g)) out.push(m[1] ?? ''); // side-effect
  for (const m of src.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) out.push(m[1] ?? ''); // dynamic
  return out;
};

interface Graph {
  readonly modules: ReadonlySet<string>;
  readonly unresolved: ReadonlyArray<{ from: string; spec: string }>;
}

const walk = (entry: string): Graph => {
  const modules = new Set<string>();
  const unresolved: { from: string; spec: string }[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (modules.has(file)) continue;
    modules.add(file);
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue; // data modules (.json) import nothing
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue; // package imports are not app-owned
      const target = resolveSpec(file, spec);
      if (target === null) {
        unresolved.push({ from: relative(appDir, file), spec });
        continue;
      }
      if (!modules.has(target)) queue.push(target);
    }
  }
  return { modules, unresolved };
};

const graph = walk(ENTRY);
const inGraph = (rel: string): boolean => graph.modules.has(join(appDir, rel));

/**
 * App-owned UI modules that live on disk but are deliberately NOT shipped in the
 * startup graph. Every entry needs a reason; an unlisted orphan fails the test.
 *   · fonts.ts — the Grand Teint font map. Its only app consumer was the deleted
 *     kit; it stays on disk because grand-teint.test.ts pins the five embedded
 *     weights against the real TTF assets (a rider who cannot read the screen is
 *     a failed screen). It costs the bundle nothing: it is not in the graph.
 */
const UNSHIPPED_ON_PURPOSE = ['src/ui/fonts.ts'];

describe('KIT-SWEEP — the startup module graph is what the app actually loads', () => {
  it('the walk reached the app (a graph of one module would pass everything vacuously)', () => {
    expect(graph.modules.has(ENTRY)).toBe(true);
    expect(inGraph('App.tsx'), 'App.tsx must be reachable from index.ts').toBe(true);
    expect(graph.modules.size).toBeGreaterThan(20);
  });

  it('every app-owned import in the startup graph RESOLVES — no delete orphans a live import', () => {
    expect(
      graph.unresolved,
      `unresolvable imports: ${graph.unresolved.map((u) => `${u.from} → ${u.spec}`).join(' · ')}`,
    ).toEqual([]);
  });

  it('the retired Grand Teint kit is gone from disk AND from the startup graph', () => {
    expect(existsSync(join(appDir, 'src/ui/kit.tsx')), 'src/ui/kit.tsx is back on disk').toBe(false);
    expect(inGraph('src/ui/kit.tsx')).toBe(false);
    // nothing re-imports it under any spelling
    for (const file of graph.modules) {
      expect(readFileSync(file, 'utf8'), `${relative(appDir, file)} imports the retired kit`).not.toMatch(
        /from '[^']*\/kit'|from '\.\/kit'/,
      );
    }
  });

  it('the live UI layer IS in the graph — the sweep did not cut a rendered module', () => {
    for (const f of [
      'src/ui/faso-kit.tsx',
      'src/ui/faso-sos.tsx',
      'src/ui/faso-act-code.tsx',
      'src/ui/faso-signin.tsx',
      'src/ui/signature.tsx',
      'src/ui/reduced-motion.ts',
      'src/ui/icons.tsx',
      'src/ui/faso.ts',
      'src/ui/faso-fonts.ts',
    ]) {
      expect(inGraph(f), `${f} is NOT reachable from index.ts — the app cannot render it`).toBe(true);
    }
  });

  it('no UI module sits on disk unreachable from the entry point unless it is named', () => {
    const uiDir = join(appDir, 'src/ui');
    const orphans = readdirSync(uiDir)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => `src/ui/${f}`)
      .filter((rel) => !inGraph(rel) && !UNSHIPPED_ON_PURPOSE.includes(rel));
    expect(
      orphans,
      `these UI modules ship to nobody — render them, delete them, or name them in UNSHIPPED_ON_PURPOSE: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('every module named UNSHIPPED_ON_PURPOSE really is on disk and really is unshipped', () => {
    for (const rel of UNSHIPPED_ON_PURPOSE) {
      expect(existsSync(join(appDir, rel)), `${rel} is named but does not exist — stale entry`).toBe(true);
      expect(inGraph(rel), `${rel} is named as unshipped but IS in the startup graph`).toBe(false);
    }
  });
});
