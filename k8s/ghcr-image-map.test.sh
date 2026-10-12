#!/bin/bash
# k8s/ghcr-image-map.test.sh — cross-checks k8s/ghcr-images.env against the
# manifests and docker-compose. Fails when:
#   1. a manifest references an ai-demo-k8-* image that the map doesn't know,
#   2. a map entry's left side is referenced by no manifest,
#   3. a map entry's right side (GHCR repo) is duplicated.
# Run: bash k8s/ghcr-image-map.test.sh   (no cluster/docker needed)
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/ghcr-images.env"

fails=0
check() { echo "  FAIL $1"; fails=$((fails+1)); }

# 1. Every ai-demo-k8-* image in the manifests is covered by the map.
map_names=""
for entry in "${GHCR_IMAGE_MAP[@]}"; do map_names="$map_names ${entry%%:*} "; done
for img in $(grep -rho "ai-demo-k8-[a-z0-9-]*" "$DIR"/*.yaml | sort -u); do
  [[ "$map_names" == *" $img "* ]] || check "manifest image '$img' missing from ghcr-images.env"
done

# 2. Every map entry is referenced by some manifest.
for entry in "${GHCR_IMAGE_MAP[@]}"; do
  img="${entry%%:*}"
  grep -rq "$img" "$DIR"/*.yaml || check "map image '$img' referenced by no manifest"
done

# 3. No duplicate GHCR repos.
repos=""
for entry in "${GHCR_IMAGE_MAP[@]}"; do
  repo="${entry##*:}"
  [[ "$repos" == *" $repo "* ]] && check "duplicate GHCR repo '$repo'"
  repos="$repos $repo "
done

if ((fails)); then
  echo "ghcr-image-map: $fails failure(s)"
  exit 1
fi
echo "ghcr-image-map: passed (${#GHCR_IMAGE_MAP[@]} images)"
