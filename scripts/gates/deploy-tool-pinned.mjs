#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CI gate: deploy-tool-pinned.
 *
 * Every step that runs Cloudflare's deploy tool holds the Cloudflare key in
 * its environment. So the tool must come from the lock file — one exact
 * version, integrity-checked, installed under the workspace's build-script
 * allow-list — and never be downloaded from the registry at deploy time.
 *
 * Over the workflow files it refuses:
 *   1. any line that runs wrangler through a download runner (`npx`, `pnpx`,
 *      `bunx`, `pnpm dlx`, `yarn dlx`, `npm exec`, `npm x`), wherever it sits
 *      on the line — inside quotes, backticks or `$( )` too;
 *   2. any line that installs wrangler outside the lock file;
 *   3. any wrangler command that is not `pnpm exec wrangler …` or a lock-file
 *      binary (`…/node_modules/.bin/wrangler …`) — a command being wrangler
 *      followed by a known subcommand, a flag, or a line continuation;
 *   4. a Cloudflare wrangler action (it installs its own copy).
 * Only whole-line comments are skipped: a `#` inside a command is kept, so
 * the worst a comment can do is cause a refusal, never hide one.
 * Over the workspace manifests it refuses a wrangler version that is not one
 * exact version, two manifests that pin it differently, and workflows that
 * call wrangler while no manifest declares it.
 *
 * Exit 2 when it cannot see anything: no workflow file, or no wrangler call
 * at all — a scan that saw nothing must not pass.
 *
 * Usage: deploy-tool-pinned.mjs [workflowsDir|file] [workspaceRoot]
 *        (defaults: .github/workflows and .)
 */
const target = process.argv[2] ?? '.github/workflows';
const root = process.argv[3] ?? '.';

let files;
try {
  files = statSync(target).isDirectory()
    ? readdirSync(target).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(target, f))
    : [target];
} catch (err) {
  console.error(`deploy-tool-pinned ERROR — cannot read ${target}: ${String(err)}`);
  process.exit(2);
}
if (files.length === 0) {
  console.error(`deploy-tool-pinned ERROR — no workflow file under ${target}; refusing to pass on silence`);
  process.exit(2);
}

const CALL = /\bwrangler(?:@\S+)?["']?(?=\s+(?:--?[A-Za-z]|\\\s*$|(?:deploy|delete|publish|secret|secrets|pages|versions|deployments|rollback|triggers|kv|r2|d1|queues|hyperdrive|vectorize|workflows|dispatch-namespace|tail|whoami|dev|types|login|logout|init|setup|check)\b))/g;
const DOWNLOAD = /\b(?:npx|pnpx|bunx|pnpm\s+dlx|yarn\s+dlx|npm\s+(?:exec|x))\s[^\n]*\bwrangler\b/;
const INSTALL = /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b[^\n]*\bwrangler\b/;
const refused = [];
let calls = 0;
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    if (/^\s*#/.test(line)) return;
    const code = line;
    if (/wrangler-action/.test(code)) refused.push(`${at} a wrangler action installs its own copy: ${code.trim()}`);
    const downloads = DOWNLOAD.test(code);
    if (downloads) refused.push(`${at} a download runner fetches wrangler at deploy time: ${code.trim()}`);
    if (INSTALL.test(code)) refused.push(`${at} wrangler is installed outside the lock file: ${code.trim()}`);
    for (const m of code.matchAll(CALL)) {
      calls += 1;
      // A download-runner line is already refused above; one refusal per cause.
      if (downloads) continue;
      const before = code.slice(0, m.index);
      const fromLock = /pnpm exec $/.test(before) || /node_modules\/\.bin\/$/.test(before);
      if (!fromLock) {
        refused.push(`${at} wrangler is not called from the lock file (use \`pnpm exec wrangler\`): ${code.trim()}`);
      }
    }
  });
}
if (calls === 0 && refused.length === 0) {
  console.error(`deploy-tool-pinned ERROR — no wrangler command found in ${target}; refusing to pass on silence`);
  process.exit(2);
}

const manifests = [join(root, 'package.json')];
for (const group of ['apps', 'services', 'packages']) {
  const dir = join(root, group);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name, 'package.json');
    if (existsSync(p)) manifests.push(p);
  }
}
const pins = [];
for (const p of manifests) {
  if (!existsSync(p)) continue;
  const pkg = JSON.parse(readFileSync(p, 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const v = pkg[field]?.wrangler;
    if (v === undefined) continue;
    pins.push({ p, v });
    if (!/^\d+\.\d+\.\d+$/.test(v)) refused.push(`${p} wrangler "${v}" is a range, not one exact version`);
  }
}
if (pins.length === 0) refused.push(`workflows call wrangler ${calls} time(s) but no manifest under ${root} declares it`);
const versions = [...new Set(pins.map((x) => x.v))];
if (versions.length > 1) refused.push(`wrangler is pinned differently: ${pins.map((x) => `${x.p}=${x.v}`).join(', ')}`);

if (refused.length > 0) {
  console.log(`deploy-tool-pinned FAILED — ${refused.length} violation(s):`);
  for (const r of refused) console.log(`  - ${r}`);
  process.exit(1);
}
console.log(`deploy-tool-pinned OK — ${calls} wrangler command(s) over ${files.length} workflow file(s), all from the lock file; wrangler ${versions[0]} pinned in ${pins.map((x) => x.p).join(', ')}.`);
