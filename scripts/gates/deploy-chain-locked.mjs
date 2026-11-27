#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * CI gate: deploy-chain-locked — THE RELEASE CHAIN STAYS LOCKED.
 *
 * Ported from Boutik+'s gate of the same name. The custody and logistics
 * Workers could go live from any branch before ci had run, with actions on
 * moving tags and the read token pasted into scripts; the rider app published
 * on every push while ci was still running, and from any branch; every
 * custody release rewrote the delivery key on the live Worker; nothing could
 * roll a service back; the board only ran when someone pushed. Each was fixed
 * by hand; this gate is what stops them coming back one edit at a time.
 *
 * Over every workflow file it refuses:
 *   1. a `uses:` that is not pinned to a full 40-hex commit SHA;
 *   2. any `npx` call — every tool the workflows run comes from the lockfile, except exactly `npx eas-cli@20.5.1` in expo-preview.yml (named open: that tool is in no manifest yet);
 *   3. a workflow with no top-level `permissions:` block;
 *   4. a `${{ secrets.… }}` written inside a `run:` script — a secret reaches
 *      a shell only through that step's `env:`, never pasted into its text;
 *   5. a workflow that holds CLOUDFLARE_API_TOKEN whose first `run:` step is
 *      not `bash scripts/release-guard.sh` — except an app publish (rule 7, which starts with
 *      its own decision) and the one rollback workflow (rule 8), by name;
 *      and an unnamed workflow that publishes an app (EXPO_TOKEN, a Pages
 *      upload): every publish is one of the files rule 7 names.
 * And the release rules on the files this repository names:
 *   6. SERVICE RELEASES (custody-deploy, logistics-deploy): the guard first,
 *      `environment: production` on every job, `actions: read` in the
 *      permissions (and `pull-requests: read`), never `cancel-in-progress: true`;
 *   7. APP PUBLISHES (expo-preview): started by a finished `ci` run on
 *      main (`workflow_run`, types completed, branches main) or a dispatch,
 *      never by a push; the job runs only when that run concluded success
 *      and was a push run, or when dispatched on main; first `run:` step
 *      `bash scripts/publish-decision.sh`; a concurrency group that never
 *      cancels a publish in flight;
 *   8. ROLLBACK (rollback.yml): dispatch only, on main only,
 *      `environment: production` on every job, and it never builds,
 *      bundles or uploads code — it only points the service back at a
 *      version Cloudflare already holds;
 *   9. the custody release writes the delivery key (SHOP_PROGRESS_SECRET) onto
 *      the live Worker only when the person dispatching asks for it — a
 *      boolean input, default false — never on every run;
 *  10. ci.yml re-runs the board on a daily `schedule:`, not only on a push.
 * Scanning `.github/workflows` (the default), every file rules 6–10 name must
 * exist. A fixture folder or file is scanned for what it holds.
 *
 * Usage: deploy-chain-locked.mjs [workflowsDirOrFile]   (default .github/workflows)
 */
const CONFIG = {
  "guard": "bash scripts/release-guard.sh",
  "services": [
    "custody-deploy.yml",
    "logistics-deploy.yml"
  ],
  "publishes": [
    "expo-preview.yml"
  ],
  "servicePermissions": [
    "contents",
    "actions",
    "pull-requests"
  ],
  "requireEnvironment": true,
  "npxAllowed": {
    "expo-preview.yml": [
      "npx eas-cli@20.5.1"
    ]
  },
  "keyWrite": {
    "file": "custody-deploy.yml",
    "secret": "SHOP_PROGRESS_SECRET",
    "input": "write_shop_progress_secret"
  },
  "ciSchedule": true,
  "pins": []
};

const arg = process.argv[2];
const dir = arg ?? '.github/workflows';
const repoMode = arg === undefined;
let files;
try {
  files = statSync(dir).isDirectory()
    ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(dir, f))
    : [dir];
} catch (err) {
  console.error(`deploy-chain-locked ERROR — cannot read ${dir}: ${String(err)}`);
  process.exit(2);
}
if (files.length === 0) {
  console.error(`deploy-chain-locked ERROR — no workflow file under ${dir}; refusing to pass on silence`);
  process.exit(2);
}

const refused = [];
const strip = (line) => line.replace(/(^|\s)#.*$/, '');
const indentOf = (line) => line.search(/\S/);

/** Lines of a top-level key's block (e.g. `on:`), comments stripped. */
function topBlock(lines, key) {
  const start = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (start < 0) return null;
  const out = [strip(lines[start])];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() !== '' && indentOf(l) === 0 && !l.startsWith('#')) break;
    out.push(strip(l));
  }
  return out;
}

/** The jobs: name and lines (comments stripped) of each. */
function jobsOf(lines) {
  const block = topBlock(lines, 'jobs') ?? [];
  const jobs = [];
  for (const l of block.slice(1)) {
    const m = l.match(/^ {2}([\w-]+):\s*$/);
    if (m) jobs.push({ name: m[1], lines: [] });
    else if (jobs.length > 0) jobs[jobs.length - 1].lines.push(l);
  }
  return jobs;
}

/** The steps of a job: each the lines of one `- ` item under `steps:`. */
function stepsOf(job) {
  const at = job.lines.findIndex((l) => /^\s+steps:\s*$/.test(l));
  if (at < 0) return [];
  const steps = [];
  let item = -1;
  for (const l of job.lines.slice(at + 1)) {
    if (l.trim() === '') { if (steps.length) steps[steps.length - 1].push(l); continue; }
    const ind = indentOf(l);
    if (item < 0 && /^\s*- /.test(l)) item = ind;
    if (ind < item) break;
    if (ind === item && /^\s*- /.test(l)) steps.push([l]);
    else if (steps.length) steps[steps.length - 1].push(l);
  }
  return steps;
}

const hasLine = (block, re) => (block ?? []).some((l) => re.test(l));
const has = (lines, re) => lines.some((l) => re.test(strip(l)));

for (const file of files) {
  const name = basename(file);
  const raw = readFileSync(file, 'utf8').split('\n');
  const allowedNpx = CONFIG.npxAllowed[name] ?? [];
  let hasPermissions = false;
  let runIndent = -1; // >= 0 while inside a `run: |` block
  let firstRun = null;
  let holdsDeployToken = false;
  const npxOk = (text) => {
    const calls = text.match(/(^|[\s;|&(])npx\s+\S+/g) ?? [];
    return calls.every((c) => allowedNpx.includes(c.trim().replace(/^[;|&(]/, '').trim()));
  };
  raw.forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    const code = strip(line);
    if (runIndent >= 0) {
      const indent = indentOf(line);
      if (line.trim() === '' || indent > runIndent) {
        if (/\$\{\{\s*secrets\./.test(line)) refused.push(`${at} a secret is pasted into a run: script (pass it through env:)`);
        if (!npxOk(code)) refused.push(`${at} npx in a run: script (use the lockfile's tool)`);
        return;
      }
      runIndent = -1;
    }
    if (/^permissions:/.test(line)) hasPermissions = true;
    if (/CLOUDFLARE_API_TOKEN/.test(code)) holdsDeployToken = true;
    const uses = code.match(/^\s*(?:-\s+)?uses:\s*(\S+)/);
    if (uses && !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(uses[1])) {
      refused.push(`${at} action not pinned to a commit SHA: ${uses[1]}`);
    }
    const run = code.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (run) {
      const value = run[2].trim();
      if (/^[|>][-+]?$/.test(value)) {
        runIndent = run[1].length;
        if (firstRun === null) firstRun = raw.slice(i + 1).find((l) => l.trim() !== '')?.trim() ?? '';
      } else {
        if (firstRun === null) firstRun = value;
        if (/\$\{\{\s*secrets\./.test(value)) refused.push(`${at} a secret is pasted into a run: script (pass it through env:)`);
        if (!npxOk(value)) refused.push(`${at} npx in a run: script (use the lockfile's tool)`);
      }
    }
  });
  if (!hasPermissions) refused.push(`${file} has no top-level permissions: block`);

  const isService = CONFIG.services.includes(name);
  const isPublish = CONFIG.publishes.includes(name);
  const isRollback = name === 'rollback.yml';
  const publishesApp = has(raw, /EXPO_TOKEN|actions\/deploy-pages@|pages deploy/);
  const on = topBlock(raw, 'on');
  const perms = topBlock(raw, 'permissions');
  const conc = topBlock(raw, 'concurrency');
  const jobs = jobsOf(raw);

  if (holdsDeployToken && !isPublish && !isRollback && firstRun !== CONFIG.guard) {
    refused.push(`${file} deploys but its first run: step is not \`${CONFIG.guard}\` (found: ${firstRun ?? 'none'})`);
  }
  if (publishesApp && !isPublish && !isRollback && !isService) {
    refused.push(`${file} publishes an app but is not one of the app publishes this gate knows (${CONFIG.publishes.join(', ') || 'none'})`);
  }
  if (has(raw, /cancel-in-progress:\s*true/) && (isService || isPublish || isRollback)) {
    refused.push(`${file} may cancel a release or publish in flight (cancel-in-progress: true)`);
  }

  if (isService) {
    if (firstRun !== CONFIG.guard) refused.push(`${file} is a service release whose first run: step is not \`${CONFIG.guard}\` (found: ${firstRun ?? 'none'})`);
    for (const need of CONFIG.servicePermissions) {
      if (!hasLine(perms, new RegExp(`^\\s+${need}:\\s*read\\s*$`))) refused.push(`${file} is a service release without \`${need}: read\` (its guard reads ci through the job's own token)`);
    }
    if (CONFIG.requireEnvironment) {
      for (const job of jobs) {
        if (!hasLine(job.lines, /^ {4}environment:\s*production\s*$/)) refused.push(`${file} job ${job.name} releases a service without \`environment: production\``);
      }
    }
  }

  if (isPublish) {
    if (!hasLine(on, /^ {2}workflow_run:\s*$/) || !hasLine(on, /^\s+workflows:\s*\[\s*ci\s*\]\s*$/) || !hasLine(on, /^\s+types:\s*\[\s*completed\s*\]\s*$/) || !hasLine(on, /^\s+branches:\s*\[\s*main\s*\]\s*$/)) {
      refused.push(`${file} is an app publish not started by a finished ci run on main (on: workflow_run: workflows: [ci], types: [completed], branches: [main])`);
    }
    if (hasLine(on, /^ {2}push:/)) refused.push(`${file} is an app publish started by a push, before ci has finished`);
    if (!has(raw, /github\.event\.workflow_run\.conclusion\s*==\s*'success'/)) refused.push(`${file} is an app publish that does not require the ci run to have succeeded (github.event.workflow_run.conclusion == 'success')`);
    if (!has(raw, /github\.event\.workflow_run\.event\s*==\s*'push'/)) refused.push(`${file} is an app publish that does not require main's own push run (github.event.workflow_run.event == 'push')`);
    if (!has(raw, /github\.ref\s*==\s*'refs\/heads\/main'/)) refused.push(`${file} is an app publish whose dispatch is not held to main (github.ref == 'refs/heads/main')`);
    if (firstRun !== 'bash scripts/publish-decision.sh') refused.push(`${file} is an app publish whose first run: step is not \`bash scripts/publish-decision.sh\` (found: ${firstRun ?? 'none'})`);
    if (conc === null || !hasLine(conc, /^\s+cancel-in-progress:\s*false\s*$/)) refused.push(`${file} is an app publish without a concurrency group that never cancels (cancel-in-progress: false)`);
    if (!hasLine(perms, /^\s+actions:\s*read\s*$/)) refused.push(`${file} is an app publish without \`actions: read\` (its decision reads ci through the job's own token)`);
  }

  if (isRollback) {
    if (!hasLine(on, /^ {2}workflow_dispatch:/) || hasLine(on, /^ {2}(push|pull_request|schedule|workflow_run):/)) refused.push(`${file} is the rollback and must start only by a dispatch`);
    for (const job of jobs) {
      if (!hasLine(job.lines, /^ {4}if:\s*github\.ref\s*==\s*'refs\/heads\/main'\s*$/)) refused.push(`${file} job ${job.name} can roll back from a branch (if: github.ref == 'refs/heads/main')`);
      if (CONFIG.requireEnvironment && !hasLine(job.lines, /^ {4}environment:\s*production\s*$/)) refused.push(`${file} job ${job.name} rolls back without \`environment: production\``);
    }
    if (has(raw, /pnpm build|bundle:worker|wrangler(\s+\S+)*\s+deploy\b|pages deploy|eas update|esbuild/)) refused.push(`${file} is the rollback but builds or uploads code (it may only point a service back at a version Cloudflare holds)`);
  }

  if (CONFIG.keyWrite && name === CONFIG.keyWrite.file) {
    const { secret, input } = CONFIG.keyWrite;
    const onText = (on ?? []).join('\n');
    if (!new RegExp(`\\n\\s+${input}:\\s*\\n(\\s+[^\\n]*\\n){0,6}?\\s+type:\\s*boolean`).test(`${onText}\n`) || !new RegExp(`\\n\\s+${input}:\\s*\\n(\\s+[^\\n]*\\n){0,6}?\\s+default:\\s*false`).test(`${onText}\n`)) {
      refused.push(`${file} has no dispatch input ${input} (boolean, default false) for the step that writes ${secret}`);
    }
    const guardIf = new RegExp(`^\\s+if:\\s*(\\$\\{\\{\\s*)?inputs\\.${input}(\\s*==\\s*true)?(\\s*\\}\\})?\\s*$`);
    for (const job of jobs) {
      for (const step of stepsOf(job)) {
        if (has(step, new RegExp(`secret put ${secret}\\b`)) && !step.some((l) => guardIf.test(strip(l)))) {
          refused.push(`${file} writes ${secret} onto the live Worker without the dispatcher asking for it (if: inputs.${input})`);
        }
      }
    }
  }

  if (name === 'ci.yml' && CONFIG.ciSchedule) {
    if (!hasLine(on, /^ {2}schedule:\s*$/) || !hasLine(on, /^\s+- cron:\s*'[^']+'/)) refused.push(`${file} runs the board only when someone pushes (no daily schedule:)`);
  }
}

if (repoMode) {
  const named = [...CONFIG.services, ...CONFIG.publishes, 'rollback.yml', ...(CONFIG.ciSchedule ? ['ci.yml'] : []), ...(CONFIG.keyWrite ? [CONFIG.keyWrite.file] : [])];
  for (const n of new Set(named)) {
    if (!existsSync(join(dir, n))) refused.push(`${join(dir, n)} is missing (this gate names it)`);
  }
}

const exact = /^\d+\.\d+\.\d+$/;
const wranglers = new Set();
{
  for (const [manifest, pkgName] of CONFIG.pins) {
    let spec;
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      spec = pkg.devDependencies?.[pkgName] ?? pkg.dependencies?.[pkgName];
    } catch (err) {
      console.error(`deploy-chain-locked ERROR — cannot read ${manifest}: ${String(err)}`);
      process.exit(2);
    }
    if (spec === undefined) refused.push(`${manifest} does not pin ${pkgName} (the workflows call it from the lockfile)`);
    else if (!exact.test(spec)) refused.push(`${manifest} pins ${pkgName} to a range (${spec}), not one exact version`);
    if (pkgName === 'wrangler' && spec !== undefined) wranglers.add(spec);
  }
  if (wranglers.size > 1) refused.push(`wrangler is pinned to ${wranglers.size} different versions: ${[...wranglers].join(', ')}`);
}

if (refused.length > 0) {
  console.error(`deploy-chain-locked FAILED — ${refused.length} violation(s):`);
  for (const r of refused) console.error(`  - ${r}`);
  process.exit(1);
}
console.log(`deploy-chain-locked OK — ${files.length} workflow(s): actions SHA-pinned, no npx beyond the named exact one, permissions declared, no secret in a script, every service release starts with its guard, every app publish follows a green ci on main and never cancels, the rollback only rolls back${CONFIG.keyWrite ? ', the delivery key is written only when asked' : ''}${CONFIG.ciSchedule ? ', the board runs daily' : ''}${wranglers.size ? `; wrangler ${[...wranglers][0]} pinned exactly` : ''}`);
