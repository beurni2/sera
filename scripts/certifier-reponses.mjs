#!/usr/bin/env node
// REPONSES-ENREGISTREES-1 (Boutik+ AUDIT-B+2 F-82) — THE PRODUCER'S CHECK.
//
// Boutik+'s screen walks stand in for some of this Worker's doors; they may
// only answer a form recorded in @platform/recorded-answers. This proves each
// recorded form is one the REAL Worker gives: the service's own workerd suites
// run with the watcher on (test/reponses-releve.ts), and every recorded form
// must be among what they saw. A form seen but not recorded is listed, never
// failed — Séra may answer more than Boutik+'s walks may copy.
//
//   node scripts/certifier-reponses.mjs [--garder <releve.jsonl>]      run the suites, check
//   node scripts/certifier-reponses.mjs --releve <releve.jsonl> [--portes <json>]   check a relevé already taken
//   node scripts/certifier-reponses.mjs --enregistrer <out.json>       run the suites, write the recording
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE = join(ROOT, 'services/logistics-service');
const PRODUCTEUR = 'sera';
const lib = await import(pathToFileURL(join(SERVICE, 'node_modules/@platform/recorded-answers/dist/index.js')).href);

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

let releve = opt('--releve');
if (releve === undefined) {
  releve = opt('--garder') ?? join(mkdtempSync(join(tmpdir(), 'reponses-')), 'releve.jsonl');
  writeFileSync(releve, '');
  // vitest exits non-zero on any failing test, which throws here: a relevé is
  // only ever taken from a green run.
  // the suites load the built bundle; `pretest` is not run on this path
  execSync('pnpm bundle:worker && pnpm exec vitest run e2e', { cwd: SERVICE, env: { ...process.env, REPONSES_RELEVE: releve }, stdio: 'inherit' });
}
const portes =
  opt('--portes') === undefined
    ? lib.ENREGISTREMENTS.filter((p) => p.producteur === PRODUCTEUR)
    : JSON.parse(readFileSync(opt('--portes'), 'utf8'));

const vus = new Map();
for (const ligne of readFileSync(releve, 'utf8').split('\n')) {
  if (ligne === '') continue;
  const r = JSON.parse(ligne);
  const k = `${r.methode} ${r.chemin}`;
  if (!vus.has(k)) vus.set(k, []);
  vus.get(k).push(lib.formeDe(r.statut, r.corps));
}

const sortie = opt('--enregistrer');
if (sortie !== undefined) {
  const enregistrement = portes.map((p) => ({
    producteur: p.producteur,
    methode: p.methode,
    chemin: p.chemin,
    formes: lib.fusionner(vus.get(`${p.methode} ${p.chemin}`) ?? []),
  }));
  writeFileSync(sortie, `${JSON.stringify(enregistrement, null, 2)}\n`);
  console.log(`recording of ${enregistrement.length} doors written to ${sortie}`);
  process.exit(0);
}

let echec = false;
for (const p of portes) {
  const { manquantes, inconnues } = lib.comparer(p, vus.get(`${p.methode} ${p.chemin}`) ?? []);
  console.log(`${manquantes.length === 0 ? '✓' : '✗'} ${p.methode} ${p.chemin}: ${p.formes.length} recorded form(s)`);
  for (const f of manquantes) console.log(`    RECORDED, NEVER GIVEN by the real Worker: ${f}`);
  for (const f of inconnues) console.log(`    given, not recorded (no stand-in may copy it yet): ${f}`);
  if (manquantes.length > 0) echec = true;
}
process.exit(echec ? 1 : 0);
