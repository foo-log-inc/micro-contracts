#!/usr/bin/env bash
# Audit every dependency graph the repository tracks.
#
# The root lockfile is audited as installed; the rest are read from disk, since a tooling or
# example tree is not worth an install to look at. `git ls-files` keeps the set in step with the
# repository — a hand-written list goes stale the day someone adds a lockfile, which is exactly
# how these trees went unaudited in the first place.
#
# Every lockfile is audited before the exit code is decided, so one failing tree does not hide
# the state of the others.
set -uo pipefail

LEVEL=moderate

status=0
echo "== . =="
npm audit --audit-level="$LEVEL" || status=1
for lock in $(git ls-files '*/package-lock.json'); do
  dir=$(dirname "$lock")
  echo "== $dir =="
  ( cd "$dir" && npm audit --package-lock-only --audit-level="$LEVEL" ) || status=1
done
exit $status
