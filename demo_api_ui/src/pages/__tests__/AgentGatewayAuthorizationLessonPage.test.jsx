import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { callMcpTool } from "../../services/demoAgentService";
import AgentGatewayAuthorizationLessonPage from "../AgentGatewayAuthorizationLessonPage";

vi.mock("../../services/demoAgentService", () => ({
  callMcpTool: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <AgentGatewayAuthorizationLessonPage />
    </MemoryRouter>,
  );
}

describe("AgentGatewayAuthorizationLessonPage", () => {
  it("teaches the gateway and policy decision roles", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /securing ai agent access using ping identity/i })).toBeInTheDocument();
    expect(screen.getAllByText("Agent Gateway", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("PingOne Authorize", { exact: true }).length).toBeGreaterThan(0);
  });

  it("frames the customer story and links each control to a live surface", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /make every agent action accountable/i })).toBeInTheDocument();
    expect(screen.getByText(/identity, delegated authority, runtime policy, and proof/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /run the banking agent/i })).toHaveAttribute("href", "/agent-flow-inspector");
    expect(screen.getByRole("link", { name: /inspect gateway enforcement/i })).toHaveAttribute("href", "/agent-gateway-inspector");
    expect(screen.getByRole("link", { name: /test authorize decisions/i })).toHaveAttribute("href", "/pingone-authorize?tab=guided");
    expect(screen.getByRole("link", { name: /watch the token and audit trail/i })).toHaveAttribute("href", "/transaction-trace");
  });

  it("runs scenarios and exposes the selected decision request", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /transfer \$500/i }));
    expect(screen.getAllByText("STEP-UP", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText(/stronger user verification/i)).toBeInTheDocument();
    expect(screen.getByText(/create_transfer/)).toBeInTheDocument();
  });

  it("updates the explanation when a flow stage is selected", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /protected resource/i }));
    expect(screen.getByText(/receives the request only after the gateway gets a permitted decision/i)).toBeInTheDocument();
  });

  it("runs the selected request through the live MCP service", async () => {
    callMcpTool.mockResolvedValue({
      result: { mcpAuthorizeEvaluation: { decision: "PERMIT" }, balance: 1250 },
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /read account balance/i }));
    fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
    await waitFor(() => expect(callMcpTool).toHaveBeenCalledWith(
      "get_account_balance",
      { tool: "get_account_balance", scope: "accounts:read", account_id: "checking" },
      { useCaseId: "view_balance" },
    ));
    expect(await screen.findByText(/live response captured/i)).toBeInTheDocument();
  });
});
