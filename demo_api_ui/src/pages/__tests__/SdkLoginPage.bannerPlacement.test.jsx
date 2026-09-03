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
      token: { get: vi.fn().mockResolvedValue({ error: "no_tokens" }) },
    });
  });

  it("renders the notice banner below the button that set it, not above", async () => {
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    const button = await screen.findByRole("button", { name: /run mfa checkpoint/i });
    await user.click(button);

    const notice = await screen.findByText(/in-page teaching state/i);
    // DOCUMENT_POSITION_FOLLOWING = 4: notice comes after the button in the DOM.
    expect(button.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
