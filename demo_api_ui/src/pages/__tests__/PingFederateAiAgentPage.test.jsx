import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import apiClient from "../../services/apiClient";
import { notifyError } from "../../utils/appToast";
import PingFederateAiAgentPage from "../PingFederateAiAgentPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../utils/appToast", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

const readyStatus = {
  sessionProvider: "pingone",
  features: { cimd: true, crossDomain: true, rar: true },
  nativeIdJagPath: "/pingfederate-id-jag/demo",
};

describe("PingFederate AI Agent page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: readyStatus });
  });

  it("shows the separate CIMD, cross-domain, and RAR paths", async () => {
    render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

    expect(screen.getByRole("heading", { name: /PingFederate AI Agent/i })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Start CIMD authorization/i }))
      .toHaveAttribute("href", "/api/pf-ai-agent/cimd/start");
    expect(screen.getByRole("button", { name: /Run third-party token exchange/i })).toBeInTheDocument();
    const allowedRarButton = screen.getByRole("button", { name: /Run allowed RAR request/i });
    expect(allowedRarButton.closest("form")).toHaveAttribute("method", "post");
    expect(allowedRarButton.closest("form")).toHaveAttribute("action", "/api/pf-ai-agent/rar/start");
    expect(allowedRarButton.closest("form").querySelector('[name="userKey"]')).toHaveValue("demouser");
    expect(screen.queryByText(/mocked.*PingOne/i)).not.toBeInTheDocument();
  });

  // The page can mount before the session check resolves, so `user` is null on the first
  // render. The key box used to capture that empty value once, which kept both RAR buttons
  // hidden after a reload until someone typed a key.
  it("follows the signed-in user when it arrives later, without overwriting what was typed", async () => {
    const { rerender } = render(<PingFederateAiAgentPage user={null} />);
    const input = await screen.findByLabelText(/PF user key for this request/i);
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: /Run allowed RAR request/i })).not.toBeInTheDocument();

    rerender(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
    expect(input).toHaveValue("demouser");
    expect(await screen.findByRole("button", { name: /Run allowed RAR request/i })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "someone-else" } });
    rerender(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
    expect(input).toHaveValue("someone-else");
  });

  describe("DPoP binding for the RAR token", () => {
    const withDpop = (extra = {}) => ({
      ...readyStatus, features: { ...readyStatus.features, rarDpop: true }, ...extra,
    });
    const rarForms = () => [
      screen.getByRole("button", { name: /Run allowed RAR request/i }).closest("form"),
      screen.getByRole("button", { name: /Run out-of-policy RAR request/i }).closest("form"),
    ];

    it("offers no DPoP option unless a DPoP client is configured", async () => {
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      await screen.findByRole("button", { name: /Run allowed RAR request/i });
      expect(screen.queryByLabelText(/DPoP/i)).not.toBeInTheDocument();
      rarForms().forEach((form) => expect(form.querySelector('[name="dpop"]')).toBeNull());
    });

    it("adds dpop to both RAR forms only once the box is ticked", async () => {
      apiClient.get.mockResolvedValue({ data: withDpop() });
      render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
      const box = await screen.findByLabelText(/Bind the access token .* DPoP/i);
      expect(box).not.toBeChecked();
      rarForms().forEach((form) => expect(form.querySelector('[name="dpop"]')).toBeNull());

      fireEvent.click(box);
      rarForms().forEach((form) => expect(form.querySelector('[name="dpop"]')).toHaveValue("1"));

      fireEvent.click(box);
      rarForms().forEach((form) => expect(form.querySelector('[name="dpop"]')).toBeNull());
    });

    describe("after a successful run", () => {
      afterEach(() => window.history.pushState({}, "", "/"));

      it("shows the token type and the key it is bound to, never a token", async () => {
        window.history.pushState({}, "", "/pingfederate-ai-agent?rar=success");
        apiClient.get.mockResolvedValue({ data: withDpop({
          rarResult: { outcome: "accepted", tokenType: "DPoP", dpopThumbprint: "thumb-abc123" },
        }) });
        render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
        const line = await screen.findByTestId("rar-token-line");
        expect(line).toHaveTextContent("DPoP");
        expect(line).toHaveTextContent("thumb-abc123");
        expect(line).toHaveTextContent(/bound to this app/i);
      });

      it("says plainly when the token is only a bearer token", async () => {
        window.history.pushState({}, "", "/pingfederate-ai-agent?rar=success");
        apiClient.get.mockResolvedValue({ data: withDpop({
          rarResult: { outcome: "accepted", tokenType: "Bearer", dpopThumbprint: null },
        }) });
        render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
        const line = await screen.findByTestId("rar-token-line");
        expect(line).toHaveTextContent("Bearer");
        expect(line).toHaveTextContent(/not bound to a key/i);
      });

      it("shows nothing after a denied run", async () => {
        window.history.pushState({}, "", "/pingfederate-ai-agent?rar=denied");
        apiClient.get.mockResolvedValue({ data: withDpop({
          rarResult: { outcome: "denied", tokenType: null, dpopThumbprint: null },
        }) });
        render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);
        await screen.findByText(/PF denied the RAR request/i);
        expect(screen.queryByTestId("rar-token-line")).not.toBeInTheDocument();
      });
    });
  });

  it("sends only the active session provider to the isolated cross-domain endpoint", async () => {
    apiClient.post.mockResolvedValue({ data: {
      subjectProvider: "pingone",
      pfIssuer: "https://pf.example.test",
      assertionAudience: "https://third.example.test",
      downstreamIssuer: "https://third.example.test",
      downstreamAudience: "https://third.example.test/accounts",
      subject: "user-100",
      scope: ["accounts:read"],
      expiresAt: "2026-09-27T12:00:00.000Z",
      hops: [],
    } });
    render(<PingFederateAiAgentPage user={{ username: "demouser" }} />);

    fireEvent.click(await screen.findByRole("button", { name: /Run third-party token exchange/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      "/api/pf-ai-agent/cross-domain/exchange", { subjectProvider: "pingone" },
    ));
    expect(await screen.findByText("user-100")).toBeInTheDocument();
  });

  it("does not submit a different provider when the BFF reports another active session", async () => {
    apiClient.get.mockResolvedValue({ data: { ...readyStatus, sessionProvider: "none" } });
    render(<PingFederateAiAgentPage />);

    const exchange = await screen.findByRole("button", { name: /Run third-party token exchange/i });
    expect(exchange).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
