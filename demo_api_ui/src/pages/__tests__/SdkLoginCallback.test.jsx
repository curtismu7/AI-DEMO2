import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
    // location), so the URL has to be set on the jsdom window itself.
    window.history.pushState({}, "", `/sdk-login/callback${search}`);
    return render(
      <MemoryRouter>
        <SdkLoginCallback />
      </MemoryRouter>,
    );
  }

  it("shows a clear message on a reload of an already-attempted code, without re-exchanging", async () => {
    sessionStorage.setItem("sdk-login-attempted-code", "usedcode");

    renderAt("?code=usedcode&state=somestate");

    expect(
      await screen.findByText(/already been used/i),
    ).toBeInTheDocument();
    expect(getSdkClient).not.toHaveBeenCalled();
  });

  it("exchanges a fresh code normally and records it as attempted", async () => {
    const exchange = vi.fn().mockResolvedValue({ ok: true });
    getSdkClient.mockResolvedValue({ token: { exchange } });

    renderAt("?code=freshcode&state=somestate");

    await screen.findByText(/Completing sign-in/i);
    expect(exchange).toHaveBeenCalledWith("freshcode", "somestate");
    expect(sessionStorage.getItem("sdk-login-attempted-code")).toBe("freshcode");
  });
});
