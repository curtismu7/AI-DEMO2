# Welcome-wizard invite + confirmation emails — design

**Status:** approved in chat by Curtis (2026-10-11) — PingOne-native copy; invites sent by the admin via a UI control.

## Problem

Onboarding a new SE today requires the PingOne admin console (Users → Invite
User) for the tenant invite email. Curtis wants email-driven onboarding
instead: an **invite email with a registration link**, and a **confirmation
email after registration completes**.

The registration page already exists: `/welcome?welcome=1` provisions the
customer + admin demo accounts (temp password, force-change, email+SMS MFA,
passkey) via `POST /api/demo/provision-wizard` (admin-gated,
`routes/demoProvisioning.js`).

## Design

### 1. Invite email (PingOne-native send)

**New endpoint:** `POST /api/demo/send-invite` (`requireAdmin`).

Body: `{ email }` — validated like provision-wizard's email check.

Flow (all inside `demoProvisioning.js`, reusing `getManagementToken()`):

1. Look up / create a **PENDING** user in env `01d89b06` with
   `username=email`, `email=email` (idempotent — same reuse logic as
   `provision-user`).
2. Trigger PingOne's native email by calling the **forgot-password /
   password-recovery** flow for that user
   (`application/vnd.pingidentity.password.forgot+json` or the invite
   equivalent — verify exact op name against the PingOne Password API during
   implementation; the code must fail loudly if PingOne rejects the call).
   PingOne emails the user from its own template — no SMTP infra for us.
3. Record the send: a `pingone_invite_sent` entry in the provisioning audit
   trail (same store provision-wizard uses).

The email the recipient gets points at the demo's sign-in; the email body
also needs the registration URL. PingOne templates allow a link/URL variable
— set it to `https://ai-demo.ping-devops.com/welcome?welcome=1`. If the
template variable turns out to be unsupported on the tenant's edition, fall
back to a plain-text line in the invite email the admin sends from the UI
(see 3) — decide in implementation, flag in the PR.

### 2. Confirmation email

Fired at the END of the existing `provision-wizard` handler after all steps
succeed: same PingOne native-email mechanism, a second template
("You're registered — sign in at https://ai-demo.ping-devops.com, your
customer + admin accounts are ready, Privilege console access comes
separately"). Failure to send must NOT fail provisioning — log + include
`confirmationEmail: 'failed'` in the response payload.

### 3. Admin UI control

Small "Invite user" control on the admin side (TopNav admin menu or the
config/admin page — pick the least-invasive spot consistent with existing
admin controls): one email field + Send. Calls `/api/demo/send-invite`.
Shows success/failure toast.

### 4. Scope cuts (YAGNI)

- No bulk invites, no custom HTML templates, no SMTP/SES/nodemailer.
- No queue/retry — PingOne's send is fire-and-forget; failure surfaces in
  the UI toast and audit log.
- No change to the wizard's provisioning logic itself.

## Testing

1. **Dress rehearsal with Curtis:** invite `cmuir@pingone.com` via the new
   control → verify email arrives → complete registration through
   `/welcome` → verify confirmation email.
2. Unit: endpoint validation (bad email → 400), idempotent re-invite,
   confirmation-email failure does not fail the wizard (Jest,
   `provisionWizard.route.test.js` pattern).
3. Then the real recipient: `matthewpollicove@pingidentity.com`.

## Open items for implementation

- Exact PingOne Password-API operation name for the invite/recovery email
  (verify against current docs; do not guess in code).
- Whether the PingOne email template supports an arbitrary URL variable on
  this tenant edition (fallback: admin-composed email line).
- Worker app needs `pia:environments::user:invite` or equivalent scope —
  check the worker app's current scopes in the tenant before coding.
