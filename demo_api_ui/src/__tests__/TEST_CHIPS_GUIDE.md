# Banking Agent Test Chips — Compliance Verification Guide

This guide documents the test chips available in the Banking Agent and the compliance paths they exercise.

## Overview

Test chips are special action buttons (under the "Testing" action group) that deliberately trigger specific compliance scenarios to verify that the system handles them correctly.

**Location:** `banking_api_ui/src/components/BankingAgent.js` lines ~3275–3689 (handlers) and lines ~226–375 (CHIP_APPLICABLE_STEPS mapping)

## Test Chip Inventory

### 1. `test_wrong_scope` — Scope Rejection (RFC 6749 §3.3)

**What it tests:** Gateway denial when the user's token lacks required scopes.

**Compliance steps:**
- agent-llm-reasoning
- agent-token-init
- agent-scope-aware-cache

**Handler implementation (BankingAgent.js:3267–3335):**
```javascript
case "test_wrong_scope": {
  // Makes fetch to /api/mcp/tool with _testScope: "banking:admin"
  // Server gateway will reject (403) because user doesn't have admin scope
  // Handler captures audTestRes._httpStatus and audTestRes.missingScopes
  // Displays: "✅ Gateway correctly rejected (403): required_scopes=[...]"
}
```

**Key validation:**
- ✅ Checks for HTTP 403 status code (`audTestRes._httpStatus >= 400`)
- ✅ Captures `missingScopes` array from response
- ✅ Displays denied scopes in message: `required_scopes=[${missingScopes.join(", ")}]`
- ✅ Shows RFC 6749 compliance information

**Expected outcome:** User sees scope denial with gateway metadata, understands why the operation failed.

---

### 2. `test_wrong_audience` — Audience Mismatch (RFC 8693 §2.1 · RFC 8707)

**What it tests:** Token exchange fails when the audience (resource server) doesn't match.

**Compliance steps:**
- agent-llm-reasoning
- agent-token-init
- agent-scope-aware-cache
- bff-login-resume (if audience mismatch triggers re-auth)

**Handler implementation (BankingAgent.js:3337–3405):**
```javascript
case "test_wrong_audience": {
  // Makes fetch to /api/mcp/tool with _testAudience: "https://invalid-audience.example.com"
  // Server gateway will reject because audience doesn't match registered MCP server
  // Handler captures audTestRes._httpStatus and audTestRes.error
  // Displays: "✅ Gateway correctly rejected (XXX): <error>"
}
```

**Key validation:**
- ✅ Checks for HTTP 400+ status code (`audTestRes._httpStatus >= 400`)
- ✅ Captures error message from response
- ✅ Displays audience validation status in message
- ✅ Shows RFC 8693 and RFC 8707 compliance information

**Expected outcome:** User sees that invalid audience is properly rejected by the gateway.

---

### 3. `test_hitl_required` — Human-in-the-Loop Consent Gate

**What it tests:** High-value transfers (> $250) require explicit user consent before proceeding.

**Compliance steps:**
- agent-llm-reasoning
- agent-token-init
- agent-scope-aware-cache
- olb-resource-token (RFC 8693 token exchange)
- gw-scope-map (gateway validates scopes)
- gw-denial-metadata (gateway returns HITL threshold)
- bff-response-shape (BFF formats consent challenge response)
- gw-hitl-challenge-type (gateway signals consent_challenge_required)
- ui-gateway-consent (UI displays consent modal)
- ui-auto-refire (transfer re-fired after user approves)

**Handler implementation (BankingAgent.js:3406–3463):**
```javascript
case "test_hitl_required": {
  // Calls createTransfer(hitlFrom.id, hitlTo.id, 99999.99, "Test HITL threshold")
  // Amount $99,999.99 > $250 threshold triggers HITL gate
  // Handler adds explanatory message, then falls through to normalizeAgentToolResult
  // normalizeAgentToolResult checks: if (normalized.consent_challenge_required === true)
  // Shows AgentConsentModal with hitl_threshold_usd
  // User approves consent in modal
  // Agent re-fires transfer via createTransferWithConsent(consentChallengeId)
}
```

**Key validation:**
- ✅ Uses amount $99,999.99 to trigger HITL gate
- ✅ Extracts `hitl_threshold_usd` from response (should be 250 or configurable)
- ✅ Waits for user consent in modal
- ✅ Re-fires transfer after consent is approved
- ✅ Shows RFC-compliant HITL explanation

**Expected outcome:** User sees consent requirement, approves, and transfer completes after consent.

---

### 4. `test_otp_required` — Step-Up Authentication (RFC 9470)

**What it tests:** Sensitive operations require step-up MFA for high-value transactions (> $500).

**Compliance steps:**
- agent-llm-reasoning
- agent-token-init
- agent-scope-aware-cache
- olb-resource-token
- gw-scope-map
- gw-denial-metadata (step-up threshold)
- gw-hitl-challenge-type (gateway signals step_up_required)

**Handler implementation (BankingAgent.js:3600–3689):**
```javascript
case "test_otp_required": {
  // Sends agent message: "Show me my full account details with routing numbers"
  // This triggers the sensitive-account-details flow which requires step-up
  // Handler checks: if (stepUpRes.stepUpRequired)
  // Shows OtpStepUpModal or P1MFA modal (depending on step_up_method)
  // User enters OTP code
  // Agent resumes after MFA is verified
}
```

**Key validation:**
- ✅ Triggers step-up auth by requesting sensitive data
- ✅ Checks for `stepUpRequired === true` in response
- ✅ Shows appropriate MFA modal (OTP or P1MFA)
- ✅ Extracts `step_up_method` from response
- ✅ Displays RFC 9470 compliance information

**Expected outcome:** User is prompted for MFA verification, then sees sensitive account data after verification.

---

### 5. `demo_intent_delegation` — Intent-Bound Delegation with HITL

**What it tests:** Delegated agent actions must be scope/audience constrained and require explicit consent.

**Compliance steps:**
- agent-llm-reasoning
- agent-token-init
- agent-scope-aware-cache
- olb-resource-token (RFC 8693 token exchange with constraints)
- gw-scope-map (gateway validates delegated scopes)
- gw-denial-metadata (gateway returns HITL threshold + delegation context)
- bff-response-shape (BFF formats response with delegation metadata)
- gw-hitl-challenge-type (gateway signals HITL required for delegation)
- ui-gateway-consent (UI displays consent modal for delegated intent)
- ui-auto-refire (operation re-fired after user approves delegation)

**Handler implementation (BankingAgent.js:3465–3520):**
```javascript
case "demo_intent_delegation": {
  // Calls createTransfer(intentFrom.id, intentTo.id, 99999.99, "Intent-bound delegation demo")
  // Same HITL flow as test_hitl_required, but message emphasizes delegation constraints
  // Demonstrates RFC 8693 token narrowing (scope + audience constraints)
  // Shows that delegated intent is encoded in the MCP token
  // Requires HITL consent before proceeding
}
```

**Key validation:**
- ✅ Uses amount $99,999.99 to trigger HITL gate
- ✅ Explains RFC 8693 token constraints in message
- ✅ Shows HITL consent requirement for delegated intent
- ✅ User approves delegation in modal
- ✅ Transfer completes after consent

**Expected outcome:** User understands that delegated agent actions are narrowed by scope/audience and require explicit consent.

---

## Compliance Step Reference

Each test chip exercises a subset of the 12 compliance verification steps:

| Step | Description | Used by |
|------|-------------|---------|
| **agent-llm-reasoning** | LLM interprets natural language intent | All chips |
| **agent-token-init** | User OAuth token is initialized | All chips |
| **agent-scope-aware-cache** | Tokens cached by scope + audience | All chips |
| **gw-scope-map** | Gateway validates scopes in token | hitl, otp, intent |
| **olb-resource-token** | RFC 8693 token exchange performed | hitl, otp, intent |
| **gw-denial-metadata** | Gateway returns denial reason metadata | hitl, otp, intent |
| **bff-response-shape** | BFF formats structured response | hitl, intent |
| **gw-hitl-challenge-type** | Gateway signals HITL/step-up required | hitl, otp, intent |
| **ui-gateway-consent** | UI shows consent modal | hitl, intent |
| **ui-auto-refire** | Operation re-fired after consent | hitl, intent |
| **bff-login-resume** | Login redirect handled after reauth | audience |
| **claim-diagnostics** | Token claims analyzed | (regular tools, not test chips) |

---

## Threshold Validation

**CRITICAL: Transaction thresholds must be enforced correctly**

| Threshold | Amount | Requirement | Used by |
|-----------|--------|-------------|---------|
| HITL Consent | > $250 | Explicit user approval | test_hitl_required, demo_intent_delegation |
| MFA Step-Up | > $500 | User re-authentication (OTP/FIDO2) | test_otp_required |

**Important:** MFA threshold ($500) MUST be > HITL threshold ($250). If inverted, transfers can be executed without required consent.

### Threshold Configuration

Thresholds are stored in:
- **BFF:** `banking_api_server/services/transactionConsentChallenge.js` (HIGH_VALUE_CONSENT_USD_DEFAULT = 250)
- **BFF:** `banking_api_server/routes/transactions.js` (STEP_UP_THRESHOLD = 500)
- **UI:** `banking_api_ui/src/components/BankingAgent.js` (used for display in messages)

---

## Handler Testing Checklist

When adding or modifying test chips, verify:

### Gateway Denial Tests (test_wrong_scope, test_wrong_audience)
- [ ] Handler makes direct fetch call to `/api/mcp/tool` with test parameter
- [ ] Handler checks HTTP status code (`_httpStatus >= 400`)
- [ ] Handler captures error metadata from response (`missingScopes`, `error`, etc.)
- [ ] Handler displays metadata in message: `"✅ Gateway correctly rejected ..."`
- [ ] Token events are passed to TokenChainContext

### HITL Tests (test_hitl_required, demo_intent_delegation)
- [ ] Handler calls `createTransfer()` with $99,999.99 (triggers HITL)
- [ ] Handler adds explanatory message before calling transfer
- [ ] Response flows through `normalizeAgentToolResult()`
- [ ] Consent modal is shown (`setHitlPendingIntent()`)
- [ ] User can approve/deny in modal
- [ ] After approval, transfer re-fires with `consentChallengeId`

### Step-Up Tests (test_otp_required)
- [ ] Handler sends agent message to trigger sensitive-account-details
- [ ] Handler checks `stepUpRequired === true` in response
- [ ] OTP modal is shown (`setShowOtpModal(true)`)
- [ ] User can enter MFA code
- [ ] After verification, agent resumes operation

---

## Gateway Denial Flow

When the gateway rejects a request, the response should include:

```json
{
  "_httpStatus": 403,
  "error": "missing_exchange_scopes",
  "missingScopes": ["banking:admin"],
  "requiredScopes": "banking:read banking:write banking:admin",
  "userScopes": "banking:read banking:write",
  "tokenEvents": [...]
}
```

Or for audience errors:

```json
{
  "_httpStatus": 400,
  "error": "invalid_audience",
  "message": "Audience does not match registered resource server"
}
```

The test chip handlers MUST capture these fields and display them in the UI message.

---

## Regression Prevention

To prevent test chips from regressing:

1. **Unit Tests:** `BankingAgent.test.js` validates CHIP_APPLICABLE_STEPS mapping
2. **Integration Tests:** `BankingAgent.integration.test.js` validates handler structure
3. **Manual Testing:** Run each test chip and verify:
   - Correct compliance steps are exercised
   - Gateway denial metadata is displayed
   - Consent/MFA modals work correctly
   - Transactions complete after approval
4. **Code Review:** Verify handler changes don't skip compliance steps

---

## Common Issues & Fixes

### Issue: test_wrong_scope doesn't show gateway denial metadata
**Cause:** Handler doesn't capture `missingScopes` from response  
**Fix:** Add check: `scopeTestRes.missingScopes && scopeTestRes.missingScopes.length > 0`

### Issue: test_hitl_required shows modal but transfer doesn't complete
**Cause:** `consentChallengeId` not properly passed to `createTransferWithConsent()`  
**Fix:** Verify `setHitlPendingIntent()` is called and modal saves the correct `intentPayload`

### Issue: test_otp_required doesn't trigger MFA
**Cause:** Threshold configuration issue or flow not reaching gateway  
**Fix:** Check `test_otp_required` uses message that triggers sensitive-account-details, not direct transfer

### Issue: Gateway denial returns wrong HTTP status
**Cause:** BFF middleware not returning proper status code  
**Fix:** Verify `banking_api_server/routes/transactions.js` calls `res.status(403)` for denied requests

---

## References

- RFC 6749: OAuth 2.0 Authorization Framework (Scopes §3.3)
- RFC 8693: OAuth 2.0 Token Exchange (audience, resource indicators)
- RFC 8707: Resource Indicators for OAuth 2.0
- RFC 9470: OAuth 2.0 Step-Up Authentication Challenge Protocol
- `banking_api_ui/src/components/ComplianceModal.jsx` — displays compliance step progress
- `banking_api_server/routes/transactions.js` — HITL + MFA threshold enforcement
