#!/usr/bin/env bash
# scripts/ensure-mcpgw-certs.sh — wildcard mkcert pair for the MCPGW front door.
#
# Separate from ensure-dev-certs.sh on purpose: that script's cert file name is
# hardcoded in ~10 places, and adding a wildcard SAN there would force every
# developer to regenerate the core stack's cert for a profile they may never run.
#
# Usage: bash scripts/ensure-mcpgw-certs.sh
# Called by run-docker.sh only when the mcpgw profile is starting.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERTS_DIR="${ROOT}/certs"
CERT_FILE="${CERTS_DIR}/mcpgw-wildcard.pem"
KEY_FILE="${CERTS_DIR}/mcpgw-wildcard-key.pem"

# Deck-faithful naming: one frontend host per Privilege MCP Server application
# under a single gateway domain. The wildcard covers apps added later without a
# cert regen; the bare host serves /authorize and /callback.
CERT_SANS=("*.mcpgw.local.ping-devops.com" "mcpgw.local.ping-devops.com")

err() { echo "  x  $*" >&2; }
ok()  { echo "  +  $*"; }

if [[ -f "${CERT_FILE}" && -f "${KEY_FILE}" ]]; then
  ok "MCPGW wildcard certs present in certs/."
  exit 0
fi

if ! command -v mkcert >/dev/null 2>&1; then
  err "Missing ${CERT_FILE} and mkcert is not installed."
  err "Run: brew install mkcert && mkcert -install"
  err "Then: cd ${CERTS_DIR} && mkcert -cert-file mcpgw-wildcard.pem -key-file mcpgw-wildcard-key.pem '${CERT_SANS[0]}' ${CERT_SANS[1]}"
  exit 1
fi

mkdir -p "${CERTS_DIR}"
(
  cd "${CERTS_DIR}"
  mkcert -cert-file "${CERT_FILE}" -key-file "${KEY_FILE}" "${CERT_SANS[@]}"
) || {
  err "mkcert generation failed for the MCPGW wildcard pair."
  exit 1
}
ok "MCPGW wildcard certs generated in certs/."
