import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../services/apiClient", () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
vi.mock("../../utils/appToast", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const { default: AicTokenExchangePage } = await import("../AicTokenExchangePage");

const STATUS = {
  features: { login: true, actor: true },
  subjectClientId: "aidemo2",
  actorClientId: "agent",
  delegatedScope: "repair",
  redirectUri: "https://local.ping-devops.com:4000/api/aic-demo/callback",
  userSignedIn: false,
  actorReady: false,
  userResult: null,
  actorResult: null,
};

describe("AicTokenExchangePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers the AIC sign-in and shows the redirect URI to register", async () => {
    get.mockResolvedValue({ data: STATUS });
    render(<AicTokenExchangePage />);
    const link = await screen.findByRole("link", { name: "Sign in at AIC" });
    expect(link).toHaveAttribute("href", "/api/aic-demo/login/start");
    expect(screen.getByText(STATUS.redirectUri)).toBeInTheDocument();
  });

  it("gets the actor token and shows the trace the BFF recorded", async () => {
    get.mockResolvedValue({ data: STATUS });
    post.mockResolvedValue({ data: { actorResult: {
      clientId: "agent", scope: "repair", opaque: true,
      trace: [{ id: "actor-token", title: "The agent gets its own token with client credentials", request: { method: "POST", url: "https://aic/access_token" } }],
    } } });
    render(<AicTokenExchangePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Get actor token" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/aic-demo/actor-token"));
    expect(await screen.findByTestId("aic-actor-proof")).toHaveTextContent("Issued to agent with scope: repair.");
  });

  it("exchanges once both tokens are held and shows who is acting", async () => {
    get.mockResolvedValue({ data: {
      ...STATUS, userSignedIn: true, actorReady: true,
      userResult: { subject: "alice", issuer: "https://aic", scope: "openid repair", trace: [] },
      actorResult: { clientId: "agent", scope: "repair", trace: [] },
    } });
    post.mockResolvedValue({ data: { exchangeResult: {
      subject: "alice", scope: "repair", act: { sub: "agent" }, opaque: true,
      trace: [{ id: "exchange", title: "Exchange the user token and the actor token for a delegated token", request: { method: "POST", url: "https://aic/access_token" } }],
    } } });
    render(<AicTokenExchangePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Exchange tokens" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/aic-demo/exchange"));
    const proof = await screen.findByTestId("aic-exchange-proof");
    expect(proof).toHaveTextContent("Delegated token for alice, with scope: repair.");
    expect(proof).toHaveTextContent('Acting party (act claim): {"sub":"agent"}.');
  });

  it("does not offer the exchange until both tokens are held", async () => {
    get.mockResolvedValue({ data: STATUS });
    render(<AicTokenExchangePage />);
    expect(await screen.findByText("Get the user token and the actor token first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exchange tokens" })).not.toBeInTheDocument();
  });

  it("says what to set when the demo is not configured", async () => {
    get.mockResolvedValue({ data: { ...STATUS, features: { login: false, actor: false } } });
    render(<AicTokenExchangePage />);
    expect(await screen.findByText(/Set AIC_ISSUER and AIC_SUBJECT_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get actor token" })).not.toBeInTheDocument();
  });

  describe("Ping UI Standard", () => {
    const USER = { subject: "alice", issuer: "https://aic", scope: "openid repair", trace: [] };
    const ACTOR = { clientId: "agent", scope: "repair", trace: [] };
    const bannerOf = () => screen.getByRole("note");
    const primaries = (container) => [...container.querySelectorAll(".pu-btn--primary, .aic-page__next")];

    it("puts an honest banner first, derived from what the BFF reported", async () => {
      get.mockResolvedValue({ data: STATUS });
      const { container } = render(<AicTokenExchangePage />);
      // Before the status arrives nothing is claimed about configuration.
      expect(bannerOf()).toHaveTextContent("CHECKING");
      expect(bannerOf()).not.toHaveTextContent("NOT CONFIGURED");
      await screen.findByRole("link", { name: "Sign in at AIC" });
      expect(bannerOf()).toHaveTextContent("LIVE AIC CALLS");
      expect(bannerOf()).toHaveTextContent("animated diagram is a walkthrough, not live traffic");
      const page = container.querySelector(".pu-page");
      expect(page).toHaveAttribute("data-testid", "aic-token-exchange-page");
      expect(page.firstElementChild).toContainElement(bannerOf());
    });

    it("says NOT CONFIGURED only when the BFF said so", async () => {
      get.mockResolvedValue({ data: { ...STATUS, features: { login: false, actor: false } } });
      render(<AicTokenExchangePage />);
      await screen.findByText(/Set AIC_ISSUER and AIC_SUBJECT_CLIENT_ID/);
      expect(bannerOf()).toHaveTextContent("NOT CONFIGURED");
      expect(bannerOf()).not.toHaveTextContent("LIVE AIC CALLS");
    });

    it("does not call a failed status read 'not configured'", async () => {
      get.mockRejectedValue(new Error("down"));
      const { container } = render(<AicTokenExchangePage />);
      await waitFor(() => expect(bannerOf()).toHaveTextContent("STATUS UNAVAILABLE"));
      expect(screen.queryByText(/Set AIC_/)).not.toBeInTheDocument();
      expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
      expect(screen.getAllByText("Unavailable")).toHaveLength(3);
      expect(container.querySelectorAll("button.pu-btn, a.pu-btn")).toHaveLength(0);
    });

    it("keeps exactly one primary, the next step, in every state", async () => {
      // No user token: sign-in is the next step (a link, styled as the primary).
      get.mockResolvedValue({ data: STATUS });
      let view = render(<AicTokenExchangePage />);
      let link = await screen.findByRole("link", { name: "Sign in at AIC" });
      expect(primaries(view.container)).toEqual([link]);
      view.unmount();

      // User token held: the agent token is next.
      get.mockResolvedValue({ data: { ...STATUS, userSignedIn: true, userResult: USER } });
      view = render(<AicTokenExchangePage />);
      let button = await screen.findByRole("button", { name: "Get actor token" });
      expect(primaries(view.container)).toEqual([button]);
      expect(screen.getByRole("link", { name: "Sign in at AIC again" })).not.toHaveClass("aic-page__next");
      view.unmount();

      // Both held: the exchange is next.
      get.mockResolvedValue({ data: { ...STATUS, userSignedIn: true, actorReady: true, userResult: USER, actorResult: ACTOR } });
      view = render(<AicTokenExchangePage />);
      button = await screen.findByRole("button", { name: "Exchange tokens" });
      expect(primaries(view.container)).toEqual([button]);
      expect(screen.getByRole("button", { name: "Get actor token" })).not.toHaveClass("pu-btn--primary");
      view.unmount();

      // Delegated token issued: the flow is complete, so no primary is left.
      get.mockResolvedValue({ data: { ...STATUS, userSignedIn: true, actorReady: true, userResult: USER, actorResult: ACTOR,
        exchangeResult: { subject: "alice", scope: "repair", act: { sub: "agent" }, trace: [{ id: "exchange", title: "Exchange", request: { method: "POST", url: "u" } }] } } });
      view = render(<AicTokenExchangePage />);
      await screen.findByRole("button", { name: "Exchange tokens" });
      expect(primaries(view.container)).toHaveLength(0);
      view.unmount();

      // Nothing configured: nothing to act on, so no button at all.
      get.mockResolvedValue({ data: { ...STATUS, features: { login: false, actor: false } } });
      view = render(<AicTokenExchangePage />);
      await screen.findByText(/Set AIC_ISSUER/);
      expect(primaries(view.container)).toHaveLength(0);
    });

    it("keeps focus on the button while AIC is asked, with a stable name and an announced status", async () => {
      get.mockResolvedValue({ data: { ...STATUS, userSignedIn: true, userResult: USER } });
      let release;
      post.mockReturnValue(new Promise((resolve) => { release = resolve; }));
      render(<AicTokenExchangePage />);
      const button = await screen.findByRole("button", { name: "Get actor token" });
      button.focus();
      fireEvent.click(button);
      const status = screen.getByTestId("aic-actor-status");
      expect(status).toHaveAttribute("role", "status");
      await waitFor(() => expect(status).toHaveTextContent("Asking AIC"));
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
      expect(button).toHaveAccessibleName("Get actor token");
      expect(document.activeElement).toBe(button);
      // A second click while busy is ignored.
      fireEvent.click(button);
      expect(post).toHaveBeenCalledTimes(1);
      release({ data: { actorResult: { ...ACTOR, trace: [] } } });
      await waitFor(() => expect(status).toHaveTextContent("Token held"));
      expect(button).not.toHaveAttribute("aria-disabled");
      expect(document.activeElement).toBe(button);
    });

    it("shows a failed run on its own step only, as a failure", async () => {
      get.mockResolvedValue({ data: { ...STATUS, userSignedIn: true, userResult: USER } });
      post.mockRejectedValue({ response: { data: { message: "AIC said no" } } });
      render(<AicTokenExchangePage />);
      fireEvent.click(await screen.findByRole("button", { name: "Get actor token" }));
      const status = screen.getByTestId("aic-actor-status");
      await waitFor(() => expect(status).toHaveTextContent("Failed"));
      expect(status).toHaveTextContent("AIC said no");
      expect(status).not.toHaveTextContent("Asking AIC");
      expect(screen.getByTestId("aic-exchange-status")).not.toHaveTextContent("AIC said no");
      expect(screen.getByTestId("aic-user-status")).not.toHaveTextContent("AIC said no");
    });

    it("gives the sign-in error a word, not just colour", async () => {
      get.mockResolvedValue({ data: { ...STATUS, lastError: { message: "access_denied" } } });
      window.history.replaceState(null, "", "/aic-token-exchange?aic=error");
      try {
        render(<AicTokenExchangePage />);
        const alert = await screen.findByTestId("aic-login-error");
        expect(alert).toHaveAttribute("role", "alert");
        expect(alert).toHaveTextContent("Failed");
        expect(alert).toHaveTextContent("AIC sign-in did not complete: access_denied");
      } finally {
        window.history.replaceState(null, "", "/");
      }
    });
  });
});
