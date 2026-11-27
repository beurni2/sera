#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * PROOF of scripts/release-guard.sh — the first step of every service release.
 *
 * The step itself only ever runs on GitHub. This drives the REAL script against
 * a local git repository standing in for the remote, with a `gh` stand-in on
 * PATH. Bounds of the stand-in, stated so nothing more is claimed: it does not
 * model GitHub's API; it answers the three questions the script asks (how many
 * green ci runs on this commit, the newest finished run's conclusion, the open
 * pull requests' « repository sha » lines) from fixed values per case, fails
 * like an unreachable API when a value is unset, and records what it was asked.
 *
 * allowed — main's newest commit, green; an open pull request's head from this
 *           repository, green;
 * refused — no green run; the newest finished run red (an older one green);
 *           a commit that is neither main's newest nor an open PR's head; a
 *           fork's PR head; ci, the newest run, the PR list or main unreadable.
 * Exit 0 when every case answers as it must, 1 otherwise, 2 when the proof
 * could not set itself up.
 */
const REPO = process.env.PROOF_REPOSITORY ?? 'beurni2/sera';
const script = resolve('scripts/release-guard.sh');
if (!existsSync(script)) {
  console.error(`release-guard-proof FAILED — ${script} does not exist: nothing stops a release from any commit`);
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), 'release-guard-'));
const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`release-guard-proof ERROR — git ${args.join(' ')}: ${r.stderr}`);
    rmSync(work, { recursive: true, force: true });
    process.exit(2);
  }
  return r.stdout.trim();
};

const remote = join(work, 'remote');
git(['init', '-q', '-b', 'main', remote]);
const ident = ['-c', 'user.name=proof', '-c', 'user.email=proof@example.invalid'];
git([...ident, 'commit', '-q', '--allow-empty', '-m', 'tip'], remote);
const tip = git(['rev-parse', 'HEAD'], remote);
git(['checkout', '-q', '-b', 'feature'], remote);
git([...ident, 'commit', '-q', '--allow-empty', '-m', 'pull request head'], remote);
const prHead = git(['rev-parse', 'HEAD'], remote);
git([...ident, 'commit', '-q', '--allow-empty', '-m', 'unshared'], remote);
const stray = git(['rev-parse', 'HEAD'], remote);
git(['checkout', '-q', 'main'], remote);

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
  *pulls*)            v="\${GH_STUB_PRS-__unset__}" ;;
  *)                  v="__unset__" ;;
esac
if [ "$v" = "__unset__" ]; then echo "gh stand-in: no answer" >&2; exit 1; fi
printf '%s\\n' "$v"
`,
);
chmodSync(join(bin, 'gh'), 0o755);

const run = (sha, answers, remoteUrl = remote) => {
  rmSync(argsLog, { force: true });
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: process.env.HOME ?? work,
    GITHUB_SHA: sha,
    GITHUB_REPOSITORY: REPO,
    GH_TOKEN: 'test-token-not-real',
    DEPLOY_REMOTE: remoteUrl,
  };
  for (const [k, v] of Object.entries(answers)) env[`GH_STUB_${k}`] = v;
  return spawnSync('bash', [script], { encoding: 'utf8', env });
};

const failures = [];
const expect = (name, r, code, needle) => {
  const out = `${r.stdout}${r.stderr}`;
  if (r.status !== code || !out.includes(needle)) {
    failures.push(`${name}: wanted exit ${code} with « ${needle} », got exit ${r.status}: ${out.trim()}`);
  } else {
    console.log(`  ok — ${name} (exit ${code})`);
  }
};

const green = { GREEN: '1', NEWEST: 'success' };
const prs = (...lines) => lines.join('\n');

const allowed = run(tip, green);
expect("main's newest commit, ci green → allowed", allowed, 0, "main's newest commit");
const asked = existsSync(argsLog) ? readFileSync(argsLog, 'utf8') : '';
const base = `repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${tip}`;
if (!asked.includes(`${base}&status=success`) || !asked.includes(`${base}&status=completed`)) {
  failures.push(`the ci questions were not about this commit's ci runs — gh was asked: ${asked.trim() || '(nothing)'}`);
} else {
  console.log('  ok — both ci questions name this commit and the ci workflow (successful runs; newest finished run)');
}

expect("an open PR's head from this repository, ci green → allowed",
  run(prHead, { ...green, PRS: prs(`someone/fork ${stray}`, `${REPO} ${prHead}`) }), 0, 'head of an open pull request');
expect('no green ci run on the commit → refused', run(tip, { GREEN: '0', NEWEST: 'failure' }), 1, 'ci has not passed');
expect('newest finished ci run red, an older one green → refused', run(tip, { GREEN: '1', NEWEST: 'failure' }), 1, "newest finished run on");
expect('newest finished ci run cancelled → refused', run(prHead, { GREEN: '1', NEWEST: 'cancelled', PRS: prs(`${REPO} ${prHead}`) }), 1, "newest finished run on");
expect("a commit that is neither main's newest nor an open PR's head → refused",
  run(stray, { ...green, PRS: prs(`${REPO} ${prHead}`) }), 1, 'neither main');
expect("a fork's PR head → refused", run(stray, { ...green, PRS: prs(`someone/fork ${stray}`) }), 1, 'neither main');
expect("ci's answer unreadable → refused", run(tip, { GREEN: 'not-a-number', NEWEST: 'success' }), 1, "could not read ci's result");
expect("the newest run unreadable → refused", run(tip, { GREEN: '1' }), 1, "could not read ci's newest");
expect('the open pull requests unreadable → refused', run(prHead, green), 1, 'could not read the open pull requests');
expect('main unreadable → refused', run(tip, green, join(work, 'no-such-remote')), 1, "could not read main's newest commit");

rmSync(work, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`release-guard-proof FAILED — ${failures.length} case(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("release-guard-proof OK — only a green commit that is main's newest or an open pull request's head is allowed; every other case is refused");
