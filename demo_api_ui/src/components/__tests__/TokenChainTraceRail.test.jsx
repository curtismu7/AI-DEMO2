import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import TokenChainTraceRail from "../TokenChainTraceRail";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({ clearEvents: vi.fn() }),
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
  mockFeatureFlags();
});

test("renders header, chain line, and all 11 collapsed steps by default", () => {
  render(<TokenChainTraceRail />);
  expect(document.querySelector(".tctr-title")).toHaveTextContent("Token Chain");
  expect(screen.getByRole("button", { name: /legend/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /clear token chain/i })).toBeDisabled();
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

test("Token Chain tab remains the default and shows all steps", () => {
  render(<TokenChainTraceRail />);
  expect(screen.getByText(/Sign-in — User Token acquired/)).toBeInTheDocument();
  expect(screen.getByText(/Exchange Mode Details/)).toBeInTheDocument();
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

test("Clear resets the rail to awaiting state for the next demo run", () => {
  render(<TokenChainTraceRail />);
  act(() => tokenChainTraceStore.beginTrace({ prompt: "transfer $250 to savings" }));
  act(() => tokenChainTraceStore.completeTrace(true));
  expect(screen.getByText(/Pipeline — "transfer \$250 to savings"/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /clear token chain/i })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: /clear token chain/i }));

  expect(screen.getByText(/Pipeline — awaiting agent action/)).toBeInTheDocument();
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
