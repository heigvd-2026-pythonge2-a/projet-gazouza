#!/usr/bin/env bash
# Generate SVG badges for milestone progress and open issues.
#
# Usage: milestone-badges.sh <output-dir>
# Needs `gh` authenticated (GH_TOKEN in CI) and `jq`. Run from inside the repository.
# Progress is closed / (open + closed), the same figure as GitHub's milestone page.
set -euo pipefail

out="${1:?usage: milestone-badges.sh <output-dir>}"
here="$(cd "$(dirname "$0")" && pwd)"

# One badge per milestone, named after its number: milestone-1.svg, milestone-2.svg, ...
gh api --paginate "repos/{owner}/{repo}/milestones?state=all" \
  --jq '.[] | [.number, .title, .open_issues, .closed_issues] | @tsv' |
  while IFS=$'\t' read -r number title open closed; do
    total=$((open + closed))
    pct=0
    ((total > 0)) && pct=$((closed * 100 / total))
    # "S1-2 : Fondations" -> "S1-2"
    label="${title%% :*}"
    bash "$here/badge.sh" "$out/milestone-$number.svg" "$label" "$pct % ($closed/$total)" "pct:$pct"
  done

open_issues=$(gh issue list --state open --limit 1000 --json number --jq length)
bash "$here/badge.sh" "$out/issues.svg" "issues ouvertes" "$open_issues" "#0366d6"

ls "$out"
