#!/usr/bin/env bash
# Copy the SVG files of a directory onto the `badges` branch and push, keeping the
# badges written by other workflows (milestones, coverage).
#
# Usage: publish-badges.sh <dir-with-svgs>
# Needs GH_TOKEN and GITHUB_REPOSITORY (both set in GitHub Actions).
set -euo pipefail

src="$(cd "${1:?usage: publish-badges.sh <dir-with-svgs>}" && pwd)"
url="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
work="$(mktemp -d)"
cd "$work"

git init -q -b badges
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git remote add origin "$url"
# Start from the current branch if it exists, otherwise from an empty history.
if git fetch -q --depth 1 origin badges; then
  git reset -q --hard FETCH_HEAD
fi

cp "$src"/*.svg .
git add -A
if git diff --cached --quiet; then
  echo "Badges unchanged."
  exit 0
fi
git commit -q -m "chore: update badges"

# Another workflow may push at the same time; each one writes its own files, so a
# rebase never conflicts.
for attempt in 1 2 3 4 5; do
  if git push -q origin badges; then
    echo "Badges pushed."
    exit 0
  fi
  echo "Push rejected (attempt $attempt), rebasing."
  sleep $((attempt * 2))
  git fetch -q origin badges
  git rebase -q FETCH_HEAD
done
echo "Could not push the badges." >&2
exit 1
