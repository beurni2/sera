#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * CI gate: retired-names (Ten Laws #10). « Ma Boutique » and « Mon Shop » are
 * retired names: they may appear only inside the legacy prototype. New code,
 * UI strings, catalogs, docs and commits use Boutik+ · Shop+ · Séra.
 *
 * This file is the SAME, byte for byte, in every repository of the ecosystem.
 * It imports nothing from the repository it runs in, so a copy can be checked
 * against another with a hash.
 *
 * What stays legal, and `gates/fixtures/retired-names-legal/` fails the board
 * if a pattern here ever breaks it:
 *   · ordinary French « ma boutique » with a small b — the words « my shop »,
 *     as in « Personnaliser ma boutique »;
 *   · the canon name with a possessive before it, « mon Shop+ »;
 *   · words that merely contain the letters (schemaBoutique, commonShop).
 *
 * Scope, with no arguments: every TRACKED file (git ls-files), any extension,
 * binary content skipped. A name in a README, a workflow, a test or a catalog
 * is as visible as one in source. The few paths that must spell the names are
 * left out below, each with its reason, and the list is printed on every run.
 * With arguments: exactly the files and folders named, nothing left out — that
 * is how a negative fixture proves the gate fails.
 *
 * Exit 0: nothing found. Exit 1: a retired name. Exit 2: the scan could not
 * run (git failed, a named path is missing, or nothing was read) — a scan of
 * nothing proves nothing.
 */

/* Run the gate only when EXECUTED, not when imported. `fr-pattern-coverage`
   imports PATTERNS to prove every one of them is exercised by a fixture. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

export const PATTERNS = [
  /* As words. A capital B is the brand; « ma boutique » with a small b is
     ordinary French and stays legal. A no-break space counts as a space. */
  { name: 'retired brand, words (Ma Boutique)', regex: /(?<![A-Za-zÀ-ÿ])[Mm][Aa][  ]+(Boutique|BOUTIQUE)/ },
  /* « mon Shop+ » is the canon name with a possessive: the `+` keeps it legal. */
  { name: 'retired brand, words (Mon Shop)', regex: /(?<![A-Za-zÀ-ÿ])[Mm][Oo][Nn][  ]+(Shop|SHOP)(?!\+)/ },
  /* As identifiers, anywhere in a longer name (getMaBoutique, isMonShop). */
  { name: 'retired brand, PascalCase identifier (MaBoutique)', regex: /MaBoutique/ },
  { name: 'retired brand, PascalCase identifier (MonShop)', regex: /MonShop/ },
  /* As the start of an identifier, a slug or a constant. The look-behind keeps
     schemaBoutique, formaBoutique, commonShop and demonShop legal. */
  { name: 'retired brand, identifier (maBoutique, ma-boutique, ma_boutique)', regex: /(?<![A-Za-zÀ-ÿ0-9])ma[-_]?boutique/i },
  { name: 'retired brand, identifier (monShop, mon-shop, mon_shop)', regex: /(?<![A-Za-zÀ-ÿ0-9])mon[-_]?shop/i },
];

/* Left out of the no-argument run. A path ending in `/` is a folder. */
export const LEFT_OUT = [
  { path: 'docs/', reason: 'the canon, or its drift-checked copy: it states Law 10 itself' },
  { path: 'design-reference/', reason: 'the legacy prototype and design references: the one place the law lets the old names stand' },
  { path: 'CLAUDE.md', reason: 'the rules: they state Law 10' },
  { path: 'AGENTS.md', reason: 'the rules: they state Law 10' },
  { path: 'JOURNAL.md', reason: 'the record of the slices that retired the names' },
  { path: '_review/', reason: 'review scratch and captured diffs, never shipped' },
  { path: 'scripts/gates/retired-names.mjs', reason: 'this gate: it spells every pattern' },
  { path: 'gates/pattern-roster.json', reason: 'the roster stores every pattern source' },
  { path: 'gates/fixtures/negative/retired-names/', reason: 'the negative fixtures: they exist to fail' },
];

function isLeftOut(file) {
  return LEFT_OUT.some((x) => (x.path.endsWith('/') ? file.startsWith(x.path) : file === x.path));
}

function* walk(path) {
  if (statSync(path).isFile()) {
    yield path;
    return;
  }
  for (const name of readdirSync(path).sort()) yield* walk(join(path, name));
}

function runRetiredNamesGate({ patterns }) {
  const args = process.argv.slice(2);
  let files = [];
  if (args.length > 0) {
    for (const arg of args) {
      try {
        files.push(...walk(arg));
      } catch {
        console.error(`retired-names ERROR — cannot read ${arg}; refusing to pass on a scan that never ran`);
        process.exit(2);
      }
    }
  } else {
    let tracked;
    try {
      tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    } catch {
      console.error('retired-names ERROR — git ls-files failed; refusing to pass on a scan that never ran');
      process.exit(2);
    }
    files = tracked.split('\0').filter((f) => f !== '' && !isLeftOut(f));
    for (const x of LEFT_OUT) console.log(`retired-names left out — ${x.path} (${x.reason})`);
  }

  let scanned = 0;
  let binary = 0;
  let unreadable = 0;
  const hits = [];
  for (const file of files) {
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      unreadable += 1;
      continue;
    }
    /* A NUL in the first 8000 bytes is binary, the same test git uses. */
    if (buf.subarray(0, 8000).includes(0)) {
      binary += 1;
      continue;
    }
    scanned += 1;
    buf.toString('utf8').split('\n').forEach((line, i) => {
      for (const { name, regex } of patterns) {
        if (regex.test(line)) hits.push({ file, lineNo: i + 1, pattern: name, line: line.trim().slice(0, 200) });
      }
    });
  }

  const summary = `${scanned} text file(s) read, ${binary} binary skipped, ${unreadable} unreadable`;
  if (scanned === 0) {
    console.error(`retired-names ERROR — ${summary}; refusing to pass on an empty scan`);
    process.exit(2);
  }
  if (hits.length === 0) {
    console.log(`retired-names OK — no retired name in ${args.length > 0 ? args.join(', ') : 'the tracked files'} (${summary}; Ten Laws #10)`);
    process.exit(0);
  }
  console.error(`retired-names FAILED (Ten Laws #10 — the retired names live only in the legacy prototype) — ${hits.length} hit(s), ${summary}:`);
  for (const hit of hits) console.error(`  ${hit.file}:${hit.lineNo} [${hit.pattern}] ${hit.line}`);
  process.exit(1);
}

if (isMainModule) {
  runRetiredNamesGate({
    patterns: PATTERNS,
  });
}
