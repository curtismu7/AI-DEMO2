# Welcome-wizard Invite + Self-Service Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin clicks "Invite user" on an admin page, the endpoint idempotently pre-creates the invitee's PingOne customer account, and the admin gets a `/welcome?welcome=1` registration link to hand the invitee — with an optional PingOne-native "set your password" email (`password.sendRecoveryCode`) added only if the Task 1 spike proves the tenant supports it.

**Architecture:** Reuses the shipped `provisionWizardUser()` helper (`routes/demoProvisioning.js:146`) for idempotent user create-or-reuse — no forked lookup logic. New `requireAdmin` `POST /api/demo/send-invite` endpoint + a new `pingOneUserService.sendPasswordSetupEmail(userId)` (one axios call to `password.sendRecoveryCode`, behind the Task 1 spike). Admin UI is a small form on the existing `HostedRegistrationAdminPage`. No SMTP, no PingOne template roulette on day one.

**Tech Stack:** Node/Express + axios (server), React (HostedRegistrationAdminPage), Jest (server tests).

**Spec:** `docs/superpowers/specs/2026-10-11-wizard-invite-emails-design.md`

> **2026-10-12 REVISION — what changed from the original plan and why:**
>
> The welcome wizard shipped on 2026-10-11 (PR #1166, `sha-8f99e1346` live in prod): `POST /api/demo/provision-wizard` provisions customer + admin accounts with `forceChange` temp passwords, email+SMS MFA, banking seed. This revision re-scopes the remaining work around that reality and corrects the PingOne operations research:
>
> 1. **The original plan's invite operation was wrong.** `password.set` with `skipEmailVerification: false` is not an invite mechanism, and `password.sendRecoveryCode` emails a recovery OTP valid 5 minutes — a reset flow, not onboarding. The `user.invite` operation (`application/vnd.pingidentity.user.invite+json`) is admin-registration-only (`invite.isAdmin: true`). Verified against the current PingOne docs (send-admin-invite, password-resend-recovery-code, register-user pages). The spike (Task 1) now verifies only what is still unknown: worker-app scopes and registration-flow availability.
> 2. **The original Task 2 duplicated idempotency logic.** Its inline axios create-or-reuse would fork the pattern that now lives in `provisionWizardUser()`. The rewritten endpoint calls the shipped helper's building blocks instead.
> 3. **The confirmation email (original Task 3) is cut.** The invite link IS the registration path; a second PingOne-native email after provisioning adds template work for near-zero value. The wizard already returns credentials to the user in-session. If Curtis later wants a "you're registered" email, it is a 10-line non-fatal `sendPasswordSetupEmail` call — noted as an optional follow-up, not planned work.
> 4. **Discovery is no longer email-only.** `/welcome` is reachable via the onboarding email (live, GO), TopNav "Welcome" button, and the Learning Hub. The invite flow serves the "admin onboards a *specific* person" case, not general discovery.

## Global Constraints

- No new npm dependencies (spec scope cut).
- All new endpoints gated with `requireAdmin` from `../middleware/auth` (same as `provision-wizard`, `routes/demoProvisioning.js`).
- Invite endpoint must be IDEMPOTENT: inviting an existing email reuses the PingOne user, never creates a username collision (PingOne 409s on duplicates).
- The invite email is the ADMIN's send on day one — no dependency on PingOne email templates for the feature to work.
- `password.sendRecoveryCode` emails an 8-char recovery OTP valid 5 minutes — it may ONLY be used against an ENABLED user with a set password (i.e., the user our endpoint just provisioned). It is a "set your password" nudge, never the primary invite.
- No bulk invites, no custom HTML templates, no queue/retry (spec §4).
- PingOne env: `configStore.getEffective('pingone_environment_id') || 'PINGONE_ENVIRONMENT_ID'`; region from `pingone_region`/`PINGONE_REGION` default `com`.
- The shared main checkout is worked in by many sessions — run `git pull --ff-only origin main` before starting each task.
- Commit after every task; commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Review Focus

1. **Spam-as-a-service** — `/api/demo/send-invite` mints PingOne users; unauthenticated access is an account-creation oracle. Expect 401/403 without an admin session. Test in Task 2 (`sendInvite.route.test.js`, "403 without admin").
2. **Username collision on re-invite** — inviting the same email twice must reuse the existing PingOne user (shipped `provisionWizardUser` behavior), never 409. Test in Task 2 (idempotent re-invite asserts one create call for two invites).
3. **Recovery-code email against an unprovisioned user** — `password.sendRecoveryCode` fails for users with `NO_PASSWORD` or disabled accounts; the endpoint must not offer/attempt the native email for a user whose provisioning steps failed. Test in Task 2 (native-email skipped when provisioning steps contain errors).
4. **Invite UI leaking to non-admins** — the invite form on `HostedRegistrationAdminPage` calls an admin endpoint; the page itself is admin-gated, but the form must render disabled-with-message (not silently 403) for a session that lost admin. Covered by Task 4's error-path render check.
5. **Wrong registration link** — an invitee who gets a dead or sign-in-only link is stuck; the endpoint returns `registrationUrl` and the UI toast displays it verbatim for manual forwarding. Test in Task 2 (asserts `registrationUrl` contains `/welcome?welcome=1`); Task 4 asserts the toast renders the returned URL.

---

### Task 1: Spike — worker scopes + registration-flow availability (no product code)

**Files:**
- None committed. Findings recorded in this plan file (Task 2's `sendPasswordSetupEmail` step references them) and the PR description.

**Interfaces:**
- Produces: (a) whether the worker app can call `POST /users/{id}/password` with `application/vnd.pingidentity.password.sendRecoveryCode+json`, (b) whether the tenant has a PingOne registration flow usable for self-service (informational — the route chosen for this plan does not depend on it).

- [ ] **Step 1: Get a worker token**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server
node -e '
const { getManagementToken } = require("./services/pingOneClientService");
getManagementToken().then(t => { require("fs").writeFileSync("/tmp/worker-token.txt", t); console.log("token saved, length", t.length); }).catch(e => { console.error("FAIL", e.message); process.exit(1); });
'
```

Expected: `token saved, length …`. If it fails with worker-credential errors, stop and ask Curtis — do not proceed without the worker app.

- [ ] **Step 2: Probe `sendRecoveryCode` against a throwaway user**

Create a user via the shipped provisioning machinery (a real provisioned user has a set password and enabled=true — exactly the precondition `sendRecoveryCode` needs), then probe:

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server
TOKEN=$(cat /tmp/worker-token.txt)
export PINGONE_ENV_ID=$(grep '^PINGONE_ENVIRONMENT_ID=' .env | cut -d= -f2)
node -e '
const axios = require("axios");
const fs = require("fs");
const token = fs.readFileSync("/tmp/worker-token.txt","utf8").trim();
const env = process.env.PINGONE_ENV_ID;
const base = `https://api.pingone.com/v1/environments/${env}`;
const email = "invite-probe+delete@ping-devops.com";
const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
(async () => {
  let user;
  try {
    user = (await axios.post(`${base}/users`, { username: email, email, name: { given: "Invite", family: "Probe" }, enabled: true }, { headers: h })).data;
    console.log("user created:", user.id);
    await axios.put(`${base}/users/${user.id}/password`, { value: "ProbePass123!", forceChange: true },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/vnd.pingidentity.password.set+json" } });
    console.log("password set");
  } catch (e) { console.error("setup failed:", e.response?.status, JSON.stringify(e.response?.data).slice(0,300)); process.exit(1); }
  try {
    const r = await axios.post(`${base}/users/${user.id}/password`, {},
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/vnd.pingidentity.password.sendRecoveryCode+json" } });
    console.log("SEND-RECOVERY-CODE OK:", r.status, JSON.stringify(r.data).slice(0,200));
  } catch (e) { console.log("SEND-RECOVERY-CODE FAIL:", e.response?.status, JSON.stringify(e.response?.data).slice(0,300)); }
  try { await axios.delete(`${base}/users/${user.id}`, { headers: h }); console.log("probe user deleted"); } catch (e) { console.log("cleanup failed, delete manually:", user.id); }
})();
'
```

Expected: `SEND-RECOVERY-CODE OK: 204` (or 200). On 403: the worker lacks the password-management scope — record it, the native-email step ships as a no-op, and Task 2's `sendPasswordSetupEmail` gate defaults to off (Curtis can add the scope later; nothing else in this plan blocks).

- [ ] **Step 3: Check registration-flow availability (informational)**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server
TOKEN=$(cat /tmp/worker-token.txt)
curl -s -o /tmp/flows.json -w "%{http_code}\n" "https://api.pingone.com/v1/environments/$PINGONE_ENV_ID/flows" -H "Authorization: Bearer $TOKEN" --max-time 15
```

A 200 listing flows means the tenant has authentication-flow config (a registration flow may exist); 403/404 means flows are DaVinci-managed or invisible to the worker. Record either way — informational only.

- [ ] **Step 4: Record findings**

Append to this file under "Task 1 findings (filled 2026-10-XX)": the probe status, the response body shape, and the flows check result. Task 2's `NATIVE_EMAIL_ENABLED` default derives from this.

### Task 2: `sendPasswordSetupEmail()` + idempotent `POST /api/demo/send-invite`

**Files:**
- Modify: `demo_api_server/services/pingOneUserService.js` (add `sendPasswordSetupEmail` near `setUserPassword`, ~line 341)
- Modify: `demo_api_server/routes/demoProvisioning.js` (add endpoint after the `provision-wizard` route)
- Test: `demo_api_server/tests/sendInvite.route.test.js` (new)

**Interfaces:**
- Consumes: `pingOneUserService.initialize()`, `.searchUsers(username)`, `.createPingOneUser(userData)`, `.setUserPassword(userId, password, { forceChange })`, `.getAccessToken()` (all shipped); `generateTempPassword()` from `routes/demoProvisioning.js:129`; `configStore.getEffective()`.
- Produces: `pingOneUserService.sendPasswordSetupEmail(userId) → Promise<void>` (throws on non-2xx; a no-op that resolves when `NATIVE_EMAIL_ENABLED=false`). Endpoint `POST /api/demo/send-invite` body `{ email }` → `201 { userId, invite: 'sent', nativeEmail: 'sent'|'skipped'|'failed', registrationUrl }` | `400 { error: 'invalid_request' }` | `503 { error: 'management_token_failed' | 'pingone_invite_failed', message }`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/sendInvite.route.test.js`, mirroring the mock/admin-gate setup of `tests/provisionWizard.route.test.js` (it already solved `requireAdmin` in tests):

```javascript
'use strict';

// POST /api/demo/send-invite — admin-triggered invite. Idempotent user
// create-or-reuse via the shipped provisioning helpers; the PingOne-native
// "set your password" email is behind the Task 1 spike gate.

jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  searchUsers: jest.fn().mockResolvedValue({ _embedded: { users: [] } }),
  createPingOneUser: jest.fn().mockImplementation(async (u) => ({ id: 'user-1', email: u.email, username: u.username })),
  setUserPassword: jest.fn().mockResolvedValue(undefined),
  updatePingOneUser: jest.fn().mockResolvedValue({}),
  setMayActAttribute: jest.fn().mockResolvedValue(undefined),
  sendPasswordSetupEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/mfaService', () => ({
  enrollEmailDevice: jest.fn().mockResolvedValue({ id: 'd-e' }),
  enrollSmsDevice: jest.fn().mockResolvedValue({ id: 'd-s' }),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((k) => {
    if (k === 'pingone_mcp_token_exchanger_client_id') return 'mcp-exchanger-client';
    if (k === 'public_app_url' || k === 'PUBLIC_APP_URL') return 'https://ai-demo.ping-devops.com';
    return null;
  }),
  setConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../data/store', () => ({ seedAccountsForUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), logErrorHandling: jest.fn(), logAuthorizationAttempt: jest.fn() };
  return { logger, LOG_CATEGORIES: { USER_MANAGEMENT: 'user_management' } };
});

const express = require('express');
const request = require('supertest');
const pingOneUserService = require('../services/pingOneUserService');
const mfaService = require('../services/mfaService');
const dataStore = require('../data/store');
const sendInviteRouter = require('../routes/demoProvisioning');

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (user) req.user = user; next(); });
  app.use('/api/demo', sendInviteRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  pingOneUserService.searchUsers.mockResolvedValue({ _embedded: { users: [] } });
  pingOneUserService.createPingOneUser.mockImplementation(async (u) => ({ id: 'user-1', email: u.email, username: u.username }));
  pingOneUserService.setUserPassword.mockResolvedValue(undefined);
  pingOneUserService.updatePingOneUser.mockResolvedValue({});
  pingOneUserService.setMayActAttribute.mockResolvedValue(undefined);
  pingOneUserService.sendPasswordSetupEmail.mockResolvedValue(undefined);
  mfaService.enrollEmailDevice.mockResolvedValue({ id: 'd-e' });
  mfaService.enrollSmsDevice.mockResolvedValue({ id: 'd-s' });
  dataStore.seedAccountsForUser.mockResolvedValue(undefined);
});

describe('POST /api/demo/send-invite', () => {
  test('403 without an admin session', async () => {
    const res = await request(makeApp({ id: 'cust-1', role: 'customer' }))
      .post('/api/demo/send-invite').send({ email: 'a@pingidentity.com' });
    expect(res.status).toBe(403);
    expect(pingOneUserService.createPingOneUser).not.toHaveBeenCalled();
  });

  test('400 on invalid email', async () => {
    const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/send-invite').send({ email: 'nope' });
    expect(res.status).toBe(400);
  });

  test('201 with registrationUrl pointing at /welcome?welcome=1', async () => {
    const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/send-invite').send({ email: 'new@pingidentity.com' });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe('user-1');
    expect(res.body.invite).toBe('sent');
    expect(res.body.registrationUrl).toContain('/welcome?welcome=1');
    // Provisioned like a wizard customer: password with forceChange, MFA, banking seed
    expect(pingOneUserService.setUserPassword).toHaveBeenCalledWith('user-1', expect.any(String), { forceChange: true });
    expect(mfaService.enrollEmailDevice).toHaveBeenCalled();
    expect(dataStore.seedAccountsForUser).toHaveBeenCalledWith('user-1');
  });

  test('idempotent re-invite reuses the existing user (no 409)', async () => {
    pingOneUserService.searchUsers
      .mockResolvedValueOnce({ _embedded: { users: [] } })
      .mockResolvedValueOnce({ _embedded: { users: [{ id: 'existing-1', username: 'dup@pingidentity.com' }] } });
    const app = makeApp({ id: 'admin-1', role: 'admin' });
    await request(app).post('/api/demo/send-invite').send({ email: 'dup@pingidentity.com' });
    const res = await request(app).post('/api/demo/send-invite').send({ email: 'dup@pingidentity.com' });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe('existing-1');
    expect(pingOneUserService.createPingOneUser).toHaveBeenCalledTimes(1);
  });

  test('native email skipped when provisioning steps have errors', async () => {
    mfaService.enrollSmsDevice.mockRejectedValue(new Error('SMS policy missing'));
    const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/send-invite').send({ email: 'partial@pingidentity.com' });
    expect(res.status).toBe(201); // provisioning is partial, invite still works
    expect(res.body.nativeEmail).toBe('skipped');
    expect(pingOneUserService.sendPasswordSetupEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest tests/sendInvite.route.test.js --forceExit`
Expected: FAIL — 404 (endpoint does not exist yet). If the file fails to load, fix imports before proceeding.

- [ ] **Step 3: Implement `sendPasswordSetupEmail` in `pingOneUserService.js`**

Add after `setUserPassword` (~line 341). The module-level gate defaults from the Task 1 spike:

```javascript
  /**
   * Trigger PingOne's native "set your password" email (recovery code) for a
   * provisioned, enabled user with a set password. Recovery codes are valid
   * 5 minutes — this is a nudge, never the primary invite. Resolves as a
   * no-op when the worker app lacks the scope (Task 1 spike finding).
   * @see docs/superpowers/plans/2026-10-11-wizard-invite-emails.md Task 1
   */
  async sendPasswordSetupEmail(userId, { enabled = true } = {}) {
    if (!enabled) return; // spike said no scope — feature ships without native email
    const token = await this.getAccessToken();
    await axios.post(
      `${this.baseUrl}/users/${userId}/password`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/vnd.pingidentity.password.sendRecoveryCode+json',
        },
        timeout: 10000,
      }
    );
  }
```

(Read Task 1's findings first: if the probe failed 403, implement the body but have the endpoint pass `{ enabled: false }`; if it succeeded, pass `{ enabled: true }` or omit the option.)

- [ ] **Step 4: Implement the endpoint in `demoProvisioning.js`**

Add after the `provision-wizard` route. It reuses the shipped provisioning building blocks — the customer half of the wizard, nothing more:

```javascript
// POST /api/demo/send-invite — admin-triggered invite. Idempotently provisions
// the invitee's customer account (create-or-reuse, forceChange temp password,
// MFA, banking seed) and returns the /welcome registration link for the admin
// to hand over. Optional PingOne-native email behind the Task 1 spike gate.
router.post('/send-invite', requireAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid_request', message: 'A valid email is required' });
  }

  const mcpClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id')
    || configStore.getEffective('PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID');
  if (!mcpClientId) {
    return res.status(503).json({ error: 'not_configured', message: 'MCP token exchanger client ID not configured — run bootstrap' });
  }
  try {
    pingOneUserService.initialize();
  } catch (err) {
    return res.status(503).json({ error: 'not_configured', message: err.message });
  }

  const errors = {};
  const { user, steps } = await provisionWizardUser({
    email, username: email, cell: '', role: 'customer', mcpClientId, prefix: 'invite', errors,
  });
  if (!user?.id) {
    return res.status(503).json({ error: 'pingone_invite_failed', message: 'User provisioning failed' });
  }

  try { await dataStore.seedAccountsForUser(user.id); } catch (err) { errors.bankingData = err.message; }

  // Native "set your password" email only for a cleanly provisioned user —
  // sendRecoveryCode fails for users without a set password.
  let nativeEmail = 'skipped';
  const provisionClean = Object.keys(errors).length === 0
    && steps.emailOtp !== false && steps.smsOtp !== false;
  if (provisionClean) {
    try {
      await pingOneUserService.sendPasswordSetupEmail(user.id, { enabled: NATIVE_EMAIL_ENABLED });
      nativeEmail = NATIVE_EMAIL_ENABLED ? 'sent' : 'skipped';
    } catch (err) {
      console.error('[send-invite] native email failed:', err.message);
      nativeEmail = 'failed';
    }
  }

  const registrationUrl = `${configStore.getEffective('public_app_url') || configStore.getEffective('PUBLIC_APP_URL') || 'https://ai-demo.ping-devops.com'}/welcome?welcome=1`;
  return res.status(201).json({ userId: user.id, invite: 'sent', nativeEmail, registrationUrl });
});
```

Two wiring notes for the implementer:
- `provisionWizardUser` currently requires `cell` for SMS enrollment (`enrollSmsDevice(user.id, cell)`) — with `cell: ''` the SMS step will fail and set `errors.sms`. That is CORRECT for invites (the invitee has no phone on file); it feeds the "provisionClean" gate so the native email is skipped unless the invite flow is later extended to collect a cell. Do not "fix" this by generating a fake phone number.
- Define `NATIVE_EMAIL_ENABLED` as a module-level `const` next to `generateTempPassword()` (`routes/demoProvisioning.js:129`), set from Task 1's spike finding (`true` only if the probe returned 2xx). One line, with a comment pointing at Task 1.

- [ ] **Step 5: Run the tests until green**

Run: `cd demo_api_server && npx jest tests/sendInvite.route.test.js --forceExit`
Expected: PASS (5 tests).

Run: `cd demo_api_server && npx jest tests/provisionWizard.route.test.js --forceExit`
Expected: PASS (no regression in the shared file).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/pingOneUserService.js demo_api_server/routes/demoProvisioning.js demo_api_server/tests/sendInvite.route.test.js
git commit -m "feat(onboarding): admin invite endpoint — idempotent provisioning + registration link

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 3: Invite form on HostedRegistrationAdminPage

*(Original Task 4 — unchanged in substance, insert-point verified.)*

**Files:**
- Modify: `demo_api_ui/src/pages/HostedRegistrationAdminPage.jsx` (invite section between the `<h1>` at line 36 and the `<table>` at line 38; the page uses inline styles, not CSS files)

**Interfaces:**
- Consumes: `POST /api/demo/send-invite` (Task 2) via the page's existing `apiClient`.
- Produces: none (leaf UI).

- [ ] **Step 1: Add the invite section**

In `HostedRegistrationAdminPage.jsx`, add to the component's state (top of the function, after the existing `useState` lines):

```jsx
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteState, setInviteState] = useState(null); // {ok, message}

  async function sendInvite(e) {
    e.preventDefault();
    setInviteState(null);
    try {
      const response = await apiClient.post('/api/demo/send-invite', { email: inviteEmail });
      const native = response.data.nativeEmail === 'sent' ? ' A "set your password" email was also sent.' : '';
      setInviteState({ ok: true, message: `Invite ready — registration link (send it to the invitee): ${response.data.registrationUrl}.${native}` });
      setInviteEmail('');
    } catch (err) {
      setInviteState({ ok: false, message: err.response?.data?.message || 'Invite failed.' });
    }
  }
```

And in the JSX, between the `<h1>` (line 36) and the `<table>` (line 38):

```jsx
      <section style={{ marginBottom: '2rem' }}>
        <h2>Invite a user</h2>
        <form onSubmit={sendInvite} style={{ display: 'flex', gap: '0.5rem', maxWidth: '32rem' }}>
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@pingidentity.com"
            style={{ flex: 1, padding: '0.4rem' }}
          />
          <button type="submit">Send invite</button>
        </form>
        {inviteState && <p role="status" style={{ color: inviteState.ok ? 'green' : 'crimson' }}>{inviteState.message}</p>}
        <p style={{ fontSize: '0.85rem', color: '#555' }}>
          The invitee registers at <code>/welcome?welcome=1</code> — their account is created up front; they sign in and set a new password there.
        </p>
      </section>
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd demo_api_ui && npm run build 2>&1 | tail -5`
Expected: build completes without errors.

- [ ] **Step 3: Manual check against the local stack**

Start the local UI if not running, open the Hosted Registrations admin page as an admin, submit the form, and confirm: the success toast shows the full registration URL (copy-pasteable), and a failed submit shows the endpoint's error message rather than hanging. (A 503 from PingOne is an acceptable failure mode — the toast is the point.)

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/pages/HostedRegistrationAdminPage.jsx
git commit -m "feat(onboarding): admin invite-user form on hosted registrations page

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 4: Dress rehearsal + PR

*(Original Task 5, corrected: the pull_request CI trigger is alive again since 2026-10-11 — no manual dispatch needed; the per-service deploy is the validated path.)*

**Files:** None (verification + PR only).

**Interfaces:**
- Consumes: Tasks 1–3, CI, the SE cluster.

- [ ] **Step 1: CI green + merge**

Push the branch; pull_request CI runs normally (trigger fixed 2026-10-11 — never dispatch a second run while one is in flight, EDR-under-load kills them). Fix failures, merge when green.

- [ ] **Step 2: Deploy to the SE cluster (per-service only)**

```bash
GITHUB_OWNER=cmuir_pingcorp IMAGE_TAG=sha-$(git rev-parse --short origin/main) bash se-update-code.sh bff frontend
```

This rolls ONLY demo-api-server + frontend to the new tag — never run full `deploy.sh` for a two-service change (it patches the configmap cluster-wide and strands every other deployment in ImagePullBackOff; see the 2026-10-11 incident). Verify:

```bash
kubectl get deploy frontend demo-api-server -n ping-devops-cmuir -o jsonpath='{range .items[*]}{.metadata.name}={.spec.template.spec.containers[0].image}{"\n"}{end}'
curl -sk -o /dev/null -w '%{http_code}\n' https://ai-demo.ping-devops.com/welcome   # expect 200
```

- [ ] **Step 3: Dress rehearsal with Curtis's address**

Curtis (admin) opens Hosted Registrations → invites `cmuir@pingone.com` → the toast shows the registration link → if the Task 1 probe passed, the "set your password" email arrives within minutes (5-minute code validity — use it or request again) → Curtis follows the link to `/welcome`, signs in with the temp password from the credentials step, sets a new password, and lands on the dashboard.

- [ ] **Step 4: Update the onboarding email**

Edit `docs/runbooks/privilege-onboarding-email.md`: replace the manual PingOne console invite checklist items with "Curtis sends the invite from the Hosted Registrations admin page; the recipient follows the link." Commit.

- [ ] **Step 5: Final PR description + merge**

PR body: link the spec + this plan, note the Task 1 spike result (native email on/off and why), note the dress-rehearsal result. End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Task 1 findings (filled by the implementer)

*(To be appended after Task 1 runs — the plan is not self-consistent until this section has the probe result.)*

## Optional follow-up (cut from scope, noted for Curtis)

A "you're registered" confirmation email after `provision-wizard` succeeds: a non-fatal `sendPasswordSetupEmail(customer.user.id)` call in the wizard's response block with `confirmationEmail: 'sent'|'failed'|'skipped'` added to the payload (the UI ignores unknown fields). Ten lines. Cut because the invite link IS the registration path and the wizard already returns credentials in-session — revisit only if Curtis wants the touch.
