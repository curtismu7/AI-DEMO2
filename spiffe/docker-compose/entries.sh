#!/bin/sh
set -eu

until spire-server healthcheck -socketPath /run/spire-server/private/api.sock >/dev/null 2>&1; do
  sleep 2
done

TOKEN="$(spire-server token generate -socketPath /run/spire-server/private/api.sock -ttl 600 | awk '/Token:/ {print $2}')"
test -n "$TOKEN"
printf '%s' "$TOKEN" > /run/spire-bootstrap/join-token
PARENT="spiffe://bxfinance.demo/spire/agent/join_token/$TOKEN"
spire-server entry create -socketPath /run/spire-server/private/api.sock \
  -spiffeID "$PARENT" -parentID spiffe://bxfinance.demo/spire/server \
  -selector join_token:$TOKEN -ttl 3600 || true
WORKLOAD_PARENT="$PARENT"

spire-server entry create -socketPath /run/spire-server/private/api.sock -spiffeID spiffe://bxfinance.demo/bff -parentID "$WORKLOAD_PARENT" -selector docker:label:com.ai-demo.spiffe-workload=bff -ttl 3600 || true
spire-server entry create -socketPath /run/spire-server/private/api.sock -spiffeID spiffe://bxfinance.demo/agent -parentID "$WORKLOAD_PARENT" -selector docker:label:com.ai-demo.spiffe-workload=agent -ttl 3600 || true
spire-server entry create -socketPath /run/spire-server/private/api.sock -spiffeID spiffe://bxfinance.demo/mcp-gateway -parentID "$WORKLOAD_PARENT" -selector docker:label:com.ai-demo.spiffe-workload=mcp-gateway -ttl 3600 || true
spire-server entry create -socketPath /run/spire-server/private/api.sock -spiffeID spiffe://bxfinance.demo/mcp-server -parentID "$WORKLOAD_PARENT" -selector docker:label:com.ai-demo.spiffe-workload=mcp-server -ttl 3600 || true

spire-server entry show -socketPath /run/spire-server/private/api.sock
