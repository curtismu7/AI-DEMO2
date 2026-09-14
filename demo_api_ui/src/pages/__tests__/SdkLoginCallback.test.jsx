import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SdkLoginCallback from "../SdkLoginCallback";
import { getSdkClient, isSdkError } from "../../lib/oidcSdkClient";

vi.mock("../../lib/oidcSdkClient", () => ({
  getSdkClient: vi.fn(),
  isSdkError: vi.fn((result) => !result || Boolean(result?.error)),
}));

describe("SdkLoginCallback", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    isSdkError.mockImplementation((result) => !result || Boolean(result?.error));
  });

  function renderAt(search) {
    // The component reads window.location.search directly (not react-router's
    // location), so the URL has to be set on the jsdom window itself. A real
    // /sdk-login route is included so navigate("/sdk-login") is observable.
    window.history.pushState({}, "", `/sdk-login/callback${search}`);
    return render(
      <MemoryRouter initialEntries={[`/sdk-login/callback${search}`]}>
        <Routes>
          <Route path="/sdk-login/callback" element={<SdkLoginCallback />} />
          <Route path="/sdk-login" element={<div>SIGN IN PAGE</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

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
});
