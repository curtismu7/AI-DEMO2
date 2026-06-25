#!/usr/bin/env bash
#
# post-deploy-smoke.sh — auth-free post-deploy gate for the AI-Demo k8s stack.
#
# Catches the class of break that unit tests cannot: cross-service config drift
# and the runtime token-chain failures it produces. Specifically it would have
# caught the mcpgateway-vs-mcpserver audience drift that 401'd every agent tool
# call ("aud validation failed" / "Invalid or expired token").
#
# Checks (any failure → exit 1, loud):
#   1. every ai-demo pod is Ready
#   2. the live configmap aud invariant: the MCP server validates the SAME
#      audience the gateway forwards (forward-unchanged contract)
#   3. recent gateway + mcp-server logs are free of known chain-break signatures
#
# A full authenticated chip→tool chain still needs a PingOne session — run the
# real-API pipeline suite for that (tests/real/shared/all-chips-pipeline). This
# script is the fast, credential-free gate to run right after `kubectl apply`.
#
# Usage: scripts/post-deploy-smoke.sh [namespace]   (default namespace: ai-demo)
set -euo pipefail

NS="${1:-ai-demo}"
CONFIGMAP="ai-demo-config"
FAIL=0

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
note()  { printf '  %s\n' "$*"; }

echo "== post-deploy smoke (namespace: $NS) =="

# ── 1. pod readiness ────────────────────────────────────────────────────────
echo "[1/3] pod readiness"
# READY column is "<ready>/<total>"; awk ERE has no backreferences, so split and
# compare the two counts instead of a regex.
NOT_READY="$(kubectl -n "$NS" get pods --no-headers 2>/dev/null \
  | awk '{split($2,a,"/"); if (a[1] != a[2] || $3 != "Running") print $1" ("$2", "$3")"}')"
if [[ -n "$NOT_READY" ]]; then
  red "  NOT READY:"; echo "$NOT_READY" | sed 's/^/    /'; FAIL=1
else
  green "  all pods Ready"
fi

# ── 2. configmap aud invariant (forward-unchanged contract) ─────────────────
echo "[2/3] configmap audience invariant"
get() { kubectl -n "$NS" get configmap "$CONFIGMAP" -o jsonpath="{.data.$1}" 2>/dev/null; }
SERVER_AUD="$(get MCP_SERVER_RESOURCE_URI)"
GW_AUD="$(get MCP_GW_RESOURCE_URI)"
GW_RES_AUD="$(get PINGONE_RESOURCE_MCP_GATEWAY_URI)"
note "MCP_SERVER_RESOURCE_URI       = ${SERVER_AUD:-<unset>}"
note "MCP_GW_RESOURCE_URI           = ${GW_AUD:-<unset>}"
note "PINGONE_RESOURCE_MCP_GATEWAY  = ${GW_RES_AUD:-<unset>}"
if [[ -z "$SERVER_AUD" || -z "$GW_AUD" ]]; then
  red "  missing audience keys in configmap"; FAIL=1
elif [[ "$SERVER_AUD" != "$GW_AUD" ]]; then
  red "  DRIFT: the gateway forwards aud=$GW_AUD unchanged, but the MCP server validates aud=$SERVER_AUD → every agent tool call will 401."
  FAIL=1
else
  green "  MCP server validates the gateway-forwarded audience ($SERVER_AUD)"
fi

# ── 3. log signatures (recent window) ───────────────────────────────────────
echo "[3/3] recent logs free of chain-break signatures"
SIGS='aud validation failed|Empty JWT payload|Invalid or expired token|gateway_auth_failed'
for dep in mcp-server mcp-gateway banking-api-server; do
  HITS="$(kubectl -n "$NS" logs "deploy/$dep" --tail=200 --all-containers 2>/dev/null \
    | grep -niE "$SIGS" | tail -5 || true)"
  if [[ -n "$HITS" ]]; then
    red "  $dep: found chain-break signatures:"; echo "$HITS" | sed 's/^/    /'; FAIL=1
  else
    green "  $dep: clean"
  fi
done

echo "========================================"
if [[ "$FAIL" -ne 0 ]]; then
  red "SMOKE FAILED"; exit 1
fi
green "SMOKE PASSED"
