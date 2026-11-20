#!/usr/bin/env bash
# Generate SVG badges for milestone progress and open issues.
#
# Usage: milestone-badges.sh <output-dir>
# Needs `gh` authenticated (GH_TOKEN in CI) and `jq`. Run from inside the repository.
# Progress is closed / (open + closed), the same figure as GitHub's milestone page.
set -euo pipefail
export LC_ALL=C.UTF-8

out="${1:?usage: milestone-badges.sh <output-dir>}"
mkdir -p "$out"

# badge <file> <label> <value> <color>
badge() {
  local file="$1" label="$2" value="$3" color="$4"
  # Approximate Verdana 11px width: 7 px per character plus 10 px padding.
  local lw=$((${#label} * 7 + 10)) vw=$((${#value} * 7 + 10))
  local w=$((lw + vw)) lx=$((lw * 5)) vx=$((lw * 10 + vw * 5))
  cat >"$out/$file" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$w" height="20" role="img" aria-label="$label: $value"><title>$label: $value</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="$w" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="$lw" height="20" fill="#555"/><rect x="$lw" width="$vw" height="20" fill="$color"/><rect width="$w" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110"><text x="$lx" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">$label</text><text x="$lx" y="140" transform="scale(.1)">$label</text><text x="$vx" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">$value</text><text x="$vx" y="140" transform="scale(.1)">$value</text></g></svg>
SVG
}

color_for() {
  local pct="$1"
  if ((pct >= 100)); then echo "#4c1"
  elif ((pct >= 75)); then echo "#97ca00"
  elif ((pct >= 50)); then echo "#a4a61d"
  elif ((pct >= 25)); then echo "#dfb317"
  else echo "#fe7d37"
  fi
}

# One badge per milestone, named after its number: milestone-1.svg, milestone-2.svg, ...
gh api --paginate "repos/{owner}/{repo}/milestones?state=all" \
  --jq '.[] | [.number, .title, .open_issues, .closed_issues] | @tsv' |
  while IFS=$'\t' read -r number title open closed; do
    total=$((open + closed))
    pct=0
    ((total > 0)) && pct=$((closed * 100 / total))
    # "S1-2 : Fondations" -> "S1-2"
    label="${title%% :*}"
    badge "milestone-$number.svg" "$label" "$pct % ($closed/$total)" "$(color_for "$pct")"
  done

open_issues=$(gh issue list --state open --limit 1000 --json number --jq length)
badge "issues.svg" "issues ouvertes" "$open_issues" "#007ec6"

ls "$out"
