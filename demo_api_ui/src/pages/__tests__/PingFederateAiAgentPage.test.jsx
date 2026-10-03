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
