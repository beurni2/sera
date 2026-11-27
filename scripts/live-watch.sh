#!/usr/bin/env bash
# DOES THE LIVE SERVICE STILL RUN MAIN?  live-watch.sh <service> <base-url> <input>...
#
# Each deploy proves the live Worker is the bundle THAT job built; nothing
# proved it built main. A stale or unmerged build with the same contracts
# version kept every check green. This asks the live Worker which commit it
# was built from (`release` on /health, stamped at bundle time) and goes red
# unless that commit and main have NO difference in what the service is built
# from (the inputs passed here: its folder, the packages it builds from, the
# lock file, the workspace manifests). A release that is not a known commit,
# or « dev » (built outside the pipeline), is red too.
#
# Prints only the service name, the canon, the two short commits and the
# verdict — never the /health body (the repository is public).
# Needs a checkout with main's history (fetch-depth: 0). WATCH_MAIN overrides
# the ref compared against (default origin/main; the proof uses a local one).
set -uo pipefail

SERVICE="${1:?service name}"
BASE="${2:-}"
shift 2 || true
[ "$#" -ge 1 ] || { echo "$SERVICE: RED — no inputs named for the comparison"; exit 1; }
MAIN_REF="${WATCH_MAIN:-origin/main}"
MAIN="$(git rev-parse --verify --quiet "${MAIN_REF}^{commit}")" || { echo "$SERVICE: RED — cannot read $MAIN_REF here"; exit 1; }
red() { echo "$SERVICE: canon=${CANON:-?} live=${LIVE_SHORT:-?} main=${MAIN:0:7} — RED: $1"; exit 1; }

[ -n "$BASE" ] || red "its address is not configured, so nobody can say what runs live"
BODY="$(mktemp)"
CODE="$(curl -sS -m 20 -o "$BODY" -w '%{http_code}' "${BASE%/}/health" 2>/dev/null)" || CODE="000"
[ "$CODE" = "200" ] || red "/health answered $CODE"
read_field() { node -e 'try { const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; process.stdout.write(typeof v === "string" ? v : ""); } catch { }' "$BODY" "$1"; }
CANON="$(read_field canon)"
# A version, or nothing: the watch never echoes free text from a live answer.
[[ "$CANON" =~ ^[0-9A-Za-z.+-]{1,32}$ ]] || CANON="?"
RELEASE="$(read_field release)"
rm -f "$BODY"
case "$RELEASE" in
  ''|dev) red "the live Worker names no release (built outside the pipeline)" ;;
esac
[[ "$RELEASE" =~ ^[0-9a-f]{7,40}$ ]] || red "the live release is not a commit"
LIVE_SHORT="${RELEASE:0:7}"
git cat-file -e "${RELEASE}^{commit}" 2>/dev/null || red "the live release is not a commit of this repository"

if git diff --quiet "$RELEASE" "$MAIN" -- "$@"; then
  echo "$SERVICE: canon=${CANON:-?} live=$LIVE_SHORT main=${MAIN:0:7} — OK: live runs main (no difference in what it is built from)"
  exit 0
fi
red "main has changed what this service is built from since the live release — a deploy is owed"
