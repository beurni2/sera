#!/usr/bin/env node
// SERA-S1 — the MINT-PATH ENTROPY gate, INHERITED from canon (WO-5.9, founder
// ruling Beurni 2026-07-13; every repo inherits). No command_id mint path may draw
// its idempotency key from `Math.random` — only the OS CSPRNG. `Math.random()`
// carries only its SEED's entropy (unproven on a cold-booted Android-Go device), so
// two commands can collide into one idempotency key — a double-charge or a lost
// action. This gate scans every mint-path source file (`command-id*` / `commandId*`)
// and fails on any `Math.random`, and requires each to actually draw from a CSPRNG
// (so an empty file cannot pass vacuously).
//
// TWO ADAPTATIONS from the canon original, both faithful to its spirit:
//   1. Walk roots are Séra's `apps/` + `services/` + `packages/` — Séra's mint seam
//      lives at `apps/rider-app/src/offline/commandId.ts`, not under `packages/`.
//   2. The CSPRNG requirement is satisfied by a DIRECT draw (`randomUUID` /
//      `getRandomValues`) OR by ADOPTING the canon helper (`mintCommandId` imported
//      from the canon `command-id` module) — the canon derivation's explicit
//      intent ("consumers adopt `mintCommandId` at their offline seam"): the draw
//      lives in canon, the consumer adopts it, and re-implementing would be drift.
//      The `Math.random` ban is unchanged and absolute.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Collect mint-path files under a root, skipping node_modules/dist/test. */
function walk(dir, acc) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'test') continue;
      walk(p, acc);
    } else if (/(command-id|commandId|ensureCsprng)[^/\\]*\.(ts|mjs|js)$/.test(name)) {
      // ⚠ `ensureCsprng` JOINED THIS FILTER 2026-08-09 (verifier M1). The canon
      // helper draws from `globalThis.crypto.randomUUID`, and on device that
      // global is installed by `ensureCsprng.ts` and by nothing else — so THAT
      // file is now the entropy source for every command_id on a phone, and the
      // filename filter could not see it. A shim handing back a constant, or a
      // UUID assembled from `Math.random()`, passed this gate and the whole
      // suite. The ban is only absolute if the gate can see where the bytes
      // actually come from.
      acc.push(p);
    }
  }
  return acc;
}
// Optional scan-root argument (the negative fixture points it at a planted
// offender); default is Séra's three source roots.
const argRoot = process.argv[2];
const files = argRoot
  ? walk(join(root, argRoot), [])
  : ['apps', 'services', 'packages'].flatMap((d) => walk(join(root, d), []));

if (files.length === 0) {
  console.log('mint-path-entropy OK: no command-id mint path present in this repo');
  process.exit(0);
}

// Scan CODE, not prose: a comment that says "Math.random is forbidden" is the rule
// being documented, not a violation. Strip block + line comments before scanning.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const problems = [];
for (const f of files) {
  const code = stripComments(readFileSync(f, 'utf8'));
  const rel = f.slice(root.length + 1);
  // A CALL — `Math.random(` — is the violation; a throw/message string that names
  // it (no call paren) is the rule being stated, not drawn from.
  if (/Math\s*\.\s*random\s*\(/.test(code)) {
    problems.push(`${rel}: calls Math.random( — FORBIDDEN as an idempotency-key source (mint from the OS CSPRNG)`);
  }
  const drawsDirectly = /\b(randomUUID|getRandomValues)\b/.test(code);
  const adoptsCanon = /\bmintCommandId\b/.test(code) && /command-id/.test(code);
  if (!drawsDirectly && !adoptsCanon) {
    problems.push(
      `${rel}: no OS CSPRNG draw (randomUUID/getRandomValues) and no adoption of the canon mintCommandId helper — a mint path must not pass vacuously`,
    );
  }
}

if (problems.length) {
  console.error('mint-path-entropy FAILED:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`mint-path-entropy OK: ${files.length} mint path(s) draw from the OS CSPRNG (direct or via canon mintCommandId); zero Math.random`);
