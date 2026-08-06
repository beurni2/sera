#!/usr/bin/env node
/**
 * CI gate: fr-pattern-coverage — the gate that guards the law gates.
 *
 * Three defects it exists to make impossible, each one found by a verifier
 * AFTER an earlier version of this file claimed to have closed it:
 *
 *  1. A pattern nothing exercises can be deleted and CI stays green. So every
 *     pattern must match at least one fixture line.
 *  2. Coverage ALONE cannot see a deletion — remove a pattern and there is
 *     nothing left to be unexercised. So the roster is checked in.
 *  3. A roster of NAMES cannot see a pattern gutted in place: swap the regex
 *     for `/soldeVendeur/` and keep the name, and coverage, roster and the
 *     negative fixture all stay green while the law is gone. So the roster
 *     records each pattern's REGEX SOURCE, and any change to it must be made
 *     deliberately, in the same commit.
 *
 * The gate modules are imported in a CHILD process. An earlier version grepped
 * for the token `isMainModule`; a gate that merely MENTIONS it in a comment
 * passed that check, then executed on import and its `process.exit(0)` killed
 * this process with a success code. A child cannot do that to us.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const GATES = [
  { gate: 'no-wallet-no-funds', fixtures: 'gates/fixtures/negative/no-wallet-no-funds' },
  { gate: 'no-seller-deposit', fixtures: 'gates/fixtures/negative/no-seller-deposit' },
  { gate: 'no-seller-debit', fixtures: 'gates/fixtures/negative/no-seller-debit' },
  { gate: 'single-level', fixtures: 'gates/fixtures/negative/single-level' },
];
const ROSTER_PATH = 'gates/pattern-roster.json';

let failed = false;

/** Import a gate in a CHILD process; it cannot exit ours. Returns [{name, regex}]. */
function loadPatterns(gatePath) {
  const script =
    `const m = await import(${JSON.stringify(`${process.cwd()}/${gatePath}`)});` +
    `if (!Array.isArray(m.PATTERNS)) { console.error('NO_PATTERNS'); process.exit(3); }` +
    `process.stdout.write('@@' + JSON.stringify(m.PATTERNS.map((p) => ({ name: p.name, regex: String(p.regex) }))));`;
  let out;
  try {
    out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error(`fr-pattern-coverage FAILED — ${gatePath} could not be imported cleanly (exit ${e.status}).`);
    console.error('  A law gate must `export const PATTERNS` and must NOT run on import.');
    return null;
  }
  const marker = out.indexOf('@@');
  if (marker === -1) {
    console.error(`fr-pattern-coverage FAILED — ${gatePath} produced no pattern list; it likely RAN on import.`);
    return null;
  }
  if (marker > 0) {
    console.error(`fr-pattern-coverage FAILED — ${gatePath} printed output on import: ${JSON.stringify(out.slice(0, marker).trim())}`);
    return null;
  }
  return JSON.parse(out.slice(marker + 2));
}

if (!existsSync(ROSTER_PATH)) {
  console.error(`fr-pattern-coverage ERROR — ${ROSTER_PATH} is missing; it is how a deleted or gutted pattern is caught`);
  process.exit(2);
}
const roster = JSON.parse(readFileSync(ROSTER_PATH, 'utf8'));

let checkedGates = 0;
let checkedPatterns = 0;

for (const { gate, fixtures } of GATES) {
  const gatePath = `scripts/gates/${gate}.mjs`;
  /* A DELETED law gate used to be skipped silently — `continue` ran BEFORE the
     roster was consulted, so removing the file left the roster listing patterns
     nothing enforced, and this gate still printed OK. */
  if (!existsSync(gatePath)) {
    if (Object.prototype.hasOwnProperty.call(roster, gate)) {
      console.error(`fr-pattern-coverage FAILED — ${gatePath} is GONE but the roster still declares ${roster[gate].length} pattern(s) for it.`);
      console.error('  A law gate cannot be deleted quietly. Remove its roster entry in the same commit and say why.');
      failed = true;
    }
    continue;
  }

  /* Every gate that EXISTS must be in the roster. Without this, emptying the
     roster (or dropping one key) silently disables deletion detection while the
     success line still advertises full coverage. */
  if (!Object.prototype.hasOwnProperty.call(roster, gate)) {
    console.error(`fr-pattern-coverage FAILED — ${gate} exists but has no entry in ${ROSTER_PATH}`);
    failed = true;
    continue;
  }
  if (!existsSync(fixtures)) {
    console.error(`fr-pattern-coverage ERROR — ${gate} has no negative fixtures at ${fixtures}`);
    failed = true;
    continue;
  }
  const patterns = loadPatterns(gatePath);
  if (patterns === null) { failed = true; continue; }

  /* A law gate can be gutted with ZERO diff to PATTERNS: pass
     `defaultRoots: ['services']` to runScanGate and `apps/` stops being
     scanned, while coverage, the roster and both fixtures stay green. A
     verifier did exactly that. These gates must scan the canonical roots. */
  const gateSrc = readFileSync(gatePath, 'utf8');

  /* THE ARRAY CAN BE INTACT AND UNUSED. A verifier passed
     `patterns: PATTERNS.slice(0, 1)` — roster green, coverage green, fixtures
     green, and the gate enforced one pattern. That is this file's own defect #3
     ("gutted while its name, its fixture and the board stay green") one level
     up. So the wiring itself is pinned: the whole array, unmodified, reaches
     runScanGate. */
  if (!/patterns:\s*PATTERNS\s*,/.test(gateSrc)) {
    console.error(`fr-pattern-coverage FAILED — ${gate} does not pass PATTERNS to runScanGate verbatim.`);
    console.error('  An intact array that is sliced, filtered or replaced at the call site enforces nothing.');
    failed = true;
  }
  /* ...and the roots must not be narrowed by ANY route: a computed key or an
     argv push reaches the same end as a literal `defaultRoots:`. */
  if (/process\.argv\s*\.\s*(push|unshift|splice)/.test(gateSrc)) {
    console.error(`fr-pattern-coverage FAILED — ${gate} mutates process.argv, which silently re-roots the scan.`);
    failed = true;
  }
  if (/\[\s*['"`]?default\s*\+|\[\s*[A-Za-z_$][\w$]*\s*\]\s*:/.test(gateSrc)) {
    console.error(`fr-pattern-coverage FAILED — ${gate} uses a COMPUTED option key in its runScanGate call.`);
    console.error('  A computed key hides defaultRoots/scanExtensions from review. Spell options literally.');
    failed = true;
  }

  for (const narrowing of ['defaultRoots', 'scanExtensions']) {
    if (new RegExp(`\\b${narrowing}\\s*:`).test(gateSrc)) {
      console.error(`fr-pattern-coverage FAILED — ${gate} passes \`${narrowing}\` to runScanGate.`);
      console.error('  That narrows what the law gate scans without changing a single pattern.');
      failed = true;
    }
  }

  const lines = readdirSync(fixtures)
    .filter((f) => /\.(ts|tsx|mts|cts|js|json)$/.test(f))
    .flatMap((f) => readFileSync(join(fixtures, f), 'utf8').split('\n'));
  if (lines.length === 0) {
    console.error(`fr-pattern-coverage ERROR — ${gate}: fixtures directory has no scannable lines`);
    failed = true;
    continue;
  }
  checkedGates += 1;
  checkedPatterns += patterns.length;

  /* (1) coverage */
  const unexercised = patterns.filter((p) => {
    const re = new RegExp(p.regex.slice(1, p.regex.lastIndexOf('/')), p.regex.slice(p.regex.lastIndexOf('/') + 1));
    return !lines.some((l) => re.test(l));
  });
  if (unexercised.length > 0) {
    console.error(`fr-pattern-coverage FAILED — ${gate}: ${unexercised.length} pattern(s) exercised by NO fixture line:`);
    for (const p of unexercised) console.error(`    [${p.name}] ${p.regex}`);
    failed = true;
  }

  /* (2)+(3) roster: names AND regex sources */
  const want = roster[gate];
  const liveByName = new Map(patterns.map((p) => [p.name, p.regex]));
  const wantByName = new Map(want.map((p) => [p.name, p.regex]));
  for (const [name, rx] of wantByName) {
    if (!liveByName.has(name)) {
      console.error(`fr-pattern-coverage FAILED — ${gate}: pattern REMOVED from a law gate: "${name}"`);
      console.error(`  If intended, remove it from ${ROSTER_PATH} in the SAME commit and say why.`);
      failed = true;
    } else if (liveByName.get(name) !== rx) {
      console.error(`fr-pattern-coverage FAILED — ${gate}: pattern "${name}" was CHANGED IN PLACE.`);
      console.error(`    roster: ${rx}`);
      console.error(`    live  : ${liveByName.get(name)}`);
      console.error('  A regex can be gutted while its name, its fixture and the board all stay green.');
      failed = true;
    }
  }
  for (const name of liveByName.keys()) {
    if (!wantByName.has(name)) {
      console.error(`fr-pattern-coverage FAILED — ${gate}: pattern not in the roster: "${name}". Add it to ${ROSTER_PATH}.`);
      failed = true;
    }
  }
}

if (checkedGates === 0) {
  console.error('fr-pattern-coverage ERROR — no gates checked; refusing to pass on an empty run');
  process.exit(2);
}
if (failed) process.exit(1);
console.log(`fr-pattern-coverage OK — ${checkedPatterns} pattern(s) across ${checkedGates} gate(s): each exercised by a fixture, each matching the checked-in roster`);
