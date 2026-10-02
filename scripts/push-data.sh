#!/usr/bin/env bash
# Commit data changes and push them, rebasing onto whatever landed meanwhile (another
# data job, or a code push). README.md is generated from data/, so it's never merged:
# after the rebase it's rebuilt from the combined data. A conflict in any other file
# aborts that attempt and retries.
#
# Usage: scripts/push-data.sh "<commit message>" <paths...>
set -euo pipefail
message=$1
shift

for path in "$@"; do if [ -e "$path" ]; then git add "$path"; fi; done
if git diff --cached --quiet; then echo "No changes"; exit 0; fi
git config user.name "freetier-radar-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git commit -q -m "$message"

for attempt in 1 2 3; do
  if ! git pull --rebase --quiet; then
    conflicts=$(git diff --name-only --diff-filter=U)
    if [ "$conflicts" = "README.md" ]; then
      # Take the incoming README, then rebuild it below from the merged data.
      git checkout --ours README.md
      git add README.md
      GIT_EDITOR=true git rebase --continue || { git rebase --abort; sleep $((attempt * 10)); continue; }
    else
      echo "Conflict outside README.md: $conflicts"
      git rebase --abort
      sleep $((attempt * 10))
      continue
    fi
  fi
  if [ -f README.md ]; then
    npm run --silent readme
    if ! git diff --quiet README.md; then git add README.md; git commit -q --amend --no-edit; fi
  fi
  if git push; then exit 0; fi
  sleep $((attempt * 10))
done
exit 1
