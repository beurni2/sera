#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * PROOF of scripts/publish-decision.sh — the first step of every app publish.
 *
 * Drives the REAL script against a local git repository standing in for the
 * remote, with a `gh` stand-in on PATH. Bounds of the stand-in: it does not
 * model GitHub's API; it answers the two questions the script asks about
 * main's newest commit (how many green push runs; the newest finished run's
 * conclusion) from fixed values per case, fails like an unreachable API when
 * a value is unset, and records what it was asked.
 *
 * publishes main's newest — a green push run on it; a green run on an older
 *   commit while main's newest is green too; a dispatch on main, green;
 * publishes nothing (exit 0) — the finished run red; a schedule run; an
 *   older commit's run while main's newest ci is still running or red;
 * refused (exit 1) — a dispatch off main; a dispatch while main is not green;
 *   ci or main unreadable.
 * Exit 0 when every case answers as it must, 1 otherwise, 2 on set-up failure.
 */
const REPO = process.env.PROOF_REPOSITORY ?? 'beurni2/sera';
const script = resolve('scripts/publish-decision.sh');
if (!existsSync(script)) {
  console.error(`publish-decision-proof FAILED — ${script} does not exist: nothing ties a publish to a green ci on main`);
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), 'publish-decision-'));
const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`publish-decision-proof ERROR — git ${args.join(' ')}: ${r.stderr}`);
    rmSync(work, { recursive: true, force: true });
    process.exit(2);
  }
  return r.stdout.trim();
};
const remote = join(work, 'remote');
git(['init', '-q', '-b', 'main', remote]);
const ident = ['-c', 'user.name=proof', '-c', 'user.email=proof@example.invalid'];
git([...ident, 'commit', '-q', '--allow-empty', '-m', 'older'], remote);
const older = git(['rev-parse', 'HEAD'], remote);
git([...ident, 'commit', '-q', '--allow-empty', '-m', 'tip'], remote);
const tip = git(['rev-parse', 'HEAD'], remote);

const bin = join(work, 'bin');
mkdirSync(bin);
const argsLog = join(work, 'gh-args');
writeFileSync(
  join(bin, 'gh'),
  `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${argsLog}"
case "$*" in
  *status=success*)   v="\${GH_STUB_GREEN-__unset__}" ;;
  *status=completed*) v="\${GH_STUB_NEWEST-__unset__}" ;;
  *)                  v="__unset__" ;;
esac
if [ "$v" = "__unset__" ]; then echo "gh stand-in: no answer" >&2; exit 1; fi
printf '%s\\n' "$v"
`,
);
chmodSync(join(bin, 'gh'), 0o755);

const outFile = join(work, 'github-output');
const run = (ctx, answers, remoteUrl = remote) => {
  rmSync(argsLog, { force: true });
  writeFileSync(outFile, '');
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: process.env.HOME ?? work,
    GITHUB_REPOSITORY: REPO,
    GH_TOKEN: 'test-token-not-real',
    DEPLOY_REMOTE: remoteUrl,
    GITHUB_OUTPUT: outFile,
    ...ctx,
  };
  for (const [k, v] of Object.entries(answers)) env[`GH_STUB_${k}`] = v;
  const r = spawnSync('bash', [script], { encoding: 'utf8', env });
  return { ...r, output: readFileSync(outFile, 'utf8') };
};

const failures = [];
const expect = (name, r, code, publish, needle) => {
  const out = `${r.stdout}${r.stderr}`;
  const wantOut = publish ? `publish=true\nsha=${tip}\n` : 'publish=false\n';
  if (r.status !== code || r.output !== wantOut || !out.includes(needle)) {
    failures.push(`${name}: wanted exit ${code}, output ${JSON.stringify(wantOut)} and « ${needle} »; got exit ${r.status}, output ${JSON.stringify(r.output)}: ${out.trim()}`);
  } else {
    console.log(`  ok — ${name} (exit ${code}, publish=${publish})`);
  }
};

const green = { GREEN: '1', NEWEST: 'success' };
const finished = (sha, conclusion = 'success', event = 'push') =>
  ({ EVENT: 'workflow_run', RUN_SHA: sha, RUN_CONCLUSION: conclusion, RUN_EVENT: event });

const first = run(finished(tip), green);
expect("a green push run on main's newest → publishes it", first, 0, true, 'publish allowed');
const asked = existsSync(argsLog) ? readFileSync(argsLog, 'utf8') : '';
const base = `repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${tip}`;
if (!asked.includes(`${base}&event=push&branch=main&status=success`) || !asked.includes(`${base}&status=completed`)) {
  failures.push(`the ci questions were not about main's newest commit — gh was asked: ${asked.trim() || '(nothing)'}`);
} else {
  console.log("  ok — both ci questions name main's newest commit (its green push run; its newest finished run)");
}
expect("an older commit's green run, main's newest green → publishes main's newest", run(finished(older), green), 0, true, 'publish allowed');
expect("an older commit's green run, main's newest still running → nothing", run(finished(older), { GREEN: '0', NEWEST: 'none' }), 0, false, 'not green yet');
expect("an older commit's green run, main's newest red → nothing", run(finished(older), { GREEN: '1', NEWEST: 'failure' }), 0, false, 'not green yet');
expect('the finished ci run red → nothing', run(finished(tip, 'failure'), green), 0, false, 'not green');
expect('a schedule run → nothing', run(finished(tip, 'success', 'schedule'), green), 0, false, "not main's own push");
expect('a dispatch on main, green → publishes main\'s newest', run({ EVENT: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' }, green), 0, true, 'publish allowed');
expect('a dispatch off main → refused', run({ EVENT: 'workflow_dispatch', GITHUB_REF: 'refs/heads/feature' }, green), 1, false, 'runs only on main');
expect('a dispatch while main is red → refused', run({ EVENT: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' }, { GREEN: '1', NEWEST: 'failure' }), 1, false, 'not green on main');
expect('any other start → refused', run({ EVENT: 'push', GITHUB_REF: 'refs/heads/main' }, green), 1, false, 'starts only from');
expect("ci's answer unreadable → refused", run(finished(tip), { GREEN: 'x', NEWEST: 'success' }), 1, false, "could not read ci's result");
expect('main unreadable → refused', run(finished(tip), green, join(work, 'no-such-remote')), 1, false, "could not read main's newest commit");

rmSync(work, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`publish-decision-proof FAILED — ${failures.length} case(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("publish-decision-proof OK — only main's newest commit, green in ci, is ever published; every other case publishes nothing or is refused");
