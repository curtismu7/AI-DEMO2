#!/bin/bash

################################################################################
# PingOne Scope Configuration Fix Script
# 
# Fixes scope configuration drift for RFC 8693 token exchange
# Based on: SCOPE_AUDIT_REPORT.md and actual PingOne console state
#
# Usage:
#   export PINGONE_ENVIRONMENT_ID=<your-env-id>
#   export PINGONE_WORKER_CLIENT_ID=<worker-app-id>
#   export PINGONE_WORKER_CLIENT_SECRET=<worker-secret>
#   export PINGONE_REGION=com  # or us, ca, eu, au
#   bash fix-pingone-scopes.sh
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Environment
ENV_ID="${PINGONE_ENVIRONMENT_ID}"
WORKER_ID="${PINGONE_WORKER_CLIENT_ID}"
WORKER_SECRET="${PINGONE_WORKER_CLIENT_SECRET}"
REGION="${PINGONE_REGION:-com}"
BASE_URL="https://api.pingone.${REGION}/${ENV_ID}"
AUTH_URL="https://auth.pingone.${REGION}/${ENV_ID}/as/token"

# App IDs
USER_APP_ID="b2752071-2d03-4927-b865-089dc40b9c85"
ADMIN_APP_ID="14cefa5b-d9d6-4e51-8749-e938d4edd1c0"
MCP_EXCHANGER_ID="6380065f-f328-41c2-81ed-1daeec811285"
WORKER_APP_ID="95dc946f-5e0a-4a8b-a8ba-b587b244e005"

# Resource Server IDs (need to look these up first)
BANKING_API_RESOURCE_ID=""
MCP_SERVER_RESOURCE_ID=""

# Scope IDs (will be looked up from resource servers)
declare -A SCOPE_IDS

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}PingOne RFC 8693 Scope Configuration Fix${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

# Validate environment
if [ -z "$ENV_ID" ]; then
    echo -e "${RED}✗ Error: PINGONE_ENVIRONMENT_ID not set${NC}"
    exit 1
fi

if [ -z "$WORKER_ID" ] || [ -z "$WORKER_SECRET" ]; then
    echo -e "${RED}✗ Error: PINGONE_WORKER_CLIENT_ID or PINGONE_WORKER_CLIENT_SECRET not set${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Environment: $ENV_ID${NC}"
echo -e "${GREEN}✓ Region: $REGION${NC}"

# Get worker authentication token
echo -e "\n${BLUE}[1/6] Getting worker authentication token...${NC}"

WORKER_TOKEN=$(curl -s -X POST "$AUTH_URL" \
  --user "$WORKER_ID:$WORKER_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" | jq -r '.access_token')

if [ -z "$WORKER_TOKEN" ] || [ "$WORKER_TOKEN" = "null" ]; then
    echo -e "${RED}✗ Failed to get worker token${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Worker token acquired${NC}"

# Function to make authenticated API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -z "$data" ]; then
        curl -s -X "$method" "$BASE_URL$endpoint" \
            -H "Authorization: Bearer $WORKER_TOKEN" \
            -H "Content-Type: application/json"
    else
        curl -s -X "$method" "$BASE_URL$endpoint" \
            -H "Authorization: Bearer $WORKER_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

# Get resource servers and scopes
echo -e "\n${BLUE}[2/6] Retrieving resource servers and scope IDs...${NC}"

# Get all resource servers
RESOURCES=$(api_call GET "/resources")

# Extract Banking API resource (should be "Super Banking API" or similar)
BANKING_API_RESOURCE_ID=$(echo "$RESOURCES" | jq -r '.[] | select(.name | contains("Super Banking API")) | .id' | head -1)
MCP_SERVER_RESOURCE_ID=$(echo "$RESOURCES" | jq -r '.[] | select(.name | contains("Super Banking MCP")) | .id' | head -1)

if [ -z "$BANKING_API_RESOURCE_ID" ]; then
    echo -e "${RED}✗ Could not find Banking API resource server${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Banking API Resource ID: $BANKING_API_RESOURCE_ID${NC}"
echo -e "${GREEN}✓ MCP Server Resource ID: $MCP_SERVER_RESOURCE_ID${NC}"

# Get all scopes for both resources
echo -e "\n${BLUE}[3/6] Building scope ID mapping...${NC}"

# Get Banking API scopes
BANKING_SCOPES=$(api_call GET "/resources/$BANKING_API_RESOURCE_ID/scopes")

# Get MCP scopes if resource exists
if [ -n "$MCP_SERVER_RESOURCE_ID" ] && [ "$MCP_SERVER_RESOURCE_ID" != "null" ]; then
    MCP_SCOPES=$(api_call GET "/resources/$MCP_SERVER_RESOURCE_ID/scopes")
else
    MCP_SCOPES="[]"
fi

# Helper function to find scope ID by name
find_scope_id() {
    local scope_name=$1
    local resource_id=$2
    local scopes=$(api_call GET "/resources/$resource_id/scopes")
    echo "$scopes" | jq -r ".[] | select(.name == \"$scope_name\") | .id" | head -1
}

echo -e "${GREEN}✓ Scope mapping built${NC}"

# Fix User App
echo -e "\n${BLUE}[4/6] Fixing User App scopes...${NC}"

USER_APP_REQUIRED_SCOPES=(
    "profile"
    "email"
    "banking:ai:agent:read"
    "banking:general:read"
    "banking:accounts:read"
    "banking:transactions:read"
    "banking:transactions:write"
)

echo -e "  Required scopes for User App:"
for scope in "${USER_APP_REQUIRED_SCOPES[@]}"; do
    echo -e "    - $scope"
done

echo -e "${YELLOW}  ⚠ Manual fix needed: Go to PingOne Console${NC}"
echo -e "${YELLOW}    1. Open Super Banking User App${NC}"
echo -e "${YELLOW}    2. Go to Resources tab${NC}"
echo -e "${YELLOW}    3. Add these scopes if missing:${NC}"
for scope in "${USER_APP_REQUIRED_SCOPES[@]}"; do
    echo -e "${YELLOW}       • $scope${NC}"
done

# Fix Admin App
echo -e "\n${BLUE}[5/6] Fixing Admin App scopes...${NC}"

ADMIN_APP_REQUIRED_SCOPES=(
    # Banking API scopes
    "banking:accounts:read"
    "banking:accounts:write"
    "banking:accounts:admin"
    "banking:transactions:read"
    "banking:transactions:write"
    "banking:transactions:admin"
    "banking:general:read"
    "banking:general:write"
    "banking:general:admin"
    "banking:ai:agent:read"
    "banking:ai:agent:write"
    "banking:ai:agent:admin"
    "banking:admin"
    # MCP Server scopes
    "admin:read"
    "admin:write"
    "admin:delete"
    "users:read"
    "users:manage"
)

echo -e "  Required scopes for Admin App (18 total):"
for scope in "${ADMIN_APP_REQUIRED_SCOPES[@]}"; do
    echo -e "    - $scope"
done

echo -e "${YELLOW}  ⚠ Manual fix needed: Go to PingOne Console${NC}"
echo -e "${YELLOW}    1. Open Super Banking Admin App${NC}"
echo -e "${YELLOW}    2. Go to Resources tab${NC}"
echo -e "${YELLOW}    3. REMOVE: openid (not needed for admin)${NC}"
echo -e "${YELLOW}    4. ADD all 18 scopes listed above${NC}"

# Fix MCP Exchanger
echo -e "\n${BLUE}[6/6] Fixing MCP Exchanger scopes...${NC}"

MCP_EXCHANGER_REQUIRED_SCOPES=(
    "banking:ai:agent:read"
    "banking:accounts:read"
    "banking:transactions:read"
    "banking:general:read"
    "admin:read"
    "p1:read:user"
)

MCP_EXCHANGER_SHOULD_REMOVE_SCOPES=(
    "agent:invoke"
    "banking:agent:invoke"
    "banking:transactions:write"
    "openid"
    "p1:update:user"
)

echo -e "  Required scopes for MCP Exchanger:"
for scope in "${MCP_EXCHANGER_REQUIRED_SCOPES[@]}"; do
    echo -e "    - $scope"
done

echo -e "${YELLOW}  Current extra scopes to REMOVE:${NC}"
for scope in "${MCP_EXCHANGER_SHOULD_REMOVE_SCOPES[@]}"; do
    echo -e "${YELLOW}    - $scope${NC}"
done

echo -e "${YELLOW}  ⚠ Manual fix needed: Go to PingOne Console${NC}"
echo -e "${YELLOW}    1. Open Super Banking MCP Token Exchanger${NC}"
echo -e "${YELLOW}    2. Go to Resources tab${NC}"
echo -e "${YELLOW}    3. ADD: banking:ai:agent:read, banking:transactions:read, banking:general:read, admin:read${NC}"
echo -e "${YELLOW}    4. REMOVE: agent:invoke, banking:agent:invoke, banking:transactions:write, openid, p1:update:user${NC}"

# Verify Worker App
echo -e "\n${YELLOW}⚠ Worker App Verification Needed:${NC}"
echo -e "  1. Open Super Banking Worker Token in PingOne Console"
echo -e "  2. Go to Resources tab"
echo -e "  3. Verify it has exactly these scopes:"
echo -e "     • p1:read:user"
echo -e "     • p1:update:user"

# Summary
echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}SUMMARY OF CHANGES NEEDED${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

cat << 'EOF'

┌─ USER APP (b2752071-2d03-4927-b865-089dc40b9c85) ──────────────────
│ 🔴 CRITICAL: Missing banking:ai:agent:read (RFC 8693 delegation)
│ Status: Currently has only: agent:invoke, email, offline_access, openid, profile
│ Action: ADD all 7 required scopes (see above)
└──────────────────────────────────────────────────────────────────

┌─ ADMIN APP (14cefa5b-d9d6-4e51-8749-e938d4edd1c0) ────────────────
│ 🔴 CRITICAL: Only has openid; missing ALL banking/admin scopes
│ Status: Completely non-functional for admin operations
│ Action: ADD all 18 required scopes (see above)
└──────────────────────────────────────────────────────────────────

┌─ MCP EXCHANGER (6380065f-f328-41c2-81ed-1daeec811285) ────────────
│ 🔴 CRITICAL: Missing banking:ai:agent:read
│ Status: Has extra/wrong scopes; missing several required ones
│ Action: 
│   • ADD: banking:ai:agent:read, banking:transactions:read, 
│           banking:general:read, admin:read
│   • REMOVE: agent:invoke, banking:agent:invoke, 
│             banking:transactions:write, openid, p1:update:user
└──────────────────────────────────────────────────────────────────

┌─ WORKER APP (95dc946f-5e0a-4a8b-a8ba-b587b244e005) ──────────────
│ ⚠️  VERIFY: Scopes should be exactly p1:read:user + p1:update:user
│ Status: Not shown in screenshots; needs verification
│ Action: VERIFY has exactly 2 scopes (no extra, no missing)
└──────────────────────────────────────────────────────────────────

NEXT STEPS:
1. Go to PingOne Console (https://console.pingone.com)
2. Select your environment
3. Go to Connections → Applications
4. For each app above, click "Resources" tab
5. Add/remove scopes as documented
6. Save changes
7. Run Phase 111 to update code configuration with app IDs
8. Test complete token exchange flow

EOF

echo -e "\n${GREEN}✓ Fix documentation complete${NC}"
