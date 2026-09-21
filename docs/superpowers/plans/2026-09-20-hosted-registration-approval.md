# Hosted Registration Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an email-verified Ping employee registration queue with administrator approval before PingOne hosted access.

**Architecture:** A durable LMDB-backed registration service owns pending requests and PingOne MFA transaction state. Public BFF routes handle request, verify, and status; admin routes call an isolated PingOne provisioning adapter. React adds a public request page and an admin approval page without changing Demo User/Admin accounts.

**Tech Stack:** Node 22/CommonJS, Express, LMDB, Jest/Supertest, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-20-hosted-registration-approval-design.md`

## Global Constraints

- Accept only exact normalized `pingidentity.com` email domains.
- Never generate or store OTPs in the BFF; PingOne MFA owns the code and verification. Store and persist the applicant's E.164 cell number with first and last name, then write the profile and silently enroll the SMS MFA device to PingOne at approval.
- Do not mutate the existing Demo User/Admin session or login flows.
- Use the existing PingOne notification and management-service patterns.
- Public hosted registration routes must remain exact and narrowly scoped.

### Task 1: Durable registration and PingOne MFA domain

**Files:**
- Create: `demo_api_server/services/lmdb/hostedRegistrationStore.lmdb.js`
- Create: `demo_api_server/services/hostedRegistrationService.js`
- Test: `demo_api_server/src/__tests__/hostedRegistrationService.test.js`

- [x] Write tests for exact domain acceptance, PingOne MFA transaction start/verification, expiry/attempt limits, duplicate idempotency, and status transitions.
- [x] Implement the LMDB store and service with PingOne MFA transaction IDs and no OTP persistence.
- [x] Run the focused test and verify it passes.

### Task 2: Public registration routes and email delivery

**Files:**
- Create: `demo_api_server/routes/hostedRegistration.js`
- Modify: `demo_api_server/server.js`
- Modify: `demo_api_server/services/emailService.js`
- Test: `demo_api_server/src/__tests__/hostedRegistrationRoutes.test.js`

- [x] Write tests for request, verify, resend, status, cooldown, and rejection of non-Ping emails.
- [x] Implement exact public routes, PingOne MFA OTP delivery, and PingOne notification admin alerts.
- [x] Mount routes before the hosted gate and add only exact registration bypasses.
- [x] Run route and hosted-auth regression tests.

### Task 3: PingOne provisioning and admin API

**Files:**
- Create: `demo_api_server/services/hostedRegistrationProvisioningService.js`
- Create: `demo_api_server/routes/hostedRegistrationAdmin.js`
- Modify: `demo_api_server/server.js`
- Test: `demo_api_server/src/__tests__/hostedRegistrationAdmin.test.js`

- [x] Write tests for admin-only list/actions, idempotent approve, reject, enable/disable, role/group validation, and provisioning failures.
- [x] Implement the adapter using the existing PingOne management client and environment-configured population/group IDs; do not hardcode tenant identifiers.
- [x] Run focused admin and authz tests.

### Task 4: Public and admin UI

**Files:**
- Create: `demo_api_ui/src/pages/HostedRegistrationPage.jsx`
- Create: `demo_api_ui/src/pages/HostedRegistrationAdminPage.jsx`
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/routes/PublicRoutes.js`
- Test: `demo_api_ui/src/pages/__tests__/HostedRegistrationPage.test.jsx`
- Test: `demo_api_ui/src/pages/__tests__/HostedRegistrationAdminPage.test.jsx`

- [x] Write UI tests for email/OTP steps and admin actions.
- [x] Implement pages using existing API client and admin route conventions.
- [x] Run focused Vitest checks and the required UI build.

### Task 5: Gate, deployment, and verification

**Files:**
- Modify: `demo_api_server/services/hostedAccessPolicy.js`
- Modify: `demo_api_server/routes/hostedAccess.js`
- Modify: `demo_api_server/middleware/hostedAccessGate.js`
- Modify: `k8s/aws/se-ingress.yaml`
- Modify: `scripts/check-hosted-access-ingress.js`
- Modify: `k8s/README.md`

- [x] Add optional required-group evaluation and deployment configuration.
- [x] Add exact registration bypasses plus the required `/assets` static prefix for the public SPA.
- [x] Run hosted-access verification, focused auth tests, and the UI build.
