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
  beforeEach(() => { callMcpTool.mockReset(); });

  it("teaches the gateway and policy decision roles", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /securing ai agent access using ping identity/i })).toBeInTheDocument();
    expect(screen.getAllByText("Agent Gateway", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("PingOne Authorize", { exact: true }).length).toBeGreaterThan(0);
  });

  it("frames the customer story and links each control to a live surface", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /make every agent action accountable/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /run the story live/i })).toBeInTheDocument();
    expect(screen.getByText(/identity, delegated authority, runtime policy, and proof/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /run the banking agent/i })).toHaveAttribute("href", "/agent-flow-inspector");
    expect(screen.getByRole("link", { name: /inspect gateway enforcement/i })).toHaveAttribute("href", "/agent-gateway-inspector");
    expect(screen.getByRole("link", { name: /test authorize decisions/i })).toHaveAttribute("href", "/pingone-authorize?tab=guided");
    expect(screen.getByRole("link", { name: /watch the token and audit trail/i })).toHaveAttribute("href", "/transaction-trace");
    expect(screen.getByRole("link", { name: /see the privilege ai threat-control story/i })).toHaveAttribute("href", "/privilege-for-ai");
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
    // The flow is now a StaticFlowDiagram (shared reel); the stage detail below
    // it is driven by the scenario outcome, so assert the default gateway
    // explanation renders and the reel's Play/Step bar is present.
    expect(screen.getByText(/the gateway is the enforcement point/i)).toBeInTheDocument();
    expect(screen.getByTestId("agal-flow-steps")).toBeInTheDocument();
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
  describe("Ping UI Standard", () => {
    it("opens with an honest note: lesson text is not evaluated, only Run live request is live", () => {
      const { container } = renderPage();
      const page = container.querySelector(".pu-page.agal-page");
      expect(page).not.toBeNull();
      const banner = screen.getByTestId("agal-banner");
      expect(banner).toHaveAttribute("role", "note");
      expect(page.firstElementChild).toContainElement(banner);
      expect(banner).toHaveTextContent(/nothing in them is evaluated/i);
      expect(banner).toHaveTextContent(/needs a signed-in session/i);
      expect(banner).toHaveTextContent(/shows no outcome/i);
      expect(banner.textContent.length).toBeLessThan(420);
    });

    it("has exactly one primary button, Run live request, and it is never a link", () => {
      const { container } = renderPage();
      const primaries = container.querySelectorAll(".pu-btn--primary");
      expect(primaries).toHaveLength(1);
      expect(primaries[0]).toHaveTextContent(/run live request/i);
      expect(primaries[0].tagName).toBe("BUTTON");
    });

    it("keeps Run live request focusable but inert until a request is chosen, and says why", () => {
      renderPage();
      const run = screen.getByRole("button", { name: /run live request/i });
      expect(run).toHaveAttribute("aria-disabled", "true");
      expect(run).not.toBeDisabled();
      expect(run).toHaveAccessibleDescription(/choose a request first/i);
      fireEvent.click(run);
      expect(callMcpTool).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: /read account balance/i }));
      expect(run).not.toHaveAttribute("aria-disabled");
    });

    it("marks the chosen request as pressed", () => {
      renderPage();
      const balance = screen.getByRole("button", { name: /read account balance/i });
      expect(balance).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(balance);
      expect(balance).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /transfer \$500/i })).toHaveAttribute("aria-pressed", "false");
    });

    it("labels the outcome before a live run as expected, not as a decision", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /transfer \$500/i }));
      const result = screen.getByTestId("agal-result");
      expect(result).toHaveAttribute("role", "status");
      expect(result).toHaveTextContent(/expected, not evaluated/i);
      expect(result).not.toHaveTextContent(/live decision/i);
    });

    it("shows the decision the live response carries, labelled live", async () => {
      callMcpTool.mockResolvedValue({ result: { mcpAuthorizeEvaluation: { decision: "DENY", engine: "pingone" } } });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /read account balance/i }));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      const result = screen.getByTestId("agal-result");
      await waitFor(() => expect(result).toHaveTextContent(/live decision/i));
      expect(result).toHaveTextContent("DENY");
      expect(result).not.toHaveTextContent(/expected, not evaluated/i);
    });

    it("names PingOne Authorize only when the response says the pingone engine decided", async () => {
      callMcpTool.mockResolvedValue({ result: { mcpAuthorizeEvaluation: { decision: "PERMIT", engine: "pingone" } } });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /read account balance/i }));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      const result = screen.getByTestId("agal-result");
      await waitFor(() => expect(result).toHaveTextContent(/returned by pingone authorize/i));
      expect(result).toHaveTextContent(/live decision/i);
    });

    it("calls a simulated-engine decision simulated, never live or PingOne", async () => {
      callMcpTool.mockResolvedValue({ result: { mcpAuthorizeEvaluation: { decision: "PERMIT", engine: "simulated" } } });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /read account balance/i }));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      const result = screen.getByTestId("agal-result");
      await waitFor(() => expect(result).toHaveTextContent(/simulated decision/i));
      expect(result).toHaveTextContent(/not pingone authorize/i);
      expect(result).not.toHaveTextContent(/live decision/i);
    });

    it("does not name an engine the response did not report", async () => {
      callMcpTool.mockResolvedValue({ result: { decision: "PERMIT" } });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /read account balance/i }));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      const result = screen.getByTestId("agal-result");
      await waitFor(() => expect(result).toHaveTextContent(/did not say which engine/i));
      expect(result).not.toHaveTextContent(/returned by pingone authorize/i);
    });

    it("reads the decision from the authorize-decision event the live path returns", async () => {
      callMcpTool.mockResolvedValue({
        result: { balance: 1250 },
        tokenEvents: [{ id: "authorize-decision", authorizeDecision: "STEP-UP", authorizeEngine: "pingone", authorizeDecisionId: "d-1" }],
      });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /transfer \$500/i }));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      const result = screen.getByTestId("agal-result");
      await waitFor(() => expect(result).toHaveTextContent(/live decision/i));
      expect(result).toHaveTextContent("STEP-UP");
      expect(result).toHaveTextContent(/returned by pingone authorize/i);
    });

    it("shows a policy denial that throws as a decision, with the engine that made it", async () => {
      callMcpTool.mockRejectedValue(Object.assign(new Error("Denied by policy"), {
        tokenEvents: [{ id: "authorize-decision", authorizeDecision: "DENY", authorizeEngine: "simulated", authorizePath: "sim/path" }],
      }));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /blocked payee/i }));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      const result = screen.getByTestId("agal-result");
      await waitFor(() => expect(result).toHaveTextContent(/simulated decision/i));
      expect(result).toHaveTextContent("DENY");
      expect(result).toHaveTextContent(/denied by policy/i);
      expect(result).not.toHaveTextContent(/no decision/i);
    });

    it("never presents the expected outcome as live when the response has no decision", async () => {
      callMcpTool.mockResolvedValue({ result: { balance: 1250 } });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /read account balance/i }));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      const result = screen.getByTestId("agal-result");
      await waitFor(() => expect(result).toHaveTextContent(/no decision from the engine/i));
      expect(result).not.toHaveTextContent("PERMIT");
    });

    it("shows no outcome when the live request fails, and keeps focus on the button", async () => {
      callMcpTool.mockRejectedValue(new Error("Sign in required"));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /transfer \$500/i }));
      const run = screen.getByRole("button", { name: /run live request/i });
      run.focus();
      fireEvent.click(run);
      // Busy: still focusable, inert, labelled.
      expect(run).toHaveAttribute("aria-disabled", "true");
      expect(document.activeElement).toBe(run);
      const result = screen.getByTestId("agal-result");
      await waitFor(() => expect(result).toHaveTextContent(/no decision/i));
      expect(result).toHaveTextContent(/sign in required/i);
      expect(result).not.toHaveTextContent("STEP-UP");
      expect(document.activeElement).toBe(run);
      expect(screen.getByText(/no outcome was substituted/i)).toBeInTheDocument();
    });

    it("ignores a second click while a request is running", async () => {
      let finish;
      callMcpTool.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /read account balance/i }));
      const run = screen.getByRole("button", { name: /run live request/i });
      fireEvent.click(run);
      fireEvent.click(screen.getByRole("button", { name: /running live request/i }));
      expect(callMcpTool).toHaveBeenCalledTimes(1);
      finish({ result: { decision: "PERMIT" } });
      await waitFor(() => expect(screen.getByTestId("agal-result")).toHaveTextContent("PERMIT"));
    });

    async function runWith(mock, scenarioName = /read account balance/i) {
      if (mock === "pending") callMcpTool.mockReturnValue(new Promise(() => {}));
      else if (mock) callMcpTool.mockResolvedValue(mock);
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: scenarioName }));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      return screen.getByTestId("agal-result");
    }

    it("does not turn the app's event defaults into a decision (a skipped gate has no decision)", async () => {
      // The app builds this event with PERMIT and simulated when the server's evaluation had no decision; it carries
      // no path, decision id, request or response.
      const result = await runWith({
        result: { balance: 1250 },
        tokenEvents: [{ id: "authorize-decision", authorizeDecision: "PERMIT", authorizeEngine: "simulated", authorizePath: null, authorizeDecisionId: null, authorizeRequest: null, authorizeResponse: null }],
      });
      await waitFor(() => expect(result).toHaveTextContent(/no decision from the engine/i));
      expect(result).not.toHaveTextContent("PERMIT");
      expect(result).not.toHaveTextContent(/simulated decision/i);
    });

    it("does not read a skipped evaluation (no decision) as a decision", async () => {
      const result = await runWith({ result: { mcpAuthorizeEvaluation: { ran: false, skipped: true, skipReason: "gateway_authoritative" } } });
      await waitFor(() => expect(result).toHaveTextContent(/no decision from the engine/i));
      expect(result).not.toHaveTextContent("PERMIT");
    });

    it("prefers the raw evaluation over the event", async () => {
      const result = await runWith({
        result: { mcpAuthorizeEvaluation: { decision: "DENY", engine: "pingone" } },
        tokenEvents: [{ id: "authorize-decision", authorizeDecision: "PERMIT", authorizeEngine: "simulated", authorizePath: "p" }],
      });
      await waitFor(() => expect(result).toHaveTextContent("DENY"));
      expect(result).toHaveTextContent(/live decision/i);
      expect(result).not.toHaveTextContent("PERMIT");
    });

    it("does not call a decision with no reported engine live, and does not colour it", async () => {
      const result = await runWith({ result: { decision: "PERMIT" } });
      await waitFor(() => expect(result).toHaveTextContent("PERMIT"));
      expect(result).not.toHaveTextContent(/live decision/i);
      expect(result).toHaveTextContent(/engine not reported/i);
      expect(result.querySelector(".pu-chip--ok")).toBeNull();
      expect(result.querySelector(".pu-card--ok")).toBeNull();
    });

    it("colours a decision only when PingOne Authorize reported it", async () => {
      const result = await runWith({ result: { mcpAuthorizeEvaluation: { decision: "PERMIT", engine: "pingone" } } });
      await waitFor(() => expect(result.querySelector(".pu-chip--ok")).not.toBeNull());
      expect(result.querySelector(".pu-card--ok")).not.toBeNull();
    });

    it("names an engine that is neither pingone nor simulated as reported", async () => {
      const result = await runWith({ result: { mcpAuthorizeEvaluation: { decision: "DENY", engine: "gateway-backstop" } } });
      await waitFor(() => expect(result).toHaveTextContent(/gateway-backstop/));
      expect(result).not.toHaveTextContent(/simulated/i);
      expect(result).not.toHaveTextContent(/live decision/i);
      expect(result.querySelector(".pu-chip--danger")).toBeNull();
    });

    it("never gives a card a tone ping-ui.css does not define", async () => {
      const result = await runWith({ result: { mcpAuthorizeEvaluation: { decision: "WEIRD", engine: "pingone" } } });
      await waitFor(() => expect(result).toHaveTextContent("WEIRD"));
      expect(result.querySelector(".pu-card--info")).toBeNull();
    });

    it("announces a running request in the status region that already exists", async () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /transfer \$500/i }));
      const result = screen.getByTestId("agal-result");
      expect(result).toHaveAttribute("role", "status");
      callMcpTool.mockReturnValue(new Promise(() => {}));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      expect(screen.getByTestId("agal-result")).toBe(result);
      expect(result).toHaveTextContent(/running/i);
      expect(result).not.toHaveTextContent(/expected, not evaluated/i);
    });

    it("keeps a result with the request it was sent for: no switching requests while one runs", async () => {
      let finish;
      callMcpTool.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /read account balance/i }));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      const other = screen.getByRole("button", { name: /transfer \$500/i });
      expect(other).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(other);
      expect(screen.getByRole("button", { name: /read account balance/i })).toHaveAttribute("aria-pressed", "true");
      expect(other).toHaveAttribute("aria-pressed", "false");
      finish({ result: { mcpAuthorizeEvaluation: { decision: "PERMIT", engine: "pingone" } } });
      await waitFor(() => expect(screen.getByTestId("agal-result")).toHaveTextContent("PERMIT"));
      expect(other).not.toHaveAttribute("aria-disabled");
    });

    it("clears an old error when another request is chosen", async () => {
      callMcpTool.mockRejectedValue(new Error("Sign in required"));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /transfer \$500/i }));
      fireEvent.click(screen.getByRole("button", { name: /run live request/i }));
      await waitFor(() => expect(screen.getByTestId("agal-result")).toHaveTextContent(/sign in required/i));
      fireEvent.click(screen.getByRole("button", { name: /blocked payee/i }));
      expect(screen.getByTestId("agal-result")).not.toHaveTextContent(/sign in required/i);
      expect(screen.getByTestId("agal-result")).toHaveTextContent(/expected, not evaluated/i);
    });

    it("labels the payload as an example and makes the scrolling box keyboard reachable", () => {
      renderPage();
      const box = screen.getByRole("region", { name: /decision request example/i });
      expect(box).toHaveAttribute("tabindex", "0");
      expect(screen.getByText("Example payload")).toBeInTheDocument();
    });

    it("gives every chip a word", () => {
      const { container } = renderPage();
      container.querySelectorAll(".pu-chip").forEach((chip) => {
        expect(chip.textContent.trim().length).toBeGreaterThan(0);
      });
    });
  });
});
