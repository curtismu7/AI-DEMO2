#!/usr/bin/env bash
# Prints the EKS cluster's public JWKS URL, proven reachable, or exits non-zero.
set -euo pipefail

NAMESPACE="ping-devops-cmuir"
SA="default"

echo "Minting a short-lived token for ${NAMESPACE}/${SA} to read its issuer claim..." >&2
# This cluster enforces a 10-minute minimum TokenRequest lifetime.
TOKEN=$(kubectl create token "${SA}" -n "${NAMESPACE}" --duration=10m)

# Decode the JWT payload without verifying it; this step only discovers `iss`.
ISSUER=$(node -e '
  const token = process.argv[1];
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  process.stdout.write(payload.iss || "");
' "${TOKEN}")

if [ -z "${ISSUER}" ]; then
  echo "FAIL: could not extract an issuer (iss) claim from the minted token." >&2
  exit 1
fi
echo "Issuer: ${ISSUER}" >&2

DISCOVERY_URL="${ISSUER%/}/.well-known/openid-configuration"
JWKS_URL=$(curl -fsSL "${DISCOVERY_URL}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(d.jwks_uri || "")')

if [ -z "${JWKS_URL}" ]; then
  echo "FAIL: discovery document at ${DISCOVERY_URL} did not contain jwks_uri." >&2
  exit 1
fi

KEY_COUNT=$(curl -fsSL "${JWKS_URL}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String((d.keys||[]).length))')
if [ "${KEY_COUNT}" -lt 1 ] 2>/dev/null; then
  echo "FAIL: JWKS at ${JWKS_URL} returned zero keys." >&2
  exit 1
fi

echo "OK: JWKS at ${JWKS_URL} is public and has ${KEY_COUNT} key(s)." >&2
echo "${JWKS_URL}"
