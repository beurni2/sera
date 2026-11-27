#!/usr/bin/env bash
# THE FIRST STEP OF EVERY APP PUBLISH IN THIS REPOSITORY.
#
# The apps used to publish to real phones (and the buyer site to real buyers)
# on every push to main, while ci was still running on that commit — and,
# for some, from any branch by a dispatch. A publish now follows ci instead:
# it starts when a ci run finishes on main, and ships only main's newest
# commit, only when ci is green on it.
#
# What this decides, and why each rule:
#   · started by a ci run (workflow_run): that run must have SUCCEEDED and
#     have been started by a PUSH to main. A schedule re-run, or a red run,
#     publishes nothing.
#   · the commit published is always main's newest. When the finished run is
#     about an older commit (main moved while it ran), main's newest is
#     published instead — but only if its own newest finished ci run is
#     green AND a push run on it is green. If its ci is still running or red,
#     nothing is published now: its own run, when it finishes green, starts
#     the publish. (GitHub keeps one pending run per concurrency group and
#     cancels the older pending one, so « skip when not newest » alone could
#     lose the newest publish.)
#   · started by hand (workflow_dispatch): only on main, and the same green
#     check on main's newest — refused loudly otherwise, since a person is
#     watching.
#
# Writes `publish=true|false` and `sha=<commit>` to $GITHUB_OUTPUT; later
# steps check out that commit and run only when publish is true. Reads GitHub
# with the job's own token (GH_TOKEN, `actions: read`), never a secret.
# DEPLOY_REMOTE overrides the remote main is read from (the proof's local one).
set -euo pipefail

: "${EVENT:?EVENT is unset (github.event_name)}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is unset}"
: "${GH_TOKEN:?GH_TOKEN is unset — the job needs permissions: actions: read}"
REMOTE="${DEPLOY_REMOTE:-https://github.com/${GITHUB_REPOSITORY}}"
OUT="${GITHUB_OUTPUT:-/dev/null}"
refuse() { echo "::error title=Publish refused::$1"; echo "publish=false" >> "$OUT"; exit 1; }
skip() { echo "::notice title=Nothing published::$1"; echo "publish=false" >> "$OUT"; exit 0; }

MAIN="$(git ls-remote "$REMOTE" refs/heads/main 2>/dev/null | cut -f1)" || MAIN=""
[ -n "$MAIN" ] || refuse "could not read main's newest commit from $REMOTE — refusing rather than guessing."

case "$EVENT" in
  workflow_run)
    [ "${RUN_CONCLUSION:-}" = "success" ] || skip "the ci run that started this ended '${RUN_CONCLUSION:-?}', not green."
    [ "${RUN_EVENT:-}" = "push" ] || skip "the ci run that started this was a '${RUN_EVENT:-?}' run, not main's own push."
    if [ "${RUN_SHA:-}" != "$MAIN" ]; then
      echo "ci finished on ${RUN_SHA:-?}, but main's newest is $MAIN — that is the only commit that may ship."
    fi
    ;;
  workflow_dispatch)
    [ "${GITHUB_REF:-}" = "refs/heads/main" ] || refuse "a publish runs only on main; this dispatch is on '${GITHUB_REF:-?}'."
    ;;
  *)
    refuse "this publish starts only from a finished ci run or a dispatch on main, not '$EVENT'."
    ;;
esac

RUNS="repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${MAIN}"
PUSHED="$(gh api "${RUNS}&event=push&branch=main&status=success&per_page=1" --jq '.total_count' 2>/dev/null)" || PUSHED=""
case "$PUSHED" in
  ''|*[!0-9]*) refuse "could not read ci's result for $MAIN (answer: '$PUSHED') — refusing rather than guessing." ;;
esac
NEWEST="$(gh api "${RUNS}&status=completed&per_page=1" --jq '.workflow_runs[0].conclusion // "none"' 2>/dev/null)" || NEWEST=""
[ -n "$NEWEST" ] || refuse "could not read ci's newest finished run on $MAIN — refusing rather than guessing."

if [ "$PUSHED" -lt 1 ] || [ "$NEWEST" != "success" ]; then
  if [ "$EVENT" = "workflow_dispatch" ]; then
    refuse "ci is not green on main's newest commit $MAIN (push run green: $PUSHED, newest finished run: $NEWEST). Wait for it, then dispatch again."
  fi
  skip "ci is not green yet on main's newest commit $MAIN (push run green: $PUSHED, newest finished run: $NEWEST); its own green run will publish it."
fi

echo "publish=true" >> "$OUT"
echo "sha=$MAIN" >> "$OUT"
echo "publish allowed — $MAIN is main's newest commit and ci is green on it"
