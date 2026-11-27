#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * PROOF of scripts/live-watch.sh — the daily « does live still run main? ».
 *
 * Drives the REAL script against a local git repository (its `main` stands in
 * for origin/main) and a local HTTP server standing in for a live Worker's
 * /health. Bounds of the stand-in: it answers /health with the body each case
 * sets and nothing else; it does not model Cloudflare's edge or propagation.
 *
 * green — the live release is main's newest; an older release whose inputs
 *         are identical to main's (only an unrelated file changed since);
 * red   — an older release with a difference in the inputs; « dev »; no
 *         release; a release that is no commit here; /health not 200;
 *         no address configured; an input that is not in main (a typo, a
 *         renamed folder), even when live is main's newest.
 * And on every case: the output never carries the /health body (a marker
 * field in the fake body must never be printed). Exit 0 when every case
 * answers as it must, 1 otherwise, 2 when the proof could not set itself up.
 */
const script = resolve('scripts/live-watch.sh');
if (!existsSync(script)) {
  console.error(`live-watch-proof FAILED — ${script} does not exist: nothing compares the live release with main`);
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), 'live-watch-'));
const repo = join(work, 'repo');
const git = (args) => {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`live-watch-proof ERROR — git ${args.join(' ')}: ${r.stderr}`);
    rmSync(work, { recursive: true, force: true });
    process.exit(2);
  }
  return r.stdout.trim();
};
mkdirSync(join(repo, 'services', 'svc'), { recursive: true });
spawnSync('git', ['init', '-q', '-b', 'main', repo]);
const ident = ['-c', 'user.name=proof', '-c', 'user.email=proof@example.invalid'];
const commit = (file, text, msg) => {
  writeFileSync(join(repo, file), text);
  git(['add', '-A']);
  git([...ident, 'commit', '-q', '-m', msg]);
  return git(['rev-parse', 'HEAD']);
};
// Every input the cases pass exists in this repository's main.
commit('pnpm-lock.yaml', "lockfileVersion: '9.0'\n", 'lock file');
const before = commit('services/svc/index.ts', 'export const v = 1;\n', 'service v1');
const changed = commit('services/svc/index.ts', 'export const v = 2;\n', 'service v2');
const tip = commit('README.md', 'unrelated\n', 'docs only');

let body = '{}';
let status = 200;
const server = createServer((req, res) => {
  if (req.url !== '/health') { res.writeHead(404); res.end(); return; }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const MARKER = 'BODY-MARKER-never-printed';
const INPUTS = ['services/svc', 'pnpm-lock.yaml'];
const run = (release, { code = 200, address = base, extra = {}, inputs = INPUTS } = {}) => {
  status = code;
  const fields = { ok: true, canon: '3.28.0', marker: MARKER, ...extra };
  if (release !== undefined) fields.release = release;
  body = JSON.stringify(fields);
  return new Promise((done) => {
    const child = spawn('bash', [script, 'svc', address, ...inputs], {
      cwd: repo,
      env: { PATH: process.env.PATH, HOME: process.env.HOME ?? work, WATCH_MAIN: 'main' },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (exit) => done({ exit, out }));
  });
};

const failures = [];
const expect = async (name, p, exit, needle) => {
  const r = await p;
  if (r.exit !== exit || !r.out.includes(needle)) {
    failures.push(`${name}: wanted exit ${exit} with « ${needle} », got exit ${r.exit}: ${r.out.trim()}`);
  } else if (r.out.includes(MARKER) || r.out.includes('"ok"')) {
    failures.push(`${name}: the output carries the /health body: ${r.out.trim()}`);
  } else {
    console.log(`  ok — ${name} (exit ${exit})`);
  }
};

await expect("live = main's newest → green", run(tip), 0, 'OK: live runs main');
await expect('an older release, its inputs identical to main → green', run(changed), 0, 'OK: live runs main');
await expect('an older release with a difference in its inputs → red', run(before), 1, 'a deploy is owed');
await expect('a short release of an older commit with a difference → red', run(before.slice(0, 7)), 1, 'a deploy is owed');
await expect('release « dev » → red', run('dev'), 1, 'names no release');
await expect('no release at all → red', run(undefined), 1, 'names no release');
await expect('a release that is no commit here → red', run('0123456789abcdef0123456789abcdef01234567'), 1, 'not a commit of this repository');
await expect('a release that is not a commit name → red', run('not a sha; echo hi'), 1, 'not a commit');
await expect('/health not 200 → red', run(tip, { code: 503 }), 1, '/health answered 503');
await expect('no address configured → red', run(tip, { address: '' }), 1, 'not configured');
await expect('a misspelled input, live = main → red', run(tip, { inputs: ['services/svc-typo', 'pnpm-lock.yaml'] }), 1, 'input services/svc-typo is not in main');
await expect('a misspelled input beside real ones, a release that differs → red for the input', run(before, { inputs: [...INPUTS, 'tsconfig.base.jsn'] }), 1, 'input tsconfig.base.jsn is not in main');
await expect('free text in the canon is never printed', run(tip, { extra: { canon: `${MARKER} x` } }), 0, 'canon=?');

server.close();
rmSync(work, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`live-watch-proof FAILED — ${failures.length} case(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('live-watch-proof OK — green only when live and main have no difference in what the service is built from; every other case red; no live body printed');
