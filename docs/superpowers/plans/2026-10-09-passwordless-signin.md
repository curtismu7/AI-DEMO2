# Passwordless Sign-in P1 (PingOne) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the pi.flow sign-in modal, a user with a registered PingOne MFA device signs in with username + device verification only — no password — via a new "Use a device instead" step, with "Use your password instead" always one click back.

**Architecture:** Extend the shared pi.flow driver (`demo_api_server/services/piFlowDriver.js`) with a `handlePasswordlessStart` that posts `username.check` (content type `application/vnd.pingidentity.username.check+json`, body `{ username }`) to the open flow and reuses the existing `respondAfterPiFlowStep` branching (otp/passkey). Mount it on both routers (`routes/oauthUser.js`, `routes/oauth.js`). In the modal (`PiFlowSignInModal.jsx`) add a `device` step with the two switch links; unexpected flow statuses 409 back to the password form.

**Tech Stack:** Express 4 + supertest/jest (server, CommonJS), React 19 + vitest/jsdom (UI), PingOne pi.flow API.

**Spec:** `docs/superpowers/specs/2026-10-09-passwordless-signin-design.md`

## Global Constraints

- REGRESSION_PLAN §1 protected: the password path (`/pi-flow/credentials` → `handleCredentialsStep`) must stay byte-unchanged; `respondAfterPiFlowStep` gains NO new branch.
- Error shape is `{ error: '...' }` never `{ message: '...' }` alone (demo_api_server CLAUDE.md); a human-readable `message` may ride alongside for 401/409s, as existing steps do.
- PingOne content types are verbatim: `application/vnd.pingidentity.username.check+json` for the passwordless start.
- PF pending flows 409 with `pi_flow_step_unsupported` — same guard as `handleAssertionStep`/`handleOtpStep` (driver line ~199/226).
- Server tests: `cd demo_api_server && CI=true npx jest tests/oauthUserPiFlow.test.js tests/oauthAdminPiFlow.test.js --forceExit` (CI=true mandatory; jest config auto-detects the worktree).
- UI tests: `cd demo_api_ui && CI=true npx --no-install vitest run <files>`; UI build gate: `cd demo_api_ui && npm run build`.
- Worktree discipline: explicit `git add <files>`, check `git branch --show-current` before each commit.
- Emoji allowlist (REGRESSION_PLAN §0): ❌ allowed in modal error text (existing pattern); no other new emoji.
- THEMING: no inline themeable styles; reuse existing classes (`pi-flow-signin__label`, `pi-flow-signin__input`, `signin-prompt__btn`, `signin-prompt__btn--ghost`, `signin-modal__text`).

## Review Focus

- **Multi-device user hits `DEVICE_SELECTION_REQUIRED`**: expects a clear message and return to the password form, never a dead end — pinned by driver test "policy/password-required statuses 409 with passwordless_unavailable" (Task 1, the USERNAME_PASSWORD_REQUIRED case) and the modal's 409 handler (Task 3).
- **Username with leading/trailing whitespace**: `username.check` with untrimmed input can mismatch the PingOne identity — expects the same trim-then-validate the OTP step applies to `otp` — pinned by driver test "trims the username before posting" (Task 1).
- **Device step submit while busy**: double-click fires two flow steps and corrupts the ST cookie jar — expects the same `if (busy) return;` guard every other submit uses — pinned by modal test "ignores a second submit while busy" (Task 3).
- **Admin flag off**: `/pi-flow/passwordless` on the admin router must 404 like its siblings so the SPA falls back — pinned by admin-router test (Task 2).
- **Stale/expired flow (5 min)**: device submit after expiry must 409 `pi_flow_not_started`, not leak a fetch — pinned by driver test "without an open flow -> 409" (Task 1).

---

### Task 1: Driver handler `handlePasswordlessStart` + user-route mount

**Files:**
- Modify: `demo_api_server/services/piFlowDriver.js` (add handler after `handleOtpStep`, ~line 244; add to the returned object)
- Modify: `demo_api_server/routes/oauthUser.js` (~line 353, next to the other pi-flow routes)
- Test: `demo_api_server/tests/oauthUserPiFlow.test.js` (new `describe` after the OTP tests)

**Interfaces:**
- Consumes: `openPiFlowOrReject(req, res)` → pending `{ flowId, provider, cookies, ... }` or null (driver, existing); `postPiFlowStep(pending, contentType, payload)` → `{ step, body, cookies }` (driver, existing); `respondAfterPiFlowStep(req, res, pending, body, cookies)` (driver, existing).
- Produces: exported handler `handlePasswordlessStart(req, res)` — contract: 200 `{ step: 'otp' }` | 200 `{ step: 'passkey', publicKeyCredentialRequestOptions }` | 200 `{ redirectTo }` (via respondAfter) | 400 `{ error: 'invalid_request' }` | 409 `{ error: 'pi_flow_not_started' }` | 409 `{ error: 'pi_flow_step_unsupported' }` (PF) | 409 `{ error: 'passwordless_unavailable', message: 'This account requires a password. Sign in with your password.' }` | 502 `{ error: 'pi_flow_failed' }`. Route mounted at `POST /api/auth/oauth/user/pi-flow/passwordless` (Task 3 posts here) and `POST /api/auth/oauth/pi-flow/passwordless` (Task 2).

- [ ] **Step 1: Write the failing tests** — append inside `describe('customer pi.flow sign-in', ...)` in `tests/oauthUserPiFlow.test.js`:

```js
  describe('passwordless start (username-only)', () => {
    test('posts username.check with the flow cookie; OTP_REQUIRED returns the otp step', async () => {
      const agent = request.agent(app);
      fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }, {}, ['ST=open; Path=/']));
      await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }, {}, ['ST=after-username; Path=/']));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: 'u' }).expect(200);
      expect(res.body).toEqual({ step: 'otp' });
      const call = fetchMock.mock.calls[1];
      expect(String(call[0])).toMatch(/\/flows\/flow-1$/);
      expect(call[1].headers['Content-Type']).toBe('application/vnd.pingidentity.username.check+json');
      expect(call[1].headers.Cookie).toBe('ST=open');
      expect(JSON.parse(call[1].body)).toEqual({ username: 'u' });
    });

    test('ASSERTION_REQUIRED returns the passkey step with parsed options', async () => {
      const agent = request.agent(app);
      await openFlow(agent);
      const OPTIONS = { challenge: 'Y2g', rpId: 'ping-devops.com' };
      fetchMock.mockResolvedValueOnce(json(200, {
        status: 'ASSERTION_REQUIRED',
        publicKeyCredentialRequestOptions: JSON.stringify(OPTIONS),
      }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: 'u' }).expect(200);
      expect(res.body.step).toBe('passkey');
      expect(res.body.publicKeyCredentialRequestOptions).toEqual(OPTIONS);
    });

    test('policy requires a password -> 409 passwordless_unavailable with a message', async () => {
      const agent = request.agent(app);
      await openFlow(agent);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'USERNAME_PASSWORD_REQUIRED' }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: 'u' }).expect(409);
      expect(res.body.error).toBe('passwordless_unavailable');
      expect(res.body.message).toContain('password');
    });

    test('trims the username before posting', async () => {
      const agent = request.agent(app);
      await openFlow(agent);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }));
      await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: '  u  ' }).expect(200);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ username: 'u' });
    });

    test('empty username -> 400 invalid_request without calling PingOne', async () => {
      const agent = request.agent(app);
      await openFlow(agent);
      fetchMock.mockClear();
      await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: '   ' }).expect(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('without an open flow -> 409 pi_flow_not_started without calling PingOne', async () => {
      fetchMock.mockClear();
      await request(app).post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: 'u' }).expect(409);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd demo_api_server && CI=true npx jest tests/oauthUserPiFlow.test.js --forceExit 2>&1 | tail -5`
Expected: FAIL — 404 on the new route (route does not exist yet).

- [ ] **Step 3: Implement the handler** — in `services/piFlowDriver.js`, after `handleOtpStep` (~line 244), matching the file's existing style:

```js
  // Passwordless start (PingOne only): identifies the user with the username
  // alone; the flow then asks for the device step (OTP or assertion), which the
  // existing branches below already drive. A policy that requires the password
  // (or any other status) 409s so the modal returns to the password form.
  async function handlePasswordlessStart(req, res) {
    const pending = openPiFlowOrReject(req, res);
    if (!pending) return undefined;
    if (pending.provider === 'pingfederate') return res.status(409).json({ error: 'pi_flow_step_unsupported' });
    const { username } = req.body || {};
    if (typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    try {
      const { step, body, cookies } = await postPiFlowStep(
        pending, 'application/vnd.pingidentity.username.check+json', { username: username.trim() },
      );
      if (!step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
      return await respondAfterPiFlowStep(req, res, pending, body, cookies);
    } catch (error) {
      console.warn('[oauth/pi-flow] passwordless step failed:', error.message);
      return res.status(502).json({ error: 'pi_flow_failed' });
    }
  }
```

Add `handlePasswordlessStart,` to the returned object (after `handleOtpStep,`).

- [ ] **Step 4: Run to verify pass**

Run: `cd demo_api_server && CI=true npx jest tests/oauthUserPiFlow.test.js --forceExit 2>&1 | tail -3`
Expected: PASS — but note the `passwordless_unavailable` case: `respondAfterPiFlowStep` currently returns `{ fallback: true }` for `USERNAME_PASSWORD_REQUIRED`. That is the correct generic behavior; the driver change for the 409 is Task 1b below.

- [ ] **Step 4b: Map password-required to 409 for the passwordless path** — `respondAfterPiFlowStep` gains NO new branch; instead `handlePasswordlessStart` checks the body BEFORE delegating:

```js
      const { step, body, cookies } = await postPiFlowStep(
        pending, 'application/vnd.pingidentity.username.check+json', { username: username.trim() },
      );
      // A password-required policy (or any status the device steps can't serve)
      // 409s so the modal returns to the password form with a message — the
      // shared respondAfter fallback ({ fallback: true }) is right for the
      // credentials path but wrong here; this step IS the alternative.
      if (body.status !== 'OTP_REQUIRED' && body.status !== 'ASSERTION_REQUIRED' && body.status !== 'COMPLETED') {
        return res.status(409).json({
          error: 'passwordless_unavailable',
          message: 'This account requires a password. Sign in with your password.',
        });
      }
      if (!step.ok) return res.status(502).json({ error: 'pi_flow_failed' });
      return await respondAfterPiFlowStep(req, res, pending, body, cookies);
```

(Note: keep the `if (!step.ok)` check BEFORE the status check in the real code order — postPiFlowStep never throws, so a 5xx from PingOne has `step.ok === false` and possibly no `body.status`.) Final handler order: guard → validate → post → `if (!step.ok) 502` → `if (status not in {OTP_REQUIRED, ASSERTION_REQUIRED, COMPLETED}) 409` → `respondAfterPiFlowStep`.

- [ ] **Step 5: Mount the route** — in `routes/oauthUser.js`, after the `/pi-flow/otp` mount (~line 353):

```js
// Passwordless start: username only; the flow moves to the device step (otp or
// passkey), which the modal drives with the existing endpoints.
router.post('/pi-flow/passwordless', piFlowHandlers.handlePasswordlessStart);
```

- [ ] **Step 6: Run the full file to verify pass**

Run: `cd demo_api_server && CI=true npx jest tests/oauthUserPiFlow.test.js --forceExit 2>&1 | tail -3`
Expected: PASS (all, including pre-existing).

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/services/piFlowDriver.js demo_api_server/routes/oauthUser.js demo_api_server/tests/oauthUserPiFlow.test.js
git commit -m "feat(auth): passwordless start step in the pi.flow driver (PingOne)"
```

---

### Task 2: Admin-route mount + admin flag-off test

**Files:**
- Modify: `demo_api_server/routes/oauth.js` (~line 61, after the `/pi-flow/otp` mount)
- Test: `demo_api_server/tests/oauthAdminPiFlow.test.js` (inside `describe('flag on', ...)`, and one line added to the flag-off test)

**Interfaces:**
- Consumes: `adminPiFlow.handlePasswordlessStart` (from Task 1), `adminPiFlowEnabled()` (existing gate in routes/oauth.js).
- Produces: `POST /api/auth/oauth/pi-flow/passwordless` — same contract as Task 1, 404 `{ error: 'pi_flow_disabled' }` when the admin flag is off.

- [ ] **Step 1: Write the failing tests** — in `tests/oauthAdminPiFlow.test.js`:

Inside `describe('flag off (default)')`, after the existing `otp` 404 assertion, add:

```js
      await request(app).post('/api/auth/oauth/pi-flow/passwordless').send({ username: 'a' }).expect(404);
```

Inside `describe('flag on')`, add:

```js
    test('passwordless start: username.check posts to the flow and returns the device step', async () => {
      fetchMock.mockResolvedValueOnce(json(200, { id: 'aflow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
      await request(app).get('/api/auth/oauth/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }));
      const res = await request(app).post('/api/auth/oauth/pi-flow/passwordless')
        .send({ username: 'demoAdmin' }).expect(200);
      expect(res.body).toEqual({ step: 'otp' });
      expect(fetchMock.mock.calls[1][1].headers['Content-Type'])
        .toBe('application/vnd.pingidentity.username.check+json');
    });

    test('passwordless start: policy requires password -> 409 passwordless_unavailable', async () => {
      fetchMock.mockResolvedValueOnce(json(200, { id: 'aflow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
      await request(app).get('/api/auth/oauth/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'USERNAME_PASSWORD_REQUIRED' }));
      const res = await request(app).post('/api/auth/oauth/pi-flow/passwordless')
        .send({ username: 'demoAdmin' }).expect(409);
      expect(res.body.error).toBe('passwordless_unavailable');
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd demo_api_server && CI=true npx jest tests/oauthAdminPiFlow.test.js --forceExit 2>&1 | tail -5`
Expected: FAIL — 404 instead of 200 on the flag-on cases.

- [ ] **Step 3: Mount the route** — in `routes/oauth.js`, after the `/pi-flow/otp` block (~line 61), matching its siblings' gate style:

```js
router.post('/pi-flow/passwordless', async (req, res) => {
  if (!adminPiFlowEnabled()) return res.status(404).json({ error: 'pi_flow_disabled' });
  return adminPiFlow.handlePasswordlessStart(req, res);
});
```

- [ ] **Step 4: Run to verify pass**

Run: `cd demo_api_server && CI=true npx jest tests/oauthAdminPiFlow.test.js --forceExit 2>&1 | tail -3`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/oauth.js demo_api_server/tests/oauthAdminPiFlow.test.js
git commit -m "feat(auth): mount passwordless start on the admin pi.flow router"
```

---

### Task 3: Modal `device` step with both switch links

**Files:**
- Modify: `demo_api_ui/src/components/PiFlowSignInModal.jsx`
- Test: `demo_api_ui/src/components/__tests__/PiFlowSignInModal.test.jsx` (new `describe('passwordless (device step)')`)

**Interfaces:**
- Consumes: `POST ${apiForRole()}/pi-flow/passwordless` (Tasks 1–2); existing branches for `otp`/`passkey`/`redirectTo`; existing classes `pi-flow-signin__label`, `pi-flow-signin__input`, `signin-prompt__btn`, `signin-prompt__btn--ghost`, `signin-modal__text`; `id="pi-flow-signin-form"` / `id="pi-flow-otp-form"` pattern for footer submit buttons.
- Produces: UI state `step` gains the value `'device'` (union becomes `"password" | "passkey" | "otp" | "device"`); no new exports.

- [ ] **Step 1: Write the failing tests** — append in `PiFlowSignInModal.test.jsx` (top-level, alongside the other describes; reuse `ok`, `ON`, `mountAndClick`):

```jsx
  describe('passwordless (device step)', () => {
    function mockPasswordlessBff({ passwordless }) {
      global.fetch = vi.fn((url) => {
        if (String(url).includes('/api/admin/config')) return ok({ config: ON });
        if (String(url).includes('/pi-flow/passwordless')) return passwordless();
        if (String(url).includes('/oauth/user/login')) return ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' });
        return ok({}, 404);
      });
    }

    async function toDeviceStep() {
      await mountAndClick();
      fireEvent.click(await screen.findByRole('button', { name: 'Use a device instead' }));
      return screen.findByLabelText('Username');
    }

    test('the password form offers "Use a device instead"; switching shows the device form', async () => {
      mockPasswordlessBff({ passwordless: () => ok({}) });
      await toDeviceStep();
      expect(screen.getByRole('button', { name: 'Use your password instead' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Password')).toBeNull();
    });

    test('device submit posts only the username to /pi-flow/passwordless; OTP_REQUIRED moves to the code form', async () => {
      mockPasswordlessBff({ passwordless: () => ok({ step: 'otp' }) });
      const usernameInput = await toDeviceStep();
      fireEvent.change(usernameInput, { target: { value: 'demo' } });
      const submit = screen.getAllByRole('button', { name: 'Sign in' }).pop();
      fireEvent.click(submit);
      fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } });
      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/pi-flow/passwordless'));
      expect(String(call[0])).toContain('/api/auth/oauth/user/pi-flow/passwordless');
      expect(JSON.parse(call[1].body)).toEqual({ username: 'demo' });
    });

    test('admin role posts to the admin router path', async () => {
      global.fetch = vi.fn((url) => {
        if (String(url).includes('/api/admin/config')) return ok({ config: { ...ON, PINGONE_ADMIN_AUTHORIZE_PI_FLOW: 'true' } });
        if (String(url).includes('/pi-flow/passwordless')) return ok({ step: 'otp' });
        if (String(url).includes('/oauth/login')) return ok({ flowId: 'fa', status: 'USERNAME_PASSWORD_REQUIRED' });
        return ok({}, 404);
      });
      render(<PiFlowSignInModal />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { navigateToAdminOAuthLogin('/admin'); });
      fireEvent.click(await screen.findByRole('button', { name: 'Use a device instead' }));
      fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demoAdmin' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).pop());
      await waitFor(() => {
        const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/pi-flow/passwordless'));
        expect(String(call[0])).toContain('/api/auth/oauth/pi-flow/passwordless');
      });
    });

    test('409 passwordless_unavailable shows the message and returns to the password form', async () => {
      mockPasswordlessBff({ passwordless: () => ok({ error: 'passwordless_unavailable', message: 'This account requires a password. Sign in with your password.' }, 409) });
      const usernameInput = await toDeviceStep();
      fireEvent.change(usernameInput, { target: { value: 'demo' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).pop());
      expect(await screen.findByText('This account requires a password. Sign in with your password.')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      // The typed username survives the round trip.
      expect(screen.getByLabelText('Username')).toHaveValue('demo');
    });

    test('"Use your password instead" switches back, preserving username and password', async () => {
      mockPasswordlessBff({ passwordless: () => ok({}) });
      await mountAndClick();
      fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demo' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use a device instead' }));
      await screen.findByRole('button', { name: 'Use your password instead' });
      fireEvent.click(screen.getByRole('button', { name: 'Use your password instead' }));
      expect(await screen.findByLabelText('Password')).toHaveValue('pw');
      expect(screen.getByLabelText('Username')).toHaveValue('demo');
    });

    test('ignores a second submit while busy', async () => {
      let release;
      mockPasswordlessBff({ passwordless: () => new Promise((r) => { release = r; }) });
      const usernameInput = await toDeviceStep();
      fireEvent.change(usernameInput, { target: { value: 'demo' } });
      const submit = screen.getAllByRole('button', { name: 'Sign in' }).pop();
      fireEvent.click(submit);
      fireEvent.click(submit);
      expect(global.fetch.mock.calls.filter(([u]) => String(u).includes('/pi-flow/passwordless'))).toHaveLength(1);
      release(ok({ step: 'otp' }));
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd demo_api_ui && CI=true npx --no-install vitest run src/components/__tests__/PiFlowSignInModal.test.jsx 2>&1 | tail -5`
Expected: FAIL — "Unable to find button 'Use a device instead'".

- [ ] **Step 3: Implement the modal changes** — in `PiFlowSignInModal.jsx`:

3a. State (next to `const [otp, setOtp] = useState("")`):

```jsx
  const [deviceUsername, setDeviceUsername] = useState("");
```

(The `step` state already exists; it gains the `'device'` value.)

3b. In `begin`'s reset block (after `setOtp("")`):

```jsx
    setDeviceUsername("");
```

3c. New submit handler (after `submitOtp`):

```jsx
  const submitPasswordless = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}${apiForRole()}/pi-flow/passwordless`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: deviceUsername }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.error === "passwordless_unavailable") {
        setError(body.message || "This account requires a password. Sign in with your password.");
        setStep("password");
        setBusy(false);
        return;
      }
      if (res.status === 401) {
        setError(body.message || "Could not verify that account.");
        setBusy(false);
        return;
      }
      if (res.ok && body.redirectTo) {
        navigateWithOverlay(body.redirectTo, { message: "Signing in...", assign: true });
        return;
      }
      if (res.ok && body.step === "passkey") {
        passkeyOptionsRef.current = body.publicKeyCredentialRequestOptions;
        setStep("passkey");
        setBusy(false);
        return;
      }
      if (res.ok && body.step === "otp") {
        setStep("otp");
        setBusy(false);
        return;
      }
      redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
    } catch {
      redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
    }
  };
```

3d. Footer buttons — extend the non-passkey branch so the device step gets its own submit wiring (the existing `form=` ternary becomes):

```jsx
              <button
                type="submit"
                form={step === "otp" ? "pi-flow-otp-form" : step === "device" ? "pi-flow-device-form" : "pi-flow-signin-form"}
                className="signin-prompt__btn"
                disabled={busy || (step === "otp" ? !otp : step === "device" ? !deviceUsername : !username || !password)}
              >
                {busy ? "Signing in" : "Sign in"}
              </button>
```

3e. Body forms — add the `device` case between the `otp` branch and the password fallback branch:

```jsx
        ) : step === "device" ? (
          <form id="pi-flow-device-form" className="pi-flow-signin__form" onSubmit={submitPasswordless}>
            <label className="pi-flow-signin__label" htmlFor="pi-flow-device-username">
              Username
            </label>
            <input
              id="pi-flow-device-username"
              className="pi-flow-signin__input"
              type="text"
              autoComplete="username"
              autoFocus
              value={deviceUsername}
              onChange={(e) => setDeviceUsername(e.target.value)}
            />
            {error ? (
              <p className="signin-modal__text" role="alert">
                ❌ {error}
              </p>
            ) : null}
          </form>
        ) : (
```

3f. Switch links — in the password form (after the error paragraph), and in the device form (after its error paragraph):

```jsx
            <button
              type="button"
              className="signin-prompt__btn signin-prompt__btn--ghost"
              onClick={() => { setDeviceUsername(username); setError(""); setStep("device"); }}
            >
              Use a device instead
            </button>
```

```jsx
            <button
              type="button"
              className="signin-prompt__btn signin-prompt__btn--ghost"
              onClick={() => { setUsername(deviceUsername); setError(""); setStep("password"); }}
            >
              Use your password instead
            </button>
```

(The username carries across both directions; `password` is untouched when leaving the password form, so it survives the round trip. Both links clear the error so a stale message never bleeds between forms.)

- [ ] **Step 4: Run to verify pass**

Run: `cd demo_api_ui && CI=true npx --no-install vitest run src/components/__tests__/PiFlowSignInModal.test.jsx 2>&1 | tail -3`
Expected: PASS (all, including pre-existing — the password form stays the default on mount).

- [ ] **Step 5: Run the full UI suite + build gate**

Run: `cd demo_api_ui && CI=true npx --no-install vitest run src/components/__tests__/ 2>&1 | tail -2 && npm run build 2>&1 | tail -1`
Expected: 0 failures; `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/PiFlowSignInModal.jsx demo_api_ui/src/components/__tests__/PiFlowSignInModal.test.jsx
git commit -m "feat(ui): device-only sign-in step in the pi.flow modal (passwordless)"
```

---

### Task 4: Scoped jest re-run + live verification + merge prep

**Files:**
- No new files; verification + push only.

**Interfaces:**
- Consumes: everything from Tasks 1–3.

- [ ] **Step 1: Scoped server suites**

Run: `cd demo_api_server && CI=true npx jest tests/oauthUserPiFlow.test.js tests/oauthAdminPiFlow.test.js --forceExit 2>&1 | tail -3`
Expected: PASS (both files).

- [ ] **Step 2: Full UI suite + build (the gate)**

Run: `cd demo_api_ui && CI=true npx --no-install vitest run src/components/__tests__/ src/legacy 2>&1 | tail -2 && npm run build 2>&1 | tail -1`
Expected: 0 failures; `✓ built`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin worktree-logout-branding
gh pr create --title "Passwordless sign-in P1 (PingOne): device-only step in the pi.flow modal" --body "...` (body: what/why, do-not-break statement, test evidence, the 🤖 attribution line)
```

- [ ] **Step 4: Live drive (after the PR is up, mount this worktree)**

Pin the generation first: `gen="$(npm run -s stack:generation)"`. Then `npm run serve:worktree here`, drive `https://local.ping-devops.com:4000`:
1. Sign Out (if signed in) → Sign In → type username → "Use a device instead" → Sign in → code arrives by email → enter → dashboard. **No password typed.**
2. Snap-back: use an account/policy without devices (or force `USERNAME_PASSWORD_REQUIRED`) → 409 message shows → password form returns with the username preserved.
3. Password path regression check: sign in with username+password as before — unchanged.
4. `npm run -s stack:generation -- --check "$gen"` — non-zero voids the run.
Restore with `npm run serve:worktree main` after.

- [ ] **Step 5: Merge is a user gate** — stop after the live drive and report; merge only on the user's go (same cadence as PR #1066).
