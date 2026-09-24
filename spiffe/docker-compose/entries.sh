#!/bin/sh
set -eu

SERVER_SOCKET=/run/spire/server/private/api.sock
NODE_SPIFFE_ID="spiffe://bxfinance.demo/node/agent"

until spire-server healthcheck -socketPath "$SERVER_SOCKET" >/dev/null 2>&1; do
  sleep 2
done

# Give the node a stable SPIFFE ID so workload entries keep the same parent
# across registration job runs while each one-time join token can expire.
TOKEN="$(spire-server token generate -socketPath "$SERVER_SOCKET" -spiffeID "$NODE_SPIFFE_ID" -ttl 600 | awk '/Token:/ {print $2}')"
test -n "$TOKEN"
printf '%s' "$TOKEN" > /run/spire-bootstrap/join-token

ensure_entry() {
  ENTRY_ID="$1"
  SPIFFE_ID="$2"
  SELECTOR="$3"
  if EXISTING="$(spire-server entry show -socketPath "$SERVER_SOCKET" -entryID "$ENTRY_ID" 2>&1)"; then
    spire-server entry update -socketPath "$SERVER_SOCKET" \
      -entryID "$ENTRY_ID" -spiffeID "$SPIFFE_ID" \
      -parentID "$NODE_SPIFFE_ID" \
      -selector "$SELECTOR" -x509SVIDTTL 3600
  else
    case "$EXISTING" in
      *"code = NotFound"*"entry not found"*)
        spire-server entry create -socketPath "$SERVER_SOCKET" \
          -entryID "$ENTRY_ID" -spiffeID "$SPIFFE_ID" \
          -parentID "$NODE_SPIFFE_ID" -selector "$SELECTOR" \
          -x509SVIDTTL 3600
        ;;
      *)
        printf '%s\n' "$EXISTING" >&2
        exit 1
        ;;
    esac
  fi
}

verify_entry() {
  ENTRY_ID="$1"
  SPIFFE_ID="$2"
  SELECTOR="$3"
  ENTRY="$(spire-server entry show -socketPath "$SERVER_SOCKET" -entryID "$ENTRY_ID")"

  if ! printf '%s\n' "$ENTRY" | grep -Fq "$SPIFFE_ID" \
    || ! printf '%s\n' "$ENTRY" | grep -Fq "$NODE_SPIFFE_ID" \
    || ! printf '%s\n' "$ENTRY" | grep -Fq "$SELECTOR"; then
    echo "Missing or mismatched registration entry for $SPIFFE_ID" >&2
    exit 1
  fi
}

ensure_entry "1239638f-e0d4-464c-b222-b5c9a603bad7" \
  spiffe://bxfinance.demo/bff docker:label:com.ai-demo.spiffe-workload=bff
ensure_entry "45b76c4f-409b-41f4-8a87-d12743c75140" \
  spiffe://bxfinance.demo/agent docker:label:com.ai-demo.spiffe-workload=agent
ensure_entry "75faf632-fbf5-4715-a3b8-e82eda4fc663" \
  spiffe://bxfinance.demo/mcp-gateway docker:label:com.ai-demo.spiffe-workload=mcp-gateway
ensure_entry "7f484bba-3c2a-428b-8114-0726e3f2d8a0" \
  spiffe://bxfinance.demo/mcp-server docker:label:com.ai-demo.spiffe-workload=mcp-server

for ENTRY_ID in \
  1239638f-e0d4-464c-b222-b5c9a603bad7 \
  45b76c4f-409b-41f4-8a87-d12743c75140 \
  75faf632-fbf5-4715-a3b8-e82eda4fc663 \
  7f484bba-3c2a-428b-8114-0726e3f2d8a0; do
  spire-server entry show -socketPath "$SERVER_SOCKET" -entryID "$ENTRY_ID"
done

verify_entry "1239638f-e0d4-464c-b222-b5c9a603bad7" \
  spiffe://bxfinance.demo/bff docker:label:com.ai-demo.spiffe-workload=bff
verify_entry "45b76c4f-409b-41f4-8a87-d12743c75140" \
  spiffe://bxfinance.demo/agent docker:label:com.ai-demo.spiffe-workload=agent
verify_entry "75faf632-fbf5-4715-a3b8-e82eda4fc663" \
  spiffe://bxfinance.demo/mcp-gateway docker:label:com.ai-demo.spiffe-workload=mcp-gateway
verify_entry "7f484bba-3c2a-428b-8114-0726e3f2d8a0" \
  spiffe://bxfinance.demo/mcp-server docker:label:com.ai-demo.spiffe-workload=mcp-server
