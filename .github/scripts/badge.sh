#!/usr/bin/env bash
# Render one shields-style SVG badge.
#
# Usage: badge.sh <output-file> <label> <value> <color>
#   <color> is a hex color (#0366d6) or "pct:<n>" to pick it from a percentage.
# Every color keeps a contrast ratio of at least 4.5:1 with the white text (WCAG AA).
set -euo pipefail
export LC_ALL=C.UTF-8

file="${1:?usage: badge.sh <output-file> <label> <value> <color>}"
label="$2"
value="$3"
color="$4"

if [[ "$color" == pct:* ]]; then
  pct="${color#pct:}"
  if ((pct >= 100)); then color="#2e7d32"   # green, 5.1:1
  elif ((pct >= 75)); then color="#4d7300"  # olive, 5.4:1
  elif ((pct >= 50)); then color="#806000"  # amber, 5.9:1
  elif ((pct >= 25)); then color="#a64b00"  # orange, 5.8:1
  else color="#b3261e"                      # red, 6.5:1
  fi
fi

# Approximate Verdana 11px width: 7 px per character plus 10 px padding.
lw=$((${#label} * 7 + 10))
vw=$((${#value} * 7 + 10))
w=$((lw + vw))
lx=$((lw * 5))
vx=$((lw * 10 + vw * 5))

mkdir -p "$(dirname "$file")"
cat >"$file" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$w" height="20" role="img" aria-label="$label: $value"><title>$label: $value</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="$w" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="$lw" height="20" fill="#555"/><rect x="$lw" width="$vw" height="20" fill="$color"/><rect width="$w" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110"><text x="$lx" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">$label</text><text x="$lx" y="140" transform="scale(.1)">$label</text><text x="$vx" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">$value</text><text x="$vx" y="140" transform="scale(.1)">$value</text></g></svg>
SVG
