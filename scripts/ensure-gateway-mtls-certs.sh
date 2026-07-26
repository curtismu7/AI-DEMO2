#!/usr/bin/env bash
# scripts/ensure-gateway-mtls-certs.sh — client cert material for the
# PingGateway → MCP server mTLS hop.
#
# WHAT THIS IS FOR
#
# demo_mcp_server already implements the server half: with MCP_MTLS_ENABLED=true
# it serves HTTPS (self-signed server cert, regenerated every start) and pins the
# gateway's client cert by SHA-256 fingerprint (src/auth/mtlsMiddleware.ts).
# What was missing is the client half — PingGateway had no cert to present.
#
# This generates:
#   certs/gw-mtls/gw-client.key   private key            (never leaves the host)
#   certs/gw-mtls/gw-client.crt   public cert            (mounted into mcp-server to pin)
#   certs/gw-mtls/gw-client.p12   PKCS#12 keystore       (mounted into ping-gateway)
#
# certs/ is gitignored, so none of this is ever committed.
#
# Idempotent: regenerates only when a file is missing or the cert has expired.
# Pass --force to rotate deliberately. NOTE: rotating means recreating BOTH
# containers — mcp-server pins the fingerprint at startup, so a new cert without
# a mcp-server restart makes every gateway call fail the pin check.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/certs/gw-mtls"
KEY="${OUT_DIR}/gw-client.key"
CRT="${OUT_DIR}/gw-client.crt"
P12="${OUT_DIR}/gw-client.p12"
# Only protects a local dev keystore that never leaves the host; the Groovy reads
# it from the same env var so the two cannot drift.
P12_PASS="${PG_MTLS_KEYSTORE_PASSWORD:-changeit}"
# Must match what mtlsMiddleware logs as the expected subject.
SUBJ="/CN=banking-mcp-gateway/O=AI-DEMO2/OU=ping-gateway"
DAYS=825

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

command -v openssl >/dev/null 2>&1 || {
  echo "[gw-mtls] openssl not found — cannot generate client cert material" >&2
  exit 1
}

needs_regen() {
  [[ "${FORCE}" -eq 1 ]] && return 0
  [[ -f "${KEY}" && -f "${CRT}" && -f "${P12}" ]] || return 0
  # -checkend 0 fails once the cert is past notAfter.
  openssl x509 -in "${CRT}" -noout -checkend 0 >/dev/null 2>&1 || return 0
  return 1
}

if needs_regen; then
  mkdir -p "${OUT_DIR}"
  echo "[gw-mtls] generating client cert material in ${OUT_DIR}"
  openssl req -x509 -newkey rsa:2048 -sha256 -days "${DAYS}" -nodes \
    -keyout "${KEY}" -out "${CRT}" -subj "${SUBJ}" >/dev/null 2>&1
  # PKCS#12 is what the JVM keystore loader in the Groovy expects.
  openssl pkcs12 -export -inkey "${KEY}" -in "${CRT}" \
    -name gw-client -out "${P12}" -passout "pass:${P12_PASS}" >/dev/null 2>&1
  chmod 600 "${KEY}" "${P12}"
  echo "[gw-mtls] created gw-client.{key,crt,p12}"
else
  echo "[gw-mtls] client cert material already present and unexpired — nothing to do"
fi

FP="$(openssl x509 -in "${CRT}" -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//')"
echo "[gw-mtls] subject     : ${SUBJ}"
echo "[gw-mtls] sha256      : ${FP}"
echo "[gw-mtls] expires     : $(openssl x509 -in "${CRT}" -noout -enddate | sed 's/notAfter=//')"
echo "[gw-mtls] mcp-server pins this cert via MCP_MTLS_GATEWAY_CERT_PATH=/certs/gw-mtls/gw-client.crt"
