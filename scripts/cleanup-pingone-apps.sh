#!/bin/bash
# Cleanup unused PingOne apps from environment 01d89b06

set -euo pipefail

ENV_ID="01d89b06-66d5-430e-9f28-65636843788b"
REGION="com"

# Apps to KEEP (22 total)
declare -A KEEPER_IDS=(
  ["PINGONE_ADMIN_CLIENT_ID"]="8a711944-e625-42ce-af14-4d5a0825155a"
  ["PINGONE_USER_CLIENT_ID"]="83572007-b2c7-4862-8197-dc225a9fb8e1"
  ["PINGONE_TOKEN_EXCHANGER_CLIENT_ID"]="f4dd707d-f78d-4417-ba56-dc8707d10a1f"
  ["PINGONE_MCP_GATEWAY_CLIENT_ID"]="6586d3de-b916-454c-84e5-6d21b572a534"
  ["PINGONE_AGENT_CLIENT_ID"]="4069fee6-34e1-453e-85a4-d1e485f08ebe"
  ["PINGONE_AI_AGENT_ACTOR_CLIENT_ID"]="71e878ea-2d79-4760-b570-66f00cbeffe7"
  ["PINGONE_WORKER_CLIENT_ID"]="89ad8921-2e90-4b58-93bd-9ec72bd33ad5"
  ["PINGONE_MCP_OAUTH_CLIENT_ID"]="eec33861-dc73-4ca2-93c7-9ceb45174825"
  ["PINGONE_GATEWAY_MCP_OAUTH_CLIENT_ID"]="c8392dc4-2d82-4e49-92a8-79a78401faf5"
  ["PINGONE_BOOTSTRAP_CLIENT_ID"]="89ad8921-2e90-4b58-93bd-9ec72bd33ad5"
  ["PINGONE_A2A_INVESTMENT_AGENT_CLIENT_ID"]="0bba2bb8-896b-42ae-bb56-503d3c75f82e"
  ["PINGONE_A2A_RECORDS_AGENT_CLIENT_ID"]="74d7fafe-67be-452c-9d29-0b54ba59eef8"
  ["PINGONE_A2A_PURCHASE_AGENT_CLIENT_ID"]="fb66cb43-169f-461d-bf71-7344ad7f37f3"
  ["PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_ID"]="5a5d730f-864c-46b4-a651-53516a6f709c"
  ["PINGONE_A2A_PAYROLL_AGENT_CLIENT_ID"]="9283be7f-0835-4332-9dca-33236307c79e"
  ["PINGONE_A2A_TAX_AGENT_CLIENT_ID"]="9fb0efa4-bf04-4f18-b442-70c9b32e684c"
  ["PINGONE_A2A_FINAID_AGENT_CLIENT_ID"]="a1dc8b3d-df50-4b57-9c4a-4c34095bea5a"
  ["PINGONE_A2A_SUPPLIER_AGENT_CLIENT_ID"]="f1ed734a-08d5-4a15-bff7-a84852c1cffd"
  ["PINGONE_A2A_HOLDINGS_AGENT_CLIENT_ID"]="12651b1e-f61d-46aa-9ab9-760da3a761cd"
  ["PINGONE_A2A_PASSENGER_AGENT_CLIENT_ID"]="77c0dc03-c0b6-4e3a-a3f7-470e724ac6c1"
  ["PINGONE_A2A_IDENTITY_AGENT_CLIENT_ID"]="ce2f6632-906b-461a-8377-6d070c762e25"
  ["PINGONE_SDK_DEMO_CLIENT_ID"]="160cc22f-ccc4-4fef-8470-c9094c8a9afa"
)

echo "📋 PingOne App Cleanup — Environment $ENV_ID"
echo ""
echo "⚠️  SETUP REQUIRED"
echo ""
echo "1️⃣  Connect PingOne MCP (one-time, interactive):"
echo "   Type: /mcp"
echo "   Add MCP server:"
echo "     https://api.pingone.${REGION}/v1/environments/${ENV_ID}/mcp"
echo "   Complete OAuth flow"
echo ""
echo "2️⃣  Once connected, use these commands to audit and clean:"
echo ""
echo "   List all apps:"
echo "   mcp call listApplications '{\"environmentId\":\"${ENV_ID}\"}'"
echo ""
echo "   Delete SDK_DEMO (unused):"
echo "   mcp call deleteApplication '{\"environmentId\":\"${ENV_ID}\",\"applicationId\":\"160cc22f-ccc4-4fef-8470-c9094c8a9afa\"}'"
echo ""
echo "3️⃣  Keeper apps (preserve these):"
echo ""
for key in "${!KEEPER_IDS[@]}"; do
  printf "   %-45s %s\n" "$key" "${KEEPER_IDS[$key]}"
done | sort
echo ""
echo "Any other apps = delete"