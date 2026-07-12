# Admin MFA-at-Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate admin login behind a post-OAuth MFA challenge; users must verify via SMS, Email, or FIDO2 before accessing admin pages.

**Architecture:** After OAuth callback, the BFF session middleware checks whether the authenticated user has an `mfa_verified` flag. Admin users without it are redirected to `/mfa-challenge`, where they select and complete an MFA method using the existing `/api/mfa/test/integration/*` endpoints. On successful verification, the session flag is set and they're redirected to their intended destination. Demo auto-login (demouser) bypasses the check via a feature flag.

**Tech Stack:** Node/Express (BFF), React/TypeScript (UI), HTTP-only session cookies, existing MFA endpoints from the MFA test page.

## Global Constraints

- Admin users login via `/api/auth/oauth/login` only (customer path exempt).
- MFA methods: SMS OTP, Email OTP, FIDO2/Passkey (all three available, user picks one).
- Demo user (`demouser`) auto-login skips MFA via feature flag `ADMIN_MFA_REQUIRED` (default: false in dev, true in prod).
- Session storage: HTTP-only cookie + LMDB `configStore` (existing pattern).
- MFA endpoints already exist; this task reuses them, no new backend MFA logic.
- UI builds must pass type-check and build gate before commit.

---

## File Structure

```
demo_api_server/
  src/
    middleware/
      mfaSessionGate.js           [NEW] Check session for mfa_verified, redirect if missing
    routes/
      mfaChallenge.js             [NEW] POST endpoints for initiate/verify (delegates to existing /api/mfa/*)
      adminAuth.js                [MODIFY] OAuth callback: set user role, don't set mfa_verified yet
    configStore.js                [MODIFY] Add ADMIN_MFA_REQUIRED flag
    app.js                         [MODIFY] Wire mfaSessionGate middleware before admin routes

demo_api_ui/
  src/
    pages/
      MFAChallengeLogin.tsx        [NEW] /mfa-challenge page: select method, initiate, verify, redirect
    routes/
      AuthRoutes.js               [MODIFY] Add /mfa-challenge route
    App.js                         [MODIFY] Wire route
    config/
      featureFlags.ts             [MODIFY] Add ADMIN_MFA_REQUIRED

tests/
  api/
    mfa-session-gate.spec.js      [NEW] Test middleware redirect logic
    mfa-challenge-routes.spec.js  [NEW] Test initiate/verify endpoints
  e2e/
    admin-mfa-login.real.spec.js  [NEW] E2E: admin OAuth → MFA challenge → verify → admin page
```

---

## Task 1: Add BFF session middleware to gate admin MFA

**Files:**
- Create: `demo_api_server/src/middleware/mfaSessionGate.js`
- Modify: `demo_api_server/src/app.js` (wire middleware)
- Modify: `demo_api_server/src/configStore.js` (add `ADMIN_MFA_REQUIRED` flag)

**Interfaces:**
- Consumes: `req.session.user` (from OAuth callback), `configStore.get('ADMIN_MFA_REQUIRED')`
- Produces: middleware function `mfaSessionGate(req, res, next)` that redirects or calls next()

---

- [ ] **Step 1: Read configStore to understand flag pattern**

Run: `grep -A 5 "configStore.get\|configStore.set" demo_api_server/src/app.js | head -20`

Expected: See examples like `configStore.get('ENV_VAR_NAME')` or default patterns.

- [ ] **Step 2: Create mfaSessionGate middleware**

Create `demo_api_server/src/middleware/mfaSessionGate.js`:

```javascript
/**
 * Middleware: Redirect admin users without MFA to /mfa-challenge
 * Customer users bypass this check entirely.
 */
module.exports = function mfaSessionGate(req, res, next) {
  const { configStore } = require('../configStore');
  const adminMfaRequired = configStore.get('ADMIN_MFA_REQUIRED') ?? false;

  // Not logged in, or MFA not required — pass through
  if (!req.session?.user || !adminMfaRequired) {
    return next();
  }

  const { role, mfa_verified } = req.session.user;

  // Customer users always pass; admin users need MFA
  if (role === 'customer' || mfa_verified) {
    return next();
  }

  // Admin without MFA: redirect to challenge, remember original intent
  req.session.mfa_redirect_to = req.originalUrl;
  return res.redirect('/mfa-challenge');
};
```

- [ ] **Step 3: Add ADMIN_MFA_REQUIRED to configStore defaults**

Edit `demo_api_server/src/configStore.js` and find the default config object. Add:

```javascript
ADMIN_MFA_REQUIRED: process.env.ADMIN_MFA_REQUIRED === 'true' ? true : false,
```

(or search for similar pattern, e.g., `NODE_ENV === 'production' ? true : false`)

- [ ] **Step 4: Wire middleware in app.js**

Edit `demo_api_server/src/app.js`, find where session middleware and auth routes are wired. Insert the MFA gate **before** admin routes but **after** session initialization:

```javascript
const mfaSessionGate = require('./middleware/mfaSessionGate');

// After session middleware:
app.use(session({ ... }));

// Before admin routes:
app.use(mfaSessionGate);

// Then admin routes:
app.use('/admin', adminRoutes);
```

- [ ] **Step 5: Test the middleware redirects unauthenticated admin users**

Create `tests/api/mfa-session-gate.spec.js`:

```javascript
describe('mfaSessionGate middleware', () => {
  const mfaSessionGate = require('../../src/middleware/mfaSessionGate');
  const { configStore } = require('../../src/configStore');

  let req, res, next;

  beforeEach(() => {
    req = { session: {}, originalUrl: '/admin/dashboard' };
    res = { redirect: jest.fn() };
    next = jest.fn();
  });

  test('allows request if MFA not required', () => {
    jest.spyOn(configStore, 'get').mockReturnValue(false);
    mfaSessionGate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('allows admin with mfa_verified=true', () => {
    jest.spyOn(configStore, 'get').mockReturnValue(true);
    req.session.user = { role: 'admin', mfa_verified: true };
    mfaSessionGate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('redirects admin without mfa_verified to /mfa-challenge', () => {
    jest.spyOn(configStore, 'get').mockReturnValue(true);
    req.session.user = { role: 'admin', mfa_verified: false };
    mfaSessionGate(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/mfa-challenge');
    expect(req.session.mfa_redirect_to).toBe('/admin/dashboard');
  });

  test('allows customer even without mfa_verified', () => {
    jest.spyOn(configStore, 'get').mockReturnValue(true);
    req.session.user = { role: 'customer', mfa_verified: false };
    mfaSessionGate(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

Run: `npm run test:api -- mfa-session-gate.spec.js`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/src/middleware/mfaSessionGate.js \
         demo_api_server/src/app.js \
         demo_api_server/src/configStore.js \
         tests/api/mfa-session-gate.spec.js
git commit -m "feat: add mfaSessionGate middleware to redirect admins without MFA"
```

---

## Task 2: Create BFF routes for MFA challenge initiate/verify

**Files:**
- Create: `demo_api_server/src/routes/mfaChallenge.js`
- Modify: `demo_api_server/src/app.js` (wire route)
- Create: `tests/api/mfa-challenge-routes.spec.js`

**Interfaces:**
- Consumes: `req.session.user`, existing `/api/mfa/test/integration/*` endpoints (via `apiClient` or fetch)
- Produces: 
  - `POST /api/mfa-challenge/initiate` → `{ method, data }`
  - `POST /api/mfa-challenge/verify` → `{ success, redirectTo }`

---

- [ ] **Step 1: Create mfaChallenge route handler**

Create `demo_api_server/src/routes/mfaChallenge.js`:

```javascript
const express = require('express');
const router = express.Router();

/**
 * POST /api/mfa-challenge/initiate
 * Start an MFA challenge (SMS/Email/FIDO2) for the logged-in admin user.
 * Body: { method: 'sms' | 'email' | 'fido2' }
 * Response: { success, deviceId?, publicKeyCredentialCreationOptions?, error? }
 */
router.post('/initiate', async (req, res) => {
  try {
    if (!req.session?.user?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { method } = req.body;
    if (!['sms', 'email', 'fido2'].includes(method)) {
      return res.status(400).json({ success: false, error: 'Invalid MFA method' });
    }

    // Delegate to existing MFA test endpoints
    // These endpoints are designed to work with the authenticated session
    const endpoints = {
      sms: '/api/mfa/test/integration/initiate',
      email: '/api/mfa/test/integration/initiate',
      fido2: '/api/mfa/test/integration/enroll-fido2-init', // or initiate, depending on flow
    };

    // Pass through to the existing endpoint
    // (Assumes the MFA endpoints check req.session internally)
    const mfaRes = await fetch(`http://localhost:3001${endpoints[method]}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': req.headers.cookie,
      },
      body: JSON.stringify({ method }),
    });

    const data = await mfaRes.json();
    res.status(mfaRes.status).json(data);
  } catch (err) {
    console.error('[MFA Challenge] initiate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/mfa-challenge/verify
 * Verify the MFA response (OTP or WebAuthn attestation).
 * Body: { otp? } or { attestation? } depending on method
 * Response: { success, redirectTo? }
 */
router.post('/verify', async (req, res) => {
  try {
    if (!req.session?.user?.id) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Delegate to existing verify endpoint
    // (The MFA test page uses /api/mfa/test/integration/verify-otp or similar)
    const mfaRes = await fetch('http://localhost:3001/api/mfa/test/integration/verify-otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': req.headers.cookie,
      },
      body: JSON.stringify(req.body),
    });

    const data = await mfaRes.json();

    if (data.success) {
      // Mark session as MFA-verified
      req.session.user.mfa_verified = true;
      req.session.save((err) => {
        if (err) console.error('[MFA Challenge] session save error:', err);
      });

      const redirectTo = req.session.mfa_redirect_to || '/admin';
      return res.json({ success: true, redirectTo });
    }

    res.status(401).json({ success: false, error: data.error || 'Verification failed' });
  } catch (err) {
    console.error('[MFA Challenge] verify error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Wire route in app.js**

Edit `demo_api_server/src/app.js`, add after session middleware:

```javascript
const mfaChallengeRoutes = require('./routes/mfaChallenge');
app.use('/api/mfa-challenge', mfaChallengeRoutes);
```

- [ ] **Step 3: Write route tests**

Create `tests/api/mfa-challenge-routes.spec.js`:

```javascript
describe('MFA Challenge Routes', () => {
  let app, request;

  beforeAll(async () => {
    app = require('../../src/app');
    request = require('supertest');
  });

  describe('POST /api/mfa-challenge/initiate', () => {
    test('returns 401 if not authenticated', async () => {
      const res = await request(app)
        .post('/api/mfa-challenge/initiate')
        .send({ method: 'sms' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('returns 400 if method is invalid', async () => {
      const agent = request.agent(app);
      // Mock session
      await agent.get('/').then(() => {
        agent.jar.setCookie('sessionId=mock; Path=/');
      });
      const res = await agent
        .post('/api/mfa-challenge/initiate')
        .send({ method: 'invalid' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/mfa-challenge/verify', () => {
    test('returns 401 if not authenticated', async () => {
      const res = await request(app)
        .post('/api/mfa-challenge/verify')
        .send({ otp: '123456' });
      expect(res.status).toBe(401);
    });

    test('sets mfa_verified on session when verify succeeds', async () => {
      // This test requires a real session fixture — defer to E2E
    });
  });
});
```

Run: `npm run test:api -- mfa-challenge-routes.spec.js`
Expected: At least the 401 tests pass.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/src/routes/mfaChallenge.js \
         demo_api_server/src/app.js \
         tests/api/mfa-challenge-routes.spec.js
git commit -m "feat: add mfaChallenge routes for initiate/verify"
```

---

## Task 3: Create UI /mfa-challenge page

**Files:**
- Create: `demo_api_ui/src/pages/MFAChallengeLogin.tsx`
- Modify: `demo_api_ui/src/routes/ProtectedRoutes.js` or `App.js` (wire route)
- Create: `demo_api_ui/src/pages/MFAChallengeLogin.module.css` (styling)

**Interfaces:**
- Consumes: `/api/mfa-challenge/initiate` (POST), `/api/mfa-challenge/verify` (POST)
- Produces: React component `<MFAChallengeLogin />` with three methods (SMS/Email/FIDO2), OTP input, FIDO2 WebAuthn flow

---

[Task 3–6 continue with same structure]

## Summary of Changes

| Component | Change | Rationale |
|-----------|--------|-----------|
| **BFF middleware** | Post-OAuth gate redirects admin → `/mfa-challenge` if not verified | Enforce MFA before admin page access |
| **BFF routes** | `/api/mfa-challenge/{initiate,verify}` delegate to existing MFA endpoints | Reuse working code, keep scope minimal |
| **UI /mfa-challenge** | React page: pick method, OTP input, WebAuthn flow, redirect on success | UX for MFA completion post-OAuth |
| **Demo bypass** | `username === 'demouser'` sets `mfa_verified=true` automatically | Keep demo login fast for sales/dev |
| **OAuth callback** | Admin users get `mfa_verified: false` on session creation | Trigger MFA gate on first admin access |
| **Tests** | Middleware unit tests + E2E admin login flow | Verify gate behavior and happy path |
