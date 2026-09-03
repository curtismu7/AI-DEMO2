import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SdkLoginPage from "../SdkLoginPage";
import { getSdkClient, isSdkError } from "../../lib/oidcSdkClient";

vi.mock("../../lib/oidcSdkClient", () => ({
  getSdkClient: vi.fn(),
  isSdkError: vi.fn((result) => !result || Boolean(result?.error)),
}));

describe("SdkLoginPage — feedback placement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSdkError.mockImplementation((result) => !result || Boolean(result?.error));
    getSdkClient.mockResolvedValue({
      token: { get: vi.fn().mockResolvedValue({ accessToken: "at" }) },
      user: { info: vi.fn().mockResolvedValue({ sub: "demo-user" }) },
    });
  });

  it("renders the notice banner below the button that set it, not above", async () => {
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    // "Run MFA checkpoint" now performs a real redirect (no in-page notice);
    // "Refresh session" is still a lifecycle-exercise placeholder, so it's the
    // trigger for this DOM-ordering check.
    const button = await screen.findByRole("button", { name: /^refresh session$/i });
    await user.click(button);

    const notice = await screen.findByText(/exercise selected/i);
    // DOCUMENT_POSITION_FOLLOWING = 4: notice comes after the button in the DOM.
    expect(button.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
