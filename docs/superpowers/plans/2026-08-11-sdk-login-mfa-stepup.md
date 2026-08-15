# SDK Login Step-Up MFA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate a new "decoded ID-token claims" panel on `/sdk-login` behind a live PingOne email-OTP step-up, reusing the existing MFA backend as-is (plus one small auth fallback).

**Architecture:** Browser (SDK sandbox, PKCE public client, no BFF session) calls the existing `POST /api/auth/mfa/enroll/email` and `POST /api/auth/mfa/enroll/email/verify` routes directly, using its own SDK-issued access token as a Bearer credential. Those routes currently resolve the PingOne user id from `req.session.user`, which is `undefined` for a Bearer-only caller — Task 1 adds a fallback to `req.user.sub` (already populated by `authenticateToken`'s Bearer-token path). Once that works, the frontend (Task 2 + Task 3) adds a locked claims panel that unlocks after OTP verification.

**Tech Stack:** Node/Express/Jest+Supertest (backend), React 19/Vite/Vitest (frontend). No new dependencies.

## Global Constraints

- No new npm dependencies (spec: "No new npm dependency for JWT decoding — hand-roll the base64url parse").
- No changes to the BFF's main banking login/session flow (spec non-goal).
- No new backend routes — reuse `routes/mfa.js` / `mfaService.js` exactly as they exist (spec non-goal), except the one fallback line described below.
- All frontend changes live in the single existing file `demo_api_ui/src/pages/SdkLoginPage.jsx` (spec: "no new files needed given its current size and style").
- Actual mount path for the MFA router is `/api/auth/mfa` (confirmed at `demo_api_server/server.js:1088`, `app.use('/api/auth/mfa', mfaRoutes)`) — the spec doc's `/api/mfa/...` shorthand was informal; use `/api/auth/mfa/enroll/email` and `/api/auth/mfa/enroll/email/verify` everywhere in code.
- Server-side: `{ error }` shape for error responses (root/demo_api_server CLAUDE.md) — already how `routes/mfa.js` responds; no change needed there.
- Emoji allowlist only (root CLAUDE.md §0): `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` — a "locked" indicator must use one of these (`🔐` or `🔑`) or an inline SVG, not an arbitrary lock emoji.

---

## Task 1: Backend — Bearer-only fallback in MFA enroll routes

**Files:**
- Modify: `demo_api_server/routes/mfa.js:477`, `demo_api_server/routes/mfa.js:497`
- Test: `demo_api_server/tests/mfaEnrollEmailBearerFallback.route.test.js` (new)

**Interfaces:**
- Consumes: `mfaService.enrollEmailDevice(userId, email)`, `mfaService.completeEmailEnrollment(userId, deviceId, otp)` — existing, unchanged signatures.
- Produces: both routes now resolve `userId` from `req.session.user?.oauthId || req.session.user?.id || req.user?.sub`, so any later task (frontend) can call them with only an `Authorization: Bearer <token>` header and no BFF session cookie.

Current code (for reference, `demo_api_server/routes/mfa.js`):

```js
// line 477
const userId = req.session.user?.oauthId || req.session.user?.id;
```

```js
// line 497
const userId = req.session.user?.oauthId || req.session.user?.id;
```

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/mfaEnrollEmailBearerFallback.route.test.js`:

```js
'use strict';
/**
 * POST /api/auth/mfa/enroll/email(/verify) must resolve the PingOne user id
 * from req.user.sub (set by authenticateToken's Bearer-token path) when
 * there is no BFF session — the /sdk-login sandbox has no req.session.user,
 * only a Bearer-token-carrying browser client.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({
  enrollEmailDevice: jest.fn(),
  completeEmailEnrollment: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  // Simulates authenticateToken's Bearer-token path: no req.session.user,
  // only req.user populated from the decoded token.
  authenticateToken: (req, _res, next) => {
    req.user = { sub: 'bearer-user-sub', email: 'bearer-user@example.com' };
    next();
  },
}));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/posthog', () => ({ capture: jest.fn() }));
jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));

const mfaService = require('../services/mfaService');
const router = require('../routes/mfa');

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  // No req.session.user — only the session object itself, as express-session
  // would provide on a fresh cookie with no BFF login.
  req.session = { save: (cb) => cb && cb() };
  next();
});
app.use('/api/auth/mfa', router);

describe('POST /api/auth/mfa/enroll/email(/verify) — Bearer-only fallback', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enroll/email uses req.user.sub when req.session.user is absent', async () => {
    mfaService.enrollEmailDevice.mockResolvedValue({
      id: 'device-1',
      type: 'EMAIL',
      email: 'bearer-user@example.com',
    });

    const res = await request(app)
      .post('/api/auth/mfa/enroll/email')
      .send({ email: 'bearer-user@example.com' })
      .expect(200);

    expect(mfaService.enrollEmailDevice).toHaveBeenCalledWith(
      'bearer-user-sub',
      'bearer-user@example.com'
    );
    expect(res.body).toEqual({ deviceId: 'device-1', type: 'EMAIL', email: 'bearer-user@example.com' });
  });

  test('enroll/email/verify uses req.user.sub when req.session.user is absent', async () => {
    mfaService.completeEmailEnrollment.mockResolvedValue({ id: 'device-1', status: 'ACTIVE' });

    const res = await request(app)
      .post('/api/auth/mfa/enroll/email/verify')
      .send({ deviceId: 'device-1', otp: '123456' })
      .expect(200);

    expect(mfaService.completeEmailEnrollment).toHaveBeenCalledWith(
      'bearer-user-sub',
      'device-1',
      '123456'
    );
    expect(res.body).toEqual({ deviceId: 'device-1', status: 'ACTIVE' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/mfaEnrollEmailBearerFallback.route.test.js --forceExit`

Expected: FAIL — both tests get 401 `{ error: 'no_session', message: 'Not authenticated.' }` because `userId` resolves to `undefined` (no `req.session.user`, and the fallback to `req.user?.sub` doesn't exist yet).

- [ ] **Step 3: Implement the fallback**

In `demo_api_server/routes/mfa.js`, change line 477:

```js
// before
const userId = req.session.user?.oauthId || req.session.user?.id;
// after
const userId = req.session.user?.oauthId || req.session.user?.id || req.user?.sub;
```

And line 497 (identical change):

```js
// before
const userId = req.session.user?.oauthId || req.session.user?.id;
// after
const userId = req.session.user?.oauthId || req.session.user?.id || req.user?.sub;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/mfaEnrollEmailBearerFallback.route.test.js --forceExit`

Expected: PASS (2/2).

- [ ] **Step 5: Run the full existing MFA test suite to confirm no regression**

Run: `cd demo_api_server && CI=true npx jest mfa --forceExit`

Expected: all existing MFA-related suites (including `mfaDevices.route.test.js`) still pass — the fallback only adds a third `||` alternative, it doesn't change behavior when `req.session.user` is already present.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/mfa.js demo_api_server/tests/mfaEnrollEmailBearerFallback.route.test.js
git commit -m "fix(mfa): resolve user id from Bearer token when no BFF session

The /sdk-login sandbox calls these MFA enroll routes with only an
Authorization: Bearer header (no BFF session cookie). authenticateToken
already decodes that into req.user.sub; the routes just weren't
looking there."
```

---

## Task 2: Frontend — `decodeJwtPayload` helper

**Files:**
- Modify: `demo_api_ui/src/pages/SdkLoginPage.jsx` (add a named export near the top, after the existing imports/constants)
- Test: `demo_api_ui/src/pages/__tests__/SdkLoginPage.decodeJwtPayload.test.js` (new)

**Interfaces:**
- Produces: `export function decodeJwtPayload(jwt)` — takes a compact JWS string (`header.payload.signature`), returns the parsed payload object. Throws `Error('Invalid token format')` if the string doesn't have 3 dot-separated segments, or a `JSON.parse`/decoding error if the payload segment is malformed. Task 3's `StepUpClaimsPanel` calls this with `tokens.idToken`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/SdkLoginPage.decodeJwtPayload.test.js`:

```js
import { describe, expect, test } from "vitest";
import { decodeJwtPayload } from "../SdkLoginPage";

// A hand-built JWT with payload {"sub":"abc123","email":"user@example.com","exp":9999999999}
// header/signature are throwaway values — decodeJwtPayload never validates them.
const SAMPLE_JWT = // gitleaks:allow
  "eyJhbGciOiJIUzI1NiJ9." +
  "eyJzdWIiOiJhYmMxMjMiLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJleHAiOjk5OTk5OTk5OTl9." +
  "signature-not-checked";

describe("decodeJwtPayload", () => {
  test("decodes the base64url payload segment of a JWT", () => {
    expect(decodeJwtPayload(SAMPLE_JWT)).toEqual({
      sub: "abc123",
      email: "user@example.com",
      exp: 9999999999,
    });
  });

  test("throws on a string with fewer than 3 segments", () => {
    expect(() => decodeJwtPayload("not.a.jwt.at.all.here")).not.toThrow(); // 6 segments — still "has enough dots", see next test for the real invalid case
    expect(() => decodeJwtPayload("only-one-segment")).toThrow("Invalid token format");
  });

  test("throws when the payload segment is not valid base64url JSON", () => {
    expect(() => decodeJwtPayload("header.###notbase64###.sig")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/SdkLoginPage.decodeJwtPayload.test.js`

Expected: FAIL — `decodeJwtPayload` is not exported yet.

- [ ] **Step 3: Implement `decodeJwtPayload`**

In `demo_api_ui/src/pages/SdkLoginPage.jsx`, add after the `THEME_KEY` constant (currently line 14):

```js
// Decodes the payload segment of a compact JWS (header.payload.signature).
// This is display-only — it does NOT verify the signature. Never use this
// to make an authorization decision; the PingOne MFA step-up (server-side,
// PingOne-verified) is what actually gates the claims panel.
export function decodeJwtPayload(jwt) {
  const segments = String(jwt || "").split(".");
  if (segments.length < 3) {
    throw new Error("Invalid token format");
  }
  const base64url = segments[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), "=");
  const json = decodeURIComponent(
    atob(padded)
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
  return JSON.parse(json);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/SdkLoginPage.decodeJwtPayload.test.js`

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/SdkLoginPage.jsx demo_api_ui/src/pages/__tests__/SdkLoginPage.decodeJwtPayload.test.js
git commit -m "feat(sdk-login): add decodeJwtPayload helper

Display-only base64url JWT payload decode, no new dependency. Used by
the upcoming step-up claims panel to show decoded ID-token claims."
```

---

## Task 3: Frontend — `StepUpClaimsPanel` (locked claims card + email OTP flow)

**Files:**
- Modify: `demo_api_ui/src/pages/SdkLoginPage.jsx`
- Test: `demo_api_ui/src/pages/__tests__/SdkLoginPage.stepUpClaims.test.jsx` (new)

**Interfaces:**
- Consumes: `decodeJwtPayload` from Task 2 (same file, already in scope — no import needed since it's defined in this file).
- Consumes: `tokens.accessToken`, `tokens.idToken`, `userInfo.email` — already-existing state on `SdkLoginPage` (see `refresh()`, lines ~207-225 of the current file).
- Produces: a new card rendered inside the `status === "signed-in"` block, below the existing `client.user.info()` block and above the Revoke/Logout button row. No new exports beyond what Task 2 already added.

This task touches the `signed-in` render branch and adds local state + two handlers to the `SdkLoginPage` function component. Because this is UI wired to component state (not a pure function), the test renders the page with a mocked `fetch` and a pre-seeded signed-in state, driven through Testing Library.

- [ ] **Step 1: Check how the page is currently tested, if at all**

Run: `ls demo_api_ui/src/pages/__tests__/ | grep -i sdklogin`

Expected: only `SdkLoginPage.decodeJwtPayload.test.js` from Task 2 exists. There is no existing render test for `SdkLoginPage` to extend, so Task 3's test is a new file exercising the full component via `@testing-library/react`. Check `demo_api_ui/src/setupTests.js` and one existing page test (e.g. `demo_api_ui/src/pages/__tests__/AgentGatewayCapabilitiesPage.test.jsx`) for the project's render-test conventions (mocking `fetch`, `render`/`screen`/`fireEvent` imports) before writing Step 2 — match that file's mocking style exactly.

- [ ] **Step 2: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/SdkLoginPage.stepUpClaims.test.jsx`. Adjust the `getSdkClient`/`isSdkError` mock shape to match whatever `../../lib/oidcSdkClient` actually exports (checked in Step 1) — the shape below assumes `client.token.get()` and `client.user.info()` resolve as in the current `refresh()` implementation:

```jsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SdkLoginPage from "../SdkLoginPage";

const SAMPLE_ID_TOKEN = // gitleaks:allow
  "eyJhbGciOiJIUzI1NiJ9." +
  "eyJzdWIiOiJhYmMxMjMiLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20ifQ." +
  "sig";

vi.mock("../../lib/oidcSdkClient", () => ({
  getSdkClient: vi.fn().mockResolvedValue({
    token: { get: vi.fn().mockResolvedValue({ accessToken: "sdk-access-token", idToken: SAMPLE_ID_TOKEN }) },
    user: { info: vi.fn().mockResolvedValue({ email: "user@example.com", name: "Demo User" }) },
  }),
  isSdkError: (result) => !result || Boolean(result.error),
}));

describe("SdkLoginPage — step-up claims panel", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  test("renders locked, requests OTP, verifies, and reveals decoded claims", async () => {
    render(<SdkLoginPage />);

    // Wait for the signed-in state to load (from the mocked SDK client above).
    await screen.findByText(/Reveal decoded claims/i);
    expect(screen.getByText(/step-up required/i)).toBeInTheDocument();

    // Click "Reveal decoded claims" -> POST /api/auth/mfa/enroll/email
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceId: "device-1", type: "EMAIL", email: "user@example.com" }),
    });
    fireEvent.click(screen.getByRole("button", { name: /reveal decoded claims/i }));

    expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/mfa/enroll/email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sdk-access-token" }),
      })
    );

    // Enter OTP, submit -> POST /api/auth/mfa/enroll/email/verify
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: "123456" } });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceId: "device-1", status: "ACTIVE" }),
    });
    fireEvent.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() => expect(screen.getByText(/"sub": "abc123"/)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenLastCalledWith(
      "/api/auth/mfa/enroll/email/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ deviceId: "device-1", otp: "123456" }),
      })
    );
  });

  test("shows an inline error and re-enables the button when the OTP request fails", async () => {
    render(<SdkLoginPage />);
    await screen.findByText(/Reveal decoded claims/i);

    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "enroll_failed", message: "PingOne is unavailable." }),
    });
    fireEvent.click(screen.getByRole("button", { name: /reveal decoded claims/i }));

    expect(await screen.findByText(/PingOne is unavailable\./)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /reveal decoded claims/i });
    expect(button).not.toBeDisabled();
  });

  test("shows an inline error and keeps the OTP input editable on a bad code", async () => {
    render(<SdkLoginPage />);
    await screen.findByText(/Reveal decoded claims/i);

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceId: "device-1", type: "EMAIL", email: "user@example.com" }),
    });
    fireEvent.click(screen.getByRole("button", { name: /reveal decoded claims/i }));
    await screen.findByLabelText(/verification code/i);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: "000000" } });
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: "verify_failed", message: "Incorrect verification code." }),
    });
    fireEvent.click(screen.getByRole("button", { name: /^verify$/i }));

    expect(await screen.findByText(/Incorrect verification code\./)).toBeInTheDocument();
    expect(screen.getByLabelText(/verification code/i)).not.toBeDisabled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/SdkLoginPage.stepUpClaims.test.jsx`

Expected: FAIL — no "Reveal decoded claims" text exists yet.

- [ ] **Step 4: Add state and handlers to `SdkLoginPage`**

In `demo_api_ui/src/pages/SdkLoginPage.jsx`, inside the `SdkLoginPage` function component, after the existing state block (currently ending at line 193 `const [notice, setNotice] = useState(null);`), add:

```js
  // Step-up MFA state for the locked "decoded claims" panel.
  const [claimsUnlocked, setClaimsUnlocked] = useState(false);
  const [mfaDeviceId, setMfaDeviceId] = useState(null);
  const [otpValue, setOtpValue] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState(null);
```

After the existing `handleLogout` callback (currently ending at line 293), add:

```js
  const handleRevealClaims = useCallback(async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const res = await fetch("/api/auth/mfa/enroll/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
        body: JSON.stringify({ email: userInfo?.email }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Could not send a verification code.");
      }
      setMfaDeviceId(data.deviceId);
    } catch (err) {
      setMfaError(err.message);
    } finally {
      setMfaBusy(false);
    }
  }, [tokens, userInfo]);

  const handleVerifyOtp = useCallback(async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const res = await fetch("/api/auth/mfa/enroll/email/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
        body: JSON.stringify({ deviceId: mfaDeviceId, otp: otpValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Verification failed.");
      }
      setClaimsUnlocked(true);
    } catch (err) {
      setMfaError(err.message);
    } finally {
      setMfaBusy(false);
    }
  }, [tokens, mfaDeviceId, otpValue]);
```

- [ ] **Step 5: Add the `StepUpClaimsPanel` sub-component**

In `demo_api_ui/src/pages/SdkLoginPage.jsx`, add this module-level component after `InfoBadge` (currently ending at line 161, before `initials()`):

```jsx
// Locked "decoded claims" card — unlocks only after a live PingOne email-OTP
// step-up. Demonstrates PingOne enforcing step-up before a sensitive read,
// not just the SDK issuing a token.
function StepUpClaimsPanel({
  C,
  styles,
  claimsUnlocked,
  mfaDeviceId,
  otpValue,
  setOtpValue,
  mfaBusy,
  mfaError,
  onReveal,
  onVerify,
  decodedClaims,
  preClass,
}) {
  return (
    <div style={styles.card}>
      <div style={styles.cardH}>
        Decoded ID token claims{" "}
        <span style={styles.tag(claimsUnlocked ? "in" : "out")}>
          {claimsUnlocked ? "unlocked" : "step-up required"}
        </span>
      </div>

      {mfaError && (
        <div style={styles.banner(false)}>
          <b>Error:</b> {mfaError}
        </div>
      )}

      {!claimsUnlocked && !mfaDeviceId && (
        <>
          <p style={{ color: C.muted, margin: "0 0 16px" }}>
            The raw token above is shown freely — this panel is not. Revealing
            the decoded claims requires a live PingOne MFA step-up first.
          </p>
          <button
            type="button"
            disabled={mfaBusy}
            style={{ ...styles.btn, ...styles.btnPrimary, opacity: mfaBusy ? 0.6 : 1 }}
            onClick={onReveal}
          >
            Reveal decoded claims
          </button>
        </>
      )}

      {!claimsUnlocked && mfaDeviceId && (
        <>
          <p style={{ color: C.muted, margin: "0 0 12px" }}>
            A verification code was emailed to you. Enter it below.
          </p>
          <div style={styles.row}>
            <label htmlFor="sdk-login-otp" style={{ position: "absolute", left: -9999 }}>
              Verification code
            </label>
            <input
              id="sdk-login-otp"
              aria-label="Verification code"
              value={otpValue}
              disabled={mfaBusy}
              onChange={(e) => setOtpValue(e.target.value)}
              style={{
                font: "inherit",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.code,
                color: C.text,
              }}
            />
            <button
              type="button"
              disabled={mfaBusy || !otpValue}
              style={{ ...styles.btn, ...styles.btnPrimary, opacity: mfaBusy || !otpValue ? 0.6 : 1 }}
              onClick={onVerify}
            >
              Verify
            </button>
          </div>
        </>
      )}

      {claimsUnlocked && decodedClaims && (
        <>
          <div style={styles.label}>Decoded client.token.get().idToken payload</div>
          <pre className={preClass} style={styles.pre}>
            <JsonHighlight value={decodedClaims} />
          </pre>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Render `StepUpClaimsPanel` inside the signed-in card**

In `demo_api_ui/src/pages/SdkLoginPage.jsx`, in the `status === "signed-in"` block, insert the new panel after the closing of the `{userInfo && (...)}` block and before the `<div style={{ ...styles.row, marginTop: 12 }}>` Revoke/Logout button row (currently around line 432-434):

```jsx
            {userInfo && (
              <>
                <div style={styles.label}>client.user.info()</div>
                <pre className={preClass} style={styles.pre}>
                  <JsonHighlight value={userInfo} />
                </pre>
              </>
            )}
```

becomes:

```jsx
            {userInfo && (
              <>
                <div style={styles.label}>client.user.info()</div>
                <pre className={preClass} style={styles.pre}>
                  <JsonHighlight value={userInfo} />
                </pre>
              </>
            )}

            <StepUpClaimsPanel
              C={C}
              styles={styles}
              claimsUnlocked={claimsUnlocked}
              mfaDeviceId={mfaDeviceId}
              otpValue={otpValue}
              setOtpValue={setOtpValue}
              mfaBusy={mfaBusy}
              mfaError={mfaError}
              onReveal={handleRevealClaims}
              onVerify={handleVerifyOtp}
              decodedClaims={claimsUnlocked && tokens?.idToken ? decodeJwtPayload(tokens.idToken) : null}
              preClass={preClass}
            />
```

Note: `StepUpClaimsPanel` is rendered as its own `styles.card` (not nested inside the existing signed-in card), matching the spec's "new card appears below it." Since it's placed inside the same `status === "signed-in"` JSX block, wrap the return so both cards are siblings — confirm the existing signed-in block already returns a single `<div style={styles.card}>...</div>`; if so, close that div after the Revoke/Logout row exactly as today, and place `<StepUpClaimsPanel ... />` as a sibling `<div>` immediately after that card's closing tag (still inside the outer `{status === "signed-in" && (...)}` fragment), not inside it.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/SdkLoginPage.stepUpClaims.test.jsx`

Expected: PASS (3/3). If a selector doesn't match (e.g. the project's testing-library setup uses a different query pattern than assumed here), adjust the test's queries to match actual rendered output — the behavior under test (locked -> OTP -> unlocked, and the two error paths) is what matters, not the exact query syntax.

- [ ] **Step 8: Run the full frontend unit suite and build gate**

Run: `cd demo_api_ui && npm run test:unit && npm run build`

Expected: all suites pass (no regressions in other pages), build succeeds.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/pages/SdkLoginPage.jsx demo_api_ui/src/pages/__tests__/SdkLoginPage.stepUpClaims.test.jsx
git commit -m "feat(sdk-login): gate decoded ID-token claims behind email OTP step-up

New locked panel below the existing raw-token display. Reveal ->
POST /api/auth/mfa/enroll/email (live PingOne OTP email) -> verify ->
POST /api/auth/mfa/enroll/email/verify -> decoded claims render.
Every failure path (bad code, network, 500) shows an inline error and
re-enables input, matching the fix already shipped for the callback
page's StrictMode error-swallowing bug."
```

---

## Task 4: Manual live verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm the PingOne SPA client used by `/sdk-login` can call the MFA enroll endpoints**

The SDK sandbox's access token (from `PINGONE_SDK_DEMO_CLIENT_ID`) is validated by `authenticateToken` the same way as any other PingOne-issued token for this environment — no new scope should be required for `enroll/email`/`enroll/email/verify` since `mfaService.js` uses a worker token server-side for the actual PingOne MFA API calls, not the caller's token. If step 2 below 401s specifically on the MFA calls (not on `/api/auth/session` or other routes), check whether `authenticateToken`'s JWKS validation rejects this client's tokens for an unrelated reason (e.g. audience) before assuming a scope problem.

- [ ] **Step 2: Exercise the full flow live**

At `https://local.ping-devops.com:4000/sdk-login`:
1. Sign in via the SDK (existing flow).
2. Confirm the raw token JSON still renders exactly as before (no regression).
3. Click "Reveal decoded claims".
4. Confirm a real OTP email arrives at the signed-in demo user's address.
5. Enter the code, click Verify.
6. Confirm the decoded claims JSON renders.
7. Reload the page, sign in again, and try entering a wrong OTP once — confirm the inline error shows and the input stays editable (does not hang, per the callback-page lesson).

- [ ] **Step 3: Report back**

Note in the PR description (or directly to the user) whether live verification passed, and paste any unexpected error text encountered.

---

## Self-Review Notes (for the plan author, not a task)

- **Spec coverage:** narrative (Task 3), backend reuse + fallback (Task 1), no-new-dependency JWT decode (Task 2), error handling on both MFA calls (Task 3 tests), testing section (Tasks 1-3 each carry their own tests + Task 4 manual), parked breadth ideas (intentionally excluded from this plan — future specs).
- **Path correction carried through:** spec said `/api/mfa/...`; actual mount is `/api/auth/mfa/...` (`server.js:1088`) — used correctly in all three tasks above.
- **Type/name consistency check:** `decodeJwtPayload` (Task 2) is the exact name used in Task 3's import-free reference and test. `StepUpClaimsPanel` prop names (`claimsUnlocked`, `mfaDeviceId`, `otpValue`, `setOtpValue`, `mfaBusy`, `mfaError`, `onReveal`, `onVerify`, `decodedClaims`, `preClass`) match the state/handlers defined earlier in Task 3 exactly.
