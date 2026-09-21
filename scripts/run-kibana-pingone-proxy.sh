#!/usr/bin/env bash
set -euo pipefail

# Local-only bridge: PingOne authenticates the browser, while Kibana remains
# reachable through the existing localhost:5601 kubectl port-forward.
# Required environment variables are intentionally not committed:
#   PINGONE_ENVIRONMENT_ID
#   KIBANA_PINGONE_CLIENT_ID
#   KIBANA_PINGONE_CLIENT_SECRET

: "${PINGONE_ENVIRONMENT_ID:?Set PINGONE_ENVIRONMENT_ID}"
: "${KIBANA_PINGONE_CLIENT_ID:?Set KIBANA_PINGONE_CLIENT_ID}"
: "${KIBANA_PINGONE_CLIENT_SECRET:?Set KIBANA_PINGONE_CLIENT_SECRET}"

cookie_secret="$(openssl rand -base64 32 | tr -d '=+/\n' | cut -c1-32)"

docker rm -f kibana-oauth2-proxy >/dev/null 2>&1 || true
exec docker run --rm --name kibana-oauth2-proxy \
  --add-host=host.docker.internal:host-gateway \
  -p 4180:4180 \
  -e OAUTH2_PROXY_PROVIDER=oidc \
  -e OAUTH2_PROXY_OIDC_ISSUER_URL="https://auth.pingone.com/${PINGONE_ENVIRONMENT_ID}/as" \
  -e OAUTH2_PROXY_CLIENT_ID="${KIBANA_PINGONE_CLIENT_ID}" \
  -e OAUTH2_PROXY_CLIENT_SECRET="${KIBANA_PINGONE_CLIENT_SECRET}" \
  -e OAUTH2_PROXY_COOKIE_SECRET="${cookie_secret}" \
  -e OAUTH2_PROXY_COOKIE_SECURE=false \
  -e OAUTH2_PROXY_REDIRECT_URL=http://localhost:4180/oauth2/callback \
  -e OAUTH2_PROXY_HTTP_ADDRESS=0.0.0.0:4180 \
  -e OAUTH2_PROXY_UPSTREAMS=http://host.docker.internal:5601 \
  -e OAUTH2_PROXY_EMAIL_DOMAINS='*' \
  -e OAUTH2_PROXY_SCOPE='openid profile email' \
  -e OAUTH2_PROXY_REVERSE_PROXY=true \
  -e OAUTH2_PROXY_SKIP_PROVIDER_BUTTON=true \
  quay.io/oauth2-proxy/oauth2-proxy:v7.8.1
