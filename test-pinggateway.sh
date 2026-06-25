#!/bin/bash
# PingGateway Test Script
# Tests token introspection, authorization, and MCP calls
#
# Usage: ./test-pinggateway.sh <access-token>

API_BASE="https://api.ping.demo:4000"
TOKEN="$1"

if [ -z "$TOKEN" ]; then
  echo "Usage: $0 <access-token>"
  echo ""
  echo "Example: $0 eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
  exit 1
fi

echo "=========================================="
echo "PingGateway Test Suite"
echo "=========================================="
echo ""

echo "Test 1: Gateway Configuration"
echo "---"
curl -s -X GET "$API_BASE/api/admin/pinggateway/test/config" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "Test 2: Token Introspection (RFC 7662)"
echo "---"
curl -s -X POST "$API_BASE/api/admin/pinggateway/test/introspect" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"token\": \"$TOKEN\"}" | jq .
echo ""

echo "Test 3: Authorization Decision"
echo "---"
curl -s -X POST "$API_BASE/api/admin/pinggateway/test/authorize" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"token\": \"$TOKEN\",
    \"resourceId\": \"f2669dd9-test-resource\"
  }" | jq .
echo ""

echo "Test 4: MCP Tool Call"
echo "---"
curl -s -X POST "$API_BASE/api/admin/pinggateway/test/mcp-call" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"token\": \"$TOKEN\",
    \"toolName\": \"transfer_funds\",
    \"toolInput\": {\"amount\": 100}
  }" | jq .
echo ""

echo "=========================================="
echo "Tests complete"
echo "=========================================="
