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

# Ping's SE material names three files a gateway host carries:
#
#   /var/lib/procyon/config/pingone.env
#   /var/lib/procyon/ssl/mcpgw-cert.pem
#   /var/lib/procyon/ssl/mcpgw-key.pem
#
# ping-mcpgw/procyon/ is bind-mounted whole at /var/lib/procyon, so placing the pair
# under procyon/ssl/ puts them at exactly those in-container paths. Note this is NOT
# /procyon/ssl — that is the separate mcpgw-ssl volume holding the mesh identity, and
# putting the certs there instead had no effect (PR #1465, reverted by #1466).
PROCYON_SSL="${ROOT}/ping-mcpgw/procyon/ssl"

# Copy the wildcard pair into the procyon tree under the names Privilege expects.
install_into_procyon_tree() {
  mkdir -p "${PROCYON_SSL}"
  cp "${CERT_FILE}" "${PROCYON_SSL}/mcpgw-cert.pem"
  cp "${KEY_FILE}"  "${PROCYON_SSL}/mcpgw-key.pem"
  chmod 644 "${PROCYON_SSL}/mcpgw-cert.pem"
  chmod 600 "${PROCYON_SSL}/mcpgw-key.pem"
  ok "Gateway certs placed at ping-mcpgw/procyon/ssl/mcpgw-{cert,key}.pem"
}

if [[ -f "${CERT_FILE}" && -f "${KEY_FILE}" ]]; then
  ok "MCPGW wildcard certs present in certs/."
  install_into_procyon_tree
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
install_into_procyon_tree
