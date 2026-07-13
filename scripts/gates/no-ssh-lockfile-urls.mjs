#!/usr/bin/env node
import { runScanGate } from './scan.mjs';

/**
 * CI gate: no-ssh-lockfile-urls (CTO-assigned GREEN slice, 2026-07-13).
 *
 * The @platform/* deps are git dependencies pinned as `git+https://github.com/…`
 * URLs (pnpm-workspace.yaml overrides). pnpm can rewrite a git dep's URL into the
 * ssh (scp) form `git@github.com:…` or `ssh://git@…`; that form needs an ssh key
 * CI does not have, so the frozen install fails to authenticate. The ci.yml
 * `insteadOf` rewrites exist to undo exactly this mangling — but a lockfile that
 * already carries the ssh form is a latent CI break. The lawful form is
 * `git+https://…`.
 *
 * This gate reads the ROOT lockfile and FAILS if any ssh-form git remote appears
 * — the same "must be 0" the WO-6.6 merge-time check counted, now permanent.
 *
 * Scope: the ROOT lockfile only. The ci.yml `insteadOf "git@github.com:…"` lines
 * are lawful and live in the workflow, not the lockfile, so they are never
 * scanned. scripts/ (this file spells the banned form) and gates/fixtures/ (the
 * negative fixture) sit outside the scan by design; the fixture is reached only
 * through the explicit CLI-root run.
 */
runScanGate({
  gateName: 'no-ssh-lockfile-urls',
  invariant: 'the lockfile carries only https git URLs — an ssh/scp form breaks the frozen CI install',
  patterns: [
    { name: 'scp-form ssh git remote', regex: /git@github\.com:/ },
    { name: 'ssh:// git remote', regex: /ssh:\/\/git@/ },
  ],
  defaultRoots: ['pnpm-lock.yaml'],
  scanExtensions: /\.ya?ml$/,
});
