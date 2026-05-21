#!/bin/bash
# Bump la version semver dans src/manifest.json
# Usage: ./scripts/bump-version.sh [patch|minor|major]
#        ./scripts/bump-version.sh             # patch par défaut
set -e

BUMP_TYPE="${1:-patch}"
MANIFEST="src/manifest.json"

CURRENT=$(jq -r '.version' "$MANIFEST")
IFS='.' read -r MAJ MIN PAT <<< "$CURRENT"

case "$BUMP_TYPE" in
  major) MAJ=$((MAJ+1)); MIN=0; PAT=0 ;;
  minor) MIN=$((MIN+1)); PAT=0 ;;
  patch) PAT=$((PAT+1)) ;;
  *) echo "Usage: $0 [patch|minor|major]"; exit 1 ;;
esac

NEW="$MAJ.$MIN.$PAT"
tmp=$(mktemp)
jq ".version = \"$NEW\"" "$MANIFEST" > "$tmp" && mv "$tmp" "$MANIFEST"
echo "$CURRENT → $NEW"
