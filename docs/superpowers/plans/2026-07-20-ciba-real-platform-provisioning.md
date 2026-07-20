# Real PingOne CIBA Provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `POST https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/bc-authorize` actually work on the demo's PingOne environment, so `cibaService.js`'s real path succeeds and `cibaSimulatedService.js`'s failover stops triggering — without touching the existing login-critical "Demo AI App - Admin Login" application.

**Architecture:** This is a **platform-provisioning task, not a rewrite**. `demo_api_server/services/cibaService.js`, `routes/ciba.js`, `cibaEnhanced.js`, and `CIBAPanel.js` already correctly implement OIDC CIBA Core 1.0 poll mode and were confirmed working in a live Playwright pass against the simulated engine (`docs/superpowers/plans/2026-07-19-ciba-simulated-fallback.md`). The only reason CIBA runs simulated today is that PingOne's `/as/bc-authorize` has no CIBA-enabled application or DaVinci flow behind it on this environment (confirmed 2026-07-19 — raw AWS API-Gateway error, no `correlation-id`). Per PingOne's own setup doc (https://docs.pingidentity.com/pingone/use_cases/p1_configure_ciba_flow.html), a CIBA-capable application is meant to be **dedicated** (Grant Type = CIBA only, other grant/response types cleared) — reusing the admin login app would strip its `AUTHORIZATION_CODE`/`TOKEN_EXCHANGE` grants and break sign-in. So this plan provisions a **new, separate** PingOne application + DaVinci CIBA flow, then makes a small, additive code change so `cibaService.js` uses that new application's credentials for the bc-authorize/token Basic-auth calls specifically, while everything else (admin login, token exchange) is untouched. Once `bc-authorize` succeeds, `routes/ciba.js`'s existing try/real-then-catch-simulated logic resumes the real path automatically — no route code changes needed.

**Tech Stack:** PingOne Admin Console + DaVinci (manual — no MCP tool covers notification templates or DaVinci flow import), PingOne MCP server (`mcp__pingone__*`) for verification, Node.js/Express/Jest for the one code task.

## Global Constraints

- PingOne environment: `01d89b06-66d5-430e-9f28-65636843788b`, region `com` (`auth.pingone.com`). Do not create a new environment.
- **Do not modify** application `8a711944-e625-42ce-af14-4d5a0825155a` ("Demo AI App - Admin Login") — it is the live login/token-exchange app (`grantTypes: TOKEN_EXCHANGE, REFRESH_TOKEN, AUTHORIZATION_CODE`), protected per `REGRESSION_PLAN.md`'s auth guidance. The new CIBA app is fully separate.
- Any code/doc edits happen in an **isolated git worktree** (`superpowers:using-git-worktrees` / `EnterWorktree`) — never the main checkout. One branch: `ciba-real-provisioning`.
- Before editing `cibaService.js`, run `.claude/skills/regression-guard/` (auth-adjacent file — treat as protected per the global agent-behavior rule) and state what will not break: admin login, token exchange, and the existing simulated-failover behavior for anyone who hasn't run this provisioning.
- Keep `cibaSimulatedService.js` and the `fallback_simulated` failover in `routes/ciba.js` as-is. It becomes a no-op once the real path works (failover only triggers on failure) and remains a resilience safety net for other environments — do not remove it as part of this plan.
- Do not change `ciba_token_delivery_mode` from `'poll'` — `'ping'` mode needs a shared session store (Redis/Upstash) that doesn't exist in this stack.
- Emoji allowlist for any doc text touched: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`.

---

### Task 1: Create the CIBA notification email templates

**Console:** PingOne Admin Console → environment `01d89b06-66d5-430e-9f28-65636843788b` → **User Experience > Notification Templates**. This step has no MCP/API tool coverage — do it manually.

- [ ] **Step 1: Create the "with binding message" template**
  1. Click **Add Notification** → **Type: General** → name it `CIBA with binding message` → **Create**.
  2. Subject (pencil icon next to Subject): `Authentication request from ${appName}`. Save (checkmark).
  3. Email body:
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
  4. Save the message.

- [ ] **Step 2: Create the "without binding message" template**
  1. Click **Add Notification** → **Type: General** → name it `CIBA without binding message` → **Create**.
  2. Subject: `Authentication request from ${appName}`. Save.
  3. Email body:
     ```html
     ${appName} wants to access your account.
     <p>
     Open this link in your browser to review the request: ${magicLink}
     <p>
     If you do not recognize this request, ignore this email.
     <p>
     Request ID: ${authReqId}
     ```
  4. Save the message.

- [ ] **Step 3: Get a Notification Policy ID**
  Go to **User Experience > Notification Policies**. If one already exists, copy its ID (clipboard icon). If none exists, create one (set a reasonable daily send limit, e.g. 50) and copy its ID. Record it — Task 2 needs it.

---

### Task 2: Import and configure the DaVinci CIBA flow

**Console:** DaVinci UI for the same environment. No MCP tool imports DaVinci flows — this is manual.

- [ ] **Step 1: Download the sample flow**
  Go to https://marketplace.pingone.com/item/pingone-ciba, download the `.zip`, extract it locally. It contains `ciba-flow.json`.

- [ ] **Step 2: Import the flow**
  In DaVinci → **Flows** tab → **Add Flow** → **Import Flow** → upload `ciba-flow.json` → **Import**.

- [ ] **Step 3: Enable flow settings**
  Open the imported flow → **More Options (⋮)** → **Flow Settings** → enable **PingOne Flow** toggle → enable **CIBA Flow** toggle → **Save**.

- [ ] **Step 4: Wire the notification nodes**
  Locate the **Binding message check** node:
  - **False path** → **Sends email notification** node → gear icon → **PingOne Notification Details** → paste the Notification Policy ID from Task 1 Step 3 → **Apply** → **Close** → set **Notification Name** to `CIBA with binding message` → **Apply** → **Close**.
  - **True path** → **Sends email notification** node → set **Notification Name** to `CIBA without binding message` → **Apply** → **Close**.

- [ ] **Step 5: Save and deploy**
  Save the flow, then deploy it.

- [ ] **Step 6: Create the DaVinci flow policy**
  **Applications** tab (DaVinci) → **Add Application** → name it `Demo AI App - CIBA (DaVinci)` → **Create**. Open it → **Flow Policy** tab → **Add Flow Policy** → name it `CIBA Step-Up Policy` → select **PingOne Flow Policy** → **Next** → check **Show only CIBA Flows** → select the imported flow, **Latest Version** → **Next** → weight `100` → **Create Flow Policy**.

- [ ] **Step 7: Verify via MCP**
  Confirm the flow and policy exist:
  ```
  mcp__pingone__listDavinciApplications(environmentId: "01d89b06-66d5-430e-9f28-65636843788b")
  ```
  Expect a new entry named `Demo AI App - CIBA (DaVinci)`. Then:
  ```
  mcp__pingone__listDavinciApplicationFlowPolicies(
    environmentId: "01d89b06-66d5-430e-9f28-65636843788b",
    applicationId: "<id from previous call>"
  )
  ```
  Expect `CIBA Step-Up Policy` with `trigger: { type: 'AUTHENTICATION', ciba: true }` (or equivalent CIBA-trigger shape).

---

### Task 3: Create the dedicated CIBA PingOne application

**Console:** PingOne Admin Console → **Applications > Applications**. Manual — the PingOne MCP `createApplication`/`updateApplication` tools' `grantTypes` enum does not include `CIBA`, so this cannot be scripted through MCP; do not attempt a raw Management API call to work around it (unverified content-type contract for this field — use the console, which is PingOne's own documented path).

- [ ] **Step 1: Create the application shell**
  Click **+** → Application Name: `Demo AI App - CIBA` → Application Type: **OIDC Web App** → **Save**.

- [ ] **Step 2: Set the CIBA grant type**
  **Configuration** tab → **Grant Type**: select **CIBA**, clear every other pre-selected grant/response type → **Token Endpoint Authentication Method**: **Client Secret Basic** (must match `cibaService.js`'s `_credentials()`, which sends `Authorization: Basic base64(client_id:client_secret)`) → **Save**.

- [ ] **Step 3: Attach the DaVinci flow policy**
  **Policies** tab → **Add Policies** → **DaVinci Policies** tab → select `CIBA Step-Up Policy` (from Task 2 Step 6) → **Save**.

- [ ] **Step 4: Enable the application**
  Confirm the application toggle is **Enabled** (top of the page).

- [ ] **Step 5: Verify via MCP and capture credentials**
  ```
  mcp__pingone__getApplication(
    environmentId: "01d89b06-66d5-430e-9f28-65636843788b",
    applicationId: "<new app id>"
  )
  ```
  Expect `"name": "Demo AI App - CIBA"`, `"enabled": true`, `"tokenEndpointAuthMethod": "CLIENT_SECRET_BASIC"`, and a grant type reflecting CIBA (the read shape may render it differently than the write enum — record exactly what comes back). Then:
  ```
  mcp__pingone__getApplicationSecret(
    environmentId: "01d89b06-66d5-430e-9f28-65636843788b",
    applicationId: "<new app id>"
  )
  ```
  Record the `clientId` (= applicationId) and `secret` — Task 4 needs both.

---

### Task 4: Point `cibaService.js` at the dedicated CIBA application

**Files:**
- Modify: `demo_api_server/services/cibaService.js:38-45` (`_credentials()`)
- Modify: `demo_api_server/.env.example` (document the two new optional keys)
- Modify: `demo_api_server/.env` (set the two new keys to the values from Task 3 Step 5 — not committed)
- Test: `demo_api_server/src/__tests__/cibaService.test.js`

**Interfaces:**
- Consumes: nothing new from other tasks — this only changes which two strings `_credentials()` reads before building the Basic-auth header. `initiateBackchannelAuth`, `pollForTokens`, `waitForApproval`, `isEnabled` keep their exact existing signatures; `routes/ciba.js` and `cibaEnhanced.js` are untouched.
- Produces: `PINGONE_CIBA_CLIENT_ID` / `PINGONE_CIBA_CLIENT_SECRET` env vars, read only inside `cibaService.js`.

- [x] **Step 1: Write the failing test**

  Add to `demo_api_server/src/__tests__/cibaService.test.js`, inside `describe('cibaService.initiateBackchannelAuth()', ...)` (after the existing "POSTs to the CIBA endpoint with Basic auth credentials" test, ~line 112):

  ```js
  it('uses PINGONE_CIBA_CLIENT_ID/SECRET for Basic auth when set, instead of the admin app', async () => {
    const origId = process.env.PINGONE_CIBA_CLIENT_ID;
    const origSecret = process.env.PINGONE_CIBA_CLIENT_SECRET;
    process.env.PINGONE_CIBA_CLIENT_ID = 'ciba-app-client-id';
    process.env.PINGONE_CIBA_CLIENT_SECRET = 'ciba-app-client-secret';

    axios.post.mockResolvedValueOnce({ data: { auth_req_id: 'abc', expires_in: 300, interval: 5 } });

    await cibaService.initiateBackchannelAuth('user@example.com', 'msg');

    const expectedBasic = Buffer.from('ciba-app-client-id:ciba-app-client-secret').toString('base64');
    const [, , opts] = axios.post.mock.calls[0];
    expect(opts.headers.Authorization).toBe(`Basic ${expectedBasic}`);

    if (origId === undefined) delete process.env.PINGONE_CIBA_CLIENT_ID; else process.env.PINGONE_CIBA_CLIENT_ID = origId;
    if (origSecret === undefined) delete process.env.PINGONE_CIBA_CLIENT_SECRET; else process.env.PINGONE_CIBA_CLIENT_SECRET = origSecret;
  });

  it('falls back to the admin app credentials when PINGONE_CIBA_CLIENT_ID is unset', async () => {
    delete process.env.PINGONE_CIBA_CLIENT_ID;
    delete process.env.PINGONE_CIBA_CLIENT_SECRET;

    axios.post.mockResolvedValueOnce({ data: { auth_req_id: 'abc', expires_in: 300, interval: 5 } });

    await cibaService.initiateBackchannelAuth('user@example.com', 'msg');

    const [, , opts] = axios.post.mock.calls[0];
    expect(opts.headers.Authorization).toBe(`Basic ${EXPECTED_BASIC}`); // test-client-id:test-client-secret from the mocked oauth config
  });
  ```

- [x] **Step 2: Run tests to verify they fail**

  Run: `cd demo_api_server && npx jest src/__tests__/cibaService.test.js -t "PINGONE_CIBA_CLIENT_ID" --testPathIgnorePatterns=/.claude/worktrees/`
  Expected: both new tests FAIL — the first because `_credentials()` doesn't read the env vars yet (Basic header still encodes `test-client-id:test-client-secret`), the second passes trivially today but is included to lock the fallback behavior before the change.

- [x] **Step 3: Implement the minimal change**

  In `demo_api_server/services/cibaService.js`, replace:
  ```js
  function _credentials() {
    const clientId     = oauthConfig.clientId;
    const clientSecret = oauthConfig.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('Admin client credentials are not configured');
    }
    return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }
  ```
  with:
  ```js
  function _credentials() {
    // Dedicated CIBA-only PingOne application (see docs/superpowers/plans/2026-07-20-ciba-real-platform-provisioning.md).
    // Falls back to the admin login app's credentials so environments that
    // haven't provisioned a dedicated CIBA app keep today's behavior
    // (which fails over to cibaSimulatedService.js — see routes/ciba.js).
    const clientId     = process.env.PINGONE_CIBA_CLIENT_ID     || oauthConfig.clientId;
    const clientSecret  = process.env.PINGONE_CIBA_CLIENT_SECRET || oauthConfig.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('CIBA client credentials are not configured');
    }
    return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }
  ```

  In `demo_api_server/.env.example`, near the existing `CIBA_ENABLED` documentation, add:
  ```
  # Dedicated CIBA-only PingOne application (Grant Type = CIBA, no other grants).
  # Optional — cibaService.js falls back to PINGONE_ADMIN_CLIENT_ID/SECRET when unset.
  # See docs/superpowers/plans/2026-07-20-ciba-real-platform-provisioning.md.
  PINGONE_CIBA_CLIENT_ID=
  PINGONE_CIBA_CLIENT_SECRET=
  ```

  In `demo_api_server/.env` (not committed), set both to the values captured in Task 3 Step 5.

- [x] **Step 4: Run tests to verify they pass**

  Run: `cd demo_api_server && npx jest src/__tests__/cibaService.test.js`
  Expected: all tests PASS, including the two new ones.

- [x] **Step 5: Run the full CIBA-adjacent suite**

  Run: `cd demo_api_server && CI=true npx jest src/__tests__/cibaService.test.js src/__tests__/ciba.test.js src/__tests__/cibaSimulatedService.test.js src/__tests__/step-up-gate.test.js --maxWorkers=2`
  Expected: all PASS, no regressions — `ciba.test.js` mocks `cibaService` entirely so it's unaffected by the credential-source change.

- [x] **Step 6: Update the stale "Known gap" doc**

  In `claudSkills/pingone/ciba/SKILL.md`, replace the `⚠️` bullet describing the confirmed-2026-07-19 `bc-authorize` AWS API-Gateway failure (the one referencing env `01d89b06-66d5-430e-9f28-65636843788b`) with a note that a dedicated CIBA application + DaVinci flow were provisioned per `docs/superpowers/plans/2026-07-20-ciba-real-platform-provisioning.md`, and that `cibaService.js` now reads `PINGONE_CIBA_CLIENT_ID`/`PINGONE_CIBA_CLIENT_SECRET` for the bc-authorize/token Basic-auth calls (falling back to the admin app if unset).

  In `docs/superpowers/specs/2026-07-19-ciba-simulated-fallback-design.md`, under "Open risks", add a line noting this plan resolved the "if PingOne ever does provision CIBA" scenario, with the date and a pointer to this plan file.

- [x] **Step 7: Commit**

  ```bash
  git add demo_api_server/services/cibaService.js demo_api_server/.env.example \
          demo_api_server/src/__tests__/cibaService.test.js \
          claudSkills/pingone/ciba/SKILL.md \
          docs/superpowers/specs/2026-07-19-ciba-simulated-fallback-design.md
  git commit -m "feat(ciba): read dedicated CIBA app credentials, falling back to admin app"
  ```

---

### Task 5: End-to-end validation

**Goal:** Prove the real path works, not just that it no longer throws.

- [ ] **Step 1: Confirm CIBA is enabled and pointed at poll mode**
  `CIBA_ENABLED=true` in `demo_api_server/.env` (already set). `configStore.getEffective('ciba_token_delivery_mode')` should be unset or `'poll'`.

- [ ] **Step 2: Force the real path (no silent fallback) for this test**
  Temporarily set `ciba_failover_mode=deny` via the Config UI (or `configStore.set('ciba_failover_mode', 'deny')` if there's a debug console) so a bc-authorize failure surfaces as a `502` instead of silently degrading to the simulated engine — you want to know immediately if provisioning is incomplete, not get a false "it worked" from the simulator.

- [ ] **Step 3: Run the live "Try It" flow**
  Sign in to the admin UI, open the CIBAPanel (floating button, bottom-right) → **Try It** tab → initiate a request with your own PingOne-registered email as `login_hint`. Confirm:
  - The returned `auth_req_id` does **not** start with `sim-`.
  - The poll log shows `pending` while waiting.
  - The notification email arrives (check the inbox for the `login_hint` address) with the binding message and a magic link, using whichever of the two templates matches whether you supplied a `binding_message`.
  - Clicking the magic link and approving flips the poll to `approved`.

- [ ] **Step 4: Check the PingOne audit log**
  **Monitoring > Audit** → filter to the test window → confirm a **CIBA Authentication Succeeded** event appears. If it failed, filter for **CIBA Authentication Failed** and read the event detail — that detail is the fastest way to tell whether the gap is the grant type, the flow policy attachment, or the notification policy ID.

- [ ] **Step 5: Revert the failover mode**
  Set `ciba_failover_mode` back to `fallback_simulated` (or unset it — that's the default) so the demo keeps its resilience if this environment ever regresses.

- [ ] **Step 6: Confirm the transfer step-up path**
  With `step_up_method` resolving to `'ciba'` (its hardcoded final default per `transactionAuthorizationService.js:36`), run a transfer above `confirm_stepup_threshold_usd` ($500 default) and confirm the CIBA step-up gate now completes via the real flow end-to-end, matching the manual Playwright pass already documented for the simulated path in `docs/superpowers/plans/2026-07-19-ciba-simulated-fallback.md`.

---

## Self-Review

**Spec coverage:** Notification templates (Task 1) → DaVinci flow + policy (Task 2) → dedicated CIBA application (Task 3) → code pointing at it (Task 4) → live validation against the actual doc's audit-log success criterion (Task 5). Every section of the fetched PingOne doc (`p1_configure_ciba_flow.html`) maps to a task. The one thing deliberately **not** in scope: `ping` delivery mode (needs Redis) — flagged as a constraint, not silently dropped.

**Placeholder scan:** No TBD/TODO; every console step has exact field values and every code step has complete, copy-pasteable code.

**Type/name consistency:** `PINGONE_CIBA_CLIENT_ID`/`PINGONE_CIBA_CLIENT_SECRET` are the only new identifiers introduced, used identically in `.env.example`, `cibaService.js`, and the test file.
