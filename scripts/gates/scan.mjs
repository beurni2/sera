import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Shared scanner for the E0 architectural gates. Each gate names banned
 * patterns and the roots it scans; a hit fails the build.
 *
 * Default scan roots are the PRODUCT code: apps/, services/, packages/.
 * scripts/ (this tooling, which necessarily spells the banned patterns) and
 * gates/fixtures/ (the negative fixtures) sit outside the roots by design —
 * a gate run against a fixture dir is the demonstration that the gate fails.
 */

export const DEFAULT_ROOTS = ['apps', 'services', 'packages'];

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', '.expo', '.git', 'coverage']);
const SCANNED_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|sql|ya?ml)$/;

export function* walkFiles(root) {
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
      if (!EXCLUDED_DIRS.has(entry.name)) yield* walkFiles(path);
    } else if (entry.isFile() && SCANNED_EXTENSIONS.test(entry.name)) {
      yield path;
    }
  }
}

/**
 * Scan roots for banned patterns. Returns hits as {file, line, lineNo, pattern}.
 */
export function scanForPatterns(roots, patterns) {
  const hits = [];
  for (const root of roots) {
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const file of walkFiles(root)) {
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
export function countScannedFiles(roots) {
  let count = 0;
  for (const root of roots) {
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const _ of walkFiles(root)) count += 1;
  }
  return count;
}

/**
 * Standard gate entrypoint: scan, report, exit 1 on any hit. Exit 2 when
 * zero files were scanned — a deleted/renamed target must read as "gate
 * could not run", never as a pass (verifier finding, 2026-07-09).
 */
export function runScanGate({ gateName, invariant, patterns, defaultRoots = DEFAULT_ROOTS }) {
  const args = process.argv.slice(2);
  const roots = args.length > 0 ? args : defaultRoots;
  if (countScannedFiles(roots) === 0) {
    console.error(`${gateName} ERROR — no scannable files under ${roots.join(', ')}; refusing to pass on an empty scan`);
    process.exit(2);
  }
  const hits = scanForPatterns(roots, patterns);
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
