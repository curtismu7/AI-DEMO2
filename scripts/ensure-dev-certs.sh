#!/usr/bin/env bash
# scripts/ensure-dev-certs.sh — guarantee mkcert TLS files exist under ./certs
#
# Used by run-docker.sh before UI/BFF bind mounts. Prevents the silent failure
# mode where Docker mounts an empty certs/ dir and Vite serves HTTP-only on :4000
# while browsers expect https://api.ping.demo:4000.
#
# Usage: bash scripts/ensure-dev-certs.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERTS_DIR="${ROOT}/certs"
CERT_FILE="${CERTS_DIR}/api.ping.demo+2.pem"
KEY_FILE="${CERTS_DIR}/api.ping.demo+2-key.pem"

warn() { echo "  !  $*" >&2; }
err()  { echo "  x  $*" >&2; }
ok()   { echo "  +  $*"; }

# Broken symlink (e.g. worktree removed while certs/ still pointed at it).
if [[ -L "${CERTS_DIR}" && ! -e "${CERTS_DIR}" ]]; then
  warn "Broken certs symlink — removing."
  rm "${CERTS_DIR}"
fi

if [[ -f "${CERT_FILE}" && -f "${KEY_FILE}" ]]; then
  ok "TLS certs present in certs/."
  exit 0
fi

# Another git worktree may already have generated certs — copy before mkcert.
if git -C "${ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
  while IFS= read -r wt; do
    [[ -z "${wt}" || "${wt}" == "${ROOT}" ]] && continue
    local src_cert="${wt}/certs/api.ping.demo+2.pem"
    local src_key="${wt}/certs/api.ping.demo+2-key.pem"
    if [[ -f "${src_cert}" && -f "${src_key}" ]]; then
      warn "TLS certs missing here — copying from ${wt}/certs/"
      mkdir -p "${CERTS_DIR}"
      cp "${src_cert}" "${src_key}" "${CERTS_DIR}/"
      [[ -f "${wt}/certs/rootCA.pem" ]] && cp "${wt}/certs/rootCA.pem" "${CERTS_DIR}/" 2>/dev/null || true
      ok "TLS certs restored in certs/."
      exit 0
    fi
  done < <(git -C "${ROOT}" worktree list 2>/dev/null | awk '/^worktree / {print $2}')
fi

if ! command -v mkcert >/dev/null 2>&1; then
  err "Missing ${CERT_FILE} and mkcert is not installed."
  err "Run: brew install mkcert && mkcert -install"
  err "Then: cd certs && mkcert api.ping.demo localhost 127.0.0.1"
  err "Or start the stack via ./run-docker.sh (not raw docker compose) so this check runs."
  exit 1
fi

warn "TLS certs missing — generating with mkcert..."
mkdir -p "${CERTS_DIR}"
ca_root="$(mkcert -CAROOT 2>/dev/null)" || ca_root=""
if [[ -n "${ca_root}" && -f "${ca_root}/rootCA.pem" && ! -f "${CERTS_DIR}/rootCA.pem" ]]; then
  cp "${ca_root}/rootCA.pem" "${CERTS_DIR}/rootCA.pem"
fi
(
  cd "${CERTS_DIR}"
  mkcert api.ping.demo localhost 127.0.0.1
) || {
  err "mkcert cert generation failed — run: cd ${CERTS_DIR} && mkcert api.ping.demo localhost 127.0.0.1"
  exit 1
}
ok "TLS certs generated in certs/."
