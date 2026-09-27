import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ENREGISTREMENTS, porteDe } from '@platform/recorded-answers';

/**
 * REPONSES-ENREGISTREES-1 (Boutik+ AUDIT-B+2 F-82) — WHAT THIS WORKER REALLY
 * ANSWERS on the doors Boutik+'s screen walks stand in for.
 *
 * Inert unless `REPONSES_RELEVE` names a file: then every answer the real
 * Worker gives, in any suite, on one of Séra's recorded doors is appended to
 * it — only observed, never altered. `scripts/certifier-reponses.mjs` runs the
 * suites this way and checks the recording against what was seen.
 *
 * WHERE IT WATCHES: `Miniflare#dispatchFetch` is an arrow function set on each
 * instance, so the class cannot be wrapped; every call sends the request
 * through the `fetch` of Miniflare's OWN copy of undici, which Miniflare reads
 * live — that is the one shared point, and it is wrapped here.
 */
const fichier = process.env['REPONSES_RELEVE'];
if (fichier !== undefined) {
  const portes = ENREGISTREMENTS.filter((p) => p.producteur === 'sera');
  const ici = createRequire(import.meta.url);
  const undici = createRequire(ici.resolve('miniflare'))('undici') as {
    fetch: (req: Request, opts?: unknown) => Promise<Response>;
  };
  const reel = undici.fetch;
  undici.fetch = async (req, opts) => {
    const res = await reel(req, opts);
    const porte = porteDe(portes, req.method, new URL(req.url).pathname);
    if (porte !== undefined) {
      const texte = await res.clone().text();
      let corps: unknown = texte;
      try {
        corps = JSON.parse(texte);
      } catch {
        // a body that is not JSON is recorded as the text it is
      }
      appendFileSync(fichier, `${JSON.stringify({ methode: req.method, chemin: porte.chemin, statut: res.status, corps })}\n`);
    }
    return res;
  };
}
