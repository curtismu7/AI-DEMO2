#!/bin/bash
# k8s/share-setup.sh — one-command setup for a recipient Mac.
#
# Recipient needs: OrbStack with Kubernetes enabled, Homebrew, a GitHub account
# with read access to the GHCR packages, and PingOne worker credentials (the
# bootstrap prompts for them, or export PINGONE_* / pre-fill demo_api_server/.env).
#
#   git clone <repo> && cd AI-DEMO2
#   ./k8s/share-setup.sh
#
# What it does: brew-installs kubectl + node if missing → verifies the cluster →
# runs the PingOne bootstrap → creates cluster Secrets → deploys from GHCR
# images (no ~28 GB local build) → seeds LLM models in-cluster → runs smoke checks.
#
# Skip the Procyon node sensor (needs a registered Privilege NHI): it is
# disabled by default here; export PROCYON_NODESENSOR_ENABLED=1 to keep it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
die()  { printf '\033[0;31m[ERROR]\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\033[0;34m==>\033[0m %s\n' "$1"; }

bold "AI-DEMO2 recipient setup"

# 1. CLI tools
step "Checking CLI tools (kubectl, node)..."
for tool in kubectl node; do
  if ! command -v "$tool" &>/dev/null; then
    command -v brew &>/dev/null || die "$tool missing and Homebrew not installed — install from https://brew.sh first"
    step "  brew install $tool"
    brew install "$tool"
  fi
done

# 2. Cluster reachable
step "Verifying OrbStack Kubernetes..."
command -v docker &>/dev/null || die "docker not found — install OrbStack (https://orbstack.dev) and enable Kubernetes in settings"
kubectl config current-context 2>/dev/null | grep -q orbstack \
  || die "kubectl context is not 'orbstack' — enable Kubernetes in OrbStack settings, then: kubectl config use-context orbstack"
kubectl cluster-info &>/dev/null || die "Cannot reach the Kubernetes cluster — enable Kubernetes in OrbStack settings"

# 3. GHCR access — packages are private (Ping EMU policy)
step "Verifying GHCR access..."
command -v gh &>/dev/null || { brew install gh; }
gh auth status &>/dev/null || die "Not authenticated to GitHub — run: gh auth login (needs read:packages scope)"
GITHUB_OWNER="${GITHUB_OWNER:-$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null \
  | sed -E 's|.*github.com[:/]([^/]+)/.*|\1|' | tr '[:upper:]' '[:lower:]' || true)}"
[ -n "$GITHUB_OWNER" ] || die "GITHUB_OWNER not set and not detectable from git remote"

# 4. PingOne bootstrap (prompts for worker creds if no .env yet)
if [ ! -f "$REPO_ROOT/demo_api_server/.env" ]; then
  step "Running PingOne bootstrap (prompts for worker credentials)..."
  ( cd "$REPO_ROOT/demo_api_server" && npm install --no-audit --no-fund && npm run pingone:bootstrap )
else
  step "demo_api_server/.env exists — skipping bootstrap"
fi
[ -f "$REPO_ROOT/demo_api_server/.env" ] || die "Bootstrap did not produce demo_api_server/.env"

# 5. Secrets + GHCR deploy + port-forwards
step "Creating cluster Secrets from .env..."
K8S_NAMESPACE=ai-demo PROCYON_NODESENSOR_ENABLED="${PROCYON_NODESENSOR_ENABLED:-0}" \
  bash "$SCRIPT_DIR/create-secrets.sh"

step "Deploying from GHCR images (pulls ~28 GB once; no local build)..."
DEPLOY_SOURCE=ghcr PROCYON_NODESENSOR_ENABLED="${PROCYON_NODESENSOR_ENABLED:-0}" \
  bash "$SCRIPT_DIR/deploy.sh"

step "Starting port-forwards (keep this terminal open, or use: ./k8s/deploy.sh forward-bg)..."
bash "$SCRIPT_DIR/deploy.sh" forward-bg || true

# 6. Smoke checks
step "Running smoke checks..."
bash "$SCRIPT_DIR/smoke.sh" || true

bold "Done."
echo "  UI:            https://local.ping-devops.com:4000"
echo "  BFF health:    https://api.ping.demo:3001/api/health"
echo "  Stop:          ./k8s/deploy.sh stop"
echo "  Port-forwards: ./k8s/deploy.sh forward   (restart if you rebooted)"
