# HITL (Human-In-The-Loop) Comprehensive Testing & Fixes

## Current Issues

### 1. Architectural Problem: HITL Not Driven by Authorize
- **Current:** HITL gate runs FIRST (line 394 in transactions.js), then Authorize (line 490)
- **Should be:** Authorize policy determines if HITL needed, then HITL gate enforces
- **Impact:** Authorize cannot override HITL decisions; two independent systems

### 2. Documentation Inconsistencies
- Code default: $250
- Comments/docs: $500 (8+ places)
- MCP tool descriptions: $500 (wrong)

### 3. No User-Visible HITL Control
- `ff_hitl_enabled` flag exists (can disable all HITL)
- But no way to change threshold via UI
- Only default $250 is available

## Test Scenarios

### Scenario 1: HITL with User Settings OFF
- Set `ff_hitl_enabled` = false via Demo Controls
- Try: Withdrawal $600 (above all thresholds)
- Expected: Proceeds without consent challenge (PASS)
- Currently: FAILS (HITL gate ignores flag)

### Scenario 2: HITL Threshold Respected
- Set consent threshold $300 via Demo Controls
- Try: Withdrawal $350
- Expected: Consent challenge shown (PASS)
- Currently: Uses hardcoded $250 (FAILS if set to $300)

### Scenario 3: MCP Agent HITL Compliance
- Agent attempts transfer $600
- HITL gate blocks with 428 consent_challenge_required
- Agent sees compliance modal, user approves
- Agent resumes with consentChallengeId
- Expected: Transfer completes (PASS)

### Scenario 4: Authorize + HITL Integration
- Authorize policy says "DENY"
- Transaction fails at Authorize (not HITL)
- Expected: User sees Authorize denial, not consent modal (PASS)
- Currently: Might hit HITL first (architectural issue)

### Scenario 5: MCP Gateway HITL Path
- User → Agent (via MCP gateway) → BFF
- Agent calls create_transfer $600
- Gateway should:
  1. Exchange token
  2. Call /api/transactions
  3. Receive 428 consent_challenge_required
  4. Return error to Agent
- Agent should handle and show user consent challenge
- Expected: Full flow works (PASS)

## Fixes Required

### Priority 1: HITL Threshold Configurability
- [ ] Add `confirm_threshold_usd` to Demo Controls UI
- [ ] Read setting in transactions.js requiresHitl logic
- [ ] Test with multiple threshold values

### Priority 2: Fix Documentation (Hard References)
- [ ] educationTopics.js: Replace "$500" → dynamic threshold display
- [ ] middlewareHITLGateway.js: Update comment
- [ ] mcpLocalTools.js: 3x tool descriptions
- [ ] agentMcpTokenService.js: 2x descriptions

### Priority 3: Authorize Integration (Architectural)
- [ ] Document relationship between Authorize + HITL
- [ ] Ensure Authorize denial takes precedence
- [ ] Add tests for both policies

### Priority 4: Agent Compliance Testing
- [ ] Test agent handles 428 consent_challenge_required
- [ ] Verify compliance modal shows in floating agent
- [ ] Test oauthUser.js creates consent challenge
- [ ] Verify consentChallengeId consumed properly

## Test Coverage Checklist

- [ ] HITL flag toggle (on/off)
- [ ] HITL threshold respected at different amounts
- [ ] Admin bypass still works
- [ ] MCP local tools reject high-value txns
- [ ] Agent sees consent modal
- [ ] Gateway passes through 428 errors
- [ ] Step-up (MFA) still gates separately from HITL
- [ ] Authorize policy honored
