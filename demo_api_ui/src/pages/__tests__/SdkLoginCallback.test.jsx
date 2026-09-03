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
});
