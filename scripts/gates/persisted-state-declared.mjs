#!/usr/bin/env node
/**
 * CI gate: persisted-state-declared — the structural half of Ten Laws #2.
 *
 * WHAT IT COVERS, stated exactly, because the first version overclaimed and a
 * verifier was right to say so. It covers WRITE CALLS — `.put(`, `.delete(`,
 * `.exec(` — on a RECEIVER, and it requires every receiver in the tree to be
 * classified as persistent or not. Persistent receivers' writes must each be
 * declared in `gates/persisted-state.json`. An unclassified receiver fails the
 * build. It does NOT understand aliasing through arbitrary indirection, and it
 * says so here rather than in a commit message nobody reads.
 *
 * WHY IT EXISTS. The vocabulary gates are tripwires; French money words are
 * ordinary French words. A wallet, though, must be PERSISTED to be a wallet:
 * you have to store an amount against a person and read it back. That surface
 * is small, so it is declared rather than guessed at.
 *
 * WHAT IT GUARANTEES — narrowed after verifier round 4 reproduced far more
 * than the previous note admitted. It makes the COMMON, ACCIDENTAL case loud.
 * It is NOT a proof, and these holes are open, measured, on the record:
 *
 *   · THE FINGERPRINT COVERS 15 OF 68 DECLARATIONS. `payloadIsVariable` is
 *     computed from the KEY, not the payload, so `put(NAMED_KEY, { ... })` —
 *     the dominant form — has its record outside the hashed region entirely.
 *     A per-seller running total added to a `receipt` object 21 lines above a
 *     declared write passed. And extracting a payload into a helper function
 *     retires the protection for the 15 that are covered.
 *   · EIGHT PERSISTENCE ROUTES ESCAPE, including the textbook Cloudflare DO
 *     idiom `private st = this.state.storage` as a class field — no site, no
 *     warning, exit 0. Also `storage.transaction()`, storage passed as a
 *     function parameter, D1 `prepare/bind/run`, a `sql` template tag, and a
 *     destructured `put`.
 *   · `localStorage` IS OUT OF SCOPE and is shipped in this product. A
 *     per-seller total there passes every gate.
 *
 * Closing these means resolving payload bindings and receiver identity through
 * the TypeScript compiler API instead of by regex. That is a real slice. Until
 * it is done, do not cite this gate as establishing Ten Laws #2 — cite it as
 * the thing that catches the obvious, and cite the CODE REVIEW for the rest.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { unclassifiedTopLevelDirs } from './scan.mjs';

const MANIFEST = 'gates/persisted-state.json';
const ROOTS = ['services', 'apps', 'packages'];
const SKIP = new Set(['node_modules', 'dist', '.artifacts', '.turbo', 'coverage', '.git', '.expo', '.wrangler', 'dist-worker', 'build', 'out']);

/* ── WHAT COUNTS AS DURABLE ────────────────────────────────────────────────
   Inverted from the first attempt, which asked every receiver to be classified
   and so demanded a ruling on ordinary Maps, Sets and REGEXES (`SUPPLY_ROUTE
   .exec`, `CUBIC_BEZIER.exec`). That is noise, and noise gets rubber-stamped.
   Durable state on this platform comes from a small set of roots, so those are
   what we track — plus per-file ALIASES of them, because
   `const st = this.state.storage` is an ordinary refactor and a verifier used
   exactly that to walk past the previous version. */
const DURABLE_ROOT = /(^|\.)(storage|bucket|sql|kv|db|r2|d1)$|^(BUCKET|KV|DB|R2|D1)$/i;
/* An identifier whose NAME claims persistence but which we did not resolve —
   `myStorage`, `sellerBucket`. Fail rather than assume. */
const LOOKS_PERSISTENT = /(storage|bucket|kv|sql|d1|r2|db)$/i;

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(p); }
    else if (st.isFile() && /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(e.name) && !/\.(test|spec)\.[a-z]+$/.test(e.name)) yield p;
  }
}

/** From `(` at `open`, return the index just past the matching `)`. */
function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** `const st = this.state.storage` / `= env.BUCKET` → `st` is durable in this file. */
function aliasesOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*([^;\n]+)/g)) {
    const rhs = m[2];
    if (/\b(storage|bucket|sql|kv)\b/i.test(rhs) || /\benv\.[A-Z_]+\b/.test(rhs)) names.add(m[1]);
  }
  for (const m of src.matchAll(/(?:const|let|var)\s*\{\s*([^}]+)\}\s*=\s*([^;\n]+)/g)) {
    if (/\b(storage|bucket|sql|kv)\b/i.test(m[2])) {
      for (const part of m[1].split(',')) {
        const n = part.split(':').pop().trim();
        if (/^[\w$]+$/.test(n)) names.add(n);
      }
    }
  }
  return names;
}

const WRITE = /(?:^|[^\w$.])((?:[\w$]+\s*\.\s*)*)([\w$]+)\s*\.\s*(put|delete|exec)\s*\(/g;

function scan() {
  const sites = [];
  const unclassified = [];
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(process.cwd(), file);
      const alias = aliasesOf(src);
      for (const m of src.matchAll(WRITE)) {
        const receiver = m[2];
        const open = src.indexOf('(', m.index + m[0].length - 1);
        const end = matchParen(src, open);
        const stmt = end === -1 ? src.slice(m.index, m.index + 200) : src.slice(m.index, end);
        const line = src.slice(0, m.index).split('\n').length;
        const chain = (m[1] || '') + receiver;
        const durable = DURABLE_ROOT.test(receiver) || DURABLE_ROOT.test(chain.replace(/\s+/g, '')) || alias.has(receiver);
        /* A regex `.exec()` is not a write. Only a SQL receiver's exec is. */
        if (m[3] === 'exec' && !/\b(sql|db|d1)\b/i.test(receiver)) continue;
        if (!durable) {
          if (LOOKS_PERSISTENT.test(receiver)) unclassified.push({ file: rel, line, receiver });
          continue;
        }
        /* slice BETWEEN the parens — including the closing `)` made every key
           end in `)`, which silently defeated the is-variable test below and
           produced ids like `put(batch))`. */
        const argText = stmt.slice(stmt.indexOf('(') + 1, stmt.length - 1).replace(/\s+/g, ' ').trim();
        const key = (argText.split(',')[0] || '').trim() || '<object form>';
        /* ── WHY THE FINGERPRINT REGION IS WIDER FOR A VARIABLE PAYLOAD ──
           Fingerprinting the call alone was not enough. A verifier added
           `batch['solde-vendeur'] = 125000;` on the line BEFORE
           `storage.put(batch)` — the call text never changed, so the
           declaration stayed valid and a balance entered the checkout money
           path unannounced. When the payload is assembled in a variable, the
           construction is the thing that matters, so the region extends back
           over the lines that build it. LIMIT, on the record: construction
           further back than this window still escapes. */
        const payloadIsVariable = key === '<object form>' || /^[a-z][\w$]*$/.test(key);
        let region = stmt;
        if (payloadIsVariable) {
          const before = src.slice(0, m.index).split('\n');
          region = before.slice(Math.max(0, before.length - 30)).join('\n') + stmt;
        }
        sites.push({
          file: rel, line, receiver, op: m[3], key,
          id: `${rel}::${receiver}.${m[3]}(${key})`,
          /* The FINGERPRINT is the whole normalised call. A batch write cannot
             absorb an extra key, and `<object form>` cannot become a wildcard,
             because either edit changes this hash and the declaration must be
             renewed. That was the hole a verifier drove a balance through. */
          fingerprint: createHash('sha256').update(region.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12),
        });
      }
    }
  }
  return { sites, unclassified };
}

/* AUDIT-B+1 F2 / M-GATE-03, again. This gate shipped with its own private
   ROOTS allowlist and no layout audit — reintroducing the exact blind spot
   `scan.mjs` carries a header about fixing. A verifier put a per-seller total
   in a new top-level `workers/` and this gate passed while the older scan
   refused. It now shares scan.mjs's classification. */
const strayDirs = unclassifiedTopLevelDirs();
if (strayDirs.length > 0) {
  console.error(`persisted-state-declared ERROR — unclassified top-level director${strayDirs.length === 1 ? 'y' : 'ies'}: ${strayDirs.join(', ')}.`);
  console.error('  This gate does not look there, so a durable write inside would be unexamined.');
  process.exit(2);
}

const { sites, unclassified } = scan();
let failed = false;

if (unclassified.length > 0) {
  console.error(`persisted-state-declared FAILED — ${unclassified.length} write call(s) on an UNCLASSIFIED receiver:`);
  for (const u of unclassified) console.error(`  ${u.file}:${u.line}  ${u.receiver}.put/delete/exec(...)`);
  console.error('  The NAME claims persistence but the receiver did not resolve to a durable root.');
  console.error('  Either route it through a recognised binding, or extend DURABLE_ROOT deliberately.');
  failed = true;
}

if (sites.length === 0 && !failed) {
  console.log('persisted-state-declared OK — this repo makes no durable write call');
  process.exit(0);
}
if (!existsSync(MANIFEST)) {
  console.error(`persisted-state-declared ERROR — ${sites.length} durable write(s) but ${MANIFEST} is missing`);
  process.exit(2);
}
let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch (e) {
  console.error(`persisted-state-declared ERROR — ${MANIFEST} is not valid JSON: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(manifest.keys)) {
  console.error(`persisted-state-declared ERROR — ${MANIFEST} has no "keys" array`);
  process.exit(2);
}

/* Keyed by id+fingerprint: one storage key legitimately has several distinct
   write statements (boutik's fulfillment-do writes `key` at seven sites with
   four record shapes). Each STATEMENT is declared, so none of them can change
   without its own declaration being renewed. */
const byId = new Map();
for (const k of manifest.keys) {
  const sig = `${k.id}@${k.fingerprint}`;
  if (byId.has(sig)) {
    console.error(`persisted-state-declared FAILED — duplicate declaration for "${sig}"`);
    failed = true;
  }
  byId.set(sig, k);
}

for (const s of sites) {
  if (byId.has(`${s.id}@${s.fingerprint}`)) continue;
  const sameKey = manifest.keys.filter((k) => k.id === s.id);
  if (sameKey.length === 0) {
    console.error(`persisted-state-declared FAILED — undeclared durable write: ${s.file}:${s.line}`);
    console.error(`    id: ${s.id}  fingerprint ${s.fingerprint}`);
  } else {
    console.error(`persisted-state-declared FAILED — this write CHANGED but no declaration matches it: ${s.file}:${s.line}`);
    console.error(`    id: ${s.id}\n    now ${s.fingerprint}; declared for this key: ${sameKey.map((k) => k.fingerprint).join(', ')}`);
    console.error('    Re-read what it now persists and renew the declaration in the SAME commit.');
  }
  failed = true;
}

const ALLOWED = new Set(['id', 'what', 'balance', 'ruling', 'fingerprint']);
for (const k of manifest.keys) {
  for (const f of Object.keys(k)) {
    if (!ALLOWED.has(f)) { console.error(`persisted-state-declared FAILED — "${k.id}" has unknown field "${f}"`); failed = true; }
  }
  if (typeof k.what !== 'string' || k.what.trim().length < 15) {
    console.error(`persisted-state-declared FAILED — "${k.id}" needs a real "what" (≥15 chars) describing what it persists.`);
    failed = true;
  }
  if (typeof k.balance !== 'boolean') { console.error(`persisted-state-declared FAILED — "${k.id}" needs a boolean "balance"`); failed = true; }
  if (typeof k.fingerprint !== 'string' || k.fingerprint.length !== 12) {
    console.error(`persisted-state-declared FAILED — "${k.id}" needs a 12-char "fingerprint"`); failed = true;
  }
  if (k.balance === true && (typeof k.ruling !== 'string' || k.ruling.trim().length < 20)) {
    console.error(`persisted-state-declared FAILED — "${k.id}" declares balance: true without a quoted founder ruling (≥20 chars).`);
    console.error('  Ten Laws #2: no app holds funds.');
    failed = true;
  }
}

const written = new Set(sites.map((s) => `${s.id}@${s.fingerprint}`));
for (const k of manifest.keys) {
  if (!written.has(`${k.id}@${k.fingerprint}`)) {
    console.error(`persisted-state-declared FAILED — declared but nothing writes it: "${k.id}"`);
    failed = true;
  }
}

if (failed) process.exit(1);

/* Derived, never hardcoded. The first version printed "none accumulates a
   per-actor balance" unconditionally — false whenever one was declared, and
   false whenever an evasion was present. */
const balances = manifest.keys.filter((k) => k.balance === true);
const verdict = balances.length === 0
  ? 'none declares a per-actor balance'
  : `${balances.length} declare(s) a per-actor balance UNDER A FOUNDER RULING: ${balances.map((b) => b.id).join(', ')}`;
console.log(
  `persisted-state-declared OK — ${sites.length} durable write call(s) across ` +
    `${new Set(sites.map((s) => s.file)).size} file(s); ${byId.size} declaration(s), all fingerprints current; ${verdict}`,
);
