import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmbeddedSignInForm from "../EmbeddedSignInForm";
import { getSdkClient } from "../../../lib/oidcSdkClient";
import { startPasswordlessSignIn, lookupUser, selectDevice, checkOtp } from "../../../lib/embeddedPiFlow";

vi.mock("../../../lib/oidcSdkClient", () => ({
  getSdkClient: vi.fn(),
  isSdkError: vi.fn((r) => !r || Boolean(r?.error)),
}));
vi.mock("../../../lib/embeddedPiFlow", async () => {
  const actual = await vi.importActual("../../../lib/embeddedPiFlow");
  return { ...actual, startPasswordlessSignIn: vi.fn(), lookupUser: vi.fn(), selectDevice: vi.fn(), checkOtp: vi.fn() };
});

describe("EmbeddedSignInForm — device-first", () => {
  const flow = { flowId: "f", stepUrl: "u", resumeBase: "b" };
  let exchange;
  beforeEach(() => {
    vi.clearAllMocks();
    exchange = vi.fn().mockResolvedValue({ accessToken: "at" });
    getSdkClient.mockResolvedValue({ token: { exchange } });
    startPasswordlessSignIn.mockResolvedValue(flow);
  });

  it("offers a device sign-in and a way back to the password", async () => {
    const user = userEvent.setup();
    render(<EmbeddedSignInForm onSignedIn={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /sign in with a device instead/i }));
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /use your password instead/i }));
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("goes username -> device picker -> code -> signed in", async () => {
    const onSignedIn = vi.fn();
    lookupUser.mockResolvedValue({
      step: "device",
      selectedDeviceId: null,
      devices: [
        { id: "dev-email", type: "EMAIL", email: "d***@example.com" },
        { id: "dev-sms", type: "SMS", phone: "+1*****1234" },
      ],
    });
    selectDevice.mockResolvedValue({ step: "otp", selectedDeviceId: "dev-sms", devices: [] });
    checkOtp.mockResolvedValue({ step: "done", code: "c1", state: "s1" });
    const user = userEvent.setup();
    render(<EmbeddedSignInForm onSignedIn={onSignedIn} />);

    await user.click(screen.getByRole("button", { name: /sign in with a device instead/i }));
    await user.type(screen.getByLabelText(/username/i), "demouser");
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(lookupUser).toHaveBeenCalledWith(flow, "demouser");

    await user.click(await screen.findByRole("button", { name: /sms/i }));
    expect(selectDevice).toHaveBeenCalledWith(flow, "dev-sms");

    await user.type(await screen.findByLabelText(/verification code/i), "123456");
    await user.click(screen.getByRole("button", { name: /^verify$/i }));
    expect(checkOtp).toHaveBeenCalledWith(flow, "123456");
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledWith("c1", "s1"));
    expect(onSignedIn).toHaveBeenCalled();
  });
});
