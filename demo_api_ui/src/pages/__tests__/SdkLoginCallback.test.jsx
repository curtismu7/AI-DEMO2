import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SdkLoginCallback from "../SdkLoginCallback";
import { getSdkClient, isSdkError } from "../../lib/oidcSdkClient";
import { completeProtectAuthentication } from "../../services/protectAuthenticationService";
import { PROTECT_AUTH_FLOW_KEY } from "../../lib/protectAuthFlow";

vi.mock("../../services/protectAuthenticationService", () => ({
  completeProtectAuthentication: vi.fn(),
}));

vi.mock("../../lib/oidcSdkClient", () => ({
  getSdkClient: vi.fn(),
  isSdkError: vi.fn((result) => !result || Boolean(result?.error)),
}));

describe("SdkLoginCallback", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    isSdkError.mockImplementation((result) => !result || Boolean(result?.error));
    completeProtectAuthentication.mockResolvedValue(undefined);
  });

  function renderAt(search) {
    // The component reads window.location.search directly (not react-router's
    // location), so the URL has to be set on the jsdom window itself.
    window.history.pushState({}, "", `/sdk-login/callback${search}`);
    return render(
      <MemoryRouter initialEntries={[`/sdk-login/callback${search}`]}>
        <Routes>
          <Route path="/sdk-login/callback" element={<SdkLoginCallback />} />
          <Route path="/sdk-login" element={<div>SIGN IN PAGE</div>} />
          <Route path="/protect-auth-demo" element={<div>PROTECT DEMO PAGE</div>} />
          <Route path="/ai-products/protect" element={<div>PROTECT PRODUCT PAGE</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const idToken = (claims) => {
    const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    return `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;
  };

  it("on a reload of an already-attempted code, auto-recovers to the sign-in page without an error screen", async () => {
    sessionStorage.setItem("sdk-login-attempted-code", "usedcode");
    const revoke = vi.fn().mockResolvedValue({});
    getSdkClient.mockResolvedValue({ token: { revoke } });

    renderAt("?code=usedcode&state=somestate");

    expect(await screen.findByText("SIGN IN PAGE")).toBeInTheDocument();
    expect(revoke).toHaveBeenCalled();
    expect(screen.queryByText(/already been used/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/state mismatch/i)).not.toBeInTheDocument();
  });

  it("on a failed exchange, auto-recovers to the sign-in page without an error screen", async () => {
    const exchange = vi.fn().mockResolvedValue({ error: "state_error" });
    const revoke = vi.fn().mockResolvedValue({});
    getSdkClient.mockResolvedValue({ token: { exchange, revoke } });

    renderAt("?code=badcode&state=somestate");

    expect(await screen.findByText("SIGN IN PAGE")).toBeInTheDocument();
    expect(revoke).toHaveBeenCalled();
  });

  it("exchanges a fresh code normally and records it as attempted", async () => {
    const exchange = vi.fn().mockResolvedValue({ ok: true });
    getSdkClient.mockResolvedValue({ token: { exchange } });

    renderAt("?code=freshcode&state=somestate");

    expect(await screen.findByText("SIGN IN PAGE")).toBeInTheDocument();
    expect(exchange).toHaveBeenCalledWith("freshcode", "somestate");
    expect(sessionStorage.getItem("sdk-login-attempted-code")).toBe("freshcode");
  });

  it("reports successful Protect completion and returns to the Protect demo", async () => {
    const exchange = vi.fn().mockResolvedValue({ ok: true });
    const get = vi.fn().mockResolvedValue({ idToken: idToken({ email: "demo@example.com" }) });
    getSdkClient.mockResolvedValue({ token: { exchange, get } });
    sessionStorage.setItem(PROTECT_AUTH_FLOW_KEY, JSON.stringify({ version: 1, flowId: "opaque-flow", returnTo: "product", userId: "demo@example.com", issuedAt: Date.now() }));

    renderAt("?code=protectcode&state=protectstate");

    expect(await screen.findByText("PROTECT PRODUCT PAGE")).toBeInTheDocument();
    expect(completeProtectAuthentication).toHaveBeenCalledWith({ flowId: "opaque-flow", completionStatus: "SUCCESS" });
    expect(sessionStorage.getItem(PROTECT_AUTH_FLOW_KEY)).toBeNull();
  });

  it("reports FAILED when OIDC authenticates a different account than Protect evaluated", async () => {
    const exchange = vi.fn().mockResolvedValue({ ok: true });
    const get = vi.fn().mockResolvedValue({ idToken: idToken({ email: "other@example.com" }) });
    const revoke = vi.fn().mockResolvedValue({ ok: true });
    getSdkClient.mockResolvedValue({ token: { exchange, get, revoke } });
    sessionStorage.setItem(PROTECT_AUTH_FLOW_KEY, JSON.stringify({ version: 1, flowId: "opaque-flow", returnTo: "product", userId: "demo@example.com", issuedAt: Date.now() }));

    renderAt("?code=other-account-code&state=protectstate");

    expect(await screen.findByText("PROTECT PRODUCT PAGE")).toBeInTheDocument();
    expect(completeProtectAuthentication).toHaveBeenCalledWith({ flowId: "opaque-flow", completionStatus: "FAILED" });
    expect(completeProtectAuthentication).not.toHaveBeenCalledWith({ flowId: "opaque-flow", completionStatus: "SUCCESS" });
    expect(revoke).toHaveBeenCalled();
    expect(sessionStorage.getItem(PROTECT_AUTH_FLOW_KEY)).toBeNull();
  });

  it("reports failed Protect completion when PingOne denies sign-in", async () => {
    sessionStorage.setItem(PROTECT_AUTH_FLOW_KEY, JSON.stringify({ version: 1, flowId: "opaque-flow", userId: "demo@example.com", issuedAt: Date.now() }));

    renderAt("?error=access_denied&error_description=Denied");

    expect(await screen.findByText("PROTECT DEMO PAGE")).toBeInTheDocument();
    expect(completeProtectAuthentication).toHaveBeenCalledWith({ flowId: "opaque-flow", completionStatus: "FAILED" });
    expect(sessionStorage.getItem(PROTECT_AUTH_FLOW_KEY)).toBeNull();
  });

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
      // window.close() is deferred so the posted message is delivered before the
      // window closes (a close-versus-message delivery race).
      await vi.waitFor(() => expect(close).toHaveBeenCalled());
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
});
