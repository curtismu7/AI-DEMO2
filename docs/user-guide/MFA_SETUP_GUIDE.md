# PingOne MFA Step-Up Setup Guide

## Overview

This guide explains how MFA step-up authentication works in the Super Banking demo and how to configure it. Step-up is driven by the **BFF** (`demo_api_server`) calling the PingOne **deviceAuthentications API** on the user's behalf. It elevates a session before sensitive operations (e.g. transfers, withdrawals, revealing full account numbers).

## Implementation Approach

The demo uses PingOne's **deviceAuthentications API** as a server-driven challenge/select/submit flow:

1. The BFF creates a device authentication (`POST /deviceAuthentications`) for the logged-in user.
2. The user selects an enrolled device (email OTP, SMS OTP, authenticator app / TOTP, or security key / FIDO2).
3. The user submits the proof (OTP code, or a WebAuthn assertion for FIDO2).
4. On `COMPLETED`, the BFF marks the session step-up verified for a short window.

The MFA endpoints live under `/api/auth/mfa` (see `demo_api_server/routes/mfa.js`, backed by `demo_api_server/services/mfaService.js`).

> **Note on step-up methods.** The deviceAuthentications flow is the architecture. The `stepUpMethod` runtime setting selects which mechanism a step-up trigger uses:
> - `email` (default) — OIDC re-authentication redirect
> - `pingone-mfa` — the deviceAuthentications challenge described above
> - `ciba` — Client Initiated Backchannel Authentication (optional, one method among the three; **not** the architecture)

## HITL Consent vs. MFA Step-Up — two separate gates

A transfer or withdrawal can be stopped by **two different gates**, and it's important not to confuse them:

| Gate | Trigger | HTTP response | What the user does |
|------|---------|---------------|--------------------|
| **HITL consent** | PingOne Authorize (or simulated) returns a consent obligation for the transaction | `428` with `consentChallengeId` (plus transaction snapshot) | Approves the specific transaction via a consent challenge (OTP / device approval) |
| **MFA step-up** | Session lacks the required ACR for a sensitive action | `step_up_required` / `step_up_required: true` (and `428` from the sensitive-details route) | Elevates the whole session via deviceAuthentications |

In short: **HITL consent approves one transaction; MFA step-up elevates the session.** A transfer may return a `428` consent challenge instead of an MFA prompt because the Authorize gate ran first and asked for transaction consent. The consent flow lives in `demo_api_server/routes/transactions.js` (`/consent-challenge/*`); the step-up flow lives in `routes/mfa.js`.

## Prerequisites

- A PingOne environment with administrative access
- The Super Banking demo applications already configured
- PingOne MFA available in your environment
- A configured PingOne worker app (client credentials) — see "Worker token" below

## Architecture

```
User initiates sensitive action (transfer / withdrawal / reveal account number)
        |
        v
BFF Authorize gate runs first
        |
        ├── consent obligation → HTTP 428 + consentChallengeId  (HITL consent path)
        |
        └── needs stronger ACR → step_up_required               (MFA step-up path)
                |
                v
        BFF POST /deviceAuthentications  (user access token, policy id)
                |  status: DEVICE_SELECTION_REQUIRED
                v
        User selects device → OTP_REQUIRED | ASSERTION_REQUIRED | PUSH_CONFIRMATION_REQUIRED
                |
                v
        User submits OTP / FIDO2 assertion (or approves push)
                |  status: COMPLETED
                v
        BFF marks req.session.stepUpVerified for 5 minutes; original action proceeds
```

## Part 1 — MFA Policy

The MFA policy is resolved from PingOne automatically:

- If `PINGONE_MFA_POLICY_ID` is set, that policy is used.
- If it is **unset**, the BFF calls `GET /mfaPolicies` and auto-selects the environment's **default** policy (`mfaService.js` → `_getDefaultMfaPolicy`).

So for most setups you do **not** need to create or specify a policy ID — the default works. Only set `PINGONE_MFA_POLICY_ID` if you want a non-default policy.

## Part 2 — Worker token

Server-side MFA operations (device selection, OTP verification, status reads, and Management-API device management) use a **worker token** obtained via the OAuth `client_credentials` grant.

- The worker token carries **no scopes**. PingOne Management / MFA access is determined by the **role assigned to the worker application**, not by OAuth scopes.
- Credentials are read from `PINGONE_WORKER_TOKEN_CLIENT_ID` / `PINGONE_WORKER_TOKEN_CLIENT_SECRET` (falling back to the management client credentials configured via the Worker App tab at `/config`).

## Part 3 — Step-up thresholds (runtime settings)

Thresholds are **runtime settings**, not environment variables. They are edited live in the admin **Security Settings** UI (no restart) and stored in `demo_api_server/config/runtimeSettings.js`.

| Setting | Default | Meaning |
|---------|---------|---------|
| `stepUpEnabled` | `true` | Master switch for the step-up gate. When off, all transactions bypass step-up. |
| `stepUpAmountThreshold` | `0` | Transfers/withdrawals at or above this amount require step-up. **`0` means ALL such transactions step up.** |
| `stepUpWithdrawalsAlways` | `true` | When true, **every** withdrawal requires step-up regardless of the amount threshold. |
| `stepUpTransactionTypes` | `['transfer','withdrawal']` | Which transaction types are subject to step-up. |
| `stepUpAcrValue` | `Multi_Factor` | Required ACR. This is the PingOne **Sign-On Policy name** (e.g. `Multi_Factor`) — **not** a `urn:pingone:policy:...` value. |
| `stepUpMethod` | `email` | Mechanism for the trigger: `email`, `pingone-mfa`, or `ciba`. |

Because the defaults are `stepUpAmountThreshold = 0` and `stepUpWithdrawalsAlways = true`, **out of the box every transfer and every withdrawal triggers step-up** — convenient for demos.

<!-- The old PINGONE_MFA_BINDING_MESSAGE, MFA_STEP_UP_THRESHOLD, and HIGH_VALUE_TRANSACTION_THRESHOLD env vars are no longer used. Configure thresholds via Security Settings. -->

## Part 4 — Device enrollment (Security Center)

Users manage their MFA devices in the **Security Center** at route **`/security`** (component `demo_api_ui/src/components/SecurityCenter.js`, MFA tab).

Enrollable device types:

- **Email OTP** — code sent to the account email
- **SMS OTP** — code texted to a phone (E.164 format)
- **Authenticator App (TOTP)**
- **Security Key (FIDO2)** — passkey / WebAuthn

Notes:
- A PingOne **mobile push** device, if one already exists on the user's PingOne record, can be **consumed** during step-up, but it **cannot be enrolled** from this app (use the PingOne mobile app or admin portal).
- Email enrollment endpoints: `POST /api/auth/mfa/enroll/email` then `POST /api/auth/mfa/enroll/email/verify`.
- SMS enrollment endpoints: `POST /api/auth/mfa/enroll/sms-init` then `POST /api/auth/mfa/enroll/sms-complete`.
- FIDO2 enrollment endpoints: `POST /api/auth/mfa/enroll/fido2-init` then `POST /api/auth/mfa/enroll/fido2-complete`.

## Part 5 — Step-up challenge endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/auth/mfa/challenge` | Initiate deviceAuthentications. Returns `{ daId, status, devices[] }` (status `DEVICE_SELECTION_REQUIRED`). |
| `PUT /api/auth/mfa/challenge/:daId` | Body `{ deviceId }` selects a device; `{ deviceId, otp }` submits an OTP; `{ assertion }` relays a FIDO2 assertion. |
| `GET /api/auth/mfa/challenge/:daId/status` | Poll status (used for push and to fetch FIDO2 request options). |

On `COMPLETED`, the BFF sets `req.session.stepUpVerified` to **5 minutes** in the future (`STEP_UP_TTL_MS` in `routes/mfa.js`). The flag is consumed (single-use) by the next sensitive operation, so each step-up authorizes one elevated action within that window.

## Part 6 — Testing step-up

### In-app MFA Test page

There is a built-in **MFA Test** page at route **`/mfa-test`**. For testing, the **magic OTP value is `123123`** — submitting it to `POST /api/auth/mfa/test/otp-verify` marks the session step-up verified without calling PingOne. Any other value is rejected.

### Triggering step-up via a transfer

Transactions go through `POST /api/transactions` (and sensitive account data through `/api/accounts/sensitive-details`). There is **no** `/api/transfer` route.

A sensitive request that needs elevation returns:

```json
{
  "error": "step_up_required",
  "step_up_required": true,
  "step_up_method": "email"
}
```

`step_up_method` reflects the current `stepUpMethod` runtime setting. (Note: this is distinct from the HITL consent `428 + consentChallengeId` response described above.)

### Automated test script

`scripts/test-mfa.js` exercises some MFA conditions over HTTP.

```bash
# Optional environment overrides
export API_URL=http://localhost:3001
export MFA_TEST_USER=mfa-test-user
export MFA_TEST_PASSWORD='TestPassword123!'
export MFA_TEST_EMAIL=test@example.com

node scripts/test-mfa.js            # default: runs the full suite
node scripts/test-mfa.js --test=otp # run the suite (otp)
node scripts/test-mfa.js --test=fido2  # prints manual-browser guidance and exits
```

<!-- TODO: verify scripts/test-mfa.js CLI — the script parses `--test=<value>` (with `=`); only otp/all run the suite, fido2 exits with guidance. Some assertions in the script target endpoints that may not match current routes; treat its pass/fail output with care. -->

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| No step-up prompt | `stepUpEnabled` is off, or the transaction type isn't in `stepUpTransactionTypes` | Enable step-up and check the type list in Security Settings |
| `mfa_not_configured` (503) | No policy id set and default policy could not be resolved | Verify the worker app role allows reading MFA policies, or set `PINGONE_MFA_POLICY_ID` |
| OTP not received | No active OTP device, or delivery issue | Enroll an Email/SMS OTP device in the Security Center; check spam |
| FIDO2 fails | Browser/key compatibility or origin mismatch | Use a WebAuthn-capable browser; ensure the FIDO2 origin matches the app origin |
| Worker token errors | Worker credentials missing or wrong role | Configure the worker app at `/config`; ensure its **role** (not scopes) grants Management/MFA access |
| Getting a `428` with `consentChallengeId` instead of an MFA prompt | The Authorize HITL consent gate fired first | Complete the consent challenge; this is the HITL path, not step-up (see the two-gates section) |

## Verification Checklist

- [ ] Worker app configured with a role that allows MFA/Management API access
- [ ] (Optional) `PINGONE_MFA_POLICY_ID` set, or default policy resolvable
- [ ] At least one MFA device enrolled in the Security Center
- [ ] Step-up settings reviewed in admin Security Settings
- [ ] A transfer/withdrawal returns `step_up_required` (or `428` consent, per gate)
- [ ] `/mfa-test` page accepts the `123123` test OTP
- [ ] Completed step-up elevates the session for ~5 minutes

---

**Related Documentation:**
- [PingOne Device Authentication](https://docs.pingidentity.com/pingone/p1_cloud__device-authentication_main_landing_page.html)
- Service code: `demo_api_server/routes/mfa.js`, `demo_api_server/services/mfaService.js`, `demo_api_server/config/runtimeSettings.js`
