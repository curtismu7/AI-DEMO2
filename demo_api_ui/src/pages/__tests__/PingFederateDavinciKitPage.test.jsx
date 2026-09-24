import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PingFederateDavinciKitPage from "../PingFederateDavinciKitPage";

describe("PingFederate DaVinci Integration Kit page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true, authenticated: false }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("requires the dedicated PF proof even if a PingOne user is present", async () => {
    render(<PingFederateDavinciKitPage user={{ oauthProvider: "pingone_sso" }} />);

    expect(screen.getByText("PingFederate sign-in required")).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "Sign in with PingFederate" });
    expect(link).toHaveAttribute("href", "/api/auth/oauth/user/pf-davinci/login");
    expect(fetch).toHaveBeenCalledWith("/api/auth/oauth/user/pf-davinci/status", { credentials: "include" });
  });

  it("recognizes the PF proof and offers a fresh run", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ configured: true, authenticated: true }),
    });
    render(<PingFederateDavinciKitPage />);

    expect(await screen.findByText("PingFederate session detected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run PF sign-in again" }))
      .toHaveAttribute("href", "/api/auth/oauth/user/pf-davinci/login");
  });

  it("does not offer a run when the dedicated PF client is unavailable", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ configured: false, authenticated: false }),
    });
    render(<PingFederateDavinciKitPage />);

    expect(await screen.findByText(/PingFederate sign-in is unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in with PingFederate" })).toBeNull();
  });

  it("shows a PF sign-in failure after the callback redirects back", async () => {
    window.history.replaceState({}, "", "/pingfederate-davinci-kit?pf_davinci=error");
    render(<PingFederateDavinciKitPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("PingFederate sign-in did not complete");
    await screen.findByRole("link", { name: "Sign in with PingFederate" });
  });

  it("explains that the PF adapter runs as part of the authentication policy", async () => {
    render(<PingFederateDavinciKitPage />);
    expect(screen.getByText(/authentication policy containing the DaVinci IdP Adapter/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Widget mode" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "API mode" })).toBeInTheDocument();
    await screen.findByRole("link", { name: "Sign in with PingFederate" });
  });
});
