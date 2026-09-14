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
      "about:blank",
      "sdk-login-popup",
      expect.any(String),
    );
  });

  it("opens the pop-out window synchronously, then points it at the authorize URL", async () => {
    const popup = { closed: false, close: vi.fn(), location: {} };
    window.open = vi.fn(() => popup);
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    await user.click(await screen.findByRole("button", { name: /sign in in a pop-out/i }));

    expect(window.open).toHaveBeenCalledWith("about:blank", "sdk-login-popup", expect.any(String));
    await vi.waitFor(() =>
      expect(popup.location.href).toBe("https://auth.pingone.com/env-1/as/authorize?state=s1"),
    );
  });

  it("closes the popup and shows the error when building the authorize URL fails", async () => {
    const popup = { closed: false, close: vi.fn(), location: {} };
    window.open = vi.fn(() => popup);
    authorizeUrl.mockRejectedValue(new Error("Could not reach PingOne"));
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    await user.click(await screen.findByRole("button", { name: /sign in in a pop-out/i }));

    expect(await screen.findByText(/could not reach pingone/i)).toBeInTheDocument();
    expect(popup.close).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /sign in in a pop-out/i })).not.toBeDisabled();
  });

  it("exchanges only a pop-out result from its own window and origin", async () => {
    const popup = { closed: false, close: vi.fn(), location: {} };
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

    // A message with the right origin and source but the wrong type is ignored too.
    const wrongType = (origin, source) => {
      const event = new MessageEvent("message", { data: { ...result, type: "not-the-right-type" }, origin });
      Object.defineProperty(event, "source", { value: source });
      return event;
    };
    await act(async () => {
      window.dispatchEvent(wrongType(window.location.origin, popup));
    });
    expect(exchange).not.toHaveBeenCalled();

    tokenGet.mockResolvedValue({ accessToken: "at" });
    await act(async () => {
      window.dispatchEvent(message(window.location.origin, popup));
    });
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledWith("c1", "s1"));
    expect(await screen.findByText(/authenticated/i)).toBeInTheDocument();
  });

  it("keeps busy until the token exchange settles, so a second pop-out click can't overlap it", async () => {
    const popup = { closed: false, close: vi.fn(), location: {} };
    window.open = vi.fn(() => popup);
    const user = userEvent.setup();
    render(<SdkLoginPage />);
    await user.click(await screen.findByRole("button", { name: /sign in in a pop-out/i }));

    let resolveExchange;
    exchange.mockReturnValue(
      new Promise((resolve) => {
        resolveExchange = resolve;
      }),
    );

    const result = { type: "sdk-login-popup-result", code: "c1", state: "s1", error: null, errorDescription: null };
    // jsdom's MessageEvent only accepts a real Window/MessagePort as `source`, so
    // the fake popup is attached after construction.
    const message = (origin, source) => {
      const event = new MessageEvent("message", { data: result, origin });
      Object.defineProperty(event, "source", { value: source });
      return event;
    };
    await act(async () => {
      window.dispatchEvent(message(window.location.origin, popup));
    });
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledWith("c1", "s1"));

    expect(screen.getByRole("button", { name: /sign in in a pop-out/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /sign in with the sdk/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /sign in here/i })).toBeDisabled();
    expect(window.open).toHaveBeenCalledTimes(1);

    tokenGet.mockResolvedValue({ accessToken: "at" });
    await act(async () => {
      resolveExchange({ accessToken: "at" });
    });

    expect(await screen.findByText(/authenticated/i)).toBeInTheDocument();
  });

  it("shows an error and re-enables the pop-out button when the token exchange rejects", async () => {
    const popup = { closed: false, close: vi.fn(), location: {} };
    window.open = vi.fn(() => popup);
    exchange.mockRejectedValue(new Error("Token exchange failed."));
    const user = userEvent.setup();
    render(<SdkLoginPage />);
    await user.click(await screen.findByRole("button", { name: /sign in in a pop-out/i }));

    const result = { type: "sdk-login-popup-result", code: "c1", state: "s1", error: null, errorDescription: null };
    const message = (origin, source) => {
      const event = new MessageEvent("message", { data: result, origin });
      Object.defineProperty(event, "source", { value: source });
      return event;
    };
    await act(async () => {
      window.dispatchEvent(message(window.location.origin, popup));
    });

    expect(await screen.findByText(/token exchange failed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in in a pop-out/i })).not.toBeDisabled();
  });

  it("signs in with the embedded form, clears the password and reaches the signed-in state", async () => {
    startEmbeddedSignIn.mockResolvedValue({ flowId: "f", checkUrl: "u", resumeBase: "b" });
    submitPassword.mockResolvedValue({ code: "c2", state: "s2" });
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    await user.type(await screen.findByLabelText(/username/i), "demoUser");
    const passwordField = screen.getByLabelText(/password/i);
    await user.type(passwordField, "pw");
    tokenGet.mockResolvedValue({ accessToken: "at" });
    await user.click(screen.getByRole("button", { name: /sign in here/i }));

    await vi.waitFor(() => expect(exchange).toHaveBeenCalledWith("c2", "s2"));
    expect(submitPassword).toHaveBeenCalledWith({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "demoUser", "pw");
    expect(passwordField).toHaveValue("");
    expect(await screen.findByText(/authenticated/i)).toBeInTheDocument();
  });

  it("disables the pop-out and redirect buttons while an embedded submit is pending", async () => {
    startEmbeddedSignIn.mockResolvedValue({ flowId: "f", checkUrl: "u", resumeBase: "b" });
    let resolveSubmit;
    submitPassword.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    await user.type(await screen.findByLabelText(/username/i), "demoUser");
    await user.type(screen.getByLabelText(/password/i), "pw");
    await user.click(screen.getByRole("button", { name: /sign in here/i }));

    expect(await screen.findByRole("button", { name: /sign in in a pop-out/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /sign in with the sdk/i })).toBeDisabled();

    tokenGet.mockResolvedValue({ accessToken: "at" });
    await act(async () => {
      resolveSubmit({ code: "c2", state: "s2" });
    });
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledWith("c2", "s2"));
  });

  it("shows why and offers both hosted sign-ins when the embedded form hits an unsupported step", async () => {
    startEmbeddedSignIn.mockResolvedValue({ flowId: "f", checkUrl: "u", resumeBase: "b" });
    submitPassword.mockRejectedValue(new EmbeddedSignInError("unsupported_step", "PingOne asked for MFA_REQUIRED, which this form does not handle.", "MFA_REQUIRED"));
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    await user.type(await screen.findByLabelText(/username/i), "demoUser");
    await user.type(screen.getByLabelText(/password/i), "pw");
    await user.click(screen.getByRole("button", { name: /sign in here/i }));

    expect(await screen.findByText(/mfa_required/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use the pop-out/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use the redirect/i })).toBeInTheDocument();
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

  it("shows the message and no fallback buttons when the embedded form rejects invalid credentials", async () => {
    startEmbeddedSignIn.mockResolvedValue({ flowId: "f", checkUrl: "u", resumeBase: "b" });
    submitPassword.mockRejectedValue(new EmbeddedSignInError("invalid_credentials", "Invalid username or password"));
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    await user.type(await screen.findByLabelText(/username/i), "demoUser");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in here/i }));

    expect(await screen.findByText(/invalid username or password/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use the pop-out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use the redirect/i })).not.toBeInTheDocument();
  });
});
