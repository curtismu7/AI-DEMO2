# /sdk-login Pop-out and Embedded Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pop-out hosted login and an embedded username/password (`pi.flow`) sign-in to `/sdk-login`, beside the existing centralized redirect, all on one PKCE app and one SDK token store.

**Architecture:** A fetch-only module (`embeddedPiFlow.js`) drives PingOne's native flow from the browser and returns `{code, state}`. The callback page gains a popup branch that posts `{code, state}` to its opener instead of exchanging. The page adds two sign-in options; every option finishes with `client.token.exchange(code, state)` in the `/sdk-login` tab, which owns the SDK's `sessionStorage` state and PKCE verifier.

**Tech Stack:** React 19.2, Vite 8, Vitest 3.2 + Testing Library, `@forgerock/oidc-client` 2.x, PingOne `response_mode=pi.flow`.

**Spec:** `docs/superpowers/specs/2026-09-14-sdk-login-onpage-signin-design.md`

## Global Constraints

- UI tests are **Vitest** (`vi.*`), never jest; run `./node_modules/.bin/vitest run <file>` from `demo_api_ui` (never `npx`).
- Every sign-in builds its request with `client.authorize.url()` and finishes with `client.token.exchange(code, state)` in the `/sdk-login` tab. The popup never exchanges.
- `/flows/{id}` and `/as/resume` calls send **no** `Authorization` header. The password check uses `Content-Type: application/vnd.pingidentity.usernamePassword.check+json`, `Accept: */*`.
- Every PingOne fetch uses `credentials: "include"`.
- Popup window name `sdk-login-popup`; message type `sdk-login-popup-result`; `postMessage` target origin is `window.location.origin`; the page accepts a message only when `event.origin === window.location.origin` **and** `event.source === popup`.
- Embedded error codes are exactly `start_failed`, `invalid_credentials`, `unsupported_step`, `resume_blocked`.
- The BFF is not changed. The main-app login, `routes/oauth*.js` and the DaVinci pages are not touched.
- No new inline `color`, `background` or `font-size`. New styles live in `demo_api_ui/src/pages/SdkLoginPage.css` and read `var(--sdk-*, var(--th-*))`.
- Emoji allowlist only (REGRESSION_PLAN §0). The existing `→` in "Sign in with the SDK →" stays.
- Stage files by name; commit on branch `worktree-sdk-login-onpage-signin`.

---

## File Structure

- **Create** `demo_api_ui/src/lib/embeddedPiFlow.js`: browser `pi.flow` start, password check and resume. No React.
- **Create** `demo_api_ui/src/lib/__tests__/embeddedPiFlow.test.js`
- **Create** `demo_api_ui/src/lib/sdkLoginPopup.js`: the popup window name, message type and `isSdkLoginPopup()`.
- **Modify** `demo_api_ui/src/pages/SdkLoginCallback.jsx`: the popup branch.
- **Modify** `demo_api_ui/src/pages/__tests__/SdkLoginCallback.test.jsx`
- **Create** `demo_api_ui/src/components/sdk-login/EmbeddedSignInForm.jsx`: the embedded form UI.
- **Create** `demo_api_ui/src/pages/SdkLoginPage.css`
- **Modify** `demo_api_ui/src/pages/SdkLoginPage.jsx`: three options, popup handler, CSS variables, copy.
- **Create** `demo_api_ui/src/pages/__tests__/SdkLoginPage.signInOptions.test.jsx`
- **Modify** `TECH_DEBT.md`: the PKCE app's CORS requirement.

---

### Task 1: `embeddedPiFlow` module

**Files:**
- Create: `demo_api_ui/src/lib/embeddedPiFlow.js`
- Test: `demo_api_ui/src/lib/__tests__/embeddedPiFlow.test.js`

**Interfaces:**
- Produces:
  - `startEmbeddedSignIn(client): Promise<{ flowId: string, checkUrl: string, resumeBase: string }>`
  - `submitPassword(flow, username: string, password: string): Promise<{ code: string, state: string }>`
  - `class EmbeddedSignInError extends Error { code: 'start_failed'|'invalid_credentials'|'unsupported_step'|'resume_blocked'; detail?: string }`
  - `PASSWORD_CHECK_TYPE = "application/vnd.pingidentity.usernamePassword.check+json"`

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/lib/__tests__/embeddedPiFlow.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startEmbeddedSignIn,
  submitPassword,
  EmbeddedSignInError,
  PASSWORD_CHECK_TYPE,
} from "../embeddedPiFlow";

const AUTHZ = "https://auth.pingone.com/env-1/as/authorize?client_id=c&state=s1&code_challenge=x";
const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const client = () => ({ authorize: { url: vi.fn().mockResolvedValue(AUTHZ) } });

describe("embeddedPiFlow", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  beforeEach(() => { global.fetch = vi.fn(); });

  it("starts the flow with response_mode=pi.flow and credentials, and returns the password check link", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes({
      id: "flow-1",
      status: "USERNAME_PASSWORD_REQUIRED",
      _links: { "usernamePassword.check": { href: "https://auth.pingone.com/env-1/flows/flow-1" } },
    }));

    const flow = await startEmbeddedSignIn(client());

    const [url, init] = global.fetch.mock.calls[0];
    expect(new URL(url).searchParams.get("response_mode")).toBe("pi.flow");
    expect(new URL(url).searchParams.get("state")).toBe("s1");
    expect(init.credentials).toBe("include");
    expect(flow).toEqual({
      flowId: "flow-1",
      checkUrl: "https://auth.pingone.com/env-1/flows/flow-1",
      resumeBase: "https://auth.pingone.com/env-1",
    });
  });

  it("rejects a flow that does not start at the password step as unsupported_step", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes({ id: "flow-1", status: "MFA_REQUIRED", _links: {} }));
    await expect(startEmbeddedSignIn(client())).rejects.toMatchObject({ code: "unsupported_step", detail: "MFA_REQUIRED" });
  });

  it("submits the password with the vendor content type and no Authorization, resumes, and returns code and state", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonRes({ id: "flow-1", status: "COMPLETED" }))
      .mockResolvedValueOnce(jsonRes({ authorizeResponse: { code: "code-1", state: "s1" } }));

    const result = await submitPassword(
      { flowId: "flow-1", checkUrl: "https://auth.pingone.com/env-1/flows/flow-1", resumeBase: "https://auth.pingone.com/env-1" },
      "demoUser",
      "pw",
    );

    const [checkUrl, checkInit] = global.fetch.mock.calls[0];
    expect(checkUrl).toBe("https://auth.pingone.com/env-1/flows/flow-1");
    expect(checkInit.method).toBe("POST");
    expect(checkInit.credentials).toBe("include");
    expect(checkInit.headers["Content-Type"]).toBe(PASSWORD_CHECK_TYPE);
    expect(checkInit.headers.Authorization).toBeUndefined();
    expect(JSON.parse(checkInit.body)).toEqual({ username: "demoUser", password: "pw" });

    const [resumeUrl, resumeInit] = global.fetch.mock.calls[1];
    expect(resumeUrl).toBe("https://auth.pingone.com/env-1/as/resume?flowId=flow-1");
    expect(resumeInit.credentials).toBe("include");
    expect(result).toEqual({ code: "code-1", state: "s1" });
  });

  it("maps a rejected password to invalid_credentials with PingOne's message", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes({ code: "INVALID_DATA", details: [{ message: "Invalid username or password" }] }, 400));
    const err = await submitPassword({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "u", "bad").catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddedSignInError);
    expect(err.code).toBe("invalid_credentials");
    expect(err.message).toBe("Invalid username or password");
  });

  it("maps a second step after the password to unsupported_step", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes({ id: "f", status: "PASSWORD_EXPIRED" }));
    await expect(submitPassword({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "u", "p"))
      .rejects.toMatchObject({ code: "unsupported_step", detail: "PASSWORD_EXPIRED" });
  });

  it("maps a resume the browser cannot read to resume_blocked", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonRes({ id: "f", status: "COMPLETED" }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(submitPassword({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "u", "p"))
      .rejects.toMatchObject({ code: "resume_blocked" });
  });

  it("maps a resume with no code to resume_blocked", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonRes({ id: "f", status: "COMPLETED" }))
      .mockResolvedValueOnce(jsonRes({}));
    await expect(submitPassword({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "u", "p"))
      .rejects.toMatchObject({ code: "resume_blocked" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/lib/__tests__/embeddedPiFlow.test.js`
Expected: FAIL. `embeddedPiFlow` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

```js
// demo_api_ui/src/lib/embeddedPiFlow.js
// Embedded sign-in for /sdk-login: PingOne's native flow (response_mode=pi.flow)
// driven from the browser, so the page can show its own username/password form.
//
//   1. GET  <SDK authorize URL>&response_mode=pi.flow  -> USERNAME_PASSWORD_REQUIRED
//   2. POST _links["usernamePassword.check"]            -> COMPLETED (sets PingOne's ST cookie)
//   3. GET  /as/resume?flowId=                          -> authorizeResponse { code, state }
//
// The SDK built the authorize URL, so it already holds state + the PKCE verifier;
// the caller finishes with client.token.exchange(code, state). No Authorization
// header anywhere: these endpoints are served by auth.pingone.com.
//
// Requires (measured 2026-09-14): explicit CORS origins on the PingOne app —
// without them /as/resume's 200 carries no Access-Control-Allow-Origin — and a
// browser that keeps PingOne's third-party ST cookie (Safari/Firefox do not).

export const PASSWORD_CHECK_TYPE = "application/vnd.pingidentity.usernamePassword.check+json";

export class EmbeddedSignInError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "EmbeddedSignInError";
    this.code = code;
    this.detail = detail;
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function startEmbeddedSignIn(client) {
  const url = await client.authorize.url();
  if (typeof url !== "string") {
    throw new EmbeddedSignInError("start_failed", url?.error || "Could not build the authorization URL.");
  }
  const authorizeUrl = new URL(url);
  authorizeUrl.searchParams.set("response_mode", "pi.flow");

  const res = await fetch(authorizeUrl.toString(), { credentials: "include", headers: { Accept: "*/*" } });
  const flow = await readJson(res);
  if (!res.ok || !flow.id) {
    throw new EmbeddedSignInError("start_failed", flow.message || `PingOne did not start a flow (HTTP ${res.status}).`);
  }
  if (flow.status !== "USERNAME_PASSWORD_REQUIRED") {
    throw new EmbeddedSignInError("unsupported_step", `PingOne asked for ${flow.status}, which this form does not handle.`, flow.status);
  }
  const checkUrl = flow._links?.["usernamePassword.check"]?.href;
  if (!checkUrl) {
    throw new EmbeddedSignInError("start_failed", "PingOne did not offer a username and password check.");
  }
  return {
    flowId: flow.id,
    checkUrl,
    resumeBase: `${authorizeUrl.origin}${authorizeUrl.pathname.replace(/\/as\/authorize$/, "")}`,
  };
}

export async function submitPassword(flow, username, password) {
  const res = await fetch(flow.checkUrl, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": PASSWORD_CHECK_TYPE, Accept: "*/*" },
    body: JSON.stringify({ username, password }),
  });
  const body = await readJson(res);
  if (!res.ok || body.status === "USERNAME_PASSWORD_REQUIRED") {
    const message = body.details?.[0]?.message || body.message || "PingOne rejected the username or password.";
    throw new EmbeddedSignInError("invalid_credentials", message, body.code);
  }
  if (body.status !== "COMPLETED") {
    throw new EmbeddedSignInError("unsupported_step", `PingOne asked for ${body.status}, which this form does not handle.`, body.status);
  }

  const resumeUrl = body.resumeUrl || `${flow.resumeBase}/as/resume?flowId=${encodeURIComponent(body.id || flow.flowId)}`;
  let resume;
  try {
    const r = await fetch(resumeUrl, { credentials: "include", headers: { Accept: "*/*" } });
    resume = await readJson(r);
  } catch {
    throw new EmbeddedSignInError(
      "resume_blocked",
      "The browser could not finish the sign-in. It did not send PingOne's session cookie, which usually means third-party cookies are blocked here.",
    );
  }
  const code = resume.authorizeResponse?.code;
  const state = resume.authorizeResponse?.state;
  if (!code || !state) {
    throw new EmbeddedSignInError(
      "resume_blocked",
      "PingOne did not return an authorization code. The browser probably did not send PingOne's session cookie (third-party cookies blocked).",
    );
  }
  return { code, state };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/lib/__tests__/embeddedPiFlow.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/lib/embeddedPiFlow.js demo_api_ui/src/lib/__tests__/embeddedPiFlow.test.js
git commit -m "feat(sdk-login): browser pi.flow module for an embedded username/password sign-in"
```

---

### Task 2: Popup constants and the callback's popup branch

**Files:**
- Create: `demo_api_ui/src/lib/sdkLoginPopup.js`
- Modify: `demo_api_ui/src/pages/SdkLoginCallback.jsx` (the effect body, before the `oauthErr` check)
- Test: `demo_api_ui/src/pages/__tests__/SdkLoginCallback.test.jsx`

**Interfaces:**
- Produces:
  - `POPUP_WINDOW_NAME = "sdk-login-popup"`
  - `POPUP_RESULT_TYPE = "sdk-login-popup-result"`
  - `isSdkLoginPopup(win = window): boolean`: true only when `win.name === POPUP_WINDOW_NAME`, `win.opener` exists, and `win.opener.location.origin === win.location.origin` (reading a cross-origin opener's location throws, which counts as false).
- Message posted to the opener: `{ type: POPUP_RESULT_TYPE, code: string|null, state: string|null, error: string|null, errorDescription: string|null }`

- [ ] **Step 1: Write the failing test**

Append these tests inside the existing `describe("SdkLoginCallback", …)` in `demo_api_ui/src/pages/__tests__/SdkLoginCallback.test.jsx`:

```jsx
  describe("opened as the /sdk-login pop-out", () => {
    let postMessage;
    let close;
    const originalClose = window.close;

    beforeEach(() => {
      postMessage = vi.fn();
      close = vi.fn();
      window.name = "sdk-login-popup";
      Object.defineProperty(window, "opener", {
        configurable: true,
        writable: true,
        value: { location: { origin: window.location.origin }, postMessage },
      });
      window.close = close;
    });

    afterEach(() => {
      window.name = "";
      Object.defineProperty(window, "opener", { configurable: true, writable: true, value: null });
      window.close = originalClose;
    });

    it("hands the code and state to the opener and closes, without exchanging", async () => {
      const exchange = vi.fn();
      getSdkClient.mockResolvedValue({ token: { exchange } });

      renderAt("?code=popcode&state=popstate");

      await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
      expect(postMessage).toHaveBeenCalledWith(
        { type: "sdk-login-popup-result", code: "popcode", state: "popstate", error: null, errorDescription: null },
        window.location.origin,
      );
      expect(close).toHaveBeenCalled();
      expect(exchange).not.toHaveBeenCalled();
    });

    it("hands a PingOne error to the opener too", async () => {
      renderAt("?error=access_denied&error_description=User%20cancelled");

      await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
      expect(postMessage.mock.calls[0][0]).toMatchObject({ error: "access_denied", errorDescription: "User cancelled" });
    });

    it("treats a cross-origin opener as a normal redirect callback", async () => {
      Object.defineProperty(window, "opener", {
        configurable: true,
        writable: true,
        value: { get location() { throw new Error("cross-origin"); }, postMessage },
      });
      const exchange = vi.fn().mockResolvedValue({ ok: true });
      getSdkClient.mockResolvedValue({ token: { exchange } });

      renderAt("?code=redircode&state=redirstate");

      expect(await screen.findByText("SIGN IN PAGE")).toBeInTheDocument();
      expect(exchange).toHaveBeenCalledWith("redircode", "redirstate");
      expect(postMessage).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/pages/__tests__/SdkLoginCallback.test.jsx`
Expected: FAIL. The popup tests time out waiting for `postMessage`, because the callback exchanges instead.

- [ ] **Step 3: Write minimal implementation**

Create `demo_api_ui/src/lib/sdkLoginPopup.js`:

```js
// The /sdk-login pop-out sign-in: the page opens PingOne's hosted login in a
// window with this name, and /sdk-login/callback, seeing it is that window, hands
// {code, state} back instead of exchanging. The exchange stays in the opener tab,
// which owns the SDK's sessionStorage state + PKCE verifier.
export const POPUP_WINDOW_NAME = "sdk-login-popup";
export const POPUP_RESULT_TYPE = "sdk-login-popup-result";

export function isSdkLoginPopup(win = window) {
  if (win.name !== POPUP_WINDOW_NAME || !win.opener) return false;
  try {
    return win.opener.location.origin === win.location.origin;
  } catch {
    return false; // a cross-origin opener's location is not readable
  }
}
```

In `demo_api_ui/src/pages/SdkLoginCallback.jsx`, add the import:

```js
import { isSdkLoginPopup, POPUP_RESULT_TYPE } from "../lib/sdkLoginPopup";
```

and replace:

```js
        const oauthErr = params.get("error");

        if (oauthErr) {
```

with:

```js
        const oauthErr = params.get("error");

        // Pop-out sign-in: hand the result to /sdk-login and close. The opener
        // does the exchange — it holds the SDK's state + PKCE verifier.
        if (isSdkLoginPopup()) {
          window.opener.postMessage(
            {
              type: POPUP_RESULT_TYPE,
              code,
              state,
              error: oauthErr,
              errorDescription: params.get("error_description"),
            },
            window.location.origin,
          );
          window.close();
          return;
        }

        if (oauthErr) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/pages/__tests__/SdkLoginCallback.test.jsx`
Expected: PASS, 6 tests (3 existing, 3 new).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/lib/sdkLoginPopup.js demo_api_ui/src/pages/SdkLoginCallback.jsx demo_api_ui/src/pages/__tests__/SdkLoginCallback.test.jsx
git commit -m "feat(sdk-login): callback hands the pop-out sign-in result to its opener"
```

---

### Task 3: Page, embedded form and styles

**Files:**
- Create: `demo_api_ui/src/components/sdk-login/EmbeddedSignInForm.jsx`
- Create: `demo_api_ui/src/pages/SdkLoginPage.css`
- Modify: `demo_api_ui/src/pages/SdkLoginPage.jsx` (imports; the root `<div style={styles.page}>`; the `status === "signed-out"` card; the new `handlePopupSignIn` and its cleanup)
- Test: `demo_api_ui/src/pages/__tests__/SdkLoginPage.signInOptions.test.jsx`

**Interfaces:**
- Consumes: `startEmbeddedSignIn`, `submitPassword`, `EmbeddedSignInError` (Task 1); `POPUP_WINDOW_NAME`, `POPUP_RESULT_TYPE` (Task 2); `getSdkClient`, `isSdkError` (`lib/oidcSdkClient`).
- Produces: `EmbeddedSignInForm({ onSignedIn: () => void, onUsePopup: () => void, onUseRedirect: () => void })`

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/pages/__tests__/SdkLoginPage.signInOptions.test.jsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SdkLoginPage from "../SdkLoginPage";
import { getSdkClient, isSdkError } from "../../lib/oidcSdkClient";
import { startEmbeddedSignIn, submitPassword, EmbeddedSignInError } from "../../lib/embeddedPiFlow";

vi.mock("../../lib/oidcSdkClient", () => ({
  getSdkClient: vi.fn(),
  isSdkError: vi.fn((result) => !result || Boolean(result?.error)),
}));

vi.mock("../../lib/embeddedPiFlow", async () => {
  const actual = await vi.importActual("../../lib/embeddedPiFlow");
  return { ...actual, startEmbeddedSignIn: vi.fn(), submitPassword: vi.fn() };
});

describe("SdkLoginPage — sign-in options", () => {
  const originalOpen = window.open;
  let tokenGet;
  let exchange;
  let authorizeUrl;

  beforeEach(() => {
    vi.clearAllMocks();
    isSdkError.mockImplementation((result) => !result || Boolean(result?.error));
    tokenGet = vi.fn().mockResolvedValue({ error: "no_tokens" });
    exchange = vi.fn().mockResolvedValue({ accessToken: "at" });
    authorizeUrl = vi.fn().mockResolvedValue("https://auth.pingone.com/env-1/as/authorize?state=s1");
    getSdkClient.mockResolvedValue({
      token: { get: tokenGet, exchange },
      authorize: { url: authorizeUrl },
      user: { info: vi.fn().mockResolvedValue({ sub: "demo-user" }) },
    });
  });

  afterEach(() => {
    window.open = originalOpen;
  });

  it("offers the redirect, the pop-out and the embedded form when signed out", async () => {
    render(<SdkLoginPage />);
    expect(await screen.findByRole("button", { name: /sign in with the sdk/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in in a pop-out/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("says so when the browser blocks the pop-out", async () => {
    window.open = vi.fn(() => null);
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    await user.click(await screen.findByRole("button", { name: /sign in in a pop-out/i }));

    expect(await screen.findByText(/blocked the pop-up/i)).toBeInTheDocument();
    expect(window.open).toHaveBeenCalledWith(
      "https://auth.pingone.com/env-1/as/authorize?state=s1",
      "sdk-login-popup",
      expect.any(String),
    );
  });

  it("exchanges only a pop-out result from its own window and origin", async () => {
    const popup = { closed: false, close: vi.fn() };
    window.open = vi.fn(() => popup);
    const user = userEvent.setup();
    render(<SdkLoginPage />);
    await user.click(await screen.findByRole("button", { name: /sign in in a pop-out/i }));

    const result = { type: "sdk-login-popup-result", code: "c1", state: "s1", error: null, errorDescription: null };
    // jsdom's MessageEvent only accepts a real Window/MessagePort as `source`, so
    // the fake popup is attached after construction.
    const message = (origin, source) => {
      const event = new MessageEvent("message", { data: result, origin });
      Object.defineProperty(event, "source", { value: source });
      return event;
    };
    await act(async () => {
      window.dispatchEvent(message("https://evil.example", popup));
      window.dispatchEvent(message(window.location.origin, window));
    });
    expect(exchange).not.toHaveBeenCalled();

    tokenGet.mockResolvedValue({ accessToken: "at" });
    await act(async () => {
      window.dispatchEvent(message(window.location.origin, popup));
    });
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledWith("c1", "s1"));
    expect(await screen.findByText(/authenticated/i)).toBeInTheDocument();
  });

  it("signs in with the embedded form and clears the password", async () => {
    startEmbeddedSignIn.mockResolvedValue({ flowId: "f", checkUrl: "u", resumeBase: "b" });
    submitPassword.mockResolvedValue({ code: "c2", state: "s2" });
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    await user.type(await screen.findByLabelText(/username/i), "demoUser");
    await user.type(screen.getByLabelText(/password/i), "pw");
    tokenGet.mockResolvedValue({ accessToken: "at" });
    await user.click(screen.getByRole("button", { name: /sign in here/i }));

    await vi.waitFor(() => expect(exchange).toHaveBeenCalledWith("c2", "s2"));
    expect(submitPassword).toHaveBeenCalledWith({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "demoUser", "pw");
  });

  it("shows why and offers both hosted sign-ins when the embedded form cannot finish", async () => {
    startEmbeddedSignIn.mockResolvedValue({ flowId: "f", checkUrl: "u", resumeBase: "b" });
    submitPassword.mockRejectedValue(new EmbeddedSignInError("resume_blocked", "third-party cookies are blocked here"));
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    await user.type(await screen.findByLabelText(/username/i), "demoUser");
    const password = screen.getByLabelText(/password/i);
    await user.type(password, "pw");
    await user.click(screen.getByRole("button", { name: /sign in here/i }));

    expect(await screen.findByText(/third-party cookies are blocked here/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use the pop-out/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use the redirect/i })).toBeInTheDocument();
    expect(password).toHaveValue("");
    expect(exchange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/pages/__tests__/SdkLoginPage.signInOptions.test.jsx`
Expected: FAIL. There is no "Sign in in a pop-out" button and no username field.

- [ ] **Step 3: Write minimal implementation**

Create `demo_api_ui/src/components/sdk-login/EmbeddedSignInForm.jsx`:

```jsx
import { useState } from "react";
import { getSdkClient, isSdkError } from "../../lib/oidcSdkClient";
import { startEmbeddedSignIn, submitPassword } from "../../lib/embeddedPiFlow";

// Embedded username/password sign-in for /sdk-login. The password goes from this
// browser straight to PingOne (pi.flow); the code is exchanged by the SDK here, so
// the BFF never sees the password or the tokens. Anything beyond a password step,
// or a browser that blocks PingOne's third-party session cookie, falls back to
// the hosted sign-ins.
export default function EmbeddedSignInForm({ onSignedIn, onUsePopup, onUseRedirect }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null); // { code, message }

  const submit = async (event) => {
    event.preventDefault();
    const typed = password;
    setPassword("");
    setBusy(true);
    setFailure(null);
    try {
      const client = await getSdkClient();
      const flow = await startEmbeddedSignIn(client);
      const { code, state } = await submitPassword(flow, username, typed);
      const result = await client.token.exchange(code, state);
      if (isSdkError(result)) throw Object.assign(new Error(result.error || "Token exchange failed."), { code: "start_failed" });
      onSignedIn();
    } catch (err) {
      setFailure({ code: err.code || "start_failed", message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const needsHosted = failure && (failure.code === "unsupported_step" || failure.code === "resume_blocked");

  return (
    <form className="sdk-embedded-form" onSubmit={submit}>
      <label className="sdk-field">
        <span>Username</span>
        <input className="sdk-input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label className="sdk-field">
        <span>Password</span>
        <input className="sdk-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit" className="sdk-btn sdk-btn-primary" disabled={busy}>
        {busy ? "Signing in…" : "Sign in here"}
      </button>
      {failure && (
        <div className="sdk-signin-error" role="alert">
          <p>{failure.message}</p>
          {needsHosted && (
            <div className="sdk-signin-row">
              <button type="button" className="sdk-btn sdk-btn-ghost" onClick={onUsePopup}>Use the pop-out</button>
              <button type="button" className="sdk-btn sdk-btn-ghost" onClick={onUseRedirect}>Use the redirect</button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
```

Create `demo_api_ui/src/pages/SdkLoginPage.css`:

```css
/* /sdk-login sign-in options. The page paints itself from its own PALETTES object;
   the root sets --sdk-* from the active palette so these rules match it without
   inline colours. Each falls back to the app theme token. */

.sdk-signin-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.sdk-signin-option {
  padding: 14px;
  color: var(--sdk-text, var(--th-text));
  background: var(--sdk-panel2, var(--th-bg-inset));
  border: 1px solid var(--sdk-border, var(--th-border));
  border-radius: var(--radius-md);
}

.sdk-signin-option h3 {
  margin: 0 0 6px;
  font-size: var(--font-size-sm);
  color: var(--sdk-text, var(--th-text));
}

.sdk-signin-option p {
  margin: 0 0 10px;
  font-size: var(--font-size-xs);
  color: var(--sdk-muted, var(--th-text-muted));
}

.sdk-embedded-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sdk-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--sdk-muted, var(--th-text-muted));
}

.sdk-input {
  font: inherit;
  padding: 8px 10px;
  color: var(--sdk-text, var(--th-text));
  background: var(--sdk-panel, var(--th-bg-card));
  border: 1px solid var(--sdk-border, var(--th-border));
  border-radius: var(--radius-md);
}

.sdk-btn {
  font: inherit;
  font-weight: 600;
  padding: 8px 14px;
  cursor: pointer;
  border-radius: var(--radius-md);
}

.sdk-btn-primary {
  color: var(--sdk-on-blue, var(--th-text-on-emphasis));
  background: var(--sdk-blue, var(--th-bg-emphasis));
  border: 1px solid var(--sdk-blue, var(--th-bg-emphasis));
}

.sdk-btn-ghost {
  color: var(--sdk-text, var(--th-text));
  background: transparent;
  border: 1px solid var(--sdk-border, var(--th-border));
}

.sdk-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.sdk-signin-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sdk-signin-error {
  padding: 8px 10px;
  font-size: var(--font-size-xs);
  color: var(--sdk-red-text, var(--th-status-error-text));
  background: var(--sdk-error-bg, var(--th-status-error-bg));
  border-radius: var(--radius-md);
}

.sdk-signin-error p {
  margin: 0 0 8px;
}
```

In `demo_api_ui/src/pages/SdkLoginPage.jsx`:

(a) Change the first import line and add three imports:

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmbeddedSignInForm from "../components/sdk-login/EmbeddedSignInForm";
import { POPUP_RESULT_TYPE, POPUP_WINDOW_NAME } from "../lib/sdkLoginPopup";
import "./SdkLoginPage.css";
```

(b) After `const [inspectTokenType, setInspectTokenType] = useState('accessToken');` add:

```jsx
  // Pop-out sign-in: the open popup and the cleanup for its listener + close poll.
  const popupRef = useRef(null);
  const popupCleanupRef = useRef(null);
  useEffect(() => () => popupCleanupRef.current?.(), []);
```

(c) After `handleSignIn`, add:

```jsx
  const handlePopupSignIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    popupCleanupRef.current?.();
    try {
      const client = await getSdkClient();
      const url = await client.authorize.url();
      if (typeof url !== "string") {
        throw new Error(url?.error || "Could not build the authorization URL");
      }
      const popup = window.open(url, POPUP_WINDOW_NAME, "popup,width=520,height=720");
      if (!popup) {
        setError("Your browser blocked the pop-up. Allow pop-ups for this site, or use another sign-in.");
        setBusy(false);
        return;
      }
      popupRef.current = popup;

      let settled = false;
      const finish = () => {
        settled = true;
        window.removeEventListener("message", onMessage);
        clearInterval(closedPoll);
        popupCleanupRef.current = null;
        setBusy(false);
      };
      const onMessage = async (event) => {
        if (event.origin !== window.location.origin || event.source !== popupRef.current) return;
        if (event.data?.type !== POPUP_RESULT_TYPE) return;
        finish();
        const { code, state, error: oauthError, errorDescription } = event.data;
        if (oauthError || !code) {
          setError(errorDescription || oauthError || "The pop-out sign-in did not return a code.");
          return;
        }
        const result = await client.token.exchange(code, state);
        if (isSdkError(result)) {
          setError(result.error || "Token exchange failed.");
          return;
        }
        await refresh();
      };
      const closedPoll = setInterval(() => {
        if (!settled && popup.closed) {
          finish();
          setError("The sign-in window was closed before it finished.");
        }
      }, 500);
      window.addEventListener("message", onMessage);
      popupCleanupRef.current = finish;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }, [refresh]);
```

(d) Replace the root `<div style={styles.page}>` with:

```jsx
    <div
      style={{
        ...styles.page,
        "--sdk-panel": C.panel,
        "--sdk-panel2": C.panel2,
        "--sdk-text": C.text,
        "--sdk-muted": C.muted,
        "--sdk-border": C.border,
        "--sdk-blue": C.blue,
        "--sdk-on-blue": "#fff",
        "--sdk-red-text": C.redText,
        "--sdk-error-bg": C.bannerErrBg,
      }}
    >
```

(e) Replace the whole `{status === "signed-out" && ( … )}` block with:

```jsx
        {status === "signed-out" && (
          <div style={styles.card}>
            <div style={styles.cardH}>
              SDK session <span style={styles.tag("out")}>no tokens</span>
            </div>
            <p style={{ color: C.muted, margin: "0 0 16px" }}>
              You are not signed in. All three sign-ins use the same PKCE app: each calls{" "}
              <code>client.authorize.url()</code> (the SDK stores <code>state</code> + the PKCE verifier) and
              finishes with <code>client.token.exchange(code, state)</code> in this tab.
            </p>
            <div className="sdk-signin-options">
              <div className="sdk-signin-option">
                <h3>Redirect</h3>
                <p>The whole page goes to PingOne&apos;s hosted login and comes back to <code>/sdk-login/callback</code>.</p>
                <button type="button" disabled={busy} className="sdk-btn sdk-btn-primary" onClick={handleSignIn}>
                  Sign in with the SDK →
                </button>
              </div>
              <div className="sdk-signin-option">
                <h3>Pop-out</h3>
                <p>PingOne&apos;s hosted login opens in a pop-up window. The callback posts the code back here and closes; this page never navigates.</p>
                <button type="button" disabled={busy} className="sdk-btn sdk-btn-primary" onClick={handlePopupSignIn}>
                  Sign in in a pop-out
                </button>
              </div>
              <div className="sdk-signin-option">
                <h3>Embedded (pi.flow)</h3>
                <p>
                  Your own form drives PingOne&apos;s native flow with <code>response_mode=pi.flow</code>. Needs explicit
                  CORS origins on the PingOne app and a browser that keeps PingOne&apos;s third-party session cookie
                  (Chrome does; Safari and Firefox block it).
                </p>
                <EmbeddedSignInForm onSignedIn={refresh} onUsePopup={handlePopupSignIn} onUseRedirect={handleSignIn} />
              </div>
            </div>
          </div>
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && ./node_modules/.bin/vitest run src/pages/__tests__/SdkLoginPage.signInOptions.test.jsx src/pages/__tests__/SdkLoginPage.stepUp.test.jsx src/pages/__tests__/SdkLoginPage.inspectToken.test.jsx src/pages/__tests__/SdkLoginPage.bannerPlacement.test.jsx src/pages/__tests__/sdkLoginHeadingMatchesNav.test.js src/components/__tests__/themingRatchet.test.js src/components/__tests__/testConventionsRatchet.test.js`
Expected: PASS for every file. If `themingRatchet` reports a count above its pin, change the offending declaration to use a `--th-*` token or a radius/font-size token. Never raise the pin.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/sdk-login/EmbeddedSignInForm.jsx demo_api_ui/src/pages/SdkLoginPage.css demo_api_ui/src/pages/SdkLoginPage.jsx demo_api_ui/src/pages/__tests__/SdkLoginPage.signInOptions.test.jsx
git commit -m "feat(sdk-login): pop-out and embedded sign-in beside the centralized redirect"
```

---

### Task 4: Record the PingOne requirement, verify, open the PR (controller)

**Files:**
- Modify: `TECH_DEBT.md` (new entry directly under the header paragraphs, above the newest existing entry)

- [ ] **Step 1: Add the TECH_DEBT entry**

Insert above `### [ ] 2026-09-13 — Raw PingGateway log window is open to any signed-in user`:

```markdown
### [ ] 2026-09-14 — /sdk-login embedded sign-in depends on a hand-set PingOne CORS setting

**What's wrong.** The embedded (`pi.flow`) sign-in on `/sdk-login` only completes
because the PKCE app (`160cc22f…` "Demo AI App - PKCE") has `corsSettings`
`ALLOW_SPECIFIC_ORIGINS` for `https://local.ping-devops.com:4000`,
`https://api.ping.demo:4000` and `https://ai-demo.ping-devops.com`, set by hand on
2026-09-14. With `corsSettings: null`, `GET /as/resume` returns the code with no
`Access-Control-Allow-Origin`, so the browser cannot read it. No provisioning
script manages this app, so a re-created app silently breaks the embedded option.

**Why it wasn't fixed now.** The feature PR is UI-only; provisioning for this app
does not exist yet.

**Real fix.** Set `corsSettings` wherever the PKCE app gets provisioned (or add a
check that fails loudly when it is missing), and add a new deployment origin to
the list when one appears.
```

- [ ] **Step 2: Full UI suite and build**

Run: `cd demo_api_ui && npm run test:unit > /tmp/sdk-login-unit.log 2>&1; echo "exit=$?"` then `grep -E "Test Files|Tests " /tmp/sdk-login-unit.log`
Expected: `exit=0`.
Run: `cd demo_api_ui && npm run build > /tmp/sdk-login-build.log 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 3: Emoji allowlist scan**

Run the Python emoji scan over `git diff origin/main` (added lines) and expect no disallowed glyphs.

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add TECH_DEBT.md
git commit -m "docs(tech-debt): /sdk-login embedded sign-in needs the PKCE app's CORS origins"
git push -u origin worktree-sdk-login-onpage-signin
gh pr create --base main --head worktree-sdk-login-onpage-signin --title "feat(sdk-login): pop-out and embedded sign-in beside the centralized redirect" --body-file <pr body>
```

Merge only with the user's approval.

---

### Task 5: Live verification after merge (controller)

- [ ] **Step 1:** Confirm `ai-demo-ui` serves the merged code: `docker exec ai-demo-ui grep -c "handlePopupSignIn" /app/src/pages/SdkLoginPage.jsx` should be ≥ 1.
- [ ] **Step 2:** With the stack generation pinned (`npm --prefix <repo> run -s stack:generation`) and a 1440x900 Chromium context, run each sign-in with the E2E customer from `.env`, never printed:
  - **Embedded:** fill Username and Password, click "Sign in here". Expect the page URL to stay `/sdk-login` with no navigation, and the card to show "authenticated".
  - **Pop-out:** click "Sign in in a pop-out", `page.waitForEvent("popup")`, sign in on PingOne's page in the popup. Expect the popup to close, the main page never to navigate, and "authenticated" to show.
  - **Redirect:** click "Sign in with the SDK →", sign in. Expect a return to `/sdk-login` with "authenticated".
  - Between runs, click "Logout (end PingOne session)" so each starts signed out.
- [ ] **Step 3:** The generation check is unchanged; otherwise rerun.
