# Welcome-wizard Invite + Confirmation Emails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin sends an invite email (PingOne-native) pointing at `/welcome`; the wizard sends a confirmation email after provisioning succeeds.

**Architecture:** New `sendInvitation()` on `pingOneUserService` (one axios call to the PingOne Password/Invitation API — the exact operation is live-verified in Task 1 before anything is built on it), a `requireAdmin` `POST /api/demo/send-invite` endpoint in the existing provisioning router, a non-fatal confirmation-email step at the end of `provision-wizard`, and a small invite form on the existing HostedRegistrationAdminPage. No new dependencies, no SMTP.

**Tech Stack:** Node/Express + axios (server), React (HostedRegistrationAdminPage), Jest (server tests).

**Spec:** `docs/superpowers/specs/2026-10-11-wizard-invite-emails-design.md`

## Global Constraints

- No new npm dependencies (spec scope cut).
- All new endpoints gated with `requireAdmin` from `../middleware/auth` (same as `provision-wizard`, `routes/demoProvisioning.js:15`).
- Confirmation-email failure must NOT fail provisioning (spec §2): log + `confirmationEmail: 'failed'` in the response.
- No bulk invites, no custom HTML templates, no queue/retry (spec §4).
- PingOne env: `configStore.getEffective('pingone_environment_id') || 'PINGONE_ENVIRONMENT_ID'` (currently `01d89b06-…`); region from `pingone_region`/`PINGONE_REGION` default `com`.
- Commit after every task; commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- The shared main checkout is worked in by many sessions — run `git pull --ff-only origin main` before starting each task.

## Review Focus

1. **Wrong PingOne operation** — if the invitation content-type/op is wrong, PingOne returns 400/415 and NO email goes out while the API reports success-shaped errors; a person would believe the invite was sent. Task 1 pins this with a live-verified operation before any code depends on it; Task 2's test asserts the exact content-type the live check confirmed.
2. **Double-invite / duplicate user** — inviting the same email twice must reuse the existing user, not create `username` collisions (PingOne 409s on duplicate usernames). Test in Task 2 (idempotent re-invite).
3. **Confirmation email breaking registration** — if the confirmation send throws (PingOne down, template missing), the wizard must still return 201 with credentials. Test in Task 3 (forced send failure → 201, `confirmationEmail: 'failed'`).
4. **Non-admin access to send-invite** — the endpoint mints emails in PingOne; unauthenticated access is spam-as-a-service. Test in Task 2 (401 without admin session).
5. **Invite email without registration link** — a recipient who can't find `/welcome` is stuck; the admin UI copy must show the registration URL and the PR must verify (manually, live) the email contains a usable link. Covered by Task 5's manual verification step.

---

### Task 1: Live-verify the PingOne invitation operation (spike — no product code)

**Files:**
- None committed. Findings recorded in this plan file's Task 2 step 3 (update the content-type there if the live check disagrees).

**Interfaces:**
- Produces: the verified PingOne operation (method + path + Content-Type + body shape) that Task 2's `sendInvitation()` implements, and whether the worker token has permission to call it.

- [ ] **Step 1: Get a worker token**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server
node -e '
const cfg = require("./services/configStore");
const { getManagementToken } = require("./services/pingOneClientService");
getManagementToken().then(t => { require("fs").writeFileSync("/tmp/worker-token.txt", t); console.log("token saved, length", t.length); }).catch(e => { console.error("FAIL", e.message); process.exit(1); });
'
```

Run it. Expected: `token saved, length …`. If it fails with "worker credentials not configured", stop and ask Curtis — do not proceed without the worker app.

- [ ] **Step 2: Probe the invitation operation against a TEST user (never a real person's address)**

PingOne's documented invitation mechanism is the password "set" with email verification NOT skipped — but editions differ. Probe in this order, with a throwaway address on a test user you create and delete in the same script:

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server
TOKEN=$(cat /tmp/worker-token.txt)
ENV=$(grep '^PINGONE_ENVIRONMENT_ID=' .env | cut -d= -f2)
node -e '
const axios = require("axios");
const fs = require("fs");
const token = fs.readFileSync("/tmp/worker-token.txt","utf8").trim();
const env = process.env.ENV;
const base = `https://api.pingone.com/v1/environments/${env}`;
const email = "invite-probe+delete@ping-devops.com";
(async () => {
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  // create a throwaway user
  let user;
  try {
    user = (await axios.post(`${base}/users`, { username: email, email, name: { given: "Invite", family: "Probe" }, enabled: true }, { headers: h })).data;
    console.log("user created:", user.id);
  } catch (e) { console.error("create failed:", e.response?.status, JSON.stringify(e.response?.data).slice(0,300)); process.exit(1); }
  // probe A: password.set with forceChange + skipEmailVerification:false (documented invite path)
  try {
    const r = await axios.post(`${base}/users/${user.id}/password`,
      { forceChange: true, skipEmailVerification: false },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/vnd.pingidentity.password.set+json" } });
    console.log("PROBE A OK:", r.status, JSON.stringify(r.data).slice(0,200));
  } catch (e) { console.log("PROBE A FAIL:", e.response?.status, JSON.stringify(e.response?.data).slice(0,300)); }
  // probe B: dedicated invitation op if A failed
  try {
    const r = await axios.post(`${base}/users/${user.id}/password`,
      {},
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/vnd.pingidentity.user.sendInvitation+json" } });
    console.log("PROBE B OK:", r.status, JSON.stringify(r.data).slice(0,200));
  } catch (e) { console.log("PROBE B FAIL:", e.response?.status, JSON.stringify(e.response?.data).slice(0,300)); }
  // cleanup
  try { await axios.delete(`${base}/users/${user.id}`, { headers: h }); console.log("probe user deleted"); } catch (e) { console.log("cleanup failed (delete manually):", user.id); }
})();
' 2>&1
```

Run it with `ENV=$ENV` exported (prepend `ENV=$ENV` to the node line or `export ENV` first). Expected: exactly one probe logs OK. Record WHICH one and its status/body.

- [ ] **Step 3: Record the winning operation**

Note the winning probe (A or B), and check whether the response body contains an email-send indicator. Update Task 2 Step 3's code block below to match the verified operation if it differs. If BOTH probes fail with 403, the worker app lacks the scope — message Curtis to add the invitation/password scope to the worker app in the tenant before Task 2, and stop here.

- [ ] **Step 4: Verify the email arrived**

Curtis checks the throwaway address's inbox (the probe address routes to the ping-devops.com catch-all or fails visibly — ask Curtis where probe emails land if the inbox is not obvious). If no inbox is checkable, accept the PingOne 2xx + response-body evidence and note it as a residual risk in the PR description.

### Task 2: `sendInvitation()` service method + `POST /api/demo/send-invite` endpoint

**Files:**
- Modify: `demo_api_server/services/pingOneUserService.js` (add `sendInvitation` near `setUserPassword`, ~line 355)
- Modify: `demo_api_server/routes/demoProvisioning.js` (add endpoint after `provision-user`, ~line 100)
- Test: `demo_api_server/tests/sendInvite.route.test.js` (new)

**Interfaces:**
- Consumes: `getManagementToken()` from `../services/pingOneClientService`; `configStore.getEffective()`; axios.
- Produces: `pingOneUserService.sendInvitation(userId) → Promise<void>` (throws on non-2xx). Endpoint `POST /api/demo/send-invite` body `{ email }` → `201 { userId, invite: 'sent', registrationUrl }` | `400 { error: 'invalid_request' }` | `404 { error: 'user_not_found' }` (never happens — creates user) | `503 { error: 'management_token_failed' | 'pingone_invite_failed', message }`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/sendInvite.route.test.js`:

```javascript
'use strict';
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn(() => Promise.resolve('test-worker-token')),
}));
jest.mock('../services/mfaService', () => ({}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((k) => {
    if (k === 'pingone_environment_id' || k === 'PINGONE_ENVIRONMENT_ID') return 'env-123';
    if (k === 'pingone_region' || k === 'PINGONE_REGION') return 'com';
    return null;
  }),
}));
jest.mock('../data/store', () => ({ seedAccountsForUser: jest.fn() }));

// axios mock: POST /users → create; POST /users/:id/password → invite op
const axiosMock = jest.fn();
jest.mock('axios', () => { const a = jest.fn(); a.post = a; return a; });
const axios = require('axios');

describe('POST /api/demo/send-invite', () => {
  let app;
  beforeAll(() => {
    axios.mockImplementation((cfg) => {
      if (cfg.url.endsWith('/password') && cfg.headers['Content-Type'] === 'application/vnd.pingidentity.password.set+json') {
        return Promise.resolve({ status: 204, data: {} });
      }
      if (cfg.url.endsWith('/users')) return Promise.resolve({ status: 201, data: { id: 'user-1' } });
      return Promise.reject({ response: { status: 500, data: { message: 'unexpected' } } });
    });
    const express = require('express');
    const routes = require('../routes/demoProvisioning');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'admin', username: 'admin@test' }; next(); });
    app.use('/api/demo', routes);
  });

  test('201 with userId + registrationUrl for a fresh email', async () => {
    const req = { method: 'POST', url: '/api/demo/send-invite', body: { email: 'new@x.com' }, headers: {} };
    // use supertest-free direct invocation via express: use app.inject style
    const http = require('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/demo/send-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'new@x.com' }) });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.userId).toBe('user-1');
    expect(body.invite).toBe('sent');
    expect(body.registrationUrl).toContain('/welcome?welcome=1');
    server.close();
  });

  test('400 invalid email', async () => {
    const http = require('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/demo/send-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nope' }) });
    expect(res.status).toBe(400);
    server.close();
  });

  test('503 when the PingOne invite op fails', async () => {
    axios.mockImplementationOnce(() => Promise.reject({ response: { status: 403, data: { message: 'no scope' } } }));
    const http = require('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/demo/send-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'new2@x.com' }) });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).toBe('pingone_invite_failed');
    server.close();
  });
});
```

Note: the test file above stubs `req.user` via middleware because `requireAdmin` reads it — if `requireAdmin` in `../middleware/auth` reads a session instead of `req.user`, copy the exact setup pattern from `tests/provisionWizard.route.test.js` (it already solved admin-gating in tests) and mirror it; delete the inline middleware then.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest tests/sendInvite.route.test.js --forceExit`
Expected: FAIL — route returns 404 (endpoint does not exist yet).

- [ ] **Step 3: Implement `sendInvitation` in `pingOneUserService.js`**

Add after `setUserPassword` (~line 355), using the operation verified live in Task 1 (shown here as Probe A's shape — replace if Task 1 found B):

```javascript
  /**
   * Trigger PingOne's native invitation email for an existing user.
   * Uses the verified operation from the 2026-10-11 live probe (see
   * docs/superpowers/plans/2026-10-11-wizard-invite-emails.md Task 1).
   */
  async sendInvitation(userId) {
    const token = await this.getAccessToken();
    await axios.post(
      `${this.baseUrl}/users/${userId}/password`,
      { forceChange: true, skipEmailVerification: false },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/vnd.pingidentity.password.set+json',
        },
        timeout: 10000,
      }
    );
  }
```

(If `pingOneUserService` has no `baseUrl`/`getAccessToken` in the class the route uses, follow the pattern `setUserPassword` uses — it is the same class.)

- [ ] **Step 4: Implement the endpoint in `demoProvisioning.js`**

Add after the `provision-user` route (~line 100):

```javascript
// POST /api/demo/send-invite — admin-triggered PingOne invitation email
// pointing the recipient at the welcome-wizard registration page.
router.post('/send-invite', requireAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid_request', message: 'A valid email is required' });
  }

  const envId  = configStore.getEffective('pingone_environment_id') || configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('pingone_region') || configStore.getEffective('PINGONE_REGION') || 'com';
  const apiBase = `https://api.pingone.${region}/v1/environments/${envId}`;

  let workerToken;
  try {
    workerToken = await getManagementToken();
  } catch (err) {
    return res.status(503).json({ error: 'management_token_failed', message: err.message });
  }

  try {
    // Idempotent: reuse the user if the email already exists (same pattern
    // as provision-user) so re-inviting never collides on username.
    const lookupSvc = new PingOneProvisionService();
    lookupSvc.baseURL = apiBase;
    lookupSvc.workerToken = workerToken;
    let user = await lookupSvc.findUserByUsername(email);
    if (!user) {
      user = (await axios.post(`${apiBase}/users`, {
        username: email,
        email,
        name: { given: 'Invited', family: 'User' },
        enabled: true,
      }, {
        headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      })).data;
    }
    await pingOneUserService.sendInvitation(user.id);
    return res.status(201).json({
      userId: user.id,
      invite: 'sent',
      registrationUrl: `${configStore.getEffective('public_app_url') || 'https://ai-demo.ping-devops.com'}/welcome?welcome=1`,
    });
  } catch (err) {
    const detail = normalizeAxiosError(err);
    return res.status(503).json({ error: 'pingone_invite_failed', message: detail });
  }
});
```

If `normalizeAxiosError`'s signature differs (check its export in `utils/normalizeAxiosError.js`), pass what it expects — the requirement is a readable string in `message`.

- [ ] **Step 5: Run the tests until green**

Run: `cd demo_api_server && npx jest tests/sendInvite.route.test.js --forceExit`
Expected: PASS (3 tests).

Run: `cd demo_api_server && npx jest tests/provisionWizard.route.test.js --forceExit`
Expected: PASS (no regression from the shared file).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/pingOneUserService.js demo_api_server/routes/demoProvisioning.js demo_api_server/tests/sendInvite.route.test.js
git commit -m "feat(onboarding): admin-triggered PingOne invitation email endpoint

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 3: Confirmation email at the end of provision-wizard (non-fatal)

**Files:**
- Modify: `demo_api_server/routes/demoProvisioning.js` (in the `provision-wizard` handler, before the final `return res.status(ok ? 201 : 207)…` at ~line 290)
- Test: `demo_api_server/tests/provisionWizard.route.test.js` (extend)

**Interfaces:**
- Consumes: `pingOneUserService.sendInvitation(userId)` from Task 2; the wizard's `customer.user.id` / `admin.user.id`.
- Produces: response payload gains `confirmationEmail: 'sent' | 'failed' | 'skipped'`; HTTP status and `credentials` unchanged.

- [ ] **Step 1: Write the failing test**

Append to `demo_api_server/tests/provisionWizard.route.test.js` (mirror its existing mocks/setup exactly — it already mocks axios, mfaService, configStore, and the admin gate):

```javascript
describe('provision-wizard confirmation email', () => {
  test('confirmation failure does not fail provisioning (still 201, confirmationEmail failed)', async () => {
    // Arrange: let every provisioning step succeed (existing setup), but make
    // the confirmation call fail. The confirmation uses axios POST to the same
    // password endpoint the invite uses — locate how the existing tests stub
    // axios and add one rejection for the confirmation call.
    // Act: POST /api/demo/provision-wizard with a valid email+cell.
    // Assert: res.status === 201; body.credentials.customerUsername defined;
    //         body.confirmationEmail === 'failed'.
  });

  test('confirmation success is reported as sent', async () => {
    // Arrange: all steps succeed, confirmation call resolves 204.
    // Act: POST /api/demo/provision-wizard.
    // Assert: res.status === 201; body.confirmationEmail === 'sent'.
  });
});
```

These two tests MUST be written with the file's real helpers — read the file's existing first test and copy its arrange/act pattern verbatim, replacing only the axios stub behavior for the confirmation call and the assertions above. (The existing test file already renders the full wizard happy path; this is a two-variant extension, not new scaffolding.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && npx jest tests/provisionWizard.route.test.js --forceExit`
Expected: FAIL — response has no `confirmationEmail` field.

- [ ] **Step 3: Implement the non-fatal send**

In `routes/demoProvisioning.js`, inside the `provision-wizard` handler, replace the final `return res.status(ok ? 201 : 207)…` block with:

```javascript
  let confirmationEmail = 'skipped';
  if (ok && customer.user?.id) {
    try {
      await pingOneUserService.sendInvitation(customer.user.id);
      confirmationEmail = 'sent';
    } catch (err) {
      console.error('[provision-wizard] confirmation email failed:', err.message);
      confirmationEmail = 'failed';
    }
  }

  return res.status(ok ? 201 : 207).json({
    steps, errors: ok ? undefined : errors, credentials, confirmationEmail,
  });
```

- [ ] **Step 4: Run the tests until green**

Run: `cd demo_api_server && npx jest tests/provisionWizard.route.test.js tests/sendInvite.route.test.js --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/demoProvisioning.js demo_api_server/tests/provisionWizard.route.test.js
git commit -m "feat(onboarding): non-fatal confirmation email after wizard provisioning

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 4: Invite form on HostedRegistrationAdminPage

**Files:**
- Modify: `demo_api_ui/src/pages/HostedRegistrationAdminPage.jsx` (add an invite section above the table)

**Interfaces:**
- Consumes: `POST /api/demo/send-invite` (Task 2) via the page's existing `apiClient`.
- Produces: none (leaf UI).

- [ ] **Step 1: Add the invite section**

In `HostedRegistrationAdminPage.jsx`, add above the `<h1>`'s table (keep the page's inline-style idiom — it uses inline styles, not CSS files):

```jsx
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteState, setInviteState] = useState(null); // {ok, message}

  async function sendInvite(e) {
    e.preventDefault();
    setInviteState(null);
    try {
      const response = await apiClient.post('/api/demo/send-invite', { email: inviteEmail });
      setInviteState({ ok: true, message: `Invite sent — registration link: ${response.data.registrationUrl}` });
      setInviteEmail('');
    } catch (err) {
      setInviteState({ ok: false, message: err.response?.data?.message || 'Invite failed.' });
    }
  }
```

and in the JSX, between the `<h1>` and the registrations table:

```jsx
      <section style={{ marginBottom: '2rem' }}>
        <h2>Invite a user</h2>
        <form onSubmit={sendInvite} style={{ display: 'flex', gap: '0.5rem' }}>
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
          The invitee registers at <code>/welcome?welcome=1</code> — they pick their own password and MFA there.
        </p>
      </section>
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd demo_api_ui && npx react-scripts build 2>&1 | tail -5` (or the repo's build script — check `package.json` scripts first and use `npm run build`)
Expected: build completes without errors.

- [ ] **Step 3: Manual check against the local stack**

Start the local UI if not running (`docker ps | grep ai-demo-ui`), open the admin page, and confirm the form renders and the submit path hits the endpoint (a 503 from PingOne is fine — the toast must show the error message, not hang).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/pages/HostedRegistrationAdminPage.jsx
git commit -m "feat(onboarding): admin invite-user form on hosted registrations page

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 5: Dress rehearsal + PR

**Files:** None (verification + PR only).

**Interfaces:**
- Consumes: everything above, deployed to the SE cluster.

- [ ] **Step 1: CI green + merge**

Dispatch CI (the pull_request trigger is dead — run `gh workflow run ci.yml --ref <branch>` or let build-images run on merge; never two CI runs at once — EDR-under-load kills them). Fix failures, merge when green.

- [ ] **Step 2: Deploy to the SE cluster**

`./se-update-code.sh bff frontend` (demo-api-server + UI both changed), then verify pods on the new sha.

- [ ] **Step 3: Dress rehearsal with Curtis's address**

Curtis (admin) opens the hosted demo → Hosted Registrations admin page → invites `cmuir@pingone.com`. Curtis confirms the invite email arrives, follows it, registers through `/welcome`, and confirms the confirmation email arrives. If the invite email lacks the registration link (template-variable limitation from the spec's open items), add the plain-text fallback: the admin UI toast already shows the link for manual forwarding.

- [ ] **Step 4: Update the onboarding email**

Edit `docs/runbooks/privilege-onboarding-email.md`: replace the manual PingOne console invite instructions (checklist items 1–2) with "Curtis sends the invite from the admin page; the recipient follows the emailed link". Commit.

- [ ] **Step 5: Final PR description + merge**

PR body: link the spec + this plan, note the live-verified PingOne operation from Task 1, note the email-link verification result from Step 3. End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
