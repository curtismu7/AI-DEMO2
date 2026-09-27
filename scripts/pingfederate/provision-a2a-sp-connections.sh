#!/usr/bin/env bash
# provision-a2a-sp-connections.sh — create the 12 A2A SP connections the
# A2A-under-PingFederate chain needs (11 intermediates + the A2A gateway),
# mirroring the 2026-09-22 runtime config that was lost when the PF profile
# was rebuilt from the out-classic volume (see REGRESSION_PLAN.md §4).
#
# Each SP: resourceUris=["https://<aud>"], idJagEnabled=true, contract
# TOKEN_SUBJECT + client_id/scope/a2a_tenant_id, processor policy
# aiDemoStandardTePolicy (access_token subject + required actor), tenant
# claim filled with the PingOne environment id via a TEXT source.
#
# Prereqs:
#   export PINGFEDERATE_ADMIN_PASSWORD='<admin pw>'   (or read from the container env)
#   PF_BASE (default https://local.ping-devops.com:9999/pf-admin-api/v1)
#
# Idempotent: skips an SP whose id already exists.
set -euo pipefail

PF_BASE="${PF_BASE:-https://local.ping-devops.com:9999/pf-admin-api/v1}"
if [[ -z "${PINGFEDERATE_ADMIN_PASSWORD:-}" ]]; then
  PINGFEDERATE_ADMIN_PASSWORD=$(docker inspect ai-demo-pingfederate \
    --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | awk -F= '$1=="PING_IDENTITY_PASSWORD"{print substr($0, index($0,"=")+1)}')
fi
AUTH="administrator:${PINGFEDERATE_ADMIN_PASSWORD}"

ENV_ID="${PINGONE_ENVIRONMENT_ID:-01d89b06-66d5-430e-9f28-65636843788b}"
POLICY_ID="aiDemoStandardTePolicy"
KEYPAIR_ID="aidemopf-idjag-signing"

# audience list — keep in sync with config/a2aSpecialists.js + services/scopeTopology.js
AUDIENCES=(
  "a2a-intermediate-investment"
  "a2a-intermediate-records"
  "a2a-intermediate-purchase"
  "a2a-intermediate-membership"
  "a2a-intermediate-payroll"
  "a2a-intermediate-tax"
  "a2a-intermediate-finaid"
  "a2a-intermediate-supplier"
  "a2a-intermediate-holdings"
  "a2a-intermediate-passenger"
  "a2a-intermediate-identity"
  "mcpgateway-a2a"
)

api() { curl -sk -u "$AUTH" -H "X-XSRF-Header: x" "$@"; }


for aud in "${AUDIENCES[@]}"; do
  # id must be <=33 chars: aiDemoA2a + short slug + Sp
  case "$aud" in
    mcpgateway*) slug="Gateway" ;;
    *) slug=$(echo "$aud" | sed 's/a2a-intermediate-//') ;;
  esac
  sp_id="aiDemoA2a$(echo "$slug" | cut -c1 | tr 'a-z' 'A-Z')$(echo "$slug" | cut -c2-)Sp"
  existing=$(api -o /dev/null -w '%{http_code}' "$PF_BASE/idp/spConnections/$sp_id")
  if [[ "$existing" == "200" ]]; then
    echo "skip $sp_id (exists)"
    continue
  fi

  body=$(cat <<EOF
{
  "type": "SP",
  "id": "$sp_id",
  "name": "AI Demo A2A $aud Resource Server",
  "entityId": "https://$aud.ping.demo",
  "active": true,
  "loggingMode": "STANDARD",
  "virtualEntityIds": [],
  "credentials": {
    "certs": [],
    "signingSettings": {
      "signingKeyPairRef": { "id": "$KEYPAIR_ID" },
      "algorithm": "SHA256withRSA",
      "includeCertInSignature": false,
      "includeRawKeyInSignature": false
    }
  },
  "connectionTargetType": "STANDARD",
  "oauthTokenExchangeSettings": {
    "resourceUris": ["https://$aud.ping.demo"],
    "minutesBefore": 5,
    "minutesAfter": 30,
    "idJagEnabled": true,
    "attributeContract": {
      "coreAttributes": [ { "name": "TOKEN_SUBJECT" } ],
      "extendedAttributes": [
        { "name": "client_id" },
        { "name": "scope" },
        { "name": "a2a_tenant_id" }
      ]
    },
    "processorPolicyMappings": [
      {
        "attributeSources": [],
        "attributeContractFulfillment": {
          "scope":          { "source": { "type": "TOKEN_EXCHANGE_PROCESSOR_POLICY" }, "value": "scope" },
          "TOKEN_SUBJECT":  { "source": { "type": "TOKEN_EXCHANGE_PROCESSOR_POLICY" }, "value": "subject" },
          "client_id":      { "source": { "type": "TOKEN_EXCHANGE_PROCESSOR_POLICY" }, "value": "client_id" },
          "a2a_tenant_id":  { "source": { "type": "TEXT" }, "value": "$ENV_ID" }
        },
        "issuanceCriteria": { "conditionalCriteria": [] },
        "processorPolicyRef": { "id": "$POLICY_ID" }
      }
    ]
  }
}
EOF
)
  code=$(api -X POST -H "Content-Type: application/json" -d "$body" \
    -o /tmp/pf-create-resp.json -w '%{http_code}' "$PF_BASE/idp/spConnections")
  if [[ "$code" == "201" ]]; then
    echo "created $sp_id -> https://$aud.ping.demo"
  else
    echo "FAILED $sp_id (HTTP $code): $(head -c 300 /tmp/pf-create-resp.json)"
    exit 1
  fi
done
echo "done"
