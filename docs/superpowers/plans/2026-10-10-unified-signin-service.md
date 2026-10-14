# Unified pi.flow Sign-in Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sign-in opens the branded pi.flow modal — passwordless-first, password one click away — through one shared client service; login_hint persists per role in configStore; registration enrolls EMAIL+SMS devices under a strict email rule.

**Architecture:** A new `signInService.js` becomes the single client entry point (config fetched once at boot, availability cached, `PI_FLOW_SIGNIN_EVENT` dispatched; redirect fallback lives in one place). The modal's default step inverts to device-only. The BFF driver reads the role's stored hint from configStore and returns it as `usernameHint` for both providers. Registration validates the email domain (no plus-addressing), requires phone, and enrolls both device types with the worker token. PF MFA statuses map in the driver; PUSH stays `fallback:true`.

**Tech Stack:** Express 4 + supertest/jest (server, CommonJS), React 19 + vitest/jsdom (UI), LMDB configStore, PingOne pi.flow API.

**Spec:** `docs/superpowers/specs/2026-10-10-unified-signin-service-design.md`

## Global Constraints

- Spec §1: "Deliberate exceptions (stay redirects): `useAuth.js` silent-reauth, `LogoutPage.js` live-id-jag mode, `/sdk-login`." No other raw login redirect survives.
- Spec §2: "never a hosted redirect for the *default* step" — policy-absent 400/409 snaps to the password form INSIDE the modal.
- Spec §3: email domain allowlist `pingidentity.com` / `pingone.com`, "the local part must not contain `+`"; phone required; enrollments non-fatal.
- Spec §4: hint keys `last_login_hint_customer` / `last_login_hint_admin`; hint endpoint validates with the session-name rule (cleanName: non-empty, ≤256, no control chars) — NOT the §3 email rule; hint write is never fatal.
- Spec §4: "session-derived `loginHintFor` … keeps winning over the stored hint when a session user exists."
- PR #1086 pattern: a BFF 5xx on a pi.flow step is a transient error the modal shows inline; do not reintroduce 5xx→redirect.
- Server tests are CommonJS jest (`demo_api_server/tests/`); UI tests are vitest (`demo_api_ui/src/**/__tests__/`). Commits end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Work in a git worktree (the shared main checkout's pre-commit hook blocks commits).

## Review Focus

- A user whose ONLY enrolled device is FIDO2 with no authenticator on this machine: default device step offers passkey, ceremony fails — they must reach the password form in one click, never a dead end. (Pinned: Task 5 modal test "passkey ceremony failure keeps password one click away".)
- A stored hint belonging to a DIFFERENT person than the one now signing in (shared demo machine): prefill is a convenience — the user must be able to clear/overwrite it freely, and the callback must overwrite the stored hint with whoever actually signed in. (Pinned: Task 1 test "callback overwrites stored hint".)
- The `mfa_only` policy absent (operator hasn't run the console step yet): every sign-in pays one 400 and lands on the password form inside the modal — no redirect, no hang. (Pinned: Task 5 test "policy-absent 400 snaps to password inside the modal".)
- `usernameHint` returned for PingOne must never leak ANOTHER user's hint into a session that also has `force=true` prompt=login semantics — prefill is advisory; PingOne does not bind the hint. (Pinned: Task 3 test asserting hint is advisory — sign-in succeeds with a different username.)
- Registration with a valid email but a phone PingOne rejects (bad format at PingOne side despite client validation): user creation MUST succeed, SMS enrollment failure only reported. (Pinned: Task 6 test "sms enroll failure does not fail registration".)

---

### Task 1: configStore hint keys + write-on-callback

**Files:**
- Modify: `demo_api_server/services/configStore.js` (FIELD_DEFS block near line 281)
- Modify: `demo_api_server/routes/oauthUser.js` (user callback, after token exchange ~line 1240)
- Modify: `demo_api_server/routes/oauth.js` (admin callback, same spot)
- Test: `demo_api_server/tests/oauthUserPiFlow.test.js`, `demo_api_server/tests/oauthAdminPiFlow.test.js`

**Interfaces:**
- Consumes: `configStore.setConfig(data)` (existing; validates keys against FIELD_DEFS), callback handlers in both routers.
- Produces: configStore keys `last_login_hint_customer`, `last_login_hint_admin` (strings, default `''`). Task 2's endpoint and Task 3's driver read them via `configStore.getEffective('last_login_hint_' + role)`.

- [x] **Step 1: Write the failing tests**

Append inside `describe('customer pi.flow sign-in', ...)` in `tests/oauthUserPiFlow.test.js` (reuse the file's existing helpers `openFlow`, `json`, `fetchMock` — read the top of the file first):

```js
  test('successful sign-in stores the login hint for the customer role', async () => {
    const configStore = require('../services/configStore');
    const agent = request.agent(app);
    await openFlow(agent);
    fetchMock
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'hint-code' } }));
    await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'hintuser@pingone.com', password: 'p' }).expect(200);
    // the callback exchanges the code — mock the token exchange the way the
    // existing callback tests in this file already do, then:
    // expect(configStore.setConfig).toHaveBeenCalledWith(expect.objectContaining({ last_login_hint_customer: 'hintuser@pingone.com' }));
  });

  test('callback overwrites stored hint: the next sign-in by a different user wins', async () => {
    const configStore = require('../services/configStore');
    // seed a stale hint, sign in as someone else, assert the write carries the NEW username
    configStore.getEffective.mockImplementation?.(() => 'old-user@pingone.com');
    // …same mocking as above, sign in with username 'new-user@pingone.com', then:
    // expect(configStore.setConfig).toHaveBeenCalledWith(expect.objectContaining({ last_login_hint_customer: 'new-user@pingone.com' }));
  });
```

Read how the file's existing tests mock the token exchange (they exist for the callback flow) and copy that mocking; the assertion above is the contract. Mirror the same test in `tests/oauthAdminPiFlow.test.js` with `last_login_hint_admin`.

- [x] **Step 2: Run to verify failure**

Run: `cd demo_api_server && npx jest tests/oauthUserPiFlow.test.js -t "stores the login hint"`
Expected: FAIL — `setConfig` never called with `last_login_hint_customer`.

- [x] **Step 3: Implement**

In `services/configStore.js`, in the FIELD_DEFS block right after `PINGONE_USER_AUTHORIZE_PI_FLOW` (line ~281):

```js
  // Last username each role signed in with — prefills the pi.flow modal's
  // username field next time that role signs in. Convenience only, never an
  // auth decision. Written by the role's OAuth callback after token exchange.
  last_login_hint_customer: { public: true, default: '' },
  last_login_hint_admin:    { public: true, default: '' },
```

In `routes/oauthUser.js`, inside the user callback's success path (after tokens are stored, before the final redirect ~line 1259), add:

```js
  // Remember who signed in so the next sign-in prefills their username.
  // Never fatal: a persistence failure costs a prefill, not a session.
  try {
    const hintUser = authedUser?.username || authedUser?.email;
    if (hintUser) await configStore.setConfig({ last_login_hint_customer: String(hintUser) });
  } catch (hintErr) {
    console.warn('[oauth/user/callback] login hint write failed:', hintErr.message);
  }
```

Match the callback's actual variable holding the signed-in username (read the code around line 1240; `authedUser` is the object built there — adapt the field name to what exists, likely `authedUser.username`). In `routes/oauth.js` find the equivalent admin callback success path and add the same block with `last_login_hint_admin`.

- [x] **Step 4: Run to verify pass**

Run: `cd demo_api_server && npx jest tests/oauthUserPiFlow.test.js tests/oauthAdminPiFlow.test.js`
Expected: PASS (all, including the new ones).

- [x] **Step 5: Commit**

```bash
git add demo_api_server/services/configStore.js demo_api_server/routes/oauthUser.js demo_api_server/routes/oauth.js demo_api_server/tests/oauthUserPiFlow.test.js demo_api_server/tests/oauthAdminPiFlow.test.js
git commit -m "feat(auth): store the sign-in username per role in configStore"
```

---

### Task 2: PUT /api/auth/oauth/user/login-hint endpoint

**Files:**
- Modify: `demo_api_server/routes/oauthUser.js` (new route near the pi-flow mounts, ~line 364)
- Modify: `demo_api_server/routes/oauth.js` (same route on the admin router — one shared handler, role from the route)
- Test: `demo_api_server/tests/oauthUserPiFlow.test.js`

**Interfaces:**
- Consumes: `configStore.setConfig`, hint keys from Task 1.
- Produces: `PUT /api/auth/oauth/user/login-hint` and `PUT /api/auth/oauth/login-hint`, body `{ value }`, responses `204` on success, `400 { error: 'invalid_hint' }` when the value fails validation. The modal (Task 4) calls the role-appropriate path.

- [x] **Step 1: Write the failing tests**

Append in `tests/oauthUserPiFlow.test.js`:

```js
  describe('PUT /login-hint', () => {
    test('stores a valid hint for the customer role', async () => {
      const configStore = require('../services/configStore');
      const res = await request(app)
        .put('/api/auth/oauth/user/login-hint')
        .send({ value: 'someone@pingone.com' });
      expect(res.status).toBe(204);
      expect(configStore.setConfig).toHaveBeenCalledWith(
        expect.objectContaining({ last_login_hint_customer: 'someone@pingone.com' }));
    });

    test('rejects control characters and overlong values with 400', async () => {
      const res1 = await request(app)
        .put('/api/auth/oauth/user/login-hint').send({ value: 'bad\u0007name' });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe('invalid_hint');
      const res2 = await request(app)
        .put('/api/auth/oauth/user/login-hint').send({ value: 'x'.repeat(257) });
      expect(res2.status).toBe(400);
    });

    test('empty body is a 400, not a wiped hint', async () => {
      const res = await request(app)
        .put('/api/auth/oauth/user/login-hint').send({});
      expect(res.status).toBe(400);
    });
  });
```

Note: the test app in this file mounts the router with `app.use('/api/auth/oauth/user', router)` — the route is reachable directly. configStore is already jest.mocked in this file's top; add `setConfig: jest.fn().mockResolvedValue(undefined)` to the mock factory if absent.

- [x] **Step 2: Run to verify failure**

Run: `cd demo_api_server && npx jest tests/oauthUserPiFlow.test.js -t "PUT /login-hint"`
Expected: FAIL — 404 (route does not exist).

- [x] **Step 3: Implement**

In `routes/oauthUser.js`, after the `/pi-flow/device` mount (~line 364):

```js
// The modal remembers who is signing in as: PUT stores the typed username as
// the role's login hint so the next sign-in prefills it. Convenience prefill
// only — validated with the same cleanName rule as the server's own hint
// derivation, never an auth decision. Admin router (routes/oauth.js) mounts
// the same handler for its role.
const hintForStore = (value) => {
  const text = String(value ?? '').trim();
  return text && text.length <= 256 && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
};
const storeLoginHint = (key) => async (req, res) => {
  const hint = hintForStore(req.body?.value);
  if (!hint) return res.status(400).json({ error: 'invalid_hint' });
  try {
    await configStore.setConfig({ [key]: hint });
    return res.status(204).end();
  } catch (err) {
    console.warn('[oauth/user] login-hint write failed:', err.message);
    return res.status(204).end(); // prefill loss is not the user's problem
  }
};
router.put('/login-hint', storeLoginHint('last_login_hint_customer'));
```

In `routes/oauth.js`, add the same two helpers (or import a shared tiny module if both routers already share one — check for an existing shared util first) and mount `router.put('/login-hint', storeLoginHint('last_login_hint_admin'))`.

- [x] **Step 4: Run to verify pass**

Run: `cd demo_api_server && npx jest tests/oauthUserPiFlow.test.js tests/oauthAdminPiFlow.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add demo_api_server/routes/oauthUser.js demo_api_server/routes/oauth.js demo_api_server/tests/oauthUserPiFlow.test.js
git commit -m "feat(auth): PUT /login-hint stores the role's remembered username"
```

---

### Task 3: driver reads the stored hint at flow open (both providers)

**Files:**
- Modify: `demo_api_server/routes/oauthUser.js` (the authorize-URL build, line ~572) and the `openPiFlow` call (line 623)
- Modify: `demo_api_server/routes/oauth.js` (same two spots)
- Modify: `demo_api_server/services/piFlowDriver.js` (`openPiFlow`, line 79 — return `usernameHint` for PingOne too)
- Test: `demo_api_server/tests/oauthUserPiFlow.test.js`, `demo_api_server/tests/oauthAdminPiFlow.test.js`

**Interfaces:**
- Consumes: hint keys from Task 1 via `configStore.getEffective`.
- Produces: `/login?pi_flow=1` response gains `usernameHint` for PingOne (string or absent). The modal (Task 4) prefills from it. Sign-in with a DIFFERENT username than the hint must still succeed (advisory prefill).

- [x] **Step 1: Write the failing tests**

Append in `tests/oauthUserPiFlow.test.js`:

```js
  test('pi_flow open includes the stored hint as usernameHint for PingOne too', async () => {
    const configStore = require('../services/configStore');
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: 'test-env-id',
      user_client_id: 'test-client-id',
      user_client_secret: 'test-secret',
      user_pingone_authorize_pi_flow: 'true',
      last_login_hint_customer: 'stored-user@pingone.com',
    })[key]);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'SIGN_ON_REQUIRED' }));
    const res = await request(app).get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    expect(res.body.usernameHint).toBe('stored-user@pingone.com');
    // the authorize URL the BFF fetched carries the hint for both providers
    const authorizeUrl = fetchMock.mock.calls[0][0];
    expect(authorizeUrl).toContain('login_hint=stored-user%40pingone.com');
  });
```

Note: `configStore.getEffective` in this file's mock returns from a fixed object — adapt the mock style to what the file actually does (its factory at the top); the contract is: with `last_login_hint_customer` set, the open response carries `usernameHint` and the authorize URL carries `login_hint=`.

- [x] **Step 2: Run to verify failure**

Run: `cd demo_api_server && npx jest tests/oauthUserPiFlow.test.js -t "stored hint"`
Expected: FAIL — `usernameHint` absent for PingOne.

- [x] **Step 3: Implement**

In `routes/oauthUser.js` at the authorize-URL build (~line 572), the existing line:

```js
        ...(!forceLogin && knownLoginHint(req) ? { login_hint: knownLoginHint(req) } : {}),
```

becomes (session-derived hint wins; stored hint is the fallback; forced re-auth still prefills):

```js
        ...(knownLoginHint(req) || (!forceLogin && storedHint('customer'))
          ? { login_hint: knownLoginHint(req) || storedHint('customer') } : {}),
```

Define above the router's `/login` handler:

```js
// The role's remembered username from configStore (Task 1/2). Advisory prefill.
const storedHint = (role) => {
  const v = configStore.getEffective(`last_login_hint_${role}`);
  return typeof v === 'string' && v.trim() ? v.trim() : '';
};
```

Pass the same value to the modal: change the `openPiFlow` call (line 623) to
`piFlowHandlers.openPiFlow(req, res, url, piFlowProvider())` (unchanged) — the driver already
reads `login_hint` from the authorize URL; the change is in `openPiFlow`'s response:

```js
      const usernameHint = new URL(authorizeUrl).searchParams.get('login_hint') || '';
```

(replacing the `provider === 'pingfederate' ? … : null` ternary — both providers now echo it; the comment above that line about PingOne not binding it stays true and is updated to say the hint is advisory for PingOne). Mirror the router-side changes in `routes/oauth.js` with role `'admin'`.

- [x] **Step 4: Run to verify pass**

Run: `cd demo_api_server && npx jest tests/oauthUserPiFlow.test.js tests/oauthAdminPiFlow.test.js`
Expected: PASS. Existing tests asserting `usernameHint` only for PF must be updated to the new both-provider contract.

Add the Review-Focus pin (still Task 3's test file):

```js
  test('hint is advisory: signing in with a different username than the hint succeeds', async () => {
    const configStore = require('../services/configStore');
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: 'test-env-id',
      user_client_id: 'test-client-id',
      user_client_secret: 'test-secret',
      user_pingone_authorize_pi_flow: 'true',
      last_login_hint_customer: 'stored-user@pingone.com',
    })[key]);
    const agent = request.agent(app);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
    await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    fetchMock
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'c' } }));
    // a DIFFERENT username than the stored hint completes fine
    await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'other-user@pingone.com', password: 'p' }).expect(200);
  });
```

- [x] **Step 5: Run the driver suites and commit**

Run: `cd demo_api_server && npx jest tests/oauthUserPiFlow.test.js tests/oauthAdminPiFlow.test.js`
Expected: all green.

```bash
git add demo_api_server/routes/oauthUser.js demo_api_server/routes/oauth.js demo_api_server/services/piFlowDriver.js demo_api_server/tests/oauthUserPiFlow.test.js demo_api_server/tests/oauthAdminPiFlow.test.js
git commit -m "feat(auth): pi.flow open prefills the username from the role's stored hint (both providers)"
```

---

### Task 4: modal prefill + PUT on edit

**Files:**
- Modify: `demo_api_ui/src/components/PiFlowSignInModal.jsx`
- Test: `demo_api_ui/src/components/__tests__/PiFlowSignInModal.test.jsx`

**Interfaces:**
- Consumes: `PUT /api/auth/oauth/{user,}/login-hint` (Task 2), `usernameHint` in the open response (Task 3, already rendered today at line 178 for PF).
- Produces: typing in the modal's username field persists the hint (debounced 800 ms; also on step switch away). No new exports.

- [x] **Step 1: Write the failing tests**

Append in `PiFlowSignInModal.test.jsx` (reuse `mockBff`, `ok`, `ON`, `mountAndClick`):

```js
  test('typing a username PUTs it to /login-hint after the debounce', async () => {
    vi.useFakeTimers();
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', usernameHint: 'stored@pingone.com' }),
      credentials: () => ok({ error: 'invalid_credentials', message: 'no' }, 401),
    });
    await mountAndClick();
    const box = await screen.findByLabelText('Username');
    expect(box.value).toBe('stored@pingone.com'); // prefilled from the open response
    fireEvent.change(box, { target: { value: 'typed@pingone.com' } });
    await act(async () => { vi.advanceTimersByTime(900); });
    const put = global.fetch.mock.calls.find(([u, i]) => String(u).includes('/login-hint') && i?.method === 'PUT');
    expect(put).toBeTruthy();
    expect(JSON.parse(put[1].body)).toEqual({ value: 'typed@pingone.com' });
    vi.useRealTimers();
  });

  test('admin role PUTs to the admin login-hint path', async () => {
    // same as above with roleRef admin — assert the URL contains '/api/auth/oauth/login-hint'
  });
```

(Write the admin variant fully — same shape, `mockBff` config with admin flag `PINGONE_ADMIN_AUTHORIZE_PI_FLOW: 'true'`, dispatch via `navigateToAdminOAuthLogin`.)

- [x] **Step 2: Run to verify failure**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/PiFlowSignInModal.test.jsx -t "login-hint"`
Expected: FAIL — no PUT is made.

- [x] **Step 3: Implement**

In `PiFlowSignInModal.jsx`:

```js
  // Remember who is signing in as: 800 ms after the last keystroke (and when
  // leaving the form step), store the username as the role's login hint. The
  // sign-in callback also stores it; this covers a value typed then abandoned.
  const hintTimerRef = useRef(null);
  const queueHintWrite = (value) => {
    clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => {
      if (!value.trim()) return;
      fetch(`${apiBase()}${apiForRole()}/login-hint`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: value.trim() }),
      }).catch(() => { /* prefill only */ });
    }, 800);
  };
```

Call `queueHintWrite(e.target.value)` in the username input's `onChange` and in the device-username input's `onChange`; call `clearTimeout(hintTimerRef.current)` in the modal's cleanup (the `useEffect` return) and when `begin()` resets state. The prefill already works — line 178 (`setUsername(flow.usernameHint)`) now receives PingOne hints too.

- [x] **Step 4: Run to verify pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/PiFlowSignInModal.test.jsx`
Expected: all green (40 existing + new).

- [x] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/PiFlowSignInModal.jsx demo_api_ui/src/components/__tests__/PiFlowSignInModal.test.jsx
git commit -m "feat(ui): modal prefills and persists the login hint per role"
```

---

### Task 5: passwordless-first default + merge the mfa_only branch

**Files:**
- Modify: `demo_api_ui/src/components/PiFlowSignInModal.jsx` (default `step`, open-failure snap)
- Merge: branch `worktree-passwordless-acr` (commit 369771055 — `acr_values=mfa_only` for `passwordless=1`)
- Test: `demo_api_ui/src/components/__tests__/PiFlowSignInModal.test.jsx`, `demo_api_server/tests/oauthUserPiFlow.test.js`

**Interfaces:**
- Consumes: Tasks 1–4 merged; the modal's existing `device` step, `switchToDevice`, `submitPasswordless`, 409 `passwordless_unavailable` handling (all shipped P1/P2).
- Produces: the modal's first screen is the device-only step; policy-absent 400 snaps to the password form INSIDE the modal.

- [x] **Step 1: Merge the parked branch**

```bash
git merge worktree-passwordless-acr
```

Resolve trivially if needed (it touches `routes/oauth.js`, `routes/oauthUser.js`, `tests/oauthUserPiFlow.test.js` — the acr comment + value `Multi_Factor` → `mfa_only`). Run the driver suites:

Run: `cd demo_api_server && npx jest tests/oauthUserPiFlow.test.js tests/oauthAdminPiFlow.test.js`
Expected: PASS.

- [x] **Step 2: Write the failing tests**

Append in `PiFlowSignInModal.test.jsx`:

```js
  test('the modal opens on the device-only (passwordless) step', async () => {
    mockBff({ config: ON, login: () => ok({ flowId: 'f1', status: 'SIGN_ON_REQUIRED' }), credentials: () => ok({}) });
    await mountAndClick();
    // openFlow is called with passwordless=1 by default now
    const open = global.fetch.mock.calls.find(([u]) => String(u).includes('/login?') && String(u).includes('pi_flow=1'));
    expect(String(open[0])).toContain('passwordless=1');
    expect(await screen.findByText("We'll verify it's you with your registered device — no password needed.")).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  test('policy-absent 400 on the passwordless open snaps to the password form inside the modal', async () => {
    // First open (passwordless=1) fails with 400; the modal re-opens without it
    // and shows the password form — never a redirect.
    let call = 0;
    mockBff({
      config: ON,
      login: () => (++call === 1 ? ok({ error: 'invalid_sign_on_policy' }, 400) : ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' })),
      credentials: () => ok({}),
    });
    await mountAndClick();
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(window.location.href).toBe('');
    expect(assign).not.toHaveBeenCalled();
  });

  test('409 passwordless_unavailable keeps the typed username in the password form', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', status: 'SIGN_ON_REQUIRED' }),
      passwordless: () => ok({ error: 'passwordless_unavailable', message: 'This account requires a password.' }, 409),
      credentials: () => ok({}),
    });
    // extend mockBff with a `passwordless` mock arm if absent
    await mountAndClick();
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'keepme@pingone.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('keepme@pingone.com');
  });

  test('passkey ceremony failure keeps the password one click away (no dead end)', async () => {
    // FIDO2-only user whose authenticator is missing: the passkey step's error
    // state must still offer the path back to the password form.
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({ step: 'passkey', publicKeyCredentialRequestOptions: { challenge: 'abc' } }),
      assertion: () => ok({ error: 'pi_flow_failed' }, 502),
      passwordless: () => ok({ error: 'passwordless_unavailable', message: 'This account requires a password.' }, 409),
    });
    await mountAndClick();
    // device step → policy says password → password form → passkey step fails →
    // the modal still renders the passkey step with its "Use another method"
    // escape hatch (which routes to the redirect login) AND the error text.
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'fidouser@pingone.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/This account requires a password/i)).toBeInTheDocument();
    // switch to password, sign in, land on the passkey step, see the retry affordances
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Verify it is you with your passkey/i)).toBeInTheDocument();
    vi.mocked(authenticateWebAuthn).mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    fireEvent.click(screen.getByRole('button', { name: /verify with passkey/i }));
    expect(await screen.findByText(/No passkey was used/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use another method' })).toBeInTheDocument();
  });
```

Extend `mockBff` at the top of the file with a `passwordless` arm
(`if (String(url).includes('/pi-flow/passwordless')) return passwordless();`).

- [x] **Step 3: Run to verify failure**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/PiFlowSignInModal.test.jsx -t "device-only\|policy-absent\|keeps the typed username"`
Expected: FAIL (today's default step is `password`; a 400 open redirects).

- [x] **Step 4: Implement**

In `PiFlowSignInModal.jsx`:

1. `begin()` sets `setStep('device')` (was `'password'`) and `openFlow(target, role, { passwordless: true })` (was no options).
2. `openFlow`'s catch: when the failure is the passwordless variant AND a retry without it can work, re-open without `passwordless` instead of redirecting:

```js
      } catch {
        if (passwordless) {
          // The mfa_only policy may not exist yet (400 on open). Snap to the
          // password-first flow INSIDE the modal — the default step never
          // redirects to the hosted page.
          setError('Device sign-in is not available yet — use your password.');
          await openFlowInner(target, role, {}); // reopen without passwordless
          return;
        }
        setOpen(false);
        redirectLogin(target, role, forceRef.current);
      }
```

(Rename the existing inner IIFE body to `openFlowInner` or restructure minimally — keep one fetch helper; the plan's executor reads the current function and keeps its shape.)
3. `switchToDevice` / "Use your password instead" links already exist and keep working; the typed device-username already carries to the password form.
4. The `device` step's submit button label stays "Sign in".

- [x] **Step 5: Run to verify pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/PiFlowSignInModal.test.jsx`
Expected: all green. Existing tests that mount and expect the password form by default must be updated to the new default (they assert via `mountAndClick` → find `Username`; update those helpers to the device step's realities — the device step ALSO renders a Username field, so most need only the password-specific assertions moved behind explicit switch clicks).

- [x] **Step 6: Run the whole UI suite + commit**

Run: `cd demo_api_ui && npx vitest run --reporter=dot 2>&1 | tail -4`
Expected: no new failures (pre-existing failures elsewhere in the app are not this branch's to fix; note any in the commit message).

```bash
git add demo_api_ui/src/components/PiFlowSignInModal.jsx demo_api_ui/src/components/__tests__/PiFlowSignInModal.test.jsx
git commit -m "feat(ui): device-only sign-in is the modal's default step; policy-absent snaps to password in-modal"
```

---

### Task 6: server — registration email rule, phone required, ensureSmsDevice

**Files:**
- Modify: `demo_api_server/routes/selfServiceUsers.js` (validators + handler, lines ~43, ~104, ~176)
- Modify: `demo_api_server/services/mfaService.js` (new `ensureSmsDevice` next to `ensureEmailDevice` at line 688; export at line ~1391)
- Test: `demo_api_server/tests/selfServiceUsers.test.js` (new file), `demo_api_server/tests/mfaDevices.route.test.js`

**Interfaces:**
- Consumes: `mfaService.listMfaDevices(userId)` (line 579, returns `{ devices }`), `mfaService.enrollSmsDevice(userId, phone)` (line 705, worker token → ACTIVE), `ensureEmailDevice` (line 688).
- Produces: `mfaService.ensureSmsDevice(userId, phone)` → `{ status: 'existing'|'created', ... }`; `POST /api/self-service/users` response gains `mfaSmsDevice`; email rule enforced server-side; phone required.

- [x] **Step 1: Write the failing tests**

Create `demo_api_server/tests/selfServiceUsersRegistration.test.js`:

```js
const request = require('supertest');
const express = require('express');

jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  searchUsers: jest.fn().mockResolvedValue({ _embedded: { users: [] } }),
  createPingOneUser: jest.fn().mockResolvedValue({
    id: 'u-1', email: 'new.user@pingidentity.com', username: 'newuser',
    name: 'New User', enabled: true, createdAt: '2026-10-10T00:00:00Z',
  }),
  ensureAdminRoleAssignments: jest.fn().mockResolvedValue([]),
}));
jest.mock('../services/mfaService', () => ({
  ensureEmailDevice: jest.fn().mockResolvedValue({ status: 'created', deviceId: 'd-e' }),
  ensureSmsDevice: jest.fn().mockResolvedValue({ status: 'created', deviceId: 'd-s' }),
}));
jest.mock('../services/posthog', () => ({ capture: jest.fn() }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  LOG_CATEGORIES: { USER_MANAGEMENT: 'user_management' },
}));

const router = require('../routes/selfServiceUsers');

const app = express();
app.use(express.json());
app.use('/api/self-service/users', router);

const validBody = () => ({
  email: 'new.user@pingidentity.com',
  username: 'newuser',
  firstName: 'New',
  lastName: 'User',
  password: 'Password1',
  phone: '+15551234567',
});

describe('POST /api/self-service/users — registration device + email rules', () => {
  test('enrolls BOTH an email and an SMS device for a valid registration', async () => {
    const { default: mfa } = { default: null };
    const mfaService = require('../services/mfaService');
    const res = await request(app).post('/api/self-service/users').send(validBody());
    expect(res.status).toBe(201);
    expect(res.body.mfaEmailDevice).toEqual({ status: 'created', deviceId: 'd-e' });
    expect(res.body.mfaSmsDevice).toEqual({ status: 'created', deviceId: 'd-s' });
    expect(mfaService.ensureSmsDevice).toHaveBeenCalledWith('u-1', '+15551234567');
  });

  test.each([
    'user+p1@pingone.com',
    'someone@gmail.com',
    'odd@notping.dev',
  ])('rejects email %s (plus-addressed or off-domain)', async (bad) => {
    const res = await request(app).post('/api/self-service/users').send({ ...validBody(), email: bad });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/pingidentity\.com|pingone\.com/);
  });

  test('phone is required', async () => {
    const { phone: _omit, ...noPhone } = validBody();
    const res = await request(app).post('/api/self-service/users').send(noPhone);
    expect(res.status).toBe(400);
  });

  test('SMS enrollment failure does not fail registration', async () => {
    const mfaService = require('../services/mfaService');
    mfaService.ensureSmsDevice.mockRejectedValueOnce(new Error('pingone 503'));
    const res = await request(app).post('/api/self-service/users').send(validBody());
    expect(res.status).toBe(201);
    expect(res.body.mfaSmsDevice.status).toBe('failed');
  });
});
```

Check how `routes/selfServiceUsers.js` imports its collaborators (`pingOneUserService`, `mfaService`, logger, posthog) and match the mock paths to the REAL import specifiers — read the file's requires first and adjust the `jest.mock` paths accordingly.

- [x] **Step 2: Run to verify failure**

Run: `cd demo_api_server && npx jest tests/selfServiceUsersRegistration.test.js`
Expected: FAIL — no `mfaSmsDevice` in the response, bad emails accepted, missing phone accepted, `ensureSmsDevice` not exported.

- [x] **Step 3: Implement**

In `services/mfaService.js`, after `ensureEmailDevice` (line 693):

```js
/**
 * Idempotent SMS enrollment for provisioning paths (registration, seeds):
 * skips when an SMS device with the same phone already exists; otherwise
 * enrolls with the WORKER token, which creates the device ACTIVE — no OTP
 * verification loop, because registration precedes any session.
 * @param {string} userId
 * @param {string} phone - E.164, e.g. +15551234567
 */
async function ensureSmsDevice(userId, phone) {
  const { devices } = await listMfaDevices(userId);
  const existing = devices.find((d) => d.type === 'SMS' && (d.phone || '').replace(/\D/g, '') === String(phone).replace(/\D/g, ''));
  if (existing) return { status: 'existing', deviceId: existing.id };
  const device = await enrollSmsDevice(userId, phone);
  return { status: 'created', deviceId: device.id, deviceStatus: device.status };
}
```

Add `ensureSmsDevice,` to the module.exports (next to `ensureEmailDevice,`).

In `routes/selfServiceUsers.js`:

1. Validators — replace the email validator:

```js
    body('email')
      .isEmail()
      .normalizeEmail()
      .matches(/^[^+]+@(pingidentity\.com|pingone\.com)$/i)
      .withMessage('Email must be @pingidentity.com or @pingone.com (plus-addressing is not supported)'),
```

2. Phone required — change `body('phone').optional()` to:

```js
    body('phone')
      .isMobilePhone()
      .withMessage('A valid phone number is required (enrolled as an MFA device)'),
```

3. Handler — after the `mfaEmailDevice` block (~line 176), add:

```js
      // A second device class makes passwordless robust (an email device alone
      // leaves SMS-only policies unusable). Non-fatal like the email device.
      let mfaSmsDevice;
      try {
        mfaSmsDevice = await mfaService.ensureSmsDevice(user.id, phone);
      } catch (smsError) {
        logger.warn(LOG_CATEGORIES.USER_MANAGEMENT, 'Could not enroll SMS MFA device for new user', {
          userId: user.id,
          error: smsError.message
        });
        mfaSmsDevice = { status: 'failed', error: smsError.message };
      }
```

and add `mfaSmsDevice` to the 201 response object.

- [x] **Step 4: Run to verify pass**

Run: `cd demo_api_server && npx jest tests/selfServiceUsersRegistration.test.js tests/selfServiceUsersAdminGate.test.js`
Expected: PASS (the admin-gate suite's bodies may need `phone` added to their fixtures — do so).

- [x] **Step 5: Commit**

```bash
git add demo_api_server/routes/selfServiceUsers.js demo_api_server/services/mfaService.js demo_api_server/tests/selfServiceUsersRegistration.test.js demo_api_server/tests/selfServiceUsersAdminGate.test.js
git commit -m "feat(auth): registration enrolls EMAIL+SMS devices; email domain rule; phone required"
```

---

### Task 7: client — registration form mirrors the server rules

**Files:**
- Modify: `demo_api_ui/src/components/SelfServicePage.js` (validateForm ~line 89; phone section ~line 399)
- Test: `demo_api_ui/src/components/__tests__/SelfServicePage.test.jsx` (create if absent — check first)

**Interfaces:**
- Consumes: server rules from Task 6.
- Produces: client-side errors before any POST: email domain/plus rule, phone required.

- [x] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/SelfServicePage.test.jsx`. The form's labels are NOT
`htmlFor`-associated (no `getByLabelText`), so select by placeholder / class query. The page
renders under `/self-service` with a tab set — if the create form is not the default tab in the
test render, click the create tab first (read the component's tab state to find the default;
the create form is at line ~267 `<form onSubmit={handleCreate} className="ssp-form">`).

```jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SelfServicePage from '../SelfServicePage';

// Inputs carry placeholders: "your.email@example.com", "username",
// "Enter your password", "Confirm your password", "+1-555-0100" (phone).
// First/Last name have NO placeholder — use container.querySelector('.ssp-input').
const type = (input, value) => fireEvent.change(input, { target: { value } });

async function fillForm({ email = 'new.user@pingidentity.com', phone = '+15551234567' } = {}) {
  const { container } = render(<SelfServicePage />);
  const inputs = container.querySelectorAll('.ssp-input');
  // Order in the form: firstName, lastName, email, username, password, confirmPassword, phone
  type(inputs[0], 'New');
  type(inputs[1], 'User');
  type(inputs[2], email);
  type(inputs[3], 'newuser');
  type(inputs[4], 'Password1');
  type(inputs[5], 'Password1');
  type(inputs[6], phone);
  return container;
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: async () => ({}) }));
});

describe('SelfServicePage registration validation', () => {
  test.each([
    ['user+p1@pingone.com', 'plus-addressing'],
    ['someone@gmail.com', 'pingidentity.com or pingone.com'],
  ])('rejects %s with a rule-naming message', async (bad, fragment) => {
    const { container } = await fillForm({ email: bad });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(container.textContent).toMatch(new RegExp(fragment, 'i'));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('empty phone blocks submission with a required-phone message', async () => {
    const { container } = await fillForm({ phone: '' });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(container.textContent).toMatch(/phone is required/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('valid form submits to /api/self-service/users with phone', async () => {
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await Promise.resolve();
    const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/self-service/users'));
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1].body).phone).toBe('+15551234567');
  });
});
```

Verify the input order assumption (`.ssp-input` query order matches first/last/email/username/
password/confirm/phone) by reading the form JSX at lines 267–415 before running — if the phone
input is absent from that NodeList (different class), adjust the selector, not the test's
contract.

- [x] **Step 2: Run to verify failure**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/SelfServicePage.test.jsx`
Expected: FAIL.

- [x] **Step 3: Implement**

In `validateForm` (line ~89), replace the email check with:

```js
    if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.email = 'Valid email is required';
    } else if (data.email.includes('+')) {
      errors.email = 'Plus-addressing is not supported — use your base @pingidentity.com or @pingone.com address';
    } else if (!/@(pingidentity\.com|pingone\.com)$/i.test(data.email)) {
      errors.email = 'Email must be @pingidentity.com or @pingone.com';
    }
    if (!data.phone?.trim()) {
      errors.phone = 'Phone is required — it is enrolled as an MFA device for passwordless sign-in';
    }
```

Change the phone section's heading `Contact Information (Optional)` to `Contact Information` and the label to `Phone Number *`.

- [x] **Step 4: Run to verify pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/SelfServicePage.test.jsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/SelfServicePage.js demo_api_ui/src/components/__tests__/SelfServicePage.test.jsx
git commit -m "feat(ui): registration form enforces the email rule and requires phone"
```

---

### Task 8: signInService + authUi wrappers

**Files:**
- Create: `demo_api_ui/src/utils/signInService.js`
- Modify: `demo_api_ui/src/utils/authUi.js` (the three dispatchers become wrappers)
- Create: `demo_api_ui/src/utils/__tests__/signInService.test.js`
- Test: `demo_api_ui/src/utils/authUi.sessionDetail.test.js` (must stay green)

**Interfaces:**
- Consumes: `PI_FLOW_SIGNIN_EVENT` (authUi.js:339), `/api/admin/config`.
- Produces: `openSignIn({ role, returnTo, force })`, `openAdminSignIn({ returnTo, force })`, `isSignInAvailable()`, `initSignInService()` (idempotent config fetch). The modal keeps its own config gate fetch as-is (no new event contract); the service's cached availability backs `openSignIn`'s fallback decision and `isSignInAvailable()` for call sites. `openAdminSignIn({ returnTo, force })` = `openSignIn({ role: 'admin', returnTo, force })`.

- [x] **Step 1: Write the failing tests**

Create `demo_api_ui/src/utils/__tests__/signInService.test.js`:

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { openSignIn, isSignInAvailable, initSignInService, _resetSignInServiceForTests } from '../signInService';
import { PI_FLOW_SIGNIN_EVENT } from '../authUi';

const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const ON = { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', PINGONE_ADMIN_AUTHORIZE_PI_FLOW: 'false', oauth_provider: 'pingone' };

describe('signInService', () => {
  let handled;
  beforeEach(() => {
    handled = null;
    _resetSignInServiceForTests();
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, (e) => { handled = e.detail; e.detail.handled = true; });
  });

  test('init fetches config once and caches availability', async () => {
    global.fetch = vi.fn(() => ok({ config: ON }));
    await initSignInService();
    await initSignInService();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(isSignInAvailable()).toBe(true);
  });

  test('openSignIn dispatches the modal event with role/returnTo/force', async () => {
    global.fetch = vi.fn(() => ok({ config: ON }));
    await initSignInService();
    openSignIn({ returnTo: '/x', force: true });
    expect(handled).toMatchObject({ returnTo: '/x', force: true, role: 'customer' });
  });

  test('admin role requests the admin availability', async () => {
    global.fetch = vi.fn(() => ok({ config: ON }));
    await initSignInService();
    openSignIn({ role: 'admin' });
    expect(handled).toMatchObject({ role: 'admin' });
  });

  test('flag off: openSignIn falls back to the redirect (window.location)', async () => {
    global.fetch = vi.fn(() => ok({ config: { PINGONE_USER_AUTHORIZE_PI_FLOW: 'false', oauth_provider: 'pingone' } }));
    await initSignInService();
    openSignIn({});
    expect(window.location.href).toContain('/api/auth/oauth/user/login');
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/signInService.test.js`
Expected: FAIL — module missing.

- [x] **Step 3: Implement**

Create `demo_api_ui/src/utils/signInService.js`:

```js
// One entry point for every sign-in in the app: opens the branded pi.flow
// modal when the BFF reports it drivable, and falls back to the redirect
// login in exactly one place. `authUi`'s navigateTo*Login functions are thin
// wrappers over this module, and the de-bypassed pages call it directly.
import { PI_FLOW_SIGNIN_EVENT, navigateToCustomerOAuthLoginRaw, navigateToCustomerOAuthForceLoginRaw, navigateToAdminOAuthLoginRaw } from './authUi';

let inited = null;
let available = { customer: false, admin: false };

export function isSignInAvailable() {
  return available;
}

export function initSignInService() {
  if (!inited) {
    inited = (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/admin/config`, { credentials: 'include' });
        const cfg = (await res.json())?.config || {};
        const drivable = ['pingone', 'pingfederate'].includes(cfg.oauth_provider || 'pingone');
        available = {
          customer: drivable && ['true', '1'].includes(String(cfg.PINGONE_USER_AUTHORIZE_PI_FLOW).toLowerCase()),
          admin: drivable && ['true', '1'].includes(String(cfg.PINGONE_ADMIN_AUTHORIZE_PI_FLOW).toLowerCase()),
        };
      } catch {
        available = { customer: false, admin: false }; // redirect fallback
      }
    })();
  }
  return inited;
}

export function openSignIn({ role = 'customer', returnTo, force } = {}) {
  if (available[role === 'admin' ? 'admin' : 'customer'] && typeof window !== 'undefined') {
    const detail = { returnTo, role, force: Boolean(force), handled: false };
    window.dispatchEvent(new CustomEvent(PI_FLOW_SIGNIN_EVENT, { detail }));
    if (detail.handled) return;
  }
  // One fallback, in one place.
  if (role === 'admin') navigateToAdminOAuthLoginRaw(returnTo);
  else if (force) navigateToCustomerOAuthForceLoginRaw(returnTo);
  else navigateToCustomerOAuthLoginRaw(returnTo);
}

function apiBase() {
  return process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
}

export function openAdminSignIn({ returnTo, force } = {}) {
  return openSignIn({ role: 'admin', returnTo, force });
}

export function _resetSignInServiceForTests() {
  inited = null;
  available = { customer: false, admin: false };
}
```

In `authUi.js`: rename the redirect legs of `navigateToCustomerOAuthLogin`/`navigateToCustomerOAuthForceLogin`/`navigateToAdminOAuthLogin` to exported `*Raw` functions (redirect only, no event — `navigateToCustomerOAuthForceLoginRaw(returnTo)` keeps the `?force=true` query), and make the public three call `openSignIn` (importing from `signInService`). Keep their signatures and the `SESSION_REAUTH_EVENT`/`requestSilentReauth` exports untouched. Watch for a circular import: `signInService` imports the Raw functions from `authUi`, `authUi` imports `openSignIn` from `signInService` — ESM handles this via hoisted function declarations, but if the bundler complains, move the Raw redirect helpers into a third module `redirectLogin.js` and have both import it.

Also: `App.js` mounts `<PiFlowSignInModal />` (line 714) — add an `initSignInService()` call in App's existing boot effect so availability is warm before any click.

- [x] **Step 4: Run to verify pass**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/signInService.test.js src/utils/authUi.sessionDetail.test.js src/components/__tests__/PiFlowSignInModal.test.jsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add demo_api_ui/src/utils/signInService.js demo_api_ui/src/utils/authUi.js demo_api_ui/src/utils/__tests__/signInService.test.js demo_api_ui/src/App.js
git commit -m "feat(ui): signInService — one entry point, one fallback, warm config"
```

---

### Task 9: de-bypass the 7 files

**Files:**
- Modify: `demo_api_ui/src/components/LandingPage.js` (lines 131, 145)
- Modify: `demo_api_ui/src/components/AIAgent.js` (lines ~4027, ~4057 — delete the dead `use_pi_flow` param)
- Modify: `demo_api_ui/src/components/OAuthTokenDisplayPage.jsx` (line 424 + remove its inline driver usage — see below)
- Modify: `demo_api_ui/src/components/PingOneProviderGuard.jsx` (line 51)
- Modify: `demo_api_ui/src/vertical/AdminEditor/VerticalEditorPage.jsx` (line 213)
- Modify: `demo_api_ui/src/pages/TokenExchangeTesterPage.jsx` (line 134)
- Modify: `demo_api_ui/src/components/PingFederateDownModal.jsx` (line 37)
- Test: each file's nearest test file (create minimal ones where absent)

**Interfaces:**
- Consumes: `openSignIn` / `openAdminSignIn` (Task 8).
- Produces: no raw redirect to `/api/auth/oauth*/login` outside the exceptions list.

- [x] **Step 1: Write the failing tests (one per file, minimal)**

For each file, one test asserting the sign-in trigger dispatches `PI_FLOW_SIGNIN_EVENT` (via `openSignIn`) instead of setting `window.location`. Pattern (adapt selectors/mount to each file's existing tests):

```jsx
  test('sign-in opens the pi.flow modal, not a redirect', async () => {
    const handled = vi.fn((e) => { e.detail.handled = true; });
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, handled);
    render(<TargetComponent ... />);          // match existing test setup
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(handled).toHaveBeenCalled();
    expect(window.location.href).toBe('');
  });
```

Where the component's existing test setup already exists (LandingPage, AIAgent, OAuthTokenDisplayPage all have suites), EXTEND those files instead of creating new ones.

- [x] **Step 2: Run to verify failure**

Run: `cd demo_api_ui && npx vitest run src/components src/pages --reporter=dot 2>&1 | tail -6`
Expected: the new tests FAIL (raw redirects today).

- [x] **Step 3: Implement, file by file**

- `LandingPage.js:131`: `window.location.href = "/api/auth/oauth/login"` → `openAdminSignIn({ returnTo: window.location.pathname })`. Line 145: `navigateWithOverlay(".../user/login?return_to=/use-cases/live", …)` → `openSignIn({ returnTo: '/use-cases/live' })`.
- `AIAgent.js` ~4027: admin action redirect → `openAdminSignIn({ returnTo: location.pathname })`. ~4057: customer default → `openSignIn({ returnTo })`; DELETE the `marketing_customer_login_mode === 'slide_pi_flow'` config fetch and `use_pi_flow` param (nothing consumes the param server-side).
- `OAuthTokenDisplayPage.jsx:424`: the `navigateWithOverlay(... /login?return_to=...)` → `openSignIn({ returnTo: window.location.pathname })`. Its inline pi.flow driver (`startEmbeddedSignInFromUrl`/`submitPassword`/`finishPiFlow`, `mode=pi.flow` at line 216, and the username/password form state) is REMOVED — sign-in for this page is the modal; the page's pre-auth token-display machinery is untouched. Delete now-unused state/imports (`piFlowStep`, `piFlowSession`, `username`, `password`, the `embeddedPiFlow` imports) and the credentials form JSX. Its test file `OAuthTokenDisplayPage.piFlow.test.jsx` tests the removed driver — DELETE that test file in the same commit (the page's other tests stay).
- `PingOneProviderGuard.jsx:51`: after the provider-switch cleanup, `openSignIn({ returnTo })` instead of `navigateWithOverlay`.
- `VerticalEditorPage.jsx:213`: `openAdminSignIn({ returnTo: '/admin-editor' })` (read the file for its actual return path).
- `TokenExchangeTesterPage.jsx:134`: `LOGIN_URL` constant removed; `openSignIn({ returnTo: '/token-exchange-tester' })`.
- `PingFederateDownModal.jsx:37`: its "sign in anyway" action → `openSignIn({ returnTo: window.location.pathname })`.

- [x] **Step 4: Run to verify pass**

Run: `cd demo_api_ui && npx vitest run --reporter=dot 2>&1 | tail -6`
Expected: new tests PASS; no new failures elsewhere.

- [x] **Step 5: Guardrail test — nothing else redirects**

Append to `signInService.test.js`:

```js
  test('no source outside the exceptions redirects to a BFF login endpoint', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '../../../..');
    const exceptions = ['utils/authUi.js', 'utils/signInService.js', 'utils/redirectLogin.js', 'components/PiFlowSignInModal.jsx', 'hooks/useAuth.js', 'components/LogoutPage.js', 'pages/SdkLoginPage.jsx', 'components/sdk-login/EmbeddedSignInForm.jsx', 'lib/embeddedPiFlow.js'];
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '__tests__' || e.name === 'node_modules') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(e.name)) {
          const rel = path.relative(root, p);
          if (exceptions.some((x) => rel.endsWith(x))) continue;
          const text = fs.readFileSync(p, 'utf8');
          if (/["'`](\/api\/auth\/oauth(\/user)?\/(login|stepup))|["'`]\/api\/auth\/reauth/.test(text)) offenders.push(rel);
        }
      }
    };
    walk(path.join(root, 'src'));
    expect(offenders).toEqual([]);
  });
```

- [x] **Step 6: Run + commit**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/signInService.test.js`
Expected: PASS (offenders list empty).

```bash
git add -A demo_api_ui/src
git commit -m "feat(ui): every sign-in trigger routes through signInService; OAuthTokenDisplayPage's duplicate driver removed"
```

---

### Task 10: PF MFA driven in the modal

**Files:**
- Modify: `demo_api_server/services/piFlowDriver.js` (`respondAfterPiFlowStep` — PF status mapping)
- Modify: `demo_api_ui/src/components/PiFlowSignInModal.jsx` (remove the `mfaRequested() && PF` early redirect in `begin()`)
- Test: `demo_api_server/tests/oauthAdminPiFlow.test.js`, `demo_api_ui/src/components/__tests__/PiFlowSignInModal.test.jsx`

**Interfaces:**
- Consumes: the driver's existing PF step support (`checkUsernamePassword`, `otp.check`, device-select with `pf ? 'application/json'`).
- Produces: PF `OTP_REQUIRED` / `DEVICE_SELECTION_REQUIRED` drive in the modal. `PUSH_CONFIRMATION_WAITING` stays `fallback:true` (needs polling; out of scope).

- [x] **Step 1: Write the failing tests**

In `tests/oauthAdminPiFlow.test.js` (PF describe block), the existing test at line 170 asserts `PUSH_CONFIRMATION_WAITING → { fallback: true }` — KEEP it. Add:

```js
    test('PF OTP_REQUIRED after the password drives in the modal (no fallback)', async () => {
      const agent = request.agent(app);
      await openPfFlow(agent);
      fetchMock
        .mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED', devices: [{ id: 'pf-otp-1', type: 'OTP' }] }))
        .mockResolvedValueOnce(json(200, { status: 'COMPLETED', authorizeResponse: { code: 'pf-code-2' } }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials')
        .send({ username: 'u', password: 'p' }).expect(200);
      expect(res.body.step).toBe('otp');
    });
```

(Read `openPfFlow` in that file and use its flow id/cookies exactly as the existing PF tests do; this test mirrors the PingOne OTP test but for a PF flow — if a same-shaped test already passes, write the missing piece: the MODAL side.)

In `PiFlowSignInModal.test.jsx`:

```js
  test('?signin=mfa on PingFederate drives OTP in the modal (no hosted detour)', async () => {
    window.location.search = '?signin=mfa';
    mockBff({
      config: { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingfederate' },
      login: () => ok({ flowId: 'pf1', usernameHint: 'demouser' }),
      credentials: () => ok({ step: 'otp', devices: [{ id: 'pf-otp-1', type: 'OTP' }] }),
      assertion: () => ok({}),
    });
    await mountAndClick();
    expect(await screen.findByText(/verification code/i)).toBeInTheDocument();
    expect(window.location.href).toBe('');   // no redirect to /stepup
  });
```

- [x] **Step 2: Run to verify failure**

Run: `cd demo_api_server && npx jest tests/oauthAdminPiFlow.test.js -t "PF OTP_REQUIRED"` and `cd demo_api_ui && npx vitest run src/components/__tests__/PiFlowSignInModal.test.jsx -t "PingFederate drives OTP"`
Expected: server test may already pass (driver maps OTP for both providers — verify); modal test FAILS (the `begin()` early-redirect for `mfaRequested() && PF`).

- [x] **Step 3: Implement**

In `PiFlowSignInModal.jsx` `begin()`: delete the

```js
    if (mfaRequested() && providerRef.current === "pingfederate") {
      redirectLogin(target, role, detail.force);
      return;
    }
```

block and its comment. The driver's `fallback:true` for `PUSH_CONFIRMATION_WAITING` remains the safety net for PF methods the modal can't drive.

- [x] **Step 4: Run to verify pass**

Run: `cd demo_api_server && npx jest tests/oauthAdminPiFlow.test.js tests/oauthUserPiFlow.test.js && cd demo_api_ui && npx vitest run src/components/__tests__/PiFlowSignInModal.test.jsx`
Expected: PASS (the PF-MFA-hosted-detour test at line ~172 must be updated — it asserts the detour).

- [x] **Step 5: Commit**

```bash
git add demo_api_server/services/piFlowDriver.js demo_api_ui/src/components/PiFlowSignInModal.jsx demo_api_server/tests/oauthAdminPiFlow.test.js demo_api_ui/src/components/__tests__/PiFlowSignInModal.test.jsx
git commit -m "feat(auth): PingFederate MFA steps drive in the pi.flow modal; PUSH stays a fallback"
```

---

### Task 11: full verification + live drive

> Not live-verified: steps 1-5 of the live drive were not run (AIC login toggle on the local stack redirects to AIC; PingOne drive unverified as of 2026-10-14). Tests for Tasks 1-10 pass.

**Files:**
- None (verification only)

- [ ] **Step 1: Full server suite**

Run: `cd demo_api_server && npx jest --silent 2>&1 | tail -5`
Expected: no new failures vs the pre-branch baseline (record the baseline counts in the ledger before starting).

- [ ] **Step 2: Full UI suite + build**

Run: `cd demo_api_ui && npx vitest run --reporter=dot 2>&1 | tail -6 && npm run build 2>&1 | tail -3`
Expected: green; build completes.

- [ ] **Step 3: Live drive (after focused deploy)**

Deploy per `scripts/deploy-live.sh` (post-merge), then:

1. Sign in as demoUser from `https://local.ping-devops.com:4000` — expect the modal, device step default, password fallback working.
2. Sign out, sign in again — expect the username prefilled (configStore hint).
3. Register a new user via `/self-service` with a `@pingidentity.com` email + phone — expect 201 with both devices enrolled; sign in as that user passwordless (only if `mfa_only` policy exists — otherwise expect the in-modal snap to password).
4. Container restart (`docker restart ai-demo-api-server`) — sign in again; hint still prefilled (LMDB persistence).
5. Confirm the two screenshot surfaces: a protected page signed-out shows the SignInPrompt card; clicking Sign in opens the MODAL (not a redirect). Session-expiry interrupt likewise.

- [ ] **Step 4: Final review + merge**

Whole-branch review (fresh reviewer if dispatching subagent-driven), fix pass, PR, CI dispatch (`gh workflow run ci.yml --ref <branch>` — PR triggers are dead), merge, focused deploy, verify container file hashes match the merge.
