import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SdkLoginPage from "../SdkLoginPage";
import { getSdkClient, isSdkError } from "../../lib/oidcSdkClient";

vi.mock("../../lib/oidcSdkClient", () => ({
  getSdkClient: vi.fn(),
  isSdkError: vi.fn((result) => !result || Boolean(result?.error)),
}));

describe("SdkLoginPage — banner scroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSdkError.mockImplementation((result) => !result || Boolean(result?.error));
    getSdkClient.mockResolvedValue({
      token: { get: vi.fn().mockResolvedValue({ error: "no_tokens" }) },
    });
    // jsdom's own scrollIntoView stub lives on HTMLElement.prototype, which
    // shadows an override on Element.prototype.
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("scrolls the notice banner into view when a button sets it", async () => {
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    await user.click(await screen.findByRole("button", { name: /run mfa checkpoint/i }));

    expect(await screen.findByText(/in-page teaching state/i)).toBeInTheDocument();
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" }),
    );
  });
});
