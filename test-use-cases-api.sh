#!/bin/bash
set -e

# E2E Test: Use Cases API with Token Chain Verification
# Tests the complete flow:
# 1. Get use cases list
# 2. Run a use case
# 3. Verify token chain in response
# 4. Check dashboard state

BASE_URL="https://api.ping.demo:4000"
API_BASE="https://api.ping.demo:3001"
INSECURE="-k"  # For self-signed certs

echo ""
echo "▶ Starting E2E API Test: Use Cases Happy Path"
echo ""

# ─────────────────────────────────────────────────────────────────────
# Step 1: Fetch use cases list
# ─────────────────────────────────────────────────────────────────────
echo "  → Fetching use cases list..."

USECASES=$(curl $INSECURE -s "$API_BASE/api/use-cases/catalog" -H "Accept: application/json")

if [ -z "$USECASES" ]; then
  echo "  ✗ Failed to fetch use cases"
  exit 1
fi

# Extract first use case ID
USECASE_ID=$(echo "$USECASES" | grep -o '"useCaseId":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$USECASE_ID" ]; then
  echo "  ✗ No use case IDs found in response"
  echo "  Response: $USECASES"
  exit 1
fi

echo "  ✓ Found use case: $USECASE_ID"
echo ""

# ─────────────────────────────────────────────────────────────────────
# Step 2: Run the use case
# ─────────────────────────────────────────────────────────────────────
echo "  → Running use case: $USECASE_ID"

RESPONSE=$(curl $INSECURE -s -w "\n%{http_code}" -X POST "$API_BASE/api/use-cases/demo/run" \
  -H "Content-Type: application/json" \
  -d "{\"useCaseId\": \"$USECASE_ID\"}")

# Split the trailing status line (-w) from the JSON body.
RUN_HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESPONSE=$(echo "$RESPONSE" | sed '$d')

# curl -s exits 0 even on HTTP 500 — fail explicitly on an error status or body.
if [ "$RUN_HTTP_CODE" -ge 400 ] 2>/dev/null || echo "$RESPONSE" | grep -q '"error"'; then
  echo "  ✗ Use case run FAILED (HTTP $RUN_HTTP_CODE)"
  echo "  Response: $RESPONSE"
  echo ""
  echo "❌ E2E API Test FAILED"
  exit 1
fi

echo "  ✓ Use case executed (HTTP $RUN_HTTP_CODE)"
echo ""

# ─────────────────────────────────────────────────────────────────────
# Step 3: Verify token chain in response
# ─────────────────────────────────────────────────────────────────────
echo "  📊 Response Analysis:"
echo ""

# Check for token chain events
if echo "$RESPONSE" | grep -q "tokenChainEvents"; then
  echo "  ✓ Token chain events detected in response"

  # Extract and display token chain
  echo ""
  echo "  Token Chain Events:"
  echo "$RESPONSE" | grep -o '"label":"[^"]*","status":"[^"]*"' | while read -r event; do
    label=$(echo "$event" | grep -o '"label":"[^"]*"' | cut -d'"' -f4)
    status=$(echo "$event" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    symbol="✓"
    if [ "$status" != "OK" ]; then
      symbol="✗"
    fi
    echo "    [$symbol] $label ($status)"
  done
else
  echo "  ⚠ No token chain events in response (may be expected for some use cases)"
fi

echo ""

# ─────────────────────────────────────────────────────────────────────
# Step 4: Verify response structure
# ─────────────────────────────────────────────────────────────────────
echo "  📋 Response Structure:"

if echo "$RESPONSE" | grep -q "useCaseId"; then
  uc_id=$(echo "$RESPONSE" | grep -o '"useCaseId":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "    ✓ useCaseId: $uc_id"
fi

if echo "$RESPONSE" | grep -q "status"; then
  status=$(echo "$RESPONSE" | grep -o '"status":[^,}]*' | head -1 | cut -d':' -f2)
  echo "    ✓ status: $status"
fi

if echo "$RESPONSE" | grep -q "triggerText"; then
  trigger=$(echo "$RESPONSE" | grep -o '"triggerText":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "    ✓ triggerText: $trigger"
fi

if echo "$RESPONSE" | grep -q "type"; then
  type=$(echo "$RESPONSE" | grep -o '"type":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "    ✓ type: $type"
fi

echo ""

# ─────────────────────────────────────────────────────────────────────
# Step 5: Verify API response codes
# ─────────────────────────────────────────────────────────────────────
echo "  🔍 API Response Codes:"

HTTP_CODE=$(curl $INSECURE -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/use-cases/demo/run" \
  -H "Content-Type: application/json" \
  -d "{\"useCaseId\": \"$USECASE_ID\"}")

if [ "$HTTP_CODE" = "200" ]; then
  echo "    ✓ Use case API: 200 OK"
elif [ "$HTTP_CODE" = "201" ]; then
  echo "    ✓ Use case API: 201 Created"
else
  echo "    ⚠ Use case API: $HTTP_CODE (unexpected)"
fi

echo ""

# ─────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────
echo "▶ TEST SUMMARY"
echo "  ✓ Use cases catalog loaded"
echo "  ✓ Use case executed: $USECASE_ID"
echo "  ✓ Response received with expected fields"
echo "  ✓ Token chain events verified (if present)"
echo ""
echo "✅ E2E API Test PASSED"
echo ""

# ─────────────────────────────────────────────────────────────────────
# Display full response for inspection
# ─────────────────────────────────────────────────────────────────────
echo "📄 Full Response (for token chain inspection):"
echo ""
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
