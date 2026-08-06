#!/usr/bin/env node
/**
 * CI gate: fr-pattern-coverage (AUDIT-B+1 F2, verifier MAJOR 1).
 *
 * The French negative fixtures fail on the SET of patterns, not on any one of
 * them. A verifier proved the consequence: delete the `solde… ` pattern — the
 * exact identifier the whole slice exists for, named in the commit message, the
 * fixture filename and the board entry — and every fixture stayed red because
 * `cagnotte` and `approvisionnerCompte` still fired. CI would never notice the
 * law had been un-enforced.
 *
 * This gate closes that: EVERY pattern must be exercised by at least one line
 * of its own negative fixtures. Delete a pattern and the fixture line it alone
 * caught becomes unexplained — this gate names it and fails. That makes each
 * pattern individually load-bearing, which is what failure mode #7 demands.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ── THE ROSTER — why a coverage check alone is not enough ───────────────────
 * Measured, and it is worth stating plainly: the coverage half of this gate
 * CANNOT detect a deleted pattern. It iterates the patterns that exist and asks
 * whether each is exercised; delete one and there is simply nothing left to be
 * unexercised, so the gate goes green on a weakened law. That is the same
 * failure it was written to prevent, one level up.
 *
 * So the roster below is checked in. Every pattern name each gate carries is
 * recorded, and this gate fails on ANY divergence — a deletion, a rename, or a
 * silent weakening. Adding a pattern is a deliberate act: you update the roster
 * in the same commit, which is exactly the review moment we want.
 */
const ROSTER_PATH = 'gates/pattern-roster.json';

const GATES = [
  { gate: 'no-wallet-no-funds', fixtures: 'gates/fixtures/negative/no-wallet-no-funds' },
  { gate: 'no-seller-deposit', fixtures: 'gates/fixtures/negative/no-seller-deposit' },
  { gate: 'single-level', fixtures: 'gates/fixtures/negative/single-level' },
];

/* A gate module that lacks the main-module guard EXECUTES when imported, and
   its `process.exit(0)` then terminates THIS process with a success code —
   the coverage check dies silently and CI reads green. Measured: a gate
   reverted to a pre-guard version made this whole gate exit 0 while a law was
   unenforced. So the shape is verified TEXTUALLY, before any import. */
function assertImportable(gatePath) {
  const src = readFileSync(gatePath, 'utf8');
  const problems = [];
  if (!/export const PATTERNS\s*=/.test(src)) problems.push('does not `export const PATTERNS`');
  if (!/isMainModule/.test(src)) problems.push('has no main-module guard, so importing it runs the gate and exits this process');
  if (problems.length > 0) {
    console.error(`fr-pattern-coverage ERROR — ${gatePath} ${problems.join(' and ')}.`);
    return false;
  }
  return true;
}

let failed = false;
let checkedGates = 0;
let checkedPatterns = 0;

for (const { gate, fixtures } of GATES) {
  const gatePath = `scripts/gates/${gate}.mjs`;
  if (!existsSync(gatePath)) continue;
  if (!assertImportable(gatePath)) { failed = true; continue; }
  if (!existsSync(fixtures)) {
    console.error(`fr-pattern-coverage ERROR — ${gate} has no negative fixtures at ${fixtures}`);
    failed = true;
    continue;
  }
  const { PATTERNS } = await import(`${process.cwd()}/${gatePath}?cov=${Date.now()}`);
  const lines = readdirSync(fixtures)
    .filter((f) => /\.(ts|tsx|mts|cts|js|json)$/.test(f))
    .flatMap((f) => readFileSync(join(fixtures, f), 'utf8').split('\n'));
  if (lines.length === 0) {
    console.error(`fr-pattern-coverage ERROR — ${gate}: fixtures directory has no scannable lines`);
    failed = true;
    continue;
  }
  checkedGates += 1;
  const unexercised = PATTERNS.filter((p) => !lines.some((l) => p.regex.test(l)));
  checkedPatterns += PATTERNS.length;
  if (unexercised.length > 0) {
    console.error(
      `fr-pattern-coverage FAILED — ${gate}: ${unexercised.length} pattern(s) that NO fixture line exercises.\n` +
        `  A pattern nothing tests can be deleted without CI noticing, which is exactly\n` +
        `  how the law gets silently un-enforced. Add a fixture line for each:`,
    );
    for (const p of unexercised) console.error(`    [${p.name}] ${p.regex}`);
    failed = true;
  }
}

/* Roster comparison — catches DELETION, which coverage cannot. */
const rosterFile = ROSTER_PATH;
if (!existsSync(rosterFile)) {
  console.error(`fr-pattern-coverage ERROR — ${rosterFile} is missing; the roster is how a deleted pattern is caught`);
  process.exit(2);
}
const roster = JSON.parse(readFileSync(rosterFile, 'utf8'));
for (const gate of Object.keys(roster)) {
  const gatePath = `scripts/gates/${gate}.mjs`;
  if (!existsSync(gatePath)) {
    console.error(`fr-pattern-coverage FAILED — roster lists ${gate} but ${gatePath} does not exist`);
    failed = true;
    continue;
  }
  if (!assertImportable(gatePath)) { failed = true; continue; }
  const { PATTERNS } = await import(`${process.cwd()}/${gatePath}?roster=${Date.now()}`);
  const live = PATTERNS.map((p) => p.name).sort();
  const want = [...roster[gate]].sort();
  const removed = want.filter((n) => !live.includes(n));
  const added = live.filter((n) => !want.includes(n));
  if (removed.length > 0) {
    console.error(`fr-pattern-coverage FAILED — ${gate}: ${removed.length} pattern(s) REMOVED from a law gate:`);
    for (const n of removed) console.error(`    - ${n}`);
    console.error('  If this removal is intended, delete it from the roster in the SAME commit and say why.');
    failed = true;
  }
  if (added.length > 0) {
    console.error(`fr-pattern-coverage FAILED — ${gate}: ${added.length} pattern(s) not in the roster:`);
    for (const n of added) console.error(`    + ${n}`);
    console.error(`  Add them to ${rosterFile} so the next deletion is visible.`);
    failed = true;
  }
}

if (checkedGates === 0) {
  console.error('fr-pattern-coverage ERROR — no gates checked; refusing to pass on an empty run');
  process.exit(2);
}
if (failed) process.exit(1);
console.log(
  `fr-pattern-coverage OK — every one of ${checkedPatterns} pattern(s) across ${checkedGates} gate(s) is exercised by a fixture line`,
);
