import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SdkLoginPage from "../SdkLoginPage";
import { getSdkClient, isSdkError } from "../../lib/oidcSdkClient";

vi.mock("../../lib/oidcSdkClient", () => ({
  getSdkClient: vi.fn(),
  isSdkError: vi.fn((result) => !result || Boolean(result?.error)),
}));

describe("SdkLoginPage — MFA checkpoint (real step-up)", () => {
  const originalFetch = global.fetch;
  const originalLocation = window.location;
  let authorizeUrl;

  beforeEach(() => {
    vi.clearAllMocks();
    isSdkError.mockImplementation((result) => !result || Boolean(result?.error));

    authorizeUrl = vi.fn().mockResolvedValue("https://auth.pingone.com/authorize?acr_values=Multi_Factor");
    getSdkClient.mockResolvedValue({
      token: { get: vi.fn().mockResolvedValue({ error: "no_tokens" }) },
      authorize: { url: authorizeUrl },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ stepUpAcrValue: "Multi_Factor" }) })
    );

    // jsdom throws "Not implemented: navigation" on a real href assignment.
    delete window.location;
    window.location = { ...originalLocation, href: "" };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.location = originalLocation;
  });

  it("re-authorizes with the server's configured acr_values and max_age=0, then redirects", async () => {
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    const button = await screen.findByRole("button", { name: /run mfa checkpoint/i });
    await user.click(button);

    await vi.waitFor(() => {
      expect(authorizeUrl).toHaveBeenCalledWith({
        query: { acr_values: "Multi_Factor", max_age: "0" },
      });
    });
    await vi.waitFor(() => {
      expect(window.location.href).toBe("https://auth.pingone.com/authorize?acr_values=Multi_Factor");
    });
  });
});
