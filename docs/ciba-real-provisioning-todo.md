# CIBA Real Provisioning — Your Remaining Steps

Status as of 2026-09-23: the app now fails closed when real CIBA is unavailable.
Banking transaction approvals require the real PingOne result even if local
simulation is explicitly enabled for a generic CIBA walkthrough.
What's left is PingOne Admin Console + DaVinci provisioning. This file is a
standalone checklist for that. Full engineering plan
with rationale: `docs/superpowers/plans/2026-07-20-ciba-real-platform-provisioning.md`.

**Environment:** `01d89b06-66d5-430e-9f28-65636843788b` (region `com`,
`auth.pingone.com`). Do not touch app `8a711944-e625-42ce-af14-4d5a0825155a`
("Demo AI App - Admin Login") — that's the live login app, untouched by this
work on purpose.

**Code prerequisite:** `demo_api_server/services/cibaService.js` requires
`PINGONE_CIBA_CLIENT_ID` and `PINGONE_CIBA_CLIENT_SECRET` for the dedicated
CIBA app. The normal banking login app remains separate. Until provisioning
is complete, CIBA initiation returns `ciba_not_configured`.

---

## 1. Notification email templates

PingOne Admin Console → this environment → **User Experience > Notification Templates**.

**Template 1 — "with binding message":**
- Add Notification → Type: **General** → name: `CIBA with binding message` → Create
- Subject: `Authentication request from ${appName}`
- Body:
  ```html
  ${appName} wants to access your account.
  <p>
  Open this link in your browser to review the request: ${magicLink}
  <p>
  The authorization binding message for this request is ${bindingMessage}
  <p>
  If you do not recognize this request, ignore this email.
  <p>
  Request ID: ${authReqId}
  ```

**Template 2 — "without binding message":**
- Add Notification → Type: **General** → name: `CIBA without binding message` → Create
- Subject: `Authentication request from ${appName}`
- Body:
  ```html
  ${appName} wants to access your account.
  <p>
  Open this link in your browser to review the request: ${magicLink}
  <p>
  If you do not recognize this request, ignore this email.
  <p>
  Request ID: ${authReqId}
  ```

**Notification Policy ID:** go to **User Experience > Notification Policies**.
Copy an existing policy's ID, or create one (daily send limit ~50) and copy
its ID. Write it down — you need it in step 2.

- [ ] Template 1 created
- [ ] Template 2 created
- [ ] Notification Policy ID: ________________________

---

## 2. DaVinci CIBA flow

DaVinci UI, same environment.

1. Download the sample flow: https://marketplace.pingone.com/item/pingone-ciba
   → unzip → get `ciba-flow.json`.
2. DaVinci → **Flows** → **Add Flow** → **Import Flow** → upload `ciba-flow.json` → Import.
3. Open the imported flow → **More Options (⋮)** → **Flow Settings** → enable
   **PingOne Flow** toggle → enable **CIBA Flow** toggle → Save.
4. Find the **Binding message check** node:
   - **False path** → email node → gear icon → paste your Notification Policy
     ID from step 1 → Apply → Close → set **Notification Name** to
     `CIBA with binding message` → Apply → Close.
   - **True path** → email node → set **Notification Name** to
     `CIBA without binding message` → Apply → Close.
5. Save the flow, then **Deploy** it.
6. DaVinci → **Applications** tab → **Add Application** → name it
   `Demo AI App - CIBA (DaVinci)` → Create. Open it → **Flow Policy** tab →
   **Add Flow Policy** → name it `CIBA Step-Up Policy` → select
   **PingOne Flow Policy** → Next → check **Show only CIBA Flows** → select
   the imported flow, **Latest Version** → Next → weight `100` → Create Flow Policy.

- [ ] Flow imported
- [ ] Flow Settings toggles enabled (PingOne Flow + CIBA Flow)
- [ ] Both email nodes wired to the right template
- [ ] Flow saved and deployed
- [ ] `CIBA Step-Up Policy` flow policy created

---

## 3. Dedicated CIBA PingOne application

PingOne Admin Console → **Applications > Applications**.

1. **+** → Application Name: `Demo AI App - CIBA` → Application Type:
   **OIDC Web App** → Save.
2. **Configuration** tab → **Grant Type**: select **CIBA**, clear every other
   grant/response type that's pre-checked → **Token Endpoint Authentication
   Method**: **Client Secret Basic** → Save.
   (Must be Client Secret Basic — the code sends `Authorization: Basic
   base64(client_id:client_secret)`.)
3. **Policies** tab → **Add Policies** → **DaVinci Policies** tab → select
   `CIBA Step-Up Policy` (from step 2) → Save.
4. Confirm the app is **Enabled** (toggle at the top).
5. Copy the **Client ID** and **Client Secret** from this app (Configuration
   tab, or the API Access / Secrets area) — you need both for step 4.

- [ ] App created, Grant Type = CIBA only
- [ ] Token Endpoint Auth Method = Client Secret Basic
- [ ] Flow policy attached (Policies tab)
- [ ] App enabled
- [ ] Client ID: ________________________
- [ ] Client Secret: ________________________ (treat like any other secret — don't paste it in chat/Slack)

---

## 4. Set credentials and validate

Once steps 1-3 are done, come back and say so (you don't need to paste the
secret into the conversation — just confirm it's done, and set the two env
vars yourself, or tell Claude to set them and paste values only into the
`.env` file directly / via a secure channel):

```
# demo_api_server/.env
PINGONE_CIBA_CLIENT_ID=<client id from step 3.5>
PINGONE_CIBA_CLIENT_SECRET=<client secret from step 3.5>
```

### Optional: separate text-message (SMS) approval

PingOne's CIBA request has no "channel" field, so each delivery channel is its
own CIBA app with its own DaVinci flow policy. The email app above gets an
**email-only** flow; a second app gets an **SMS-only** flow:

1. Create a second OIDC app with the CIBA grant and `CLIENT_SECRET_BASIC`.
2. Import an SMS-only CIBA flow (the same sample flow with the two email nodes
   replaced by PingOne Notifications "Send SMS" nodes and the email-exists check
   turned into a phone-exists check), make a flow policy, and assign it to that app.
3. Put the second app's credentials in `.env`:

```
PINGONE_CIBA_SMS_CLIENT_ID=<second app client id>
PINGONE_CIBA_SMS_CLIENT_SECRET=<second app client secret>
```

`GET /api/auth/ciba/status` then lists `channels: ["email", "sms"]`, the step-up
picker shows "Approve by email link" and "Approve by text link", and
`POST /api/auth/ciba/initiate` accepts `channel: "email" | "sms"`. The poll uses
the credentials of the channel that created the request. With no SMS credentials
only the email row is offered.

The user needs a **Mobile phone** on their PingOne profile for the SMS flow, and
both the `CIBA with binding message` and `CIBA without binding message` General
templates need SMS content.

The live validation pass is:
- Keep `ciba_failover_mode=deny` (the default) so failures are visible
- Initiate a real CIBA request via the CIBAPanel "Try It" tab
- Confirm `auth_req_id` does **not** start with `sim-`
- Confirm the notification email arrives with the right template
- Approve it, confirm the poll flips to `approved`
- Check PingOne **Monitoring > Audit** for a **CIBA Authentication Succeeded** event
- Run a real transfer above the step-up threshold end-to-end

If CIBA initiation still fails after all of the above, the audit log's
**CIBA Authentication Failed** event detail is the fastest way to tell
whether it's the grant type, the flow policy attachment, or the notification
policy ID — check that before re-reading the whole plan.
