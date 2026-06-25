# MFA Test Plan — OTP and FIDO

## Overview

This test plan provides comprehensive testing procedures for Multi-Factor Authentication (MFA) in the Super Banking demo, focusing on OTP (One-Time Password) and FIDO2/WebAuthn methods.

## Test Objectives

- Verify OTP MFA flow works end-to-end
- Verify FIDO2 MFA flow works end-to-end
- Test MFA trigger conditions (high-value transactions, sensitive operations)
- Validate error handling and edge cases
- Ensure user experience is smooth and intuitive

## Prerequisites

- Super Banking demo application running locally or deployed
- PingOne environment configured with MFA policy
- Test user account with MFA device registered
- Test email account for OTP delivery
- FIDO2 security key (for FIDO2 testing)
- Browser supporting WebAuthn (Chrome, Firefox, Safari, Edge)

## Test Environment Setup

### 1. PingOne MFA Policy Configuration

Ensure the following are configured in PingOne:

**Policy Settings:**
- Policy Name: `Super Banking Step-Up MFA Policy`
- Policy Type: Device Authentication
- Required Factors: 1
- Allowed Methods: OTP, FIDO2, Push
- Session Lifetime: 15 minutes

**OTP Configuration:**
- OTP Length: 6 digits
- OTP Lifetime: 5 minutes
- Maximum Attempts: 3
- Lockout Duration: 15 minutes

**FIDO2 Configuration:**
- User Verification: Preferred
- Authenticator Attachment: Any
- Require Resident Key: No

### 2. Environment Variables

Set the following in `banking_api_server/.env`:

```env
PINGONE_MFA_POLICY_ID={your-policy-id}
PINGONE_MFA_ACR_VALUE=urn:pingone:policy:Super_Banking_Step_Up_MFA_Policy
PINGONE_MFA_BINDING_MESSAGE=Super Banking step-up authentication required
MFA_STEP_UP_THRESHOLD=500.00
HIGH_VALUE_TRANSACTION_THRESHOLD=1000.00
CIBA_ENABLED=true
```

### 3. Test User Setup

Create a test user in PingOne:
- Username: `mfa-test-user`
- Email: Test email account you can access
- Role: `customer` (or `admin` for admin-specific tests)

## Test Cases

### Test Case 1: OTP MFA — High-Value Transaction

**Objective:** Verify OTP MFA is triggered for transactions exceeding threshold.

**Steps:**
1. Log in as test user
2. Navigate to dashboard
3. Initiate a transfer for $600 (exceeds $500 threshold)
4. Observe MFA prompt appears
5. Check email for 6-digit OTP code
6. Enter OTP code in the MFA prompt
7. Verify transaction completes successfully

**Expected Results:**
- MFA prompt appears when transaction exceeds threshold
- OTP email is received within 30 seconds
- OTP code is 6 digits
- Entering correct OTP allows transaction to complete
- Transaction appears in transaction history

**Test Data:**
- Transfer amount: $600
- From account: Checking
- To account: Savings

**Success Criteria:**
- [ ] MFA prompt appears
- [ ] OTP email received
- [ ] OTP code accepted
- [ ] Transaction completes
- [ ] Transaction visible in history

---

### Test Case 2: OTP MFA — Wrong OTP

**Objective:** Verify error handling when incorrect OTP is entered.

**Steps:**
1. Log in as test user
2. Initiate high-value transaction ($600)
3. Enter incorrect OTP code (e.g., 123456)
4. Observe error message
5. Enter correct OTP code
6. Verify transaction completes

**Expected Results:**
- Incorrect OTP is rejected with clear error message
- User can retry with correct OTP
- After 3 failed attempts, account is temporarily locked

**Success Criteria:**
- [ ] Incorrect OTP rejected
- [ ] Error message is clear
- [ ] Retry allowed
- [ ] Correct OTP works after failed attempt

---

### Test Case 3: OTP MFA — Expired OTP

**Objective:** Verify expired OTP is rejected.

**Steps:**
1. Log in as test user
2. Initiate high-value transaction ($600)
3. Wait 6 minutes (OTP expires after 5 minutes)
4. Enter the expired OTP code
5. Observe error message
6. Request new OTP
6. Enter new OTP code
7. Verify transaction completes

**Expected Results:**
- Expired OTP is rejected with appropriate error message
- User can request new OTP
- New OTP works correctly

**Success Criteria:**
- [ ] Expired OTP rejected
- [ ] Error message indicates expiration
- [ ] New OTP can be requested
- [ ] New OTP works

---

### Test Case 4: FIDO2 MFA — High-Value Transaction

**Objective:** Verify FIDO2 MFA works for high-value transactions.

**Prerequisites:**
- FIDO2 security key registered to test user
- Browser supports WebAuthn

**Steps:**
1. Log in as test user
2. Navigate to Settings > Security
3. Ensure FIDO2 security key is registered
4. Navigate to dashboard
5. Initiate a transfer for $600
6. When MFA prompt appears, select FIDO2 method
7. Touch security key when prompted
8. Verify transaction completes successfully

**Expected Results:**
- FIDO2 option is available in MFA prompt
- Security key prompt appears in browser
- Touching key completes authentication
- Transaction completes successfully

**Success Criteria:**
- [ ] FIDO2 option available
- [ ] Browser prompts for security key
- [ ] Touching key authenticates
- [ ] Transaction completes

---

### Test Case 5: FIDO2 MFA — No Key Registered

**Objective:** Verify error handling when FIDO2 selected but no key registered.

**Steps:**
1. Log in as test user
2. Navigate to Settings > Security
3. Remove all FIDO2 keys (if any)
4. Navigate to dashboard
5. Initiate a transfer for $600
6. When MFA prompt appears, select FIDO2 method
7. Observe error message
8. Switch to OTP method
9. Complete transaction with OTP

**Expected Results:**
- Clear error message when no key registered
- User can switch to alternative MFA method
- Transaction completes with alternative method

**Success Criteria:**
- [ ] Error message clear
- [ ] Method switch allowed
- [ ] Alternative method works

---

### Test Case 6: MFA — Below Threshold Transaction

**Objective:** Verify MFA is NOT triggered for transactions below threshold.

**Steps:**
1. Log in as test user
2. Navigate to dashboard
3. Initiate a transfer for $200 (below $500 threshold)
4. Observe transaction completes without MFA prompt
5. Verify transaction appears in history

**Expected Results:**
- No MFA prompt for low-value transactions
- Transaction completes immediately
- Transaction visible in history

**Success Criteria:**
- [ ] No MFA prompt
- [ ] Transaction completes
- [ ] Transaction visible in history

---

### Test Case 7: MFA — Sensitive Data Access

**Objective:** Verify MFA is triggered for sensitive data access.

**Steps:**
1. Log in as test user
2. Navigate to Settings > Security
3. Attempt to view full account details (sensitive operation)
4. Observe MFA prompt
5. Complete MFA (OTP or FIDO2)
6. Verify sensitive data is displayed

**Expected Results:**
- MFA triggered for sensitive data access
- After MFA completion, sensitive data is accessible

**Success Criteria:**
- [ ] MFA triggered
- [ ] Data accessible after MFA

---

### Test Case 8: MFA — Session Persistence

**Objective:** Verify MFA session persists for configured duration.

**Steps:**
1. Log in as test user
2. Complete MFA for high-value transaction
3. Initiate another high-value transaction within 10 minutes
4. Observe no additional MFA prompt (session still valid)
5. Wait 16 minutes (session expires after 15 minutes)
6. Initiate another high-value transaction
7. Observe MFA prompt appears again

**Expected Results:**
- MFA session persists for 15 minutes
- After expiration, MFA is required again

**Success Criteria:**
- [ ] No MFA within session
- [ ] MFA required after expiration

---

### Test Case 9: MFA — Multiple Failed Attempts

**Objective:** Verify account lockout after multiple failed MFA attempts.

**Steps:**
1. Log in as test user
2. Initiate high-value transaction
3. Enter incorrect OTP 3 times
4. Observe account lockout message
5. Wait 15 minutes (lockout duration)
6. Try again with correct OTP
7. Verify transaction completes

**Expected Results:**
- After 3 failed attempts, account is locked
- Lockout message is clear
- After lockout duration, user can retry

**Success Criteria:**
- [ ] Lockout after 3 failures
- [ ] Clear lockout message
- [ ] Retry allowed after duration

---

### Test Case 10: MFA — Device Registration Flow

**Objective:** Verify device registration for MFA.

**Steps:**
1. Log in as test user
2. Navigate to Settings > Security
3. Click "Register New Device"
4. Select device type (e.g., Mobile)
5. Follow registration flow
6. Verify device appears in registered devices list
7. Test MFA with newly registered device

**Expected Results:**
- Device registration flow works smoothly
- Registered device appears in list
- MFA works with new device

**Success Criteria:**
- [ ] Registration successful
- [ ] Device in list
- [ ] MFA works with device

---

## Test Script

Automated test script available at: `scripts/test-mfa.js`

Usage:
```bash
node scripts/test-mfa.js
```

The script will:
- Test OTP MFA flow
- Test FIDO2 MFA flow
- Test threshold triggers
- Test error handling
- Generate test report

## User Setup Guide

For users who want to set up and test MFA themselves, see: [USER_GUIDE.md](user-guide/USER_GUIDE.md) §2 Multi-Factor Authentication (MFA)

## Test Execution Checklist

Before running tests:
- [ ] PingOne MFA policy configured
- [ ] Environment variables set
- [ ] Test user account created
- [ ] Test email account accessible
- [ ] FIDO2 security key available (for FIDO2 tests)
- [ ] Browser supports WebAuthn
- [ ] Application running locally or deployed

During testing:
- [ ] Document any issues encountered
- [ ] Capture screenshots of errors
- [ ] Note performance metrics
- [ ] Record browser console errors

After testing:
- [ ] Review test results
- [ ] Document pass/fail for each test case
- [ ] Report any bugs or issues
- [ ] Update documentation if needed

## Reporting

Test results should be reported with:
- Test case name
- Pass/fail status
- Actual vs expected results
- Screenshots of failures
- Browser console errors
- Server logs (if applicable)
- Steps to reproduce failures

## Success Metrics

- All test cases pass
- MFA flows work smoothly
- Error handling is robust
- User experience is intuitive
- No browser console errors
- No server errors

## Known Issues

Document any known issues or limitations:

1. [Issue description]
   - Impact: [High/Medium/Low]
   - Workaround: [Description]
   - Status: [Open/In Progress/Resolved]

## References

- [MFA_SETUP_GUIDE.md](user-guide/MFA_SETUP_GUIDE.md) — Detailed MFA configuration
- [USER_GUIDE.md](user-guide/USER_GUIDE.md) — User-facing MFA guide
- [PINGONE_RESOURCES_AND_SCOPES_MATRIX.md](PINGONE_RESOURCES_AND_SCOPES_MATRIX.md) — Scope configuration

---

**Last Updated:** April 10, 2026
**Version:** 1.0
