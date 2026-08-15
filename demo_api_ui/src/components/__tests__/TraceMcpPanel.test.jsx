import { render, screen } from "@testing-library/react";
import TraceMcpPanel from "../TraceMcpPanel";

const STEPS = [
  { id: "signin", title: "Sign-in", lane: "PINGONE", status: "done", detail: {} },
  { id: "exchange", title: "Token exchange — delegation", lane: "BFF", status: "done", detail: {} },
  { id: "gateway", title: "Agent Gateway — token validated", lane: "GATEWAY", status: "done", detail: {} },
  { id: "mcp", title: "MCP server — tool executes", lane: "MCP", status: "done", detail: {} },
  { id: "api", title: "Resource server — API call", lane: "API", status: "pending", detail: {} },
  { id: "reply", title: "LLM composes reply", lane: "LLM", status: "pending", detail: {} },
];

// The MCP view lists the hops that carry or serve the tool call. The RFC 8693
// exchange mints the MCP-audience token, but showing it here opened the MCP view
// with a token exchange rather than a tool call — it keeps its own step and card
// in the chain, it is just not an MCP call.
test("renders the gateway/mcp/api steps, expanded, and not the token exchange", () => {
  const { container } = render(
    <TraceMcpPanel steps={STEPS} trace={{ tokenEvents: [], mcpResult: null }} onInspect={() => {}} />
  );
  expect(screen.getByText(/Agent Gateway — token validated/)).toBeInTheDocument();
  expect(screen.getByText(/MCP server — tool executes/)).toBeInTheDocument();
  expect(screen.getByText(/Resource server — API call/)).toBeInTheDocument();
  expect(screen.queryByText(/Token exchange — delegation/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Sign-in/)).not.toBeInTheDocument();
  expect(screen.queryByText(/LLM composes reply/)).not.toBeInTheDocument();
  expect(container.querySelectorAll("details.tctr-step[open]")).toHaveLength(3);
});

test("shows empty state when no tool call yet", () => {
  render(<TraceMcpPanel steps={STEPS} trace={{ tokenEvents: [], mcpResult: null }} onInspect={() => {}} />);
  expect(screen.getByText(/No MCP tool call yet/i)).toBeInTheDocument();
});

test("renders the FULL request, response and raw payload from mcpResult", () => {
  const trace = {
    tokenEvents: [],
    mcpResult: { toolName: "get_balance", status: "success", duration: 42,
      isDelegated: true, scopes: ["accounts:read"],
      requestJson: { name: "get_balance", arguments: { account: "chk-001" } },
      resultJson: { balance: 1234, currency: "USD" } },
  };
  const { container } = render(<TraceMcpPanel steps={STEPS} trace={trace} onInspect={() => {}} />);
  expect(screen.getAllByText(/get_balance/).length).toBeGreaterThan(0);
  expect(screen.getByText(/42 ms/)).toBeInTheDocument();
  expect(screen.getAllByText(/chk-001/).length).toBeGreaterThan(0);
  // JsonHighlight splits "currency": "USD" across key/punct/string spans — assert on
  // concatenated text content instead of a single text node.
  expect(container.textContent).toMatch(/"currency":\s*"USD"/);
  expect(screen.getByText(/^Request$/)).toBeInTheDocument();
  expect(screen.getByText(/^Response$/)).toBeInTheDocument();
  expect(screen.getByText(/Raw payload/)).toBeInTheDocument();
});

test("renders the delegated token card", () => {
  const trace = {
    tokenEvents: [{ id: "exchanged-token", label: "Delegated Token",
      claims: { sub: "u1", scope: "write", act: { sub: "agent-001" } } }],
    mcpResult: null,
  };
  render(<TraceMcpPanel steps={STEPS} trace={trace} onInspect={() => {}} />);
  expect(screen.getByText(/Delegated Token/)).toBeInTheDocument();
});
