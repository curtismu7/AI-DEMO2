import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import TokenChainTraceRail, {
  buildA2aTokenChainSteps,
  buildLiveTokenChainSteps,
} from "../TokenChainTraceRail";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({ clearEvents: vi.fn() }),
}));

// TokenChainDemoTrackTab (Demo Track tab) fetches via apiClient.
vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("../ClaimDetailsModal", () => ({
  default: ({ isOpen, tokenType }) =>
    isOpen ? <div data-testid="claims-modal">{tokenType}</div> : null,
}));
vi.mock("../TokenLegendModal", () => ({
  default: ({ isOpen }) => (isOpen ? <div data-testid="legend-modal" /> : null),
}));

/** @param {{ ff_dpop?: boolean, ff_rar?: boolean }} flags */
function mockFeatureFlags(flags = {}) {
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes("/api/admin/feature-flags")) {
      return {
        ok: true,
        json: async () => ({
          flags: [
            { id: "ff_dpop", value: !!flags.ff_dpop },
            { id: "ff_rar", value: !!flags.ff_rar },
          ],
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  });
}

beforeEach(() => {
  tokenChainTraceStore.reset();
  localStorage.clear();
  mockFeatureFlags();
});

test("Live starts empty and Classic keeps the complete fixed catalog as fallback", () => {
  render(<TokenChainTraceRail />);
  expect(document.querySelector(".tctr-title")).toHaveTextContent("Token Chain");
  expect(screen.getByRole("button", { name: /legend/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /clear token chain/i })).toBeDisabled();
  expect(screen.getByText(/Run an agent flow to build the token chain/)).toBeInTheDocument();
  expect(screen.queryByText(/Sign-in — User Token acquired/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Classic" }));

  // 11 step titles present, none expanded (no step body text visible)
  expect(screen.getByText(/Sign-in — User Token acquired/)).toBeInTheDocument();
  expect(screen.getByText(/LLM composes reply/)).toBeInTheDocument();
  expect(document.querySelectorAll("details.tctr-step[open]")).toHaveLength(0);
  // Exchange Mode Details reference accordion present (collapsed)
  expect(screen.getByText(/Exchange Mode Details/)).toBeInTheDocument();
});

test("steps update from the store and expand to show detail", () => {
  render(<TokenChainTraceRail />);
  act(() => tokenChainTraceStore.beginTrace({ prompt: "transfer $250 to savings" }));
  const promptStep = screen.getByText(/Chatbot — prompt sent/).closest("details");
  fireEvent.click(promptStep.querySelector("summary"));
  expect(promptStep).toHaveAttribute("open");
  expect(promptStep.textContent).toContain("transfer $250 to savings");
});

test("legend button opens the legend modal; inspect opens claims modal", () => {
  render(<TokenChainTraceRail />);
  fireEvent.click(screen.getByRole("button", { name: /legend/i }));
  expect(screen.getByTestId("legend-modal")).toBeInTheDocument();

  act(() => tokenChainTraceStore.ingestTokenEvents([
    { id: "user-token", status: "active", claims: { sub: "u1", scope: "read" } },
  ]));
  const signin = screen.getByText(/Sign-in — User Token acquired/).closest("details");
  fireEvent.click(signin.querySelector("summary"));
  fireEvent.click(screen.getByRole("button", { name: /inspect claims/i }));
  expect(screen.getByTestId("claims-modal")).toHaveTextContent("user");
});

test("MCP tab shows the MCP panel and hides the full step list; chain line stays", () => {
  render(<TokenChainTraceRail />);
  fireEvent.click(screen.getByRole("tab", { name: /^MCP/ }));
  expect(screen.getByText(/MCP server — tool executes/)).toBeInTheDocument();
  expect(screen.queryByText(/Sign-in — User Token acquired/)).not.toBeInTheDocument();
  expect(screen.queryByText(/LLM composes reply/)).not.toBeInTheDocument();
  expect(screen.getByText("CHAINED")).toBeInTheDocument();
  expect(screen.getByText(/No MCP tool call yet/i)).toBeInTheDocument();
});

test("Classic selection persists as the emergency fallback", () => {
  render(<TokenChainTraceRail />);
  fireEvent.click(screen.getByRole("button", { name: "Classic" }));
  expect(screen.getByText(/Sign-in — User Token acquired/)).toBeInTheDocument();
  expect(screen.getByText(/Exchange Mode Details/)).toBeInTheDocument();
  expect(localStorage.getItem("tctr:view-mode")).toBe("classic");
});

test("token summary accordion lists tokens with change rows", () => {
  render(<TokenChainTraceRail />);
  act(() => tokenChainTraceStore.ingestTokenEvents([
    { id: "user-token", status: "active", label: "User Token",
      claims: { sub: "u1", scope: "read write", aud: "banking-api" } },
    { id: "exchanged-token", status: "active", label: "Delegated Token",
      claims: { sub: "u1", scope: "write", aud: "mcp-gw", act: { sub: "agent-001" } } },
  ]));
  const summary = screen.getByText(/Token Summary/).closest("details");
  fireEvent.click(summary.querySelector("summary"));
  expect(summary.textContent).toContain("Delegated Token");
  expect(summary.textContent).toContain("narrowed");
  expect(summary.textContent).toContain("rebound");
});

test("steps not in this run's path render struck-through with a Not in path badge once the trace completes", () => {
  render(<TokenChainTraceRail />);
  act(() => tokenChainTraceStore.beginTrace({ prompt: "show my accounts" }));
  act(() => tokenChainTraceStore.ingestMcpResult({ tool: "get_accounts", result: { ok: true } }));
  act(() => tokenChainTraceStore.completeTrace(true));

  const gatewayStep = screen.getByText(/Agent Gateway — token validated/).closest("details");
  expect(gatewayStep).toHaveAttribute("data-status", "notinpath");
  expect(gatewayStep.querySelector(".tctr-step-title--notinpath")).toBeInTheDocument();
  expect(gatewayStep.textContent).toContain("Not in path");

  const stepupStep = screen.getByText(/Step-up required/).closest("details");
  expect(stepupStep).toHaveAttribute("data-status", "notinpath");
});

test("Live draws observed steps during the run and reconciles skipped possibilities at completion", () => {
  render(<TokenChainTraceRail />);
  act(() => tokenChainTraceStore.beginTrace({ prompt: "show my accounts" }));
  act(() => tokenChainTraceStore.ingestRoutingMode("heuristic", { action: "get_accounts" }));

  expect(screen.getByText(/Website — browser/)).toBeInTheDocument();
  expect(screen.getByText(/Chatbot — prompt sent/)).toBeInTheDocument();
  expect(screen.queryByText(/Token exchange — delegation/)).not.toBeInTheDocument();
  expect(screen.queryByText(/PingOne Authorize — policy decision/)).not.toBeInTheDocument();

  act(() => tokenChainTraceStore.completeTrace(true));

  const exchange = screen.getByText(/Token exchange — delegation/).closest("details");
  const authorize = screen.getByText(/PingOne Authorize — policy decision/).closest("details");
  expect(exchange).toHaveAttribute("data-status", "notinpath");
  expect(authorize).toHaveAttribute("data-status", "notinpath");
  fireEvent.click(exchange.querySelector("summary"));
  fireEvent.click(authorize.querySelector("summary"));
  expect(exchange).toHaveTextContent("Token exchange was skipped");
  expect(authorize).toHaveTextContent("PingOne Authorize was skipped");
});

test("Live projection preserves conditional observed steps and repeated decisions", () => {
  const projected = buildLiveTokenChainSteps([
    { id: "website", status: "done" },
    { id: "exchange", status: "pending", detail: {} },
    { id: "authorize", status: "done" },
    { id: "authorize:2", baseId: "authorize", status: "error" },
    { id: "stepup", status: "active" },
  ], { startedAt: 1 });

  expect(projected.map((step) => step.id)).toEqual([
    "website", "authorize", "authorize:2", "stepup",
  ]);
});

test("Live A2A chain shows the main and specialist agents as distinct steps", () => {
  const tokenEvents = [
    {
      id: "a2a-agent1-actor",
      status: "acquired",
      claims: { client_id: "main-agent" },
    },
    {
      id: "a2a-exchange1",
      status: "exchanged",
      claims: { act: { sub: "main-agent" } },
    },
    {
      id: "a2a-agent2-actor",
      status: "acquired",
      specialist: "Investment Advisor",
      claims: { client_id: "investment-agent" },
    },
    {
      id: "a2a-exchange2",
      status: "exchanged",
      specialist: "Investment Advisor",
      claims: { act: { sub: "investment-agent", act: { sub: "main-agent" } } },
    },
    {
      id: "a2a-agent-card",
      status: "discovered",
      agentName: "Investment Advisor",
    },
    {
      id: "a2a-protocol-message",
      status: "completed",
      agentName: "Investment Advisor",
    },
  ];

  const a2aSteps = buildA2aTokenChainSteps(tokenEvents);
  expect(a2aSteps.map((step) => step.title)).toContain("Main agent — main-agent");
  expect(a2aSteps.map((step) => step.title)).toContain("Specialist agent — Investment Advisor");

  const projected = buildLiveTokenChainSteps([
    { id: "website", title: "Website", lane: "BROWSER", status: "done" },
    { id: "llm", title: "LLM", lane: "LLM", status: "done" },
    { id: "gateway", title: "Gateway", lane: "GATEWAY", status: "pending", detail: {} },
  ], { startedAt: 1, tokenEvents });

  expect(projected.map((step) => step.id)).toEqual([
    "website",
    "llm",
    "a2a-agent1-actor",
    "a2a-exchange1",
    "a2a-agent2-actor",
    "a2a-exchange2",
    "a2a-agent-card",
    "a2a-protocol-message",
  ]);
});

test("Clear resets the rail to awaiting state for the next demo run", () => {
  render(<TokenChainTraceRail />);
  act(() => tokenChainTraceStore.beginTrace({ prompt: "transfer $250 to savings" }));
  act(() => tokenChainTraceStore.completeTrace(true));
  expect(screen.getByText(/Live Pipeline — "transfer \$250 to savings"/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /clear token chain/i })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: /clear token chain/i }));

  expect(screen.getByText(/Live Pipeline — awaiting agent action/)).toBeInTheDocument();
  expect(tokenChainTraceStore.getState().trace.prompt).toBeNull();
  expect(tokenChainTraceStore.getState().trace.outcome).toBeNull();
  expect(screen.getByRole("button", { name: /clear token chain/i })).toBeDisabled();
});

test("Trust tab is hidden by default and appears when ff_dpop is on", async () => {
  mockFeatureFlags({ ff_dpop: true });
  render(<TokenChainTraceRail />);
  expect(screen.queryByRole("tab", { name: /^Trust$/ })).not.toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByRole("tab", { name: /^Trust$/ })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("tab", { name: /^Trust$/ }));
  expect(screen.getByTestId("trace-trust-panel")).toBeInTheDocument();
  expect(screen.getByText(/Sender-constrained/)).toBeInTheDocument();
  expect(screen.queryByText(/Sign-in — User Token acquired/)).not.toBeInTheDocument();
});

test("Trust tab appears from live DPoP evidence without flags", async () => {
  render(<TokenChainTraceRail />);
  expect(screen.queryByRole("tab", { name: /^Trust$/ })).not.toBeInTheDocument();
  act(() => tokenChainTraceStore.ingestTokenEvents([
    { id: "dpop-binding", status: "active", claims: { cnf: { jkt: "thumbprint0123456789" } } },
  ]));
  await waitFor(() => {
    expect(screen.getByRole("tab", { name: /^Trust$/ })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("tab", { name: /^Trust$/ }));
  expect(screen.getByText("BOUND")).toBeInTheDocument();
});

test("Demo Track tab renders the guided track content", async () => {
  const apiClient = (await import("../../services/apiClient")).default;
  apiClient.get.mockResolvedValue({
    data: {
      track: {
        steps: [{
          stepId: "delegated-access", act: 1, title: "Delegated access", ucIds: ["UC1"],
          buyerStory: "story",
          slots: { green: { chipText: "show my balance", expected: ["PERMIT"] }, red: { label: "replayed", expected: ["BLOCKED"] } },
          proved: { green: "g", red: "r", sayThis: "s" },
        }],
        gauntletSims: [],
      },
      run: { runId: "run-1", activeStepId: "delegated-access", slots: {}, gauntlet: {} },
    },
  });
  render(<TokenChainTraceRail />);
  fireEvent.click(screen.getByRole("tab", { name: /^Demo Track$/ }));
  await waitFor(() => {
    expect(screen.getByText(/Delegated access/)).toBeInTheDocument();
  });
  expect(screen.getByText(/ACT 1/)).toBeInTheDocument();
});
