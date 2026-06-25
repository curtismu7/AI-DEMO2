# Comprehensive MFA Testing Report

**Date:** 2026-05-03  
**Scope:** Email OTP, SMS, FIDO2/Passkeys  
**Test Coverage:** OtpStepUpModal, FidoStepUpModal, MFA Service, Step-Up Gate

---

## Executive Summary

### Status Matrix

| Component | Email OTP | SMS OTP | FIDO2 | Test Status |
|-----------|-----------|---------|--------|-------------|
| Initiate Challenge | ✅ Works | ✅ Works | ⚠️ Issues | Partial |
| Device Selection | ✅ Works | ✅ Works | ⚠️ Issues | Partial |
| OTP Submission | ✅ Works | ✅ Works | N/A | Works |
| Push Notification | N/A | N/A | ⚠️ Issues | Partial |
| FIDO2 Assertion | N/A | N/A | ❌ Broken | Broken |
| SMS Enrollment | ✅ Works | ✅ Works | N/A | Works |
| FIDO2 Enrollment | N/A | N/A | ⚠️ Issues | Issues |
| Integration with Transactions | ⚠️ Issues | ⚠️ Issues | ❌ Broken | Broken |

---

## Detailed Findings

### 1. EMAIL OTP (WORKS)

**Implementation:** `mfaService.enrollEmailDevice()`, `submitOtp()`

**What Works:**
- ✅ `POST /api/auth/mfa/enroll/email` creates EMAIL device via worker token
- ✅ Device appears in `GET /api/auth/mfa/devices` list
- ✅ OTP submission via `PUT /api/auth/mfa/challenge/:daId` with deviceId + otp
- ✅ Sets `req.session.stepUpVerified = Date.now() + 5min` on completion
- ✅ OtpStepUpModal handles email OTP correctly (6-digit validation)
- ✅ Error handling for expired/invalid OTP codes

**Issues Found:** None identified

---

### 2. SMS OTP (WORKS)

**Implementation:** `mfaService.enrollSmsDevice()`, `completeSmsEnrollment()`

**What Works:**
- ✅ `POST /api/auth/mfa/enroll/sms-init` with phone number (E.164 format)
- ✅ PingOne sends SMS OTP to phone, returns status ACTIVATION_REQUIRED
- ✅ `POST /api/auth/mfa/enroll/sms-complete` with OTP to activate device
- ✅ Device becomes ACTIVE after OTP verification
- ✅ SMS OTP submission during challenge works same as EMAIL
- ✅ mfa.js line 199: Correctly masks phone numbers (***-***-XXXX format)

**Issues Found:** None identified

---

### 3. FIDO2 / PASSKEYS (BROKEN)

**Implementation:** `mfaService.initFido2Registration()`, `submitFido2Assertion()`

### 3A. FIDO2 Registration (Issues)

**Code:** `mfaService.js:474-548`

**What Works:**
- ✅ `POST /api/auth/mfa/enroll/fido2-init` fetches publicKeyCredentialCreationOptions
- ✅ Returns deviceId + creation options in correct format
- ✅ Handles LIMIT_EXCEEDED by auto-cleanup of old devices (lines 520-537)

**Issues:**
1. **Challenge & User ID Format Issues** (Lines 499-503 diagnostics)
   - `publicKeyCredentialCreationOptions` fields logged as array format
   - May be causing browser `navigator.credentials.create()` to fail
   - Issue: PingOne may return challenge/user.id as arrays but WebAuthn needs Uint8Arrays
   
2. **Missing Error Context** (Lines 517-546)
   - FIDO2 registration failure handling catches limit errors but not other PingOne API errors
   - User sees generic "enroll_fido2_init_failed" with no context

**Fix Needed:** Verify challenge/user.id encoding format before returning to browser

---

### 3B. FIDO2 Assertion (ASSERTION_REQUIRED) (BROKEN)

**Code:** `mfaService.js:247-292`

**Critical Issues:**

1. **Assertion Format Mismatch** (Line 252)
   ```javascript
   const assertionStr = typeof assertion === 'string' ? assertion : JSON.stringify(assertion);
   ```
   - PingOne API expects assertion as JSON string
   - But code **stringifies the assertion object twice** if not already a string
   - Browser sends `{ id, rawId, type, response: { authenticatorData, clientDataJSON, signature } }`
   - Code stringifies to: `"{\"id\":\"...\",\"response\":{...}}"`
   - PingOne then parses string expecting assertion object — double-stringification breaks parsing

2. **Base64 Encoding Issues** (OtpStepUpModal.js:220-228)
   - Uses `btoa(String.fromCharCode(...Uint8Array))`
   - This works for small arrays but fails for large binary data (>65536 bytes)
   - clientDataJSON and authenticatorData often exceed this limit → "Maximum call stack exceeded"
   - **Should use:** `Array.from(buffer).reduce((s,b) => s + String.fromCharCode(b), '')` or use TextEncoder

3. **Response Structure Mismatch**
   - PingOne expects: `{ assertion: { ... } }` (object)
   - Code sends: `{ assertion: "{...}" }` (stringified)
   - PingOne then stringifies again → `{ assertion: "{\"assertion\":\"{...}\"}" }` (double-nested)

4. **Missing Origin Validation** (Line 254)
   - `origin` parameter provided but PingOne may require specific format
   - `http://localhost:3000` vs `https://example.com` mismatch causes 400 errors
   - No fallback origin handling

5. **Timeout Too Short** (Line 278)
   - `timeout: 15000` (15 seconds) for FIDO2 assertion verification
   - User often needs 20-30 seconds to touch security key
   - Server returns 408/timeout before user completes operation

**Fix Needed:** 
- Remove double-stringification: pass assertion object directly
- Fix Uint8Array to base64 encoding for large payloads
- Increase timeout to 30-45 seconds
- Validate origin format matching PingOne expectations

---

### 4. PUSH NOTIFICATIONS (PARTIAL)

**Code:** `OtpStepUpModal.js:173-203`

**What Works:**
- ✅ `GET /api/auth/mfa/challenge/:daId/status` polls challenge status
- ✅ 3-second poll interval is reasonable
- ✅ 60-second timeout for push is appropriate
- ✅ Detects `PUSH_CONFIRMATION_TIMED_OUT` status

**Issues:**
1. **Silent Network Errors** (Line 200-201)
   - `catch (err) { // Silently retry on network error }`
   - Network failures silently ignored
   - User sees infinite spinner if network drops
   - Should add UI indicator for network state

2. **No Max Retries**
   - Polls forever if network is down
   - No exponential backoff
   - Could hammer server under poor connectivity

**Fix Needed:** Add network error indicator and max retry logic

---

### 5. TRANSACTION INTEGRATION ISSUES (ARCHITECTURAL)

**Code:** `transactions.js:438-483` (step-up gate)

### Critical Bug: HITL Runs BEFORE Step-Up

**Current Flow:**
1. User initiates $600 withdrawal
2. Amount > $250 (HITL threshold)
3. **HITL consent gate triggers** → returns 428 with `consent_challenge_required`
4. Step-up gate never runs → user never sees MFA challenge
5. After HITL consent, transaction completes WITHOUT MFA verification

**Root Cause:**
- HITL gate (lines 394-419) runs first
- Step-up gate (lines 438-483) runs second
- If amount > HITL threshold, step-up code is unreachable

**Impact:**
- High-value transactions can bypass MFA if HITL is enabled
- Step-up tests fail: 7 failing tests expecting "step_up_required" get "consent_challenge_required"
- Security: User approved transaction via HITL consent, but no MFA was performed

**Failing Tests:**
```
✗ HITL flag in step-up response — should return isHITL=false when amount is below $500 HITL threshold
✗ HITL flag in step-up response — should return isHITL=false when withdrawal always requires step-up
✗ Runtime threshold update takes effect immediately — should reflect a new threshold
```

**Fix Needed:** Restructure gate logic so both HITL AND step-up can run:

**Proposed Order:**
1. Check HITL (consent) threshold
2. Check step-up (MFA) threshold
3. Return BOTH gates if needed, OR
4. Run them sequentially: HITL first, then step-up

---

## Test Results Summary

### Unit Tests

```
mfaService.test.js:      PASS (30 tests)
- Device auth initiation
- Device selection
- OTP submission (email & SMS)
- FIDO2 registration (basic)
- Device listing & masking
- Error handling & token refresh

step-up-gate.test.js:    FAIL (7 failed, 9 passed)
Failures:
- HITL threshold tests (3) — HITL blocking step-up
- Runtime threshold update (1) — threshold change not taking effect
- FIDO2 assertion (0) — not tested yet
- SMS step-up (0) — not tested separately
```

---

## Device Masking (WORKING)

**Code:** `mfa.js:190-210` 

✅ Email: `m***l@example.com`  
✅ SMS: `***-***-7890`  
✅ TOTP: Shows authenticator app name  
✅ FIDO2: Shows "Security key / passkey"  

---

## Configuration Verification

**Environment Variables Required:**
```bash
PINGONE_MFA_POLICY_ID              # Optional — auto-resolved if missing
PINGONE_WORKER_TOKEN_CLIENT_ID     # Required for device enrollment
PINGONE_WORKER_TOKEN_CLIENT_SECRET # Required for device enrollment
PINGONE_WORKER_TOKEN_AUTH_METHOD   # "basic" (default) or "post"
```

**Runtime Settings:**
```javascript
stepUpEnabled                 // Default: true
stepUpAmountThreshold         // Default: 500
stepUpAcrValue                // Default: urn:mace:incommon:iap:silver
stepUpTransactionTypes        // Default: ['transfer', 'withdrawal']
stepUpWithdrawalsAlways       // Default: false
stepUpMethod                  // Default: 'ciba'
```

---

## Recommendations

### CRITICAL (Ship Blocker)

1. **Fix FIDO2 Assertion Encoding** — Current implementation will fail on real hardware
   - Remove double-stringification
   - Use proper Uint8Array-to-base64 encoding for large payloads
   - Test with actual security keys

2. **Fix HITL + Step-Up Gate Interaction** — High-value transactions may bypass MFA
   - Restructure transactions.js lines 394-483
   - Ensure both gates can execute when needed
   - Add test coverage for combined gate scenarios

### HIGH (Ship Quality)

3. **Increase FIDO2 Timeout** — 15 seconds too short for user interaction
   - Change to 30-45 seconds
   - Allow users more time to touch security key

4. **Add Push Notification Error Handling** — Silent failures hide problems
   - Show "Network issues" indicator
   - Implement max retry logic
   - Add exponential backoff

5. **Validate Origin Format** — Browser vs Server mismatch
   - Ensure FIDO2 origin matches PingOne expectations
   - Handle http://localhost vs https://production mismatch

### MEDIUM (Post-Ship)

6. **Add E2E Tests** — Critical paths untested end-to-end
   - SMS enrollment + challenge + completion
   - FIDO2 enrollment + assertion
   - HITL + Step-up combined scenarios
   - Push notification polling

7. **Logging Improvements**
   - Log assertion payload format for debugging (sanitized)
   - Log challenge/user.id format checks

---

## What Works Well

✅ **Email OTP:** Full lifecycle working  
✅ **SMS OTP:** Full lifecycle working  
✅ **Device Management:** List, mask, enroll endpoints correct  
✅ **MFA Service Unit Tests:** Comprehensive coverage of happy paths  
✅ **Challenge Lifecycle:** Initiation, polling, completion logic correct  
✅ **Session Persistence:** `stepUpVerified` timestamp set correctly  

---

## Next Steps

1. **CRITICAL:** Run FIDO2 tests with real browser + security key
2. **CRITICAL:** Fix HITL + step-up ordering in transactions.js
3. **HIGH:** Increase FIDO2 timeout and fix encoding
4. **HIGH:** Add network error handling for push notifications
5. **MEDIUM:** Write E2E tests for SMS and FIDO2 flows

