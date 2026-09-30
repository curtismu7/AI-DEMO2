#!/bin/sh
set -eu

SERVER_SOCKET=/run/spire/server/private/api.sock
NODE_SPIFFE_ID_PREFIX="spiffe://bxfinance.demo/spire/agent/join_token"

until spire-server healthcheck -socketPath "$SERVER_SOCKET" >/dev/null 2>&1; do
  sleep 2
done

# Parent workload entries on the LIVE agent, not a freshly generated join
# token. Re-running this container must never orphan the entries on a node id
# that never joined: the agent persists its SVID in spiffe-agent-data and only
# consumes the bootstrap token on a COLD start (empty volume). Deriving the
# parent from `agent list` keeps every re-run idempotent; the freshly minted
# bootstrap token is kept for that cold-start path only.
TOKEN="$(spire-server token generate -socketPath "$SERVER_SOCKET" -ttl 600 | awk '/Token:/ {print $2}')"
test -n "$TOKEN"
printf '%s' "$TOKEN" > /run/spire-bootstrap/join-token
# agent list prints a multi-line record per agent. A banned agent is marked
# "Banned : true"; healthy records OMIT the Banned line entirely. Skip banned
# and EXPIRED records, keep the last healthy one (SPIRE lists oldest-first).
NODE_SPIFFE_ID=""
_ID=""; _BANNED=""; _EXP=""
_NOW="$(date +%s)"
while IFS= read -r LINE; do
  case "$LINE" in
    "SPIFFE ID"*)
      _ID="$(printf '%s' "$LINE" | awk '{print $4}')"
      _BANNED="false"; _EXP_EPOCH="0" ;;
    "Expiration time"*" UTC")
      _EXP="$(printf '%s' "$LINE" | awk -F'  *:  *' '{print $2}' | awk '{print $1" "$2}')"
      _EXP_EPOCH="$(date -d "$_EXP" +%s 2>/dev/null || echo 0)" ;;
    "Banned"*)    _BANNED="$(printf '%s' "$LINE" | awk -F': *' '{print $2}')" ;;
    "Agent version"*)
      if [ "$_BANNED" != "true" ] && [ "${_EXP_EPOCH:-0}" -gt "$_NOW" ]; then
        NODE_SPIFFE_ID="$_ID"
      fi ;;
  esac
done <<AGENTLIST
$(spire-server agent list -socketPath "$SERVER_SOCKET")
AGENTLIST
echo "Entries will parent on live agent: $NODE_SPIFFE_ID" >&2

ensure_entry() {
  ENTRY_ID="$1"
  SPIFFE_ID="$2"
  SELECTOR="$3"
  if EXISTING="$(spire-server entry show -socketPath "$SERVER_SOCKET" -entryID "$ENTRY_ID" 2>&1)"; then
    spire-server entry update -socketPath "$SERVER_SOCKET" \
      -entryID "$ENTRY_ID" -spiffeID "$SPIFFE_ID" -parentID "$NODE_SPIFFE_ID" \
      -selector "$SELECTOR" -x509SVIDTTL 3600 -jwtSVIDTTL 3600
  else
    case "$EXISTING" in
      *"code = NotFound"*"entry not found"*)
        spire-server entry create -socketPath "$SERVER_SOCKET" \
          -entryID "$ENTRY_ID" -spiffeID "$SPIFFE_ID" \
          -parentID "$NODE_SPIFFE_ID" -selector "$SELECTOR" \
          -x509SVIDTTL 3600 -jwtSVIDTTL 3600
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
  spiffe://bxfinance.demo/bff docker:label:com.ai-demo.spiffe-workload:bff
ensure_entry "45b76c4f-409b-41f4-8a87-d12743c75140" \
  spiffe://bxfinance.demo/agent docker:label:com.ai-demo.spiffe-workload:agent
ensure_entry "75faf632-fbf5-4715-a3b8-e82eda4fc663" \
  spiffe://bxfinance.demo/mcp-gateway docker:label:com.ai-demo.spiffe-workload:mcp-gateway
ensure_entry "7f484bba-3c2a-428b-8114-0726e3f2d8a0" \
  spiffe://bxfinance.demo/mcp-server docker:label:com.ai-demo.spiffe-workload:mcp-server
# Identity the SPIFFE -> PingFederate exchange presents (services/spiffePingfederateService.js).
# Only that flow mints an SVID with this label; no compose service carries it.
ensure_entry "d40c260d-e253-4db3-b646-d9a72093c128" \
  spiffe://bxfinance.demo/ns/ai-agents/sa/workforce-ai-agent docker:label:com.ai-demo.spiffe-workload:workforce-agent

for ENTRY_ID in \
  1239638f-e0d4-464c-b222-b5c9a603bad7 \
  45b76c4f-409b-41f4-8a87-d12743c75140 \
  75faf632-fbf5-4715-a3b8-e82eda4fc663 \
  7f484bba-3c2a-428b-8114-0726e3f2d8a0 \
  d40c260d-e253-4db3-b646-d9a72093c128; do
  spire-server entry show -socketPath "$SERVER_SOCKET" -entryID "$ENTRY_ID"
done

verify_entry "1239638f-e0d4-464c-b222-b5c9a603bad7" \
  spiffe://bxfinance.demo/bff docker:label:com.ai-demo.spiffe-workload:bff
verify_entry "45b76c4f-409b-41f4-8a87-d12743c75140" \
  spiffe://bxfinance.demo/agent docker:label:com.ai-demo.spiffe-workload:agent
verify_entry "75faf632-fbf5-4715-a3b8-e82eda4fc663" \
  spiffe://bxfinance.demo/mcp-gateway docker:label:com.ai-demo.spiffe-workload:mcp-gateway
verify_entry "7f484bba-3c2a-428b-8114-0726e3f2d8a0" \
  spiffe://bxfinance.demo/mcp-server docker:label:com.ai-demo.spiffe-workload:mcp-server
verify_entry "d40c260d-e253-4db3-b646-d9a72093c128" \
  spiffe://bxfinance.demo/ns/ai-agents/sa/workforce-ai-agent docker:label:com.ai-demo.spiffe-workload:workforce-agent
