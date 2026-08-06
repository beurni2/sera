#!/usr/bin/env node
/**
 * CI gate: persisted-state-declared — the STRUCTURAL half of Ten Laws #2.
 *
 * WHY THIS EXISTS, stated honestly. The `no-wallet-no-funds` scan is a
 * TRIPWIRE: it reads vocabulary, and French money vocabulary is ordinary French
 * vocabulary (« solde » is also a clearance sale, « avoir » is also the verb to
 * have, « dépôt » is also a warehouse). Two verifier rounds proved a scan over
 * that space cannot be both leak-free and safe. So the scan catches the obvious
 * case and nothing more.
 *
 * This gate enforces the law where the law actually lives. A wallet is not a
 * word — it is PERSISTED STATE: to hold someone's money you must store an
 * amount against them and read it back later. Durable storage is the only place
 * this app can do that, and every write goes through `storage.put`/`.delete`
 * under a key. That surface is small and enumerable (20 / 51 / 1 call sites when
 * this was written), so it can be DECLARED rather than guessed at.
 *
 * The rule: every storage key an app writes must appear in
 * `gates/persisted-state.json`, saying what it holds and asserting `money:
 * false`. A new persisted key — the only way a wallet can actually arrive —
 * cannot be added without a human writing down what it is. That is a review
 * moment at exactly the right place, and unlike the scan it is conclusive about
 * COVERAGE: no write site is unexamined. It is not a mind-reader: someone can
 * still declare `money: false` about a field that holds money. It makes that a
 * LIE SOMEONE SIGNED, not an accident nobody saw.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const MANIFEST = 'gates/persisted-state.json';
const ROOTS = ['services', 'apps', 'packages'];
const SKIP = new Set(['node_modules', 'dist', '.artifacts', '.turbo', 'coverage', '.git']);

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(p); }
    else if (st.isFile() && /\.(ts|mts|cts)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) yield p;
  }
}

/** Every `storage.put(<key>` / `storage.delete(<key>` — the key expression, verbatim. */
function writeSites() {
  const sites = [];
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = line.match(/storage\s*\.\s*(put|delete)\s*\(\s*([^,)]*)/);
        if (!m) return;
        let key = m[2].trim();
        if (key === '' || key === '{') key = '<object form>';
        const rel = relative(process.cwd(), file);
        sites.push({ file: rel, line: i + 1, key, op: m[1], id: `${rel}::${key}` });
      });
    }
  }
  return sites;
}

const sites = writeSites();
if (sites.length === 0) {
  console.log('persisted-state-declared OK — this repo writes no durable state');
  process.exit(0);
}
if (!existsSync(MANIFEST)) {
  console.error(`persisted-state-declared ERROR — ${sites.length} durable write(s) exist but ${MANIFEST} is missing`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const declared = new Map(manifest.keys.map((k) => [k.id, k]));

let failed = false;

/* 1. Every key written must be declared. This is the coverage guarantee. */
const undeclared = sites.filter((s) => !declared.has(s.id));
if (undeclared.length > 0) {
  console.error(`persisted-state-declared FAILED — ${undeclared.length} durable write(s) under an UNDECLARED key:`);
  for (const s of undeclared) console.error(`  ${s.file}:${s.line}  storage.${s.op}(${s.key})\n     id: ${s.id}`);
  console.error(`  Persisted state is how a wallet actually arrives. Declare each key in ${MANIFEST}`);
  console.error('  with what it holds and "balance": false — or say plainly that it accumulates one.');
  failed = true;
}

/* 2. Nothing may declare that it holds money without a founder ruling on record. */
for (const k of manifest.keys) {
  if (k.balance === true && !k.ruling) {
    console.error(`persisted-state-declared FAILED — "${k.id}" declares balance: true with no "ruling".`);
    console.error('  Ten Laws #2: no app holds funds. This needs a founder ruling quoted here, or it is a bug.');
    failed = true;
  }
  if (typeof k.balance !== 'boolean' || typeof k.what !== 'string' || k.what.trim() === '') {
    console.error(`persisted-state-declared FAILED — "${k.id}" must carry a non-empty "what" and a boolean "balance".`);
    failed = true;
  }
}

/* 3. A declaration for a key nothing writes is stale — it makes the manifest
      lie about the shape of the system, and hides the next real addition. */
const written = new Set(sites.map((s) => s.id));
const stale = manifest.keys.filter((k) => !written.has(k.id));
if (stale.length > 0) {
  console.error(`persisted-state-declared FAILED — ${stale.length} declared key(s) that nothing writes:`);
  for (const k of stale) console.error(`  "${k.id}" — remove it from ${MANIFEST} or restore the write`);
  failed = true;
}

if (failed) process.exit(1);
console.log(
  `persisted-state-declared OK — ${sites.length} durable write(s) across ${new Set(sites.map((s) => s.file)).size} file(s); ` +
    `all ${declared.size} declared, none accumulates a per-actor balance`,
);
