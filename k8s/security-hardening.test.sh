#!/usr/bin/env bash
# Static guards for the SE Kubernetes security boundary.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

grep -q 'auth-url: "http://frontend\.' "$HERE/aws/se-ingress.yaml" \
  || fail "SE external-auth must use HTTP for the plain-HTTP frontend Service"
! grep -q 'auth-url: "https://frontend\.' "$HERE/aws/se-ingress.yaml" \
  || fail "SE external-auth must not use HTTPS against the frontend Service"

grep -q '^  type: ClusterIP$' "$HERE/10-frontend-deployment.yaml" \
  || fail "frontend must not be exposed as a NodePort"
! grep -q '^    nodePort:' "$HERE/10-frontend-deployment.yaml" \
  || fail "frontend manifest must not declare a NodePort"

grep -q 'SECURITY_HARDENED_DEPLOYMENT=true' "$HERE/aws/deploy.sh" \
  || fail "AWS/SE deploy must enable hardened secret handling"
grep -q 'GRAFANA_ADMIN_PASSWORD must be set' "$HERE/create-secrets.sh" \
  || fail "hardened deployments must fail without a Grafana admin password"

grep -q '169.254.169.254/32' "$HERE/04-network-policies.yaml" \
  || fail "network policy must exclude the AWS instance metadata endpoint"
grep -q '169.254.170.2/32' "$HERE/04-network-policies.yaml" \
  || fail "network policy must exclude the container metadata endpoint"

grep -q 'DISABLE_RATE_LIMIT' "$HERE/20-api-server-deployment.yaml" \
  || fail "BFF deployment must explicitly keep rate limiting enabled"
grep -q 'RATE_LIMIT_AUTH_MAX' "$HERE/20-api-server-deployment.yaml" \
  || fail "BFF deployment must bound OAuth abuse"
grep -q 'GATEWAY_RATE_LIMIT_ENABLED' "$HERE/60-mcp-gateway-deployment.yaml" \
  || fail "MCP gateway rate limiting must be enabled"
! grep -q 'NODE_TLS_REJECT_UNAUTHORIZED' "$HERE/60-mcp-gateway-deployment.yaml" \
  || fail "hosted MCP gateway must not disable global TLS verification"
grep -q 'NODE_EXTRA_CA_CERTS' "$HERE/60-mcp-gateway-deployment.yaml" \
  || fail "hosted MCP gateway must trust the internal CA explicitly"
grep -q 'limit-rps: "5"' "$HERE/aws/se-ingress.yaml" \
  || fail "OAuth ingress must be rate limited"
grep -q 'automountServiceAccountToken: false' "$HERE/60-mcp-gateway-deployment.yaml" \
  || fail "MCP gateway must not receive a service-account token"

grep -q 'sha-\$(git -C "\$K8S_DIR" rev-parse HEAD)' "$HERE/aws/deploy.sh" \
  || fail "AWS deploy default image tag must be commit-addressed"
grep -q 'sha-\$(git -C "\$BASEDIR" rev-parse HEAD)' "$ROOT/run-k8.sh" \
  || fail "run-k8 default image tag must be commit-addressed"
grep -q 'sha-\$(git -C "\$BASEDIR" rev-parse HEAD)' "$ROOT/se-update-code.sh" \
  || fail "SE update default image tag must be commit-addressed"

echo "security hardening checks: passed"
