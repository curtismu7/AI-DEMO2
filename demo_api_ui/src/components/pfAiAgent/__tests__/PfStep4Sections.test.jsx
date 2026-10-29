import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "../../../services/apiClient";
import PfPiFlowSection from "../PfPiFlowSection";
import PfDpopSection from "../PfDpopSection";
import PfTokenExchangeSection from "../PfTokenExchangeSection";

vi.mock("../../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../FlowDiagram", () => ({ default: () => null }));

describe("PingFederate AI Agent step-4 sections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pi.flow: shows the status and the actions PingFederate offers", async () => {
    apiClient.post.mockResolvedValueOnce({ data: { status: "USERNAME_PASSWORD_REQUIRED", actions: ["self", "checkUsernamePassword"], trace: [] } });
    render(<PfPiFlowSection />);
    fireEvent.click(screen.getByRole("button", { name: /open a pi.flow/i }));
    const proof = await screen.findByTestId("piflow-proof");
    expect(proof).toHaveTextContent("USERNAME_PASSWORD_REQUIRED");
    expect(proof).toHaveTextContent("checkUsernamePassword");
    expect(proof).not.toHaveTextContent("self");
  });

  it("DPoP: starts the sign-in and shows a bound token's thumbprint", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    apiClient.post.mockResolvedValueOnce({ data: { authorizeUrl: "https://pf.example.test/as/authorization.oauth2?x=1" } });
    render(<PfDpopSection ready result={{ tokenType: "DPoP", dpopThumbprint: "abc123" }} />);
    expect(screen.getByTestId("dpop-result")).toHaveTextContent("abc123");
    fireEvent.click(screen.getByRole("button", { name: /dpop-bound token/i }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("https://pf.example.test/as/authorization.oauth2?x=1"));
    vi.unstubAllGlobals();
  });

  it("DPoP: a token without a key binding is not shown as bound", () => {
    render(<PfDpopSection ready result={{ tokenType: "Bearer" }} />);
    expect(screen.queryByTestId("dpop-result")).toBeNull();
  });

  it("token exchange: needs a PingFederate session", () => {
    render(<PfTokenExchangeSection provider="pingone" />);
    expect(screen.getByRole("button", { name: /run both exchanges/i })).toBeDisabled();
    expect(screen.getByTestId("delegation-needs-pf")).toBeInTheDocument();
  });

  it("token exchange: runs both hops and shows the nested act chain", async () => {
    apiClient.post
      .mockResolvedValueOnce({ data: { hop: "agent", claims: { sub: "demouser", aud: "agw", scope: "agent:invoke", act: { sub: "agent" } } } })
      .mockResolvedValueOnce({ data: { hop: "mcp", claims: { sub: "demouser", aud: "mcp", scope: "mcp:invoke", act: { sub: "mcp", act: { sub: "agent" } } } } });
    render(<PfTokenExchangeSection provider="pingfederate" />);
    fireEvent.click(screen.getByRole("button", { name: /run both exchanges/i }));
    expect(await screen.findByTestId("exchange-hop-mcp")).toHaveTextContent('"sub": "mcp"');
    expect(screen.getByTestId("exchange-hop-agent")).toHaveTextContent("demouser");
  });
});
