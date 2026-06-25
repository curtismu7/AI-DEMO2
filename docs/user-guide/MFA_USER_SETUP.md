# MFA Step-Up — Setup and Testing Guide

> Quick guide for enrolling MFA devices and testing step-up authentication in the Super Banking demo. Step-up is driven by the BFF (`demo_api_server`) using the PingOne **deviceAuthentications API**.

---

## Quick Start

To test step-up, you need:

1. A PingOne environment with MFA available
2. A configured PingOne worker app (client credentials with an MFA-capable role)
3. A test user logged into the demo
4. At least one enrolled MFA device (Email OTP is the easiest)

---

## How step-up works (and how it differs from HITL consent)

A transfer or withdrawal can be stopped by **two separate gates** — don't confuse them:

| Gate | Response | Meaning |
|------|----------|---------|
| **MFA step-up** | `step_up_required` (and `428` on the sensitive-details route) | The session needs a stronger ACR. The user elevates the **whole session** via deviceAuthentications. |
| **HITL consent** | `428` with `consentChallengeId` | PingOne Authorize asked for consent on **one specific transaction**. The user approves that transaction. |

So if a transfer returns `428` with a `consentChallengeId`, that's the HITL consent path, not an MFA prompt. MFA step-up elevates the session; HITL consent approves a single transaction.

---

## Step 1: Worker app and MFA policy

- **Worker token:** Server-side MFA calls use an OAuth `client_credentials` worker token. The token carries **no scopes** — access is granted by the **role** assigned to the worker app, not by OAuth scopes. Configure worker credentials via the Worker App tab at `/config` (or `PINGONE_WORKER_TOKEN_CLIENT_ID` / `_SECRET`).
- **MFA policy:** Resolved automatically. If `PINGONE_MFA_POLICY_ID` is unset, the BFF calls `GET /mfaPolicies` and auto-selects the **default** policy. You normally don't need to set a policy id.

---

## Step 2: Step-up thresholds (runtime settings — not env vars)

Thresholds are configured live in the admin **Security Settings** UI (no restart). They are stored in `demo_api_server/config/runtimeSettings.js`:

| Setting | Default | Meaning |
|---------|---------|---------|
| `stepUpEnabled` | `true` | Master switch for the step-up gate |
| `stepUpAmountThreshold` | `0` | Amount at/above which step-up applies. **`0` = ALL transfers/withdrawals step up.** |
| `stepUpWithdrawalsAlways` | `true` | Every withdrawal requires step-up regardless of amount |
| `stepUpTransactionTypes` | `['transfer','withdrawal']` | Types subject to step-up |
| `stepUpAcrValue` | `Multi_Factor` | Required ACR — the PingOne **Sign-On Policy name** (not a `urn:pingone:policy:...` value) |
| `stepUpMethod` | `email` | Trigger mechanism: `email`, `pingone-mfa`, or `ciba` |

With the defaults (`stepUpAmountThreshold = 0`, `stepUpWithdrawalsAlways = true`), **every transfer and every withdrawal triggers step-up** out of the box.

<!-- The old MFA_STEP_UP_THRESHOLD / HIGH_VALUE_TRANSACTION_THRESHOLD / PINGONE_MFA_BINDING_MESSAGE / CIBA_ENABLED env vars are no longer used. -->

---

## Step 3: Enroll an MFA device (Security Center)

Device management is in the **Security Center** at route **`/security`** (MFA tab).

1. Log in to the demo
2. Go to **`/security`** and open the **MFA** tab
3. Click **Add device** and choose a type:
   - **Email OTP** — code sent to your account email
   - **SMS OTP** — code texted to a phone (E.164, e.g. `+15551234567`)
   - **Authenticator App (TOTP)**
   - **Security Key (FIDO2)** — passkey / WebAuthn
4. Complete the type-specific enrollment (enter the OTP, or complete the WebAuthn prompt)

Notes:
- There are no "Mobile / Desktop / Hardware Key" categories — only the four types above.
- A PingOne **mobile push** device, if one already exists on the user's PingOne record, can be **consumed** during step-up but **cannot be enrolled** from this app (use the PingOne mobile app or admin portal).

---

## Step 4: Test step-up with the in-app MFA Test page

There is a built-in **MFA Test** page at route **`/mfa-test`**.

- The **magic test OTP is `123123`**. Submitting it (to `POST /api/auth/mfa/test/otp-verify`) marks the session step-up verified **without** calling PingOne. Any other value is rejected with `invalid_otp`.
- Use this for a deterministic demo of the elevated-session flow when you don't want to wait for a real OTP.

---

## Step 5: Test step-up via a transaction

Transactions go through `POST /api/transactions` (sensitive account data through `GET /api/accounts/sensitive-details`). There is **no** `/api/transfer` route.

### 5.1 Trigger step-up

1. Initiate a transfer or withdrawal (with defaults, any amount triggers step-up)
2. The sensitive request returns:

   ```json
   {
     "error": "step_up_required",
     "step_up_required": true,
     "step_up_method": "email"
   }
   ```

   `step_up_method` reflects the current `stepUpMethod` setting.
3. Complete the challenge (real OTP/FIDO2, or `123123` on the MFA Test page)
4. The transaction proceeds — the completed step-up elevates the session

### 5.2 Step-up validity window

After a `COMPLETED` step-up, the session is marked verified for **5 minutes** (`STEP_UP_TTL_MS` in `routes/mfa.js`). The flag is consumed (single-use) by the next sensitive operation, so each step-up authorizes one elevated action within that window.

---

## Step 6: Test the threshold behavior

Adjust step-up behavior in admin **Security Settings**, then retry:

1. Set `stepUpAmountThreshold` above your test amount and `stepUpWithdrawalsAlways` off → small transfers complete without step-up
2. Set `stepUpAmountThreshold` to `0` → all transfers/withdrawals require step-up
3. Toggle `stepUpEnabled` off → step-up gate is bypassed entirely

---

## Step-up challenge endpoints (reference)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/auth/mfa/challenge` | Initiate deviceAuthentications → `{ daId, status, devices[] }` |
| `PUT /api/auth/mfa/challenge/:daId` | `{ deviceId }` select · `{ deviceId, otp }` submit OTP · `{ assertion }` FIDO2 |
| `GET /api/auth/mfa/challenge/:daId/status` | Poll status (push; fetch FIDO2 request options) |
| `POST /api/auth/mfa/test/otp-verify` | Test mode: accepts `123123` |
| `GET /api/auth/mfa/devices` | List enrolled devices |
| `DELETE /api/auth/mfa/devices/:deviceId` | Remove a device |

---

## Automated test script

`scripts/test-mfa.js` exercises some MFA conditions over HTTP.

```bash
export API_URL=http://localhost:3001
export MFA_TEST_USER=mfa-test-user
export MFA_TEST_PASSWORD='TestPassword123!'
export MFA_TEST_EMAIL=test@example.com

node scripts/test-mfa.js             # default: runs the full suite
node scripts/test-mfa.js --test=otp  # run the suite (otp)
node scripts/test-mfa.js --test=fido2  # prints manual-browser guidance and exits
```

It writes a report to `test-results/mfa-test-results.json`.

<!-- TODO: verify scripts/test-mfa.js CLI — the script parses `--test=<value>` (with `=`, not a space); only otp/all actually run the suite, fido2 just prints guidance. Some of the script's assertions target endpoints that may not match current routes, so treat its pass/fail output with care. -->

---

## Troubleshooting

### No step-up prompt

- `stepUpEnabled` may be off, or the transaction type isn't in `stepUpTransactionTypes` — check admin **Security Settings**.

### `mfa_not_configured` (503)

- No policy id set and the default policy couldn't be resolved. Verify the worker app's **role** allows reading MFA policies, or set `PINGONE_MFA_POLICY_ID`.

### OTP not received

- Ensure you have an active Email/SMS OTP device enrolled in the Security Center; check spam; verify the contact on the PingOne user record.

### FIDO2 not available / fails

- Use a WebAuthn-capable browser; ensure a Security Key (FIDO2) device is enrolled; ensure the FIDO2 origin matches the app origin.

### Got a `428` with `consentChallengeId` instead of an MFA prompt

- That's the **HITL consent** gate (PingOne Authorize), not step-up. Complete the consent challenge for that transaction. See "How step-up works" above.

---

## Testing Checklist

Setup:

- [ ] Worker app configured with an MFA-capable role
- [ ] (Optional) `PINGONE_MFA_POLICY_ID` set, or default policy resolvable
- [ ] At least one MFA device enrolled in `/security`

Step-up:

- [ ] A transfer/withdrawal returns `step_up_required`
- [ ] `/mfa-test` accepts the `123123` test OTP
- [ ] Completed step-up lets the transaction proceed
- [ ] Step-up validity is ~5 minutes and single-use

Gates:

- [ ] Understand the difference between `step_up_required` (MFA) and `428 + consentChallengeId` (HITL consent)

---

## Support

- See [MFA_SETUP_GUIDE.md](MFA_SETUP_GUIDE.md) for the full setup and architecture
- Service code: `demo_api_server/routes/mfa.js`, `demo_api_server/services/mfaService.js`, `demo_api_server/config/runtimeSettings.js`
- Review server logs for `[MFA]` entries

---

**Last Updated:** June 8, 2026
