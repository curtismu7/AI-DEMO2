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
});
