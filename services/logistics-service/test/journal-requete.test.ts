import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../worker/index.js';

/**
 * ═══ JOURNAL-SERVICE — the request line at the logistics Worker's door ═══
 *
 * A book that throws instead of answering cannot be made to happen under
 * Miniflare, so this runs the REAL Worker entry in Node on a NAMESPACE
 * DOUBLE — the Durable Object binding is a platform boundary; no app code is
 * stubbed.
 *
 * ═══ THE DOUBLE'S BOUNDS (it may never exceed them) ═══
 * · `idFromName` and `get` in the platform's roles: a name in, a stub out.
 * · The stub's `fetch` rejects with an error whose message is a sentinel: no
 *   line may carry it.
 * · It says nothing about time, routing, or the object behind the binding.
 */

const SERVICE = 'logistics-service';
const MESSAGE = 'QXMESSAGE-livre-injoignable';

let ecrits: string[] = [];
const lignes = (): Record<string, unknown>[] => ecrits.map((m) => JSON.parse(m) as Record<string, unknown>);

beforeEach(() => {
  ecrits = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    ecrits.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a request the book throws on is said once, by the error’s class — and the throw reaches the caller', () => {
  it('one error line: its template, method, 500, duration, correlation id and the class; the rejection is the caller’s, unchanged', async () => {
    // Not a plain Error: the line must name the class it was given.
    const erreur = new RangeError(MESSAGE);
    const env = {
      LOGISTICS: { idFromName: (nom: string) => nom, get: () => ({ fetch: () => Promise.reject(erreur) }) },
    } as unknown as Env;
    const requete = new Request('https://logistics/rider/moi', { headers: { 'x-correlation-id': 'corr-jrn-jete-0001' } });

    await expect(worker.fetch(requete, env)).rejects.toBe(erreur);
    expect(lignes()).toEqual([
      {
        ts: expect.any(String),
        level: 'error',
        correlation_id: 'corr-jrn-jete-0001',
        service: SERVICE,
        msg: 'request',
        route: '/rider/moi',
        method: 'GET',
        status: 500,
        durationMs: expect.any(Number),
        error: 'RangeError',
      },
    ]);
    expect(ecrits.some((x) => x.includes(MESSAGE))).toBe(false);
  }, 10_000);
});

/**
 * A path the object answers but the Worker's list does not name is written
 * « unmatched »: its lines can no longer be told apart. Pinned at the source,
 * as the object's call sites are.
 */
describe('every path the logistics object answers is one its request line can name (call sites)', () => {
  const index = readFileSync('worker/index.ts', 'utf8');
  const objet = readFileSync('worker/logistics-do.ts', 'utf8');
  const bloc = (de: string): string => {
    const debut = index.indexOf(de);
    expect(debut, de).toBeGreaterThanOrEqual(0);
    return index.slice(debut, index.indexOf(']);', debut)).replace(/\/\/.*$/gm, '');
  };
  const litteraux = (src: string): string[] => [...src.matchAll(/'([^']*)'/g)].map((m) => m[1]!);

  it('each `pathname === …` in the object is in the Worker’s ROUTES', () => {
    const routes = new Set(litteraux(bloc('const ROUTES: ReadonlySet<string> = new Set([')));
    const chemins = [...new Set([...objet.matchAll(/pathname === '([^']+)'/g)].map((m) => m[1]!))];
    expect(chemins.length).toBeGreaterThan(0);
    expect(chemins.filter((c) => !routes.has(c))).toEqual([]);
  });
});
