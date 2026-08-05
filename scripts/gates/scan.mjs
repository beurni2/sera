import { readFileSync, readdirSync, statSync } from 'node:fs';
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
 * copies stay identical; the audit found identical blindness in all three, and
 * identical hardening is how it stays fixed.
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
]);

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', '.expo', '.git', 'coverage']);
const SCANNED_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|sql|ya?ml)$/;

export function* walkFiles(root, extensions = SCANNED_EXTENSIONS) {
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
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) yield* walkFiles(path, extensions);
    } else if (entry.isFile() && extensions.test(entry.name)) {
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
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .filter((name) => !roots.includes(name) && !NON_PRODUCT_DIRS.has(name));
}

export function runScanGate({ gateName, invariant, patterns, defaultRoots = DEFAULT_ROOTS, scanExtensions = SCANNED_EXTENSIONS }) {
  const args = process.argv.slice(2);
  const roots = args.length > 0 ? args : defaultRoots;
  /* AUDIT-B+1 F2 — only on a full default-roots run: an explicit-args run is a
     fixture scan or a targeted check, and has no business auditing the layout. */
  if (args.length === 0) {
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
