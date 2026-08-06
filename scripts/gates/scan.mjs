import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Shared scanner for the WO-SE0.1 architectural gates. Each gate names banned
 * patterns and the roots it scans; a hit fails the build.
 *
 * Default scan roots are the PRODUCT code: apps/, services/, packages/.
 * scripts/ (this tooling, which necessarily spells the banned patterns) and
 * gates/fixtures/ (the negative fixtures) sit outside the roots by design —
 * a gate run against a fixture dir is the demonstration that the gate fails.
 */

export const DEFAULT_ROOTS = ['apps', 'services', 'packages'];

/**
 * ── AUDIT-B+1 F2 / M-GATE-03 — THE UNSCANNED-DIRECTORY BLIND SPOT ──────────
 * Found by a harness audit of Boutik+; this repo shipped the identical hole.
 * `DEFAULT_ROOTS` is an allowlist, so every law gate was blind to any top-level
 * directory nobody thought to add to it. A `workers/` or `functions/` or `lib/`
 * created next year would carry a violation past a board printing ALL GATES
 * GREEN — and nothing anywhere would say so.
 *
 * The fix is not "scan everything": `scripts/` and `docs/` necessarily SPELL
 * the banned patterns (this file does), and `gates/fixtures/` exists to fail.
 * The fix is that a directory may not be silently *unclassified*. Every
 * top-level name is either a product root (scanned) or listed below with the
 * reason it is not — and a name in neither list fails the gate until a human
 * decides which it is. The blind spot becomes a build break instead of silence.
 *
 * This list is the UNION across boutik-plus, shop-plus and sera so the three
 * copies stay in step. They are NOT byte-identical — boutik-plus carries an
 * `allow` carve-out these two lack — so this list is kept equal by review.
 */
export const NON_PRODUCT_DIRS = new Map([
  ['scripts', 'the gate tooling itself — it necessarily spells every banned pattern'],
  ['gates', 'negative fixtures: a gate run against them is the proof they fail'],
  ['docs', 'the canon — it names the laws, so it names the banned words'],
  ['adr', 'decision records: prose about what we refuse to build'],
  ['WORK-ORDERS', 'work orders: prose, including FORBIDDEN sections that name shortcuts'],
  ['_review', 'review scratch notes, never shipped'],
  ['design-reference', 'the legacy prototype and design references — never implementation'],
  ['design', 'design source files, never shipped code'],
  ['gallery', 'rendered screenshots and design gallery output'],
  ['derivations', 'generated derivation output, reproducible from source'],
  ['test-results', 'Playwright run output, git-ignored'],
  ['node_modules', 'dependencies'],
  /* Build + run output. These are NOT source, but they must still be named:
     `run-gates.sh` CREATES `_evidence/` itself (EVIDENCE_DIR), so leaving it
     unclassified made the board destroy its own run — every gate after the
     first `capture` exited 2. The check reads the filesystem, not git, so
     being gitignored protects nothing. */
  ['_evidence', 'gate-run evidence written by scripts/run-gates.sh'],
  ['coverage', 'test coverage output'],
  ['dist', 'build output'],
  ['build', 'build output'],
  ['out', 'build output'],
]);

/* Tooling dot-directories that are legitimately outside the classification.
   Any OTHER dot-directory is treated like any unclassified directory and fails
   the gate — skipping every name starting with '.' was a hole a verifier walked
   straight through (`.zzworkers/` carrying a live violation, exit 0). */
export const DOT_DIRS_OK = new Set([
  '.git', '.github', '.husky', '.vscode', '.idea', '.turbo', '.expo',
  '.artifacts', '.wrangler', '.claude', '.changeset', '.yarn', '.pnpm-store',
  '.next', '.cache', '.venv', '.gradle', '.devcontainer',
]);

/* `dist-worker` joined at SE-LIVE-1: the esbuild worker bundle inlines the
   PINNED @platform/contracts at runtime (Zod schemas), so scanning it re-scans
   canon vocabulary that is vetted at source in platform-contracts — the same
   reason node_modules is excluded. The bundle's only other input is repo
   source under services/, which IS scanned. */
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'dist-worker', '.turbo', '.expo', '.git', 'coverage']);
const SCANNED_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|sql|ya?ml)$/;

export function* walkFiles(root, extensions = SCANNED_EXTENSIONS, seen = new Set()) {
  // WO-4.0: a root may be a single FILE (e.g. the lockfile) — scan it
  // directly; extension-gating still applies below for directory walks,
  // while an explicit file root is always scanned.
  try {
    if (statSync(root).isFile()) {
      yield root;
      return;
    }
  } catch {
    return;
  }
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    /* `entry.isDirectory()`/`isFile()` are BOTH false for a symlink, so the
       original walk silently skipped symlinked source — a verifier planted a
       live violation behind a symlink inside `apps/` and every gate passed.
       statSync follows the link; `seen` stops a symlink cycle from hanging CI. */
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const key = realpathSync.native(path);
      if (seen.has(key)) continue;
      seen.add(key);
      yield* walkFiles(path, extensions, seen);
    } else if (st.isFile() && extensions.test(entry.name)) {
      yield path;
    }
  }
}

/**
 * Scan roots for banned patterns. Returns hits as {file, line, lineNo, pattern}.
 */
export function scanForPatterns(roots, patterns, extensions = SCANNED_EXTENSIONS) {
  const hits = [];
  for (const root of roots) {
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const file of walkFiles(root, extensions)) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        for (const { name, regex } of patterns) {
          if (regex.test(line)) {
            hits.push({ file: relative(process.cwd(), file), lineNo: i + 1, line: line.trim(), pattern: name });
          }
        }
      });
    }
  }
  return hits;
}

/** Count scannable files under the roots (a scan of nothing proves nothing). */
export function countScannedFiles(roots, extensions = SCANNED_EXTENSIONS) {
  let count = 0;
  for (const root of roots) {
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const _ of walkFiles(root, extensions)) count += 1;
  }
  return count;
}

/**
 * Standard gate entrypoint: scan, report, exit 1 on any hit. Exit 2 when
 * zero files were scanned — a deleted/renamed target must read as "gate
 * could not run", never as a pass (verifier finding, 2026-07-09).
 */
export function unclassifiedTopLevelDirs(roots = DEFAULT_ROOTS, cwd = process.cwd()) {
  let entries;
  try {
    entries = readdirSync(cwd, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => e.name)
    .filter((name) => !(name.startsWith('.') && DOT_DIRS_OK.has(name)))
    .filter((name) => !roots.includes(name) && !NON_PRODUCT_DIRS.has(name));
}

export function runScanGate({ gateName, invariant, patterns, defaultRoots = DEFAULT_ROOTS, scanExtensions = SCANNED_EXTENSIONS }) {
  const args = process.argv.slice(2);
  const roots = args.length > 0 ? args : defaultRoots;
  /* AUDIT-B+1 F2 — the layout audit runs whenever this invocation covers the
     whole product, whether the roots came from the default or were spelled out
     on the command line. Keying it on `args.length === 0` alone meant
     `node gate.mjs apps services packages` skipped it — a bypass a verifier
     found immediately. A narrower run (one fixture, one directory) still skips
     it: that run is not claiming to cover the product. */
  const scanningTheWholeProduct =
    args.length === 0 || DEFAULT_ROOTS.every((r) => roots.includes(r));
  if (scanningTheWholeProduct) {
    /* Audited against the CANONICAL product roots, never against `roots`: a gate
       may legitimately scan a narrower slice (`no-consumer-storefront` scans
       services+apps; `no-expo-token-leak` scans a tracked-file list), and asking
       "is this directory in THIS gate's scope" would call `packages/` unclassified
       every run. The question is about the repo LAYOUT — has every top-level name
       been decided about — and that answer is the same for every gate. */
    const unclassified = unclassifiedTopLevelDirs(DEFAULT_ROOTS);
    if (unclassified.length > 0) {
      console.error(
        `${gateName} ERROR — top-level director${unclassified.length === 1 ? 'y' : 'ies'} ` +
          `not classified: ${unclassified.join(', ')}. This gate does not scan ` +
          `${unclassified.length === 1 ? 'it' : 'them'}, and silence is how a banned ` +
          `pattern ships. Add to DEFAULT_ROOTS (product code — scan it) or to ` +
          `NON_PRODUCT_DIRS with the reason (not product code — say why).`,
      );
      process.exit(2);
    }
  }
  if (countScannedFiles(roots, scanExtensions) === 0) {
    console.error(`${gateName} ERROR — no scannable files under ${roots.join(', ')}; refusing to pass on an empty scan`);
    process.exit(2);
  }
  const hits = scanForPatterns(roots, patterns, scanExtensions);
  if (hits.length === 0) {
    console.log(`${gateName} OK — no banned pattern in ${roots.join(', ')} (${invariant})`);
    process.exit(0);
  }
  console.error(`${gateName} FAILED (${invariant}) — ${hits.length} hit(s):`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.lineNo} [${hit.pattern}] ${hit.line}`);
  }
  process.exit(1);
}
