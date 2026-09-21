# Hosted Registration Approval Design

## Goal

Allow previously unknown Ping employees to request access without granting access until an administrator approves the request.

## Rules

- Registration accepts only addresses whose normalized domain is exactly `pingidentity.com`.
- The applicant must provide first name, last name, country calling code, and local cell number. The service normalizes the combined phone number to E.164, then the applicant proves control of the address with a short-lived, single-use email OTP.
- OTP verification creates or advances a pending request; it never creates an approved application session.
- The existing Demo User/Admin application accounts remain unchanged.
- The approval queue is durable and administrator-only.
- Approval enables or provisions the PingOne identity, assigns the selected hosted-access group, and sends activation instructions.
- Rejection, disablement, and expiration remove hosted access and invalidate admission sessions.

## Architecture

The public request flow is served by the BFF at `/api/auth/hosted-registration/*`, outside the hosted application gate. Requests are stored in a dedicated LMDB database. A disabled PingOne user is staged in the Partial group before a PingOne MFA email one-time-passcode transaction is started; the MFA transaction ID and local expiry/attempt metadata are stored, but the OTP itself is never generated or stored by the BFF. The submitted name and normalized international cell number are written to PingOne at approval, including for an existing PingOne user, and a worker-token SMS MFA device is silently enrolled at that point. PingOne Notifications is used only for the administrator alert; no SMTP service is required.

The administrator API is mounted under `/api/admin/hosted-registrations` and uses the existing application `authenticateToken` plus `requireAdmin` guards. It supports list, approve, reject, enable/disable, group/role update, resend, and audit-safe status changes. PingOne provisioning is isolated behind a service so the queue remains testable without live PingOne calls.

The front-door hosted-access decision will require the approved group claim in addition to verified `pingidentity.com` email. Until group provisioning is configured, the existing domain-only behavior remains available only when the new group requirement flag is disabled.

## UI

- Public `/request-access` page: name, email, requested role, OTP entry, and status message.
- Admin `/admin/hosted-registrations` page: filterable status table and approval actions.
- Public registration routes are exact ingress bypasses; admin routes remain behind the existing application session and hosted admission gate.

## Safety

- Never log OTPs, passwords, activation tokens, or raw approval links.
- Use generic responses for unknown/duplicate email addresses.
- Rate-limit request, resend, and verify operations.
- Approval is idempotent and records the acting application admin, timestamp, selected groups, and PingOne result.
