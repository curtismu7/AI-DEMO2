#!/usr/bin/env bash
# scripts/ensure-pinggateway-tls-cert.sh — server keystore for PingGateway's
# HTTPS listener.
#
# WHY THIS EXISTS
#
# PingGateway advertises its RFC 9728 protected-resource metadata URL by
# deriving it from PG_GATEWAY_RESOURCE_ID, which is also the token audience the
# whole chain binds to:
#
#     PG_GATEWAY_RESOURCE_ID=https://api.ping.demo:3036/mcp
#
# That value cannot change — p1az-decision.groovy checks it as `aud`. So the
# fix is to make the advertisement TRUE: port 3036 must actually serve HTTPS,
# so a client following the WWW-Authenticate challenge can fetch
# https://api.ping.demo:3036/.well-known/oauth-protected-resource/mcp instead
# of failing the TLS handshake against a plaintext listener.
#
# This generates:
#   certs/pg-tls/pg-server.p12   PKCS#12 keystore mounted into ping-gateway
#
# built from the mkcert pair bootstrap already writes (certs/api.ping.demo+2*),
# whose SANs include api.ping.demo and localhost — the two names anything
# reaches this listener by. certs/ is gitignored, so nothing here is committed.
#
# Idempotent: re-run is a no-op unless the source cert is newer than the p12.
#
# Usage: bash scripts/ensure-pinggateway-tls-cert.sh

set -euo pipefail

BASEDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS="${BASEDIR}/certs"
SRC_CRT="${CERTS}/api.ping.demo+2.pem"
SRC_KEY="${CERTS}/api.ping.demo+2-key.pem"
OUT_DIR="${CERTS}/pg-tls"
OUT_P12="${OUT_DIR}/pg-server.p12"

# Must match PG_TLS_KEYSTORE_PASSWORD in docker-compose.yml. Dev-only material
# for a gitignored local keystore — the private key never leaves the host.
PASS="${PG_TLS_KEYSTORE_PASSWORD:-changeit}"
ALIAS="api.ping.demo"

if [[ ! -f "$SRC_CRT" || ! -f "$SRC_KEY" ]]; then
  echo "[pg-tls] missing ${SRC_CRT##*/} — run the bootstrap (mkcert) first; skipping." >&2
  exit 0
fi

# Rebuild only when the source cert is newer, so a stack start does not churn
# the keystore (and force an IG restart) on every invocation.
if [[ -f "$OUT_P12" && "$OUT_P12" -nt "$SRC_CRT" ]]; then
  echo "[pg-tls] ${OUT_P12#"$BASEDIR"/} up to date"
  exit 0
fi

mkdir -p "$OUT_DIR"
openssl pkcs12 -export \
  -in "$SRC_CRT" \
  -inkey "$SRC_KEY" \
  -name "$ALIAS" \
  -out "$OUT_P12" \
  -passout "pass:${PASS}"
chmod 600 "$OUT_P12"

echo "[pg-tls] wrote ${OUT_P12#"$BASEDIR"/} (alias ${ALIAS})"
