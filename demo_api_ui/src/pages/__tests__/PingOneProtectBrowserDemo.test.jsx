import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PingOneProtectBrowserDemo from "../PingOneProtectBrowserDemo";
import { evaluateProtectAuthentication } from "../../services/protectAuthenticationService";
import { collectPingOneSignals } from "../../lib/pingOneSignalsSdk";
import { getSdkClient } from "../../lib/oidcSdkClient";

vi.mock("../../services/protectAuthenticationService", () => ({
  evaluateProtectAuthentication: vi.fn(),
  completeProtectAuthentication: vi.fn(),
}));
vi.mock("../../lib/pingOneSignalsSdk", () => ({ collectPingOneSignals: vi.fn() }));
vi.mock("../../lib/oidcSdkClient", () => ({ getSdkClient: vi.fn(), isSdkError: (value) => Boolean(value?.error) }));

describe("PingOneProtectBrowserDemo", () => {
  let authorizeUrl;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    authorizeUrl = vi.fn().mockResolvedValue("https://auth.pingone.com/authorize?state=test");
    collectPingOneSignals.mockResolvedValue("private-signals-payload");
    getSdkClient.mockResolvedValue({ authorize: { url: authorizeUrl } });
    evaluateProtectAuthentication.mockResolvedValue({ flowId: "opaque-flow", level: "LOW", recommendedAction: "ALLOW" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stepUpAcrValue: "Multi_Factor" }) }));
  });

  it("runs Signals and Protect before starting the normal PKCE OIDC flow for LOW", async () => {
    render(<MemoryRouter><PingOneProtectBrowserDemo /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/pingone username or email/i), { target: { value: "alice@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /run pingone protect sign-in/i }));

    await waitFor(() => expect(evaluateProtectAuthentication).toHaveBeenCalledWith({ userId: "alice@example.com", signalsData: "private-signals-payload" }));
    expect(authorizeUrl).toHaveBeenCalledWith({ query: { login_hint: "alice@example.com" } });
    expect(sessionStorage.getItem("protect-auth-flow-v1")).toContain("opaque-flow");
    expect(document.body.textContent).not.toContain("private-signals-payload");
  });

  it("requests PingOne MFA step-up for MEDIUM risk", async () => {
    evaluateProtectAuthentication.mockResolvedValue({ flowId: "opaque-flow", level: "MEDIUM", recommendedAction: "MFA" });
    render(<MemoryRouter><PingOneProtectBrowserDemo /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/pingone username or email/i), { target: { value: "alice@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /run pingone protect sign-in/i }));

    await waitFor(() => expect(authorizeUrl).toHaveBeenCalledWith({
      query: { login_hint: "alice@example.com", acr_values: "Multi_Factor", max_age: "0" },
    }));
  });

  it("shows a High-risk block without initiating OIDC", async () => {
    evaluateProtectAuthentication.mockResolvedValue({ level: "HIGH", recommendedAction: "DENY" });
    render(<MemoryRouter><PingOneProtectBrowserDemo /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/pingone username or email/i), { target: { value: "alice@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /run pingone protect sign-in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/sign-in blocked/i);
    expect(authorizeUrl).not.toHaveBeenCalled();
  });

  it("fails closed when Signals collection fails", async () => {
    collectPingOneSignals.mockRejectedValue(new Error("Signals unavailable"));
    render(<MemoryRouter><PingOneProtectBrowserDemo /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/pingone username or email/i), { target: { value: "alice@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /run pingone protect sign-in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Signals unavailable");
    expect(evaluateProtectAuthentication).not.toHaveBeenCalled();
    expect(authorizeUrl).not.toHaveBeenCalled();
  });

  it("opens a standalone pop-out and exposes a theme toggle", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ focus: vi.fn() });
    render(<MemoryRouter><PingOneProtectBrowserDemo /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /open protect demo pop-out/i }));
    expect(open).toHaveBeenCalledWith("/protect-auth-demo?popout=1", "pingone-protect-auth", expect.stringContaining("popup"));
    expect(screen.getByRole("button", { name: /switch to (light|dark) theme/i })).toBeInTheDocument();
  });
});
