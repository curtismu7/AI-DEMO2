#!/bin/bash
# k8s/publish.sh — publish the 20 first-party demo images to GHCR (author side).
#
# Recipients then deploy with DEPLOY_SOURCE=ghcr ./k8s/deploy.sh (or
# ./k8s/share-setup.sh for the one-command flow) and pull instead of building
# ~28 GB locally. Images are pushed as :latest and :v1.YYMMDD.
#
# Usage:
#   ./k8s/publish.sh            # scan + tag + push :latest and :v1.YYMMDD
#   ./k8s/publish.sh --dry-run  # list tag+push pairs, push nothing
#   ./run-k8.sh publish         # same, via run-k8.sh
#
# Prereqs: images already built locally (`./run-k8.sh build`), gh authed with
# write:packages on both accounts' repos (see ghcr-images.env for the split).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# shellcheck source=k8s/ghcr-images.env
source "$SCRIPT_DIR/ghcr-images.env"

GITHUB_OWNER="${GITHUB_OWNER:-$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null \
  | sed -E 's|.*github.com[:/]([^/]+)/.*|\1|' | tr '[:upper:]' '[:lower:]' || true)}"
[ -n "$GITHUB_OWNER" ] || { echo "GITHUB_OWNER not set and not detectable from git remote" >&2; exit 1; }
GITHUB_OWNER="$(echo "$GITHUB_OWNER" | tr '[:upper:]' '[:lower:]')"
REGISTRY="ghcr.io/$GITHUB_OWNER"
DATE_TAG="v1.$(date +%Y%m%d)"

command -v gh &>/dev/null     || { echo "gh CLI not found — brew install gh && gh auth login" >&2; exit 1; }
command -v docker &>/dev/null || { echo "docker not found" >&2; exit 1; }

# ── Secret-scan gate (blocking) ──────────────────────────────────────────────
# Images are built with .dockerignore excluding **/.env (defense in depth is
# the point of scanning anyway). Checks image config env +, when trivy is
# installed, a filesystem scan for baked credentials. Any hit aborts the push.
scan_image() {
  local image="$1" hits=""
  # Baked env vars: PingOne secrets, worker tokens, private keys, .env passthrough
  local env_json
  env_json="$(docker inspect --format '{{json .Config.Env}}' "$image" 2>/dev/null || echo '[]')"
  if printf '%s' "$env_json" | grep -qE 'PINGONE_(CLIENT_SECRET|WORKER|API)_?[A-Z_]*=[^x ]|PRIVATE KEY|\.env='; then
    hits="$hits baked-secret-env"
  fi
  # Trivy (optional but recommended): fail on CRITICAL/HIGH secrets findings
  if command -v trivy &>/dev/null; then
    if trivy image --scanners secret --quiet --severity CRITICAL,HIGH "$image" 2>/dev/null | grep -q "Total: [1-9]"; then
      hits="$hits trivy-secret"
    fi
  fi
  [ -z "$hits" ] || { echo "SECRET SCAN FAILED for $image:$hits" >&2; return 1; }
}

# Fail fast if any expected image is missing BEFORE scanning/pushing anything.
missing=""
for entry in "${GHCR_IMAGE_MAP[@]}"; do
  docker image inspect "${entry%%:*}:latest" &>/dev/null || missing="$missing ${entry%%:*}:latest"
done
[ -z "$missing" ] || {
  echo "Missing local image(s):$missing" >&2
  echo "Build first: ./run-k8.sh build" >&2
  exit 1
}

echo "Logging in to GHCR as $GITHUB_OWNER..."
docker logout ghcr.io >/dev/null 2>&1 || true
gh auth token | docker login ghcr.io -u "$GITHUB_OWNER" --password-stdin >/dev/null \
  || { echo "GHCR login failed — run: gh auth login" >&2; exit 1; }

echo "Scanning ${#GHCR_IMAGE_MAP[@]} images..."
for entry in "${GHCR_IMAGE_MAP[@]}"; do scan_image "${entry%%:*}:latest"; done

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY RUN — would push:"
  for entry in "${GHCR_IMAGE_MAP[@]}"; do
    echo "  ${entry%%:*}:latest → $REGISTRY/${entry##*:}(:latest, :$DATE_TAG)"
  done
  exit 0
fi

for entry in "${GHCR_IMAGE_MAP[@]}"; do
  local_name="${entry%%:*}"
  ghcr_uri="$REGISTRY/${entry##*:}"
  echo "Pushing $local_name → $ghcr_uri (:latest, :$DATE_TAG)"
  docker tag  "${local_name}:latest" "${ghcr_uri}:latest"
  docker tag  "${local_name}:latest" "${ghcr_uri}:${DATE_TAG}"
  docker push "${ghcr_uri}:latest"
  docker push "${ghcr_uri}:${DATE_TAG}"
done

echo
echo "All ${#GHCR_IMAGE_MAP[@]} images pushed ($DATE_TAG + latest)."
echo "Recipients: git clone, then ./k8s/share-setup.sh"
