import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * ═══ JOURNAL-SERVICE — the request line names the path a door opened ═══
 *
 * A path the custody object answers but no door's list names is written
 * « unmatched »: its lines can no longer be told apart. Pinned at the source,
 * as the object's call sites are. The Worker's list is rebuilt here the way
 * the Worker builds it — each door's prefix before each path of its list.
 * The package-claim object is reached only from the custody object, never
 * through a door, so its path is not a door's.
 */
describe('every path the custody object answers is one its request line can name (call sites)', () => {
  const index = readFileSync('worker/index.ts', 'utf8');
  const objet = readFileSync('worker/custody-do.ts', 'utf8');
  const bloc = (de: string, fin: string): string => {
    const debut = index.indexOf(de);
    expect(debut, de).toBeGreaterThanOrEqual(0);
    return index.slice(debut, index.indexOf(fin, debut)).replace(/\/\/.*$/gm, '');
  };
  const litteraux = (src: string): string[] => [...src.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
  const listes: Record<string, string[]> = {
    ROUTES_OBJET: litteraux(bloc('const ROUTES_OBJET = [', '];')),
    RIDER_ROUTES: litteraux(bloc('const RIDER_ROUTES: ReadonlySet<string> = new Set([', ']);')),
    PRODUCE_ROUTES: litteraux(bloc('const PRODUCE_ROUTES: ReadonlySet<string> = new Set([', ']);')),
    PRODUCE_SHOP_ROUTES: litteraux(bloc('const PRODUCE_SHOP_ROUTES: ReadonlySet<string> = new Set([', ']);')),
  };

  it('each `pathname === …` in the object is in the Worker’s ROUTES under one of its door prefixes', () => {
    const composition = bloc('const ROUTES: ReadonlySet<string> = new Set([', ']);');
    const routes = new Set(litteraux(composition));
    const portes: string[] = [];
    const etalees = [...composition.matchAll(/\.\.\.(?:(cheminsDe)\((\w+)\)|(\w+))\.map\(\(r\) => `([^`$]*)\$\{r\}`\)/g)];
    // Every spread is read, or a door could go unchecked.
    expect(etalees.length).toBe(composition.split('...').length - 1);
    for (const [, methodeEnTete, nomChemins, nomBrut, prefixe] of etalees) {
      const liste = listes[(nomChemins ?? nomBrut)!];
      expect(liste?.length, nomChemins ?? nomBrut).toBeGreaterThan(0);
      portes.push(prefixe!);
      for (const r of liste!) routes.add(`${prefixe!}${methodeEnTete === undefined ? r : r.slice(r.indexOf(' ') + 1)}`);
    }
    const chemins = [...new Set([...objet.matchAll(/pathname === '([^']+)'/g)].map((m) => m[1]!))];
    expect(chemins.length).toBeGreaterThan(0);
    expect(chemins.filter((c) => !portes.some((p) => routes.has(`${p}${c}`)))).toEqual([]);
  });
});
