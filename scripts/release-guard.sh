#!/usr/bin/env bash
# THE FIRST STEP OF EVERY SERVICE RELEASE IN THIS REPOSITORY (and of the
# release of the webhook key, which guards the money route).
#
# A release used to go out from whatever was dispatched: any branch, any
# commit, whether ci had ever run on it. The provenance poll at the end of a
# deploy proves the live build is the one DISPATCHED, not that anyone checked
# it (Boutik+'s scripts/deploy-only-main.sh, whose pattern this follows).
#
# A service here goes live from the branch BEFORE the merge, so the new
# clients (which publish after the merge) never reach phones ahead of the
# Worker they need. So a release goes ahead only when ALL hold:
#   1. ci has a successful run on this exact commit;
#   2. the NEWEST finished ci run on this commit is green — a later red run
#      (a re-run, or the daily board) stops it;
#   3. the commit is main's newest commit, or the head of an open pull request
#      into main from a branch of THIS repository (a fork's head is refused).
#
# ITS LIMIT, stated so green is never read as more: a pull request's ci runs
# that branch's own ci.yml, and this step runs from the commit being released,
# so a branch that edits its own checks or this script can satisfy it. The
# founder's Approve on the `production` environment and the coordinator's
# review of the diff are the backstop for that, not this script.
#
# A refusal is not an outage: nothing was uploaded. Open the pull request (or
# merge), wait for ci to go green on the commit, then dispatch again.
#
# Reads GitHub with the job's own token only (GH_TOKEN; the job needs
# `actions: read`, `pull-requests: read`, `contents: read`), never a secret,
# and takes no input that could skip it. DEPLOY_REMOTE overrides the remote
# main is read from (the gate board's proof uses a local one).
set -euo pipefail

: "${GITHUB_SHA:?GITHUB_SHA is unset}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is unset}"
: "${GH_TOKEN:?GH_TOKEN is unset — the job needs permissions: actions: read, pull-requests: read}"
REMOTE="${DEPLOY_REMOTE:-https://github.com/${GITHUB_REPOSITORY}}"
refuse() { echo "::error title=Release refused::$1"; exit 1; }

MAIN="$(git ls-remote "$REMOTE" refs/heads/main 2>/dev/null | cut -f1)" || MAIN=""
[ -n "$MAIN" ] || refuse "could not read main's newest commit from $REMOTE — refusing rather than guessing."

RUNS="repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${GITHUB_SHA}"
GREEN="$(gh api "${RUNS}&status=success&per_page=1" --jq '.total_count' 2>/dev/null)" || GREEN=""
case "$GREEN" in
  ''|*[!0-9]*) refuse "could not read ci's result for $GITHUB_SHA (answer: '$GREEN') — refusing rather than guessing." ;;
esac
[ "$GREEN" -ge 1 ] || refuse "ci has not passed on $GITHUB_SHA. Open its pull request into main (or merge it), wait for ci to go green, then dispatch again."

NEWEST="$(gh api "${RUNS}&status=completed&per_page=1" --jq '.workflow_runs[0].conclusion // "none"' 2>/dev/null)" || NEWEST=""
[ -n "$NEWEST" ] || refuse "could not read ci's newest finished run on $GITHUB_SHA — refusing rather than guessing."
[ "$NEWEST" = "success" ] || refuse "ci's newest finished run on $GITHUB_SHA is '$NEWEST', not green. Fix it (or re-run it green), then dispatch again."

if [ "$GITHUB_SHA" = "$MAIN" ]; then
  echo "release allowed — $GITHUB_SHA is main's newest commit, and ci passed on it (newest run green)"
  exit 0
fi

HEADS="$(gh api "repos/${GITHUB_REPOSITORY}/pulls?state=open&base=main&per_page=100" --jq '.[] | "\(.head.repo.full_name) \(.head.sha)"' 2>/dev/null)" || refuse "could not read the open pull requests into main — refusing rather than guessing."
if printf '%s\n' "$HEADS" | grep -qxF "${GITHUB_REPOSITORY} ${GITHUB_SHA}"; then
  echo "release allowed — $GITHUB_SHA is the head of an open pull request into main, and ci passed on it (newest run green)"
  exit 0
fi
refuse "$GITHUB_SHA is neither main's newest commit ($MAIN) nor the head of an open pull request into main from this repository. Release the pull request's newest commit, or main's."
