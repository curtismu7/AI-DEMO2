#!/usr/bin/env bash
# install-se-kubeconfig.sh — Install Ping SE DevOps kubeconfig into ~/.kube/config
#
# Looks for a backup in (first match wins):
#   1. .local/kube/ping-se-devops-config  (repo-local copy)
#   2. ~/.kube/backups/ping-se-devops-config
#   3. ~/Downloads/config
#
# Backs up the current ~/.kube/config to ~/.kube/backups/config.before-se-install.bak

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${HOME}/.kube/backups"
TARGET="${HOME}/.kube/config"
SRC=""

for candidate in \
  "${ROOT}/.local/kube/ping-se-devops-config" \
  "${BACKUP_DIR}/ping-se-devops-config" \
  "${HOME}/Downloads/config"; do
  if [[ -f "$candidate" ]]; then
    SRC="$candidate"
    break
  fi
done

[[ -n "$SRC" ]] || {
  echo "No SE kubeconfig found. Download from Secret Server and save as:" >&2
  echo "  ${ROOT}/.local/kube/ping-se-devops-config" >&2
  echo "  https://pingidentity.delinea.app/view/vault/secrets/32608/general" >&2
  exit 1
}

mkdir -p "${BACKUP_DIR}" "${HOME}/.kube"
if [[ -f "$TARGET" ]]; then
  cp "$TARGET" "${BACKUP_DIR}/config.before-se-install.bak"
  echo "Backed up existing config → ${BACKUP_DIR}/config.before-se-install.bak"
fi

cp "$SRC" "$TARGET"
chmod 600 "$SRC" "$TARGET"
# Keep home backup in sync when installing from repo or Downloads
if [[ "$SRC" != "${BACKUP_DIR}/ping-se-devops-config" ]]; then
  cp "$SRC" "${BACKUP_DIR}/ping-se-devops-config"
  chmod 600 "${BACKUP_DIR}/ping-se-devops-config"
fi

echo "Installed SE kubeconfig from: $SRC"
echo ""
kubectl config get-contexts 2>/dev/null || true
echo ""
echo "Next:"
echo "  kubectl config use-context us"
echo "  kubens ping-devops-cmuir"
